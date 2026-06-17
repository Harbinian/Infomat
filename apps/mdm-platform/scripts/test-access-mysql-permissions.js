const assert = require('assert');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

async function main() {
  const auth = require('../server/auth');
  const access = require('../server/access');

  assert.strictEqual(typeof access.isAdminAsync, 'function', 'access should expose async admin check');
  assert.strictEqual(typeof access.hasGlobalViewAsync, 'function', 'access should expose async global view check');
  assert.strictEqual(typeof access.isReviewerOrAdminAsync, 'function', 'access should expose async reviewer/admin check');
  assert.strictEqual(typeof access.canUseTodoAsync, 'function', 'access should expose async todo guard');

  let permissions = new Set(['admin:access']);
  let permissionReads = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      permissionReads += 1;
      assert.strictEqual(userId, 42);
      return { permSet: new Set(permissions), fieldConstraints: {} };
    }
  }));

  const req = { session: { userId: 42, departmentId: 7 } };

  try {
    assert.strictEqual(await access.isAdminAsync(req), true);

    permissions = new Set(['data:view_all']);
    assert.strictEqual(await access.isAdminAsync(req), false);
    assert.strictEqual(await access.hasGlobalViewAsync(req), true);

    permissions = new Set(['review:approve']);
    assert.strictEqual(await access.isReviewerOrAdminAsync(req), true);

    permissions = new Set([]);
    assert.strictEqual(await access.isReviewerOrAdminAsync(req), false);
    assert.strictEqual(await access.canUseTodoAsync(req, { to_dept_id: 7 }), true);
    assert.strictEqual(await access.canUseTodoAsync(req, { to_dept_id: 8 }), false);

    permissions = new Set(['*:*']);
    assert.strictEqual(await access.canUseTodoAsync(req, { to_dept_id: 8 }), true);

    assert.strictEqual(await access.isAdminAsync({}), false);
    assert.ok(permissionReads >= 6);

    console.log('Access MySQL permission helpers test passed');
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
