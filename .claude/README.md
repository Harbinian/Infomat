# .claude 说明

> 状态：Claude 协作配置目录  
> 生效日期：2026-06-11  
> 范围：Claude 本地配置和兼容技能副本。

本目录保存 Claude 相关协作配置。它用于本地 AI 工具识别项目技能和设置，不作为业务资料、流程输入基线或项目计划。

## 当前内容

| 路径 | 作用 |
|---|---|
| `settings.json` | 已跟踪的 Claude 项目设置 |
| `settings.local.json` | 本地设置，按本地状态处理 |
| `skills/` | Claude 可读取的技能副本 |

## 使用边界

1. `.claude/skills/` 是 AI 协作入口，不放项目交付物。
2. 已废弃的 `claude-to-im` 即时通讯 skill 已移除，不再写入 `skills-lock.json`。
3. 修改技能内容时，确认 `.agents/skills/` 是否需要同步。
4. 不提交本地 token、Cookie、运行日志或临时 worktree 输出。
