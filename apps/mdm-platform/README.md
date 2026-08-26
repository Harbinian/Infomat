# MDM 平台

## 先读这份

如果你想知道平台现在到底能做什么、每个角色应该怎么用，请先看：

- [MDM 平台角色化使用手册](docs/role-based-usage-guide.md)
- [权限与RACI说明](docs/Permission-RACI.md)
- [RBAC/RACI迁移手册](docs/RBAC-RACI-Migration-Runbook.md)
- [单流程治理JSON、承接与冲突接口](docs/Cross-Department-Handoff-API-Contract.md)
- [流程草稿、承接与冲突数据库结构](docs/Cross-Department-Handoff-DB-Schema.md)
- [流程治理统一入口迁移手册](docs/Cross-Department-Handoff-Migration-Runbook.md)
- [单流程治理v3表单状态迁移手册](docs/Process-Governance-V3-Migration-Runbook.md)
- [V7预览核对功能设计](docs/Process-V7-Preview-Review-Design.md)
- [V7预览核对接口约定](docs/Process-V7-Preview-Review-API-Contract.md)
- [V7预览核对数据说明](docs/Process-V7-Preview-Review-DB-Schema.md)
- [V7预览核对与原生正式基础迁移说明](docs/Process-V7-Preview-Review-Migration-Runbook.md)
- [跨部门承接闭环测试说明](docs/Cross-Department-Handoff-Test-Plan.md)
- [产品需求](PRD.md)
- [技术规格](Tech-Spec.md)

角色手册按角色说明实际操作；权限、接口、数据结构和迁移边界以对应受控说明为准。

## 边界和入口

`apps/mdm-platform/` 只负责 MDM 平台应用本身：Express 路由、MySQL 目标 schema、单文件前端、应用内脚本和平台使用说明。

不在本目录维护流程输入基线、PMO 驾驶舱或仓库级数据转换脚本：

- 流程输入基线：`docs/norms/{部门}部门-能力-流程-系统映射关系.md`
- 组织真源：`docs/organization/组织架构和部门职责.md`
- PMO 展示：`pmo/procedure-management/dashboard.html`
- 仓库级脚本：根目录 `scripts/`

开发 MDM 代码前先读 [AGENTS.md](AGENTS.md)。执行、调整或新增应用内脚本前先读 [scripts/README.md](scripts/README.md)。

## 当前身份与权限模型

3000是内部治理平台，不提供自助注册、批量开户或RBAC导入。普通账号只能由MDM系统管理员手工创建、授权和启用。

- 模型版本：`rbac-raci-v3-2026-07-31`
- 唯一身份链路：`person -> user_accounts -> person_roles`
- 固定角色：`admin`、`mdm_lead`、`department_contact`、`department_mdm_reviewer`、`data_conflict_handler`、`data_quality_auditor`、`decision_group`
- 固定角色、权限包和RACI只读，不提供自定义角色或权限矩阵编辑。
- `admin`管理身份并全局只读治理材料，没有业务审核、确认、修改或发布权限。
- 部门最终负责人以`departments.final_responsible_person_id`为准，可以没有3000账号。
- 正式流程工作角色`WR-*`、岗位、人员身份和MDM工作角色互不替代。

旧`submitter`、`owner`、`reviewer`、`it_lead`、`project_lead`、`workgroup_lead`、`business_contact`、`data_quality`以及其他非固定角色在迁移后只保留历史，不再产生有效权限。

## 流程治理统一入口与3001格式适配

- 3001继续作为独立、无状态的单流程编制工具运行。MDM不停止、不代管、不远程读取3001，只接收用户选择的v1/v2文件。
- MDM顶部只保留一个“流程治理”入口，内部显示“流程编制、跨部门承接待办、承接冲突待办、V7预览核对”四个工作区。
- “流程编制”直接显示MDM本地的3001式工作台，包含文字编制、条目侧栏、稳定排序、结构化学习评分和跨职能流程图。MDM复用相同v2结构规则，但不通过浏览器调用3001服务。
- 部门主对接人可以新建、导入、保存草稿和提交审核；管理员只能打开已有草稿查看。导出备份不替代保存草稿。
- MDM兼容`process-governance-v1`、`process-governance-v2`和`process-governance-v3`，服务端统一规范化、保存和导出为v3；3001源文件不被修改。v1、v2表单状态设为`unspecified`，不得按名称或明细数量推断。
- 用户可把3001导出的`process-governance-v7`文件上传到“V7预览核对”。3000保存案例、修订、双方部门核对结果和操作记录；预览阶段不转换为V3、不写正式草稿和版本，核对结果也不写回V7文件。预览和正式写入默认关闭，运行实例还必须通过`PROCESS_V7_TRIAL_PROCESS_REF`精确限定一个试点流程；只读访问不受该配置限制。正式库M1/M2已于2026-08-25按授权应用，当前只读检查确认迁移记录与目标结构一致；历史事后演练不能替代本次代码对应的隔离验收。本轮未启动3000，未开启V7开关，也未配置试点`process_ref`；新的全库备份恢复、隔离MySQL验收和真实脱敏流程试点均待分别批准。
- 原生V7正式草稿在3000中只读。V7主档不能通过通用“创建下一版草稿”或旧`document-structured-output-v2`导入路径降级生成V3草稿；新修订必须回到3001修改、重新上传预览并完成受控提升。提交、审核和发布必须携带当前`expected_revision_no`和`expected_content_hash`；HTTP路由不透传事务或定位器字段。服务端在同一事务内按固定顺序锁定提升依据、正式主档、当前版本、草稿和审核任务，然后用同一连接复核账号、`auth_version`、部门、角色和权限，并通过状态、修订号、内容摘要和版本指针条件更新防止过期或并发操作。
- `npm run init:mysql`不创建V7预览表，也不写入M1迁移记录。M1预检返回固定六种`consistency_status`；发现记录与结构不一致时，dry-run只报告，apply停止且不自动补表或补记录。
- `process_design_drafts.process_content_json`是完整流程JSON真源。保存必须携带`expected_revision`，并发不一致返回`409 DRAFT_REVISION_CONFLICT`。
- `POST /api/process-design/import-structured-output/preview`只返回摘要、承接候选、治理提示和内容哈希，不写数据库。
- `POST /api/process-design/import-structured-output/approve`仅允许归口部门`department_mdm_reviewer`执行，并在单一MySQL事务中写入流程草稿、承接投影、参与关系、事件和导入审计。
- `admin`对治理材料只读，执行审核导入、承接补充、部门决定或结构卡口时返回403。
- 前置输入和后续承接统一保存在`process_design_cross_dept_handoffs`；待办直接按承接状态、角色、部门和参与关系生成，不再建立“待确认问题”第二份业务事实。
- 承接事件继续使用稳定机器标识`handoff_candidate_created`，以便读取既有事件记录；页面把该事件显示为“生成承接待核对项”。机器标识不代表业务人员已经确认承接内容。
- V7预览核对页面把尚未确认的执行角色显示为“执行角色待确认”，核对项双方均确认后显示为“执行角色”。该显示状态只反映本案例的核对进度，不代替业务审核、批准或发布。
- V7核对项使用`process-v7-review-item-v2`摘要。相关业务行为、流程关系、数据字段或生命周期、表单操作或字段变化时，双方重新核对；缺少摘要版本的历史核对项不得沿用原结论。
- 承接详情使用固定故事链，不显示推测进度百分比。部门普通退回只回到上一责任步骤；明确拒绝或结构卡口提请争议处理时创建承接冲突。
- 相同流程与内容版本重复导入返回既有对象；内容变化保留旧修订和原决定，并重新进入审核。
- 任何当前承接未`confirmed`或未按决定关闭为`closed_not_required`时，流程不得发布。
- 固定角色模型为每个角色返回只读`visibleTabs`。创建账号、编辑账号和授权角色时显示多角色标签并集，但菜单可见性不替代服务端权限校验。

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

重启服务和执行 `npm run init:mysql` 只补齐缺失的 MySQL 身份结构，不会覆盖已经存在账号的密码或首次改密状态。如果某个账号曾在历史问题中被旧密码覆盖，管理员需要为该账号重新重置一次密码。

全新空数据库先初始化MySQL schema，再执行一次受控管理员初始化。检测到已有人员、账号或有效管理员时，初始化会拒绝重复执行：

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
npm run bootstrap:admin
```

`npm run init:mysql`只补齐MySQL结构，不覆盖现有账号密码、状态或角色。`npm run bootstrap:admin`只允许在空身份库执行一次，创建受控`ADMIN001`管理入口；临时密码只在本次响应中显示。

已有数据库升级前必须先执行：

```powershell
npm run migrate:rbac-raci-v2:dry-run
npm run migrate:rbac-raci-v2:apply
npm run migrate:cross-dept-handoff-v2:dry-run
npm run migrate:cross-dept-handoff-v2:apply
```

迁移只自动保留现有受控`ADMIN001`管理员；其他账号停用，旧角色不自动映射。管理员必须依据权威名单逐项重新授权并启用。完整步骤见[迁移手册](docs/RBAC-RACI-Migration-Runbook.md)。

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
npm run test:rbac-raci-v2
npm run test:project-roles
npm run test:role-workbench
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
npm run migrate:rbac-raci-v2:dry-run
npm run migrate:rbac-raci-v2:apply
npm run smoke:data-map-mysql
npm run import:process-input-baseline-review -- --review-run artifacts/process-input-baseline-review/<run-id>
```

历史批量开户脚本已改为拒绝执行。新账号只能通过管理员接口创建为待启用状态；管理员明确启用时系统生成一次性临时密码，并要求首次登录改密。

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
npm run test:process-governance-unified
npm run migrate:process-governance-unified:dry-run
npm run test:process-governance-v3-migration
npm run migrate:process-governance-v3:dry-run
npm run test:process-v7-preview-review
npm run migrate:process-v7-preview:dry-run
npm run inspect:process-v7-m0
npm run rehearse:process-v7-m0-backup-restore
npm run migrate:process-v7-formal:dry-run
npm run rehearse:process-v7-migrations-isolated
npm run import:process-governance-mysql
npm run smoke:process-governance-mysql
```

`rehearse:process-v7-migrations-isolated`只在恢复后的临时 MySQL 和本机临时 HTTP 端口运行。正式 V7 的提交、审核和发布必须通过公开的 Express 路由及会话门禁，脚本不直接调用仓储写方法，也不接触路由内部的事务能力。演练会在创建任何预览或正式业务记录前，从隔离恢复库选择三个相互分离的有效账号：归口部门的`department_contact`、归口部门的`department_mdm_reviewer`和全局`mdm_lead`。账号、角色、权限、部门范围或`auth_version`不满足要求时，脚本以`V7_ISOLATED_FORMAL_ACTORS_REQUIRED`停止，不把人员姓名写入演练证据。

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
- `MDM_IDENTITY_READ_MODEL=mysql`是正式身份路径。登录、`/api/org/me`、账号生命周期、固定角色模型、角色工作台、流程治理、流程设计、数据地图、字段台账、术语、冲突、待办和发布检查均从`person/user_accounts/person_roles`读取当前身份。运行时不再从`users/user_roles`或SQLite人员接口补齐身份。
- `/api/org/accounts`是唯一普通账号写入口。旧`/api/org/users*`写操作和`/api/import-rbac/*`批量写入返回`410 LEGACY_IDENTITY_API_RETIRED`；角色矩阵写操作返回`405 CORE_GOVERNANCE_MODEL_READ_ONLY`。
- 流程治理正式前端入口为`#/processGovernance`，默认进入流程编制。旧“文档结构化输出、待确认问题、流程图谱、证据来源、映射工作、治理闭环”不再提供前端入口；原表和旧接口暂留作只读历史，不作为新业务写入口。
- 流程编制使用`public/process-governance-editor/`中的MDM本地工作台。页面按“基本信息、目的与范围、术语定义、流程步骤、表单与记录、导出检查”编制，并提供条目侧栏、稳定排序、结构评分和跨职能流程图；“表单与记录”按整张纸质表单显示全部字段，并由用户明确字段归属；完整`process-governance-v3` JSON保存到MySQL，浏览器不持久化业务草稿。
- 3001当前V7文件只通过用户主动下载和上传进入V7预览核对。MDM不反向调用3001服务；预览上传、后续提升和发布必须分别重新校验结构、语义、身份、部门范围、修订号和内容摘要，上传文件中的任何审核状态不作为凭证。
- 跨部门承接待办和承接冲突待办均直接进入流程治理对应队列。角色工作台使用深链接跳转到承接或冲突对象；故事链展示处理人、部门、时间、依据及退回或冲突分支。
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
