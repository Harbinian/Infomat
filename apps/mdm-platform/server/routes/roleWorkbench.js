const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
const db = require('../db');
const { requireAuth, getUserEffectivePermissions } = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const { makeIdentityMysqlRepository } = require('../identityMysqlRepository');
const { makeProcessGovernanceMysqlRepository } = require('../processGovernanceMysqlRepository');
const { ROLE_GUIDES } = require('../roleDefinitions');

let identityRepoPromise = null;
let identityRepositoryFactory = null;
let processGovernanceRepoPromise = null;
let processGovernanceRepositoryFactory = null;
const WORKBENCH_CACHE_TTL_MS = 15 * 1000;
const roleGroupsCache = new Map();
const workbenchResponseCache = new Map();
let processContextBundleCache = null;
const PROCESS_GOVERNANCE_GLOBAL_ROLES = new Set(['admin', 'decision_group', 'it_lead']);

const TODO_TYPE_LABELS = {
  field_confirm: '字段确认',
  gold_source: '黄金源确认',
  terminology: '术语补充',
  conflict_resolution: '冲突协调',
  process_quality: '流程治理质量问题',
  process_mapping_todo: '流程映射待办',
  general: '一般待办'
};

const TODO_TARGETS = {
  field_confirm: '#/todos',
  gold_source: '#/todos',
  terminology: '#/terms',
  conflict_resolution: '#/conflicts',
  process_quality: '#/processGovernance?view=qualityCases',
  process_mapping_todo: '#/processGovernance?view=mappingTodos',
  general: '#/todos'
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
      departmentName: department && department.name || null
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
      departmentName: payload.departmentName || null
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
      { key: 'project', label: '项目工作角色', roles: roles.filter(role => role.group === 'project') },
      { key: 'basic', label: '基础权限角色', roles: roles.filter(role => role.group === 'basic') }
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
    targetDept: row.to_dept_name || null
  }));
}

function qualityCaseWorkItem(row) {
  return {
    id: `process-quality-case:${row.id}`,
    type: 'process_quality',
    title: `${row.severity}：${row.message}`,
    roleHint: 'data_quality',
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
    ownerDept: row.owner_dept_name || null
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
  if (row.todo_type === 'verification' || row.todo_type === 'evidence' || row.todo_type === 'adjustment') return 'business_contact';
  if (row.todo_type === 'cross_dept' || row.todo_type === 'dept_confirm') return 'workgroup_lead';
  return 'business_contact';
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
    sample: row.suggestion || '先核对来源映射关系，回源整改后重新导入。',
    a1Code: row.a1_code || null,
    source: row.source_file || '流程映射工作库',
    targetDept: row.target_dept_name || row.dept_name || null,
    area: row.todo_type,
    sourceLine: row.source_line,
    status: row.status,
    ownerDept: row.owner_dept_name || null
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

function roleHintForTodo(type) {
  if (type === 'field_confirm') return 'business_contact';
  if (type === 'gold_source') return 'data_quality';
  if (type === 'conflict_resolution') return 'data_quality';
  if (type === 'terminology') return 'business_contact';
  if (type === 'process_quality') return 'data_quality';
  if (type === 'process_mapping_todo') return 'business_contact';
  return 'project_lead';
}

function sampleForTodo(type) {
  if (type === 'field_confirm') return '先打开 A1 业务行为，确认字段是否确实在该流程中产生或消费。';
  if (type === 'gold_source') return '先查看字段台账和消费系统，再确认维护部门和待确认权威系统。';
  if (type === 'conflict_resolution') return '先查看双方字段说明和消费场景，再提交协调意见。';
  if (type === 'terminology') return '先确认术语适用范围，再补充定义和禁用说法。';
  if (type === 'process_quality') return '先打开流程治理闭环视图，定位来源文件、整改建议和当前责任人。';
  if (type === 'process_mapping_todo') return '先打开流程映射待办，确认 L3/A1 和来源文件，再决定是否回源整改。';
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
  const roles = ownedRoles.length ? ownedRoles : ROLE_GUIDES.filter(role => role.code === 'submitter');
  return roles.slice(0, 3).map(role => ({
    title: `${role.name}：${role.workflow[0]}`,
    roleCode: role.code,
    target: role.firstEntry.target,
    actionLabel: role.firstEntry.label,
    sample: role.sample,
    priority: 'normal'
  }));
}

function guidanceItemsForRoles(ownedRoles) {
  const roles = ownedRoles.length ? ownedRoles : ROLE_GUIDES.filter(role => role.code === 'submitter');
  return roles.map(role => ({
    id: `guide:${role.code}`,
    type: 'guidance',
    title: `${role.name}：${role.workflow[0] || role.firstEntry.label}`,
    roleHint: role.code,
    target: role.firstEntry.target,
    actionLabel: role.firstEntry.label,
    sample: role.sample,
    urgency: 'normal'
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

router.get('/', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const mode = req.query.mode === 'all' ? 'all' : 'todo';
    const identity = await workbenchIdentity(req);
    const roleCodes = identity.roleCodes;
    const { roles, roleGroups } = buildRoleGroupsCached(roleCodes);
    const ownedRoles = roles.filter(role => role.owned);
    const permSet = identity.permSet;
    const canViewAll = permSet.has('*:*') ||
      permSet.has('admin:access') ||
      permSet.has('process_governance:view_all') ||
      roleCodes.some(code => PROCESS_GOVERNANCE_GLOBAL_ROLES.has(code));
    const canDecideEscalated = permSet.has('conflict:final_decide_escalated') || permSet.has('*:*') || roleCodes.includes('admin');
    const currentDepartmentName = identity.user.departmentName;
    const cacheKey = workbenchResponseCacheKey({ mode, identity, roleCodes, permSet });
    const body = await getOrBuildWorkbenchResponse(cacheKey, async () => {
      const [todos, qualityFindings, mappingTodos, escalated] = await Promise.all([
        Promise.resolve().then(() => loadTodos(req, canViewAll)),
        loadProcessQualityFindingsAsync(req, canViewAll, currentDepartmentName),
        loadProcessMappingTodosAsync(req, canViewAll, currentDepartmentName),
        Promise.resolve().then(() => loadEscalatedConflicts(canDecideEscalated))
      ]);
      const activeRoles = ownedRoles.length ? ownedRoles : roles.filter(role => role.code === req.session.userRole);
      const pendingWorkItems = [...escalated, ...qualityFindings, ...mappingTodos, ...todos];
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
          processContexts: contexts.length
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
        workItems: workItems.length ? workItems : fallbackActions(activeRoles).map((action, index) => ({
          id: `guide:${index}`,
          type: 'guidance',
          title: action.title,
          roleHint: action.roleCode,
          target: action.target,
          actionLabel: action.actionLabel,
          sample: action.sample
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
router.clearWorkbenchCaches = clearWorkbenchCaches;

module.exports = router;
