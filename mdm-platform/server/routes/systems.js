const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');

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
  const systems = db.prepare('SELECT * FROM systems ORDER BY name').all();
  res.json(systems);
});

router.post('/', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const { name, dept_id } = req.body;
    const stmt = db.prepare('INSERT INTO systems (name, dept_id) VALUES (?, ?)');
    const result = stmt.run(name, dept_id || null);
    res.json({ id: result.lastInsertRowid });
  });
});

router.put('/:id', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const { name, dept_id } = req.body;
    db.prepare('UPDATE systems SET name=?, dept_id=? WHERE id=?').run(name, dept_id || null, req.params.id);
    res.json({ success: true });
  });
});

router.delete('/:id', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    db.prepare('DELETE FROM systems WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });
});

module.exports = router;
