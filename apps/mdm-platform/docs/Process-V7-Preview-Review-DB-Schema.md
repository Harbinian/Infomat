# V7预览核对数据说明

## 1. 独立存储边界

V7预览核对接口使用下列专用表，不写入`process_design_drafts`、`process_design_versions`、`process_design_cross_dept_handoffs`和正式流程地图表。只有单独的受控提升接口可以在正式开关开启后写入现有主档和草稿链路。

| 表 | 用途 |
|---|---|
| `process_v7_preview_cases` | 一次持续核对的案例、归口部门、当前修订和案例状态 |
| `process_v7_preview_revisions` | 用户每次上传的完整V7文件、文件名、摘要和上传人 |
| `process_v7_preview_review_items` | 当前及历史修订中的跨部门行为核对项和双方结果 |
| `process_v7_preview_events` | 上传、分派、部门核对、保留结果和重新打开的追加记录 |

## 2. 标识与并发

- `case_ref`是预览案例稳定标识。
- `process_ref`来自V7，只用于确认同一案例的新修订仍是同一流程，不是正式`process_version_id`。
- `revision_no`由3000逐次增加。
- `content_hash`按规范化JSON计算SHA-256，相同案例中不得重复。
- `stable_item_key`由业务行为稳定引用和承接部门组成。
- `item_digest`覆盖业务行为、执行部门、相连流程关系和数据关系。摘要变化时，3000重新打开该项。

## 3. 原生V7正式基础

M2迁移只增加正式链路承接原生V7所需的可空结构，不创建V7业务记录：

- `process_design_documents.process_ref`可空，并对非空值唯一；现有V3主档保持空值，不自动回填。
- `process_design_versions.l1_name`、`l2_name`、`l3_name`和`content_json`允许V7版本为空；现有V3版本保持原值。
- `process_design_review_tasks.draft_revision_no`和`content_hash`用于把V7审核结论绑定到精确正文；历史V3任务保持兼容。
- `process_v7_promotions`只追加保存预览案例、修订、摘要、目标主档、目标草稿和提升操作者。它是提升审计，不是第二套流程主档。

M2迁移不得修复无关历史结构漂移，不得猜测补齐空`document_id`、冲突`process_ref`或没有当前版本的主档。

正式V7写入规则：

- 草稿必须关联明确的`document_id`，`schema_version`固定为`process-governance-v7`，完整正文写入`process_content_json`。
- 同一预览案例修订、修订号和内容摘要只能有一条提升审计。重复请求返回原主档和原草稿。
- 审核任务必须保存`draft_revision_no`和`content_hash`；过期任务不能改变草稿状态。
- 发布版本的旧L1、L2、L3和`content_json`为空，完整V7正文、摘要和来源修订号保留在正式版本中。
- 正式提交、审核和发布事务统一按“预览案例 → 当前修订 → 最新提升记录 → 流程主档 → 当前正式版本 → 正式草稿 → 审核任务（按标识升序）”加锁。事务外查询只定位这些标识，状态判断使用事务内重读结果。
- 草稿状态、`revision_no`和`content_hash`同时出现在条件更新中。审核任务还要同时核对`status`、`draft_revision_no`和`content_hash`；主档指针更新必须匹配锁定时的`current_version_id`。任一条件更新未命中时，整个事务回滚。
- `document_id + edition`沿用现有唯一约束；发布事务还锁定主档当前版本指针，防止并发生成两个相同版次。状态变更与`process_design_events`事件记录在同一事务内提交。

## 4. 数据保留

- 新修订不覆盖旧文件和旧核对项。
- 核对结果变化时，表中保存当前结果，事件表追加保存操作者、部门、角色、依据、时间和前后状态。
- 本期不提供删除接口。需要停用案例时，后续通过受控状态变更处理。
- 文件内容可能包含业务资料，只允许有范围权限的人员读取；日志不得打印文件正文。
- 正式版本形成后，下游只能绑定不可变`process_version_id`，不得在运行时读取预览案例或原始3001文件。
