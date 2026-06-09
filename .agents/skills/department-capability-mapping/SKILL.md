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
- canonical Sankey/H5 update
- validation and unresolved issue reporting

If this compatibility skill is invoked, stop here, open `process-evidence-mapping`, and follow its quality gates end to end.
