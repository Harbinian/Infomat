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
  const repository = {
    async validateSession(session) {
      return {
        valid: true,
        user: {
          personId: session.personId,
          accountId: session.accountId,
          authVersion: session.authVersion,
          personName: '管理员',
          current_department_id: 9,
          must_change_password: false
        }
      };
    },
    async getUserEffectivePermissions() {
      return { permSet: new Set(['identity:read']), fieldConstraints: {} };
    }
  };
  auth.setIdentityRepositoryFactory(async () => repository);

  const app = express();
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      accountId: 142,
      authVersion: 7,
      destroy(callback) { callback(); }
    };
    next();
  });
  app.use('/api/import-rbac', importRbacRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const method of ['GET', 'POST']) {
      for (const routePath of ['/templates/full', '/user-roles', '/role-permissions', '/full']) {
        const response = await fetch(`${baseUrl}/api/import-rbac${routePath}`, { method });
        const body = await response.json();
        assert.strictEqual(response.status, 410, `${method} ${routePath}: ${JSON.stringify(body)}`);
        assert.strictEqual(body.code, 'LEGACY_IDENTITY_API_RETIRED');
      }
    }
    console.log('Retired RBAC batch import API test passed');
  } finally {
    await closeServer(server);
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousReadModel === undefined) delete process.env.MDM_IDENTITY_READ_MODEL;
  else process.env.MDM_IDENTITY_READ_MODEL = previousReadModel;
  cleanupDb({ ignoreErrors: true });
});
