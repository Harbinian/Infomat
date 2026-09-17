// P09 storage tests on owned tmpfs MySQL and synthetic identities/materials.
// --output must be a new directory under artifacts. No worker or browser starts.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { applyDefinitions } = require('../server/dataMapDefinitionMigration');
const { applyV7Mappings } = require('../server/v7MappingMigration');
const { applyDesignHandoffs } = require('../server/designHandoffMigration');
const { applyAnalysisRuns, inspectAnalysisRuns, tables, MIGRATION_KEY } = require('../server/analysisRunMigration');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const { digest, json } = require('../server/dataMapDefinitionValues');
const arg = process.argv.indexOf('--output');
assert(arg >= 0 && process.argv[arg + 1]);
const output = path.resolve(process.argv[arg + 1]);
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const checks = [], uuid = () => crypto.randomUUID();
const save = (name, v) => fs.writeFileSync(path.join(output, name), JSON.stringify(v, null, 2));
const rejects = (p, expected) => assert.rejects(p, e => { assert.equal(e.code, expected); return true; });
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
async function main() {
  const oldFlags = Object.fromEntries(['PROCESS_V7_PREVIEW_ENABLED', 'PROCESS_V7_FORMAL_ENABLED'].map(k => [k, process.env[k]]));
  for (const k of Object.keys(oldFlags)) process.env[k] = '1';
  try { await withStage05Fixture(async ({ pool, fixture, expect, backup, restore }) => {
    const repo = makeDataMapDefinitionRepository(pool), lead = { personId: 82, accountId: 182, authVersion: 1 }, contact = { personId: 83, accountId: 183, authVersion: 1 };
    const outsider = { personId: 86, accountId: 186, authVersion: 1 }, admin = { personId: 88, accountId: 188, authVersion: 1 };
    const cfg = pool.pool.config.connectionConfig;
    const cliEnv = isolatedEnvironment({ MYSQL_HOST: cfg.host, MYSQL_PORT: String(cfg.port), MYSQL_USER: cfg.user, MYSQL_PASSWORD: cfg.password, MYSQL_DATABASE: cfg.database });
    const cli = (args, env = cliEnv) => execFileSync(process.execPath, [path.join(__dirname, 'manage-analysis-runs.js'), ...args], { env, encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const target = cfg.host + ':' + cfg.port + '/' + cfg.database;
    const db = await pool.getConnection();
    try { await applyDefinitions(db); await applyV7Mappings(db); await applyDesignHandoffs(db); } finally { db.release(); }
    const obj = await repo.saveManaged(contact, { request_id: uuid(), entity_type: 'object', definition: { name: 'P09合成订单' } });
    const field = await repo.saveManaged(contact, { request_id: uuid(), entity_type: 'field', object_id: obj.entity_id, object_version_id: obj.version_id, definition: { name: '订单编号', data_type: 'text' } });
    const document = structuredClone(fixture.document);
    document.data_objects = [{ data_ref: 'order', data_name: '合成订单', description: '仅用于分析存储测试', information_type: 'business_conclusion', fields: [{ field_ref: 'order_code', field_name: '订单编号', field_type: '文本', definition: '合成唯一编号' }], behavior_links: [], source_relations: [], lifecycle: { applicability: 'pending_confirmation', entry_state: { business_validity: 'pending_confirmation', custody: 'pending_confirmation', identifiability_applicability: 'pending_confirmation', identifiability: 'pending_confirmation' }, routes: [], analysis: { analyzer_version: '', source_fingerprint: '', status: 'not_analyzed' }, decision_reason: '', decision_notes: '' } }];
    const source = await repo.registerV7Source(lead, { request_id: uuid(), source_kind: 'uploaded_material', original_name: 'P09-synthetic.json' }, Buffer.from(JSON.stringify(document)));
    const meta = await repo.getV7Source(lead, source.source_id); assert.equal(meta.validation_status, 'valid');
    const mappingBase = { source_digest: meta.content_digest, local_object_ref: 'order', local_field_ref: null, object_version_id: obj.version_id, field_version_id: null, expected_revision: 0, status: 'candidate', basis: '合成材料固定对应，未作业务认定' };
    const mapping = await repo.saveV7Mapping(lead, source.source_id, { request_id: uuid(), ...mappingBase });
    const fieldMap = await repo.saveV7Mapping(lead, source.source_id, { request_id: uuid(), ...mappingBase, local_field_ref: 'order_code', field_version_id: field.version_id });
    const handoff = await repo.saveDesignHandoff(lead, { request_id: uuid(), handoff_id: null, expected_revision: 0, definition: { title: '合成待核实设计交接', claim_status: 'analysis_pending', source: { mapping_version_id: mapping.mapping_version_id, behavior_ref: 'behavior_prepare', operations: ['deliver'] }, target: null, identifier_kind: 'unknown', identity_rule: null, identity_basis: null, delivery_condition: null, reception_requirement: null, evidence: [{ side: 'source', locator: '合成文档第 1 节', note: '待核实' }], pairs: [] } });
    const template = await repo.registerSource(contact, { request_id: uuid(), department_id: '91', parser_version: 'synthetic-template-v1', template_profile_version: 'synthetic-profile-v1', original_name: 'P09-synthetic-template.xlsx' }, Buffer.from('SYNTHETIC-NOT-A-REAL-XLSX'));
    await pool.execute("INSERT INTO data_map_source_cells(batch_id,sheet_name,cell_address,raw_type,raw_value_json) VALUES (?,'合成表','A16','string',?)", [template.batch_id, JSON.stringify('原始字符串')]);
    const c = await expect('contact', '/api/process-v7-preview/cases', 'POST', { document, source_file_name: 'P09-preview.json' }, 201);
    // Use existing public preview/formal APIs only inside this owned fixture.
    const caseId = String(c.case.id), revisionId = String(c.revision.id);
    const bind = () => ({ expected_revision_no: c.revision.revision_no, expected_content_hash: c.revision.content_hash });
    const preview = await repo.registerV7Source(lead, { request_id: uuid(), source_kind: 'preview_revision', case_id: caseId, revision_id: revisionId });
    for (const who of ['reviewA', 'reviewB']) for (const item of c.items) await expect(who, '/api/process-v7-preview/items/' + item.id + '/decision', 'POST', { ...bind(), decision: 'confirmed', basis: 'P09合成核对依据' });
    const promoted = await expect('lead', '/api/process-v7-preview/cases/' + caseId + '/promote', 'POST', { ...bind(), target: { mode: 'create', document_no: 'P09-SYNTHETIC', document_title: 'P09合成流程' } }, 201);
    const formal = { expected_revision_no: promoted.draft.revision_no, expected_content_hash: promoted.draft.content_hash };
    const submitted = await expect('contact', '/api/process-design/drafts/' + promoted.draft.id + '/submit', 'POST', formal);
    await expect('reviewA', '/api/process-design/review-tasks/' + submitted.reviewTask.id + '/decision', 'POST', { ...formal, decision: 'approve', note: '合成隔离审核' });
    const publishedResult = await expect('lead', '/api/process-design/drafts/' + promoted.draft.id + '/publish', 'POST', formal);
    const published = await repo.registerV7Source(lead, { request_id: uuid(), source_kind: 'published_version', process_version_id: String(publishedResult.process_version_id) });
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 88,role_id,'global','P09 synthetic',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
    const protectedTables = ['data_map_objects', 'data_map_fields', 'data_map_field_identities', 'data_map_definition_versions', 'data_map_source_files', 'data_map_source_cells', 'data_map_v7_sources', 'data_map_v7_mappings', 'data_map_v7_mapping_versions', 'data_map_design_handoffs', 'data_map_design_handoff_versions', 'data_map_design_handoff_refs', 'process_v7_preview_cases', 'process_v7_preview_revisions', 'process_v7_preview_review_items', 'process_v7_preview_events', 'process_design_documents', 'process_design_drafts', 'process_design_versions', 'process_design_review_tasks', 'process_governance_issues', 'mdm_todos'];
    const snapshots = async () => {
      const result = {};
      for (const t of protectedTables) {
        const [exists] = await pool.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [t]);
        result[t] = exists.length ? digest((await pool.query('SELECT * FROM ' + t))[0]) : 'absent';
      }
      return result;
    };
    const protectedBefore = await snapshots();
    const inputs = [{ input_key: 'upload', kind: 'v7_source', ref_id: source.source_id }, { input_key: 'preview', kind: 'v7_source', ref_id: preview.source_id }, { input_key: 'published', kind: 'v7_source', ref_id: published.source_id }, { input_key: 'object', kind: 'definition', ref_id: obj.version_id }, { input_key: 'field', kind: 'definition', ref_id: field.version_id }, { input_key: 'mapping', kind: 'mapping', ref_id: fieldMap.mapping_version_id }, { input_key: 'handoff', kind: 'handoff', ref_id: handoff.handoff_version_id }, { input_key: 'template', kind: 'template', ref_id: template.batch_id }];
    const payload = () => ({ request_id: uuid(), inputs, check_scope: { description: 'P09合成固定材料检查', check_ids: ['references', 'conditions', 'identifiers'] }, parser_versions: { native_v7: 'synthetic-parser-v1' }, rule_version: 'synthetic-rules-v1', steps: [{ step_key: 'read', input_keys: inputs.map(i => i.input_key), check_ids: ['references'], parser_key: 'native_v7' }, { step_key: 'relation', input_keys: ['handoff', 'mapping'], check_ids: ['conditions', 'identifiers'], parser_key: 'native_v7' }], ai_metadata: null, rerun_of_run_id: null });
    await check('missing migration fails closed; CLI requires exact target and default dry-run writes nothing', async () => {
      await rejects(repo.createAnalysisRun(lead, payload()), 'DEFINITION_ANALYSIS_MIGRATION_REQUIRED');
      const before = await inspectAnalysisRuns(pool); assert.equal(before.missing.length, 8);
      assert.deepEqual(JSON.parse(cli(['--target', target])), before);
      assert.deepEqual(JSON.parse(cli(['--inspect', '--target', target])), before);
      for (const args of [[], ['--apply', '--target', 'wrong'], ['--apply', '--inspect', '--target', target]]) assert.throws(() => cli(args));
      assert.deepEqual(await inspectAnalysisRuns(pool), before);
    });
    await check('dependency markers, interrupted DDL, empty compensation, repeat migration and drift rejection', async () => {
      const db = await pool.getConnection();
      try {
        const dependency = require('../server/designHandoffSchema').MIGRATION_KEY;
        await db.execute('DELETE FROM schema_migrations WHERE migration_key=?', [dependency]);
        await rejects(applyAnalysisRuns(db), 'DEFINITION_ANALYSIS_SCHEMA_DRIFT');
        await db.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [dependency]);
        const wrapper = { execute: (sql, args) => { if (sql.startsWith('CREATE TABLE IF NOT EXISTS data_map_analysis_attempts')) throw Error('SYNTHETIC_DDL_FAILURE'); return db.execute(sql, args); }, query: (...args) => db.query(...args) };
        await assert.rejects(applyAnalysisRuns(wrapper), /SYNTHETIC_DDL_FAILURE/);
        const interrupted = await inspectAnalysisRuns(db); assert.equal(interrupted.missing.length, 5);
        for (const t of tables.filter(t => !interrupted.missing.includes(t)).reverse()) { assert.equal(Number((await db.query('SELECT COUNT(*) n FROM ' + t))[0][0].n), 0); await db.execute('DROP TABLE ' + t); }
        await assert.rejects(applyAnalysisRuns(wrapper), /SYNTHETIC_DDL_FAILURE/);
        assert.equal((await inspectAnalysisRuns(db)).missing.length, 5);
        assert((await applyAnalysisRuns(db)).ready); assert((await applyAnalysisRuns(db)).ready);
        await db.execute('ALTER TABLE data_map_analysis_runs ADD COLUMN synthetic_drift INT');
        await rejects(applyAnalysisRuns(db), 'DEFINITION_ANALYSIS_SCHEMA_DRIFT');
        await db.execute('ALTER TABLE data_map_analysis_runs DROP COLUMN synthetic_drift');
        assert(JSON.parse(cli(['--apply', '--target', target])).ready);
        assert.deepEqual(await snapshots(), protectedBefore);
        save('migration.json', { interrupted, after: await inspectAnalysisRuns(db), repeated: true, resumed_partial_ddl: true, compensated_empty_tables: true, old_records_unchanged: true });
      } finally { db.release(); }
    });
    let run, active, historical;
    const get = r => repo.getAnalysisRun(lead, r.run_id);
    const begin = async (r, step = 'read') => repo.beginAnalysisAttempt(lead, { request_id: uuid(), run_id: r.run_id, expected_revision: (await get(r)).revision_no, step_key: step });
    const completion = async (r, a, overrides = {}) => ({ request_id: uuid(), run_id: r.run_id, expected_revision: (await get(r)).revision_no, attempt_id: a.attempt_id, status: 'succeeded', checked_ids: ['references'], error_code: null,
      evidence: [{ evidence_key: 'source', input_key: 'upload', locator_kind: 'json_pointer', locator: '/data_objects/0/fields/0', note: '合成订单编号，JSON Pointer只用于证据定位' }, { evidence_key: 'cell', input_key: 'template', locator_kind: 'document_anchor', locator: '合成表!A16', note: '原始单元格定位由合成输入声明' }],
      findings: [{ rule_id: 'references', finding_type: 'missing_basis', message: '合成发现，须人工核实', subject_input_keys: ['field', 'upload'], semantic_locator: 'data_ref=order;field_ref=order_code', evidence_keys: ['source', 'cell'] }], ...overrides });
    const finish = async (r, status) => repo.finishAnalysisRun(lead, { request_id: uuid(), run_id: r.run_id, expected_revision: (await get(r)).revision_no, status });
    await check('fixed input stages, exact ledger/mapping/handoff versions and duplicate request semantics', async () => {
      const p = payload(); run = await repo.createAnalysisRun(lead, p); assert.deepEqual(await repo.createAnalysisRun(lead, p), run);
      await rejects(repo.createAnalysisRun(lead, { ...p, rule_version: 'different' }), 'DEFINITION_IDEMPOTENCY_CONFLICT');
      const detail = await get(run); assert.equal(detail.status, 'queued'); assert.equal(detail.finished_at, null); assert.equal(detail.created_by_person_id, '82'); assert(detail.created_at.endsWith('Z'));
      const refs = Object.fromEntries(detail.manifest.inputs.map(i => [i.input_key, i.snapshot]));
      assert.equal(refs.preview.source_ref.revision_id, revisionId); assert.equal(refs.preview.raw_sha256, null); assert.equal(refs.published.source_ref.process_version_id, String(publishedResult.process_version_id));
      assert.equal(refs.mapping.field_version_id, field.version_id); assert.equal(refs.handoff.handoff_id, handoff.handoff_id); assert(refs.upload.raw_sha256);
      assert.equal(detail.manifest.inputs.some(i => i.snapshot.document || i.snapshot.content_json), false);
      await rejects(repo.createAnalysisRun(lead, { ...payload(), rerun_of_run_id: run.run_id }), 'DEFINITION_ANALYSIS_RERUN_REQUIRES_FINISHED_RUN');
      await rejects(repo.createAnalysisRun(lead, { ...payload(), inputs: [...inputs, inputs[0]] }), 'DEFINITION_ANALYSIS_DUPLICATE_KEY');
      await rejects(repo.createAnalysisRun(lead, { ...payload(), inputs: [{ ...inputs[0], ref_id: '99999999' }] }), 'DEFINITION_V7_SOURCE_NOT_FOUND');
      save('queued-run.json', detail);
    });
    await check('current identity, administrator multirole and every referenced data scope remain enforced', async () => {
      for (const who of [admin, contact, outsider]) await rejects(repo.createAnalysisRun(who, payload()), 'DEFINITION_ACCESS_DENIED');
      await rejects(repo.getAnalysisRun(outsider, run.run_id), 'DEFINITION_ACCESS_DENIED');
      assert.equal((await repo.getAnalysisRun(admin, run.run_id)).run_id, run.run_id);
      await rejects(repo.getAnalysisRun({ ...lead, authVersion: 999 }, run.run_id), 'DEFINITION_AUTH_REQUIRED');
      await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=92 WHERE source_id=?', [source.source_id]);
      await rejects(repo.getAnalysisRun(contact, run.run_id), 'DEFINITION_ACCESS_DENIED');
      await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=91 WHERE source_id=?', [source.source_id]);
    });
    await check('same revision concurrent starts yield one attempt and one conflict; exact retry is idempotent', async () => {
      const p = { request_id: uuid(), run_id: run.run_id, expected_revision: 1, step_key: 'read' };
      const result = await Promise.allSettled([repo.beginAnalysisAttempt(lead, p), repo.beginAnalysisAttempt(lead, { ...p, request_id: uuid() })]);
      assert.equal(result.filter(x => x.status === 'fulfilled').length, 1); assert.equal(result.find(x => x.status === 'rejected').reason.code, 'DEFINITION_ANALYSIS_REVISION_CONFLICT');
      active = result.find(x => x.status === 'fulfilled').value;
      if (result[0].status === 'fulfilled') assert.deepEqual(await repo.beginAnalysisAttempt(lead, p), active);
      assert.equal((await get(run)).attempts.length, 1);
    });
    await check('invalid pointers, unknown evidence, uncovered rules, index identities and false full coverage are rejected', async () => {
      const p = await completion(run, active), before = await get(run);
      await rejects(repo.completeAnalysisAttempt(lead, { ...p, evidence: [{ ...p.evidence[0], locator: '/missing' }] }), 'DEFINITION_ANALYSIS_POINTER_NOT_FOUND');
      await rejects(repo.completeAnalysisAttempt(lead, { ...p, findings: [{ ...p.findings[0], evidence_keys: ['absent'] }] }), 'DEFINITION_ANALYSIS_FINDING_REFERENCE_INVALID');
      await rejects(repo.completeAnalysisAttempt(lead, { ...p, findings: [{ ...p.findings[0], rule_id: 'conditions' }] }), 'DEFINITION_ANALYSIS_FINDING_RULE_NOT_COVERED');
      await rejects(repo.completeAnalysisAttempt(lead, { ...p, findings: [{ ...p.findings[0], semantic_locator: '/data_objects/0' }] }), 'DEFINITION_ANALYSIS_SEMANTIC_ID_REQUIRED');
      await rejects(repo.completeAnalysisAttempt(lead, { ...p, checked_ids: [] }), 'DEFINITION_ANALYSIS_COVERAGE_INVALID');
      await rejects(repo.completeAnalysisAttempt(lead, { ...p, issue_id: '1' }), 'DEFINITION_ANALYSIS_PROPERTY_INVALID');
      assert.deepEqual(await get(run), before);
    });
    await check('finding link failure rolls back evidence, findings, coverage and idempotency receipt atomically', async () => {
      const p = await completion(run, active), before = await get(run);
      const receipts = Number((await pool.execute('SELECT COUNT(*) n FROM data_map_definition_requests'))[0][0].n);
      await pool.query("CREATE TRIGGER p09_failure BEFORE INSERT ON data_map_analysis_finding_evidence FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_P09_FAILURE'");
      await assert.rejects(repo.completeAnalysisAttempt(lead, p)); await pool.query('DROP TRIGGER p09_failure');
      assert.deepEqual(await get(run), before); assert.equal(Number((await pool.execute('SELECT COUNT(*) n FROM data_map_definition_requests'))[0][0].n), receipts);
      const saved = await repo.completeAnalysisAttempt(lead, p); assert.deepEqual(await repo.completeAnalysisAttempt(lead, p), saved);
      await rejects(repo.completeAnalysisAttempt(lead, { ...p, findings: [] }), 'DEFINITION_IDEMPOTENCY_CONFLICT');
    });
    await check('same-run failed and partial retries append attempts while prior successful output is retained', async () => {
      const first = (await get(run)).attempts[0];
      let a = await begin(run, 'relation');
      await repo.completeAnalysisAttempt(lead, await completion(run, a, { status: 'failed', checked_ids: [], error_code: 'SYNTHETIC_INPUT_MISSING', evidence: [], findings: [] }));
      a = await begin(run, 'relation');
      await repo.completeAnalysisAttempt(lead, await completion(run, a, { status: 'partial', checked_ids: ['conditions'], error_code: 'SYNTHETIC_IDENTIFIERS_MISSING', evidence: [], findings: [] }));
      assert.deepEqual((await get(run)).attempts[0], first);
      const late = await completion(run, a, { checked_ids: ['conditions', 'identifiers'], evidence: [], findings: [] });
      const next = await begin(run, 'relation');
      await rejects(repo.completeAnalysisAttempt(lead, { ...late, expected_revision: next.revision_no }), 'DEFINITION_ANALYSIS_ATTEMPT_STATE_CONFLICT');
      await repo.completeAnalysisAttempt(lead, await completion(run, next, { checked_ids: ['conditions', 'identifiers'], evidence: [], findings: [] }));
      await finish(run, 'succeeded'); historical = await get(run);
      assert.equal(historical.attempts.length, 4); assert.equal(historical.status, 'succeeded'); assert(historical.finished_at.endsWith('Z'));
      assert.deepEqual(historical.attempts[0], first); assert.equal(first.findings[0].issue_id, null); assert.equal(first.findings[0].verification_status, 'pending_verification');
      save('synthetic-run-and-evidence.json', historical);
    });
    await check('active rerun is explicit; new findings never overwrite old instances or imply issue closure', async () => {
      const p = { ...payload(), rerun_of_run_id: run.run_id }, rerun = await repo.createAnalysisRun(lead, p);
      assert.notEqual(rerun.run_id, run.run_id); assert.equal((await get(rerun)).rerun_of_run_id, run.run_id);
      let a = await begin(rerun); const result = await completion(rerun, a); result.findings[0].message = '标题改写后的同一合成发现';
      await repo.completeAnalysisAttempt(lead, result);
      const finding = (await get(rerun)).attempts[0].findings[0];
      assert.notEqual(finding.finding_id, historical.attempts[0].findings[0].finding_id); assert.equal(finding.comparison_key, historical.attempts[0].findings[0].comparison_key);
      await finish(rerun, 'partial'); assert.equal((await get(rerun)).steps.find(s => s.step_key === 'relation').status, 'queued');
      const emptyRun = await repo.createAnalysisRun(lead, { ...payload(), rerun_of_run_id: run.run_id });
      a = await begin(emptyRun); await repo.completeAnalysisAttempt(lead, await completion(emptyRun, a, { evidence: [], findings: [] })); await finish(emptyRun, 'partial');
      assert.deepEqual(await get(run), historical);
    });
    await check('cancelled/failed runs keep explicit uncovered steps and terminal runs reject late writes', async () => {
      for (const start of [false, true]) {
        const r = await repo.createAnalysisRun(lead, payload()), a = start ? await begin(r) : null;
        await finish(r, 'cancelled'); const detail = await get(r);
        assert.equal(detail.status, 'cancelled'); assert(detail.steps.every(s => s.status === 'cancelled'));
        await rejects(begin(r), 'DEFINITION_ANALYSIS_RUN_TERMINAL');
        if (a) await rejects(repo.completeAnalysisAttempt(lead, await completion(r, a)), 'DEFINITION_ANALYSIS_RUN_TERMINAL');
      }
      const r = await repo.createAnalysisRun(lead, payload()); await rejects(finish(r, 'succeeded'), 'DEFINITION_ANALYSIS_RUN_COVERAGE_CONFLICT'); await finish(r, 'failed');
      assert.equal((await get(r)).status, 'failed');
    });
    if (process.argv.includes('--p13')) await require('./testHelpers/analysisComparisonVerification')({ repo, lead, pool, run, historical, payload, begin, completion, finish, get, check, save });
    await check('database unique keys, same-run references and pending-only findings block invalid direct writes', async () => {
      const a = historical.attempts[0], f = a.findings[0];
      await assert.rejects(pool.execute("INSERT INTO data_map_analysis_steps(run_id,step_key,status,attempt_no) VALUES (?,'read','queued',0)", [run.run_id]), e => e.code === 'ER_DUP_ENTRY');
      await assert.rejects(pool.execute("INSERT INTO data_map_analysis_attempts(run_id,step_key,attempt_no,status,actor_person_id,started_at) VALUES (?,'read',1,'running',82,UTC_TIMESTAMP(3))", [run.run_id]), e => e.code === 'ER_DUP_ENTRY');
      await assert.rejects(pool.execute('INSERT INTO data_map_analysis_findings(run_id,attempt_id,comparison_key,verification_status,snapshot_json,snapshot_digest) SELECT run_id,attempt_id,comparison_key,verification_status,snapshot_json,snapshot_digest FROM data_map_analysis_findings WHERE finding_id=?', [f.finding_id]), e => e.code === 'ER_DUP_ENTRY');
      await assert.rejects(pool.execute('INSERT INTO data_map_analysis_evidence(run_id,attempt_id,evidence_key,input_key,snapshot_json,snapshot_digest) SELECT run_id,attempt_id,evidence_key,input_key,snapshot_json,snapshot_digest FROM data_map_analysis_evidence WHERE evidence_id=?', [a.evidence[0].evidence_id]), e => e.code === 'ER_DUP_ENTRY');
      await assert.rejects(pool.execute("UPDATE data_map_analysis_inputs SET source_id=99999999 WHERE run_id=? AND input_key='upload'", [run.run_id]), e => e.code === 'ER_NO_REFERENCED_ROW_2');
      await assert.rejects(pool.execute("UPDATE data_map_analysis_inputs SET definition_version_id=? WHERE run_id=? AND input_key='upload'", [obj.version_id, run.run_id]), e => e.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
      await assert.rejects(pool.execute('UPDATE data_map_analysis_findings SET issue_id=1 WHERE finding_id=?', [f.finding_id]), e => e.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
      await assert.rejects(pool.execute('INSERT INTO data_map_analysis_finding_evidence(run_id,attempt_id,finding_id,evidence_key) VALUES (?,?,?,?)', [run.run_id, historical.attempts[1].attempt_id, f.finding_id, 'source']), e => e.code === 'ER_NO_REFERENCED_ROW_2');
      await assert.rejects(pool.execute("UPDATE data_map_analysis_runs SET status='invented' WHERE run_id=?", [run.run_id]), e => e.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
      assert.deepEqual(await get(run), historical);
    });
    await check('full backup restore detects content/reference deletion and restores every prior result', async () => {
      const dump = backup(), hash = crypto.createHash('sha256').update(dump).digest('hex');
      await pool.execute("UPDATE data_map_analysis_evidence SET snapshot_json=JSON_SET(snapshot_json,'$.note','corrupt') WHERE evidence_id=?", [historical.attempts[0].evidence[0].evidence_id]);
      await rejects(get(run), 'DEFINITION_ANALYSIS_INTEGRITY_CONFLICT'); restore(dump); assert.deepEqual(await get(run), historical);
      await pool.execute('DELETE FROM data_map_analysis_finding_evidence WHERE finding_id=? LIMIT 1', [historical.attempts[0].findings[0].finding_id]);
      await rejects(get(run), 'DEFINITION_ANALYSIS_INTEGRITY_CONFLICT'); restore(dump); assert.deepEqual(await get(run), historical);
      await pool.execute("UPDATE data_map_analysis_inputs SET snapshot_json=JSON_SET(snapshot_json,'$.ref_id','999') WHERE run_id=? AND input_key='field'", [run.run_id]);
      await rejects(get(run), 'DEFINITION_ANALYSIS_INTEGRITY_CONFLICT'); restore(dump); assert.deepEqual(await get(run), historical);
      save('backup-restore.json', { sha256: hash, backup_persisted: false, restored: true, protected_after_restore: await snapshots() });
    });
    await check('old ledger, V7, handoff, formal issue and todo records stay unchanged', async () => {
      assert.deepEqual(await snapshots(), protectedBefore);
      save('protected-records.json', { before: protectedBefore, after: await snapshots(), equal: true });
    });
    await check('BIGINT run identities remain exact and optional AI version metadata does not execute a model', async () => {
      await pool.execute('ALTER TABLE data_map_analysis_runs AUTO_INCREMENT=9007199254740993');
      const p = { ...payload(), ai_metadata: { provider: 'synthetic-offline', model: 'fixture', model_version: 'v1', prompt_version: 'v1', prompt_sha256: 'a'.repeat(64), adapter_version: 'v1' } };
      const r = await repo.createAnalysisRun(lead, p); assert.equal(r.run_id, '9007199254740993');
      const detail = await get(r); assert.deepEqual(detail.manifest.ai_metadata, p.ai_metadata); assert.equal(detail.status, 'queued');
      await finish(r, 'cancelled'); assert.equal((await get(r)).run_id, r.run_id);
      await rejects(repo.createAnalysisRun(lead, { ...payload(), ai_metadata: { ...p.ai_metadata, api_key: 'must-not-be-accepted' } }), 'DEFINITION_ANALYSIS_PROPERTY_INVALID');
      await rejects(repo.createAnalysisRun(lead, { ...payload(), inputs: [{ ...inputs[0], ref_id: Number('9007199254740993') }] }), 'DEFINITION_ID_INVALID');
      assert.deepEqual(await get(run), historical);
    });
    await check('new ledger and mapping revisions retain old run bindings; unavailable references never mean resolved', async () => {
      const field2 = await repo.saveManaged(contact, { request_id: uuid(), entity_type: 'field', entity_id: field.entity_id, expected_revision: field.revision_no, object_id: obj.entity_id, object_version_id: obj.version_id, definition: { name: '合成订单编号新名称' } });
      assert.notEqual(field2.version_id, field.version_id);
      await repo.saveV7Mapping(lead, source.source_id, { request_id: uuid(), ...mappingBase, expected_revision: 1, basis: '新映射修订不修改原运行' });
      assert.deepEqual(await get(run), historical);
      process.env.PROCESS_V7_PREVIEW_ENABLED = '0'; await rejects(get(run), 'DEFINITION_V7_PREVIEW_DISABLED'); process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
      await pool.execute("UPDATE data_map_v7_sources SET content_json=JSON_SET(content_json,'$.process.process_name','SYNTHETIC_CORRUPTION') WHERE source_id=?", [source.source_id]);
      await rejects(get(run), 'DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT');
      await pool.execute('UPDATE data_map_v7_sources SET content_json=? WHERE source_id=?', [JSON.stringify(document), source.source_id]);
      assert.deepEqual(await get(run), historical);
    });
    assert((await inspectAnalysisRuns(pool)).ready);
    save('results.json', { passed: true, step: 'P09', checks, formal_environment: false, worker_started: false, human_acceptance: false });
  }, { evidenceDir: output }); }
  finally { for (const [k, v] of Object.entries(oldFlags)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
main().catch(e => { save('failure.json', { code: e.code, message: e.message, stack: e.stack, inspection: e.inspection, checks }); console.error(e.code || e.message); process.exitCode = 1; });
