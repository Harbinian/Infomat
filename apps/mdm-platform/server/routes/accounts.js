const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2/promise');
const { hashPassword, requireAuth, requirePermission } = require('../auth');
const { makeGovernanceAccessMysqlRepository } = require('../governanceAccessMysqlRepository');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const { generateInitialPassword } = require('../passwordPolicy');
const { employeeLoginName, accountInitialPassword } = require('../accountCreationPolicy');
const { identityInteger, sessionSubject } = require('../sessionSubject');
const { maintenanceRequestContext } = require('../accountMaintenanceAuthority');
const { logRequestFailure, safeErrorCode } = require('../securityLog');
const { createRegisteredPool } = require('../mysqlPoolRegistry');

const router = express.Router();
let repositoryPromise = null;
let repositoryFactory = null;

async function repository(req, maintenance = false) {
  if (repositoryFactory) {
    const repo = await repositoryFactory();
    if (req && req.identity && req.identity.identityKind === 'system_admin') return repo.forSystemAdmin(req.identity);
    return maintenance ? repo.forPersonMaintenance(maintenanceRequestContext(req)) : repo;
  }
  if (!repositoryPromise) {
    repositoryPromise = (async () => {
      const pool = createRegisteredPool(process.env, 'governanceAccess');
      return makeGovernanceAccessMysqlRepository(pool);
    })();
  }
  try {
    const repo = await repositoryPromise;
    if (req && req.identity && req.identity.identityKind === 'system_admin') return repo.forSystemAdmin(req.identity);
    return maintenance ? repo.forPersonMaintenance(maintenanceRequestContext(req)) : repo;
  } catch (error) {
    repositoryPromise = null;
    throw error;
  }
}

function actorPersonId(req) {
  const actor = sessionSubject(req.session, req.identity);
  if (actor.kind === 'system_admin') return null;
  // Validation belongs to the repository; pass an invalid supplied identity
  // through so it cannot silently become an anonymous audit actor.
  return identityInteger(actor.personId) ?? actor.personId;
}

function handleError(res, error) {
  if (error && error.accountMaintenanceResponse) {
    return res.status(error.statusCode).json(error.accountMaintenanceResponse);
  }
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
  logRequestFailure(res, error, { status: 503, code: safeErrorCode(error) || 'IDENTITY_ACCESS_SERVICE_UNAVAILABLE' });
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
  const repo = await repository(req);
  res.json(await repo.listAccounts());
}));

router.get('/audit-events', ...canReadAudit, (req, res) => run(res, async () => {
  const repo = await repository(req);
  res.json(await repo.listAccessEvents({
    personId: req.query.personId ? identityInteger(req.query.personId) ?? req.query.personId : null,
    eventType: req.query.eventType || null,
    limit: req.query.limit ? Number(req.query.limit) : 100
  }));
}));

router.get('/:personId', ...canReadIdentity, (req, res) => run(res, async () => {
  const repo = await repository(req);
  const account = await repo.getAccount(identityInteger(req.params.personId));
  if (!account) return res.status(404).json({ error: '账号不存在', code: 'ACCOUNT_NOT_FOUND' });
  res.json(account);
}));

router.post('/', ...canManageAccount, requirePermission('identity:assign-role'), (req, res) => run(res, async () => {
  const repo = await repository(req, true);
  const body = req.body || {};
  const pendingCredential = crypto.randomBytes(48).toString('base64url');
  const account = await repo.createAccount({
    loginName: employeeLoginName(body.employeeNo, body.loginName),
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

router.post('/:personId/assign-account', ...canManageAccount, (req, res) => run(res, async () => {
  const repo = await repository(req, true);
  const body = req.body || {};
  const pendingCredential = crypto.randomBytes(48).toString('base64url');
  const account = await repo.assignAccount(identityInteger(req.params.personId), {
    expectedPerson: body.expectedPerson,
    reason: body.reason,
    pendingPasswordHash: hashPassword(pendingCredential),
    actorPersonId: actorPersonId(req)
  });
  res.status(201).json(account);
}));

router.patch('/:personId', ...canManageAccount, (req, res) => run(res, async () => {
  const repo = await repository(req, true);
  const body = req.body || {};
  const account = await repo.updateAccount(identityInteger(req.params.personId), {
    ...(Object.prototype.hasOwnProperty.call(body, 'name') ? { name: body.name } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'employeeNo') ? { employeeNo: body.employeeNo } : {}),
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
  const repo = await repository(req, true);
  const body = req.body || {};
  const assignment = await repo.grantRole(identityInteger(req.params.personId), {
    roleCode: body.roleCode,
    scopeDepartmentId: body.scopeDepartmentId,
    authorizationBasis: body.authorizationBasis,
    effectiveFrom: body.effectiveFrom,
    effectiveTo: body.effectiveTo,
    ...(Object.prototype.hasOwnProperty.call(body, 'expectedFinalResponsiblePersonId') ? { expectedFinalResponsiblePersonId: body.expectedFinalResponsiblePersonId } : {}),
    confirmReplaceFinalResponsiblePerson: body.confirmReplaceFinalResponsiblePerson,
    actorPersonId: actorPersonId(req)
  });
  res.status(201).json(assignment);
}));

router.post(
  '/:personId/role-assignments/:assignmentId/revoke',
  ...canAssignRole,
  (req, res) => run(res, async () => {
    const repo = await repository(req, true);
    const body = req.body || {};
    res.json(await repo.revokeRole(
      identityInteger(req.params.personId),
      identityInteger(req.params.assignmentId),
      {
        reason: body.reason,
        disableAccount: Boolean(body.disableAccount),
        actorPersonId: actorPersonId(req)
      }
    ));
  })
);

router.post('/:personId/activate', ...canManageAccount, (req, res) => run(res, async () => {
  const initialPassword = accountInitialPassword();
  const repo = await repository(req, true);
  const body = req.body || {};
  const account = await repo.activateAccount(identityInteger(req.params.personId), {
    passwordHash: hashPassword(initialPassword),
    reason: body.reason,
    actorPersonId: actorPersonId(req)
  });
  res.json({ account, initialPassword });
}));

router.post('/:personId/enable', ...canManageAccount, (req, res) => run(res, async () => {
  const repo = await repository(req, true);
  const body = req.body || {};
  res.json(await repo.enableAccount(identityInteger(req.params.personId), {
    reason: body.reason,
    actorPersonId: actorPersonId(req)
  }));
}));

router.post('/:personId/disable', ...canManageAccount, (req, res) => run(res, async () => {
  const repo = await repository(req, true);
  const body = req.body || {};
  res.json(await repo.disableAccount(identityInteger(req.params.personId), {
    reason: body.reason,
    actorPersonId: actorPersonId(req)
  }));
}));

router.post('/:personId/reset-password', ...canManageAccount, (req, res) => run(res, async () => {
  const initialPassword = generateInitialPassword();
  const repo = await repository(req, true);
  const body = req.body || {};
  const account = await repo.resetPassword(identityInteger(req.params.personId), {
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
