const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  requireAuth,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync,
  getDepartmentByIdAsync
} = require('../auth');
const { ROLE_GUIDES } = require('../roleDefinitions');

const PAGE_DEFINITIONS = {
  dashboard: {
    title: '统计看板',
    subtitle: '先看全局状态，再进入需要处理的事项。',
    workflow: ['查看关键指标', '定位待办和冲突', '进入处理页面', '跟踪闭环'],
    sample: '看到待办或冲突数量后，先进入对应列表处理，不在看板里直接判断业务口径。',
    pitfall: '不要只看数量；需要继续进入待办、冲突或流程明细确认原因。',
    doneCriteria: '高优先级事项已有明确入口，管理视图和处理页面能互相跳转。',
    target: '#/dashboard',
    roles: {
      mdm_lead: { title: '查看全局治理事项和发布条件', target: '#/processGovernance', actionLabel: '查看流程治理' },
      department_contact: { title: '查看本部门报送和整改事项', target: '#/mySubmissions', actionLabel: '查看报送' },
      department_mdm_reviewer: { title: '查看本部门待审核和责任记录', target: '#/todos', actionLabel: '查看待办' },
      data_conflict_handler: { title: '查看本人被分派的冲突', target: '#/conflicts', actionLabel: '查看冲突' },
      data_quality_auditor: { title: '查看全局质量发现和整改进度', target: '#/quality', actionLabel: '查看数据质量' },
      decision_group: { title: '查看已升级重大争议', target: '#/conflicts', actionLabel: '查看升级事项' },
      admin: { title: '查看账号授权和访问审计', target: '#/rbac', actionLabel: '查看账号与授权' }
    }
  },
  roleGuide: {
    title: '角色与责任',
    subtitle: '先确认有效角色、权限范围和RACI责任，再进入对应工作流。',
    workflow: ['确认当前有效角色', '查看固定权限和责任边界', '核对按钮不可用原因', '进入处理入口'],
    sample: '多角色账号先查看当前有效角色，再根据事项范围和责任关系进入对应处理入口。',
    pitfall: '角色权限只表示最多能做什么；对象状态、任务关系和责任证据仍会限制具体操作。',
    doneCriteria: '用户理解自己的权限上限、责任范围和当前事项可执行条件。',
    target: '#/roleGuide',
    roles: {
      department_contact: { title: '查看部门主对接人的起草和提交边界', target: '#/roleGuide', actionLabel: '查看角色与责任' },
      department_mdm_reviewer: { title: '查看部门审核和记录决定的边界', target: '#/roleGuide', actionLabel: '查看角色与责任' },
      mdm_lead: { title: '查看任务分派、结构检查和发布条件', target: '#/roleGuide', actionLabel: '查看角色与责任' },
      data_conflict_handler: { title: '查看已分派冲突的处理边界', target: '#/roleGuide', actionLabel: '查看角色与责任' },
      data_quality_auditor: { title: '查看质量审计人的只读和整改边界', target: '#/roleGuide', actionLabel: '查看角色与责任' },
      decision_group: { title: '查看重大争议决定边界', target: '#/roleGuide', actionLabel: '查看角色与责任' },
      admin: { title: '查看管理员只管身份、不管业务的边界', target: '#/roleGuide', actionLabel: '查看角色与责任' }
    }
  },
  mySubmissions: {
    title: '报送管理',
    subtitle: '从草稿到提交，确保流程映射和字段台账可被复核。',
    workflow: ['选择流程映射', '补齐字段台账', '提交审批', '查看驳回与修正'],
    sample: '新增或修正字段时，先确认字段属于哪个数据对象，再补中文名、英文名、字段类型和消费系统。',
    pitfall: '不要把业务说明只写在备注里；结构化字段必须补齐。',
    doneCriteria: '草稿已提交，字段台账至少满足审核所需信息。',
    target: '#/mySubmissions'
  },
  capabilities: {
    title: '能力与流程申报',
    subtitle: '先申报能力，再挂接流程，最后进入评审。',
    workflow: ['申报业务能力', '申报业务流程', '预览关系', '提交/评审'],
    sample: '新增流程前先确认所属能力和部门，避免流程挂在错误的能力层级下。',
    pitfall: '不要把流程名称写成部门职责；流程需要能落到具体业务动作。',
    doneCriteria: '能力、流程和部门关系明确，状态可被后续评审。',
    target: '#/capabilities'
  },
  businessMap: {
    title: '业务地图',
    subtitle: '通过图谱定位部门、能力、流程和应用建议关系。',
    workflow: ['选择部门范围', '查看业务地图', '点击流程节点', '进入流程详情'],
    sample: '查看某个流程时，先从部门和能力定位，再进入流程详情看字段台账。',
    pitfall: '不要根据图上建议落位直接认定黄金源；黄金源仍需按字段确认。',
    doneCriteria: '目标流程已定位，能进入详情查看关联字段和上下游说明。',
    target: '#/businessMap'
  },
  processGovernance: {
    title: '流程治理',
    subtitle: '按范围查看流程、A1 明细和跨部门风险。',
    workflow: ['选择公司/部门范围', '查看流程图谱', '定位 A1 明细', '处理跨部门风险'],
    sample: '看到跨部门风险时，先确认输入来源和输出目标，再回到 A1 业务行为核对。',
    pitfall: '不要只看待办数量；跨部门输入输出没有闭环时，需要回到 A1 业务行为确认。',
    doneCriteria: '本部门待办清零或有明确责任人，跨部门风险有确认状态。',
    target: '#/processGovernance'
  },
  todos: {
    title: '待办收到',
    subtitle: '按紧急度处理当前需要你推动的事项。',
    workflow: ['筛选待处理', '打开详情', '填写意见或确认', '提交并回到列表'],
    sample: '字段确认类待办先打开 A1 业务行为，再判断字段是否产生或消费。',
    pitfall: '不要只点完成；需要确认事项来源、责任部门和处理结论。',
    doneCriteria: '待办已处理或已有明确说明，相关详情页状态同步更新。',
    target: '#/todos'
  },
  reviews: {
    title: '评审记录',
    subtitle: '复核审批节点和历史意见。',
    workflow: ['查看待评审节点', '打开映射详情', '填写评审意见', '通过或驳回'],
    sample: '驳回字段台账时，应写明具体字段和原因，方便报送人定向修正。',
    pitfall: '不要只写笼统意见；需要把问题落到字段、流程或 A1。',
    doneCriteria: '审核动作有意见，阻断事项进入协调或解决状态。',
    target: '#/reviews'
  },
  terms: {
    title: '术语词典',
    subtitle: '维护定义、范围和禁用表述，减少口径漂移。',
    workflow: ['选择适用范围', '填写术语定义', '提交/审核', '沉淀词典'],
    sample: '补充术语时，先确认适用业务流程，再写清定义和禁用说法。',
    pitfall: '不要只写同义词；需要说明边界和不可使用的表述。',
    doneCriteria: '术语定义、范围、禁用表述和状态都有记录。',
    target: '#/terms'
  },
  conflicts: {
    title: '冲突管理',
    subtitle: '处理字段和术语冲突，必要时升级终裁。',
    workflow: ['查看冲突差异', '提交本方立场', '形成协调结论', '归档或升级'],
    sample: '字段冲突先看双方字段说明、消费系统和 A1 场景，再提交协调意见。',
    pitfall: '不要只看字段名就决策；必须确认该字段在哪个流程行为中产生、维护和消费。',
    doneCriteria: '冲突已有协调结论、终裁记录或可追溯的归档说明。',
    target: '#/conflicts'
  },
  orgUnits: {
    title: '组织架构',
    subtitle: '维护组织单元的编码、层级、负责人和状态。',
    workflow: ['查询组织', '打开组织表单', '保存草稿', '激活组织'],
    sample: '新增部门前先确认组织类型和上级组织，保存后再激活。',
    pitfall: '不要把组织简称随意填写；编码会依赖简称生成。',
    doneCriteria: '组织编码、名称、层级和状态一致。',
    target: '#/orgUnits'
  },
  persons: {
    title: '人员管理',
    subtitle: '维护人员基础信息、任岗关系和状态。',
    workflow: ['查询人员', '打开人员表单', '保存草稿', '维护任岗/激活'],
    sample: '新增人员先保存基础信息，再根据需要维护岗位和角色。',
    pitfall: '不要只新增人员而不确认岗位或角色；否则工作台无法正确引导。',
    doneCriteria: '人员信息保存成功，必要时完成岗位或角色关联，状态可追溯。',
    target: '#/persons'
  },
  products: {
    title: '产品主数据',
    subtitle: '维护产品族、产品和生命周期状态。',
    workflow: ['查询产品族/产品', '打开表单', '保存草稿', '发布或废止'],
    sample: '新增产品前先确认产品族，再填写版次和分类码。',
    pitfall: '不要直接发布未确认的产品；发布会影响同产品族现行版本。',
    doneCriteria: '产品族和产品编码生成，生命周期状态符合实际维护阶段。',
    target: '#/products'
  },
  quality: {
    title: '数据质量',
    subtitle: '查看主数据质量和黄金源确认进度。',
    workflow: ['查看质量概览', '定位未确认字段', '处理字段冲突', '跟踪黄金源进度'],
    sample: '发现待确认黄金源不一致时，先看字段台账和消费系统，再进入冲突协调。',
    pitfall: '不要因为流程建议落位就直接认定黄金源；黄金源必须按字段确认。',
    doneCriteria: '字段完整性、待确认黄金源和冲突处理状态都有记录。',
    target: '#/quality'
  },
  rbac: {
    title: '账号与授权',
    subtitle: '管理员手工维护账号生命周期和固定MDM工作角色授权。',
    workflow: ['创建待启用账号', '记录角色授权依据和有效期', '明确启用或停用', '检查访问审计'],
    sample: '管理员收到确认后的账号信息，创建待启用账号、记录角色授权依据，再明确启用并线下交付一次性临时密码。',
    pitfall: '管理员不能编辑固定权限矩阵，也不能借管理员身份审核、修改或发布业务内容。',
    doneCriteria: '人员、账号、部门、有效角色、授权依据和访问审计一致。',
    target: '#/rbac',
    roles: {
      admin: { title: '维护账号生命周期和固定角色授权', target: '#/rbac', actionLabel: '进入账号与授权' }
    }
  }
};

const FORM_WORKFLOWS = {
  orgUnit: ['填写组织信息', '保存草稿', '确认层级/负责人', '激活组织'],
  person: ['填写人员信息', '保存草稿', '维护任岗/角色', '激活人员'],
  productFamily: ['填写产品族信息', '保存草稿', '确认分类', '激活产品族'],
  product: ['选择产品族', '保存草稿', '确认属性/分类', '发布产品'],
  role: ['填写角色信息', '保存角色', '维护权限矩阵', '分配用户'],
  mapping: ['查看字段台账', '修正字段信息', '保存草稿', '提交审批']
};

const ENTITY_LABELS = {
  orgUnit: '组织',
  person: '人员',
  productFamily: '产品族',
  product: '产品',
  role: '角色',
  mapping: '流程映射'
};

function runDbAction(res, action) {
  try {
    return action();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  }
}

function runAction(res, action) {
  return action().catch(error => {
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  });
}

async function departmentName(departmentId) {
  if (!departmentId) return null;
  const row = await getDepartmentByIdAsync(departmentId);
  return row && row.name || null;
}

function pendingTodos(req, canViewAll) {
  const params = [];
  let sql = "SELECT COUNT(*) as count FROM todos WHERE status='pending'";
  if (!canViewAll) {
    sql += ' AND (to_dept_id=? OR to_dept_id IS NULL)';
    params.push(req.session.departmentId || -1);
  }
  return db.prepare(sql).get(...params).count || 0;
}

function escalatedConflictCount(canDecideEscalated) {
  if (!canDecideEscalated) return 0;
  const fieldCount = db.prepare("SELECT COUNT(*) as count FROM field_conflicts WHERE status='escalated'").get().count || 0;
  const termCount = db.prepare("SELECT COUNT(*) as count FROM term_conflicts WHERE status='escalated'").get().count || 0;
  return fieldCount + termCount;
}

function workflowFromLabels(labels, view) {
  const currentIndex = view === 'form' ? 1 : view === 'detail' ? Math.min(1, labels.length - 1) : 0;
  return labels.map((label, index) => ({
    key: index === 1 && view === 'form' ? 'save' : `step-${index + 1}`,
    label,
    status: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'next'
  }));
}

function formWorkflow(entityType) {
  return workflowFromLabels(FORM_WORKFLOWS[entityType] || ['填写信息', '保存草稿', '复核状态', '返回列表'], 'form');
}

function pageFor(tab) {
  return PAGE_DEFINITIONS[tab] || PAGE_DEFINITIONS.dashboard;
}

function roleGuideByCode(code) {
  return ROLE_GUIDES.find(role => role.code === code);
}

function buildRoleAction(page, ownedRoles) {
  const roleMap = page.roles || {};
  for (const role of ownedRoles) {
    if (roleMap[role.code]) {
      const guide = roleGuideByCode(role.code);
      return {
        title: roleMap[role.code].title,
        sample: guide && guide.sample || page.sample,
        target: roleMap[role.code].target || page.target,
        actionLabel: roleMap[role.code].actionLabel || page.title,
        priority: 'medium',
        roleCode: role.code
      };
    }
  }
  const guide = ownedRoles.map(role => roleGuideByCode(role.code)).find(Boolean);
  if (guide) {
    return {
      title: `${guide.name}：${guide.workflow[0]}`,
      sample: guide.sample,
      target: guide.firstEntry.target,
      actionLabel: guide.firstEntry.label,
      priority: 'normal',
      roleCode: guide.code
    };
  }
  return null;
}

function buildNextActions(req, page, ownedRoles, counts) {
  const actions = [];
  if (counts.escalatedConflicts > 0) {
    actions.push({
      title: `处理升级/终裁事项：${counts.escalatedConflicts} 项`,
      sample: '先看 A1、字段台账和双方意见，再给出终裁结论和后续责任人。',
      target: '#/conflicts',
      actionLabel: '查看升级事项',
      priority: 'high',
      roleCode: 'decision_group'
    });
  }
  if (counts.pendingTodos > 0) {
    actions.push({
      title: `处理当前待办：${counts.pendingTodos} 项`,
      sample: page.sample,
      target: '#/todos',
      actionLabel: '查看待办',
      priority: 'high',
      roleCode: 'owner'
    });
  }
  const roleAction = buildRoleAction(page, ownedRoles);
  if (roleAction) actions.push(roleAction);
  actions.push({
    title: `进入${page.title}`,
    sample: page.sample,
    target: page.target,
    actionLabel: page.title,
    priority: 'normal',
    roleCode: req.session.userRole || 'submitter'
  });

  const seen = new Set();
  return actions.filter(action => {
    const key = `${action.title}|${action.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

function detailActions(tab, view, entityType, entityId, page) {
  if (!entityType) return [];
  const safeId = entityId || 'new';
  const base = `#/${tab}/${entityType}/${safeId}`;
  if (view === 'form') {
    return [
      { label: '保存草稿', target: base, action: 'save' },
      { label: `返回${page.title}`, target: page.target, action: 'back' }
    ];
  }
  return [
    { label: '查看当前详情', target: base, action: 'view' },
    { label: '编辑当前记录', target: `${base}/edit`, action: 'edit' },
    { label: `返回${page.title}`, target: page.target, action: 'back' }
  ];
}

router.get('/', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const tab = String(req.query.tab || 'dashboard');
    const view = ['list', 'detail', 'form'].includes(req.query.view) ? req.query.view : 'list';
    const entityType = req.query.entityType ? String(req.query.entityType) : null;
    const entityId = req.query.entityId ? String(req.query.entityId) : null;
    const mode = req.query.mode === 'all' ? 'all' : 'todo';
    const page = pageFor(tab);
    const currentRoles = await getUserRoleCodesAsync(req.session.userId, req.session.userRole);
    const roleCodes = currentRoles.map(role => role.code || role.role_code).filter(Boolean);
    const ownedRoles = ROLE_GUIDES.filter(role => roleCodes.includes(role.code));
    const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
    const canViewAll = permSet.has('governance:read-global');
    const canDecideEscalated = permSet.has('governance:decide-escalation');
    const counts = {
      pendingTodos: pendingTodos(req, canViewAll),
      escalatedConflicts: escalatedConflictCount(canDecideEscalated)
    };
    const nextActions = buildNextActions(req, page, ownedRoles, counts);
    const workflow = view === 'form' ? formWorkflow(entityType) : workflowFromLabels(page.workflow, view);
    const currentDepartmentName = await departmentName(req.session.departmentId);

    res.json({
      mode,
      tab,
      view,
      user: {
        id: req.session.userId,
        name: req.session.userName,
        role: req.session.userRole,
        departmentId: req.session.departmentId,
        departmentName: currentDepartmentName,
        roleCodes
      },
      page: {
        title: view === 'form' ? `${entityId === 'new' ? '新增' : '编辑'}${ENTITY_LABELS[entityType] || page.title}` : page.title,
        subtitle: page.subtitle,
        target: page.target
      },
      summary: {
        priorityCount: nextActions.length,
        pendingTodos: counts.pendingTodos,
        escalatedConflicts: counts.escalatedConflicts
      },
      nextActions,
      workflow,
      context: {
        sample: page.sample,
        pitfall: page.pitfall,
        doneCriteria: page.doneCriteria,
        entityType,
        entityId
      },
      detailActions: detailActions(tab, view, entityType, entityId, page)
    });
  });
});

module.exports = router;
