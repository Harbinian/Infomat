# MDM 候选复核与 MySQL 化收尾计划

> 状态：执行中，进入最终验证与提交收口。
> 最后确认：2026-06-17。
> 适用范围：候选复核治理、流程治理 MySQL 化、MDM 身份/RBAC MySQL 化、角色工作台流程待办数据层，以及本轮验证文档。

## Summary

本计划是 `2026-06-16-mdm-mysql-candidate-review-governance.md` 的当前执行版。旧计划保留为历史记录，本文件记录收尾阶段的实际边界、剩余任务和验证口径。

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
- 文档治理已完成并合并到 `master`，本轮只维护与当前收尾相关的计划文档。

## Pxx 与原文定位

`Pxx` 只表示抽取过程中的内部锚点，不等于原文页码、段落号或块号。

- 有明确 `page` 字段时，才显示页次。
- 有明确条款号时，显示条款。
- 只有 `Pxx` 而没有页次、条款、表格等真实原文位置时，显示为 `内部锚点Pxx · 原文定位不足`。
- 不得把 `P71` 显示为 `第71页`。
- 不得把 `P71` 伪装成原文段落号或块号。

## 剩余任务

1. 文档和验证收口：
   - 当前计划持续反映真实完成状态，避免旧“待迁移主体”误导验收。
   - 真实 MySQL smoke 如果缺少环境变量，只记录为跳过，不宣称真实库验证通过。
2. 完成验证后提交、推送当前分支，并按需快进 `master`。

## MySQL 边界

- `PROCESS_GOVERNANCE_READ_MODEL=mysql` 仍是显式开关。
- 旧 SQLite 本地库不迁移，MySQL 通过组织真源、流程快照和基线脚本重建。
- `better-sqlite3` 暂不移除，直到认证、RBAC、角色工作台相关数据层全部迁完。
- 当前已经具备 MySQL 身份/RBAC 读写基础能力；本轮已清理流程治理和角色工作台已存在 MySQL 分支中的身份/部门 SQLite 混用查询。
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
