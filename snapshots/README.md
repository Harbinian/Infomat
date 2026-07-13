# snapshots 说明

> 状态：历史 norms 快照目录  
> 生效日期：2026-06-11  
> 范围：`docs/norms/` 的历史快照 JSON、Markdown 和快照生成脚本。

本目录保存历史 norms 快照，用于追溯某个时间点的流程映射状态。当前流程输入基线仍在 `docs/norms/`，当前生成快照为 `docs/company-sankey-data.json`。

## 当前内容

| 文件 | 作用 |
|---|---|
| `generate_snapshot.py` | 历史快照生成脚本 |
| `LATEST.txt` | 历史快照指针 |
| `norms-snapshot-*.json` | 历史 JSON 快照 |
| `norms-snapshot-*.md` | 历史 Markdown 快照 |

## 使用边界

1. 不从本目录反推当前流程数据。
2. 修改当前流程输入基线时，回到 `docs/norms/` 并运行 `scripts/parse-sankey-data.mjs`。
3. 如果要保留新的历史快照，应写清生成时间、来源和生成命令。
4. 大量旧快照迁移或压缩前，应先写迁移提案。
