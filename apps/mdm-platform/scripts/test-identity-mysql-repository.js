const assert = require('assert');
const { hashPassword, verifyPassword } = require('../server/auth');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const { ACCESS_MODEL_VERSION } = require('../server/roleDefinitions');

const OLD_PASSWORD = 'OldPass123456!';
const NEW_PASSWORD = 'NewPass123456!';

function makeFakePool() {
  const state = {
    passwordHash: hashPassword(OLD_PASSWORD),
    mustChangePassword: 1,
    authVersion: 7,
    accountStatus: 'active',
    events: [],
    statements: []
  };
  const personRow = () => ({
    person_id: 42,
    employee_no: 'ADMIN001',
    person_name: '治理管理员',
    current_department_id: 9,
    mobile: null,
    email: null,
    employment_status: 'active',
    status: 'active',
    account_id: 142,
    login_name: 'ADMIN001',
    password_hash: state.passwordHash,
    must_change_password: state.mustChangePassword,
    account_status: state.accountStatus,
    auth_version: state.authVersion,
    department_name: '工程技术部'
  });

  return {
    state,
    async execute(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      state.statements.push({ sql: normalized, params });

      if (normalized.includes('FROM user_accounts ua JOIN person p') && normalized.includes('WHERE ua.login_name=?')) {
        return [params[0] === 'ADMIN001' && state.accountStatus === 'active' ? [personRow()] : [], undefined];
      }
      if (normalized.includes('FROM person p LEFT JOIN user_accounts ua') && normalized.includes('WHERE p.person_id=?')) {
        return [Number(params[0]) === 42 ? [personRow()] : [], undefined];
      }
      if (normalized.includes('SELECT r.role_code AS code') && normalized.includes('FROM person_roles pr')) {
        assert.strictEqual(params[1], ACCESS_MODEL_VERSION);
        return [[
          {
            code: 'department_contact',
            name: '部门主对接人',
            assignmentId: 301,
            scopeType: 'department',
            scopeDepartmentId: 9,
            authorizationBasis: '部门授权决定',
            effectiveFrom: '2026-07-30',
            effectiveTo: null
          },
          {
            code: 'department_mdm_reviewer',
            name: '部门MDM审核员',
            assignmentId: 302,
            scopeType: 'department',
            scopeDepartmentId: 9,
            authorizationBasis: '部门授权决定',
            effectiveFrom: '2026-07-30',
            effectiveTo: null
          }
        ], undefined];
      }
      if (normalized.startsWith('SELECT pr.role_id FROM person_roles pr')) {
        assert.strictEqual(params[1], ACCESS_MODEL_VERSION);
        return [[{ role_id: 3 }, { role_id: 4 }], undefined];
      }
      if (normalized === 'SELECT parent_role_id FROM roles WHERE role_id=?') {
        return [[{ parent_role_id: null }], undefined];
      }
      if (normalized.startsWith('SELECT p.perm_code, p.field_constraints, rp.effect FROM role_permissions rp')) {
        return [[
          {
            perm_code: 'governance:read-department',
            field_constraints: null,
            effect: 'allow'
          },
          {
            perm_code: 'governance:draft-department',
            field_constraints: '{"readonly":["source_file"]}',
            effect: 'allow'
          },
          {
            perm_code: 'governance:submit-department',
            field_constraints: null,
            effect: 'allow'
          },
          {
            perm_code: 'governance:review-department',
            field_constraints: null,
            effect: 'allow'
          },
          {
            perm_code: 'governance:record-department-decision',
            field_constraints: null,
            effect: 'allow'
          }
        ], undefined];
      }
      if (normalized.includes('FROM person_position_assignment ppa')) {
        return [[{
          position_id: 11,
          position_code: 'POS-011',
          position_name: '流程治理专员',
          department_admin_level: null,
          department_admin_title: null,
          responsibility_scope: '流程治理'
        }], undefined];
      }
      if (normalized === "UPDATE user_accounts SET last_login_at=CURRENT_TIMESTAMP WHERE person_id=? AND account_status='active'") {
        return [{ affectedRows: Number(params[0]) === 42 ? 1 : 0 }, undefined];
      }
      if (normalized === 'SELECT must_change_password FROM user_accounts WHERE person_id=?') {
        return [Number(params[0]) === 42 ? [{ must_change_password: state.mustChangePassword }] : [], undefined];
      }
      if (normalized.includes('SELECT p.employee_no, ua.password_hash FROM user_accounts ua')) {
        return [Number(params[0]) === 42
          ? [{ employee_no: 'ADMIN001', password_hash: state.passwordHash }]
          : [], undefined];
      }
      if (normalized.startsWith('UPDATE user_accounts SET password_hash=?, must_change_password=0, auth_version=auth_version+1')) {
        if (Number(params[1]) !== 42) return [{ affectedRows: 0 }, undefined];
        state.passwordHash = params[0];
        state.mustChangePassword = 0;
        state.authVersion += 1;
        return [{ affectedRows: 1 }, undefined];
      }
      if (normalized.startsWith('INSERT INTO identity_access_events')) {
        state.events.push({ params });
        return [{ insertId: state.events.length, affectedRows: 1 }, undefined];
      }
      if (normalized === 'SELECT * FROM departments ORDER BY code') {
        return [[{ id: 9, code: 'ENG', name: '工程技术部', status: 'active' }], undefined];
      }
      if (normalized === 'SELECT * FROM departments WHERE id=?') {
        return [Number(params[0]) === 9
          ? [{ id: 9, code: 'ENG', name: '工程技术部', status: 'active' }]
          : [], undefined];
      }
      if (normalized === 'SELECT * FROM departments WHERE name=?') {
        return [params[0] === '工程技术部'
          ? [{ id: 9, code: 'ENG', name: '工程技术部', status: 'active' }]
          : [], undefined];
      }

      throw new Error(`Unhandled SQL in fixed identity fake pool: ${normalized}`);
    }
  };
}

async function expectLegacyWriteRetired(action) {
  await assert.rejects(action, error => {
    assert.strictEqual(error.statusCode, 410);
    assert.strictEqual(error.code, 'LEGACY_IDENTITY_API_RETIRED');
    return true;
  });
}

async function main() {
  const pool = makeFakePool();
  const repo = makeIdentityMysqlRepository(pool);

  const loginUser = await repo.getUserByEmployeeNo('ADMIN001');
  assert.strictEqual(loginUser.personId, 42);
  assert.strictEqual(loginUser.accountId, 142);
  assert.strictEqual(loginUser.accountStatus, 'active');
  assert.ok(verifyPassword(OLD_PASSWORD, loginUser.password_hash));
  assert.strictEqual(await repo.getUserByEmployeeNo('missing'), null);

  const payload = await repo.getCurrentUserPayload({
    personId: 42,
    accountId: 142,
    authVersion: 7
  });
  assert.strictEqual(payload.id, 42);
  assert.strictEqual(payload.role, 'department_contact');
  assert.deepStrictEqual(payload.roleCodes, ['department_contact', 'department_mdm_reviewer']);
  assert.ok(payload.permissions.includes('governance:draft-department'));
  assert.ok(payload.permissions.includes('governance:record-department-decision'));
  assert.deepStrictEqual(payload.dataScopes.sort(), ['department:9', 'person:42'].sort());
  assert.strictEqual(payload.governanceModelVersion, ACCESS_MODEL_VERSION);
  assert.strictEqual(payload.positions[0].positionName, '流程治理专员');

  const effective = await repo.getUserEffectivePermissions(42);
  assert.deepStrictEqual(effective.fieldConstraints['governance:draft-department'], {
    readonly: ['source_file']
  });
  assert.strictEqual(effective.permSet.has('admin:access'), false);

  assert.deepStrictEqual(
    await repo.validateSession({ personId: 42, accountId: 142, authVersion: 7 }),
    { valid: true, user: loginUser }
  );
  assert.deepStrictEqual(
    await repo.validateSession({ personId: 42, accountId: 142, authVersion: 6 }),
    { valid: false, reason: 'authorization_changed' }
  );
  assert.deepStrictEqual(
    await repo.validateSession({ personId: 42, accountId: 999, authVersion: 7 }),
    { valid: false, reason: 'account_changed' }
  );

  assert.deepStrictEqual(await repo.getPasswordStatus(42), { is_default_password: true });
  await repo.updateOwnPassword(42, hashPassword(NEW_PASSWORD));
  assert.ok(verifyPassword(NEW_PASSWORD, (await repo.getPasswordCredential(42)).password_hash));
  assert.deepStrictEqual(await repo.getPasswordStatus(42), { is_default_password: false });
  assert.strictEqual(pool.state.authVersion, 8);
  assert.strictEqual(pool.state.events.length, 1);

  assert.strictEqual((await repo.listDepartments())[0].name, '工程技术部');
  assert.strictEqual((await repo.getDepartmentById(9)).code, 'ENG');
  assert.strictEqual((await repo.getDepartmentByName('工程技术部')).id, 9);

  await expectLegacyWriteRetired(() => repo.createUser({}));
  await expectLegacyWriteRetired(() => repo.updateUser(42, {}));
  await expectLegacyWriteRetired(() => repo.resetUserPassword(42, 'hash', true));
  await expectLegacyWriteRetired(() => repo.replaceUserRoles(42, [1], 42));

  console.log('Fixed person/account/role MySQL identity repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
