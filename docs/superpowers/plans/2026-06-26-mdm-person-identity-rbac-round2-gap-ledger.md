# MDM Person Identity RBAC Round 2 Gap Ledger

> 日期：2026-06-26
> 范围：`apps/mdm-platform/` 与本计划目录。
> 边界：本轮只审查和计划，不修改 `docs/norms/`、PMO 真源、PMO 驾驶舱或流程源文件。

## Baseline Verification

- `npm run test:person-identity-rbac-completion`：通过，2026-06-26 重新执行。
- `npm run test:mainline`：通过，2026-06-26 重新执行。
- `npm run test:guidance-workflow`：通过，现有指导意见 API 与仓储 affordance 契约可用。
- `npm run test:person-operation-controls`：通过，现有前端操作控制静态契约可用。
- `npm run test:person-rbac-matrix`：通过，内置角色和危险权限矩阵契约可用。
- `npm run test:person-identity-payload`：通过，`/api/org/me` 目标身份载荷契约可用。
- `npm run test:identity-mysql`：通过，MySQL 身份仓储、`/api/org/me`、角色接口、权限中间件和导入 RBAC 保护可用。
- `npm run test:role-workbench-mysql`：通过，角色工作台 MySQL 身份接口和流程治理工作台接口可用。

## Workspace State

- 当前主工作区：`E:/CA001/Infomat`，`master` 位于 `dd99fcc7`，相对 `origin/master` ahead 6。
- 当前存在大量既有未提交改动，包含 `apps/mdm-platform/`、`pmo/`、`scripts/` 等目录；本次缺口审查不接管这些改动。
- 当前还有一个独立 worktree：`C:/Users/charl/.config/superpowers/worktrees/Infomat/codex-mdm-data-migration-no-loss`，分支 `codex/mdm-data-migration-no-loss`。
- 因主工作区脏，Round 2 实施必须新建隔离 worktree，且只允许触碰实施计划列明的 `apps/mdm-platform/` 文件和计划文件。

## Confirmed Implementation Gaps

1. SQLite 身份/RBAC 路径仍可作为运行路径进入。
   - 证据：`apps/mdm-platform/server/db.js` 仍定义 SQLite `users`、`user_roles` 和大量业务表；`apps/mdm-platform/server/auth.js`、`apps/mdm-platform/server/access.js`、`apps/mdm-platform/server/routes/org.js` 仍有 `db.prepare` 与 `users` / `user_roles` 读取写入。
   - 影响：目标架构已经把 MySQL `person` 作为主身份，但旧 SQLite 路由和测试仍可能让新改动回到 `users.id` 口径。

2. MySQL 兼容表和兼容字段仍混在主 schema 中。
   - 证据：`apps/mdm-platform/server/mysqlSchema.js` 仍保留 `users`、`user_roles`、`manager_user_id`、`data_owner_user_id`，并在数据地图、冲突、待办、流程治理问题池等表中保留多处 `*_user_id` 字段。
   - 影响：第一轮已经补了 `*_person_id` 目标字段，但 schema 层还没有把旧字段降级成只读兼容或迁移输入。

3. 多个业务 MySQL 仓储仍按旧 `*_user_id` 入参或字段执行写入。
   - 证据：`apps/mdm-platform/server/processGovernanceMysqlRepository.js` 仍写 `owner_user_id`、`actor_user_id`；`apps/mdm-platform/server/dataMapMysqlRepository.js` 仍写 `owner_user_id`、`steward_user_id`、`submitted_by`、`created_by`、`updated_by`；`apps/mdm-platform/server/conflictMysqlRepository.js` 仍写 `assignee_user_id`、`assigned_by`、`actor_user_id`；`apps/mdm-platform/server/mappingMysqlRepository.js`、`todoMysqlRepository.js`、`terminologyMysqlRepository.js` 也仍使用旧 actor / operator 字段。
   - 影响：这是 Round 2 的最高优先级，应把目标写入切到 person 字段，同时保留旧响应别名或迁移回填。

4. 指导意见“执行人”只被展示，还没有形成完整业务闭环。
   - 证据：`process_governance_guidance` 和前端会显示 `executorPerson`，但当前接口集中在创建、响应、澄清、异议、代理和最终确认；没有完整的执行人分派表单、校验、事件时间线与测试闭环。
   - 影响：用户能看到“执行人”，但不能完成“最终响应责任人转派执行人并跟踪执行”的自然工作流。

5. 代理授权后端能力已存在，前端缺少可用的人员选择和授权管理视图。
   - 证据：`governanceGuidanceMysqlRepository.js` 已有 `department_responsibility_delegations` 查询和 `delegateGuidance`；前端只展示 `delegatePerson`，没有针对指导意见的人员选择、授权范围、是否可最终确认、授权期限和撤销管理。
   - 影响：后端能力难以被普通用户稳定使用，也不利于审计代理授权来源。

6. 指导意见仍缺少完整列表、详情和事件时间线工作区。
   - 证据：前端会按当前流程治理对象匹配一条指导意见上下文并显示操作按钮，但没有“当前对象全部指导意见列表”“指导意见详情”“事件记录”视图。
   - 影响：一个对象多条指导意见、历史响应、澄清和异议记录不能被完整追溯。

7. 迁移/删除路径缺少一次真实 MySQL 演练证据。
   - 证据：当前多数身份与 RBAC 覆盖为 fake-pool 合同测试、路由测试和 MySQL 仓储契约测试；还没有针对“从旧 `users` / `user_roles` / `*_user_id` 到 person 字段后删除兼容写入”的整套可回滚演练命令。
   - 影响：不能直接删除 SQLite 或旧兼容字段，需要先证明登录、角色、工作台、数据地图、流程治理、冲突、待办、版本、活动链路都不再依赖旧身份写入。

## Compatibility Debt Left From Round 1

- `apps/mdm-platform/server/identityMysqlRepository.js` 仍包含从 `users`、`user_roles` 迁移到 `person`、`user_accounts`、`person_roles` 的兼容逻辑；这是第一轮保留的迁移桥，不应在未验证前删除。
- `apps/mdm-platform/server/mysqlSchema.js` 中的 `users` 与 `user_roles` 当前仍是兼容表；`scripts/test-no-new-user-identity-fields.js` 明确允许它们在 Round 1 作为兼容存在。
- `apps/mdm-platform/server/routes/org.js` 仍有 SQLite `/api/org/users`、用户角色、密码维护等旧路径；Round 2 需要先决定是否由 MySQL person/account API 接管这些入口。
- 大量旧测试和本地种子脚本仍通过 SQLite `users` / `user_roles` 构造场景，例如项目角色、角色工作台旧 API、安全路由、产品路由和旧导入脚本。
- `processGovernanceIssuePoolRepository.js` 同时存在 SQLite 与 MySQL 分支；下一轮不能简单删除，需要先确认当前主线服务和测试使用哪条分支。

## Optional UX Improvements

- 在前端直接显示后端返回的 `guidanceActions.disabledReasons`，让“可见但当前状态不能操作”的按钮说明更完整。
- 为指导意见增加筛选：按状态、责任部门、最终响应责任人、代理人、是否重大。
- 在角色工作台加入“我代理处理的事项”和“我最终负责但已授权的事项”分组。
- 对管理层指导意见增加可读编号复制、关联对象跳转和最近事件摘要。
- 对人员选择器增加部门过滤和在职状态提示，降低误选风险。

## Blocked By Business Decision

- 旧 `/api/org/users` 是否继续作为“人员/账号管理”的兼容路径，还是改名并迁移为 MySQL person/account 接口。
- 代理人能否在非重大事项上默认最终确认，或仍需要最终响应责任人确认。
- “执行人”和“代理人”的边界：执行人负责动作处理，代理人负责责任响应，两者是否允许同一人。
- 非重大指导意见在响应后是进入 `responded` 等待人工关闭，还是响应即闭环。
- 旧 SQLite 表和脚本的删除时点：完成 MySQL 演练后立即删除，还是保留一个只读归档周期。
- `*_user_id` 旧字段最终处置：数据库字段保留只读、迁移后置空、建视图兼容，或在独立迁移版本中删除。

## Deletion Prerequisites

- MySQL 启动路径验证不读取 SQLite 身份模型。
- `/api/org/me` 和 `/api/role-workbench` 验证均来自 MySQL person/account/RBAC。
- 数据地图、术语、映射、冲突、待办、版本和活动测试均验证 person 身份字段。
- 指导意见创建、响应、代理、执行、闭环和事件查询均使用 person 字段。
- 旧 `*_user_id` 写入点已迁移为 `*_person_id` 目标写入，旧字段只作兼容输出或迁移输入。
- 删除 SQLite 表、旧路由或旧测试前，已有回滚路径：可恢复旧表、旧脚本、旧路由和兼容字段。

## Proposed Round 2 Tasks

1. 新建隔离 worktree，先写 legacy identity inventory guard，锁定剩余 `users` / `user_roles` / `*_user_id` 写入点。
2. 把业务 MySQL 仓储写入切到 person 字段：流程治理问题单和待办、数据地图、映射审批、冲突分派、待办、术语和活动记录。
3. 为指导意见补最小可用工作区：当前对象指导意见列表、详情、事件时间线、代理授权表单和人员选择器。
4. 补执行人分派闭环：后端接口、事件、前端表单、权限和状态校验。
5. 建立真实 MySQL 迁移演练：从旧 `users` / `user_roles` / `*_user_id` fixture 迁到 person 字段，并证明主线不再写旧字段。
6. 在演练通过后，按业务决策拆分 SQLite / legacy 删除计划；未批准前不删除旧路径。
