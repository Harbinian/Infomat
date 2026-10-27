// Input: --output <new artifacts directory>. Uses an owned temporary MySQL and HTTP fixture.
// Writes synthetic evidence only; never loads private configuration or touches running 3000/3001.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { contentHash } = require('../server/processPreviewReview');
const outputIndex = process.argv.indexOf('--output');
assert.ok(outputIndex > 0, '--output required');
const output = path.resolve(process.argv[outputIndex + 1]);
assert.ok(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output), 'evidence directory must be new');
fs.mkdirSync(output, { recursive: true });
const root = '/api/process-v7-preview';
const caseBinding = row => ({ expected_revision_no: row.current_revision_no, expected_content_hash: row.current_content_hash });
const draftBinding = row => ({ expected_revision_no: row.revision_no, expected_content_hash: row.content_hash });
function syntheticSource() {
  return {
    schema_version: 'process-governance-v8',
    export_meta: { package_ref: 'package_formal_recovery', exported_at: '2026-10-19T00:00:00.000Z', initiating_department: '合成甲部', compiler: '合成编制人员' },
    process: { process_ref: 'process_formal_recovery', process_name: '', owning_department: '', purpose: '', scope: '', capability_domain: null, business_capability: null, classification_status: 'unclassified' },
    behaviors: [], flow_relations: [], data_objects: [], forms: [], terms: [],
    migration: { source_schema_version: 'process-governance-v8', source_process_ref: null, source_process_count: 1,
      legacy_cross_department_records: [], reference_materials: [], internal_process_calls: [], work_roles: [], unresolved_actor_roles: [], unresolved_join_modes: [] }
  };
}

async function main() {
  await withStage05Fixture(async ({ fixture, expect, request, pool }) => {
    const checks = [];
    const read = id => expect('lead', root + '/cases/' + id, 'GET');
    async function ready(schema, suffix = '') {
      const doc = structuredClone(fixture.document); doc.schema_version = schema; doc.process.process_ref = 'formal_recovery_' + schema + suffix;
      const data = await expect('contact', root + '/cases', 'POST', { document: doc, source_file_name: 'synthetic.json' }, 201);
      for (const who of ['reviewA', 'reviewB']) for (const item of data.items) await expect(who, root + '/items/' + item.id + '/decision', 'POST', { ...caseBinding(data.case), decision: 'confirmed', basis: '合成核对依据' });
      const current = await read(data.case.id);
      await expect('lead', root + '/cases/' + data.case.id + '/promote', 'POST', { ...caseBinding(current.case), target: { mode: 'create', document_no: schema + '-RECOVERY' + suffix, document_title: '合成恢复流程' } }, 201);
      return { caseId: data.case.id, doc };
    }
    async function submit(id) {
      const detail = await read(id), draft = detail.formal_promotion.draft;
      await expect('contact', '/api/process-design/drafts/' + draft.id + '/submit', 'POST', draftBinding(draft));
      return read(id);
    }
    async function decide(id, decision) {
      const detail = await read(id), formal = detail.formal_promotion;
      await expect('reviewA', '/api/process-design/review-tasks/' + formal.review_task.id + '/decision', 'POST', { ...draftBinding(formal.draft), decision, note: '合成审核依据-' + decision });
      return read(id);
    }
    const recoveryBody = detail => ({ ...draftBinding(detail.formal_promotion.draft), expected_review_task_id: detail.formal_promotion.review_task.id, note: '合成恢复原因' });
    async function recovery(who, detail, operation, expected = 200, extra = {}) {
      return expect(who, '/api/process-design/drafts/' + detail.formal_promotion.draft.id + '/' + operation, 'POST', { ...recoveryBody(detail), ...extra }, expected);
    }

    for (const schema of ['process-governance-v8', 'process-governance-v7']) {
      const { caseId, doc } = await ready(schema);
      let detail = await submit(caseId);
      for (const actor of ['multi', 'reviewA', 'reviewB', 'outsider', 'lead', 'admin', 'adminMulti']) await recovery(actor, detail, 'withdraw', 403);
      await recovery('contact', detail, 'withdraw', 422, { note: ' ' });
      await recovery('contact', detail, 'withdraw', 422, { expected_review_task_id: null });
      await recovery('contact', detail, 'withdraw', 409, { expected_content_hash: 'f'.repeat(64) });
      const withdrawn = await recovery('contact', detail, 'withdraw');
      assert.equal(withdrawn.draft.status, 'needs_changes');
      assert.equal(withdrawn.reviewTask.status, 'needs_changes');
      assert.match(withdrawn.reviewTask.decision_note, /^提交人撤回：/);
      await recovery('contact', detail, 'withdraw', 409);
      checks.push(schema + ': submitter-only withdrawal; current role scope; admin read-only; required reason/binding; duplicate refusal');

      const oldBinding = detail;
      detail = await submit(caseId);
      assert.notEqual(detail.formal_promotion.review_task.id, oldBinding.formal_promotion.review_task.id);
      await recovery('contact', oldBinding, 'withdraw', 409);
      detail = await decide(caseId, 'reject');
      const originalRejected = structuredClone(detail.formal_promotion.review_task);
      for (const actor of ['contact', 'reviewB', 'outsider', 'lead', 'admin', 'adminMulti']) await recovery(actor, detail, 'return-for-changes', 403);
      await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='expired' WHERE pr.person_id=84 AND r.role_code='department_mdm_reviewer'");
      await recovery('reviewA', detail, 'return-for-changes', 403);
      await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='active' WHERE pr.person_id=84 AND r.role_code='department_mdm_reviewer'");
      await recovery('reviewA', detail, 'return-for-changes');
      detail = await read(caseId);
      assert.deepEqual(detail.formal_promotion.review_task, originalRejected);
      checks.push(schema + ': rejected draft reopened by current departmental reviewer; historical decision retained; expired assignment denied; old-task request refused');

      detail = await submit(caseId); detail = await decide(caseId, 'approve');
      const originalApproved = structuredClone(detail.formal_promotion.review_task);
      await recovery('reviewA', detail, 'return-for-changes');
      const back = await read(caseId);
      assert.deepEqual(back.formal_promotion.review_task, originalApproved);
      await expect('lead', '/api/process-design/drafts/' + back.formal_promotion.draft.id + '/publish', 'POST', draftBinding(back.formal_promotion.draft), 409);
      detail = await submit(caseId); detail = await decide(caseId, 'approve');

      // Reproduce a pre-fix source mismatch directly inside this owned synthetic database.
      // The original promoted revision remains immutable and must still authenticate recovery.
      const newer = structuredClone(doc); newer.process.purpose += ' 合成历史后续修订';
      const hash = contentHash(newer);
      const [inserted] = await pool.execute(`INSERT INTO process_v7_preview_revisions
        (case_id,revision_no,source_file_name,source_schema_version,content_hash,content_json,uploaded_by_person_id)
        VALUES (?,2,'synthetic-historic-newer.json',?,?,?,83)`, [caseId, schema, hash, JSON.stringify(newer)]);
      await pool.execute(`UPDATE process_v7_preview_cases SET current_revision_id=?,current_revision_no=2,current_content_hash=? WHERE id=?`, [inserted.insertId, hash, caseId]);
      await recovery('reviewA', detail, 'return-for-changes');
      const newerDetail = await read(caseId);
      await expect('contact', '/api/process-design/drafts/' + detail.formal_promotion.draft.id + '/submit', 'POST', draftBinding(detail.formal_promotion.draft), 409);
      await expect('lead', root + '/cases/' + caseId + '/promote', 'POST', { ...caseBinding(newerDetail.case), target: { mode: 'existing', document_id: newerDetail.formal_promotion.document.id } }, 201);
      detail = await submit(caseId); detail = await decide(caseId, 'approve');
      assert.equal(detail.formal_promotion.draft.revision_no, 2);
      const published = await expect('lead', '/api/process-design/drafts/' + detail.formal_promotion.draft.id + '/publish', 'POST', draftBinding(detail.formal_promotion.draft));
      const versionBefore = await expect('lead', '/api/process-design/versions/' + published.process_version_id + '/content', 'GET');
      await recovery('reviewA', detail, 'return-for-changes', 409);
      const versionAfter = await expect('lead', '/api/process-design/versions/' + published.process_version_id + '/content', 'GET');
      assert.deepEqual(versionAfter, versionBefore);
      checks.push(schema + ': approved-return blocks publication until new review; historical preview mismatch recovers and re-promotes; published fixed version immutable');
      const history = await expect('lead', '/api/process-design/drafts/' + detail.formal_promotion.draft.id, 'GET');
      assert.ok(history.events.some(row => row.event_type === 'formal_withdraw'));
      assert.ok(history.events.some(row => row.event_type === 'formal_return_for_changes'));
      assert.ok(history.reviewTasks.some(row => row.status === 'rejected'));
      assert.equal(history.events.find(row => row.event_type === 'publish').payload.review_task_id, detail.formal_promotion.review_task.id);
    }
    const guard = await ready('process-governance-v8', '_upload_guard');
    const guarded = await submit(guard.caseId);
    const newDoc = structuredClone(guard.doc); newDoc.process.purpose += ' 合成恢复后修订';
    const newRevision = { ...caseBinding(guarded.case), document: newDoc, source_file_name: 'synthetic-new-revision.json' };
    await expect('contact', root + '/cases/' + guard.caseId + '/revisions', 'POST', newRevision, 409);
    const attempts = await Promise.all([1, 2].map(() => request('contact', '/api/process-design/drafts/' + guarded.formal_promotion.draft.id + '/withdraw', 'POST', recoveryBody(guarded))));
    assert.deepEqual(attempts.map(result => result.status).sort(), [200, 409]);
    const uploaded = await expect('contact', root + '/cases/' + guard.caseId + '/revisions', 'POST', newRevision, 201);
    assert.equal(uploaded.case.current_revision_no, 2);
    checks.push('new upload refused while formal review is pending; concurrent recovery commits once and upload then succeeds');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', checks }, null, 2));
    console.log('FORMAL_RECOVERY_MYSQL_PASS ' + checks.length + ' scenario groups');
  }, { evidenceDir: output, completeSource: true, randomDatabase: true, createDocument: syntheticSource });
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
