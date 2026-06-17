const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const db = require('../server/db');
const auth = require('../server/auth');
const fieldEntriesRouter = require('../server/routes/fieldEntries');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function seedFieldLedger() {
  const sessionDeptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('会话部门', 'SESSION').lastInsertRowid;
  const ownerDeptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('字段属主部门', 'FIELDOWNER').lastInsertRowid;

  db.prepare(`
    INSERT INTO users (id, name, employee_no, department_id, post, role, password_hash)
    VALUES (42, '本地会话用户', 'LOCAL042', ?, '报送人', 'submitter', 'hash')
  `).run(sessionDeptId);
  const mappingSubmitterId = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES ('映射报送人', 'LOCAL043', ?, '报送人', 'submitter', 'hash')
  `).run(ownerDeptId).lastInsertRowid;

  const capabilityId = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status)
    VALUES ('字段治理能力', 'L1', ?, 'pending')
  `).run(ownerDeptId).lastInsertRowid;
  const processId = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status)
    VALUES ('字段治理流程', ?, ?, 'pending')
  `).run(capabilityId, ownerDeptId).lastInsertRowid;
  const mappingId = db.prepare(`
    INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step)
    VALUES (?, ?, 'published', ?, 5)
  `).run(processId, ownerDeptId, mappingSubmitterId).lastInsertRowid;
  const fieldId = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, submitted_by)
    VALUES (?, '客户名称', 'customer_name', '客户', '文本', ?)
  `).run(mappingId, mappingSubmitterId).lastInsertRowid;

  return { mappingId, fieldId };
}

async function main() {
  assert.strictEqual(
    typeof auth.setIdentityRepositoryFactory,
    'function',
    'auth should allow MySQL identity repository injection'
  );

  let permissionCalls = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      permissionCalls += 1;
      assert.strictEqual(userId, 42);
      return {
        permSet: new Set(['data:view_all', 'admin:access']),
        fieldConstraints: {}
      };
    },
    async getUserRoleCodes(userId, legacyRole) {
      assert.strictEqual(userId, 42);
      return [{ code: legacyRole, name: '基础角色' }, { code: 'admin', name: '管理员' }].filter(role => role.code);
    }
  }));

  const seed = seedFieldLedger();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'submitter',
      userName: '本地会话用户',
      departmentId: 1
    };
    next();
  });
  app.use('/api/field-entries', fieldEntriesRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const listRes = await fetch(`${baseUrl}/api/field-entries/mapping/${seed.mappingId}`);
    const listBody = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(listBody));
    assert.strictEqual(listBody[0].id, seed.fieldId);

    const createRes = await fetch(`${baseUrl}/api/field-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapping_id: seed.mappingId,
        field_name_cn: '客户编号',
        field_name_en: 'customer_code',
        data_object: '客户',
        field_type: '文本',
        consume_systems: ['CRM'],
        sync_mode: '实时',
        note: 'MySQL 身份权限创建字段'
      })
    });
    const createBody = await createRes.json();
    assert.strictEqual(createRes.status, 200, JSON.stringify(createBody));
    const created = db.prepare('SELECT * FROM field_entries WHERE id=?').get(createBody.id);
    assert.strictEqual(created.field_name_cn, '客户编号');
    assert.strictEqual(created.field_type, '文本');
    assert.strictEqual(created.consume_systems, JSON.stringify(['CRM']));
    assert.ok(permissionCalls > 0, '字段台账权限判断应读取 MySQL 身份仓储');

    console.log('Field entries MySQL identity API test passed');
  } finally {
    await closeServer(server);
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousReadModel;
  }
  cleanupDb({ ignoreErrors: true });
});
