# MDM 平台

## 确定性 V7 材料检查（P11）

P11 将共享 V7 纯校验器接入独立分析 worker，规则集合及解析器版本固定为 `v7-deterministic-v1`，parser_key 为 `v7_deterministic`。规则目录、适用前提和不适用条件见 `server/v7AnalysisRules.js` 的 catalog；对应正常、缺陷及边界样本见 `scripts/test-v7-analysis-rules.js`。现有 Schema 仅作为技术兼容合同，不是业务真源。

调用既有 `createAnalysisRun` 时，inputs 仅接受 P07 `v7_source` 固定引用；每步只处理一个 input_key，可在一个运行中列出多步。check_scope 和步骤 check_ids 从下表启用编号中选择，parser_versions 固定为 `{ "v7_deterministic": "v7-deterministic-v1" }`，rule_version 使用同一版本，ai_metadata 必须为空。再通过 `enqueueAnalysis` 显式入队，由获准隔离环境中的 `analysis:worker` 执行。未知规则、解析器版本、非 V7 输入、AI 及禁用规则均拒绝入队；没有新建分析 HTTP 接口或界面。

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
| v7.unreachable（禁用） | 当前 V7 没有明确入口及开始/结束语义，不能从入度、顺序或名称推断可达性 |

worker 在令牌事务内重新读取固定来源、有效身份、范围及摘要，只把本步骤的材料交给独立计算线程。计算线程不接收数据库或治理接口；终止线程不会阻塞心跳。运行时记录 worker、规则、共享校验器及 Schema 的源码摘要。证据定位回原固定 JSON，语义身份采用局部稳定标识及属性，不采用数组下标、标题或 finding_id。相同输入重跑保存独立实例及历史，对照键与结果摘要保持一致；顺序变化不会单独改变发现身份。缺标识时仅以材料内容摘要定位技术缺陷，不据此认定跨版本业务身份。

结构不合法时后续共享引用检查保留为未覆盖；共享校验失败时图规则保留为未覆盖。解析失败采用明确的 declared_anchor，不伪造可解析位置。结果超出既有 256 条证据/发现或请求容量时明确失败 `RESULT_LIMIT_EXCEEDED`，不截断后宣称完成。每个发现仍为 pending_verification、issue_id=NULL；succeeded 只表示计划检查已执行，不表示材料无问题或业务已验收。

验证入口为 `npm.cmd run test:v7-analysis-rules`（纯合成规则测试）和 `npm.cmd run test:v7-analysis-worker -- --output <仓库artifacts内全新目录>`（自有 MySQL、随机端口夹具及真实子进程）。P11 不增加表、迁移或回填，不改写 V7、台账、审批、问题和待办；P10 替身队列继续兼容。回退到仅支持 P10 的 worker 前须先停止 P11 worker 并处理相应运行，不能让旧进程办理 P11 队列。正式运行及业务验收尚未开启。

## 独立分析工作进程（P10）

P10 在 P09 上增加 MySQL 持久化队列和独立 Node 工作进程。运行必须由具备既有 `governance:structure-gate` 权限的当前身份显式调用 `enqueueAnalysis` 入队；仅接受尚无尝试的 queued 运行。已有运行不自动入队，不回填或转换原记录。P10 的 `p10-stub-v1` 替身适配器继续保留，明确测试成功、暂时失败、输入无效、挂起和部分覆盖；替身结果不代表业务规则分析。P11 新增的真实材料检查见上一节。没有分析 HTTP 接口、正式工作进程、AI 外发、问题分派或问题关闭。

队列保存原提交人的 person/account/auth_version、固定运行引用、策略及事件。入队、领取和步骤写入继续核对有效身份、权限、各项来源范围和摘要；管理员保持治理只读。工作进程仅办理分析队列，P10 适配器接收步骤元数据，P11 另接收已复核的固定材料；均不接收数据库或正式治理接口。自动中断记录沿用原提交人作为代办身份，并用 queue_events 的 worker_id、generation、event_type 和 UTC 时间标明系统执行，不表示该人员作出业务决定。

领取使用事务锁和 `SKIP LOCKED`；每次生成随机令牌，数据库仅保存摘要。心跳只能延长有效租约，不能越过当前步骤的硬超时。开始、完成、恢复和取消均受事务保护；旧令牌、过期租约或已取消运行拒绝迟到写入。已入队运行不能通过 P09 begin/complete/非取消 finish 入口绕过令牌。成功步骤保持不变，重试追加尝试；默认最多 3 次，只有暂时故障、超时或进程中断可以重试。无效输入不重试，partial 保留明确缺口，运行按实际覆盖结束为 succeeded、partial 或 failed，不能据缺口认为旧问题消失。

在应用目录使用以下命令。所有命令要求显式 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`，并核对 `--target`；不得将 Secret 放入命令、日志或说明。命令不加载 `.env`。本地测试必须使用自有隔离 MySQL，正式实例仍需另行授权。

| 动作 | 命令与结果 |
|---|---|
| 检查迁移 | `npm.cmd run migrate:analysis-queue -- --target <host:port/database>`；默认 dry-run；也可显式 `--inspect` |
| 执行获准迁移 | `npm.cmd run migrate:analysis-queue -- --apply --target <host:port/database>` |
| 启动 | `npm.cmd run analysis:worker -- start --target <host:port/database>`；前台独立进程，输出本次 worker_id，默认单 worker，重复启动返回 ANALYSIS_WORKER_BUSY |
| 状态 | `npm.cmd run analysis:worker -- status --target <host:port/database>`；输出队列状态计数和最近 worker 心跳，不输出身份、输入正文或令牌 |
| 停止 | `npm.cmd run analysis:worker -- stop --worker-id <启动时的UUID> --target <host:port/database>`；仅请求该实例停止；根据 stopped_at 和进程退出确认完成 |
| 中断恢复 | `npm.cmd run analysis:worker -- recover --target <host:port/database>`；只回收已过期租约，保留成功步骤和所有尝试；重新 start 后继续。正常 worker 也自动回收，不抢占有效租约 |
| 隔离验证 | `npm.cmd run test:analysis-worker -- --output <仓库artifacts内全新目录>` |

迁移键 `2026-09-17-analysis-queue-v1`，只增加 `data_map_analysis_queue`、`data_map_analysis_queue_events`、`data_map_analysis_workers` 三表；worker 启动只检查结构，绝不执行 DDL。中断迁移先 inspect 再 apply 续建。仅本次创建且逐表确认为空时可按 events、queue、workers 顺序补偿；已有数据时保留表，按获准备份恢复。旧 P09 未入队运行继续兼容原入口；已入队运行必须先停止 worker、核对活动租约和恢复条件，不应切回不识别令牌门槛的旧执行器。

默认租约 15 秒、步骤超时 120 秒、重试间隔 1 秒；策略在入队时固定。停止正在执行的替身会将当前尝试记为 WORKER_STOPPED，允许在剩余次数内恢复；硬中断由租约过期恢复。status 中历史 worker 的 stopped_at 为空不一定仍存活，应结合 heartbeat_at 判断。事件和日志不记录令牌、SQL、材料正文或错误堆栈。部署凭据的最小数据库授权、正式实例启动和人工业务验收不属于本步本地实现。

## 分析运行与证据存储（P09）

P09 提供 MySQL 持久化基础，入口为定义仓储的 `createAnalysisRun`、`getAnalysisRun`、`beginAnalysisAttempt`、`completeAnalysisAttempt`、`finishAnalysisRun`。P09 本身不提供调度；P10 工作进程及已入队运行的令牌门槛见上一节。分析 HTTP 接口和页面尚未接入。

运行固定输入引用、来源阶段、台账/映射/设计关系版本、检查范围、步骤输入及检查项、解析器和规则版本。输入支持 `v7_source`、`definition`、`mapping`、`handoff`、`template`，分别引用 P07 来源、P02 定义版本、P07 映射修订、P08 设计关系修订和 P02 模板批次。V7 正文仍由原固定来源保存，分析表仅保存引用和摘要元数据。原始字节摘要与内容摘要分别登记算法；模板单元格摘要使用 `sha256-template-cells-v1`，不冒充原件字节摘要。

`queued/running/succeeded/partial/failed/cancelled` 是运行状态。计划步骤独立保存状态，每次尝试追加记录，保存已检查与未覆盖的检查项、错误码、操作者、开始及结束 UTC 时间。失败或部分完成后的重试保留旧尝试及发现；已成功步骤不能由重试覆盖。仅所有计划步骤成功时可结束为 `succeeded`；部分结果和未运行步骤仍明确可见。终态运行拒绝迟到写入；取消会结束仍在运行的尝试，保留此前结果。

请求复用 P02 的人员、动作、UUID 和请求摘要幂等回执。同键同请求返回原结果，同键异请求返回冲突；新的 UUID 创建新的运行。主动重跑另带已结束的 `rerun_of_run_id`，输入仍须明确提供并重新核对；步骤重试只在同一未结束运行内增加 `attempt_no`。运行锁、`expected_revision`、回执与结果同事务提交，失败全部回滚。

证据必须引用本运行及本步骤的固定输入，并给出 JSON Pointer 或文档锚点。JSON Pointer 实际检查能否定位；文档锚点标为 `declared_anchor`，只证明保存了声明，不证明原文已经核验。发现另存规则、主体输入引用、语义定位和对照算法版本；标题和数组下标不承担对照身份。每个运行/尝试有自己的发现实例，初始均为 `pending_verification`（待核实），`issue_id` 强制为空。缺少证据的发现可保存待核实，不能转为正式问题或关闭旧问题。P16 如接入既有问题库，须另外补齐有权确认和本字段约束的兼容迁移。

仓储写入复用 `governance:structure-gate`，每次重新核对当前身份、管理员只读边界以及所有引用的读取范围。读取同样核对固定摘要及来源范围，依赖关闭或内容变化时返回明确错误，不把结果缺失解释为问题消失。`DEFINITION_ANALYSIS_*` 表示输入、覆盖范围、并发、状态、完整性及迁移错误，保留 P02/P07 的身份和引用错误。AI 只预留 provider、model、model_version、prompt_version、prompt_sha256、adapter_version，可为空；本步无模型调用或正式结论写入。

迁移键 `2026-09-17-analysis-runs-v1`，增加八张 `data_map_analysis_*` 表，依赖 P02/P07/P08。`npm.cmd run migrate:analysis-runs -- --target <host:port/database>` 默认只读 dry-run；支持互斥 `--inspect`、`--dry-run`、`--apply`，要求明确且匹配的 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`，不读 `.env`、不在启动时执行 DDL。无历史回填，不改原台账、V7、设计关系、正式问题、工作包或待办。

正式执行前须另获授权并备份。MySQL DDL 中断后先 inspect，再续建缺失表；只可对本次创建且逐表确认为空的增量表按 `finding_evidence → finding_inputs → findings → evidence → attempts → steps → inputs → runs` 逆序补偿。已有记录时保留表，使用获准的完整备份恢复；旧代码回退可保留增量表。本步可复验入口和副作用见 [scripts/README.md](scripts/README.md#p09-分析运行与证据存储)。交付口径为本地实现和合成数据隔离验证，正式实例未迁移、未开启，业务尚未验收。

## 设计交接关系（P08）

`/app/design-handoffs` 用于维护相邻流程之间的一条设计交接。先在 P07 登记固定来源并明确对象、字段映射，再选择来源和目标流程行为，标明对象在各位置的产生、使用、修改、交付或接收用途。页面复用既有名称、人员角色描述和版本，不根据同名对象、行为顺序或部门名称自动连接或指派。对象和字段详情中的“查看设计交接及修订影响”可定位当前及历史修订引用。

每条关系保存两端固定来源、流程与行为引用、对象和字段版本、映射修订、单字段或组合标识的有序对应、交付条件、接收要求、两端证据位置，以及字段含义、格式、枚举、单位和版本的核对说明。每个维度明确选择待核实、无需转换或需要转换，并保留依据；需要转换时还须记录转换规则。这里只保存规则，不执行转换或系统同步。

`material_declared` 展示“材料声明”，`analysis_pending` 展示“分析待定”，`human_confirmed` 展示“人工确认”。前两种状态可保留缺一端来源、缺字段、未确认映射或缺转换依据的关系；至少有一端明确对象映射和行为。人工确认要求全部待核实项解决，包括目标必填字段、目标未映射字段、标识对应及两端来源有效性。此确认仅核对设计关系，不认定主数据、审核流程或证明实际接收。人员和时间由服务端记录，不接受上传内容冒充确认人。

关系修订只追加版本和引用记录。台账字段修订、对象映射修订或来源变化不会改写旧关系；读取时重新计算待核实项，保留原确认记录并停止把旧关系展示为当前有效确认。部门或权限变化后重新校验两端及所有字段，列表省略无权关系，不显示其标题和数量；依赖暂不可用时显示部分结果，不能视为不存在关系。

API 前缀 `/api/design-handoffs`：GET `capabilities`、`sources/:id`（选项上下文）、根清单、`:id`、`:id?version=<固定关系版本>`、`:id/history`；POST 根路径保存设计关系。清单可按 `entity_type=object|field&entity_id=<稳定ID>` 查询修订影响，`after` 数值分页每页50条，历史使用 `before` 每页50条。写入参数为 `request_id`、`handoff_id`（新建为NULL）、`expected_revision`（新建为0）和 `definition`。内部引用以固定 `mapping_version_id` 为准，稳定ID、名称和来源摘要由服务端反查。字段对应最多32组，证据最多32项；未声明属性拒绝。

写入复用 `governance:structure-gate`、当前有效身份及两端台账/来源范围；管理员多角色仍只读。不增加角色、办公室关系或正式审批权限。修订、幂等回执及引用同事务写入，409不自动采用新版本或重放。`DEFINITION_HANDOFF_*` 表示输入、映射、未核实、版本完整性及迁移错误；保留 P02/P07 错误，400/401/403/404/409/503含义沿用既有合同，不暴露SQL或受限正文。页面只在内存保留输入，重新登录后复核两端范围，失败、取消离开和旧响应不会静默覆盖可见输入。

迁移键 `2026-09-17-design-handoffs-v1`，新增 `data_map_design_handoffs`、`data_map_design_handoff_versions`、`data_map_design_handoff_refs`，依赖 P07。无启动DDL、旧数据回填或自动生成关系，不改旧V7、工作包、问题或待办状态。`npm.cmd run migrate:design-handoffs -- --target <host:port/database>` 默认 dry-run，支持互斥的 `--inspect`、`--dry-run`、`--apply`，要求明确目标环境变量，不加载 `.env`。正式执行须另获授权并备份；DDL中断先inspect再续建，仅本次新增且确认空表可按 refs、versions、handoffs 逆序补偿；有历史时保留增量表，采用获准备份恢复，不能清空重建。回退旧代码可以保留三表。

可复验入口见 [scripts/README.md](scripts/README.md#p08-设计交接关系)。交付仅为本地实现及合成数据隔离技术验证，正式环境未迁移、未开启，真实业务交接和人工体验尚未验收。

## 固定 V7 来源与台账映射（P07）

新入口 `/app/v7-mappings` 用于登记固定来源、核对来源证据，并把 V7 局部对象和字段明确关联到 P05 台账固定版本。支持 `uploaded_material`（独立材料批次，版本1）、`preview_revision`（案例及修订 ID）和 `published_version`（包括被替代但曾发布的原生 V7 版本）。各类标识互斥；预览和材料的正式版本 ID 为空。引用预览、正式版本分别受既有功能开关及当前部门范围约束；登记不执行预览提升、正式发布或工作包创建。

MDM 具备 `governance:structure-gate` 的人员可登记及核对映射，仓储重新验证有效身份、权限和来源/台账范围。管理员兼有其他角色仍只读。独立材料的访问范围固定为登记人的当前部门，仅是访问控制范围，不据此认定材料的业务归口。现有预览和发布来源按其归口部门或全局读取权限访问；本模块不扩大参与部门的既有最小上下文权限。

使用时先登记来源，检查校验结果，选择一个局部对象或字段，再填写并读取台账版本 ID。页面展示精确名称、稳定 ID 和固定版本供人工核对；可从 P05 的版本历史取得版本 ID。`candidate` 展示为“映射建议待核实”，`confirmed` 仅表示人工已核对对应关系，均不授予主数据认定或流程发布状态。字段须绑定同一个固定对象版本，并引用该局部对象的映射修订；确认字段前须先确认对象映射。父映射改变后，字段原记录保留并显示需重新核对。未映射项保持待核实，同名、改名或数组顺序均不触发自动匹配。

API 前缀 `/api/v7-mappings`：GET `capabilities`、`sources`、`sources/:id`、`sources/:id/evidence?object=<ref>&field=<ref>`、`sources/:id/mappings/:mappingId/history`；POST `uploads`（multipart 文件和请求 UUID）、`sources`（固定引用）、`sources/:id/mappings`（局部引用、对象/字段固定版本、状态、依据、来源摘要及 `expected_revision`，首次为0）。对象/字段稳定 ID 从版本反查，不能由客户端伪造。请求 UUID 绑定人员、动作、完整内容；同请求重试不产生新修订，内容不一致返回409。清单每页100条、历史每页50条；单个来源最多1000个对象与字段，原始上传上限4 MiB。

原始上传字节仅在内存参与解析和 `sha256-raw-bytes` 摘要；不保存原文件副本。系统另保存解析内容快照及 `sha256-v7-stable-json-v1` 摘要，算法沿用 V7 稳定键序列化，数组顺序会影响完整内容摘要。已有预览/正式版本没有上传字节时，原始字节摘要明确为不可用。无效 UTF-8/JSON 记录 `parse_failed`，无效 V7 记录 `validation_failed`；两者没有可映射节点。共享纯校验器及有效部门卡口在确认时重算；`ACTOR_DEPARTMENT_UNRESOLVED` 不可由人工映射解除。来源摘要或父映射变化会阻止沿用确认，不改写原 V7、审核记录或台账历史版本。

迁移新增 `data_map_v7_sources`、`data_map_v7_mappings`、`data_map_v7_mapping_versions`，无旧记录回填或状态转换。映射头、不可变修订、幂等回执同事务提交；P05 停用影响在新表存在时统计历史映射版本。`npm.cmd run migrate:v7-mappings -- --target <host:port/database>` 默认 dry-run，支持显式 `--inspect`、`--dry-run` 或 `--apply`，要求 P02 已迁移及准确目标环境变量，不读取 `.env`，应用启动不做 DDL。正式执行须另获授权并备份。DDL 中断后先 inspect 再续建；只有本次确认新增、为空且无引用的表才可人工按引用逆序补偿，有历史数据时保留并通过获准备份恢复。回退旧代码可保留增量表，不清空历史。

错误码以 `DEFINITION_V7_*` 标识解析、固定引用、映射状态、父映射、来源摘要、修订、完整性及迁移问题；保留既有 `DEFINITION_*` 身份、台账和幂等错误。400 输入不合法，401 身份失效，403 无权，404 来源/定位不存在，409 版本、来源或状态冲突，413 超限，503 迁移、既有功能开关或依赖不可用。响应不返回 SQL、堆栈或受限材料。输入仅在页面内存保存；失败、取消切换及重新登录保留原输入和提交时版本，恢复身份后重新核对访问范围，409 不自动更新或重放。

验证入口及输出见 [scripts/README.md](scripts/README.md#p07-固定-v7-来源与映射)。当前交付口径是本地实现和隔离验证，正式服务未开启，人工体验与业务验收另行确认。

## 台账事实核对（P06）

本地新入口 `/app/fact-checks` 承接对象、字段的定向事实问题。MDM 从对象或字段详情选择需要核对的内容，保存草稿、明确部门及可选人员后发出；目标部门具备编制权限的人员答复具体事实并提供文件、页码、表格或单元格等证据定位。缺少证据时须明确说明，MDM 可要求补充。台账修订继续使用 P05 的本部门编制权限，MDM 的结构核对权限不授予代写部门材料的能力。

答复、重新核对及核对结论绑定对象和字段固定版本、内容摘要、选定范围、人员、时间、理由与证据。页面可定位台账并返回同一办理位置。相关内容变化后旧意见保留，但不能直接核对完成；MDM 明确查看新旧内容并重新发起后，业务人员须针对新内容再次答复。没有涉及选定范围的修改和枚举允许值重排不使意见自动失效；组合标识顺序不在本步可核对字段范围内。

`checked` 只表示指定事实核对完成。当前来源、建议权威来源继续分别保存在定义中，核对依据保存在办理历史；新对象、字段正式认定的有权主体及审批依据仍待确认，最终治理结论保持空值。接口拒绝正式认定、关闭正式问题和发布动作，不信任上传材料中的审核状态。不新增正式问题库、办公室分配或通知，也不建立流程工作包。

API 前缀为 `/api/data-map-facts`：GET `capabilities`、`targets`、根清单、`:id`；POST 根创建草稿、`:id/edit|send|answer|more_info|rebind|check`。创建需要 `subject_version_id`、`object_version_id`、白名单 `focus[]`、具体 `question`、目标部门及可空人员、请求 UUID；后续写入另需 `expected_revision`。发起和核对复用 `governance:structure-gate` 与来源范围；答复复用 `governance:draft-department`，核对当前目标部门及指定人员。admin 即使兼有这些权限仍只读。无权读取返回 404，跨部门收件人仅得到明确发出的固定内容，不得到整对象、原模板或未发出的草稿历史。

新增 `data_map_fact_requests` 和 `data_map_fact_events` 两张表，保留 P02 对象、字段、定义版本、来源、ID及审查记录。请求当前状态和追加历史在同一事务写入，核对完成时同事务追加原 `data_map_definition_events.fact_checked`；并发、幂等及失败回滚复用现有仓储约束。清单及组织选择每页100条，历史每页50条，返回续读位置。没有旧记录回填或审批状态转换；P05 停用影响统计在新表存在时增加定向事实请求数量，无新迁移时原管理能力仍可用。

迁移入口为 `npm.cmd run migrate:data-map-facts -- --target <host:port/database>`，默认只做 dry-run；可显式加 `--inspect` 或 `--apply`。要求显式提供既有 MySQL 环境变量及完全匹配的目标，且 P02 迁移已完成；不加载私有 `.env`，应用启动不执行 DDL。正式实例仍须另获授权并先备份。MySQL DDL 失败后先 inspect 再续建，不能假设整体回滚；仅对本次确认新增且为空、无后续引用的表考虑人工补偿，已有记录须保留并通过获准备份恢复。旧代码回退可保留新表，不删除历史。

新增错误以 `DEFINITION_FACT_*` 区分目标缺失/无效、核对范围或证据缺失、状态/修订/来源/完整性冲突以及迁移缺失。400 表示输入问题，401 身份失效，403 无写权限或正式动作未开启，404 无可披露请求，409 并发、来源或状态冲突，503 迁移或依赖不可用；不返回 SQL、堆栈或受限原文。表单只在页面内存保留，失败或取消离开保留输入；重新登录后先核对身份和事项访问权限，409 不自动采用新修订或重放写入。

验证命令为 `npm.cmd run test:data-map-facts -- --output <仓库artifacts内新目录>`，前置及证据说明见 [scripts/README.md](scripts/README.md)。这属于本地实现和隔离验证，不表示正式环境已开启或业务已验收。

## V7精简后的工作入口

- **我的工作**：个人待办与办公室工作台。个人待办只汇总当前办公室分配、V7核对与正式流转、数据治理工作包及定向事实问题。
- **流程治理**：上传3001下载的未审核V7，核对、退回修订、提升、审核与发布。
- **数据治理**：按已发布V7版本建立和办理数据生命周期工作包。
- **成果查阅**：数据地图及主数据发布记录。组织、花名册、角色、术语、质量与账号入口收在“管理与辅助”。

个人工作台直接读取办公室原有任务记录；待分配任务只进入当前办公室负责人的待办，已分配任务只进入当前有效办理人的待办，办结后在下次读取时移除。办公室入口按链接中的办公室标识定位，管理员仍只读。旧快照问题、输入基线复核、映射待办和PMO历史卡口不再作为个人待办来源，历史记录继续保留。

正式流程仓储仅保留V7读取、提交、审核和发布，保留事务锁、权限复核、修订号和摘要绑定。旧版编制、转换、投影和承接方法已经移除；旧问题池转发承接操作返回410。共享历史结构维护函数仅供既有显式初始化或迁移工具使用，不由业务请求运行。

验证入口：`test:retired-capabilities`、`test:process-v7-preview-review`、`test:process-v7-procedure`、`test:role-workbench`、`test:role-workbench-mysql`、`test:offices`、`test:stage05-mysql-isolated`、`node scripts/test-stage05-browser.js`。隔离测试使用合成身份和临时MySQL，不能作为业务验收。

## 2026-09-15旧功能退役

已删除3000的V1至V3编制器、旧版导入和承接办理接口，以及SQLite时代的系统、能力、流程、地图视图、组织岗位、产品分类、属性、外部系统和集成路由。旧接口不再注册；共用的草稿读取、提交、审核和发布接口只接受V7，旧草稿返回`410 LEGACY_PROCESS_RETIRED`。历史数据库、标识、审核记录及共享迁移结构保留，不清空、不猜测转换。

当前主线为3001编制V7，用户主动下载上传，3000核对、审核、发布，再下载程序文件。3001自身的历史JSON导入升级能力不在本次3000退役范围。

2026-09-15已通过既有运维入口切换3000；首页、健康、就绪、运行摘要及代表性旧接口已复核。本次没有执行正式数据库结构或历史业务数据变更。旧发布包、备份及私有配置保持原位；历史说明中相反的旧编制和SQLite可运行描述不再适用。

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

`apps/mdm-platform/` 只负责 MDM 平台应用本身：Express 路由、MySQL 目标 schema、新旧前端、应用内脚本和平台使用说明。

不在本目录维护流程输入基线、PMO 驾驶舱或仓库级数据转换脚本：

- 业务依据：用户指定的外部原始材料、实际业务说明及明确确认；`docs/`中的历史副本不作为治理真源。
- 组织与花名册：用户手工导入，由3000保留发布版本；当前目录不因已经存在于数据库而自动成为正式发布结论。
- PMO 展示：`pmo/procedure-management/dashboard.html`
- 仓库级脚本：根目录 `scripts/`

开发 MDM 代码前先读 [AGENTS.md](AGENTS.md)。执行、调整或新增应用内脚本前先读 [scripts/README.md](scripts/README.md)。

## 当前身份与权限模型

### 手工导入与发布

分组侧栏提供组织架构、花名册、流程治理、数据治理、数据地图和主数据发布入口。治理活跃保留在工作台首屏；桑基图保留在“全量职责”；角色与责任、冲突管理继续使用原有接口和数据范围。

组织架构和花名册页面的“手工导入”，以及“主数据发布”中的三个导入入口，均接受.xlsx或UTF-8编码.csv。用户先选择文件和工作表，确认列对应关系，再查看原始内容、逐行变更和问题提示，最后明确确认发布。单次限制为5MB、5000行、64列。模板为空白Excel，文件中的额外列和值保留在发布快照中；公式须先转换为明确的值。

组织架构按组织编码更新部门和办公室，花名册按工号更新，沿用已有组织和人员标识。文件中未出现的目录记录继续保留。上级部门缺失、层级循环、部门无法匹配、同一标识重复或账号与在职状态冲突时，先修正再发布。导入不创建账号，不更改密码或MDM角色；管理员身份不能通过业务花名册改写。

组织表的“组织层级”填写“部门”或“办公室”。办公室行填写“归口部门编码”，通过“办公室负责人工号”明确负责人；负责人须为已导入的有效在职人员。首次建立目录时，可先导入部门、花名册，再导入带负责人的办公室。旧组织文件没有“组织层级”列时继续按部门处理。办公室复用`org_unit`，历史办公室保留原编号和上级关系；没有明确部门关系的历史记录显示“归口部门待明确”，不能承接新任务。

花名册的“办公室编码”可用分号分隔多个编码，例如`OFFICE_A;OFFICE_B`。人员所属部门与办公室成员关系分别保留，允许人员同时属于多个办公室。未对应办公室列时保留已有归属；明确对应该列后，空值表示移除该人员全部办公室归属，核对明细会显示变化。办公室成员关系不授予正式流程审核或发布权限。

“办公室工作台”对已登录人员提供入口，服务端按办公室负责人、成员关系或已有全局读取权限返回内容。具备`governance:assign-work`的人员将任务交办到有效办公室；只有该办公室负责人可以向当前有效成员分配或重新分配，只有当前办理人可以填写结果并办结。负责人无需另加MDM角色即可分配本办公室任务。管理员仍为只读。任务可关联已发布V7流程版本和具体业务行为，流程归口部门继续取自固定正式版本。办公室分配和办结不替代正式流程核对、审核及发布状态。

办公室任务复用`mdm_todos`，`mdm_todo_office_assignments`保存承接办公室、办理人、固定来源、请求标识及修订号，`office_membership`保存多办公室成员关系。分派、人员调整、办结与事件在同一事务保存；重复交办请求和过期修订返回409。旧部门待办保持未指定办公室状态，由治理分派人员明确选择原接收部门下的办公室；承接后，旧待办完成和删除接口拒绝处理。存在未办结任务时，不允许移除当前办理人的对应成员关系或改变办公室归口部门；办公室有有效成员或未办结任务时不能停用。

办公室结构使用`npm run migrate:offices:inspect -- --target host:port/database`检查，再用`migrate:offices:apply`增量准备。命令要求显式MySQL环境变量，只增加可空的`org_unit.department_id`、两个关系表及迁移记录，不推断或回填历史归属。执行前保存目标库备份并核对DDL；同名异构表拒绝执行，重复执行不改写数据。回退时保留新增关系和任务数据，使用含办公室旧入口保护的应用版本；已经使用办公室任务后，不能直接回到缺少该保护的旧版本，否则会恢复旧的部门办理权限。需要完全恢复时，在维护窗口按已核对备份恢复目标库及对应应用，不自动删除新增表。

主数据发布不限定对象类型，由用户选择唯一标识列。新数据集首次发布后，可以从发布记录“导入新版”；同一数据集沿用唯一标识列，每个版本保留完整内容。核对结果显示新版移除的记录数，历史版本仍可逐版查看、下载Excel或JSON。重复提交使用同一请求标识返回原发布记录；核对后内容或目标目录变化时返回409，要求重新核对。

发布沿用`governance:publish`及现有管理员只读边界。管理员可选择文件和核对内容；实际发布在事务中再次检查当前账号和权限，并记录发布人、时间、内容摘要和变更日志。既有流程审核和审批链路不变。

增量准备命令为`npm run migrate:publications:inspect -- --target host:port/database`和`npm run migrate:publications:apply -- --target host:port/database`，使用显式MySQL环境变量。apply只增加`mdm_publications`及迁移记录，不迁移或清空历史业务数据。已有同名表结构不一致时停止。应用回退时可保留该新增表和已发布记录，旧程序不读取它；不自动删除发布历史。验证入口`npm run test:publications`仅创建本轮隔离MySQL容器和合成数据，覆盖文件保真、目录更新、原子回滚、版本、并发、重复提交、权限和下载。

流程治理的V7修订详情与正式版本区域，以及数据地图顶部，提供流程图和数据关系图。图形复用仓库内3001的纯绘图组件，由3000本地路径提供资源，不访问3001服务或共享数据库。绘图内容来自3000预览记录或通过摘要核对的原生V7版本，页面标注来源状态，支持节点说明、缩放和平移、PNG下载。预览图不代表正式发布或数据治理结论。

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
- 分组侧栏保留“流程治理”，并提供“数据治理”直达入口。流程治理保留“流程编制、跨部门承接待办、承接冲突待办、V7预览核对”；数据治理页面展示实际启用状态，并提供已发布V7流程版本的选择入口。
- “流程编制”直接显示MDM本地工作台，包含文字编制、条目侧栏、稳定排序、结构评分和跨职能流程图。该路径使用v3结构规则，不通过浏览器调用3001服务。
- 部门主对接人可以新建、导入、保存草稿和提交审核；管理员只能打开已有草稿查看。导出备份不替代保存草稿。
- MDM兼容`process-governance-v1`、`process-governance-v2`和`process-governance-v3`，服务端统一规范化、保存和导出为v3；3001源文件不被修改。v1、v2表单状态设为`unspecified`，不得按名称或明细数量推断。
- 用户可把3001导出的`process-governance-v7`文件上传到“V7预览核对”。3000保存案例、修订、双方部门核对结果和操作记录；预览阶段不转换为V3、不写正式草稿和版本，核对结果也不写回V7文件。预览和正式写入默认关闭，分别通过`PROCESS_V7_PREVIEW_ENABLED=1`、`PROCESS_V7_FORMAL_ENABLED=1`开启。按2026-09-15用户确认，开启后不再限制单一流程，旧`PROCESS_V7_TRIAL_PROCESS_REF`不再生效；权限、部门核对、修订绑定、正式审核及发布要求保持原样。同一案例只能修订同一`process_ref`，其他流程另建案例。已有案例、版本和历史审核记录保留，不需要改表或重建。运行状态以实时健康和内容检查为准；隔离MySQL验证不替代业务验收，真实流程仍由用户提供材料并按实际职责核对。
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
- 数据生命周期治理默认关闭，设置`PROCESS_DATA_GOVERNANCE_ENABLED=1`后，MDM工作组可在“数据治理”选择任一已发布的原生V7流程版本并点击“建立治理工作包”。当前版本和被后续版本替代的历史已发布版本均可选择；未发布、撤销及非V7版本不能建立工作包。重复选择同一版本返回原工作包，不复制记录。流程发布和迁移均不自动创建工作包。
- 旧`PROCESS_DATA_GOVERNANCE_TRIAL_PROCESS_VERSION_ID`配置不再生效；状态接口保留兼容字段`configured_process_version_id:null`，范围标识为`published_v7_versions`。已有工作包保持原`process_version_id`、来源摘要、稳定标识和审核记录，不需要重建或回填。每次办理复核固定来源内容及摘要，发现不一致时停止写入，不猜测修复。工作包不读取原始3001文件；固定规则只生成待核对内容，不调用AI、不自动确认。
- 仅查阅已完成成果时设置`PROCESS_DATA_GOVERNANCE_READ_ONLY=1`。业务部门仍只查看本部门定向事实；所有工作包写入均被拒绝。缺省或`0`保留办理模式，非法值拒绝访问及写入。此开关不改变V7预览或正式写入模式。迁移仍使用原六张表及检查入口，技术操作见[迁移与恢复说明](docs/Process-Data-Governance-Migration-Runbook.md)；该历史说明中的单版本试点限制已由本节用户确认的任一已发布版本规则替代。

- 已发布的原生V7版本可在预览案例的正式版本区域点击“下载程序文件（Markdown）”。下载入口 `/api/process-design/versions/:processVersionId/procedure-markdown` 按固定正式版本读取、复核内容摘要并沿用正式版本查看权限，生成目的、范围、术语、业务行为、流程关系、数据及生命周期、表单与记录。未填写内容保持“未填写”，待确认状态保持待确认，不改写草稿或正式记录。已被后续版本替代的历史版本可按其准确标识下载并显示历史状态；撤销版本拒绝下载。旧版草稿的 Markdown 导出保持原入口，不将旧数据转换成V7。`npm run test:process-v7-procedure` 验证内容保留，接口回归和 `test:stage05-browser` 验证权限及页面下载。
- V7案例、修订、核对意见和操作记录按数据库中记录的时间返回ISO时间，避免数据库与Node时区不同造成8小时偏差；新修订沿用核对意见时保留原决定时间，不改写历史记录。

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

- 前端：目标为独立 `frontend/` 内的 React + Vite（JavaScript）；现有 `public/index.html` 保留，逐模块迁移并验证后再切换。
- 后端：Express.js + MySQL（正式运行路径按 MySQL-only；遗留 SQLite 代码只作为测试隔离和待删除实现保留）
- 认证：bcryptjs + express-session
- 导入/导出：multer + exceljs

### 2026-09-16 前后端分离合同（P00）

P00冻结技术合同和维护边界；P01已实现独立前端及同源访问骨架，尚未迁移业务模块或部署。Express + MySQL 保留；前端负责交互和输入反馈，身份、权限、数据范围、版本、并发、审批及审计仍由后端独立执行。

依据当前 `pmo/gantt-react/package-lock.json`，锁定 React/React DOM `19.2.6`、Vite `8.0.14`、`@vitejs/plugin-react` `6.0.2`。P01 使用精确版本并生成独立 lockfile，不复用 PMO 配置、业务代码或5173服务，不附加 UI、全局状态或第二套图形框架。当前 Node `25.2.1`、npm `11.6.2` 满足锁文件所列 Node `^20.19.0 || >=22.12.0` 约束；构建验证属于P01，这不是生产运行时升级决定。

Express现按同源 `/app/` 提供 `frontend/dist/`；注册 `/app/`、`/app/workbench`、`/app/identity`、P04新增的 `/app/template-import` 和P05新增的 `/app/objects` 页面，未构建时返回503。旧入口与 `/api/` 保留原行为，共用现有会话、CSRF和身份 API；缺失资产、上传路径及未知页面返回404，不回退为前端首页。开发代理必须显式指定自有隔离后端，禁止默认指向正式3000。代码接入不代表正式服务已重启或开启新入口；迁移及切换由后续获准步骤执行。

旧页保留本地 `public/echarts.min.js` 和既有引用；新前端可复用同源 `/echarts.min.js`，不使用CDN。构建目录只含公开前端资产，不含业务材料、用户数据、密钥及服务端源码。前端构建纳入运行源码摘要；`dist/`和`node_modules/`被忽略，不提交生成物。

### 新前端构建与验证（P01）

从应用目录执行 `npm.cmd --prefix frontend ci --ignore-scripts --no-audit --no-fund` 安装独立锁文件依赖，执行 `npm.cmd run build:frontend` 写入 `frontend/dist/`。构建不启动服务、不连接数据库，也不读取 `.env`。服务器部署仍须另有授权，不因构建自动启动或切换3000。

`npm.cmd run test:frontend-shell` 验证请求/CSRF/错误处理、开发代理边界、构建公开文件清单和同源页面路由，使用临时回环HTTP服务，不连接数据库。真实隔离验证使用 `npm.cmd run test:frontend-shell-browser -- --output <artifacts内全新证据目录>`，条件和副作用见 [scripts/README.md](scripts/README.md)。

开发时先启动属于本轮的隔离后端，再在同一个PowerShell终端设置 `$env:MDM_ISOLATED_BACKEND` 为该实例返回的完整 `http://127.0.0.1:<端口>`，执行 `npm.cmd run dev:frontend`。Vite默认随机回环端口，也可用 `npm.cmd --prefix frontend run dev -- --port <已核对空闲端口>`；开发后端和前端都拒绝3000、3001、3306、3307、5173、63805。配置只代理现有API、根入口及本地标志/图形资源，不开启宽泛CORS、不默认使用正式后端；开发服务没有启动业务数据库的能力。原页面的完整体验以同源Express构建入口为验证口径。

新页面目前提供账号登录、当前身份、导航、加载/空/失败反馈及登录表单未提交输入保护。工作台按钮转到原有办理页面，不生成模拟待办，不改变既有权限/审批链。401重新登录，403核对权限，409重新核对，503显式重试；请求失败不自动重放写操作。账号要求修改密码时提示使用原入口。业务页面与其编辑保护须在所属后续步骤分别实现和验证。

本次合同、功能基线和验证记录位于仓库下被忽略的 `artifacts/mdm-3000-upgrade-20260916/p00-20260916-120151/contract.md`、`execution.md` 和 `evidence/`，仅作为实现记录，不是业务真源。跨任务接续须提供该批次执行记录，不能只凭步骤“已完成”推进。

### 对象、字段定义版本基础（P02）

P02已实现仓储和显式迁移；P04接入模板导入HTTP及页面，P05接入对象与字段管理。正式数据库操作未执行。入口是现有 `makeDataMapMysqlRepository(pool).definitions()`，不由应用启动执行DDL。对象和字段继续使用 `data_map_objects.id`、`data_map_fields.id`；新增key采用随机UUID，不按名称合并。旧ID、key、台账记录、身份记录及系统关系在迁移中保持原样。

增量结构由 `server/dataMapDefinitionSchema.js` 定义：不可变定义版本、当前指针、追加审查事件、来源文件元数据、单元格原值、模板编号映射和幂等请求，共七张表。版本含完整旧记录快照、独立内容摘要及快照摘要，字段绑定固定对象版本。单字段/组合标识引用同一对象固定版本下的字段版本；模板局部编号只在来源批次内有效。对象来源、字段来源、权威来源建议和治理结论分别保存。

仓储提供 `saveDefinition`、`getCurrent`、`getVersion`、`recordReview`、`registerSource`、`addSourceMapping`、`getSource`。所有入口复核有效会话与读取范围；写入同时校验既有动作权限和当前部门。管理员含多角色仍不得写入。草稿保存复用 `governance:draft-department`；审查仅复用 `governance:structure-gate` 记录 `fact_checked` 或 `needs_more_info`，要求固定版本、修订号和依据。尚未确认的新正式认定/审批动作一律拒绝；不调用旧身份确认接口，不创建工作包、问题或待办，不调用AI。

已有记录编辑必须传入 `expected_revision`，所有写入必须传入请求UUID。同操作者、动作和请求UUID的相同内容返回第一次结果；不同内容报 `DEFINITION_IDEMPOTENCY_CONFLICT`。版本与基础记录、当前指针、事件及请求结果在一个事务中写入；历史版本无修改/删除入口，读取时校验内容摘要。字段仅允许编辑draft，inactive/archived对象拒绝新编辑。源记录被旧路径改动时返回 `DEFINITION_LEGACY_SOURCE_CHANGED`，重复迁移只报告差异，不覆盖旧版本；需要后续明确核对、吸收变更，不能用重跑迁移绕过。

新增仓储的BIGINT为十进制字符串，时间为UTC ISO-8601；原接口类型保持兼容。必填性和枚举允许值以新定义中的 `required: boolean|null`、`enum_values: array|null` 表达；NULL表示未知，[]表示明确无项。可对应的名称、含义、类型、格式、长度和枚举同步原台账列；明确布尔必填性同步nullable。旧nullable不支持NULL，未知时保留兼容值，不能据此认定新定义已补齐。旧默认confidence/confirmed及无法解释的枚举原文只保存在原值快照，不转成确认事实。legacy版本的创建时间为实际捕获时间，创建人员为NULL，明确表示历史操作者未知；新手工版本与审查人员取当前有效身份。

来源登记保存原始字节SHA-256及长度；没有原始字节时标记 `unavailable`，不以重序列化内容替代。文件内容摘要和定义内容摘要分开。来源原值保持类型、工作表和单元格定位；公式文本/缓存只作为JSON保存。P02不解析文件、不执行公式、不保存原件文件副本；P03的只读解析说明见下文。来源仅登记时，旧导入批次标为partial，不能当作业务导入成功。

维护者应先获目标授权并准备可恢复备份，显式提供五个MySQL环境变量和完全匹配的 `--target host:port/database`，依次运行 `migrate:data-map-definitions:inspect`、`migrate:data-map-definitions:dry-run`；核对drift、missing、backfill、changed和unresolved后才执行apply。脚本不加载私有配置，没有默认目标；结构、约束、引擎或排序规则不兼容即拒绝。ready仅表示结构和首次捕获已就绪，changed/unresolved仍须逐项处理。缺对象归属或归口部门的旧记录保留并列清单，不创建通用对象或推断归属。

MySQL DDL分表提交，失败后保留已建表，重跑先核对结构再补齐；旧数据捕获及迁移标记在独立事务内完成。代码回退可停止使用definitions入口并保留所有增量表，旧读取继续工作。数据补偿仅能在核对本次新增表为空且无引用后，按反向依赖顺序处理；已有版本或来源数据时应保留或按获准备份恢复，不提供无条件清表入口。本次隔离测试分别验证了空表补偿、保留增量表的旧代码路径及整库备份恢复；正式实例仍须单独预检和恢复演练。命令和隔离条件见 [scripts/README.md](scripts/README.md)。

### 指定主数据模板只读解析（P03）

`server/masterDataTemplate.js` 使用现有ExcelJS解析 `INF-MDM-DAT-00001` 的“主数据清单”，返回对象、字段、原列、逐单元格来源和逐项问题。模板结构、允许选项和示例识别来自本次指定原件，记录在 `masterDataTemplateProfile.json`；该文件只定义解析规则，不提供业务归属或主数据认定。按表头定位区段，允许增行和列顺序变化；未知列、缺列和无法识别的表外记录保留原值并报错。原模板旧部门列表只提示核对，不限制当前有效组织。

解析结果固定 `preview_only=true`、`persisted=false`，来源批次及平台对象/版本ID均为NULL。源摘要使用原始上传字节SHA-256，原值、规范化值和单元格位置分开保存；日期保留原类型和ISO值，纯零占位数字格式保留前导零，无法无损解释的代码要求人工修正。富文本、超链接和Excel错误保留原始结构，超链接不访问。公式只保存文本、共享公式引用及缓存；业务必填公式没有有效缓存时报错，派生检查公式仅提示，任何缓存均不代替独立校验。

示例须匹配已核对的完整示例内容；修改过的示例作为待核对记录保留。局部编号和派生公式构成的预留行不计业务数量。字段只通过明确局部编号关联，重复编号、孤立字段、必填缺项、非法选项、标识冲突、待定事项缺少闭环信息和实例待脱敏均有错误定位。同名对象不合并；组合标识保留候选字段，但模板缺少组号及顺序，后续必须显式核对。模板“枚举”格式不提供该字段业务允许值，仍为NULL。明显联系方式或身份号码即使声称已脱敏，也要求人工复核；规则未检出不代表数据已安全。

命令 `npm.cmd run preview:master-data-template -- --input <原件.xlsx> --output <仓库artifacts内全新目录>` 只读原件，核对前后摘要后生成 `preview.json`、`preview.md` 和 `source-integrity.json`。JSON含本地核对所需原值，应按源材料权限保管；Markdown不展示字段实例值。输出父目录必须已存在，已有结果不覆盖。退出0表示得到无错误预览（也可能为空模板），退出2表示已生成含校验错误的预览，退出1表示文件或命令失败。预览成功不表示已导入或具备提交权限。

限制为5MB原文件、32MB实际解压内容、1000个ZIP条目、8个工作表、每表5000行/64列、全簿100000个非空单元格、每个原值JSON不超过16KB。超限拒绝而非截断。宏、外部工作簿链接、嵌入内容及XML实体声明拒绝；不执行宏、公式重算或外链读取。`TEMPLATE_*`错误码定位解析及校验问题，400为无效输入，413为超限。规则变化阻止通过校验；版本文字差异保留预览并提示核对，不按单一文件摘要拒绝全部新版材料。

P03解析器自身没有HTTP入口、台账写入或迁移；P04通过下述独立适配层接入。确认时重新用原始字节校验，在现有身份/部门范围内导入，不能直接信任预览JSON或将其视为正式结论。运行 `npm.cmd run test:master-data-template` 验证合成工作簿及文件边界，不连接数据库或启动服务。

### 模板导入预览与确认（P04）

新前端 `/app/template-import` 提供选择文件、检查对象/字段/逐单元格来源、返回源文件修正、明确确认导入和重新查询结果。记录默认新建独立实体；如需修订已有记录，逐条选择“明确关联已有对象/字段的新修订”，填写已有台账的平台编号并核对名称和修订号，然后重新检查。关联字段必须属于该次明确关联的对象。文件编号如OBJ-001不用于平台身份匹配，同名和相同内容不自动覆盖已有台账。

新增同源API位于 `/api/master-data-template`：

| 方法与路径 | 输入及结果 |
|---|---|
| GET `/capabilities` | 服务端校验有效身份、当前部门及 `governance:draft-department`；admin即使兼具编制角色也拒绝 |
| POST `/preview` | multipart中仅一个file和一个options JSON；options含links数组，返回P03预览、归口部门、规范关联及preview_digest；不写业务数据 |
| POST `/confirm` | 同一原始文件、links、preview_digest、客户端UUID request_id及明确的confirm=true；服务端重新解析，成功返回batch_id、稳定实体/版本映射及pending_verification |
| GET `/source/:id` | 按批次部门权限重新读取文件摘要、源单元格原值与局部编号映射 |
| GET `/definition/:type/:id`、`/version/:id` | 按既有读权限及范围返回当前或固定定义版本；type仅object/field |

links每项为 `{record_type, source_row, entity_id, expected_revision}`，只包含明确修订的行；没有该行关联即新建。预览摘要绑定原字节、解析器/模板版本、身份、部门和关联，用于检查预览与确认的一致性，不替代后端权限或校验。变化后必须重新检查，409不自动套用新版本。写入复用现有会话和CSRF，不读取私有配置、不使用客户端提供的部门或定义JSON决定事实。

整批确认在一个MySQL事务中复用P02保存与校验：登记来源、新建本次导入上下文、保存对象/字段及定义版本、原值映射、事件、请求幂等及回执；任何失败整批回滚。原始字节SHA-256、解析器/模板版本和当前部门共同去重。同请求同内容返回原结果，不同内容返回409；不同请求命中已完成同批次时返回原批次，不重复建档；同一文件配另一关联方案返回TEMPLATE_BATCH_PLAN_CONFLICT。只有P02来源登记而未完成导入的批次返回TEMPLATE_SOURCE_INCOMPLETE，不猜测补全。文件内容变化创建新来源批次，只有明确关联的实体增加版本。

P04无DDL、角色、权限项或正式审批链变更。复用P02七张增量表；未关联旧对象、旧字段、空归属字段及历史版本保持原样。显式修订保留原ID、key、既有上下文和历史版本；旧路径读写兼容，旧基础记录被其他入口改动时继续返回DEFINITION_LEGACY_SOURCE_CHANGED。定义版本物理source_kind仍使用P02的manual，表示用户明确保存；实际模板来源写在definition.source和来源表中，不冒充无来源手工事实。导入追加definition_saved事件，不追加事实核对或正式认定；主数据、权威来源、组合标识和治理结论不自动确认，也不创建正式流程工作包、问题或待办。

上传仅在内存解析，不保存原件文件副本；数据库保留可追溯原值。P03的5MB文件、ZIP解压及单元格限制继续生效，另校验台账名称/字段长度及64KB定义上限，拒绝截断。错误包络为 `{error,code,field_errors?}`，沿用DEFINITION_*及TEMPLATE_*，401为失效身份、403为无权、409为预览/版本/幂等/批次冲突、413为超限、503为迁移或依赖不可用。错误不返回SQL或堆栈。

文件和关联仅在当前页面内存保留；取消更换、取消返回/刷新、请求失败均保留输入，明确更换才应用新文件。401后保留字节但废止预览，重新登录后须重新检查；换身份时隐藏上一身份材料并要求明确放弃或回到原身份。浏览器检查使用Edge100%、1699×828及390×844；`npm.cmd run test:master-data-template-import -- --output <artifacts内全新目录>` 使用自有隔离MySQL、合成身份和真实HTTP/Edge，结束清理本次资源。代码及隔离通过不表示正式3000已开启或人工业务已验收。

### 对象与字段管理（P05）

`/app/objects` 提供对象清单、对象详情、字段明细、保存修订、版本回查及停用确认。模板导入回执可跳转到对应对象。对象信息按“对象是什么、从哪里来、谁维护、怎样使用、规则与待确认事项”分组；模板原始列值仍可从源单元格回查。来源补充与原模板定位分别保存，不改写原件或覆盖来源批次。维护部门、岗位、建议权威来源和待确认主体均是待核实说明，不因此改变组织归属、账号权限或治理结论。

新增对象归属当前有效部门，不由客户端选定其他部门。新增字段直接引用明确父对象的稳定ID和当前固定版本；服务端首次为该对象建立 `manual` 字段维护上下文，事务失败时一起回滚。修订旧字段保留其原上下文、父对象、稳定ID和历史版本。字段来源独立填写，必填支持待确认/必填/非必填；枚举NULL与空数组分别表示未知和明确无项。单字段标识与组合标识由用户明确选取字段固定版本；组合成员的顺序和组ID保持，不从名称或模板行序推断。

新增同源API前缀为 `/api/data-map-definitions`：

| 方法与路径 | 行为与门槛 |
|---|---|
| GET `/capabilities`、`/objects?search=&after=` | 返回当前编制资格、表单说明和授权对象清单；每页100条，next明确指向后续页 |
| GET `/detail/:type/:id?after=` | 当前定义及所属字段；字段按其原上下文范围过滤，每页100条。旧基础记录变化或缺定义版本时拒绝，不自动补快照 |
| GET `/history/:type/:id?before=`、`/version/:id`、`/source/:id` | 分页版本索引、不可变历史快照、来源批次和源单元格；仍由服务端验证读取范围 |
| POST `/save` | entity_type、definition补丁、request_id；修订另含entity_id和expected_revision；字段另含object_id和object_version_id。新增部门和上下文由服务端决定。嵌套补丁保留其他已知值和原始来源定位 |
| GET `/impact/:type/:id` | 返回当前修订、相关引用数量和impact_digest；不改变数据 |
| POST `/retire/:type/:id` | request_id、expected_revision、impact_digest、confirm=true及非空reason；锁定后重算影响，变化返回409，确认后追加版本和definition_saved审计事件 |

写入继续要求 `governance:draft-department`、有效身份、本部门范围、CSRF、状态和并发检查；admin即使兼具编制角色仍只读。可修订和停用的对象状态为draft/active，字段仅draft；已提交、确认或冲突字段沿用原办理流程。本页不授予正式确认、撤销审核或发布权限。错误包络沿用 `{error,code}`；新增DEFINITION_PARENT_INACTIVE、DEFINITION_PROPERTY_INVALID、DEFINITION_RETIRE_CONFIRM_REQUIRED、DEFINITION_IMPACT_CHANGED，其他错误复用既有DEFINITION_*。401/403/409/503分别表示身份、权限、冲突和依赖问题，不回传SQL或堆栈。

对象停用使用既有inactive，字段停用使用既有archived；不增加DDL或状态枚举。停用保留全部记录、审查事件、来源和固定引用，不级联改写字段；停用对象下禁止新增或修订字段，原有字段仍可查阅。影响清单覆盖现有字段、固定定义引用、标识组、系统关系、冲突、质量问题、来源映射和事实核对记录；后续新增引用模块时须同步扩展。无删除、重建或自动恢复入口。既有P02迁移和恢复边界保持，旧字段缺父对象等不能自动推断的记录继续保留原读取方式并等待明确处理。

输入仅保存在页面内存。保存失败、取消离开/刷新/切换/停用均保留输入；401后同身份重登可继续，身份或部门变化时隐藏旧输入。409不自动覆盖新版，用户先保留修改，再重新读取核对。请求UUID在未改内容的重试中复用；输入变化产生新UUID。版本选择和对象切换废止旧异步响应，不持久化表单或身份数据。运行 `npm.cmd run test:data-map-management -- --output <artifacts内全新目录>` 做隔离MySQL、真实API及Edge验证；正式开启、人工输入法体验及业务验收仍需独立完成。

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

### 前端查看与办理口径

数据地图先展示流程图入口、上下文选择和已有字段。具有本部门编制权限的人员可展开“创建上下文或导入字段”；只读人员不显示写入表单。创建部门固定为当前部门，字段导入仍由服务端复核上下文归属和权限。折叠表单不清空已输入内容。

工作台“我的待处理”读取经过现有权限与事项可办理性筛选的 `summary.actionableCount`；其他页面“可查看待办”读取 `summary.pendingTodos`，表示当前访问范围内的通用待办，不能视为全部归本人办理。兼容字段 `priorityCount` 保留原引导卡数量含义，前端不再把它显示为今天的待办数量。新增计数只派生于现有事项，不修改历史记录或审批链。兼容未返回新增计数的服务时，前端使用已有 `workItems` 并排除明确标记为 `guidance` 的指引项；缺少事项数据时显示暂不可用。

花名册搜索支持回车，中文输入法组合输入期间不触发查询。冲突显示实际字段与部门名称；名称缺失时明确标注待补充。状态、系统生成的旧待办文案和时间仅调整展示，不改写原始值。

导航分工：侧边栏负责模块与流程工作区切换。“流程治理”展开预览核对、跨部门承接待办、承接冲突待办和历史流程草稿；“数据治理”保留独立入口。主屏不再显示第二套流程工作区标签，保留当前对象的筛选、详情、视图选项及办理操作。原有工作区URL和深链接继续有效；浏览器前进、后退和任务跳转均按同一路由更新侧边栏选中项，切换前保留未提交修改保护。

### P12：固定交接关系检查

交接详情页按确定缺陷、待业务核对和本轮未覆盖范围展示关系检查，可定位同一修订的两端流程、对象、字段版本和证据。GET /api/design-handoffs/:id（含version查询）增量返回relationship_checks；旧响应字段、保存状态和审批权限保持。页面计算只读，不创建运行、不自动确认、不调用模型。

独立worker新增handoff_deterministic解析器和handoff-deterministic-v1规则集，每步骤一个固定handoff输入；沿用P09存储和P10领取令牌。完整规则清单见server/handoffAnalysisRules.js。格式、枚举及同字段版次与“无需转换”声明的明确矛盾为确定缺陷；其余缺失说明、身份及标识对应保持待核实。不同平台对象不合并，多个接收方分别登记。枚举仅顺序变化不判冲突，未知值不当作确定差异。

单位比例仅有文字规则，适用范围没有结构化确认，用户尚未确认主链框架及完整输入，因此结果明确保留未覆盖。转换说明齐备也不证明执行正确或真实接收。handoff.coverage负责记录缺口说明，相关实际检查仍留在coverage.missing；不把未执行检查伪装成已覆盖。现有P08实时修订影响仍单独显示，不改固定历史运行。无新表、迁移、回填或正式动作；旧运行及P10/P11适配器继续保留。回退前须停止worker并处理P12队列，旧worker不能接管新解析器。

### P13：跨运行发现对照

仓储新增只读方法 `compareAnalysisRuns(session, beforeRunId, afterRunId)`，在同一事务中复核两个运行的当前身份、部门及材料范围、固定来源和结果摘要，再调用 `server/analysisComparison.js`。本步未注册HTTP路由或新增页面；分析API属于P14范围。

对照算法 `analysis-diff-v1` 使用部门范围、规则语义标识、材料逻辑身份和对象/字段语义标识计算匹配键。每次运行仍保留独立finding_id；旧comparison_key及全部证据不改写。标题、文件名、输入键、步骤名和数组下标不决定身份。来源阶段不跨越合并；独立上传批次或模板批次缺少显式谱系时不能推断为同一材料。

返回新增、持续、证据变化、本轮未再检出、不可比较、待人工匹配六类结果，以及前后运行、manifest摘要、发现/尝试ID、证据键和覆盖摘要。只比较每个步骤最后一次尝试；旧尝试保留。规则版本没有显式兼容映射、解析器或AI配置改变、部门或步骤输入/规则范围变化时保守标不可比较。当前未提供兼容映射编辑或人工匹配写入入口。相同规则的可比范围完整覆盖后才允许新增或本轮未再检出；其他范围缺口仍单独保留。失败、取消、未结束运行不能得出问题消失结论。局部对象/字段或交接字段对被删除时标不可比较，不据删除认定整改。身份含内容摘要、未知算法、重复逻辑主体或缺证据时待人工匹配。

固定来源摘要或证据位置变化可标证据变化，因此正常重排可能改变证据状态，但不制造整批新增发现。`comparison_complete=false`表示仍有不可比较、人工匹配或覆盖缺口；空结果也不能掩盖这些缺口。本轮未再检出不等于已整改，不生成待办、不关闭问题、不改变审批链。新方法不写数据库；无需DDL、回填或旧数据转换，移除入口即可回退，P09—P12数据和原读取接口保持兼容。

### P14分析接口与可见范围

P14在同源 `/api/analysis` 注册受限分析API，P13所述“未开放HTTP”是该步骤当时的状态。接口使用现有会话、CSRF、有效人员身份、权限和来源范围；全员摘要尚未开放。管理员即使兼有结构核对权限仍只读。当前仅接受P11/P12确定性规则运行，创建与入队在同一事务提交；独立worker仍须按既有命令显式启动，HTTP服务不会自动启动worker。

| 方法及路径（相对 `/api/analysis`） | 用途和响应范围 |
|---|---|
| GET `/capabilities` | 当前创建资格、允许来源类型、摘要字段清单；`public_summary_enabled=false` |
| GET `/sources?kind=…&offset=0&limit=50`、`/sources/:kind/:id` | 五类固定来源：v7_source、definition、mapping、handoff、template；返回固定标识、版本、摘要及来源元数据，不返回正文或模板原值 |
| POST `/materials/references`、`/materials/uploads` | 复用P07的预览修订/已发布版本引用或单个V7 JSON上传；后者使用multipart的file和request_id，4 MiB上限；模板接收继续用P04入口，其他格式留P18 |
| POST `/runs` | P09固定输入合同加P11/P12准入；同request_id同内容返回原创建结果，异内容409；失败不留孤立运行。重新运行另给request_id及rerun_of_run_id |
| GET `/runs`、`/runs/:id/summary` | 仅run_id、status、revision_no、created_at、started_at、finished_at六个字段；不含标题、材料名称、人员或发现数量 |
| GET `/runs/:id` | 固定输入元数据、规则和解析器版本、步骤尝试及覆盖缺口；不展开发现、原文或人员身份 |
| POST `/runs/:id/cancel` | request_id与expected_revision；沿用P10取消，兼容未入队P09运行，旧修订409 |
| GET `/runs/:id/findings`、`/runs/:id/findings/:findingId` | 当前有权范围内的发现内容、尝试/步骤、稳定标识和证据ID；保留待核实及issue_id为空，不成为正式问题 |
| GET `/runs/:id/evidence/:evidenceId` | 复核运行、证据归属、固定引用及当前范围后返回定位摘录；JSON Pointer可解析原文，document_anchor仅保留已声明定位，不伪造提取结果 |
| GET `/runs/:id/diff/:otherId` | 双方全部来源授权后返回P13差异及覆盖缺口；不据未检出关闭问题 |
| GET `/runs/:id/export` | JSON附件analysis-export-v1；固定运行、发现及证据定位元数据，不含原文摘录、原始字节、创建人、内部会话或队列信息；不接受扩大导出范围的查询参数 |

每层读取均重新核对当前身份及所有固定来源。运行包含任一无权材料时，整条运行不可读；不把部分可见误写成全量结果。列表在授权过滤后分页，offset只计可见记录，limit为1—100、默认50，offset最多10000；不输出全库总数、隐藏数量或基于隐藏ID的游标。依赖/摘要异常返回明确错误，不能理解为旧问题消失。部分运行仍返回既有结果和缺口。所有响应禁止缓存；资源不存在和无数据范围统一404，动作权限不足沿用auth的403，身份失效401，冲突409，超限413，依赖不可用503，JSON格式错误400。错误不回显正文、SQL或堆栈。

JSON请求上限256 KiB；材料只写P07私有MySQL来源，不写public、frontend或可下载目录。API不提供客户端回填分析结果、启动worker、正式问题/待办写入或全员明细入口。没有新增表、DDL、回填、角色或审批状态。旧仓储接口和P09—P13记录保持，回退可移除本路由及投影模块，已创建队列按P10规则处理。正式库迁移、正式运行、人工体验和业务验收仍须单独完成。
