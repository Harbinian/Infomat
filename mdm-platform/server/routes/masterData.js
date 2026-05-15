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
