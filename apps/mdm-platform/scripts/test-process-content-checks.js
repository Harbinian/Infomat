// Synthetic, pure regression tests. No database, network or source-material writes.
const test = require('node:test'), assert = require('node:assert/strict');
const { document, node, edge } = require('./testHelpers/v7AnalysisSamples');
const { collectContentChecks, contentBlockingIssues } = require('../server/processContentChecks');
const { validateAndProjectProcess, caseStatusFromItems, unresolvedBlockingIssues } = require('../server/processPreviewReview');
const rules = require('../server/v7AnalysisRules');
const departments = [{ id: 1, name: '质量管理部', code: 'QUALITY' }];
function completeDocument(version = 'process-governance-v8') {
  const d = document(); d.schema_version = version;
  Object.assign(d.export_meta, { initiating_department: '质量管理部', compiler: '合成编制人员' });
  Object.assign(d.process, { owning_department: '质量管理部', purpose: '核对合成记录', scope: '合成范围' });
  d.behaviors.forEach(b => Object.assign(b, { behavior_name: '经办人员填写核对记录', behavior_description: '经办人员填写核对记录并提交记录。',
    current_actor_role: '质量管理部质量工程师', trigger: '收到核对记录时', completion_standard: '核对记录已经填写' }));
  return d;
}
function analyze(d, version = rules.VERSION, check_ids = rules.checksForVersion(version)) {
  return rules.analyze({ parser_version: version, step: { check_ids }, inputs: [{ input_key: 'source', snapshot: {}, document: d }] });
}
test('empty draft has technical success and separate business gaps without mutation', () => {
  for (const version of ['process-governance-v7', 'process-governance-v8']) {
    const d = document(); d.schema_version = version; const before = JSON.stringify(d);
    const preview = validateAndProjectProcess(d, [{ id: 1, name: '合成甲部', code: 'A' }]);
    assert.equal(preview.errors.length, 0); assert(preview.contentChecks.counts.incomplete > 0);
    assert.equal(preview.contentChecks.counts.confirmation, 2);
    assert.equal(caseStatusFromItems([], true, preview.blockingIssues, 'confirmed_no_cross_department'), 'under_review');
    assert.equal(JSON.stringify(d), before);
  }
});
test('blank or company-wide text in fixed assignment cannot bypass actor blocker', () => {
  for (const value of ['', '全公司', '停用部门经办人']) {
    const d = completeDocument(); d.behaviors[0].current_actor_role = value;
    const result = validateAndProjectProcess(d, departments);
    assert(result.blockingIssues.some(issue => issue.code === 'ACTOR_DEPARTMENT_UNRESOLVED'));
    assert(unresolvedBlockingIssues(result.blockingIssues, 'confirmed_no_cross_department').length);
  }
  const d = completeDocument(); d.behaviors[0].actor_assignment_mode = 'company_wide'; d.behaviors[0].current_actor_role = '全公司';
  assert(!validateAndProjectProcess(d, departments).blockingIssues.some(issue => issue.code === 'ACTOR_DEPARTMENT_UNRESOLVED'));
});
test('confirmation does not invent objects or block a complete source; current revision is recomputed', () => {
  const d = completeDocument(), before = JSON.stringify(d);
  const ready = validateAndProjectProcess(d, departments);
  assert.equal(ready.contentChecks.counts.incomplete, 0);
  assert.equal(ready.contentChecks.counts.confirmation, 2);
  assert.equal(caseStatusFromItems([], true, ready.blockingIssues, 'confirmed_no_cross_department'), 'review_complete');
  d.behaviors[0].behavior_description = '';
  const changed = validateAndProjectProcess(d, departments);
  assert.equal(caseStatusFromItems([], true, changed.blockingIssues, 'confirmed_no_cross_department'), 'under_review');
  assert.equal(ready.contentHash, require('../server/processPreviewReview').contentHash(JSON.parse(before)));
});
test('decision using only sequence edges still reports incomplete judgment exits', () => {
  const d = completeDocument(); d.behaviors[0].node_type = 'decision';
  d.behaviors.push({ ...d.behaviors[1], behavior_ref: 'behavior_c' });
  d.flow_relations.push(edge('relation_ac', 'behavior_a', 'behavior_c'));
  const result = analyze(d);
  assert.equal(result.status, 'succeeded');
  assert(result.findings.some(f => f.rule_id === 'v7.decision_branches' && /默认继续路径/.test(f.message)));
});
test('explicit case owner satisfies an empty source owner without rewriting uploaded facts', () => {
  const d = completeDocument(); d.process.owning_department = '';
  const result = validateAndProjectProcess(d, departments, { owningDepartmentName: '质量管理部' });
  assert.equal(result.contentChecks.counts.incomplete, 0); assert.equal(d.process.owning_department, '');
});
test('missing and abstract action descriptions are executable-content diagnostics', () => {
  for (const description of ['', '加强管理，确保质量。', '123']) {
    const d = completeDocument(); d.behaviors[0].behavior_description = description;
    assert(collectContentChecks(d).issues.some(i => i.check_id === 'v7.action_executability'));
  }
});
test('rule failure and technical failure have explicit missing coverage, never a clean result', () => {
  const failed = collectContentChecks(completeDocument(), [], { evaluateContent() { throw new Error('synthetic unavailable'); }, behaviorExecutabilityDetails() {} });
  assert.equal(failed.status, 'unavailable'); assert.equal(contentBlockingIssues(failed)[0].code, 'CONTENT_CHECK_UNAVAILABLE');
  const d = completeDocument(); d.behaviors[0].node_type = 'bad'; const preview = validateAndProjectProcess(d, departments);
  assert(preview.contentChecks.counts.technical > 0); assert.equal(preview.contentChecks.status, 'not_run');
  assert.equal(caseStatusFromItems([], true, preview.blockingIssues, 'confirmed_no_cross_department'), 'under_review');
  const result = analyze(d); assert.equal(result.status, 'partial'); assert(!result.checked_ids.includes('v7.content_completeness'));
});
test('old v1-v3 runs keep eight-check semantics and refuse new check ids', () => {
  for (const version of [rules.LEGACY_VERSION, rules.V2_VERSION, rules.PREVIOUS_VERSION]) {
    const d = document(); if (version === rules.PREVIOUS_VERSION) d.schema_version = 'process-governance-v8';
    const result = analyze(d, version); assert.equal(result.status, 'succeeded'); assert.equal(result.findings.length, 0); assert.equal(result.checked_ids.length, 8);
    assert.equal(analyze(d, version, rules.CHECKS).error_code, 'RULE_VERSION_CHECK_SCOPE_MISMATCH');
  }
  assert.equal(analyze(completeDocument(), rules.V2_VERSION).error_code, 'SOURCE_FORMAT_UNSUPPORTED');
});
test('new finding identities survive array reordering with evidence pointing at original rows', () => {
  const d = document(); d.schema_version = 'process-governance-v8'; d.behaviors[1].node_type = 'decision';
  const first = analyze(d); d.behaviors.reverse(); d.flow_relations.reverse(); const second = analyze(d);
  assert.deepEqual(first.findings, second.findings);
  for (const evidence of second.evidence.filter(e => e.locator)) {
    const found = evidence.locator.split('/').slice(1).reduce((v, key) => v?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], d);
    assert.notEqual(found, undefined);
  }
});
test('offline combination admission retains historical check scopes without invoking AI', () => {
  const offline = require('../server/analysisAiOffline');
  for (const version of [rules.PREVIOUS_VERSION, rules.VERSION]) {
    const m = { rule_version: offline.VERSION, ai_metadata: offline.METADATA,
      parser_versions: { [offline.PARSER]: offline.VERSION, [rules.PARSER]: version }, inputs: [{ input_key: 'source', snapshot: { kind: 'v7_source' } }],
      steps: [{ parser_key: offline.PARSER, input_keys: ['source'], check_ids: offline.CHECKS },
        { parser_key: rules.PARSER, input_keys: ['source'], check_ids: rules.checksForVersion(version) }] };
    assert(offline.enabledManifest(m));
    if (version === rules.PREVIOUS_VERSION) { m.steps[1].check_ids = rules.CHECKS; assert(!offline.enabledManifest(m)); }
  }
});
test('locked formal validation blocks advancement but permits a needs-changes or reject review', () => {
  const { validateLockedDraft } = require('../server/processDesignValidation');
  const projection = require('../server/processPreviewReview');
  const d = completeDocument(); d.behaviors[0].behavior_description = '';
  const hash = projection.contentHash(d), draft = { id: 4, document_id: 3, department_id: 1, revision_no: 1, content_hash: hash, process_content_json: JSON.stringify(d) };
  const context = { previewCase: { id: 1, owning_department_id: 1, status: 'review_complete', current_revision_id: 2,
    current_revision_no: 1, current_content_hash: hash, process_ref: d.process.process_ref, scope_decision: 'confirmed_no_cross_department' },
    revision: { id: 2, revision_no: 1, content_hash: hash }, promotion: { preview_case_id: 1, preview_revision_id: 2, preview_revision_no: 1, document_id: 3, draft_id: 4, content_hash: hash },
    document: { id: 3, owning_department_id: 1, process_ref: d.process.process_ref } };
  const adapters = { project: projection.validateAndProjectProcess, hash: projection.contentHash, unresolved: projection.unresolvedBlockingIssues };
  assert.throws(() => validateLockedDraft(draft, context, departments, adapters), error => error.payload?.code === 'V7_FORMAL_BLOCKING_ISSUES');
  assert.equal(validateLockedDraft(draft, context, departments, adapters, { allowBlockingIssues: true }).preview.contentChecks.counts.incomplete, 1);
});
