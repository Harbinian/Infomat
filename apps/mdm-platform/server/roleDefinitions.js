const ACCESS_MODEL_VERSION = 'rbac-raci-v3-2026-07-31';

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
  governanceDraftDepartment: perm('governance:draft-department', 'governance', 'draft-department', '起草和修改本部门治理材料'),
  governanceSubmitDepartment: perm('governance:submit-department', 'governance', 'submit-department', '提交本部门治理材料'),
  governanceReviewDepartment: perm('governance:review-department', 'governance', 'review-department', '审核和退回本部门治理材料'),
  governanceRecordDepartmentDecision: perm(
    'governance:record-department-decision',
    'governance',
    'record-department-decision',
    '记录部门负责人已经在线下作出的决定',
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
    workflow: ['手工创建待启用账号', '记录角色授权依据', '启用或停用账号', '检查访问审计'],
    sample: '管理员收到已确认的账号开通信息后，录入人员、部门和MDM工作角色，记录授权依据，再明确启用账号。',
    pitfall: '管理员不能审核、确认、修改或发布流程、数据和术语治理内容。',
    doneCriteria: '账号状态、部门、有效角色、授权依据和审计记录一致。',
    permissions: [
      BASE_PERMISSIONS.identityRead,
      BASE_PERMISSIONS.identityManageAccount,
      BASE_PERMISSIONS.identityAssignRole,
      BASE_PERMISSIONS.identityReadAudit,
      BASE_PERMISSIONS.governanceReadGlobal
    ],
    visibleTabs: visibleTabs('roleWorkbench', 'roleGuide', 'processGovernance', 'dataMap', 'conflicts', 'quality', 'rbac')
  },
  {
    code: 'mdm_lead',
    name: 'MDM工作组组长',
    group: 'mdm',
    description: '分派治理事项，完成数据对象和生命周期治理，检查结构、证据和责任链，并发布治理版本',
    goal: '在业务流程事实已经明确的前提下，由MDM工作组完成数据对象、关键字段和生命周期治理，使流程地图、数据地图和术语版本具备发布条件。',
    firstEntry: { label: '跨部门承接待办', target: '#/processGovernance?workspace=handoffs' },
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
    visibleTabs: visibleTabs('roleWorkbench', 'roleGuide', 'processGovernance', 'dataMap', 'conflicts', 'quality')
  },
  {
    code: 'department_contact',
    name: '部门主对接人',
    group: 'mdm',
    description: '起草、修改、提交和整改本部门流程事实，并答复MDM定向提出的业务事实问题',
    goal: '将本部门确认的流程事实整理为可审核材料；收到定向问题时，只补充事实和依据。',
    firstEntry: { label: '流程编制', target: '#/processGovernance?workspace=editor' },
    workflow: ['编制或导入单流程治理JSON', '补充本部门流程事实', '答复定向业务事实问题', '提交部门审核'],
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
    name: '部门MDM审核员',
    group: 'mdm',
    description: '审核本部门流程事实和定向事实答复，并记录部门负责人已经在线下作出的决定',
    goal: '保证部门提供的流程事实和依据真实可追溯，不代替MDM工作组开展数据治理。',
    firstEntry: { label: '跨部门承接待办', target: '#/processGovernance?workspace=handoffs' },
    workflow: ['审核本部门流程草稿', '确认承接范围', '审核实际承接内容', '记录部门负责人决定'],
    sample: '部门负责人在线下确认承接范围后，部门MDM审核员在承接故事链中记录决定、依据和决定时间。',
    pitfall: '审核员只能记录已经作出的决定，不能把个人判断写成部门负责人决定。',
    doneCriteria: '审核结果、部门负责人、决定依据和记录人均可追溯。',
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
    firstEntry: { label: '承接冲突待办', target: '#/processGovernance?workspace=conflicts' },
    workflow: ['查看本人被分派的承接冲突', '记录双方立场和证据', '提出协调方案', '组织确认或提请项目决策'],
    sample: '冲突处理人只查看本人被分派的承接冲突，记录双方立场、证据和协调方案，再等待双方审核员确认。',
    pitfall: '拥有冲突处理角色不代表可以查看或处理全部冲突。',
    doneCriteria: '冲突已有协调记录、部门确认结果或明确升级记录。',
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
    firstEntry: { label: '数据质量', target: '#/quality' },
    workflow: ['查看全局数据治理信息', '记录审计发现', '提出整改要求', '复核整改证据'],
    sample: '数据质量审计人发现字段来源缺少证据时，记录具体字段、问题依据和整改要求。',
    pitfall: '审计人不能替部门修改源数据，也不能发布数据地图。',
    doneCriteria: '审计结论有依据，整改事项有责任部门、处理状态和复核记录。',
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
    firstEntry: { label: '承接冲突待办', target: '#/processGovernance?workspace=conflicts' },
    workflow: ['查看已升级承接冲突', '核对双方立场和协调方案', '选择规定的处理结论', '记录决定依据'],
    sample: '项目决策组只处理已经升级的承接冲突，并在继续承接、无需承接或退回修订中选择处理结论。',
    pitfall: '项目决策组不处理日常编辑、部门审核、版本发布或账号管理。',
    doneCriteria: '升级事项已有决定、依据、影响范围和后续责任记录。',
    permissions: [
      BASE_PERMISSIONS.governanceReadEscalatedContext,
      BASE_PERMISSIONS.governanceDecideEscalation
    ],
    visibleTabs: visibleTabs('roleWorkbench', 'roleGuide', 'processGovernance', 'conflicts')
  }
];

const RACI_ACTIVITIES = Object.freeze([
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
    consulted: ['department_mdm_reviewer', 'business_expert'],
    informed: ['mdm_lead'],
    requiredPermissions: ['governance:draft-department', 'governance:submit-department'],
    scopeRule: 'own_department',
    evidenceRule: '部门负责人由departments.final_responsible_person_id确定'
  },
  {
    activityCode: 'department.decision.record',
    domain: 'governance',
    name: '记录部门决定及跨部门确认',
    responsible: ['department_mdm_reviewer'],
    accountable: ['department_final_responsible_person'],
    consulted: ['department_contact', 'related_department_reviewer'],
    informed: ['mdm_lead'],
    requiredPermissions: ['governance:record-department-decision'],
    scopeRule: 'own_department',
    evidenceRule: '必须记录决定、依据、决定时间和系统确认的最终责任人'
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
    responsible: ['department_contact', 'department_mdm_reviewer', 'mdm_lead'],
    accountable: ['origin_department_final_responsible_person', 'counterparty_department_final_responsible_person'],
    consulted: ['business_expert'],
    informed: ['admin'],
    requiredPermissions: [
      'governance:draft-department',
      'governance:record-department-decision',
      'governance:structure-gate'
    ],
    scopeRule: 'handoff_participant_and_department',
    evidenceRule: '故事链必须保留步骤、处理人、部门、时间、依据和退回分支'
  },
  {
    activityCode: 'process.handoff-conflict.coordinate',
    domain: 'process',
    name: '承接冲突协调',
    responsible: ['data_conflict_handler'],
    accountable: ['mdm_lead'],
    consulted: ['origin_department_mdm_reviewer', 'counterparty_department_mdm_reviewer'],
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
