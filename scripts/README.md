# scripts 目录说明

本目录放仓库级自动化脚本：输入通常跨 `docs/`、`pmo/` 或 `apps/mdm-platform/`，输出也可能回写生成快照或校验报告。只服务单个应用的脚本应留在对应应用目录，例如 `apps/mdm-platform/scripts/`。

## 当前主线入口

| 脚本 | 作用 | 输入 | 输出 / 副作用 |
|---|---|---|---|
| `parse-sankey-data.mjs` | 从部门流程映射真源生成公司级桑基数据，并注入 PMO 流程驾驶舱 | `docs/norms/`、`docs/organization/组织架构和部门职责.md`、跨部门报告 | 写入 `docs/company-sankey-data.json` 和 `pmo/procedure-management/dashboard.html` |
| `check-dashboard-data.mjs` | 校验公司级快照、PMO 内嵌数据和跨部门报告派生统计一致 | `docs/company-sankey-data.json`、`pmo/procedure-management/dashboard.html`、`docs/norms/流程治理/跨部门完整性检查报告.md` | 只读校验 |
| `check-norms-source-manifest.mjs` | 校验部门流程真源清单与合同部门、`docs/norms` canonical 三件套一致 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/`、两份 source manifest 报告 | 只读校验 |
| `check-pmo-task-data.mjs` | 校验 PMO 根目录备份数据与 React 应用读取数据同源同 hash | `pmo/tasks.json`、`pmo/gantt-react/public/tasks.json`、两份 PMO source manifest | 只读校验 |
| `sync-process-governance-mainline.mjs` | 串起流程治理主线同步、检查和 MDM 快照导入 | 流程真源、PMO 驾驶舱、MDM 平台脚本 | 会运行 parser，并调用 MDM 平台同步 / 导入脚本 |
| `test-process-governance-mainline-contract.mjs` | 仓库级流程治理主线契约测试 | `package.json`、`docs/company-sankey-data.json`、仓库级脚本 | 只读校验 |

常用命令：

```bash
npm run test:process-governance-mainline
npm run test:norms-source-manifest
npm run test:pmo-task-data
npm run sync:process-governance
```

## 审计与质量脚本

| 脚本 | 作用 | 输入 | 输出 / 副作用 |
|---|---|---|---|
| `check-dcm-bbm.mjs` | 校验 DCM/BBM 合同、部门映射、跨部门证据和驾驶舱数据 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/`、PMO 驾驶舱 | 默认写 `docs/norms/_quality-report.md`；`--no-fail` 可用于主线容错 |
| `audit-a1-transfer-evidence.mjs` | 审计 A1 跨部门输入 / 输出证据 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/` | 默认写 `docs/reports/{日期}-a1-transfer-evidence-audit.md`；`--no-write` 可只读运行 |
| `glossary.mjs` | 查询仓库术语表 | `docs/glossary.md` | 只读查询 |

## 局部或历史工具

| 脚本 | 作用 | 当前注意事项 |
|---|---|---|
| `analyze-layout.js` | 快速计算旧布局样例的行数、画布高度和列起始位置 | 只读输出，可通过 `npm run analyze:layout` 运行；不属于流程治理主线 |
| `build-feedback-sankey.mjs` | 给单个部门桑基图 HTML 注入反馈交互 | 会直接改 `docs/norms/{部门}部门能力流程系统桑基图.html`，运行前先确认目标部门页面仍作为当前资产维护 |
| `generate_digital_project_gantt_8k.py` | 从 `output/digital_project_gantt_8k.md` 渲染 8K 甘特图 PNG | 偏 PMO 渲染工具，写入 `output/` |
| `render_gantt_h5_png.mjs` | 用 Chrome DevTools 把 H5 甘特图渲染成 PNG | 偏 PMO 渲染工具，写入 `output/` 和临时 Chrome profile |
| `merge_norms.py` | 合并 norms-formatter 产物 | 写死本机路径并写入 `docs/norms/merged/`，运行前必须先改造成可配置路径 |

## 修改规则

- 新增仓库级脚本时，在脚本头部写清用法、输入、输出和是否写文件。
- 修改 `parse-sankey-data.mjs` 后，至少运行 `node scripts/check-dashboard-data.mjs` 和 `npm run test:process-governance-mainline`。
- 修改会触碰 MDM 导入链路的脚本后，同步运行 `apps/mdm-platform` 下的流程治理相关测试。
- 不在本目录新增一次性输出、截图、数据库、日志或缓存；这些应放入本地临时目录或按边界文件先写迁移提案。
