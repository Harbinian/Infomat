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
  const roleWorkbenchRouter = require('../server/routes/roleWorkbench');
  const roleCodes = ['admin'];
  const permissionSet = new Set([
    'identity:read',
    'identity:manage-account',
    'identity:assign-role',
    'identity:read-audit',
    'governance:read-global'
  ]);

  roleWorkbenchRouter.setIdentityRepositoryFactory(async () => ({
    async getCurrentUserPayload() {
      return {
        id: 42,
        personId: 42,
        name: '系统管理员',
        role: 'admin',
        departmentId: 9,
        departmentName: '工程技术部',
        roleCodes,
        permissions: Array.from(permissionSet)
      };
    },
    async getUserEffectivePermissions() {
      return { permSet: new Set(permissionSet), fieldConstraints: {} };
    }
  }));

  const app = express();
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      userId: 42,
      userName: '系统管理员',
      departmentId: 9
    };
    next();
  });
  app.use('/api/role-workbench', roleWorkbenchRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${baseUrl}/api/role-workbench?mode=todo`);
    const body = await response.json();
    assert.strictEqual(response.status, 200, JSON.stringify(body));
    assert.deepStrictEqual(body.user.roleCodes, ['admin']);
    assert.strictEqual(body.roles.length, 7);
    assert.strictEqual(body.roles.find(role => role.code === 'admin').owned, true);
    assert.strictEqual(body.roles.find(role => role.code === 'department_contact').owned, false);
    assert.ok(body.roleGroups.some(group => group.key === 'system'));
    assert.ok(body.roleGroups.some(group => group.key === 'mdm'));
    assert.ok(
      (body.nextActions || []).every(action => ![
        'governance:draft-department',
        'governance:review-department',
        'governance:publish'
      ].includes(action.requiredPermission)),
      'admin workbench must not expose business write actions'
    );
  } finally {
    await closeServer(server);
    roleWorkbenchRouter.resetIdentityRepositoryFactory();
    roleWorkbenchRouter.clearWorkbenchCaches();
  }
  console.log('Role workbench fixed-role API test passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousReadModel === undefined) delete process.env.MDM_IDENTITY_READ_MODEL;
  else process.env.MDM_IDENTITY_READ_MODEL = previousReadModel;
  cleanupDb({ ignoreErrors: true });
});
