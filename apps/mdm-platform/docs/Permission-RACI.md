# 3000 权限与 RACI 说明

## 1. 固定模型

当前模型版本为`rbac-raci-v2-2026-07-30`。角色、权限包和RACI由代码和测试固化，管理页面只读。

MDM工作角色只用于3000治理授权，不等同于：

- `person`人员身份；
- 人员岗位；
- 正式流程工作角色`WR-*`；
- 制度或源文件中的原文角色称谓。

## 2. 权限清单

### 2.1 身份管理

| 权限码 | 含义 |
|---|---|
| `identity:read` | 查看账号、角色和责任配置 |
| `identity:manage-account` | 创建、启用、停用和维护账号 |
| `identity:assign-role` | 授予和撤销MDM工作角色 |
| `identity:read-audit` | 查看账号和授权审计记录 |

### 2.2 治理读取

| 权限码 | 含义 |
|---|---|
| `governance:read-global` | 查看全公司治理材料 |
| `governance:read-department` | 查看本部门治理材料 |
| `governance:read-assigned-context` | 查看本人被分派事项及必要上下文 |
| `governance:read-escalated-context` | 查看已升级重大争议及必要上下文 |

### 2.3 部门治理

| 权限码 | 含义 |
|---|---|
| `governance:draft-department` | 起草和修改本部门治理材料 |
| `governance:submit-department` | 提交本部门治理材料 |
| `governance:review-department` | 审核和退回本部门治理材料 |
| `governance:record-department-decision` | 记录部门负责人已经在线下作出的决定 |

### 2.4 全局治理

| 权限码 | 含义 |
|---|---|
| `governance:assign-work` | 分派治理事项 |
| `governance:structure-gate` | 检查结构、证据和责任链 |
| `governance:publish` | 发布流程地图、数据地图和术语治理版本 |

### 2.5 质量与冲突

| 权限码 | 含义 |
|---|---|
| `governance:quality-audit` | 形成数据质量审计发现和整改要求 |
| `governance:handle-assigned-conflict` | 处理本人被分派的数据或术语冲突 |
| `governance:escalate-conflict` | 提请升级治理争议 |
| `governance:decide-escalation` | 决定已升级的重大争议 |

## 3. 角色权限矩阵

| 角色 | 读取范围 | 写入权限 |
|---|---|---|
| `admin` | 全局治理只读；身份全局 | `identity:manage-account`、`identity:assign-role`；无业务写权限 |
| `mdm_lead` | 全局治理 | 分派、结构卡口、发布、升级 |
| `department_contact` | 本部门 | 起草、修改、提交 |
| `department_mdm_reviewer` | 本部门 | 审核、退回、记录部门决定 |
| `data_conflict_handler` | 本人被分派事项 | 处理被分派冲突、提请升级 |
| `data_quality_auditor` | 全局数据治理 | 审计发现和整改要求 |
| `decision_group` | 已升级事项 | 决定已升级重大争议 |

禁止使用`*:*`。固定角色不得继承自定义角色，也不提供自定义权限矩阵。

## 4. RACI

R表示执行，A表示最终负责，C表示参与，I表示知悉。

| 治理活动 | R | A | C | I |
|---|---|---|---|---|
| 账号及角色生命周期 | MDM系统管理员 | MDM系统管理员 | — | 账号本人 |
| 部门流程、数据和术语材料起草 | 部门主对接人 | 部门最终负责人 | 部门MDM审核员、业务专家 | MDM工作组组长 |
| 记录部门决定及跨部门确认 | 部门MDM审核员 | 部门最终负责人 | 部门主对接人、相关部门审核员 | MDM工作组组长 |
| 部门材料整改 | 部门主对接人 | 部门最终负责人 | 部门MDM审核员、数据质量审计人 | MDM工作组组长 |
| 数据质量审计结论 | 数据质量审计人 | 数据质量审计人，仅对审计结论负责 | 部门人员 | MDM工作组组长、部门最终负责人 |
| 普通冲突协调 | 数据冲突处理人 | 每个受影响部门的最终负责人 | 部门MDM审核员、数据质量审计人 | MDM工作组组长 |
| 重大争议升级决策 | 数据冲突处理人或MDM工作组组长准备证据 | 项目决策组 | 受影响部门最终负责人、部门MDM审核员 | 部门主对接人 |
| 流程地图、数据地图和术语版本发布 | MDM工作组组长 | MDM工作组组长，仅对发布条件和版本负责 | 部门MDM审核员、数据质量审计人 | 项目决策组、MDM系统管理员 |

## 5. 责任证据

- 部门最终负责人只从`departments.final_responsible_person_id`读取。
- 系统不得按姓名、岗位、职务或旧名单补齐责任人。
- 部门最终负责人可以没有3000账号。
- 部门MDM审核员记录线下决定，不代替负责人作决定。
- 跨部门事项必须逐部门记录决定。
- 决定记录只追加，不覆盖。
- 责任人缺失或必需部门尚未确认时，记录决定或发布返回`RESPONSIBILITY_CHAIN_INCOMPLETE`。

## 6. 按钮不可用原因

前端应展示服务端可以核对的具体原因，包括：

- 账号未启用、已锁定或已停用；
- 首次登录尚未修改密码；
- 缺少有效角色、授权依据或生效日期；
- 当前角色没有该权限；
- 当前数据不在本部门、被分派事项或已升级事项范围内；
- 当前对象状态不允许该动作；
- 当前用户不是任务处理人或本部门审核员；
- 部门最终负责人或必需部门决定不完整；
- 阻断问题、结构检查或版本检查未通过。

“没有管理员权限”不能作为业务按钮的统一提示，因为管理员本身也没有业务写权限。
