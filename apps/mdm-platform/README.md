# MDM 平台

## 先读这份

如果你想知道平台现在到底能做什么、每个角色应该怎么用，请先看：

- [MDM 平台角色化使用手册](docs/role-based-usage-guide.md)

这份手册按角色、页面、流程和当前限制说明现有能力，比下面的模块清单更适合开发者走读和演示。

## 边界和入口

`apps/mdm-platform/` 只负责 MDM 平台应用本身：Express 路由、MySQL 目标 schema、单文件前端、应用内脚本和平台使用说明。

不在本目录维护流程输入基线、PMO 驾驶舱或仓库级数据转换脚本：

- 流程输入基线：`docs/norms/{部门}部门-能力-流程-系统映射关系.md`
- 组织真源：`docs/organization/组织架构和部门职责.md`
- PMO 展示：`pmo/procedure-management/dashboard.html`
- 仓库级脚本：根目录 `scripts/`

开发 MDM 代码前先读 [AGENTS.md](AGENTS.md)。执行、调整或新增应用内脚本前先读 [scripts/README.md](scripts/README.md)。

## 快速启动

MDM 和 PMO 从仓库根目录使用固定入口启动。固定入口会统一写入 MDM 端口、PMO 端口、MySQL 端口、MySQL 用户、数据库名和 MySQL 读模型。

```powershell
cd E:\CA001\Infomat
npm run start:infomat-services
npm run smoke:infomat-services
```

访问 `http://localhost:3000`。

固定配置在 `scripts/infomat-services.config.json`：

| 项 | 固定值 |
|---|---|
| MDM | `127.0.0.1:3000` |
| PMO | 本机访问 `127.0.0.1:5173`，服务监听 `0.0.0.0:5173` |
| MySQL | `localhost:3307` |
| MySQL 用户 / 库 | `mdm_user` / `infomat_mdm` |
| MySQL 连接池 | `MYSQL_CONNECTION_LIMIT=16` |
| 读模型 | `MDM_IDENTITY_READ_MODEL=mysql`、`PROCESS_GOVERNANCE_READ_MODEL=mysql` |
| 管理员工号 | `ADMIN001` |

本机密码放在仓库根目录的 `scripts/infomat-services.local.env`，该文件只保留在本机：

```text
MYSQL_PASSWORD=你的项目 MySQL 密码
MDM_ADMIN_PASSWORD=你的管理员密码
```

平台不会自动创建新的默认管理员。当前固定管理员账号是 `ADMIN001`，密码来自本机私有 env 文件。脚本不会在仓库中保存密码、Cookie 或本地数据库。

全新 clone 或另一台设备拉取后，如需重建 MySQL schema 和平台基线，先确认固定 MySQL 容器和 `scripts/infomat-services.local.env` 已准备好，再在 `apps/mdm-platform/` 下执行：

```powershell
cd E:\CA001\Infomat
$localEnv = Get-Content scripts\infomat-services.local.env
$env:MYSQL_PASSWORD = ($localEnv | Where-Object { $_ -like 'MYSQL_PASSWORD=*' }).Split('=',2)[1]
$env:MDM_ADMIN_PASSWORD = ($localEnv | Where-Object { $_ -like 'MDM_ADMIN_PASSWORD=*' }).Split('=',2)[1]
$env:MYSQL_HOST = "localhost"
$env:MYSQL_PORT = "3307"
$env:MYSQL_USER = "mdm_user"
$env:MYSQL_DATABASE = "infomat_mdm"
$env:MYSQL_CONNECTION_LIMIT = "16"
$env:MDM_IDENTITY_READ_MODEL = "mysql"
$env:PROCESS_GOVERNANCE_READ_MODEL = "mysql"
$env:MDM_ADMIN_EMPLOYEE_NO = "ADMIN001"
cd apps\mdm-platform
npm install
npm run init:mysql
npm run setup:local-baseline
```

`npm run init:mysql` 会初始化 MySQL schema 中已迁移的身份/RBAC、输入基线问题复核、流程治理读模型、数据地图字段域、术语治理、旧映射审批、冲突治理、通用待办和平台通用审计表。`npm run setup:local-baseline` 仍是迁移过渡期的幂等基线入口，会：

- 初始化遗留本地 schema 和系统角色/权限。
- 从 `docs/organization/组织架构和部门职责.md` 同步组织架构、领导岗位和对应人员。
- 仅为 `MDM_ADMIN_EMPLOYEE_NO` 指定的管理员创建/补齐 `admin` RBAC 角色。

默认基线不导入花名册账号或项目账号，避免把本机登录账号状态当成仓库真源。确需导入花名册用户时，先确认口令策略和数据边界，再单独运行对应导入脚本。

迁移完成前，如需运行仍依赖遗留本地库的测试，可通过隔离路径避免写默认运行态文件：

```powershell
$env:MDM_DB_PATH="$env:TEMP\mdm-platform-baseline.db"
```

## 功能模块

- 统计看板：各部门提交流程数、待办数、冲突数、字段台账完成率
- 数据地图：按上下文维护字段台账、字段定义、系统关系和黄金源
- 数据报送：表单录入 + Excel 批量导入
- 审批流：提交 -> 部门内审 -> 跨部门确认 -> 字段台账确认 -> 终审
- 跨部门待办：给其他部门派发待办
- 冲突管理：字段冲突 + 术语冲突，severity 分级
- 术语词典：术语维护 + 审批流
- 版本记录：映射和字段台账的关键修改历史
- Excel 导入：字段台账模板上传，按 Data Map context 入库
- Excel 导出：字段台账 + 黄金源矩阵

## 技术栈

- 前端：单文件 HTML（原生 JS + CSS，参考演示文件视觉风格）
- 后端：Express.js + MySQL（正式运行路径按 MySQL-only；遗留 SQLite 代码只作为测试隔离和待删除实现保留）
- 认证：bcryptjs + express-session
- 导入/导出：multer + exceljs

## 常用命令

```bash
npm run init-db
npm run smoke
npm run test:org
npm run test:catalog
npm run test:mappings
npm run test:conflicts
npm run test:terms
npm run test:export
npm run test:import
npm run test:user-password-scripts
npm run test:password-audit
npm run test:frontend
npm run test:local-baseline
npm run test:security
npm run test:mainline
npm run test:mysql-config
npm run test:identity-mysql
npm run test:data-map-mysql
npm run test:field-entries-mysql
npm run test:field-identities-mysql
npm run test:data-map-import-export-mysql
npm run test:terminology-mysql
npm run test:mappings-mysql
npm run test:conflicts-mysql
npm run test:todos-mysql
npm run test:versions-mysql
npm run test:activity-mysql
npm run test:role-workbench-mysql
npm run init:mysql
npm run smoke:data-map-mysql
npm run import:process-input-baseline-review -- --review-run artifacts/process-input-baseline-review/<run-id>
```

`npm run test:security` 已包含批量用户脚本口令红线：项目账号脚本和 Excel 用户导入脚本不得硬编码固定初始密码，新建账号必须标记首次登录改密。

如需只读检查历史库中是否仍有旧固定口令账号，可运行：

```bash
node scripts/audit-fixed-default-passwords.js
```

该脚本只做 dry-run 审计，不改密码、不输出密码哈希。

## MDM 一期升级命令

流程治理升级链路：

```bash
npm run test:mainline
npm run test:process-governance
npm run import:process-governance-mysql
npm run smoke:process-governance-mysql
```

数据库安全约定：

- MySQL 连接统一使用 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`MYSQL_CONNECTION_LIMIT`。
- 旧 SQLite `platform.db` 不迁移；MySQL 通过组织真源、流程快照和基线脚本重建。遗留 SQLite 只保留为隔离测试和待删除实现，不作为运行回退路径。
- 流程治理、统一问题池、流程设计和指导意见以 MySQL 身份/RBAC、流程治理读模型和对应治理表为正式口径；问题池详情和写动作必须按 MySQL 角色、部门和权限二次校验。
- 质量问题和映射待办关闭只支持 MySQL 路径；除“说明这条核验项不是问题”且填写原因外，关闭必须同时满足 `source_resolved` 和最新导入批次中对应问题指纹已消失。
- 迁移过渡期仍依赖遗留本地库的测试，必须通过隔离路径运行，不能污染共享运行态文件，也不能写入新的 SQLite 专用能力。
- 数据地图字段域已直接切换到 MySQL：`/api/data-map/contexts`、`/api/field-entries/*`、`/api/field-identities/*`、字段导入、字段导出和黄金源质量进度都通过 Data Map MySQL repository 访问；`context_id` 是公开主键，`mapping_id` 只作为短期兼容别名。
- 术语治理已切换到 MySQL：`/api/terminology` 和 `/api/terminology/types` 通过 `terminologyMysqlRepository` 访问独立 `terminology_*` 表；`/api/terminology/processes` 使用流程治理 MySQL 读模型 `process_mapping_records` 作为流程选择来源，不再读取 SQLite `terms`。
- 旧映射审批已切换到 MySQL：`/api/mappings` 通过 `mappingMysqlRepository` 访问 `mdm_mapping_*` 表，保留旧审批 API 形状；字段台账仍以 Data Map context 为正式归属，映射详情不再读取 SQLite `field_entries`、`field_identities`、`terms`、`change_set` 或 `version_log`。
- 冲突治理和通用待办已切换到 MySQL：`/api/conflicts` 通过 `conflictMysqlRepository` 访问 `mdm_field_conflicts`、`mdm_term_conflicts`、`mdm_conflict_*` 和 `mdm_todos`；字段冲突检测读取 Data Map 字段域，术语冲突检测读取 `terminology_terms`。`/api/todos` 通过 `todoMysqlRepository` 访问 `mdm_todos` 和 `mdm_todo_events`，不再混用 SQLite 写入和 MySQL 读取。
- 平台通用版本和活动热力图已切换到 MySQL：`/api/versions` 通过 `auditMysqlRepository` 访问 `mdm_change_sets` 和 `mdm_version_log`；`/api/activity/heatmap` 从流程治理事件、映射审批历史、版本记录、术语、冲突和通用待办 MySQL 表汇总，不再读取 SQLite `change_set`、`version_log`、`terms`、`term_conflicts`、`field_conflicts` 或 `todos`。
- `MDM_IDENTITY_READ_MODEL=mysql` 目前切换登录、`/api/org/session`、`/api/org/me`、本人密码状态、本人改密、管理员用户/部门/权限读写接口、`/api/roles` 角色读写接口、通用 `requirePermission` 权限中间件、角色工作台身份读取、流程治理 MySQL 分支权限判断、流程设计 MySQL 路由权限判断、治理活跃热力图管理视图权限判断、字段台账查看/创建/维护中的身份权限判断，以及字段黄金源维护/确认中的身份权限判断。`auth.js` / `access.js` 已提供 MySQL-aware 异步权限、角色码、用户和部门读取 helper；后续业务路由接入时应优先复用这些 helper。
- `/api/import-rbac/*` 批量写入仍是遗留本地库实现；在 `MDM_IDENTITY_READ_MODEL=mysql` 下会显式拒绝，直到对应导入写入链路迁到 MySQL。
- 当前前端主入口为统一问题池 `/api/process-governance/issue-pool/*`；旧输入基线问题复核 `/api/process-governance/input-baseline-review/*` 保留为导入、复核和过渡 API。问题识别批次通过 `npm run import:process-input-baseline-review -- --review-run artifacts/process-input-baseline-review/<run-id>` 导入 MySQL。统一问题池短期不新增数据库列，待确认结构化字段先放在 `process_governance_issue_points.evidence_json.document_structure`，包含结构化对象、目标结构块、目标字段、当前值、给用户的问题和允许动作。
- 文档结构化输出位于 `流程治理 -> 文档结构化输出`，稳定地址为 `#/processGovernance?view=documentStructure`，在 `总览` 后、`待确认问题` 前。该页面在 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 下使用 `/api/process-design/*` 的 MySQL 路由完成制度说明（制度编号、制度名称、拟发布版次、当前有效版次、L1 能力域、L2 业务能力、依据类型、目的、范围和与已有制度/流程/表单的关系）、术语、流程与业务行为、跨部门承接、附表结构、证据、Markdown 草案、审核和发布；制度编号全公司唯一，版次由系统按 `A -> B -> ... -> Z -> AA` 自动生成，用户不能手填或跳号。编号输入后会立即校验：不存在时创建 A 版；已存在且本部门可维护时创建下一版次完整重写草稿；已有进行中草稿时打开原草稿。发布下一版次会把上一版标记为已替代，默认流程图谱和 A1 只展示当前有效版次。`/api/process-design/process-taxonomy` 从 MySQL 流程治理读模型 `process_mapping_records` 读取 L1 能力域和 L2 业务能力，并按当前用户本部门过滤。`process_mapping_records` 由 `docs/company-sankey-data.json` 的 `processMappings` 导入，必须先运行 `node scripts/parse-sankey-data.mjs` 生成快照，再运行 `import-process-governance-mysql.js` 刷新 MySQL。前端只允许在制度说明中级联选择本部门既有 L1/L2 组合，后续流程默认沿用；后端也会拒绝临时新增或跨部门套用的 L1/L2。流程编号由后端按 `PROCEDURE-{草稿ID}-{三位序号}` 自动生成，作为 `process_design_processes.process_code` 的唯一业务编号入库，前端只展示不手填，`L3` 只表示流程层级和名称。是否需要审批、是否跨部门和证据类型使用固定选项；字段类型从 `/api/process-design/field-types` 字典读取，默认含文本、长文本、数字、金额、日期、日期时间、枚举、布尔、部门、人员、文件编号、签名、图片、附件和二维码。发布不反向修改 `docs/norms/`。发布卡口以至少 1 条 `process_design_evidence.status='verified'` 为准，`maturity` 只作为前端完成度提示；草稿详情返回 `publishable` 供前端展示是否可发布。
- 文档结构化输出前端按 9 个节点分步呈现：制度说明、流程与行为、术语、跨部门承接、附表结构、字段清单、提交审核、结构化预览、Markdown 草案。保存制度说明前会先校验制度编号、制度名称、L1/L2、依据类型、目的、范围，以及涉及其他部门时的部门枚举选择；部门枚举来自平台部门清单，可多选具体部门，并额外提供“全公司”选项表示包含所有部门。页面每次只显示当前节点，可编辑制度结构草稿支持删除，已提交、审核中或已发布草稿显示不可删除原因。拟发布版次、当前有效版次和发布后处理是系统生成信息，前端用信息块展示，不作为可填写输入框。流程、业务行为和术语支持列表编辑、取消编辑、删除或作废，不把所有录入表单铺在同一页；附表结构保存后会进入“已保存表单”列表，可回填继续修改。附表结构采用“表单 -> 主表/可选明细表 -> 字段”：表单必须关联未作废业务行为；表单编号由后端按 `FM-{制度编号}-{版次}-{三位序号}` 生成；主表始终存在但只维护主表名称和主表字段；明细表需要用户先创建，最多 1 个，可连带删除明细字段；字段编号由后端按 `...-M-001` 或 `...-D-001` 生成，编辑页面不手填；字段清单保存后进入“已保存字段”列表，可回填修改、删除，并可在同一张主表或明细表内上下调整顺序。归档规则拆成归档位置、留存周期、归档责任部门和归档责任角色，位置为“部门自行保存 / 资料室”，周期为“1年 / 3年 / 10年 / 永久”，责任角色来自所选部门花名册任岗。历史版次和进行中草稿分开展示；历史版次根据当前输入的制度编号通过 `/api/process-design/summary?document_no=...` 读取；B/C 等后续版次只带出制度编号、制度名称和拟发布版次，不复制旧版流程、行为、附表和证据。
- `npm run test:mainline` 用于验证“流程治理 -> 字段台账 -> 主数据对象 -> 权限 -> 导入导出”主线，详见 `docs/plans/流程治理字段台账主线稳定性检查.md`。
- 不直接运行会删除共享数据库的旧式测试逻辑。
- `seed-demo-data.js` 和 `setup-mdm-project-users.js` 需要显式环境变量才可运行。

流程治理口径：

- 组织真源为 `docs/organization/组织架构和部门职责.md`。
- 流程输入基线为 `docs/norms/{部门}部门-能力-流程-系统映射关系.md`。
- 快照来源为 `docs/company-sankey-data.json`。
- PMO 静态驾驶舱仍通过 parser 和内嵌快照运行。
- 指导意见默认隐藏；打开待确认问题只聚焦当前治理对象，不自动展开指导意见。只有已有指导意见被主动刷新、创建或响应时，才显示对应区域。
- 统一问题池前端按 `display_status` 做视觉引导：待确认项优先展示；已提交待审核、等待协同/裁决和已完成项用不同状态标签与卡片颜色区分；已提交或已完成不等于关闭，默认不抢占“当前优先”。问题提交后，详情页只展示处理记录和下一步入口，不再让上传者在同页重复提交审核动作。
- 统一问题池详情页的 `在哪发现` 固定展示源文件编号、制度或表单名称、大概位置、业务流程和业务行为；能定位制度或表单源文件锚点时优先显示原文位置。流程输入基线里的条款号必须能在制度或表单源文件中核到才显示为原文条款；条款号对不上但摘录能在源文件中找到时，显示摘录所在原文段落并标明残留问题；不能定位时才回退到流程输入基线并标明残留问题。
- 统一问题池详情页的“结构化字段确认”会把待确认事项映射到 `meta`、`l3_catalog`、`a1_catalog`、`evidence_catalog` 或 `mdm_requirement_catalog` 等文档结构块字段。用户处理的是制度、流程、行为、表单、字段和证据是否能进入正式结构化输出，不需要理解 `selected_option`、`point_status` 等内部状态字段。文档结构化输出的数据模型以 `../../docs/contracts/document-structured-output.schema.json` 为准，说明见 `../../docs/contracts/document-structured-output-schema.md`。
- `npm run test:process-governance-issue-pool` 覆盖统一问题池 MySQL 权限、前端钩子和来源解析；其中来源解析会防止 `GLTX-XM-08-A` 这类制度编号被误挂到 `GLTX-XM-08-A-01` 表单。
