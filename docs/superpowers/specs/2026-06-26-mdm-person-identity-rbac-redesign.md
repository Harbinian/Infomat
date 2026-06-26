# MDM 人员身份中心、RBAC 与部门责任链重构设计

> 状态：待用户最终审阅  
> 日期：2026-06-26  
> 范围：`apps/mdm-platform/` 的 MySQL 身份、RBAC、岗位任职、部门责任链、管理层指导意见与前端操作控制。  
> 边界：不修改 `docs/norms/`、PMO 驾驶舱或流程真源。

## 1. 背景

当前 MDM 已有 `users`、`roles`、`user_roles`、`permissions`、`role_permissions`，也已有 `person`、`position`、`person_position_assignment` 等人员与岗位任职表。但登录、RBAC、会话、工作台和多处业务记录仍以 `users.id` 作为主身份。

这会让“账号”“人员”“岗位责任”“项目角色”“权限”混在一起。后续要按管理层指导意见、部门最终响应责任人、代理授权和前端操作权限控制业务流程时，主身份必须先统一。

用户已确认采用彻底重构：`person` 是唯一人员主身份，账号只提供登录能力；SQLite 退出目标架构，后续只保留 MySQL 主线。

## 2. 已确认决策

- 职责引导和强权限边界分开：项目工作角色提示人该做什么，权限点决定系统是否放行。
- 每个人必须至少有一个基础权限角色，项目工作角色只能叠加，不能单独存在。
- 管理层落到 `decision_group`，处理重大变更、升级争议、指导意见，不等同于 `admin`。
- `decision_group` 可以看全局材料，但不能直接改业务数据，只能形成指导意见或建议。
- `admin` 拥有全局业务阅读权和系统管理权，但不能直接修改业务数据。
- 所有关键操作入口按权限点、对象状态、数据范围和责任关系控制，不按角色名硬判断。
- 没权限的人尽量看不到入口；能看对象但状态不允许操作时可置灰说明；后端逐接口兜底。
- 权限矩阵以数据库为运行真源，代码负责初始化内置权限点和默认角色包，文档只说明。
- 内置角色核心权限受保护，自定义角色可自由配置。
- 多角色权限取并集，项目角色不能自动获得危险权限。
- 管理层指导意见必须单独建成业务对象，不能塞进普通待办备注。
- 管理层指导意见默认派给责任部门的最终响应责任人，不越级派给执行人。
- 代理授权放在业务授权表里，不塞进 RBAC。
- 人员库和账号库目标态一一对应，甚至可以合并；本次选择以 `person` 为身份中心。
- 部门最终响应责任人显式配置在部门表上，不靠岗位名称推断。
- SQLite 分两轮退出：本轮完成 MySQL 目标态；后续单独删除 SQLite 遗留代码和旧测试。

## 3. 目标与非目标

### 目标

- 以 `person` 作为唯一人员主身份。
- 将账号登录信息从业务身份中剥离，放入 `user_accounts`。
- 将 RBAC 从 `user_roles` 迁移到 `person_roles`。
- 将所有业务责任、待办、指导意见、代理授权、审计记录统一指向 `person_id`。
- 在部门上显式配置最终响应责任人。
- 建立管理层指导意见业务对象和响应工作流。
- 前端按权限点、对象状态、数据范围、责任关系控制入口。
- 建立 MySQL 测试覆盖身份、RBAC、责任链、指导意见和前端入口。

### 非目标

- 不在本轮删除全部 SQLite 遗留代码；删除作为第二轮清理。
- 不修改 `docs/norms/` 流程真源。
- 不把部门长、管理层、代理人做成新的 RBAC 角色。
- 不允许 `admin` 或 `decision_group` 直接修改业务事实数据。

## 4. 目标数据模型

### 4.1 人员主身份

`person` 是唯一主身份。

建议字段：

- `person_id`：主键。
- `employee_no`：工号，唯一。
- `person_name`：姓名。
- `current_department_id`：当前主部门。
- `mobile`、`email`：联系方式。
- `employment_status`：在职、离职、停用等。
- `status`：启用、停用、归档。
- `created_at`、`updated_at`。

所有业务语义上的“谁”都指向 `person_id`，包括提交人、审核人、操作人、责任人、代理人、执行人、指导意见提出人。

### 4.2 登录账号

新增 `user_accounts`，只表达登录能力。

建议字段：

- `account_id`：账号主键。
- `person_id`：唯一关联 `person.person_id`。
- `login_name`：登录名，默认使用工号。
- `password_hash`。
- `must_change_password`。
- `account_status`：active、locked、disabled。
- `last_login_at`。
- `created_at`、`updated_at`。

登录成功后，会话同时保存：

- `personId`
- `accountId`
- `employeeNo`
- `personName`

后续业务判断统一使用 `personId`；只有认证、安全审计、账号锁定等场景使用 `accountId`。

### 4.3 RBAC

新增 `person_roles`，替代 `user_roles`。

建议字段：

- `person_role_id`
- `person_id`
- `role_id`
- `assigned_by_person_id`
- `created_at`

约束：

- 同一 `person_id + role_id` 唯一。
- 每个 `person` 必须至少有一个基础权限角色。
- 新权限矩阵不引入业务 deny 规则；如底层表保留 `effect`，新写入只使用 `allow`。

角色仍分两组：

基础权限角色：

- `submitter`
- `owner`
- `reviewer`
- `admin`

项目工作角色：

- `it_lead`
- `project_lead`
- `workgroup_lead`
- `business_contact`
- `data_quality`
- `decision_group`

角色是权限包和职责包，不直接写进关键业务判断。关键判断由权限点、对象状态、数据范围和责任关系共同决定。

### 4.4 权限矩阵

权限点采用 `resource:action` 命名。

建议新增或收口的权限点：

- `rbac:manage`
- `account:manage`
- `person:manage`
- `position:manage`
- `process_governance:view_global`
- `process_governance:view_department`
- `process_governance:submit`
- `process_governance:review`
- `guidance:create`
- `guidance:respond`
- `guidance:delegate`
- `guidance:final_confirm`
- `major_change:advise`

权限定义表建议补充：

- `is_dangerous`：是否危险权限。
- `default_scope`：self_task、department、global。
- `protected_core`：是否内置核心权限。

危险权限包括：

- 角色和权限管理。
- 账号管理。
- 组织、人员、岗位等基础主数据维护。
- 发布、归档、删除、撤销、回滚。
- 重大状态流转和重大闭环确认。
- 批量导入和批量修改。

项目工作角色不得自动获得危险权限。

### 4.5 岗位任职和行政等级

保留：

- `position`
- `person_position_assignment`

岗位任职关系用于表达一个人在组织中的岗位。行政等级可以预留，但短期不强制配置。

建议在 `position` 或 `person_position_assignment` 上预留：

- `department_admin_level`：行政等级数字，低数字代表更高责任层级。
- `department_admin_title`：业务可读头衔。
- `responsibility_scope`：岗位责任范围。

岗位和行政等级只做校验、提示和候选排序，不作为最终响应责任人的唯一来源。

## 5. 部门最终响应责任人

部门最终响应责任人显式配置在部门表上。

建议将旧字段迁移为 person 口径：

- `departments.final_responsible_person_id`
- `departments.data_owner_person_id`

旧字段：

- `manager_user_id`
- `data_owner_user_id`

迁移完成后不再作为目标态字段扩展。

已确认的部门最终响应责任人：

| 部门 | 最终响应责任人 |
|---|---|
| 行政人事部 | 陈娟 |
| 经营发展部 | 刘春含 |
| 物资保障部 | 刘洪雨 |
| 质量管理部 | 曲明盛 |
| 工程技术部 | 池炳辉 |
| 复材车间 | 王潇 |
| 财务部 | 李雪 |
| 项目管理部 | 范秋南 |

说明：

- 这些人不一定是“正部长”头衔，而是副总以下各部门级别最高、对本部门事项兜底的人。
- 公司领导、总经理、副总不作为普通部门最终响应责任人；他们通过 `decision_group` 处理重大指导意见。
- 如果部门未配置最终响应责任人，相关业务对象进入“责任链待补全”，不自动派给 `project_lead` 或 `business_contact`。

## 6. 管理层指导意见工作流

新增 `process_governance_guidance`，单独承载管理层指导意见。

建议字段：

- `guidance_id`
- `guidance_code`
- `related_entity_type`
- `related_entity_id`
- `related_department_id`
- `created_by_person_id`
- `guidance_type`：指导、建议、要求补充材料、要求重议。
- `content`
- `final_responsible_person_id`
- `current_handler_person_id`
- `is_major`
- `visibility_scope`
- `status`：submitted、pending_response、in_progress、responded、pending_final_confirm、closed、clarification_requested、objected。
- `created_at`
- `updated_at`

流程规则：

- `decision_group` 可创建指导意见。
- 指导意见绑定具体业务对象和责任部门。
- 系统按部门找到 `final_responsible_person_id`。
- 最终响应责任人收到响应待办。
- 最终响应责任人可以申请澄清、提出异议、转派执行、提交响应、确认闭环。
- 执行人可以处理具体动作，但重大闭环动作默认需要最终响应责任人确认。
- `admin` 可全局阅读和排障，但不能替业务闭环。

### 6.1 代理授权

新增 `department_responsibility_delegations`。

建议字段：

- `delegation_id`
- `department_id`
- `final_responsible_person_id`
- `delegate_person_id`
- `delegation_type`：指导意见响应、重大变更响应、流程整改确认等。
- `scope_type`：全部、指定业务对象、指定问题类型。
- `scope_ref_type`
- `scope_ref_id`
- `can_final_confirm`
- `reason`
- `start_at`
- `end_at`
- `status`
- `created_by_person_id`
- `created_at`

规则：

- 代理授权不进入 RBAC。
- 代理不改变最终责任人。
- 普通补材料、说明类响应可由代理提交。
- 重大闭环动作默认需要最终责任人确认；除非代理授权明确包含 `can_final_confirm`。

## 7. 前端操作控制

前端关键入口按以下因素控制：

- 权限点。
- 对象状态。
- 数据范围。
- 当前人员是否最终责任人、代理人、执行人或当前处理人。

展示规则：

- 没权限的菜单和危险操作入口隐藏。
- 可看对象但当前状态不能操作时，按钮可置灰并说明原因。
- 管理操作和危险操作对无权限人员隐藏。
- 页面必须分开展示最终责任人、代理人、执行人、当前处理人和下一步动作。

后端规则：

- 所有关键接口必须重新校验权限点。
- 所有状态流转必须校验当前状态。
- 跨部门和全局读取必须校验数据范围。
- 所有业务写操作必须生成工作流动作、事件或审计记录。

## 8. API 影响

`/api/org/me` 目标响应应包含：

- `personId`
- `accountId`
- `employeeNo`
- `name`
- `departmentId`
- `departmentName`
- `positions`
- `rbacRoles`
- `roleCodes`
- `permissions`
- `dataScopes`

角色管理页面继续面向用户理解为“人员/账号角色分配”，但底层分配对象是 `person_id`。

导入模板中的“工号”仍作为外部识别键，导入时解析到 `person_id`。

## 9. 迁移设计

本轮迁移以 MySQL 为唯一目标。

迁移步骤应保证：

1. 从现有 `users` 生成或补齐 `person`。
2. 为每个 `person` 创建唯一 `user_accounts`。
3. 从 `user_roles` 迁移到 `person_roles`。
4. 从 `departments.manager_user_id`、`departments.data_owner_user_id` 迁移到 person 口径字段。
5. 按已确认名单初始化 8 个部门最终响应责任人。
6. 将业务表中语义为“人”的 `*_user_id` 字段迁移到 `*_person_id`。
7. 会话、身份仓储、权限仓储统一返回 `person_id`。
8. 前端改用 `personId`、权限点、对象状态和责任关系判断入口。

`users` 的目标处置：

- 迁移完成后不再作为主身份表。
- 如短期保留，只能作为只读兼容视图或迁移期兼容表。
- 新功能不得再新增 `users.id` 外键。

SQLite 处置：

- 本轮不扩展 SQLite 能力。
- 第二轮单独删除 SQLite 路由、脚本和旧测试。
- 新测试不得依赖 SQLite 作为身份或权限真源。

## 10. 测试要求

测试采用 MySQL 主线。允许仓储级 fake 验证分支逻辑，但必须有 MySQL 集成测试覆盖目标 schema 和关键路由。

必须覆盖：

- 登录后返回 `personId`、`accountId`、角色、权限、部门和岗位。
- `person_roles` 生效，`user_roles` 不再作为目标真源。
- 没有基础权限角色的人不能保存。
- 多角色权限取并集。
- 危险权限不随项目工作角色自动获得。
- 8 个部门能初始化到正确最终响应责任人。
- 公司领导不进入普通部门最终响应链。
- 指导意见能由 `decision_group` 创建。
- `admin` 能全局阅读但不能替业务闭环。
- 最终响应责任人能响应本部门指导意见。
- 代理人在授权范围内能响应，超范围不能响应。
- 重大闭环默认需要最终响应责任人确认。
- 无权限前端入口隐藏。
- 可见但状态不允许的业务动作置灰并说明原因。

建议优先测试脚本：

- `test:identity-mysql`
- `test:roles-mysql`
- `test:role-workbench-mysql`
- `test:process-governance`
- `test:mainline`

本次重构应新增专门测试，例如：

- `test-person-identity-mysql-repository.js`
- `test-person-rbac-migration-mysql.js`
- `test-department-responsibility-mysql.js`
- `test-governance-guidance-mysql-api.js`
- `test-person-permission-frontend.js`

## 11. 验收标准

- 新库初始化后直接具备 `person` 主身份、`user_accounts`、`person_roles`、部门最终响应责任人、指导意见工作流基础表。
- 登录、`/api/org/me`、角色工作台、RBAC 页面均基于 `person_id` 工作。
- 任意新业务写操作不再新增 `users.id` 外键。
- 管理层只能创建指导意见，不能直接改业务对象。
- `admin` 能支持排障和全局阅读，但不能直接改业务数据。
- 部门最终响应责任人可按确认名单初始化并可在系统内维护。
- 所有关键操作入口都有前端控制和后端兜底。
- MySQL 测试通过；SQLite 不作为新能力验收目标。

## 12. 后续分轮

第一轮：完成 MySQL 人员身份中心、RBAC、部门责任链、指导意见工作流和前端操作控制。

第二轮：删除 SQLite 遗留路径、旧脚本、旧测试和 `users` 主身份兼容层。
