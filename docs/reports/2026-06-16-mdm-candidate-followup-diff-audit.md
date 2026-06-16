# MDM 候选复核与 MySQL 收口差异审计

日期：2026-06-16

## 审计结论

本轮处理范围是候选映射复核治理、候选预览边界和 MDM MySQL 化的第一阶段收口。当前工作区不是干净状态，已有大量前序改动和未跟踪文件，因此后续执行只处理本主题相关文件，不做全仓清理，不批量还原用户改动。

## 当前改动分类

### 可承接的候选复核改动

- 根目录已有候选复核临时服务和核心规则：`scripts/candidate-review-core.mjs`、`scripts/candidate-review-service.mjs`、`scripts/init-candidate-review-mysql.mjs`、`scripts/import-candidate-review-mysql.mjs`。
- MDM 前端已出现候选复核入口文案和读取 `/api/process-governance/candidate-review/runs` 的代码。
- MDM schema 已新增 `process_candidate_review_*` 表雏形，但 API 仍主要从 artifacts 读取候选项。

### 正式资产污染风险

- `docs/norms/工程技术部部门能力流程系统桑基图.html` 当前差异异常大，内容呈现候选预览页面特征，不应作为正式部门桑基图交付。
- 其他部门桑基图 HTML 存在小幅差异，需要只检查是否仍带候选预览标记或临时状态，不做批量回滚。
- `docs/norms/流程治理/候选映射待办.md` 是人工待办面板，不是正式映射真源；本轮不把候选项自动写入部门映射 Markdown。

执行记录：工程技术部部门桑基图已通过 `scripts/rebuild-department-sankey-page.mjs` 从 `docs/norms/工程技术部部门-能力-流程-系统映射关系.md` 重建为正式映射页；候选预览继续保留在 `artifacts/process-candidates/<run-id>/preview.html` 口径下。

### MySQL 迁移遗留面

- `apps/mdm-platform` 已声明 MySQL 配置和 schema 初始化脚本，但主数据层仍大量依赖 `better-sqlite3`、`MDM_DB_PATH`、`PRAGMA`、`sqlite_master`、`lastInsertRowid`。
- 本轮只做候选复核 MySQL 持久化第一阶段，不删除 SQLite 依赖，不改认证、RBAC、角色工作台的既有隔离测试链。
- 旧 SQLite `platform.db` 不迁移，后续通过 MySQL 基线脚本重建。

依赖审计记录：`cd apps/mdm-platform && npm audit --omit=dev --json` 显示生产依赖仍有 5 个告警（4 moderate、1 high），涉及 `express/qs`、`exceljs/uuid`、`tmp`。本轮只分类记录，不自动执行依赖升级或降级。

## 本轮安全边界

- `docs/norms` 只做候选预览污染的定向清理；正式流程映射 Markdown 不自动改。
- 根目录 `candidate-review-service` 只保留为临时工具，正式入口固定在 MDM `/api/process-governance/candidate-review/*`。
- 候选 JSON 继续保留在 `artifacts/process-candidates/<run-id>/`，复核决策写入 MDM MySQL 表。
- 文档更新只说明当前状态和后续迁移，不提前删除仍被测试使用的 SQLite 脚本说明。

执行记录：已新增 MDM 正式候选复核保存接口的路由级回归测试，覆盖 `PUT /api/process-governance/candidate-review/runs/:runId/candidates/:stableKey/review`。测试使用 fake repository，不连接真实 MySQL；断言保存字段为结构化对象，`reviewer` 以后端会话用户为准，`correction_note` 这类旧拼接字段不会作为决策字段写入。

执行记录：MDM 前端候选复核区已从平铺候选行改为按“部门 → 文档名称 → 候选类型”生成分组行，再展示候选项明细。现有 `npm run test:frontend` 已加入分组渲染标记断言，防止后续回退成“一本账”。

执行记录：MDM 候选复核 MySQL repository 已调整为保存结构化决策后回读持久化行，`PUT` 响应可返回 `reviewed_at` 和 `updated_at`。对应 repository 测试和正式路由测试均已加入时间字段断言。

执行记录：MDM 候选复核正式路由测试已补齐“PUT 保存后再 GET 查询”的闭环，断言已保存的 `decision`、`issue_type`、`definition_status`、`normalized_note`、`reviewer`、`reviewed_at` 和 `decision_updated_at` 会同时出现在候选明细和“部门 → 文档名称 → 候选类型”分组内。

## 后续验证口径

- 候选预览默认输出不得落到 `docs/norms`。
- MDM 候选复核接口必须支持结构化决策保存。
- MDM 候选复核保存接口必须返回持久化后的复核时间和更新时间。
- MDM 候选复核查询接口必须在候选明细和分组明细中回显已保存的结构化复核结果。
- MDM 候选复核前端必须按部门、文档名称和候选类型分组展示。
- `Pxx` 只能显示为段落或块号，不能显示为页次。
- 裸普通角色必须标记为 `原文定义不足`，`总经理`、`经营副总`、`生产副总` 例外。
