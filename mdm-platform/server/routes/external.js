const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requirePermission, isAdmin } = require('../auth');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function hideExternalKeyForNonAdmin(row, req) {
  if (row && !isAdmin(req)) {
    const r = { ...row };
    delete r.external_key;
    return r;
  }
  return row;
}

router.get('/systems', requireAuth, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM external_system ORDER BY system_code').all());
  } catch (e) { handleDbError(res, e); }
});

router.post('/systems', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const { system_code, system_name } = req.body;
    if (!system_code || !system_name) return res.status(400).json({ error: '缺少 system_code/system_name' });
    const result = db.prepare('INSERT INTO external_system (system_code, system_name, created_by) VALUES (?, ?, ?)')
      .run(system_code.toUpperCase(), system_name, req.session.userId);
    res.status(201).json({ system_id: result.lastInsertRowid });
  } catch (e) { handleDbError(res, e); }
});

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

router.post('/identities', requireAuth, requirePermission('admin:access'), (req, res) => {
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
