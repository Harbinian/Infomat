# V7预览核对接口约定

基础路径：`/api/process-v7-preview`

所有接口要求用户已登录。写接口继续使用3000现有CSRF保护、人员身份、部门范围和固定权限。

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

提升时，服务端重新校验V7正文、案例状态、当前修订号、内容摘要、`process_ref`、归口部门和目标主档。相同案例修订和摘要重复提升时，接口返回原主档和原草稿，不创建第二份记录。正式草稿的V7正文在3000中只读；内容需要修改时，编制人员必须回到3001修改并上传新修订。正式草稿处于`draft`或`needs_changes`时，新修订完成预览核对后可以受控重新提升到同一草稿；已经提交、审核通过、拒绝或发布时不能覆盖。

正式链路复用现有接口：

| 方法与路径 | 用途 | V7附加门禁 |
|---|---|---|
| `POST /api/process-design/drafts/:id/submit` | 提交正式审核 | 重新校验提升证据；审核任务绑定修订号和内容摘要 |
| `POST /api/process-design/review-tasks/:id/decision` | 记录正式审核结论 | 审核任务必须仍绑定当前修订号和内容摘要 |
| `POST /api/process-design/drafts/:id/publish` | 发布原生V7正式版本 | 草稿已审核通过；重新校验V7、提升证据、版次、当前版本指针和审核摘要 |
| `GET /api/process-design/versions/:processVersionId/content` | 读取不可变正式版本正文 | 按当前身份和部门范围读取；V7重新计算并返回摘要核对结果 |
| `PUT /api/process-design/drafts/:id/content` | 修改正式草稿正文 | V7固定返回`409 V7_CONTENT_READ_ONLY` |

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
| 409 | `V7_FORMAL_DRAFT_LOCKED` | 目标主档已有不能覆盖的进行中草稿 |
| 409 | `V7_REVIEW_CONTENT_STALE` | 审核或发布依据的修订号、内容摘要已经过期 |
| 409 | `V7_CONTENT_READ_ONLY` | 不能在3000直接改写正式V7正文 |
| 422 | `V7_PREVIEW_CONTENT_INVALID` | 文件不是有效V7或缺少必要稳定引用 |
| 422 | `V7_PREVIEW_BASIS_REQUIRED` | 核对依据为空 |
| 422 | `V7_PREVIEW_BASIS_TOO_LONG` | 核对依据超过4000字 |
| 422 | `V7_PREVIEW_OWNER_PENDING_REQUIRES_LEAD` | V7未明确归口部门，必须由MDM工作组组长建立并分派案例 |
| 403 | `V7_PREVIEW_SCOPE_DENIED` | 当前人员不是案例参与部门或没有所需权限 |
| 403 | `V7_PREVIEW_ADMIN_READ_ONLY` | 管理员只能查看治理材料，不能执行预览或正式写操作 |
| 503 | `V7_FORMAL_DISABLED` | 原生V7正式功能开关未开启 |

## 5. 功能开关与当前边界

- `PROCESS_V7_PREVIEW_ENABLED`默认关闭；关闭时本路由返回`503 V7_PREVIEW_DISABLED`。
- `PROCESS_V7_FORMAL_ENABLED`默认关闭。M0、M1、M2和正式接口技术门禁通过后，只能在受控试点环境开启。
- 截至2026-08-25，正式库M1、M2已应用且目标结构匹配，V7业务记录仍为0。本机3000仅为技术验收开启两个开关，不表示已向全部流程开放。
- `review_complete`只允许进入受控提升，不表示正式审核或发布完成。真实脱敏流程尚未由有效业务角色完成试点时，只能报告技术链路通过、业务验收待完成。
