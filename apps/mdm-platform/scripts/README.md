# MDM 应用脚本说明

本目录维护 3000 的运行、结构准备、兼容工具及本机专项验证。当前功能和接口分别见 [README](../README.md)、[编制合同](../PROCESS_AUTHORING.md)、[目录合同](../DIRECTORY_API.md)、[术语合同](../TERMINOLOGY_GOVERNANCE.md)和[数据承接合同](../DATA_MAP_HANDOFF.md)。目标运行状态和恢复入口由 [DOCKER.md](../DOCKER.md) 维护，每次操作实时核对，不重放历史发布脚本。

测试脚本及夹具不随 Git 分发。本机原命令在仓库根 `.local-tests/commands.json` 的本应用条目；先检查脚本、依赖及隔离前提，再直接执行实际脚本。历史聚合命令可能包含已撤销的 npm 别名，不能原样重放。缺少工具时记录未执行项。

## 构建与验证选择

前端候选在 `frontend/` 运行 `npm run build -- --outDir <仓库artifacts内全新目录>`，保留现有 `frontend/dist`。真实浏览器使用明确的隔离候选地址、Edge 100% 和 1699×828 CSS 像素，仅桌面；不指向正式 3000/3001。

| 变化 | 验证范围与入口 |
|---|---|
| 说明、入口和原生格式描述 | `npm run check:native-process-consistency`；指令路由另查仓库 `CODEX.md` |
| 编制编辑器纯合同 | 本机 `node --test scripts/test-process-authoring-editor.js`，只用纯合同及随机回环 HTTP |
| 编制草稿保存、提交、并发与恢复 | 本机 `scripts/test-process-authoring-workspace-mysql.js`，仅自有临时 MySQL 和合成账号 |
| 页面显示和输入保护 | 按 `frontend/tests/` 的相关模型检查及本主题浏览器脚本选择；合成会话不能替代真实登录和人工输入法体验 |
| 权限、身份与范围 | 有权、无权和越权路径；服务端校验、事务锁、身份精度及兼容范围见[身份事务合同](../docs/Identity-Transaction-Contract.md) |
| 迁移与准备 | 真实自有隔离库验证幂等、漂移、失败回滚或补偿、历史内容及引用保留；正式目标另需授权、备份及真实恢复凭证 |

本机专项的具体参数以源脚本为准；带 `--baseline`、`--candidate-root`、`--frontend-dist` 或 `--test-node-path` 时，核对准确源码、构建及依赖归属。候选组合不匹配时不得沿用其他批次的通过结论。只清理本次自有服务、浏览器和临时库。

## 编制草稿结构准备

`node scripts/manage-process-authoring-schema.js --inspect --target <host:port/database> --server-uuid <实时服务器UUID> --deployment-id <本次UUID> --expected-cutover-epoch <已核验代次>`只读盘点三张编制草稿表，输出`inventory_digest`。连接环境必须显式提供`MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`，工具不加载私有配置或输出凭据。数据库名、服务器UUID、`controlled`状态与受控代次须同时匹配；本入口不会重跑通用治理准备或改变受控状态。

执行使用相同目标、部署编号和受控代次，将`--inspect`换成`--apply`，另传`--authorize-formal-migration --confirm-target <相同目标> --backup-file <实际备份文件> --backup-sha256 <SHA256> --restore-receipt-file <实际恢复回执JSON> --restore-receipt-sha256 <SHA256> --authorization-reference <本次授权依据> --write-fence-reference <已停写证据> --expected-inventory-sha256 <本次盘点摘要>`。备份与恢复凭证沿用下文`governance-backup-restore-v1`合同，须对应同一目标并由实际恢复检查形成。执行方须先落实停写、备份及恢复条件；参数本身不能证明已停写或已恢复。

工具仅调用现有编制结构迁移，创建缺少的`process_authoring_drafts`、`process_authoring_revisions`、`process_authoring_requests`并登记对应迁移标记。盘点摘要绑定目标、受控代次、预期DDL、三表结构与行数、基础迁移表及其他迁移记录。结构或列排序规则漂移、未登记非空表、已有标记但缺表、相关表存在未预期触发器时拒绝执行。DDL隐式提交；部分创建后须重新盘点，只有既有部分为空且结构匹配、无迁移标记，并明确绑定新摘要时才能补齐。结果不明时先盘点核对，不能推定失败或删除新表；已登记且完整匹配的表可以幂等检查，原草稿、快照及请求回执保留。

入口不授予运行账号权限，不修改功能开关、流程正文、人员授权、受控代次或历史审核，也不启动、部署或停止服务。结构准备、运行权限配置、应用部署和功能开启分别留存回执。维护桥可导入此脚本的`inspect(pool, options)`与`apply(pool, options)`复用相同核验和回执，不能绕过该入口直接写表。

## 统一术语治理命令

仅复核固定历史定义的读取及只读提示时，可在同一命令后加`--history-only`。该模式仍创建自有临时MySQL并经过实际HTTP及Edge，输出`mode=history-only`，不能代替完整交互验证。

`npm run migrate:terminology:inspect -- --target <host:port/database>`及`migrate:terminology:dry-run`只读盘点并输出`manifest_digest`。`migrate:terminology:apply-isolated`另须`--authorize-isolated-migration --confirm-target <相同目标> --backup-sha256 <已备份SHA256> --expected-manifest-sha256 <盘点摘要>`。入口只接受显式本机非业务端口及`stageNN_isolated_<32位随机十六进制>`数据库，默认不执行迁移，不能用于正式切换。传入环境须明确MYSQL_HOST/PORT/DATABASE/USER/PASSWORD；脚本不自动加载私有文件，不输出密码。

迁移保留旧表、状态、待办与冲突引用，按旧表及旧编号建立映射，不按同名自动合并。若开关关闭期间旧表又有写入，重新盘点会报告快照变化，不能覆盖新词典。恢复开关不构成数据降级；新版本、事件和引用必须保留，后续正式切换及恢复另行核对目标、备份与操作授权。

### 正式术语与数据承接结构准备

`node scripts/manage-governance-deployment.js --inspect --target <host:port/database> --server-uuid <实时服务器UUID> --deployment-id <本次UUID>` 只读核对结构与旧数据，输出 `manifest_digest`。必须显式提供 MYSQL_HOST/PORT/DATABASE/USER/PASSWORD；不加载私有配置文件。目标名与 UUID 任一不匹配即拒绝。`--inspect` 不接受执行参数，也不创建新表或控制行。

执行使用相同目标和部署编号，并将 `--inspect` 换成 `--apply`，另传 `--authorize-formal-migration --confirm-target <相同目标> --backup-file <实际备份文件> --backup-sha256 <SHA256> --restore-receipt-file <实际恢复回执JSON> --restore-receipt-sha256 <SHA256> --authorization-reference <本次用户授权依据> --write-fence-reference <已停写证据> --expected-manifest-sha256 <盘点摘要>`。工具读取并核验备份及回执文件摘要；执行方须事先完成对应正式目标的备份、真实恢复验证和停写，提供可追溯证据，不得把参数值或合成演练当作实际恢复证明。

恢复回执的 `schema_version` 或 `contract` 为 `governance-backup-restore-v1`：`status=passed`；`source.database/server_uuid` 与原目标一致；`backup_sha256` 与实际备份一致；`restore_target.database/server_uuid` 标明不同于原目标的恢复位置，或由 `source.container_id` 与 `restore_target.container_id` 的实际完整容器标识证明两者不同；`schema_verified=true`、`data_verified=true`；`source_inventory_sha256` 与 `restored_inventory_sha256` 为相同的实际核对摘要。回执与文件的一致性可由工具校验，实际恢复及其业务完整性仍须保留执行证据。

快照读取依据实时 `DATA_TYPE` 保持源值类型：已知 INT/TINYINT 等与 FLOAT/DOUBLE 数值从文本传输严格恢复为 mysql2 的数字类型，FLOAT 对齐其单精度值；不安全整数或非有限值拒绝。显式 CAST 的 BIGINT、DECIMAL、日期和 JSON 保持字符串，未知类型不根据内容猜测。基础空表准备前后仅规范化该明确计划造成的缺表到空表变化，原有基础表的完整行摘要以及其他源资产和字段摘要仍固定核对。

本文件按用途说明当前命令；命令表依据本应用`package.json`核对。阶段进展、验证结论和已废止配置保留在文末历史快照，不能代替当前脚本或目标状态。代码路径以应用目录为基准。

## 正式流转开关维护

2026-10-19 17:38当前3000已沿用同一镜像开启`PROCESS_V7_FORMAL_ENABLED=1`，预览保持开启，编制归属及数据治理工作包保持关闭。该操作未修改源码、模型、表结构、数据库权限或人员授权；每个部门最终负责人由用户在前端配置，未登记或有效授权不齐时拒绝最终确认。

本次受控入口及证据位于`artifacts/3000-formal-enable-20261019-01/`，输入为准确的当前镜像、现有连接及用户授权；输出为备份、恢复、开关切换和验证记录。只有deploy涉及3000容器启停及单一开关变更，SQL仅检查和备份，不写业务行。prepare、deploy已完成，不得重放；verify是绑定本次快照的保留性核对，后续正常办理后不能拿旧数据摘要作当前不变断言。日常健康及恢复按[Docker说明](../DOCKER.md#正式流转开启与恢复)执行，不恢复旧dump覆盖后续记录。

## 治理职责迁移与专项验证

部门核对采用独立策略`department-accountability-v1`，与RBAC/RACI模型版本和单流程JSON版本分开。主对接人提交，部门负责人本人核对并最终确认，不设置中间审核员。策略迁移仅更新旧机器角色`department_mdm_reviewer`的中文名称、职责说明及相关权限说明，保留角色标识、人员授权、历史决定、人员及账号；不会自动指定负责人或补授角色。组织最终责任登记与有效同部门角色授权必须同时具备，缺配置时明确阻断办理。

`migrate:department-accountability:inspect/apply/compensate -- --target <host:port/database>`要求显式MySQL环境和匹配目标，不加载私有配置。先完成v4职责迁移，再应用该策略；工作树已支持的后续模型保持原版本。策略快照记录原目录说明及历史决定水位；旧确认保留但须现负责人重新确认。补偿仅限没有新策略办理记录的情况，先补偿部门策略，再补偿职责模型；有使用记录时拒绝自动恢复，不能覆盖数据或直接启动旧代码。

v4治理经办角色、案例/工作包分派、案例负责人及正式恢复代码，连同独立部门确认策略，已于2026-10-19部署3000并通过实时验证。运行模型由v3扩展至v4，8角色、20权限、12项RACI活动；本批不包含工作树的HR v5功能。严格身份读取要求代码与模型迁移同批切换，不能只替换程序。迁移保留原七个角色标识与全部人员授权，新增职责、任命事件、案例办理记录和备份表，不自动授予角色、任命人员或改写V8/V7正文。

维护入口要求显式`MYSQL_HOST/PORT/DATABASE/USER/PASSWORD`及匹配的`--target host:port/database`，不加载私有配置。取得目标授权、备份及恢复条件后，先inspect核对依赖、DDL、旧权限和模型基线，再apply并核对ready。本批通过受控发布脚本调用冻结v4的同一迁移函数；`artifacts/3000-governance-responsibilities-20261019-02/`保留完整备份、隔离恢复、数据保留及上线证据。已完成的发布入口不能重放；后续操作以目标当前状态和新授权为准。

`compensate`仅在新增角色没有任何人员授权、职责及办理历史均为空时恢复原模型元数据；保留新增表和备份，不删除历史。已有任何新授权或办理记录则拒绝自动补偿，需要单独恢复方案。维护期间应停止相关业务写入，补偿后切回兼容代码；不能把空表补偿当成在用系统的通用回滚。

## npm 命令与本机专项

实际注册项以 [package.json](../package.json) 为准；在应用目录运行 `npm run` 可查看。测试已退出 Git 分发，原测试命令从仓库根 `.local-tests/commands.json` 的本应用条目追溯；先确认脚本及依赖存在，再按源脚本执行，不使用已撤销的 `npm run test:*` 或候选 npm 别名。

| 工作类型 | 当前入口 | 副作用及条件 |
|---|---|---|
| 原生格式与入口一致性 | `npm run check:native-process-consistency` | 只读静态检查，不启动应用、不连库 |
| React 候选构建 | 在 `frontend/` 运行 `npm run build -- --outDir <artifacts内全新目录>` | 写指定构建目录；保留当前 `frontend/dist` |
| Windows 部署副本 | `service:start`、`service:stop`、`service:restart`、`service:check` | 管理专用部署副本；不管理 Docker，目标与授权见 Docker 说明 |
| 3000 Docker | [DOCKER.md](../DOCKER.md) 的运行与恢复入口 | 核对实际目标、准确源码及恢复条件，不重放历史发布脚本 |
| 治理职责、部门责任、目录角色及术语结构 | `migrate:governance-responsibilities:*`、`migrate:department-accountability:*`、`migrate:hr-directory-role:*`、`migrate:terminology:*` | 后缀按 package.json 选择；inspect/dry-run 仍须核对目标，正式写入另需授权及恢复条件 |
| 受控目标的编制结构准备 | `node scripts/manage-process-authoring-schema.js` | 只按上文明确目标、盘点摘要和授权参数执行 |
| 历史 SQLite 工具 | `legacy-sqlite:*` | 仅历史迁移或隔离测试，不作为正式运行和授权入口 |

专项覆盖、隔离条件和参数保留在相关主题章节。缺少本机清单或工具时记录未执行项，不将历史验证结果写成本次通过。

## 组织与员工目录专项

本组实现与接口范围见[组织与员工目录](../DIRECTORY_API.md)。本次可用入口如下；验证只使用合成数据，正式迁移不能从测试通过推定已执行。

| 命令 | 输入、输出及副作用 |
|---|---|
| `migrate:hr-directory-role:inspect` / `:dry-run` | 显式`MYSQL_*`及`--target host:port/database`；只读预检角色、权限及表结构，不读人员明细、不写库 |
| `migrate:hr-directory-role:apply` | 同一明确目标及独立可恢复备份；显式v4→v5，准备分组约束、角色、权限、备份和迁移记录，保留原角色ID及人员授权，不自动给人授权 |
| `migrate:hr-directory-role:compensate` | 仅新角色从未产生任何历史人员授权时恢复原模型；保留新增表、权限及兼容分组约束，不删除业务数据。提交结果不明时先inspect |

需要`--baseline`的B02读取及维护检查必须使用本轮修改前的完整准确文件，来源和摘要单列保存；本轮before与旧历史缺陷快照分别标明。`test-b02-publication-target-authority-mysql.js --baseline-current`以当前HR v5 before对照，要求两侧均有合法HR身份并保留实际锁等待和安全拒绝；不加该参数仍用于真正的修复前历史快照，不得混用。各输出目录须为全新`artifacts/`子目录。

`test-system-admin.js`的浏览器部分使用当前`/app/`首次改密和身份页面，检查门禁、当前账号、失败输入、会话失效及重新登录；不恢复已退役页面。`testHelpers/prepareReviewFoundation.js`只在调用方自有临时库明确准备当前案例治理前提。办公室兼容检查使用`testHelpers/officePublishedSource.js`建立明确的合成固定来源，验证办公室迁移、成员、分派、失权和记录保留，不用旧共享场景代替现行完整审核发布验证。本批命令、失败复核及结果见[第三批本地证据](../../../artifacts/3000-batch3-hr-v5-20261021-184725/README.md)。

v3目标先按既有治理职责迁移准备v4，再执行人事角色迁移。命令本身不加载私有配置、不启动服务、不创建真实接入凭证。系统间读取启用变量、版本字段及错误码见接口说明。

## 参数与恢复说明

运行和结构维护具体变量、目标参数及恢复步骤见[运行与结构维护](../docs/Current-Runtime-Maintenance.md)及对应迁移手册。该说明包括办公室、发布目录与历史评审导入；不将迁移登记、就绪探测或软件包准备写成业务开启。

## 最小权限准备

`node scripts/prepare-governance-runtime-grants.js --root <candidate app> --output <new artifacts JSON>` 只读盘点候选代码并输出权限计划，不连接数据库、不执行 GRANT。计划区分运行账号的列级 INSERT/UPDATE 与初始化、迁移、维护和受控切换；具体授权、受控代次和切换条件按 Docker 说明核对。计划文件和隔离验证不等于目标已授权或已开启。

## 历史追溯

既有批次证据及恢复记录按 [DOCKER.md](../DOCKER.md) 定位。更早脚本说明保留在[历史原文](../../../docs/archives/2026-10-09-leaf-docs/apps/mdm-platform/scripts/README.md.before.txt)；本次整理前全文保留在本机 `artifacts/development-baseline-20261031/before/apps/mdm-platform/scripts/README.md`。历史批次的数量、镜像、测试结果和候选目录不表示当前实例状态，也不作为新一轮执行参数。
