// Frozen migration contract for the supported v3 to v4 step.
// Never import the current runtime model here: later roles must not alter old migrations.
const ACCESS_MODEL_VERSION = "rbac-raci-v4-2026-10-19";
const ROLE_GUIDES = [
  {
    "code": "admin",
    "name": "MDM系统管理员",
    "description": "维护账号、角色授权和访问审计，并只读查看治理材料",
    "permissions": [
      {
        "code": "identity:read",
        "resource": "identity",
        "action": "read",
        "description": "查看账号、角色和责任配置",
        "defaultScope": "global"
      },
      {
        "code": "identity:manage-account",
        "resource": "identity",
        "action": "manage-account",
        "description": "创建、启用、停用和维护账号",
        "defaultScope": "global"
      },
      {
        "code": "identity:assign-role",
        "resource": "identity",
        "action": "assign-role",
        "description": "授予和撤销MDM工作角色",
        "defaultScope": "global"
      },
      {
        "code": "identity:read-audit",
        "resource": "identity",
        "action": "read-audit",
        "description": "查看账号和授权审计记录",
        "defaultScope": "global"
      },
      {
        "code": "governance:read-global",
        "resource": "governance",
        "action": "read-global",
        "description": "查看全公司治理材料",
        "defaultScope": "global"
      }
    ]
  },
  {
    "code": "mdm_lead",
    "name": "MDM工作组组长",
    "description": "分派治理事项，完成数据对象和生命周期治理，检查结构、证据和责任链，并发布治理版本",
    "permissions": [
      {
        "code": "governance:read-global",
        "resource": "governance",
        "action": "read-global",
        "description": "查看全公司治理材料",
        "defaultScope": "global"
      },
      {
        "code": "governance:assign-work",
        "resource": "governance",
        "action": "assign-work",
        "description": "分派治理事项",
        "defaultScope": "global"
      },
      {
        "code": "governance:structure-gate",
        "resource": "governance",
        "action": "structure-gate",
        "description": "检查结构、证据和责任链",
        "defaultScope": "global"
      },
      {
        "code": "governance:publish",
        "resource": "governance",
        "action": "publish",
        "description": "发布流程地图、数据地图和术语治理版本",
        "defaultScope": "global"
      },
      {
        "code": "governance:escalate-conflict",
        "resource": "governance",
        "action": "escalate-conflict",
        "description": "提请升级治理争议",
        "defaultScope": "self_task"
      }
    ]
  },
  {
    "code": "mdm_steward",
    "name": "MDM治理经办人",
    "description": "办理MDM组长明确分派的流程或工作包，保留治理依据，不审核或发布",
    "permissions": [
      {
        "code": "governance:read-assigned-context",
        "resource": "governance",
        "action": "read-assigned-context",
        "description": "查看本人被分派事项及必要上下文",
        "defaultScope": "self_task"
      },
      {
        "code": "governance:handle-assigned-work",
        "resource": "governance",
        "action": "handle-assigned-work",
        "description": "办理本人被明确分派的治理事项，不含审核发布",
        "defaultScope": "self_task"
      }
    ]
  },
  {
    "code": "department_contact",
    "name": "部门主对接人",
    "description": "起草、修改、提交和整改本部门流程事实，并答复MDM定向提出的业务事实问题",
    "permissions": [
      {
        "code": "governance:read-department",
        "resource": "governance",
        "action": "read-department",
        "description": "查看本部门治理材料",
        "defaultScope": "department"
      },
      {
        "code": "governance:draft-department",
        "resource": "governance",
        "action": "draft-department",
        "description": "起草和修改本部门治理材料",
        "defaultScope": "department"
      },
      {
        "code": "governance:submit-department",
        "resource": "governance",
        "action": "submit-department",
        "description": "提交本部门治理材料",
        "defaultScope": "department"
      }
    ]
  },
  {
    "code": "department_mdm_reviewer",
    "name": "部门MDM审核员",
    "description": "审核本部门流程事实和定向事实答复，并记录部门负责人已经在线下作出的决定",
    "permissions": [
      {
        "code": "governance:read-department",
        "resource": "governance",
        "action": "read-department",
        "description": "查看本部门治理材料",
        "defaultScope": "department"
      },
      {
        "code": "governance:review-department",
        "resource": "governance",
        "action": "review-department",
        "description": "审核和退回本部门治理材料",
        "defaultScope": "department"
      },
      {
        "code": "governance:record-department-decision",
        "resource": "governance",
        "action": "record-department-decision",
        "description": "记录部门负责人已经在线下作出的决定",
        "defaultScope": "department"
      }
    ]
  },
  {
    "code": "data_conflict_handler",
    "name": "数据冲突处理人",
    "description": "处理本人被明确分派的数据或术语冲突，并提请升级",
    "permissions": [
      {
        "code": "governance:read-assigned-context",
        "resource": "governance",
        "action": "read-assigned-context",
        "description": "查看本人被分派事项及必要上下文",
        "defaultScope": "self_task"
      },
      {
        "code": "governance:handle-assigned-conflict",
        "resource": "governance",
        "action": "handle-assigned-conflict",
        "description": "处理本人被分派的数据或术语冲突",
        "defaultScope": "self_task"
      },
      {
        "code": "governance:escalate-conflict",
        "resource": "governance",
        "action": "escalate-conflict",
        "description": "提请升级治理争议",
        "defaultScope": "self_task"
      }
    ]
  },
  {
    "code": "data_quality_auditor",
    "name": "数据质量审计人",
    "description": "检查数据治理信息并形成审计发现和整改要求",
    "permissions": [
      {
        "code": "governance:read-global",
        "resource": "governance",
        "action": "read-global",
        "description": "查看全公司治理材料",
        "defaultScope": "global"
      },
      {
        "code": "governance:quality-audit",
        "resource": "governance",
        "action": "quality-audit",
        "description": "形成数据质量审计发现和整改要求",
        "defaultScope": "global"
      }
    ]
  },
  {
    "code": "decision_group",
    "name": "项目决策组",
    "description": "决定已经升级的重大跨部门争议",
    "permissions": [
      {
        "code": "governance:read-escalated-context",
        "resource": "governance",
        "action": "read-escalated-context",
        "description": "查看已升级重大争议及必要上下文",
        "defaultScope": "self_task"
      },
      {
        "code": "governance:decide-escalation",
        "resource": "governance",
        "action": "decide-escalation",
        "description": "决定已升级的重大争议",
        "defaultScope": "self_task"
      }
    ]
  }
];
module.exports = { ACCESS_MODEL_VERSION, ROLE_GUIDES };
