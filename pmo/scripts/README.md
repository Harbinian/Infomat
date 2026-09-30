# pmo/scripts 说明

> 状态：PMO 局部脚本目录
> 生效日期：2026-06-10  
> 范围：PMO 页面、插件端点、交付物流程、前端写回检查和 PMO 展示资产导出。

本目录脚本只服务 PMO 应用、PMO 局部页面和 PMO 展示资产。跨 `docs/`、`apps/` 和 PMO 的仓库级解析、注入、审计脚本应放在根目录 `scripts/`。

## 当前脚本

| 脚本 | 作用 |
|---|---|
| `export-organization-dynamics-png.mjs` | 读取组织数字化参与度模型 SVG，使用本机 Edge 或 Chrome 导出1600×2400 PNG；默认只写入被忽略的 `artifacts/` |
| `smoke-deliverable-action.mjs` | 交付物行动项 smoke 检查，锁定双轴状态机、规则 6.2/6.4/8.1 校验、发布文本和 7 个行动项端点；使用临时正本夹具，运行后清理 |
| `smoke-deliverable-identity.mjs` | 交付物身份契约 smoke 检查，锁定受控行与计划投影行分离、编号不漂移；只读，不写文件 |
| `smoke-deliverable-workflow.mjs` | 交付物工作流 smoke 检查 |
| `smoke-frontmatter.mjs` | PMO 文档 frontmatter 检查 |
| `smoke-hmr.mjs` | PMO 前端开发热更新相关 smoke 检查 |
| `smoke-milestone-rules.mjs` | PMO 甘特图里程碑判定 smoke 检查，防止 `10/20/30工作日` 被误判为 `0工作日` |
| `smoke-plugin-endpoints.mjs` | PMO 插件端点 smoke 检查 |
| `smoke-pmo-week-range.mjs` | PMO 本周交付物周期 smoke 检查，锁定周四至下周三口径 |
| `smoke-task-owner.mjs` | PMO 任务清单责任人映射 smoke 检查 |
| `smoke-weekly-issue-ledger.mjs` | PMO 周会事项台账 smoke 检查，锁定五类模板、关闭标准和建议生成 |
| `smoke-weekly-issue-ledger-fs.mjs` | 周会事项文件正本 smoke 检查，锁定规则 6.4/8.1/8.2 校验、发布文本和登记·更新·乐观锁端到端；用环境变量指向隔离台账目录，运行后清理 |
| `smoke-writeback.mjs` | PMO 写回流程 smoke 检查 |
| `regroup-wbs-semantic.mjs` | 按语义工作包补齐 PMO WBS 二级摘要层，并同步计划/WBS Markdown 真源 |

## 修改自检

1. 新增脚本时，说明输入、输出、是否写文件。
2. 写 PMO 真源前，确认目标是 `pmo/` 下的项目计划材料，而不是流程输入基线。
3. 不在本目录放仓库级 parser 或 MDM 平台测试。
