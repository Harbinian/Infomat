# 跨部门承接数据库结构说明

## 1. 真源与投影

`process_design_drafts.process_content_json`是单流程编制内容真源。`process_design_cross_dept_handoffs`是完整JSON产生的承接治理投影；承接待办直接从承接状态和参与关系生成，不再向`process_governance_issues`和`process_governance_issue_points`创建第二份业务事实。

`process_design_structured_imports`记录每次受控导入的版本、哈希、审核依据和导入人。`governance_decision_records`只追加双方部门决定，不覆盖历史。`process_design_handoff_events`只追加承接和冲突事件。

## 2. 完整流程草稿关键字段

| 字段 | 作用 |
|---|---|
| `schema_version` | 当前固定为`process-governance-v3`；v1、v2内容迁移后统一更新为v3 |
| `process_content_json` | 完整规范化v3 JSON |
| `content_hash` | 规范化完整内容SHA-256 |
| `revision_no` | 乐观并发修订号 |
| `content_updated_by/at` | 最近内容更新人和时间 |

`forms[].form_design_state`保存在`process_content_json`中，不另建表单状态列。纸质表单的主表字段和明细表字段继续保存在`forms[].areas[].items[]`；MDM不按明细分组创建物理数据库表。v1、v2迁移时只补`unspecified`，并重算`content_hash`。

## 3. 承接主表关键字段

| 字段 | 作用 |
|---|---|
| `draft_id` | 所属流程结构草稿 |
| `handoff_ref` | 3001提供的稳定承接标识 |
| `handoff_direction` | `inbound_prerequisite`或`outbound_followup` |
| `anchor_behavior_ref` | 本流程相邻业务行为标识 |
| `counterparty_resolution` | `identified`或`needs_identification` |
| `source_department_id/name` | 来源部门当前解析结果和名称快照 |
| `target_department_id/name` | 目标部门当前解析结果和名称快照 |
| `transfer_data_ref/name` | 传递的数据标识和名称 |
| `requested_matter` | 需要外部门承接的事项 |
| `trigger_condition` | 触发承接的条件 |
| `completion_standard` | 承接完成标准 |
| `counterparty_process_ref/name` | 外部门流程 |
| `counterparty_behavior_ref/name` | 外部门业务行为 |
| `requires_return` | 是否要求返回 |
| `returned_data_ref/name` | 返回数据 |
| `resume_behavior_ref`、`resume_step_id` | 本流程恢复行为 |
| `source_schema_version` | 原始文件结构版本 |
| `source_process_ref` | 3001流程稳定标识 |
| `source_content_hash` | 本次导入的规范化内容哈希 |
| `candidate_version` | 承接决定使用的候选版本哈希 |
| `revision_no` | 同一`draft_id + handoff_ref`的修订号 |
| `is_current` | 当前有效修订标记 |
| `supersedes_handoff_id` | 被本修订替代的承接记录 |
| `issue_id`、`point_id` | 统一问题池待办投影 |

数据库以`draft_id + handoff_ref + revision_no`区分修订，并用当前修订索引支持查询。内容变化时将旧记录置为`is_current=0`，不覆盖原记录。

## 4. 承接状态

允许状态：

- `pending_assignment`
- `pending_origin_review`
- `pending_counterparty_scope`
- `pending_counterparty_detail`
- `pending_counterparty_review`
- `pending_structure_gate`
- `confirmed`
- `closed_not_required`
- `returned`
- `conflict_open`
- `rejected`
- `escalated`

`rejected`和`escalated`仅为迁移前历史状态。统一入口运行时以`conflict_open`承接未关闭冲突，具体处理阶段在冲突表中记录。

旧状态兼容映射：

| 旧状态 | v2状态 |
|---|---|
| `pending_return` | `pending_counterparty_detail` |
| `returned` | `pending_counterparty_review` |
| `pending_review` | `pending_structure_gate` |

## 5. 承接冲突和事件

`process_design_handoff_conflicts`保存：

- 所属承接和当前状态；
- 冲突发起原因、发起来源和分派处理人；
- 双方立场、证据JSON和协调方案；
- 双方部门确认结果、依据、人员和时间；
- 项目决定、依据、决定人和时间；
- 创建和更新时间。

`open_conflict_marker`是数据库生成列。冲突处于待分派、协调、双方确认或项目决策阶段时取值为1，关闭或退回修订后取空值。`handoff_id + open_conflict_marker`唯一，因此同一承接同一时点最多只有一个未关闭冲突，同时允许历史冲突关闭后再次发起并继续保留旧记录。

`process_design_handoff_events`按承接记录事件类型、操作者、角色、部门、依据和结构化事件数据。业务逻辑只允许追加，不更新或删除历史事件。

## 6. 受控导入表

`process_design_structured_imports`至少保存：

- `source_process_ref`
- `source_schema_version`
- `normalized_schema_version`
- `content_hash`
- `draft_id`
- `review_basis`
- `normalized_json`
- `approved_by_user_id`
- `approved_by_person_id`
- 创建时间

`source_process_ref + content_hash`唯一，保证相同版本重复导入返回既有对象。

## 7. 关系与责任

- `process_design_processes.source_process_ref`保存3001流程标识。
- `process_design_steps.source_behavior_ref`保存3001行为标识。
- `governance_decision_records.subject_type='cross_dept_handoff'`。
- `governance_decision_records.subject_version`保存候选内容哈希。
- 部门决定中的最终责任人必须取决定发生时当前部门表配置，不按姓名、岗位或历史常量推测。

## 8. 事务边界

审核导入的草稿、流程、行为、承接投影、参与关系、事件和导入审计必须使用同一MySQL事务。冲突状态变化、承接状态变化和事件追加也必须使用同一事务。任何外键、校验、写入或事件记录失败均回滚，不允许留下只有草稿、只有冲突或只有待办的半成品。
