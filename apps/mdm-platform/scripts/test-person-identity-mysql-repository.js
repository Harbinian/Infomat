const assert = require('assert');

const { hashPassword, verifyPassword } = require('../server/auth');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');

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
        account_status: 'active'
      }
    ],
    roles: [
      { role_id: 1, role_code: 'owner', role_name: '业务负责人', parent_role_id: null, is_system: 1 },
      { role_id: 2, role_code: 'decision_group', role_name: '决策组', parent_role_id: null, is_system: 1 },
      { role_id: 3, role_code: 'admin', role_name: '管理员', parent_role_id: null, is_system: 1 }
    ],
    personRoles: [
      { person_id: 501, role_id: 1 },
      { person_id: 501, role_id: 2 }
    ],
    permissions: [
      { perm_id: 11, perm_code: 'process_governance:view_department', resource: 'process_governance', action: 'view_department', field_constraints: null },
      { perm_id: 12, perm_code: 'guidance:create', resource: 'guidance', action: 'create', field_constraints: null },
      { perm_id: 13, perm_code: 'rbac:manage', resource: 'rbac', action: 'manage', field_constraints: null }
    ],
    rolePermissions: [
      { role_id: 1, perm_id: 11, effect: 'allow' },
      { role_id: 2, perm_id: 12, effect: 'allow' },
      { role_id: 3, perm_id: 13, effect: 'allow' }
    ]
  };

  function roleById(roleId) {
    return state.roles.find(role => role.role_id === roleId);
  }

  function permissionById(permId) {
    return state.permissions.find(permission => permission.perm_id === permId);
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
          normalizedSql.includes('FROM information_schema.statistics')) {
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

      if (normalizedSql.includes('FROM person p') && normalizedSql.includes('WHERE p.person_id=?')) {
        const person = state.persons.find(row => row.person_id === params[0]);
        const account = person && state.accounts.find(row => row.person_id === person.person_id);
        return [[person && account ? personAccountRow(person, account) : null].filter(Boolean), undefined];
      }

      if (normalizedSql === 'SELECT role_id FROM person_roles WHERE person_id=?') {
        return [state.personRoles.filter(row => row.person_id === params[0]).map(row => ({ role_id: row.role_id })), undefined];
      }

      if (normalizedSql.includes('SELECT r.role_code as code') && normalizedSql.includes('FROM person_roles pr JOIN roles r')) {
        const roleRows = state.personRoles
          .filter(row => row.person_id === params[0])
          .map(row => roleById(row.role_id))
          .filter(Boolean)
          .map(role => ({ code: role.role_code, name: role.role_name }));
        return [roleRows, undefined];
      }

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

      if (normalizedSql === 'SELECT parent_role_id FROM roles WHERE role_id=?') {
        const role = roleById(params[0]);
        return [[role ? { parent_role_id: role.parent_role_id } : null].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id')) {
        const roleIds = new Set(params);
        return [state.rolePermissions
          .filter(row => roleIds.has(row.role_id))
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
      { id: 20, name: '工程技术部', final_responsible_person_id: null },
      { id: 99, name: '公司领导', final_responsible_person_id: null }
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

  function upsertAccountFromLegacyUser(user, shouldOverwriteExistingPassword) {
    const person = ensurePerson(user);
    let account = state.accounts.find(row => row.person_id === person.person_id);
    if (!account) {
      account = {
        account_id: person.person_id + 5000,
        person_id: person.person_id,
        login_name: user.employee_no,
        password_hash: user.password_hash,
        must_change_password: user.must_change_password,
        account_status: 'active'
      };
      state.accounts.push(account);
      return account;
    }
    account.login_name = user.employee_no;
    account.account_status = 'active';
    if (shouldOverwriteExistingPassword) {
      account.password_hash = user.password_hash;
      account.must_change_password = user.must_change_password;
    }
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
          normalizedSql.includes('FROM information_schema.statistics')) {
        return [[], undefined];
      }

      if (normalizedSql.startsWith('INSERT INTO person')) {
        for (const user of state.users) ensurePerson(user);
        return [{ affectedRows: state.users.length }, undefined];
      }

      if (normalizedSql.startsWith('INSERT INTO user_accounts')) {
        const shouldOverwriteExistingPassword = normalizedSql.includes('password_hash=VALUES(password_hash)');
        for (const user of state.users) {
          upsertAccountFromLegacyUser(user, shouldOverwriteExistingPassword);
        }
        return [{ affectedRows: state.accounts.length }, undefined];
      }

      if (normalizedSql.startsWith('INSERT IGNORE INTO person_roles') && normalizedSql.includes('FROM user_roles ur')) {
        for (const userRole of state.userRoles) {
          const user = state.users.find(row => row.id === userRole.user_id);
          const person = user && ensurePerson(user);
          if (person && !state.personRoles.some(row => row.person_id === person.person_id && row.role_id === userRole.role_id)) {
            state.personRoles.push({ person_id: person.person_id, role_id: userRole.role_id, assigned_by_person_id: null });
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

      throw new Error(`Unhandled SQL in migration fake pool: ${normalizedSql}`);
    }
  };
}

async function main() {
  const migrationPool = makeMigrationPool();
  await makeIdentityMysqlRepository(migrationPool).initSchema();
  assert.deepStrictEqual(migrationPool.state.persons.map(person => person.employee_no), ['A001', 'A002']);
  assert.deepStrictEqual(migrationPool.state.accounts.map(account => account.login_name), ['A001', 'A002']);
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
    'project-only people should receive a basic submitter role during migration'
  );
  assert.strictEqual(
    migrationPool.state.departments.find(department => department.name === '工程技术部').final_responsible_person_id,
    migratedOwner.person_id,
    'confirmed department final responsible person should initialize when person exists'
  );

  const changedPasswordHash = hashPassword('ChangedPass123456!');
  const migratedOwnerAccount = migrationPool.state.accounts.find(account => account.person_id === migratedOwner.person_id);
  migratedOwnerAccount.password_hash = changedPasswordHash;
  migratedOwnerAccount.must_change_password = 0;
  await makeIdentityMysqlRepository(migrationPool).initSchema();
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
  assert.deepStrictEqual(payload.roleCodes, ['owner', 'decision_group']);
  assert.ok(payload.permissions.includes('process_governance:view_department'));
  assert.ok(payload.permissions.includes('guidance:create'));
  assert.ok(!payload.permissions.includes('rbac:manage'), 'project roles must not inherit dangerous admin permission');

  await assert.rejects(
    () => repo.replaceUserRoles(501, [2], 501),
    error => error && error.statusCode === 400 && /基础权限角色/.test(error.message),
    'a person must keep at least one base permission role'
  );

  assert.strictEqual(await repo.replaceUserRoles(501, [1, 2], 501), true);
  assert.deepStrictEqual(
    pool.state.personRoles.map(row => `${row.person_id}:${row.role_id}`).sort(),
    ['501:1', '501:2']
  );

  const unsafeSql = pool.state.statements.map(entry => entry.sql).join('\n');
  assert.ok(!unsafeSql.includes('user_roles'), 'person identity repository should not use user_roles in target path');

  console.log('Person identity MySQL repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
