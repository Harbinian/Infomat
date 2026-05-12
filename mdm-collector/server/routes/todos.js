const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

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
  const { dept_id, status, type } = req.query;
  let sql = `SELECT t.*, fd.name as from_dept_name, td.name as to_dept_name
             FROM todos t
             LEFT JOIN departments fd ON t.from_dept_id = fd.id
             LEFT JOIN departments td ON t.to_dept_id = td.id
             WHERE 1=1`;
  const params = [];

  if (dept_id) {
    sql += ' AND t.to_dept_id=?';
    params.push(dept_id);
  }
  if (status) {
    sql += ' AND t.status=?';
    params.push(status);
  }
  if (type) {
    sql += ' AND t.type=?';
    params.push(type);
  }

  sql += ' ORDER BY t.due_date ASC, t.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, due_date } = req.body;
    const stmt = db.prepare(`
      INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      from_dept_id || null,
      to_dept_id || null,
      type,
      related_mapping_id || null,
      related_field_id || null,
      content,
      due_date || null
    );
    res.json({ id: result.lastInsertRowid });
  });
});

router.post('/:id/done', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    db.prepare("UPDATE todos SET status='done', done_at=datetime('now') WHERE id=?").run(req.params.id);
    res.json({ success: true });
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    db.prepare('DELETE FROM todos WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });
});

module.exports = router;
