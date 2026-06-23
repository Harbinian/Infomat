const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  requireAuth,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync,
  getDepartmentByIdAsync,
  getUserByIdAsync,
  hashPassword
} = require('../auth');

const PROJECT_WIDE_ROLES = new Set(['admin', 'it_lead']);
const REVIEW_ROLES = new Set(['admin', 'it_lead', 'reviewer', 'owner', 'data_quality', 'decision_group']);
const DEPT_CREATE_ROLES = new Set(['submitter', 'business_contact']);
const FIELD_STATUSES = new Set(['suggested', 'business_confirmed', 'data_governed', 'published', 'retired']);
const DRAFT_STATUSES = new Set(['draft', 'submitted', 'under_review', 'needs_changes', 'approved', 'published', 'rejected']);
const CLASSIFICATION_STATUSES = new Set(['unclassified', 'candidate', 'confirmed']);
const BASIC_USER_ROLES = new Set(['submitter', 'owner', 'reviewer', 'admin']);

function runAction(res, action) {
  return action().catch(error => {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json(error.payload || { error: error.message });
    }
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  });
}

function httpError(statusCode, message, payload) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.payload = payload || { error: message };
  return error;
}

function text(value) {
  return String(value || '').trim();
}

function optionalText(value) {
  const cleaned = text(value);
  return cleaned || null;
}

function boolInt(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jsonArray(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => text(item)).filter(Boolean));
  const single = text(value);
  return single ? JSON.stringify([single]) : JSON.stringify([]);
}

async function currentRoleCodes(req) {
  const rows = await getUserRoleCodesAsync(req.session.userId, req.session.userRole);
  const codes = new Set((rows || []).map(row => row.code || row.role_code).filter(Boolean));
  if (req.session.userRole) codes.add(req.session.userRole);
  return codes;
}

async function currentPermSet(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet || new Set();
}

function hasRole(roleCodes, allowed) {
  return Array.from(roleCodes).some(code => allowed.has(code));
}

async function canWorkAcrossDepartments(req, roleCodes) {
  const perms = await currentPermSet(req);
  return perms.has('*:*') || perms.has('admin:access') || hasRole(roleCodes, PROJECT_WIDE_ROLES);
}

async function authorizedDepartmentIds(req, roleCodes) {
  if (await canWorkAcrossDepartments(req, roleCodes)) return null;
  const ids = new Set();
  if (req.session.departmentId) ids.add(Number(req.session.departmentId));
  db.prepare('SELECT department_id FROM user_dept_roles WHERE user_id=?')
    .all(req.session.userId)
    .forEach(row => {
      if (row.department_id) ids.add(Number(row.department_id));
    });
  return ids;
}

function departmentName(departmentId) {
  if (!departmentId) return '';
  const row = db.prepare('SELECT name FROM departments WHERE id=?').get(departmentId);
  return row && row.name || '';
}

function ensureDepartmentExists(departmentId) {
  if (!departmentId) return false;
  return Boolean(db.prepare('SELECT id FROM departments WHERE id=?').get(departmentId));
}

function uniqueDepartmentCode(preferredCode, identityDepartmentId) {
  const base = text(preferredCode) || `MYSQL_DEPT_${identityDepartmentId}`;
  if (!db.prepare('SELECT id FROM departments WHERE code=?').get(base)) return base;
  const fallback = `MYSQL_DEPT_${identityDepartmentId}`;
  if (!db.prepare('SELECT id FROM departments WHERE code=?').get(fallback)) return fallback;
  let suffix = 2;
  while (db.prepare('SELECT id FROM departments WHERE code=?').get(`${fallback}_${suffix}`)) suffix += 1;
  return `${fallback}_${suffix}`;
}

function sameIdentityDepartment(localDepartment, identityDepartment, externalId) {
  if (!localDepartment || !identityDepartment) return false;
  const identityName = text(identityDepartment.name);
  const identityCode = text(identityDepartment.code);
  if (text(localDepartment.source_system) === 'MYSQL_IDENTITY' && text(localDepartment.external_id) === externalId) return true;
  if (!identityName || text(localDepartment.name) !== identityName) return false;
  return !identityCode || text(localDepartment.code) === identityCode;
}

async function ensureLocalDepartment(departmentId) {
  if (!departmentId) return null;
  const numericId = Number(departmentId);
  const localById = db.prepare('SELECT id, name, code, source_system, external_id FROM departments WHERE id=?').get(numericId);
  const identityDepartment = await getDepartmentByIdAsync(numericId);
  if (!identityDepartment || !text(identityDepartment.name)) return localById ? localById.id : null;

  const externalId = String(numericId);
  if (sameIdentityDepartment(localById, identityDepartment, externalId)) return localById.id;

  const identityName = text(identityDepartment.name);
  const identityCode = text(identityDepartment.code);
  const byExternalId = db.prepare(`
    SELECT id, name, code, source_system, external_id
    FROM departments
    WHERE source_system='MYSQL_IDENTITY' AND external_id=?
  `).get(externalId);
  if (byExternalId) {
    db.prepare('UPDATE departments SET name=?, status=? WHERE id=?').run(identityName, 'active', byExternalId.id);
    return byExternalId.id;
  }

  if (identityCode) {
    const byCode = db.prepare('SELECT id, name, code, source_system, external_id FROM departments WHERE code=?').get(identityCode);
    if (sameIdentityDepartment(byCode, identityDepartment, externalId)) return byCode.id;
  }

  const code = uniqueDepartmentCode(identityCode, numericId);
  const columns = localById
    ? '(name, code, path, department_type, source_system, external_id, status)'
    : '(id, name, code, path, department_type, source_system, external_id, status)';
  const placeholders = localById
    ? "(?, ?, ?, '其他', 'MYSQL_IDENTITY', ?, 'active')"
    : "(?, ?, ?, ?, '其他', 'MYSQL_IDENTITY', ?, 'active')";
  const params = localById ? [
    identityName,
    code,
    `/mysql-identity/${numericId}/`,
    externalId
  ] : [
    numericId,
    identityName,
    code,
    `/mysql-identity/${numericId}/`,
    externalId
  ];

  return db.prepare(`INSERT INTO departments ${columns} VALUES ${placeholders}`).run(...params).lastInsertRowid;
}

function uniqueEmployeeNo(preferredEmployeeNo, identityUserId) {
  const base = text(preferredEmployeeNo) || `MYSQL_USER_${identityUserId}`;
  if (!db.prepare('SELECT id FROM users WHERE employee_no=?').get(base)) return base;
  const fallback = `MYSQL_USER_${identityUserId}`;
  if (!db.prepare('SELECT id FROM users WHERE employee_no=?').get(fallback)) return fallback;
  let suffix = 2;
  while (db.prepare('SELECT id FROM users WHERE employee_no=?').get(`${fallback}_${suffix}`)) suffix += 1;
  return `${fallback}_${suffix}`;
}

function sameIdentityUser(localUser, identityUser) {
  if (!localUser || !identityUser) return false;
  const identityEmployeeNo = text(identityUser.employee_no);
  if (identityEmployeeNo) return text(localUser.employee_no) === identityEmployeeNo;
  return text(localUser.name) === text(identityUser.name);
}

function compatibleUserRole(identityUser, sessionRole) {
  const identityRole = text(identityUser && identityUser.role);
  if (BASIC_USER_ROLES.has(identityRole)) return identityRole;
  const fallbackRole = text(sessionRole);
  return BASIC_USER_ROLES.has(fallbackRole) ? fallbackRole : 'submitter';
}

function syncLocalIdentityUser(userId, identityUser, departmentId, role) {
  db.prepare(`
    UPDATE users
    SET name=?, department_id=?, post=?, role=?
    WHERE id=?
  `).run(
    text(identityUser && identityUser.name) || `MySQL 用户 ${userId}`,
    departmentId || null,
    optionalText(identityUser && identityUser.post),
    role,
    userId
  );
  return userId;
}

async function ensureLocalUser(req, departmentId) {
  if (!req.session || !req.session.userId) return null;
  const userId = Number(req.session.userId);
  const identityUser = await getUserByIdAsync(userId);
  const localById = db.prepare('SELECT id, name, employee_no, department_id FROM users WHERE id=?').get(userId);
  const name = text(identityUser && identityUser.name) || text(req.session.userName) || `MySQL 用户 ${userId}`;
  const preferredEmployeeNo = text(identityUser && identityUser.employee_no) || `MYSQL_USER_${userId}`;
  const role = compatibleUserRole(identityUser, req.session.userRole);

  if (sameIdentityUser(localById, identityUser)) {
    return syncLocalIdentityUser(localById.id, { ...identityUser, name }, departmentId, role);
  }

  const byEmployeeNo = db.prepare('SELECT id, name, employee_no, department_id FROM users WHERE employee_no=?').get(preferredEmployeeNo);
  if (byEmployeeNo) {
    return syncLocalIdentityUser(byEmployeeNo.id, { ...identityUser, name }, departmentId, role);
  }

  const employeeNo = uniqueEmployeeNo(preferredEmployeeNo, userId);
  const columns = localById
    ? '(name, employee_no, department_id, post, role, password_hash)'
    : '(id, name, employee_no, department_id, post, role, password_hash)';
  const placeholders = localById ? '(?, ?, ?, ?, ?, ?)' : '(?, ?, ?, ?, ?, ?, ?)';
  const params = localById ? [
    name,
    employeeNo,
    departmentId || null,
    optionalText(identityUser && identityUser.post),
    role,
    hashPassword('mysql-identity-disabled')
  ] : [
    userId,
    name,
    employeeNo,
    departmentId || null,
    optionalText(identityUser && identityUser.post),
    role,
    hashPassword('mysql-identity-disabled')
  ];

  return db.prepare(`INSERT INTO users ${columns} VALUES ${placeholders}`).run(...params).lastInsertRowid;
}

function draftRequiredErrors(body) {
  const required = [
    ['process_name', '流程名称不能为空'],
    ['reason', '为什么新增不能为空'],
    ['basis_type', '依据类型不能为空'],
    ['basis_description', '依据说明不能为空']
  ];
  const errors = required
    .filter(([field]) => !text(body[field]))
    .map(([field, message]) => ({ field, message }));
  if (!Object.prototype.hasOwnProperty.call(body, 'involves_other_departments')) {
    errors.push({ field: 'involves_other_departments', message: '请说明是否涉及其他部门' });
  }
  return errors;
}

function publicDraft(row) {
  if (!row) return null;
  return {
    ...row,
    related_departments: parseJsonArray(row.related_departments_json),
    involves_other_departments: Boolean(row.involves_other_departments)
  };
}

function loadDraft(id) {
  return publicDraft(db.prepare(`
    SELECT d.*, dept.name AS department_name, proxyDept.name AS proxy_department_name, creator.name AS created_by_name
    FROM process_design_drafts d
    LEFT JOIN departments dept ON dept.id=d.department_id
    LEFT JOIN departments proxyDept ON proxyDept.id=d.proxy_department_id
    LEFT JOIN users creator ON creator.id=d.created_by
    WHERE d.id=?
  `).get(id));
}

function loadDraftByStep(stepId) {
  return publicDraft(db.prepare(`
    SELECT d.*
    FROM process_design_steps s
    JOIN process_design_drafts d ON d.id=s.draft_id
    WHERE s.id=?
  `).get(stepId));
}

function loadDraftByForm(formId) {
  return publicDraft(db.prepare(`
    SELECT d.*
    FROM process_design_forms f
    JOIN process_design_drafts d ON d.id=f.draft_id
    WHERE f.id=?
  `).get(formId));
}

function loadDraftByField(fieldId) {
  return publicDraft(db.prepare(`
    SELECT d.*
    FROM process_design_form_fields ff
    JOIN process_design_forms f ON f.id=ff.form_id
    JOIN process_design_drafts d ON d.id=f.draft_id
    WHERE ff.id=?
  `).get(fieldId));
}

function loadDraftByEvidence(evidenceId) {
  return publicDraft(db.prepare(`
    SELECT d.*
    FROM process_design_evidence e
    JOIN process_design_drafts d ON d.id=e.draft_id
    WHERE e.id=?
  `).get(evidenceId));
}

function loadSteps(draftId) {
  return db.prepare('SELECT * FROM process_design_steps WHERE draft_id=? ORDER BY sort_order, id').all(draftId);
}

function loadForms(draftId) {
  const forms = db.prepare('SELECT * FROM process_design_forms WHERE draft_id=? ORDER BY id').all(draftId);
  const fields = db.prepare('SELECT * FROM process_design_form_fields WHERE form_id=? ORDER BY sort_order, id');
  return forms.map(form => ({ ...form, fields: fields.all(form.id) }));
}

function loadEvidence(draftId) {
  return db.prepare('SELECT * FROM process_design_evidence WHERE draft_id=? ORDER BY id').all(draftId);
}

function loadEvents(draftId) {
  return db.prepare(`
    SELECT e.*, u.name AS actor_user_name
    FROM process_design_events e
    LEFT JOIN users u ON u.id=e.actor_user_id
    WHERE e.draft_id=?
    ORDER BY e.id
  `).all(draftId).map(row => ({
    ...row,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null
  }));
}

function addEvent(draftId, eventType, actorUserId, note, payload) {
  db.prepare(`
    INSERT INTO process_design_events (draft_id, event_type, actor_user_id, note, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(draftId, eventType, actorUserId || null, optionalText(note), payload ? JSON.stringify(payload) : null);
}

function evidenceMaturity(payload) {
  const evidenceType = text(payload.evidence_type);
  const description = text(payload.description);
  if (evidenceType === '暂无证据') {
    return text(payload.missing_reason) && text(payload.expected_provider) && text(payload.expected_at)
      ? '发布前需补'
      : '可保存草稿';
  }
  if (!evidenceType || !description) return '可保存草稿';
  if (!text(payload.source_name) && !text(payload.source_anchor)) return '可提交审核';
  if (text(payload.source_name) && text(payload.source_anchor) && (text(payload.confirmer) || text(payload.record_time))) {
    return '可支撑发布';
  }
  return '发布前需补';
}

function draftCounts(draftId) {
  const steps = db.prepare('SELECT COUNT(*) AS count FROM process_design_steps WHERE draft_id=?').get(draftId).count;
  const forms = db.prepare('SELECT COUNT(*) AS count FROM process_design_forms WHERE draft_id=?').get(draftId).count;
  const fields = db.prepare(`
    SELECT COUNT(*) AS count
    FROM process_design_form_fields ff
    JOIN process_design_forms f ON f.id=ff.form_id
    WHERE f.draft_id=?
  `).get(draftId).count;
  const evidence = db.prepare('SELECT COUNT(*) AS count FROM process_design_evidence WHERE draft_id=?').get(draftId).count;
  const publishableEvidence = db.prepare(`
    SELECT COUNT(*) AS count
    FROM process_design_evidence
    WHERE draft_id=? AND maturity='可支撑发布'
  `).get(draftId).count;
  const risks = buildRisks(draftId).length;
  return { steps, forms, fields, evidence, publishableEvidence, risks };
}

function outcomeForDraft(draft) {
  const counts = draftCounts(draft.id);
  const formed = [];
  if (draft.process_name) formed.push('1 条流程草稿');
  if (counts.steps) formed.push(`${counts.steps} 个实际步骤`);
  if (counts.forms) formed.push(`${counts.forms} 个在线表单`);
  if (counts.fields) formed.push(`${counts.fields} 个字段草稿`);
  if (counts.evidence) formed.push(`${counts.evidence} 条证据说明`);
  if (draft.status === 'published') formed.push('1 个发布版本');

  const missing = publishValidationDetails(draft, { relaxed: true });
  const current = draft.status === 'published'
    ? '当前内容已经发布为数据库流程地图版本'
    : draft.status === 'submitted'
      ? '当前内容可以等待审核或继续补充材料'
      : '当前内容可以保存草稿或提交部门内审';
  const next = draft.status === 'published'
    ? '查看成果预览'
    : missing.length
      ? '继续补齐发布前缺项'
      : '提交审核或发布';

  return {
    formed: formed.length ? `已形成 ${formed.join('、')}` : '已形成 0 条治理资产',
    current,
    missing,
    next,
    counts
  };
}

function buildRisks(draftId) {
  const risks = [];
  const draft = loadDraft(draftId);
  if (!draft) return risks;
  if (!text(draft.l1_name) || !text(draft.l2_name)) {
    risks.push({
      object_type: 'process',
      object_id: draft.id,
      message: '还没说明这个流程属于哪类工作。',
      status: 'open'
    });
  }
  loadSteps(draftId).forEach(step => {
    if (!text(step.output_result)) {
      risks.push({
        object_type: 'step',
        object_id: step.id,
        message: '这一步做完后没有写清会产生什么结果。',
        status: 'open'
      });
    }
    if (step.need_confirmation && !text(step.related_departments)) {
      risks.push({
        object_type: 'step',
        object_id: step.id,
        message: '这一步需要别人确认，但还没有指定确认部门。',
        status: 'open'
      });
    }
  });
  loadForms(draftId).forEach(form => {
    if (!text(form.archive_rule)) {
      risks.push({
        object_type: 'form',
        object_id: form.id,
        message: '表单没有归档规则。',
        status: 'open'
      });
    }
    form.fields.forEach(field => {
      if (field.field_type === '枚举' && !text(field.enum_options)) {
        risks.push({
          object_type: 'field',
          object_id: field.id,
          message: '这个字段要从固定选项里选，但选项还没列出来。',
          status: 'open'
        });
      }
      if (!text(field.data_object)) {
        risks.push({
          object_type: 'field',
          object_id: field.id,
          message: '这个字段还没有说明属于哪个数据对象。',
          status: 'open'
        });
      }
    });
  });
  loadEvidence(draftId).forEach(evidence => {
    if (evidence.maturity !== '可支撑发布') {
      risks.push({
        object_type: 'evidence',
        object_id: evidence.id,
        message: '这个依据还不够支撑正式发布。',
        status: 'open'
      });
    }
  });
  const storedRisks = db.prepare(`
    SELECT object_type, object_id, message, status
    FROM process_design_risks
    WHERE draft_id=? AND status NOT IN ('confirmed','accepted')
    ORDER BY id
  `).all(draftId);
  return [...risks, ...storedRisks];
}

function publishValidationDetails(draft, options = {}) {
  const details = [];
  if (!text(draft.l1_name)) details.push('发布前还需确认 L1。');
  if (!text(draft.l2_name)) details.push('发布前还需确认 L2。');
  if (!text(draft.l3_name)) details.push('发布前还需确认 L3。');
  if (draft.l1_status === 'candidate' || draft.l2_status === 'candidate') {
    details.push('候选 L1/L2 未复核前不能作为正式能力结构发布。');
  }
  if (!options.relaxed) {
    if (draft.l1_status !== 'confirmed') details.push('L1 必须由审核人确认。');
    if (draft.l2_status !== 'confirmed') details.push('L2 必须由审核人确认。');
  }

  const steps = loadSteps(draft.id);
  if (steps.length === 0) details.push('发布前至少需要 1 个实际步骤。');
  if (steps.some(step => !text(step.output_result))) details.push('发布前每个步骤都要写清输出结果。');

  const forms = loadForms(draft.id);
  const fields = forms.flatMap(form => form.fields);
  if (fields.length === 0) details.push('发布前至少需要 1 个字段。');
  if (forms.some(form => !text(form.archive_rule))) details.push('发布前在线表单需要归档规则。');
  if (fields.some(field => field.field_type === '枚举' && !text(field.enum_options))) {
    details.push('发布前枚举字段需要列出固定选项。');
  }

  const evidence = loadEvidence(draft.id);
  if (evidence.length === 0) details.push('发布前至少需要 1 条证据。');
  if (evidence.length > 0 && !evidence.some(item => text(item.source_anchor))) {
    details.push('发布前还需补 1 条来源锚点。');
  }
  if (!evidence.some(item => item.maturity === '可支撑发布')) {
    details.push('发布前至少需要 1 条可支撑发布的证据。');
  }
  return Array.from(new Set(details));
}

function versionContent(draft) {
  return {
    draft,
    steps: loadSteps(draft.id),
    forms: loadForms(draft.id),
    evidence: loadEvidence(draft.id)
  };
}

function activeSnapshot() {
  return db.prepare(`
    SELECT *
    FROM process_governance_snapshots
    WHERE status='active'
    ORDER BY imported_at DESC, id DESC
    LIMIT 1
  `).get();
}

function projectPublishedVersionToProcessMap(draft, version) {
  const snapshot = activeSnapshot();
  if (!snapshot) return;
  const steps = loadSteps(draft.id);
  const sourceFile = `process_design_versions:${version.id}`;
  const l3Key = `process-design:${version.id}:l3`;

  db.prepare(`
    INSERT OR IGNORE INTO process_mapping_records
      (mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, l2_name, l3_name, source_file, status)
    VALUES (?, 'l3', ?, ?, ?, ?, ?, ?, 'published')
  `).run(l3Key, snapshot.id, snapshot.id, draft.department_name, draft.l2_name, draft.l3_name, sourceFile);
  const l3Record = db.prepare('SELECT id FROM process_mapping_records WHERE mapping_key=?').get(l3Key);

  steps.forEach((step, index) => {
    const a1Code = text(step.a1_code) || `PD-${draft.id}-A1-${String(index + 1).padStart(3, '0')}`;
    db.prepare('UPDATE process_design_steps SET a1_code=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(a1Code, step.id);
    const a1ItemId = db.prepare(`
      INSERT INTO process_a1_items
        (snapshot_id, a1_code, dept_name, l3_name, behavior, execution_role, approval_type,
         input_source_dept, output_target_dept, suggested_systems, verification_note, source_file)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.id,
      a1Code,
      draft.department_name,
      draft.l3_name,
      step.step_name,
      step.actor_role || null,
      step.need_confirmation ? '需确认' : '记录',
      step.input_materials || null,
      step.output_result || null,
      JSON.stringify([]),
      '由新增流程治理线发布',
      sourceFile
    ).lastInsertRowid;
    db.prepare(`
      INSERT OR IGNORE INTO process_mapping_records
        (mapping_key, record_type, first_snapshot_id, latest_snapshot_id, parent_record_id, latest_a1_item_id,
         dept_name, l2_name, l3_name, a1_code, behavior, execution_role, approval_type,
         input_source_dept, output_target_dept, suggested_systems, verification_note, source_file, status)
      VALUES (?, 'a1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
    `).run(
      `process-design:${version.id}:step:${step.id}`,
      snapshot.id,
      snapshot.id,
      l3Record && l3Record.id || null,
      a1ItemId,
      draft.department_name,
      draft.l2_name,
      draft.l3_name,
      a1Code,
      step.step_name,
      step.actor_role || null,
      step.need_confirmation ? '需确认' : '记录',
      step.input_materials || null,
      step.output_result || null,
      JSON.stringify([]),
      '由新增流程治理线发布',
      sourceFile
    );
  });
}

async function assertCanViewDraft(req, draft) {
  if (!draft) throw httpError(404, '流程草稿不存在');
  const roleCodes = await currentRoleCodes(req);
  if (await canWorkAcrossDepartments(req, roleCodes)) return roleCodes;
  if (Number(draft.created_by || 0) === Number(req.session.userId)) return roleCodes;
  const deptIds = await authorizedDepartmentIds(req, roleCodes);
  if (deptIds && deptIds.has(Number(draft.department_id))) return roleCodes;
  throw httpError(403, '无权查看该流程草稿');
}

async function assertCanEditDraft(req, draft) {
  const roleCodes = await assertCanViewDraft(req, draft);
  if (draft.status === 'published') throw httpError(409, '已发布流程不能直接修改草稿');
  if (await canWorkAcrossDepartments(req, roleCodes)) return roleCodes;
  if (Number(draft.created_by || 0) === Number(req.session.userId)) return roleCodes;
  if (hasRole(roleCodes, new Set([...DEPT_CREATE_ROLES, ...REVIEW_ROLES]))) return roleCodes;
  throw httpError(403, '无权维护该流程草稿');
}

async function assertCanReview(req, draft) {
  const roleCodes = await assertCanViewDraft(req, draft);
  if (await canWorkAcrossDepartments(req, roleCodes) || hasRole(roleCodes, REVIEW_ROLES)) return roleCodes;
  throw httpError(403, '无权审核该流程草稿');
}

function sendDraftDetail(res, draftId) {
  const draft = loadDraft(draftId);
  if (!draft) return res.status(404).json({ error: '流程草稿不存在' });
  return res.json({
    draft,
    steps: loadSteps(draftId),
    forms: loadForms(draftId),
    evidence: loadEvidence(draftId),
    risks: buildRisks(draftId),
    reviewTasks: db.prepare('SELECT * FROM process_design_review_tasks WHERE draft_id=? ORDER BY id').all(draftId),
    events: loadEvents(draftId),
    outcome: outcomeForDraft(draft)
  });
}

router.get('/summary', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await currentRoleCodes(req);
  const params = [];
  let whereSql = 'WHERE 1=1';
  let draftWhereSql = 'WHERE 1=1';
  if (!await canWorkAcrossDepartments(req, roleCodes)) {
    const ids = await authorizedDepartmentIds(req, roleCodes);
    const deptIds = Array.from(ids || []);
    if (deptIds.length === 0) {
      return res.json({ summary: { totalDrafts: 0, publishedVersions: 0, byStatus: {} }, drafts: [] });
    }
    whereSql += ` AND department_id IN (${deptIds.map(() => '?').join(',')})`;
    draftWhereSql += ` AND d.department_id IN (${deptIds.map(() => '?').join(',')})`;
    params.push(...deptIds);
  }
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM process_design_drafts
    ${whereSql}
    GROUP BY status
  `).all(...params);
  const byStatus = {};
  rows.forEach(row => { byStatus[row.status] = row.count; });
  const totalDrafts = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const publishedVersions = db.prepare(`
    SELECT COUNT(*) AS count
    FROM process_design_versions v
    JOIN process_design_drafts d ON d.id=v.draft_id
    ${draftWhereSql}
  `).get(...params).count;
  const drafts = db.prepare(`
    SELECT d.id, d.process_name, d.status, d.l1_name, d.l2_name, d.l3_name, dept.name AS department_name, d.updated_at
    FROM process_design_drafts d
    LEFT JOIN departments dept ON dept.id=d.department_id
    ${draftWhereSql}
    ORDER BY d.updated_at DESC, d.id DESC
    LIMIT 20
  `).all(...params);
  res.json({ summary: { totalDrafts, publishedVersions, byStatus }, drafts });
}));

router.post('/drafts', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await currentRoleCodes(req);
  const errors = draftRequiredErrors(req.body || {});
  const canCrossDept = await canWorkAcrossDepartments(req, roleCodes);
  const requestedDeptId = req.body.department_id ? Number(req.body.department_id) : null;
  const sessionDeptId = req.session.departmentId ? Number(req.session.departmentId) : null;
  const identityDeptId = requestedDeptId || sessionDeptId;
  const targetDeptId = await ensureLocalDepartment(identityDeptId);

  if (!identityDeptId && !canCrossDept) {
    throw httpError(400, '请先维护人员组织信息后再创建流程草稿');
  }
  if (!ensureDepartmentExists(targetDeptId)) {
    errors.push({ field: 'department_id', message: '所属部门不存在' });
  }
  if (!canCrossDept) {
    if (requestedDeptId && requestedDeptId !== sessionDeptId) {
      throw httpError(403, '普通填报人只能为本人部门创建流程');
    }
    const allowed = await authorizedDepartmentIds(req, roleCodes);
    if (!allowed || !allowed.has(Number(identityDeptId))) {
      throw httpError(403, '无权为该部门创建流程');
    }
    if (!hasRole(roleCodes, new Set([...DEPT_CREATE_ROLES, ...REVIEW_ROLES]))) {
      throw httpError(403, '无权创建流程草稿');
    }
  } else if (requestedDeptId && sessionDeptId && requestedDeptId !== sessionDeptId && !text(req.body.proxy_reason)) {
    errors.push({ field: 'proxy_reason', message: '管理员或信息化负责人代建时必须填写代建原因' });
  }

  if (errors.length) throw httpError(422, '校验失败', { error: '校验失败', details: errors });
  const createdBy = await ensureLocalUser(req, targetDeptId);

  const info = db.prepare(`
    INSERT INTO process_design_drafts
      (process_name, reason, basis_type, basis_description, involves_other_departments,
       related_departments_json, department_id, proxy_department_id, proxy_reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    text(req.body.process_name),
    text(req.body.reason),
    text(req.body.basis_type),
    text(req.body.basis_description),
    boolInt(req.body.involves_other_departments),
    jsonArray(req.body.related_departments),
    targetDeptId,
    requestedDeptId && sessionDeptId && requestedDeptId !== sessionDeptId ? sessionDeptId : null,
    optionalText(req.body.proxy_reason),
    createdBy
  );
  addEvent(info.lastInsertRowid, 'draft_created', createdBy, '已创建流程草稿');
  const draft = loadDraft(info.lastInsertRowid);
  res.status(201).json({ ...draft, outcome: outcomeForDraft(draft) });
}));

router.get('/drafts/:id', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraft(req.params.id);
  await assertCanViewDraft(req, draft);
  return sendDraftDetail(res, draft.id);
}));

router.put('/drafts/:id', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraft(req.params.id);
  await assertCanEditDraft(req, draft);
  const allowed = {
    process_name: text,
    reason: text,
    basis_type: text,
    basis_description: text,
    l1_name: optionalText,
    l2_name: optionalText,
    l3_name: optionalText,
    proxy_reason: optionalText
  };
  const sets = [];
  const params = [];
  Object.entries(allowed).forEach(([field, normalizer]) => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      sets.push(`${field}=?`);
      params.push(normalizer(req.body[field]));
    }
  });
  ['l1_status', 'l2_status'].forEach(field => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      const status = text(req.body[field]) || 'unclassified';
      if (!CLASSIFICATION_STATUSES.has(status)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field, message: '能力层级状态无效' }] });
      sets.push(`${field}=?`);
      params.push(status);
    }
  });
  if (Object.prototype.hasOwnProperty.call(req.body, 'involves_other_departments')) {
    sets.push('involves_other_departments=?');
    params.push(boolInt(req.body.involves_other_departments));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'related_departments')) {
    sets.push('related_departments_json=?');
    params.push(jsonArray(req.body.related_departments));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
    const status = text(req.body.status);
    if (!DRAFT_STATUSES.has(status)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'status', message: '草稿状态无效' }] });
    sets.push('status=?');
    params.push(status);
  }
  if (!sets.length) return res.json({ ...draft, outcome: outcomeForDraft(draft) });
  sets.push('updated_at=CURRENT_TIMESTAMP');
  db.prepare(`UPDATE process_design_drafts SET ${sets.join(', ')} WHERE id=?`).run(...params, draft.id);
  addEvent(draft.id, 'draft_updated', req.session.userId, '已更新流程草稿');
  const updated = loadDraft(draft.id);
  res.json({ ...updated, outcome: outcomeForDraft(updated) });
}));

router.post('/drafts/:id/steps', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraft(req.params.id);
  await assertCanEditDraft(req, draft);
  if (!text(req.body.step_name)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'step_name', message: '步骤名称不能为空' }] });
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_steps WHERE draft_id=?').get(draft.id).next_order;
  const info = db.prepare(`
    INSERT INTO process_design_steps
      (draft_id, step_name, actor_role, timing, input_materials, output_result, need_confirmation,
       related_departments, basis, sort_order, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    draft.id,
    text(req.body.step_name),
    optionalText(req.body.actor_role),
    optionalText(req.body.timing),
    optionalText(req.body.input_materials),
    optionalText(req.body.output_result),
    boolInt(req.body.need_confirmation),
    optionalText(req.body.related_departments),
    optionalText(req.body.basis),
    req.body.sort_order ? Number(req.body.sort_order) : nextOrder,
    req.session.userId
  );
  addEvent(draft.id, 'step_added', req.session.userId, `已补充步骤：${text(req.body.step_name)}`);
  res.status(201).json(db.prepare('SELECT * FROM process_design_steps WHERE id=?').get(info.lastInsertRowid));
}));

router.put('/steps/:id', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraftByStep(req.params.id);
  await assertCanEditDraft(req, draft);
  const fields = ['step_name', 'actor_role', 'timing', 'input_materials', 'output_result', 'related_departments', 'basis'];
  const sets = [];
  const params = [];
  fields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      sets.push(`${field}=?`);
      params.push(field === 'step_name' ? text(req.body[field]) : optionalText(req.body[field]));
    }
  });
  if (Object.prototype.hasOwnProperty.call(req.body, 'need_confirmation')) {
    sets.push('need_confirmation=?');
    params.push(boolInt(req.body.need_confirmation));
  }
  if (!sets.length) return res.json(db.prepare('SELECT * FROM process_design_steps WHERE id=?').get(req.params.id));
  sets.push('updated_at=CURRENT_TIMESTAMP');
  db.prepare(`UPDATE process_design_steps SET ${sets.join(', ')} WHERE id=?`).run(...params, req.params.id);
  addEvent(draft.id, 'step_updated', req.session.userId, '已更新实际步骤');
  res.json(db.prepare('SELECT * FROM process_design_steps WHERE id=?').get(req.params.id));
}));

router.post('/drafts/:id/forms', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraft(req.params.id);
  await assertCanEditDraft(req, draft);
  if (!text(req.body.form_name)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'form_name', message: '表单名称不能为空' }] });
  const stepId = req.body.step_id ? Number(req.body.step_id) : null;
  if (stepId && !db.prepare('SELECT id FROM process_design_steps WHERE id=? AND draft_id=?').get(stepId, draft.id)) {
    throw httpError(400, '表单关联的步骤不存在');
  }
  const info = db.prepare(`
    INSERT INTO process_design_forms (draft_id, step_id, form_name, description, archive_rule, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(draft.id, stepId, text(req.body.form_name), optionalText(req.body.description), optionalText(req.body.archive_rule), req.session.userId);
  addEvent(draft.id, 'form_added', req.session.userId, `已补充在线表单：${text(req.body.form_name)}`);
  res.status(201).json(db.prepare('SELECT * FROM process_design_forms WHERE id=?').get(info.lastInsertRowid));
}));

router.put('/forms/:id', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraftByForm(req.params.id);
  await assertCanEditDraft(req, draft);
  const fields = ['form_name', 'description', 'archive_rule', 'status'];
  const sets = [];
  const params = [];
  fields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      sets.push(`${field}=?`);
      params.push(field === 'form_name' || field === 'status' ? text(req.body[field]) : optionalText(req.body[field]));
    }
  });
  if (!sets.length) return res.json(db.prepare('SELECT * FROM process_design_forms WHERE id=?').get(req.params.id));
  sets.push('updated_at=CURRENT_TIMESTAMP');
  db.prepare(`UPDATE process_design_forms SET ${sets.join(', ')} WHERE id=?`).run(...params, req.params.id);
  addEvent(draft.id, 'form_updated', req.session.userId, '已更新在线表单');
  res.json(db.prepare('SELECT * FROM process_design_forms WHERE id=?').get(req.params.id));
}));

router.post('/forms/:id/fields', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraftByForm(req.params.id);
  await assertCanEditDraft(req, draft);
  if (!text(req.body.field_name_cn)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'field_name_cn', message: '中文字段名不能为空' }] });
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_form_fields WHERE form_id=?').get(req.params.id).next_order;
  const status = FIELD_STATUSES.has(text(req.body.status)) ? text(req.body.status) : 'suggested';
  const info = db.prepare(`
    INSERT INTO process_design_form_fields
      (form_id, field_name_cn, field_name_en, data_object, field_type, enum_options,
       evidence_note, status, sort_order, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id,
    text(req.body.field_name_cn),
    optionalText(req.body.field_name_en),
    optionalText(req.body.data_object),
    optionalText(req.body.field_type),
    optionalText(req.body.enum_options),
    optionalText(req.body.evidence_note),
    status,
    req.body.sort_order ? Number(req.body.sort_order) : nextOrder,
    req.session.userId
  );
  addEvent(draft.id, 'field_added', req.session.userId, `已补充字段：${text(req.body.field_name_cn)}`);
  res.status(201).json(db.prepare('SELECT * FROM process_design_form_fields WHERE id=?').get(info.lastInsertRowid));
}));

router.put('/form-fields/:id', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraftByField(req.params.id);
  await assertCanEditDraft(req, draft);
  const fields = ['field_name_cn', 'field_name_en', 'data_object', 'field_type', 'enum_options', 'evidence_note'];
  const sets = [];
  const params = [];
  fields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      sets.push(`${field}=?`);
      params.push(field === 'field_name_cn' ? text(req.body[field]) : optionalText(req.body[field]));
    }
  });
  if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
    const status = text(req.body.status);
    if (!FIELD_STATUSES.has(status)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'status', message: '字段状态无效' }] });
    sets.push('status=?');
    params.push(status);
  }
  if (!sets.length) return res.json(db.prepare('SELECT * FROM process_design_form_fields WHERE id=?').get(req.params.id));
  sets.push('updated_at=CURRENT_TIMESTAMP');
  db.prepare(`UPDATE process_design_form_fields SET ${sets.join(', ')} WHERE id=?`).run(...params, req.params.id);
  addEvent(draft.id, 'field_updated', req.session.userId, '已更新字段草稿');
  res.json(db.prepare('SELECT * FROM process_design_form_fields WHERE id=?').get(req.params.id));
}));

router.post('/drafts/:id/evidence', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraft(req.params.id);
  await assertCanEditDraft(req, draft);
  if (!text(req.body.evidence_type) || !text(req.body.description)) {
    throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'evidence', message: '证据类型和说明不能为空' }] });
  }
  const maturity = evidenceMaturity(req.body);
  const objectType = ['process', 'step', 'form', 'field'].includes(text(req.body.object_type)) ? text(req.body.object_type) : 'process';
  const info = db.prepare(`
    INSERT INTO process_design_evidence
      (draft_id, object_type, object_id, evidence_type, description, source_name, source_anchor,
       confirmer, record_time, missing_reason, expected_provider, expected_at, maturity, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    draft.id,
    objectType,
    req.body.object_id ? Number(req.body.object_id) : draft.id,
    text(req.body.evidence_type),
    text(req.body.description),
    optionalText(req.body.source_name),
    optionalText(req.body.source_anchor),
    optionalText(req.body.confirmer),
    optionalText(req.body.record_time),
    optionalText(req.body.missing_reason),
    optionalText(req.body.expected_provider),
    optionalText(req.body.expected_at),
    maturity,
    req.session.userId
  );
  addEvent(draft.id, 'evidence_added', req.session.userId, `已补充证据说明：${text(req.body.evidence_type)}`);
  res.status(201).json(db.prepare('SELECT * FROM process_design_evidence WHERE id=?').get(info.lastInsertRowid));
}));

router.put('/evidence/:id', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraftByEvidence(req.params.id);
  await assertCanEditDraft(req, draft);
  const current = db.prepare('SELECT * FROM process_design_evidence WHERE id=?').get(req.params.id);
  const merged = { ...current, ...(req.body || {}) };
  const fields = ['object_type', 'object_id', 'evidence_type', 'description', 'source_name', 'source_anchor', 'confirmer', 'record_time', 'missing_reason', 'expected_provider', 'expected_at'];
  const sets = [];
  const params = [];
  fields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      sets.push(`${field}=?`);
      params.push(field === 'object_id' ? (req.body[field] ? Number(req.body[field]) : null) : (field === 'object_type' || field === 'evidence_type' || field === 'description' ? text(req.body[field]) : optionalText(req.body[field])));
    }
  });
  sets.push('maturity=?');
  params.push(evidenceMaturity(merged));
  sets.push('updated_at=CURRENT_TIMESTAMP');
  db.prepare(`UPDATE process_design_evidence SET ${sets.join(', ')} WHERE id=?`).run(...params, req.params.id);
  addEvent(draft.id, 'evidence_updated', req.session.userId, '已更新证据说明');
  res.json(db.prepare('SELECT * FROM process_design_evidence WHERE id=?').get(req.params.id));
}));

router.get('/drafts/:id/risks', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraft(req.params.id);
  await assertCanViewDraft(req, draft);
  const items = buildRisks(draft.id);
  res.json({ summary: { total: items.length }, items });
}));

router.get('/drafts/:id/outcome-preview', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraft(req.params.id);
  await assertCanViewDraft(req, draft);
  res.json({ draft, outcome: outcomeForDraft(draft), counts: draftCounts(draft.id), risks: buildRisks(draft.id) });
}));

router.post('/drafts/:id/submit', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraft(req.params.id);
  await assertCanEditDraft(req, draft);
  const errors = draftRequiredErrors(draft);
  if (errors.length) throw httpError(422, '校验失败', { error: '校验失败', details: errors });
  db.prepare(`
    UPDATE process_design_drafts
    SET status='submitted', submitted_by=?, submitted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(req.session.userId, draft.id);
  const taskInfo = db.prepare(`
    INSERT INTO process_design_review_tasks (draft_id, task_type, assignee_role, created_by)
    VALUES (?, 'department_review', 'reviewer', ?)
  `).run(draft.id, req.session.userId);
  addEvent(draft.id, 'submitted', req.session.userId, optionalText(req.body.note) || '已提交审核');
  res.json({
    draft: loadDraft(draft.id),
    reviewTask: db.prepare('SELECT * FROM process_design_review_tasks WHERE id=?').get(taskInfo.lastInsertRowid),
    outcome: outcomeForDraft(loadDraft(draft.id))
  });
}));

router.post('/review-tasks/:id/decision', requireAuth, (req, res) => runAction(res, async () => {
  const task = db.prepare('SELECT * FROM process_design_review_tasks WHERE id=?').get(req.params.id);
  if (!task) throw httpError(404, '审核任务不存在');
  const draft = loadDraft(task.draft_id);
  await assertCanReview(req, draft);
  const decision = text(req.body.decision);
  const statusByDecision = { approve: 'approved', reject: 'rejected', needs_changes: 'needs_changes' };
  if (!statusByDecision[decision]) {
    throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'decision', message: '审核结论无效' }] });
  }
  db.prepare(`
    UPDATE process_design_review_tasks
    SET status=?, decision_note=?, decided_by=?, decided_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(statusByDecision[decision], optionalText(req.body.note), req.session.userId, task.id);
  db.prepare('UPDATE process_design_drafts SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(statusByDecision[decision], draft.id);
  addEvent(draft.id, `review_${decision}`, req.session.userId, optionalText(req.body.note) || '已处理审核任务');
  res.json({ draft: loadDraft(draft.id), reviewTask: db.prepare('SELECT * FROM process_design_review_tasks WHERE id=?').get(task.id) });
}));

router.post('/drafts/:id/publish', requireAuth, (req, res) => runAction(res, async () => {
  const draft = loadDraft(req.params.id);
  await assertCanReview(req, draft);
  const details = publishValidationDetails(draft);
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });

  const versionCount = db.prepare('SELECT COUNT(*) AS count FROM process_design_versions WHERE draft_id=?').get(draft.id).count;
  const versionNo = `PD-${draft.id}-v${versionCount + 1}`;
  let version;
  db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO process_design_versions
        (draft_id, version_no, department_id, l1_name, l2_name, l3_name, content_json, published_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      draft.id,
      versionNo,
      draft.department_id,
      draft.l1_name,
      draft.l2_name,
      draft.l3_name,
      JSON.stringify(versionContent(draft)),
      req.session.userId
    );
    db.prepare(`
      UPDATE process_design_drafts
      SET status='published', published_by=?, published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(req.session.userId, draft.id);
    version = db.prepare('SELECT * FROM process_design_versions WHERE id=?').get(info.lastInsertRowid);
    projectPublishedVersionToProcessMap(loadDraft(draft.id), version);
    addEvent(draft.id, 'published', req.session.userId, optionalText(req.body.note) || '已发布流程版本', { version_no: versionNo });
  })();

  const publishedDraft = loadDraft(draft.id);
  res.json({ draft: publishedDraft, version, outcome: outcomeForDraft(publishedDraft) });
}));

module.exports = router;
