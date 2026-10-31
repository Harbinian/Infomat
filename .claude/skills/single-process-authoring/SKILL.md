---
name: single-process-authoring
description: 编制或续修单个业务流程，产出制度正文、候选流程JSON、工作平衡报告和待确认事项；也用于按校验结果修正。仅提及待确认事项不触发。不用于证据映射、数据库结构快照转JSON或正式审核发布。
---

# 单流程编制

本文件仅为 Claude Code 路由入口。执行前读取仓库内唯一正文 [.agents/skills/single-process-authoring/SKILL.md](../../../.agents/skills/single-process-authoring/SKILL.md)，按其当前适用条件、参考路由和交付边界工作，不在此复制版本规则。

参考文件、资产和脚本均位于 `.agents/skills/single-process-authoring/`。离线校验入口为 `node .agents/skills/single-process-authoring/scripts/validate-process-v8.mjs <文件.json>`，不启动服务；配套本机结构及依赖须齐备。按文件实际版本校验，候选源码不证明目标实例已支持。

只交付待核对草案；不自动写入或发布到 3000、3001，不伪造校验记录、分数或摘要。
