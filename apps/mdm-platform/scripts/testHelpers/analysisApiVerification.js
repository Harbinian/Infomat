// P14 real HTTP extension of the P09 owned MySQL fixture. Synthetic data only.
// Restores its in-memory backup before P09 continues; no credentials are persisted.
const assert = require('node:assert/strict'), crypto = require('node:crypto');
module.exports = async function (ctx) {
  const { repo, lead, pool, run, historical, payload, fixture, source, published, preview, template, fieldMap, handoff, field, begin, completion, finish, get, check, save, expect, backup, restore } = ctx;
  const uuid = () => crypto.randomUUID(), root = '/api/analysis', runPath = root + '/runs/' + run.run_id;
  const ownChecks = [], test = async (name, fn) => { await check('P14 ' + name, fn); ownChecks.push(name); };
  // Include the queue tables in the backup so a following UI/worker extension
  // cannot inherit orphan queue rows after restoring the older run IDs.
  await require('../../server/analysisQueueMigration').applyAnalysisQueue(pool);
  const dump = backup(), clients = {};
  async function http(who, url, method = 'GET', body, headers = {}) {
    const c = clients[who] || {};
    const form = body instanceof FormData;
    const response = await fetch(fixture.baseURL + url, { method, headers: { ...(form ? {} : { 'Content-Type': 'application/json' }),
      ...(c.cookie ? { Cookie: c.cookie } : {}), ...(c.csrf ? { 'X-CSRF-Token': c.csrf } : {}), ...headers },
      body: body === undefined ? undefined : form || typeof body === 'string' ? body : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) c.cookie = response.headers.get('set-cookie').split(';')[0];
    const text = await response.text();
    let result; try { result = JSON.parse(text); } catch { result = text; }
    return { status: response.status, body: result, headers: Object.fromEntries(response.headers) };
  }
  async function ok(who, url, method, body, status = 200, headers) {
    const r = await http(who, url, method, body, headers);
    assert.equal(r.status, status, `${method || 'GET'} ${url}: ${JSON.stringify(r.body)}`); return r;
  }
  async function login(who) {
    clients[who] = {};
    await ok(who, '/api/org/login', 'POST', { loginName: 'SYNTHETIC_' + who, password: fixture.loginPassword });
    clients[who].csrf = (await ok(who, '/api/csrf-token')).body.csrfToken;
  }
  const rules = require('../../server/v7AnalysisRules');
  const realPayload = () => ({ request_id: uuid(), inputs: [{ input_key: 'source', kind: 'v7_source', ref_id: source.source_id }],
    check_scope: { description: 'P14合成运行', check_ids: ['v7.required'] }, rule_version: rules.VERSION,
    parser_versions: { [rules.PARSER]: rules.VERSION }, steps: [{ step_key: 'check', input_keys: ['source'], check_ids: ['v7.required'], parser_key: rules.PARSER }], ai_metadata: null, rerun_of_run_id: null });
  try {
    for (const who of ['lead', 'contact', 'outsider', 'adminMulti', 'reviewB']) await login(who);
    await test('anonymous, no permission and expired sessions fail closed', async () => {
      await ok('anonymous', runPath, undefined, undefined, 401);
      await ok('contact', root + '/runs', 'POST', realPayload(), 403);
      await pool.execute('DELETE FROM person_roles WHERE person_id=85');
      await ok('reviewB', root + '/capabilities', undefined, undefined, 404);
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=185');
      await ok('reviewB', root + '/runs', undefined, undefined, 401);
    });
    let created;
    await test('create and queue are atomic, repeated requests are idempotent, conflicts explicit', async () => {
      const p = realPayload(); created = (await ok('lead', root + '/runs', 'POST', p)).body;
      assert.deepEqual((await ok('lead', root + '/runs', 'POST', p)).body, created);
      const concurrent = realPayload();
      const twins = await Promise.all([ok('lead', root + '/runs', 'POST', concurrent), ok('lead', root + '/runs', 'POST', concurrent)]);
      assert.deepEqual(twins[0].body, twins[1].body);
      await ok('lead', root + '/runs', 'POST', { ...p, check_scope: { ...p.check_scope, description: 'changed' } }, 409);
      const count = async () => Number((await pool.query('SELECT COUNT(*) n FROM data_map_analysis_runs'))[0][0].n);
      const before = await count();
      await ok('lead', root + '/runs', 'POST', payload(), 400);
      assert.equal(await count(), before);
      const marker = require('../../server/analysisQueueSchema').MIGRATION_KEY;
      await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?', [marker]);
      await ok('lead', root + '/runs', 'POST', realPayload(), 503);
      assert.equal(await count(), before);
      await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [marker]);
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM data_map_analysis_queue WHERE run_id=?', [created.run_id]))[0][0].n, 1);
    });
    await test('cancel revision, repeated cancellation and P09 nonqueued compatibility', async () => {
      const url = root + '/runs/' + created.run_id + '/cancel', p = { request_id: uuid(), expected_revision: created.revision_no };
      await ok('lead', url, 'POST', { ...p, expected_revision: 999 }, 409);
      const result = (await ok('lead', url, 'POST', p)).body;
      assert.deepEqual((await ok('lead', url, 'POST', p)).body, result);
      const old = await repo.createAnalysisRun(lead, payload());
      await ok('lead', root + '/runs/' + old.run_id + '/cancel', 'POST', { request_id: uuid(), expected_revision: old.revision_no });
      assert.equal((await get(old)).status, 'cancelled');
      await ok('lead', url, 'POST', { ...p, run_id: run.run_id }, 400);
    });
    await test('summary, detail, finding, evidence and export have separate projections', async () => {
      const summary = await ok('contact', runPath + '/summary');
      assert.deepEqual(Object.keys(summary.body).sort(), ['run_id', 'status', 'revision_no', 'created_at', 'started_at', 'finished_at'].sort());
      assert.equal(summary.headers['cache-control'], 'no-store');
      const detail = (await ok('contact', runPath)).body;
      assert(!JSON.stringify(detail).includes('原始字符串')); assert(!Object.hasOwn(detail, 'created_by_person_id'));
      assert(detail.attempts.every(a => !Object.hasOwn(a, 'findings') && !Object.hasOwn(a, 'evidence')));
      const findings = (await ok('contact', runPath + '/findings')).body.items;
      assert(findings.length > 0);
      const finding = (await ok('contact', runPath + '/findings/' + findings[0].finding_id)).body;
      assert.equal(finding.issue_id, null); assert.equal(finding.verification_status, 'pending_verification');
      const evidence = (await ok('contact', runPath + '/evidence/' + finding.evidence_ids[0])).body;
      assert(evidence.excerpt); assert.equal(evidence.extraction_status, 'resolved');
      const anchor = historical.attempts.flatMap(a => a.evidence).find(e => e.locator_kind === 'document_anchor');
      const declared = (await ok('contact', runPath + '/evidence/' + anchor.evidence_id)).body;
      assert.equal(declared.excerpt, null); assert.equal(declared.extraction_status, 'declared_anchor_only');
      const exported = await ok('contact', runPath + '/export');
      assert.equal(exported.body.format_version, 'analysis-export-v1'); assert(exported.headers['content-disposition'].includes('attachment'));
      assert(!JSON.stringify(exported.body).includes('原始字符串')); assert(!JSON.stringify(exported.body).includes('actor_person_id'));
      assert(!JSON.stringify(exported.body).includes('session_json')); assert(exported.body.evidence.every(e => !Object.hasOwn(e, 'excerpt')));
      await ok('contact', runPath + '/export?include_raw=true', undefined, undefined, 400);
      save('p14-projections.json', { summary: summary.body, detail, finding, evidence, exported: exported.body });
    });
    await test('cross-department and foreign IDs cannot reveal details, counts, diff or exports', async () => {
      const denied = (await ok('outsider', runPath, undefined, undefined, 404)).body;
      for (const suffix of ['', '/summary', '/findings', '/findings/999999', '/evidence/999999', '/export', '/diff/' + run.run_id]) {
        assert.deepEqual((await ok('outsider', runPath + suffix, undefined, undefined, 404)).body, denied);
      }
      assert.deepEqual((await ok('outsider', root + '/runs/999999', undefined, undefined, 404)).body, denied);
      assert.deepEqual((await ok('outsider', root + '/runs')).body, { items: [], next_offset: null, visibility: 'existing_source_scope' });
      const other = await repo.createAnalysisRun(lead, payload());
      await ok('lead', root + '/runs/' + other.run_id + '/findings/' + historical.attempts[0].findings[0].finding_id, undefined, undefined, 404);
      await ok('lead', root + '/runs/' + other.run_id + '/evidence/' + historical.attempts[0].evidence[0].evidence_id, undefined, undefined, 404);
      await ok('outsider', root + '/sources/v7_source/' + source.source_id, undefined, undefined, 404);
      const forged = realPayload(); forged.inputs[0].ref_id = '9999999';
      await ok('lead', root + '/runs', 'POST', forged, 404);
      await ok('lead', root + '/runs', 'POST', { ...realPayload(), visibility: 'global', reviewed: true }, 400);
    });
    await test('source selection covers all fixed kinds and rechecks current referenced department', async () => {
      await ok('lead', root + '/sources/__proto__/' + template.batch_id, undefined, undefined, 400);
      await ok('lead', root + '/sources?kind=constructor', undefined, undefined, 400);
      for (const [kind, ref] of [['v7_source', source.source_id], ['definition', field.version_id], ['mapping', fieldMap.mapping_version_id], ['handoff', handoff.handoff_version_id], ['template', template.batch_id]]) {
        const list = (await ok('contact', root + '/sources?kind=' + kind)).body;
        assert(list.items.some(s => s.ref_id === ref)); assert(!JSON.stringify(list).includes('原始字符串'));
        assert.equal((await ok('contact', root + '/sources/' + kind + '/' + ref)).body.ref_id, ref);
        assert.deepEqual((await ok('outsider', root + '/sources?kind=' + kind)).body.items, []);
      }
      const before = (await ok('contact', root + '/runs')).body;
      await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=92 WHERE source_id=?', [source.source_id]);
      for (const suffix of ['', '/summary', '/export', '/evidence/' + historical.attempts[0].evidence[0].evidence_id]) await ok('contact', runPath + suffix, undefined, undefined, 404);
      assert.equal((await ok('contact', root + '/runs')).body.items.length, 0);
      await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=91 WHERE source_id=?', [source.source_id]);
      assert.deepEqual((await ok('contact', root + '/runs')).body, before);
    });
    await test('administrator with multiple roles remains read-only', async () => {
      const cap = (await ok('adminMulti', root + '/capabilities')).body;
      assert.equal(cap.can_create, false); assert.equal(cap.public_summary_enabled, false);
      await ok('adminMulti', runPath + '/export');
      await ok('adminMulti', root + '/runs', 'POST', realPayload(), 404);
      await ok('adminMulti', root + '/runs/' + created.run_id + '/cancel', 'POST', { request_id: uuid(), expected_revision: 1 }, 404);
    });
    await test('partial coverage, differences, visible pagination and no HTTP result injection', async () => {
      const partial = await repo.createAnalysisRun(lead, payload()), a = await begin(partial);
      await repo.completeAnalysisAttempt(lead, await completion(partial, a)); await finish(partial, 'partial');
      const result = (await ok('lead', root + '/runs/' + partial.run_id)).body;
      assert.equal(result.status, 'partial'); assert(result.coverage.some(c => c.missing.length));
      const diff = (await ok('lead', runPath + '/diff/' + partial.run_id)).body;
      assert.equal(diff.changes_governance, false); assert.equal(diff.comparison_complete, false);
      const first = (await ok('lead', root + '/runs?limit=1')).body;
      assert.equal(first.items.length, 1); assert.equal(first.next_offset, 1);
      const second = (await ok('lead', root + '/runs?limit=1&offset=1')).body;
      assert.notEqual(first.items[0].run_id, second.items[0].run_id);
      await ok('lead', root + '/runs?limit=0', undefined, undefined, 400);
      await ok('lead', runPath + '/complete', 'POST', { findings: [] }, 404);
      save('p14-partial-and-diff.json', { result, diff, first, second });
    });
    await test('material reference reception preserves stage and denies client visibility claims', async () => {
      for (const ref of [published, preview]) {
        const s = await repo.getV7Source(lead, ref.source_id);
        const p = { request_id: uuid(), source_kind: s.source_kind, ...s.source_ref };
        // source_ref contains exactly the identity for this stage.
        const allowed = ['request_id', 'source_kind', 'case_id', 'revision_id', 'process_version_id'];
        for (const k of Object.keys(p)) if (!allowed.includes(k)) delete p[k];
        const r = (await ok('lead', root + '/materials/references', 'POST', p)).body;
        assert.equal(r.source_id, ref.source_id);
      }
      await ok('lead', root + '/materials/references', 'POST', { request_id: uuid(), source_kind: 'published_version', process_version_id: '9999999', reviewed: true }, 400);
    });
    await test('multipart limits, JSON limits, CSRF and raw/static paths cannot bypass API', async () => {
      const p = realPayload();
      await ok('lead', root + '/runs', 'POST', p, 403, { 'X-CSRF-Token': 'invalid' });
      await ok('lead', root + '/runs', 'POST', { text: 'x'.repeat(262144) }, 413);
      await ok('lead', root + '/runs', 'POST', '{', 400);
      const upload = bytes => { const f = new FormData(); f.append('request_id', uuid()); f.append('file', new Blob([bytes]), 'synthetic.json'); return f; };
      const valid = await ok('lead', root + '/materials/uploads', 'POST', upload(JSON.stringify(fixture.document)));
      assert.equal(valid.body.validation_status, 'valid');
      const extra = upload('{}'); extra.append('visibility', 'global');
      await ok('lead', root + '/materials/uploads', 'POST', extra, 413);
      const malformed = await ok('lead', root + '/materials/uploads', 'POST', upload('not-json'));
      assert.equal(malformed.body.validation_status, 'parse_failed');
      await ok('lead', root + '/materials/uploads', 'POST', upload(Buffer.alloc(require('../../server/v7FixedSource').MAX_BYTES + 1, 120)), 413);
      await ok('adminMulti', root + '/materials/uploads', 'POST', upload('{}'), 404);
      for (const url of ['/server/analysisApi.js', '/frontend/src/analysisApi.js', '/artifacts/mdm-3000-upgrade-20260916/p00-20260916-120151/execution.md', '/app/analysis.json', '/data_map_analysis_runs', '/uploads/synthetic.json']) {
        const r = await http('anonymous', url); assert.equal(r.status, 404); assert(!String(r.body).includes('原始字符串'));
      }
    });
    await test('source integrity and missing dependencies return safe errors without raw data', async () => {
      const [[s]] = await pool.execute('SELECT content_json FROM data_map_v7_sources WHERE source_id=?', [source.source_id]);
      await pool.execute("UPDATE data_map_v7_sources SET content_json=JSON_SET(content_json,'$.process.purpose','RESTRICTED_SENTINEL') WHERE source_id=?", [source.source_id]);
      const r = await ok('lead', runPath + '/export', undefined, undefined, 409);
      assert(!JSON.stringify(r.body).includes('RESTRICTED_SENTINEL')); assert(!JSON.stringify(r.body).includes('SELECT'));
      await pool.execute('UPDATE data_map_v7_sources SET content_json=? WHERE source_id=?', [typeof s.content_json === 'string' ? s.content_json : JSON.stringify(s.content_json), source.source_id]);
      await ok('lead', runPath);
    });
    save('p14-results.json', { passed: true, checks: ownChecks, formal_environment: false, browser_started: false, worker_started: false, public_summary_enabled: false });
  } finally { restore(dump); }
  assert.deepEqual(await get(run), historical);
};
