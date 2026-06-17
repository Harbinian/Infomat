# MDM 候选复核与 MySQL 化收尾计划

## Summary

本计划是 `2026-06-16-mdm-mysql-candidate-review-governance.md` 的当前执行版。旧计划保留为历史记录，本文件记录收尾阶段的实际边界、剩余任务和验证口径。

本轮不扩大范围，不修改 `docs/norms` 正式流程真源。工作集中在候选复核、流程治理 MySQL 读写模型、测试、脚本说明和审计报告。

## 已完成口径

- 候选预览默认输出已从正式 `docs/norms` 页面隔离到 `artifacts/process-candidates/<run-id>/preview.html`。
- 候选复核已取消“点选标签拼接修正意见”，改为结构化字段保存。
- MDM 候选复核正式入口固定为 `/api/process-governance/candidate-review/*`。
- 候选项已支持按“部门 -> 文档名称 -> 候选类型”组织。
- 流程治理 MySQL 读模型已覆盖快照、当前版本、桑基、A1、来源文件、MDM 建设要求、证据和链路。

## Pxx 与原文定位

`Pxx` 只表示抽取过程中的内部锚点，不等于原文页码、段落号或块号。

- 有明确 `page` 字段时，才显示页次。
- 有明确条款号时，显示条款。
- 只有 `Pxx` 而没有页次、条款、表格等真实原文位置时，显示为 `内部锚点Pxx · 原文定位不足`。
- 不得把 `P71` 显示为 `第71页`。
- 不得把 `P71` 伪装成原文段落号或块号。

## 剩余任务

1. 加固候选复核证据测试：覆盖 Pxx 内部锚点、原文定位不足、裸普通角色定义不足和三类领导角色例外。
2. 清理临时候选复核页面里不再使用的拼接式修正意见残影，避免后续误恢复。
3. 将流程治理 MySQL 读模型继续扩到 `cross-dept` 独立查询。
4. 将 `quality / quality-cases` 按读写一体迁到 MySQL，避免 MySQL 读、SQLite 写混用。
5. 将 `mapping-workspace / mapping-todos` 按读写一体迁到 MySQL。
6. 完成验证后提交并推送当前分支。

## MySQL 边界

- `PROCESS_GOVERNANCE_READ_MODEL=mysql` 仍是显式开关。
- 旧 SQLite 本地库不迁移，MySQL 通过组织真源、流程快照和基线脚本重建。
- `better-sqlite3` 暂不移除，直到认证、RBAC、角色工作台相关数据层全部迁完。
- 如果缺少真实 MySQL 环境变量，smoke 只能记录为跳过，不能宣称真实库验证已通过。

## 验证命令

- `npm run test:process-candidates`
- `npm run test:process-candidate-review`
- `npm run test:sankey-preview-status`
- `node scripts/test-candidate-sankey-preview.mjs`
- `cd apps/mdm-platform && npm run test:process-candidate-review-api`
- `cd apps/mdm-platform && npm run test:process-candidate-review-mysql`
- `cd apps/mdm-platform && npm run test:process-governance`
- `cd apps/mdm-platform && npm run test:role-workbench`
- `cd apps/mdm-platform && npm run test:mainline`
- `cd apps/mdm-platform && npm run smoke:process-governance-mysql`
- `git diff --check`
