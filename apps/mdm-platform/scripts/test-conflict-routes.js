const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { cleanupDb } = require('./testHelpers/isolatedDb');
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
  const deptA = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('销售部', 'SALES').lastInsertRowid;
  const deptB = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('财务部', 'FIN').lastInsertRowid;
  const admin = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '系统管理员',
    'ADMIN001',
    deptA,
    '系统管理员',
    'admin',
    hashPassword('admin123')
  ).lastInsertRowid;
  const userA = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '销售报送人',
    'SALE001',
    deptA,
    '专员',
    'submitter',
    hashPassword('pass1234')
  ).lastInsertRowid;
  const userB = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '财务报送人',
    'FIN001',
    deptB,
    '专员',
    'submitter',
    hashPassword('pass1234')
  ).lastInsertRowid;

  // Department owners for auto-assignment
  const ownerA = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '销售数据Owner', 'SALEOW01', deptA, '数据Owner', 'owner', hashPassword('pass1234')
  ).lastInsertRowid;
  const ownerB = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '财务数据Owner', 'FINOW01', deptB, '数据Owner', 'owner', hashPassword('pass1234')
  ).lastInsertRowid;

  // Set data_owner for departments
  db.prepare('UPDATE departments SET data_owner_user_id = ? WHERE id = ?').run(ownerA, deptA);
  db.prepare('UPDATE departments SET data_owner_user_id = ? WHERE id = ?').run(ownerB, deptB);

  // Reviewer user
  const reviewer = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '审核人', 'REV001', deptA, '质量审核', 'reviewer', hashPassword('pass1234')
  ).lastInsertRowid;

  const capability = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id) VALUES (?, ?, ?)').run('主数据管理', 'L1', deptA).lastInsertRowid;
  const processA = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id) VALUES (?, ?, ?)').run('客户主数据维护', capability, deptA).lastInsertRowid;
  const processB = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id) VALUES (?, ?, ?)').run('客户主数据复核', capability, deptB).lastInsertRowid;
  const mappingA = db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'submitted', ?, 3)").run(processA, deptA, userA).lastInsertRowid;
  const mappingB = db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'submitted', ?, 3)").run(processB, deptB, userB).lastInsertRowid;
  const fieldA = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by)
    VALUES (?, '客户编码', 'customer_code', '客户', '文本', ?, '实时', '销售系统定义', ?)
  `).run(mappingA, JSON.stringify(['CRM']), userA).lastInsertRowid;
  const fieldB = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by)
    VALUES (?, '客户编码', 'customer_code', '客户', '文本', ?, '实时', '财务系统定义', ?)
  `).run(mappingB, JSON.stringify(['ERP']), userB).lastInsertRowid;

  db.prepare('INSERT INTO field_identities (field_entry_id, authoritative_system, maintain_dept_id, confirmed) VALUES (?, ?, ?, 1)').run(fieldA, 'CRM', deptA);
  db.prepare('INSERT INTO field_identities (field_entry_id, authoritative_system, maintain_dept_id, confirmed) VALUES (?, ?, ?, 1)').run(fieldB, 'ERP', deptB);
  db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, assigned_dept_id, status) VALUES (?, 3, '跨部门确认', ?, ?, 'blocked')").run(mappingA, admin, deptB);

  const sameValueFieldA = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by)
    VALUES (?, '客户名称', 'customer_name', '客户', '文本', ?, '实时', '相同定义', ?)
  `).run(mappingA, JSON.stringify(['CRM']), userA).lastInsertRowid;
  const sameValueFieldB = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by)
    VALUES (?, '客户名称', 'customer_name', '客户', '文本', ?, '实时', '相同定义', ?)
  `).run(mappingB, JSON.stringify(['CRM']), userB).lastInsertRowid;
  db.prepare('INSERT INTO field_identities (field_entry_id, authoritative_system, maintain_dept_id, confirmed) VALUES (?, ?, ?, 1)').run(sameValueFieldA, 'CRM', deptA);
  db.prepare('INSERT INTO field_identities (field_entry_id, authoritative_system, maintain_dept_id, confirmed) VALUES (?, ?, ?, 1)').run(sameValueFieldB, 'CRM', deptB);

  const termConflict = db.prepare(`
    INSERT INTO term_conflicts (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity, status)
    VALUES ('客户', ?, '销售客户', ?, '开票客户', 'warn', 'silenced')
  `).run(deptA, deptB).lastInsertRowid;

  return { deptA, deptB, admin, userA, userB, ownerA, ownerB, reviewer, mappingA, mappingB, fieldA, fieldB, termConflict };
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
  const seed = seedData();

  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();

    const protectedTodos = await request('/api/todos');
    assert.strictEqual(protectedTodos.res.status, 401);

    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin123' })
    });
    assert.strictEqual(login.res.status, 200);
    const cookie = login.res.headers.get('set-cookie').split(';')[0];

    const todo = await request('/api/todos', {
      method: 'POST',
      body: JSON.stringify({
        from_dept_id: seed.deptA,
        to_dept_id: seed.deptB,
        type: 'field_confirm',
        related_mapping_id: seed.mappingA,
        related_field_id: seed.fieldA,
        content: '请确认客户编码黄金源',
        due_date: '2026-06-01'
      })
    }, cookie);
    assert.strictEqual(todo.res.status, 200);
    assert.ok(todo.body.id);

    const todos = await request(`/api/todos?dept_id=${seed.deptB}&status=pending&type=field_confirm`, {}, cookie);
    assert.strictEqual(todos.res.status, 200);
    assert.strictEqual(todos.body.length, 1);
    assert.strictEqual(todos.body[0].from_dept_name, '销售部');
    assert.strictEqual(todos.body[0].to_dept_name, '财务部');

    const done = await request(`/api/todos/${todo.body.id}/done`, { method: 'POST' }, cookie);
    assert.strictEqual(done.res.status, 200);
    const doneTodos = await request(`/api/todos?dept_id=${seed.deptB}&status=done`, {}, cookie);
    assert.strictEqual(doneTodos.body.length, 1);
    assert.ok(doneTodos.body[0].done_at);

    const detectSame = await request('/api/conflicts/detect?field_name_cn=%E5%AE%A2%E6%88%B7%E5%90%8D%E7%A7%B0', { method: 'POST' }, cookie);
    assert.strictEqual(detectSame.res.status, 200);
    let fieldConflicts = await request('/api/conflicts?type=field', {}, cookie);
    assert.strictEqual(fieldConflicts.body.length, 0);

    // Verify warn-level conflicts (note difference on same field) are silenced
    const warnFieldA = db.prepare(`
      INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by)
      VALUES (?, '客户等级', 'customer_level', '客户', '文本', ?, '实时', '销售备注A', ?)
    `).run(seed.mappingA, JSON.stringify(['CRM']), seed.userA).lastInsertRowid;
    const warnFieldB = db.prepare(`
      INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by)
      VALUES (?, '客户等级', 'customer_level', '客户', '文本', ?, '实时', '销售备注B', ?)
    `).run(seed.mappingB, JSON.stringify(['CRM']), seed.userB).lastInsertRowid;

    const detectWarn = await request('/api/conflicts/detect?field_name_cn=%E5%AE%A2%E6%88%B7%E7%AD%89%E7%BA%A7', { method: 'POST' }, cookie);
    assert.strictEqual(detectWarn.res.status, 200);

    // warn should be auto-silenced; admin sees everything, but status should be 'silenced'
    const allConflicts2 = await request('/api/conflicts', {}, cookie);
    const warnConflicts = allConflicts2.body.filter(function(c) { return c.conflict_field === 'note'; });
    assert.ok(warnConflicts.length > 0, 'warn conflict should exist');
    assert.strictEqual(warnConflicts[0].status, 'silenced', 'warn conflict should be auto-silenced');
    assert.strictEqual(warnConflicts[0].severity, 'warn', 'should be warn severity');

    // Also visible when explicitly filtering by status=silenced
    const silencedConflicts = await request('/api/conflicts?status=silenced', {}, cookie);
    const silencedWarn = silencedConflicts.body.filter(function(c) { return c.conflict_field === 'note'; });
    assert.ok(silencedWarn.length > 0, 'warn conflicts should appear with status=silenced filter');

    const detect = await request('/api/conflicts/detect?field_name_cn=%E5%AE%A2%E6%88%B7%E7%BC%96%E7%A0%81', { method: 'POST' }, cookie);
    assert.strictEqual(detect.res.status, 200);
    assert.strictEqual(detect.body.detected, 1);

    fieldConflicts = await request('/api/conflicts?type=field&severity=error&status=coordinating', {}, cookie);
    assert.strictEqual(fieldConflicts.res.status, 200);
    assert.strictEqual(fieldConflicts.body.length, 1);
    assert.strictEqual(fieldConflicts.body[0].conflict_field, 'authoritative_system');
    assert.strictEqual(fieldConflicts.body[0].value_a, 'CRM');
    assert.strictEqual(fieldConflicts.body[0].value_b, 'ERP');

    // Verify auto dual-assign
    const errorConflict = fieldConflicts.body[0];
    assert.strictEqual(errorConflict.status, 'coordinating', 'error conflict should be coordinating');
    assert.ok(errorConflict.deadline, 'should have a deadline set');

    const assignments = db.prepare('SELECT * FROM conflict_assignments WHERE conflict_id = ? AND conflict_type = ?').all(errorConflict.id, 'field');
    assert.strictEqual(assignments.length, 2, 'should have 2 auto-assignments (one per dept)');
    assert.ok(assignments.some(function(a) { return a.assigned_by === null; }), 'should be system-assigned');

    const assignedTodos = db.prepare("SELECT * FROM todos WHERE type = 'conflict_resolution' AND content LIKE '%冲突协调%'").all();
    assert.strictEqual(assignedTodos.length, 2, 'should create 2 todos');

    // Test manual escalate - login as reviewer (errorConflict is still coordinating)
    const revLogin = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'REV001', password: 'pass1234' })
    });
    assert.strictEqual(revLogin.res.status, 200);
    const revCookie = revLogin.res.headers.get('set-cookie').split(';')[0];

    const escRes = await request('/api/conflicts/' + errorConflict.id + '/escalate?type=field', { method: 'POST' }, revCookie);
    const escConflict = db.prepare('SELECT * FROM field_conflicts WHERE id = ?').get(errorConflict.id);
    assert.strictEqual(escConflict.status, 'escalated');
    assert.strictEqual(escConflict.escalated, 1);

    // Test stats endpoint
    const stats = await request('/api/conflicts/stats', {}, cookie);
    assert.strictEqual(stats.res.status, 200);
    assert.ok(typeof stats.body.coordinating === 'number');
    assert.ok(typeof stats.body.silenced === 'number');
    assert.ok(typeof stats.body.escalated === 'number');
    assert.ok(typeof stats.body.resolvedThisMonth === 'number');

    const resolve = await request(`/api/conflicts/${fieldConflicts.body[0].id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution: '采用MDM统一口径', adopted_value: 'MDM' })
    }, cookie);
    assert.strictEqual(resolve.res.status, 200);

    const identities = db.prepare('SELECT authoritative_system, confirmed_by FROM field_identities WHERE field_entry_id IN (?, ?) ORDER BY field_entry_id').all(seed.fieldA, seed.fieldB);
    assert.deepStrictEqual(identities.map(row => row.authoritative_system), ['MDM', 'MDM']);
    assert.ok(identities.every(row => row.confirmed_by === seed.admin));

    const approvalTask = db.prepare('SELECT status FROM approval_tasks WHERE mapping_id=? AND step=3').get(seed.mappingA);
    assert.strictEqual(approvalTask.status, 'in_progress');

    const combinedConflicts = await request('/api/conflicts', {}, cookie);
    assert.strictEqual(combinedConflicts.res.status, 200);
    assert.ok(combinedConflicts.body.some(row => row.conflict_type === 'field'));
    assert.ok(combinedConflicts.body.some(row => row.conflict_type === 'term'));

    const termResolve = await request(`/api/conflicts/term/${seed.termConflict}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution: '术语词典采用集团客户定义' })
    }, cookie);
    assert.strictEqual(termResolve.res.status, 200);
    const term = db.prepare('SELECT status, resolution, resolved_by FROM term_conflicts WHERE id=?').get(seed.termConflict);
    assert.strictEqual(term.status, 'resolved');
    assert.strictEqual(term.resolution, '术语词典采用集团客户定义');
    assert.strictEqual(term.resolved_by, seed.admin);

    const deleteTodo = await request(`/api/todos/${todo.body.id}`, { method: 'DELETE' }, cookie);
    assert.strictEqual(deleteTodo.res.status, 200);

    console.log('Conflict and todo route integration test passed');
  } finally {
    await stopServer(server);
    resetData();
    db.close();
    cleanupDb();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
