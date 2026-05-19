const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, applyFieldConstraints } = require('../auth');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

router.get('/defs', requireAuth, applyFieldConstraints('attribute'), (req, res) => {
  try {
    const { applies_to } = req.query;
    let sql = `SELECT * FROM attribute_def WHERE 1=1`;
    const params = [];
    if (applies_to) { sql += ' AND applies_to=?'; params.push(applies_to); }
    sql += ' ORDER BY applies_to, attribute_code';
    res.json(db.prepare(sql).all(...params));
  } catch (e) { handleDbError(res, e); }
});

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

router.get('/values', requireAuth, applyFieldConstraints('attribute'), (req, res) => {
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
