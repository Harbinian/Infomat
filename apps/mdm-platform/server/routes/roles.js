const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const { makeIdentityMysqlRepository } = require('../identityMysqlRepository');
let identityRepoPromise = null;
let identityRepositoryFactory = null;

function handleDbError(res, error) {
  if (error && (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(error.message).includes('UNIQUE constraint failed'))) {
    return res.status(409).json({ error: '角色编码已存在' });
  }
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runDbAction(res, action) {
  try { return action(); } catch (error) { return handleDbError(res, error); }
}

function runAsyncAction(res, action) {
  return action().catch(error => {
    console.error(error);
    return res.status(503).json({ error: '身份 MySQL 读取模型不可用' });
  });
}

function useMysqlIdentityReadModel() {
  return String(process.env.MDM_IDENTITY_READ_MODEL || '').toLowerCase() === 'mysql';
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

function requireRolesPermission(permCode) {
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

function rejectMysqlRoleWrite(req, res, next) {
  if (useMysqlIdentityReadModel()) {
    return res.status(501).json({ error: '角色写入 MySQL 迁移未完成' });
  }
  return next();
}

const readAdminOnly = [requireAuth, requireRolesPermission('admin:access')];
const writeAdminOnly = [requireAuth, requireRolesPermission('admin:access'), rejectMysqlRoleWrite];

// GET /api/roles — list all roles with inherited info, permission count, user count
router.get('/', ...readAdminOnly, (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await identityRepository();
      res.json(await repo.listRoles());
    });
  }
  return runDbAction(res, () => {
    const roles = db.prepare(`
      SELECT r.*,
        (SELECT role_name FROM roles pr WHERE pr.role_id = r.parent_role_id) as parent_role_name,
        (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.role_id) as perm_count,
        (SELECT COUNT(*) FROM user_roles WHERE role_id = r.role_id) as user_count
      FROM roles r
      ORDER BY r.is_system DESC, r.role_code
    `).all();
    res.json(roles);
  });
});

// GET /api/roles/:id — role detail with full permission tree and assigned users
router.get('/:id', ...readAdminOnly, (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await identityRepository();
      const role = await repo.getRoleDetail(Number(req.params.id));
      if (!role) return res.status(404).json({ error: '角色不存在' });
      res.json(role);
    });
  }
  return runDbAction(res, () => {
    const role = db.prepare('SELECT * FROM roles WHERE role_id=?').get(req.params.id);
    if (!role) return res.status(404).json({ error: '角色不存在' });

    // Get permissions with inherited flag
    const ownPerms = db.prepare(`
      SELECT p.perm_id, p.perm_code, p.resource, p.action, p.field_constraints, p.description, rp.effect, 0 as inherited
      FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id
      WHERE rp.role_id=?
    `).all(req.params.id);

    const ownPermCodes = new Set(ownPerms.map(p => p.perm_code));

    // Collect inherited permissions from parent chain
    const inheritedPerms = [];
    let parentId = role.parent_role_id;
    const visited = new Set();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const pPerms = db.prepare(`
        SELECT p.perm_id, p.perm_code, p.resource, p.action, p.field_constraints, p.description, rp.effect, 1 as inherited
        FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id
        WHERE rp.role_id=?
      `).all(parentId);
      for (const p of pPerms) {
        if (!ownPermCodes.has(p.perm_code)) {
          inheritedPerms.push(p);
          ownPermCodes.add(p.perm_code);
        }
      }
      const parent = db.prepare('SELECT parent_role_id FROM roles WHERE role_id=?').get(parentId);
      parentId = parent ? parent.parent_role_id : null;
    }

    // Get assigned users
    const users = db.prepare(`
      SELECT u.id, u.name, u.employee_no, u.department_id, u.post, d.name as dept_name
      FROM user_roles ur
      JOIN users u ON ur.user_id = u.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE ur.role_id=?
    `).all(req.params.id);

    res.json({ ...role, permissions: [...ownPerms, ...inheritedPerms], users });
  });
});

// POST /api/roles — create custom role
router.post('/', ...writeAdminOnly, (req, res) => {
  return runDbAction(res, () => {
    const { role_code, role_name, description, parent_role_id } = req.body;
    if (!role_code || !role_name) return res.status(400).json({ error: '角色编码和名称为必填' });

    const stmt = db.prepare(`
      INSERT INTO roles (role_code, role_name, description, parent_role_id, created_by)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(role_code, role_name, description || null, parent_role_id || null, req.session.userId);
    res.status(201).json({ role_id: result.lastInsertRowid });
  });
});

// PUT /api/roles/:id — update role
router.put('/:id', ...writeAdminOnly, (req, res) => {
  return runDbAction(res, () => {
    const role = db.prepare('SELECT * FROM roles WHERE role_id=?').get(req.params.id);
    if (!role) return res.status(404).json({ error: '角色不存在' });

    const { role_name, description, parent_role_id } = req.body;
    const stmt = db.prepare(`
      UPDATE roles SET role_name=?, description=?, parent_role_id=?, updated_at=CURRENT_TIMESTAMP
      WHERE role_id=?
    `);
    stmt.run(role_name || role.role_name, description !== undefined ? description : role.description, parent_role_id !== undefined ? parent_role_id : role.parent_role_id, req.params.id);
    res.json({ success: true });
  });
});

// DELETE /api/roles/:id — delete role (protect system roles and assigned roles)
router.delete('/:id', ...writeAdminOnly, (req, res) => {
  return runDbAction(res, () => {
    const role = db.prepare('SELECT * FROM roles WHERE role_id=?').get(req.params.id);
    if (!role) return res.status(404).json({ error: '角色不存在' });
    if (role.is_system) return res.status(403).json({ error: '系统角色不可删除' });

    const userCount = db.prepare('SELECT COUNT(*) as cnt FROM user_roles WHERE role_id=?').get(req.params.id);
    if (userCount.cnt > 0) return res.status(403).json({ error: `该角色已分配给 ${userCount.cnt} 个用户，请先取消分配` });

    // Check if any child role inherits from this role
    const childCount = db.prepare('SELECT COUNT(*) as cnt FROM roles WHERE parent_role_id=?').get(req.params.id);
    if (childCount.cnt > 0) return res.status(403).json({ error: `有 ${childCount.cnt} 个子角色继承自此角色，请先修改子角色的父角色` });

    db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(req.params.id);
    db.prepare('DELETE FROM roles WHERE role_id=?').run(req.params.id);
    res.json({ success: true });
  });
});

// GET /api/roles/:id/permissions — get permission matrix for a role
router.get('/:id/permissions', ...readAdminOnly, (req, res) => {
  if (useMysqlIdentityReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await identityRepository();
      const payload = await repo.getRolePermissionMatrix(Number(req.params.id));
      if (!payload) return res.status(404).json({ error: '角色不存在' });
      res.json(payload);
    });
  }
  return runDbAction(res, () => {
    const role = db.prepare('SELECT * FROM roles WHERE role_id=?').get(req.params.id);
    if (!role) return res.status(404).json({ error: '角色不存在' });

    const allPerms = db.prepare('SELECT * FROM permissions ORDER BY resource, action').all();
    const rolePerms = db.prepare(`
      SELECT p.perm_code, rp.effect FROM role_permissions rp
      JOIN permissions p ON rp.perm_id = p.perm_id WHERE rp.role_id=?
    `).all(req.params.id);
    const rolePermMap = new Map(rolePerms.map(rp => [rp.perm_code, rp.effect]));

    const matrix = allPerms.map(p => ({
      ...p,
      assigned: rolePermMap.has(p.perm_code),
      effect: rolePermMap.get(p.perm_code) || null
    }));

    res.json({ role, matrix });
  });
});

// PUT /api/roles/:id/permissions — bulk update role permissions (replace all)
router.put('/:id/permissions', ...writeAdminOnly, (req, res) => {
  return runDbAction(res, () => {
    const role = db.prepare('SELECT * FROM roles WHERE role_id=?').get(req.params.id);
    if (!role) return res.status(404).json({ error: '角色不存在' });

    const { perm_ids, effects } = req.body; // effects: { perm_id: 'allow'|'deny' }
    if (!Array.isArray(perm_ids)) return res.status(400).json({ error: 'perm_ids 必须是数组' });

    db.transaction(() => {
      db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(req.params.id);
      const insert = db.prepare('INSERT INTO role_permissions (role_id, perm_id, effect) VALUES (?, ?, ?)');
      for (const permId of perm_ids) {
        const effect = (effects && effects[permId]) || 'allow';
        insert.run(req.params.id, permId, effect);
      }
    })();

    res.json({ success: true, count: perm_ids.length });
  });
});

router.setIdentityRepositoryFactory = setIdentityRepositoryFactory;
router.resetIdentityRepositoryFactory = resetIdentityRepositoryFactory;

module.exports = router;
