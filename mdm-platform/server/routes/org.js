const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, verifyPassword, requireAuth, requireRole } = require('../auth');

function handleDbError(res, error) {
  if (error && (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(error.message).includes('UNIQUE constraint failed'))) {
    return res.status(409).json({ error: '编码或工号已存在' });
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

router.get('/departments', requireAuth, (req, res) => {
  const depts = db.prepare('SELECT * FROM departments ORDER BY code').all();
  res.json(depts);
});

router.post('/departments', requireRole('admin'), (req, res) => {
  return runDbAction(res, () => {
    const { 
      name, code, parent_id, department_type, manager_user_id, data_owner_user_id, 
      source_system, external_id, status, effective_from, effective_to 
    } = req.body;
    
    const stmt = db.prepare(`
      INSERT INTO departments 
        (name, code, parent_id, department_type, manager_user_id, data_owner_user_id, source_system, external_id, status, effective_from, effective_to, created_by) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      name, code, parent_id || null, department_type || null, 
      manager_user_id || null, data_owner_user_id || null, 
      source_system || 'MDM_SYS', external_id || null, 
      status || 'active', effective_from || null, effective_to || null,
      req.session.userId
    );
    
    // Update path
    const id = result.lastInsertRowid;
    let path = `/${id}/`;
    if (parent_id) {
      const parent = db.prepare('SELECT path FROM departments WHERE id=?').get(parent_id);
      if (parent && parent.path) {
        path = `${parent.path}${id}/`;
      }
    }
    db.prepare('UPDATE departments SET path=? WHERE id=?').run(path, id);
    
    res.json({ id });
  });
});

router.put('/departments/:id', requireRole('admin'), (req, res) => {
  return runDbAction(res, () => {
    const { 
      name, code, parent_id, sort_order, department_type, manager_user_id, data_owner_user_id, 
      source_system, external_id, status, effective_from, effective_to 
    } = req.body;
    
    let path = `/${req.params.id}/`;
    if (parent_id) {
      const parent = db.prepare('SELECT path FROM departments WHERE id=?').get(parent_id);
      if (parent && parent.path) {
        path = `${parent.path}${req.params.id}/`;
      }
    }

    const stmt = db.prepare(`
      UPDATE departments 
      SET name=?, code=?, parent_id=?, path=?, sort_order=?, department_type=?, 
          manager_user_id=?, data_owner_user_id=?, source_system=?, external_id=?, 
          status=?, effective_from=?, effective_to=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `);
    stmt.run(
      name, code, parent_id || null, path, sort_order || 0, department_type || null, 
      manager_user_id || null, data_owner_user_id || null, source_system || 'MDM_SYS', 
      external_id || null, status || 'active', effective_from || null, effective_to || null,
      req.session.userId, req.params.id
    );
    res.json({ success: true });
  });
});

router.delete('/departments/:id', requireRole('admin'), (req, res) => {
  return runDbAction(res, () => {
    db.prepare('DELETE FROM departments WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });
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
  return runDbAction(res, () => {
    const { name, employee_no, department_id, post, role, password } = req.body;
    const hash = hashPassword(password || 'init1234');
    const stmt = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)');
    const result = stmt.run(name, employee_no, department_id || null, post || null, role || 'submitter', hash);
    res.json({ id: result.lastInsertRowid });
  });
});

router.put('/users/:id', requireRole('admin'), (req, res) => {
  return runDbAction(res, () => {
    const { name, department_id, post, role } = req.body;
    const stmt = db.prepare('UPDATE users SET name=?, department_id=?, post=?, role=? WHERE id=?');
    stmt.run(name, department_id || null, post || null, role, req.params.id);
    res.json({ success: true });
  });
});

router.post('/users/:id/password', requireRole('admin'), (req, res) => {
  return runDbAction(res, () => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: '缺少密码' });
    const hash = hashPassword(password);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.params.id);
    res.json({ success: true });
  });
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
