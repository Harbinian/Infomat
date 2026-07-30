const ACCESS_MODEL_VERSION = 'rbac-raci-v2-2026-07-30';

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
    ]
  },
  {
    code: 'mdm_lead',
    name: 'MDM工作组组长',
    group: 'mdm',
    description: '分派治理事项，检查结构、证据和责任链，并发布治理版本',
    goal: '在业务责任已经明确的前提下，使流程地图、数据地图和术语版本具备发布条件。',
    firstEntry: { label: '治理工作台', target: '#/roleWorkbench' },
    workflow: ['查看全局治理事项', '分派处理任务', '检查结构与证据', '确认责任链后发布'],
    sample: 'MDM工作组组长发布数据地图前，检查所需部门决定、阻断问题和版本检查结果是否完整。',
    pitfall: 'MDM工作组组长不能代替部门负责人确认业务事实，也不能直接改写部门材料。',
    doneCriteria: '发布版本具备完整责任证据、结构检查结果和版本记录。',
    permissions: [
      BASE_PERMISSIONS.governanceReadGlobal,
      BASE_PERMISSIONS.governanceAssignWork,
      BASE_PERMISSIONS.governanceStructureGate,
      BASE_PERMISSIONS.governancePublish,
      BASE_PERMISSIONS.governanceEscalateConflict
    ]
  },
  {
    code: 'department_contact',
    name: '部门主对接人',
    group: 'mdm',
    description: '起草、修改、提交和整改本部门治理材料',
    goal: '将本部门确认的流程、数据和术语事实整理为可审核材料。',
    firstEntry: { label: '本部门治理事项', target: '#/processGovernance' },
    workflow: ['补充本部门材料', '处理整改事项', '检查内容完整性', '提交部门审核'],
    sample: '部门主对接人根据制度、表单和业务人员说明补充流程材料，再提交部门MDM审核员审核。',
    pitfall: '主对接人负责组织和整理，不能代替部门负责人作出最终业务决定。',
    doneCriteria: '本部门材料已提交，缺失信息和暂不能确认事项均有明确记录。',
    permissions: [
      BASE_PERMISSIONS.governanceReadDepartment,
      BASE_PERMISSIONS.governanceDraftDepartment,
      BASE_PERMISSIONS.governanceSubmitDepartment
    ]
  },
  {
    code: 'department_mdm_reviewer',
    name: '部门MDM审核员',
    group: 'mdm',
    description: '审核本部门材料，并记录部门负责人已经在线下作出的决定',
    goal: '保证部门材料符合要求，并使部门最终责任可以追溯。',
    firstEntry: { label: '部门审核事项', target: '#/roleWorkbench' },
    workflow: ['检查本部门材料', '退回或提交确认', '记录部门负责人决定', '核对跨部门确认'],
    sample: '部门负责人在线下确认流程事实后，部门MDM审核员在3000记录决定、依据和决定时间。',
    pitfall: '审核员只能记录已经作出的决定，不能把个人判断写成部门负责人决定。',
    doneCriteria: '审核结果、部门负责人、决定依据和记录人均可追溯。',
    permissions: [
      BASE_PERMISSIONS.governanceReadDepartment,
      BASE_PERMISSIONS.governanceReviewDepartment,
      BASE_PERMISSIONS.governanceRecordDepartmentDecision
    ]
  },
  {
    code: 'data_conflict_handler',
    name: '数据冲突处理人',
    group: 'mdm',
    description: '处理本人被明确分派的数据或术语冲突，并提请升级',
    goal: '形成可供相关部门确认或项目决策组判断的冲突证据。',
    firstEntry: { label: '已分派冲突', target: '#/conflicts' },
    workflow: ['查看被分派事项', '核对双方材料', '记录协调过程', '解决或提请升级'],
    sample: '数据冲突处理人只查看本人被分派的冲突及相关上下文，并记录各部门意见和未决分歧。',
    pitfall: '拥有冲突处理角色不代表可以查看或处理全部冲突。',
    doneCriteria: '冲突已有协调记录、部门确认结果或明确升级记录。',
    permissions: [
      BASE_PERMISSIONS.governanceReadAssignedContext,
      BASE_PERMISSIONS.governanceHandleAssignedConflict,
      BASE_PERMISSIONS.governanceEscalateConflict
    ]
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
    ]
  },
  {
    code: 'decision_group',
    name: '项目决策组',
    group: 'mdm',
    description: '决定已经升级的重大跨部门争议',
    goal: '处理常规协调无法解决且已具备完整证据的重大争议。',
    firstEntry: { label: '升级事项', target: '#/conflicts' },
    workflow: ['查看已升级事项', '核对争议证据', '形成决定', '记录后续责任'],
    sample: '项目决策组只处理已经升级的事项，并根据受影响部门意见、流程事实和数据证据形成决定。',
    pitfall: '项目决策组不处理日常编辑、部门审核、版本发布或账号管理。',
    doneCriteria: '升级事项已有决定、依据、影响范围和后续责任记录。',
    permissions: [
      BASE_PERMISSIONS.governanceReadEscalatedContext,
      BASE_PERMISSIONS.governanceDecideEscalation
    ]
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
      permissions: (role.permissions || []).map(permission => permission.code)
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
  ensureProjectRoles,
  getAccessModel,
  permissionSetHas
};
