# 草稿工作流与证据合同

本说明用于实际生成、核对和修复草稿。安全与发布边界见 [主技能](../SKILL.md)。以下是数据依赖和质量条件，由现有脚本编排执行，无需逐步向用户请求确认。

## 范围与入口

确认用户指定的外部原始材料、实际业务说明和明确确认，以及用于差异比较的部门映射。部门口径来自本次指定来源或有权主体确认；`docs/` 历史资料不作治理真源，旧映射、页面与技术合同不能证明业务职责或审批链。

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

- `source_manifest.jsonl`：路径、文件号、版次、类型、大小、时间、处理状态与理由、来源公司及组织边界。视觉转录绑定时，`source_hash` 是原文件字节的 SHA-256；`content_hash` 是本批抽取或转录文字的 SHA-1，两者用途不同，后者不能证明原文件字节未变。
- `chunks.jsonl`：按条款、段落组、表格行、表单字段组、签批栏、台账字段、可读流程节点/边及附件标题切块。
- `chunking_warnings.md`：切块问题和限制。

每个来源保留 `chunked`、`excluded`、`deferred`、`failed` 或 `blocked_unreadable` 状态。`source_coverage.json`（`process-source-coverage-v1`）记录可用块与缺口：有可用块时继续生成该部分，缺口进入草稿的 `basis_description` 和 `pending_issues[]`；没有可用块时以非零退出码停止，不造空成果。`partial` 不表示必需来源可以跳过，依赖缺口的结论和完整成果声明仍受阻断。不得从文件名、目录名或不可读画面补造流程事实。

每个证据块保留 `source_file`、`doc_no`、`version`、`source_anchor`、`raw_text`、`normalized_review_text`、`artifact_type`、`extraction_quality`、`chunk_hash` 和来源边界字段。不得修正 `raw_text` 或把搜索修复提示当原文；未复核的转录、`partial`、`failed`、`blocked_unreadable` 内容不能支撑正式字段。候选须返回原文位置。

图片或扫描页可由模型查看原图后形成转录，或复用已生成的 `scripts/ocr-source.mjs` 的 `json/*.json`。给同一命令增加 `--visual-transcripts <记录.json>`；记录格式和拒绝条件见[切块规则](chunking-spec.md)。导入不会调用 OCR 引擎，置信度和旧记录的 `review_required=false` 不构成确认。原抽取状态保留，转录仍为 `pending_review/unverified/review_only`。工具不可用时继续可读部分，不安装新依赖或发送资料给外部服务。

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

编排器把 `--source-manifest` 传给编译器。直接调用编译器处理视觉转录时也必须传入覆盖全部视觉来源的清单，否则拒绝生成，防止遗漏来源缺口和 `OCR/抽取待复核` 问题。旧纯文本调用可保持原参数。

每项 A1 应有执行角色、触发场景、前置条件、输入材料、动作、输出结果、执行标准和证据；缺项进入同一 A1 的待确认问题。不得自动生成 `verified` 证据，不得因“相关部门”或交接动词创建正式 `cross_dept_handoffs[]`。

问题保留 `stable_key`、`structured_object_type`、`structured_object_key`、`target_block`、`target_field`、`evidence_status`、`issue_type`、`question_for_user` 和来源锚点。问题类型使用既有合同枚举：待复核视觉转录使用 `OCR/抽取待复核`，未取得内容使用 `来源证据不足`。来源缺口关联本批草稿，不为补引用造业务对象；旧问题数组中的“抽取结果待复核”显示兼容保留。

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
