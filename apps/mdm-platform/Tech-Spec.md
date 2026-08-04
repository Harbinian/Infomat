# MDM流程治理统一入口、身份与责任技术规格

## 1. 版本与边界

- 治理模型版本：`rbac-raci-v3-2026-07-31`
- 正式身份存储：MySQL
- 正式身份链路：`person -> user_accounts -> person_roles -> roles -> role_permissions -> permissions`
- 遗留`users/user_roles`和SQLite人员接口：仅保留隔离测试或一个版本的只读兼容，不参与正式授权

本规格改变流程治理入口、完整流程JSON草稿、身份、授权、责任证据、3001格式适配、跨部门承接和承接冲突对象；不停止3001，不修改`docs/norms/`流程输入基线，也不重做数据地图和术语治理对象。

## 2. 组成模块

| 模块 | 文件 | 责任 |
|---|---|---|
| 固定治理模型 | `server/roleDefinitions.js` | 定义十九项权限、七个角色、十一项RACI活动、可见标签和模型版本 |
| 身份读取 | `server/identityMysqlRepository.js` | 从人员、账号和有效角色计算当前身份、权限和数据范围 |
| 账号与责任服务 | `server/governanceAccessMysqlRepository.js` | 账号生命周期、角色授权、访问审计、部门决定和发布责任核验 |
| 数据结构 | `server/mysqlSchema.js` | 身份、授权、审计、责任记录和迁移表 |
| 迁移 | `server/rbacRaciMysqlMigration.js` | 盘点、备份、固定模型写入、账号切换、回滚和补偿 |
| 身份接口 | `server/routes/accounts.js` | 管理员手工开户和账号生命周期接口 |
| 模型接口 | `server/routes/rbac.js` | 固定模型只读接口 |
| 责任接口 | `server/routes/governance.js` | 部门决定读取和追加接口 |
| 会话与中间件 | `server/auth.js` | 登录、会话校验、权限校验和首次改密限制 |
| 前端 | `public/index.html` | 三类流程治理工作区、故事链、角色责任页、账号管理和角色可见标签 |
| v1/v2规范化 | `server/processGovernanceV2.js` | 结构校验、v1兼容、引用检查、治理提示和规范化内容哈希 |
| 承接迁移 | `server/crossDeptHandoffV2Migration.js` | 盘点、备份、v2字段和状态迁移、核对与补偿 |
| 统一入口迁移 | `server/processGovernanceUnifiedMigration.js` | 完整JSON、草稿修订、承接冲突和只追加事件的dry-run、迁移、回滚与补偿 |
| 流程设计接口 | `server/routes/processDesignMysql.js` | 两阶段导入、事务写入、承接状态机、双方决定和发布卡口 |
| 角色工作台 | `server/routes/roleWorkbench.js` | 直接读取承接和冲突队列，并生成统一入口深链接 |

## 3. 授权计算

每次受保护请求按以下顺序处理：

1. 从会话取得`personId`、`accountId`和`authVersion`。
2. 读取`person`与`user_accounts`当前状态。
3. 比较会话`authVersion`和账号`auth_version`。
4. 读取当前日期有效、状态为`active`且包含授权依据的`person_roles`。
5. 只接受`roles.status='active'`且`roles.model_version`等于当前模型版本的七个固定角色。
6. 合并角色固定权限，不接受`*:*`通配权限。
7. 根据全局、本部门、本人被分派事项或已升级事项计算数据范围。
8. 业务路由继续核对对象状态、任务关系和责任证据。

任一步失败即拒绝请求。前端隐藏按钮只用于减少误操作，不能代替服务端授权。

## 4. 会话

正式会话只保存：

```json
{
  "personId": 1,
  "accountId": 1,
  "authVersion": 3
}
```

显示名称、部门、角色和权限由每次请求重新读取。账号状态、部门或角色变化时，服务端递增`auth_version`，旧会话在下一次请求时返回401并清除。

`must_change_password=1`时，除读取当前会话、修改本人密码和退出外，其他业务接口返回403。

## 5. 固定角色与范围

- `admin`、`mdm_lead`、`data_quality_auditor`为全局范围。
- `department_contact`、`department_mdm_reviewer`为人员所属部门范围。
- `data_conflict_handler`为本人被分派事项范围。
- `decision_group`为已升级事项范围。
- 跨部门临时代办使用独立委托关系，不改变永久角色范围。

非七个固定角色全部转为`retired`并删除有效权限关联。旧角色不自动映射到新角色。

## 6. 写入事务

以下操作必须在单一MySQL事务中完成：

- 创建人员、待启用账号、初始角色授权和访问审计。
- 部门变更、旧部门角色撤销、新部门角色授予、`auth_version`递增和审计。
- 角色授予或撤销、账号必要状态变化、`auth_version`递增和审计。
- 账号启用、恢复、停用、密码重置和审计。
- 部门决定追加及被替代记录关联。
- 3001审核导入的草稿、流程、行为、承接修订、参与关系、事件和导入审计。

事务失败时不保留部分账号、部分授权或部分责任记录。

## 7. 数据结构

身份字段见[RBAC-RACI-DB-Schema.md](docs/RBAC-RACI-DB-Schema.md)，承接字段见[Cross-Department-Handoff-DB-Schema.md](docs/Cross-Department-Handoff-DB-Schema.md)。关键变化如下：

- `roles`增加状态、分组、核心标记和模型版本。
- `person_roles`增加范围、部门、授权依据、有效期、状态和撤销信息。
- `user_accounts`使用`pending_activation`、`active`、`locked`、`disabled`，并保存`must_change_password`和`auth_version`。
- `identity_access_events`只追加账号与授权事件，不保存明文密码或密码散列。
- `governance_decision_records`只追加部门责任决定。
- `identity_migration_*`表保存迁移批次和恢复所需快照。
- `process_design_cross_dept_handoffs`统一保存前置输入和后续承接，并以`handoff_ref`、候选哈希、修订号和当前标记保留历史。
- `process_design_structured_imports`保存受控导入、审核依据、规范化JSON和内容哈希。
- `process_design_drafts.process_content_json`保存完整v2 JSON真源；`revision_no`和`content_hash`用于乐观并发与内容核对。
- `process_design_handoff_conflicts`保存承接冲突当前状态和协调方案。
- `process_design_handoff_events`只追加承接、冲突和项目决策事件。
- 保存完整v2 JSON时，同一数据库事务同步流程、业务行为、承接候选修订和事件。投影同步失败时回滚JSON修订，不形成半套治理事实。
- 删除已有治理记录的承接必须提交`handoff_ref`和作废原因；历史承接只取消当前标记，不物理删除。

## 8. 接口

身份接口见[RBAC-RACI-API-Contract.md](docs/RBAC-RACI-API-Contract.md)，承接接口见[Cross-Department-Handoff-API-Contract.md](docs/Cross-Department-Handoff-API-Contract.md)。

核心接口：

- `GET /api/rbac/model`
- `GET|POST /api/org/accounts`
- `GET|PATCH /api/org/accounts/:personId`
- `POST /api/org/accounts/:personId/role-assignments`
- `POST /api/org/accounts/:personId/role-assignments/:assignmentId/revoke`
- `POST /api/org/accounts/:personId/activate|enable|disable|reset-password`
- `GET|POST /api/governance/decision-records`
- `GET /api/org/me`
- `GET /api/process-design/drafts`
- `POST /api/process-design/drafts/canonical`
- `GET|PUT /api/process-design/drafts/:id/content`
- `GET /api/process-design/drafts/:id/export`
- `POST /api/process-design/import-structured-output/preview`
- `POST /api/process-design/import-structured-output/approve`
- `GET /api/process-design/cross-dept-handoffs`
- `GET /api/process-design/cross-dept-handoffs/:id/story`
- `GET /api/process-design/handoff-conflicts`
- `POST /api/process-design/handoff-conflicts/:id/assign`
- `PUT /api/process-design/handoff-conflicts/:id/proposal`
- `POST /api/process-design/handoff-conflicts/:id/department-confirmation`
- `POST /api/process-design/handoff-conflicts/:id/escalate`
- `POST /api/process-design/handoff-conflicts/:id/decision`
- `POST /api/process-design/cross-dept-handoffs/:id/assign-counterparty`
- `PUT /api/process-design/cross-dept-handoffs/:id/counterparty-response`
- `POST /api/process-design/cross-dept-handoffs/:id/department-decision`
- `POST /api/process-design/cross-dept-handoffs/:id/structure-gate`

旧`/api/org/users*`写接口返回410；旧RBAC批量导入返回410；固定模型写请求返回405。

## 9. 责任记录与发布卡口

`recordGovernanceDecision`在写入前完成：

1. 当前用户拥有`governance:record-department-decision`。
2. 当前用户具有该部门有效`department_mdm_reviewer`授权。
3. 部门与人员状态有效。
4. `departments.final_responsible_person_id`存在且指向有效人员。
5. 决定值、对象、版本、依据和决定时间有效。

`assertGovernancePublishReady`在发布前完成：

1. 对象和版本明确。
2. 所有必需部门均有最新`approved`决定。
3. 必需部门责任人完整。
4. 阻断问题数量为零。
5. 结构检查通过。
6. 版本检查通过。

MDM工作组组长只能在卡口通过后发布，不能以角色权限跳过部门决定。

### 9.1 承接状态与决定

承接状态依次覆盖分派、归口审核、外部门范围确认、外部门补充、外部门审核和结构卡口，并使用`returned`表示退回上一责任步骤、`conflict_open`表示存在未关闭冲突。历史`rejected`迁移为待分派冲突，历史`escalated`迁移为待项目决策。每个写接口在通用权限之外继续校验固定角色、参与人、部门、`can_act`、当前修订、对象状态和事项关联。

双方决定写入`governance_decision_records`，`subject_type='cross_dept_handoff'`，`subject_version`为候选内容哈希。最终责任人从决定发生时当前部门表读取。承接待办直接从承接状态和参与关系生成，不通过问题池复制业务事实。

### 9.2 完整流程JSON与并发

- MDM接受`process-governance-v1`和`process-governance-v2`，在服务端规范化后统一保存和导出v2。
- `process_content_json`是编制内容真源，承接及待办表是治理投影。
- 保存请求必须携带`expected_revision`。更新语句同时匹配`id + revision_no`，不匹配时返回`409 DRAFT_REVISION_CONFLICT`。
- 内容哈希未变化时不增加修订号；变化时增加修订并更新时间、更新人和哈希。
- 浏览器不使用`localStorage`或`sessionStorage`保存业务内容。

## 10. 安全控制

- 密码由`bcryptjs`保存散列。
- 临时密码只在启用或重置响应中返回一次。
- 访问事件不保存密码或密码散列。
- 所有权限检查在服务端执行。
- 固定模型不接受自定义角色、角色继承或通配权限。
- 最后一个有效管理员受`LAST_ACTIVE_ADMIN`保护。
- 登录名、工号和人员账号关系使用唯一约束。
- 管理员具有治理全局只读权限，但没有业务写权限。

## 11. 兼容与迁移

身份迁移见[RBAC-RACI-Migration-Runbook.md](docs/RBAC-RACI-Migration-Runbook.md)，承接迁移见[Cross-Department-Handoff-Migration-Runbook.md](docs/Cross-Department-Handoff-Migration-Runbook.md)。

切换原则：

- 迁移前执行dry-run。
- 备份旧角色、权限、账号和角色关系。
- 仅`ADMIN001`自动保留管理员权限。
- 其他账号停用，旧角色关系保留历史但不产生权限。
- 清除旧会话。
- 未发生新授权事件前可以整批回滚；已经发生新授权事件后使用补偿撤销。
- 空数据库只允许执行一次受控管理员初始化。

## 12. 验证

最低验证入口：

```powershell
npm run test:rbac-raci-v2
npm run test:frontend
npm run test:project-roles
npm run test:role-workbench
npm run test:process-governance
npm run test:process-governance-unified
npm run test:mainline
npm run migrate:rbac-raci-v2:dry-run
npm run migrate:cross-dept-handoff-v2:dry-run
npm run migrate:process-governance-unified:dry-run
```

正式运行还必须执行：

```powershell
cd E:\CA001\Infomat
npm run start:infomat-services
npm run smoke:infomat-services
```

浏览器至少核对登录页、首次改密、管理员账号管理、只读角色责任页、角色可见标签、多角色标签并集、三个流程治理工作区、承接故事链、冲突处理、管理员业务写按钮不可用和代表性角色的数据范围。3001继续单独验证首页和`/api/health`，不得因MDM上线而停止。
