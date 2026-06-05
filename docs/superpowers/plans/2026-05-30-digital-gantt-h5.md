# 数字化底座项目 H5 甘特图 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 `pmo/信息化项目.csv`（313 条任务）构建深色科技风可交互 H5 甘特图看板，纯静态单文件架构。

**Architecture:** 单文件 `index.html`（内嵌 CSS + JS），通过 `fetch` 加载 `tasks.json`。Canvas 2D 绘制甘特条，左侧 DOM 任务树固定，右侧 Canvas 横向滚动。内存中筛选/排序，无后端依赖。

**Tech Stack:** HTML5 + CSS3 + Vanilla JS (ES6+) + Canvas 2D API。零框架、零构建、零 CDN。

**Spec:** `docs/superpowers/specs/2026-05-30-digital-gantt-h5-design.md`

---

## 文件结构

```
digital-gantt-h5/
├── index.html          # 单文件完整应用
├── tasks.json          # CSV 转换后的 JSON 数据
├── convert.js          # CSV → JSON 转换脚本
└── README.md           # 使用说明
```

所有应用逻辑在 `index.html` 内，按以下代码区组织：

| 代码区 | 行号范围（约） | 职责 |
|--------|--------------|------|
| CSS 样式 | `<style>` ~400 行 | 深色主题、卡片布局、左侧固定列、滚动同步 |
| 配置常量 | JS 开头 ~30 行 | 颜色映射、月宽、行高、项目起始日期 |
| 工具函数 | `// --- Utils ---` ~60 行 | 日期解析、WBS 解析、去重、排序 |
| 数据管理 | `// --- Data ---` ~80 行 | 加载 JSON、构建树、筛选、统计 |
| DashboardCards | `// --- Dashboard ---` ~50 行 | 7 个指标卡片渲染 |
| FilterBar | `// --- Filters ---` ~120 行 | 筛选器 + 搜索 + 视图切换按钮 |
| TaskTree | `// --- TaskTree ---` ~100 行 | 左侧固定列 WBS 树 DOM 生成 |
| GanttChart | `// --- Gantt ---` ~300 行 | Canvas 绘制 + 滚动同步 + 悬停检测 |
| TaskDetail | `// --- Detail ---` ~80 行 | 右侧滑出详情面板 |
| MilestoneList | `// --- Milestones ---` ~40 行 | 底部里程碑汇总 |
| 初始化 | `// --- Init ---` ~40 行 | 事件绑定、首次渲染 |

---

### Task 1: 创建 CSV → JSON 转换脚本

**Files:**
- Create: `digital-gantt-h5/convert.js`

- [ ] **Step 1: 创建目录并编写 convert.js**

```bash
mkdir -p digital-gantt-h5
```

```javascript
// digital-gantt-h5/convert.js
// 用法: node convert.js
// 读取 pmo/信息化项目.csv，输出 digital-gantt-h5/tasks.json

const fs = require('fs');
const path = require('path');

const csvPath = path.resolve(__dirname, '..', 'pmo', '信息化项目.csv');
const jsonPath = path.resolve(__dirname, 'tasks.json');

const csvText = fs.readFileSync(csvPath, 'utf-8');

// 简单 CSV 解析（字段不含逗号/引号嵌套）
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',');
    const row = {};
    headers.forEach((h, j) => {
      row[h.trim()] = (vals[j] || '').trim();
    });
    // 跳过空行
    if (row['任务名称']) rows.push(row);
  }
  return rows;
}

function transformRow(row) {
  return {
    id: parseInt(row['ID']) || 0,
    wbs: row['WBS'] || '',
    name: row['任务名称'] || '',
    type: row['任务类型'] || '',
    duration: row['工期'] || '',
    start: row['开始时间'] || '',
    finish: row['完成时间'] || '',
    predecessors: row['前置任务'] || '',
    resources: row['资源名称'] || '',
    department: row['责任部门'] || '',
    vendor: row['供应商'] || '',
    reviewer: row['审核人/审批组'] || '',
    risk: row['风险等级'] || '中',
    milestone: row['里程碑'] || '否',
    deliverable: row['交付物'] || '',
    notes: row['备注'] || ''
  };
}

const raw = parseCSV(csvText);
const tasks = raw.map(transformRow);

fs.writeFileSync(jsonPath, JSON.stringify(tasks, null, 2), 'utf-8');
console.log(`Converted ${tasks.length} tasks to ${jsonPath}`);
```

- [ ] **Step 2: 运行转换脚本验证**

```bash
cd digital-gantt-h5 && node convert.js
```

Expected: `Converted 313 tasks to ...tasks.json`

- [ ] **Step 3: 验证 tasks.json 数据结构**

```bash
node -e "const t=require('./tasks.json'); console.log('Count:', t.length); console.log('Sample:', JSON.stringify(t[0], null, 2)); console.log('Milestones:', t.filter(x=>x.milestone==='是').length); console.log('High risk:', t.filter(x=>x.risk==='高').length)"
```

Expected: Count=313, Milestones>0, High risk>0

- [ ] **Step 4: Commit**

```bash
git add digital-gantt-h5/convert.js digital-gantt-h5/tasks.json
git commit -m "feat: add CSV to JSON converter for digital project gantt data"
```

---

### Task 2: 创建 HTML 骨架与深色主题 CSS

**Files:**
- Create: `digital-gantt-h5/index.html`

- [ ] **Step 1: 编写 HTML 骨架与完整 CSS**

创建 `digital-gantt-h5/index.html`，包含以下结构：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>数字化底座项目甘特图</title>
<style>
/* ===== Reset & Base ===== */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  background: #0f1119; color: #c8ccd4; overflow: hidden; height: 100vh;
}

/* ===== Header ===== */
.header { background: #161822; padding: 16px 24px; border-bottom: 1px solid #2a2d3a; }
.header h1 { font-size: 22px; font-weight: 700; color: #e8eaed; letter-spacing: 1px; }
.header .subtitle { font-size: 13px; color: #6b7194; margin-top: 4px; }

/* ===== Dashboard Cards ===== */
.dashboard { display: flex; gap: 12px; padding: 12px 24px; background: #141720; border-bottom: 1px solid #2a2d3a; flex-wrap: wrap; }
.stat-card { background: #1c1f2e; border: 1px solid #2a2d3a; border-radius: 8px; padding: 12px 18px; min-width: 120px; flex: 1; }
.stat-card .stat-value { font-size: 28px; font-weight: 700; color: #e8eaed; }
.stat-card .stat-label { font-size: 11px; color: #6b7194; margin-top: 2px; text-transform: uppercase; }
.stat-card.highlight { border-color: #e74c3c; }
.stat-card.highlight .stat-value { color: #e74c3c; }

/* ===== Filter Bar ===== */
.filter-bar { display: flex; gap: 8px; padding: 10px 24px; background: #161822; border-bottom: 1px solid #2a2d3a; flex-wrap: wrap; align-items: center; }
.filter-bar select, .filter-bar input {
  background: #1c1f2e; color: #c8ccd4; border: 1px solid #2a2d3a; border-radius: 6px;
  padding: 6px 10px; font-size: 13px; outline: none;
}
.filter-bar select:focus, .filter-bar input:focus { border-color: #4A90D9; }
.filter-bar input[type="text"] { width: 200px; }
.view-btns { display: flex; gap: 4px; margin-left: auto; }
.view-btns button {
  background: #1c1f2e; color: #8b90a0; border: 1px solid #2a2d3a; border-radius: 6px;
  padding: 6px 12px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.view-btns button:hover { color: #e8eaed; border-color: #4A90D9; }
.view-btns button.active { background: #1a3a5c; color: #4A90D9; border-color: #4A90D9; }

/* ===== Main Layout ===== */
.main-container { display: flex; height: calc(100vh - 230px); position: relative; overflow: hidden; }

/* ===== Task Tree (Left Panel) ===== */
.task-tree-panel {
  width: 340px; min-width: 340px; background: #141720; border-right: 1px solid #2a2d3a;
  overflow-y: auto; overflow-x: hidden; flex-shrink: 0;
}
.task-tree-panel::-webkit-scrollbar { width: 6px; }
.task-tree-panel::-webkit-scrollbar-thumb { background: #2a2d3a; border-radius: 3px; }

/* Tree Header */
.tree-header {
  position: sticky; top: 0; z-index: 2; background: #161822; border-bottom: 1px solid #2a2d3a;
  display: flex; padding: 8px 12px; font-size: 11px; color: #6b7194; font-weight: 600;
}
.tree-header .col-wbs { width: 60px; flex-shrink: 0; }
.tree-header .col-name { flex: 1; }

/* Tree Node */
.tree-node { display: flex; align-items: center; padding: 0; border-bottom: 1px solid #1a1d2a; cursor: pointer; min-height: 32px; }
.tree-node:hover { background: #1c1f30; }
.tree-node.selected { background: #1a3048; border-left: 3px solid #4A90D9; }
.tree-node .col-wbs { width: 60px; flex-shrink: 0; padding: 4px 6px; font-size: 11px; color: #6b7194; font-family: monospace; }
.tree-node .col-name { flex: 1; padding: 4px 6px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tree-node .toggle-icon { width: 18px; flex-shrink: 0; text-align: center; font-size: 10px; color: #6b7194; cursor: pointer; user-select: none; }
.tree-node.level-1 { font-weight: 700; font-size: 13px; background: #181b28; }
.tree-node.level-1 .col-name { font-size: 13px; }
.tree-node.level-2 .col-name { font-size: 12px; padding-left: 12px; }
.tree-node.level-3 .col-name { padding-left: 24px; }
.tree-node.level-4 .col-name { padding-left: 36px; }
.tree-node.type-milestone .col-name { color: #f4b400; }
.tree-node.risk-high .col-wbs { color: #e74c3c; }
.tree-node.hidden { display: none; }

/* ===== Gantt Panel (Right) ===== */
.gantt-panel { flex: 1; overflow: auto; position: relative; background: #141720; }
.gantt-panel::-webkit-scrollbar { width: 8px; height: 8px; }
.gantt-panel::-webkit-scrollbar-thumb { background: #2a2d3a; border-radius: 4px; }
.gantt-panel::-webkit-scrollbar-corner { background: #141720; }
.gantt-canvas { display: block; }

/* ===== Task Detail Panel ===== */
.detail-overlay { display: none; position: fixed; top: 0; right: 0; width: 420px; height: 100vh;
  background: #161822; border-left: 1px solid #2a2d3a; z-index: 100; overflow-y: auto;
  box-shadow: -4px 0 24px rgba(0,0,0,0.5); }
.detail-overlay.open { display: block; }
.detail-header { display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #2a2d3a; position: sticky; top: 0;
  background: #161822; z-index: 1; }
.detail-header h3 { font-size: 16px; color: #e8eaed; }
.detail-close { background: none; border: none; color: #6b7194; font-size: 20px; cursor: pointer; }
.detail-close:hover { color: #e74c3c; }
.detail-body { padding: 16px 20px; }
.detail-field { margin-bottom: 14px; }
.detail-field label { display: block; font-size: 11px; color: #6b7194; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; }
.detail-field .value { font-size: 14px; color: #c8ccd4; word-break: break-all; }
.detail-field .value.badge {
  display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 12px; font-weight: 600;
}
.detail-field .value.risk-高 { background: #3d1f1f; color: #e74c3c; }
.detail-field .value.risk-中 { background: #3d3010; color: #f4b400; }
.detail-field .value.risk-低 { background: #1a3026; color: #4CAF50; }
.detail-field .value.tag-milestone { background: #3d3010; color: #f4b400; }

/* ===== Milestone List ===== */
.milestone-panel { background: #141720; border-top: 1px solid #2a2d3a; padding: 10px 24px; max-height: 150px; overflow-y: auto; }
.milestone-panel h3 { font-size: 13px; color: #6b7194; margin-bottom: 8px; }
.milestone-list { display: flex; gap: 12px; flex-wrap: wrap; }
.milestone-item { font-size: 12px; background: #1c1f2e; border-left: 3px solid #f4b400; padding: 6px 12px; border-radius: 4px; white-space: nowrap; }
.milestone-item .ms-date { color: #f4b400; font-weight: 600; margin-right: 6px; }
.milestone-item .ms-name { color: #c8ccd4; }

/* ===== Tooltip ===== */
.gantt-tooltip { display: none; position: fixed; pointer-events: none; z-index: 200;
  background: #1c1f2e; border: 1px solid #4A90D9; border-radius: 8px; padding: 12px 16px;
  max-width: 360px; box-shadow: 0 4px 16px rgba(0,0,0,0.5); }
.gantt-tooltip .tt-name { font-size: 14px; font-weight: 600; color: #e8eaed; margin-bottom: 6px; }
.gantt-tooltip .tt-row { font-size: 12px; color: #8b90a0; margin-bottom: 3px; }
.gantt-tooltip .tt-row span { color: #c8ccd4; }

/* ===== Loading ===== */
.loading { display: flex; justify-content: center; align-items: center; height: 100vh; font-size: 16px; color: #6b7194; }
.loading::after { content: ''; animation: dots 1.5s steps(4, end) infinite; }
@keyframes dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }
</style>
</head>
<body>

<div class="header">
  <h1>数字化底座项目甘特图</h1>
  <div class="subtitle">2026.06.01 — 2028.01.31 ｜ 数据来源：信息化项目.csv ｜ 草案状态</div>
</div>

<div class="dashboard" id="dashboard"></div>

<div class="filter-bar" id="filterBar"></div>

<div class="main-container">
  <div class="task-tree-panel" id="taskTreePanel">
    <div class="tree-header">
      <span class="col-wbs">WBS</span>
      <span class="col-name">任务名称</span>
    </div>
    <div id="taskTree"></div>
  </div>
  <div class="gantt-panel" id="ganttPanel">
    <canvas id="ganttCanvas" class="gantt-canvas"></canvas>
  </div>
</div>

<div class="milestone-panel" id="milestonePanel">
  <h3>关键里程碑</h3>
  <div class="milestone-list" id="milestoneList"></div>
</div>

<div class="detail-overlay" id="detailOverlay">
  <div class="detail-header">
    <h3>任务详情</h3>
    <button class="detail-close" id="detailClose">&times;</button>
  </div>
  <div class="detail-body" id="detailBody"></div>
</div>

<div class="gantt-tooltip" id="ganttTooltip"></div>
<div class="loading" id="loading">数据加载中</div>

<script>
// ===== 占位：后续 Task 在此插入 JS =====
document.getElementById('loading').style.display = 'none';
</script>

</body>
</html>
```

- [ ] **Step 2: 初始化 git，验证文件存在**

```bash
ls -la digital-gantt-h5/index.html
```

- [ ] **Step 3: Commit**

```bash
git add digital-gantt-h5/index.html
git commit -m "feat: add gantt HTML skeleton with dark theme CSS and layout structure"
```

---

### Task 3: 实现配置常量、工具函数与数据加载

**Files:**
- Modify: `digital-gantt-h5/index.html` — 替换 `<script>` 区域

- [ ] **Step 1: 在 `</style>` 后、`</head>` 前的 `<script>` 中实现**

在 `<script>` 标签内写入以下代码块：

```javascript
// ===== 配置常量 =====
const PROJECT_START = new Date(2026, 5, 1);  // 2026-06-01
const PROJECT_END = new Date(2028, 1, 31);    // 2028-01-31
const MONTH_WIDTH = 82;    // 每月像素宽度
const ROW_HEIGHT = 32;     // 每行像素高度
const HEADER_HEIGHT = 44;  // 顶部月轴高度
const TREE_PANEL_WIDTH = 340;

const WBS_COLORS = {
  '1': '#4A90D9', '2': '#5C8AD8', '3': '#00BCD4', '4': '#9C27B0', '5': '#607D8B',
  '6': '#4CAF50', '7': '#E91E63', '8': '#FF9800', '9': '#795548', '10': '#7C4DFF'
};

function getWbsColor(wbs) {
  const top = String(wbs).split('.')[0];
  return WBS_COLORS[top] || '#6b7194';
}

function getWbsLevel(wbs) {
  if (!wbs) return 1;
  return String(wbs).split('.').length;
}

function getTopWbs(wbs) {
  return String(wbs).split('.')[0];
}

// ===== 日期解析 =====
function parseDate(str) {
  if (!str || str.trim() === '') return null;
  str = str.trim();
  // 2026-06-01
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  // 2026/6/1
  m = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  // 2026年6月1日
  m = str.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

function formatDate(date) {
  if (!date) return '日期未设置';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ===== 项目时间轴计算 =====
function getTotalMonths() {
  return (PROJECT_END.getFullYear() - PROJECT_START.getFullYear()) * 12
    + (PROJECT_END.getMonth() - PROJECT_START.getMonth()) + 1;
}

function getMonthLabels() {
  const labels = [];
  let d = new Date(PROJECT_START);
  const total = getTotalMonths();
  for (let i = 0; i < total; i++) {
    labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return labels;
}

function getXForDate(date) {
  if (!date) return -1;
  const months = (date.getFullYear() - PROJECT_START.getFullYear()) * 12
    + (date.getMonth() - PROJECT_START.getMonth());
  const dayFrac = (date.getDate() - 1) / daysInMonth(date.getFullYear(), date.getMonth());
  return months * MONTH_WIDTH + dayFrac * MONTH_WIDTH;
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

// ===== 去重与排序 =====
function unique(arr) { return [...new Set(arr)]; }

// ===== 任务树构建 =====
function buildTaskTree(tasks) {
  const map = {};
  const roots = [];
  // 先建索引
  tasks.forEach(t => { map[t.wbs] = { ...t, children: [], _visible: true, _expanded: true }; });
  // 建父子关系
  tasks.forEach(t => {
    const node = map[t.wbs];
    const parts = String(t.wbs).split('.');
    if (parts.length <= 1) {
      roots.push(node);
    } else {
      const parentWbs = parts.slice(0, -1).join('.');
      const parent = map[parentWbs];
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node); // 孤儿节点挂到根
      }
    }
  });
  // 三级及以下默认折叠
  function walk(nodes) {
    nodes.forEach(n => {
      if (getWbsLevel(n.wbs) >= 3) n._expanded = false;
      walk(n.children);
    });
  }
  walk(roots);
  return { roots, map };
}

// ===== 数据状态 =====
let allTasks = [];
let treeData = null;
let filteredTasks = [];
let selectedTaskWbs = null;
let currentFilters = {
  year: 'all',
  mainline: 'all',
  department: 'all',
  vendor: 'all',
  risk: 'all',
  type: 'all',
  milestone: 'all',
  search: ''
};
let currentView = 'all';

// ===== 加载数据 =====
async function loadData() {
  try {
    const resp = await fetch('tasks.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    allTasks = await resp.json();
    treeData = buildTaskTree(allTasks);
    filteredTasks = [...allTasks];
    document.getElementById('loading').style.display = 'none';
    return true;
  } catch (err) {
    document.getElementById('loading').textContent = '数据加载失败：' + err.message;
    console.error('Load error:', err);
    return false;
  }
}
```

- [ ] **Step 2: 验证：用浏览器打开 index.html 查看控制台无报错**

```bash
echo "Open digital-gantt-h5/index.html in browser, check console for no errors"
```

- [ ] **Step 3: Commit**

```bash
git add digital-gantt-h5/index.html
git commit -m "feat: add config constants, date utils, tree builder, and data loader"
```

---

### Task 4: 实现 DashboardCards 统计卡片

**Files:**
- Modify: `digital-gantt-h5/index.html` — 在 `<script>` 中添加 Dashboard 区域代码

- [ ] **Step 1: 添加统计计算与渲染函数**

在 `<script>` 的配置/工具函数之后添加：

```javascript
// ===== Dashboard =====
function calcStats(tasks) {
  const now = new Date();
  const milestones = tasks.filter(t => t.milestone === '是' || t.duration === '0工作日');
  const highRisk = tasks.filter(t => t.risk === '高');
  const inProgress = tasks.filter(t => {
    const s = parseDate(t.start);
    const f = parseDate(t.finish);
    if (!s || !f) return false;
    return s <= now && f >= now;
  });
  const crossYear = tasks.filter(t => {
    const s = parseDate(t.start);
    const f = parseDate(t.finish);
    if (!s || !f) return false;
    return s.getFullYear() !== f.getFullYear();
  });
  const depts = unique(tasks.map(t => t.department).filter(Boolean));
  const vendors = unique(tasks.map(t => t.vendor).filter(Boolean));
  return {
    total: tasks.length,
    milestones: milestones.length,
    highRisk: highRisk.length,
    inProgress: inProgress.length,
    crossYear: crossYear.length,
    departments: depts.length,
    vendors: vendors.length
  };
}

function renderDashboard(tasks) {
  const stats = calcStats(tasks);
  const cards = [
    { value: stats.total, label: '总任务数', cls: '' },
    { value: stats.milestones, label: '里程碑', cls: '' },
    { value: stats.highRisk, label: '高风险任务', cls: 'highlight' },
    { value: stats.inProgress, label: '当前进行中', cls: '' },
    { value: stats.crossYear, label: '已跨年任务', cls: '' },
    { value: stats.departments, label: '责任部门', cls: '' },
    { value: stats.vendors, label: '供应商', cls: '' }
  ];
  document.getElementById('dashboard').innerHTML = cards.map(c =>
    `<div class="stat-card ${c.cls}">
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
    </div>`
  ).join('');
}
```

- [ ] **Step 2: Commit**

```bash
git add digital-gantt-h5/index.html
git commit -m "feat: add dashboard statistics cards with 7 metrics"
```

---

### Task 5: 实现 FilterBar 筛选器 + 视图切换

**Files:**
- Modify: `digital-gantt-h5/index.html` — 在 `<script>` 中添加 FilterBar 代码

- [ ] **Step 1: 添加筛选器渲染与过滤逻辑**

```javascript
// ===== Filters =====
function getFilterOptions(tasks) {
  return {
    mainlines: unique(tasks.map(t => getTopWbs(t.wbs)).filter(Boolean)).sort((a,b) => +a - +b),
    departments: unique(tasks.map(t => t.department).filter(Boolean)).sort(),
    vendors: unique(tasks.map(t => t.vendor).filter(Boolean)).sort(),
    types: unique(tasks.map(t => t.type).filter(Boolean)).sort()
  };
}

function applyFilters() {
  let tasks = [...allTasks];

  // 年份筛选
  if (currentFilters.year !== 'all') {
    const yr = parseInt(currentFilters.year);
    tasks = tasks.filter(t => {
      const s = parseDate(t.start);
      const f = parseDate(t.finish);
      if (!s && !f) return false;
      return (s && s.getFullYear() === yr) || (f && f.getFullYear() === yr);
    });
  }

  // 视图预设
  if (currentView === 'overview') {
    tasks = tasks.filter(t => {
      const lvl = getWbsLevel(t.wbs);
      return lvl <= 2 || t.milestone === '是' || t.duration === '0工作日';
    });
  } else if (currentView === 'milestones') {
    tasks = tasks.filter(t => t.milestone === '是' || t.duration === '0工作日');
  } else if (currentView === 'highrisk') {
    tasks = tasks.filter(t => t.risk === '高');
  }

  // 主线筛选
  if (currentFilters.mainline !== 'all') {
    tasks = tasks.filter(t => getTopWbs(t.wbs) === currentFilters.mainline);
  }
  // 部门筛选
  if (currentFilters.department !== 'all') {
    tasks = tasks.filter(t => t.department === currentFilters.department);
  }
  // 供应商筛选
  if (currentFilters.vendor !== 'all') {
    tasks = tasks.filter(t => t.vendor === currentFilters.vendor);
  }
  // 风险筛选
  if (currentFilters.risk !== 'all') {
    tasks = tasks.filter(t => t.risk === currentFilters.risk);
  }
  // 类型筛选
  if (currentFilters.type !== 'all') {
    tasks = tasks.filter(t => t.type === currentFilters.type);
  }
  // 里程碑筛选
  if (currentFilters.milestone === 'yes') {
    tasks = tasks.filter(t => t.milestone === '是' || t.duration === '0工作日');
  }
  // 搜索
  if (currentFilters.search.trim()) {
    const kw = currentFilters.search.trim().toLowerCase();
    tasks = tasks.filter(t => t.name.toLowerCase().includes(kw) || t.wbs.includes(kw));
  }

  filteredTasks = tasks;
  refreshAll();
}

function renderFilterBar(tasks) {
  const opts = getFilterOptions(tasks);
  const html = `
    <select id="filterYear">
      <option value="all">全部年份</option>
      <option value="2026">2026年</option>
      <option value="2027">2027年</option>
      <option value="2028">2028年</option>
    </select>
    <select id="filterMainline">
      <option value="all">全部主线</option>
      ${opts.mainlines.map(m => {
        const node = treeData.map[m];
        const label = node ? `${m}-${node.name}` : m;
        return `<option value="${m}">${label}</option>`;
      }).join('')}
    </select>
    <select id="filterDept">
      <option value="all">全部部门</option>
      ${opts.departments.map(d => `<option value="${d}">${d}</option>`).join('')}
    </select>
    <select id="filterVendor">
      <option value="all">全部供应商</option>
      ${opts.vendors.map(v => `<option value="${v}">${v}</option>`).join('')}
    </select>
    <select id="filterRisk">
      <option value="all">全部风险</option>
      <option value="高">高风险</option>
      <option value="中">中风险</option>
      <option value="低">低风险</option>
    </select>
    <select id="filterType">
      <option value="all">全部类型</option>
      ${opts.types.map(t => `<option value="${t}">${t}</option>`).join('')}
    </select>
    <select id="filterMilestone">
      <option value="all">全部任务</option>
      <option value="yes">仅里程碑</option>
    </select>
    <input type="text" id="filterSearch" placeholder="搜索任务名称/WBS...">
    <div class="view-btns">
      <button data-view="all" class="active">全部任务</button>
      <button data-view="overview">总览视图</button>
      <button data-view="2026">2026年</button>
      <button data-view="2027">2027年</button>
      <button data-view="2028">2028年</button>
      <button data-view="milestones">里程碑</button>
      <button data-view="highrisk">高风险</button>
    </div>
  `;
  document.getElementById('filterBar').innerHTML = html;
  bindFilterEvents();
}

function bindFilterEvents() {
  const ids = ['filterYear', 'filterMainline', 'filterDept', 'filterVendor',
               'filterRisk', 'filterType', 'filterMilestone'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      const key = id.replace('filter', '').toLowerCase();
      // map special cases
      const keyMap = { year: 'year', mainline: 'mainline', dept: 'department',
                       vendor: 'vendor', risk: 'risk', type: 'type', milestone: 'milestone' };
      currentFilters[keyMap[key]] = el.value;
      if (key === 'year' && el.value !== 'all') {
        currentView = el.value;
      } else if (key === 'year') {
        currentView = 'all';
      }
      updateViewButtons();
      applyFilters();
    });
  });

  const searchEl = document.getElementById('filterSearch');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      currentFilters.search = searchEl.value;
      applyFilters();
    });
  }

  // 视图按钮
  document.querySelectorAll('.view-btns button').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      setView(view);
    });
  });
}

function setView(view) {
  currentView = view;
  if (['2026', '2027', '2028'].includes(view)) {
    currentFilters.year = view;
  } else {
    currentFilters.year = 'all';
  }
  updateViewButtons();
  applyFilters();
}

function updateViewButtons() {
  document.querySelectorAll('.view-btns button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === currentView);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add digital-gantt-h5/index.html
git commit -m "feat: add filter bar with 7 dropdowns, search, and 7 view buttons"
```

---

### Task 6: 实现 TaskTree 左侧 WBS 任务树

**Files:**
- Modify: `digital-gantt-h5/index.html` — 在 `<script>` 中添加 TaskTree 代码

- [ ] **Step 1: 添加任务树渲染**

```javascript
// ===== TaskTree =====
function renderTaskTree(tasks) {
  // 从 allTasks 中找出选中 tasks 对应的 WBS 集合及其祖先
  const filteredWbsSet = new Set(tasks.map(t => t.wbs));
  // 确保所有祖先 WBS 也被包含（用于展开折叠的层级结构显示）
  tasks.forEach(t => {
    const parts = String(t.wbs).split('.');
    for (let i = 1; i < parts.length; i++) {
      filteredWbsSet.add(parts.slice(0, i).join('.'));
    }
  });

  // 只渲染在筛选结果中（或其祖先）的根节点
  const visibleRoots = treeData.roots.filter(r => filteredWbsSet.has(r.wbs));

  const container = document.getElementById('taskTree');
  let html = '';

  function renderNode(node) {
    const inFilter = filteredWbsSet.has(node.wbs);
    if (!inFilter) return;

    const level = getWbsLevel(node.wbs);
    const indent = Math.max(0, level - 1) * 12;
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = node._expanded;
    const toggleIcon = hasChildren ? (isExpanded ? '▼' : '▶') : '';
    const isMilestone = node.milestone === '是' || node.duration === '0工作日';
    const isHighRisk = node.risk === '高';
    const selClass = node.wbs === selectedTaskWbs ? ' selected' : '';

    html += `<div class="tree-node level-${level}${isMilestone ? ' type-milestone' : ''}${isHighRisk ? ' risk-high' : ''}${selClass}"
      data-wbs="${node.wbs}" style="padding-left:${indent}px">
      <span class="toggle-icon" data-action="toggle">${toggleIcon}</span>
      <span class="col-wbs">${node.wbs}</span>
      <span class="col-name" title="${node.name}">${node.name}</span>
    </div>`;

    if (hasChildren && isExpanded) {
      node.children.forEach(child => renderNode(child));
    }
  }

  visibleRoots.forEach(root => renderNode(root));
  container.innerHTML = html;

  // 绑定事件
  container.querySelectorAll('.tree-node').forEach(el => {
    el.addEventListener('click', (e) => {
      const wbs = el.dataset.wbs;
      const toggleEl = e.target.closest('[data-action="toggle"]');
      if (toggleEl) {
        // 展开/折叠
        const node = treeData.map[wbs];
        if (node && node.children.length > 0) {
          node._expanded = !node._expanded;
          renderTaskTree(filteredTasks);
          // 恢复选中状态
          if (selectedTaskWbs) {
            const sel = document.querySelector(`.tree-node[data-wbs="${selectedTaskWbs}"]`);
            if (sel) sel.classList.add('selected');
          }
        }
      } else {
        // 选中任务
        selectedTaskWbs = wbs;
        renderTaskTree(filteredTasks);
        showTaskDetail(treeData.map[wbs]);
        // 滚动甘特图到对应行
        scrollGanttToTask(wbs);
      }
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add digital-gantt-h5/index.html
git commit -m "feat: add WBS task tree with expand/collapse, selection, and indent styling"
```

---

### Task 7: 实现 Canvas 甘特图渲染

**Files:**
- Modify: `digital-gantt-h5/index.html` — 在 `<script>` 中添加 GanttChart Canvas 渲染代码

这是最复杂的部分，包含：月轴表头、任务条绘制、里程碑菱形、今日线、缓冲任务样式、Canvas 悬停检测、滚动同步。

- [ ] **Step 1: 添加甘特图渲染核心代码**

```javascript
// ===== Gantt =====
let ganttTaskPositions = []; // { wbs, x, y, width, height } 用于悬停检测
const ROW_GAP = 0;
const BAR_HEIGHT = 20;
const BAR_Y_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2;

function renderGantt(tasks) {
  const canvas = document.getElementById('ganttCanvas');
  const ctx = canvas.getContext('2d');
  const months = getTotalMonths();
  const totalWidth = months * MONTH_WIDTH + 40;  // extra padding for system labels
  const totalHeight = HEADER_HEIGHT + tasks.length * ROW_HEIGHT + 20;

  // 设置 Canvas 尺寸
  canvas.width = totalWidth;
  canvas.height = Math.max(totalHeight, 400);
  canvas.style.width = totalWidth + 'px';
  canvas.style.height = Math.max(totalHeight, 400) + 'px';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ganttTaskPositions = [];

  // 绘制背景
  ctx.fillStyle = '#141720';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 绘制月轴表头
  drawMonthHeader(ctx, months, totalWidth);

  // 绘制网格线
  drawGridLines(ctx, months, totalWidth, totalHeight, tasks.length);

  // 绘制今日线
  drawTodayLine(ctx, totalHeight);

  // 绘制任务条
  for (let i = 0; i < tasks.length; i++) {
    drawTaskBar(ctx, tasks[i], i);
  }
}

function drawMonthHeader(ctx, months, totalWidth) {
  const labels = getMonthLabels();

  // 表头背景
  ctx.fillStyle = '#161822';
  ctx.fillRect(0, 0, totalWidth, HEADER_HEIGHT);

  // 年份行
  ctx.fillStyle = '#6b7194';
  ctx.font = 'bold 13px -apple-system, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';

  let currentYear = '';
  for (let i = 0; i < months; i++) {
    const yr = labels[i].split('-')[0];
    const x = i * MONTH_WIDTH;
    if (yr !== currentYear) {
      currentYear = yr;
      // 计算该年份跨越的月数
      let span = 0;
      for (let j = i; j < months; j++) {
        if (labels[j].split('-')[0] === yr) span++;
        else break;
      }
      const yearWidth = span * MONTH_WIDTH;
      ctx.fillStyle = '#1c1f2e';
      ctx.fillRect(x, 0, yearWidth, 22);
      ctx.fillStyle = '#8b90a0';
      ctx.fillText(yr + '年', x + yearWidth / 2, 16);
    }
  }

  // 月份行
  for (let i = 0; i < months; i++) {
    const x = i * MONTH_WIDTH;
    const parts = labels[i].split('-');
    const mon = parts[1];

    // 竖线
    ctx.strokeStyle = '#2a2d3a';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 22);
    ctx.lineTo(x, HEADER_HEIGHT);
    ctx.stroke();

    // 月份文字
    ctx.fillStyle = (i % 2 === 0) ? '#6b7194' : '#4a4d5a';
    ctx.font = '12px -apple-system, "Microsoft YaHei", sans-serif';
    ctx.fillText(mon + '月', x + MONTH_WIDTH / 2, 40);
  }

  // 底部线
  ctx.strokeStyle = '#2a2d3a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_HEIGHT);
  ctx.lineTo(totalWidth, HEADER_HEIGHT);
  ctx.stroke();
}

function drawGridLines(ctx, months, totalWidth, totalHeight, taskCount) {
  ctx.strokeStyle = '#1a1d2a';
  ctx.lineWidth = 0.5;

  for (let i = 0; i <= months; i++) {
    const x = i * MONTH_WIDTH;
    ctx.beginPath();
    ctx.moveTo(x, HEADER_HEIGHT);
    ctx.lineTo(x, totalHeight);
    ctx.stroke();
  }

  // 水平行线
  for (let i = 0; i <= taskCount; i++) {
    const y = HEADER_HEIGHT + i * ROW_HEIGHT;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(totalWidth, y);
    ctx.stroke();
  }
}

function drawTodayLine(ctx, totalHeight) {
  const now = new Date();
  const x = getXForDate(now);
  if (x < 0 || x > getTotalMonths() * MONTH_WIDTH) return;

  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(x, HEADER_HEIGHT);
  ctx.lineTo(x, totalHeight);
  ctx.stroke();
  ctx.setLineDash([]);

  // 顶部标签
  ctx.fillStyle = '#e74c3c';
  ctx.font = 'bold 11px -apple-system, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('今天', x, HEADER_HEIGHT - 6);
}

function drawTaskBar(ctx, task, rowIndex) {
  const startDate = parseDate(task.start);
  const finishDate = parseDate(task.finish);
  const y = HEADER_HEIGHT + rowIndex * ROW_HEIGHT;

  // 摘要任务用不同样式
  const isSummary = task.type === '摘要';
  const isMilestone = task.milestone === '是' || task.duration === '0工作日';
  const isBuffer = task.type === '缓冲';
  const isHighRisk = task.risk === '高';

  if (!startDate && !finishDate) {
    // 无日期任务：在左侧显示文字
    ctx.fillStyle = '#4a4d5a';
    ctx.font = '11px -apple-system, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('(日期未设置)', 10, y + ROW_HEIGHT / 2 + 4);
    return;
  }

  const startX = startDate ? getXForDate(startDate) : 0;
  const finishX = finishDate ? getXForDate(finishDate) + MONTH_WIDTH / 30 : startX;

  if (isMilestone && finishDate) {
    // 菱形绘制
    const cx = finishX;
    const cy = y + ROW_HEIGHT / 2;
    const size = 7;

    ctx.fillStyle = '#f4b400';
    ctx.strokeStyle = '#f4b400';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size, cy);
    ctx.lineTo(cx, cy + size);
    ctx.lineTo(cx - size, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 记录位置
    ganttTaskPositions.push({
      wbs: task.wbs, x: cx - size, y: cy - size,
      width: size * 2, height: size * 2
    });
    return;
  }

  const barWidth = Math.max(finishX - startX, 3);
  const barX = startX;
  const barY = y + BAR_Y_OFFSET;
  const color = getWbsColor(task.wbs);

  // 摘要任务：灰色粗条
  if (isSummary) {
    ctx.fillStyle = '#3a3d4a';
    ctx.fillRect(barX, barY + 2, barWidth, BAR_HEIGHT - 4);
    // 端点标记
    ctx.fillStyle = '#6b7194';
    ctx.beginPath();
    ctx.arc(barX, barY + BAR_HEIGHT / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(barX + barWidth, barY + BAR_HEIGHT / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 正常任务条
    const alpha = isHighRisk ? 1 : 0.85;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fillRect(barX, barY, barWidth, BAR_HEIGHT);

    // 高风险红色边框
    if (isHighRisk) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(barX, barY, barWidth, BAR_HEIGHT);
    }

    // 缓冲任务斜线纹理
    if (isBuffer) {
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.5;
      for (let ox = barX; ox < barX + barWidth; ox += 4) {
        ctx.beginPath();
        ctx.moveTo(ox, barY);
        ctx.lineTo(ox + BAR_HEIGHT, barY + BAR_HEIGHT);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;

    // 任务名称文字
    if (barWidth > 40) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px -apple-system, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      const textX = barX + 6;
      const textMaxWidth = barWidth - 12;
      const displayName = task.name.length > 20 ? task.name.slice(0, 20) + '..' : task.name;
      ctx.fillText(displayName, textX, barY + BAR_HEIGHT / 2 + 4, textMaxWidth);
    }
  }

  // 记录位置
  ganttTaskPositions.push({
    wbs: task.wbs, x: barX, y: barY,
    width: barWidth, height: BAR_HEIGHT
  });
}

function scrollGanttToTask(wbs) {
  const pos = ganttTaskPositions.find(p => p.wbs === wbs);
  if (pos) {
    const panel = document.getElementById('ganttPanel');
    panel.scrollTo({ top: pos.y - HEADER_HEIGHT - 100, behavior: 'smooth' });
  }
}

// ===== Canvas 悬停检测 =====
function setupGanttHover() {
  const canvas = document.getElementById('ganttCanvas');
  const tooltip = document.getElementById('ganttTooltip');
  const panel = document.getElementById('ganttPanel');

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left + panel.scrollLeft;
    const my = e.clientY - rect.top + panel.scrollTop;

    const hit = ganttTaskPositions.find(p =>
      mx >= p.x && mx <= p.x + p.width &&
      my >= p.y && my <= p.y + p.height
    );

    if (hit) {
      const task = treeData.map[hit.wbs];
      if (task) {
        const s = parseDate(task.start);
        const f = parseDate(task.finish);
        tooltip.innerHTML = `
          <div class="tt-name">${task.name}</div>
          <div class="tt-row">WBS: <span>${task.wbs}</span></div>
          <div class="tt-row">时间: <span>${formatDate(s)} — ${formatDate(f)}</span></div>
          <div class="tt-row">工期: <span>${task.duration || '-'}</span></div>
          <div class="tt-row">类型: <span>${task.type || '-'}</span></div>
          <div class="tt-row">部门: <span>${task.department || '-'}</span></div>
          <div class="tt-row">风险: <span>${task.risk || '-'}</span></div>
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX + 16) + 'px';
        tooltip.style.top = (e.clientY + 16) + 'px';
      }
    } else {
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left + panel.scrollLeft;
    const my = e.clientY - rect.top + panel.scrollTop;

    const hit = ganttTaskPositions.find(p =>
      mx >= p.x && mx <= p.x + p.width &&
      my >= p.y && my <= p.y + p.height
    );

    if (hit) {
      selectedTaskWbs = hit.wbs;
      renderTaskTree(filteredTasks);
      showTaskDetail(treeData.map[hit.wbs]);
    }
  });
}

// ===== 滚动同步（任务树 ↔ 甘特图） =====
function setupScrollSync() {
  const treePanel = document.getElementById('taskTreePanel');
  const ganttPanel = document.getElementById('ganttPanel');

  treePanel.addEventListener('scroll', () => {
    ganttPanel.scrollTop = treePanel.scrollTop;
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add digital-gantt-h5/index.html
git commit -m "feat: add Canvas 2D gantt chart with month header, task bars, milestones, today line, hover tooltips"
```

---

### Task 8: 实现 TaskDetail 详情面板 + MilestoneList + 初始化

**Files:**
- Modify: `digital-gantt-h5/index.html` — 添加详情面板、里程碑列表、初始化主函数

- [ ] **Step 1: 添加详情面板和里程碑列表**

```javascript
// ===== TaskDetail Panel =====
function showTaskDetail(task) {
  if (!task) return;

  const overlay = document.getElementById('detailOverlay');
  const body = document.getElementById('detailBody');

  const s = parseDate(task.start);
  const f = parseDate(task.finish);

  const fields = [
    { label: 'WBS', value: task.wbs || '-' },
    { label: '任务名称', value: task.name },
    { label: '任务类型', value: task.type || '-' },
    { label: '开始时间', value: formatDate(s) },
    { label: '完成时间', value: formatDate(f) },
    { label: '工期', value: task.duration || '-' },
    { label: '前置任务', value: task.predecessors || '-' },
    { label: '资源名称', value: task.resources || '-' },
    { label: '责任部门', value: task.department || '-' },
    { label: '供应商', value: task.vendor || '-' },
    { label: '审核人/审批组', value: task.reviewer || '-' },
    { label: '风险等级', value: task.risk || '中', badge: 'risk' },
    { label: '里程碑', value: (task.milestone === '是' || task.duration === '0工作日') ? '是' : '否', badge: 'milestone' },
    { label: '交付物', value: task.deliverable || '-' },
    { label: '备注', value: task.notes || '-' }
  ];

  body.innerHTML = fields.map(f => {
    let valueHtml;
    if (f.badge === 'risk') {
      valueHtml = `<span class="value badge risk-${f.value}">${f.value}</span>`;
    } else if (f.badge === 'milestone' && f.value === '是') {
      valueHtml = `<span class="value badge tag-milestone">里程碑</span>`;
    } else {
      valueHtml = `<span class="value">${f.value}</span>`;
    }
    return `<div class="detail-field">
      <label>${f.label}</label>
      ${valueHtml}
    </div>`;
  }).join('');

  overlay.classList.add('open');
}

function hideTaskDetail() {
  document.getElementById('detailOverlay').classList.remove('open');
}

document.getElementById('detailClose').addEventListener('click', hideTaskDetail);

// ===== Milestone List =====
function renderMilestoneList(tasks) {
  const milestones = tasks.filter(t => t.milestone === '是' || t.duration === '0工作日');
  const container = document.getElementById('milestoneList');

  container.innerHTML = milestones.map(m => {
    const f = parseDate(m.finish);
    return `<div class="milestone-item">
      <span class="ms-date">${formatDate(f)}</span>
      <span class="ms-name">${m.name}</span>
    </div>`;
  }).join('');
}

// ===== 全局刷新 =====
function refreshAll() {
  renderDashboard(filteredTasks);
  renderTaskTree(filteredTasks);
  renderGantt(filteredTasks);
  renderMilestoneList(filteredTasks);
}

// ===== 初始化 =====
async function init() {
  const ok = await loadData();
  if (!ok) return;

  renderFilterBar(allTasks);
  refreshAll();
  setupGanttHover();
  setupScrollSync();
}

init();
```

- [ ] **Step 2: Commit**

```bash
git add digital-gantt-h5/index.html
git commit -m "feat: add task detail slide-out panel, milestone list, scroll sync, and app init"
```

---

### Task 9: 编写 README.md

**Files:**
- Create: `digital-gantt-h5/README.md`

- [ ] **Step 1: 编写 README**

```markdown
# 数字化底座项目甘特图

基于 `pmo/信息化项目.csv` 构建的可交互 H5 甘特图看板，用于项目管理、领导汇报和进度跟踪。

## 快速开始

### 方式一：直接打开（推荐）

用浏览器直接打开 `index.html` 即可。

### 方式二：本地服务

```bash
cd digital-gantt-h5
python -m http.server 8080
# 访问 http://localhost:8080
```

## 更新任务数据

1. 修改 `pmo/信息化项目.csv`
2. 重新生成 JSON：

```bash
cd digital-gantt-h5
node convert.js
```

3. 刷新浏览器页面

## 功能说明

- **仪表盘**：7 个核心指标卡片（总任务、里程碑、高风险、进行中、跨年、部门、供应商）
- **筛选器**：按年份、主线、部门、供应商、风险、类型、里程碑筛选 + 关键词搜索
- **视图切换**：全部任务 / 总览 / 2026年 / 2027年 / 2028年 / 里程碑 / 高风险
- **WBS 任务树**：左侧固定列，支持展开/折叠（一二级默认展开），点击查看详情
- **Canvas 甘特图**：横向滚动，月轴表头固定，里程碑菱形标注，今日红线，高风险红框
- **任务详情**：右侧滑出面板，显示完整字段信息
- **悬停提示**：甘特条悬停显示关键信息摘要

## 技术栈

纯静态 HTML + CSS + JavaScript（ES6+），Canvas 2D 渲染甘特图，零框架、零构建、零 CDN 依赖。

## 数据格式

`tasks.json` 字段说明：

| 字段 | 说明 |
|------|------|
| wbs | WBS 编号 |
| name | 任务名称 |
| type | 任务类型（摘要/里程碑/启动/调研/设计/开发/测试...） |
| duration | 工期 |
| start | 开始时间 |
| finish | 完成时间 |
| predecessors | 前置任务 |
| resources | 资源名称 |
| department | 责任部门 |
| vendor | 供应商 |
| reviewer | 审核人/审批组 |
| risk | 风险等级（高/中/低） |
| milestone | 是否里程碑（是/否） |
| deliverable | 交付物 |
| notes | 备注 |

## 导出截图

使用浏览器开发者工具截图，或使用第三方工具（如 Puppeteer）：

```bash
npx puppeteer screenshots --url=http://localhost:8080 --fullpage
```
```

- [ ] **Step 2: Commit**

```bash
git add digital-gantt-h5/README.md
git commit -m "docs: add README for digital gantt H5 project"
```

---

### Task 10: 端到端验证与修复

**Files:**
- No new files — 验证现有 `index.html` 功能完整性

- [ ] **Step 1: 验证数据加载 — 浏览器打开 index.html，检查控制台无报错**

- [ ] **Step 2: 验证仪表盘 — 确认 7 个卡片数值正确（总任务 313、里程碑 >0、高风险 >0）**

- [ ] **Step 3: 验证筛选器 — 依次切换每个下拉筛选器，确认任务树和甘特图同步更新**

- [ ] **Step 4: 验证视图切换 — 点击每个视图按钮（总览/2026/2027/2028/里程碑/高风险）**

- [ ] **Step 5: 验证任务树 — 展开/折叠节点，点击任务，确认右侧详情面板弹出**

- [ ] **Step 6: 验证甘特图 — 横向滚动、悬停 tooltip、点击任务条选中、今日红线可见**

- [ ] **Step 7: 验证里程碑 — 底部里程碑列表与数据一致，菱形在甘特图上可见**

- [ ] **Step 8: 验证明细表 — 详情面板显示所有字段，高风险管理为红色 badge、里程碑为金色 badge**

- [ ] **Step 9: 验证搜索 — 输入关键词，任务树和甘特图正确过滤**

- [ ] **Step 10: 修复发现的问题并 commit**

---

## 自审清单

- [x] Spec 覆盖率：所有设计文档要求的功能都有对应 Task
- [x] 无占位符：每个 Task 包含完整可执行代码
- [x] 类型一致性：`wbs`、`selectedTaskWbs`、`currentFilters` 等跨 Task 引用一致
- [x] 文件路径精确：所有文件路径明确

## 预估文件大小

- `index.html`：约 2500-3200 行（含 CSS ~400 行 + JS ~2000 行）
- `tasks.json`：约 150KB（313 条任务）
- `convert.js`：约 50 行
- `README.md`：约 60 行
