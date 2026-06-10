# 2026-06-07 仓库边界审计报告

## 1. 审计目标

本次审计对应任务 `000_repo_boundary_audit_and_structure_proposal`。

目标不是重排目录，也不是判断 MDM 是否开发完成，而是完成一次仓库职责边界收口：

1. 扫描当前目录。
2. 判断每个目录属于哪类资产。
3. 找出混放、重复、历史遗留和生成物污染。
4. 输出仓库边界文档。
5. 输出轻量整理方案。
6. 暂不移动现有文件。

## 2. 审计依据

| 依据 | 结论 |
|---|---|
| `CONTEXT.md` | 已定义 `apps/`、`docs/`、`scripts/`、`.planning/` 的职责 |
| `docs/adr/0001-repo-structure-and-artifacts.md` | 已接受“可运行应用放 `apps/`、业务资料放 `docs/`、生成物不得提交”的决策 |
| `AGENTS.md` | 当前阶段为流程地图与数据地图梳理，MDM 平台开发暂时搁置 |
| `README.md` | 已承认本仓库同时包含资料、MDM 平台和辅助工具 |
| `pmo/README.md` | PMO 目录自身已形成流程地图驾驶舱和 React 甘特图两条线 |

## 3. 当前资产分布

按已跟踪文件粗略统计：

| 区域 | 文件数 | 资产判断 |
|---|---:|---|
| `docs/` | 1369 | 信息化资料、制度真源、历史设计、样例和外部参考混合 |
| `_tmp/` | 355 | PPTX 解包和临时处理产物，生成物污染明显 |
| `pmo/` | 118 | PMO 真源、展示页面、React 应用、截图和构建输出混合 |
| `ai_materials/` | 90 | AI 处理材料，需确认是否长期作为资料源 |
| `apps/` | 80 | MDM 平台源码和平台脚本，整体归属清楚 |
| `.superpowers/` | 51 | AI 工作输出，含截图生成物 |
| `.agents/` | 12 | Agent 技能配置，可保留但需避免生成物 |
| `.claude/` | 10 | Claude 工作区配置，可保留但需修复失效路径 |
| `snapshots/` | 10 | norms 快照，需补说明其保留策略 |
| `scripts/` | 9 | 仓库级脚本，数量少但尚未按链路分组 |

根目录另有 45 个 YAML 文件、`pmo.zip`、`topology_screenshot.png`、`temp_survey.txt`、`echarts.min.js` 等散放资产，属于当前最明显的导航噪音。

## 4. 主要发现

### F1 根目录已成为 PMO 临时输出集散地

根目录存在大量 `pmo-*.yaml`、`ledger-*.yaml`、`gantt-*.yaml`、`pm*.yaml`、`current.yaml`、`after-ms.yaml` 等文件。这些文件看起来像页面抓取、状态快照或多轮试错输出，不适合作为根目录入口资产。

影响：

- AI 容易把根目录 YAML 当当前真源。
- README 的导航作用被削弱。
- 后续搜索 PMO 计划或字段台账时会命中大量不该优先看的文件。

建议：

- 第一轮只登记，不移动。
- 后续查引用后，迁移到 `artifacts/`、`pmo/archive/` 或 `docs/samples/`。

后续处理：

- 2026-06-10 已将根目录 45 个 PMO YAML 页面快照迁移到 `pmo/archive/page-snapshots/2026-06-05-playwright-yaml/`，并补充归档说明。

### F2 生成物已有部分被版本跟踪

按候选生成物模式粗查，`*.png`、`*.zip`、`_tmp/*`、`output/*`、PMO 截图和 Playwright 输出等已跟踪条目约 419 个。其中部分截图可能是必要证据或样例，但 `_tmp/pptx_unpacked/`、批量截图、zip 和渲染输出不应默认留在主干。

影响：

- 检索噪音高。
- 仓库体积增长。
- AI 可能把截图、页面抓取 YAML 或解包 XML 当作源文件。

建议：

- 先补 `docs/reports/` 审计报告和边界规则。
- 第二阶段用清单逐项判定：保留为样例、迁移为归档、移入 `artifacts/`、从版本跟踪中移除。

### F3 `docs/` 同时承担真源、方案、样例、外部参考和历史计划

`docs/norms/` 和 `docs/organization/` 是当前强真源；`docs/superpowers/` 是历史计划；`docs/integration/` 是方案；`docs/screenshots/`、`docs/samples/` 是证据与样例；`docs/U8SoftHelp/`、`docs/外部参考/` 是外部资料。

影响：

- “docs 就是真源”这个说法过宽。
- 后续整理资料时，可能误改历史方案或外部参考。

建议：

- 用 `DIRECTORY_OWNERSHIP.md` 明确 `docs/norms/`、`docs/organization/` 才是当前流程治理强真源。
- 新增 `docs/reports/` 和后续 `docs/architecture/`，让审计报告和架构说明有固定位置。

### F4 `pmo/` 内部同时包含真源、应用和生成物

`pmo/` 中有 PMO Markdown 真源、Excel 历史导入表、流程地图驾驶舱、React 甘特图、交付物、脚本、截图、构建输出和本地依赖。

影响：

- `pmo/` 不是单一展示目录，而是项目管理工作室。
- `pmo/gantt-react/public/tasks.json` 是应用消费数据，容易被误改成真源。
- `pmo/procedure-management/dashboard.html` 是内嵌展示副本，不能反向覆盖 `docs/norms/`。

建议：

- 保留现有路径，先通过 `MAINLINE_MAP.md` 固定数据流。
- 后续轻量整理时，将截图、构建输出和 Playwright 输出移入生成物策略。

### F5 `scripts/` 是真实跨线模块，但还没有分组接口说明

当前 `scripts/` 下包含流程地图解析、驾驶舱校验、DCM/BBM 检查、甘特图渲染、术语查询和 norms 合并。

影响：

- 脚本会跨 `docs/`、`pmo/`、`apps/`，但输入输出和写入行为不够醒目。
- AI 执行脚本时容易不知道是否会覆盖 JSON、HTML 或数据库。

建议：

- 保持现状不移动。
- 后续补 `scripts/README.md`，逐个脚本声明输入、输出、是否写文件、是否改数据库。
- 第二阶段再考虑 `scripts/process-governance/`、`scripts/mdm-maintenance/`、`scripts/repo-audit/` 分组。

### F6 AI 工作区和历史方案同时存在多套口径

`.agents/`、`.claude/`、`.superpowers/`、`docs/superpowers/` 都存在。`docs/superpowers/README.md` 已说明其中可能含旧路径。

影响：

- 后续 AI 可能读取旧计划，把历史设计误当当前目标。
- `.claude/skills/claude-to-im/` 存在失效路径警告，影响状态命令输出。

建议：

- 边界文件声明 `docs/superpowers/` 为历史追溯，不作为当前执行真源。
- 后续单独处理 `.claude` 失效路径和 `.superpowers` 截图生成物。

## 5. 轻量收口方案

第一阶段已经完成或本次应完成：

| 动作 | 结果 |
|---|---|
| 新增 `REPOSITORY_BOUNDARY.md` | 明确仓库放什么、不放什么 |
| 新增 `DIRECTORY_OWNERSHIP.md` | 明确每个目录责任、真源和禁止事项 |
| 新增 `MAINLINE_MAP.md` | 明确流程治理、字段台账、MDM、PMO 的数据流 |
| 新增本审计报告 | 记录问题、证据和后续整理顺序 |
| 修订 `AGENTS.md` / `README.md` | 让 AI 和人类入口都能看到边界文件 |

第二阶段建议：

1. 新增 `scripts/README.md`，列出每个脚本的输入、输出、是否写文件。
2. 新增 `docs/reports/README.md`、`docs/architecture/README.md`。
3. 生成“待迁移资产清单”，先列根目录 YAML、`_tmp/`、`output/`、PMO 截图和构建输出。
4. 只迁移低风险资产，不动 `docs/norms/`、`docs/organization/`、`pmo/procedure-management/dashboard.html`、`apps/mdm-platform/`。

第三阶段再评估：

1. 是否需要把 PMO 工作室独立成仓库。
2. 是否需要把 MDM 平台独立成仓库。
3. 是否保留当前信息化资料仓库作为上游真源。

## 6. 暂不移动文件的原因

当前有真实数据链路：

```text
docs/norms
  ↓
scripts/parse-sankey-data.mjs
  ↓
docs/company-sankey-data.json
  ↓
pmo/procedure-management/dashboard.html
  ↓
apps/mdm-platform 流程治理快照导入
```

如果现在直接移动 `docs/`、`pmo/` 或 `scripts/`，会让 parser、驾驶舱和 MDM 导入链路同时承压。第一轮以边界文件和审计报告收口，是更稳的路线。

## 7. 本轮不处理事项

- 不移动任何现有文件。
- 不拆仓库。
- 不删除已跟踪生成物。
- 不重写 PMO 或 MDM 数据链路。
- 不把 MDM 平台提升为当前流程数据真源。

## 8. 验收建议

本轮完成后，后续任务应以以下文件作为入口：

1. `REPOSITORY_BOUNDARY.md`
2. `DIRECTORY_OWNERSHIP.md`
3. `MAINLINE_MAP.md`
4. `docs/reports/2026-06-07-repo-boundary-audit.md`

若任务要移动文件，必须另起迁移计划，列明旧路径、新路径、引用影响和验证命令。
