// Real owned tmpfs MySQL + own child processes; no real data, external calls or DDL on startup.
// --output requires a new artifacts directory. Fixture and child cleanup in finally.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { fork, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const { applyDefinitions } = require('../server/dataMapDefinitionMigration');
const { applyV7Mappings } = require('../server/v7MappingMigration');
const { applyDesignHandoffs } = require('../server/designHandoffMigration');
const { applyAnalysisRuns } = require('../server/analysisRunMigration');
const { applyAnalysisQueue, inspectAnalysisQueue, tables } = require('../server/analysisQueueMigration');
const { digest } = require('../server/dataMapDefinitionValues');
const arg = process.argv.indexOf('--output'), output = path.resolve(process.argv[arg + 1] || '.');
assert(arg >= 0 && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const save = (n, v) => fs.writeFileSync(path.join(output, n), JSON.stringify(v, null, 2));
const checks = [], uuid = () => crypto.randomUUID(), sleep = ms => new Promise(r => setTimeout(r, ms));
const rejects = (p, c) => assert.rejects(p, e => { assert.equal(e.code, c); return true; });
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function main() {
  await withStage05Fixture(async ({ pool, backup, restore }) => {
    const repo = makeDataMapDefinitionRepository(pool), lead = { personId: 82, accountId: 182, authVersion: 1 }, contact = { personId: 83, accountId: 183, authVersion: 1 };
    const cfg = pool.pool.config.connectionConfig;
    const env = isolatedEnvironment({ MYSQL_HOST: cfg.host, MYSQL_PORT: String(cfg.port), MYSQL_USER: cfg.user, MYSQL_PASSWORD: cfg.password, MYSQL_DATABASE: cfg.database });
    const target = cfg.host + ':' + cfg.port + '/' + cfg.database;
    const cli = (script, args) => execFileSync(process.execPath, [path.join(__dirname, script), ...args, '--target', target], { env, windowsHide: true, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    const children = new Set(), logs = [];
    function spawn(script) {
      const child = fork(path.join(__dirname, script), script === 'analysis-worker.js' ? ['start', '--target', target] : [], { env, silent: true, windowsHide: true, execArgv: [] });
      children.add(child); child.on('exit', () => children.delete(child));
      child.stdout.on('data', data => { for (const line of String(data).trim().split('\n')) { try { logs.push({ pid: child.pid, ...JSON.parse(line) }); } catch { logs.push({ pid: child.pid, text: line }); } } });
      child.stderr.on('data', data => logs.push({ pid: child.pid, error: String(data).trim() }));
      return child;
    }
    async function waitFor(fn, timeout = 12000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(30); } throw Error('TEST_TIMEOUT'); }
    async function kill(child) { if (child.exitCode === null && child.signalCode === null) { const end = once(child, 'exit'); child.kill('SIGKILL'); await end; } }
    const get = r => repo.getAnalysisRun(lead, r.run_id);
    let object;
    const payload = (parsers = ['stub_success']) => ({ request_id: uuid(), inputs: [{ input_key: 'object', kind: 'definition', ref_id: object.version_id }],
      check_scope: { description: 'P10仅合成调度，无真实规则', check_ids: parsers.flatMap((_, i) => ['check' + i, 'extra' + i]) },
      parser_versions: Object.fromEntries(parsers.map(p => [p, 'p10-stub-v1'])), rule_version: 'p10-stub-v1',
      steps: parsers.map((p, i) => ({ step_key: 'step' + i, input_keys: ['object'], check_ids: ['check' + i, 'extra' + i], parser_key: p })) });
    const enqueue = async (parsers, p = {}) => { const run = await repo.createAnalysisRun(lead, payload(parsers)); await repo.enqueueAnalysis(lead, { request_id: uuid(), run_id: run.run_id, policy: { lease_ms: 500, timeout_ms: 1500, retry_ms: 0, ...p } }); return run; };
    const complete = (claim, task, overrides = {}) => repo.completeQueuedAnalysis(claim, { request_id: uuid(), attempt_id: task.attempt_id, expected_revision: task.revision_no, status: 'succeeded', checked_ids: task.step.check_ids, error_code: null, evidence: [], findings: [], ...overrides });
    try {
      const db = await pool.getConnection();
      try { await applyDefinitions(db); await applyV7Mappings(db); await applyDesignHandoffs(db); await applyAnalysisRuns(db); } finally { db.release(); }
      object = await repo.saveManaged(contact, { request_id: uuid(), entity_type: 'object', definition: { name: 'P10合成调度对象' } });
      const old = await repo.createAnalysisRun(lead, payload());
      const oldSnapshot = await get(old);
      const protectedTables = ['data_map_objects', 'data_map_definition_versions', 'data_map_v7_sources', 'data_map_design_handoffs', 'process_design_versions', 'process_governance_issues', 'mdm_todos'];
      const snapshot = async () => Object.fromEntries(await Promise.all(protectedTables.map(async t => {
        const [exists] = await pool.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [t]);
        return [t, exists.length ? digest((await pool.query('SELECT * FROM ' + t))[0]) : 'absent'];
      })));
      const protectedBefore = await snapshot();
      await check('explicit migration: missing, dry-run, partial DDL resume, repeat, drift and old run preservation', async () => {
        await rejects(repo.claimAnalysis(uuid()), 'DEFINITION_ANALYSIS_QUEUE_MIGRATION_REQUIRED');
        assert.equal(JSON.parse(cli('manage-analysis-queue.js', [])).missing.length, 3);
        assert.throws(() => cli('analysis-worker.js', ['start']));
        assert.equal((await inspectAnalysisQueue(pool)).missing.length, 3);
        const db = await pool.getConnection();
        try {
          const wrap = { execute: (sql, args) => { if (sql.startsWith('CREATE TABLE IF NOT EXISTS data_map_analysis_queue_events')) throw Error('SYNTHETIC_DDL_FAILURE'); return db.execute(sql, args); }, query: (...args) => db.query(...args) };
          await assert.rejects(applyAnalysisQueue(wrap), /SYNTHETIC_DDL_FAILURE/);
          save('partial-ddl-inspect.json', await inspectAnalysisQueue(db));
          assert.equal((await inspectAnalysisQueue(db)).missing.length, 2);
          assert.equal(Number((await db.query('SELECT COUNT(*) n FROM data_map_analysis_queue'))[0][0].n), 0);
          await db.execute('DROP TABLE data_map_analysis_queue');
          await assert.rejects(applyAnalysisQueue(wrap), /SYNTHETIC_DDL_FAILURE/);
          assert((await applyAnalysisQueue(db)).ready); assert((await applyAnalysisQueue(db)).ready);
          await db.execute('ALTER TABLE data_map_analysis_queue ADD COLUMN synthetic_drift INT');
          await rejects(applyAnalysisQueue(db), 'DEFINITION_ANALYSIS_QUEUE_SCHEMA_DRIFT');
          await db.execute('ALTER TABLE data_map_analysis_queue DROP COLUMN synthetic_drift');
        } finally { db.release(); }
        assert(JSON.parse(cli('manage-analysis-queue.js', ['--apply'])).ready);
        assert.deepEqual(await get(old), oldSnapshot); assert.equal(await repo.claimAnalysis(uuid()), null);
        save('migration.json', { old_run_unchanged: true, unqueued: true, compensated_empty_table: true, after: await inspectAnalysisQueue(pool) });
      });
      await check('enqueue request deduplication, payload conflicts, adapter and identity boundaries', async () => {
        const request = { request_id: uuid(), run_id: old.run_id };
        assert.deepEqual(await repo.enqueueAnalysis(lead, request), await repo.enqueueAnalysis(lead, request));
        await rejects(repo.enqueueAnalysis(lead, { ...request, policy: { max_attempts: 2 } }), 'DEFINITION_IDEMPOTENCY_CONFLICT');
        await rejects(repo.enqueueAnalysis(lead, { ...request, request_id: uuid() }), 'DEFINITION_ANALYSIS_QUEUE_ALREADY_ENQUEUED');
        await rejects(repo.enqueueAnalysis({ personId: 88, accountId: 188, authVersion: 1 }, { ...request, request_id: uuid() }), 'DEFINITION_ACCESS_DENIED');
        await rejects(repo.enqueueAnalysis({ ...lead, authVersion: 999 }, request), 'DEFINITION_AUTH_REQUIRED');
        const ordinary = await repo.createAnalysisRun(lead, { ...payload(), rule_version: 'ordinary' });
        await rejects(repo.enqueueAnalysis(lead, { request_id: uuid(), run_id: ordinary.run_id }), 'DEFINITION_ANALYSIS_QUEUE_ADAPTER_NOT_ENABLED');
        await repo.cancelQueuedAnalysis(lead, { request_id: uuid(), run_id: old.run_id, expected_revision: (await get(old)).revision_no });
      });
      await check('two independent Node claimants compete: exactly one token and attempt', async () => {
        const run = await enqueue();
        const a = spawn('testHelpers/analysis-claim-child.js'), b = spawn('testHelpers/analysis-claim-child.js');
        await Promise.all([a, b].map(c => new Promise(resolve => c.once('message', resolve))));
        const replies = [a, b].map(c => new Promise(resolve => c.once('message', resolve)));
        a.send('go'); b.send('go');
        const values = await Promise.all(replies); assert(values.every(v => !v.error)); assert.equal(values.filter(v => v.claim).length, 1);
        const claim = values.find(v => v.claim).claim;
        const task = await repo.nextAnalysisStep(claim);
        await rejects(repo.beginAnalysisAttempt(lead, { request_id: uuid(), run_id: run.run_id, expected_revision: task.revision_no, step_key: task.step.step_key }), 'DEFINITION_ANALYSIS_WORKER_TOKEN_REQUIRED');
        const result = { request_id: uuid(), attempt_id: task.attempt_id, expected_revision: task.revision_no, status: 'succeeded', checked_ids: task.step.check_ids, error_code: null, evidence: [], findings: [] };
        assert.deepEqual(await repo.completeQueuedAnalysis(claim, result), await repo.completeQueuedAnalysis(claim, result));
        assert.equal(Number((await pool.execute("SELECT COUNT(*) n FROM data_map_analysis_queue_events WHERE run_id=? AND event_type='step_completed'", [run.run_id]))[0][0].n), 1);
        await repo.nextAnalysisStep(claim); assert.equal((await get(run)).status, 'succeeded');
        save('competition.json', { claimants: 2, winners: 1, run: await get(run) });
      });
      await check('heartbeat extends lease, expired claim recovery fences old token and preserves attempts', async () => {
        const run = await enqueue(), c1 = await repo.claimAnalysis(uuid()), t1 = await repo.nextAnalysisStep(c1);
        await sleep(280); await repo.heartbeatAnalysis(c1); await sleep(280); await repo.heartbeatAnalysis(c1);
        await pool.execute('UPDATE data_map_analysis_queue SET lease_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE run_id=?', [run.run_id]);
        await rejects(complete(c1, t1), 'DEFINITION_ANALYSIS_QUEUE_LEASE_LOST');
        assert.equal(JSON.parse(cli('analysis-worker.js', ['recover'])).recovered, 1);
        const c2 = await repo.claimAnalysis(uuid()); assert(c2.generation > c1.generation);
        await rejects(repo.heartbeatAnalysis(c1), 'DEFINITION_ANALYSIS_QUEUE_LEASE_LOST');
        await rejects(complete(c1, t1), 'DEFINITION_ANALYSIS_QUEUE_LEASE_LOST');
        const t2 = await repo.nextAnalysisStep(c2); await complete(c2, t2); await repo.nextAnalysisStep(c2);
        const actual = await get(run); assert.equal(actual.attempts.length, 2); assert.equal(actual.attempts[0].error_code, 'LEASE_EXPIRED');
        save('recovery.json', actual);
      });
      await check('cancel races completion, duplicate cancel, late results cannot revive cancelled run', async () => {
        const run = await enqueue(), c = await repo.claimAnalysis(uuid()), task = await repo.nextAnalysisStep(c);
        const p = { request_id: uuid(), run_id: run.run_id, expected_revision: task.revision_no };
        const race = await Promise.allSettled([repo.cancelQueuedAnalysis(lead, p), complete(c, task)]);
        assert(race.some(r => r.status === 'fulfilled'));
        if ((await get(run)).status !== 'cancelled') await repo.cancelQueuedAnalysis(lead, { ...p, request_id: uuid(), expected_revision: (await get(run)).revision_no });
        await rejects(complete(c, task), 'DEFINITION_ANALYSIS_QUEUE_LEASE_LOST');
        assert.equal((await get(run)).status, 'cancelled');
        const r2 = await enqueue(); const p2 = { request_id: uuid(), run_id: r2.run_id, expected_revision: r2.revision_no };
        assert.deepEqual(await repo.cancelQueuedAnalysis(lead, p2), await repo.cancelQueuedAnalysis(lead, p2));
        save('cancellation.json', await get(run));
      });
      await check('real worker singleton, success retention, bounded retries, invalid input and partial coverage', async () => {
        const run = await enqueue(['stub_success', 'stub_transient', 'stub_invalid', 'stub_partial'], { lease_ms: 2000, timeout_ms: 5000 });
        const worker = spawn('analysis-worker.js'); const started = await waitFor(() => logs.find(l => l.pid === worker.pid && l.event === 'worker_started'));
        const duplicate = spawn('analysis-worker.js'); await once(duplicate, 'exit'); assert.equal(duplicate.exitCode, 1); assert(logs.some(l => l.pid === duplicate.pid && l.error === 'ANALYSIS_WORKER_BUSY'));
        await waitFor(async () => (await get(run)).status === 'partial');
        const actual = await get(run); assert.deepEqual(actual.steps.map(s => s.attempt_no), [1, 3, 1, 1]); assert.equal(actual.attempts[0].status, 'succeeded');
        const status = JSON.parse(cli('analysis-worker.js', ['status'])); assert(status.workers.some(w => w.worker_id === started.worker_id)); assert(!JSON.stringify(status).includes('token_hash'));
        cli('analysis-worker.js', ['stop', '--worker-id', started.worker_id]); await once(worker, 'exit'); assert.equal(worker.exitCode, 0);
        save('partial.json', actual);
      });
      await check('actual child interruption and lease expiry reclaims without duplicate successful steps', async () => {
        const run = await enqueue(['stub_success', 'stub_hang'], { timeout_ms: 1200, max_attempts: 2 });
        const worker = spawn('analysis-worker.js');
        await waitFor(async () => (await get(run)).steps[1].status === 'running'); await kill(worker);
        // The owned child really died. Pin the two independent time boundaries
        // so process startup latency cannot turn lease recovery into a timeout.
        await pool.execute('UPDATE data_map_analysis_queue SET lease_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)),deadline_at=TIMESTAMPADD(SECOND,30,UTC_TIMESTAMP(3)) WHERE run_id=?', [run.run_id]);
        const next = spawn('analysis-worker.js'); const started = await waitFor(() => logs.find(l => l.pid === next.pid && l.event === 'worker_started'));
        await waitFor(async () => (await get(run)).status === 'partial');
        const actual = await get(run); assert.equal(actual.steps[0].attempt_no, 1); assert.equal(actual.steps[1].attempt_no, 2);
        assert.deepEqual(actual.attempts.filter(a => a.step_key === 'step1').map(a => a.error_code), ['LEASE_EXPIRED', 'STEP_TIMEOUT']);
        cli('analysis-worker.js', ['stop', '--worker-id', started.worker_id]); await once(next, 'exit');
        save('process-crash-timeout.json', actual);
      });
      await check('stop during running adapter is graceful; restart resumes persisted interrupted attempt', async () => {
        const run = await enqueue(['stub_hang'], { timeout_ms: 1200, max_attempts: 2 });
        const worker = spawn('analysis-worker.js'); const started = await waitFor(() => logs.find(l => l.pid === worker.pid && l.event === 'worker_started'));
        await waitFor(async () => (await get(run)).steps[0].status === 'running');
        cli('analysis-worker.js', ['stop', '--worker-id', started.worker_id]); await once(worker, 'exit'); assert.equal(worker.exitCode, 0);
        assert.equal((await get(run)).attempts[0].error_code, 'WORKER_STOPPED');
        const next = spawn('analysis-worker.js'); const s2 = await waitFor(() => logs.find(l => l.pid === next.pid && l.event === 'worker_started'));
        await waitFor(async () => (await get(run)).status === 'failed');
        cli('analysis-worker.js', ['stop', '--worker-id', s2.worker_id]); await once(next, 'exit');
      });
      await check('revoked identity fails once without retry or a privileged worker bypass', async () => {
        const run = await enqueue();
        await pool.execute('UPDATE user_accounts SET auth_version=2 WHERE account_id=182');
        assert.equal(await repo.claimAnalysis(uuid()), null);
        await pool.execute('UPDATE user_accounts SET auth_version=1 WHERE account_id=182');
        assert.equal((await get(run)).status, 'failed'); assert.equal((await get(run)).attempts.length, 0);
        assert.equal(await repo.claimAnalysis(uuid()), null);
      });
      await check('queue result transaction rollback has no partial step or evidence', async () => {
        const run = await enqueue(), c = await repo.claimAnalysis(uuid()), task = await repo.nextAnalysisStep(c);
        await pool.query("CREATE TRIGGER synthetic_p10_event_failure BEFORE INSERT ON data_map_analysis_queue_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_FAILURE'");
        try { await assert.rejects(complete(c, task)); assert.equal((await get(run)).attempts[0].status, 'running'); }
        finally { await pool.query('DROP TRIGGER synthetic_p10_event_failure'); }
        await complete(c, task); await repo.nextAnalysisStep(c);
      });
      await check('prior successful findings and evidence survive a later failed step unchanged', async () => {
        const run = await enqueue(['stub_success', 'stub_invalid'], { lease_ms: 2000, timeout_ms: 5000 });
        const c = await repo.claimAnalysis(uuid()), first = await repo.nextAnalysisStep(c);
        const evidence = [{ evidence_key: 'synthetic', input_key: 'object', locator_kind: 'json_pointer', locator: '/name', note: 'P10合成证据，无业务认定' }];
        const findings = [{ rule_id: first.step.check_ids[0], finding_type: 'synthetic_check', message: '仅验证持久化，待核实', subject_input_keys: ['object'], semantic_locator: 'synthetic-object=name', evidence_keys: ['synthetic'] }];
        await complete(c, first, { evidence, findings });
        const saved = (await get(run)).attempts[0];
        const second = await repo.nextAnalysisStep(c);
        await complete(c, second, { status: 'failed', checked_ids: [], error_code: 'INVALID_INPUT' });
        await repo.nextAnalysisStep(c);
        const actual = await get(run); assert.equal(actual.status, 'partial'); assert.deepEqual(actual.attempts[0], saved);
        assert.equal(saved.findings[0].verification_status, 'pending_verification'); assert.equal(saved.findings[0].issue_id, null);
        save('preserved-findings.json', actual);
      });
      await check('queue backup restoration and original governance assets unchanged', async () => {
        const before = {};
        for (const t of tables) before[t] = digest((await pool.query('SELECT * FROM ' + t))[0]);
        const dump = await backup(); await restore(dump);
        for (const t of tables) assert.equal(digest((await pool.query('SELECT * FROM ' + t))[0]), before[t]);
        assert.deepEqual(await snapshot(), protectedBefore);
        save('backup-and-protection.json', { queue: before, protected: protectedBefore, restored: true });
      });
      await check('recovery preserves BIGINT attempt identities above JavaScript safe integer', async () => {
        await pool.query('ALTER TABLE data_map_analysis_attempts AUTO_INCREMENT=9007199254741100');
        const run = await enqueue(), c = await repo.claimAnalysis(uuid()), task = await repo.nextAnalysisStep(c);
        assert.equal(task.attempt_id, '9007199254741100');
        await pool.execute('UPDATE data_map_analysis_queue SET lease_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE run_id=?', [run.run_id]);
        assert.equal((await repo.recoverAnalysisQueue()).recovered, 1);
        assert.equal((await get(run)).attempts[0].status, 'failed');
        const next = await repo.claimAnalysis(uuid()), retry = await repo.nextAnalysisStep(next);
        assert.equal(retry.attempt_id, '9007199254741101'); await complete(next, retry); await repo.nextAnalysisStep(next);
        save('bigint-recovery.json', await get(run));
      });
      save('worker-events.json', logs); save('results.json', { passed: true, checks, actual_child_processes: true, owned_mysql: true });
    } finally {
      for (const child of [...children]) await kill(child);
      save('queue-state.json', (await pool.execute('SELECT CAST(run_id AS CHAR) run_id,state,generation,error_code FROM data_map_analysis_queue'))[0]);
      save('attempt-state.json', (await pool.execute('SELECT CAST(run_id AS CHAR) run_id,step_key,attempt_no,status,error_code FROM data_map_analysis_attempts'))[0]);
      save('worker-events.json', logs);
      save('cleanup.json', { remaining_owned_children: children.size });
    }
  });
}
main().catch(e => { save('failure.json', { code: e.code, message: e.message, stack: e.stack, checks }); console.error(e); process.exitCode = 1; });
