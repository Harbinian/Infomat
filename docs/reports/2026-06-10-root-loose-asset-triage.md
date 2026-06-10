# 根目录散放资产分流报告

> 日期：2026-06-10  
> 范围：仓库根目录文件，不含目录内容。  
> 结论：本报告只做分流，不移动文件，不修改脚本入口。

## 1. 当前根目录文件口径

| 文件 | 状态 | 分流 |
|---|---|---|
| `README.md` | 仓库入口 | 保留 |
| `AGENTS.md` / `CLAUDE.md` | AI 协作规则 | 保留 |
| `CONTEXT.md` | 仓库术语和目录规范 | 保留 |
| `REPOSITORY_BOUNDARY.md` / `DIRECTORY_OWNERSHIP.md` / `MAINLINE_MAP.md` | 边界和主线规则 | 保留 |
| `package.json` / `package-lock.json` | 根目录主线合约脚本入口 | 保留 |
| `.gitignore` | 仓库忽略规则 | 保留 |
| `echarts.min.js` | PMO 驾驶舱和 DCM/BBM 合同要求的根静态资产 | 保留 |
| `skills-lock.json` | 当前 AI skill 锁文件 | 保留；已移除废弃 `claude-to-im` |
| `analyze-layout.js` | 孤立布局分析辅助脚本 | 待复核迁移或删除 |
| `temp_survey.txt` | 一次性调查文本，已被边界文件标为待归类资产 | 待复核迁移 |

## 2. 已过时或已变化结论

- `changxing_layered_security_architecture_v1_0.md` 当前不在根目录，本轮不再作为根目录散放问题处理。
- `.claude/skills/claude-to-im` 已按用户确认删除本地失效入口；`skills-lock.json` 也已移除对应记录。

## 3. 待复核项

### `analyze-layout.js`

当前引用：

- `package.json` 的 `main` 字段指向它。
- 历史 `docs/superpowers/specs/SPEC.md` 提到它是布局分析辅助脚本。

判断：

- 它不是根目录主线脚本入口。
- 迁移或删除前，应先确认是否仍有人直接运行它。
- 若保留，建议后续迁入 `scripts/` 或 `docs/samples/` 并补说明；若不再使用，先删除 `package.json.main` 的误导性入口，再移除文件。

### `temp_survey.txt`

当前口径：

- `DIRECTORY_OWNERSHIP.md` 已明确它属于待归类资产，应先登记后迁移。
- 内容看起来是“昌兴06B厂房接入民机非密园区网”的需求调查文本。

判断：

- 若仍作为项目输入，应迁入 `docs/plans/`、`docs/meetings/` 或相关资料目录，并改成可读 Markdown 文件名。
- 若只是一次性中间抽取文本，应归档或移出仓库。
- 本轮不迁移，避免误判资料归属。

## 4. 后续建议

| 优先级 | 动作 | 验证 |
|---|---|---|
| P1 | 复核 `analyze-layout.js` 是否仍被人工使用 | 搜索引用；确认 `package.json.main` 是否需要保留 |
| P1 | 复核 `temp_survey.txt` 的资料归属 | 确认是否属于会议、计划、基础设施或外部参考 |
| P2 | 若迁移根目录临时资产，先提交迁移提案 | 更新引用、运行根目录主线合约 |

本报告不处理 `echarts.min.js` 多副本问题；该问题已单独记录在 `docs/reports/2026-06-10-duplicate-asset-migration-proposal.md`。
