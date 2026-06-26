const assert = require('assert');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');

function makePool() {
  const state = { statements: [] };
  return {
    state,
    async execute(sql, params = []) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      state.statements.push({ sql: normalizedSql, params });

      if (normalizedSql.includes('FROM person p') && normalizedSql.includes('WHERE p.person_id=?')) {
        return [[{
          person_id: 501,
          account_id: 9001,
          employee_no: 'A001',
          person_name: '池炳辉',
          current_department_id: 20,
          department_name: '工程技术部',
          login_name: 'A001',
          account_status: 'active',
          status: 'active'
        }], undefined];
      }

      if (normalizedSql.includes('FROM person_position_assignment')) {
        return [[{
          position_id: 7,
          position_code: 'ENG_RESP',
          position_name: '工程技术部最终响应责任人',
          department_admin_level: 2,
          department_admin_title: '部门级负责人',
          responsibility_scope: '本部门流程治理响应'
        }], undefined];
      }

      if (normalizedSql.includes('SELECT r.role_code as code') && normalizedSql.includes('FROM person_roles pr JOIN roles r')) {
        return [[
          { code: 'owner', name: '业务负责人' },
          { code: 'data_quality', name: '数据质量员' }
        ], undefined];
      }

      if (normalizedSql === 'SELECT role_id FROM person_roles WHERE person_id=?') {
        return [[{ role_id: 1 }, { role_id: 2 }], undefined];
      }

      if (normalizedSql === 'SELECT parent_role_id FROM roles WHERE role_id=?') {
        return [[{ parent_role_id: null }], undefined];
      }

      if (normalizedSql.includes('FROM role_permissions rp JOIN permissions p ON rp.perm_id = p.perm_id')) {
        return [[
          { perm_code: 'process_governance:view_department', effect: 'allow', field_constraints: null },
          { perm_code: 'guidance:respond', effect: 'allow', field_constraints: null }
        ], undefined];
      }

      throw new Error(`Unhandled SQL in person identity payload fake pool: ${normalizedSql}`);
    }
  };
}

async function main() {
  const pool = makePool();
  const repo = makeIdentityMysqlRepository(pool);
  const payload = await repo.getCurrentUserPayload({ personId: 501, accountId: 9001, userRole: 'owner' });

  assert.strictEqual(payload.id, 501);
  assert.strictEqual(payload.personId, 501);
  assert.strictEqual(payload.accountId, 9001);
  assert.strictEqual(payload.employeeNo, 'A001');
  assert.strictEqual(payload.personName, '池炳辉');
  assert.strictEqual(payload.departmentId, 20);
  assert.strictEqual(payload.departmentName, '工程技术部');
  assert.deepStrictEqual(payload.roleCodes, ['owner', 'data_quality']);
  assert.ok(payload.permissions.includes('guidance:respond'));
  assert.strictEqual(payload.positions[0].positionCode, 'ENG_RESP');
  assert.strictEqual(payload.positions[0].departmentAdminTitle, '部门级负责人');
  assert.deepStrictEqual(payload.dataScopes, ['department:20', 'person:501']);

  console.log('Person identity payload MySQL test passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
