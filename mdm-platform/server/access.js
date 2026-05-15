const db = require('./db');

function isAdmin(req) {
  return req.session && req.session.userRole === 'admin';
}

function isReviewerOrAdmin(req) {
  return req.session && ['reviewer', 'admin'].includes(req.session.userRole);
}

function validateAction(action) {
  return ['approve', 'reject'].includes(action);
}

function mappingVisibility(alias, req) {
  if (isReviewerOrAdmin(req)) return { sql: '', params: [] };

  const table = alias || 'm';
  const params = [req.session.userId];
  const clauses = [`${table}.submitted_by=?`];

  if (req.session.departmentId) {
    clauses.push(`${table}.owner_dept_id=?`);
    params.push(req.session.departmentId);
    clauses.push(`${table}.approval_dept_id=?`);
    params.push(req.session.departmentId);
    clauses.push(`EXISTS (
      SELECT 1 FROM mapping_related_departments mrd
      WHERE mrd.mapping_id=${table}.id AND mrd.department_id=?
    )`);
    params.push(req.session.departmentId);
    clauses.push(`EXISTS (
      SELECT 1 FROM approval_tasks at
      WHERE at.mapping_id=${table}.id AND (at.assignee_user_id=? OR at.assigned_dept_id=?)
    )`);
    params.push(req.session.userId, req.session.departmentId);
  } else {
    clauses.push(`EXISTS (
      SELECT 1 FROM approval_tasks at
      WHERE at.mapping_id=${table}.id AND at.assignee_user_id=?
    )`);
    params.push(req.session.userId);
  }

  return { sql: ` AND (${clauses.join(' OR ')})`, params };
}

function canViewMapping(req, mappingId) {
  const visibility = mappingVisibility('m', req);
  const row = db.prepare(`SELECT m.id FROM mappings m WHERE m.id=?${visibility.sql}`).get(mappingId, ...visibility.params);
  return Boolean(row);
}

function canUseTodo(req, todo) {
  if (!todo) return false;
  if (isAdmin(req)) return true;
  return Boolean(todo.to_dept_id && req.session.departmentId && todo.to_dept_id === req.session.departmentId);
}

function masterDataVisibility(alias, req) {
  if (isAdmin(req)) return { sql: '', params: [] };

  const table = alias || 'i';
  const params = [];
  const clauses = [];

  if (req.session.departmentId) {
    clauses.push(`${table}.maintain_dept_id=?`);
    params.push(req.session.departmentId);
    clauses.push(`${table}.created_by=?`);
    params.push(req.session.userId);
  }

  return { sql: ` AND (${clauses.join(' OR ')})`, params };
}

module.exports = {
  isAdmin,
  isReviewerOrAdmin,
  validateAction,
  mappingVisibility,
  canViewMapping,
  canUseTodo,
  masterDataVisibility
};
