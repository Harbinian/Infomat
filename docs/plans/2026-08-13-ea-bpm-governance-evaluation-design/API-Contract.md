# 3000 EA/BPM 治理评价接口约定

> 状态：拟建设接口，当前服务不保证存在
> 版本：V1.0
> 日期：2026-08-13

## 1. 通用约定

- 所有接口使用3000现有认证会话和服务端权限校验。
- 写请求使用JSON，时间使用带时区的ISO 8601格式。
- 草稿相关写操作携带 `expected_revision`；不一致时返回409且不写入部分数据。
- 创建评价批次、问题处理和发布操作支持 `Idempotency-Key`。同一键和同一输入返回既有结果；同一键对应不同输入时返回409。
- 列表接口使用 `page`、`page_size`，默认20条，最大100条。
- 用户可见状态映射为“通过、待确认、需整改、阻断发布、不适用”，机器字段保持英文稳定值。

## 2. 规则读取

### `GET /api/governance-evaluations/rule-sets/current`

查询当前已发布规则版本和规则摘要。

查询参数：

- `stage=pre_publish|post_effective`；
- `include_rules=true|false`。

响应至少包含：

```json
{
  "rule_set_version": "ea-bpm-governance-v1",
  "stage": "pre_publish",
  "published_at": "2026-08-13T09:00:00+08:00",
  "rules": []
}
```

规则管理页面只读。第一阶段不提供浏览器新增、修改或删除规则接口。

## 3. 执行评价

### `POST /api/governance-evaluations/drafts/:draft_id/run`

对当前草稿修订执行发布前评价。

请求：

```json
{
  "expected_revision": 7,
  "rule_set_version": "ea-bpm-governance-v1"
}
```

服务端重新读取草稿、校验修订号和内容摘要。响应返回 `evaluation_batch_id`、逐项统计、当前总状态和问题卡编号。自动检查不得修改草稿。

### `POST /api/governance-evaluations/process-versions/:process_version_id/run`

对不可变流程版本执行生效后评价。请求可以指定经批准的 `evaluation_scope`，例如 `capability`、`application_support` 或 `data_governance`。未提供时执行全部适用规则。

### `POST /api/governance-evaluations/historical-batches`

创建历史回评批次。只有授权的全局治理角色可以执行。请求必须包含流程版本清单、选择依据和规则版本，不接受“全部历史流程”作为未说明范围。

## 4. 查询评价

### `GET /api/governance-evaluations/batches/:evaluation_batch_id`

返回批次输入摘要、规则版本、执行状态、逐项结果、总状态、失效原因和问题卡链接。

### `GET /api/governance-evaluations/process-versions/:process_version_id/history`

返回该流程版本的发布前快照、生效后评价和历史回评批次。历史结果只读。

### `GET /api/governance-evaluations/work-queue`

按当前身份返回需要处理或复核的事项。支持 `status`、`department_id`、`rule_code`、`due_before` 和 `stage` 过滤；服务端必须再次应用数据范围。

## 5. 处理和复核问题

评价问题继续使用3000现有问题卡资源。以下为拟增加的评价专用动作：

### `POST /api/process-governance/issues/:issue_id/remediation`

责任人提交处理结果。

```json
{
  "expected_issue_revision": 3,
  "action": "process_revised",
  "description": "已补充退回条件和返回位置。",
  "evidence_refs": ["EVD-000123"]
}
```

提交处理不关闭问题，只把问题送交相应复核角色。

### `POST /api/process-governance/issues/:issue_id/review`

复核人确认通过、退回或要求补充。服务端必须校验处理人与复核人不是同一人员，且复核人具有对象范围权限。

```json
{
  "expected_issue_revision": 4,
  "decision": "approved",
  "review_basis": "归口部门已确认补充内容与现行做法一致。"
}
```

跨部门问题必须分别记录各参与部门的确认；只有全部必需确认完成后，问题才能进入最终复核。

## 6. 证据记录

### `POST /api/governance-evidence`

新增证据元数据或具名确认记录。第一阶段不上传附件正文。

必填字段根据 `evidence_type`变化：

- 原文定位：`source_name`、`source_anchor`；
- 业务确认：`confirmer_person_id`、`confirmed_at`、`confirmation_summary`；
- 待补证据：`missing_reason`、`expected_provider_person_id|expected_provider_role`、`closure_condition`。

证据必须绑定流程版本、草稿修订或具体稳定对象引用。证据更新通过新增修订完成，不覆盖历史。

## 7. 发布后整改安排

### `POST /api/governance-evaluations/issues/:issue_id/post-release-remediation`

归口部门审核员提交发布后整改安排：

```json
{
  "responsible_person_id": 123,
  "due_at": "2026-09-15T18:00:00+08:00",
  "verification_method": "部门审核员核对新流程版本和原文定位。",
  "business_impact_confirmation": "不影响当前流程执行、责任边界和关键控制。"
}
```

### `POST /api/governance-evaluations/issues/:issue_id/post-release-remediation/review`

仅 `mdm_lead`在规则和权限允许时审核。阻断发布或事实未确认事项返回422，不创建放行记录。

## 8. 发布检查

### `POST /api/process-design/drafts/:draft_id/release-check`

请求必须包含 `expected_revision`、当前评价批次和内容摘要。响应返回：

- `release_allowed`；
- 当前总状态；
- 阻断问题编号；
- 待确认问题编号；
- 已审核的发布后整改项；
- 规则版本和评价时间。

发布接口必须在同一事务中重新执行等价门禁，不能只信任前端的检查结果。

## 9. 应用支撑关系

### `PUT /api/process-versions/:process_version_id/application-support/:behavior_ref`

请求字段：

```json
{
  "expected_revision": 2,
  "support_mode": "application",
  "application_name": "现行应用名称",
  "support_types": ["generate", "store"],
  "usage_description": "在该行为完成后保存经确认的记录。",
  "confirmation_basis": "EVD-000123"
}
```

`support_mode`取值为 `application`、`manual`、`no_application`。应用名称不得触发自动身份合并。

## 10. 能力关系和地图

### `PUT /api/process-versions/:process_version_id/capability-links/:capability_id`

归口部门提交主要支撑或共同支撑关系，MDM工作组完成跨流程一致性审核。关系在审核完成前只进入工作视图。

### `GET /api/capability-maps/work-view`

返回正式、待确认和未归类关系，并携带治理中标记。

### `POST /api/capability-maps/publish`

仅允许 `mdm_lead`发布已经审核的关系集合。请求包含待发布关系摘要；发布过程原子完成，失败时不产生部分版本。

## 11. 错误返回

| HTTP | `code` | 含义 |
|---:|---|---|
| 400 | `INVALID_EVALUATION_REQUEST` | 请求字段或规则版本不合法 |
| 401 | `AUTH_REQUIRED` | 未登录或会话失效 |
| 403 | `EVALUATION_SCOPE_FORBIDDEN` | 无权处理该部门或对象 |
| 404 | `EVALUATION_TARGET_NOT_FOUND` | 草稿、流程版本、问题或证据不存在 |
| 409 | `DRAFT_REVISION_CONFLICT` | 草稿修订号不一致 |
| 409 | `ISSUE_REVISION_CONFLICT` | 问题卡修订号不一致 |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | 同一幂等键对应不同输入 |
| 409 | `EVALUATION_STALE` | 评价批次与当前内容摘要不一致 |
| 422 | `RELEASE_BLOCKED` | 存在阻断发布事项 |
| 422 | `PENDING_CONFIRMATION_REMAINS` | 发布节点仍有待确认事项 |
| 422 | `POST_RELEASE_REMEDIATION_NOT_ALLOWED` | 事项不符合发布后整改条件 |
| 503 | `EVALUATION_SERVICE_UNAVAILABLE` | 评价依赖暂不可用，未写入部分数据 |

错误响应不得暴露SQL、文件路径、凭据、流程正文或敏感证据内容。
