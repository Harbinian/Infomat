# .agents 说明

> 状态：Agent 协作配置目录  
> 生效日期：2026-06-11  
> 范围：本仓库内由 Agent 使用的项目技能和提示材料。

本目录保存仓库随附的 Agent 技能配置。它用于帮助 AI 助手理解 Infomat 的流程映射、证据映射和中文文本处理规则，不作为业务资料真源。

## 当前内容

| 路径 | 作用 |
|---|---|
| `skills/business-behavior-mapping/` | BBM/A1 业务行为映射兼容技能 |
| `skills/department-capability-mapping/` | DCM 部门能力流程系统映射兼容技能 |
| `skills/process-evidence-mapping/` | 流程证据链处理技能 |
| `skills/humanizer-zh/` | 中文文本自然化处理技能 |

## 使用边界

1. 技能可以指导 AI 协作流程，但不能替代 `REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md` 和 `MAINLINE_MAP.md`。
2. 修改技能前，确认是否也需要同步 `.claude/skills/` 中的兼容副本。
3. 不在本目录放项目生成物、截图、运行日志或临时数据。
4. 新增技能时，写清适用场景、输入、输出和不适用边界。
