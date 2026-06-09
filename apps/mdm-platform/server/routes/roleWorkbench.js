const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, getUserEffectivePermissions } = require('../auth');
const { ROLE_GUIDES } = require('../roleDefinitions');

const TODO_TYPE_LABELS = {
  field_confirm: '字段确认',
  gold_source: '黄金源确认',
  terminology: '术语补充',
  conflict_resolution: '冲突协调',
  process_quality: '流程治理质量问题',
  general: '一般待办'
};

const TODO_TARGETS = {
  field_confirm: '#/todos',
  gold_source: '#/todos',
  terminology: '#/terms',
  conflict_resolution: '#/conflicts',
  process_quality: '#/processGovernance?view=quality',
  general: '#/todos'
};

function runDbAction(res, action) {
  try {
    return action();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  }
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

function loadProcessContexts(mode, workItems) {
  const snapshot = activeSnapshot();
  if (!snapshot) return [];

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

  const nodeByKey = new Map(nodes.map(node => [node.node_key, node]));
  const parentByTarget = new Map(edges.map(edge => [edge.target_key, edge.source_key]));
  const todoA1Codes = new Set(workItems.map(item => item.a1Code).filter(Boolean));

  function findA1Node(row) {
    return nodes.find(node => node.node_type === 'a1' && (
      node.node_key === row.a1_code ||
      String(node.node_key || '').includes(row.a1_code || '__none__') ||
      node.name === row.behavior
    ));
  }

  const contexts = a1Rows
    .filter(row => mode !== 'todo' || todoA1Codes.size === 0 || todoA1Codes.has(row.a1_code))
    .map(row => {
      const a1Node = findA1Node(row);
      const l3Node = a1Node ? nodeByKey.get(parentByTarget.get(a1Node.node_key)) : null;
      const l2Node = l3Node ? nodeByKey.get(parentByTarget.get(l3Node.node_key)) : null;
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

function loadProcessQualityFindings(req, canViewAll) {
  const snapshot = activeSnapshot();
  if (!snapshot) return [];

  const department = req.session.departmentId
    ? db.prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId)
    : null;

  const params = [snapshot.id];
  let sql = `
    SELECT id, severity, area, source_file, source_line, message, suggestion, dept_name
    FROM process_governance_quality_findings
    WHERE snapshot_id=? AND severity IN ('BLOCK','WARN')
  `;

  if (!canViewAll) {
    sql += ' AND (dept_name=? OR dept_name IS NULL)';
    params.push(department && department.name || '__none__');
  }

  sql += `
    ORDER BY CASE severity WHEN 'BLOCK' THEN 0 ELSE 1 END,
             dept_name IS NULL, dept_name, area, source_file, COALESCE(source_line, 0), id
    LIMIT 20
  `;

  return db.prepare(sql).all(...params).map(row => ({
    id: `process-quality:${row.id}`,
    type: 'process_quality',
    title: `${row.severity}：${row.message}`,
    roleHint: 'data_quality',
    urgency: row.severity === 'BLOCK' ? 'high' : 'medium',
    target: `#/processGovernance?view=quality&finding=${row.id}`,
    actionLabel: '查看质量问题',
    sample: row.suggestion || '先回到来源文件确认问题，再重新运行流程治理解析和导入。',
    source: row.source_file,
    targetDept: row.dept_name || null,
    area: row.area,
    sourceLine: row.source_line
  }));
}

function roleHintForTodo(type) {
  if (type === 'field_confirm') return 'business_contact';
  if (type === 'gold_source') return 'data_quality';
  if (type === 'conflict_resolution') return 'data_quality';
  if (type === 'terminology') return 'business_contact';
  if (type === 'process_quality') return 'data_quality';
  return 'project_lead';
}

function sampleForTodo(type) {
  if (type === 'field_confirm') return '先打开 A1 业务行为，确认字段是否确实在该流程中产生或消费。';
  if (type === 'gold_source') return '先查看字段台账和消费系统，再确认维护部门和权威系统候选。';
  if (type === 'conflict_resolution') return '先查看双方字段说明和消费场景，再提交协调意见。';
  if (type === 'terminology') return '先确认术语适用范围，再补充定义和禁用说法。';
  if (type === 'process_quality') return '先打开流程治理质量视图，定位来源文件和整改建议。';
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
  return runDbAction(res, () => {
    const mode = req.query.mode === 'all' ? 'all' : 'todo';
    const currentRoles = getCurrentRoles(req.session.userId, req.session.userRole);
    const roleCodes = currentRoles.map(role => role.code);
    const { roles, roleGroups } = buildRoleGroups(roleCodes);
    const ownedRoles = roles.filter(role => role.owned);
    const { permSet } = getUserEffectivePermissions(req.session.userId);
    const canViewAll = permSet.has('data:view_all') || permSet.has('*:*') || roleCodes.includes('admin');
    const canDecideEscalated = permSet.has('conflict:final_decide_escalated') || permSet.has('*:*') || roleCodes.includes('admin');
    const department = req.session.departmentId
      ? db.prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId)
      : null;
    const todos = loadTodos(req, canViewAll);
    const qualityFindings = loadProcessQualityFindings(req, canViewAll);
    const escalated = loadEscalatedConflicts(canDecideEscalated);
    const workItems = mode === 'todo' ? [...escalated, ...qualityFindings, ...todos] : [...escalated, ...qualityFindings, ...todos];
    const contexts = loadProcessContexts(mode, workItems);
    const activeRoles = ownedRoles.length ? ownedRoles : roles.filter(role => role.code === req.session.userRole);
    const nextActions = buildNextActions(workItems, activeRoles);

    res.json({
      mode,
      user: {
        id: req.session.userId,
        name: req.session.userName,
        role: req.session.userRole,
        departmentId: req.session.departmentId,
        departmentName: department && department.name || null,
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
      sankey: buildSankey(activeRoles, contexts, workItems)
    });
  });
});

module.exports = router;
