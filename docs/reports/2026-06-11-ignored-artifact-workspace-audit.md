# 忽略型输出工作区审计

> 日期：2026-06-11  
> 范围：`.playwright-cli/`、`output/`、`tests/__pycache__/`、`.superpowers/`。  
> 结论：本报告只做只读审计，不删除本地文件，不迁移历史输出。

## 1. 当前状态

| 路径 | Git 状态 | `.gitignore` 覆盖 | 分流 |
|---|---|---|---|
| `.playwright-cli/` | 未跟踪 | 已覆盖 | 本地 Playwright 调试输出，不提交 |
| `output/` | 未跟踪 | 已覆盖 | 本地渲染和截图输出，不提交 |
| `tests/__pycache__/` | 未跟踪 | 已覆盖 | Python 缓存，不提交 |
| `.superpowers/` | 已有历史文件被跟踪 | 未整体忽略 | 保留历史输出，后续迁移前先提案 |

## 2. 观察

- `.playwright-cli/` 当前包含 2026-06-09 的页面 YAML、截图和 console 日志。
- `output/playwright/pmo-video-shots/` 当前包含 PMO 页面截图、服务日志和 pid 文件。
- `tests/__pycache__/` 只是 Python 缓存目录。
- `.superpowers/brainstorm/` 已有历史 brainstorm 输出被跟踪，包含截图、HTML 片段和状态文件；本轮只补 README，不迁移。

## 3. 后续建议

1. 保持 `.playwright-cli/`、`output/`、`__pycache__/` 继续被忽略。
2. 若某张截图需要长期保存，先精选到 `docs/samples/` 或写入报告引用，不直接提交整批输出。
3. `.superpowers/` 的历史输出如需迁移，应先写迁移提案，确认哪些进入 `docs/superpowers/`、`docs/reports/` 或归档目录。
4. 不从这些输出目录反推当前 PMO、MDM 或流程真源状态。
