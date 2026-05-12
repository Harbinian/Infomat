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
    UPDATE departments SET manager_user_id=NULL;
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
    DELETE FROM todos;
    DELETE FROM terms;
    DELETE FROM user_dept_roles;
    DELETE FROM version_log;
    DELETE FROM change_set;
    DELETE FROM users;
    DELETE FROM departments;
  `);
}

function seedData() {
  const deptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('业务部', 'BUS').lastInsertRowid;
  const otherDeptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('财务部', 'FIN').lastInsertRowid;
  const adminId = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '系统管理员',
    'ADMIN001',
    deptId,
    '系统管理员',
    'admin',
    hashPassword('admin123')
  ).lastInsertRowid;
  const submitterId = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '业务报送人',
    'SUB001',
    deptId,
    '专员',
    'submitter',
    hashPassword('pass1234')
  ).lastInsertRowid;
  db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '财务报送人',
    'OTHER001',
    otherDeptId,
    '专员',
    'submitter',
    hashPassword('pass1234')
  );

  const capabilityId = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id) VALUES (?, ?, ?)').run('主数据管理', 'L1', deptId).lastInsertRowid;
  const processId = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id) VALUES (?, ?, ?)').run('供应商主数据维护', capabilityId, deptId).lastInsertRowid;
  const mappingId = db.prepare(`
    INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step)
    VALUES (?, ?, 'draft', ?, 1)
  `).run(processId, deptId, submitterId).lastInsertRowid;

  return { adminId, submitterId, mappingId };
}

async function workbookBuffer(rows, headers = ['数据对象', '字段说明', '中文字段名', '英文字段名', '字段类型', '消费系统', '同步方式']) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('字段台账');
  sheet.addRow(headers);
  rows.forEach(row => sheet.addRow(row));
  return workbook.xlsx.writeBuffer();
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
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(`${BASE_URL}${routePath}`, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return { res, body: await res.text() };
  return { res, body: await res.json() };
}

async function login(employeeNo, password) {
  const result = await request('/api/org/login', {
    method: 'POST',
    body: JSON.stringify({ employee_no: employeeNo, password })
  });
  assert.strictEqual(result.res.status, 200);
  return result.res.headers.get('set-cookie').split(';')[0];
}

async function uploadWorkbook(mappingId, buffer, cookie) {
  const form = new FormData();
  form.append('mapping_id', String(mappingId));
  form.append('file', new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }), 'field-ledger.xlsx');
  return request('/api/import/field-entries', { method: 'POST', body: form }, cookie);
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

    const protectedImport = await request('/api/import/field-entries', { method: 'POST' });
    assert.strictEqual(protectedImport.res.status, 401);

    const adminCookie = await login('ADMIN001', 'admin123');
    const submitterCookie = await login('SUB001', 'pass1234');
    const otherCookie = await login('OTHER001', 'pass1234');

    const adminBuffer = await workbookBuffer([
      ['供应商', '供应商唯一编码', '供应商编码', 'supplier_code', '编码', 'ERP, SRM', '批量']
    ]);
    const adminImport = await uploadWorkbook(seed.mappingId, adminBuffer, adminCookie);
    assert.strictEqual(adminImport.res.status, 200);
    assert.strictEqual(adminImport.body.imported, 1);

    let fields = db.prepare('SELECT * FROM field_entries WHERE mapping_id=? ORDER BY id').all(seed.mappingId);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0].field_name_cn, '供应商编码');
    assert.strictEqual(fields[0].field_name_en, 'supplier_code');
    assert.strictEqual(fields[0].field_type, '编码');
    assert.strictEqual(fields[0].consume_systems, 'ERP, SRM');
    assert.strictEqual(fields[0].sync_mode, '批量');
    assert.strictEqual(fields[0].submitted_by, seed.adminId);

    const submitterBuffer = await workbookBuffer([
      ['供应商', '供应商主数据说明', '供应商名称', 'supplier_name', '文本', 'ERP', '实时']
    ]);
    const submitterImport = await uploadWorkbook(seed.mappingId, submitterBuffer, submitterCookie);
    assert.strictEqual(submitterImport.res.status, 200);
    assert.strictEqual(submitterImport.body.imported, 1);

    fields = db.prepare('SELECT * FROM field_entries WHERE mapping_id=? ORDER BY id').all(seed.mappingId);
    assert.strictEqual(fields.length, 2);
    assert.strictEqual(fields[1].data_object, '供应商');
    assert.strictEqual(fields[1].note, '供应商主数据说明');
    assert.strictEqual(fields[1].field_name_cn, null);
    assert.strictEqual(fields[1].field_name_en, null);
    assert.strictEqual(fields[1].field_type, null);
    assert.strictEqual(fields[1].consume_systems, null);
    assert.strictEqual(fields[1].sync_mode, null);
    assert.strictEqual(fields[1].submitted_by, seed.submitterId);

    const otherImport = await uploadWorkbook(seed.mappingId, submitterBuffer, otherCookie);
    assert.strictEqual(otherImport.res.status, 403);

    const missingHeaderBuffer = await workbookBuffer([
      ['供应商', '缺表头']
    ], ['数据对象', '中文字段名']);
    const missingHeaderImport = await uploadWorkbook(seed.mappingId, missingHeaderBuffer, adminCookie);
    assert.strictEqual(missingHeaderImport.res.status, 400);
    assert.ok(missingHeaderImport.body.error.includes('缺少表头'));

    const noFileForm = new FormData();
    noFileForm.append('mapping_id', String(seed.mappingId));
    const noFile = await request('/api/import/field-entries', { method: 'POST', body: noFileForm }, adminCookie);
    assert.strictEqual(noFile.res.status, 400);
    assert.strictEqual(noFile.body.error, '缺少 Excel 文件');

    console.log('Import route integration test passed');
  } finally {
    await stopServer(server);
    resetData();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
