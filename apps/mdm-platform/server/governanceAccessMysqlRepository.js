const {
  ACCESS_MODEL_VERSION,
  ROLE_GUIDES
} = require('./roleDefinitions');

const ACTIVE_ROLE_CODES = new Set(ROLE_GUIDES.map(role => role.code));
const DEPARTMENT_ROLE_CODES = new Set(['department_contact', 'department_mdm_reviewer']);
const GLOBAL_ROLE_CODES = new Set([
  'admin',
  'mdm_lead',
  'data_conflict_handler',
  'data_quality_auditor',
  'decision_group'
]);

async function rows(executor, sql, params = []) {
  const [result] = await executor.execute(sql, params);
  return Array.isArray(result) ? result : [];
}

async function first(executor, sql, params = []) {
  return (await rows(executor, sql, params))[0] || null;
}

function insertId(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.insertId || 0);
}

function affectedRows(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.affectedRows || 0);
}

function domainError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function assertDecisionSubjectScope(executor, payload = {}) {
  const {
    subjectDomain,
    subjectType,
    subjectId,
    subjectVersion,
    departmentId
  } = payload;
  if (subjectDomain === 'process' && subjectType === 'process_design_draft') {
    const draft = await first(executor, `
      SELECT id, department_id, planned_edition, related_departments_json
      FROM process_design_drafts
      WHERE id=?
    `, [subjectId]);
    if (!draft || text(draft.planned_edition || 'A') !== subjectVersion) {
      throw domainError(422, 'DECISION_SUBJECT_VERSION_INVALID', '流程草稿不存在或版本已经变化');
    }
    const involved = new Set([Number(draft.department_id)]);
    const relatedNames = jsonArray(draft.related_departments_json).map(name => text(name)).filter(Boolean);
    if (relatedNames.length) {
      const relatedDepartments = await rows(executor, `
        SELECT id FROM departments
        WHERE name IN (${relatedNames.map(() => '?').join(',')}) AND status='active'
      `, relatedNames);
      relatedDepartments.forEach(item => involved.add(Number(item.id)));
    }
    if (!involved.has(Number(departmentId))) {
      throw domainError(403, 'DECISION_SUBJECT_DEPARTMENT_FORBIDDEN', '当前部门不是该流程版本的责任部门');
    }
    return;
  }

  if (subjectDomain === 'data' && subjectType === 'mapping') {
    if (subjectVersion !== 'current') {
      throw domainError(422, 'DECISION_SUBJECT_VERSION_INVALID', '数据映射决定的版本必须为current');
    }
    const mapping = await first(executor, `
      SELECT id, owner_dept_id
      FROM mdm_mapping_records
      WHERE id=?
    `, [subjectId]);
    if (!mapping) throw domainError(422, 'DECISION_SUBJECT_NOT_FOUND', '数据映射不存在');
    const related = await rows(executor, `
      SELECT department_id
      FROM mdm_mapping_related_departments
      WHERE mapping_id=?
    `, [subjectId]);
    const involved = new Set([
      Number(mapping.owner_dept_id),
      ...related.map(item => Number(item.department_id))
    ]);
    if (!involved.has(Number(departmentId))) {
      throw domainError(403, 'DECISION_SUBJECT_DEPARTMENT_FORBIDDEN', '当前部门不是该数据映射的责任部门');
    }
    return;
  }

  if (subjectDomain === 'term' && subjectType === 'terminology_term') {
    if (subjectVersion !== 'current') {
      throw domainError(422, 'DECISION_SUBJECT_VERSION_INVALID', '术语决定的版本必须为current');
    }
    const term = await first(executor, `
      SELECT t.id, d.id AS department_id
      FROM terminology_terms t
      JOIN process_mapping_records r ON r.id=t.process_mapping_record_id
      JOIN departments d ON d.name=r.dept_name
      WHERE t.id=?
    `, [subjectId]);
    if (!term) throw domainError(422, 'DECISION_SUBJECT_NOT_FOUND', '术语或术语责任部门不存在');
    if (Number(term.department_id) !== Number(departmentId)) {
      throw domainError(403, 'DECISION_SUBJECT_DEPARTMENT_FORBIDDEN', '当前部门不是该术语的责任部门');
    }
    return;
  }

  throw domainError(422, 'INVALID_DECISION_SUBJECT', '不支持的治理决定对象');
}

function normalizeDate(value, fieldName, required = false) {
  const normalized = text(value);
  if (!normalized) {
    if (required) throw domainError(422, 'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED', `${fieldName}为必填`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw domainError(422, 'INVALID_EFFECTIVE_DATE', `${fieldName}必须使用YYYY-MM-DD格式`);
  }
  return normalized;
}

function validateRoleAssignmentInput(payload = {}, personDepartmentId) {
  const roleCode = text(payload.roleCode || payload.role_code);
  if (!ACTIVE_ROLE_CODES.has(roleCode)) {
    throw domainError(422, 'INVALID_MDM_ROLE', '只能授予固定的MDM工作角色');
  }
  const authorizationBasis = text(payload.authorizationBasis || payload.authorization_basis);
  if (!authorizationBasis) {
    throw domainError(422, 'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED', '角色授权依据为必填');
  }
  const effectiveFrom = normalizeDate(payload.effectiveFrom || payload.effective_from, '生效日期', true);
  const effectiveTo = normalizeDate(payload.effectiveTo || payload.effective_to, '失效日期');
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw domainError(422, 'INVALID_EFFECTIVE_PERIOD', '失效日期不能早于生效日期');
  }

  let scopeType;
  let scopeDepartmentId = null;
  if (DEPARTMENT_ROLE_CODES.has(roleCode)) {
    scopeType = 'department';
    scopeDepartmentId = Number(payload.scopeDepartmentId || payload.scope_department_id || personDepartmentId || 0);
    if (!scopeDepartmentId || scopeDepartmentId !== Number(personDepartmentId || 0)) {
      throw domainError(422, 'ROLE_SCOPE_DEPARTMENT_MISMATCH', '部门角色只能授权到人员所属部门');
    }
  } else if (GLOBAL_ROLE_CODES.has(roleCode)) {
    scopeType = 'global';
  } else {
    throw domainError(422, 'INVALID_MDM_ROLE_SCOPE', '角色范围不符合固定治理模型');
  }

  return {
    roleCode,
    scopeType,
    scopeDepartmentId,
    authorizationBasis,
    effectiveFrom,
    effectiveTo
  };
}

async function withTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function writeAccessEvent(executor, payload = {}) {
  await executor.execute(`
    INSERT INTO identity_access_events (
      event_type, actor_person_id, target_person_id, account_id,
      person_role_id, reason, payload_json, migration_batch_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    payload.eventType,
    payload.actorPersonId || null,
    payload.targetPersonId || null,
    payload.accountId || null,
    payload.personRoleId || null,
    payload.reason || null,
    payload.details ? JSON.stringify(payload.details) : null,
    payload.migrationBatchId || null
  ]);
}

async function getActiveDepartment(executor, departmentId) {
  return await first(executor, `
    SELECT id, name, code, final_responsible_person_id
    FROM departments
    WHERE id=? AND status='active'
  `, [departmentId]);
}

async function getAccountRecord(executor, personId) {
  return await first(executor, `
    SELECT p.person_id, p.employee_no, p.person_name, p.current_department_id,
           p.employment_status, p.status AS person_status,
           d.name AS department_name, d.status AS department_status,
           ua.account_id, ua.login_name, ua.account_status, ua.must_change_password,
           ua.auth_version, ua.last_login_at, ua.created_at, ua.updated_at
    FROM person p
    LEFT JOIN departments d ON d.id=p.current_department_id
    LEFT JOIN user_accounts ua ON ua.person_id=p.person_id
    WHERE p.person_id=?
  `, [personId]);
}

async function listRoleAssignments(executor, personId, includeHistory = true) {
  const statusClause = includeHistory ? '' : " AND pr.assignment_status='active'";
  return await rows(executor, `
    SELECT pr.person_role_id AS assignmentId,
           r.role_code AS roleCode,
           r.role_name AS roleName,
           r.role_group AS roleGroup,
           r.status AS roleStatus,
           pr.scope_type AS scopeType,
           pr.scope_department_id AS scopeDepartmentId,
           d.name AS scopeDepartmentName,
           pr.authorization_basis AS authorizationBasis,
           pr.effective_from AS effectiveFrom,
           pr.effective_to AS effectiveTo,
           pr.assignment_status AS status,
           pr.assigned_by_person_id AS assignedByPersonId,
           assigner.person_name AS assignedByPersonName,
           pr.revoked_by_person_id AS revokedByPersonId,
           revoker.person_name AS revokedByPersonName,
           pr.revoked_at AS revokedAt,
           pr.revocation_reason AS revocationReason,
           pr.created_at AS createdAt
    FROM person_roles pr
    JOIN roles r ON r.role_id=pr.role_id
    LEFT JOIN departments d ON d.id=pr.scope_department_id
    LEFT JOIN person assigner ON assigner.person_id=pr.assigned_by_person_id
    LEFT JOIN person revoker ON revoker.person_id=pr.revoked_by_person_id
    WHERE pr.person_id=?${statusClause}
    ORDER BY FIELD(pr.assignment_status, 'active', 'expired', 'revoked'), r.role_group, r.role_code
  `, [personId]);
}

async function countActiveAdmins(executor, excludedPersonId = null) {
  const params = [];
  let exclusion = '';
  if (excludedPersonId) {
    exclusion = ' AND p.person_id<>?';
    params.push(excludedPersonId);
  }
  const row = await first(executor, `
    SELECT COUNT(DISTINCT p.person_id) AS count
    FROM person p
    JOIN user_accounts ua ON ua.person_id=p.person_id
    JOIN person_roles pr ON pr.person_id=p.person_id
    JOIN roles r ON r.role_id=pr.role_id
    WHERE p.status='active'
      AND ua.account_status='active'
      AND r.role_code='admin'
      AND r.status='active'
      AND r.model_version=?
      AND pr.assignment_status='active'
      AND pr.authorization_basis IS NOT NULL
      AND pr.effective_from IS NOT NULL
      AND pr.effective_from<=CURRENT_DATE
      AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
      ${exclusion}
  `, [ACCESS_MODEL_VERSION, ...params]);
  return Number(row && row.count || 0);
}

async function assertAccountCanActivate(executor, personId) {
  const account = await getAccountRecord(executor, personId);
  if (!account || !account.account_id) {
    throw domainError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
  }
  if (account.person_status !== 'active') {
    throw domainError(422, 'PERSON_INACTIVE', '人员状态不是在职，不能启用账号');
  }
  if (!account.current_department_id || account.department_status !== 'active') {
    throw domainError(422, 'ACTIVE_DEPARTMENT_REQUIRED', '账号必须绑定有效部门');
  }
  const role = await first(executor, `
    SELECT pr.person_role_id
    FROM person_roles pr
    JOIN roles r ON r.role_id=pr.role_id
    WHERE pr.person_id=?
      AND r.status='active'
      AND r.model_version=?
      AND pr.assignment_status='active'
      AND pr.authorization_basis IS NOT NULL
      AND pr.effective_from IS NOT NULL
      AND pr.effective_from<=CURRENT_DATE
      AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
    LIMIT 1
  `, [personId, ACCESS_MODEL_VERSION]);
  if (!role) {
    throw domainError(
      422,
      'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED',
      '账号至少需要一个已生效且具备授权依据的MDM工作角色'
    );
  }
  return account;
}

async function grantRoleAssignment(executor, personId, assignment, actorPersonId) {
  const role = await first(executor, `
    SELECT role_id, role_code
    FROM roles
    WHERE role_code=? AND status='active' AND model_version=?
  `, [assignment.roleCode, ACCESS_MODEL_VERSION]);
  if (!role) throw domainError(422, 'INVALID_MDM_ROLE', '角色不属于当前治理模型');

  await executor.execute(`
    INSERT INTO person_roles (
      person_id, role_id, scope_type, scope_department_id, authorization_basis,
      effective_from, effective_to, assignment_status, assigned_by_person_id,
      revoked_by_person_id, revoked_at, revocation_reason
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, NULL)
    ON DUPLICATE KEY UPDATE
      scope_type=VALUES(scope_type),
      scope_department_id=VALUES(scope_department_id),
      authorization_basis=VALUES(authorization_basis),
      effective_from=VALUES(effective_from),
      effective_to=VALUES(effective_to),
      assignment_status='active',
      assigned_by_person_id=VALUES(assigned_by_person_id),
      revoked_by_person_id=NULL,
      revoked_at=NULL,
      revocation_reason=NULL
  `, [
    personId,
    role.role_id,
    assignment.scopeType,
    assignment.scopeDepartmentId,
    assignment.authorizationBasis,
    assignment.effectiveFrom,
    assignment.effectiveTo,
    actorPersonId
  ]);
  const record = await first(executor, `
    SELECT person_role_id
    FROM person_roles
    WHERE person_id=? AND role_id=?
  `, [personId, role.role_id]);
  return { role, personRoleId: Number(record.person_role_id) };
}

function makeGovernanceAccessMysqlRepository(pool) {
  return {
    async listAccounts() {
      const accounts = await rows(pool, `
        SELECT p.person_id, p.employee_no, p.person_name, p.current_department_id,
               p.employment_status, p.status AS person_status,
               d.name AS department_name,
               ua.account_id, ua.login_name, ua.account_status, ua.must_change_password,
               ua.auth_version, ua.last_login_at, ua.created_at, ua.updated_at
        FROM person p
        LEFT JOIN departments d ON d.id=p.current_department_id
        LEFT JOIN user_accounts ua ON ua.person_id=p.person_id
        ORDER BY p.employee_no
      `);
      for (const account of accounts) {
        account.roleAssignments = await listRoleAssignments(pool, account.person_id, true);
      }
      return accounts;
    },

    async getAccount(personId) {
      const account = await getAccountRecord(pool, personId);
      if (!account) return null;
      account.roleAssignments = await listRoleAssignments(pool, personId, true);
      return account;
    },

    async createAccount(payload = {}) {
      const loginName = text(payload.loginName);
      const employeeNo = text(payload.employeeNo);
      const name = text(payload.name);
      const departmentId = Number(payload.departmentId || 0);
      const roleAssignments = Array.isArray(payload.roleAssignments) ? payload.roleAssignments : [];
      if (!loginName || !employeeNo || !name || !departmentId) {
        throw domainError(422, 'ACCOUNT_REQUIRED_FIELDS_MISSING', '登录名、工号、姓名和部门均为必填');
      }
      if (roleAssignments.length === 0) {
        throw domainError(422, 'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED', '创建账号时至少授予一个MDM工作角色');
      }
      if (!payload.pendingPasswordHash) {
        throw domainError(500, 'PENDING_CREDENTIAL_REQUIRED', '待启用账号凭据未生成');
      }
      const actorPersonId = Number(payload.actorPersonId || 0) || null;

      return await withTransaction(pool, async executor => {
        const department = await getActiveDepartment(executor, departmentId);
        if (!department) throw domainError(422, 'ACTIVE_DEPARTMENT_REQUIRED', '所选部门不存在或未启用');

        let person = await first(executor, 'SELECT * FROM person WHERE employee_no=? FOR UPDATE', [employeeNo]);
        let personId;
        if (person) {
          if (text(person.person_name) !== name || Number(person.current_department_id || 0) !== departmentId) {
            throw domainError(
              409,
              'PERSON_IDENTITY_MISMATCH',
              '工号已存在，但姓名或部门与现有人员记录不一致'
            );
          }
          const account = await first(executor, 'SELECT account_id FROM user_accounts WHERE person_id=?', [person.person_id]);
          if (account) throw domainError(409, 'ACCOUNT_EXISTS', '该人员已经存在账号');
          personId = Number(person.person_id);
        } else {
          const result = await executor.execute(`
            INSERT INTO person (
              employee_no, person_name, current_department_id,
              employment_status, status
            )
            VALUES (?, ?, ?, 'active', 'active')
          `, [employeeNo, name, departmentId]);
          personId = insertId(result);
        }

        const accountResult = await executor.execute(`
          INSERT INTO user_accounts (
            person_id, login_name, password_hash, must_change_password,
            account_status, auth_version
          )
          VALUES (?, ?, ?, 1, 'pending_activation', 1)
        `, [personId, loginName, payload.pendingPasswordHash]);
        const accountId = insertId(accountResult);

        await writeAccessEvent(executor, {
          eventType: 'account_created',
          actorPersonId,
          targetPersonId: personId,
          accountId,
          reason: text(payload.reason) || '管理员手工创建待启用账号',
          details: { loginName, employeeNo, departmentId, accountStatus: 'pending_activation' }
        });

        for (const assignmentInput of roleAssignments) {
          const assignment = validateRoleAssignmentInput(assignmentInput, departmentId);
          const granted = await grantRoleAssignment(executor, personId, assignment, actorPersonId);
          await writeAccessEvent(executor, {
            eventType: 'role_assigned',
            actorPersonId,
            targetPersonId: personId,
            accountId,
            personRoleId: granted.personRoleId,
            reason: assignment.authorizationBasis,
            details: {
              roleCode: assignment.roleCode,
              scopeType: assignment.scopeType,
              scopeDepartmentId: assignment.scopeDepartmentId,
              effectiveFrom: assignment.effectiveFrom,
              effectiveTo: assignment.effectiveTo
            }
          });
        }

        const created = await getAccountRecord(executor, personId);
        created.roleAssignments = await listRoleAssignments(executor, personId, true);
        return created;
      });
    },

    async updateAccount(personId, payload = {}) {
      const actorPersonId = Number(payload.actorPersonId || 0) || null;
      return await withTransaction(pool, async executor => {
        const account = await getAccountRecord(executor, personId);
        if (!account) throw domainError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
        const nextName = text(payload.name) || account.person_name;
        const changingDepartment = Object.prototype.hasOwnProperty.call(payload, 'departmentId') &&
          Number(payload.departmentId || 0) !== Number(account.current_department_id || 0);
        let nextDepartmentId = Number(account.current_department_id || 0);

        if (changingDepartment) {
          nextDepartmentId = Number(payload.departmentId || 0);
          if (!text(payload.changeReason)) {
            throw domainError(422, 'DEPARTMENT_CHANGE_REASON_REQUIRED', '变更部门时必须填写原因');
          }
          if (!await getActiveDepartment(executor, nextDepartmentId)) {
            throw domainError(422, 'ACTIVE_DEPARTMENT_REQUIRED', '新部门不存在或未启用');
          }
          const replacements = Array.isArray(payload.roleAssignments) ? payload.roleAssignments : null;
          if (!replacements) {
            throw domainError(
              422,
              'DEPARTMENT_ROLE_REPLACEMENT_REQUIRED',
              '变更部门时必须同时提交新的部门角色安排'
            );
          }
          const normalizedReplacements = replacements
            .map(input => validateRoleAssignmentInput(input, nextDepartmentId))
            .filter(assignment => DEPARTMENT_ROLE_CODES.has(assignment.roleCode));
          if (normalizedReplacements.length === 0) {
            throw domainError(
              422,
              'DEPARTMENT_ROLE_REPLACEMENT_REQUIRED',
              '变更部门时至少需要一项新部门角色安排'
            );
          }
          const revokedAssignments = await rows(executor, `
            SELECT pr.person_role_id, r.role_code
            FROM person_roles pr
            JOIN roles r ON r.role_id=pr.role_id
            WHERE pr.person_id=?
              AND pr.assignment_status='active'
              AND r.role_code IN ('department_contact','department_mdm_reviewer')
          `, [personId]);
          await executor.execute(`
            UPDATE person_roles pr
            JOIN roles r ON r.role_id=pr.role_id
            SET pr.assignment_status='revoked',
                pr.revoked_by_person_id=?,
                pr.revoked_at=CURRENT_TIMESTAMP,
                pr.revocation_reason=?
            WHERE pr.person_id=?
              AND pr.assignment_status='active'
              AND r.role_code IN ('department_contact','department_mdm_reviewer')
          `, [actorPersonId, text(payload.changeReason), personId]);
          for (const revoked of revokedAssignments) {
            await writeAccessEvent(executor, {
              eventType: 'role_revoked',
              actorPersonId,
              targetPersonId: personId,
              accountId: account.account_id,
              personRoleId: revoked.person_role_id,
              reason: text(payload.changeReason),
              details: { roleCode: revoked.role_code, departmentChange: true }
            });
          }
          for (const assignment of normalizedReplacements) {
            const granted = await grantRoleAssignment(executor, personId, assignment, actorPersonId);
            await writeAccessEvent(executor, {
              eventType: 'role_assigned',
              actorPersonId,
              targetPersonId: personId,
              accountId: account.account_id,
              personRoleId: granted.personRoleId,
              reason: assignment.authorizationBasis,
              details: { roleCode: assignment.roleCode, scopeDepartmentId: nextDepartmentId }
            });
          }
        }

        await executor.execute(`
          UPDATE person
          SET person_name=?, current_department_id=?, updated_at=CURRENT_TIMESTAMP
          WHERE person_id=?
        `, [nextName, nextDepartmentId || null, personId]);
        await executor.execute(`
          UPDATE user_accounts
          SET auth_version=auth_version+1, updated_at=CURRENT_TIMESTAMP
          WHERE person_id=?
        `, [personId]);
        if (changingDepartment) {
          await writeAccessEvent(executor, {
            eventType: 'department_changed',
            actorPersonId,
            targetPersonId: personId,
            accountId: account.account_id,
            reason: text(payload.changeReason),
            details: {
              previousDepartmentId: account.current_department_id,
              departmentId: nextDepartmentId
            }
          });
        }
        return await getAccountRecord(executor, personId);
      });
    },

    async grantRole(personId, payload = {}) {
      const actorPersonId = Number(payload.actorPersonId || 0) || null;
      return await withTransaction(pool, async executor => {
        const account = await getAccountRecord(executor, personId);
        if (!account) throw domainError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
        const assignment = validateRoleAssignmentInput(payload, account.current_department_id);
        const granted = await grantRoleAssignment(executor, personId, assignment, actorPersonId);
        await executor.execute(
          'UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=?',
          [personId]
        );
        await writeAccessEvent(executor, {
          eventType: 'role_assigned',
          actorPersonId,
          targetPersonId: personId,
          accountId: account.account_id,
          personRoleId: granted.personRoleId,
          reason: assignment.authorizationBasis,
          details: {
            roleCode: assignment.roleCode,
            scopeType: assignment.scopeType,
            scopeDepartmentId: assignment.scopeDepartmentId,
            effectiveFrom: assignment.effectiveFrom,
            effectiveTo: assignment.effectiveTo
          }
        });
        return (await listRoleAssignments(executor, personId, true))
          .find(item => item.assignmentId === granted.personRoleId);
      });
    },

    async revokeRole(personId, assignmentId, payload = {}) {
      const reason = text(payload.reason);
      if (!reason) throw domainError(422, 'ROLE_REVOCATION_REASON_REQUIRED', '撤销角色时必须填写原因');
      const actorPersonId = Number(payload.actorPersonId || 0) || null;
      return await withTransaction(pool, async executor => {
        const account = await getAccountRecord(executor, personId);
        if (!account) throw domainError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
        const assignment = await first(executor, `
          SELECT pr.*, r.role_code
          FROM person_roles pr
          JOIN roles r ON r.role_id=pr.role_id
          WHERE pr.person_id=? AND pr.person_role_id=?
          FOR UPDATE
        `, [personId, assignmentId]);
        if (!assignment) throw domainError(404, 'ROLE_ASSIGNMENT_NOT_FOUND', '角色授权记录不存在');
        if (assignment.assignment_status !== 'active') {
          return { revoked: true, idempotent: true };
        }
        if (assignment.role_code === 'admin' && await countActiveAdmins(executor, personId) < 1) {
          throw domainError(409, 'LAST_ACTIVE_ADMIN', '不能撤销最后一个有效管理员');
        }

        const remaining = await first(executor, `
          SELECT COUNT(*) AS count
          FROM person_roles pr
          JOIN roles r ON r.role_id=pr.role_id
          WHERE pr.person_id=?
            AND pr.assignment_status='active'
            AND pr.person_role_id<>?
            AND r.status='active'
            AND r.model_version=?
            AND pr.authorization_basis IS NOT NULL
            AND pr.effective_from IS NOT NULL
            AND pr.effective_from<=CURRENT_DATE
            AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
        `, [personId, assignmentId, ACCESS_MODEL_VERSION]);
        if (Number(remaining && remaining.count || 0) < 1 && !payload.disableAccount) {
          throw domainError(
            409,
            'LAST_ACTIVE_ROLE_REQUIRES_DISABLE',
            '撤销最后一个有效角色时必须同时停用账号'
          );
        }

        await executor.execute(`
          UPDATE person_roles
          SET assignment_status='revoked',
              revoked_by_person_id=?,
              revoked_at=CURRENT_TIMESTAMP,
              revocation_reason=?
          WHERE person_role_id=?
        `, [actorPersonId, reason, assignmentId]);
        await executor.execute(`
          UPDATE user_accounts
          SET account_status=CASE WHEN ? THEN 'disabled' ELSE account_status END,
              auth_version=auth_version+1,
              updated_at=CURRENT_TIMESTAMP
          WHERE person_id=?
        `, [payload.disableAccount ? 1 : 0, personId]);
        await writeAccessEvent(executor, {
          eventType: 'role_revoked',
          actorPersonId,
          targetPersonId: personId,
          accountId: account.account_id,
          personRoleId: assignmentId,
          reason,
          details: { roleCode: assignment.role_code, disabledAccount: Boolean(payload.disableAccount) }
        });
        if (payload.disableAccount) {
          await writeAccessEvent(executor, {
            eventType: 'account_disabled',
            actorPersonId,
            targetPersonId: personId,
            accountId: account.account_id,
            reason
          });
        }
        return { revoked: true, idempotent: false };
      });
    },

    async activateAccount(personId, payload = {}) {
      if (!payload.passwordHash) throw domainError(500, 'PASSWORD_HASH_REQUIRED', '临时密码凭据未生成');
      const actorPersonId = Number(payload.actorPersonId || 0) || null;
      return await withTransaction(pool, async executor => {
        const account = await assertAccountCanActivate(executor, personId);
        if (account.account_status !== 'pending_activation') {
          throw domainError(409, 'ACCOUNT_NOT_PENDING_ACTIVATION', '只有待启用账号可以执行首次启用');
        }
        await executor.execute(`
          UPDATE user_accounts
          SET password_hash=?, must_change_password=1,
              account_status='active', auth_version=auth_version+1,
              updated_at=CURRENT_TIMESTAMP
          WHERE person_id=?
        `, [payload.passwordHash, personId]);
        await writeAccessEvent(executor, {
          eventType: 'account_activated',
          actorPersonId,
          targetPersonId: personId,
          accountId: account.account_id,
          reason: text(payload.reason) || '管理员明确启用账号'
        });
        return await getAccountRecord(executor, personId);
      });
    },

    async enableAccount(personId, payload = {}) {
      const actorPersonId = Number(payload.actorPersonId || 0) || null;
      return await withTransaction(pool, async executor => {
        const account = await assertAccountCanActivate(executor, personId);
        if (account.account_status === 'pending_activation') {
          throw domainError(409, 'ACCOUNT_REQUIRES_ACTIVATION', '待启用账号必须先执行首次启用并生成临时密码');
        }
        if (account.account_status === 'active') return { ...account, idempotent: true };
        await executor.execute(`
          UPDATE user_accounts
          SET account_status='active', auth_version=auth_version+1, updated_at=CURRENT_TIMESTAMP
          WHERE person_id=?
        `, [personId]);
        await writeAccessEvent(executor, {
          eventType: 'account_enabled',
          actorPersonId,
          targetPersonId: personId,
          accountId: account.account_id,
          reason: text(payload.reason) || '管理员恢复账号'
        });
        return await getAccountRecord(executor, personId);
      });
    },

    async disableAccount(personId, payload = {}) {
      const reason = text(payload.reason);
      if (!reason) throw domainError(422, 'ACCOUNT_DISABLE_REASON_REQUIRED', '停用账号时必须填写原因');
      const actorPersonId = Number(payload.actorPersonId || 0) || null;
      return await withTransaction(pool, async executor => {
        const account = await getAccountRecord(executor, personId);
        if (!account || !account.account_id) throw domainError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
        const adminRole = await first(executor, `
          SELECT pr.person_role_id
          FROM person_roles pr
          JOIN roles r ON r.role_id=pr.role_id
          WHERE pr.person_id=? AND pr.assignment_status='active' AND r.role_code='admin'
          LIMIT 1
        `, [personId]);
        if (adminRole && await countActiveAdmins(executor, personId) < 1) {
          throw domainError(409, 'LAST_ACTIVE_ADMIN', '不能停用最后一个有效管理员');
        }
        if (account.account_status === 'disabled') return { ...account, idempotent: true };
        await executor.execute(`
          UPDATE user_accounts
          SET account_status='disabled', auth_version=auth_version+1, updated_at=CURRENT_TIMESTAMP
          WHERE person_id=?
        `, [personId]);
        await writeAccessEvent(executor, {
          eventType: 'account_disabled',
          actorPersonId,
          targetPersonId: personId,
          accountId: account.account_id,
          reason
        });
        return await getAccountRecord(executor, personId);
      });
    },

    async resetPassword(personId, payload = {}) {
      if (!payload.passwordHash) throw domainError(500, 'PASSWORD_HASH_REQUIRED', '临时密码凭据未生成');
      const actorPersonId = Number(payload.actorPersonId || 0) || null;
      return await withTransaction(pool, async executor => {
        const account = await getAccountRecord(executor, personId);
        if (!account || !account.account_id) throw domainError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
        await executor.execute(`
          UPDATE user_accounts
          SET password_hash=?, must_change_password=1, auth_version=auth_version+1,
              updated_at=CURRENT_TIMESTAMP
          WHERE person_id=?
        `, [payload.passwordHash, personId]);
        await writeAccessEvent(executor, {
          eventType: 'password_reset',
          actorPersonId,
          targetPersonId: personId,
          accountId: account.account_id,
          reason: text(payload.reason) || '管理员重置临时密码'
        });
        return await getAccountRecord(executor, personId);
      });
    },

    async listAccessEvents(filters = {}) {
      const params = [];
      const clauses = [];
      if (filters.personId) {
        clauses.push('(e.target_person_id=? OR e.actor_person_id=?)');
        params.push(filters.personId, filters.personId);
      }
      if (filters.eventType) {
        clauses.push('e.event_type=?');
        params.push(filters.eventType);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
      return await rows(pool, `
        SELECT e.event_id, e.event_type, e.actor_person_id, actor.person_name AS actor_name,
               e.target_person_id, target.person_name AS target_name,
               e.account_id, e.person_role_id, e.reason, e.payload_json,
               e.migration_batch_id, e.created_at
        FROM identity_access_events e
        LEFT JOIN person actor ON actor.person_id=e.actor_person_id
        LEFT JOIN person target ON target.person_id=e.target_person_id
        ${where}
        ORDER BY e.created_at DESC, e.event_id DESC
        LIMIT ${limit}
      `, params);
    },

    async recordGovernanceDecision(payload = {}) {
      const recorderPersonId = Number(payload.recorderPersonId || 0);
      const departmentId = Number(payload.departmentId || 0);
      const subjectDomain = text(payload.subjectDomain);
      const subjectType = text(payload.subjectType);
      const subjectId = text(payload.subjectId);
      const subjectVersion = text(payload.subjectVersion);
      const decision = text(payload.decision);
      const decisionBasis = text(payload.decisionBasis);
      const evidenceReference = text(payload.evidenceReference) || null;
      const decidedAt = text(payload.decidedAt);
      if (!recorderPersonId || !departmentId || !subjectDomain || !subjectType ||
          !subjectId || !subjectVersion || !decision || !decisionBasis || !decidedAt) {
        throw domainError(422, 'DECISION_REQUIRED_FIELDS_MISSING', '治理对象、部门、决定、依据和决定时间均为必填');
      }
      if (!['process', 'data', 'term'].includes(subjectDomain)) {
        throw domainError(422, 'INVALID_DECISION_DOMAIN', '治理领域必须是process、data或term');
      }
      if (!['approved', 'returned', 'rejected'].includes(decision)) {
        throw domainError(422, 'INVALID_DECISION', '决定值必须是approved、returned或rejected');
      }
      if (Number.isNaN(Date.parse(decidedAt))) {
        throw domainError(422, 'INVALID_DECIDED_AT', '决定时间格式不正确');
      }

      return await withTransaction(pool, async executor => {
        const recorder = await first(executor, `
          SELECT p.person_id, p.current_department_id
          FROM person p
          WHERE p.person_id=? AND p.status='active'
        `, [recorderPersonId]);
        if (!recorder || Number(recorder.current_department_id || 0) !== departmentId) {
          throw domainError(403, 'DEPARTMENT_SCOPE_FORBIDDEN', '只能记录本人所属部门的决定');
        }
        const reviewerRole = await first(executor, `
          SELECT pr.person_role_id
          FROM person_roles pr
          JOIN roles r ON r.role_id=pr.role_id
          WHERE pr.person_id=?
            AND r.role_code='department_mdm_reviewer'
            AND r.status='active'
            AND r.model_version=?
            AND pr.assignment_status='active'
            AND pr.scope_type='department'
            AND pr.scope_department_id=?
            AND pr.authorization_basis IS NOT NULL
            AND pr.effective_from IS NOT NULL
            AND pr.effective_from<=CURRENT_DATE
            AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
          LIMIT 1
        `, [recorderPersonId, ACCESS_MODEL_VERSION, departmentId]);
        if (!reviewerRole) {
          throw domainError(403, 'DEPARTMENT_REVIEWER_ROLE_REQUIRED', '当前人员不是该部门的MDM审核员');
        }
        await assertDecisionSubjectScope(executor, {
          subjectDomain,
          subjectType,
          subjectId,
          subjectVersion,
          departmentId
        });
        const department = await first(executor, `
          SELECT d.id, d.name, d.final_responsible_person_id,
                 responsible.person_name AS final_responsible_person_name
          FROM departments d
          LEFT JOIN person responsible ON responsible.person_id=d.final_responsible_person_id
          WHERE d.id=? AND d.status='active'
        `, [departmentId]);
        if (!department || !department.final_responsible_person_id) {
          throw domainError(
            422,
            'RESPONSIBILITY_CHAIN_INCOMPLETE',
            '部门尚未明确最终责任人，不能记录部门决定'
          );
        }
        const latest = await first(executor, `
          SELECT decision_record_id
          FROM governance_decision_records
          WHERE subject_domain=? AND subject_type=? AND subject_id=?
            AND subject_version=? AND department_id=?
          ORDER BY created_at DESC, decision_record_id DESC
          LIMIT 1
        `, [subjectDomain, subjectType, subjectId, subjectVersion, departmentId]);
        const result = await executor.execute(`
          INSERT INTO governance_decision_records (
            subject_domain, subject_type, subject_id, subject_version,
            department_id, accountable_person_id, recorded_by_person_id,
            decision, decision_basis, evidence_reference, decided_at,
            supersedes_decision_record_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          subjectDomain,
          subjectType,
          subjectId,
          subjectVersion,
          departmentId,
          department.final_responsible_person_id,
          recorderPersonId,
          decision,
          decisionBasis,
          evidenceReference,
          decidedAt,
          latest ? latest.decision_record_id : null
        ]);
        return {
          decisionRecordId: insertId(result),
          accountablePersonId: Number(department.final_responsible_person_id),
          accountablePersonName: department.final_responsible_person_name || null,
          supersedesDecisionRecordId: latest ? Number(latest.decision_record_id) : null
        };
      });
    },

    async getPublicationResponsibilityReadiness(payload = {}) {
      const subjectDomain = text(payload.subjectDomain);
      const subjectType = text(payload.subjectType);
      const subjectId = text(payload.subjectId);
      const subjectVersion = text(payload.subjectVersion);
      const departmentIds = [...new Set((payload.departmentIds || [])
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value > 0))];
      if (!subjectDomain || !subjectType || !subjectId || !subjectVersion || departmentIds.length === 0) {
        throw domainError(422, 'RESPONSIBILITY_CHAIN_INCOMPLETE', '发布责任核验缺少对象版本或责任部门');
      }

      const incompleteDepartments = [];
      for (const departmentId of departmentIds) {
        const department = await first(pool, `
          SELECT id, name, final_responsible_person_id
          FROM departments
          WHERE id=? AND status='active'
        `, [departmentId]);
        if (!department || !department.final_responsible_person_id) {
          incompleteDepartments.push({
            departmentId,
            departmentName: department && department.name || null,
            reason: department ? '部门尚未配置最终责任人' : '责任部门不存在或已停用'
          });
          continue;
        }
        const decision = await first(pool, `
          SELECT decision, accountable_person_id, decided_at
          FROM governance_decision_records
          WHERE subject_domain=? AND subject_type=? AND subject_id=?
            AND subject_version=? AND department_id=?
          ORDER BY created_at DESC, decision_record_id DESC
          LIMIT 1
        `, [subjectDomain, subjectType, subjectId, subjectVersion, departmentId]);
        if (
          !decision ||
          decision.decision !== 'approved' ||
          Number(decision.accountable_person_id) !== Number(department.final_responsible_person_id)
        ) {
          incompleteDepartments.push({
            departmentId,
            departmentName: department.name,
            reason: !decision
              ? '尚未记录部门决定'
              : decision.decision !== 'approved'
                ? '最新部门决定不是同意'
                : '部门最终责任人已经变化，需要重新记录决定'
          });
        }
      }
      return {
        subjectDomain,
        subjectType,
        subjectId,
        subjectVersion,
        departmentIds,
        incompleteDepartments,
        ready: incompleteDepartments.length === 0
      };
    },

    async listGovernanceDecisions(filters = {}) {
      const clauses = [];
      const params = [];
      for (const [field, value] of [
        ['r.subject_domain', filters.subjectDomain],
        ['r.subject_type', filters.subjectType],
        ['r.subject_id', filters.subjectId],
        ['r.subject_version', filters.subjectVersion],
        ['r.department_id', filters.departmentId]
      ]) {
        if (value === undefined || value === null || value === '') continue;
        clauses.push(`${field}=?`);
        params.push(value);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      return await rows(pool, `
        SELECT r.*, d.name AS department_name,
               accountable.person_name AS accountable_person_name,
               recorder.person_name AS recorded_by_person_name
        FROM governance_decision_records r
        JOIN departments d ON d.id=r.department_id
        JOIN person accountable ON accountable.person_id=r.accountable_person_id
        JOIN person recorder ON recorder.person_id=r.recorded_by_person_id
        ${where}
        ORDER BY r.created_at DESC, r.decision_record_id DESC
      `, params);
    }
  };
}

module.exports = {
  ACTIVE_ROLE_CODES,
  DEPARTMENT_ROLE_CODES,
  GLOBAL_ROLE_CODES,
  domainError,
  makeGovernanceAccessMysqlRepository,
  validateRoleAssignmentInput
};
