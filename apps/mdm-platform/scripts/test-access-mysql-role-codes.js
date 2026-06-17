const assert = require('assert');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

async function main() {
  const auth = require('../server/auth');
  const access = require('../server/access');

  assert.strictEqual(
    typeof access.getEffectiveRoleCodesAsync,
    'function',
    'access should expose a MySQL-aware async role code reader'
  );

  let roleCodeReads = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserRoleCodes(userId, legacyRole) {
      roleCodeReads += 1;
      assert.strictEqual(userId, 42);
      assert.strictEqual(legacyRole, 'submitter');
      return [
        { code: 'owner', name: '业务负责人' },
        { role_code: 'reviewer', role_name: '审核员' },
        { code: 'submitter', name: '提交人' }
      ];
    }
  }));

  try {
    const codes = await access.getEffectiveRoleCodesAsync({
      session: {
        userId: 42,
        userRole: 'submitter'
      }
    });

    assert.deepStrictEqual(Array.from(codes).sort(), ['owner', 'reviewer', 'submitter']);
    assert.strictEqual(roleCodeReads, 1);

    const anonymousCodes = await access.getEffectiveRoleCodesAsync({});
    assert.deepStrictEqual(Array.from(anonymousCodes), []);

    console.log('Access MySQL role code reader test passed');
  } finally {
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousReadModel;
  }
  cleanupDb({ ignoreErrors: true });
});
