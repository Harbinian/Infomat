# 跨部门风险来源新鲜度提案

> 日期：2026-06-11  
> 范围：只定义 `crossDept` 风险数据的新鲜度校验口径，不修改流程真源、生成快照或 PMO 驾驶舱。  
> 结论：已按本提案的第一步把跨部门报告来源指纹写入生成数据并接入自动校验；不要仅用文件日期或页面统计值判断是否同步。

## 0. 执行状态

| 项目 | 状态 |
|---|---|
| `crossDept.sourceReports` 写入 `docs/company-sankey-data.json` | 已实现 |
| `#cross-dept-data` 内嵌同一份来源指纹 | 已实现 |
| `scripts/check-dashboard-data.mjs` 比对磁盘报告 hash | 已实现 |
| 直接从部门映射真源计算跨部门闭环风险 | 延后 |

## 1. 当前状态

`scripts/parse-sankey-data.mjs` 目前从以下链路生成 PMO 驾驶舱数据：

| 数据 | 当前来源 | 当前风险 |
|---|---|---|
| 部门流程、节点、链路 | `docs/norms/{部门}部门-能力-流程-系统映射关系.md` | 已有 `sourceManifest` 记录文件 hash 和 mtime。 |
| 组织与部门域 | `docs/organization/组织架构和部门职责.md` | 仍存在脚本硬编码口径，后续需继续收敛。 |
| `crossDept` 风险 | `docs/norms/流程治理/跨部门完整性检查报告.md` | 只解析报告结果，未记录报告自身 hash，也未证明报告与最新部门映射同步。 |

当前跨部门完整性报告头部显示：

| 字段 | 当前值 |
|---|---|
| 版本 | V1.0 |
| 生成日期 | 2026-06-01 |
| 前置输入 | `跨部门流程识别报告.md` V1.1 |
| 当前 SHA256 | `4AD8929E133196644A89F0C21AA1573C63BC721BB7F8A99AF9027D8F083849CA` |

这说明 `crossDept` 已经能和报告正文保持一致，但还不能回答一个更关键的问题：这份报告是否由最新的流程映射真源重新生成。

## 2. 为什么不直接用日期判断

文件修改时间和报告中的生成日期都不适合作为唯一红线：

- 报告可能在不改变业务内容时被格式化，mtime 会变化。
- 报告可能重新生成但生成日期忘记更新。
- 当前报告日期早于后续多轮整改，但它可能仍然是最后一次正式跨部门核查结果。
- 用日期硬拦截会让主线在没有实质风险的情况下变红，降低校验可信度。

更稳妥的方式是记录可复验的输入指纹。

## 3. 已实现的第一步

`scripts/parse-sankey-data.mjs` 已在生成数据中加入 `crossDept.sourceReports`：

```json
{
  "crossDept": {
    "sourceReports": [
      {
        "path": "docs/norms/流程治理/跨部门完整性检查报告.md",
        "sha256": "...",
        "declaredGeneratedDate": "2026-06-01"
      },
      {
        "path": "docs/norms/流程治理/跨部门流程识别报告.md",
        "sha256": "...",
        "declaredVersion": "V1.1"
      }
    ]
  }
}
```

同时，`check-dashboard-data.mjs` 已新增只读校验：

1. 从磁盘重新计算跨部门报告 hash。
2. 比对 `docs/company-sankey-data.json.crossDept.sourceReports` 中记录的 hash。
3. 比对 PMO 驾驶舱内嵌数据中的同一份 hash。
4. 校验失败时提示“请重新运行 `node scripts/parse-sankey-data.mjs`”，而不是要求人工改页面。

## 4. 本批未进入的内容

这些事仍然延后，不和来源指纹混在一起：

- 直接从部门映射真源重新计算跨部门闭环风险。
- 补写工程技术部 canonical 映射交付物。
- 修改 `docs/norms/流程治理/跨部门完整性检查报告.md` 的业务结论。
- 按日期判断报告是否过期。

## 5. 验收口径

本批实现后，至少应满足：

| 命令 | 预期 |
|---|---|
| `node scripts/parse-sankey-data.mjs` | 生成数据包含跨部门报告来源指纹。 |
| `node scripts/check-dashboard-data.mjs` | 校验公司级 JSON、PMO 内嵌数据和磁盘报告 hash 一致。 |
| `npm run test:process-governance-mainline` | 主线合约仍通过。 |

在 parser 直接从映射真源计算跨部门缺口前，本提案只解决“报告是否和生成快照一致”，不宣称“报告一定代表最新业务真源”。
