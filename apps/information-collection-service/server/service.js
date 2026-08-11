'use strict';

const crypto = require('crypto');
const { canManageDepartment, isCollectionAdmin } = require('./auth');
const { digestSchema, validateAnswers, validateFormSchema } = require('./validation');

function id() {
  return crypto.randomUUID();
}

function compactText(value, maxLength = 255) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function sqlDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function taskStatus(row, now = Date.now()) {
  if (row.status === 'cancelled') return 'cancelled';
  if (row.status === 'closed') return 'closed';
  if (row.due_at && new Date(row.due_at).getTime() <= now) return 'closed';
  if (new Date(row.open_at).getTime() > now) return 'scheduled';
  return 'open';
}

function publicForm(row) {
  return {
    formId: row.form_id,
    formCode: row.form_code,
    name: row.name,
    description: row.description || '',
    ownerDepartmentId: Number(row.owner_department_id),
    ownerDepartmentName: row.owner_department_name || null,
    status: row.status,
    draftSchema: parseJson(row.draft_schema, {}),
    draftRevision: Number(row.draft_revision),
    createdByPersonId: Number(row.created_by_person_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicTask(row) {
  return {
    taskId: row.task_id,
    taskCode: row.task_code,
    formId: row.form_id,
    formVersionId: row.form_version_id,
    name: row.name,
    formName: row.form_name || null,
    ownerDepartmentId: Number(row.owner_department_id),
    ownerDepartmentName: row.owner_department_name || null,
    status: taskStatus(row),
    storedStatus: row.status,
    openAt: row.open_at,
    dueAt: row.due_at,
    audience: parseJson(row.audience_definition, {}),
    targetCount: Number(row.target_count || 0),
    submittedCount: Number(row.submitted_count || 0),
    draftCount: Number(row.draft_count || 0),
    createdAt: row.created_at
  };
}

function error(message, status = 400, code = 'BAD_REQUEST', details) {
  const result = new Error(message);
  result.status = status;
  result.code = code;
  if (details) result.details = details;
  return result;
}

async function canonicalizeEntityAnswers(connection, schema, answers) {
  const normalized = { ...answers };
  const fields = schema.sections.flatMap(section => section.fields);
  const personFields = fields.filter(field => field.type === 'person' && normalized[field.fieldKey]);
  const departmentFields = fields.filter(field => field.type === 'department' && normalized[field.fieldKey]);
  const personIds = [...new Set(personFields.map(field => Number(normalized[field.fieldKey].personId)).filter(Number.isInteger))];
  const departmentIds = [...new Set(departmentFields.map(field => Number(normalized[field.fieldKey].departmentId)).filter(Number.isInteger))];
  const people = new Map();
  const departments = new Map();
  if (personIds.length) {
    const [rows] = await connection.execute(
      `SELECT person_id, employee_no, person_name FROM person
        WHERE status='active' AND employment_status='active'
          AND person_id IN (${personIds.map(() => '?').join(',')})`,
      personIds
    );
    for (const row of rows) people.set(Number(row.person_id), row);
  }
  if (departmentIds.length) {
    const [rows] = await connection.execute(
      `SELECT id, name FROM departments
        WHERE status='active' AND id IN (${departmentIds.map(() => '?').join(',')})`,
      departmentIds
    );
    for (const row of rows) departments.set(Number(row.id), row);
  }
  for (const field of personFields) {
    const row = people.get(Number(normalized[field.fieldKey].personId));
    if (!row) throw error('答卷中的人员不存在或已停用', 422, 'ANSWER_PERSON_UNAVAILABLE', { fieldKey: field.fieldKey });
    normalized[field.fieldKey] = { personId: Number(row.person_id), employeeNo: row.employee_no, personName: row.person_name };
  }
  for (const field of departmentFields) {
    const row = departments.get(Number(normalized[field.fieldKey].departmentId));
    if (!row) throw error('答卷中的部门不存在或已停用', 422, 'ANSWER_DEPARTMENT_UNAVAILABLE', { fieldKey: field.fieldKey });
    normalized[field.fieldKey] = { departmentId: Number(row.id), departmentName: row.name };
  }
  return normalized;
}

function makeService({ pool, audit }) {
  async function getForm(formId, identity, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT f.*, d.name AS owner_department_name
         FROM collection_forms f
         JOIN departments d ON d.id=f.owner_department_id
        WHERE f.form_id=? LIMIT 1`,
      [formId]
    );
    const form = rows[0];
    if (!form) throw error('未找到表单', 404, 'FORM_NOT_FOUND');
    if (!canManageDepartment(identity, form.owner_department_id)) throw error('无权管理该部门的表单', 403, 'FORM_SCOPE_DENIED');
    return form;
  }

  async function getTask(taskId, identity, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT t.*, f.name AS form_name, d.name AS owner_department_name
         FROM collection_tasks t
         JOIN collection_forms f ON f.form_id=t.form_id
         JOIN departments d ON d.id=t.owner_department_id
        WHERE t.task_id=? LIMIT 1`,
      [taskId]
    );
    const task = rows[0];
    if (!task) throw error('未找到收集任务', 404, 'TASK_NOT_FOUND');
    if (!canManageDepartment(identity, task.owner_department_id)) throw error('无权管理该部门的收集任务', 403, 'TASK_SCOPE_DENIED');
    return task;
  }

  async function listDirectory(identity, query = '') {
    if (!identity) throw error('请先登录', 401, 'AUTH_REQUIRED');
    const keyword = `%${compactText(query, 80)}%`;
    const [departments] = await pool.execute(
      `SELECT id, code, name FROM departments
        WHERE status='active' AND (?='%%' OR name LIKE ? OR code LIKE ?)
        ORDER BY sort_order, name LIMIT 200`,
      [keyword, keyword, keyword]
    );
    const [people] = await pool.execute(
      `SELECT p.person_id, p.employee_no, p.person_name, p.current_department_id,
              d.name AS department_name,
              EXISTS(SELECT 1 FROM user_accounts a WHERE a.person_id=p.person_id AND a.account_status='active') AS account_available
         FROM person p
         LEFT JOIN departments d ON d.id=p.current_department_id
        WHERE p.status='active' AND p.employment_status='active'
          AND (?='%%' OR p.person_name LIKE ? OR p.employee_no LIKE ? OR d.name LIKE ?)
        ORDER BY d.sort_order, d.name, p.employee_no LIMIT 500`,
      [keyword, keyword, keyword, keyword]
    );
    return {
      departments: departments.map(row => ({ departmentId: Number(row.id), code: row.code, name: row.name })),
      people: people.map(row => ({
        personId: Number(row.person_id), employeeNo: row.employee_no, personName: row.person_name,
        departmentId: row.current_department_id == null ? null : Number(row.current_department_id),
        departmentName: row.department_name || null, accountAvailable: Boolean(row.account_available)
      }))
    };
  }

  async function listGrants(identity) {
    if (!isCollectionAdmin(identity)) throw error('只有信息收集管理员可以管理权限', 403, 'ADMIN_REQUIRED');
    const [rows] = await pool.execute(
      `SELECT g.*, p.employee_no, p.person_name, d.name AS scope_department_name,
              gp.person_name AS granted_by_name, rp.person_name AS revoked_by_name
         FROM collection_app_grants g
         JOIN person p ON p.person_id=g.person_id
         LEFT JOIN departments d ON d.id=g.scope_department_id
         LEFT JOIN person gp ON gp.person_id=g.granted_by_person_id
         LEFT JOIN person rp ON rp.person_id=g.revoked_by_person_id
        ORDER BY g.status, g.role_code, p.person_name`
    );
    return rows.map(row => ({
      grantId: Number(row.grant_id), personId: Number(row.person_id), employeeNo: row.employee_no,
      personName: row.person_name, roleCode: row.role_code, scopeType: row.scope_type,
      scopeDepartmentId: row.scope_department_id == null ? null : Number(row.scope_department_id),
      scopeDepartmentName: row.scope_department_name || null, status: row.status,
      grantedByName: row.granted_by_name || null, grantedAt: row.granted_at,
      revokedByName: row.revoked_by_name || null, revokedAt: row.revoked_at
    }));
  }

  async function grantAccess(identity, payload, req) {
    if (!isCollectionAdmin(identity)) throw error('只有信息收集管理员可以授权', 403, 'ADMIN_REQUIRED');
    const personId = Number(payload.personId);
    const roleCode = payload.roleCode;
    const scopeType = roleCode === 'collection_admin' ? 'global' : 'department';
    const departmentId = scopeType === 'department' ? Number(payload.departmentId) : null;
    if (!Number.isInteger(personId) || !['collection_admin', 'collection_designer'].includes(roleCode)) {
      throw error('授权对象或角色不正确', 422, 'GRANT_INVALID');
    }
    if (scopeType === 'department' && !Number.isInteger(departmentId)) throw error('设计者必须绑定部门', 422, 'GRANT_DEPARTMENT_REQUIRED');
    const [[person]] = await pool.execute(
      `SELECT p.person_id FROM person p JOIN user_accounts a ON a.person_id=p.person_id
        WHERE p.person_id=? AND p.status='active' AND p.employment_status='active' AND a.account_status='active'`,
      [personId]
    );
    if (!person) throw error('人员不存在或账号不可用', 422, 'GRANT_PERSON_UNAVAILABLE');
    if (departmentId) {
      const [[department]] = await pool.execute("SELECT id FROM departments WHERE id=? AND status='active'", [departmentId]);
      if (!department) throw error('部门不存在或已停用', 422, 'GRANT_DEPARTMENT_UNAVAILABLE');
    }
    const scopeKey = scopeType === 'global' ? 'global' : `department:${departmentId}`;
    await pool.execute(
      `INSERT INTO collection_app_grants
        (person_id, role_code, scope_type, scope_department_id, scope_key, status, granted_by_person_id, granted_at, revoked_by_person_id, revoked_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, NULL, NULL)
       ON DUPLICATE KEY UPDATE status='active', granted_by_person_id=VALUES(granted_by_person_id),
         granted_at=CURRENT_TIMESTAMP, revoked_by_person_id=NULL, revoked_at=NULL`,
      [personId, roleCode, scopeType, departmentId, scopeKey, identity.personId]
    );
    await audit(req, { actorPersonId: identity.personId, actionCode: 'grant.activate', entityType: 'grant', entityId: `${personId}:${roleCode}:${scopeKey}`, ownerDepartmentId: departmentId, detail: { roleCode, scopeKey } });
    return { personId, roleCode, scopeType, departmentId, scopeKey };
  }

  async function revokeGrant(identity, grantId, req) {
    if (!isCollectionAdmin(identity)) throw error('只有信息收集管理员可以撤销授权', 403, 'ADMIN_REQUIRED');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[grant]] = await connection.execute('SELECT * FROM collection_app_grants WHERE grant_id=? FOR UPDATE', [Number(grantId)]);
      if (!grant) throw error('未找到授权记录', 404, 'GRANT_NOT_FOUND');
      if (grant.status === 'revoked') {
        await connection.rollback();
        return { grantId: Number(grantId), status: 'revoked' };
      }
      if (grant.role_code === 'collection_admin') {
        const [[count]] = await connection.execute(
          "SELECT COUNT(*) AS total FROM collection_app_grants WHERE role_code='collection_admin' AND scope_type='global' AND status='active' FOR UPDATE"
        );
        if (Number(count.total) <= 1) throw error('不能撤销最后一名信息收集管理员', 409, 'LAST_ADMIN_REQUIRED');
      }
      await connection.execute(
        `UPDATE collection_app_grants SET status='revoked', revoked_by_person_id=?, revoked_at=CURRENT_TIMESTAMP WHERE grant_id=?`,
        [identity.personId, Number(grantId)]
      );
      await connection.execute(
        `UPDATE collection_sessions SET revoked_at=CURRENT_TIMESTAMP
          WHERE surface='admin' AND person_id=? AND revoked_at IS NULL`,
        [grant.person_id]
      );
      await connection.commit();
      await audit(req, { actorPersonId: identity.personId, actionCode: 'grant.revoke', entityType: 'grant', entityId: String(grantId), ownerDepartmentId: grant.scope_department_id, detail: { roleCode: grant.role_code, scopeKey: grant.scope_key } });
      return { grantId: Number(grantId), status: 'revoked' };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  async function listForms(identity) {
    const params = [];
    let scope = '';
    if (!isCollectionAdmin(identity)) {
      const departments = [...new Set(identity.grants.filter(g => g.roleCode === 'collection_designer').map(g => Number(g.scopeDepartmentId)))];
      if (departments.length === 0) return [];
      scope = `WHERE f.owner_department_id IN (${departments.map(() => '?').join(',')})`;
      params.push(...departments);
    }
    const [rows] = await pool.execute(
      `SELECT f.*, d.name AS owner_department_name
         FROM collection_forms f JOIN departments d ON d.id=f.owner_department_id
        ${scope} ORDER BY f.updated_at DESC`,
      params
    );
    return rows.map(publicForm);
  }

  async function createForm(identity, payload, req) {
    const ownerDepartmentId = Number(payload.ownerDepartmentId);
    if (!Number.isInteger(ownerDepartmentId) || !canManageDepartment(identity, ownerDepartmentId)) {
      throw error('无权为该部门创建表单', 403, 'FORM_SCOPE_DENIED');
    }
    const name = compactText(payload.name, 100);
    if (!name) throw error('请填写表单名称', 422, 'FORM_NAME_REQUIRED');
    const formId = id();
    const code = `COL-F-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${formId.slice(0, 8).toUpperCase()}`;
    const checked = validateFormSchema({ title: name, description: payload.description || '', sections: [] });
    await pool.execute(
      `INSERT INTO collection_forms
        (form_id, form_code, name, description, owner_department_id, status, draft_schema, created_by_person_id, updated_by_person_id)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [formId, code, name, compactText(payload.description, 1000) || null, ownerDepartmentId, JSON.stringify(checked.schema), identity.personId, identity.personId]
    );
    await audit(req, { actorPersonId: identity.personId, actionCode: 'form.create', entityType: 'form', entityId: formId, ownerDepartmentId, detail: { formCode: code } });
    return publicForm({
      form_id: formId, form_code: code, name, description: compactText(payload.description, 1000), owner_department_id: ownerDepartmentId,
      status: 'draft', draft_schema: checked.schema, draft_revision: 1, created_by_person_id: identity.personId, created_at: new Date(), updated_at: new Date()
    });
  }

  async function saveDraft(identity, formId, payload, req) {
    const current = await getForm(formId, identity);
    if (current.status === 'archived') throw error('已归档表单不能修改', 409, 'FORM_ARCHIVED');
    const expectedRevision = Number(payload.expectedRevision);
    if (expectedRevision !== Number(current.draft_revision)) throw error('表单已被其他人员修改，请刷新后核对', 409, 'REVISION_CONFLICT');
    const checked = validateFormSchema(payload.schema || {});
    if (checked.errors.length) throw error('表单结构不符合要求', 422, 'FORM_SCHEMA_INVALID', checked.errors);
    const name = checked.schema.title;
    const result = await pool.execute(
      `UPDATE collection_forms
          SET name=?, description=?, draft_schema=?, draft_revision=draft_revision+1,
              updated_by_person_id=?, updated_at=CURRENT_TIMESTAMP
        WHERE form_id=? AND draft_revision=?`,
      [name, checked.schema.description || null, JSON.stringify(checked.schema), identity.personId, formId, expectedRevision]
    );
    if (Number(result[0].affectedRows) !== 1) throw error('表单已被其他人员修改，请刷新后核对', 409, 'REVISION_CONFLICT');
    await audit(req, { actorPersonId: identity.personId, actionCode: 'form.save_draft', entityType: 'form', entityId: formId, ownerDepartmentId: current.owner_department_id, detail: { revision: expectedRevision + 1 } });
    return { formId, draftRevision: expectedRevision + 1, schema: checked.schema };
  }

  async function listFormVersions(identity, formId) {
    await getForm(formId, identity);
    const [rows] = await pool.execute(
      `SELECT v.form_version_id, v.version_no, v.schema_digest, v.created_at, p.person_name AS created_by_name
         FROM collection_form_versions v JOIN person p ON p.person_id=v.created_by_person_id
        WHERE v.form_id=? ORDER BY v.version_no DESC`,
      [formId]
    );
    return rows.map(row => ({ formVersionId: row.form_version_id, versionNo: Number(row.version_no), schemaDigest: row.schema_digest, createdAt: row.created_at, createdByName: row.created_by_name }));
  }

  async function resolveTargets(audience, connection = pool) {
    const includeAllActive = Boolean(audience?.includeAllActive);
    const departmentIds = [...new Set((audience?.departmentIds || []).map(Number).filter(Number.isInteger))];
    const personIds = [...new Set((audience?.personIds || []).map(Number).filter(Number.isInteger))];
    if (!includeAllActive && departmentIds.length === 0 && personIds.length === 0) throw error('请至少选择一个填报部门或人员', 422, 'TASK_AUDIENCE_REQUIRED');
    if (departmentIds.length) {
      const [selectedDepartments] = await connection.execute(
        `SELECT id FROM departments WHERE status='active' AND id IN (${departmentIds.map(() => '?').join(',')})`,
        departmentIds
      );
      const activeIds = new Set(selectedDepartments.map(row => Number(row.id)));
      const unavailableIds = departmentIds.filter(departmentId => !activeIds.has(departmentId));
      if (unavailableIds.length) throw error('填报范围包含不存在或已停用的部门', 422, 'TASK_DEPARTMENT_UNAVAILABLE', { departmentIds: unavailableIds });
    }
    const conditions = [];
    const params = [];
    if (includeAllActive) conditions.push('1=1');
    if (departmentIds.length) {
      conditions.push(`p.current_department_id IN (${departmentIds.map(() => '?').join(',')})`);
      params.push(...departmentIds);
    }
    if (personIds.length) {
      conditions.push(`p.person_id IN (${personIds.map(() => '?').join(',')})`);
      params.push(...personIds);
    }
    const [rows] = await connection.execute(
      `SELECT p.person_id, p.employee_no, p.person_name, p.current_department_id,
              p.status AS person_status, p.employment_status,
              d.name AS department_name,
              EXISTS(SELECT 1 FROM user_accounts a WHERE a.person_id=p.person_id) AS account_exists,
              EXISTS(SELECT 1 FROM user_accounts a WHERE a.person_id=p.person_id AND a.account_status='active') AS account_available
         FROM person p
         LEFT JOIN departments d ON d.id=p.current_department_id
        WHERE (${conditions.join(' OR ')})
        ORDER BY d.sort_order, d.name, p.employee_no`,
      params
    );
    const eligible = [];
    const ineligible = [];
    for (const row of rows) {
      const source = personIds.includes(Number(row.person_id)) ? 'person' : includeAllActive ? 'all' : 'department';
      const item = {
        personId: Number(row.person_id), employeeNo: row.employee_no, personName: row.person_name,
        departmentId: row.current_department_id == null ? null : Number(row.current_department_id),
        departmentName: row.department_name || null, source
      };
      if (row.person_status === 'active' && row.employment_status === 'active' && row.account_available) eligible.push(item);
      else ineligible.push({ ...item, reason: !row.account_exists ? '未开户' : !row.account_available ? '账号不可用' : '人员状态不可用' });
    }
    const foundPersonIds = new Set(rows.map(row => Number(row.person_id)));
    for (const personId of personIds) {
      if (!foundPersonIds.has(personId)) ineligible.push({ personId, employeeNo: null, personName: null, departmentId: null, departmentName: null, source: 'person', reason: '人员不存在' });
    }
    return { audience: { includeAllActive, departmentIds, personIds }, eligible, ineligible };
  }

  async function previewTargets(identity, payload) {
    if (!identity.grants.length) throw error('当前账号没有发布权限', 403, 'ADMIN_ACCESS_DENIED');
    const result = await resolveTargets(payload.audience || payload);
    return { eligibleCount: result.eligible.length, ineligibleCount: result.ineligible.length, ...result };
  }

  async function publishTask(identity, payload, req) {
    const formId = String(payload.formId || '');
    const taskName = compactText(payload.name, 150);
    const openAt = sqlDate(payload.openAt);
    const dueAt = sqlDate(payload.dueAt);
    const clientRequestId = String(payload.clientRequestId || '');
    if (!taskName || !openAt || !/^[0-9a-f-]{36}$/i.test(clientRequestId)) throw error('任务名称、开始时间或请求标识不正确', 422, 'TASK_INPUT_INVALID');
    if (dueAt && new Date(dueAt).getTime() <= new Date(openAt).getTime()) throw error('截止时间必须晚于开始时间', 422, 'TASK_DATE_INVALID');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('SELECT form_id FROM collection_forms WHERE form_id=? FOR UPDATE', [formId]);
      const form = await getForm(formId, identity, connection);
      const checked = validateFormSchema(parseJson(form.draft_schema, {}), { publish: true });
      if (checked.errors.length) throw error('表单尚不符合发布要求', 422, 'FORM_SCHEMA_INVALID', checked.errors);
      const targets = await resolveTargets(payload.audience, connection);
      if (targets.eligible.length === 0) throw error('没有可填报的有效账号', 422, 'TASK_NO_ELIGIBLE_TARGET');
      const [[existing]] = await connection.execute(
        'SELECT task_id FROM collection_tasks WHERE created_by_person_id=? AND client_request_id=?',
        [identity.personId, clientRequestId]
      );
      if (existing) {
        await connection.rollback();
        return publicTask(await getTask(existing.task_id, identity));
      }
      const schemaDigest = digestSchema(checked.schema);
      let [[version]] = await connection.execute(
        'SELECT * FROM collection_form_versions WHERE form_id=? AND schema_digest=? ORDER BY version_no DESC LIMIT 1',
        [formId, schemaDigest]
      );
      if (!version) {
        const [[versionNumber]] = await connection.execute('SELECT COALESCE(MAX(version_no),0)+1 AS next_no FROM collection_form_versions WHERE form_id=? FOR UPDATE', [formId]);
        const versionId = id();
        await connection.execute(
          `INSERT INTO collection_form_versions (form_version_id, form_id, version_no, schema_json, schema_digest, created_by_person_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [versionId, formId, Number(versionNumber.next_no), JSON.stringify(checked.schema), schemaDigest, identity.personId]
        );
        version = { form_version_id: versionId };
      }
      const taskId = id();
      const taskCode = `COL-T-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${taskId.slice(0, 8).toUpperCase()}`;
      const initialStatus = new Date(openAt).getTime() > Date.now() ? 'scheduled' : 'open';
      await connection.execute(
        `INSERT INTO collection_tasks
          (task_id, task_code, form_id, form_version_id, name, owner_department_id, status, open_at, due_at,
           audience_definition, client_request_id, created_by_person_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [taskId, taskCode, formId, version.form_version_id, taskName, form.owner_department_id, initialStatus, openAt, dueAt, JSON.stringify(targets.audience), clientRequestId, identity.personId]
      );
      for (const target of targets.eligible) {
        await connection.execute(
          `INSERT INTO collection_task_targets
            (task_id, person_id, employee_no_snapshot, person_name_snapshot, department_id_snapshot, department_name_snapshot, target_source)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [taskId, target.personId, target.employeeNo, target.personName, target.departmentId, target.departmentName, target.source]
        );
      }
      await connection.execute("UPDATE collection_forms SET status='active' WHERE form_id=?", [formId]);
      await connection.commit();
      await audit(req, { actorPersonId: identity.personId, actionCode: 'task.publish', entityType: 'task', entityId: taskId, ownerDepartmentId: form.owner_department_id, detail: { taskCode, targetCount: targets.eligible.length, ineligibleCount: targets.ineligible.length } });
      return { taskId, taskCode, status: initialStatus, targetCount: targets.eligible.length, ineligible: targets.ineligible };
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        const [[existing]] = await pool.execute('SELECT * FROM collection_tasks WHERE created_by_person_id=? AND client_request_id=?', [identity.personId, clientRequestId]);
        if (existing) return publicTask(existing);
      }
      throw err;
    } finally {
      connection.release();
    }
  }

  async function reconcileTaskStatuses() {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [opening] = await connection.execute("SELECT task_id, owner_department_id FROM collection_tasks WHERE status='scheduled' AND open_at<=NOW() FOR UPDATE");
      const [closing] = await connection.execute("SELECT task_id, owner_department_id FROM collection_tasks WHERE status IN ('scheduled','open') AND due_at IS NOT NULL AND due_at<=NOW() FOR UPDATE");
      if (opening.length) await connection.execute("UPDATE collection_tasks SET status='open' WHERE status='scheduled' AND open_at<=NOW()");
      if (closing.length) await connection.execute("UPDATE collection_tasks SET status='closed', closed_at=COALESCE(closed_at,NOW()) WHERE status IN ('scheduled','open') AND due_at IS NOT NULL AND due_at<=NOW()");
      for (const task of opening) {
        if (closing.some(item => item.task_id === task.task_id)) continue;
        await connection.execute(
          `INSERT INTO collection_audit_events
            (actor_person_id, action_code, entity_type, entity_id, owner_department_id, request_id, detail_json)
           VALUES (NULL, 'task.auto_open', 'task', ?, ?, ?, JSON_OBJECT('source','system_clock'))`,
          [task.task_id, task.owner_department_id, id()]
        );
      }
      for (const task of closing) {
        await connection.execute(
          `INSERT INTO collection_audit_events
            (actor_person_id, action_code, entity_type, entity_id, owner_department_id, request_id, detail_json)
           VALUES (NULL, 'task.auto_close', 'task', ?, ?, ?, JSON_OBJECT('source','system_clock'))`,
          [task.task_id, task.owner_department_id, id()]
        );
      }
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  async function listTasks(identity) {
    await reconcileTaskStatuses();
    const params = [];
    let scope = '';
    if (!isCollectionAdmin(identity)) {
      const departments = [...new Set(identity.grants.filter(g => g.roleCode === 'collection_designer').map(g => Number(g.scopeDepartmentId)))];
      if (!departments.length) return [];
      scope = `WHERE t.owner_department_id IN (${departments.map(() => '?').join(',')})`;
      params.push(...departments);
    }
    const [rows] = await pool.execute(
      `SELECT t.*, f.name AS form_name, d.name AS owner_department_name,
              COUNT(DISTINCT tt.target_id) AS target_count,
              SUM(CASE WHEN s.status='submitted' THEN 1 ELSE 0 END) AS submitted_count,
              SUM(CASE WHEN s.status='draft' THEN 1 ELSE 0 END) AS draft_count
         FROM collection_tasks t
         JOIN collection_forms f ON f.form_id=t.form_id
         JOIN departments d ON d.id=t.owner_department_id
         LEFT JOIN collection_task_targets tt ON tt.task_id=t.task_id
         LEFT JOIN collection_submissions s ON s.task_id=t.task_id AND s.person_id=tt.person_id
        ${scope}
        GROUP BY t.task_id, f.name, d.name
        ORDER BY t.created_at DESC`,
      params
    );
    return rows.map(publicTask);
  }

  async function actOnTask(identity, taskId, action, payload, req) {
    const task = await getTask(taskId, identity);
    const current = taskStatus(task);
    let sql;
    let params;
    if (action === 'close') {
      if (current === 'cancelled') throw error('已取消任务不能关闭', 409, 'TASK_CANCELLED');
      sql = "UPDATE collection_tasks SET status='closed', closed_at=CURRENT_TIMESTAMP WHERE task_id=?";
      params = [taskId];
    } else if (action === 'cancel') {
      if (current === 'cancelled') return publicTask(task);
      sql = "UPDATE collection_tasks SET status='cancelled', cancelled_at=CURRENT_TIMESTAMP WHERE task_id=?";
      params = [taskId];
    } else if (action === 'extend') {
      const dueAt = sqlDate(payload.dueAt);
      if (!dueAt || new Date(dueAt).getTime() <= Date.now()) throw error('新的截止时间必须晚于当前时间', 422, 'TASK_DATE_INVALID');
      if (current === 'cancelled') throw error('已取消任务不能延期', 409, 'TASK_CANCELLED');
      sql = "UPDATE collection_tasks SET due_at=?, status=IF(open_at<=NOW(),'open','scheduled'), closed_at=NULL WHERE task_id=?";
      params = [dueAt, taskId];
    } else if (action === 'reopen') {
      const dueAt = payload.dueAt ? sqlDate(payload.dueAt) : null;
      if (task.status === 'cancelled') throw error('已取消任务不能重新开放', 409, 'TASK_CANCELLED');
      if (dueAt && new Date(dueAt).getTime() <= Date.now()) throw error('新的截止时间必须晚于当前时间', 422, 'TASK_DATE_INVALID');
      sql = "UPDATE collection_tasks SET status=IF(open_at<=NOW(),'open','scheduled'), due_at=?, closed_at=NULL WHERE task_id=?";
      params = [dueAt, taskId];
    } else throw error('不支持的任务动作', 404, 'TASK_ACTION_NOT_FOUND');
    await pool.execute(sql, params);
    await audit(req, { actorPersonId: identity.personId, actionCode: `task.${action}`, entityType: 'task', entityId: taskId, ownerDepartmentId: task.owner_department_id, detail: action === 'extend' || action === 'reopen' ? { dueAt: payload.dueAt || null } : {} });
    return publicTask(await getTask(taskId, identity));
  }

  async function taskDashboard(identity, taskId, req) {
    const task = await getTask(taskId, identity);
    const [rows] = await pool.execute(
      `SELECT tt.person_id, tt.employee_no_snapshot, tt.person_name_snapshot,
              tt.department_id_snapshot, tt.department_name_snapshot,
              s.submission_id, s.status AS submission_status, s.answers_json, s.last_saved_at, s.submitted_at, s.submit_count
         FROM collection_task_targets tt
         LEFT JOIN collection_submissions s ON s.task_id=tt.task_id AND s.person_id=tt.person_id
        WHERE tt.task_id=? ORDER BY tt.department_name_snapshot, tt.employee_no_snapshot`,
      [taskId]
    );
    const [[version]] = await pool.execute('SELECT schema_json FROM collection_form_versions WHERE form_version_id=?', [task.form_version_id]);
    const schema = parseJson(version.schema_json, {});
    const counts = { total: rows.length, notStarted: 0, draft: 0, submitted: 0, overdue: 0 };
    const nowClosed = taskStatus(task) === 'closed';
    for (const row of rows) {
      if (row.submission_status === 'submitted') counts.submitted += 1;
      else if (row.submission_status === 'draft') counts.draft += 1;
      else if (nowClosed) counts.overdue += 1;
      else counts.notStarted += 1;
    }
    const statistics = aggregateStatistics(schema, rows.filter(row => row.submission_status === 'submitted').map(row => parseJson(row.answers_json, {})));
    await audit(req, { actorPersonId: identity.personId, actionCode: 'task.dashboard_view', entityType: 'task', entityId: taskId, ownerDepartmentId: task.owner_department_id, detail: { rowCount: rows.length } });
    return { task: publicTask({ ...task, target_count: rows.length, submitted_count: counts.submitted, draft_count: counts.draft }), counts, statistics };
  }

  async function listSubmissions(identity, taskId, req) {
    const task = await getTask(taskId, identity);
    const [rows] = await pool.execute(
      `SELECT tt.person_id, tt.employee_no_snapshot, tt.person_name_snapshot, tt.department_id_snapshot, tt.department_name_snapshot,
              s.submission_id, s.status, s.answers_json, s.revision, s.last_saved_at, s.submitted_at, s.submit_count
         FROM collection_task_targets tt
         LEFT JOIN collection_submissions s ON s.task_id=tt.task_id AND s.person_id=tt.person_id
        WHERE tt.task_id=? ORDER BY tt.department_name_snapshot, tt.employee_no_snapshot`,
      [taskId]
    );
    await audit(req, { actorPersonId: identity.personId, actionCode: 'submission.list', entityType: 'task', entityId: taskId, ownerDepartmentId: task.owner_department_id, detail: { rowCount: rows.length } });
    return rows.map(row => ({
      personId: Number(row.person_id), employeeNo: row.employee_no_snapshot, personName: row.person_name_snapshot,
      departmentId: row.department_id_snapshot == null ? null : Number(row.department_id_snapshot), departmentName: row.department_name_snapshot,
      submissionId: row.submission_id || null, status: row.status || (taskStatus(task) === 'closed' ? 'overdue' : 'not_started'),
      answers: parseJson(row.answers_json, {}), revision: row.revision == null ? 0 : Number(row.revision),
      lastSavedAt: row.last_saved_at, submittedAt: row.submitted_at, submitCount: Number(row.submit_count || 0)
    }));
  }

  async function listRespondentTasks(identity) {
    await reconcileTaskStatuses();
    const [rows] = await pool.execute(
      `SELECT t.*, f.name AS form_name, d.name AS owner_department_name,
              s.submission_id, s.status AS submission_status, s.revision, s.last_saved_at, s.submitted_at
         FROM collection_task_targets tt
         JOIN collection_tasks t ON t.task_id=tt.task_id
         JOIN collection_forms f ON f.form_id=t.form_id
         JOIN departments d ON d.id=t.owner_department_id
         LEFT JOIN collection_submissions s ON s.task_id=t.task_id AND s.person_id=tt.person_id
        WHERE tt.person_id=?
        ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, t.due_at, t.created_at DESC`,
      [identity.personId]
    );
    return rows.map(row => ({
      ...publicTask(row), submissionId: row.submission_id || null,
      submissionStatus: row.submission_status || (taskStatus(row) === 'closed' ? 'overdue' : 'not_started'),
      revision: row.revision == null ? 0 : Number(row.revision), lastSavedAt: row.last_saved_at, submittedAt: row.submitted_at
    }));
  }

  async function respondentTask(identity, taskId, { createDraft = false } = {}) {
    await reconcileTaskStatuses();
    const [rows] = await pool.execute(
      `SELECT t.*, f.name AS form_name, d.name AS owner_department_name, v.schema_json,
              s.submission_id, s.status AS submission_status, s.answers_json, s.revision, s.last_saved_at, s.submitted_at, s.submit_count
         FROM collection_task_targets tt
         JOIN collection_tasks t ON t.task_id=tt.task_id
         JOIN collection_forms f ON f.form_id=t.form_id
         JOIN departments d ON d.id=t.owner_department_id
         JOIN collection_form_versions v ON v.form_version_id=t.form_version_id
         LEFT JOIN collection_submissions s ON s.task_id=t.task_id AND s.person_id=tt.person_id
        WHERE tt.person_id=? AND tt.task_id=? LIMIT 1`,
      [identity.personId, taskId]
    );
    const row = rows[0];
    if (!row) throw error('未找到分配给本人的收集任务', 404, 'TASK_NOT_ASSIGNED');
    if (createDraft && !row.submission_id) {
      const submissionId = id();
      try {
        await pool.execute(
          `INSERT INTO collection_submissions (submission_id, task_id, person_id, answers_json)
           VALUES (?, ?, ?, JSON_OBJECT())`,
          [submissionId, taskId, identity.personId]
        );
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
      return respondentTask(identity, taskId);
    }
    const [fileRows] = row.submission_id
      ? await pool.execute(
        `SELECT file_id, field_key, original_name, mime_type, size_bytes, scan_status, uploaded_at
           FROM collection_files WHERE submission_id=? AND status='active' ORDER BY uploaded_at`,
        [row.submission_id]
      )
      : [[]];
    return {
      task: publicTask(row),
      schema: parseJson(row.schema_json, {}),
      submission: row.submission_id ? {
        submissionId: row.submission_id, status: row.submission_status, answers: parseJson(row.answers_json, {}),
        revision: Number(row.revision), lastSavedAt: row.last_saved_at, submittedAt: row.submitted_at, submitCount: Number(row.submit_count)
      } : null,
      files: fileRows.map(publicFile)
    };
  }

  async function saveSubmission(identity, taskId, payload, req) {
    const context = await respondentTask(identity, taskId, { createDraft: true });
    if (context.task.status !== 'open') throw error('当前任务不在填报时间内', 409, 'TASK_NOT_OPEN');
    if (context.submission.status === 'submitted') throw error('请先选择“修改已提交内容”', 409, 'SUBMISSION_ALREADY_SUBMITTED');
    const expectedRevision = Number(payload.expectedRevision);
    if (expectedRevision !== context.submission.revision) throw error('答卷已在其他页面更新，请刷新后核对', 409, 'REVISION_CONFLICT');
    const filesByField = groupFiles(context.files);
    const checked = validateAnswers(context.schema, payload.answers, { filesByField });
    if (checked.errors.length) throw error('答卷内容不符合要求', 422, 'ANSWERS_INVALID', checked.errors);
    const canonicalAnswers = await canonicalizeEntityAnswers(pool, context.schema, checked.answers);
    const result = await pool.execute(
      `UPDATE collection_submissions SET answers_json=?, revision=revision+1, last_saved_at=CURRENT_TIMESTAMP
        WHERE submission_id=? AND revision=? AND status='draft'`,
      [JSON.stringify(canonicalAnswers), context.submission.submissionId, expectedRevision]
    );
    if (Number(result[0].affectedRows) !== 1) throw error('答卷已在其他页面更新，请刷新后核对', 409, 'REVISION_CONFLICT');
    await audit(req, { actorPersonId: identity.personId, actionCode: 'submission.save', entityType: 'submission', entityId: context.submission.submissionId, ownerDepartmentId: context.task.ownerDepartmentId, detail: { revision: expectedRevision + 1 } });
    return { submissionId: context.submission.submissionId, status: 'draft', revision: expectedRevision + 1, savedAt: new Date().toISOString() };
  }

  async function submitSubmission(identity, taskId, payload, req) {
    const context = await respondentTask(identity, taskId, { createDraft: true });
    if (context.task.status !== 'open') throw error('当前任务不在填报时间内', 409, 'TASK_NOT_OPEN');
    if (context.submission.status === 'submitted') return context.submission;
    const expectedRevision = Number(payload.expectedRevision);
    if (expectedRevision !== context.submission.revision) throw error('答卷已在其他页面更新，请刷新后核对', 409, 'REVISION_CONFLICT');
    const checked = validateAnswers(context.schema, context.submission.answers, { submit: true, filesByField: groupFiles(context.files) });
    if (checked.errors.length) throw error('请先补齐必填内容', 422, 'SUBMISSION_INCOMPLETE', checked.errors);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[locked]] = await connection.execute('SELECT * FROM collection_submissions WHERE submission_id=? FOR UPDATE', [context.submission.submissionId]);
      if (Number(locked.revision) !== expectedRevision) throw error('答卷已在其他页面更新，请刷新后核对', 409, 'REVISION_CONFLICT');
      if (locked.status === 'submitted') {
        await connection.rollback();
        return context.submission;
      }
      const submitNo = Number(locked.submit_count) + 1;
      await connection.execute(
        `INSERT INTO collection_submission_versions
          (submission_version_id, submission_id, submit_no, answers_json, submitted_by_person_id)
         VALUES (?, ?, ?, ?, ?)`,
        [id(), locked.submission_id, submitNo, locked.answers_json, identity.personId]
      );
      await connection.execute(
        `UPDATE collection_submissions SET status='submitted', submit_count=?, submitted_at=CURRENT_TIMESTAMP,
          revision=revision+1, last_saved_at=CURRENT_TIMESTAMP WHERE submission_id=?`,
        [submitNo, locked.submission_id]
      );
      await connection.commit();
      await audit(req, { actorPersonId: identity.personId, actionCode: 'submission.submit', entityType: 'submission', entityId: locked.submission_id, ownerDepartmentId: context.task.ownerDepartmentId, detail: { submitNo, revision: expectedRevision + 1 } });
      return { submissionId: locked.submission_id, status: 'submitted', revision: expectedRevision + 1, submitCount: submitNo };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  async function editSubmission(identity, taskId, payload, req) {
    const context = await respondentTask(identity, taskId);
    if (context.task.status !== 'open') throw error('当前任务不在填报时间内', 409, 'TASK_NOT_OPEN');
    if (!context.submission || context.submission.status !== 'submitted') throw error('当前答卷不是已提交状态', 409, 'SUBMISSION_NOT_SUBMITTED');
    const expectedRevision = Number(payload.expectedRevision);
    const result = await pool.execute(
      `UPDATE collection_submissions SET status='draft', revision=revision+1, last_saved_at=CURRENT_TIMESTAMP
        WHERE submission_id=? AND revision=? AND status='submitted'`,
      [context.submission.submissionId, expectedRevision]
    );
    if (Number(result[0].affectedRows) !== 1) throw error('答卷已在其他页面更新，请刷新后核对', 409, 'REVISION_CONFLICT');
    await audit(req, { actorPersonId: identity.personId, actionCode: 'submission.edit', entityType: 'submission', entityId: context.submission.submissionId, ownerDepartmentId: context.task.ownerDepartmentId, detail: { revision: expectedRevision + 1 } });
    return { submissionId: context.submission.submissionId, status: 'draft', revision: expectedRevision + 1 };
  }

  async function submissionForFile(identity, taskId, fieldKey) {
    const context = await respondentTask(identity, taskId, { createDraft: true });
    if (context.task.status !== 'open') throw error('当前任务不在填报时间内', 409, 'TASK_NOT_OPEN');
    if (context.submission.status !== 'draft') throw error('请先选择“修改已提交内容”', 409, 'SUBMISSION_ALREADY_SUBMITTED');
    const field = context.schema.sections.flatMap(section => section.fields).find(item => item.fieldKey === fieldKey);
    if (!field || field.type !== 'attachment') throw error('未找到附件字段', 404, 'ATTACHMENT_FIELD_NOT_FOUND');
    return { context, field };
  }

  async function registerFile(identity, taskId, fieldKey, file, req) {
    const { context, field } = await submissionForFile(identity, taskId, fieldKey);
    const fileId = id();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[lockedTask]] = await connection.execute('SELECT status, open_at, due_at FROM collection_tasks WHERE task_id=? FOR UPDATE', [taskId]);
      const [[lockedSubmission]] = await connection.execute('SELECT status FROM collection_submissions WHERE submission_id=? FOR UPDATE', [context.submission.submissionId]);
      if (!lockedTask || taskStatus(lockedTask) !== 'open' || lockedSubmission?.status !== 'draft') throw error('当前答卷不能上传附件', 409, 'ATTACHMENT_LOCKED');
      const [[fieldTotal]] = await connection.execute(
        "SELECT COUNT(*) AS total FROM collection_files WHERE submission_id=? AND field_key=? AND status='active'",
        [context.submission.submissionId, fieldKey]
      );
      if (Number(fieldTotal.total) >= field.validation.maxFiles) throw error(`该字段最多上传 ${field.validation.maxFiles} 个附件`, 422, 'ATTACHMENT_COUNT_LIMIT');
      const [[taskTotal]] = await connection.execute(
        `SELECT COALESCE(SUM(cf.size_bytes),0) AS total
           FROM collection_files cf JOIN collection_submissions s ON s.submission_id=cf.submission_id
          WHERE s.task_id=? AND cf.status='active'`,
        [taskId]
      );
      if (Number(taskTotal.total) + Number(file.sizeBytes) > file.maxTaskBytes) throw error('该任务的附件总量已达到上限', 422, 'ATTACHMENT_TASK_QUOTA');
      await connection.execute(
        `INSERT INTO collection_files
          (file_id, submission_id, field_key, storage_key, original_name, extension, mime_type, size_bytes, sha256, scan_status, uploaded_by_person_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [fileId, context.submission.submissionId, fieldKey, file.storageKey, file.originalName, file.extension, file.mimeType, file.sizeBytes, file.sha256, file.scanStatus, identity.personId]
      );
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
    await audit(req, { actorPersonId: identity.personId, actionCode: 'file.upload', entityType: 'file', entityId: fileId, ownerDepartmentId: context.task.ownerDepartmentId, detail: { fieldKey, sizeBytes: file.sizeBytes, scanStatus: file.scanStatus } });
    return { fileId, fieldKey, originalName: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, scanStatus: file.scanStatus };
  }

  async function removeFile(identity, taskId, fileId, expectedRevision, req) {
    const context = await respondentTask(identity, taskId);
    if (context.task.status !== 'open' || context.submission?.status !== 'draft') throw error('当前答卷不能删除附件', 409, 'ATTACHMENT_LOCKED');
    if (Number(expectedRevision) !== context.submission.revision) throw error('答卷已在其他页面更新，请刷新后核对', 409, 'REVISION_CONFLICT');
    const connection = await pool.getConnection();
    let file;
    try {
      await connection.beginTransaction();
      [[file]] = await connection.execute(
        `SELECT cf.* FROM collection_files cf
          WHERE cf.file_id=? AND cf.submission_id=? AND cf.status='active' FOR UPDATE`,
        [fileId, context.submission.submissionId]
      );
      if (!file) throw error('未找到附件', 404, 'FILE_NOT_FOUND');
      const [[submission]] = await connection.execute('SELECT answers_json, revision FROM collection_submissions WHERE submission_id=? FOR UPDATE', [context.submission.submissionId]);
      if (Number(submission.revision) !== Number(expectedRevision)) throw error('答卷已在其他页面更新，请刷新后核对', 409, 'REVISION_CONFLICT');
      const answers = { ...parseJson(submission.answers_json, {}) };
      if (Array.isArray(answers[file.field_key])) answers[file.field_key] = answers[file.field_key].filter(value => value !== fileId);
      await connection.execute("UPDATE collection_files SET status='removed', removed_at=CURRENT_TIMESTAMP WHERE file_id=?", [fileId]);
      await connection.execute('UPDATE collection_submissions SET answers_json=?, revision=revision+1, last_saved_at=CURRENT_TIMESTAMP WHERE submission_id=?', [JSON.stringify(answers), context.submission.submissionId]);
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
    await audit(req, { actorPersonId: identity.personId, actionCode: 'file.remove', entityType: 'file', entityId: fileId, ownerDepartmentId: context.task.ownerDepartmentId, detail: { fieldKey: file.field_key } });
    return { fileId, status: 'removed', storageKey: file.storage_key, revision: Number(expectedRevision) + 1 };
  }

  async function getRespondentFile(identity, fileId) {
    const [[row]] = await pool.execute(
      `SELECT cf.*, s.task_id, t.owner_department_id
         FROM collection_files cf
         JOIN collection_submissions s ON s.submission_id=cf.submission_id
         JOIN collection_task_targets tt ON tt.task_id=s.task_id AND tt.person_id=s.person_id
         JOIN collection_tasks t ON t.task_id=s.task_id
        WHERE cf.file_id=? AND cf.status='active' AND s.person_id=? LIMIT 1`,
      [fileId, identity.personId]
    );
    if (!row) throw error('未找到附件', 404, 'FILE_NOT_FOUND');
    return row;
  }

  async function getAdminFile(identity, fileId) {
    const [[row]] = await pool.execute(
      `SELECT cf.*, s.task_id, t.owner_department_id
         FROM collection_files cf
         JOIN collection_submissions s ON s.submission_id=cf.submission_id
         JOIN collection_tasks t ON t.task_id=s.task_id
        WHERE cf.file_id=? AND cf.status='active' LIMIT 1`,
      [fileId]
    );
    if (!row) throw error('未找到附件', 404, 'FILE_NOT_FOUND');
    if (!canManageDepartment(identity, row.owner_department_id)) throw error('无权下载该附件', 403, 'FILE_SCOPE_DENIED');
    return row;
  }

  return {
    actOnTask, createForm, editSubmission, getAdminFile, getForm, getRespondentFile, getTask,
    grantAccess, listDirectory, listFormVersions, listForms, listGrants, listRespondentTasks,
    listSubmissions, listTasks, previewTargets, publishTask, reconcileTaskStatuses, registerFile,
    removeFile, respondentTask, revokeGrant, saveDraft, saveSubmission, submissionForFile,
    submitSubmission, taskDashboard
  };
}

function groupFiles(files) {
  const result = {};
  for (const file of files || []) {
    if (!result[file.fieldKey]) result[file.fieldKey] = [];
    result[file.fieldKey].push({ fileId: file.fileId });
  }
  return result;
}

function publicFile(row) {
  return {
    fileId: row.file_id, fieldKey: row.field_key, originalName: row.original_name,
    mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), scanStatus: row.scan_status,
    uploadedAt: row.uploaded_at
  };
}

function aggregateStatistics(schema, answerRows) {
  const result = [];
  for (const field of schema.sections.flatMap(section => section.fields)) {
    const values = answerRows.map(answers => answers[field.fieldKey]).filter(value => value !== null && value !== undefined && value !== '');
    if (['single_choice', 'multiple_choice', 'boolean'].includes(field.type)) {
      const labels = new Map(field.options.map(option => [option.optionKey, option.label]));
      const counts = {};
      for (const value of values) {
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
          const label = field.type === 'boolean' ? (item ? '是' : '否') : labels.get(item) || String(item);
          counts[label] = (counts[label] || 0) + 1;
        }
      }
      result.push({ fieldKey: field.fieldKey, label: field.label, type: field.type, answered: values.length, counts });
    } else if (['integer', 'decimal'].includes(field.type)) {
      const numbers = values.filter(value => typeof value === 'number' && Number.isFinite(value));
      result.push({
        fieldKey: field.fieldKey, label: field.label, type: field.type, answered: numbers.length,
        min: numbers.length ? Math.min(...numbers) : null, max: numbers.length ? Math.max(...numbers) : null,
        average: numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null
      });
    } else result.push({ fieldKey: field.fieldKey, label: field.label, type: field.type, answered: values.length });
  }
  return result;
}

module.exports = { aggregateStatistics, error, makeService, parseJson, publicFile, publicForm, publicTask, taskStatus };
