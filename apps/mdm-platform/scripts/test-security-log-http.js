// R06 correlation and resilience over real HTTP. Every response carries X-Request-Id, and the
// matching log line must exist for a malformed body, a refused access, a rate-limited login and a
// database-availability refusal. A log destination that throws must not change any outcome.
// Synthetic repositories only; no database connection.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
process.env = isolatedEnvironment({
  NODE_ENV: 'test', HOST: '127.0.0.1', MDM_ACCESS_MODE: 'http-local', MDM_SESSION_STORE: 'memory',
  MDM_IDENTITY_READ_MODEL: 'mysql', PROCESS_GOVERNANCE_READ_MODEL: 'mysql',
  MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', MYSQL_USER: 'synthetic', MYSQL_PASSWORD: 'synthetic-only',
  MYSQL_DATABASE: 'unreachable_test',
  SESSION_SECRET: 'synthetic-security-log-http-secret-only',
  PROCESS_V7_PREVIEW_ENABLED: '0', PROCESS_V7_FORMAL_ENABLED: '0'
});
require('./testHelpers/blockRealMysql');

const lines = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = chunk => { lines.push(String(chunk).trim()); return true; };

const auth = require('../server/auth');
const org = require('../server/routes/org');
const versionsRouter = require('../server/routes/versions');

const password = 'SyntheticLog06!';
const passwordHash = auth.hashPassword(password);
const user = {
  personId: 81, id: 81, accountId: 181, authVersion: 1, auth_version: 1,
  employeeNo: 'logger', personName: 'logger', name: 'logger', role: 'department_contact',
  current_department_id: 91, departmentId: 91, accountStatus: 'active', account_status: 'active',
  must_change_password: 0, password_hash: passwordHash
};
// Two callers: one with no governance read right (refused before any lookup) and one who is a
// department reader (so the lookup really runs and its failure is what the caller sees).
const deptReader = { ...user, personId: 82, id: 82, accountId: 182, employeeNo: 'deptreader', personName: 'deptreader', name: 'deptreader' };
const identity = {
  async getUserByLoginName(name) { if (name === 'logger') return { ...user }; if (name === 'deptreader') return { ...deptReader }; return null; },
  async getUserByEmployeeNo(name) { return this.getUserByLoginName(name); },
  async recordSuccessfulLogin() {},
  async validateSession(session) { return { valid: true, user: { personId: Number(session.personId), current_department_id: 91, person_name: 'logger', must_change_password: 0 } }; },
  async getUserEffectivePermissions(personId) {
    return { permSet: new Set(Number(personId) === 82 ? ['mapping:read', 'governance:read-department'] : ['mapping:read']), fieldConstraints: {} };
  },
  async getUserRoleCodes() { return []; },
  async getDepartmentById() { return null; },
  async listDepartments() { return []; },
  async getPasswordStatus() { return { is_default_password: false }; }
};
auth.setIdentityRepositoryFactory(() => identity);
org.setIdentityRepositoryFactory(() => identity);
versionsRouter.setAuditRepositoryFactory(async () => ({
  async readContextDepartment() { const error = new Error('table missing'); error.code = 'ER_NO_SUCH_TABLE'; error.sql = 'SELECT dept_id FROM data_map_contexts'; throw error; },
  async readFieldDepartment() { return null; },
  async listEntityVersions() { return { changeSets: [], logs: [] }; },
  async listMappingVersions() { return []; },
  async listFieldVersions() { return []; }
}));

function records() { return lines.map(line => { try { return JSON.parse(line); } catch { return { raw: line }; } }); }
function recordsFor(requestId) { return records().filter(record => record.request_id === requestId); }

async function main() {
  const app = require('../server/index');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = async (url, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + url, { method, headers, body });
    await res.text();
    return { status: res.status, requestId: res.headers.get('x-request-id') };
  };
  const client = {};
  const login = async (name = 'logger') => {
    const res = await fetch(base + '/api/org/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginName: name, password }) });
    client.cookie = res.headers.get('set-cookie').split(';')[0];
    await res.text();
  };

  try {
    // 1. Every response carries a correlation id, including one that never reached a route.
    const malformed = await send('/api/org/me', { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } });
    assert.equal(malformed.status, 400);
    assert.ok(malformed.requestId, 'even a parse failure gets a correlation id');
    assert.ok(recordsFor(malformed.requestId).some(record => record.event === 'parse_failed'), 'the parse failure is logged under that id');

    // 2. A refused access is logged with the same id the caller received.
    await login();
    const denied = await fetch(base + '/api/versions/mapping/701', { headers: { Cookie: client.cookie } });
    await denied.text();
    const deniedId = denied.headers.get('x-request-id');
    assert.equal(denied.status, 404);
    const deniedRecords = recordsFor(deniedId);
    assert.ok(deniedRecords.some(record => record.event === 'access_denied'), 'a refusal is recorded as an access event');
    assert.ok(deniedRecords.every(record => !/701|合成|审核人/.test(record.raw || JSON.stringify(record))), 'the record carries no object value');

    // 3. A rate-limited login is logged as a rate event.
    let limited = null;
    for (let i = 0; i < 10 && !limited; i += 1) {
      const res = await fetch(base + '/api/org/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginName: 'never_exists', password: 'wrong' }) });
      await res.text();
      if (res.status === 429) limited = res.headers.get('x-request-id');
    }
    assert.ok(limited, 'the limiter engaged');
    assert.ok(recordsFor(limited).some(record => record.event === 'rate_limited'), 'the refusal is recorded as a rate event');

    // 4. A database-availability refusal is recorded by classification, and the caller gets a
    //    correlation id it can quote. This caller may be allowed, so the lookup runs and its
    //    failure is what surfaces.
    const reader = {};
    await login('deptreader');
    reader.cookie = client.cookie;
    const unavailable = await fetch(base + '/api/versions/mapping/702', { headers: { Cookie: reader.cookie } });
    const unavailableBody = await unavailable.json();
    assert.equal(unavailable.status, 503, JSON.stringify(unavailableBody));
    assert.equal(unavailableBody.request_id, unavailable.headers.get('x-request-id'));
    const unavailableRecords = recordsFor(unavailable.headers.get('x-request-id'));
    assert.ok(unavailableRecords.some(record => record.event === 'request_failed' && record.code === 'ER_NO_SUCH_TABLE'));
    assert.ok(unavailableRecords.every(record => !/data_map_contexts|SELECT dept_id/.test(record.raw || JSON.stringify(record))), 'no SQL text is recorded');

    // 5. A log destination that throws must not change the outcome of the request being served.
    const before = await send('/api/health');
    assert.equal(before.status, 200);
    process.stdout.write = () => { throw new Error('log destination down'); };
    try {
      const healthy = await send('/api/health');
      assert.equal(healthy.status, 200, 'a broken log destination cannot turn a served request into a failure');
      const deniedAgain = await fetch(base + '/api/versions/mapping/702', { headers: { Cookie: client.cookie } });
      await deniedAgain.text();
      assert.equal(deniedAgain.status, 503, 'and cannot hide the original business result either');
    } finally {
      process.stdout.write = chunk => { lines.push(String(chunk).trim()); return true; };
    }

    // 6. No record anywhere carries a sensitive marker.
    const joined = lines.join('\n');
    for (const marker of ['password', 'Cookie', 'csrf', 'claim', 'sqlMessage', 'parameters', ' at Query.execute']) {
      assert.ok(!new RegExp(marker, 'i').test(joined), `no record may contain ${marker}`);
    }

    console.log('R06 security log HTTP checks passed: correlation ids, event classes, resilient sink');
  } finally {
    process.stdout.write = realWrite;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await app.locals.closeRuntime();
    versionsRouter.resetAuditRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
