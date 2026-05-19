const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { validateAction } = require('../access');

function handleDbError(res, error) {
  if (error && (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(error.message).includes('UNIQUE constraint failed'))) {
    return res.status(409).json({ error: '术语已存在' });
  }
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
  const { status } = req.query;
  let sql = 'SELECT * FROM terms';
  const params = [];

  if (status) {
    sql += ' WHERE status=?';
    params.push(status);
  }

  sql += ' ORDER BY term';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { term, definition, scope, forbidden, process_id } = req.body;
    const stmt = db.prepare('INSERT INTO terms (term, definition, scope, forbidden, process_id, created_by) VALUES (?, ?, ?, ?, ?, ?)');
    const result = stmt.run(term, definition || null, scope || null, forbidden || null, process_id || null, req.session.userId);
    res.json({ id: result.lastInsertRowid });
  });
});

router.put('/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const existing = db.prepare('SELECT * FROM terms WHERE id=?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '术语不存在' });
    if (req.session.userRole !== 'admin' && (existing.created_by !== req.session.userId || existing.status !== 'pending')) {
      return res.status(403).json({ error: '仅创建人可修改待审术语，或由管理员维护术语' });
    }
    const { term, definition, scope, forbidden, process_id } = req.body;
    db.prepare('UPDATE terms SET term=?, definition=?, scope=?, forbidden=?, process_id=? WHERE id=?').run(
      term,
      definition || null,
      scope || null,
      forbidden || null,
      process_id || null,
      req.params.id
    );
    res.json({ success: true });
  });
});

router.post('/:id/review', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const { action } = req.body;
    if (!validateAction(action)) {
      return res.status(400).json({ error: '不支持的审核操作' });
    }
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    db.prepare("UPDATE terms SET status=?, approved_by=?, approved_at=datetime('now') WHERE id=?").run(
      newStatus,
      req.session.userId,
      req.params.id
    );
    res.json({ success: true });
  });
});

module.exports = router;
