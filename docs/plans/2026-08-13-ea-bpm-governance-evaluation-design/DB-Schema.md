# 3000 EA/BPM 治理评价数据库结构说明

> 状态：逻辑结构设计，表和字段尚未实施
> 版本：V1.0
> 日期：2026-08-13

## 1. 设计原则

- 流程事实继续保存在 `process_design_drafts.process_content_json` 和不可变的 `process_design_versions` 中。
- 评价表只保存规则快照、评价结果、处理记录和流程稳定引用，不复制流程正文。
- 问题卡继续使用3000现有 `process_governance_issues` 系列表；评价能力只增加关联，不建立第二份治理问题事实。
- 所有确认、复核、例外和发布事件只追加，不更新或删除历史。
- 所有表使用InnoDB、`utf8mb4`、外键或等价逻辑约束，并按查询范围建立索引。

## 2. 新增逻辑表

### 2.1 `governance_evaluation_batches`

保存一次评价执行。

| 字段 | 含义和约束 |
|---|---|
| `evaluation_batch_id` | 主键 |
| `stage` | `pre_publish`、`post_effective`或`historical_review` |
| `draft_id` | 发布前评价使用，可空，外键到现有草稿 |
| `draft_revision_no` | 发布前修订号 |
| `process_version_id` | 生效后和历史回评使用，可空，外键到不可变流程版本 |
| `content_hash` | 本批次读取内容的SHA-256摘要 |
| `rule_set_version` | 固定规则版本 |
| `rule_set_snapshot_json` | 当次规则摘要，保证历史可解释 |
| `evaluation_scope` | 评价范围，例如 `full`、`capability`、`application_support`、`data_governance` |
| `status` | `running`、`completed`、`failed`、`stale` |
| `selection_basis` | 历史回评批次的选择依据，可空 |
| `started_by_person_id` | 发起人；系统任务另记任务标识 |
| `started_at`、`completed_at` | 执行时间 |

唯一约束：

- 发布前：`stage + draft_id + draft_revision_no + rule_set_version + evaluation_scope`；
- 生效后：`stage + process_version_id + rule_set_version + evaluation_scope`。

发布前批次只填写 `draft_id`，生效后单流程批次只填写 `process_version_id`。历史回评批次两者均为空，并且必须通过批次目标表绑定至少一个流程版本。

### 2.2 `governance_evaluation_batch_targets`

保存历史回评批次中的流程版本范围。唯一键为 `evaluation_batch_id + process_version_id`。普通单流程评价不使用该表。

### 2.3 `governance_evaluation_results`

每个“规则＋对象”一条结果。

| 字段 | 含义和约束 |
|---|---|
| `evaluation_result_id` | 主键 |
| `evaluation_batch_id` | 外键 |
| `rule_code` | 稳定规则编号 |
| `object_type` | `process`、`behavior`、`relation`、`data_object`、`form`、`form_field`、`handoff`、`capability_link`、`application_support` |
| `object_ref` | 对应流程版本内稳定引用；流程根对象使用 `process_ref` |
| `applicable` | 是否适用 |
| `automatic_result` | 自动检查结果，可空 |
| `final_result` | `passed`、`pending_confirmation`、`needs_remediation`、`release_blocked`、`not_applicable` |
| `current_facts_json` | 可显示的结构摘要，不保存流程正文或敏感值 |
| `decision_basis` | 人工确认或不适用理由 |
| `decided_by_person_id`、`decided_at` | 最终结果确认记录，可空 |
| `result_revision_no` | 乐观并发修订号 |
| `created_at`、`updated_at` | 时间 |

唯一键为 `evaluation_batch_id + rule_code + object_type + object_ref`。

### 2.4 `governance_evaluation_issue_links`

把评价结果关联到现有问题卡。

| 字段 | 含义和约束 |
|---|---|
| `evaluation_result_id` | 外键，当前结果唯一 |
| `issue_id` | 外键到 `process_governance_issues` |
| `point_id` | 外键到 `process_governance_issue_points`，可空 |
| `link_status` | `current`或`historical` |
| `created_at` | 建立时间 |

同一评价结果最多有一个 `current` 关联。问题处理、参与人、复核和历史事件继续由现有问题池管理。

### 2.5 `governance_evidence_records`

保存正式证据元数据、具名确认和待补条件，不保存3001上传内容。

主要字段：`evidence_ref`、`subject_type`、`draft_id`、`draft_revision_no`、`process_version_id`、`object_type`、`object_ref`、`evidence_type`、`source_name`、`source_anchor`、`confirmation_summary`、`confirmer_person_id`、`confirmed_at`、`missing_reason`、`expected_provider_person_id`、`expected_provider_role`、`closure_condition`、`status`、`supersedes_evidence_id`和创建信息。

`status`取值为 `verified`、`pending_review`、`source_missing`、`superseded`。纠正证据时新增记录并指向被替代记录。

### 2.6 `governance_evaluation_evidence_links`

评价结果与证据记录的多对多关联。唯一键为 `evaluation_result_id + evidence_id`。删除评价批次时禁止级联删除已进入确认或发布记录的证据。

### 2.7 `governance_post_release_remediations`

保存发布后整改安排。

主要字段：`issue_id`、`evaluation_result_id`、`process_version_id`、`responsible_person_id`、`due_at`、`verification_method`、`business_impact_confirmation`、`department_reviewer_person_id`、`department_reviewed_at`、`mdm_lead_person_id`、`mdm_reviewed_at`、`status`和 `revision_no`。

状态为 `proposed`、`department_confirmed`、`approved_for_release`、`completed`、`overdue`、`cancelled`。数据库约束不能单独判断事项是否属于阻断发布；服务层必须根据评价结果校验，审计测试必须覆盖绕过尝试。

### 2.8 `process_application_support_relations`

按不可变流程版本和A1业务行为保存当前应用支撑事实。

主要字段：`process_version_id`、`behavior_ref`、`support_mode`、`application_name_as_confirmed`、`support_types_json`、`usage_description`、`identity_status`、`match_suggestion_ref`、`confirmed_by_person_id`、`confirmed_at`、`evidence_id`、`status`和版本信息。

- `support_mode`：`application`、`manual`、`no_application`；
- `identity_status`：`pending_match`、`confirmed`、`not_required`；
- `support_types_json`仅允许产生、保存、使用、传递和人工辅助的稳定编码。

名称相同不得触发自动合并。一个新流程版本生成新的关系记录，旧版本关系保持只读。

第一阶段不建设企业应用身份目录，`match_suggestion_ref`只关联可解释的待定匹配建议。后续建设应用架构时，必须另行评审统一应用身份、旧关系迁移和兼容读取方案，不能把本表中的名称直接当作已经统一的应用身份。

### 2.9 `process_capability_links`

保存流程版本与业务能力关系。

主要字段：`process_version_id`、`capability_id`、`relationship_type`、`status`、`department_confirmation_id`、`mdm_review_id`、`effective_from`、`effective_to`和审计字段。

`relationship_type`第一阶段固定为 `primary_support`和 `joint_support`；`status`为 `pending_confirmation`、`confirmed`、`disputed`、`retired`。

### 2.10 `capability_map_versions`和`capability_map_version_items`

发布正式业务能力地图。版本表保存版本号、内容摘要、状态、生效时间、替代版本和发布人；明细表只引用已经确认的 `process_capability_links`。状态为 `pending_publish`、`effective`、`superseded`、`withdrawn`。

同一发布事务必须同时写入版本、明细和审计事件。失败时全部回滚。

### 2.11 `governance_evaluation_audit_events`

追加评价批次创建、规则执行、人工确认、问题关联、整改提交、复核、发布后整改审核、门禁检查和地图发布事件。主要字段包括事件类型、对象类型、对象标识、操作者人员和账号、角色、部门、事件摘要、前后修订号和时间。不得存储密码、会话、流程正文或敏感证据内容。

## 3. 总状态不落库

流程总状态由 `governance_evaluation_results`和当前问题状态查询汇总。数据库不得提供可人工修改的 `overall_score`或 `overall_result`字段。为了查询性能可以建立只读缓存，但缓存必须带批次和结果修订摘要，失配时重新计算。

## 4. 旧数据影响

- 现有草稿和流程版本不改写正文；新评价表只建立引用。
- 现有问题池不复制。迁移通过关联表把新评价结果连接到问题卡。
- 现有证据表如不能覆盖数据对象和跨部门承接，不强行改变其历史语义；新证据记录提供通用对象引用。
- 3001历史JSON不落库迁移，不增加浏览器或服务端状态。
- 历史流程初始显示“尚未回评”，不得批量回填为通过。

## 5. 索引和约束

至少建立以下索引：

- 评价工作队列：`final_result + updated_at`、`evaluation_batch_id + final_result`；
- 部门待办：问题参与部门、状态和期限的联合索引；
- 历史查询：`process_version_id + rule_set_version + created_at`；
- 稳定对象：`process_version_id + object_type + object_ref`；
- 应用支撑：`process_version_id + behavior_ref + status`；
- 能力地图：`capability_id + status`、`process_version_id + status`。

外键删除策略优先使用 `RESTRICT`。已经形成评价、确认、问题或发布历史的流程版本不得物理删除。

## 6. 迁移和恢复

实施必须提供：

1. dry-run盘点和预计写入数量；
2. 受影响表结构及回填清单备份；
3. 幂等apply；
4. schema、数量、外键、稳定引用和事件核对；
5. 无业务写入时的批次回滚；
6. 已发生业务写入后的补偿状态，不删除确认和审计历史。

最终表名、字段长度和索引必须在实现前根据现有MySQL结构复核。本文件不得被当作已经执行的迁移记录。
