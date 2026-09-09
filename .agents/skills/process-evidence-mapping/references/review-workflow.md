# 草稿工作流与证据合同

本说明用于实际生成、核对和修复草稿。安全与发布边界见 [主技能](../SKILL.md)。以下是数据依赖和质量条件，由现有脚本编排执行，无需逐步向用户请求确认。

## 范围与入口

确认用户指定的资料、部门和当前部门映射。流程输入基线来自 `docs/norms/`；需要部门口径时查 `docs/organization/组织架构和部门职责.md`。PMO、MDM 页面、临时输出和历史报告不是流程输入基线。

从仓库根目录使用现有入口：

```powershell
node .agents/skills/process-evidence-mapping/scripts/run-process-input-baseline-review-workflow.mjs `
  --input <资料文件或目录> `
  --department <部门> `
  --mapping <当前部门映射.md> `
  --out artifacts/process-input-baseline-review/<run-id> `
  --no-embedding
```

此命令以关键词和规则抽取，并记录检索跳过状态。需要扩大召回时可去掉 `--no-embedding`，按向量证据规则使用本地检索。不要仅因技能提供该能力就启用向量服务。

## 来源清单与证据切块

`extract-evidence-chunks.mjs` 遍历指定范围至叶子目录，生成：

- `source_manifest.jsonl`：路径、文件号、版次、类型、大小、时间、正文哈希、处理状态与理由、来源公司及组织边界。
- `chunks.jsonl`：按条款、段落组、表格行、表单字段组、签批栏、台账字段、可读流程节点/边及附件标题切块。
- `chunking_warnings.md`：切块问题和限制。

每个来源记录为 `chunked`、`excluded`、`deferred`、`failed` 或 `blocked_unreadable`；存在后两种状态时该批次停止。不得从文件名、目录名或不可读画面补造流程事实。

每个证据块保留 `source_file`、`doc_no`、`version`、`source_anchor`、`raw_text`、`normalized_review_text`、`artifact_type`、`extraction_quality`、`chunk_hash` 和来源边界字段。不得修正 `raw_text` 或把搜索修复提示当原文；`partial`、`failed`、`blocked_unreadable` 内容不能支撑正式字段。候选必须能返回可读原文位置。

## 可选语义检索

需要扩大召回时，使用配置中的 `qwen3-embedding:latest`、1024 维本地向量，检索流程边界、对象、角色、审批、交接、表单字段、归档和完成标准。模型不可用时降级为关键词或规则抽取，记录 `embedding_manifest.status=skipped`。

相关产物为 `embedding_manifest.json`、`vectors.jsonl`、`review_evidence.jsonl`。召回只排序待审证据，不确认 L3、A1、对象同一性、审批、跨部门承接、正式工作角色或系统落位。

## 流程、角色与对象候选

- `extract-process-review-items.mjs` 以所有部门共用规则生成 `document_review_items.json`，覆盖能力、L3、A1、审批、承接、归档和完成标准候选。核心抽取器不得硬编码某部门专用结论。
- `extract-role-review-items.mjs` 和 `build-object-chains.mjs` 生成 `role_review_items.json`、`object_chains.json`，保留原文角色称谓及编制、提交、审核、批准、接收、反馈、归档等对象动作。
- 不补写无依据的流程起止、角色、输入输出、完成标准或系统；不把原文角色变为正式 `WR-*`、审批人变为输出部门，或“相关部门”变为指定部门。同标题下不同对象不得强行合并。

以上文件及 `mapping_diff_items.json` 仅为兼容性中间产物。

## 编译与待确认问题

`compile-document-structured-output-v2.mjs` 生成标准合同，包含 `draft`、`document_profile`、`processes[]`、`steps[]`、`behavior_details[]`、`step_transitions[]`、`evidence_catalog[]` 和 `pending_issues[]`。未知必填值只能明确占位为待确认，同时登记问题。

每项 A1 应有执行角色、触发场景、前置条件、输入材料、动作、输出结果、执行标准和证据；缺项进入同一 A1 的待确认问题。不得自动生成 `verified` 证据，不得因“相关部门”或交接动词创建正式 `cross_dept_handoffs[]`。

问题保留 `stable_key`、`structured_object_type`、`structured_object_key`、`target_block`、`target_field`、`evidence_status`、`issue_type`、`question_for_user` 和来源锚点。问题类型使用标准枚举；来源可读而抽取失败使用“抽取结果待复核”，不可读来源已在前置环节阻断。

问题必须引用草稿中实际存在的对象。尚未创建的表单或承接关系问题先关联已有业务行为，审批详情问题关联实际 `detail_ref`；目标字段保留待补位置，不为通过引用校验而造对象。

实例校验覆盖结构、各类对象和证据引用、表单父子关系及流程归属。悬空或类型错误引用明确报错并回源修复；不猜测映射或自动改历史文件。与当前映射的差异仅形成待审问题和兼容性 `mapping_diff_report.md`，“未命中”不等于业务不存在。

## 派生视图与验证

编排器自动调用 `validate-document-structured-output-v2.mjs --input <v2-json>`；单独修复实例后再次运行该校验，再按 v2 重新生成受影响的派生视图。

`update-input-baseline-review-todo-md.mjs` 从 v2 生成同批次 `pending-issues.md`。不得默认写入 `docs/norms/流程治理/`；Markdown 不作为机器合同、处理状态或长期真源。

未解决状态以 v2 为准：只有 `user_decision=不是问题` 且填写 `user_reason` 才从未解决视图移除。计划修改或专项确认仍保留；同名映射内容不能关闭问题，旧数组输入也遵守此规则。视图数量须与实例计算的未解决问题数量一致。

正常生成任务检查本批来源状态、实例和视图即可；技能开发套件见 [维护说明](maintenance.md)，不在每次生成时重复运行。

## 人工确认与后续发布

业务人员通过 3001/3000 或受控评审确认字段。跨部门承接需确认交付物、接收部门、交接动作、承接标准和目标流程/行为；正式工作角色需行政人事目录与流程责任部门共同确认；正式证据需来源、位置、摘录、确认人和时间。

所有发布必填项及逐对象证据经人工确认后，才能进入独立受控发布流程。技能本身不写数据库、流程输入基线，不代替接收部门确认或触发正式发布。
