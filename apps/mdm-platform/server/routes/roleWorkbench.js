const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
const db = require('../db');
const { requireAuth, getUserEffectivePermissions } = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const { makeIdentityMysqlRepository } = require('../identityMysqlRepository');
const { makeProcessGovernanceMysqlRepository } = require('../processGovernanceMysqlRepository');
const { makeProcessInputBaselineReviewRepository } = require('../processInputBaselineReviewRepository');
const { ROLE_GUIDES } = require('../roleDefinitions');

let identityRepoPromise = null;
let identityRepositoryFactory = null;
let processGovernanceRepoPromise = null;
let processGovernanceRepositoryFactory = null;
let inputBaselineReviewRepoPromise = null;
let inputBaselineReviewRepositoryFactory = null;
const WORKBENCH_CACHE_TTL_MS = 15 * 1000;
const roleGroupsCache = new Map();
const workbenchResponseCache = new Map();
let processContextBundleCache = null;
const PMO_REVIEW_GATE_ROLES = new Set(['mdm_lead']);

const TODO_TYPE_LABELS = {
  field_confirm: '字段确认',
  gold_source: '黄金源确认',
  terminology: '术语补充',
  conflict_resolution: '冲突协调',
  process_quality: '流程治理质量问题',
  process_mapping_todo: '流程映射待办',
  input_baseline_issue: '输入基线待确认问题',
  cross_dept_handoff: '跨部门承接待办',
  handoff_conflict: '承接冲突待办',
  field_ledger_gap: '字段台账补全',
  gold_source_confirmation: '待确认黄金源确认',
  pmo_review_gate: 'PMO治理评审',
  general: '一般待办'
};

const TODO_TARGETS = {
  field_confirm: '#/todos',
  gold_source: '#/todos',
  terminology: '#/terms',
  conflict_resolution: '#/conflicts',
  process_quality: '#/processGovernance',
  process_mapping_todo: '#/processGovernance',
  input_baseline_issue: '#/processGovernance',
  cross_dept_handoff: '#/processGovernance?workspace=handoffs',
  handoff_conflict: '#/processGovernance?workspace=conflicts',
  field_ledger_gap: '#/todos',
  gold_source_confirmation: '#/todos',
  pmo_review_gate: '#/processGovernance?view=qualityCases',
  general: '#/todos'
};

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

function useInputBaselineReviewMysqlStore() {
  const rawMode = process.env.PROCESS_INPUT_BASELINE_REVIEW_STORE;
  if (rawMode == null || rawMode === '') return useMysqlProcessGovernanceReadModel();
  const mode = String(rawMode).trim().toLowerCase();
  return !['artifact', 'none', 'off', 'false', '0'].includes(mode);
}

async function identityRepository() {
  if (identityRepositoryFactory) {
    return await identityRepositoryFactory();
  }
  if (!identityRepoPromise) {
    identityRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeIdentityMysqlRepository(pool);
      await repo.initSchema();
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

async function processGovernanceRepository() {
  if (processGovernanceRepositoryFactory) {
    return await processGovernanceRepositoryFactory();
  }
  if (!processGovernanceRepoPromise) {
    processGovernanceRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeProcessGovernanceMysqlRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await processGovernanceRepoPromise;
  } catch (error) {
    processGovernanceRepoPromise = null;
    throw error;
  }
}

function setProcessGovernanceRepositoryFactory(factory) {
  processGovernanceRepositoryFactory = factory;
  processGovernanceRepoPromise = null;
}

function resetProcessGovernanceRepositoryFactory() {
  processGovernanceRepositoryFactory = null;
  processGovernanceRepoPromise = null;
}

async function inputBaselineReviewRepository() {
  if (inputBaselineReviewRepositoryFactory) {
    return await inputBaselineReviewRepositoryFactory();
  }
  if (!inputBaselineReviewRepoPromise) {
    inputBaselineReviewRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeProcessInputBaselineReviewRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await inputBaselineReviewRepoPromise;
  } catch (error) {
    inputBaselineReviewRepoPromise = null;
    throw error;
  }
}

async function inputBaselineReviewRepositoryOrNull() {
  if (!inputBaselineReviewRepositoryFactory && !useInputBaselineReviewMysqlStore()) return null;
  try {
    return await inputBaselineReviewRepository();
  } catch (error) {
    if (process.env.MDM_DB_QUIET !== '1') {
      console.warn(`input baseline review store unavailable: ${error.message}`);
    }
    return null;
  }
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
  const roles = db.prepare(`
    SELECT r.role_code as code, r.role_name as name
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.role_id
    WHERE ur.user_id=?
    ORDER BY r.is_system DESC, r.role_code
  `).all(userId);

  if (legacyRole && !roles.some(role => role.code === legacyRole)) {
    const legacy = db.prepare('SELECT role_code as code, role_name as name FROM roles WHERE role_code=?').get(legacyRole);
    if (legacy) roles.unshift(legacy);
  }

  return roles;
}

function sqliteWorkbenchIdentity(req) {
  const currentRoles = getCurrentRoles(req.session.userId, req.session.userRole);
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  const department = req.session.departmentId
    ? db.prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId)
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

function activeSnapshot() {
  return db.prepare(`
    SELECT *
    FROM process_governance_snapshots
    WHERE status='active'
    ORDER BY imported_at DESC, id DESC
    LIMIT 1
  `).get();
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

function openInputBaselineReviewItem(row) {
  const decision = String(row.decision || '').trim();
  const evidenceStatus = String(row.decision_evidence_status || row.evidence_status || '').trim();
  if (['confirm_not_issue', 'covered_by_existing_mapping', 'no_action_needed'].includes(decision)) return false;
  if (['source_verified'].includes(evidenceStatus) && decision === 'confirm_not_issue') return false;
  return true;
}

function loadProcessContexts(mode, workItems, options = {}) {
  const bundle = cachedProcessContextBundle();
  if (!bundle) return [];

  const todoA1Codes = new Set(workItems.map(item => item.a1Code).filter(Boolean));
  const departmentName = String(options.departmentName || '');
  const canViewAll = Boolean(options.canViewAll);

  const contexts = bundle.a1Rows
    .filter(row => canViewAll || !departmentName || row.dept_name === departmentName)
    .filter(row => mode !== 'todo' || todoA1Codes.size === 0 || todoA1Codes.has(row.a1_code))
    .map(row => {
      const a1Node = findA1Node(row, bundle);
      const l3Node = a1Node ? bundle.nodeByKey.get(bundle.parentByTarget.get(a1Node.node_key)) : null;
      const l2Node = l3Node ? bundle.nodeByKey.get(bundle.parentByTarget.get(l3Node.node_key)) : null;
      return {
        capabilityKey: l2Node ? l2Node.node_key : `capability:${row.dept_name || 'default'}`,
        capabilityLabel: l2Node ? l2Node.name : '流程治理能力',
        l3Key: l3Node ? l3Node.node_key : `l3:${row.l3_name || row.id}`,
        l3Label: l3Node ? l3Node.name : (row.l3_name || '未命名流程'),
        a1Key: a1Node ? a1Node.node_key : `a1:${row.a1_code || row.id}`,
        a1Label: row.a1_code ? `${row.a1_code} ${row.behavior}` : row.behavior,
        deptName: row.dept_name || '',
        systems: parseJsonArray(row.suggested_systems)
      };
    });

  if (contexts.length > 0) return contexts.slice(0, mode === 'todo' ? 12 : 30);

  return [{
    capabilityKey: 'capability:guide',
    capabilityLabel: '流程治理能力',
    l3Key: 'l3:guide',
    l3Label: '角色工作流',
    a1Key: 'a1:guide',
    a1Label: '查看角色说明并处理当前事项',
    deptName: '',
    systems: []
  }];
}

function cachedProcessContextBundle() {
  const now = Date.now();
  if (
    processContextBundleCache &&
    processContextBundleCache.expiresAt > now
  ) {
    return processContextBundleCache.value;
  }

  const snapshot = activeSnapshot();
  if (!snapshot) return null;
  const a1Rows = db.prepare(`
    SELECT *
    FROM process_a1_items
    WHERE snapshot_id=?
    ORDER BY dept_name, l3_name, a1_code, id
    LIMIT 80
  `).all(snapshot.id);

  const nodes = db.prepare(`
    SELECT node_key, node_type, name, parent_key, dept_name, domain_name
    FROM process_governance_nodes
    WHERE snapshot_id=?
  `).all(snapshot.id);
  const edges = db.prepare(`
    SELECT source_key, target_key
    FROM process_governance_edges
    WHERE snapshot_id=?
  `).all(snapshot.id);

  const a1Nodes = nodes.filter(node => node.node_type === 'a1');
  const value = {
    a1Rows,
    a1Nodes,
    nodeByKey: new Map(nodes.map(node => [node.node_key, node])),
    a1NodeByName: new Map(a1Nodes.map(node => [node.name, node])),
    parentByTarget: new Map(edges.map(edge => [edge.target_key, edge.source_key]))
  };
  processContextBundleCache = {
    snapshotId: snapshot.id,
    value,
    expiresAt: now + WORKBENCH_CACHE_TTL_MS
  };
  return value;
}

function findA1Node(row, bundle) {
  const code = row.a1_code || '';
  const exact = code ? bundle.nodeByKey.get(code) : null;
  if (exact && exact.node_type === 'a1') return exact;
  const byName = bundle.a1NodeByName.get(row.behavior);
  if (byName) return byName;
  return bundle.a1Nodes.find(node => String(node.node_key || '').includes(code || '__none__')) || null;
}

function loadTodos(req, canViewAll) {
  const params = [];
  let sql = `
    SELECT t.*, fd.name as from_dept_name, td.name as to_dept_name,
           fe.process_governance_a1_code as a1_code
    FROM todos t
    LEFT JOIN departments fd ON t.from_dept_id = fd.id
    LEFT JOIN departments td ON t.to_dept_id = td.id
    LEFT JOIN field_entries fe ON t.related_field_id = fe.id
    WHERE t.status='pending'
  `;

  if (!canViewAll) {
    sql += ' AND (t.to_dept_id=? OR t.to_dept_id IS NULL)';
    params.push(req.session.departmentId || -1);
  }

  sql += " ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date IS NULL, due_date, t.id LIMIT 20";

  return db.prepare(sql).all(...params).map(row => ({
    id: `todo:${row.id}`,
    type: row.type,
    title: `${TODO_TYPE_LABELS[row.type] || '待办'}：${row.content}`,
    roleHint: roleHintForTodo(row.type),
    urgency: row.urgency,
    dueDate: row.due_date,
    target: TODO_TARGETS[row.type] || '#/todos',
    actionLabel: '处理待办',
    sample: sampleForTodo(row.type),
    a1Code: row.a1_code || null,
    source: row.from_dept_name || '平台',
    targetDept: row.to_dept_name || null,
    status: row.status || 'pending',
    currentStatus: row.status || 'pending',
    nextStep: sampleForTodo(row.type),
    department: row.to_dept_name || row.from_dept_name || null,
    responsiblePerson: fallbackConfirmPerson(row.to_dept_name),
    confirmPerson: fallbackConfirmPerson(row.to_dept_name)
  }));
}

function qualityCaseWorkItem(row) {
  return {
    id: `process-quality-case:${row.id}`,
    type: 'process_quality',
    title: `${row.severity}：${row.message}`,
    roleHint: 'department_contact',
    urgency: row.priority === 'high' || row.severity === 'BLOCK' ? 'high' : 'medium',
    dueDate: row.due_date || null,
    target: `#/processGovernance?view=qualityCases&case=${row.id}`,
    actionLabel: '查看治理问题单',
    sample: row.suggestion || '先回到来源文件确认问题，完成整改后重新运行流程治理解析和导入。',
    source: row.source_file,
    targetDept: row.dept_name || null,
    area: row.area,
    sourceLine: row.source_line,
    status: row.status,
    currentStatus: row.status,
    nextStep: row.suggestion || '回到来源文件核验并提交整改结论',
    department: row.dept_name || row.owner_dept_name || null,
    ownerDept: row.owner_dept_name || null,
    responsiblePerson: row.owner_dept_name ? fallbackConfirmPerson(row.owner_dept_name) : fallbackConfirmPerson(row.dept_name),
    confirmPerson: fallbackConfirmPerson(row.dept_name || row.owner_dept_name)
  };
}

function loadProcessQualityFindings(req, canViewAll, currentDepartmentName) {
  const departmentName = currentDepartmentName || (
    req.session.departmentId
      ? (db.prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId) || {}).name
      : null
  );

  const params = [];
  let sql = `
    SELECT c.id, c.severity, c.area, c.source_file, c.source_line, c.message, c.suggestion,
           c.dept_name, c.status, c.priority, c.due_date, c.owner_dept_id, d.name AS owner_dept_name
    FROM process_governance_quality_cases c
    LEFT JOIN departments d ON d.id = c.owner_dept_id
    WHERE c.severity IN ('BLOCK','WARN') AND c.status NOT IN ('closed','source_resolved')
  `;

  if (!canViewAll) {
    sql += ' AND (c.dept_name=? OR c.owner_dept_id=? OR c.dept_name IS NULL)';
    params.push(departmentName || '__none__', req.session.departmentId || -1);
  }

  sql += `
    ORDER BY CASE c.status WHEN 'reopened' THEN 0 WHEN 'open' THEN 1 WHEN 'assigned' THEN 2 WHEN 'rectifying' THEN 3 ELSE 4 END,
             CASE c.severity WHEN 'BLOCK' THEN 0 ELSE 1 END,
             c.due_date IS NULL, c.due_date,
             c.dept_name IS NULL, c.dept_name, c.area, c.id
    LIMIT 20
  `;

  return db.prepare(sql).all(...params).map(qualityCaseWorkItem);
}

async function loadProcessQualityFindingsAsync(req, canViewAll, currentDepartmentName) {
  if (!useMysqlProcessGovernanceReadModel()) {
    return loadProcessQualityFindings(req, canViewAll, currentDepartmentName);
  }

  const repo = await processGovernanceRepository();
  const result = await repo.getQualityCases({
    userId: req.session.userId,
    departmentId: req.session.departmentId || -1,
    canViewAll,
    departmentName: currentDepartmentName || ''
  });
  return (result.items || [])
    .filter(row => ['BLOCK', 'WARN'].includes(String(row.severity || '').toUpperCase()))
    .filter(row => !['closed', 'source_resolved'].includes(String(row.status || '')))
    .slice(0, 20)
    .map(qualityCaseWorkItem);
}

function roleHintForMappingTodo(row) {
  if (row.todo_type === 'cross_dept' || row.todo_type === 'dept_confirm') return 'department_mdm_reviewer';
  return 'department_contact';
}

function mappingTodoWorkItem(row) {
  return {
    id: `process-mapping-todo:${row.id}`,
    type: 'process_mapping_todo',
    title: `${TODO_TYPE_LABELS.process_mapping_todo}：${row.message}`,
    roleHint: roleHintForMappingTodo(row),
    urgency: row.priority === 'high' ? 'high' : 'medium',
    dueDate: row.due_date || null,
    target: `#/processGovernance?view=mappingTodos&todo=${row.id}`,
    actionLabel: '查看映射待办',
    sample: row.suggestion || '先核对来源映射关系，修改源文件后重新导入。',
    a1Code: row.a1_code || null,
    source: row.source_file || '流程映射工作库',
    targetDept: row.target_dept_name || row.dept_name || null,
    area: row.todo_type,
    sourceLine: row.source_line,
    status: row.status,
    currentStatus: row.status,
    nextStep: row.suggestion || '核对来源文件并提交处理结论',
    department: row.target_dept_name || row.dept_name || row.owner_dept_name || null,
    ownerDept: row.owner_dept_name || null,
    responsiblePerson: fallbackConfirmPerson(row.target_dept_name || row.dept_name || row.owner_dept_name),
    confirmPerson: fallbackConfirmPerson(row.target_dept_name || row.dept_name || row.owner_dept_name)
  };
}

function loadProcessMappingTodos(req, canViewAll, currentDepartmentName) {
  const departmentName = currentDepartmentName || (
    req.session.departmentId
      ? (db.prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId) || {}).name
      : null
  );

  const params = [];
  let sql = `
    SELECT t.*, d.name AS owner_dept_name
    FROM process_mapping_todos t
    LEFT JOIN departments d ON d.id = t.owner_dept_id
    WHERE t.status NOT IN ('closed','source_resolved','accepted')
  `;

  if (!canViewAll) {
    sql += ' AND (t.dept_name=? OR t.target_dept_name=? OR t.owner_dept_id=? OR t.dept_name IS NULL)';
    params.push(departmentName || '__none__', departmentName || '__none__', req.session.departmentId || -1);
  }

  sql += `
    ORDER BY CASE t.status WHEN 'reopened' THEN 0 WHEN 'open' THEN 1 WHEN 'assigned' THEN 2 WHEN 'rectifying' THEN 3 ELSE 4 END,
             CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
             t.due_date IS NULL, t.due_date, t.dept_name, t.id
    LIMIT 20
  `;

  return db.prepare(sql).all(...params).map(mappingTodoWorkItem);
}

async function loadProcessMappingTodosAsync(req, canViewAll, currentDepartmentName) {
  if (!useMysqlProcessGovernanceReadModel()) {
    return loadProcessMappingTodos(req, canViewAll, currentDepartmentName);
  }

  const repo = await processGovernanceRepository();
  const result = await repo.getMappingTodos({
    userId: req.session.userId,
    departmentId: req.session.departmentId || -1,
    canViewAll,
    departmentName: currentDepartmentName || ''
  }, 20);
  return (result.items || [])
    .filter(row => !['closed', 'source_resolved', 'accepted'].includes(String(row.status || '')))
    .slice(0, 20)
    .map(mappingTodoWorkItem);
}

function inputBaselineReviewWorkItem(row, runId) {
  const stableKey = row.stable_key || row.review_item_id || row.id;
  const department = row.department || null;
  const target = `#/processGovernance?view=inputBaselineReview&run=${encodeURIComponent(runId)}&reviewItem=${encodeURIComponent(stableKey)}`;
  return {
    id: `input-baseline-review:${runId}:${stableKey}`,
    type: 'input_baseline_issue',
    governanceType: 'input_baseline_issue',
    title: `${TODO_TYPE_LABELS.input_baseline_issue}：${row.content || row.document_name || stableKey}`,
    roleHint: 'department_contact',
    urgency: 'medium',
    dueDate: row.due_date || null,
    target,
    actionLabel: '确认输入基线问题',
    sample: row.suggested_action || '先回到来源文件核验，再确认是否进入流程映射整改或留在问题池。',
    a1Code: row.a1_code || null,
    source: row.source_label || row.source_file || row.document_name || '输入基线复核',
    targetDept: department,
    department,
    area: row.issue_type || null,
    status: row.decision || row.status || 'not_reviewed',
    currentStatus: row.decision || row.status || 'not_reviewed',
    nextStep: row.suggested_action || '回到来源文件核验并记录复核结论',
    responsiblePerson: row.owner || fallbackConfirmPerson(department),
    confirmPerson: row.owner || fallbackConfirmPerson(department),
    sourceLine: row.source_anchor || null,
    reviewRunId: runId,
    reviewStableKey: stableKey,
    definitionStatus: row.definition_status || row.decision_definition_status || null,
    evidenceStatus: row.decision_evidence_status || row.evidence_status || null
  };
}

async function loadInputBaselineReviewIssuesAsync(canViewAll, currentDepartmentName) {
  const repo = await inputBaselineReviewRepositoryOrNull();
  if (!repo || typeof repo.listRuns !== 'function' || typeof repo.getReviewItems !== 'function') return [];
  const runs = await repo.listRuns();
  const run = Array.isArray(runs) && runs.length ? runs[0] : null;
  if (!run || !run.run_id) return [];
  const filters = canViewAll || !currentDepartmentName ? {} : { dept: currentDepartmentName };
  const result = await repo.getReviewItems(run.run_id, filters);
  return (result.items || [])
    .filter(openInputBaselineReviewItem)
    .slice(0, 20)
    .map(row => inputBaselineReviewWorkItem(row, run.run_id));
}

function pmoReviewGateWorkItems(roleCodes, currentDepartmentName) {
  if (!roleCodes.some(code => PMO_REVIEW_GATE_ROLES.has(code))) return [];
  const department = currentDepartmentName || '双部门样板';
  return [normalizeWorkItem({
    id: `pmo-review-gate:${department}`,
    type: 'pmo_review_gate',
    governanceType: 'pmo_review_gate',
    title: `PMO治理评审：更新${department}闭环状态`,
    roleHint: 'mdm_lead',
    urgency: 'medium',
    dueDate: null,
    target: '#/processGovernance?view=qualityCases',
    actionLabel: '更新治理周报',
    sample: '核对新增、关闭、超期、字段台账和待确认黄金源进度；未完成来源文件核验的事项继续留在问题池。',
    source: 'PMO治理节奏',
    department,
    responsiblePerson: fallbackConfirmPerson(department),
    confirmPerson: fallbackConfirmPerson(department),
    currentStatus: 'weekly_review',
    nextStep: '汇总本周治理状态并标出需决策事项'
  })];
}

function roleHintForTodo(type) {
  if (type === 'field_confirm' || type === 'gold_source') return 'department_mdm_reviewer';
  if (type === 'conflict_resolution') return 'data_conflict_handler';
  if (type === 'terminology' || type === 'process_quality' || type === 'process_mapping_todo') return 'department_contact';
  return 'mdm_lead';
}

function sampleForTodo(type) {
  if (type === 'field_confirm') return '先打开 A1 业务行为，确认字段是否确实在该流程中产生或消费。';
  if (type === 'gold_source') return '先查看字段台账和消费系统，再确认维护部门和待确认权威系统。';
  if (type === 'conflict_resolution') return '先查看双方字段说明和消费场景，再提交协调意见。';
  if (type === 'terminology') return '先确认术语适用范围，再补充定义和禁用说法。';
  if (type === 'process_quality') return '先打开流程治理闭环视图，定位来源文件、整改建议和当前责任人。';
  if (type === 'process_mapping_todo') return '先打开流程映射待办，确认 L3/A1 和来源文件，再决定是否修改源文件。';
  return '先确认事项来源、责任部门和截止时间，再记录处理结论。';
}

function loadEscalatedConflicts(canDecideEscalated) {
  if (!canDecideEscalated) return [];

  const termRows = db.prepare(`
    SELECT id, term as title, severity, created_at
    FROM term_conflicts
    WHERE status='escalated'
    ORDER BY id DESC
    LIMIT 10
  `).all().map(row => ({
    id: `term-conflict:${row.id}`,
    type: 'escalated_conflict',
    title: `升级事项待终裁：${row.title}`,
    roleHint: 'decision_group',
    urgency: row.severity === 'blocking' ? 'high' : 'medium',
    target: `#/conflicts/term/${row.id}`,
    actionLabel: '查看升级事项',
    sample: '先看 A1、字段台账和双方意见，再给出终裁结论和后续责任人。'
  }));

  const fieldRows = db.prepare(`
    SELECT id, conflict_field, severity, created_at
    FROM field_conflicts
    WHERE status='escalated'
    ORDER BY id DESC
    LIMIT 10
  `).all().map(row => ({
    id: `field-conflict:${row.id}`,
    type: 'escalated_conflict',
    title: `升级字段冲突待终裁：${row.conflict_field}`,
    roleHint: 'decision_group',
    urgency: row.severity === 'blocking' ? 'high' : 'medium',
    target: `#/conflicts/field/${row.id}`,
    actionLabel: '查看升级事项',
    sample: '先看字段差异、流程场景和消费方，再给出终裁结论。'
  }));

  return [...termRows, ...fieldRows];
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

async function loadDirectProcessGovernanceWorkItems(identity) {
  if (!useMysqlProcessGovernanceReadModel()) return [];
  try {
    const processDesignRoutes = require('./processDesignMysql');
    const repo = await processDesignRoutes.getProcessDesignRepository();
    const actor = {
      userId: identity.user.id,
      personId: identity.user.personId || identity.user.id,
      departmentId: identity.user.departmentId,
      departmentName: identity.user.departmentName,
      roleCodes: identity.roleCodes
    };
    const [handoffs, conflicts] = await Promise.all([
      repo.listHandoffQueue(actor, { limit: 100 }),
      repo.listHandoffConflictQueue(actor, { limit: 100 })
    ]);
    const handoffItems = (handoffs.items || []).filter(item => item.can_act).map(item => ({
      id: `cross-dept-handoff:${item.id}`,
      type: 'cross_dept_handoff',
      governanceType: 'cross_dept_handoff',
      title: `跨部门承接：${item.process_name || item.document_no || item.handoff_ref}`,
      roleHint: item.next_responsible_role,
      urgency: item.status === 'returned' ? 'high' : 'medium',
      target: `#/processGovernance?workspace=handoffs&handoff=${item.id}`,
      actionLabel: '处理承接待办',
      sample: `当前步骤：${item.current_stage && item.current_stage.name || item.status}。打开故事链后按当前责任步骤处理。`,
      source: item.handoff_ref,
      department: item.counterparty_department || item.origin_department,
      currentStatus: item.status,
      nextStep: item.current_stage && item.current_stage.name,
      canAct: true,
      sourceRoles: [item.next_responsible_role].filter(Boolean)
    }));
    const conflictItems = (conflicts.items || []).filter(item => item.can_act).map(item => ({
      id: `handoff-conflict:${item.id}`,
      type: 'handoff_conflict',
      governanceType: 'handoff_conflict',
      title: `承接冲突：${item.process_name || item.document_no || item.handoff_ref}`,
      roleHint: item.action_role || (item.status === 'pending_assignment'
        ? 'mdm_lead'
        : item.status === 'pending_decision'
          ? 'decision_group'
          : item.status === 'pending_department_confirmation'
            ? 'department_mdm_reviewer'
            : 'data_conflict_handler'),
      urgency: item.status === 'pending_decision' ? 'high' : 'medium',
      target: `#/processGovernance?workspace=conflicts&conflict=${item.id}`,
      actionLabel: '处理承接冲突',
      sample: '查看双方立场、证据和协调方案，再按当前角色完成分派、协调、部门确认或项目决策。',
      source: item.handoff_ref,
      department: item.counterparty_department || item.origin_department,
      currentStatus: item.status,
      nextStep: item.status,
      canAct: true
    }));
    return [...handoffItems, ...conflictItems];
  } catch (error) {
    if (process.env.MDM_DB_QUIET !== '1') {
      console.warn(`direct process governance work items unavailable: ${error.message}`);
    }
    return [];
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
      const [todos, qualityFindings, mappingTodos, inputBaselineIssues, escalated, directProcessGovernance] = await Promise.all([
        Promise.resolve().then(() => loadTodos(req, canViewAll)),
        loadProcessQualityFindingsAsync(req, canViewAll, currentDepartmentName),
        loadProcessMappingTodosAsync(req, canViewAll, currentDepartmentName),
        loadInputBaselineReviewIssuesAsync(canViewAll, currentDepartmentName),
        Promise.resolve().then(() => loadEscalatedConflicts(canDecideEscalated)),
        loadDirectProcessGovernanceWorkItems(identity)
      ]);
      const activeRoles = ownedRoles;
      const pmoReviewGates = pmoReviewGateWorkItems(roleCodes, currentDepartmentName);
      const visibleWorkItems = normalizeWorkItems(
        [...directProcessGovernance, ...escalated, ...inputBaselineIssues, ...qualityFindings, ...mappingTodos, ...todos, ...pmoReviewGates],
        { department: currentDepartmentName }
      );
      const pendingWorkItems = visibleWorkItems.filter(item => canActOnWorkbenchItem(item, permSet));
      const guidanceItems = guidanceItemsForRoles(activeRoles);
      const workItems = mode === 'all' ? [...pendingWorkItems, ...guidanceItems] : pendingWorkItems;
      const contexts = loadProcessContexts(mode, pendingWorkItems, {
        canViewAll,
        departmentName: currentDepartmentName
      });
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
          pendingTodos: todos.length,
          escalatedConflicts: escalated.length,
          processContexts: contexts.length,
          governance: {
            inputBaselineIssues: inputBaselineIssues.length,
            fieldLedgerGaps: pendingWorkItems.filter(item => item.governanceType === 'field_ledger_gap').length,
            goldSourceConfirmations: pendingWorkItems.filter(item => item.governanceType === 'gold_source_confirmation').length,
            processQuality: pendingWorkItems.filter(item => item.governanceType === 'process_quality').length,
            pmoReviewGates: pmoReviewGates.length,
            crossDepartmentHandoffs: directProcessGovernance.filter(item => item.type === 'cross_dept_handoff').length,
            handoffConflicts: directProcessGovernance.filter(item => item.type === 'handoff_conflict').length,
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
    res.json(body);
  }, useMysqlIdentityReadModel() ? '身份 MySQL 读取模型不可用' : null);
});

router.setIdentityRepositoryFactory = setIdentityRepositoryFactory;
router.resetIdentityRepositoryFactory = resetIdentityRepositoryFactory;
router.setProcessGovernanceRepositoryFactory = setProcessGovernanceRepositoryFactory;
router.resetProcessGovernanceRepositoryFactory = resetProcessGovernanceRepositoryFactory;
router.setInputBaselineReviewRepositoryFactory = setInputBaselineReviewRepositoryFactory;
router.resetInputBaselineReviewRepositoryFactory = resetInputBaselineReviewRepositoryFactory;
router.clearWorkbenchCaches = clearWorkbenchCaches;

module.exports = router;
