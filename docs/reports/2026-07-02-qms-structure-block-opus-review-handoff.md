# 质量管理部流程治理结构块试点复核材料

本文用于提交给 Opus 复核。当前结论不是合入申请，而是对“质量管理部 7 条 L3 结构块试点是否可以直接进入真源”的代码级确认和待审材料说明。

## 1. 总体结论

当前不建议自动把 7 条 L3 试点结构块合入 `docs/norms/质量管理部部门-能力-流程-系统映射关系.md`。

parser 层面的整部门覆盖风险已经处理：当前 `parse-sankey-data.mjs` 支持 hybrid / 切片合并模式，结构块优先，正文 legacy 中未被覆盖的 L3/A1 会继续保留进入快照。

但试点结构块仍是待审草案，证据状态均为 `pending_review`，L3 主承载系统、岗位、入口和证据定位仍需人工确认。因此本轮仍不修改 `docs/norms` 真源。

## 2. 本轮已形成的材料

| 文件 | 用途 | 状态 |
|---|---|---|
| `docs/reports/2026-07-01-qms-process-structure-block-pilot-review-draft.md` | 质量管理部 7 条 L3 试点结构块待审 | 待 Opus 复核 |
| `docs/reports/2026-07-01-structure-block-parser-coverage-mode.md` | parser hybrid 支持确认报告 | 已更新为当前实现状态 |
| `docs/reports/2026-07-01-qms-process-structure-block-review-draft.md` | 质量管理部全量结构块待审草案 | 仅作参考，不建议本轮直接合入 |

## 3. 试点待审范围

试点待审只覆盖质量管理部 `产品检验与符合性` 下的三组 L2：

| L2 | L3 数量 | A1 数量 |
|---|---:|---:|
| 产品检验管理 | 3 | 13 |
| 首件检验管理 | 2 | 8 |
| 检验方案策划管理 | 2 | 6 |

合计：7 条 L3、27 条 A1。

## 4. 已按 Opus 意见调整的点

| 审核点 | 当前处理 |
|---|---|
| 不新造 L2/L3/A1 | 已按现有质量管理部映射文件中的真实 L1/L2/L3/A1 收窄，不采用样例中新造编号。 |
| L3 主承载系统不能写多系统并列 | 已将 `l3_catalog.system` 调整为单一系统。`ZL-02-01` 至 `ZL-02-03` 为 `MES`，`ZL-02-04` 至 `ZL-02-07` 为 `PLM`。 |
| 证据来源不能只写泛化文件 | 已补充 `source_file`，包含文件编号和制度/表单名称。 |
| 证据状态不能冒充已核验 | `evidence_catalog.status` 均为 `pending_review`。 |
| 需要保留人工确认点 | 已增加“待人工确认项”，包括 L3 主承载系统、岗位名称、入口字段、证据页码/条款位置等。 |

## 5. parser 当前实现结论

| 问题 | 当前结论 | 代码位置 |
|---|---|---|
| 检测到结构块后是否继续解析正文 legacy 表格 | 是。当前会同时解析 structured 与 legacy，并执行 hybrid 合并。 | `scripts/parse-sankey-data.mjs:753-804` |
| 结构块结果如何进入总快照 | structured 项优先进入；legacy 未覆盖项继续合并进入；冲突项写入 warning。 | `scripts/parse-sankey-data.mjs:765-804` |
| 测试是否覆盖切片结构块 + legacy 剩余项 | 已覆盖。新增 hybrid 夹具断言 structured 覆盖冲突项、legacy 剩余项保留。 | `scripts/test-parse-sankey-structure-block.mjs:257-325` |

## 6. 当前 hybrid parser 行为

当前 parser 已增加 `hybrid` 模式：

| 规则 | 建议 |
|---|---|
| L3 冲突 | 相同 `l3_key` 时，以 structure block 为准；legacy 旧表无 `l3_key` 时按 L3 名称兜底识别。 |
| A1 冲突 | 相同 `a1_code` 时，以 structure block 为准。 |
| legacy 剩余项 | 未被结构块覆盖的 legacy L3/A1 继续进入快照。 |
| 部门解析来源 | `meta.departments[].source` 标记为 `hybrid`。 |
| 冲突提示 | warning 写明被 structured 覆盖的 legacy `l3_key` / `a1_code`。 |
| 测试夹具 | 已增加结构块已有项、legacy 冲突项、legacy 未覆盖项三类数据。 |

## 7. 当前不合入真源的原因

本轮没有修改 `docs/norms/质量管理部部门-能力-流程-系统映射关系.md`。

原因不是 parser 缺少 hybrid 能力，而是待审结构块仍未完成业务确认和证据核验：当前 25 条 evidence 均为 `pending_review`，L3 主承载系统也仍需确认。

## 8. 提请 Opus 复核的问题

1. 7 条 L3、27 条 A1 的试点范围是否适合作为第一批结构块迁移范围。
2. `l3_catalog.system` 使用单一主承载系统、A1 层保留具体处理系统的设计是否可接受。
3. `evidence_catalog.status` 全部使用 `pending_review`，是否满足“待审草案不冒充已核验证据”的要求。
4. 当前 hybrid parser 的冲突策略“structured 覆盖同 key，legacy 保留未覆盖项”是否可接受。
5. 对 legacy 无 `l3_key` 的旧表，当前按 L3 名称兜底识别冲突是否可接受，还是必须先完成旧表补 key。

