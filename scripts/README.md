# scripts 目录说明

本目录放仓库级自动化脚本：输入通常跨 `docs/`、`pmo/` 或 `apps/mdm-platform/`，输出也可能回写生成快照或校验报告。只服务单个应用的脚本应留在对应应用目录，例如 `apps/mdm-platform/scripts/`。

修改本目录脚本前先读 `AGENTS.md`。涉及命令、输入、输出、副作用、启动规则或验证口径变化时，必须同步更新本 README。

## 当前主线入口

| 脚本 | 作用 | 输入 | 输出 / 副作用 |
|---|---|---|---|
| `parse-sankey-data.mjs` | 从部门流程输入基线生成公司级桑基数据，并注入 PMO 流程驾驶舱；若文件头存在流程治理结构块 v1，则优先读取结构块，并将正文 legacy 中未被覆盖的 L3/A1 合并为 hybrid 解析结果；同时输出 `processMappings` 供 MySQL 导入保留部门内 L1/L2/L3 枚举 | `docs/norms/`、`docs/organization/组织架构和部门职责.md`、跨部门报告 | 写入 `docs/company-sankey-data.json` 和 `pmo/procedure-management/dashboard.html` |
| `check-dashboard-data.mjs` | 校验公司级快照、PMO 内嵌数据、跨部门报告派生统计和报告来源指纹一致 | `docs/company-sankey-data.json`、`pmo/procedure-management/dashboard.html`、`docs/norms/流程治理/跨部门完整性检查报告.md` | 只读校验 |
| `check-dept-domain-mapping.mjs` | 校验 DCM/BBM 规则文件与组织真源一致，并确认 parser 从组织真源读取部门到域映射 | `docs/organization/组织架构和部门职责.md`、`docs/contracts/dcm-bbm-contract.json`、`scripts/parse-sankey-data.mjs` | 只读校验 |
| `check-engineering-source-manifest.mjs` | 校验工程技术部源文件清单中的 canonical 缺口和外部待确认索引仍与仓库现状一致 | `docs/reports/2026-06-11-engineering-source-manifest.md`、外部参考待确认目录 | 只读校验 |
| `check-norms-source-manifest.mjs` | 校验部门流程输入基线清单与规则文件中的部门、`docs/norms`标准三件套一致 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/`、两份 source manifest 报告 | 只读校验 |
| `check-pmo-task-data.mjs` | 校验七份PMO Markdown真源、两份任务JSON和两份source manifest同源，并检查真源摘要、SHA-256短摘要、516条任务的43字段逐行规则、两份README、项目周期和关键排期节点 | 七份PMO真源、两份`tasks.json`、两份PMO source manifest、两份README | 只读校验 |
| `check-pmo-execution-standards.mjs` | 校验 PMO 执行标准真源、WBS 1.2 执行级样板、WBS 3 标准绑定和H5诊断规则 | `pmo/信息化项目_执行标准真源.md`、WBS/计划管控真源、PMO 前端源码 | 只读校验 |
| `check-pmo-standard-gap-operations.mjs` | 校验 PMO 执行标准缺口分桶、优先级队列、建议动作和标准治理 H5 入口 | PMO 任务数据、source manifest、执行标准真源、PMO 前端源码 | 只读校验 |
| `check-pmo-wbs-semantic-depth.mjs` | 校验 PMO WBS 语义补组后不再保留二级叶子任务，并确认父级日期覆盖子任务 | `pmo/tasks.json` | 只读校验 |
| `check-source-manifest-hashes.mjs` | 校验公司级快照里的 sourceManifest 文件大小和 SHA256 仍匹配磁盘源文件 | `docs/company-sankey-data.json`、`sourceManifest.files` 中登记的源文件 | 只读校验 |
| `build-project-governance-report.mjs` | 生成双部门项目治理周报，并输出 PMO 周会页可读取的 JSON 快照 | 输入基线问题待办、DCM/BBM 质量报告、可选角色工作台快照 | 写入 `docs/reports/project-governance-weekly-report.md` 和 `pmo/gantt-react/public/project-governance-weekly-report.json` |
| `test-project-governance-report.mjs` | 校验项目治理周报 Markdown、JSON快照和PMO读取规则 | 周报脚本、PMO 周会页源码、临时角色工作台夹具 | 只读校验，临时输出写入系统临时目录 |
| `sync-process-governance-mainline.mjs` | 串起流程治理主线生成、检查和MDM MySQL快照导入 | 流程输入基线、PMO驾驶舱、`docs/company-sankey-data.json`、显式MySQL环境变量 | 会运行parser并调用`apps/mdm-platform`现有MySQL导入器；不调用SQLite组织同步、导入或检查脚本 |
| `test-process-governance-mainline.mjs` | 聚合仓库级流程治理主线只读校验 | 根级主线检查脚本 | 依次运行合约、项目治理升级、PMO 数据、部门域、source manifest 和 PMO 任务数据校验 |
| `test-process-governance-mainline-contract.mjs` | 仓库级流程治理主线一致性测试 | `package.json`、`docs/company-sankey-data.json`、仓库级脚本 | 只读校验 |
| `test-parse-sankey-structure-block.mjs` | 校验流程治理结构块 v1 的 parser 优先读取、hybrid 合并、系统枚举、证据状态和 A1→L3 引用约束 | 内置临时夹具 | 只读校验 |
| `test-document-structured-output-schema.mjs` | 校验文档结构化输出标准 schema 与前端字段、MySQL process_design 表、制度编号/版次字段、MySQL 路由枚举和结构块 parser 关键约束一致 | `docs/contracts/document-structured-output.schema.json`、MDM 前端、MySQL schema、MySQL 路由、结构块 parser | 只读校验 |
| `build-work-role-data.mjs` | 从行政人事工作角色真源生成结构化输出服务可只读消费的工作角色快照；先完整校验角色引用和花名册“部门 + 岗位”，成功后才原子替换输出 | `docs/organization/工作角色目录与岗位映射.md`、`docs/organization/花名册.md` | 写入 `docs/work-role-data.json`；不修改花名册、流程输入基线、数据库或应用 |
| `test-work-role-contract.mjs` | 校验 v2 可选工作角色关系、L3/A1/confirmed 约束、行政人事空目录、花名册岗位核验、快照形状和失败不覆盖 | 工作角色结构规则、组织真源、花名册、生成快照和临时夹具 | 只读校验；临时夹具写入系统临时目录 |
| `infomat-services.config.json` | MDM、PMO、MySQL固定启动配置 | 固定端口、固定MySQL用户和数据库、固定读模型 | 非敏感配置真源 |
| `infomat-service-config.mjs` | 读取固定启动配置并合成本机运行环境 | `infomat-services.config.json`、本机 `infomat-services.local.env` | 供启动和冒烟脚本复用 |
| `repair-infomat-mysql-container.ps1` | 将本机历史MySQL容器调整为固定启动配置 | 固定配置、本机私有env、Docker容器状态 | 只修复本机Docker运行态，不写仓库真源 |
| `start-infomat-services.ps1` | 固定启动MDM、PMO和项目MySQL | 固定配置、本机私有env、Docker容器`infomat-input-baseline-review-mysql` | 按固定环境启动服务，不修改仓库真源 |
| `smoke-infomat-services.mjs` | 固定配置下检查MDM和PMO是否可用，并核对MDM流程编辑器使用`process-governance-v3` | 固定配置、本机私有env、运行中的服务 | 只读检查，输出会隐藏密码 |
| `test-infomat-services-config.mjs` | 防止启动配置再次漂移 | 固定配置、启动脚本、冒烟脚本、`.gitignore` | 只读校验 |
| `start-structure-pilot.ps1` | 在工作区干净、测试通过和HTTPS配置齐全时启动MDM-AI助手及认证后的DSH入口 | Node.js 24、`apps/structure-assistant/config/pilot.config.json`、本机`structure-pilot.local.env`、公共Host白名单、同一Git提交、已独立运行的3001 | 只启停本机3003/3004及其DSH子进程；检查但不停止、重绑或代管3001；不拉取代码、不写业务真源 |
| `smoke-structure-pilot.mjs` | 登录独立试点并检查版本、模板、结构校验、未预置会话Key、DSH实例、五账号非内容状态和`/structured-tool/` | 本机试点秘密、运行中的HTTPS服务 | 不调用付费模型，不输出密码、API Key、内部端口、运行令牌、工作区或案例名称 |
| `test-structure-pilot-config.mjs` | 防止五账号、会话Key边界、端口、模型和固定启动入口漂移 | 助手固定配置、根`package.json`和试点脚本 | 只读校验 |
| `information-collection.config.json` | 固定信息表收集服务的监听地址、端口、数据库目标和附件限制 | 非敏感固定配置 | 不保存数据库密码、会话密钥或扫描命令 |
| `start-information-collection.ps1` | 校验端口、身份结构和信息收集表后启动 4000/4001 | 固定配置、被 Git 忽略的本机环境文件、现有 MySQL | 启动本机服务；不修改 MDM 身份和治理业务表 |
| `smoke-information-collection.mjs` | 检查两个端口健康状态、登录边界和独立 Cookie 名 | 运行中的 4000/4001 | 只读烟测，不输出凭据 |
| `invoke-information-collection-migration.ps1` | 执行信息表收集 schema 的 dry-run、apply 或 check | 固定配置、本机数据库凭据、现有身份表 | dry-run/check 只读；apply 仅创建或升级 `collection_*` 表 |
| `generate-weekly-action-personnel-snapshot.mjs` | 从信息化项目人员角色映射和花名册生成 3002 只读人员快照 | `docs/organization/信息化项目人员角色映射.md`、`docs/organization/花名册.md` | 默认写 `artifacts/weekly-actions/personnel-snapshot.json`；不修改组织真源、PMO 真源、SQLite 或 MySQL |
| `test-weekly-action-personnel-snapshot.mjs` | 校验 3002 人员快照生成、花名册一致性和待补人员警告 | 组织人员映射、花名册、临时输出目录 | 只读校验，临时输出写入系统临时目录 |

常用命令：

```bash
npm run start:infomat-services
npm run smoke:infomat-services
npm run repair:infomat-mysql
npm run test:infomat-services-config
npm run verify:structure-pilot
npm run verify:dsh-entry
npm run start:structure-pilot
npm run smoke:structure-pilot
npm run migrate:information-collection:dry-run
npm run migrate:information-collection:apply
npm run check:information-collection-schema
npm run test:information-collection
npm run start:information-collection
npm run smoke:information-collection
npm run test:process-governance-mainline
npm run test:dept-domain-mapping
npm run test:engineering-source-manifest
npm run test:norms-source-manifest
npm run test:parse-sankey-structure-block
npm run test:document-structured-output-schema
npm run build:work-role-data
npm run test:work-role-contract
npm run verify:norms-source-mapping
npm run test:pmo-task-data
npm run test:pmo-execution-standards
npm run test:pmo-standard-gap-operations
npm run test:pmo-wbs-semantic-depth
npm run test:source-manifest-hashes
npm run build:pmo-task-data
npm run governance:weekly-report
npm run test:project-governance-upgrade
npm run test:process-evidence-skill
npm run test:process-input-baseline-review
npm run test:ocr-source
npm run generate:weekly-action-personnel -- --generated-by "<name>"
npm run test:weekly-action-personnel
$env:MYSQL_HOST='<host>'; $env:MYSQL_PORT='<port>'; $env:MYSQL_USER='<user>'; $env:MYSQL_PASSWORD='<password>'; $env:MYSQL_DATABASE='<database>'; npm run sync:process-governance
```

`npm run sync:process-governance -- --check-env`只核对五个MySQL环境变量是否存在并输出脱敏状态，不连接数据库、不显示变量值。正式同步会写MySQL流程治理读模型，执行前必须确认目标实例、权限、备份和恢复路径。SQLite兼容脚本只通过`apps/mdm-platform`中以`legacy-sqlite:`开头的命令用于遗留迁移或隔离测试。

`parse-sankey-data.mjs` 支持部门渐进迁移：单个部门文件存在 `meta.parser_schema_version: 1` 且提供 `l3_catalog` 时优先解析结构块；若正文仍有旧 Markdown DCM/A1 表格，则同一 L3/A1 由结构块覆盖，legacy 中未覆盖的剩余项继续进入快照，部门记录为 `source: hybrid` 并输出覆盖 warning。未提供结构块的部门继续走旧 Markdown 表格/标题解析，并在 stderr 打印 `[WARN] {部门} 未提供结构块(schema v1)，回退旧 Markdown 解析，存在漂移风险。`。生成的 `docs/company-sankey-data.json` 保留既有 `nodes`、`links`、`stats`、`processMappings`、`evidenceRefs` 等字段，并新增 `meta.departments[]` 记录各部门 `source: structured|hybrid|legacy`。

## 工作角色快照

行政人事部在 `docs/organization/工作角色目录与岗位映射.md` 维护正式工作角色、岗位映射和原文角色别名。首次启用时三张表为空，不能为了让页面出现选项而自动生成工作角色编码。更新真源或花名册岗位后运行：

```powershell
npm run build:work-role-data
npm run test:work-role-contract
```

快照顶层结构固定为 `schemaVersion=work-role-data-v1`、`generatedAt`、`sourceHash`、`workRoles`、`workRolePositionMappings`、`workRoleAliases`。角色记录保留定义、生效起止和制定依据；岗位映射保留生效起止和确认依据；别名保留确认依据。三类记录的 `status` 都只允许 `draft|active|retired`。生成器只读花名册并精确核对“部门 + 岗位”：不一致行只能保留为 `draft`，`active` / `retired` 会硬失败。它在全部校验通过后才原子替换 `docs/work-role-data.json`，失败时保留旧快照。测试夹具可通过脚本的 `--source`、`--roster`、`--out` 和 `--generated-at` 参数指定，但正式生成使用固定默认路径。

### 流程工作角色绑定输入

流程治理结构块中的 `work_role_bindings` 继续引用同一结构块的 `evidence_catalog`。旧 Markdown 基线若需独立录入，必须在同一个“工作角色绑定”章节内同时提供两张受控表：绑定表固定使用 `binding_ref`、`process_ref`、`step_ref`、`participant_department`、`source_role_text`、`work_role_code`、`participation_type`、`status`、`evidence_refs`、`confirmation_basis`；“工作角色绑定证据”表固定使用 `evidence_ref`、`source_file`、`locator`、`source_excerpt`、`locate_method`、`status`。绑定表的 `evidence_refs` 只能引用同章节证据表，不能借用结构块或其他章节的证据编号。

`confirmed` 关系必须填写原文角色文本、行政人事确认依据和证据引用；证据必须为 `verified`、能定位到源文件具体位置、包含原文摘录，且 `locate_method` 不能包含 OCR。`proposed` 只保留为候选并输出 warning。confirmed 关系若存在悬空证据、待确认/OCR 证据、无效流程或行为引用、无正式工作角色、无参与部门岗位映射、生效期不符或重复 L3 owner，解析器会聚合错误并在写入公司快照前退出非零；有效 retired 角色或岗位映射只作为历史关系保留并输出 warning。

## MDM / PMO 固定启动配置

MDM 和 PMO 的仓库根目录启动入口：

```powershell
npm run start:infomat-services
npm run smoke:infomat-services
```

固定配置在 `scripts/infomat-services.config.json`，当前约定为：

| 项 | 固定值 |
|---|---|
| MDM | `127.0.0.1:3000` |
| PMO | 本机访问 `127.0.0.1:5173`，服务监听 `0.0.0.0:5173` |
| MySQL | `localhost:3307` |
| MySQL Docker 容器 | `infomat-input-baseline-review-mysql` |
| MySQL 用户 / 库 | `mdm_user` / `infomat_mdm` |
| MySQL 连接池 | `MYSQL_CONNECTION_LIMIT=16` |
| 读模型 | `MDM_IDENTITY_READ_MODEL=mysql`、`PROCESS_GOVERNANCE_READ_MODEL=mysql` |
| 管理员工号 | `ADMIN001` |

本机密码写入 `scripts/infomat-services.local.env`，该文件被 `.gitignore` 忽略：

```text
MYSQL_PASSWORD=你的项目 MySQL 密码
MDM_ADMIN_PASSWORD=你的管理员密码
```

`start-infomat-services.ps1` 使用固定配置启动服务，并在启动前刷新3000和5173端口上的MDM、PMO进程。非敏感配置放在 `infomat-services.config.json`，本机密码放在 `infomat-services.local.env`。

如果固定 MySQL 容器不存在，先运行：

```powershell
npm run repair:infomat-mysql
npm run start:infomat-services
npm run smoke:infomat-services
```

修复脚本只对齐本机 Docker 容器和固定端口，不改变资料真源。启动脚本会先完成 MDM MySQL schema 初始化、人员身份 live schema 校验和管理员权限校验，再启动 MDM / PMO。

启动确认项：

| 检查项 | 正确状态 |
|---|---|
| MDM | `http://127.0.0.1:3000` 可访问 |
| PMO | 本机 `http://127.0.0.1:5173` 可访问；同事使用 `http://<本机局域网IP>:5173` |
| MySQL | Docker 容器 `infomat-input-baseline-review-mysql` 通过 `localhost:3307` 提供服务 |
| 权限数据 | `npm run smoke:infomat-services` 显示`ADMIN001`有效账号、`admin`固定角色和当前治理模型版本 |
| 私有密码 | `scripts/infomat-services.local.env` 包含 `MYSQL_PASSWORD` 和 `MDM_ADMIN_PASSWORD` |

3000现有身份库首次切换到固定RBAC/RACI模型前，在`apps/mdm-platform/`执行：

```powershell
npm run migrate:rbac-raci-v2:dry-run
npm run migrate:rbac-raci-v2:apply
```

迁移只自动保留受控`ADMIN001`管理员，其他旧账号停用，旧角色不自动映射。回滚和补偿必须使用迁移返回的批次编号，完整步骤见`apps/mdm-platform/docs/RBAC-RACI-Migration-Runbook.md`。空身份库使用`npm run bootstrap:admin`，检测到已有身份数据后会拒绝重复初始化。

## AI结构化填报试点固定启动

试点固定配置位于`apps/structure-assistant/config/pilot.config.json`。本机登录密码哈希、HTTPS证书路径和会话密钥放在被Git忽略的`scripts/structure-pilot.local.env`。DeepSeek API Key不写入该文件，由5名用户登录后在前端分别输入。

```powershell
npm run verify:structure-pilot
npm run start:structure-pilot
npm run smoke:structure-pilot
```

固定端口：

| 服务 | 监听 |
|---|---|
| 独立3001 | `0.0.0.0:3001`，公司局域网用户直接访问；由3001自身启动入口管理 |
| MDM-AI助手登录与运行控制 | HTTPS `0.0.0.0:3003` |
| 认证后的DSH治理入口 | HTTPS `0.0.0.0:3004`；同时提供`/mdm-api/*`和`/structured-tool/*` |

`start-structure-pilot.ps1`不执行`git pull`。脚本要求Node.js 24和`STRUCTURE_ASSISTANT_PUBLIC_HOSTS`，先拒绝存在未提交修改的工作区，再运行3001结构规则测试、助手测试、固定配置测试和真实DSH兼容门禁。确认独立3001可达后，只重启3003、3004及其受控DSH子进程。该脚本不得停止、重绑或启动3001。局域网用户仍可通过服务器局域网地址直接使用3001。

`smoke-structure-pilot.mjs`需要`STRUCTURE_ASSISTANT_SMOKE_BASE_URL`、烟测账号和密码；使用私有CA时还需`STRUCTURE_ASSISTANT_SMOKE_CA_PATH`。该脚本启动并结束烟测会话的隔离DSH实例，检查受限治理页面和`/structured-tool/`，但不调用模型，也不要求API Key。正式发布后的模型连通性由5名用户在前端分别输入本人Key并使用合成材料验证，执行前必须显式确认实际费用；不得由管理员集中收集Key。

正式环境的`STRUCTURE_ASSISTANT_PUBLIC_HOSTS`必须填写用户实际访问端口3004时使用的`主机名:端口`或`IP:端口`，多个值用英文逗号分隔。DSH固定为`@deepseek-ai/dsh@0.1.0-rc.6`，不得使用`latest`；升级前重新运行兼容门禁并单独审核。

输入基线问题复核正式入口在 MDM 平台：

```bash
cd apps/mdm-platform
npm run init:mysql
npm run import:process-input-baseline-review -- --review-run artifacts/process-input-baseline-review/<run-id>
npm start
```

复核 API 固定为 `/api/process-governance/input-baseline-review/*`，复核决策写入 MDM MySQL `process_input_baseline_review_*` 表。

根目录输入基线问题复核 MySQL 服务只作为迁移过渡工具保留，不作为正式 MDM 入口：

```bash
npm run review:mysql:init
npm run review:mysql:import -- --review-run artifacts/process-input-baseline-review/<run-id>
npm run review:mysql:serve
```

连接参数通过环境变量传入：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。临时服务只读待确认产物并把人工复核结果写入 MySQL，不自动修改正式流程映射。

## 审计与质量脚本

| 脚本 | 作用 | 输入 | 输出 / 副作用 |
|---|---|---|---|
| `check-codex-context.mjs`、`test-codex-context.mjs` | 校验 Codex 根入口、局部入口注册、UTF-8 字节预算、指令链、应用细节泄漏和重复提示 | 根 `AGENTS.md`、`DIRECTORY_OWNERSHIP.md` 注册块和各局部 `AGENTS.md`；夹具测试使用系统临时目录 | `npm run test:codex-context` 只输出检查结果；不写仓库文件、不连接数据库、不启动服务 |
| `check-dcm-bbm.mjs` | 校验DCM/BBM规则、部门映射、跨部门证据和驾驶舱数据；已识别流程治理结构块v1的L3/A1计数 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/`、PMO驾驶舱 | 默认写 `docs/reports/dcm-bbm-quality-report.md`；`--report=...` 可覆盖，`--no-fail` 可用于主线容错 |
| `verify-norms-source-mapping.mjs` | 只读盘点 `docs/norms` 源文件和部门映射表，核验 DCM/BBM 证据字段能否回到源文件编号、制度或表单名称、条款/表格/摘录位置 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/` | 写 `docs/reports/{日期}-norms-source-mapping-verification.md` 和 `artifacts/norms-source-mapping-verify/<run-id>/`，不写数据库，不修改映射基线 |
| `audit-a1-transfer-evidence.mjs` | 审计 A1 跨部门输入 / 输出证据 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/` | 默认写 `docs/reports/{日期}-a1-transfer-evidence-audit.md`；`--no-write` 可只读运行 |
| `ocr-source.mjs` | 对扫描 PDF 和图片源文件生成 OCR 待确认证据中间件；PaddleOCR 不可用时登记待复核 | `docs/norms/` 或指定文件/目录下的 PDF/图片 | 默认写 `artifacts/ocr/<run-id>/`；可显式写 `build/ocr/`，但不生成流程结论 |
| `test-ocr-source.mjs` | 校验 OCR 包装脚本的输出边界、复核登记和非结论化规则 | 一个扫描 PDF 样例 | 写入被忽略的 `artifacts/ocr/test-ocr-source/` |
| `.agents/skills/process-evidence-mapping/scripts/run-process-input-baseline-review-workflow.mjs` | 串联 OCR 判断、evidence chunks、embedding/降级、输入基线解读、角色抽取、对象链、差异报告和待确认待办 Markdown | 单个制度文件、部门名、当前部门映射 | 写入 `artifacts/process-input-baseline-review/<run-id>/`；更新 `docs/norms/流程治理/输入基线问题待办.md` |
| `.agents/skills/process-evidence-mapping/scripts/update-input-baseline-review-todo-md.mjs` | 将未解决待确认问题写入人工待办面板，按稳定键去重，并过滤当前已确认流程映射已覆盖项 | `mapping_diff_items.json`、当前部门映射 | 写入待确认待办 Markdown；只保留未解决项 |
| `build-input-baseline-review-sankey-preview.mjs` | 为问题识别批次生成部门待确认预览页 | `artifacts/process-input-baseline-review/<run-id>/mapping_diff_items.json` | 默认写入同一问题识别批次目录的 `preview.html`；只有显式 `--out` 才会写指定路径 |
| `test-input-baseline-review-sankey-preview.mjs`、`test-sankey-preview-status.mjs` | 校验预览页生成和旧状态标记脚本的安全边界 | 预览生成器、兼容入口和临时夹具 | 只读校验；夹具写入系统临时目录 |
| `mark-sankey-preview-status.mjs` | 旧批量预览标记脚本的安全兼容入口 | 无 | 不再批量修改正式部门桑基图，只输出 deprecated/no-op 提示 |
| `rebuild-department-sankey-page.mjs` | 从部门已确认流程映射 Markdown 重建单个部门桑基图 HTML | `docs/norms/{部门}部门-能力-流程-系统映射关系.md` | 写 `docs/norms/{部门}部门能力流程系统桑基图.html`，不读取待确认产物 |
| `init-input-baseline-review-mysql.mjs` | 初始化输入基线问题复核 MySQL 表结构 | MySQL 连接环境变量 | 写入 MySQL schema，不写仓库真源 |
| `import-input-baseline-review-mysql.mjs` | 将问题识别批次产物、原文摘录导入 MySQL | `artifacts/process-input-baseline-review/<run-id>/` | 写入 MySQL 待确认问题库和原文摘录 |
| `input-baseline-review-service.mjs` | 启动输入基线问题复核网页服务 | MySQL 待确认问题库 | 页面从接口读取题目和原文高亮，选择结果直接写 MySQL |
| `input-baseline-review-core.mjs` | 输入基线问题复核 MySQL schema、原文匹配、高亮和仓库方法 | 待确认 JSON、`chunks.jsonl`、MySQL pool | 供导入脚本、服务和测试复用 |
| `test-process-evidence-skill.mjs` | 校验 process-evidence-mapping 技能是否按固定执行顺序重写，且包含 OCR、embedding、待确认待办边界 | `.agents/skills/process-evidence-mapping/SKILL.md` | 只读校验 |
| `.agents/skills/process-evidence-mapping/scripts/test-input-baseline-review-workflow.mjs` | 用 GLTX-CW-01 回归输入基线解读、角色簿、对象链、差异报告和待确认待办 Markdown | 财务部 GLTX-CW-01 制度和当前财务部映射 | 写入被忽略的 `artifacts/process-input-baseline-review/test-gltx-cw-01/` |
| `.agents/skills/database-to-process-json/scripts/run-database-to-process-json.mjs` | 从指定的 CXSYSYS.dbo 结构快照生成一个未审核 V7 JSON 和逐项证据包；主交付 JSON 使用“审核状态-部门-流程-核对阶段-日期”的业务名称；实际办理行为后另设判断节点，条件分叉只能从判断节点发出；多工作流或隐藏判断存在时停止，不接受 SQL | 明确主表或表单模板、`database-process-evidence-v1`快照、可选旧版3001 JSON | 只写新的 `artifacts/database-process-json/<run-id>/`，不连接数据库、不写数据库；`npm run test:database-to-process-json`验证 |
| `.agents/skills/database-to-process-json/scripts/export-cxsysys-readonly-snapshot.ps1` | 在明确授权后，用专用只读账号对快照允许的表和字段做限列、限行、无原值摘要核验 | 结构快照、主表、工作流、进程级只读连接环境变量和`-ConfirmReadOnly` | 只写指定的本地核验JSON；权限门发现写权限即停止，不执行数据库写操作 |
| `test-input-baseline-review-mysql.mjs` | 校验MySQL表结构、原文高亮、对比色按钮和服务页面约定 | 测试问题识别批次夹具 | 写入被忽略的 `artifacts/process-input-baseline-review/test-input-baseline-review-mysql/` |
| `glossary.mjs` | 查询仓库术语表 | `docs/glossary.md` | 只读查询 |

## 局部或历史工具

| 脚本 | 作用 | 当前注意事项 |
|---|---|---|
| `analyze-layout.js` | 快速计算旧布局样例的行数、画布高度和列起始位置 | 只读输出，可通过 `npm run analyze:layout` 运行；不属于流程治理主线 |
| `build-feedback-sankey.mjs` | 给单个部门桑基图 HTML 注入反馈交互 | 会直接改 `docs/norms/{部门}部门能力流程系统桑基图.html`，运行前先确认目标部门页面仍作为当前资产维护 |
| `generate_digital_project_gantt_8k.py` | 从 Markdown 渲染 8K 甘特图 PNG，可用 `--source`、`--output`、`--font` 或 `GANTT_FONT_PATHS` 指定输入输出和字体 | 偏 PMO 渲染工具，默认写入 `output/` |
| `render_gantt_h5_png.mjs` | 用 Chrome DevTools 把 H5 甘特图渲染成 PNG，可用 `--input`、`--output`、`--chrome` 或 `CHROME_PATH` 指定路径 | 偏 PMO 渲染工具，默认写入 `output/` 和临时 Chrome profile |
| `merge_norms.py` | 合并 norms-formatter 产物，可用 `--src` 和 `--out` 指定目录 | 默认读取 `docs/norms/` 并写入 `docs/norms/merged/` |
| `gen_wbs_report.js`、`gen_wbs_report.py` | 生成历史WBS优化调整报告；都支持`--output <path>` | 未传`--output`时写入被忽略的`artifacts/pmo/wbs/`；不得恢复本机绝对路径，不自动覆盖根目录历史DOCX |
| `audit-customer-file-acceptance.mjs`、`test-customer-file-acceptance-audit.mjs`、`test-customer-file-boundary.mjs`、`test-customer-file-sankey-labels.mjs` | 客供文件接收边界、标签和审计专项工具 | 按脚本显式输入工作；不作为流程治理主线真源 |
| `convert-u8softhelp-chm-to-md.mjs` | 将U8帮助CHM转换为Markdown参考材料 | 专项转换工具；运行前确认输入、输出和版权边界 |
| `harden-a1-cross-transfer-fields.mjs`、`normalize-norms-sankey-h5.mjs` | A1跨部门字段和部门桑基H5专项整改工具 | 写入必须使用脚本声明的显式开关；运行前确认目标文件并先执行只读检查 |
| `source-boundary-rules.mjs` | 为源文件边界检查提供共享规则 | 内部模块，不作为独立业务命令 |

## 修改规则

- 新增或修改仓库级脚本时，遵守 `scripts/AGENTS.md`，并在脚本头部或本 README 写清用法、输入、输出、是否写文件、是否写数据库和验证命令。
- 修改 `parse-sankey-data.mjs` 后，至少运行 `node scripts/check-dashboard-data.mjs` 和 `npm run test:process-governance-mainline`。
- 修改会触碰 MDM 导入链路的脚本后，同步运行 `apps/mdm-platform` 下的流程治理相关测试。
- 不在本目录新增一次性输出、截图、数据库、日志或缓存；这些应放入本地临时目录或按边界文件先写迁移提案。
