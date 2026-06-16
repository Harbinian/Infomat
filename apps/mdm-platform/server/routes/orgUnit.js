const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requirePermission, applyFieldConstraints } = require('../auth');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function wouldCreateCycle(currentId, nextParentId) {
  if (!nextParentId) return false;
  let cursor = Number(nextParentId);
  const seen = new Set([Number(currentId)]);
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const row = db.prepare('SELECT parent_org_unit_id AS parent_id FROM org_unit WHERE org_unit_id=?').get(cursor);
    cursor = row && row.parent_id ? Number(row.parent_id) : null;
  }
  return false;
}

router.get('/', requireAuth, applyFieldConstraints('org_unit'), (req, res) => {
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

router.get('/:code', requireAuth, applyFieldConstraints('org_unit'), (req, res) => {
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

router.post('/', requireAuth, requirePermission('org_unit:create'), (req, res) => {
  res.status(403).json({ error: '组织架构由组织架构真源同步生成，不能手动新增' });
});

router.post('/:code/activate', requireAuth, requirePermission('org_unit:update'), (req, res) => {
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

router.put('/:code', requireAuth, requirePermission('org_unit:update'), (req, res) => {
  try {
    const { org_unit_name, parent_org_unit_id, manager_person_id, status } = req.body;
    const existing = db.prepare('SELECT * FROM org_unit WHERE org_unit_code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '组织不存在' });
    const nextParentId = parent_org_unit_id !== undefined ? parent_org_unit_id : existing.parent_org_unit_id;
    if (wouldCreateCycle(existing.org_unit_id, nextParentId)) {
      return res.status(409).json({ error: '组织层级不能形成循环' });
    }
    db.prepare(`
      UPDATE org_unit SET org_unit_name=?, parent_org_unit_id=?, manager_person_id=?, status=?,
        updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE org_unit_code=?
    `).run(
      org_unit_name || existing.org_unit_name,
      nextParentId,
      manager_person_id !== undefined ? manager_person_id : existing.manager_person_id,
      status || existing.status,
      req.session.userId, req.params.code
    );
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

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

module.exports = router;
