let processGovernanceRepoPromise = null;
let processGovernanceRepositoryFactory = null;
let inputBaselineReviewRepoPromise = null;
let inputBaselineReviewRepositoryFactory = null;
let processContextBundleCache = null;

const { checkRuntimeSchema, sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const mysql = require('mysql2/promise');
const { logRequestFailure, securityLog } = require('../securityLog');
const { createRegisteredPool } = require('../mysqlPoolRegistry');
const router = express.Router();
function legacyDb() { return require('../db'); }
const { requireAuth, getUserEffectivePermissions } = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const { makeIdentityMysqlRepository } = require('../identityMysqlRepository');
const { sessionSubject, identityInteger } = require('../sessionSubject');


const { ROLE_GUIDES } = require('../roleDefinitions');
const {
  isProcessDataGovernanceEnabled
} = require('../processDataGovernanceScope');

let identityRepoPromise = null;
let identityRepositoryFactory = null;

let processDataGovernanceRepositoryFactory = null;
let handoffWorkbenchFactory = null;
let processDisputeWorkbenchFactory = null;
let qualityAuditWorkbenchFactory = null;
let assignedCaseWorkRepositoryFactory = null, assignedCaseWorkRepository = null;
let legacyConflictRecheckRepositoryFactory = null;
const WORKBENCH_CACHE_TTL_MS = 15 * 1000;
const roleGroupsCache = new Map();
const workbenchResponseCache = new Map();

const GOVERNANCE_TYPE_BY_TODO_TYPE = {
  field_confirm: 'field_ledger_gap',
  gold_source: 'gold_source_confirmation',
  terminology: 'input_baseline_issue',
  conflict_resolution: 'process_quality',
  process_quality: 'process_quality',
  process_mapping_todo: 'input_baseline_issue',
  input_baseline_issue: 'input_baseline_issue',
  pmo_review_gate: 'pmo_review_gate'
};

function runAsyncAction(res, action, unavailableMessage) {
  return action().catch(error => {
    // Dependency errors also carry statusCode; classify them before the
    // application-status branch so driver messages never reach the response.
    if (sendMysqlUnavailable(res, error)) return;
    if (error && error.statusCode) {
      return res.status(error.statusCode).json(error.payload || { error: error.message, ...(error.code ? {code:error.code} : {}) });
    }
    logRequestFailure(res, error);
    return res.status(unavailableMessage ? 503 : 500).json({ error: unavailableMessage || '服务器错误' });
  });
}

function useMysqlIdentityReadModel() {
  return String(process.env.MDM_IDENTITY_READ_MODEL || '').toLowerCase() === 'mysql';
}

function useMysqlProcessGovernanceReadModel() {
  return String(process.env.PROCESS_GOVERNANCE_READ_MODEL || '').toLowerCase() === 'mysql';
}

async function identityRepository() {
  if (identityRepositoryFactory) {
    return await identityRepositoryFactory();
  }
  if (!identityRepoPromise) {
    identityRepoPromise = (async () => {
      const pool = createRegisteredPool(process.env, 'identity');
      const repo = makeIdentityMysqlRepository(pool);
      await checkRuntimeSchema(pool, 'identity');
      return repo;
    })();
  }
  try {
    return await identityRepoPromise;
  } catch (error) {
    identityRepoPromise = null;
    throw error;
  }
}

function setIdentityRepositoryFactory(factory) {
  identityRepositoryFactory = factory;
  identityRepoPromise = null;
}

function resetIdentityRepositoryFactory() {
  identityRepositoryFactory = null;
  identityRepoPromise = null;
}

function setProcessGovernanceRepositoryFactory(factory) {
  processGovernanceRepositoryFactory = factory;
  processGovernanceRepoPromise = null;
}

function resetProcessGovernanceRepositoryFactory() {
  processGovernanceRepositoryFactory = null;
  processGovernanceRepoPromise = null;
}

function setInputBaselineReviewRepositoryFactory(factory) {
  inputBaselineReviewRepositoryFactory = factory;
  inputBaselineReviewRepoPromise = null;
}

function resetInputBaselineReviewRepositoryFactory() {
  inputBaselineReviewRepositoryFactory = null;
  inputBaselineReviewRepoPromise = null;
}

function getCurrentRoles(userId, legacyRole) {
  const roles = legacyDb().prepare(`
    SELECT r.role_code as code, r.role_name as name
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.role_id
    WHERE ur.user_id=?
    ORDER BY r.is_system DESC, r.role_code
  `).all(userId);

  if (legacyRole && !roles.some(role => role.code === legacyRole)) {
    const legacy = legacyDb().prepare('SELECT role_code as code, role_name as name FROM roles WHERE role_code=?').get(legacyRole);
    if (legacy) roles.unshift(legacy);
  }

  return roles;
}

function sqliteWorkbenchIdentity(req) {
  const currentRoles = getCurrentRoles(req.session.userId, req.session.userRole);
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  const department = req.session.departmentId
    ? legacyDb().prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId)
    : null;
  return {
    currentRoles,
    roleCodes: currentRoles.map(role => role.code),
    permSet,
    user: {
      id: req.session.userId,
      name: req.session.userName,
      role: req.session.userRole,
      departmentId: req.session.departmentId,
      departmentName: department && department.name || null,
      personId: req.session.personId || req.session.userId
    }
  };
}

async function mysqlWorkbenchIdentity(req) {
  const repo = await identityRepository();
  const payload = await repo.getCurrentUserPayload(req.session);
  if (!payload) {
    const error = new Error('用户不存在');
    error.statusCode = 401;
    throw error;
  }

  let permSet = new Set(Array.isArray(payload.permissions) ? payload.permissions : []);
  if (permSet.size === 0 && typeof repo.getUserEffectivePermissions === 'function') {
    const effective = await repo.getUserEffectivePermissions(payload.id || req.session.userId);
    permSet = effective && effective.permSet || permSet;
  }

  const currentRoles = Array.isArray(payload.rbacRoles)
    ? payload.rbacRoles.map(role => ({ code: role.code, name: role.name }))
    : [];
  const roleCodes = Array.isArray(payload.roleCodes) && payload.roleCodes.length
    ? payload.roleCodes
    : currentRoles.map(role => role.code);

  return {
    currentRoles,
    roleCodes,
    permSet,
    user: {
      id: payload.id || req.session.userId,
      name: payload.name || req.session.userName,
      role: payload.role || req.session.userRole,
      departmentId: payload.departmentId || req.session.departmentId || null,
      departmentName: payload.departmentName || null,
      personId: payload.personId || req.session.personId || payload.id || req.session.userId
    }
  };
}

async function workbenchIdentity(req) {
  if (useMysqlIdentityReadModel()) return await mysqlWorkbenchIdentity(req);
  return sqliteWorkbenchIdentity(req);
}

function buildRoleGroups(roleCodes) {
  const owned = new Set(roleCodes);
  const roles = ROLE_GUIDES.map(role => ({
    code: role.code,
    name: role.name,
    group: role.group,
    description: role.description,
    goal: role.goal,
    firstEntry: role.firstEntry,
    workflow: role.workflow,
    sample: role.sample,
    pitfall: role.pitfall,
    doneCriteria: role.doneCriteria,
    owned: owned.has(role.code)
  }));

  return {
    roles,
    roleGroups: [
      { key: 'system', label: '系统管理角色', roles: roles.filter(role => role.group === 'system') },
      { key: 'directory', label: '组织与人员维护角色', roles: roles.filter(role => role.group === 'directory') },
      { key: 'mdm', label: 'MDM工作角色', roles: roles.filter(role => role.group === 'mdm') }
    ]
  };
}

function buildRoleGroupsCached(roleCodes) {
  const key = [...new Set(roleCodes || [])].sort().join('|');
  const cached = roleGroupsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = buildRoleGroups(roleCodes);
  roleGroupsCache.set(key, { value, expiresAt: Date.now() + WORKBENCH_CACHE_TTL_MS });
  return value;
}

function cachePart(value) {
  if (Array.isArray(value)) return value.map(cachePart).join(',');
  if (value instanceof Set) return Array.from(value).sort().join(',');
  return String(value == null ? '' : value);
}

async function getOrBuildWorkbenchResponse(cacheKey, build) {
  // Current decisions/revisions must disappear or reopen on the next workbench read.
  // Keep the fixed role-guide cache, but never cache mutable MySQL task projections.
  if (useMysqlProcessGovernanceReadModel()) return await build();
  const now = Date.now();
  const cached = workbenchResponseCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    if (cached.value) return cached.value;
    if (cached.promise) return await cached.promise;
  }

  const pending = {
    expiresAt: now + WORKBENCH_CACHE_TTL_MS,
    promise: Promise.resolve().then(build)
  };
  workbenchResponseCache.set(cacheKey, pending);

  try {
    const value = await pending.promise;
    workbenchResponseCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + WORKBENCH_CACHE_TTL_MS
    });
    return value;
  } catch (error) {
    if (workbenchResponseCache.get(cacheKey) === pending) workbenchResponseCache.delete(cacheKey);
    throw error;
  }
}

function workbenchResponseCacheKey({ mode, identity, roleCodes, permSet }) {
  return [
    mode,
    identity.user.id,
    identity.user.departmentId,
    identity.user.role,
    cachePart(roleCodes),
    cachePart(permSet)
  ].map(cachePart).join('|');
}

function clearWorkbenchCaches() {
  roleGroupsCache.clear();
  workbenchResponseCache.clear();
  processContextBundleCache = null;
}

function isPastDue(dueDate) {
  if (!dueDate) return false;
  const parsed = new Date(`${String(dueDate).slice(0, 10)}T23:59:59+08:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now();
}

function governanceTypeForItem(item) {
  return item.governanceType || GOVERNANCE_TYPE_BY_TODO_TYPE[item.type] || item.type || 'general';
}

function fallbackConfirmPerson(departmentName) {
  return departmentName ? '责任人信息未随事项返回' : '责任部门未明确';
}

function normalizeWorkItem(item, defaults = {}) {
  const governanceType = governanceTypeForItem(item);
  const department = item.department || item.targetDept || item.ownerDept || defaults.department || null;
  const responsiblePerson = item.responsiblePerson || item.owner || item.ownerName || defaults.responsiblePerson || fallbackConfirmPerson(department);
  const confirmPerson = item.confirmPerson || item.reviewer || defaults.confirmPerson || responsiblePerson;
  const currentStatus = item.currentStatus || item.status || defaults.currentStatus || 'pending';
  const nextStep = item.nextStep || item.actionLabel || defaults.nextStep || '处理事项';
  return {
    ...item,
    governanceType,
    sourceType: item.sourceType || governanceType,
    department,
    responsiblePerson,
    confirmPerson,
    currentStatus,
    nextStep,
    overdue: item.overdue == null ? isPastDue(item.dueDate) : Boolean(item.overdue)
  };
}

function normalizeWorkItems(items, defaults = {}) {
  return items.map(item => normalizeWorkItem(item, defaults));
}

function fallbackActions(ownedRoles) {
  return ownedRoles.slice(0, 3).map(role => ({
    title: `${role.name}：${role.workflow[0]}`,
    roleCode: role.code,
    target: role.firstEntry.target,
    actionLabel: role.firstEntry.label,
    sample: role.sample,
    priority: 'normal'
  }));
}

function guidanceItemsForRoles(ownedRoles) {
  return ownedRoles.map(role => normalizeWorkItem({
    id: `guide:${role.code}`,
    type: 'guidance',
    title: `${role.name}：${role.workflow[0] || role.firstEntry.label}`,
    roleHint: role.code,
    target: role.firstEntry.target,
    actionLabel: role.firstEntry.label,
    sample: role.sample,
    urgency: 'normal',
    governanceType: 'role_guidance',
    sourceType: 'role_guidance',
    department: null,
    responsiblePerson: '当前用户',
    confirmPerson: '当前用户',
    currentStatus: 'guidance',
    nextStep: role.firstEntry.label
  }));
}

function buildNextActions(workItems, ownedRoles) {
  const actionItems = workItems.slice(0, 3).map(item => ({
    title: item.type === 'escalated_conflict' ? `处理升级/终裁事项：${item.title}` : item.title,
    roleCode: item.roleHint,
    target: item.target,
    actionLabel: item.actionLabel,
    sample: item.sample,
    ...(item.handlingGuide ? { handlingGuide: item.handlingGuide } : {}),
    sourceRoles: item.sourceRoles || [item.roleHint].filter(Boolean),
    requiredPermissions: item.requiredPermissions || [],
    priority: item.urgency || 'medium'
  }));
  return actionItems.length ? actionItems : fallbackActions(ownedRoles);
}

function canActOnWorkbenchItem(item, permSet) {
  if (typeof item.canAct === 'boolean') return item.canAct;
  const type = item && item.type;
  if (type === 'escalated_conflict') return permSet.has('governance:decide-escalation');
  if (type === 'conflict_resolution') return permSet.has('governance:handle-assigned-conflict');
  if (type === 'process_quality') {
    return permSet.has('governance:quality-audit') ||
      permSet.has('governance:structure-gate') ||
      permSet.has('governance:draft-department');
  }
  if (type === 'input_baseline_issue') {
    return permSet.has('governance:structure-gate') ||
      permSet.has('governance:review-department') ||
      permSet.has('governance:draft-department');
  }
  if (type === 'process_mapping_todo' || type === 'pmo_review_gate') {
    return permSet.has('governance:assign-work') ||
      permSet.has('governance:structure-gate') ||
      permSet.has('governance:review-department') ||
      permSet.has('governance:draft-department');
  }
  return permSet.has('governance:assign-work') ||
    permSet.has('governance:review-department') ||
    permSet.has('governance:draft-department');
}

function buildSankey(activeRoles, contexts, workItems) {
  const nodes = new Map();
  const links = new Map();

  function addNode(node) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }

  function addLink(source, target, value = 1) {
    const key = `${source}|||${target}`;
    const existing = links.get(key) || { source, target, value: 0 };
    existing.value += value;
    links.set(key, existing);
  }

  const entries = workItems.length
    ? workItems.slice(0, 8).map(item => ({
      id: `entry:${item.type}:${item.id}`,
      label: item.actionLabel || '处理事项',
      target: item.target,
      sample: item.sample
    }))
    : activeRoles.map(role => ({
      id: `entry:${role.code}`,
      label: role.firstEntry.label,
      target: role.firstEntry.target,
      sample: role.sample
    }));

  activeRoles.forEach(role => {
    const roleId = `role:${role.code}`;
    const defaultEntry = entries[0] || {
      target: role.firstEntry.target,
      sample: role.sample
    };
    addNode({
      id: roleId,
      name: roleId,
      label: role.name,
      type: 'role',
      roleCode: role.code,
      target: role.firstEntry.target,
      sample: role.sample
    });

    contexts.forEach(context => {
      const capabilityId = `capability:${context.capabilityKey}`;
      const l3Id = `l3:${context.l3Key}`;
      const a1Id = `a1:${context.a1Key}`;
      addNode({
        id: capabilityId,
        name: capabilityId,
        label: context.capabilityLabel,
        type: 'capability',
        target: defaultEntry.target,
        sample: defaultEntry.sample || role.sample
      });
      addNode({
        id: l3Id,
        name: l3Id,
        label: context.l3Label,
        type: 'l3',
        deptName: context.deptName,
        target: defaultEntry.target,
        sample: defaultEntry.sample || role.sample
      });
      addNode({
        id: a1Id,
        name: a1Id,
        label: context.a1Label,
        type: 'a1',
        deptName: context.deptName,
        target: defaultEntry.target,
        sample: defaultEntry.sample || role.sample
      });
      addLink(roleId, capabilityId);
      addLink(capabilityId, l3Id);
      addLink(l3Id, a1Id);

      entries.forEach(entry => {
        addNode({ id: entry.id, name: entry.id, label: entry.label, type: 'entry', target: entry.target, sample: entry.sample });
        addLink(a1Id, entry.id);
      });
    });
  });

  return { nodes: Array.from(nodes.values()), links: Array.from(links.values()) };
}

function workbenchActor(identity, session) {
  const subject = sessionSubject(session);
  return {
    userId: identity.user.id,
    identityKind: subject.kind,
    personId: identityInteger(subject.personId),
    accountId: identityInteger(subject.accountId),
    authVersion: identityInteger(subject.authVersion),
    departmentId: identityInteger(identity.user.departmentId),
    departmentName: identity.user.departmentName,
    roleCodes: new Set(identity.roleCodes || []),
    permissions: identity.permSet,
    canReadGlobal: identity.permSet.has('governance:read-global'),
    canReviewDepartment: identity.permSet.has('governance:review-department')
  };
}

async function loadProcessDataGovernanceWorkItems(identity, res, session) {
  if (!isProcessDataGovernanceEnabled()) return [];
  try {
    const repo = processDataGovernanceRepositoryFactory
      ? await processDataGovernanceRepositoryFactory()
      : await require('./processDataGovernance').getProcessDataGovernanceRepository();
    return await repo.listWorkbenchItems(workbenchActor(identity, session));
  } catch (error) {
    // R06: recorded as a classification; the driver's text stays out of the log.
    securityLog(res).write({ event: 'dependency_degraded', code: 'PROCESS_DATA_GOVERNANCE_ITEMS_UNAVAILABLE' });
    throw error;
  }
}

async function loadHandoffWorkItems(session) {
  if(!useMysqlIdentityReadModel())return {availability:{state:'not_applicable',code:'HANDOFF_MYSQL_REQUIRED'},work_items:[]};
  if(!handoffWorkbenchFactory){
    if(String(process.env.DATA_MAP_HANDOFF_ENABLED||'0')==='1')throw require('../dataMapHandoffPolicy').failure('HANDOFF_WORKBENCH_UNAVAILABLE',503);
    return {availability:{state:'disabled',code:'HANDOFF_DISABLED'},work_items:[]};
  }
  return (await handoffWorkbenchFactory()).read(session);
}

async function loadProcessDisputeWorkItems(identity, session) {
  if (!useMysqlIdentityReadModel() || !useMysqlProcessGovernanceReadModel() || process.env.PROCESS_V7_PREVIEW_ENABLED !== '1'
    || identity.roleCodes.includes('admin') || session.identityKind === 'system_admin'
    || !identity.roleCodes.some(code => ['mdm_lead','data_conflict_handler','decision_group'].includes(code))) return [];
  const repo = processDisputeWorkbenchFactory ? await processDisputeWorkbenchFactory() : await require('./processCaseDisputes').getRepository();
  const data = await repo.workbench(session);
  if (!Array.isArray(data?.items)) throw new Error('流程争议待办未能完整读取。');
  const items = new Map();
  for (const row of data.items) {
    const allowed = row.allowed_actions || [];
    let role, permission, label, operation;
    if (row.state === 'unassigned' && allowed.includes('assign')) {
      role='mdm_lead';permission='governance:assign-work';label='分派本流程争议协调人';
      operation='在本流程“责任与历史”的“流程责任与争议办理”中，点击“分派争议协调人”，明确选择人员并填写依据，再点击“保存本次治理办理”。';
    } else if (row.state === 'coordinating' && allowed.some(action => ['coordinate','request_recheck'].includes(action))) {
      role='data_conflict_handler';permission='governance:handle-assigned-conflict';label='办理本人已分派的流程争议';
      operation='在本流程“责任与历史”核对争议及双方依据，按当前情况记录争议协调、交回参与部门重新核对，或补齐升级材料后提交项目决策组；填写依据并保存本次治理办理。';
    } else if (row.state === 'escalated' && allowed.includes('decide')) {
      role='decision_group';permission='governance:decide-escalation';label='记录本流程项目决策';
      operation='在本流程“责任与历史”核对升级材料、各方观点和依据，点击“记录项目决策”，明确选择决定并填写依据，再点击“保存本次治理办理”。';
    } else if (row.state === 'source_changed' && allowed.includes('rebase')) {
      role='mdm_lead';permission='governance:assign-work';label='核对流程修订对争议的影响';
      operation='在本流程“责任与历史”阅读原争议与当前修订，点击“核对修订影响并恢复办理”，填写依据并保存；后续按最新争议状态交接。';
    } else continue;
    // Readable responsibilities and optional reassignment are not outstanding
    // tasks. This projection counts one concrete dispute per current actor.
    if (!identity.roleCodes.includes(role) || !identity.permSet.has(permission)) continue;
    const caseId = identityInteger(row.case_id);
    if (caseId == null) throw new Error('流程争议待办缺少准确案例。');
    const guide={actor:ROLE_GUIDES.find(value=>value.code===role).name,operation,
      result:'在原流程“争议协调与决定历史”核对已保存记录及当前状态；协调和决定不代替参与部门本人重新核对。'};
    items.set(String(caseId),{id:'process-case-dispute:'+caseId,type:'process_case_dispute',governanceType:'process_case_dispute',
      title:label+'：'+row.process_name,caseId,state:row.state,currentStatus:row.state,target:'/app/process-preview?case='+encodeURIComponent(caseId),
      actionLabel:label,nextStep:label,canAct:true,sourceRoles:[role],roleHint:role,requiredPermissions:[permission],urgency:'high',
      sample:guide.operation+guide.result,handlingGuide:guide});
  }
  return [...items.values()];
}

async function loadQualityAuditWorkItems(identity,session){
  if(!useMysqlIdentityReadModel()||process.env.QUALITY_AUDIT_ENABLED!=='1'||identity.roleCodes.includes('admin')||session.identityKind==='system_admin'||!identity.roleCodes.some(code=>['mdm_lead','data_quality_auditor','department_contact'].includes(code)))return [];
  const repo=qualityAuditWorkbenchFactory?await qualityAuditWorkbenchFactory():require('./qualityAudits').getRepository();
  const data=await repo.workbench(session),items=[];
  for(const detail of data.items){
    const row=detail.finding,allowed=detail.allowed_actions||[];
    let roleCode,label,nextStep;
    if(allowed.includes('submit_rectification')){roleCode='department_contact';label='提交整改说明及证据';nextStep='核对原发现和整改要求，填写本次整改说明及证据并提交复核。';}
    else if(allowed.includes('review')){roleCode='data_quality_auditor';label='复核整改证据';nextStep='核对整改说明及证据，填写依据后选择合格关闭或退回整改。';}
    else if(!detail.design_gate.valid&&allowed.includes('revise_design_basis')){roleCode='data_quality_auditor';label='核对已变化的审计依据';nextStep='流程设计变化或原确认失效；先完成负责人本人重新确认，再明确更新审计依据。';}
    else if(identity.roleCodes.includes('mdm_lead')){roleCode='mdm_lead';label='跟踪质量整改进度';nextStep='查看责任部门、整改证据及复核历史，跟踪当前待办。';}
    else continue;
    const stateName={awaiting_rectification:'待提交整改',awaiting_review:'待质量复核',closed:'已关闭'}[row.state]||'待核对状态';
    items.push(normalizeWorkItem({id:'quality-audit:'+row.finding_id,type:'quality_audit',title:row.title,target:'/app/quality?finding='+encodeURIComponent(row.finding_id),roleCode,roleHint:roleCode,sourceRoles:[roleCode],canAct:true,actionLabel:label,governanceType:'quality_audit',sourceType:'quality_audit',department:row.department_snapshot.name,responsiblePerson:row.department_snapshot.name+'主对接人',confirmPerson:'数据质量审计人',currentStatus:stateName,nextStep,handlingGuide:{actor:ROLE_GUIDES.find(role=>role.code===roleCode).name,operation:nextStep,result:'在同一项质量审计发现的办理历史中核对本次结果。'}}));
  }
  return items;
}

async function loadAssignedCaseWorkItems(identity, session) {
  if (!useMysqlIdentityReadModel() || !useMysqlProcessGovernanceReadModel() || process.env.PROCESS_V7_PREVIEW_ENABLED !== '1'
    || identity.roleCodes.includes('admin') || session.identityKind === 'system_admin' || !identity.roleCodes.includes('mdm_steward')
    || !identity.permSet.has('governance:handle-assigned-work') || !identity.permSet.has('governance:read-assigned-context')) return [];
  const repo = assignedCaseWorkRepositoryFactory ? await assignedCaseWorkRepositoryFactory()
    : assignedCaseWorkRepository || (assignedCaseWorkRepository = require('../governanceResponsibilities').makeGovernanceResponsibilitiesRepository(createRegisteredPool(process.env, 'governanceResponsibilities')));
  const result = await repo.pendingCaseWork(workbenchActor(identity, session));
  if (!Array.isArray(result?.items)) throw new Error('治理经办待办未能完整读取。');
  return result.items.filter(row => row.target_type === 'case' && row.assignment_kind === 'steward' && row.allowed_actions?.includes('record_work')).map(row => {
    const caseId = identityInteger(row.target_id);
    if (caseId == null) throw new Error('治理经办待办缺少准确案例。');
    const label = '登记本流程的经办说明及依据';
    const guide = { actor: 'MDM治理经办人',
      operation: '在本流程“责任与历史”核对当前分派及流程材料，点击“记录治理经办情况”，填写治理经办内容和本次办理依据，再点击“保存本次治理办理”。',
      result: '保存后将同一流程交由MDM组长在“责任与历史”的“治理经办记录”查阅，继续原有办理；登记说明不代表案例完成、组长已审核、部门确认或发布。' };
    return normalizeWorkItem({id:'process-assigned-work:'+caseId,type:'process_assigned_work',governanceType:'process_assigned_work',
      title:row.process_name,caseId,target:'/app/process-preview?case='+encodeURIComponent(caseId),
      roleHint:'mdm_steward',sourceRoles:['mdm_steward'],requiredPermissions:['governance:handle-assigned-work'],canAct:true,
      department:row.department_name||null,currentStatus:'待登记本次经办说明',actionLabel:label,nextStep:label,
      handlingGuide:guide,sample:guide.operation+guide.result});
  });
}

function legacyConflictKey(item) {
  const encoded=String(item?.id||'').match(/^legacy-conflict:(field|term):([1-9]\d*)$/);
  if(encoded)return identityInteger(encoded[2])==null?null:encoded[1]+':'+String(identityInteger(encoded[2]));
  const type=item?.conflict_type||item?.conflictType,id=identityInteger(item?.conflict_id||item?.conflictId);
  if(['field','term'].includes(type)&&id!=null)return type+':'+String(id);
  const target=String(item?.target||'');
  if(!/^(?:\/app|#)\/conflicts\?/.test(target))return null;
  const query=new URLSearchParams(target.slice(target.indexOf('?')+1)),queryType=query.get('type')||'field',queryId=identityInteger(query.get('id'));
  return ['field','term'].includes(queryType)&&queryId!=null?queryType+':'+String(queryId):null;
}

async function loadLegacyConflictRechecks(identity,session){
  if(!useMysqlIdentityReadModel()||identity.roleCodes.includes('admin')||session.identityKind==='system_admin'
    ||!identity.roleCodes.some(code=>['mdm_lead','department_mdm_reviewer','data_conflict_handler','decision_group'].includes(code)))return {items:[],managed:new Set(),truncated:false};
  const repo=legacyConflictRecheckRepositoryFactory?await legacyConflictRecheckRepositoryFactory():await require('../conflictMysqlRepository').conflictRepository();
  const result=await repo.listRecheckWorkItems(session);
  if(!Array.isArray(result?.items))throw new Error('冲突重核待办未能完整读取。');
  const items=new Map(),managed=new Set();
  for(const row of result.items){
    const key=legacyConflictKey(row);
    if(!key||row.type!=='legacy_conflict_recheck')throw new Error('冲突重核待办缺少准确事项。');
    managed.add(key);items.set(key,normalizeWorkItem(row));
  }
  for(const row of result.managed_conflicts||[]){const key=legacyConflictKey(row);if(key)managed.add(key);}
  return {items:[...items.values()],managed,truncated:Boolean(result.truncated)};
}

router.get('/', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const mode = req.query.mode === 'all' ? 'all' : 'todo';
    const identity = await workbenchIdentity(req);
    const roleCodes = identity.roleCodes;
    const { roles, roleGroups } = buildRoleGroupsCached(roleCodes);
    const ownedRoles = roles.filter(role => role.owned);
    const administrator = roleCodes.includes('admin') || req.session.identityKind === 'system_admin';
    const permSet = identity.permSet;
    const canViewAll = permSet.has('governance:read-global');
    const canDecideEscalated = permSet.has('governance:decide-escalation');
    const currentDepartmentName = identity.user.departmentName;
    const cacheKey = workbenchResponseCacheKey({ mode, identity, roleCodes, permSet });
    const body = await getOrBuildWorkbenchResponse(cacheKey, async () => {
      const [officeWorkItems, processDataGovernance, v7WorkItems] = await Promise.all([
        useMysqlIdentityReadModel() && !administrator ? require('./offices').getOfficeRepository().personalWorkItems(req.session) : [],
        loadProcessDataGovernanceWorkItems(identity, res, req.session),
        useMysqlProcessGovernanceReadModel() ? require('./processPreviewReview').listProcessWorkbenchItems(workbenchActor(identity, req.session)) : []
      ]);
      const activeRoles = roleCodes.includes('admin') ? ownedRoles.filter(role => role.code === 'admin') : ownedRoles;

      const visibleWorkItems = normalizeWorkItems(
        [...officeWorkItems, ...v7WorkItems, ...processDataGovernance],
        { department: currentDepartmentName }
      );
      const pendingWorkItems = roleCodes.includes('admin') ? [] : visibleWorkItems.filter(item => canActOnWorkbenchItem(item, permSet));
      const guidanceItems = guidanceItemsForRoles(activeRoles);
      const workItems = mode === 'all' ? [...pendingWorkItems, ...guidanceItems] : pendingWorkItems;
      const contexts = [];
      const nextActions = buildNextActions(pendingWorkItems, activeRoles);
      const sankeyWorkItems = mode === 'all' ? [] : pendingWorkItems;

      return {
        mode,
        user: {
          id: identity.user.id,
          name: identity.user.name,
          role: identity.user.role,
          departmentId: identity.user.departmentId,
          departmentName: identity.user.departmentName,
          roleCodes
        },
        summary: {
          priorityCount: nextActions.length,
          actionableCount: pendingWorkItems.length,
          pendingTodos: officeWorkItems.length,
          escalatedConflicts: 0,
          processContexts: contexts.length,
          governance: {
            inputBaselineIssues: 0,
            fieldLedgerGaps: pendingWorkItems.filter(item => item.governanceType === 'field_ledger_gap').length,
            goldSourceConfirmations: pendingWorkItems.filter(item => item.governanceType === 'gold_source_confirmation').length,
            processQuality: pendingWorkItems.filter(item => item.governanceType === 'process_quality').length,
            pmoReviewGates: 0,
            crossDepartmentHandoffs: 0,
            handoffConflicts: 0,
            officeTasks: officeWorkItems.length,
            v7Tasks: v7WorkItems.length,
            processDataGovernance: processDataGovernance.filter(item => item.type === 'process_data_governance_package').length,
            businessFactRequests: processDataGovernance.filter(item => item.type === 'process_data_business_fact').length,
            overdue: pendingWorkItems.filter(item => item.overdue).length
          }
        },
        roles,
        roleGroups,
        workflowGroups: roleGroups.map(group => ({
          key: group.key,
          label: group.label,
          roles: group.roles.map(role => ({
            code: role.code,
            name: role.name,
            owned: role.owned,
            workflow: role.workflow,
            firstEntry: role.firstEntry
          }))
        })),
        nextActions,
        workItems: workItems.length ? workItems : fallbackActions(activeRoles).map((action, index) => normalizeWorkItem({
          id: `guide:${index}`,
          type: 'guidance',
          title: action.title,
          roleHint: action.roleCode,
          target: action.target,
          actionLabel: action.actionLabel,
          sample: action.sample,
          governanceType: 'role_guidance',
          sourceType: 'role_guidance',
          department: currentDepartmentName,
          responsiblePerson: '当前用户',
          confirmPerson: '当前用户',
          currentStatus: 'guidance',
          nextStep: action.actionLabel
        })),
        sankey: buildSankey(activeRoles, contexts, sankeyWorkItems)
      };
    });
    // Per-issue authority is revalidated outside the legacy 15-second response cache.
    const officeRepo=useMysqlIdentityReadModel()&&!administrator?require('./offices').getOfficeRepository():null;
    const closureItems=officeRepo?.closureWorkItems?await officeRepo.closureWorkItems(req.session):[];
    // This discovery and every resource qualification run outside the legacy
    // response cache. No persistent todo IDs or guessed mapping links are used.
    const [handoff,processDisputes,qualityAuditItems,assignedCaseWorkItems,legacyRechecks]=await Promise.all([loadHandoffWorkItems(req.session),loadProcessDisputeWorkItems(identity,req.session),loadQualityAuditWorkItems(identity,req.session),loadAssignedCaseWorkItems(identity,req.session),loadLegacyConflictRechecks(identity,req.session)]);
    const handoffItems=administrator?[]:normalizeWorkItems(handoff.work_items||[]);
    const disputeItems=administrator?[]:normalizeWorkItems(processDisputes);
    const dynamicItems=[...assignedCaseWorkItems,...legacyRechecks.items,...qualityAuditItems,...disputeItems,...handoffItems,...closureItems];
    const baseItems=body.workItems.filter(item=>!legacyRechecks.managed.has(legacyConflictKey(item)));
    const removedTasks=body.workItems.filter(item=>item.type!=='guidance'&&!baseItems.includes(item)).length;
    const liveActions=dynamicItems.length||removedTasks?buildNextActions([...dynamicItems,...baseItems.filter(i=>i.type!=='guidance')],ownedRoles):body.nextActions;
    const response={...body,workItems:dynamicItems.length?[...dynamicItems,...baseItems.filter(i=>mode==='all'||i.type!=='guidance')]:baseItems,
      nextActions:liveActions,handoff:{availability:handoff.availability,actionableCount:handoffItems.length},legacyConflicts:{actionableCount:legacyRechecks.items.length,truncated:legacyRechecks.truncated},
      summary:{...body.summary,priorityCount:liveActions.length,actionableCount:body.summary.actionableCount-removedTasks+dynamicItems.length,
        governance:{...body.summary.governance,dataMapHandoffs:handoffItems.length,processCaseDisputes:disputeItems.length,qualityAudits:qualityAuditItems.length,assignedCaseWork:assignedCaseWorkItems.length,legacyConflictRechecks:legacyRechecks.items.length}}};
    res.setHeader('Cache-Control', 'no-store');
    res.json(response);
  }, useMysqlIdentityReadModel() ? '工作台待办暂不可用，请稍后重试' : null);
});

router.setIdentityRepositoryFactory = setIdentityRepositoryFactory;
router.resetIdentityRepositoryFactory = resetIdentityRepositoryFactory;
router.setProcessGovernanceRepositoryFactory = setProcessGovernanceRepositoryFactory;
router.resetProcessGovernanceRepositoryFactory = resetProcessGovernanceRepositoryFactory;
router.setInputBaselineReviewRepositoryFactory = setInputBaselineReviewRepositoryFactory;
router.resetInputBaselineReviewRepositoryFactory = resetInputBaselineReviewRepositoryFactory;
router.setProcessDataGovernanceRepositoryFactory = factory => {
  processDataGovernanceRepositoryFactory = factory;
  clearWorkbenchCaches();
};
router.resetProcessDataGovernanceRepositoryFactory = () => {
  processDataGovernanceRepositoryFactory = null;
  clearWorkbenchCaches();
};
router.clearWorkbenchCaches = clearWorkbenchCaches;
router.setHandoffWorkbenchFactory = factory => { handoffWorkbenchFactory = factory; };
router.resetHandoffWorkbenchFactory = () => { handoffWorkbenchFactory = null; };
router.setProcessDisputeWorkbenchFactory = factory => { processDisputeWorkbenchFactory = factory; };
router.resetProcessDisputeWorkbenchFactory = () => { processDisputeWorkbenchFactory = null; };
router.setQualityAuditWorkbenchFactory = factory => { qualityAuditWorkbenchFactory = factory; };
router.resetQualityAuditWorkbenchFactory = () => { qualityAuditWorkbenchFactory = null; };
router.setAssignedCaseWorkRepositoryFactory = factory => { assignedCaseWorkRepositoryFactory = factory; };
router.resetAssignedCaseWorkRepositoryFactory = () => { assignedCaseWorkRepositoryFactory = null; };
router.setLegacyConflictRecheckRepositoryFactory = factory => { legacyConflictRecheckRepositoryFactory = factory; };
router.resetLegacyConflictRecheckRepositoryFactory = () => { legacyConflictRecheckRepositoryFactory = null; };

module.exports = router;
