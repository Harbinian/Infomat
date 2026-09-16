let processGovernanceRepoPromise = null;
let processGovernanceRepositoryFactory = null;
let inputBaselineReviewRepoPromise = null;
let inputBaselineReviewRepositoryFactory = null;
let processContextBundleCache = null;

const { checkRuntimeSchema, sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
function legacyDb() { return require('../db'); }
const { requireAuth, getUserEffectivePermissions } = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const { makeIdentityMysqlRepository } = require('../identityMysqlRepository');


const { ROLE_GUIDES } = require('../roleDefinitions');
const {
  isProcessDataGovernanceEnabled
} = require('../processDataGovernanceScope');

let identityRepoPromise = null;
let identityRepositoryFactory = null;

let processDataGovernanceRepositoryFactory = null;
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
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (sendMysqlUnavailable(res, error)) return;
    console.error(error);
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
      const pool = mysql.createPool(mysqlConfigFromEnv());
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

async function loadProcessDataGovernanceWorkItems(identity) {
  if (!isProcessDataGovernanceEnabled()) return [];
  try {
    const repo = processDataGovernanceRepositoryFactory
      ? await processDataGovernanceRepositoryFactory()
      : await require('./processDataGovernance').getProcessDataGovernanceRepository();
    return await repo.listWorkbenchItems({
      userId: identity.user.id,
      personId: identity.user.personId || identity.user.id,
      departmentId: identity.user.departmentId,
      departmentName: identity.user.departmentName,
      roleCodes: new Set(identity.roleCodes || []),
      permissions: identity.permSet
    });
  } catch (error) {
    if (process.env.MDM_DB_QUIET !== '1') {
      console.warn(`process data governance work items unavailable: ${error.message}`);
    }
    throw error;
  }
}

router.get('/', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const mode = req.query.mode === 'all' ? 'all' : 'todo';
    const identity = await workbenchIdentity(req);
    const roleCodes = identity.roleCodes;
    const { roles, roleGroups } = buildRoleGroupsCached(roleCodes);
    const ownedRoles = roles.filter(role => role.owned);
    const permSet = identity.permSet;
    const canViewAll = permSet.has('governance:read-global');
    const canDecideEscalated = permSet.has('governance:decide-escalation');
    const currentDepartmentName = identity.user.departmentName;
    const cacheKey = workbenchResponseCacheKey({ mode, identity, roleCodes, permSet });
    const body = await getOrBuildWorkbenchResponse(cacheKey, async () => {
      const [officeWorkItems, processDataGovernance, v7WorkItems] = await Promise.all([
        useMysqlIdentityReadModel() ? require('./offices').getOfficeRepository().personalWorkItems(req.session) : [],
        loadProcessDataGovernanceWorkItems(identity),
        useMysqlProcessGovernanceReadModel() ? require('./processV7PreviewReview').listV7WorkbenchItems({
          userId: identity.user.id, personId: identity.user.personId, departmentId: identity.user.departmentId,
          departmentName: identity.user.departmentName, roleCodes: new Set(roleCodes), permissions: permSet,
          canReadGlobal: canViewAll, canReviewDepartment: permSet.has('governance:review-department')
        }) : []
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
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
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

module.exports = router;
