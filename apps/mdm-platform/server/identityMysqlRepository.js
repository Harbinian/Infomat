const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const { ACCESS_MODEL_VERSION } = require('./roleDefinitions');
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
  return Number(session.personId || 0) || null;
}

function legacyIdentityWriteError() {
  const error = new Error('旧身份写接口已停用，请使用 /api/org/accounts');
  error.code = 'LEGACY_IDENTITY_API_RETIRED';
  error.statusCode = 410;
  return error;
}

function normalizePersonUser(row = {}) {
  const personId = Number(row.person_id || row.id || 0) || null;
  const accountId = Number(row.account_id || 0) || null;
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
    department_id: row.current_department_id || row.department_id || null,
    current_department_id: row.current_department_id || row.department_id || null,
    departmentName: row.department_name || row.dept_name || null,
    role: row.role || null,
    accountStatus: row.account_status || null,
    authVersion: Number(row.auth_version || 0),
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

function makeIdentityMysqlRepository(pool) {
  async function getUserRoleCodes(userId, legacyRole) {
    return await rows(pool, `
      SELECT r.role_code AS code, r.role_name AS name,
             pr.person_role_id AS assignmentId,
             pr.scope_type AS scopeType,
             pr.scope_department_id AS scopeDepartmentId,
             pr.authorization_basis AS authorizationBasis,
             pr.effective_from AS effectiveFrom,
             pr.effective_to AS effectiveTo
      FROM person_roles pr
      JOIN roles r ON pr.role_id = r.role_id
      WHERE pr.person_id=?
        AND r.status='active'
        AND r.model_version=?
        AND pr.assignment_status='active'
        AND pr.authorization_basis IS NOT NULL
        AND pr.effective_from IS NOT NULL
        AND (pr.effective_from IS NULL OR pr.effective_from<=CURRENT_DATE)
        AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
      ORDER BY r.role_group, r.role_code
    `, [userId, ACCESS_MODEL_VERSION]);
  }

  async function getDirectRoleIds(userId) {
    return (await rows(pool, `
      SELECT pr.role_id
      FROM person_roles pr
      JOIN roles r ON r.role_id=pr.role_id
      WHERE pr.person_id=?
        AND r.status='active'
        AND r.model_version=?
        AND pr.assignment_status='active'
        AND pr.authorization_basis IS NOT NULL
        AND pr.effective_from IS NOT NULL
        AND (pr.effective_from IS NULL OR pr.effective_from<=CURRENT_DATE)
        AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
    `, [userId, ACCESS_MODEL_VERSION])).map(role => role.role_id);
  }

  async function collectRoleAndAncestors(roleIds, executor = pool) {
    const allRoleIds = new Set();

    async function collect(roleId) {
      if (!roleId || allRoleIds.has(roleId)) return;
      allRoleIds.add(roleId);
      const parent = await first(executor, 'SELECT parent_role_id FROM roles WHERE role_id=?', [roleId]);
      if (parent && parent.parent_role_id) await collect(parent.parent_role_id);
    }

    for (const roleId of roleIds) await collect(roleId);
    return Array.from(allRoleIds);
  }

  async function getUserEffectivePermissions(userId) {
    const directRoleIds = await getDirectRoleIds(userId);
    if (directRoleIds.length === 0) {
      return { permSet: new Set(), fieldConstraints: {} };
    }

    const allRoleIds = await collectRoleAndAncestors(directRoleIds);
    if (allRoleIds.length === 0) {
      return { permSet: new Set(), fieldConstraints: {} };
    }

    const placeholders = allRoleIds.map(() => '?').join(',');
    const permissionRows = await rows(pool, `
      SELECT p.perm_code, p.field_constraints, rp.effect
      FROM role_permissions rp
      JOIN permissions p ON rp.perm_id = p.perm_id
      WHERE rp.role_id IN (${placeholders})
      ORDER BY rp.effect ASC
    `, allRoleIds);

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
        p.person_id,
        p.employee_no,
        p.person_name,
        p.current_department_id,
        p.mobile,
        p.email,
        p.employment_status,
        p.status,
        ua.account_id,
        ua.login_name,
        ua.password_hash,
        ua.must_change_password,
        ua.account_status,
        ua.auth_version,
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
        p.person_id,
        p.employee_no,
        p.person_name,
        p.current_department_id,
        p.mobile,
        p.email,
        p.employment_status,
        p.status,
        ua.account_id,
        ua.login_name,
        ua.password_hash,
        ua.must_change_password,
        ua.account_status,
        ua.auth_version,
        d.name AS department_name
      FROM person p
      LEFT JOIN user_accounts ua ON ua.person_id = p.person_id
      LEFT JOIN departments d ON p.current_department_id = d.id
      WHERE p.person_id=?
      LIMIT 1
    `, [personId]);
    return row ? normalizePersonUser(row) : null;
  }

  async function listPersonPositions(personId, executor = pool) {
    try {
      const positionRows = await rows(executor, `
        SELECT p.position_id, p.position_code, p.position_name,
               p.department_admin_level, p.department_admin_title, p.responsibility_scope
        FROM person_position_assignment ppa
        JOIN position p ON ppa.position_id = p.position_id
        WHERE ppa.person_id=?
          AND ppa.status='active'
        ORDER BY p.department_admin_level IS NULL, p.department_admin_level, p.position_name
      `, [personId]);
      return positionRows.map(row => ({
        positionId: row.position_id,
        positionCode: row.position_code,
        positionName: row.position_name,
        departmentAdminLevel: row.department_admin_level,
        departmentAdminTitle: row.department_admin_title,
        responsibilityScope: row.responsibility_scope
      }));
    } catch (error) {
      if (!shouldFallbackFromPersonIdentity(error)) throw error;
      return [];
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
      return await getPersonAccountByLogin(loginName);
    },

    async getUserByEmployeeNo(employeeNo) {
      return await getPersonAccountByLogin(employeeNo);
    },

    async getUserById(userId) {
      return await getPersonAccountByPersonId(userId);
    },

    async validateSession(session = {}) {
      const personId = sessionPersonId(session);
      if (!personId) return { valid: false, reason: 'missing_person' };
      const user = await getPersonAccountByPersonId(personId);
      if (!user || user.accountStatus !== 'active' || user.status !== 'active') {
        return { valid: false, reason: 'account_inactive' };
      }
      if (!session.accountId || Number(session.accountId) !== Number(user.accountId)) {
        return { valid: false, reason: 'account_changed' };
      }
      if (!session.authVersion || Number(session.authVersion) !== Number(user.authVersion)) {
        return { valid: false, reason: 'authorization_changed' };
      }
      return { valid: true, user };
    },

    async recordSuccessfulLogin(personId) {
      await pool.execute(
        'UPDATE user_accounts SET last_login_at=CURRENT_TIMESTAMP WHERE person_id=? AND account_status=\'active\'',
        [personId]
      );
    },

    getUserRoleCodes,

    async listDepartments() {
      return await rows(pool, 'SELECT * FROM departments ORDER BY code');
    },

    async getDepartmentById(departmentId) {
      return await first(pool, 'SELECT * FROM departments WHERE id=?', [departmentId]);
    },

    async getDepartmentByName(departmentName) {
      return await first(pool, 'SELECT * FROM departments WHERE name=?', [departmentName]);
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
        SELECT p.person_id AS id, p.person_id, p.person_name AS name, p.employee_no,
               p.current_department_id AS department_id, NULL AS post,
               p.created_at, p.status, d.name AS dept_name,
               ua.account_id, ua.login_name, ua.account_status, ua.auth_version,
               ua.must_change_password
        FROM person p
        LEFT JOIN departments d ON p.current_department_id = d.id
        LEFT JOIN user_accounts ua ON ua.person_id=p.person_id
        ORDER BY p.employee_no
      `);
      return personRows.map(row => normalizePersonUser(row));
    },

    async listUserRoleSummaries() {
      const userRows = await rows(pool, `
        SELECT p.person_id AS id, p.person_id, p.person_name AS name, p.employee_no,
               NULL AS post, p.current_department_id AS department_id, p.created_at,
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
      return userRows.map(user => ({
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
          AND pr.authorization_basis IS NOT NULL
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
        SELECT p.person_id AS id, p.person_id, p.person_name AS name,
               p.current_department_id AS department_id, d.name AS dept_name
        FROM person p
        ${roleJoin}
        LEFT JOIN departments d ON p.current_department_id = d.id
        WHERE p.status='active'
        ORDER BY d.name, p.person_name
      `, roleCode ? [roleCode, ACCESS_MODEL_VERSION] : []);
      return userRows.map(user => ({
        id: user.id,
        personId: user.person_id || user.id,
        name: user.name,
        department_id: user.department_id,
        dept_name: user.dept_name || null
      }));
    },

    async getAssignedRoles(userId) {
      return await rows(pool, `
        SELECT r.role_id, r.role_code, r.role_name, r.is_system, r.status,
               pr.person_role_id, pr.scope_type, pr.scope_department_id,
               pr.authorization_basis, pr.effective_from, pr.effective_to,
               pr.assignment_status, pr.revocation_reason
        FROM person_roles pr
        JOIN roles r ON pr.role_id = r.role_id
        WHERE pr.person_id=?
        ORDER BY r.status, r.role_group, r.role_code
      `, [userId]);
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
      return await rows(pool, `
        SELECT r.*,
          (SELECT role_name FROM roles pr WHERE pr.role_id = r.parent_role_id) AS parent_role_name,
          (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.role_id) AS perm_count,
          (SELECT COUNT(*) FROM person_roles WHERE role_id = r.role_id AND assignment_status='active') AS user_count
        FROM roles r
        ORDER BY FIELD(r.status, 'active', 'legacy', 'retired'), r.role_group, r.role_code
      `);
    },

    async getRoleDetail(roleId) {
      const role = await first(pool, 'SELECT * FROM roles WHERE role_id=?', [roleId]);
      if (!role) return null;

      const ownPerms = await rows(pool, `
        SELECT p.perm_id, p.perm_code, p.resource, p.action, p.field_constraints, p.description, rp.effect, 0 as inherited
        FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id
        WHERE rp.role_id=?
      `, [roleId]);
      const knownPermCodes = new Set(ownPerms.map(permission => permission.perm_code));
      const inheritedPerms = [];

      let parentId = role.parent_role_id;
      const visited = new Set();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parentPerms = await rows(pool, `
          SELECT p.perm_id, p.perm_code, p.resource, p.action, p.field_constraints, p.description, rp.effect, 1 as inherited
          FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id
          WHERE rp.role_id=?
        `, [parentId]);
        for (const permission of parentPerms) {
          if (!knownPermCodes.has(permission.perm_code)) {
            inheritedPerms.push(permission);
            knownPermCodes.add(permission.perm_code);
          }
        }
        const parent = await first(pool, 'SELECT parent_role_id FROM roles WHERE role_id=?', [parentId]);
        parentId = parent ? parent.parent_role_id : null;
      }

      const users = await rows(pool, `
        SELECT p.person_id AS id, p.person_id, p.person_name AS name, p.employee_no,
               p.current_department_id AS department_id, NULL AS post, d.name AS dept_name,
               pr.assignment_status, pr.scope_type, pr.scope_department_id
        FROM person_roles pr
        JOIN person p ON pr.person_id = p.person_id
        LEFT JOIN departments d ON p.current_department_id = d.id
        WHERE pr.role_id=?
      `, [roleId]);

      return { ...role, permissions: [...ownPerms, ...inheritedPerms], users };
    },

    async getRolePermissionMatrix(roleId) {
      const role = await first(pool, 'SELECT * FROM roles WHERE role_id=?', [roleId]);
      if (!role) return null;

      const allPerms = await rows(pool, 'SELECT * FROM permissions ORDER BY resource, action');
      const rolePerms = await rows(pool, `
        SELECT p.perm_code, rp.effect FROM role_permissions rp
        JOIN permissions p ON rp.perm_id = p.perm_id WHERE rp.role_id=?
      `, [roleId]);
      const rolePermMap = new Map(rolePerms.map(permission => [permission.perm_code, permission.effect]));

      return {
        role,
        matrix: allPerms.map(permission => ({
          ...permission,
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
      const personId = sessionPersonId(session);
      if (!personId) return null;

      const user = await getPersonAccountByPersonId(personId);
      if (!user) return null;
      const rbacRoles = await getUserRoleCodes(user.personId);
      const roleCodes = rbacRoles.map(role => role.code);
      const { permSet } = await getUserEffectivePermissions(user.personId);
      const permissions = Array.from(permSet);
      const positions = await listPersonPositions(user.personId);

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
        rbacRoles,
        roleAssignments: rbacRoles,
        roleCodes,
        permissions,
        dataScopes: deriveDataScopes(user, permissions),
        governanceModelVersion: ACCESS_MODEL_VERSION
      };
    },

    async getPasswordStatus(userId) {
      const user = await first(pool, 'SELECT must_change_password FROM user_accounts WHERE person_id=?', [userId]);
      if (!user) return null;
      return { is_default_password: Boolean(user.must_change_password) };
    },

    async getPasswordCredential(userId) {
      return await first(pool, `
        SELECT p.employee_no, ua.password_hash
        FROM user_accounts ua
        JOIN person p ON ua.person_id = p.person_id
        WHERE ua.person_id=?
      `, [userId]);
    },

    async updateOwnPassword(userId, passwordHash) {
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
  ensureMysqlBuiltInRolesAndPermissions,
  ensureMysqlPersonIdentityColumns,
  migrateLegacyIdentityToPersonIdentity
};
