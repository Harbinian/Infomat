const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const PORT = 3194;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function resetData() {
  db.exec(`
    UPDATE departments SET manager_user_id=NULL, created_by=NULL, updated_by=NULL, data_owner_user_id=NULL;
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
    DELETE FROM terms;
    DELETE FROM user_dept_roles;
    DELETE FROM users;
    DELETE FROM departments;
  `);
}

function seedAdmin() {
  db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, NULL, ?, ?, ?)').run(
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

async function request(routePath, options = {}, cookie = '') {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(`${BASE_URL}${routePath}`, { ...options, headers });
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
    setTimeout(() => {
      if (server.exitCode === null && !server.killed) {
        server.kill('SIGKILL');
      }
      resolve();
    }, 2000);
  });
}

async function main() {
  resetData();
  seedAdmin();

  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();

    const protectedSystems = await request('/api/systems');
    assert.strictEqual(protectedSystems.res.status, 401);

    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin123' })
    });
    assert.strictEqual(login.res.status, 200);
    const cookie = login.res.headers.get('set-cookie').split(';')[0];

    const dept = await request('/api/org/departments', {
      method: 'POST',
      body: JSON.stringify({ name: '信息化部', code: 'IT' })
    }, cookie);
    assert.strictEqual(dept.res.status, 200);

    const system = await request('/api/systems', {
      method: 'POST',
      body: JSON.stringify({ name: 'ERP', dept_id: dept.body.id })
    }, cookie);
    assert.strictEqual(system.res.status, 200);
    assert.ok(system.body.id);

    const updateSystem = await request(`/api/systems/${system.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'ERP核心', dept_id: dept.body.id })
    }, cookie);
    assert.strictEqual(updateSystem.res.status, 200);

    const systems = await request('/api/systems', {}, cookie);
    assert.strictEqual(systems.res.status, 200);
    assert.ok(systems.body.some(row => row.name === 'ERP核心' && row.dept_id === dept.body.id));

    const capability = await request('/api/capabilities', {
      method: 'POST',
      body: JSON.stringify({ name: '主数据治理', level: 'L1', owner_dept_id: dept.body.id })
    }, cookie);
    assert.strictEqual(capability.res.status, 200);
    assert.ok(capability.body.id);

    const updateCapability = await request(`/api/capabilities/${capability.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: '主数据管理', level: 'L2', owner_dept_id: dept.body.id })
    }, cookie);
    assert.strictEqual(updateCapability.res.status, 200);

    const capabilities = await request('/api/capabilities', {}, cookie);
    assert.strictEqual(capabilities.res.status, 200);
    assert.ok(capabilities.body.some(row => row.name === '主数据管理' && row.dept_name === '信息化部'));

    const processResult = await request('/api/processes', {
      method: 'POST',
      body: JSON.stringify({ name: '物料主数据维护', capability_id: capability.body.id, owner_dept_id: dept.body.id })
    }, cookie);
    assert.strictEqual(processResult.res.status, 200);
    assert.ok(processResult.body.id);

    const updateProcess = await request(`/api/processes/${processResult.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: '客户主数据维护', capability_id: capability.body.id, owner_dept_id: dept.body.id })
    }, cookie);
    assert.strictEqual(updateProcess.res.status, 200);

    const processes = await request(`/api/processes?capability_id=${capability.body.id}&owner_dept_id=${dept.body.id}`, {}, cookie);
    assert.strictEqual(processes.res.status, 200);
    assert.strictEqual(processes.body.length, 1);
    assert.strictEqual(processes.body[0].name, '客户主数据维护');
    assert.strictEqual(processes.body[0].cap_name, '主数据管理');
    assert.strictEqual(processes.body[0].dept_name, '信息化部');

    const deleteSystem = await request(`/api/systems/${system.body.id}`, { method: 'DELETE' }, cookie);
    assert.strictEqual(deleteSystem.res.status, 200);

    console.log('Catalog route integration test passed');
  } finally {
    await stopServer(server);
    resetData();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
