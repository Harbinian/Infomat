# 冲突管理升级实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将冲突管理从"人工指派+线下沟通"升级为"自动路由+系统内闭环"——warn级静默、error级自动双指派+限时+超时升级。

**Architecture:** 纯后端规则驱动，不引入 Agent/LLM。在现有 conflicts.js 路由内增强分流逻辑、自动指派、超时检查。前端 split-view 拆待协调/静默两个列表，详情页增加双立场对比和时间线。

**Tech Stack:** Express.js + better-sqlite3 + 原生 HTML/CSS/JS（无框架）

**Files:**
- Modify: `mdm-platform/server/db.js` — 新增字段 + CHECK约束扩展
- Modify: `mdm-platform/server/routes/conflicts.js` — 检测分流、自动双指派、超时升级、新端点
- Modify: `mdm-platform/public/index.html` — 冲突列表拆分、详情增强、仪表盘卡片
- Create: `mdm-platform/scripts/check-escalations.js` — 超时升级手动检查脚本
- Modify: `mdm-platform/scripts/test-conflict-routes.js` — 更新测试覆盖新流程

---

### Task 1: 数据模型迁移

**Files:**
- Modify: `mdm-platform/server/db.js` (在现有迁移块末尾追加)

- [ ] **Step 1: 新增列迁移**

在 db.js 的最后一个 migration 块之后添加：

```js
// Migration: conflict management upgrade — add deadline, escalated, resolution_type
const fcCols = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='field_conflicts'").get();
if (fcCols && !fcCols.sql.includes('deadline DATE')) {
  db.exec('ALTER TABLE field_conflicts ADD COLUMN deadline DATE');
  db.exec('ALTER TABLE field_conflicts ADD COLUMN escalated INTEGER DEFAULT 0');
  db.exec('ALTER TABLE field_conflicts ADD COLUMN resolution_type TEXT');
  console.log('Migration: added deadline/escalated/resolution_type to field_conflicts');
}
const tcCols = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='term_conflicts'").get();
if (tcCols && !tcCols.sql.includes('deadline DATE')) {
  db.exec('ALTER TABLE term_conflicts ADD COLUMN deadline DATE');
  db.exec('ALTER TABLE term_conflicts ADD COLUMN escalated INTEGER DEFAULT 0');
  db.exec('ALTER TABLE term_conflicts ADD COLUMN resolution_type TEXT');
  console.log('Migration: added deadline/escalated/resolution_type to term_conflicts');
}
```

- [ ] **Step 2: CHECK约束扩展 — field_conflicts（加入silenced/escalated状态）**

紧接上一步后添加：

```js
// Migration: update field_conflicts CHECK to include silenced/escalated
const fcSql2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='field_conflicts'").get();
if (fcSql2 && !fcSql2.sql.includes("'silenced'")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE field_conflicts_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field_entry_a_id INTEGER NOT NULL REFERENCES field_entries(id) ON DELETE CASCADE,
        field_entry_b_id INTEGER NOT NULL REFERENCES field_entries(id) ON DELETE CASCADE,
        conflict_field TEXT NOT NULL CHECK(conflict_field IN ('authoritative_system','note','field_type','sync_mode','consume_systems','other')),
        submitter_a INTEGER REFERENCES users(id),
        value_a TEXT,
        submitter_b INTEGER REFERENCES users(id),
        value_b TEXT,
        dept_a INTEGER REFERENCES departments(id),
        dept_b INTEGER REFERENCES departments(id),
        severity TEXT NOT NULL CHECK(severity IN ('blocking','high','medium','low','warn','error')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','silenced','coordinating','escalated','resolved','rejected','archived')),
        resolution TEXT,
        resolved_by INTEGER REFERENCES users(id),
        resolved_at DATETIME,
        deadline DATE,
        escalated INTEGER DEFAULT 0,
        resolution_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO field_conflicts_v2 SELECT id, field_entry_a_id, field_entry_b_id, conflict_field,
        submitter_a, value_a, submitter_b, value_b, dept_a, dept_b, severity, status,
        resolution, resolved_by, resolved_at, deadline, escalated, resolution_type, created_at
        FROM field_conflicts;
      DROP TABLE field_conflicts;
      ALTER TABLE field_conflicts_v2 RENAME TO field_conflicts;
    `);
  })();
  console.log('Migration: added silenced/escalated to field_conflicts CHECK');
}
```

- [ ] **Step 3: CHECK约束扩展 — term_conflicts（加入silenced/escalated）**

紧接上一步后添加：

```js
// Migration: update term_conflicts CHECK to include silenced/escalated
const tcSql2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='term_conflicts'").get();
if (tcSql2 && !tcSql2.sql.includes("'silenced'")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE term_conflicts_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term TEXT NOT NULL,
        dept_a INTEGER REFERENCES departments(id),
        dept_a_meaning TEXT,
        dept_b INTEGER REFERENCES departments(id),
        dept_b_meaning TEXT,
        severity TEXT NOT NULL CHECK(severity IN ('blocking','high','medium','low','warn','error')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','silenced','coordinating','escalated','resolved','rejected','archived')),
        resolution TEXT,
        resolved_by INTEGER REFERENCES users(id),
        resolved_at DATETIME,
        deadline DATE,
        escalated INTEGER DEFAULT 0,
        resolution_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO term_conflicts_v2 SELECT id, term, dept_a, dept_a_meaning, dept_b, dept_b_meaning,
        severity, status, resolution, resolved_by, resolved_at,
        deadline, escalated, resolution_type, created_at
        FROM term_conflicts;
      DROP TABLE term_conflicts;
      ALTER TABLE term_conflicts_v2 RENAME TO term_conflicts;
    `);
  })();
  console.log('Migration: added silenced/escalated to term_conflicts CHECK');
}
```

- [ ] **Step 4: 验证迁移**

```bash
cd mdm-platform && node -e "
const db = require('./server/db');
const fc = db.prepare(\"SELECT sql FROM sqlite_master WHERE type='table' AND name='field_conflicts'\").get();
console.log('field_conflicts CHECK includes silenced:', fc.sql.includes(\"'silenced'\"));;
console.log('field_conflicts CHECK includes escalated:', fc.sql.includes(\"'escalated'\"));;
console.log('field_conflicts has deadline column:', fc.sql.includes('deadline'));
const tc = db.prepare(\"SELECT sql FROM sqlite_master WHERE type='table' AND name='term_conflicts'\").get();
console.log('term_conflicts CHECK includes silenced:', tc.sql.includes(\"'silenced'\"));;
console.log('term_conflicts CHECK includes escalated:', tc.sql.includes(\"'escalated'\"));;
console.log('term_conflicts has deadline column:', tc.sql.includes('deadline'));
"
```

期望输出：所有 6 个检查均返回 `true`。

- [ ] **Step 5: Commit**

```bash
git add mdm-platform/server/db.js && git commit -m "feat: add deadline/escalated/silenced fields to conflict tables"
```

---

### Task 2: 检测分流 + 自动双指派

**Files:**
- Modify: `mdm-platform/server/routes/conflicts.js`

- [ ] **Step 1: 在 handleDbError 之上添加工作日计算和自动指派辅助函数**

在 `const FIELD_ENTRY_CONFLICT_FIELDS = ...` 行之后，`function handleDbError` 之前插入：

```js
function addWorkingDays(startDate, days) {
  const d = new Date(startDate);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function autoAssignBothDepts(conflictId, conflictType, deptA, deptB) {
  const today = new Date().toISOString().slice(0, 10);
  const deadline = addWorkingDays(today, 3);

  // Find owner for each department: data_owner first, manager fallback
  const assigneeA = db.prepare(`
    SELECT id FROM users WHERE department_id = ? AND (id = (SELECT data_owner_user_id FROM departments WHERE id = ?) OR id = (SELECT manager_user_id FROM departments WHERE id = ?))
    LIMIT 1
  `).get(deptA, deptA, deptA);

  const assigneeB = db.prepare(`
    SELECT id FROM users WHERE department_id = ? AND (id = (SELECT data_owner_user_id FROM departments WHERE id = ?) OR id = (SELECT manager_user_id FROM departments WHERE id = ?))
    LIMIT 1
  `).get(deptB, deptB, deptB);

  const sysUserId = 0; // system-initiated

  [assigneeA, assigneeB].forEach(function(assignee) {
    if (assignee) {
      db.prepare(`
        INSERT INTO conflict_assignments (conflict_id, conflict_type, assignee_user_id, assigned_by)
        VALUES (?, ?, ?, ?)
      `).run(conflictId, conflictType, assignee.id, sysUserId);
    }
  });

  // Update deadline on conflict record
  const table = conflictType === 'term' ? 'term_conflicts' : 'field_conflicts';
  db.prepare(`UPDATE ${table} SET deadline = ? WHERE id = ?`).run(deadline, conflictId);

  // Create todos for both departments
  const deptNames = [];
  [deptA, deptB].forEach(function(did) {
    const dept = db.prepare('SELECT name FROM departments WHERE id = ?').get(did);
    if (dept) deptNames.push(dept.name);
  });
  const todoContent = '冲突协调：' + deptNames.join(' vs ') + '（截止：' + deadline + '）';

  [deptA, deptB].forEach(function(did) {
    db.prepare(`
      INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, content, urgency)
      VALUES (NULL, ?, 'conflict_resolution', NULL, ?, 'high')
    `).run(did, todoContent);
  });
}
```

- [ ] **Step 2: 重写 POST /detect 的分流逻辑**

找到现有的 `POST /detect` 路由（约第 358 行）。将 term_conflicts 插入和 field_conflicts 插入改为按 severity 分流。

替换 `POST /detect` 中 term_conflicts 插入部分。找到约第 383-396 行的 term_conflicts INSERT：

原代码：
```js
              if (!existing) {
                 db.prepare(`
                   INSERT INTO term_conflicts (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity)
                   VALUES (?, ?, ?, ?, ?, ?)
                 `).run(t1.term, t1.owner_dept_id || null, t1.definition || null, t2.owner_dept_id || null, t2.definition || null, 'warn');
                 inserted += 1;
              }
```

改为：
```js
              if (!existing) {
                 const tSeverity = (t1.term === t2.term && t1.definition !== t2.definition) ? 'error' : 'warn';
                 const tStatus = tSeverity === 'warn' ? 'silenced' : 'coordinating';
                 const tResType = tSeverity === 'warn' ? 'auto_silenced' : null;
                 const result = db.prepare(`
                   INSERT INTO term_conflicts (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity, status, resolution_type)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 `).run(t1.term, t1.owner_dept_id || null, t1.definition || null, t2.owner_dept_id || null, t2.definition || null, tSeverity, tStatus, tResType);
                 if (tSeverity === 'error') {
                   autoAssignBothDepts(result.lastInsertRowid, 'term', t1.owner_dept_id, t2.owner_dept_id);
                 }
                 inserted += 1;
              }
```

- [ ] **Step 3: 替换 field_conflicts 插入逻辑**

找到约第 420-436 行的 field_conflicts INSERT（在 `pairs.forEach(pair => { ... })` 内）：

原代码：
```js
        db.prepare(`
          INSERT INTO field_conflicts
            (field_entry_a_id, field_entry_b_id, conflict_field, submitter_a, value_a, submitter_b, value_b, dept_a, dept_b, severity)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          pair.a_id,
          pair.b_id,
          result.conflictField,
          pair.sa,
          result.valueA,
          pair.sb,
          result.valueB,
          pair.da,
          pair.db,
          result.severity
        );
```

改为：
```js
        const fcStatus = result.severity === 'warn' ? 'silenced' : 'coordinating';
        const fcResType = result.severity === 'warn' ? 'auto_silenced' : null;
        const insertResult = db.prepare(`
          INSERT INTO field_conflicts
            (field_entry_a_id, field_entry_b_id, conflict_field, submitter_a, value_a, submitter_b, value_b, dept_a, dept_b, severity, status, resolution_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          pair.a_id,
          pair.b_id,
          result.conflictField,
          pair.sa,
          result.valueA,
          pair.sb,
          result.valueB,
          pair.da,
          pair.db,
          result.severity,
          fcStatus,
          fcResType
        );
        if (result.severity === 'error') {
          autoAssignBothDepts(insertResult.lastInsertRowid, 'field', pair.da, pair.db);
        }
```

- [ ] **Step 4: 修改 GET / 列表过滤——默认排除 silenced**

找到 GET / 路由（约第 86 行）。在 `addFilters` 函数中，当 `status` 参数未指定时，默认排除 silenced 状态。

在 `addFilters` 之前，修改 query 逻辑。找到约第 86-121 行的 `router.get('/')`：

在三个分支（term only, field only, combined）中，当 `!status` 时，默认 filter 改为排除 `silenced`：

在 term only 分支（约第 90-98 行），将 `AND tc.status != 'archived'` 改为 `AND tc.status NOT IN ('archived','silenced')`。

在 field only 分支（约第 99-106 行），同样将 `AND fc.status != 'archived'` 改为 `AND fc.status NOT IN ('archived','silenced')`。

在 combined 分支（约第 108-121 行），同样将两处 `!= 'archived'` 改为 `NOT IN ('archived','silenced')`。

这三个替换是相同的模式——只把 `!= 'archived'` 改成 `NOT IN ('archived','silenced')`。

- [ ] **Step 5: 修改 GET /:id —— 增加双方立场对比数据**

找到 GET /:id 路由（约第 124 行）。在现有的 `coordinationHistory` 查询之后，`res.json(...)` 之前，增加双方立场查询：

```js
    // Get both sides' latest positions for side-by-side comparison
    const sideAPosition = db.prepare(`
      SELECT cch.*, u.name as assignee_name
      FROM conflict_coordination_history cch
      LEFT JOIN users u ON cch.assignee_user_id = u.id
      WHERE cch.conflict_id = ? AND cch.conflict_type = ?
        AND cch.assignee_user_id IN (SELECT assignee_user_id FROM conflict_assignments WHERE conflict_id = ? AND conflict_type = ?)
      ORDER BY cch.created_at DESC LIMIT 1
    `).all(req.params.id, conflictType, req.params.id, conflictType);

    // Separate positions by dept
    const sideA = sideAPosition.find(p => {
      const user = db.prepare('SELECT department_id FROM users WHERE id = ?').get(p.assignee_user_id);
      return user && user.department_id === conflict.dept_a;
    });
    const sideB = sideAPosition.find(p => {
      const user = db.prepare('SELECT department_id FROM users WHERE id = ?').get(p.assignee_user_id);
      return user && user.department_id === conflict.dept_b;
    });

    // Check both sides submitted
    const assignees = db.prepare(`
      SELECT DISTINCT assignee_user_id FROM conflict_assignments
      WHERE conflict_id = ? AND conflict_type = ?
    `).all(req.params.id, conflictType);
    const submissions = db.prepare(`
      SELECT DISTINCT assignee_user_id FROM conflict_coordination_history
      WHERE conflict_id = ? AND conflict_type = ?
    `).all(req.params.id, conflictType);
    const bothSubmitted = assignees.length >= 2 && submissions.length >= 2;
```

然后在 `res.json(...)` 中，把 `sideA`、`sideB`、`bothSubmitted`、`deadline` 加入返回对象：

```js
    res.json({
      ...conflict, conflict_type: conflictType,
      currentAssignee, coordinationHistory, assignmentHistory,
      sideA: sideA || null, sideB: sideB || null,
      bothSubmitted: Boolean(bothSubmitted),
      deadline: conflict.deadline || null,
      escalated: conflict.escalated || 0,
      resolution_type: conflict.resolution_type || null
    });
```

- [ ] **Step 6: Commit**

```bash
git add mdm-platform/server/routes/conflicts.js && git commit -m "feat: add severity-based routing, auto dual-assign, and position tracking to conflicts"
```

---

### Task 3: 协调增强 + 超时升级 + 新端点

**Files:**
- Modify: `mdm-platform/server/routes/conflicts.js`

- [ ] **Step 1: 超时升级辅助函数**

在 `handleDbError` 函数之后，`runDbAction` 之前添加：

```js
function checkAndEscalate(conflict, conflictType) {
  if (!conflict || conflict.status !== 'coordinating') return false;
  if (!conflict.deadline) return false;

  const today = new Date().toISOString().slice(0, 10);
  if (conflict.deadline >= today) return false;

  // Deadlock: escalate
  const table = conflictType === 'term' ? 'term_conflicts' : 'field_conflicts';
  db.prepare(`UPDATE ${table} SET status = 'escalated', escalated = 1 WHERE id = ?`).run(conflict.id);

  // Create escalation todo for all reviewers
  const reviewers = db.prepare("SELECT id, name, department_id FROM users WHERE role IN ('reviewer','admin')").all();
  reviewers.forEach(function(r) {
    db.prepare(`
      INSERT INTO todos (from_dept_id, to_dept_id, type, content, urgency)
      VALUES (NULL, ?, 'conflict_resolution', ?, 'high')
    `).run(r.department_id, '冲突升级：#' + conflict.id + ' 已超时，请 reviewer 终裁');
  });

  return true;
}
```

- [ ] **Step 2: GET / 列表查询时实时检查超时**

在 GET / 路由的三个分支中，每个分支在查询结果返回前调用 `checkAndEscalate`。在 `const termRows = db.prepare(...)` 和 `const fieldRows = db.prepare(...)` 之后，`res.json(...)` 之前（约第 118-121 行区域），添加：

```js
  // Real-time escalation check on query
  termRows.forEach(function(c) { checkAndEscalate(c, 'term'); });
  fieldRows.forEach(function(c) { checkAndEscalate(c, 'field'); });

  // Re-query after potential escalations
  const updatedTermRows = db.prepare(termSql).all(...termParams);
  const updatedFieldRows = db.prepare(fieldSql).all(...fieldParams);
  res.json([...updatedTermRows, ...updatedFieldRows].sort(...));
```

同理修改 term-only 和 field-only 分支——在 `res.json(...)` 之前加 escalation check + re-query。

- [ ] **Step 3: GET /:id 详情查询时实时检查超时**

在 GET /:id 路由中，获取 conflict 之后，`res.json(...)` 之前添加：

```js
    const wasEscalated = checkAndEscalate(conflict, conflictType);
    if (wasEscalated) {
      // Re-fetch after escalation
      const table2 = conflictType === 'term' ? 'term_conflicts' : 'field_conflicts';
      conflict = db.prepare(`SELECT * FROM ${table2} WHERE id = ?`).get(req.params.id);
    }
```

- [ ] **Step 4: 增强 POST /:id/coordination —— 双方提交检测**

在 `POST /:id/coordination` 路由中（约第 252 行），`db.prepare(...INSERT INTO conflict_coordination_history...)` 之后，`res.json({ success: true })` 之前添加：

```js
    // Check if both sides have submitted — auto-advance to reviewer decision queue
    const assigneeCount = db.prepare(`
      SELECT COUNT(DISTINCT assignee_user_id) as cnt FROM conflict_assignments
      WHERE conflict_id = ? AND conflict_type = ?
    `).get(req.params.id, conflictType);

    const submissionCount = db.prepare(`
      SELECT COUNT(DISTINCT assignee_user_id) as cnt FROM conflict_coordination_history
      WHERE conflict_id = ? AND conflict_type = ?
    `).get(req.params.id, conflictType);

    if (assigneeCount.cnt >= 2 && submissionCount.cnt >= 2) {
      // Both sides submitted — notify reviewers
      const reviewers = db.prepare("SELECT id, department_id FROM users WHERE role IN ('reviewer','admin')").all();
      reviewers.forEach(function(r) {
        db.prepare(`
          INSERT INTO todos (from_dept_id, to_dept_id, type, content, urgency)
          VALUES (NULL, ?, 'conflict_resolution', ?, 'high')
        `).run(r.department_id, '冲突 #' + req.params.id + ' 双方已提交立场，等待终裁');
      });
    }
```

- [ ] **Step 5: 新增 GET /stats 端点**

在 `POST /detect` 路由之前添加：

```js
// GET /stats — conflict statistics grouped by status and severity
router.get('/stats', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const fieldStats = db.prepare(`
      SELECT status, severity, COUNT(*) as cnt FROM field_conflicts GROUP BY status, severity
    `).all();
    const termStats = db.prepare(`
      SELECT status, severity, COUNT(*) as cnt FROM term_conflicts GROUP BY status, severity
    `).all();

    // Run escalation check before returning stats
    const needEscalation = db.prepare(`
      SELECT * FROM field_conflicts WHERE status = 'coordinating' AND deadline < date('now')
    `).all();
    needEscalation.forEach(function(c) { checkAndEscalate(c, 'field'); });
    const termNeedEscalation = db.prepare(`
      SELECT * FROM term_conflicts WHERE status = 'coordinating' AND deadline < date('now')
    `).all();
    termNeedEscalation.forEach(function(c) { checkAndEscalate(c, 'term'); });

    // Re-query after escalation
    const finalFieldStats = db.prepare(`
      SELECT status, severity, COUNT(*) as cnt FROM field_conflicts GROUP BY status, severity
    `).all();
    const finalTermStats = db.prepare(`
      SELECT status, severity, COUNT(*) as cnt FROM term_conflicts GROUP BY status, severity
    `).all();

    // Aggregate
    const byStatus = {};
    [finalFieldStats, finalTermStats].forEach(function(rows) {
      rows.forEach(function(r) {
        const key = r.status;
        if (!byStatus[key]) byStatus[key] = 0;
        byStatus[key] += r.cnt;
      });
    });

    const coordinating = byStatus['coordinating'] || 0;
    const escalated = byStatus['escalated'] || 0;
    const silenced = byStatus['silenced'] || 0;
    const resolved = byStatus['resolved'] || 0;

    // This month resolved
    const thisMonth = new Date().toISOString().slice(0, 7);
    const fieldResolvedThisMonth = db.prepare(`
      SELECT COUNT(*) as cnt FROM field_conflicts
      WHERE status = 'resolved' AND resolved_at LIKE ?
    `).get(thisMonth + '%');
    const termResolvedThisMonth = db.prepare(`
      SELECT COUNT(*) as cnt FROM term_conflicts
      WHERE status = 'resolved' AND resolved_at LIKE ?
    `).get(thisMonth + '%');
    const resolvedThisMonth = (fieldResolvedThisMonth.cnt || 0) + (termResolvedThisMonth.cnt || 0);

    res.json({
      coordinating: coordinating,
      escalated: escalated,
      silenced: silenced,
      resolved: resolved,
      resolvedThisMonth: resolvedThisMonth,
      byStatus: byStatus
    });
  });
});
```

- [ ] **Step 6: 新增 POST /:id/escalate 端点**

在 `POST /:id/final-decide` 路由之后添加：

```js
// POST /:id/escalate — manually escalate to reviewer
router.post('/:id/escalate', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    if (!['reviewer','admin'].includes(req.session.userRole)) {
      return res.status(403).json({ error: '仅 reviewer 或管理员可手动升级' });
    }
    const { type } = req.query;
    const conflictType = type || 'field';
    const table = conflictType === 'term' ? 'term_conflicts' : 'field_conflicts';
    const conflict = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });
    if (conflict.status !== 'coordinating') {
      return res.status(409).json({ error: '仅协调中的冲突可升级' });
    }

    db.prepare(`UPDATE ${table} SET status = 'escalated', escalated = 1 WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  });
});
```

- [ ] **Step 7: Commit**

```bash
git add mdm-platform/server/routes/conflicts.js && git commit -m "feat: add escalation check, both-sides detection, stats and manual escalate endpoints"
```

---

### Task 4: 前端——冲突列表拆分 + 详情增强 + 仪表盘卡片

**Files:**
- Modify: `mdm-platform/public/index.html`

- [ ] **Step 1: 冲突管理面板 HTML —— 新增子标签和筛选器**

定位到 `<!-- Conflicts -->` 区域（约第 392 行），将现有的 toolbar 和 `#conflictRows` 替换为：

```html
      <!-- Conflicts -->
      <section class="panel" id="conflicts">
        <div class="toolbar"><h2>冲突管理</h2>
          <div class="toolbar-right">
            <button class="btn secondary" id="refreshConflictsBtn">刷新</button>
          </div>
        </div>
        <div class="tabs" style="margin-bottom: 16px; border-bottom: 1px solid var(--border);">
          <button class="tab active" data-ctab="active">待协调</button>
          <button class="tab" data-ctab="silenced" id="silencedTabLink" style="display:none">静默归档</button>
        </div>
        <div id="conflictListContainer"></div>
      </section>
```

- [ ] **Step 2: 重写 loadConflicts 和 renderConflictsList**

替换现有的 `loadConflicts` 函数（约第 969 行）和 `renderConflictsList` 函数（约第 979 行）：

```js
    var conflictTab = 'active'; // 'active' | 'silenced'

    async function loadConflicts() {
      // Load stats to update tab labels
      try {
        state.conflictStats = await api('/api/conflicts/stats');
      } catch (e) {
        state.conflictStats = { coordinating: 0, escalated: 0, silenced: 0, resolved: 0, resolvedThisMonth: 0 };
      }

      // Show/hide silenced tab for admins
      var slink = $('silencedTabLink');
      if (slink) slink.style.display = (state.user && state.user.role === 'admin') ? '' : 'none';

      if (conflictTab === 'silenced') {
        var query = new URLSearchParams();
        query.set('status', 'silenced');
        state.conflicts = await api('/api/conflicts?' + query.toString());
      } else {
        state.conflicts = await api('/api/conflicts');
      }
      renderConflictsList();
    }

    function renderConflictsList() {
      var container = $('conflictListContainer');
      if (!container) return;

      if (state.conflicts.length === 0) {
        container.innerHTML = '<div class="empty">' + (conflictTab === 'silenced' ? '暂无静默冲突' : '暂无待协调冲突') + '</div>';
        return;
      }

      var html = '<div class="table-container"><table>' +
        '<thead><tr><th>ID</th><th>类型</th><th>冲突内容</th><th>部门A</th><th>部门B</th><th>严重度</th><th>状态</th><th>截止日期</th><th>操作</th></tr></thead>' +
        '<tbody>' + state.conflicts.map(function(row) {
          var conflictType = row.conflict_type || 'field';
          var rowId = Number(row.id);
          var statusLabel = { pending: '待处理', silenced: '已静默', coordinating: '协调中', escalated: '已升级', resolved: '已解决', rejected: '已驳回', archived: '已归档' };
          return '<tr>' +
            '<td>' + rowId + '</td>' +
            '<td>' + (conflictType === 'term' ? '术语' : '字段') + '</td>' +
            '<td>' + safeText(row.term || row.conflict_field) + '</td>' +
            '<td>' + safeText(row.dept_a_name || row.dept_a) + '</td>' +
            '<td>' + safeText(row.dept_b_name || row.dept_b) + '</td>' +
            '<td>' + statusTag(row.severity) + '</td>' +
            '<td>' + (statusLabel[row.status] || row.status) + '</td>' +
            '<td>' + (row.deadline ? safeText(row.deadline) : '-') + '</td>' +
            '<td><button class="btn secondary" onclick="navigateTo(\'detail\',{tab:\'conflicts\',type:\'' + conflictType + '\',id:' + rowId + '})">查看</button></td>' +
            '</tr>';
        }).join('') + '</tbody>' +
        '</table></div>';

      container.innerHTML = html;
    }
```

- [ ] **Step 3: 绑定冲突子标签切换事件**

在 `$('tabs').addEventListener('click', ...)` 之后添加：

```js
    // Conflict sub-tab switching
    var conflictTabLinks = document.querySelectorAll('#conflicts [data-ctab]');
    conflictTabLinks.forEach(function(link) {
      link.addEventListener('click', function() {
        conflictTabLinks.forEach(function(l) { l.classList.remove('active'); });
        link.classList.add('active');
        conflictTab = link.dataset.ctab;
        loadConflicts();
      });
    });
```

- [ ] **Step 4: 重写 renderConflictDetail —— 双立场对比 + 时间线**

替换现有的 `renderConflictDetail` 函数（约第 1594-1700 行）：

```js
    async function renderConflictDetail(conflictId, conflictType, sourceTab) {
      try {
        const detail = await api('/api/conflicts/' + conflictId + '?type=' + conflictType);
        state.activeConflict = detail;
        setBreadcrumb([
          { label: '冲突管理', onclick: 'navigateTo(\'list\',{tab:\'conflicts\'})' },
          { label: '冲突 #' + conflictId },
        ]);

        const container = $('detailContent');
        const isReviewer = ['reviewer', 'admin'].includes(state.user?.role);

        // Check if current user is an assignee
        const myAssignment = (detail.assignmentHistory || []).find(function(a) {
          return a.assignee_user_id === state.user?.id;
        });
        const isAssignee = Boolean(myAssignment);

        // Check if I already submitted
        const mySubmission = (detail.coordinationHistory || []).find(function(h) {
          return h.assignee_user_id === state.user?.id;
        });
        const iSubmitted = Boolean(mySubmission);

        // Side-by-side comparison
        const sideHtml = conflictType === 'term' ? buildTermComparison(detail) : buildFieldComparison(detail);

        // Timeline
        const timeline = buildConflictTimeline(detail, conflictType);

        // Action buttons
        let actionHtml = '';
        if (isAssignee && !iSubmitted && detail.status === 'coordinating') {
          actionHtml += '<button class="btn primary" id="submitPositionBtn">提交立场</button>';
        }
        if (isReviewer && detail.bothSubmitted && detail.status === 'coordinating') {
          actionHtml += '<button class="btn success" id="finalDecideBtn">终裁</button>';
        }
        if (isReviewer && detail.status === 'coordinating') {
          actionHtml += '<button class="btn secondary" id="escalateNowBtn">提前升级</button>';
        }
        if (isReviewer && detail.status === 'resolved') {
          actionHtml += '<button class="btn danger" id="reopenBtn">重开</button>';
        }
        if (state.user?.role === 'admin' && detail.status === 'resolved') {
          actionHtml += '<button class="btn secondary" id="archiveBtn">归档</button>';
        }

        var statusLabels = { pending: '待处理', silenced: '已静默', coordinating: '协调中', escalated: '已升级', resolved: '已解决', rejected: '已驳回', archived: '已归档' };

        container.innerHTML = '<div style="margin-bottom: 24px;">' +
          '<h2 style="margin-bottom: 8px;">' + (conflictType === 'term' ? '术语冲突' : '字段冲突') + ' #' + conflictId + '</h2>' +
          '<div class="detail-meta">' +
            '<span>严重度：' + statusTag(detail.severity) + '</span>' +
            '<span>状态：' + (statusLabels[detail.status] || detail.status) + '</span>' +
            (detail.deadline ? '<span>截止日期：' + safeText(detail.deadline) + '</span>' : '') +
            (detail.escalated ? '<span style="color: var(--error);">已升级</span>' : '') +
          '</div>' +
        '</div>' +

        '<h2>双部门立场对比</h2>' +
        sideHtml +

        '<h2 style="margin-top: 32px;">事件时间线</h2>' +
        timeline +

        (actionHtml ? '<div class="toolbar" style="margin-top: 32px; justify-content: flex-end;">' + actionHtml + '</div>' : '') +
        '';

        $('detailPage').classList.add('on');
        document.querySelectorAll('.panel').forEach(function(el) { el.classList.remove('on'); });

        // Bind actions
        var submitBtn = $('submitPositionBtn');
        if (submitBtn) submitBtn.onclick = function() { openSubmitCoordinationDialog(conflictId, conflictType); };
        var finalBtn = $('finalDecideBtn');
        if (finalBtn) finalBtn.onclick = function() { openFinalDecideDialog(conflictId, conflictType); };
        var escBtn = $('escalateNowBtn');
        if (escBtn) escBtn.onclick = function() { handleManualEscalate(conflictId, conflictType); };
        var reopenBtn = $('reopenBtn');
        if (reopenBtn) reopenBtn.onclick = function() { handleReopen(conflictId, conflictType); };
        var archiveBtn = $('archiveBtn');
        if (archiveBtn) archiveBtn.onclick = function() { handleArchive(conflictId, conflictType); };
      } catch (e) {
        if (e.status === 404) {
          $('detailContent').innerHTML = '<div class="empty">记录不存在或无权访问 <button class="btn secondary" onclick="history.back()">返回上一页</button></div>';
        } else {
          showToast(e.message || '加载失败', 'error');
        }
      }
    }
```

- [ ] **Step 5: 新增辅助函数——对比视图和时间线构建**

在 `renderConflictDetail` 之后添加三个辅助函数：

```js
    function buildFieldComparison(detail) {
      var sideA = detail.sideA;
      var sideB = detail.sideB;
      return '<div class="diff-grid">' +
        '<div class="diff-col"><div class="diff-header">' + safeText(detail.dept_a_name || detail.dept_a) + ' 立场</div>' +
          '<div class="diff-row"><strong>提交值：</strong>' + safeText(detail.value_a) + '</div>' +
          (sideA ? '<div class="diff-row"><strong>协调结果：</strong>' + (sideA.result === 'A' ? '坚持本部门口径' : sideA.result === 'B' ? '接受对方口径' : '折中方案') + '</div><div class="diff-row"><strong>论据：</strong>' + safeText(sideA.note, '无') + '</div>' : '<div class="diff-row" style="color: var(--text-muted);">待提交（截止：' + safeText(detail.deadline || '-') + '）</div>') +
        '</div>' +
        '<div class="diff-col"><div class="diff-header">' + safeText(detail.dept_b_name || detail.dept_b) + ' 立场</div>' +
          '<div class="diff-row"><strong>提交值：</strong>' + safeText(detail.value_b) + '</div>' +
          (sideB ? '<div class="diff-row"><strong>协调结果：</strong>' + (sideB.result === 'A' ? '接受对方口径' : sideB.result === 'B' ? '坚持本部门口径' : '折中方案') + '</div><div class="diff-row"><strong>论据：</strong>' + safeText(sideB.note, '无') + '</div>' : '<div class="diff-row" style="color: var(--text-muted);">待提交（截止：' + safeText(detail.deadline || '-') + '）</div>') +
        '</div></div>';
    }

    function buildTermComparison(detail) {
      var sideA = detail.sideA;
      var sideB = detail.sideB;
      return '<div class="diff-grid">' +
        '<div class="diff-col"><div class="diff-header">' + safeText(detail.dept_a_name || detail.dept_a) + ' 立场</div>' +
          '<div class="diff-row"><strong>定义：</strong>' + safeText(detail.dept_a_meaning) + '</div>' +
          (sideA ? '<div class="diff-row"><strong>协调结果：</strong>' + (sideA.result === 'A' ? '坚持本部门定义' : sideA.result === 'B' ? '接受对方定义' : '折中方案') + '</div><div class="diff-row"><strong>论据：</strong>' + safeText(sideA.note, '无') + '</div>' : '<div class="diff-row" style="color: var(--text-muted);">待提交（截止：' + safeText(detail.deadline || '-') + '）</div>') +
        '</div>' +
        '<div class="diff-col"><div class="diff-header">' + safeText(detail.dept_b_name || detail.dept_b) + ' 立场</div>' +
          '<div class="diff-row"><strong>定义：</strong>' + safeText(detail.dept_b_meaning) + '</div>' +
          (sideB ? '<div class="diff-row"><strong>协调结果：</strong>' + (sideB.result === 'A' ? '接受对方定义' : sideB.result === 'B' ? '坚持本部门定义' : '折中方案') + '</div><div class="diff-row"><strong>论据：</strong>' + safeText(sideB.note, '无') + '</div>' : '<div class="diff-row" style="color: var(--text-muted);">待提交（截止：' + safeText(detail.deadline || '-') + '）</div>') +
        '</div></div>';
    }

    function buildConflictTimeline(detail, conflictType) {
      var events = [];

      // Conflict detected
      events.push({ time: detail.created_at, text: '检测到冲突（' + (detail.severity === 'error' ? '严重' : '警告') + '级别）', icon: '⚡' });

      // Assignments
      (detail.assignmentHistory || []).forEach(function(a) {
        var label = a.assigned_by === 0 ? '系统自动指派 ' + safeText(a.assignee_name) + ' 为协调人' : safeText(a.assigned_by_name) + ' 指定 ' + safeText(a.assignee_name) + ' 为责任人';
        events.push({ time: a.created_at, text: label, icon: '👤' });
      });

      // Coordination submissions
      (detail.coordinationHistory || []).forEach(function(h) {
        var resultText = h.result === 'A' ? '支持A部门' : h.result === 'B' ? '支持B部门' : '折中方案';
        events.push({ time: h.created_at, text: safeText(h.assignee_name) + ' 提交立场：' + resultText + (h.note ? ' — ' + h.note : ''), icon: '💬' });
      });

      // Escalation
      if (detail.escalated) {
        events.push({ time: detail.deadline, text: '协调超期，自动升级至 reviewer', icon: '🚨' });
      }

      // Resolution
      if (detail.status === 'resolved' && detail.resolved_at) {
        events.push({ time: detail.resolved_at, text: '已解决：' + safeText(detail.resolution || '无说明'), icon: '✅' });
      }

      // Sort by time
      events.sort(function(a, b) { return String(a.time || '').localeCompare(String(b.time || '')); });

      if (events.length === 0) return '<div class="empty">暂无事件</div>';

      return '<div class="timeline">' + events.map(function(e) {
        return '<div class="tl-item"><div class="tl-head">' + e.icon + ' ' + e.text + '</div><div class="tl-body">' + safeText(e.time) + '</div></div>';
      }).join('') + '</div>';
    }
```

- [ ] **Step 6: 新增手动升级处理函数**

在 `handleArchive` 函数（约第 1960 行）之后添加：

```js
    async function handleManualEscalate(conflictId, conflictType) {
      var confirmed = await showConfirm({
        title: '确认升级',
        message: '将冲突提前升级至 reviewer 终裁，无需等待截止日期。确认？',
        confirmLabel: '升级',
        confirmClass: 'danger',
      });
      if (!confirmed) return;
      try {
        await api('/api/conflicts/' + conflictId + '/escalate?type=' + conflictType, { method: 'POST' });
        showToast('已升级');
        renderConflictDetail(conflictId, conflictType, 'conflicts');
      } catch (e) {
        showToast(e.message || '升级失败', 'error');
      }
    }
```

- [ ] **Step 7: 更新仪表盘——冲突概览卡片**

在 `renderDashboard` 函数中（约第 1033 行），`$('metricConflicts').textContent = pendingConflicts;` 之后添加冲突概览卡片：

```js
      // Conflict overview card
      var conflictCard = $('conflictOverview');
      if (conflictCard && state.conflictStats) {
        var stats = state.conflictStats;
        conflictCard.innerHTML =
          '<h3 style="margin-bottom: 12px; font-size: 14px; font-weight: 600;">冲突概览</h3>' +
          '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px;">' +
            '<div>待协调：<strong>' + (stats.coordinating || 0) + '</strong> 条（已升级：<strong style="color: var(--error);">' + (stats.escalated || 0) + '</strong>）</div>' +
            '<div>静默：<strong>' + (stats.silenced || 0) + '</strong> 条</div>' +
            '<div>本月已解决：<strong style="color: var(--success);">' + (stats.resolvedThisMonth || 0) + '</strong> 条</div>' +
          '</div>';
      }
```

同时在仪表盘 HTML 区域（约第 293-298 行附近），`metricConflicts` 卡片之后添加容器：

找到约第 295-298 行：
```html
          <div class="metric"><div class="num" id="metricTodos">0</div><div class="lbl">待处理待办</div></div>
          <div class="metric"><div class="num" id="metricConflicts">0</div><div class="lbl">未解决冲突</div></div>
        </div>
        <div id="dashboardActions" style="margin-top: 20px;">
```

在 `</div>` 之后，`<div id="dashboardActions"` 之前添加：
```html
        <div id="conflictOverview" style="margin-top: 20px; padding: 16px; background: var(--surface); border-radius: 8px; border: 1px solid var(--border);"></div>
```

并在 `renderDashboard` 开头调用 `loadConflicts()` 之前先加载 stats——修改 `renderDashboard` 开头：

在 `function renderDashboard() {` 之后紧接着添加：
```js
      // Preload conflict stats for overview card
      api('/api/conflicts/stats').then(function(s) { state.conflictStats = s; }).catch(function() {});
```

- [ ] **Step 8: Commit**

```bash
git add mdm-platform/public/index.html && git commit -m "feat: split conflict list, add side-by-side positions, timeline, and dashboard overview"
```

---

### Task 5: 超时升级检查脚本

**Files:**
- Create: `mdm-platform/scripts/check-escalations.js`

- [ ] **Step 1: 创建检查脚本**

```js
// check-escalations.js — standalone script to check and escalate overdue conflicts
// Run: node scripts/check-escalations.js

const db = require('../server/db');

const today = new Date().toISOString().slice(0, 10);

function escalate(table, conflict) {
  db.prepare(`UPDATE ${table} SET status = 'escalated', escalated = 1 WHERE id = ?`).run(conflict.id);

  const reviewers = db.prepare("SELECT id, department_id FROM users WHERE role IN ('reviewer','admin')").all();
  reviewers.forEach(function(r) {
    db.prepare(`
      INSERT INTO todos (from_dept_id, to_dept_id, type, content, urgency)
      VALUES (NULL, ?, 'conflict_resolution', ?, 'high')
    `).run(r.department_id, '冲突升级：#' + conflict.id + ' 已超时，请 reviewer 终裁');
  });
  console.log('Escalated conflict #' + conflict.id + ' (' + table + ')');
}

const fieldOverdue = db.prepare(`
  SELECT * FROM field_conflicts WHERE status = 'coordinating' AND deadline < ?
`).all(today);

const termOverdue = db.prepare(`
  SELECT * FROM term_conflicts WHERE status = 'coordinating' AND deadline < ?
`).all(today);

fieldOverdue.forEach(function(c) { escalate('field_conflicts', c); });
termOverdue.forEach(function(c) { escalate('term_conflicts', c); });

const total = fieldOverdue.length + termOverdue.length;
if (total === 0) {
  console.log('No overdue conflicts. Checked ' + today);
} else {
  console.log('Escalated ' + total + ' overdue conflict(s).');
}
```

- [ ] **Step 2: 运行验证**

```bash
cd mdm-platform && node scripts/check-escalations.js
```

期望：无 overdue 冲突时输出 "No overdue conflicts."，有超时冲突则输出升级信息。

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/scripts/check-escalations.js && git commit -m "feat: add escalation check script for cron/manual use"
```

---

### Task 6: 更新冲突路由测试

**Files:**
- Modify: `mdm-platform/scripts/test-conflict-routes.js`

- [ ] **Step 1: 在 seedData 中添加部门 owner 和 reviewer**

在 `seedData` 函数中（约第 38 行），已有的 admin/userA/userB 之后，额外创建：

```js
  // Department owners for auto-assignment
  const ownerA = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '销售数据Owner', 'SALEOW01', deptA, '数据Owner', 'owner', hashPassword('pass1234')
  ).lastInsertRowid;
  const ownerB = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '财务数据Owner', 'FINOW01', deptB, '数据Owner', 'owner', hashPassword('pass1234')
  ).lastInsertRowid;

  // Set data_owner for departments
  db.prepare('UPDATE departments SET data_owner_user_id = ? WHERE id = ?').run(ownerA, deptA);
  db.prepare('UPDATE departments SET data_owner_user_id = ? WHERE id = ?').run(ownerB, deptB);

  // Reviewer user
  const reviewer = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '审核人', 'REV001', deptA, '质量审核', 'reviewer', hashPassword('pass1234')
  ).lastInsertRowid;
```

并更新返回对象，加入 `ownerA`, `ownerB`, `reviewer`。

- [ ] **Step 2: 更新测试——验证 warn 冲突被静默**

在原有 "客户名称相同值不产生冲突" 测试之后（约第 199-202 行），添加新断言：

```js
    // Verify warn-level conflicts (note difference on same field) are silenced
    // First, create two field entries with same name but different notes (warn level)
    const warnFieldA = db.prepare(`
      INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by)
      VALUES (?, '客户等级', 'customer_level', '客户', '文本', ?, '实时', '销售备注A', ?)
    `).run(seed.mappingA, JSON.stringify(['CRM']), seed.userA).lastInsertRowid;
    const warnFieldB = db.prepare(`
      INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by)
      VALUES (?, '客户等级', 'customer_level', '客户', '文本', ?, '实时', '销售备注B', ?)
    `).run(seed.mappingB, JSON.stringify(['CRM']), seed.userB).lastInsertRowid;

    const detectWarn = await request('/api/conflicts/detect?field_name_cn=%E5%AE%A2%E6%88%B7%E7%AD%89%E7%BA%A7', { method: 'POST' }, cookie);
    assert.strictEqual(detectWarn.res.status, 200);

    // warn should be silenced, not in default list
    const allConflicts2 = await request('/api/conflicts', {}, cookie);
    const warnConflicts = allConflicts2.body.filter(function(c) { return c.conflict_field === 'note'; });
    assert.strictEqual(warnConflicts.length, 0, 'warn conflicts should not appear in default list');

    // But visible when explicitly filtered
    const silencedConflicts = await request('/api/conflicts?status=silenced', {}, cookie);
    const silencedWarn = silencedConflicts.body.filter(function(c) { return c.conflict_field === 'note'; });
    assert.ok(silencedWarn.length > 0, 'warn conflicts should appear with status=silenced filter');
```

- [ ] **Step 3: 更新测试——验证 error 冲突自动双指派**

在 "客户编码" detect 测试（约第 204 行）之后，增加自动指派验证：

```js
    // Verify auto dual-assign
    const errorConflict = fieldConflicts.body[0];
    assert.strictEqual(errorConflict.status, 'coordinating', 'error conflict should be coordinating');
    assert.ok(errorConflict.deadline, 'should have a deadline set');

    const assignments = db.prepare('SELECT * FROM conflict_assignments WHERE conflict_id = ? AND conflict_type = ?').all(errorConflict.id, 'field');
    assert.strictEqual(assignments.length, 2, 'should have 2 auto-assignments (one per dept)');
    assert.ok(assignments.some(function(a) { return a.assigned_by === 0; }), 'should be system-assigned');

    const assignedTodos = db.prepare("SELECT * FROM todos WHERE type = 'conflict_resolution' AND content LIKE '%冲突协调%'").all();
    assert.strictEqual(assignedTodos.length, 2, 'should create 2 todos');
```

- [ ] **Step 4: 更新测试——验证 stats 端点**

在测试末尾（约第 244 行 `deleteTodo` 之前）增加：

```js
    // Test stats endpoint
    const stats = await request('/api/conflicts/stats', {}, cookie);
    assert.strictEqual(stats.res.status, 200);
    assert.ok(typeof stats.body.coordinating === 'number');
    assert.ok(typeof stats.body.silenced === 'number');
    assert.ok(typeof stats.body.escalated === 'number');
    assert.ok(typeof stats.body.resolvedThisMonth === 'number');
```

- [ ] **Step 5: 更新测试——验证手动 escalate 端点**

在上一步之后继续添加：

```js
    // Test manual escalate
    const escRes = await request('/api/conflicts/' + errorConflict.id + '/escalate?type=field', { method: 'POST' }, cookie);
    const escConflict = db.prepare('SELECT * FROM field_conflicts WHERE id = ?').get(errorConflict.id);
    assert.strictEqual(escConflict.status, 'escalated');
    assert.strictEqual(escConflict.escalated, 1);
```

- [ ] **Step 6: 运行测试**

```bash
cd mdm-platform && node scripts/test-conflict-routes.js
```

期望：所有断言通过，输出 "Conflict and todo route integration test passed"。

- [ ] **Step 7: Commit**

```bash
git add mdm-platform/scripts/test-conflict-routes.js && git commit -m "test: update conflict route tests for auto-assign, silencing, and escalation"
```

---

### Task 7: 冒烟验证

- [ ] **Step 1: 运行完整冒烟测试**

```bash
cd mdm-platform && node scripts/smoke-test.js
```

- [ ] **Step 2: 启动服务手动检查前端**

```bash
cd mdm-platform && npm run dev
```

打开浏览器访问 `http://localhost:3000`，登录 admin/ADMIN001：
- 切换到"冲突管理"标签，确认出现"待协调"/"静默归档"两个子标签
- 切换仪表盘，确认出现"冲突概览"卡片
- 进入一个冲突详情，确认出现双方立场对比和时间线

- [ ] **Step 3: Commit（如有修正）**

如有冒烟测试暴露的问题，修复后提交。
