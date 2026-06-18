const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { cleanupDb, legacyTestEnv, stopServer } = require('./testHelpers/isolatedDb');

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const APP_ROOT = path.join(__dirname, '..');
const PORT = 3123;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'pass1234';

function request(method, urlPath, body, cookie) {
  const url = new URL(urlPath, BASE);
  const payload = body ? JSON.stringify(body) : '';
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
  if (cookie) options.headers.Cookie = cookie;

  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch (error) { /* keep raw */ }
        resolve({ res, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(child) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    if (child.exitCode !== null) throw new Error(`测试服务提前退出: ${child.exitCode}`);
    try {
      const health = await request('GET', '/api/health');
      if (health.res.statusCode === 200) return;
    } catch {
      // keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('测试服务启动超时');
}

async function login(employeeNo) {
  const login = await request('POST', '/api/org/login', { employee_no: employeeNo, password: PASSWORD });
  assert.strictEqual(login.res.statusCode, 200, JSON.stringify(login.body));
  const cookie = login.res.headers['set-cookie'];
  assert.ok(cookie && cookie.length, '登录应返回 Cookie');
  return cookie.map(value => value.split(';')[0]).join('; ');
}

function seedAdmin() {
  const adminId = db.prepare(`
    INSERT INTO users (name, employee_no, role, password_hash)
    VALUES ('产品路由测试管理员', 'PRODADMIN', 'admin', ?)
  `).run(hashPassword(PASSWORD)).lastInsertRowid;
  const adminRole = db.prepare("SELECT role_id FROM roles WHERE role_code='admin'").get();
  db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(adminId, adminRole.role_id);
}

async function main() {
  let child;
  try {
    seedAdmin();
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: APP_ROOT,
      env: legacyTestEnv({ PORT: String(PORT), SESSION_SECRET: 'product-route-test' }),
      stdio: 'ignore'
    });
    await waitForServer(child);
    const cookie = await login('PRODADMIN');

    const emptyProducts = await request('GET', '/api/products?limit=100', null, cookie);
    assert.strictEqual(emptyProducts.res.statusCode, 200, JSON.stringify(emptyProducts.body));
    assert.deepStrictEqual(emptyProducts.body.rows, []);
    assert.strictEqual(emptyProducts.body.total, 0);
    assert.strictEqual(emptyProducts.body.page, 1);
    assert.strictEqual(emptyProducts.body.limit, 100);

    console.log('Product route test passed');
  } finally {
    await stopServer(child);
    try {
      db.close();
    } finally {
      cleanupDb();
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
