const assert = require('assert');

const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');

function makeFakePool() {
  const state = {
    statements: [],
    departments: [
      { id: 9, name: '工程技术部', code: 'ENG' }
    ],
    users: [
      {
        id: 42,
        name: '张三',
        employee_no: 'U042',
        department_id: 9,
        post: '流程治理专员',
        role: 'owner'
      }
    ],
    roles: [
      { role_id: 1, role_code: 'admin', role_name: '管理员', parent_role_id: null, is_system: 1 },
      { role_id: 2, role_code: 'owner', role_name: '业务负责人', parent_role_id: null, is_system: 1 },
      { role_id: 3, role_code: 'it_lead', role_name: 'IT负责人', parent_role_id: 2, is_system: 0 },
      { role_id: 4, role_code: 'data_quality', role_name: '数据质量员', parent_role_id: 2, is_system: 0 }
    ],
    userRoles: [
      { user_id: 42, role_id: 3 },
      { user_id: 42, role_id: 4 }
    ],
    permissions: [
      { perm_id: 10, perm_code: 'mapping:read', field_constraints: null },
      { perm_id: 11, perm_code: 'data:view_all', field_constraints: '{"readonly":["source_file"]}' },
      { perm_id: 12, perm_code: 'process_quality:manage', field_constraints: null }
    ],
    rolePermissions: [
      { role_id: 2, perm_id: 10, effect: 'allow' },
      { role_id: 3, perm_id: 11, effect: 'allow' },
      { role_id: 4, perm_id: 12, effect: 'allow' }
    ]
  };

  return {
    state,
    async execute(sql, params = []) {
      state.statements.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.startsWith('CREATE TABLE') || normalizedSql.startsWith('CREATE INDEX')) {
        return [[], undefined];
      }

      if (normalizedSql.includes('FROM users u LEFT JOIN departments d')) {
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

      if (normalizedSql.includes('FROM user_roles ur JOIN roles r ON ur.role_id = r.role_id')) {
        const rows = state.userRoles
          .filter(row => row.user_id === params[0])
          .map(row => state.roles.find(role => role.role_id === row.role_id))
          .filter(Boolean)
          .sort((left, right) => Number(right.is_system) - Number(left.is_system) || left.role_code.localeCompare(right.role_code))
          .map(role => ({ code: role.role_code, name: role.role_name }));
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
