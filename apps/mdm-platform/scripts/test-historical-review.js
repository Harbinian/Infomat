// Owned tmpfs MySQL only. Explicit source is read-only; reports go to a NEW artifacts directory.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const source = require('../server/historicalReviewSource'), store = require('../server/historicalReviewStore');
const { digest } = require('../server/dataMapDefinitionValues');
const args = process.argv.slice(2), at = flag => args[args.indexOf(flag) + 1];
assert(args.includes('--source') && args.includes('--output'));
const directory = path.resolve(at('--source')), output = path.resolve(at('--output'));
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
const checks = [];
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
const reject = (action, code) => assert.rejects(action, e => e.code === code);
async function main() {
  const plan = source.loadSnapshot(directory), originals = source.verifyOriginals(plan);
  save('dry-run.json', plan); save('originals-before.json', originals);
  await check('source IDs, raw opinions, evidence and unknown ownership retained', async () => {
    assert.equal(new Set(plan.items.map(i => i.platform_ref)).size, plan.items.length);
    for (const item of plan.items) { assert.equal(item.original.id, item.original_id); assert.equal(item.issue_id, null); assert.equal(item.owner_department_id, null); }
    assert.deepEqual(source.compareSnapshots(plan, plan).items.map(i => i.status), plan.items.map(() => 'unchanged'));
    const smaller = structuredClone(plan); smaller.items.pop();
    assert.equal(source.compareSnapshots(plan, smaller).items.at(-1).status, 'not_in_snapshot_not_resolved');
    assert.throws(() => source.compareSnapshots(plan, { ...smaller, source_base: 'unrelated' }), e => e.code === 'HISTORY_SNAPSHOT_LINEAGE_UNCONFIRMED');
    assert.deepEqual(source.pointer({ a: { 'b/c': null } }, '/a/b~1c'), { found: true, value: null });
    assert.equal(source.pointer({}, '/__proto__').found, false);
  });
  await check('source missing files, changed bytes, duplicate IDs and unresolved evidence', async () => {
    const fixture = path.join(output, 'source-fixture'); fs.mkdirSync(fixture);
    const write = (name, value) => fs.writeFileSync(path.join(fixture, name), JSON.stringify(value));
    const original = path.join(fixture, 'original.json'); fs.writeFileSync(original, '{}');
    const review = { generatedAt: 'synthetic', sourceBase: fixture, records: [{ id: 'F1', relative: 'original.json', file: original, sha256: source.hash(Buffer.from('{}')), doc: {} }], issues: [{ id: 'I1', kind: 'synthetic', files: ['F1'], refs: [{ file: 'F1', path: '/missing' }] }] };
    write('review-data.json', review); write('data-continuity.json', { generatedAt: 'synthetic', addedRecords: [], findings: [] });
    const result = source.loadSnapshot(fixture); assert(result.missing.length > 0); assert(result.items[0].gaps.some(g => g.reason === 'pointer_missing'));
    assert.equal(result.items[0].responsibility_suggestion, null);
    assert.equal(source.verifyOriginals(result)[0].status, 'matches'); fs.writeFileSync(original, '{"changed":true}');
    assert.equal(source.verifyOriginals(result)[0].status, 'changed'); fs.unlinkSync(original);
    assert.equal(source.verifyOriginals(result)[0].status, 'unavailable');
    review.issues.push(review.issues[0]); write('review-data.json', review);
    assert.throws(() => source.loadSnapshot(fixture), e => e.code === 'HISTORY_DUPLICATE_OR_INVALID_ID');
    fs.unlinkSync(path.join(fixture, 'review-data.json'));
    assert.throws(() => source.loadSnapshot(fixture), e => e.code === 'HISTORY_CORE_SNAPSHOT_MISSING');
  });
  await withFreshMysql(async ({ pool, backup, restore }) => {
    await require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool).initSchema();
    const connection = await pool.getConnection();
    try {
      await require('../server/dataMapDefinitionMigration').applyDefinitions(connection);
      await require('../server/v7MappingMigration').applyV7Mappings(connection);
      await require('../server/designHandoffMigration').applyDesignHandoffs(connection);
      await require('../server/analysisRunMigration').applyAnalysisRuns(connection);
      await require('../server/analysisIssueMigration').applyAnalysisIssues(connection);
    } finally { connection.release(); }
    const use = async action => { const db = await pool.getConnection(); try { return await action(db); } finally { db.release(); } };
    const protectedTables = ['process_governance_issues', 'process_governance_issue_events', 'mdm_todos', 'data_map_analysis_runs', 'data_map_analysis_findings'];
    await pool.execute("INSERT INTO departments(id,code,name,status) VALUES (91,'SYNTHETIC_HISTORY_91','合成历史部门','active')");
    for (const [person, role] of [[81, 'admin'], [82, 'mdm_lead'], [83, 'department_contact']]) {
      await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,91)", [person, 'SYNTHETIC_HISTORY_' + person, '合成人员' + person]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,?,?,'not-a-login-hash','active',0)", [person + 100, person, 'SYNTHETIC_HISTORY_' + person]);
      await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?, 'P22 synthetic',CURRENT_DATE FROM roles WHERE role_code=?", [person, role === 'department_contact' ? 'department' : 'global', role === 'department_contact' ? 91 : null, role]);
    }
    const repo = require('../server/dataMapDefinitionRepository').makeDataMapDefinitionRepository(pool);
    const lead = { personId: 82, accountId: 182, authVersion: 1 }, admin = { personId: 81, accountId: 181, authVersion: 1 }, contact = { personId: 83, accountId: 183, authVersion: 1 };
    await pool.execute(`INSERT INTO process_governance_issues(issue_key,primary_dept_name,source_type,title,what_text,why_text,where_text,who_text,when_text,how_text,how_much_text)
      VALUES ('p22-synthetic-existing','合成历史部门','synthetic','合成已有问题','','','','','','','')`);
    const issueId = String((await pool.execute("SELECT issue_id FROM process_governance_issues WHERE issue_key='p22-synthetic-existing'"))[0][0].issue_id);
    const snapshot = async () => Object.fromEntries(await Promise.all(protectedTables.map(async t => [t, digest((await pool.query('SELECT * FROM ' + t))[0])])));
    const protectedBefore = await snapshot();
    await check('missing migration refused, partial DDL resumed, repeated migration and drift rejected', async () => {
      assert.equal((await store.inspect(pool)).missing.length, 2);
      await reject(use(db => store.importSnapshot(db, plan)), 'HISTORY_MIGRATION_REQUIRED');
      await pool.execute(store.statements()[0]);
      assert.equal((await store.inspect(pool)).missing.length, 1);
      assert.equal((await use(store.migrate)).ready, true); assert.equal((await use(store.migrate)).ready, true);
      await pool.execute('ALTER TABLE data_map_history_opinions ADD COLUMN synthetic_drift INT');
      await reject(use(store.migrate), 'HISTORY_SCHEMA_DRIFT');
      await pool.execute('ALTER TABLE data_map_history_opinions DROP COLUMN synthetic_drift');
      await pool.execute('ALTER TABLE data_map_history_opinions MODIFY original_id VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL');
      await reject(use(store.migrate), 'HISTORY_SCHEMA_DRIFT');
      await pool.execute('ALTER TABLE data_map_history_opinions MODIFY original_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL');
    });
    await check('mid-import failure fully rolls back and retry imports exactly once', async () => {
      await pool.query("CREATE TRIGGER p22_fail BEFORE INSERT ON data_map_history_opinions FOR EACH ROW BEGIN IF NEW.ordinal_no=1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='P22_SYNTHETIC_FAILURE'; END IF; END");
      await assert.rejects(use(db => store.importSnapshot(db, plan)));
      for (const t of store.tables) assert.equal((await pool.query('SELECT COUNT(*) n FROM ' + t))[0][0].n, 0);
      await pool.query('DROP TRIGGER p22_fail');
      const first = await use(db => store.importSnapshot(db, plan)); assert.equal(first.duplicate, false); save('first-import.json', first);
      assert.deepEqual(await store.read(pool, plan.batch_key), plan);
    });
    await check('concurrent repeat is idempotent and same key changed content is refused', async () => {
      const receipts = await Promise.all([use(db => store.importSnapshot(db, plan)), use(db => store.importSnapshot(db, plan))]);
      assert(receipts.every(r => r.duplicate));
      const changed = structuredClone(plan); changed.items[0].original.title += ' synthetic change';
      await reject(use(db => store.importSnapshot(db, changed)), 'HISTORY_BATCH_CONTENT_CONFLICT');
      assert.equal((await pool.query('SELECT COUNT(*) n FROM data_map_history_opinions'))[0][0].n, plan.items.length);
      save('repeat-import.json', receipts);
    });
    await check('read authorizes current identities; department suggestion grants no access; exact issue comparison is read-only', async () => {
      assert.deepEqual(await repo.getHistoricalReview(lead, plan.batch_key), plan);
      assert.deepEqual(await repo.getHistoricalReview(admin, plan.batch_key), plan);
      await reject(repo.getHistoricalReview(contact, plan.batch_key), 'HISTORY_RESOURCE_UNAVAILABLE');
      await reject(repo.getHistoricalReview(null, plan.batch_key), 'DEFINITION_AUTH_REQUIRED');
      await reject(repo.getHistoricalReview({ ...lead, authVersion: 999 }, plan.batch_key), 'DEFINITION_AUTH_REQUIRED');
      const compared = await repo.compareHistoricalReviewIssue(lead, plan.batch_key, plan.items[0].original_id, issueId);
      assert.equal(compared.existing_issue.issue.issue_id, issueId); assert.equal(compared.formal_link_enabled, false); assert.equal(compared.historical.issue_id, null);
      await reject(repo.compareHistoricalReviewIssue(contact, plan.batch_key, plan.items[0].original_id, issueId), 'HISTORY_RESOURCE_UNAVAILABLE');
      await assert.rejects(repo.compareHistoricalReviewIssue(lead, plan.batch_key, plan.items[0].original_id, '999999'));
      save('issue-comparison.json', { original_id: compared.historical.original_id, platform_ref: compared.historical.platform_ref, issue_id: issueId, relation: compared.relation, formal_link_enabled: false });
    });
    await check('changed snapshot gets a separate immutable batch; concurrent first import has one receipt', async () => {
      const synthetic = structuredClone(plan);
      synthetic.sources[0].sha256 = source.hash(Buffer.from('P22_SYNTHETIC_CHANGED_SNAPSHOT'));
      synthetic.batch_key = digest({ namespace: source.VERSION, sources: synthetic.sources });
      synthetic.items.forEach(i => { i.platform_ref = 'history:' + synthetic.batch_key + ':' + i.original_id; });
      synthetic.items[0].original.title = 'P22 合成变更';
      const receipts = await Promise.all([use(db => store.importSnapshot(db, synthetic)), use(db => store.importSnapshot(db, synthetic))]);
      assert.equal(receipts.filter(r => r.duplicate).length, 1);
      assert.deepEqual(await store.read(pool, plan.batch_key), plan);
      assert.deepEqual(await store.read(pool, synthetic.batch_key), synthetic);
      assert.equal(source.compareSnapshots(plan, synthetic).items[0].status, 'changed');
      save('synthetic-version-comparison.json', { synthetic: true, receipts, comparison: source.compareSnapshots(plan, synthetic) });
    });
    await check('backup restoration preserves history and tampering cannot silently pass duplicate import', async () => {
      const dump = backup();
      await pool.execute('DELETE FROM data_map_history_opinions WHERE batch_key=? AND ordinal_no=0', [plan.batch_key]);
      await reject(store.read(pool, plan.batch_key), 'HISTORY_INTEGRITY_CONFLICT');
      await reject(use(db => store.importSnapshot(db, plan)), 'HISTORY_INTEGRITY_CONFLICT');
      restore(dump); assert.deepEqual(await store.read(pool, plan.batch_key), plan);
      assert.deepEqual(await snapshot(), protectedBefore);
      save('protected-tables.json', { before: protectedBefore, after: await snapshot(), backup_restored: true });
    });
    save('mapping.json', plan.items.map(i => ({ original_id: i.original_id, platform_ref: i.platform_ref, evidence_count: i.evidence.length, unresolved_owner: !i.responsibility_suggestion?.department })));
  }, { stage: '22' });
  await check('local snapshot and accessible originals remain unchanged', async () => {
    assert.deepEqual(source.loadSnapshot(directory), plan);
    const after = source.verifyOriginals(plan); assert.deepEqual(after, originals); save('originals-after.json', after);
  });
  save('results.json', { status: 'passed', checks, totals: plan.totals, gaps: plan.missing, opinions_with_gaps: plan.items.filter(i => i.gaps.length).map(i => ({ id: i.original_id, gaps: i.gaps })), formal_import: false, business_acceptance: false });
}
main().catch(e => { save('failure.json', { code: e.code || 'TEST_FAILED', message: /^HISTORY_|^DEFINITION_|^Assertion/.test(e.message) ? e.message : 'See failed check; no raw database error emitted' }); console.error(e.code || e.name); process.exitCode = 1; });
