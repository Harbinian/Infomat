# CLAUDE.md — PMO 数字化底座

`pmo/` 目录包含昌兴复材项目管理办公室（PMO）数字化底座，含两个独立模块。

## 目录结构

```
pmo/
├── CLAUDE.md                          # 本文件 — PMO 总览
├── README.md                          # 甘特图说明
├── procedure-management/              # 模块 A：流程地图驾驶舱
│   ├── CLAUDE.md                      #   驾驶舱开发指南
│   └── dashboard.html                 #   主驾驶舱 (单文件 HTML)
├── gantt-react/                       # 模块 B：甘特图应用 (React + Vite)
│   ├── README.md                      #   甘特图开发指南
│   ├── src/                           #   源码
│   └── package.json                   #   依赖与脚本
├── tasks.json                         # 甘特图/PMO 看板任务数据 (516 条, 由 MD 真源生成)
├── pmo-source-manifest.json           # PMO 服务读取的真源清单
├── 信息化项目_计划管控真源.md           # 计划、资源、风险、阶段门和执行字段真源
├── 信息化项目_WBS结构真源.md            # WBS 编号、父子层级和排序真源
├── 信息化项目_执行标准真源.md            # 执行标准卡、检查清单、完成判定和证据要求真源
├── 信息化项目_工作平衡.md               # 人员分配、例会把关机制和高压窗口
├── 信息化项目_工作开展原则.md           # PMO 推进原则、协同边界和闭环规则
├── build_pmo_task_data.py             # MD 真源 → tasks.json / 服务清单生成脚本
├── build-standalone.js                # 生成内嵌数据版 HTML
├── report_no_pred_tasks.py            # 无前置任务报告脚本
├── pmo-gantt-known-issues.md          # 甘特图已知不修/误判记录
├── PMO项目计划管控体系建设方案_V1.md
└── WBS评审记录_V1.md                   # WBS 评审记录
```

## 模块 A：流程地图驾驶舱

**单文件 HTML 应用**，桑基图驱动的业务能力→流程→系统映射驾驶舱。

- **启动**：直接双击 `procedure-management/dashboard.html`（file:// 协议），或 `cd procedure-management && python -m http.server 8080`
- **依赖**：`../../echarts.min.js`（项目根目录，相对 dashboard.html 的路径）
- **数据**：内嵌 JSON（`#sankey-data` 和 `#cross-dept-data`），无需外部数据文件

## 模块 B：甘特图应用

**React + Vite 单页应用**，基于 Canvas 2D 的 WBS 甘特图看板。

- **启动**：`cd gantt-react && npm run dev` → `http://localhost:5174/`
- **构建**：`cd gantt-react && npm run build`
- **数据流**：`信息化项目_计划管控真源.md` + `信息化项目_WBS结构真源.md` → `build_pmo_task_data.py` → `tasks.json` / `gantt-react/public/tasks.json` → 甘特图/PMO 看板渲染
- **服务清单**：`pmo-source-manifest.json` 同步写入 `gantt-react/public/pmo-source-manifest.json`，记录计划管控、WBS结构、执行标准、工作平衡、工作开展原则五类 MD 入口
- **当前数据**：516 条任务，53 个字段

### 模块 B 扩展:动态凭证消费 (2026-06-05+)

`pmo/deliverables/DLV-XXX-*.md` 是交付物状态正本。5174 dev 模式通过 Vite 插件 `pmoDeliverablesPlugin` 扫目录、暴露 6 个 `/api/pmo/deliverables*` 端点、用 Vite 内置 watcher 发 HMR。前端优先读取正本文件,服务端 `applyTransitionToFile` 跑状态机并写回 .md frontmatter + body 变更记录表。

- 真源:`pmo/deliverables/DLV-XXX-*.md`(frontmatter + body)
- 运行归档:`artifacts/pmo/deliverables/_history/DLV-XXX/<ts>-<kind>-<suffix>`；可用 `PMO_DELIVERABLE_RUNTIME_DIR` 覆盖
- dev-only:`apply: 'serve'`,生产构建降级到 WBS 字段/旧覆盖层
- 兜底:API 正本 → `deliverable-status.json` → `tasks.json` 默认 DLV 字段
- 测试:`npm run test:frontmatter` / `test:writeback` / `test:plugin` / `test:hmr`

## 数据更新流程

### 甘特图数据更新

1. 修改 `信息化项目_计划管控真源.md`；如调整 WBS 编号/层级，同步修改 `信息化项目_WBS结构真源.md`
2. 如调整人员分配或推进机制，同步修改 `信息化项目_工作平衡.md`、`信息化项目_工作开展原则.md`
3. 运行 `python build_pmo_task_data.py` 重新生成 `tasks.json`、`gantt-react/public/tasks.json` 和 `pmo-source-manifest.json`
4. 确认输出为 `Wrote 516 tasks from 信息化项目_计划管控真源.md`（如任务数变化，先核对 MD 真源）
5. 刷新浏览器

### 甘特图已知问题

- 生产构建不输出 React 开发提示和 `analyzeTasks()` 诊断日志。
- 3 个 WBS 里程碑父级误判记录在 `pmo-gantt-known-issues.md`，属于展示层启发式误判，MD 真源不因该误判修改。

### 驾驶舱数据更新

1. 修改 `docs/norms/{部门}部门-能力-流程-系统映射关系.md` 或跨部门完整性报告。
2. 在仓库根目录运行 `node scripts/parse-sankey-data.mjs`。
3. 脚本会直接更新 `procedure-management/dashboard.html` 内嵌的 `#sankey-data` 和 `#cross-dept-data`。

## 技术栈

| 模块 | 技术 |
|------|------|
| 流程地图驾驶舱 | 原生 HTML/CSS/JS + ECharts 5.x |
| 甘特图 | React 19 + Vite 8 + Canvas 2D API |

两个模块生产产物均为纯静态前端。`gantt-react` 在 dev 模式额外启用 Vite 文件系统插件,用于本地 PMO 正本文件读写。
