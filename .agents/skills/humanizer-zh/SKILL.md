---
name: humanizer-zh
description: 仅在用户明确点名时清理中文套话、重复和夸张表达，保持原有事实与语气；正式受控内容遵守 technical-chinese-writer。
metadata:
  trigger: 用户明确点名 humanizer-zh
  source: 改编自 blader/humanizer，参考 hardikpandya/stop-slop
---

# 中文文风清理

保留用户既有语气和信息，只修改妨碍理解的表达。此技能在 Infomat 中保持显式调用，不因普通中文写作或关键词匹配自动启用。

- 删除无信息量的开场、结尾、宣传、同义反复和机械连接词。
- 写清主体、动作和对象，保持专业术语一致。列表、句长、标点和段落按内容需要选择，不用“三项改两项”等数量规则。
- 不为“更像人”添加个人经历、情绪、幽默、观点、来源、具体功能或数据；不把不确定信息改成确定事实。
- 受控引文、编号、参数、责任、业务条件、时序、输入输出和异常保持原样。正式或可执行内容使用 [technical-chinese-writer](../technical-chinese-writer/SKILL.md) 的对应规则；已经加载时无需重读。
- 交付用户要求的修订正文，有必要时简述关键变化。只有用户要求评分时才评分，不固定进行多轮改写或追求分数。

上游来源及许可证保留在本目录 README 和 LICENSE。上游的模式举例不能作为新增事实的依据。
