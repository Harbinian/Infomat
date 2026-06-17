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

执行记录：MySQL schema 已补齐流程治理读模型和待办/质量闭环表，包括 `process_governance_snapshots`、nodes/edges、A1 明细、跨部门交互、证据引用、源文件覆盖、MDM 要求、质量问题单、映射工作库和映射待办事件。`init:mysql` 会登记 `2026-06-16-process-governance-read-model`。本步只落 schema，不切换现有流程治理 Express 路由或 SQLite 过渡导入链路。

执行记录：已新增 `apps/mdm-platform/server/processGovernanceMysqlRepository.js`，覆盖流程治理 MySQL 读模型的最小闭环：替换活动快照、写入节点/边/跨部门风险/交互链，并按现有 Sankey 接口结构读回当前活动快照。`npm run test:process-governance` 已纳入 fake MySQL pool 测试；本步仍不切换现有 Express 路由和 SQLite 过渡导入链路。

执行记录：`/api/process-governance/sankey` 已增加受控 MySQL 读模型接入，只有 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 时才读取 MySQL repository；默认仍走现有过渡链路。路由测试使用 fake repository 验证开关行为，不连接真实 MySQL，不改变其他流程治理接口。

执行记录：`/api/process-governance/snapshots` 与 `/api/process-governance/current` 已纳入同一受控 MySQL 读模型开关。MySQL repository 新增 `listSnapshots()` 和 `getCurrentSnapshot()`，后者返回当前快照、解析后的 stats 和质量摘要；默认不开关时仍走现有 SQLite 过渡链路。尚未切换 A1、source-files、MDM requirements、evidence、cross-dept、quality、mapping workspace/todos 等接口。

执行记录：`/api/process-governance/a1` 已纳入受控 MySQL 读模型开关。MySQL repository 新增 A1 明细写入与 `getA1Items()`，支持按部门、L3 和系统过滤，并把 `suggested_systems` 还原为数组。MySQL 导入适配器与 CLI 已支持 `--a1-source`，可从部门映射 Markdown 的 A1 表生成 `process_a1_items`。

执行记录：`/api/process-governance/source-files`、`/mdm-requirements`、`/evidence` 与 `/chains` 已纳入同一受控 MySQL 读模型开关。MySQL repository 已写入并读回源文件覆盖、MDM 建设要求、证据引用和交互链，查询返回结构保持与旧接口一致。MySQL 导入适配器已从 `docs/company-sankey-data.json` 中带出 `sourceManifest.files`、`mdmRequirements` 和 `evidenceRefs`，不扫描或修改 `docs/norms`。尚未切换 cross-dept 独立列表、quality、mapping workspace/todos 等接口。

补充执行记录（2026-06-17）：`/api/process-governance/cross-dept`、`/quality`、`/quality-cases*`、`/mapping-workspace` 与 `/mapping-todos*` 已纳入 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 开关。质量问题单和映射待办按读写一体方式接入 MySQL repository，避免 MySQL 读、SQLite 写的混用状态；认证、RBAC、用户和部门校验仍沿用当前 SQLite 过渡链路，等待后续数据层迁移。

执行记录：已新增 MySQL 版流程治理导入适配器和 CLI：`apps/mdm-platform/scripts/lib/processGovernanceMysqlImport.js` 与 `apps/mdm-platform/scripts/import-process-governance-mysql.js`。该适配器从 `docs/company-sankey-data.json` 读取 parser 快照，计算 source hash，推断节点类型/父子关系，归一化跨部门风险和交互链状态，然后写入 MySQL 读模型 repository。旧 `import-process-governance.js` 仍保留为 SQLite 过渡导入链路，默认未删除。

执行记录：已新增可选真实 MySQL smoke：`apps/mdm-platform/scripts/smoke-process-governance-mysql.js` 和共享 runner `apps/mdm-platform/scripts/lib/processGovernanceMysqlSmoke.js`。只有同时设置 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时才会初始化 schema、导入 `docs/company-sankey-data.json` 并读回 Sankey；缺少环境变量时输出 skipped 并退出 0。该 smoke 不读取 `MDM_DB_PATH`，也不加载 SQLite `server/db`。

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
- MySQL schema 初始化必须包含流程治理读模型和待办/质量闭环表，且不得依赖尚未迁移的 `users/departments` 外键。
- 流程治理 MySQL 读模型 repository 必须能替换活动快照并读回现有 Sankey 消费结构；切换正式路由前仍需单独做 API 接入测试。
- `/api/process-governance/snapshots`、`/current`、`/sankey`、`/a1`、`/source-files`、`/mdm-requirements`、`/evidence`、`/chains` 的 MySQL 读取必须只在 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 下启用；默认行为不得被隐式切换。
- `/api/process-governance/cross-dept`、`/quality`、`/quality-cases*`、`/mapping-workspace`、`/mapping-todos*` 的 MySQL 读写也必须只在 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 下启用；默认 SQLite 过渡链路保持可回归。
- MySQL 版 A1 导入必须通过显式 `--a1-source` 或 `a1MarkdownPaths` 提供部门映射 Markdown，不自动扫描 `docs/norms`。
- MySQL 版流程治理导入必须直接消费 `docs/company-sankey-data.json` 快照，推断无类型节点并写入 MySQL 读模型，不依赖 `MDM_DB_PATH` 或 SQLite `server/db`。
- 真实 MySQL smoke 必须可跳过：缺少 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时不得尝试连接默认本地库；配齐时才写指定 MySQL schema。
- `Pxx` 只能显示为内部抽取锚点，不能显示为页次、原文段落号或块号；缺少真实页次、条款号或表格位置时，应标记为原文定位不足。
- 裸普通角色必须标记为 `原文定义不足`，`总经理`、`经营副总`、`生产副总` 例外。
