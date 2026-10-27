// Synthetic SQL doubles and random loopback HTTP only. blockRealMysql forbids
// accidental connections; no private configuration or real directory is read.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { makeGovernanceAccessMysqlRepository, validateRoleAssignmentInput } = require('../server/governanceAccessMysqlRepository');
const { assertCurrentMaintenanceAuthority } = require('../server/accountMaintenanceAuthority');
const { ROLE_GUIDES } = require('../server/roleDefinitions');
const auth = require('../server/auth');
const accounts = require('../server/routes/accounts');

const PERSON = '9007199254741201', DEPARTMENT = '9007199254741001';
const systemActor = { identityKind: 'system_admin', identityRef: 'system-admin:7', accountId: 7, authVersion: 1, must_change_password: 0 };
const roleInput = { roleCode: 'department_contact', scopeDepartmentId: DEPARTMENT, effectiveFrom: '2000-01-01' };
const creation = () => ({ employeeNo: 'SYN_DIRECTORY_PERSON', loginName: 'SYN_DIRECTORY_PERSON', name: 'Synthetic directory person', departmentId: DEPARTMENT, roleAssignments: [roleInput], pendingPasswordHash: 'synthetic-hash' });
const hrPermissions = () => new Set(ROLE_GUIDES.find(role => role.code === 'hr_directory_manager').permissions.map(permission => permission.code));

function syntheticPool() {
  const state = {
    person: { person_id: PERSON, employee_no: 'SYN_DIRECTORY_PERSON', person_name: 'Synthetic directory person', current_department_id: DEPARTMENT, employment_status: 'active', status: 'active' },
    account: null, assignments: [], statements: [], events: [], systemEvents: [], lastId: 201, systemActive: true
  };
  const accountRecord = () => ({ ...state.person, person_status: state.person.status, department_name: 'Synthetic department', department_status: 'active', ...(state.account || { account_id: null, account_status: null, auth_version: null }) });
  let snapshot;
  const db = {
    async beginTransaction() { snapshot = structuredClone({ account: state.account, assignments: state.assignments, events: state.events, systemEvents: state.systemEvents }); },
    async commit() {},
    async rollback() { Object.assign(state, snapshot); },
    release() {},
    async execute(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      state.statements.push({ sql: q, params });
      const rows = value => [value, []];
      const inserted = () => [{ insertId: ++state.lastId, affectedRows: 1 }, []];
      if (q.includes('FROM schema_migrations')) return rows([{ migration_key: 'synthetic' }]);
      if (q.includes('FROM system_admin_accounts')) return rows([{ account_id: '7', auth_version: '1', account_status: state.systemActive ? 'active' : 'disabled', must_change_password: 0 }]);
      if (q.includes("FROM roles WHERE role_code='admin'")) return rows([{ role_id: 1, role_name: 'Synthetic admin' }]);
      if (q.startsWith('SELECT CAST(LAST_INSERT_ID()')) return rows([{ identity_id: String(state.lastId) }]);
      if (q.includes('FROM departments') && q.includes('WHERE id=CAST')) return rows([DEPARTMENT, '9007199254741002'].includes(String(params[0])) ? [{ id: String(params[0]), name: 'Synthetic department', code: 'SYNTHETIC', status: 'active' }] : []);
      if (q.includes('FROM person WHERE employee_no=')) return rows(params[0] === state.person.employee_no ? [{ ...state.person }] : []);
      if (q.includes('FROM person WHERE person_id=CAST')) return rows(String(params[0]) === PERSON ? [{ ...state.person }] : []);
      if (q.includes('FROM person p') && q.includes('WHERE p.person_id=CAST')) return rows(String(params[0]) === PERSON ? [accountRecord()] : []);
      if (q.includes('FROM user_accounts WHERE person_id=CAST')) return rows(state.account ? [{ account_id: state.account.account_id }] : []);
      if (q.startsWith('INSERT INTO user_accounts')) {
        const result = inserted();
        state.account = { account_id: state.lastId, person_id: params[0], login_name: params[1], password_hash: params[2], account_status: 'pending_activation', auth_version: 1, must_change_password: 1 };
        return result;
      }
      if (q.startsWith('INSERT INTO identity_access_events')) { state.events.push({ type: params[0], personId: params[2], details: params[6] && JSON.parse(params[6]) }); return inserted(); }
      if (q.startsWith('INSERT INTO system_admin_events')) { state.systemEvents.push(params); return inserted(); }
      if (q.includes('FROM roles') && q.includes('WHERE role_code=?')) return rows([{ role_id: 11, role_code: params[0] }]);
      if (q.startsWith('INSERT INTO person_roles')) {
        state.assignments.push({ assignmentId: ++state.lastId, roleCode: roleInput.roleCode, scopeType: params[2], scopeDepartmentId: params[3], authorizationBasis: params[4], effectiveFrom: params[5], effectiveTo: params[6], status: 'active' });
        return [{ insertId: state.lastId, affectedRows: 1 }, []];
      }
      if (q.includes('FROM person_roles') && q.includes('WHERE person_id=CAST')) return rows(state.assignments.map(a => ({ person_role_id: a.assignmentId })));
      if (q.includes('FROM person_roles pr') && q.includes('AS assignmentId')) return rows(structuredClone(state.assignments));
      if (q.includes('FROM person_roles pr') && q.includes("r.role_code='admin'")) return rows([]);
      if (q.includes('FROM person_roles pr') && q.includes('LIMIT 1')) return rows(state.assignments.map(a => ({ person_role_id: a.assignmentId })));
      if (q.startsWith('UPDATE user_accounts')) {
        assert(state.account);
        state.account.auth_version += 1;
        if (q.includes("account_status='active'")) state.account.account_status = 'active';
        if (q.includes("account_status='disabled'")) state.account.account_status = 'disabled';
        if (q.includes('password_hash=?')) { state.account.password_hash = params[0]; state.account.must_change_password = 1; }
        return [{ affectedRows: 1 }, []];
      }
      throw new Error('Unexpected synthetic SQL: ' + q);
    }
  };
  return { state, execute: db.execute.bind(db), async getConnection() { return db; } };
}

function assertNoDirectoryWrite(state) {
  assert.equal(state.statements.filter(({ sql }) => /^(?:INSERT INTO|UPDATE|DELETE FROM) person\b/.test(sql)).length, 0);
}

for (const principal of ['person_admin', 'system_admin']) {
  test(principal + ': creation requires an existing active directory person and retains its identity', async () => {
    const previous = process.env.MDM_SYSTEM_ADMIN_ENABLED; process.env.MDM_SYSTEM_ADMIN_ENABLED = '1';
    try {
      const pool = syntheticPool(), base = makeGovernanceAccessMysqlRepository(pool), repo = principal === 'system_admin' ? base.forSystemAdmin(systemActor) : base;
      const before = structuredClone(pool.state.person);
      await assert.rejects(repo.createAccount({ ...creation(), employeeNo: 'SYN_MISSING' }), { statusCode: 409, code: 'PERSON_DIRECTORY_RECORD_REQUIRED' });
      for (const changes of [{ name: 'Changed' }, { departmentId: '9007199254741002' }]) {
        await assert.rejects(repo.createAccount({ ...creation(), ...changes }), { statusCode: 409, code: 'PERSON_IDENTITY_MISMATCH' });
      }
      assert.equal(pool.state.account, null); assert.deepEqual(pool.state.events, []);
      pool.state.person.employment_status = 'leave';
      await assert.rejects(repo.createAccount(creation()), { code: 'PERSON_INACTIVE' });
      pool.state.person.employment_status = 'active';
      const created = await repo.createAccount(creation());
      assert.equal(created.person_id, PERSON); assert.equal(created.current_department_id, DEPARTMENT);
      assert.equal(created.account_status, 'pending_activation');
      assert.deepEqual(pool.state.person, before); assertNoDirectoryWrite(pool.state);
      assert.equal(pool.state.events[0].details.creationMode, 'existing_person');
      if (principal === 'system_admin') assert(pool.state.systemEvents.length >= 2);
    } finally { if (previous === undefined) delete process.env.MDM_SYSTEM_ADMIN_ENABLED; else process.env.MDM_SYSTEM_ADMIN_ENABLED = previous; }
  });

  test(principal + ': legacy PATCH cannot alter directory facts; unchanged payload is a no-op; account controls remain usable', async () => {
    const previous = process.env.MDM_SYSTEM_ADMIN_ENABLED; process.env.MDM_SYSTEM_ADMIN_ENABLED = '1';
    try {
      const pool = syntheticPool(), base = makeGovernanceAccessMysqlRepository(pool), repo = principal === 'system_admin' ? base.forSystemAdmin(systemActor) : base;
      await repo.assignAccount(PERSON, { expectedPerson: { employeeNo: creation().employeeNo, name: creation().name, departmentId: DEPARTMENT }, pendingPasswordHash: 'synthetic' });
      const unchanged = structuredClone({ person: pool.state.person, account: pool.state.account, events: pool.state.events, systemEvents: pool.state.systemEvents });
      for (const change of [{ name: 'Changed' }, { name: '' }, { name: null }, { departmentId: 92 }, { departmentId: null }, { employeeNo: 'Changed' }]) {
        await assert.rejects(repo.updateAccount(PERSON, change), error => error.statusCode === 409 && error.code === 'PERSON_DIRECTORY_MAINTENANCE_REQUIRED' && /行政人事/.test(error.message));
      }
      await assert.rejects(repo.updateAccount(PERSON, { roleAssignments: [roleInput] }), { statusCode: 409, code: 'ACCOUNT_ROLE_ASSIGNMENT_ENDPOINT_REQUIRED' });
      const result = await repo.updateAccount(PERSON, { name: creation().name, employeeNo: creation().employeeNo, departmentId: DEPARTMENT, roleAssignments: [] });
      assert.equal(result.person_id, PERSON);
      assert.deepEqual({ person: pool.state.person, account: pool.state.account, events: pool.state.events, systemEvents: pool.state.systemEvents }, unchanged);
      await repo.grantRole(PERSON, roleInput);
      assert.equal((await repo.activateAccount(PERSON, { passwordHash: 'synthetic-activated' })).account_status, 'active');
      assert.equal((await repo.disableAccount(PERSON, { reason: 'Synthetic reason' })).account_status, 'disabled');
      assert.equal((await repo.enableAccount(PERSON)).account_status, 'active');
      await repo.resetPassword(PERSON, { passwordHash: 'synthetic-reset' });
      assert.equal(pool.state.account.password_hash, 'synthetic-reset');
      assert.deepEqual(pool.state.person, unchanged.person); assertNoDirectoryWrite(pool.state);
      if (principal === 'system_admin') {
        pool.state.systemActive = false;
        await assert.rejects(repo.resetPassword(PERSON, { passwordHash: 'must-not-write' }), { code: 'SYSTEM_ADMIN_ACTOR_CHANGED' });
        assert.equal(pool.state.account.password_hash, 'synthetic-reset');
      }
    } finally { if (previous === undefined) delete process.env.MDM_SYSTEM_ADMIN_ENABLED; else process.env.MDM_SYSTEM_ADMIN_ENABLED = previous; }
  });
}

test('directory authority alone cannot create, activate, reset or grant accounts', () => {
  const context = { personId: 19 }, authority = { valid: true, user: { employment_status: 'active' }, permissions: hrPermissions(), fieldConstraints: {} };
  const assignment = validateRoleAssignmentInput({ roleCode: 'hr_directory_manager', effectiveFrom: '2000-01-01' }, DEPARTMENT, true);
  assert.equal(assignment.scopeType, 'global'); assert.equal(assignment.scopeDepartmentId, null);
  for (const operation of ['createAccount', 'assignAccount', 'updateAccount', 'grantRole', 'revokeRole', 'activateAccount', 'enableAccount', 'disableAccount', 'resetPassword']) {
    assert.throws(() => assertCurrentMaintenanceAuthority(authority, context, operation, 19), error => error.statusCode === 403);
  }
});

test('HTTP preserves directory conflicts and exact identifiers; HR permissions cannot enter account maintenance', async () => {
  const previousModel = process.env.MDM_IDENTITY_READ_MODEL, previousSystem = process.env.MDM_SYSTEM_ADMIN_ENABLED;
  process.env.MDM_IDENTITY_READ_MODEL = 'mysql'; process.env.MDM_SYSTEM_ADMIN_ENABLED = '1';
  const pool = syntheticPool(); let permissions = new Set(['identity:manage-account', 'identity:assign-role']);
  auth.setIdentityRepositoryFactory(() => ({ async validateSession() { return { valid: true, user: systemActor }; }, async getUserEffectivePermissions() { return { permSet: permissions, fieldConstraints: {} }; } }));
  accounts.setRepositoryFactory(() => makeGovernanceAccessMysqlRepository(pool));
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.session = { ...systemActor, userId: systemActor.identityRef }; next(); }); app.use('/accounts', accounts);
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const request = (method, suffix, body) => fetch('http://127.0.0.1:' + server.address().port + '/accounts' + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const missing = await request('POST', '', { ...creation(), employeeNo: 'SYN_MISSING', loginName: 'SYN_MISSING' });
    assert.equal(missing.status, 409); assert.equal((await missing.json()).code, 'PERSON_DIRECTORY_RECORD_REQUIRED');
    assert.equal((await request('POST', '', creation())).status, 201);
    for (const changed of [{ name: 'Changed' }, { employeeNo: 'Changed' }, { departmentId: 92 }]) {
      const response = await request('PATCH', '/' + PERSON, changed);
      assert.equal(response.status, 409); assert.equal((await response.json()).code, 'PERSON_DIRECTORY_MAINTENANCE_REQUIRED');
    }
    assert.equal((await request('PATCH', '/' + PERSON, { name: creation().name, departmentId: DEPARTMENT })).status, 200);
    permissions = hrPermissions();
    for (const [method, suffix, body] of [['POST', '', creation()], ['PATCH', '/' + PERSON, { name: 'Changed' }], ['POST', '/' + PERSON + '/assign-account', {}], ['POST', '/' + PERSON + '/role-assignments', roleInput], ['POST', '/' + PERSON + '/reset-password', {}]]) {
      assert.equal((await request(method, suffix, body)).status, 403);
    }
    assertNoDirectoryWrite(pool.state);
  } finally {
    await new Promise(resolve => server.close(resolve)); auth.resetIdentityRepositoryFactory(); accounts.resetRepositoryFactory();
    if (previousModel === undefined) delete process.env.MDM_IDENTITY_READ_MODEL; else process.env.MDM_IDENTITY_READ_MODEL = previousModel;
    if (previousSystem === undefined) delete process.env.MDM_SYSTEM_ADMIN_ENABLED; else process.env.MDM_SYSTEM_ADMIN_ENABLED = previousSystem;
  }
});
