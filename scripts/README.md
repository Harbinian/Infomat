# scripts 目录说明

## V8 候选兼容说明（2026-09-22）

共享纯校验模块 `process-governance/v7-validator.js` 同时导出 V7 与 V8 入口，由 3001 和 3000 按文件版本分派。V8 仅放行 decision + use，V7 历史语义不变。模块不写文件、不连接数据库。验证命令：`node apps/structured-output-service/scripts/test-v8-decision-data.js`；3000 接收隔离回归见其 README 的 V8 章节。

本目录放仓库级自动化脚本。当前治理依据来自用户指定的外部原始材料、业务说明与明确确认；通过 3001 编制、用户下载并手动上传 3000，治理审核后再形成正式版本。`docs/` 输入只属于历史展示、兼容合同、技术说明或副本，不能决定现行业务事实、人员任命、职责或审批链。表中旧消费链不属于当前治理操作；其生成/同步要求显式兼容用途和目标路径。只服务单个应用的脚本应留在对应应用目录，例如 `apps/mdm-platform/scripts/`。

修改本目录脚本前先读 `AGENTS.md`。涉及命令、输入、输出、副作用、启动规则或验证口径变化时，必须同步更新本 README。

## 脚本入口与兼容用途

| 脚本 | 作用 | 输入 | 输出 / 副作用 |
|---|---|---|---|
| `parse-sankey-data.mjs` | 历史展示/兼容解析；保留结构块 v1、hybrid 合并、证据及 `processMappings` 形状，不恢复旧副本的治理权威 | `--legacy-display --domain-map <json> --out <json>`；域输入须有非空 `departments` 对象；默认读取旧 `docs/norms/`，隔离输入可用 `--norms`、`--cross-report`、`--chain-report`、`--work-roles` | 仅写显式 `--out`；只有显式 `--dashboard <html>` 才注入该文件；写入前校验标签唯一性并拒绝覆盖所选输入 |
| `check-dashboard-data.mjs` | 校验保留历史快照形状、风险枚举、内嵌副本一致及页面消费结构 | `docs/company-sankey-data.json`、`pmo/procedure-management/dashboard.html`；`--legacy-source-comparison` 才比对旧来源正文和指纹 | 只读；结果不证明当前业务或正式实例状态 |
| `check-dept-domain-mapping.mjs` | 校验显式历史部门域 JSON，不解析组织 Markdown 首代码块，不推定现行组织事实 | 可指定 `--domain-map <json>`、`--snapshot <json>`；无参时只比对保留的技术合同 map 与历史快照 | 只读；部门/域须显式完整，缺少或无效时失败 |
| `check-engineering-source-manifest.mjs` | 比对保留工程技术部来源清单、canonical 缺口与外部待确认索引 | 历史 source manifest、外部参考待确认目录 | 只读历史兼容核验，不形成当前来源资格 |
| `check-norms-source-manifest.mjs` | 比对旧 DCM/BBM 合同与 `docs/norms/` 三件套及历史清单 | `docs/contracts/dcm-bbm-contract.json`、旧副本和报告 | 只读历史兼容核验，不证明现行治理基础 |
| `check-pmo-task-data.mjs` | 校验七份PMO Markdown真源、两份任务JSON和两份source manifest同源，并检查真源摘要、SHA-256短摘要、516条任务的43字段逐行规则、两份README、项目周期和关键排期节点 | 七份PMO真源、两份`tasks.json`、两份PMO source manifest、两份README | 只读校验 |
| `check-pmo-execution-standards.mjs` | 校验 PMO 执行标准真源、WBS 1.2 执行级样板、WBS 3 标准绑定和H5诊断规则 | `pmo/信息化项目_执行标准真源.md`、WBS/计划管控真源、PMO 前端源码 | 只读校验 |
| `check-pmo-standard-gap-operations.mjs` | 校验 PMO 执行标准缺口分桶、优先级队列、建议动作和标准治理 H5 入口 | PMO 任务数据、source manifest、执行标准真源、PMO 前端源码 | 只读校验 |
| `check-pmo-wbs-semantic-depth.mjs` | 校验 PMO WBS 语义补组后不再保留二级叶子任务，并确认父级日期覆盖子任务 | `pmo/tasks.json` | 只读校验 |
| `check-source-manifest-hashes.mjs` | 比对保留快照 `sourceManifest.files` 与历史输入副本大小及 SHA-256 | `docs/company-sankey-data.json`、登记路径 | 只读；副本变化可使旧指纹失败，不应生成新快照掩盖 |
| `build-project-governance-report.mjs` | 生成保留的双部门历史样板周报，不把旧待办、人员或角色工作台升为当前治理事实 | `--legacy-display`；旧输入基线待办、质量报告、可选角色工作台快照 | 仅写显式 `--out <md>` 和 `--json-out <json>`，不默认覆盖 PMO 公共快照 |
| `test-project-governance-report.mjs` | 校验项目治理周报 Markdown、JSON快照和PMO读取规则 | 周报脚本、PMO 周会页源码、临时角色工作台夹具 | 只读校验，临时输出写入系统临时目录 |
| `sync-process-governance-mainline.mjs` | 旧展示读模型兼容导入；不再自动解析 `docs/`、刷新驾驶舱或运行质量报告 | `--legacy-display --snapshot <json>`；应用写入另需 `--apply` 及五项显式 MySQL 环境配置 | 默认只读验证并输出计划；`--apply` 调用既有 MySQL 导入器，需目标、权限、备份和恢复授权；不使用 SQLite |
| `test-process-governance-mainline.mjs` | 聚合现行命令边界、v2 证据、V7/V8 办理与退役保护、PMO 及保留消费结构回归 | 根/应用技术合同、合成夹具及保留快照 | 创建独立夹具、隔离数据库及临时 HTTP，不连接正式数据库；`--legacy-source-comparison` 另行比较历史副本 |
| `test-process-governance-mainline-contract.mjs` | 校验当前命令注册与保留历史快照的消费形状、来源元数据和引用结构 | `package.json`、保留快照及仓库脚本 | 只读结构检查，不证明快照为现行治理依据 |
| `test-root-script-safety.mjs` | 验证旧输入执行门槛、只读规划、精确导入参数、目录归属、共享成果保留、失败不覆盖与统一包日期 | 合成 map/norms/roles/report、fake 导入器、新 profile 和伪文件存在夹具 | 新夹具写 `artifacts/repo-audit/{Asia-Shanghai日期}/root-script-safety-<随机值>/`，共享目录保留哨兵/审计批次写 `artifacts/customer-file-acceptance/`；不运行真实导入器或现有浏览器 |
| `test-parse-sankey-structure-block.mjs` | 校验流程治理结构块 v1 的 parser 优先读取、hybrid 合并、系统枚举、证据状态和 A1→L3 引用约束 | 内置临时夹具 | 只读校验 |
| `test-document-structured-output-schema.mjs` | 校验 v2 证据草稿/历史转换技术合同、保留表注释、枚举、待确认字段与结构块 parser | v2 Schema、历史 MySQL 表定义、parser；现行 3000 行为由应用隔离测试另行验证 | 只读，不要求恢复已退役 UI/路由，也不赋予 v2 当前办理资格 |
| `build-work-role-data.mjs` | 按显式选定的历史角色/花名册兼容格式生成快照；完整校验角色及“部门 + 岗位”后才原子替换输出 | `--legacy-display --source <md> --roster <md> --out <json>`，可选 `--generated-at` | 只写显式输出；CLI 无默认覆写，不修改输入或数据库，不证明当前 HR 任命 |
| `test-work-role-contract.mjs` | 校验 v2 可选角色关系、历史空目录与快照形状，隔离验证岗位核验、反例和失败不覆盖 | 技术合同、保留副本/快照及合成夹具；`--legacy-source-comparison` 才逐字比对副本 sourceHash | 夹具写系统临时目录，不覆写保留快照，不证明当前岗位和责任 |
| `infomat-services.config.json` | MDM、PMO、MySQL固定启动配置 | 固定端口、固定MySQL用户和数据库、固定读模型 | 非敏感配置真源 |
| `infomat-service-config.mjs` | 读取固定启动配置并合成本机运行环境 | `infomat-services.config.json`、本机 `infomat-services.local.env` | 供启动和冒烟脚本复用 |
| `repair-infomat-mysql-container.ps1` | 将本机历史MySQL容器调整为固定启动配置 | 固定配置、本机私有env、Docker容器状态 | 只修复本机Docker运行态，不写仓库真源 |
| `start-infomat-services.ps1` | 固定启动MDM、PMO和项目MySQL | 固定配置、本机私有env、Docker容器`infomat-input-baseline-review-mysql` | 按固定环境启动服务，不修改仓库真源 |
| `smoke-infomat-services.mjs` | 固定配置下检查MDM和PMO是否可用，并核对V7预览及旧编制入口不再注册 | 固定配置、本机私有env、运行中的服务 | 只读检查，输出会隐藏密码 |
| `test-infomat-services-config.mjs` | 防止启动配置再次漂移 | 固定配置、启动脚本、冒烟脚本、`.gitignore` | 只读校验 |
| `information-collection.config.json` | 固定信息表收集服务的监听地址、端口、数据库目标和附件限制 | 非敏感固定配置 | 不保存数据库密码、会话密钥或扫描命令 |
| `start-information-collection.ps1` | 校验端口、身份结构和信息收集表后启动 4000/4001 | 固定配置、被 Git 忽略的本机环境文件、现有 MySQL | 启动本机服务；不修改 MDM 身份和治理业务表 |
| `smoke-information-collection.mjs` | 检查两个端口健康状态、登录边界和独立 Cookie 名 | 运行中的 4000/4001 | 只读烟测，不输出凭据 |
| `invoke-information-collection-migration.ps1` | 执行信息表收集 schema 的 dry-run、apply 或 check | 固定配置、本机数据库凭据、现有身份表 | dry-run/check 只读；apply 仅创建或升级 `collection_*` 表 |

常用命令：

根目录 `npm test` 调用 `test:process-governance-mainline`，验证当前技术入口和隔离行为；它会创建独立夹具/隔离数据库/临时 HTTP，不证明正式实例已开启或业务验收。历史正文和指纹比较需另加 `--legacy-source-comparison`。

```bash
npm run start:infomat-services
npm run smoke:infomat-services
npm run repair:infomat-mysql
npm run test:infomat-services-config
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
npm run test:root-script-safety
npm run test:work-role-contract
npm run verify:norms-source-mapping
npm run test:pmo-task-data
npm run test:pmo-execution-standards
npm run test:pmo-standard-gap-operations
npm run test:pmo-wbs-semantic-depth
npm run test:source-manifest-hashes
npm run build:pmo-task-data
npm run test:project-governance-upgrade
npm run test:process-evidence-skill
npm run test:process-input-baseline-review
npm run test:ocr-source
npm run sync:process-governance -- --check-env
```

`npm run sync:process-governance -- --check-env` 只输出五项 MySQL 配置的脱敏布尔状态，不读取快照、不连接数据库。缺失配置返回非零。旧展示读模型的兼容维护必须显式选定快照；仅规划时不需要数据库配置，也不会启动导入器：

```powershell
npm run sync:process-governance -- --legacy-display --snapshot artifacts/legacy-display/company-sankey-data.json
```

明确获得目标、权限、备份与恢复授权后，才在上述命令增加 `--apply`，并在进程环境配置 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。这只是历史展示读模型兼容导入，不替代 3001/3000 当前办理。SQLite 历史工具只使用应用中明确的 `legacy-sqlite:` 名称和独立库；已撤销的四个初始化/同步/导入/检查命令不再恢复。

历史副本变化可使 `npm run test:process-governance-mainline -- --legacy-source-comparison` 失败。该模式用于检查有明确兼容任务的旧消费链；失败需审查版本与输入选择，不应为了得到绿灯重生成保留快照。默认聚合仍检查内嵌数据、消费结构与当前技术行为。

`parse-sankey-data.mjs` 支持部门渐进迁移：单个部门文件存在 `meta.parser_schema_version: 1` 且提供 `l3_catalog` 时优先解析结构块；若正文仍有旧 Markdown DCM/A1 表格，则同一 L3/A1 由结构块覆盖，legacy 中未覆盖的剩余项继续进入快照，部门记录为 `source: hybrid` 并输出覆盖 warning。未提供结构块的部门继续走旧 Markdown 表格/标题解析，并在 stderr 打印 `[WARN] {部门} 未提供结构块(schema v1)，回退旧 Markdown 解析，存在漂移风险。`。生成的 `docs/company-sankey-data.json` 保留既有 `nodes`、`links`、`stats`、`processMappings`、`evidenceRefs` 等字段，并新增 `meta.departments[]` 记录各部门 `source: structured|hybrid|legacy`。

## 历史工作角色快照兼容

`docs/organization/` 的工作角色、岗位与花名册均是历史副本；生成器不根据它们确定当前任命或责任。保留空目录、历史编码与原文角色别名，不为让页面出现选项生成角色。

在明确维护旧展示兼容时，显式选择输入和新输出：

```powershell
npm run build:work-role-data -- --legacy-display `
  --source docs/organization/工作角色目录与岗位映射.md `
  --roster docs/organization/花名册.md `
  --out artifacts/legacy-display/work-role-data.json
npm run test:work-role-contract
```

兼容快照仍保留 `schemaVersion=work-role-data-v1`、`generatedAt`、`sourceHash`、`workRoles`、`workRolePositionMappings`、`workRoleAliases`。三类记录只允许 `draft|active|retired`。生成器精确核对所选副本中的“部门 + 岗位”；不一致只能保留 `draft`，`active`/`retired` 失败。全部检查通过后才原子替换显式输出，失败保留该输出旧内容。程序调用 API 为历史消费者保留；当前治理仍需外部材料、业务说明与有权确认。

### 流程工作角色绑定输入

流程治理结构块中的 `work_role_bindings` 继续引用同一结构块的 `evidence_catalog`。旧 Markdown 基线若需独立录入，必须在同一个“工作角色绑定”章节内同时提供两张受控表：绑定表固定使用 `binding_ref`、`process_ref`、`step_ref`、`participant_department`、`source_role_text`、`work_role_code`、`participation_type`、`status`、`evidence_refs`、`confirmation_basis`；“工作角色绑定证据”表固定使用 `evidence_ref`、`source_file`、`locator`、`source_excerpt`、`locate_method`、`status`。绑定表的 `evidence_refs` 只能引用同章节证据表，不能借用结构块或其他章节的证据编号。

`confirmed` 关系必须填写原文角色文本、行政人事确认依据和证据引用；证据必须为 `verified`、能定位到源文件具体位置、包含原文摘录，且 `locate_method` 不能包含 OCR。`proposed` 只保留为候选并输出 warning。confirmed 关系若存在悬空证据、待确认/OCR 证据、无效流程或行为引用、无正式工作角色、无参与部门岗位映射、生效期不符或重复 L3 owner，解析器会聚合错误并在写入公司快照前退出非零；有效 retired 角色或岗位映射只作为历史关系保留并输出 warning。

## MDM / PMO 固定启动配置

仅操作3000时，改从`apps/mdm-platform`运行`npm run service:start`、`npm run service:stop`、`npm run service:restart`或`npm run service:check`。应用专用脚本复用本目录`infomat-services.config.json`中的MDM/MySQL/readModels非敏感值，不读取私有env、不初始化数据库、不操作PMO或3001。会话、HTTPS、就绪和恢复条件见[3000发布与恢复](../docs/plans/2026-09-09-mdm-3000-launch/03-发布与恢复.md)。下面的共同开发入口保持原有副作用，不作为3000独立发布命令。

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
| MySQL 用户 / 库 | `sa` / `infomat_mdm`（`sa` 为全局管理账号，具有授权权限） |
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

输入基线问题复核的历史技术入口留在 MDM 平台；是否在目标实例注册并启用须核对实时路由与权限，不能据此认定已开启：

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
| `check-dcm-bbm.mjs` | 校验DCM/BBM规则、部门映射、跨部门证据和驾驶舱数据；已识别流程治理结构块v1的L3/A1计数 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/`、PMO驾驶舱 | 默认写 `docs/reports/dcm-bbm-quality-report.md`；`--report=...` 可覆盖，`--no-fail` 仅用于历史问题汇总，不是当前治理门禁通过 |
| `verify-norms-source-mapping.mjs` | 只读盘点 `docs/norms` 源文件和部门映射表，核验 DCM/BBM 证据字段能否回到源文件编号、制度或表单名称、条款/表格/摘录位置 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/` | 写 `docs/reports/{日期}-norms-source-mapping-verification.md` 和 `artifacts/norms-source-mapping-verify/<run-id>/`，不写数据库，不修改映射基线 |
| `audit-a1-transfer-evidence.mjs` | 审计 A1 跨部门输入 / 输出证据 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/` | 默认写 `docs/reports/{日期}-a1-transfer-evidence-audit.md`；`--no-write` 可只读运行 |
| `ocr-source.mjs` | 对扫描 PDF 和图片源文件生成 OCR 待确认证据中间件；PaddleOCR 不可用时登记待复核 | `docs/norms/` 或指定文件/目录下的 PDF/图片 | 默认写 `artifacts/ocr/<run-id>/`；可显式写 `build/ocr/`，但不生成流程结论 |
| `test-ocr-source.mjs` | 校验 OCR 包装脚本的输出边界、复核登记和非结论化规则 | 一个扫描 PDF 样例 | 每次写新的被忽略目录 `artifacts/ocr/test-ocr-source-<随机值>/`，不清理旧批次 |
| `.agents/skills/process-evidence-mapping/scripts/run-process-input-baseline-review-workflow.mjs` | 串联来源覆盖检查、证据切块、可选向量检索及降级、候选抽取、v2 编译、引用校验和问题视图；可读部分继续，未读取来源和未复核视觉转录进入草稿问题及 `source_coverage.json`，无可用内容时非零退出；退出码为 0 不表示完整通过 | 用户指定资料或目录、部门名、比较用映射；可选 `--visual-transcripts <json>` 复用 OCR 的 source/blocks 记录或 `process-visual-transcripts-v1`，核对原文件 SHA-256、路径及页码/块定位，不调用识别引擎；旧纯文本参数兼容 | 只写 `artifacts/process-input-baseline-review/<run-id>/`，不写回 `docs/norms/`，视觉转录保持待复核 |
| `.agents/skills/process-evidence-mapping/scripts/update-input-baseline-review-todo-md.mjs` | 从 v2 生成未解决问题视图；只有“不是问题”且有理由时移除，同名匹配或派生 Markdown 状态不能关闭问题 | v2 JSON；兼容旧问题数组，保留 `--mapping` 命令参数但不据此关闭问题 | 写指定的人工待办 Markdown，不修改输入 JSON |
| `build-input-baseline-review-sankey-preview.mjs` | 为问题识别批次生成部门待确认预览页 | `artifacts/process-input-baseline-review/<run-id>/mapping_diff_items.json` | 默认写入同一问题识别批次目录的 `preview.html`；只有显式 `--out` 才会写指定路径 |
| `test-input-baseline-review-sankey-preview.mjs`、`test-sankey-preview-status.mjs` | 校验预览页生成和旧状态标记脚本的安全边界 | 预览生成器、兼容入口和临时夹具 | 只读校验；夹具写入系统临时目录 |
| `mark-sankey-preview-status.mjs` | 旧批量预览标记脚本的安全兼容入口 | 无 | 不再批量修改正式部门桑基图，只输出 deprecated/no-op 提示 |
| `rebuild-department-sankey-page.mjs` | 从部门已确认流程映射 Markdown 重建单个部门桑基图 HTML | `docs/norms/{部门}部门-能力-流程-系统映射关系.md` | 写 `docs/norms/{部门}部门能力流程系统桑基图.html`，不读取待确认产物 |
| `init-input-baseline-review-mysql.mjs` | 初始化输入基线问题复核 MySQL 表结构 | MySQL 连接环境变量 | 写入 MySQL schema，不写仓库真源 |
| `import-input-baseline-review-mysql.mjs` | 将问题识别批次产物、原文摘录导入 MySQL | `artifacts/process-input-baseline-review/<run-id>/` | 写入 MySQL 待确认问题库和原文摘录 |
| `input-baseline-review-service.mjs` | 启动输入基线问题复核网页服务 | MySQL 待确认问题库 | 页面从接口读取题目和原文高亮，选择结果直接写 MySQL |
| `input-baseline-review-core.mjs` | 输入基线问题复核 MySQL schema、原文匹配、高亮和仓库方法 | 待确认 JSON、`chunks.jsonl`、MySQL pool | 供导入脚本、服务和测试复用 |
| `test-process-evidence-skill.mjs` | 检查技能名称、参考链接和现有合同枚举；不以关键词禁令、固定标题或固定措辞证明行为正确 | `.agents/skills/process-evidence-mapping/SKILL.md`、引用文件及技术合同 | 只读静态检查，来源覆盖与证据边界由隔离工作流验证 |
| `.agents/skills/process-evidence-mapping/scripts/test-input-baseline-review-workflow.mjs` | 用合成制度回归 v2 生成、错误引用拦截、问题关闭规则、混合来源部分草稿和全不可读停止；验证视觉记录路径/摘要/定位拒绝、低高置信度均待复核、现有 OCR 枚举兼容及编译器不得省略视觉来源清单 | 合成制度、图片、OCR记录和 JSON 反例；不连接向量服务或运行识别引擎 | 每次写新的 `artifacts/process-input-baseline-review/test-v2-<随机值>/`，不清理旧批次，不表示真实视觉识别或业务验收 |
| `.agents/skills/database-to-process-json/scripts/run-database-to-process-json.mjs` | 从指定的 CXSYSYS.dbo 结构快照生成一个未审核 V7 JSON 和逐项证据包；按业务名称交付，判断分叉从独立判断节点发出；旧稿人工内容保留，未匹配结构或冲突关系明确阻断；字段证据保留真实物理列名，只读摘要不升级为流程核验结论 | 明确主表或表单模板、`database-process-evidence-v1`快照、可选旧版3001 JSON及绑定快照的只读核验文件 | 只写新的 `artifacts/database-process-json/<run-id>/`，不连接数据库、不写数据库；`npm run test:database-to-process-json`覆盖人工内容保留、冲突阻断、物理列名及核验文件反例 |
| `.agents/skills/database-to-process-json/scripts/export-cxsysys-readonly-snapshot.ps1` | 在明确授权后，用专用只读账号对快照允许的表和字段做限列、限行、无原值摘要核验 | 结构快照、主表、工作流、进程级只读连接环境变量和`-ConfirmReadOnly` | 只写指定的本地核验JSON，记录快照文件SHA-256、核验时间、权限摘要及逐列计数；旧核验文件缺少必填信息时须重新导出，不执行数据库写操作 |
| `test-input-baseline-review-mysql.mjs` | 校验MySQL表结构、原文高亮、对比色按钮和服务页面约定 | 测试问题识别批次夹具 | 每次写新的被忽略目录 `artifacts/process-input-baseline-review/test-input-baseline-review-mysql-<随机值>/`，不连接真实 MySQL，不清理旧批次 |
| `glossary.mjs` | 查询仓库术语表 | `docs/glossary.md` | 只读查询 |

## 局部或历史工具

| 脚本 | 作用 | 当前注意事项 |
|---|---|---|
| `analyze-layout.js` | 快速计算旧布局样例的行数、画布高度和列起始位置 | 只读输出，可通过 `npm run analyze:layout` 运行；不属于流程治理主线 |
| `build-feedback-sankey.mjs` | 给单个历史部门桑基图 HTML 注入反馈交互 | 会直接改 `docs/norms/{部门}部门能力流程系统桑基图.html`，仅在明确维护该历史展示页面时运行 |
| `generate_digital_project_gantt_8k.py` | 固定 2026 年旧图表的 8K 图片导出，必须提供现存 `--source <md>`；可用 `--output`、`--font` 或 `GANTT_FONT_PATHS` | 历史渲染工具；默认输出被忽略的 `artifacts/pmo/gantt8k/`，不是当前 PMO 生成链 |
| `render_gantt_h5_png.mjs` | 历史 H5 图片导出，必须提供现存 `--input <html>`；支持 `--output`、`--chrome`、`--port` | 默认输出 `artifacts/pmo/gantt8k/`；`--profile-dir` 指定新 profile 的父目录，仅清理本次创建的独立子目录；既有目录保留 |
| `merge_norms.py` | 合并 norms-formatter 产物，可用 `--src` 和 `--out` 指定目录 | 默认读取 `docs/norms/` 并写入 `docs/norms/merged/` |
| `gen_wbs_report.js`、`gen_wbs_report.py` | 生成历史WBS优化调整报告；都支持`--output <path>` | 未传`--output`时写入被忽略的`artifacts/pmo/wbs/`；不得恢复本机绝对路径，不自动覆盖根目录历史DOCX |
| `audit-customer-file-acceptance.mjs`、`test-customer-file-acceptance-audit.mjs`、`test-customer-file-boundary.mjs`、`test-customer-file-sankey-labels.mjs` | 历史客供文件边界、标签和审计兼容工具 | 审计测试每次写新的 `artifacts/customer-file-acceptance/test-<随机值>/`，不删除共享目录或旧成果；结论不代替业务确认 |
| `convert-u8softhelp-chm-to-md.mjs` | 将 U8 帮助 CHM 转换为 Markdown 参考材料 | 原始 CHM 须恢复后运行；全量转换替换同名生成文件并更新索引，保留其他历史文件，不删除共享输出目录 |
| `harden-a1-cross-transfer-fields.mjs`、`normalize-norms-sankey-h5.mjs` | A1跨部门字段和部门桑基H5专项整改工具 | 写入必须使用脚本声明的显式开关；运行前确认目标文件并先执行只读检查 |
| `source-boundary-rules.mjs` | 为源文件边界检查提供共享规则 | 内部模块，不作为独立业务命令 |

## 修改规则

- 新增或修改仓库级脚本时，遵守 `scripts/AGENTS.md`，并在脚本头部或本 README 写清用法、输入、输出、是否写文件、是否写数据库和验证命令。
- 修改 `parse-sankey-data.mjs` 后，至少运行 `node scripts/check-dashboard-data.mjs` 和 `npm run test:process-governance-mainline`。
- 修改会触碰 MDM 导入链路的脚本后，同步运行 `apps/mdm-platform` 下的流程治理相关测试。
- 不在本目录新增一次性输出、截图、数据库、日志或缓存；这些应放入本地临时目录或按边界文件先写迁移提案。
