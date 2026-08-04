# PMO 数字化底座

`pmo/` 目录包含三个同级项目管理入口：流程地图驾驶舱、React 甘特图和 PMO 管控看板。

修改 PMO 目录内代码、脚本、页面、数据生成逻辑或交付物工作流前先读 `AGENTS.md`。相关行为变化必须同步更新 README、目录 `AGENTS.md` 或 PMO 真源说明。

## 当前真源

甘特图和 PMO 看板任务数据已切换为 Markdown 真源。历史 XLSX / MPP / CSV 任务导入文件已废弃，不再保留或读取。

| 项目 | 当前口径 |
|------|----------|
| 计划管控真源 | `pmo/信息化项目_计划管控真源.md` |
| WBS结构真源 | `pmo/信息化项目_WBS结构真源.md` |
| 执行标准真源 | `pmo/信息化项目_执行标准真源.md` |
| 工作平衡 | `pmo/信息化项目_工作平衡.md` |
| 工作开展原则 | `pmo/信息化项目_工作开展原则.md` |
| 协同工作规则 | `pmo/信息化项目_协同工作规则.md` |
| 部门主备对接人名单 | `pmo/信息化项目_部门主备对接人名单.md` |
| 任务数 | 516 |
| 字段数 | 43 |
| 项目周期 | 2026-06-16 至 2028-02-15 |
| 里程碑数量 | 47 |
| H5 重点展示任务 | 251 |
| 关键路径控制任务 | 112 |

`pmo-source-manifest.json` 会同步写入 `pmo/gantt-react/public/pmo-source-manifest.json`，供甘特图/PMO 看板服务识别当前真源组合。

## PMO 分析模型

`pmo/organization-dynamics/` 保存组织数字化参与度十六维分型模型的 Markdown 内容真源、可编辑 SVG、HTML 预览、16:9横屏单页PPT和使用说明。该模型用于 PMO 观察部门在结构化、透明化和责任明确化过程中的参与行为，并选择差异化治理策略；它不替代组织事实真源、PMO 计划真源或正式 DLV 交付物。

PNG由 `pmo/scripts/export-organization-dynamics-png.mjs` 生成到被忽略的 `artifacts/pmo/organization-dynamics/`，不作为仓库正本。

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

PMO 看板内的“周会事项”页签用于首次周例会 W-A03 模板试运行，登记行动项、风险、问题、变更和责任池事项。该页签数据保存在浏览器本地，不回写 PMO Markdown 真源或 `tasks.json`。

独立周会行动项服务在 `apps/weekly-action-service/`，默认端口 `3002`。它用于周会行动项的服务端本机运行台账，适合多人访问同一套本机记录；该服务同样不回写 PMO Markdown 真源或 `tasks.json`。

流程地图驾驶舱的独立路由为：

```text
http://localhost:5174/#/procedure-dashboard
```

原始页面仍保留在 `pmo/procedure-management/dashboard.html`，由 PMO 服务直接读取，不另维护副本。

## 更新任务数据

1. 修改并保存 `pmo/信息化项目_计划管控真源.md`。
2. 如调整 WBS 编号、父子层级或排序，同步修改 `pmo/信息化项目_WBS结构真源.md`。
3. 如调整工作包人员分配、高压窗口或推进原则，同步修改 `pmo/信息化项目_工作平衡.md`、`pmo/信息化项目_工作开展原则.md`。
4. 如调整部门主备岗、会议、行动项、调整、升级或完成确认规则，修改 `pmo/信息化项目_协同工作规则.md`；仅调整主备岗人员时，只修改 `pmo/信息化项目_部门主备对接人名单.md`。
5. 在 `pmo/` 下运行：

```bash
python build_pmo_task_data.py
```

脚本会同时写入：

| 输出 | 用途 |
|------|------|
| `pmo/tasks.json` | PMO 根目录备份数据 |
| `pmo/gantt-react/public/tasks.json` | React 应用实际读取的数据 |
| `pmo/pmo-source-manifest.json` | PMO 真源清单 |
| `pmo/gantt-react/public/pmo-source-manifest.json` | React 服务可读取的真源清单 |

运行完成后应看到 `Wrote 516 tasks from 信息化项目_计划管控真源.md`。如任务数变化，应先确认 MD 真源是否确实发生增删。

可在仓库根目录运行以下命令，确认 PMO 根目录备份数据与 React 应用实际读取数据同源：

```bash
npm run test:pmo-task-data
```

## 数据字段

`tasks.json` 保留旧展示字段，并新增最终执行版的执行管控字段。

| 字段组 | 字段 |
|--------|------|
| 基础展示字段 | `id`、`wbs`、`name`、`type`、`duration`、`start`、`finish`、`predecessors`、`resources`、`department`、`vendor`、`reviewer`、`risk`、`milestone`、`deliverable`、`notes` |
| 执行管控字段 | `viewCategory`、`phaseGateNo`、`isCriticalControl`、`versionControlObject`、`changeLevel`、`integrationStartCondition`、`isH5Focus`、`phaseGateName`、`releaseRule`、`contractPaymentControl`、`h5DiagnosticRule`、`executionNote`、`milestoneOverrideReason` |
| 执行标准字段 | `executionStandardId`、`inputMaterialList`、`checklistId`、`completionCriteria`、`evidenceRequirements`、`standardGapFlag`、`standardDeferredReason` |
| 执行标准缺口治理字段 | `requiresExecutionStandard`、`standardsGapBucket`、`standardsGapReasons`、`standardsGapPriorityScore`、`suggestedStandardId`、`suggestedAction` |

任务真源可使用 `受控交付物编号` 指定 `deliverableId`。该字段用于把计划任务绑定到既定 `DLV-XXX-*.md` 正本，避免自动生成编号与已有受控交付物冲突；未填写时仍按任务顺序自动生成交付物编号。

## Console 与已知问题

Console 中来自 Chrome 扩展、React 开发提示的日志不作为代码缺陷处理。

甘特图诊断中的 3 个里程碑父级误判已记录在 `pmo-gantt-known-issues.md`。MD 真源对应 WBS 数据保持不因展示误判修改。

## 目录结构

```text
pmo/
├── AGENTS.md
├── README.md
├── procedure-management/
│   ├── dashboard.html
│   └── AGENTS.md
├── organization-dynamics/
│   ├── README.md
│   ├── index.html
│   ├── 组织数字化参与度十六维分型模型.md
│   ├── 组织数字化参与度十六维分型模型.svg
│   └── 组织数字化参与度十六维分型模型_横屏单页.pptx
├── gantt-react/
│   ├── AGENTS.md
│   ├── README.md
│   ├── public/tasks.json
│   ├── public/pmo-source-manifest.json
│   └── src/
├── archive/
│   └── page-snapshots/
├── tasks.json
├── pmo-source-manifest.json
├── build_pmo_task_data.py
├── pmo-gantt-known-issues.md
├── PMO项目计划管控体系建设方案_V1.md
├── WBS评审记录_V1.md
├── 信息化项目_计划管控真源.md
├── 信息化项目_WBS结构真源.md
├── 信息化项目_执行标准真源.md
├── 信息化项目_工作平衡.md
├── 信息化项目_工作开展原则.md
├── 信息化项目_协同工作规则.md
├── 信息化项目_部门主备对接人名单.md
└── 信息化项目_协同工作规则_群通知.md
```
