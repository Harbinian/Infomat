# 旧功能退役验证

## P25 旧数据地图基础兼容

`npm.cmd run migrate:data-map-legacy-compatibility -- --inspect --target <host:port/database>`（或 `--dry-run`）检查七张 P02 基础表，输出已知待修改项、漂移及迁移标记，不写业务数据或结构。必须显式提供 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`，脚本不加载私有配置，目标必须完全匹配。参数不足、未知模式或目标不符即拒绝；Secret不得写入命令、日志或文档。

仅在目标授权、停写、备份及恢复条件齐备时，使用同一命令的 `--apply`。该动作先整体预检，再逐表调整三处默认值和两处 CHECK，最后登记 `2026-09-28-data-map-legacy-values-v1`；不 UPDATE 旧值、不赋予确认状态，不补部门或对象归属。与 P02 共用维护锁，每表 ALTER 原子执行，跨表失败留下可检查的已完成部分；再次 apply 只处理剩余已知差异。全量结构漂移检查保持，不支持盲目修复或自动回滚。执行顺序为兼容维护、P02定义迁移、获准的其他增量迁移；没有授权时只能在自有隔离环境演练。

`npm.cmd run test:data-map-legacy-compatibility -- --output <仓库artifacts内新的JSON路径>` 使用已有 `mysql:8.4` 镜像创建带唯一标记的 tmpfs 容器，合成旧值与空归属，不读取私有配置或连接既有数据库。可选 `--metadata <本地existing-ddl.json>` 只比较前次采集的四表 SHOW CREATE，不执行该文件中的 SQL。测试覆盖预检无写、未知漂移拒绝、锁竞争、中断续跑、重复执行、旧值及新默认、非法值拒绝、已登记结构回退、合成库完整备份恢复和 P02 原始快照。仅清理测试自有容器。失败证据追加 `.failure.json`，不覆盖已有输出；真实目标恢复与业务验收须另行执行。

## P21 数据地图台账查阅

`/app/data-map` 提供上下文查阅、创建及关联字段台账；`?context=<原上下文ID>` 支持刷新和返回定位。页面使用原 `/api/data-map/contexts`、`/api/field-entries/mapping/:contextId`，权限、部门范围、ID和状态保持。上下文不代表对象身份，原质量状态不构成新治理认定。字段身份与黄金源办理见下节；本页新增流程与数据关系图，台账导出见下节。

### 字段身份与黄金源办理（P21）

在 /app/data-map 选择上下文和字段，可查阅原字段身份、黄金源及当前确认记录；identityField 查询参数与 context 一起定位，支持刷新和历史返回。本部门编制权限用于维护系统名称、代码、置信度、备注及获准的维护责任，本部门审核权限用于单独确认已保存的系统。沿用 GET /api/field-identities/field/:id、PUT /api/field-identities/:id 和 POST /api/field-identities/:id/confirm；原角色、部门范围和确认接口保持。保存置为 needs_review、未确认，不代表新模板对象或权威来源已认定。

原旧页面没有字段身份编辑表单，只有台账、导出矩阵及确认进度；本轮是新前端接入仍受支持的后端能力，不是恢复退役页面。原入口继续保留。2026-09-28用户确认：维护部门仅限字段所属部门，负责人仅限该部门有效人员。页面通过 responsibility-options 读取最小名单，服务端复核人员在职、启用及部门有效期；未知责任允许为空，不自动指定。原责任引用未编辑时保留，历史用户编号只读；只有旧用户编号而无人员编号的记录继续暂停维护，禁止自动映射。

输入绑定人员、部门和字段，仅存页面内存；切换上下文、刷新、错误和同身份重登保留，跨身份不展示，明确离开或放弃才清除。提交前复读原记录，变化时阻止写入；结果不明时须先刷新核对，再放弃本次输入并重新办理，不自动重试。新页面同时提交 expected_identity 原快照，服务端取得字段行锁后比较当前记录，不一致返回409；旧调用方可省略该增量参数，但不具备过期快照检测。无幂等回执，响应丢失后仍须人工核对，不能自动重放。

本轮必要服务端修复：维护 PUT 拒绝 confirmed 为真或 status 为 confirmed 的请求并返回403，部门确认必须使用原专用入口；该入口继续复核本部门审核权限。已有确认数据保留。历史记录存在 owner_user_id 而 owner_person_id 缺失时，页面暂停维护、PUT返回409，防止旧规范化器静默推断人员编号；查阅和原确认接口继续可用。未变更表结构，无自动迁移或正式数据回填。旧调用方通过维护接口直接确认的行为不再受支持。

维护及部门确认与操作记录在同一事务内提交，记录失败全部回滚。复用 data_map_change_sets / data_map_version_log，entity_type 为 data_map_field_identity、entity_id 为原字段ID；不新增表、自动DDL或回填。GET /api/field-identities/field/:id/history 按原读取权限分页展示操作人、时间及前后快照，明确旧历史缺失，不能将第一条快照冒充旧审核事件。确认请求与已保存系统不一致或重复确认返回409，审核入口不再修改维护内容。新增责任选择接口为 GET /api/field-identities/field/:id/responsibility-options，仅本部门编制权限可读，不返回手机号、账号等无关信息。缺少原审计表时读写返回503，维护写入不会脱离记录单独成功。

验证：先运行 npm.cmd run build:frontend，再运行 npm.cmd run test:field-identity-browser -- --output <仓库artifacts内全新目录>。使用已有 Edge、Playwright、mysql:8.4 与自有隔离夹具，验证真实保存/确认、权限、并发变化、输入保护、旧记录和原入口。仅 Edge 100%、1699×828 桌面测试；403/409/503、断网、迟到响应及写入后丢失响应为显式注入。正式切换仍属于P25，隔离结果不等于人工体验或业务验收。

### 原生流程与数据关系图（P21）

`/app/data-map` 的图形面板复用原案例列表、案例详情和正式版本正文接口。案例存在当前已发布版本时读取该固定版本并复核摘要标志；否则明确显示预览修订。支持受支持的原生 V7/V8，保持原正文、ID和状态，不转换文档，不向3001通信。原列表最多返回100项，页面明确此限制；图形版本选择器通过原正式草稿详情列出该流程受支持的正式版本，可独立查阅历史版本；版本正文仍由后端复核权限和摘要，失败不回退到其他版本。

流程图、数据关系图使用原 `/api/process-diagrams/assets/` 本地只读组件，支持节点原文、键盘查阅、平移缩放、完整/清晰视图和含流程名称及版本来源的PNG下载。`diagramCase`、`diagramVersion`、`diagramMode`、`diagramData` 查询参数保留选择，不覆盖台账的 `context` 参数；无数据对象显示空态。刷新或请求失败清除旧图，切换、离页或身份变化使迟到结果失效，图形动作不提交或清除相邻台账输入。

验证：先 `npm.cmd run build:frontend`，再 `npm.cmd run test:native-diagrams-browser -- --output <仓库artifacts内全新目录>`。使用已有Edge、Playwright和本地mysql:8.4，测试只创建自有隔离MySQL/HTTP/浏览器并写合成数据，结束按归属清理。输出浏览器结果、几何数据、PNG及Edge 100%、1699×828桌面截图（不执行窄屏测试）；检查来源、权限、错误重试、输入保护、迟到请求及新旧兼容。不改变后端API、权限、审批或数据库，正式切换仍留P25，自动验证不替代人工业务验收。
P21补充：在正式流转页的“主档已发布版本查阅”中明确选择版本后，可分别打开该固定版本的流程图、数据关系图；链接在新标签页打开，原页未提交意见保留。`/app/data-map?diagramVersion=<固定版本ID>&diagramMode=process|data` 在没有 `diagramCase` 时直接读取原版本正文接口，不依赖案例列表或草稿详情，仍由服务端检查部门范围与正文摘要。页面检查版本标识、状态和原生格式；失败清除旧图且不回退到预览或当前版本。刷新、返回、视图切换和PNG来源继续绑定该版本，可返回原案例选图方式。这是已知版本的独立查阅入口，不提供全局版本搜索，也不推断主档或案例关联；后端接口、权限、审批及旧数据保持。

### 字段台账导出验证（P21）

构建后运行 `npm.cmd run test:field-export-browser -- --output <仓库artifacts内全新目录>`。使用现有 Edge、Playwright 和本地 `mysql:8.4` 镜像，创建并清理自有隔离 MySQL、HTTP 和浏览器；仅写合成测试数据，不访问正式数据库、私有配置或业务端口。输出工作簿、截图、结果和资源归属记录。

覆盖原 `GET /api/export/excel` 的字段台账、黄金源矩阵、两种权限范围、空表头及新旧页面逐单元格对照；验证草稿和文件不被提交、取消和迟到请求、重复点击、键盘、刷新返回及1699×828/390×844布局。401及权限撤销使用真实隔离身份，403/409/503、网络失败和错误文件类型另用显式注入。导出不限当前选择的上下文，原接口不保证跨查询事务一致快照。无API、审批或旧数据迁移变化，正式切换仍属P25。

构建后运行 `npm.cmd run test:data-map-read-browser -- --output <仓库artifacts内全新目录>`。脚本创建并清理自有隔离MySQL、HTTP和Edge，只使用合成数据，输出结果与截图，不访问正式数据库。读取失败清除旧数据显示重试，取消及迟到响应不回写。具有本部门编制权限的人员可通过原 POST /api/data-map/contexts 创建上下文，成功后定位关联台账；输入绑定人员与部门，刷新列表、错误和同身份重登保留输入，离开及整页刷新提示确认。冲突或网络结果不明确时先核对列表，不自动重试创建。该页面不改审批链、权限、接口或旧数据。另运行 `npm.cmd run test:data-map-create-browser -- --output <仓库artifacts内全新目录>`，条件及资源清理同上，覆盖真实创建、重复并发、权限与输入保护。正式切换仍留P25，人工体验和业务验收另行记录。

字段导入也已接入此页：下载原 `/template.xlsx`，选择本部门上下文及不超过 5MB 的 `.xlsx`，明确提交后调用原 `POST /api/import/field-entries`，成功后读取原字段台账。表头沿用“数据对象、字段说明、中文字段名、英文字段名、字段类型、消费系统、同步方式”；必需表头为前两项。新页不宣称支持二进制 `.xls`，不改模板原件或导入 API。该模板是原字段台账模板，与主数据清单导入页面的模板不同。

文件选择只在壳层内存保留并绑定人员、部门及原上下文；切换查看、列表刷新、失败和同身份重登保留，换人或明确放弃时清除。下载不提交文件。原 API 逐行写入，没有整批事务或完整幂等回执；错误、超时或失效响应不能说明全部回滚。再次提交前须刷新目标台账、核对已写行并修正文件，然后明确确认；页面不自动重试。保留原唯一键、质量规则、管理员只读及部门范围，不改变审批链、数据库结构、历史字段或原入口。

`npm.cmd run test:field-import-browser -- --output <仓库artifacts内全新目录>` 先要求 `npm.cmd run build:frontend`，使用现有 Edge、Playwright 和本地 `mysql:8.4` 镜像。只向自有隔离 MySQL 写入合成上下文、字段及命名规则，通过真实 HTTP 和 Edge 验证导入、模板、表头、部分写入、质量规则、CSRF、部门/管理员拒绝、并发、身份和输入保护、新旧页读回及宽窄布局；403/409/503、断网和迟到响应另用显式注入。输出结果、截图及自有资源归属信息，结束清理自有资源，不操作正式数据库或业务端口。

## P21 术语词典与冲突管理浏览器验证

`npm.cmd run test:terms-conflicts-browser -- --output <仓库artifacts内全新目录>` 要求先构建独立前端，并具备本机 Edge、现有 Playwright 及 `mysql:8.4` 镜像。脚本沿用 `withStage05Fixture`，仅在带唯一归属标记的自有 tmpfs MySQL 中写入合成身份、流程引用、术语、字段、冲突及办理记录；应用使用随机回环端口，不连接正式库或读取私有配置。

真实 HTTP/Edge 验证术语申报、修改、审核和删除，冲突指定/改派、协调、处理决定、升级、重开、归档、检测去重，以及同编号不同类型、历史标识、管理员只读、数据范围、并发变化、会话失效、输入保护、新旧入口与历史导航。403/409/503、空态、迟到响应、断网及写入后丢失响应通过明确的浏览器注入验证，不能作为真实业务验收。输出 results.json、桌面/窄屏截图和 fixture-app.log；失败保留 failure.json 与限时截图。结束关闭本次 Edge、HTTP 和经归属核对的容器，不清理已有资源。

## P21 角色详细管理浏览器验证

`npm.cmd run test:role-management-browser -- --output <仓库artifacts内全新目录>` 要求已有前端构建、本机Edge与mysql:8.4镜像。脚本复用withStage05Fixture，仅向自有tmpfs MySQL写入合成身份、历史角色和撤销授权；验证真实角色接口、新旧页面、刷新/返回/前进、会话失效、无权读取及固定模型写入拒绝。页面本身只有读取操作，并核对人员授权记录未被改写。

403/409/503、断网、空列表和迟到响应为显式浏览器注入；正常内容、权限和会话验证使用真实HTTP/MySQL。输出results.json、桌面及窄屏截图；失败保存failure.json和截图。结束关闭本次Edge、自有HTTP及经过归属核对的容器；不操作正式服务、私有配置、账号或数据库。旧页初始账号读取尚未完成时切换标签可能被迟到账号响应覆盖，兼容检查等待初始账号列表完成再切换，本脚本不修复该旧页行为。

## P21 统计看板浏览器验证

`npm.cmd run test:dashboard-browser -- --output <仓库artifacts内全新目录>` 先要求完成前端构建，并使用本机已有Edge、mysql:8.4镜像和withStage05Fixture。仅在自有tmpfs MySQL中准备合成身份及历史兼容统计记录；通过真实HTTP核对新旧入口、统计口径、筛选、权限和会话。隔离历史users记录只提供既有活动展示标签，登录授权仍使用person、user_accounts及person_roles。

403/409/503、断网和迟到响应使用明确浏览器注入，与正常真实接口检查分别记录。输出results.json、桌面及窄屏截图和隔离应用日志；失败保留failure.txt、browser-failure.json及截图。结束时关闭本次浏览器、自有HTTP及经归属核对的容器。不读取私有配置、不连接正式库、不恢复退役入口。结果不代表正式开启或业务验收。

## P21 办公室工作台浏览器验证

`npm.cmd run test:office-workbench-browser -- --output <仓库artifacts内全新目录>` 要求已构建独立前端、本地 `mysql:8.4` 镜像及Edge。脚本沿用 `withStage05Fixture`，只创建带唯一归属标记的临时MySQL、随机回环HTTP及浏览器，并在finally中清理自有资源；不读取私有配置、不连接正式库。

真实隔离HTTP覆盖明确组织和成员导入、原生V7发布及固定来源、交办、原部门待办承接、负责人分配、跨办公室成员办结、实际并发和401、管理员只读与越权拒绝、新旧入口及历史结果读取。浏览器检查刷新/返回、切换/离开保护、跨身份清除、迟到响应、键盘焦点和1699×828、390×844布局。403/409/503、断网和P17最小办理说明投影为明确注入；投影不代表重新验收完整分析问题闭环。

输出 `results.json`、截图及 `fixture-app.log`，失败保留 `failure.json` 和截图。未涉及正式运行或人工业务验收。

## P21 正式数据治理工作包浏览器验证

`npm.cmd run test:data-governance-browser -- --output <仓库artifacts内全新目录>` 使用既有 `withStage05Fixture`，需要先构建独立前端，并具备本地 `mysql:8.4` 镜像及Edge。全新输出目录防止覆盖历史证据；测试仅创建带唯一归属标记的临时MySQL、自有HTTP服务及浏览器，结束后核对归属并清理。不得指定正式库，不读取私有配置。

检查原生V7发布后的显式工作包建立、幂等、固定来源、治理明细、定向问题/答复/核对关闭、审核卡口及完成记录；覆盖管理员叠加角色只读、部门范围、真实并发/来源摘要变化/401、历史版本、新旧入口兼容，以及刷新返回、未提交输入、迟到响应和1699×828、390×844页面。403/409/503、断网及模式投影的浏览器注入与真实流程分别标记；既有 `test:process-data-governance` 验证实际只读路由及仓储前置拒绝。

输出 `results.json`、截图及 `fixture-app.log`；失败保留 `failure.json` 和截图。只证明所列本地技术检查，不代表正式开启、人工输入法或业务验收。

2026-09-15已删除独立SQLite业务路由和V1至V3在线编制入口。`test:retired-capabilities`验证旧接口不可访问、旧草稿不能通过共享接口流转、V7身份与版本读取继续有效。历史迁移及恢复脚本保留用于旧记录追溯，不授权写入正式数据库。`test:role-workbench-mysql`同时验证工作台不再查询旧快照、映射及输入基线事项；`test:offices`覆盖同一任务在负责人、办理人个人待办中的移交及办结消失。浏览器回归为`node scripts/test-stage05-browser.js`，使用真实Edge和独立MySQL验证V7办理、待办跳转及未提交输入保护。

# apps/mdm-platform/scripts 说明

### P11 确定性 V7 规则

`npm.cmd run test:v7-analysis-rules` 使用合成 JSON 检查正常、缺陷、合法回路、不同节点类型、字段绑定、来源不足、顺序稳定性、限额及计算线程取消；预加载 blockRealMysql，不连接数据库。`npm.cmd run test:v7-analysis-worker -- --output <仓库artifacts内全新目录>` 使用自有 tmpfs MySQL、随机端口 HTTP 夹具、合成固定上传和真实独立 worker，验证固定版本与证据保存、重复运行身份、缺口、权限及原资产保护。输出结果 JSON、规则目录、worker 源码摘要和清理记录；finally 仅关闭自有资源。

`server/v7AnalysisRules.js` 为纯规则目录及实现，`v7AnalysisThread.js` 为可终止计算线程；复用 P07/P09/P10，无 P11 数据迁移。启用边界、每步单个固定 V7 输入、manifest 字段及禁用不可达规则见应用 README 的 P11 节。正式环境、AI 和业务认定没有因此开启。

### P10 独立分析工作进程

`npm.cmd run test:analysis-worker -- --output <仓库artifacts内全新目录>` 使用自有 tmpfs MySQL、合成身份与台账；复用的夹具会启动自有随机端口 HTTP，测试只启动并停止自己创建的 Node 子进程。验证迁移、两个进程竞争、单实例启动、心跳、租约、超时、重领、迟到提交、取消竞争、有限重试、部分成功、身份失效、事务和备份恢复。输出 results.json、worker-events.json、cleanup.json 等，不写原件、正式库、3000/3001/5173/63805，不创建常驻任务。

`migrate:analysis-queue` 支持默认 dry-run 及显式 inspect/apply；`analysis:worker` 支持 start/status/stop/recover。所有操作要求准确 `--target <host:port/database>` 与显式 MYSQL 环境一致。只有迁移 apply 执行 DDL，start 只检查结构；stop 必须提供从本次启动取得的 `--worker-id`，不扫描或批量结束进程。命令、重试策略、旧记录兼容与补偿见 [应用README](../README.md#独立分析工作进程p10)。保留 p10-stub-v1，P11 增加 v7-deterministic-v1；正式运行尚未开启。

### P09 分析运行与证据存储

在应用目录执行 `npm.cmd run test:analysis-runs -- --output <仓库artifacts内全新目录>`。输入为脚本内的合成身份、模板单元格、台账、V7 来源及设计关系，复用 Docker 已有 `mysql:8.4` 镜像和项目自有 tmpfs MySQL/随机回环 HTTP 夹具，不安装依赖、不读外部原件或私有配置。本步无需构建前端或打开浏览器；夹具仅为准备受支持的合成预览及发布版本而调用自有 HTTP，不开启分析 worker。

输出包括迁移、固定输入、合成运行和证据、旧记录摘要、备份恢复以及最终结果 JSON。验证首次/重复/中断迁移、空表补偿、结构漂移、同事务回滚、唯一键/外键、三类来源、权限范围、重复请求、步骤重试、主动重跑、终态保护和历史引用。备份仅在内存使用，不将口令或 dump 写入证据目录；finally 按具体 ID 和唯一标签清理自有 HTTP/MySQL。

`npm.cmd run migrate:analysis-runs -- --target <host:port/database>` 默认 dry-run；可显式选择 `--inspect`、`--dry-run` 或 `--apply`，三者互斥。维护入口复用 P02 的准确目标与显式环境变量校验，不加载 `.env`。只有 `--apply` 增加本步八表和迁移标记，无旧记录回填；补偿/恢复和 P10 工作进程边界见 [应用README](../README.md#分析运行与证据存储p09)。正式实例操作仍需另获授权。

### P08 设计交接关系

从应用目录执行 `npm.cmd run build:frontend`，再执行 `npm.cmd run test:design-handoffs -- --output <仓库artifacts内全新目录>`。输入为脚本内合成的两个相邻流程、对象与字段映射及身份；依赖现有Docker的mysql:8.4镜像、Playwright和Microsoft Edge。复用自有tmpfs MySQL、随机回环HTTP与明确空闲的浏览器控制端口，排除业务端口；不读私有配置、外部业务原件或正式数据。`--no-browser` 只验证后端，不能报告页面通过。

检查覆盖三表首次/重复迁移、部分DDL、空增量补偿、结构漂移、维护CLI、组合标识、同名异身份、缺映射/部分来源、未确认目标、转换依据、目标必填字段、部门范围、管理员只读、幂等/并发、事务故障、不可变历史、字段修订影响、快照及引用完整性、内存备份恢复和数值分页。Edge检查实际填写/保存/确认、字段位置和焦点、证据与对象跳转、401重新登录、明确注入403/409/503/断网、取消切换/刷新/放弃及旧响应保护，并检查1699×828和390×844布局。输出 results.json、browser-results.json、PNG、migration.json、complete-design.json、field-impact.json、protected-records.json、backup-restore.json；失败记录保留。finally只关闭本次持有的Edge/HTTP资源并按容器ID和唯一标签清理自有库。

`npm.cmd run migrate:design-handoffs -- --target <host:port/database>` 默认只读dry-run；显式 `--inspect`、`--dry-run`、`--apply` 互斥，使用与目标完全一致的 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`。不读 `.env`，不连接默认库，无启动DDL。兼容、补偿和恢复条件见 [应用README](../README.md#设计交接关系p08)。正式实例迁移、开启及业务验收分别需要授权和证据。

### P07 固定 V7 来源与映射

先执行 `npm.cmd run build:frontend`，再执行 `npm.cmd run test:v7-mappings -- --output <仓库artifacts内全新目录>`。复用项目的自有 tmpfs MySQL、合成身份、随机回环 HTTP 和 Microsoft Edge；已有 Docker 镜像及 Playwright/Edge 必须可用，不安装新依赖。`--no-browser` 仅运行后端检查，不能据此宣称浏览器通过。测试在隔离库通过现有公开 API 准备预览与已发布 V7，P07 操作前后比较九张 V7/审核表摘要，证明映射不改写这些表；不操作真实 3000/3001、正式库或外部材料。

测试覆盖失败来源登记、原始字节/内容摘要、同名对象分离、字段改名、数组重排、历史来源、父映射修订、重复/并发/事务失败、权限及管理员只读、部门卡口、来源变化、DDL 中断/漂移/补偿和内存备份恢复。Edge 检查来源登记、字段映射、证据定位、失败输入保护、实际401重登、注入403/409/503/断网、过期响应、1699×828及390×844布局。结果保存于指定目录的 results.json、browser-results.json、PNG、migration.json、v7-read-only-proof.json、backup-restore.json；失败时保留 failure.json/PNG。测试结束只关闭自有浏览器与 HTTP，并核对本次容器 ID/标签后清理。

`npm.cmd run migrate:v7-mappings -- --target <host:port/database>` 默认 dry-run；可选 `--inspect`、`--dry-run`、`--apply`，要求既有 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` 与目标一致。无 `.env` 加载、默认数据库连接或启动 DDL。兼容与恢复边界见 [应用 README](../README.md#固定-v7-来源与台账映射p07)。

### P06 台账事实核对

`npm.cmd run test:data-map-facts -- --output <仓库artifacts内全新目录>` 使用本地 Docker、已有 Playwright 和 Microsoft Edge，要求先执行 `npm.cmd run build:frontend`。复用 `withStage05Fixture` 的自有 tmpfs MySQL、合成账号和随机回环 HTTP；不读取私有配置或共享模板，不操作 3000、3001、5173、63805、正式数据库或实际权限。本步为测试夹具增加内存备份/恢复能力的传递，未改变旧调用方行为。

测试覆盖迁移缺失拒绝、inspect/dry-run/显式apply CLI、重复迁移、部分DDL失败与空表补偿、结构漂移、请求幂等、事务故障、并发、越权和管理员只读，以及字段问题发起、缺证据、答复、修订、过期意见拒绝、重新核对和完成核对。完整数据库备份仅在内存中用于本次自有库恢复校验；不输出口令、不保存数据库dump。浏览器检查定向上下文、返回办理位置、输入保护、真实401重登、注入的403/409/503/断网、旧异步返回及1699×828/390×844视口。输出 results.json、迁移证据、完整合成办理历史、截图及失败记录；finally 只关闭本次持有的 Edge/HTTP 句柄和核对归属的容器。

`npm.cmd run migrate:data-map-facts -- --target <host:port/database>` 默认 dry-run；显式 `--inspect`、`--dry-run`、`--apply` 三者互斥。使用现有 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`，拒绝缺配置或目标不一致；不加载 `.env`，不自动连接默认库。apply 仅建两张增量表及迁移标记，不回填旧事实。具体兼容、补偿和业务边界见 [应用README](../README.md#台账事实核对p06)。正式迁移、真实人员体验和业务验收需分别取得证据。

### P05 对象与字段管理真实链路

`npm.cmd run test:data-map-management -- --output <仓库artifacts内全新目录>` 在已构建前端上验证对象新增、字段补充、保存修订、刷新读取、固定版本、单字段/组合标识、来源回查和停用影响。服务端覆盖权限与部门范围、多角色admin只读、CSRF、无删除入口、空值/枚举、父对象、幂等、事务回滚、并发及已审核状态拒绝；Edge覆盖当前面板唯一新增入口、焦点、中文长文、取消切换/返回/刷新/停用、真实401重登、显式注入的403/409/503/断网、旧响应和1699×828/390×844布局。

前置为 `npm.cmd run build:frontend`、本地Docker、已安装的Playwright和Microsoft Edge。脚本复用withStage05Fixture，只创建本轮带唯一标签的tmpfs MySQL、合成身份及随机回环HTTP端口；不加载私有配置、不访问原模板或正式库、不操作业务端口。缺P02迁移先验证503，再显式迁移自有库。输出results.json、截图、失败记录和应用日志；finally关闭本轮浏览器、HTTP及按归属核对的容器。浏览器通过本轮BrowserServer句柄管理，退出等待有上限；超时只结束该句柄持有的实例，避免清理被浏览器退出阻塞。新实现对P02仓储的改动以 `test:data-map-definitions-mysql` 回归，模板消费方以 `test:master-data-template-import` 回归。测试不代表真实人员体验或业务验收。

### P04 模板导入真实链路

`npm.cmd run test:master-data-template-import -- --output <仓库artifacts内全新目录>` 验证同源上传预览、重新校验、管理员只读、部门范围、CSRF、重复/并发提交、显式新修订、孤立字段、409及部分写入失败回滚；用真实Edge从页面导入合成模板，再查询对象、字段和源单元格。输入保护覆盖取消返回/刷新/换文件、401重登、403/409/503/网络故障及旧异步响应；HTTP故障注入和真实后端失败分别记录。

此入口先要求本地前端构建，复用已安装Playwright及Microsoft Edge，不下载浏览器；调用既有withStage05Fixture创建带唯一归属标签的tmpfs MySQL、合成账号和随机回环HTTP服务，应用账户只有数据读写权。隔离库显式应用P02迁移，缺迁移先验证503。故障测试只在自有库创建并删除本次触发器；finally关闭本次Edge/HTTP及容器，不读取私有配置、共享原件，不连接正式库或操作3000/3001/5173/63805。输出results.json、截图、应用日志；失败保留failure.json，重跑使用新的证据子目录。

P02仓储事务复用的兼容回归仍为 `test:data-map-definitions-mysql`，P03纯解析仍为 `test:master-data-template`。本步接口、去重、旧数据及维护边界见[应用README的P04说明](../README.md#模板导入预览与确认p04)。人工中文输入法、真实人员体验及正式上线不在隔离测试结论内。

### P03 指定主数据模板解析

| 命令 | 输入与输出 | 副作用及执行条件 |
|---|---|---|
| `npm.cmd run preview:master-data-template -- --input <原件.xlsx> --output <artifacts内全新目录>` | 只读指定原件；输出完整JSON、中文Markdown预览和前后摘要 | 输出父目录必须存在且真实路径位于仓库artifacts内；不覆盖已有目录，不写原件、数据库或应用公开目录，不访问外链。退出0为无错误预览，2为有逐项错误的预览，1为命令或文件失败 |
| `npm.cmd run test:master-data-template` | 内存生成的合成XLSX及恶意文件边界；Node测试报告 | 预加载blockRealMysql；不读取共享原件、私有配置或连接数据库，不启动服务、不发通知。CLI保护测试仅在本次独有artifacts目录创建合成结果并按准确路径清理 |

解析器、限制、公式与来源兼容说明见[应用README的P03说明](../README.md#指定主数据模板只读解析p03)。此命令仅产生本地核对材料；HTTP身份、权限、来源登记和确认入库由P04接续，不能将退出0解释为业务入库或认定完成。

办公室管理使用`migrate:offices:inspect|apply -- --target host:port/database`，要求显式MySQL配置。检查旧`org_unit`兼容性，只增加可空部门关系、`office_membership`、`mdm_todo_office_assignments`及迁移记录；不推断历史办公室归属、负责人或成员。应用与数据回退边界见[应用README](../README.md)。`test:offices`在本轮新建MySQL与真实HTTP中验证增量迁移、旧数据保留、手工发布、多办公室成员、负责人分配、办理人办结、重复请求、修订冲突及旧待办接口保护。`node scripts/test-offices.js --serve`保留该合成实例供浏览器验证；按回车或创建输出中的stopFile结束并清理本轮实例，不操作已有3000、3001或数据库。

手工发布新增`migrate:publications:inspect|apply`，须显式传入MySQL环境变量和`--target host:port/database`。apply仅创建空的`mdm_publications`和迁移记录，拒绝同名异构表，不改写历史业务数据；应用回退可保留新增表及发布记录。`test:publications`在本轮新建的带归属标记MySQL容器中验证文件导入、目录更新、版本、并发、重复提交、权限和下载，结束后移除本轮容器，不访问已有数据库或私有配置。

交互验证可运行`node scripts/serve-publication-test-fixture.js`。脚本创建独立MySQL和合成账号，执行V7核对、退回、审核与发布，提供随机本地端口验证手工发布、图形和绑定正式版本的数据治理；按回车关闭后清理本轮实例。该入口不读取私有配置、不连接现有数据库，也不占用3000或3001。

> 状态：应用内脚本导航  
> 生效日期：2026-06-10  
> 范围：只服务 `apps/mdm-platform/` 的数据库、路由、前端资产和流程治理承接测试。

### P02 定义版本维护与隔离验证

命令均从应用目录执行，不读取私有.env；正式目标不在一般开发执行授权内。

| 命令 | 输入和输出 | 副作用及执行条件 |
|---|---|---|
| `npm.cmd run migrate:data-map-definitions:inspect -- --target host:port/database` | 显式MYSQL_HOST/PORT/DATABASE/USER/PASSWORD；返回结构漂移、待建表、首次捕获、旧路径变化和待人工处理清单 | 只读检查，连接参数必须齐备且目标完全匹配，不使用默认数据库 |
| `npm.cmd run migrate:data-map-definitions:dry-run -- --target host:port/database` | 同inspect，使用相同检查逻辑 | 不执行DDL或数据写入；ready不代替changed/unresolved逐项核对 |
| `npm.cmd run migrate:data-map-definitions:apply -- --target host:port/database` | 同一显式目标；返回迁移后检查结果 | 必须先核对dry-run和备份恢复；只补缺少的增量表、首版快照和迁移标记，结构漂移拒绝，原台账不改写 |
| `npm.cmd run test:data-map-definitions-mysql -- --output <artifacts内全新JSON路径>` | 本机Docker、已有mysql:8.4镜像；生成19组检查结果、目标归属、前后清单及备份摘要 | 只创建带唯一标签的tmpfs MySQL及随机回环端口，合成身份/材料；不拉镜像，不启动3000/3001/5173，结束核对归属后清理本轮容器 |

迁移模块不在启动链路注册。七张增量表、旧字段兼容、错误码及回退条件见[应用README的P02说明](../README.md#对象字段定义版本基础p02)。迁移创建人员未知时使用NULL和legacy来源，不虚构历史操作者；新增审查仍必须记录有效人员。重复apply不吸收旧接口后续改动、不清空unresolved。测试中的备份只在内存中使用，证据只保存SHA-256，不记录合成数据库口令。该测试不等于正式实例、HTTP业务链路或人工业务验收。

### P01 独立前端入口

以下命令从应用目录执行。仅覆盖工程骨架、身份和访问边界，不代表新业务模块或人工验收完成。

| 命令 | 输入和输出 | 副作用及执行条件 |
|---|---|---|
| `npm.cmd run build:frontend` | frontend源码及独立lockfile；输出frontend/dist | 先在frontend执行npm ci；只生成公开JS/CSS/HTML，不读.env、不启动应用或连接数据库；构建纳入runtimeVersion摘要 |
| `npm.cmd run dev:frontend` | 必须显式提供MDM_ISOLATED_BACKEND | 随机回环Vite端口，只代理明确的自有隔离后端；拒绝业务端口，无默认正式3000、无宽泛CORS；Ctrl+C关闭本进程 |
| `npm.cmd run test:frontend-shell` | 请求客户端/开发边界测试及已生成dist | Node纯逻辑测试、临时回环HTTP路由和公开资产检查；不连接数据库；finally关闭本次监听 |
| `npm.cmd run test:frontend-shell-browser -- --output <全新目录>` | artifacts内全新目录，拒绝覆盖已有目录 | 复用withStage05Fixture及freshMysql；本机Docker和已有mysql:8.4镜像、已安装Playwright与Edge；不拉镜像、不下载浏览器，不读取私有配置 |

浏览器入口只在新建、唯一标记、tmpfs、随机回环端口的MySQL中初始化结构、合成账号和会话，通过真实HTTP验证新旧入口、CSRF、失效、退出及404边界；403/409/503和断网由浏览器明确注入，长名称/空角色是界面替身，不作为真实权限测试。补测真实Vite代理连接该隔离后端，保持前后端同源访问。检查1699×828和390×844、100%缩放、输入保护、焦点、控制台及横向溢出；截图和JSON写入指定目录，不保存密码、Cookie或会话令牌。最终关闭自有Edge/Vite/HTTP进程，按容器ID和标记核对后清理，不操作已有容器或正式服务。外部强制中断时按本轮精确资源归属核对，不批量清理。

本目录脚本属于 MDM 平台应用内工具。跨 `docs/`、`pmo/` 和多个应用的仓库级脚本应放在仓库根 `scripts/`。

仅3000运维入口为`service:start`、`service:stop`、`service:restart`、`service:check`；前台监督入口为`service:supervise`。它们复用非敏感固定配置和注入环境，核对进程归属，不读私有env、不运行DDL、不操作其他服务。命令会写被忽略的`artifacts/mdm-3000-runtime/`进程状态与轮转日志。会话维护为`migrate:sessions:inspect|apply|rollback`及`cleanup:sessions:inspect|apply`，均要求`--target host:port/database`；apply和rollback会写指定MySQL。具体前置条件、运行权限、失败处理与开机恢复边界见[3000发布与恢复](../../../docs/plans/2026-09-09-mdm-3000-launch/03-发布与恢复.md)。

## 1. 常用测试入口

| 命令 | 覆盖范围 | 副作用 |
|---|---|---|
| `npm run test:stage03-runtime` | 会话/代理配置、维护目标、就绪合并/缓存/超时和进程归属拒绝 | 合成环境、SQL替身，不连接数据库或读取私有配置 |
| `npm run test:stage03-mysql-isolated` | 会话迁移/清理、真实HTTPS代理、登录/重启/停用/授权失效、首改密、断库与结构恢复 | 仅新建带唯一标记的MySQL 8.4容器，tmpfs数据、随机回环端口、合成人员、临时证书；测试后核对标记并删除本轮容器，不操作已有实例。要求本机已有mysql:8.4镜像及Git OpenSSL |
| `npm run test:stage03-service` | Windows临时进程的归属、端口冲突、重复监督、源码变化、停止、重启、异常恢复和日志轮转 | 系统临时目录与随机回环端口的合成应用；不读私有配置、不连接数据库、不使用3000/3001/PMO端口 |
| `npm run test:mysql-runtime-boundary` | 正式模块加载、配置拒绝、SQLite加载阻断、运行SQL只读探测、缺结构/断库恢复、代表性HTTP及管理员写入拒绝 | 合成身份和SQL监测替身，随机回环端口及系统临时目录；不读取私有配置、不连接真实MySQL。`--serve`仅为人工浏览器隔离验证保留合成服务，须在验证后停止 |
| `npm run test:rbac-raci-v2` | 固定十九项权限、七个MDM工作角色、十一项RACI、角色可见标签、账号接口、会话失效、迁移和空库初始化约束 | 命令名为兼容入口；使用fake repository和源码约束检查，不连接真实库 |
| `npm run test:process-governance-unified` | 完整v2草稿、修订冲突、承接队列、故事链、冲突处理链和管理员写入403 | 使用fake repository和接口测试，不连接真实库 |
| `npm run test:security` | 废弃建号拒绝且零写、历史口令审计、正式注册与隔离路由追溯、固定角色权限及真实HTTP会话/CSRF门禁 | 子进程仅继承必要系统环境，阻断真实MySQL；历史审计使用自有临时SQLite，HTTP使用显式合成仓储；输出独立测试日志 |
| `npm run test:launch-stage04` | 第04阶段聚合：安全、身份/RBAC、流程治理、冲突、映射、字段、工作包和运行边界，再执行真实隔离MySQL的V3/V7验证；相同脚本去重 | 模拟部分强制阻断真实MySQL；真实部分只新建本轮带标记的tmpfs容器和随机回环HTTP端口。不运行共同启动或正式初始化命令；要求本机已有mysql:8.4镜像和Docker |
| `npm run test:stage04-mysql-isolated` | 真实应用HTTP、登录/首改密/停用/撤权、V7预览/修订/核对/退回再办、发布故障回滚/并发唯一/不可变版本读回、合成历史V3读回 | 仅自建MySQL 8.4容器、合成基础与业务数据、无DDL权限运行账号；结构准备和故障触发器仅在本轮容器内执行，结束核对归属并删除；不读取备份或真实历史数据 |
| `npm run test:mainline` | MDM主线：组织结构、固定RBAC/RACI、角色工作台、人员身份、流程治理、数据地图、字段、术语、冲突、待办和导入导出 | MySQL路径使用fake pool/repository；遗留测试只使用隔离本地库并在结束后清理 |
| `npm run test:process-governance` | 流程治理 MySQL 读模型、MySQL 导入/冒烟、Sankey API、MySQL 身份权限、输入基线问题复核、文档结构化输出、统一问题池、前端挂钩和字段引用 | 正式口径为 MySQL-only；当前入口使用 fake MySQL pool / fake repository，不连接真实库，不纳入遗留 SQLite 服务器/仓储测试 |
| `npm run test:process-design` | 文档结构化输出 API、MySQL schema、制度主档、制度编号校验、A/B/AA 版次生成、下一版次完整重写草稿、制度 profile、术语、草稿级 L1/L2 既有映射枚举校验、流程明细、行为详情、跨部门承接回写、附表结构、字段新增/修改/删除/排序、自动编号、字段空格校验、证据状态核验、Markdown 草案导出、发布替代链路，以及术语/流程/业务行为编辑、删除、作废和只读状态 | 使用 fake process-design repository 和 fake MySQL 身份 repository，不连接真实库 |
| `npm run test:process-v7-preview-review` | V7完整规则校验、固定跨部门核对项、修订沿用与重开、部门范围、管理员只读、预览边界和迁移保护 | 使用fake repository和fake pool，不连接真实库 |
| `npm run test:process-data-governance` | 固定V7来源候选、任一已发布版本选择、MDM与业务责任隔离、管理员只读、API、迁移、全屏弹窗及未提交输入保护 | 使用确定性单元测试、fake repository、源码约束和编辑/异步加载行为检查；包含保存时保留其他输入、失败保留、完成前确认及旧请求不得覆盖新页面，不连接真实库 |
| `npm run test:process-data-governance-mysql` | 两个合成正式版本独立建包、来源篡改拒绝和部门隔离；另一个流程从上传、核对、提升、审核到发布完整运行，验证旧试点配置不阻止办理 | 新建本轮标记的tmpfs MySQL容器及随机回环HTTP服务，保留真实3000/3001；结束核对归属后清理。追加`-- --serve`可保留合成页面供浏览器验证，创建打印出的stopFile结束 |
| `npm run migrate:process-data-governance:dry-run` | 只读检查六张后续数据治理表、迁移记录、已发布流程版本数量和结构一致性 | 通过固定MySQL配置连接；脱敏输出，不写MySQL |
| `npm run migrate:process-data-governance:apply` | 只在`not_applied`时创建六张空表和迁移记录；不回填历史工作包 | 写入目标MySQL；必须另行取得授权并先验证备份恢复 |
| `npm run migrate:process-data-governance:rollback` | 只在六张表全部为空时删除表和迁移记录 | 写入目标MySQL；发现任何治理记录即拒绝执行 |
| `npm run migrate:process-v7-preview:dry-run` | 只读检查四张V7预览核对表、迁移记录、正式三表数量和摘要，输出六种`consistency_status`之一 | 通过仓库固定服务配置和本机受控环境加载连接；目标脱敏输出，不写入MySQL |
| `npm run migrate:process-v7-preview:apply` | 在`not_applied`时建立V7预览核对专用表和迁移记录；`applied`时幂等返回 | 写入目标MySQL；其他不一致状态只报告并停止，不自动补表或记录 |
| `npm run migrate:process-v7-preview:rollback` | 仅在四张专用表均为空时删除表和迁移记录 | 写入目标MySQL；发现任何业务记录即拒绝执行 |
| `npm run inspect:process-v7-m0` | 读取正式三表数量、摘要、引用关系、JSON一致性和live schema差异 | 只读连接目标MySQL；证据写入`output/process-v7-m0/` |
| `npm run rehearse:process-v7-m0-backup-restore` | 生成全库备份，在专用临时MySQL恢复并核对全部对象与正式三表摘要 | 读取正式库；只写本机备份目录和临时数据库，不写正式库 |
| `npm run migrate:process-v7-formal:dry-run` | 只读检查M1的`migration_recorded`、`applied`和`consistency_status`，同时检查M2列、索引、提升审计表和正式V3摘要 | 连接目标MySQL但不写入；只有M1为`applied`时`ready_for_apply`才可为true |
| `npm run migrate:process-v7-formal:apply` | 增加原生V7正式基础，不创建V7业务行 | 写入目标MySQL；任何M2 DDL前要求M1`consistency_status=applied`，并必须取得单独授权 |
| `npm run migrate:process-v7-formal:rollback` | 仅在没有V7正式使用痕迹时移除M2对象 | 写入目标MySQL；发现提升、V7草稿、版本或审核正文绑定即拒绝执行 |
| `npm run rehearse:process-v7-migrations-isolated` | 历史备份演练入口，默认读取`output/process-v7-m0/2026-08-25-backup-restore.json`及其中的备份路径 | 会读取真实备份及恢复身份；不是纯合成入口，不可因isolated名称直接运行。第06阶段改用下述自有合成入口 |
| `npm run test:identity-mysql` | `person/user_accounts/person_roles`身份链路、登录、会话、本人改密、固定角色只读接口、通用权限中间件、范围helper和旧RBAC导入拒绝 | 使用fake MySQL pool和fake repository，不连接真实库 |
| `npm run test:access-mysql` | 验证 `access.js` 中角色码读取、管理员判断、全局查看、复核权限和待办处理判断的 MySQL-aware 异步 helper | 使用 fake repository，不连接真实库 |
| `npm run test:role-workbench-mysql` | 角色工作台在 `MDM_IDENTITY_READ_MODEL=mysql` 下从 MySQL 身份读模型读取当前用户、角色、部门和权限；在 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 下从流程治理 MySQL repository 读取质量问题和映射待办 | 使用 fake repository，不连接真实库 |
| `npm run test:activity` | 治理活跃热力图 API：本人/部门/全量视图、权限边界、治理动作来源汇总，以及 `MDM_IDENTITY_READ_MODEL=mysql` 下的管理视图权限判断 | 使用 fake repository，不连接真实库 |
| `npm run perf:local-concurrency` | 本机 10 并发性能验收：登录、本人信息、角色工作台、流程治理 Sankey、活动热力图，并输出 p50/p95/max、状态码和响应体大小 | 连接运行中的本机 MDM；只做登录和读接口，不输出密码或 Cookie |
| `npm run test:data-map-mysql` | 数据地图字段域 MySQL schema、repository 和上下文 API | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:field-entries-mysql` | 字段台账公开接口直接读取 Data Map MySQL repository，`mapping_id` 仅作 `context_id` 别名 | 使用 fake repository，不连接真实库 |
| `npm run test:field-identities-mysql` | 字段黄金源维护和确认接口直接读取 Data Map MySQL repository | 使用 fake repository，不连接真实库 |
| `npm run test:data-map-import-export-mysql` | 字段导入、字段导出和黄金源进度接口直接读取 Data Map MySQL repository | 使用 fake repository 和内存 Excel，不连接真实库 |
| `npm run test:terminology-mysql` | 术语治理 schema、repository 和 `/api/terminology` 接口直接读取 MySQL repository，不再读取 SQLite `terms` | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:mappings-mysql` | 旧映射审批 schema、repository 和 `/api/mappings` 接口直接读取 MySQL repository，不再读取 SQLite 映射、字段、术语或版本日志表 | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:conflicts-mysql` | 冲突治理 schema、repository 和 `/api/conflicts` 接口直接读取 MySQL repository；字段冲突来自 Data Map 字段域，术语冲突来自术语 MySQL 表 | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:todos-mysql` | 通用待办 schema、repository 和 `/api/todos` 接口直接读取 MySQL repository，不再读取或写入 SQLite `todos` | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:versions-mysql` | 平台通用版本记录 schema、repository 和 `/api/versions` 接口直接读取 MySQL `mdm_change_sets` / `mdm_version_log` | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:activity-mysql` | 治理活跃热力图从已迁移 MySQL 表汇总活动来源，不再读取 SQLite 版本、术语、冲突或待办表 | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run smoke:process-governance-mysql` | 可选真实 MySQL 冒烟：初始化 schema、导入 `docs/company-sankey-data.json`、读回 Sankey | 只有设置 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时写 MySQL；否则跳过 |
| `npm run smoke:data-map-mysql` | 可选真实 MySQL 冒烟：初始化 schema、写入 Data Map context、字段和黄金源并读回 | 只有设置 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时写 MySQL；否则跳过 |
| `npm run test:mappings` | 旧映射审批 MySQL 定向回归 | 等同 `npm run test:mappings-mysql`；不连接真实库 |
| `npm run test:conflicts` | 冲突治理 MySQL 定向回归 | 等同 `npm run test:conflicts-mysql`；不连接真实库 |
| `npm run test:project-roles` | 七个固定MDM工作角色、管理员业务只读、旧角色退休和无通配权限约束 | 源码和固定模型只读检查 |
| `npm run test:frontend` | 前端静态资产和关键脚本片段 | 只读 |

## 2. 安全和审计脚本

| 脚本 | 作用 | 副作用 |
|---|---|---|
| `audit-fixed-default-passwords.js` | dry-run 检查历史库中是否仍有旧固定初始密码账号 | 只读，不输出密码哈希 |
| `test-password-audit.js` | 验证历史口令审计脚本只读、脱敏 | 使用隔离遗留本地库 |
| `audit-route-write-permissions.js` | 在禁止建池/SQLite/监听的条件下加载真实Express注册，展开多行声明、动态动作和all；区分身份写入、业务写入、明确停用、前置遮蔽、公共/本人服务、内存校验和隔离遗留；逐项追溯权限、部门、状态、并发及审计源码 | 只读；`--json`输出完整锚点及摘要，分类不是权限白名单；未追溯注册或未分类项使命令失败，不据静态信号宣称事务验收 |
| `test-route-write-audit.js` | 验证盘点完整性、实际分类、五类控制证据及仓储方法行号可定位 | 只读；不连接MySQL |
| `test-security-routes.js` | 真实Express/会话/CSRF，固定角色正向办理及admin/无权/跨部门拒绝、首次改密、停用与授权版本失效；历史入口410 | 显式合成身份与业务仓储，随机回环端口；真实MySQL与SQLite均被阻断；不代表真实仓储事务 |
| `test-user-password-scripts.js` | 两个废弃建号脚本分别在已存在及不存在库场景拒绝执行；检查退出标识、DB/Excel模块不加载、文件摘要不变及无新增文件 | 自有临时SQLite哨兵文件；不恢复废弃建号行为，不读取真实花名册 |

第04阶段命令从本应用目录执行。`test:launch-stage04`与`test:security`的每次结果写入仓库被忽略的`artifacts/mdm-3000-launch/stage04-<时间戳>/`，包含脚本/日志摘要、退出码及实际依赖类型。完整命令中的真实MySQL步骤必须通过才构成本阶段聚合通过；`npm run test:launch-stage04 -- --simulated-only`仅运行模拟部分，不能作为完整验收结论。

测试环境不继承调用终端的MySQL、会话或试点变量，不读取私有env。真实验证用`--pull never`新建`infomat.stage04`唯一标记容器，数据仅存tmpfs，无绑定目录或已有卷；临时端口不使用3000/3001/3306/3307/5173。正常结束和可捕获失败均核对容器ID及标记后清理自身资源。若测试被外部强制中止，先按本轮容器名和标记核对归属，再处理残留；不得按端口或全局标签批量删除其他轮次/人员的资源。第03阶段HTTPS/Windows运维证据按未变更范围复用，第04阶段合成V3/V7验证不能替代第06阶段真实历史数据、备份恢复或业务验收。

## 3. 初始化、种子和维护脚本

| 脚本 | 作用 | 副作用 |
|---|---|---|
| `init-mysql-schema.js` | 显式初始化MySQL及补齐已有版次、证据、表单与流转结构，包含固定模型、术语种子及历史记录补齐；不覆盖现有账号密码 | 写MySQL结构、种子和迁移记录；不是应用启动动作。第02阶段仅同步表单补齐入口，未对任何真实实例执行 |
| `bootstrap-admin.js` | 仅在空身份库创建一次受控`ADMIN001`管理员入口；已有人员、账号或有效管理员时拒绝 | 写MySQL；一次性临时密码只在响应中显示 |
| `migrate-rbac-raci-v2.js --dry-run` | 盘点人员、账号、部门、角色、重复标识、孤立关系、缺失部门和缺失最终负责人 | 只读MySQL |
| `migrate-rbac-raci-v2.js --apply` | 备份身份授权数据，写入固定模型，仅保留`ADMIN001`管理员，停用其他旧账号并清除旧会话 | 写MySQL；执行前必须先dry-run |
| `migrate-rbac-raci-v2.js --rollback` | 在迁移后尚无新授权事件时按批次恢复账号、角色、权限和授权关系 | 写MySQL；必须指定迁移批次 |
| `migrate-rbac-raci-v2.js --compensate` | 已发生新授权事件后按批次补偿撤销迁移影响，不覆盖后续真实审计 | 写MySQL；必须指定迁移批次 |
| `migrate-process-governance-unified.js --dry-run` | 盘点完整流程JSON、冲突和事件迁移影响 | 只读MySQL |
| `migrate-process-governance-unified.js --apply` | 备份并迁移完整流程JSON、承接冲突和只追加事件 | 写MySQL；执行前必须先dry-run |
| `migrate-process-governance-unified.js --rollback` | 新版尚无业务写入时整批回滚 | 写MySQL；存在新业务写入时拒绝 |
| `migrate-process-governance-unified.js --compensate` | 新版已有业务写入时执行受控补偿 | 写MySQL；保留业务历史和审计 |
| `import-process-governance-mysql.js` | 将 `docs/company-sankey-data.json` 导入 MySQL 流程治理读模型，可用 `--a1-source` 显式补充 A1 Markdown | 写 MySQL 流程治理读模型、源文件、MDM 要求、证据和交互链表，不写流程输入基线 |
| `smoke-process-governance-mysql.js` | 可选真实 MySQL 端到端 smoke：初始化、导入、读回 Sankey | 缺少 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时跳过；不读取 `MDM_DB_PATH` |
| `smoke-data-map-mysql.js` | 可选真实 MySQL 端到端 smoke：初始化、写入 Data Map context、字段、黄金源并读回 | 缺少 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时跳过；不读取 `MDM_DB_PATH` |
| `import-process-input-baseline-review-mysql.js` | 将 `artifacts/process-input-baseline-review/<run-id>` 导入 MDM 输入基线问题复核表 | 写 MySQL `process_input_baseline_review_*` 表 |
| `init-legacy-sqlite-db.js` | 历史本地库初始化实现，只通过`npm run legacy-sqlite:init-db`服务遗留测试链 | 必须设置`MDM_ALLOW_LEGACY_TEST_MODE=1`并通过`MDM_DB_PATH`指定隔离库；拒绝写共享`data/platform.db` |
| `init-db.js` | 旧MySQL管理员初始化兼容脚本 | 不作为SQLite入口；正式空身份库初始化使用`npm run bootstrap:admin` |
| `setup-local-baseline.js` | 历史本地库测试基线入口，不是正式账号初始化入口 | 只允许隔离遗留测试；不得用于正式开户 |
| `seed-demo-data.js` | 历史演示数据入口；账号写入已拒绝 | 不得用于正式开户 |
| `setup-mdm-project-users.js` | 已退休的项目角色批量开户入口 | 执行即拒绝，不写账号 |
| `import-mdm-users.js`、`import-roster-users.js` | 已退休的Excel/花名册批量开户入口 | 执行即拒绝，不写账号 |
| `check-escalations.js` | 检查 MySQL 冲突治理记录中已超期的协调中冲突，并通过 `conflictMysqlRepository` 升级 | 写 MySQL 冲突治理和待办表，不读取 `MDM_DB_PATH` |

## 4. 流程治理承接脚本

| 脚本 | 作用 | 副作用 |
|---|---|---|
| `sync-organization-structure.js` | 按脚本中的固定组织和领导办公室/人员安排同步，只检查组织Markdown包含相应名称与代码；不读取最新花名册或虚拟单位定义 | 写当前数据库；不是2026-09-11新版人员真源的导入入口，不因文档更新而执行 |
| `sync-process-governance-org.js` | 遗留SQLite流程治理组织同步实现；公开命令为`npm run legacy-sqlite:sync-process-org` | 写`MDM_DB_PATH`指定的隔离SQLite库 |
| `import-process-governance.js` | 遗留SQLite流程治理快照导入实现；公开命令为`npm run legacy-sqlite:import-process-governance` | 写`MDM_DB_PATH`指定的隔离SQLite库；不属于正式主线 |
| `import-process-governance-mysql.js` | 导入 `docs/company-sankey-data.json` 到 MySQL 流程治理读模型 | 写 MySQL；不读取 `MDM_DB_PATH` |
| `check-process-governance.js` | 遗留SQLite流程治理快照检查实现；公开命令为`npm run legacy-sqlite:check-process-governance` | 只读`MDM_DB_PATH`指定的隔离SQLite库 |
| `lib/processGovernanceImport.js` | 流程治理导入共享实现 | 被导入脚本和测试调用 |
| `test-process-governance-mysql-repository.js` | 验证流程治理 MySQL 读模型 repository 可替换活动快照并读回 Sankey、A1、源文件、MDM 要求、证据和交互链数据 | 使用 fake MySQL pool，只读仓库；不切换现有 Express 路由 |
| `test-process-governance-mysql-import.js` | 验证 `docs/company-sankey-data.json` 形态可转成 MySQL 读模型 bundle，并包含源文件、MDM 要求、证据和显式 A1 Markdown 数据 | 使用 fake repository，只读仓库 |
| `test-process-governance-mysql-smoke.js` | 验证真实 MySQL smoke 的跳过条件和可注入执行路径 | 使用 fake pool/repository，只读仓库 |
| `test-process-governance-sankey-mysql-api.js` | 验证 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 时流程治理只读接口读取 MySQL repository | 覆盖 `/snapshots`、`/current`、`/sankey`、`/a1`、`/source-files`、`/mdm-requirements`、`/evidence`、`/chains`；使用 fake repository，默认不开启该切换 |
| `test-process-design-mysql-api.js` | 验证 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 时 `/api/process-design/*` 使用 MySQL 路由，不加载 `server/db.js`，并覆盖制度编号 lookup、A 版创建、重复编号阻断、B/C 版完整重写草稿、发布替代、目的/范围、术语、草稿级 L1/L2 既有映射枚举、流程明细继承 L1/L2、业务行为详情、跨部门承接回写、附表结构、字段新增/修改/删除/排序、自动编号、字段空格校验、证据、Markdown 草案、提交、评审、发布路径；同时覆盖术语/流程更新删除、流程有关联行为时删除 409、业务行为改挂流程、作废、物理删除限制、跨部门降级限制和只读状态 | 使用 fake process-design repository 和 fake MySQL 身份 repository，不连接真实库 |
| `test-process-governance-issue-pool-mysql-permission-api.js` | 验证统一问题池详情、点位动作、关闭/重开和术语待办均通过 MySQL 身份、角色、部门和权限判断，越权请求不会进入写仓储；当前 `test:process-governance-issue-pool` 只纳入 MySQL/fake-repo 路径和前端入口检查 | 使用 fake issue-pool repository 和 fake MySQL 身份 repository，不连接真实库 |
| `test-process-input-baseline-review-mysql.js` | 验证 MDM 输入基线问题复核 MySQL repository 的导入、查询和结构化决策保存 | 使用 fake MySQL pool，只读仓库 |
| `test-process-input-baseline-review-api.js` | 验证 MDM 正式输入基线问题复核 API 保存结构化字段、以后端会话写 reviewer、内部抽取锚点不显示给业务用户，也不误显示为页码或原文段落号 | 使用 fake repository 和临时待确认目录 |
| `test-identity-mysql-repository.js` | 验证人员、账号、当前有效角色、权限、范围和`auth_version`会话校验只读取MySQL身份链路 | 使用fake MySQL pool，不连接真实库 |
| `test-org-me-mysql-api.js` | 验证登录和`/api/org/me`返回人员、账号、部门、全部有效角色、权限、数据范围和模型版本 | 使用fake repository，不连接真实库 |
| `test-roles-mysql-api.js` | 验证固定角色模型可读，角色、权限和矩阵写请求返回`CORE_GOVERNANCE_MODEL_READ_ONLY` | 使用fake repository，不连接真实库 |
| `test-auth-mysql-permission.js` | 验证 `MDM_IDENTITY_READ_MODEL=mysql` 时通用 `requirePermission` 从 MySQL repository 取权限和字段约束 | 使用 fake repository，不连接真实库 |
| `test-access-mysql-role-codes.js` | 验证 `MDM_IDENTITY_READ_MODEL=mysql` 时 `access.js` 可通过异步 helper 从 MySQL 身份读模型读取角色码 | 使用 fake repository，不连接真实库 |
| `test-access-mysql-permissions.js` | 验证 `MDM_IDENTITY_READ_MODEL=mysql` 时 `access.js` 的管理员、全局查看、复核权限和待办处理判断可通过异步 helper 读取 MySQL 权限 | 使用 fake repository，不连接真实库 |
| `test-import-rbac-mysql-api.js` | 验证 `MDM_IDENTITY_READ_MODEL=mysql` 时 RBAC 批量导入写接口不会在 MySQL 鉴权后回落 SQLite 写入 | 使用 fake repository，不连接真实库 |
| `test-role-workbench-mysql-api.js` | 验证角色工作台在 MySQL 身份读模型下使用仓储返回的角色、部门名和 `data:view_all` 权限 | 使用 fake repository，不连接真实库 |
| `test-role-workbench-process-governance-mysql-api.js` | 验证角色工作台在流程治理 MySQL 读模型下从 repository 读取质量问题和映射待办 | 使用 fake repository，不连接真实库 |
| `test-activity-mysql-repository.js` | 验证治理活跃热力图从 MySQL 活动来源表汇总动作，并断言不访问 SQLite 版本、术语、冲突或待办表 | 使用 fake MySQL pool，不连接真实库 |
| `test-activity-mysql-api.js` | 验证 `/api/activity/heatmap` 保持公开路径和响应口径，同时通过审计 repository 访问活动数据 | 使用 fake repository，不连接真实库 |
| `test-activity-heatmap-mysql-identity-api.js` | 验证 `MDM_IDENTITY_READ_MODEL=mysql` 时治理活跃热力图管理视图权限来自 MySQL 身份 helper，不回落 SQLite 角色/权限表 | 使用 fake repository，不连接真实库 |
| `test-data-map-mysql-repository.js` | 验证 Data Map MySQL repository 的上下文、字段、命名校验、黄金源、导入批次和进度统计 | 使用 fake MySQL pool，不连接真实库 |
| `test-data-map-contexts-api.js` | 验证 `/api/data-map/contexts` 上下文创建、查询和更新 | 使用 fake repository，不连接真实库 |
| `test-field-entries-mysql-api.js` | 验证 `/api/field-entries/*` 字段接口不再读取遗留字段表 | 使用 fake repository，不连接真实库 |
| `test-field-identities-mysql-api.js` | 验证 `/api/field-identities/*` 黄金源接口不再读取遗留字段表 | 使用 fake repository，不连接真实库 |
| `test-data-map-import-export-mysql-api.js` | 验证字段导入、导出和黄金源进度均通过 Data Map repository | 使用 fake repository 和内存 Excel，不连接真实库 |
| `test-terminology-mysql-repository.js` | 验证术语治理 MySQL repository 的术语类型、流程治理读模型范围、术语创建/更新/审批/删除，并断言不访问 SQLite `terms` | 使用 fake MySQL pool，不连接真实库 |
| `test-terminology-mysql-api.js` | 验证 `/api/terminology` 保持公开路径和响应口径，同时通过 terminology repository 访问术语数据 | 使用 fake repository，不连接真实库 |
| `test-mappings-mysql-repository.js` | 验证旧映射审批 MySQL repository 的创建、草稿更新、提交、审批、退回、发布、详情和删除，并断言不访问 SQLite 映射、字段、术语或版本日志表 | 使用 fake MySQL pool，不连接真实库 |
| `test-mappings-mysql-api.js` | 验证 `/api/mappings` 保持公开路径和响应口径，同时通过 mapping repository 访问映射审批数据 | 使用 fake repository，不连接真实库 |
| `test-conflicts-mysql-repository.js` | 验证冲突 MySQL repository 可检测 Data Map 字段冲突、术语冲突并完成指派、协调和终裁；断言不访问 SQLite 字段、术语、待办或冲突表 | 使用 fake MySQL pool，不连接真实库 |
| `test-conflicts-mysql-api.js` | 验证 `/api/conflicts` 保持公开路径和响应口径，同时通过 conflict repository 访问冲突治理数据 | 使用 fake repository，不连接真实库 |
| `test-conflicts-mysql-identity-api.js` | 验证 `/api/conflicts` 的权限判断可读取 MySQL 身份权限 helper，不依赖 SQLite 身份数据 | 使用 fake repository，不连接真实库 |
| `test-check-escalations-mysql.js` | 验证超期冲突升级维护脚本通过 conflict repository 工作，不加载 SQLite 本地库 | 使用 fake repository，不连接真实库 |
| `test-todos-mysql-repository.js` | 验证通用待办 MySQL repository 的创建、查询、完成和删除，并断言不访问 SQLite `todos` | 使用 fake MySQL pool，不连接真实库 |
| `test-todos-mysql-api.js` | 验证 `/api/todos` 保持公开路径和响应口径，同时通过 todo repository 访问待办数据 | 使用 fake repository，不连接真实库 |
| `test-versions-mysql-repository.js` | 验证平台通用审计 repository 可写入和读取 `mdm_change_sets` / `mdm_version_log`，并断言不访问 SQLite `change_set` / `version_log` | 使用 fake MySQL pool，不连接真实库 |
| `test-versions-mysql-api.js` | 验证 `/api/versions` 保持公开路径和响应口径，同时通过审计 repository 访问版本数据 | 使用 fake repository，不连接真实库 |

## 5. 单项测试脚本

| 类别 | 脚本 |
|---|---|
| 基础路由 | `test-org-route.js`、`test-catalog-routes.js`、`test-delete-routes.js`、`test-term-version-routes.js` |
| 映射与字段 | `test-mappings-mysql-repository.js`、`test-mappings-mysql-api.js`、`test-mapping-routes.js`、`test-import-route.js`、`test-export-route.js`、`test-data-map-mysql-repository.js`、`test-data-map-contexts-api.js`、`test-field-entries-mysql-api.js`、`test-field-identities-mysql-api.js`、`test-data-map-import-export-mysql-api.js` |
| 冲突和角色 | `test-conflicts-mysql-repository.js`、`test-conflicts-mysql-api.js`、`test-conflicts-mysql-identity-api.js`、`test-todos-mysql-repository.js`、`test-todos-mysql-api.js`、`test-project-role-access.js`、`test-role-workbench-api.js`、`test-role-workbench-mysql-api.js`、`test-role-workbench-process-governance-mysql-api.js`、`test-page-workflows-api.js` |
| 流程治理 | `test-process-governance-*.js`、`test-process-mapping-workspace-import.js` |
| 前端和视图 | `test-frontend-assets.js`、`test-views-routes.js`、`test-views-sankey-filters.js`、`test-activity-mysql-repository.js`、`test-activity-mysql-api.js`、`test-activity-heatmap-mysql-identity-api.js` |
| 冒烟 | `smoke-test.js`、`smoke-master-data.js`、`smoke-rbac.js`、`smoke-integration.js` |

## 6. 第05阶段独立验收

`test:stage05-browser` 同时验证正式版本的程序文件下载，以及核对意见跨修订沿用和不同时区下的时间读取；证据按每次运行写入新的 `artifacts/mdm-3000-functional/browser-<时间戳>/`，保留既有结果。需要人工查看已跑通的合成案例时，运行 `node scripts/test-stage05-browser.js --keep-open`；脚本完成检查后在 Edge 保留已登录的合成账号页面，按 Enter、SIGINT 或关闭浏览器后清理本次临时应用和自有数据库。该页面使用临时本机端口和合成数据，不连接现库，不代替正式3000或业务验收。

`npm run test:process-v7-procedure` 是纯内容生成检查，不连接数据库；`test:process-design-mysql-api` 包含固定版本下载、部门范围、历史版本、撤销状态和摘要异常的接口回归。

从`apps/mdm-platform`执行：

```powershell
npm run test:launch-stage05
# 仅静态、替身及自有临时SQLite检查，不执行真实MySQL或Edge
npm run test:launch-stage05 -- --simulated-only
# 只复验真实合成MySQL待办，或真实Edge办理流程
npm run test:stage05-mysql-isolated
npm run test:stage05-browser
```

`test-stage05-local.js`展开并去重前端、固定角色、流程治理、主线、角色工作台、会话运行和MySQL边界套件。模拟子进程净化环境，并预加载`blockRealMysql.js`；内层npm测试继承该阻断，不能因机器默认配置连到真实库。`--failed-from <此前test-results.json绝对路径>`仅从上述已核对列表挑选前次失败项，不执行证据文件中的任意命令；定向结果不能单独代表完整聚合。

两个真实入口复用第04阶段`freshMysql`：只创建唯一标记、tmpfs、随机回环端口的MySQL 8.4容器，要求Docker及本机已有`mysql:8.4`镜像，使用`--pull never`。沿用的容器前缀、标记和库名含stage04，这是测试助手的名称，不表示连接第04阶段留下的实例。结构初始化、合成身份授权、业务写入及临时表改名故障只在新容器内执行；应用运行账号只有SELECT/INSERT/UPDATE/DELETE。不会使用真实配置、已有数据库、已有卷或共同启动脚本。

Edge入口使用已安装的`playwright`，找不到应用内运行库时使用已有Playwright CLI附带的运行库；不自动安装或下载浏览器。只启动自己的Microsoft Edge和随机端口应用，内容可视区1699×828、100%缩放，并补充390×844。测试包括两份完整合成案例，其中一份由测试准备关闭，供真实案例切换；业务办理始终通过公开HTTP及浏览器。故障注入用于网络/503和正式意见409保护，部门意见409来自另一真实合成会话上传新修订，401来自清除本轮Cookie。

浏览器验证保存截图和操作断言，不覆盖人工中文输入法、真实人员或业务验收。主入口结果在`artifacts/mdm-3000-launch/stage05-<时间戳>/test-results.json`；定向HTTP入口默认写入`stage05-20260910/`，重复运行前应保留需要的旧结果。Edge结果及截图使用上述每次独立的新目录，不覆盖既有证据。正式业务文件不受影响。

测试在正常结束及可捕获异常中停止自己的HTTP进程，核对具体容器ID与唯一标记后清理；浏览器也在finally关闭。外部强制结束后，只能按本轮确切归属核对残留，不批量删除容器或结束其他Node/Edge进程。`test-stage05-mysql-isolated.js --serve`仅供保持本轮合成环境进行人工检查，通过终端输入或它返回的专属停止文件结束，不可作为正式服务入口。

## 7. 第06阶段迁移与恢复核对

从本应用目录执行以下已授权的本地入口，输出目录使用新的准确路径：

```powershell
npm run prepare:launch-stage06 -- --output E:\CA001\Infomat\artifacts\mdm-3000-launch\stage06-20260910\formal-preparation
npm run test:stage06-preflight
npm run test:stage06-mysql-isolated
```

`prepare`不连接MySQL、不读取配置文件，生成可执行只读SQL和正式目标待填报告；同名文件拒绝覆盖。SQL原始结果可能包含获准读取的业务正文，应保存在批准的受控位置。优先使用下面的报告命令在内存中计算数量、稳定标识、状态和摘要；报告不输出业务正文。

只有另行获准读取准确正式目标、并由维护身份安全注入`MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`后，才能执行`npm run inspect:launch-stage06 -- --target <host:port/database> --output <新的受控目录>`。目标必须与注入变量完全相同；无默认库，不读私有env，不自动初始化，错误不回显驱动消息。单连接在REPEATABLE READ只读一致性快照中读取，整体最多60秒；窗口内不得有DDL，超时不放宽门槛。报告保留实际元数据、M0/M1/M2/会话及后续治理检查、正式/预览/审核/身份摘要和引用异常。口令摘要、会话ID、会话JSON及身份迁移备份正文不读取。`localSource`只是本地源码，`runningApplication`继续待核验；报告始终不授权DDL、不宣称正式备份已恢复。

真实测试复用现有迁移实现、`freshMysql`及第04阶段公开HTTP场景，不另建模型。第06阶段使用`mdm-stage06-<UUID>`容器、`infomat.stage06=<UUID>`标签、`stage06_isolated`库；mysql:8.4镜像必须已存在，禁止自动拉取。每个实例只使用tmpfs和随机回环端口，不挂载已有目录/卷，不使用3000/3001/3306/3307/5173。源备份仅由本轮合成实例产生，在另一新实例恢复并比较后才演练迁移；发布后再在第三实例恢复并比较。备份命令通过环境传递一次性合成凭据，不放进命令参数或输出。

测试涵盖M1/M2/会话首次和重复应用、部分结构、实际DDL之后的中断、漂移拒绝、历史V3及缺失审核依据保留、非空回退拒绝；在迁移后恢复库启动真实应用和持久会话，通过登录、CSRF及公开HTTP验证预览、提升、提交、退回、审核、发布故障回滚、并发唯一和固定版本完整读回。运行账号无DDL权限。后续治理因首发范围待定仅检查未应用及未回填，不开启或实施其迁移。没有浏览器变更，第05阶段Edge和输入保护证据按未受影响范围复用。

结果写入新建的`artifacts/mdm-3000-launch/stage06-<毫秒时间戳>/`，包含合成备份、恢复前后表摘要、逐项结果和合成目标报告。它不证明真实旧数据恢复。正常结束或可捕获失败后，核对具体容器ID、标签和本轮归属再删除自身容器；失败证据目录保留。外部强制终止时，先按证据中确切ID和标签核对残留，不批量清理其他资源。旧M0备份脚本的固定源、用户Documents备份路径、旧身份会话和清理方式与该入口不同，不复用其默认执行方式。

## 8. 第07阶段发布准备入口与执行限制

2026-09-11本轮只形成[单流程发布作业单](../../../docs/plans/2026-09-09-mdm-3000-launch/03-发布与恢复.md#11-第07阶段单流程试点发布准备2026-09-11)，未新增应用脚本或改变运行/迁移命令。候选源码和完整文件摘要、依赖状态、最小身份SQL、正式目标/恢复报告及证据位于`artifacts/mdm-3000-launch/stage07-20260911/`。本地材料使用现有prepare入口重新生成到新目录，未覆盖第06阶段输出；prepare不连接数据库。

用户已确认工作包纳入首发。第7节描述第06阶段当时未应用工作包，不代表现在可以免验工作包。关口A产生准确不可变V7版本后，关口B再核对六表必要性、覆盖该版本的恢复点及工作包专项MySQL/浏览器验证；不猜ID、不回填所有历史工作包。实际流程、人员及正式目标仍未确定。

运维`service:*`会以固定JSON覆盖继承的MySQL目标；M1/M2/工作包旧CLI还会加载私有env，不能在其后附加`--target`就声称受到目标保护。正式执行须使用获准新布局、核对冻结的固定目标配置，并确认私有env不存在；Secret经批准环境注入。正式读取优先用显式目标的stage06 inspect，迁移和真实运行各需对应批准。不得从本轮候选112项源码清单直接打包整个脏工作区或连跑所有维护脚本。

## 9. 修改规则

1. 新增写数据库脚本时，默认使用 MySQL 配置；若仍服务遗留本地库，必须明确说明 `MDM_DB_PATH` 只是迁移过渡期隔离机制。
2. 新增测试脚本时，优先使用 `testHelpers/isolatedDb`，不要写共享 `data/platform.db`。
3. 新增安全红线时，优先接入 `npm run test:security`。
4. 修改流程治理导入链路后，运行 `npm run test:process-governance` 和 `npm run test:mainline`。
5. 不在本目录提交日志、数据库、Excel 临时文件或生成缓存。

前端体验定向回归：`node scripts/test-frontend-ux.js`，覆盖只读／本部门／跨部门操作入口、指引与待办分离、中文状态与已知旧提示模板，以及搜索回车的输入法保护；使用内存替身，不访问数据库。

### P12 交接关系验证

- npm.cmd run test:handoff-analysis-rules：仅合成固定快照，预加载真实MySQL阻断，检查同名不同身份、组合标识、缺映射、格式/枚举/版次矛盾、单位转换说明、合法多接收方和未知主链边界。
- npm.cmd run test:handoff-analysis -- --output <本批次新证据目录>：复用test-design-handoffs.js的自有tmpfs MySQL、合成身份、随机端口和Edge夹具，额外运行真实独立worker并检查固定证据、权限、重跑、缺口及两端定位。可用--no-browser只查后端，但不能据此声称界面已验证。只清理本次明确归属的资源。
- 无外部原件、正式数据库、3001操作、模型调用或真实通知。证据和截图写入指定artifacts目录。

### P13跨运行对照验证

- `npm.cmd run test:analysis-comparison`：纯合成快照及真实P11规则输出，预加载blockRealMysql；不连接数据库、不启动服务、不读外部材料、不调用模型。
- `npm.cmd run test:analysis-comparison-mysql -- --output <本批次下的新证据目录>`：复用P09隔离存储测试，并启用P13仓储验证。建立自有唯一标签、tmpfs及随机回环端口的MySQL和合成HTTP夹具，finally仅清理本次资源；不启动worker、浏览器或正式服务。输出P09回归results.json及P13的p13-results.json、p13-comparisons.json，包含历史保留、权限、完整性、并发与不修改正式问题/待办的核对。

`server/analysisComparison.js`只接收已授权且已校验完整性的运行快照；生产调用方使用仓储compareAnalysisRuns，不直接接受客户端提交的快照。P13未开放HTTP对照接口。

### P14分析HTTP验证

`npm.cmd run test:analysis-api -- --output <同批次下不存在的新证据目录>`复用test-analysis-runs.js的P09存储夹具，增加testHelpers/analysisApiVerification.js。建立自有标签tmpfs MySQL、随机回环HTTP端口及合成身份；P14检查完成后恢复内存备份，再继续原P09回归。finally只清理本次MySQL及HTTP，不连接正式库，不启动worker、浏览器或3001，不发送通知或模型请求。

验证来源选择/接收、创建入队原子性、并发幂等、409、取消及P09兼容、分层响应、当前来源范围变化、匿名/无权/失效身份、管理员多角色只读、ID越权、部分结果、差异、上传/JSON限额、CSRF、静态路径与导出范围。输出results.json、p14-results.json、p14-projections.json、p14-partial-and-diff.json及夹具日志。P13的HTTP未开放说明为历史状态；P14现已注册受限路由，正式开启和业务验收不能由测试代替。

### P15分析检查台验证

`npm.cmd run test:analysis-workbench -- --output <同批次下不存在的新证据目录>` 运行 P14 HTTP、P15 Edge 及原P09存储回归。执行前运行 `npm.cmd run build:frontend`。复用自有tmpfs MySQL与随机回环HTTP夹具，P15扩展仅启动本次自有Edge和独立worker，所有身份、材料和写入均为合成隔离数据。finally停止自有worker和浏览器，恢复内存备份，再继续旧记录保护检查；无正式数据库、现有服务、模型或通知调用。

新增 `testHelpers/analysisWorkbenchVerification.js` 覆盖页面创建/取消、真实worker、部分覆盖、两端与字段证据、对照和过滤导出、刷新深链接、返回筛选、图形箭头/间距/缩放/空图、Edge 1699×828及390×844、错误输入保护、身份重登、旧异步、只读/越权及静态泄露检查。输出 p15-browser-results.json、p15-worker-result.json、p15-filtered-export.json、p15-geometry.json、PNG截图、worker事件和清理记录。错误注入与真实API场景分别记录；浏览器自动化不替代人工业务验收。

`npm.cmd --prefix frontend test` 同时检查视图默认尝试过滤、空结果导出、证据裁剪及服务端目录生成请求，保留原前端测试。

## P16 分析发现确认及问题关联

- `npm.cmd run manage:analysis-issues -- --target 127.0.0.1:<隔离端口>/<隔离库>`：默认dry-run；另支持`--inspect`和显式`--apply`。仅从已明确提供的MySQL环境变量读取目标，不加载私有.env、不启动服务、不运行旧问题生成器。apply只创建两张增量关系/审查表及迁移标记，不回填旧数据；MySQL DDL中断后先inspect，再按原结构续建。
- `npm.cmd run test:analysis-issues -- --output <artifacts下全新目录>`：P09隔离套件加P16专项；合成数据下验证迁移/CLI、并发确认、幂等、证据/范围/来源、创建及多发现关联、旧入口封堵、备份恢复和Edge界面。测试会创建自有带标记tmpfs MySQL、随机端口HTTP、独立worker及浏览器；结束关闭自有资源，不使用3000、3001、5173或共享库。备份只在内存，输出JSON、日志和截图不含测试口令。
- 旧问题仓储读取/写入保护采用事务连接；来源解析单元测试的替身相应提供事务生命周期。旧未关联问题仍可读写；关联问题通过受限新API读取，旧写入保持拒绝。真实关闭授权与P17待办闭环不在本步开启。

### P17问题办公室待办

- `npm.cmd run manage:analysis-tasks -- --target host:port/database`：默认dry-run，支持显式 `--inspect`、`--dry-run` 或 `--apply`。只从显式环境变量取得连接，不加载私有.env；apply只增量创建问题—办公室待办关系及迁移标记，不回填。复用现有办公室及P16问题依赖，漂移拒绝；不自动调用其他迁移。
- `npm.cmd run test:analysis-tasks -- --output <artifacts下全新目录>`：P09隔离夹具及P17专项，使用自有带标签tmpfs MySQL、随机回环HTTP、合成组织/花名册导入及Edge。验证CLI/DDL中断与续建、事务回滚、交办幂等、权限、来源快照、成员失效、普通待办兼容、任务done不关闭问题、输入保护及内存备份恢复。结束只清理本次资源，不启动worker、模型或真实通知。
- P17续步依据固定合同第27节实施逐问题指定、条件确认、独立复核和重开。`npm.cmd run manage:analysis-closure -- --target host:port/database` 默认dry-run；显式apply只增加复核事件表、历史链头及迁移标记，依赖问题待办结构。无启动DDL、原数据回填或新角色。
- `test:analysis-tasks` 同时验证复核迁移、本人指定、角色候选与历史办理分离、指定暂停后不得自动恢复、任务/来源/条件修订、证据摘录、关闭事务回滚与幂等、复核不通过、负责人重开、历史恢复和真实Edge闭环。测试只使用自有隔离MySQL和合成身份；不得据此声称正式开启或业务验收。


### P18 Excel证据验证与迁移

- npm run test:excel-evidence：合成OOXML解析、定位、公式缓存、损坏/空提取和限额检查；不读外部文件、不联网或连库。
- npm run test:excel-evidence-integration -- --output <artifacts下新目录>：复用P09自有带标签tmpfs MySQL和随机回环HTTP，使用合成身份/工作簿，启动自有worker与Edge，验证增量迁移、API、固定摘要、关联/权限/幂等、证据浏览和问题跳转。结束恢复内存备份并回收本轮资源；禁止指向已有数据库或业务端口。
- npm run manage:excel-evidence -- --target HOST:PORT/DATABASE：默认dry-run，可用--inspect/--apply；必须显式环境变量，不加载.env。正式实例需要单独授权，完整备份先于变更。

用户原始工作簿只在本批次verify-sample.cjs按指定路径只读核对；样本业务单元格不写入集成夹具、公共构建或测试报告，报告仅保存摘要、工作表结构和覆盖计数。

## DOCX证据检查与迁移（P18）

- npm.cmd run test:word-evidence：内存合成DOCX，验证结构顺序、嵌套表格、重复标题、无虚构页码、空提取、定位失败、域缓存、损坏、DOC/伪改名拒绝、活动内容、限额/并发与规则覆盖。纯计算，无HTTP、数据库、Word自动化、外链或私有配置。
- npm.cmd run test:word-evidence-integration -- --output <artifacts下全新目录>：自有带唯一标签的tmpfs MySQL、随机回环HTTP、合成身份和真实Edge/worker。验证迁移、重复/中断/漂移、权限、CSRF、幂等、事务回滚、DOC拒绝、固定快照、显式关联、证据浏览和原问题追溯。结束恢复内存备份并回收本次资源，不操作既有服务或数据库。可在同一入口增加--p14和--p18核对原API及Excel；Word证据文件名使用p18-word-前缀，避免覆盖Excel结果。
- npm.cmd run manage:word-evidence -- --target HOST:PORT/DATABASE：默认dry-run，支持--inspect/--apply。只接受明确目标及显式MySQL环境变量，不加载.env，无启动DDL。正式实例另获授权，已有数据须先完整备份。

DOCX测试不转换原.doc，不把合成数据当作真实样本或业务验收。格式严格限定.docx；根关系与正文类型不匹配、二进制DOC伪改名均拒绝。CPU线程结束即回收，集成测试清理由已有所有权检查执行，禁止批量清理Node、Edge或容器。

### P18 PDF证据维护与验证

- npm.cmd run test:pdf-evidence：内存合成PDF，验证物理页、坐标、重复标题、空提取、损坏、注释脚本、惰性链接、资源限额和子进程失败隔离；不连接数据库或读取业务材料。
- npm.cmd run test:pdf-evidence-integration -- --output <本仓artifacts下不存在的目录>：复用test-analysis-runs.js --p18-pdf，创建唯一标签tmpfs MySQL、合成身份及PDF、随机回环HTTP/worker/Edge；验证权限、迁移、事务、固定引用、原问题追溯和输入保护，结束恢复内存备份并按归属回收资源。可组合--p14、--p18、--p18-word检查已有API/Excel/DOCX兼容。
- npm.cmd run manage:pdf-evidence -- --target <host:port/database>：默认dry-run，支持--inspect/--dry-run/--apply；必须明确MYSQL_HOST、MYSQL_PORT、MYSQL_USER、MYSQL_PASSWORD、MYSQL_DATABASE，target逐字匹配。命令不加载.env；只有--apply写增量表/迁移标记，保留旧记录，无自动回填、启动DDL或清理。正式实例运行须另获目标/备份授权。

### P19 离线 AI 维护与验证

- `npm.cmd run test:ai-offline`：内存合成材料及静态字符串替身，验证结构、固定引用、摘录、越范围主体、重复/冲突、注入、超时、取消、并发、字节/费用上限和真实调用关闭；不连数据库或外部服务。
- `npm.cmd run test:ai-offline-integration -- --output <本仓artifacts下不存在的目录>`：组合 `test-analysis-runs.js --p19 --p14`，创建唯一标签 tmpfs MySQL、合成身份、随机回环 HTTP、worker 和 Edge。验证增量迁移、原 API 权限/范围、事务、完整性、实际输出留存、AI 失败保留确定性结果、P18 显式关联及页面安全渲染；结束恢复内存备份并按归属回收资源，不操作既有服务或正式数据库。
- `npm.cmd run manage:analysis-ai -- --target HOST:PORT/DATABASE`：使用显式 MySQL 环境变量，默认 dry-run，支持 `--inspect`、`--dry-run`、`--apply`，target 必须与配置逐字匹配。只在显式 apply 下添加 AI 输出审计表和迁移标记，无自动 DDL、回填或旧数据删除。正式目标另获授权并准备完整备份。

离线请求由 `analysisAiOffline.createPayload` 构造；输出及预算合同见应用 README。替身仅接收惰性字符串，不提供函数、工具或真实模型连接。测试证据中的实际输出全部来自合成替身，不能据此评价真实 AI 质量。

### P21 流程预览与核对

先执行 `npm.cmd run build:frontend`，再执行 `npm.cmd run test:process-preview-browser -- --output <仓库artifacts内全新目录>`。脚本拒绝覆盖已有证据目录，复用 stage05 的自有 tmpfs MySQL、随机回环 HTTP、合成人员和本机 Edge；测试结束只关闭自建 HTTP、Edge 和经标签核对的容器。不得指向正式服务，不读私有配置，不下载浏览器或镜像。输出 results.json、合成 V8 文件、页面/图形截图、PNG 导出和夹具日志。

覆盖 V8/V7 接收、判断节点数据依据、版本原样保存、修订比较和并发、需要修改及双方确认、归口分派、范围卡口、管理员只读/越部门拒绝、输入保护、身份失效、迟到响应，以及桌面/窄屏图形几何。403/409/503/断网部分使用浏览器故障注入；真实401、正常写入、修订冲突和权限拒绝使用真实隔离后端，结果分别记录。相关轻量回归为 `npm.cmd --prefix frontend test`、`node scripts/test-frontend-shell.js`，既有核对回归分别以默认版本及 `TEST_PROCESS_FORMAT=process-governance-v8` 运行 `node -r ./scripts/testHelpers/blockRealMysql.js scripts/test-process-v7-preview-review.js`。

### P21 流程正式流转

正式草稿正文与原生 JSON 下载也使用本节脚本验证：比较下载解析后的正文与真实 API，覆盖 V7/V8、跨部门拒绝、修订/摘要/格式错配、导出期间内容变化、失败不下载、离页取消迟到下载及会话隔离。内容错配和 HTTP 错误为明确注入，正常读取与权限使用隔离 MySQL/HTTP。正文核对不清除未提交审核意见；下载不代表发布，也不声称恢复原始上传字节。

同一脚本覆盖主档已发布历史版本：通过真实新修订、核对、提升、审核和发布形成两个固定版本，分别对照原生正文及 Markdown；检查空列表、明确选择、跨部门拒绝、刷新/返回、HTTP错误、断网、主档/版本/摘要错配、切换版本取消迟到下载。正常数据来自自有隔离 MySQL，错误及错配为显式注入。只检查 Edge 100%、1699×828 桌面；不改变发布规则或正式数据。

`npm.cmd run test:process-formal-browser -- --output <仓库artifacts内全新目录>` 要求先构建前端、本机已有 Edge 与 `mysql:8.4` 镜像。沿用 `withStage05Fixture` 和有归属标签的 tmpfs MySQL；随机 HTTP/MySQL 端口排除受保护端口，不读取私有配置，不访问正式服务，不拉取镜像。只写指定的新证据目录，并在 finally 关闭本次自建资源。

同一脚本覆盖当前正式草稿的审核任务与操作历史，逐项核对 API 返回、只读请求、跨部门拒绝、错误重试、迟到响应和身份切换，以及历史刷新时未提交意见的保留。403/409/503、断网及错配响应为明确故障注入；正常读写、范围和会话使用真实隔离 HTTP/MySQL。仅验证 Edge 100%、1699×828 桌面，不执行窄屏场景。

同一脚本也覆盖跨草稿主档历史：用真实发布形成的两份草稿核对旧审核和事件，另在自有库插入合成草稿测试20条分页、无重复遗漏、部门过滤、未发布/拒绝状态及退役格式排除。检查管理员只读、401/403、非法游标400、退役锚点410，以及错误重试、主档错配、迟到响应和相邻未提交意见保护。合成插入只用于验证，不代表补录业务历史；测试结束由隔离夹具清理。

### P21 我的角色工作台

`npm.cmd run test:role-workbench-browser -- --output <仓库artifacts内全新目录>` 要求先构建前端，使用本机已有 Edge、`mysql:8.4` 和 `withStage05Fixture`。脚本只在自建 tmpfs MySQL 中创建合成身份、V8/V7案例和办公室任务，通过真实 HTTP 验证范围、待办更新、旧入口定位及身份失效；不读取私有配置，不调用正式服务，不改变实际组织或权限。结束时关闭本次浏览器、自建HTTP及带归属标签的容器。

输出包含 results.json、桌面/窄屏/合成图形截图、图形几何及隔离应用日志。403/409/503、迟到响应与完整图形数据为显式浏览器注入；正常任务、角色、会话、核对及办公室任务办理使用真实隔离后端。当前生产合同没有职责上下文时仍显示空态，合成图形只验证渲染和交互。自动化结果不代替正式运行、人工中文输入法或业务验收。

脚本通过真实 API 准备已核对的合成案例，通过 Edge 办理明确主档选择、提升、提交、审核退回、重提、通过、发布、固定版本读回和程序文件下载；检查并发审核、当前有效部门变化、V7/V8 原生保留、管理员多角色只读及越部门拒绝。503/403/409 提升失败用浏览器故障注入；会话失效、审核并发、权限拒绝及业务写入使用真实隔离后端。另检查刷新/返回、未提交输入、迟到返回、中文长意见和1699×828、390×844布局。

输出 `results.json`、页面截图、程序文件和 `fixture-app.log`；失败保留 `failure.json` 与截图。结果不代表真实人员试用、正式环境开启或业务验收。

### test:identity-directory-browser

执行 node scripts/test-identity-directory-browser.js --output <仓库 artifacts 下全新目录>，验证 P21 账号办理、授权历史、审计、组织与花名册页面。脚本使用 withStage05Fixture 创建带唯一标签的临时 MySQL、合成身份、随机回环 HTTP 和 headless Edge；结束关闭浏览器及自有 HTTP，按标记移除自有容器。不读取私有配置，不连接正式数据库，不发送通知。输出检查结果、故障记录、合成发布版本及双尺寸截图，密码响应不记录且截图遮罩凭据区域。依赖已构建前端、Docker 和本机 Edge/Playwright。

### test:publications-browser

执行 `npm.cmd run test:publications-browser -- --output <仓库 artifacts 下全新目录>`，先构建前端。依赖本机 Edge/Playwright、Docker 及已存在的 `mysql:8.4` 镜像；不下载镜像。脚本通过 `withStage05Fixture` 建立有归属标签的 tmpfs MySQL 和随机回环 HTTP，准备合成身份、CSV 和多工作表 XLSX。正常发布、下载、管理员拒绝、会话失效及并发版本使用真实隔离后端；403/409/503 展示、断网、迟到和已落库但响应丢失场景使用明确的浏览器故障注入。

输出 `results.json`、双尺寸截图、合成下载文件和隔离应用日志；失败另存 `failure.json`。验证稳定数据集、新版与旧版保留、幂等重试、字段原值、文件/工作表切换确认、未提交保护及身份隔离。结束关闭本次浏览器和 HTTP，并按唯一标签移除自有容器；不读取私有配置，不访问正式库或其他业务服务，不发送通知。本脚本不构成真实业务验收。共享组件变更时运行 `test:identity-directory-browser`，原发布行为回归使用 `test:publications`，前端基础检查使用 `test:frontend-shell`。

### test:quality-browser

先构建前端，再执行 `npm.cmd run test:quality-browser -- --output <仓库 artifacts 下全新目录>`。依赖已有 Docker `mysql:8.4` 镜像、本机 Edge 与 Playwright；复用 `withStage05Fixture`，创建有唯一归属标签的 tmpfs MySQL、随机回环 HTTP 和合成身份。验证空记录、非零进度、对象同名分组、缺少身份的字段不计入分母、部门范围、会话失效、无权拒绝、新旧入口及原数据不变。403/409/503 展示、断网与迟到响应为显式故障注入。输出 results.json、双尺寸截图与失败记录；结束关闭自有浏览器、HTTP 并按标签核对后移除本次容器。不读取私有配置、不操作正式库、不调用退役质量接口、不发送通知。前端路由回归使用 `test:frontend-shell`。

### P21待办收到查阅

`npm.cmd run test:todo-inbox-browser -- --output <本批次artifacts下尚不存在的证据目录>`：先运行 `npm.cmd run build:frontend`；复用stage05自有临时MySQL、合成身份、回环随机HTTP端口与Edge。验证真实待办读取、部门范围、筛选/刷新/历史导航、新旧入口、原记录保持及无写请求；错误码、断网、坏响应与迟到读取采用明确注入。仅桌面1699×828、100%缩放，不运行窄屏场景。测试退出按夹具归属清理HTTP、Edge及MySQL，不读取私有配置或操作已有服务。前端壳层路由验证同时覆盖 `/app/todos`。

删除子流程增量：上述无写请求及原记录保持断言限查阅阶段。随后仅在自有隔离库删除指定合成待办，核对删除审计、其他记录保持、取消、提交前记录变化、CSRF/权限拒绝、办公室承接拒绝、新旧页面一致性、身份失效及迟到预读取消。故障注入覆盖删除错误和实际提交后丢失回执；页面必须要求刷新核对，不能自动重放。测试不操作正式待办。

历史保护验证读取既有版本日志中的删除快照，核对原事件及操作者；用自有库临时触发器模拟审计不可写，确认删除整体回滚。通过真实版本查询验证本部门可读、跨部门不可读，以及大小写/重音等价类型参数不能绕过范围校验。

完成子流程增量：同一脚本继续验证本部门办理权限、管理员与跨部门拒绝、CSRF、原关联记录不能直接完成、确认取消、预读变化、办公室拒绝及完成审计失败回滚。真实隔离完成核对办理人员、时间、事件、相邻记录保持、状态筛选和新旧页面一致性；注入403/409/503、断网、提交后丢回执及迟到预读，验证主动核对、无自动重放、导航和会话失效隔离。完成确认截图为 `complete-confirm.png`；没有自由文本输入，不建立额外草稿或持久化机制。

关联事项入口增量：同一脚本在自有库增加合成冲突、术语类型待办和历史关联编号，验证两个真实列表入口、用户明确选择冲突类型及编号、键盘导航、返回与刷新保留筛选、部门范围及无自动写入。不按相同数字或正文猜测具体记录，不调用原映射接口；403/503采用明确注入，身份撤销与重登范围使用真实后端。输出增加 `related-work.png`，仅桌面1699×828；既有冲突和术语办理组件不在本次修改范围。

P21版本检索增量（2026-09-28）：`test:native-diagrams-browser -- --output <本批次新证据目录>`在既有自有MySQL/HTTP/Edge夹具内增加25份合成V7/V8混合状态版本，核对检索权限先于分页、字面匹配、游标边界、正文/程序文件/图形、错误重试、迟到响应、相邻输入以及刷新/返回。仅桌面1699×828；工作包开关保持关闭，不访问正式数据库或3001。测试结束关闭自有资源；不能代替人工和业务验收。

### P21 术语待办来源验证及迁移

先构建前端，再运行 `node scripts/test-todo-term-source.js --output <本批次artifacts下尚不存在的证据目录>`。脚本复用自有临时MySQL/HTTP/Edge夹具，仅处理合成数据，执行备份与恢复、首次和重复迁移、无来源时回滚、DDL中断恢复、漂移拒绝、旧记录保持和缺列503；随后验证原创建接口的术语来源、身份/部门范围、重复并发、请求冲突、审计失败事务回滚、删除后引用及请求历史保护。备份只在夹具内存和归属已核对的容器之间使用，不写业务材料或访问既有库。

桌面浏览器使用Edge100%、1699×828，验证从术语详情明确创建待办、准确入口、无来源的旧列表入口、目标删除/无权、刷新/返回、输入保护、错误和真实会话失效。403/409/503及提交后回执丢失属于明确故障注入。输出 `results.json`、截图及应用日志，失败保存诊断；结束关闭本轮Edge、HTTP和自有MySQL。既有 `test:todo-inbox-browser`继续回归原查阅、完成、删除及列表导航。

维护入口为 `node scripts/manage-todo-term-source.js --inspect|--apply|--rollback --target host:port/database`，每次只能选择一种动作，并须与显式注入的MySQL目标完全匹配；不读私有环境文件。inspect只读，apply增加可空列和迁移标记，rollback仅允许没有引用及请求历史的已登记结构。应用启动不迁移。执行任何写入前须授权、备份并暂停目标实例的待办写入；有来源或历史时保留结构用于代码回退，数据恢复另行核对。CLI与模块的复验入口是上述隔离脚本，不以该脚本通过授权操作正式库。

## P21 角色与责任说明

先运行 `npm.cmd run build:frontend`，再运行 `npm.cmd run test:role-guide-browser -- --output <本批次 artifacts 下尚不存在的证据目录>`。脚本使用自有隔离 MySQL、随机回环 HTTP、合成身份及 Edge 100% 的 1699×828 桌面视口，验证固定模型、当前角色、允许动作、可见标签、角色级与完整 RACI、工作台待办数、第一步入口、权限缺口、原入口、刷新/返回、401 会话撤销、错误和迟到响应；两项 API 均为只读请求，不改写授权。待办读取失败时明确显示暂不可用，不误报零。失败时保存诊断，结束时按归属关闭浏览器、HTTP 和容器。自动化验证不代替真实人员试用。

### P21 冲突时间线复验（2026-09-28）

复用 node scripts/test-terms-conflicts-browser.js --output <本批次下不存在的证据目录>；输入为合成身份及记录，启动并清理归属明确的隔离 MySQL、HTTP 和 Edge，只输出证据。增加归档后决定、重开后已清空决定不重建、缺时间和 HTML 字面显示检查；沿用错误、返回、身份、输入保护及字段/术语同号隔离验证。只测1699×828桌面，移除该脚本历史窄屏场景。纯投影检查：node --test frontend/tests/conflict-history.test.js；不连接数据库。

P21冲突对象查阅补核（2026-09-28）：沿用test:terms-conflicts-browser及其隔离清理机制，增加真实字段双方名称、同一字段对不同属性、详情类型/严重度与刷新核对；缺失字段、0、空字符串、未知码及长HTML字面值使用显式响应注入。仅Edge100%、1699×828桌面截图与溢出检查；不新增窄屏场景。证据见本批次evidence/p21/conflict-subject-20260928，不代表正式运行或业务验收。


P21冲突数量概览验证（2026-09-28）：沿用test:terms-conflicts-browser及自有隔离MySQL/HTTP/Edge清理机制，新增实际状态计数、筛选空结果、刷新保持和受限处理人范围验证；列表403/409/503及未知历史状态用显式响应注入。失败隐藏概览，恢复后重新计数。仅Edge100%、1699×828桌面，证据位于同批次evidence/p21/conflict-overview-20260928。


## P22 历史评审只读导入器与隔离演练

在apps/mdm-platform执行：

- npm.cmd run import:historical-review -- --source <明确快照目录> --output <本仓artifacts内新的JSON文件> [--verify-originals]
- npm.cmd run test:historical-review -- --source <明确快照目录> --output <本仓artifacts内新的证据目录>

import:historical-review固定为dry-run，不读取环境配置、不连接MySQL、不运行源目录脚本；不接受--apply。输出父目录须已经存在，输出不得在源目录、公开资产目录或覆盖已有文件。--verify-originals只读核对快照指向的JSON/XLSX原件摘要，未指定则originals=null，不能声称原件已核对。核心快照缺失或ID重复时拒绝，辅助manifest/证据缺失单列。结果包含固定批次、原ID到平台引用、原意见、证据定位、责任建议和历史计数差异。

test:historical-review使用freshMysql创建自有标签、tmpfs和随机回环端口的MySQL8.4容器；仅在该隔离库初始化既有结构及新增历史表，使用合成身份和已有问题。读取指定快照与共享原件，不改源文件；故障夹具位于新证据目录。检查迁移中断恢复/重复/结构漂移、首次/并发重复导入、整批失败回滚、变更批次共存、数量/ID/证据、未知归属、当前身份/部门越权、与已有问题的只读对照、备份恢复及篡改拒绝。完成或失败均按唯一标签和容器ID清理，仅操作本轮自有容器。结果写results.json，失败写failure.json；不输出数据库连接Secret。

正式迁移和导入入口尚未开放。本步不自动将历史意见注册成规则或新分析运行，不建立第二套正式问题库，不创建任务或通知。historicalReviewStore是维护内部模块，应用启动不调用；不得把隔离测试授权扩展到正式MySQL。P25正式执行前须核实当前来源差异、目标备份与恢复、有权确认、读取范围及具体导入授权。


## P24 集成及问题池读取范围复验

在应用目录先执行`npm.cmd run build:frontend`，再执行`npm.cmd run test:upgrade-integration -- --output <本仓artifacts下不存在的证据目录>`。该入口复用P09/P13—P17检查，并以`--p24`接入同一合成模板的真实Edge导入、HTTP字段修订与事实核对及真实worker发现，继续办公室办理、独立复核、来源变化、历史和恢复验证。可按影响面分别使用`node scripts/test-analysis-runs.js --p24 --p17 --output <新目录>`和`--p15`；`--p24`的完整链路须同时带`--p17`。结果JSON明确是否为P24、是否启动worker，不代表业务验收。

`npm.cmd run test:issue-pool-list-scope -- --output <新目录>`使用自有隔离MySQL和真实HTTP身份，验证队列/列表的正常读取以及当前部门缺失后的403；不读取私有配置。替身回归使用`node -r ./scripts/testHelpers/blockRealMysql.js scripts/test-process-governance-issue-pool-mysql-permission-api.js`，验证缺部门、未知部门、空白名称、无权限、缓存名称、正常部门和全局读取，拒绝时不得调用列表仓储。

两项集成脚本只创建带唯一归属标签的tmpfs MySQL、随机回环HTTP和必要的合成身份；浏览器只用Edge100%、1699×828，不执行窄屏。结束关闭本轮自有资源。故障注入、部分结果、恢复快照及控制台预期错误分别保留，不连接正式库、发通知或调用真实模型。迁移测试使用同一专用连接取得/释放会话锁。P24试用和候选包说明位于原批次evidence/p24。
