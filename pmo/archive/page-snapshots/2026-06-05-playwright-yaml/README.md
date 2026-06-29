# 2026-06-05 Playwright YAML 页面快照归档

本目录收纳原先散放在仓库根目录的 PMO 页面 YAML 快照。

这些文件是浏览器/Playwright 抓取的页面可访问性结构快照，内容通常是 `generic`、`button`、`combobox`、`heading` 等界面节点。它们只用于追溯当时甘特图、PMO 看板、交付物台账等页面调试或验收状态。

## 归档规则

- 不作为 PMO 计划、WBS、交付物或流程数据真源。
- 不作为脚本输入，不参与 `build_pmo_task_data.py` 或流程地图解析链路。
- 需要维护 PMO 数据时，使用 `pmo/信息化项目_计划管控真源.md`、`pmo/信息化项目_WBS结构真源.md`、`pmo/信息化项目_工作平衡.md`、`pmo/信息化项目_工作开展原则.md`。
- 后续新增页面快照应优先放入生成物目录；如确需保留为历史证据，应进入 `pmo/archive/page-snapshots/` 并补充说明。

## 文件来源

原根目录文件包括：

- `gantt-*.yaml`
- `ledger-*.yaml`
- `pmo-*.yaml`
- `pm*.yaml`
- `current.yaml`
- `after-ms.yaml`
- `l2.yaml`
- `p2.yaml`
