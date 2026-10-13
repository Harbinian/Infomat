// P25/03+08: explicit synthetic relation set, owned UUID/tmpfs MySQL and loopback HTTP.
// Input: --output <new artifacts directory>. No private env, business services or AI.
// Only the fixture migrates its own database; runtime/worker have no DDL permission.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { fork } = require('node:child_process'), { once } = require('node:events');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const { digest, json } = require('../server/dataMapDefinitionValues');
const rules = require('../server/handoffAnalysisRules');
const arg = process.argv.indexOf('--output'), output = path.resolve(process.argv[arg + 1] || '');
assert(arg >= 0 && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const uuid = () => crypto.randomUUID(), checks = [], observations = [];
const save = (name, value) => fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(value, null, 2));
const check = async (name, fn) => { await fn(); checks.push(name); save('progress', { checks, observations }); console.log('PASS ' + name); };
const wait = async fn => { const until = Date.now() + 55000; while (Date.now() < until) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 80)); } throw Error('FIXED_SET_WAIT_TIMEOUT'); };
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const body = (definition, handoff = null, revision = 0, request_id = uuid()) => ({ request_id, handoff_id: handoff, expected_revision: revision, definition });
const convert = () => Object.fromEntries(['field', 'format', 'enum', 'unit', 'version'].map(k => [k, { mode: 'same', rule: '', basis: 'SYNTHETIC 固定字段对照 ' + k } ]));
async function main() {
 await withStage05Fixture(async ({ pool, fixture, expect, request, backup, restore }) => {
  const repo = makeDataMapDefinitionRepository(pool), lead = { personId: 82, accountId: 182, authVersion: 1 };
  const root = '/api/design-handoffs', api = '/api/analysis';
  const get = (suffix, who = 'lead', status = 200) => expect(who, root + suffix, 'GET', undefined, status);
  const post = (payload, who = 'lead', status = 200) => expect(who, root, 'POST', payload, status);
  const ag = (suffix, who = 'lead', status = 200) => expect(who, api + suffix, 'GET', undefined, status);
  let worker, browser, context, page, uploadContext;
  const events = [], pageErrors = [], consoleErrors = [], geometry = [], httpErrors = [], responseReads = [];
  const pw = runtime();
  const protectedTables = ['process_design_documents', 'process_design_drafts', 'process_design_versions', 'process_v7_preview_cases', 'process_v7_preview_revisions', 'process_v7_preview_events', 'process_governance_issues', 'mdm_todos'];
  const tableHashes = async tables => Object.fromEntries(await Promise.all(tables.map(async t => [t, digest((await pool.query('SELECT * FROM ' + t + ' ORDER BY 1'))[0])])));
  const counts = async () => Object.fromEntries(await Promise.all(['data_map_design_handoffs', 'data_map_design_handoff_versions', 'data_map_design_handoff_refs', 'data_map_definition_requests'].map(async t => [t, String((await pool.query('SELECT COUNT(*) n FROM ' + t))[0][0].n)])));
  try {
   await check('owned missing P08 marker/table is 503 with zero startup DDL', async () => {
    await get('', 'lead', 503);
    assert.equal((await pool.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_design_handoffs'"))[0].length, 0);
   });
   const connection = await pool.getConnection();
   try { for (const [mod, method] of [['dataMapDefinitionMigration', 'applyDefinitions'], ['v7MappingMigration', 'applyV7Mappings'], ['designHandoffMigration', 'applyDesignHandoffs'], ['analysisRunMigration', 'applyAnalysisRuns'], ['analysisQueueMigration', 'applyAnalysisQueue'], ['analysisIssueMigration', 'applyAnalysisIssues']]) await require('../server/' + mod)[method](connection); } finally { connection.release(); }
   uploadContext = await pw.request.newContext({ baseURL: fixture.baseURL });
   assert.equal((await uploadContext.post('/api/org/login', { data: { loginName: 'SYNTHETIC_lead', password: fixture.loginPassword } })).status(), 200);
   const csrf = (await (await uploadContext.get('/api/csrf-token')).json()).csrfToken;
   const define = b => expect('contact', '/api/data-map-definitions/save', 'POST', { request_id: uuid(), ...b });
   const object = await define({ entity_type: 'object', definition: { name: '同名合成记录', business_meaning: '本集合的稳定合成记录身份，非正式主数据' } });
   const field = await define({ entity_type: 'field', object_id: object.entity_id, object_version_id: object.version_id, definition: { name: '记录编号', data_type: 'text', required: true, enum_values: [] } });
   const other = await define({ entity_type: 'object', definition: { name: '同名合成记录', business_meaning: '支持触点独立身份，不合并' } });
   const otherField = await define({ entity_type: 'field', object_id: other.entity_id, object_version_id: other.version_id, definition: { name: '记录编号', data_type: 'text', required: true, enum_values: [] } });
   async function source(key, dept, obj = object, f = field, nativeV8 = false, revision = 1) {
    const document = nativeV8 ? require('../../structured-output-service/server').createEmptyProcessGovernanceDocument() : structuredClone(fixture.document);
    if (nativeV8) { document.process = { ...fixture.document.process }; document.terms = structuredClone(fixture.document.terms); document.behaviors = structuredClone(fixture.document.behaviors); document.flow_relations = structuredClone(fixture.document.flow_relations); }
    document.process.process_ref = 'process_set_' + key; document.process.process_name = '合成集合' + key + '流程'; document.process.owning_department = dept;
    if (revision > 1) document.process.purpose = 'SYNTHETIC revised source material ' + revision;
    document.process.scope = 'SYNTHETIC固定集合技术场景：起点A接收至C设计接收；B返回A修订，D仅支持触点；无企业批准。';
    // Keep an explicit second department; the existing zero-cross-department
    // pending gate is not waived for a fixture.
    for (const b of document.behaviors) b.current_actor_role = (b.behavior_ref === 'behavior_prepare' ? dept : dept === '合成甲部' ? '合成乙部' : '合成甲部') + '经办人';
    document.data_objects = [{ data_ref: 'data_record', data_name: '同名合成记录', description: '仅合成集合验证', information_type: 'business_conclusion',
      fields: [{ field_ref: 'field_record_id', field_name: '记录编号', field_type: '文本', definition: '合成固定编号' }],
      behavior_links: [{ link_ref: 'link_produce', behavior_ref: 'behavior_prepare', operation: 'create', updated_field_refs: [] }, { link_ref: 'link_use', behavior_ref: 'behavior_receive', operation: 'use', updated_field_refs: [] }], source_relations: [],
      lifecycle: require('../../structured-output-service/public/process-governance-migration').pendingLifecycle() }];
    const bytes = Buffer.from(JSON.stringify(document));
    const response = await uploadContext.post('/api/v7-mappings/uploads', { headers: { 'X-CSRF-Token': csrf }, multipart: { request_id: uuid(), file: { name: 'synthetic-set-' + key + '.json', mimeType: 'application/json', buffer: bytes } } });
    assert.equal(response.status(), 200); const s = await response.json();
    const meta = await expect('lead', '/api/v7-mappings/sources/' + s.source_id, 'GET');
    save('upload-' + key + '-r' + revision, meta);
    assert.equal(meta.validation_status, 'valid', JSON.stringify(meta.validation)); assert.equal(meta.schema_version, nativeV8 ? 'process-governance-v8' : 'process-governance-v7');
    // The synthetic department is explicitly registered, never inferred from a name.
    if (dept === '合成乙部') await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=92 WHERE source_id=?', [s.source_id]);
    const base = { request_id: uuid(), source_digest: meta.content_digest, local_object_ref: 'data_record', local_field_ref: null, object_version_id: obj.version_id, field_version_id: null, expected_revision: 0, status: 'confirmed', basis: 'SYNTHETIC 明确对象字段映射，非企业对象认定' };
    const om = await expect('lead', '/api/v7-mappings/sources/' + s.source_id + '/mappings', 'POST', base);
    const fm = await expect('lead', '/api/v7-mappings/sources/' + s.source_id + '/mappings', 'POST', { ...base, request_id: uuid(), local_field_ref: 'field_record_id', field_version_id: f.version_id });
    save('source-' + key + '-r' + revision, { source: meta, document, om, fm, department_id: dept === '合成乙部' ? '92' : '91' });
    return { key, document, ...s, meta, om, fm, base, department_id: dept === '合成乙部' ? '92' : '91' };
   }
   const members = {};
   await check('four native V7 sources and explicit fixed object/field maps via existing HTTP', async () => { for (const [key, dept, o, f] of [['a', '合成甲部'], ['b', '合成乙部'], ['c', '合成乙部'], ['support', '合成甲部', other, otherField]]) members[key] = await source(key, dept, o, f); });
   function relation(a, b, key, overrides = {}) { return { title: '合成固定集合 ' + key, claim_status: 'human_confirmed',
    source: { mapping_version_id: a.om.mapping_version_id, behavior_ref: 'behavior_prepare', operations: ['produce', 'modify', 'deliver'] },
    target: { mapping_version_id: b.om.mapping_version_id, behavior_ref: 'behavior_receive', operations: ['receive', 'use'] },
    identifier_kind: 'single', identity_rule: 'SYNTHETIC 编号逐项相等；不同平台对象按独立支持触点对应，绝不合并', identity_basis: 'SYNTHETIC 显式关系清单 ' + key,
    delivery_condition: '合成编号完整时交付声明，未执行交付', reception_requirement: '合成按编号核对的设计接收条件，未执行实际接收',
    evidence: [{ side: 'source', locator: 'SYNTHETIC ' + a.key + ' /data_objects/0', note: '材料声明定位，未核对企业原件' }, { side: 'target', locator: 'SYNTHETIC ' + b.key + ' /data_objects/0', note: '材料声明定位，未核对企业原件' }],
    pairs: [{ source_mapping_version_id: a.fm.mapping_version_id, target_mapping_version_id: b.fm.mapping_version_id, identifier: true, checks: convert() }], ...overrides }; }
   const relations = [], expected = [['a_b', 'a', 'b', 'technical_path'], ['b_c', 'b', 'c', 'technical_path'], ['b_a_return', 'b', 'a', 'return_revision'], ['a_c_receiver', 'a', 'c', 'additional_receiver'], ['support_b', 'support', 'b', 'support_touchpoint']];
   await check('explicit stable relation list includes return, multiple receivers and independent same-name support identity', async () => {
    for (const [key, a, b, purpose] of expected) { const definition = relation(members[a], members[b], key), record = await post(body(definition)), detail = await get('/' + record.handoff_id); assert(detail.effective_confirmed); relations.push({ key, a, b, purpose, definition, record, detail }); }
    assert.notEqual(relations[4].detail.source.object_id, relations[4].detail.target.object_id);
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM data_map_objects WHERE id IN (?,?)', [object.entity_id, other.entity_id]))[0][0].n, 2);
   });
   if (process.argv.includes('--probe-unknown')) {
    browser = await pw.chromium.launch({ channel: 'msedge', headless: true }); context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 }); page = await context.newPage();
    await page.goto(fixture.baseURL + '/app/design-handoffs?handoff=' + relations[0].record.handoff_id);
    await page.locator('#login-name').fill('SYNTHETIC_lead'); await page.locator('#login-password').fill(fixture.loginPassword); await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '修订设计交接', exact: true }).click(); await page.getByLabel('交接名称', { exact: true }).fill('SYNTHETIC unknown probe');
    let sent; await page.route('**/api/design-handoffs', async route => { sent = route.request().postDataJSON(); const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort(); }, { times: 1 });
    await page.getByRole('button', { name: '保存设计关系', exact: true }).click(); await page.waitForFunction(() => !document.body.textContent.includes('正在处理设计交接…'));
    save('response-unknown-observation', { sent, actual_current: await get('/' + relations[0].record.handoff_id), visible: await page.locator('main').innerText(), input_enabled: await page.getByLabel('交接名称', { exact: true }).isEnabled() });
    assert.equal(await page.getByLabel('交接名称', { exact: true }).isEnabled(), false, 'uncertain successful write must freeze its exact request body');
    save('validation', { passed: true, probe_only: true }); return;
   }
   const protectedBefore = await tableHashes(protectedTables);
   const c = pool.pool.config.connectionConfig;
   worker = fork(path.resolve(__dirname, 'analysis-worker.js'), ['start', '--target', c.host + ':' + c.port + '/' + c.database], { env: isolatedEnvironment({ MYSQL_HOST: c.host, MYSQL_PORT: String(c.port), MYSQL_USER: 'stage05_runtime', MYSQL_PASSWORD: c.password, MYSQL_DATABASE: c.database }), silent: true, windowsHide: true, execArgv: [] });
   worker.stdout.on('data', b => { for (const line of String(b).trim().split('\n')) try { events.push(JSON.parse(line)); } catch {} });
   worker.stderr.on('data', b => observations.push({ worker_stderr: String(b).slice(0, 1000) }));
   await wait(() => events.some(e => e.event === 'worker_started'));
   function manifest(rs, description = 'SYNTHETIC 本次完整合成检查输入集合：固定五关系/四流程/两部门；技术起点A至C，返回B至A，多接收方A至B/C，support仅支持触点。不是企业主链批准或真实交接。') {
    return { request_id: uuid(), inputs: rs.map(r => ({ input_key: r.key, kind: 'handoff', ref_id: r.record.handoff_version_id })), check_scope: { description, check_ids: rules.CHECKS }, rule_version: rules.VERSION, parser_versions: { [rules.PARSER]: rules.VERSION }, steps: rs.map(r => ({ step_key: r.key, input_keys: [r.key], parser_key: rules.PARSER, check_ids: rules.CHECKS })) };
   }
   const execute = async payload => { const created = await expect('lead', api + '/runs', 'POST', payload); const result = await wait(async () => { const r = await repo.getAnalysisRun(lead, created.run_id); return ['partial', 'succeeded', 'failed', 'cancelled'].includes(r.status) ? r : null; }); return { created, result }; };
   let first, second, partial;
   await check('complete synthetic input set bound in manifest; real worker checks one relation per step and keeps scope/chain/unit missing', async () => {
    first = await execute(manifest(relations)); assert.equal(first.result.status, 'partial'); assert.equal(first.result.manifest.inputs.length, 5); assert.equal(first.result.attempts.length, 5);
    for (const coverage of first.result.coverage) for (const rule of ['handoff.unit', 'handoff.scope', 'handoff.chain']) assert(coverage.missing.includes(rule));
    assert(first.result.attempts.every(a => a.evidence.some(e => e.locator === '/source') && a.evidence.some(e => e.locator === '/target')));
    assert(first.result.attempts.flatMap(a => a.findings).every(f => f.issue_id === null && f.verification_status === 'pending_verification'));
    save('complete-run', first.result); save('complete-http', await ag('/runs/' + first.created.run_id));
    save('set-inventory', { schema_version: 'synthetic-evidence-set-v1', synthetic: true, business_approved: false, start: 'a', end: 'c', membership_basis: 'Only this technical fixture; not an enterprise scope', members: Object.values(members).map(m => ({ key: m.key, membership: m.key === 'support' ? 'support_touchpoint' : 'technical_path', source_id: m.source_id, source_kind: m.meta.source_kind, source_ref: m.meta.source_ref, schema_version: m.meta.schema_version, content_digest: m.meta.content_digest, raw_sha256: m.meta.raw_sha256, department_id: m.department_id, process_ref: m.document.process.process_ref, mappings: [m.om, m.fm] })), relations: relations.map(r => ({ key: r.key, from: r.a, to: r.b, purpose: r.purpose, ...r.record, snapshot_digest: r.detail.snapshot_digest, source: r.detail.source, target: r.detail.target, pairs: r.detail.pairs, evidence: r.detail.evidence })), manifest_digest: first.result.manifest_digest, run_id: first.created.run_id, manifest: first.result.manifest });
   });
   await check('same complete set replay and reordering preserve P13 identity/coverage; reduced input is incomparable, never complete chain', async () => {
    second = await execute({ ...manifest([...relations].reverse()), rerun_of_run_id: first.created.run_id });
    const diff = await ag('/runs/' + first.created.run_id + '/diff/' + second.created.run_id); save('same-set-diff', diff); assert.equal(diff.algorithm, 'analysis-diff-v2');
    assert.equal(JSON.stringify(diff).includes('CHECK_SCOPE_CHANGED'), false);
    partial = await execute(manifest(relations.slice(0, 2), 'SYNTHETIC 部分输入：只包含a_b/b_c；support、多接收方及返回输入未提交，不证明完整集合或企业主链'));
    assert.equal(partial.result.status, 'partial'); const reduced = await ag('/runs/' + first.created.run_id + '/diff/' + partial.created.run_id); save('partial-set-diff', reduced); assert(JSON.stringify(reduced).includes('CHECK_SCOPE_CHANGED'));
    save('partial-run', partial.result);
   });
   await check('missing endpoint/member, invalid fixed version and multi-input step reject or retain exact limited coverage', async () => {
    const d = relation(members.a, members.b, 'missing_target', { claim_status: 'analysis_pending', target: null, pairs: [], evidence: [{ side: 'source', locator: 'SYNTHETIC', note: 'target not registered' }] });
    const h = await post(body(d)); const r = await execute(manifest([{ key: 'missing_target', record: h }], 'SYNTHETIC 一端未登记，不认定业务不存在'));
    assert(r.result.attempts[0].findings.some(f => f.rule_id === 'handoff.fields')); save('missing-endpoint-run', r.result);
    const invalid = manifest(relations); invalid.inputs[0].ref_id = '999999999'; await expect('lead', api + '/runs', 'POST', invalid, 404);
    const multiple = manifest(relations.slice(0, 2)); multiple.steps = [{ ...multiple.steps[0], input_keys: multiple.inputs.map(i => i.input_key) }]; await expect('lead', api + '/runs', 'POST', multiple, 400);
    const omitted = manifest(relations.slice(0, 2)); omitted.inputs.pop(); await expect('lead', api + '/runs', 'POST', omitted, 400);
   });
   await check('current two-end scopes and admin stacked role reject reads/writes without creating hidden sources', async () => {
    await get('/' + relations[0].record.handoff_id, 'contact', 403); await ag('/runs/' + first.created.run_id, 'contact', 404);
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 88,role_id,'global','SYNTHETIC stacked admin',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
    const before = await counts(); await post(body(relations[0].definition), 'adminMulti', 403); await expect('adminMulti', api + '/runs', 'POST', manifest(relations), 404); assert.deepEqual(await counts(), before);
    await ag('/runs/' + first.created.run_id, 'adminMulti');
    const visible = await ag('/sources?kind=handoff&limit=1', 'contact'); assert(visible.items.every(i => i.ref_id !== relations[0].record.handoff_version_id)); save('source-visibility', visible);
   });
   await check('two actors, concurrent revision, same request/changed body and audit refs failure preserve immutable versions', async () => {
    const definition = { ...relations[0].definition, title: 'SYNTHETIC 并发与审计' }, payload = body(definition);
    const duplicate = await Promise.all([post(payload), post(payload)]); assert.deepEqual(duplicate[0], duplicate[1]);
    await post({ ...payload, definition: { ...definition, title: 'SYNTHETIC changed body' } }, 'lead', 409);
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 87,role_id,'global','SYNTHETIC second lead',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
    const response = await post(payload, 'multi'); assert.notEqual(response.handoff_id, duplicate[0].handoff_id);
    const concurrent = await Promise.all(['lead', 'multi'].map(who => request(who, root, 'POST', body(definition, duplicate[0].handoff_id, 1)))); assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    for (const table of ['data_map_design_handoff_versions', 'data_map_design_handoff_refs']) {
     const before = await counts(); await pool.query("CREATE TRIGGER synthetic_set_failure BEFORE INSERT ON " + table + " FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_SET_FAILURE'");
     try { await post(body(definition), 'lead', 503); assert.deepEqual(await counts(), before); } finally { await pool.query('DROP TRIGGER synthetic_set_failure'); }
    }
    const before = await counts(); await pool.query("CREATE TRIGGER synthetic_set_failure BEFORE UPDATE ON data_map_definition_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_REQUEST_FAILURE'");
    try { await post(body(definition), 'lead', 503); assert.deepEqual(await counts(), before); } finally { await pool.query('DROP TRIGGER synthetic_set_failure'); }
   });
   await check('fixed snapshot/refs tampering and absent marker/column return exact failures, no DDL or source replacement', async () => {
    const h = relations[0].record;
    await pool.execute("UPDATE data_map_design_handoff_versions SET snapshot_digest=REPEAT('0',64) WHERE handoff_version_id=?", [h.handoff_version_id]);
    try { await get('/' + h.handoff_id, 'lead', 409); await ag('/runs/' + first.created.run_id, 'lead', 409); } finally { await pool.execute('UPDATE data_map_design_handoff_versions SET snapshot_digest=? WHERE handoff_version_id=?', [relations[0].detail.snapshot_digest, h.handoff_version_id]); }
    const [[ref]] = await pool.execute('SELECT * FROM data_map_design_handoff_refs WHERE handoff_version_id=? LIMIT 1', [h.handoff_version_id]);
    await pool.execute('DELETE FROM data_map_design_handoff_refs WHERE handoff_version_id=? AND mapping_version_id=? AND side=?', [ref.handoff_version_id, ref.mapping_version_id, ref.side]);
    try { await ag('/runs/' + first.created.run_id, 'lead', 409); } finally { await pool.execute('INSERT INTO data_map_design_handoff_refs(handoff_version_id,mapping_version_id,side) VALUES (?,?,?)', [ref.handoff_version_id, ref.mapping_version_id, ref.side]); }
    const marker = require('../server/designHandoffSchema').MIGRATION_KEY;
    await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?', [marker]);
    try {
     await get('', 'lead', 503);
     const observed = await request('lead', api + '/runs/' + first.created.run_id); save('missing-p08-marker-analysis-observation', observed);
     assert.equal(observed.status, 503, 'analysis handoff consumption must require its existing P08 migration marker');
    } finally { await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [marker]); }
    const p07Marker = require('../server/v7MappingSchema').MIGRATION_KEY;
    await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?', [p07Marker]);
    try {
     const relationRead = await request('lead', root + '/' + h.handoff_id), analysisRead = await request('lead', api + '/runs/' + first.created.run_id);
     save('missing-p07-marker-observation', { relationRead, analysisRead });
     assert.equal(relationRead.status, 503, 'P08 consumes existing P07 storage and marker'); assert.equal(analysisRead.status, 503);
    } finally { await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [p07Marker]); }
    await pool.query('ALTER TABLE data_map_design_handoff_versions RENAME COLUMN snapshot_digest TO synthetic_missing_digest');
    try { await get('/' + h.handoff_id, 'lead', 503); } finally { await pool.query('ALTER TABLE data_map_design_handoff_versions RENAME COLUMN synthetic_missing_digest TO snapshot_digest'); }
    assert.deepEqual(await repo.getAnalysisRun(lead, first.created.run_id), first.result);
   });
   await check('native V8 shared handoff is structural only; P11 remains V7 and rule contract is not extended', async () => {
    const v8 = await source('v8_compat', '合成甲部', object, field, true), h = await post(body(relation(v8, members.b, 'v8_structural')));
    const r = await execute(manifest([{ key: 'v8_structural', record: h }], 'SYNTHETIC 共享交接结构读取；不执行V8行为语义或P11规则'));
    assert.equal(r.result.status, 'partial'); assert(r.result.coverage[0].missing.includes('handoff.chain')); save('v8-structural-boundary', r.result);
    const v7 = require('../server/v7AnalysisRules'); const payload = { request_id: uuid(), inputs: [{ input_key: 'v8', kind: 'v7_source', ref_id: v8.source_id }], check_scope: { description: 'SYNTHETIC unsupported P11', check_ids: v7.CHECKS }, rule_version: v7.VERSION, parser_versions: { [v7.PARSER]: v7.VERSION }, steps: [{ step_key: 'v8', input_keys: ['v8'], check_ids: v7.CHECKS, parser_key: v7.PARSER }] };
    await expect('lead', api + '/runs', 'POST', payload, 409);
   });
   if (!process.argv.includes('--no-browser')) {
    browser = await pw.chromium.launch({ channel: 'msedge', headless: true }); context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 }); page = await context.newPage(); page.setDefaultTimeout(16000);
    page.on('pageerror', e => pageErrors.push(e.message)); page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
    page.on('response', r => { if (r.status() >= 400) responseReads.push(r.json().then(body => httpErrors.push({ path: new URL(r.url()).pathname, status: r.status(), code: body.code || null, csrf_rejected: body.error === 'CSRF token invalid' })).catch(() => httpErrors.push({ path: new URL(r.url()).pathname, status: r.status(), code: null, csrf_rejected: false }))); });
    const button = name => page.getByRole('button', { name, exact: true }), label = name => page.getByLabel(name, { exact: true });
    const idle = () => page.waitForFunction(() => !document.body.textContent.includes('正在处理设计交接…'));
    const shot = async name => { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true }); };
    const overflow = async () => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); };
    await page.goto(fixture.baseURL + '/app/design-handoffs?handoff=' + relations[0].record.handoff_id);
    await page.locator('#login-name').fill('SYNTHETIC_lead'); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click(); await page.getByRole('heading', { name: relations[0].definition.title, exact: true }).waitFor(); await idle();
    await check('Edge continuous registered relation browsing with fixed ends/fields/evidence, support identity and explicit missing scope', async () => {
     for (const r of relations) { await page.locator('.handoff-choice').filter({ hasText: '交接 ' + r.record.handoff_id + ' ·' }).click(); await page.getByRole('heading', { name: r.definition.title, exact: true }).waitFor(); await idle();
      assert.match(await page.locator('[aria-label="关系检查结果"]').innerText(), /主链|完整输入/); assert.equal(await page.getByRole('link', { name: '来源字段固定版本', exact: true }).first().getAttribute('href'), '/api/data-map-definitions/version/' + r.detail.pairs[0].source.field_version_id); await overflow(); }
     await shot('registered-set-desktop');
     await page.getByRole('link', { name: '查看固定来源和映射', exact: true }).first().click(); await page.getByRole('heading', { name: '来源 ' + members.support.source_id + '：独立上传材料', exact: true }).waitFor();
     await page.getByText('摘要与校验依据', { exact: true }).click(); assert.match(await page.locator('main').innerText(), new RegExp(members.support.meta.content_digest)); await overflow(); await shot('fixed-source-desktop');
     await page.goto(fixture.baseURL + '/app/design-handoffs?handoff=' + relations[0].record.handoff_id); await button('查看交接历史').waitFor(); await button('查看交接历史').click(); await page.getByRole('heading', { name: '交接修订历史', exact: true }).waitFor(); await overflow();
    });
    await check('Edge complete multi-step manifest, coverage and two-end evidence graph use current fixed run', async () => {
     await page.goto(fixture.baseURL + '/app/analysis#run=' + first.created.run_id); await label('当前运行').waitFor(); await wait(async () => (await label('当前运行').inputValue()) === first.created.run_id); await button('刷新分析记录').waitFor(); await wait(async () => !(await button('刷新分析记录').isDisabled()));
     assert.match(await page.locator('main').innerText(), /a_b|b_c|support_b/); await overflow(); await shot('set-analysis-desktop');
     await label('固定输入筛选').selectOption('a_b'); await label('发现类别').selectOption('not_covered'); await page.locator('[data-finding]').first().click(); await button('查看证据 3').click(); await page.getByRole('heading', { name: '固定字段对应', exact: true }).waitFor();
     const boxes = await page.locator('svg[role="img"]').evaluateAll(elements => elements.map(el => ({ name: el.getAttribute('aria-label'), rectangles: [...el.querySelectorAll('rect')].map(r => ({ x: +r.getAttribute('x'), y: +r.getAttribute('y'), width: +r.getAttribute('width'), height: +r.getAttribute('height') })), arrows: el.querySelectorAll('path[marker-end],line[marker-end]').length, viewBox: el.getAttribute('viewBox') })));
     assert(boxes.some(g => g.rectangles.length === 2 && g.arrows > 0)); for (const g of boxes) for (let i = 0; i < g.rectangles.length; i++) for (let j = i + 1; j < g.rectangles.length; j++) { const a = g.rectangles[i], b = g.rectangles[j]; assert(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y); } geometry.push(...boxes);
     await overflow(); await shot('set-fixed-evidence-desktop');
    });
    await check('Edge lost successful response freezes original request, identity and input until explicit same-request verification', async () => {
     await page.goto(fixture.baseURL + '/app/design-handoffs?handoff=' + relations[0].record.handoff_id); await button('修订设计交接').waitFor(); await button('修订设计交接').click(); await label('交接名称').fill('SYNTHETIC response-unknown input');
     const originalNullable=(await get('/'+relations[0].record.handoff_id)).input.pairs[0].checks.field.rule;
     assert.equal(originalNullable,null,'existing same-mode rule is stored as null');
     assert.equal(await label('字段含义转换规则 1').inputValue(),'','nullable historical text renders as an empty controlled input');
     let sent; await page.route('**/api/design-handoffs', async route => { sent = route.request().postDataJSON(); const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort(); }, { times: 1 }); await button('保存设计关系').click(); await idle();
     save('response-unknown-observation', { sent, visible: await page.locator('main').innerText(), input_enabled: await label('交接名称').isEnabled() });
     assert.equal(sent.definition.pairs[0].checks.field.rule,originalNullable,'editing title must not silently normalize historical null rule');
     assert.equal(await label('交接名称').isEnabled(), false, 'uncertain successful write must freeze its exact request body');
     const dialog = page.waitForEvent('dialog'), click = page.getByRole('button', { name: '按原请求核对结果', exact: true }).click(); await (await dialog).accept(); await click;
     await idle(); assert.equal((await get('/' + relations[0].record.handoff_id)).revision_no, 2); await page.getByRole('heading', { name: 'SYNTHETIC response-unknown input', exact: true }).waitFor();
    });
    await check('Edge undelivered request/identity switch retain frozen original; historical link reads exact version and late reads do not replace selection', async () => {
     await button('修订设计交接').click(); await label('交接名称').fill('SYNTHETIC not-arrived retained input');
     let sent, replay; await page.route('**/api/design-handoffs', route => { sent = route.request().postDataJSON(); return route.abort(); }, { times: 1 }); await button('保存设计关系').click(); await idle(); assert.equal((await get('/' + relations[0].record.handoff_id)).revision_no, 2);
     await page.request.post(fixture.baseURL + '/api/org/login', { data: { loginName: 'SYNTHETIC_multi', password: fixture.loginPassword } }); await button('刷新身份').click(); await page.getByText('输入已保留，正在核对当前身份与两端范围', { exact: true }).waitFor(); assert.equal(await label('交接名称').count(), 0); assert.equal((await get('/' + relations[0].record.handoff_id)).revision_no, 2);
     await page.request.post(fixture.baseURL + '/api/org/login', { data: { loginName: 'SYNTHETIC_lead', password: fixture.loginPassword } }); await button('刷新身份').click(); await label('交接名称').waitFor(); assert.equal(await label('交接名称').inputValue(), 'SYNTHETIC not-arrived retained input'); assert.equal(await label('交接名称').isEnabled(), false);
     await page.route('**/api/design-handoffs', async route => { replay = route.request().postDataJSON(); await route.continue(); }, { times: 1 });
     const dialog = page.waitForEvent('dialog'), click = button('按原请求核对结果').click(); await (await dialog).accept(); await click; await idle(); assert.deepEqual(replay, sent);
     // Direct browser-context logins deliberately replace the session while
     // leaving the app's cached CSRF token. Its first rejection must keep the
     // original uncertain request; the next human click gets a fresh token.
     if ((await get('/' + relations[0].record.handoff_id)).revision_no === 2) {
      await page.getByRole('alert').filter({ hasText: '设计交接操作未完成' }).waitFor(); assert.equal(await label('交接名称').isEnabled(), false);
      const nextDialog = page.waitForEvent('dialog'), nextClick = button('按原请求核对结果').click(); await (await nextDialog).accept(); await nextClick; await idle();
     }
     assert.equal((await get('/' + relations[0].record.handoff_id)).revision_no, 3);
     await button('查看交接历史').click(); await page.getByRole('link', { name: '查看固定历史与字段依据', exact: true }).last().click(); await page.getByRole('heading', { name: relations[0].definition.title, exact: true }).waitFor(); assert.equal(new URL(page.url()).searchParams.get('version'), relations[0].record.handoff_version_id); assert.equal(await button('修订设计交接').count(), 0); await overflow(); await shot('fixed-history-desktop');
     await page.goto(fixture.baseURL + '/app/design-handoffs?handoff=' + relations[0].record.handoff_id); await button('修订设计交接').waitFor();
     let release; const gate = new Promise(r => { release = r; }); await page.route('**/api/design-handoffs/' + relations[1].record.handoff_id, async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }).catch(() => {}); }, { times: 1 });
     await page.locator('.handoff-choice').filter({ hasText: '交接 ' + relations[1].record.handoff_id + ' ·' }).click(); await page.locator('.handoff-choice').filter({ hasText: '交接 ' + relations[0].record.handoff_id + ' ·' }).click(); await idle(); release(); await page.unrouteAll({ behavior: 'wait' }); await page.getByRole('heading', { name: 'SYNTHETIC not-arrived retained input', exact: true }).waitFor();
     save('original-request-identity', { sent, replay, exact_match: json(sent) === json(replay), history_version: relations[0].record.handoff_version_id });
    });
    await Promise.all(responseReads);
    const unexpectedHttpErrors = httpErrors.filter(e => !(e.path === '/api/design-handoffs' && e.status === 403 && e.csrf_rejected));
    save('browser-results', { browser: 'Microsoft Edge', zoom: 1, viewport: [1699, 828], pageErrors, consoleErrors, httpErrors, unexpectedHttpErrors, geometry, human_ime: false }); assert.deepEqual(pageErrors, []); assert.deepEqual(unexpectedHttpErrors, []); assert.deepEqual(consoleErrors.filter(e => !/Failed to load resource:.*(403|net::ERR_FAILED)/.test(e)), []);
   }
   await check('definition/mapping/source advance marks current relation needs recheck while fixed historical manifest stays unchanged', async () => {
    const before = first.result.manifest_digest; await define({ entity_type: 'field', entity_id: field.entity_id, expected_revision: 1, object_id: object.entity_id, object_version_id: object.version_id, definition: { name: '记录编号新定义' } });
    const r = await get('/' + relations[1].record.handoff_id); assert(r.issues.some(i => i.code === 'DEFINITION_VERSION_ADVANCED')); assert.equal(r.effective_confirmed, false); assert.equal(r.snapshot_digest, relations[1].detail.snapshot_digest);
    await expect('lead', '/api/v7-mappings/sources/' + members.b.source_id + '/mappings', 'POST', { ...members.b.base, request_id: uuid(), expected_revision: 1, status: 'candidate', basis: 'SYNTHETIC 映射变化' });
    assert((await get('/' + relations[1].record.handoff_id)).issues.some(i => i.code === 'MAPPING_REVISED'));
    const old = await get('/' + relations[1].record.handoff_id + '?version=' + relations[1].record.handoff_version_id); assert.equal(old.source.mapping_version_id, members.b.om.mapping_version_id);
    const run = await repo.getAnalysisRun(lead, first.created.run_id); assert.equal(run.manifest_digest, before); assert.deepEqual(run.attempts, first.result.attempts); save('fixed-history-after-change', { relation: old, run });
   });
   await check('changed uploaded material is a distinct fixed source; explicit revised relation preserves old source/format/digest/mapping refs', async () => {
    const changed = await source('a', '合成甲部', object, field, false, 2); assert.notEqual(changed.source_id, members.a.source_id); assert.notEqual(changed.meta.content_digest, members.a.meta.content_digest);
    const current = await get('/' + relations[0].record.handoff_id); const definition = relation(changed, members.b, 'explicit_source_revision', { claim_status: 'analysis_pending' });
    const revised = await post(body(definition, current.handoff_id, current.revision_no)); const old = await get('/' + current.handoff_id + '?version=' + relations[0].record.handoff_version_id); assert.equal(old.source.source_id, members.a.source_id); assert.equal(old.snapshot_digest, relations[0].detail.snapshot_digest);
    const rs = relations.map((r, i) => i ? r : { ...r, record: revised }); const result = await execute({ ...manifest(rs), rerun_of_run_id: first.created.run_id });
    const diff = await ag('/runs/' + first.created.run_id + '/diff/' + result.created.run_id); save('source-revision-diff', diff); save('source-revision-run', result.result); save('source-revision-history', { old, current: await get('/' + current.handoff_id), new_source: changed.meta });
    assert.equal((await repo.getAnalysisRun(lead, first.created.run_id)).manifest_digest, first.result.manifest_digest);
    const [[original]] = await pool.execute('SELECT content_json FROM data_map_v7_sources WHERE source_id=?', [members.a.source_id]);
    await pool.execute("UPDATE data_map_v7_sources SET content_json=JSON_SET(content_json,'$.process.purpose','SYNTHETIC corruption') WHERE source_id=?", [members.a.source_id]);
    try { await ag('/runs/' + first.created.run_id, 'lead', 409); } finally { await pool.execute('UPDATE data_map_v7_sources SET content_json=? WHERE source_id=?', [json(original.content_json), members.a.source_id]); }
    assert.equal((await repo.getAnalysisRun(lead, first.created.run_id)).manifest_digest, first.result.manifest_digest);
   });
   await check('large integer relation/version references and pagination remain exact decimal strings', async () => {
    await pool.query('ALTER TABLE data_map_design_handoffs AUTO_INCREMENT=9007199254740993'); await pool.query('ALTER TABLE data_map_design_handoff_versions AUTO_INCREMENT=9007199254740993');
    const h = await post(body({ ...relations[0].definition, claim_status: 'analysis_pending', title: 'SYNTHETIC bigint' })); assert.equal(h.handoff_id, '9007199254740993'); assert.equal(h.handoff_version_id, '9007199254740993'); assert.equal((await get('/' + h.handoff_id)).handoff_id, h.handoff_id);
    const r = await execute(manifest([{ key: 'bigint', record: h }])); assert.equal(r.result.manifest.inputs[0].snapshot.ref_id, h.handoff_version_id);
    for (let i = 0; i < 52; i++) await post(body({ ...relations[0].definition, claim_status: 'analysis_pending', title: 'SYNTHETIC page ' + i }));
    const ids = []; let after; do { const p = await get(after ? '?after=' + after : ''); ids.push(...p.items.map(i => i.handoff_id)); after = p.next; } while (after); assert.equal(new Set(ids).size, ids.length); assert.deepEqual(ids, [...ids].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)); assert.equal(ids.length, Number((await counts()).data_map_design_handoffs)); save('pagination', { ids, precision: 'decimal strings' });
   });
   await check('owned in-memory backup/restore and exact target columns/markers/refs retain all fixed history', async () => {
    const tables = ['data_map_design_handoffs', 'data_map_design_handoff_versions', 'data_map_design_handoff_refs', 'data_map_analysis_runs', 'data_map_analysis_inputs', 'data_map_analysis_steps', 'data_map_analysis_attempts', 'data_map_analysis_evidence', 'data_map_analysis_findings', 'data_map_definition_requests'];
    const before = await tableHashes(tables), dump = backup(); await pool.execute("UPDATE data_map_design_handoff_versions SET snapshot_digest=REPEAT('0',64) WHERE handoff_version_id=?", [relations[0].record.handoff_version_id]); restore(dump); assert.deepEqual(await tableHashes(tables), before); save('backup-restore', { before, after: await tableHashes(tables), digest: crypto.createHash('sha256').update(dump).digest('hex'), backup_persisted: false });
    save('target-columns', (await pool.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (" + tables.map(() => '?').join(',') + ") ORDER BY TABLE_NAME,ORDINAL_POSITION", tables))[0]);
    save('target-markers', (await pool.query('SELECT migration_key FROM schema_migrations ORDER BY migration_key'))[0]); save('target-refs', (await pool.query('SELECT CAST(handoff_version_id AS CHAR) handoff_version_id,CAST(mapping_version_id AS CHAR) mapping_version_id,side FROM data_map_design_handoff_refs ORDER BY handoff_version_id,mapping_version_id,side'))[0]);
   });
   save('protected-records', { before: protectedBefore, after: await tableHashes(protectedTables) }); assert.deepEqual(await tableHashes(protectedTables), protectedBefore);
   if (page) await check('Edge existing native process/data graphs of identical fixed synthetic bodies: arrows, collision and viewport geometry', async () => {
    const diagramCases = [];
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT 85,role_id,'department',92,'SYNTHETIC graph preview creator',CURRENT_DATE FROM roles WHERE role_code='department_contact'");
    for (const m of Object.values(members)) {
     const created = await expect(m.department_id === '92' ? 'reviewB' : 'contact', '/api/process-v7-preview/cases', 'POST', { document: m.document, source_file_name: 'SYNTHETIC set graph ' + m.key + '.json' }, 201);
     assert.equal(created.case.current_content_hash, m.meta.content_digest); diagramCases.push({ key: m.key, case_id: created.case.id, source_id: m.source_id, digest: m.meta.content_digest });
    }
    const before = await tableHashes(protectedTables);
    await page.goto(fixture.baseURL + '/app/data-map'); await page.getByRole('heading', { name: '流程与数据关系图', exact: true }).waitFor();
    for (const m of diagramCases) {
     await page.getByLabel('图形流程', { exact: true }).selectOption(String(m.case_id)); await page.locator('[data-diagram-state="ready"]').waitFor();
     for (const mode of ['process', 'data']) {
      await page.getByLabel('图形视图', { exact: true }).selectOption(mode); await page.locator('[data-diagram-state="ready"]').waitFor();
      const result = await page.locator('.native-diagram-viewport').evaluate(el => { const cy = el._cyreg.cy; return { width: el.clientWidth, height: el.clientHeight, nodes: cy.nodes().filter(n => n.data('focusKind') === 'behavior' || ['behavior', 'data'].includes(n.data('kind'))).map(n => ({ id: n.id(), box: n.boundingBox(), rendered: n.renderedBoundingBox() })), edges: cy.edges().map(e => ({ id: e.id(), source: e.source().id(), target: e.target().id(), arrow: e.style('target-arrow-shape') })) }; });
      assert(result.nodes.length >= 3); assert(result.edges.length >= 2); assert(result.edges.every(e => e.arrow !== 'none'));
      for (const n of result.nodes) { assert(Number.isFinite(n.box.x1)); assert(n.rendered.x1 >= -2 && n.rendered.y1 >= -2 && n.rendered.x2 <= result.width + 2 && n.rendered.y2 <= result.height + 2); }
      for (let i = 0; i < result.nodes.length; i++) for (let j = i + 1; j < result.nodes.length; j++) { const a = result.nodes[i].box, b = result.nodes[j].box; assert(a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1); }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); geometry.push({ key: m.key, mode, ...result });
      await page.screenshot({ path: path.join(output, 'native-' + m.key + '-' + mode + '.png'), fullPage: true });
     }
    }
    assert.deepEqual(await tableHashes(protectedTables), before); save('native-geometry', { diagramCases, geometry, before, after: await tableHashes(protectedTables), note: 'Same content digest as fixed uploads; previews are distinct explicit graph references, not promoted or merged.' });
   });
   save('validation', { passed: true, checks, observations, real_worker: true, real_ai_calls: 0, browser: !process.argv.includes('--no-browser'), formal_target: false, business_accepted: false });
  } catch (error) { if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); save('failure', { message: error.message, stack: error.stack, checks, observations }); throw error; }
  finally {
   if (browser) await browser.close(); if (uploadContext) await uploadContext.dispose();
   if (worker && worker.exitCode === null && worker.signalCode === null) { const exited = once(worker, 'exit'); worker.send('stop'); const timer = setTimeout(() => worker.kill('SIGKILL'), 10000); await exited; clearTimeout(timer); }
   save('worker-events', events); save('cleanup', { worker_stopped: !worker || worker.exitCode !== null || worker.signalCode !== null, owned_browser_closed: true });
  }
 }, { evidenceDir: output, randomDatabase: true });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
