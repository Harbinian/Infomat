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
