// Isolated HTTP/module/SQL-spy checks. Never connects to MySQL or reads local config.
// --serve keeps this synthetic harness on a random loopback port for browser QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-runtime-boundary-'));
Object.assign(process.env, {
  NODE_ENV: 'test', MDM_IDENTITY_READ_MODEL: 'mysql', PROCESS_GOVERNANCE_READ_MODEL: 'mysql',
  MDM_SESSION_STORE: 'memory', MDM_ACCESS_MODE: 'http-local', HOST: '127.0.0.1',
  MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', MYSQL_USER: 'isolated_test',
  MYSQL_PASSWORD: 'synthetic-not-a-real-credential', MYSQL_DATABASE: 'isolated_runtime_test',
  SESSION_SECRET: 'synthetic-session-secret-for-isolated-tests-only', MDM_DB_QUIET: '1',
  MDM_DB_PATH: path.join(temp, 'must-not-exist.db'), PROCESS_V7_PREVIEW_ENABLED: '0',
  PROCESS_V7_FORMAL_ENABLED: '0', PROCESS_DATA_GOVERNANCE_ENABLED: '0'
});
for (const key of ['MDM_ALLOW_LEGACY_TEST_MODE', 'PROCESS_INPUT_BASELINE_REVIEW_STORE', 'PROCESS_CANDIDATE_REVIEW_STORE']) delete process.env[key];

const { assertRuntimeConfig } = require('../server/runtimeBoundary');
assertRuntimeConfig();
for (const key of ['MDM_IDENTITY_READ_MODEL', 'PROCESS_GOVERNANCE_READ_MODEL', 'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']) {
  assert.throws(() => assertRuntimeConfig({ ...process.env, [key]: '' }), undefined, key);
}
assert.throws(() => assertRuntimeConfig({ ...process.env, PROCESS_GOVERNANCE_READ_MODEL: 'sqlite' }));
assert.throws(() => assertRuntimeConfig({ ...process.env, NODE_ENV: 'production', MDM_ALLOW_LEGACY_TEST_MODE: '1' }));
assert.throws(() => assertRuntimeConfig({ ...process.env, PROCESS_CANDIDATE_REVIEW_STORE: 'artifact' }));
assert.throws(() => assertRuntimeConfig({ ...process.env, MDM_ALLOW_LEGACY_TEST_MODE: '1', MDM_DB_PATH: path.resolve(__dirname, '../data/platform.db') }));

const originalLoad = Module._load;
let sqliteAttempts = 0;
Module._load = function(name, ...args) {
  if (name === 'better-sqlite3' || /^(\.\.?\/)+db$/.test(name)) {
    sqliteAttempts += 1;
    throw new Error('TEST_FORBIDS_SQLITE');
  }
  return originalLoad.call(this, name, ...args);
};

const mysql = require('mysql2/promise');
const sqlCalls = [];
let databaseFailure = null;
let endedPools = 0;
mysql.createPool = () => ({
  async execute(sql, params = []) {
    sqlCalls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    assert.match(sql.trim(), /^SELECT\b/i, 'runtime must not execute DDL, seeds or migrations');
    if (databaseFailure) throw Object.assign(new Error('synthetic failure; do not expose raw SQL'), { code: databaseFailure });
    return [[]];
  },
  async end() { endedPools += 1; }
});

const auth = require('../server/auth');
const org = require('../server/routes/org');
const workbench = require('../server/routes/roleWorkbench');
const design = require('../server/routes/processDesignMysql');
const { getAccessModel } = require('../server/roleDefinitions');
const departments = [{ id: 91, code: 'TEST_A', name: '隔离测试部门甲', status: 'active' }, { id: 92, code: 'TEST_B', name: '隔离测试部门乙', status: 'active' }];
let role = 'department_contact';
function currentUser() {
  const permissions = getAccessModel().roles.find(item => item.code === role).permissions;
  return { id: 81, personId: 81, accountId: 181, account_id: 181, authVersion: 1, auth_version: 1,
    name: '隔离合成用户', personName: '隔离合成用户', employeeNo: 'SYNTHETIC_81', departmentId: 91,
    departmentName: departments[0].name, current_department_id: 91, role, roleCodes: [role],
    rbacRoles: [{ code: role, name: role }], permissions, accountStatus: 'active', account_status: 'active',
    must_change_password: 0 };
}
const password = 'SyntheticPass123!';
const passwordHash = auth.hashPassword(password);
const identity = {
  async initSchema() { throw new Error('FORBIDDEN_IDENTITY_INIT'); },
  async getUserByEmployeeNo(login) { return login === 'SYNTHETIC_81' ? { ...currentUser(), password_hash: passwordHash } : null; },
  async getCurrentUserPayload() { return currentUser(); },
  async recordSuccessfulLogin() {},
  async validateSession(session) { return { valid: session.personId === 81, user: currentUser() }; },
  async getUserEffectivePermissions() { return { permSet: new Set(currentUser().permissions), fieldConstraints: {} }; },
  async getUserRoleCodes() { return [{ code: role, name: role }]; },
  async getDepartmentById(id) { return departments.find(item => item.id === Number(id)) || null; },
  async listDepartments() { return departments; },
  async getPasswordStatus() { return { is_default_password: false }; }
};

async function main() {
  // A child loads the actual production module with every outbound connection and
  // SQLite load forbidden. It does not listen on any port.
  const production = spawnSync(process.execPath, ['-e', `
    const M=require('module'),load=M._load;
    M._load=function(n,...a){if(n==='better-sqlite3'||/^(\\.\\.?\\/)+db$/.test(n))throw Error('SQLITE');return load.call(this,n,...a)};
    require('mysql2/promise').createPool=()=>{throw Error('STARTUP_MUST_NOT_CONNECT')};
    require('./server/index'); console.log('PRODUCTION_MODULE_PASS');
  `], { cwd: path.join(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production', MDM_SESSION_STORE: 'mysql',
    MDM_ACCESS_MODE: 'https-proxy', MDM_PUBLIC_ORIGIN: 'https://isolated.example.invalid', MDM_TRUST_PROXY: '127.0.0.1/32',
    ALLOW_INSECURE_SESSION_SECRET: '0' }, encoding: 'utf8' });
  assert.equal(production.status, 0, production.stderr);
  assert.match(production.stdout, /PRODUCTION_MODULE_PASS/);

  const { checkRuntimeSchema, DOMAIN_TABLES, runtimeSchemaProbes } = require('../server/mysqlRuntimeSchema');
  for (const domain of Object.keys(DOMAIN_TABLES)) {
    assert.ok(runtimeSchemaProbes(domain).length);
    await checkRuntimeSchema(mysql.createPool(), domain);
  }
  for (const code of ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ECONNREFUSED']) {
    databaseFailure = code;
    await assert.rejects(() => checkRuntimeSchema(mysql.createPool(), 'identity'), error => error.statusCode === 503 && !error.message.includes('synthetic failure'));
  }
  databaseFailure = null;
  assert.equal(endedPools, 4);
  // Exercise un-injected runtime factories, including process design's former DDL.
  for (const [file, getter] of [['todo', 'todoRepository'], ['conflict', 'conflictRepository'], ['dataMap', 'dataMapRepository'], ['mapping', 'mappingRepository'], ['terminology', 'terminologyRepository'], ['audit', 'auditRepository']]) {
    await require(`../server/${file}MysqlRepository`)[getter]();
  }
  await design.getProcessDesignRepository();

  const contextQueries = [];
  const contextRepo = require('../server/processGovernanceMysqlRepository').makeProcessGovernanceMysqlRepository({
    async execute(sql, params = []) {
      contextQueries.push({ sql, params });
      if (sql.includes('FROM process_governance_snapshots')) return [[{ id: 501 }]];
      if (sql.includes('FROM process_a1_items')) {
        assert.deepEqual(params, [501, departments[0].name]);
        assert.match(sql, /dept_name=\?/);
        return [[{ id: 601, a1_code: 'A1-TEST', dept_name: departments[0].name }]];
      }
      assert.deepEqual(params, [501], 'every context query must bind the same snapshot');
      return [[]];
    }
  });
  assert.equal((await contextRepo.getWorkbenchContext({ canViewAll: false, departmentName: departments[0].name })).a1Rows[0].id, 601);
  const queryCount = contextQueries.length;
  assert.deepEqual(await contextRepo.getWorkbenchContext({ canViewAll: false, departmentName: null }), { a1Rows: [], nodes: [], edges: [] });
  assert.equal(contextQueries.length, queryCount, 'unresolved department must not read a global snapshot');

  const app = require('../server/index');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  let csrf = '';
  let keepServing = false;
  async function request(url, method = 'GET', body) {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const result = await response.json();
    return { status: response.status, body: result };
  }
  try {
    assert.equal((await request('/api/org/departments')).status, 401);
    databaseFailure = 'ER_NO_SUCH_TABLE';
    const failedLogin = await request('/api/org/login', 'POST', { loginName: 'SYNTHETIC_81', password });
    assert.equal(failedLogin.status, 503);
    assert.match(failedLogin.body.error, /不会自动修复/);
    databaseFailure = null;
    // A second attempt after failure obtains a new pool and stays on MySQL.
    assert.equal((await request('/api/org/login', 'POST', { loginName: 'missing', password })).status, 401);
    auth.setIdentityRepositoryFactory(() => identity);
    org.setIdentityRepositoryFactory(() => identity);
    workbench.setIdentityRepositoryFactory(() => identity);
    assert.equal((await request('/api/org/login', 'POST', { loginName: 'SYNTHETIC_81', password })).status, 200);
    csrf = (await request('/api/csrf-token')).body.csrfToken;
    assert.equal((await request('/api/org/me')).body.personId, 81);
    assert.equal((await request('/api/org/departments')).body[0].id, 91);

    for (const route of ['/api/systems', '/api/capabilities', '/api/processes', '/api/views/sankey', '/api/org-units', '/api/positions', '/api/persons', '/api/product-families', '/api/products', '/api/class-nodes', '/api/attributes', '/api/external', '/api/integration', '/api/quality/dashboard']) {
      const result = await request(route);
      assert.equal(result.status, 410, route);
      assert.equal(result.body.code, 'LEGACY_SQLITE_ROUTE_ISOLATED');
    }
    for (const route of ['/api/role-workbench?mode=todo', '/api/page-workflows?tab=processGovernance', '/api/process-governance/current', '/api/process-design/drafts', '/api/todos']) {
      const result = await request(route);
      assert.equal(result.status, 200, `${route}: ${JSON.stringify(result.body)}`);
    }
    const preview = await request('/api/process-v7-preview/cases');
    assert.equal(preview.status, 503);
    assert.equal(preview.body.code, 'V7_PREVIEW_DISABLED');
    const todoSql = sqlCalls.find(call => call.sql.includes('FROM mdm_todos t') && call.params.includes(91));
    assert.ok(todoSql, 'department scope must reach the MySQL todo query');
    assert.match(todoSql.sql, /t.to_dept_id=\?/);
    assert.doesNotMatch(todoSql.sql, /to_dept_id IS NULL/, 'unassigned todos must not leak to departments');

    role = 'admin';
    const deniedTodo = await request('/api/todos', 'POST', { content: 'must not write' });
    assert.equal(deniedTodo.status, 403);
    assert.match(deniedTodo.body.error, /任务分派权限/);
    assert.equal((await request('/api/process-design/drafts', 'POST', {})).status, 403);
    role = 'department_contact';
    // Disconnect after a successful read: no alternate storage or empty result.
    databaseFailure = 'ECONNREFUSED';
    const broken = await request('/api/page-workflows?tab=processGovernance');
    assert.equal(broken.status, 503);
    assert.equal(broken.body.code, 'MYSQL_RUNTIME_UNAVAILABLE');
    databaseFailure = null;
    assert.equal((await request('/api/page-workflows?tab=processGovernance')).status, 200);
    assert.equal(sqliteAttempts, 0);
    assert.deepEqual(fs.readdirSync(temp), []);
    assert.ok(sqlCalls.every(call => /^SELECT\b/i.test(call.sql)));
    console.log(JSON.stringify({ result: 'MYSQL_RUNTIME_BOUNDARY_PASS', sqlCalls: sqlCalls.length, sqliteAttempts, failedPoolsClosed: endedPools, dependency: 'SQL spy and synthetic identity; no real MySQL' }));
    if (process.argv.includes('--serve')) {
      keepServing = true;
      console.log(`ISOLATED_BROWSER_URL=${base}`);
      return;
    }
  } finally {
    if (!keepServing) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      fs.rmdirSync(temp);
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
