# PMO 数字化底座

`pmo/` 目录包含三个同级项目管理入口：流程地图驾驶舱、React 甘特图和 PMO 管控看板。

## 当前真源

甘特图和 PMO 看板任务数据已切换为 Markdown 真源。XLSX 只保留为历史导入/备份口径，不再作为默认维护入口。

| 项目 | 当前口径 |
|------|----------|
| 计划管控真源 | `pmo/信息化项目_计划管控真源.md` |
| WBS结构真源 | `pmo/信息化项目_WBS结构真源.md` |
| 工作平衡 | `pmo/信息化项目_工作平衡.md` |
| 工作开展原则 | `pmo/信息化项目_工作开展原则.md` |
| 任务数 | 467 |
| 字段数 | 45 |
| 项目周期 | 2026-06-16 至 2028-02-15 |
| 里程碑数量 | 46 |
| H5 重点展示任务 | 214 |
| 关键路径控制任务 | 75 |

`pmo-source-manifest.json` 会同步写入 `pmo/gantt-react/public/pmo-source-manifest.json`，供甘特图/PMO 看板服务识别当前真源组合。

## 交付物运行产物

`pmo/deliverables/` 保存受控交付物正本 Markdown 和明确纳管的配套文件。开发服务中的上传原件、状态快照和运行历史不是 PMO 正本，默认写入仓库根目录下被忽略的 `artifacts/pmo/deliverables/`。

如需临时改运行产物位置，可在启动 `pmo/gantt-react` 前设置：

```powershell
$env:PMO_DELIVERABLE_RUNTIME_DIR='E:\temp\infomat-pmo-deliverables'
npm run dev
```

`artifacts/pmo/deliverables/` 可在烟测或本地调试后清理；不要把其中的上传原件、截图或历史快照提交为源文件。

## 快速开始

### PMO 服务

```bash
cd pmo/gantt-react
npm install
npm run dev
```

开发模式默认访问 `http://localhost:5174`，顶部可在“甘特图 / PMO看板 / 流程地图”之间切换。

流程地图驾驶舱的独立路由为：

```text
http://localhost:5174/#/procedure-dashboard
```

原始页面仍保留在 `pmo/procedure-management/dashboard.html`，由 PMO 服务直接读取，不另维护副本。

## 更新任务数据

1. 修改并保存 `pmo/信息化项目_计划管控真源.md`。
2. 如调整 WBS 编号、父子层级或排序，同步修改 `pmo/信息化项目_WBS结构真源.md`。
3. 如调整人员安排、会议把关机制或推进规则，同步修改 `pmo/信息化项目_工作平衡.md`、`pmo/信息化项目_工作开展原则.md`。
4. 在 `pmo/` 下运行：

```bash
python convert_xlsx.py
```

脚本会同时写入：

| 输出 | 用途 |
|------|------|
| `pmo/tasks.json` | PMO 根目录备份数据 |
| `pmo/gantt-react/public/tasks.json` | React 应用实际读取的数据 |
| `pmo/信息化项目.csv` | 运行转换脚本后的排查用中间 CSV，不作为当前真源维护入口 |
| `pmo/pmo-source-manifest.json` | PMO 真源清单 |
| `pmo/gantt-react/public/pmo-source-manifest.json` | React 服务可读取的真源清单 |

运行完成后应看到 `Wrote 467 tasks from 信息化项目_计划管控真源.md`。如任务数变化，应先确认 MD 真源是否确实发生增删。

可在仓库根目录运行以下命令，确认 PMO 根目录备份数据与 React 应用实际读取数据同源：

```bash
npm run test:pmo-task-data
```

## 数据字段

`tasks.json` 保留旧展示字段，并新增最终执行版的执行管控字段。

| 字段组 | 字段 |
|--------|------|
| 基础展示字段 | `id`、`wbs`、`name`、`type`、`duration`、`start`、`finish`、`predecessors`、`resources`、`department`、`vendor`、`reviewer`、`risk`、`milestone`、`deliverable`、`notes` |
| 执行管控字段 | `viewCategory`、`phaseGateNo`、`isCriticalControl`、`versionControlObject`、`changeLevel`、`integrationStartCondition`、`isH5Focus`、`phaseGateName`、`releaseRule`、`contractPaymentControl`、`h5DiagnosticRule`、`executionNote` |

## Console 与已知问题

Console 中来自 Chrome 扩展、React 开发提示的日志不作为代码缺陷处理。

甘特图诊断中的 3 个里程碑父级误判已记录在 `pmo-gantt-known-issues.md`。MD 真源对应 WBS 数据保持不因展示误判修改。

## 目录结构

```text
pmo/
├── CLAUDE.md
├── README.md
├── procedure-management/
│   ├── dashboard.html
│   └── CLAUDE.md
├── gantt-react/
│   ├── README.md
│   ├── public/tasks.json
│   ├── public/pmo-source-manifest.json
│   └── src/
├── archive/
│   └── page-snapshots/
├── tasks.json
├── pmo-source-manifest.json
├── convert_xlsx.py
├── pmo-gantt-known-issues.md
├── PMO项目计划管控体系建设方案_V1.md
├── WBS评审记录_V1.md
├── 信息化项目_计划管控真源.md
├── 信息化项目_WBS结构真源.md
├── 信息化项目_工作平衡.md
├── 信息化项目_工作开展原则.md
└── 信息化项目_Project_H5最终执行版_导入表.xlsx
```
