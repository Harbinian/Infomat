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
  const rolesRouter = require('../server/routes/roles');
  assert.strictEqual(
    typeof rolesRouter.setIdentityRepositoryFactory,
    'function',
    'roles route should allow MySQL identity repository injection'
  );

  const calls = [];
  let permissionChecks = 0;
  rolesRouter.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      permissionChecks += 1;
      return { permSet: new Set(['admin:access']), fieldConstraints: {} };
    },
    async listRoles() {
      calls.push(['listRoles']);
      return [
        {
          role_id: 3,
          role_code: 'it_lead',
          role_name: 'IT负责人',
          parent_role_id: 2,
          parent_role_name: '业务负责人',
          perm_count: 1,
          user_count: 1
        }
      ];
    },
    async getRoleDetail(roleId) {
      calls.push(['getRoleDetail', roleId]);
      if (roleId !== 3) return null;
      return {
        role_id: 3,
        role_code: 'it_lead',
        role_name: 'IT负责人',
        permissions: [
          { perm_code: 'data:view_all', inherited: 0 },
          { perm_code: 'mapping:read', inherited: 1 }
        ],
        users: [
          { id: 42, name: '张三', dept_name: '工程技术部' }
        ]
      };
    },
    async getRolePermissionMatrix(roleId) {
      calls.push(['getRolePermissionMatrix', roleId]);
      if (roleId !== 3) return null;
      return {
        role: { role_id: 3, role_code: 'it_lead', role_name: 'IT负责人' },
        matrix: [
          { perm_code: 'data:view_all', resource: 'data', action: 'view_all', assigned: true, effect: 'allow' },
          { perm_code: 'mapping:read', resource: 'mapping', action: 'read', assigned: false, effect: null }
        ]
      };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userName: '管理员',
      userRole: 'admin',
      departmentId: 9
    };
    next();
  });
  app.use('/api/roles', rolesRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const listRes = await fetch(`${baseUrl}/api/roles`);
    const listBody = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(listBody));
    assert.strictEqual(listBody[0].role_code, 'it_lead');
    assert.strictEqual(listBody[0].parent_role_name, '业务负责人');

    const detailRes = await fetch(`${baseUrl}/api/roles/3`);
    const detailBody = await detailRes.json();
    assert.strictEqual(detailRes.status, 200, JSON.stringify(detailBody));
    assert.deepStrictEqual(detailBody.permissions.map(permission => permission.perm_code), ['data:view_all', 'mapping:read']);
    assert.strictEqual(detailBody.users[0].name, '张三');

    const missingDetailRes = await fetch(`${baseUrl}/api/roles/999`);
    const missingDetailBody = await missingDetailRes.json();
    assert.strictEqual(missingDetailRes.status, 404, JSON.stringify(missingDetailBody));
    assert.strictEqual(missingDetailBody.error, '角色不存在');

    const matrixRes = await fetch(`${baseUrl}/api/roles/3/permissions`);
    const matrixBody = await matrixRes.json();
    assert.strictEqual(matrixRes.status, 200, JSON.stringify(matrixBody));
    assert.strictEqual(matrixBody.role.role_code, 'it_lead');
    assert.strictEqual(matrixBody.matrix.find(permission => permission.perm_code === 'data:view_all').assigned, true);

    const blockedWriteRes = await fetch(`${baseUrl}/api/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_code: 'new_role', role_name: '新角色' })
    });
    const blockedWriteBody = await blockedWriteRes.json();
    assert.strictEqual(blockedWriteRes.status, 501, JSON.stringify(blockedWriteBody));
    assert.strictEqual(blockedWriteBody.error, '角色写入 MySQL 迁移未完成');

    assert.deepStrictEqual(calls, [
      ['listRoles'],
      ['getRoleDetail', 3],
      ['getRoleDetail', 999],
      ['getRolePermissionMatrix', 3]
    ]);
    assert.ok(permissionChecks >= 5, 'role routes should check admin permission through identity repository');

    console.log('Roles MySQL API route test passed');
  } finally {
    await closeServer(server);
    rolesRouter.resetIdentityRepositoryFactory();
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
