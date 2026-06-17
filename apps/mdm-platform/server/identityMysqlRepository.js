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

const BASIC_ROLE_CODES = new Set(['submitter', 'owner', 'reviewer', 'admin']);

function normalizeRoleIds(roleIds) {
  if (!Array.isArray(roleIds)) return [];
  return [...new Set(roleIds.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0))];
}

function affectedRows(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.affectedRows || 0);
}

function insertId(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.insertId || 0);
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

  async function withOptionalTransaction(work) {
    if (typeof pool.getConnection !== 'function') {
      return await work(pool);
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function getRolesByIds(roleIds, executor = pool) {
    const ids = normalizeRoleIds(roleIds);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return await rows(executor, `
      SELECT role_id, role_code, role_name
      FROM roles
      WHERE role_id IN (${placeholders})
      ORDER BY is_system DESC, role_code
    `, ids);
  }

  async function getRoleIdByCode(roleCode, executor = pool) {
    if (!roleCode) return null;
    const role = await first(executor, 'SELECT role_id FROM roles WHERE role_code=?', [roleCode]);
    return role ? role.role_id : null;
  }

  async function chooseCompatibleRole(requestedRole, roleIds, fallbackRole, executor = pool) {
    if (BASIC_ROLE_CODES.has(requestedRole)) return requestedRole;

    const allRoleIds = await collectRoleAndAncestors(normalizeRoleIds(roleIds));
    const roles = await getRolesByIds(allRoleIds, executor);
    const basicRole = roles.find(role => BASIC_ROLE_CODES.has(role.role_code));
    if (basicRole) return basicRole.role_code;

    if (BASIC_ROLE_CODES.has(fallbackRole)) return fallbackRole;
    return 'submitter';
  }

  async function syncUserRoles(userId, roleIds, compatibleRole, assignedBy, executor = pool) {
    const ids = new Set(normalizeRoleIds(roleIds));
    const compatibleRoleId = await getRoleIdByCode(compatibleRole, executor);
    if (compatibleRoleId) ids.add(compatibleRoleId);
    if (ids.size === 0) return;

    await executor.execute('DELETE FROM user_roles WHERE user_id=?', [userId]);
    for (const roleId of ids) {
      await executor.execute('INSERT IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)', [
        userId,
        roleId,
        assignedBy || null
      ]);
    }
  }

  async function departmentPath(departmentId, parentId, executor = pool) {
    let path = `/${departmentId}/`;
    if (parentId) {
      const parent = await first(executor, 'SELECT path FROM departments WHERE id=?', [parentId]);
      if (parent && parent.path) path = `${parent.path}${departmentId}/`;
    }
    return path;
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

    async listDepartments() {
      return await rows(pool, 'SELECT * FROM departments ORDER BY code');
    },

    async createDepartment(payload = {}) {
      return await withOptionalTransaction(async executor => {
        const result = await executor.execute(
          'INSERT INTO departments (name, code, parent_id, department_type, manager_user_id, data_owner_user_id, source_system, external_id, status, effective_from, effective_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            payload.name,
            payload.code,
            payload.parent_id || null,
            payload.department_type || null,
            payload.manager_user_id || null,
            payload.data_owner_user_id || null,
            payload.source_system || 'MDM_SYS',
            payload.external_id || null,
            payload.status || 'active',
            payload.effective_from || null,
            payload.effective_to || null,
            payload.created_by || null
          ]
        );
        const id = insertId(result);
        await executor.execute('UPDATE departments SET path=? WHERE id=?', [
          await departmentPath(id, payload.parent_id || null, executor),
          id
        ]);
        return { id };
      });
    },

    async updateDepartment(departmentId, payload = {}) {
      const path = await departmentPath(departmentId, payload.parent_id || null);
      const result = await pool.execute(
        `UPDATE departments
         SET name=?, code=?, parent_id=?, path=?, sort_order=?, department_type=?,
             manager_user_id=?, data_owner_user_id=?, source_system=?, external_id=?,
             status=?, effective_from=?, effective_to=?, updated_by=?
         WHERE id=?`,
        [
          payload.name,
          payload.code,
          payload.parent_id || null,
          path,
          payload.sort_order || 0,
          payload.department_type || null,
          payload.manager_user_id || null,
          payload.data_owner_user_id || null,
          payload.source_system || 'MDM_SYS',
          payload.external_id || null,
          payload.status || 'active',
          payload.effective_from || null,
          payload.effective_to || null,
          payload.updated_by || null,
          departmentId
        ]
      );
      return affectedRows(result) > 0;
    },

    async deleteDepartment(departmentId) {
      const result = await pool.execute('DELETE FROM departments WHERE id=?', [departmentId]);
      return affectedRows(result) > 0;
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

    async listRoles() {
      return await rows(pool, `
        SELECT r.*,
          (SELECT role_name FROM roles pr WHERE pr.role_id = r.parent_role_id) as parent_role_name,
          (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.role_id) as perm_count,
          (SELECT COUNT(*) FROM user_roles WHERE role_id = r.role_id) as user_count
        FROM roles r
        ORDER BY r.is_system DESC, r.role_code
      `);
    },

    async getRoleDetail(roleId) {
      const role = await first(pool, 'SELECT * FROM roles WHERE role_id=?', [roleId]);
      if (!role) return null;

      const ownPerms = await rows(pool, `
        SELECT p.perm_id, p.perm_code, p.resource, p.action, p.field_constraints, p.description, rp.effect, 0 as inherited
        FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id
        WHERE rp.role_id=?
      `, [roleId]);
      const knownPermCodes = new Set(ownPerms.map(permission => permission.perm_code));
      const inheritedPerms = [];

      let parentId = role.parent_role_id;
      const visited = new Set();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parentPerms = await rows(pool, `
          SELECT p.perm_id, p.perm_code, p.resource, p.action, p.field_constraints, p.description, rp.effect, 1 as inherited
          FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id
          WHERE rp.role_id=?
        `, [parentId]);
        for (const permission of parentPerms) {
          if (!knownPermCodes.has(permission.perm_code)) {
            inheritedPerms.push(permission);
            knownPermCodes.add(permission.perm_code);
          }
        }
        const parent = await first(pool, 'SELECT parent_role_id FROM roles WHERE role_id=?', [parentId]);
        parentId = parent ? parent.parent_role_id : null;
      }

      const users = await rows(pool, `
        SELECT u.id, u.name, u.employee_no, u.department_id, u.post, d.name as dept_name
        FROM user_roles ur
        JOIN users u ON ur.user_id = u.id
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE ur.role_id=?
      `, [roleId]);

      return { ...role, permissions: [...ownPerms, ...inheritedPerms], users };
    },

    async getRolePermissionMatrix(roleId) {
      const role = await first(pool, 'SELECT * FROM roles WHERE role_id=?', [roleId]);
      if (!role) return null;

      const allPerms = await rows(pool, 'SELECT * FROM permissions ORDER BY resource, action');
      const rolePerms = await rows(pool, `
        SELECT p.perm_code, rp.effect FROM role_permissions rp
        JOIN permissions p ON rp.perm_id = p.perm_id WHERE rp.role_id=?
      `, [roleId]);
      const rolePermMap = new Map(rolePerms.map(permission => [permission.perm_code, permission.effect]));

      return {
        role,
        matrix: allPerms.map(permission => ({
          ...permission,
          assigned: rolePermMap.has(permission.perm_code),
          effect: rolePermMap.get(permission.perm_code) || null
        }))
      };
    },

    async createRole(payload = {}) {
      const result = await pool.execute(
        'INSERT INTO roles (role_code, role_name, description, parent_role_id, created_by) VALUES (?, ?, ?, ?, ?)',
        [
          payload.role_code,
          payload.role_name,
          payload.description || null,
          payload.parent_role_id || null,
          payload.created_by || null
        ]
      );
      return { role_id: insertId(result) };
    },

    async updateRole(roleId, payload = {}) {
      const role = await first(pool, 'SELECT * FROM roles WHERE role_id=?', [roleId]);
      if (!role) return false;
      const result = await pool.execute(
        'UPDATE roles SET role_name=?, description=?, parent_role_id=?, updated_at=CURRENT_TIMESTAMP WHERE role_id=?',
        [
          payload.role_name || role.role_name,
          Object.prototype.hasOwnProperty.call(payload, 'description') ? payload.description : role.description,
          Object.prototype.hasOwnProperty.call(payload, 'parent_role_id') ? payload.parent_role_id || null : role.parent_role_id || null,
          roleId
        ]
      );
      return affectedRows(result) > 0;
    },

    async deleteRole(roleId) {
      const role = await first(pool, 'SELECT * FROM roles WHERE role_id=?', [roleId]);
      if (!role) return { deleted: false, reason: 'missing' };
      if (role.is_system) return { deleted: false, reason: 'system' };

      const userCount = await first(pool, 'SELECT COUNT(*) as cnt FROM user_roles WHERE role_id=?', [roleId]);
      if (Number(userCount && userCount.cnt || 0) > 0) {
        return { deleted: false, reason: 'assigned', count: Number(userCount.cnt) };
      }

      const childCount = await first(pool, 'SELECT COUNT(*) as cnt FROM roles WHERE parent_role_id=?', [roleId]);
      if (Number(childCount && childCount.cnt || 0) > 0) {
        return { deleted: false, reason: 'children', count: Number(childCount.cnt) };
      }

      return await withOptionalTransaction(async executor => {
        await executor.execute('DELETE FROM role_permissions WHERE role_id=?', [roleId]);
        await executor.execute('DELETE FROM roles WHERE role_id=?', [roleId]);
        return { deleted: true };
      });
    },

    async replaceRolePermissions(roleId, permIds = [], effects = {}) {
      const role = await first(pool, 'SELECT * FROM roles WHERE role_id=?', [roleId]);
      if (!role) return null;

      const ids = normalizeRoleIds(permIds);
      return await withOptionalTransaction(async executor => {
        await executor.execute('DELETE FROM role_permissions WHERE role_id=?', [roleId]);
        for (const permId of ids) {
          await executor.execute('INSERT INTO role_permissions (role_id, perm_id, effect) VALUES (?, ?, ?)', [
            roleId,
            permId,
            effects && effects[permId] ? effects[permId] : 'allow'
          ]);
        }
        return { success: true, count: ids.length };
      });
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
      return affectedRows(result) > 0;
    },

    async createUser(payload = {}) {
      return await withOptionalTransaction(async executor => {
        const compatibleRole = await chooseCompatibleRole(payload.role, payload.role_ids, 'submitter', executor);
        const result = await executor.execute(
          'INSERT INTO users (name, employee_no, department_id, post, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            payload.name,
            payload.employee_no,
            payload.department_id || null,
            payload.post || null,
            compatibleRole,
            payload.password_hash,
            payload.must_change_password ? 1 : 0
          ]
        );
        const id = insertId(result);
        await syncUserRoles(id, payload.role_ids, compatibleRole, payload.assigned_by, executor);
        return { id, role: compatibleRole };
      });
    },

    async updateUser(userId, payload = {}) {
      return await withOptionalTransaction(async executor => {
        const existing = await first(executor, 'SELECT * FROM users WHERE id=?', [userId]);
        if (!existing) return false;

        const compatibleRole = await chooseCompatibleRole(payload.role, payload.role_ids, existing.role, executor);
        const result = await executor.execute(
          'UPDATE users SET name=?, department_id=?, post=?, role=? WHERE id=?',
          [
            payload.name || existing.name,
            Object.prototype.hasOwnProperty.call(payload, 'department_id') ? payload.department_id || null : existing.department_id || null,
            Object.prototype.hasOwnProperty.call(payload, 'post') ? payload.post || null : existing.post || null,
            compatibleRole,
            userId
          ]
        );
        if (Array.isArray(payload.role_ids)) {
          await syncUserRoles(userId, payload.role_ids, compatibleRole, payload.assigned_by, executor);
        }
        return affectedRows(result) > 0;
      });
    },

    async resetUserPassword(userId, passwordHash, mustChangePassword) {
      const result = await pool.execute('UPDATE users SET password_hash=?, must_change_password=? WHERE id=?', [
        passwordHash,
        mustChangePassword ? 1 : 0,
        userId
      ]);
      return affectedRows(result) > 0;
    },

    async replaceUserRoles(userId, roleIds, assignedBy) {
      return await withOptionalTransaction(async executor => {
        const existing = await first(executor, 'SELECT * FROM users WHERE id=?', [userId]);
        if (!existing) return false;

        const compatibleRole = await chooseCompatibleRole(null, roleIds, existing.role, executor);
        await syncUserRoles(userId, roleIds, compatibleRole, assignedBy, executor);
        const result = await executor.execute('UPDATE users SET role=? WHERE id=?', [compatibleRole, userId]);
        return affectedRows(result) > 0;
      });
    },

    getUserEffectivePermissions
  };
}

module.exports = {
  makeIdentityMysqlRepository
};
