// Q6 real HTTP/session/CSRF contracts on fresh owned loopback tmpfs MySQL.
// All materials and identities are synthetic. No private environment, existing
// service, formal migration, deployment, activation or browser acceptance.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { draftBody } = require('./testHelpers/dataMapHandoffFixture');
const { createDataMapHandoffRepository } = require('../server/dataMapHandoffRepository');
const { json, digest } = require('../server/dataMapHandoffPolicy');

const root = path.resolve(__dirname, '../../..');
const outputAt = process.argv.indexOf('--output');
if (outputAt >= 0) assert(process.argv[outputAt + 1], '--output requires a fresh artifacts path');
const output = path.resolve(outputAt < 0 ? path.join(root, 'artifacts/mdm-data-governance-handoff-implementation-20261020-04/conflict-http-' + crypto.randomUUID()) : process.argv[outputAt + 1]);
assert(output.startsWith(path.join(root, 'artifacts') + path.sep), 'evidence must remain under artifacts');
assert(!fs.existsSync(output), 'fresh evidence directory required');
fs.mkdirSync(output, { recursive: true });
const frontend = path.join(output, 'api-only-frontend');
fs.mkdirSync(frontend);
fs.writeFileSync(path.join(frontend, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>API isolation fixture</title><main>仅用于隔离 API 验证</main></html>');
const request = body => ({ request_id: crypto.randomUUID(), ...body });
const checks = [], exchanges = [], targets = [];
let passed = false, failure;
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const evidence = ['synthetic:q6-http:source'];
const proof = { basis: 'synthetic explicit current evidence', evidence_refs: evidence };
async function check(name, work) {
  await work(); checks.push(name); console.log('PASS ' + name);
  save('progress.json', { checks, exchanges, targets });
}

async function seed({ pool, owner, database, document }, state) {
  await require('../server/publicationSchema').managePublicationSchema(pool, 'apply');
  await require('../server/officeSchema').manageOfficeSchema(pool, 'apply');
  for (const sql of require('../server/dataMapDefinitionSchema').statements()) await pool.execute(sql);
  await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)', [require('../server/dataMapDefinitionSchema').MIGRATION_KEY]);
  for (const sql of require('../server/mysqlSchema').splitSqlStatements(require('../server/governanceResponsibilitiesMigration').SCHEMA_SQL)) await pool.execute(sql);
  await require('../server/dataMapHandoffSchema').applyHandoffSchema(pool, { owner, database });
  await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled',cutover_epoch=1 WHERE control_id=1");
  for (const [personId, role] of [[86, 'data_conflict_handler'], [87, 'decision_group'], [88, 'mdm_lead'], [88, 'data_conflict_handler'], [88, 'decision_group']]) {
    const [inserted] = await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT ?,role_id,'global','synthetic q6 HTTP role',CURRENT_DATE FROM roles WHERE role_code=?", [personId, role]);
    assert.equal(inserted.affectedRows, 1, 'required synthetic role exists: ' + role);
  }
  const repository = createDataMapHandoffRepository(pool, { env: { DATA_MAP_HANDOFF_ENABLED: '1', PROCESS_DATA_GOVERNANCE_READ_ONLY: '0' } });
  const lead = { personId: '82', accountId: '182', authVersion: '1' };
  state.drafts = [];
  for (const [versionId, packageId] of [[901, 501], [902, 502]]) {
    const source = structuredClone(document);
    source.process.process_ref += '_' + versionId;
    const hash = digest(source), documentNo = 'Q6-HTTP-' + versionId;
    await pool.execute('INSERT INTO process_design_documents(id,document_no,process_ref,document_title,owning_department_id) VALUES(?,?,?,\'合成来源\',91)', [versionId, documentNo, source.process.process_ref]);
    await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id,schema_version,process_content_json,content_hash,status) VALUES(?,?,?,'合成来源','A','合成流程','合成','合成','合成',91,?,?,?,'published')", [versionId, versionId, documentNo, source.schema_version, json(source), hash]);
    await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,status) VALUES(?,?,?,?,'合成来源','A',?,91,?,?,?,'published')", [versionId, versionId, versionId, documentNo, documentNo + '-A', source.schema_version, json(source), hash]);
    await pool.execute('UPDATE process_design_documents SET current_version_id=? WHERE id=?', [versionId, versionId]);
    await pool.execute("INSERT INTO process_data_governance_work_packages(id,package_ref,process_version_id,source_document_id,owning_department_id,source_content_hash,rule_version,risk_basis_json,status,created_by_person_id) VALUES(?,?,?,?,91,?,'synthetic-only','[]','completed',82)", [packageId, 'package-q6-http-' + packageId, versionId, versionId, hash]);
    await pool.execute("INSERT INTO process_data_governance_details(id,work_package_id,detail_ref,detail_type,source_ref,responsible_department_id,source_snapshot_digest,candidate_rule_code,candidate_json,governance_json,status) VALUES(?,?,'object:source_1','data_object_identity','source_1',91,?,'synthetic-only','{}',?,'confirmed')", [packageId, packageId, digest({ source_ref: 'source_1' }), json({ basis: 'synthetic source identity verified' })]);
    await pool.execute("INSERT INTO process_data_governance_reviews(work_package_id,review_type,decision,basis_text,package_revision_no,actor_person_id,actor_role_code) VALUES(?,'mdm_workgroup','approved','synthetic original review',1,82,'mdm_lead')", [packageId]);
    const intake = await repository.prepareIntake(String(packageId), request({ expected_revision: 0 }), lead);
    const reviewed = await repository.reviewIntake(intake.intake_id, request({ expected_revision: 1, basis: 'synthetic exact source review', detail_evidence: intake.required_detail_evidence.map(item => ({ ...item, ...proof })) }), lead);
    const draft = await repository.fromWorkPackage(String(packageId), request({ expected_revision: 0, binding_id: reviewed.binding_id, draft: draftBody() }), lead);
    const value = await repository.get(draft.handoff_id, lead);
    state.drafts.push({ ...draft, detailRef: value.revision.snapshot_json.items[0].source_detail_refs[0], contentDigest: value.revision.content_digest });
  }
}

async function runEnabled() {
  const state = {}, fixtureDir = path.join(output, 'enabled-fixture');
  let target;
  await withStage05Fixture(async ({ pool, owner, fixture, request: raw }) => {
    target = { owner, ...JSON.parse(fs.readFileSync(path.join(fixtureDir, 'owned-target.json'), 'utf8')), handoffEnabled: true };
    targets.push(target);
    const base = '/api/data-map-handoffs', draft = state.drafts[0], otherDraft = state.drafts[1];
    let handoffRevision = draft.revision, conflict, conflictRevision, other;
    const openedFacts = [], departmentReceipts = [];
    const conflictPath = () => base + '/conflicts/' + conflict.conflict_id;
    const count = async table => Number((await pool.execute('SELECT COUNT(*) n FROM ' + table))[0][0].n);
    async function call(who, url, method = 'GET', body, status = 200) {
      const response = await raw(who, url, method, body);
      exchanges.push({ who, url, method, status: response.status, code: response.body?.code || null });
      assert.equal(response.status, status, `${who} ${method} ${url}: ${JSON.stringify(response.body)}`);
      return response.body;
    }
    const opening = (handoff = draft, severity = 'major') => request({ expected_revision: 0, expected_handoff_revision: handoff.revision, kind: severity === 'major' ? 'cross_department' : 'definition', severity, subject_refs: ['object'], difference: 'synthetic departments disagree on a fixed definition', proposals: ['synthetic retain source', 'synthetic adjust after confirmed facts'], impact: { definitions: ['object'], departments: ['91', '92'] }, affected_department_ids: severity === 'major' ? ['91', '92'] : ['91'], ...proof });
    const acting = (action, extra = {}) => request({ expected_revision: conflictRevision, expected_handoff_revision: handoffRevision, action, ...proof, ...extra });
    const act = async (who, action, extra = {}) => {
      const body = acting(action, extra), result = await call(who, conflictPath() + '/actions', 'POST', body);
      conflictRevision = result.revision; conflict = result;
      if (result.handoff_revision !== undefined) handoffRevision = Number(result.handoff_revision);
      return { body, result };
    };
    const factBody = (revision, extra = {}) => request({ expected_revision: revision, expected_conflict_revision: conflictRevision, expected_handoff_revision: handoffRevision, ...extra });
    function assertDirectedWrite(value, factId) {
      const forbidden = new Set(['conflict', 'events', 'subject_items', 'proposals', 'viewpoints', 'facts', 'affected_department_ids', 'subject_refs', 'assignments', 'escalations', 'resolution', 'verification']);
      function inspect(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(inspect); return; }
        for (const [key, child] of Object.entries(node)) {
          assert(!forbidden.has(key), 'directed fact response leaks unrelated conflict content at key ' + key);
          inspect(child);
        }
      }
      inspect(value);
      const serialized = JSON.stringify(value);
      for (const sentinel of ['synthetic departments disagree on a fixed definition', 'synthetic retain source', 'synthetic adjust after confirmed facts', 'synthetic assigned handler view with fixed evidence', 'synthetic retain current definition with confirmed factual basis']) {
        assert(!serialized.includes(sentinel), 'directed fact response leaks conflict content sentinel');
      }
      for (const fact of openedFacts) if (fact.fact_id !== factId) assert(!serialized.includes(fact.fact_id), 'directed fact response leaks another fact reference');
    }
    async function assertDepartmentReplay(who, url, body, result, factId) {
      assertDirectedWrite(result, factId);
      const replayed = await call(who, url, 'POST', body);
      assertDirectedWrite(replayed, factId); assert.deepEqual(replayed, result);
      const receipt = await call(who, base + '/requests/' + body.request_id);
      assert.equal(receipt.state, 'committed'); assertDirectedWrite(receipt.result, factId); assert.deepEqual(receipt.result, result);
      departmentReceipts.push({ who, request_id: body.request_id, fact_id: factId, result });
    }
    async function openFact(departmentId, label) {
      const body = factBody(0, { detail_ref: draft.detailRef, target_department_id: departmentId, requested_fact_type: 'synthetic_current_fact', question_text: 'synthetic verify current result for ' + label, request_reason: 'synthetic independent fact confirmation for ' + label, evidence_refs: evidence });
      const result = await call('lead', conflictPath() + '/facts', 'POST', body);
      conflictRevision = result.conflict_revision; openedFacts.push({ fact_id: result.fact_id, department_id: departmentId }); return result;
    }
    async function completeFact(fact, answerer, confirmer, { negative = false } = {}) {
      const factPath = base + '/facts/' + fact.fact_id;
      if (negative) {
        await call('reviewB', factPath + '/current', 'GET', undefined, 403);
        await call('reviewB', factPath + '/answers', 'POST', factBody(fact.revision, { answer_text: 'synthetic wrong department', evidence_refs: evidence }), 403);
        await call('contact', conflictPath(), 'GET', undefined, 403);
      }
      const open = await call(answerer, factPath + '/current');
      assert.equal(open.fact_id, fact.fact_id); assert.equal(open.snapshot_digest.length, 64);
      assert(open.allowed_actions.includes('answer'));
      assert(!open.header && !open.revision?.snapshot_json && !open.draft, 'department fact read cannot expose the complete draft');
      const answerBody = factBody(fact.revision, { answer_text: 'synthetic explicitly checked factual response', evidence_refs: evidence });
      const answered = await call(answerer, factPath + '/answers', 'POST', answerBody); conflictRevision = answered.conflict_revision;
      assert.equal(answered.status, 'answered');
      await assertDepartmentReplay(answerer, factPath + '/answers', answerBody, answered, fact.fact_id);
      if (negative) {
        const denied = await call('lead', factPath + '/closures', 'POST', factBody(answered.revision, proof), 409);
        assert.match(denied.code, /NOT_CONFIRMED|NOT_ANSWERED/);
        await call('contact', factPath + '/confirmations', 'POST', factBody(answered.revision, { answered_fact_version_id: answered.fact_version_id, answered_snapshot_digest: '0'.repeat(64), ...proof }), 403);
      }
      const current = await call(confirmer, factPath + '/current');
      assert.equal(current.fact_version_id, answered.fact_version_id);
      assert(current.allowed_actions.includes('confirm'));
      if (negative) {
        const bad = await call(confirmer, factPath + '/confirmations', 'POST', factBody(answered.revision, { answered_fact_version_id: answered.fact_version_id, answered_snapshot_digest: '0'.repeat(64), ...proof }), 409);
        assert.equal(bad.code, 'HANDOFF_FACT_ANSWER_CHANGED');
      }
      const confirmationBody = factBody(answered.revision, { answered_fact_version_id: answered.fact_version_id, answered_snapshot_digest: current.snapshot_digest, ...proof });
      const confirmed = await call(confirmer, factPath + '/confirmations', 'POST', confirmationBody); conflictRevision = confirmed.conflict_revision;
      assert.equal(confirmed.status, 'confirmed');
      await assertDepartmentReplay(confirmer, factPath + '/confirmations', confirmationBody, confirmed, fact.fact_id);
      assert((await call('lead', factPath + '/current')).allowed_actions.includes('close'));
      const closureBody = factBody(confirmed.revision, proof), closed = await call('lead', factPath + '/closures', 'POST', closureBody);
      conflictRevision = closed.conflict_revision; assert.equal(closed.status, 'closed');
      assert.deepEqual(await call('lead', factPath + '/closures', 'POST', closureBody), closed);
      const final = await call('lead', factPath + '/current');
      assert.equal(final.fact_version_id, closed.fact_version_id); assert.equal(final.revision, 4);
      return closed;
    }
    await check('Q6 routes require a session and reject missing CSRF before registering conflict effects', async () => {
      const url = base + '/' + draft.handoff_id + '/conflicts';
      const anonymous = await fetch(fixture.baseURL + url); assert.equal(anonymous.status, 401);
      exchanges.push({ who: 'anonymous', url, method: 'GET', status: anonymous.status });
      const login = await fetch(fixture.baseURL + '/api/org/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginName: 'SYNTHETIC_lead', password: fixture.loginPassword }) });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie').split(';')[0], before = await count('data_map_handoff_requests');
      const result = await fetch(fixture.baseURL + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(opening()) });
      const value = await result.json(); assert.equal(result.status, 403); assert.match(String(value.code || value.error), /CSRF|csrf/);
      exchanges.push({ who: 'lead_no_csrf', url, method: 'POST', status: result.status, code: value.code || null });
      assert.equal(await count('data_map_handoff_requests'), before); assert.equal(await count('data_map_handoff_conflicts'), 0);
    });
    await check('administrators including overlapping business roles and departments cannot create governance conflicts', async () => {
      const before = await count('data_map_handoff_requests');
      for (const who of ['admin', 'adminMulti', 'contact', 'reviewA', 'reviewB', 'outsider', 'multi']) await call(who, base + '/' + draft.handoff_id + '/conflicts', 'POST', opening(), 403);
      assert.equal(await count('data_map_handoff_requests'), before); assert.equal(await count('data_map_handoff_conflicts'), 0);
    });
    await check('major and unrelated conflicts retain exact UUID receipts and optimistic revisions', async () => {
      const body = opening(); conflict = await call('lead', base + '/' + draft.handoff_id + '/conflicts', 'POST', body); conflictRevision = conflict.revision;
      assert.equal(conflict.state, 'open'); assert.equal(conflictRevision, 1);
      assert.deepEqual(await call('lead', base + '/' + draft.handoff_id + '/conflicts', 'POST', body), conflict);
      assert.equal((await call('lead', base + '/requests/' + body.request_id)).state, 'committed');
      const collision = await call('lead', base + '/' + draft.handoff_id + '/conflicts', 'POST', { ...body, difference: 'synthetic changed payload' }, 409);
      assert.equal(collision.code, 'HANDOFF_REQUEST_PAYLOAD_CONFLICT');
      other = await call('lead', base + '/' + otherDraft.handoff_id + '/conflicts', 'POST', opening(otherDraft, 'ordinary'));
      const stale = await call('lead', conflictPath() + '/actions', 'POST', { ...acting('viewpoint', { viewpoint: 'synthetic stale' }), expected_revision: 0 }, 409);
      assert.equal(stale.code, 'HANDOFF_CONFLICT_REVISION_CONFLICT');
    });
    await check('only the explicitly assigned handler reads and coordinates its conflict without full package access', async () => {
      await call('outsider', conflictPath(), 'GET', undefined, 403); await call('multi', conflictPath(), 'GET', undefined, 403);
      await act('lead', 'assign', { assignee_person_id: '86' });
      const assigned = await call('outsider', conflictPath());
      assert.deepEqual(assigned.subject_items.map(item => item.item_ref), ['object']);
      assert(!assigned.draft && !assigned.revision?.snapshot_json && !assigned.binding, 'assigned context excludes the full package');
      assert(assigned.allowed_actions.includes('viewpoint')); assert(assigned.allowed_actions.includes('escalate'));
      for (const who of ['admin', 'adminMulti']) assert.deepEqual((await call(who, conflictPath())).allowed_actions, ['read']);
      await call('outsider', base + '/' + draft.handoff_id, 'GET', undefined, 403);
      await call('outsider', base + '/' + draft.handoff_id + '/conflicts', 'GET', undefined, 403);
      await call('outsider', base + '/conflicts/' + other.conflict_id, 'GET', undefined, 403);
      const { body, result } = await act('outsider', 'viewpoint', { viewpoint: 'synthetic assigned handler view with fixed evidence' });
      assert.deepEqual(await call('outsider', conflictPath() + '/actions', 'POST', body), result);
      assert.equal((await call('outsider', base + '/requests/' + body.request_id)).state, 'committed');
      await call('multi', base + '/requests/' + body.request_id, 'GET', undefined, 403);
      for (const who of ['admin', 'adminMulti']) await call(who, conflictPath() + '/actions', 'POST', acting('assign', { assignee_person_id: '86' }), 403);
      const major = await call('outsider', conflictPath() + '/actions', 'POST', acting('resolve', { resolution: 'synthetic forbidden major shortcut' }), 409);
      assert.equal(major.code, 'HANDOFF_CONFLICT_ESCALATION_REQUIRED');
      await call('multi', conflictPath() + '/actions', 'POST', acting('decide', { resolution: 'synthetic unassigned decision' }), 403);
    });
    await check('escalation explicitly assigns a decision member and a pending fact cannot be closed or bypassed by decision', async () => {
      const { body, result } = await act('outsider', 'escalate', { decision_person_id: '87', severity: 'major' });
      assert.equal(result.state, 'escalated'); assert.deepEqual(await call('outsider', conflictPath() + '/actions', 'POST', body), result);
      const escalated = await call('multi', conflictPath());
      assert.deepEqual(escalated.subject_items.map(item => item.item_ref), ['object']); assert(escalated.allowed_actions.includes('decide'));
      await call('multi', base + '/' + draft.handoff_id, 'GET', undefined, 403);
      await call('multi', base + '/conflicts/' + other.conflict_id, 'GET', undefined, 403);
      const fact = await openFact('91', 'decision evidence');
      const blocked = await call('multi', conflictPath() + '/actions', 'POST', acting('decide', { resolution: 'synthetic premature decision' }), 409);
      assert.equal(blocked.code, 'HANDOFF_CONFLICT_EVIDENCE_PENDING');
      const [[row]] = await pool.execute('SELECT state FROM data_map_handoff_conflicts WHERE conflict_id=?', [conflict.conflict_id]);
      assert.equal(row.state, 'escalated');
      await completeFact(fact, 'contact', 'reviewA', { negative: true });
    });
    await check('a project decision creates a recorded outcome and still requires each department to recheck its facts', async () => {
      const { body, result } = await act('multi', 'decide', { resolution: { choice: 'synthetic retain current definition with confirmed factual basis', responsibility: 'synthetic 91 and 92 confirm separately' } });
      assert.equal(result.state, 'resolved'); assert.deepEqual(await call('multi', conflictPath() + '/actions', 'POST', body), result);
      assert.equal((await call('multi', base + '/requests/' + body.request_id)).state, 'committed');
      const blocked = await call('lead', conflictPath() + '/actions', 'POST', acting('verify'), 409);
      assert.equal(blocked.code, 'HANDOFF_CONFLICT_FACT_RECHECK_REQUIRED');
      assert.equal(await count('data_map_publications'), 0);
      const a = await openFact('91', 'result department A'); await completeFact(a, 'contact', 'reviewA');
      const half = await call('lead', conflictPath() + '/actions', 'POST', acting('verify'), 409);
      assert.equal(half.code, 'HANDOFF_CONFLICT_FACT_RECHECK_REQUIRED');
      const b = await openFact('92', 'result department B'); await completeFact(b, 'reviewB', 'reviewB');
      for (const recorded of departmentReceipts) {
        const receipt = await call(recorded.who, base + '/requests/' + recorded.request_id);
        assertDirectedWrite(receipt.result, recorded.fact_id); assert.deepEqual(receipt.result, recorded.result);
      }
    });
    await check('verification appends one immutable draft revision and exact replay cannot duplicate it', async () => {
      const before = await count('data_map_handoff_revisions');
      const { body, result } = await act('lead', 'verify');
      assert.equal(result.state, 'verified'); assert.equal(handoffRevision, draft.revision + 1);
      assert.equal(await count('data_map_handoff_revisions'), before + 1);
      assert.deepEqual(await call('lead', conflictPath() + '/actions', 'POST', body), result);
      assert.equal(await count('data_map_handoff_revisions'), before + 1);
      const current = await call('lead', base + '/' + draft.handoff_id);
      assert.equal(current.header.state, 'draft'); assert.equal(current.header.current_approval_id, null);
      assert.equal(current.revision.content_digest, draft.contentDigest);
      assert(JSON.stringify(current.revision.dependency_manifest_json).includes(conflict.conflict_id), 'immutable revision freezes conflict verification dependency');
      save('verified-draft.json', current);
    });
    await check('verified Q6 evidence requires new approval and publishes through the ordinary atomic path', async () => {
      const submitted = await call('lead', base + '/' + draft.handoff_id + '/submit', 'POST', request({ expected_revision: handoffRevision }));
      handoffRevision = submitted.revision;
      const current = await call('lead', base + '/' + draft.handoff_id);
      assert.equal(current.report.ready_for_approval, true, JSON.stringify(current.report.gates));
      const approval = await call('lead', base + '/' + draft.handoff_id + '/approvals', 'POST', request({ expected_revision: handoffRevision, decision: 'approved', basis: 'synthetic new approval after decision and separate factual confirmations', binding_digest: current.report.binding_digest }));
      const publication = await call('lead', base + '/' + draft.handoff_id + '/publish', 'POST', request({ expected_revision: handoffRevision, approval_id: approval.approval_id }));
      assert.equal(publication.state, 'published'); assert(publication.publication_id);
      const fixed = await call('lead', base + '/publications/' + publication.publication_id);
      assert.equal(fixed.state, 'published'); assert(JSON.stringify(fixed.manifest).includes(conflict.conflict_id));
      assert.equal(await count('data_map_publications'), 1);
      save('publication-result.json', publication); save('publication-fixed.json', fixed);
    });
  }, options(fixtureDir, state, true));
  target.cleaned = true;
}

function options(evidenceDir, state, enabled) {
  return { randomDatabase: true, handoffEnabled: enabled, departmentAccountability: true, processDataGovernanceVersionId: 901,
    completeSource: true, evidenceDir, frontendDist: frontend,
    testNodePath: path.join(root, 'artifacts/mdm-data-governance-handoff-implementation-20261020-01/test-dependencies/node_modules'),
    createDocument: () => ({ schema_version: 'process-governance-v8', export_meta: {}, process: {}, behaviors: [], flow_relations: [], data_objects: [], data_fields: [], data_relations: [], forms: [] }),
    beforeStart: target => seed(target, state) };
}
async function runDisabled() {
  const state = {}, fixtureDir = path.join(output, 'disabled-fixture');
  let target;
  await withStage05Fixture(async ({ owner, pool, request: raw }) => {
    target = { owner, ...JSON.parse(fs.readFileSync(path.join(fixtureDir, 'owned-target.json'), 'utf8')), handoffEnabled: false }; targets.push(target);
    await check('disabled handoff remains readable while Q6 write cannot register a request or conflict', async () => {
      const base = '/api/data-map-handoffs', draft = state.drafts[0];
      const read = await raw('lead', base + '/' + draft.handoff_id);
      exchanges.push({ who: 'lead', url: base + '/' + draft.handoff_id, method: 'GET', status: read.status, handoffEnabled: false }); assert.equal(read.status, 200);
      const [[before]] = await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_requests');
      const url = base + '/' + draft.handoff_id + '/conflicts';
      const write = await raw('lead', url, 'POST', request({ expected_revision: 0, expected_handoff_revision: draft.revision, kind: 'definition', severity: 'ordinary', subject_refs: ['object'], difference: 'synthetic disabled', proposals: ['synthetic'], impact: 'synthetic', affected_department_ids: ['91'], ...proof }));
      exchanges.push({ who: 'lead', url, method: 'POST', status: write.status, code: write.body?.code, handoffEnabled: false });
      assert.equal(write.status, 503); assert.equal(write.body.code, 'HANDOFF_DISABLED');
      const [[after]] = await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_requests'); assert.equal(Number(after.n), Number(before.n));
      const [[conflicts]] = await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_conflicts'); assert.equal(Number(conflicts.n), 0);
    });
  }, options(fixtureDir, state, false));
  target.cleaned = true;
}
async function main() {
  try { await runEnabled(); await runDisabled(); passed = true; }
  catch (error) { failure = { code: error.code, message: error.message, stack: error.stack }; throw error; }
  finally { save('http-results.json', { passed, checks, exchanges, targets, failure, scope: 'fresh owned tmpfs MySQL, real HTTP session and CSRF, synthetic materials, API-only frontend', formal_database_connected: false, feature_activation: false, browser_verified: false, business_accepted: false }); }
}
main().then(() => console.log('HANDOFF_CONFLICT_HTTP_PASS ' + checks.length + ' ' + output)).catch(error => { console.error(error.code || error.message); if (error.code === 'ERR_ASSERTION') console.error(error.message); process.exitCode = 1; });
