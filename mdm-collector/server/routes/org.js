const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, verifyPassword, requireAuth, requireRole } = require('../auth');

router.get('/departments', requireAuth, (req, res) => {
  const depts = db.prepare('SELECT * FROM departments ORDER BY code').all();
  res.json(depts);
});

router.post('/departments', requireRole('admin'), (req, res) => {
  const { name, code, parent_id, manager_user_id } = req.body;
  const stmt = db.prepare('INSERT INTO departments (name, code, parent_id, manager_user_id) VALUES (?, ?, ?, ?)');
  const result = stmt.run(name, code, parent_id || null, manager_user_id || null);
  res.json({ id: result.lastInsertRowid });
});

router.put('/departments/:id', requireRole('admin'), (req, res) => {
  const { name, code, parent_id, manager_user_id } = req.body;
  const stmt = db.prepare('UPDATE departments SET name=?, code=?, parent_id=?, manager_user_id=? WHERE id=?');
  stmt.run(name, code, parent_id || null, manager_user_id || null, req.params.id);
  res.json({ success: true });
});

router.delete('/departments/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM departments WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.get('/users', requireAuth, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.employee_no, u.department_id, u.post, u.role, u.created_at, d.name as dept_name
    FROM users u
    LEFT JOIN departments d ON u.department_id = d.id
    ORDER BY u.employee_no
  `).all();
  res.json(users);
});

router.post('/users', requireRole('admin'), (req, res) => {
  const { name, employee_no, department_id, post, role, password } = req.body;
  const hash = hashPassword(password || 'init1234');
  const stmt = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)');
  const result = stmt.run(name, employee_no, department_id || null, post || null, role || 'submitter', hash);
  res.json({ id: result.lastInsertRowid });
});

router.put('/users/:id', requireRole('admin'), (req, res) => {
  const { name, department_id, post, role } = req.body;
  const stmt = db.prepare('UPDATE users SET name=?, department_id=?, post=?, role=? WHERE id=?');
  stmt.run(name, department_id || null, post || null, role, req.params.id);
  res.json({ success: true });
});

router.post('/users/:id/password', requireRole('admin'), (req, res) => {
  const { password } = req.body;
  const hash = hashPassword(password);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.params.id);
  res.json({ success: true });
});

router.post('/login', (req, res) => {
  const { employee_no, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE employee_no=?').get(employee_no);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '工号或密码错误' });
  }

  req.session.userId = user.id;
  req.session.userRole = user.role;
  req.session.userName = user.name;
  req.session.departmentId = user.department_id;
  res.json({ id: user.id, name: user.name, role: user.role });
});

router.post('/logout', (req, res) => {
  req.session.destroy(error => {
    if (error) return res.status(500).json({ error: '登出失败' });
    res.json({ success: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.session.userId,
    name: req.session.userName,
    role: req.session.userRole,
    departmentId: req.session.departmentId
  });
});

module.exports = router;
