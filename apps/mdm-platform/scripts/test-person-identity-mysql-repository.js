const assert = require('assert');

const { hashPassword, verifyPassword } = require('../server/auth');
const { makeIdentityMysqlRepository, migrateLegacyIdentityToPersonIdentity } = require('../server/identityMysqlRepository');
const { ACCESS_MODEL_VERSION, getAccessModel } = require('../server/roleDefinitions');

// In-memory contracts only: schema initialization, explicitly invoked historical
// migration, current person reads and rejection of retired identity writes.
// Run with testHelpers/blockRealMysql.js; never connect to a configured database.

const PASSWORD = 'PersonPass123456!';

function makePersonPool() {
  const state = {
    statements: [],
    departments: [
      {
        id: 20,
        name: '工程技术部',
        code: 'ENG',
        path: '/20/',
        status: 'active',
        final_responsible_person_id: 501,
        data_owner_person_id: 501
      }
    ],
    persons: [
      {
        person_id: 501,
        employee_no: 'A001',
        person_name: '池炳辉',
        current_department_id: 20,
        mobile: '13800000000',
        email: 'cbh@example.invalid',
        employment_status: 'active',
        status: 'active',
        post: '部门负责人'
      }
    ],
    accounts: [
      {
        account_id: 9001,
        person_id: 501,
        login_name: 'A001',
        password_hash: hashPassword(PASSWORD),
        must_change_password: 0,
        account_status: 'active',
        auth_version: 1
      }
    ],
    roles: [
      { role_id: 1, role_code: 'department_contact', role_name: '部门主对接人', parent_role_id: null, is_system: 1, role_group: 'mdm', status: 'active', model_version: ACCESS_MODEL_VERSION },
      { role_id: 2, role_code: 'decision_group', role_name: '项目决策组', parent_role_id: null, is_system: 1, role_group: 'mdm', status: 'active', model_version: ACCESS_MODEL_VERSION },
      { role_id: 3, role_code: 'admin', role_name: 'MDM系统管理员', parent_role_id: null, is_system: 1, role_group: 'system', status: 'active', model_version: ACCESS_MODEL_VERSION }
    ],
    personRoles: [
      { person_id: 501, role_id: 1, assignment_status: 'active', authorization_basis: 'Isolated contact appointment', effective_from: '2000-01-01', effective_to: null },
      { person_id: 501, role_id: 2, assignment_status: 'active', authorization_basis: 'Isolated project appointment', effective_from: '2000-01-01', effective_to: null }
    ],
    permissions: [
      { perm_id: 11, perm_code: 'governance:read-department', resource: 'governance', action: 'read-department', field_constraints: null },
      { perm_id: 12, perm_code: 'governance:decide-escalation', resource: 'governance', action: 'decide-escalation', field_constraints: null },
      { perm_id: 13, perm_code: 'identity:assign-role', resource: 'identity', action: 'assign-role', field_constraints: null }
    ],
    rolePermissions: [
      { role_id: 1, perm_id: 11, effect: 'allow' },
      { role_id: 2, perm_id: 12, effect: 'allow' },
      { role_id: 3, perm_id: 13, effect: 'allow' }
    ]
  };

  function roleById(roleId) {
    return state.roles.find(role => String(role.role_id) === String(roleId));
  }

  function permissionById(permId) {
    return state.permissions.find(permission => permission.perm_id === permId);
  }

  function effectiveAssignments(personId, modelVersion) {
    const today = new Date().toISOString().slice(0, 10);
    return state.personRoles.filter(assignment => {
      const role = roleById(assignment.role_id);
      return String(assignment.person_id) === String(personId) && role &&
        role.status === 'active' && role.model_version === modelVersion &&
        assignment.assignment_status === 'active' &&
        assignment.effective_from != null && assignment.effective_from <= today &&
        (assignment.effective_to == null || assignment.effective_to >= today);
    });
  }

  function personAccountRow(person, account) {
    const department = state.departments.find(row => row.id === person.current_department_id);
    return {
      id: person.person_id,
      person_id: person.person_id,
      account_id: account && account.account_id || null,
      name: person.person_name,
      person_name: person.person_name,
      employee_no: person.employee_no,
      login_name: account && account.login_name || person.employee_no,
      department_id: person.current_department_id,
      current_department_id: person.current_department_id,
      department_name: department && department.name || null,
      dept_name: department && department.name || null,
      post: person.post,
      role: 'owner',
      password_hash: account && account.password_hash || null,
      must_change_password: account && account.must_change_password || 0,
      account_status: account && account.account_status || null,
      auth_version: account && account.auth_version || null,
      employment_status: person.employment_status,
      status: person.status
    };
  }

  return {
    state,
    async execute(sql, params = []) {
      state.statements.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      assert.ok(!normalizedSql.includes(' user_roles '), `target identity repository should not read user_roles: ${normalizedSql}`);

      if (normalizedSql.startsWith('CREATE TABLE') || normalizedSql.startsWith('ALTER TABLE')) {
        return [[], undefined];
      }

      if (normalizedSql.includes('FROM information_schema.columns') ||
          normalizedSql.includes('FROM information_schema.statistics') ||
          normalizedSql.includes('FROM information_schema.table_constraints')) {
        return [[], undefined];
      }

      if (normalizedSql.includes('FROM user_accounts ua') && normalizedSql.includes('WHERE ua.login_name=?')) {
        const account = state.accounts.find(row => row.login_name === params[0] && row.account_status === 'active');
        const person = account && state.persons.find(row => row.person_id === account.person_id && row.status === 'active');
        return [[person && account ? personAccountRow(person, account) : null].filter(Boolean), undefined];
      }

      if (normalizedSql === 'SELECT person_id FROM person WHERE person_id=?') {
        const person = state.persons.find(row => row.person_id === params[0]);
        return [[person ? { person_id: person.person_id } : null].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM person p') && normalizedSql.includes('WHERE p.person_id=CAST(? AS SIGNED)')) {
        const person = state.persons.find(row => String(row.person_id) === String(params[0]));
        const account = person && state.accounts.find(row => row.person_id === person.person_id);
        return [[person && account ? personAccountRow(person, account) : null].filter(Boolean), undefined];
      }

      if (normalizedSql === 'SELECT role_id FROM person_roles WHERE person_id=?' ||
          normalizedSql.startsWith('SELECT pr.role_id FROM person_roles pr') ||
          normalizedSql.startsWith('SELECT pr.role_id, CAST(pr.role_id AS CHAR) AS role_id FROM person_roles pr')) {
        return [effectiveAssignments(params[0], params[1]).map(row => ({ role_id: String(row.role_id) })), undefined];
      }

      if (normalizedSql.includes('SELECT r.role_code AS code') && normalizedSql.includes('FROM person_roles pr JOIN roles r')) {
        const roleRows = effectiveAssignments(params[0], params[1])
          .map(row => roleById(row.role_id))
          .filter(Boolean)
          .sort((left, right) => left.role_group.localeCompare(right.role_group) || left.role_code.localeCompare(right.role_code))
          .map(role => ({ code: role.role_code, name: role.role_name }));
        return [roleRows, undefined];
      }

      if (normalizedSql.includes('FROM person_position_assignment ppa')) return [[], undefined];

      if (normalizedSql === 'SELECT role_code AS code, role_name AS name FROM roles WHERE role_code=?') {
        const role = state.roles.find(row => row.role_code === params[0]);
        return [[role ? { code: role.role_code, name: role.role_name } : null].filter(Boolean), undefined];
      }

      if (normalizedSql === 'SELECT role_id FROM roles WHERE role_code=?') {
        const role = state.roles.find(row => row.role_code === params[0]);
        return [[role ? { role_id: role.role_id } : null].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('SELECT role_id, role_code, role_name FROM roles WHERE role_id IN')) {
        const ids = new Set(params);
        return [state.roles.filter(role => ids.has(role.role_id)).map(role => ({
          role_id: role.role_id,
          role_code: role.role_code,
          role_name: role.role_name
        })), undefined];
      }

      if (normalizedSql === 'SELECT parent_role_id FROM roles WHERE role_id=?' ||
          normalizedSql === 'SELECT parent_role_id, CAST(parent_role_id AS CHAR) AS parent_role_id FROM roles WHERE role_id=CAST(? AS SIGNED)') {
        const role = roleById(params[0]);
        return [[role ? { parent_role_id: role.parent_role_id } : null].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id')) {
        const roleIds = new Set(params.map(String));
        return [state.rolePermissions
          .filter(row => roleIds.has(String(row.role_id)))
          .map(row => {
            const permission = permissionById(row.perm_id);
            return {
              perm_code: permission.perm_code,
              field_constraints: permission.field_constraints,
              effect: row.effect
            };
          }), undefined];
      }

      if (normalizedSql === 'DELETE FROM person_roles WHERE person_id=?') {
        state.personRoles = state.personRoles.filter(row => row.person_id !== params[0]);
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql === 'INSERT IGNORE INTO person_roles (person_id, role_id, assigned_by_person_id) VALUES (?, ?, ?)') {
        if (!state.personRoles.some(row => row.person_id === params[0] && row.role_id === params[1])) {
          state.personRoles.push({ person_id: params[0], role_id: params[1], assigned_by_person_id: params[2] });
        }
        return [{ affectedRows: 1 }, undefined];
      }

      throw new Error(`Unhandled SQL in person identity fake pool: ${normalizedSql}`);
    },
    async getConnection() {
      return {
        execute: this.execute.bind(this),
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {}
      };
    }
  };
}

function makeMigrationPool() {
  const state = {
    statements: [],
    nextPersonId: 1001,
    users: [
      { id: 1, name: '池炳辉', employee_no: 'A001', department_id: 20, role: 'owner', password_hash: hashPassword(PASSWORD), must_change_password: 0, created_at: '2026-06-01 00:00:00' },
      { id: 2, name: '管理层用户', employee_no: 'A002', department_id: 99, role: 'submitter', password_hash: hashPassword('LeaderPass123456!'), must_change_password: 1, created_at: '2026-06-01 00:00:00' }
    ],
    roles: [
      { role_id: 1, role_code: 'owner', role_name: '业务负责人' },
      { role_id: 2, role_code: 'decision_group', role_name: '决策组' },
      { role_id: 3, role_code: 'submitter', role_name: '报送人' }
    ],
    userRoles: [
      { user_id: 1, role_id: 1, assigned_by: 2 },
      { user_id: 2, role_id: 2, assigned_by: null }
    ],
    departments: [
      { id: 20, name: '工程技术部', manager_user_id: 1, data_owner_user_id: 2, final_responsible_person_id: null, data_owner_person_id: null },
      { id: 99, name: '公司领导', manager_user_id: null, data_owner_user_id: null, final_responsible_person_id: null, data_owner_person_id: null }
    ],
    persons: [],
    accounts: [],
    personRoles: []
  };

  function personByEmployeeNo(employeeNo) {
    return state.persons.find(person => person.employee_no === employeeNo);
  }

  function ensurePerson(user) {
    let person = personByEmployeeNo(user.employee_no);
    if (!person) {
      person = {
        person_id: state.nextPersonId++,
        employee_no: user.employee_no,
        person_name: user.name,
        current_department_id: user.department_id,
        status: 'active'
      };
      state.persons.push(person);
    } else {
      person.person_name = user.name;
      person.current_department_id = user.department_id;
    }
    return person;
  }

  function upsertAccountFromLegacyUser(user, adminEmployeeNo) {
    const person = ensurePerson(user);
    let account = state.accounts.find(row => row.person_id === person.person_id);
    if (!account) {
      account = {
        account_id: person.person_id + 5000,
        person_id: person.person_id,
        login_name: user.employee_no,
        password_hash: user.password_hash,
        must_change_password: user.must_change_password,
        account_status: user.employee_no === adminEmployeeNo ? 'active' : 'pending_activation'
      };
      state.accounts.push(account);
      return account;
    }
    account.login_name = user.employee_no;
    return account;
  }

  return {
    state,
    async execute(sql, params = []) {
      state.statements.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.startsWith('CREATE TABLE') || normalizedSql.startsWith('ALTER TABLE')) {
        return [[], undefined];
      }

      if (normalizedSql.includes('FROM information_schema.columns') ||
          normalizedSql.includes('FROM information_schema.statistics') ||
          normalizedSql.includes('FROM information_schema.table_constraints')) {
        return [[], undefined];
      }

      if (normalizedSql === "UPDATE roles SET role_group='legacy' WHERE role_group NOT IN ('system','mdm','directory','legacy')") {
        for (const role of state.roles) {
          if (role.role_group != null && !['system', 'mdm', 'legacy'].includes(role.role_group)) role.role_group = 'legacy';
        }
        return [{ affectedRows: 0 }, undefined];
      }

      if (normalizedSql.startsWith('INSERT INTO roles (') && normalizedSql.includes('protected_core')) {
        const [roleCode, roleName, description, roleGroup, modelVersion] = params;
        let role = state.roles.find(row => row.role_code === roleCode);
        if (!role) {
          role = { role_id: Math.max(0, ...state.roles.map(row => row.role_id)) + 1, role_code: roleCode };
          state.roles.push(role);
        }
        Object.assign(role, {
          role_name: roleName, description, parent_role_id: null, is_system: 1,
          role_group: roleGroup, status: 'active', model_version: modelVersion, is_core: 1, protected_core: 1
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith('INSERT INTO permissions (') && normalizedSql.includes('protected_core')) {
        if (!state.permissions) state.permissions = [];
        const [permissionCode, resource, action, description, dangerous, defaultScope, protectedCore] = params;
        let permission = state.permissions.find(row => row.perm_code === permissionCode);
        if (!permission) {
          permission = { perm_id: Math.max(0, ...state.permissions.map(row => row.perm_id)) + 1, perm_code: permissionCode };
          state.permissions.push(permission);
        }
        Object.assign(permission, { resource, action, description, is_dangerous: dangerous, default_scope: defaultScope, protected_core: protectedCore });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith('DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id=rp.role_id WHERE r.role_code')) {
        if (!state.rolePermissions) state.rolePermissions = [];
        const removingUnfixed = normalizedSql.includes('NOT IN');
        state.rolePermissions = state.rolePermissions.filter(assignment => {
          const role = state.roles.find(row => row.role_id === assignment.role_id);
          return role && (removingUnfixed ? params.includes(role.role_code) : role.role_code !== params[0]);
        });
        return [{ affectedRows: 0 }, undefined];
      }

      if (normalizedSql.startsWith('INSERT INTO role_permissions (role_id, perm_id, effect)')) {
        const permission = state.permissions.find(row => row.perm_code === params[0]);
        const role = state.roles.find(row => row.role_code === params[1]);
        const existing = state.rolePermissions.find(row => row.role_id === role.role_id && row.perm_id === permission.perm_id);
        if (existing) existing.effect = 'allow';
        else state.rolePermissions.push({ role_id: role.role_id, perm_id: permission.perm_id, effect: 'allow' });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith("UPDATE roles SET role_group='legacy', status='retired', model_version=?")) {
        const [modelVersion, ...fixedRoleCodes] = params;
        for (const role of state.roles) {
          if (!fixedRoleCodes.includes(role.role_code)) Object.assign(role, {
            role_group: 'legacy', status: 'retired', model_version: modelVersion, is_core: 0, protected_core: 1
          });
        }
        return [{ affectedRows: 0 }, undefined];
      }

      if (normalizedSql.startsWith('INSERT INTO person')) {
        for (const user of state.users) ensurePerson(user);
        return [{ affectedRows: state.users.length }, undefined];
      }

      if (normalizedSql.startsWith('INSERT INTO user_accounts')) {
        assert.ok(!normalizedSql.includes('password_hash=VALUES(password_hash)'), 'historical migration must preserve changed credentials');
        for (const user of state.users) {
          upsertAccountFromLegacyUser(user, params[0]);
        }
        return [{ affectedRows: state.accounts.length }, undefined];
      }

      if (normalizedSql.startsWith('INSERT IGNORE INTO person_roles') && normalizedSql.includes('FROM user_roles ur')) {
        for (const userRole of state.userRoles) {
          const user = state.users.find(row => row.id === userRole.user_id);
          const person = user && ensurePerson(user);
          if (person && !state.personRoles.some(row => row.person_id === person.person_id && row.role_id === userRole.role_id)) {
            const assignedUser = state.users.find(row => row.id === userRole.assigned_by);
            const assignedPerson = assignedUser && personByEmployeeNo(assignedUser.employee_no);
            state.personRoles.push({ person_id: person.person_id, role_id: userRole.role_id, assigned_by_person_id: assignedPerson ? assignedPerson.person_id : null });
          }
        }
        return [{ affectedRows: state.personRoles.length }, undefined];
      }

      if (normalizedSql.startsWith('INSERT IGNORE INTO person_roles') && normalizedSql.includes('FROM users u') && normalizedSql.includes('JOIN roles r ON r.role_code = u.role')) {
        for (const user of state.users) {
          const role = state.roles.find(row => row.role_code === user.role);
          const person = ensurePerson(user);
          if (role && !state.personRoles.some(row => row.person_id === person.person_id && row.role_id === role.role_id)) {
            state.personRoles.push({ person_id: person.person_id, role_id: role.role_id, assigned_by_person_id: null });
          }
        }
        return [{ affectedRows: state.personRoles.length }, undefined];
      }

      if (normalizedSql.startsWith('INSERT IGNORE INTO person_roles') && normalizedSql.includes("r.role_code='submitter'")) {
        const submitter = state.roles.find(row => row.role_code === 'submitter');
        for (const person of state.persons) {
          const roleIds = state.personRoles.filter(row => row.person_id === person.person_id).map(row => row.role_id);
          const hasBase = state.roles.some(role => roleIds.includes(role.role_id) && ['submitter', 'owner', 'reviewer', 'admin'].includes(role.role_code));
          if (!hasBase && submitter) state.personRoles.push({ person_id: person.person_id, role_id: submitter.role_id, assigned_by_person_id: null });
        }
        return [{ affectedRows: state.personRoles.length }, undefined];
      }

      if (normalizedSql.startsWith('UPDATE departments d JOIN person p ON p.person_name=?')) {
        const [personName, departmentName] = params;
        const person = state.persons.find(row => row.person_name === personName);
        const department = state.departments.find(row => row.name === departmentName);
        if (person && department && !department.final_responsible_person_id) {
          department.final_responsible_person_id = person.person_id;
          return [{ affectedRows: 1 }, undefined];
        }
        return [{ affectedRows: 0 }, undefined];
      }

      const businessUpdate = normalizedSql.match(/^UPDATE (\w+) target JOIN users u ON target\.(\w+)=u.id JOIN person p ON p.employee_no=u.employee_no SET target\.(\w+)=p.person_id/);
      if (businessUpdate) {
        const [, table, legacyField, personField] = businessUpdate;
        if (table !== 'departments') {
          const error = new Error(`Isolated legacy fixture has no table ${table}`);
          error.code = 'ER_NO_SUCH_TABLE';
          throw error;
        }
        let affectedRows = 0;
        for (const row of state.departments) {
          if (row[legacyField] == null || row[personField] != null) continue;
          const user = state.users.find(candidate => candidate.id === row[legacyField]);
          const person = user && personByEmployeeNo(user.employee_no);
          if (person) { row[personField] = person.person_id; affectedRows++; }
        }
        return [{ affectedRows }, undefined];
      }

      throw new Error(`Unhandled SQL in migration fake pool: ${normalizedSql}`);
    }
  };
}

async function main() {
  const schemaPool = makeMigrationPool();
  const legacyUsersBefore = JSON.parse(JSON.stringify(schemaPool.state.users));
  const departmentsBefore = JSON.parse(JSON.stringify(schemaPool.state.departments));
  await makeIdentityMysqlRepository(schemaPool).initSchema();
  assert.deepStrictEqual(schemaPool.state.persons, [], 'schema initialization must not migrate legacy people');
  assert.deepStrictEqual(schemaPool.state.accounts, [], 'schema initialization must not create or activate accounts');
  assert.deepStrictEqual(schemaPool.state.personRoles, [], 'schema initialization must not grant legacy assignments');
  assert.deepStrictEqual(schemaPool.state.users, legacyUsersBefore, 'schema initialization must preserve legacy accounts');
  assert.deepStrictEqual(schemaPool.state.departments, departmentsBefore, 'schema initialization must not infer responsibility from names');
  assert.deepStrictEqual(schemaPool.state.roles.filter(role => role.status === 'active').map(role => role.role_code).sort(),
    getAccessModel().roles.map(role => role.code).sort());
  const seedBefore = JSON.parse(JSON.stringify({ roles: schemaPool.state.roles, permissions: schemaPool.state.permissions, rolePermissions: schemaPool.state.rolePermissions }));
  await makeIdentityMysqlRepository(schemaPool).initSchema();
  assert.deepStrictEqual({ roles: schemaPool.state.roles, permissions: schemaPool.state.permissions, rolePermissions: schemaPool.state.rolePermissions }, seedBefore, 'fixed model seeding must be idempotent');

  // Invoke the retained helper explicitly on a separate in-memory legacy fixture.
  // This is compatibility coverage, never an automatic initialization migration.
  const migrationPool = makeMigrationPool();
  const migrationUsersBefore = JSON.parse(JSON.stringify(migrationPool.state.users));
  const originalAdminEmployeeNo = process.env.MDM_ADMIN_EMPLOYEE_NO;
  process.env.MDM_ADMIN_EMPLOYEE_NO = 'ISOLATED_ADMIN_ONLY';
  try {
    await migrateLegacyIdentityToPersonIdentity(migrationPool);
    assert.deepStrictEqual(migrationPool.state.persons.map(person => person.employee_no), ['A001', 'A002'], 'explicit historical migration must copy legacy people');
    assert.deepStrictEqual(migrationPool.state.accounts.map(account => account.login_name), ['A001', 'A002'], 'explicit historical migration must retain login identifiers');
    const migratedOwner = migrationPool.state.persons.find(person => person.employee_no === 'A001');
    const ownerRole = migrationPool.state.roles.find(role => role.role_code === 'owner');
    assert.ok(
      migrationPool.state.personRoles.some(row => row.person_id === migratedOwner.person_id && row.role_id === ownerRole.role_id),
      'legacy user_roles should migrate to person_roles'
    );
    const migratedDecisionUser = migrationPool.state.persons.find(person => person.employee_no === 'A002');
    const submitterRole = migrationPool.state.roles.find(role => role.role_code === 'submitter');
    assert.ok(
      migrationPool.state.personRoles.some(row => row.person_id === migratedDecisionUser.person_id && row.role_id === submitterRole.role_id),
      'explicit historical migration should retain the stored legacy user role'
    );
    assert.strictEqual(
      migrationPool.state.departments.find(department => department.name === '工程技术部').final_responsible_person_id,
      migratedOwner.person_id,
      'explicit historical migration should follow the existing manager user reference'
    );
    assert.strictEqual(migrationPool.state.departments.find(row => row.id === 99).final_responsible_person_id, null,
      'migration must not infer a responsible person from a department or person name');
    assert.strictEqual(migrationPool.state.departments.find(row => row.id === 20).data_owner_person_id, migratedDecisionUser.person_id);
    assert.strictEqual(migrationPool.state.personRoles.find(row => row.person_id === migratedOwner.person_id && row.role_id === ownerRole.role_id).assigned_by_person_id, migratedDecisionUser.person_id);
    assert.ok(migrationPool.state.accounts.every(account => account.account_status === 'pending_activation'), 'ordinary historical accounts must not activate automatically');
    assert.deepStrictEqual(migrationPool.state.users, migrationUsersBefore, 'explicit migration must preserve legacy source records');

    const changedPasswordHash = hashPassword('ChangedPass123456!');
    const migratedOwnerAccount = migrationPool.state.accounts.find(account => account.person_id === migratedOwner.person_id);
    migratedOwnerAccount.password_hash = changedPasswordHash;
    migratedOwnerAccount.must_change_password = 0;
    migratedOwnerAccount.account_status = 'disabled';
    const migratedBefore = JSON.parse(JSON.stringify({ persons: migrationPool.state.persons, accounts: migrationPool.state.accounts, assignments: migrationPool.state.personRoles, departments: migrationPool.state.departments }));
    await migrateLegacyIdentityToPersonIdentity(migrationPool);
    assert.strictEqual(
      migrationPool.state.accounts.find(account => account.person_id === migratedOwner.person_id).password_hash,
      changedPasswordHash,
      'legacy migration must not overwrite a password already changed in user_accounts'
    );
    assert.strictEqual(
      migrationPool.state.accounts.find(account => account.person_id === migratedOwner.person_id).must_change_password,
      0,
      'legacy migration must not restore first-login password status after a user changes password'
    );
    assert.deepStrictEqual({ persons: migrationPool.state.persons, accounts: migrationPool.state.accounts, assignments: migrationPool.state.personRoles, departments: migrationPool.state.departments }, migratedBefore,
      'repeating explicit migration must preserve account status, stable IDs and existing references');
  } finally {
    if (originalAdminEmployeeNo === undefined) delete process.env.MDM_ADMIN_EMPLOYEE_NO;
    else process.env.MDM_ADMIN_EMPLOYEE_NO = originalAdminEmployeeNo;
  }

  const pool = makePersonPool();
  const repo = makeIdentityMysqlRepository(pool);

  const loginUser = await repo.getUserByEmployeeNo('A001');
  assert.strictEqual(loginUser.personId, 501);
  assert.strictEqual(loginUser.accountId, 9001);
  assert.strictEqual(loginUser.id, 501, 'compatibility id should point at person_id during migration');
  assert.ok(verifyPassword(PASSWORD, loginUser.password_hash));

  const payload = await repo.getCurrentUserPayload({
    personId: 501,
    accountId: 9001,
    userId: 999,
    userRole: 'submitter'
  });
  assert.strictEqual(payload.id, 501);
  assert.strictEqual(payload.personId, 501);
  assert.strictEqual(payload.accountId, 9001);
  assert.strictEqual(payload.employeeNo, 'A001');
  assert.strictEqual(payload.personName, '池炳辉');
  assert.strictEqual(payload.departmentId, 20);
  assert.strictEqual(payload.departmentName, '工程技术部');
  assert.strictEqual(payload.authVersion, 1);
  assert.deepStrictEqual(payload.roleCodes, ['decision_group', 'department_contact']);
  assert.ok(payload.permissions.includes('governance:read-department'));
  assert.ok(payload.permissions.includes('governance:decide-escalation'));
  assert.ok(!payload.permissions.includes('identity:assign-role'), 'project roles must not inherit dangerous admin permission');

  const assignmentsBefore = JSON.parse(JSON.stringify(pool.state.personRoles));
  const statementCountBefore = pool.state.statements.length;
  await assert.rejects(
    () => repo.replaceUserRoles(501, [2], 501),
    error => error && error.statusCode === 410 && error.code === 'LEGACY_IDENTITY_API_RETIRED',
    'retired assignment writes must reject before any legacy role policy or SQL'
  );

  await assert.rejects(
    () => repo.replaceUserRoles(501, [1, 2], 501),
    error => error && error.statusCode === 410 && error.code === 'LEGACY_IDENTITY_API_RETIRED',
    'a previously valid legacy role set must not reopen the retired writer'
  );
  assert.deepStrictEqual(pool.state.personRoles, assignmentsBefore, 'retired writes must leave all assignments unchanged');
  assert.strictEqual(pool.state.statements.length, statementCountBefore, 'retired writes must not reach the database');

  const unsafeSql = pool.state.statements.map(entry => entry.sql).join('\n');
  assert.ok(!unsafeSql.includes('user_roles'), 'person identity repository should not use user_roles in target path');

  console.log('Person identity MySQL repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
