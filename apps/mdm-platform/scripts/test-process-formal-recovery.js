// Inputs: synthetic in-memory drafts and sources. No DB, HTTP, private configuration or files.
// Run: node scripts/test-process-formal-recovery.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProcessDesignApplication } = require('../server/processDesignApplication');
const { validateLockedRecoveryDraft } = require('../server/processDesignValidation');
const { contentHash } = require('../server/processPreviewReview');
const { formalRecoveryInput, FORMAL_V7_TRANSACTION_CONTEXT } = require('../server/processDesignPolicy');

function fixture(status = 'submitted', schema = 'process-governance-v8') {
  const document = { schema_version: schema, process: { process_ref: 'synthetic_recovery', process_name: '合成恢复测试' } };
  const hash = contentHash(document);
  let state = {
    draft: { id: 1, schema_version: schema, revision_no: 3, content_hash: hash, department_id: 91, document_id: 4,
      submitted_by: 83, status, process_content_json: JSON.stringify(document) },
    reviewTasks: [{ id: 8, draft_id: 1, draft_revision_no: 3, content_hash: hash,
      status: ['submitted', 'under_review'].includes(status) ? 'pending' : status, decision_note: '原审核依据', decided_by: 84 }],
    promotion: { id: 6, draft_id: 1, document_id: 4, preview_case_id: 7, preview_revision_id: 9, preview_revision_no: 3, content_hash: hash },
    previewCase: { id: 7, process_ref: 'synthetic_recovery', current_revision_id: 10, current_revision_no: 4,
      current_content_hash: 'b'.repeat(64), status: 'needs_changes', owning_department_id: 91 },
    promotedRevision: { id: 9, case_id: 7, revision_no: 3, content_hash: hash, content_json: JSON.stringify(document) },
    document: { id: 4, owning_department_id: 91, process_ref: 'synthetic_recovery', current_version_id: 12 },
    currentVersion: { id: 12, status: 'published', content_hash: 'c'.repeat(64) }, events: []
  };
  const calls = [];
  const options = { expected_revision_no: 3, expected_content_hash: hash, expected_review_task_id: 8 };
  const store = {
    readDraft: async () => structuredClone(state.draft),
    readReviewTask: async id => structuredClone(state.reviewTasks.find(row => row.id === id)),
    assertEnabled: () => {},
    lockContext: async (locator, settings) => { assert.equal(settings.recovery, true); calls.push('lock'); return structuredClone(state); },
    authorizeActor: async settings => { calls.push('authorize'); if (settings.denied) throw Object.assign(Error('denied'), { statusCode: 403 }); return { personId: 83 }; },
    validateRecoveryDraft: async (draft, context) => { calls.push('validate'); return validateLockedRecoveryDraft(draft, context, contentHash); },
    recordReviewDecision: async ({ nextStatus, note }) => { calls.push('task'); Object.assign(state.reviewTasks[0], { status: nextStatus, decision_note: note, decided_by: 83 }); return { affectedRows: 1 }; },
    markRecoveryRequired: async () => { calls.push('draft'); state.draft.status = 'needs_changes'; return { affectedRows: 1 }; },
    recordEvent: async (...args) => { calls.push('event'); state.events.push(args); }
  };
  store.withTransaction = async (draftId, taskId, action) => {
    const before = structuredClone(state); calls.push('begin');
    try { const result = await action({ locator: { draftId, taskId, caseId: 7 }, application: createProcessDesignApplication(store) }); calls.push('commit'); return result; }
    catch (error) { state = before; calls.push('rollback'); throw error; }
  };
  return { store, app: createProcessDesignApplication(store), options, calls, state: () => state,
    run: (operation = 'withdraw', settings = {}) => createProcessDesignApplication(store).recoverDraft({ id: 1 }, operation, '合成恢复原因', 83, { ...options, ...settings }) };
}

for (const schema of ['process-governance-v8', 'process-governance-v7']) {
  for (const status of ['submitted', 'under_review', 'approved', 'rejected']) {
    test(`${schema}: ${status} recovery preserves source, historical decisions and fixed versions`, async () => {
      const f = fixture(status, schema), before = structuredClone(f.state());
      const withdraw = ['submitted', 'under_review'].includes(status);
      const result = await f.run(withdraw ? 'withdraw' : 'return-for-changes');
      assert.equal(result.draft.status, 'needs_changes');
      assert.equal(result.draft.content_hash, before.draft.content_hash);
      assert.equal(result.draft.process_content_json, before.draft.process_content_json);
      assert.deepEqual(f.state().document, before.document);
      assert.deepEqual(f.state().currentVersion, before.currentVersion);
      assert.deepEqual(f.state().promotedRevision, before.promotedRevision);
      if (withdraw) {
        assert.equal(result.reviewTask.status, 'needs_changes');
        assert.equal(result.reviewTask.decision_note, '提交人撤回：合成恢复原因');
      } else assert.deepEqual(f.state().reviewTasks, before.reviewTasks);
      const event = f.state().events[0];
      assert.equal(event[1], withdraw ? 'formal_withdraw' : 'formal_return_for_changes');
      assert.equal(event[4].previous_status, status);
      assert.equal(event[4].review_task_id, 8);
      assert.equal(event[4].current_preview_revision_no, 4);
      assert.deepEqual(f.calls, ['begin', 'lock', 'authorize', 'validate', ...(withdraw ? ['task'] : []), 'draft', 'event', 'commit']);
    });
  }
}

test('recovery rejects missing reason, overlong reason, missing task and forged transaction capability', async () => {
  const f = fixture();
  for (const reason of ['', ' ', 'a'.repeat(1001)]) assert.throws(() => formalRecoveryInput('withdraw', reason, f.options), { code: 'FORMAL_RECOVERY_REASON_REQUIRED' });
  assert.throws(() => formalRecoveryInput('withdraw', '原因', {}), { code: 'FORMAL_RECOVERY_TASK_REQUIRED' });
  assert.throws(() => formalRecoveryInput('unknown', '原因', f.options), { code: 'FORMAL_RECOVERY_OPERATION_INVALID' });
  await assert.rejects(f.run('withdraw', { [FORMAL_V7_TRANSACTION_CONTEXT]: { operation: 'publish', locator: {} } }), { code: 'V7_FORMAL_TRANSACTION_REQUIRED' });
  assert.deepEqual(f.calls, []);
});

test('authorization, stale content and stale task fail before any writes', async () => {
  for (const extra of [{ denied: true }, { expected_revision_no: 2 }, { expected_content_hash: 'd'.repeat(64) }, { expected_review_task_id: 7 }]) {
    const f = fixture(), before = structuredClone(f.state());
    await assert.rejects(f.run('withdraw', extra));
    assert.deepEqual(f.state(), before); assert.equal(f.calls.includes('draft'), false); assert.equal(f.calls.includes('task'), false);
  }
});

test('same-content resubmission cannot be withdrawn by an earlier task-bound request', async () => {
  const f = fixture();
  f.state().reviewTasks.push({ ...f.state().reviewTasks[0], id: 11 });
  await assert.rejects(f.run(), { code: 'V7_REVIEW_CONTENT_STALE' });
  assert.equal(f.state().draft.status, 'submitted');
});

test('duplicates, published drafts and wrong recovery operations cannot alter records', async () => {
  const f = fixture(); await f.run(); const after = structuredClone(f.state());
  await assert.rejects(f.run(), { code: 'V7_FORMAL_DRAFT_STATE_CONFLICT' }); assert.deepEqual(f.state(), after);
  for (const [status, operation] of [['published', 'return-for-changes'], ['approved', 'withdraw'], ['submitted', 'return-for-changes'], ['draft', 'withdraw']]) {
    const item = fixture(status), before = structuredClone(item.state());
    await assert.rejects(item.run(operation), { code: 'V7_FORMAL_DRAFT_STATE_CONFLICT' }); assert.deepEqual(item.state(), before);
  }
});

test('corrupted original promotion, source or task cannot use stale-preview recovery', async () => {
  for (const change of [
    state => { state.promotion.preview_revision_id = 99; },
    state => { state.promotedRevision.case_id = 99; },
    state => { state.promotedRevision.content_json = '{}'; },
    state => { state.draft.process_content_json = '{}'; },
    state => { state.document.owning_department_id = 92; },
    state => { state.reviewTasks[0].content_hash = 'd'.repeat(64); },
    state => { state.reviewTasks[0].draft_id = 99; },
    state => { state.previewCase.process_ref = 'another_process'; }
  ]) {
    const f = fixture(); change(f.state()); const before = structuredClone(f.state());
    await assert.rejects(f.run()); assert.deepEqual(f.state(), before); assert.equal(f.calls.includes('draft'), false);
  }
});

test('conditional update conflicts and audit failure roll back draft and task together', async () => {
  for (const failing of ['recordReviewDecision', 'markRecoveryRequired', 'recordEvent']) {
    const f = fixture(), before = structuredClone(f.state());
    f.store[failing] = failing === 'recordEvent' ? async () => { throw Error('AUDIT_FAILURE'); } : async () => ({ affectedRows: 0 });
    await assert.rejects(f.run()); assert.deepEqual(f.state(), before); assert.equal(f.calls.at(-1), 'rollback');
  }
});

test('legacy retired formats and nontransactional storage remain refused', async () => {
  await assert.rejects(fixture('submitted', 'process-governance-v3').run(), { code: 'LEGACY_PROCESS_RETIRED' });
  const f = fixture(); f.store.withTransaction = async (id, task, action) => action({ locator: { draftId: id }, application: null });
  await assert.rejects(f.run(), { code: 'V7_FORMAL_TRANSACTION_REQUIRED' });
});

test('publication cannot reuse an earlier approval after recovery creates a newer review', async () => {
  const f = fixture('approved');
  f.state().reviewTasks.push({ ...f.state().reviewTasks[0], id: 11, status: 'pending' });
  f.store.lockContext = async () => structuredClone(f.state());
  f.store.validateDraft = async () => {};
  await assert.rejects(f.app.publishDraft({ id: 1 }, '合成发布', 83, f.options), { code: 'V7_REVIEW_CONTENT_STALE' });
  assert.equal(f.state().draft.status, 'approved');
  assert.equal(f.calls.includes('event'), false);
});
