// check-escalations.js — standalone script to check and escalate overdue conflicts
// Run: node scripts/check-escalations.js

const db = require('../server/db');

const today = new Date().toISOString().slice(0, 10);

function escalate(table, conflict) {
  db.prepare(`UPDATE ${table} SET status = 'escalated', escalated = 1 WHERE id = ?`).run(conflict.id);

  const reviewers = db.prepare("SELECT id, department_id FROM users WHERE role IN ('reviewer','admin')").all();
  reviewers.forEach(function(r) {
    db.prepare(`
      INSERT INTO todos (from_dept_id, to_dept_id, type, content, urgency)
      VALUES (NULL, ?, 'conflict_resolution', ?, 'high')
    `).run(r.department_id, '冲突升级：#' + conflict.id + ' 已超时，请 reviewer 终裁');
  });
  console.log('Escalated conflict #' + conflict.id + ' (' + table + ')');
}

const fieldOverdue = db.prepare(`
  SELECT * FROM field_conflicts WHERE status = 'coordinating' AND deadline < ?
`).all(today);

const termOverdue = db.prepare(`
  SELECT * FROM term_conflicts WHERE status = 'coordinating' AND deadline < ?
`).all(today);

fieldOverdue.forEach(function(c) { escalate('field_conflicts', c); });
termOverdue.forEach(function(c) { escalate('term_conflicts', c); });

const total = fieldOverdue.length + termOverdue.length;
if (total === 0) {
  console.log('No overdue conflicts. Checked ' + today);
} else {
  console.log('Escalated ' + total + ' overdue conflict(s).');
}
