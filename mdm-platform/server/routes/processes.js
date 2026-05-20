const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
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

router.post('/', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const { name, capability_id, owner_dept_id } = req.body;
    const stmt = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id, created_by) VALUES (?, ?, ?, ?)');
    const result = stmt.run(name, capability_id || null, owner_dept_id || null, req.session.userId);
    res.json({ id: result.lastInsertRowid });
  });
});

router.put('/:id', requirePermission('admin:access'), (req, res) => {
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

router.post('/:id/review', requirePermission('review:approve'), (req, res) => {
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

router.delete('/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const proc = db.prepare('SELECT * FROM processes WHERE id=?').get(req.params.id);
    if (!proc) return res.status(404).json({ error: '流程不存在' });

    const cascaded = {};
    const mappings = db.prepare('SELECT id FROM mappings WHERE process_id=?').all(proc.id);
    let fieldConflicts = 0;
    let fieldIdentities = 0;
    let fieldRejections = 0;
    let fieldEntries = 0;
    let approvalTasks = 0;
    let approvalHistory = 0;
    let todos = 0;
    let relatedDepartments = 0;
    let mappingSystems = 0;

    for (const mapping of mappings) {
      fieldConflicts += db.prepare(`
        DELETE FROM field_conflicts
        WHERE field_entry_a_id IN (SELECT id FROM field_entries WHERE mapping_id=?)
           OR field_entry_b_id IN (SELECT id FROM field_entries WHERE mapping_id=?)
      `).run(mapping.id, mapping.id).changes;
      fieldIdentities += db.prepare('DELETE FROM field_identities WHERE field_entry_id IN (SELECT id FROM field_entries WHERE mapping_id=?)').run(mapping.id).changes;
      fieldRejections += db.prepare('DELETE FROM field_rejection_reasons WHERE mapping_id=?').run(mapping.id).changes;
      fieldEntries += db.prepare('DELETE FROM field_entries WHERE mapping_id=?').run(mapping.id).changes;
      approvalTasks += db.prepare('DELETE FROM approval_tasks WHERE mapping_id=?').run(mapping.id).changes;
      approvalHistory += db.prepare('DELETE FROM approval_history WHERE mapping_id=?').run(mapping.id).changes;
      todos += db.prepare('DELETE FROM todos WHERE related_mapping_id=?').run(mapping.id).changes;
      relatedDepartments += db.prepare('DELETE FROM mapping_related_departments WHERE mapping_id=?').run(mapping.id).changes;
      mappingSystems += db.prepare('DELETE FROM mapping_systems WHERE mapping_id=?').run(mapping.id).changes;
    }

    cascaded.field_conflicts = fieldConflicts;
    cascaded.field_identities = fieldIdentities;
    cascaded.field_rejections = fieldRejections;
    cascaded.field_entries = fieldEntries;
    cascaded.approval_tasks = approvalTasks;
    cascaded.approval_history = approvalHistory;
    cascaded.todos = todos;
    cascaded.related_departments = relatedDepartments;
    cascaded.mapping_systems = mappingSystems;
    cascaded.mappings = db.prepare('DELETE FROM mappings WHERE process_id=?').run(proc.id).changes;
    cascaded.term_links_cleared = db.prepare('UPDATE terms SET process_id=NULL WHERE process_id=?').run(proc.id).changes;

    db.prepare('DELETE FROM processes WHERE id=?').run(proc.id);
    res.json({ success: true, cascaded });
  });
});

module.exports = router;
