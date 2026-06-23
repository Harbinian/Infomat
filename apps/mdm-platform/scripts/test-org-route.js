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

    const manualOrgUnit = await request('/api/org-units', {
      method: 'POST',
      body: JSON.stringify({
        org_unit_name: '手工新增组织',
        org_type: 'department',
        org_mnemonic: 'MANUAL'
      })
    }, cookie);
    assert.strictEqual(manualOrgUnit.res.status, 403);
    assert.ok(String(manualOrgUnit.body.error || '').includes('组织架构真源'));

    const dept = await request('/api/org/departments', {
      method: 'POST',
      body: JSON.stringify({ name: '信息化部', code: 'IT' })
    }, cookie);
    assert.strictEqual(dept.res.status, 200);
    assert.ok(dept.body.id);

    const duplicateDept = await request('/api/org/departments', {
      method: 'POST',
      body: JSON.stringify({ name: '重复信息化部', code: 'IT' })
    }, cookie);
    assert.strictEqual(duplicateDept.res.status, 409);
    assert.strictEqual(duplicateDept.body.error, '编码或工号已存在');

    const user = await request('/api/org/users', {
      method: 'POST',
      body: JSON.stringify({
        name: '张三',
        employee_no: 'U001',
        department_id: dept.body.id,
        post: '专员',
        role: 'submitter'
      })
    }, cookie);
    assert.strictEqual(user.res.status, 200);
    assert.ok(user.body.id);
    assert.ok(user.body.initial_password);
    assert.notStrictEqual(user.body.initial_password, '000000');
    assert.notStrictEqual(user.body.initial_password, 'init1234');

    const roles = await request('/api/roles', {}, cookie);
    assert.strictEqual(roles.res.status, 200);
    const roleIdByCode = new Map(roles.body.map(row => [row.role_code, row.role_id]));
    assert.ok(roleIdByCode.has('owner'), 'owner role should exist');
    assert.ok(roleIdByCode.has('reviewer'), 'reviewer role should exist');
    assert.ok(roleIdByCode.has('workgroup_lead'), 'workgroup_lead project role should exist');
    assert.ok(roleIdByCode.has('business_contact'), 'business_contact project role should exist');
    assert.ok(roleIdByCode.has('data_quality'), 'data_quality project role should exist');

    const intakeUser = await request('/api/org/users', {
      method: 'POST',
      body: JSON.stringify({
        name: '李四',
        employee_no: 'U002',
        department_id: dept.body.id,
        post: '业务对接人',
        role: 'owner',
        role_ids: [roleIdByCode.get('owner'), roleIdByCode.get('business_contact')]
      })
    }, cookie);
    assert.strictEqual(intakeUser.res.status, 200);
    assert.ok(intakeUser.body.id);

    const intakeRoles = await request(`/api/org/users/${intakeUser.body.id}/roles`, {}, cookie);
    assert.strictEqual(intakeRoles.res.status, 200);
    assert.deepStrictEqual(
      intakeRoles.body.map(row => row.role_code).sort(),
      ['business_contact', 'owner'].sort()
    );

    const duplicateUser = await request('/api/org/users', {
      method: 'POST',
      body: JSON.stringify({
        name: '重复李四',
        employee_no: 'U002',
        department_id: dept.body.id,
        post: '重复',
        role: 'submitter'
      })
    }, cookie);
    assert.strictEqual(duplicateUser.res.status, 409);
    assert.strictEqual(duplicateUser.body.error, '编码或工号已存在');

    const projectOnlyRoles = await request(`/api/org/users/${intakeUser.body.id}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ role_ids: [roleIdByCode.get('business_contact')] })
    }, cookie);
    assert.strictEqual(projectOnlyRoles.res.status, 200);

    const projectOnlyUser = db.prepare('SELECT role FROM users WHERE id=?').get(intakeUser.body.id);
    assert.strictEqual(projectOnlyUser.role, 'owner');

    const updateIntakeUser = await request(`/api/org/users/${intakeUser.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: '李四改',
        department_id: dept.body.id,
        post: '数据质量员',
        role: 'reviewer',
        role_ids: [roleIdByCode.get('reviewer'), roleIdByCode.get('data_quality')]
      })
    }, cookie);
    assert.strictEqual(updateIntakeUser.res.status, 200);

    const updatedRoles = await request(`/api/org/users/${intakeUser.body.id}/roles`, {}, cookie);
    assert.strictEqual(updatedRoles.res.status, 200);
    assert.deepStrictEqual(
      updatedRoles.body.map(row => row.role_code).sort(),
      ['data_quality', 'reviewer'].sort()
    );

    const updateDeptManager = await request(`/api/org/departments/${dept.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: '信息化部', code: 'IT', manager_user_id: user.body.id })
    }, cookie);
    assert.strictEqual(updateDeptManager.res.status, 200);

    const users = await request('/api/org/users', {}, cookie);
    assert.strictEqual(users.res.status, 200);
    assert.ok(users.body.some(row => row.employee_no === 'U001' && row.dept_name === '信息化部'));
    assert.ok(users.body.some(row => row.employee_no === 'U002' && row.role === 'reviewer'));
    assert.ok(users.body.every(row => row.password_hash === undefined));

    const summary = await request('/api/org/users/roles-summary', {}, cookie);
    assert.strictEqual(summary.res.status, 200);
    const intakeSummary = summary.body.find(row => row.employee_no === 'U002');
    assert.ok(intakeSummary);
    assert.strictEqual(intakeSummary.role, 'reviewer');
    assert.ok(String(intakeSummary.rbac_role_codes || '').includes('data_quality'));
    assert.ok(String(intakeSummary.rbac_role_names || '').includes('数据质量员'));

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
