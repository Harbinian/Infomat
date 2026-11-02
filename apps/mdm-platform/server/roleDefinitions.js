const ACCESS_MODEL_VERSION = 'rbac-raci-v5-2026-10-19';

const VISIBLE_TABS = Object.freeze({
  roleWorkbench: {
    code: 'roleWorkbench',
    name: '我的工作台',
    access: 'read',
    reason: '汇总当前账号全部有效角色的本人待办和责任入口'
  },
  roleGuide: {
    code: 'roleGuide',
    name: '角色与责任',
    access: 'read',
    reason: '固定角色模型向全部已登录人员公开'
  },
  dashboard: {
    code: 'dashboard', name: '治理活跃与统计', access: 'role_scoped',
    reason: '按照现有治理读取范围查看活跃记录和统计'
  },
  orgUnits: {
    code: 'orgUnits', name: '组织架构', access: 'read',
    reason: '查看当前MySQL部门目录'
  },
  persons: {
    code: 'persons', name: '花名册', access: 'read',
    reason: '具备身份读取权限的人员查看当前MySQL花名册'
  },
  processGovernance: {
    code: 'processGovernance',
    name: '流程治理',
    access: 'role_scoped',
    reason: '按角色、部门和参与关系查看流程编制、跨部门承接与承接冲突'
  },
  dataMap: {
    code: 'dataMap',
    name: '数据地图',
    access: 'role_scoped',
    reason: '按固定治理角色授予的数据范围查看'
  },
  publications: {
    code: 'publications', name: '主数据发布', access: 'role_scoped',
    reason: '读取发布记录；具备发布权限的业务角色核对并发布手工导入的数据'
  },
  conflicts: {
    code: 'conflicts',
    name: '数据与术语冲突',
    access: 'role_scoped',
    reason: '仅查看本人被分派或已升级的非承接类冲突'
  },
  quality: {
    code: 'quality',
    name: '数据质量',
    access: 'role_scoped',
    reason: '数据质量审计人形成审计发现，MDM工作组组长查看治理结果'
  },
  rbac: {
    code: 'rbac',
    name: '账号与授权',
    access: 'read_or_manage',
    reason: '管理员维护账号与授权，其他角色不显示该标签'
  }
});

function visibleTabs(...codes) {
  return codes.map(code => ({ ...VISIBLE_TABS[code] })).filter(tab => tab.code);
}

function perm(code, resource, action, description, options = {}) {
  return Object.assign([code, resource, action, description], {
    code,
    resource,
    action,
    description,
    isDangerous: Boolean(options.isDangerous),
    defaultScope: options.defaultScope || 'department',
    protectedCore: options.protectedCore !== false
  });
}

const BASE_PERMISSIONS = {
  identityRead: perm('identity:read', 'identity', 'read', '查看账号、角色和责任配置', {
    defaultScope: 'global'
  }),
  directoryRead: perm('directory:read', 'directory', 'read', '读取3000统一组织与人员基础目录', {
    defaultScope: 'global'
  }),
  directoryMaintain: perm('directory:maintain', 'directory', 'maintain', '维护全公司组织架构与人员信息，保存直接生效并记录变更原因及前后内容', {
    isDangerous: true,
    defaultScope: 'global'
  }),
  identityManageAccount: perm('identity:manage-account', 'identity', 'manage-account', '创建、启用、停用和维护账号', {
    isDangerous: true,
    defaultScope: 'global'
  }),
  identityAssignRole: perm('identity:assign-role', 'identity', 'assign-role', '授予和撤销MDM工作角色', {
    isDangerous: true,
    defaultScope: 'global'
  }),
  identityReadAudit: perm('identity:read-audit', 'identity', 'read-audit', '查看账号和授权审计记录', {
    defaultScope: 'global'
  }),
  governanceReadGlobal: perm('governance:read-global', 'governance', 'read-global', '查看全公司治理材料', {
    defaultScope: 'global'
  }),
  governanceReadDepartment: perm('governance:read-department', 'governance', 'read-department', '查看本部门治理材料'),
  governanceReadAssignedContext: perm('governance:read-assigned-context', 'governance', 'read-assigned-context', '查看本人被分派事项及必要上下文', {
    defaultScope: 'self_task'
  }),
  governanceReadEscalatedContext: perm('governance:read-escalated-context', 'governance', 'read-escalated-context', '查看已升级重大争议及必要上下文', {
    defaultScope: 'self_task'
  }),
  governanceHandleAssignedWork: perm('governance:handle-assigned-work', 'governance', 'handle-assigned-work', '办理本人被明确分派的治理事项，不含审核发布', {
    defaultScope: 'self_task'
  }),
  governanceDraftDepartment: perm('governance:draft-department', 'governance', 'draft-department', '起草和修改本部门治理材料'),
  governanceSubmitDepartment: perm('governance:submit-department', 'governance', 'submit-department', '提交本部门治理材料'),
  governanceReviewDepartment: perm('governance:review-department', 'governance', 'review-department', '部门负责人本人核对和退回本部门治理材料'),
  governanceRecordDepartmentDecision: perm(
    'governance:record-department-decision',
    'governance',
    'record-department-decision',
    '由部门负责人本人作出并记录本部门最终确认',
    { isDangerous: true }
  ),
  governanceAssignWork: perm('governance:assign-work', 'governance', 'assign-work', '分派治理事项', {
    defaultScope: 'global'
  }),
  governanceStructureGate: perm('governance:structure-gate', 'governance', 'structure-gate', '检查结构、证据和责任链', {
    defaultScope: 'global'
  }),
  governancePublish: perm('governance:publish', 'governance', 'publish', '发布流程地图、数据地图和术语治理版本', {
    isDangerous: true,
    defaultScope: 'global'
  }),
  governanceQualityAudit: perm('governance:quality-audit', 'governance', 'quality-audit', '形成数据质量审计发现和整改要求', {
    defaultScope: 'global'
  }),
  governanceHandleAssignedConflict: perm(
    'governance:handle-assigned-conflict',
    'governance',
    'handle-assigned-conflict',
    '处理本人被分派的数据或术语冲突',
    { defaultScope: 'self_task' }
  ),
  governanceEscalateConflict: perm('governance:escalate-conflict', 'governance', 'escalate-conflict', '提请升级治理争议', {
    defaultScope: 'self_task'
  }),
  governanceDecideEscalation: perm('governance:decide-escalation', 'governance', 'decide-escalation', '决定已升级的重大争议', {
    isDangerous: true,
    defaultScope: 'self_task'
  })
};

// Transitional aliases let existing business routes move to the fixed model without
// granting the retired administrator business-write bypass.
const PERMISSION_ALIASES = Object.freeze({
  'dashboard:view': ['governance:read-department', 'governance:read-global'],
  'data:view_all': ['governance:read-global'],
  'data:view_department': ['governance:read-department'],
  'mapping:read': ['governance:read-department', 'governance:read-global'],
  'mapping:create': ['governance:draft-department'],
  'mapping:update': ['governance:draft-department'],
  'mapping:submit': ['governance:submit-department'],
  'review:approve': ['governance:review-department'],
  'process_governance:view_global': ['governance:read-global'],
  'process_governance:view_all': ['governance:read-global'],
  'process_governance:view_department': ['governance:read-department'],
  'process_governance:submit': ['governance:submit-department'],
  'process_governance:review': ['governance:review-department'],
  'process_evidence:verify': ['governance:structure-gate'],
  'process_quality:manage': ['governance:quality-audit'],
  'process_mapping:manage': ['governance:assign-work'],
  'process_mapping:close': ['governance:structure-gate'],
  'guidance:create': ['governance:assign-work', 'governance:quality-audit'],
  'guidance:respond': ['governance:draft-department'],
  'guidance:delegate': ['governance:record-department-decision'],
  'guidance:final_confirm': ['governance:record-department-decision'],
  'conflict:manage': ['governance:handle-assigned-conflict'],
  'conflict:resolve': ['governance:handle-assigned-conflict'],
  'conflict:escalate': ['governance:escalate-conflict'],
  'conflict:final_decide_escalated': ['governance:decide-escalation'],
  'quality:manage': ['governance:quality-audit'],
  'todos:manage': [
    'governance:assign-work',
    'governance:submit-department',
    'governance:review-department',
    'governance:handle-assigned-conflict'
  ],
  'rbac:manage': ['identity:assign-role'],
  'account:manage': ['identity:manage-account'],
  'person:manage': ['identity:manage-account'],
  'position:manage': ['identity:manage-account']
});

const LEGACY_ROLE_CODES = Object.freeze([
  'submitter',
  'owner',
  'reviewer',
  'it_lead',
  'project_lead',
  'workgroup_lead',
  'business_contact',
  'data_quality'
]);

const ROLE_GUIDES = [
  {
    code: 'admin',
    name: 'MDM系统管理员',
    group: 'system',
    description: '维护账号、角色授权和访问审计，并只读查看治理材料',
    goal: '保证3000的账号入口、授权记录和审计记录可用。',
    firstEntry: { label: '账号与授权', target: '#/rbac' },
    workflow: ['查找由行政人事维护的已有员工，为其开通待启用账号', '设置角色及有效期，按需补充授权依据', '核对后启用账号，必要时另行停用', '在该员工账号行查阅授权记录和访问审计'],
    sample: '行政人事先保存员工资料；管理员收到该员工姓名和工号后，在账号与授权办理中搜索并核对已有员工，先开通账号，再分别办理角色授权和启用。完成后在同一员工账号行查看状态及授权记录。',
    pitfall: '管理员不能审核、确认、修改或发布流程、数据和术语治理内容。',
    doneCriteria: '账号状态、部门、有效角色和审计记录一致；已填写的授权依据保持可追溯。',
    permissions: [
      BASE_PERMISSIONS.identityRead,
      BASE_PERMISSIONS.identityManageAccount,
      BASE_PERMISSIONS.identityAssignRole,
      BASE_PERMISSIONS.identityReadAudit,
      BASE_PERMISSIONS.governanceReadGlobal
    ],
    visibleTabs: visibleTabs('roleWorkbench', 'dashboard', 'orgUnits', 'persons', 'roleGuide', 'processGovernance', 'dataMap', 'publications', 'conflicts', 'quality', 'rbac')
  },
  {
    code: 'mdm_lead',
    name: 'MDM工作组组长',
    group: 'mdm',
    description: '分派治理事项，完成数据对象和生命周期治理，检查结构、证据和责任链，并发布治理版本',
    goal: '在业务流程事实已经明确的前提下，由MDM工作组完成数据对象、关键字段和生命周期治理，使流程地图、数据地图和术语版本具备发布条件。',
    firstEntry: { label: '查看数据治理工作包', target: '/app/data-governance' },
    workflow: ['查看全局治理事项', '处理数据生命周期治理工作包', '仅在缺少流程事实时向业务部门定向提问', '执行MDM结构卡口并发布'],
    sample: 'MDM工作组组长打开固定流程版本对应的工作包，核对待定数据对象、匹配建议、关键字段和生命周期规则；只有缺少业务事实时，才向具体部门发出一个可回答的问题。',
    pitfall: 'MDM工作组组长不能代替部门负责人确认业务事实，也不能直接改写部门材料。',
    doneCriteria: '发布版本具备完整责任证据、结构检查结果和版本记录。',
    permissions: [
      BASE_PERMISSIONS.governanceReadGlobal,
      BASE_PERMISSIONS.governanceAssignWork,
      BASE_PERMISSIONS.governanceStructureGate,
      BASE_PERMISSIONS.governancePublish,
      BASE_PERMISSIONS.governanceEscalateConflict
    ],
    visibleTabs: visibleTabs('roleWorkbench', 'roleGuide', 'processGovernance', 'dataMap', 'publications', 'conflicts', 'quality')
  },
  {
    code: 'mdm_steward',
    name: 'MDM治理经办人',
    group: 'mdm',
    description: '办理MDM组长明确分派的流程或工作包，保留治理依据，不审核或发布',
    goal: '将被分派事项的材料、证据和治理建议整理为可复核结果。',
    firstEntry: { label: '查看本人收到的待办', target: '/app/todos' },
    workflow: ['查看本人有效分派事项', '核对材料并记录治理说明', '办理被分派工作包的具体治理', '交由MDM组长审核'],
    sample: '经办人根据组长的明确分派，核对一个流程案例并记录依据；工作包另行分派后，在该工作包中整理对象和生命周期治理结果。',
    pitfall: '经办身份不授予全部治理材料读取权，不代替业务确认，也不允许正式审核、发布或完成工作包审核。',
    doneCriteria: '所办事项有当前来源、明确依据和办理记录，待审核事项交由有权主体处理。',
    permissions: [BASE_PERMISSIONS.governanceReadAssignedContext, BASE_PERMISSIONS.governanceHandleAssignedWork],
    visibleTabs: visibleTabs('roleWorkbench', 'roleGuide', 'processGovernance')
  },
  {
    code: 'department_contact',
    name: '部门主对接人',
    group: 'mdm',
    description: '起草、修改、提交和整改本部门流程事实，并答复MDM定向提出的业务事实问题',
    goal: '将本部门确认的流程事实整理为可审核材料；收到定向问题时，只补充事实和依据。',
    firstEntry: { label: '编制、保存和提交本部门流程', target: '/app/process-authoring' },
    workflow: ['在3000新建流程或从原案例继续编制', '保存草稿并补齐来源及实际参与部门', '提交后查看部门负责人核对结果，按退回意见续修', '答复MDM定向提出的业务事实问题'],
    sample: '部门主对接人收到“该状态在什么条件下失效”的定向问题后，回到制度或表单源文件核对，只填写触发条件和来源位置，不判断它是不是主数据。',
    pitfall: '主对接人不能认定主数据、合并统一对象、决定关键字段或制定生命周期治理规则。',
    doneCriteria: '本部门流程事实已提交；定向问题已有明确答复和可定位依据，未代替MDM作出治理判断。',
    permissions: [
      BASE_PERMISSIONS.governanceReadDepartment,
      BASE_PERMISSIONS.governanceDraftDepartment,
      BASE_PERMISSIONS.governanceSubmitDepartment
    ],
    visibleTabs: visibleTabs('roleWorkbench', 'roleGuide', 'processGovernance', 'dataMap')
  },
  {
    code: 'department_mdm_reviewer',
    name: '部门负责人',
    group: 'mdm',
    description: '由部门最终负责人本人核对本部门流程事实并作出最终确认，不设置中间审核员或代记录决定',
    goal: '由已登记且具有本部门有效授权的部门负责人，对主对接人提交的流程事实和依据直接核对并最终确认。',
    firstEntry: { label: '查看本部门流程核对事项', target: '/app/process-preview' },
    workflow: ['查看主对接人提交的本部门事项', '核对当前内容及依据', '本人最终确认或退回修改', '内容变化时重新核对确认'],
    sample: '部门负责人按当前案例、修订和内容摘要核对本部门一侧，亲自填写决定及依据；内容变化时重新确认，不代替另一部门决定。',
    pitfall: '角色授权必须与部门最终负责人登记一致；不能由其他人员代确认，也不代替MDM开展数据治理或发布。',
    doneCriteria: '本部门当前内容具有部门负责人本人确认、来源摘要和依据，未完成或不一致事项明确保留。',
    permissions: [
      BASE_PERMISSIONS.governanceReadDepartment,
      BASE_PERMISSIONS.governanceReviewDepartment,
      BASE_PERMISSIONS.governanceRecordDepartmentDecision
    ],
    visibleTabs: visibleTabs('roleWorkbench', 'roleGuide', 'processGovernance', 'dataMap')
  },
  {
    code: 'data_conflict_handler',
    name: '数据冲突处理人',
    group: 'mdm',
    description: '处理本人被明确分派的数据或术语冲突，并提请升级',
    goal: '形成可供相关部门确认或项目决策组判断的冲突证据。',
    firstEntry: { label: '冲突管理', target: '#/conflicts' },
    workflow: ['查看本人被分派的数据或术语冲突', '记录相关立场和证据', '记录协调结果', '按当前事项状态处理或提请升级'],
    sample: '冲突处理人从冲突管理查看本人被分派的事项，核对实际字段或术语、相关立场和证据，再按现行状态记录协调结果或提请升级。',
    pitfall: '拥有冲突处理角色不代表可以查看或处理全部冲突。',
    doneCriteria: '本人被分派事项已有可追溯的协调结果或明确升级记录。',
    permissions: [
      BASE_PERMISSIONS.governanceReadAssignedContext,
      BASE_PERMISSIONS.governanceHandleAssignedConflict,
      BASE_PERMISSIONS.governanceEscalateConflict
    ],
    visibleTabs: visibleTabs('roleWorkbench', 'roleGuide', 'processGovernance', 'conflicts')
  },
  {
    code: 'data_quality_auditor',
    name: '数据质量审计人',
    group: 'mdm',
    description: '检查数据治理信息并形成审计发现和整改要求',
    goal: '识别数据完整性、准确性和一致性问题，并跟踪整改证据。',
    firstEntry: { label: '查看字段治理统计', target: '#/quality' },
    workflow: ['在“数据质量”查阅字段治理统计', '核对统计范围；字段数量不表示质量合格', '需要核对已发布字段时，进入“数据地图台账”查阅'],
    sample: '数据质量审计人进入“数据质量”，点击“刷新字段统计”，在下方查看当前范围内的现行受控字段和旧资料统计；本页尚未提供审计发现登记、整改要求记录或整改复核办理。',
    pitfall: '审计人不能替部门修改源数据，也不能发布数据地图。',
    doneCriteria: '审计职责仍以有依据的结论，以及具备责任部门、处理状态和复核记录的整改事项为完成标准。当前入口只供统计查阅，不能据此认定审计已完成。',
    permissions: [
      BASE_PERMISSIONS.governanceReadGlobal,
      BASE_PERMISSIONS.governanceQualityAudit
    ],
    visibleTabs: visibleTabs('roleWorkbench', 'roleGuide', 'dataMap', 'quality')
  },
  {
    code: 'decision_group',
    name: '项目决策组',
    group: 'mdm',
    description: '决定已经升级的重大跨部门争议',
    goal: '处理常规协调无法解决且已具备完整证据的重大争议。',
    firstEntry: { label: '冲突管理', target: '#/conflicts' },
    workflow: ['查看已升级的重大争议', '核对相关立场和协调证据', '按当前事项允许的动作作出决定', '记录决定依据'],
    sample: '项目决策组从冲突管理核对已经升级的争议和现有证据，只按该事项当前允许的动作办理并记录依据。',
    pitfall: '项目决策组不处理日常编辑、部门审核、版本发布或账号管理。',
    doneCriteria: '升级事项已有决定、依据、影响范围和后续责任记录。',
    permissions: [
      BASE_PERMISSIONS.governanceReadEscalatedContext,
      BASE_PERMISSIONS.governanceDecideEscalation
    ],
    visibleTabs: visibleTabs('roleWorkbench', 'roleGuide', 'processGovernance', 'conflicts')
  },
  {
    code: 'hr_directory_manager',
    name: '行政人事信息维护员',
    group: 'directory',
    description: '由行政人事部维护全公司组织架构与人员信息，3000作为全域统一读取的人员真源',
    goal: '保持组织架构与人员信息准确，并使每次变更可追溯。',
    firstEntry: { label: '组织架构与花名册', target: '#/persons' },
    workflow: ['核对组织架构和人员现状', '录入变更内容与原因', '保存后直接生效', '核对修改前后内容及操作记录'],
    sample: '行政人事信息维护员确认人员所属部门变动后，选择目标部门、填写变更原因并保存；统一目录随后提供当前人员信息。',
    pitfall: '人员与组织维护不授予账号开通、角色授权或治理审核发布权限。',
    doneCriteria: '组织与人员信息已保存，修改前后内容、操作人和原因可追溯。',
    permissions: [BASE_PERMISSIONS.identityRead, BASE_PERMISSIONS.directoryRead, BASE_PERMISSIONS.directoryMaintain],
    visibleTabs: visibleTabs('roleWorkbench', 'orgUnits', 'persons', 'roleGuide')
  }
];

const RACI_ACTIVITIES = Object.freeze([
  {
    activityCode: 'governance.assigned.work',
    domain: 'governance',
    name: '办理明确分派的治理事项',
    responsible: ['mdm_steward'],
    accountable: ['mdm_lead'],
    consulted: ['department_contact', 'process_business_owner'],
    informed: ['department_mdm_reviewer'],
    requiredPermissions: ['governance:handle-assigned-work'],
    scopeRule: 'assigned_target',
    evidenceRule: '必须存在有效显式分派；案例办理记录绑定来源修订摘要；不授予审核发布权'
  },
  {
    activityCode: 'identity.lifecycle',
    domain: 'identity',
    name: '账号及角色生命周期',
    responsible: ['admin'],
    accountable: ['admin'],
    consulted: [],
    informed: ['account_holder'],
    requiredPermissions: ['identity:manage-account', 'identity:assign-role'],
    scopeRule: 'global',
    evidenceRule: '账号和授权操作必须写入访问审计记录'
  },
  {
    activityCode: 'department.material.prepare',
    domain: 'governance',
    name: '部门流程、数据和术语材料起草',
    responsible: ['department_contact'],
    accountable: ['department_final_responsible_person'],
    consulted: ['business_expert'],
    informed: ['mdm_lead'],
    requiredPermissions: ['governance:draft-department', 'governance:submit-department'],
    scopeRule: 'own_department',
    evidenceRule: '部门负责人由departments.final_responsible_person_id确定'
  },
  {
    activityCode: 'department.decision.record',
    domain: 'governance',
    name: '部门负责人本人最终确认及跨部门确认',
    responsible: ['department_mdm_reviewer'],
    accountable: ['department_final_responsible_person'],
    consulted: ['department_contact', 'related_department_final_responsible_person'],
    informed: ['mdm_lead'],
    requiredPermissions: ['governance:record-department-decision'],
    scopeRule: 'own_department',
    evidenceRule: '主对接人提交后，由当前部门最终负责人且具备本部门有效授权者本人核对并最终确认；确认人和最终责任人一致，绑定当前修订与摘要，不设中间审核员'
  },
  {
    activityCode: 'department.material.correct',
    domain: 'governance',
    name: '部门材料整改',
    responsible: ['department_contact'],
    accountable: ['department_final_responsible_person'],
    consulted: ['department_mdm_reviewer', 'data_quality_auditor'],
    informed: ['mdm_lead'],
    requiredPermissions: ['governance:draft-department'],
    scopeRule: 'own_department',
    evidenceRule: '整改结果保留变更和复核记录'
  },
  {
    activityCode: 'data.quality.audit',
    domain: 'data',
    name: '数据质量审计结论',
    responsible: ['data_quality_auditor'],
    accountable: ['data_quality_auditor'],
    consulted: ['department_contact', 'department_mdm_reviewer'],
    informed: ['mdm_lead', 'department_final_responsible_person'],
    requiredPermissions: ['governance:quality-audit'],
    scopeRule: 'global_read_audit_write',
    evidenceRule: '审计结论必须记录依据和整改要求'
  },
  {
    activityCode: 'governance.conflict.coordinate',
    domain: 'governance',
    name: '普通冲突协调',
    responsible: ['data_conflict_handler'],
    accountable: ['affected_department_final_responsible_person'],
    consulted: ['department_mdm_reviewer', 'data_quality_auditor'],
    informed: ['mdm_lead'],
    requiredPermissions: ['governance:handle-assigned-conflict'],
    scopeRule: 'assigned_conflict_only',
    evidenceRule: '每个受影响部门分别记录决定'
  },
  {
    activityCode: 'governance.conflict.escalated-decision',
    domain: 'governance',
    name: '重大争议升级决策',
    responsible: ['data_conflict_handler', 'mdm_lead'],
    accountable: ['decision_group'],
    consulted: ['affected_department_final_responsible_person', 'department_mdm_reviewer'],
    informed: ['department_contact'],
    requiredPermissions: ['governance:decide-escalation'],
    scopeRule: 'escalated_conflict_only',
    evidenceRule: '事项必须已经升级并具备争议证据'
  },
  {
    activityCode: 'process.handoff.acceptance',
    domain: 'process',
    name: '跨部门承接确认',
    responsible: ['department_mdm_reviewer'],
    accountable: ['origin_department_final_responsible_person', 'counterparty_department_final_responsible_person'],
    consulted: ['department_contact', 'business_expert', 'mdm_lead'],
    informed: ['admin'],
    requiredPermissions: [
      'governance:record-department-decision'
    ],
    scopeRule: 'handoff_participant_and_department',
    evidenceRule: '参与部门负责人分别本人确认本部门一侧；保留当前修订、步骤、确认人、部门、时间、依据和退回分支'
  },
  {
    activityCode: 'process.handoff-conflict.coordinate',
    domain: 'process',
    name: '承接冲突协调',
    responsible: ['data_conflict_handler'],
    accountable: ['mdm_lead'],
    consulted: ['origin_department_final_responsible_person', 'counterparty_department_final_responsible_person'],
    informed: ['decision_group'],
    requiredPermissions: ['governance:handle-assigned-conflict', 'governance:escalate-conflict'],
    scopeRule: 'assigned_handoff_conflict_only',
    evidenceRule: '双方立场、证据、协调方案和部门确认记录只追加保留'
  },
  {
    activityCode: 'process.handoff-conflict.decision',
    domain: 'process',
    name: '承接冲突升级决策',
    responsible: ['decision_group'],
    accountable: ['decision_group'],
    consulted: ['data_conflict_handler', 'affected_department_final_responsible_person'],
    informed: ['mdm_lead', 'department_contact'],
    requiredPermissions: ['governance:decide-escalation'],
    scopeRule: 'escalated_handoff_conflict_only',
    evidenceRule: '只能选择继续承接、认定无需承接或退回修订，并记录依据'
  },
  {
    activityCode: 'governance.version.publish',
    domain: 'governance',
    name: '流程地图、数据地图和术语版本发布',
    responsible: ['mdm_lead'],
    accountable: ['mdm_lead'],
    consulted: ['department_mdm_reviewer', 'data_quality_auditor'],
    informed: ['decision_group', 'admin'],
    requiredPermissions: ['governance:publish'],
    scopeRule: 'global',
    evidenceRule: '所需部门决定完整、阻断问题关闭、结构和版本检查通过'
  }
]);

const PROJECT_ROLE_DEFINITIONS = ROLE_GUIDES
  .filter(role => role.group === 'mdm')
  .map(role => ({
    roleCode: role.code,
    roleName: role.name,
    description: role.description,
    permissions: role.permissions || []
  }));

function permissionSetHas(permSet, requestedCode) {
  if (!permSet || !requestedCode) return false;
  if (permSet.has(requestedCode)) return true;
  const aliases = PERMISSION_ALIASES[requestedCode] || [];
  return aliases.some(code => permSet.has(code));
}

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

  for (const role of ROLE_GUIDES) {
    for (const permission of role.permissions) insertPermission.run(...permission);
    upsertRole.run(role.code, role.name, role.description, assignedBy);
    const row = roleByCode.get(role.code);
    db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(row.role_id);
    for (const [permCode] of role.permissions) linkPermission.run(row.role_id, permCode);
  }

  for (const roleCode of LEGACY_ROLE_CODES) {
    const row = roleByCode.get(roleCode);
    if (row) db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(row.role_id);
  }
}

function getAccessModel() {
  const permissions = [];
  const seen = new Set();
  for (const role of ROLE_GUIDES) {
    for (const permission of role.permissions || []) {
      if (seen.has(permission.code)) continue;
      seen.add(permission.code);
      permissions.push({
        code: permission.code,
        resource: permission.resource,
        action: permission.action,
        description: permission.description,
        defaultScope: permission.defaultScope,
        isDangerous: permission.isDangerous
      });
    }
  }
  return {
    modelVersion: ACCESS_MODEL_VERSION,
    roles: ROLE_GUIDES.map(role => ({
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
      permissions: (role.permissions || []).map(permission => permission.code),
      visibleTabs: (role.visibleTabs || []).map(tab => ({ ...tab })),
      raciResponsibilities: RACI_ACTIVITIES
        .filter(activity => [
          ...(activity.responsible || []),
          ...(activity.accountable || []),
          ...(activity.consulted || []),
          ...(activity.informed || [])
        ].includes(role.code))
        .map(activity => ({
          activityCode: activity.activityCode,
          name: activity.name,
          raci: {
            responsible: (activity.responsible || []).includes(role.code),
            accountable: (activity.accountable || []).includes(role.code),
            consulted: (activity.consulted || []).includes(role.code),
            informed: (activity.informed || []).includes(role.code)
          }
        }))
    })),
    permissions,
    activities: RACI_ACTIVITIES.map(activity => ({ ...activity }))
  };
}

module.exports = {
  ACCESS_MODEL_VERSION,
  BASE_PERMISSIONS,
  LEGACY_ROLE_CODES,
  PERMISSION_ALIASES,
  PROJECT_ROLE_DEFINITIONS,
  RACI_ACTIVITIES,
  ROLE_GUIDES,
  VISIBLE_TABS,
  ensureProjectRoles,
  getAccessModel,
  permissionSetHas
};
