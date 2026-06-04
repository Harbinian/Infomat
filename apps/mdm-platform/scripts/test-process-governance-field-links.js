const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const PORT = 3228;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function seedData() {
  const dept = db.prepare(`
    INSERT INTO departments (name, code, status)
    VALUES ('经营发展部', 'DEPT_JYFZ', 'active')
  `).run().lastInsertRowid;
  const submitter = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('报送人', 'SUB001', dept, '报送人', 'submitter', hashPassword('pass1234')).lastInsertRowid;
  const cap = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status, created_by)
    VALUES ('合同管理', 'L2', ?, 'approved', ?)
  `).run(dept, submitter).lastInsertRowid;
  const proc = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status, created_by)
    VALUES ('销售订单评审和执行管理', ?, ?, 'approved', ?)
  `).run(cap, dept, submitter).lastInsertRowid;
  const mapping = db.prepare(`
    INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by)
    VALUES (?, ?, 'draft', ?)
  `).run(proc, dept, submitter).lastInsertRowid;
  return { mapping };
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const tick = async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.ok) return resolve();
      } catch (error) {
        if (Date.now() > deadline) return reject(error);
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

async function request(routePath, options = {}, cookie = '') {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {})
  };
  const res = await fetch(`${BASE_URL}${routePath}`, { ...options, headers });
  return { res, body: await res.json() };
}

async function main() {
  const seed = seedData();
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'process-field-links-test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();
    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'SUB001', password: 'pass1234' })
    });
    assert.strictEqual(login.res.status, 200);
    const cookie = login.res.headers.get('set-cookie').split(';')[0];

    const create = await request('/api/field-entries', {
      method: 'POST',
      body: JSON.stringify({
        mapping_id: seed.mapping,
        field_name_cn: '订单编号',
        field_name_en: 'order_no',
        data_object: '销售订单',
        note: '订单主数据字段',
        process_governance_node_key: '销售订单评审和执行管理',
        process_governance_a1_code: 'JY-L3-01-A1-001'
      })
    }, cookie);
    assert.strictEqual(create.res.status, 200);

    let field = db.prepare('SELECT * FROM field_entries WHERE id=?').get(create.body.id);
    assert.strictEqual(field.data_object, '销售订单');
    assert.strictEqual(field.note, '订单主数据字段');
    assert.strictEqual(field.field_name_cn, null);
    assert.strictEqual(field.field_name_en, null);
    assert.strictEqual(field.process_governance_node_key, '销售订单评审和执行管理');
    assert.strictEqual(field.process_governance_a1_code, 'JY-L3-01-A1-001');

    const update = await request(`/api/field-entries/${create.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        field_name_cn: '不应由报送人更新',
        note: '已关联 A1',
        process_governance_a1_code: 'JY-L3-01-A1-002'
      })
    }, cookie);
    assert.strictEqual(update.res.status, 200);

    field = db.prepare('SELECT * FROM field_entries WHERE id=?').get(create.body.id);
    assert.strictEqual(field.field_name_cn, null);
    assert.strictEqual(field.note, '已关联 A1');
    assert.strictEqual(field.process_governance_node_key, '销售订单评审和执行管理');
    assert.strictEqual(field.process_governance_a1_code, 'JY-L3-01-A1-002');

    console.log('Process governance field link test passed');
  } finally {
    await stopServer(server);
    try {
      db.close();
    } finally {
      cleanupDb();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
