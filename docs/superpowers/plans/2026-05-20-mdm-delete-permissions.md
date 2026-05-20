# MDM Platform Delete Permissions Complete Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DELETE endpoints to all resource types with cascade, fix two security issues, and expose delete buttons in frontend panels.

**Architecture:** Each V2 route file gets a new `router.delete('/:code', requireAuth, requirePermission('admin:access'), ...)` handler at the end (before `module.exports`). Each handler follows the same pattern: lookup → cascade-delete children → delete self → return `{ success, cascaded }`. Frontend delete buttons follow existing role-delete pattern with confirm() + fetch + list-refresh.

**Tech Stack:** Express.js + better-sqlite3 + vanilla JS frontend (single-file index.html)

---

### Task 1: Fix classNode.js — tighten membership delete + add class_node DELETE

**File:** `mdm-platform/server/routes/classNode.js`

- [ ] **Step 1: Add requirePermission import**

Line 4 change:
```js
const { requireAuth, applyFieldConstraints } = require('../auth');
```
to:
```js
const { requireAuth, requirePermission, applyFieldConstraints } = require('../auth');
```

- [ ] **Step 2: Fix membership delete auth (line 101)**

Replace:
```js
router.delete('/memberships/:id', requireAuth, (req, res) => {
```
with:
```js
router.delete('/memberships/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
```

- [ ] **Step 3: Add class_node DELETE endpoint (before module.exports, after memberships delete)**

Insert after line 107:
```js

router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const node = db.prepare('SELECT * FROM class_node WHERE class_code=?').get(req.params.code);
    if (!node) return res.status(404).json({ error: '分类不存在' });

    const cascaded = {};

    // Collect all descendant node IDs (recursive)
    const descIds = [];
    function collectDescendants(parentId) {
      const children = db.prepare('SELECT class_node_id FROM class_node WHERE parent_class_node_id=?').all(parentId);
      for (const c of children) {
        descIds.push(c.class_node_id);
        collectDescendants(c.class_node_id);
      }
    }
    collectDescendants(node.class_node_id);

    // Delete memberships for all descendant nodes
    for (const cid of descIds) {
      db.prepare('DELETE FROM entity_class_membership WHERE class_node_id=?').run(cid);
    }
    // Delete descendant nodes
    for (const cid of descIds) {
      db.prepare('DELETE FROM class_node WHERE class_node_id=?').run(cid);
    }
    cascaded.children = descIds.length;

    // Delete memberships for this node
    const { changes: mems } = db.prepare('DELETE FROM entity_class_membership WHERE class_node_id=?').run(node.class_node_id);
    cascaded.memberships = mems;

    // Delete self
    db.prepare('DELETE FROM class_node WHERE class_node_id=?').run(node.class_node_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 4: Commit**

```bash
git add mdm-platform/server/routes/classNode.js
git commit -m "fix: tighten classNode membership delete to admin-only, add class_node DELETE with recursive cascade"
```

---

### Task 2: Fix mappings.js — old role check → RBAC

**File:** `mdm-platform/server/routes/mappings.js`

- [ ] **Step 1: Add getUserEffectivePermissions import**

Line 4 change:
```js
const { requireAuth } = require('../auth');
```
to:
```js
const { requireAuth, getUserEffectivePermissions } = require('../auth');
```

- [ ] **Step 2: Replace old role check (line 205)**

Replace:
```js
    if (mapping.submitted_by !== req.session.userId && req.session.userRole !== 'admin') {
      return res.status(403).json({ error: '仅创建人或管理员可删除草稿' });
    }
```
with:
```js
    const { permSet } = getUserEffectivePermissions(req.session.userId);
    const isAdmin = permSet.has('admin:access') || permSet.has('*:*');
    if (mapping.submitted_by !== req.session.userId && !isAdmin) {
      return res.status(403).json({ error: '仅创建人或管理员可删除草稿' });
    }
```

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/server/routes/mappings.js
git commit -m "fix: use RBAC permission check instead of session.userRole in mappings delete"
```

---

### Task 3: Add DELETE to orgUnit.js with cascade

**File:** `mdm-platform/server/routes/orgUnit.js`

- [ ] **Step 1: Insert DELETE endpoint before module.exports (after line 89, before line 91)**

Insert at line 90:
```js

router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const unit = db.prepare('SELECT * FROM org_unit WHERE org_unit_code=?').get(req.params.code);
    if (!unit) return res.status(404).json({ error: '组织不存在' });

    const cascaded = {};

    // Cascade: delete positions → assignments
    const positions = db.prepare('SELECT position_id FROM position WHERE org_unit_id=?').all(unit.org_unit_id);
    let totalAssignments = 0;
    for (const p of positions) {
      const { changes: a } = db.prepare('DELETE FROM person_position_assignment WHERE position_id=?').run(p.position_id);
      totalAssignments += a;
    }
    cascaded.assignments = totalAssignments;
    const { changes: posCount } = db.prepare('DELETE FROM position WHERE org_unit_id=?').run(unit.org_unit_id);
    cascaded.positions = posCount;

    // Handle child org_units — reassign to parent
    db.prepare('UPDATE org_unit SET parent_org_unit_id=? WHERE parent_org_unit_id=?')
      .run(unit.parent_org_unit_id || null, unit.org_unit_id);

    // Delete self
    db.prepare('DELETE FROM org_unit WHERE org_unit_id=?').run(unit.org_unit_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/orgUnit.js
git commit -m "feat: add DELETE /api/org-units/:code with position+assignment cascade"
```

---

### Task 4: Add DELETE to position.js with cascade

**File:** `mdm-platform/server/routes/position.js`

- [ ] **Step 1: Insert DELETE endpoint before module.exports (after line 80)**

Insert at line 81:
```js

router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const pos = db.prepare('SELECT * FROM position WHERE position_code=?').get(req.params.code);
    if (!pos) return res.status(404).json({ error: '岗位不存在' });

    const cascaded = {};
    const { changes: a } = db.prepare('DELETE FROM person_position_assignment WHERE position_id=?').run(pos.position_id);
    cascaded.assignments = a;
    db.prepare('DELETE FROM position WHERE position_id=?').run(pos.position_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/position.js
git commit -m "feat: add DELETE /api/positions/:code with assignment cascade"
```

---

### Task 5: Add DELETE to person.js with cascade

**File:** `mdm-platform/server/routes/person.js`

- [ ] **Step 1: Insert DELETE endpoint before module.exports (after line 136)**

Insert at line 137:
```js

router.delete('/:employeeNo', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const person = db.prepare('SELECT * FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!person) return res.status(404).json({ error: '人员不存在' });

    const cascaded = {};
    const { changes: a } = db.prepare('DELETE FROM person_position_assignment WHERE person_id=?').run(person.person_id);
    cascaded.assignments = a;
    db.prepare('DELETE FROM person WHERE person_id=?').run(person.person_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/person.js
git commit -m "feat: add DELETE /api/persons/:employeeNo with assignment cascade"
```

---

### Task 6: Add DELETE to productFamily.js with full product cascade

**File:** `mdm-platform/server/routes/productFamily.js`

- [ ] **Step 1: Insert DELETE endpoint before module.exports (after line 74)**

Insert at line 75:
```js

router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const pf = db.prepare('SELECT * FROM product_family WHERE product_family_code=?').get(req.params.code);
    if (!pf) return res.status(404).json({ error: '产品族不存在' });

    const cascaded = {};

    // Cascade: delete products → attribute_values + entity_class_memberships
    const products = db.prepare('SELECT product_id FROM product WHERE product_family_id=?').all(pf.product_family_id);
    let totalAttr = 0, totalMems = 0;
    for (const p of products) {
      const { changes: av } = db.prepare("DELETE FROM attribute_value WHERE entity_type='product' AND entity_id=?").run(p.product_id);
      totalAttr += av;
      const { changes: em } = db.prepare("DELETE FROM entity_class_membership WHERE entity_type='product' AND entity_id=?").run(p.product_id);
      totalMems += em;
    }
    cascaded.attribute_values = totalAttr;
    cascaded.memberships = totalMems;
    const { changes: prodCount } = db.prepare('DELETE FROM product WHERE product_family_id=?').run(pf.product_family_id);
    cascaded.products = prodCount;

    // Delete self
    db.prepare('DELETE FROM product_family WHERE product_family_id=?').run(pf.product_family_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/productFamily.js
git commit -m "feat: add DELETE /api/product-families/:code with product+attribute+membership cascade"
```

---

### Task 7: Add DELETE to product.js with cascade

**File:** `mdm-platform/server/routes/product.js`

- [ ] **Step 1: Insert DELETE endpoint before module.exports (after line 107)**

Insert at line 108:
```js

router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const prod = db.prepare('SELECT * FROM product WHERE product_code=?').get(req.params.code);
    if (!prod) return res.status(404).json({ error: '产品不存在' });

    const cascaded = {};
    const { changes: av } = db.prepare("DELETE FROM attribute_value WHERE entity_type='product' AND entity_id=?").run(prod.product_id);
    cascaded.attribute_values = av;
    const { changes: em } = db.prepare("DELETE FROM entity_class_membership WHERE entity_type='product' AND entity_id=?").run(prod.product_id);
    cascaded.memberships = em;

    // Clear superseded_by reference from other products
    db.prepare('UPDATE product SET superseded_by_product_id=NULL WHERE superseded_by_product_id=?').run(prod.product_id);

    db.prepare('DELETE FROM product WHERE product_id=?').run(prod.product_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/product.js
git commit -m "feat: add DELETE /api/products/:code with attribute+membership cascade"
```

---

### Task 8: Add DELETE to attribute.js for defs with cascade

**File:** `mdm-platform/server/routes/attribute.js`

- [ ] **Step 1: Add requirePermission import**

Line 4 change:
```js
const { requireAuth, applyFieldConstraints } = require('../auth');
```
to:
```js
const { requireAuth, requirePermission, applyFieldConstraints } = require('../auth');
```

- [ ] **Step 2: Insert DELETE endpoint before module.exports (after line 102)**

Insert at line 103:
```js

router.delete('/defs/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const def = db.prepare('SELECT * FROM attribute_def WHERE attribute_code=?').get(req.params.code);
    if (!def) return res.status(404).json({ error: '属性定义不存在' });

    const cascaded = {};
    const { changes: av } = db.prepare('DELETE FROM attribute_value WHERE attribute_def_id=?').run(def.attribute_def_id);
    cascaded.attribute_values = av;

    db.prepare('DELETE FROM attribute_def WHERE attribute_def_id=?').run(def.attribute_def_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/server/routes/attribute.js
git commit -m "feat: add DELETE /api/attributes/defs/:code with attribute_value cascade"
```

---

### Task 9: Add DELETE to external.js — systems cascade + identities

**File:** `mdm-platform/server/routes/external.js`

- [ ] **Step 1: Insert DELETE for systems (before identities GET, after line 37)**

Insert at line 38:
```js

router.delete('/systems/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const sys = db.prepare('SELECT * FROM external_system WHERE system_code=?').get(req.params.code);
    if (!sys) return res.status(404).json({ error: '外部系统不存在' });

    const cascaded = {};
    const { changes: ids } = db.prepare('DELETE FROM external_identity WHERE system_code=?').run(sys.system_code);
    cascaded.identities = ids;

    db.prepare('DELETE FROM external_system WHERE system_id=?').run(sys.system_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Insert DELETE for identities (before module.exports, after POST identities)**

Insert after line 66:
```js

router.delete('/identities/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const r = db.prepare('DELETE FROM external_identity WHERE external_identity_id=?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: '标识映射不存在' });
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/server/routes/external.js
git commit -m "feat: add DELETE /api/external/systems/:code and /api/external/identities/:id"
```

---

### Task 10: Add DELETE to capabilities.js with recursive cascade

**File:** `mdm-platform/server/routes/capabilities.js`

- [ ] **Step 1: Insert DELETE endpoint before module.exports (after review route, line 73)**

Insert at line 74:
```js

router.delete('/:id', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const cap = db.prepare('SELECT * FROM capabilities WHERE id=?').get(req.params.id);
    if (!cap) return res.status(404).json({ error: '能力不存在' });

    const cascaded = {};

    // Collect all descendant IDs recursively (L1→L2→L3)
    const descIds = [];
    function collectDescendants(parentId) {
      const children = db.prepare('SELECT id FROM capabilities WHERE parent_id=?').all(parentId);
      for (const c of children) {
        descIds.push(c.id);
        collectDescendants(c.id);
      }
    }
    collectDescendants(cap.id);

    // Delete descendant capabilities
    for (const cid of descIds) {
      db.prepare('DELETE FROM capabilities WHERE id=?').run(cid);
    }
    cascaded.children = descIds.length;

    // Delete self
    db.prepare('DELETE FROM capabilities WHERE id=?').run(req.params.id);

    res.json({ success: true, cascaded });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/capabilities.js
git commit -m "feat: add DELETE /api/capabilities/:id with recursive child cascade"
```

---

### Task 11: Add DELETE to processes.js with full mapping cascade

**File:** `mdm-platform/server/routes/processes.js`

- [ ] **Step 1: Insert DELETE endpoint before module.exports (after review route, line 83)**

Insert at line 84:
```js

router.delete('/:id', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const proc = db.prepare('SELECT * FROM processes WHERE id=?').get(req.params.id);
    if (!proc) return res.status(404).json({ error: '流程不存在' });

    const cascaded = {};

    const mappings = db.prepare('SELECT id FROM mappings WHERE process_id=?').all(proc.id);
    for (const m of mappings) {
      db.prepare('DELETE FROM field_identities WHERE field_entry_id IN (SELECT id FROM field_entries WHERE mapping_id=?)').run(m.id);
      db.prepare('DELETE FROM field_entries WHERE mapping_id=?').run(m.id);
      db.prepare('DELETE FROM approval_tasks WHERE mapping_id=?').run(m.id);
      db.prepare('DELETE FROM approval_history WHERE mapping_id=?').run(m.id);
      db.prepare('DELETE FROM todos WHERE mapping_id=?').run(m.id);
      db.prepare('DELETE FROM mapping_related_departments WHERE mapping_id=?').run(m.id);
      db.prepare('DELETE FROM mapping_systems WHERE mapping_id=?').run(m.id);
    }
    cascaded.mappings = mappings.length;

    const { changes: mappingCount } = db.prepare('DELETE FROM mappings WHERE process_id=?').run(proc.id);
    cascaded.mappings = mappingCount;

    db.prepare('DELETE FROM processes WHERE id=?').run(req.params.id);

    res.json({ success: true, cascaded });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/processes.js
git commit -m "feat: add DELETE /api/processes/:id with full mapping cascade"
```

---

### Task 11b: Add DELETE to terminology.js

**File:** `mdm-platform/server/routes/terminology.js`

terminology.js already imports `requirePermission`. Uses `runDbAction` helper.

- [ ] **Step 1: Insert DELETE endpoint before module.exports (after line 83, the review route)**
```js

router.delete('/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const r = db.prepare('DELETE FROM terms WHERE id=?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: '术语不存在' });
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/terminology.js
git commit -m "feat: add DELETE /api/terminology/:id"
```

---

### Task 12: Add delete buttons to frontend (index.html)

**File:** `mdm-platform/public/index.html`

This task adds delete buttons to 10 existing table panels. Each follows the same pattern: an `<a>` tag with `color:#e53935`, `onclick="deleteXxx(...)"`, only visible when `state.user.role === 'admin'`.

- [ ] **Step 1: Add helper — admin visibility check in renderCapsAndProcs (line 780)**

In `renderCapsAndProcs()`, add `const isAdmin = state.user && state.user.role === 'admin';` at function start.

In the capRows mapping (line 782), add delete link in the operation column:
```js
'<td><button class="btn success" onclick="event.stopPropagation();reviewCap(' + rowId + ',\'approve\')">通过</button> ' +
'<button class="btn danger" onclick="event.stopPropagation();reviewCap(' + rowId + ',\'reject\')">驳回</button>' +
(isAdmin ? ' <a href="#" onclick="event.stopPropagation();deleteCapability(' + rowId + ')" style="color:#e53935;">删除</a>' : '') + '</td></tr>';
```

In the procRows mapping (line 793), add delete link:
```js
'<td><button class="btn secondary" onclick="navigateTo(\'detail\',{tab:\'processes\',type:\'process\',id:' + rowId + '})">详情</button> <button class="btn success" onclick="reviewProc(' + rowId + ',\'approve\')">通过</button> <button class="btn danger" onclick="reviewProc(' + rowId + ',\'reject\')">驳回</button>' +
(isAdmin ? ' <a href="#" onclick="event.stopPropagation();deleteProcess(' + rowId + ')" style="color:#e53935;">删除</a>' : '') + '</td></tr>';
```

- [ ] **Step 2: Add delete functions for capabilities and processes**

Add after `renderCapsAndProcs()`:
```js
function deleteCapability(id) {
  if (!confirm('确定删除能力 #' + id + ' 吗？子能力也将被删除。')) return;
  fetch('/api/capabilities/' + id, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { alert('删除失败：' + d.error); } else { loadCatalog(); }
  });
}
function deleteProcess(id) {
  if (!confirm('确定删除流程 #' + id + ' 吗？相关映射和数据将被删除。')) return;
  fetch('/api/processes/' + id, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { alert('删除失败：' + d.error); } else { loadCatalog(); }
  });
}
```

- [ ] **Step 3: Add delete buttons in loadOrgUnits (line 2103)**

In the OU row rendering, add delete link to the operation column:
```js
(r.status === 'draft' ? '<a href="#" onclick="activateOu(\'' + escHtml(r.org_unit_code) + '\');return false">激活</a> ' : '') +
(state.user && state.user.role === 'admin' ? '<a href="#" onclick="deleteOu(\'' + escHtml(r.org_unit_code) + '\');return false" style="color:#e53935;">删除</a>' : '') + '</td></tr>';
```

Add delete function near `activateOu`:
```js
async function deleteOu(code) {
  if (!confirm('确定删除组织 ' + code + ' 吗？下属岗位和任岗记录也将被删除。')) return;
  try {
    var res = await api('/api/org-units/' + encodeURIComponent(code), { method: 'DELETE' });
    if (res.success) { alert('已删除，级联：' + JSON.stringify(res.cascaded)); loadOrgUnits(); }
    else alert('删除失败：' + (res.error || '未知错误'));
  } catch (e) { alert('删除失败'); }
}
```

- [ ] **Step 4: Add delete buttons in loadPersons (line 2141)**

In the person row rendering, add delete link:
```js
(r.status === 'draft' ? '<a href="#" onclick="activatePerson(\'' + escHtml(r.employee_no) + '\');return false">激活</a> ' : '') +
(state.user && state.user.role === 'admin' ? '<a href="#" onclick="deletePerson(\'' + escHtml(r.employee_no) + '\');return false" style="color:#e53935;">删除</a>' : '') + '</td></tr>';
```

Add delete function near `activatePerson`:
```js
async function deletePerson(no) {
  if (!confirm('确定删除人员 ' + no + ' 吗？任岗记录也将被删除。')) return;
  try {
    var res = await api('/api/persons/' + encodeURIComponent(no), { method: 'DELETE' });
    if (res.success) { alert('已删除，级联：' + JSON.stringify(res.cascaded)); loadPersons(); }
    else alert('删除失败：' + (res.error || '未知错误'));
  } catch (e) { alert('删除失败'); }
}
```

- [ ] **Step 5: Add delete buttons in loadProductFamilies (line 2174)**

In the PF row rendering, add delete link:
```js
(r.status === 'draft' ? '<a href="#" onclick="activatePf(\'' + escHtml(r.product_family_code) + '\');return false">激活</a> ' : '') +
(state.user && state.user.role === 'admin' ? '<a href="#" onclick="deletePf(\'' + escHtml(r.product_family_code) + '\');return false" style="color:#e53935;">删除</a>' : '') + '</td></tr>';
```

Add delete function near `activatePf`:
```js
async function deletePf(code) {
  if (!confirm('确定删除产品族 ' + code + ' 吗？下属产品也将被删除。')) return;
  try {
    var res = await api('/api/product-families/' + encodeURIComponent(code), { method: 'DELETE' });
    if (res.success) { alert('已删除，级联：' + JSON.stringify(res.cascaded)); loadProductFamilies(); }
    else alert('删除失败：' + (res.error || '未知错误'));
  } catch (e) { alert('删除失败'); }
}
```

- [ ] **Step 6: Add delete buttons in loadProducts (line 2185)**

In the product row rendering, add delete link in the operation column:
```js
(r.lifecycle_state === 'draft' ? '<a href="#" onclick="releaseProduct(\'' + escHtml(r.product_code) + '\');return false">发布</a> ' : '') +
(r.lifecycle_state === 'released' ? '<a href="#" onclick="obsoleteProduct(\'' + escHtml(r.product_code) + '\');return false">废止</a> ' : '') +
(state.user && state.user.role === 'admin' ? '<a href="#" onclick="deleteProduct(\'' + escHtml(r.product_code) + '\');return false" style="color:#e53935;">删除</a>' : '') + '</td></tr>';
```

Add delete function near product management functions:
```js
async function deleteProduct(code) {
  if (!confirm('确定删除产品 ' + code + ' 吗？关联属性值和分类将被删除。')) return;
  try {
    var res = await api('/api/products/' + encodeURIComponent(code), { method: 'DELETE' });
    if (res.success) { alert('已删除，级联：' + JSON.stringify(res.cascaded)); loadProducts(); }
    else alert('删除失败：' + (res.error || '未知错误'));
  } catch (e) { alert('删除失败'); }
}
```

- [ ] **Step 7: Add delete button in renderTodosList (line 934)**

Change the operation `<td>` in the todos row (line 934) from:
```js
'<td>' + (row.status === 'pending' ? '<button class="btn secondary" onclick="handleTodoAction(\'' + safeText(row.type, '') + '\', ' + rowId + ', ' + relatedId + ')">处理</button>' : '') + '</td>' +
```
to:
```js
'<td>' + (row.status === 'pending' ? '<button class="btn secondary" onclick="handleTodoAction(\'' + safeText(row.type, '') + '\', ' + rowId + ', ' + relatedId + ')">处理</button>' : '') + (isAdmin ? ' <a href="#" onclick="deleteTodo(' + rowId + ')" style="color:#e53935;margin-left:8px;">删除</a>' : '') + '</td>' +
```

Add helper at start of `renderTodosList()`:
```js
var isAdmin = state.user && state.user.role === 'admin';
```

Add function:
```js
function deleteTodo(id) {
  if (!confirm('确定删除此待办吗？')) return;
  fetch('/api/todos/' + id, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { alert('删除失败：' + d.error); } else { loadTodos(); }
  });
}
```

- [ ] **Step 8: Add delete button for terms in loadTerms rendering (line 980)**

Change the term row operation `<td>` from:
```js
'<td><button class="btn success" onclick="reviewTerm(' + rowId + ',\'approve\')">通过</button> <button class="btn danger" style="margin-left: 8px;" onclick="reviewTerm(' + rowId + ',\'reject\')">驳回</button></td></tr>'
```
to:
```js
'<td><button class="btn success" onclick="reviewTerm(' + rowId + ',\'approve\')">通过</button> <button class="btn danger" style="margin-left: 8px;" onclick="reviewTerm(' + rowId + ',\'reject\')">驳回</button>' + ((state.user && state.user.role === 'admin') ? ' <a href="#" onclick="deleteTerm(' + rowId + ')" style="color:#e53935;margin-left:8px;">删除</a>' : '') + '</td></tr>'
```

Add function:
```js
function deleteTerm(id) {
  if (!confirm('确定删除术语 #' + id + ' 吗？')) return;
  fetch('/api/terminology/' + id, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { alert('删除失败：' + d.error); } else { loadTerms(); }
  });
}
```

- [ ] **Step 9: Add delete button for mappings in loadMySubmissions (line 881)**

Change the mapping row operation `<td>` from:
```js
'<td><button class="btn secondary" onclick="navigateTo(\'detail\',{tab:\'mySubmissions\',type:\'mapping\',id:' + rowId + '})">查看</button>' + (row.status === 'draft' ? '<button class="btn primary" style="margin-left:4px;" onclick="submitMapping(' + rowId + ')">提交</button>' : '') + '</td></tr>'
```
to:
```js
'<td><button class="btn secondary" onclick="navigateTo(\'detail\',{tab:\'mySubmissions\',type:\'mapping\',id:' + rowId + '})">查看</button>' + (row.status === 'draft' ? '<button class="btn primary" style="margin-left:4px;" onclick="submitMapping(' + rowId + ')">提交</button>' : '') + ((state.user && state.user.role === 'admin' && row.status === 'draft') ? ' <a href="#" onclick="event.stopPropagation();deleteMapping(' + rowId + ')" style="color:#e53935;margin-left:4px;">删除</a>' : '') + '</td></tr>'
```

Add function:
```js
function deleteMapping(id) {
  if (!confirm('确定删除映射 #' + id + ' 吗？')) return;
  fetch('/api/mappings/' + id, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { alert('删除失败：' + d.error); } else { loadMySubmissions(); }
  });
}
```

- [ ] **Step 10: Verify admin visibility**

Ensure admin check `state.user && state.user.role === 'admin'` is consistent across all panels.

- [ ] **Step 11: Commit**

```bash
git add mdm-platform/public/index.html
git commit -m "feat: add delete buttons to all frontend data panels for admin users"
```

---

### Task 13: Smoke test all DELETE endpoints

- [ ] **Step 1: Start the server**

```bash
cd mdm-platform && npm start
```

- [ ] **Step 2: Login as admin and test each DELETE endpoint via curl or browser console**

Test sequence:

```bash
# 1. Test auth rejection
curl -X DELETE http://localhost:3000/api/org-units/TEST-CODE
# Expected: 401 "未登录"

# 2. Login as non-admin user, get cookie, test
# Expected: 403 "权限不足"

# 3. Login as admin user, test each endpoint:
# - DELETE /api/org-units/:code — check cascade returns
# - DELETE /api/positions/:code
# - DELETE /api/persons/:employeeNo
# - DELETE /api/product-families/:code — check product cascade
# - DELETE /api/products/:code
# - DELETE /api/class-nodes/:code — check recursive cascade
# - DELETE /api/attributes/defs/:code
# - DELETE /api/external/systems/:code
# - DELETE /api/external/identities/:id
# - DELETE /api/capabilities/:id
# - DELETE /api/processes/:id
# - DELETE /api/class-nodes/memberships/:id
```

- [ ] **Step 3: Frontend smoke test**

Login as admin in browser, verify deletion buttons appear in:
- 能力与流程申报 tab (capabilities, processes)
- 组织架构 tab (org units)
- 人员管理 tab (persons)
- 产品主数据 tab (product families, products)
- 角色权限 tab (roles — already exists)

Login as submitter, verify buttons do NOT appear.

- [ ] **Step 4: Commit if any fixes needed**

```bash
git add -A && git commit -m "test: verify all DELETE endpoints and frontend delete buttons"
```

---

## Known Limitations

- **Departments, systems, positions, classNodes, attributes, external systems** have no dedicated table panels in the current HTML. Their DELETE endpoints exist via API but are not exposed in the frontend UI. Adding these panels is out of scope for this plan.
- **Terms and mySubmissions (mappings/fields)** rendering is dynamically generated — delete buttons added where possible, but the rendering functions may need adjustment if the exact patterns don't match.
- **processes DELETE** cascades through mappings but does NOT cascade further to capabilities — processes and capabilities are independent.
