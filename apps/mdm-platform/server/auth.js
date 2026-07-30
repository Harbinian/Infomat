const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv } = require('./mysqlConfig');
const { makeIdentityMysqlRepository } = require('./identityMysqlRepository');
const { permissionSetHas } = require('./roleDefinitions');
let identityRepoPromise = null;
let identityRepositoryFactory = null;
const inFlightPasswordChecks = new Map();

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function passwordCheckKey(password, hash) {
  return crypto
    .createHash('sha256')
    .update(String(hash || ''))
    .update('\0')
    .update(String(password || ''))
    .digest('hex');
}

function verifyPasswordAsync(password, hash) {
  const key = passwordCheckKey(password, hash);
  const pending = inFlightPasswordChecks.get(key);
  if (pending) return pending;

  const check = new Promise((resolve, reject) => {
    bcrypt.compare(password, hash, (error, matched) => {
      if (error) return reject(error);
      resolve(Boolean(matched));
    });
  }).finally(() => {
    inFlightPasswordChecks.delete(key);
  });
  inFlightPasswordChecks.set(key, check);
  return check;
}

function requireAuth(req, res, next) {
  if (!req.session || (!req.session.personId && !req.session.userId)) {
    return res.status(401).json({ error: '未登录' });
  }
  if (!useMysqlIdentityReadModel() || !req.session.accountId || !req.session.authVersion) {
    return next();
  }
  return identityRepository()
    .then(repo => {
      if (typeof repo.validateSession !== 'function') return { valid: true };
      return repo.validateSession(req.session);
    })
    .then(result => {
      if (!result || !result.valid) {
        return req.session.destroy(() => {
          res.status(401).json({
            error: '账号状态或授权已经变化，请重新登录',
            code: 'SESSION_AUTHORIZATION_CHANGED'
          });
        });
      }
      req.identity = result.user;
      attachRequestIdentityCompatibility(req, result.user);
      if (result.user.must_change_password && !isPasswordChangeBootstrapRequest(req)) {
        return res.status(403).json({
          error: '首次登录必须先修改密码',
          code: 'PASSWORD_CHANGE_REQUIRED'
        });
      }
      return next();
    })
    .catch(error => {
      console.error(error);
      return res.status(503).json({
        error: '身份服务暂不可用',
        code: 'IDENTITY_SERVICE_UNAVAILABLE'
      });
    });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: '未登录' });
    }
    if (!roles.includes(req.session.userRole)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

function send401(res, message) {
  return res.status(401).json({ error: message || '未登录' });
}

function send403(res, message) {
  return res.status(403).json({ error: message || '权限不足' });
}

function send404(res, message) {
  return res.status(404).json({ error: message || '不存在' });
}

function send409(res, message) {
  return res.status(409).json({ error: message || '状态冲突' });
}

function send422(res, errors) {
  return res.status(422).json({ error: '校验失败', details: errors });
}

function isAdmin(req) {
  if (!req.session || !req.session.userId) return false;
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  return permSet.has('identity:manage-account');
}

const INTERNAL_ID_FIELDS = [
  'org_unit_id', 'position_id', 'person_id', 'product_family_id', 'product_id',
  'class_node_id', 'attribute_def_id', 'attribute_value_id',
  'external_identity_id', 'system_id', 'membership_id', 'assignment_id'
];

function stripInternalIds(req, res, next) {
  if (isAdmin(req)) return next();
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    function strip(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(strip);
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        if (INTERNAL_ID_FIELDS.includes(key)) continue;
        cleaned[key] = strip(value);
      }
      return cleaned;
    }
    return originalJson(strip(body));
  };
  next();
}

function requireDataPermission(categoryCode, action) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: '未登录' });
    }
    if (isAdmin(req)) return next();

    const db = require('./db');
    const user = db.prepare('SELECT permissions FROM users WHERE id=?').get(req.session.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });

    const permissions = JSON.parse(user.permissions || '{}');
    const catPerms = permissions[categoryCode];
    if (!catPerms || !catPerms.includes(action)) {
      return res.status(403).json({ error: `无 ${categoryCode} 的 ${action} 权限` });
    }
    next();
  };
}

// ── RBAC: Permission Engine ──

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

function getUserEffectivePermissions(userId) {
  const db = require('./db');

  // Collect all role IDs for user (direct assignments)
  const directRoles = db.prepare(`
    SELECT role_id FROM user_roles WHERE user_id=?
  `).all(userId).map(r => r.role_id);

  if (directRoles.length === 0) {
    // Fallback: use users.role to find matching role_code for backward compat
    const user = db.prepare('SELECT role FROM users WHERE id=?').get(userId);
    if (user && user.role) {
      const fallbackRole = db.prepare('SELECT role_id FROM roles WHERE role_code=?').get(user.role);
      if (fallbackRole) directRoles.push(fallbackRole.role_id);
    }
  }

  if (directRoles.length === 0) {
    return { permSet: new Set(), fieldConstraints: {} };
  }

  // Recursively collect all ancestor role IDs
  const allRoleIds = new Set();
  function collectAncestors(roleId) {
    if (allRoleIds.has(roleId)) return;
    allRoleIds.add(roleId);
    const parent = db.prepare('SELECT parent_role_id FROM roles WHERE role_id=?').get(roleId);
    if (parent && parent.parent_role_id) collectAncestors(parent.parent_role_id);
  }
  directRoles.forEach(collectAncestors);

  // Get all permissions for all roles, with deny overriding allow
  const placeholders = Array.from(allRoleIds).map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT p.perm_code, p.field_constraints, rp.effect
    FROM role_permissions rp
    JOIN permissions p ON rp.perm_id = p.perm_id
    WHERE rp.role_id IN (${placeholders})
    ORDER BY rp.effect ASC
  `).all(...Array.from(allRoleIds));

  const permSet = new Set();
  const fieldConstraints = {};

  for (const row of rows) {
    if (row.effect === 'deny') {
      permSet.delete(row.perm_code);
    } else {
      permSet.add(row.perm_code);
      if (row.field_constraints) {
        try {
          const fc = JSON.parse(row.field_constraints);
          fieldConstraints[row.perm_code] = fc;
        } catch (e) { /* ignore invalid JSON */ }
      }
    }
  }

  return { permSet, fieldConstraints };
}

async function getUserEffectivePermissionsAsync(userId) {
  if (useMysqlIdentityReadModel()) {
    const repo = await identityRepository();
    return await repo.getUserEffectivePermissions(userId);
  }

  return getUserEffectivePermissions(userId);
}

async function getUserRoleCodesAsync(userId, legacyRole) {
  if (useMysqlIdentityReadModel()) {
    const repo = await identityRepository();
    return await repo.getUserRoleCodes(userId, legacyRole);
  }

  const db = require('./db');
  return db.prepare(`
    SELECT r.role_code AS code, r.role_name AS name
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.role_id
    WHERE ur.user_id=?
    ORDER BY r.is_system DESC, r.role_code
  `).all(userId);
}

async function getUserByIdAsync(userId) {
  if (!userId) return null;
  if (useMysqlIdentityReadModel()) {
    const repo = await identityRepository();
    if (typeof repo.getUserById !== 'function') return null;
    return await repo.getUserById(userId);
  }

  const db = require('./db');
  return db.prepare('SELECT * FROM users WHERE id=?').get(userId) || null;
}

async function getDepartmentByIdAsync(departmentId) {
  if (!departmentId) return null;
  if (useMysqlIdentityReadModel()) {
    const repo = await identityRepository();
    if (typeof repo.getDepartmentById !== 'function') return null;
    return await repo.getDepartmentById(departmentId);
  }

  const db = require('./db');
  return db.prepare('SELECT * FROM departments WHERE id=?').get(departmentId) || null;
}

function attachRequestIdentityCompatibility(req, user = {}) {
  if (!req.session) return;
  const compatibilityValues = {
    userId: user.personId || user.person_id || null,
    userName: user.personName || user.person_name || user.name || '',
    departmentId: user.current_department_id || user.department_id || null
  };
  for (const [key, value] of Object.entries(compatibilityValues)) {
    if (Object.prototype.hasOwnProperty.call(req.session, key)) continue;
    Object.defineProperty(req.session, key, {
      configurable: true,
      enumerable: false,
      value
    });
  }
}

function isPasswordChangeBootstrapRequest(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  return [
    '/api/org/me',
    '/api/org/session',
    '/api/org/logout',
    '/api/org/me/password-status',
    '/api/org/me/password'
  ].includes(path);
}

async function getDepartmentByNameAsync(departmentName) {
  const name = String(departmentName || '').trim();
  if (!name) return null;
  if (useMysqlIdentityReadModel()) {
    const repo = await identityRepository();
    if (typeof repo.getDepartmentByName !== 'function') return null;
    return await repo.getDepartmentByName(name);
  }

  const db = require('./db');
  return db.prepare('SELECT * FROM departments WHERE name=?').get(name) || null;
}

function requirePermission(permCode) {
  return (req, res, next) => {
    const checkPermission = () => {
      if (!req.session || (!req.session.personId && !req.session.userId)) {
        return res.status(401).json({ error: '未登录' });
      }
      const personId = req.session.personId || req.session.userId;

      if (useMysqlIdentityReadModel()) {
        return getUserEffectivePermissionsAsync(personId)
          .then(({ permSet, fieldConstraints }) => {
            if (!permissionSetHas(permSet, permCode)) {
              return res.status(403).json({ error: '权限不足' });
            }
            req.effectivePermissions = permSet;
            req.effectiveFieldConstraints = fieldConstraints;
            const readonlyViolation = readonlyWriteViolation(req, permCode, fieldConstraints);
            if (readonlyViolation.length > 0) {
              return res.status(403).json({ error: '字段只读，不允许写入', readonly_fields: readonlyViolation });
            }
            return next();
          })
          .catch(error => {
            console.error(error);
            return res.status(503).json({ error: '身份 MySQL 读取模型不可用' });
          });
      }

      const { permSet, fieldConstraints } = getUserEffectivePermissions(personId);
      if (!permissionSetHas(permSet, permCode)) {
        return res.status(403).json({ error: '权限不足' });
      }
      req.effectivePermissions = permSet;
      req.effectiveFieldConstraints = fieldConstraints;
      const readonlyViolation = readonlyWriteViolation(req, permCode, fieldConstraints);
      if (readonlyViolation.length > 0) {
        return res.status(403).json({ error: '字段只读，不允许写入', readonly_fields: readonlyViolation });
      }
      return next();
    };
    if (useMysqlIdentityReadModel() && !req.identity) {
      return requireAuth(req, res, checkPermission);
    }
    return checkPermission();
  };
}

function requireAnyPermission(...permCodes) {
  return (req, res, next) => {
    const checkPermissions = () => {
      if (!req.session || (!req.session.personId && !req.session.userId)) {
        return res.status(401).json({ error: '未登录' });
      }
      const check = useMysqlIdentityReadModel()
        ? getUserEffectivePermissionsAsync(req.session.personId)
        : Promise.resolve(getUserEffectivePermissions(req.session.userId));
      return check
        .then(({ permSet, fieldConstraints }) => {
          if (!permCodes.some(code => permissionSetHas(permSet, code))) {
            return res.status(403).json({ error: '权限不足' });
          }
          req.effectivePermissions = permSet;
          req.effectiveFieldConstraints = fieldConstraints;
          return next();
        })
        .catch(error => {
          console.error(error);
          return res.status(503).json({
            error: '身份服务暂不可用',
            code: 'IDENTITY_SERVICE_UNAVAILABLE'
          });
        });
    };
    if (useMysqlIdentityReadModel() && !req.identity) {
      return requireAuth(req, res, checkPermissions);
    }
    return checkPermissions();
  };
}

function readonlyWriteViolation(req, permCode, fieldConstraints) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return [];
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return [];

  const constraints = fieldConstraints || {};
  const readonly = new Set();
  const fc = constraints[permCode];
  if (fc && Array.isArray(fc.readonly)) {
    fc.readonly.forEach(field => readonly.add(field));
  }
  if (readonly.size === 0) return [];

  return Array.from(readonly).filter(field => Object.prototype.hasOwnProperty.call(req.body, field));
}

function applyFieldConstraints(resourceType) {
  return (req, res, next) => {
    if (!req.effectivePermissions && req.session && req.session.userId) {
      const { permSet, fieldConstraints } = getUserEffectivePermissions(req.session.userId);
      req.effectivePermissions = permSet;
      req.effectiveFieldConstraints = fieldConstraints;
    }
    if (!req.effectivePermissions) return next();

    const constraints = req.effectiveFieldConstraints || {};

    const originalJson = res.json.bind(res);
    res.json = function (body) {
      function applyConstraints(obj, resourceConstraints) {
        if (!obj || typeof obj !== 'object') return obj;
        if (!resourceConstraints) return obj;

        if (Array.isArray(obj)) return obj.map(item => applyConstraints(item, resourceConstraints));

        const exclude = new Set(resourceConstraints.exclude || []);
        const readonly = new Set(resourceConstraints.readonly || []);
        const cleaned = {};
        const readonlyFields = [];
        const internalPrefixes = ['org_unit_id', 'position_id', 'person_id', 'product_family_id',
          'product_id', 'class_node_id', 'attribute_def_id', 'attribute_value_id',
          'external_identity_id', 'membership_id', 'assignment_id', 'password_hash'];

        for (const [key, value] of Object.entries(obj)) {
          if (internalPrefixes.some(p => key === p || key.endsWith('_id') && internalPrefixes.includes(key))) {
            cleaned[key] = value;
            continue;
          }
          if (exclude.has(key)) continue;
          if (readonly.has(key)) readonlyFields.push(key);
          cleaned[key] = applyConstraints(value, resourceConstraints);
        }
        if (readonlyFields.length > 0) cleaned._readonly_fields = readonlyFields;
        return cleaned;
      }

      // Find constraints that match this resourceType
      const relevantConstraints = {};
      for (const [permCode, fc] of Object.entries(constraints)) {
        if (permCode.startsWith(resourceType + ':')) {
          if (fc.exclude) {
            relevantConstraints.exclude = [...(relevantConstraints.exclude || []), ...fc.exclude];
          }
          if (fc.readonly) {
            relevantConstraints.readonly = [...(relevantConstraints.readonly || []), ...fc.readonly];
          }
        }
      }

      if (Object.keys(relevantConstraints).length === 0) return originalJson(body);
      return originalJson(applyConstraints(body, relevantConstraints));
    };
    next();
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  verifyPasswordAsync,
  requireAuth,
  requireRole,
  requireDataPermission,
  requirePermission,
  requireAnyPermission,
  applyFieldConstraints,
  getUserEffectivePermissions,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync,
  getUserByIdAsync,
  getDepartmentByIdAsync,
  getDepartmentByNameAsync,
  isAdmin,
  stripInternalIds,
  send401,
  send403,
  send404,
  send409,
  send422,
  setIdentityRepositoryFactory,
  resetIdentityRepositoryFactory
};
