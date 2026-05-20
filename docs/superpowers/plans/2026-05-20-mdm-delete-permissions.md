# MDM Platform Delete Permissions Complete Fix - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-protected DELETE endpoints for MDM resource types, repair RBAC authorization gaps, and expose delete actions in the frontend only to users with effective admin permission.

**Architecture:** Backend DELETE handlers stay in the existing Express route files and use `requireAuth` + `requirePermission('admin:access')`. Each handler explicitly clears dependent rows before deleting the target row because SQLite foreign keys are enabled in `server/db.js`; recursive self-references must be deleted from leaves to root. The frontend uses effective permissions returned by `/api/org/me` instead of relying only on `state.user.role === 'admin'`.

**Tech Stack:** Express.js, better-sqlite3 with `PRAGMA foreign_keys = ON`, vanilla JavaScript frontend, existing script-based route smoke tests.

---

## Files And Responsibilities

- Modify: `mdm-platform/server/routes/org.js` - return effective permissions from `/api/org/me` for frontend visibility checks.
- Modify: `mdm-platform/server/routes/mappings.js` - replace remaining `req.session.userRole === 'admin'` authorization checks with RBAC permission checks.
- Modify: `mdm-platform/server/routes/classNode.js` - secure membership delete and add recursive class node delete.
- Modify: `mdm-platform/server/routes/orgUnit.js` - add org unit delete with position and assignment cleanup.
- Modify: `mdm-platform/server/routes/position.js` - add position delete with assignment cleanup.
- Modify: `mdm-platform/server/routes/person.js` - add person delete with assignment and manager-reference cleanup.
- Modify: `mdm-platform/server/routes/productFamily.js` - add product family delete with full product, product-family attribute, membership, supersession, and external identity cleanup.
- Modify: `mdm-platform/server/routes/product.js` - add product delete with attribute, membership, supersession, and external identity cleanup.
- Modify: `mdm-platform/server/routes/attribute.js` - add attribute definition delete with attribute value cleanup.
- Modify: `mdm-platform/server/routes/external.js` - add external system and identity deletes.
- Modify: `mdm-platform/server/routes/capabilities.js` - add capability delete with recursive child cleanup and process link nulling.
- Modify: `mdm-platform/server/routes/processes.js` - add process delete with mapping cascade and term link nulling.
- Modify: `mdm-platform/server/routes/terminology.js` - add term delete.
- Modify: `mdm-platform/public/index.html` - add `hasAdminAccess()` helper and admin-only delete actions.
- Create: `mdm-platform/scripts/test-delete-routes.js` - smoke-test auth, RBAC, dependency cleanup, and representative cascades.
- Modify: `mdm-platform/package.json` - add `test:delete`.

## Critical Constraints

- Do not use `git add -A`. This repository may already contain unrelated local changes. Stage only files touched by the current task.
- Do not depend on line numbers in this plan. Insert handlers immediately before `module.exports = router;` unless the task says otherwise.
- For recursive deletes, collect descendants parent-first, then delete `descIds.reverse()` so leaf rows are removed before their parents.
- Do not delete `processes` when deleting `capabilities`; clear `processes.capability_id` instead because processes are independently managed records.
- When deleting `processes`, delete or clear all mapping dependents first. The correct todo column is `related_mapping_id`, not `mapping_id`.
- For product and product-family deletes, clean generic side tables that have no database foreign key: `attribute_value`, `entity_class_membership`, and `external_identity`.

---

### Task 0: Preflight And Dirty Worktree Guard

- [ ] **Step 1: Capture current git state**

Run:
```bash
git status --short
```

Expected: output may contain unrelated modified or deleted files. Keep it as context. Do not revert unrelated changes.

- [ ] **Step 2: Confirm current route mount points**

Run:
```bash
rg -n "registerRouteIfExists\\('/api/(org-units|positions|persons|product-families|products|class-nodes|attributes|external|capabilities|processes|todos|terminology|mappings)'" mdm-platform/server/index.js
```

Expected: all mounted paths are present.

- [ ] **Step 3: Commit rule for every later task**

Use only explicit staging commands such as:
```bash
git add mdm-platform/server/routes/classNode.js
git commit -m "feat: add admin delete for class nodes"
```

Do not run:
```bash
git add -A
```

---

### Task 1: Return Effective Permissions From `/api/org/me`

**File:** `mdm-platform/server/routes/org.js`

- [ ] **Step 1: Add `getUserEffectivePermissions` import**

Change the auth import to:
```js
const { hashPassword, verifyPassword, requireAuth, requirePermission, getUserEffectivePermissions } = require('../auth');
```

- [ ] **Step 2: Include permissions in `/api/org/me`**

Replace the existing `/me` handler with:
```js
router.get('/me', requireAuth, (req, res) => {
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  res.json({
    id: req.session.userId,
    name: req.session.userName,
    role: req.session.userRole,
    departmentId: req.session.departmentId,
    permissions: Array.from(permSet)
  });
});
```

- [ ] **Step 3: Run focused auth smoke**

Run:
```bash
cd mdm-platform && npm run test:org
```

Expected: existing org route checks pass. If the test asserts exact `/api/org/me` shape, update it to allow the new `permissions` array.

- [ ] **Step 4: Commit**

```bash
git add mdm-platform/server/routes/org.js mdm-platform/scripts/test-org-route.js
git commit -m "feat: expose effective permissions on current user"
```

---

### Task 2: Replace Legacy Admin Checks In Mappings Route

**File:** `mdm-platform/server/routes/mappings.js`

- [ ] **Step 1: Import RBAC helper**

Change:
```js
const { requireAuth } = require('../auth');
```

to:
```js
const { requireAuth, getUserEffectivePermissions } = require('../auth');
```

- [ ] **Step 2: Add local admin helper after `runDbAction`**

Insert:
```js
function hasAdminAccess(userId) {
  const { permSet } = getUserEffectivePermissions(userId);
  return permSet.has('admin:access') || permSet.has('*:*');
}
```

- [ ] **Step 3: Fix draft update authorization**

In `router.put('/:id', ...)`, replace:
```js
if (mapping.submitted_by !== req.session.userId && req.session.userRole !== 'admin') {
  return res.status(403).json({ error: '仅创建人或管理员可修改草稿' });
}
```

with:
```js
if (mapping.submitted_by !== req.session.userId && !hasAdminAccess(req.session.userId)) {
  return res.status(403).json({ error: '仅创建人或管理员可修改草稿' });
}
```

- [ ] **Step 4: Fix draft delete authorization**

In `router.delete('/:id', ...)`, replace:
```js
if (mapping.submitted_by !== req.session.userId && req.session.userRole !== 'admin') {
  return res.status(403).json({ error: '仅创建人或管理员可删除草稿' });
}
```

with:
```js
if (mapping.submitted_by !== req.session.userId && !hasAdminAccess(req.session.userId)) {
  return res.status(403).json({ error: '仅创建人或管理员可删除草稿' });
}
```

- [ ] **Step 5: Fix publish authorization**

In `router.post('/:id/publish', ...)`, replace:
```js
if (req.session.userRole !== 'admin') return res.status(403).json({ error: '仅信息化项目组可发布' });
```

with:
```js
if (!hasAdminAccess(req.session.userId)) return res.status(403).json({ error: '仅信息化项目组可发布' });
```

- [ ] **Step 6: Run mapping and RBAC smoke**

Run:
```bash
cd mdm-platform && npm run test:mappings && npm run test:rbac
```

Expected: both scripts pass.

- [ ] **Step 7: Commit**

```bash
git add mdm-platform/server/routes/mappings.js
git commit -m "fix: use RBAC admin permission in mappings route"
```

---

### Task 3: Add DELETE To Class Nodes

**File:** `mdm-platform/server/routes/classNode.js`

- [ ] **Step 1: Add `requirePermission` import**

Change:
```js
const { requireAuth, applyFieldConstraints } = require('../auth');
```

to:
```js
const { requireAuth, requirePermission, applyFieldConstraints } = require('../auth');
```

- [ ] **Step 2: Secure membership delete**

Replace:
```js
router.delete('/memberships/:id', requireAuth, (req, res) => {
```

with:
```js
router.delete('/memberships/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
```

- [ ] **Step 3: Add recursive class node delete before `module.exports`**

Insert:
```js
router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const node = db.prepare('SELECT * FROM class_node WHERE class_code=?').get(req.params.code);
    if (!node) return res.status(404).json({ error: '分类不存在' });

    const cascaded = {};
    const descIds = [];

    function collectDescendants(parentId) {
      const children = db.prepare('SELECT class_node_id FROM class_node WHERE parent_class_node_id=?').all(parentId);
      for (const child of children) {
        descIds.push(child.class_node_id);
        collectDescendants(child.class_node_id);
      }
    }

    collectDescendants(node.class_node_id);
    const idsToDelete = descIds.slice().reverse();
    let memberships = 0;

    for (const classNodeId of idsToDelete) {
      memberships += db.prepare('DELETE FROM entity_class_membership WHERE class_node_id=?').run(classNodeId).changes;
      db.prepare("DELETE FROM external_identity WHERE entity_type='class_node' AND entity_id=?").run(classNodeId);
      db.prepare('DELETE FROM class_node WHERE class_node_id=?').run(classNodeId);
    }

    memberships += db.prepare('DELETE FROM entity_class_membership WHERE class_node_id=?').run(node.class_node_id).changes;
    db.prepare("DELETE FROM external_identity WHERE entity_type='class_node' AND entity_id=?").run(node.class_node_id);
    db.prepare('DELETE FROM class_node WHERE class_node_id=?').run(node.class_node_id);

    cascaded.children = descIds.length;
    cascaded.memberships = memberships;
    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 4: Commit**

```bash
git add mdm-platform/server/routes/classNode.js
git commit -m "feat: add admin delete for class nodes"
```

---

### Task 4: Add DELETE To Org Units

**File:** `mdm-platform/server/routes/orgUnit.js`

- [ ] **Step 1: Insert DELETE endpoint before `module.exports`**

```js
router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const unit = db.prepare('SELECT * FROM org_unit WHERE org_unit_code=?').get(req.params.code);
    if (!unit) return res.status(404).json({ error: '组织不存在' });

    const cascaded = {};
    const positions = db.prepare('SELECT position_id FROM position WHERE org_unit_id=?').all(unit.org_unit_id);
    let assignments = 0;

    for (const pos of positions) {
      assignments += db.prepare('DELETE FROM person_position_assignment WHERE position_id=?').run(pos.position_id).changes;
      db.prepare("DELETE FROM external_identity WHERE entity_type='position' AND entity_id=?").run(pos.position_id);
    }

    cascaded.assignments = assignments;
    cascaded.positions = db.prepare('DELETE FROM position WHERE org_unit_id=?').run(unit.org_unit_id).changes;

    db.prepare('UPDATE org_unit SET parent_org_unit_id=? WHERE parent_org_unit_id=?')
      .run(unit.parent_org_unit_id || null, unit.org_unit_id);
    db.prepare("DELETE FROM external_identity WHERE entity_type='org_unit' AND entity_id=?").run(unit.org_unit_id);
    db.prepare('DELETE FROM org_unit WHERE org_unit_id=?').run(unit.org_unit_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/orgUnit.js
git commit -m "feat: add admin delete for org units"
```

---

### Task 5: Add DELETE To Positions

**File:** `mdm-platform/server/routes/position.js`

- [ ] **Step 1: Insert DELETE endpoint before `module.exports`**

```js
router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const pos = db.prepare('SELECT * FROM position WHERE position_code=?').get(req.params.code);
    if (!pos) return res.status(404).json({ error: '岗位不存在' });

    const cascaded = {};
    cascaded.assignments = db.prepare('DELETE FROM person_position_assignment WHERE position_id=?').run(pos.position_id).changes;
    db.prepare("DELETE FROM external_identity WHERE entity_type='position' AND entity_id=?").run(pos.position_id);
    db.prepare('DELETE FROM position WHERE position_id=?').run(pos.position_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/position.js
git commit -m "feat: add admin delete for positions"
```

---

### Task 6: Add DELETE To Persons

**File:** `mdm-platform/server/routes/person.js`

- [ ] **Step 1: Insert DELETE endpoint before `module.exports`**

```js
router.delete('/:employeeNo', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const person = db.prepare('SELECT * FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!person) return res.status(404).json({ error: '人员不存在' });

    const cascaded = {};
    cascaded.assignments = db.prepare('DELETE FROM person_position_assignment WHERE person_id=?').run(person.person_id).changes;
    cascaded.manager_refs = db.prepare('UPDATE org_unit SET manager_person_id=NULL WHERE manager_person_id=?').run(person.person_id).changes;
    db.prepare("DELETE FROM external_identity WHERE entity_type='person' AND entity_id=?").run(person.person_id);
    db.prepare('DELETE FROM person WHERE person_id=?').run(person.person_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/person.js
git commit -m "feat: add admin delete for persons"
```

---

### Task 7: Add DELETE To Products

**File:** `mdm-platform/server/routes/product.js`

- [ ] **Step 1: Insert DELETE endpoint before `module.exports`**

```js
router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const prod = db.prepare('SELECT * FROM product WHERE product_code=?').get(req.params.code);
    if (!prod) return res.status(404).json({ error: '产品不存在' });

    const cascaded = {};
    cascaded.attribute_values = db.prepare("DELETE FROM attribute_value WHERE entity_type='product' AND entity_id=?").run(prod.product_id).changes;
    cascaded.memberships = db.prepare("DELETE FROM entity_class_membership WHERE entity_type='product' AND entity_id=?").run(prod.product_id).changes;
    cascaded.superseded_refs = db.prepare('UPDATE product SET superseded_by_product_id=NULL WHERE superseded_by_product_id=?').run(prod.product_id).changes;
    db.prepare("DELETE FROM external_identity WHERE entity_type='product' AND entity_id=?").run(prod.product_id);
    db.prepare('DELETE FROM product WHERE product_id=?').run(prod.product_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/product.js
git commit -m "feat: add admin delete for products"
```

---

### Task 8: Add DELETE To Product Families

**File:** `mdm-platform/server/routes/productFamily.js`

- [ ] **Step 1: Insert DELETE endpoint before `module.exports`**

```js
router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const pf = db.prepare('SELECT * FROM product_family WHERE product_family_code=?').get(req.params.code);
    if (!pf) return res.status(404).json({ error: '产品族不存在' });

    const cascaded = {};
    const products = db.prepare('SELECT product_id FROM product WHERE product_family_id=?').all(pf.product_family_id);
    const productIds = products.map(p => p.product_id);
    let productAttr = 0;
    let productMemberships = 0;
    let supersededRefs = 0;

    for (const productId of productIds) {
      productAttr += db.prepare("DELETE FROM attribute_value WHERE entity_type='product' AND entity_id=?").run(productId).changes;
      productMemberships += db.prepare("DELETE FROM entity_class_membership WHERE entity_type='product' AND entity_id=?").run(productId).changes;
      supersededRefs += db.prepare('UPDATE product SET superseded_by_product_id=NULL WHERE superseded_by_product_id=?').run(productId).changes;
      db.prepare("DELETE FROM external_identity WHERE entity_type='product' AND entity_id=?").run(productId);
    }

    cascaded.product_attribute_values = productAttr;
    cascaded.product_memberships = productMemberships;
    cascaded.superseded_refs = supersededRefs;
    cascaded.products = db.prepare('DELETE FROM product WHERE product_family_id=?').run(pf.product_family_id).changes;
    cascaded.family_attribute_values = db.prepare("DELETE FROM attribute_value WHERE entity_type='product_family' AND entity_id=?").run(pf.product_family_id).changes;
    cascaded.family_memberships = db.prepare("DELETE FROM entity_class_membership WHERE entity_type='product_family' AND entity_id=?").run(pf.product_family_id).changes;

    db.prepare("DELETE FROM external_identity WHERE entity_type='product_family' AND entity_id=?").run(pf.product_family_id);
    db.prepare('DELETE FROM product_family WHERE product_family_id=?').run(pf.product_family_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/productFamily.js
git commit -m "feat: add admin delete for product families"
```

---

### Task 9: Add DELETE To Attribute Definitions

**File:** `mdm-platform/server/routes/attribute.js`

- [ ] **Step 1: Add `requirePermission` import**

Change:
```js
const { requireAuth, applyFieldConstraints } = require('../auth');
```

to:
```js
const { requireAuth, requirePermission, applyFieldConstraints } = require('../auth');
```

- [ ] **Step 2: Insert DELETE endpoint before `module.exports`**

```js
router.delete('/defs/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const def = db.prepare('SELECT * FROM attribute_def WHERE attribute_code=?').get(req.params.code);
    if (!def) return res.status(404).json({ error: '属性定义不存在' });

    const cascaded = {};
    cascaded.attribute_values = db.prepare('DELETE FROM attribute_value WHERE attribute_def_id=?').run(def.attribute_def_id).changes;
    db.prepare("DELETE FROM external_identity WHERE entity_type='attribute_def' AND entity_id=?").run(def.attribute_def_id);
    db.prepare('DELETE FROM attribute_def WHERE attribute_def_id=?').run(def.attribute_def_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/server/routes/attribute.js
git commit -m "feat: add admin delete for attribute definitions"
```

---

### Task 10: Add DELETE To External Systems And Identities

**File:** `mdm-platform/server/routes/external.js`

- [ ] **Step 1: Insert system delete before identities routes**

```js
router.delete('/systems/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const sys = db.prepare('SELECT * FROM external_system WHERE system_code=?').get(req.params.code.toUpperCase());
    if (!sys) return res.status(404).json({ error: '外部系统不存在' });

    const cascaded = {};
    cascaded.identities = db.prepare('DELETE FROM external_identity WHERE system_code=?').run(sys.system_code).changes;
    db.prepare('DELETE FROM external_system WHERE system_id=?').run(sys.system_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 2: Insert identity delete before `module.exports`**

```js
router.delete('/identities/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const result = db.prepare('DELETE FROM external_identity WHERE external_identity_id=?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: '标识映射不存在' });
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});
```

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/server/routes/external.js
git commit -m "feat: add admin delete for external identities"
```

---

### Task 11: Add DELETE To Capabilities

**File:** `mdm-platform/server/routes/capabilities.js`

- [ ] **Step 1: Insert recursive DELETE endpoint before `module.exports`**

```js
router.delete('/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const cap = db.prepare('SELECT * FROM capabilities WHERE id=?').get(req.params.id);
    if (!cap) return res.status(404).json({ error: '能力不存在' });

    const cascaded = {};
    const descIds = [];

    function collectDescendants(parentId) {
      const children = db.prepare('SELECT id FROM capabilities WHERE parent_id=?').all(parentId);
      for (const child of children) {
        descIds.push(child.id);
        collectDescendants(child.id);
      }
    }

    collectDescendants(cap.id);
    const allCapIds = [cap.id].concat(descIds);
    let processLinks = 0;

    for (const capabilityId of allCapIds) {
      processLinks += db.prepare('UPDATE processes SET capability_id=NULL WHERE capability_id=?').run(capabilityId).changes;
    }

    for (const capabilityId of descIds.slice().reverse()) {
      db.prepare('DELETE FROM capabilities WHERE id=?').run(capabilityId);
    }
    db.prepare('DELETE FROM capabilities WHERE id=?').run(cap.id);

    cascaded.children = descIds.length;
    cascaded.process_links_cleared = processLinks;
    res.json({ success: true, cascaded });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/capabilities.js
git commit -m "feat: add admin delete for capabilities"
```

---

### Task 12: Add DELETE To Processes

**File:** `mdm-platform/server/routes/processes.js`

- [ ] **Step 1: Insert DELETE endpoint before `module.exports`**

```js
router.delete('/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const proc = db.prepare('SELECT * FROM processes WHERE id=?').get(req.params.id);
    if (!proc) return res.status(404).json({ error: '流程不存在' });

    const cascaded = {};
    const mappings = db.prepare('SELECT id FROM mappings WHERE process_id=?').all(proc.id);
    let fieldConflicts = 0;
    let fieldIdentities = 0;
    let fieldRejections = 0;
    let fieldEntries = 0;
    let approvalTasks = 0;
    let approvalHistory = 0;
    let todos = 0;
    let relatedDepartments = 0;
    let mappingSystems = 0;

    for (const mapping of mappings) {
      fieldConflicts += db.prepare(`
        DELETE FROM field_conflicts
        WHERE field_entry_a_id IN (SELECT id FROM field_entries WHERE mapping_id=?)
           OR field_entry_b_id IN (SELECT id FROM field_entries WHERE mapping_id=?)
      `).run(mapping.id, mapping.id).changes;
      fieldIdentities += db.prepare('DELETE FROM field_identities WHERE field_entry_id IN (SELECT id FROM field_entries WHERE mapping_id=?)').run(mapping.id).changes;
      fieldRejections += db.prepare('DELETE FROM field_rejection_reasons WHERE mapping_id=?').run(mapping.id).changes;
      fieldEntries += db.prepare('DELETE FROM field_entries WHERE mapping_id=?').run(mapping.id).changes;
      approvalTasks += db.prepare('DELETE FROM approval_tasks WHERE mapping_id=?').run(mapping.id).changes;
      approvalHistory += db.prepare('DELETE FROM approval_history WHERE mapping_id=?').run(mapping.id).changes;
      todos += db.prepare('DELETE FROM todos WHERE related_mapping_id=?').run(mapping.id).changes;
      relatedDepartments += db.prepare('DELETE FROM mapping_related_departments WHERE mapping_id=?').run(mapping.id).changes;
      mappingSystems += db.prepare('DELETE FROM mapping_systems WHERE mapping_id=?').run(mapping.id).changes;
    }

    cascaded.field_conflicts = fieldConflicts;
    cascaded.field_identities = fieldIdentities;
    cascaded.field_rejections = fieldRejections;
    cascaded.field_entries = fieldEntries;
    cascaded.approval_tasks = approvalTasks;
    cascaded.approval_history = approvalHistory;
    cascaded.todos = todos;
    cascaded.related_departments = relatedDepartments;
    cascaded.mapping_systems = mappingSystems;
    cascaded.mappings = db.prepare('DELETE FROM mappings WHERE process_id=?').run(proc.id).changes;
    cascaded.term_links_cleared = db.prepare('UPDATE terms SET process_id=NULL WHERE process_id=?').run(proc.id).changes;

    db.prepare('DELETE FROM processes WHERE id=?').run(proc.id);
    res.json({ success: true, cascaded });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/processes.js
git commit -m "feat: add admin delete for processes"
```

---

### Task 13: Add DELETE To Terms

**File:** `mdm-platform/server/routes/terminology.js`

- [ ] **Step 1: Insert DELETE endpoint before `module.exports`**

```js
router.delete('/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const result = db.prepare('DELETE FROM terms WHERE id=?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: '术语不存在' });
    res.json({ success: true });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/terminology.js
git commit -m "feat: add admin delete for terms"
```

---

### Task 14: Add Frontend Admin Permission Helper

**File:** `mdm-platform/public/index.html`

- [ ] **Step 1: Add helper near `safeText` / common helpers**

Insert:
```js
function hasAdminAccess() {
  var perms = (state.user && state.user.permissions) || [];
  return !!(state.user && (state.user.role === 'admin' || perms.indexOf('admin:access') >= 0 || perms.indexOf('*:*') >= 0));
}
```

- [ ] **Step 2: Use helper in `renderCapsAndProcs`**

At the start of `renderCapsAndProcs()`, add:
```js
var canDelete = hasAdminAccess();
```

In capability rows, change the operation cell to include:
```js
'<button class="btn danger" onclick="event.stopPropagation();reviewCap(' + rowId + ',\'reject\')">驳回</button>' +
(canDelete ? ' <a href="#" onclick="event.stopPropagation();deleteCapability(' + rowId + ');return false" style="color:#e53935;">删除</a>' : '') + '</td></tr>';
```

In process rows, change the operation cell to include:
```js
'<button class="btn danger" onclick="reviewProc(' + rowId + ',\'reject\')">驳回</button>' +
(canDelete ? ' <a href="#" onclick="deleteProcess(' + rowId + ');return false" style="color:#e53935;">删除</a>' : '') + '</td></tr>';
```

- [ ] **Step 3: Add capability and process delete functions after `renderCapsAndProcs`**

```js
function deleteCapability(id) {
  if (!confirm('确定删除能力 #' + id + ' 吗？子能力也将被删除，关联流程会保留但不再挂接此能力。')) return;
  fetch('/api/capabilities/' + id, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { alert('删除失败：' + d.error); } else { loadCatalog(); }
  });
}

function deleteProcess(id) {
  if (!confirm('确定删除流程 #' + id + ' 吗？相关映射、字段、审批记录和待办将被删除。')) return;
  fetch('/api/processes/' + id, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { alert('删除失败：' + d.error); } else { loadCatalog(); }
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add mdm-platform/public/index.html
git commit -m "feat: add admin delete actions for capability catalog"
```

---

### Task 15: Add Frontend Delete Actions To Data Panels

**File:** `mdm-platform/public/index.html`

- [ ] **Step 1: Add org unit delete link and function**

In `loadOrgUnits()`, append this after the existing activate link expression:
```js
(hasAdminAccess() ? '<a href="#" onclick="deleteOu(\'' + escHtml(r.org_unit_code) + '\');return false" style="color:#e53935;margin-left:8px;">删除</a>' : '')
```

Add near `activateOu`:
```js
async function deleteOu(code) {
  if (!confirm('确定删除组织 ' + code + ' 吗？下属岗位和任岗记录也将被删除，子组织会挂到上级组织。')) return;
  try {
    var res = await api('/api/org-units/' + encodeURIComponent(code), { method: 'DELETE' });
    if (res.success) { alert('已删除，级联：' + JSON.stringify(res.cascaded)); loadOrgUnits(); }
    else alert('删除失败：' + (res.error || '未知错误'));
  } catch (e) { alert('删除失败'); }
}
```

- [ ] **Step 2: Add person delete link and function**

In `loadPersons()`, append this after the existing activate link expression:
```js
(hasAdminAccess() ? '<a href="#" onclick="deletePerson(\'' + escHtml(r.employee_no) + '\');return false" style="color:#e53935;margin-left:8px;">删除</a>' : '')
```

Add near `activatePerson`:
```js
async function deletePerson(no) {
  if (!confirm('确定删除人员 ' + no + ' 吗？任岗记录和组织负责人引用将被清理。')) return;
  try {
    var res = await api('/api/persons/' + encodeURIComponent(no), { method: 'DELETE' });
    if (res.success) { alert('已删除，级联：' + JSON.stringify(res.cascaded)); loadPersons(); }
    else alert('删除失败：' + (res.error || '未知错误'));
  } catch (e) { alert('删除失败'); }
}
```

- [ ] **Step 3: Add product family delete link and function**

In `loadProductFamilies()`, append this after the existing activate link expression:
```js
(hasAdminAccess() ? '<a href="#" onclick="deletePf(\'' + escHtml(r.product_family_code) + '\');return false" style="color:#e53935;margin-left:8px;">删除</a>' : '')
```

Add near `activatePf`:
```js
async function deletePf(code) {
  if (!confirm('确定删除产品族 ' + code + ' 吗？下属产品、属性值和分类关系将被删除。')) return;
  try {
    var res = await api('/api/product-families/' + encodeURIComponent(code), { method: 'DELETE' });
    if (res.success) { alert('已删除，级联：' + JSON.stringify(res.cascaded)); loadProductFamilies(); loadProducts(); }
    else alert('删除失败：' + (res.error || '未知错误'));
  } catch (e) { alert('删除失败'); }
}
```

- [ ] **Step 4: Add product delete link and function**

In `loadProducts()`, append this after the existing release/obsolete link expressions:
```js
(hasAdminAccess() ? '<a href="#" onclick="deleteProduct(\'' + escHtml(r.product_code) + '\');return false" style="color:#e53935;margin-left:8px;">删除</a>' : '')
```

Add near `releaseProduct` / `obsoleteProduct`:
```js
async function deleteProduct(code) {
  if (!confirm('确定删除产品 ' + code + ' 吗？关联属性值、分类关系和替代引用将被清理。')) return;
  try {
    var res = await api('/api/products/' + encodeURIComponent(code), { method: 'DELETE' });
    if (res.success) { alert('已删除，级联：' + JSON.stringify(res.cascaded)); loadProducts(); }
    else alert('删除失败：' + (res.error || '未知错误'));
  } catch (e) { alert('删除失败'); }
}
```

- [ ] **Step 5: Commit**

```bash
git add mdm-platform/public/index.html
git commit -m "feat: add admin delete actions for master data panels"
```

---

### Task 16: Add Frontend Delete Actions To Todos, Terms, And Draft Mappings

**File:** `mdm-platform/public/index.html`

- [ ] **Step 1: Add todo delete**

At the start of `renderTodosList()`, after the container guard, add:
```js
var canDelete = hasAdminAccess();
```

Replace the operation cell expression with:
```js
'<td>' + (row.status === 'pending' ? '<button class="btn secondary" onclick="handleTodoAction(\'' + safeText(row.type, '') + '\', ' + rowId + ', ' + relatedId + ')">处理</button>' : '') + (canDelete ? ' <a href="#" onclick="deleteTodo(' + rowId + ');return false" style="color:#e53935;margin-left:8px;">删除</a>' : '') + '</td>' +
```

Add:
```js
function deleteTodo(id) {
  if (!confirm('确定删除此待办吗？')) return;
  fetch('/api/todos/' + id, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { alert('删除失败：' + d.error); } else { loadTodos(); }
  });
}
```

- [ ] **Step 2: Add term delete**

In `loadTerms()`, append this inside the operation `<td>`:
```js
+ (hasAdminAccess() ? ' <a href="#" onclick="deleteTerm(' + rowId + ');return false" style="color:#e53935;margin-left:8px;">删除</a>' : '')
```

Add:
```js
function deleteTerm(id) {
  if (!confirm('确定删除术语 #' + id + ' 吗？')) return;
  fetch('/api/terminology/' + id, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { alert('删除失败：' + d.error); } else { loadTerms(); }
  });
}
```

- [ ] **Step 3: Add draft mapping delete**

In `loadMySubmissions()`, append this inside the operation `<td>`:
```js
+ (hasAdminAccess() && row.status === 'draft' ? ' <a href="#" onclick="deleteMapping(' + rowId + ');return false" style="color:#e53935;margin-left:4px;">删除</a>' : '')
```

Add:
```js
function deleteMapping(id) {
  if (!confirm('确定删除映射 #' + id + ' 吗？只能删除草稿。')) return;
  fetch('/api/mappings/' + id, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { alert('删除失败：' + d.error); } else { loadMySubmissions(); }
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add mdm-platform/public/index.html
git commit -m "feat: add admin delete actions for work queues"
```

---

### Task 17: Add DELETE Route Smoke Test

**Files:**
- Create: `mdm-platform/scripts/test-delete-routes.js`
- Modify: `mdm-platform/package.json`

- [ ] **Step 1: Add package script**

In `package.json` scripts, add:
```json
"test:delete": "node scripts/test-delete-routes.js"
```

- [ ] **Step 2: Create smoke script**

Create `mdm-platform/scripts/test-delete-routes.js` with this content:
```js
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3219;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const dbPath = path.join(__dirname, '..', 'data', 'platform.db');

if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

function seed() {
  const dept = db.prepare("INSERT INTO departments (name, code, status) VALUES ('信息化部', 'IT', 'active')").run().lastInsertRowid;
  const admin = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '系统管理员', 'ADMIN001', dept, '系统管理员', 'admin', hashPassword('admin123')
  ).lastInsertRowid;
  const submitter = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '普通用户', 'SUB001', dept, '专员', 'submitter', hashPassword('pass1234')
  ).lastInsertRowid;

  const capRoot = db.prepare("INSERT INTO capabilities (name, level, owner_dept_id, created_by) VALUES ('根能力', 'L1', ?, ?)").run(dept, admin).lastInsertRowid;
  const capChild = db.prepare("INSERT INTO capabilities (name, level, owner_dept_id, parent_id, created_by) VALUES ('子能力', 'L2', ?, ?, ?)").run(dept, capRoot, admin).lastInsertRowid;
  const proc = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id, created_by) VALUES (?, ?, ?, ?)').run('删除测试流程', capChild, dept, admin).lastInsertRowid;
  const mapping = db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'draft', ?, 1)").run(proc, dept, submitter).lastInsertRowid;
  const field = db.prepare("INSERT INTO field_entries (mapping_id, field_name_cn, submitted_by) VALUES (?, '测试字段', ?)").run(mapping, submitter).lastInsertRowid;
  db.prepare("INSERT INTO field_identities (field_entry_id, authoritative_system) VALUES (?, 'MDM')").run(field);
  db.prepare("INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, content) VALUES (?, ?, 'general', ?, '删除测试待办')").run(dept, dept, mapping);
  db.prepare("INSERT INTO terms (term, definition, process_id, created_by) VALUES ('删除测试术语', '定义', ?, ?)").run(proc, admin);

  const ou = db.prepare("INSERT INTO org_unit (org_unit_code, org_unit_name, org_type, org_mnemonic, status, created_by) VALUES ('OU_DEL', '删除组织', 'department', 'OUD', 'active', ?)").run(admin).lastInsertRowid;
  const person = db.prepare("INSERT INTO person (employee_no, person_name, employment_status, status, created_by) VALUES ('P_DEL', '删除人员', 'active', 'active', ?)").run(admin).lastInsertRowid;
  const position = db.prepare("INSERT INTO position (position_code, position_name, org_unit_id, pos_mnemonic, status, created_by) VALUES ('POS_DEL', '删除岗位', ?, 'POSD', 'active', ?)").run(ou, admin).lastInsertRowid;
  db.prepare('INSERT INTO person_position_assignment (person_id, position_id, assignment_type, status, created_by) VALUES (?, ?, ?, ?, ?)').run(person, position, 'primary', 'active', admin);
  db.prepare('UPDATE org_unit SET manager_person_id=? WHERE org_unit_id=?').run(person, ou);

  const ouPositionOnly = db.prepare("INSERT INTO org_unit (org_unit_code, org_unit_name, org_type, org_mnemonic, status, created_by) VALUES ('OU_POS', '岗位测试组织', 'department', 'OUP', 'active', ?)").run(admin).lastInsertRowid;
  const personPositionOnly = db.prepare("INSERT INTO person (employee_no, person_name, employment_status, status, created_by) VALUES ('P_POS', '岗位测试人员', 'active', 'active', ?)").run(admin).lastInsertRowid;
  const positionOnly = db.prepare("INSERT INTO position (position_code, position_name, org_unit_id, pos_mnemonic, status, created_by) VALUES ('POS_ONLY', '单独删除岗位', ?, 'POSO', 'active', ?)").run(ouPositionOnly, admin).lastInsertRowid;
  db.prepare('INSERT INTO person_position_assignment (person_id, position_id, assignment_type, status, created_by) VALUES (?, ?, ?, ?, ?)').run(personPositionOnly, positionOnly, 'primary', 'active', admin);

  const personOnly = db.prepare("INSERT INTO person (employee_no, person_name, employment_status, status, created_by) VALUES ('P_ONLY', '单独删除人员', 'active', 'active', ?)").run(admin).lastInsertRowid;
  db.prepare('UPDATE org_unit SET manager_person_id=? WHERE org_unit_id=?').run(personOnly, ouPositionOnly);

  const pf = db.prepare("INSERT INTO product_family (product_family_code, model_name, model_code, class_major, status, created_by) VALUES ('PF_DEL', '产品接口测试族', 'PFD', 'A', 'active', ?)").run(admin).lastInsertRowid;
  const prod = db.prepare("INSERT INTO product (product_code, product_family_id, revision, lifecycle_state, created_by) VALUES ('PROD_DEL', ?, 'A', 'released', ?)").run(pf, admin).lastInsertRowid;
  const prod2 = db.prepare("INSERT INTO product (product_code, product_family_id, revision, lifecycle_state, superseded_by_product_id, created_by) VALUES ('PROD_REF', ?, 'B', 'released', ?, ?)").run(pf, prod, admin).lastInsertRowid;
  const pfCascade = db.prepare("INSERT INTO product_family (product_family_code, model_name, model_code, class_major, status, created_by) VALUES ('PF_CASCADE', '产品族级联测试', 'PFC', 'A', 'active', ?)").run(admin).lastInsertRowid;
  const prodCascade = db.prepare("INSERT INTO product (product_code, product_family_id, revision, lifecycle_state, created_by) VALUES ('PROD_CASCADE', ?, 'A', 'released', ?)").run(pfCascade, admin).lastInsertRowid;
  const prodCascadeRef = db.prepare("INSERT INTO product (product_code, product_family_id, revision, lifecycle_state, superseded_by_product_id, created_by) VALUES ('PROD_CASCADE_REF', ?, 'B', 'released', ?, ?)").run(pfCascade, prodCascade, admin).lastInsertRowid;
  const attr = db.prepare("INSERT INTO attribute_def (attribute_code, attribute_name, data_type, applies_to, created_by) VALUES ('ATTR_DEL', '删除属性', 'string', 'product', ?)").run(admin).lastInsertRowid;
  db.prepare("INSERT INTO attribute_value (entity_type, entity_id, attribute_def_id, value_string, created_by) VALUES ('product', ?, ?, 'v', ?)").run(prod, attr, admin);
  db.prepare("INSERT INTO attribute_value (entity_type, entity_id, attribute_def_id, value_string, created_by) VALUES ('product_family', ?, ?, 'v', ?)").run(pf, attr, admin);
  db.prepare("INSERT INTO attribute_value (entity_type, entity_id, attribute_def_id, value_string, created_by) VALUES ('product', ?, ?, 'v', ?)").run(prodCascade, attr, admin);
  db.prepare("INSERT INTO attribute_value (entity_type, entity_id, attribute_def_id, value_string, created_by) VALUES ('product_family', ?, ?, 'v', ?)").run(pfCascade, attr, admin);
  const classRoot = db.prepare("INSERT INTO class_node (class_code, class_name, class_type, created_by) VALUES ('CLS_ROOT', '根分类', 'product', ?)").run(admin).lastInsertRowid;
  const classChild = db.prepare("INSERT INTO class_node (class_code, class_name, class_type, parent_class_node_id, created_by) VALUES ('CLS_CHILD', '子分类', 'product', ?, ?)").run(classRoot, admin).lastInsertRowid;
  db.prepare("INSERT INTO entity_class_membership (entity_type, entity_id, class_node_id, created_by) VALUES ('product', ?, ?, ?)").run(prod, classChild, admin);
  db.prepare("INSERT INTO entity_class_membership (entity_type, entity_id, class_node_id, created_by) VALUES ('product', ?, ?, ?)").run(prodCascade, classChild, admin);
  db.prepare("INSERT INTO entity_class_membership (entity_type, entity_id, class_node_id, created_by) VALUES ('product_family', ?, ?, ?)").run(pfCascade, classChild, admin);
  db.prepare("INSERT INTO external_system (system_code, system_name, created_by) VALUES ('EXTDEL', '外部删除系统', ?)").run(admin);
  db.prepare("INSERT INTO external_identity (entity_type, entity_id, system_code, external_key, created_by) VALUES ('product', ?, 'EXTDEL', 'P-1', ?)").run(prod, admin);
  db.prepare("INSERT INTO external_identity (entity_type, entity_id, system_code, external_key, created_by) VALUES ('person', ?, 'EXTDEL', 'P-2', ?)").run(personOnly, admin);
  const externalIdentity = db.prepare("INSERT INTO external_identity (entity_type, entity_id, system_code, external_key, created_by) VALUES ('manual_test', 999, 'EXTDEL', 'MANUAL-1', ?)").run(admin).lastInsertRowid;

  return { proc, capRoot, mapping, ou, person, position, positionOnly, personOnly, pf, prod, prod2, pfCascade, prodCascade, prodCascadeRef, attr, externalIdentity };
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.ok) {
          clearInterval(timer);
          resolve();
        }
      } catch (e) {
        if (Date.now() - started > 10000) {
          clearInterval(timer);
          reject(new Error('server did not start'));
        }
      }
    }, 200);
  });
}

async function request(routePath, options = {}, cookie = '') {
  const headers = {
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(`${BASE_URL}${routePath}`, { ...options, headers });
  let body = {};
  try { body = await res.json(); } catch (e) {}
  return { res, body };
}

async function login(employeeNo, password) {
  const result = await request('/api/org/login', {
    method: 'POST',
    body: JSON.stringify({ employee_no: employeeNo, password })
  });
  assert.strictEqual(result.res.status, 200);
  return result.res.headers.get('set-cookie').split(';')[0];
}

(async () => {
  const ids = seed();
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'delete-test-secret' },
    stdio: 'inherit'
  });

  try {
    await waitForServer();

    const unauth = await request('/api/products/PROD_DEL', { method: 'DELETE' });
    assert.strictEqual(unauth.res.status, 401);

    const submitterCookie = await login('SUB001', 'pass1234');
    const forbidden = await request('/api/products/PROD_DEL', { method: 'DELETE' }, submitterCookie);
    assert.strictEqual(forbidden.res.status, 403);

    const adminCookie = await login('ADMIN001', 'admin123');

    let del = await request('/api/products/PROD_DEL', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM product WHERE product_code=?').get('PROD_DEL').c, 0);
    assert.strictEqual(db.prepare('SELECT superseded_by_product_id FROM product WHERE product_id=?').get(ids.prod2).superseded_by_product_id, null);

    del = await request('/api/product-families/PF_CASCADE', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM product_family WHERE product_family_id=?').get(ids.pfCascade).c, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM product WHERE product_family_id=?').get(ids.pfCascade).c, 0);

    del = await request('/api/class-nodes/CLS_ROOT', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM class_node WHERE class_code IN ('CLS_ROOT','CLS_CHILD')").get().c, 0);

    del = await request(`/api/processes/${ids.proc}`, { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM mappings WHERE id=?').get(ids.mapping).c, 0);
    assert.strictEqual(db.prepare("SELECT process_id FROM terms WHERE term='删除测试术语'").get().process_id, null);

    del = await request(`/api/capabilities/${ids.capRoot}`, { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM capabilities WHERE id=?').get(ids.capRoot).c, 0);

    del = await request('/api/positions/POS_ONLY', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM position WHERE position_code=?').get('POS_ONLY').c, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM person_position_assignment WHERE position_id=?').get(ids.positionOnly).c, 0);

    del = await request('/api/persons/P_ONLY', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM person WHERE employee_no=?').get('P_ONLY').c, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM org_unit WHERE manager_person_id=?').get(ids.personOnly).c, 0);

    del = await request('/api/org-units/OU_DEL', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM org_unit WHERE org_unit_code=?').get('OU_DEL').c, 0);

    del = await request('/api/attributes/defs/ATTR_DEL', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);

    del = await request(`/api/external/identities/${ids.externalIdentity}`, { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM external_identity WHERE external_identity_id=?').get(ids.externalIdentity).c, 0);

    del = await request('/api/external/systems/EXTDEL', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);

    console.log('Delete route smoke passed');
  } finally {
    server.kill();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run smoke script**

Run:
```bash
cd mdm-platform && npm run test:delete
```

Expected: `Delete route smoke passed`.

- [ ] **Step 4: Commit**

```bash
git add mdm-platform/package.json mdm-platform/scripts/test-delete-routes.js
git commit -m "test: add delete route smoke coverage"
```

---

### Task 18: Final Verification

- [ ] **Step 1: Run backend smoke suites**

Run:
```bash
cd mdm-platform && npm run test:org && npm run test:catalog && npm run test:mappings && npm run test:security && npm run test:rbac && npm run test:delete
```

Expected: all scripts pass.

- [ ] **Step 2: Run frontend asset test**

Run:
```bash
cd mdm-platform && npm run test:frontend
```

Expected: pass.

- [ ] **Step 3: Manual browser smoke**

Start the server:
```bash
cd mdm-platform && npm start
```

Open `http://localhost:3000`, log in as an admin-equivalent user, and verify delete links appear in:
- 能力与流程申报: capabilities and processes.
- 待办收到: todos.
- 术语管理: terms.
- 我的报送: draft mappings.
- 组织架构: org units.
- 人员管理: persons.
- 产品主数据: product families and products.

Log in as a non-admin user and verify these delete links are hidden.

- [ ] **Step 4: Final git check**

Run:
```bash
git status --short
```

Expected: only intentional files are modified or committed. Unrelated pre-existing worktree changes remain untouched.

## Known Non-Goals

- This plan does not add new frontend panels for positions, class nodes, attribute definitions, external systems, or external identities. Their DELETE APIs are covered by smoke tests and can be wired into UI panels in a later UI expansion.
- This plan does not hard-delete processes when deleting capabilities. It preserves processes and clears `capability_id`, because processes are independent business records.
- This plan does not add database migrations to change foreign key actions. It keeps the current schema and performs explicit cleanup in route handlers.
