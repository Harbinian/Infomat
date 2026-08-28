const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
const {
  getDepartmentByIdAsync,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync,
  requireAuth
} = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const { makeProcessDataGovernanceRepository } = require('../processDataGovernanceRepository');
const {
  assertProcessDataGovernanceEnabled,
  assertProcessVersionAllowed,
  configuredProcessVersionId,
  featureStatus
} = require('../processDataGovernanceScope');

let repositoryFactory = null;
let repositoryPromise = null;
let actorFactory = null;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function httpError(statusCode, code, message, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.payload = { error: message, code, ...extra };
  return error;
}

function runAction(res, action) {
  return action().catch(error => {
    if (error && (error.statusCode || error.payload)) {
      return res.status(error.statusCode || 400).json(error.payload || { error: error.message, code: error.code });
    }
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  });
}

async function getProcessDataGovernanceRepository() {
  if (repositoryFactory) return await repositoryFactory();
  if (!repositoryPromise) {
    repositoryPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      return makeProcessDataGovernanceRepository(pool);
    })();
  }
  try {
    return await repositoryPromise;
  } catch (error) {
    repositoryPromise = null;
    throw error;
  }
}

function setProcessDataGovernanceRepositoryFactory(factory) {
  repositoryFactory = factory;
  repositoryPromise = null;
}

function resetProcessDataGovernanceRepositoryFactory() {
  repositoryFactory = null;
  repositoryPromise = null;
}

function setProcessDataGovernanceActorFactory(factory) {
  actorFactory = factory;
}

function resetProcessDataGovernanceActorFactory() {
  actorFactory = null;
}

async function currentActor(req) {
  if (actorFactory) return await actorFactory(req);
  const personId = Number(req.session.personId || req.session.userId || 0);
  const userId = Number(req.session.userId || personId || 0);
  const roleRows = await getUserRoleCodesAsync(personId, req.session.role);
  const roleCodes = new Set((Array.isArray(roleRows) ? roleRows : []).map(item => text(item && (item.code || item.role_code))).filter(Boolean));
  const permissionResult = await getUserEffectivePermissionsAsync(personId);
  const permissions = permissionResult && permissionResult.permSet || new Set();
  const department = req.session.departmentId ? await getDepartmentByIdAsync(Number(req.session.departmentId)) : null;
  const roleCode = roleCodes.has('mdm_lead') ? 'mdm_lead'
    : roleCodes.has('data_quality_auditor') ? 'data_quality_auditor'
      : roleCodes.has('department_mdm_reviewer') ? 'department_mdm_reviewer'
        : roleCodes.has('department_contact') ? 'department_contact'
          : roleCodes.has('admin') ? 'admin' : null;
  return {
    userId,
    personId,
    departmentId: department ? Number(department.id || department.department_id) : null,
    departmentName: department ? text(department.name || department.department_name) : '',
    roleCodes,
    permissions,
    roleCode,
    canReadGlobal: permissions.has('governance:read-global')
  };
}

function normalizeActor(actor) {
  return {
    ...actor,
    roleCodes: actor.roleCodes instanceof Set ? actor.roleCodes : new Set(actor.roleCodes || []),
    permissions: actor.permissions instanceof Set ? actor.permissions : new Set(actor.permissions || [])
  };
}

function assertCanRead(actor) {
  if ([
    'governance:read-global',
    'governance:read-department',
    'governance:read-assigned-context'
  ].some(permission => actor.permissions.has(permission))) return;
  throw httpError(403, 'PROCESS_DATA_GOVERNANCE_READ_DENIED', '无权查看数据生命周期治理工作包');
}

function assertAdminCannotWrite(actor) {
  if (actor.roleCodes.has('admin')) {
    throw httpError(403, 'PROCESS_DATA_GOVERNANCE_ADMIN_READ_ONLY', '管理员对治理材料只读，不能执行数据生命周期治理写操作');
  }
}

function assertMdmGovernanceWrite(actor) {
  assertAdminCannotWrite(actor);
  if (
    actor.roleCodes.has('mdm_lead') &&
    actor.permissions.has('governance:assign-work') &&
    actor.permissions.has('governance:structure-gate')
  ) return;
  throw httpError(403, 'PROCESS_DATA_GOVERNANCE_MDM_ONLY', '数据对象归类、匹配、关键字段和生命周期规则只能由MDM工作组处理');
}

function assertBusinessFactWrite(actor) {
  assertAdminCannotWrite(actor);
  if (
    actor.departmentId &&
    (
      (actor.roleCodes.has('department_contact') && actor.permissions.has('governance:draft-department')) ||
      (actor.roleCodes.has('department_mdm_reviewer') && actor.permissions.has('governance:review-department'))
    )
  ) return;
  throw httpError(403, 'PROCESS_DATA_GOVERNANCE_FACT_RESPONSE_DENIED', '只有问题指定部门的主对接人或部门MDM审核员可以答复业务事实');
}

function expectedRevision(body) {
  const value = Number(body && body.expected_revision);
  if (!Number.isInteger(value) || value < 1) {
    throw httpError(422, 'PROCESS_DATA_GOVERNANCE_EXPECTED_REVISION_REQUIRED', '必须提供当前工作包修订号');
  }
  return value;
}

function allowedActions(actor, detail = null) {
  const actions = ['view'];
  if (actor.roleCodes.has('admin')) return actions;
  if (
    actor.roleCodes.has('mdm_lead') &&
    actor.permissions.has('governance:assign-work') &&
    actor.permissions.has('governance:structure-gate')
  ) {
    actions.push('reconcile', 'generate_candidates', 'decide_detail', 'request_business_fact', 'close_business_fact', 'complete_work_package');
  }
  if (detail && actor.departmentId) {
    const canAnswer = (detail.fact_requests || []).some(item =>
      item.status === 'open' && Number(item.target_department_id) === Number(actor.departmentId)
    );
    if (canAnswer && (actor.roleCodes.has('department_contact') || actor.roleCodes.has('department_mdm_reviewer'))) {
      actions.push('answer_targeted_business_fact');
    }
  }
  return actions;
}

function responsibilities() {
  return {
    business_department: {
      label: '业务部门',
      can: ['回答MDM定向提出的流程事实问题', '提供制度、表单或台账依据', '指出问题不适用并说明理由'],
      cannot: ['认定主数据', '合并统一数据对象', '决定关键字段', '制定生命周期规则', '发布数据地图']
    },
    mdm_workgroup: {
      label: 'MDM工作组',
      owns: ['生成可解释的待定候选', '认定数据对象和主数据', '确认统一对象匹配', '判定关键字段', '形成生命周期规则', '处理跨流程冲突', '完成工作包审核']
    },
    automatic_processing: {
      ai_used: false,
      automatic_confirmation: false,
      rule: '系统只按固定规则生成待定候选，所有治理结论均需MDM工作组记录依据'
    }
  };
}

async function assertPackageInTrialScope(repo, packageId) {
  const detail = await repo.getWorkPackageDetail(Number(packageId));
  if (!detail) throw httpError(404, 'PROCESS_DATA_GOVERNANCE_PACKAGE_NOT_FOUND', '数据生命周期治理工作包不存在');
  assertProcessVersionAllowed(detail.package.process_version_id);
  return detail;
}

async function assertFactRequestInTrialScope(repo, requestId) {
  const fact = await repo.getFactRequest(Number(requestId));
  if (!fact) throw httpError(404, 'PROCESS_DATA_GOVERNANCE_FACT_NOT_FOUND', '业务事实问题不存在');
  assertProcessVersionAllowed(Number(fact.process_version_id));
  return fact;
}

router.get('/status', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const actor = normalizeActor(await currentActor(req));
    assertCanRead(actor);
    res.json({ ...featureStatus(), responsibilities: responsibilities() });
  });
});

router.use(requireAuth, (req, res, next) => {
  try {
    assertProcessDataGovernanceEnabled();
    const versionId = configuredProcessVersionId();
    assertProcessVersionAllowed(versionId);
    req.processDataGovernanceVersionId = versionId;
    next();
  } catch (error) {
    res.status(error.statusCode || 503).json(error.payload || { error: error.message, code: error.code });
  }
});

router.get('/workbench', (req, res) => runAction(res, async () => {
  const actor = normalizeActor(await currentActor(req));
  assertCanRead(actor);
  const repo = await getProcessDataGovernanceRepository();
  const packages = actor.canReadGlobal ? await repo.listWorkPackages(req.processDataGovernanceVersionId) : [];
  const factRequests = actor.departmentId
    ? await repo.listBusinessFactRequests(actor.departmentId, req.processDataGovernanceVersionId, { all: req.query.mode === 'all' })
    : [];
  const workItems = await repo.listWorkbenchItems(actor, req.processDataGovernanceVersionId);
  res.json({
    feature: featureStatus(),
    responsibilities: responsibilities(),
    allowed_actions: allowedActions(actor),
    summary: {
      work_packages: packages.length,
      my_open_fact_requests: factRequests.filter(item => item.status === 'open').length,
      my_action_items: workItems.length
    },
    work_packages: packages,
    fact_requests: factRequests,
    work_items: workItems
  });
}));

router.post('/creation-tasks/reconcile', (req, res) => runAction(res, async () => {
  const actor = normalizeActor(await currentActor(req));
  assertMdmGovernanceWrite(actor);
  const processVersionId = Number(req.body && req.body.process_version_id);
  assertProcessVersionAllowed(processVersionId);
  const repo = await getProcessDataGovernanceRepository();
  res.status(201).json(await repo.queueAndMaterialize(processVersionId, actor));
}));

router.get('/work-packages/:id', (req, res) => runAction(res, async () => {
  const actor = normalizeActor(await currentActor(req));
  assertCanRead(actor);
  if (!actor.canReadGlobal) {
    throw httpError(403, 'PROCESS_DATA_GOVERNANCE_PACKAGE_MDM_CONTEXT_ONLY', '业务部门只查看发给本部门的具体事实问题，不查看MDM治理工作包全量内容');
  }
  const repo = await getProcessDataGovernanceRepository();
  const detail = await repo.getWorkPackageDetail(Number(req.params.id));
  if (!detail) throw httpError(404, 'PROCESS_DATA_GOVERNANCE_PACKAGE_NOT_FOUND', '数据生命周期治理工作包不存在');
  assertProcessVersionAllowed(detail.package.process_version_id);
  res.json({ ...detail, responsibilities: responsibilities(), allowed_actions: allowedActions(actor, detail) });
}));

router.get('/fact-requests/:id', (req, res) => runAction(res, async () => {
  const actor = normalizeActor(await currentActor(req));
  assertCanRead(actor);
  const repo = await getProcessDataGovernanceRepository();
  const context = await repo.getFactRequestContext(Number(req.params.id));
  if (!context) throw httpError(404, 'PROCESS_DATA_GOVERNANCE_FACT_NOT_FOUND', '业务事实问题不存在');
  const fact = context.fact_request;
  assertProcessVersionAllowed(Number(fact.process_version_id));
  if (!actor.canReadGlobal && Number(actor.departmentId) !== Number(fact.target_department_id)) {
    throw httpError(403, 'PROCESS_DATA_GOVERNANCE_FACT_DEPARTMENT_DENIED', '该事实问题不是发给本人所属部门的');
  }
  res.json({
    package: context.package,
    source_version: context.source_version,
    fact_request: fact,
    source_context: context.source_context,
    responsibilities: responsibilities(),
    allowed_actions: allowedActions(actor, { fact_requests: [fact] })
  });
}));

router.post('/work-packages/:id/generate-candidates', (req, res) => runAction(res, async () => {
  const actor = normalizeActor(await currentActor(req));
  assertMdmGovernanceWrite(actor);
  const repo = await getProcessDataGovernanceRepository();
  await assertPackageInTrialScope(repo, req.params.id);
  const result = await repo.generateCandidates(Number(req.params.id), expectedRevision(req.body), actor);
  res.json(result);
}));

router.patch('/work-packages/:id/details/:detailId', (req, res) => runAction(res, async () => {
  const actor = normalizeActor(await currentActor(req));
  assertMdmGovernanceWrite(actor);
  const repo = await getProcessDataGovernanceRepository();
  await assertPackageInTrialScope(repo, req.params.id);
  const result = await repo.updateDetail(
    Number(req.params.id),
    Number(req.params.detailId),
    expectedRevision(req.body),
    req.body || {},
    actor
  );
  res.json(result);
}));

router.post('/work-packages/:id/fact-requests', (req, res) => runAction(res, async () => {
  const actor = normalizeActor(await currentActor(req));
  assertMdmGovernanceWrite(actor);
  const repo = await getProcessDataGovernanceRepository();
  await assertPackageInTrialScope(repo, req.params.id);
  const result = await repo.createFactRequest(Number(req.params.id), expectedRevision(req.body), req.body || {}, actor);
  res.status(201).json(result);
}));

router.post('/fact-requests/:id/respond', (req, res) => runAction(res, async () => {
  const actor = normalizeActor(await currentActor(req));
  assertBusinessFactWrite(actor);
  const repo = await getProcessDataGovernanceRepository();
  await assertFactRequestInTrialScope(repo, req.params.id);
  const result = await repo.respondFactRequest(Number(req.params.id), expectedRevision(req.body), req.body || {}, actor);
  res.json(result);
}));

router.post('/fact-requests/:id/close', (req, res) => runAction(res, async () => {
  const actor = normalizeActor(await currentActor(req));
  assertMdmGovernanceWrite(actor);
  const repo = await getProcessDataGovernanceRepository();
  await assertFactRequestInTrialScope(repo, req.params.id);
  const result = await repo.closeFactRequest(Number(req.params.id), expectedRevision(req.body), req.body || {}, actor);
  res.json(result);
}));

router.post('/work-packages/:id/complete', (req, res) => runAction(res, async () => {
  const actor = normalizeActor(await currentActor(req));
  assertMdmGovernanceWrite(actor);
  if (!actor.permissions.has('governance:publish')) {
    throw httpError(403, 'PROCESS_DATA_GOVERNANCE_COMPLETE_DENIED', '只有具备发布职责的MDM工作组组长可以完成工作包审核');
  }
  const repo = await getProcessDataGovernanceRepository();
  await assertPackageInTrialScope(repo, req.params.id);
  const result = await repo.completeWorkPackage(Number(req.params.id), expectedRevision(req.body), req.body && req.body.basis, actor);
  res.json(result);
}));

router.getProcessDataGovernanceRepository = getProcessDataGovernanceRepository;
router.setProcessDataGovernanceRepositoryFactory = setProcessDataGovernanceRepositoryFactory;
router.resetProcessDataGovernanceRepositoryFactory = resetProcessDataGovernanceRepositoryFactory;
router.setProcessDataGovernanceActorFactory = setProcessDataGovernanceActorFactory;
router.resetProcessDataGovernanceActorFactory = resetProcessDataGovernanceActorFactory;
router.responsibilities = responsibilities;

module.exports = router;
