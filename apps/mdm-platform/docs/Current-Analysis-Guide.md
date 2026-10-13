# 3000 固定来源、分析与证据说明

本文整理当前工作树的技术行为和维护限制，实际启用、部署和验收分别核对目标实例。业务依据来自用户指定的外部原始材料及有权确认；实现不单独证明业务要求。文中代码路径以 `apps/mdm-platform/` 为基准。

## 确定性流程材料检查

确定性规则使用共享纯校验器和独立分析 worker，当前规则集合及解析器版本为 `v7-deterministic-v4`，支持原生V8及受支持V7。v4复用3001的纯内容规则，增加编制完整性、判断分支和逐动作可执行性，输出编制缺项或待确认事项；关键词检查仍需人工核实实际业务。旧v3保持原有八项V8/V7检查，旧v1/v2仅按V7语义继续受限读回及执行保护；parser_key 为 `v7_deterministic`。规则目录、适用前提和不适用条件见 `server/v7AnalysisRules.js` 的 catalog；原有规则和新增内容回归分别见 `scripts/test-v7-analysis-rules.js`、`scripts/test-process-content-checks.js`。现有 Schema 仅作为技术兼容合同，不是业务真源。

调用既有 `createAnalysisRun` 时，该确定性规则的inputs仅接受固定来源映射的`v7_source`引用；每步只处理一个 input_key，可在一个运行中列出多步。check_scope 和步骤 check_ids 从下表启用编号中选择，新 parser_versions 为 `{ "v7_deterministic": "v7-deterministic-v4" }`，rule_version 使用同一版本，ai_metadata 必须为空。旧v1至v3不能请求v4新增检查编号。再通过 `enqueueAnalysis` 显式入队，由获准隔离环境中的 `analysis:worker` 执行。未知规则、解析器版本、非来源输入及禁用规则拒绝入队；确定性规则单独合同不包含AI。现有分析HTTP接口 API/分析检查台页面继续使用，离线AI适配离线组合按自己的版本和覆盖合同执行。`kind=v7_source`只是固定来源类型，不能证明正文是V7。

| 编号 | 检查依据和输出边界 |
|---|---|
| v7.format | 现有 Schema 类型、枚举及格式约束；无法解析的固定上传材料记录解析失败及原字节摘要引用 |
| v7.required | 仅检查 Schema 明确 required 属性；不把允许的空文本、空字段数组推定为业务缺项 |
| v7.duplicate | Schema 通过后使用共享校验器检查重复技术标识、字段或关系定义；不合并同名业务对象 |
| v7.local_integrity | Schema 通过后检查共享局部引用和关系约束；保留原技术合同的自环限制，合法多节点返回回路不判错 |
| v7.field_binding | 共享校验器核对明确引用的对象字段、所属对象及类型；未声明引用不自行要求绑定 |
| v7.isolated | 结构与引用校验均通过且多于一个行为时检查未连关系的行为；只输出待核实，单节点不判错 |
| v7.exit | 结构与引用校验均通过时检查 decision、parallel_split 未声明出口；action、parallel_join 和未知类型不据此判错 |
| v7.branch_condition | 结构与引用校验均通过时检查 condition、loop 关系的空条件说明；只输出待核实，不推断互斥或穷尽性 |
| v7.content_completeness | v4新增：基础信息、行为、数据、表单等内容缺项；空数据/表单及显式待确认内容提示核实，不补造事实。固定分析不读取当前部门目录，已填写执行主体的部门身份另待核对 |
| v7.decision_branches | v4新增：判断出口完整性、多个默认继续路径、关系类型、回路及并行说明；不从标题推断业务条件 |
| v7.action_executability | v4新增：action具体动作说明缺失、抽象定性表述或未识别出具体动作；只提示修订，不表示人工执行验收 |
| v7.unreachable（禁用） | 原生V8及受支持V7没有明确入口及开始/结束语义，不能从入度、顺序或名称推断可达性 |

worker 在令牌事务内重新读取固定来源、有效身份、范围及摘要，只把本步骤的材料交给独立计算线程。计算线程不接收数据库或治理接口；终止线程不会阻塞心跳。运行时记录 worker、规则、共享校验器及 Schema 的源码摘要。证据定位回原固定 JSON，语义身份采用局部稳定标识及属性，不采用数组下标、标题或 finding_id。相同输入重跑保存独立实例及历史，对照键与结果摘要保持一致；顺序变化不会单独改变发现身份。缺标识时仅以材料内容摘要定位技术缺陷，不据此认定跨版本业务身份。

结构不合法时后续共享引用检查保留为未覆盖；共享校验失败时图规则保留为未覆盖。解析失败采用明确的 declared_anchor，不伪造可解析位置。结果超出既有 256 条证据/发现或请求容量时明确失败 `RESULT_LIMIT_EXCEEDED`，不截断后宣称完成。每个发现仍为 pending_verification、issue_id=NULL；succeeded 只表示计划检查已执行，不表示材料无问题或业务已验收。

验证入口为 `npm.cmd run test:v7-analysis-rules`（纯合成规则测试）和 `npm.cmd run test:v7-analysis-worker -- --output <仓库artifacts内全新目录>`（自有 MySQL、随机端口夹具及真实子进程）。确定性规则 不增加表、迁移或回填，不改写 V7、台账、审批、问题和待办；分析队列与工作进程 替身队列继续兼容。回退到仅支持 分析队列与工作进程 的 worker 前须先停止 确定性规则 worker 并处理相应运行，不能让旧进程办理 确定性规则 队列。实际启用及业务验收须按具体目标核对。

## 独立分析工作进程

分析队列与工作进程 在 分析运行存储 上增加 MySQL 持久化队列和独立 Node 工作进程。运行必须由具备既有 `governance:structure-gate` 权限的当前身份显式调用 `enqueueAnalysis` 入队；仅接受尚无尝试的 queued 运行。已有运行不自动入队，不回填或转换原记录。分析队列与工作进程 的 `p10-stub-v1` 替身适配器继续保留，明确测试成功、暂时失败、输入无效、挂起和部分覆盖；替身结果不代表业务规则分析。确定性规则 新增的真实材料检查见上一节。工作进程只执行获准的队列步骤，不自动外发AI、分派或关闭问题；HTTP与页面入口见“分析接口与可见范围”。

队列保存原提交人的 person/account/auth_version、固定运行引用、策略及事件。入队、领取和步骤写入继续核对有效身份、权限、各项来源范围和摘要；管理员保持治理只读。工作进程仅办理分析队列，分析队列与工作进程 适配器接收步骤元数据，确定性规则 另接收已复核的固定材料；均不接收数据库或正式治理接口。自动中断记录沿用原提交人作为代办身份，并用 queue_events 的 worker_id、generation、event_type 和 UTC 时间标明系统执行，不表示该人员作出业务决定。

领取使用事务锁和 `SKIP LOCKED`；每次生成随机令牌，数据库仅保存摘要。心跳只能延长有效租约，不能越过当前步骤的硬超时。开始、完成、恢复和取消均受事务保护；旧令牌、过期租约或已取消运行拒绝迟到写入。已入队运行不能通过 分析运行存储 begin/complete/非取消 finish 入口绕过令牌。成功步骤保持不变，重试追加尝试；默认最多 3 次，只有暂时故障、超时或进程中断可以重试。无效输入不重试，partial 保留明确缺口，运行按实际覆盖结束为 succeeded、partial 或 failed，不能据缺口认为旧问题消失。

在应用目录使用以下命令。所有命令要求显式 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`，并核对 `--target`；不得将 Secret 放入命令、日志或说明。命令不加载 `.env`。本地测试必须使用自有隔离 MySQL，正式实例仍需另行授权。

| 动作 | 命令与结果 |
|---|---|
| 检查迁移 | `npm.cmd run migrate:analysis-queue -- --target <host:port/database>`；默认 dry-run；也可显式 `--inspect` |
| 执行获准迁移 | `npm.cmd run migrate:analysis-queue -- --apply --target <host:port/database>` |
| 启动 | `npm.cmd run analysis:worker -- start --target <host:port/database>`；前台独立进程，输出本次 worker_id，默认单 worker，重复启动返回 ANALYSIS_WORKER_BUSY |
| 状态 | `npm.cmd run analysis:worker -- status --target <host:port/database>`；输出队列状态计数和最近 worker 心跳，不输出身份、输入正文或令牌 |
| 消费者预检 | `npm.cmd run analysis:worker -- inspect --target <host:port/database>`；只读检查原生原生流程固定来源分析的完整存储依赖及队列实际直接引用的来源前置，不能据此宣称worker进程存活或全部解析器可用 |
| 停止 | `npm.cmd run analysis:worker -- stop --worker-id <启动时的UUID> --target <host:port/database>`；仅请求该实例停止；根据 stopped_at 和进程退出确认完成 |
| 中断恢复 | `npm.cmd run analysis:worker -- recover --target <host:port/database>`；只回收已过期租约，保留成功步骤和所有尝试；重新 start 后继续。正常 worker 也自动回收，不抢占有效租约 |
| 隔离验证 | `npm.cmd run test:analysis-worker -- --output <仓库artifacts内全新目录>` |

迁移键 `2026-09-17-analysis-queue-v1`，只增加 `data_map_analysis_queue`、`data_map_analysis_queue_events`、`data_map_analysis_workers` 三表；worker 启动只检查结构，绝不执行 DDL。中断迁移先 inspect 再 apply 续建。仅本次创建且逐表确认为空时可按 events、queue、workers 顺序补偿；已有数据时保留表，按获准备份恢复。旧 分析运行存储 未入队运行继续兼容原入口；已入队运行必须先停止 worker、核对活动租约和恢复条件，不应切回不识别令牌门槛的旧执行器。

默认租约 15 秒、步骤超时 120 秒、重试间隔 1 秒；策略在入队时固定。停止正在执行的替身会将当前尝试记为 WORKER_STOPPED，允许在剩余次数内恢复；硬中断由租约过期恢复。status 中历史 worker 的 stopped_at 为空不一定仍存活，应结合 heartbeat_at 判断。事件和日志不记录令牌、SQL、材料正文或错误堆栈。部署凭据的最小数据库授权、正式实例启动和人工业务验收不属于本步本地实现。

status/inspect成功保留workers/queue数组，追加readiness、worker_state和每条diagnostic_state；未登记为not_registered，已登记分stopped、heartbeat_recent（数据库UTC最近10秒）、heartbeat_expired、heartbeat_invalid（未来时间）。process_state/worker_process始终not_checked；PID、心跳或租约不证明进程存活，stop_requested不等于停止完成。缺结构/标记为not_ready，无法完成检查为not_checked/DIAGNOSTIC_UNAVAILABLE，未知配置为CONFIG_UNSUPPORTED；workers/queue为null且退出1，不伪造零覆盖。详细缺失只出现在显式target维护入口；主动HTTP消费缺依赖503并仅返回安全错误。运行登记保留原runtime结构，追加dependency_check_version及依赖检查模块源码SHA-256，旧登记不回填。

业务事务每次重读所需结构/标记的完整元数据摘要；相同已核验结构仅复用解析结果，最多32项，无时间/授权/数据缓存，首次核验前后摘要须一致。同一事务的父检查覆盖子依赖；固定来源、人员及授权仍按原锁内复核。无本期新结构、marker、开关、角色、状态或UI变更。准确42表/443列/7个原marker审查面及条件、预检与恢复材料见本批次`evidence/p25/analysis-dependency-readiness-20261006-01/`；正式目标库、副本、开关/worker及本人恢复点未核对，隔离技术结果不表示业务验收。

独立worker的普通数据库操作与连接借用受`MYSQL_OPERATION_TIMEOUT_MS`约束；单实例命名锁另用专有连接维持，其每条查询单独计时，不能把长期持锁误判为操作超时。IPC或进程停止指令取消当前数据库等待，并继续尝试有界清理；无法确认清理时退出1，遗留租约仍由既有过期恢复路径处理，不据停止请求宣称停止记录已保存。数据库故障不无限保持进程。租约先到期记录`LEASE_EXPIRED`，执行硬期限先到期记录`STEP_TIMEOUT`，两者不能互相替代。

## 分析运行与证据存储

来源及运行列表的可见分页限制扫描10000行、5000毫秒；预算包含SQL等待及逐条来源范围解析，超限返回503，不返回截断页。`cursor`是上一页实际交付的最后一个标识，每条记录继续核权；不会跳过为判断下一页而预读的一条记录。单次运行的发现列表继续使用`offset/limit`，不接受游标。

分析运行存储 提供 MySQL 持久化基础，入口为定义仓储的 `createAnalysisRun`、`getAnalysisRun`、`beginAnalysisAttempt`、`completeAnalysisAttempt`、`finishAnalysisRun`。分析运行存储 本身不提供调度；分析队列与工作进程 工作进程及已入队运行的令牌门槛见上一节。分析HTTP及页面通过现有运行存储和队列能力办理，见“分析接口与可见范围”和“分析检查台”。

运行固定输入引用、来源阶段、台账/映射/设计关系版本、检查范围、步骤输入及检查项、解析器和规则版本。输入支持 `v7_source`、`definition`、`mapping`、`handoff`、`template`，分别引用 固定来源映射 来源、定义版本 定义版本、固定来源映射 映射修订、设计交接 设计关系修订和 定义版本 模板批次。V7 正文仍由原固定来源保存，分析表仅保存引用和摘要元数据。原始字节摘要与内容摘要分别登记算法；模板单元格摘要使用 `sha256-template-cells-v1`，不冒充原件字节摘要。

`queued/running/succeeded/partial/failed/cancelled` 是运行状态。计划步骤独立保存状态，每次尝试追加记录，保存已检查与未覆盖的检查项、错误码、操作者、开始及结束 UTC 时间。失败或部分完成后的重试保留旧尝试及发现；已成功步骤不能由重试覆盖。仅所有计划步骤成功时可结束为 `succeeded`；部分结果和未运行步骤仍明确可见。终态运行拒绝迟到写入；取消会结束仍在运行的尝试，保留此前结果。

请求复用 定义版本 的人员、动作、UUID 和请求摘要幂等回执。同键同请求返回原结果，同键异请求返回冲突；新的 UUID 创建新的运行。主动重跑另带已结束的 `rerun_of_run_id`，输入仍须明确提供并重新核对；步骤重试只在同一未结束运行内增加 `attempt_no`。运行锁、`expected_revision`、回执与结果同事务提交，失败全部回滚。

证据必须引用本运行及本步骤的固定输入，并给出 JSON Pointer 或文档锚点。JSON Pointer 实际检查能否定位；文档锚点标为 `declared_anchor`，只证明保存了声明，不证明原文已经核验。发现另存规则、主体输入引用、语义定位和对照算法版本；标题和数组下标不承担对照身份。每个运行/尝试有自己的发现实例，初始均为 `pending_verification`（待核实），`issue_id` 强制为空。缺少证据的发现可保存待核实，不能转为正式问题或关闭旧问题。发现确认与问题关联 如接入既有问题库，须另外补齐有权确认和本字段约束的兼容迁移。

仓储写入复用 `governance:structure-gate`，每次重新核对当前身份、管理员只读边界以及所有引用的读取范围。读取同样核对固定摘要及来源范围，依赖关闭或内容变化时返回明确错误，不把结果缺失解释为问题消失。`DEFINITION_ANALYSIS_*` 表示输入、覆盖范围、并发、状态、完整性及迁移错误，保留 定义版本/固定来源映射 的身份和引用错误。AI 只预留 provider、model、model_version、prompt_version、prompt_sha256、adapter_version，可为空；本步无模型调用或正式结论写入。

迁移键 `2026-09-17-analysis-runs-v1`，增加八张 `data_map_analysis_*` 表，依赖 定义版本/固定来源映射/设计交接。`npm.cmd run migrate:analysis-runs -- --target <host:port/database>` 默认只读 dry-run；支持互斥 `--inspect`、`--dry-run`、`--apply`，要求明确且匹配的 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`，不读 `.env`、不在启动时执行 DDL。无历史回填，不改原台账、V7、设计关系、正式问题、工作包或待办。

正式执行前须另获授权并备份。MySQL DDL 中断后先 inspect，再续建缺失表；只可对本次创建且逐表确认为空的增量表按 `finding_evidence → finding_inputs → findings → evidence → attempts → steps → inputs → runs` 逆序补偿。已有记录时保留表，使用获准的完整备份恢复；旧代码回退可保留增量表。本步可复验入口和副作用见 [scripts/README.md](../scripts/README.md#当前npm命令)。迁移、实际启用和业务验收须分别取得目标证据。

## 设计交接关系

`/app/design-handoffs` 用于维护相邻流程之间的一条设计交接。先在 固定来源映射 登记固定来源并明确对象、字段映射，再选择来源和目标流程行为，标明对象在各位置的产生、使用、修改、交付或接收用途。页面复用既有名称、人员角色描述和版本，不根据同名对象、行为顺序或部门名称自动连接或指派。对象和字段详情中的“查看设计交接及修订影响”可定位当前及历史修订引用。

每条关系保存两端固定来源、流程与行为引用、对象和字段版本、映射修订、单字段或组合标识的有序对应、交付条件、接收要求、两端证据位置，以及字段含义、格式、枚举、单位和版本的核对说明。每个维度明确选择待核实、无需转换或需要转换，并保留依据；需要转换时还须记录转换规则。这里只保存规则，不执行转换或系统同步。

`material_declared` 展示“材料声明”，`analysis_pending` 展示“分析待定”，`human_confirmed` 展示“人工确认”。前两种状态可保留缺一端来源、缺字段、未确认映射或缺转换依据的关系；至少有一端明确对象映射和行为。人工确认要求全部待核实项解决，包括目标必填字段、目标未映射字段、标识对应及两端来源有效性。此确认仅核对设计关系，不认定主数据、审核流程或证明实际接收。人员和时间由服务端记录，不接受上传内容冒充确认人。

关系修订只追加版本和引用记录。台账字段修订、对象映射修订或来源变化不会改写旧关系；读取时重新计算待核实项，保留原确认记录并停止把旧关系展示为当前有效确认。部门或权限变化后重新校验两端及所有字段，列表省略无权关系，不显示其标题和数量；依赖暂不可用时显示部分结果，不能视为不存在关系。

API 前缀 `/api/design-handoffs`：GET `capabilities`、`sources/:id`（选项上下文）、根清单、`:id`、`:id?version=<固定关系版本>`、`:id/history`；POST 根路径保存设计关系。清单可按 `entity_type=object|field&entity_id=<稳定ID>` 查询修订影响，`after` 数值分页每页50条，历史使用 `before` 每页50条。写入参数为 `request_id`、`handoff_id`（新建为NULL）、`expected_revision`（新建为0）和 `definition`。内部引用以固定 `mapping_version_id` 为准，稳定ID、名称和来源摘要由服务端反查。字段对应最多32组，证据最多32项；未声明属性拒绝。

写入复用 `governance:structure-gate`、当前有效身份及两端台账/来源范围；管理员多角色仍只读。不增加角色、办公室关系或正式审批权限。修订、幂等回执及引用同事务写入，409不自动采用新版本或重放。`DEFINITION_HANDOFF_*` 表示输入、映射、未核实、版本完整性及迁移错误；保留 定义版本/固定来源映射 错误，400/401/403/404/409/503含义沿用既有合同，不暴露SQL或受限正文。页面只在内存保留输入，重新登录后复核两端范围，失败、取消离开和旧响应不会静默覆盖可见输入。

迁移键 `2026-09-17-design-handoffs-v1`，新增 `data_map_design_handoffs`、`data_map_design_handoff_versions`、`data_map_design_handoff_refs`，依赖 固定来源映射。无启动DDL、旧数据回填或自动生成关系，不改旧V7、工作包、问题或待办状态。`npm.cmd run migrate:design-handoffs -- --target <host:port/database>` 默认 dry-run，支持互斥的 `--inspect`、`--dry-run`、`--apply`，要求明确目标环境变量，不加载 `.env`。正式执行须另获授权并备份；DDL中断先inspect再续建，仅本次新增且确认空表可按 refs、versions、handoffs 逆序补偿；有历史时保留增量表，采用获准备份恢复，不能清空重建。回退旧代码可以保留三表。

可复验入口见 [scripts/README.md](../scripts/README.md#当前npm命令)。实现及隔离技术验证不证明正式环境迁移、开启或真实业务验收。


## 固定流程来源与台账映射

入口 `/app/v7-mappings` 用于登记固定来源、核对来源证据，并把流程局部对象和字段明确关联到 对象字段管理 台账固定版本。`uploaded_material`（独立材料批次，版本1）和 `preview_revision`（案例及修订 ID）支持合法原生 V7/V8；V8 判断节点的数据引用沿既有 `use` 合同。`published_version` 支持原生 V8 及受支持 V7 的 `published`/`superseded` 版本，包括被替代但曾发布的历史版本。格式、正文和摘要不一致时仍按原合同拒绝。各类标识互斥；预览和材料的正式版本 ID 为空。引用预览、正式版本分别受既有功能开关及当前部门范围约束；登记不执行预览提升、正式发布或工作包创建。

MDM 具备 `governance:structure-gate` 的人员可登记及核对映射，仓储重新验证有效身份、权限和来源/台账范围。管理员兼有其他角色仍只读。独立材料的访问范围固定为登记人的当前部门，仅是访问控制范围，不据此认定材料的业务归口。现有预览和发布来源按其归口部门或全局读取权限访问；本模块不扩大参与部门的既有最小上下文权限。

使用时先登记来源，检查校验结果，选择一个局部对象或字段，再填写并读取台账版本 ID。页面展示精确名称、稳定 ID 和固定版本供人工核对；可从 对象字段管理 的版本历史取得版本 ID。`candidate` 展示为“映射建议待核实”，`confirmed` 仅表示人工已核对对应关系，均不授予主数据认定或流程发布状态。字段须绑定同一个固定对象版本，并引用该局部对象的映射修订；确认字段前须先确认对象映射。父映射改变后，字段原记录保留并显示需重新核对。未映射项保持待核实，同名、改名或数组顺序均不触发自动匹配。

API 前缀 `/api/v7-mappings`：GET `capabilities`、`sources`、`sources/:id`、`sources/:id/evidence?object=<ref>&field=<ref>`、`sources/:id/mappings/:mappingId/history`；POST `uploads`（multipart 文件和请求 UUID）、`sources`（固定引用）、`sources/:id/mappings`（局部引用、对象/字段固定版本、状态、依据、来源摘要及 `expected_revision`，首次为0）。对象/字段稳定 ID 从版本反查，不能由客户端伪造。请求 UUID 绑定人员、动作、完整内容；同请求重试不产生新修订，内容不一致返回409。清单每页100条、历史每页50条；单个来源最多1000个对象与字段，原始上传上限4 MiB。

原始上传字节仅在内存参与解析和 `sha256-raw-bytes` 摘要；不保存原文件副本。系统另保存原生解析内容快照及 `sha256-v7-stable-json-v1` 摘要。该名称保留旧合同，对 V7/V8 均执行对象键稳定排序的 JSON 序列化；不代表正文降级，数组顺序仍影响完整内容摘要。来源详情、证据、当前映射及历史读取增加可选 `schema_version`，从经摘要核对的固定正文派生；不改写旧映射快照、摘要或幂等回执，不新增列。已有预览/正式版本没有上传字节时，原始字节摘要明确为不可用。无效 UTF-8/JSON 记录 `parse_failed`，无效 V7/V8 记录 `validation_failed`；两者没有可映射节点。共享纯校验器及有效部门卡口在确认时重算；`ACTOR_DEPARTMENT_UNRESOLVED` 不可由人工映射解除。来源摘要或父映射变化会阻止沿用确认，不改写原生正文、审核记录或台账历史版本。固定来源读取显式列出既有必需列；缺表/列准确返回503，不能由当前校验结果掩盖缺失的保存校验记录，也不自动建表。

迁移新增 `data_map_v7_sources`、`data_map_v7_mappings`、`data_map_v7_mapping_versions`，无旧记录回填或状态转换。映射头、不可变修订、幂等回执同事务提交；对象字段管理 停用影响在新表存在时统计历史映射版本。`npm.cmd run migrate:v7-mappings -- --target <host:port/database>` 默认 dry-run，支持显式 `--inspect`、`--dry-run` 或 `--apply`，要求 定义版本 已迁移及准确目标环境变量，不读取 `.env`，应用启动不做 DDL。正式执行须另获授权并备份。DDL 中断后先 inspect 再续建；只有本次确认新增、为空且无引用的表才可人工按引用逆序补偿，有历史数据时保留并通过获准备份恢复。回退旧代码可保留增量表，不清空历史。

错误码以 `DEFINITION_V7_*` 标识解析、固定引用、映射状态、父映射、来源摘要、修订、完整性及迁移问题；保留既有 `DEFINITION_*` 身份、台账和幂等错误。400 输入不合法，401 身份失效，403 无权，404 来源/定位不存在，409 版本、来源或状态冲突，413 超限，503 迁移、既有功能开关或依赖不可用。响应不返回 SQL、堆栈或受限材料。输入仅在页面内存保存；失败、取消切换及重新登录保留原输入和提交时版本，恢复身份后重新核对访问范围，409 不自动更新或重放。

验证入口及源脚本见[脚本说明](../scripts/README.md#当前npm命令)。固定来源成功不代表分析、编制答复、办公室材料或工作包已通过各自准入。实际副本、目标库及运行开关分别核对；历史批次证据按文末快照定位。

## 台账事实核对

本地新入口 `/app/fact-checks` 承接对象、字段的定向事实问题。MDM 从对象或字段详情选择需要核对的内容，保存草稿、明确部门及可选人员后发出；目标部门具备编制权限的人员答复具体事实并提供文件、页码、表格或单元格等证据定位。缺少证据时须明确说明，MDM 可要求补充。台账修订继续使用 对象字段管理 的本部门编制权限，MDM 的结构核对权限不授予代写部门材料的能力。

答复、重新核对及核对结论绑定对象和字段固定版本、内容摘要、选定范围、人员、时间、理由与证据。页面可定位台账并返回同一办理位置。相关内容变化后旧意见保留，但不能直接核对完成；MDM 明确查看新旧内容并重新发起后，业务人员须针对新内容再次答复。没有涉及选定范围的修改和枚举允许值重排不使意见自动失效；组合标识顺序不在本步可核对字段范围内。

`checked` 只表示指定事实核对完成。当前来源、建议权威来源继续分别保存在定义中，核对依据保存在办理历史；新对象、字段正式认定的有权主体及审批依据仍待确认，最终治理结论保持空值。接口拒绝正式认定、关闭正式问题和发布动作，不信任上传材料中的审核状态。不新增正式问题库、办公室分配或通知，也不建立流程工作包。

API 前缀为 `/api/data-map-facts`：GET `capabilities`、`targets`、根清单、`:id`；POST 根创建草稿、`:id/edit|send|answer|more_info|rebind|check`。创建需要 `subject_version_id`、`object_version_id`、白名单 `focus[]`、具体 `question`、目标部门及可空人员、请求 UUID；后续写入另需 `expected_revision`。发起和核对复用 `governance:structure-gate` 与来源范围；答复复用 `governance:draft-department`，核对当前目标部门及指定人员。admin 即使兼有这些权限仍只读。无权读取返回 404，跨部门收件人仅得到明确发出的固定内容，不得到整对象、原模板或未发出的草稿历史。

新增 `data_map_fact_requests` 和 `data_map_fact_events` 两张表，保留 定义版本 对象、字段、定义版本、来源、ID及审查记录。请求当前状态和追加历史在同一事务写入，核对完成时同事务追加原 `data_map_definition_events.fact_checked`；并发、幂等及失败回滚复用现有仓储约束。清单及组织选择每页100条，历史每页50条，返回续读位置。没有旧记录回填或审批状态转换；对象字段管理 停用影响统计在新表存在时增加定向事实请求数量，无新迁移时原管理能力仍可用。

迁移入口为 `npm.cmd run migrate:data-map-facts -- --target <host:port/database>`，默认只做 dry-run；可显式加 `--inspect` 或 `--apply`。要求显式提供既有 MySQL 环境变量及完全匹配的目标，且 定义版本 迁移已完成；不加载私有 `.env`，应用启动不执行 DDL。正式实例仍须另获授权并先备份。MySQL DDL 失败后先 inspect 再续建，不能假设整体回滚；仅对本次确认新增且为空、无后续引用的表考虑人工补偿，已有记录须保留并通过获准备份恢复。旧代码回退可保留新表，不删除历史。

新增错误以 `DEFINITION_FACT_*` 区分目标缺失/无效、核对范围或证据缺失、状态/修订/来源/完整性冲突以及迁移缺失。400 表示输入问题，401 身份失效，403 无写权限或正式动作未开启，404 无可披露请求，409 并发、来源或状态冲突，503 迁移或依赖不可用；不返回 SQL、堆栈或受限原文。表单只在页面内存保留，失败或取消离开保留输入；重新登录后先核对身份和事项访问权限，409 不自动采用新修订或重放写入。

验证命令为 `npm.cmd run test:data-map-facts -- --output <仓库artifacts内新目录>`，前置及证据说明见 [scripts/README.md](../scripts/README.md)。这属于本地实现和隔离验证，不表示正式环境已开启或业务已验收。

<a id="v7精简后的工作入口"></a>


### 固定交接关系检查

交接详情页按确定缺陷、待业务核对和本轮未覆盖范围展示关系检查，可定位同一修订的两端流程、对象、字段版本和证据。GET /api/design-handoffs/:id（含version查询）增量返回relationship_checks；旧响应字段、保存状态和审批权限保持。页面计算只读，不创建运行、不自动确认、不调用模型。

独立worker新增handoff_deterministic解析器和handoff-deterministic-v1规则集，每步骤一个固定handoff输入；沿用分析运行存储存储和分析队列与工作进程领取令牌。完整规则清单见server/handoffAnalysisRules.js。格式、枚举及同字段版次与“无需转换”声明的明确矛盾为确定缺陷；其余缺失说明、身份及标识对应保持待核实。不同平台对象不合并，多个接收方分别登记。枚举仅顺序变化不判冲突，未知值不当作确定差异。

单位比例仅有文字规则，适用范围没有结构化确认，用户尚未确认主链框架及完整输入，因此结果明确保留未覆盖。转换说明齐备也不证明执行正确或真实接收。handoff.coverage负责记录缺口说明，相关实际检查仍留在coverage.missing；不把未执行检查伪装成已覆盖。现有设计交接实时修订影响仍单独显示，不改固定历史运行。无新表、迁移、回填或正式动作；旧运行及分析队列与工作进程/确定性规则适配器继续保留。回退前须停止worker并处理交接关系检查队列，旧worker不能接管新解析器。

### 跨运行发现对照

仓储新增只读方法 `compareAnalysisRuns(session, beforeRunId, afterRunId)`，在同一事务中复核两个运行的当前身份、部门及材料范围、固定来源和结果摘要，再调用 `server/analysisComparison.js`。本步未注册HTTP路由或新增页面；分析API属于分析HTTP接口范围。

当前只读对照算法 `analysis-diff-v2`（原v1历史及旧comparison_key保留）使用部门范围、规则语义标识、材料逻辑身份和对象/字段语义标识计算匹配键。每次运行仍保留独立finding_id；旧comparison_key及全部证据不改写。标题、文件名、输入键、步骤名和数组下标不决定身份。来源阶段不跨越合并；独立上传批次或模板批次缺少显式谱系时不能推断为同一材料。

返回新增、持续、证据变化、本轮未再检出、不可比较、待人工匹配六类结果，以及前后运行、manifest摘要、发现/尝试ID、证据键和覆盖摘要。只比较每个步骤最后一次尝试；旧尝试保留。规则版本没有显式兼容映射、解析器或AI配置改变、部门或步骤输入/规则范围变化时保守标不可比较。当前未提供兼容映射编辑或人工匹配写入入口。相同规则的可比范围完整覆盖后才允许新增或本轮未再检出；其他范围缺口仍单独保留。失败、取消、未结束运行不能得出问题消失结论。局部对象/字段或交接字段对被删除时标不可比较，不据删除认定整改。身份含内容摘要、未知算法、重复逻辑主体或缺证据时待人工匹配。

固定来源摘要或证据位置变化可标证据变化，因此正常重排可能改变证据状态，但不制造整批新增发现。`comparison_complete=false`表示仍有不可比较、人工匹配或覆盖缺口；空结果也不能掩盖这些缺口。本轮未再检出不等于已整改，不生成待办、不关闭问题、不改变审批链。新方法不写数据库；无需DDL、回填或旧数据转换，移除入口即可回退，分析运行存储—交接关系检查数据和原读取接口保持兼容。

### 分析接口与可见范围

同源 `/api/analysis` 提供受限分析API。接口使用现有会话、CSRF、有效人员身份、权限和来源范围；全员摘要尚未开放。管理员即使兼有结构核对权限仍只读。当前仅接受确定性规则/交接关系检查确定性规则运行，创建与入队在同一事务提交；独立worker仍须按既有命令显式启动，HTTP服务不会自动启动worker。

| 方法及路径（相对 `/api/analysis`） | 用途和响应范围 |
|---|---|
| GET `/capabilities` | 当前创建资格、允许来源类型、摘要字段清单；`public_summary_enabled=false` |
| GET `/sources?kind=…&offset=0&limit=50`、`/sources/:kind/:id` | 五类固定来源：v7_source、definition、mapping、handoff、template；返回固定标识、版本、摘要及来源元数据，不返回正文或模板原值 |
| POST `/materials/references`、`/materials/uploads` | 复用固定来源映射的预览修订/已发布版本引用或单个V7 JSON上传；后者使用multipart的file和request_id，4 MiB上限；模板接收继续用模板导入入口，其他格式留固定证据 |
| POST `/runs` | 分析运行存储固定输入合同加确定性规则/交接关系检查准入；同request_id同内容返回原创建结果，异内容409；失败不留孤立运行。重新运行另给request_id及rerun_of_run_id |
| GET `/runs`、`/runs/:id/summary` | 仅run_id、status、revision_no、created_at、started_at、finished_at六个字段；不含标题、材料名称、人员或发现数量 |
| GET `/runs/:id` | 固定输入元数据、规则和解析器版本、步骤尝试及覆盖缺口；不展开发现、原文或人员身份 |
| POST `/runs/:id/cancel` | request_id与expected_revision；沿用分析队列与工作进程取消，兼容未入队分析运行存储运行，旧修订409 |
| GET `/runs/:id/findings`、`/runs/:id/findings/:findingId` | 当前有权范围内的发现内容、尝试/步骤、稳定标识和证据ID；保留待核实及issue_id为空，不成为正式问题 |
| GET `/runs/:id/evidence/:evidenceId` | 复核运行、证据归属、固定引用及当前范围后返回定位摘录；JSON Pointer可解析原文，document_anchor仅保留已声明定位，不伪造提取结果 |
| GET `/runs/:id/diff/:otherId` | 双方全部来源授权后返回运行对照差异及覆盖缺口；不据未检出关闭问题 |
| GET `/runs/:id/export` | JSON附件analysis-export-v1；固定运行、发现及证据定位元数据，不含原文摘录、原始字节、创建人、内部会话或队列信息；不接受扩大导出范围的查询参数 |

每层读取均重新核对当前身份及所有固定来源。运行包含任一无权材料时，整条运行不可读；不把部分可见误写成全量结果。列表在授权过滤后分页，offset只计可见记录，limit为1—100、默认50，offset最多10000；不输出全库总数、隐藏数量或基于隐藏ID的游标。依赖/摘要异常返回明确错误，不能理解为旧问题消失。部分运行仍返回既有结果和缺口。所有响应禁止缓存；资源不存在和无数据范围统一404，动作权限不足沿用auth的403，身份失效401，冲突409，超限413，依赖不可用503，JSON格式错误400。错误不回显正文、SQL或堆栈。

JSON请求上限256 KiB；材料只写固定来源映射私有MySQL来源，不写public、frontend或可下载目录。分析HTTP接口运行API不提供客户端回填分析结果、启动worker、正式问题/待办写入或全员明细入口；发现确认与问题关联人工确认使用下文列出的独立接口。没有新增表、DDL、回填、角色或审批状态。旧仓储接口和分析运行存储—运行对照记录保持，回退可移除本路由及投影模块，已创建队列按分析队列与工作进程规则处理。正式库迁移、正式运行、人工体验和业务验收仍须单独完成。

### 分析检查台

新入口 `/app/analysis` 接入 分析HTTP接口 受限 API，可选择固定 V7 材料或设计交接版本，创建、查看和取消分析。页面列出当前来源阶段、范围、规则版本、时间、步骤进度及覆盖缺口。AI 未调用、历史评审未导入；分析检查台交付时规则结果仅供待核实查阅；发现确认与问题关联新增人工确认和问题关联，办公室派单仍未在本入口开启。

`GET /api/analysis/capabilities` 增量返回 `adapters`，每项包含 kind、parser_key、rule_version、check_ids 和公开规则目录 catalog。前端按服务端目录创建确定性运行，原有响应字段及授权保持。没有新增数据库结构、审批状态或历史回填；已有运行、步骤尝试和来源版本原样可读。

发现可按内容或对象字段标识、类别、固定输入和步骤尝试筛选。默认仅显示各步骤最后一次尝试，也可显式查看历史尝试；这不表示旧问题关闭。URL 片段保留运行、筛选、发现、证据及对比选择，刷新时重新授权读取；返回按钮恢复原筛选位置。输入只保留在内存，离页提示，失败不提交或清空；身份失效后同一人员/部门重新登录可继续核对，切换身份不复用草稿。

证据通过单独授权接口读取。固定交接根证据展示两端流程、对象、字段版本、交付接收说明及原文声明位置；摘录按纯文本呈现。缺少证据、声明位置尚未提取和快照中的空值分别说明，不据此判断原制度未说明。图形只画显式分析路径或已登记两端，不推断主链或实际贯通；无外部图形依赖，不依赖63805服务或携带历史业务JSON。

“导出当前筛选范围”先重新请求受限导出，再按当前筛选裁剪发现及其证据定位。下载格式为 `analysis-view-export-v1`：source_format_version 保留服务器格式名，selection 记录当前筛选，run 保存获准运行元数据，findings/evidence 为筛选结果，changes_governance=false；不含原文摘录或原始字节。分析HTTP接口 原 `analysis-export-v1` 接口格式保持。

开发验证：先 `npm.cmd run build:frontend`，再 `npm.cmd run test:analysis-workbench -- --output <本仓artifacts下全新目录>`。正式环境需要另行按既有发布及worker流程授权开启；自动化验证不等于人工中文输入法体验或业务验收。

### 发现人工确认与现有问题池

在 `/app/analysis` 的发现详情中，有 `governance:structure-gate` 权限且具备全部来源访问范围的有效人员，可以确认发现、说明不是问题、明确创建问题或关联已有问题。管理员即使兼具该权限仍只读。提交必须提供理由、明确归口部门及依据，并选择属于本发现的已解析证据；未明确归口或只有声明位置时继续待核实。归口由人员明确选择，不从上传者、名称或旧职责推断。

新增接口均位于 `/api/analysis`：

| 接口 | 用途 |
|---|---|
| GET `/issue-targets?after=…` | 当前获准范围内的有效部门，每页100条并返回next；不自动选归口 |
| GET `/runs/:id/findings/:findingId/review` | 原始发现之外的人工确认状态、修订及历史 |
| POST 同一路径 | action为confirm、not_an_issue、create或link；request_id、expected_revision、reason、owner_department_id、owner_basis、evidence_ids必填。create另需title；link另需issue_id、expected_issue_revision、expected_issue_digest |
| GET `/issues/:issueId` | 读取已有问题及精确编号、摘要、关联修订；对已关联问题同时核对全部发现来源，可从问题返回每条发现 |

尚无人工记录时修订为1，首次提交后为2。confirm不创建问题；not_an_issue仅适用于当前未关联发现，不关闭问题，不批量驳回同规则或同标题发现。创建或关联也可一步提交人工确认；一条发现最多关联一个问题，一个问题可关联多条发现。已关联或已说明不是问题的决定不可在本步覆盖或解除。关联已有问题必须先读取并核对其摘要及修订，部门不匹配、已关闭、来源变化、过期尝试及并发冲突均拒绝。固定来源仍保持可追溯，不把历史定义自动换成最新版本。

数据库只增量新增 `data_map_analysis_issue_bindings` 和 `data_map_analysis_finding_reviews`，保存关系、确认快照和并发元数据；正式问题仍只存在于 `process_governance_issues`，其已有字段和状态枚举不变。分析运行存储原始发现的pending_verification、issue_id=NULL及结果摘要继续保持，人工决定通过review接口单独读取；原分析导出仍表达不可变规则结果，不包含人工决定。旧问题、旧发现不自动回填或推断确认，旧问题显式关联时也不改写其原字段。

旧问题池仓储对已关联问题的关闭、重开、备注、问题点动作、术语动作和生成覆盖均拒绝，并在问题行锁内检查。旧列表不暴露新来源或已关联问题，旧详情/写接口统一返回404；新受限接口核对全部关联来源后才显示内容。未关联的旧问题维持原有行为；V1—V3及跨部门承接退役边界保持。本节人工确认不授予关闭权；逐问题指定、复核和重开见下方办公室问题办理。待办完成或本轮未检出均不自动关闭问题。

迁移入口为 `manage:analysis-issues`，显式目标、默认dry-run，不随服务启动迁移。检查定义版本/固定来源映射/分析运行存储标记、原问题/事件表兼容结构和两张增量表；不兼容时报错，不能用另建问题库绕过。仅在获准环境执行apply；正式环境未开启。表内无数据时可按“finding_reviews → issue_bindings”补偿本次自有空表并处理对应迁移标记；有记录后保留业务数据，使用经验证备份恢复。已经建立关联时，不得回退到缺少旧入口保护的旧代码；回退需保留保护层并停用新确认入口，不能删除关系后重新开放旧关闭动作。

本地验证：`test:analysis-issues -- --output <本仓artifacts下全新目录>` 使用自有tmpfs MySQL、合成身份、随机回环HTTP、独立worker和Edge；覆盖迁移、事务、权限、并发、关联、旧接口保护、备份恢复和输入保护。正式数据库、通知、部署、人工中文输入法体验及业务验收不属于该自动化证据。

### 问题交办、办公室办理与逐问题复核

发现详情的关联问题中，点击“查看办理与交办”读取任务历史。有 `governance:assign-work` 且可读取该问题全部固定来源的有效人员，手工选择已登记、有效且属于问题明确归口部门的办公室。管理员即使兼具业务角色仍只读。用途为核实、整改、协调或复核；用途不授予正式复核权。办公室未明确时保留未分派，自动派单始终关闭。

- GET `/api/analysis/issues/:issueId/tasks`：返回获准问题的关联待办、固定交办快照、办理结果、可选办公室及当前问题修订。
- POST 同一路径：提交 `request_id`、`expected_revision`、`expected_issue_digest`、`office_id`、`purpose`、`round_no`、`instruction`。purpose为verify/correct/coordinate/review。每个问题的同一用途从第1轮开始，前轮办结后才能明确增加下一轮；同一用途同一轮不得再次派单。重跑分析不创建待办。
- GET `/api/analysis/issues/:issueId/closure`：返回当前获准问题的复核指定、条件、决定历史、固定办理结果及来源版本变化。仅归口部门最终负责人可读取可指定候选，其他人员不会获得候选名册。读取发现旧指定失效时追加暂停记录，资格恢复后原指定仍不恢复。
- POST `/api/analysis/issues/:issueId/review`：提交 `action=designate|review|reopen`，共同提交 `request_id`、`expected_revision`、`expected_issue_digest`、`expected_context_digest` 和 `reason`。负责人本人指定或重开时提交 `reviewer_person_id`、非空字符串数组 `conditions`；重开另须 `reopen_evidence`，说明新增证据或原依据失效。复核提交逐条件 `checks`：`condition_id`、`satisfied`、`basis`；已满足项另须 `todo_id`、`task_revision`、`excerpt`，摘录必须来自当前固定的已办结结果。全部条件满足且核实、整改、协调任务全部done时才关闭，否则保存未通过结论并保持问题未关闭。

交办复用 `mdm_todos`、`mdm_todo_office_assignments` 和原事件表，仅增加 `data_map_analysis_issue_tasks` 关系表。创建待办、办公室关联、来源/问题修订快照、审计和幂等回执在同一事务内完成。旧问题、旧待办、原分析结果和历史标识不回填、不重写。问题状态不随待办改变；`completeTask` 仍只设done。继续处理创建新的明确轮次，前轮结果保留，不冒充“问题重新打开”。

办公室负责人仍在现有办公室工作台分配有效导入成员，成员仍使用原入口填写结果并办结。新任务正文仅含问题编号、用途与轮次；专门办理说明仅投影给办公室负责人、被分配成员或已有全局读取身份，不附带原材料、发现内容和完整来源快照。普通成员不能读取其他成员的新问题任务；原问题及分析证据继续使用原权限和全部来源范围。个人工作台复用已有办公室待办和1—3项优先动作入口。返回问题时沿用原分析URL和筛选；任务详情在现有办理弹窗中展开。

交办输入只保留在内存，失败和同身份重登保留；问题修订变化时先读取，再明确选择采用当前修订，不自动重放提交。新关联任务的长说明按需展开；办理弹窗遇401会隐藏但保留输入，原账号重登后重新核对任务与办理关系再恢复，原待办修订不自动更新。不同身份不能展示原账号的输入。

迁移 `manage:analysis-tasks -- --target host:port/database` 默认dry-run；`--apply` 仅在另获授权的目标执行。不随服务启动DDL，先检查发现确认与问题关联及办公室依赖，拒绝结构漂移。无回填；中断可inspect后续建。仅本次自有且确认空的增量表可补偿删除；已有记录时保留关系及办公室投影保护，停用新交办入口或按完整备份恢复，不删除关联以重新开放旧问题写入。正式数据库、通知及部署未开启。

本节记录现有复核实现；实际复核主体、授权及关闭条件仍须按有权确认核对，历史阶段合同不代替当前业务依据。归口部门最终负责人本人以当前 `departments.final_responsible_person_id` 关系指定一人并确认关闭条件；不能代录。候选仅限有效mdm_lead或data_quality_auditor，须已有全部来源读取权限，且未参与该问题历史核实、整改或协调办理；历史被分配人员也纳入分离检查。角色只决定候选资格，逐问题指定才产生本问题复核权。管理员多角色仍只读。

关闭条件改变须负责人再次确认；来源版本或办理结果改变须重新读取并逐项复核。页面同时保留原固定来源和当前获准版本变化，不静默替换原分析来源。指定时绑定当前账号授权代次与有效授权集合；支持的账号禁用/恢复、角色撤销/恢复入口递增auth_version，因此恢复不会恢复旧指定。读取发现人员、资格、权限或办理参与失效时持久记录暂停。原关闭决定保留，只有负责人依据新增证据或原依据失效明确重开，且同时重新指定人员、确认条件；不会因版本变化自动重开。

`manage:analysis-closure -- --target host:port/database` 默认dry-run，明确apply仅增加 `data_map_analysis_issue_closure_events`、`data_map_analysis_issue_closure_heads` 及迁移标记，依赖办公室问题办理待办迁移，无回填、无新角色或问题实体。决定、状态、摘要、修订、原问题事件和幂等回执共享事务。办公室办理与关闭使用同一问题行锁；已关闭问题不能继续改变关联任务。普通待办不受此锁约束。DDL中断可检查后续建；仅自有空增量表可补偿，有历史时必须保留关系、暂停记录和旧入口保护，停用新动作或使用完整备份恢复，不删除历史来回退。正式迁移和部署仍需明确授权。

复核输入只存内存，与交办表单互斥；返回/刷新可取消，401同身份恢复、403/409/503与网络失败保留输入，重新读取后须明确采用当前复核修订，不能把刷新当作确认。复核不通过不自动派单，由有权交办人明确开始后续轮次。本地隔离闭环不代表人工或业务验收。


### Excel 固定证据读取

分析检查台新增“Excel 证据读取”。有结构核对权限的人员可登记 .xlsx；管理员保持只读。登记保存解析快照和原始字节 SHA-256，不保存原始文件字节、不新建对象或字段、不调用 U8、不计算公式。单元格包含工作表、原地址、类型、解析原值、原始 XML 值/公式、数字格式、合并引用及缓存状态；XML 值保留包内词法形式，不能把共享字符串索引当作业务值。原始 XML 无法定位时明确为 unavailable。

POST /api/analysis/materials/excel 使用 multipart file、request_id、可选 links JSON。单条显式关联包含 sheet_name、cell_address、kind（definition/mapping/v7_source）、ref_id、basis；只接受存在且有权读取的固定版本。界面支持一条关联，API 最多32条；空关联保持未关联，不按名称匹配。文件、解析器、关联集合和登记部门共同确定证据批次；同内容重试幂等，关联变更登记新批次，历史保留。

GET /api/analysis/materials/excel/:id 返回来源、工作表与覆盖说明；sheet + offset 每页100个单元格；sheet + address 定位单元格。每次读取重新核对身份、登记部门、全部关联来源范围和固定摘要，no-store；无权及不存在统一404，定位失败不回退到近似单元格。文件/解析/字段超限413、输入损坏400、摘要或幂等冲突409、迁移未准备503。

新适配器 excel_evidence / excel-extraction-v1 复用原分析运行、独立worker、发现与问题入口；只生成读取覆盖和公式缓存待核实说明，业务事实核验始终未覆盖，默认运行结果为部分完成。发现定位使用固定快照的 JSON Pointer，语义身份为工作表名称及规则，页面同时显示原单元格地址，可回到完整证据浏览；没有自动确认问题或派单。

兼容：新增 data_map_excel_evidence 一张快照表，外键指向既有 data_map_source_files；复用既有批次和分析输入 batch_id 外键，机器输入 kind=template 保留，source_kind=excel_material、批次 source_type=excel_evidence 区分其他Excel。旧主数据模板解析器、模板批次、V7和历史运行格式保持；新增来源不冒充模板导入或正式业务认定。台账显式关联参与问题版本核对及复核来源变化检查。

迁移入口 npm run manage:excel-evidence -- --target HOST:PORT/DATABASE 默认dry-run，--inspect/--apply 显式执行，依赖分析运行存储及其已有基础表。无启动DDL、无旧记录回填。DDL中断后inspect续建；仅本次自有且确认无记录的增量表可补偿移除，有数据时保留表或按完整获准备份恢复，不删除历史批次。停用新入口时保留快照表；不把旧程序无法识别Excel解释为可继续处理该新来源。

资源边界：文件5MiB，实际解压32MiB，ZIP1000项，32张工作表，每表5000行/16384列、合计100000个已读取单元格，快照24MiB；解析worker最大堆256MiB、15秒超时、最多2个并发。只忽略条件格式/数据验证的整列范围，实际单元格坐标仍受限。宏、外部工作簿引用、嵌入活动内容及实体声明拒绝；超链接不跟随，材料指令不执行。图形、图片、切片器、条件格式、数据验证及无值样式单元格明确未覆盖。本步未开启DOC/DOCX/PDF，不代表正式环境已迁移或人工业务验收。

## DOCX证据读取

用户已明确只支持DOCX，不允许上传DOC。分析检查台提供“DOCX 证据读取”；客户端文件选择限制为.docx，服务端再次检查扩展名、OOXML包、主文档关系与内容类型。旧版.doc、改名为.docx的二进制DOC、宏格式均拒绝；不调用桌面Word、不自动转换，也不建立转换上传旁路。仅有合成测试不能代替指定真实DOCX样本核对或业务验收。

原件不修改，不保存原始文件字节；保存固定读取快照、原始字节SHA-256、规范JSON摘要及word-evidence-docx-v1版本。正文段落、表格、行、单元格保留部件、XML路径、顺序、父结构和原文。结构标识只在本快照内有效，不作为跨文件业务身份。重复标题不合并，未渲染页码为null。图片文字、页眉页脚、批注、脚注、尾注、删除修订、替代表示区及视觉合并网格未覆盖。域代码、超链接和材料指令不执行；显示值只能作为现存缓存。

| 同源接口 | 行为 |
|---|---|
| POST /api/analysis/materials/word | multipart的file、request_id和可选links；登记DOCX证据，管理员保持只读 |
| GET /api/analysis/materials/word/:id | 覆盖、固定摘要、显式关联和前100个结构 |
| GET /api/analysis/materials/word/:id?offset=100 | 分页结构，保留原文顺序 |
| GET /api/analysis/materials/word/:id?anchor=a0 | 固定快照内准确结构定位；不存在则404，不猜相似标题 |

links最多32项，每项为anchor_id、kind（definition/mapping/v7_source）、ref_id及basis。后端复核结构位置、固定版本及全部来源权限；未填保持未关联，不按同名自动匹配。相同文件、关联和范围去重；关联变化形成新批次，历史保留。登记前后均重新授权，写入事务内保存幂等回执；来源范围或摘要变化后材料、分析、导出、问题及复核一并重新核权。问题仍进入原问题实体，复核上下文递归纳入显式关联的固定与当前版本，不新增治理授权。

兼容：增量表data_map_word_evidence只保存绑定既有来源批次的不可变快照。机器输入kind=template与batch_id外键保留；source_kind=word_material、source_type=word_evidence区分DOCX与其他Excel、指定模板。旧数据不回填、转换或清空，无启动DDL。旧程序不支持解释新Word快照，回退时先停用Word入口并保留快照和批次，不声称旧程序能够继续分析该格式。

迁移键2026-09-18-word-evidence-v1；npm run manage:word-evidence -- --target HOST:PORT/DATABASE默认dry-run，--inspect/--apply显式执行，依赖分析运行存储基础。重复apply、部分DDL续建及漂移拒绝；仅自有且确认空的本次增量表可补偿删除，已有数据采用完整获准备份恢复。正式实例迁移和启用需另行授权，本实现不代表正式运行已开启。

word-extraction-v1通过原worker生成读取范围、首个正文结构定位和业务未覆盖说明。默认partial，结构证据可浏览，发现可人工关联问题并追溯原文；不把读取完成当作业务事实正确。前端失败、同身份重登、取消离开/刷新时保留文件和输入，旧异步返回不恢复已切换证据；登记成功不清空用户已填分析范围。上传和浏览内容不写浏览器持久存储。

资源上限：5MiB原件、32MiB实际解压、1000 ZIP项、100000 XML节点、128层、20000结构、2MiB正文、12MiB快照；解析线程256MiB堆、15秒、2并发。复用已有ZIP检查且保持Excel默认值；直接依赖saxes 5.0.1沿用既有锁定版本。宏、活动嵌入、外部模板及实体声明拒绝。此前指定.doc仅用于拒绝验证，不能计作DOCX成功样本；用户新指定《工装交检申请表.docx》已按批次记录做只读解析核对，人工体验和业务验收仍须另行记录。

### PDF 固定证据

新增 POST /api/analysis/materials/pdf 接收单个 PDF 文件和 request_id、可选 links；GET /api/analysis/materials/pdf/:id 按 offset（每次100项）、page（物理页）、anchor（文本锚点）浏览固定快照。显式关联沿用 kind/ref_id/basis，并用 anchor_id 定位已核对文本；只接受 definition、mapping、v7_source 固定版本，不按标题或字段名称合并。上传前及事务提交时复核身份、部门和所有关联来源，管理员治理只读。

解析器 pdf-evidence-text-v1 使用精确依赖 pdfjs-dist 5.4.624，只从内存字节提取文本。每片保留物理页序号、页内片段序号、原PDF变换和左上坐标系视口变换、宽高与文本；原字节SHA-256和固定内容摘要分开。每页保存文字量、替换字符数和提取状态。没有文字的页面标为提取不足，不能区分空白页或扫描页；不执行OCR、不推断表格行列、阅读顺序、印刷页码或跨页关系。此技术状态不证明文本完整或正确。

PDF解析使用自有受限子进程，最多2并发、15秒、256MiB V8堆，文件5MiB、300页、20000文本锚点、2MiB文本、12MiB快照；超限整体拒绝，不截断成成功。子进程不继承数据库或模型配置；只用本地字体/CMap，禁用网络、eval、XFA和链接/动作执行。文档、页面和注释中的脚本及附件拒绝，加密文件拒绝。解析错误脱敏；资源超限413、繁忙503、来源/幂等冲突409。

新增 data_map_pdf_evidence 表复用原来源批次外键；迁移键为2026-09-18-pdf-evidence-v1。manage:pdf-evidence 默认dry-run，必须显式准确target；无启动DDL、旧数据回填、自动转换或清空。回退先停用新增入口并保留快照，恢复需使用目标环境获准的完整备份。旧Excel、DOCX、模板、V7、问题与待办ID/状态保持。

/app/analysis 提供PDF登记、物理页筛选、文本分页与坐标浏览、分析创建和问题到证据跳转。pdf_evidence/pdf-extraction-v1仅报告技术读取覆盖和位置，业务核验始终未覆盖，默认partial；复用原问题/复核实体，不新增审批权。失败、取消离开/刷新和同身份重登保留输入；原文不写公开构建或浏览器持久存储。

本地验证入口为 test:pdf-evidence、test:pdf-evidence-integration；后者强制自有MySQL、随机回环HTTP、独立worker与Edge，合成数据并在结束恢复/清理。正式迁移、服务开放、人工IME和业务验收未执行。依赖接口依据：[PDF.js 官方API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)。

### 离线 AI 适配与校验

分析检查台的“单流程与离线 AI 校验（不调用模型）”选项复用现有受限 API 和队列，同时建立 V7 确定性检查及离线意见校验两个步骤。默认替身返回空意见，只完成输出校验；真实 AI 分析始终未覆盖。页面中的“部分完成”不能解释为材料合格、问题消失或业务验收。正式数据治理工作包仍然不调用 AI、不自动确认，模型无账号、数据库、治理写接口或工具句柄。

`server/analysisAiOffline.js` 固定适配版本 `analysis-ai-offline-v1`、提示词版本 `analysis-opinion-v1` 及提示词原字节 SHA-256；请求为单个固定 V7 流程的文本定位证据，必要时可通过同一分析 API 显式加入最多三个已经关联该固定流程的 Excel、DOCX 或 PDF 快照。页面本轮只提供单流程入口，附加材料使用 `createPayload(sourceId, requestId, description, materialBatchIds)` 技术接口。材料必须带有指向同一 V7 固定引用及摘要的显式关联，不按名称或排列推断关系。未关联、材料过大或文本不能完整进入预算时，该 AI 步骤失败并显示缺口，确定性步骤继续执行。

离线接口只接受静态字符串响应替身，没有 URL、模型密钥、联网客户端、工具执行或真实服务切换开关。每次尝试限制上下文 96 KiB、输出 32 KiB、256 个文本定位、32 条意见、一次调用、一个并发、1 秒等待、总计 128 KiB 预留字节预算，真实费用额度和调用数恒为零。替身测试可收紧限额，不能放宽。worker 沿用每个数据库的单实例、租约、取消和重领门槛；AI 超时、格式或引用错误不自动重试，进程中断沿用既有恢复策略。独立 AI 线程不继承环境变量，取消后终止。

输出 JSON 必须包含 `schema_version`、`checked_ids`、`opinions`。意见包含规则、主体、concern/no_concern、文本和引用；每个引用绑定 input_key、固定 ref_id、content_digest、evidence_id 与逐字摘录。格式、对象归属、版本、位置、摘录、重复或同规则同主体的相反意见任一不合格时整批拒绝。通过校验只表示引用和结构有效，不证明推理正确；可接受的 concern 仍为“离线替身意见，待核实”，只能经过原有人工核对流程进入原问题实体。输出通过 React 文本节点呈现，不执行 HTML、链接或材料指令。

显式迁移 `2026-09-18-analysis-ai-offline-v1` 仅新增 `data_map_analysis_ai_outputs`，按尝试保存模型/提示词元数据、固定上下文摘要、限额、预留用量、实际收到的原始输出及 SHA-256、校验结果和完整性摘要。完成事务在固定来源上重新校验输出与发现一致性；取消、租约失效或事务失败不留下单独审计。未收到输出时保留 null 和失败原因，不能伪造实际输出。默认页面/导出不披露原始模型输出。旧表、记录、接口字段和审批权不变，无启动 DDL、回填、自动合并或旧数据转换；历史无 AI 的分析不依赖新表。

迁移先备份，再使用 `npm.cmd run manage:analysis-ai -- --target HOST:PORT/DATABASE` 检查；默认 dry-run，只有明确 `--apply` 才写入。正式实例执行须另获授权。回退先停止本版 worker 并处理未完成的离线运行，保留新表及历史记录，禁止由旧 worker 接管不识别的适配器。真实模型、外发范围、服务位置和费用授权属于 P20，当前没有开启。验证命令见 scripts/README；人工体验及业务验收不由隔离验证代替。


### 格式准入、旧规则和对照

当前`v7-deterministic-v4`支持原生V8及受支持V7，旧v3保留相同格式下原有八项检查。纯入口、运行存储、入队、worker与HTTP创建分别核对规则支持范围、来源正文及摘要。旧v1/v2只按V7继续受限读取和恢复；错误的V8历史结果不重写，不据此认定业务缺陷。`DEFINITION_ANALYSIS_SOURCE_FORMAT_UNSUPPORTED`表示该规则不支持实际格式，`SOURCE_FORMAT_METADATA_MISMATCH`表示格式元数据与正文矛盾；失败或未覆盖均不表示业务问题已整改。

跨规则等价映射仅用于相同原生V7及明确支持的规则对。格式、解析器或未映射规则发生变化时标为不可比较；新增版本元数据不单独视为证据变化。来源API及导出可提供实际格式及历史限制的只读投影，页面按能力和可见范围选择，不能从`v7_source`名称判断正文版本。

创建响应丢失、超时或5xx时保留原请求及输入；用户明确核对同一请求结果，不自动重放。格式支持不改变离线AI调用授权、办公室和工作包的责任范围，实际启用及验收另核对。旧批次的仅V7限制、失败场景及证据位置见文末历史快照。

### 对象身份与只读影响技术核对

新增本地合成验证入口test:object-identity-preview，产品行为未改变。定义ID、固定版、模板局部ID及流程data_ref／field_ref分别校验；同名不推等价，有序组合标识保存固定字段版及父版。GET /api/data-map-definitions/impact/:type/:id仍为停用计数和修订／count摘要，无逐条refs或合并／拆分／认定能力；设计交接／分析引用在本期证据单独核对，缺可选依赖保持未知。工作包／黄金源／表格发布仍原语义，不转换历史candidate或猜owner_user_id。

本轮15＋19组隔离技术通过，旧定义／映射／来源／manifest保持，当前来源变化需重新核对。专项用原分析运行存储仓储登记五输入，真实GET／SQL读回，公共创建接口仍拒绝未登记合成适配器；未启worker或运行规则。产品没有新身份决定／撤销、别名或认定模型。命令及副作用见scripts/README.md，原批次evidence/p25/object-identity-preview-20261006-01/有能力核对、精确refs、假设方案、决定前置和恢复材料。实际目标库／副本／开关／业务验收未核对，新快照不是完整部署包。


### 本地模型协议准备

当前产品仍仅offline替身，无真实模型适配器、服务URL／凭据或自动探测／启用。新增原批次证据目录中的自有回环HTTP协议假设及验证，复用固定V7／context／输出校验／trace／原队列与人工问题入口；不接入产品运行路径，不改变旧数据／DTO／schema／权限或审批。合法模拟意见继续待核实、partial，ai.live_evaluation未覆盖；引用正确不证明推理正确。

协议26组、原完成事务8组、真实子进程worker恢复13组本轮通过，实际模型0。模型无治理写入、DB、账号或工具执行权；材料指令为数据。DGX Spark实际API／网络位置／服务及模型版本／获准材料与身份／预算和停止条件待明确，详见原批次evidence/p25/local-model-protocol-20261006-01/protocol-preparation.md及connection-prerequisites.md。实际目标、副本／开关／worker及业务验收未核对；新快照不是部署包。验证命令及副作用见scripts/README。



## 历史记录

阶段结果、曾用配置及未沿用方案见[整理前应用说明](../../../docs/archives/2026-10-09-leaf-docs/apps/mdm-platform/README.md.before.txt)。按所查问题读取，当前操作不需要先加载全部阶段记录。
