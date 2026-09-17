// P16 owned MySQL + HTTP + Edge. Only synthetic records; in-memory restore at exit.
const assert = require('node:assert/strict'), crypto = require('node:crypto');
module.exports = async ctx => {
  const { repo, lead, contact, pool, run, historical, fixture, begin, completion, finish, payload, check, save, backup, restore } = ctx;
  const uuid = () => crypto.randomUUID(), own = [];
  const test = async (name, fn) => { await check('P16 ' + name, fn); own.push(name); };
  const rejects = (p, code) => assert.rejects(p, e => { assert.equal(e.code, code); return true; });
  const migration = require('../../server/analysisIssueMigration'), schema = require('../../server/analysisIssueSchema');
  const apply = async () => { const db = await pool.getConnection(); try { return await migration.applyAnalysisIssues(db); } finally { db.release(); } };
  const finding = historical.attempts[0].findings[0], evidence = historical.attempts[0].evidence.filter(e => finding.evidence_keys.includes(e.evidence_key) && e.locator_kind === 'json_pointer');
  const review = (r = run.run_id, f = finding.finding_id) => repo.getFindingReview(lead, r, f);
  const command = (extra = {}) => ({ request_id: uuid(), run_id: run.run_id, finding_id: finding.finding_id, expected_revision: 1, action: 'create', title: 'P16合成问题',
    owner_department_id: '91', owner_basis: '合成业务人员明确归口，非系统推断', reason: '已核对合成固定来源并明确确认此发现', evidence_ids: evidence.map(e => e.evidence_id), ...extra });
  await test('additive migration missing gate, interrupted DDL resume, repeated apply and drift rejection', async () => {
    await rejects(review(), 'DEFINITION_ANALYSIS_ISSUE_MIGRATION_REQUIRED');
    const before = await migration.inspectAnalysisIssues(pool); assert.equal(before.missing.length, 2);
    save('p16-inspect-before.json', before);
    assert.deepEqual(before.drift, []);
    const cfg = pool.pool.config.connectionConfig, target = `${cfg.host}:${cfg.port}/${cfg.database}`;
    const env = require('./isolatedProcess').isolatedEnvironment({ MYSQL_HOST: cfg.host, MYSQL_PORT: String(cfg.port), MYSQL_USER: cfg.user, MYSQL_PASSWORD: cfg.password, MYSQL_DATABASE: cfg.database });
    const cli = args => require('node:child_process').execFileSync(process.execPath, [require.resolve('../manage-analysis-issues'), ...args], { env, encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    assert.deepEqual(JSON.parse(cli(['--target',target])), before);
    assert.throws(() => cli(['--apply','--target','wrong']));
    await pool.execute(schema.statements()[0]); assert.equal((await migration.inspectAnalysisIssues(pool)).missing.length, 1);
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM data_map_analysis_issue_bindings'))[0][0].n, 0);
    await pool.execute('DROP TABLE data_map_analysis_issue_bindings'); // This fixture's verified empty partial DDL only.
    await pool.execute(schema.statements()[0]);
    assert.equal(JSON.parse(cli(['--apply','--target',target])).ready, true); assert.equal((await apply()).ready, true);
    await pool.execute('ALTER TABLE data_map_analysis_finding_reviews ADD COLUMN p16_drift INT');
    await rejects(apply(), 'DEFINITION_ANALYSIS_SCHEMA_DRIFT');
    await pool.execute('ALTER TABLE data_map_analysis_finding_reviews DROP COLUMN p16_drift');
    save('p16-migration.json', { before, after: await migration.inspectAnalysisIssues(pool), resumed: true, repeated: true, drift_rejected: true });
  });
  const queueDb = await pool.getConnection(); try { await require('../../server/analysisQueueMigration').applyAnalysisQueue(queueDb); } finally { queueDb.release(); }
  const dump = backup();
  async function another() {
    const r = await repo.createAnalysisRun(lead, payload()), a = await begin(r);
    await repo.completeAnalysisAttempt(lead, await completion(r, a)); await finish(r, 'partial');
    const d = await repo.getAnalysisRun(lead, r.run_id), f = d.attempts[0].findings[0];
    return command({ run_id: r.run_id, finding_id: f.finding_id, evidence_ids: d.attempts[0].evidence.filter(e => f.evidence_keys.includes(e.evidence_key) && e.locator_kind === 'json_pointer').map(e => e.evidence_id) });
  }
  const clients = {};
  async function http(who, url, method = 'GET', body, status = 200, extra = {}) {
    const c = clients[who] || {}, response = await fetch(fixture.baseURL + url, { method, headers: { 'Content-Type': 'application/json', ...(c.cookie ? { Cookie: c.cookie } : {}), ...(c.csrf ? { 'X-CSRF-Token': c.csrf } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) c.cookie = response.headers.get('set-cookie').split(';')[0];
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
  }
  let created, second;
  try {
    await test('authorization, unknown ownership, invalid evidence and irrelevant fields leave no decisions', async () => {
      await rejects(repo.decideAnalysisFinding(contact, command()), 'DEFINITION_ACCESS_DENIED');
      await rejects(repo.decideAnalysisFinding({ personId: 88, accountId: 188, authVersion: 1 }, command()), 'DEFINITION_ACCESS_DENIED');
      await rejects(repo.decideAnalysisFinding({ ...lead, authVersion: 999 }, command()), 'DEFINITION_AUTH_REQUIRED');
      await rejects(repo.getFindingReview({ personId: 86, accountId: 186, authVersion: 1 }, run.run_id, finding.finding_id), 'DEFINITION_ACCESS_DENIED');
      await rejects(repo.decideAnalysisFinding(lead, command({ owner_department_id: null })), 'DEFINITION_ANALYSIS_ISSUE_OWNER_UNRESOLVED');
      await rejects(repo.decideAnalysisFinding(lead, command({ evidence_ids: ['9223372036854775807'] })), 'DEFINITION_ANALYSIS_ISSUE_EVIDENCE_INVALID');
      await rejects(repo.decideAnalysisFinding(lead, command({ reason: '' })), 'DEFINITION_ANALYSIS_ISSUE_TEXT_REQUIRED');
      assert.equal((await review()).state.revision_no, 1);
    });
    await test('transaction failure rolls back new issue, binding, event and request receipt', async () => {
      const before = (await pool.execute('SELECT COUNT(*) n FROM process_governance_issues'))[0][0].n;
      await pool.query("CREATE TRIGGER p16_fail BEFORE INSERT ON data_map_analysis_finding_reviews FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_P16_FAILURE'");
      await assert.rejects(repo.decideAnalysisFinding(lead, command())); await pool.query('DROP TRIGGER p16_fail');
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_governance_issues'))[0][0].n, before);
      assert.equal((await review()).events.length, 0);
    });
    await test('unfinished and cancelled analysis cannot be confirmed from an earlier output', async () => {
      const r = await repo.createAnalysisRun(lead, payload()), a = await begin(r);
      await repo.completeAnalysisAttempt(lead, await completion(r,a));
      const d = await repo.getAnalysisRun(lead,r.run_id), f = d.attempts[0].findings[0];
      const p = command({ run_id:r.run_id, finding_id:f.finding_id, evidence_ids:d.attempts[0].evidence.filter(e=>f.evidence_keys.includes(e.evidence_key)&&e.locator_kind==='json_pointer').map(e=>e.evidence_id) });
      await rejects(repo.decideAnalysisFinding(lead,p),'DEFINITION_ANALYSIS_ISSUE_ATTEMPT_NOT_CURRENT');
      await finish(r,'cancelled'); await rejects(repo.decideAnalysisFinding(lead,p),'DEFINITION_ANALYSIS_ISSUE_ATTEMPT_NOT_CURRENT');
    });
    await test('concurrent confirmation creates exactly one issue; duplicate click replays receipt', async () => {
      const first = command(), other = command();
      const result = await Promise.allSettled([repo.decideAnalysisFinding(lead, first), repo.decideAnalysisFinding(lead, other)]);
      assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
      const win = result[0].status === 'fulfilled' ? 0 : 1; created = result[win].value;
      assert.equal(result[1-win].reason.code, 'DEFINITION_ANALYSIS_ISSUE_REVISION_CONFLICT');
      assert.deepEqual(await repo.decideAnalysisFinding(lead, win === 0 ? first : other), created);
      await rejects(repo.decideAnalysisFinding(lead, { ...(win === 0 ? first : other), reason: '改变理由' }), 'DEFINITION_IDEMPOTENCY_CONFLICT');
      assert.equal((await review()).state.issue_id, created.issue_id);
      const issue = await repo.getAnalysisIssue(lead, created.issue_id); assert.equal(issue.links.length, 1);
      assert.deepEqual(await repo.getAnalysisRun(lead, run.run_id), historical);
      save('p16-trace.json', { receipt: created, review: await review(), issue });
    });
    await test('explicit existing link checks ownership, digest and revision and supports many findings', async () => {
      second = await another(); const target = await repo.getAnalysisIssue(lead, created.issue_id);
      delete second.title; second = { ...second, action: 'link', issue_id: created.issue_id, expected_issue_revision: target.revision_no, expected_issue_digest: target.issue_digest };
      await rejects(repo.decideAnalysisFinding(lead, { ...second, expected_issue_digest: '0'.repeat(64) }), 'DEFINITION_ANALYSIS_ISSUE_TARGET_CONFLICT');
      await rejects(repo.decideAnalysisFinding(lead, { ...second, owner_department_id: '92' }), 'DEFINITION_ANALYSIS_ISSUE_OWNER_MISMATCH');
      await repo.decideAnalysisFinding(lead, second);
      const issue = await repo.getAnalysisIssue(lead, created.issue_id); assert.equal(issue.links.length, 2);
      await rejects(repo.decideAnalysisFinding(lead, command({ action: 'not_an_issue', title: undefined, expected_revision: 2 })), 'DEFINITION_ANALYSIS_ISSUE_DECISION_FINAL');
      save('p16-many-findings.json', issue);
    });
    await test('not-an-issue is scoped to one unlinked finding; confirm does not create a problem', async () => {
      const p = await another(); delete p.title; p.action = 'confirm';
      const accepted = await repo.decideAnalysisFinding(lead, p); assert.equal(accepted.issue_id, null);
      const rejected = await repo.decideAnalysisFinding(lead, { ...p, request_id: uuid(), action: 'not_an_issue', expected_revision: 2 }); assert.equal(rejected.decision, 'not_an_issue');
      assert.equal((await review()).state.decision, 'linked');
      assert.equal((await repo.getAnalysisIssue(lead, created.issue_id)).issue.display_status, 'waiting_my_action');
    });
    await test('legacy reads do not leak linked source; all old mutations and retired HTTP paths stay blocked', async () => {
      const old = require('../../server/processGovernanceIssuePoolRepository').makeProcessGovernanceIssuePoolRepository(pool);
      for (const method of ['getIssueDetail','closeIssue','reopenIssue','addIssueComment']) await rejects(old[method](created.issue_id, {}), 'DEFINITION_ANALYSIS_ISSUE_LEGACY_ACTION_BLOCKED');
      await rejects(old.createTermTask({ issue_id: created.issue_id }), 'DEFINITION_ANALYSIS_ISSUE_LEGACY_ACTION_BLOCKED');
      await pool.execute("INSERT INTO process_governance_issue_points(issue_id,point_key,point_type,title,prompt_text,enum_options_json) VALUES (?,'p16-point','evidence_gap','合成','合成','[]')", [created.issue_id]);
      const point = (await pool.execute("SELECT CAST(point_id AS CHAR) id FROM process_governance_issue_points WHERE point_key='p16-point'"))[0][0].id;
      await rejects(old.applyPointAction(point, { action: 'mdm-decision' }), 'DEFINITION_ANALYSIS_ISSUE_LEGACY_ACTION_BLOCKED');
      await pool.execute("INSERT INTO process_governance_term_tasks(issue_id,term_text,context_text,selected_departments_json) VALUES (?,'合成术语','合成上下文','[]')", [created.issue_id]);
      const task = (await pool.execute('SELECT CAST(term_task_id AS CHAR) id FROM process_governance_term_tasks WHERE issue_id=?', [created.issue_id]))[0][0].id;
      for (const method of ['getTermTask','answerTermTask','decideTermTask']) await rejects(old[method](task, {}), 'DEFINITION_ANALYSIS_ISSUE_LEGACY_ACTION_BLOCKED');
      assert(!(await old.listIssues({})).items.some(i => String(i.issue_id) === created.issue_id)); await old.listQueues({});
      for (const who of ['lead','contact','outsider','adminMulti']) { clients[who] = {}; await http(who, '/api/org/login', 'POST', { loginName: 'SYNTHETIC_' + who, password: fixture.loginPassword }); clients[who].csrf = (await http(who, '/api/csrf-token')).csrfToken; }
      await http('lead', `/api/process-governance/issue-pool/issues/${created.issue_id}/close`, 'POST', {}, 404);
      const url = `/api/analysis/runs/${run.run_id}/findings/${finding.finding_id}/review`;
      await http('anonymous', url, 'GET', undefined, 401); await http('outsider', url, 'GET', undefined, 404); await http('adminMulti', url, 'POST', {}, 404);
      await http('lead', url, 'GET'); await http('lead', `/api/analysis/issues/${created.issue_id}`, 'GET');
      await http('lead', url, 'POST', {}, 403, { 'X-CSRF-Token': 'invalid' });
    });
    await test('legacy unlinked issue remains readable and explicitly linkable without rewriting its fields', async () => {
      const copy = (await pool.execute('SELECT * FROM process_governance_issues WHERE issue_id=?', [created.issue_id]))[0][0]; delete copy.issue_id; copy.issue_key = 'p16-legacy'; copy.source_type = 'process_mapping';
      await pool.query('INSERT INTO process_governance_issues SET ?', copy);
      const legacyId = (await pool.execute("SELECT CAST(issue_id AS CHAR) id FROM process_governance_issues WHERE issue_key='p16-legacy'"))[0][0].id;
      const old = require('../../server/processGovernanceIssuePoolRepository').makeProcessGovernanceIssuePoolRepository(pool);
      assert((await old.getIssueDetail(legacyId)).issue);
      const target = await repo.getAnalysisIssue(lead, legacyId), p = await another(); delete p.title;
      await repo.decideAnalysisFinding(lead, { ...p, action: 'link', issue_id: legacyId, expected_issue_revision: 1, expected_issue_digest: target.issue_digest });
      assert.deepEqual((await repo.getAnalysisIssue(lead, legacyId)).issue, target.issue);
      await rejects(old.closeIssue(legacyId), 'DEFINITION_ANALYSIS_ISSUE_LEGACY_ACTION_BLOCKED');
    });
    await test('related source mutation refuses decisions; immutable run output and old history stay intact', async () => {
      const p = await another(), b = backup();
      await pool.execute("UPDATE data_map_v7_sources SET content_digest=REPEAT('0',64) WHERE source_id=?", [ctx.source.source_id]);
      await assert.rejects(repo.decideAnalysisFinding(lead, p), e => e.statusCode === 409); restore(b);
      assert.deepEqual(await repo.getAnalysisRun(lead, run.run_id), historical);
    });
    await test('backup restore retains confirmation history; changed ledger head and review tampering fail closed', async () => {
      const p = await another(), before = await review(), b = backup();
      await pool.execute('UPDATE data_map_analysis_finding_reviews SET snapshot_digest=REPEAT(\'0\',64) WHERE finding_id=?', [finding.finding_id]);
      await rejects(review(), 'DEFINITION_ANALYSIS_ISSUE_INTEGRITY_CONFLICT'); restore(b); assert.deepEqual(await review(), before);
      const [[head]] = await pool.execute("SELECT revision_no FROM data_map_v7_mappings WHERE mapping_id=?", [ctx.mapping.mapping_id]);
      await pool.execute('UPDATE data_map_v7_mappings SET revision_no=revision_no+1 WHERE mapping_id=?', [ctx.mapping.mapping_id]);
      await rejects(repo.decideAnalysisFinding(lead, p), 'DEFINITION_ANALYSIS_ISSUE_SOURCE_SUPERSEDED');
      await pool.execute('UPDATE data_map_v7_mappings SET revision_no=? WHERE mapping_id=?', [head.revision_no, ctx.mapping.mapping_id]);
      save('p16-backup-restore.json', { sha256: crypto.createHash('sha256').update(b).digest('hex'), restored_confirmation_equal: true, persisted_backup: false, empty_partial_compensation: true });
    });
    await require('./analysisIssueBrowserVerification')({ ...ctx, test, save });
    save('p16-results.json', { passed: true, checks: own, formal_environment: false, human_acceptance: false });
  } finally { restore(dump); }
};
