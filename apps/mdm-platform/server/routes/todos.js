const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');
const { canUseTodo, getEffectiveRoleCodes, isAdmin } = require('../access');

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
  return runDbAction(res, () => {
    const { dept_id, status, type } = req.query;
    const userDeptId = req.session.departmentId;
    const roleCodes = getEffectiveRoleCodes(req);

    let sql = `SELECT t.*, fd.name as from_dept_name, td.name as to_dept_name
               FROM todos t
               LEFT JOIN departments fd ON t.from_dept_id = fd.id
               LEFT JOIN departments td ON t.to_dept_id = td.id
               WHERE 1=1`;
    const params = [];

    if (!isAdmin(req)) {
      const roleClauses = [];
      if (roleCodes.has('owner') && userDeptId) {
        roleClauses.push('t.to_dept_id = ?');
        params.push(userDeptId);
      }
      if (roleCodes.has('reviewer')) {
        roleClauses.push('t.type IN (?, ?, ?)');
        params.push('field_confirm', 'gold_source', 'conflict_resolution');
      }
      if (roleCodes.has('submitter')) {
        roleClauses.push('t.type IN (?, ?)');
        params.push('general', 'terminology');
      }

      sql += roleClauses.length ? ` AND (${roleClauses.join(' OR ')})` : ' AND 1=0';
    }

    if (dept_id) {
      sql += ' AND t.to_dept_id = ?';
      params.push(dept_id);
    }
    if (status) {
      sql += ' AND t.status = ?';
      params.push(status);
    }
    if (type) {
      sql += ' AND t.type = ?';
      params.push(type);
    }

    sql += ` ORDER BY
      CASE t.urgency WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 2 END DESC,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date ASC,
      t.created_at ASC`;

    res.json(db.prepare(sql).all(...params));
  });
});

router.post('/', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: '仅管理员可创建待办' });
    }
    const { from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, due_date, urgency } = req.body;
    const stmt = db.prepare(`
      INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, due_date, urgency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      from_dept_id || null,
      to_dept_id || null,
      type,
      related_mapping_id || null,
      related_field_id || null,
      content,
      due_date || null,
      urgency || 'medium'
    );
    res.json({ id: result.lastInsertRowid });
  });
});

router.post('/:id/done', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const todo = db.prepare('SELECT * FROM todos WHERE id=?').get(req.params.id);
    if (!todo) return res.status(404).json({ error: '待办不存在' });
    if (!canUseTodo(req, todo)) return res.status(403).json({ error: '无权处理该待办' });
    db.prepare("UPDATE todos SET status='done', done_at=datetime('now') WHERE id=?").run(req.params.id);
    res.json({ success: true });
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const todo = db.prepare('SELECT * FROM todos WHERE id=?').get(req.params.id);
    if (!todo) return res.status(404).json({ error: '待办不存在' });
    if (!canUseTodo(req, todo)) return res.status(403).json({ error: '无权删除该待办' });
    db.prepare('DELETE FROM todos WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });
});

module.exports = router;
