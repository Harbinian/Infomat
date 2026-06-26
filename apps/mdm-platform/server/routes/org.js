const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
const db = require('../db');
const { hashPassword, verifyPassword, verifyPasswordAsync, requireAuth, requirePermission, getUserEffectivePermissions } = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const { makeIdentityMysqlRepository } = require('../identityMysqlRepository');
const { resolveInitialPassword, validatePasswordStrength } = require('../passwordPolicy');
const { loginRateLimit, recordLoginFailure, clearLoginFailures } = require('../security');
let identityRepoPromise = null;
let identityRepositoryFactory = null;

function handleDbError(res, error) {
  if (error && (error.code === 'ER_DUP_ENTRY' || String(error.message).includes('Duplicate'))) {
    return res.status(409).json({ error: '编码或工号已存在' });
  }
  if (error && (String(error.code || '').startsWith('ER_CHECK_CONSTRAINT') || String(error.code || '').startsWith('ER_NO_REFERENCED_ROW'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
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

function runAsyncAction(res, action, unavailableMessage) {
  return action().catch(error => {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (error && (
      error.code === 'ER_DUP_ENTRY' ||
      String(error.message).includes('Duplicate') ||
      String(error.code || '').startsWith('ER_CHECK_CONSTRAINT') ||
      String(error.code || '').startsWith('ER_NO_REFERENCED_ROW')
    )) {
      return handleDbError(res, error);
    }
    console.error(error);
    return res.status(unavailableMessage ? 503 : 500).json({ error: unavailableMessage || '服务器错误' });
  });
}

function requireOrgPermission(permCode) {
  return (req, res, next) => {
    if (!useMysqlIdentityReadModel()) {
      return requirePermission(permCode)(req, res, next);
    }
    if (!req.session || !req.session.userId) return res.status(401).json({ error: '未登录' });
    return identityRepository()
      .then(repo => repo.getUserEffectivePermissions(req.session.userId))
      .then(({ permSet, fieldConstraints }) => {
        if (!permSet.has(permCode) && !permSet.has('*:*')) {
          return res.status(403).json({ error: '权限不足' });
        }
        req.effectivePermissions = permSet;
        req.effectiveFieldConstraints = fieldConstraints;
        return next();
      })
      .catch(error => {
        console.error(error);
        return res.status(503).json({ error: '身份 MySQL 读取模型不可用' });
      });
  };
}

function useMysqlIdentityReadModel() {
  return String(process.env.MDM_IDENTITY_READ_MODEL || '').toLowerCase() === 'mysql';
}

function requestPersonId(req) {
  return req.session && (req.session.personId || req.session.userId) || null;
}

async function identityRepository() {
  if (identityRepositoryFactory) {
    return await identityRepositoryFactory();
  }
  if (!identityRepoPromise) {
    identityRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeIdentityMysqlRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await identityRepoPromise;
  } catch (error) {
    identityRepoPromise = null;
    throw error;
  }
}

function setIdentityRepositoryFactory(factory) {
  identityRepositoryFactory = factory;
  identityRepoPromise = null;
}

function resetIdentityRepositoryFactory() {
  identityRepositoryFactory = null;
  identityRepoPromise = null;
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

async function requestHasAnyPermissionWithMysqlIdentity(req, permissionCodes) {
  if (!req.session || !req.session.userId) return false;
  const repo = await identityRepository();
  const { permSet } = await repo.getUserEffectivePermissions(req.session.userId);
  return permSet.has('*:*') || permissionCodes.some(code => permSet.has(code));
}

function resolveCreatePassword(password) {
  return resolveInitialPassword(password);
}

function resolveResetPassword(password) {
  return resolveInitialPassword(password);
}

router.get('/departments', requireAuth, (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await identityRepository();
      return res.json(await repo.listDepartments());
    }, '身份 MySQL 读取模型不可用');
  }

  const depts = db.prepare('SELECT * FROM departments ORDER BY code').all();
  res.json(depts);
});

router.post('/departments', requireOrgPermission('admin:access'), (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const {
        name, code, parent_id, department_type, manager_user_id, data_owner_user_id,
        final_responsible_person_id, data_owner_person_id,
        source_system, external_id, status, effective_from, effective_to
      } = req.body;
      const repo = await identityRepository();
      const created = await repo.createDepartment({
        name,
        code,
        parent_id: parent_id || null,
        department_type: department_type || null,
        manager_user_id: manager_user_id || null,
        data_owner_user_id: data_owner_user_id || null,
        final_responsible_person_id: final_responsible_person_id || manager_user_id || null,
        data_owner_person_id: data_owner_person_id || data_owner_user_id || null,
        source_system: source_system || 'MDM_SYS',
        external_id: external_id || null,
        status: status || 'active',
        effective_from: effective_from || null,
        effective_to: effective_to || null,
        created_by: requestPersonId(req)
      });
      return res.json({ id: created.id });
    }, '身份 MySQL 读取模型不可用');
  }

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

router.put('/departments/:id', requireOrgPermission('admin:access'), (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const {
        name, code, parent_id, sort_order, department_type, manager_user_id, data_owner_user_id,
        final_responsible_person_id, data_owner_person_id,
        source_system, external_id, status, effective_from, effective_to
      } = req.body;
      const repo = await identityRepository();
      await repo.updateDepartment(Number(req.params.id), {
        name,
        code,
        parent_id: parent_id || null,
        sort_order: sort_order || 0,
        department_type: department_type || null,
        manager_user_id: manager_user_id || null,
        data_owner_user_id: data_owner_user_id || null,
        final_responsible_person_id: final_responsible_person_id || manager_user_id || null,
        data_owner_person_id: data_owner_person_id || data_owner_user_id || null,
        source_system: source_system || 'MDM_SYS',
        external_id: external_id || null,
        status: status || 'active',
        effective_from: effective_from || null,
        effective_to: effective_to || null,
        updated_by: requestPersonId(req)
      });
      return res.json({ success: true });
    }, '身份 MySQL 读取模型不可用');
  }

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

router.delete('/departments/:id', requireOrgPermission('admin:access'), (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await identityRepository();
      await repo.deleteDepartment(Number(req.params.id));
      return res.json({ success: true });
    }, '身份 MySQL 读取模型不可用');
  }

  return runDbAction(res, () => {
    db.prepare('DELETE FROM departments WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });
});

router.get('/users', requireAuth, requireOrgPermission('admin:access'), (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await identityRepository();
      return res.json(await repo.listUsers());
    }, '身份 MySQL 读取模型不可用');
  }

  const users = db.prepare(`
    SELECT u.id, u.name, u.employee_no, u.department_id, u.post, u.role, u.created_at, d.name as dept_name
    FROM users u
    LEFT JOIN departments d ON u.department_id = d.id
    ORDER BY u.employee_no
  `).all();
  res.json(users);
});

// GET /api/users/roles-summary — all users with legacy role + RBAC roles
router.get('/users/roles-summary', requireAuth, requireOrgPermission('admin:access'), (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await identityRepository();
      return res.json(await repo.listUserRoleSummaries());
    }, '身份 MySQL 读取模型不可用');
  }

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
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      if (!await requestHasAnyPermissionWithMysqlIdentity(req, ['conflict:manage', 'review:approve', 'admin:access'])) {
        return res.status(403).json({ error: '权限不足' });
      }
      const repo = await identityRepository();
      return res.json(await repo.listAssignableUsers());
    }, '身份 MySQL 读取模型不可用');
  }

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

// GET /api/org/persons/assignable — person picker for guidance delegation and executor assignment
router.get('/persons/assignable', requireAuth, (req, res) => {
  const permissions = ['guidance:delegate', 'guidance:respond', 'guidance:final_confirm', 'conflict:manage', 'review:approve', 'admin:access'];
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      if (!await requestHasAnyPermissionWithMysqlIdentity(req, permissions)) {
        return res.status(403).json({ error: '权限不足' });
      }
      const repo = await identityRepository();
      return res.json(await repo.listAssignableUsers());
    }, '身份 MySQL 读取模型不可用');
  }

  return runDbAction(res, () => {
    if (!requestHasAnyPermission(req, permissions)) {
      return res.status(403).json({ error: '权限不足' });
    }
    const rows = db.prepare(`
      SELECT u.id, u.id AS person_id, u.name, u.department_id, d.name AS dept_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      ORDER BY d.name, u.name
    `).all();
    res.json(rows.map(row => ({
      id: row.id,
      personId: row.person_id || row.id,
      name: row.name,
      department_id: row.department_id,
      dept_name: row.dept_name || null
    })));
  });
});

router.post('/users', requireOrgPermission('admin:access'), (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const { name, employee_no, department_id, post, role, password, role_ids } = req.body;
      if (!name || !employee_no) return res.status(400).json({ error: '姓名和工号为必填' });
      const passwordSetup = resolveCreatePassword(password);
      if (passwordSetup.error) return res.status(400).json({ error: passwordSetup.error });
      const repo = await identityRepository();
      const created = await repo.createUser({
        name,
        employee_no,
        department_id: department_id || null,
        post: post || null,
        role,
        password_hash: hashPassword(passwordSetup.password),
        must_change_password: passwordSetup.mustChangePassword,
        role_ids,
        assigned_by: requestPersonId(req)
      });
      const body = { id: created.id };
      if (passwordSetup.initialPassword) body.initial_password = passwordSetup.initialPassword;
      return res.json(body);
    }, '身份 MySQL 读取模型不可用');
  }

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

router.put('/users/:id', requireOrgPermission('admin:access'), (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const { name, department_id, post, role, role_ids } = req.body;
      const payload = { name, role, role_ids, assigned_by: requestPersonId(req) };
      if (Object.prototype.hasOwnProperty.call(req.body, 'department_id')) payload.department_id = department_id || null;
      if (Object.prototype.hasOwnProperty.call(req.body, 'post')) payload.post = post || null;
      const repo = await identityRepository();
      const updated = await repo.updateUser(Number(req.params.id), payload);
      if (!updated) return res.status(404).json({ error: '用户不存在' });
      return res.json({ success: true });
    }, '身份 MySQL 读取模型不可用');
  }

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

router.post('/users/:id/password', requireOrgPermission('admin:access'), (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const { password } = req.body;
      const passwordSetup = resolveResetPassword(password);
      if (passwordSetup.error) return res.status(400).json({ error: passwordSetup.error });
      const repo = await identityRepository();
      const updated = await repo.resetUserPassword(
        Number(req.params.id),
        hashPassword(passwordSetup.password),
        passwordSetup.mustChangePassword
      );
      if (!updated) return res.status(404).json({ error: '用户不存在' });
      const body = { success: true };
      if (passwordSetup.initialPassword) body.initial_password = passwordSetup.initialPassword;
      return res.json(body);
    }, '身份 MySQL 读取模型不可用');
  }

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

function writeLoginSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => {
      if (error) return reject(error);
      const personId = user.personId || user.person_id || user.id;
      req.session.userId = personId;
      req.session.personId = personId;
      req.session.accountId = user.accountId || user.account_id || null;
      req.session.employeeNo = user.employeeNo || user.employee_no || user.login_name || null;
      req.session.userRole = user.role;
      req.session.userName = user.personName || user.person_name || user.name;
      req.session.departmentId = user.current_department_id || user.department_id;
      resolve();
    });
  });
}

async function loginWithMysqlIdentity(req, res) {
  const { employee_no, password } = req.body;
  const repo = await identityRepository();
  const user = await repo.getUserByEmployeeNo(employee_no);
  if (!user) {
    recordLoginFailure(req);
    return res.status(401).json({ error: '工号或密码错误' });
  }
  const passwordMatched = await verifyPasswordAsync(password, user.password_hash);
  if (!passwordMatched) {
    recordLoginFailure(req);
    return res.status(401).json({ error: '工号或密码错误' });
  }

  await writeLoginSession(req, user);
  clearLoginFailures(req);
  return res.json({
    id: user.personId || user.id,
    personId: user.personId || user.id,
    accountId: user.accountId || null,
    employeeNo: user.employeeNo || user.employee_no,
    name: user.personName || user.name,
    role: user.role
  });
}

router.post('/login', loginRateLimit, (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => loginWithMysqlIdentity(req, res), '身份 MySQL 读取模型不可用');
  }

  return runAsyncAction(res, async () => {
    const { employee_no, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE employee_no=?').get(employee_no);
    if (!user) {
      recordLoginFailure(req);
      return res.status(401).json({ error: '工号或密码错误' });
    }
    const passwordMatched = await verifyPasswordAsync(password, user.password_hash);
    if (!passwordMatched) {
      recordLoginFailure(req);
      return res.status(401).json({ error: '工号或密码错误' });
    }

    await writeLoginSession(req, user);
    clearLoginFailures(req);
    return res.json({ id: user.id, personId: user.id, accountId: null, employeeNo: user.employee_no, name: user.name, role: user.role });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(error => {
    if (error) return res.status(500).json({ error: '登出失败' });
    res.json({ success: true });
  });
});

function currentUserPayloadFromSqlite(req) {
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  const rbacRoles = getUserRoleCodes(req.session.userId, req.session.userRole);
  const department = req.session.departmentId
    ? db.prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId)
    : null;
  return {
    id: req.session.userId,
    name: req.session.userName,
    role: req.session.userRole,
    departmentId: req.session.departmentId,
    departmentName: department && department.name || null,
    rbacRoles,
    roleCodes: rbacRoles.map(role => role.code),
    permissions: Array.from(permSet)
  };
}

async function currentUserPayload(req) {
  if (!useMysqlIdentityReadModel()) return currentUserPayloadFromSqlite(req);
  const repo = await identityRepository();
  const payload = await repo.getCurrentUserPayload(req.session);
  if (!payload) {
    const error = new Error('用户不存在');
    error.statusCode = 401;
    throw error;
  }
  return payload;
}

router.get('/session', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ authenticated: false });
  }
  return runAsyncAction(res, async () => {
    return res.json({ authenticated: true, user: await currentUserPayload(req) });
  }, useMysqlIdentityReadModel() ? '身份 MySQL 读取模型不可用' : null);
});

router.get('/me', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    res.json(await currentUserPayload(req));
  }, useMysqlIdentityReadModel() ? '身份 MySQL 读取模型不可用' : null);
});

// GET /api/users/:id/roles — get user's assigned roles
router.get('/users/:id/roles', requireAuth, requireOrgPermission('admin:access'), (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await identityRepository();
      return res.json(await repo.getAssignedRoles(Number(req.params.id)));
    }, '身份 MySQL 读取模型不可用');
  }

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
router.put('/users/:id/roles', requireAuth, requireOrgPermission('admin:access'), (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const { role_ids } = req.body;
      if (!Array.isArray(role_ids) || role_ids.length === 0) {
        return res.status(400).json({ error: '至少需要一个角色' });
      }

      const repo = await identityRepository();
      const updated = await repo.replaceUserRoles(Number(req.params.id), role_ids, requestPersonId(req));
      if (!updated) return res.status(404).json({ error: '用户不存在' });
      return res.json({ success: true });
    }, '身份 MySQL 读取模型不可用');
  }

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
router.get('/permissions', requireAuth, requireOrgPermission('admin:access'), (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await identityRepository();
      return res.json(await repo.getPermissionsGrouped());
    }, '身份 MySQL 读取模型不可用');
  }

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
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await identityRepository();
      const status = await repo.getPasswordStatus(req.session.userId);
      if (!status) return res.status(404).json({ error: '用户不存在' });
      return res.json(status);
    }, '身份 MySQL 读取模型不可用');
  }

  return runDbAction(res, () => {
    const user = db.prepare('SELECT must_change_password FROM users WHERE id=?').get(req.session.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ is_default_password: Boolean(user.must_change_password) });
  });
});

// POST /api/me/password — change own password
router.post('/me/password', requireAuth, (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const { current_password, new_password } = req.body;
      if (!current_password || !new_password) return res.status(400).json({ error: '缺少当前密码或新密码' });

      const repo = await identityRepository();
      const user = await repo.getPasswordCredential(req.session.userId);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      if (!verifyPassword(current_password, user.password_hash)) return res.status(403).json({ error: '当前密码不正确' });

      const strengthError = validatePasswordStrength(new_password, user);
      if (strengthError) return res.status(400).json({ error: strengthError });

      const updated = await repo.updateOwnPassword(req.session.userId, hashPassword(new_password));
      if (!updated) return res.status(404).json({ error: '用户不存在' });
      return res.json({ success: true });
    }, '身份 MySQL 读取模型不可用');
  }

  return runDbAction(res, () => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: '缺少当前密码或新密码' });

    const user = db.prepare('SELECT employee_no, password_hash FROM users WHERE id=?').get(req.session.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (!verifyPassword(current_password, user.password_hash)) return res.status(403).json({ error: '当前密码不正确' });

    const strengthError = validatePasswordStrength(new_password, user);
    if (strengthError) return res.status(400).json({ error: strengthError });

    const hash = hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hash, req.session.userId);
    res.json({ success: true });
  });
});

router.setIdentityRepositoryFactory = setIdentityRepositoryFactory;
router.resetIdentityRepositoryFactory = resetIdentityRepositoryFactory;

module.exports = router;
