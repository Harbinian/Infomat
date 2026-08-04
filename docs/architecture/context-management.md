# Infomat 上下文管理说明

> 状态：执行说明
> 生效日期：2026-06-30
> 范围：项目资料、PMO 展示、MDM 承接、脚本工具、历史方案和 Codex 协作上下文。

## 1. 上下文分层

| 层级 | 作用 | 当前入口 |
|---|---|---|
| 执行规则 | 规定 Codex 怎么开始任务、怎么判断边界、怎么交付 | `AGENTS.md`、`CODEX.md` |
| 仓库边界 | 规定仓库放什么、不放什么、各目录怎么改 | `REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md` |
| 主线关系 | 规定组织真源、流程输入基线、PMO、MDM、脚本之间的数据流 | `MAINLINE_MAP.md` |
| 机器可读校验规则 | 规定脚本、模型输出和平台承接必须遵守的数据结构 | `docs/contracts/` |
| 资料真源 | 当前可维护的业务资料入口 | `docs/organization/`、`docs/norms/`、`pmo/*.md` |
| 展示副本 | 由真源或脚本生成给人看的页面和 JSON | `pmo/procedure-management/dashboard.html`、`docs/company-sankey-data.json`、`pmo/tasks.json` |
| 历史追溯 | 历史方案、历史计划、审计记录 | `docs/superpowers/`、`docs/reports/`、`docs/archives/` |
| Codex 技能 | 辅助 Agent 理解项目任务的技能和提示材料 | `.agents/` |

## 2. 默认读取顺序

跨目录任务按以下顺序读取上下文：

1. `AGENTS.md`
2. `CODEX.md`
3. `REPOSITORY_BOUNDARY.md`
4. `DIRECTORY_OWNERSHIP.md`
5. `MAINLINE_MAP.md`
6. 任务相关目录的 `README.md` / `AGENTS.md`
7. 具体真源、脚本或页面文件

历史报告、历史 plans/specs 只能在需要追溯来源时检索读取。历史材料与当前规则冲突时，以根目录执行规则和边界文件为准。

## 3. 真源优先规则

- 部门到域映射以 `docs/organization/组织架构和部门职责.md` 为准。
- 流程输入基线以 `docs/norms/{部门}部门-能力-流程-系统映射关系.md` 为准。
- 流程地图驾驶舱是展示副本，不手工维护内嵌 JSON。
- `docs/contracts/` 只定义机器可读的校验规则，例如文档结构化输出结构规则；这些规则不替代流程输入基线或组织真源。
- PMO 任务数据以 `pmo/信息化项目_计划管控真源.md`、`pmo/信息化项目_WBS结构真源.md` 和配套 PMO 真源为准。
- MDM 平台当前是后续承接应用，不反向覆盖 `docs/norms/` 或 PMO 真源。

## 4. 代码文档同步

代码、脚本、接口、数据库结构、前端行为、启动命令或测试命令变化时，必须同步检查文档。

优先更新：

- 所在目录 `README.md`
- 所在目录 `AGENTS.md`
- 根目录 `AGENTS.md` / `CODEX.md`
- `docs/glossary.md`
- 使用手册、运行说明、接口说明或 PMO 真源说明

无需更新文档时，交付说明必须写明原因。

## 5. 目录级 AGENTS.md 管理

目录级 `AGENTS.md` 用于补充某个关键目录的本地规则，不替代根目录规则。设置标准如下：

- 目录有独立真源、生成副作用、运行命令、验证口径或禁止事项时，应设置目录级 `AGENTS.md`。
- 目录只承载报告、归档、样例或说明性架构文档时，优先使用 README。
- 新增或调整目录级 `AGENTS.md` 时，同步更新 `DIRECTORY_OWNERSHIP.md`、相关目录 README 和本文件。

当前目录级 `AGENTS.md` 覆盖：

- `apps/mdm-platform/`
- `apps/structured-output-service/`
- `apps/structure-assistant/`
- `apps/weekly-action-service/`
- `pmo/`
- `pmo/procedure-management/`
- `pmo/gantt-react/`
- `pmo/deliverables/`
- `docs/norms/`
- `docs/Demo/`
- `scripts/`

`docs/norms/AGENTS.md` 还负责已确认工作角色绑定的局部卡口：候选不得写入基线，旧 Markdown 绑定必须同时维护受控证据表，任一无效 `confirmed` 关系会阻断公司快照生成。

## 6. 历史材料使用

`docs/superpowers/`、`docs/reports/` 和 `docs/archives/` 中可能保留旧路径、旧命令或旧工具名称。使用时只取可追溯事实，不把历史文件当当前执行入口。

历史材料中的旧 AI 入口说明仅代表当时状态。当前入口统一为 `AGENTS.md`、`CODEX.md` 和 `.agents/`。
