const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const versionsRouter = require('../server/routes/versions');

process.env.MDM_DB_QUIET = '1';

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

function resetData() {
  db.exec(`
    DELETE FROM version_log;
    DELETE FROM change_set;
    DELETE FROM field_entries;
    DELETE FROM mappings;
    DELETE FROM processes;
    DELETE FROM capabilities;
    DELETE FROM users;
    DELETE FROM departments;
  `);
}

function seedVersionData() {
  const deptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('信息化部', 'IT').lastInsertRowid;
  const adminId = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('系统管理员', 'ADMIN001', deptId, '系统管理员', 'admin', 'hash').lastInsertRowid;

  const capabilityId = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id) VALUES (?, ?, ?)').run('主数据管理', 'L1', deptId).lastInsertRowid;
  const processId = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id) VALUES (?, ?, ?)').run('客户主数据维护', capabilityId, deptId).lastInsertRowid;
  const mappingId = db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'draft', ?, 1)").run(processId, deptId, adminId).lastInsertRowid;
  const fieldId = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, note, submitted_by)
    VALUES (?, '客户名称', 'customer_name', '客户', '客户显示名称', ?)
  `).run(mappingId, adminId).lastInsertRowid;

  const mappingChangeSetId = db.prepare(`
    INSERT INTO change_set (entity_type, entity_id, operated_by, description)
    VALUES ('mapping', ?, ?, '创建映射')
  `).run(mappingId, adminId).lastInsertRowid;
  db.prepare(`
    INSERT INTO version_log (entity_type, entity_id, operation, operated_by, change_set_id)
    VALUES ('mapping', ?, 'create', ?, ?)
  `).run(mappingId, adminId, mappingChangeSetId);

  const fieldChangeSetId = db.prepare(`
    INSERT INTO change_set (entity_type, entity_id, operated_by, description)
    VALUES ('field_entry', ?, ?, '更新字段')
  `).run(fieldId, adminId).lastInsertRowid;
  db.prepare(`
    INSERT INTO version_log (entity_type, entity_id, field_name, old_value, new_value, operation, operated_by, change_set_id)
    VALUES ('field_entry', ?, 'note', '旧说明', '新说明', 'update', ?, ?)
  `).run(fieldId, adminId, fieldChangeSetId);

  return { adminId, mappingId, fieldId };
}

async function main() {
  let server;
  try {
    resetData();
    const seed = seedVersionData();

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = {
        userId: seed.adminId,
        userRole: 'admin',
        userName: '系统管理员'
      };
      next();
    });
    app.use('/api/versions', versionsRouter);

    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const entityRes = await fetch(`${baseUrl}/api/versions/entity/mapping/${seed.mappingId}`);
    const entityBody = await entityRes.json();
    assert.strictEqual(entityRes.status, 200, JSON.stringify(entityBody));
    assert.strictEqual(entityBody.changeSets.length, 1);
    assert.strictEqual(entityBody.logs.length, 1);

    const mappingRes = await fetch(`${baseUrl}/api/versions/mapping/${seed.mappingId}`);
    const mappingBody = await mappingRes.json();
    assert.strictEqual(mappingRes.status, 200, JSON.stringify(mappingBody));
    assert.strictEqual(mappingBody.length, 1);
    assert.strictEqual(mappingBody[0].operator_name, '系统管理员');

    const fieldRes = await fetch(`${baseUrl}/api/versions/field/${seed.fieldId}`);
    const fieldBody = await fieldRes.json();
    assert.strictEqual(fieldRes.status, 200, JSON.stringify(fieldBody));
    assert.strictEqual(fieldBody.length, 1);
    assert.strictEqual(fieldBody[0].field_name, 'note');
    assert.strictEqual(fieldBody[0].operator_name, '系统管理员');

    console.log('Version route integration test passed');
  } finally {
    if (server) await closeServer(server);
    try {
      resetData();
    } finally {
      cleanupDb({ ignoreErrors: true });
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
