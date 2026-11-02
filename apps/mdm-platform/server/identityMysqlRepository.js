const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const { ACCESS_MODEL_VERSION } = require('./roleDefinitions');
const systemAdmin = require('./systemAdminIdentity');
const { sessionSubject, identityInteger, sameIdentityInteger } = require('./sessionSubject');
const {
  ensureRbacRaciV2Schema,
  seedFixedAccessModel
} = require('./rbacRaciMysqlMigration');

async function rows(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return Array.isArray(result) ? result : [];
}

async function first(pool, sql, params = []) {
  const result = await rows(pool, sql, params);
  return result[0] || null;
}

// Read projections only. CAST aliases replace the selected identity columns,
// leaving SELECT * and all unknown physical columns intact. No snapshot/hash
// consumer uses these department methods; publication keeps its own raw read.
const DEPARTMENT_IDENTITY_FIELDS = ['id', 'parent_id', 'manager_user_id', 'data_owner_user_id',
  'final_responsible_person_id', 'data_owner_person_id', 'created_by', 'updated_by'];
const DEPARTMENT_READ_COLUMNS = `*, ${DEPARTMENT_IDENTITY_FIELDS.map(field => `CAST(${field} AS CHAR) AS ${field}`).join(', ')}`;

function normalizeIdentityRead(row, fields) {
  const result = { ...row };
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(row, field) || row[field] == null) continue;
    const id = identityInteger(row[field]);
    if (id !== null) result[field] = id;
    // Preserve historical non-positive safe values in display reads. These
    // remain invalid identities for session/authority/SQL parameter checks.
    else if (typeof row[field] === 'string' && /^-?\d+$/.test(row[field])) {
      const integer = BigInt(row[field]);
      if (integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)) result[field] = Number(row[field]);
    }
  }
  return result;
}

// Keep every valid identity binding decimal even when a prepared statement is
// reused after a safe-number request. Invalid values cannot select a neighbour;
// undefined is left to the driver's existing parameter-error contract.
function identityReadParam(value) {
  if (value === undefined) return undefined;
  const id = identityInteger(value);
  return id === null ? null : String(id);
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeRoleIds(roleIds) {
  if (!Array.isArray(roleIds)) return [];
  return [...new Set(roleIds.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0))];
}

function affectedRows(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.affectedRows || 0);
}

function insertId(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.insertId || 0);
}

function shouldFallbackFromPersonIdentity(error) {
  const message = String(error && error.message || '');
  const code = String(error && error.code || '');
  return [
    'ER_NO_SUCH_TABLE',
    'ER_BAD_FIELD_ERROR',
    'ER_PARSE_ERROR',
    'ER_DUP_FIELDNAME'
  ].includes(code) || /Unknown (table|column)|doesn.t exist|Duplicate column name|Unhandled SQL .*person|Unhandled SQL .*user_accounts|Unhandled SQL .*person_roles|Unhandled SQL .*roles|Unhandled SQL .*permissions|Unhandled SQL .*role_permissions/i.test(message);
}

function sessionPersonId(session = {}) {
  return sessionSubject(session).kind === 'person' ? identityInteger(session.personId) : null;
}

function legacyIdentityWriteError() {
  const error = new Error('旧身份写接口已停用，请使用 /api/org/accounts');
  error.code = 'LEGACY_IDENTITY_API_RETIRED';
  error.statusCode = 410;
  return error;
}

function normalizePersonUser(row = {}) {
  const personId = identityInteger(row.person_id || row.id);
  const accountId = identityInteger(row.account_id);
  return {
    ...row,
    id: personId,
    personId,
    person_id: personId,
    accountId,
    account_id: accountId,
    name: row.person_name || row.name || '',
    personName: row.person_name || row.name || '',
    employeeNo: row.employee_no || row.login_name || '',
    department_id: identityInteger(row.current_department_id || row.department_id),
    current_department_id: identityInteger(row.current_department_id || row.department_id),
    departmentName: row.department_name || row.dept_name || null,
    role: row.role || null,
    accountStatus: row.account_status || null,
    authVersion: identityInteger(row.auth_version) || 0,
    post: row.post || row.position_name || null
  };
}

function roleCodesToCompatibleRole(roleCodes = []) {
  return roleCodes[0] || null;
}

function deriveDataScopes(user = {}, permissions = []) {
  const scopes = new Set();
  if (permissions.includes('governance:read-global')) {
    scopes.add('global');
  }
  const departmentId = user.department_id || user.current_department_id || user.departmentId;
  if (departmentId) scopes.add(`department:${departmentId}`);
  const personId = user.personId || user.person_id || user.id;
  if (personId) scopes.add(`person:${personId}`);
  return Array.from(scopes);
}

// These values describe current rows; they never grant permission by role alone.
function roleAuthority(roles = []) {
  const roleCodes = new Set(roles.map(role => String(role.code || role.role_code || '').trim()).filter(Boolean));
  return { roleCodes, readOnly: roleCodes.has('admin') };
}

// Formal operations consume only their locked direct assignments. Do not replace
// this with the general identity reader's role-ancestor/field-constraint policy.
function assignmentAuthority(assignments = []) {
  const effects = new Map();
  for (const item of assignments) {
    const code = String(item.perm_code || '').trim();
    if (!code) continue;
    if (String(item.effect || '').trim() === 'deny') effects.set(code, 'deny');
    else if (!effects.has(code)) effects.set(code, 'allow');
  }
  return { ...roleAuthority(assignments), effects };
}

// Caller owns the existing account/person/assignment locks and transaction.
// Each invocation reads current qualifications on that exact connection.
async function readPersonAuthority(db, session, personId, { currentRead = false, includeFieldConstraints = false, accessModelVersion = ACCESS_MODEL_VERSION } = {}) {
  const subject = sessionSubject(session);
  if (subject.kind !== 'person' || !sameIdentityInteger(subject.personId, personId)) return { valid: false };
  // Only identity SELECTs pass through this adapter. Locking reads bypass an
  // earlier repeatable-read snapshot and hold qualifications through commit.
  // The caller still owns the transaction and its account/person/assignment locks.
  const reader = currentRead ? {
    execute(sql, params) {
      if (!/^\s*SELECT\b/i.test(sql)) throw new Error('Current identity reader accepts SELECT only');
      return db.execute(`${sql.trim()} FOR SHARE`, params);
    }
  } : db;
  const identity = makeIdentityMysqlRepository(reader, { accessModelVersion });
  const validation = await identity.validateSession(session);
  if (!validation.valid || !validation.user) return includeFieldConstraints ? { valid: false, reason: validation.reason } : { valid: false };
  if (validation.user.must_change_password) return includeFieldConstraints ? { valid: false, passwordChangeRequired: true } : { valid: false };
  const authority = await readAuthorityDetails(identity, validation.user, personId, includeFieldConstraints);
  if (includeFieldConstraints) authority.department = validation.user.current_department_id == null
    ? null : await identity.getDepartmentById(validation.user.current_department_id);
  return authority;
}

async function readAuthorityDetails(identity, user, personId, includeFieldConstraints = false) {
  const { permSet, fieldConstraints } = await identity.getUserEffectivePermissions(personId);
  const roles = await identity.getUserRoleCodes(personId);
  return { valid: true, user, permissions: permSet, roles, ...roleAuthority(roles), ...(includeFieldConstraints ? { fieldConstraints } : {}) };
}

// Eligibility only: no session, authentication assertion, business write grant or
// locking adapter. The acting reviewer retains the caller's separate locked path.
async function readPersonQualification(db, personId) {
  personId = identityInteger(personId);
  if (!personId) return { valid: false };
  const identity = makeIdentityMysqlRepository(db);
  const user = await identity.getUserById(personId);
  if (!user || user.accountStatus !== 'active' || user.status !== 'active' || user.must_change_password ||
    !sameIdentityInteger(user.personId, personId) || !identityInteger(user.accountId) || !identityInteger(user.authVersion)) return { valid: false };
  return readAuthorityDetails(identity, user, personId);
}

async function executeIfSupported(pool, sql, params = []) {
  try {
    return await pool.execute(sql, params);
  } catch (error) {
    if (shouldFallbackFromPersonIdentity(error)) return null;
    throw error;
  }
}

async function columnExists(pool, tableName, columnName) {
  const row = await first(pool, `
    SELECT 1 AS found
    FROM information_schema.columns
    WHERE table_schema=DATABASE()
      AND table_name=?
      AND column_name=?
    LIMIT 1
  `, [tableName, columnName]);
  return Boolean(row && row.found);
}

async function indexExists(pool, tableName, indexName) {
  const row = await first(pool, `
    SELECT 1 AS found
    FROM information_schema.statistics
    WHERE table_schema=DATABASE()
      AND table_name=?
      AND index_name=?
    LIMIT 1
  `, [tableName, indexName]);
  return Boolean(row && row.found);
}

async function ensureMysqlPersonIdentityColumns(pool) {
  if (!await columnExists(pool, 'person', 'current_department_id')) {
    await pool.execute('ALTER TABLE person ADD COLUMN current_department_id BIGINT NULL AFTER person_name');
  }
  if (!await columnExists(pool, 'person', 'updated_at')) {
    await pool.execute('ALTER TABLE person ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  }
  if (!await indexExists(pool, 'person', 'idx_person_department')) {
    await pool.execute('ALTER TABLE person ADD INDEX idx_person_department (current_department_id)');
  }
}

function normalizePermissionDefinition(permission = {}) {
  return {
    code: permission.code || permission[0],
    resource: permission.resource || permission[1],
    action: permission.action || permission[2],
    description: permission.description || permission[3] || null,
    isDangerous: permission.isDangerous ? 1 : 0,
    defaultScope: permission.defaultScope || 'self_task',
    protectedCore: permission.protectedCore === false ? 0 : 1
  };
}

async function ensureMysqlRbacMetadataColumns(pool) {
  await ensureRbacRaciV2Schema(pool);
}

async function ensureMysqlBuiltInRolesAndPermissions(pool) {
  await seedFixedAccessModel(pool);
}

const PERSON_BUSINESS_COLUMNS = [
  ['process_governance_quality_cases', 'owner_person_id'],
  ['process_governance_quality_cases', 'closed_by_person_id'],
  ['process_governance_quality_case_events', 'actor_person_id'],
  ['process_mapping_todos', 'owner_person_id'],
  ['process_mapping_todos', 'closed_by_person_id'],
  ['process_mapping_todo_events', 'actor_person_id'],
  ['process_governance_issue_batches', 'generated_by_person_id'],
  ['process_governance_issue_participants', 'person_id'],
  ['process_governance_issue_events', 'actor_person_id'],
  ['process_governance_term_tasks', 'created_by_person_id'],
  ['process_governance_term_tasks', 'decided_by_person_id'],
  ['terminology_terms', 'created_by_person_id'],
  ['terminology_terms', 'approved_by_person_id'],
  ['mdm_mapping_records', 'submitted_by_person_id'],
  ['mdm_mapping_approval_tasks', 'assignee_person_id'],
  ['mdm_mapping_approval_tasks', 'operated_by_person_id'],
  ['mdm_mapping_approval_history', 'operator_person_id'],
  ['mdm_mapping_rejection_reasons', 'rejected_by_person_id'],
  ['data_map_objects', 'steward_person_id'],
  ['data_map_objects', 'created_by_person_id'],
  ['data_map_objects', 'updated_by_person_id'],
  ['data_map_contexts', 'owner_person_id'],
  ['data_map_contexts', 'created_by_person_id'],
  ['data_map_contexts', 'updated_by_person_id'],
  ['data_map_fields', 'submitted_by_person_id'],
  ['data_map_fields', 'reviewed_by_person_id'],
  ['data_map_field_identities', 'owner_person_id'],
  ['data_map_field_identities', 'confirmed_by_person_id'],
  ['mdm_conflict_assignments', 'assignee_person_id'],
  ['mdm_conflict_assignments', 'assigned_by_person_id'],
  ['mdm_conflict_coordination_history', 'assignee_person_id'],
  ['mdm_todos', 'completed_by_person_id'],
  ['mdm_todos', 'created_by_person_id'],
  ['mdm_todo_events', 'actor_person_id'],
  ['mdm_change_sets', 'operated_by_person_id'],
  ['mdm_version_log', 'operated_by_person_id'],
  ['data_map_terms', 'created_by_person_id'],
  ['data_map_terms', 'updated_by_person_id'],
  ['data_map_naming_rules', 'created_by_person_id'],
  ['data_map_naming_rules', 'updated_by_person_id'],
  ['data_map_quality_issues', 'created_by_person_id'],
  ['data_map_quality_issues', 'resolved_by_person_id']
];

const PERSON_FIELD_MIGRATIONS = [
  ['departments', 'manager_user_id', 'final_responsible_person_id'],
  ['departments', 'data_owner_user_id', 'data_owner_person_id'],
  ['process_governance_quality_cases', 'owner_user_id', 'owner_person_id'],
  ['process_governance_quality_cases', 'closed_by', 'closed_by_person_id'],
  ['process_governance_quality_case_events', 'actor_user_id', 'actor_person_id'],
  ['process_mapping_todos', 'owner_user_id', 'owner_person_id'],
  ['process_mapping_todos', 'closed_by', 'closed_by_person_id'],
  ['process_mapping_todo_events', 'actor_user_id', 'actor_person_id'],
  ['process_governance_issue_batches', 'generated_by', 'generated_by_person_id'],
  ['process_governance_issue_participants', 'user_id', 'person_id'],
  ['process_governance_issue_events', 'actor_user_id', 'actor_person_id'],
  ['process_governance_term_tasks', 'created_by', 'created_by_person_id'],
  ['process_governance_term_tasks', 'decided_by', 'decided_by_person_id'],
  ['terminology_terms', 'created_by', 'created_by_person_id'],
  ['terminology_terms', 'approved_by', 'approved_by_person_id'],
  ['mdm_mapping_records', 'submitted_by', 'submitted_by_person_id'],
  ['mdm_mapping_approval_tasks', 'assignee_user_id', 'assignee_person_id'],
  ['mdm_mapping_approval_tasks', 'operated_by', 'operated_by_person_id'],
  ['mdm_mapping_approval_history', 'operator_user_id', 'operator_person_id'],
  ['mdm_mapping_rejection_reasons', 'rejected_by', 'rejected_by_person_id'],
  ['data_map_objects', 'steward_user_id', 'steward_person_id'],
  ['data_map_objects', 'created_by', 'created_by_person_id'],
  ['data_map_objects', 'updated_by', 'updated_by_person_id'],
  ['data_map_contexts', 'owner_user_id', 'owner_person_id'],
  ['data_map_contexts', 'created_by', 'created_by_person_id'],
  ['data_map_contexts', 'updated_by', 'updated_by_person_id'],
  ['data_map_fields', 'submitted_by', 'submitted_by_person_id'],
  ['data_map_fields', 'reviewed_by', 'reviewed_by_person_id'],
  ['data_map_field_identities', 'owner_user_id', 'owner_person_id'],
  ['data_map_field_identities', 'confirmed_by', 'confirmed_by_person_id'],
  ['mdm_conflict_assignments', 'assignee_user_id', 'assignee_person_id'],
  ['mdm_conflict_assignments', 'assigned_by', 'assigned_by_person_id'],
  ['mdm_conflict_coordination_history', 'assignee_user_id', 'assignee_person_id'],
  ['mdm_todos', 'completed_by', 'completed_by_person_id'],
  ['mdm_todos', 'created_by', 'created_by_person_id'],
  ['mdm_todo_events', 'actor_user_id', 'actor_person_id'],
  ['mdm_change_sets', 'operated_by', 'operated_by_person_id'],
  ['mdm_version_log', 'operated_by', 'operated_by_person_id'],
  ['data_map_terms', 'created_by', 'created_by_person_id'],
  ['data_map_terms', 'updated_by', 'updated_by_person_id'],
  ['data_map_naming_rules', 'created_by', 'created_by_person_id'],
  ['data_map_naming_rules', 'updated_by', 'updated_by_person_id'],
  ['data_map_quality_issues', 'created_by', 'created_by_person_id'],
  ['data_map_quality_issues', 'resolved_by', 'resolved_by_person_id']
];

async function ensureMysqlPersonBusinessColumns(pool) {
  for (const [table, column] of PERSON_BUSINESS_COLUMNS) {
    await executeIfSupported(pool, `ALTER TABLE ${table} ADD COLUMN ${column} BIGINT NULL`);
  }
}

async function migrateLegacyBusinessUsersToPersons(pool) {
  await ensureMysqlPersonBusinessColumns(pool);
  for (const [table, userField, personField] of PERSON_FIELD_MIGRATIONS) {
    await executeIfSupported(pool, `
      UPDATE ${table} target
      JOIN users u ON target.${userField}=u.id
      JOIN person p ON p.employee_no=u.employee_no
      SET target.${personField}=p.person_id
      WHERE target.${userField} IS NOT NULL
        AND target.${personField} IS NULL
    `);
  }
}

async function migrateLegacyIdentityToPersonIdentity(pool) {
  await ensureMysqlPersonIdentityColumns(pool);
  await ensureMysqlRbacMetadataColumns(pool);
  const adminEmployeeNo = String(process.env.MDM_ADMIN_EMPLOYEE_NO || 'ADMIN001').trim();

  await pool.execute(`
    INSERT INTO person (employee_no, person_name, current_department_id, employment_status, status, created_at)
    SELECT u.employee_no, u.name, u.department_id, 'active', 'active', u.created_at
    FROM users u
    ON DUPLICATE KEY UPDATE
      person_name=VALUES(person_name),
      current_department_id=VALUES(current_department_id),
      status='active',
      updated_at=CURRENT_TIMESTAMP
  `);

  await pool.execute(`
    INSERT INTO user_accounts (person_id, login_name, password_hash, must_change_password, account_status)
    SELECT p.person_id, u.employee_no, u.password_hash, u.must_change_password,
           CASE WHEN u.employee_no=? THEN 'active' ELSE 'pending_activation' END
    FROM users u
    JOIN person p ON p.employee_no = u.employee_no
    ON DUPLICATE KEY UPDATE
      login_name=VALUES(login_name),
      updated_at=CURRENT_TIMESTAMP
  `, [adminEmployeeNo]);

  await pool.execute(`
    INSERT IGNORE INTO person_roles (person_id, role_id, assigned_by_person_id)
    SELECT p.person_id, ur.role_id, assigned_person.person_id
    FROM user_roles ur
    JOIN users u ON ur.user_id = u.id
    JOIN person p ON p.employee_no = u.employee_no
    LEFT JOIN users assigned_user ON ur.assigned_by = assigned_user.id
    LEFT JOIN person assigned_person ON assigned_person.employee_no = assigned_user.employee_no
  `);

  await pool.execute(`
    INSERT IGNORE INTO person_roles (person_id, role_id, assigned_by_person_id)
    SELECT p.person_id, r.role_id, NULL
    FROM users u
    JOIN person p ON p.employee_no = u.employee_no
    JOIN roles r ON r.role_code = u.role
  `);

  await migrateLegacyBusinessUsersToPersons(pool);
}

function makeIdentityMysqlRepository(pool, { accessModelVersion = ACCESS_MODEL_VERSION } = {}) {
  async function getUserRoleCodes(userId, legacyRole) {
    if (systemAdmin.accountId(userId)) {
      const user = await systemAdmin.getSystemAdmin(pool, userId);
      return user ? [{ code: 'admin', name: 'MDM系统管理员', scopeType: 'global' }] : [];
    }
    // Keep role calendar dates independent of the Node host timezone.
    return await rows(pool, `
      SELECT r.role_code AS code, r.role_name AS name,
             pr.person_role_id AS assignmentId,
             pr.scope_type AS scopeType,
             pr.scope_department_id AS scopeDepartmentId,
             pr.authorization_basis AS authorizationBasis,
             DATE_FORMAT(pr.effective_from,'%Y-%m-%d') AS effectiveFrom,
             DATE_FORMAT(pr.effective_to,'%Y-%m-%d') AS effectiveTo
      FROM person_roles pr
      JOIN roles r ON pr.role_id = r.role_id
      WHERE pr.person_id=CAST(? AS SIGNED)
        AND r.status='active'
        AND r.model_version=?
        AND pr.assignment_status='active'
        AND pr.effective_from IS NOT NULL
        AND (pr.effective_from IS NULL OR pr.effective_from<=CURRENT_DATE)
        AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
      ORDER BY r.role_group, r.role_code
    `, [String(userId), accessModelVersion]);
  }

  async function getDirectRoleIds(userId) {
    return (await rows(pool, `
      SELECT pr.role_id, CAST(pr.role_id AS CHAR) AS role_id
      FROM person_roles pr
      JOIN roles r ON r.role_id=pr.role_id
      WHERE pr.person_id=CAST(? AS SIGNED)
        AND r.status='active'
        AND r.model_version=?
        AND pr.assignment_status='active'
        AND pr.effective_from IS NOT NULL
        AND (pr.effective_from IS NULL OR pr.effective_from<=CURRENT_DATE)
        AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
    `, [identityReadParam(userId), accessModelVersion])).map(role => normalizeIdentityRead(role, ['role_id']).role_id);
  }

  async function collectRoleAndAncestors(roleIds, executor = pool) {
    const allRoleIds = new Set();

    async function collect(roleId) {
      if (!roleId || allRoleIds.has(roleId)) return;
      allRoleIds.add(roleId);
      const parent = await first(executor, 'SELECT parent_role_id, CAST(parent_role_id AS CHAR) AS parent_role_id FROM roles WHERE role_id=CAST(? AS SIGNED)', [identityReadParam(roleId)]);
      if (parent && parent.parent_role_id) await collect(normalizeIdentityRead(parent, ['parent_role_id']).parent_role_id);
    }

    for (const roleId of roleIds) await collect(roleId);
    return Array.from(allRoleIds);
  }

  async function getUserEffectivePermissions(userId) {
    if (systemAdmin.accountId(userId)) return systemAdmin.permissions(pool, userId);
    const directRoleIds = await getDirectRoleIds(userId);
    if (directRoleIds.length === 0) {
      return { permSet: new Set(), fieldConstraints: {} };
    }

    const allRoleIds = await collectRoleAndAncestors(directRoleIds);
    if (allRoleIds.length === 0) {
      return { permSet: new Set(), fieldConstraints: {} };
    }

    const placeholders = allRoleIds.map(() => 'CAST(? AS SIGNED)').join(',');
    const permissionRows = await rows(pool, `
      SELECT p.perm_code, p.field_constraints, rp.effect
      FROM role_permissions rp
      JOIN permissions p ON rp.perm_id = p.perm_id
      WHERE rp.role_id IN (${placeholders})
      ORDER BY rp.effect ASC
    `, allRoleIds.map(identityReadParam));

    const permSet = new Set();
    const fieldConstraints = {};

    for (const permission of permissionRows) {
      if (permission.effect === 'deny') {
        permSet.delete(permission.perm_code);
      } else {
        permSet.add(permission.perm_code);
        if (permission.field_constraints) {
          const constraints = parseJsonObject(permission.field_constraints, null);
          if (constraints) fieldConstraints[permission.perm_code] = constraints;
        }
      }
    }

    // The retained reviewer code now identifies the department's final
    // accountable person. An old grant alone cannot authorize confirmation.
    const confirmationPermissions = ['governance:review-department', 'governance:record-department-decision'];
    if (confirmationPermissions.some(code => permSet.has(code))) {
      const policyReady = (await require('./departmentAccountability').policyState(pool)).ready;
      const accountable = policyReady && await first(pool, `
        SELECT CAST(pr.person_role_id AS CHAR) AS person_role_id
        FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id
        JOIN person p ON p.person_id=pr.person_id
        JOIN departments d ON d.id=pr.scope_department_id AND d.id=p.current_department_id
        JOIN user_accounts ua ON ua.person_id=p.person_id
        JOIN schema_migrations sm ON sm.migration_key='2026-10-19-department-accountability-v1'
        WHERE pr.person_id=CAST(? AS SIGNED) AND r.role_code='department_mdm_reviewer'
          AND r.status='active' AND r.model_version=? AND pr.assignment_status='active'
          AND pr.scope_type='department' AND pr.effective_from<=CURRENT_DATE
          AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
          AND d.final_responsible_person_id=p.person_id AND d.status='active'
          AND p.status='active' AND p.employment_status='active'
          AND ua.account_status='active' AND ua.must_change_password=0
        LIMIT 1
      `, [identityReadParam(userId), accessModelVersion]);
      if (!accountable) for (const code of confirmationPermissions) {
        permSet.delete(code);
        delete fieldConstraints[code];
      }
    }

    return { permSet, fieldConstraints };
  }

  async function withOptionalTransaction(work) {
    if (typeof pool.getConnection !== 'function') {
      return await work(pool);
    }

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

  async function getPersonAccountByLogin(loginName) {
    const row = await first(pool, `
      SELECT
        CAST(p.person_id AS CHAR) AS person_id,
        p.employee_no,
        p.person_name,
        CAST(p.current_department_id AS CHAR) AS current_department_id,
        p.mobile,
        p.email,
        p.employment_status,
        p.status,
        CAST(ua.account_id AS CHAR) AS account_id,
        ua.login_name,
        ua.password_hash,
        ua.must_change_password,
        ua.account_status,
        CAST(ua.auth_version AS CHAR) AS auth_version,
        d.name AS department_name
      FROM user_accounts ua
      JOIN person p ON ua.person_id = p.person_id
      LEFT JOIN departments d ON p.current_department_id = d.id
      WHERE ua.login_name=?
        AND ua.account_status='active'
        AND p.status='active'
      LIMIT 1
    `, [loginName]);
    return row ? normalizePersonUser(row) : null;
  }

  async function getPersonAccountByPersonId(personId, executor = pool) {
    const row = await first(executor, `
      SELECT
        CAST(p.person_id AS CHAR) AS person_id,
        p.employee_no,
        p.person_name,
        CAST(p.current_department_id AS CHAR) AS current_department_id,
        p.mobile,
        p.email,
        p.employment_status,
        p.status,
        CAST(ua.account_id AS CHAR) AS account_id,
        ua.login_name,
        ua.password_hash,
        ua.must_change_password,
        ua.account_status,
        CAST(ua.auth_version AS CHAR) AS auth_version,
        d.name AS department_name
      FROM person p
      LEFT JOIN user_accounts ua ON ua.person_id = p.person_id
      LEFT JOIN departments d ON p.current_department_id = d.id
      WHERE p.person_id=CAST(? AS SIGNED)
      LIMIT 1
    `, [String(personId)]);
    return row ? normalizePersonUser(row) : null;
  }

  async function readPersonPositionInfo(personId, executor = pool) {
    try {
      const positionRows = await rows(executor, `
        SELECT CAST(p.position_id AS CHAR) AS position_id, p.position_code, p.position_name,
               p.department_admin_level, p.department_admin_title, p.responsibility_scope
        FROM person_position_assignment ppa
        JOIN \`position\` p ON ppa.position_id = p.position_id
        WHERE ppa.person_id=CAST(? AS SIGNED)
          AND ppa.status='active'
        ORDER BY p.department_admin_level IS NULL, p.department_admin_level, p.position_name
      `, [identityReadParam(personId)]);
      const positions = positionRows.map(row => ({
        positionId: normalizeIdentityRead(row, ['position_id']).position_id,
        positionCode: row.position_code,
        positionName: row.position_name,
        departmentAdminLevel: row.department_admin_level,
        departmentAdminTitle: row.department_admin_title,
        responsibilityScope: row.responsibility_scope
      }));
      return { positions, positionInfo: { status: 'available' } };
    } catch (error) {
      // Positions are optional display data, never a source of MDM permissions.
      // A table-scoped MySQL account can receive access denied before MySQL
      // reports that these optional tables do not exist. Keep this exception
      // local: failures reading person/accounts/roles/permissions must propagate.
      const accessDenied = ['ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR'].includes(error.code);
      if (!accessDenied && !shouldFallbackFromPersonIdentity(error)) throw error;
      return {
        positions: [],
        positionInfo: {
          status: 'unavailable',
          code: 'POSITION_INFO_UNAVAILABLE',
          message: '岗位信息暂不可用。当前访问权限仍按有效MDM工作角色计算。'
        }
      };
    }
  }

  async function departmentPath(departmentId, parentId, executor = pool) {
    let path = `/${departmentId}/`;
    if (parentId) {
      const parent = await first(executor, 'SELECT path FROM departments WHERE id=?', [parentId]);
      if (parent && parent.path) path = `${parent.path}${departmentId}/`;
    }
    return path;
  }

  return {
    async initSchema() {
      for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
        await pool.execute(statement);
      }
      await ensureMysqlPersonIdentityColumns(pool);
      await ensureMysqlBuiltInRolesAndPermissions(pool);
    },

    async getUserByLoginName(loginName) {
      if (loginName === 'admin' && systemAdmin.enabled()) {
        const user = await systemAdmin.getSystemAdmin(pool, loginName, { login: true });
        if (user) return user;
      }
      return await getPersonAccountByLogin(loginName);
    },

    async getUserByEmployeeNo(employeeNo) {
      return await getPersonAccountByLogin(employeeNo);
    },

    async getUserById(userId) {
      if (systemAdmin.accountId(userId)) return systemAdmin.getSystemAdmin(pool, userId);
      return await getPersonAccountByPersonId(userId);
    },

    async validateSession(session = {}) {
      if (session.identityKind === 'system_admin') {
        if (session.personId || !systemAdmin.enabled()) return { valid: false };
        const user = await systemAdmin.getSystemAdmin(pool, systemAdmin.principal(session.accountId));
        return { valid: Boolean(user && sameIdentityInteger(user.authVersion, session.authVersion)), user };
      }
      const personId = sessionPersonId(session);
      if (!personId) return { valid: false, reason: 'missing_person' };
      const user = await getPersonAccountByPersonId(personId);
      if (!user || user.accountStatus !== 'active' || user.status !== 'active') {
        return { valid: false, reason: 'account_inactive' };
      }
      if (!sameIdentityInteger(session.accountId, user.accountId)) {
        return { valid: false, reason: 'account_changed' };
      }
      if (!sameIdentityInteger(session.authVersion, user.authVersion)) {
        return { valid: false, reason: 'authorization_changed' };
      }
      return { valid: true, user };
    },

    async recordSuccessfulLogin(personId) {
      if (systemAdmin.accountId(personId)) {
        return pool.execute("UPDATE system_admin_accounts SET last_login_at=CURRENT_TIMESTAMP WHERE account_id=? AND account_status='active'", [systemAdmin.accountId(personId)]);
      }
      await pool.execute(
        'UPDATE user_accounts SET last_login_at=CURRENT_TIMESTAMP WHERE person_id=? AND account_status=\'active\'',
        [personId]
      );
    },

    getUserRoleCodes,

    async listDepartments() {
      const departments = await rows(pool, `SELECT ${DEPARTMENT_READ_COLUMNS} FROM departments ORDER BY code`);
      return departments.map(row => normalizeIdentityRead(row, DEPARTMENT_IDENTITY_FIELDS));
    },

    async getDepartmentById(departmentId) {
      const department = await first(pool, `SELECT ${DEPARTMENT_READ_COLUMNS} FROM departments WHERE id=CAST(? AS SIGNED)`, [identityReadParam(departmentId)]);
      return department ? normalizeIdentityRead(department, DEPARTMENT_IDENTITY_FIELDS) : null;
    },

    async getDepartmentByName(departmentName) {
      const department = await first(pool, `SELECT ${DEPARTMENT_READ_COLUMNS} FROM departments WHERE name=?`, [departmentName]);
      return department ? normalizeIdentityRead(department, DEPARTMENT_IDENTITY_FIELDS) : null;
    },

    async createDepartment(payload = {}) {
      return await withOptionalTransaction(async executor => {
        let result;
        try {
          result = await executor.execute(
            'INSERT INTO departments (name, code, parent_id, department_type, manager_user_id, data_owner_user_id, final_responsible_person_id, data_owner_person_id, source_system, external_id, status, effective_from, effective_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              payload.name,
              payload.code,
              payload.parent_id || null,
              payload.department_type || null,
              payload.manager_user_id || null,
              payload.data_owner_user_id || null,
              payload.final_responsible_person_id || null,
              payload.data_owner_person_id || null,
              payload.source_system || 'MDM_SYS',
              payload.external_id || null,
              payload.status || 'active',
              payload.effective_from || null,
              payload.effective_to || null,
              payload.created_by || null
            ]
          );
        } catch (error) {
          if (!shouldFallbackFromPersonIdentity(error)) throw error;
          result = await executor.execute(
            'INSERT INTO departments (name, code, parent_id, department_type, manager_user_id, data_owner_user_id, source_system, external_id, status, effective_from, effective_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              payload.name,
              payload.code,
              payload.parent_id || null,
              payload.department_type || null,
              payload.manager_user_id || null,
              payload.data_owner_user_id || null,
              payload.source_system || 'MDM_SYS',
              payload.external_id || null,
              payload.status || 'active',
              payload.effective_from || null,
              payload.effective_to || null,
              payload.created_by || null
            ]
          );
        }
        const id = insertId(result);
        await executor.execute('UPDATE departments SET path=? WHERE id=?', [
          await departmentPath(id, payload.parent_id || null, executor),
          id
        ]);
        return { id };
      });
    },

    async updateDepartment(departmentId, payload = {}) {
      const path = await departmentPath(departmentId, payload.parent_id || null);
      let result;
      try {
        result = await pool.execute(
          `UPDATE departments
           SET name=?, code=?, parent_id=?, path=?, department_type=?, sort_order=?,
               manager_user_id=?, data_owner_user_id=?, final_responsible_person_id=?, data_owner_person_id=?,
               source_system=?, external_id=?, status=?, effective_from=?, effective_to=?, updated_by=?
           WHERE id=?`,
          [
            payload.name,
            payload.code,
            payload.parent_id || null,
            path,
            payload.department_type || null,
            payload.sort_order || 0,
            payload.manager_user_id || null,
            payload.data_owner_user_id || null,
            payload.final_responsible_person_id || null,
            payload.data_owner_person_id || null,
            payload.source_system || 'MDM_SYS',
            payload.external_id || null,
            payload.status || 'active',
            payload.effective_from || null,
            payload.effective_to || null,
            payload.updated_by || null,
            departmentId
          ]
        );
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        result = await pool.execute(
          `UPDATE departments
           SET name=?, code=?, parent_id=?, path=?, sort_order=?, department_type=?,
               manager_user_id=?, data_owner_user_id=?, source_system=?, external_id=?,
               status=?, effective_from=?, effective_to=?, updated_by=?
           WHERE id=?`,
          [
            payload.name,
            payload.code,
            payload.parent_id || null,
            path,
            payload.sort_order || 0,
            payload.department_type || null,
            payload.manager_user_id || null,
            payload.data_owner_user_id || null,
            payload.source_system || 'MDM_SYS',
            payload.external_id || null,
            payload.status || 'active',
            payload.effective_from || null,
            payload.effective_to || null,
            payload.updated_by || null,
            departmentId
          ]
        );
      }
      return affectedRows(result) > 0;
    },

    async deleteDepartment(departmentId) {
      const result = await pool.execute('DELETE FROM departments WHERE id=?', [departmentId]);
      return affectedRows(result) > 0;
    },

    async listUsers() {
      const personRows = await rows(pool, `
        SELECT CAST(p.person_id AS CHAR) AS id, CAST(p.person_id AS CHAR) AS person_id, p.person_name AS name, p.employee_no,
               CAST(p.current_department_id AS CHAR) AS department_id, NULL AS post,
               p.created_at, p.status, d.name AS dept_name,
               CAST(ua.account_id AS CHAR) AS account_id, ua.login_name, ua.account_status, CAST(ua.auth_version AS CHAR) AS auth_version,
               ua.must_change_password
        FROM person p
        LEFT JOIN departments d ON p.current_department_id = d.id
        LEFT JOIN user_accounts ua ON ua.person_id=p.person_id
        ORDER BY p.employee_no
      `);
      return personRows.map(row => normalizePersonUser(normalizeIdentityRead(row, ['id', 'person_id', 'department_id', 'account_id', 'auth_version'])));
    },

    async listRoster() {
      const roster = await rows(pool, `
        SELECT CAST(p.person_id AS CHAR) AS person_id, p.employee_no, p.person_name, CAST(p.current_department_id AS CHAR) AS current_department_id,
               p.employment_status, p.status, p.mobile, p.email,
               d.name AS department_name, d.code AS department_code
        FROM person p
        LEFT JOIN departments d ON d.id=p.current_department_id
        ORDER BY p.employee_no, p.person_id
      `);
      const memberships = await rows(pool, `SELECT CAST(m.person_id AS CHAR) AS person_id,CAST(o.org_unit_id AS CHAR) AS id,o.org_unit_code AS code,o.org_unit_name AS name
        FROM office_membership m JOIN org_unit o ON o.org_unit_id=m.office_id WHERE m.status='active' AND o.org_type='office' ORDER BY o.org_unit_code`);
      return roster.map(person => ({...person,person_id:identityInteger(person.person_id),current_department_id:identityInteger(person.current_department_id),offices:memberships.filter(m=>sameIdentityInteger(m.person_id,person.person_id)).map(({person_id,...office})=>({...office,id:identityInteger(office.id)}))}));
    },

    async listUserRoleSummaries() {
      const userRows = await rows(pool, `
        SELECT CAST(p.person_id AS CHAR) AS id, CAST(p.person_id AS CHAR) AS person_id, p.person_name AS name, p.employee_no,
               NULL AS post, CAST(p.current_department_id AS CHAR) AS department_id, p.created_at,
               d.name AS dept_name, ua.account_status,
               COALESCE(GROUP_CONCAT(
                 CASE WHEN r.status='active' AND pr.assignment_status='active'
                   THEN r.role_code ELSE NULL END
                 ORDER BY r.role_code
               ), '') AS rbac_role_codes,
               COALESCE(GROUP_CONCAT(
                 CASE WHEN r.status='active' AND pr.assignment_status='active'
                   THEN r.role_name ELSE NULL END
                 ORDER BY r.role_code
               ), '') AS rbac_role_names
        FROM person p
        LEFT JOIN departments d ON p.current_department_id = d.id
        LEFT JOIN user_accounts ua ON ua.person_id=p.person_id
        LEFT JOIN person_roles pr ON p.person_id = pr.person_id
        LEFT JOIN roles r ON pr.role_id = r.role_id
        GROUP BY p.person_id, ua.account_status
        ORDER BY p.employee_no
      `);
      return userRows.map(row => normalizeIdentityRead(row, ['id', 'person_id', 'department_id'])).map(user => ({
        id: user.id,
        personId: user.person_id || user.id,
        name: user.name,
        employee_no: user.employee_no,
        department_id: user.department_id,
        dept_name: user.dept_name || null,
        post: user.post,
        role: null,
        account_status: user.account_status || null,
        created_at: user.created_at,
        rbac_role_codes: user.rbac_role_codes || '',
        rbac_role_names: user.rbac_role_names || ''
      }));
    },

    async listAssignableUsers(filters = {}) {
      const roleCode = String(filters.roleCode || '').trim();
      const roleJoin = roleCode ? `
        JOIN person_roles pr ON pr.person_id=p.person_id
          AND pr.assignment_status='active'
          AND pr.effective_from<=CURRENT_DATE
          AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
        JOIN roles r ON r.role_id=pr.role_id
          AND r.role_code=?
          AND r.status='active'
          AND r.model_version=?
        JOIN user_accounts ua ON ua.person_id=p.person_id
          AND ua.account_status='active'
      ` : '';
      const userRows = await rows(pool, `
        SELECT CAST(p.person_id AS CHAR) AS id, CAST(p.person_id AS CHAR) AS person_id, p.person_name AS name,
               CAST(p.current_department_id AS CHAR) AS department_id, d.name AS dept_name
        FROM person p
        ${roleJoin}
        LEFT JOIN departments d ON p.current_department_id = d.id
        WHERE p.status='active'
        ORDER BY d.name, p.person_name
      `, roleCode ? [roleCode, accessModelVersion] : []);
      return userRows.map(row => normalizeIdentityRead(row, ['id', 'person_id', 'department_id'])).map(user => ({
        id: user.id,
        personId: user.person_id || user.id,
        name: user.name,
        department_id: user.department_id,
        dept_name: user.dept_name || null
      }));
    },

    async getAssignedRoles(userId) {
      const assignments = await rows(pool, `
        SELECT CAST(r.role_id AS CHAR) AS role_id, r.role_code, r.role_name, r.is_system, r.status,
               CAST(pr.person_role_id AS CHAR) AS person_role_id, pr.scope_type, CAST(pr.scope_department_id AS CHAR) AS scope_department_id,
               pr.authorization_basis, DATE_FORMAT(pr.effective_from,'%Y-%m-%d') AS effective_from,
               DATE_FORMAT(pr.effective_to,'%Y-%m-%d') AS effective_to,
               pr.assignment_status, pr.revocation_reason
        FROM person_roles pr
        JOIN roles r ON pr.role_id = r.role_id
        WHERE pr.person_id=CAST(? AS SIGNED)
        ORDER BY r.status, r.role_group, r.role_code
      `, [identityReadParam(userId)]);
      return assignments.map(row => normalizeIdentityRead(row, ['role_id', 'person_role_id', 'scope_department_id']));
    },

    async getPermissionsGrouped() {
      const permissions = await rows(pool, 'SELECT * FROM permissions ORDER BY resource, action');
      const grouped = {};
      for (const permission of permissions) {
        if (!grouped[permission.resource]) grouped[permission.resource] = [];
        grouped[permission.resource].push(permission);
      }
      return grouped;
    },

    async listRoles() {
      const roles = await rows(pool, `
        SELECT r.*,
          CAST(r.role_id AS CHAR) AS role_id, CAST(r.parent_role_id AS CHAR) AS parent_role_id,
          CAST(r.created_by AS CHAR) AS created_by,
          (SELECT role_name FROM roles pr WHERE pr.role_id = r.parent_role_id) AS parent_role_name,
          (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.role_id) AS perm_count,
          (SELECT COUNT(*) FROM person_roles WHERE role_id = r.role_id AND assignment_status='active') AS user_count
        FROM roles r
        ORDER BY FIELD(r.status, 'active', 'legacy', 'retired'), r.role_group, r.role_code
      `);
      return roles.map(role => normalizeIdentityRead(role, ['role_id', 'parent_role_id', 'created_by']));
    },

    async getRoleDetail(roleId) {
      const roleRow = await first(pool, `SELECT *, CAST(role_id AS CHAR) AS role_id,
        CAST(parent_role_id AS CHAR) AS parent_role_id, CAST(created_by AS CHAR) AS created_by
        FROM roles WHERE role_id=CAST(? AS SIGNED)`, [identityReadParam(roleId)]);
      const role = roleRow && normalizeIdentityRead(roleRow, ['role_id', 'parent_role_id', 'created_by']);
      if (!role) return null;

      const ownPerms = await rows(pool, `
        SELECT CAST(p.perm_id AS CHAR) AS perm_id, p.perm_code, p.resource, p.action, p.field_constraints, p.description, rp.effect, 0 as inherited
        FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id
        WHERE rp.role_id=CAST(? AS SIGNED)
      `, [identityReadParam(roleId)]);
      const knownPermCodes = new Set(ownPerms.map(permission => permission.perm_code));
      const inheritedPerms = [];

      let parentId = role.parent_role_id;
      const visited = new Set();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parentPerms = await rows(pool, `
          SELECT CAST(p.perm_id AS CHAR) AS perm_id, p.perm_code, p.resource, p.action, p.field_constraints, p.description, rp.effect, 1 as inherited
          FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id
          WHERE rp.role_id=CAST(? AS SIGNED)
        `, [identityReadParam(parentId)]);
        for (const permission of parentPerms) {
          if (!knownPermCodes.has(permission.perm_code)) {
            inheritedPerms.push(permission);
            knownPermCodes.add(permission.perm_code);
          }
        }
        const parent = await first(pool, 'SELECT CAST(parent_role_id AS CHAR) AS parent_role_id FROM roles WHERE role_id=CAST(? AS SIGNED)', [identityReadParam(parentId)]);
        parentId = parent ? normalizeIdentityRead(parent, ['parent_role_id']).parent_role_id : null;
      }

      const users = await rows(pool, `
        SELECT CAST(p.person_id AS CHAR) AS id, CAST(p.person_id AS CHAR) AS person_id, p.person_name AS name, p.employee_no,
               CAST(p.current_department_id AS CHAR) AS department_id, NULL AS post, d.name AS dept_name,
               pr.assignment_status, pr.scope_type, CAST(pr.scope_department_id AS CHAR) AS scope_department_id
        FROM person_roles pr
        JOIN person p ON pr.person_id = p.person_id
        LEFT JOIN departments d ON p.current_department_id = d.id
        WHERE pr.role_id=CAST(? AS SIGNED)
      `, [identityReadParam(roleId)]);

      return { ...role,
        permissions: [...ownPerms, ...inheritedPerms].map(permission => normalizeIdentityRead(permission, ['perm_id'])),
        users: users.map(user => normalizeIdentityRead(user, ['id', 'person_id', 'department_id', 'scope_department_id']))
      };
    },

    async getRolePermissionMatrix(roleId) {
      const roleRow = await first(pool, `SELECT *, CAST(role_id AS CHAR) AS role_id,
        CAST(parent_role_id AS CHAR) AS parent_role_id, CAST(created_by AS CHAR) AS created_by
        FROM roles WHERE role_id=CAST(? AS SIGNED)`, [identityReadParam(roleId)]);
      const role = roleRow && normalizeIdentityRead(roleRow, ['role_id', 'parent_role_id', 'created_by']);
      if (!role) return null;

      const allPerms = await rows(pool, 'SELECT *, CAST(perm_id AS CHAR) AS perm_id FROM permissions ORDER BY resource, action');
      const rolePerms = await rows(pool, `
        SELECT p.perm_code, rp.effect FROM role_permissions rp
        JOIN permissions p ON rp.perm_id = p.perm_id WHERE rp.role_id=CAST(? AS SIGNED)
      `, [identityReadParam(roleId)]);
      const rolePermMap = new Map(rolePerms.map(permission => [permission.perm_code, permission.effect]));

      return {
        role,
        matrix: allPerms.map(permission => ({
          ...normalizeIdentityRead(permission, ['perm_id']),
          assigned: rolePermMap.has(permission.perm_code),
          effect: rolePermMap.get(permission.perm_code) || null
        }))
      };
    },

    async createRole(payload = {}) {
      const result = await pool.execute(
        'INSERT INTO roles (role_code, role_name, description, parent_role_id, created_by) VALUES (?, ?, ?, ?, ?)',
        [
          payload.role_code,
          payload.role_name,
          payload.description || null,
          payload.parent_role_id || null,
          payload.created_by || null
        ]
      );
      return { role_id: insertId(result) };
    },

    async updateRole(roleId, payload = {}) {
      const role = await first(pool, 'SELECT * FROM roles WHERE role_id=?', [roleId]);
      if (!role) return false;
      const result = await pool.execute(
        'UPDATE roles SET role_name=?, description=?, parent_role_id=?, updated_at=CURRENT_TIMESTAMP WHERE role_id=?',
        [
          payload.role_name || role.role_name,
          Object.prototype.hasOwnProperty.call(payload, 'description') ? payload.description : role.description,
          Object.prototype.hasOwnProperty.call(payload, 'parent_role_id') ? payload.parent_role_id || null : role.parent_role_id || null,
          roleId
        ]
      );
      return affectedRows(result) > 0;
    },

    async deleteRole(roleId) {
      const role = await first(pool, 'SELECT * FROM roles WHERE role_id=?', [roleId]);
      if (!role) return { deleted: false, reason: 'missing' };
      if (role.is_system) return { deleted: false, reason: 'system' };

      const userCount = await first(pool, 'SELECT COUNT(*) as cnt FROM person_roles WHERE role_id=?', [roleId]);
      if (Number(userCount && userCount.cnt || 0) > 0) {
        return { deleted: false, reason: 'assigned', count: Number(userCount.cnt) };
      }

      const childCount = await first(pool, 'SELECT COUNT(*) as cnt FROM roles WHERE parent_role_id=?', [roleId]);
      if (Number(childCount && childCount.cnt || 0) > 0) {
        return { deleted: false, reason: 'children', count: Number(childCount.cnt) };
      }

      return await withOptionalTransaction(async executor => {
        await executor.execute('DELETE FROM role_permissions WHERE role_id=?', [roleId]);
        await executor.execute('DELETE FROM roles WHERE role_id=?', [roleId]);
        return { deleted: true };
      });
    },

    async replaceRolePermissions(roleId, permIds = [], effects = {}) {
      const role = await first(pool, 'SELECT * FROM roles WHERE role_id=?', [roleId]);
      if (!role) return null;

      const ids = normalizeRoleIds(permIds);
      return await withOptionalTransaction(async executor => {
        await executor.execute('DELETE FROM role_permissions WHERE role_id=?', [roleId]);
        for (const permId of ids) {
          await executor.execute('INSERT INTO role_permissions (role_id, perm_id, effect) VALUES (?, ?, ?)', [
            roleId,
            permId,
            effects && effects[permId] ? effects[permId] : 'allow'
          ]);
        }
        return { success: true, count: ids.length };
      });
    },

    async getCurrentUserPayload(session = {}) {
      if (session.identityKind === 'system_admin') return systemAdmin.currentPayload(pool, session);
      const personId = sessionPersonId(session);
      if (!personId) return null;

      const user = await getPersonAccountByPersonId(personId);
      if (!user) return null;
      const rbacRoles = await getUserRoleCodes(user.personId);
      const roleCodes = rbacRoles.map(role => role.code);
      const { permSet } = await getUserEffectivePermissions(user.personId);
      const permissions = Array.from(permSet);
      const { positions, positionInfo } = await readPersonPositionInfo(user.personId);

      return {
        id: user.personId,
        personId: user.personId,
        accountId: user.accountId || session.accountId || null,
        employeeNo: user.employeeNo,
        personName: user.personName || session.userName || '',
        name: user.personName || session.userName || '',
        role: roleCodesToCompatibleRole(roleCodes),
        accountStatus: user.accountStatus,
        authVersion: user.authVersion,
        departmentId: user.department_id || null,
        departmentName: user.departmentName || null,
        department: user.department_id ? {
          id: user.department_id,
          name: user.departmentName || null
        } : null,
        positions,
        positionInfo,
        rbacRoles,
        roleAssignments: rbacRoles,
        roleCodes,
        permissions,
        dataScopes: deriveDataScopes(user, permissions),
        governanceModelVersion: accessModelVersion
      };
    },

    async getPasswordStatus(userId) {
      if (systemAdmin.accountId(userId)) {
        const user = await systemAdmin.getSystemAdmin(pool, userId);
        return user ? { is_default_password: Boolean(user.must_change_password) } : null;
      }
      const user = await first(pool, 'SELECT must_change_password FROM user_accounts WHERE person_id=?', [userId]);
      if (!user) return null;
      return { is_default_password: Boolean(user.must_change_password) };
    },

    async getPasswordCredential(userId) {
      if (systemAdmin.accountId(userId)) {
        const user = await systemAdmin.getSystemAdmin(pool, userId);
        return user ? { employee_no: null, password_hash: user.password_hash } : null;
      }
      return await first(pool, `
        SELECT p.employee_no, ua.password_hash
        FROM user_accounts ua
        JOIN person p ON ua.person_id = p.person_id
        WHERE ua.person_id=?
      `, [userId]);
    },

    async updateOwnPassword(userId, passwordHash) {
      if (systemAdmin.accountId(userId)) {
        return withOptionalTransaction(async executor => {
          const user = await systemAdmin.getSystemAdmin(executor, userId, { locked: true });
          if (!user) return false;
          await executor.execute('UPDATE system_admin_accounts SET password_hash=?,must_change_password=0,auth_version=auth_version+1 WHERE account_id=?', [passwordHash, user.accountId]);
          await systemAdmin.event(executor, user.accountId, 'password_changed');
          return true;
        }).catch(error => { if (error.code === 'MYSQL_COMMIT_UNKNOWN') throw error; throw systemAdmin.fail('SYSTEM_ADMIN_PASSWORD_UNAVAILABLE', 503); });
      }
      const result = await pool.execute(
        'UPDATE user_accounts SET password_hash=?, must_change_password=0, auth_version=auth_version+1 WHERE person_id=?',
        [passwordHash, userId]
      );
      await pool.execute(`
        INSERT INTO identity_access_events (event_type, actor_person_id, target_person_id, reason)
        VALUES ('password_changed', ?, ?, '用户修改本人密码')
      `, [userId, userId]);
      return affectedRows(result) > 0;
    },

    async createUser(payload = {}) {
      throw legacyIdentityWriteError();
    },

    async updateUser(userId, payload = {}) {
      throw legacyIdentityWriteError();
    },

    async resetUserPassword(userId, passwordHash, mustChangePassword) {
      throw legacyIdentityWriteError();
    },

    async replaceUserRoles(userId, roleIds, assignedBy) {
      throw legacyIdentityWriteError();
    },

    getUserEffectivePermissions
  };
}

module.exports = {
  makeIdentityMysqlRepository,
  readPersonAuthority,
  readPersonQualification,
  roleAuthority,
  assignmentAuthority,
  ensureMysqlBuiltInRolesAndPermissions,
  ensureMysqlPersonIdentityColumns,
  migrateLegacyIdentityToPersonIdentity
};
