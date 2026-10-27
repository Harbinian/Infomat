# MDM 应用脚本说明

## 当前3000部署维护

2026-10-23全盘升级已完成，当前运行HR v5。实际发布、最新备份恢复、197表保全和11条列级运行权限增量见[本轮报告](../../../artifacts/3000-upgrade-deploAX4261023-122006/README.md)。本批deploy、迁移和授权动作已完成，不作为日常命令重放。当前只读检查与兼容恢复入口以[Docker说明](../DOCKER.md#运行与恢复)为准；恢复保留v5及后续历史，不启动旧v4软件或覆盖旧备份。

## 界面文字与技术信息展示验证

N01—N07专项使用前端`n01-n04-checks-regression.test.js`、`n02-n07-summary-guidance.test.js`、`n03-n05-n06-case-history.test.js`，覆盖长清单原文入口、准确表单来源语义、普通业务句子保护、角色指引归类、时限静态布局和历史动作／材料名称。完整前端348项（347通过、1项既有跳过）、隔离Git候选复跑、九类固定合成角色及管理员兼任身份检查见[本批证据](../../../artifacts/3000-n01-n07-release-20261027/README.md)。本批浏览器为IAB Chromium、1699×828桌面，未完成Edge或业务验收。正式发布和恢复只使用[Docker说明](../DOCKER.md#运行与恢复)所列准确入口，不重放历史发布脚本。

R06—R10专项为前端`accountability-support-regression.test.js`、`navigation-access-regression.test.js`、`authoring-entry-guidance.test.js`、`office-selection-regression.test.js`、`remaining-guidance-summary.test.js`及`shared-editor-presentation.test.js`（准确文件清单见本批报告）。覆盖固定读取资格、多角色、草稿空状态、主动办公室选择与深链、角色结果位置及技术摘要。3000的`sharedEditorPresentation.js`在Vite前置阶段仅适配共享Workbench的4处文件标签，原文件和上传处理函数不变；匹配数变化会拒绝构建，不做DOM文字替换。完整测试及实际角色、办公室保存链证据见[本批报告](../../../artifacts/3000-remaining-remediation-20261026/README.md)，不连接正式库，不操作3001。

R01—R05使用`frontend/tests/formal-readability-regression.test.js`、`priority-workbench-regression.test.js`、`priority-case-workbench.test.js`、`priority-handoff-titles.test.js`和`test-confirmation-guidance-regression.test.js`覆盖准确原文位置、同口径事项、既有治理动作投影、准确承接名称和测试用途确认。纯检查使用合成仓储替身，不连接正式库。完整前端结果、14组v5自有MySQL回归、九类合成角色实际登录及材料／时限实办见[本批证据](../../../artifacts/3000-priority-remediation-20261026/README.md)；本轮浏览器为IAB Chromium，未完成Edge或业务验收。当前MySQL工作台每次读取可变事项，不使用历史非MySQL分支的15秒缓存。

案例材料、时限和确认历史时间专项：在本目录执行`node test-process-case-time-projection-mysql.js <全新artifacts目录>`，仅创建归属明确的临时MySQL；四种Node/MySQL时区组合核对毫秒、NULL、原日期、回执及历史JSON字节，不连接已有库。相关界面和角色复查见`artifacts/3000-q22-remediation-20261022124841/`。

51517人工视角复查后的整改证据见`artifacts/3000-ui-remediation-20261022-102015/`。前端`npm test`覆盖具体事项、术语位置、阻止原因与输入保留、日期及历史展示；术语来源候选排除导出元数据，但保留旧位置兼容和业务表单编号。`test-process-formal-timestamps-mysql.js --output <全新artifacts目录>`验证正式TIMESTAMP在Node与MySQL会话不同时区的读取一致性；`test-governance-time-reader.js`由专项夹具通过标准输入传入临时库连接，仅作该自有库的双时区只读比对，不能作为连接正式库的独立入口。`test-process-authoring-workspace-mysql.js --output <全新artifacts目录>`还验证新提交关闭转办、旧保存证据只读兼容及关闭功能不重新开放窗口。该命令仅创建自有临时MySQL和随机回环HTTP，原生V7/V8、旧修订及固定版本继续保留。角色页面复查、候选来源和最终结果分别保存在本轮报告，不以测试通过替代业务验收。

前端在独立的 `frontend/` 目录运行 `npm test`，再将 `npm run build -- --outDir <artifacts内全新构建目录>` 的结果用于验证。

`node scripts/test-interface-copy-browser.js --build <artifacts内构建目录> --output <artifacts内全新证据目录>` 使用真实3000组件、当前构建、合成HTTP响应和自有Edge验证业务详情、关联内容、对象与字段名称选择、允许值类型、撤回步骤、来源变化后的输入保留，以及角色权限页。检查正文、折叠详情、提示和可访问名称中的技术信息；保存请求核对原有大整数标识及数据类型。内部标识允许留在请求、选项值及下载文件中，不作为用户可见文字。

脚本只创建随机回环HTTP和自有浏览器，测试数据不进入数据库，不读取私有配置，不操作3000或3001实例。桌面固定Edge 100%、1699×828 CSS像素；输出截图及结果，结束关闭自有HTTP和浏览器。合成验证不能替代真实账号、正式历史数据逐条核对、人工中文输入体验或业务验收。

`frontend/tests/business-guidance.test.js`检查保存时间的明确时区转换、历史缺名处理及根据实际任命生成的操作指引。`test-process-authoring-browser.js`使用当前“下载编制文件”入口检查原生文件往返，下载事件与点击一同等待，避免旧按钮名称造成未处理等待。v4隔离候选须使用相符的v4夹具和冻结后端；不能用工作树v5夹具的结果代替。候选组合、主线及显示边界检查的来源和结果见[第二批本地证据](../../../artifacts/3000-batch2-v4-20261021-180924/README.md)，不运行其中任何正式准备或发布命令。

## 3000内流程编制候选

`npm run test:process-authoring-editor`检查纯模板、历史版本、结构检查、有效部门提示及白名单资源，只使用随机本机HTTP，不连接数据库或3001。`npm run test:process-authoring-mysql -- --output <artifacts内全新目录>`创建自有临时MySQL与合成账号，验证草稿保存/重开、权限与并发、幂等、同事务提交、旧原生JSON及既有核对/正式流转与退回恢复。运行不读取私有配置，不修改正式数据库或3000/3001实例。

`npm run test:process-authoring-faults-mysql -- --output <全新证据目录>`在自有临时MySQL注入快照与回执SQL故障，验证新建/保存未知回执以原UUID恢复，以及案例修订、编制草稿、快照和请求回执的整体回滚。

前端在`frontend/`独立测试，并构建到artifacts目录。`npm run test:process-authoring-browser -- --frontend-dist <artifacts构建目录> --output <全新证据目录>`用真实Edge100%、1699×828桌面和自有MySQL验证编制交互及JSON往返；`npm run test:process-authoring-read-races-browser -- --frontend-dist <artifacts构建目录> --output <全新证据目录>`定点验证迟到读取、模板、账号切换、旧材料缺省值、同组件目标切换及精确JSON回传。`npm run candidate:process-authoring -- --frontend-dist <artifacts构建目录> --output <全新候选目录> --serve`保持合成候选供检查。候选数据为临时数据，关闭后清理自有容器；需留存成果先主动下载JSON。API、兼容、独立开关与正式切换条件见[流程编制实施合同](../PROCESS_AUTHORING.md)，隔离测试不表示正式开启或业务验收。

### 已受控目标的编制草稿结构准备

`node scripts/manage-process-authoring-schema.js --inspect --target <host:port/database> --server-uuid <实时服务器UUID> --deployment-id <本次UUID> --expected-cutover-epoch <已核验代次>`只读盘点三张编制草稿表，输出`inventory_digest`。连接环境必须显式提供`MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`，工具不加载私有配置或输出凭据。数据库名、服务器UUID、`controlled`状态与受控代次须同时匹配；本入口不会重跑通用治理准备或改变受控状态。

执行使用相同目标、部署编号和受控代次，将`--inspect`换成`--apply`，另传`--authorize-formal-migration --confirm-target <相同目标> --backup-file <实际备份文件> --backup-sha256 <SHA256> --restore-receipt-file <实际恢复回执JSON> --restore-receipt-sha256 <SHA256> --authorization-reference <本次授权依据> --write-fence-reference <已停写证据> --expected-inventory-sha256 <本次盘点摘要>`。备份与恢复凭证沿用下文`governance-backup-restore-v1`合同，须对应同一目标并由实际恢复检查形成。执行方须先落实停写、备份及恢复条件；参数本身不能证明已停写或已恢复。

工具仅调用现有编制结构迁移，创建缺少的`process_authoring_drafts`、`process_authoring_revisions`、`process_authoring_requests`并登记对应迁移标记。盘点摘要绑定目标、受控代次、预期DDL、三表结构与行数、基础迁移表及其他迁移记录。结构或列排序规则漂移、未登记非空表、已有标记但缺表、相关表存在未预期触发器时拒绝执行。DDL隐式提交；部分创建后须重新盘点，只有既有部分为空且结构匹配、无迁移标记，并明确绑定新摘要时才能补齐。结果不明时先盘点核对，不能推定失败或删除新表；已登记且完整匹配的表可以幂等检查，原草稿、快照及请求回执保留。

入口不授予运行账号权限，不修改功能开关、流程正文、人员授权、受控代次或历史审核，也不启动、部署或停止服务。结构准备、运行权限配置、应用部署和功能开启分别留存回执。维护桥可导入此脚本的`inspect(pool, options)`与`apply(pool, options)`复用相同核验和回执，不能绕过该入口直接写表。

`node scripts/test-process-authoring-schema-mysql.js --output <artifacts内全新目录>`仅创建两个自有临时MySQL，执行真实合成备份与恢复、目标和证据拒绝、首次准备、部分创建恢复、幂等、漂移拒绝及原行保护；不读取私有配置或连接正式数据库，不能替代正式执行证据。

## 确认用途与案例治理检查

`node scripts/test-process-review-presentation-browser.js --frontend-dist <artifacts构建目录> --output <全新证据目录>`使用自有临时MySQL、合成身份和Edge100%、1699×828验证重新提交后的状态提示、旧意见与历史保留、当前修订新意见，并静态核对共享组件关闭编制开关时的中性说明；`--workbench-only`只检查工作台待办优先、全量职责的提示与记录保留，并只读核对主对接人角色说明。脚本只写合成草稿、修订、核对意见、截图和结果，不连接现有候选、正式数据库或3000/3001；执行后清理自有临时服务。

`node --test scripts/test-process-case-confirmation-usage.js`核对用途更正与案例、修订、原确认及办理人绑定，仅运行纯函数，不连接数据库。`node scripts/test-process-case-governance-mysql.js`创建并清理自有临时MySQL，覆盖测试记录保留、正式门槛阻断、派生范围判断失效及另行本人业务确认；不读取私有配置或操作3000/3001、正式库。可通过`PROCESS_CASE_TEST_OUTPUT`将证据写入新的artifacts文件。

## 统一术语治理命令

`npm run test:terminology-governance`核对纯策略、事务替身与迁移/API契约；`npm run test:terminology-governance-mysql`创建并清理各自拥有的随机临时MySQL实例，核对实际权限与锁、逐条生效、质疑、迁移中断/重跑、原数据完整性及流程/数据引用冻结。不会读取私有配置或连接正式数据库。前端模型检查在`frontend/`运行`npm test`，真实桌面候选验证的命令与证据见`TERMINOLOGY_GOVERNANCE.md`。

`npm run test:terminology-frontend-mysql -- --output <artifacts内全新目录>`使用当前`frontend/dist`、Edge 100%、1699×828 CSS像素、随机回环HTTP及自有临时MySQL，验证术语表单、角色权限、来源变化、质疑办理、合并及三个页面的引用面板。运行前在`frontend/`执行`npm run build`。术语、引用、身份权限及固定数据定义读取使用真实仓储；登录会话建立、流程外层和工作包外层读取为合成夹具，具体路由记录在证据中。它不覆盖真实登录、完整流程或数据工作包发布，也不能替代人工输入体验及业务验收；不读取私有配置，不操作3000/3001或正式数据库。

仅复核固定历史定义的读取及只读提示时，可在同一命令后加`--history-only`。该模式仍创建自有临时MySQL并经过实际HTTP及Edge，输出`mode=history-only`，不能代替完整交互验证。

`npm run migrate:terminology:inspect -- --target <host:port/database>`及`migrate:terminology:dry-run`只读盘点并输出`manifest_digest`。`migrate:terminology:apply-isolated`另须`--authorize-isolated-migration --confirm-target <相同目标> --backup-sha256 <已备份SHA256> --expected-manifest-sha256 <盘点摘要>`。入口只接受显式本机非业务端口及`stageNN_isolated_<32位随机十六进制>`数据库，默认不执行迁移，不能用于正式切换。传入环境须明确MYSQL_HOST/PORT/DATABASE/USER/PASSWORD；脚本不自动加载私有文件，不输出密码。

迁移保留旧表、状态、待办与冲突引用，按旧表及旧编号建立映射，不按同名自动合并。若开关关闭期间旧表又有写入，重新盘点会报告快照变化，不能覆盖新词典。恢复开关不构成数据降级；新版本、事件和引用必须保留，后续正式切换及恢复另行核对目标、备份与操作授权。

### 正式术语与数据承接结构准备

`node scripts/manage-governance-deployment.js --inspect --target <host:port/database> --server-uuid <实时服务器UUID> --deployment-id <本次UUID>` 只读核对结构与旧数据，输出 `manifest_digest`。必须显式提供 MYSQL_HOST/PORT/DATABASE/USER/PASSWORD；不加载私有配置文件。目标名与 UUID 任一不匹配即拒绝。`--inspect` 不接受执行参数，也不创建新表或控制行。

执行使用相同目标和部署编号，并将 `--inspect` 换成 `--apply`，另传 `--authorize-formal-migration --confirm-target <相同目标> --backup-file <实际备份文件> --backup-sha256 <SHA256> --restore-receipt-file <实际恢复回执JSON> --restore-receipt-sha256 <SHA256> --authorization-reference <本次用户授权依据> --write-fence-reference <已停写证据> --expected-manifest-sha256 <盘点摘要>`。工具读取并核验备份及回执文件摘要；执行方须事先完成对应正式目标的备份、真实恢复验证和停写，提供可追溯证据，不得把参数值或合成演练当作实际恢复证明。

恢复回执的 `schema_version` 或 `contract` 为 `governance-backup-restore-v1`：`status=passed`；`source.database/server_uuid` 与原目标一致；`backup_sha256` 与实际备份一致；`restore_target.database/server_uuid` 标明不同于原目标的恢复位置，或由 `source.container_id` 与 `restore_target.container_id` 的实际完整容器标识证明两者不同；`schema_verified=true`、`data_verified=true`；`source_inventory_sha256` 与 `restored_inventory_sha256` 为相同的实际核对摘要。回执与文件的一致性可由工具校验，实际恢复及其业务完整性仍须保留执行证据。

该入口只创建术语/承接增量结构、必要的 `source_kind` CHECK 扩充、`prepared` 控制行和旧数据快照桥接。六张基础工作包表全部缺失且无标记时，盘点显示 `work_package_foundation.preparation_plan=create_six_empty_tables`，在同一次明确授权中调用现有基础迁移，仅创建空表与标记，不建立工作包、创建任务或回填。基础表已有完整且匹配结构及标记时原样保留；部分结构、缺标记、引擎/排序规则/约束漂移均拒绝自动修复。前置定义版本表或其他外键目标缺失时也明确拒绝，不调用会回填旧头的 `applyDefinitions`。不改源行，不创建审批、审核绑定、有效头或通知，不切 `controlled`、修改功能开关或重建容器。DDL 隐式提交；术语/承接增量中断后重新盘点同一部署编号，在源摘要未变且无漂移时可继续；基础工作包表中断产生的部分结构须单独核对，不自动补齐。已受控目标不能重跑准备；提交回执不明须先核对记录，不能直接推定失败或重新执行。`node scripts/test-governance-deployment-migration.js` 仅创建两个自有隔离 MySQL，执行合成备份及真实恢复、目标/授权/凭证拒绝、基础空表准备与异常拒绝、原生驱动/文本传输摘要一致、中断重跑、幂等和原行完整性检查；证据输出到全新 artifacts 目录。

快照读取依据实时 `DATA_TYPE` 保持源值类型：已知 INT/TINYINT 等与 FLOAT/DOUBLE 数值从文本传输严格恢复为 mysql2 的数字类型，FLOAT 对齐其单精度值；不安全整数或非有限值拒绝。显式 CAST 的 BIGINT、DECIMAL、日期和 JSON 保持字符串，未知类型不根据内容猜测。基础空表准备前后仅规范化该明确计划造成的缺表到空表变化，原有基础表的完整行摘要以及其他源资产和字段摘要仍固定核对。


本文件按用途说明当前命令；命令表依据本应用`package.json`核对。阶段进展、验证结论和已废止配置保留在文末历史快照，不能代替当前脚本或目标状态。代码路径以应用目录为基准。

`node --test scripts/test-workbench-availability.js`使用合成会话、随机回环HTTP服务、SQL和DOM替身，检查管理员个人待办边界、人员ID完整性、预览开关状态及关闭时的请求顺序；不读取私有配置、不连接真实数据库。当前前端测试由在`frontend/`目录运行的`npm test`收集。

`node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-office-system-admin.js`使用合成独立管理员会话、SQL替身和随机回环HTTP服务，检查办公室只读查阅、认证变化、首次改密、无权身份、精确标识及四种任务写入拒绝；同时验证账号503的通用反馈和只含错误码、请求编号的安全日志。该检查不读取私有配置、不连接真实数据库、不替换3000。

`node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-account-creation-policy.js`使用合成临时凭据文件和随机回环HTTP，检查新登录名按工号确定、明确不一致值被拒绝、首次启用读取独立配置、无配置时保留随机兼容、配置失效时拒绝继续，以及开户权限和随机重置机制；已有人员赋予账号另检查精确标识、仅需账号维护权限、拒绝无权身份及忽略伪造登录名/角色/操作者字段。它不读取真实凭据、不连接目标数据库、不创建实际人员账号。

`node scripts/test-workbench-availability-browser.js --build <artifacts内的前端构建目录> --output <artifacts内的新证据目录>`以合成HTTP响应核对实际构建页面，使用Edge100%、1699×828 CSS像素，输出截图和验证记录；不登录真实账号、不连接数据库，不使用3000端口。

`node --test scripts/test-system-admin-definition-reads.js`使用合成SQL核对独立管理员读取设计交接时的账号状态、密码代次、现有全局读取权限及事务内账号锁，同时检查治理写入被拒绝；不读取私有配置、不连接真实数据库。结构指纹检查由其他专项覆盖，本脚本只替换该检查外壳，身份及权限逻辑使用实际实现。

`node --test scripts/test-degraded-log-context.js`使用合成会话、合成仓储工厂和随机回环HTTP服务，核对两个降级入口写入`dependency_degraded`，在分类日志中保留来源错误码，并按现有MySQL不可用契约返回503，避免回显来源错误消息。静态守卫使用开发依赖`acorn`解析语法树，按词法作用域检查`server/`下`securityLog(<标识>)`的自由变量；其他函数或兄弟块的局部变量不能提供绑定。它不检查变量初始化顺序或运行时值。完整入口要求安装开发依赖；生产镜像不安装或加载解析器。不读取私有配置、不连接真实数据库，不使用3000端口。

## 治理扩展与精确建包验证

`node scripts/test-process-data-governance-identities-mysql.js <artifacts内全新目录>`仅创建自有标记的临时MySQL，核对普通整数响应、相邻大整数的固定来源／创建任务／工作包、重复创建、无效输入拒绝及旧正文摘要保留。它不读取私有配置，不连接已有库，不授予真实人员角色。相关HTTP范围检查还验证只读归档按精确工作包关联事实问题，不合并相邻编号。

承接集成与工作区浏览器脚本的`--output`接受artifacts内不存在的新目录，保留旧证据；准确候选通过显式`MDM_TEST_CANDIDATE_ROOT`及`--frontend-dist`选择，不根据根工作树或目录名推定被验证版本。`withStage05Fixture`的`terminologyEnabled`仅允许显式布尔值；需要调用方在自有临时库先准备对应结构，不继承本机私有配置或自动迁移。

`withWorkspaceFixture`可用显式函数`beforeSeed`在承接合成资料建立前准备辅助结构；它与种子后的`beforeStart`分开，不改变默认夹具。已封闭的旧定义写入口不能用作准备通道；空的自有测试库按结构声明明确建表并核对，只记录合成前提，不视为实际迁移或业务办理通过。分析辅助结构准备不启动工作进程，也不调用外部AI。

本地候选组合、旧失败复核、真实页面及权限验证分别见[治理扩展交付记录](../../../artifacts/3000-batch4-governance-20261021-200339/README.md)。业务撤回／恢复分支与系统级全组合故障恢复分别记录，自动技术检查不表示实际业务验收。

## 数据地图受控承接本地回归

`npm run test:data-map-handoff -- --output <artifacts内全新目录>` 运行 6 个纯检查入口，覆盖规则、共享旧写边界和最小 HTTP 权限合同；MySQL 调用被测试钩子阻断。`npm run test:data-map-handoff:mysql -- --output <artifacts内全新目录>` 共收集 26 个入口，另含显式结构中断/续跑、实际 v4/v5 权限及锁、旧包接入与更正、全局回执断连/进程退出、固定 reader、完整影响闭包、原子发布、仓储与路由整链、原生审核 pending 任务、隔离兼容登记、内部草案生成、原生历史、本节 Q10、Q6、旧消费和 Q9 MySQL 专项。省略 output 时生成 UUID 新目录，拒绝覆盖已有结果；同名纯检查与 MySQL 检查分别存放。MySQL 检查只创建带唯一 owner 标签的临时 MySQL 8.4 tmpfs 容器、随机回环端口和随机库，结束按所有权清理，不读取私有配置或连接已有数据库。入口收集不表示本轮已重新运行全部 26 项，实际执行见报告。

`npm run test:data-map-handoff:http -- --test-node-path <artifacts内专用node_modules>` 用自有候选 API 进程验证旧 W/R 入口矩阵、新接口和目录独立保存。该矩阵的最小候选前端仅用于 API server，不能算 Edge 页面或人工体验验收。当前可复用专用目录 `artifacts/mdm-data-governance-handoff-implementation-20261020-01/test-dependencies/node_modules` 中与 3001 锁文件相同版本的 Cytoscape；这只是现有路由启动的测试依赖，不变更 3001、应用依赖或正式配置。

原生工作包逐次历史与客户端回执恢复专项直接使用以下脚本，不增加 npm 入口：

- `node scripts/test-data-map-native-history-mysql.js <artifacts内全新证据目录>`：原生候选、明细及事实的不可变版本、旧历史缺口、同 UUID 回执、权限/只读、来源变化和故障回滚；仅自有 tmpfs MySQL。
- `node scripts/test-native-governance-history-http.js --output <artifacts内全新目录> --test-node-path <专用node_modules>`：真实登录会话、CSRF、原生六类写入口及部门回执隔离；新承接开关关闭时验证原生审核仅登记 pending，不产生草案或发布。候选静态页只用于 API 验证。
- `node scripts/test-native-governance-receipts-browser.js --output <artifacts内全新目录>`：真实 React 组件和 Edge 100%、1699×828 CSS 像素，合成 API 验证原 UUID 查询、冻结载荷、重试和明确确认；不能替代真实 API 集成、人工 IME 或业务验收。具体参数以脚本头部为准。

`test-native-governance-receipts-browser-session.js --dist <artifacts内候选> --output <全新证据目录>` 另验证真实登录壳的跨人员/部门隔离和原身份恢复；默认候选为本批 frontend-build。旧包专项 `test-data-map-handoff-legacy.js --mysql --output <全新证据目录>` 支持另存后续回归结果，避免刷新首批默认结果。

客户端状态规则另由 `frontend/tests/native-governance-request.test.js` 覆盖，随 `npm --prefix frontend test` 运行。候选构建须输出到 artifacts 全新目录，保留现有 frontend/dist。当前增量及证据见[原生历史与请求恢复报告](../../../artifacts/mdm-data-governance-handoff-implementation-20261020-02/implementation-report.md)。

Q10 专项直接运行以下脚本；均使用合成包及自有隔离 MySQL，不修改正式数据库、服务或开关：

- `node scripts/test-data-map-publication-withdrawal-mysql.js <artifacts内全新目录>`：完整清单、原因冻结、产生/复用及后续有效头保护、影响变化与事件完整性。
- `node scripts/test-data-map-withdrawn-reference-mysql.js --output <artifacts内全新目录>`：固定依赖闭包、循环、复用不能恢复撤回版本资格、合法空标识和既有固定正文读取。
- `node scripts/test-data-map-restoration-mysql.js <artifacts内全新目录>`：原包现行/历史、实际新版目标包、明确追加既有草案、逐项采用及调整依据、反向追溯权限、v4/v5 重新批准发布及字段台账需处理状态。
- `node scripts/test-data-map-publication-faults-mysql.js <artifacts内全新目录>`：实际 A/B COMMIT 回执丢失、头更新/恢复事件故障回滚、原 UUID 重试、两种真实图锁等待次序和资格失效。并发新增引用使用调用方事务适配合同，不代替实际导入 HTTP 的全部组合。
- `node scripts/test-data-map-publication-lifecycle-http.js`：自动新建 UUID 证据目录，使用真实登录、CSRF 及发布生命周期 API；静态页仅供 API 进程启动，不证明 Edge 页面办理。

Q6 专项直接运行以下脚本。输出均须为 artifacts 内全新目录；省略时生成本批 UUID 目录，不覆盖旧结果。不读取私有配置，不启动现有服务，不连接正式数据库：

- `node scripts/test-data-map-conflict-mysql.js <全新证据目录>`：实际 v4/v5、普通/重大协调、定向补证和结果后各部门确认、负责人任命 ABA、原 UUID、审核依据变化、旧数据、Q6→Q10 恢复及准确新批准发布。
- `node scripts/test-data-map-conflict-faults-mysql.js <全新证据目录>`：真实 A/B COMMIT 回执丢失、事件故障整体回滚、原 UUID 恢复、批准/发布竞争、锁等待后的分派/授权/负责人变化，以及 assignment/control 优先的确定锁序。
- `node scripts/test-data-map-conflict-http.js <全新证据目录>`：两个自有 tmpfs 实例，真实 session/CSRF、最小定向响应和回执、重大整链及关闭写入口。静态前端只供 API 进程启动，不证明完整页面或人工体验。

Q6 准确结果保留于[冲突协调与事实重核报告](../../../artifacts/mdm-data-governance-handoff-implementation-20261020-04/implementation-report.md)。

旧消费与 Q9 专项均接收 artifacts 内全新输出目录，不读取私有配置、不连接已有实例：

- `node scripts/test-data-map-legacy-consumers-mysql.js <全新证据目录>`：固定源、映射、交接、分析及旧独立映射/Excel 身份，来源升级、开关关闭、实际撤回、未知结构漂移及同连接图锁。
- `node scripts/test-data-map-source-upgrade-mysql.js <全新证据目录>`：主动新版建包及本次审核、完整语义四类差异、逐项沿用与重核、准确新批准发布及历史范围。
- `node scripts/test-data-map-legacy-consumers-http.js <全新证据目录>`：真实会话下旧映射/版本审计、精确大整数身份、Excel 发布固定载荷/下载、越权及摘要损坏拒绝。
- `node scripts/test-data-map-source-upgrade-http.js <全新证据目录>`：真实会话下提示、比较、逐项评估、权限、原 UUID 回执、摘要异常及维护读取。

两项 HTTP 检查只使用自有 API 静态夹具和独占 tmpfs，不能作为完整 Edge 页面或人工业务验收。`test-publications.js --publications-only` 显式只运行解析、发布 API 和新建隔离 MySQL 发布回归，跳过无关流程图依赖探针；默认完整入口仍保留。当前准确执行结果及限制见[旧消费与来源升级报告](../../../artifacts/mdm-data-governance-handoff-implementation-20261020-05/implementation-report.md)。

完整承接工作区的真实 Edge 检查：`node scripts/test-data-map-handoff-workspace-browser.js --frontend-dist <artifacts内已构建候选目录> --output <artifacts内全新证据目录>`。默认 `--scenario all`；分场景名称以脚本白名单为准。使用现有 Edge/Playwright、随机 owner 的 tmpfs MySQL、真实应用会话和 CSRF，只写合成前置材料及实际 UI 操作；结束先关页面/Edge再按 owner 关闭 HTTP/MySQL。不覆盖 frontend/dist，不接正式实例或3001，不开启正式开关。验证限 Edge 100%、1699×828 CSS 像素；截图、几何、请求、控制台和候选构建摘要与结果同目录。用 `node scripts/test-frontend-shell.js --frontend-dist <artifacts内候选目录>` 验证候选路由和公开资产；未提供参数仍检查原 frontend/dist。WASM 仅接受已有 dotlottie 软件渲染文件及有效魔数，反馈 JSON 仅接受 loading/error/success 三类，其他未知公开文件仍拒绝。纯状态/冻结模型随 `npm --prefix frontend test` 执行。实际结果见[前端承接报告](../../../artifacts/mdm-data-governance-handoff-implementation-20261020-06/implementation-report.md)，不能作为人工 IME 或业务验收。

主浏览器检查支持 `--scenario session-race` 单独验证确定延迟旧读取的会话竞争；`protection` 和 `all` 也会先执行此场景。旧响应必须真实取得 200 和滚动 Cookie，证据只记录 Cookie 摘要及会话所属身份，不记录原值，不通过注入 Cookie 或重试登录掩盖问题。工作区夹具显式使用 `startupTimeoutMs=60000` 等待自有 HTTP health 200；共享 stage05 夹具默认仍为 10000ms，提前退出或到期明确失败，未就绪不发送登录。此为测试启动界限，不是正式容量或恢复验收阈值。

兼容页面另用 `node scripts/test-data-map-handoff-workspace-compat-browser.js --frontend-dist <artifacts内候选目录> --output <artifacts内全新目录>`。与主浏览器检查使用同一隔离约束，实际完成旧包接入、逐明细审核、更正与显式 rebase；检查控制状态变化时原输入保留、枚举 0/false 类型保持和准确旧修订只读。只有前置材料、原枚举及本次隔离控制状态由夹具准备，所称办理由真实 UI 执行；不会执行正式迁移。

Q10 结果保留于[整单撤回与恢复报告](../../../artifacts/mdm-data-governance-handoff-implementation-20261020-03/implementation-report.md)，前两批证据按原目录保留。各脚本头说明输入、输出和副作用。`server/dataMapHandoffSchema.js`、`dataMapHandofaNFigration.js` 的隔离 apply 只接受本次 owner 和精确随机隔离库；正式准备使用本说明的独立工具及不可伪造的进程内能力凭证，不在应用启动执行。禁止通过旧 `applyDefinitions` 或旧直接写测试恢复旁路。当前纯 `test:data-map-mysql` 已按明确读取视图和旧写拒绝合同维护，P02 等旧成功直写场景的全面适配及完整 mainline 回归另列实施报告，不宣称已通过。


## 执行边界

- 运行、结构维护及数据写入使用不同入口。`inspect`、`dry-run`及`smoke`名称本身不证明无副作用；先核对脚本加载的配置、目标、连接和写入。
- 当前Docker 3000的启停及恢复按[Docker说明](../DOCKER.md)操作；`service:*`只用于Windows部署副本，不能重启当前Docker容器。仓库共同开发脚本同时涉及PMO、MDM和初始化，不是3000专用发布入口。
- 正式MySQL、备份恢复、迁移、账号维护和发布须取得对应目标授权。配置只核对变量名及脱敏结果，不输出Secret。
- 隔离验证使用脚本自建的唯一owner、临时实例和合成材料，清理只针对该owner；失败证据保留，不能误清理现有数据库、容器或历史资产。
- 需要`--baseline`的对照检查先核对所需源码快照；需要`--output`的检查使用全新且被忽略的artifacts目录。不能用不完整before快照证明兼容。
- 浏览器仅Edge100%、1699×828 CSS像素桌面；事件级组合输入检查不能代替Windows中文输入法人工验收。测试名称保留V7兼容标识时，须检查实际夹具与正文格式。

当前3000已于2026-10-19部署授权依据选填及账号启用提示修复。新建人员及账号、已有人员赋予账号、工号登录、初始密码及首次改密机制保持。当前证据位于`artifacts/3000-optional-role-basis-20261019-01/`：`image-audit.json`和`final-source-verification.json`锁定最终镜像；`isolated-verification-final/results.json`记录17项自有MySQL/API/Edge检查；`runtime-verification.json`记录实际健康、就绪、前端资源及其他服务状态；`data-before.json`、`data-after.json`记录8张身份和角色相关表的只读指纹相同。没有真实开户、授权或启用。`prepare`、`deploy`已完成，不得重放；数据指纹仅证明本次部署窗口，后续用户办理会合法改变数据，不能将历史指纹当长期运行门禁。恢复须另行核对后续角色使用及授权，仅恢复应用，不回退业务数据。当前恢复入口见[Docker说明](../DOCKER.md)。前次已有人员开户证据保留于`artifacts/3000-existing-person-accounts-20261015-01/`，其入口仅对应历史镜像。

## 正式流转开关维护

2026-10-19 17:38当前3000已沿用同一镜像开启`PROCESS_V7_FORMAL_ENABLED=1`，预览保持开启，编制归属及数据治理工作包保持关闭。该操作未修改源码、模型、表结构、数据库权限或人员授权；每个部门最终负责人由用户在前端配置，未登记或有效授权不齐时拒绝最终确认。

本次受控入口及证据位于`artifacts/3000-formal-enable-20261019-01/`，输入为准确的当前镜像、现有连接及用户授权；输出为备份、恢复、开关切换和验证记录。只有deploy涉及3000容器启停及单一开关变更，SQL仅检查和备份，不写业务行。prepare、deploy已完成，不得重放；verify是绑定本次快照的保留性核对，后续正常办理后不能拿旧数据摘要作当前不变断言。日常健康及恢复按[Docker说明](../DOCKER.md#正式流转开启与恢复)执行，不恢复旧dump覆盖后续记录。

## 治理职责迁移与专项验证

部门核对采用独立策略`department-accountability-v1`，与RBAC/RACI模型版本和单流程JSON版本分开。主对接人提交，部门负责人本人核对并最终确认，不设置中间审核员。策略迁移仅更新旧机器角色`department_mdm_reviewer`的中文名称、职责说明及相关权限说明，保留角色标识、人员授权、历史决定、人员及账号；不会自动指定负责人或补授角色。组织最终责任登记与有效同部门角色授权必须同时具备，缺配置时明确阻断办理。

`migrate:department-accountability:inspect/apply/compensate -- --target <host:port/database>`要求显式MySQL环境和匹配目标，不加载私有配置。先完成v4职责迁移，再应用该策略；工作树已支持的后续模型保持原版本。策略快照记录原目录说明及历史决定水位；旧确认保留但须现负责人重新确认。补偿仅限没有新策略办理记录的情况，先补偿部门策略，再补偿职责模型；有使用记录时拒绝自动恢复，不能覆盖数据或直接启动旧代码。

`test:department-accountability`、`test:department-decision-authority`、`test:process-department-accountability`均使用自有临时MySQL与合成人员，分别核对策略迁移及补偿、通用本人决定与有效权限、V7/V8预览及正式确认的历史和并发边界。第三项含随机回环HTTP；具体输出参数以脚本为准，不连接正式库。

部门负责人授权与最终责任登记的专项检查为`node scripts/test-department-head-appointment.js --output <artifacts内全新目录>`，使用自有临时MySQL和合成HTTP身份，覆盖同事务登记、已有有效授权保留、显式交接、并发快照、审计失败回滚、无账号人员及最小列级数据库权限。`node scripts/test-department-head-browser.js --output <artifacts内全新目录> --frontend-dist <本轮构建目录>`在相同隔离边界内使用真实Edge，检查合并入口、未提交输入、错误与交接提示；仅1699×828、100%缩放。候选v4还可加`--require-legacy-person-forms`核对原创建/调部门表单，不能用工作树v5测试结果替代候选v4验证。两项均不连接正式库，不为真实人员授权或任命。

任命变更后的确认有效性由`node scripts/test-department-head-generation.js --output <artifacts内全新目录>`检查，覆盖A→B→A交接、未变更负责人时补登记以及并发决定记录；`test-process-department-accountability-mysql.js`补充V7/V8实际HTTP流转回归。两者均使用自有隔离数据，不改写历史确认或正式人员登记。

v4治理经办角色、案例/工作包分派、案例负责人及正式恢复代码，连同独立部门确认策略，已于2026-10-19部署3000并通过实时验证。运行模型由v3扩展至v4，8角色、20权限、12项RACI活动；本批不包含工作树的HR v5功能。严格身份读取要求代码与模型迁移同批切换，不能只替换程序。迁移保留原七个角色标识与全部人员授权，新增职责、任命事件、案例办理记录和备份表，不自动授予角色、任命人员或改写V8/V7正文。

维护入口要求显式`MYSQL_HOST/PORT/DATABASE/USER/PASSWORD`及匹配的`--target host:port/database`，不加载私有配置。取得目标授权、备份及恢复条件后，先inspect核对依赖、DDL、旧权限和模型基线，再apply并核对ready。本批通过受控发布脚本调用冻结v4的同一迁移函数；`artifacts/3000-governance-responsibilities-20261019-02/`保留完整备份、隔离恢复、数据保留及上线证据。已完成的发布入口不能重放；后续操作以目标当前状态和新授权为准。

`compensate`仅在新增角色没有任何人员授权、职责及办理历史均为空时恢复原模型元数据；保留新增表和备份，不删除历史。已有任何新授权或办理记录则拒绝自动补偿，需要单独恢复方案。维护期间应停止相关业务写入，补偿后切回兼容代码；不能把空表补偿当成在用系统的通用回滚。

`test:governance-responsibilities`只使用自有临时MySQL和合成身份，覆盖v3升级、重复应用、未使用补偿、使用后拒绝补偿、精确任命、并发、资格变化及工作包分派权限。结果输出使用脚本的`--output`约定。

`test:process-formal-recovery`是纯行为测试；`test:process-formal-recovery-mysql -- --output <artifacts内全新目录>`及`test:process-case-disputes -- --output <artifacts内全新目录>`使用自有临时MySQL、随机回环HTTP和合成V8/V7材料。覆盖撤回/退回、当前角色和审核任务绑定、历史决定、并发恢复、争议协调及决定、来源变化、部门重新核对和正式门槛。专属数据库及HTTP在退出时按owner清理，不触碰3000/3001。若使用候选前端或隔离依赖，可分别传`--frontend-dist <artifacts内构建目录>`、`--test-node-path <artifacts内node_modules>`。

`test:governance-case-browser`使用同一类自有MySQL/HTTP夹具和Edge100%、1699×828 CSS像素候选页面，检查任命、办理、争议、正式恢复和输入保留；参数及结果以源脚本为准。它不登录真实人员，不修改正式端口，不能替代中文输入法或业务验收。`test:role-workbench`同时检查聚合仓储收到完整、精确的人员、账号及认证代次，使用随机HTTP和合成仓储，不连接真实数据库。

## 纯静态检查与专项选择

`node scripts/test-optional-role-basis.js --output <artifacts内全新目录>`使用自有临时MySQL核对空依据输入、授权及启用、权限读取、日期和范围门槛、管理员只读及最后角色保护、历史依据保留和重复授权留空不清空；只对自有测试库写入并清理，不连接正式库或启动3000。完整HTTP和Edge路径由本批次冻结镜像隔离验证补充。

`node scripts/test-mainline-stability.js --legacy-smoke-only`只运行主线末段的隔离遗留烟测，不重复前面的聚合检查。该段验证退役组织及人员入口的404边界、旧账号写入的410合同及固定角色模型；不恢复旧接口。它使用临时SQLite和本地测试HTTP，需要可用的原生测试依赖，不连接正式MySQL。

`prepare:organization-rbac -- --input <明确员工原件.xlsx> --output <artifacts内全新目录>`只读用户指定的原件，提取员工编号、姓名、部门、岗位及分别列出的办公室、工区、班组，生成逐人JSON和部门授权准备说明。它不连接数据库，不开户、不授予角色、不更新组织目录，也不修改原件；角色、平台标识和未提供的在职状态保持待确认。仅必要字段含公式或错误时拒绝，序号公式不执行也不影响提取。人员编号重复保留为来源问题，不按姓名合并。

显式人员排除通过`--confirmations <确认记录.json>`提供；该文件须绑定原件SHA-256，每条排除同时匹配工作表、行号、员工编号、姓名并提供明确依据。排除记录和原件问题继续留在准备结果中，不能据此宣布原件已更正。`test:organization-rbac-preparation`使用内存合成工作簿核对编号、组织层级、来源冲突与确认约束，并显式阻断真实MySQL。

`check:native-process-consistency`只检查当前格式门槛、正式预览模块及用户文案，不启动应用、不连接数据库、不读取私有配置或写文件。`test:architecture-seams`显式阻断真实MySQL。`test:v8-transition`检查格式贯通；其结果不表示业务启用。

`test:department-role-requirements`只读部门角色配置，验证两个既有角色引用、固定权限、来源及无人员授权副作用，并显式阻断真实MySQL。`test-rbac-raci-v2-api.js`补充配置接口的登录、只读及失败合同。`test:role-management-browser`使用既有空V7合成夹具，验证当前12个部门、24项角色引用和原角色/历史记录展示；配置不创建其数据库部门、不写人员授权。

`test:department-role-image-browser -- --image <明确部门角色候选镜像> --output <artifacts内全新目录>`在自有UUID MySQL、合成身份及回环随机端口验证实际镜像页面，不启动或连接正式3000。MySQL目标按容器所有权核对，测试应用、数据库在结束时按标签清理。Edge关闭超过5秒时记录单独的关闭说明，完成已通过场景及自有容器清理后结束运行；关闭说明不作为页面、正式服务或业务验收证据。

事务资格与身份精度按[身份与事务合同](../docs/Identity-Transaction-Contract.md)选择B02纯合同或真实隔离MySQL专项。真实锁等待、回滚、并发和prepared复用需要对应运行证据；静态或替身不能代替。旧`legacy-sqlite:*`、V3和承接工具只供明确的历史兼容任务，不恢复退役在线入口。

## 当前npm命令

`node scripts/test-process-content-checks.js`使用合成V8/V7材料验证内容分组、执行角色卡口、范围决定不能绕过缺项、规则不可用、旧v1至v3覆盖和稳定证据位置。不连接数据库、不读取外部业务材料。`test-v7-analysis-rules.js`保留原有八项规则的v3回归；新增v4内容覆盖由此脚本验证。

下表列出实际命令及执行前需核对的副作用类别。类别仅帮助选择，不能代替阅读源脚本；同一命令的环境和参数可能改变作用范围。

| npm run入口 | package.json执行值 | 执行前核对 |
|---|---|---|
| `migrate:department-accountability:inspect` | `node scripts/manage-department-accountability.js --inspect` | 只读明确MySQL目标，须匹配target及环境 |
| `migrate:department-accountability:apply` | `node scripts/manage-department-accountability.js --apply` | 显式策略迁移，须已授权且职责模型先就绪 |
| `migrate:department-accountability:compensate` | `node scripts/manage-department-accountability.js --compensate` | 新策略尚无办理记录时恢复目录元数据，保留备份和表 |
| `test:department-accountability` | `node scripts/test-department-accountability.js` | 自有临时MySQL、合成身份 |
| `test:department-decision-authority` | `node scripts/test-department-decision-authority.js` | 自有临时MySQL、通用决定及权限检查 |
| `test:process-department-accountability` | `node scripts/test-process-department-accountability-mysql.js` | 自有临时MySQL/HTTP、V7/V8与并发边界 |
| `migrate:governance-responsibilities:inspect` | `node scripts/manage-governance-responsibilities.js --inspect` | 只读明确MySQL目标，须传匹配的target及环境 |
| `migrate:governance-responsibilities:apply` | `node scripts/manage-governance-responsibilities.js --apply` | 显式迁移，须目标授权、备份和同批代码切换 |
| `migrate:governance-responsibilities:compensate` | `node scripts/manage-governance-responsibilities.js --compensate` | 仅尚无新增授权与办理历史时补偿模型，保留表 |
| `test:governance-responsibilities` | `node scripts/test-governance-responsibilities.js` | 自有临时MySQL、合成身份，按owner清理 |
| `test:process-formal-recovery` | `node scripts/test-process-formal-recovery.js` | 纯行为及合成仓储 |
| `test:process-formal-recovery-mysql` | `node scripts/test-process-formal-recovery-mysql.js` | 自有临时MySQL/HTTP，须新output目录 |
| `test:process-case-disputes` | `node scripts/test-process-case-disputes.js` | 自有临时MySQL/HTTP，须新output目录 |
| `test:governance-case-browser` | `node scripts/test-governance-case-browser.js` | 自有临时MySQL/HTTP及Edge桌面候选验证 |
| `test:architecture-seams` | `node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-architecture-seams.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:native-office-versions` | `node scripts/test-native-office-versions.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `check:native-process-consistency` | `node scripts/check-native-process-consistency.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:v8-transition` | `node scripts/check-native-process-consistency.js && node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-v8-transition.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:v8-integration` | `node scripts/test-p25-candidate-integration.js --native-v8` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `manage:system-admin` | `node scripts/manage-system-admin.js` | 按源脚本核对读取、生成或维护副作用 |
| `bootstrap:system-admin` | `node scripts/bootstrap-system-admin.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:system-admin` | `node scripts/test-system-admin.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `manage:process-v7-authoring` | `node scripts/manage-process-v7-authoring.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:process-v7-authoring` | `node scripts/test-process-v7-authoring.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-v7-authoring-issues` | `node scripts/test-process-v7-authoring-issues.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:upgrade-integration` | `node scripts/test-analysis-runs.js --p24 --p13 --p14 --p16 --p17 --p15` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:p25-candidate-integration` | `node scripts/test-p25-candidate-integration.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:issue-pool-list-scope` | `node scripts/test-issue-pool-list-scope.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `import:historical-review` | `node scripts/import-historical-review.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:historical-review` | `node scripts/test-historical-review.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:role-guide-browser` | `node scripts/test-role-guide-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:publications-browser` | `node scripts/test-publications-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:data-map-create-browser` | `node scripts/test-data-map-create-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:field-import-browser` | `node scripts/test-field-import-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:legacy-import-concurrency` | `node scripts/test-legacy-import-concurrency.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:field-identity-browser` | `node scripts/test-field-identity-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:field-export-browser` | `node scripts/test-field-export-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:native-diagrams-browser` | `node scripts/test-native-diagrams-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:data-map-read-browser` | `node scripts/test-data-map-read-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:quality-browser` | `node scripts/test-quality-browser.js` | 必须显式传candidate-root、frontend-dist和全新output，均在artifacts；自有MySQL及真实Edge验证现行受控/旧资料分列、部门范围、失败和迟到结果，不mock计数 |
| `test:identity-directory-browser` | `node scripts/test-identity-directory-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:role-management-browser` | `node scripts/test-role-management-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:dashboard-browser` | `node scripts/test-dashboard-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:office-workbench-browser` | `node scripts/test-office-workbench-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:data-governance-browser` | `node scripts/test-data-governance-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:role-workbench-browser` | `node scripts/test-role-workbench-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:process-formal-browser` | `node scripts/test-process-formal-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:process-preview-browser` | `node scripts/test-process-preview-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:ai-offline` | `node --test scripts/test-ai-offline.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:ai-offline-integration` | `node scripts/test-analysis-runs.js --p19 --p14` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `manage:analysis-ai` | `node scripts/manage-analysis-ai.js` | 按源脚本核对读取、生成或维护副作用 |
| `manage:analysis-closure` | `node scripts/manage-analysis-closure.js` | 按源脚本核对读取、生成或维护副作用 |
| `manage:analysis-tasks` | `node scripts/manage-analysis-tasks.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:analysis-tasks` | `node scripts/test-analysis-runs.js --p17` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-api` | `node scripts/test-analysis-runs.js --p14` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-workbench` | `node scripts/test-analysis-runs.js --p14 --p15` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:handoff-analysis-rules` | `node scripts/test-handoff-analysis-rules.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:handoff-analysis` | `node scripts/test-design-handoffs.js --p12` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:fixed-handoff-set` | `node scripts/test-fixed-handoff-set.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:v7-analysis-rules` | `node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-v7-analysis-rules.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:v7-analysis-worker` | `node scripts/test-v7-analysis-worker.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-format-admission` | `node scripts/test-analysis-format-admission.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-worker` | `node scripts/test-analysis-worker.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-dependency-readiness` | `node scripts/test-analysis-dependency-readiness.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:analysis-queue` | `node scripts/manage-analysis-queue.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `analysis:worker` | `node scripts/analysis-worker.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:data-map-management` | `node scripts/test-data-map-management.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:data-map-facts` | `node scripts/test-data-map-facts.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:data-map-facts` | `node scripts/manage-data-map-facts.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:master-data-template-import` | `node scripts/test-master-data-template-import.js` | 历史直接确认合同；当前受控页面不执行。核对预览和旧结果查阅取第四批独立页面证据，不将旧写场景计作通过 |
| `preview:master-data-template` | `node scripts/preview-master-data-template.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:master-data-template` | `node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-master-data-template.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:data-map-definitions:inspect` | `node scripts/manage-data-map-definitions.js --inspect` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:data-map-definitions:dry-run` | `node scripts/manage-data-map-definitions.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:data-map-definitions:apply` | `node scripts/manage-data-map-definitions.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:data-map-definitions-mysql` | `node scripts/test-data-map-definitions-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:object-identity-preview` | `node scripts/test-object-identity-preview.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:data-map-legacy-compatibility` | `node scripts/manage-data-map-legacy-compatibility.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:data-map-legacy-compatibility` | `node scripts/test-data-map-legacy-compatibility.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `build:frontend` | `npm --prefix frontend run build` | 按源脚本核对读取、生成或维护副作用 |
| `dev:frontend` | `npm --prefix frontend run dev` | 按源脚本核对读取、生成或维护副作用 |
| `test:terms-conflicts-browser` | `node scripts/test-terms-conflicts-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:todo-inbox-browser` | `node scripts/test-todo-inbox-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:frontend-shell` | `npm --prefix frontend test && node scripts/test-frontend-shell.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:frontend-shell-browser` | `node scripts/test-frontend-shell-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:retired-capabilities` | `node scripts/test-retired-capabilities.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-data-governance-mysql` | `node scripts/test-process-data-governance-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:offices:inspect` | `node scripts/manage-offices.js --inspect` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:offices:apply` | `node scripts/manage-offices.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:offices` | `node scripts/test-offices.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:publications:inspect` | `node scripts/manage-publications.js --inspect` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:publications:apply` | `node scripts/manage-publications.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:publications` | `node scripts/test-publications.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `prepare:launch-stage06` | `node scripts/inspect-launch-stage06.js --prepare` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `inspect:launch-stage06` | `node scripts/inspect-launch-stage06.js --inspect` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:stage06-preflight` | `node scripts/test-stage06-preflight.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:stage06-mysql-isolated` | `node scripts/test-stage06-mysql-isolated.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `start` | `node server/index.js` | 运行操作；核对目标与启停授权 |
| `bootstrap:admin` | `node scripts/bootstrap-admin.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `legacy-sqlite:smoke` | `node scripts/smoke-test.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:legacy-sqlite-entrypoints` | `node scripts/test-legacy-sqlite-entrypoints.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:org` | `node scripts/test-org-route.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:mappings` | `npm run test:mappings-mysql` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:conflicts` | `npm run test:conflicts-mysql` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:terms` | `npm run test:terminology-mysql` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:export` | `node scripts/test-export-route.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:import` | `node scripts/test-import-route.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:route-write-audit` | `node scripts/test-route-write-audit.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:user-password-scripts` | `node scripts/test-user-password-scripts.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:password-audit` | `node scripts/test-password-audit.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:security` | `node scripts/test-stage04-local.js --security` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:project-roles` | `node scripts/test-project-role-access.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:role-workbench` | `node scripts/test-role-workbench-api.js && node scripts/test-workbench-governance-actor.js` | 随机HTTP和合成仓储，核对聚合完整身份与固定角色 |
| `test:activity` | `npm run test:activity-mysql && node scripts/test-activity-heatmap-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:data-map-mysql` | `node scripts/test-data-map-mysql-repository.js && node scripts/test-data-map-contexts-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:field-entries-mysql` | `node scripts/test-field-entries-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:field-identities-mysql` | `node scripts/test-field-identities-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:data-map-import-export-mysql` | `node scripts/test-data-map-import-export-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:terminology-mysql` | `node scripts/test-terminology-mysql-repository.js && node scripts/test-terminology-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:mappings-mysql` | `node scripts/test-mappings-mysql-repository.js && node scripts/test-mappings-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:conflicts-mysql` | `node scripts/test-conflicts-mysql-repository.js && node scripts/test-conflicts-mysql-api.js && node scripts/test-check-escalations-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:todos-mysql` | `node scripts/test-todos-mysql-repository.js && node scripts/test-todos-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:versions-mysql` | `node scripts/test-versions-mysql-repository.js && node scripts/test-versions-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:activity-mysql` | `node scripts/test-activity-mysql-repository.js && node scripts/test-activity-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:field-entries-mysql-identity` | `node scripts/test-field-entries-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:field-identities-mysql-identity` | `node scripts/test-field-identities-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:conflicts-mysql-identity` | `node scripts/test-conflicts-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:mappings-mysql-identity` | `node scripts/test-mappings-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:terminology-mysql-identity` | `node scripts/test-terminology-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:role-workbench-mysql` | `node scripts/test-role-workbench-mysql-api.js && node scripts/test-role-workbench-process-governance-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:page-workflows` | `node scripts/test-page-workflows-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:frontend` | `node scripts/test-frontend-assets.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:rbac` | `node scripts/smoke-rbac.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:delete` | `node scripts/test-delete-routes.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:db-path` | `node scripts/test-db-path-isolation.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `legacy-sqlite:setup-local-baseline` | `node scripts/setup-local-baseline.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:local-baseline` | `node scripts/test-local-baseline-setup.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `legacy-sqlite:sync-organization-structure` | `node scripts/sync-organization-structure.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:organization-structure` | `node scripts/test-organization-structure-sync.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:roster-import` | `node scripts/test-roster-users-import.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-schema` | `node scripts/test-process-governance-schema.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-org` | `node scripts/test-process-governance-org-sync.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `import:process-governance-mysql` | `node scripts/import-process-governance-mysql.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `import:process-input-baseline-review` | `node scripts/import-process-input-baseline-review-mysql.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `smoke:process-governance-mysql` | `node scripts/smoke-process-governance-mysql.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:process-import` | `node scripts/test-process-governance-import.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-quality-import` | `node scripts/test-process-governance-quality-import.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-mapping-workspace` | `node scripts/test-process-mapping-workspace-import.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-api` | `node scripts/test-process-governance-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-mysql` | `node scripts/test-process-governance-mysql-repository.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-mysql-import` | `node scripts/test-process-governance-mysql-import.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-mysql-smoke` | `node scripts/test-process-governance-mysql-smoke.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-sankey-mysql-api` | `node scripts/test-process-governance-sankey-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-mysql-identity` | `node scripts/test-process-governance-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-input-baseline-review-mysql` | `node scripts/test-process-input-baseline-review-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-input-baseline-review-api` | `node scripts/test-process-input-baseline-review-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-issue-pool` | `node scripts/test-process-governance-issue-pool-mysql-source-resolution.js && node scripts/test-process-governance-issue-pool-mysql-permission-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-identity-rbac` | `node scripts/test-person-identity-schema-contract.js && node scripts/test-person-identity-mysql-repository.js && node scripts/test-governance-guidance-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-rbac-matrix` | `node scripts/test-person-rbac-matrix-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-identity-payload` | `node scripts/test-person-identity-payload-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:department-responsibility` | `node scripts/test-department-responsibility-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-business-writes` | `node scripts/test-person-business-writes-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:no-new-user-identity-fields` | `node scripts/test-no-new-user-identity-fields.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:legacy-identity-inventory` | `node scripts/test-legacy-identity-inventory.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:guidance-workflow` | `node scripts/test-guidance-workflow-mysql-api.js && node scripts/test-guidance-affordances-mysql-repository.js && node scripts/test-guidance-visibility-mysql-repository.js && node scripts/test-guidance-person-validation-mysql-repository.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:guidance-workspace` | `node scripts/test-guidance-workspace-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-identity-migration-rehearsal` | `node scripts/test-person-identity-migration-rehearsal-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `repair:person-identity-mysql` | `node scripts/repair-person-identity-mysql.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:person-identity-live-schema` | `node scripts/test-person-identity-live-schema-contract.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:admin-permission-mysql` | `node scripts/test-admin-permission-mysql-contract.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-identity-rbac-completion` | `npm run test:person-identity-rbac && npm run test:person-rbac-matrix && npm run test:person-identity-payload && npm run test:department-responsibility && npm run test:no-new-user-identity-fields && npm run test:guidance-workflow` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:identity-mysql` | `node scripts/test-identity-mysql-repository.js && node scripts/test-org-me-mysql-api.js && node scripts/test-roles-mysql-api.js && node scripts/test-auth-mysql-permission.js && npm run test:access-mysql && node scripts/test-import-rbac-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:auth-mysql` | `node scripts/test-auth-mysql-permission.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:access-mysql` | `node scripts/test-access-mysql-role-codes.js && node scripts/test-access-mysql-permissions.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:import-rbac-mysql` | `node scripts/test-import-rbac-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:roles-mysql` | `node scripts/test-roles-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:rbac-raci-v2:dry-run` | `node scripts/migrate-rbac-raci-v2.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:rbac-raci-v2:apply` | `node scripts/migrate-rbac-raci-v2.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:rbac-raci-v2:rollback` | `node scripts/migrate-rbac-raci-v2.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:rbac-raci-v2:compensate` | `node scripts/migrate-rbac-raci-v2.js --compensate` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:rbac-raci-v2` | `node scripts/test-rbac-raci-v2-model.js && node scripts/test-rbac-raci-v2-api.js && node scripts/test-rbac-raci-v2-migration-contract.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:process-governance-unified:dry-run` | `node scripts/migrate-process-governance-unified.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-unified:apply` | `node scripts/migrate-process-governance-unified.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-unified:rollback` | `node scripts/migrate-process-governance-unified.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-unified:compensate` | `node scripts/migrate-process-governance-unified.js --compensate` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-v3:dry-run` | `node scripts/migrate-process-governance-v3.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-v3:apply` | `node scripts/migrate-process-governance-v3.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-v3:rollback` | `node scripts/migrate-process-governance-v3.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:process-governance-v3-migration` | `node scripts/test-process-governance-v3-migration-contract.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:process-v7-preview:dry-run` | `node scripts/migrate-process-v7-preview-review.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-v7-preview:apply` | `node scripts/migrate-process-v7-preview-review.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-v7-preview:rollback` | `node scripts/migrate-process-v7-preview-review.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-v7-formal:dry-run` | `node scripts/migrate-process-v7-formal-foundation.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-v7-formal:apply` | `node scripts/migrate-process-v7-formal-foundation.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-v7-formal:rollback` | `node scripts/migrate-process-v7-formal-foundation.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `inspect:process-v7-m0` | `node scripts/inspect-process-v7-m0-baseline.js` | 按源脚本核对读取、生成或维护副作用 |
| `rehearse:process-v7-m0-backup-restore` | `node scripts/rehearse-process-v7-m0-backup-restore.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `rehearse:process-v7-migrations-isolated` | `node scripts/rehearse-process-v7-migrations-isolated.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:process-v7-preview-review` | `node scripts/test-process-v7-preview-review.js && node scripts/test-process-v7-preview-migration-contract.js && node scripts/test-process-v7-formal-migration-contract.js && node scripts/test-process-v7-m0-baseline.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-v7-procedure` | `node scripts/test-process-v7-procedure-markdown.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:process-data-governance:dry-run` | `node scripts/migrate-process-data-governance.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-data-governance:apply` | `node scripts/migrate-process-data-governance.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-data-governance:rollback` | `node scripts/migrate-process-data-governance.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:process-data-governance` | `node scripts/test-process-data-governance.js && node scripts/test-process-data-governance-api.js && node scripts/test-process-data-governance-migration-contract.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-design` | `npm run test:retired-capabilities && npm run test:process-v7-preview-review && npm run test:process-v7-procedure` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-design-mysql-api` | `npm run test:retired-capabilities && npm run test:stage05-mysql-isolated` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `migrate:cross-dept-handoff-v2:dry-run` | `node scripts/migrate-cross-dept-handoff-v2.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:cross-dept-handoff-v2:apply` | `node scripts/migrate-cross-dept-handoff-v2.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:cross-dept-handoff-v2:compensate` | `node scripts/migrate-cross-dept-handoff-v2.js --compensate` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:process-field-links` | `node scripts/test-process-governance-field-links.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `perf:local-concurrency` | `node scripts/perf-local-concurrency.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:process-governance` | `node scripts/test-process-governance-mysql-repository.js && node scripts/test-process-governance-mysql-import.js && node scripts/test-process-governance-mysql-smoke.js && node scripts/test-process-governance-sankey-mysql-api.js && node scripts/test-process-governance-mysql-identity-api.js && node scripts/test-process-input-baseline-review-mysql.js && node scripts/test-process-input-baseline-review-api.js && npm run test:process-design && node scripts/test-process-governance-field-links.js && npm run test:process-governance-issue-pool` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:mainline` | `node scripts/test-organization-structure-sync.js && npm run test:rbac-raci-v2 && node scripts/test-role-workbench-api.js && node scripts/test-role-workbench-mysql-api.js && node scripts/test-role-workbench-process-governance-mysql-api.js && node scripts/test-identity-mysql-repository.js && node scripts/test-org-me-mysql-api.js && node scripts/test-roles-mysql-api.js && node scripts/test-auth-mysql-permission.js && npm run test:access-mysql && node scripts/test-import-rbac-mysql-api.js && npm run test:data-map-mysql && npm run test:field-entries-mysql && npm run test:field-identities-mysql && npm run test:field-entries-mysql-identity && npm run test:field-identities-mysql-identity && npm run test:data-map-import-export-mysql && npm run test:terminology-mysql && npm run test:mappings-mysql && npm run test:conflicts-mysql && npm run test:todos-mysql && npm run test:versions-mysql && npm run test:activity-mysql && npm run test:process-governance-mysql-identity && npm run test:conflicts-mysql-identity && npm run test:mappings-mysql-identity && npm run test:terminology-mysql-identity && node scripts/test-mainline-stability.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `init:mysql` | `node scripts/init-mysql-schema.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `smoke:data-map-mysql` | `node scripts/smoke-data-map-mysql.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:mysql-runtime-boundary` | `node scripts/test-mysql-runtime-boundary.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:mysql-config` | `node scripts/test-mysql-config.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `dev` | `nodemon server/index.js` | 运行操作；核对目标与启停授权 |
| `service:start` | `node scripts/mdm-service.js start` | 运行操作；核对目标与启停授权 |
| `service:stop` | `node scripts/mdm-service.js stop` | 运行操作；核对目标与启停授权 |
| `service:restart` | `node scripts/mdm-service.js restart` | 运行操作；核对目标与启停授权 |
| `service:check` | `node scripts/mdm-service.js check` | 只读核对自有Windows3000进程、健康、就绪、摘要和当前`/app/`内容；当前Docker按DOCKER.md检查 |
| `service:supervise` | `node scripts/mdm-service.js --supervise` | 运行操作；核对目标与启停授权 |
| `migrate:sessions:inspect` | `node scripts/manage-sessions.js --inspect` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:sessions:apply` | `node scripts/manage-sessions.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:sessions:rollback` | `node scripts/manage-sessions.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `cleanup:sessions:inspect` | `node scripts/manage-sessions.js --cleanup --inspect` | 按源脚本核对读取、生成或维护副作用 |
| `cleanup:sessions:apply` | `node scripts/manage-sessions.js --cleanup --apply` | 按源脚本核对读取、生成或维护副作用 |
| `test:stage03-runtime` | `node scripts/test-stage03-runtime.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:stage03-mysql-isolated` | `node scripts/test-stage03-mysql-isolated.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:stage03-service` | `node scripts/test-stage03-service.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:launch-stage04` | `node scripts/test-stage04-local.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:stage04-mysql-isolated` | `node scripts/test-stage04-mysql-isolated.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:launch-stage05` | `node scripts/test-stage05-local.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:stage05-mysql-isolated` | `node scripts/test-stage05-mysql-isolated.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `migrate:v7-mappings` | `node scripts/manage-v7-mappings.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:v7-mappings` | `node scripts/test-v7-mappings.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:design-handoffs` | `node scripts/manage-design-handoffs.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:design-handoffs` | `node scripts/test-design-handoffs.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:analysis-runs` | `node scripts/manage-analysis-runs.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:analysis-comparison` | `node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-analysis-comparison.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-comparison-mysql` | `node scripts/test-analysis-runs.js --p13` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-runs` | `node scripts/test-analysis-runs.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `manage:analysis-issues` | `node scripts/manage-analysis-issues.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:analysis-issues` | `node scripts/test-analysis-runs.js --p16` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:word-evidence` | `node scripts/test-word-evidence.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:excel-evidence` | `node scripts/test-excel-evidence.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:excel-evidence-integration` | `node scripts/test-analysis-runs.js --p18` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `manage:excel-evidence` | `node scripts/manage-excel-evidence.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:word-evidence-integration` | `node scripts/test-analysis-runs.js --p18-word` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `manage:word-evidence` | `node scripts/manage-word-evidence.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:pdf-evidence` | `node scripts/test-pdf-evidence.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:pdf-evidence-integration` | `node scripts/test-analysis-runs.js --p18-pdf` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `manage:pdf-evidence` | `node scripts/manage-pdf-evidence.js` | 按源脚本核对读取、生成或维护副作用 |

## 组织与员工目录专项

本组实现与接口范围见[组织与员工目录](../DIRECTORY_API.md)。本次可用入口如下；验证只使用合成数据，正式迁移不能从测试通过推定已执行。

| 命令 | 输入、输出及副作用 |
|---|---|
| `migrate:hr-directory-role:inspect` / `:dry-run` | 显式`MYSQL_*`及`--target host:port/database`；只读预检角色、权限及表结构，不读人员明细、不写库 |
| `migrate:hr-directory-role:apply` | 同一明确目标及独立可恢复备份；显式v4→v5，准备分组约束、角色、权限、备份和迁移记录，保留原角色ID及人员授权，不自动给人授权 |
| `migrate:hr-directory-role:compensate` | 仅新角色从未产生任何历史人员授权时恢复原模型；保留新增表、权限及兼容分组约束，不删除业务数据。提交结果不明时先inspect |
| `test:hr-directory-role` | 自有tmpfs随机MySQL，验证v4→v5、漂移拒绝、回滚、幂等、补偿及新角色权限，按所有权清理 |
| `test:directory-contract` | 阻止真实MySQL的纯函数、SQL替身和随机回环HTTP；验证目录字段、账号边界、HTTP权限及服务凭证基础读取 |
| `test:directory-mysql` | 自有tmpfs随机MySQL；验证稳定标识、目录保存与审计、并发撤权、事务回滚、旧目录导入和权限隔离 |
| `test:directory-browser -- --dist <候选构建> --output <全新证据目录>` | 两路径均位于仓库`artifacts/`；合成HTTP及Edge 100%、1699×828，写截图与结果，不连接数据库 |

目录导入临时核对采用`directory-publication-source-v2`，精确标识变化会使旧核对失效；已发布原文、摘要及旧成功请求回执保持。单条维护使用原`snapshot_hash`，一般主数据导入不改变。纯合同检查可运行`node --require ./scripts/testHelpers/blockRealMysql.js --test scripts/test-directory-source-hash-contract.js`，禁止真实MySQL；真实隔离的`test-b02-directory-office-mysql.js`同时核对旧投影保留、精确新摘要、旧未提交核对拒绝及旧成功请求核实。

需要`--baseline`的B02读取及维护检查必须使用本轮修改前的完整准确文件，来源和摘要单列保存；本轮before与旧历史缺陷快照分别标明。`test-b02-publication-target-authority-mysql.js --baseline-current`以当前HR v5 before对照，要求两侧均有合法HR身份并保留实际锁等待和安全拒绝；不加该参数仍用于真正的修复前历史快照，不得混用。各输出目录须为全新`artifacts/`子目录。

`test-system-admin.js`的浏览器部分使用当前`/app/`首次改密和身份页面，检查门禁、当前账号、失败输入、会话失效及重新登录；不恢复已退役页面。`testHelpers/prepareReviewFoundation.js`只在调用方自有临时库明确准备当前案例治理前提。办公室兼容检查使用`testHelpers/officePublishedSource.js`建立明确的合成固定来源，验证办公室迁移、成员、分派、失权和记录保留，不用旧共享场景代替现行完整审核发布验证。本批命令、失败复核及结果见[第三批本地证据](../../../artifacts/3000-batch3-hr-v5-20261021-184725/README.md)。

v3目标先按既有治理职责迁移准备v4，再执行人事角色迁移。命令本身不加载私有配置、不启动服务、不创建真实接入凭证。系统间读取启用变量、版本字段及错误码见接口说明。

## 参数与恢复说明

运行和结构维护具体变量、目标参数及恢复步骤见[运行与结构维护](../docs/Current-Runtime-Maintenance.md)及对应迁移手册。该说明包括办公室、发布目录与历史评审导入；不将迁移登记、就绪探测或软件包准备写成业务开启。

## 历史追溯

原脚本说明中每项测试的阶段场景、before要求、运行结果和失败记录保留在[历史快照](../../../docs/archives/2026-10-09-leaf-docs/apps/mdm-platform/scripts/README.md.before.txt)。需要还原一次特定验证时读取相应条目；当前命令名称及执行值以本文件和源脚本为准。

## 本轮新增脚本（未注册 npm 入口）

`test-csp-browser.js --dist <artifacts内候选构建> --output <artifacts下全新目录>`在Edge100%、1699×828验证唯一页面入口、首次及本人改密、拒绝时输入保护、重登、导航和CSP；使用合成API，不连接数据库、不修改真实密码。Worker/WASM许可按精确指令项核对，仍阻断内联脚本和JS eval。

### 桌面表现层候选构建与验证

构建必须从 `frontend/` 使用 `npm.cmd run build -- --outDir <仓库artifacts/mdm-tech-ui下的新目录>/build --manifest`，先核对目录为新目录。本地候选任务禁止使用默认 `build:frontend` 覆盖运行中的 `frontend/dist`。不需要启动、停止或替换3000。Vite开发仍要求显式隔离后端、127.0.0.1和非业务端口。

以下脚本直接使用node，不增加npm入口。所有证据目录要求全新、位于仓库artifacts；浏览器均为Edge100%、1699×828 CSS像素，没有窄屏检查。

| 脚本 | 输入与验证 | IO边界 |
|---|---|---|
| `test-tech-ui-browser.js` | `--dist <候选> --output <新目录>`；可加 `--pilot` 只验证首批Worker；默认核对当前全部协议页、焦点、CSP、减少/暂停及20次SPA切换 | 合成API、随机回环HTTP，无数据库 |
| `test-tech-ui-resilience-browser.js` | `--dist <候选> --baseline <原候选> --output <新目录>`；Worker/WASM/OffscreenCanvas失败及两构建各5秒预热、30秒性能轨迹 | 合成API、无数据库；估计帧率不代替指定硬件或GPU呈现 |
| `test-tech-ui-controls-browser.js` | `--dist <候选> --output <新目录>`；实际Worker WebGL上下文丢失，延迟rAF模拟连续降档 | 仅自有浏览器；降档负载为显式模拟 |
| `test-tech-ui-candidate-suite.js` | `--dist <候选> --test-node-path <artifacts内测试依赖node_modules> --output <新目录>`；可用 `--tests <逗号分隔脚本名>` 选择相关子集；选连续链路时加 `--native-v8` | 串行调用当前业务浏览器专项；自有标记tmpfs MySQL和合成数据，不读私有配置 |
| `collect-tech-ui-evidence.js` | `--run <本次证据目录>`；生成实际页面/子组件操作清单、构建SHA及首屏gzip比较，保护合同文件哈希 | 只读前端源码和指定artifacts内构建；写本次技术证据 |

业务浏览器专项复用 `withStage05Fixture`：传 `--frontend-dist <artifacts内候选>` 后仅测试子进程预加载候选静态目录；正式服务不读取该参数。必要的测试依赖可精确安装至新的artifacts测试运行目录，并显式传 `--test-node-path`；主测试进程的 `NODE_PATH` 仅指向平台本地依赖及该测试目录，不安装或改动3001依赖。`--complete-source` 只为合成正常办理基线补齐编制人、发起部门和明确动作名称，不修改上传真实资料，也不降低服务端校验。

可用 `node --require ./scripts/testHelpers/ownedBrowserRuntime.js scripts/<目标浏览器专项> ...` 对本次创建的Edge实施有界关闭；浏览器归属写入证据。候选预加载不在解析/分析Worker中加载Express，以免继承Node预加载参数后破坏原Worker资源预算。

当前交付目录为 `artifacts/mdm-tech-ui/20261014-desktop-01/`，候选为 `complete/build/`，最终表现层、CSP、控制与性能证据分别位于 `complete/` 下；覆盖清单与业务证据文件名见设计和性能报告。收集器的该批次默认输入目录名由脚本显式列出；新批次可复用对应结构，不得把不匹配构建和证据混为本次通过。

以下脚本随 R01–R13 本地整改加入，**没有**写入 `package.json`（新增 npm 入口需要单独授权），一律用 `node scripts/<名称>` 直接调用。需要隔离 MySQL 或浏览器的脚本还要求 `--output` 指向 `artifacts/` 下的全新目录。

| 脚本 | 作用 | 依赖 |
|---|---|---|
| `test-b02-login-identity-boundary.js` | 登录的精确身份边界：大整数保真、不可表示的身份拒绝登录 | 无（替身仓储） |
| `test-versions-scope-contract.js` | 历史读取范围：全局／同部门／异部门／无权限／管理员／已删除对象六类组合 | 无（替身仓储） |
| `test-versions-scope-mysql.js` | 同上，真实隔离库；并断言未删除任何历史行 | 隔离 MySQL |
| `test-login-admission-contract.js` | 登录准入：空白及大小写变体、并发成功与计数、容量拒绝、过期回收、在途释放 | 无 |
| `test-http-error-contract.js` | 请求错误契约：400/413/415 分类、analysis 既有码保留、凭据闸门 | 无 |
| `test-security-log-contract.js` | 安全日志字段及标量白名单、嵌套敏感对象拦截、sink 失败不影响业务 | 无 |
| `test-security-log-http.js` | 关联号可追溯、事件分类、日志故障不改变响应 | 无 |
| `audit-security-log-hygiene.js` | 静态守卫：不得再直接打印驱动错误或把异常文本写进日志 | 无 |
| `test-mysql-resource-budget-contract.js` | 池预算、登记簿、幂等关闭、提交不明语义；并静态断言无裸 `createPool` | 无 |
| `test-mysql-resource-budget-mysql.js` | 实际池查询超时、池耗尽、锁等待、数据库暂停、提交回执丢失、排空 | 隔离 MySQL（黑洞用例会 `docker pause` 自有容器） |
| `test-shutdown-drain-mysql.js` | 真实服务进程按普通路径停止并排空领域池 | 隔离 MySQL |
| `test-legacy-import-parser.js` | 旧字段台账解析：预算、损坏压缩包、并发门禁、取消 | 无 |
| `test-export-budget-contract.js` | 导出行数与并发预算、中断后不再二次发送 | 无 |
| `test-backend-resource-regressions.js` | 实际池执行、事务超时及迟到提交、回滚预算、取消等待、排空失败、导出计时、worker取消及精确身份投影 | 无，强制阻断真实MySQL |
| `test-export-read-regressions.js` | 仓储SQL行数预算、精确部门标识、字段与黄金源投影、断连后停止读取 | 无，强制阻断真实MySQL |
| `test-analysis-visible-page-contract.js` | 可见分页的行数及实际等待预算、游标语义、最终解析超时 | 无 |
| `test-csp-policy-contract.js` | 内容安全策略回归；LF/CRLF/CR 换行一致、真实脚本变化、缺失/额外脚本，以及事件属性引号形式的 CLI 正负例 | 无 |
| `audit-inline-script-inventory.js` | 当前前端源码及构建的脚本与事件处理器检查；不允许内联脚本、内联事件和旧UI专用哈希 | 无 |

## 3000 内部承接集成验证

- `node scripts/test-joint-terminology-handoff-http.js --output <new artifacts output>`：全新隔离 MySQL、真实术语与承接 HTTP、四个开关同时开启及关闭/只读/prepared 对照；实际数据库最小 INSERT/UPDATE，合成会话入口。`--candidate-root <artifacts内完整候选应用>` 校验候选源码组合；`--role-model-root <artifacts内候选应用>` 只用于以该候选的准确 v4/v5 定义加载当前实现。输出实际已加载源码摘要，不替代登录、人工或业务验收。
- `node scripts/test-data-map-schema-concurrency-mysql.js <new artifacts output> [<artifacts内优化前dataMapHandoffSchema.js>]`：只创建自有 MySQL，验证全部表 MDL、DDL/迁移标记真实等待、graph 等待期间结构不漂移、CHECK/排序规则/缺表失败关闭及来源升级引用完整性。可选优化前源码用于同库 SQL 次数和耗时对比；相邻 `dataMapSourceUpgrade.before.js` 用于千条冻结历史等价对比。不是十人正式容量验收入口。
- `node scripts/prepare-governance-runtime-grants.js --root <candidate app> --output <new artifacts JSON>`：只读 AST 盘点术语、数据、案例及正式流程运行写表，区分初始化迁移与维护切换审计。计划列出所需表级 INSERT/UPDATE 及身份锚点锁列，必须与目标已有授权求最小差集；不运行 GRANT，不分配人员角色，不给不可变案例表 UPDATE 或任何 DDL/DELETE。

授权计划可加 `--grant-baseline <已核验target-preflight.json> --target-inventory <原表指纹JSON>` 生成同一账号的实际最小差集与待审 SQL。默认 `PROCESS_V7_AUTHORING_ENABLED=0`，不增加未启用编制记录写权限；如另批明确启用，须以 `--authoring-enabled` 重新审阅。控制表只请求 `UPDATE(graph_revision,next_definition_version_id)`，不请求状态、切换时点或契约列。已有列级授权不会升级为整表；无法确定剩余列的表级需求会拒绝自动求差。

本批正式准备、授予及切换分别使用任务 artifacts 中的 `prepare-final.cjs`、`grant-final.cjs` 与受控切换入口。`grant-final.cjs inspect <candidate>` 要求准确准备回执、固定源/镜像、原目标与停写；`apply <candidate> --authorize-reviewed-grants --plan-sha256 <已审计划文件摘要>` 再显式绑定计划。每条 GRANT 前后核对实际权限并追加哈希链回执；部分已提交而回复丢失，只按同一计划和准确已观测权限续跑。全库业务字段指纹须与 prepared 一致。GRANT 不作事务回滚承诺；工具拒绝计划外权限、DDL/DELETE、人员角色和列级范围扩大。正式执行由已授权维护流程负责，隔离试验不能代替正式回执。

`testHelpers/ownedCandidateRuntime.js` 是测试预加载器：通过显式 `MDM_TEST_CANDIDATE_ROOT` 读取 artifacts 中候选 server/shared，输出实际加载源码摘要。全应用 HTTP 夹具相应从候选 `index.js` 启动，自有数据库及真实登录/CSRF边界不变。候选源码目录缺安装包时，测试用解析 worker 仅配置既有依赖搜索路径，不加载 Express 或私有环境。最终 v4 候选使用 `test-data-map-handoff-http.js --preserve-directory-baseline` 时只排除本版明确不部署的新增 HR 维护两项，其余地图入口逐项执行。

- `node scripts/test-data-map-handoff-work-items.js`：纯投影资格/精确定位合同，不连库。
- `node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-data-map-fact-source-presentation.js`：事实来源的纯只读投影合同，覆盖准确固定名、原审核/问题创建时父快照、缺失/重复、跨包和内容漂移；模拟连接不读取任何数据库。真实最小范围、部门越权、角色办理、升级发布和撤回恢复使用[本批隔离场景](../../../artifacts/3000-source-lifecycle-20261023003100/harness/README.md)，仅新建有归属的MySQL、HTTP及Edge，不能向已有预览或正式库重放。
- `node scripts/test-data-map-handoff-workbench-mysql.js <new artifacts output>`：全新 owner 标记 tmpfs MySQL 与真实 HTTP，复核当前事项、分派/资格、状态变化与只读，不写正式库。
- `node scripts/test-data-map-ledger-integration-mysql.js <new artifacts output>`：全新隔离库验证现行/准确历史、撤回 scope、来源待完成和旧历史缺口。
- `node scripts/test-data-map-handoff-integration-browser.js --scenario all --frontend-dist <candidate dist> --output <new artifacts output>`：真实 Edge、100%、1699×828 CSS 像素，从工作台/待办/工作包/台账进入、办理与返回。支持 discovery/processing/navigation/permissions/ledger/inspect 子场景。只读发现不创建通用待办；显式写入仅发生于合成隔离目标。

浏览器脚本需要已安装 Edge 与既有 Playwright runtime，输出构建摘要、准确步骤、截图/几何、HTTP 和归属清理记录。未完成的全链场景保持失败或未执行，不用 mock 页面代替；人工 IME、正式目标、部署、功能开启和业务验收另行记录。
## 组合与恢复验证

第五批本地证据及可打开预览见[组合验证说明](../../../artifacts/3000-batch5-combined-20261021-212444/README.md)。该批从冻结治理扩展源建立独立候选，不将工作树中无关编制修改整包覆盖；相关功能在同一合成实例开启。编制主线使用真实登录及HTTP，关键页面与撤回恢复使用Edge；HR组合使用真实会话检验角色变化和原输入恢复。另库快照恢复单独记录，不代表原库覆盖、正式切换或备份后增量合并已验证。

复跑须使用本批README中的候选预加载器和全新输出目录；普通工作树测试不能代替冻结候选结果。输出保留实际执行源码、构建及已载入模块指纹，失败轮次不覆盖。`frontend/tests/handoff-fact-presentation.test.js`验证部门关联准确及缺名保护；`handoff-draft-recovery.test.js`验证同人不同授权的显式核对、原请求保留和当前回执重核。仅创建自有随机库及回环端口，不读取私有配置，不运行正式迁移或部署命令。
