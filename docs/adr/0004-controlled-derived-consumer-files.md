# ADR-0004：受控派生消费文件例外

## 状态

Proposed

## 日期

2026-08-31

## 背景

ADR-0001 将所有可再生成输出统一归入不提交仓库的生成物。当前主线中，部分派生文件已经成为 PMO 页面、MDM 导入或前端服务直接读取的固定输入。如果这些文件不随源文件和生成器进入同一个提交，消费方会读到旧数据，离线页面也无法复现同一版本。

临时输出、缓存、日志、截图和一次性预览不具有这一作用。若把它们一并纳入版本控制，会增加检索噪音和误用风险。

## 提议

在 ADR-0001 的一般规则之外，增加“受控派生消费文件”例外。文件只有同时满足以下条件，才可以继续进入版本控制：

1. 文件由仓库内明确的真源和固定生成命令产生。
2. 仓库内的页面、服务或导入主线直接读取该文件，缺少文件会使同一提交不能工作或不能离线复现。
3. 文件有稳定路径、责任目录和明确的禁止手工修改规则。
4. 文件有一致性、摘要或内容门禁，可以发现真源、生成结果和消费副本之间的漂移。
5. 维护人员修改真源后，必须运行固定生成命令，并将真源、生成器和受控派生消费文件作为同一项变更审查。

临时输出、缓存、日志、运行态数据库、批量渲染结果、截图、一次性预览和中间文件不适用该例外，默认写入被忽略的 `artifacts/` 或工具声明的临时目录。

## 当前拟纳管清单

| 真源 | 生成命令 | 受控派生消费文件 | 直接消费方 | 一致性检查 |
|---|---|---|---|---|
| `docs/norms/`、`docs/organization/`、`docs/work-role-data.json` | `node scripts/parse-sankey-data.mjs` | `docs/company-sankey-data.json`、`pmo/procedure-management/dashboard.html` 中唯一的 `#sankey-data` 数据块 | PMO 流程地图、MDM MySQL 流程治理导入 | `node scripts/check-dashboard-data.mjs`、`npm run test:source-manifest-hashes` |
| `docs/organization/工作角色目录与岗位映射.md`、`docs/organization/花名册.md` | `npm run build:work-role-data` | `docs/work-role-data.json` | 3001 岗位与工作角色只读提示、流程地图解析器 | `npm run test:work-role-contract` |
| 七份 `pmo/信息化项目_*.md` PMO 真源 | `npm run build:pmo-task-data` | `pmo/tasks.json`、`pmo/pmo-source-manifest.json`、`pmo/gantt-react/public/tasks.json`、`pmo/gantt-react/public/pmo-source-manifest.json` | PMO 甘特图和看板服务 | `npm run test:pmo-task-data` |
| 项目治理报告固定输入 | `npm run governance:weekly-report` | `docs/reports/project-governance-weekly-report.md`、`pmo/gantt-react/public/project-governance-weekly-report.json` | PMO 项目治理周报页面 | `npm run test:project-governance-upgrade` |

`pmo/procedure-management/dashboard.html` 只有脚本管理的 `#sankey-data` 数据块属于受控派生内容；页面结构、样式和交互仍由该目录人工维护。

## 非纳管对象

- `artifacts/`、`output/`、`test-results/`、临时目录和本地运行状态。
- 调试日志、服务 PID、缓存、批量截图、一次性渲染结果和预览文件。
- 尚未确认直接消费关系、生成命令或一致性检查的历史输出。
- 本次任务单独登记、但未获业务决定的会议录音。

## 实施与验收条件

1. 根边界文件、目录责任文件、相关 README 和生成脚本必须使用同一口径。
2. 主线静态门禁必须检查生成命令、受控文件路径、消费关系和副本一致性。
3. 新增受控派生消费文件时，必须先更新本 ADR 的拟纳管清单并完成评审。
4. 在本 ADR 仍为 `Proposed` 期间，不得把状态写成 `Accepted`，也不得据此自动移动、删除或取消跟踪历史文件。

## 与 ADR-0001 的关系

本提议若被接受，将成为 ADR-0001“所有可再生成输出不得提交”规则的窄范围例外。当前状态仅为 `Proposed`；本文件记录拟采用规则和实施门禁，不表示架构评审已经接受，也不改写 ADR-0001 的历史状态。

## 影响

- 主线消费文件可以与真源、生成器保持同一提交的一致性。
- 临时生成物仍然不进入版本控制。
- 维护人员必须承担重新生成和一致性检查成本。
- 历史输出不会因为名称中含“生成”而自动获得纳管资格。
