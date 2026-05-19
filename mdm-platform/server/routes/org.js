const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, verifyPassword, requireAuth, requireRole, requirePermission } = require('../auth');

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

// GET /api/users/:id/roles — get user's assigned roles
router.get('/users/:id/roles', requireAuth, requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const roles = db.prepare(`
      SELECT r.role_id, r.role_code, r.role_name, r.is_system
      FROM user_roles ur JOIN roles r ON ur.role_id = r.role_id
      WHERE ur.user_id=?
      ORDER BY r.is_system DESC, r.role_code
    `).all(req.params.id);
    res.json(roles);
  });
});

// PUT /api/users/:id/roles — set user roles (replace all)
router.put('/users/:id/roles', requireAuth, requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const { role_ids } = req.body;
    if (!Array.isArray(role_ids) || role_ids.length === 0) {
      return res.status(400).json({ error: '至少需要一个角色' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    db.transaction(() => {
      db.prepare('DELETE FROM user_roles WHERE user_id=?').run(req.params.id);
      const insert = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)');
      for (const roleId of role_ids) {
        insert.run(req.params.id, roleId, req.session.userId);
      }

      // Update users.role to primary role name for backward compat
      const primaryRole = db.prepare('SELECT role_code FROM roles WHERE role_id=?').get(role_ids[0]);
      if (primaryRole) {
        db.prepare('UPDATE users SET role=? WHERE id=?').run(primaryRole.role_code, req.params.id);
      }
    })();

    res.json({ success: true });
  });
});

// GET /api/permissions — all permission definitions grouped by resource
router.get('/permissions', requireAuth, requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const perms = db.prepare('SELECT * FROM permissions ORDER BY resource, action').all();
    const grouped = {};
    for (const p of perms) {
      if (!grouped[p.resource]) grouped[p.resource] = [];
      grouped[p.resource].push(p);
    }
    res.json(grouped);
  });
});

// GET /api/me/password-status — check if using default password
router.get('/me/password-status', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const user = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.session.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const isDefault = verifyPassword('init1234', user.password_hash);
    res.json({ is_default_password: isDefault });
  });
});

// POST /api/me/password — change own password
router.post('/me/password', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: '缺少当前密码或新密码' });
    if (new_password.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });

    const user = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.session.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (!verifyPassword(current_password, user.password_hash)) return res.status(403).json({ error: '当前密码不正确' });

    const hash = hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.session.userId);
    res.json({ success: true });
  });
});

module.exports = router;
