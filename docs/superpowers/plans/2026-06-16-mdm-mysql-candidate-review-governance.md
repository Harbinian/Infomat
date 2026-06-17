# MDM MySQL 与候选映射复核治理更新计划

日期：2026-06-16

## 背景

本轮工作服务于 MDM 平台中的流程治理能力。当前仓库仍处在“流程地图与数据地图的梳理与沉淀”阶段，正式流程真源仍是 `docs/norms/{部门}部门-能力-流程-系统映射关系.md`。候选映射、候选预览和复核记录只能作为治理过程资产，不得默认写入正式流程真源或正式展示页。

用户确认 MDM 平台目标数据库应为 MySQL，本地服务不应继续以 SQLite 作为当前平台形态。旧 SQLite `platform.db` 不迁移，后续通过组织真源、流程快照和基线脚本在 MySQL 中重建。

## 当前检查结论

### P0：候选预览污染正式资产边界

- `scripts/build-candidate-sankey-preview.mjs` 当前默认输出到 `docs/norms/{部门}部门能力流程系统桑基图.html`，会把候选预览状态写入正式部门桑基图页面。
- `scripts/mark-sankey-preview-status.mjs` 当前批量扫描并修改 `docs/norms/*部门能力流程系统桑基图.html`，容易把临时候选标记混入正式展示资产。
- 处置口径：候选预览默认输出必须迁移到 `artifacts/process-candidates/<run-id>/preview.html`；正式 `docs/norms` 仅允许受控回源流程更新。

### P1：候选复核交互不符合治理口径

- 当前候选复核页仍存在“点选标签生成修正意见”和 `data-correction-fragment` 的拼接式长文本逻辑。
- 当前候选列表偏平铺，缺少“部门 → 文档名称 → 候选类型”的治理分组。
- 处置口径：取消点击拼接字符串，改为结构化复核字段：`decision`、`evidence_status`、`issue_type`、`definition_status`、`normalized_note`。

### P1：证据锚点与摘要展示规则不足

- 当前 `paragraph_id/Pxx` 被展示成页码，存在“P71 被显示为第 71 页”的误导风险。
- 原文摘要高亮主要来自候选内容拆词，未覆盖角色、动作词、对象/交付物词。
- 处置口径：只有明确 `page` 字段才能显示页次；`Pxx` 只显示为内部抽取锚点，不能显示为原文段落号或块号。高亮来源扩展为候选内容、角色词、动作词、对象/交付物词。

### P1：角色定义规则缺失

- 除 `总经理`、`经营副总`、`生产副总` 外，普通角色在原文中必须带部门或办公室名称。
- 若原文仅出现裸角色，应标记为 `原文定义不足`，不能直接视作可落图角色。

### P2：MDM 数据库形态仍停留在 SQLite

- `apps/mdm-platform` 当前仍包含 `better-sqlite3`、`MDM_DB_PATH`、`lastInsertRowid`、`sqlite_master/PRAGMA` 等 SQLite 形态。
- 处置口径：新增 MySQL 连接配置与 schema 初始化，逐步替换 SQLite 专用实现。正式目标不保留 SQLite fallback。

## 执行顺序

1. Markdown Round
   - 新增本计划文档，明确范围、风险、执行顺序和验收口径。
   - 根目录 `candidate-review-service` 仅作为临时工具，不作为正式 MDM 入口继续强化。
   - 本阶段不改 `docs/norms` 真源，不改脚本。

2. Failing Tests First
   - 增加候选预览测试：默认输出不得落到 `docs/norms`。
   - 增加候选复核测试：页面不得包含 `data-correction-fragment` 或“点选标签生成修正意见”。
   - 增加证据测试：`P71` 显示为内部抽取锚点，不显示“第71页”、原文段落号或块号。
   - 增加角色规则测试：裸普通角色进入 `原文定义不足`，三类领导角色例外。
   - 注册缺失脚本：`test:sankey-preview-status`。

3. Candidate Review Refactor
   - 把候选复核核心逻辑拆为纯规则函数：分组、锚点格式化、高亮词提取、角色定义状态判定。
   - 页面保存结构化字段，不再保存拼接式修正意见。
   - MySQL 表保留候选运行、候选项、摘录、决策，补充 `document_name`、`issue_type`、`definition_status`、`normalized_note`。

4. MDM Integration
   - 在 `apps/mdm-platform` 的流程治理 API 下增加候选复核接口。
   - 前端流程治理页新增候选复核区块，复用现有流程治理筛选和权限口径。
   - 候选 JSON 仍留在 `artifacts/`；正式映射仍只由受控回源流程更新。

5. MySQL Migration
   - 新增 MySQL 连接配置：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`MYSQL_CONNECTION_LIMIT`。
   - 迁移 MDM schema 和基线脚本；测试使用独立 MySQL schema，不再使用 `MDM_DB_PATH`。
   - 更新 `apps/mdm-platform/AGENTS.md`、README、脚本说明，移除 SQLite 作为当前平台形态的描述。

## 验收命令

- `npm run test:process-candidates`
- `npm run test:process-candidate-review`
- `npm run test:sankey-preview-status`
- `node scripts/test-candidate-sankey-preview.mjs`
- `cd apps/mdm-platform && npm run test:frontend`
- `cd apps/mdm-platform && npm run test:role-workbench`
- `cd apps/mdm-platform && npm run test:process-governance`
- `cd apps/mdm-platform && npm run test:mainline`

## 执行约束

- 当前未提交改动视为用户或前序工作成果，只改与本计划直接相关的最小范围。
- 不批量清理 `docs/norms` 现有改动；如需清理候选预览标记，只做定向、可解释的最小处理。
- 不把候选 JSON、候选预览、候选复核结果视为正式流程真源。
- MySQL 按 8.0+ 处理。
