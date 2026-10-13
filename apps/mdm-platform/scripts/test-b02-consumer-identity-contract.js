// Pure consumer contracts; run with blockRealMysql and --test. No sockets/state.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readPersonAuthority, readPersonQualification } = require('../server/identityMysqlRepository');
const { validateAndProjectV7 } = require('../server/processV7PreviewReview');
const P = '9007199254740993', A = '9007199254740995', V = '9007199254740997';
function fixture() {
  const queries = [];
  const db = { async execute(sql, params) {
    queries.push({ sql, params });
    if (/FROM person p\s+LEFT JOIN user_accounts/.test(sql)) {
      assert.equal(typeof params[0], 'string');
      const large = params[0] === P;
      return [[{ person_id: params[0], account_id: large ? A : '142', auth_version: large ? V : '1', account_status: 'active', status: 'active', must_change_password: 0, current_department_id: '91' }]];
    }
    if (/SELECT pr.role_id/.test(sql)) { assert.equal(typeof params[0], 'string'); return [[{ role_id: 2 }]]; }
    if (/SELECT parent_role_id/.test(sql)) return [[{ parent_role_id: null }]];
    if (/FROM role_permissions rp/.test(sql)) return [[{ perm_code: 'governance:read-global', effect: 'allow' }]];
    if (/FROM person_roles pr/.test(sql)) { assert.equal(typeof params[0], 'string'); return [[{ code: 'mdm_lead' }]]; }
    throw new Error('UNEXPECTED_QUERY');
  } };
  return { db, queries };
}
test('candidate qualification reads safe then BIGINT then safe without a session or locks', async () => {
  const { db, queries } = fixture();
  for (const person of [42, P, 42]) {
    const value = await readPersonQualification(db, person); assert(value.valid); assert.equal(value.user.personId, person);
    assert(value.permissions.has('governance:read-global')); assert(!value.readOnly);
  }
  assert(queries.every(q => !/FOR SHARE|FOR UPDATE|INSERT|UPDATE|DELETE/i.test(q.sql)));
});
test('actual subject still requires its own exact account and generation and holds current reads', async () => {
  const { db, queries } = fixture();
  assert((await readPersonAuthority(db, { personId: 42, accountId: 142, authVersion: 1 }, 42, { currentRead: true })).valid);
  assert((await readPersonAuthority(db, { personId: P, accountId: A, authVersion: V }, P, { currentRead: true })).valid);
  assert(!(await readPersonAuthority(db, { personId: P, accountId: A, authVersion: '9007199254740996' }, P, { currentRead: true })).valid);
  assert(queries.every(q => /FOR SHARE\s*$/.test(q.sql)));
});
test('candidate invalid typed or rounded identity never queries personnel', async () => {
  const { db, queries } = fixture();
  for (const person of ['system-admin:1', Number(P), '9223372036854775808', null]) assert(!(await readPersonQualification(db, person)).valid);
  assert.equal(queries.length, 0);
});
test('candidate rejects invalid account generations as the historic session validation did', async () => {
  for (const column of ['account_id', 'auth_version']) {
    const { db } = fixture();
    const invalid = { async execute(sql, params) { const result = await db.execute(sql, params); if (/FROM person p\s+LEFT JOIN user_accounts/.test(sql)) result[0][0][column] = '0'; return result; } };
    assert(!(await readPersonQualification(invalid, 42)).valid);
  }
});
for (const format of ['v8', 'v7']) test(format + ' exact departments preserve old review digest and ordinary numeric API types', () => {
  const document = JSON.parse(fs.readFileSync(path.join(__dirname, 'testHelpers/p25-empty-' + format + '.json')));
  document.process.owning_department = 'Alpha';
  document.behaviors = [{ behavior_ref: 'behavior_b02', node_type: 'action', behavior_name: 'B02', behavior_description: '', current_actor_role: 'Beta reviewer', actor_assignment_mode: 'fixed_department', actor_department_data_ref: null, actor_position_rule: '', trigger: '', precondition: '', input_description: '', timing: null, completion_standard: '', output_description: '', countersign_all_required: false, countersign_target_departments: [] }];
  const departments = [{ id: 91, code: 'A', name: 'Alpha' }, { id: 92, code: 'B', name: 'Beta' }];
  const ordinary = validateAndProjectV7(document, departments);
  const exact = validateAndProjectV7(document, [{ ...departments[0], id: '9007199254740992' }, { ...departments[1], id: P }]);
  assert.deepEqual(ordinary.errors, []); assert.deepEqual(exact.errors, []); assert.equal(exact.items.length, 1);
  assert.equal(ordinary.items[0].origin_department_id, 91); assert.equal(typeof ordinary.items[0].target_department_id, 'number');
  assert.equal(exact.items[0].target_department_id, P); assert.equal(exact.items[0].item_digest, ordinary.items[0].item_digest);
  assert.equal(exact.contentHash, ordinary.contentHash); assert.equal(exact.items[0].stable_item_key, ordinary.items[0].stable_item_key);
});
