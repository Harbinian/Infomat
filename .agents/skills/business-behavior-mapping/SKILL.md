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
- canonical Sankey/H5 update
- validation and unresolved issue reporting

The legacy BBM entry point must also follow the controlled-transfer evidence rule from `process-evidence-mapping`: never fill `输入来源部门` or `输出目标部门` from business logic, basis documents, attachment lists, execution subjects, collaboration participants, approval actors, archive recipients, or external action owners unless the source proves a concrete output object is handed off through a controlled transfer.

If this compatibility skill is invoked, stop here, open `process-evidence-mapping`, and follow its quality gates end to end.
