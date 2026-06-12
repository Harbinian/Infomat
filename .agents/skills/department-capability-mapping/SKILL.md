---
name: department-capability-mapping
description: Compatibility alias for Infomat DCM work. When older prompts mention department capability mapping, DCM, department capability-process-system mapping, MDM requirements, or Sankey deliverables under docs/norms, immediately load and follow `.agents/skills/process-evidence-mapping/SKILL.md`; do not execute this as a standalone workflow.
---

# Department Capability Mapping

This skill is retained only as a compatibility entry point for older prompts and trigger phrases.

For any Infomat `docs/norms` work, use the canonical merged skill:

`E:\CA001\Infomat\.agents\skills\process-evidence-mapping\SKILL.md`

Do not run a DCM-only workflow. The current project standard requires one controlled evidence chain covering:

- source document inventory and coverage
- department capability-process-system mapping
- business behavior（A1）decomposition
- flowchart and flow-description extraction
- process-relevant forms, ledgers, and table extraction
- MDM requirement derivation
- canonical Sankey/H5 update with visible original/inferred basis and separate colors for inferred items
- validation and unresolved issue reporting

During DCM work, do not turn制度依据, responsibility ownership, application placement, participant departments, approval roles, or archive destinations into BBM `输入来源部门` / `输出目标部门`. Those fields belong to A1 work and must later follow the controlled-transfer evidence rule in `process-evidence-mapping`.

Do not use DCM responsibilities, source titles, or application placement to pre-decide BBM output objects, approval types, execution roles, or target departments. Later A1 rows must re-anchor each abstracted behavior to a concrete source object/action, workflow node, form, table, ledger, report, or clause phrase before writing a confident conclusion.

Do not let DCM-only H5 updates hide evidence quality. Sankey nodes, links, tooltips, and detail rows must follow `process-evidence-mapping`: show original text or inference basis, and color `上下文推断` / `分析拆分` items differently from source-backed items.

If this compatibility skill is invoked, stop here, open `process-evidence-mapping`, and follow its quality gates end to end.
