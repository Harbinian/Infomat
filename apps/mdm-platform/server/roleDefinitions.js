const BASE_PERMISSIONS = {
  dashboard: ['dashboard:view', 'dashboard', 'view', '查看统计看板'],
  mappingRead: ['mapping:read', 'mapping', 'read', '查看业务映射'],
  mappingCreate: ['mapping:create', 'mapping', 'create', '创建业务映射'],
  mappingUpdate: ['mapping:update', 'mapping', 'update', '更新业务映射'],
  mappingSubmit: ['mapping:submit', 'mapping', 'submit', '提交业务映射'],
  reviewApprove: ['review:approve', 'review', 'approve', '审核批准'],
  conflictManage: ['conflict:manage', 'conflict', 'manage', '处理一般冲突'],
  conflictResolve: ['conflict:resolve', 'conflict', 'resolve', '冲突解决'],
  conflictEscalate: ['conflict:escalate', 'conflict', 'escalate', '升级冲突'],
  conflictFinal: ['conflict:final_decide_escalated', 'conflict', 'final_decide_escalated', '处理升级后的冲突'],
  todosManage: ['todos:manage', 'todos', 'manage', '管理待办'],
  dataViewAll: ['data:view_all', 'data', 'view_all', '查看全部信息'],
  dataViewDepartment: ['data:view_department', 'data', 'view_department', '查看本部门信息'],
  qualityManage: ['quality:manage', 'quality', 'manage', '维护数据质量事项'],
  roleAdmin: ['admin:access', 'admin', 'access', '访问管理功能']
};

const ROLE_GUIDES = [
  {
    code: 'it_lead',
    name: '信息化负责人',
    group: 'project',
    description: '查看全局阻塞，协调一般冲突，并升级需决策事项',
    goal: '保证流程、字段、冲突和跨部门事项能持续向前推进。',
    firstEntry: { label: '全局阻塞事项', target: '#/conflicts' },
    workflow: ['查看全局阻塞', '协调一般冲突', '升级需决策事项', '跟踪闭环'],
    sample: '信息化负责人看到字段口径协调超过约定时间后，先查看冲突双方说明，再决定继续协调或升级给项目决策组。',
    pitfall: '不要直接替业务部门认定字段口径；先确认流程场景、字段消费方和维护责任。',
    doneCriteria: '阻塞事项有负责人、有处理结论、有下一步记录。',
    permissions: [
      BASE_PERMISSIONS.dataViewAll,
      BASE_PERMISSIONS.dashboard,
      BASE_PERMISSIONS.mappingRead,
      BASE_PERMISSIONS.conflictManage,
      BASE_PERMISSIONS.conflictResolve,
      BASE_PERMISSIONS.conflictEscalate,
      BASE_PERMISSIONS.todosManage
    ]
  },
  {
    code: 'project_lead',
    name: '项目组长',
    group: 'project',
    description: '推进本部门流程、字段和跨部门衔接事项',
    goal: '让本部门流程梳理、字段确认和跨部门衔接按节奏完成。',
    firstEntry: { label: '本部门进度', target: '#/processGovernance' },
    workflow: ['查看本部门进度', '分派阻塞事项', '复核跨部门衔接', '推进提交'],
    sample: '项目组长看到本部门有跨部门衔接风险时，先进入流程治理详情，确认输入来源和输出目标是否缺接收流程。',
    pitfall: '不要只看待办数量；跨部门输入输出没有闭环时，需要回到 A1 业务行为确认。',
    doneCriteria: '本部门待办清零或有明确责任人，跨部门风险有确认状态。',
    permissions: [
      BASE_PERMISSIONS.dataViewDepartment,
      BASE_PERMISSIONS.dashboard,
      BASE_PERMISSIONS.mappingRead,
      BASE_PERMISSIONS.reviewApprove,
      BASE_PERMISSIONS.todosManage
    ]
  },
  {
    code: 'business_contact',
    name: '业务对接人',
    group: 'project',
    description: '确认流程范围，补充字段台账，并处理部门待办',
    goal: '把真实业务动作、字段和流程节点补充到平台里。',
    firstEntry: { label: '报送管理', target: '#/mySubmissions' },
    workflow: ['确认流程范围', '补字段台账', '处理部门待办', '提交确认'],
    sample: '业务对接人收到字段确认待办后，先打开 A1 业务行为，确认字段是否确实在该流程中产生或消费。',
    pitfall: '不要只填字段名称；需要同时说明数据对象、消费系统、同步方式和对应 A1。',
    doneCriteria: '流程映射和字段台账可被审核人复核，相关待办已处理或说明原因。',
    permissions: [
      BASE_PERMISSIONS.dataViewDepartment,
      BASE_PERMISSIONS.dashboard,
      BASE_PERMISSIONS.mappingRead,
      BASE_PERMISSIONS.mappingCreate,
      BASE_PERMISSIONS.mappingUpdate,
      BASE_PERMISSIONS.mappingSubmit,
      BASE_PERMISSIONS.todosManage
    ]
  },
  {
    code: 'data_quality',
    name: '数据质量员',
    group: 'project',
    description: '检查字段完整性，确认黄金源，并处理字段冲突',
    goal: '让字段台账可复核、可追溯，并逐步形成黄金源判断。',
    firstEntry: { label: '数据质量', target: '#/quality' },
    workflow: ['检查字段完整性', '确认黄金源', '处理字段冲突', '标记质量问题'],
    sample: '数据质量员发现同一字段存在不同黄金源候选时，先查看字段台账和消费系统，再发起冲突协调。',
    pitfall: '不要因为流程建议落位就直接认定黄金源；黄金源必须按字段确认。',
    doneCriteria: '字段完整性、黄金源候选和冲突处理状态都有记录。',
    permissions: [
      BASE_PERMISSIONS.dataViewDepartment,
      BASE_PERMISSIONS.dashboard,
      BASE_PERMISSIONS.mappingRead,
      BASE_PERMISSIONS.qualityManage,
      BASE_PERMISSIONS.conflictManage,
      BASE_PERMISSIONS.todosManage
    ]
  },
  {
    code: 'decision_group',
    name: '项目决策组',
    group: 'project',
    description: '查看升级事项，阅读争议链路，并形成终裁记录',
    goal: '处理需要项目层面拍板的升级事项。',
    firstEntry: { label: '升级事项', target: '#/conflicts' },
    workflow: ['查看升级事项', '阅读争议链路', '作出终裁', '形成处理记录'],
    sample: '项目决策组收到升级冲突后，先看 A1、字段台账和双方意见，再给出终裁结论和后续责任人。',
    pitfall: '不要只看字段名就决策；必须确认该字段在哪个流程行为中产生、维护和消费。',
    doneCriteria: '升级事项已有终裁结论，处理记录可追溯。',
    permissions: [
      BASE_PERMISSIONS.dataViewAll,
      BASE_PERMISSIONS.dashboard,
      BASE_PERMISSIONS.mappingRead,
      BASE_PERMISSIONS.conflictFinal,
      BASE_PERMISSIONS.todosManage
    ]
  },
  {
    code: 'submitter',
    name: '报送人',
    group: 'basic',
    description: '提交业务数据和流程映射',
    goal: '把本人负责的流程映射和字段台账提交给后续角色审核。',
    firstEntry: { label: '报送管理', target: '#/mySubmissions' },
    workflow: ['确认流程映射', '补字段台账', '提交审批'],
    sample: '报送人新增字段时，先确认字段属于哪个数据对象，再补中文名、英文名、字段类型和消费系统。',
    pitfall: '不要把业务说明只写在备注里；结构化字段必须补齐。',
    doneCriteria: '草稿已提交，字段台账至少满足审核所需信息。'
  },
  {
    code: 'owner',
    name: '业务负责人',
    group: 'basic',
    description: '管理所属部门业务数据',
    goal: '确认本部门流程和字段口径，并推动跨部门确认。',
    firstEntry: { label: '待办收到', target: '#/todos' },
    workflow: ['清理部门待办', '核字段口径', '确认跨部门输入输出'],
    sample: '业务负责人收到黄金源确认待办后，先看字段消费方，再判断维护部门和权威系统候选。',
    pitfall: '不要只确认本部门视角；跨部门输入输出也要一起看。',
    doneCriteria: '本部门待办已有处理记录，字段口径明确。'
  },
  {
    code: 'reviewer',
    name: '审核员',
    group: 'basic',
    description: '审核业务流程和映射',
    goal: '发现阻断问题，推动流程映射和字段台账进入可发布状态。',
    firstEntry: { label: '冲突管理', target: '#/conflicts' },
    workflow: ['处理阻断冲突', '复核评审记录', '推进审批节点'],
    sample: '审核员驳回字段台账时，应写明具体字段和驳回原因，方便报送人定向修正。',
    pitfall: '不要只写笼统意见；需要把问题落到字段、流程或 A1。',
    doneCriteria: '审核动作有意见，阻断事项进入协调或解决状态。'
  },
  {
    code: 'admin',
    name: '管理员',
    group: 'basic',
    description: '维护角色、权限和基础主数据',
    goal: '保持平台账号、权限、基础数据和发布动作可用。',
    firstEntry: { label: '角色权限', target: '#/rbac' },
    workflow: ['确认权限边界', '维护基础数据', '处理发布类动作'],
    sample: '管理员新增账号后，应同时检查基础角色和项目角色，确保用户进入页面能看到自己的工作流。',
    pitfall: '不要只改用户基础角色；项目角色缺失时，工作台无法按真实分工引导。',
    doneCriteria: '用户、角色、权限和基础数据状态一致。'
  }
];

const PROJECT_ROLE_DEFINITIONS = ROLE_GUIDES
  .filter(role => role.group === 'project')
  .map(role => ({
    roleCode: role.code,
    roleName: role.name,
    description: role.description,
    permissions: role.permissions || []
  }));

function ensureProjectRoles(db, assignedBy = null) {
  const insertPermission = db.prepare(`
    INSERT OR IGNORE INTO permissions (perm_code, resource, action, description)
    VALUES (?, ?, ?, ?)
  `);
  const upsertRole = db.prepare(`
    INSERT INTO roles (role_code, role_name, description, is_system, created_by)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(role_code) DO UPDATE SET
      role_name=excluded.role_name,
      description=excluded.description,
      is_system=1,
      updated_at=CURRENT_TIMESTAMP
  `);
  const roleByCode = db.prepare('SELECT role_id FROM roles WHERE role_code=?');
  const linkPermission = db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, perm_id)
    SELECT ?, perm_id FROM permissions WHERE perm_code=?
  `);

  for (const role of PROJECT_ROLE_DEFINITIONS) {
    for (const permission of role.permissions) insertPermission.run(...permission);
    upsertRole.run(role.roleCode, role.roleName, role.description, assignedBy);
    const row = roleByCode.get(role.roleCode);
    db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(row.role_id);
    for (const [permCode] of role.permissions) linkPermission.run(row.role_id, permCode);
  }
}

module.exports = {
  ROLE_GUIDES,
  PROJECT_ROLE_DEFINITIONS,
  ensureProjectRoles
};
