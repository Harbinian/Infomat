const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const db = require('../server/db');
const auth = require('../server/auth');
const conflictsRouter = require('../server/routes/conflicts');

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
    DELETE FROM conflict_coordination_history;
    DELETE FROM conflict_assignments;
    DELETE FROM todos;
    DELETE FROM field_conflicts;
    DELETE FROM field_identities;
    DELETE FROM field_entries;
    DELETE FROM mappings;
    DELETE FROM processes;
    DELETE FROM capabilities;
    DELETE FROM user_roles;
    DELETE FROM users;
    DELETE FROM departments;
  `);
}

function seedConflictScope() {
  const deptA = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('会话部门', 'SESSION').lastInsertRowid;
  const deptB = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('协同部门', 'OTHER').lastInsertRowid;
  db.prepare(`
    INSERT INTO users (id, name, employee_no, department_id, post, role, password_hash)
    VALUES (42, 'MySQL 身份冲突处理人', 'MYSQL042', ?, '报送人', 'submitter', 'hash')
  `).run(deptA);
  const assigneeId = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES ('协同处理人', 'ASSIGN043', ?, '处理人', 'submitter', 'hash')
  `).run(deptB).lastInsertRowid;

  const capabilityId = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status)
    VALUES ('冲突治理能力', 'L1', ?, 'pending')
  `).run(deptA).lastInsertRowid;
  const processA = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status)
    VALUES ('冲突流程A', ?, ?, 'pending')
  `).run(capabilityId, deptA).lastInsertRowid;
  const processB = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status)
    VALUES ('冲突流程B', ?, ?, 'pending')
  `).run(capabilityId, deptB).lastInsertRowid;
  const mappingA = db.prepare(`
    INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step)
    VALUES (?, ?, 'published', 42, 5)
  `).run(processA, deptA).lastInsertRowid;
  const mappingB = db.prepare(`
    INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step)
    VALUES (?, ?, 'published', 42, 5)
  `).run(processB, deptB).lastInsertRowid;
  const fieldA = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, submitted_by)
    VALUES (?, '客户编码', 'customer_code', '客户', '文本', 42)
  `).run(mappingA).lastInsertRowid;
  const fieldB = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, submitted_by)
    VALUES (?, '客户编码', 'customer_code', '客户', '文本', 42)
  `).run(mappingB).lastInsertRowid;

  const silencedConflictId = db.prepare(`
    INSERT INTO field_conflicts (field_entry_a_id, field_entry_b_id, conflict_field, value_a, value_b, dept_a, dept_b, severity, status)
    VALUES (?, ?, 'note', 'A', 'B', ?, ?, 'warn', 'silenced')
  `).run(fieldA, fieldB, deptA, deptB).lastInsertRowid;
  const pendingConflictId = db.prepare(`
    INSERT INTO field_conflicts (field_entry_a_id, field_entry_b_id, conflict_field, value_a, value_b, dept_a, dept_b, severity, status)
    VALUES (?, ?, 'authoritative_system', 'CRM', 'ERP', ?, ?, 'error', 'pending')
  `).run(fieldA, fieldB, deptA, deptB).lastInsertRowid;

  return { deptA, assigneeId, silencedConflictId, pendingConflictId };
}

async function main() {
  let permissionCalls = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      permissionCalls += 1;
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['data:view_all', 'conflict:manage']), fieldConstraints: {} };
    }
  }));

  resetData();
  const seed = seedConflictScope();

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'submitter',
      userName: 'MySQL 身份冲突处理人',
      departmentId: seed.deptA
    };
    next();
  });
  app.use('/api/conflicts', conflictsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const listRes = await fetch(`${baseUrl}/api/conflicts?type=field`);
    const listBody = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(listBody));
    assert.ok(
      listBody.some(row => row.id === seed.silencedConflictId),
      'MySQL 身份全局查看权限应能看到静默冲突'
    );

    const assignRes = await fetch(`${baseUrl}/api/conflicts/${seed.pendingConflictId}/assign?type=field`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_user_id: seed.assigneeId })
    });
    const assignBody = await assignRes.json();
    assert.strictEqual(assignRes.status, 200, JSON.stringify(assignBody));
    assert.strictEqual(assignBody.success, true);
    assert.ok(permissionCalls > 0, '冲突权限判断应读取 MySQL 身份权限');

    console.log('Conflicts MySQL identity API test passed');
  } finally {
    await closeServer(server);
    auth.resetIdentityRepositoryFactory();
    resetData();
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
