// Definition-backed administrator reads: synthetic SQL only; no runtime config or live DB.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.MDM_SYSTEM_ADMIN_ENABLED = '1';
// Schema fingerprint parsing has its own checks; this test exercises current identity/authority.
// Some supported repository baselines have no separate inspection wrapper.
const readinessFile = require('node:path').join(__dirname, '../server/analysisDependencyReadiness.js');
if (require('node:fs').existsSync(readinessFile)) {
  require(readinessFile).inspectionScope = (_db, action) => action();
}
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const session = { identityKind: 'system_admin', userId: 'system-admin:1', accountId: 1, authVersion: 3 };
function fixture({ status = 'active', version = 3, passwordChange = false, globalRead = true } = {}) {
  const queries = [];
  const db = {
    async execute(sql, params = []) {
      queries.push({ sql, params });
      assert(!/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(sql.replace(/FOR UPDATE/g, '')), 'administrator read must not write');
      assert(!/\b(?:user_accounts|person_roles|FROM person\b)/i.test(sql), 'a system account must not become a person');
      if (sql.startsWith('SET time_zone')) return [[]];
      if (sql.includes('FROM schema_migrations')) return [params.map(migration_key => ({ migration_key }))];
      if (sql.includes('FROM system_admin_accounts')) return [[{ account_id: '1', account_status: status, auth_version: String(version), must_change_password: passwordChange ? 1 : 0 }]];
      if (sql.includes('FROM roles')) return [[{ role_id: 1, role_name: 'Admin' }]];
      if (sql.includes('FROM role_permissions')) return [globalRead ? [{ perm_code: 'governance:read-global', effect: 'allow' }] : []];
      if (sql.includes('FROM data_map_design_handoffs')) return [[]];
      assert.fail('unexpected synthetic query: ' + sql);
    },
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}
  };
  return { repo: makeDataMapDefinitionRepository({ async getConnection() { return db; } }), queries };
}
test('standalone admin can read handoff capabilities/list with current global read permission', async () => {
  const { repo, queries } = fixture();
  assert.deepEqual(await repo.handoffCapabilities(session), { person_id: null, department_id: null, can_write: false });
  assert.deepEqual((await repo.listDesignHandoffs(session)).items, []);
  assert(queries.some(q => q.sql.includes('system_admin_accounts') && q.sql.includes('FOR SHARE')), 'current account must be locked and checked');
});
test('standalone admin writes remain denied even with valid global read authority', async () => {
  const { repo } = fixture();
  await assert.rejects(repo.saveDesignHandoff(session, { request_id: 'synthetic', handoff_id: null, expected_revision: 0, definition: {} }),
    e => e.statusCode === 403 && e.code === 'DEFINITION_ACCESS_DENIED');
});
test('revoked, changed and password-gated system accounts cannot read governance', async () => {
  for (const options of [{ status: 'inactive' }, { version: 4 }, { passwordChange: true }]) {
    await assert.rejects(fixture(options).repo.handoffCapabilities(session), e => e.statusCode === 401 && e.code === 'DEFINITION_AUTH_REQUIRED');
  }
});
test('system kind alone grants no global read permission or substitute person identity', async () => {
  await assert.rejects(fixture({ globalRead: false }).repo.handoffCapabilities(session), e => e.statusCode === 403 && e.code === 'DEFINITION_ACCESS_DENIED');
  await assert.rejects(fixture().repo.handoffCapabilities({ ...session, accountId: null }), e => e.statusCode === 401);
  await assert.rejects(fixture().repo.handoffCapabilities({ ...session, personId: 42 }), e => e.statusCode === 401);
});
