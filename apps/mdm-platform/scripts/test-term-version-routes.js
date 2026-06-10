const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const PORT = 3197;
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
    DELETE FROM terms;
    DELETE FROM processes;
    DELETE FROM capabilities;
    DELETE FROM systems;
    DELETE FROM user_dept_roles;
    DELETE FROM users;
    DELETE FROM departments;
  `);
}

function seedData() {
  const deptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('信息化部', 'IT').lastInsertRowid;
  const otherDeptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('财务部', 'FIN').lastInsertRowid;
  const adminId = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '系统管理员',
    'ADMIN001',
    deptId,
    '系统管理员',
    'admin',
    hashPassword('admin123')
  ).lastInsertRowid;
  db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '普通报送人',
    'SUB001',
    deptId,
    '专员',
    'submitter',
    hashPassword('pass1234')
  );

  const capabilityId = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id) VALUES (?, ?, ?)').run('主数据管理', 'L1', deptId).lastInsertRowid;
  const processId = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id) VALUES (?, ?, ?)').run('客户主数据维护', capabilityId, deptId).lastInsertRowid;
  const otherCapabilityId = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id) VALUES (?, ?, ?)').run('财务核算', 'L1', otherDeptId).lastInsertRowid;
  const otherProcessId = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id) VALUES (?, ?, ?)').run('应付账款维护', otherCapabilityId, otherDeptId).lastInsertRowid;
  const mappingId = db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'draft', ?, 1)").run(processId, deptId, adminId).lastInsertRowid;
  const fieldId = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, note, submitted_by)
    VALUES (?, '客户名称', 'customer_name', '客户', '客户显示名称', ?)
  `).run(mappingId, adminId).lastInsertRowid;

  const mappingChangeSetId = db.prepare("INSERT INTO change_set (entity_type, entity_id, operated_by, description) VALUES ('mapping', ?, ?, '创建映射')").run(mappingId, adminId).lastInsertRowid;
  db.prepare("INSERT INTO version_log (entity_type, entity_id, operation, operated_by, change_set_id) VALUES ('mapping', ?, 'create', ?, ?)").run(mappingId, adminId, mappingChangeSetId);

  const fieldChangeSetId = db.prepare("INSERT INTO change_set (entity_type, entity_id, operated_by, description) VALUES ('field_entry', ?, ?, '更新字段')").run(fieldId, adminId).lastInsertRowid;
  db.prepare(`
    INSERT INTO version_log (entity_type, entity_id, field_name, old_value, new_value, operation, operated_by, change_set_id)
    VALUES ('field_entry', ?, 'note', '旧说明', '新说明', 'update', ?, ?)
  `).run(fieldId, adminId, fieldChangeSetId);

  return { adminId, mappingId, fieldId, processId, otherProcessId };
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

async function login(employeeNo, password) {
  const result = await request('/api/org/login', {
    method: 'POST',
    body: JSON.stringify({ employee_no: employeeNo, password })
  });
  assert.strictEqual(result.res.status, 200);
  return result.res.headers.get('set-cookie').split(';')[0];
}

async function main() {
  let server;

  try {
    resetData();
    const seed = seedData();

    server = spawn(process.execPath, ['server/index.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'test-secret' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    await waitForServer();

    const protectedTerms = await request('/api/terminology');
    assert.strictEqual(protectedTerms.res.status, 401);

    const adminCookie = await login('ADMIN001', 'admin123');
    const submitterCookie = await login('SUB001', 'pass1234');

    const termTypes = await request('/api/terminology/types', {}, adminCookie);
    assert.strictEqual(termTypes.res.status, 200);
    assert.ok(termTypes.body.some(row => row.code === 'noun' && row.name === '名词'), 'term type list should include nouns');
    assert.ok(termTypes.body.some(row => row.code === 'position' && row.name === '岗位词'), 'term type list should include positions');
    assert.ok(termTypes.body.some(row => row.code === 'role' && row.name === '角色词'), 'term type list should include roles');
    assert.ok(termTypes.body.some(row => row.code === 'input' && row.name === '输入词'), 'term type list should include inputs');
    assert.ok(termTypes.body.some(row => row.code === 'output' && row.name === '输出词'), 'term type list should include outputs');
    assert.ok(termTypes.body.some(row => row.code === 'time_limit' && row.name === '时效词'), 'term type list should include time limits');

    const allowedCreate = await request('/api/terminology', {
      method: 'POST',
      body: JSON.stringify({ term: '客户-sub', definition: '购买产品或服务的对象', process_id: seed.processId })
    }, submitterCookie);
    assert.strictEqual(allowedCreate.res.status, 200);

    const scopedProcesses = await request('/api/terminology/processes', {}, submitterCookie);
    assert.strictEqual(scopedProcesses.res.status, 200);
    assert.deepStrictEqual(scopedProcesses.body.map(row => row.id), [seed.processId]);

    const forbiddenCreate = await request('/api/terminology', {
      method: 'POST',
      body: JSON.stringify({ term: '应付账款', definition: '供应商未付款项', process_id: seed.otherProcessId })
    }, submitterCookie);
    assert.strictEqual(forbiddenCreate.res.status, 403);

    const createdTerm = await request('/api/terminology', {
      method: 'POST',
      body: JSON.stringify({
        term: '客户',
        term_type_code: 'noun',
        definition: '购买产品或服务的对象',
        scope: '集团',
        forbidden: '客商',
        process_id: seed.processId
      })
    }, adminCookie);
    assert.strictEqual(createdTerm.res.status, 200);
    assert.ok(createdTerm.body.id);

    const updatedTerm = await request(`/api/terminology/${createdTerm.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        term: '客户',
        term_type_code: 'role',
        definition: '与集团发生业务关系的外部对象',
        scope: '主数据域',
        forbidden: '客户资料',
        process_id: seed.processId
      })
    }, adminCookie);
    assert.strictEqual(updatedTerm.res.status, 200);

    const approvedTerm = await request(`/api/terminology/${createdTerm.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action: 'approve' })
    }, adminCookie);
    assert.strictEqual(approvedTerm.res.status, 200);

    const approvedTerms = await request('/api/terminology?status=approved', {}, adminCookie);
    assert.strictEqual(approvedTerms.res.status, 200);
    assert.strictEqual(approvedTerms.body.length, 1);
    assert.strictEqual(approvedTerms.body[0].definition, '与集团发生业务关系的外部对象');
    assert.strictEqual(approvedTerms.body[0].term_type_code, 'role');
    assert.strictEqual(approvedTerms.body[0].term_type_name, '角色词');
    assert.strictEqual(approvedTerms.body[0].approved_by, seed.adminId);

    const entityVersions = await request(`/api/versions/entity/mapping/${seed.mappingId}`, {}, adminCookie);
    assert.strictEqual(entityVersions.res.status, 200);
    assert.strictEqual(entityVersions.body.changeSets.length, 1);
    assert.strictEqual(entityVersions.body.logs.length, 1);

    const mappingVersions = await request(`/api/versions/mapping/${seed.mappingId}`, {}, adminCookie);
    assert.strictEqual(mappingVersions.res.status, 200);
    assert.strictEqual(mappingVersions.body.length, 1);
    assert.strictEqual(mappingVersions.body[0].operator_name, '系统管理员');

    const fieldVersions = await request(`/api/versions/field/${seed.fieldId}`, {}, adminCookie);
    assert.strictEqual(fieldVersions.res.status, 200);
    assert.strictEqual(fieldVersions.body.length, 1);
    assert.strictEqual(fieldVersions.body[0].field_name, 'note');
    assert.strictEqual(fieldVersions.body[0].operator_name, '系统管理员');

    console.log('Terminology and version route integration test passed');
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
