# 流程版本后续数据治理接口约定

## 1. 公共约定

接口前缀为`/api/process-data-governance`，使用3000现有登录会话。除`GET /status`外，功能默认关闭；未同时配置启用开关和唯一试点版本时返回503。

所有写接口继续执行服务端权限、精确`process_version_id`范围、对象状态、来源摘要和乐观并发检查。请求中的角色、部门或允许操作列表均不作为授权凭证。

## 2. 状态和责任

### `GET /status`

已登录且有治理读取权限的用户均可调用。即使功能关闭也返回当前配置状态，供前端决定是否显示入口。

响应包含：

- `enabled`：功能是否有效。
- `configured_process_version_id`：唯一试点版本；未配置时为`null`。
- `scope_mode`：启用时为`exact_process_version_id`。
- `responsibilities`：业务部门、MDM工作组和系统自动处理边界。

## 3. 工作台

### `GET /workbench?mode=todo|all`

返回当前人员可以读取的工作包摘要、发给本人所属部门的事实问题以及角色工作台事项。

- 业务部门只得到本部门事实问题，不得到工作包全量明细。
- `admin`可以读取全局摘要，但不产生可执行事项。
- `mdm_lead`得到试点工作包事项。

## 4. 创建与补偿

### `POST /creation-tasks/reconcile`

仅允许有治理分派和结构卡口权限的`mdm_lead`调用。

请求：

```json
{
  "process_version_id": 77
}
```

版本标识必须与服务端配置的唯一试点标识完全相等，且指向不可变的V7正式版本。重复调用返回同一创建任务和工作包，并标明`idempotent=true`。

## 5. 工作包读取

### `GET /work-packages/:id`

只有全局治理读取范围可以读取。响应包含：

- 工作包摘要和当前修订号；
- 固定来源版本摘要；
- 待治理明细及对应V7来源事实；
- 定向业务事实问题；
- MDM审核记录和最近操作事件；
- 当前人员允许执行的动作。

业务部门调用时返回403，避免把MDM判断任务重新交给普通用户。

## 6. 候选和治理判断

### `POST /work-packages/:id/generate-candidates`

请求：

```json
{
  "expected_revision": 1
}
```

系统只按工作包记录的固定规则版本生成`pending_confirmation`候选，不自动确认。重复生成不覆盖已存在明细。

### `PATCH /work-packages/:id/details/:detailId`

请求：

```json
{
  "expected_revision": 2,
  "status": "confirmed",
  "responsible_department_id": 10,
  "governance": {
    "conclusion": "MDM工作组记录的治理结论",
    "basis": "采用的流程事实、业务答复或治理规则依据"
  }
}
```

可提交状态为`pending`、`confirmed`、`not_applicable`或`terminated`。最终状态必须填写`governance.basis`。需要业务事实时不得通过本接口直接设置`needs_business_fact`，必须建立具体问题。

## 7. 定向业务事实

### `POST /work-packages/:id/fact-requests`

仅允许MDM工作组提出。

```json
{
  "expected_revision": 3,
  "detail_id": 81,
  "target_department_id": 10,
  "requested_fact_type": "trigger_condition",
  "question_text": "这项操作在实际业务中由什么条件触发？",
  "request_reason": "该事实会影响生命周期触发规则"
}
```

目标部门必须存在且有效。同一明细同时最多有一个`open`或`answered`问题。

### `GET /fact-requests/:id`

全局治理读取角色可以读取；非全局用户只有所属部门与目标部门一致时才能读取。响应只包含该问题、固定版本中与问题对应的最小来源上下文和职责提示，不返回整个工作包。

### `POST /fact-requests/:id/respond`

只有目标部门的`department_contact`或`department_mdm_reviewer`可以答复。

```json
{
  "expected_revision": 4,
  "answer_text": "业务事实答复；不适用时写明实际原因",
  "evidence_ref": "制度、表单或台账中的可核对位置"
}
```

`answer_text`必填。`evidence_ref`有来源时填写；系统不要求业务人员作主数据或生命周期判断。

### `POST /fact-requests/:id/close`

只有MDM工作组可以关闭已答复问题。

```json
{
  "expected_revision": 5,
  "basis": "说明答复是否采用，以及它如何影响MDM判断"
}
```

关闭后对应治理明细回到`pending`，由MDM工作组形成结论。

## 8. 完成审核

### `POST /work-packages/:id/complete`

仅允许同时具有`mdm_lead`写权限和`governance:publish`的人员调用。

```json
{
  "expected_revision": 8,
  "basis": "MDM工作组完成审核的依据"
}
```

以下任一情况阻断完成：

- 尚未生成治理明细；
- 任一明细仍为`pending`或`needs_business_fact`；
- 任一事实问题仍为`open`或`answered`；
- 来源版本摘要变化；
- 工作包修订号过期。

## 9. 主要错误

| 状态码 | 错误码 | 含义 |
|---|---|---|
| 403 | `PROCESS_DATA_GOVERNANCE_ADMIN_READ_ONLY` | 管理员尝试治理写操作 |
| 403 | `PROCESS_DATA_GOVERNANCE_MDM_ONLY` | 非MDM工作组尝试专业治理操作 |
| 403 | `PROCESS_DATA_GOVERNANCE_FACT_DEPARTMENT_DENIED` | 非目标部门读取或答复事实问题 |
| 409 | `PROCESS_DATA_GOVERNANCE_REVISION_CONFLICT` | 工作包已被其他人员更新 |
| 409 | `PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED` | 固定版本摘要与工作包绑定值不一致 |
| 409 | `PROCESS_DATA_GOVERNANCE_REVIEW_BLOCKED` | 仍有待定明细或未关闭问题 |
| 422 | `PROCESS_DATA_GOVERNANCE_FACT_REQUEST_REQUIRED` | 试图不填写具体问题就进入等待业务事实状态 |
| 503 | `PROCESS_DATA_GOVERNANCE_DISABLED` | 功能未启用或缺少有效试点配置 |
