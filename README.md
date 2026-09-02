# Infomat

Infomat 是航空复材制造领域的信息化资料与工具仓库，包含：

- 资料与交付文档：业务流程、数据地图、制度体系文件、集成方案等
- 可运行应用：MDM 平台、单流程治理编制工具、MDM-AI助手、PMO 周会行动项服务、信息表收集服务
- 辅助工具与脚本：用于可视化、导入导出、文档生成与校验

## 仓库边界

开始跨目录任务前先读：

- [AGENTS.md](AGENTS.md)：Codex 根入口规则。
- [CODEX.md](CODEX.md)：Codex 执行纪律、文档同步和验证口径。
- [MEMORY.md](MEMORY.md)：长期项目上下文；先读取文件前部的当前运行基线，历史和长期条目按任务关键词检索。
- [REPOSITORY_BOUNDARY.md](REPOSITORY_BOUNDARY.md)：仓库放什么、不放什么。
- [DIRECTORY_OWNERSHIP.md](DIRECTORY_OWNERSHIP.md)：每个目录的责任、入口/真源和禁止事项。
- [MAINLINE_MAP.md](MAINLINE_MAP.md)：流程治理、字段台账、MDM、PMO 和脚本的数据流。
- [docs/architecture/context-management.md](docs/architecture/context-management.md)：项目资料上下文分层、读取顺序和历史材料使用规则。
- [2026-06-07 仓库边界审计报告](docs/reports/2026-06-07-repo-boundary-audit.md)：当前混放、生成物和轻量整理建议。

## 目录结构（当前导航）

- `apps/`：可运行应用
  - `apps/mdm-platform/`：MDM 平台（Express + MySQL 当前运行形态 + 原生前端；SQLite 仅用于历史兼容和隔离测试）
  - `apps/structured-output-service/`：单流程治理编制工具（局域网 3001，按统一结构规则提供无状态编辑和结构化文件导入导出）
  - `apps/structure-assistant/`：MDM-AI助手，当前为独立的五账号内网浏览器试点（集中部署，调用DeepSeek云端API，显式读取3001的v5公开结构规则；不是3001的访问入口或运行依赖）
  - `apps/weekly-action-service/`：PMO 周会行动项服务（本地 3002，保存每周例会行动项运行台账）
  - `apps/information-collection-service/`：信息表收集服务（4000管理端、4001实名填报端，业务数据写入`collection_*`表）
- `docs/`：资料、说明、方案与沉淀
  - `docs/samples/`：必要样例（用于复现、格式示例与对齐）
  - `docs/superpowers/`：历史方案与计划（可能含旧路径，按仓库结构说明做替换）
  - `docs/norms/`：制度/表单源文件材料与部门流程输入基线（流程地图/数据地图）
  - `docs/organization/`：组织架构与部门职责（**部门→域映射的真源**；修改前读取目录 `AGENTS.md`）
  - `docs/contracts/`：脚本和模型使用的机器可读校验规则，例如文档结构化输出结构规则（修改前读取目录 `AGENTS.md`）
  - `pmo/procedure-management/dashboard.html`：桑基图数据内嵌于 `<script id="sankey-data">`，由 `scripts/parse-sankey-data.mjs` 直接注入
- `pmo/`：项目管理工作室
  - `pmo/procedure-management/dashboard.html`：**流程地图驾驶舱**（单文件可双击打开，数据已内嵌于 `<script id="sankey-data">`）
  - `pmo/gantt-react/`：React 甘特图 / PMO 看板（开发模式 `npm run dev`）
  - `pmo/deliverables/`：PMO 受控交付物，修改前读取目录 `AGENTS.md`
  - `pmo/organization-dynamics/`：组织数字化参与度模型，修改前读取目录 `AGENTS.md`
- `scripts/`：仓库级脚本（修改前读取 `scripts/AGENTS.md`）
  - `scripts/parse-sankey-data.mjs`：从流程输入基线生成桑基图 JSON
- `.planning/`：架构/结构/集成规划与扫描记录
- `.agents/`：Codex 可用的项目技能与提示材料（不应包含生成物）
- `.codex/config.toml`：仓库内 Codex 展示与推理偏好，不保存凭据、主机配置或业务事实

## 代码与文档同步

每次代码、脚本、接口、数据库结构、前端行为、启动命令或测试命令变化,必须同步检查并更新对应文档。优先更新所在目录 `README.md` / `AGENTS.md`,必要时同步根目录规则、`docs/glossary.md`、使用手册或运行说明。

目录级 `AGENTS.md` 只放在有独立真源、生成副作用、运行命令、验证口径或禁止事项的关键目录；纯报告、归档、样例和说明性架构目录默认使用 README。

如果确认无需文档更新,提交或交付说明中必须写明原因。

## Codex 上下文入口

Codex 自动加载根目录和当前目录的 `AGENTS.md`。根入口只保留全仓硬规则和任务路由；实施细节按任务读取 `CODEX.md`、职责文件、主线文件、应用 README/PRD/Tech-Spec 和测试说明。设计原则、预算、注册来源与维护方法见 [docs/architecture/context-management.md](docs/architecture/context-management.md)。

修改项目指令或路由后，从仓库根目录运行：

```powershell
npm run test:codex-context
```

## 派生文件与样例规则

- 主线直接消费、具有固定生成命令和一致性检查的文件，可以按 [ADR-0004](docs/adr/0004-controlled-derived-consumer-files.md) 的 `Proposed` 方案继续进入版本控制；该 ADR 尚未 `Accepted`
- 临时输出、缓存、日志、截图、一次性预览和其他可再生成中间文件统一放到 `artifacts/`（或工具声明的临时目录），不得提交到仓库
- 仅保留“必要样例”到 `docs/samples/`：用于说明输入输出格式、核对规则、复现最小流程
- 禁止提交：浏览器 profile、抓取记录、临时解包目录、批量导出结果、含敏感信息的日志

## MDM 平台

MDM 平台使用仓库根目录的固定启动入口。

第一次启动前，在本机私有文件 `scripts/infomat-services.local.env` 写入两项密码；该文件已被 `.gitignore` 忽略，只保留在本机：

```text
MYSQL_PASSWORD=你的项目 MySQL 密码
MDM_ADMIN_PASSWORD=你的管理员密码
```

之后统一使用：

```powershell
npm run start:infomat-services
npm run smoke:infomat-services
```

固定配置见 `scripts/infomat-services.config.json`：

| 项 | 固定值 |
|---|---|
| MDM | `http://127.0.0.1:3000` |
| PMO | 本机 `http://127.0.0.1:5173`；同事访问 `http://<本机局域网IP>:5173` |
| MySQL | `localhost:3307` |
| MySQL 用户 / 库 | `mdm_user` / `infomat_mdm` |
| MySQL 连接池 | `MYSQL_CONNECTION_LIMIT=16` |
| 读模型 | `MDM_IDENTITY_READ_MODEL=mysql`、`PROCESS_GOVERNANCE_READ_MODEL=mysql` |
| 管理员工号 | `ADMIN001` |

启动脚本会使用固定 Docker 容器 `infomat-input-baseline-review-mysql`，并按固定环境启动 MDM 与 PMO。更多说明见 [apps/mdm-platform/README.md](apps/mdm-platform/README.md) 和 [scripts/README.md](scripts/README.md)。

文档结构化输出的数据模型以 [docs/contracts/document-structured-output.schema.json](docs/contracts/document-structured-output.schema.json) 为准；说明和投影规则见 [docs/contracts/document-structured-output-schema.md](docs/contracts/document-structured-output-schema.md)。修改相关字段、表结构、前端页面或结构块 parser 后，运行：

```powershell
npm run test:document-structured-output-schema
npm run build:work-role-data
npm run test:work-role-contract
```

单流程治理编制工具在 [apps/structured-output-service](apps/structured-output-service/README.md)，默认监听`0.0.0.0:3001`，公司局域网用户通过`http://<服务器局域网IP>:3001`直接使用。该工具只在当前页面内存中编制一条流程，支持空白新建、历史JSON迁移、花名册岗位选择、主表和明细表填写、只读流程图预览及单流程JSON导入导出。页面不提供编制参考材料入口，不保存用户内容，不写回流程输入基线、花名册或工作角色真源，也不依赖DeepSeek、MDM-AI助手或认证网关。

MDM-AI助手在 [apps/structure-assistant](apps/structure-assistant/README.md)。它当前承载独立的五账号内网结构化填报试点，由服务器集中部署，用户只使用浏览器；5个试点账号分别调用独立DeepSeek接口密钥。试点显式读取3001的`process-governance-v5`结构规则，并在每次模型调用前后核对Git提交和结构摘要；它不保存材料、对话、草稿或模型答复，也不自动写入3001或3000。启动或停止该试点不得影响3001，局域网用户使用3001无需经过该试点。

PMO 周会行动项服务在 [apps/weekly-action-service](apps/weekly-action-service/README.md)，默认端口 `3002`。该服务用于登记和跟踪每周例会行动项、风险、问题、变更和责任池事项，数据保存到服务端本机运行台账；它不写回 PMO Markdown 真源、`tasks.json` 或 MDM 数据库。

信息表收集服务在 [apps/information-collection-service](apps/information-collection-service/README.md)。同一Express进程提供4000管理端和4001实名填报端；应用只读复用MDM人员、账号和部门身份数据，权限及收集业务数据独立写入`collection_*`表，附件正文写入仓库外受控目录。只有从未发布且没有版本、任务记录的表单设计稿可以删除，已经发布或保留历史的表单只能归档。

## 流程地图驾驶舱

**双击即开**:直接双击 `pmo/procedure-management/dashboard.html` 即可在浏览器查看（数据已内嵌,无需 HTTP 服务,无双击空白问题）。

**单域直链**:
- `pmo/procedure-management/dashboard.html` — 全公司
- `pmo/procedure-management/dashboard.html?domain=经营域` — 经营域
- `pmo/procedure-management/dashboard.html?domain=生产域` — 生产域
- `pmo/procedure-management/dashboard.html?domain=总经理直辖域` — 总经理直辖域

**更新数据**:修改流程输入基线 Markdown 后,运行:
```bash
node scripts/parse-sankey-data.mjs
```
脚本会直接注入 `pmo/procedure-management/dashboard.html` 的 `#sankey-data` 标签,刷新/重新双击即可看到最新数据。

**部门→域映射**以 `docs/organization/组织架构和部门职责.md` 为准(总经理直辖:工程技术部/质量管理部/财务部;经营副总:行政人事部/经营发展部/物资保障部;生产副总:项目管理部/复材车间/运维安环部)。

