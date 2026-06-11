# Infomat 目录职责与修改规则

> 状态：执行规则  
> 生效日期：2026-06-07  
> 目的：明确每个目录的责任、真源、可修改规则和禁止事项。

## 1. 根目录

| 路径 | 责任 | 可修改规则 | 禁止事项 |
|---|---|---|---|
| `README.md` | 仓库入口说明 | 只放导航、当前真源入口、常用命令入口 | 不写长篇方案，不放生成数据 |
| `AGENTS.md` / `CLAUDE.md` | AI 协作规则 | 写跨仓库执行约定、术语约定、阶段边界 | 不写具体业务交付内容 |
| `CONTEXT.md` | 仓库术语和目录规范 | 新增长期有效的仓库域语言 | 不记录临时计划 |
| `REPOSITORY_BOUNDARY.md` | 仓库职责边界 | 定义仓库放什么、不放什么 | 不替代目录级 README |
| `DIRECTORY_OWNERSHIP.md` | 目录责任矩阵 | 定义每个目录怎么改 | 不记录具体迁移日志 |
| `MAINLINE_MAP.md` | 主线数据流关系 | 定义资料、PMO、MDM、脚本的链路 | 不写平台实现细节 |

根目录不应继续新增临时 YAML、截图、压缩包、解包目录或一次性调查文本。历史散放的根目录 PMO YAML 已归档到 `pmo/archive/page-snapshots/2026-06-05-playwright-yaml/`。原根目录 `temp_survey.txt` 已登记后迁入 `docs/HardwareResearch/06B厂房接入民机非密园区网需求调查表_抽取文本.txt`，后续同类基础设施调查材料应直接进入对应资料目录。

## 2. 可运行系统

| 路径 | 责任 | 真源/接口 | 可修改规则 | 禁止事项 |
|---|---|---|---|---|
| `apps/` | 可运行应用集合 | 子目录 README | 新应用必须有独立 README、运行命令和数据边界 | 不放业务资料原件 |
| `apps/mdm-platform/` | MDM 平台源码 | `package.json`、`server/`、`public/`、`scripts/` | 平台功能、平台测试、平台维护脚本在此修改 | 不放 PMO 甘特图、流程制度原文、历史方案 |
| `apps/mdm-platform/server/` | MDM 后端实现 | Express 路由和 SQLite schema | 修改时同步平台测试 | 不直接依赖 PMO 页面内嵌数据 |
| `apps/mdm-platform/public/` | MDM 前端 | 单文件前端和静态资源 | 仅放平台运行所需前端资源 | 不放 PMO 驾驶舱截图 |
| `apps/mdm-platform/scripts/` | 平台内脚本和测试 | 平台数据库、平台路由 | 脚本应说明是否写数据库，测试应使用隔离库 | 不放仓库级 parser |
| `apps/mdm-platform/data/` | 本地运行态数据 | 本地 SQLite | 只作本地运行使用 | 不作为仓库真源，不提交数据库 |

## 3. 信息化资料

| 路径 | 责任 | 真源/接口 | 可修改规则 | 禁止事项 |
|---|---|---|---|---|
| `docs/` | 资料、说明、方案沉淀 | 子目录分工 | 文档按资产类型进入子目录 | 不放本地生成物 |
| `docs/norms/` | 制度、流程、部门映射真源 | 部门映射 Markdown、制度原文 | 新增或修改后运行流程地图 parser | 不放临时报告、截图、运行日志 |
| `docs/organization/` | 组织架构和部门职责真源 | `组织架构和部门职责.md` | 部门到域映射变化必须先改这里 | 不在页面或脚本里另造部门口径 |
| `docs/integration/` | 集成和主数据治理方案 | 方案文档 | 可沉淀接口、主数据、系统协同方案 | 不作为当前流程数据真源 |
| `docs/samples/` | 最小样例 | 样例 README 或文件名 | 只保留可复现、可说明格式的样例 | 不堆放完整生成输出 |
| `docs/reports/` | 审计、测试、稳定化报告 | 报告日期和主题 | 新增仓库审计、稳定性检查、阶段总结 | 不放当前执行真源 |
| `docs/architecture/` | 架构说明 | 架构主题文档 | 用于说明长期结构、模块关系、职责规则 | 不替代 ADR |
| `docs/adr/` | 架构决策记录 | ADR 编号 | 记录已经接受的长期决策 | 不写普通会议纪要 |
| `docs/superpowers/` | 历史设计和计划 | 历史计划、设计文档 | 只用于追溯，旧路径按当前结构解释 | 不作为当前执行真源 |
| `docs/archives/` / `docs/archive/` | 历史归档 | 归档索引 | 后续迁移旧方案或废弃材料 | 不放仍在执行的资料真源 |

## 4. PMO / 展示工具

| 路径 | 责任 | 真源/接口 | 可修改规则 | 禁止事项 |
|---|---|---|---|---|
| `pmo/` | 项目管理工作室 | `pmo/README.md` | PMO 计划、甘特图、流程地图驾驶舱放在此处 | 不放 MDM 后端代码 |
| `pmo/procedure-management/` | 流程地图驾驶舱 | `dashboard.html` 内嵌 `#sankey-data` | 页面展示和截图验证在此处 | 不手工复制第二份流程数据 |
| `pmo/gantt-react/` | React 甘特图 / PMO 看板 | `public/tasks.json`、`src/` | 前端交互、看板展示、PMO 插件在此处 | 不放制度真源 |
| `pmo/deliverables/` | PMO 交付物 | DLV 文档与表格 | 交付物按编号维护 | 构建目录不应长期提交 |
| `pmo/scripts/` | PMO 局部测试脚本 | PMO 页面和插件 | 只放服务 PMO 应用的 smoke 脚本 | 不放仓库级流程 parser |

## 5. 仓库级脚本

| 路径 | 责任 | 输入 | 输出 | 修改规则 |
|---|---|---|---|---|
| `scripts/` | 跨 app / 跨资料的仓库级自动化 | 由脚本声明 | 由脚本声明 | 脚本必须说明输入、输出、是否写文件、是否改数据库 |
| `scripts/parse-sankey-data.mjs` | 流程地图解析与注入 | `docs/norms/`、`docs/organization/` | `docs/company-sankey-data.json`、PMO 驾驶舱内嵌数据 | 修改后必须验证 PMO 驾驶舱数据 |
| `scripts/check-dashboard-data.mjs` | 驾驶舱数据检查 | PMO 驾驶舱 / JSON | 检查输出 | 只做校验，不改真源 |
| `scripts/glossary.mjs` | 术语表查询 | `docs/glossary.md` | 查询输出 | 新术语仍应写入术语表 |

后续轻量收口时，可在 `scripts/` 下逐步新增 `process-governance/`、`mdm-maintenance/`、`repo-audit/`，但第一轮不移动现有脚本。

## 6. 生成物、本地状态与历史资料

| 路径 | 当前状态 | 规则 |
|---|---|---|
| `artifacts/` | 生成物目录 | 默认不提交 |
| `output/` | 历史渲染输出 | 后续迁移到 `artifacts/` 或保留为样例前先审计 |
| `_tmp/` | PPTX 解包和临时脚本 | 不应作为仓库真源 |
| `snapshots/` | norms 快照 | 需确认是否作为历史快照保留；若保留，应补 README |
| `ai_materials/` | AI 处理输入材料 | 需确认是否为长期资料源；若是，应说明与 `docs/norms/` 的关系 |
| `.agents/` / `.claude/` | AI 协作配置和技能 | 可保留，但不放生成物 |
| `.superpowers/` | Superpowers 工作输出 | 当前含截图等生成物，后续应迁移或忽略 |
| `node_modules/` | 本地依赖 | 不提交 |
| `test-results/` | 测试输出 | 不提交 |

## 7. 修改前自检

每次任务开始前先回答：

1. 这次改的是资料、应用、PMO 展示、脚本、AI 工作区，还是历史归档？
2. 这次改动是否会改变任何真源？
3. 这次改动是否会写数据库、生成 HTML、覆盖 JSON 或注入页面？
4. 是否需要运行对应 parser、smoke 或稳定性检查？
5. 是否把生成物误放进了可提交目录？

无法回答时，先做审计，不做迁移。
