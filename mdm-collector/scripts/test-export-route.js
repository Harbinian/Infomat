const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const PORT = 3198;
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
  const ownerDeptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('信息化部', 'IT').lastInsertRowid;
  const financeDeptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('财务部', 'FIN').lastInsertRowid;
  const adminId = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '系统管理员',
    'ADMIN001',
    ownerDeptId,
    '系统管理员',
    'admin',
    hashPassword('admin123')
  ).lastInsertRowid;
  const confirmerId = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '数据负责人',
    'OWN001',
    ownerDeptId,
    '负责人',
    'owner',
    hashPassword('pass1234')
  ).lastInsertRowid;

  const systemId = db.prepare('INSERT INTO systems (name, dept_id) VALUES (?, ?)').run('MDM平台', ownerDeptId).lastInsertRowid;
  const capabilityId = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id) VALUES (?, ?, ?)').run('主数据管理', 'L1', ownerDeptId).lastInsertRowid;
  const processId = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id) VALUES (?, ?, ?)').run('客户主数据维护', capabilityId, ownerDeptId).lastInsertRowid;
  const mappingId = db.prepare(`
    INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step)
    VALUES (?, ?, 'published', ?, 5)
  `).run(processId, ownerDeptId, adminId).lastInsertRowid;
  db.prepare("INSERT INTO mapping_systems (mapping_id, system_id, system_role, sort_order) VALUES (?, ?, 'primary', 1)").run(mappingId, systemId);

  const fieldId = db.prepare(`
    INSERT INTO field_entries
      (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by)
    VALUES (?, '客户编码', 'customer_code', '客户', '文本', ?, '实时', '客户唯一编码', ?)
  `).run(mappingId, JSON.stringify(['CRM', 'ERP']), adminId).lastInsertRowid;
  db.prepare(`
    INSERT INTO field_identities
      (field_entry_id, candidate_systems, authoritative_system, maintain_dept_id, owner_user_id, confirmed, confirmed_by, confirmed_at, note)
    VALUES (?, ?, 'MDM平台', ?, ?, 1, ?, datetime('now'), '黄金源已确认')
  `).run(fieldId, JSON.stringify(['MDM平台', 'CRM']), ownerDeptId, confirmerId, confirmerId);

  db.prepare(`
    INSERT INTO term_conflicts
      (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity, status, resolution)
    VALUES ('客户', ?, '销售客户', ?, '开票客户', 'warn', 'resolved', '采用集团客户定义')
  `).run(ownerDeptId, financeDeptId);
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
  return fetch(`${BASE_URL}${routePath}`, { ...options, headers });
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
  seedData();

  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();

    const protectedExport = await request('/api/export/excel');
    assert.strictEqual(protectedExport.status, 401);

    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin123' })
    });
    assert.strictEqual(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const exportResponse = await request('/api/export/excel', {}, cookie);
    assert.strictEqual(exportResponse.status, 200);
    assert.ok(exportResponse.headers.get('content-type').includes('spreadsheetml.sheet'));
    assert.ok(exportResponse.headers.get('content-disposition').includes('mdm-field-ledger.xlsx'));

    const buffer = Buffer.from(await exportResponse.arrayBuffer());
    assert.ok(buffer.length > 0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const ledger = workbook.getWorksheet('字段台账');
    const matrix = workbook.getWorksheet('黄金源矩阵');
    const termConflicts = workbook.getWorksheet('术语冲突台账');
    assert.ok(ledger);
    assert.ok(matrix);
    assert.ok(termConflicts);

    assert.strictEqual(ledger.getRow(1).getCell(1).value, '业务流程');
    assert.strictEqual(ledger.getRow(2).getCell(1).value, '客户主数据维护');
    assert.strictEqual(ledger.getRow(2).getCell(2).value, 'MDM平台');
    assert.strictEqual(ledger.getRow(2).getCell(4).value, '客户编码');
    assert.strictEqual(ledger.getRow(2).getCell(7).value, 'MDM平台');
    assert.strictEqual(ledger.getRow(2).getCell(9).value, 'CRM, ERP');

    assert.strictEqual(matrix.getRow(2).getCell(4).value, 'MDM平台, CRM');
    assert.strictEqual(matrix.getRow(2).getCell(7).value, '是');
    assert.strictEqual(matrix.getRow(2).getCell(8).value, '数据负责人');

    assert.strictEqual(termConflicts.getRow(2).getCell(1).value, '客户');
    assert.strictEqual(termConflicts.getRow(2).getCell(2).value, '信息化部');
    assert.strictEqual(termConflicts.getRow(2).getCell(4).value, '财务部');
    assert.strictEqual(termConflicts.getRow(2).getCell(7).value, '已解决');

    console.log('Export route integration test passed');
  } finally {
    await stopServer(server);
    resetData();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
