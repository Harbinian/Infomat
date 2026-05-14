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
  const capabilities = db.prepare(`
    SELECT c.*, d.name as dept_name, pc.name as parent_name
    FROM capabilities c
    LEFT JOIN departments d ON c.owner_dept_id = d.id
    LEFT JOIN capabilities pc ON c.parent_id = pc.id
    ORDER BY c.level, c.name
  `).all();
  res.json(capabilities);
});

router.post('/', requireRole('admin'), (req, res) => {
  return runDbAction(res, () => {
    const { name, level, owner_dept_id, parent_id } = req.body;
    const stmt = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id, parent_id, created_by) VALUES (?, ?, ?, ?, ?)');
    const result = stmt.run(name, level, owner_dept_id || null, parent_id || null, req.session.userId);
    res.json({ id: result.lastInsertRowid });
  });
});

router.put('/:id', requireRole('admin'), (req, res) => {
  return runDbAction(res, () => {
    const { name, level, owner_dept_id, parent_id } = req.body;
    db.prepare('UPDATE capabilities SET name=?, level=?, owner_dept_id=?, parent_id=? WHERE id=?').run(
      name,
      level,
      owner_dept_id || null,
      parent_id || null,
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
      UPDATE capabilities 
      SET status=?, approval_opinion=?, approved_by=?, approved_at=CURRENT_TIMESTAMP 
      WHERE id=?
    `).run(status, opinion || null, req.session.userId, req.params.id);
    
    res.json({ success: true });
  });
});

module.exports = router;
