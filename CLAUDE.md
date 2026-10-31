# CLAUDE.md

测试脚本及辅助历史资料仅保留在维护者本机，不随 Git 分发；公开包不提供对应测试命令。本地验证须使用已有工具或明确取得的测试材料，并遵守隔离、权限和验收边界。


This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 指令入口

根 [`AGENTS.md`](AGENTS.md) 是本仓当前阶段、全仓硬规则和任务路由的权威入口；本文件只做 Claude Code 的操作速查，不覆盖也不替代它。进入某个目录修改前，先读该目录的 `AGENTS.md`。全部局部入口的唯一清单在 [`DIRECTORY_OWNERSHIP.md`](DIRECTORY_OWNERSHIP.md) 的 `codex-context-registry` 注册块。

其他按需入口：

- 跨资产变更、迁移、发布准备和验证选择：[`CODEX.md`](CODEX.md)
- 主线数据流（3001 → 3000、PMO、信息收集）：[`MAINLINE_MAP.md`](MAINLINE_MAP.md)
- 仓库收纳、生成物和历史资产：[`REPOSITORY_BOUNDARY.md`](REPOSITORY_BOUNDARY.md)
- 稳定术语：[`CONTEXT.md`](CONTEXT.md)、[`docs/glossary.md`](docs/glossary.md)

关键边界：

- **`docs/` 不是业务真源或治理依据。** 业务事实来自用户指定的外部原始材料、实际业务说明和明确确认；技术契约和历史测试只说明兼容现状。
- 当前主线：3001 编制单流程 → 用户主动下载未审核 JSON → 用户手动上传 3000 → 3000 治理、核对、审核并发布正式版本。3001 与 3000 不自动互写、不共享数据库。
- 修改前先看 Git 状态并保留已有改动；不执行 `git reset` / `git clean`；未经授权不暂存、提交或推送。
- 不读取、输出或提交 Secret。本机私有配置、`.env`、`scripts/*.local.env` 只核对存在性和使用入口。
- 用户指定一个端口、服务或资产时，只操作该对象。端口监听不等于应用可用，结论须取得该对象规定的健康或内容证据。
- 仅支持桌面：Microsoft Edge 100%、1699×828 CSS 像素；禁止窄屏适配和窄屏测试。
- 状态表述区分“已实现”“已准备”“已开启”“已验收”；自动化、隔离测试和候选服务不能替代实时运行证据或业务验收。

## 常用命令

所有命令默认从仓库根目录执行，除非写明先 `cd`。

### 仓库级

```powershell
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
npm run start:infomat-services        # 共同开发环境：MDM + PMO + MySQL(localhost:3307)
# 本地测试入口不随 Git 分发。
```

### 3000 MDM 平台（`apps/mdm-platform`）

当前正式运行对象是 Docker 容器 `infomat-mdm-3000`，入口 `http://127.0.0.1:3000/app/`。日常启停只操作该容器，具体实时核对见 [`DOCKER.md`](apps/mdm-platform/DOCKER.md)。

```powershell
npm --prefix apps/mdm-platform run build:frontend   # React 前端构建到 frontend/dist
npm --prefix apps/mdm-platform start                # 需显式 MySQL 读模型和连接变量；不回退 SQLite
npm --prefix apps/mdm-platform run service:start    # 仅 Windows 部署副本自有进程，不操作 Docker 容器
npm --prefix apps/mdm-platform run service:check
```

按改动选择测试，不要默认跑全套：

```powershell
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
```

单个 Node 测试可直接运行脚本；需要阻断真实 MySQL 的测试使用包装器：

```powershell
cd apps/mdm-platform
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
```

浏览器测试（`test:*-browser`）使用 Edge，需显式候选地址，不得指向正式 3000/3001 端口。MySQL 迁移、导入和发布命令有副作用，先核对目标、授权、备份和回滚条件。

### 3001 单流程编制工具（`apps/structured-output-service`）

3001 无状态，唯一持久化动作是用户主动下载 JSON。正式容器 `infomat-structured-output-3001` 映射 `0.0.0.0:3001`；候选实例必须使用独立端口。

```powershell
cd apps/structured-output-service
# 本地测试入口不随 Git 分发。
npm.cmd run build:workbench
npm.cmd run dev:workbench -- --port 5187 --strictPort
$env:STRUCTURED_OUTPUT_HOST='127.0.0.1'; $env:STRUCTURED_OUTPUT_PORT='3027'; npm.cmd start
Invoke-RestMethod http://127.0.0.1:3027/api/health
```

单个测试示例：本机保留的对应验证入口。浏览器回归使用 本机保留的对应验证入口、本机保留的对应验证入口 等 PowerShell 入口，连接显式指定的隔离候选地址。Docker 构建必须从仓库根目录执行，上下文为仓库根：

```powershell
docker compose -f apps/structured-output-service/compose.yaml build
docker compose -f apps/structured-output-service/compose.yaml up -d --no-build
```

### 4000 / 4001 信息表收集

当前开发与正式启用暂缓；恢复工作以用户明确要求为准。4000/4001 只读复用身份表，业务数据只写 `collection_*`。

```powershell
# 本地测试入口不随 Git 分发。
npm run start:information-collection
# 本地测试入口不随 Git 分发。
npm run migrate:information-collection:dry-run   # 有副作用，先核对目标与授权
npm run migrate:information-collection:apply
npm run check:information-collection-schema
```

### PMO（`pmo`）

Markdown 真源 → 生成器 → `tasks.json` / source manifest → React 甘特图和看板。生成文件不手工修改。

```powershell
cd pmo
python build_pmo_task_data.py

cd ..
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
```

PMO 开发服务：`cd pmo/gantt-react && npm run dev`，默认 `http://localhost:5174`。

### U8 出入库订单查询（`apps/u8-stock-order-query`）

正式 Docker 入口 `infomat-u8-stock-order-query-3088`，主机 `0.0.0.0:3088`；只读查询既有 SQL Server，不写单据。

```powershell
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
# 本地测试入口不随 Git 分发。
```

## 高层架构

### 目录职责

- `apps/`：可运行应用。每个应用以自身 README、`AGENTS.md`、`package.json` 为准。
- `docs/`：资料、技术合同、历史归档；只用于定位实现和兼容边界，不是业务真源。
- `pmo/`：PMO 计划真源、React 甘特图/看板、交付物和展示工具。
- `scripts/`：跨应用、跨资料的仓库级自动化；只服务单个应用的脚本留在该应用目录。
- `.agents/skills/`：项目技能正文；`.claude/skills/` 只放薄入口。
- `artifacts/`、`output/`、`build/`、`tmp/`：本地生成物和验证证据，默认被 Git 忽略。

### 3000 MDM 平台

- 后端为 Express + MySQL：入口 `apps/mdm-platform/server/index.js`，新接口放在 `server/routes/` 并在入口注册。正式运行使用 MySQL；SQLite 仅保留历史迁移和隔离测试，公开命令须带 `legacy-sqlite:` 前缀。
- 前端为同源 React + Vite，仅开放 `/app/`；根路径转向该入口，旧版 `public/index.html` 已删除。`shared/browserProtocol.js` 负责把历史办理目标转到当前页面。
- 身份链固定为 `person -> user_accounts -> person_roles`。权限走 `server/auth.js` 中间件和 `server/access.js` 范围核验；`server/roleDefinitions.js` 固定七个 MDM 角色、十九项权限和 RACI，不按角色名称直接放行，也不自定义角色或通配权限。
- 流程格式策略在 `server/processNativeFormats.js`。当前主线是原生 `process-governance-v8`，受支持 V7 保留正文、标识、摘要和审核历史；`process-v7` API、表名、`PROCESS_V7_*` 开关和摘要机器名只是兼容名称，不能据此判断正文版本。
- 预览、正式审核发布和数据治理工作包分别由 `PROCESS_V7_PREVIEW_ENABLED`、`PROCESS_V7_FORMAL_ENABLED`、`PROCESS_DATA_GOVERNANCE_ENABLED` 控制，默认关闭。功能开关开启不等于业务验收。
- 3000 与 3001 共享纯校验模块 `scripts/process-governance/v7-validator.js`（V7/V8 按版本分派），但 3000 不读取、不代管 3001 服务。

### 3001 单流程编制工具

- `server.js` 提供无状态 HTTP 服务；前端 React 工作台源码在 `frontend/`，构建产物写入 `public/workbench/`，资源基路径固定为 `/workbench/`。
- `frontend/controller.mjs` 的 `getSnapshot / subscribe / dispatch / destroy` 是业务状态唯一入口，统一拥有文档、修订、选择、编辑会话、检查和下载基线。React 表单、图实例和表格不各自提交 JSON。
- 所有业务内容只存在当前页面内存中。导入支持 v1–v8 和 `document-structured-output-v2` 多候选文件，迁移只在内存中进行；失败或取消时当前草稿、图状态、撤销记录和源文件保持不变。
- 下载是唯一保存方式；未应用修改、已应用未下载、已下载三种状态必须严格区分。刷新、关闭页面或服务重启后不恢复草稿。
- 流程图使用锁定的 `elkjs` 在本地 Worker 计算布局；图坐标、缩放、选择不写入 JSON。

### 4000 / 4001 信息表收集

- 4000 负责表单设计、任务发布、完成情况和导出；4001 负责本人填报、服务器草稿、提交和截止前修改。
- 身份数据只读复用 `person`、`user_accounts`、`departments`；业务数据只写 `collection_*` 表；附件正文写入仓库外 `COLLECTION_FILE_ROOT`，MySQL 只存元数据和哈希。
- 发布后的表单版本和填报人员快照不可修改；答卷写入必须由服务端校验表单版本、本人任务、任务状态和 `expectedRevision`。

### PMO

- 七份 Markdown 真源分别管计划、WBS、执行标准、工作平衡、工作开展原则、协同规则和部门主备对接人；XLSX/MPP/CSV 导入已废弃。
- `pmo/build_pmo_task_data.py` 一次性生成 `pmo/tasks.json`、`pmo/pmo-source-manifest.json` 及 `pmo/gantt-react/public/` 下的消费副本。字段合同是生成器中的 `TASK_OUTPUT_FIELD_KEYS`，不是从样本反推。
- `pmo/procedure-management/dashboard.html` 是历史展示副本，不承担当前治理依据。

## 验证与交付口径

- 只读检查、已授权的本地修改和隔离验证连续完成；修复相关失败后复验，不以首稿或计划代替交付。
- 已通过且未受新改动影响的检查不重复；纯文案修改不默认跑应用全套检查、依赖审计、性能测试或启动服务。
- 结构、字段、状态、枚举、标识、引用、权限或导入导出格式变化时，必须在同一版本工作中处理受支持旧数据；不静默删除、清空、猜测或用默认值掩盖无法迁移的内容。
- 候选服务、静态检查、隔离测试和软件发布都不能替代实时运行证据。运行结论至少核对目标对象的监听、健康接口和应用内容；UI 结论需要真实浏览器行为证据。
- 禁止把计划写成完成、建议写成决定、技术检查写成业务验收。

## 生成物与历史资产

`artifacts/` 用于新的本地生成物和验证证据；`output/`、`_tmp/`、`.tmp/`、`snapshots/`、`ai_materials/` 等包含历史资产，未经明确迁移授权不移动、不删除、不重排。可再生成内容不提交；已有受控派生文件的边界见 [`REPOSITORY_BOUNDARY.md`](REPOSITORY_BOUNDARY.md)。
