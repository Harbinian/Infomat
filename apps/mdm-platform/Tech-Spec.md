# MDM流程治理统一入口、身份与责任技术规格

## 3000内编制接口与存储

当前本地兼容读取与显示约束：工作台首次提交在原事务中记录编制已开始；旧`started_at`为空但已有工作台成功保存或提交快照时，以原快照只读判断转办已关闭，不迁移或补写旧时间，功能关闭不遮蔽该证据。术语读取可附业务位置名称并排除技术配置候选，旧`location`、原文、摘要及写入核验仍保留。正式和治理新事件的姓名显示快照独立存于事件载荷，不加入已有资格、批准或正文摘要，不改变旧事件；读取时只使用对应事件确存的历史姓名。

授权读取中的`DATE`通过`DATE_FORMAT`返回`YYYY-MM-DD`，避免驱动时区转换改变日历日期；原数据库值及SQL生效条件不变。人员维护历史列表可按原有完整目录历史资格返回可空审计对象摘要，取当次审计的前后内容，不以当前目录补旧名称，管理员或其他不具资格的身份不获得该摘要。界面字段、按钮及错误根据当前对象、实际权限和具体阻止原因呈现，内部标识仍只用于关联、请求和下载合同。案例提交材料、时限变更及确认、独立优化建议、正式流程及治理台账的TIMESTAMP读取用数据库epoch确定实际时刻；承接表已按UTC写入的DATETIME按UTC原文读取，再由界面显示北京时间。该转换不修改全局连接时区、存储值、写入条件或历史签名快照中的旧时间；原回执仍按保存的响应返回，新的当前读取单独取得正确时间，不递归更改旧JSON。无法证明含义的旧快照时间不猜测更正。以上实现及隔离证据不表示正式部署。

候选前端通过`/api/process-authoring`访问独立编制草稿，不直连数据库。`process_authoring_drafts`保存当前工作副本，`process_authoring_revisions`只追加显式保存及提交快照，`process_authoring_requests`保存请求幂等回执。提交在同一事务和连接中调用既有流程预览仓储形成不可变案例修订；核对、正式提升、负责人确认、发布及恢复卡口继续由原模块执行。启动和请求只检查结构，不执行DDL；默认关闭。完整合同、错误、旧JSON处理、前后端开发及隔离验证见[流程编制实施合同](PROCESS_AUTHORING.md)。本地候选不代表正式迁移、开启或业务验收。

3000 内部入口集成的当前技术说明见 [受控承接说明](DATA_MAP_HANDOFF.md#3000-内部集成路径)：工作台/待办投影当前有权办理事项，工作包和台账按准确标识进入，办完返回并重新读取；台账旧直写入口已撤下。仅为本地实现及所列隔离技术证据，人工体验、正式切换和业务验收未完成。

## 统一术语治理技术边界

`TERMINOLOGY_GOVERNANCE_ENABLED=1` 才开放新模型，默认关闭。`tg_terms`保存概念及当前指针，`tg_term_versions`仅插入定义快照，`tg_term_events`追加状态决定，`tg_requests`记录人员与请求标识的幂等回执；质疑及部门意见另行保留，`tg_legacy_links`映射旧表与旧标识。新增结构由显式隔离迁移准备，启动和业务请求不执行DDL，缺marker或表时拒绝新治理写入。

`tg_usage_heads`保存有权业务对象当前核对及固定引用，`tg_usage_events`追加核对、固定及影响处置记录。流程正式发布与数据交接发布在原事务、同一连接中重验来源和术语版本及状态，再固定引用；任一失败回滚原事务。历史正式引用不随术语后续变化被改写。对接人的含义核对由现任部门最终负责人本人确认；引用确认保存角色任命与来源证据，负责人更换后不能沿用陈旧确认。

草案、办理动作及引用范围均事务内复核人员、账号、部门与角色分派；管理员叠加业务角色仍只读。数据治理开关、受控承接状态及只读边界同时适用。候选匹配无写入副作用，不据相似词生成冲突或待办；技术命名约束独立保留，旧语义替换只能提示。完整合同及命令见 [术语治理实施合同](TERMINOLOGY_GOVERNANCE.md)。


## 数据地图受控承接：本地工作树状态

2026-10-20 按已确认 Q1—Q13 与 1.0 定稿实施本地后端优先控制：旧定义/字段/上下文/身份与导入直接写入封闭，新增独立审核绑定、旧包接入、更正、未批草案、准确批准、整包事务发布、固定读取、全局回执和权限复核。整单撤回按准确 publication+version 清理产生项有效头；恢复由专用入口形成新草案，当前门槛与新批准通过后产生新版本。固定依赖读取返回需处理及禁止新引用状态。合同、API、开关、兼容与剩余范围见 [受控承接说明](DATA_MAP_HANDOFF.md)。本地隔离验证不证明正式运行状态；本批未连接正式库、未执行正式迁移、部署或功能开启。Q6 后端冲突协调、重大升级和部门分别重核已实现并取得隔离证据；旧固定消费、旧映射及独立 Excel 发布兼容，以及 Q9 主动建包、四类差异、明确沿用范围与本次重核后端已补齐，准确范围见受控承接说明和本轮证据；本地已补齐 `/app/data-map-handoffs` 结构化承接工作区，覆盖旧包接入、更正、完整草案、Q6 冲突协调与重大升级、Q9 差异沿用、Q10 整单撤回恢复及双向追溯；实际 Edge 隔离验证范围见受控承接说明和本轮报告，人工体验及业务验收仍未完成，当前代码不能单独用于正式切换。


## 1. 版本与边界

流程文件的当前代码候选为原生V9，受支持V8/V7正文与摘要保留；该结构版本独立于下述身份模型。V9以 `entry_behavior_refs`、对象记录模型/集合字段、链接实例范围/存在条件及来源存在条件表达数据关系，共享校验器按真实版本分派。3000不自动迁移旧正文或猜测记录含义，3001仅在用户导入的内存副本中补待确认字段。目标部署、开关与验收须分别核对。

当前分析规则为 `v7-deterministic-v5`，旧v4依赖冻结于 `server/rules/v7-content-v4/`，旧v3仍保留八项检查；历史任务恢复不能调用新评分器改写原语义。V9核对摘要 `process-v7-review-item-v3`绑定入口、记录模型、范围及存在条件，V8/V7保持原v2摘要。未知入口或记录条件即使呈现在“待确认”组，服务端仍计算 `blocking=true`并阻断正式门槛，不能相信上传文件的通过声明。

数据可用性由本地共享 `process-data-availability.js`检查动作开始前的全部有效路径，不以仅可达、同动作新建或后续循环替代真实先行输入。`required`外部来源仅声明必须满足的真实前置；实际办理仍须核验来源绑定和材料。新格式不自动派单、确认、迁移数据库、建包或发布。2026-10-20经明确授权，仅3000部署白名单修复并验证案例2的V9修订4；3001运行实例保持。运行职责模型仍为v4，工作树v5及其他候选未混入；实际记录见[交付回执](../../artifacts/3000-case2-r3-remediation-20261020/delivery-verification.json)。

- 代码身份与治理模型版本：`rbac-raci-v5-2026-10-19`；须与显式职责迁移同批切换，未部署代码不表示运行模型已升级
- 正式身份存储：MySQL
- 正式身份链路：`person -> user_accounts -> person_roles -> roles -> role_permissions -> permissions`
- 遗留`users/user_roles`和SQLite人员接口：仅保留明确的历史兼容或隔离测试，不参与正式授权

当前原生V9及受支持V8/V7核对与正式治理使用保留V7名称的兼容接口；3001工作树为V8候选，实际服务版本另查健康状态。V1至V3本地编制、结构化导入和旧承接办理已退役。以下明确标为历史的模块、字段和状态用于解释既有资产，不授权恢复旧入口、清空或转换旧数据。技术文档不构成业务真源。

应用入口实施MySQL运行边界：两种读模型及必要连接变量显式校验，旧SQLite路由在正式模式返回410，公共初始化只加载运行能力与部门。非production的显式遗留测试使用独立数据库路径；无正式回退。运行仓储的隐式初始化改为必要表列的只读探测，结构维护仍使用已有显式迁移。该探测不替代类型、索引、外键及迁移记录核验。维护命令、账号权限、历史数据去向及未验证项见[运行与结构维护](docs/Current-Runtime-Maintenance.md#正式运行与结构维护分离)。旧正文和历史状态继续保留，当前正式事务按原生V9及受支持V8/V7合同核对。

本规格说明现行身份、授权、责任证据、原生V9及受支持V8/V7核对与正式治理，以及历史流程JSON和承接资产的兼容边界。3001独立编制并由用户主动下载、上传交接；业务依据回到用户指定的外部材料、实际说明和明确确认。

## 2. 组成模块

| 模块 | 文件 | 责任 |
|---|---|---|
| 固定治理模型 | `server/roleDefinitions.js` | 定义二十二项权限、九个角色、十二项RACI活动、可见标签和模型版本 |
| 治理职责 | `server/governanceResponsibilities.js`、`server/governanceResponsibilitiesMigration.js` | 案例/工作包经办分派、案例负责人任命、办理记录及显式v3至v4迁移；不自动授予人员角色 |
| 部门最终确认 | `server/departmentAccountability.js`、`server/departmentAccountabilityMigration.js`、`server/processDepartmentDecisions.js` | 独立策略`department-accountability-v1`；本人、最终责任登记及部门角色双门槛，旧意见保留并重新确认，不改变RBAC模型版本 |
| 案例争议 | `server/processCaseDisputes.js` | 复用预览事件审计记录协调、升级、决定及部门重核，来源变化和未解决争议阻止正式流转 |
| 身份读取 | `server/identityMysqlRepository.js` | 从人员、账号和有效角色计算当前身份、权限和数据范围 |
| 账号与责任服务 | `server/governanceAccessMysqlRepository.js` | 账号生命周期、角色授权、访问审计、部门决定和发布责任核验 |
| 数据结构 | `server/mysqlSchema.js` | 身份、授权、审计、责任记录和迁移表 |
| 迁移 | `server/rbacRaciMysqlMigration.js` | 盘点、备份、固定模型写入、账号切换、回滚和补偿 |
| 身份接口 | `server/routes/accounts.js` | 管理员手工开户和账号生命周期接口 |
| 模型接口 | `server/routes/rbac.js` | 固定模型只读接口 |
| 责任接口 | `server/routes/governance.js` | 部门决定读取和追加接口 |
| 会话与中间件 | `server/auth.js` | 登录、会话校验、权限校验和首次改密限制 |
| 前端 | `frontend/src/`；同源`/app/`为唯一页面入口，根路径跳转；旧HTML和公开协议脚本已删除 | 原生V9及受支持V8/V7核对与正式办理、角色责任页、账号管理和角色可见标签；旧V1—V3编制及旧承接工作区退役；本地数据地图受控承接另有独立工作区 |
| 历史v1/v2规范化 | `server/processGovernanceV2.js` | 保留旧结构校验、引用检查和摘要兼容，旧在线导入退役 |
| 历史承接迁移 | `server/crossDeptHandoffV2Migration.js` | 保留旧字段和状态迁移、盘点、核对与恢复工具，不恢复办理入口 |
| 历史统一入口迁移 | `server/processGovernanceUnifiedMigration.js` | 保留旧完整JSON、草稿、承接冲突和事件维护工具，执行须具体授权 |
| 历史v3表单迁移 | `server/processGovernanceV3Migration.js` | 保留旧数据映射、批次备份与恢复，不自动转换当前原生V9及受支持V8/V7 |
| 流程设计接口 | `server/routes/processDesignMysql.js` | 当前正式草稿、审核、发布和准确版本正文；旧V1至V3编制、导入及承接入口拒绝 |
| 角色工作台 | `server/routes/roleWorkbench.js` | 当前原生V9及受支持V8/V7事项只读聚合，旧编制及承接队列退役 |
| V7预览核对 | `server/processPreviewReview.js`、`server/processPreviewReviewRepository.js`、`server/routes/processPreviewReview.js` | 按实际V7/V8版本校验、生成固定跨部门核对项、隔离保存修订与部门结果，路径保留V7名称 |
| V7迁移基线 | `server/processV7M0Baseline.js`、`scripts/inspect-process-v7-m0-baseline.js` | 只读核对正式三表、JSON摘要、引用关系和live schema差异 |
| V7正式基础迁移 | `server/processV7FormalMigration.js` | 以幂等DDL增加原生V7所需可空列、审核正文绑定和提升审计；不创建业务行 |
| 流程版本后续数据治理 | `server/processDataGovernance*.js`、`server/routes/processDataGovernance.js` | 用户选择已发布原生V8或受支持V7版本、工作包固定来源、确定性待定候选、工作包状态、定向事实问题、来源摘要复核和审核卡口 |
| 后续数据治理迁移 | `server/processDataGovernanceMigration.js` | 六张专用表的dry-run、结构一致性检查、显式应用和空表回退 |

组织与人员目录维护、页面合同及服务凭证只读接口见[DIRECTORY_API.md](DIRECTORY_API.md)。新增`directory`角色分组及独立维护权限；角色迁移不自动授权人员，旧账号接口不能修改员工事实。v3→v4职责迁移基线独立冻结，v4→v5使用`hrDirectoryRoleMigration.js`。

## 3. 授权计算

每次受保护请求按以下顺序处理：

1. 从会话取得`personId`、`accountId`和`authVersion`。
2. 读取`person`与`user_accounts`当前状态。
3. 比较会话`authVersion`和账号`auth_version`。
4. 读取当前日期有效、状态为`active`的`person_roles`；人员角色的`authorization_basis`暂为选填，`NULL`、空字符串或空白不影响有效性判断，生效日期、角色模型及范围校验保留。部署不回填或改写既有依据；重复授权留空时保留原文，非空输入按原规则更新。独立系统管理员初始化依据要求保持。
5. 只接受`roles.status='active'`且`roles.model_version`等于当前模型版本的九个固定角色；因此代码和显式模型迁移必须同批切换。
6. 合并角色固定权限，不接受`*:*`通配权限。
7. 根据全局、本部门、本人被分派事项或已升级事项计算数据范围。
8. 业务路由继续核对对象状态、任务关系和责任证据。

任一步失败即拒绝请求。前端隐藏按钮只用于减少误操作，不能代替服务端授权。

## 4. 会话

正式会话的身份字段只保存：

```json
{
  "personId": 1,
  "accountId": 1,
  "authVersion": 3
}
```

显示名称、部门、角色和权限由每次请求重新读取。账号状态、部门或角色变化时，服务端递增`auth_version`，旧会话在下一次请求时返回401并清除。

`must_change_password=1`时，除读取当前会话、修改本人密码和退出外，其他业务接口返回403。

正式会话使用`mysqlSessionStore.js`及独立的`mdm_http_sessions`表；该表由`sessionMigration.js`显式准备，运行请求不建表。会话记录还包含格式版本、Cookie及CSRF必要元数据，数据库主键只存会话ID的SHA-256摘要。登录等待持久化成功后返回；缺少身份字段、状态无效或`auth_version`不符时拒绝，首次改密会话可取得CSRF令牌。

HTTPS Cookie为`__Host-infomat.mdm.sid`，固定Secure、HttpOnly、SameSite=Lax、Path=/且无Domain；正式模式只接受明确的HTTPS origin及可信代理IP/CIDR。会话默认24小时滑动失效，签名密钥不变时跨进程重启保留；退出删除当前会话，物理过期清理为显式分批命令。旧`connect.sid`不迁移，首次升级重新登录，历史业务数据不受影响。

`/api/health`兼容存活合同，`/api/ready`另行返回就绪及源码摘要。就绪探测使用最多1连接和整体超时，并合并并发探测、短期缓存结果；MySQL、必要表列或配置失败返回503。仅3000的运行脚本、会话迁移/清理、环境变量、Windows监督方式和未验证边界详见[发布与恢复](../../docs/plans/2026-09-09-mdm-3000-launch/03-发布与恢复.md)。

会话专用池的等待队列限定为最多32个请求，保留默认2连接及原有整体超时。该时限包含排队、取得连接和SQL操作；到期后返回失败，延迟取得的连接销毁，不自动重试业务提交。就绪专用池继续不排队。该限制不代表正式并发容量已验收。

## 5. 固定角色与范围

- `admin`、`mdm_lead`、`data_quality_auditor`为全局范围。
- `department_contact`、`department_mdm_reviewer`为人员所属部门范围。
- `data_conflict_handler`为本人被分派事项范围。
- `mdm_steward`为本人被分派案例或工作包范围，新增`governance:handle-assigned-work`，不获得审核或发布权限。
- `decision_group`为已升级事项范围。
- 跨部门临时代办使用独立委托关系，不改变永久角色范围。

固定模型初始化排除非当前九个固定角色；历史角色不自动映射到新角色。增量职责迁移仅增加经办角色并更新原七个固定角色的模型版本，保留原`role_id`、`person_roles`及其他历史资产，不执行历史角色清理。

主对接人提交后，由部门负责人本人核对并最终确认，不设置中间审核员。旧机器角色`department_mdm_reviewer`的中文名称统一为“部门负责人”，保留标识和历史授权。实际办理同时要求登录人与本部门`final_responsible_person_id`一致、账号及人员有效、该部门角色授权与所需权限有效；管理员、编制人或仅有旧角色授权者不能代确认。

流程负责人为`process_governance_responsibilities`的`assignment_kind=owner`案例记录，由满足上述条件的部门负责人指定本部门有效人员；任命不转移部门最终责任，不增加全局角色或审批权限。经办分派使用`assignment_kind=steward`，仅MDM组长且有`governance:assign-work`可办。未安装职责表时接口明确503，旧预览读取不推断默认任命。

职责服务按目标类型复用原预览及工作包模块开关，工作台不返回关闭模块的事项。工作包只读时仅展示原合同允许的已完成包，分派、撤销等新职责写入同样拒绝，不新增独立开关或改动运行配置。

`/api/governance-responsibilities`提供案例/工作包读取、经办及负责人PUT任命、案例POST办理记录及GET工作台。任命要求`person_id`（撤销可为NULL）、`basis`、`expected_revision`；案例办理记录要求`request_key`、`content`、`basis`、任命修订和当前来源修订/摘要，重复同请求幂等，不同内容拒绝。事务重查人员、账号、角色、部门及目标状态；原资料正文不被办理意见覆盖。

`/api/process-case-disputes/cases/:id/actions`接受`assign/coordinate/escalate/decide/request_recheck/rebase`，请求含UUID `request_id`、`expected_event_id`、`expected_revision_no`、`expected_content_hash`和`basis`。决定为`recheck/return_for_revision`。审计存入原`process_v7_preview_events`，`event_type=process_dispute_action`、`schema_version=process-dispute-v1`；保留原双方意见再重开相应核对项。组长处理来源变化时不能取消待决定的升级。实际部门核对完成才追加争议关闭事件；正式提升、提交、批准及发布复核争议门槛。

正式草稿POST `withdraw`和`return-for-changes`分别校验原提交人及本部门负责人本人，均要求修订、摘要、`expected_review_task_id`和1至1000字`note`。状态转入已有`needs_changes`；撤回终结原待审任务，拒绝或通过后的退回保留原任务决定。恢复允许当前预览已变化但必须核验原提升修订；后续正常流转重新要求当前来源一致。发布引用最新审核任务，旧请求不能误操作同正文重提后的任务。该恢复不增加表或状态枚举，不修改已发布版本。

案例详情返回字符串`review_dispute_event_id`（无历史为`0`）；部门意见POST在存在争议历史时必须提供匹配的`expected_dispute_event_id`，与案例锁内最新事件不同即409。该字段绑定开始编辑时的轮次，不以刷新结果静默替换旧输入；无争议历史的受支持旧请求仍可使用原合同。协调/决定后的旧意见请求不能触发本轮关闭。新一轮争议重置升级标记，决策组读取同时核对本轮升级及当前来源修订/摘要；历史事件保留。

## 6. 写入事务

以下操作必须在单一MySQL事务中完成：

- 创建人员、待启用账号、初始角色授权和访问审计。
- 部门变更、旧部门角色撤销、新部门角色授予、`auth_version`递增和审计。
- 角色授予或撤销、账号必要状态变化、`auth_version`递增和审计。部门负责人授予还包含本部门最终责任登记，失败时授权与登记共同回滚。
- 账号启用、恢复、停用、密码重置和审计。
- 部门决定追加及被替代记录关联。
- 原生V9及受支持V8/V7提升、审核和发布中的正文绑定及审计，详见9.3。旧3001结构化导入事务仅为历史合同，在线入口已退役。

事务失败时不保留部分账号、部分授权或部分责任记录。

部门负责人授权沿用`POST /api/org/accounts/:personId/role-assignments`。`roleCode=department_mdm_reviewer`时，必须显式携带`expectedFinalResponsiblePersonId`（未登记为NULL）；替换另一人还要求`confirmReplaceFinalResponsiblePerson=true`。账号读取返回`department_final_responsible_person_id`及姓名供展示和草稿绑定。事务内核对当前策略、维护者权限、人员/部门有效状态、所属部门、当前生效日期及锁定的登记值，再保存授权、登记、认证代次和访问审计。已有当前有效部门授权复用原行，历史记录不批量回填；旧客户端缺少登记快照时明确拒绝，不产生部分授权。

登记变化返回409 `DEPARTMENT_FINAL_RESPONSIBLE_CHANGED`；未明确交接返回409 `DEPARTMENT_HEAD_REPLACEMENT_CONFIRMATION_REQUIRED`。响应的`departmentAppointment`说明前后人员、部门、是否改变登记和是否复用原授权。原负责人账号的认证代次同步递增；历史意见是否可采用继续由现行来源/任命绑定检查。该办理只更新`departments.final_responsible_person_id`，不增加目录通用编辑权，不增加数据表、角色或模型版本。

部门负责人须走专用角色授权入口；旧开户或人员变更的批量角色请求含该角色时返回422 `DEPARTMENT_HEAD_DEDICATED_GRANT_REQUIRED`，不留下部分修改。当前v4兼容调部门界面可明确选择暂不授新部门角色，并提交`roleAssignments:[]`；服务端保留旧部门角色撤销及变更审计，调入后再由专用入口授权并登记，不额外授予主对接人角色。缺少角色安排或非空却没有部门角色仍拒绝。此兼容处理不放开工作树v5的账号/员工目录职责边界。

实际更换登记的`role_assigned`审计事件标识同时绑定到后续部门确认的`appointment_event_id`；尚无此类登记事件时，原策略证据按无事件值兼容。同人重复补登记不换代，A换为B再换回A后，A先前的确认不能恢复有效。通用部门决定以本次登记锁内读取的`decisionRecordCutoff`为界，只有该登记之后的新决定可用于发布责任核验。此机制只增加审计及确认JSON字段，不修改旧意见或已发布版本。

## 7. 数据结构

身份字段见[RBAC-RACI-DB-Schema.md](docs/RBAC-RACI-DB-Schema.md)，历史承接字段见[Cross-Department-Handoff-DB-Schema.md](docs/Cross-Department-Handoff-DB-Schema.md)。以下`process_design`中的V3正文、承接和冲突字段为退役链路的历史结构，保留既有数据；当前原生V9及受支持V8/V7不经该旧编制链。

- `roles`增加状态、分组、核心标记和模型版本。
- `person_roles`增加范围、部门、授权依据、有效期、状态和撤销信息。
- `user_accounts`使用`pending_activation`、`active`、`locked`、`disabled`，并保存`must_change_password`和`auth_version`。
- `identity_access_events`只追加账号与授权事件，不保存明文密码或密码散列。
- `governance_decision_records`只追加部门责任决定。
- `identity_migration_*`表保存迁移批次和恢复所需快照。
- `process_design_cross_dept_handoffs`统一保存前置输入和后续承接，并以`handoff_ref`、候选哈希、修订号和当前标记保留历史。
- `process_design_structured_imports`保存受控导入、审核依据、规范化JSON和内容哈希。
- 历史`process_design_drafts.process_content_json`保存当时完整v3 JSON；`revision_no`和`content_hash`用于历史修订及内容核对，不赋予业务权威。
- `process_design_handoff_conflicts`保存承接冲突当前状态和协调方案。
- `process_design_handoff_events`只追加承接、冲突和项目决策事件。
- `process_v7_preview_cases`、`process_v7_preview_revisions`、`process_v7_preview_review_items`和`process_v7_preview_events`保存原生V9及受支持V8/V7的预览核对，不引用或写入正式流程版本；机器表名中的V7保留兼容命名。
- 保存完整v3 JSON时，同一数据库事务同步流程、业务行为、承接候选修订和事件。投影同步失败时回滚JSON修订，不形成半套治理事实。
- 删除已有治理记录的承接必须提交`handoff_ref`和作废原因；历史承接只取消当前标记，不物理删除。
- `process_data_governance_*`六张专用表只保存固定流程版本绑定、待定候选、MDM结论、定向事实答复、审核和事件，不复制完整原生V8/V7正文。工作包以`process_version_id`唯一，所有写操作共享`revision_no`。创建任务、固定版本、工作包及只读归档的内部关联遵循现有精确整数合同：安全范围内保留number响应，更大的合法整数保留十进制字符串，已舍入的number及越界值拒绝。MySQL创建链显式CAST读取和绑定标识，新包通过当前连接的`LAST_INSERT_ID()`文本值关联，重复创建仍返回原任务及原包；不重算旧源正文、摘要或审核记录。

## 8. 接口

身份接口见[RBAC-RACI-API-Contract.md](docs/RBAC-RACI-API-Contract.md)，当前原生V9及受支持V8/V7核对及正式办理见[Process-V7-Preview-Review-API-Contract.md](docs/Process-V7-Preview-Review-API-Contract.md)。[Cross-Department-Handoff-API-Contract.md](docs/Cross-Department-Handoff-API-Contract.md)是退役承接链的历史合同。

核心接口：

- `GET /api/rbac/model`
- `GET|POST /api/org/accounts`
- `GET|PATCH /api/org/accounts/:personId`
- `POST /api/org/accounts/:personId/role-assignments`
- `POST /api/org/accounts/:personId/role-assignments/:assignmentId/revoke`
- `POST /api/org/accounts/:personId/activate|enable|disable|reset-password`
- `GET|POST /api/governance/decision-records`
- `GET /api/org/me`

以下旧编制、V1至V3导入、承接和冲突路由已退役，列表仅供历史路径识别；当前不能按旧合同办理：

- `GET /api/process-design/drafts`
- `POST /api/process-design/drafts/canonical`
- `GET|PUT /api/process-design/drafts/:id/content`
- `GET /api/process-design/drafts/:id/export`
- `POST /api/process-design/import-structured-output/preview`
- `POST /api/process-design/import-structured-output/approve`
- `GET /api/process-design/cross-dept-handoffs`
- `GET /api/process-design/cross-dept-handoffs/:id/story`
- `GET /api/process-design/handoff-conflicts`
- `POST /api/process-design/handoff-conflicts/:id/assign`
- `PUT /api/process-design/handoff-conflicts/:id/proposal`
- `POST /api/process-design/handoff-conflicts/:id/department-confirmation`
- `POST /api/process-design/handoff-conflicts/:id/escalate`
- `POST /api/process-design/handoff-conflicts/:id/decision`
- `POST /api/process-design/cross-dept-handoffs/:id/assign-counterparty`
- `PUT /api/process-design/cross-dept-handoffs/:id/counterparty-response`
- `POST /api/process-design/cross-dept-handoffs/:id/department-decision`
- `POST /api/process-design/cross-dept-handoffs/:id/structure-gate`

当前后续数据治理接口（须总开关、角色权限和来源版本门槛通过）：

- `GET /api/process-data-governance/status`
- `GET /api/process-data-governance/workbench`
- `POST /api/process-data-governance/creation-tasks/reconcile`
- `GET /api/process-data-governance/work-packages/:id`
- `POST /api/process-data-governance/work-packages/:id/generate-candidates`
- `PATCH /api/process-data-governance/work-packages/:id/details/:detailId`
- `GET /api/process-data-governance/fact-requests/:id`
- `POST /api/process-data-governance/fact-requests/:id/respond`
- `POST /api/process-data-governance/fact-requests/:id/close`
- `POST /api/process-data-governance/work-packages/:id/complete`

旧`/api/org/users*`写接口返回410；旧RBAC批量导入返回410；固定模型写请求返回405。

## 9. 责任记录与发布卡口

`recordGovernanceDecision`在写入前完成：

1. 独立部门确认策略已显式迁移并通过标记及快照校验。
2. 当前登录人等于该部门`final_responsible_person_id`；账号、认证代次、人员及部门状态有效，且不是独立管理员。
3. 当前用户具有该部门有效`department_mdm_reviewer`授权及核对、记录决定权限；组织身份和平台授权缺一不可。
4. 决定值、对象、版本和依据有效，记录人与最终责任人为同一本人；决定时间由数据库记录，传入`decidedAt`明确422拒绝。
5. 旧意见保持原值。迁移前的通用决定不作为新策略确认；预览与正式新决定保存策略、本人、角色授权标识及来源绑定证据，责任人或授权变化后须重新确认。

`assertGovernancePublishReady`在发布前完成：

1. 对象和版本明确。
2. 所有必需部门均有当前负责人在新策略下作出的有效`approved`决定，确认仍绑定当前内容；旧审核记录不能直接继承为最终确认。
3. 必需部门责任人完整。
4. 阻断问题数量为零。
5. 结构检查通过。
6. 版本检查通过。

MDM工作组组长只能在卡口通过后发布，不能以角色权限跳过部门决定。



### 9.3 原生流程预览核对隔离

- 原生V9及受支持V8/V7通过`/api/process-v7-preview`进入专用案例，路径和机器标识保留V7兼容命名，不经过旧V3导入。数据治理工作包支持已发布原生V8或受支持V7，保留来源版本，不降级正文。
- 服务端按实际V7/V8版本调用共享纯校验入口，按归口部门和固定执行部门生成核对项。不能识别部门时只返回提示，不推测业务事实。
- 新修订以`process_ref`、内容摘要、核对项稳定标识和核对内容摘要进行并发与变化判断。未变化项沿用双方结果，变化项重新打开。
- 部门核对写入同时校验权限、当前人员部门、核对方和修订号。管理员不得执行写操作。
- 运行时路由不得自动建表；数据库结构只能通过空库初始化或明确授权的迁移命令建立。
- `PROCESS_V7_PREVIEW_ENABLED`和`PROCESS_V7_FORMAL_ENABLED`默认关闭，开启仍须目标授权和M0/M1/M2门槛。2026-09-15已取消单流程配置，旧`PROCESS_V7_TRIAL_PROCESS_REF`不再读取；同一案例保持原稳定标识，另一流程另建案例，权限、部门、修订和摘要绑定继续复核。
- V7提升事务按预览案例、当前修订、目标主档、活动草稿的顺序加锁；相同修订和摘要使用提升审计唯一约束保证幂等。
- V7审核任务保存`draft_revision_no`和`content_hash`。审核或发布发现绑定过期时返回409，不允许旧结论覆盖当前正文。
- V7发布事务按草稿、主档、当前版本、审核任务的顺序加锁。发布版本不填伪造的L1、L2、L3或V3投影，成功响应返回`process_version_id`。
- `GET /api/process-design/versions/:processVersionId/content`只从不可变正式版本读取完整正文，并对原生正文重新计算摘要；正式下游不得读取预览案例。
- 3001与3000共同调用仓库内无网络、数据库和浏览器副作用的V7校验入口；预览上传、后续提升和发布三个信任边界都必须重新验证。

### 9.4 原生流程工作台与编辑会话

- `GET /api/role-workbench`复用案例、当前核对项、提升记录、正式草稿和审核任务进行只读聚合。预览核对、退回修改、范围核对、提升、提交、正式审核和待发布任务使用原对象ID、修订和内容摘要，不新增任务表或通用任务引擎。
- 可变MySQL工作台响应不再使用15秒缓存，并返回`Cache-Control: no-store`；静态角色说明仍可缓存。办理完成的事项在下一次读取消失，受修订影响的核对事项重新出现；范围决定只有尚未解除的卡口进入待办。
- 多角色任务保留来源角色和所需权限，部门范围及状态规则复用V7详情投影；管理员叠加业务角色仍只读。查询失败向上返回503，前端显示不可用并清除旧动作，不能转换成空列表。
- `frontend/src/ProcessPreview.jsx`的原生V9及受支持V8/V7编辑会话以当前人员、案例及修订绑定页面内存字段。核对项按稳定键恢复；保存只清除该提交组内与请求快照一致的输入，其他项及请求期间新输入的值保留。没有自动保存、长期浏览器缓存或服务端草稿表。
- 切换案例/工作区、上传和退出需要明确处理未提交输入；刷新/关闭使用原生离页提示。401后同人重新登录可恢复当前页面内存；409保留原意见，读取并人工核对当前修订后才允许继续。旧项消失时保留只读原文，不推断迁移到其他业务项。
- 正式审核结论为空起始值。页面只呈现办理人主动填写的意见，未预选批准、代写部门意见或认定主数据。当前V7/V8正文、预览及正式事务门槛保持；旧V1至V3编制、导入和承接办理已退役；只读响应增量字段见[V7接口约定](docs/Process-V7-Preview-Review-API-Contract.md)。

### 9.5 流程版本后续数据治理

- `PROCESS_DATA_GOVERNANCE_ENABLED`默认关闭。旧`PROCESS_DATA_GOVERNANCE_TRIAL_PROCESS_VERSION_ID`不再读取，`configured_process_version_id`兼容返回`null`、`scope_mode=published_v7_versions`；工作包固定绑定用户选择的已发布原生V8或受支持V7版本和来源摘要。
- `PROCESS_DATA_GOVERNANCE_READ_ONLY`缺省或`0`保留原办理模式；`1`关闭所有工作包写入口，仅按原权限查阅准确版本的`completed`工作包及定向事实。总开关关闭仍返回不可用；只读参数非法返回`PROCESS_DATA_GOVERNANCE_READ_ONLY_INVALID`，ready为不可用。该配置不改变表结构、既有数据、角色、审批状态或默认启用策略。
- `/status`及工作台`feature`增量返回`read_only`布尔值。只读模式的`allowed_actions`只有`view`，工作包待办为空；工作台仅返回已完成包，部门事实列表包含该包中本部门已关闭的记录。未完成详情返回`PROCESS_DATA_GOVERNANCE_COMPLETED_ONLY`；所有写方法返回409及`PROCESS_DATA_GOVERNANCE_READ_ONLY`，在路由和每个仓储写入口操作数据库前拒绝，包含发布事务调用的创建任务函数。
- 只读页面显示已存治理结论、判断依据、责任部门和统一对象标识；不生成编辑控件，不修改空值或历史内容。正式版本正文仍复用`GET /api/process-design/versions/:processVersionId/content`及原有权限、摘要校验；部门收到事实问题不自动取得完整正式版本或MDM工作包权限。结束方案另须关闭V7写开关，该参数不是全平台只读开关。
- 流程发布与迁移不自动创建任务或工作包；具有所需权限的`mdm_lead`在页面选择任一已发布原生V8或受支持V7版本并主动建包，包括历史已发布版本。既有包保持原版本、摘要、标识和记录，不合并、重建或回填。
- 候选规则只读取受支持原生版本的既有结构，使用单值`behavior_links[].operation`。每个已声明字段进入关键字段判断；字段、数据流或生命周期范围为空时生成范围缺失待定项。
- 每次写入在工作包行锁和`expected_revision`检查后，再复核正式版本内容摘要。来源变化、规则版本变化或并发修订冲突均停止写入。
- `admin`只读；MDM专业治理要求`mdm_lead`及固定权限；业务答复要求目标部门的固定部门角色和权限。
- 前端待办模式只渲染1至3个动作。工作包和事实问题使用全屏蒙版弹窗，并对关闭、切换、地址变化和离页执行未提交修改保护。

## 10. 安全控制

- 密码由`bcryptjs`保存散列。
- 临时密码只在启用或重置响应中返回一次。
- 访问事件不保存密码或密码散列。
- 所有权限检查在服务端执行。
- 固定模型不接受自定义角色、角色继承或通配权限。
- 最后一个有效管理员受`LAST_ACTIVE_ADMIN`保护。
- 登录名、工号和人员账号关系使用唯一约束。
- 管理员具有治理全局只读权限，但没有业务写权限。
- 质量单和映射待办备注属于业务写入：除原有可见部门/参与关系外，分别要求相应编制、提交、审核、分派或质量核查/结构核查权限之一；只有全局读取权限不能留言。
- 一般冲突提交协调结果要求当前`governance:handle-assigned-conflict`权限，仓储继续校验协调状态和当前指派人；撤权后的历史指派不产生写权限。
- 上述权限修正不改变数据结构、稳定ID或V3/V7格式，不删除或回填既有备注、协调记录和授权历史。

## 11. 兼容与迁移

身份迁移见[RBAC-RACI-Migration-Runbook.md](docs/RBAC-RACI-Migration-Runbook.md)，承接迁移见[Cross-Department-Handoff-Migration-Runbook.md](docs/Cross-Department-Handoff-Migration-Runbook.md)，v3表单状态迁移见[Process-Governance-V3-Migration-Runbook.md](docs/Process-Governance-V3-Migration-Runbook.md)，V7预览和原生正式基础迁移见[Process-V7-Preview-Review-Migration-Runbook.md](docs/Process-V7-Preview-Review-Migration-Runbook.md)，流程版本后续数据治理迁移见[Process-Data-Governance-Migration-Runbook.md](docs/Process-Data-Governance-Migration-Runbook.md)。

切换原则：

- 迁移前执行dry-run。
- 备份旧角色、权限、账号和角色关系。
- 仅`ADMIN001`自动保留管理员权限。
- 其他账号停用，旧角色关系保留历史但不产生权限。
- 清除旧会话。
- 未发生新授权事件前可以整批回滚；已经发生新授权事件后使用补偿撤销。
- 空数据库只允许执行一次受控管理员初始化。

## 12. 验证

现行本地验证入口（按改动选择，隔离检查不表示运行开启或业务验收）：

```powershell
npm run test:rbac-raci-v2
npm run test:frontend
npm run test:project-roles
npm run test:role-workbench
npm run test:process-data-governance
npm run test:process-governance
npm run test:retired-capabilities
npm run test:mainline
```

以下为连接目标环境的结构维护检查，其中旧承接和统一入口命令保留历史维护用途；必须有具体目标、只读权限或变更授权及恢复条件，不能作为普通文档检查自动执行：

```powershell
npm run migrate:rbac-raci-v2:dry-run
npm run migrate:cross-dept-handoff-v2:dry-run
npm run migrate:process-governance-unified:dry-run
npm run migrate:process-data-governance:dry-run
```

仅3000的运行操作使用独立入口，并先满足[发布与恢复](../../docs/plans/2026-09-09-mdm-3000-launch/03-发布与恢复.md)的目标环境、版本和授权条件。共同开发启动脚本同时涉及MDM、PMO和初始化，不是仅3000的发布入口：

```powershell
cd E:\CA001\Infomat\apps\mdm-platform
npm run service:start
npm run service:check
```

浏览器仅采用Edge100%、1699×828 CSS内容可视区，按当前入口核对登录、首次改密、管理员账号管理、只读角色责任页、角色可见标签、原生V9及受支持V8/V7案例与修订上传、双方核对、正式办理及角色范围。旧四工作区、承接故事链和旧冲突办理不再作为现行验收入口。3001单独核对首页与`/api/health`实际版本，保持独立运行。

第05阶段的`test:launch-stage05`在净化环境运行相关回归，再新建隔离MySQL和Edge合成办理验证。`test:stage05-mysql-isolated`、`test:process-preview-browser`及`test:process-formal-browser`可定向复验。实际证据及人工IME、真实历史数据和业务验收的限制见[整改与证据第11节](../../docs/plans/2026-09-09-mdm-3000-launch/02-整改与证据.md#11-第05阶段实际整改与证据2026-09-10)。

## 历史追溯

整理前原文、阶段记录和已废止说明保留在[历史快照](../../docs/archives/2026-10-09-leaf-docs/apps/mdm-platform/Tech-Spec.md.before.txt)。仅在核对决策依据、兼容或历史问题时读取；它不覆盖本文的当前说明。
