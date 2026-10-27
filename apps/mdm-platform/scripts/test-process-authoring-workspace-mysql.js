// Input: --output <new artifacts directory>. Owns one fresh labelled tmpfs MySQL
// and a random HTTP fixture only. No private env, existing database or 3000/3001.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { document: syntheticDocument } = require('./testHelpers/processAuthoringWorkspaceFixture');
const { validateAndProjectProcess } = require('../server/processPreviewReview');
const outAt = process.argv.indexOf('--output');
assert(outAt > 0, '--output required');
const output = path.resolve(process.argv[outAt + 1]);
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output), 'new artifacts output required');
fs.mkdirSync(output, { recursive: true });
const authorRoot = '/api/process-authoring', previewRoot = '/api/process-v7-preview';
const requestBody = extra => ({ request_id: crypto.randomUUID(), ...extra });
const binding = d => ({ expected_revision_no: d.revision_no, expected_content_hash: d.content_hash });
const caseBinding = c => ({ expected_revision_no: c.current_revision_no, expected_content_hash: c.current_content_hash });
const submission = () => ({ sources: [{ reference: 'synthetic:authoring:source', title: '合成编制原始材料', basis: '仅用于隔离技术检查' }],
  purpose: '核对完整编制与审核链', revision_reason: '合成退回修订', change_summary: '明确改动并由原参与部门重新核对',
  participants: ['91','92'].map(department_id => ({ department_id, behavior_refs: [], responsibilities: '本人核对本部门合成事项', basis: '明确的合成参与范围' })) });
async function main() {
  const document = syntheticDocument();
  const projection = validateAndProjectProcess(document, [{ id: 91, name: '合成甲部' }, { id: 92, name: '合成乙部' }]);
  assert.deepEqual(projection.errors, []); assert.deepEqual(projection.blockingIssues, []);
  await withStage05Fixture(async ({ pool, expect, request }) => {
    const checks = [], record = name => { checks.push(name); fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ checks }, null, 2)); console.log('PASS ' + name); };
    const api = (who, suffix, method = 'GET', body, status = 200) => expect(who, authorRoot + suffix, method, body, status);
    const readCase = id => expect('lead', previewRoot + '/cases/' + id, 'GET');
    assert.equal((await api('contact', '/status')).schema_ready, true);
    const workspaceSchema = require('../server/processAuthoringWorkspaceSchema');
    await assert.rejects(workspaceSchema.applyMigration(pool), { code: 'GOVERNANCE_MIGRATION_PERMIT_REQUIRED' });
    await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?', [workspaceSchema.MIGRATION_KEY]);
    assert.equal((await api('contact', '/status')).schema_ready, false);
    await api('contact', '/drafts', 'POST', requestBody({ document }), 503);
    assert.equal((await pool.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [workspaceSchema.MIGRATION_KEY]))[0].length, 0);
    await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [workspaceSchema.MIGRATION_KEY]);
    record('runtime fails closed on unprepared schema and never creates migration markers; formal DDL requires verified migration permit');
    for (const who of ['lead','reviewA','outsider','admin','adminMulti']) await api(who, '/drafts', 'POST', requestBody({ document }), 403);
    const incomplete = structuredClone(document); incomplete.process.process_name = ''; incomplete.process.purpose = ''; incomplete.behaviors[0].behavior_name = '';
    let draft = (await api('contact', '/drafts', 'POST', requestBody({ document: incomplete }), 201)).draft;
    assert.deepEqual((await api('contact', '/drafts/' + draft.id)).draft.document, incomplete);
    await api('outsider', '/drafts/' + draft.id, 'GET', undefined, 403);
    await api('admin', '/drafts/' + draft.id, 'PUT', requestBody({ ...binding(draft), document }), 403);
    await api('adminMulti', '/drafts/' + draft.id + '/submit', 'POST', requestBody(binding(draft)), 403);
    record('incomplete draft explicitly saves and reopens; outsider denied and administrators remain read-only');
    const oldDraft = draft;
    const saveBody = requestBody({ ...binding(draft), document, submission: submission() });
    const saved = await api('contact', '/drafts/' + draft.id, 'PUT', saveBody); draft = saved.draft;
    assert.equal((await api('contact', '/drafts/' + draft.id, 'PUT', saveBody)).idempotent, true);
    const conflict = await api('contact', '/drafts/' + draft.id, 'PUT', requestBody({ ...binding(oldDraft), document: incomplete }), 409);
    assert.equal(conflict.code, 'PROCESS_AUTHORING_REVISION_CONFLICT');
    await api('contact', '/drafts/' + draft.id, 'PUT', { ...saveBody, document: incomplete }, 409);
    const invalid = structuredClone(document); invalid.flow_relations[0].to_behavior_ref = 'missing_behavior';
    await api('contact', '/drafts/' + draft.id, 'PUT', requestBody({ ...binding(draft), document: invalid }), 422);
    assert.deepEqual((await api('contact', '/drafts/' + draft.id)).draft.document, document);
    record('optimistic concurrency, invalid-reference refusal and idempotent save preserve committed draft');
    const concurrentDocument = structuredClone(document); concurrentDocument.process.process_ref += '_concurrent'; concurrentDocument.export_meta.package_ref += '_concurrent';
    const concurrentDraft = (await api('contact', '/drafts', 'POST', requestBody({ document: concurrentDocument }), 201)).draft;
    const concurrentSaves = await Promise.all(['first','second'].map(value => request('contact', authorRoot + '/drafts/' + concurrentDraft.id, 'PUT', requestBody({
      ...binding(concurrentDraft), document: { ...concurrentDocument, process: { ...concurrentDocument.process, purpose: '合成并发输入-' + value } }
    }))));
    assert.deepEqual(concurrentSaves.map(result => result.status).sort(), [200,409]);
    assert.equal((await api('contact', '/drafts/' + concurrentDraft.id)).draft.revision_no, 2);
    record('simultaneous browser saves commit once and refuse a stale overwrite');
    const faultDocument = structuredClone(document); faultDocument.process.process_ref += '_fault'; faultDocument.export_meta.package_ref += '_fault';
    const faultDraft = (await api('contact', '/drafts', 'POST', requestBody({ document: faultDocument, submission: submission() }), 201)).draft;
    const failedRequest = requestBody(binding(faultDraft));
    await pool.query(`CREATE TRIGGER process_authoring_synthetic_failure BEFORE UPDATE ON process_authoring_drafts FOR EACH ROW
      BEGIN IF NEW.draft_id='${faultDraft.id}' AND NEW.case_id IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic draft submission fault'; END IF; END`);
    try {
      await api('contact', '/drafts/' + faultDraft.id + '/submit', 'POST', failedRequest, 500);
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_v7_preview_cases WHERE process_ref=?', [faultDocument.process.process_ref]))[0][0].n, 0);
      assert.deepEqual((await api('contact', '/drafts/' + faultDraft.id)).draft, faultDraft);
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_authoring_requests WHERE request_id=?', [failedRequest.request_id]))[0][0].n, 0);
    } finally { await pool.query('DROP TRIGGER process_authoring_synthetic_failure'); }
    assert.equal((await api('contact', '/drafts/' + faultDraft.id + '/submit', 'POST', failedRequest)).case_detail.case.current_revision_no, 1);
    record('a fault after preview insertion rolls back the whole submission while preserving draft and permits exact-request retry');
    const submitBody = requestBody(binding(draft));
    const parallelSubmissions = await Promise.all([1,2].map(() => api('contact', '/drafts/' + draft.id + '/submit', 'POST', submitBody)));
    assert.deepEqual(parallelSubmissions.map(receipt => receipt.idempotent).sort(), [false,true]);
    let submitted = parallelSubmissions[0];
    assert.equal((await api('contact', '/drafts/' + draft.id + '/submit', 'POST', submitBody)).idempotent, true);
    const caseId = submitted.case_detail.case.id; draft = submitted.draft;
    const initialCaseRead = await expect('contact', '/api/process-v7-preview/cases/' + caseId);
    assert.ok(initialCaseRead.authoring.started_at);
    assert.equal(initialCaseRead.authoring.transfer_available, false);
    // Simulate the supported old workspace defect without rewriting its saved
    // revisions. Reads must derive the closed window and preserve the old row.
    await pool.execute('UPDATE process_v7_authoring SET started_at=NULL WHERE case_id=?', [caseId]);
    const legacyRead = await expect('contact', '/api/process-v7-preview/cases/' + caseId);
    assert.ok(legacyRead.authoring.started_at);
    assert.equal(legacyRead.authoring.started_source, 'saved_workspace_history');
    assert.equal(legacyRead.authoring.transfer_available, false);
    await expect('contact', previewRoot + '/cases/' + caseId + '/authoring-records', 'POST', {
      request_key: crypto.randomUUID(), record_kind: 'transfer', content: '合成旧记录关闭窗口核对', recipient_person_id: '84',
      expected_assignment_version: legacyRead.authoring.assignment_version, ...caseBinding(legacyRead.case)
    }, 409);
    assert.equal((await pool.execute('SELECT started_at FROM process_v7_authoring WHERE case_id=?', [caseId]))[0][0].started_at, null);
    const priorWorkspaceFlag = process.env.PROCESS_AUTHORING_WORKSPACE_ENABLED, priorAuthoringFlag = process.env.PROCESS_V7_AUTHORING_ENABLED;
    try {
      process.env.PROCESS_AUTHORING_WORKSPACE_ENABLED = '0'; process.env.PROCESS_V7_AUTHORING_ENABLED = '1';
      const authoring = require('../server/processV7Authoring');
      assert.ok((await authoring.state(pool,caseId)).started_at);
      await assert.rejects(authoring.candidates(pool,legacyRead.case,{personId:'83',accountId:'183',authVersion:'1'}), error=>error.code==='V7_AUTHORING_TRANSFER_CLOSED');
    } finally {
      if (priorWorkspaceFlag === undefined) delete process.env.PROCESS_AUTHORING_WORKSPACE_ENABLED; else process.env.PROCESS_AUTHORING_WORKSPACE_ENABLED = priorWorkspaceFlag;
      if (priorAuthoringFlag === undefined) delete process.env.PROCESS_V7_AUTHORING_ENABLED; else process.env.PROCESS_V7_AUTHORING_ENABLED = priorAuthoringFlag;
    }
    record('new submission closes transfer atomically; old saved history closes it on read without backfilling the marker');
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_v7_preview_revisions WHERE case_id=?', [caseId]))[0][0].n, 1);
    assert.deepEqual(submitted.case_detail.revision.document, document);
    record('draft submission atomically creates exactly one existing preview case and retains native V9 body');
    async function ready(targetCaseId = caseId) {
      const repo = require('../server/processPreviewReviewRepository').makeProcessPreviewReviewRepository(pool);
      const actors = { headA: { personId: '84', accountId: '184', authVersion: '1' }, headB: { personId: '85', accountId: '185', authVersion: '1' }, lead: { personId: '82', accountId: '182', authVersion: '1' } };
      // Existing repository helpers revalidate the synthetic accounts in MySQL;
      // no decision row or successful review is inserted directly by this test.
      const names = ['PROCESS_V7_PREVIEW_ENABLED','PROCESS_V7_FORMAL_ENABLED','PROCESS_V7_AUTHORING_ENABLED'];
      const old = Object.fromEntries(names.map(name => [name, process.env[name]]));
      Object.assign(process.env, { PROCESS_V7_PREVIEW_ENABLED: '1', PROCESS_V7_FORMAL_ENABLED: '1', PROCESS_V7_AUTHORING_ENABLED: '1' });
      try { await require('./testHelpers/processCaseGovernanceFixture').completeSidecar(repo, targetCaseId, actors, ['91','92']); }
      finally { for (const name of ['PROCESS_V7_PREVIEW_ENABLED','PROCESS_V7_FORMAL_ENABLED','PROCESS_V7_AUTHORING_ENABLED']) { if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name]; } }
      for (const item of (await readCase(targetCaseId)).items) for (const who of ['reviewA','reviewB']) {
        const current = await readCase(targetCaseId);
        await expect(who, previewRoot + '/items/' + item.id + '/decision', 'POST', { ...caseBinding(current.case), decision: 'confirmed', basis: '合成负责人本人确认本部门事实', expected_dispute_event_id: current.review_dispute_event_id });
      }
      return readCase(targetCaseId);
    }
    let detail = await ready();
    await expect('lead', `${previewRoot}/cases/${caseId}/promote`, 'POST', { ...caseBinding(detail.case), target: { mode: 'create', document_no: 'SYN-AUTHORING', document_title: '合成编制整合流程' } }, 201);
    detail = await readCase(caseId);
    let formal = detail.formal_promotion;
    await expect('contact', '/api/process-design/drafts/' + formal.draft.id + '/submit', 'POST', binding(formal.draft));
    let revision = (await api('contact', '/drafts/from-case/' + caseId, 'POST', requestBody(caseBinding(detail.case)), 201)).draft;
    const nextDocument = structuredClone(revision.document); nextDocument.behaviors[0].behavior_description += ' 补充明确的合成退回要求。';
    revision = (await api('contact', '/drafts/' + revision.id, 'PUT', requestBody({ ...binding(revision), document: nextDocument, submission: submission() }))).draft;
    const blocked = await api('contact', '/drafts/' + revision.id + '/submit', 'POST', requestBody(binding(revision)), 409);
    assert.equal(blocked.code, 'V7_FORMAL_RECOVERY_REQUIRED');
    assert.deepEqual((await api('contact', '/drafts/' + revision.id)).draft.document, nextDocument);
    detail = await readCase(caseId); formal = detail.formal_promotion;
    await expect('reviewA', '/api/process-design/review-tasks/' + formal.review_task.id + '/decision', 'POST', { ...binding(formal.draft), decision: 'needs_changes',
      review_evidence: { problem: '合成编制描述需要明确', basis: '合成原始材料', revision_request: '补充合成行为的办理条件' } });
    submitted = await api('contact', '/drafts/' + revision.id + '/submit', 'POST', requestBody(binding(revision)));
    assert.equal(submitted.case_detail.case.current_revision_no, 2);
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_design_review_tasks WHERE status=?', ['needs_changes']))[0][0].n, 1);
    record('pending formal review blocks new revision and keeps draft; actual needs-changes decision permits same-case revision');
    // Source changes cannot silently replace a newer case revision.
    const staleSource = (await api('contact', '/drafts/from-case/' + caseId, 'POST', requestBody(caseBinding(submitted.case_detail.case)), 201)).draft;
    revision = submitted.draft;
    const thirdDocument = structuredClone(revision.document); thirdDocument.behaviors[0].behavior_description += ' 第二次合成修订。';
    revision = (await api('contact', '/drafts/' + revision.id, 'PUT', requestBody({ ...binding(revision), document: thirdDocument, submission: submission() }))).draft;
    submitted = await api('contact', '/drafts/' + revision.id + '/submit', 'POST', requestBody(binding(revision)));
    const staleChanged = structuredClone(staleSource.document); staleChanged.behaviors[0].behavior_description += ' 保留来源过期时的输入。';
    const staleSaved = (await api('contact', '/drafts/' + staleSource.id, 'PUT', requestBody({ ...binding(staleSource), document: staleChanged }))).draft;
    assert.equal(staleSaved.source_changed, true);
    assert.equal((await api('contact', '/drafts/' + staleSource.id + '/submit', 'POST', requestBody(binding(staleSaved)), 409)).code, 'PROCESS_AUTHORING_SOURCE_CONFLICT');
    assert.deepEqual((await api('contact', '/drafts/' + staleSource.id)).draft.document, staleChanged);
    record('source-case conflict refuses submission while retaining newly saved compiler input');
    detail = await ready();
    await expect('lead', `${previewRoot}/cases/${caseId}/promote`, 'POST', { ...caseBinding(detail.case), target: { mode: 'existing', document_id: detail.formal_promotion.document.id } }, 201);
    detail = await readCase(caseId); formal = detail.formal_promotion;
    await expect('contact', '/api/process-design/drafts/' + formal.draft.id + '/submit', 'POST', binding(formal.draft));
    detail = await readCase(caseId); formal = detail.formal_promotion;
    await expect('reviewA', '/api/process-design/review-tasks/' + formal.review_task.id + '/decision', 'POST', { ...binding(formal.draft), decision: 'approve', note: '合成负责人本人确认' });
    const published = await expect('lead', '/api/process-design/drafts/' + formal.draft.id + '/publish', 'POST', binding(formal.draft));
    const fixedBefore = await expect('lead', '/api/process-design/versions/' + published.process_version_id + '/content', 'GET');
    assert.deepEqual(fixedBefore.document, thirdDocument);
    assert.equal((await readCase(caseId)).case.current_revision_no, 3);
    record('current-department recheck, promotion, owner submit, responsible-person approval and platform publication run existing chain');
    const publishedRevision = (await api('contact', '/drafts/from-case/' + caseId, 'POST', requestBody(caseBinding((await readCase(caseId)).case)), 201)).draft;
    const afterPublication = structuredClone(publishedRevision.document); afterPublication.behaviors[0].behavior_description += ' 已发布版本后的新一轮修订。';
    const nextRound = (await api('contact', '/drafts/' + publishedRevision.id, 'PUT', requestBody({ ...binding(publishedRevision), document: afterPublication, submission: submission() }))).draft;
    assert.equal((await api('contact', '/drafts/' + nextRound.id + '/submit', 'POST', requestBody(binding(nextRound)))).case_detail.case.current_revision_no, 4);
    assert.deepEqual(await expect('lead', '/api/process-design/versions/' + published.process_version_id + '/content', 'GET'), fixedBefore);
    record('a new round continues the original published case while the fixed published body stays immutable');
    const archive = (await pool.execute('SELECT revision_no,operation FROM process_authoring_revisions WHERE draft_id=? ORDER BY revision_no', [draft.id]))[0];
    assert.deepEqual(archive.map(x => x.operation), ['create','save','submit']);
    for (const format of ['process-governance-v8', 'process-governance-v7']) {
      const legacy = require('./testHelpers/processCaseGovernanceFixture').document();
      legacy.schema_version = format; legacy.migration.source_schema_version = format; legacy.process.owning_department = '合成甲部'; legacy.behaviors[0].current_actor_role = '合成甲部经办人';
      const legacyDraft = (await api('contact', '/drafts', 'POST', requestBody({ document: legacy }), 201)).draft;
      const legacySubmitted = await api('contact', '/drafts/' + legacyDraft.id + '/submit', 'POST', requestBody(binding(legacyDraft)));
      assert.deepEqual(legacySubmitted.case_detail.revision.document, legacy);
      assert.equal(legacySubmitted.case_detail.revision.source_schema_version, format);
    }
    const assignedDoc = structuredClone(document); assignedDoc.process.process_ref += '_assigned'; assignedDoc.export_meta.package_ref += '_assigned';
    const assignmentCase = (await expect('contact', previewRoot + '/cases', 'POST', { document: assignedDoc, source_file_name: '合成待分派编制材料.json', submission: submission() }, 201)).case;
    const assignmentDetail = await readCase(assignmentCase.id);
    await expect('contact', previewRoot + '/cases/' + assignmentCase.id + '/authoring-records', 'POST', {
      request_key: crypto.randomUUID(), record_kind: 'transfer', content: '合成主对接人明确委托同部门编制人员', recipient_person_id: '84',
      expected_assignment_version: assignmentDetail.authoring.assignment_version, ...caseBinding(assignmentCase)
    });
    let assigned = (await api('contact', '/drafts/from-case/' + assignmentCase.id, 'POST', requestBody(caseBinding(assignmentCase)), 201)).draft;
    const assignedEdit = structuredClone(assigned.document); assignedEdit.behaviors[0].behavior_description += ' 由明确编制人员保存。';
    await api('contact', '/drafts/' + assigned.id, 'PUT', requestBody({ ...binding(assigned), document: assignedEdit }), 403);
    const compilerDraft = await api('reviewA', '/drafts/' + assigned.id);
    assert(compilerDraft.allowed_actions.includes('save')); assert(!compilerDraft.allowed_actions.includes('submit'));
    assigned = (await api('reviewA', '/drafts/' + assigned.id, 'PUT', requestBody({ ...binding(assigned), document: assignedEdit }))).draft;
    await api('reviewA', '/drafts/' + assigned.id + '/submit', 'POST', requestBody(binding(assigned)), 403);
    const contactReceipt = await api('contact', '/drafts/' + assigned.id + '/submit', 'POST', requestBody(binding(assigned)));
    assert.equal(contactReceipt.case_detail.case.current_revision_no, 2);
    assert((await readCase(assignmentCase.id)).authoring.started_at);
    record('explicit compiler transfer precedes first workspace save or submit; compiler saves and current owning contact separately submits without impersonation');
    for (const decision of ['reject','approve']) {
      let current = await ready(assignmentCase.id);
      await expect('lead', previewRoot + '/cases/' + assignmentCase.id + '/promote', 'POST', { ...caseBinding(current.case), target: current.formal_promotion
        ? { mode: 'existing', document_id: current.formal_promotion.document.id }
        : { mode: 'create', document_no: 'SYN-AUTHORING-RECOVERY', document_title: '合成分工恢复流程' } }, 201);
      current = await readCase(assignmentCase.id); let formal = current.formal_promotion;
      await expect('contact', '/api/process-design/drafts/' + formal.draft.id + '/submit', 'POST', binding(formal.draft));
      current = await readCase(assignmentCase.id); formal = current.formal_promotion;
      await expect('reviewA', '/api/process-design/review-tasks/' + formal.review_task.id + '/decision', 'POST', { ...binding(formal.draft), decision, note: '合成本人确认',
        ...(decision === 'reject' ? { review_evidence: { problem: '合成必要事实需修订', basis: '合成原始材料', revision_request: '在3000原案例明确修改后重新核对' } } : {}) });
      current = await readCase(assignmentCase.id); formal = current.formal_promotion;
      const historicalDecision = structuredClone(formal.review_task);
      let recoveryDraft = (await api('reviewA', '/drafts/from-case/' + assignmentCase.id, 'POST', requestBody(caseBinding(current.case)), 201)).draft;
      const recoveryDocument = structuredClone(recoveryDraft.document); recoveryDocument.behaviors[0].behavior_description += ' 合成正式恢复后修订-' + decision;
      recoveryDraft = (await api('reviewA', '/drafts/' + recoveryDraft.id, 'PUT', requestBody({ ...binding(recoveryDraft), document: recoveryDocument, submission: submission() }))).draft;
      assert.equal((await api('contact', '/drafts/' + recoveryDraft.id + '/submit', 'POST', requestBody(binding(recoveryDraft)), 409)).code, 'V7_FORMAL_RECOVERY_REQUIRED');
      const recoveryBody = { ...binding(formal.draft), expected_review_task_id: formal.review_task.id, note: '合成部门负责人按本人原决定退回修改' };
      await expect('contact', '/api/process-design/drafts/' + formal.draft.id + '/return-for-changes', 'POST', recoveryBody, 403);
      await expect('reviewA', '/api/process-design/drafts/' + formal.draft.id + '/return-for-changes', 'POST', recoveryBody);
      assert.deepEqual((await readCase(assignmentCase.id)).formal_promotion.review_task, historicalDecision);
      assert.equal((await api('contact', '/drafts/' + recoveryDraft.id + '/submit', 'POST', requestBody(binding(recoveryDraft)))).case_detail.case.current_revision_no, current.case.current_revision_no + 1);
    }
    record('rejected and approved-unpublished drafts require current responsible-person recovery; previous decisions remain immutable before same-case resubmission');
    assert.deepEqual(await expect('lead', '/api/process-design/versions/' + published.process_version_id + '/content', 'GET'), fixedBefore);
    record('append-only compiler snapshots and historical V8/V7 native bodies retained; published fixed version unchanged');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', checks, formal_database_connected: false, business_accepted: false }, null, 2));
    console.log('PROCESS_AUTHORING_MYSQL_HTTP_PASS ' + checks.length + ' scenario groups');
  }, { evidenceDir: output, randomDatabase: true, authoring: true, authoringWorkspace: true, departmentAccountability: true, completeSource: true,
    createDocument: syntheticDocument, document, startupTimeoutMs: 30000 });
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
