// Extension of the owned P17 repository fixture. No browser, worker or new DB.
// --b02-baseline <archived input analysisIssueClosure.js> compares retained
// appointments/digests against the pre-dispatch consumer on the same synthetic DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { makeDataMapDefinitionRepository } = require('../../server/dataMapDefinitionRepository');
const { digest } = require('../../server/dataMapDefinitionValues');
const P = '9007199254740993', A = '9007199254740995', V = '9007199254740997';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async ctx => {
  const { pool, repo, contact, lead, issueId, test, save, state, bind } = ctx;
  const arg = process.argv.indexOf('--b02-baseline');
  assert(arg >= 0, 'archived pre-dispatch closure consumer required');
  const baseline = path.resolve(process.argv[arg + 1]);
  assert(baseline.startsWith(path.resolve(__dirname, '../../../../artifacts') + path.sep));
  const filename = require.resolve('../../server/analysisIssueClosure');
  const historicalModule = new Module(filename, module);
  historicalModule.paths = Module._nodeModulePaths(path.dirname(filename));
  historicalModule._compile(fs.readFileSync(baseline, 'utf8'), filename);
  const cached = require.cache[filename], current = cached.exports;
  let oldRepo;
  try { cached.exports = historicalModule.exports; oldRepo = makeDataMapDefinitionRepository(pool); } finally { cached.exports = current; }
  const oldState = () => oldRepo.getAnalysisIssueClosure(contact, issueId);
  async function equalHistory() { const value = await state(); assert.deepEqual(await oldState(), value); return value; }
  await test('B02 pre-dispatch candidate digest and complete historical snapshots remain identical', equalHistory);
  await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (CAST(? AS SIGNED),?,?,91)', [P, 'B02_CANDIDATE', 'B02 synthetic candidate']);
  await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (CAST(? AS SIGNED),CAST(? AS SIGNED),'B02_CANDIDATE','synthetic-not-used','active',0,CAST(? AS SIGNED))", [A, P, V]);
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT CAST(? AS SIGNED),role_id,'global','B02 synthetic candidate',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'", [P]);
  const appoint = s => ({ ...bind(s), action: 'designate', reviewer_person_id: P, conditions: ['B02 synthetic condition'], reason: 'B02 synthetic appointment' });
  await test('B02 exact BIGINT candidate and old authorization digest preserve every grant field', async () => {
    const q = await require('../../server/identityMysqlRepository').readPersonQualification(pool, P);
    save('b02-candidate-qualification.json', { valid: q.valid, user: q.user && { personId: q.user.personId, accountId: q.user.accountId, departmentId: q.user.current_department_id, authVersion: q.user.authVersion }, roles: q.roles, permissions: q.permissions && [...q.permissions],
      storedPerson: (await pool.execute("SELECT CAST(person_id AS CHAR) person_id,CAST(current_department_id AS CHAR) department_id FROM person WHERE employee_no='B02_CANDIDATE'"))[0],
      storedAccount: (await pool.execute("SELECT CAST(person_id AS CHAR) person_id,CAST(account_id AS CHAR) account_id,CAST(auth_version AS CHAR) auth_version FROM user_accounts WHERE login_name='B02_CANDIDATE'"))[0] });
    let s = await equalHistory(); assert(s.candidates.some(c => c.person_id === P));
    await repo.reviewAnalysisIssueTask(contact, issueId, appoint(s)); s = await equalHistory();
    assert.equal(s.assignment.reviewer.person_id, P);
    const [grants] = await pool.execute('SELECT CAST(person_role_id AS CHAR) person_role_id,CAST(role_id AS CHAR) role_id,scope_type,CAST(scope_department_id AS CHAR) scope_department_id,assignment_status,CAST(effective_from AS CHAR) effective_from,CAST(effective_to AS CHAR) effective_to,CAST(revoked_at AS CHAR) revoked_at FROM person_roles WHERE person_id=CAST(? AS SIGNED) ORDER BY person_role_id', [P]);
    const permissions = await require('../../server/identityMysqlRepository').makeIdentityMysqlRepository(pool).getUserEffectivePermissions(P);
    const expected = digest({ account: { account_id: A, auth_version: V }, department: '91', grants, permissions: [...permissions.permSet].sort() });
    assert.equal(s.assignment.reviewer.authorization_digest, expected);
    save('b02-candidate-digest.json', { personId: P, accountId: A, authVersion: V, expected, actual: s.assignment.reviewer.authorization_digest, historicalConsumerEqual: true, allGrantFieldsPreserved: true });
  });
  await test('B02 reading a candidate does not acquire its account/person business write locks', async () => {
    const blocker = await pool.getConnection();
    let pending;
    try {
      await blocker.beginTransaction();
      await blocker.execute('SELECT account_id FROM user_accounts WHERE account_id=CAST(? AS SIGNED) FOR UPDATE', [A]);
      await blocker.execute('SELECT person_id FROM person WHERE person_id=CAST(? AS SIGNED) FOR UPDATE', [P]);
      pending = state();
      const value = await Promise.race([pending, sleep(2000).then(() => { throw new Error('B02_CANDIDATE_ACQUIRED_BUSINESS_LOCK'); })]);
      assert(value.candidates.some(c => c.person_id === P));
      assert.equal(value.assignment.reviewer.person_id, P);
      save('b02-candidate-no-write-lock.json', { blockedCandidateAccount: A, blockedCandidatePerson: P, ownerReadCompletedBeforeRelease: true });
    } finally { await blocker.rollback(); blocker.release(); if (pending) await pending; }
  });
  await test('B02 disabled/password/admin/revoked/source-scope candidates are excluded; appointment never automatically restores', async () => {
    const mutations = [
      ["UPDATE user_accounts SET account_status='disabled' WHERE account_id=CAST(? AS SIGNED)", "UPDATE user_accounts SET account_status='active' WHERE account_id=CAST(? AS SIGNED)", A],
      ['UPDATE user_accounts SET must_change_password=1 WHERE account_id=CAST(? AS SIGNED)', 'UPDATE user_accounts SET must_change_password=0 WHERE account_id=CAST(? AS SIGNED)', A],
      ["UPDATE person_roles SET assignment_status='revoked' WHERE person_id=CAST(? AS SIGNED)", "UPDATE person_roles SET assignment_status='active' WHERE person_id=CAST(? AS SIGNED)", P]
    ];
    for (const [change, restore, value] of mutations) {
      await pool.execute(change, [value]);
      try { const s = await equalHistory(); assert(s.suspended); assert(!s.candidates.some(c => c.person_id === P)); } finally { await pool.execute(restore, [value]); }
      let s = await equalHistory(); assert(s.suspended); await repo.reviewAnalysisIssueTask(contact, issueId, appoint(s));
    }
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT CAST(? AS SIGNED),role_id,'global','B02 synthetic overlay',CURRENT_DATE FROM roles WHERE role_code='admin'", [P]);
    try { const s = await equalHistory(); assert(s.suspended); assert(!s.candidates.some(c => c.person_id === P)); } finally { await pool.execute("DELETE pr FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id WHERE pr.person_id=CAST(? AS SIGNED) AND r.role_code='admin'", [P]); }
    let s = await equalHistory(); assert(s.suspended); await repo.reviewAnalysisIssueTask(contact, issueId, appoint(s));
    await pool.execute("UPDATE role_permissions rp JOIN roles r ON r.role_id=rp.role_id JOIN permissions p ON p.perm_id=rp.perm_id SET rp.effect='deny' WHERE r.role_code='mdm_lead' AND p.perm_code='governance:read-global'");
    await pool.execute('UPDATE person SET current_department_id=92 WHERE person_id=CAST(? AS SIGNED)', [P]);
    try { s = await equalHistory(); assert(s.suspended); assert(!s.candidates.some(c => c.person_id === P)); } finally {
      await pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=CAST(? AS SIGNED)', [P]);
      await pool.execute("UPDATE role_permissions rp JOIN roles r ON r.role_id=rp.role_id JOIN permissions p ON p.perm_id=rp.perm_id SET rp.effect='allow' WHERE r.role_code='mdm_lead' AND p.perm_code='governance:read-global'");
    }
    s = await equalHistory(); assert(s.suspended); await repo.reviewAnalysisIssueTask(contact, issueId, appoint(s));
  });
  await test('B02 authorization generation and department changes suspend historical appointments without digest rewrites', async () => {
    const before = await state();
    await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=CAST(? AS SIGNED)', [A]);
    let s = await equalHistory(); assert(s.suspended); assert.deepEqual(s.events.slice(0, before.events.length), before.events);
    await pool.execute('UPDATE user_accounts SET auth_version=CAST(? AS SIGNED) WHERE account_id=CAST(? AS SIGNED)', [V, A]);
    s = await equalHistory(); assert(s.suspended); await repo.reviewAnalysisIssueTask(contact, issueId, appoint(s));
    await pool.execute('UPDATE person SET current_department_id=92 WHERE person_id=CAST(? AS SIGNED)', [P]);
    s = await equalHistory(); assert(s.suspended); assert(s.candidates.some(c => c.person_id === P), 'global eligible candidate remains eligible but old appointment digest changes');
    await pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=CAST(? AS SIGNED)', [P]);
    s = await equalHistory(); assert(s.suspended); await repo.reviewAnalysisIssueTask(contact, issueId, appoint(s));
  });
  await test('B02 actual reviewer retains original transaction account/person/role locks and fails after real password wait', async () => {
    const s = await state();
    await repo.reviewAnalysisIssueTask(contact, issueId, { ...appoint(s), reviewer_person_id: String(lead.personId) });
    const currentState = await state();
    const payload = { ...bind(currentState), action: 'review', reason: 'B02 synthetic rejection', checks: currentState.assignment.conditions.map(c => ({ condition_id: c.condition_id, satisfied: false, basis: 'B02 synthetic basis' })) };
    const blocker = await pool.getConnection(); let pending; const trace = [];
    const observedPool = new Proxy(pool, { get(target, key) {
      if (key === 'getConnection') return async () => {
        const db = await pool.getConnection(); return new Proxy(db, { get(target, key) {
          if (key === 'execute') return async (sql, params) => { const item = { sql, connectionId: db.connection.threadId, finished: false }; trace.push(item); try { return await db.execute(sql, params); } finally { item.finished = true; } };
          const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
        } });
      };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    try {
      await blocker.beginTransaction(); await blocker.execute('SELECT account_id FROM user_accounts WHERE account_id=? FOR UPDATE', [lead.accountId]);
      pending = makeDataMapDefinitionRepository(observedPool).reviewAnalysisIssueTask(lead, issueId, payload).then(value => ({ value }), error => ({ error }));
      let observed;
      for (let i = 0; i < 200; i++) {
        const waiting = trace.find(t => !t.finished && /FROM user_accounts.*FOR UPDATE/.test(t.sql));
        if (waiting) { const [locks] = await pool.execute('SELECT l.OBJECT_NAME object_name,t.PROCESSLIST_ID connection_id FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID WHERE t.PROCESSLIST_ID=?', [waiting.connectionId]); if (locks.length) { observed = locks; break; } }
        await sleep(25);
      }
      assert(observed); save('b02-reviewer-lock-wait.json', { locks: observed, originalAccountUpdateLock: true });
      await blocker.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=?', [lead.accountId]); await blocker.commit();
      assert.equal((await pending).error?.code, 'DEFINITION_AUTH_REQUIRED');
      await pool.execute('UPDATE user_accounts SET auth_version=? WHERE account_id=?', [lead.authVersion, lead.accountId]);
      assert.deepEqual(await state(), currentState);
    } finally { await blocker.rollback(); blocker.release(); if (pending) await pending; await pool.execute('UPDATE user_accounts SET auth_version=? WHERE account_id=?', [lead.authVersion, lead.accountId]); }
  });
  save('b02-closure-final.json', { passed: true, history: await equalHistory(), baseline, candidateActorSeparated: true, businessAcceptance: false });
};
