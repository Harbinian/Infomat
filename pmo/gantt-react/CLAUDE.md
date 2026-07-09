# CLAUDE.md — 甘特图 / PMO 周会看板

`gantt-react/` 是 React + Vite 单页应用，包含 WBS 甘特图、任务清单、交付物台账、阶段门、本周交付物、延期交付物和 PMO 周会视图。

## 当前真源

页面运行时读取 `public/tasks.json`。该文件不手工维护，由 `pmo/build_pmo_task_data.py` 从 Markdown 真源生成。

| 真源 | 作用 |
|---|---|
| `../信息化项目_计划管控真源.md` | 计划、资源、风险、阶段门和执行字段 |
| `../信息化项目_WBS结构真源.md` | WBS 编号、父子层级和排序 |
| `../信息化项目_工作平衡.md` | 人员分配、例会把关机制和高压窗口 |
| `../信息化项目_工作开展原则.md` | PMO 推进原则、协同边界和闭环规则 |

`public/pmo-source-manifest.json` 是服务侧真源清单，记录上述四份 MD 的入口和摘要。历史 XLSX / MPP / CSV 任务导入文件已废弃，不作为当前输入、不再保留或读取。

## 数据更新

1. 修改 `../信息化项目_计划管控真源.md`。
2. 如涉及 WBS 编号、父子层级、排序或摘要/里程碑结构，同步修改 `../信息化项目_WBS结构真源.md`。
3. 如涉及人员分配、例会把关机制、高压窗口或推进原则，同步修改 `../信息化项目_工作平衡.md`、`../信息化项目_工作开展原则.md`。
4. 回到 `pmo/` 目录运行：

```bash
python build_pmo_task_data.py
```

脚本会写入：

| 输出 | 用途 |
|---|---|
| `../tasks.json` | PMO 根目录备份数据 |
| `public/tasks.json` | 本应用实际读取的任务数据 |
| `public/pmo-source-manifest.json` | 本应用可读取的 PMO 真源清单 |

运行完成后应看到 `Wrote 516 tasks from 信息化项目_计划管控真源.md`。

## 开发命令

```bash
npm run dev
npm run build
npm run preview
```

开发模式默认访问 `http://localhost:5174`。

## 注意事项

- 不手改 `public/tasks.json`，应改 MD 真源后重新生成。
- 不因 `pmo-gantt-known-issues.md` 中记录的 3 个展示层误判修改 MD 真源。
- PMO 周会视图依赖 `tasks.json` 中的阶段门、关键路径、风险、交付物和执行管控字段。
