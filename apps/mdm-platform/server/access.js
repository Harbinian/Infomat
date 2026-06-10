const db = require('./db');
const { getUserEffectivePermissions } = require('./auth');

function isAdmin(req) {
  if (!req.session || !req.session.userId) return false;
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  return permSet.has('admin:access') || permSet.has('*:*');
}

function hasGlobalView(req) {
  if (!req.session || !req.session.userId) return false;
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  return permSet.has('data:view_all') || permSet.has('admin:access') || permSet.has('*:*');
}

function isReviewerOrAdmin(req) {
  if (!req.session || !req.session.userId) return false;
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  return permSet.has('admin:access') || permSet.has('review:approve') || permSet.has('*:*');
}

function getEffectiveRoleCodes(req) {
  const codes = new Set();
  if (!req.session || !req.session.userId) return codes;
  if (req.session.userRole) codes.add(req.session.userRole);
  const rows = db.prepare(`
    SELECT r.role_code
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.role_id
    WHERE ur.user_id=?
  `).all(req.session.userId);
  for (const row of rows) {
    if (row.role_code) codes.add(row.role_code);
  }
  return codes;
}

function validateAction(action) {
  return ['approve', 'reject'].includes(action);
}

function mappingVisibility(alias, req) {
  if (hasGlobalView(req)) return { sql: '', params: [] };
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

module.exports = { isAdmin, hasGlobalView, isReviewerOrAdmin, getEffectiveRoleCodes, validateAction, mappingVisibility, canViewMapping, canUseTodo };
