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
    res.status(201).json({ position_code: code });
  } catch (e) { handleDbError(res, e); }
});

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
