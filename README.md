# Infomat

Infomat 是航空复材制造领域的信息化资料与工具仓库，包含：

- 资料与交付文档：业务流程、数据地图、制度体系文件、集成方案等
- 可运行应用：MDM 平台、单流程治理编制工具、信息表收集服务
- 辅助工具与脚本：用于可视化、导入导出、文档生成与校验

## 仓库边界

按任务从以下入口定位职责与实现；跨资产任务依根 `AGENTS.md` 选择相关章节：

- [AGENTS.md](AGENTS.md)：Codex 根入口规则。
- [CODEX.md](CODEX.md)：Codex 执行纪律、文档同步和验证口径。
- [MEMORY.md](MEMORY.md)：历史项目上下文，按关键词追溯；文件内旧“当前运行基线”不代表当前版本、能力或服务状态。
- [REPOSITORY_BOUNDARY.md](REPOSITORY_BOUNDARY.md)：仓库放什么、不放什么。
- [DIRECTORY_OWNERSHIP.md](DIRECTORY_OWNERSHIP.md)：每个目录的责任、入口/真源和禁止事项。
- [MAINLINE_MAP.md](MAINLINE_MAP.md)：流程治理、字段台账、MDM、PMO 和脚本的数据流。
- [docs/architecture/context-management.md](docs/architecture/context-management.md)：项目资料上下文分层、读取顺序和历史材料使用规则。
- [2026-06-07 仓库边界审计报告](docs/reports/2026-06-07-repo-boundary-audit.md)：当时的混放、生成物和轻量整理建议，仅用于追溯。

## 目录结构（当前导航）

- `apps/`：可运行应用
  - `apps/mdm-platform/`：MDM 平台（Express + MySQL 当前运行形态 + 原生前端；SQLite 仅用于历史兼容和隔离测试）
  - `apps/structured-output-service/`：单流程治理编制工具（局域网 3001，按统一结构规则提供无状态编辑和结构化文件导入导出）
  - `apps/information-collection-service/`：信息表收集服务（4000管理端、4001实名填报端，业务数据写入`collection_*`表）
- `docs/`：资料、说明、方案与沉淀
  - `docs/samples/`：必要样例（用于复现、格式示例与对齐）
  - `docs/superpowers/`：历史方案与计划（可能含旧路径，按仓库结构说明做替换）
  - `docs/norms/`：历史制度、表单和部门映射资料，保留旧消费链兼容，不作为当前治理依据
  - `docs/organization/`：组织、人员和职责的历史资料及转换副本；修改前读取目录 `AGENTS.md`
  - `docs/contracts/`：脚本和模型使用的机器可读校验规则，例如文档结构化输出结构规则（修改前读取目录 `AGENTS.md`）
  - `pmo/procedure-management/dashboard.html`：桑基图数据内嵌于 `<script id="sankey-data">`，由 `scripts/parse-sankey-data.mjs` 直接注入
- `pmo/`：项目管理工作室
  - `pmo/procedure-management/dashboard.html`：**流程地图驾驶舱**（单文件可双击打开，数据已内嵌于 `<script id="sankey-data">`）
  - `pmo/gantt-react/`：React 甘特图 / PMO 看板（开发模式 `npm run dev`）
  - `pmo/deliverables/`：PMO 受控交付物，修改前读取目录 `AGENTS.md`
  - `pmo/organization-dynamics/`：组织数字化参与度模型，修改前读取目录 `AGENTS.md`
- `scripts/`：仓库级脚本（修改前读取 `scripts/AGENTS.md`）
  - `scripts/parse-sankey-data.mjs`：显式维护历史资料消费链时生成桑基图 JSON，不提供当前治理依据
- `.planning/`：架构/结构/集成规划与扫描记录
- `.agents/`：Codex 可用的项目技能与提示材料（不应包含生成物）
- `.codex/config.toml`：仓库内 Codex 展示与推理偏好，不保存凭据、主机配置或业务事实

## 代码与文档同步

行为、接口、数据合同、命令或维护边界变化时，同步承载该信息的 README、规格或使用说明；内部实现调整且说明仍准确时无需改写。目录职责和硬规则变化时才同步入口，新增术语或改变含义时同步 `docs/glossary.md`。

目录级 `AGENTS.md` 只放在有独立真源、生成副作用、运行命令、验证口径或禁止事项的关键目录；纯报告、归档、样例和说明性架构目录默认使用 README。

最终说明实际变化、验证和实质限制；不要求逐份声明没有修改的文档。

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

仅操作3000时使用应用README的 `service:start|stop|restart|check` 并按前置条件核对目标。以下仓库根入口用于MDM、PMO及MySQL的共同开发环境，会操作三者；只有任务授权该组合范围时才使用。

第一次启动前，在本机私有文件 `scripts/infomat-services.local.env` 写入两项密码；该文件已被 `.gitignore` 忽略，只保留在本机：

```text
MYSQL_PASSWORD=你的项目 MySQL 密码
MDM_ADMIN_PASSWORD=你的管理员密码
```

完成联合环境授权及前置核对后使用：

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
| MySQL 用户 / 库 | `sa` / `infomat_mdm` |
| MySQL 连接池 | `MYSQL_CONNECTION_LIMIT=16` |
| 读模型 | `MDM_IDENTITY_READ_MODEL=mysql`、`PROCESS_GOVERNANCE_READ_MODEL=mysql` |
| 管理员工号 | `ADMIN001` |

启动脚本会使用固定 Docker 容器 `infomat-input-baseline-review-mysql`，并按固定环境启动 MDM 与 PMO。更多说明见 [apps/mdm-platform/README.md](apps/mdm-platform/README.md) 和 [scripts/README.md](scripts/README.md)。

文档结构化证据草稿的兼容数据模型以 [docs/contracts/document-structured-output.schema.json](docs/contracts/document-structured-output.schema.json) 为准；说明和投影规则见 [docs/contracts/document-structured-output-schema.md](docs/contracts/document-structured-output-schema.md)。修改v2证据草稿schema、技能消费或旧结构块parser兼容行为后，按影响运行：

```powershell
npm run test:document-structured-output-schema
npm run test:work-role-contract
```

单流程治理编制工具在 [apps/structured-output-service](apps/structured-output-service/README.md)，默认监听`0.0.0.0:3001`，公司局域网用户通过`http://<服务器局域网IP>:3001`直接使用。本工作区默认V8候选，V7保留历史兼容；正式实例版本和状态须核对健康响应及部署记录。该工具只在当前页面内存中编制一条流程，支持空白新建、历史JSON迁移、花名册岗位选择、主表和明细表填写、只读流程图预览及单流程JSON导入导出。页面不提供编制参考材料入口，不保存用户内容，不写回流程输入基线、花名册或工作角色真源，也不依赖DeepSeek、MDM-AI助手或认证网关。



信息表收集服务在 [apps/information-collection-service](apps/information-collection-service/README.md)。同一Express进程提供4000管理端和4001实名填报端；应用只读复用MDM人员、账号和部门身份数据，权限及收集业务数据独立写入`collection_*`表，附件正文写入仓库外受控目录。只有从未发布且没有版本、任务记录的表单设计稿可以删除，已经发布或保留历史的表单只能归档。

## 流程地图驾驶舱

**双击即开**:直接双击 `pmo/procedure-management/dashboard.html` 即可在浏览器查看（数据已内嵌,无需 HTTP 服务,无双击空白问题）。

**单域直链**:
- `pmo/procedure-management/dashboard.html` — 全公司
- `pmo/procedure-management/dashboard.html?domain=经营域` — 经营域
- `pmo/procedure-management/dashboard.html?domain=生产域` — 生产域
- `pmo/procedure-management/dashboard.html?domain=总经理直辖域` — 总经理直辖域

**历史展示链更新**：仅在明确授权维护旧消费链时，核对历史 Markdown 输入后运行：
```bash
node scripts/parse-sankey-data.mjs --legacy-display --domain-map <historical-domain-map.json> --out <snapshot.json>
```
该命令只写指定快照；追加 `--dashboard pmo/procedure-management/dashboard.html` 才更新页面内嵌数据。若使用默认驾驶舱一致性检查，输出须明确选择 `docs/company-sankey-data.json`，按获准的历史资产维护处理。

**治理依据**：所有 `docs/` 文件的真源身份已于2026-09-11撤销。当前部门、职责、人员及流程事实来自用户指定的外部原始材料和明确业务确认；旧parser改为显式选定的部门域JSON；历史norms和工作角色消费不提供当前治理权威。

