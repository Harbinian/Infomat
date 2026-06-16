const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const APP_ROOT = path.join(__dirname, '..');
const PORT = 3108;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'pass1234';

const csrfTokens = new Map();

function seedAdmin() {
  const adminId = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash, must_change_password)
    VALUES ('RBAC管理员', 'RBAC001', NULL, '系统管理员', 'admin', ?, 0)
  `).run(hashPassword(PASSWORD)).lastInsertRowid;
  const adminRole = db.prepare("SELECT role_id FROM roles WHERE role_code='admin'").get();
  assert.ok(adminRole, 'admin role should exist');
  db.prepare('INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)').run(adminId, adminRole.role_id, adminId);
}

function rawRequest(method, urlPath, body, cookie, extraHeaders = {}) {
  const url = new URL(urlPath, BASE);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  };
  if (cookie) options.headers.Cookie = cookie;

  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function csrfTokenFor(cookie) {
  if (csrfTokens.has(cookie)) return csrfTokens.get(cookie);
  const res = await rawRequest('GET', '/api/csrf-token', null, cookie);
  const token = res.status === 200 && res.body ? res.body.csrfToken : '';
  if (token) csrfTokens.set(cookie, token);
  return token;
}

async function request(method, urlPath, body, cookie) {
  const headers = {};
  if (cookie && !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase()) && urlPath !== '/api/org/login') {
    const token = await csrfTokenFor(cookie);
    if (token) headers['X-CSRF-Token'] = token;
  }
  return rawRequest(method, urlPath, body, cookie, headers);
}

async function waitForServer(child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`测试服务提前退出: ${child.exitCode}`);
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) return;
    } catch {
      // keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('测试服务启动超时');
}

async function login() {
  const res = await request('POST', '/api/org/login', { employee_no: 'RBAC001', password: PASSWORD });
  assert.strictEqual(res.status, 200, `登录失败: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'];
  assert.ok(cookie && cookie.length > 0, 'login should return a session cookie');
  return cookie.map(value => value.split(';')[0]).join('; ');
}

async function main() {
  let server;
  try {
    seedAdmin();
    server = spawn(process.execPath, ['server/index.js'], {
      cwd: APP_ROOT,
      env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'test-secret' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForServer(server);
    const cookie = await login();

    const listRes = await request('GET', '/api/roles', null, cookie);
    assert.ok(Array.isArray(listRes.body) && listRes.body.length >= 4, 'GET /api/roles returns array');

    const createRes = await request('POST', '/api/roles', {
      role_code: 'smoke_test',
      role_name: '冒烟测试角色',
      description: 'test'
    }, cookie);
    assert.ok(createRes.status === 201 && createRes.body.role_id, 'POST /api/roles creates role');
    const newRoleId = createRes.body.role_id;

    const detailRes = await request('GET', `/api/roles/${newRoleId}`, null, cookie);
    assert.ok(detailRes.status === 200 && detailRes.body.role_code === 'smoke_test', 'GET /api/roles/:id returns detail');

    const updateRes = await request('PUT', `/api/roles/${newRoleId}`, { role_name: '冒烟测试角色改名' }, cookie);
    assert.ok(updateRes.body.success, 'PUT /api/roles/:id updates role');

    const permsRes = await request('GET', '/api/org/permissions', null, cookie);
    assert.ok(permsRes.status === 200 && typeof permsRes.body === 'object', 'GET /api/org/permissions returns grouped perms');

    const matrixRes = await request('GET', `/api/roles/${newRoleId}/permissions`, null, cookie);
    assert.ok(matrixRes.status === 200 && Array.isArray(matrixRes.body.matrix), 'GET /api/roles/:id/permissions returns matrix');

    const somePermIds = matrixRes.body.matrix.slice(0, 3).map(permission => permission.perm_id);
    const assignRes = await request('PUT', `/api/roles/${newRoleId}/permissions`, { perm_ids: somePermIds }, cookie);
    assert.ok(assignRes.body.success && assignRes.body.count === somePermIds.length, 'PUT /api/roles/:id/permissions assigns perms');

    const matrixRes2 = await request('GET', `/api/roles/${newRoleId}/permissions`, null, cookie);
    const assignedCount = matrixRes2.body.matrix.filter(permission => permission.assigned).length;
    assert.strictEqual(assignedCount, somePermIds.length, 'Role has correct perm count after assignment');

    const usersList = await request('GET', '/api/org/users', null, cookie);
    const adminUserId = usersList.body[0] && usersList.body[0].id;
    assert.ok(adminUserId, 'admin user should be visible');
    const userRolesRes = await request('GET', `/api/org/users/${adminUserId}/roles`, null, cookie);
    assert.ok(Array.isArray(userRolesRes.body), 'GET /api/org/users/:id/roles returns array');

    const pwStatusRes = await request('GET', '/api/org/me/password-status', null, cookie);
    assert.strictEqual(typeof pwStatusRes.body.is_default_password, 'boolean', 'GET /api/org/me/password-status returns boolean');

    const delRes = await request('DELETE', `/api/roles/${newRoleId}`, null, cookie);
    assert.ok(delRes.body.success, 'DELETE /api/roles/:id deletes role');

    const adminRole = listRes.body.find(role => role.is_system);
    assert.ok(adminRole, 'system role should exist');
    const delSysRes = await request('DELETE', `/api/roles/${adminRole.role_id}`, null, cookie);
    assert.strictEqual(delSysRes.status, 403, 'DELETE system role returns 403');

    const noAuthRes = await request('GET', '/api/roles', null, null);
    assert.strictEqual(noAuthRes.status, 401, 'Unauthenticated GET /api/roles returns 401');

    console.log('RBAC smoke test passed');
  } finally {
    await stopServer(server);
    try {
      db.close();
    } finally {
      cleanupDb();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
