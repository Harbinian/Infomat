# MDM 候选复核与 MySQL 化收尾计划

> 状态：本轮收口已合并，进入下一阶段前审计。
> 最后确认：2026-06-17，基点 `7906cec`。
> 适用范围：候选复核治理、流程治理 MySQL 化、MDM 身份/RBAC MySQL 化、角色工作台流程待办数据层，以及本轮验证文档。

## Summary

本计划是 `2026-06-16-mdm-mysql-candidate-review-governance.md` 的当前执行版。旧计划保留为历史记录，本文件记录收尾阶段的实际边界、完成口径、下一阶段候选项和验证口径。

本轮不扩大功能范围。`docs/norms` 正式流程真源不做数据性修改；若涉及 `docs/norms/流程治理/候选映射待办.md`，只允许补充状态/维护口径，不改候选数据行。工作集中在候选复核、流程治理 MySQL 读写模型、身份/RBAC MySQL 化、角色工作台流程待办读取、测试和脚本说明。

## 已完成口径

- 候选预览默认输出已从正式 `docs/norms` 页面隔离到 `artifacts/process-candidates/<run-id>/preview.html`。
- 候选复核已取消“点选标签拼接修正意见”，改为结构化字段保存。
- MDM 候选复核正式入口固定为 `/api/process-governance/candidate-review/*`。
- 候选项已支持按“部门 -> 文档名称 -> 候选类型”组织。
- 流程治理 MySQL 读模型已覆盖快照、当前版本、桑基、A1、来源文件、MDM 建设要求、证据和链路。
- `cross-dept`、`quality / quality-cases`、`mapping-workspace / mapping-todos` 已具备 MySQL repository、API 分支和测试覆盖，不再作为待迁移主体。
- 候选复核 Pxx 定位口径已明确：Pxx 只作为内部抽取锚点；没有真实页码、条款、表格或章节时统一显示 `原文定位不足`。
- 裸普通角色定义不足规则已纳入候选复核口径；`总经理`、`经营副总`、`生产副总` 仍为例外。
- MDM 身份/RBAC MySQL 化已覆盖：`/api/org/me`、用户/部门读写、角色读写、权限中间件、角色工作台身份读模型、RBAC 批量导入 MySQL 未完成保护。
- 公共权限基础层已新增 MySQL-aware 异步入口：有效权限读取、角色码读取、按用户 ID 读取用户、按部门 ID 读取部门、管理员/全局查看/复核权限/待办可处理判断。后续业务路由可逐步接入，不再各自直查 SQLite 身份表。
- 流程治理 MySQL 分支已接入异步身份 helper；`PROCESS_GOVERNANCE_READ_MODEL=mysql` 与 `MDM_IDENTITY_READ_MODEL=mysql` 同时开启时，`quality-cases`、`mapping-workspace`、`mapping-todos` 不再依赖 SQLite 身份/部门表做权限、责任人或责任部门判断。
- 角色工作台在 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 开启时，流程质量问题和映射待办工作项已从流程治理 MySQL repository 读取；角色定义、桑基结构和前端显示口径不变。
- 验证阶段发现“治理活跃/参与热力”前序资产只有后端和测试口径、前端未接入，导致 `test:frontend` 阻断；已补齐 `/api/activity/heatmap` 前端入口、角色工作台热力图、统计看板参与热力和 API/资产测试，不涉及 `docs/norms` 数据。
- `/api/activity/heatmap` 管理视图权限已接入 MySQL-aware 异步身份 helper；`MDM_IDENTITY_READ_MODEL=mysql` 开启时，不再依赖 SQLite `user_roles` 或同步权限表判断全量/部门/人员筛选权限。
- 本轮改动已通过分支提交并快进合并到 `master`，当前合并节点为 `7906cec fix: use mysql identity for activity heatmap`。
- 下一阶段启动后，字段台账路由已先完成身份权限层收口：`/api/field-entries` 的映射可见性、创建、编辑、删除权限判断改用 MySQL-aware 异步 helper；字段业务表仍是后续迁移对象。
- 文档治理已完成并合并到 `master`，本轮只维护与当前收尾相关的计划文档。

## Pxx 与原文定位

`Pxx` 只表示抽取过程中的内部锚点，不等于原文页码、段落号或块号。

- 有明确 `page` 字段时，才显示页次。
- 有明确条款号时，显示条款。
- 只有 `Pxx` 而没有页次、条款、表格等真实原文位置时，显示为 `内部锚点Pxx · 原文定位不足`。
- 不得把 `P71` 显示为 `第71页`。
- 不得把 `P71` 伪装成原文段落号或块号。

## 本轮剩余任务

本轮候选复核、流程治理 MySQL 分支、身份/RBAC MySQL 基础、角色工作台流程待办读取和活动热力图权限收口已完成并合并。当前范围内不再保留未提交代码项。

仍需长期保留的验证口径：

- 当前计划持续反映真实完成状态，避免旧“待迁移主体”误导验收。
- 真实 MySQL smoke 如果缺少环境变量，只记录为跳过，不宣称真实库验证通过。
- `docs/norms` 仍是正式流程真源；下一阶段任何平台代码收口不得顺手改正式映射数据。

## 下一阶段候选项

下一阶段不应继续把“流程治理 MySQL 分支未迁完”作为主风险；基于最新代码，主风险应改为评估仍以 SQLite 为主的数据层是否需要进入 MySQL 化：

1. 字段台账与字段身份：
   - `fieldEntries` 已先接入 MySQL-aware 身份权限判断，但字段业务表仍未迁 MySQL。
   - `fieldIdentities` 仍是独立业务域，不属于本轮流程治理读模型。
   - 若推进，应先补 MySQL repository/API 测试，再替换读写路径。
2. 冲突、术语、映射基础库：
   - `conflicts`、`terminology`、`mappings` 仍有 SQLite 查询和权限 helper 直连。
   - 若推进，应逐域迁移，避免 MySQL 身份判断与 SQLite 业务写入混用。
3. 导入导出与本地维护脚本：
   - `import`、`export`、本地初始化、用户导入等脚本仍服务历史 SQLite 流程或测试隔离。
   - 切换前需先确认 Excel 模板、错误提示、权限控制和测试数据边界。
4. 认证与运行态：
   - 登录、会话、密码和 RBAC 基础已经具备 MySQL 分支。
   - `better-sqlite3` 仍不能移除，直到剩余业务数据层和测试隔离机制都有替代方案。
5. 真实 MySQL 环境验证：
   - 只有配置 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 并实际执行 smoke 成功，才能声明真实 MySQL 通过。

## MySQL 边界

- `PROCESS_GOVERNANCE_READ_MODEL=mysql` 仍是显式开关。
- 旧 SQLite 本地库不迁移，MySQL 通过组织真源、流程快照和基线脚本重建。
- `better-sqlite3` 暂不移除，直到认证、RBAC、角色工作台相关数据层全部迁完。
- 当前已经具备 MySQL 身份/RBAC 读写基础能力；本轮已清理流程治理、角色工作台和治理活跃热力图已存在路径中的身份/部门 SQLite 混用查询。
- 如果缺少真实 MySQL 环境变量，smoke 只能记录为跳过，不能宣称真实库验证已通过。

## 验证命令

- `npm run test:process-candidates`
- `npm run test:process-candidate-review`
- `npm run test:sankey-preview-status`
- `node scripts/test-candidate-sankey-preview.mjs`
- `cd apps/mdm-platform && npm run test:process-candidate-review-api`
- `cd apps/mdm-platform && npm run test:process-candidate-review-mysql`
- `cd apps/mdm-platform && npm run test:process-governance`
- `cd apps/mdm-platform && npm run test:process-governance-mysql-identity`
- `cd apps/mdm-platform && npm run test:identity-mysql`
- `cd apps/mdm-platform && npm run test:access-mysql`
- `cd apps/mdm-platform && npm run test:activity`
- `cd apps/mdm-platform && npm run test:security`
- `cd apps/mdm-platform && npm run test:role-workbench`
- `cd apps/mdm-platform && npm run test:role-workbench-mysql`
- `cd apps/mdm-platform && npm run test:mainline`
- `cd apps/mdm-platform && npm run smoke:process-governance-mysql`
- `git diff --check`
- `git diff -- docs/norms`，若存在差异，应只允许状态/维护口径说明，不应包含候选数据或正式映射数据改动
