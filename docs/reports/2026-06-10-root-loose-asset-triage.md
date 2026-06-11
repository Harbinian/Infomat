# 根目录散放资产分流报告

> 日期：2026-06-10  
> 范围：仓库根目录文件，不含目录内容。  
> 结论：本报告先做分流；2026-06-11 已将 `analyze-layout.js` 迁入 `scripts/` 并保留根命令入口。

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
| `analyze-layout.js` | 已迁入 `scripts/analyze-layout.js` 的布局分析辅助脚本 | 已处理，保留只读命令入口 |
| `temp_survey.txt` | 一次性调查文本，已被边界文件标为待归类资产 | 待复核迁移 |

## 2. 已过时或已变化结论

- `changxing_layered_security_architecture_v1_0.md` 当前不在根目录，本轮不再作为根目录散放问题处理。
- `.claude/skills/claude-to-im` 已按用户确认删除本地失效入口；`skills-lock.json` 也已移除对应记录。

## 3. 待复核项

### `analyze-layout.js`

当前引用：

- `package.json` 的 `main` 字段指向 `scripts/analyze-layout.js`。
- 根目录提供 `npm run analyze:layout` 作为显式运行入口。
- 历史 `docs/superpowers/specs/SPEC.md` 提到它是布局分析辅助脚本。

判断：

- 它不是根目录主线脚本入口，也不属于流程治理数据链路。
- 已按“保留但收口”的方式迁入 `scripts/`，并在 `scripts/README.md` 标注为只读历史/局部工具。
- 历史方案目录中的提及保留为上下文，不作为当前入口。

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
| P1 | 复核 `analyze-layout.js` 是否仍被人工使用 | 已处理：迁入 `scripts/`，保留 `npm run analyze:layout` |
| P1 | 复核 `temp_survey.txt` 的资料归属 | 确认是否属于会议、计划、基础设施或外部参考 |
| P2 | 若迁移根目录临时资产，先提交迁移提案 | 更新引用、运行根目录主线合约 |

本报告不处理 `echarts.min.js` 多副本问题；该问题已单独记录在 `docs/reports/2026-06-10-duplicate-asset-migration-proposal.md`。
