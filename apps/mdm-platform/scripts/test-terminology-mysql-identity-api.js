const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const db = require('../server/db');
const auth = require('../server/auth');
const terminologyRouter = require('../server/routes/terminology');

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
    DELETE FROM terms;
    DELETE FROM mappings;
    DELETE FROM processes;
    DELETE FROM capabilities;
    DELETE FROM user_roles;
    DELETE FROM users;
    DELETE FROM departments;
  `);
}

function seedTerminologyScope() {
  const sessionDeptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('会话部门', 'SESSION').lastInsertRowid;
  const otherDeptId = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('其他部门', 'OTHER').lastInsertRowid;

  db.prepare(`
    INSERT INTO users (id, name, employee_no, department_id, post, role, password_hash)
    VALUES (42, 'MySQL 身份管理员', 'MYSQL042', ?, '报送人', 'submitter', 'hash')
  `).run(sessionDeptId);

  const capabilityId = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status)
    VALUES ('术语治理能力', 'L1', ?, 'pending')
  `).run(sessionDeptId).lastInsertRowid;
  const processId = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status)
    VALUES ('本部门术语流程', ?, ?, 'pending')
  `).run(capabilityId, sessionDeptId).lastInsertRowid;

  const otherCapabilityId = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status)
    VALUES ('跨部门术语能力', 'L1', ?, 'pending')
  `).run(otherDeptId).lastInsertRowid;
  const otherProcessId = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status)
    VALUES ('其他部门术语流程', ?, ?, 'pending')
  `).run(otherCapabilityId, otherDeptId).lastInsertRowid;

  return { sessionDeptId, processId, otherProcessId };
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
      return { permSet: new Set(['*:*']), fieldConstraints: {} };
    }
  }));

  resetData();
  const seed = seedTerminologyScope();

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'submitter',
      userName: 'MySQL 身份管理员',
      departmentId: seed.sessionDeptId
    };
    next();
  });
  app.use('/api/terminology', terminologyRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const processRes = await fetch(`${baseUrl}/api/terminology/processes`);
    const processBody = await processRes.json();
    assert.strictEqual(processRes.status, 200, JSON.stringify(processBody));
    assert.deepStrictEqual(
      processBody.map(row => row.id).sort((a, b) => a - b),
      [seed.processId, seed.otherProcessId].sort((a, b) => a - b),
      'MySQL 身份管理员应能看到全部术语治理流程'
    );

    const createGlobalRes = await fetch(`${baseUrl}/api/terminology`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: '全局术语',
        term_type_code: 'noun',
        definition: '不绑定具体流程的全局术语'
      })
    });
    const createGlobalBody = await createGlobalRes.json();
    assert.strictEqual(createGlobalRes.status, 200, JSON.stringify(createGlobalBody));
    assert.ok(createGlobalBody.id);
    assert.ok(permissionCalls > 0, '术语路由管理员判断应读取 MySQL 身份权限');

    console.log('Terminology MySQL identity API test passed');
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
