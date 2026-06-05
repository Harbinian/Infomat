# 桑基图反馈表单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为财务部桑基图 HTML 嵌入 A1 反馈表单，部门人员点击桑基图 A1 节点弹出选择题卡片，填完后导出 JSON。

**Architecture:** 注入式生成脚本 `scripts/build-feedback-sankey.mjs`，读取现有桑基图 HTML → 在关键锚点注入反馈 CSS/HTML/JS → 输出增强版 HTML。不复制现有图表代码，只在 `</style>`、`</main>`、`</script>` 三个位置注入。HTML 保持独立文件，无后端依赖。

**Tech Stack:** Node.js (built-in `fs`), ECharts (CDN), vanilla JS/CSS

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `scripts/build-feedback-sankey.mjs` | 注入脚本：读原始 HTML → 注入反馈功能 → 输出增强版 |
| `docs/norms/财务部部门能力流程系统桑基图.html` | 输入+输出：读取现有版本，注入后覆盖 |

---

### Task 1: 创建注入脚本骨架

**Files:**
- Create: `scripts/build-feedback-sankey.mjs`

- [ ] **Step 1: 创建脚本骨架，实现"读取→注入→写出"框架**

```javascript
// scripts/build-feedback-sankey.mjs
import { readFileSync, writeFileSync } from 'fs';

const DEPT = process.argv[2] || '财务部';
const HTML_FILE = `docs/norms/${DEPT}部门能力流程系统桑基图.html`;

let html = readFileSync(HTML_FILE, 'utf-8');

// 统计 A1 数量（从现有 JS 数据中提取）
const a1Match = html.match(/var a1Rows = \[([\s\S]*?)\];/);
const a1Count = a1Match ? (a1Match[1].match(/\["CW-L3-/g) || []).length : 0;
console.log(`${DEPT}: ${a1Count} A1 rows detected`);

// 注入点 1: 在 </style> 前注入反馈面板 CSS
html = html.replace('</style>', FEEDBACK_CSS + '\n</style>');

// 注入点 2: 在 </main> 前注入反馈面板 HTML + 进度条 + 使用说明
html = html.replace('</main>', FEEDBACK_HTML(DEPT, a1Count) + '\n</main>');

// 注入点 3: 在最后的 </script> 前注入反馈 JS
html = html.replace(/<\/script>\s*<\/body>/, FEEDBACK_JS(DEPT, a1Count) + '\n</script>\n</body>');

writeFileSync(HTML_FILE, html, 'utf-8');
console.log(`Done: ${HTML_FILE}`);
```

- [ ] **Step 2: 验证脚本可运行**

```bash
node scripts/build-feedback-sankey.mjs 财务部
```

Expected: 输出 `财务部: 83 A1 rows detected` + `Done: docs/norms/财务部部门能力流程系统桑基图.html`

- [ ] **Step 3: Commit**

```bash
git add scripts/build-feedback-sankey.mjs
git commit -m "feat: add injection scaffold for feedback sankey builder"
```

---

### Task 2: 注入反馈面板 CSS

**Files:**
- Modify: `scripts/build-feedback-sankey.mjs`（添加 FEEDBACK_CSS 常量）

- [ ] **Step 1: 定义完整的反馈面板 CSS**

```javascript
const FEEDBACK_CSS = `
/* === 反馈系统样式 === */
.progress-bar-wrap {
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  padding: 12px 16px; margin-bottom: 14px; display: flex; align-items: center; gap: 12px;
}
.progress-bar-wrap .label { font-size: 13px; color: #475569; white-space: nowrap; }
.progress-track { flex: 1; height: 10px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 999px; background: var(--teal); transition: width 0.3s; width: 0%; }
.progress-text { font-size: 13px; color: #334155; font-weight: 700; white-space: nowrap; }

.feedback-backdrop {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(15,23,42,0.3); z-index: 999; display: none;
}
.feedback-backdrop.show { display: block; }

.feedback-overlay {
  position: fixed; top: 0; right: 0; bottom: 0; width: 460px; max-width: 100vw;
  background: #fff; box-shadow: -4px 0 24px rgba(15,23,42,0.15);
  z-index: 1000; transform: translateX(100%); transition: transform 0.28s ease;
  display: flex; flex-direction: column;
}
.feedback-overlay.open { transform: translateX(0); }
.feedback-overlay .fb-header {
  padding: 14px 20px; border-bottom: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
}
.feedback-overlay .fb-header h3 { font-size: 15px; color: #0b2755; }
.feedback-overlay .fb-close {
  width: 32px; height: 32px; border: 1px solid var(--border); background: #fff;
  border-radius: 6px; cursor: pointer; font-size: 18px; color: #64748b; line-height: 28px; text-align: center;
}
.feedback-overlay .fb-close:hover { background: #f1f5f9; }
.feedback-overlay .fb-body { flex: 1; overflow-y: auto; padding: 20px; }
.feedback-overlay .fb-footer { padding: 14px 20px; border-top: 1px solid var(--border); flex-shrink: 0; }

.q-block { margin-bottom: 18px; }
.q-block .q-label { font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px; }
.q-block .q-hint {
  font-size: 12px; color: #64748b; margin-bottom: 6px;
  padding: 6px 10px; background: #f8fafc; border-radius: 4px; border-left: 3px solid #e2e8f0;
}
.q-options { display: flex; flex-direction: column; gap: 4px; }
.q-opt {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border: 1px solid var(--border); border-radius: 6px; cursor: pointer;
  font-size: 13px; color: #334155; transition: 0.15s; user-select: none;
}
.q-opt:hover { border-color: var(--blue); background: #eef6ff; }
.q-opt.selected { border-color: var(--blue); background: #eef6ff; color: #1a56db; font-weight: 700; }
.q-opt .radio {
  width: 16px; height: 16px; border-radius: 50%; border: 2px solid #cbd5e1; flex-shrink: 0;
}
.q-opt.selected .radio { border-color: var(--blue); background: var(--blue); box-shadow: inset 0 0 0 3px #fff; }

.a1-context {
  margin-bottom: 16px; padding: 10px 12px; background: #f8fafc; border-radius: 6px;
  font-size: 12px; color: #475569; line-height: 1.6;
}
.a1-context b { color: #0b2755; }

.note-area {
  width: 100%; min-height: 64px; border: 1px solid var(--border); border-radius: 6px;
  padding: 8px 12px; font-size: 13px; resize: vertical; font-family: inherit;
  box-sizing: border-box;
}
.note-area:focus { outline: none; border-color: var(--blue); }

.fb-submit {
  width: 100%; height: 40px; background: var(--blue); color: #fff;
  border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer;
}
.fb-submit:hover { filter: brightness(1.1); }

.export-bar {
  display: flex; gap: 8px; align-items: center; margin-bottom: 14px; flex-wrap: wrap;
}
.export-btn {
  height: 36px; border: 1px solid var(--teal); background: #fff; color: var(--teal);
  border-radius: 7px; padding: 0 16px; font-size: 13px; cursor: pointer; font-weight: 700;
}
.export-btn:hover { background: #f0fdfa; }

.node-legend { display: flex; gap: 14px; font-size: 12px; color: #64748b; align-items: center; margin-left: 8px; }
.node-legend .dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
.dot.done { background: #16a34a; }
.dot.issue { background: #f59e0b; }
.dot.wrong { background: #dc2626; }

.fb-guide {
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  padding: 16px 20px; margin-bottom: 14px;
}
.fb-guide h3 { font-size: 14px; color: #0b2755; margin-bottom: 8px; }
.fb-guide ol { padding-left: 20px; font-size: 12px; color: #475569; line-height: 1.9; }
.fb-guide .key { display: inline-block; background: #f1f5f9; padding: 1px 6px; border-radius: 3px; font-family: monospace; font-size: 11px; color: #334155; }

@media (max-width: 900px) {
  .feedback-overlay { width: 100vw; }
}
`;
```

- [ ] **Step 2: Commit**

```bash
git add scripts/build-feedback-sankey.mjs
git commit -m "feat: add feedback panel CSS to injection script"
```

---

### Task 3: 注入反馈面板 HTML + 使用说明 + 进度条

**Files:**
- Modify: `scripts/build-feedback-sankey.mjs`（添加 FEEDBACK_HTML 函数）

- [ ] **Step 1: 定义 FEEDBACK_HTML 函数**

```javascript
function FEEDBACK_HTML(dept, total) {
  return `
<div class="fb-guide">
  <h3>反馈操作说明</h3>
  <ol>
    <li>切换<b>能力域（L1）视图</b>，进入具体业务域</li>
    <li>在桑基图中<b>点击业务行为（A1）节点</b>，右侧弹出反馈卡片</li>
    <li>逐一回答选择题（每题必选），选"有问题"的选项后填写备注</li>
    <li>点击<b>"确认本条"</b>保存反馈，节点颜色自动更新</li>
    <li>全部完成后点击<b>"导出反馈 JSON"</b>，下载文件发送给信息化项目组</li>
    <li>绿色=<b>准确</b>，黄色=<b>有小问题</b>，红色=<b>需重写</b></li>
  </ol>
</div>

<div class="export-bar">
  <button class="export-btn" id="exportJsonBtn">导出反馈 JSON</button>
  <span class="node-legend">
    <span><span class="dot done"></span>准确</span>
    <span><span class="dot issue"></span>有小问题</span>
    <span><span class="dot wrong"></span>需重写</span>
  </span>
</div>

<div class="progress-bar-wrap">
  <span class="label">反馈进度</span>
  <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
  <span class="progress-text" id="progressText">0 / ${total}</span>
</div>

<div class="feedback-backdrop" id="feedbackBackdrop"></div>
<div class="feedback-overlay" id="feedbackPanel">
  <div class="fb-header">
    <h3 id="feedbackTitle">业务行为反馈</h3>
    <button class="fb-close" id="feedbackClose">&times;</button>
  </div>
  <div class="fb-body" id="feedbackBody"></div>
  <div class="fb-footer">
    <button class="fb-submit" id="feedbackSubmit">确认本条</button>
  </div>
</div>
`;
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/build-feedback-sankey.mjs
git commit -m "feat: add feedback panel HTML + guide + progress bar injection"
```

---

### Task 4: 注入反馈交互 JS

**Files:**
- Modify: `scripts/build-feedback-sankey.mjs`（添加 FEEDBACK_JS 函数）

- [ ] **Step 1: 定义核心反馈 JS**

```javascript
function FEEDBACK_JS(dept, total) {
  return `
// ===== 反馈状态管理 =====
var feedbackState = {};
var currentA1Id = null;
var TOTAL = ${total};

// ===== 构建 A1 索引（快速查找） =====
var a1Index = {};
a1Rows.forEach(function(r) {
  a1Index[r[0]] = { name: r[1], role: r[2], trigger: r[3], precondition: r[4],
    approval: r[5], system: r[6], evidence: r[7], evidenceType: r[8],
    domain: r[9], capability: r[10], process: r[11], alert: r[12] || '' };
});

// ===== 反馈卡片 =====
function openFeedbackCard(a1Id) {
  var info = a1Index[a1Id];
  if (!info) return;

  currentA1Id = a1Id;
  var fb = feedbackState[a1Id] || {};

  document.getElementById('feedbackTitle').innerText = a1Id + ' 反馈';
  var body = document.getElementById('feedbackBody');

  // A1 信息摘要
  var html = '<div class="a1-context"><b>' + info.name + '</b><br>';
  html += '执行角色: ' + info.role + ' | 审批: ' + info.approval + ' | 系统: ' + info.system;
  if (info.alert) html += '<br><span style="color:#92400e">核验提醒: ' + info.alert + '</span>';
  html += '</div>';

  // Q1: 整体确认
  html += qBlock(1, '本行业务行为描述是否准确反映了实际业务？', '',
    [['accurate','准确，无需修改'],['minor_issue','基本准确，有小问题'],['inaccurate','不准确，需要重写']],
    fb.row_confirmed);

  // Q2: 执行角色
  html += qBlock(2, '执行角色描述是否正确？', '当前描述: ' + info.role,
    [['correct','正确'],['wrong','不对'],['unsure','不清楚']],
    fb.role_confirmed);

  // Q3: 审批类型
  html += qBlock(3, '审批类型是否正确？', '当前描述: ' + info.approval,
    [['correct','正确'],['wrong','不对'],['unsure','不清楚']],
    fb.approval_confirmed);

  // Q4: 输入输出部门
  html += qBlock(4, '跨部门输入/输出关系是否正确？', '',
    [['correct','正确'],['wrong','不对'],['unsure','不清楚']],
    fb.io_dept_confirmed);

  // Q5: 核验提醒回应（仅当有提醒时）
  if (info.alert) {
    html += qBlock(5, '对于以下核验提醒，你的反馈是？', '提醒: ' + info.alert,
      [['agree','同意，需要细化'],['disagree','不同意，当前描述足够'],['not_applicable','不适用']],
      fb.verification_response);
  }

  // 备注
  var showNotes = fb.row_confirmed === 'minor_issue' || fb.row_confirmed === 'inaccurate'
    || fb.role_confirmed === 'wrong' || fb.approval_confirmed === 'wrong'
    || fb.io_dept_confirmed === 'wrong';
  html += '<div class="q-block" id="notesBlock" style="display:' + (showNotes?'block':'none') + '">';
  html += '<div class="q-label">补充说明（选填）</div>';
  html += '<textarea class="note-area" id="feedbackNotes" placeholder="如有需要，请在此补充说明...">' + (fb.notes||'') + '</textarea>';
  html += '</div>';

  body.innerHTML = html;

  // 绑定选项点击
  body.querySelectorAll('.q-opt').forEach(function(opt) {
    opt.addEventListener('click', function() {
      var parent = opt.parentElement;
      parent.querySelectorAll('.q-opt').forEach(function(o) { o.classList.remove('selected'); });
      opt.classList.add('selected');
      updateNotesVisibility();
    });
  });

  document.getElementById('feedbackPanel').classList.add('open');
  document.getElementById('feedbackBackdrop').classList.add('show');
}

function qBlock(num, question, hint, options, selectedVal) {
  var h = '<div class="q-block">';
  h += '<div class="q-label">' + num + '. ' + question + '</div>';
  if (hint) h += '<div class="q-hint">' + hint + '</div>';
  h += '<div class="q-options">';
  options.forEach(function(o) {
    var sel = o[0] === selectedVal ? ' selected' : '';
    h += '<div class="q-opt' + sel + '" data-val="' + o[0] + '" data-q="' + num + '">';
    h += '<span class="radio"></span>' + o[1];
    h += '</div>';
  });
  h += '</div></div>';
  return h;
}

function updateNotesVisibility() {
  var show = false;
  document.querySelectorAll('.q-opt.selected').forEach(function(o) {
    var v = o.dataset.val;
    if (v === 'minor_issue' || v === 'inaccurate' || v === 'wrong') show = true;
  });
  document.getElementById('notesBlock').style.display = show ? 'block' : 'none';
}

function collectFeedback() {
  var fb = {};
  document.querySelectorAll('.q-opt.selected').forEach(function(o) {
    var q = o.dataset.q, v = o.dataset.val;
    if (q === '1') fb.row_confirmed = v;
    else if (q === '2') fb.role_confirmed = v;
    else if (q === '3') fb.approval_confirmed = v;
    else if (q === '4') fb.io_dept_confirmed = v;
    else if (q === '5') fb.verification_response = v;
  });
  var ta = document.getElementById('feedbackNotes');
  fb.notes = ta ? ta.value.trim() : '';
  return fb;
}

function closeFeedbackCard() {
  document.getElementById('feedbackPanel').classList.remove('open');
  document.getElementById('feedbackBackdrop').classList.remove('show');
  currentA1Id = null;
}

// ===== 提交 =====
document.getElementById('feedbackSubmit').addEventListener('click', function() {
  if (!currentA1Id) return;
  feedbackState[currentA1Id] = collectFeedback();
  updateProgress();
  closeFeedbackCard();
  render(currentDomain);  // 重新渲染以更新节点颜色
});

document.getElementById('feedbackClose').addEventListener('click', closeFeedbackCard);
document.getElementById('feedbackBackdrop').addEventListener('click', closeFeedbackCard);

// ===== 进度条 =====
function updateProgress() {
  var done = Object.keys(feedbackState).length;
  var pct = Math.round(done / TOTAL * 100);
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').innerText = done + ' / ' + TOTAL;
}

// ===== 导出 JSON =====
document.getElementById('exportJsonBtn').addEventListener('click', function() {
  var result = {
    department: '${dept}',
    exported_at: new Date().toISOString(),
    total: TOTAL,
    completed: Object.keys(feedbackState).length,
    feedback: []
  };
  a1Rows.forEach(function(r) {
    if (feedbackState[r[0]]) {
      var fb = feedbackState[r[0]];
      result.feedback.push({
        a1_id: r[0],
        a1_name: r[1],
        row_confirmed: fb.row_confirmed || '',
        role_confirmed: fb.role_confirmed || '',
        approval_confirmed: fb.approval_confirmed || '',
        io_dept_confirmed: fb.io_dept_confirmed || '',
        verification_response: fb.verification_response || '',
        notes: fb.notes || ''
      });
    }
  });
  var blob = new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = '${dept}-反馈-' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
`;
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/build-feedback-sankey.mjs
git commit -m "feat: add feedback interaction JS injection"
```

---

### Task 5: 修改 ECharts 部分——A1 节点点击事件 + 节点颜色

**Files:**
- Modify: `scripts/build-feedback-sankey.mjs`（在 FEEDBACK_JS 末尾追加 ECharts 补丁代码）

- [ ] **Step 1: 追加 feedbackNodeColors 字典和节点颜色注入逻辑**

在 FEEDBACK_JS 返回字符串的末尾（`});` 之前）追加：

```javascript
// ===== ECharts 补丁：节点颜色 + 点击事件 =====
var feedbackNodeColors = {};

// Monkey-patch myChart.setOption 以便每次渲染后注入点击事件
var _origSetOption = myChart.setOption.bind(myChart);
myChart.setOption = function(option, notMerge) {
  _origSetOption(option, notMerge);
  // 注入 A1 点击事件
  myChart.off('click');
  myChart.on('click', function(params) {
    if (params.data && params.data.name && params.data.name.startsWith('a1_')) {
      var a1Id = params.data.name.substring(3);
      openFeedbackCard(a1Id);
    }
  });
};

// Monkey-patch buildDomainSankey 以在 A1 节点上应用 feedbackNodeColors
var _origBuildDomainSankey = buildDomainSankey;
buildDomainSankey = function(domain) {
  var result = _origBuildDomainSankey(domain);
  result.nodes.forEach(function(n) {
    if (n.name.startsWith('a1_') && feedbackNodeColors[n.name]) {
      n.itemStyle = { color: feedbackNodeColors[n.name], borderColor: feedbackNodeColors[n.name] };
    }
  });
  return result;
};

// 提交反馈后更新节点颜色映射
function syncNodeColors() {
  Object.keys(feedbackState).forEach(function(a1Id) {
    var fb = feedbackState[a1Id];
    var nodeName = 'a1_' + a1Id;
    if (fb.row_confirmed === 'accurate') feedbackNodeColors[nodeName] = '#16a34a';
    else if (fb.row_confirmed === 'minor_issue') feedbackNodeColors[nodeName] = '#f59e0b';
    else if (fb.row_confirmed === 'inaccurate') feedbackNodeColors[nodeName] = '#dc2626';
  });
}

// 在提交后调用 syncNodeColors
var _origSubmit = document.getElementById('feedbackSubmit').addEventListener;
document.getElementById('feedbackSubmit').addEventListener('click', function() {
  setTimeout(function() {
    syncNodeColors();
  }, 50);
});
```

- [ ] **Step 2: 修复提交事件的双重绑定问题**

第 4 步的提交按钮已经绑定了事件。这里追加 syncNodeColors 调用会冲突。改为在第 4 步的 FEEDBACK_JS 中，提交处理函数内部直接调用 syncNodeColors：

在 collectFeedback 之后、closeFeedbackCard 之前加入：

```javascript
syncNodeColors();
```

同时把 syncNodeColors 函数定义放在 FEEDBACK_JS 中（提交处理函数之前）。

- [ ] **Step 3: Commit**

```bash
git add scripts/build-feedback-sankey.mjs
git commit -m "feat: wire ECharts A1 click event and feedback node coloring"
```

---

### Task 6: 运行并验证财务部

**Files:**
- Modify: `docs/norms/财务部部门能力流程系统桑基图.html`（由脚本生成）

- [ ] **Step 1: 备份原始 HTML**

```bash
copy docs\norms\财务部部门能力流程系统桑基图.html docs\norms\财务部部门能力流程系统桑基图.html.bak
```

- [ ] **Step 2: 运行注入脚本**

```bash
node scripts/build-feedback-sankey.mjs 财务部
```

Expected: `财务部: 83 A1 rows detected` → `Done: docs/norms/财务部部门能力流程系统桑基图.html`

- [ ] **Step 3: 在浏览器中打开验证**

打开 `docs/norms/财务部部门能力流程系统桑基图.html`，逐项检查：

1. 使用说明在页面顶部可见
2. 进度条显示 `0 / 83`
3. 导出按钮可见
4. 切换到具体能力域（L1），点击 A1 节点 → 右侧弹出反馈卡片
5. 卡片显示 A1 基础信息（名称、角色、审批、系统）
6. 有核验提醒的行显示第 5 题，无提醒的不显示
7. 选"有小问题"或"不准确" → 备注框出现
8. 点"确认本条" → 面板关闭，进度条更新
9. 节点颜色更新（重新渲染后）

- [ ] **Step 4: 验证导出 JSON**

填几条反馈后，点击"导出反馈 JSON"，检查下载文件：
- `department` 为 "财务部"
- `feedback` 数组中每条有完整的 `a1_id`、`row_confirmed` 等字段
- `notes` 字段存在（空或填入的内容）

- [ ] **Step 5: Commit**

```bash
git add docs/norms/财务部部门能力流程系统桑基图.html scripts/build-feedback-sankey.mjs
git commit -m "feat: inject feedback form into 财务部 sankey (83 A1 rows)"
```

---

### Task 7: 扩展到其他五个部门

**Files:**
- 运行脚本覆盖五个部门的桑基图 HTML

- [ ] **Step 1: 备份并批量生成**

```bash
for d in "经营发展部" "物资保障部" "项目管理部" "行政人事部" "运维安环部"; do
  copy "docs\norms\${d}部门能力流程系统桑基图.html" "docs\norms\${d}部门能力流程系统桑基图.html.bak"
  node scripts/build-feedback-sankey.mjs "$d"
done
```

- [ ] **Step 2: 抽查经营发展部**

打开生成的经营发展部桑基图，验证数据量和反馈功能正常。

- [ ] **Step 3: Commit**

```bash
git add docs/norms/*部门能力流程系统桑基图.html
git commit -m "feat: inject feedback form into all 5 remaining department sankey views"
```
