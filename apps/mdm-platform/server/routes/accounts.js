const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2/promise');
const { hashPassword, requireAuth, requirePermission } = require('../auth');
const { makeGovernanceAccessMysqlRepository } = require('../governanceAccessMysqlRepository');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const { generateInitialPassword } = require('../passwordPolicy');

const router = express.Router();
let repositoryPromise = null;
let repositoryFactory = null;

async function repository() {
  if (repositoryFactory) return await repositoryFactory();
  if (!repositoryPromise) {
    repositoryPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      return makeGovernanceAccessMysqlRepository(pool);
    })();
  }
  try {
    return await repositoryPromise;
  } catch (error) {
    repositoryPromise = null;
    throw error;
  }
}

function actorPersonId(req) {
  return Number(req.session && req.session.personId || 0) || null;
}

function handleError(res, error) {
  if (error && error.statusCode) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code || 'ACCOUNT_OPERATION_FAILED',
      ...(error.details !== undefined ? { details: error.details } : {})
    });
  }
  if (error && error.code === 'ER_DUP_ENTRY') {
    const message = String(error.message || '');
    const code = message.includes('login') ? 'LOGIN_NAME_EXISTS' : 'ACCOUNT_EXISTS';
    return res.status(409).json({ error: '登录名、工号或账号已存在', code });
  }
  console.error(error);
  return res.status(503).json({
    error: '账号与授权服务暂不可用',
    code: 'IDENTITY_ACCESS_SERVICE_UNAVAILABLE'
  });
}

function run(res, action) {
  return Promise.resolve()
    .then(action)
    .catch(error => handleError(res, error));
}

const canReadIdentity = [requireAuth, requirePermission('identity:read')];
const canManageAccount = [requireAuth, requirePermission('identity:manage-account')];
const canAssignRole = [requireAuth, requirePermission('identity:assign-role')];
const canReadAudit = [requireAuth, requirePermission('identity:read-audit')];

router.get('/', ...canReadIdentity, (req, res) => run(res, async () => {
  const repo = await repository();
  res.json(await repo.listAccounts());
}));

router.get('/audit-events', ...canReadAudit, (req, res) => run(res, async () => {
  const repo = await repository();
  res.json(await repo.listAccessEvents({
    personId: req.query.personId ? Number(req.query.personId) : null,
    eventType: req.query.eventType || null,
    limit: req.query.limit ? Number(req.query.limit) : 100
  }));
}));

router.get('/:personId', ...canReadIdentity, (req, res) => run(res, async () => {
  const repo = await repository();
  const account = await repo.getAccount(Number(req.params.personId));
  if (!account) return res.status(404).json({ error: '账号不存在', code: 'ACCOUNT_NOT_FOUND' });
  res.json(account);
}));

router.post('/', ...canManageAccount, requirePermission('identity:assign-role'), (req, res) => run(res, async () => {
  const repo = await repository();
  const body = req.body || {};
  const pendingCredential = crypto.randomBytes(48).toString('base64url');
  const account = await repo.createAccount({
    loginName: body.loginName,
    employeeNo: body.employeeNo,
    name: body.name,
    departmentId: body.departmentId,
    roleAssignments: body.roleAssignments,
    reason: body.reason,
    pendingPasswordHash: hashPassword(pendingCredential),
    actorPersonId: actorPersonId(req)
  });
  res.status(201).json(account);
}));

router.patch('/:personId', ...canManageAccount, (req, res) => run(res, async () => {
  const repo = await repository();
  const body = req.body || {};
  const account = await repo.updateAccount(Number(req.params.personId), {
    name: body.name,
    ...(Object.prototype.hasOwnProperty.call(body, 'departmentId')
      ? { departmentId: body.departmentId }
      : {}),
    roleAssignments: body.roleAssignments,
    changeReason: body.changeReason,
    actorPersonId: actorPersonId(req)
  });
  res.json(account);
}));

router.post('/:personId/role-assignments', ...canAssignRole, (req, res) => run(res, async () => {
  const repo = await repository();
  const body = req.body || {};
  const assignment = await repo.grantRole(Number(req.params.personId), {
    roleCode: body.roleCode,
    scopeDepartmentId: body.scopeDepartmentId,
    authorizationBasis: body.authorizationBasis,
    effectiveFrom: body.effectiveFrom,
    effectiveTo: body.effectiveTo,
    actorPersonId: actorPersonId(req)
  });
  res.status(201).json(assignment);
}));

router.post(
  '/:personId/role-assignments/:assignmentId/revoke',
  ...canAssignRole,
  (req, res) => run(res, async () => {
    const repo = await repository();
    const body = req.body || {};
    res.json(await repo.revokeRole(
      Number(req.params.personId),
      Number(req.params.assignmentId),
      {
        reason: body.reason,
        disableAccount: Boolean(body.disableAccount),
        actorPersonId: actorPersonId(req)
      }
    ));
  })
);

router.post('/:personId/activate', ...canManageAccount, (req, res) => run(res, async () => {
  const initialPassword = generateInitialPassword();
  const repo = await repository();
  const body = req.body || {};
  const account = await repo.activateAccount(Number(req.params.personId), {
    passwordHash: hashPassword(initialPassword),
    reason: body.reason,
    actorPersonId: actorPersonId(req)
  });
  res.json({ account, initialPassword });
}));

router.post('/:personId/enable', ...canManageAccount, (req, res) => run(res, async () => {
  const repo = await repository();
  const body = req.body || {};
  res.json(await repo.enableAccount(Number(req.params.personId), {
    reason: body.reason,
    actorPersonId: actorPersonId(req)
  }));
}));

router.post('/:personId/disable', ...canManageAccount, (req, res) => run(res, async () => {
  const repo = await repository();
  const body = req.body || {};
  res.json(await repo.disableAccount(Number(req.params.personId), {
    reason: body.reason,
    actorPersonId: actorPersonId(req)
  }));
}));

router.post('/:personId/reset-password', ...canManageAccount, (req, res) => run(res, async () => {
  const initialPassword = generateInitialPassword();
  const repo = await repository();
  const body = req.body || {};
  const account = await repo.resetPassword(Number(req.params.personId), {
    passwordHash: hashPassword(initialPassword),
    reason: body.reason,
    actorPersonId: actorPersonId(req)
  });
  res.json({ account, initialPassword });
}));

router.setRepositoryFactory = factory => {
  repositoryFactory = factory;
  repositoryPromise = null;
};
router.resetRepositoryFactory = () => {
  repositoryFactory = null;
  repositoryPromise = null;
};

module.exports = router;
