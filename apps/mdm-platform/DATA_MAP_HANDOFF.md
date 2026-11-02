# Data map handoff v1 实施与使用合同

2026-10-23。本说明记录基于Q1—Q13与1.0定稿的实现合同。3000已部署全盘升级版本，运行HR v5，持久控制及原功能开关保持；当前运行、备份恢复及证据以同目录DOCKER.md为准。准确来源名称展示与后续修复已部署；技术检查和软件发布不代表业务验收。业务依据仍来自用户确认及原始材料。

## 当前办理合同

旧对象/字段保存、停用、身份维护及确认、上下文维护、Excel 确认导入、旧版本分配和回填，在路由和共享仓储拒绝直接写入。持久控制缺失返回 503；控制存在返回 `409 HANDOFF_REQUIRED`。新开关关闭不恢复旧写。员工目录继续由其独立权限和审计处理，地图审批不接管目录保存。

新接口前缀 `/api/data-map-handoffs`。经办只能处理当前明确分派的包；组长核对并批准准确草案、来源、依赖、影响摘要；发布执行人及原批准人都在业务事务内重新核验。叠加 admin 仍只读，部门只处理定向事实。实际 v4/v5 权限模型分别适配；混合、未知或缺失模型失败关闭，不自动升级授权。

旧 completed 包先准备独立 intake，组长逐明细核验后形成 `legacy_intake` binding。旧 JSON、事实、审核及状态不改写，缺失历史明确标注。本次开始的更正使用 correction 及追加版本，再经新审核形成新 binding。原生候选生成、明细结论、事实提问/答复/关闭和完成审核均要求 `request_id`，使用全局请求回执；缺失时明确 422。页面在发出请求前保留原 UUID 与载荷，异常后先查询原回执；仅 prepared/retryable 或 not_observed 允许原 UUID、原载荷重试，后者不能解释为已回滚。查询 committed 后须明确确认才结束本次输入；rejected 后可修改内容另行提交。重新登录其他身份时隐藏并保留待核定或待确认的原输入，当前身份不能覆盖。原生审核在 controlled 且非只读时，同事务记录准确 `native_review` binding、绑定头及 pending 草案任务；开关关闭时任务不消费。

草案、提交、退回和重新基于审核绑定办理均保存不可变修订；保存不改变地图。提交前检查前四类门槛，第五类批准此时为 pending。批准请求必须带当前检查的 `binding_digest`；来源、内容、事实、依赖或影响改变后拒绝旧批准。撤回本人待批提交和组长撤销未发布批准保留原记录，新增修订；来源异常不能困住这些停止动作。

发布使用单个调用方连接和事务。请求行、控制行、包/固定来源、目标/依赖和当前资格依次核验。对象与字段版本从控制行预分配完整 BIGINT 字符串，对象先插入、字段立即外键随后插入，最后校验复合标识闭包。版本、数据元、关系、完整发布清单、兼容投影、必要有效头和成功回执全部提交或全部回滚。历史范围发布不改变现行投影和有效头；复用不改生产者 head；同名不合并。已有字段在两个范围都保持稳定父对象和上下文。

`request_id` 为全局 UUID，主体、动作、范围及载荷摘要必须相同。先提交 prepared 登记，业务及 committed 结果在同一事务保存。提交断连返回 `HANDOFF_COMMIT_UNKNOWN` 与原 UUID；先查回执，不能新造 UUID 盲重发。持锁返回 in_progress，可安全重放的 prepared 返回 retryable，矛盾的业务效果与回执返回完整性错误。终态重放只重新核验当前读取资格，不再提交一次业务。

## 整单撤回与恢复

发布状态由不可变清单及连续 publication_events 解析，published 的 event_revision 为 1，整单 withdrawn 后为 2。检查与批准不推进该状态序号。组长先检查，提交同一 reason 和检查所得 binding_digest 批准，再以 withdrawal_approval_id 执行。摘要冻结完整产生/复用清单、固定正文、原因、有效头、完整影响及相关发布状态。相关变化或原批准人失权后拒绝旧批准；来源已变化或异常不阻止有据停止新引用。

整单撤回只清理同时匹配本 publication_id 与准确版本的产生项 head，追加事件及原 UUID 回执；保留后续 head、物理投影、旧正文和引用事实。复用项不撤销其他产生发布。后续版本仍依赖撤回版本时返回固定正文及 requires_attention=true、new_reference_allowed=false；上下文、字段和字段台账保留这一状态，不能通过复用清单恢复引用资格，也不自动上一版。

恢复通过专用入口新建未批准草案，或者明确指定 target_handoff_id 和 expected_target_revision，在当前 draft 后追加修订；缺少明确指定、已提交/批准或旧绑定不符均拒绝，不覆盖已有输入。目标包须完成准确审核，current 只接受实际现行来源，旧来源可在原包 historical 恢复。跨包采用时正文、来源明细和后续发布均属于目标包，原 publication 只作 restores 来源。

恢复请求提交 target_package_id、scope_mode、完整 draft、basis、evidence_refs 和 item_mappings。浏览器同时固定并提交 expected_target_binding_id；锁内当前目标审核绑定改变时返回 HANDOFF_REVIEW_BINDING_STALE，保留输入。旧 API 省略该增量字段时仍按锁内现有合同办理，不能声称具备浏览器的选择后过期检测。每个原发布项显式映射 target_item_ref，选择 adopt 或 adapt 并填写逐项依据/证据；服务器记录原内容和首次采用内容摘要。adopt 会核对原定义、SOR 与重建后的内部关系；产生项不得复用原撤回版本。后续需要修改时以 restoration_adjustments 逐项说明依据，追加草案修订并重新检查批准。普通 from-work-packages、保存或 rebase 不能伪造、替换或清除恢复来源。发布始终生成本次新版本；原撤回事件不改。

## 冲突协调、重大升级与事实重核

Q6 冲突按 fact、definition、responsibility、sor、cross_department、version 分类，准确指向本草案条目，并明确差异、方案、影响、相关部门和依据。经办在本包分派范围整理，组长组织普通协调；跨部门事项明确分派现有冲突处理人，重大争议由该处理人升级到明确项目决策组成员。组长、当前处理人及被升级决策人的动作分别核验现有权限；处理人及决策人只能读取本事项及所涉条目，不能因此读取完整工作包。

状态使用 open、escalated、resolved、verified。已提交或批准但未发布时仍能登记冲突，阻断继续发布，旧批准及草案状态不被静默改写。普通协调或重大决定只形成 resolved，既不修改定义，也不确认部门事实。已发布草案不开放新冲突写入。每次观点、分派、升级、结果、重开及验证均递增独立冲突修订并追加完整事件，修订冲突保留输入并按原 UUID 查询。

协调前可提出定向补证，phase=evidence；已开的问题须完成确认关闭后再形成结果。结果后按准确 resolution_digest 为各明确相关部门分别提出结果事实重核，phase=result_recheck。事实使用 open→answered→confirmed→closed：联络人或当前负责人答复，当前登记且有权的本部门最终负责人绑定准确答复版本、摘要及依据确认，MDM 经办或组长核对后关闭。部门读、写响应及请求回执只含该事实的必要结果，不返回完整冲突或其他部门资料。重大决定、普通答复和 MDM 关闭均不能替代最终确认。

验证只在 draft 办理，绑定当前正文、所涉条目、审核 binding、处理结果和各部门准确事实版本；同时核对负责人任命及确认资格当前有效。通过后追加一份正文不变的草案修订，冻结最新依赖，仍须新批准才能发布。正文或审核依据改变后重核受影响内容，旧批准不能套用；仅更换 MDM 经办不冒充部门事实变化。负责人离任后回任也不能复用旧确认。重开产生新轮次，旧问题及原状态完整保留，明确标 superseded_round，不自动关闭或沿用。纯版本并发且无事实变化时可明确登记有依据和证据的 fact_recheck.not_applicable；事实或定义等分歧不能以此免除重核。

同包新恢复草案中的历史冲突及其事实标为 historical_handoff，保留于依赖和追溯，不当作新草案的当前确认。完整已验证历史不按新正文摘要重复判断；未解决或缺完整证明的历史冲突仍阻断并列需重核，不能因切换承接单而绕过。旧普通事实的 closed 不补成 confirmed；缺完整追加历史的旧冲突保留原值及兼容例外，不能直接当 verified 放行。读取先取得控制共享锁，注册和业务在冲突/事实前锁同包 assignment，按当前资格与准确修订办理。

## 来源版本升级与差异沿用

`GET /source-upgrades` 提示实际现行固定版本、工作包及承接进度，不建包。MDM 继续通过既有主动建包入口明确选择新版；旧包保持原流程版本、摘要、规则、事实及审核。现行上下文尚未承接时，列表和详情保留 `source_upgrade_pending`、旧来源及 `current_process_version_id`，不返回可新引用的旧关系或旧字段。

比较按同一流程身份和完整固定内容进行，区分 added/modified/deleted/unchanged。名称、类型、必填、相连行为责任、关系及生命周期等参与语义依赖；明确的导出时间和文件包标识不作为业务变化。完整父对象及相连上下文采用保守影响范围，不能把结构候选摘要当成未变化证明。源正文、摘要、流程身份不一致时阻断。

新包独立完成本次结论审核后，在草案登记逐项升级评估。载荷固定 source_package_id、准确 source_binding_id、comparison_digest 和 decisions；逐项指向原/新 detail_version_id，填写依据、证据及 facts/conclusions/shared_definitions/impact 四类重核记录。unchanged 的 reference_and_recheck 使用明确 JSON Pointer reuse_scope 引用原 governance 字段和值，不复制成新确认；已有准确旧审核但本次明确不沿用时，可选 recheck 和空 reuse_scope，仍保留原依据并完成本次重核。新增/修改须 recheck，删除须 remove，均不能带沿用字段。有旧包而无可沿用审核证据时，明确不沿用并保留旧状态/缺口，目标仍须完成新审核，不补造旧 binding。

有同流程历史包的新版办理须完成差异评估，不能绕过接口直接批准。评估事件、办理资格和同正文新草案修订在同事务追加；当前 binding、正文、比较或依赖变化需重新核对，原 UUID 回执还原原结果。历史范围继续按固定来源办理；Q10 同包同来源恢复保留其专门合同，跨新版包采用旧内容仍检查 Q9。评估不发布，之后仍须本次检查、独立批准和整体执行。

来源升级不自动撤回仍有效的共用定义；新流程使用仍须建立实际版本的上下文及固定引用。定义可复用不表示旧流程关系已成为新版关系。

承接曾完成与当前可用性分别表达：`handoff_completed` 保留既有完整发布事实，`availability` 和 `governance_status` 另核对当前 head、来源及依赖，已撤回或需处理不能被旧发布洗成可用。

## 读取与固定引用

- `view=current`：只使用 `effective_heads → publication item → 固定版本`；无有效头明确 unavailable，不查询旧 head 或物理行补值。
- `view=history`：指定固定版本，保留原正文和摘要；历史可读不授予新引用资格。
- `view=legacy_in_use`：指定不可变 registry 快照，返回 `legacy_unapproved` 与历史完整性状态。
- 不能表达 view/状态的旧客户端收到升级提示。固定上下文的字段从同一发布清单解析，不混入其他最新字段。
- 新映射、交接和分析引用核对受控且未撤回的固定版本；旧映射/分析历史不按新 current 重算。影响闭包覆盖定义父引用、数据元/上下文关系、Excel 映射、固定映射、设计交接及分析输入；未安装表仅记结构状态，不能伪造业务引用或要求业务处置。


旧 `mdm_mapping_records` 与独立主数据 Excel `mdm_publications(kind=master_data)` 保留原状态及真实表/主键身份，另标 `legacy_unapproved`、`map_approval_generated=false`、`new_reference_allowed=false`，不变成 data_map_publications。组织人员 publication 保持其独立目录合同。旧映射的实时显示上下文明示 `current_read_model_not_historical_snapshot`；版本审计保留原记录，缺历史不推断。Excel 固定载荷按原摘要验证，大整数标识以字符串传递。

固定源、映射、设计交接及已存分析输入的原快照与摘要保持；当前来源升级、目标撤回或关闭 formal 开关只形成独立状态/问题，不改写旧结果。新引用仍按当前资格、固定版本可引用性和同连接图锁核对。分析问题/闭环的现状判断同时核对实际来源版本，不能把历史读成功当作当前可引用。旧列表不能表达准确固定版本时明确要求客户端升级，不按物理现值拼装历史。

## 接口与输入

所有写请求带 `request_id`、主资源准确 `expected_revision`。新建为 0，事实新建另带父修订。保存草案提交 `draft` 全量白名单快照，409 保留客户端输入；服务端不做模糊字段合并。

| 路径 | 已实现用途 |
|---|---|
| `GET /workbench` | 当前身份的包/承接单、冲突和定向事实发现；逐资源复核范围，部门不返回完整包，选人仅返回具备办理资格的最小标识和姓名 |
| `GET /source-upgrades` | 无参数为现行提示；package_id 与 target_process_version_id 指定同流程固定比较 |
| `GET /:id/source-upgrade-assessments`、`POST /:id/source-upgrade-assessments` | 固定差异、原/新结论版本及逐项沿用/重核；POST 追加事件及同正文新修订，不自动批准 |
| `GET /capabilities`、`GET /requests/:requestId` | 结构/模型/开关状态及原请求回执；读取不依赖新办理开关 |
| `POST /from-work-packages/:packageId` | 当前审核 binding 的未批准草案；同 binding 已存在时返回原草案/发布结果 |
| `POST /work-packages/:packageId/intakes`、`POST /intakes/:id/reviews` | 旧包当前核验，不伪造原审核 |
| `POST /work-packages/:packageId/corrections`、`PATCH /corrections/:id`、`POST /corrections/:id/reviews` | 追加更正与新审核 |
| `GET /facts/:id/current`、`POST /intakes/:id/facts`、`POST /corrections/:id/facts`、`POST /facts/:id/answers`、`POST /facts/:id/closures` | 定向事实版本；answered 不等于 closed |
| `GET /:id/conflicts`、`POST /:id/conflicts`、`GET /conflicts/:id` | MDM 列表/登记与事项范围读取；新建 expected_revision=0，另带 expected_handoff_revision |
| `POST /conflicts/:id/actions` | viewpoint/assign/resolve/escalate/decide/verify/reopen；expected_revision 指冲突，另带 expected_handoff_revision；verify 返回新 handoff_revision |
| `POST /conflicts/:id/facts`、`POST /facts/:id/confirmations` | Q6 定向补证与结果重核；事实新建为 0，后续用事实修订，另带 expected_conflict_revision 和 expected_handoff_revision；确认必带 answered_fact_version_id、answered_snapshot_digest |
| `GET /:id`、`GET /:id/revisions/:revision`、`PATCH /:id/draft`、`POST /:id/rebase` | 当前办理与固定修订；显式采用新 binding |
| `POST /:id/submit`、`POST /:id/checks`、`POST /:id/approvals`、`POST /:id/publish` | 提交、检查、批准/退回、整包发布；approved 必须带检查的 `binding_digest` |
| `POST /:id/withdraw` | 仅 `withdraw_submission` 或 `revoke_approval`，必须说明原因 |
| `GET /publications/:id` | 固定清单、完整状态事件、event_revision 及当前允许动作 |
| `POST /publications/:id/withdrawal-checks` | 带 reason 和准确 event_revision，取得完整撤回检查摘要 |
| `POST /publications/:id/withdrawal-approvals`、`POST /publications/:id/withdraw` | 准确批准和整单执行；原因、影响或资格改变须重核 |
| `POST /publications/:id/restorations` | 新恢复草案或明确追加指定 draft；expected_revision 指原 publication，expected_target_revision 指目标草案，新建目标为 0 |
| `GET /work-packages/:id/trace`、`GET /publications/:id/trace` | 同一固定关系的双向追溯，保留来源、审核、目标、SOR、影响及办理人/资格/事件 |

接口返回的 committed 只代表该动作已保存；只有 `published_current` 表示本次现行范围发布结果。`published_historical` 不推进现行指针。公开路由不能选择内部 system 身份。

## 前端承接工作区

`/app/data-map-handoffs` 为本地当前代码的独立页面，可从数据治理导航或工作包进入；支持 package、handoff、conflict、fact、publication 查询参数。页面读取 `/workbench` 发现当前可见事项，再用现有准确资源接口办理。MDM 按具体包允许动作准备或审核；处理人、决策人只见分派事项，部门只见本部门定向事实；管理员叠加业务角色也只读。页面提示不代替写事务中的权限和资格核验。

完整草案使用结构化对象、字段、数据元、上下文、规则、属性 SOR、来源明细、复合唯一标识、原候选处置与影响处置。旧 completed 包先独立接入逐项核验，审核后更正追加版本，不覆盖旧正文。Q6 的观点、分派、普通协调、重大升级、决定、定向补证和各部门结果重核分别办理。Q9 展示四类准确差异、旧审核与本次结论版本，逐项选择沿用范围及四类本次重核。Q10 分别执行影响检查、准确批准和整单撤回；恢复明确选目标包、审核绑定、草案修订及逐项 adopt/adapt，后续修改已有采用内容须补 restoration_adjustments。

界面选择不改写机器合同：旧接入和更正的明细名称只从准确版本已保存材料读取；定向补核的原问题选择限定于父记录捕获的同一明细。未知旧关联和事实类型保持原值，不自动用现名或默认值代替。工作包名称补充读取仅针对工作台已授权包，显式触发、最多四个并行读取，允许部分读取失败并明确提示；来源版次与状态只取响应中的业务字段。升级及恢复校验按业务明细名称提示，不输出内部引用。

发布条件的术语入口严格匹配当前 revision_id，并限制为站内术语页面的准确 handoff_revision 目标；错误原因转为业务说明，内部位置只保留于原响应和合同。术语判断、检查、提交、批准及发布仍分别办理。结果提示只引导查看实际返回的事实、冲突、草案或发布对象，不增加允许动作。

有意义输入及原请求只保存在当前页面会话的内存，绑定人员、账号、授权版本、部门和独立办理会话。列表刷新和暂离同源页面保留；切换事项须明确结束或放弃。刷新整页、关闭标签或离开站点有未提交提示，用户确认离开后内存不持久化，不能承诺重启浏览器恢复。不同身份不能看见或覆盖原输入；同一有效身份返回后继续核对。来源或准确修订变化保留输入并阻写，不偷偷采用新版本。迟到读取、旧表单回调和输入法组字期间的切换不能静默改写另一份输入。

本地实现支持授权更新后的显式输入恢复：仅原人员、原账号、原部门一致且身份字段完整时提供入口。用户选择恢复后，以当前会话重新读取 `/api/org/me`、工作台及原办理事项的准确对象；存在冻结请求时，还重新查询该 UUID 的回执并按真实回执更新观察状态。全部读取成功才更改本地输入的授权归属，原内容、来源、修订、办理会话及请求载荷保持；不自动发送写请求，不沿用旧授权下的可重试判断。读取失败、身份切换、原输入更换及迟到响应均不恢复。恢复只取得查阅输入和核对回执的机会，后续写入仍由当前功能状态、准确事项动作及来源一致性分别限制。不同人员、账号或部门继续隔离。候选实现与正式开启、发布、人工验收分别记录。

每次写前固定全局 UUID、准确修订和完整载荷，提交后保留输入。异常先查询原 UUID；committed 必须明确核定，rejected 可据原错误修改后另立请求，retryable/not_observed 只允许原 UUID、原载荷重试。成功回执不会自动执行下一步、发布或撤销。若核定期间出现别人后续修订，原输入仍按原来源阻写，不把新修订套入旧内容。会话重置同时终止旧会话的在途网络请求，防止迟到读取响应及其滚动 Cookie 干扰新身份；请求中止不表示业务已回滚，已经固定的写请求仍按原 UUID 核定。浏览器自动化不替代人工 IME 或业务验收。

## 事实来源名称读取兼容

事实详情响应新增可选只读字段`detail_name`和`detail_name_source`，不进入事实快照、事件、摘要或写入载荷，不迁移旧行。出处为`fixed_source`、`review_snapshot`、`parent_snapshot`或空值。旧客户端可继续使用原字段；前端接受未提供新字段的旧响应，并保留缺名提示。

名称投影在原`fact_read`或已有包内读取资格核验后执行。冲突事实取其原`binding_id`，按唯一`detail_ref`核对完整审核快照、准确明细版本及固定来源；更正事实按首次事实版本的请求与`fact_change`读取创建时父修订，接入事实按原接入快照读取，不借用当前其他修订。只返回名称和出处，不返回快照、治理结论、其他部门事实或人员。重复、缺失或不能证实的对应保持空名称；事实、父快照、审核绑定及明细版本内容漂移继续失败关闭。

固定来源缺失、状态不支持或固定内容无法核验时，不将其名称标为固定来源；已经核验的原审核或父快照名称仍可注明历史出处，保留原授权事实的查阅能力。未知数据库读取失败仍报错，不能把故障当作缺名或权限放行。所有提交、批准、发布及来源完整性卡口保持原检查。

## 结构、开关与隔离维护

`DATA_MAP_HANDOFF_ENABLED` 默认 0。新办理写同时要求此值为 1、`PROCESS_DATA_GOVERNANCE_READ_ONLY` 为 0、持久 `cutover_state=controlled`、准确结构与已支持权限模型。缺失或异常失败关闭。原工作包审核和 pending 登记独立于新办理开关；只读时均拒绝。内部生成器仅在已开启进程每15秒消费pending，退出先停止轮询并排空当前任务；模块不因代码或结构存在而自行启用正式开关。

`server/dataMapHandoffSchema.js` 是显式增量结构；应用启动不运行 DDL，也不切换标记。隔离 apply 保留 caller-owned `stageXX_isolated_<owner UUID>` 目标限制；正式结构及旧数据快照准备通过 `scripts/manage-governance-deployment.js`，核验准确数据库及实时服务器 UUID、明确授权、停写记录、备份及成功恢复回执文件摘要、预期盘点摘要。正式能力凭证不能用 JSON 或普通布尔参数代替。工具仅准备至 `prepared`；不生成审核、binding、有效头或通知，不切 `controlled`，不发布应用或开启功能。六张基础工作包表全部缺失且无标记时，可按明确盘点计划只创建空表及迁移标记，不建包、任务或回填；部分结构、缺失标记、漂移及其他前置表缺失均拒绝，不能自动修复。盘点变化和已经受控的目标也拒绝。DDL 会隐式提交，因此独立 inspect；失败后保留已完成增量并重新盘点，不宣称 DDL 已回滚。命名 CHECK/FK/索引、引擎、排序规则和约束启用状态均核对。高水位取旧 MAX 与 AUTO_INCREMENT 的安全较大值，不从旧头创建新批准或有效头。

正式受控切换使用独立维护模块 `server/governanceControlledCutover.js`。它要求准确目标与备份恢复能力凭证、准备期摘要、固定代码和镜像、实际运行账号权限摘要、TECH-01—05 及 W01—W12/R01—R08 逐项证据文件摘要、停写排空与恢复兼容记录。同一事务固定相关表的元数据和迁移标记，实时检查案例治理、正式版次分离与承接结构，并共享锁定权限映射。`prepared → controlled` 与维护审计同一事务；提交确认丢失时销毁不确定连接，以原 cutover UUID 在新连接核定。模块不改变运行开关，不分配人员业务角色，也不签业务验收；应用账号不需要维护审计表写权限。容量阈值固定为 10 人并发、读取 P95≤2 秒、写入≤5 秒、影响检查≤10 秒；至少一万历史加当前全库的隔离恢复≤10 分钟。合成技术测试不能代替案例 2、经营发展部及部门负责人的实际办理验收。

联合准备中，已审阅的案例及正式版次分离 DDL 先执行并核对原行指纹，再重新盘点术语/承接核心，固定计划内 DDL 后的准备摘要，最后生成兼容快照。`process_design_versions` 的列可空性和默认值属于兼容摘要；捕获后再改变这些列会被判定为漂移，不能覆盖原快照来消除差异。DDL 中断后的续跑须以实际结构、原行和阶段记录核定，不能把新的盘点摘要直接当成原授权。

办理事务先以无结果 SELECT 固定全部被校验表及 `schema_migrations` 的共享元数据锁，再逐表读取真实结构并共享锁定迁移标记；完整验证后才等待全局图控制行。元数据和标记锁保留至业务与回执提交，DDL 不能使已验证的等待事务失去结构依据。每次仍完整检查实际表、约束和排序规则，不缓存数据库就绪结果。结构查询合并读取表清单和列排序规则；来源升级只传输相关冻结引用，保留孤儿引用和异常历史的失败关闭；同次门槛检查复用已锁定或同一快照内的部门状态。上述优化不取消图原子性或办理资格重核。

## 验证与交付边界

验证入口见 [脚本说明](scripts/README.md)。当前完整前端及相关修复见 [本轮实施报告](../../artifacts/mdm-data-governance-handoff-implementation-20261020-06/implementation-report.md)，旧消费兼容与 Q9 后端证据保留于 [前批报告](../../artifacts/mdm-data-governance-handoff-implementation-20261020-05/implementation-report.md)，Q6 证据保留于 [冲突协调与事实重核报告](../../artifacts/mdm-data-governance-handoff-implementation-20261020-04/implementation-report.md)，Q10 保留于 [整单撤回与恢复报告](../../artifacts/mdm-data-governance-handoff-implementation-20261020-03/implementation-report.md)，原生历史与请求恢复保留于 [前批报告](../../artifacts/mdm-data-governance-handoff-implementation-20261020-02/implementation-report.md)，初次后端实施保留于 [首批实施报告](../../artifacts/mdm-data-governance-handoff-implementation-20261020-01/implementation-report.md) 和 [追溯矩阵](../../artifacts/mdm-data-governance-handoff-review-20261020/traceability-matrix.md)。隔离实例使用随机 owner、回环端口和 tmpfs，清理仅针对本次 owner；合成备份恢复不证明正式数据容量或恢复时间。

当前本地后端已实现整单撤回、恢复新草案到重新批准发布、固定依赖需处理读取，以及 Q6 冲突协调、重大升级和部门分别重核；旧消费兼容和 Q9 差异沿用后端已补齐。本地前端承接工作区已接通完整结构化办理，实际 Edge 自动化覆盖及证据见本轮报告；人工 IME、真实业务实办和有权验收仍未执行，不能把隔离验证表述为已开启或业务验收。原生未完成包的明细结论、提问引起的明细状态、事实答复与关闭同步追加不可变版本，投影、历史和成功回执同事务。首次接触旧未捕获前态仅标 captured_current_only，原作者和更早历史不补造；本次新增或修改后的版本记录实际办理资格。新生成明细从创建开始留存，已存在明细不重写；审核绑定准确末版明细及事实版本。

本轮20个登记入口的技术范围见[最终入口复核](../../artifacts/3000-joint-governance-deploAX4261020-01/entrypoint-review-final.json)及[复用范围说明](../../artifacts/3000-joint-governance-deploAX4261020-01/entrypoint-review-scope.json)。同一精确RC4的两开关36项真实HTTP、旧消费者、生成器、资格锁与结构漂移专项保留证据；新增HR v5维护未包含在部署中。TECH-05使用停写后的当前全库、10个会话、10,010条治理历史及194表全字段恢复通过，见[最终容量结果](../../artifacts/3000-joint-governance-deploAX4261020-02/capacity-144401a1-c029-4ef9-915a-275bda3b73ac/results.json)。[联合部署回执](../../artifacts/3000-joint-governance-deploAX4261020-02/deployment-review.md)记录正式准备、权限、controlled切换、实际开关和上线回读。人工IME、真实业务实办和业务验收仍分别记录，技术复核不签这些事实。旧成功直写的历史回归脚本不得为通过而恢复旁路；受影响的当前入口使用受控发布/拒绝合同回归。

## 3000 内部集成路径

承接属于 3000 现有同源应用 `/app/`，沿用登录、当前人员资格和权限。`/app/data-map-handoffs` 是应用内页面路由；不会建立新服务或改变 3001 独立无状态、手动下载上传的边界。代码和候选验证不表示正在使用的 3000 已部署或开启。

| 原入口 | 准确定位与操作边界 | 返回后核对 |
|---|---|---|
| 我的工作台 | 旧响应缓存之外读取当前有权办理的草案、审核/执行、分派冲突及定向事实；只把当前动作计为承接待处理 | 回到工作台重新读取；办结、撤权或重新分派后不继续展示旧承接动作 |
| 待办收到 | 独立“数据地图承接事项”区使用同一只读事项投影，进入准确资源 | 保留原通用待办 status/type 筛选并重新读取承接状态；不建、删或完成通用待办来替代治理动作 |
| 正式数据治理工作包 | 在本包显示准确审核绑定、各承接草案及发布事实，携带 package/handoff/publication 固定标识进入 | 返回原 package 重新核对；工作包 completed、草案批准与地图发布分别表达 |
| 数据地图台账 | 显式 view=current/history/legacy_in_use，历史另带准确 version；按 publication_id 与可见固定关联定位工作包、发布或准确草案修订 | 返回保留 context/view/version/identityField；不按名称、ID同数或列表先后猜来源 |
| 承接办理页 | 继续调用既有准确资源及允许动作；来源、审核、修订和原 UUID 不因跨页而提升或重建 | 原办理输入仍在时，另一事项的深链接先显式提示，明确结束原办理后才切换；未知请求先核定 |

返回参数 `return_to` 仅接受已列明的 3000 页面及其有效查询字段，不接受外站、其他路径、重复或无法表达的参数；它只恢复界面上下文，不授予权限。每次资源读取及写入仍复核当前身份和范围。没有准确归属时明确显示无法定位；功能未开启、只读或结构未准备与确实没有可办理事项分别表达。实际结构漂移和身份失效不降级为空列表。

台账已撤下旧上下文创建、字段导入及身份/黄金源直写组件。当前、历史和旧快照读取不混用；来源升级待完成不拿旧字段补现行，撤回上下文保留准确范围和不可用状态，不把物理投影当有效定义。固定历史读取不授新引用资格，旧快照缺固定字段集合时明确历史未知。旧页面已有内存输入不自动提交或改绑，放弃或离开仍须遵守原编辑会话提示；跨页保留及原 UUID 核定的完整机制适用于承接办理会话。

上述事项为实时只读投影，不是持久待办、通知或新的审批权限。发布事实与当前可引用性仍分别判断。当前技术证据见 [本轮集成报告](../../artifacts/mdm-data-governance-handoff-implementation-20261020-07/implementation-report.md)。人工体验、正式目标和业务验收条件不因本页接线而放行。
