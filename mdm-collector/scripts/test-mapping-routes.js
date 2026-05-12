const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const PORT = 3195;
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

function insertDepartment(name, code) {
  return db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run(name, code).lastInsertRowid;
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

function seedCatalog() {
  const submitDeptId = insertDepartment('业务部', 'BUS');
  const ownerDeptId = insertDepartment('数据管理部', 'MDM');
  const crossDeptId = insertDepartment('财务部', 'FIN');

  const adminId = insertUser('系统管理员', 'ADMIN001', ownerDeptId, 'admin');
  const submitterId = insertUser('报送专员', 'SUB001', submitDeptId, 'submitter');
  const ownerId = insertUser('数据负责人', 'OWN001', ownerDeptId, 'owner');
  const crossOwnerId = insertUser('财务负责人', 'FIN001', crossDeptId, 'owner');

  db.prepare('UPDATE departments SET manager_user_id=? WHERE id=?').run(ownerId, ownerDeptId);
  db.prepare('UPDATE departments SET manager_user_id=? WHERE id=?').run(crossOwnerId, crossDeptId);

  const systemId = db.prepare('INSERT INTO systems (name, dept_id) VALUES (?, ?)').run('MDM平台', ownerDeptId).lastInsertRowid;
  const capabilityId = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id) VALUES (?, ?, ?)').run('主数据管理', 'L1', ownerDeptId).lastInsertRowid;
  const processId = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id) VALUES (?, ?, ?)').run('客户主数据维护', capabilityId, ownerDeptId).lastInsertRowid;

  db.prepare("INSERT INTO terms (term, definition, scope, created_by, status) VALUES (?, ?, ?, ?, 'approved')").run('客户名称', '客户的显示名称', 'CRM,MDM', adminId);

  return { submitDeptId, ownerDeptId, crossDeptId, adminId, submitterId, ownerId, crossOwnerId, systemId, capabilityId, processId };
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
      if (server.exitCode === null && !server.killed) {
        server.kill('SIGKILL');
      }
      resolve();
    }, 2000);
  });
}

async function main() {
  resetData();
  const seed = seedCatalog();

  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();

    const protectedMappings = await request('/api/mappings');
    assert.strictEqual(protectedMappings.res.status, 401);

    const submitterCookie = await login('SUB001');
    const ownerCookie = await login('OWN001');
    const crossCookie = await login('FIN001');
    const adminCookie = await login('ADMIN001');

    const mapping = await request('/api/mappings', {
      method: 'POST',
      body: JSON.stringify({
        process_id: seed.processId,
        description: '客户主数据采集',
        owner_dept_id: seed.ownerDeptId,
        systems: [{ system_id: seed.systemId, system_role: 'primary' }],
        related_departments: [{ department_id: seed.crossDeptId, relation: 'consumer' }]
      })
    }, submitterCookie);
    assert.strictEqual(mapping.res.status, 200);
    assert.ok(mapping.body.id);

    const field = await request('/api/field-entries', {
      method: 'POST',
      body: JSON.stringify({
        mapping_id: mapping.body.id,
        field_name_cn: '客户名称',
        field_name_en: 'customer_name',
        data_object: '客户',
        field_type: '文本',
        consume_systems: ['ERP'],
        sync_mode: '实时',
        note: '客户显示名称'
      })
    }, submitterCookie);
    assert.strictEqual(field.res.status, 200);

    let fields = await request(`/api/field-entries/mapping/${mapping.body.id}`, {}, submitterCookie);
    assert.strictEqual(fields.res.status, 200);
    assert.strictEqual(fields.body[0].data_object, '客户');
    assert.strictEqual(fields.body[0].note, '客户显示名称');
    assert.strictEqual(fields.body[0].field_name_cn, null);
    assert.strictEqual(fields.body[0].field_type, null);

    const ownerUpdateField = await request(`/api/field-entries/${field.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        field_name_cn: '客户名称',
        field_name_en: 'customer_name',
        field_type: '文本',
        consume_systems: ['ERP', 'CRM'],
        sync_mode: '实时',
        note: 'owner不能改报送说明'
      })
    }, ownerCookie);
    assert.strictEqual(ownerUpdateField.res.status, 200);

    fields = await request(`/api/field-entries/mapping/${mapping.body.id}`, {}, submitterCookie);
    assert.strictEqual(fields.body[0].field_name_cn, '客户名称');
    assert.strictEqual(JSON.parse(fields.body[0].consume_systems).length, 2);
    assert.strictEqual(fields.body[0].note, '客户显示名称');

    const submitterIdentity = await request(`/api/field-identities/${field.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ authoritative_system: 'CRM' })
    }, submitterCookie);
    assert.strictEqual(submitterIdentity.res.status, 403);

    const ownerIdentity = await request(`/api/field-identities/${field.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        candidate_systems: ['MDM平台', 'CRM'],
        authoritative_system: 'MDM平台',
        maintain_dept_id: seed.ownerDeptId,
        owner_user_id: seed.ownerId,
        confirmed: false,
        note: '由数据管理部确认'
      })
    }, ownerCookie);
    assert.strictEqual(ownerIdentity.res.status, 200);

    const identity = await request(`/api/field-identities/field/${field.body.id}`, {}, submitterCookie);
    assert.strictEqual(identity.res.status, 200);
    assert.strictEqual(identity.body.authoritative_system, 'MDM平台');

    const submit = await request(`/api/mappings/${mapping.body.id}/submit`, { method: 'POST' }, submitterCookie);
    assert.strictEqual(submit.res.status, 200);

    let detail = await request(`/api/mappings/${mapping.body.id}`, {}, submitterCookie);
    assert.strictEqual(detail.res.status, 200);
    assert.strictEqual(detail.body.status, 'submitted');
    assert.ok(detail.body.approvalTasks.some(task => task.step === 2 && task.status === 'in_progress' && task.assignee_user_id === seed.ownerId));
    assert.ok(detail.body.approvalTasks.some(task => task.step === 3 && task.status === 'pending' && task.assignee_user_id === seed.crossOwnerId));
    assert.ok(detail.body.approvalTasks.some(task => task.step === 4 && task.status === 'pending' && task.assignee_user_id === seed.ownerId));
    assert.ok(detail.body.approvalTasks.some(task => task.step === 5 && task.status === 'pending' && task.assignee_user_id === seed.adminId));

    const approveStep2 = await request(`/api/mappings/${mapping.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ step: 2, action: 'approve', opinion: '通过' })
    }, ownerCookie);
    assert.strictEqual(approveStep2.res.status, 200);

    detail = await request(`/api/mappings/${mapping.body.id}`, {}, submitterCookie);
    assert.strictEqual(detail.body.status, 'dept_reviewed');
    assert.ok(detail.body.approvalTasks.some(task => task.step === 3 && task.status === 'in_progress'));

    db.prepare(`INSERT INTO field_conflicts
      (field_entry_a_id, field_entry_b_id, conflict_field, submitter_a, value_a, submitter_b, value_b, dept_a, dept_b, severity)
      VALUES (?, ?, 'authoritative_system', ?, 'MDM平台', ?, 'CRM', ?, ?, 'error')`).run(
      field.body.id,
      field.body.id,
      seed.submitterId,
      seed.crossOwnerId,
      seed.submitDeptId,
      seed.crossDeptId
    );

    const blockedStep3 = await request(`/api/mappings/${mapping.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ step: 3, action: 'approve', opinion: '跨部门确认' })
    }, crossCookie);
    assert.strictEqual(blockedStep3.res.status, 200);
    assert.strictEqual(blockedStep3.body.blocked, true);

    db.prepare("UPDATE field_conflicts SET status='resolved'").run();
    db.prepare("UPDATE approval_tasks SET status='in_progress' WHERE mapping_id=? AND step=3").run(mapping.body.id);

    const approveStep3 = await request(`/api/mappings/${mapping.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ step: 3, action: 'approve', opinion: '冲突已解决' })
    }, crossCookie);
    assert.strictEqual(approveStep3.res.status, 200);

    const approveStep4 = await request(`/api/mappings/${mapping.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ step: 4, action: 'approve', opinion: '字段确认' })
    }, ownerCookie);
    assert.strictEqual(approveStep4.res.status, 200);

    const approveStep5 = await request(`/api/mappings/${mapping.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ step: 5, action: 'approve', opinion: '终审通过' })
    }, adminCookie);
    assert.strictEqual(approveStep5.res.status, 200);

    detail = await request(`/api/mappings/${mapping.body.id}`, {}, adminCookie);
    assert.strictEqual(detail.body.status, 'published');

    console.log('Mapping route integration test passed');
  } finally {
    await stopServer(server);
    resetData();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
