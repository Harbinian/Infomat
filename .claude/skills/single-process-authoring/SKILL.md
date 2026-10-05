---
name: single-process-authoring
description: 一次编制一个业务流程，产出制度正文、process-governance-v8 JSON、工作平衡报告和待确认事项四项成果。用于新建流程、把已有业务材料整理成流程、续编已有V7/V8草稿、修改已确认的流程决定、按3001校验结果修正或只补充工作量数据。仅在请求编制、续修单流程或修正其技术检查时触发；仅提及待确认事项不触发。不用于流程证据映射、桑基图输入基线、数据库结构快照转JSON或正式审核发布。
---

# 单流程编制

本技能是 Claude Code 入口，正文只有路由作用。**立即读取并遵守**：

```
.agents/skills/single-process-authoring/SKILL.md
```

那份文件是唯一正文，包含不可突破的边界、四项成果、七阶段、访谈方式、状态词和本地校验。不要只凭本文件的摘要执行，也不要复制一份正文到这里——两份正文必然分叉。

## 执行前必须知道的三件事

1. **本技能位于仓库内**，路径相对仓库根 `E:/CA001/Infomat`。同目录的 `references/`、`assets/`、`scripts/` 都在 `.agents/skills/single-process-authoring/` 下，不在 `.claude/skills/` 下。
2. **离线校验器**：`node .agents/skills/single-process-authoring/scripts/validate-process-v8.mjs <文件.json>`。它调用 3001 与 3000 共用的结构与语义规则，正例退出 0、反例退出 1，不启动服务。
3. **只产出待核对草案**。不自动写入或发布到 3001/3000，不伪造校验记录、分数或哈希。

## 按需参考

| 需要解决的问题 | 参考（均在 `.agents/skills/single-process-authoring/`） |
|---|---|
| 阶段出口、访谈规则、状态词、续接摘要 | `references/authoring-stages.md` |
| 字段映射、标识规则、行为与关系、数据与表单、生命周期 | `references/v8-structure-rules.md` |
| 六维评分判据、综合分、周期工时与负荷率算法 | `references/workload-method.md` |
| 四项成果的章节与表格模板、一致性复核 | `references/output-templates.md` |
| 制度八章结构、原文转换边界与疑点 | `references/document-standard.md` |
| 续编、修正、改决定、只补工作量、阶段草稿、切版 | `references/continue-and-repair.md` |
| 结构范例 | `assets/minimal-v8-example.json`（虚构，只示范结构） |
