const assert = require('assert');
const express = require('express');
const { hashPassword, verifyPassword } = require('../server/auth');
const { ACCESS_MODEL_VERSION } = require('../server/roleDefinitions');
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
  const auth = require('../server/auth');
  const orgRouter = require('../server/routes/org');
  let passwordHash = hashPassword(OLD_PASSWORD);
  let mustChangePassword = 0;
  let authVersion = 7;
  let successfulLogins = 0;
  const permissions = [
    'identity:read',
    'governance:read-department',
    'governance:draft-department',
    'governance:submit-department'
  ];

  function currentUser() {
    return {
      id: 42,
      personId: 42,
      accountId: 142,
      employeeNo: 'ADMIN001',
      personName: '部门主对接人',
      name: '部门主对接人',
      role: 'department_contact',
      accountStatus: 'active',
      authVersion,
      departmentId: 9,
      departmentName: '工程技术部',
      roleCodes: ['department_contact'],
      rbacRoles: [{ code: 'department_contact', name: '部门主对接人' }],
      roleAssignments: [{ code: 'department_contact', name: '部门主对接人' }],
      permissions,
      dataScopes: ['person:42', 'department:9'],
      governanceModelVersion: ACCESS_MODEL_VERSION
    };
  }

  const repository = {
    async getUserByEmployeeNo(loginName) {
      if (loginName !== 'ADMIN001') return null;
      return {
        ...currentUser(),
        password_hash: passwordHash,
        must_change_password: mustChangePassword,
        account_id: 142,
        auth_version: authVersion
      };
    },
    async recordSuccessfulLogin(personId) {
      assert.strictEqual(personId, 42);
      successfulLogins += 1;
    },
    async validateSession(session) {
      if (
        Number(session.personId) !== 42 ||
        Number(session.accountId) !== 142 ||
        Number(session.authVersion) !== authVersion
      ) {
        return { valid: false, reason: 'authorization_changed' };
      }
      return {
        valid: true,
        user: {
          personId: 42,
          accountId: 142,
          authVersion,
          current_department_id: 9,
          personName: '部门主对接人',
          must_change_password: mustChangePassword
        }
      };
    },
    async getCurrentUserPayload() {
      return currentUser();
    },
    async getUserEffectivePermissions(personId) {
      assert.strictEqual(personId, 42);
      return { permSet: new Set(permissions), fieldConstraints: {} };
    },
    async listUsers() {
      return [{
        id: 42,
        personId: 42,
        employee_no: 'ADMIN001',
        name: '部门主对接人',
        department_id: 9,
        dept_name: '工程技术部',
        account_status: 'active'
      }];
    },
    async listDepartments() {
      return [{ id: 9, code: 'ENG', name: '工程技术部', status: 'active' }];
    },
    async getPasswordStatus(personId) {
      assert.strictEqual(personId, 42);
      return { is_default_password: Boolean(mustChangePassword) };
    },
    async getPasswordCredential(personId) {
      assert.strictEqual(personId, 42);
      return { employee_no: 'ADMIN001', password_hash: passwordHash };
    },
    async updateOwnPassword(personId, nextHash) {
      assert.strictEqual(personId, 42);
      passwordHash = nextHash;
      mustChangePassword = 0;
      authVersion += 1;
      return true;
    }
  };
  orgRouter.setIdentityRepositoryFactory(() => repository);
  auth.setIdentityRepositoryFactory(async () => repository);

  const sharedSession = {
    regenerate(callback) {
      for (const key of Object.keys(this)) {
        if (!['regenerate', 'destroy'].includes(key)) delete this[key];
      }
      callback();
    },
    destroy(callback) {
      for (const key of Object.keys(this)) {
        if (!['regenerate', 'destroy'].includes(key)) delete this[key];
      }
      callback();
    }
  };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = sharedSession;
    next();
  });
  app.use('/api/org', orgRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const failedLoginRes = await fetch(`${baseUrl}/api/org/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'wrong-password' })
    });
    assert.strictEqual(failedLoginRes.status, 401);

    const loginRes = await fetch(`${baseUrl}/api/org/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: 'ADMIN001', password: OLD_PASSWORD })
    });
    const login = await loginRes.json();
    assert.strictEqual(loginRes.status, 200, JSON.stringify(login));
    assert.strictEqual(login.personId, 42);
    assert.strictEqual(login.accountId, 142);
    assert.strictEqual(login.governanceModelVersion, ACCESS_MODEL_VERSION);
    assert.strictEqual(successfulLogins, 1);
    assert.strictEqual(sharedSession.personId, 42);
    assert.strictEqual(sharedSession.accountId, 142);
    assert.strictEqual(sharedSession.authVersion, 7);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(sharedSession, 'userRole'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(sharedSession, 'userName'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(sharedSession, 'departmentId'), false);

    const meRes = await fetch(`${baseUrl}/api/org/me`);
    const me = await meRes.json();
    assert.strictEqual(meRes.status, 200, JSON.stringify(me));
    assert.deepStrictEqual(me.roleCodes, ['department_contact']);
    assert.deepStrictEqual(me.dataScopes, ['person:42', 'department:9']);
    assert.strictEqual(me.governanceModelVersion, ACCESS_MODEL_VERSION);
    assert.ok(me.permissions.includes('governance:draft-department'));

    const sessionRes = await fetch(`${baseUrl}/api/org/session`);
    const session = await sessionRes.json();
    assert.strictEqual(sessionRes.status, 200, JSON.stringify(session));
    assert.strictEqual(session.authenticated, true);
    assert.deepStrictEqual(session.user.roleCodes, ['department_contact']);

    const legacyReadRes = await fetch(`${baseUrl}/api/org/users`);
    assert.strictEqual(legacyReadRes.status, 200);
    const legacyWriteRes = await fetch(`${baseUrl}/api/org/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_no: 'U099' })
    });
    const legacyWrite = await legacyWriteRes.json();
    assert.strictEqual(legacyWriteRes.status, 410, JSON.stringify(legacyWrite));
    assert.strictEqual(legacyWrite.code, 'LEGACY_IDENTITY_API_RETIRED');

    const passwordRes = await fetch(`${baseUrl}/api/org/me/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: OLD_PASSWORD, new_password: NEW_PASSWORD })
    });
    const passwordBody = await passwordRes.json();
    assert.strictEqual(passwordRes.status, 200, JSON.stringify(passwordBody));
    assert.ok(verifyPassword(NEW_PASSWORD, passwordHash));
    assert.strictEqual(authVersion, 8);

    const invalidatedRes = await fetch(`${baseUrl}/api/org/me`);
    const invalidated = await invalidatedRes.json();
    assert.strictEqual(invalidatedRes.status, 401, JSON.stringify(invalidated));
    assert.strictEqual(invalidated.code, 'SESSION_AUTHORIZATION_CHANGED');
  } finally {
    await closeServer(server);
    orgRouter.resetIdentityRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }

  console.log('Org current identity/session MySQL API test passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousReadModel === undefined) delete process.env.MDM_IDENTITY_READ_MODEL;
  else process.env.MDM_IDENTITY_READ_MODEL = previousReadModel;
  cleanupDb({ ignoreErrors: true });
});
