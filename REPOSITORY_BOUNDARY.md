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
| 可运行系统 | MDM 平台源码、平台测试、平台维护脚本 | `apps/mdm-platform/` |
| PMO / 项目管理展示工具 | 流程地图驾驶舱、甘特图、项目管理页面、交付物工作台 | `pmo/` |
| 仓库级脚本工具 | 跨资料、跨页面、跨 app 的解析、注入、生成、校验脚本 | `scripts/` |
| AI 协作工作区 | Agent 技能、历史计划、Claude/Codex 协作配置 | `.agents/`、`.claude/`、`docs/superpowers/` |
| 历史方案归档 | 旧设计、旧计划、历史输出物、阶段性审查记录 | `docs/superpowers/`、`docs/archives/` |

## 2. 放入规则

### 可以放入

- 与昌兴复材信息化治理、流程地图、数据地图、主数据治理、项目管理有关的资料。
- 当前仍需运行或验证的应用源码。
- 由资料真源生成展示页面所需的仓库级脚本。
- 经过确认需要长期追溯的审计报告、设计记录、ADR 和迁移方案。
- 用于复现格式和契约的最小样例。

### 不应放入

- 浏览器抓取记录、临时截图、批量渲染结果、PPTX 解包目录。
- 本地依赖目录，例如 `node_modules/`。
- 运行态数据库、Cookie、日志和临时服务输出。
- 同一份项目数据的多轮试错导出，除非已被标记为样例或历史归档。
- 个人临时草稿、未脱敏数据和一次性中间文件。

## 3. 当前真源规则

| 真源类型 | 当前真源 | 禁止误判 |
|---|---|---|
| 部门到域映射 | `docs/organization/组织架构和部门职责.md` | 不从页面硬编码、截图或 MDM 临时库反推 |
| 流程数据 | `docs/norms/{部门}部门-能力-流程-系统映射关系.md` | 不把 PMO 驾驶舱 HTML 当原始来源 |
| PMO 流程地图展示 | `pmo/procedure-management/dashboard.html` 内嵌 `#sankey-data` | 不绕过 `scripts/parse-sankey-data.mjs` 手工重造数据 |
| PMO 项目计划 | `pmo/信息化项目_计划管控真源.md` 和 `pmo/信息化项目_WBS结构真源.md` | 不把 XLSX 备份当默认维护入口 |
| MDM 平台源码 | `apps/mdm-platform/server/`、`public/`、`scripts/` | 不把流程治理资料直接写进平台源码 |
| MDM 运行态数据库 | `apps/mdm-platform/data/*.db` | 不作为仓库真源，不应提交 |

## 4. 变更规则

任何变更先判断资产类型，再改对应位置：

| 任务类型 | 应改位置 | 不应触碰 |
|---|---|---|
| 修改流程/能力/系统映射 | `docs/norms/`，再运行 `scripts/parse-sankey-data.mjs` | `apps/mdm-platform/server/` |
| 修改流程地图驾驶舱样式或展示 | `pmo/procedure-management/` | `docs/norms/` 原始资料 |
| 修改 MDM 平台能力 | `apps/mdm-platform/` | `pmo/`、`docs/superpowers/` |
| 修改项目甘特图或 PMO 看板 | `pmo/` | `apps/mdm-platform/` |
| 增加仓库级转换或校验 | `scripts/` | app 内部测试脚本，除非脚本只服务该 app |
| 写审计、评审、稳定化报告 | `docs/reports/` | 根目录散放 |
| 写架构规则或职责说明 | 根目录边界文件、`docs/architecture/`、`docs/adr/` | `docs/norms/` |

## 5. 迁移规则

当前阶段不直接拆仓库，也不批量移动文件。任何整理动作按三步走：

1. **审计**：确认文件资产类型、真源关系、是否已被脚本引用。
2. **提案**：列出旧路径、新路径、影响脚本、回滚方法。
3. **迁移**：只在引用和验证都明确后移动文件。

迁移风险分级：

| 风险 | 示例 | 处理方式 |
|---|---|---|
| 低 | 将审计报告新增到 `docs/reports/` | 可直接执行 |
| 中 | 将根目录 PMO YAML 归档到 `pmo/archive/` | 先查引用，再迁移 |
| 高 | 移动 `docs/norms/`、`pmo/procedure-management/dashboard.html`、`apps/mdm-platform/` | 必须有迁移计划和验证命令 |

## 6. AI 协作入口

后续 Codex / Claude Code 开始任务前，应先读：

1. `REPOSITORY_BOUNDARY.md`
2. `DIRECTORY_OWNERSHIP.md`
3. `MAINLINE_MAP.md`
4. 与任务相关目录下的 `README.md` / `AGENTS.md` / `CLAUDE.md`

若任务描述跨越多个资产类型，先确认主责资产，再执行。不要因为一个脚本能访问多个目录，就把这些目录视为同一类资产。
