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

router.get('/', requireAuth, applyFieldConstraints('class_node'), (req, res) => {
  try {
    const { class_type } = req.query;
    let sql = `SELECT cn.*, p.class_name as parent_name FROM class_node cn LEFT JOIN class_node p ON cn.parent_class_node_id = p.class_node_id WHERE 1=1`;
    const params = [];
    if (class_type) { sql += ' AND cn.class_type=?'; params.push(class_type); }
    sql += ' ORDER BY cn.class_type, cn.class_code';
    res.json(db.prepare(sql).all(...params));
  } catch (e) { handleDbError(res, e); }
});

router.get('/:code', requireAuth, applyFieldConstraints('class_node'), (req, res) => {
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

router.get('/:code/members', requireAuth, applyFieldConstraints('class_node'), (req, res) => {
  try {
    const node = db.prepare('SELECT class_node_id FROM class_node WHERE class_code=?').get(req.params.code);
    if (!node) return res.status(404).json({ error: '分类不存在' });
    const { entity_type } = req.query;
    let sql = `SELECT m.* FROM entity_class_membership m WHERE m.class_node_id=?`;
    const params = [node.class_node_id];
    if (entity_type) { sql += ' AND m.entity_type=?'; params.push(entity_type); }
    res.json(db.prepare(sql).all(...params));
  } catch (e) { handleDbError(res, e); }
});

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

router.delete('/memberships/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const r = db.prepare('DELETE FROM entity_class_membership WHERE membership_id=?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: '关联不存在' });
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

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

module.exports = router;
