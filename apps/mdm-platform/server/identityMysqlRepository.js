const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

async function rows(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return Array.isArray(result) ? result : [];
}

async function first(pool, sql, params = []) {
  const result = await rows(pool, sql, params);
  return result[0] || null;
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function makeIdentityMysqlRepository(pool) {
  async function getUserRoleCodes(userId, legacyRole) {
    const assignedRoles = await rows(pool, `
      SELECT r.role_code as code, r.role_name as name
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.role_id
      WHERE ur.user_id=?
      ORDER BY r.is_system DESC, r.role_code
    `, [userId]);

    if (legacyRole && !assignedRoles.some(role => role.code === legacyRole)) {
      const legacy = await first(pool, 'SELECT role_code AS code, role_name AS name FROM roles WHERE role_code=?', [legacyRole]);
      if (legacy) assignedRoles.unshift(legacy);
    }

    return assignedRoles;
  }

  async function getDirectRoleIds(userId) {
    const directRoles = (await rows(pool, 'SELECT role_id FROM user_roles WHERE user_id=?', [userId]))
      .map(role => role.role_id);

    if (directRoles.length > 0) return directRoles;

    const user = await first(pool, 'SELECT role FROM users WHERE id=?', [userId]);
    if (!user || !user.role) return [];
    const fallbackRole = await first(pool, 'SELECT role_id FROM roles WHERE role_code=?', [user.role]);
    return fallbackRole ? [fallbackRole.role_id] : [];
  }

  async function collectRoleAndAncestors(roleIds) {
    const allRoleIds = new Set();

    async function collect(roleId) {
      if (!roleId || allRoleIds.has(roleId)) return;
      allRoleIds.add(roleId);
      const parent = await first(pool, 'SELECT parent_role_id FROM roles WHERE role_id=?', [roleId]);
      if (parent && parent.parent_role_id) await collect(parent.parent_role_id);
    }

    for (const roleId of roleIds) await collect(roleId);
    return Array.from(allRoleIds);
  }

  async function getUserEffectivePermissions(userId) {
    const directRoleIds = await getDirectRoleIds(userId);
    if (directRoleIds.length === 0) {
      return { permSet: new Set(), fieldConstraints: {} };
    }

    const allRoleIds = await collectRoleAndAncestors(directRoleIds);
    if (allRoleIds.length === 0) {
      return { permSet: new Set(), fieldConstraints: {} };
    }

    const placeholders = allRoleIds.map(() => '?').join(',');
    const permissionRows = await rows(pool, `
      SELECT p.perm_code, p.field_constraints, rp.effect
      FROM role_permissions rp
      JOIN permissions p ON rp.perm_id = p.perm_id
      WHERE rp.role_id IN (${placeholders})
      ORDER BY rp.effect ASC
    `, allRoleIds);

    const permSet = new Set();
    const fieldConstraints = {};

    for (const permission of permissionRows) {
      if (permission.effect === 'deny') {
        permSet.delete(permission.perm_code);
      } else {
        permSet.add(permission.perm_code);
        if (permission.field_constraints) {
          const constraints = parseJsonObject(permission.field_constraints, null);
          if (constraints) fieldConstraints[permission.perm_code] = constraints;
        }
      }
    }

    return { permSet, fieldConstraints };
  }

  return {
    async initSchema() {
      for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
        await pool.execute(statement);
      }
    },

    async getUserByEmployeeNo(employeeNo) {
      return await first(pool, 'SELECT * FROM users WHERE employee_no=?', [employeeNo]);
    },

    async listUsers() {
      return await rows(pool, `
        SELECT u.id, u.name, u.employee_no, u.department_id, u.post, u.role, u.created_at, d.name as dept_name
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        ORDER BY u.employee_no
      `);
    },

    async listUserRoleSummaries() {
      const userRows = await rows(pool, `
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
      `);
      return userRows.map(user => ({
        id: user.id,
        name: user.name,
        employee_no: user.employee_no,
        department_id: user.department_id,
        dept_name: user.dept_name || null,
        post: user.post,
        role: user.role,
        created_at: user.created_at,
        rbac_role_codes: user.rbac_role_codes || '',
        rbac_role_names: user.rbac_role_names || ''
      }));
    },

    async listAssignableUsers() {
      const userRows = await rows(pool, `
        SELECT u.id, u.name, u.department_id, d.name AS dept_name
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        ORDER BY d.name, u.name
      `);
      return userRows.map(user => ({
        id: user.id,
        name: user.name,
        department_id: user.department_id,
        dept_name: user.dept_name || null
      }));
    },

    async getAssignedRoles(userId) {
      return await rows(pool, `
        SELECT r.role_id, r.role_code, r.role_name, r.is_system
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        WHERE ur.user_id=?
        ORDER BY r.is_system DESC, r.role_code
      `, [userId]);
    },

    async getPermissionsGrouped() {
      const permissions = await rows(pool, 'SELECT * FROM permissions ORDER BY resource, action');
      const grouped = {};
      for (const permission of permissions) {
        if (!grouped[permission.resource]) grouped[permission.resource] = [];
        grouped[permission.resource].push(permission);
      }
      return grouped;
    },

    async getCurrentUserPayload(session = {}) {
      if (!session.userId) return null;

      const user = await first(pool, `
        SELECT u.id, u.name, u.employee_no, u.department_id, d.name AS department_name, u.post, u.role
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE u.id=?
        LIMIT 1
      `, [session.userId]);
      if (!user) return null;

      const { permSet } = await getUserEffectivePermissions(user.id);
      const rbacRoles = await getUserRoleCodes(user.id, user.role || session.userRole);

      return {
        id: user.id,
        name: user.name || session.userName || '',
        role: user.role || session.userRole || 'submitter',
        departmentId: user.department_id || null,
        departmentName: user.department_name || null,
        rbacRoles,
        roleCodes: rbacRoles.map(role => role.code),
        permissions: Array.from(permSet)
      };
    },

    async getPasswordStatus(userId) {
      const user = await first(pool, 'SELECT must_change_password FROM users WHERE id=?', [userId]);
      if (!user) return null;
      return { is_default_password: Boolean(user.must_change_password) };
    },

    async getPasswordCredential(userId) {
      return await first(pool, 'SELECT employee_no, password_hash FROM users WHERE id=?', [userId]);
    },

    async updateOwnPassword(userId, passwordHash) {
      const result = await pool.execute('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?', [passwordHash, userId]);
      const meta = Array.isArray(result) ? result[0] : null;
      return Boolean(meta && meta.affectedRows > 0);
    },

    getUserEffectivePermissions
  };
}

module.exports = {
  makeIdentityMysqlRepository
};
