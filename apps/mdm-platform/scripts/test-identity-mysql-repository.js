const assert = require('assert');

const { hashPassword, verifyPassword } = require('../server/auth');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');

const OLD_PASSWORD = 'OldPass123456!';
const NEW_PASSWORD = 'NewPass123456!';

function makeFakePool() {
  const state = {
    statements: [],
    departments: [
      { id: 9, name: '工程技术部', code: 'ENG' },
      { id: 10, name: '质量管理部', code: 'QMS' }
    ],
    users: [
      {
        id: 42,
        name: '张三',
        employee_no: 'U042',
        department_id: 9,
        post: '流程治理专员',
        role: 'owner',
        password_hash: hashPassword(OLD_PASSWORD),
        must_change_password: 1
      },
      {
        id: 43,
        name: '李四',
        employee_no: 'U043',
        department_id: 10,
        post: '质量审核员',
        role: 'reviewer',
        password_hash: hashPassword('OtherPass123456!'),
        must_change_password: 0
      }
    ],
    roles: [
      { role_id: 1, role_code: 'admin', role_name: '管理员', parent_role_id: null, is_system: 1 },
      { role_id: 2, role_code: 'owner', role_name: '业务负责人', parent_role_id: null, is_system: 1 },
      { role_id: 3, role_code: 'it_lead', role_name: 'IT负责人', parent_role_id: 2, is_system: 0 },
      { role_id: 4, role_code: 'data_quality', role_name: '数据质量员', parent_role_id: 2, is_system: 0 },
      { role_id: 5, role_code: 'reviewer', role_name: '审核员', parent_role_id: null, is_system: 1 },
      { role_id: 6, role_code: 'submitter', role_name: '提交人', parent_role_id: null, is_system: 1 }
    ],
    userRoles: [
      { user_id: 42, role_id: 3 },
      { user_id: 42, role_id: 4 },
      { user_id: 43, role_id: 2 }
    ],
    permissions: [
      { perm_id: 10, perm_code: 'mapping:read', field_constraints: null },
      { perm_id: 11, perm_code: 'data:view_all', field_constraints: '{"readonly":["source_file"]}' },
      { perm_id: 12, perm_code: 'process_quality:manage', field_constraints: null },
      { perm_id: 13, perm_code: 'admin:access', resource: 'admin', action: 'access', field_constraints: null },
      { perm_id: 14, perm_code: 'review:approve', resource: 'review', action: 'approve', field_constraints: null }
    ],
    rolePermissions: [
      { role_id: 2, perm_id: 10, effect: 'allow' },
      { role_id: 3, perm_id: 11, effect: 'allow' },
      { role_id: 4, perm_id: 12, effect: 'allow' },
      { role_id: 4, perm_id: 13, effect: 'allow' },
      { role_id: 2, perm_id: 14, effect: 'allow' }
    ],
    nextUserId: 100
  };

  return {
    state,
    async execute(sql, params = []) {
      state.statements.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.startsWith('CREATE TABLE') || normalizedSql.startsWith('CREATE INDEX')) {
        return [[], undefined];
      }

      if (normalizedSql.includes('FROM users u LEFT JOIN departments d') && normalizedSql.includes('WHERE u.id=?')) {
        const user = state.users.find(row => row.id === params[0]);
        if (!user) return [[], undefined];
        const dept = state.departments.find(row => row.id === user.department_id);
        return [[{
          id: user.id,
          name: user.name,
          employee_no: user.employee_no,
          department_id: user.department_id,
          department_name: dept ? dept.name : null,
          post: user.post,
          role: user.role
        }], undefined];
      }

      if (normalizedSql === 'SELECT * FROM users WHERE employee_no=?') {
        const user = state.users.find(row => row.employee_no === params[0]);
        return [[user].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM users u LEFT JOIN departments d ON u.department_id = d.id ORDER BY u.employee_no')) {
        return [state.users
          .slice()
          .sort((left, right) => left.employee_no.localeCompare(right.employee_no))
          .map(user => {
            const dept = state.departments.find(row => row.id === user.department_id);
            return {
              id: user.id,
              name: user.name,
              employee_no: user.employee_no,
              department_id: user.department_id,
              post: user.post,
              role: user.role,
              created_at: user.created_at || null,
              dept_name: dept ? dept.name : null
            };
          }), undefined];
      }

      if (normalizedSql.includes('GROUP_CONCAT(r.role_code')) {
        return [state.users.map(user => {
          const dept = state.departments.find(row => row.id === user.department_id);
          const roleIds = state.userRoles.filter(row => row.user_id === user.id).map(row => row.role_id);
          const roles = state.roles.filter(role => roleIds.includes(role.role_id));
          return {
            id: user.id,
            name: user.name,
            employee_no: user.employee_no,
            post: user.post,
            role: user.role,
            department_id: user.department_id,
            created_at: user.created_at || null,
            dept_name: dept ? dept.name : null,
            rbac_role_codes: roles.map(role => role.role_code).join(','),
            rbac_role_names: roles.map(role => role.role_name).join(',')
          };
        }).sort((left, right) => left.employee_no.localeCompare(right.employee_no)), undefined];
      }

      if (normalizedSql.includes('SELECT u.id, u.name, u.department_id, d.name AS dept_name FROM users u')) {
        return [state.users
          .map(user => {
            const dept = state.departments.find(row => row.id === user.department_id);
            return { id: user.id, name: user.name, department_id: user.department_id, dept_name: dept ? dept.name : null };
          })
          .sort((left, right) => String(left.dept_name || '').localeCompare(String(right.dept_name || ''), 'zh-CN') || left.name.localeCompare(right.name, 'zh-CN')), undefined];
      }

      if (normalizedSql === 'SELECT must_change_password FROM users WHERE id=?') {
        const user = state.users.find(row => row.id === params[0]);
        return [[user ? { must_change_password: user.must_change_password } : undefined].filter(Boolean), undefined];
      }

      if (normalizedSql === 'SELECT employee_no, password_hash FROM users WHERE id=?') {
        const user = state.users.find(row => row.id === params[0]);
        return [[user ? { employee_no: user.employee_no, password_hash: user.password_hash } : undefined].filter(Boolean), undefined];
      }

      if (normalizedSql === 'UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?') {
        const user = state.users.find(row => row.id === params[1]);
        if (user) {
          user.password_hash = params[0];
          user.must_change_password = 0;
        }
        return [{ affectedRows: user ? 1 : 0 }, undefined];
      }

      if (normalizedSql === 'INSERT INTO users (name, employee_no, department_id, post, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?)') {
        if (state.users.some(user => user.employee_no === params[1])) {
          const error = new Error('Duplicate employee_no');
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        const user = {
          id: state.nextUserId++,
          name: params[0],
          employee_no: params[1],
          department_id: params[2],
          post: params[3],
          role: params[4],
          password_hash: params[5],
          must_change_password: params[6]
        };
        state.users.push(user);
        return [{ insertId: user.id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql === 'SELECT * FROM users WHERE id=?') {
        const user = state.users.find(row => row.id === params[0]);
        return [[user].filter(Boolean), undefined];
      }

      if (normalizedSql === 'UPDATE users SET name=?, department_id=?, post=?, role=? WHERE id=?') {
        const user = state.users.find(row => row.id === params[4]);
        if (user) {
          user.name = params[0];
          user.department_id = params[1];
          user.post = params[2];
          user.role = params[3];
        }
        return [{ affectedRows: user ? 1 : 0 }, undefined];
      }

      if (normalizedSql === 'UPDATE users SET password_hash=?, must_change_password=? WHERE id=?') {
        const user = state.users.find(row => row.id === params[2]);
        if (user) {
          user.password_hash = params[0];
          user.must_change_password = params[1];
        }
        return [{ affectedRows: user ? 1 : 0 }, undefined];
      }

      if (normalizedSql === 'UPDATE users SET role=? WHERE id=?') {
        const user = state.users.find(row => row.id === params[1]);
        if (user) user.role = params[0];
        return [{ affectedRows: user ? 1 : 0 }, undefined];
      }

      if (normalizedSql.includes('SELECT r.role_code as code') && normalizedSql.includes('FROM user_roles ur JOIN roles r ON ur.role_id = r.role_id')) {
        const rows = state.userRoles
          .filter(row => row.user_id === params[0])
          .map(row => state.roles.find(role => role.role_id === row.role_id))
          .filter(Boolean)
          .sort((left, right) => Number(right.is_system) - Number(left.is_system) || left.role_code.localeCompare(right.role_code))
          .map(role => ({ code: role.role_code, name: role.role_name }));
        return [rows, undefined];
      }

      if (normalizedSql.includes('SELECT r.role_id, r.role_code, r.role_name, r.is_system FROM user_roles ur JOIN roles r')) {
        const rows = state.userRoles
          .filter(row => row.user_id === params[0])
          .map(row => state.roles.find(role => role.role_id === row.role_id))
          .filter(Boolean)
          .sort((left, right) => Number(right.is_system) - Number(left.is_system) || left.role_code.localeCompare(right.role_code))
          .map(role => ({ role_id: role.role_id, role_code: role.role_code, role_name: role.role_name, is_system: role.is_system }));
        return [rows, undefined];
      }

      if (normalizedSql === 'SELECT role_code AS code, role_name AS name FROM roles WHERE role_code=?') {
        const role = state.roles.find(row => row.role_code === params[0]);
        return [[role ? { code: role.role_code, name: role.role_name } : undefined].filter(Boolean), undefined];
      }

      if (normalizedSql === 'SELECT role_id FROM user_roles WHERE user_id=?') {
        return [state.userRoles.filter(row => row.user_id === params[0]).map(row => ({ role_id: row.role_id })), undefined];
      }

      if (normalizedSql === 'SELECT role FROM users WHERE id=?') {
        const user = state.users.find(row => row.id === params[0]);
        return [[user ? { role: user.role } : undefined].filter(Boolean), undefined];
      }

      if (normalizedSql === 'SELECT role_id FROM roles WHERE role_code=?') {
        const role = state.roles.find(row => row.role_code === params[0]);
        return [[role ? { role_id: role.role_id } : undefined].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('SELECT role_id, role_code, role_name FROM roles WHERE role_id IN')) {
        const roleIds = new Set(params);
        const rows = state.roles
          .filter(role => roleIds.has(role.role_id))
          .sort((left, right) => Number(right.is_system) - Number(left.is_system) || left.role_code.localeCompare(right.role_code))
          .map(role => ({ role_id: role.role_id, role_code: role.role_code, role_name: role.role_name }));
        return [rows, undefined];
      }

      if (normalizedSql === 'SELECT parent_role_id FROM roles WHERE role_id=?') {
        const role = state.roles.find(row => row.role_id === params[0]);
        return [[role ? { parent_role_id: role.parent_role_id } : undefined].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id')) {
        const roleIds = new Set(params);
        const rows = state.rolePermissions
          .filter(row => roleIds.has(row.role_id))
          .map(row => {
            const permission = state.permissions.find(item => item.perm_id === row.perm_id);
            return {
              perm_code: permission.perm_code,
              field_constraints: permission.field_constraints,
              effect: row.effect
            };
          });
        return [rows, undefined];
      }

      if (normalizedSql === 'SELECT * FROM permissions ORDER BY resource, action') {
        return [state.permissions
          .map(permission => ({ ...permission }))
          .sort((left, right) => String(left.resource || '').localeCompare(String(right.resource || '')) || String(left.action || '').localeCompare(String(right.action || ''))), undefined];
      }

      if (normalizedSql === 'DELETE FROM user_roles WHERE user_id=?') {
        state.userRoles = state.userRoles.filter(row => row.user_id !== params[0]);
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql === 'INSERT IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)') {
        if (!state.userRoles.some(row => row.user_id === params[0] && row.role_id === params[1])) {
          state.userRoles.push({ user_id: params[0], role_id: params[1], assigned_by: params[2] });
        }
        return [{ affectedRows: 1 }, undefined];
      }

      throw new Error(`Unhandled SQL in fake identity pool: ${normalizedSql}`);
    }
  };
}

async function main() {
  const pool = makeFakePool();
  const repo = makeIdentityMysqlRepository(pool);

  await repo.initSchema();

  const payload = await repo.getCurrentUserPayload({
    userId: 42,
    userRole: 'submitter',
    userName: '会话姓名',
    departmentId: 1
  });

  assert.strictEqual(payload.id, 42);
  assert.strictEqual(payload.name, '张三');
  assert.strictEqual(payload.role, 'owner');
  assert.strictEqual(payload.departmentId, 9);
  assert.strictEqual(payload.departmentName, '工程技术部');
  assert.deepStrictEqual(payload.roleCodes, ['owner', 'data_quality', 'it_lead']);
  assert.deepStrictEqual(payload.rbacRoles.map(role => role.name), ['业务负责人', '数据质量员', 'IT负责人']);
  assert.ok(payload.permissions.includes('mapping:read'), 'parent role permissions should be inherited');
  assert.ok(payload.permissions.includes('data:view_all'), 'direct role permissions should be included');
  assert.ok(payload.permissions.includes('process_quality:manage'), 'multiple direct roles should be included');

  const effective = await repo.getUserEffectivePermissions(42);
  assert.ok(effective.permSet.has('mapping:read'));
  assert.deepStrictEqual(effective.fieldConstraints['data:view_all'], { readonly: ['source_file'] });

  const loginUser = await repo.getUserByEmployeeNo('U042');
  assert.strictEqual(loginUser.id, 42);
  assert.ok(verifyPassword(OLD_PASSWORD, loginUser.password_hash));

  const missingLoginUser = await repo.getUserByEmployeeNo('missing');
  assert.strictEqual(missingLoginUser, null);

  const passwordStatus = await repo.getPasswordStatus(42);
  assert.deepStrictEqual(passwordStatus, { is_default_password: true });

  const passwordCredential = await repo.getPasswordCredential(42);
  assert.strictEqual(passwordCredential.employee_no, 'U042');
  assert.ok(verifyPassword(OLD_PASSWORD, passwordCredential.password_hash));

  await repo.updateOwnPassword(42, hashPassword(NEW_PASSWORD));
  const updatedCredential = await repo.getPasswordCredential(42);
  assert.ok(verifyPassword(NEW_PASSWORD, updatedCredential.password_hash));
  assert.deepStrictEqual(await repo.getPasswordStatus(42), { is_default_password: false });

  const users = await repo.listUsers();
  assert.deepStrictEqual(users.map(user => user.employee_no), ['U042', 'U043']);
  assert.strictEqual(users[0].dept_name, '工程技术部');
  assert.strictEqual(users[1].dept_name, '质量管理部');

  const roleSummary = await repo.listUserRoleSummaries();
  assert.strictEqual(roleSummary[0].rbac_role_codes, 'it_lead,data_quality');
  assert.strictEqual(roleSummary[1].rbac_role_names, '业务负责人');

  const assignableUsers = await repo.listAssignableUsers();
  assert.deepStrictEqual(assignableUsers.map(user => user.name), ['张三', '李四']);
  assert.strictEqual(assignableUsers[0].dept_name, '工程技术部');

  const userRoles = await repo.getAssignedRoles(42);
  assert.deepStrictEqual(userRoles.map(role => role.role_code), ['data_quality', 'it_lead']);

  const groupedPermissions = await repo.getPermissionsGrouped();
  assert.ok(Array.isArray(groupedPermissions.admin));
  assert.strictEqual(groupedPermissions.admin[0].perm_code, 'admin:access');

  const created = await repo.createUser({
    name: '王五',
    employee_no: 'U100',
    department_id: 10,
    post: '项目经理',
    role: 'it_lead',
    password_hash: hashPassword('CreatedPass123456!'),
    must_change_password: 0,
    role_ids: [3, 4],
    assigned_by: 42
  });
  assert.strictEqual(created.id, 100);
  assert.strictEqual(created.role, 'owner');
  assert.deepStrictEqual((await repo.getAssignedRoles(100)).map(role => role.role_code), ['owner', 'data_quality', 'it_lead']);

  const updated = await repo.updateUser(100, {
    name: '王五更新',
    department_id: 9,
    post: '流程负责人',
    role: 'reviewer',
    role_ids: [4],
    assigned_by: 42
  });
  assert.strictEqual(updated, true);
  const updatedUser = pool.state.users.find(user => user.id === 100);
  assert.strictEqual(updatedUser.name, '王五更新');
  assert.strictEqual(updatedUser.role, 'reviewer');
  assert.deepStrictEqual((await repo.getAssignedRoles(100)).map(role => role.role_code), ['reviewer', 'data_quality']);

  const resetPasswordHash = hashPassword('ResetPass123456!');
  assert.strictEqual(await repo.resetUserPassword(100, resetPasswordHash, 1), true);
  const resetCredential = await repo.getPasswordCredential(100);
  assert.ok(verifyPassword('ResetPass123456!', resetCredential.password_hash));
  assert.deepStrictEqual(await repo.getPasswordStatus(100), { is_default_password: true });

  assert.strictEqual(await repo.replaceUserRoles(100, [1], 42), true);
  assert.strictEqual(pool.state.users.find(user => user.id === 100).role, 'admin');
  assert.deepStrictEqual((await repo.getAssignedRoles(100)).map(role => role.role_code), ['admin']);

  assert.strictEqual(await repo.updateUser(9999, { name: '不存在' }), false);
  assert.strictEqual(await repo.resetUserPassword(9999, resetPasswordHash, 1), false);
  assert.strictEqual(await repo.replaceUserRoles(9999, [1], 42), false);

  const unsafeSql = pool.state.statements.map(entry => entry.sql).join('\n');
  assert.ok(!unsafeSql.includes('sqlite_master'), 'identity MySQL repository must not use SQLite catalog tables');
  assert.ok(!unsafeSql.includes('PRAGMA'), 'identity MySQL repository must not use SQLite PRAGMA');
  assert.ok(!unsafeSql.includes('lastInsertRowid'), 'identity MySQL repository must not use SQLite lastInsertRowid');

  console.log('Identity MySQL repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
