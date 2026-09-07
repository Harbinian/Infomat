---
name: department-capability-mapping
description: Compatibility alias for Infomat DCM work. When older prompts mention department capability mapping, DCM, department capability-process-system mapping, MDM requirements, or Sankey deliverables under docs/norms, immediately load and follow `.agents/skills/process-evidence-mapping/SKILL.md`; do not execute this as a standalone workflow.
---

# Department Capability Mapping

本技能只保留旧名称兼容入口，不提供独立执行流程。

调用后读取并遵守 [process-evidence-mapping](../process-evidence-mapping/SKILL.md)。
源文件、证据、草稿、待确认问题及人工发布边界均以该主技能为准。
本入口不授权写回流程输入基线、更新正式桑基图或 H5、写数据库或触发发布。

`references/prompts.md` 仅保留历史提示词供追溯，不属于当前执行指令；
只有用户要求追溯历史做法时才读取，不据此执行旧工作流。
