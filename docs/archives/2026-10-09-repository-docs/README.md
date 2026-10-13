# 仓库级文档整理前快照

> 状态：历史原文，仅用于追溯
> 保存日期：2026-10-09
> 范围：本轮检查的 9 份仓库级入口及直接相关维护说明。

这些文件保存整理前的原始字节，不是并行有效说明。原文中的“当前”“执行规则”“本次”、版本、数量及生效日期属于保存时的表述；当前规则回到原路径核对。快照不会作为项目指令自动加载。

## 原路径与快照

| 当前查找入口 | 历史快照 |
|---|---|
| [README.md](../../../README.md) | [整理前原文](root-readme.before.txt) |
| [AGENTS.md](../../../AGENTS.md) | [整理前原文](root-agents.before.txt) |
| [CODEX.md](../../../CODEX.md) | [整理前原文](root-codex.before.txt) |
| [CONTEXT.md](../../../CONTEXT.md) | [整理前原文](root-context.before.txt) |
| [REPOSITORY_BOUNDARY.md](../../../REPOSITORY_BOUNDARY.md) | [整理前原文](repository-boundary.before.txt) |
| [DIRECTORY_OWNERSHIP.md](../../../DIRECTORY_OWNERSHIP.md) | [整理前原文](directory-ownership.before.txt) |
| [MAINLINE_MAP.md](../../../MAINLINE_MAP.md) | [整理前原文](mainline-map.before.txt) |
| [docs/architecture/context-management.md](../../../docs/architecture/context-management.md) | [整理前原文](context-management.before.txt) |
| [docs/archives/README.md](../../../docs/archives/README.md) | [整理前原文](archives-readme.before.txt) |

## 保存内容与边界

快照保留原有用户决定的日期、迁移记录、模型调整经过、旧运行和版本表述，以及整理前的引用关系。2026-09-11 的业务真源决定、仅桌面的验证范围和 Superpowers 退出工作流等仍然有效的要求在当前入口中继续维护；保存历史不改变这些决定，也不改变 ADR 的评审状态。

长期记忆、项目业务资料、应用源码、私有配置和既有历史资产未纳入本轮改写。本目录没有移动原文件；当前正文仍在原维护位置。

## 校验与恢复

[SHA256SUMS](SHA256SUMS) 记录每份快照的 SHA-256，保存时与对应原文件逐项核对一致。快照使用 `.before.txt` 后缀，避免被误识别为新的 AGENTS.md 或当前说明。

需要恢复时，先审查本轮之后的改动，再依据上表逐项比较或恢复相关内容；不要批量覆盖后续工作。整理经过和验证结果见 [治理报告](../../reports/2026-10-09-repository-doc-governance.md)。
