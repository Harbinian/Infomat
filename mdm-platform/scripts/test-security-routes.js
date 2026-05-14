const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const PORT = 3199;
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

function insertUser(name, employeeNo, departmentId, role) {
  return db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    name,
    employeeNo,
    departmentId,
    role,
    role,
    hashPassword('pass1234')
  ).lastInsertRowid;
}

function seedData() {
  const deptA = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('销售部', 'SALE').lastInsertRowid;
  const deptB = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('财务部', 'FIN').lastInsertRowid;
  const admin = insertUser('系统管理员', 'ADMIN001', deptA, 'admin');
  const reviewer = insertUser('评审人', 'REV001', deptA, 'reviewer');
  const submitterA = insertUser('销售报送人', 'SALE001', deptA, 'submitter');
  const submitterB = insertUser('财务报送人', 'FIN001', deptB, 'submitter');
  const ownerB = insertUser('财务负责人', 'OWNFIN', deptB, 'owner');

  const systemA = db.prepare('INSERT INTO systems (name, dept_id) VALUES (?, ?)').run('CRM', deptA).lastInsertRowid;
  const systemB = db.prepare('INSERT INTO systems (name, dept_id) VALUES (?, ?)').run('ERP', deptB).lastInsertRowid;
  const capA = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id, status) VALUES (?, ?, ?, ?)').run('销售能力', 'L1', deptA, 'pending').lastInsertRowid;
  const capB = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id, status) VALUES (?, ?, ?, ?)').run('财务能力', 'L1', deptB, 'pending').lastInsertRowid;
  const processA = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id, status) VALUES (?, ?, ?, ?)').run('销售客户维护', capA, deptA, 'pending').lastInsertRowid;
  const processB = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id, status) VALUES (?, ?, ?, ?)').run('财务客户维护', capB, deptB, 'pending').lastInsertRowid;

  const mappingA = db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'published', ?, 5)").run(processA, deptA, submitterA).lastInsertRowid;
  const mappingB = db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'published', ?, 5)").run(processB, deptB, submitterB).lastInsertRowid;
  db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'draft', ?, 1)").run(processA, deptA, submitterA);
  db.prepare("INSERT INTO mapping_systems (mapping_id, system_id, system_role) VALUES (?, ?, 'primary')").run(mappingA, systemA);
  db.prepare("INSERT INTO mapping_systems (mapping_id, system_id, system_role) VALUES (?, ?, 'primary')").run(mappingB, systemB);

  const fieldA = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, note, submitted_by)
    VALUES (?, '客户名称', 'customer_name', '客户', '文本', '销售字段', ?)
  `).run(mappingA, submitterA).lastInsertRowid;
  const fieldB = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, note, submitted_by)
    VALUES (?, '客户名称', 'customer_name', '客户', '文本', '财务字段', ?)
  `).run(mappingB, submitterB).lastInsertRowid;

  const todoB = db.prepare(`
    INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, urgency)
    VALUES (?, ?, 'field_confirm', ?, ?, '财务字段待确认', 'high')
  `).run(deptA, deptB, mappingB, fieldB).lastInsertRowid;

  const conflict = db.prepare(`
    INSERT INTO field_conflicts (field_entry_a_id, field_entry_b_id, conflict_field, submitter_a, value_a, submitter_b, value_b, dept_a, dept_b, severity)
    VALUES (?, ?, 'note', ?, '销售字段', ?, '财务字段', ?, ?, 'warn')
  `).run(fieldA, fieldB, submitterA, submitterB, deptA, deptB).lastInsertRowid;
  const termConflict = db.prepare(`
    INSERT INTO term_conflicts (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity)
    VALUES ('客户', ?, '销售客户', ?, '开票客户', 'warn')
  `).run(deptA, deptB).lastInsertRowid;
  db.prepare("INSERT INTO terms (term, definition, scope, created_by, status) VALUES ('客户', '客户定义', '集团', ?, 'approved')").run(admin);
  db.prepare("INSERT INTO terms (term, definition, scope, created_by, status) VALUES ('客户号', '客户编号', '系统', ?, 'approved')").run(admin);

  return { capA, processA, mappingA, mappingB, todoB, conflict, termConflict, submitterA };
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
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('spreadsheet')) {
    return { res, buffer: Buffer.from(await res.arrayBuffer()) };
  }
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

async function login(employeeNo) {
  const result = await request('/api/org/login', {
    method: 'POST',
    body: JSON.stringify({ employee_no: employeeNo, password: 'pass1234' })
  });
  assert.strictEqual(result.res.status, 200);
  return result.res.headers.get('set-cookie').split(';')[0];
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

    const adminCookie = await login('ADMIN001');
    const reviewerCookie = await login('REV001');
    const submitterCookie = await login('SALE001');
    const ownerBCookie = await login('OWNFIN');

    const createSystem = await request('/api/systems', {
      method: 'POST',
      body: JSON.stringify({ name: '越权系统', dept_id: null })
    }, submitterCookie);
    assert.strictEqual(createSystem.res.status, 403);

    const capBadAction = await request(`/api/capabilities/${seed.capA}/review`, {
      method: 'POST',
      body: JSON.stringify({ action: 'aprove' })
    }, reviewerCookie);
    assert.strictEqual(capBadAction.res.status, 400);

    const capSubmitterReview = await request(`/api/capabilities/${seed.capA}/review`, {
      method: 'POST',
      body: JSON.stringify({ action: 'approve' })
    }, submitterCookie);
    assert.strictEqual(capSubmitterReview.res.status, 403);

    const processSubmitterReview = await request(`/api/processes/${seed.processA}/review`, {
      method: 'POST',
      body: JSON.stringify({ action: 'reject' })
    }, submitterCookie);
    assert.strictEqual(processSubmitterReview.res.status, 403);

    const termBadAction = await request(`/api/terminology/${seed.termConflict}/review`, {
      method: 'POST',
      body: JSON.stringify({ action: 'aprove' })
    }, adminCookie);
    assert.strictEqual(termBadAction.res.status, 400);

    const mappings = await request('/api/mappings', {}, submitterCookie);
    assert.strictEqual(mappings.res.status, 200);
    assert.ok(mappings.body.every(row => row.submitted_by === seed.submitterA));

    const hiddenMapping = await request(`/api/mappings/${seed.mappingB}`, {}, submitterCookie);
    assert.strictEqual(hiddenMapping.res.status, 404);

    const hiddenFields = await request(`/api/field-entries/mapping/${seed.mappingB}`, {}, submitterCookie);
    assert.strictEqual(hiddenFields.res.status, 403);

    const exportResult = await request('/api/export/excel', {}, submitterCookie);
    assert.strictEqual(exportResult.res.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportResult.buffer);
    const values = [];
    workbook.getWorksheet('字段台账').eachRow((row, rowNumber) => {
      if (rowNumber > 1) values.push(row.getCell(11).value);
    });
    assert.deepStrictEqual(values, ['销售字段']);

    const doneOtherDept = await request(`/api/todos/${seed.todoB}/done`, { method: 'POST' }, submitterCookie);
    assert.strictEqual(doneOtherDept.res.status, 403);

    const doneOwnDept = await request(`/api/todos/${seed.todoB}/done`, { method: 'POST' }, ownerBCookie);
    assert.strictEqual(doneOwnDept.res.status, 200);

    const deleteOtherDept = await request(`/api/todos/${seed.todoB}`, { method: 'DELETE' }, submitterCookie);
    assert.strictEqual(deleteOtherDept.res.status, 403);

    const oldResolve = await request(`/api/conflicts/${seed.conflict}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution: '普通用户越权解决' })
    }, submitterCookie);
    assert.strictEqual(oldResolve.res.status, 403);

    const oldTermResolve = await request(`/api/conflicts/term/${seed.termConflict}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution: '普通用户越权解决' })
    }, submitterCookie);
    assert.strictEqual(oldTermResolve.res.status, 403);

    const detect = await request('/api/conflicts/detect', { method: 'POST' }, reviewerCookie);
    assert.strictEqual(detect.res.status, 200);
    assert.ok(Number.isInteger(detect.body.detected));

    const draft = db.prepare("SELECT id FROM mappings WHERE status='draft'").get();
    const publishDraft = await request(`/api/mappings/${draft.id}/publish`, { method: 'POST' }, adminCookie);
    assert.strictEqual(publishDraft.res.status, 409);

    console.log('Security route integration test passed');
  } finally {
    await stopServer(server);
    resetData();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
