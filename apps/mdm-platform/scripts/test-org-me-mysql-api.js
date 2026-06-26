const assert = require('assert');
const express = require('express');
const { hashPassword, verifyPassword } = require('../server/auth');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
const OLD_PASSWORD = 'OldPass123456!';
const NEW_PASSWORD = 'NewPass123456!';

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
  let storedPasswordHash = hashPassword(OLD_PASSWORD);
  let mustChangePassword = 1;
  let loginCalls = 0;
  let passwordUpdates = 0;
  let permissionChecks = 0;
  const createdUsers = [];
  const updatedUsers = [];
  const resetPasswords = [];
  const replacedRoles = [];
  const createdDepartments = [];
  const updatedDepartments = [];
  const deletedDepartments = [];
  orgRouter.setIdentityRepositoryFactory(() => ({
    async getUserByEmployeeNo(employeeNo) {
      loginCalls += 1;
      if (employeeNo !== 'U042') return null;
      return {
        id: 42,
        name: '张三',
        employee_no: 'U042',
        department_id: 9,
        role: 'owner',
        password_hash: storedPasswordHash
      };
    },
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
    },
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      permissionChecks += 1;
      return {
        permSet: new Set(['admin:access', 'conflict:manage', 'review:approve']),
        fieldConstraints: {}
      };
    },
    async listUsers() {
      return [
        { id: 42, name: '张三', employee_no: 'U042', department_id: 9, post: '流程治理专员', role: 'owner', created_at: null, dept_name: '工程技术部' },
        { id: 43, name: '李四', employee_no: 'U043', department_id: 10, post: '质量审核员', role: 'reviewer', created_at: null, dept_name: '质量管理部' }
      ];
    },
    async listUserRoleSummaries() {
      return [
        { id: 42, name: '张三', employee_no: 'U042', department_id: 9, dept_name: '工程技术部', post: '流程治理专员', role: 'owner', created_at: null, rbac_role_codes: 'data_quality,it_lead', rbac_role_names: '数据质量员,IT负责人' }
      ];
    },
    async listAssignableUsers() {
      return [
        { id: 42, name: '张三', department_id: 9, dept_name: '工程技术部' }
      ];
    },
    async getAssignedRoles(userId) {
      assert.strictEqual(userId, 42);
      return [
        { role_id: 4, role_code: 'data_quality', role_name: '数据质量员', is_system: 0 }
      ];
    },
    async getPermissionsGrouped() {
      return {
        admin: [{ perm_id: 13, perm_code: 'admin:access', resource: 'admin', action: 'access' }],
        review: [{ perm_id: 14, perm_code: 'review:approve', resource: 'review', action: 'approve' }]
      };
    },
    async listDepartments() {
      return [
        { id: 9, name: '工程技术部', code: 'ENG', path: '/9/', status: 'active' },
        { id: 10, name: '质量管理部', code: 'QMS', path: '/10/', status: 'active' }
      ];
    },
    async createDepartment(payload) {
      createdDepartments.push(payload);
      return { id: 99 };
    },
    async updateDepartment(departmentId, payload) {
      updatedDepartments.push({ departmentId, payload });
      return departmentId === 99;
    },
    async deleteDepartment(departmentId) {
      deletedDepartments.push(departmentId);
      return departmentId === 99;
    },
    async createUser(payload) {
      createdUsers.push(payload);
      return { id: 88, role: 'owner' };
    },
    async updateUser(userId, payload) {
      updatedUsers.push({ userId, payload });
      return userId === 88;
    },
    async resetUserPassword(userId, passwordHash, mustChangePassword) {
      resetPasswords.push({ userId, passwordHash, mustChangePassword });
      return userId === 88;
    },
    async replaceUserRoles(userId, roleIds, assignedBy) {
      replacedRoles.push({ userId, roleIds, assignedBy });
      return userId === 88;
    },
    async getPasswordStatus(userId) {
      assert.strictEqual(userId, 42);
      return { is_default_password: Boolean(mustChangePassword) };
    },
    async getPasswordCredential(userId) {
      assert.strictEqual(userId, 42);
      return { employee_no: 'U042', password_hash: storedPasswordHash };
    },
    async updateOwnPassword(userId, passwordHash) {
      assert.strictEqual(userId, 42);
      storedPasswordHash = passwordHash;
      mustChangePassword = 0;
      passwordUpdates += 1;
      return true;
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userName: '会话姓名',
      userRole: 'submitter',
      departmentId: 1,
      regenerate(callback) {
        delete this.userId;
        delete this.userName;
        delete this.userRole;
        delete this.departmentId;
        callback();
      },
      destroy(callback) {
        callback();
      }
    };
    next();
  });
  app.use('/api/org', orgRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const failedLoginRes = await fetch(`${baseUrl}/api/org/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_no: 'U042', password: 'wrong-password' })
    });
    const failedLoginBody = await failedLoginRes.json();
    assert.strictEqual(failedLoginRes.status, 401, JSON.stringify(failedLoginBody));
    assert.strictEqual(failedLoginBody.error, '工号或密码错误');

    const loginRes = await fetch(`${baseUrl}/api/org/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_no: 'U042', password: OLD_PASSWORD })
    });
    const loginBody = await loginRes.json();
    assert.strictEqual(loginRes.status, 200, JSON.stringify(loginBody));
    assert.strictEqual(loginBody.id, 42);
    assert.strictEqual(loginBody.name, '张三');
    assert.strictEqual(loginBody.role, 'owner');
    assert.ok(loginCalls >= 2, 'login should read credentials through identity repository');

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

    const statusRes = await fetch(`${baseUrl}/api/org/me/password-status`);
    const statusBody = await statusRes.json();
    assert.strictEqual(statusRes.status, 200, JSON.stringify(statusBody));
    assert.strictEqual(statusBody.is_default_password, true);

    const wrongChangeRes = await fetch(`${baseUrl}/api/org/me/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: 'wrong-password', new_password: NEW_PASSWORD })
    });
    const wrongChangeBody = await wrongChangeRes.json();
    assert.strictEqual(wrongChangeRes.status, 403, JSON.stringify(wrongChangeBody));
    assert.strictEqual(wrongChangeBody.error, '当前密码不正确');

    const changeRes = await fetch(`${baseUrl}/api/org/me/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: OLD_PASSWORD, new_password: NEW_PASSWORD })
    });
    const changeBody = await changeRes.json();
    assert.strictEqual(changeRes.status, 200, JSON.stringify(changeBody));
    assert.strictEqual(changeBody.success, true);
    assert.strictEqual(passwordUpdates, 1);
    assert.ok(verifyPassword(NEW_PASSWORD, storedPasswordHash));

    const updatedStatusRes = await fetch(`${baseUrl}/api/org/me/password-status`);
    const updatedStatusBody = await updatedStatusRes.json();
    assert.strictEqual(updatedStatusRes.status, 200, JSON.stringify(updatedStatusBody));
    assert.strictEqual(updatedStatusBody.is_default_password, false);

    const departmentsRes = await fetch(`${baseUrl}/api/org/departments`);
    const departmentsBody = await departmentsRes.json();
    assert.strictEqual(departmentsRes.status, 200, JSON.stringify(departmentsBody));
    assert.deepStrictEqual(departmentsBody.map(department => department.code), ['ENG', 'QMS']);

    const createDepartmentRes = await fetch(`${baseUrl}/api/org/departments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '项目管理部',
        code: 'PMO',
        parent_id: 9,
        department_type: '业务',
        manager_user_id: 42,
        data_owner_user_id: 43,
        source_system: 'MDM_SYS',
        external_id: 'EXT-PMO',
        status: 'active',
        effective_from: '2026-01-01',
        effective_to: null
      })
    });
    const createDepartmentBody = await createDepartmentRes.json();
    assert.strictEqual(createDepartmentRes.status, 200, JSON.stringify(createDepartmentBody));
    assert.strictEqual(createDepartmentBody.id, 99);
    assert.strictEqual(createdDepartments[0].code, 'PMO');
    assert.strictEqual(createdDepartments[0].created_by, 42);
    assert.strictEqual(createdDepartments[0].final_responsible_person_id, null, 'route must not copy manager_user_id into person responsibility');
    assert.strictEqual(createdDepartments[0].data_owner_person_id, null, 'route must not copy data_owner_user_id into person owner');

    const updateDepartmentRes = await fetch(`${baseUrl}/api/org/departments/99`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '项目管理部更新',
        code: 'PMO2',
        parent_id: null,
        sort_order: 7,
        department_type: '管理',
        data_owner_user_id: 42,
        source_system: 'MDM_SYS',
        status: 'active'
      })
    });
    const updateDepartmentBody = await updateDepartmentRes.json();
    assert.strictEqual(updateDepartmentRes.status, 200, JSON.stringify(updateDepartmentBody));
    assert.strictEqual(updateDepartmentBody.success, true);
    assert.strictEqual(updatedDepartments[0].departmentId, 99);
    assert.strictEqual(updatedDepartments[0].payload.code, 'PMO2');
    assert.strictEqual(updatedDepartments[0].payload.updated_by, 42);
    assert.strictEqual(updatedDepartments[0].payload.final_responsible_person_id, null, 'route update must not copy manager_user_id into person responsibility');
    assert.strictEqual(updatedDepartments[0].payload.data_owner_person_id, null, 'route update must not copy data_owner_user_id into person owner');

    const deleteDepartmentRes = await fetch(`${baseUrl}/api/org/departments/99`, { method: 'DELETE' });
    const deleteDepartmentBody = await deleteDepartmentRes.json();
    assert.strictEqual(deleteDepartmentRes.status, 200, JSON.stringify(deleteDepartmentBody));
    assert.strictEqual(deleteDepartmentBody.success, true);
    assert.deepStrictEqual(deletedDepartments, [99]);

    const usersRes = await fetch(`${baseUrl}/api/org/users`);
    const usersBody = await usersRes.json();
    assert.strictEqual(usersRes.status, 200, JSON.stringify(usersBody));
    assert.deepStrictEqual(usersBody.map(user => user.employee_no), ['U042', 'U043']);

    const rolesSummaryRes = await fetch(`${baseUrl}/api/org/users/roles-summary`);
    const rolesSummaryBody = await rolesSummaryRes.json();
    assert.strictEqual(rolesSummaryRes.status, 200, JSON.stringify(rolesSummaryBody));
    assert.strictEqual(rolesSummaryBody[0].rbac_role_codes, 'data_quality,it_lead');

    const assignableRes = await fetch(`${baseUrl}/api/org/users/assignable`);
    const assignableBody = await assignableRes.json();
    assert.strictEqual(assignableRes.status, 200, JSON.stringify(assignableBody));
    assert.strictEqual(assignableBody[0].dept_name, '工程技术部');

    const assignedRolesRes = await fetch(`${baseUrl}/api/org/users/42/roles`);
    const assignedRolesBody = await assignedRolesRes.json();
    assert.strictEqual(assignedRolesRes.status, 200, JSON.stringify(assignedRolesBody));
    assert.deepStrictEqual(assignedRolesBody.map(role => role.role_code), ['data_quality']);

    const permissionsRes = await fetch(`${baseUrl}/api/org/permissions`);
    const permissionsBody = await permissionsRes.json();
    assert.strictEqual(permissionsRes.status, 200, JSON.stringify(permissionsBody));
    assert.strictEqual(permissionsBody.admin[0].perm_code, 'admin:access');

    const createUserRes = await fetch(`${baseUrl}/api/org/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '王五',
        employee_no: 'U088',
        department_id: 9,
        post: '项目经理',
        role: 'it_lead',
        role_ids: [3, 4]
      })
    });
    const createUserBody = await createUserRes.json();
    assert.strictEqual(createUserRes.status, 200, JSON.stringify(createUserBody));
    assert.strictEqual(createUserBody.id, 88);
    assert.ok(createUserBody.initial_password, '创建用户应返回系统生成的初始密码');
    assert.strictEqual(createdUsers.length, 1);
    assert.strictEqual(createdUsers[0].employee_no, 'U088');
    assert.strictEqual(createdUsers[0].must_change_password, 1);
    assert.ok(verifyPassword(createUserBody.initial_password, createdUsers[0].password_hash));
    assert.deepStrictEqual(createdUsers[0].role_ids, [3, 4]);

    const updateUserRes = await fetch(`${baseUrl}/api/org/users/88`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '王五更新',
        department_id: 10,
        post: '流程负责人',
        role: 'reviewer',
        role_ids: [4]
      })
    });
    const updateUserBody = await updateUserRes.json();
    assert.strictEqual(updateUserRes.status, 200, JSON.stringify(updateUserBody));
    assert.strictEqual(updateUserBody.success, true);
    assert.strictEqual(updatedUsers[0].userId, 88);
    assert.strictEqual(updatedUsers[0].payload.name, '王五更新');

    const resetPasswordRes = await fetch(`${baseUrl}/api/org/users/88/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const resetPasswordBody = await resetPasswordRes.json();
    assert.strictEqual(resetPasswordRes.status, 200, JSON.stringify(resetPasswordBody));
    assert.strictEqual(resetPasswordBody.success, true);
    assert.ok(resetPasswordBody.initial_password, '重置密码应返回系统生成的初始密码');
    assert.strictEqual(resetPasswords[0].userId, 88);
    assert.strictEqual(resetPasswords[0].mustChangePassword, 1);
    assert.ok(verifyPassword(resetPasswordBody.initial_password, resetPasswords[0].passwordHash));

    const replaceRolesRes = await fetch(`${baseUrl}/api/org/users/88/roles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_ids: [1, 4] })
    });
    const replaceRolesBody = await replaceRolesRes.json();
    assert.strictEqual(replaceRolesRes.status, 200, JSON.stringify(replaceRolesBody));
    assert.strictEqual(replaceRolesBody.success, true);
    assert.deepStrictEqual(replacedRoles[0].roleIds, [1, 4]);
    assert.strictEqual(replacedRoles[0].assignedBy, 42);
    assert.ok(permissionChecks >= 12, 'admin read/write routes should check permissions through identity repository');

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
