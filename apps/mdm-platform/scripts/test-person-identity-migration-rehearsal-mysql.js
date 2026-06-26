const assert = require('assert');

const { hashPassword } = require('../server/auth');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function makeMigrationRehearsalPool() {
  const state = {
    statements: [],
    nextPersonId: 8001,
    nextDepartmentId: 6001,
    users: [
      { id: 10, name: '部门负责人', employee_no: 'MGR001', department_id: 101, role: 'owner', password_hash: hashPassword('MgrPass123456!'), must_change_password: 0, created_at: '2026-06-01 00:00:00' },
      { id: 20, name: '数据负责人', employee_no: 'DATA001', department_id: 101, role: 'reviewer', password_hash: hashPassword('DataPass123456!'), must_change_password: 1, created_at: '2026-06-01 00:00:00' },
      { id: 30, name: '流程专员', employee_no: 'FLOW001', department_id: 102, role: 'submitter', password_hash: hashPassword('FlowPass123456!'), must_change_password: 0, created_at: '2026-06-01 00:00:00' }
    ],
    roles: [
      { role_id: 1, role_code: 'owner', role_name: '业务负责人' },
      { role_id: 2, role_code: 'reviewer', role_name: '审核员' },
      { role_id: 3, role_code: 'submitter', role_name: '提交人' },
      { role_id: 4, role_code: 'data_quality', role_name: '数据质量员' }
    ],
    userRoles: [
      { user_id: 10, role_id: 1, assigned_by: 20 },
      { user_id: 20, role_id: 4, assigned_by: 10 },
      { user_id: 30, role_id: 3, assigned_by: null }
    ],
    departments: [
      {
        id: 101,
        name: '测试治理部',
        code: 'TEST_GOV',
        parent_id: null,
        path: '/101/',
        department_type: 'domain',
        manager_user_id: 10,
        data_owner_user_id: 20,
        final_responsible_person_id: null,
        data_owner_person_id: null,
        status: 'active'
      }
    ],
    persons: [],
    accounts: [],
    personRoles: [],
    tables: {
      process_governance_quality_cases: [
        { case_id: 9001, owner_user_id: 10, closed_by: 20, owner_person_id: null, closed_by_person_id: null }
      ],
      process_mapping_todos: [
        { todo_id: 9002, owner_user_id: 20, closed_by: 10, owner_person_id: null, closed_by_person_id: null }
      ],
      mdm_mapping_records: [
        { mapping_id: 9003, submitted_by: 30, submitted_by_person_id: null }
      ],
      data_map_objects: [
        { object_id: 9004, steward_user_id: 20, created_by: 10, updated_by: 30, steward_person_id: null, created_by_person_id: null, updated_by_person_id: null }
      ]
    }
  };
  state.tables.departments = state.departments;

  function userById(userId) {
    return state.users.find(user => Number(user.id) === Number(userId));
  }

  function personByEmployeeNo(employeeNo) {
    return state.persons.find(person => person.employee_no === employeeNo);
  }

  function personByUserId(userId) {
    const user = userById(userId);
    return user ? personByEmployeeNo(user.employee_no) : null;
  }

  function roleByCode(roleCode) {
    return state.roles.find(role => role.role_code === roleCode);
  }

  function ensurePerson(user) {
    let person = personByEmployeeNo(user.employee_no);
    if (!person) {
      person = {
        person_id: state.nextPersonId++,
        employee_no: user.employee_no,
        person_name: user.name,
        current_department_id: user.department_id,
        employment_status: 'active',
        status: 'active',
        created_at: user.created_at
      };
      state.persons.push(person);
    } else {
      person.person_name = user.name;
      person.current_department_id = user.department_id;
      person.status = 'active';
    }
    return person;
  }

  function ensurePersonRole(personId, roleId, assignedByPersonId = null) {
    if (!state.personRoles.some(row => Number(row.person_id) === Number(personId) && Number(row.role_id) === Number(roleId))) {
      state.personRoles.push({ person_id: personId, role_id: roleId, assigned_by_person_id: assignedByPersonId });
    }
  }

  function applyLegacyFieldMigration(table, userField, personField) {
    const rows = state.tables[table] || [];
    let affected = 0;
    for (const row of rows) {
      if (row[userField] == null || row[personField] != null) continue;
      const person = personByUserId(row[userField]);
      if (!person) continue;
      row[personField] = person.person_id;
      affected += 1;
    }
    return affected;
  }

  async function execute(sql, params = []) {
    const normalizedSql = normalizeSql(sql);
    state.statements.push({ sql: normalizedSql, params });

    if (normalizedSql.startsWith('CREATE TABLE') ||
        normalizedSql.startsWith('ALTER TABLE') ||
        normalizedSql.startsWith('INSERT INTO roles') ||
        normalizedSql.startsWith('INSERT INTO permissions') ||
        normalizedSql.startsWith('INSERT IGNORE INTO role_permissions')) {
      return [[], undefined];
    }

    if (normalizedSql.startsWith('INSERT INTO person')) {
      for (const user of state.users) ensurePerson(user);
      return [{ affectedRows: state.users.length }, undefined];
    }

    if (normalizedSql.startsWith('INSERT INTO user_accounts')) {
      for (const user of state.users) {
        const person = ensurePerson(user);
        let account = state.accounts.find(row => Number(row.person_id) === Number(person.person_id));
        if (!account) {
          account = {
            account_id: person.person_id + 10000,
            person_id: person.person_id,
            login_name: user.employee_no,
            password_hash: user.password_hash,
            must_change_password: user.must_change_password,
            account_status: 'active'
          };
          state.accounts.push(account);
        } else {
          account.login_name = user.employee_no;
          account.password_hash = user.password_hash;
          account.must_change_password = user.must_change_password;
          account.account_status = 'active';
        }
      }
      return [{ affectedRows: state.accounts.length }, undefined];
    }

    if (normalizedSql.startsWith('INSERT IGNORE INTO person_roles') && normalizedSql.includes('FROM user_roles ur')) {
      for (const legacyRole of state.userRoles) {
        const person = personByUserId(legacyRole.user_id);
        const assignedByPerson = legacyRole.assigned_by ? personByUserId(legacyRole.assigned_by) : null;
        if (person) ensurePersonRole(person.person_id, legacyRole.role_id, assignedByPerson && assignedByPerson.person_id || null);
      }
      return [{ affectedRows: state.personRoles.length }, undefined];
    }

    if (normalizedSql.startsWith('INSERT IGNORE INTO person_roles') && normalizedSql.includes('JOIN roles r ON r.role_code = u.role')) {
      for (const user of state.users) {
        const person = ensurePerson(user);
        const role = roleByCode(user.role);
        if (role) ensurePersonRole(person.person_id, role.role_id, null);
      }
      return [{ affectedRows: state.personRoles.length }, undefined];
    }

    if (normalizedSql.startsWith('INSERT IGNORE INTO person_roles') && normalizedSql.includes("r.role_code='submitter'")) {
      const submitter = roleByCode('submitter');
      if (submitter) {
        for (const person of state.persons) {
          const roleIds = state.personRoles.filter(row => Number(row.person_id) === Number(person.person_id)).map(row => row.role_id);
          const hasBasicRole = state.roles.some(role => roleIds.includes(role.role_id) && ['submitter', 'owner', 'reviewer', 'admin'].includes(role.role_code));
          if (!hasBasicRole) ensurePersonRole(person.person_id, submitter.role_id, null);
        }
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

    const migrationMatch = normalizedSql.match(/^UPDATE ([a-z_]+) target JOIN users u ON target\.([a-z_]+)=u\.id JOIN person p ON p\.employee_no=u\.employee_no SET target\.([a-z_]+)=p\.person_id WHERE target\.\2 IS NOT NULL AND target\.\3 IS NULL$/);
    if (migrationMatch) {
      const [, table, userField, personField] = migrationMatch;
      return [{ affectedRows: applyLegacyFieldMigration(table, userField, personField) }, undefined];
    }

    if (normalizedSql.startsWith('INSERT INTO departments (name, code, parent_id, department_type, manager_user_id, data_owner_user_id, final_responsible_person_id, data_owner_person_id,')) {
      const department = {
        id: state.nextDepartmentId++,
        name: params[0],
        code: params[1],
        parent_id: params[2],
        department_type: params[3],
        manager_user_id: params[4],
        data_owner_user_id: params[5],
        final_responsible_person_id: params[6],
        data_owner_person_id: params[7],
        source_system: params[8],
        external_id: params[9],
        status: params[10],
        effective_from: params[11],
        effective_to: params[12],
        created_by: params[13],
        path: null
      };
      state.departments.push(department);
      return [{ insertId: department.id, affectedRows: 1 }, undefined];
    }

    if (normalizedSql === 'UPDATE departments SET path=? WHERE id=?') {
      const department = state.departments.find(row => Number(row.id) === Number(params[1]));
      if (department) department.path = params[0];
      return [{ affectedRows: department ? 1 : 0 }, undefined];
    }

    if (normalizedSql === 'SELECT path FROM departments WHERE id=?') {
      const department = state.departments.find(row => Number(row.id) === Number(params[0]));
      return [[department ? { path: department.path } : null].filter(Boolean), undefined];
    }

    throw new Error(`Unhandled SQL in migration rehearsal fake pool: ${normalizedSql}`);
  }

  return { state, execute };
}

function personIdForUser(pool, userId) {
  const user = pool.state.users.find(row => Number(row.id) === Number(userId));
  const person = user && pool.state.persons.find(row => row.employee_no === user.employee_no);
  assert.ok(person, `missing person for legacy user ${userId}`);
  return person.person_id;
}

async function main() {
  const pool = makeMigrationRehearsalPool();
  const repo = makeIdentityMysqlRepository(pool);
  await repo.initSchema();

  for (const user of pool.state.users) {
    const person = pool.state.persons.find(row => row.employee_no === user.employee_no);
    assert.ok(person, `legacy user ${user.employee_no} should have a person`);
    const accounts = pool.state.accounts.filter(row => Number(row.person_id) === Number(person.person_id));
    assert.strictEqual(accounts.length, 1, `person ${person.person_id} should have exactly one account`);
    assert.strictEqual(accounts[0].login_name, user.employee_no);
  }

  for (const legacyRole of pool.state.userRoles) {
    const personId = personIdForUser(pool, legacyRole.user_id);
    const assignedByPersonId = legacyRole.assigned_by ? personIdForUser(pool, legacyRole.assigned_by) : null;
    const migratedRole = pool.state.personRoles.find(row =>
      Number(row.person_id) === Number(personId) &&
      Number(row.role_id) === Number(legacyRole.role_id)
    );
    assert.ok(migratedRole, `legacy role ${legacyRole.user_id}:${legacyRole.role_id} should migrate to person_roles`);
    assert.strictEqual(migratedRole.assigned_by_person_id || null, assignedByPersonId);
  }

  const department = pool.state.departments.find(row => row.code === 'TEST_GOV');
  assert.strictEqual(department.final_responsible_person_id, personIdForUser(pool, 10));
  assert.strictEqual(department.data_owner_person_id, personIdForUser(pool, 20));

  assert.strictEqual(pool.state.tables.process_governance_quality_cases[0].owner_person_id, personIdForUser(pool, 10));
  assert.strictEqual(pool.state.tables.process_governance_quality_cases[0].closed_by_person_id, personIdForUser(pool, 20));
  assert.strictEqual(pool.state.tables.process_mapping_todos[0].owner_person_id, personIdForUser(pool, 20));
  assert.strictEqual(pool.state.tables.process_mapping_todos[0].closed_by_person_id, personIdForUser(pool, 10));
  assert.strictEqual(pool.state.tables.mdm_mapping_records[0].submitted_by_person_id, personIdForUser(pool, 30));
  assert.strictEqual(pool.state.tables.data_map_objects[0].steward_person_id, personIdForUser(pool, 20));
  assert.strictEqual(pool.state.tables.data_map_objects[0].created_by_person_id, personIdForUser(pool, 10));
  assert.strictEqual(pool.state.tables.data_map_objects[0].updated_by_person_id, personIdForUser(pool, 30));

  await repo.createDepartment({
    name: '新责任部门',
    code: 'NEW_PERSON',
    department_type: 'domain',
    final_responsible_person_id: personIdForUser(pool, 10),
    data_owner_person_id: personIdForUser(pool, 20),
    status: 'active',
    created_by: personIdForUser(pool, 10)
  });
  const newPersonDepartment = pool.state.departments.find(row => row.code === 'NEW_PERSON');
  assert.strictEqual(newPersonDepartment.final_responsible_person_id, personIdForUser(pool, 10));
  assert.strictEqual(newPersonDepartment.data_owner_person_id, personIdForUser(pool, 20));
  assert.strictEqual(newPersonDepartment.manager_user_id, null);
  assert.strictEqual(newPersonDepartment.data_owner_user_id, null);

  await repo.createDepartment({
    name: '旧字段只读检查',
    code: 'LEGACY_ONLY',
    department_type: 'domain',
    manager_user_id: 10,
    data_owner_user_id: 20,
    status: 'active'
  });
  const legacyOnlyDepartment = pool.state.departments.find(row => row.code === 'LEGACY_ONLY');
  assert.strictEqual(legacyOnlyDepartment.final_responsible_person_id, null, 'legacy manager_user_id must not be copied into person responsibility fields');
  assert.strictEqual(legacyOnlyDepartment.data_owner_person_id, null, 'legacy data_owner_user_id must not be copied into person responsibility fields');

  console.log('Person identity migration rehearsal MySQL test passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
