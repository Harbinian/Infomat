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
- [流程版本后续数据治理功能设计](docs/Process-Data-Governance-Design.md)
- [流程版本后续数据治理接口约定](docs/Process-Data-Governance-API-Contract.md)
- [流程版本后续数据治理数据库结构](docs/Process-Data-Governance-DB-Schema.md)
- [流程版本后续数据治理迁移与恢复说明](docs/Process-Data-Governance-Migration-Runbook.md)
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

`GET /api/org/me`保留原`positions`数组，并增加`positionInfo`说明岗位信息的读取状态。成功时为`{"status":"available"}`；可选岗位表不存在、结构不兼容或表/列读取被拒绝时为`{"status":"unavailable","code":"POSITION_INFO_UNAVAILABLE","message":"岗位信息暂不可用。当前访问权限仍按有效MDM工作角色计算。"}`。后者的空数组表示当前未取得信息，不能解释为人员没有岗位；登录区会显示“岗位信息暂不可用”。已有可读岗位数据继续原样返回，不写入、清空或迁移历史数据。核心人员、账号、角色和权限表的访问拒绝，以及数据库连接故障仍会使身份读取失败；此兼容处理不增加业务权限，也不向旧身份链路回退。

旧`submitter`、`owner`、`reviewer`、`it_lead`、`project_lead`、`workgroup_lead`、`business_contact`、`data_quality`以及其他非固定角色在迁移后只保留历史，不再产生有效权限。

## 流程治理统一入口与3001格式适配

- 3001继续作为独立、无状态的单流程编制工具运行。MDM不停止、不代管、不远程读取3001。现有V3编制路径由用户选择v1至v3文件并统一规范化为v3；原生V7另走默认关闭、精确单流程的受控上传路径。
- MDM顶部只保留一个“流程治理”入口。现有工作区为“流程编制、跨部门承接待办、承接冲突待办、V7预览核对”；默认关闭的数据生命周期治理试点入口只有在精确配置有效时才显示。
- “流程编制”直接显示MDM本地工作台，包含文字编制、条目侧栏、稳定排序、结构评分和跨职能流程图。该路径使用v3结构规则，不通过浏览器调用3001服务。
- 部门主对接人可以新建、导入、保存草稿和提交审核；管理员只能打开已有草稿查看。导出备份不替代保存草稿。
- MDM兼容`process-governance-v1`、`process-governance-v2`和`process-governance-v3`，服务端统一规范化、保存和导出为v3；3001源文件不被修改。v1、v2表单状态设为`unspecified`，不得按名称或明细数量推断。
- 用户可把3001导出的`process-governance-v7`文件上传到“V7预览核对”。3000保存案例、修订、双方部门核对结果和操作记录；预览阶段不转换为V3、不写正式草稿和版本，核对结果也不写回V7文件。预览和正式写入默认关闭，运行实例还必须通过`PROCESS_V7_TRIAL_PROCESS_REF`精确限定一个试点流程；只读访问不受该配置限制。既有说明记载2026-08-25曾按授权应用正式库M1/M2并核对迁移结构，这是历史记录，本轮没有复核正式库。第04、05阶段已在新建合成MySQL中验证事务、待办和浏览器办理，不代表真实历史恢复或业务验收。本轮未启动正式3000，未开启真实V7试点；正式迁移状态、全库备份恢复和实际流程试点仍需按后续明确授权处理。
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
- 第05阶段已将V7当前部门核对、退回修改、归口/范围核对、提升、提交、正式审核和待发布事项接入“我的工作台”。每项使用原案例或审核对象标识，保留来源角色及权限；可变待办即时读取，失败显示不可用。完成的事项在下一次读取消失，修订影响时重新出现。管理员叠加业务角色仍只读。
- V7可编辑字段使用页面内存保护。保存同页另一项不清除其他意见；切换、上传、退出和浏览器离页需要明确处理未提交内容；401后可由原账号恢复当前页面，409需先读取和核对当前修订。没有自动保存或长期浏览器存储。各角色第一步、完成条件、退回处理及合成截图见[角色使用手册第11节](docs/role-based-usage-guide.md#11-v7实际办理与未提交意见)。
- 承接详情使用固定故事链，不显示推测进度百分比。部门普通退回只回到上一责任步骤；明确拒绝或结构卡口提请争议处理时创建承接冲突。
- 相同流程与内容版本重复导入返回既有对象；内容变化保留旧修订和原决定，并重新进入审核。
- 任何当前承接未`confirmed`或未按决定关闭为`closed_not_required`时，流程不得发布。
- 固定角色模型为每个角色返回只读`visibleTabs`。创建账号、编辑账号和授权角色时显示多角色标签并集，但菜单可见性不替代服务端权限校验。
- 登录后的“待办优先”视图只显示“我现在该做什么”，最多给出3个下一步动作；职责图、角色说明和活动信息移到“全量职责”。历史V3流程编制器默认折叠并延迟加载，只用于旧草稿。
- 流程发布后的数据对象身份、主数据认定、统一对象匹配、关键字段和生命周期规则由MDM工作组处理。业务部门只答复MDM定向提出的具体事实问题并提供可核对依据，不填写完整治理工作包。
- 数据生命周期治理试点能力默认关闭，必须同时配置`PROCESS_DATA_GOVERNANCE_ENABLED=1`和唯一`PROCESS_DATA_GOVERNANCE_TRIAL_PROCESS_VERSION_ID`。工作包只绑定不可变`process_version_id`和来源摘要，不读取原始3001文件；固定规则生成的待核对内容不调用AI，也不自动确认。
- 本批结束后保留查阅时，工作包启用和准确版本范围保持不变，另设`PROCESS_DATA_GOVERNANCE_READ_ONLY=1`，并保持两个V7写开关关闭。工作包只显示已完成成果、原有治理结论和依据；业务部门仅查看本部门定向事实。缺省或`0`保留原办理模式，非法值拒绝访问及写入，不能将拼写错误当作可写。默认总开关仍关闭；准确操作及验证见[迁移与恢复说明](docs/Process-Data-Governance-Migration-Runbook.md)。本地实现不表示真实服务已经开启。

## 正式运行与结构维护分离

3000应用入口`npm start`要求显式配置`MDM_IDENTITY_READ_MODEL=mysql`和`PROCESS_GOVERNANCE_READ_MODEL=mysql`，并提供`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。`MYSQL_CONNECTION_LIMIT`如提供，必须为正整数。配置缺失、读模型不一致或正式模式启用遗留测试时，进程在监听前退出。运行入口不使用MySQL配置函数中的开发默认值作为回退。

应用启动不连接SQLite，也不建表、补列、执行迁移或初始化固定角色。身份、流程治理、指导意见、字段、术语、映射、冲突、待办、审计及流程草稿仓储的首次取得只做必要表列的`SELECT … LIMIT 0`检查。缺表、缺列、无权限或断库返回不可用信息；失败的结构检查关闭对应连接池，下一次请求可以重新检查。该检查不检查完整字段类型、索引、外键及迁移记录一致性，不能替代迁移手册的dry-run和结构漂移检查，也不是业务就绪接口。

建表和结构维护仅由显式命令处理：`init:mysql`、身份修复及既有RBAC、承接、统一治理、V3和V7迁移。原来由流程草稿请求触发的表单结构补齐已纳入`init:mysql`；承接和统一治理仍分别使用已有迁移命令。已有库升级必须先按对应迁移手册检查、备份和演练，不能通过访问页面或重新登录修复结构。本轮没有对正式或共享MySQL执行初始化或迁移；测试准备仅操作本轮新建的合成隔离实例。

运行账号和迁移账号应分开配置，以下是待目标环境落实的最小权限边界，本轮未修改真实账号：

| 账号用途 | 必要权限 | 不授予的权限 |
|---|---|---|
| 应用运行 | 对实际启用的业务表授予对应`SELECT/INSERT/UPDATE/DELETE`；固定部门和`roles/permissions/role_permissions`只需`SELECT`。账号管理需`person/user_accounts/person_roles`的`SELECT/INSERT/UPDATE`，访问事件需读取和追加；其他业务写表按现有API逐表核定 | 不授予`CREATE/ALTER/DROP/INDEX/REFERENCES`、`GRANT OPTION`或实例管理权限；不向固定权限模型表授予种子写权限 |
| 迁移维护 | 独立凭据仅在获准目标库和维护窗口使用；依选定迁移授予结构检查、必要DDL及数据补偿权限 | 不留在应用进程环境中，不默认使用实例root；不以库级全部权限作为长期运行权限 |

隔离验证入口为`npm run test:mysql-runtime-boundary`：脚本自行建立系统临时目录、合成身份和SQL监测替身，使用随机回环HTTP端口，阻止SQLite模块加载；不读取私有配置、不连接真实MySQL。固定的合成变量只用于测试。真实隔离MySQL最小权限账号、完整结构漂移、迁移中断及备份恢复仍须在后续数据演练阶段取证。

## 遗留入口与历史数据

正式服务对`systems/capabilities/processes/views/org-units/positions/persons/product-families/products/class-nodes/attributes/external/integration`接口族及`/api/quality/dashboard`返回`410 LEGACY_SQLITE_ROUTE_ISOLATED`。这是存储边界隔离；旧业务功能是否纳入首发仍待确定，不代表相关能力已经迁移或需求已经取消。`/api/quality/field-identities/progress`及现有MySQL治理接口继续保留。

历史SQLite记录仍在原`MDM_DB_PATH`指定文件或历史`data/platform.db`内，由原维护方保管，具体接续维护人待确认；本轮未读取、移动、删除或导入这些记录。旧能力、流程和地图不等于V7正式流程版本；组织岗位、产品和集成历史也不得按同名表直接转入MySQL。未来如需承接，先确定业务范围、原记录ID、引用和目标模型，再按单独迁移方案处理。已有MySQL草稿、发布版本、审批记录和稳定引用不变。

遗留测试只有在非production环境显式设置`MDM_ALLOW_LEGACY_TEST_MODE=1`并指定独立`MDM_DB_PATH`时才能注册旧路由，禁止指向共享`data/platform.db`；公开SQLite维护命令继续使用`legacy-sqlite:`前缀。该模式不提供正式服务回退。测试助手只在其创建的临时目录中使用此模式。

登录公共初始化仅读取运行能力和部门目录；其他模块在进入对应页面后读取。工作台与页面提示复用MySQL待办和冲突仓储，流程上下文从当前MySQL快照读取。旧页面显示暂停与承接提示，质量页保留字段进度；这些提示不改写首发业务范围。

## 历史共同开发入口

3000独立运维使用应用目录的`service:start`、`service:stop`、`service:restart`和`service:check`。它们复用根固定非敏感配置，只管理3000，校验进程路径、创建时间、监听、就绪、源码摘要和首页，不执行结构维护。正式运行默认使用MySQL会话；会话表必须通过`migrate:sessions:*`独立准备，HTTPS origin、可信代理和Secret必须显式提供。配置、迁移、过期清理及Windows恢复办法见[3000发布与恢复](../../docs/plans/2026-09-09-mdm-3000-launch/03-发布与恢复.md)。

`GET /api/health`保留为存活接口，`GET /api/ready`检查配置、数据库和必要结构并在失败时返回503；探测有超时、频率限制和单独连接池。会话和就绪检查已经完成本地及隔离验证，正式部署、真实账号、开机任务和业务验收尚未执行。

以下共同开发入口同时操作MDM和PMO，并含显式数据库初始化，不适用于仅3000上线。第03阶段保留该入口，没有执行。固定入口仍使用现有端口及MySQL非敏感配置真源。

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

直接启动应用不执行结构维护。共同开发脚本调用的`npm run init:mysql`属于显式写操作，包含补列、固定模型与术语种子、历史数据补齐和迁移记录，不应概括为无副作用的重启；它不覆盖已有账号密码或首次改密状态。

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

`npm run init:mysql`包含结构与种子维护，不能用来替代已有库的受控升级检查。`npm run bootstrap:admin`只允许在空身份库执行一次，创建受控`ADMIN001`管理入口；临时密码只在本次响应中显示。

已有数据库升级前必须先执行：

```powershell
npm run migrate:rbac-raci-v2:dry-run
npm run migrate:rbac-raci-v2:apply
npm run migrate:cross-dept-handoff-v2:dry-run
npm run migrate:cross-dept-handoff-v2:apply
npm run migrate:process-data-governance:dry-run
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
npm run init:mysql
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
npm run test:process-data-governance
npm run test:local-baseline
npm run test:security
npm run test:launch-stage04
npm run test:stage04-mysql-isolated
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

仓库级流程治理主线会调用 `node scripts/test-no-banned-terminology.js`。该检查只读取受控术语入口：用户页面 `apps/mdm-platform/public/index.html`，以及问题卡编制指引 `AGENTS.md`、`.agents/skills/process-evidence-mapping/SKILL.md`、`apps/mdm-platform/docs/role-based-usage-guide.md`；两类入口分别应用各自的禁止用语清单。检查不会启动服务、连接数据库或修改文件。

正式运行和正式流程治理同步使用MySQL。`legacy-sqlite:init-db`、`legacy-sqlite:sync-process-org`、`legacy-sqlite:import-process-governance`和`legacy-sqlite:check-process-governance`只服务遗留迁移或隔离测试，不是当前正式入口。执行`legacy-sqlite:init-db`时必须显式设置`MDM_ALLOW_LEGACY_TEST_MODE=1`，并通过`MDM_DB_PATH`指定非共享隔离库；脚本拒绝写入默认共享`data/platform.db`。

历史批量开户脚本已改为拒绝执行。新账号只能通过管理员接口创建为待启用状态；管理员明确启用时系统生成一次性临时密码，并要求首次登录改密。

`test:security`使用净化环境、自有临时库和显式合成仓储，验证废弃建号零写、正式路由追溯及固定角色正反向。`test:launch-stage04`在这些检查后新建本轮专属MySQL 8.4容器，通过真实HTTP/持久会话验证合成V3/V7办理与发布事务；要求Docker和本机已有`mysql:8.4`镜像，不连接现有数据库。准确副作用、仅模拟参数及证据目录见[脚本说明](scripts/README.md)。

`test:launch-stage05`聚合角色工作台相关回归，再执行自有临时MySQL的待办验证与真实Edge办理/未提交保护；可用`test:stage05-mysql-isolated`、`test:stage05-browser`定向复验。会话专用池保留默认2连接、整体超时，并允许最多32个等待请求，以承接正常页面并发读取；就绪池仍不排队。第05阶段已完成本地实现和合成隔离验证，未进入第06阶段，未证明正式容量、真实历史恢复或业务验收。

管理员对治理业务只读，包括质量单和映射待办备注；有相应业务权限的人员还须满足原有部门/参与范围才能留言。一般冲突协调结果要求当前冲突处理权限及当前指派关系，历史被指派不能替代现有权限。此次仅收紧服务端写入检查，保留已有备注、协调记录、稳定标识和数据格式。

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
npm run test:process-data-governance
npm run migrate:process-data-governance:dry-run
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
- MySQL基础结构包含`process_import_fingerprints`，用于保存每次导入的质量问题和映射待办指纹；`npm run init:mysql`以幂等建表补齐已有实例。本次只修复仓库结构定义并通过静态测试，没有对任何运行实例执行初始化或迁移。
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
