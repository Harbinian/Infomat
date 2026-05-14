const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const PORT = 3196;
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

function seedData() {
  const admin = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, NULL, ?, ?, ?)
  `).run('系统管理员', 'ADMIN001', '系统管理员', 'admin', hashPassword('admin123')).lastInsertRowid;

  const deptA = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('财务部', 'FIN').lastInsertRowid;
  const deptB = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('供应链部', 'SCM').lastInsertRowid;

  const systemA = db.prepare('INSERT INTO systems (name, dept_id) VALUES (?, ?)').run('共享平台', deptA).lastInsertRowid;
  const systemB = db.prepare('INSERT INTO systems (name, dept_id) VALUES (?, ?)').run('共享平台', deptB).lastInsertRowid;

  const capRoot = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status, created_by, parent_id)
    VALUES (?, 'L1', ?, 'approved', ?, NULL)
  `).run('经营管理', deptA, admin).lastInsertRowid;
  const capChild = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status, created_by, parent_id)
    VALUES (?, 'L2', ?, 'approved', ?, ?)
  `).run('财务管理', deptA, admin, capRoot).lastInsertRowid;
  const capOther = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status, created_by, parent_id)
    VALUES (?, 'L3', ?, 'approved', ?, NULL)
  `).run('供应管理', deptB, admin).lastInsertRowid;

  const procA = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status, created_by)
    VALUES (?, ?, ?, 'approved', ?)
  `).run('共享流程', capChild, deptA, admin).lastInsertRowid;
  const procB = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status, created_by)
    VALUES (?, ?, ?, 'approved', ?)
  `).run('共享流程', capOther, deptB, admin).lastInsertRowid;

  const mapA = db.prepare(`
    INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step)
    VALUES (?, ?, 'published', ?, 5)
  `).run(procA, deptA, admin).lastInsertRowid;
  const mapB = db.prepare(`
    INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step)
    VALUES (?, ?, 'published', ?, 5)
  `).run(procB, deptB, admin).lastInsertRowid;

  db.prepare('INSERT INTO mapping_systems (mapping_id, system_id, system_role, sort_order) VALUES (?, ?, ?, ?)').run(mapA, systemA, 'primary', 1);
  db.prepare('INSERT INTO mapping_systems (mapping_id, system_id, system_role, sort_order) VALUES (?, ?, ?, ?)').run(mapB, systemB, 'primary', 1);

  return { deptA, capChild, procA, systemA };
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
    ...(cookie ? { Cookie: cookie } : {})
  };
  const res = await fetch(`${BASE_URL}${routePath}`, { ...options, headers });
  const body = await res.json();
  return { res, body };
}

function stopServer(server) {
  return new Promise(resolve => {
    if (server.exitCode !== null || server.killed) return resolve();
    server.once('exit', resolve);
    server.kill();
    setTimeout(() => {
      if (server.exitCode === null && !server.killed) server.kill('SIGKILL');
      resolve();
    }, 2000);
  });
}

function assertLinksReferenceExistingNodes(view) {
  const nodeKeys = new Set(view.nodes.map(node => node.name));
  for (const link of view.links) {
    assert.ok(nodeKeys.has(link.source), `link source ${link.source} missing from nodes`);
    assert.ok(nodeKeys.has(link.target), `link target ${link.target} missing from nodes`);
  }
}

async function main() {
  resetData();
  const seeded = seedData();

  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'views-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();

    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin123' })
    });
    assert.strictEqual(login.res.status, 200);
    const cookie = login.res.headers.get('set-cookie').split(';')[0];

    const deptFiltered = await request(`/api/views/sankey?dept_ids=${seeded.deptA}`, {}, cookie);
    assert.strictEqual(deptFiltered.res.status, 200);
    assertLinksReferenceExistingNodes(deptFiltered.body);
    assert.deepStrictEqual(
      deptFiltered.body.nodes.map(node => node.name).sort(),
      [
        `capability:${seeded.capChild}`,
        `department:${seeded.deptA}`,
        `process:${seeded.procA}`,
        `system:${seeded.systemA}`
      ].sort()
    );

    const levelFiltered = await request('/api/views/sankey?cap_levels=L1', {}, cookie);
    assert.strictEqual(levelFiltered.res.status, 200);
    assertLinksReferenceExistingNodes(levelFiltered.body);
    assert.ok(levelFiltered.body.nodes.some(node => node.name === `capability:${seeded.capChild}`));
    assert.ok(!levelFiltered.body.nodes.some(node => node.label === '供应管理'));

    assert.ok(deptFiltered.body.nodes.every(node => node.label), 'nodes should expose display labels separately from stable keys');
    console.log('Views sankey filter regression test passed');
  } finally {
    await stopServer(server);
    resetData();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
