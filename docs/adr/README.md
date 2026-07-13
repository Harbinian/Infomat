# docs/adr 说明

> 状态：架构决策记录目录  
> 生效日期：2026-06-10  
> 范围：已经接受、需要长期追溯的仓库结构和架构决策。

本目录保存 ADR（Architecture Decision Record）。ADR 用于记录已经接受的长期决策、背景和影响，不用于记录临时计划、普通审计结果或待讨论草案。

## 1. 当前记录

| ADR | 主题 | 状态 |
|---|---|---|
| `0001-repo-structure-and-artifacts.md` | 仓库结构与生成物策略 | Accepted |
| `0002-codex-collaboration-and-doc-sync.md` | Codex 协作入口与代码文档同步 | Accepted |

## 2. 何时新增 ADR

适合新增 ADR 的情况：

1. 改变仓库长期目录结构或职责边界。
2. 确认某类生成物、样例或历史资料的长期处理策略。
3. 接受会影响多个目录或脚本的数据流决策。
4. 选择会长期约束 MDM、PMO 或流程输入基线链路的架构方案。

不适合新增 ADR 的情况：

- 一次性审计结论，放入 `docs/reports/`。
- 阶段性执行计划，放入 `docs/plans/`。
- 目录使用说明，放入对应目录的 `README.md`。

## 3. 编写规则

ADR 文件使用递增编号：

```text
0002-topic.md
```

正文至少包含：状态、背景、决策、影响。
