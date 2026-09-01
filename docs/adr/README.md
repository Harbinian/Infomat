# docs/adr 说明

> 状态：架构决策记录目录  
> 生效日期：2026-06-10  
> 范围：处于明确评审状态、需要长期追溯的仓库结构和架构决策。

本目录保存 ADR（Architecture Decision Record）。ADR 可以处于 `Proposed`、`Accepted`、`Rejected`、`Superseded` 等明确状态。`Proposed` 只表示正式提议，不能写成已经接受；普通执行计划、审计结果和没有责任边界的随手草案不进入本目录。

## 1. 当前记录

| ADR | 主题 | 状态 |
|---|---|---|
| `0001-repo-structure-and-artifacts.md` | 仓库结构与生成物策略 | Accepted |
| `0002-codex-collaboration-and-doc-sync.md` | Codex 协作入口与代码文档同步 | Accepted |
| `0003-work-role-governance-and-process-binding.md` | 工作角色治理、岗位映射与流程绑定 | Accepted |
| `0004-controlled-derived-consumer-files.md` | 受控派生消费文件例外 | Proposed |

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

正文至少包含：状态、背景、提议或决策、影响。状态变化必须由架构评审结论支持，不得由实施任务擅自把 `Proposed` 改为 `Accepted`。
