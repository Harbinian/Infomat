// P25/P11 synthetic format admission. Owned UUID/tmpfs MySQL, loopback API and
// explicitly targeted worker only. --output must be new; no env file or live DB.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { fork } = require('node:child_process'), { once } = require('node:events');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const rules = require('../server/v7AnalysisRules');
const { document, binding, node, edge } = require('./testHelpers/v7AnalysisSamples');
const { digest, json } = require('../server/dataMapDefinitionValues');
const arg = process.argv.indexOf('--output'); assert(arg >= 0 && process.argv[arg + 1]);
const output = path.resolve(process.argv[arg + 1]);
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
const uuid = () => crypto.randomUUID(), checks = [], sleep = ms => new Promise(r => setTimeout(r, ms));
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
function nativeV8() {
  const d = require('../../structured-output-service/server').createEmptyProcessGovernanceDocument(), v7 = binding();
  d.process = { ...v7.process, process_ref: 'p11_native_v8', process_name: 'P11原生V8合成材料' };
  d.behaviors = [...v7.behaviors, { ...node('decision_basis', 'decision'), current_actor_role: '全公司', actor_assignment_mode: 'company_wide' }];
  d.flow_relations = [...v7.flow_relations, edge('relation_basis', 'behavior_b', 'decision_basis')];
  d.data_objects = v7.data_objects;
  d.data_objects[0].behavior_links = [{ link_ref: 'basis_use', behavior_ref: 'decision_basis', operation: 'use', updated_field_refs: [] }];
  return d;
}
async function main() {
  await withStage05Fixture(async ({ pool, fixture, expect, request, backup, restore }) => {
    const repo = makeDataMapDefinitionRepository(pool), lead = { personId: 82, accountId: 182, authVersion: 1 };
    const db = await pool.getConnection();
    try { for (const [mod, fn] of [['dataMapDefinitionMigration', 'applyDefinitions'], ['v7MappingMigration', 'applyV7Mappings'], ['designHandoffMigration', 'applyDesignHandoffs'], ['analysisRunMigration', 'applyAnalysisRuns'], ['analysisQueueMigration', 'applyAnalysisQueue']]) await require('../server/' + mod)[fn](db); }
    finally { db.release(); }
    const upload = d => repo.registerV7Source(lead, { request_id: uuid(), source_kind: 'uploaded_material', original_name: 'P11-synthetic.json' }, Buffer.isBuffer(d) ? d : Buffer.from(JSON.stringify(d)));
    const payload = (source, version = rules.VERSION) => ({ request_id: uuid(), inputs: [{ input_key: 'source', kind: 'v7_source', ref_id: source.source_id }],
      check_scope: { description: 'P11固定合成材料格式边界', check_ids: rules.checksForVersion(version) }, rule_version: version, parser_versions: { [rules.PARSER]: version },
      steps: [{ step_key: 'v7', parser_key: rules.PARSER, input_keys: ['source'], check_ids: rules.checksForVersion(version) }] });
    const v8doc = nativeV8(), v8 = await upload(v8doc); assert.equal(v8.validation_status, 'valid');
    if (process.argv.includes('--reproduce')) {
      const result = await request('lead', '/api/analysis/runs', 'POST', payload(v8));
      const pure = rules.analyze({ step: { parser_key: rules.PARSER, check_ids: rules.CHECKS }, inputs: [{ input_key: 'source', snapshot: { validation_status: 'valid' }, document: v8doc }] });
      save('reproduction.json', { p07: v8, api: result, pure, legal_native_v8: true, external_calls: 0 });
      assert.equal(result.status, 200); assert(pure.findings.some(f => f.rule_id === 'v7.format'));
      console.log('REPRODUCED legal native V8 queues and becomes misleading V7 format findings'); return;
    }
    const count = async () => Object.fromEntries(await Promise.all(['data_map_analysis_runs', 'data_map_analysis_inputs', 'data_map_analysis_steps', 'data_map_analysis_queue', 'data_map_analysis_queue_events', 'data_map_definition_requests'].map(async t => [t, Number((await pool.query('SELECT COUNT(*) n FROM ' + t))[0][0].n)])));
    const get = r => repo.getAnalysisRun(lead, typeof r === 'string' ? r : r.run_id);
    const wait = async fn => { const end = Date.now() + 45000; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); } throw Error('P11_WAIT_TIMEOUT'); };
    const v7 = await upload(document()), graphDoc = document(); graphDoc.behaviors.push(node('behavior_isolated'));
    const graph = await upload(graphDoc), unknownDoc = { ...document(), schema_version: 'process-governance-v99' }, unknown = await upload(unknownDoc);
    let worker, browser, context, page; const events = [], pageErrors = [], consoleErrors = [];
    async function stopWorker() { if (worker && worker.exitCode === null && worker.signalCode === null) { const ended = once(worker, 'exit'); worker.send('stop'); const timer = setTimeout(() => worker.kill('SIGKILL'), 10000); await ended; clearTimeout(timer); } }
    async function startWorker() {
      const c = pool.pool.config.connectionConfig;
      worker = fork(path.join(__dirname, 'analysis-worker.js'), ['start', '--target', `${c.host}:${c.port}/${c.database}`], { env: isolatedEnvironment({ MYSQL_HOST: c.host, MYSQL_PORT: String(c.port), MYSQL_USER: c.user, MYSQL_PASSWORD: c.password, MYSQL_DATABASE: c.database, PROCESS_V7_PREVIEW_ENABLED: '1', PROCESS_V7_FORMAL_ENABLED: '1' }), silent: true, windowsHide: true, execArgv: [] });
      worker.stdout.on('data', b => { for (const line of String(b).trim().split('\n')) try { events.push(JSON.parse(line)); } catch {} });
      worker.stderr.on('data', () => events.push({ event: 'stderr' }));
      await wait(() => events.some(e => e.event === 'worker_started'));
    }
    async function execute(source, version = rules.VERSION) {
      const r = await repo.createQueuedAnalysis(lead, payload(source, version));
      return wait(async () => { const detail = await get(r); return ['succeeded', 'partial', 'failed'].includes(detail.status) ? detail : null; });
    }
    // Simulate an already stored old P09 manifest, before any results are added.
    // Direct synthetic fixture SQL is confined to the owned database, not a migration.
    async function legacy(source, enqueue = false) {
      const body = payload(source, rules.LEGACY_VERSION); body.steps[0].parser_key = 'legacy_fixture'; body.parser_versions = { legacy_fixture: rules.LEGACY_VERSION };
      const r = await repo.createAnalysisRun(lead, body), detail = await get(r);
      const manifest = structuredClone(detail.manifest); manifest.steps[0].parser_key = rules.PARSER; manifest.parser_versions = { [rules.PARSER]: rules.LEGACY_VERSION };
      await pool.execute('UPDATE data_map_analysis_runs SET manifest_json=?,manifest_digest=? WHERE run_id=?', [json(manifest), digest(manifest), r.run_id]);
      if (enqueue) {
        const policy = require('../server/analysisQueue').policy({ lease_ms: 1000, timeout_ms: 10000, retry_ms: 0 });
        await pool.execute("INSERT INTO data_map_analysis_queue(run_id,session_json,policy_json,state,available_at,created_at,updated_at) VALUES (?,?,?,'ready',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [r.run_id, json(lead), json(policy)]);
        await pool.execute("INSERT INTO data_map_analysis_queue_events(run_id,generation,worker_id,event_type,created_at) VALUES (?,0,NULL,'enqueued',UTC_TIMESTAMP(3))", [r.run_id]);
      }
      return get(r);
    }
    try {
      await check('pure and CPU entry accept native V8 in current rules and refuse old-version V8/unknown', async () => {
        const { dispatch } = require('../server/analysisWorker');
        for (const d of [unknownDoc, { ...document(), schema_version: null }]) {
          const task = { step: { parser_key: rules.PARSER, check_ids: rules.CHECKS }, inputs: [{ input_key: 'source', snapshot: { validation_status: 'valid' }, document: d }] };
          for (const result of [rules.analyze(task), await dispatch(task, new AbortController().signal)]) { assert.equal(result.status, 'failed'); assert.equal(result.error_code, 'SOURCE_FORMAT_UNSUPPORTED'); assert.deepEqual(result.checked_ids, []); assert.deepEqual(result.findings, []); }
        }
        const task={step:{parser_key:rules.PARSER,check_ids:rules.CHECKS},inputs:[{input_key:'source',snapshot:{validation_status:'valid'},document:v8doc}]};assert.equal((await dispatch(task,new AbortController().signal)).status,'succeeded');
        for(const parser_version of [rules.LEGACY_VERSION,rules.V2_VERSION])assert.equal((await dispatch({...task,parser_version,step:{...task.step,check_ids:rules.checksForVersion(parser_version)}},new AbortController().signal)).error_code,'SOURCE_FORMAT_UNSUPPORTED');
        assert.equal((await dispatch({...task,parser_version:rules.PREVIOUS_VERSION,step:{...task.step,check_ids:rules.LEGACY_CHECKS}},new AbortController().signal)).status,'succeeded');
      });
      await check('repository/API admission refuse before any run queue or receipt is committed', async () => {
        const before = await count();
        for (const s of [unknown]) {
          const response = await request('lead', '/api/analysis/runs', 'POST', payload(s));
          assert.equal(response.status, 409); assert.equal(response.body.code, 'DEFINITION_ANALYSIS_SOURCE_FORMAT_UNSUPPORTED'); assert(response.body.error.includes('支持范围'));
          await assert.rejects(repo.createAnalysisRun(lead, payload(s)), e => e.code === response.body.code);
        }
        assert.deepEqual(await count(), before); save('early-refusal.json', { before, after: await count() });
      });
      await check('capabilities and source readback describe actual formats without mutating fixed sources', async () => {
        const cap = await expect('lead', '/api/analysis/capabilities'); assert.deepEqual(cap.adapters.find(a => a.parser_key === rules.PARSER).native_schema_versions, rules.NATIVE_SCHEMAS);
        for (const [s, supported] of [[v7, true], [v8, true], [unknown, false]]) {
          const view = await expect('lead', '/api/analysis/sources/v7_source/' + s.source_id); assert.equal(view.deterministic_format.supported, supported); assert.equal(view.deterministic_format.schema_version, (await repo.getV7Source(lead, s.source_id)).schema_version);
        }
        save('capabilities.json', cap);
      });
      let oldV7, oldV8, recoveredV8, oldHistory;
      await check('new enrollment rejects old V8 manifest while old queued recovery stays readable', async () => {
        oldHistory = await legacy(v8); const before = await count();
        await assert.rejects(repo.enqueueAnalysis(lead, { request_id: uuid(), run_id: oldHistory.run_id }), e => e.code === 'DEFINITION_ANALYSIS_SOURCE_FORMAT_UNSUPPORTED'); assert.deepEqual(await count(), before);
        oldV7 = await legacy(graph, true); oldV8 = await legacy(v8, true); recoveredV8 = await legacy(v8, true);
        // Restrict the claim selection to the recovery fixture without starting a worker.
        await pool.execute("UPDATE data_map_analysis_queue SET available_at=TIMESTAMPADD(SECOND,60,UTC_TIMESTAMP(3)) WHERE run_id<>?", [recoveredV8.run_id]);
        const claim = await repo.claimAnalysis(uuid()), task = await repo.nextAnalysisStep(claim); assert.equal(task.run_id, recoveredV8.run_id);
        await pool.execute('UPDATE data_map_analysis_queue SET lease_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE run_id=?', [recoveredV8.run_id]);
        assert.equal((await repo.recoverAnalysisQueue()).recovered, 1);
        await pool.execute('UPDATE data_map_analysis_queue SET available_at=UTC_TIMESTAMP(3)');
        save('old-manifests-before.json', [oldV7, oldV8, recoveredV8]);
      });
      await startWorker();
      let first, second;
      await check('real worker executes V7 and fences old queued/recovered V8 with no misleading discovery', async () => {
        const currentV8=await execute(v8);assert.equal(currentV8.status,'succeeded');assert.equal(currentV8.input_formats[0].format_state,'native_v8');save('native-v8-worker.json',currentV8);
        first = await execute(graph); assert.equal(first.status, 'succeeded'); assert(first.attempts[0].findings.some(f => f.rule_id === 'v7.isolated'));
        second = await execute(graph); assert((await repo.compareAnalysisRuns(lead, first.run_id, second.run_id)).counts.persistent > 0);
        for (const old of [oldV8, recoveredV8]) {
          const detail = await wait(async () => { const d = await get(old); return d.status === 'failed' ? d : null; });
          assert.equal(detail.attempts.at(-1).error_code, 'SOURCE_FORMAT_UNSUPPORTED'); assert.deepEqual(detail.attempts.at(-1).findings, []); assert.deepEqual(detail.coverage[0].checked, []);
          assert(!Object.hasOwn(detail.manifest.inputs[0].snapshot, 'schema_version')); assert.equal(detail.manifest_digest, old.manifest_digest);
          save('old-v8-' + old.run_id + '.json', detail);
        }
        const old = await get(oldV7); assert.equal(old.status, 'succeeded'); assert(!Object.hasOwn(old.manifest.inputs[0].snapshot, 'schema_version'));
        const comparison = await repo.compareAnalysisRuns(lead, old.run_id, first.run_id); assert.equal(comparison.counts.not_detected, 0); assert(comparison.comparability_reasons.includes('CHECK_SCOPE_CHANGED')); assert.equal(comparison.comparison_complete, false); save('old-new-v7-comparison.json', comparison);
        save('v7-worker-result.json', first);
      });
      await check('missing declarations malformed JSON and invalid V7 keep original format evidence', async () => {
        const invalid = document(); delete invalid.behaviors[0].behavior_ref;
        for (const d of [{}, null, Buffer.from('{broken'), invalid]) {
          const source = await upload(d), result = await execute(source); assert.equal(result.status, 'partial'); assert(result.coverage[0].missing.length); assert(result.attempts[0].findings.some(f => ['v7.format', 'v7.required'].includes(f.rule_id)));
        }
        assert.equal((await execute(v7)).status, 'succeeded');
      });
      await check('real V7/V8 preview references bind old revisions; case latest never substitutes fixed inputs', async () => {
        for (const d of [v8doc, graphDoc]) {
          const preview = await expect('contact', '/api/process-v7-preview/cases', 'POST', { document: d, source_file_name: 'P11-preview.json' }, 201);
          const source = await expect('lead', '/api/analysis/materials/references', 'POST', { request_id: uuid(), source_kind: 'preview_revision', case_id: preview.case.id, revision_id: preview.case.current_revision_id });
          const r = await expect('lead', '/api/analysis/runs', 'POST', payload(source));
          const before = await wait(async () => { const x = await expect('lead', '/api/analysis/runs/' + r.run_id); return x.status === 'succeeded' ? x : null; });
          const revised = structuredClone(d); revised.process.purpose = '仅改变案例当前合成修订';
          await expect('contact', '/api/process-v7-preview/cases/' + preview.case.id + '/revisions', 'POST', { expected_revision_no: preview.case.current_revision_no, expected_content_hash: preview.case.current_content_hash, document: revised, source_file_name: 'P11-preview-r2.json' }, 201);
          const after = await expect('lead', '/api/analysis/runs/' + r.run_id); assert.deepEqual(after, before); assert.equal(after.manifest.inputs[0].snapshot.source_ref.revision_id, String(preview.case.current_revision_id));
          save('preview-fixed-binding-'+d.schema_version+'.json', { before, after, equal: true, native_schema_preserved: true });
        }
      });
      await check('legacy mistaken V8 history remains immutable and exposes a read-only limitation', async () => {
        const a = await repo.beginAnalysisAttempt(lead, { request_id: uuid(), run_id: oldHistory.run_id, expected_revision: oldHistory.revision_no, step_key: 'v7' });
        await repo.completeAnalysisAttempt(lead, { request_id: uuid(), run_id: oldHistory.run_id, expected_revision: a.revision_no, attempt_id: a.attempt_id, status: 'partial', checked_ids: ['v7.format', 'v7.required'], error_code: 'INPUT_INCOMPLETE',
          evidence: [{ evidence_key: 'old_format', input_key: 'source', locator_kind: 'json_pointer', locator: '', note: '仅模拟旧规则误用非V7的历史证据' }],
          findings: [{ rule_id: 'v7.format', finding_type: 'material_constraint', message: '旧规则误用非V7的合成历史', subject_input_keys: ['source'], semantic_locator: 'document:schema', evidence_keys: ['old_format'] }] });
        const detail = await get(oldHistory); await repo.finishAnalysisRun(lead, { request_id: uuid(), run_id: detail.run_id, expected_revision: detail.revision_no, status: 'partial' }); oldHistory = await get(oldHistory);
        const view = await expect('lead', '/api/analysis/runs/' + oldHistory.run_id); assert.deepEqual(view.history_limitations, ['LEGACY_V7_RULE_ON_UNSUPPORTED_FORMAT']);
        const diff = await repo.compareAnalysisRuns(lead, oldHistory.run_id, first.run_id); assert.equal(diff.counts.not_detected, 0); assert(diff.comparability_reasons.includes('SOURCE_FORMAT_UNSUPPORTED')); assert.equal(diff.comparison_complete, false);
        assert.deepEqual(await get(oldHistory), oldHistory); save('legacy-v8-readback.json', { view, diff });
      });
      await stopWorker();
      await check('same request repeats concurrent identical and different bodies preserve original receipts', async () => {
        const p = payload(v7), twins = await Promise.all([expect('lead', '/api/analysis/runs', 'POST', p), expect('lead', '/api/analysis/runs', 'POST', p)]); assert.deepEqual(twins[0], twins[1]);
        assert.deepEqual(await expect('lead', '/api/analysis/runs', 'POST', p), twins[0]);
        await expect('lead', '/api/analysis/runs', 'POST', { ...p, check_scope: { ...p.check_scope, description: 'different' } }, 409);
        save('idempotency.json', { first: twins[0], repeated: twins[1] });
      });
      await check('current identity scope admin CSRF and source tampering still fail closed', async () => {
        await expect('anonymous', '/api/analysis/capabilities', 'GET', undefined, 401);
        await expect('contact', '/api/analysis/runs', 'POST', payload(v7), 403);
        await expect('adminMulti', '/api/analysis/runs', 'POST', payload(v7), 403);
        await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT 88,role_id,'global',NULL,'P11 synthetic stacked admin',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
        await expect('adminMulti', '/api/analysis/runs', 'POST', payload(v7), 404);
        await expect('outsider', '/api/analysis/runs/' + first.run_id, 'GET', undefined, 404);
        await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=92 WHERE source_id=?', [graph.source_id]);
        await expect('contact', '/api/analysis/runs/' + first.run_id, 'GET', undefined, 404);
        await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=91 WHERE source_id=?', [graph.source_id]);
        const [[row]] = await pool.execute('SELECT content_json FROM data_map_v7_sources WHERE source_id=?', [graph.source_id]);
        await pool.execute("UPDATE data_map_v7_sources SET content_json='{}' WHERE source_id=?", [graph.source_id]);
        await expect('lead', '/api/analysis/runs/' + first.run_id, 'GET', undefined, 409);
        await pool.execute('UPDATE data_map_v7_sources SET content_json=? WHERE source_id=?', [typeof row.content_json === 'string' ? row.content_json : json(row.content_json), graph.source_id]);
        assert.deepEqual(await get(first), first);
      });
      await check('receipt and queue event failures roll back whole creation; missing markers/columns return 503', async () => {
        for (const [table, operation] of [['data_map_definition_requests', 'UPDATE'], ['data_map_analysis_queue_events', 'INSERT']]) {
          const before = await count(); await pool.query(`CREATE TRIGGER p11_fault BEFORE ${operation} ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic'`);
          try { await expect('lead', '/api/analysis/runs', 'POST', payload(v7), 503); assert.deepEqual(await count(), before); } finally { await pool.query('DROP TRIGGER p11_fault'); }
        }
        const marker = require('../server/analysisQueueSchema').MIGRATION_KEY, before = await count();
        await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?', [marker]);
        try { await expect('lead', '/api/analysis/runs', 'POST', payload(v7), 503); assert.deepEqual(await count(), before); } finally { await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [marker]); }
        await pool.query('ALTER TABLE data_map_analysis_inputs RENAME COLUMN snapshot_digest TO p11_hidden_digest');
        try { await expect('lead', '/api/analysis/runs/' + first.run_id, 'GET', undefined, 503); } finally { await pool.query('ALTER TABLE data_map_analysis_inputs RENAME COLUMN p11_hidden_digest TO snapshot_digest'); }
      });
      await check('cancellation fences late results and restores no old finding', async () => {
        const run = await repo.createQueuedAnalysis(lead, payload(v7));
        await pool.execute('UPDATE data_map_analysis_queue SET available_at=TIMESTAMPADD(SECOND,60,UTC_TIMESTAMP(3)) WHERE run_id<>? AND state=\'ready\'', [run.run_id]);
        const claim = await repo.claimAnalysis(uuid()), task = await repo.nextAnalysisStep(claim);
        const result = rules.analyze(task), detail = await get(run);
        await repo.cancelQueuedAnalysis(lead, { request_id: uuid(), run_id: run.run_id, expected_revision: detail.revision_no });
        await assert.rejects(repo.completeQueuedAnalysis(claim, { ...result, request_id: uuid(), attempt_id: task.attempt_id, expected_revision: task.revision_no }), e => e.code === 'DEFINITION_ANALYSIS_QUEUE_LEASE_LOST');
        assert.equal((await get(run)).status, 'cancelled'); assert.deepEqual((await get(run)).attempts[0].findings, []);
      });
      if (!process.argv.includes('--no-browser')) {
        await require('./testHelpers/analysisFormatBrowserVerification')({ fixture, pool, repo, lead, v7, v8, unknown, first, oldHistory, output, check, save });
      }
      await check('synthetic in-memory backup restores fixed manifests evidence and history byte digests', async () => {
        const dump = backup(), before = await get(first), history = await get(oldHistory); const hash = crypto.createHash('sha256').update(dump).digest('hex');
        await pool.execute("UPDATE data_map_analysis_runs SET manifest_digest=REPEAT('0',64) WHERE run_id=?", [first.run_id]); await assert.rejects(get(first), e => e.code === 'DEFINITION_ANALYSIS_INTEGRITY_CONFLICT');
        restore(dump); assert.deepEqual(await get(first), before); assert.deepEqual(await get(oldHistory), history); save('backup-restore.json', { sha256: hash, persisted: false, restored: true, target: 'owned_synthetic_UUID_database' });
      });
      save('results.json', { passed: true, checks, external_calls: 0, owned_uuid_database: true, real_worker: true, browser: !process.argv.includes('--no-browser') ? 'Edge100%1699x828' : null, human_acceptance: false });
    } finally { await stopWorker(); save('worker-events.json', events); save('cleanup.json', { worker_stopped: !worker || worker.exitCode !== null || worker.signalCode !== null }); }
  }, { randomDatabase: true, evidenceDir: output });
}
main().catch(e => { save('failure.json', { code: e.code, message: e.message, stack: e.stack, checks }); console.error(e); process.exitCode = 1; });
