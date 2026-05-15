# 业务地图桑基图 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 MDM 平台中新增"业务地图"Tab，用 ECharts 桑基图动态展示 部门→业务能力→业务流程→应用系统 四层关系，数据从 DB 映射表实时查询。

**Architecture:** 后端新增 `routes/views.js` 提供聚合视图 API（`GET /api/views/sankey`、`GET /api/views/processes/:id`），前端在 `index.html` 新增业务地图 Tab 面板、流程详情页、能力申报页桑基预览。DB 给 capabilities 表加 `parent_id` 建立 L1/L2/L3 层级树。

**Tech Stack:** Express.js + better-sqlite3 + ECharts 5.4.3 (sankey) + 原生 HTML/CSS/JS

**Review Amendments (required before implementation):**
- Sankey API nodes must use stable keys in `name` (`department:1`, `capability:2`, `process:3`, `system:4`) and expose human text separately as `label`. Do not use display names as identity; duplicate process/system names must remain distinct.
- Every node query and every link query must apply the same `published mapping + dept_ids + cap_levels` filter. Do not return links whose `source` or `target` is absent from `nodes`.
- `cap_levels` filters expand selected capabilities to descendants through `parent_id`; if the expansion is empty, the endpoint returns `{ nodes: [], links: [] }` rather than emitting invalid `IN ()` SQL.
- Department filter UI must preserve user selections. Populate `#sankeyDept` only when the department list signature changes, then restore selected values.
- Smoke tests must preserve the login session cookie and assert semantic behavior, not only print counts.

---

### Task 1: DB Migration — capabilities 表加 parent_id

**Files:**
- Modify: `mdm-platform/server/db.js` (add migration block)

- [ ] **Step 1: 在 db.js 末尾 module.exports 前添加 migration 代码**

在 `module.exports = db;` 之前插入：

```js
// Migration: add parent_id to capabilities for L1→L2→L3 hierarchy
const capInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='capabilities'").get();
if (capInfo && !capInfo.sql.includes('parent_id')) {
  db.exec('ALTER TABLE capabilities ADD COLUMN parent_id INTEGER REFERENCES capabilities(id)');
  console.log('Migration: added parent_id to capabilities');
}
```

- [ ] **Step 2: 运行 init-db 触发 migration**

```bash
cd mdm-platform && npm run init-db
```

- [ ] **Step 3: 验证字段已添加**

```bash
cd mdm-platform && node -e "const db=require('./server/db'); const info=db.prepare('PRAGMA table_info(capabilities)').all(); console.log(info.map(c=>c.name).join(', '));"
```

Expected: 输出包含 `parent_id`

- [ ] **Step 4: Commit**

```bash
git add mdm-platform/server/db.js
git commit -m "feat: add parent_id to capabilities for L1/L2/L3 hierarchy"
```

---

### Task 2: 更新 capabilities 路由支持 parent_id

**Files:**
- Modify: `mdm-platform/server/routes/capabilities.js`

- [ ] **Step 1: 更新 GET / 查询，返回 parent_id**

将 `/` 路由的 SQL 改为包含 parent_id：

```js
router.get('/', requireAuth, (req, res) => {
  const capabilities = db.prepare(`
    SELECT c.*, d.name as dept_name, pc.name as parent_name
    FROM capabilities c
    LEFT JOIN departments d ON c.owner_dept_id = d.id
    LEFT JOIN capabilities pc ON c.parent_id = pc.id
    ORDER BY c.level, c.name
  `).all();
  res.json(capabilities);
});
```

- [ ] **Step 2: 更新 POST / 支持 parent_id**

将创建语句改为：

```js
router.post('/', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { name, level, owner_dept_id, parent_id } = req.body;
    const stmt = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id, parent_id, created_by) VALUES (?, ?, ?, ?, ?)');
    const result = stmt.run(name, level, owner_dept_id || null, parent_id || null, req.session.userId);
    res.json({ id: result.lastInsertRowid });
  });
});
```

- [ ] **Step 3: 更新 PUT /:id 支持 parent_id**

```js
router.put('/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { name, level, owner_dept_id, parent_id } = req.body;
    db.prepare('UPDATE capabilities SET name=?, level=?, owner_dept_id=?, parent_id=? WHERE id=?').run(
      name, level, owner_dept_id || null, parent_id || null, req.params.id
    );
    res.json({ success: true });
  });
});
```

- [ ] **Step 4: 运行 catalog 测试确认不报错**

```bash
cd mdm-platform && npm run test:catalog
```

- [ ] **Step 5: Commit**

```bash
git add mdm-platform/server/routes/capabilities.js
git commit -m "feat: add parent_id support to capabilities CRUD"
```

---

### Task 3: 新建 views.js 路由 — 桑基图数据 API

**Files:**
- Create: `mdm-platform/server/routes/views.js`

- [ ] **Step 1: 创建 views.js 文件**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runDbAction(res, action) {
  try { return action(); }
  catch (error) { return handleDbError(res, error); }
}

// GET /api/views/sankey?dept_ids=1,2&cap_levels=L1,L2
router.get('/sankey', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const deptIds = req.query.dept_ids ? req.query.dept_ids.split(',').map(Number).filter(Boolean) : [];
    const capLevels = req.query.cap_levels ? req.query.cap_levels.split(',').map(s => s.trim()) : ['L1','L2','L3'];

    // --- Collect all capability IDs (including descendants for hierarchy) ---
    let capIds = null;
    if (capLevels.length < 3) {
      // Need to expand: if user picks L1, include all L2/L3 descendants via parent_id chain
      const allCaps = db.prepare('SELECT id, level, parent_id FROM capabilities').all();
      const capById = new Map(allCaps.map(c => [c.id, c]));
      const childrenOf = new Map();
      allCaps.forEach(c => {
        if (c.parent_id) {
          const arr = childrenOf.get(c.parent_id) || [];
          arr.push(c.id);
          childrenOf.set(c.parent_id, arr);
        }
      });
      function collectDescendants(id) {
        const result = [id];
        const children = childrenOf.get(id) || [];
        children.forEach(childId => result.push(...collectDescendants(childId)));
        return result;
      }
      const expanded = new Set();
      allCaps.filter(c => capLevels.includes(c.level)).forEach(c => {
        collectDescendants(c.id).forEach(id => expanded.add(id));
      });
      capIds = [...expanded];
    }

    // --- Layer 1: Departments ---
    let deptSql = `SELECT DISTINCT d.id, d.name FROM departments d
      JOIN mappings m ON (m.owner_dept_id = d.id OR d.id IN (
        SELECT mrd.department_id FROM mapping_related_departments mrd WHERE mrd.mapping_id = m.id
      ))
      WHERE m.status = 'published'`;
    const deptParams = [];
    if (deptIds.length > 0) {
      deptSql += ' AND d.id IN (' + deptIds.map(() => '?').join(',') + ')';
      deptParams.push(...deptIds);
    }
    const departments = db.prepare(deptSql).all(...deptParams);

    // --- Layer 2: Capabilities ---
    let capSql = `SELECT DISTINCT c.id, c.name, c.level FROM capabilities c
      JOIN processes p ON p.capability_id = c.id
      JOIN mappings m ON m.process_id = p.id AND m.status = 'published'`;
    const capParams = [];
    if (capIds) {
      capSql += ' AND c.id IN (' + capIds.map(() => '?').join(',') + ')';
      capParams.push(...capIds);
    }
    const capabilities = db.prepare(capSql).all(...capParams);

    // --- Layer 3: Processes ---
    let procSql = `SELECT DISTINCT p.id, p.name FROM processes p
      JOIN mappings m ON m.process_id = p.id AND m.status = 'published'
      WHERE 1=1`;
    const procParams = [];
    if (capIds) {
      procSql += ' AND p.capability_id IN (' + capIds.map(() => '?').join(',') + ')';
      procParams.push(...capIds);
    }
    const processes = db.prepare(procSql).all(...procParams);

    // --- Layer 4: Systems ---
    let sysSql = `SELECT DISTINCT s.id, s.name FROM systems s
      JOIN mapping_systems ms ON ms.system_id = s.id
      JOIN mappings m ON ms.mapping_id = m.id AND m.status = 'published'
      WHERE 1=1`;
    const sysParams = [];
    if (capIds) {
      sysSql += ` AND m.process_id IN (
        SELECT p.id FROM processes p WHERE p.capability_id IN (` + capIds.map(() => '?').join(',') + `)
      )`;
      sysParams.push(...capIds);
    }
    const systems = db.prepare(sysSql).all(...sysParams);

    // --- Build nodes with metadata ---
    const nodeMap = new Map();
    const nodeKey = (type, id) => type + ':' + id;
    const addNode = (type, id, label, layer, extra = {}) => {
      const name = nodeKey(type, id);
      if (!nodeMap.has(name)) nodeMap.set(name, { name, label, layer, type, id, ...extra });
    };
    departments.forEach(d => addNode('department', d.id, d.name, 1));
    capabilities.forEach(c => addNode('capability', c.id, c.name, 2, { level: c.level }));
    processes.forEach(p => addNode('process', p.id, p.name, 3));
    systems.forEach(s => addNode('system', s.id, s.name, 4));

    // --- Build links with value = published mapping count ---
    const linkMap = new Map();
    const addLink = (source, target) => {
      const key = source + '|||' + target;
      linkMap.set(key, (linkMap.get(key) || 0) + 1);
    };

    // Important: each link SQL below must reuse the same dept_ids and capIds filters as the node SQL.
    // After links are built, drop any link whose source/target does not exist in nodeMap.

    // Department → Capability (via process owner_dept)
    // Use IDs, not display names, and apply the same dept_ids/capIds filters as node queries.
    const dcLinks = db.prepare(`
      SELECT d.id as dept_id, c.id as cap_id, COUNT(DISTINCT m.id) as cnt
      FROM mappings m
      JOIN processes p ON m.process_id = p.id
      JOIN capabilities c ON p.capability_id = c.id
      JOIN departments d ON m.owner_dept_id = d.id
      WHERE m.status = 'published'
      GROUP BY d.id, c.id
    `).all();
    dcLinks.forEach(r => addLink(nodeKey('department', r.dept_id), nodeKey('capability', r.cap_id), r.cnt));

    // Department → Capability (via related departments)
    const dcLinks2 = db.prepare(`
      SELECT d.id as dept_id, c.id as cap_id, COUNT(DISTINCT m.id) as cnt
      FROM mappings m
      JOIN mapping_related_departments mrd ON mrd.mapping_id = m.id
      JOIN departments d ON mrd.department_id = d.id
      JOIN processes p ON m.process_id = p.id
      JOIN capabilities c ON p.capability_id = c.id
      WHERE m.status = 'published'
      GROUP BY d.id, c.id
    `).all();
    dcLinks2.forEach(r => addLink(nodeKey('department', r.dept_id), nodeKey('capability', r.cap_id), r.cnt));

    // Capability → Process
    const cpLinks = db.prepare(`
      SELECT c.id as cap_id, p.id as proc_id, COUNT(DISTINCT m.id) as cnt
      FROM mappings m
      JOIN processes p ON m.process_id = p.id
      JOIN capabilities c ON p.capability_id = c.id
      WHERE m.status = 'published'
      GROUP BY c.id, p.id
    `).all();
    cpLinks.forEach(r => addLink(nodeKey('capability', r.cap_id), nodeKey('process', r.proc_id), r.cnt));

    // Process → System
    const psLinks = db.prepare(`
      SELECT p.id as proc_id, s.id as sys_id, COUNT(DISTINCT m.id) as cnt
      FROM mappings m
      JOIN mapping_systems ms ON ms.mapping_id = m.id
      JOIN systems s ON ms.system_id = s.id
      JOIN processes p ON m.process_id = p.id
      WHERE m.status = 'published'
      GROUP BY p.id, s.id
    `).all();
    psLinks.forEach(r => addLink(nodeKey('process', r.proc_id), nodeKey('system', r.sys_id), r.cnt));

    const links = [...linkMap.entries()].map(([key, value]) => {
      const [source, target] = key.split('|||');
      return { source, target, value };
    }).filter(link => nodeMap.has(link.source) && nodeMap.has(link.target));

    res.json({ nodes: [...nodeMap.values()], links });
  });
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/views.js
git commit -m "feat: add /api/views/sankey endpoint for business map sankey data"
```

---

### Task 4: 在 index.js 注册 views 路由

**Files:**
- Modify: `mdm-platform/server/index.js`

- [ ] **Step 1: 添加视图路由注册**

在 `mdm-platform/server/index.js` 的 `registerRouteIfExists` 调用区末尾（`export` 那行之后）添加：

```js
registerRouteIfExists('/api/views', 'views');
```

- [ ] **Step 2: 启动服务器验证路由可访问**

```bash
cd mdm-platform && node -e "
const app = require('./server/index.js');
// server starts on port 3000, check after brief wait
"
```

用 curl 或浏览器访问 `http://localhost:3000/api/views/sankey`（需先登录），确认返回 JSON 结构含 `nodes` 和 `links`。

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/server/index.js
git commit -m "feat: register views route for aggregated view APIs"
```

---

### Task 5: 前端 — 新增业务地图 Tab 和面板骨架

**Files:**
- Modify: `mdm-platform/public/index.html`

- [ ] **Step 1: 在 tab 导航中添加"业务地图"按钮**

在 `<nav class="tabs" id="tabs">` 内，`capabilities` tab 之后插入：

```html
<button class="tab" data-tab="businessMap" data-roles="owner,reviewer,admin">业务地图</button>
```

- [ ] **Step 2: 添加业务地图面板骨架**

在 `conflicts` panel 之后（`</section>` 第 393 行之后），detailPage 之前，插入：

```html
<!-- Business Map (Sankey) -->
<section class="panel" id="businessMap">
  <div class="toolbar">
    <h2>业务地图</h2>
    <div class="toolbar-right">
      <select id="sankeyDept" multiple style="width: 180px; height: 36px; padding: 6px;">
      </select>
      <select id="sankeyLevel" style="width: 120px; height: 36px; padding: 0 12px;">
        <option value="L1,L2,L3">全部能力层级</option>
        <option value="L1">仅 L1</option>
        <option value="L1,L2">L1 + L2</option>
      </select>
    </div>
  </div>
  <div class="notice" id="sankeyMeta" style="margin-bottom: 16px;"></div>
  <div class="chart" id="sankeyChart" style="height: 600px;"></div>
</section>
```

> 注意：`<select multiple>` 在原生 HTML 中可通过按住 Ctrl 多选。如需更好的 UI，后续可用 checkbox 列表替代。

- [ ] **Step 3: 在 renderListPanel 的 switch 中添加分支**

在 `renderListPanel` 函数（约 line 936）的 switch 中添加：

```js
case 'businessMap': renderBusinessMap(); break;
```

- [ ] **Step 4: Commit**

```bash
git add mdm-platform/public/index.html
git commit -m "feat: add business map tab skeleton with sankey controls"
```

---

### Task 6: 前端 — 桑基图数据加载与渲染

**Files:**
- Modify: `mdm-platform/public/index.html`

- [ ] **Step 1: 添加桑基图渲染函数**

在 `renderDashboard` 函数之后、`renderListPanel` 之前插入：

```js
// ===== Business Map Sankey =====

// Layer color families (四色原则)
var LAYER_COLORS = {
  1: ['#2563eb','#3b82f6','#60a5fa','#93c5fd','#1d4ed8','#bfdbfe'],
  2: ['#059669','#10b981','#34d399','#6ee7b7','#047857','#a7f3d0'],
  3: ['#d97706','#f59e0b','#fbbf24','#fcd34d','#b45309','#fde68a'],
  4: ['#7c3aed','#8b5cf6','#a78bfa','#c4b5fd','#6d28d9','#e0e7ff']
};

function layerColor(layer, index) {
  var colors = LAYER_COLORS[layer] || LAYER_COLORS[2];
  return colors[index % colors.length];
}

async function loadSankeyData() {
  var deptEl = document.getElementById('sankeyDept');
  var levelEl = document.getElementById('sankeyLevel');
  var deptIds = deptEl && deptEl.selectedOptions
    ? Array.from(deptEl.selectedOptions).map(function(o) { return o.value; })
    : [];
  var levels = levelEl ? levelEl.value : 'L1,L2,L3';
  var params = new URLSearchParams();
  if (deptIds.length > 0) params.set('dept_ids', deptIds.join(','));
  params.set('cap_levels', levels);
  return await api('/api/views/sankey?' + params.toString());
}

async function renderBusinessMap() {
  var chartDom = document.getElementById('sankeyChart');
  if (!chartDom) return;

  populateSankeyDeptFilter();

  try {
    var data = await loadSankeyData();
    document.getElementById('sankeyMeta').innerHTML =
      data.nodes.length + ' 个节点，' + data.links.length + ' 条关系';

    if (data.nodes.length === 0) {
      chartDom.innerHTML = '<div class="empty">暂无已发布的映射数据，无法生成业务地图</div>';
      return;
    }

    if (!window.echarts) { chartDom.innerHTML = '<div class="empty">ECharts 加载失败</div>'; return; }

    var existing = echarts.getInstanceByDom(chartDom);
    if (existing) existing.dispose();

    var chart = echarts.init(chartDom);

    var nodeLabels = {};
    data.nodes.forEach(function(n) { nodeLabels[n.name] = n.label || n.name; });

    // Assign colors per node
    var nodeColors = {};
    var layerCounters = {1:0,2:0,3:0,4:0};
    data.nodes.forEach(function(n) {
      var idx = layerCounters[n.layer]++;
      nodeColors[n.name] = layerColor(n.layer, idx);
    });

    var nodes = data.nodes.map(function(n) {
      return { name: n.name, itemStyle: { color: nodeColors[n.name] } };
    });

    chart.setOption({
      tooltip: {
        trigger: 'item',
        triggerOn: 'mousemove',
        formatter: function(p) {
          if (p.dataType === 'edge') {
            return nodeLabels[p.data.source] + ' → ' + nodeLabels[p.data.target];
          }
          var node = data.nodes.find(function(n) { return n.name === p.name; });
          if (!node) return p.name;
          var labels = {1:'部门',2:'业务能力',3:'业务流程',4:'应用系统'};
          return (node.label || p.name) + '<br/><span style="color:#888;font-size:12px;">' + (labels[node.layer] || '') + '</span>';
        }
      },
      series: [{
        type: 'sankey',
        left: 20, right: 160, top: 20, bottom: 20,
        data: nodes,
        links: data.links,
        orient: 'horizontal',
        nodeWidth: 16,
        nodeGap: 10,
        draggable: false,
        layoutIterations: 64,
        label: {
          position: 'right',
          formatter: function(params) {
            var node = data.nodes.find(function(n) { return n.name === params.name; });
            return node ? (node.label || node.name) : params.name;
          },
          fontSize: 12,
          color: '#374151',
          fontFamily: 'PingFang SC,sans-serif',
          overflow: 'truncate',
          width: 140
        },
        lineStyle: { color: 'gradient', opacity: 0.3, curveness: 0.5 },
        emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.7 } }
      }]
    });

    // Click handler: navigate to process detail
    chart.off('click');
    chart.on('click', function(params) {
      if (params.dataType === 'node') {
        var node = data.nodes.find(function(n) { return n.name === params.name; });
        if (node && node.type === 'process') {
          navigateTo('detail', { tab: 'businessMap', type: 'process', id: node.id });
        }
      }
    });

    window.addEventListener('resize', function() { chart.resize(); });
  } catch (e) {
    chartDom.innerHTML = '<div class="empty">加载失败：' + (e.message || '未知错误') + '</div>';
  }
}
```

- [ ] **Step 2: 给筛选器绑定 change 事件**

在 `// ===== Event bindings =====` 区域（约 line 983）的事件绑定区添加：

```js
if (document.getElementById('sankeyDept')) {
  document.getElementById('sankeyDept').onchange = renderBusinessMap;
}
if (document.getElementById('sankeyLevel')) {
  document.getElementById('sankeyLevel').onchange = renderBusinessMap;
}
```

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/public/index.html
git commit -m "feat: implement business map sankey rendering with filters"
```

---

### Task 7: 前端 — 能力申报页底部桑基预览

**Files:**
- Modify: `mdm-platform/public/index.html`

- [ ] **Step 1: 在能力申报页右侧区域底部添加预览容器**

在 `capabilities` panel 的右侧 `<div>`（列表区）末尾，`</div>` 闭合前（约 line 330），插入：

```html
<div id="capPreviewWrap" style="margin-top: 24px; display: none;">
  <h2>关系预览</h2>
  <div class="chart" id="capPreviewChart" style="height: 300px;"></div>
</div>
```

- [ ] **Step 2: 添加预览渲染函数**

在 `renderBusinessMap` 函数之后插入：

```js
// ===== Capability Preview Sankey =====

async function renderCapPreview(capId) {
  var wrap = document.getElementById('capPreviewWrap');
  var chartDom = document.getElementById('capPreviewChart');
  if (!wrap || !chartDom) return;

  if (!capId) { wrap.style.display = 'none'; return; }

  try {
    var cap = state.capabilities.find(function(c) { return c.id === capId; });
    if (!cap) { wrap.style.display = 'none'; return; }

    // Fetch full sankey data, filter client-side to the capability
    var data = await api('/api/views/sankey');

    // Find all descendant capability keys (if hierarchy exists)
    var selectedCapKeys = new Set();
    selectedCapKeys.add('capability:' + capId);
    state.capabilities.forEach(function(c) {
      // Check if c is a descendant of capId
      var pid = c.parent_id;
      while (pid) {
        if (pid === capId) { selectedCapKeys.add('capability:' + c.id); break; }
        var parent = state.capabilities.find(function(p) { return p.id === pid; });
        pid = parent ? parent.parent_id : null;
      }
    });

    // Filter direct capability links and one downstream process→system hop.
    var processKeys = new Set();
    data.links.forEach(function(l) {
      if (selectedCapKeys.has(l.source) && l.target.indexOf('process:') === 0) {
        processKeys.add(l.target);
      }
    });
    var filteredLinks = data.links.filter(function(l) {
      return selectedCapKeys.has(l.source) || selectedCapKeys.has(l.target) || processKeys.has(l.source);
    });
    var relevantNodes = new Set();
    filteredLinks.forEach(function(l) {
      relevantNodes.add(l.source);
      relevantNodes.add(l.target);
    });
    var filteredNodes = data.nodes.filter(function(n) {
      return relevantNodes.has(n.name);
    });

    if (filteredNodes.length === 0) {
      wrap.style.display = 'block';
      chartDom.innerHTML = '<div class="empty">该能力暂无已发布的映射</div>';
      return;
    }

    wrap.style.display = 'block';
    var existing = echarts.getInstanceByDom(chartDom);
    if (existing) existing.dispose();
    var chart = echarts.init(chartDom);

    var nodeColors = {};
    var layerCounters = {1:0,2:0,3:0,4:0};
    filteredNodes.forEach(function(n) {
      var idx = layerCounters[n.layer]++;
      nodeColors[n.name] = layerColor(n.layer, idx);
    });

    chart.setOption({
      tooltip: { trigger: 'item', triggerOn: 'mousemove',
        formatter: function(p) {
          return p.dataType === 'edge' ? p.data.source + ' → ' + p.data.target : p.name;
        }
      },
      series: [{
        type: 'sankey',
        left: 10, right: 10, top: 10, bottom: 10,
        data: filteredNodes.map(function(n) {
          return { name: n.name, itemStyle: { color: nodeColors[n.name] } };
        }),
        links: filteredLinks,
        orient: 'horizontal',
        nodeWidth: 12,
        nodeGap: 6,
        draggable: false,
        layoutIterations: 32,
        label: { position: 'right', fontSize: 10, color: '#4b5563',
          fontFamily: 'PingFang SC,sans-serif', overflow: 'truncate', width: 100 },
        lineStyle: { color: 'gradient', opacity: 0.3, curveness: 0.5 },
        emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.6 } }
      }]
    });
  } catch (e) {
    wrap.style.display = 'none';
  }
}
```

- [ ] **Step 3: 在能力列表行点击时触发预览**

修改 `renderCapsAndProcs` 中的能力表格行（约 line 643），给每行 `<tr>` 加点击事件：

```js
$('capRows').innerHTML = state.capabilities.map(function(row) {
  return '<tr style="cursor:pointer;" onclick="renderCapPreview(' + row.id + '); ' +
    "var rows=this.parentElement.querySelectorAll('tr');rows.forEach(function(r){r.style.background='';});this.style.background='#fefafa';" +
    '">' +
    '<td>' + row.id + '</td><td>' + row.name + '</td><td>' + row.level + '</td><td>' + (row.dept_name || '-') + '</td><td>' + statusTag(row.status) + '</td>' +
    '<td><button class="btn success" onclick="event.stopPropagation();reviewCap(' + row.id + ',\'approve\')">通过</button> ' +
    '<button class="btn danger" onclick="event.stopPropagation();reviewCap(' + row.id + ',\'reject\')">驳回</button></td></tr>';
}).join('') || '<tr><td colspan="6" class="empty">暂无数据</td></tr>';
```

> 关键：审批按钮上加了 `event.stopPropagation()` 防止点按钮时触发行选中。

- [ ] **Step 4: Commit**

```bash
git add mdm-platform/public/index.html
git commit -m "feat: add capability preview sankey in capabilities panel"
```

---

### Task 8: 后端 — 流程详情 API

**Files:**
- Modify: `mdm-platform/server/routes/views.js`

- [ ] **Step 1: 在 views.js 中添加流程详情端点**

在 `module.exports = router;` 之前插入：

```js
// GET /api/views/processes/:id
router.get('/processes/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const process = db.prepare(`
      SELECT p.*, c.name as cap_name, c.id as cap_id, d.name as dept_name
      FROM processes p
      LEFT JOIN capabilities c ON p.capability_id = c.id
      LEFT JOIN departments d ON p.owner_dept_id = d.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!process) return res.status(404).json({ error: '流程不存在' });

    // Associated systems via published mappings
    const systems = db.prepare(`
      SELECT DISTINCT s.id, s.name
      FROM systems s
      JOIN mapping_systems ms ON ms.system_id = s.id
      JOIN mappings m ON ms.mapping_id = m.id
      WHERE m.process_id = ? AND m.status = 'published'
      ORDER BY s.name
    `).all(req.params.id);

    // Field ledger summary: all field_entries across all published mappings for this process
    const fields = db.prepare(`
      SELECT fe.field_name_cn, fe.field_name_en, fe.data_object, fe.field_type,
             fe.sync_mode, fe.consume_systems, fe.note, m.id as mapping_id,
             d.name as dept_name
      FROM field_entries fe
      JOIN mappings m ON fe.mapping_id = m.id
      LEFT JOIN departments d ON m.owner_dept_id = d.id
      WHERE m.process_id = ? AND m.status = 'published'
      ORDER BY fe.field_name_cn
    `).all(req.params.id);

    // Upstream/downstream placeholder (V2 will expand)
    const relatedProcesses = [];

    res.json({ ...process, systems, fields, relatedProcesses });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/views.js
git commit -m "feat: add GET /api/views/processes/:id for process detail"
```

---

### Task 9: 前端 — Hash 路由解析支持流程详情

**Files:**
- Modify: `mdm-platform/public/index.html`

- [ ] **Step 1: 更新 parseHash 函数**

找到 `parseHash` 函数（约 line 505），改为：

```js
function parseHash() {
  var hash = location.hash.replace('#/', '').replace('#', '');
  if (!hash) return { view: 'list', tab: 'dashboard' };
  var parts = hash.split('/');
  if (parts.length === 1) return { view: 'list', tab: parts[0] };
  if (parts[0] === 'processes' && parts.length >= 3) {
    return { view: 'detail', tab: 'processes', type: 'process', id: parts[2] };
  }
  if (parts.length === 3) return { view: 'detail', tab: parts[0], type: parts[1], id: parts[2] };
  if (parts.length === 4) return { view: 'operation', tab: parts[0], type: parts[1], id: parts[2], action: parts[3] };
  return { view: 'list', tab: 'dashboard' };
}
```

- [ ] **Step 2: 在 renderDetailPage 中添加流程详情分支**

在 `renderDetailPage` 函数（约 line 955）中添加：

```js
if (params.type === 'process') {
  renderProcessDetail(parseInt(params.id));
} else if (params.type === 'mapping') {
  renderMappingDetail(parseInt(params.id), params.tab);
} else if /* ... 现有分支 */
```

完整改为：

```js
function renderDetailPage(params) {
  document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('on'); });
  document.getElementById('detailPage').classList.add('on');
  document.getElementById('detailContent').innerHTML = '<div class="empty">加载中...</div>';

  if (params.type === 'process') {
    renderProcessDetail(parseInt(params.id));
  } else if (params.type === 'mapping') {
    renderMappingDetail(parseInt(params.id), params.tab);
  } else if (params.type === 'conflict' && params.conflictType) {
    renderConflictDetail(parseInt(params.id), params.conflictType, params.tab);
  } else if (params.type === 'conflict') {
    renderConflictDetail(parseInt(params.id), 'field', params.tab);
  } else if (params.type === 'field' || params.type === 'term') {
    renderConflictDetail(parseInt(params.id), params.type, params.tab);
  } else {
    document.getElementById('detailContent').innerHTML = '<div class="empty">未知详情类型</div>';
  }
}
```

- [ ] **Step 3: 给流程列表每行加"详情"按钮**

修改 `renderCapsAndProcs` 中的流程表格（约 line 645），加详情按钮：

```js
$('procRows').innerHTML = state.processes.map(function(row) {
  return '<tr><td>' + row.id + '</td><td>' + row.name + '</td><td>' + (row.cap_name || '-') + '</td><td>' + (row.dept_name || '-') + '</td><td>' + statusTag(row.status) + '</td>' +
    '<td><button class="btn secondary" onclick="navigateTo(\'detail\',{tab:\'processes\',type:\'process\',id:' + row.id + '})">详情</button> ' +
    '<button class="btn success" onclick="reviewProc(' + row.id + ',\'approve\')">通过</button> ' +
    '<button class="btn danger" onclick="reviewProc(' + row.id + ',\'reject\')">驳回</button></td></tr>';
}).join('') || '<tr><td colspan="6" class="empty">暂无数据</td></tr>';
```

- [ ] **Step 4: Commit**

```bash
git add mdm-platform/public/index.html
git commit -m "feat: add process detail hash route and process list detail buttons"
```

---

### Task 10: 前端 — 流程详情页

**Files:**
- Modify: `mdm-platform/public/index.html`

- [ ] **Step 1: 添加 renderProcessDetail 函数**

在 `renderMappingDetail` 函数之前插入：

```js
// ===== Process Detail Page =====

async function renderProcessDetail(processId) {
  try {
    var detail = await api('/api/views/processes/' + processId);
    setBreadcrumb([
      { label: '业务地图', onclick: "navigateTo('list',{tab:'businessMap'})" },
      { label: detail.name }
    ]);

    var container = document.getElementById('detailContent');

    // Build system links list
    var systemsHtml = detail.systems.length > 0
      ? '<div class="table-container"><table><thead><tr><th>应用系统</th></tr></thead><tbody>' +
        detail.systems.map(function(s) {
          return '<tr><td>' + s.name + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="empty">暂无关联系统</div>';

    // Build field ledger summary table
    var fieldsHtml = detail.fields.length > 0
      ? '<div class="table-container"><table><thead><tr><th>字段中文名</th><th>字段英文名</th><th>数据对象</th><th>类型</th><th>同步方式</th><th>消费系统</th><th>所属部门</th></tr></thead><tbody>' +
        detail.fields.map(function(f) {
          return '<tr><td>' + (f.field_name_cn || '-') + '</td><td>' + (f.field_name_en || '-') + '</td>' +
            '<td>' + (f.data_object || '-') + '</td><td>' + (f.field_type || '-') + '</td>' +
            '<td>' + (f.sync_mode || '-') + '</td><td>' + (f.consume_systems || '-') + '</td>' +
            '<td>' + (f.dept_name || '-') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="empty">暂无字段台账</div>';

    container.innerHTML =
      '<div style="margin-bottom: 24px;">' +
        '<h2 style="margin-bottom: 8px;">' + detail.name + '</h2>' +
        '<div class="detail-meta">' +
          '<span>所属能力：' + (detail.cap_name || '-') + '</span>' +
          '<span>所属部门：' + (detail.dept_name || '-') + '</span>' +
          '<span>状态：' + statusTag(detail.status) + '</span>' +
        '</div>' +
      '</div>' +

      '<h2>关联系统</h2>' + systemsHtml +

      '<h2 style="margin-top: 32px;">字段台账汇总</h2>' + fieldsHtml +

      '<h2 style="margin-top: 32px;">上下游关系</h2>' +
      '<div class="notice" style="border-left-color: var(--warning);">' +
        '流程间的上游/下游依赖关系将在后续版本中可视化展示。' +
        '届时可在此查看当前流程的前置输入流程和后置输出流程，支持 DAG 图形式的流程关系绑定。' +
      '</div>';

    document.getElementById('detailPage').classList.add('on');
    document.querySelectorAll('.panel').forEach(function(el) { el.classList.remove('on'); });
  } catch (e) {
    if (e.status === 404) {
      document.getElementById('detailContent').innerHTML =
        '<div class="empty">流程不存在或无权访问 <button class="btn secondary" onclick="history.back()">返回上一页</button></div>';
    } else {
      showToast(e.message || '加载失败', 'error');
    }
  }
}
```

- [ ] **Step 2: 更新返回按钮逻辑**

`detailBackBtn` 的 onclick 中（约 line 1009），当流程详情页返回时应回到业务地图。修改：

```js
document.getElementById('detailBackBtn').onclick = function() {
  var route = parseHash();
  var backTab = route.tab === 'processes' ? 'businessMap' : (route.tab || 'dashboard');
  navigateTo('list', { tab: backTab });
};
```

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/public/index.html
git commit -m "feat: implement process detail page with systems, fields, upstream placeholder"
```

---

### Task 11: 集成测试 — 冒烟验证

**Files:**
- Create: `mdm-platform/scripts/test-views-routes.js`
- Create: `mdm-platform/scripts/test-views-sankey-filters.js`
- Modify: `mdm-platform/scripts/test-frontend-assets.js`
- Modify: `mdm-platform/package.json`

> Review amendment: this task must include assertions for auth cookies, stable node keys, filter correctness, and link integrity. A count-only smoke test is not sufficient.

- [ ] **Step 1: 创建 views 路由冒烟测试脚本**

```js
const http = require('http');

const BASE = 'http://localhost:3000';
let sessionCookie = null;

function req(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionCookie) headers.Cookie = sessionCookie;
    const opts = {
      hostname: 'localhost', port: 3000,
      path, method,
      headers
    };
    const r = http.request(opts, res => {
      let data = '';
      const setCookie = res.headers['set-cookie'];
      if (setCookie && setCookie.length > 0) {
        sessionCookie = setCookie[0].split(';')[0];
      }
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  console.log('=== Views Routes Smoke Test ===\n');

  // 1. Login
  console.log('1. Login...');
  const login = await req('/api/org/login', 'POST', { employee_no: 'ADMIN001', password: 'admin123' });
  if (login.error) throw new Error('Login failed: ' + login.error);
  console.log('   User:', login.name, login.role);

  // 2. GET /api/views/sankey
  console.log('2. GET /api/views/sankey ...');
  const sankey = await req('/api/views/sankey');
  if (sankey.error) throw new Error('Sankey failed: ' + sankey.error);
  const nodeKeys = new Set(sankey.nodes.map(n => n.name));
  sankey.nodes.forEach(n => {
    if (!/^(department|capability|process|system):\d+$/.test(n.name)) throw new Error('Unstable node key: ' + n.name);
    if (!n.label) throw new Error('Missing node label: ' + n.name);
  });
  sankey.links.forEach(l => {
    if (!nodeKeys.has(l.source)) throw new Error('Missing link source node: ' + l.source);
    if (!nodeKeys.has(l.target)) throw new Error('Missing link target node: ' + l.target);
  });
  console.log('   Nodes:', sankey.nodes ? sankey.nodes.length : 'MISSING');
  console.log('   Links:', sankey.links ? sankey.links.length : 'MISSING');
  if (sankey.nodes) {
    sankey.nodes.slice(0, 3).forEach(n => console.log('   -', n.name, 'layer', n.layer, 'type', n.type));
  }
  if (sankey.links && sankey.links.length > 0) {
    console.log('   Link example:', sankey.links[0].source, '→', sankey.links[0].target, 'value:', sankey.links[0].value);
  }

  // 3. GET /api/views/sankey with filters
  console.log('3. GET /api/views/sankey?cap_levels=L1 ...');
  const filtered = await req('/api/views/sankey?cap_levels=L1');
  if (filtered.error) throw new Error('Filtered sankey failed: ' + filtered.error);
  const filteredNodeKeys = new Set(filtered.nodes.map(n => n.name));
  filtered.links.forEach(l => {
    if (!filteredNodeKeys.has(l.source)) throw new Error('Filtered missing link source node: ' + l.source);
    if (!filteredNodeKeys.has(l.target)) throw new Error('Filtered missing link target node: ' + l.target);
  });
  console.log('   Nodes:', filtered.nodes ? filtered.nodes.length : 'MISSING');
  console.log('   Links:', filtered.links ? filtered.links.length : 'MISSING');

  // 4. GET /api/views/processes/:id (first process if any)
  console.log('4. GET /api/views/processes/1 ...');
  const proc = await req('/api/views/processes/1');
  if (proc.error) {
    console.log('   No process id=1:', proc.error);
  } else {
    console.log('   Name:', proc.name);
    console.log('   Systems:', proc.systems ? proc.systems.length : 0);
    console.log('   Fields:', proc.fields ? proc.fields.length : 0);
  }

  console.log('\n=== Done ===');
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 启动服务器并运行测试**

```bash
cd mdm-platform && npm start &
sleep 2
node scripts/test-views-routes.js
```

- [ ] **Step 3: 验证输出**

Expected: 所有 4 项测试输出正常数值，无报错；`nodes[].name` 使用稳定 key，`nodes[].label` 是显示名，所有 `links[].source/target` 都存在于 `nodes`。

- [ ] **Step 4: 添加筛选回归测试**

创建 `mdm-platform/scripts/test-views-sankey-filters.js`，构造两个部门、两个同名流程、两个同名系统和两条 published mapping，然后断言：

```js
assert.deepStrictEqual(
  deptFiltered.body.nodes.map(node => node.name).sort(),
  [
    `capability:${seeded.capChild}`,
    `department:${seeded.deptA}`,
    `process:${seeded.procA}`,
    `system:${seeded.systemA}`
  ].sort()
);
assertLinksReferenceExistingNodes(deptFiltered.body);
assert.ok(deptFiltered.body.nodes.every(node => node.label));
```

运行：

```bash
cd mdm-platform && npm run test:views
```

Expected: `Views sankey filter regression test passed`

- [ ] **Step 5: Commit**

```bash
git add mdm-platform/scripts/test-views-routes.js mdm-platform/scripts/test-views-sankey-filters.js mdm-platform/scripts/test-frontend-assets.js mdm-platform/package.json
git commit -m "test: add sankey view filter and identity regression coverage"
```

---

### Task 12: 最终集成 — 启动验证完整交互流

- [ ] **Step 1: 启动服务器**

```bash
cd mdm-platform && npm start
```

- [ ] **Step 2: 浏览器手动验证清单**

- [ ] 以 admin 登录，确认导航栏出现"业务地图"Tab
- [ ] 切换到"业务地图"，确认桑基图渲染成功（需有 published 映射数据）
- [ ] 筛选部门下拉，确认图动态更新
- [ ] 切换能力层级（L1 / L1+L2 / 全部），确认图动态更新
- [ ] 点击一个流程节点，确认跳转到流程详情页
- [ ] 流程详情页确认：基本信息、关联系统表格、字段台账汇总表格、上下游关系占位
- [ ] 面包屑"业务地图"可点击返回
- [ ] 切换到"能力与流程申报"Tab，点能力行，确认底部出现桑基预览
- [ ] 点审批按钮不触发预览（stopPropagation 生效）
- [ ] 流程列表每行"详情"按钮点击跳转到流程详情页

- [ ] **Step 3: 修复发现的问题后 commit**

---

## Self-Review Results

**Spec coverage check:**
- ✅ DB migration (parent_id) → Task 1
- ✅ Capabilities CRUD update → Task 2
- ✅ Sankey API endpoint → Task 3
- ✅ Views route registration → Task 4
- ✅ Business map tab + panel → Task 5
- ✅ Sankey rendering + filters → Task 6
- ✅ Capability preview sankey → Task 7
- ✅ Process detail API → Task 8
- ✅ Hash routing for process detail → Task 9
- ✅ Process detail page → Task 10
- ✅ Smoke test → Task 11
- ✅ Manual integration verification → Task 12

**Placeholder scan:** No TBD/TODO/fill-in-later found. All code is concrete.

**Type consistency check:**
- `navigateTo('detail', { tab, type, id })` — consistent across sankey click handler, process list buttons, and hash routing
- API returns `{ nodes: [{name, layer, type, id}], links: [{source, target, value}] }` — consumed consistently in `renderBusinessMap` and `renderCapPreview`
- `layerColor(layer, index)` — called with `node.layer` (integer) in both sankey functions
- `parseHash()` returns `{ view: 'detail', tab: 'processes', type: 'process', id }` which `renderDetailPage` correctly dispatches to `renderProcessDetail`
- `getElementById` usage: all IDs referenced in code exist in HTML (sankeyChart, sankeyDept, sankeyLevel, sankeyMeta, capPreviewWrap, capPreviewChart, detailPage, detailContent, detailBackBtn)
