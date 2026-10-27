// Synthetic credentials, SQL doubles and random loopback HTTP only.
// Run with -r ./scripts/testHelpers/blockRealMysql.js --test; no target DB/config.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const express = require('express');
const { employeeLoginName, accountInitialPassword } = require('../server/accountCreationPolicy');
const auth = require('../server/auth'), accounts = require('../server/routes/accounts');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-account-policy-'));
const credentialFile = path.join(directory, 'synthetic-credential');
const syntheticPassword = 'Synthetic-Initial-2026!';
fs.writeFileSync(credentialFile, syntheticPassword);
test.after(() => {
  assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert(path.basename(directory).startsWith('mdm-account-policy-'));
  fs.rmSync(directory, { recursive: true, force: true });
});

test('employee number supplies a new login name; mismatches fail explicitly', () => {
  assert.equal(employeeLoginName(' 100123 '), '100123');
  assert.equal(employeeLoginName('100123', ' 100123 '), '100123');
  assert.throws(() => employeeLoginName('100123', 'different-login'), { statusCode: 422, code: 'LOGIN_NAME_MUST_MATCH_EMPLOYEE_NO' });
});

test('first-activation secret is external; absent config retains random compatibility and bad config fails closed', () => {
  assert(accountInitialPassword({ MDM_ACCOUNT_INITIAL_PASSWORD_FILE: credentialFile }) === syntheticPassword);
  assert(accountInitialPassword({}) !== accountInitialPassword({}));
  for (const filename of ['relative-secret', path.join(directory, 'missing')]) {
    assert.throws(() => accountInitialPassword({ MDM_ACCOUNT_INITIAL_PASSWORD_FILE: filename }), error =>
      error.statusCode === 503 && error.code === 'ACCOUNT_INITIAL_PASSWORD_UNAVAILABLE' && !error.message.includes(filename));
  }
});

test('admin HTTP creation derives login, blocks mismatches and preserves maintenance permission gates', async () => {
  const previousModel = process.env.MDM_IDENTITY_READ_MODEL;
  const previousSystemAdmin = process.env.MDM_SYSTEM_ADMIN_ENABLED;
  const previousFile = process.env.MDM_ACCOUNT_INITIAL_PASSWORD_FILE;
  process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
  process.env.MDM_SYSTEM_ADMIN_ENABLED = '1';
  process.env.MDM_ACCOUNT_INITIAL_PASSWORD_FILE = credentialFile;
  let permissions = new Set(['identity:manage-account', 'identity:assign-role']);
  const calls = [];
  auth.setIdentityRepositoryFactory(() => ({
    async validateSession() { return { valid: true, user: { identityKind: 'system_admin', identityRef: 'system-admin:7', accountId: 7, authVersion: 1, must_change_password: 0 } }; },
    async getUserEffectivePermissions() { return { permSet: permissions, fieldConstraints: {} }; }
  }));
  accounts.setRepositoryFactory(() => ({
    forSystemAdmin() { return this; },
    async createAccount(payload) { calls.push(['create', payload]); return { login_name: payload.loginName, account_status: 'pending_activation', must_change_password: 1 }; },
    async assignAccount(personId, payload) { calls.push(['assign', personId, payload]); return { person_id: personId, login_name: payload.expectedPerson.employeeNo, account_status: 'pending_activation', must_change_password: 1 }; },
    async activateAccount(_id, payload) { calls.push(['activate', payload]); return { account_status: 'active', must_change_password: 1 }; },
    async resetPassword(_id, payload) { calls.push(['reset', payload]); return { must_change_password: 1 }; }
  }));
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = { identityKind: 'system_admin', userId: 'system-admin:7', accountId: 7, authVersion: 1 }; next(); });
  app.use('/api/org/accounts', accounts);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const post = (suffix, body) => fetch('http://127.0.0.1:' + server.address().port + '/api/org/accounts' + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const created = await post('', { employeeNo: '100123' });
    assert.equal(created.status, 201); assert.equal((await created.json()).login_name, '100123');
    const rejected = await post('', { employeeNo: '100123', loginName: 'other' });
    assert.equal(rejected.status, 422); assert.equal((await rejected.json()).code, 'LOGIN_NAME_MUST_MATCH_EMPLOYEE_NO');
    assert.equal(calls.filter(call => call[0] === 'create').length, 1);
    const activated = await post('/1/activate', { reason: 'synthetic activation' });
    assert.equal(activated.status, 200);
    const activationBody = await activated.json(); assert(activationBody.initialPassword === syntheticPassword);
    assert(auth.verifyPassword(syntheticPassword, calls.find(call => call[0] === 'activate')[1].passwordHash));
    assert.equal(activationBody.account.must_change_password, 1);
    const reset = await post('/1/reset-password', { reason: 'synthetic reset' });
    assert.equal(reset.status, 200); assert((await reset.json()).initialPassword !== syntheticPassword);
    permissions = new Set(['identity:manage-account']);
    assert.equal((await post('', { employeeNo: '100124' })).status, 403);
    const exactId = '9007199254740993';
    const expectedPerson = { employeeNo: '100124', name: 'Synthetic existing person', departmentId: '9007199254740995' };
    const assigned = await post('/' + exactId + '/assign-account', { expectedPerson, reason: '', loginName: 'tampered', roleAssignments: [{ roleCode: 'tampered' }], actorPersonId: 1 });
    assert.equal(assigned.status, 201);
    assert.deepEqual(await assigned.json(), { person_id: exactId, login_name: '100124', account_status: 'pending_activation', must_change_password: 1 });
    const assignment = calls.find(call => call[0] === 'assign');
    assert.equal(assignment[1], exactId);
    assert.deepEqual(assignment[2].expectedPerson, expectedPerson);
    assert.equal(assignment[2].actorPersonId, null);
    assert.equal(assignment[2].roleAssignments, undefined);
    assert.equal(assignment[2].loginName, undefined);
    assert(assignment[2].pendingPasswordHash);
    permissions = new Set(['governance:read-global']);
    assert.equal((await post('/' + exactId + '/assign-account', { expectedPerson })).status, 403);
    assert.equal(calls.filter(call => call[0] === 'assign').length, 1);
    assert.equal((await post('/1/activate', { reason: 'synthetic denied' })).status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    auth.resetIdentityRepositoryFactory(); accounts.resetRepositoryFactory();
    if (previousModel === undefined) delete process.env.MDM_IDENTITY_READ_MODEL; else process.env.MDM_IDENTITY_READ_MODEL = previousModel;
    if (previousSystemAdmin === undefined) delete process.env.MDM_SYSTEM_ADMIN_ENABLED; else process.env.MDM_SYSTEM_ADMIN_ENABLED = previousSystemAdmin;
    if (previousFile === undefined) delete process.env.MDM_ACCOUNT_INITIAL_PASSWORD_FILE; else process.env.MDM_ACCOUNT_INITIAL_PASSWORD_FILE = previousFile;
  }
});
