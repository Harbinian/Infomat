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
  const createdRoles = [];
  const updatedRoles = [];
  const deletedRoles = [];
  const replacedPermissions = [];
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
    },
    async createRole(payload) {
      createdRoles.push(payload);
      return { role_id: 77 };
    },
    async updateRole(roleId, payload) {
      updatedRoles.push({ roleId, payload });
      return roleId === 77;
    },
    async deleteRole(roleId) {
      deletedRoles.push(roleId);
      if (roleId === 1) return { deleted: false, reason: 'system' };
      if (roleId === 3) return { deleted: false, reason: 'assigned', count: 2 };
      if (roleId === 4) return { deleted: false, reason: 'children', count: 1 };
      if (roleId !== 77) return { deleted: false, reason: 'missing' };
      return { deleted: true };
    },
    async replaceRolePermissions(roleId, permIds, effects) {
      replacedPermissions.push({ roleId, permIds, effects });
      if (roleId !== 77) return null;
      return { success: true, count: permIds.length };
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

    const createRes = await fetch(`${baseUrl}/api/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_code: 'new_role', role_name: '新角色', description: '自定义角色', parent_role_id: 2 })
    });
    const createBody = await createRes.json();
    assert.strictEqual(createRes.status, 201, JSON.stringify(createBody));
    assert.strictEqual(createBody.role_id, 77);
    assert.strictEqual(createdRoles[0].created_by, 42);

    const createInvalidRes = await fetch(`${baseUrl}/api/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_code: 'missing_name' })
    });
    const createInvalidBody = await createInvalidRes.json();
    assert.strictEqual(createInvalidRes.status, 400, JSON.stringify(createInvalidBody));
    assert.strictEqual(createInvalidBody.error, '角色编码和名称为必填');

    const updateRes = await fetch(`${baseUrl}/api/roles/77`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_name: '新角色更新', description: null, parent_role_id: null })
    });
    const updateBody = await updateRes.json();
    assert.strictEqual(updateRes.status, 200, JSON.stringify(updateBody));
    assert.strictEqual(updateBody.success, true);
    assert.deepStrictEqual(updatedRoles[0], {
      roleId: 77,
      payload: { role_name: '新角色更新', description: null, parent_role_id: null }
    });

    const missingUpdateRes = await fetch(`${baseUrl}/api/roles/999`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_name: '不存在' })
    });
    const missingUpdateBody = await missingUpdateRes.json();
    assert.strictEqual(missingUpdateRes.status, 404, JSON.stringify(missingUpdateBody));
    assert.strictEqual(missingUpdateBody.error, '角色不存在');

    const replaceRes = await fetch(`${baseUrl}/api/roles/77/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ perm_ids: [10, 13], effects: { 13: 'deny' } })
    });
    const replaceBody = await replaceRes.json();
    assert.strictEqual(replaceRes.status, 200, JSON.stringify(replaceBody));
    assert.strictEqual(replaceBody.count, 2);
    assert.deepStrictEqual(replacedPermissions[0], { roleId: 77, permIds: [10, 13], effects: { 13: 'deny' } });

    const invalidReplaceRes = await fetch(`${baseUrl}/api/roles/77/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ perm_ids: '10' })
    });
    const invalidReplaceBody = await invalidReplaceRes.json();
    assert.strictEqual(invalidReplaceRes.status, 400, JSON.stringify(invalidReplaceBody));
    assert.strictEqual(invalidReplaceBody.error, 'perm_ids 必须是数组');

    const missingReplaceRes = await fetch(`${baseUrl}/api/roles/999/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ perm_ids: [10] })
    });
    const missingReplaceBody = await missingReplaceRes.json();
    assert.strictEqual(missingReplaceRes.status, 404, JSON.stringify(missingReplaceBody));
    assert.strictEqual(missingReplaceBody.error, '角色不存在');

    const systemDeleteRes = await fetch(`${baseUrl}/api/roles/1`, { method: 'DELETE' });
    const systemDeleteBody = await systemDeleteRes.json();
    assert.strictEqual(systemDeleteRes.status, 403, JSON.stringify(systemDeleteBody));
    assert.strictEqual(systemDeleteBody.error, '系统角色不可删除');

    const assignedDeleteRes = await fetch(`${baseUrl}/api/roles/3`, { method: 'DELETE' });
    const assignedDeleteBody = await assignedDeleteRes.json();
    assert.strictEqual(assignedDeleteRes.status, 403, JSON.stringify(assignedDeleteBody));
    assert.strictEqual(assignedDeleteBody.error, '该角色已分配给 2 个用户，请先取消分配');

    const childrenDeleteRes = await fetch(`${baseUrl}/api/roles/4`, { method: 'DELETE' });
    const childrenDeleteBody = await childrenDeleteRes.json();
    assert.strictEqual(childrenDeleteRes.status, 403, JSON.stringify(childrenDeleteBody));
    assert.strictEqual(childrenDeleteBody.error, '有 1 个子角色继承自此角色，请先修改子角色的父角色');

    const missingDeleteRes = await fetch(`${baseUrl}/api/roles/999`, { method: 'DELETE' });
    const missingDeleteBody = await missingDeleteRes.json();
    assert.strictEqual(missingDeleteRes.status, 404, JSON.stringify(missingDeleteBody));
    assert.strictEqual(missingDeleteBody.error, '角色不存在');

    const deleteRes = await fetch(`${baseUrl}/api/roles/77`, { method: 'DELETE' });
    const deleteBody = await deleteRes.json();
    assert.strictEqual(deleteRes.status, 200, JSON.stringify(deleteBody));
    assert.strictEqual(deleteBody.success, true);

    assert.deepStrictEqual(calls, [
      ['listRoles'],
      ['getRoleDetail', 3],
      ['getRoleDetail', 999],
      ['getRolePermissionMatrix', 3]
    ]);
    assert.ok(deletedRoles.includes(77), 'role delete should call MySQL repository');
    assert.ok(permissionChecks >= 14, 'role routes should check admin permission through identity repository');

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
