# AGENTS.md — 甘特图 / PMO 周会看板

`pmo/gantt-react/` 是 React + Vite 单页应用，包含 WBS 甘特图、任务清单、交付物台账、阶段门、本周交付物、延期交付物、PMO 周会视图和周会事项台账。

## 当前真源

页面运行时读取 `public/tasks.json`。该文件不手工维护，由 `pmo/build_pmo_task_data.py` 从 Markdown 真源生成。

任务真源可通过 `受控交付物编号` 字段显式绑定 `deliverableId`。调整该字段会影响交付物台账、延期交付物、上传写回和正本匹配，必须重新生成任务数据并运行交付物相关 smoke。

| 真源 | 作用 |
|---|---|
| `../信息化项目_计划管控真源.md` | 计划、资源、风险、阶段门和执行字段 |
| `../信息化项目_WBS结构真源.md` | WBS 编号、父子层级和排序 |
| `../信息化项目_工作平衡.md` | 人员分配、例会把关机制和高压窗口 |
| `../信息化项目_工作开展原则.md` | PMO 推进原则、协同边界和闭环规则 |
| `../信息化项目_执行标准真源.md` | 执行标准卡、检查清单、完成判定和证据要求 |

`public/pmo-source-manifest.json` 是服务侧真源清单。历史 XLSX / MPP / CSV 任务导入文件已废弃，不作为当前输入。

## 数据更新

1. 修改对应 PMO Markdown 真源。
2. 回到 `pmo/` 目录运行：

```powershell
python build_pmo_task_data.py
```

3. 回到仓库根目录运行：

```powershell
npm run test:pmo-task-data
```

脚本会写入 `tasks.json`、`pmo-source-manifest.json`、`gantt-react/public/tasks.json` 和 `gantt-react/public/pmo-source-manifest.json`。不要手改这些生成文件。

## 开发命令

```powershell
npm run dev
npm run build
npm run preview
```

开发模式默认访问 `http://localhost:5174`。

## 交付物 dev 模式

`pmo/deliverables/DLV-XXX-*.md` 是交付物状态正本。dev 模式通过 Vite 插件读取和写回正本，上传原件、状态快照和运行历史默认进入仓库根目录下被忽略的 `artifacts/pmo/deliverables/`。

## 注意事项

- 不因 `pmo-gantt-known-issues.md` 中记录的展示层误判修改 Markdown 真源。
- PMO 周会视图依赖 `tasks.json` 中的阶段门、关键路径、风险、交付物和执行管控字段。
- 本周交付物和 PMO 周会里的本周 A/B 交付物统一按例会周期计算：周四到下周三。
- 周会事项台账用于 W-A03 模板试运行，登记数据只保存在浏览器本地 `localStorage`，不回写 `tasks.json`、PMO Markdown 真源或 MDM 数据库。
- 修改接口、插件、数据字段、前端行为或测试命令时，必须同步更新 `README.md` 和本文件。
