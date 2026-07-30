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
  const rolesRouter = require('../server/routes/roles');
  const identityRepository = {
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
    },
    async listRoles() {
      return [{
        role_id: 1,
        role_code: 'admin',
        role_name: 'MDM系统管理员',
        role_group: 'system',
        status: 'active',
        is_core: 1
      }];
    },
    async getRoleDetail(roleId) {
      return roleId === 1
        ? {
            role_id: 1,
            role_code: 'admin',
            role_name: 'MDM系统管理员',
            permissions: [{ perm_code: 'identity:read' }],
            users: []
          }
        : null;
    },
    async getRolePermissionMatrix(roleId) {
      return roleId === 1
        ? {
            role: { role_id: 1, role_code: 'admin' },
            matrix: [{ perm_code: 'identity:read', assigned: true, effect: 'allow' }]
          }
        : null;
    }
  };
  auth.setIdentityRepositoryFactory(async () => identityRepository);
  rolesRouter.setIdentityRepositoryFactory(async () => identityRepository);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      accountId: 142,
      authVersion: 7,
      destroy(callback) { callback(); }
    };
    next();
  });
  app.use('/api/roles', rolesRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const listRes = await fetch(`${baseUrl}/api/roles`);
    const list = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(list));
    assert.strictEqual(list[0].role_code, 'admin');

    const detailRes = await fetch(`${baseUrl}/api/roles/1`);
    const detail = await detailRes.json();
    assert.strictEqual(detailRes.status, 200, JSON.stringify(detail));
    assert.strictEqual(detail.permissions[0].perm_code, 'identity:read');

    const matrixRes = await fetch(`${baseUrl}/api/roles/1/permissions`);
    const matrix = await matrixRes.json();
    assert.strictEqual(matrixRes.status, 200, JSON.stringify(matrix));
    assert.strictEqual(matrix.matrix[0].assigned, true);

    const missingRes = await fetch(`${baseUrl}/api/roles/999`);
    assert.strictEqual(missingRes.status, 404);

    for (const request of [
      { path: '/api/roles', method: 'POST', body: { role_code: 'custom' } },
      { path: '/api/roles/1', method: 'PUT', body: { role_name: 'changed' } },
      { path: '/api/roles/1', method: 'DELETE' },
      { path: '/api/roles/1/permissions', method: 'PUT', body: { perm_ids: [] } }
    ]) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: { 'Content-Type': 'application/json' },
        body: request.body ? JSON.stringify(request.body) : undefined
      });
      const body = await response.json();
      assert.strictEqual(response.status, 405, `${request.method} ${request.path}: ${JSON.stringify(body)}`);
      assert.strictEqual(body.code, 'CORE_GOVERNANCE_MODEL_READ_ONLY');
    }

    console.log('Fixed role model read-only MySQL API test passed');
  } finally {
    await closeServer(server);
    rolesRouter.resetIdentityRepositoryFactory();
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
