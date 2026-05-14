const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { validateAction } = require('../access');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runDbAction(res, action) {
  try {
    return action();
  } catch (error) {
    return handleDbError(res, error);
  }
}

router.get('/', requireAuth, (req, res) => {
  const { capability_id, owner_dept_id } = req.query;
  let sql = `SELECT p.*, c.name as cap_name, d.name as dept_name
             FROM processes p
             LEFT JOIN capabilities c ON p.capability_id = c.id
             LEFT JOIN departments d ON p.owner_dept_id = d.id
             WHERE 1=1`;
  const params = [];

  if (capability_id) {
    sql += ' AND p.capability_id=?';
    params.push(capability_id);
  }
  if (owner_dept_id) {
    sql += ' AND p.owner_dept_id=?';
    params.push(owner_dept_id);
  }

  sql += ' ORDER BY p.name';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireRole('admin'), (req, res) => {
  return runDbAction(res, () => {
    const { name, capability_id, owner_dept_id } = req.body;
    const stmt = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id, created_by) VALUES (?, ?, ?, ?)');
    const result = stmt.run(name, capability_id || null, owner_dept_id || null, req.session.userId);
    res.json({ id: result.lastInsertRowid });
  });
});

router.put('/:id', requireRole('admin'), (req, res) => {
  return runDbAction(res, () => {
    const { name, capability_id, owner_dept_id } = req.body;
    db.prepare('UPDATE processes SET name=?, capability_id=?, owner_dept_id=? WHERE id=?').run(
      name,
      capability_id || null,
      owner_dept_id || null,
      req.params.id
    );
    res.json({ success: true });
  });
});

router.post('/:id/review', requireRole('reviewer', 'admin'), (req, res) => {
  return runDbAction(res, () => {
    const { action, opinion } = req.body; // action: 'approve' or 'reject'
    if (!validateAction(action)) {
      return res.status(400).json({ error: '不支持的审核操作' });
    }
    const status = action === 'approve' ? 'approved' : 'rejected';
    
    db.prepare(`
      UPDATE processes 
      SET status=?, approval_opinion=?, approved_by=?, approved_at=CURRENT_TIMESTAMP 
      WHERE id=?
    `).run(status, opinion || null, req.session.userId, req.params.id);
    
    res.json({ success: true });
  });
});

module.exports = router;
