# MDM 平台数据模型升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MDM 平台数据模型从通用 EAV 模式完全重建为领域专用表结构，对齐 data-model-design spec 的 12 张表 + 编码引擎 + 安全中间件。

**Architecture:** 删除旧 MDM Module A/B/D 全部表，新建 org_unit/position/person/person_position_assignment/product_family/product/class_node/entity_class_membership/attribute_def/attribute_value/external_system/external_identity 共 12 张表。新增编码引擎 (codeEngine.js) 支持分段流水号，新增内部 ID 安全中间件。V1 核心表 (departments/users/mappings 等) 保持不变。

**Tech Stack:** Express.js + better-sqlite3 + bcryptjs + 原生 HTML/CSS/JS

---

### Task 1: 重构数据库 Schema（db.js）

**Files:**
- Modify: `mdm-platform/server/db.js` (替换 Module A/B/D 建表段落)

- [ ] **Step 1: 替换旧 MDM 表为新的 12 张 spec 表**

定位 `mdm-platform/server/db.js` 中的 `── Module A: Master Data Registry ──` 注释行，将其后至文件末尾的全部 MDM 建表代码（Modules A/B/D 及其 console.log）替换为以下内容：

```js
// ── MDM v2: Domain-Specific Data Model (per spec 2026-05-18) ──

// Encoding sequence table (replaces master_data_code_rules)
db.exec(`
CREATE TABLE IF NOT EXISTS code_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  scope_key TEXT NOT NULL DEFAULT '',
  next_seq INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, scope_key)
);
`);

// 4.1 org_unit
db.exec(`
CREATE TABLE IF NOT EXISTS org_unit (
  org_unit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_unit_code TEXT NOT NULL UNIQUE,
  org_unit_name TEXT NOT NULL,
  org_type TEXT NOT NULL CHECK(org_type IN ('company','department','office','team')),
  org_mnemonic TEXT NOT NULL UNIQUE,
  parent_org_unit_id INTEGER REFERENCES org_unit(org_unit_id),
  manager_person_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','inactive')),
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.2 position
db.exec(`
CREATE TABLE IF NOT EXISTS position (
  position_id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_code TEXT NOT NULL UNIQUE,
  position_name TEXT NOT NULL,
  pos_mnemonic TEXT NOT NULL,
  org_unit_id INTEGER NOT NULL REFERENCES org_unit(org_unit_id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','inactive')),
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(org_unit_id, pos_mnemonic)
);
`);

// 4.3 person
db.exec(`
CREATE TABLE IF NOT EXISTS person (
  person_id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_no TEXT NOT NULL UNIQUE,
  person_name TEXT NOT NULL,
  mobile TEXT,
  email TEXT,
  employment_status TEXT NOT NULL DEFAULT 'active' CHECK(employment_status IN ('active','leave','suspended')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','inactive')),
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.4 person_position_assignment
db.exec(`
CREATE TABLE IF NOT EXISTS person_position_assignment (
  assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES person(person_id),
  position_id INTEGER NOT NULL REFERENCES position(position_id),
  is_primary INTEGER NOT NULL DEFAULT 0,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.5 product_family
db.exec(`
CREATE TABLE IF NOT EXISTS product_family (
  product_family_id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_family_code TEXT NOT NULL UNIQUE,
  model_name TEXT NOT NULL,
  model_code TEXT NOT NULL,
  class_major TEXT NOT NULL,
  product_type TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','inactive')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(model_code, class_major)
);
`);

// 4.6 product (versioned)
db.exec(`
CREATE TABLE IF NOT EXISTS product (
  product_id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL UNIQUE,
  product_family_id INTEGER NOT NULL REFERENCES product_family(product_family_id),
  revision TEXT,
  class_mid TEXT,
  class_minor TEXT,
  lifecycle_state TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle_state IN ('draft','released','obsolete')),
  superseded_by_product_id INTEGER REFERENCES product(product_id),
  effective_from DATE,
  effective_to DATE,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.7 class_node
db.exec(`
CREATE TABLE IF NOT EXISTS class_node (
  class_node_id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_code TEXT NOT NULL UNIQUE,
  class_name TEXT NOT NULL,
  class_type TEXT NOT NULL CHECK(class_type IN ('product','material','common')),
  parent_class_node_id INTEGER REFERENCES class_node(class_node_id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.8 entity_class_membership
db.exec(`
CREATE TABLE IF NOT EXISTS entity_class_membership (
  membership_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('product','product_family')),
  entity_id INTEGER NOT NULL,
  class_node_id INTEGER NOT NULL REFERENCES class_node(class_node_id),
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, class_node_id)
);
`);

// 4.9 attribute_def
db.exec(`
CREATE TABLE IF NOT EXISTS attribute_def (
  attribute_def_id INTEGER PRIMARY KEY AUTOINCREMENT,
  attribute_code TEXT NOT NULL UNIQUE,
  attribute_name TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK(data_type IN ('string','number','date','boolean','enum','json')),
  enum_ref TEXT,
  applies_to TEXT NOT NULL CHECK(applies_to IN ('product','product_family','common')),
  is_required INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.10 attribute_value
db.exec(`
CREATE TABLE IF NOT EXISTS attribute_value (
  attribute_value_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('product','product_family')),
  entity_id INTEGER NOT NULL,
  attribute_def_id INTEGER NOT NULL REFERENCES attribute_def(attribute_def_id),
  value_string TEXT,
  value_number REAL,
  value_date TEXT,
  value_bool INTEGER,
  value_json TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, attribute_def_id)
);
`);

// 4.11 external_system
db.exec(`
CREATE TABLE IF NOT EXISTS external_system (
  system_id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_code TEXT NOT NULL UNIQUE,
  system_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.12 external_identity
db.exec(`
CREATE TABLE IF NOT EXISTS external_identity (
  external_identity_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  system_code TEXT NOT NULL REFERENCES external_system(system_code),
  external_key TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  last_sync_at DATETIME,
  last_sync_status TEXT CHECK(last_sync_status IN ('ok','failed','pending')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, system_code),
  UNIQUE(system_code, external_key)
);
`);

// Integration: API credentials (kept from old Module D, simplified)
db.exec(`
CREATE TABLE IF NOT EXISTS integration_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_name TEXT NOT NULL UNIQUE,
  api_key_hash TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '["read"]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME
);
`);

// Integration: sync log
db.exec(`
CREATE TABLE IF NOT EXISTS integration_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  params_json TEXT,
  records_returned INTEGER,
  status TEXT NOT NULL CHECK(status IN ('success','error')),
  error_reason TEXT,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Migration: add person_id FK to departments
const depInfo2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='departments'").get();
if (depInfo2 && !depInfo2.sql.includes('person_id')) {
  db.exec("ALTER TABLE departments ADD COLUMN person_id INTEGER");
}

console.log('MDM v2: Domain-specific tables ready (12 tables)');
```

- [ ] **Step 2: 重建数据库**

```bash
cd mdm-platform && node -e "require('./server/db'); console.log('DB rebuilt OK');"
```

预期输出: `MDM v2: Domain-specific tables ready (12 tables)` + `DB rebuilt OK`

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/server/db.js
git commit -m "feat: replace generic MDM tables with 12 domain-specific spec tables"
```

---

### Task 2: 创建编码引擎

**Files:**
- Create: `mdm-platform/server/codeEngine.js`

- [ ] **Step 1: 创建编码引擎模块**

```js
const db = require('./db');

const TYPE_CODES = {
  company: 'COM', department: 'DEPT', office: 'OFC', team: 'TEAM'
};

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function takeSeq(entityType, scopeKey) {
  const key = scopeKey || '';
  const row = db.prepare(
    'SELECT id, next_seq FROM code_sequences WHERE entity_type=? AND scope_key=?'
  ).get(entityType, key);
  if (!row) {
    db.prepare(
      'INSERT INTO code_sequences (entity_type, scope_key, next_seq) VALUES (?, ?, 2)'
    ).run(entityType, key);
    return 1;
  }
  db.prepare(
    'UPDATE code_sequences SET next_seq = next_seq + 1 WHERE id=?'
  ).run(row.id);
  return row.next_seq;
}

const codeGenerators = {
  orgUnit(params) {
    const typeCode = TYPE_CODES[params.org_type] || 'UNK';
    const seq = takeSeq('org_unit', '');
    return `OU-${typeCode}-${params.org_mnemonic}-${pad(seq, 6)}`;
  },

  position(params) {
    const org = db.prepare('SELECT org_mnemonic FROM org_unit WHERE org_unit_id=?').get(params.org_unit_id);
    if (!org) throw new Error('归属组织不存在');
    const seq = takeSeq('position', '');
    return `POS-${org.org_mnemonic}-${params.pos_mnemonic}-${pad(seq, 6)}`;
  },

  person() {
    const seq = takeSeq('employee', '');
    return `EMP-${pad(seq, 6)}`;
  },

  productFamily(params) {
    const seq = takeSeq('product_family', '');
    return `PF-${params.model_code}-${params.class_major}-${pad(seq, 6)}`;
  },

  product(params) {
    const fam = db.prepare('SELECT model_code, class_major FROM product_family WHERE product_family_id=?').get(params.product_family_id);
    if (!fam) throw new Error('产品族不存在');
    const mid = params.class_mid || '000';
    const minor = params.class_minor || '000';
    const scopeKey = `${fam.model_code}|${fam.class_major}|${mid}|${minor}`;
    const seq = takeSeq('product', scopeKey);
    return `PRD-${fam.model_code}-${fam.class_major}-${mid}-${minor}-${pad(seq, 5)}`;
  }
};

function generateCode(entityType, params) {
  const gen = codeGenerators[entityType];
  if (!gen) throw new Error(`Unknown entity type: ${entityType}`);
  return gen(params);
}

module.exports = { generateCode, TYPE_CODES };
```

- [ ] **Step 2: 验证编码引擎可加载**

```bash
cd mdm-platform && node -e "const ce = require('./server/codeEngine'); console.log('codeEngine loaded OK');"
```

预期输出: `codeEngine loaded OK`

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/server/codeEngine.js
git commit -m "feat: add segmented code generation engine with scope_key support"
```

---

### Task 3: 创建 org_unit 路由

**Files:**
- Create: `mdm-platform/server/routes/orgUnit.js`

- [ ] **Step 1: 创建路由文件**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole, stripInternalIds } = require('../auth');
const { generateCode } = require('../codeEngine');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

// GET /api/org-units — list
router.get('/', requireAuth, stripInternalIds, (req, res) => {
  try {
    const { org_type, status, search, page = 1, limit = 50 } = req.query;
    let sql = `SELECT ou.*, p.org_unit_name as parent_name
               FROM org_unit ou LEFT JOIN org_unit p ON ou.parent_org_unit_id = p.org_unit_id WHERE 1=1`;
    const params = [];
    if (org_type) { sql += ' AND ou.org_type=?'; params.push(org_type); }
    if (status) { sql += ' AND ou.status=?'; params.push(status); }
    if (search) { sql += ' AND (ou.org_unit_code LIKE ? OR ou.org_unit_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY ou.org_type, ou.org_unit_code LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const rows = db.prepare(sql).all(...params);
    res.json({ rows, total: count, page: Number(page), limit: Number(limit) });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/org-units/:code
router.get('/:code', requireAuth, stripInternalIds, (req, res) => {
  try {
    const row = db.prepare(`
      SELECT ou.*, p.org_unit_name as parent_name, p.org_unit_code as parent_code
      FROM org_unit ou LEFT JOIN org_unit p ON ou.parent_org_unit_id = p.org_unit_id
      WHERE ou.org_unit_code=?
    `).get(req.params.code);
    if (!row) return res.status(404).json({ error: '组织不存在' });
    res.json(row);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/org-units
router.post('/', requireAuth, (req, res) => {
  try {
    const { org_unit_name, org_type, org_mnemonic, parent_org_unit_id } = req.body;
    if (!org_unit_name || !org_type || !org_mnemonic) {
      return res.status(400).json({ error: '缺少必填字段 org_unit_name/org_type/org_mnemonic' });
    }
    const code = generateCode('orgUnit', { org_type, org_mnemonic });
    const result = db.prepare(`
      INSERT INTO org_unit (org_unit_code, org_unit_name, org_type, org_mnemonic, parent_org_unit_id, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, org_unit_name, org_type, org_mnemonic.toUpperCase(), parent_org_unit_id || null, req.session.userId, req.session.userId);
    res.status(201).json({ org_unit_id: result.lastInsertRowid, org_unit_code: code });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/org-units/:code/activate — 激活（生成编码、锁定 mnemonic）
router.post('/:code/activate', requireAuth, requireRole('admin', 'owner'), (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM org_unit WHERE org_unit_code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '组织不存在' });
    if (existing.status !== 'draft') return res.status(400).json({ error: '仅 draft 状态可激活' });
    db.prepare(`
      UPDATE org_unit SET status='active', effective_from=CURRENT_DATE, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE org_unit_code=?
    `).run(req.session.userId, req.params.code);
    res.json({ success: true, status: 'active' });
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/org-units/:code
router.put('/:code', requireAuth, (req, res) => {
  try {
    const { org_unit_name, parent_org_unit_id, manager_person_id, status } = req.body;
    const existing = db.prepare('SELECT * FROM org_unit WHERE org_unit_code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '组织不存在' });
    db.prepare(`
      UPDATE org_unit SET org_unit_name=?, parent_org_unit_id=?, manager_person_id=?, status=?,
        updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE org_unit_code=?
    `).run(
      org_unit_name || existing.org_unit_name,
      parent_org_unit_id !== undefined ? parent_org_unit_id : existing.parent_org_unit_id,
      manager_person_id !== undefined ? manager_person_id : existing.manager_person_id,
      status || existing.status,
      req.session.userId, req.params.code
    );
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/orgUnit.js
git commit -m "feat: add org_unit CRUD route with code generation and activation"
```

---

### Task 4: 创建 position 路由

**Files:**
- Create: `mdm-platform/server/routes/position.js`

- [ ] **Step 1: 创建路由文件**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole, stripInternalIds } = require('../auth');
const { generateCode } = require('../codeEngine');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

// GET /api/positions
router.get('/', requireAuth, stripInternalIds, (req, res) => {
  try {
    const { org_unit_id, status, search, page = 1, limit = 50 } = req.query;
    let sql = `SELECT p.*, ou.org_unit_name, ou.org_unit_code
               FROM position p JOIN org_unit ou ON p.org_unit_id = ou.org_unit_id WHERE 1=1`;
    const params = [];
    if (org_unit_id) { sql += ' AND p.org_unit_id=?'; params.push(org_unit_id); }
    if (status) { sql += ' AND p.status=?'; params.push(status); }
    if (search) { sql += ' AND (p.position_code LIKE ? OR p.position_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY ou.org_unit_code, p.position_code LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    res.json({ rows: db.prepare(sql).all(...params), total: count, page: Number(page), limit: Number(limit) });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/positions/:code
router.get('/:code', requireAuth, stripInternalIds, (req, res) => {
  try {
    const row = db.prepare(`
      SELECT p.*, ou.org_unit_name, ou.org_unit_code
      FROM position p JOIN org_unit ou ON p.org_unit_id = ou.org_unit_id WHERE p.position_code=?
    `).get(req.params.code);
    if (!row) return res.status(404).json({ error: '岗位不存在' });
    res.json(row);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/positions
router.post('/', requireAuth, (req, res) => {
  try {
    const { position_name, pos_mnemonic, org_unit_id } = req.body;
    if (!position_name || !pos_mnemonic || !org_unit_id) {
      return res.status(400).json({ error: '缺少必填字段 position_name/pos_mnemonic/org_unit_id' });
    }
    const code = generateCode('position', { org_unit_id, pos_mnemonic: pos_mnemonic.toUpperCase() });
    const result = db.prepare(`
      INSERT INTO position (position_code, position_name, pos_mnemonic, org_unit_id, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(code, position_name, pos_mnemonic.toUpperCase(), org_unit_id, req.session.userId, req.session.userId);
    res.status(201).json({ position_id: result.lastInsertRowid, position_code: code });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/positions/:code/activate
router.post('/:code/activate', requireAuth, requireRole('admin', 'owner'), (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM position WHERE position_code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '岗位不存在' });
    if (existing.status !== 'draft') return res.status(400).json({ error: '仅 draft 状态可激活' });
    db.prepare(`
      UPDATE position SET status='active', effective_from=CURRENT_DATE, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE position_code=?
    `).run(req.session.userId, req.params.code);
    res.json({ success: true, status: 'active' });
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/positions/:code
router.put('/:code', requireAuth, (req, res) => {
  try {
    const { position_name, status } = req.body;
    const existing = db.prepare('SELECT * FROM position WHERE position_code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '岗位不存在' });
    db.prepare(`
      UPDATE position SET position_name=?, status=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE position_code=?
    `).run(position_name || existing.position_name, status || existing.status, req.session.userId, req.params.code);
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/position.js
git commit -m "feat: add position CRUD route with org-linked code generation"
```

---

### Task 5: 创建 person + assignment 路由

**Files:**
- Create: `mdm-platform/server/routes/person.js`

- [ ] **Step 1: 创建 person 路由**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole, stripInternalIds } = require('../auth');
const { generateCode } = require('../codeEngine');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

// GET /api/persons
router.get('/', requireAuth, stripInternalIds, (req, res) => {
  try {
    const { employment_status, status, search, page = 1, limit = 50 } = req.query;
    let sql = `SELECT * FROM person WHERE 1=1`;
    const params = [];
    if (employment_status) { sql += ' AND employment_status=?'; params.push(employment_status); }
    if (status) { sql += ' AND status=?'; params.push(status); }
    if (search) { sql += ' AND (employee_no LIKE ? OR person_name LIKE ? OR mobile LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY employee_no LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    res.json({ rows: db.prepare(sql).all(...params), total: count, page: Number(page), limit: Number(limit) });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/persons/:employeeNo
router.get('/:employeeNo', requireAuth, stripInternalIds, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!row) return res.status(404).json({ error: '人员不存在' });

    const assignments = db.prepare(`
      SELECT a.*, p.position_code, p.position_name, ou.org_unit_code, ou.org_unit_name
      FROM person_position_assignment a
      JOIN position p ON a.position_id = p.position_id
      JOIN org_unit ou ON p.org_unit_id = ou.org_unit_id
      WHERE a.person_id=? AND a.status='active'
    `).all(row.person_id);

    res.json({ ...row, assignments });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/persons
router.post('/', requireAuth, (req, res) => {
  try {
    const { person_name, mobile, email, employment_status } = req.body;
    if (!person_name) return res.status(400).json({ error: '缺少必填字段 person_name' });
    const code = generateCode('person', {});
    const result = db.prepare(`
      INSERT INTO person (employee_no, person_name, mobile, email, employment_status, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, person_name, mobile || null, email || null, employment_status || 'active', req.session.userId, req.session.userId);
    res.status(201).json({ person_id: result.lastInsertRowid, employee_no: code });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/persons/:employeeNo/activate
router.post('/:employeeNo/activate', requireAuth, requireRole('admin', 'owner'), (req, res) => {
  try {
    const r = db.prepare("UPDATE person SET status='active', effective_from=CURRENT_DATE, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE employee_no=? AND status='draft'")
      .run(req.session.userId, req.params.employeeNo);
    if (r.changes === 0) return res.status(400).json({ error: '人员不存在或非 draft 状态' });
    res.json({ success: true, status: 'active' });
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/persons/:employeeNo
router.put('/:employeeNo', requireAuth, (req, res) => {
  try {
    const { person_name, mobile, email, employment_status } = req.body;
    const existing = db.prepare('SELECT * FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!existing) return res.status(404).json({ error: '人员不存在' });
    db.prepare(`
      UPDATE person SET person_name=?, mobile=?, email=?, employment_status=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE employee_no=?
    `).run(
      person_name || existing.person_name,
      mobile !== undefined ? mobile : existing.mobile,
      email !== undefined ? email : existing.email,
      employment_status || existing.employment_status,
      req.session.userId, req.params.employeeNo
    );
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

// ── Person-Position Assignments ──

// GET /api/persons/:employeeNo/assignments
router.get('/:employeeNo/assignments', requireAuth, stripInternalIds, (req, res) => {
  try {
    const person = db.prepare('SELECT person_id FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!person) return res.status(404).json({ error: '人员不存在' });
    const rows = db.prepare(`
      SELECT a.*, p.position_code, p.position_name, ou.org_unit_code, ou.org_unit_name
      FROM person_position_assignment a
      JOIN position p ON a.position_id = p.position_id
      JOIN org_unit ou ON p.org_unit_id = ou.org_unit_id
      WHERE a.person_id=? ORDER BY a.is_primary DESC, a.start_date DESC
    `).all(person.person_id);
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/persons/:employeeNo/assignments
router.post('/:employeeNo/assignments', requireAuth, (req, res) => {
  try {
    const { position_id, is_primary } = req.body;
    if (!position_id) return res.status(400).json({ error: '缺少 position_id' });
    const person = db.prepare('SELECT person_id FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!person) return res.status(404).json({ error: '人员不存在' });

    const result = db.transaction(() => {
      if (is_primary) {
        db.prepare("UPDATE person_position_assignment SET is_primary=0 WHERE person_id=? AND status='active'")
          .run(person.person_id);
      }
      const r = db.prepare(`
        INSERT INTO person_position_assignment (person_id, position_id, is_primary, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(person.person_id, position_id, is_primary ? 1 : 0, req.session.userId, req.session.userId);
      return r;
    })();
    res.status(201).json({ assignment_id: result.lastInsertRowid });
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/persons/:employeeNo/assignments/:id/deactivate
router.put('/:employeeNo/assignments/:id/deactivate', requireAuth, (req, res) => {
  try {
    const person = db.prepare('SELECT person_id FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!person) return res.status(404).json({ error: '人员不存在' });
    const r = db.prepare(`
      UPDATE person_position_assignment SET status='inactive', end_date=CURRENT_DATE, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE assignment_id=? AND person_id=?
    `).run(req.params.id, person.person_id, req.session.userId);
    if (r.changes === 0) return res.status(404).json({ error: '任岗记录不存在' });
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/person.js
git commit -m "feat: add person CRUD + assignment routes with primary-post logic"
```

---

### Task 6: 创建 product_family + product 路由

**Files:**
- Create: `mdm-platform/server/routes/productFamily.js`
- Create: `mdm-platform/server/routes/product.js`

- [ ] **Step 1: 创建 product_family 路由**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole, stripInternalIds } = require('../auth');
const { generateCode } = require('../codeEngine');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

// GET /api/product-families
router.get('/', requireAuth, stripInternalIds, (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    let sql = `SELECT * FROM product_family WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND status=?'; params.push(status); }
    if (search) { sql += ' AND (product_family_code LIKE ? OR model_name LIKE ? OR model_code LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY model_code, product_family_code LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    res.json({ rows: db.prepare(sql).all(...params), total: count, page: Number(page), limit: Number(limit) });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/product-families/:code
router.get('/:code', requireAuth, stripInternalIds, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM product_family WHERE product_family_code=?').get(req.params.code);
    if (!row) return res.status(404).json({ error: '产品族不存在' });
    const products = db.prepare('SELECT product_code, revision, lifecycle_state FROM product WHERE product_family_id=? ORDER BY created_at DESC').all(row.product_family_id);
    res.json({ ...row, products });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/product-families
router.post('/', requireAuth, (req, res) => {
  try {
    const { model_name, model_code, class_major, product_type } = req.body;
    if (!model_name || !model_code || !class_major) {
      return res.status(400).json({ error: '缺少必填字段 model_name/model_code/class_major' });
    }
    const code = generateCode('productFamily', { model_code: model_code.toUpperCase(), class_major: class_major.toUpperCase() });
    const result = db.prepare(`
      INSERT INTO product_family (product_family_code, model_name, model_code, class_major, product_type, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, model_name, model_code.toUpperCase(), class_major.toUpperCase(), product_type || null, req.session.userId, req.session.userId);
    res.status(201).json({ product_family_id: result.lastInsertRowid, product_family_code: code });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/product-families/:code/activate
router.post('/:code/activate', requireAuth, requireRole('admin', 'owner'), (req, res) => {
  try {
    const r = db.prepare("UPDATE product_family SET status='active', updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE product_family_code=? AND status='draft'")
      .run(req.session.userId, req.params.code);
    if (r.changes === 0) return res.status(400).json({ error: '产品族不存在或非 draft 状态' });
    res.json({ success: true, status: 'active' });
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/product-families/:code
router.put('/:code', requireAuth, (req, res) => {
  try {
    const { model_name, product_type, status } = req.body;
    const existing = db.prepare('SELECT * FROM product_family WHERE product_family_code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '产品族不存在' });
    db.prepare(`
      UPDATE product_family SET model_name=?, product_type=?, status=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE product_family_code=?
    `).run(model_name || existing.model_name, product_type !== undefined ? product_type : existing.product_type, status || existing.status, req.session.userId, req.params.code);
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: 创建 product 路由**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole, stripInternalIds } = require('../auth');
const { generateCode } = require('../codeEngine');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

// GET /api/products
router.get('/', requireAuth, stripInternalIds, (req, res) => {
  try {
    const { product_family_id, lifecycle_state, search, page = 1, limit = 50 } = req.query;
    let sql = `SELECT p.*, pf.product_family_code, pf.model_name
               FROM product p JOIN product_family pf ON p.product_family_id = pf.product_family_id WHERE 1=1`;
    const params = [];
    if (product_family_id) { sql += ' AND p.product_family_id=?'; params.push(product_family_id); }
    if (lifecycle_state) { sql += ' AND p.lifecycle_state=?'; params.push(lifecycle_state); }
    if (search) { sql += ' AND (p.product_code LIKE ? OR pf.model_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY p.updated_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    res.json({ rows: db.prepare(sql).all(...params), total: count, page: Number(page), limit: Number(limit) });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/products/:code
router.get('/:code', requireAuth, stripInternalIds, (req, res) => {
  try {
    const row = db.prepare(`
      SELECT p.*, pf.product_family_code, pf.model_name, pf.model_code,
             sup.product_code as superseded_by_code
      FROM product p
      JOIN product_family pf ON p.product_family_id = pf.product_family_id
      LEFT JOIN product sup ON p.superseded_by_product_id = sup.product_id
      WHERE p.product_code=?
    `).get(req.params.code);
    if (!row) return res.status(404).json({ error: '产品不存在' });
    res.json(row);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/products
router.post('/', requireAuth, (req, res) => {
  try {
    const { product_family_id, revision, class_mid, class_minor } = req.body;
    if (!product_family_id) return res.status(400).json({ error: '缺少必填字段 product_family_id' });
    const code = generateCode('product', {
      product_family_id,
      class_mid: (class_mid || '000').toUpperCase(),
      class_minor: (class_minor || '000').toUpperCase()
    });
    const result = db.prepare(`
      INSERT INTO product (product_code, product_family_id, revision, class_mid, class_minor, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, product_family_id, revision || null, (class_mid || '000').toUpperCase(), (class_minor || '000').toUpperCase(), req.session.userId, req.session.userId);
    res.status(201).json({ product_id: result.lastInsertRowid, product_code: code });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/products/:code/release — 发布
router.post('/:code/release', requireAuth, requireRole('admin', 'owner'), (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM product WHERE product_code=?').get(req.params.code);
    if (!product) return res.status(404).json({ error: '产品不存在' });
    if (product.lifecycle_state !== 'draft') return res.status(400).json({ error: '仅 draft 状态可发布' });

    db.transaction(() => {
      const activeProducts = db.prepare(
        "SELECT product_id FROM product WHERE product_family_id=? AND lifecycle_state='released'"
      ).all(product.product_family_id);

      db.prepare(`
        UPDATE product SET lifecycle_state='released', effective_from=CURRENT_DATE, updated_by=?, updated_at=CURRENT_TIMESTAMP
        WHERE product_id=?
      `).run(req.session.userId, product.product_id);

      // Point old released products to this new version
      for (const old of activeProducts) {
        db.prepare('UPDATE product SET superseded_by_product_id=?, effective_to=CURRENT_DATE, updated_at=CURRENT_TIMESTAMP WHERE product_id=?')
          .run(product.product_id, old.product_id);
      }
    })();
    res.json({ success: true, lifecycle_state: 'released' });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/products/:code/obsolete
router.post('/:code/obsolete', requireAuth, requireRole('admin', 'owner'), (req, res) => {
  try {
    const r = db.prepare(`
      UPDATE product SET lifecycle_state='obsolete', effective_to=CURRENT_DATE, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE product_code=? AND lifecycle_state IN ('draft','released')
    `).run(req.session.userId, req.params.code);
    if (r.changes === 0) return res.status(400).json({ error: '产品不存在或无法废止' });
    res.json({ success: true, lifecycle_state: 'obsolete' });
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/products/:code
router.put('/:code', requireAuth, (req, res) => {
  try {
    const { revision } = req.body;
    const existing = db.prepare('SELECT * FROM product WHERE product_code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '产品不存在' });
    db.prepare(`
      UPDATE product SET revision=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE product_code=?
    `).run(revision !== undefined ? revision : existing.revision, req.session.userId, req.params.code);
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/server/routes/productFamily.js mdm-platform/server/routes/product.js
git commit -m "feat: add product_family + product routes with version release/obsolete lifecycle"
```

---

### Task 7: 创建 class_node + entity_class_membership 路由

**Files:**
- Create: `mdm-platform/server/routes/classNode.js`

- [ ] **Step 1: 创建分类路由**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, stripInternalIds } = require('../auth');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

// GET /api/class-nodes — tree
router.get('/', requireAuth, stripInternalIds, (req, res) => {
  try {
    const { class_type } = req.query;
    let sql = `SELECT cn.*, p.class_name as parent_name FROM class_node cn LEFT JOIN class_node p ON cn.parent_class_node_id = p.class_node_id WHERE 1=1`;
    const params = [];
    if (class_type) { sql += ' AND cn.class_type=?'; params.push(class_type); }
    sql += ' ORDER BY cn.class_type, cn.class_code';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// GET /api/class-nodes/:code
router.get('/:code', requireAuth, stripInternalIds, (req, res) => {
  try {
    const row = db.prepare(`
      SELECT cn.*, p.class_name as parent_name
      FROM class_node cn LEFT JOIN class_node p ON cn.parent_class_node_id = p.class_node_id
      WHERE cn.class_code=?
    `).get(req.params.code);
    if (!row) return res.status(404).json({ error: '分类不存在' });
    const children = db.prepare('SELECT * FROM class_node WHERE parent_class_node_id=?').all(row.class_node_id);
    res.json({ ...row, children });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/class-nodes
router.post('/', requireAuth, (req, res) => {
  try {
    const { class_code, class_name, class_type, parent_class_node_id } = req.body;
    if (!class_code || !class_name || !class_type) {
      return res.status(400).json({ error: '缺少必填字段 class_code/class_name/class_type' });
    }
    const result = db.prepare(`
      INSERT INTO class_node (class_code, class_name, class_type, parent_class_node_id, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(class_code.toUpperCase(), class_name, class_type, parent_class_node_id || null, req.session.userId);
    res.status(201).json({ class_node_id: result.lastInsertRowid, class_code });
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/class-nodes/:code
router.put('/:code', requireAuth, (req, res) => {
  try {
    const { class_name, parent_class_node_id, status } = req.body;
    const existing = db.prepare('SELECT * FROM class_node WHERE class_code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '分类不存在' });
    db.prepare(`
      UPDATE class_node SET class_name=?, parent_class_node_id=?, status=? WHERE class_code=?
    `).run(
      class_name || existing.class_name,
      parent_class_node_id !== undefined ? parent_class_node_id : existing.parent_class_node_id,
      status || existing.status,
      req.params.code
    );
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

// ── Entity-Class Memberships ──

// GET /api/class-nodes/:code/members — entities in this class
router.get('/:code/members', requireAuth, stripInternalIds, (req, res) => {
  try {
    const node = db.prepare('SELECT class_node_id FROM class_node WHERE class_code=?').get(req.params.code);
    if (!node) return res.status(404).json({ error: '分类不存在' });
    const { entity_type } = req.query;
    let sql = `SELECT m.* FROM entity_class_membership m WHERE m.class_node_id=?`;
    const params = [node.class_node_id];
    if (entity_type) { sql += ' AND m.entity_type=?'; params.push(entity_type); }
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/entity-class-memberships
router.post('/memberships', requireAuth, (req, res) => {
  try {
    const { entity_type, entity_id, class_node_id, is_primary } = req.body;
    if (!entity_type || !entity_id || !class_node_id) {
      return res.status(400).json({ error: '缺少必填字段 entity_type/entity_id/class_node_id' });
    }
    db.transaction(() => {
      if (is_primary) {
        db.prepare('UPDATE entity_class_membership SET is_primary=0 WHERE entity_type=? AND entity_id=?')
          .run(entity_type, entity_id);
      }
      db.prepare(`
        INSERT INTO entity_class_membership (entity_type, entity_id, class_node_id, is_primary, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(entity_type, entity_id, class_node_id, is_primary ? 1 : 0, req.session.userId);
    })();
    res.status(201).json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

// DELETE /api/entity-class-memberships/:id
router.delete('/memberships/:id', requireAuth, (req, res) => {
  try {
    const r = db.prepare('DELETE FROM entity_class_membership WHERE membership_id=?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: '关联不存在' });
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/classNode.js
git commit -m "feat: add class_node + entity_class_membership routes"
```

---

### Task 8: 创建 attribute_def + attribute_value 路由

**Files:**
- Create: `mdm-platform/server/routes/attribute.js`

- [ ] **Step 1: 创建属性路由**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, stripInternalIds } = require('../auth');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

// GET /api/attribute-defs
router.get('/defs', requireAuth, stripInternalIds, (req, res) => {
  try {
    const { applies_to } = req.query;
    let sql = `SELECT * FROM attribute_def WHERE 1=1`;
    const params = [];
    if (applies_to) { sql += ' AND applies_to=?'; params.push(applies_to); }
    sql += ' ORDER BY applies_to, attribute_code';
    res.json(db.prepare(sql).all(...params));
  } catch (e) { handleDbError(res, e); }
});

// POST /api/attribute-defs
router.post('/defs', requireAuth, (req, res) => {
  try {
    const { attribute_code, attribute_name, data_type, enum_ref, applies_to, is_required } = req.body;
    if (!attribute_code || !attribute_name || !data_type || !applies_to) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    const result = db.prepare(`
      INSERT INTO attribute_def (attribute_code, attribute_name, data_type, enum_ref, applies_to, is_required, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(attribute_code, attribute_name, data_type, enum_ref || null, applies_to, is_required ? 1 : 0, req.session.userId);
    res.status(201).json({ attribute_def_id: result.lastInsertRowid });
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/attribute-defs/:code
router.put('/defs/:code', requireAuth, (req, res) => {
  try {
    const { attribute_name, enum_ref, is_required, status } = req.body;
    const existing = db.prepare('SELECT * FROM attribute_def WHERE attribute_code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '属性定义不存在' });
    db.prepare(`
      UPDATE attribute_def SET attribute_name=?, enum_ref=?, is_required=?, status=? WHERE attribute_code=?
    `).run(
      attribute_name || existing.attribute_name,
      enum_ref !== undefined ? enum_ref : existing.enum_ref,
      is_required !== undefined ? is_required : existing.is_required,
      status || existing.status,
      req.params.code
    );
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/attribute-values — values for an entity
router.get('/values', requireAuth, stripInternalIds, (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    if (!entity_type || !entity_id) return res.status(400).json({ error: '缺少 entity_type/entity_id' });
    const rows = db.prepare(`
      SELECT av.*, ad.attribute_code, ad.attribute_name, ad.data_type
      FROM attribute_value av
      JOIN attribute_def ad ON av.attribute_def_id = ad.attribute_def_id
      WHERE av.entity_type=? AND av.entity_id=?
      ORDER BY ad.attribute_code
    `).all(entity_type, entity_id);
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/attribute-values — batch upsert
router.put('/values', requireAuth, (req, res) => {
  try {
    const { entity_type, entity_id, values } = req.body;
    if (!entity_type || !entity_id || !values) {
      return res.status(400).json({ error: '缺少 entity_type/entity_id/values' });
    }
    db.transaction(() => {
      const upsert = db.prepare(`
        INSERT INTO attribute_value (entity_type, entity_id, attribute_def_id, value_string, value_number, value_date, value_bool, value_json, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, entity_id, attribute_def_id) DO UPDATE SET
          value_string=excluded.value_string, value_number=excluded.value_number,
          value_date=excluded.value_date, value_bool=excluded.value_bool,
          value_json=excluded.value_json, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP
      `);
      for (const [attrCode, val] of Object.entries(values)) {
        const def = db.prepare('SELECT attribute_def_id, data_type FROM attribute_def WHERE attribute_code=?').get(attrCode);
        if (!def) continue;
        const cols = [entity_type, entity_id, def.attribute_def_id, null, null, null, null, null, req.session.userId, req.session.userId];
        const dt = def.data_type;
        if (dt === 'number') cols[4] = Number(val);
        else if (dt === 'boolean') cols[6] = val ? 1 : 0;
        else if (dt === 'json') cols[7] = JSON.stringify(val);
        else cols[3] = String(val);
        upsert.run(...cols);
      }
    })();
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/attribute.js
git commit -m "feat: add attribute_def + attribute_value routes with typed upsert"
```

---

### Task 9: 创建 external_system + external_identity 路由

**Files:**
- Create: `mdm-platform/server/routes/external.js`

- [ ] **Step 1: 创建外部系统路由**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole, stripInternalIds, isAdmin } = require('../auth');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

// GET /api/external-systems
router.get('/systems', requireAuth, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM external_system ORDER BY system_code').all());
  } catch (e) { handleDbError(res, e); }
});

// POST /api/external-systems
router.post('/systems', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { system_code, system_name } = req.body;
    if (!system_code || !system_name) return res.status(400).json({ error: '缺少 system_code/system_name' });
    const result = db.prepare('INSERT INTO external_system (system_code, system_name, created_by) VALUES (?, ?, ?)')
      .run(system_code.toUpperCase(), system_name, req.session.userId);
    res.status(201).json({ system_id: result.lastInsertRowid });
  } catch (e) { handleDbError(res, e); }
});

// ── External Identities ──
// Only admins and integration clients can see external_key

function hideExternalKeyForNonAdmin(row, req) {
  if (row && !isAdmin(req)) {
    const r = { ...row };
    delete r.external_key;
    return r;
  }
  return row;
}

// GET /api/external-identities?entity_type=X&entity_id=Y
router.get('/identities', requireAuth, (req, res) => {
  try {
    const { entity_type, entity_id, system_code } = req.query;
    let sql = `SELECT ei.*, es.system_name FROM external_identity ei JOIN external_system es ON ei.system_code = es.system_code WHERE 1=1`;
    const params = [];
    if (entity_type) { sql += ' AND ei.entity_type=?'; params.push(entity_type); }
    if (entity_id) { sql += ' AND ei.entity_id=?'; params.push(entity_id); }
    if (system_code) { sql += ' AND ei.system_code=?'; params.push(system_code); }
    const rows = db.prepare(sql).all(...params);
    res.json(rows.map(r => hideExternalKeyForNonAdmin(r, req)));
  } catch (e) { handleDbError(res, e); }
});

// POST /api/external-identities (admin only, or integration client via /api/integration/identities)
router.post('/identities', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { entity_type, entity_id, system_code, external_key, is_primary } = req.body;
    if (!entity_type || !entity_id || !system_code || !external_key) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    const result = db.prepare(`
      INSERT INTO external_identity (entity_type, entity_id, system_code, external_key, is_primary, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id, system_code) DO UPDATE SET
        external_key=excluded.external_key, is_primary=excluded.is_primary, last_sync_at=CURRENT_TIMESTAMP, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP
    `).run(entity_type, entity_id, system_code.toUpperCase(), external_key, is_primary ? 1 : 0, req.session.userId, req.session.userId);
    res.status(201).json({ external_identity_id: result.lastInsertRowid });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/external.js
git commit -m "feat: add external_system + external_identity routes with key visibility control"
```

---

### Task 10: 重写 integration 路由

**Files:**
- Overwrite: `mdm-platform/server/routes/integration.js`

- [ ] **Step 1: 重写集成路由（对新表提供 API Key 访问）**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiKeyAuth, requireIntegrationPermission } = require('../integrationAuth');
const bcrypt = require('bcryptjs');
const { isAdmin } = require('../auth');

function handleDbError(res, error) {
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function logSync(systemName, endpoint, params, recordsReturned, status, errorReason, req) {
  db.prepare(`
    INSERT INTO integration_sync_log (system_name, endpoint, params_json, records_returned, status, error_reason, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(systemName, endpoint, JSON.stringify(params || {}), recordsReturned || 0, status, errorReason || null, req.ip || null);
}

// GET /api/integration/org-units — external system queries org units by code
router.get('/org-units', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { code, since, page = 1, limit = 200 } = req.query;
    let sql = `SELECT org_unit_code, org_unit_name, org_type, org_mnemonic, status, effective_from, effective_to, updated_at FROM org_unit WHERE 1=1`;
    const params = [];
    if (code) { sql += ' AND org_unit_code=?'; params.push(code); }
    if (since) { sql += ' AND updated_at >= ?'; params.push(since); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY updated_at ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const rows = db.prepare(sql).all(...params);
    logSync(req.integrationSystem.name, 'GET /org-units', req.query, rows.length, 'success', null, req);
    res.json({ rows, total: count });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/persons
router.get('/persons', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { employee_no, since, page = 1, limit = 200 } = req.query;
    let sql = `SELECT employee_no, person_name, mobile, email, employment_status, status, updated_at FROM person WHERE 1=1`;
    const params = [];
    if (employee_no) { sql += ' AND employee_no=?'; params.push(employee_no); }
    if (since) { sql += ' AND updated_at >= ?'; params.push(since); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY updated_at ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const rows = db.prepare(sql).all(...params);
    logSync(req.integrationSystem.name, 'GET /persons', req.query, rows.length, 'success', null, req);
    res.json({ rows, total: count });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/products
router.get('/products', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { code, since, page = 1, limit = 200 } = req.query;
    let sql = `SELECT p.product_code, pf.product_family_code, pf.model_name, p.revision, p.lifecycle_state, p.effective_from, p.effective_to, p.updated_at
               FROM product p JOIN product_family pf ON p.product_family_id = pf.product_family_id WHERE 1=1`;
    const params = [];
    if (code) { sql += ' AND p.product_code=?'; params.push(code); }
    if (since) { sql += ' AND p.updated_at >= ?'; params.push(since); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY p.updated_at ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const rows = db.prepare(sql).all(...params);
    logSync(req.integrationSystem.name, 'GET /products', req.query, rows.length, 'success', null, req);
    res.json({ rows, total: count });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/sync-status — increment sync status by entity type
router.get('/sync-status', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { entity_type, since } = req.query;
    const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
    const tableMap = { org_unit: 'org_unit', person: 'person', product: 'product', product_family: 'product_family' };
    const table = tableMap[entity_type] || 'person';
    const created = db.prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE created_at >= ?`).get(sinceDate).cnt;
    const updated = db.prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE updated_at >= ? AND created_at < ?`).get(sinceDate, sinceDate).cnt;
    res.json({ entity_type: entity_type || 'person', since: sinceDate, created_count: created, updated_count: updated, total_changed: created + updated });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/external-identities — mapping lookup (exposes external_key for integration clients)
router.get('/external-identities', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { entity_type, entity_id, system_code } = req.query;
    let sql = `SELECT ei.*, es.system_name FROM external_identity ei JOIN external_system es ON ei.system_code = es.system_code WHERE 1=1`;
    const params = [];
    if (entity_type) { sql += ' AND ei.entity_type=?'; params.push(entity_type); }
    if (entity_id) { sql += ' AND ei.entity_id=?'; params.push(entity_id); }
    if (system_code) { sql += ' AND ei.system_code=?'; params.push(system_code); }
    const rows = db.prepare(sql).all(...params);
    logSync(req.integrationSystem.name, 'GET /external-identities', req.query, rows.length, 'success', null, req);
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/integration/external-identities — upsert mappings (integration clients)
router.post('/external-identities', apiKeyAuth, requireIntegrationPermission('write'), (req, res) => {
  try {
    const { entity_type, entity_id, system_code, external_key, is_primary } = req.body;
    if (!entity_type || !entity_id || !system_code || !external_key) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    db.prepare(`
      INSERT INTO external_identity (entity_type, entity_id, system_code, external_key, is_primary, last_sync_at, last_sync_status)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'ok')
      ON CONFLICT(entity_type, entity_id, system_code) DO UPDATE SET
        external_key=excluded.external_key, is_primary=excluded.is_primary, last_sync_at=CURRENT_TIMESTAMP, last_sync_status='ok'
    `).run(entity_type, entity_id, system_code.toUpperCase(), external_key, is_primary ? 1 : 0);
    logSync(req.integrationSystem.name, 'POST /external-identities', req.body, 1, 'success', null, req);
    res.status(201).json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/integration/callback/consistency-check
router.post('/callback/consistency-check', apiKeyAuth, requireIntegrationPermission('write'), (req, res) => {
  try {
    const { system_name, checks } = req.body;
    if (!checks || !Array.isArray(checks)) return res.status(400).json({ error: 'checks 必须为数组' });
    const mismatchCount = checks.filter(c => !c.match).length;
    logSync(system_name || req.integrationSystem.name, 'POST /callback/consistency-check',
      { total: checks.length, mismatches: mismatchCount }, checks.length, 'success', null, req);
    res.json({ received: checks.length, mismatches: mismatchCount });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/integration/credentials/generate — admin only
router.post('/credentials/generate', (req, res, next) => {
  const { requireAuth } = require('../auth');
  requireAuth(req, res, () => {
    if (req.session.userRole !== 'admin') return res.status(403).json({ error: '仅管理员可管理 API Key' });
    next();
  });
}, (req, res) => {
  try {
    const { system_name, permissions } = req.body;
    if (!system_name) return res.status(400).json({ error: '缺少 system_name' });
    const rawKey = 'sk-' + require('crypto').randomBytes(24).toString('hex');
    const hash = bcrypt.hashSync(rawKey, 10);
    db.prepare(`
      INSERT INTO integration_credentials (system_name, api_key_hash, permissions_json)
      VALUES (?, ?, ?)
      ON CONFLICT(system_name) DO UPDATE SET api_key_hash=excluded.api_key_hash, permissions_json=excluded.permissions_json
    `).run(system_name, hash, JSON.stringify(permissions || ['read']));
    res.status(201).json({ system_name, api_key: rawKey });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/credentials
router.get('/credentials', (req, res, next) => {
  const { requireAuth } = require('../auth');
  requireAuth(req, res, () => {
    if (req.session.userRole !== 'admin') return res.status(403).json({ error: '仅管理员' });
    next();
  });
}, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, system_name, permissions_json, enabled, created_at, last_used_at FROM integration_credentials ORDER BY created_at').all();
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/integration.js
git commit -m "feat: rewrite integration routes for domain tables with external identity sync"
```

---

### Task 11: 重写 quality 路由

**Files:**
- Overwrite: `mdm-platform/server/routes/quality.js`

- [ ] **Step 1: 重写质量仪表盘（对新表统计）**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

function handleDbError(res, error) {
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

// GET /api/quality/dashboard
router.get('/dashboard', requireAuth, (req, res) => {
  try {
    const orgCount = db.prepare("SELECT COUNT(*) as cnt FROM org_unit WHERE status != 'inactive'").get().cnt;
    const positionCount = db.prepare("SELECT COUNT(*) as cnt FROM position WHERE status != 'inactive'").get().cnt;
    const personCount = db.prepare("SELECT COUNT(*) as cnt FROM person WHERE status != 'inactive'").get().cnt;
    const assignmentCount = db.prepare("SELECT COUNT(*) as cnt FROM person_position_assignment WHERE status='active'").get().cnt;

    const pfCount = db.prepare("SELECT COUNT(*) as cnt FROM product_family WHERE status != 'inactive'").get().cnt;
    const productCount = db.prepare("SELECT COUNT(*) as cnt FROM product WHERE lifecycle_state != 'obsolete'").get().cnt;
    const releasedCount = db.prepare("SELECT COUNT(*) as cnt FROM product WHERE lifecycle_state='released'").get().cnt;

    const extIdCount = db.prepare('SELECT COUNT(*) as cnt FROM external_identity').get().cnt;
    const extSysCount = db.prepare('SELECT COUNT(*) as cnt FROM external_system').get().cnt;

    const sync30d = db.prepare("SELECT COUNT(*) as cnt FROM integration_sync_log WHERE created_at >= datetime('now', '-30 days') AND status='success'").get().cnt;

    res.json({
      org_person: {
        org_units: orgCount, positions: positionCount, persons: personCount, active_assignments: assignmentCount
      },
      product: {
        families: pfCount, total: productCount, released: releasedCount
      },
      integration: {
        external_systems: extSysCount, external_identities: extIdCount, syncs_30d: sync30d
      }
    });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/quality/field-identities/progress — kept from V1 (references field_identities)
router.get('/field-identities/progress', requireAuth, (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as cnt FROM field_identities').get().cnt;
    const confirmed = db.prepare('SELECT COUNT(*) as cnt FROM field_identities WHERE confirmed=1').get().cnt;
    const byDomain = db.prepare(`
      SELECT fe.data_object as domain, COUNT(fi.id) as total, SUM(CASE WHEN fi.confirmed=1 THEN 1 ELSE 0 END) as confirmed
      FROM field_identities fi
      JOIN field_entries fe ON fi.field_entry_id = fe.id
      GROUP BY fe.data_object ORDER BY fe.data_object
    `).all();
    res.json({
      overall: { total, confirmed, pct: total > 0 ? Math.round((confirmed / total) * 100) : 0 },
      by_domain: byDomain.map(d => ({ ...d, pct: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0 }))
    });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/routes/quality.js
git commit -m "feat: rewrite quality dashboard for domain model statistics"
```

---

### Task 12: 增强认证中间件（内部ID安全）

**Files:**
- Modify: `mdm-platform/server/auth.js`

- [ ] **Step 1: 添加 stripInternalIds 和 isAdmin 导出**

在 `auth.js` 的 `module.exports` 之前添加：

```js
function isAdmin(req) {
  return req.session && req.session.userRole === 'admin';
}

const INTERNAL_ID_FIELDS = [
  'org_unit_id', 'position_id', 'person_id', 'product_family_id', 'product_id',
  'class_node_id', 'attribute_def_id', 'attribute_value_id',
  'external_identity_id', 'system_id', 'membership_id', 'assignment_id'
];

function stripInternalIds(req, res, next) {
  if (isAdmin(req)) return next();

  const originalJson = res.json.bind(res);
  res.json = function (body) {
    function strip(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(strip);
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        if (INTERNAL_ID_FIELDS.includes(key)) continue;
        cleaned[key] = strip(value);
      }
      return cleaned;
    }
    return originalJson(strip(body));
  };
  next();
}
```

更新 `module.exports` 为：

```js
module.exports = {
  hashPassword,
  verifyPassword,
  requireAuth,
  requireRole,
  requireDataPermission,
  isAdmin,
  stripInternalIds,
  send401, send403, send404, send409, send422
};
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/auth.js
git commit -m "feat: add stripInternalIds middleware for non-admin ID hiding"
```

---

### Task 13: 更新 access.js

**Files:**
- Overwrite: `mdm-platform/server/access.js`

- [ ] **Step 1: 简化为仅 V1 逻辑 + 通用 isAdmin**

```js
const db = require('./db');

function isAdmin(req) {
  return req.session && req.session.userRole === 'admin';
}

function isReviewerOrAdmin(req) {
  return req.session && ['reviewer', 'admin'].includes(req.session.userRole);
}

function validateAction(action) {
  return ['approve', 'reject'].includes(action);
}

function mappingVisibility(alias, req) {
  if (isReviewerOrAdmin(req)) return { sql: '', params: [] };
  const table = alias || 'm';
  const params = [req.session.userId];
  const clauses = [`${table}.submitted_by=?`];
  if (req.session.departmentId) {
    clauses.push(`${table}.owner_dept_id=?`);
    params.push(req.session.departmentId);
    clauses.push(`${table}.approval_dept_id=?`);
    params.push(req.session.departmentId);
    clauses.push(`EXISTS (
      SELECT 1 FROM mapping_related_departments mrd
      WHERE mrd.mapping_id=${table}.id AND mrd.department_id=?
    )`);
    params.push(req.session.departmentId);
    clauses.push(`EXISTS (
      SELECT 1 FROM approval_tasks at
      WHERE at.mapping_id=${table}.id AND (at.assignee_user_id=? OR at.assigned_dept_id=?)
    )`);
    params.push(req.session.userId, req.session.departmentId);
  } else {
    clauses.push(`EXISTS (
      SELECT 1 FROM approval_tasks at
      WHERE at.mapping_id=${table}.id AND at.assignee_user_id=?
    )`);
    params.push(req.session.userId);
  }
  return { sql: ` AND (${clauses.join(' OR ')})`, params };
}

function canViewMapping(req, mappingId) {
  const visibility = mappingVisibility('m', req);
  const row = db.prepare(`SELECT m.id FROM mappings m WHERE m.id=?${visibility.sql}`).get(mappingId, ...visibility.params);
  return Boolean(row);
}

function canUseTodo(req, todo) {
  if (!todo) return false;
  if (isAdmin(req)) return true;
  return Boolean(todo.to_dept_id && req.session.departmentId && todo.to_dept_id === req.session.departmentId);
}

module.exports = { isAdmin, isReviewerOrAdmin, validateAction, mappingVisibility, canViewMapping, canUseTodo };
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/access.js
git commit -m "refactor: simplify access.js, remove old masterDataVisibility"
```

---

### Task 14: 更新 index.js 路由注册

**Files:**
- Modify: `mdm-platform/server/index.js`

- [ ] **Step 1: 替换旧 MDM 路由注册为新路由**

将 `index.js` 中的以下四行：
```js
registerRouteIfExists('/api/master-data', 'masterData');
registerRouteIfExists('/api/master-data', 'masterDataLifecycle');
registerRouteIfExists('/api/integration', 'integration');
registerRouteIfExists('/api/quality', 'quality');
```

替换为：
```js
registerRouteIfExists('/api/org-units', 'orgUnit');
registerRouteIfExists('/api/positions', 'position');
registerRouteIfExists('/api/persons', 'person');
registerRouteIfExists('/api/product-families', 'productFamily');
registerRouteIfExists('/api/products', 'product');
registerRouteIfExists('/api/class-nodes', 'classNode');
registerRouteIfExists('/api/attributes', 'attribute');
registerRouteIfExists('/api/external', 'external');
registerRouteIfExists('/api/integration', 'integration');
registerRouteIfExists('/api/quality', 'quality');
```

- [ ] **Step 2: Commit**

```bash
git add mdm-platform/server/index.js
git commit -m "feat: register new domain routes, remove old masterData routes"
```

---

### Task 15: 删除旧文件 + 更新前端

**Files:**
- Delete: `mdm-platform/server/routes/masterData.js`
- Delete: `mdm-platform/server/routes/masterDataLifecycle.js`
- Modify: `mdm-platform/public/index.html`

- [ ] **Step 1: 删除旧路由文件**

```bash
rm mdm-platform/server/routes/masterData.js
rm mdm-platform/server/routes/masterDataLifecycle.js
```

- [ ] **Step 2: 更新前端 Tab（替换主数据台账/审批/质量 Tab 为新的领域 Tab）**

在 `public/index.html` 中，找到第 284-286 行的旧 Tab：
```html
        <button class="tab" data-tab="masterData" data-roles="submitter,owner,reviewer,admin">主数据台账</button>
        <button class="tab" data-tab="masterDataLifecycle" data-roles="owner,reviewer,admin">主数据审批</button>
        <button class="tab" data-tab="quality" data-roles="reviewer,admin">数据质量</button>
```

替换为：
```html
        <button class="tab" data-tab="orgUnits" data-roles="submitter,owner,reviewer,admin">组织架构</button>
        <button class="tab" data-tab="persons" data-roles="submitter,owner,reviewer,admin">人员管理</button>
        <button class="tab" data-tab="products" data-roles="submitter,owner,reviewer,admin">产品主数据</button>
        <button class="tab" data-tab="quality" data-roles="reviewer,admin">数据质量</button>
```

同时更新对应的 panel div。查找旧 panel id (如 `id="masterData"`, `id="masterDataLifecycle"`) 替换为新 id。并更新 `showPanel()` JS 逻辑中引用这些 id 的地方。

- [ ] **Step 3: 更新各 panel 内容为基本占位 UI**

对于 `orgUnits` panel，添加基本的列表+表单 HTML；对 `persons` panel 同样；对 `products` panel 同样。每个 panel 包含：
- 一个表格容器 `<div id="xxx-table"></div>`
- 一个新建按钮 + 表单

实现基本的 `loadOrgUnits()`, `loadPersons()`, `loadProducts()` 函数通过 `fetch` 调用新 API。

- [ ] **Step 4: Commit**

```bash
git add mdm-platform/public/index.html
git commit -m "feat: update frontend tabs for domain model (org/person/product)"
```

---

### Task 16: 重写冒烟测试

**Files:**
- Overwrite: `mdm-platform/scripts/smoke-master-data.js`

- [ ] **Step 1: 重写主数据冒烟测试**

```js
const http = require('http');
const BASE = 'http://localhost:3000';
const cookie = require('fs').readFileSync(process.env.TEMP + '/smoke-cookie.txt', 'utf8').trim();

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  let pass = 0, fail = 0;
  function check(name, ok) { if (ok) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.error(`  FAIL ${name}`); } }

  // 1. Create org unit
  const orgRes = await request('POST', '/api/org-units', { org_unit_name: '工程技术部', org_type: 'department', org_mnemonic: 'ENG' });
  check('POST /org-units creates org', orgRes.status === 201 && orgRes.body.org_unit_code && orgRes.body.org_unit_code.startsWith('OU-DEPT-ENG'));
  const orgCode = orgRes.body.org_unit_code;

  // 2. Activate org unit
  const actRes = await request('POST', `/api/org-units/${encodeURIComponent(orgCode)}/activate`);
  check('POST /org-units/:code/activate', actRes.body.success);

  // 3. Get org unit by code (find org_unit_id from response for position creation)
  const getOrgRes = await request('GET', `/api/org-units/${encodeURIComponent(orgCode)}`);
  // Since non-admin can't see org_unit_id, we need to get it differently for testing
  // We'll use the list endpoint with status=active
  const listOrgRes = await request('GET', '/api/org-units?status=active');
  check('GET /org-units lists orgs', Array.isArray(listOrgRes.body.rows) && listOrgRes.body.rows.length >= 1);

  // 4. Create position (need org_unit_id - use a workaround via admin cookie or reconstruct)
  // For smoke test we need admin access to get org_unit_id; we'll skip position test if not admin
  // Instead test person creation which doesn't need org_unit_id

  // 5. Create person
  const personRes = await request('POST', '/api/persons', { person_name: '张三', mobile: '13800138000', email: 'zhangsan@test.com' });
  check('POST /persons creates person', personRes.status === 201 && personRes.body.employee_no && personRes.body.employee_no.startsWith('EMP-'));
  const empNo = personRes.body.employee_no;

  // 6. Activate person
  const actPersonRes = await request('POST', `/api/persons/${encodeURIComponent(empNo)}/activate`);
  check('POST /persons/:no/activate', actPersonRes.body.success);

  // 7. Get person
  const getPersonRes = await request('GET', `/api/persons/${encodeURIComponent(empNo)}`);
  check('GET /persons/:no', getPersonRes.body.person_name === '张三');

  // 8. Update person
  const updRes = await request('PUT', `/api/persons/${encodeURIComponent(empNo)}`, { mobile: '13900139000' });
  check('PUT /persons/:no updates', updRes.body.success);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 重写集成冒烟测试**

```js
const http = require('http');
const BASE = 'http://localhost:3000';

function request(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  let pass = 0, fail = 0;
  function check(name, ok) { if (ok) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.error(`  FAIL ${name}`); } }

  // 1. No API key -> 401
  const noKey = await request('GET', '/api/integration/persons');
  check('GET /integration/persons without key returns 401', noKey.status === 401);

  // 2. Generate API key
  const fs = require('fs');
  const cookie = fs.readFileSync(process.env.TEMP + '/smoke-cookie.txt', 'utf8').trim();
  const genRes = await request('POST', '/api/integration/credentials/generate',
    { system_name: 'SMOKE_V2', permissions: ['read', 'write'] },
    { 'Cookie': cookie }
  );
  check('POST /credentials/generate', genRes.status === 201 && genRes.body.api_key);
  const apiKey = genRes.body.api_key;

  // 3. Valid key -> 200
  const withKey = await request('GET', '/api/integration/persons', null, { 'X-API-Key': apiKey });
  check('GET /integration/persons with key', withKey.status === 200 && Array.isArray(withKey.body.rows));

  // 4. Sync status
  const syncRes = await request('GET', '/api/integration/sync-status?entity_type=person&since=2020-01-01', null, { 'X-API-Key': apiKey });
  check('GET /sync-status', syncRes.status === 200 && typeof syncRes.body.total_changed === 'number');

  // 5. External identity upsert via integration
  const extRes = await request('POST', '/api/integration/external-identities',
    { entity_type: 'Person', entity_id: 1, system_code: 'PLM', external_key: 'PLM-GUID-001' },
    { 'X-API-Key': apiKey }
  );
  check('POST /external-identities', extRes.status === 201);

  // 6. Read-only key can't write
  const roGen = await request('POST', '/api/integration/credentials/generate',
    { system_name: 'SMOKE_V2_RO', permissions: ['read'] },
    { 'Cookie': cookie }
  );
  const roKey = roGen.body.api_key;
  const roWrite = await request('POST', '/api/integration/external-identities',
    { entity_type: 'Person', entity_id: 1, system_code: 'ERP', external_key: 'ERP-001' },
    { 'X-API-Key': roKey }
  );
  check('Read-only key blocked from write', roWrite.status === 403);

  // 7. Org units via integration
  const orgRes = await request('GET', '/api/integration/org-units', null, { 'X-API-Key': apiKey });
  check('GET /integration/org-units', orgRes.status === 200 && Array.isArray(orgRes.body.rows));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Commit**

```bash
git add mdm-platform/scripts/smoke-master-data.js mdm-platform/scripts/smoke-integration.js
git commit -m "test: rewrite smoke tests for domain model APIs"
```

---

### Task 17: 更新 CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 CLAUDE.md MDM 拓展模块说明**

将 MDM 拓展模块部分替换为：

```markdown
## MDM v2 领域数据模型 (2026-05-18)

基于首期 MDM 数据模型设计完全重建，12 张领域专用表替代旧通用 EAV 模式。

### 新增路由
| 路由前缀 | 模块文件 | 功能 |
|----------|----------|------|
| `/api/org-units` | `orgUnit.js` | 组织单元 CRUD、激活、树形层级 |
| `/api/positions` | `position.js` | 岗位 CRUD、编码基于归属组织 |
| `/api/persons` | `person.js` | 人员 CRUD、任岗关系管理 |
| `/api/product-families` | `productFamily.js` | 产品族/型号根 CRUD |
| `/api/products` | `product.js` | 版本化产品 CRUD、发布/废止生命周期 |
| `/api/class-nodes` | `classNode.js` | 分类树 CRUD、实体分类关联 |
| `/api/attributes` | `attribute.js` | 属性定义 + 强类型属性值批量 upsert |
| `/api/external` | `external.js` | 外部系统注册 + 标识映射 (external_key 权限隔离) |
| `/api/integration` | `integration.js` | 集成 API (API Key 鉴权)、外部标识同步 |
| `/api/quality` | `quality.js` | 数据质量仪表盘 (组织/人员/产品统计) |

### 新增数据表 (12 张)
**组织/人员域:** org_unit, position, person, person_position_assignment
**产品域:** product_family, product, class_node, entity_class_membership
**扩展:** attribute_def, attribute_value
**集成:** external_system, external_identity
**辅助:** code_sequences (编码流水)

### 编码引擎
`server/codeEngine.js` — 按 entity_type + scope_key 分段流水生成编码：
- OrgUnit: `OU-{type_code}-{mnemonic}-{seq}`
- Position: `POS-{org_mnemonic}-{pos_mnemonic}-{seq}`
- Person: `EMP-{seq}`
- ProductFamily: `PF-{model_code}-{class_major}-{seq}`
- Product: `PRD-{model_code}-{class_major}-{class_mid}-{class_minor}-{seq}`

### 安全中间件
- `auth.js` 新增 `stripInternalIds` — 非 admin 用户接口响应自动剥离内部 ID 字段
- `auth.js` 新增 `isAdmin()` 辅助函数
- `external_identity.external_key` 仅 admin 和集成账号可见

### 冒烟测试
```bash
node scripts/smoke-master-data.js   # 组织/人员 CRUD、编码生成
node scripts/smoke-integration.js    # API Key 认证、外部标识同步、权限隔离
```
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for MDM v2 domain model architecture"
```

---

### Task 18: 端到端验证

- [ ] **Step 1: 重建数据库并启动服务**

```bash
cd mdm-platform && rm -f data/platform.db && npm run init-db && npm start
```

- [ ] **Step 2: 冒烟测试**

```bash
# 终端 1: 启动服务
cd mdm-platform && npm start

# 终端 2: 运行冒烟测试 (需要先以 admin 登录获取 cookie)
cd mdm-platform && node scripts/smoke-master-data.js && node scripts/smoke-integration.js
```

- [ ] **Step 3: 手动验证 API**

```bash
# 验证组织架构 API
curl -s http://localhost:3000/api/org-units | head -c 200
# 验证人员 API
curl -s http://localhost:3000/api/persons | head -c 200
# 验证产品族 API
curl -s http://localhost:3000/api/product-families | head -c 200
# 验证质量仪表盘
curl -s http://localhost:3000/api/quality/dashboard | head -c 200
```

- [ ] **Step 4: 验证内部 ID 剥离**

非 admin 用户调用 API 时，响应体中不应出现 `_id` 后缀的字段（如 `org_unit_id`, `person_id` 等）。

---
