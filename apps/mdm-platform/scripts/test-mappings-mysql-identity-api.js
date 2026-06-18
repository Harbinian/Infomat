const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const db = require('../server/db');
const auth = require('../server/auth');
const mappingsRouter = require('../server/routes/mappings');

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
    DELETE FROM approval_tasks;
    DELETE FROM approval_history;
    DELETE FROM field_entries;
    DELETE FROM mapping_related_departments;
    DELETE FROM mapping_systems;
    DELETE FROM mappings;
    DELETE FROM processes;
    DELETE FROM capabilities;
    DELETE FROM systems;
    DELETE FROM user_roles;
    DELETE FROM users;
    DELETE FROM departments;
  `);
}

function seedMappingsScope() {
  const sessionDeptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('会话部门', 'SESSION').lastInsertRowid;
  const otherDeptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('其他部门', 'OTHER').lastInsertRowid;

  db.prepare(`
    INSERT INTO users (id, name, employee_no, department_id, post, role, password_hash)
    VALUES (42, 'MySQL 身份报送人', 'MYSQL042', ?, '审核员', 'reviewer', 'hash')
  `).run(sessionDeptId);
  const localSubmitterId = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES ('本地报送人', 'LOCAL043', ?, '报送人', 'submitter', 'hash')
  `).run(sessionDeptId).lastInsertRowid;

  const capabilityId = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status)
    VALUES ('映射治理能力', 'L1', ?, 'pending')
  `).run(sessionDeptId).lastInsertRowid;
  const processId = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status)
    VALUES ('本部门映射流程', ?, ?, 'pending')
  `).run(capabilityId, sessionDeptId).lastInsertRowid;

  const otherCapabilityId = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status)
    VALUES ('跨部门映射能力', 'L1', ?, 'pending')
  `).run(otherDeptId).lastInsertRowid;
  const otherProcessId = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status)
    VALUES ('其他部门映射流程', ?, ?, 'pending')
  `).run(otherCapabilityId, otherDeptId).lastInsertRowid;

  const mappingId = db.prepare(`
    INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step)
    VALUES (?, ?, 'draft', ?, 1)
  `).run(processId, sessionDeptId, localSubmitterId).lastInsertRowid;
  const otherMappingId = db.prepare(`
    INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step)
    VALUES (?, ?, 'draft', ?, 1)
  `).run(otherProcessId, otherDeptId, localSubmitterId).lastInsertRowid;

  return { sessionDeptId, processId, mappingId, otherMappingId };
}

async function main() {
  let permissionCalls = 0;
  let roleCalls = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      permissionCalls += 1;
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['data:view_all']), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      roleCalls += 1;
      assert.strictEqual(userId, 42);
      return [{ code: legacyRole, name: '基础角色' }, { code: 'submitter', name: '报送人' }].filter(role => role.code);
    }
  }));

  resetData();
  const seed = seedMappingsScope();

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'reviewer',
      userName: 'MySQL 身份报送人',
      departmentId: seed.sessionDeptId
    };
    next();
  });
  app.use('/api/mappings', mappingsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const listRes = await fetch(`${baseUrl}/api/mappings`);
    const listBody = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(listBody));
    assert.deepStrictEqual(
      listBody.map(row => row.id).sort((a, b) => a - b),
      [seed.mappingId, seed.otherMappingId].sort((a, b) => a - b),
      'MySQL 身份全局查看权限应能看到全部映射'
    );

    const createRes = await fetch(`${baseUrl}/api/mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        process_id: seed.processId,
        description: 'MySQL 身份报送人创建映射',
        owner_dept_id: seed.sessionDeptId,
        systems: [],
        related_departments: []
      })
    });
    const createBody = await createRes.json();
    assert.strictEqual(createRes.status, 200, JSON.stringify(createBody));
    assert.ok(createBody.id);
    assert.ok(permissionCalls > 0, '映射可见性应读取 MySQL 身份权限');
    assert.ok(roleCalls > 0, '映射创建权限应读取 MySQL 身份角色');

    console.log('Mappings MySQL identity API test passed');
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
