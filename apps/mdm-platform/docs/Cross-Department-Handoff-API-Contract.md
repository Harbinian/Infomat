# 单流程治理JSON、跨部门承接与承接冲突接口说明

## 1. 适用范围

本说明适用于MDM接收`process-governance-v1`、`process-governance-v2`或`process-governance-v3`单流程文件，以及流程草稿、承接待办、故事链和承接冲突。3001继续独立运行；MDM不调用或代管3001，只适配其文件格式。MDM不信任上传文件中的`approved`、`status`、审核人或批准人字段。

所有接口要求3000有效登录会话。请求正文中的流程数据可以直接作为根对象提交，也可以放在`data`字段中。

## 2. MDM本地编制工作台接口

MDM在`/process-governance-editor/index.html`提供本地编制工作台。页面资源由MDM提供，不通过浏览器访问3001服务。

| 方法与路径 | 用途 |
|---|---|
| `GET /api/process-design/editor/schema` | 返回MDM当前使用的`process-governance-v3`结构规则 |
| `GET /api/process-design/editor/template` | 返回空白v3单流程模板，并按当前会话预填归口部门 |
| `POST /api/process-design/editor/validate` | 校验v3 JSON结构、稳定标识和本文件技术引用；不写业务数据 |

工作台读取MySQL岗位和填写项类型目录。保存时调用完整流程草稿接口，并携带`expected_revision`。导出备份只下载当前JSON，不改变草稿修订号和保存状态。

## 3. 两阶段受控导入

### 3.1 预览

`POST /api/process-design/import-structured-output/preview`

请求：

```json
{
  "data": {
    "schema_version": "process-governance-v3"
  }
}
```

服务端执行：

1. 删除不可信审核字段。
2. 按v1或v2结构规则重新校验。
3. 把v1在内存中规范化为v2，不修改源文件。
4. 校验本流程技术引用。
5. 返回内容摘要、承接候选、治理提示和规范化内容的SHA-256。

响应主要字段：

| 字段 | 含义 |
|---|---|
| `summary` | 流程名称、归口部门、行为数、数据数和承接数 |
| `handoff_candidates` | 规范化后的承接候选 |
| `governance_warnings` | 外部门流程、行为、责任部门或返回路径等待治理提示 |
| `content_hash` | 本次规范化内容的SHA-256 |
| `normalized_schema_version` | 固定为`process-governance-v3` |

预览不初始化流程设计仓库，不写MySQL。

### 3.2 审核导入

`POST /api/process-design/import-structured-output/approve`

仅`department_mdm_reviewer`可执行，且流程归口部门必须是当前人员所属部门。`admin`执行时返回403。

请求：

```json
{
  "data": {
    "schema_version": "process-governance-v3"
  },
  "preview_hash": "<预览返回的content_hash>",
  "decision_basis": "本部门审核依据"
}
```

服务端重新校验原始数据并重新计算哈希。`preview_hash`与当前内容不一致时返回409和`PREVIEW_HASH_MISMATCH`。审核依据为空时返回422。

审核通过后，系统在一个MySQL事务中写入或更新：

- 流程结构草稿及流程、业务行为；
- 当前承接修订；
- 承接治理投影、参与关系和只追加事件；
- 受控导入记录。

任一步失败时全部回滚。相同`source_process_ref + content_hash`重复提交返回既有对象和`idempotent=true`；同一流程内容变化时新增承接修订，旧修订、事件和决定记录保留。

## 4. 完整流程草稿接口

| 方法与路径 | 用途 |
|---|---|
| `GET /api/process-design/drafts` | 按当前数据范围列出流程草稿 |
| `POST /api/process-design/drafts/canonical` | 以v1、v2或v3内容新建草稿，服务端统一保存为v3 |
| `GET /api/process-design/drafts/:id/content` | 读取完整v3 JSON、修订号和来源 |
| `PUT /api/process-design/drafts/:id/content` | 按`expected_revision`保存完整v3 JSON |
| `GET /api/process-design/drafts/:id/export` | 导出`process-governance-v3`备份 |

v3中每个`forms[]`对象必须包含`form_design_state`。v1、v2文件导入后，服务端只补`unspecified`并保持既有表单、区域、字段和稳定引用，不根据名称、编号或明细数量推断现状或拟设计状态。

保存请求：

```json
{
  "expected_revision": 3,
  "content": {
    "schema_version": "process-governance-v3"
  },
  "voided_handoffs": [
    {
      "handoff_ref": "handoff_customer_change_to_engineering",
      "reason": "本次修订取消该承接，依据为双方确认的流程边界调整记录"
    }
  ]
}
```

修订号不一致时返回`409 DRAFT_REVISION_CONFLICT`，并返回`expected_revision`和`actual_revision`。服务端不得覆盖数据库中的新修订。内容哈希未变化时返回`changed=false`，不增加修订号。

保存新内容时，完整v2 JSON、流程和业务行为投影、承接候选修订及事件记录在同一事务中写入。任一步失败时全部回滚。`handoff_ref + candidate_version`未变化时保留原承接和已有决定；候选内容变化时新增修订。删除已有治理记录的承接时必须在`voided_handoffs`中提供原因，否则返回`409 HANDOFF_VOID_REASON_REQUIRED`；系统只标记旧承接不再是当前版本，不删除历史。

## 5. 承接待办接口

### 5.1 队列和故事链

- `GET /api/process-design/cross-dept-handoffs`
- `GET /api/process-design/cross-dept-handoffs/:id/story`

队列直接按承接状态、当前角色、部门和参与关系生成。故事链返回`current_stage`、`next_actions`、`milestones`、`events`和最近一次关联`conflict`，不返回推测进度百分比。`next_actions`明确下一责任角色、部门、已分派处理人和当前账号是否可处理；进入冲突时，原责任链停留位置标记为`branched`，冲突步骤作为当前步骤，已完成步骤不重置。

历史事件和接口继续使用稳定机器标识`handoff_candidate_created`。页面把该事件显示为“生成承接待核对项”。机器标识不改变事件含义，也不表示承接内容已经获得业务确认。

### 5.2 分派责任部门

`POST /api/process-design/cross-dept-handoffs/:id/assign-counterparty`

- 角色：`mdm_lead`
- 状态：`pending_assignment`
- 请求字段：`department_id`
- 约束：必须是当前承接待办中`can_act=1`的参与人

### 5.3 补充外部门实际内容

`PUT /api/process-design/cross-dept-handoffs/:id/counterparty-response`

- 角色：`department_contact`
- 状态：`pending_counterparty_detail`
- 部门：只能是本承接的外部门
- 必填：`counterparty_process_name`、`counterparty_behavior_name`、`completion_standard`
- 另需提供`requested_matter`或`transfer_data_ref`之一

前置输入应回答“是否提供、由哪条流程和行为产生、提供什么、达到什么标准”；后续承接应回答“是否承接、进入哪条流程和行为、办理什么、达到什么标准”。

### 5.4 记录部门决定

`POST /api/process-design/cross-dept-handoffs/:id/department-decision`

- 角色：`department_mdm_reviewer`
- 状态：`pending_origin_review`、`pending_counterparty_scope`或`pending_counterparty_review`
- 决定：`approved`、`returned`、`rejected`或`not_required`
- 必填：`decision_basis`

归口部门审核员只能记录归口部门决定，外部门审核员只能记录本部门决定。决定记录的最终责任人从当前`departments.final_responsible_person_id`读取；未配置时返回409。决定写入`governance_decision_records`，主题类型为`cross_dept_handoff`，主题版本为承接候选内容哈希。

### 5.5 结构卡口

`POST /api/process-design/cross-dept-handoffs/:id/structure-gate`

- 角色：`mdm_lead`
- 状态：`pending_structure_gate`、`returned`或`escalated`
- 动作：`confirmed`、`returned`或`escalated`

确认前必须存在双方当前版本的有效决定、当前最终负责人、完整承接结构和参与人责任链。`mdm_lead`只检查结构和责任链，不能代替业务部门作决定。

## 6. 承接冲突接口

| 方法与路径 | 角色 | 用途 |
|---|---|---|
| `GET /api/process-design/handoff-conflicts` | 有效治理角色 | 读取本人数据范围内的冲突队列 |
| `POST /api/process-design/handoff-conflicts/:id/assign` | `mdm_lead` | 分派有效的数据冲突处理人 |
| `PUT /api/process-design/handoff-conflicts/:id/proposal` | 被分派的`data_conflict_handler` | 记录双方立场、证据和协调方案 |
| `POST /api/process-design/handoff-conflicts/:id/department-confirmation` | 对应部门`department_mdm_reviewer` | 接受或不接受协调方案 |
| `POST /api/process-design/handoff-conflicts/:id/escalate` | 被分派的`data_conflict_handler` | 任一部门不接受后提请项目决策 |
| `POST /api/process-design/handoff-conflicts/:id/decision` | `decision_group` | 记录`continue_handoff`、`not_required`或`return_revision`及依据 |

部门普通退回不创建冲突。部门明确拒绝或结构卡口选择`escalated`时，系统创建冲突并将承接置为`conflict_open`。双方接受协调方案后，冲突关闭，承接返回`pending_structure_gate`。

## 7. 通用授权条件

承接业务写入同时检查：

1. 有效固定角色；
2. 当前人员是事项参与人；
3. 参与人记录`can_act=1`；
4. 当前人员部门与本次动作所属部门一致；
5. 承接修订是当前版本；
6. 对象状态允许本次动作；
7. 当前人员与承接或冲突存在要求的责任关系。

只有通用权限码而不满足上述条件时，仍返回403或409。承接待办不经过“待确认问题”，不得复制第二份承接内容。

## 8. 发布卡口

流程存在当前承接修订未进入`confirmed`或`closed_not_required`时不得发布。`closed_not_required`必须有相应部门决定记录，不能仅修改状态关闭。

## 9. 主要失败响应

| HTTP状态 | 场景 |
|---:|---|
| 403 | 管理员业务写入、角色不符、跨部门代决、非可操作参与人 |
| 404 | 承接对象不存在 |
| 409 | 哈希变化、状态不允许、历史修订、最终责任链或发布条件不完整 |
| 422 | 结构规则、字段、部门或审核依据不完整 |
