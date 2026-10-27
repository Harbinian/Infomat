const {
  ACCESS_MODEL_VERSION,
  ROLE_GUIDES
} = require('./roleDefinitions');
const { identityInteger, sameIdentityInteger } = require('./sessionSubject');
const { lockAndAssertMaintenanceAuthority } = require('./accountMaintenanceAuthority');
const { prepareDepartmentHeadAppointment, registerDepartmentHead } = require('./departmentHeadAppointment');

// Explicit identity opt-in keeps default helper consumers on their
// original projection/binding path. Display rows never grant authority.
function identityReadColumn(column, alias = column.split('.').at(-1)) {
  return `CAST(${column} AS CHAR) AS ${alias}`;
}

function normalizeIdentityRead(row, fields) {
  const result = { ...row };
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(row, field) || row[field] == null) continue;
    const id = identityInteger(row[field]);
    if (id !== null) result[field] = id;
    else if (typeof row[field] === 'string' && /^-?\d+$/.test(row[field])) {
      const integer = BigInt(row[field]);
      if (integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)) result[field] = Number(row[field]);
    }
  }
  return result;
}

function identityReadParam(value) {
  if (value === undefined) return undefined;
  const id = identityInteger(value);
  return id === null ? null : String(id);
}

function maintenanceActorId(value) {
  if (value === undefined || value === null) return null;
  const id = identityInteger(value);
  if (id === null) throw domainError(422, 'INVALID_ACTOR_PERSON_ID', '操作人员标识无效');
  return id;
}

// Only maintenance consumes this connection-local value. The shared insertId
// adapter for governance decisions retains its original contract.
async function maintenanceInsertId(executor) {
  const row = await first(executor, 'SELECT CAST(LAST_INSERT_ID() AS CHAR) AS identity_id');
  const id = identityInteger(row && row.identity_id);
  if (id === null) throw domainError(503, 'IDENTITY_ACCESS_SERVICE_UNAVAILABLE', '账号与授权标识不可用');
  return id;
}

const ACCOUNT_READ_IDENTITIES = ['person_id', 'current_department_id', 'account_id', 'auth_version', 'department_final_responsible_person_id'];
const ASSIGNMENT_READ_IDENTITIES = ['assignmentId', 'scopeDepartmentId', 'assignedByPersonId', 'revokedByPersonId'];

const ACTIVE_ROLE_CODES = new Set(ROLE_GUIDES.map(role => role.code));
const DEPARTMENT_ROLE_CODES = new Set(['department_contact', 'department_mdm_reviewer']);
const GLOBAL_ROLE_CODES = new Set([
  'admin',
  'hr_directory_manager',
  'mdm_lead',
  'mdm_steward',
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

function validateRoleAssignmentInput(payload = {}, personDepartmentId, exactIdentity = false) {
  const roleCode = text(payload.roleCode || payload.role_code);
  if (!ACTIVE_ROLE_CODES.has(roleCode)) {
    throw domainError(422, 'INVALID_MDM_ROLE', '只能授予固定的系统角色');
  }
  const authorizationBasis = text(payload.authorizationBasis || payload.authorization_basis);
  const effectiveFrom = normalizeDate(payload.effectiveFrom || payload.effective_from, '生效日期', true);
  const effectiveTo = normalizeDate(payload.effectiveTo || payload.effective_to, '失效日期');
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw domainError(422, 'INVALID_EFFECTIVE_PERIOD', '失效日期不能早于生效日期');
  }

  let scopeType;
  let scopeDepartmentId = null;
  if (DEPARTMENT_ROLE_CODES.has(roleCode)) {
    scopeType = 'department';
    scopeDepartmentId = exactIdentity
      ? identityInteger(payload.scopeDepartmentId ?? payload.scope_department_id ?? personDepartmentId)
      : Number(payload.scopeDepartmentId || payload.scope_department_id || personDepartmentId || 0);
    if (!scopeDepartmentId || (exactIdentity
      ? !sameIdentityInteger(scopeDepartmentId, personDepartmentId)
      : scopeDepartmentId !== Number(personDepartmentId || 0))) {
      throw domainError(422, 'ROLE_SCOPE_DEPARTMENT_MISMATCH', '部门角色只能授权到人员所属部门');
    }
  } else if (GLOBAL_ROLE_CODES.has(roleCode)) {
    scopeType = 'global';
  } else {
    throw domainError(422, 'INVALID_MDM_ROLE_SCOPE', '角色范围不符合固定权限模型');
  }

  return {
    roleCode,
    scopeType,
    scopeDepartmentId,
    authorizationBasis,
    effectiveFrom,
    effectiveTo,
    ...(roleCode === 'department_mdm_reviewer' ? { appointmentInput: {
      ...(Object.prototype.hasOwnProperty.call(payload, 'expectedFinalResponsiblePersonId') ? { expectedFinalResponsiblePersonId: payload.expectedFinalResponsiblePersonId } : {}),
      confirmReplaceFinalResponsiblePerson: payload.confirmReplaceFinalResponsiblePerson
    } } : {})
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

async function writeAccessEvent(executor, payload = {}, exactIdentity = false) {
  const binding = value => exactIdentity ? identityReadParam(value) : value || null;
  const [result] = await executor.execute(`
    INSERT INTO identity_access_events (
      event_type, actor_person_id, target_person_id, account_id,
      person_role_id, reason, payload_json, migration_batch_id
    )
    VALUES (?, ${exactIdentity ? 'CAST(? AS SIGNED), CAST(? AS SIGNED), CAST(? AS SIGNED), CAST(? AS SIGNED)' : '?, ?, ?, ?'}, ?, ?, ?)
  `, [
    payload.eventType,
    binding(payload.actorPersonId ?? null),
    binding(payload.targetPersonId ?? null),
    binding(payload.accountId ?? null),
    binding(payload.personRoleId ?? null),
    payload.reason || null,
    payload.details ? JSON.stringify(payload.details) : null,
    payload.migrationBatchId || null
  ]);
  const systemAdmin = require('./systemAdminIdentity');
  const actor = executor[systemAdmin.ACTOR];
  const eventId = exactIdentity ? await maintenanceInsertId(executor) : result.insertId;
  if (actor) await systemAdmin.event(executor, actor.accountId, payload.eventType, eventId, payload.targetPersonId || null, exactIdentity);
}

async function getActiveDepartment(executor, departmentId, exactRead = false) {
  const department = await first(executor, `
    SELECT ${exactRead ? identityReadColumn('id') : 'id'}, name, code, ${exactRead ? identityReadColumn('final_responsible_person_id') : 'final_responsible_person_id'}
    FROM departments
    WHERE id=${exactRead ? 'CAST(? AS SIGNED)' : '?'} AND status='active'
  `, [exactRead ? identityReadParam(departmentId) : departmentId]);
  return department && exactRead ? normalizeIdentityRead(department, ['id', 'final_responsible_person_id']) : department;
}

async function getAccountRecord(executor, personId, exactRead = false, currentRead = false) {
  const column = (name, alias) => exactRead ? identityReadColumn(name, alias) : name;
  const account = await first(executor, `
    SELECT ${column('p.person_id')}, p.employee_no, p.person_name, ${column('p.current_department_id')},
           p.employment_status, p.status AS person_status,
           d.name AS department_name, d.status AS department_status,
           ${exactRead ? identityReadColumn('d.final_responsible_person_id', 'department_final_responsible_person_id') : 'd.final_responsible_person_id AS department_final_responsible_person_id'},
           (SELECT head.person_name FROM person head WHERE head.person_id=d.final_responsible_person_id) AS department_final_responsible_person_name,
           DATE_FORMAT(CURRENT_DATE,'%Y-%m-%d') AS server_current_date,
           ${column('ua.account_id')}, ua.login_name, ua.account_status, ua.must_change_password,
           ${column('ua.auth_version')}, ua.last_login_at, ua.created_at, ua.updated_at
    FROM person p
    LEFT JOIN departments d ON d.id=p.current_department_id
    LEFT JOIN user_accounts ua ON ua.person_id=p.person_id
    WHERE p.person_id=${exactRead ? 'CAST(? AS SIGNED)' : '?'}
    ${currentRead ? 'FOR SHARE' : ''}
  `, [exactRead ? identityReadParam(personId) : personId]);
  return account && exactRead ? normalizeIdentityRead(account, ACCOUNT_READ_IDENTITIES) : account;
}

async function listRoleAssignments(executor, personId, includeHistory = true, exactRead = false) {
  const statusClause = includeHistory ? '' : " AND pr.assignment_status='active'";
  const column = (name, alias) => exactRead ? identityReadColumn(name, alias) : `${name} AS ${alias}`;
  // DATE is a calendar day; a local-midnight Date would shift on JSON serialization.
  const assignments = await rows(executor, `
    SELECT ${column('pr.person_role_id', 'assignmentId')},
           r.role_code AS roleCode,
           r.role_name AS roleName,
           r.role_group AS roleGroup,
           r.status AS roleStatus,
           pr.scope_type AS scopeType,
           ${column('pr.scope_department_id', 'scopeDepartmentId')},
           d.name AS scopeDepartmentName,
           pr.authorization_basis AS authorizationBasis,
           DATE_FORMAT(pr.effective_from,'%Y-%m-%d') AS effectiveFrom,
           DATE_FORMAT(pr.effective_to,'%Y-%m-%d') AS effectiveTo,
           pr.assignment_status AS status,
           ${column('pr.assigned_by_person_id', 'assignedByPersonId')},
           assigner.person_name AS assignedByPersonName,
           ${column('pr.revoked_by_person_id', 'revokedByPersonId')},
           revoker.person_name AS revokedByPersonName,
           pr.revoked_at AS revokedAt,
           pr.revocation_reason AS revocationReason,
           pr.created_at AS createdAt
    FROM person_roles pr
    JOIN roles r ON r.role_id=pr.role_id
    LEFT JOIN departments d ON d.id=pr.scope_department_id
    LEFT JOIN person assigner ON assigner.person_id=pr.assigned_by_person_id
    LEFT JOIN person revoker ON revoker.person_id=pr.revoked_by_person_id
    WHERE pr.person_id=${exactRead ? 'CAST(? AS SIGNED)' : '?'}${statusClause}
    ORDER BY FIELD(pr.assignment_status, 'active', 'expired', 'revoked'), r.role_group, r.role_code
  `, [exactRead ? identityReadParam(personId) : personId]);
  return exactRead ? assignments.map(row => normalizeIdentityRead(row, ASSIGNMENT_READ_IDENTITIES)) : assignments;
}

async function countActiveAdmins(executor, excludedPersonId = null, exactIdentity = false) {
  const params = [];
  let exclusion = '';
  if (excludedPersonId) {
    exclusion = exactIdentity ? ' AND p.person_id<>CAST(? AS SIGNED)' : ' AND p.person_id<>?';
    params.push(exactIdentity ? identityReadParam(excludedPersonId) : excludedPersonId);
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
      AND pr.effective_from IS NOT NULL
      AND pr.effective_from<=CURRENT_DATE
      AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
      ${exclusion}
  `, [ACCESS_MODEL_VERSION, ...params]);
  return Number(row && row.count || 0);
}

async function assertAccountCanActivate(executor, personId) {
  const account = await getAccountRecord(executor, personId, true);
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
    SELECT ${identityReadColumn('pr.person_role_id')}
    FROM person_roles pr
    JOIN roles r ON r.role_id=pr.role_id
    WHERE pr.person_id=CAST(? AS SIGNED)
      AND r.status='active'
      AND r.model_version=?
      AND pr.assignment_status='active'
      AND pr.effective_from IS NOT NULL
      AND pr.effective_from<=CURRENT_DATE
      AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
    LIMIT 1
  `, [identityReadParam(personId), ACCESS_MODEL_VERSION]);
  if (!role) {
    throw domainError(
      422,
      'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED',
      '账号至少需要一个已生效的系统角色'
    );
  }
  return account;
}

async function grantRoleAssignment(executor, personId, assignment, actorPersonId, exactIdentity = false) {
  const departmentAppointment = await prepareDepartmentHeadAppointment(executor, personId, assignment, assignment.appointmentInput || {});
  const recordRole = await first(executor, `
    SELECT ${exactIdentity ? identityReadColumn('role_id') : 'role_id'}, role_code
    FROM roles
    WHERE role_code=? AND status='active' AND model_version=?
    ${['mdm_steward', 'hr_directory_manager', 'department_mdm_reviewer'].includes(assignment.roleCode) ? 'FOR SHARE' : ''}
  `, [assignment.roleCode, ACCESS_MODEL_VERSION]);
  const role = recordRole && exactIdentity ? normalizeIdentityRead(recordRole, ['role_id']) : recordRole;
  if (!role) throw domainError(422, 'INVALID_MDM_ROLE', '角色不属于当前权限模型');

  let previousRoleAssignment = null;
  if (departmentAppointment) {
    previousRoleAssignment = await first(executor, `SELECT pr.*,CAST(pr.person_role_id AS CHAR) person_role_id,CAST(pr.person_id AS CHAR) person_id,
      CAST(pr.role_id AS CHAR) role_id,CAST(pr.scope_department_id AS CHAR) scope_department_id,CAST(pr.assigned_by_person_id AS CHAR) assigned_by_person_id,
      CAST(pr.revoked_by_person_id AS CHAR) revoked_by_person_id,
      (pr.assignment_status='active' AND pr.effective_from<=CURRENT_DATE AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)) currently_effective
      FROM person_roles pr WHERE pr.person_id=CAST(? AS SIGNED) AND pr.role_id=CAST(? AS SIGNED) FOR UPDATE`, [identityReadParam(personId), identityReadParam(role.role_id)]);
    if (previousRoleAssignment && Number(previousRoleAssignment.currently_effective)) {
      if (previousRoleAssignment.scope_type !== 'department' || !sameIdentityInteger(previousRoleAssignment.scope_department_id, assignment.scopeDepartmentId)) throw domainError(422, 'ROLE_SCOPE_DEPARTMENT_MISMATCH', '现有效授权的部门范围与人员所属部门不一致');
      await registerDepartmentHead(executor, departmentAppointment);
      return { role, personRoleId: identityInteger(previousRoleAssignment.person_role_id), previousRoleAssignment, departmentAppointment: { ...departmentAppointment, existingGrantPreserved: true } };
    }
  }

  await executor.execute(`
    INSERT INTO person_roles (
      person_id, role_id, scope_type, scope_department_id, authorization_basis,
      effective_from, effective_to, assignment_status, assigned_by_person_id,
      revoked_by_person_id, revoked_at, revocation_reason
    )
    VALUES (${exactIdentity ? 'CAST(? AS SIGNED), CAST(? AS SIGNED), ?, CAST(? AS SIGNED)' : '?, ?, ?, ?'}, ?, ?, ?, 'active', ${exactIdentity ? 'CAST(? AS SIGNED)' : '?'}, NULL, NULL, NULL)
    ON DUPLICATE KEY UPDATE
      scope_type=VALUES(scope_type),
      scope_department_id=VALUES(scope_department_id),
      authorization_basis=IF(VALUES(authorization_basis) IS NULL OR TRIM(VALUES(authorization_basis))='', authorization_basis, VALUES(authorization_basis)),
      effective_from=VALUES(effective_from),
      effective_to=VALUES(effective_to),
      assignment_status='active',
      assigned_by_person_id=VALUES(assigned_by_person_id),
      revoked_by_person_id=NULL,
      revoked_at=NULL,
      revocation_reason=NULL
  `, [
    exactIdentity ? identityReadParam(personId) : personId,
    exactIdentity ? identityReadParam(role.role_id) : role.role_id,
    assignment.scopeType,
    exactIdentity ? identityReadParam(assignment.scopeDepartmentId) : assignment.scopeDepartmentId,
    assignment.authorizationBasis,
    assignment.effectiveFrom,
    assignment.effectiveTo,
    exactIdentity ? identityReadParam(actorPersonId) : actorPersonId
  ]);
  const record = await first(executor, `
    SELECT ${exactIdentity ? identityReadColumn('person_role_id') : 'person_role_id'}
    FROM person_roles
    WHERE person_id=${exactIdentity ? 'CAST(? AS SIGNED)' : '?'} AND role_id=${exactIdentity ? 'CAST(? AS SIGNED)' : '?'}
  `, exactIdentity ? [identityReadParam(personId), identityReadParam(role.role_id)] : [personId, role.role_id]);
  await registerDepartmentHead(executor, departmentAppointment);
  return { role, personRoleId: exactIdentity ? identityInteger(record.person_role_id) : Number(record.person_role_id),
    ...(departmentAppointment ? { departmentAppointment: { ...departmentAppointment, existingGrantPreserved: false }, previousRoleAssignment } : {}) };
}

function makeGovernanceAccessMysqlRepository(pool, maintenanceContext = null) {
  return {
    forPersonMaintenance(context) {
      if (!context) throw domainError(401, 'SESSION_IDENTITY_INVALID', '登录信息已失效，请重新登录');
      return makeGovernanceAccessMysqlRepository(pool, context);
    },
    forSystemAdmin(actor) {
      return makeGovernanceAccessMysqlRepository(require('./systemAdminIdentity').maintenancePool(pool, actor));
    },
    async listAccounts() {
      const accounts = await rows(pool, `
        SELECT ${identityReadColumn('p.person_id')}, p.employee_no, p.person_name, ${identityReadColumn('p.current_department_id')},
               p.employment_status, p.status AS person_status,
               d.name AS department_name,
               ${identityReadColumn('d.final_responsible_person_id', 'department_final_responsible_person_id')},
               (SELECT head.person_name FROM person head WHERE head.person_id=d.final_responsible_person_id) AS department_final_responsible_person_name,
               DATE_FORMAT(CURRENT_DATE,'%Y-%m-%d') AS server_current_date,
               ${identityReadColumn('ua.account_id')}, ua.login_name, ua.account_status, ua.must_change_password,
               ${identityReadColumn('ua.auth_version')}, ua.last_login_at, ua.created_at, ua.updated_at
        FROM person p
        LEFT JOIN departments d ON d.id=p.current_department_id
        LEFT JOIN user_accounts ua ON ua.person_id=p.person_id
        ORDER BY p.employee_no
      `);
      const normalized = accounts.map(account => normalizeIdentityRead(account, ACCOUNT_READ_IDENTITIES));
      for (const account of normalized) {
        account.roleAssignments = await listRoleAssignments(pool, account.person_id, true, true);
      }
      return normalized;
    },

    async getAccount(personId) {
      const account = await getAccountRecord(pool, personId, true);
      if (!account) return null;
      account.roleAssignments = await listRoleAssignments(pool, personId, true, true);
      return account;
    },

    async createAccount(payload = {}) {
      const loginName = text(payload.loginName);
      if (loginName.toLowerCase() === 'admin' && require('./systemAdminIdentity').enabled()) {
        throw domainError(409, 'SYSTEM_ADMIN_LOGIN_RESERVED', 'admin是独立系统维护登录名，不可用作人员账号');
      }
      const employeeNo = text(payload.employeeNo);
      const name = text(payload.name);
      const departmentId = identityInteger(payload.departmentId);
      const roleAssignments = Array.isArray(payload.roleAssignments) ? payload.roleAssignments : [];
      if (roleAssignments.some(assignment => text(assignment && (assignment.roleCode || assignment.role_code)) === 'department_mdm_reviewer')) {
        throw domainError(422, 'DEPARTMENT_HEAD_DEDICATED_GRANT_REQUIRED', '部门负责人请在账号建好后，通过新增角色授权一次完成授权和负责人登记');
      }
      if (!loginName || !employeeNo || !name || !departmentId) {
        throw domainError(422, 'ACCOUNT_REQUIRED_FIELDS_MISSING', '登录名、工号、姓名和部门均为必填');
      }
      if (roleAssignments.length === 0) {
        throw domainError(422, 'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED', '创建账号时至少授予一个系统角色');
      }
      if (!payload.pendingPasswordHash) {
        throw domainError(500, 'PENDING_CREDENTIAL_REQUIRED', '待启用账号凭据未生成');
      }
      const actorPersonId = maintenanceActorId(payload.actorPersonId);

      return await withTransaction(pool, async executor => {
        await lockAndAssertMaintenanceAuthority(executor, maintenanceContext, 'createAccount', actorPersonId);
        const department = await getActiveDepartment(executor, departmentId, true);
        if (!department) throw domainError(422, 'ACTIVE_DEPARTMENT_REQUIRED', '所选部门不存在或未启用');

        const person = await first(executor, 'SELECT *, CAST(person_id AS CHAR) AS person_id, CAST(current_department_id AS CHAR) AS current_department_id FROM person WHERE employee_no=? FOR UPDATE', [employeeNo]);
        if (!person) {
          throw domainError(409, 'PERSON_DIRECTORY_RECORD_REQUIRED', '该工号尚无员工记录，请由行政人事在组织与员工目录维护后再赋予账号');
        }
        if (text(person.person_name) !== name || !sameIdentityInteger(person.current_department_id, departmentId)) {
          throw domainError(409, 'PERSON_IDENTITY_MISMATCH', '姓名或部门与员工目录不一致，请由行政人事在组织与员工目录维护，账号接口不能修改员工信息');
        }
        if (person.status !== 'active' || person.employment_status !== 'active') {
          throw domainError(422, 'PERSON_INACTIVE', '人员不是有效在职状态，不能赋予账号');
        }
        const personId = identityInteger(person.person_id);
        const account = await first(executor, 'SELECT CAST(account_id AS CHAR) AS account_id FROM user_accounts WHERE person_id=CAST(? AS SIGNED) FOR UPDATE', [identityReadParam(personId)]);
        if (account) throw domainError(409, 'ACCOUNT_EXISTS', '该人员已经存在账号');

        await executor.execute(`
          INSERT INTO user_accounts (
            person_id, login_name, password_hash, must_change_password,
            account_status, auth_version
          )
          VALUES (CAST(? AS SIGNED), ?, ?, 1, 'pending_activation', 1)
        `, [identityReadParam(personId), loginName, payload.pendingPasswordHash]);
        const accountId = await maintenanceInsertId(executor);

        await writeAccessEvent(executor, {
          eventType: 'account_created',
          actorPersonId,
          targetPersonId: personId,
          accountId,
          reason: text(payload.reason) || '管理员手工创建待启用账号',
          details: { creationMode: 'existing_person', loginName, employeeNo, departmentId, accountStatus: 'pending_activation' }
        }, true);

        for (const assignmentInput of roleAssignments) {
          const assignment = validateRoleAssignmentInput(assignmentInput, departmentId, true);
          const granted = await grantRoleAssignment(executor, personId, assignment, actorPersonId, true);
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
          }, true);
        }

        const created = await getAccountRecord(executor, personId, true);
        created.roleAssignments = await listRoleAssignments(executor, personId, true, true);
        return created;
      });
    },

    async assignAccount(personId, payload = {}) {
      personId = identityInteger(personId);
      if (!personId) throw domainError(422, 'INVALID_PERSON_ID', '人员标识无效');
      const expected = payload.expectedPerson;
      if (!expected || typeof expected !== 'object' || !text(expected.employeeNo) || !text(expected.name) || !identityInteger(expected.departmentId)) {
        throw domainError(422, 'PERSON_SNAPSHOT_REQUIRED', '请从人员列表选择已有人员后重新办理');
      }
      if (!payload.pendingPasswordHash) throw domainError(500, 'PENDING_CREDENTIAL_REQUIRED', '待启用账号凭据未生成');
      const actorPersonId = maintenanceActorId(payload.actorPersonId);
      return await withTransaction(pool, async executor => {
        await lockAndAssertMaintenanceAuthority(executor, maintenanceContext, 'assignAccount', actorPersonId);
        // Serialize with the existing employee-number creation path. Current
        // locking reads prevent an earlier actor read from hiding target changes.
        const record = await first(executor, `
          SELECT ${identityReadColumn('person_id')}, employee_no, person_name,
                 ${identityReadColumn('current_department_id')}, employment_status, status
          FROM person WHERE person_id=CAST(? AS SIGNED) FOR UPDATE
        `, [identityReadParam(personId)]);
        if (!record) throw domainError(404, 'PERSON_NOT_FOUND', '人员不存在，请刷新人员列表');
        const person = normalizeIdentityRead(record, ['person_id', 'current_department_id']);
        const existing = await first(executor, 'SELECT CAST(account_id AS CHAR) AS account_id FROM user_accounts WHERE person_id=CAST(? AS SIGNED) FOR UPDATE', [identityReadParam(personId)]);
        if (existing) throw domainError(409, 'ACCOUNT_EXISTS', '该人员已经存在账号');
        if (person.status !== 'active' || person.employment_status !== 'active') throw domainError(422, 'PERSON_INACTIVE', '人员不是有效在职状态，不能赋予账号');
        if (text(person.employee_no) !== text(expected.employeeNo) || text(person.person_name) !== text(expected.name) || !sameIdentityInteger(person.current_department_id, expected.departmentId)) {
          throw domainError(409, 'PERSON_IDENTITY_CHANGED', '人员工号、姓名或部门已变化，原输入已保留，请刷新后重新办理');
        }
        const department = await first(executor, 'SELECT CAST(id AS CHAR) AS id, status FROM departments WHERE id=CAST(? AS SIGNED) FOR SHARE', [identityReadParam(person.current_department_id)]);
        if (!department || department.status !== 'active') throw domainError(422, 'ACTIVE_DEPARTMENT_REQUIRED', '人员所属部门不存在或未启用');
        const loginName = text(person.employee_no);
        if (loginName.toLowerCase() === 'admin' && require('./systemAdminIdentity').enabled()) throw domainError(409, 'SYSTEM_ADMIN_LOGIN_RESERVED', 'admin是独立系统维护登录名，不可用作人员账号');
        await executor.execute(`
          INSERT INTO user_accounts (person_id, login_name, password_hash, must_change_password, account_status, auth_version)
          VALUES (CAST(? AS SIGNED), ?, ?, 1, 'pending_activation', 1)
        `, [identityReadParam(personId), loginName, payload.pendingPasswordHash]);
        const accountId = await maintenanceInsertId(executor);
        await writeAccessEvent(executor, {
          eventType: 'account_created', actorPersonId, targetPersonId: personId, accountId,
          reason: text(payload.reason) || '管理员为已有人员赋予账号',
          details: { creationMode: 'existing_person', loginName, employeeNo: person.employee_no, departmentId: person.current_department_id, accountStatus: 'pending_activation' }
        }, true);
        return await getAccountRecord(executor, personId, true, true);
      });
    },

    async updateAccount(personId, payload = {}) {
      const actorPersonId = maintenanceActorId(payload.actorPersonId);
      if (Array.isArray(payload.roleAssignments) && payload.roleAssignments.some(assignment => text(assignment && (assignment.roleCode || assignment.role_code)) === 'department_mdm_reviewer')) {
        throw domainError(422, 'DEPARTMENT_HEAD_DEDICATED_GRANT_REQUIRED', '部门负责人请通过新增角色授权一次完成授权和负责人登记');
      }
      return await withTransaction(pool, async executor => {
        await lockAndAssertMaintenanceAuthority(executor, maintenanceContext, 'updateAccount', actorPersonId);
        const account = await getAccountRecord(executor, personId, true, true);
        if (!account) throw domainError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
        // Legacy clients may submit an unchanged person snapshot. This API
        // no longer writes directory facts or changes sessions for a no-op.
        const changedFields = [];
        if (payload.name !== undefined && text(payload.name) !== text(account.person_name)) changedFields.push('name');
        if (payload.employeeNo !== undefined && text(payload.employeeNo) !== text(account.employee_no)) changedFields.push('employeeNo');
        if (Object.prototype.hasOwnProperty.call(payload, 'departmentId') &&
            !(payload.departmentId == null && account.current_department_id == null) &&
            !sameIdentityInteger(payload.departmentId, account.current_department_id)) changedFields.push('departmentId');
        if (changedFields.length) {
          throw domainError(409, 'PERSON_DIRECTORY_MAINTENANCE_REQUIRED', '员工信息请由行政人事在组织与员工目录维护，账号接口不能修改员工信息', { fields: changedFields });
        }
        if (payload.roleAssignments !== undefined && (!Array.isArray(payload.roleAssignments) || payload.roleAssignments.length)) {
          throw domainError(409, 'ACCOUNT_ROLE_ASSIGNMENT_ENDPOINT_REQUIRED', '角色变更请通过账号授权办理，不能随员工信息提交');
        }
        return account;
      });
    },

    async grantRole(personId, payload = {}) {
      const actorPersonId = maintenanceActorId(payload.actorPersonId);
      return await withTransaction(pool, async executor => {
        await lockAndAssertMaintenanceAuthority(executor, maintenanceContext, 'grantRole', actorPersonId);
        const account = await getAccountRecord(executor, personId, true);
        if (!account) throw domainError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
        const assignment = validateRoleAssignmentInput(payload, account.current_department_id, true);
        const granted = await grantRoleAssignment(executor, personId, assignment, actorPersonId, true);
        await executor.execute(
          'UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=CAST(? AS SIGNED)',
          [identityReadParam(personId)]
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
            effectiveTo: assignment.effectiveTo,
            ...(granted.departmentAppointment ? { departmentAppointment: granted.departmentAppointment, previousRoleAssignment: granted.previousRoleAssignment || null } : {})
          }
        }, true);
        const result = (await listRoleAssignments(executor, personId, true, true)).find(item => item.assignmentId === granted.personRoleId);
        return granted.departmentAppointment ? { ...result, departmentAppointment: granted.departmentAppointment } : result;
      });
    },

    async revokeRole(personId, assignmentId, payload = {}) {
      const reason = text(payload.reason);
      if (!reason) throw domainError(422, 'ROLE_REVOCATION_REASON_REQUIRED', '撤销角色时必须填写原因');
      const actorPersonId = maintenanceActorId(payload.actorPersonId);
      return await withTransaction(pool, async executor => {
        await lockAndAssertMaintenanceAuthority(executor, maintenanceContext, 'revokeRole', actorPersonId);
        const account = await getAccountRecord(executor, personId, true);
        if (!account) throw domainError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
        const assignment = await first(executor, `
          SELECT pr.*, ${identityReadColumn('pr.person_role_id')}, ${identityReadColumn('pr.person_id')}, ${identityReadColumn('pr.role_id')}, ${identityReadColumn('pr.scope_department_id')}, ${identityReadColumn('pr.assigned_by_person_id')}, ${identityReadColumn('pr.revoked_by_person_id')}, r.role_code
          FROM person_roles pr
          JOIN roles r ON r.role_id=pr.role_id
          WHERE pr.person_id=CAST(? AS SIGNED) AND pr.person_role_id=CAST(? AS SIGNED)
          FOR UPDATE OF pr FOR SHARE OF r
        `, [identityReadParam(personId), identityReadParam(assignmentId)]);
        if (!assignment) throw domainError(404, 'ROLE_ASSIGNMENT_NOT_FOUND', '角色授权记录不存在');
        if (assignment.assignment_status !== 'active') {
          return { revoked: true, idempotent: true };
        }
        if (assignment.role_code === 'admin' && await countActiveAdmins(executor, personId, true) < 1) {
          throw domainError(409, 'LAST_ACTIVE_ADMIN', '不能撤销最后一个有效管理员');
        }

        const remaining = await first(executor, `
          SELECT COUNT(*) AS count
          FROM person_roles pr
          JOIN roles r ON r.role_id=pr.role_id
          WHERE pr.person_id=CAST(? AS SIGNED)
            AND pr.assignment_status='active'
            AND pr.person_role_id<>CAST(? AS SIGNED)
            AND r.status='active'
            AND r.model_version=?
            AND pr.effective_from IS NOT NULL
            AND pr.effective_from<=CURRENT_DATE
            AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
        `, [identityReadParam(personId), identityReadParam(assignmentId), ACCESS_MODEL_VERSION]);
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
              revoked_by_person_id=CAST(? AS SIGNED),
              revoked_at=CURRENT_TIMESTAMP,
              revocation_reason=?
          WHERE person_role_id=CAST(? AS SIGNED)
        `, [identityReadParam(actorPersonId), reason, identityReadParam(assignmentId)]);
        await executor.execute(`
          UPDATE user_accounts
          SET account_status=CASE WHEN ? THEN 'disabled' ELSE account_status END,
              auth_version=auth_version+1,
              updated_at=CURRENT_TIMESTAMP
          WHERE person_id=CAST(? AS SIGNED)
        `, [payload.disableAccount ? 1 : 0, identityReadParam(personId)]);
        await writeAccessEvent(executor, {
          eventType: 'role_revoked',
          actorPersonId,
          targetPersonId: personId,
          accountId: account.account_id,
          personRoleId: assignmentId,
          reason,
          details: { roleCode: assignment.role_code, disabledAccount: Boolean(payload.disableAccount) }
        }, true);
        if (payload.disableAccount) {
          await writeAccessEvent(executor, {
            eventType: 'account_disabled',
            actorPersonId,
            targetPersonId: personId,
            accountId: account.account_id,
            reason
          }, true);
        }
        return { revoked: true, idempotent: false };
      });
    },

    async activateAccount(personId, payload = {}) {
      if (!payload.passwordHash) throw domainError(500, 'PASSWORD_HASH_REQUIRED', '临时密码凭据未生成');
      const actorPersonId = maintenanceActorId(payload.actorPersonId);
      return await withTransaction(pool, async executor => {
        await lockAndAssertMaintenanceAuthority(executor, maintenanceContext, 'activateAccount', actorPersonId);
        const account = await assertAccountCanActivate(executor, personId);
        if (account.account_status !== 'pending_activation') {
          throw domainError(409, 'ACCOUNT_NOT_PENDING_ACTIVATION', '只有待启用账号可以执行首次启用');
        }
        await executor.execute(`
          UPDATE user_accounts
          SET password_hash=?, must_change_password=1,
              account_status='active', auth_version=auth_version+1,
              updated_at=CURRENT_TIMESTAMP
          WHERE person_id=CAST(? AS SIGNED)
        `, [payload.passwordHash, identityReadParam(personId)]);
        await writeAccessEvent(executor, {
          eventType: 'account_activated',
          actorPersonId,
          targetPersonId: personId,
          accountId: account.account_id,
          reason: text(payload.reason) || '管理员明确启用账号'
        }, true);
        return await getAccountRecord(executor, personId, true);
      });
    },

    async enableAccount(personId, payload = {}) {
      const actorPersonId = maintenanceActorId(payload.actorPersonId);
      return await withTransaction(pool, async executor => {
        await lockAndAssertMaintenanceAuthority(executor, maintenanceContext, 'enableAccount', actorPersonId);
        const account = await assertAccountCanActivate(executor, personId);
        if (account.account_status === 'pending_activation') {
          throw domainError(409, 'ACCOUNT_REQUIRES_ACTIVATION', '待启用账号必须先执行首次启用并生成临时密码');
        }
        if (account.account_status === 'active') return { ...account, idempotent: true };
        await executor.execute(`
          UPDATE user_accounts
          SET account_status='active', auth_version=auth_version+1, updated_at=CURRENT_TIMESTAMP
          WHERE person_id=CAST(? AS SIGNED)
        `, [identityReadParam(personId)]);
        await writeAccessEvent(executor, {
          eventType: 'account_enabled',
          actorPersonId,
          targetPersonId: personId,
          accountId: account.account_id,
          reason: text(payload.reason) || '管理员恢复账号'
        }, true);
        return await getAccountRecord(executor, personId, true);
      });
    },

    async disableAccount(personId, payload = {}) {
      const reason = text(payload.reason);
      if (!reason) throw domainError(422, 'ACCOUNT_DISABLE_REASON_REQUIRED', '停用账号时必须填写原因');
      const actorPersonId = maintenanceActorId(payload.actorPersonId);
      return await withTransaction(pool, async executor => {
        await lockAndAssertMaintenanceAuthority(executor, maintenanceContext, 'disableAccount', actorPersonId);
        const account = await getAccountRecord(executor, personId, true);
        if (!account || !account.account_id) throw domainError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
        const adminRole = await first(executor, `
          SELECT ${identityReadColumn('pr.person_role_id')}
          FROM person_roles pr
          JOIN roles r ON r.role_id=pr.role_id
          WHERE pr.person_id=CAST(? AS SIGNED) AND pr.assignment_status='active' AND r.role_code='admin'
          LIMIT 1
        `, [identityReadParam(personId)]);
        if (adminRole && await countActiveAdmins(executor, personId, true) < 1) {
          throw domainError(409, 'LAST_ACTIVE_ADMIN', '不能停用最后一个有效管理员');
        }
        if (account.account_status === 'disabled') return { ...account, idempotent: true };
        await executor.execute(`
          UPDATE user_accounts
          SET account_status='disabled', auth_version=auth_version+1, updated_at=CURRENT_TIMESTAMP
          WHERE person_id=CAST(? AS SIGNED)
        `, [identityReadParam(personId)]);
        await writeAccessEvent(executor, {
          eventType: 'account_disabled',
          actorPersonId,
          targetPersonId: personId,
          accountId: account.account_id,
          reason
        }, true);
        return await getAccountRecord(executor, personId, true);
      });
    },

    async resetPassword(personId, payload = {}) {
      if (!payload.passwordHash) throw domainError(500, 'PASSWORD_HASH_REQUIRED', '临时密码凭据未生成');
      const actorPersonId = maintenanceActorId(payload.actorPersonId);
      return await withTransaction(pool, async executor => {
        await lockAndAssertMaintenanceAuthority(executor, maintenanceContext, 'resetPassword', actorPersonId);
        const account = await getAccountRecord(executor, personId, true);
        if (!account || !account.account_id) throw domainError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
        await executor.execute(`
          UPDATE user_accounts
          SET password_hash=?, must_change_password=1, auth_version=auth_version+1,
              updated_at=CURRENT_TIMESTAMP
          WHERE person_id=CAST(? AS SIGNED)
        `, [payload.passwordHash, identityReadParam(personId)]);
        await writeAccessEvent(executor, {
          eventType: 'password_reset',
          actorPersonId,
          targetPersonId: personId,
          accountId: account.account_id,
          reason: text(payload.reason) || '管理员重置临时密码'
        }, true);
        return await getAccountRecord(executor, personId, true);
      });
    },

    async listAccessEvents(filters = {}) {
      const systemEnabled = require('./systemAdminIdentity').enabled();
      const params = [];
      const clauses = [];
      if (filters.personId) {
        clauses.push('(e.target_person_id=CAST(? AS SIGNED) OR e.actor_person_id=CAST(? AS SIGNED))');
        params.push(identityReadParam(filters.personId), identityReadParam(filters.personId));
      }
      if (filters.eventType) {
        clauses.push('e.event_type=?');
        params.push(filters.eventType);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
      const events = await rows(pool, `
        SELECT ${identityReadColumn('e.event_id')}, e.event_type, ${identityReadColumn('e.actor_person_id')},
               ${systemEnabled ? "COALESCE(actor.person_name,sa.login_name)" : 'actor.person_name'} AS actor_name,
               ${systemEnabled ? identityReadColumn('se.actor_account_id', 'actor_system_account_id') : 'NULL AS actor_system_account_id'},
               ${identityReadColumn('e.target_person_id')}, target.person_name AS target_name,
               ${identityReadColumn('e.account_id')}, ${identityReadColumn('e.person_role_id')}, e.reason, e.payload_json,
               e.migration_batch_id, e.created_at
        FROM identity_access_events e
        LEFT JOIN person actor ON actor.person_id=e.actor_person_id
        ${systemEnabled ? 'LEFT JOIN system_admin_events se ON se.identity_event_id=e.event_id LEFT JOIN system_admin_accounts sa ON sa.account_id=se.actor_account_id' : ''}
        LEFT JOIN person target ON target.person_id=e.target_person_id
        ${where}
        ORDER BY e.created_at DESC, e.event_id DESC
        LIMIT ${limit}
      `, params);
      return events.map(event => normalizeIdentityRead(event, ['event_id', 'actor_person_id', 'actor_system_account_id', 'target_person_id', 'account_id', 'person_role_id']));
    },

    async recordGovernanceDecision(payload = {}) {
      const recorderPersonId = identityInteger(payload.recorderPersonId);
      const departmentId = identityInteger(payload.departmentId);
      const subjectDomain = text(payload.subjectDomain);
      const subjectType = text(payload.subjectType);
      const subjectId = text(payload.subjectId);
      const subjectVersion = text(payload.subjectVersion);
      const decision = text(payload.decision);
      const decisionBasis = text(payload.decisionBasis);
      const evidenceReference = text(payload.evidenceReference) || null;
      const suppliedDecidedAt = text(payload.decidedAt);
      if (!recorderPersonId || !departmentId || !subjectDomain || !subjectType ||
          !subjectId || !subjectVersion || !decision || !decisionBasis) {
        throw domainError(422, 'DECISION_REQUIRED_FIELDS_MISSING', '治理对象、部门、决定和依据均为必填');
      }
      if (!['process', 'data', 'term'].includes(subjectDomain)) {
        throw domainError(422, 'INVALID_DECISION_DOMAIN', '治理领域必须是process、data或term');
      }
      if (!['approved', 'returned', 'rejected'].includes(decision)) {
        throw domainError(422, 'INVALID_DECISION', '决定值必须是approved、returned或rejected');
      }
      if (suppliedDecidedAt) {
        throw domainError(422, 'DECIDED_AT_SERVER_CONTROLLED', '本人最终确认时间由系统记录，请勿另行填写决定时间');
      }

      return await withTransaction(pool, async executor => {
        if (!payload.actor || !sameIdentityInteger(payload.actor.personId, recorderPersonId)) {
          throw domainError(401, 'DEPARTMENT_ACCOUNTABILITY_ACTOR_REQUIRED', '本人最终确认须绑定当前有效登录身份');
        }
        const authority = await require('./departmentAccountability').assertDepartmentAccountability(
          executor, payload.actor, departmentId, { lock: true, requiredPermission: 'governance:record-department-decision' });
        await assertDecisionSubjectScope(executor, {
          subjectDomain,
          subjectType,
          subjectId,
          subjectVersion,
          departmentId
        });
        const department = await first(executor, `SELECT p.person_name AS final_responsible_person_name
          FROM person p WHERE p.person_id=CAST(? AS SIGNED)`, [identityReadParam(authority.final_responsible_person_id)]);
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `, [
          subjectDomain,
          subjectType,
          subjectId,
          subjectVersion,
          departmentId,
          authority.final_responsible_person_id,
          recorderPersonId,
          decision,
          decisionBasis,
          evidenceReference,
          latest ? latest.decision_record_id : null
        ]);
        return {
          decisionRecordId: insertId(result),
          accountablePersonId: identityInteger(authority.final_responsible_person_id),
          accountablePersonName: department && department.final_responsible_person_name || null,
          policyVersion: authority.policy_version,
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
          SELECT decision_record_id,decision,accountable_person_id,recorded_by_person_id,decided_at
          FROM governance_decision_records
          WHERE subject_domain=? AND subject_type=? AND subject_id=?
            AND subject_version=? AND department_id=?
          ORDER BY created_at DESC, decision_record_id DESC
          LIMIT 1
        `, [subjectDomain, subjectType, subjectId, subjectVersion, departmentId]);
        const postPolicy = decision && await require('./departmentAccountability').isPostPolicyDecision(pool, decision.decision_record_id);
        const postAppointment = decision && await require('./departmentAccountability').isPostAppointmentDecision(pool, departmentId, decision.decision_record_id);
        let authority = null;
        if (decision && postPolicy && sameIdentityInteger(decision.accountable_person_id, decision.recorded_by_person_id)) {
          const account = await first(pool, `SELECT CAST(account_id AS CHAR) account_id,CAST(auth_version AS CHAR) auth_version
            FROM user_accounts WHERE person_id=CAST(? AS SIGNED)`, [identityReadParam(decision.accountable_person_id)]);
          if (account) authority = await require('./departmentAccountability').inspectDepartmentAccountability(pool,
            { personId: decision.accountable_person_id, accountId: account.account_id, authVersion: account.auth_version }, departmentId);
        }
        if (
          !decision ||
          decision.decision !== 'approved' ||
          !sameIdentityInteger(decision.accountable_person_id, department.final_responsible_person_id) ||
          !postPolicy || !postAppointment || !authority || !authority.eligible
        ) {
          incompleteDepartments.push({
            departmentId,
            departmentName: department.name,
            reason: !decision
              ? '尚未记录部门决定'
              : decision.decision !== 'approved'
                ? '最新部门决定不是同意'
                : '须由当前部门负责人本人重新核对并最终确认；历史意见继续保留'
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
