# .planning 说明

> 状态：历史代码库分析目录  
> 生效日期：2026-06-11  
> 范围：工具生成或维护的代码库结构、技术栈和集成说明快照。

本目录保存历史规划工具输出的代码库分析材料。它可以作为理解项目背景的辅助资料，但不替代当前边界文件、目录 README 或主线脚本入口。

## 当前内容

| 路径 | 作用 |
|---|---|
| `codebase/ARCHITECTURE.md` | 历史架构分析 |
| `codebase/INTEGRATIONS.md` | 历史集成分析 |
| `codebase/STACK.md` | 历史技术栈分析 |
| `codebase/STRUCTURE.md` | 历史目录结构分析 |

## 使用边界

1. 若本目录内容与当前 `REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md` 或 `MAINLINE_MAP.md` 冲突，以当前边界文件为准。
2. 不在这里维护执行计划；阶段计划放入 `docs/plans/`。
3. 不在这里放审计报告；审计和整改记录放入 `docs/reports/`。
