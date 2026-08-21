# Infomat 仓库职责边界

> 状态：执行规则  
> 生效日期：2026-06-07  
> 目的：把 Infomat 从“什么都能放的混合仓库”收口为“有明确职责边界的信息化治理工作仓库”。

## 1. 仓库定位

Infomat 是一个信息化治理工作仓库，不是单一源码仓库。它允许同时保存资料、可运行应用、项目管理页面和自动化脚本，但每类资产必须有清晰归属。

当前仓库承担六类职责：

| 资产类型 | 说明 | 主要位置 |
|---|---|---|
| 信息化资料库 | 制度、流程地图、数据地图、组织架构、方案文档 | `docs/` |
| 可运行系统 | MDM 平台、文档结构化输出辅助服务、MDM-AI助手、PMO 周会行动项服务、信息表收集服务及其测试和维护脚本 | `apps/` |
| PMO / 项目管理展示工具 | 流程地图驾驶舱、甘特图、项目管理页面、交付物工作台 | `pmo/` |
| 仓库级脚本工具 | 跨资料、跨页面、跨 app 的解析、注入、生成、校验脚本 | `scripts/` |
| AI 协作工作区 | Codex 入口规则、长期项目上下文、Agent 技能和历史计划 | `AGENTS.md`、`CODEX.md`、`MEMORY.md`、`.agents/`、`docs/superpowers/` |
| 历史方案归档 | 旧设计、旧计划、历史输出物、阶段性审查记录 | `docs/superpowers/`、`docs/archives/` |

## 2. 放入规则

### 可以放入

- 与昌兴复材信息化治理、流程地图、数据地图、主数据治理、项目管理有关的资料。
- 当前仍需运行或验证的应用源码。
- 由组织真源、流程输入基线或 PMO 计划入口生成展示页面所需的仓库级脚本。
- 经过确认需要长期追溯的审计报告、设计记录、ADR 和迁移方案。
- 用于复现格式和校验规则的最小样例。

### 不应放入

- 浏览器抓取记录、临时截图、批量渲染结果、PPTX 解包目录。
- 本地依赖目录，例如 `node_modules/`。
- 运行态数据库、Cookie、日志和临时服务输出。
- 同一份项目数据的多轮试错导出，除非已被标记为样例或历史归档。
- 个人临时草稿、未脱敏数据和一次性中间文件。

## 3. 当前边界规则

| 数据类型 | 当前入口 | 禁止误判 |
|---|---|---|
| 部门到域映射 | `docs/organization/组织架构和部门职责.md` | 不从页面硬编码、截图或 MDM 临时库反推 |
| 工作角色目录与岗位映射 | `docs/organization/工作角色目录与岗位映射.md` | 由行政人事部受控维护；不从原文称谓、岗位同名、人员或 RBAC 角色自动生成正式口径 |
| 流程输入基线 | `docs/norms/{部门}部门-能力-流程-系统映射关系.md` | 只作为已确认流程映射输入基线；PMO 驾驶舱 HTML 不是维护入口；问题卡证据另定位制度/表单源文件 |
| 工作角色只读快照 | `docs/work-role-data.json` | 只由 `scripts/build-work-role-data.mjs` 生成，不手工维护、不包含人员名单 |
| PMO 流程地图展示 | `pmo/procedure-management/dashboard.html` 内嵌 `#sankey-data` | 不绕过 `scripts/parse-sankey-data.mjs` 手工重造数据 |
| PMO 项目计划 | `pmo/信息化项目_计划管控真源.md` 和 `pmo/信息化项目_WBS结构真源.md` | 不把 XLSX 备份当默认维护入口 |
| MDM 平台源码 | `apps/mdm-platform/server/`、`public/`、`scripts/` | 不把流程治理资料直接写进平台源码 |
| MDM 正式运行态数据库 | 固定MySQL实例，连接配置由`scripts/infomat-services.config.json`和本机私有环境文件提供 | 不把`apps/mdm-platform/data/*.db`误认为当前正式运行数据库；数据库文件和凭据均不得提交 |

## 4. 变更规则

任何变更先判断资产类型，再改对应位置：

| 任务类型 | 应改位置 | 不应触碰 |
|---|---|---|
| 修改流程/能力/系统映射 | `docs/norms/`，再运行 `scripts/parse-sankey-data.mjs` | `apps/mdm-platform/server/` |
| 修改流程地图驾驶舱样式或展示 | `pmo/procedure-management/` | `docs/norms/` 流程输入基线和源文件材料 |
| 修改 MDM 平台能力 | `apps/mdm-platform/` | `pmo/`、`docs/superpowers/` |
| 修改AI结构化填报试点 | `apps/structure-assistant/`；如需读取3001结构规则再联动`apps/structured-output-service/` | `docs/norms/`流程输入基线、3000、PMO驾驶舱 |
| 修改 PMO 周会行动项服务 | `apps/weekly-action-service/` | PMO Markdown 真源、`pmo/tasks.json`、MDM 数据库 |
| 修改信息表收集服务 | `apps/information-collection-service/`；根级固定启动和迁移入口在 `scripts/` | MDM 治理业务表、`docs/norms/`、PMO 真源；身份表只读复用 |
| 修改项目甘特图或 PMO 看板 | `pmo/` | `apps/mdm-platform/` |
| 增加仓库级转换或校验 | `scripts/` | app 内部测试脚本，除非脚本只服务该 app |
| 修改代码、脚本、接口或启动命令 | 对应主责目录代码 + 对应 README/AGENTS/使用说明/术语表 | 只改代码不改文档 |
| 写审计、评审、稳定化报告 | `docs/reports/` | 根目录散放 |
| 写架构规则或职责说明 | 根目录边界文件、`docs/architecture/`、`docs/adr/` | `docs/norms/` |

代码、脚本、接口、数据库结构、前端行为、启动命令或测试命令发生变化时,必须同步检查并更新文档。无需更新文档时,交付说明必须写清原因。

## 5. 迁移规则

当前阶段不直接拆仓库，也不批量移动文件。任何整理动作按三步走：

1. **审计**：确认文件资产类型、基线/真源关系、是否已被脚本引用。
2. **提案**：列出旧路径、新路径、影响脚本、回滚方法。
3. **迁移**：只在引用和验证都明确后移动文件。

迁移风险分级：

| 风险 | 示例 | 处理方式 |
|---|---|---|
| 低 | 将审计报告新增到 `docs/reports/` | 可直接执行 |
| 中 | 将根目录 PMO YAML 归档到 `pmo/archive/` | 先查引用，再迁移 |
| 高 | 移动 `docs/norms/`、`pmo/procedure-management/dashboard.html`、`apps/mdm-platform/` | 必须有迁移计划和验证命令 |

## 6. AI 协作入口

后续 Codex 开始任务前，应先读：

1. `AGENTS.md`
2. `CODEX.md`
3. `REPOSITORY_BOUNDARY.md`
4. `DIRECTORY_OWNERSHIP.md`
5. `MAINLINE_MAP.md`
6. 与任务相关目录下的 `README.md` / `AGENTS.md`

若任务描述跨越多个资产类型，先确认主责资产，再执行。不要因为一个脚本能访问多个目录，就把这些目录视为同一类资产。
