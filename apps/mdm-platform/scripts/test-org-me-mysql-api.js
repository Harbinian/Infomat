const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

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

async function main() {
  const orgRouter = require('../server/routes/org');
  assert.strictEqual(
    typeof orgRouter.setIdentityRepositoryFactory,
    'function',
    'org route should allow MySQL identity repository injection'
  );

  let called = 0;
  orgRouter.setIdentityRepositoryFactory(() => ({
    async getCurrentUserPayload(session) {
      called += 1;
      assert.strictEqual(session.userId, 42);
      return {
        id: 42,
        name: '张三',
        role: 'owner',
        departmentId: 9,
        departmentName: '工程技术部',
        rbacRoles: [
          { code: 'owner', name: '业务负责人' },
          { code: 'data_quality', name: '数据质量员' }
        ],
        roleCodes: ['owner', 'data_quality'],
        permissions: ['mapping:read', 'process_quality:manage']
      };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userName: '会话姓名',
      userRole: 'submitter',
      departmentId: 1
    };
    next();
  });
  app.use('/api/org', orgRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const meRes = await fetch(`${baseUrl}/api/org/me`);
    const meBody = await meRes.json();
    assert.strictEqual(meRes.status, 200, JSON.stringify(meBody));
    assert.strictEqual(meBody.name, '张三');
    assert.strictEqual(meBody.role, 'owner');
    assert.strictEqual(meBody.departmentId, 9);
    assert.strictEqual(meBody.departmentName, '工程技术部');
    assert.deepStrictEqual(meBody.roleCodes, ['owner', 'data_quality']);
    assert.ok(meBody.permissions.includes('process_quality:manage'));

    const sessionRes = await fetch(`${baseUrl}/api/org/session`);
    const sessionBody = await sessionRes.json();
    assert.strictEqual(sessionRes.status, 200, JSON.stringify(sessionBody));
    assert.strictEqual(sessionBody.authenticated, true);
    assert.strictEqual(sessionBody.user.name, '张三');
    assert.deepStrictEqual(sessionBody.user.roleCodes, ['owner', 'data_quality']);
    assert.strictEqual(called, 2);

    console.log('Org /me MySQL API route test passed');
  } finally {
    await closeServer(server);
    orgRouter.resetIdentityRepositoryFactory();
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
