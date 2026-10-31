# 项目技能

本目录保存随仓库分发的技能入口、必要参考和工具，不存放截图、临时附件、一次性任务提示词或历史任务包。技能指导协作与技术检查，不提供业务事实或发布授权。当前请求、已有授权和根 `AGENTS.md` 优先；`docs/` 中的资料不作为业务真源。

| 入口 | 当前用途与边界 |
|---|---|
| [process-evidence-mapping](skills/process-evidence-mapping/SKILL.md) | 从用户指定材料生成 `document-structured-output-v2` 证据草稿和待确认问题；无法读取的来源保留缺口，不自动写回业务基线或发布 |
| [single-process-authoring](skills/single-process-authoring/SKILL.md) | 编制或续修单流程，交付制度正文、候选流程 JSON、工作平衡报告和待确认事项；V9 候选与 V7/V8 兼容分开，目标结构和接收支持须实际核对 |
| [database-to-process-json](skills/database-to-process-json/SKILL.md) | 显式调用的 V7 兼容转换工具；从指定结构快照生成未审核草稿，默认不连接数据库，不充当 V9 编制或正式发布入口 |
| [technical-chinese-writer](skills/technical-chinese-writer/SKILL.md) | 正式、受控或可执行中文内容的起草与审校；保留事实、责任、编号和执行条件 |
| [humanizer-zh](skills/humanizer-zh/SKILL.md) | 用户明确点名时清理中文文风；不添加事实，不替代受控写作 |
| [business-behavior-mapping](skills/business-behavior-mapping/SKILL.md)、[department-capability-mapping](skills/department-capability-mapping/SKILL.md) | 旧技能名兼容别名，仅路由至证据映射技能，无独立写回或发布流程 |

## 维护规则

- 业务依据来自用户指定的外部原始材料、实际说明和明确确认；示例、数据库结构和旧程序仅用于其明确的技术用途。
- 技能适用范围、输入输出或引用变化时同步入口和必要参考。更新当前说明，不在执行指令中累积旧任务清单。
- 校验依赖本机配套结构、应用模块和依赖包；公开仓库不包含私有资料、完整本机测试材料或测试命令集。缺项时说明所缺条件，不伪造通过记录。
- 按改动影响选择格式、引用和隔离行为验证；不因技能更新启动服务、连接正式库、执行通知或发布。
- 保留仍有消费者的兼容资产。删除过时资料前检查引用；一次性任务包完成后不继续作为常驻规则。
