---
name: business-behavior-mapping
description: Compatibility alias for Infomat BBM/A1 work. When older prompts mention business behavior mapping, BBM, A1 decomposition, approval flow, cross-department transaction mapping, or behavior-level Sankey updates under docs/norms, immediately load and follow `.agents/skills/process-evidence-mapping/SKILL.md`; do not execute this as a standalone workflow.
---

# Business Behavior Mapping

This skill is retained only as a compatibility entry point for older prompts and trigger phrases.

For any Infomat `docs/norms` work, use the canonical merged skill:

`E:\CA001\Infomat\.agents\skills\process-evidence-mapping\SKILL.md`

Do not run a BBM-only workflow. The current project standard requires business behavior（A1）work to be controlled together with:

- source document inventory and coverage
- DCM L3 ownership and evidence
- A1-to-L3 attachment checks
- required A1 field completeness
- flowchart and flow-description extraction
- process-relevant forms, ledgers, and table extraction
- cross-department input/output checking
- canonical Sankey/H5 update with visible original/inferred basis and separate colors for inferred items
- validation and unresolved issue reporting

The legacy BBM entry point must also follow the controlled-transfer evidence rule from `process-evidence-mapping`: never fill `输入来源部门` or `输出目标部门` from business logic, basis documents, attachment lists, execution subjects, collaboration participants, approval actors, archive recipients, or external action owners unless the source proves a concrete output object is handed off through a controlled transfer.

It must also follow the abstract-A1 evidence rule from `process-evidence-mapping`: an abstracted behavior name such as `汇总核算`, `确认`, `处理`, `跟踪`, or `形成结果` does not prove the output object, approval type, execution role, or target department. If `证据类型` is `分析拆分` or `上下文推断`, the row must show the concrete source object/action or workflow node it was abstracted from, and any non-empty approval conclusion must show approval-chain evidence.

It must also follow the H5 evidence-display rule from `process-evidence-mapping`: Sankey nodes, links, tooltips, and detail rows must show original text or inference basis, and `上下文推断` / `分析拆分` items must use a visibly different color from source-backed items.

If this compatibility skill is invoked, stop here, open `process-evidence-mapping`, and follow its quality gates end to end.
