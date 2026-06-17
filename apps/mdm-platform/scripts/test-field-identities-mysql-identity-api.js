const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const db = require('../server/db');
const auth = require('../server/auth');
const fieldIdentitiesRouter = require('../server/routes/fieldIdentities');

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

function seedFieldIdentityScope() {
  const ownerDeptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('字段属主部门', 'FIELDOWNER').lastInsertRowid;
  db.prepare(`
    INSERT INTO users (id, name, employee_no, department_id, post, role, password_hash)
    VALUES (42, 'MySQL 身份用户', 'MYSQL042', ?, '字段 owner', 'submitter', 'hash')
  `).run(ownerDeptId);
  const submitterId = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES ('字段报送人', 'SUB043', ?, '报送人', 'submitter', 'hash')
  `).run(ownerDeptId).lastInsertRowid;
  const capabilityId = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status)
    VALUES ('黄金源治理能力', 'L1', ?, 'pending')
  `).run(ownerDeptId).lastInsertRowid;
  const processId = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status)
    VALUES ('黄金源治理流程', ?, ?, 'pending')
  `).run(capabilityId, ownerDeptId).lastInsertRowid;
  const mappingId = db.prepare(`
    INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step)
    VALUES (?, ?, 'published', ?, 5)
  `).run(processId, ownerDeptId, submitterId).lastInsertRowid;
  const fieldId = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, submitted_by)
    VALUES (?, '客户名称', 'customer_name', '客户', '文本', ?)
  `).run(mappingId, submitterId).lastInsertRowid;

  return { ownerDeptId, fieldId };
}

async function main() {
  assert.strictEqual(
    typeof auth.setIdentityRepositoryFactory,
    'function',
    'auth should allow MySQL identity repository injection'
  );

  let permissionCalls = 0;
  let roleCalls = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      permissionCalls += 1;
      assert.strictEqual(userId, 42);
      return { permSet: new Set(), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      roleCalls += 1;
      assert.strictEqual(userId, 42);
      return [{ code: legacyRole, name: '基础角色' }, { code: 'owner', name: '业务负责人' }].filter(role => role.code);
    }
  }));

  const seed = seedFieldIdentityScope();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'submitter',
      userName: 'MySQL 身份用户',
      departmentId: seed.ownerDeptId
    };
    next();
  });
  app.use('/api/field-identities', fieldIdentitiesRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const upsertRes = await fetch(`${baseUrl}/api/field-identities/${seed.fieldId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate_systems: ['CRM', 'ERP'],
        authoritative_system: 'CRM',
        maintain_dept_id: seed.ownerDeptId,
        confirmed: false,
        note: 'MySQL 身份 owner 维护黄金源'
      })
    });
    const upsertBody = await upsertRes.json();
    assert.strictEqual(upsertRes.status, 200, JSON.stringify(upsertBody));
    assert.strictEqual(upsertBody.success, true);

    const confirmRes = await fetch(`${baseUrl}/api/field-identities/${seed.fieldId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authoritative_system: 'CRM' })
    });
    const confirmBody = await confirmRes.json();
    assert.strictEqual(confirmRes.status, 200, JSON.stringify(confirmBody));
    assert.strictEqual(confirmBody.success, true);

    const row = db.prepare('SELECT * FROM field_identities WHERE field_entry_id=?').get(seed.fieldId);
    assert.strictEqual(row.authoritative_system, 'CRM');
    assert.strictEqual(row.confirmed, 1);
    assert.strictEqual(row.confirmed_by, 42);
    assert.ok(permissionCalls > 0, '字段身份权限判断应读取 MySQL 身份权限');
    assert.ok(roleCalls > 0, '字段身份 owner 角色判断应读取 MySQL 身份角色');

    console.log('Field identities MySQL identity API test passed');
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
