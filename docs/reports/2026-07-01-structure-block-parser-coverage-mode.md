# 结构块 parser hybrid 支持确认报告

本报告用于确认 `scripts/parse-sankey-data.mjs` 对“结构块 v1 + 正文 legacy 表格”并存场景的当前行为。结论已按 2026-07-02 的 parser 改造结果更新。

## 结论

当前 parser 已支持 **hybrid / 切片合并模式**。

也就是说：部门文件存在 `meta.parser_schema_version: 1` 的结构块时，parser 会优先解析结构块；如果正文仍有 legacy DCM/A1 表格，则同一 L3/A1 由 structured 覆盖，legacy 中未被覆盖的剩余项继续进入 `docs/company-sankey-data.json` 快照。

质量管理部 7 条 L3 结构块试点不再存在“技术上必然整部门覆盖”的 parser 风险。但该结构块仍是待审草案，`evidence.status` 仍为 `pending_review`，未完成业务确认前仍不应自动合入 `docs/norms` 真源。

## 当前行为确认表

| 问题 | 当前结论 | 文件:行号 | 证据 |
|---|---|---|---|
| 当前 parser 在检测到结构块后，是整部门只走 structured、合并、还是其他？ | hybrid。结构块优先，正文 legacy 未覆盖项继续保留。 | `scripts/parse-sankey-data.mjs:753-804` | `parseProcessGovernanceDocument()` 会同时取得 structured 与 legacy 解析结果；`mergeStructuredAndLegacyProcessGovernance()` 合并两路结果。 |
| L3 冲突如何处理？ | structured 优先。legacy 有 `l3_key` 时按 key 覆盖；旧表没有 `l3_key` 时按 L3 名称兜底识别冲突。 | `scripts/parse-sankey-data.mjs:765-786` | 冲突项被过滤，并写入 `hybridWarnings`。 |
| A1 冲突如何处理？ | structured 优先。相同 `a1_code` 的 legacy A1 被过滤。 | `scripts/parse-sankey-data.mjs:788-794` | warning 写明被 structured 覆盖的 A1 编号。 |
| 部门 meta 是否能标记 hybrid？ | 能。`buildParserMeta()` 增加 `hybrid_departments`，主流程将 hybrid 部门写为 `source: hybrid`。 | `scripts/parse-sankey-data.mjs:932`、`scripts/parse-sankey-data.mjs:1667-1676` | 生成快照 meta 可区分 `structured`、`hybrid`、`legacy`。 |
| 是否已有测试覆盖切片结构块 + legacy 剩余项？ | 已覆盖。 | `scripts/test-parse-sankey-structure-block.mjs:257-325` | 新增 hybrid 夹具断言 structured 项存在、legacy 冲突项不重复、legacy 未覆盖项保留、warning 包含覆盖信息。 |

## 测试夹具覆盖

新增夹具：

```text
scripts/fixtures/parse-sankey-structure-block/hybrid-dept.md
```

覆盖三类数据：

| 类型 | 用途 |
|---|---|
| 结构块中的 L3/A1 | 验证 structured 正常进入输出。 |
| legacy 中与结构块冲突的同一 L3/A1 | 验证 structured 覆盖 legacy。 |
| legacy 中未被结构块覆盖的其他 L3/A1 | 验证 legacy 剩余项不会丢失。 |

## 对质量管理部试点的影响

1. 技术前置条件已补齐：parser 已支持切片合并。
2. 当前仍不自动合入 `docs/norms/质量管理部部门-能力-流程-系统映射关系.md`。
3. 不合入的原因已从“parser 会整部门覆盖”变为“待审结构块尚未完成业务确认和证据核验”。
4. 后续若决定合入，应先确认：
   - 7 条 L3 的主承载系统是否得到业务方认可。
   - A1 岗位、入口、系统是否与制度/表单原文一致。
   - `evidence_catalog` 是否从 `pending_review` 转入可用状态。
   - 旧表没有 `l3_key` 时，按 L3 名称兜底识别冲突是否可接受。


