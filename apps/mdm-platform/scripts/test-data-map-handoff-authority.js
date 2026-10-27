// Pure authority rules. No database, server, configuration file or external IO.
const assert = require('node:assert/strict');
const { scopedPermission, handoffActor, assertApprover, SUPPORTED_ACCESS_MODELS } = require('../server/dataMapHandoffAuthority');
const allow = (scope_type, scope_department_id) => ({ perm_code: 'p', effect: 'allow', scope_type, scope_department_id });
async function main() {
  assert.equal(SUPPORTED_ACCESS_MODELS.length, 2);
  assert(scopedPermission([allow('global', null)], 'p'));
  assert(!scopedPermission([allow('department', '91')], 'p'));
  assert(scopedPermission([allow('department', '9007199254740993')], 'p', '9007199254740993'));
  assert(!scopedPermission([allow('department', '9007199254740993')], 'p', '9007199254740992'));
  assert(!scopedPermission([allow('global', null), { ...allow('global', null), effect: 'deny' }], 'p'));
  const noIo = { execute() { throw Error('Unexpected authority IO'); } };
  await assert.rejects(handoffActor(noIo, { identityKind: 'system_admin' }, 'publish'), { code: 'HANDOFF_ADMIN_READ_ONLY' });
  await assert.rejects(handoffActor(noIo, { personId: '9007199254740993', accountId: '2', authVersion: '1' }, 'prepare', { lock: false }), { code: 'HANDOFF_READ_ONLY' });
  await assert.rejects(handoffActor(noIo, {}, 'prepare'), { code: 'HANDOFF_ACCESS_CHANGED' });
  await assert.rejects(handoffActor(noIo, {}, 'made_up'), { code: 'HANDOFF_ACTION_INVALID' });
  await assert.rejects(assertApprover(noIo, {}), { code: 'HANDOFF_APPROVER_CHANGED' });
  console.log('PASS HANDOFF_AUTHORITY_PURE: scoped allow, deny precedence, exact IDs and fail-closed identity/action/read-only contracts');
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
