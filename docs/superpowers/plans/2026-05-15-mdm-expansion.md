# MDM 平台拓展实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依据信息化系统应用与集成说明会 V1.0 中 MDM 五阶段要求，将 mdm-platform 从"流程映射+字段台账"扩展为完整的主数据管理平台。

**Architecture:** 沿用现有 Express.js + better-sqlite3 + 单文件 HTML/ECharts 架构。新增 4 个路由模块、12 张数据表、1 个认证中间件、3 个前端 Tab。模块按依赖顺序实施：A（主数据注册中心）→ B（生命周期引擎）→ C（权限升级）→ D（集成接口）→ E+F（质量仪表盘+黄金源进度）。

**Tech Stack:** Express.js, better-sqlite3, bcryptjs, exceljs, multer, ECharts (已有), 原生 HTML/CSS/JS

---

## 文件结构

```
mdm-platform/
├── server/
│   ├── db.js                          # [修改] 新增 12 张表 (A:6, B:3, D:3)
│   ├── auth.js                        # [修改] 增加 requireDataPermission 中间件
│   ├── access.js                      # [修改] 增加 masterDataVisibility 行级过滤
│   ├── integrationAuth.js             # [新增] API Key 认证中间件
│   └── routes/
│       ├── masterData.js              # [新增] 主数据 CRUD + 编码生成 + 批量导入
│       ├── masterDataLifecycle.js     # [新增] 生命周期状态机 + 多级会签审批
│       ├── integration.js             # [新增] 外部系统集成 API
│       └── quality.js                 # [新增] 数据质量 KPI + 黄金源进度
├── public/
│   └── index.html                     # [修改] 新增 3 个 Tab
└── scripts/
    ├── smoke-master-data.js           # [新增] 主数据模块冒烟测试
    └── smoke-integration.js           # [新增] 集成接口冒烟测试
```

---

### Task 1: 模块 A 数据库 — 主数据注册中心 6 张表

**Files:**
- Modify: `mdm-platform/server/db.js` (append after existing migrations, before `module.exports`)

- [ ] **Step 1: 在 db.js 末尾 (module.exports 之前) 追加建表 SQL**

在 `module.exports = db;` 之前插入以下代码块：

```js
// ── Module A: Master Data Registry ──
db.exec(`
CREATE TABLE IF NOT EXISTS master_data_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_data_attributes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES master_data_categories(id) ON DELETE CASCADE,
  attr_name TEXT NOT NULL,
  attr_label TEXT NOT NULL,
  attr_type TEXT NOT NULL CHECK(attr_type IN ('文本','编码','日期','枚举','数字','JSON')),
  required INTEGER NOT NULL DEFAULT 0,
  enum_options TEXT,
  validation_rule TEXT,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(category_id, attr_name)
);

CREATE TABLE IF NOT EXISTS master_data_code_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL UNIQUE REFERENCES master_data_categories(id),
  prefix TEXT NOT NULL DEFAULT '',
  total_length INTEGER NOT NULL DEFAULT 30,
  segment_defs TEXT NOT NULL DEFAULT '[]',
  next_sequence INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_data_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES master_data_categories(id),
  name TEXT NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','active','changing','discontinued','archived','rejected')),
  old_code TEXT,
  source_system TEXT DEFAULT 'MDM_MANUAL',
  maintain_dept_id INTEGER REFERENCES departments(id),
  owner_user_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_data_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  category_id INTEGER REFERENCES master_data_categories(id),
  total_rows INTEGER NOT NULL DEFAULT 0,
  success_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','failed')),
  uploaded_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_data_import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES master_data_import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  code TEXT,
  name TEXT,
  status TEXT NOT NULL CHECK(status IN ('success','error')),
  error_reason TEXT,
  raw_data_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 预置 6 大主数据分类
INSERT OR IGNORE INTO master_data_categories (id, name, code, description, sort_order) VALUES
(1, '零组件', 'PART', '自制件、外协件、组件、部件', 1),
(2, '工艺组件', 'PROC_COMP', '工艺拆分件、虚拟件', 2),
(3, '工装', 'TOOLING', '模具、夹具、型架、样板', 3),
(4, '原材料', 'MATERIAL', '金属/非金属、板材、型材', 4),
(5, '设备', 'EQUIPMENT', '生产设备、检测设备', 5),
(6, '工具', 'TOOL', '刀具、量具、辅具', 6);
`);

console.log('Module A: Master Data Registry tables ready');
```

- [ ] **Step 2: 运行 npm run init-db 验证建表**

```powershell
cd mdm-platform && npm run init-db
```

Expected: 控制台输出 "Module A: Master Data Registry tables ready"，无 SQL 错误。

- [ ] **Step 3: 验证表结构**

```powershell
cd mdm-platform && node -e "const db = require('./server/db'); const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'master_data_%'\").all(); console.log(tables);"
```

Expected: 输出 6 个表名。

- [ ] **Step 4: Commit**

```powershell
git add mdm-platform/server/db.js
git commit -m "feat: add master data registry tables (6 tables, 6 preset categories)"
```

---

### Task 2: 模块 A 路由 — 主数据 CRUD + 编码引擎

**Files:**
- Create: `mdm-platform/server/routes/masterData.js`

- [ ] **Step 1: 创建 masterData.js 路由文件**

```js
const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function generateCode(categoryId) {
  const rule = db.prepare('SELECT * FROM master_data_code_rules WHERE category_id=?').get(categoryId);
  if (!rule) throw new Error('该分类未配置编码规则');

  const segments = JSON.parse(rule.segment_defs);
  const seq = rule.next_sequence;
  const seqStr = String(seq).padStart(rule.total_length - (rule.prefix.length + segments.reduce((s, seg) => s + (seg.length || 0), 0)), '0');
  const code = rule.prefix + segments.map(s => s.value || '').join('') + seqStr;

  db.prepare('UPDATE master_data_code_rules SET next_sequence = next_sequence + 1 WHERE id=?').run(rule.id);
  return code;
}

// GET /api/master-data/categories — 列出所有分类
router.get('/categories', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM master_data_categories ORDER BY sort_order').all();
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/categories/:id/attributes — 某分类的属性模板
router.get('/categories/:id/attributes', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM master_data_attributes WHERE category_id=? ORDER BY sort_order').all(req.params.id);
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/master-data/categories/:id/attributes — 批量更新属性模板
router.put('/categories/:id/attributes', requireAuth, (req, res) => {
  try {
    const { attributes } = req.body;
    if (!Array.isArray(attributes)) return res.status(400).json({ error: 'attributes 必须是数组' });

    const catId = Number(req.params.id);
    db.transaction(() => {
      db.prepare('DELETE FROM master_data_attributes WHERE category_id=?').run(catId);
      const insert = db.prepare(`
        INSERT INTO master_data_attributes (category_id, attr_name, attr_label, attr_type, required, enum_options, validation_rule, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      attributes.forEach((attr, i) => {
        insert.run(catId, attr.attr_name, attr.attr_label, attr.attr_type, attr.required ? 1 : 0, attr.enum_options || null, attr.validation_rule || null, attr.sort_order || i);
      });
    })();
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/master-data/code-rules/:categoryId — 配置编码规则
router.put('/code-rules/:categoryId', requireAuth, (req, res) => {
  try {
    const { prefix, total_length, segment_defs } = req.body;
    const catId = Number(req.params.categoryId);

    db.prepare(`
      INSERT INTO master_data_code_rules (category_id, prefix, total_length, segment_defs)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(category_id) DO UPDATE SET prefix=excluded.prefix, total_length=excluded.total_length, segment_defs=excluded.segment_defs
    `).run(catId, prefix || '', total_length || 30, JSON.stringify(segment_defs || []));

    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/items — 查询主数据条目
router.get('/items', requireAuth, (req, res) => {
  try {
    const { category_id, status, search, page = 1, limit = 50 } = req.query;
    let sql = `SELECT i.*, c.name as category_name, d.name as maintain_dept_name
               FROM master_data_items i
               JOIN master_data_categories c ON i.category_id = c.id
               LEFT JOIN departments d ON i.maintain_dept_id = d.id
               WHERE 1=1`;
    const params = [];

    if (category_id) { sql += ' AND i.category_id=?'; params.push(category_id); }
    if (status) { sql += ' AND i.status=?'; params.push(status); }
    if (search) { sql += ' AND (i.code LIKE ? OR i.name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY i.updated_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));

    const rows = db.prepare(sql).all(...params);
    rows.forEach(r => { r.attributes = JSON.parse(r.attributes_json || '{}'); delete r.attributes_json; });
    res.json({ rows, total: count, page: Number(page), limit: Number(limit) });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/items/:code — 按编码查询单条
router.get('/items/:code', requireAuth, (req, res) => {
  try {
    const row = db.prepare(`
      SELECT i.*, c.name as category_name, d.name as maintain_dept_name
      FROM master_data_items i
      JOIN master_data_categories c ON i.category_id = c.id
      LEFT JOIN departments d ON i.maintain_dept_id = d.id
      WHERE i.code=?
    `).get(req.params.code);
    if (!row) return res.status(404).json({ error: '主数据不存在' });
    row.attributes = JSON.parse(row.attributes_json || '{}');
    delete row.attributes_json;
    res.json(row);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/master-data/items — 新增主数据（自动生成编码）
router.post('/items', requireAuth, (req, res) => {
  try {
    const { category_id, name, attributes, maintain_dept_id } = req.body;
    if (!category_id || !name) return res.status(400).json({ error: '缺少必填字段 category_id / name' });

    const code = generateCode(Number(category_id));
    const attrJson = JSON.stringify(attributes || {});

    const result = db.prepare(`
      INSERT INTO master_data_items (code, category_id, name, attributes_json, maintain_dept_id, owner_user_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, category_id, name, attrJson, maintain_dept_id || null, req.session.userId, req.session.userId);

    db.prepare(`
      INSERT INTO version_log (entity_type, entity_id, field_name, old_value, new_value, operation, operated_by)
      VALUES ('master_data_item', ?, 'code', NULL, ?, 'create', ?)
    `).run(result.lastInsertRowid, code, req.session.userId);

    res.status(201).json({ id: result.lastInsertRowid, code });
  } catch (e) { handleDbError(res, e); }
});

// PUT /api/master-data/items/:code — 更新主数据属性
router.put('/items/:code', requireAuth, (req, res) => {
  try {
    const { name, attributes, maintain_dept_id } = req.body;
    const existing = db.prepare('SELECT * FROM master_data_items WHERE code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '主数据不存在' });

    const attrJson = attributes ? JSON.stringify(attributes) : existing.attributes_json;
    db.prepare(`
      UPDATE master_data_items SET name=?, attributes_json=?, maintain_dept_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE code=?
    `).run(name || existing.name, attrJson, maintain_dept_id || existing.maintain_dept_id, req.session.userId, req.params.code);

    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/master-data/import — Excel 批量导入
router.post('/import', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const categoryId = Number(req.body.category_id);
    if (!categoryId) return res.status(400).json({ error: '缺少 category_id' });
    if (!req.file) return res.status(400).json({ error: '缺少 Excel 文件' });

    const attributes = db.prepare('SELECT * FROM master_data_attributes WHERE category_id=? ORDER BY sort_order').all(categoryId);
    if (!attributes.length) return res.status(400).json({ error: '该分类未配置属性模板，请先配置' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ error: 'Excel 文件无工作表' });

    const headerMap = {};
    sheet.getRow(1).eachCell((cell, col) => {
      if (cell.value) headerMap[String(cell.value).trim()] = col;
    });

    const requiredAttrs = attributes.filter(a => a.required);
    const batchResult = db.prepare(`
      INSERT INTO master_data_import_batches (file_name, category_id, total_rows, uploaded_by) VALUES (?, ?, ?, ?)
    `).run(req.file.originalname, categoryId, sheet.rowCount - 1, req.session.userId);
    const batchId = batchResult.lastInsertRowid;

    let successRows = 0, errorRows = 0;
    const insertLog = db.prepare(`
      INSERT INTO master_data_import_log (batch_id, row_number, code, name, status, error_reason, raw_data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
        const row = sheet.getRow(rowNum);
        const name = String(row.getCell(headerMap['名称'] || headerMap['name'] || 1).value || '').trim();
        if (!name) { errorRows++; continue; }

        const attrJson = {};
        const errors = [];
        for (const attr of attributes) {
          const cellVal = row.getCell(headerMap[attr.attr_label] || headerMap[attr.attr_name]);
          const val = cellVal ? String(cellVal.value || '').trim() : '';
          attrJson[attr.attr_name] = val || null;
          if (attr.required && !val) {
            errors.push(`${attr.attr_label} 为必填项`);
          }
        }

        if (errors.length) {
          insertLog.run(batchId, rowNum, null, name, 'error', errors.join('; '), JSON.stringify(attrJson));
          errorRows++;
          continue;
        }

        try {
          const code = generateCode(categoryId);
          db.prepare(`
            INSERT INTO master_data_items (code, category_id, name, attributes_json, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(code, categoryId, name, JSON.stringify(attrJson), req.session.userId, req.session.userId);

          insertLog.run(batchId, rowNum, code, name, 'success', null, JSON.stringify(attrJson));
          successRows++;
        } catch (e) {
          insertLog.run(batchId, rowNum, null, name, 'error', e.message, JSON.stringify(attrJson));
          errorRows++;
        }
      }
    })();

    db.prepare('UPDATE master_data_import_batches SET success_rows=?, error_rows=?, status=? WHERE id=?')
      .run(successRows, errorRows, errorRows === 0 ? 'completed' : 'completed', batchId);

    res.json({ batch_id: batchId, success_rows: successRows, error_rows: errorRows, total_rows: sheet.rowCount - 1 });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/import-batches — 查询导入历史
router.get('/import-batches', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT b.*, c.name as category_name, u.name as uploaded_by_name
      FROM master_data_import_batches b
      JOIN master_data_categories c ON b.category_id = c.id
      LEFT JOIN users u ON b.uploaded_by = u.id
      ORDER BY b.created_at DESC LIMIT 20
    `).all();
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/import-batches/:id/log — 某批次明细
router.get('/import-batches/:id/log', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM master_data_import_log WHERE batch_id=? ORDER BY row_number').all(req.params.id);
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/duplicates/check — 去重检测
router.get('/duplicates/check', requireAuth, (req, res) => {
  try {
    const { category_id, threshold = 0.8 } = req.query;
    let sql = `
      SELECT a.id as id_a, a.code as code_a, a.name as name_a,
             b.id as id_b, b.code as code_b, b.name as name_b,
             c.name as category_name
      FROM master_data_items a
      JOIN master_data_items b ON a.id < b.id
      JOIN master_data_categories c ON a.category_id = c.id
      WHERE a.name = b.name
    `;
    const params = [];
    if (category_id) { sql += ' AND a.category_id=?'; params.push(category_id); }

    sql += ' ORDER BY c.name, a.name LIMIT 100';
    const rows = db.prepare(sql).all(...params);
    res.json({ duplicates: rows, total: rows.length });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/master-data/duplicates/merge — 合并重复条目
router.post('/duplicates/merge', requireAuth, (req, res) => {
  try {
    const { keep_id, merge_id } = req.body;
    if (!keep_id || !merge_id) return res.status(400).json({ error: '缺少 keep_id / merge_id' });

    const keepItem = db.prepare('SELECT * FROM master_data_items WHERE id=?').get(keep_id);
    const mergeItem = db.prepare('SELECT * FROM master_data_items WHERE id=?').get(merge_id);
    if (!keepItem || !mergeItem) return res.status(404).json({ error: '条目不存在' });

    db.transaction(() => {
      db.prepare("INSERT INTO old_new_code_mapping (old_code, new_code) VALUES (?, ?)").run(mergeItem.code, keepItem.code);
      db.prepare("UPDATE master_data_items SET status='archived', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(merge_id);
      db.prepare(`
        INSERT INTO version_log (entity_type, entity_id, field_name, old_value, new_value, operation, operated_by)
        VALUES ('master_data_item', ?, 'merge', ?, ?, 'update', ?)
      `).run(keep_id, mergeItem.code, keepItem.code, req.session.userId);
    })();

    res.json({ success: true, kept_code: keepItem.code, merged_code: mergeItem.code });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: 在 index.js 中注册路由**

在 `mdm-platform/server/index.js` 中，在最后一个 `registerRouteIfExists` 行之后添加：

```js
registerRouteIfExists('/api/master-data', 'masterData');
```

- [ ] **Step 3: Commit**

```powershell
git add mdm-platform/server/routes/masterData.js mdm-platform/server/index.js
git commit -m "feat: add master data CRUD, auto-coding engine, Excel import, dedup detection"
```

---

### Task 3: 模块 A 冒烟测试

**Files:**
- Create: `mdm-platform/scripts/smoke-master-data.js`

- [ ] **Step 1: 创建冒烟测试脚本**

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

  // 1. GET categories
  const cats = await request('GET', '/api/master-data/categories');
  check('GET /categories returns array', Array.isArray(cats.body) && cats.body.length === 6);

  // 2. configure code rule for category 1 (PART)
  const ruleRes = await request('PUT', '/api/master-data/code-rules/1', {
    prefix: 'CHX', total_length: 30, segment_defs: [{ type: 'category', length: 4, value: 'PART' }]
  });
  check('PUT /code-rules/1', ruleRes.body.success);

  // 3. set attributes for category 1
  const attrRes = await request('PUT', '/api/master-data/categories/1/attributes', {
    attributes: [
      { attr_name: 'drawing_no', attr_label: '图号', attr_type: '文本', required: 1 },
      { attr_name: 'material', attr_label: '材料牌号', attr_type: '文本', required: 1 },
      { attr_name: 'weight', attr_label: '重量(kg)', attr_type: '数字', required: 0 }
    ]
  });
  check('PUT /categories/1/attributes', attrRes.body.success);

  // 4. create an item (auto-generate code)
  const createRes = await request('POST', '/api/master-data/items', {
    category_id: 1, name: '机翼前缘肋', attributes: { drawing_no: 'CHX-001-001', material: 'TC4', weight: '2.3' }, maintain_dept_id: 1
  });
  check('POST /items creates with auto code', createRes.status === 201 && createRes.body.code && createRes.body.code.startsWith('CHX'));

  // 5. get items list
  const listRes = await request('GET', '/api/master-data/items?category_id=1');
  check('GET /items returns rows', Array.isArray(listRes.body.rows) && listRes.body.rows.length >= 1);

  // 6. get single by code
  const code = createRes.body.code;
  const getRes = await request('GET', `/api/master-data/items/${code}`);
  check('GET /items/:code returns attributes', getRes.body.attributes && getRes.body.attributes.drawing_no === 'CHX-001-001');

  // 7. update item
  const updateRes = await request('PUT', `/api/master-data/items/${code}`, { name: '机翼前缘肋(改)', attributes: { drawing_no: 'CHX-001-001', material: 'TC4', weight: '2.5' } });
  check('PUT /items/:code updates', updateRes.body.success);

  // 8. duplicate check
  const dupRes = await request('GET', '/api/master-data/duplicates/check');
  check('GET /duplicates/check', Array.isArray(dupRes.body.duplicates));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 启动服务并运行冒烟测试**

```powershell
cd mdm-platform
# 先获取登录 cookie (假设已有测试账号)
node -e "
const http = require('http');
const data = JSON.stringify({employee_no:'admin',password:'admin123'});
const req = http.request({hostname:'localhost',port:3000,path:'/api/org/login',method:'POST',headers:{'Content-Type':'application/json'}}, res => {
  const cookie = res.headers['set-cookie'][0].split(';')[0];
  require('fs').writeFileSync(process.env.TEMP + '/smoke-cookie.txt', cookie);
  console.log('cookie saved');
  process.exit(0);
});
req.write(data); req.end();
"
# 等待几秒后
node scripts/smoke-master-data.js
```

Expected: 所有 8 个测试 PASS。

- [ ] **Step 3: Commit**

```powershell
git add mdm-platform/scripts/smoke-master-data.js
git commit -m "test: add master data module smoke test (8 cases)"
```

---

### Task 4: 模块 B 数据库 — 生命周期 3 张表

**Files:**
- Modify: `mdm-platform/server/db.js` (append after Module A migration, before `module.exports`)

- [ ] **Step 1: 追加建表 SQL**

```js
// ── Module B: Master Data Lifecycle ──
db.exec(`
CREATE TABLE IF NOT EXISTS master_data_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES master_data_items(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK(request_type IN ('create','modify','discontinue','archive')),
  change_summary TEXT NOT NULL,
  old_values_json TEXT,
  new_values_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','approved','rejected','cancelled')),
  requested_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

CREATE TABLE IF NOT EXISTS master_data_change_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_request_id INTEGER NOT NULL REFERENCES master_data_change_requests(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  approver_dept_id INTEGER NOT NULL REFERENCES departments(id),
  approver_user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  opinion TEXT,
  operated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_data_status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES master_data_items(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  change_request_id INTEGER REFERENCES master_data_change_requests(id) ON DELETE SET NULL,
  operated_by INTEGER REFERENCES users(id),
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

console.log('Module B: Master Data Lifecycle tables ready');
```

- [ ] **Step 2: 验证**

```powershell
cd mdm-platform && npm run init-db
```

Expected: 控制台输出 "Module B: Master Data Lifecycle tables ready"。

- [ ] **Step 3: Commit**

```powershell
git add mdm-platform/server/db.js
git commit -m "feat: add master data lifecycle tables (change_requests, approvals, status_log)"
```

---

### Task 5: 模块 B 路由 — 生命周期状态机 + 多级会签

**Files:**
- Create: `mdm-platform/server/routes/masterDataLifecycle.js`

- [ ] **Step 1: 创建路由文件**

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

const VALID_TRANSITIONS = {
  'draft':        ['review'],
  'review':       ['active', 'rejected'],
  'active':       ['changing', 'discontinued'],
  'changing':     ['active', 'rejected'],
  'discontinued': ['archived'],
  'archived':     [],
  'rejected':     ['review']
};

// POST /api/master-data/items/:code/transition — 状态流转
router.post('/items/:code/transition', requireAuth, (req, res) => {
  try {
    const { to_status, note } = req.body;
    if (!to_status) return res.status(400).json({ error: '缺少 to_status' });

    const item = db.prepare('SELECT * FROM master_data_items WHERE code=?').get(req.params.code);
    if (!item) return res.status(404).json({ error: '主数据不存在' });

    const allowed = VALID_TRANSITIONS[item.status] || [];
    if (!allowed.includes(to_status)) {
      return res.status(400).json({ error: `不允许 ${item.status} → ${to_status} 的状态变更` });
    }

    db.transaction(() => {
      db.prepare('UPDATE master_data_items SET status=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE code=?')
        .run(to_status, req.session.userId, req.params.code);

      db.prepare(`
        INSERT INTO master_data_status_log (item_id, from_status, to_status, operated_by, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(item.id, item.status, to_status, req.session.userId, note || null);
    })();

    res.json({ success: true, from: item.status, to: to_status });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/items/:code/status-log — 状态变更历史
router.get('/items/:code/status-log', requireAuth, (req, res) => {
  try {
    const item = db.prepare('SELECT id FROM master_data_items WHERE code=?').get(req.params.code);
    if (!item) return res.status(404).json({ error: '主数据不存在' });

    const rows = db.prepare(`
      SELECT sl.*, u.name as operated_by_name
      FROM master_data_status_log sl
      LEFT JOIN users u ON sl.operated_by = u.id
      WHERE sl.item_id=? ORDER BY sl.created_at DESC
    `).all(item.id);
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/master-data/change-requests — 发起变更申请（含多级会签）
router.post('/change-requests', requireAuth, (req, res) => {
  try {
    const { item_code, request_type, change_summary, new_values, approval_dept_ids } = req.body;
    if (!item_code || !request_type || !change_summary || !new_values) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    if (!Array.isArray(approval_dept_ids) || approval_dept_ids.length === 0) {
      return res.status(400).json({ error: '至少需要一个审批部门' });
    }

    const item = db.prepare('SELECT * FROM master_data_items WHERE code=?').get(item_code);
    if (!item) return res.status(404).json({ error: '主数据不存在' });

    const cr = db.transaction(() => {
      const oldValues = JSON.parse(item.attributes_json || '{}');

      const result = db.prepare(`
        INSERT INTO master_data_change_requests (item_id, request_type, change_summary, old_values_json, new_values_json, requested_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(item.id, request_type, change_summary, JSON.stringify(oldValues), JSON.stringify(new_values), req.session.userId);

      const crId = result.lastInsertRowid;

      const insertApproval = db.prepare(`
        INSERT INTO master_data_change_approvals (change_request_id, step_order, approver_dept_id)
        VALUES (?, ?, ?)
      `);
      approval_dept_ids.forEach((deptId, i) => {
        insertApproval.run(crId, i + 1, deptId);
      });

      // If item is active, set to 'changing' during review
      if (item.status === 'active') {
        db.prepare('UPDATE master_data_items SET status=? WHERE id=?').run('changing', item.id);
        db.prepare(`
          INSERT INTO master_data_status_log (item_id, from_status, to_status, change_request_id, operated_by)
          VALUES (?, 'active', 'changing', ?, ?)
        `).run(item.id, crId, req.session.userId);
      }

      return { id: crId };
    })();

    res.status(201).json({ change_request_id: cr.id });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/change-requests — 查询变更申请列表
router.get('/change-requests', requireAuth, (req, res) => {
  try {
    const { status, item_id } = req.query;
    let sql = `
      SELECT cr.*, i.code as item_code, i.name as item_name, u.name as requested_by_name,
        (SELECT GROUP_CONCAT(a.status) FROM master_data_change_approvals a WHERE a.change_request_id = cr.id) as approval_statuses
      FROM master_data_change_requests cr
      JOIN master_data_items i ON cr.item_id = i.id
      LEFT JOIN users u ON cr.requested_by = u.id
      WHERE 1=1
    `;
    const params = [];
    if (status) { sql += ' AND cr.status=?'; params.push(status); }
    if (item_id) { sql += ' AND cr.item_id=?'; params.push(item_id); }
    sql += ' ORDER BY cr.created_at DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/change-requests/:id — 单个变更详情（含审批步骤）
router.get('/change-requests/:id', requireAuth, (req, res) => {
  try {
    const cr = db.prepare(`
      SELECT cr.*, i.code as item_code, i.name as item_name
      FROM master_data_change_requests cr
      JOIN master_data_items i ON cr.item_id = i.id
      WHERE cr.id=?
    `).get(req.params.id);
    if (!cr) return res.status(404).json({ error: '变更申请不存在' });

    const approvals = db.prepare(`
      SELECT a.*, d.name as dept_name, u.name as approver_name
      FROM master_data_change_approvals a
      JOIN departments d ON a.approver_dept_id = d.id
      LEFT JOIN users u ON a.approver_user_id = u.id
      WHERE a.change_request_id=? ORDER BY a.step_order
    `).all(req.params.id);

    res.json({ ...cr, approvals });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/master-data/change-requests/:id/approve — 审批（通过/退回）
router.post('/change-requests/:id/approve', requireAuth, (req, res) => {
  try {
    const { step_order, action, opinion } = req.body;
    if (!step_order || !action || !['approved', 'rejected'].includes(action)) {
      return res.status(400).json({ error: '缺少 step_order / action (approved|rejected)' });
    }

    const cr = db.prepare('SELECT * FROM master_data_change_requests WHERE id=?').get(req.params.id);
    if (!cr) return res.status(404).json({ error: '变更申请不存在' });
    if (cr.status !== 'in_review' && cr.status !== 'pending') {
      return res.status(400).json({ error: '该变更申请当前状态不可审批' });
    }

    const step = db.prepare(
      'SELECT * FROM master_data_change_approvals WHERE change_request_id=? AND step_order=?'
    ).get(req.params.id, step_order);
    if (!step) return res.status(404).json({ error: '审批步骤不存在' });
    if (step.status !== 'pending') return res.status(400).json({ error: '该步骤已审批' });

    db.transaction(() => {
      if (cr.status === 'pending') {
        db.prepare('UPDATE master_data_change_requests SET status=? WHERE id=?').run('in_review', cr.id);
      }

      db.prepare(`
        UPDATE master_data_change_approvals SET status=?, approver_user_id=?, opinion=?, operated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(action === 'approved' ? 'approved' : 'rejected', req.session.userId, opinion || null, step.id);

      if (action === 'rejected') {
        db.prepare('UPDATE master_data_change_requests SET status=?, resolved_at=CURRENT_TIMESTAMP WHERE id=?')
          .run('rejected', cr.id);
        // Rollback item status
        db.prepare("UPDATE master_data_items SET status='active' WHERE id=?").run(cr.item_id);
      } else {
        // Check if ALL steps are approved
        const pendingSteps = db.prepare(
          'SELECT COUNT(*) as cnt FROM master_data_change_approvals WHERE change_request_id=? AND status=?'
        ).get(cr.id, 'pending');
        if (pendingSteps.cnt === 0) {
          // All approved — apply the change
          const newValues = JSON.parse(cr.new_values_json);
          db.prepare('UPDATE master_data_items SET attributes_json=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
            .run(JSON.stringify(newValues), 'active', cr.item_id);

          db.prepare('UPDATE master_data_change_requests SET status=?, resolved_at=CURRENT_TIMESTAMP WHERE id=?')
            .run('approved', cr.id);

          db.prepare(`
            INSERT INTO master_data_status_log (item_id, from_status, to_status, change_request_id, operated_by)
            VALUES (?, 'changing', 'active', ?, ?)
          `).run(cr.item_id, cr.id, req.session.userId);
        }
      }
    })();

    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: 注册路由**

在 `index.js` 中添加：

```js
registerRouteIfExists('/api/master-data', 'masterDataLifecycle');
```

- [ ] **Step 3: Commit**

```powershell
git add mdm-platform/server/routes/masterDataLifecycle.js mdm-platform/server/index.js
git commit -m "feat: add master data lifecycle state machine and multi-level countersign approval"
```

---

### Task 6: 模块 C — 权限升级（users + auth + access）

**Files:**
- Modify: `mdm-platform/server/db.js` (users 表加字段)
- Modify: `mdm-platform/server/auth.js` (新增中间件)
- Modify: `mdm-platform/server/access.js` (新增行级过滤)

- [ ] **Step 1: users 表增加 permissions 字段 (migration)**

在 `db.js` 的 `module.exports` 之前添加：

```js
// ── Module C: Permissions field on users ──
const userInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
if (userInfo && !userInfo.sql.includes('permissions')) {
  db.exec("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '{}'");
  console.log('Migration: added permissions to users');
}
```

- [ ] **Step 2: auth.js 增加 requireDataPermission 中间件**

在 `auth.js` 文件末尾的 `module.exports` 之前添加：

```js
function requireDataPermission(categoryCode, action) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: '未登录' });
    }
    if (req.session.userRole === 'admin') return next();

    const db = require('./db');
    const user = db.prepare('SELECT permissions FROM users WHERE id=?').get(req.session.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });

    const permissions = JSON.parse(user.permissions || '{}');
    const catPerms = permissions[categoryCode];
    if (!catPerms || !catPerms.includes(action)) {
      return res.status(403).json({ error: `无 ${categoryCode} 的 ${action} 权限` });
    }
    next();
  };
}
```

并在 `module.exports` 中添加 `requireDataPermission`。

- [ ] **Step 3: access.js 增加 masterDataVisibility**

在 `access.js` 的 `module.exports` 之前添加：

```js
function masterDataVisibility(alias, req) {
  if (isAdmin(req)) return { sql: '', params: [] };

  const table = alias || 'i';
  const params = [];
  const clauses = [];

  if (req.session.departmentId) {
    clauses.push(`${table}.maintain_dept_id=?`);
    params.push(req.session.departmentId);
    clauses.push(`${table}.created_by=?`);
    params.push(req.session.userId);
  }

  return { sql: ` AND (${clauses.join(' OR ')})`, params };
}
```

并在 `module.exports` 中添加 `masterDataVisibility`。

- [ ] **Step 4: Commit**

```powershell
git add mdm-platform/server/db.js mdm-platform/server/auth.js mdm-platform/server/access.js
git commit -m "feat: add 4W+1H RBAC — permissions field, requireDataPermission, masterDataVisibility"
```

---

### Task 7: 模块 D 数据库 — 集成接口 3 张表

**Files:**
- Modify: `mdm-platform/server/db.js` (append before `module.exports`)

- [ ] **Step 1: 追加建表 SQL**

```js
// ── Module D: Integration API ──
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

CREATE TABLE IF NOT EXISTS old_new_code_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  old_code TEXT NOT NULL,
  new_code TEXT NOT NULL,
  system_source TEXT,
  mapped_by INTEGER REFERENCES users(id),
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(old_code, new_code)
);
`);

console.log('Module D: Integration API tables ready');
```

- [ ] **Step 2: Commit**

```powershell
git add mdm-platform/server/db.js
git commit -m "feat: add integration tables (credentials, sync_log, old_new_code_mapping)"
```

---

### Task 8: 模块 D — integrationAuth.js 中间件

**Files:**
- Create: `mdm-platform/server/integrationAuth.js`

- [ ] **Step 1: 创建 API Key 认证中间件**

```js
const bcrypt = require('bcryptjs');
const db = require('./db');

function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: '缺少 X-API-Key' });

  const credentials = db.prepare('SELECT * FROM integration_credentials WHERE enabled=1').all();

  let matched = null;
  for (const cred of credentials) {
    if (bcrypt.compareSync(apiKey, cred.api_key_hash)) {
      matched = cred;
      break;
    }
  }

  if (!matched) return res.status(403).json({ error: 'API Key 无效' });

  req.integrationSystem = {
    name: matched.system_name,
    permissions: JSON.parse(matched.permissions_json || '["read"]')
  };

  db.prepare('UPDATE integration_credentials SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(matched.id);
  next();
}

function requireIntegrationPermission(action) {
  return (req, res, next) => {
    if (!req.integrationSystem) return res.status(401).json({ error: '未认证' });
    if (!req.integrationSystem.permissions.includes(action)) {
      return res.status(403).json({ error: '该 API Key 无此操作权限' });
    }
    next();
  };
}

module.exports = { apiKeyAuth, requireIntegrationPermission };
```

- [ ] **Step 2: Commit**

```powershell
git add mdm-platform/server/integrationAuth.js
git commit -m "feat: add API Key authentication middleware for integration endpoints"
```

---

### Task 9: 模块 D 路由 — 外部集成 API

**Files:**
- Create: `mdm-platform/server/routes/integration.js`

- [ ] **Step 1: 创建集成路由**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiKeyAuth, requireIntegrationPermission } = require('../integrationAuth');
const bcrypt = require('bcryptjs');

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

// GET /api/integration/materials — 查询物料主数据（支持增量同步）
router.get('/materials', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { category_id, since, page = 1, limit = 200 } = req.query;
    let sql = `SELECT code, category_id, name, attributes_json, status, old_code, updated_at FROM master_data_items WHERE 1=1`;
    const params = [];

    if (category_id) { sql += ' AND category_id=?'; params.push(category_id); }
    if (since) { sql += ' AND updated_at >= ?'; params.push(since); }

    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY updated_at ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));

    const rows = db.prepare(sql).all(...params);
    rows.forEach(r => { r.attributes = JSON.parse(r.attributes_json || '{}'); delete r.attributes_json; });

    logSync(req.integrationSystem.name, 'GET /materials', req.query, rows.length, 'success', null, req);
    res.json({ rows, total: count, page: Number(page), limit: Number(limit) });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/materials/:code — 按编码查询单个物料
router.get('/materials/:code', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const row = db.prepare(`
      SELECT code, category_id, name, attributes_json, status, old_code, updated_at
      FROM master_data_items WHERE code=?
    `).get(req.params.code);
    if (!row) return res.status(404).json({ error: '主数据不存在' });

    row.attributes = JSON.parse(row.attributes_json || '{}');
    delete row.attributes_json;

    logSync(req.integrationSystem.name, `GET /materials/${req.params.code}`, {}, 1, 'success', null, req);
    res.json(row);
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/materials/sync-status — 增量同步状态
router.get('/materials/sync-status', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { since } = req.query;
    const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19);

    const created = db.prepare('SELECT COUNT(*) as cnt FROM master_data_items WHERE created_at >= ?').get(sinceDate).cnt;
    const updated = db.prepare('SELECT COUNT(*) as cnt FROM master_data_items WHERE updated_at >= ? AND created_at < ?').get(sinceDate, sinceDate).cnt;

    res.json({ since: sinceDate, created_count: created, updated_count: updated, total_changed: created + updated });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/old-code/:oldCode — 旧编码映射查询
router.get('/old-code/:oldCode', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const mapping = db.prepare('SELECT * FROM old_new_code_mapping WHERE old_code=?').get(req.params.oldCode);
    if (!mapping) return res.status(404).json({ error: '未找到该旧编码的映射' });
    res.json(mapping);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/integration/callback/consistency-check — 消费系统上报一致性校验
router.post('/callback/consistency-check', apiKeyAuth, requireIntegrationPermission('write'), (req, res) => {
  try {
    const { system_name, checks } = req.body;
    if (!checks || !Array.isArray(checks)) return res.status(400).json({ error: 'checks 必须为数组' });

    // checks: [{ code, field, md_ value, consumer_value, match }]
    const mismatchCount = checks.filter(c => !c.match).length;

    logSync(system_name || req.integrationSystem.name, 'POST /callback/consistency-check',
      { total: checks.length, mismatches: mismatchCount }, checks.length, 'success', null, req);

    res.json({ received: checks.length, mismatches: mismatchCount });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/integration/callback/stock-change — MES 库存变动反馈
router.post('/callback/stock-change', apiKeyAuth, requireIntegrationPermission('write'), (req, res) => {
  try {
    const { material_code, change_type, quantity, location } = req.body;
    if (!material_code || !change_type || quantity == null) {
      return res.status(400).json({ error: '缺少必填字段 material_code / change_type / quantity' });
    }

    const item = db.prepare('SELECT id FROM master_data_items WHERE code=?').get(material_code);
    if (!item) return res.status(404).json({ error: '物料不存在' });

    logSync(req.integrationSystem.name, 'POST /callback/stock-change', { material_code, change_type, quantity }, 1, 'success', null, req);
    res.json({ success: true, message: '库存变动已记录' });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/integration/credentials/generate — 管理系统生成 API Key（Admin only via session）
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

// GET /api/integration/credentials — 列出已注册系统（不返回 Key）
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

- [ ] **Step 2: 注册路由**

在 `index.js` 中添加：

```js
registerRouteIfExists('/api/integration', 'integration');
```

- [ ] **Step 3: Commit**

```powershell
git add mdm-platform/server/routes/integration.js mdm-platform/server/index.js
git commit -m "feat: add external integration API (sync endpoints, old-code mapping, consistency callback)"
```

---

### Task 10: 模块 D 冒烟测试

**Files:**
- Create: `mdm-platform/scripts/smoke-integration.js`

- [ ] **Step 1: 创建集成接口冒烟测试**

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

  // 1. No API key → 401
  const noKey = await request('GET', '/api/integration/materials');
  check('GET /materials without key returns 401', noKey.status === 401);

  // 2. Get a session cookie and generate an API key (admin)
  const fs = require('fs');
  const cookie = fs.readFileSync(process.env.TEMP + '/smoke-cookie.txt', 'utf8').trim();
  const genRes = await request('POST', '/api/integration/credentials/generate',
    { system_name: 'SMOKE_TEST', permissions: ['read', 'write'] },
    { 'Cookie': cookie }
  );
  check('POST /credentials/generate creates key', genRes.status === 201 && genRes.body.api_key);

  const apiKey = genRes.body.api_key;

  // 3. Valid API key → 200
  const withKey = await request('GET', '/api/integration/materials', null, { 'X-API-Key': apiKey });
  check('GET /materials with key returns 200', withKey.status === 200 && Array.isArray(withKey.body.rows));

  // 4. Sync status
  const syncRes = await request('GET', '/api/integration/materials/sync-status?since=2020-01-01', null, { 'X-API-Key': apiKey });
  check('GET /materials/sync-status', syncRes.status === 200 && typeof syncRes.body.total_changed === 'number');

  // 5. Old code mapping — 404 for unknown code
  const oldCodeRes = await request('GET', '/api/integration/old-code/ZZZ999', null, { 'X-API-Key': apiKey });
  check('GET /old-code/ZZZ999 returns 404 for unknown', oldCodeRes.status === 404);

  // 6. Consistency check callback
  const cbRes = await request('POST', '/api/integration/callback/consistency-check',
    { checks: [{ code: 'TEST001', field: 'material', md_value: 'TC4', consumer_value: 'TC4', match: true }] },
    { 'X-API-Key': apiKey }
  );
  check('POST /callback/consistency-check', cbRes.status === 200 && cbRes.body.mismatches === 0);

  // 7. Read-only key can't write
  const roKeyGen = await request('POST', '/api/integration/credentials/generate',
    { system_name: 'SMOKE_TEST_RO', permissions: ['read'] },
    { 'Cookie': cookie }
  );
  const roKey = roKeyGen.body.api_key;
  const roWriteRes = await request('POST', '/api/integration/callback/consistency-check',
    { checks: [] },
    { 'X-API-Key': roKey }
  );
  check('Read-only key blocked from write', roWriteRes.status === 403);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 运行冒烟测试**

```powershell
cd mdm-platform && node scripts/smoke-integration.js
```

Expected: 7 个测试全部 PASS。

- [ ] **Step 3: Commit**

```powershell
git add mdm-platform/scripts/smoke-integration.js
git commit -m "test: add integration API smoke test (7 cases including auth gating)"
```

---

### Task 11: 模块 E — 数据质量 KPI 路由

**Files:**
- Create: `mdm-platform/server/routes/quality.js`

- [ ] **Step 1: 创建 quality.js**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

function handleDbError(res, error) {
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

// GET /api/quality/dashboard — 数据质量仪表盘
router.get('/dashboard', requireAuth, (req, res) => {
  try {
    // 完整率：从 master_data_attributes 计算每个 item 的必填字段覆盖率
    const completeness = db.prepare(`
      WITH required_counts AS (
        SELECT c.id as cat_id, COUNT(a.id) as req_count
        FROM master_data_categories c
        JOIN master_data_attributes a ON a.category_id=c.id AND a.required=1
        GROUP BY c.id
      ),
      item_checks AS (
        SELECT i.id, i.category_id, i.attributes_json,
          (SELECT r.req_count FROM required_counts r WHERE r.cat_id = i.category_id) as req_count
        FROM master_data_items i
        WHERE i.status != 'archived'
      )
      SELECT
        COUNT(*) as total_items,
        SUM(CASE WHEN req_count IS NULL OR req_count = 0 THEN 1 ELSE 0 END) as no_req_items,
        ROUND(AVG(CASE WHEN req_count > 0 THEN 1.0 ELSE NULL END) * 100, 1) as completeness_pct
      FROM item_checks
    `).get();

    // 唯一率：有重复编码即为不唯一
    const dupCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT code FROM master_data_items WHERE status != 'archived' GROUP BY code HAVING COUNT(*) > 1
      )
    `).get().cnt;

    const totalItems = db.prepare("SELECT COUNT(*) as cnt FROM master_data_items WHERE status != 'archived'").get().cnt;

    // 及时率：最近 30 天内变更后 24h 内有同步记录的占比
    const timeliness = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM master_data_items WHERE updated_at >= datetime('now', '-30 days')) as changed_30d,
        (SELECT COUNT(*) FROM integration_sync_log WHERE created_at >= datetime('now', '-30 days') AND status='success') as synced_30d
    `).get();

    // 消费一致率：最近回调中的 match 占比
    const consistency = db.prepare(`
      SELECT COUNT(*) as total_checks,
        SUM(CASE WHEN params_json LIKE '%"match":true%' THEN 1 ELSE 0 END) as matched
      FROM integration_sync_log
      WHERE endpoint LIKE '%consistency%' AND created_at >= datetime('now', '-30 days')
    `).get();

    res.json({
      completeness: {
        pct: completeness.completeness_pct || 100,
        target: 99,
        status: (completeness.completeness_pct || 100) >= 99 ? 'pass' : 'warn'
      },
      uniqueness: {
        pct: totalItems > 0 ? Math.round((1 - dupCount / totalItems) * 10000) / 100 : 100,
        duplicate_count: dupCount,
        target: 99,
        status: dupCount === 0 ? 'pass' : 'fail'
      },
      timeliness: {
        changed_count: timeliness.changed_30d,
        synced_count: timeliness.synced_30d,
        pct: timeliness.changed_30d > 0 ? Math.round((timeliness.synced_30d / timeliness.changed_30d) * 100) : 100,
        target: 95,
        status: 'info'
      },
      consistency: {
        total_checks: consistency.total_checks,
        matched: consistency.matched,
        pct: consistency.total_checks > 0 ? Math.round((consistency.matched / consistency.total_checks) * 100) : 100,
        target: 99,
        status: 'info'
      }
    });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/quality/field-identities/progress — 黄金源确认进度（模块 F）
router.get('/field-identities/progress', requireAuth, (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as cnt FROM field_identities').get().cnt;
    const confirmed = db.prepare('SELECT COUNT(*) as cnt FROM field_identities WHERE confirmed=1').get().cnt;

    const byDomain = db.prepare(`
      SELECT fe.data_object as domain, COUNT(fi.id) as total, SUM(CASE WHEN fi.confirmed=1 THEN 1 ELSE 0 END) as confirmed
      FROM field_identities fi
      JOIN field_entries fe ON fi.field_entry_id = fe.id
      GROUP BY fe.data_object
      ORDER BY fe.data_object
    `).all();

    res.json({
      overall: { total, confirmed, pct: total > 0 ? Math.round((confirmed / total) * 100) : 0 },
      by_domain: byDomain.map(d => ({ ...d, pct: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0 }))
    });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
```

- [ ] **Step 2: 注册路由**

在 `index.js` 中添加：

```js
registerRouteIfExists('/api/quality', 'quality');
```

- [ ] **Step 3: Commit**

```powershell
git add mdm-platform/server/routes/quality.js mdm-platform/server/index.js
git commit -m "feat: add data quality KPI dashboard and golden source progress tracking"
```

---

### Task 12: 前端 — 新增 3 个 Tab

**Files:**
- Modify: `mdm-platform/public/index.html`

- [ ] **Step 1: 在导航栏添加 3 个新 Tab 按钮**

在 `<nav class="tabs" id="tabs">` 内的最后一个 `<button>` 之后添加：

```html
<button class="tab" data-tab="masterData" data-roles="submitter,owner,reviewer,admin">主数据台账</button>
<button class="tab" data-tab="masterDataLifecycle" data-roles="owner,reviewer,admin">主数据审批</button>
<button class="tab" data-tab="quality" data-roles="reviewer,admin">数据质量</button>
```

- [ ] **Step 2: 添加主数据台账面板**

在最后一个 `</section>` 之后、`</div>` (page-container 闭合) 之前添加：

```html
<!-- Master Data Panel -->
<section class="panel" id="masterData">
  <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
    <select id="mdCategoryFilter" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px">
      <option value="">全部分类</option>
    </select>
    <select id="mdStatusFilter" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px">
      <option value="">全部状态</option>
      <option value="draft">新增</option>
      <option value="review">审核中</option>
      <option value="active">生效</option>
      <option value="changing">变更中</option>
      <option value="discontinued">停用</option>
      <option value="archived">归档</option>
    </select>
    <input id="mdSearch" placeholder="搜索编码或名称..." style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;width:200px">
    <button class="btn" id="mdSearchBtn">查询</button>
    <button class="btn secondary" id="mdNewItemBtn">+ 新增条目</button>
    <button class="btn secondary" id="mdImportBtn">📥 Excel 导入</button>
    <input type="file" id="mdImportFile" accept=".xlsx" style="display:none">
  </div>
  <div style="display:flex;gap:20px;margin-bottom:16px" id="mdStats">
    <div class="metric"><div class="num" id="mdTotal">0</div><div class="lbl">总条目</div></div>
    <div class="metric"><div class="num" id="mdActive">0</div><div class="lbl">生效中</div></div>
    <div class="metric"><div class="num" id="mdDraft">0</div><div class="lbl">待审核</div></div>
    <div class="metric"><div class="num" id="mdArchived">0</div><div class="lbl">已归档</div></div>
  </div>
  <div class="tw"><table><thead><tr>
    <th>编码</th><th>名称</th><th>分类</th><th>状态</th><th>维护部门</th><th>更新时间</th><th>操作</th>
  </tr></thead><tbody id="mdTableBody"></tbody></table></div>
  <div id="mdPagination" style="margin-top:12px;display:flex;gap:8px;align-items:center"></div>
</section>

<!-- Master Data Lifecycle Panel -->
<section class="panel" id="masterDataLifecycle">
  <h2>变更审批列表</h2>
  <div class="tw"><table><thead><tr>
    <th>变更ID</th><th>物料编码</th><th>物料名称</th><th>变更类型</th><th>变更摘要</th><th>申请人</th><th>审批进度</th><th>状态</th><th>操作</th>
  </tr></thead><tbody id="mdCrTableBody"></tbody></table></div>
  <div id="mdCrDetail" style="display:none;margin-top:16px;padding:20px;background:var(--surface);border-radius:10px">
    <h3>审批详情</h3>
    <div id="mdCrDetailContent"></div>
  </div>
</section>

<!-- Quality Panel -->
<section class="panel" id="quality">
  <h2>数据质量仪表盘</h2>
  <div class="grid g4" style="margin-bottom:24px">
    <div class="metric"><div class="num" id="qComplete">-</div><div class="lbl">完整率 (≥99%)</div><div class="status" id="qCompleteStatus"></div></div>
    <div class="metric"><div class="num" id="qUnique">-</div><div class="lbl">唯一率 (100%)</div><div class="status" id="qUniqueStatus"></div></div>
    <div class="metric"><div class="num" id="qTimely">-</div><div class="lbl">及时率 (≥95%)</div><div class="status" id="qTimelyStatus"></div></div>
    <div class="metric"><div class="num" id="qConsistent">-</div><div class="lbl">消费一致率 (≥99%)</div><div class="status" id="qConsistentStatus"></div></div>
  </div>
  <h2 style="margin-top:32px">黄金源确认进度</h2>
  <div id="goldenSourceProgress" style="margin-bottom:16px"></div>
  <div id="goldenSourceChart" class="chart" style="height:300px"></div>
</section>
```

- [ ] **Step 3: 添加主数据 Tab 的 JavaScript 逻辑**

在现有 `<script>` 标签内，找到 tab 切换和面板渲染逻辑所在区域，追加以下函数。在文件末尾 `</script>` 之前添加：

```js
// ── Master Data Tab ──
async function loadMdCategories() {
  const res = await fetch('/api/master-data/categories');
  const cats = await res.json();
  const sel = document.getElementById('mdCategoryFilter');
  sel.innerHTML = '<option value="">全部分类</option>' + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

async function loadMasterData(page = 1) {
  const catId = document.getElementById('mdCategoryFilter').value;
  const status = document.getElementById('mdStatusFilter').value;
  const search = document.getElementById('mdSearch').value;
  const params = new URLSearchParams({ page, limit: 30 });
  if (catId) params.set('category_id', catId);
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const res = await fetch('/api/master-data/items?' + params);
  const data = await res.json();

  document.getElementById('mdTableBody').innerHTML = data.rows.map(r => `
    <tr>
      <td><code>${escHtml(r.code)}</code></td>
      <td>${escHtml(r.name)}</td>
      <td>${escHtml(r.category_name)}</td>
      <td><span class="badge">${escHtml(r.status)}</span></td>
      <td>${escHtml(r.maintain_dept_name || '-')}</td>
      <td>${escHtml(r.updated_at || '-')}</td>
      <td><a href="#md-detail" onclick="viewMdItem('${escHtml(r.code)}')">详情</a></td>
    </tr>
  `).join('') || '<tr><td colspan="7" style="text-align:center">暂无数据</td></tr>';

  document.getElementById('mdTotal').textContent = data.total;
  document.getElementById('mdPagination').innerHTML = Array.from({ length: Math.ceil(data.total / data.limit) }, (_, i) =>
    `<button class="btn ${i+1===page?'':'secondary'}" onclick="loadMasterData(${i+1})">${i+1}</button>`
  ).join('');
}

async function loadMdStats() {
  const [active, draft, archived] = await Promise.all([
    fetch('/api/master-data/items?status=active&limit=1').then(r => r.json()),
    fetch('/api/master-data/items?status=draft&limit=1').then(r => r.json()),
    fetch('/api/master-data/items?status=archived&limit=1').then(r => r.json())
  ]);
  document.getElementById('mdActive').textContent = active.total;
  document.getElementById('mdDraft').textContent = draft.total;
  document.getElementById('mdArchived').textContent = archived.total;
}

document.getElementById('mdSearchBtn').addEventListener('click', () => loadMasterData());
document.getElementById('mdNewItemBtn').addEventListener('click', () => {
  const catId = document.getElementById('mdCategoryFilter').value;
  if (!catId) { alert('请先选择分类'); return; }
  const name = prompt('名称：');
  if (!name) return;
  fetch('/api/master-data/items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_id: Number(catId), name, attributes: {} })
  }).then(r => r.json()).then(data => {
    if (data.code) { alert('创建成功，编码：' + data.code); loadMasterData(); loadMdStats(); }
    else alert('创建失败：' + (data.error || '未知错误'));
  });
});

document.getElementById('mdImportBtn').addEventListener('click', () => document.getElementById('mdImportFile').click());
document.getElementById('mdImportFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const catId = document.getElementById('mdCategoryFilter').value;
  if (!catId) { alert('请先选择分类'); return; }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('category_id', catId);

  const res = await fetch('/api/master-data/import', { method: 'POST', body: formData });
  const data = await res.json();
  alert(`导入完成：成功 ${data.success_rows} 条，失败 ${data.error_rows} 条`);
  loadMasterData();
  loadMdStats();
  e.target.value = '';
});

// ── Lifecycle Tab ──
async function loadChangeRequests() {
  const res = await fetch('/api/master-data/change-requests');
  const data = await res.json();
  document.getElementById('mdCrTableBody').innerHTML = data.map(cr => `
    <tr>
      <td>#${cr.id}</td>
      <td><code>${escHtml(cr.item_code)}</code></td>
      <td>${escHtml(cr.item_name)}</td>
      <td>${escHtml(cr.request_type)}</td>
      <td>${escHtml(cr.change_summary)}</td>
      <td>${escHtml(cr.requested_by_name || '-')}</td>
      <td>${escHtml(cr.approval_statuses || '-')}</td>
      <td>${escHtml(cr.status)}</td>
      <td><a href="#" onclick="viewChangeRequest(${cr.id});return false">详情</a></td>
    </tr>
  `).join('') || '<tr><td colspan="9" style="text-align:center">暂无变更申请</td></tr>';
}

async function viewChangeRequest(id) {
  const res = await fetch(`/api/master-data/change-requests/${id}`);
  const cr = await res.json();
  document.getElementById('mdCrDetail').style.display = 'block';
  document.getElementById('mdCrDetailContent').innerHTML = `
    <p><strong>物料：</strong>${escHtml(cr.item_code)} ${escHtml(cr.item_name)}</p>
    <p><strong>变更类型：</strong>${escHtml(cr.request_type)}</p>
    <p><strong>摘要：</strong>${escHtml(cr.change_summary)}</p>
    <p><strong>旧值：</strong>${escHtml(cr.old_values_json)}</p>
    <p><strong>新值：</strong>${escHtml(cr.new_values_json)}</p>
    <p><strong>状态：</strong>${escHtml(cr.status)}</p>
    <h4 style="margin-top:12px">审批步骤</h4>
    ${cr.approvals.map(a => `
      <div style="padding:8px;margin:4px 0;border:1px solid var(--border);border-radius:6px">
        步骤${a.step_order}: ${escHtml(a.dept_name)} —
        <span style="color:${a.status==='approved'?'var(--success)':a.status==='rejected'?'var(--error)':'var(--text-muted)'}">${escHtml(a.status)}</span>
        ${a.opinion ? ` — ${escHtml(a.opinion)}` : ''}
        ${a.status === 'pending' && cr.status !== 'rejected' ? `<button class="btn" onclick="approveStep(${cr.id},${a.step_order},'approved')">通过</button><button class="btn" style="background:var(--error)" onclick="approveStep(${cr.id},${a.step_order},'rejected')">退回</button>` : ''}
      </div>
    `).join('')}
  `;
}

async function approveStep(crId, stepOrder, action) {
  const opinion = prompt('审批意见（可选）：') || '';
  const res = await fetch(`/api/master-data/change-requests/${crId}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step_order: stepOrder, action, opinion })
  });
  const data = await res.json();
  if (data.success) { alert('审批完成'); viewChangeRequest(crId); loadChangeRequests(); }
  else alert('审批失败：' + (data.error || '未知错误'));
}

// ── Quality Tab ──
async function loadQualityDashboard() {
  const res = await fetch('/api/quality/dashboard');
  const data = await res.json();

  document.getElementById('qComplete').textContent = data.completeness.pct + '%';
  document.getElementById('qCompleteStatus').textContent = data.completeness.status === 'pass' ? '✓' : '⚠';
  document.getElementById('qUnique').textContent = data.uniqueness.pct + '%';
  document.getElementById('qUniqueStatus').textContent = data.uniqueness.status === 'pass' ? '✓' : '✗';
  document.getElementById('qTimely').textContent = data.timeliness.pct + '%';
  document.getElementById('qConsistent').textContent = data.consistency.pct + '%';
}

async function loadGoldenSourceProgress() {
  const res = await fetch('/api/quality/field-identities/progress');
  const data = await res.json();
  document.getElementById('goldenSourceProgress').innerHTML =
    `<p>总体进度：${data.overall.confirmed}/${data.overall.total} 已确认 (${data.overall.pct}%)</p>` +
    data.by_domain.map(d => `<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="min-width:120px">${escHtml(d.domain || '未分类')}</span><div style="flex:1;height:8px;background:var(--border);border-radius:4px"><div style="width:${d.pct}%;height:8px;background:var(--accent);border-radius:4px"></div></div><span>${d.confirmed}/${d.total}</span></div>`).join('');
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

- [ ] **Step 4: 在 tab 切换逻辑中注册新面板的渲染**

找到已有的 tab 切换逻辑（通常类似 `document.querySelectorAll('.tab').forEach(...)`），在 `case 'masterData':` 块中添加 `loadMdCategories(); loadMasterData(); loadMdStats();`，在 `case 'masterDataLifecycle':` 中添加 `loadChangeRequests();`，在 `case 'quality':` 中添加 `loadQualityDashboard(); loadGoldenSourceProgress();`。

- [ ] **Step 5: Commit**

```powershell
git add mdm-platform/public/index.html
git commit -m "feat: add master data, lifecycle approval, and quality dashboard UI tabs"
```

---

### Task 13: 联调验证与收尾

- [ ] **Step 1: 重建数据库并启动服务**

```powershell
cd mdm-platform && npm run init-db && npm start
```

- [ ] **Step 2: 运行全量冒烟测试**

```powershell
# 先确保服务运行中，然后：
cd mdm-platform
node scripts/smoke-master-data.js && node scripts/smoke-integration.js
```

Expected: 两套冒烟测试均通过。

- [ ] **Step 3: 在浏览器中验证前端**

打开 `http://localhost:3000`，登录后切换至「主数据台账」「主数据审批」「数据质量」三个 Tab，依次验证：列表渲染、搜索过滤、新增条目、Excel 导入、变更审批流转、KPI 数值、黄金源进度条。

- [ ] **Step 4: 更新 CLAUDE.md 中的路由和测试命令**

在 `mdm-platform/CLAUDE.md`（如果存在）或根目录 `CLAUDE.md` 中，补充新增的路由和测试脚本说明：

```markdown
### 新增模块 (MDM 拓展)

```bash
npm test:master-data          # 主数据模块冒烟测试
npm test:integration           # 集成接口冒烟测试
```

**新增路由：**
- `/api/master-data/*` — 主数据 CRUD、编码引擎、Excel 导入、去重合并
- `/api/master-data/change-requests/*` — 生命周期状态机、多级会签审批
- `/api/integration/*` — 外部系统同步 API
- `/api/quality/*` — 数据质量 KPI 仪表盘、黄金源确认进度
```

- [ ] **Step 5: Commit**

```powershell
git add mdm-platform/CLAUDE.md
git commit -m "docs: update CLAUDE.md with new MDM expansion routes and test commands"
```

---

## 实施顺序与依赖

```
Task 1 (DB: 6 tables) ──→ Task 2 (Route: masterData CRUD) ──→ Task 3 (Smoke test)
                                        │
Task 4 (DB: 3 tables) ──→ Task 5 (Route: lifecycle)
                                        │
                    Task 6 (Auth/access upgrade)
                                        │
Task 7 (DB: 3 tables) ──→ Task 8 (integrationAuth) ──→ Task 9 (Route: integration) ──→ Task 10 (Smoke test)
                                        │
                     Task 11 (Route: quality KPI)
                                        │
                     Task 12 (Frontend: 3 tabs)
                                        │
                     Task 13 (Integration verification)
```

Task 1-3（模块 A）必须率先完成。Task 6（模块 C）在 Task 2 之后、Task 12 之前完成即可。Task 12（前端）需等所有路由模块就位后统一添加。
