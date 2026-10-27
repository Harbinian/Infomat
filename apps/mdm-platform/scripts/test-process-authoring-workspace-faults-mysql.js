// Real failure injection on a freshly owned tmpfs database and random HTTP port.
// The synthetic triggers exist only for the callback lifetime; no formal target.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { document } = require('./testHelpers/processAuthoringWorkspaceFixture');
const at = process.argv.indexOf('--output'); assert(at > 0, '--output required');
const output = path.resolve(process.argv[at + 1]);
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output), 'new artifacts output required');
fs.mkdirSync(output, { recursive: true });
const root = '/api/process-authoring';
const body = extra => ({ request_id: crypto.randomUUID(), ...extra });
const expected = row => ({ expected_revision_no: row.revision_no, expected_content_hash: row.content_hash });
async function main() {
  await withStage05Fixture(async ({ pool, expect }) => {
    const checks = [], record = name => { checks.push(name); console.log('PASS ' + name); };
    const api = (suffix, method = 'GET', input, status = 200) => expect('contact', root + suffix, method, input, status);
    const source = document(), createBody = body({ document: source });
    const first = await api('/drafts', 'POST', createBody, 201);
    // Treat the first HTTP response as lost: exact UUID/body replay retrieves the
    // committed result, including original identity and document, without edits.
    const repeatedCreate = await api('/drafts', 'POST', createBody);
    assert.equal(repeatedCreate.idempotent, true); assert.deepEqual(repeatedCreate.draft, first.draft);
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_authoring_drafts'))[0][0].n, 1);
    let draft = first.draft;
    const edited = structuredClone(source); edited.behaviors[0].behavior_description += ' 合成保存回执重试。';
    const saveBody = body({ ...expected(draft), document: edited });
    const saved = await api('/drafts/' + draft.id, 'PUT', saveBody); draft = saved.draft;
    const repeatedSave = await api('/drafts/' + draft.id, 'PUT', saveBody);
    assert.equal(repeatedSave.idempotent, true); assert.deepEqual(repeatedSave.draft, draft);
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_authoring_revisions WHERE draft_id=?', [draft.id]))[0][0].n, 2);
    record('unknown creation/save receipt recovers the exact original UUID with a single draft and a single saved snapshot');
    const submitted = await api('/drafts/' + draft.id + '/submit', 'POST', body(expected(draft)));
    const caseId = submitted.case_detail.case.id, baselineCase = submitted.case_detail.case;
    const fromBody = body({ expected_revision_no: baselineCase.current_revision_no, expected_content_hash: baselineCase.current_content_hash });
    await api('/drafts/from-case/' + caseId, 'POST', { ...fromBody, request_id: crypto.randomUUID(), expected_content_hash: 'f'.repeat(64) }, 409);
    const continuation = await api('/drafts/from-case/' + caseId, 'POST', fromBody, 201);
    assert.deepEqual((await api('/drafts/from-case/' + caseId, 'POST', fromBody)).draft, continuation.draft);
    draft = continuation.draft;
    const next = structuredClone(draft.document); next.behaviors[0].behavior_description += ' 合成已有案例原修订。';
    draft = (await api('/drafts/' + draft.id, 'PUT', body({ ...expected(draft), document: next }))).draft;
    const submitBody = body(expected(draft));
    await pool.query(`CREATE TRIGGER process_authoring_snapshot_fault BEFORE INSERT ON process_authoring_revisions FOR EACH ROW
      BEGIN IF NEW.draft_id='${draft.id}' AND NEW.operation='submit' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic snapshot fault'; END IF; END`);
    try {
      await api('/drafts/' + draft.id + '/submit', 'POST', submitBody, 500);
      const current = await expect('lead', '/api/process-v7-preview/cases/' + caseId, 'GET');
      assert.equal(current.case.current_revision_no, 1); assert.equal(current.case.current_content_hash, baselineCase.current_content_hash);
      assert.deepEqual((await api('/drafts/' + draft.id)).draft, draft);
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_v7_preview_revisions WHERE case_id=?', [caseId]))[0][0].n, 1);
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_authoring_requests WHERE request_id=?', [submitBody.request_id]))[0][0].n, 0);
    } finally { await pool.query('DROP TRIGGER process_authoring_snapshot_fault'); }
    const recovered = await api('/drafts/' + draft.id + '/submit', 'POST', submitBody);
    assert.equal(recovered.case_detail.case.current_revision_no, 2); draft = recovered.draft;
    record('snapshot INSERT failure rolls back draft metadata, case revision, review rows and request; exact submission can then retry');
    const finalDocument = structuredClone(draft.document); finalDocument.behaviors[0].behavior_description += ' 合成回执写入故障。';
    const receiptBody = body({ ...expected(draft), document: finalDocument });
    const beforeRevisions = (await pool.execute('SELECT COUNT(*) n FROM process_authoring_revisions WHERE draft_id=?', [draft.id]))[0][0].n;
    await pool.query(`CREATE TRIGGER process_authoring_receipt_fault BEFORE UPDATE ON process_authoring_requests FOR EACH ROW
      BEGIN IF NEW.request_id='${receiptBody.request_id}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic receipt fault'; END IF; END`);
    try {
      await api('/drafts/' + draft.id, 'PUT', receiptBody, 500);
      assert.deepEqual((await api('/drafts/' + draft.id)).draft, draft);
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_authoring_revisions WHERE draft_id=?', [draft.id]))[0][0].n, beforeRevisions);
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_authoring_requests WHERE request_id=?', [receiptBody.request_id]))[0][0].n, 0);
    } finally { await pool.query('DROP TRIGGER process_authoring_receipt_fault'); }
    const final = await api('/drafts/' + draft.id, 'PUT', receiptBody);
    assert.equal(final.draft.revision_no, draft.revision_no + 1);
    assert.equal((await api('/drafts/' + draft.id, 'PUT', receiptBody)).idempotent, true);
    record('request receipt UPDATE failure rolls back the save and audit snapshot; retry adds exactly one revision');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', checks, formal_database_connected: false, business_accepted: false }, null, 2));
    console.log('PROCESS_AUTHORING_FAULTS_MYSQL_HTTP_PASS ' + checks.length + ' groups');
  }, { evidenceDir: output, randomDatabase: true, authoring: true, authoringWorkspace: true, departmentAccountability: true,
    completeSource: true, createDocument: document, document: document(), startupTimeoutMs: 30000 });
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
