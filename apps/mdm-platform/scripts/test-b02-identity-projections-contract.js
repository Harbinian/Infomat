// Focused read contracts: run with blockRealMysql preload and --test. Synthetic
// executors only; no private config, sockets, HTTP, DB, workers or notifications.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const { identityInteger } = require('../server/sessionSubject');
const P = '9007199254740993', D = '9007199254741001', A = '9007199254740995', V = '9007199254740997';

function fixture() {
  const queries = [];
  const departments = [
    { id: '9', name: 'Safe', code: 'A', parent_id: null, manager_user_id: null, data_owner_user_id: null,
      final_responsible_person_id: '42', data_owner_person_id: null, created_by: '0', updated_by: null, unknown_extra: { retained: true }, exact_id: 'physical-original' },
    { id: D, name: 'Large', code: 'B', parent_id: '9007199254741000', final_responsible_person_id: P, data_owner_person_id: P,
      manager_user_id: A, data_owner_user_id: A, created_by: P, updated_by: P, unknown_extra: 'retained', exact_id: 'physical-original' }
  ];
  const person = id => ({ id, person_id: id, name: 'Synthetic', employee_no: String(id), department_id: id === '42' ? '9' : D,
    account_id: id === '42' ? '142' : A, auth_version: id === '42' ? '1' : V, account_status: 'active', status: 'active', post: null });
  const db = { async execute(sql, params = []) {
    queries.push({ sql, params });
    if (/FROM departments/.test(sql) && !/JOIN departments/.test(sql)) {
      if (params[0] === undefined && /WHERE id=/.test(sql)) throw new TypeError('Bind parameters must not contain undefined');
      const found = /WHERE id=/.test(sql) ? departments.filter(row => row.id === params[0]) : /WHERE name=/.test(sql) ? departments.filter(row => row.name === params[0]) : departments;
      return [found.map(row => ({ ...row }))];
    }
    if (/FROM person_position_assignment/.test(sql)) return [[{ position_id: P, position_code: 'POS', position_name: 'Display',
      department_admin_level: null, department_admin_title: null, responsibility_scope: null }]];
    if (/GROUP_CONCAT/.test(sql)) return [[{ ...person(P), rbac_role_codes: 'a,b', rbac_role_names: 'A,B' }]];
    if (/SELECT pr.role_id/.test(sql)) return [[]];
    if (/FROM person_roles pr/.test(sql)) return [[]];
    if (/FROM person p/.test(sql)) {
      if (/WHERE p.person_id=/.test(sql)) return [[{ ...person(params[0]), current_department_id: params[0] === '42' ? '9' : D }]];
      return [[person('42'), person(P), { ...person('43'), department_id: null, account_id: null, auth_version: null, account_status: null }]];
    }
    throw Error('UNEXPECTED_SYNTHETIC_QUERY');
  } };
  return { db, queries, departments, repo: makeIdentityMysqlRepository(db) };
}

test('departments preserve all fields, safe number types, nulls and adjacent exact identities', async () => {
  const { repo, departments } = fixture();
  const found = await repo.listDepartments();
  assert.deepEqual(Object.keys(found[0]), Object.keys(departments[0]));
  assert.equal(found[0].id, 9); assert.equal(found[0].final_responsible_person_id, 42); assert.equal(found[0].created_by, 0);
  assert.equal(found[0].parent_id, null); assert.deepEqual(found[0].unknown_extra, { retained: true });
  assert.equal(found[1].id, D); assert.equal(found[1].parent_id, '9007199254741000'); assert.equal(found[1].final_responsible_person_id, P);
  assert.equal(found[1].manager_user_id, A); assert.equal(found[1].data_owner_user_id, A); assert.equal(found[1].exact_id, 'physical-original');
  assert.deepEqual(await repo.getDepartmentByName('Large'), found[1]);
  assert.deepEqual(await repo.getDepartmentById(D), found[1]);
  assert.deepEqual(await repo.getDepartmentById(9), found[0]);
});

test('ID binds stay decimal across small/large reuse; invalid values never match a neighbour, driver errors propagate', async () => {
  const { repo, queries } = fixture();
  for (const id of [9, D, '9', '9007199254741000', 9]) await repo.getDepartmentById(id);
  for (const value of [Number(D), null, {}, '9oops', 'system-admin:9', '9223372036854775808', 1.2]) assert.equal(await repo.getDepartmentById(value), null);
  await assert.rejects(repo.getDepartmentById(undefined), TypeError);
  const valid = queries.filter(q => q.params[0] && q.params[0] !== undefined);
  assert(valid.every(q => typeof q.params[0] === 'string'));
  assert(valid.every(q => /id=CAST\(\? AS SIGNED\)/.test(q.sql)));
  const error = Object.assign(Error('denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
  const broken = makeIdentityMysqlRepository({ async execute() { throw error; } });
  await assert.rejects(broken.listDepartments(), e => e === error);
  await assert.rejects(broken.getDepartmentById(9), e => e === error);
});

test('user lists retain raw and compatibility keys, exact account generation, safe numbers and absent account semantics', async () => {
  const { repo } = fixture(); const people = await repo.listUsers();
  assert.equal(people[0].id, 42); assert.equal(people[0].personId, 42); assert.equal(people[0].account_id, 142); assert.equal(people[0].auth_version, 1);
  assert.equal(people[1].id, P); assert.equal(people[1].personId, P); assert.equal(people[1].person_id, P);
  assert.equal(people[1].accountId, A); assert.equal(people[1].account_id, A); assert.equal(people[1].authVersion, V); assert.equal(people[1].auth_version, V);
  assert.equal(people[1].department_id, D); assert.equal(people[1].current_department_id, D);
  assert.equal(people[2].accountId, null); assert.equal(people[2].account_id, null); assert.equal(people[2].authVersion, 0);
  assert.equal(people[2].auth_version, null); assert.equal(people[2].department_id, null);
  const [summary] = await repo.listUserRoleSummaries();
  assert.deepEqual(summary, { id: P, personId: P, name: 'Synthetic', employee_no: P, department_id: D,
    dept_name: null, post: null, role: null, account_status: 'active', created_at: undefined, rbac_role_codes: 'a,b', rbac_role_names: 'A,B' });
});

test('assignable variants retain exact IDs and the original role/model/date/basis/account filters', async () => {
  const { repo, queries } = fixture();
  for (const filters of [{}, { roleCode: ' data_conflict_handler ' }]) {
    const users = await repo.listAssignableUsers(filters); assert.equal(users[0].id, 42); assert.equal(users[1].id, P); assert.equal(users[1].department_id, D);
  }
  const [plain, role] = queries.slice(-2);
  assert.deepEqual(plain.params, []); assert(!/JOIN user_accounts/.test(plain.sql));
  assert.equal(role.params[0], 'data_conflict_handler');
  for (const clause of ["pr.assignment_status='active'", 'pr.authorization_basis IS NOT NULL', 'pr.effective_from<=CURRENT_DATE',
    'pr.effective_to>=CURRENT_DATE', "r.status='active'", 'r.model_version=?', "ua.account_status='active'", "p.status='active'"]) assert(role.sql.includes(clause));
});

test('optional positions bind exact person IDs and remain display-only with local unavailable diagnostics', async () => {
  const { db, repo, queries } = fixture();
  const payload = await repo.getCurrentUserPayload({ personId: P });
  assert.equal(payload.positions[0].positionId, P); assert.deepEqual(payload.permissions, []);
  const position = queries.find(q => /FROM person_position_assignment/.test(q.sql));
  assert.deepEqual(position.params, [P]); assert.match(position.sql, /person_id=CAST\(\? AS SIGNED\)/);
  for (const code of ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR']) {
    const partial = await makeIdentityMysqlRepository({ execute(sql, params) {
      if (/FROM person_position_assignment/.test(sql)) throw Object.assign(Error(code), { code });
      return db.execute(sql, params);
    } }).getCurrentUserPayload({ personId: P });
    assert.deepEqual(partial.positions, []); assert.equal(partial.positionInfo.code, 'POSITION_INFO_UNAVAILABLE');
    assert.deepEqual(partial.permissions, payload.permissions); assert.deepEqual(partial.roleAssignments, payload.roleAssignments);
  }
  for (const marker of ['FROM person p', 'FROM person_roles pr', 'FROM person_position_assignment']) {
    const code = marker === 'FROM person_position_assignment' ? 'PROTOCOL_CONNECTION_LOST' : 'ER_TABLEACCESS_DENIED_ERROR';
    await assert.rejects(makeIdentityMysqlRepository({ execute(sql, params) {
      if (sql.includes(marker)) throw Object.assign(Error(code), { code });
      return db.execute(sql, params);
    } }).getCurrentUserPayload({ personId: P }), { code });
  }
  assert.equal(identityInteger(Number(P)), null);
});
