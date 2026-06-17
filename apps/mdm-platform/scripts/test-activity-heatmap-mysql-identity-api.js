const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const activityRouter = require('../server/routes/activity');

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
  let permissionsCalls = 0;
  let roleCalls = 0;

  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      permissionsCalls += 1;
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['data:view_all']), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      roleCalls += 1;
      assert.strictEqual(userId, 42);
      return [{ code: legacyRole, name: '基础角色' }].filter(role => role.code);
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'owner',
      userName: 'MySQL 身份用户',
      departmentId: 900
    };
    next();
  });
  app.use('/api/activity', activityRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${baseUrl}/api/activity/heatmap?scope=all&days=90`);
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.scope, 'all');
    assert.strictEqual(body.days, 90);
    assert.ok(Array.isArray(body.dates), '应返回日期序列');
    assert.ok(permissionsCalls > 0, '应通过 MySQL 身份仓储读取权限');
    assert.strictEqual(roleCalls, 0, '已有 data:view_all 权限时不需要再读取角色码');

    console.log('Activity heatmap MySQL identity API test passed');
  } finally {
    await closeServer(server);
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
  cleanupDb({ ignoreErrors: true });
});
