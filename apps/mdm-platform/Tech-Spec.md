# MDM流程治理统一入口、身份与责任技术规格

## 1. 版本与边界

- 治理模型版本：`rbac-raci-v3-2026-07-31`
- 正式身份存储：MySQL
- 正式身份链路：`person -> user_accounts -> person_roles -> roles -> role_permissions -> permissions`
- 遗留`users/user_roles`和SQLite人员接口：仅保留隔离测试或一个版本的只读兼容，不参与正式授权

2026-09-09第02阶段已在应用入口实施MySQL运行边界：两种读模型及必要连接变量显式校验，旧SQLite路由在正式模式返回410，公共初始化只加载运行能力与部门。非production的显式遗留测试使用独立数据库路径；无正式回退。运行仓储的隐式初始化改为必要表列的只读探测，结构维护仍使用已有显式迁移。该探测不替代类型、索引、外键及迁移记录核验。维护命令、账号权限、历史数据去向及未验证项见[README](README.md#正式运行与结构维护分离)。V3/V7正文、状态与正式发布事务合同不变。

本规格改变流程治理入口、完整流程JSON草稿、V7预览核对、身份、授权、责任证据、3001格式适配、跨部门承接和承接冲突对象；不停止3001，不修改`docs/norms/`流程输入基线，也不重做数据地图和术语治理对象。

## 2. 组成模块

| 模块 | 文件 | 责任 |
|---|---|---|
| 固定治理模型 | `server/roleDefinitions.js` | 定义十九项权限、七个角色、十一项RACI活动、可见标签和模型版本 |
| 身份读取 | `server/identityMysqlRepository.js` | 从人员、账号和有效角色计算当前身份、权限和数据范围 |
| 账号与责任服务 | `server/governanceAccessMysqlRepository.js` | 账号生命周期、角色授权、访问审计、部门决定和发布责任核验 |
| 数据结构 | `server/mysqlSchema.js` | 身份、授权、审计、责任记录和迁移表 |
| 迁移 | `server/rbacRaciMysqlMigration.js` | 盘点、备份、固定模型写入、账号切换、回滚和补偿 |
| 身份接口 | `server/routes/accounts.js` | 管理员手工开户和账号生命周期接口 |
| 模型接口 | `server/routes/rbac.js` | 固定模型只读接口 |
| 责任接口 | `server/routes/governance.js` | 部门决定读取和追加接口 |
| 会话与中间件 | `server/auth.js` | 登录、会话校验、权限校验和首次改密限制 |
| 前端 | `public/index.html` | 四类流程治理工作区、故事链、V7预览核对、角色责任页、账号管理和角色可见标签 |
| v1/v2规范化 | `server/processGovernanceV2.js` | 结构校验、v1兼容、引用检查、治理提示和规范化内容哈希 |
| 承接迁移 | `server/crossDeptHandoffV2Migration.js` | 盘点、备份、v2字段和状态迁移、核对与补偿 |
| 统一入口迁移 | `server/processGovernanceUnifiedMigration.js` | 完整JSON、草稿修订、承接冲突和只追加事件的dry-run、迁移、回滚与补偿 |
| v3表单迁移 | `server/processGovernanceV3Migration.js` | 把草稿和发布版本中的v1/v2完整JSON无损规范化为v3，补表单状态、重算摘要并按批次备份和恢复 |
| 流程设计接口 | `server/routes/processDesignMysql.js` | 两阶段导入、事务写入、承接状态机、双方决定和发布卡口 |
| 角色工作台 | `server/routes/roleWorkbench.js` | 直接读取承接和冲突队列，并生成统一入口深链接 |
| V7预览核对 | `server/processV7PreviewReview*.js`、`server/routes/processV7PreviewReview.js` | 校验V7、生成固定跨部门核对项、隔离保存修订与部门结果，并保持预览边界 |
| V7迁移基线 | `server/processV7M0Baseline.js`、`scripts/inspect-process-v7-m0-baseline.js` | 只读核对正式三表、JSON摘要、引用关系和live schema差异 |
| V7正式基础迁移 | `server/processV7FormalMigration.js` | 以幂等DDL增加原生V7所需可空列、审核正文绑定和提升审计；不创建业务行 |
| 流程版本后续数据治理 | `server/processDataGovernance*.js`、`server/routes/processDataGovernance.js` | 精确版本范围、确定性待定候选、工作包状态、定向事实问题、来源摘要复核和审核卡口 |
| 后续数据治理迁移 | `server/processDataGovernanceMigration.js` | 六张专用表的dry-run、结构一致性检查、显式应用和空表回退 |

## 3. 授权计算

每次受保护请求按以下顺序处理：

1. 从会话取得`personId`、`accountId`和`authVersion`。
2. 读取`person`与`user_accounts`当前状态。
3. 比较会话`authVersion`和账号`auth_version`。
4. 读取当前日期有效、状态为`active`且包含授权依据的`person_roles`。
5. 只接受`roles.status='active'`且`roles.model_version`等于当前模型版本的七个固定角色。
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

第05阶段将会话专用池的等待队列限定为最多32个请求，保留默认2连接及原有整体超时。该时限包含排队、取得连接和SQL操作；到期后返回失败，延迟取得的连接销毁，不自动重试业务提交。就绪专用池继续不排队。该修改解决合成浏览器正常并发读取时的满池失败，不代表正式并发容量已经验收。

## 5. 固定角色与范围

- `admin`、`mdm_lead`、`data_quality_auditor`为全局范围。
- `department_contact`、`department_mdm_reviewer`为人员所属部门范围。
- `data_conflict_handler`为本人被分派事项范围。
- `decision_group`为已升级事项范围。
- 跨部门临时代办使用独立委托关系，不改变永久角色范围。

非七个固定角色全部转为`retired`并删除有效权限关联。旧角色不自动映射到新角色。

## 6. 写入事务

以下操作必须在单一MySQL事务中完成：

- 创建人员、待启用账号、初始角色授权和访问审计。
- 部门变更、旧部门角色撤销、新部门角色授予、`auth_version`递增和审计。
- 角色授予或撤销、账号必要状态变化、`auth_version`递增和审计。
- 账号启用、恢复、停用、密码重置和审计。
- 部门决定追加及被替代记录关联。
- 3001审核导入的草稿、流程、行为、承接修订、参与关系、事件和导入审计。

事务失败时不保留部分账号、部分授权或部分责任记录。

## 7. 数据结构

身份字段见[RBAC-RACI-DB-Schema.md](docs/RBAC-RACI-DB-Schema.md)，承接字段见[Cross-Department-Handoff-DB-Schema.md](docs/Cross-Department-Handoff-DB-Schema.md)。关键变化如下：

- `roles`增加状态、分组、核心标记和模型版本。
- `person_roles`增加范围、部门、授权依据、有效期、状态和撤销信息。
- `user_accounts`使用`pending_activation`、`active`、`locked`、`disabled`，并保存`must_change_password`和`auth_version`。
- `identity_access_events`只追加账号与授权事件，不保存明文密码或密码散列。
- `governance_decision_records`只追加部门责任决定。
- `identity_migration_*`表保存迁移批次和恢复所需快照。
- `process_design_cross_dept_handoffs`统一保存前置输入和后续承接，并以`handoff_ref`、候选哈希、修订号和当前标记保留历史。
- `process_design_structured_imports`保存受控导入、审核依据、规范化JSON和内容哈希。
- `process_design_drafts.process_content_json`保存完整v3 JSON真源；`revision_no`和`content_hash`用于乐观并发与内容核对。
- `process_design_handoff_conflicts`保存承接冲突当前状态和协调方案。
- `process_design_handoff_events`只追加承接、冲突和项目决策事件。
- `process_v7_preview_cases`、`process_v7_preview_revisions`、`process_v7_preview_review_items`和`process_v7_preview_events`只保存V7预览核对，不引用或写入正式流程版本。
- 保存完整v3 JSON时，同一数据库事务同步流程、业务行为、承接候选修订和事件。投影同步失败时回滚JSON修订，不形成半套治理事实。
- 删除已有治理记录的承接必须提交`handoff_ref`和作废原因；历史承接只取消当前标记，不物理删除。
- `process_data_governance_*`六张专用表只保存固定流程版本绑定、待定候选、MDM结论、定向事实答复、审核和事件，不复制完整V7正文。工作包以`process_version_id`唯一，所有写操作共享`revision_no`。

## 8. 接口

身份接口见[RBAC-RACI-API-Contract.md](docs/RBAC-RACI-API-Contract.md)，承接接口见[Cross-Department-Handoff-API-Contract.md](docs/Cross-Department-Handoff-API-Contract.md)。

核心接口：

- `GET /api/rbac/model`
- `GET|POST /api/org/accounts`
- `GET|PATCH /api/org/accounts/:personId`
- `POST /api/org/accounts/:personId/role-assignments`
- `POST /api/org/accounts/:personId/role-assignments/:assignmentId/revoke`
- `POST /api/org/accounts/:personId/activate|enable|disable|reset-password`
- `GET|POST /api/governance/decision-records`
- `GET /api/org/me`
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

1. 当前用户拥有`governance:record-department-decision`。
2. 当前用户具有该部门有效`department_mdm_reviewer`授权。
3. 部门与人员状态有效。
4. `departments.final_responsible_person_id`存在且指向有效人员。
5. 决定值、对象、版本、依据和决定时间有效。

`assertGovernancePublishReady`在发布前完成：

1. 对象和版本明确。
2. 所有必需部门均有最新`approved`决定。
3. 必需部门责任人完整。
4. 阻断问题数量为零。
5. 结构检查通过。
6. 版本检查通过。

MDM工作组组长只能在卡口通过后发布，不能以角色权限跳过部门决定。

### 9.1 承接状态与决定

承接状态依次覆盖分派、归口审核、外部门范围确认、外部门补充、外部门审核和结构卡口，并使用`returned`表示退回上一责任步骤、`conflict_open`表示存在未关闭冲突。历史`rejected`迁移为待分派冲突，历史`escalated`迁移为待项目决策。每个写接口在通用权限之外继续校验固定角色、参与人、部门、`can_act`、当前修订、对象状态和事项关联。

双方决定写入`governance_decision_records`，`subject_type='cross_dept_handoff'`，`subject_version`为候选内容哈希。最终责任人从决定发生时当前部门表读取。承接待办直接从承接状态和参与关系生成，不通过问题池复制业务事实。

### 9.2 完整流程JSON与并发

- MDM接受`process-governance-v1`、`process-governance-v2`和`process-governance-v3`，在服务端规范化后统一保存和导出v3。v1、v2表单只补`form_design_state=unspecified`，不推断现状或拟设计状态。
- 本地流程编辑器按整张纸质表单同时渲染全部字段。字段归属变化只在`forms[].areas[].items[]`之间移动同一字段对象；字段级不保存重复归属值，MDM也不创建与主表或明细表一一对应的物理数据库表。
- `form_design_state`允许`current_state`、`proposed_design`和兼容迁移使用的`unspecified`。主表标题不参与提示和评分；多张明细表合法；多张明细表中的空标题逐张形成可定位业务提示。
- `process_content_json`是编制内容真源，承接及待办表是治理投影。
- 保存请求必须携带`expected_revision`。更新语句同时匹配`id + revision_no`，不匹配时返回`409 DRAFT_REVISION_CONFLICT`。
- 内容哈希未变化时不增加修订号；变化时增加修订并更新时间、更新人和哈希。
- 浏览器不使用`localStorage`或`sessionStorage`保存业务内容。

### 9.3 V7预览核对隔离

- V7通过`/api/process-v7-preview`进入专用案例，不经过正式V3导入、草稿或发布接口。
- 服务端加载V1至V7完整规则链校验文件，按归口部门和固定执行部门生成核对项。不能识别部门时只返回提示，不推测业务事实。
- 新修订以`process_ref`、内容摘要、核对项稳定标识和核对内容摘要进行并发与变化判断。未变化项沿用双方结果，变化项重新打开。
- 部门核对写入同时校验权限、当前人员部门、核对方和修订号。管理员不得执行写操作。
- 运行时路由不得自动建表；数据库结构只能通过空库初始化或明确授权的迁移命令建立。
- `PROCESS_V7_PREVIEW_ENABLED`和`PROCESS_V7_FORMAL_ENABLED`默认关闭。M0、M1、M2及相应接口门禁通过后，只能在受控试点运行实例开启；本机技术验收开启不等于向全部流程开放。
- V7提升事务按预览案例、当前修订、目标主档、活动草稿的顺序加锁；相同修订和摘要使用提升审计唯一约束保证幂等。
- V7审核任务保存`draft_revision_no`和`content_hash`。审核或发布发现绑定过期时返回409，不允许旧结论覆盖当前正文。
- V7发布事务按草稿、主档、当前版本、审核任务的顺序加锁。发布版本不填伪造的L1、L2、L3或V3投影，成功响应返回`process_version_id`。
- `GET /api/process-design/versions/:processVersionId/content`只从不可变正式版本读取完整正文，并对V7重新计算摘要；正式下游不得读取预览案例。
- 3001与3000共同调用仓库内无网络、数据库和浏览器副作用的V7校验入口；预览上传、后续提升和发布三个信任边界都必须重新验证。

### 9.4 V7工作台与编辑会话

- `GET /api/role-workbench`复用案例、当前核对项、提升记录、正式草稿和审核任务进行只读聚合。预览核对、退回修改、范围核对、提升、提交、正式审核和待发布任务使用原对象ID、修订和内容摘要，不新增任务表或通用任务引擎。
- 可变MySQL工作台响应不再使用15秒缓存，并返回`Cache-Control: no-store`；静态角色说明仍可缓存。办理完成的事项在下一次读取消失，受修订影响的核对事项重新出现；范围决定只有尚未解除的卡口进入待办。
- 多角色任务保留来源角色和所需权限，部门范围及状态规则复用V7详情投影；管理员叠加业务角色仍只读。查询失败向上返回503，前端显示不可用并清除旧动作，不能转换成空列表。
- `public/index.html`的V7编辑会话以当前人员、案例及修订绑定页面内存字段。核对项按稳定键恢复；保存只清除该提交组内与请求快照一致的输入，其他项及请求期间新输入的值保留。没有自动保存、长期浏览器缓存或服务端草稿表。
- 切换案例/工作区、上传和退出需要明确处理未提交输入；刷新/关闭使用原生离页提示。401后同人重新登录可恢复当前页面内存；409保留原意见，读取并人工核对当前修订后才允许继续。旧项消失时保留只读原文，不推断迁移到其他业务项。
- 正式审核结论为空起始值。页面只呈现办理人主动填写的意见，未预选批准、代写部门意见或认定主数据。四个工作区、V3/V7正文格式、写接口及正式事务模型不变；只读响应增量字段见[V7接口约定](docs/Process-V7-Preview-Review-API-Contract.md)。

### 9.5 流程版本后续数据治理

- `PROCESS_DATA_GOVERNANCE_ENABLED`默认关闭；`PROCESS_DATA_GOVERNANCE_TRIAL_PROCESS_VERSION_ID`只接受一个正整数正式版本标识。
- `PROCESS_DATA_GOVERNANCE_READ_ONLY`缺省或`0`保留原办理模式；`1`关闭所有工作包写入口，仅按原权限查阅准确版本的`completed`工作包及定向事实。总开关关闭仍返回不可用；只读参数非法返回`PROCESS_DATA_GOVERNANCE_READ_ONLY_INVALID`，ready为不可用。该配置不改变表结构、既有数据、角色、审批状态或默认启用策略。
- `/status`及工作台`feature`增量返回`read_only`布尔值。只读模式的`allowed_actions`只有`view`，工作包待办为空；工作台仅返回已完成包，部门事实列表包含该包中本部门已关闭的记录。未完成详情返回`PROCESS_DATA_GOVERNANCE_COMPLETED_ONLY`；所有写方法返回409及`PROCESS_DATA_GOVERNANCE_READ_ONLY`，在路由和每个仓储写入口操作数据库前拒绝，包含发布事务调用的创建任务函数。
- 只读页面显示已存治理结论、判断依据、责任部门和统一对象标识；不生成编辑控件，不修改空值或历史内容。正式版本正文仍复用`GET /api/process-design/versions/:processVersionId/content`及原有权限、摘要校验；部门收到事实问题不自动取得完整正式版本或MDM工作包权限。结束方案另须关闭V7写开关，该参数不是全平台只读开关。
- 正式V7发布只有在功能已启用且新版本标识与试点配置完全相等时，才在同一事务记录唯一创建任务。已有正式版本由`mdm_lead`通过公开补偿接口显式补建。
- 候选规则只读取V7结构，使用单值`behavior_links[].operation`。每个已声明字段进入关键字段判断；字段、数据流或生命周期范围为空时生成范围缺失待定项。
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

最低验证入口：

```powershell
npm run test:rbac-raci-v2
npm run test:frontend
npm run test:project-roles
npm run test:role-workbench
npm run test:process-data-governance
npm run test:process-governance
npm run test:process-governance-unified
npm run test:mainline
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

浏览器至少核对登录页、首次改密、管理员账号管理、只读角色责任页、角色可见标签、多角色标签并集、四个流程治理工作区、V7案例与修订上传、双方部门核对、承接故事链、冲突处理、管理员业务写按钮不可用和代表性角色的数据范围。3001继续单独验证首页和`/api/health`，不得因MDM上线而停止。

第05阶段的`test:launch-stage05`在净化环境运行相关回归，再新建隔离MySQL和Edge合成办理验证。`test:stage05-mysql-isolated`与`test:stage05-browser`可定向复验。实际证据及人工IME、真实历史数据和业务验收的限制见[整改与证据第11节](../../docs/plans/2026-09-09-mdm-3000-launch/02-整改与证据.md#11-第05阶段实际整改与证据2026-09-10)。
