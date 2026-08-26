# V7预览核对接口约定

基础路径：`/api/process-v7-preview`

所有接口要求用户已登录。写接口继续使用3000现有CSRF保护、人员身份、部门范围和固定权限。

预览和正式写接口还要求运行实例配置一个精确的`PROCESS_V7_TRIAL_PROCESS_REF`。该配置只接受一个符合V7技术标识规则的`process_ref`，不接受列表、`*`、前缀或正则匹配。只读接口不受该配置限制。

JSON请求正文上限为2MB。接口不接受文件路径或任意数据库查询，只接收用户浏览器上传并解析后的V7 JSON。

## 1. 案例与修订

| 方法与路径 | 用途 | 主要权限 |
|---|---|---|
| `GET /cases` | 查询当前人员可以查看的案例和本人待核对数量 | 治理材料读取权限 |
| `POST /cases` | 上传V7文件并建立预览案例 | `governance:draft-department`或`governance:assign-work` |
| `GET /cases/:id` | 查看当前修订、只读V7预览、核对项和操作记录 | 案例参与部门或全局读取权限 |
| `POST /cases/:id/revisions` | 上传3001修改后的新修订 | 归口部门`governance:draft-department`或`governance:assign-work` |
| `POST /cases/:id/revisions/preview` | 只读比较拟上传修订与当前修订 | 与正式上传相同；取消后不写数据库 |
| `POST /cases/:id/assign-owner` | 为归口部门待定的案例选择有效部门 | `governance:assign-work` |
| `POST /cases/:id/scope-decision` | 记录归口变化或零跨部门范围决定 | `mdm_lead`且具有`governance:assign-work` |
| `GET /cases/:id/formal-targets?document_no=...` | 按完整制度编号精确查找可承接的已有主档 | `mdm_lead`且具有`governance:assign-work` |
| `POST /cases/:id/promote` | 把核对完成的当前修订提升为原生V7正式草稿 | `mdm_lead`且具有`governance:assign-work`；正式开关已开启 |

上传正文：

```json
{
  "source_file_name": "未审核-待确认部门-示例流程-最终待核对-20260824.json",
  "document": {},
  "expected_revision_no": 1
}
```

建立案例时不传`expected_revision_no`。上传新修订必须同时传当前`expected_revision_no`和`expected_content_hash`。

`assign-owner`和`scope-decision`的请求携带修订号、内容摘要和用户选择，不携带可信的核对项投影。仓储在同一事务内按“预览案例 → 当前修订 → 当前核对项（按`id`升序）”锁定并重读，再读取当前有效部门，根据锁定修订的`content_json`重新校验和生成投影。路由事务外的投影只用于提前反馈，不作为写入依据。`accept_source_owner`只有在锁后重新投影能够解析有效归口部门，并且已解除归口部门变化卡口时才能写入。

## 2. 部门核对

`POST /items/:id/decision`

```json
{
  "decision": "confirmed",
  "basis": "已依据当前表单和实际办理方式核对",
  "expected_revision_no": 1,
  "expected_content_hash": "64位SHA-256"
}
```

`decision`只允许：

- `confirmed`：已确认；
- `needs_changes`：需要修改；
- `pending_evidence`：待补证据；
- `disputed`：存在分歧。

3000根据当前人员所在部门判断记录归口部门结果还是承接部门结果，不接受客户端指定核对方。

新修订先调用`POST /cases/:id/revisions/preview`。该接口返回新增、沿用、重新打开、移除和受影响部门，不创建修订、核对项或事件。用户确认后再调用正式上传接口。

每条核对项的`item_snapshot.digest_version`固定为`process-v7-review-item-v2`。摘要包含完整业务行为、相连流程关系、相连数据对象及其字段和生命周期、相连表单及其操作、区域和字段。系统按稳定技术标识排序无序数组；只改变数组排列或无关对象时，核对项摘要不变。相关内容变化、旧核对项缺少`digest_version`或摘要版本不一致时，系统把双方结果重置为`pending`，并把`carry_state`设为`reopened`。

## 3. 受控提升与正式接口

提升请求必须明确选择新建主档或已有主档。系统不按流程名称、制度名称或近似编号自动匹配。

新建主档：

```json
{
  "expected_revision_no": 2,
  "expected_content_hash": "64位SHA-256",
  "target": {
    "mode": "create",
    "document_no": "受控制度编号",
    "document_title": "受控制度名称"
  }
}
```

已有主档：

```json
{
  "expected_revision_no": 2,
  "expected_content_hash": "64位SHA-256",
  "target": {
    "mode": "existing",
    "document_id": 123
  }
}
```

提升时，服务端重新校验V7正文、当前有效部门、未解决卡口、案例状态、当前修订号、内容摘要、`process_ref`、归口部门和目标主档。路由完成检查后，仓储在事务内锁定案例，再次检查功能开关、精确试点范围和未解决卡口。相同案例修订和摘要重复提升时，接口返回原主档和原草稿，不创建第二份记录。正式草稿的V7正文在3000中只读；内容需要修改时，编制人员必须回到3001修改并上传新修订。已发布V7主档也不能使用通用下一版草稿或旧结构化导入入口生成V3草稿；路由层和仓储层均执行该门禁。正式草稿处于`draft`或`needs_changes`时，新修订完成预览核对后可以受控重新提升到同一草稿；已经提交、审核通过、拒绝或发布时不能覆盖。

`ZERO_CROSS_DEPARTMENT_SCOPE_PENDING`只能由`confirmed_no_cross_department`解除；`OWNING_DEPARTMENT_CHANGE_PENDING`只能在保留当前归口部门，或按源文件归口部门重新投影成功后解除；`ACTOR_DEPARTMENT_UNRESOLVED`不能通过范围决定解除。任一未解决卡口都会阻止提升。正式审核阶段出现卡口时，系统禁止审核通过，但保留“需要修改”和“拒绝”处理入口。

正式链路复用现有接口：

| 方法与路径 | 用途 | V7附加门禁 |
|---|---|---|
| `POST /api/process-design/drafts/:id/submit` | 提交正式审核 | 重新校验提升证据；审核任务绑定修订号和内容摘要 |
| `POST /api/process-design/review-tasks/:id/decision` | 记录正式审核结论 | 审核任务必须仍绑定当前修订号和内容摘要 |
| `POST /api/process-design/drafts/:id/publish` | 发布原生V7正式版本 | 草稿已审核通过；重新校验V7、提升证据、版次、当前版本指针和审核摘要 |
| `GET /api/process-design/versions/:processVersionId/content` | 读取不可变正式版本正文 | 按当前身份和部门范围读取；V7重新计算并返回摘要核对结果 |
| `PUT /api/process-design/drafts/:id/content` | 修改正式草稿正文 | V7固定返回`409 V7_CONTENT_READ_ONLY` |
| `POST /api/process-design/documents/:id/drafts` | 通过通用入口创建下一版草稿 | 当前主档或正式版本为V7时返回`409 V7_CONTENT_READ_ONLY` |
| `POST /api/process-design/import-structured-output` | 导入旧`document-structured-output-v2` | 目标主档或正式版本为V7时返回`409 V7_CONTENT_READ_ONLY` |

V7的提交、审核和发布请求必须同时携带用户当前页面显示的修订号和内容摘要。三个请求的主要字段如下：

```json
{
  "expected_revision_no": 2,
  "expected_content_hash": "64位SHA-256",
  "decision": "approve",
  "note": "已核对当前修订"
}
```

`decision`只用于审核请求，允许`approve`、`needs_changes`或`reject`；`note`按对应操作传入。服务端先核对正式开关、精确试点范围、管理员只读规则、人员权限和两个必填字段，再调用状态变更方法。HTTP请求中的其他字段不会透传为仓储选项。`draft`或`needs_changes`可以提交为`submitted`；`submitted`或`under_review`可以审核为`approved`、`needs_changes`或`rejected`；只有`approved`可以发布为`published`。

事务内按“预览案例 → 当前修订 → 最新提升记录 → 流程主档 → 当前正式版本 → 正式草稿 → 审核任务（按标识升序）”锁定并重读。完成业务对象锁定后，服务端还使用同一数据库连接重读当前账号、`auth_version`、人员状态、所属部门、有效角色、角色范围和权限。管理员、授权版本变化或角色范围不符合时，事务在写入前回滚。草稿状态、修订号、内容摘要和主档当前版本指针都通过条件更新再核对；状态变更和操作事件在同一事务中提交或回滚。提交、审核通过和发布会按当前有效部门重新投影V7正文，并只阻断尚未由合法范围决定解除的卡口。`needs_changes`和`reject`用于收敛风险，即使当前仍有卡口也可以记录，但仍必须通过权限、任务绑定和条件更新检查。

V7发布成功时返回`process_version_id`。后续治理对象只能绑定该不可变标识，不得在运行时读取预览案例或原始3001文件。

## 4. 固定响应边界

案例和详情响应必须包含：

```json
{
  "preview_only": true,
  "publishable": false,
  "formal_process_version_id": null
}
```

提升接口不再属于预览响应，固定返回`preview_only=false`、正式主档标识和正式草稿标识；只有发布成功后才返回非空`process_version_id`。

案例详情中的正式承接状态只返回主档、草稿、审核任务和版本元数据，不返回正式草稿或正式版本的完整正文。完整正式正文只能通过`GET /api/process-design/versions/:processVersionId/content`按权限读取。

常见错误：

| 状态码 | code | 含义 |
|---|---|---|
| 409 | `V7_PREVIEW_REVISION_CONFLICT` | 当前案例已经上传新修订，用户需要刷新后重试 |
| 409 | `V7_PREVIEW_ITEM_SUPERSEDED` | 当前核对项已经被新修订替代 |
| 409 | `V7_PREVIEW_CONTENT_HASH_CONFLICT` | 当前案例内容摘要已经变化，必须刷新后重试 |
| 409 | `V7_PREVIEW_REVIEW_INCOMPLETE` | 当前修订尚未完成预览核对，不能提升 |
| 409 | `V7_PREVIEW_BLOCKING_ISSUES` | 当前有效部门重新投影后仍有未解决卡口，不能提升 |
| 409 | `V7_FORMAL_DRAFT_LOCKED` | 目标主档已有不能覆盖的进行中草稿 |
| 409 | `V7_REVIEW_CONTENT_STALE` | 审核或发布依据的修订号、内容摘要已经过期 |
| 409 | `V7_FORMAL_PROMOTION_EVIDENCE_MISMATCH` | 预览案例、当前修订、提升记录、正式草稿或内容摘要的绑定不一致 |
| 409 | `V7_FORMAL_DRAFT_STATE_CONFLICT` | 当前草稿状态不允许该正式操作 |
| 409 | `REVIEW_TASK_ALREADY_DECIDED` | 该审核任务已经记录结论 |
| 409 | `V7_FORMAL_BASE_VERSION_CONFLICT` | 主档当前版本指针或计划版次已变化 |
| 409 | `V7_FORMAL_BLOCKING_ISSUES` | 提交、审核通过或发布时仍有未解决卡口 |
| 409 | `V7_CONTENT_READ_ONLY` | 不能在3000直接改写正式V7正文，也不能为V7主档创建通用V3下一版或通过旧结构化导入覆盖 |
| 422 | `V7_FORMAL_EXPECTED_REVISION_REQUIRED` | 未传入有效的当前修订号 |
| 422 | `V7_FORMAL_EXPECTED_CONTENT_HASH_REQUIRED` | 未传入有效的64位内容摘要 |
| 422 | `V7_PREVIEW_CONTENT_INVALID` | 文件不是有效V7或缺少必要稳定引用 |
| 422 | `V7_PREVIEW_BASIS_REQUIRED` | 核对依据为空 |
| 422 | `V7_PREVIEW_BASIS_TOO_LONG` | 核对依据超过4000字 |
| 422 | `V7_PREVIEW_OWNER_PENDING_REQUIRES_LEAD` | V7未明确归口部门，必须由MDM工作组组长建立并分派案例 |
| 403 | `V7_PREVIEW_SCOPE_DENIED` | 当前人员不是案例参与部门或没有所需权限 |
| 403 | `V7_PREVIEW_ADMIN_READ_ONLY` | 管理员只能查看治理材料，不能执行预览或正式写操作 |
| 403 | `V7_FORMAL_ADMIN_READ_ONLY` | 事务内重读角色后确认当前人员为管理员，拒绝正式写操作 |
| 403 | `V7_FORMAL_ACTOR_SCOPE_DENIED` | 事务内重读的角色、部门范围或权限不允许当前正式操作 |
| 401 | `SESSION_AUTHORIZATION_CHANGED` | 账号、人员状态或`auth_version`已变化，需要重新登录 |
| 401 | `V7_FORMAL_ACTOR_CONTEXT_REQUIRED` | 服务端内部调用未携带受控的当前操作人上下文 |
| 403 | `V7_TRIAL_PROCESS_SCOPE_DENIED` | 当前流程不是运行实例获批的单流程试点对象 |
| 503 | `V7_TRIAL_SCOPE_NOT_CONFIGURED` | 运行实例没有配置合法且唯一的试点`process_ref` |
| 503 | `V7_FORMAL_DISABLED` | 原生V7正式功能开关未开启 |

`V7_REVIEW_CONTENT_STALE`、`V7_FORMAL_PROMOTION_EVIDENCE_MISMATCH`、`V7_FORMAL_DRAFT_STATE_CONFLICT`和`V7_FORMAL_BASE_VERSION_CONFLICT`只附带`actual_status`、`actual_revision_no`和`actual_content_hash`三项当前状态，不返回问题正文、数据库信息或文件路径。`V7_FORMAL_BLOCKING_ISSUES`只返回`error`和`code`。

## 5. 功能开关与当前边界

- `PROCESS_V7_PREVIEW_ENABLED`默认关闭；关闭时本路由返回`503 V7_PREVIEW_DISABLED`。
- `PROCESS_V7_FORMAL_ENABLED`默认关闭。M0、M1、M2和正式接口技术门禁通过后，只能在受控试点环境开启。
- `PROCESS_V7_TRIAL_PROCESS_REF`默认不配置。预览或正式开关开启但该配置缺失、含通配符或不符合技术标识规则时，所有写接口返回`503 V7_TRIAL_SCOPE_NOT_CONFIGURED`；流程不匹配时返回`403 V7_TRIAL_PROCESS_SCOPE_DENIED`。路由和仓储分别检查，仓储以锁定后的案例`process_ref`为准。
- 案例详情中的`allowed_actions`和`formal_allowed_actions`只提示当前能够执行的动作。正式开关关闭或流程越界时，`formal_allowed_actions`最多包含`view_formal_draft`和`read_formal_version`。待处理审核任务通过`formal_allowed_decisions`返回当前可选结论：卡口存在时只返回`needs_changes`和`reject`，没有卡口时才返回`approve`、`needs_changes`和`reject`。前端审核下拉框只渲染该字段中的结论，不自行补充“审核通过”。
- 截至2026-08-26，正式库M1、M2结构已准备，当前只读检查确认迁移记录与目标结构一致，V7业务记录仍为0。历史事后演练不替代本次代码对应的隔离验收。本轮未启动3000、未开启两个V7开关，也未配置试点`process_ref`；新的全库备份恢复、隔离MySQL验收和真实脱敏流程试点均待分别批准。
- `review_complete`只允许进入受控提升，不表示正式审核或发布完成。只有本次代码对应的隔离验收通过后，才能记录相应技术验收结论；只有有效业务角色完成真实脱敏单流程试点后，才能记录该`process_ref`的业务验收结论。
