const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const { ROLE_GUIDES } = require('./roleDefinitions');

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

const BASIC_ROLE_CODES = new Set(['submitter', 'owner', 'reviewer', 'admin']);

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

function baseRoleError() {
  const error = new Error('人员至少需要一个基础权限角色，项目治理角色不能单独分配');
  error.statusCode = 400;
  return error;
}

function sessionPersonId(session = {}) {
  return Number(session.personId || session.userId || 0) || null;
}

function normalizePersonUser(row = {}, fallbackRole = 'submitter') {
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
    role: row.role || fallbackRole || 'submitter',
    post: row.post || row.position_name || null
  };
}

function roleCodesToCompatibleRole(roleCodes = [], fallbackRole = 'submitter') {
  const baseRole = roleCodes.find(code => BASIC_ROLE_CODES.has(code));
  if (baseRole) return baseRole;
  return BASIC_ROLE_CODES.has(fallbackRole) ? fallbackRole : 'submitter';
}

function deriveDataScopes(user = {}, permissions = []) {
  const scopes = new Set();
  if (permissions.includes('*:*') ||
      permissions.includes('process_governance:view_global') ||
      permissions.includes('data:view_all')) {
    scopes.add('global');
  }
  const departmentId = user.department_id || user.current_department_id || user.departmentId;
  if (departmentId) scopes.add(`department:${departmentId}`);
  const personId = user.personId || user.person_id || user.id;
  if (personId) scopes.add(`person:${personId}`);
  return Array.from(scopes);
}

const DEPARTMENT_FINAL_RESPONSIBLE_PEOPLE = [
  ['行政人事部', '陈娟'],
  ['经营发展部', '刘春含'],
  ['物资保障部', '刘洪雨'],
  ['质量管理部', '曲明盛'],
  ['工程技术部', '池炳辉'],
  ['复材车间', '王潇'],
  ['财务部', '李雪'],
  ['项目管理部', '范秋南']
];

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
  const alterations = [
    "ALTER TABLE roles ADD COLUMN role_group VARCHAR(32) NOT NULL DEFAULT 'basic'",
    'ALTER TABLE roles ADD COLUMN protected_core TINYINT NOT NULL DEFAULT 0',
    'ALTER TABLE permissions ADD COLUMN is_dangerous TINYINT NOT NULL DEFAULT 0',
    "ALTER TABLE permissions ADD COLUMN default_scope VARCHAR(64) NOT NULL DEFAULT 'self_task'",
    'ALTER TABLE permissions ADD COLUMN protected_core TINYINT NOT NULL DEFAULT 0'
  ];

  for (const statement of alterations) {
    await executeIfSupported(pool, statement);
  }
}

async function ensureMysqlBuiltInRolesAndPermissions(pool) {
  await ensureMysqlRbacMetadataColumns(pool);

  for (const role of ROLE_GUIDES) {
    await executeIfSupported(pool, `
      INSERT INTO roles (role_code, role_name, description, is_system, role_group, protected_core)
      VALUES (?, ?, ?, 1, ?, 1)
      ON DUPLICATE KEY UPDATE
        role_name=VALUES(role_name),
        description=VALUES(description),
        is_system=1,
        role_group=VALUES(role_group),
        protected_core=1,
        updated_at=CURRENT_TIMESTAMP
    `, [role.code, role.name, role.description || null, role.group || 'basic']);

    for (const permission of role.permissions || []) {
      const normalized = normalizePermissionDefinition(permission);
      if (!normalized.code) continue;
      await executeIfSupported(pool, `
        INSERT INTO permissions (perm_code, resource, action, description, is_dangerous, default_scope, protected_core)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          resource=VALUES(resource),
          action=VALUES(action),
          description=VALUES(description),
          is_dangerous=VALUES(is_dangerous),
          default_scope=VALUES(default_scope),
          protected_core=VALUES(protected_core)
      `, [
        normalized.code,
        normalized.resource,
        normalized.action,
        normalized.description,
        normalized.isDangerous,
        normalized.defaultScope,
        normalized.protectedCore
      ]);

      await executeIfSupported(pool, `
        INSERT IGNORE INTO role_permissions (role_id, perm_id, effect)
        SELECT r.role_id, p.perm_id, 'allow'
        FROM roles r
        JOIN permissions p ON p.perm_code=?
        WHERE r.role_code=?
      `, [normalized.code, role.code]);
    }
  }
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
    SELECT p.person_id, u.employee_no, u.password_hash, u.must_change_password, 'active'
    FROM users u
    JOIN person p ON p.employee_no = u.employee_no
    ON DUPLICATE KEY UPDATE
      login_name=VALUES(login_name),
      account_status='active',
      updated_at=CURRENT_TIMESTAMP
  `);

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

  await pool.execute(`
    INSERT IGNORE INTO person_roles (person_id, role_id)
    SELECT p.person_id, r.role_id
    FROM person p
    JOIN roles r ON r.role_code='submitter'
    WHERE NOT EXISTS (
      SELECT 1
      FROM person_roles pr
      JOIN roles br ON pr.role_id = br.role_id
      WHERE pr.person_id = p.person_id
        AND br.role_code IN ('submitter','owner','reviewer','admin')
    )
  `);

  for (const [departmentName, personName] of DEPARTMENT_FINAL_RESPONSIBLE_PEOPLE) {
    await executeIfSupported(pool, `
      UPDATE departments d
      JOIN person p ON p.person_name=?
      SET d.final_responsible_person_id=p.person_id
      WHERE d.name=?
        AND d.final_responsible_person_id IS NULL
    `, [personName, departmentName]);
  }

  await migrateLegacyBusinessUsersToPersons(pool);
}

function makeIdentityMysqlRepository(pool) {
  async function getUserRoleCodes(userId, legacyRole) {
    let assignedRoles;
    try {
      assignedRoles = await rows(pool, `
        SELECT r.role_code as code, r.role_name as name
        FROM person_roles pr
        JOIN roles r ON pr.role_id = r.role_id
        WHERE pr.person_id=?
        ORDER BY r.is_system DESC, r.role_code
      `, [userId]);
    } catch (error) {
      if (!shouldFallbackFromPersonIdentity(error)) throw error;
      assignedRoles = await rows(pool, `
        SELECT r.role_code as code, r.role_name as name
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        WHERE ur.user_id=?
        ORDER BY r.is_system DESC, r.role_code
      `, [userId]);
    }

    if (legacyRole && !assignedRoles.some(role => role.code === legacyRole)) {
      const legacy = await first(pool, 'SELECT role_code AS code, role_name AS name FROM roles WHERE role_code=?', [legacyRole]);
      if (legacy) assignedRoles.unshift(legacy);
    }

    return assignedRoles;
  }

  async function getDirectRoleIds(userId) {
    try {
      const person = await first(pool, 'SELECT person_id FROM person WHERE person_id=?', [userId]);
      const directRoles = (await rows(pool, 'SELECT role_id FROM person_roles WHERE person_id=?', [userId]))
        .map(role => role.role_id);
      if (person) return directRoles;
    } catch (error) {
      if (!shouldFallbackFromPersonIdentity(error)) throw error;
    }

    const legacyDirectRoles = (await rows(pool, 'SELECT role_id FROM user_roles WHERE user_id=?', [userId]))
      .map(role => role.role_id);

    if (legacyDirectRoles.length > 0) return legacyDirectRoles;

    const user = await first(pool, 'SELECT role FROM users WHERE id=?', [userId]);
    if (!user || !user.role) return [];
    const fallbackRole = await first(pool, 'SELECT role_id FROM roles WHERE role_code=?', [user.role]);
    return fallbackRole ? [fallbackRole.role_id] : [];
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

  async function getRolesByIds(roleIds, executor = pool) {
    const ids = normalizeRoleIds(roleIds);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return await rows(executor, `
      SELECT role_id, role_code, role_name
      FROM roles
      WHERE role_id IN (${placeholders})
      ORDER BY is_system DESC, role_code
    `, ids);
  }

  async function getRoleIdByCode(roleCode, executor = pool) {
    if (!roleCode) return null;
    const role = await first(executor, 'SELECT role_id FROM roles WHERE role_code=?', [roleCode]);
    return role ? role.role_id : null;
  }

  async function chooseCompatibleRole(requestedRole, roleIds, fallbackRole, executor = pool) {
    if (BASIC_ROLE_CODES.has(requestedRole)) return requestedRole;

    const allRoleIds = await collectRoleAndAncestors(normalizeRoleIds(roleIds), executor);
    const roles = await getRolesByIds(allRoleIds, executor);
    const basicRole = roles.find(role => BASIC_ROLE_CODES.has(role.role_code));
    if (basicRole) return basicRole.role_code;

    if (BASIC_ROLE_CODES.has(fallbackRole)) return fallbackRole;
    return 'submitter';
  }

  async function syncUserRoles(userId, roleIds, compatibleRole, assignedBy, executor = pool) {
    const ids = new Set(normalizeRoleIds(roleIds));
    const compatibleRoleId = await getRoleIdByCode(compatibleRole, executor);
    if (compatibleRoleId) ids.add(compatibleRoleId);
    if (ids.size === 0) return;

    await executor.execute('DELETE FROM user_roles WHERE user_id=?', [userId]);
    for (const roleId of ids) {
      await executor.execute('INSERT IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)', [
        userId,
        roleId,
        assignedBy || null
      ]);
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

  async function syncPersonRoles(personId, roleIds, compatibleRole, assignedByPersonId, executor = pool, options = {}) {
    const ids = new Set(normalizeRoleIds(roleIds));
    if (compatibleRole) {
      const compatibleRoleId = await getRoleIdByCode(compatibleRole, executor);
      if (compatibleRoleId) ids.add(compatibleRoleId);
    }

    const roles = await getRolesByIds(Array.from(ids), executor);
    const hasBaseRole = roles.some(role => BASIC_ROLE_CODES.has(role.role_code));
    if (options.requireExplicitBaseRole && !hasBaseRole) throw baseRoleError();
    if (ids.size === 0) throw baseRoleError();

    await executor.execute('DELETE FROM person_roles WHERE person_id=?', [personId]);
    for (const roleId of ids) {
      await executor.execute('INSERT IGNORE INTO person_roles (person_id, role_id, assigned_by_person_id) VALUES (?, ?, ?)', [
        personId,
        roleId,
        assignedByPersonId || null
      ]);
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
      await migrateLegacyIdentityToPersonIdentity(pool);
    },

    async getUserByEmployeeNo(employeeNo) {
      try {
        return await getPersonAccountByLogin(employeeNo);
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        return await first(pool, 'SELECT * FROM users WHERE employee_no=?', [employeeNo]);
      }
    },

    async getUserById(userId) {
      try {
        return await getPersonAccountByPersonId(userId);
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        return await first(pool, 'SELECT * FROM users WHERE id=?', [userId]);
      }
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
      try {
        const personRows = await rows(pool, `
          SELECT p.person_id AS id, p.person_id, p.person_name AS name, p.employee_no,
                 p.current_department_id AS department_id, NULL AS post,
                 p.created_at, d.name AS dept_name
          FROM person p
          LEFT JOIN departments d ON p.current_department_id = d.id
          ORDER BY p.employee_no
        `);
        return personRows.map(row => normalizePersonUser(row));
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
      }
      return await rows(pool, `
        SELECT u.id, u.name, u.employee_no, u.department_id, u.post, u.role, u.created_at, d.name as dept_name
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        ORDER BY u.employee_no
      `);
    },

    async listUserRoleSummaries() {
      let userRows;
      try {
        userRows = await rows(pool, `
          SELECT p.person_id AS id, p.person_id, p.person_name AS name, p.employee_no,
                 NULL AS post, p.current_department_id AS department_id, p.created_at,
                 d.name as dept_name,
                 COALESCE(GROUP_CONCAT(r.role_code), '') as rbac_role_codes,
                 COALESCE(GROUP_CONCAT(r.role_name), '') as rbac_role_names
          FROM person p
          LEFT JOIN departments d ON p.current_department_id = d.id
          LEFT JOIN person_roles pr ON p.person_id = pr.person_id
          LEFT JOIN roles r ON pr.role_id = r.role_id
          GROUP BY p.person_id
          ORDER BY p.employee_no
        `);
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        userRows = await rows(pool, `
          SELECT u.id, u.name, u.employee_no, u.post, u.role, u.department_id, u.created_at,
                 d.name as dept_name,
                 COALESCE(GROUP_CONCAT(r.role_code), '') as rbac_role_codes,
                 COALESCE(GROUP_CONCAT(r.role_name), '') as rbac_role_names
          FROM users u
          LEFT JOIN departments d ON u.department_id = d.id
          LEFT JOIN user_roles ur ON u.id = ur.user_id
          LEFT JOIN roles r ON ur.role_id = r.role_id
          GROUP BY u.id
          ORDER BY u.employee_no
        `);
      }
      return userRows.map(user => ({
        id: user.id,
        personId: user.person_id || user.id,
        name: user.name,
        employee_no: user.employee_no,
        department_id: user.department_id,
        dept_name: user.dept_name || null,
        post: user.post,
        role: user.role,
        created_at: user.created_at,
        rbac_role_codes: user.rbac_role_codes || '',
        rbac_role_names: user.rbac_role_names || ''
      }));
    },

    async listAssignableUsers() {
      let userRows;
      try {
        userRows = await rows(pool, `
          SELECT p.person_id AS id, p.person_id, p.person_name AS name,
                 p.current_department_id AS department_id, d.name AS dept_name
          FROM person p
          LEFT JOIN departments d ON p.current_department_id = d.id
          WHERE p.status='active'
          ORDER BY d.name, p.person_name
        `);
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        userRows = await rows(pool, `
          SELECT u.id, u.name, u.department_id, d.name AS dept_name
          FROM users u
          LEFT JOIN departments d ON u.department_id = d.id
          ORDER BY d.name, u.name
        `);
      }
      return userRows.map(user => ({
        id: user.id,
        personId: user.person_id || user.id,
        name: user.name,
        department_id: user.department_id,
        dept_name: user.dept_name || null
      }));
    },

    async getAssignedRoles(userId) {
      try {
        return await rows(pool, `
          SELECT r.role_id, r.role_code, r.role_name, r.is_system
          FROM person_roles pr
          JOIN roles r ON pr.role_id = r.role_id
          WHERE pr.person_id=?
          ORDER BY r.is_system DESC, r.role_code
        `, [userId]);
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        return await rows(pool, `
          SELECT r.role_id, r.role_code, r.role_name, r.is_system
          FROM user_roles ur
          JOIN roles r ON ur.role_id = r.role_id
          WHERE ur.user_id=?
          ORDER BY r.is_system DESC, r.role_code
        `, [userId]);
      }
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
      try {
        return await rows(pool, `
          SELECT r.*,
            (SELECT role_name FROM roles pr WHERE pr.role_id = r.parent_role_id) as parent_role_name,
            (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.role_id) as perm_count,
            (SELECT COUNT(*) FROM person_roles WHERE role_id = r.role_id) as user_count
          FROM roles r
          ORDER BY r.is_system DESC, r.role_code
        `);
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        return await rows(pool, `
          SELECT r.*,
            (SELECT role_name FROM roles pr WHERE pr.role_id = r.parent_role_id) as parent_role_name,
            (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.role_id) as perm_count,
            (SELECT COUNT(*) FROM user_roles WHERE role_id = r.role_id) as user_count
          FROM roles r
          ORDER BY r.is_system DESC, r.role_code
        `);
      }
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

      let users;
      try {
        users = await rows(pool, `
          SELECT p.person_id AS id, p.person_id, p.person_name AS name, p.employee_no,
                 p.current_department_id AS department_id, NULL AS post, d.name as dept_name
          FROM person_roles pr
          JOIN person p ON pr.person_id = p.person_id
          LEFT JOIN departments d ON p.current_department_id = d.id
          WHERE pr.role_id=?
        `, [roleId]);
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        users = await rows(pool, `
          SELECT u.id, u.name, u.employee_no, u.department_id, u.post, d.name as dept_name
          FROM user_roles ur
          JOIN users u ON ur.user_id = u.id
          LEFT JOIN departments d ON u.department_id = d.id
          WHERE ur.role_id=?
        `, [roleId]);
      }

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

      let userCount;
      try {
        userCount = await first(pool, 'SELECT COUNT(*) as cnt FROM person_roles WHERE role_id=?', [roleId]);
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        userCount = await first(pool, 'SELECT COUNT(*) as cnt FROM user_roles WHERE role_id=?', [roleId]);
      }
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

      try {
        const user = await getPersonAccountByPersonId(personId);
        if (!user) return null;

        const rbacRoles = await getUserRoleCodes(user.personId, session.userRole);
        const roleCodes = rbacRoles.map(role => role.code);
        const { permSet } = await getUserEffectivePermissions(user.personId);
        const compatibleRole = roleCodesToCompatibleRole(roleCodes, session.userRole);
        const permissions = Array.from(permSet);
        const positions = await listPersonPositions(user.personId);

        return {
          id: user.personId,
          personId: user.personId,
          accountId: user.accountId || session.accountId || null,
          employeeNo: user.employeeNo,
          personName: user.personName || session.userName || '',
          name: user.personName || session.userName || '',
          role: compatibleRole,
          departmentId: user.department_id || null,
          departmentName: user.departmentName || null,
          positions,
          rbacRoles,
          roleCodes,
          permissions,
          dataScopes: deriveDataScopes(user, permissions)
        };
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
      }

      const user = await first(pool, `
        SELECT u.id, u.name, u.employee_no, u.department_id, d.name AS department_name, u.post, u.role
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE u.id=?
        LIMIT 1
      `, [personId]);
      if (!user) return null;

      const { permSet } = await getUserEffectivePermissions(user.id);
      const rbacRoles = await getUserRoleCodes(user.id, user.role || session.userRole);

      return {
        id: user.id,
        personId: user.id,
        accountId: session.accountId || null,
        employeeNo: user.employee_no,
        personName: user.name || session.userName || '',
        name: user.name || session.userName || '',
        role: user.role || session.userRole || 'submitter',
        departmentId: user.department_id || null,
        departmentName: user.department_name || null,
        positions: [],
        rbacRoles,
        roleCodes: rbacRoles.map(role => role.code),
        permissions: Array.from(permSet),
      dataScopes: deriveDataScopes(user, Array.from(permSet))
    };
    },

    async getPasswordStatus(userId) {
      let user;
      try {
        user = await first(pool, 'SELECT must_change_password FROM user_accounts WHERE person_id=?', [userId]);
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        user = await first(pool, 'SELECT must_change_password FROM users WHERE id=?', [userId]);
      }
      if (!user) return null;
      return { is_default_password: Boolean(user.must_change_password) };
    },

    async getPasswordCredential(userId) {
      try {
        const credential = await first(pool, `
          SELECT p.employee_no, ua.password_hash
          FROM user_accounts ua
          JOIN person p ON ua.person_id = p.person_id
          WHERE ua.person_id=?
        `, [userId]);
        if (credential) return credential;
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
      }
      return await first(pool, 'SELECT employee_no, password_hash FROM users WHERE id=?', [userId]);
    },

    async updateOwnPassword(userId, passwordHash) {
      let result;
      try {
        result = await pool.execute('UPDATE user_accounts SET password_hash=?, must_change_password=0 WHERE person_id=?', [passwordHash, userId]);
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        result = await pool.execute('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?', [passwordHash, userId]);
      }
      return affectedRows(result) > 0;
    },

    async createUser(payload = {}) {
      return await withOptionalTransaction(async executor => {
        try {
          const compatibleRole = await chooseCompatibleRole(payload.role, payload.role_ids, 'submitter', executor);
          const personResult = await executor.execute(
            'INSERT INTO person (person_name, employee_no, current_department_id, employment_status, status) VALUES (?, ?, ?, ?, ?)',
            [
              payload.name,
              payload.employee_no,
              payload.department_id || null,
              payload.employment_status || 'active',
              payload.status || 'active'
            ]
          );
          const personId = insertId(personResult);
          await executor.execute(
            'INSERT INTO user_accounts (person_id, login_name, password_hash, must_change_password, account_status) VALUES (?, ?, ?, ?, ?)',
            [
              personId,
              payload.login_name || payload.employee_no,
              payload.password_hash,
              payload.must_change_password ? 1 : 0,
              payload.account_status || 'active'
            ]
          );
          await syncPersonRoles(personId, payload.role_ids, compatibleRole, payload.assigned_by, executor);
          return { id: personId, personId, role: compatibleRole };
        } catch (error) {
          if (!shouldFallbackFromPersonIdentity(error)) throw error;
        }

        const compatibleRole = await chooseCompatibleRole(payload.role, payload.role_ids, 'submitter', executor);
        const result = await executor.execute(
          'INSERT INTO users (name, employee_no, department_id, post, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            payload.name,
            payload.employee_no,
            payload.department_id || null,
            payload.post || null,
            compatibleRole,
            payload.password_hash,
            payload.must_change_password ? 1 : 0
          ]
        );
        const id = insertId(result);
        await syncUserRoles(id, payload.role_ids, compatibleRole, payload.assigned_by, executor);
        return { id, role: compatibleRole };
      });
    },

    async updateUser(userId, payload = {}) {
      return await withOptionalTransaction(async executor => {
        try {
          const existing = await getPersonAccountByPersonId(userId, executor);
          if (!existing) return false;

          const compatibleRole = await chooseCompatibleRole(payload.role, payload.role_ids, existing.role, executor);
          const result = await executor.execute(
            'UPDATE person SET person_name=?, current_department_id=?, updated_at=CURRENT_TIMESTAMP WHERE person_id=?',
            [
              payload.name || existing.personName || existing.name,
              Object.prototype.hasOwnProperty.call(payload, 'department_id') ? payload.department_id || null : existing.department_id || null,
              userId
            ]
          );
          if (Array.isArray(payload.role_ids)) {
            await syncPersonRoles(userId, payload.role_ids, compatibleRole, payload.assigned_by, executor);
          }
          return affectedRows(result) > 0;
        } catch (error) {
          if (!shouldFallbackFromPersonIdentity(error)) throw error;
        }

        const existing = await first(executor, 'SELECT * FROM users WHERE id=?', [userId]);
        if (!existing) return false;

        const compatibleRole = await chooseCompatibleRole(payload.role, payload.role_ids, existing.role, executor);
        const result = await executor.execute(
          'UPDATE users SET name=?, department_id=?, post=?, role=? WHERE id=?',
          [
            payload.name || existing.name,
            Object.prototype.hasOwnProperty.call(payload, 'department_id') ? payload.department_id || null : existing.department_id || null,
            Object.prototype.hasOwnProperty.call(payload, 'post') ? payload.post || null : existing.post || null,
            compatibleRole,
            userId
          ]
        );
        if (Array.isArray(payload.role_ids)) {
          await syncUserRoles(userId, payload.role_ids, compatibleRole, payload.assigned_by, executor);
        }
        return affectedRows(result) > 0;
      });
    },

    async resetUserPassword(userId, passwordHash, mustChangePassword) {
      let result;
      try {
        result = await pool.execute('UPDATE user_accounts SET password_hash=?, must_change_password=? WHERE person_id=?', [
          passwordHash,
          mustChangePassword ? 1 : 0,
          userId
        ]);
      } catch (error) {
        if (!shouldFallbackFromPersonIdentity(error)) throw error;
        result = await pool.execute('UPDATE users SET password_hash=?, must_change_password=? WHERE id=?', [
          passwordHash,
          mustChangePassword ? 1 : 0,
          userId
        ]);
      }
      return affectedRows(result) > 0;
    },

    async replaceUserRoles(userId, roleIds, assignedBy) {
      return await withOptionalTransaction(async executor => {
        try {
          const existing = await getPersonAccountByPersonId(userId, executor);
          if (!existing) return false;

          const roles = await getRolesByIds(normalizeRoleIds(roleIds), executor);
          const basicRole = roles.find(role => BASIC_ROLE_CODES.has(role.role_code));
          if (!basicRole) throw baseRoleError();

          await syncPersonRoles(userId, roleIds, basicRole.role_code, assignedBy, executor, { requireExplicitBaseRole: true });
          return true;
        } catch (error) {
          if (!shouldFallbackFromPersonIdentity(error)) throw error;
        }

        const existing = await first(executor, 'SELECT * FROM users WHERE id=?', [userId]);
        if (!existing) return false;

        const compatibleRole = await chooseCompatibleRole(null, roleIds, existing.role, executor);
        await syncUserRoles(userId, roleIds, compatibleRole, assignedBy, executor);
        const result = await executor.execute('UPDATE users SET role=? WHERE id=?', [compatibleRole, userId]);
        return affectedRows(result) > 0;
      });
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
