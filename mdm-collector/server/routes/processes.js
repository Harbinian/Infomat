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

router.post('/', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { name, capability_id, owner_dept_id } = req.body;
    const stmt = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id) VALUES (?, ?, ?)');
    const result = stmt.run(name, capability_id || null, owner_dept_id || null);
    res.json({ id: result.lastInsertRowid });
  });
});

router.put('/:id', requireAuth, (req, res) => {
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

module.exports = router;
