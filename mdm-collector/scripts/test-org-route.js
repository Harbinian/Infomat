const assert = require('assert');
const { spawn } = require('child_process');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const PORT = 3193;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function resetData() {
  db.exec(`
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
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
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

function stopServer(server) {
  return new Promise(resolve => {
    if (server.exitCode !== null || server.killed) return resolve();
    server.once('exit', resolve);
    server.kill();
    setTimeout(resolve, 2000);
  });
}

async function main() {
  resetData();
  seedAdmin();

  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: require('path').join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();

    const protectedRes = await request('/api/org/departments');
    assert.strictEqual(protectedRes.res.status, 401);

    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin123' })
    });
    assert.strictEqual(login.res.status, 200);
    const cookie = login.res.headers.get('set-cookie').split(';')[0];
    assert.strictEqual(login.body.role, 'admin');

    const dept = await request('/api/org/departments', {
      method: 'POST',
      body: JSON.stringify({ name: '信息化部', code: 'IT' })
    }, cookie);
    assert.strictEqual(dept.res.status, 200);
    assert.ok(dept.body.id);

    const user = await request('/api/org/users', {
      method: 'POST',
      body: JSON.stringify({
        name: '张三',
        employee_no: 'U001',
        department_id: dept.body.id,
        post: '专员',
        role: 'submitter',
        password: 'pass1234'
      })
    }, cookie);
    assert.strictEqual(user.res.status, 200);
    assert.ok(user.body.id);

    const users = await request('/api/org/users', {}, cookie);
    assert.strictEqual(users.res.status, 200);
    assert.ok(users.body.some(row => row.employee_no === 'U001' && row.dept_name === '信息化部'));
    assert.ok(users.body.every(row => row.password_hash === undefined));

    const me = await request('/api/org/me', {}, cookie);
    assert.strictEqual(me.res.status, 200);
    assert.strictEqual(me.body.name, '系统管理员');

    const logout = await request('/api/org/logout', { method: 'POST' }, cookie);
    assert.strictEqual(logout.res.status, 200);

    console.log('Org route integration test passed');
  } finally {
    await stopServer(server);
    resetData();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
