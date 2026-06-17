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
  const auth = require('../server/auth');
  const importRbacRouter = require('../server/routes/importRbac');

  let permissionChecks = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      permissionChecks += 1;
      return { permSet: new Set(['admin:access']), fieldConstraints: {} };
    }
  }));

  const app = express();
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userName: '管理员',
      userRole: 'admin',
      departmentId: 9
    };
    next();
  });
  app.use('/api/import-rbac', importRbacRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    for (const path of ['/user-roles', '/role-permissions', '/full']) {
      const res = await fetch(`${baseUrl}/api/import-rbac${path}`, { method: 'POST' });
      const body = await res.json();
      assert.strictEqual(res.status, 501, `${path}: ${JSON.stringify(body)}`);
      assert.strictEqual(body.error, 'RBAC 批量导入 MySQL 迁移未完成');
    }
    assert.strictEqual(permissionChecks, 3);
    console.log('Import RBAC MySQL guard test passed');
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
