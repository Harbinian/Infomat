const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { hashPassword, verifyPassword, requireAuth, requirePermission, getUserEffectivePermissions } = require('../auth');

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

function getUserRoleCodes(userId, legacyRole) {
  const roles = db.prepare(`
    SELECT r.role_code as code, r.role_name as name
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.role_id
    WHERE ur.user_id=?
    ORDER BY r.is_system DESC, r.role_code
  `).all(userId);

  if (legacyRole && !roles.some(role => role.code === legacyRole)) {
    const legacy = db.prepare('SELECT role_code as code, role_name as name FROM roles WHERE role_code=?').get(legacyRole);
    if (legacy) roles.unshift(legacy);
  }

  return roles;
}

const BASIC_ROLE_CODES = new Set(['submitter', 'owner', 'reviewer', 'admin']);

function normalizeRoleIds(roleIds) {
  if (!Array.isArray(roleIds)) return [];
  return [...new Set(roleIds.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0))];
}

function getRolesByIds(roleIds) {
  const ids = normalizeRoleIds(roleIds);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`
    SELECT role_id, role_code, role_name
    FROM roles
    WHERE role_id IN (${placeholders})
    ORDER BY is_system DESC, role_code
  `).all(...ids);
}

function getRoleIdByCode(roleCode) {
  if (!roleCode) return null;
  const role = db.prepare('SELECT role_id FROM roles WHERE role_code=?').get(roleCode);
  return role ? role.role_id : null;
}

function chooseCompatibleRole(requestedRole, roleIds, fallbackRole) {
  if (BASIC_ROLE_CODES.has(requestedRole)) return requestedRole;

  const roles = getRolesByIds(roleIds);
  const basicRole = roles.find(role => BASIC_ROLE_CODES.has(role.role_code));
  if (basicRole) return basicRole.role_code;

  if (BASIC_ROLE_CODES.has(fallbackRole)) return fallbackRole;
  return 'submitter';
}

function syncUserRoles(userId, roleIds, compatibleRole, assignedBy) {
  const ids = new Set(normalizeRoleIds(roleIds));
  const compatibleRoleId = getRoleIdByCode(compatibleRole);
  if (compatibleRoleId) ids.add(compatibleRoleId);

  if (ids.size === 0) return;

  db.prepare('DELETE FROM user_roles WHERE user_id=?').run(userId);
  const insert = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)');
  for (const roleId of ids) insert.run(userId, roleId, assignedBy || null);
}

function requestHasAnyPermission(req, permissionCodes) {
  if (!req.session || !req.session.userId) return false;
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  return permSet.has('*:*') || permissionCodes.some(code => permSet.has(code));
}

const FIXED_DEFAULT_PASSWORD = 'init1234';

function isFixedDefaultPassword(password) {
  return String(password || '') === FIXED_DEFAULT_PASSWORD;
}

function generateInitialPassword() {
  return `tmp-${crypto.randomBytes(9).toString('hex')}`;
}

function resolveCreatePassword(password) {
  if (password) {
    if (isFixedDefaultPassword(password)) {
      return { error: '不能使用固定默认口令' };
    }
    return { password, mustChangePassword: 0 };
  }
  const initialPassword = generateInitialPassword();
  return { password: initialPassword, initialPassword, mustChangePassword: 1 };
}

function resolveResetPassword(password) {
  if (password) {
    if (isFixedDefaultPassword(password)) {
      return { error: '不能使用固定默认口令' };
    }
    return { password, mustChangePassword: 1 };
  }
  const initialPassword = generateInitialPassword();
  return { password: initialPassword, initialPassword, mustChangePassword: 1 };
}

router.get('/departments', requireAuth, (req, res) => {
  const depts = db.prepare('SELECT * FROM departments ORDER BY code').all();
  res.json(depts);
});

router.post('/departments', requirePermission('admin:access'), (req, res) => {
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

router.put('/departments/:id', requirePermission('admin:access'), (req, res) => {
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

router.delete('/departments/:id', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    db.prepare('DELETE FROM departments WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });
});

router.get('/users', requireAuth, requirePermission('admin:access'), (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.employee_no, u.department_id, u.post, u.role, u.created_at, d.name as dept_name
    FROM users u
    LEFT JOIN departments d ON u.department_id = d.id
    ORDER BY u.employee_no
  `).all();
  res.json(users);
});

// GET /api/users/roles-summary — all users with legacy role + RBAC roles
router.get('/users/roles-summary', requireAuth, requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const users = db.prepare(`
      SELECT u.id, u.name, u.employee_no, u.post, u.role, u.department_id, u.created_at,
             d.name as dept_name,
             COALESCE(GROUP_CONCAT(r.role_code), '') as rbac_role_codes,
             COALESCE(GROUP_CONCAT(r.role_name), '') as rbac_role_names
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.role_id
      GROUP BY u.id
      ORDER BY u.employee_no
    `).all();
    res.json(users.map(u => ({
      id: u.id,
      name: u.name,
      employee_no: u.employee_no,
      department_id: u.department_id,
      dept_name: u.dept_name || null,
      post: u.post,
      role: u.role,
      created_at: u.created_at,
      rbac_role_codes: u.rbac_role_codes || '',
      rbac_role_names: u.rbac_role_names || ''
    })));
  });
});

// GET /api/org/users/assignable — minimal user picker for conflict assignment
router.get('/users/assignable', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    if (!requestHasAnyPermission(req, ['conflict:manage', 'review:approve', 'admin:access'])) {
      return res.status(403).json({ error: '权限不足' });
    }
    const rows = db.prepare(`
      SELECT u.id, u.name, u.department_id, d.name AS dept_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      ORDER BY d.name, u.name
    `).all();
    res.json(rows.map(row => ({
      id: row.id,
      name: row.name,
      department_id: row.department_id,
      dept_name: row.dept_name || null
    })));
  });
});

router.post('/users', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const { name, employee_no, department_id, post, role, password, role_ids } = req.body;
    if (!name || !employee_no) return res.status(400).json({ error: '姓名和工号为必填' });
    const compatibleRole = chooseCompatibleRole(role, role_ids, 'submitter');
    const passwordSetup = resolveCreatePassword(password);
    if (passwordSetup.error) return res.status(400).json({ error: passwordSetup.error });
    const hash = hashPassword(passwordSetup.password);
    const stmt = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const result = db.transaction(() => {
      const created = stmt.run(name, employee_no, department_id || null, post || null, compatibleRole, hash, passwordSetup.mustChangePassword);
      syncUserRoles(created.lastInsertRowid, role_ids, compatibleRole, req.session.userId);
      return created;
    })();
    const body = { id: result.lastInsertRowid };
    if (passwordSetup.initialPassword) body.initial_password = passwordSetup.initialPassword;
    res.json(body);
  });
});

router.put('/users/:id', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const existing = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '用户不存在' });

    const { name, department_id, post, role, role_ids } = req.body;
    const compatibleRole = chooseCompatibleRole(role, role_ids, existing.role);
    const stmt = db.prepare('UPDATE users SET name=?, department_id=?, post=?, role=? WHERE id=?');
    db.transaction(() => {
      stmt.run(name || existing.name, department_id || null, post || null, compatibleRole, req.params.id);
      if (Array.isArray(role_ids)) syncUserRoles(req.params.id, role_ids, compatibleRole, req.session.userId);
    })();
    res.json({ success: true });
  });
});

router.post('/users/:id/password', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const { password } = req.body;
    const existing = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '用户不存在' });
    const passwordSetup = resolveResetPassword(password);
    if (passwordSetup.error) return res.status(400).json({ error: passwordSetup.error });
    const hash = hashPassword(passwordSetup.password);
    db.prepare('UPDATE users SET password_hash=?, must_change_password=? WHERE id=?').run(hash, passwordSetup.mustChangePassword, req.params.id);
    const body = { success: true };
    if (passwordSetup.initialPassword) body.initial_password = passwordSetup.initialPassword;
    res.json(body);
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
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  const rbacRoles = getUserRoleCodes(req.session.userId, req.session.userRole);
  const department = req.session.departmentId
    ? db.prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId)
    : null;
  res.json({
    id: req.session.userId,
    name: req.session.userName,
    role: req.session.userRole,
    departmentId: req.session.departmentId,
    departmentName: department && department.name || null,
    rbacRoles,
    roleCodes: rbacRoles.map(role => role.code),
    permissions: Array.from(permSet)
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
      const compatibleRole = chooseCompatibleRole(null, role_ids, user.role);
      syncUserRoles(req.params.id, role_ids, compatibleRole, req.session.userId);
      db.prepare('UPDATE users SET role=? WHERE id=?').run(compatibleRole, req.params.id);
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
    const user = db.prepare('SELECT password_hash, must_change_password FROM users WHERE id=?').get(req.session.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const isDefault = Boolean(user.must_change_password) || verifyPassword(FIXED_DEFAULT_PASSWORD, user.password_hash);
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

    if (isFixedDefaultPassword(new_password)) return res.status(400).json({ error: '不能使用固定默认口令' });

    const hash = hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hash, req.session.userId);
    res.json({ success: true });
  });
});

module.exports = router;
