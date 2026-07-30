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

function domainError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function main() {
  const auth = require('../server/auth');
  const { csrfProtection } = require('../server/security');
  const accountsRouter = require('../server/routes/accounts');
  const governanceRouter = require('../server/routes/governance');
  const rbacRouter = require('../server/routes/rbac');
  const rolesRouter = require('../server/routes/roles');
  const importRbacRouter = require('../server/routes/importRbac');

  let csrfStatus = null;
  let csrfNextCalled = false;
  csrfProtection(
    {
      method: 'POST',
      path: '/api/org/accounts',
      session: { personId: 42 },
      get() { return null; }
    },
    {
      status(statusCode) {
        csrfStatus = statusCode;
        return this;
      },
      json() {}
    },
    () => { csrfNextCalled = true; }
  );
  assert.strictEqual(csrfStatus, 403, 'person identity writes must remain CSRF protected');
  assert.strictEqual(csrfNextCalled, false);

  let validationMode = 'valid';
  let permissions = new Set([
    'identity:read',
    'identity:manage-account',
    'identity:assign-role',
    'identity:read-audit',
    'governance:read-global'
  ]);
  auth.setIdentityRepositoryFactory(async () => ({
    async validateSession(session) {
      if (validationMode === 'invalid') return { valid: false, reason: 'auth_version_changed' };
      return {
        valid: true,
        user: {
          personId: Number(session.personId),
          accountId: Number(session.accountId),
          authVersion: Number(session.authVersion),
          current_department_id: 9,
          personName: '管理员',
          must_change_password: validationMode === 'must_change'
        }
      };
    },
    async getUserEffectivePermissions(personId) {
      assert.strictEqual(Number(personId), 42);
      return { permSet: new Set(permissions), fieldConstraints: {} };
    }
  }));

  const calls = [];
  const account = {
    person_id: 88,
    employee_no: 'U088',
    person_name: '测试账号',
    current_department_id: 9,
    department_name: '工程技术部',
    account_id: 188,
    login_name: 'u088',
    account_status: 'pending_activation',
    auth_version: 1,
    roleAssignments: []
  };
  accountsRouter.setRepositoryFactory(async () => ({
    async listAccounts() {
      calls.push(['listAccounts']);
      return [account];
    },
    async getAccount(personId) {
      calls.push(['getAccount', personId]);
      return personId === 88 ? account : null;
    },
    async createAccount(payload) {
      calls.push(['createAccount', payload]);
      return account;
    },
    async updateAccount(personId, payload) {
      calls.push(['updateAccount', personId, payload]);
      return { ...account, person_name: payload.name };
    },
    async grantRole(personId, payload) {
      calls.push(['grantRole', personId, payload]);
      return { assignmentId: 501, roleCode: payload.roleCode };
    },
    async revokeRole(personId, assignmentId, payload) {
      calls.push(['revokeRole', personId, assignmentId, payload]);
      if (assignmentId === 999) {
        throw domainError(409, 'LAST_ACTIVE_ADMIN', '不能撤销最后一个有效管理员');
      }
      return { revoked: true };
    },
    async activateAccount(personId, payload) {
      calls.push(['activateAccount', personId, payload]);
      return { ...account, account_status: 'active', auth_version: 2 };
    },
    async enableAccount(personId, payload) {
      calls.push(['enableAccount', personId, payload]);
      return { ...account, account_status: 'active' };
    },
    async disableAccount(personId, payload) {
      calls.push(['disableAccount', personId, payload]);
      return { ...account, account_status: 'disabled' };
    },
    async resetPassword(personId, payload) {
      calls.push(['resetPassword', personId, payload]);
      return { ...account, auth_version: 2, must_change_password: 1 };
    },
    async listAccessEvents() {
      calls.push(['listAccessEvents']);
      return [{ event_id: 1, event_type: 'account_created', target_person_id: 88 }];
    }
  }));

  let decisionPayload = null;
  governanceRouter.setRepositoryFactory(async () => ({
    async listGovernanceDecisions(filters) {
      calls.push(['listGovernanceDecisions', filters]);
      return [];
    },
    async recordGovernanceDecision(payload) {
      decisionPayload = payload;
      return {
        decisionRecordId: 701,
        accountablePersonId: 301,
        accountablePersonName: '部门负责人'
      };
    }
  }));

  rolesRouter.setIdentityRepositoryFactory(async () => ({
    async listRoles() {
      return [{ role_id: 1, role_code: 'admin', role_name: 'MDM系统管理员' }];
    },
    async getRoleDetail() {
      return { role_id: 1, role_code: 'admin', role_name: 'MDM系统管理员' };
    },
    async getRolePermissionMatrix() {
      return { role: { role_id: 1 }, matrix: [] };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      accountId: 142,
      authVersion: 7,
      destroy(callback) {
        callback();
      }
    };
    next();
  });
  app.use('/api/org/accounts', accountsRouter);
  app.use('/api/governance', governanceRouter);
  app.use('/api/rbac', rbacRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/import-rbac', importRbacRouter);
  app.post('/api/test-business-publish', auth.requirePermission('governance:publish'), (req, res) => {
    res.json({ success: true });
  });

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const modelRes = await fetch(`${baseUrl}/api/rbac/model`);
    const model = await modelRes.json();
    assert.strictEqual(modelRes.status, 200, JSON.stringify(model));
    assert.strictEqual(model.roles.length, 7);

    const modelWriteRes = await fetch(`${baseUrl}/api/rbac/model`, { method: 'POST' });
    const modelWrite = await modelWriteRes.json();
    assert.strictEqual(modelWriteRes.status, 405, JSON.stringify(modelWrite));
    assert.strictEqual(modelWrite.code, 'CORE_GOVERNANCE_MODEL_READ_ONLY');

    const rolesWriteRes = await fetch(`${baseUrl}/api/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_code: 'custom' })
    });
    const rolesWrite = await rolesWriteRes.json();
    assert.strictEqual(rolesWriteRes.status, 405, JSON.stringify(rolesWrite));
    assert.strictEqual(rolesWrite.code, 'CORE_GOVERNANCE_MODEL_READ_ONLY');

    const legacyImportRes = await fetch(`${baseUrl}/api/import-rbac/full`, { method: 'POST' });
    const legacyImport = await legacyImportRes.json();
    assert.strictEqual(legacyImportRes.status, 410, JSON.stringify(legacyImport));
    assert.strictEqual(legacyImport.code, 'LEGACY_IDENTITY_API_RETIRED');

    const createPayload = {
      loginName: 'u088',
      employeeNo: 'U088',
      name: '测试账号',
      departmentId: 9,
      roleAssignments: [{
        roleCode: 'department_contact',
        scopeDepartmentId: 9,
        authorizationBasis: '测试授权决定',
        effectiveFrom: '2026-07-30'
      }]
    };
    const createRes = await fetch(`${baseUrl}/api/org/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload)
    });
    const created = await createRes.json();
    assert.strictEqual(createRes.status, 201, JSON.stringify(created));
    assert.strictEqual(created.account_status, 'pending_activation');
    assert.strictEqual(calls.find(item => item[0] === 'createAccount')[1].actorPersonId, 42);

    const activateRes = await fetch(`${baseUrl}/api/org/accounts/88/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '授权材料已确认' })
    });
    const activated = await activateRes.json();
    assert.strictEqual(activateRes.status, 200, JSON.stringify(activated));
    assert.ok(activated.initialPassword);
    assert.ok(!JSON.stringify(activated.account).includes('password_hash'));

    const resetRes = await fetch(`${baseUrl}/api/org/accounts/88/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '本人申请重置' })
    });
    const reset = await resetRes.json();
    assert.strictEqual(resetRes.status, 200, JSON.stringify(reset));
    assert.ok(reset.initialPassword);

    const lastAdminRes = await fetch(`${baseUrl}/api/org/accounts/88/role-assignments/999/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '测试最后管理员保护' })
    });
    const lastAdmin = await lastAdminRes.json();
    assert.strictEqual(lastAdminRes.status, 409, JSON.stringify(lastAdmin));
    assert.strictEqual(lastAdmin.code, 'LAST_ACTIVE_ADMIN');

    permissions = new Set([
      'governance:read-department',
      'governance:review-department',
      'governance:record-department-decision'
    ]);
    const decisionRes = await fetch(`${baseUrl}/api/governance/decision-records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        departmentId: 9,
        subjectDomain: 'process',
        subjectType: 'process_design_draft',
        subjectId: '100',
        subjectVersion: 'A',
        decision: 'approved',
        decisionBasis: '部门负责人线下确认记录',
        evidenceReference: 'MEETING-2026-07-30',
        decidedAt: '2026-07-30T10:00:00+08:00'
      })
    });
    const decision = await decisionRes.json();
    assert.strictEqual(decisionRes.status, 201, JSON.stringify(decision));
    assert.strictEqual(decisionPayload.recorderPersonId, 42);
    assert.strictEqual(decisionPayload.departmentId, 9);
    assert.strictEqual(decisionPayload.decision, 'approved');

    permissions = new Set([
      'identity:read',
      'identity:manage-account',
      'identity:assign-role',
      'identity:read-audit',
      'governance:read-global'
    ]);
    const adminBusinessRes = await fetch(`${baseUrl}/api/test-business-publish`, { method: 'POST' });
    assert.strictEqual(adminBusinessRes.status, 403);

    validationMode = 'invalid';
    const invalidSessionRes = await fetch(`${baseUrl}/api/org/accounts`);
    const invalidSession = await invalidSessionRes.json();
    assert.strictEqual(invalidSessionRes.status, 401, JSON.stringify(invalidSession));
    assert.strictEqual(invalidSession.code, 'SESSION_AUTHORIZATION_CHANGED');
  } finally {
    await closeServer(server);
    accountsRouter.resetRepositoryFactory();
    governanceRouter.resetRepositoryFactory();
    rolesRouter.resetIdentityRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }

  console.log('RBAC/RACI v2 API and session contract test passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousReadModel === undefined) delete process.env.MDM_IDENTITY_READ_MODEL;
  else process.env.MDM_IDENTITY_READ_MODEL = previousReadModel;
  cleanupDb({ ignoreErrors: true });
});
