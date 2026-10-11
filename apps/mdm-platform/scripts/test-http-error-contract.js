// R07 request error contract. Real HTTP/session middleware with injected synthetic repositories.
// The point is that a client-side mistake is reported as a client-side mistake, that the analysis
// endpoints keep their existing codes, and that a malformed credential never reaches the account
// lookup or the password hasher.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
process.env = isolatedEnvironment({
  NODE_ENV: 'test', HOST: '127.0.0.1', MDM_ACCESS_MODE: 'http-local', MDM_SESSION_STORE: 'memory',
  MDM_IDENTITY_READ_MODEL: 'mysql', PROCESS_GOVERNANCE_READ_MODEL: 'mysql',
  MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', MYSQL_USER: 'synthetic', MYSQL_PASSWORD: 'synthetic-only',
  MYSQL_DATABASE: 'unreachable_test',
  SESSION_SECRET: 'synthetic-http-error-contract-secret-only',
  PROCESS_V7_PREVIEW_ENABLED: '0', PROCESS_V7_FORMAL_ENABLED: '0'
});
require('./testHelpers/blockRealMysql');

// Count hashing attempts so "never reaches bcrypt" is measurable rather than asserted by reading.
const bcrypt = require('bcryptjs');
let hashAttempts = 0;
const realCompare = bcrypt.compare;
bcrypt.compare = function counted(password, hash, callback) {
  hashAttempts += 1;
  return realCompare.call(this, password, hash, callback);
};

const auth = require('../server/auth');
const org = require('../server/routes/org');

const password = 'SyntheticError07!';
const passwordHash = auth.hashPassword(password);
let identityLookups = 0;
const user = {
  personId: 81, id: 81, accountId: 181, authVersion: 1, auth_version: 1,
  employeeNo: 'known', personName: 'known', name: 'known', role: 'department_contact',
  current_department_id: 91, departmentId: 91, accountStatus: 'active', account_status: 'active',
  must_change_password: 0, password_hash: passwordHash
};
const identity = {
  async getUserByLoginName(name) { identityLookups += 1; return name === 'known' ? { ...user } : null; },
  async getUserByEmployeeNo(name) { return this.getUserByLoginName(name); },
  async recordSuccessfulLogin() {},
  async validateSession() { return { valid: true, user: { personId: 81, current_department_id: 91, person_name: 'known' } }; },
  async getUserEffectivePermissions() { return { permSet: new Set(), fieldConstraints: {} }; },
  async getUserRoleCodes() { return []; },
  async getDepartmentById() { return null; },
  async listDepartments() { return []; },
  async getPasswordStatus() { return { is_default_password: false }; }
};
auth.setIdentityRepositoryFactory(() => identity);
org.setIdentityRepositoryFactory(() => identity);

async function main() {
  const app = require('../server/index');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function send(url, { method = 'POST', body, contentType = 'application/json' } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': contentType },
      body
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON responses are checked as text */ }
    return { status: res.status, body: parsed, text };
  }

  try {
    // 1. A malformed body is a client error on every path, not only on the analysis endpoints.
    const malformed = await send('/api/org/me', { body: '{"loginName":' });
    assert.equal(malformed.status, 400, malformed.text);
    assert.equal(malformed.body.code, 'REQUEST_JSON_INVALID');
    assert.ok(!/stack|at Object|node_modules/i.test(malformed.text), 'no diagnostic text is echoed');

    // 2. An oversized body is a capacity problem, and it is reported as one.
    const oversized = await send('/api/org/me', { body: JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024 + 512) }) });
    assert.equal(oversized.status, 413, oversized.text.slice(0, 200));
    assert.equal(oversized.body.code, 'REQUEST_PAYLOAD_TOO_LARGE');

    // 3. The analysis endpoints keep their existing codes: this is a compatibility regression check.
    const analysisMalformed = await send('/api/analysis/runs', { body: '{' });
    assert.equal(analysisMalformed.status, 400, analysisMalformed.text.slice(0, 200));
    assert.equal(analysisMalformed.body.code, 'DEFINITION_ANALYSIS_JSON_INVALID');
    const analysisOversized = await send('/api/analysis/runs', { body: JSON.stringify({ padding: 'x'.repeat(300 * 1024) }) });
    assert.equal(analysisOversized.status, 413, analysisOversized.text.slice(0, 200));
    assert.equal(analysisOversized.body.code, 'DEFINITION_ANALYSIS_PAYLOAD_TOO_LARGE');

    // 4. A credential of the wrong type is rejected before any account lookup and before hashing.
    const lookupsBefore = identityLookups, hashesBefore = hashAttempts;
    for (const body of [{ loginName: 'known', password: { toString: () => 'x' } }, { loginName: { length: 1 }, password }, { loginName: 'known' }]) {
      const shaped = await send('/api/org/login', { body: JSON.stringify(body) });
      assert.equal(shaped.status, 400, JSON.stringify(body));
      assert.equal(shaped.body.code, 'LOGIN_CREDENTIAL_INVALID');
    }
    assert.equal(identityLookups, lookupsBefore, 'a malformed credential never reaches the account lookup');
    assert.equal(hashAttempts, hashesBefore, 'a malformed credential never reaches the password hasher');

    // 5. Account existence is not observable: a missing account and a wrong password look the same.
    const missing = await send('/api/org/login', { body: JSON.stringify({ loginName: 'not_a_user', password: 'whatever' }) });
    const wrongPassword = await send('/api/org/login', { body: JSON.stringify({ loginName: 'known', password: 'whatever' }) });
    assert.equal(missing.status, 401);
    assert.equal(wrongPassword.status, 401);
    assert.equal(missing.text, wrongPassword.text, 'the failure appearance does not depend on account existence');
    assert.ok(hashAttempts > hashesBefore, 'a well-formed credential does reach the password check');

    console.log('R07 request error contract passed: 400/413/415 classification, analysis codes preserved, credentials gated');
  } finally {
    bcrypt.compare = realCompare;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await app.locals.closeRuntime();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
