// Synthetic fixed uploads + owned tmpfs MySQL + real independent Node worker.
// --output must be a new artifacts directory; all owned resources close in finally.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const { applyDefinitions } = require('../server/dataMapDefinitionMigration');
const { applyV7Mappings } = require('../server/v7MappingMigration');
const { applyDesignHandoffs } = require('../server/designHandoffMigration');
const { applyAnalysisRuns } = require('../server/analysisRunMigration');
const { applyAnalysisQueue } = require('../server/analysisQueueMigration');
const { VERSION, PARSER, CHECKS, catalog } = require('../server/v7AnalysisRules');
const { document, node, edge, binding } = require('./testHelpers/v7AnalysisSamples');
const { digest } = require('../server/dataMapDefinitionValues');
const arg = process.argv.indexOf('--output'), output = path.resolve(process.argv[arg + 1] || '.');
assert(arg >= 0 && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const save = (n, v) => fs.writeFileSync(path.join(output, n), JSON.stringify(v, null, 2));
const checks = [], uuid = () => crypto.randomUUID(), sleep = ms => new Promise(r => setTimeout(r, ms));
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function main() {
  await withStage05Fixture(async ({ pool }) => {
    const repo = makeDataMapDefinitionRepository(pool), lead = { personId: 82, accountId: 182, authVersion: 1 };
    const c = pool.pool.config.connectionConfig;
    const env = isolatedEnvironment({ MYSQL_HOST: c.host, MYSQL_PORT: String(c.port), MYSQL_USER: c.user, MYSQL_PASSWORD: c.password, MYSQL_DATABASE: c.database });
    let child;
    const events = [];
    async function waitFor(fn, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(50); } throw Error('TEST_TIMEOUT'); }
    const get = r => repo.getAnalysisRun(lead, r.run_id);
    const upload = d => repo.registerV7Source(lead, { request_id: uuid(), source_kind: 'uploaded_material', original_name: 'P11-synthetic.json' }, Buffer.isBuffer(d) ? d : Buffer.from(JSON.stringify(d)));
    const payload = (source, ids = CHECKS) => ({ request_id: uuid(), inputs: [{ input_key: 'source', kind: 'v7_source', ref_id: source.source_id }],
      check_scope: { description: 'P11合成V7材料确定性检查，不作业务认定', check_ids: ids }, rule_version: VERSION, parser_versions: { [PARSER]: VERSION },
      steps: [{ step_key: 'v7', parser_key: PARSER, input_keys: ['source'], check_ids: ids }] });
    async function execute(source, options = {}) {
      const r = await repo.createAnalysisRun(lead, { ...payload(source), ...options });
      await repo.enqueueAnalysis(lead, { request_id: uuid(), run_id: r.run_id, policy: { lease_ms: 5000, timeout_ms: 20000 } });
      return waitFor(async () => { const value = await get(r); return ['succeeded', 'partial', 'failed'].includes(value.status) ? value : null; });
    }
    try {
      const db = await pool.getConnection();
      try { for (const apply of [applyDefinitions, applyV7Mappings, applyDesignHandoffs, applyAnalysisRuns, applyAnalysisQueue]) await apply(db); } finally { db.release(); }
      const d = document(); d.flow_relations[0].relation_type = 'condition'; d.behaviors.push(node('behavior_isolated')); d.behaviors[1].node_type = 'decision';
      const source = await upload(d), badBinding = binding(); badBinding.forms[0].areas[0].items[0].data_field_ref = 'field_b';
      const sources = { normal: await upload(document()), graph: source, binding: await upload(badBinding), malformed: await upload({}), unparsed: await upload(Buffer.from('{broken')), null: await upload(null) };
      const duplicate = document(); duplicate.behaviors.push({ ...duplicate.behaviors[0] }); sources.duplicate = await upload(duplicate);
      const dangling = document(); dangling.flow_relations[0].to_behavior_ref = 'behavior_missing'; sources.dangling = await upload(dangling);
      const loop = document(); loop.flow_relations.push(edge('relation_ba', 'behavior_b', 'behavior_a', 'loop', '合成返回条件')); sources.loop = await upload(loop);
      const protectedTables = ['data_map_v7_sources', 'process_v7_preview_cases', 'process_v7_preview_revisions', 'process_design_versions', 'data_map_definition_versions', 'process_governance_issues', 'mdm_todos'];
      const snapshot = async () => Object.fromEntries(await Promise.all(protectedTables.map(async t => {
        const [exists] = await pool.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [t]);
        return [t, exists.length ? digest((await pool.query('SELECT * FROM ' + t))[0]) : 'absent'];
      })));
      const before = await snapshot();
      await check('manifest rejects unknown rule, disabled reachability, AI, wrong parser and non-V7 inputs', async () => {
        for (const body of [{ ...payload(source, ['v7.unreachable']) }, { ...payload(source), rule_version: 'unknown' },
          { ...payload(source), parser_versions: { [PARSER]: 'unknown' } },
          { ...payload(source), ai_metadata: { provider: 'disabled', model: 'disabled', model_version: 'none', prompt_version: 'none', prompt_sha256: 'a'.repeat(64), adapter_version: 'none' } }]) {
          const r = await repo.createAnalysisRun(lead, body);
          await assert.rejects(repo.enqueueAnalysis(lead, { request_id: uuid(), run_id: r.run_id }), e => e.code === 'DEFINITION_ANALYSIS_QUEUE_ADAPTER_NOT_ENABLED');
        }
        const o = await repo.saveManaged({ personId: 83, accountId: 183, authVersion: 1 }, { request_id: uuid(), entity_type: 'object', definition: { name: '合成非V7输入' } });
        const body = payload(source); body.inputs = [{ input_key: 'source', kind: 'definition', ref_id: o.version_id }];
        const r = await repo.createAnalysisRun(lead, body);
        await assert.rejects(repo.enqueueAnalysis(lead, { request_id: uuid(), run_id: r.run_id }), e => e.code === 'DEFINITION_ANALYSIS_QUEUE_ADAPTER_NOT_ENABLED');
        // The test itself created this synthetic ledger definition; update its protected baseline.
        before.data_map_definition_versions = (await snapshot()).data_map_definition_versions;
      });
      child = fork(path.join(__dirname, 'analysis-worker.js'), ['start', '--target', `${c.host}:${c.port}/${c.database}`], { env, silent: true, windowsHide: true, execArgv: [] });
      child.stdout.on('data', data => { for (const line of String(data).trim().split('\n')) { try { events.push(JSON.parse(line)); } catch {} } });
      child.stderr.on('data', data => events.push({ error: String(data) }));
      await waitFor(() => events.some(e => e.event === 'worker_started'));
      let first;
      await check('real worker persists findings, fixed versions, evidence, coverage and pending status', async () => {
        first = await execute(source); assert.equal(first.status, 'succeeded');
        const a = first.attempts[0]; assert.equal(a.findings.length, 3); assert.equal(a.coverage.missing.length, 0);
        assert.deepEqual(a.findings.map(f => f.rule_id).sort(), ['v7.branch_condition', 'v7.exit', 'v7.isolated']);
        for (const f of a.findings) { assert.equal(f.issue_id, null); assert.equal(f.verification_status, 'pending_verification'); assert.equal(f.rule_version, VERSION); }
        for (const e of a.evidence) { assert.equal(e.fixed_reference.ref_id, source.source_id); assert.equal(e.fixed_reference.content_digest, first.manifest.inputs[0].snapshot.content_digest); assert.equal(e.locator_validation, 'resolved'); }
        save('graph-results.json', first);
      });
      await check('identical fixed input rerun keeps semantic comparison keys despite new instance IDs', async () => {
        const second = await execute(source, { rerun_of_run_id: first.run_id });
        const normalize = r => r.attempts[0].findings.map(({ finding_id, ...f }) => f).sort((a, b) => a.comparison_key.localeCompare(b.comparison_key));
        assert.deepEqual(normalize(first), normalize(second));
        assert.notEqual(first.attempts[0].findings[0].finding_id, second.attempts[0].findings[0].finding_id);
        assert.equal(first.attempts[0].result_digest, second.attempts[0].result_digest);
        save('rerun-results.json', second);
      });
      await check('normal and legal loop worker runs succeed with no false business finding', async () => {
        for (const key of ['normal', 'loop']) { const r = await execute(sources[key]); assert.equal(r.status, 'succeeded'); assert.equal(r.attempts[0].findings.length, 0); save(key + '.json', r); }
      });
      await check('shared validator detects duplicate, dangling and wrong field owner without running graph guesses', async () => {
        for (const [key, rule] of [['duplicate', 'v7.duplicate'], ['dangling', 'v7.local_integrity'], ['binding', 'v7.field_binding']]) {
          const r = await execute(sources[key]); assert.equal(r.status, 'partial'); assert(r.attempts[0].findings.some(f => f.rule_id === rule)); assert(r.coverage[0].missing.includes('v7.isolated')); save(key + '.json', r);
        }
      });
      await check('insufficient and unparsed sources persist explicit partial coverage, never schema success', async () => {
        for (const key of ['malformed', 'unparsed', 'null']) {
          const r = await execute(sources[key]); assert.equal(r.status, 'partial'); assert.equal(r.attempts.length, 1); assert(r.coverage[0].missing.length); save(key + '.json', r);
        }
      });
      await check('identity, scope and immutable source rechecked, prior findings preserved', async () => {
        await assert.rejects(repo.getAnalysisRun({ personId: 86, accountId: 186, authVersion: 1 }, first.run_id), e => e.code === 'DEFINITION_ACCESS_DENIED');
        await assert.rejects(repo.getAnalysisRun({ ...lead, authVersion: 999 }, first.run_id), e => e.code === 'DEFINITION_AUTH_REQUIRED');
        const [[row]] = await pool.execute('SELECT content_json FROM data_map_v7_sources WHERE source_id=?', [source.source_id]);
        await pool.execute("UPDATE data_map_v7_sources SET content_json='{}' WHERE source_id=?", [source.source_id]);
        try { await assert.rejects(get(first), e => e.code === 'DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT'); }
        finally { await pool.execute('UPDATE data_map_v7_sources SET content_json=? WHERE source_id=?', [JSON.stringify(typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json), source.source_id]); }
        assert.deepEqual(await get(first), first);
        assert.deepEqual(await snapshot(), before); save('protected-assets.json', before);
      });
      const [[worker]] = await pool.execute('SELECT runtime_json FROM data_map_analysis_workers WHERE worker_id=?', [events.find(e => e.event === 'worker_started').worker_id]);
      save('worker-runtime.json', worker); save('catalog.json', catalog);
      save('results.json', { passed: true, checks, real_worker_process: true, owned_mysql: true, no_formal_decisions: true });
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.send('stop');
        const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
        await exited; clearTimeout(timer);
      }
      save('worker-events.json', events); save('cleanup.json', { child_stopped: !child || child.exitCode !== null || child.signalCode !== null });
    }
  });
}
main().catch(e => { save('failure.json', { code: e.code, message: e.message, stack: e.stack, checks }); console.error(e); process.exitCode = 1; });
