# CLAUDE.md — 流程地图驾驶舱

## 概述

`procedure-management/` 包含昌兴复材流程地图驾驶舱（PMO Dashboard），是面向项目管理办公室的单页可视化工具。

## 文件

| 文件 | 用途 |
|------|------|
| `dashboard.html` | 主驾驶舱 — 单文件 HTML，内联 CSS/JS + ECharts，无构建步骤 |
| `CLAUDE.md` | 本文件 |

## 启动方式

**方式一：直接双击打开（推荐）**

双击 `dashboard.html` 即可在浏览器中打开，数据内嵌在 HTML 中。

**方式二：本地 HTTP 服务**

```bash
cd pmo/procedure-management
python -m http.server 8080
```

访问 http://localhost:8080/dashboard.html

## 数据源

驾驶舱从两个内嵌 JSON 数据源读取：

1. **`#sankey-data`** — 流程→系统桑基图数据（节点 + 链接 + 统计），由 `scripts/parse-sankey-data.mjs` 直接注入
2. **`#cross-dept-data`** — 跨部门衔接风险数据，由 `scripts/parse-sankey-data.mjs` 从 `../../docs/norms/流程治理/跨部门完整性检查报告.md` 解析并注入

两个数据均以 `<script type="application/json" id="...">` 内嵌在 HTML 中，避免 CORS / 离线打开问题。

## 与 PMO 项目看板的边界

`procedure-management/dashboard.html` 是流程地图驾驶舱，真源仍来自 `docs/norms/{部门}部门-能力-流程-系统映射关系.md` 和跨部门完整性检查报告。

甘特图 / PMO 周会看板的项目计划真源不在本目录维护，当前入口为：

| 真源 | 作用 |
|---|---|
| `../信息化项目_计划管控真源.md` | 计划、资源、风险、阶段门和执行字段 |
| `../信息化项目_WBS结构真源.md` | WBS 编号、父子层级和排序 |
| `../信息化项目_工作平衡.md` | 人员分配、例会把关机制和高压窗口 |
| `../信息化项目_工作开展原则.md` | PMO 推进原则、协同边界和闭环规则 |

修改上述 PMO 项目真源后，应在 `pmo/` 下运行 `python build_pmo_task_data.py`，将数据输入 `gantt-react/public/tasks.json` 和 `gantt-react/public/pmo-source-manifest.json`。

## 数据更新流程

### 更新桑基图数据

1. 在仓库根目录运行 `node scripts/parse-sankey-data.mjs`。
2. 脚本会自动注入 `#sankey-data` / `#cross-dept-data` 并更新 dashboard.html。

### 更新跨部门衔接数据

1. 更新 `docs/norms/流程治理/跨部门完整性检查报告.md`。
2. 在仓库根目录运行 `node scripts/parse-sankey-data.mjs`，由脚本重新生成并注入 `#cross-dept-data`。
3. 运行 `node scripts/check-dashboard-data.mjs`，确认驾驶舱内嵌数据与报告派生统计一致。

## 页面结构

```
┌─ top ──────────────────────────────────────────┐
│ 标题 · 副标题          模式切换 · 数据快照        │
├─ left ───┬─ main ───────────────────┬─ right ──┤
│ 视图模式  │ KPI 卡片 (3×3=9)         │ 关键发现  │
│ 域选择    │ 图表行 (donut/bar/bar)   │           │
│ 数据范围  │ 表格行 (负载+待补全)      │           │
│ 风险筛选  │ 跨部门衔接风险表          │           │
│ 图例      │                          │           │
│ 口径说明  │                          │           │
├─ foot ──────────────────────────────────────────┤
│ 范围 · 节点 · 关系 · 承载映射     渲染状态 · 耗时 │
└─────────────────────────────────────────────────┘
```

## 关键函数

| 函数 | 职责 |
|------|------|
| `computeMetrics()` | 从 Sankey 数据计算所有 KPI 指标 |
| `renderKPIs(m)` | 渲染 9 张 KPI 卡片（前 6 张动态，后 3 张静态） |
| `renderCharts(m)` | 渲染 ECharts 图表（donut / system bar / dept bar） |
| `renderTables(m)` | 渲染部门工作负载表和待补全表 |
| `renderCrossDeptTable()` | 渲染跨部门衔接风险表（从 `crossDeptData` 读取） |
| `renderInsights(m)` | 渲染右侧关键发现（含跨部门衔接发现） |
| `applyFilter()` | 域筛选 — BFS 可达性传播 |
| `openDeptModal(name)` | 打开部门详情模态（流程→系统矩阵） |

## 状态变量

- `state.raw` — Sankey 原始数据
- `state.nodesByName` — 节点名→分类信息映射
- `state.links` — 所有链接
- `state.filter` — `{ mode: 'all'|'domain', domain: string|null }`
- `crossDeptData` — 跨部门衔接数据
- `crossFilter` — `{ risk: 'all'|'high'|'medium'|'low' }`

## 依赖

- **ECharts 5.x** — `../../echarts.min.js`（项目根目录，图表渲染）
- 无其他外部依赖；纯静态 HTML，浏览器直接打开即可

## 注意事项

- 文件约 1900+ 行，内联所有 CSS/JS，修改时注意行号偏移
- 缩进使用 2 空格（不是 tab）
- 驾驶舱设计风格统一使用 CSS 变量（`--bg`, `--ink`, `--c-biz` 等），新增 UI 应遵循同一套变量
- KPI 卡片网格为 3 列布局，新增卡片注意保持 3 的倍数
- 跨部门数据中的中文引号（""）是 Unicode 全角字符，不是 ASCII 双引号，不要替换
- 域筛选重置时需同步重置风险筛选
