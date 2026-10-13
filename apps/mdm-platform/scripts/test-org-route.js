const assert = require('assert');
const { spawn } = require('child_process');
const { cleanupDb, legacyTestEnv, stopServer } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const PORT = 3193;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function resetData() {
  db.exec(`
    UPDATE departments SET manager_user_id=NULL, created_by=NULL, updated_by=NULL, data_owner_user_id=NULL, person_id=NULL;
    DELETE FROM version_log;
    DELETE FROM conflict_coordination_history;
    DELETE FROM conflict_assignments;
    DELETE FROM change_set;
    DELETE FROM field_rejection_reasons;
    DELETE FROM todos;
    DELETE FROM approval_history;
    DELETE FROM approval_tasks;
    DELETE FROM field_conflicts;
    DELETE FROM term_conflicts;
    DELETE FROM field_identities;
    DELETE FROM field_entries;
    DELETE FROM mapping_related_departments;
    DELETE FROM mapping_systems;
    DELETE FROM mappings;
    DELETE FROM processes;
    DELETE FROM capabilities;
    DELETE FROM systems;
    DELETE FROM user_dept_roles;
    DELETE FROM external_identity;
    DELETE FROM external_system;
    DELETE FROM attribute_value;
    DELETE FROM attribute_def;
    DELETE FROM entity_class_membership;
    DELETE FROM class_node;
    DELETE FROM product;
    DELETE FROM product_family;
    DELETE FROM person_position_assignment;
    DELETE FROM person;
    DELETE FROM position;
    DELETE FROM org_unit;
    DELETE FROM integration_sync_log;
    DELETE FROM integration_credentials;
    DELETE FROM user_roles;
    DELETE FROM code_sequences;
    DELETE FROM users;
    DELETE FROM departments;
  `);
}

function seedAdmin() {
  db.prepare("INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, NULL, ?, ?, ?)").run(
    '系统管理员',
    'ADMIN001',
    '系统管理员',
    'admin',
    hashPassword('admin123')
  );
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  throw new Error('server did not start');
}

async function request(path, options = {}, cookie = '') {
  const requestOptions = { ...options };
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const headers = {
    ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(requestOptions.headers || {})
  };
  if (cookie && !['GET', 'HEAD', 'OPTIONS'].includes(method) && path !== '/api/org/login') {
    const token = await csrfTokenFor(cookie);
    if (token) headers['X-CSRF-Token'] = token;
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...requestOptions, headers });
  const text = await res.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = { raw: text };
    }
  }
  return { res, body };
}

const csrfTokens = new Map();

async function csrfTokenFor(cookie) {
  if (csrfTokens.has(cookie)) return csrfTokens.get(cookie);
  const result = await request('/api/csrf-token', {}, cookie);
  if (result.res.status !== 200 || !result.body.csrfToken) return '';
  csrfTokens.set(cookie, result.body.csrfToken);
  return result.body.csrfToken;
}

async function main() {
  let server;

  try {
    resetData();
    seedAdmin();

    server = spawn(process.execPath, ['server/index.js'], {
      cwd: require('path').join(__dirname, '..'),
      env: legacyTestEnv({ PORT: String(PORT), SESSION_SECRET: 'test-secret' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    await waitForServer();

    const anonymousSession = await request('/api/org/session');
    assert.strictEqual(anonymousSession.res.status, 200);
    assert.deepStrictEqual(anonymousSession.body, { authenticated: false });

    const anonymousMe = await request('/api/org/me');
    assert.strictEqual(anonymousMe.res.status, 401);

    const protectedRes = await request('/api/org/departments');
    assert.strictEqual(protectedRes.res.status, 401);

    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin123' })
    });
    assert.strictEqual(login.res.status, 200);
    const cookie = login.res.headers.get('set-cookie').split(';')[0];
    assert.strictEqual(login.body.role, 'admin');

    // `/api/org-units` is retired. The route family is not registered any more, so the boundary
    // is a plain 404, not the pre-retirement 403 refusal that quoted the authoritative-source
    // rule. Same expectation as test-mysql-runtime-boundary.js and test-security-routes.js; the
    // retired route is not resurrected just to keep this assertion green.
    const manualOrgUnit = await request('/api/org-units', {
      method: 'POST',
      body: JSON.stringify({
        org_unit_name: '手工新增组织',
        org_type: 'department',
        org_mnemonic: 'MANUAL'
      })
    }, cookie);
    assert.strictEqual(manualOrgUnit.res.status, 404);
    assert.match(String(manualOrgUnit.res.headers.get('content-type') || ''), /^text\/html/);
    assert.ok(String(manualOrgUnit.body.raw || '').includes('Cannot POST /api/org-units'));

    // The legacy write surface this script used to exercise is retired by policy, not by accident:
    // departments and the organization tree come from the authoritative source (405
    // ORGANIZATION_TRUTH_READ_ONLY), and account writes moved to /api/org/accounts (410
    // LEGACY_IDENTITY_API_RETIRED). Both refusals hold in every read model, so the retired
    // create-department / create-user flow is asserted as refusals instead of being deleted.
    const dept = await request('/api/org/departments', {
      method: 'POST',
      body: JSON.stringify({ name: '信息化部', code: 'IT' })
    }, cookie);
    assert.strictEqual(dept.res.status, 405);
    assert.strictEqual(dept.body.code, 'ORGANIZATION_TRUTH_READ_ONLY');

    const updateDept = await request('/api/org/departments/1', {
      method: 'PUT',
      body: JSON.stringify({ name: '信息化部' })
    }, cookie);
    assert.strictEqual(updateDept.res.status, 405);
    assert.strictEqual(updateDept.body.code, 'ORGANIZATION_TRUTH_READ_ONLY');

    const deleteDept = await request('/api/org/departments/1', { method: 'DELETE' }, cookie);
    assert.strictEqual(deleteDept.res.status, 405);
    assert.strictEqual(deleteDept.body.code, 'ORGANIZATION_TRUTH_READ_ONLY');

    for (const [method, path] of [
      ['POST', '/api/org/users'],
      ['PUT', '/api/org/users/1'],
      ['POST', '/api/org/users/1/password'],
      ['PUT', '/api/org/users/1/roles']
    ]) {
      const retired = await request(path, { method, body: JSON.stringify({}) }, cookie);
      assert.strictEqual(retired.res.status, 410, `${method} ${path}`);
      assert.strictEqual(retired.body.code, 'LEGACY_IDENTITY_API_RETIRED', `${method} ${path}`);
    }

    const roles = await request('/api/roles', {}, cookie);
    assert.strictEqual(roles.res.status, 200);
    const roleIdByCode = new Map(roles.body.map(row => [row.role_code, row.role_id]));
    assert.ok(roleIdByCode.has('owner'), 'owner role should exist');
    assert.ok(roleIdByCode.has('reviewer'), 'reviewer role should exist');
    assert.ok(roleIdByCode.has('workgroup_lead'), 'workgroup_lead project role should exist');
    assert.ok(roleIdByCode.has('business_contact'), 'business_contact project role should exist');
    assert.ok(roleIdByCode.has('data_quality'), 'data_quality project role should exist');

    const departments = await request('/api/org/departments', {}, cookie);
    assert.strictEqual(departments.res.status, 200);
    assert.ok(Array.isArray(departments.body));

    const users = await request('/api/org/users', {}, cookie);
    assert.strictEqual(users.res.status, 200);
    assert.ok(Array.isArray(users.body));
    assert.ok(users.body.every(row => row.password_hash === undefined));

    const summary = await request('/api/org/users/roles-summary', {}, cookie);
    assert.strictEqual(summary.res.status, 200);
    assert.ok(Array.isArray(summary.body));

    const me = await request('/api/org/me', {}, cookie);
    assert.strictEqual(me.res.status, 200);
    assert.strictEqual(me.body.name, '系统管理员');

    const logout = await request('/api/org/logout', { method: 'POST' }, cookie);
    assert.strictEqual(logout.res.status, 200);

    console.log('Org route integration test passed');
  } finally {
    await stopServer(server);
    try {
      resetData();
    } finally {
      try {
        db.close();
      } finally {
        cleanupDb();
      }
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
