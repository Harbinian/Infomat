// R08 exact-identity boundary at the login seam.
// Real HTTP/session middleware; explicitly injected synthetic identity repository; no database.
// Contract under test: a session may only be written when account, person and authorization
// version are exactly representable. Unrepresentable values are refused, never truncated,
// defaulted to 0 or replaced by a newly created identity.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
process.env = isolatedEnvironment({
  NODE_ENV: 'test', HOST: '127.0.0.1', MDM_ACCESS_MODE: 'http-local', MDM_SESSION_STORE: 'memory',
  MDM_IDENTITY_READ_MODEL: 'mysql', PROCESS_GOVERNANCE_READ_MODEL: 'mysql',
  MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', MYSQL_USER: 'synthetic', MYSQL_PASSWORD: 'synthetic-only',
  MYSQL_DATABASE: 'unreachable_test',
  SESSION_SECRET: 'synthetic-b02-login-boundary-secret-only',
  PROCESS_V7_PREVIEW_ENABLED: '0', PROCESS_V7_FORMAL_ENABLED: '0'
});
require('./testHelpers/blockRealMysql');
const Module = require('node:module');
const load = Module._load;
Module._load = function (name, ...args) {
  if (/^(\.\.?\/)+db$/.test(name)) throw new Error('FORMAL_SQLITE_FORBIDDEN');
  return load.call(this, name, ...args);
};

const auth = require('../server/auth');
const org = require('../server/routes/org');
const { identityInteger } = require('../server/sessionSubject');

const password = 'SyntheticBoundary08!';
const passwordHash = auth.hashPassword(password);

// Each account carries the exact shape the MySQL identity read model produces: BIGINT columns
// arrive as decimal strings, and unrepresentable values stay unrepresentable.
const accounts = {
  ordinary: { loginName: 'ordinary', personId: '81', accountId: '181', authVersion: '1', account_status: 'active' },
  bigint_person: {
    loginName: 'bigint_person', personId: '9007199254740993', accountId: '9007199254740995',
    authVersion: '9007199254740997', account_status: 'active'
  },
  zero_version: { loginName: 'zero_version', personId: '83', accountId: '183', authVersion: 0, account_status: 'active' },
  fractional_version: { loginName: 'fractional_version', personId: '84', accountId: '184', authVersion: 1.5, account_status: 'active' },
  missing_account: { loginName: 'missing_account', personId: '85', accountId: null, authVersion: 1, account_status: 'active' },
  missing_person: { loginName: 'missing_person', personId: null, id: null, accountId: '186', authVersion: 1, account_status: 'active' }
};

function accountFor(record) {
  return {
    ...record, id: record.personId, person_id: record.personId,
    account_id: record.accountId, auth_version: record.authVersion,
    employeeNo: record.loginName, personName: record.loginName, name: record.loginName,
    role: 'department_contact', current_department_id: '91', departmentId: '91',
    password_hash: passwordHash, must_change_password: 0
  };
}

const identity = {
  async getUserByLoginName(loginName) {
    const record = accounts[loginName];
    return record ? accountFor(record) : null;
  },
  async getUserByEmployeeNo(loginName) { return this.getUserByLoginName(loginName); },
  async recordSuccessfulLogin() {},
  // Session validation binds on the exact stored identifiers, so a session written from a
  // rounded or defaulted value can never validate.
  async validateSession(session = {}) {
    const match = Object.values(accounts).find(record =>
      String(record.accountId) === String(session.accountId) &&
      String(record.authVersion) === String(session.authVersion));
    return { valid: Boolean(match) && match.account_status === 'active',
      user: match ? { personId: match.personId, current_department_id: match.departmentId || '91', person_name: '合成调用者', must_change_password: 0 } : undefined };
  },
  async getUserEffectivePermissions() { return { permSet: new Set(), fieldConstraints: {} }; },
  async getUserRoleCodes() { return []; },
  async getDepartmentById(id) { return { id, name: '合成甲部' }; },
  async listDepartments() { return [{ id: 91, name: '合成甲部' }]; },
  async getPasswordStatus() { return { is_default_password: false }; }
};
auth.setIdentityRepositoryFactory(() => identity);
org.setIdentityRepositoryFactory(() => identity);

async function main() {
  const app = require('../server/index');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(client, url, method = 'GET', body) {
    const res = await fetch(base + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: client.cookie || '',
        ...(client.csrf ? { 'X-CSRF-Token': client.csrf } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (res.headers.get('set-cookie')) client.cookie = res.headers.get('set-cookie').split(';')[0];
    const parsed = res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text();
    return { status: res.status, body: parsed, headers: res.headers };
  }

  try {
    // 1. Ordinary identities keep the historical shape and produce a working session.
    const ordinary = {};
    const ok = await request(ordinary, '/api/org/login', 'POST', { loginName: 'ordinary', password });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.id, 81);
    assert.equal(ok.body.personId, 81);
    assert.equal(ok.body.accountId, 181);
    assert.equal((await request(ordinary, '/api/csrf-token')).status, 200, 'ordinary session authenticates');

    // 2. Identities beyond the safe-integer range stay exact end to end.
    const bigint = {};
    const wide = await request(bigint, '/api/org/login', 'POST', { loginName: 'bigint_person', password });
    assert.equal(wide.status, 200);
    assert.equal(wide.body.personId, '9007199254740993', 'adjacent BIGINT person id must not be rounded');
    assert.equal(wide.body.id, '9007199254740993');
    assert.equal(wide.body.accountId, '9007199254740995');
    assert.equal((await request(bigint, '/api/csrf-token')).status, 200, 'exact BIGINT session authenticates');
    assert.equal(identityInteger(wide.body.personId), '9007199254740993');
    assert.equal(identityInteger(wide.body.accountId), '9007199254740995');
    // The neighbouring value must never be accepted as the same identity.
    assert.equal(identityInteger('9007199254740992') === wide.body.personId, false);

    // 3. Unrepresentable authorization versions are refused instead of defaulted to 0.
    for (const [loginName, reason] of [
      ['zero_version', 'a zero authorization version is not a representable identity'],
      ['fractional_version', 'a fractional authorization version must not be rounded'],
      ['missing_account', 'an absent account id must not be back-filled'],
      ['missing_person', 'an absent person id must not be back-filled for a person session']
    ]) {
      const client = {};
      const refused = await request(client, '/api/org/login', 'POST', { loginName, password });
      assert.equal(refused.status, 503, reason);
      assert.equal(refused.body.code, 'IDENTITY_UNAVAILABLE', reason);
      // No usable session may survive a refused login.
      assert.equal((await request(client, '/api/csrf-token')).status, 401, `${loginName}: refused login leaves no session`);
      assert.equal((await request(client, '/api/org/me')).status, 401, `${loginName}: refused login leaves no session`);
    }

    // 4. Refusals after a proven password are not login failures and must not lock the account
    //    out of a later legitimate login.
    const retry = {};
    assert.equal((await request(retry, '/api/org/login', 'POST', { loginName: 'ordinary', password })).status, 200);

    console.log('R08 login identity boundary passed: exact BIGINT preserved, unrepresentable identities refused; no MySQL/SQLite');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await app.locals.closeRuntime();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
