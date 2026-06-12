# 架构叙事收口计划关闭记录

> 状态：已关闭
> 关闭日期：2026-06-11
> 关闭结论：不执行原完整计划，改为最小修复。

## 已执行的最小修复

1. `README.md` 将目录结构标题调整为“目录结构（当前导航）”。
2. `.planning/codebase/ARCHITECTURE.md`、`STACK.md`、`STRUCTURE.md`、`INTEGRATIONS.md` 开头增加历史扫描快照声明，明确这些文件不是当前仓库架构入口。
3. `.planning/codebase/STRUCTURE.md` 中关于 `README.md` 的旧“唯一真源”描述调整为历史扫描口径。
4. `docs/integration/系统集成关系说明.md` 开头增加企业目标态 / 方案参考声明，明确不代表本仓库运行时已对接。
5. `docs/plans/2026-05-17-changxing-network-plan.md` 开头增加网络接入实施方案声明，明确不代表 Infomat 仓库已实现系统对接。

## 未执行内容

- 未新建 `docs/architecture/current-architecture-overview.md`。
- 未修改 `MAINLINE_MAP.md`、`REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md`。
- 未修改 `docs/norms/`、`docs/company-sankey-data.json`、`pmo/procedure-management/dashboard.html`、`apps/mdm-platform/` 或 `scripts/parse-sankey-data.mjs`。

## 关闭原因

仓库已有三份根目录执行规则和目录级 README，风险主要来自旧扫描文件和目标态参考材料的单文件误读。最小修复已覆盖这些误读入口，完整计划中的新增架构总览暂不必要，避免再引入一份需要同步维护的架构说明。

## 验证口径

- 旧目录结构强表述不再出现在 `README.md` 和 `.planning/codebase/`。
- 四份 `.planning/codebase/*.md` 文件头部均包含“历史扫描快照”。
- 集成关系说明和网络接入方案均包含“不代表仓库运行时已对接 / 已实现系统对接”的边界声明。
