const express = require('express');
const mysql = require('mysql2/promise');
const { requireAuth, requireAnyPermission, requirePermission } = require('../auth');
const { makeGovernanceAccessMysqlRepository } = require('../governanceAccessMysqlRepository');
const { mysqlConfigFromEnv } = require('../mysqlConfig');

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

function handleError(res, error) {
  if (error && error.statusCode) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code || 'GOVERNANCE_DECISION_FAILED',
      ...(error.details !== undefined ? { details: error.details } : {})
    });
  }
  console.error(error);
  return res.status(503).json({
    error: '治理责任记录服务暂不可用',
    code: 'GOVERNANCE_DECISION_SERVICE_UNAVAILABLE'
  });
}

function run(res, action) {
  return Promise.resolve().then(action).catch(error => handleError(res, error));
}

router.get(
  '/decision-records',
  requireAuth,
  requireAnyPermission(
    'governance:read-global',
    'governance:read-department'
  ),
  (req, res) => run(res, async () => {
    const repo = await repository();
    const requestedDepartmentId = req.query.departmentId ? Number(req.query.departmentId) : null;
    const permissions = req.effectivePermissions || new Set();
    const canReadGlobal = permissions.has('governance:read-global');
    const departmentId = canReadGlobal
      ? requestedDepartmentId
      : Number(req.session.departmentId || 0) || null;
    if (!canReadGlobal && !departmentId) {
      return res.status(403).json({ error: '当前账号没有可读取的部门责任范围' });
    }
    res.json(await repo.listGovernanceDecisions({
      subjectDomain: req.query.subjectDomain,
      subjectType: req.query.subjectType,
      subjectId: req.query.subjectId,
      subjectVersion: req.query.subjectVersion,
      departmentId
    }));
  })
);

router.post(
  '/decision-records',
  requireAuth,
  requirePermission('governance:record-department-decision'),
  (req, res) => run(res, async () => {
    const repo = await repository();
    const body = req.body || {};
    const record = await repo.recordGovernanceDecision({
      recorderPersonId: Number(req.session.personId || 0),
      departmentId: body.departmentId,
      subjectDomain: body.subjectDomain,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      subjectVersion: body.subjectVersion,
      decision: body.decision,
      decisionBasis: body.decisionBasis,
      evidenceReference: body.evidenceReference,
      decidedAt: body.decidedAt
    });
    res.status(201).json(record);
  })
);

router.setRepositoryFactory = factory => {
  repositoryFactory = factory;
  repositoryPromise = null;
};
router.resetRepositoryFactory = () => {
  repositoryFactory = null;
  repositoryPromise = null;
};

module.exports = router;
