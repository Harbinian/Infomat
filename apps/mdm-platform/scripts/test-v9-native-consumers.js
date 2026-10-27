// Synthetic native-format consumer checks. Execute with blockRealMysql.js;
// SQL executors below are explicit in-memory doubles, never connection factories.
const test = require('node:test');
const assert = require('node:assert/strict');
const { document: emptyDocument, binding } = require('./testHelpers/v7AnalysisSamples');
const projection = require('../server/processPreviewReview');
const rules = require('../server/v7AnalysisRules');
const { collectContentChecks, contentBlockingIssues } = require('../server/processContentChecks');
const { versionDocument } = require('../server/processDataGovernanceRepository');
const fixed = require('../server/fixedSourceValues');
const { processV7ProcedureMarkdown } = require('../server/processV7ProcedureMarkdown');
const { SUPPORTED_SCHEMAS } = require('../server/processNativeFormats');
const departments = [{ id: 1, code: 'A', name: '合成甲部' }, { id: 2, code: 'B', name: '合成乙部' }];

function complete(format = 'process-governance-v9', withData = true) {
  const doc = withData ? binding() : emptyDocument();
  doc.schema_version = format;
  Object.assign(doc.export_meta, { initiating_department: '合成甲部', compiler: '合成编制人员' });
  Object.assign(doc.process, { owning_department: '合成甲部', purpose: '核对合成记录', scope: '合成范围' });
  doc.behaviors.forEach((behavior, index) => Object.assign(behavior, {
    behavior_name: index ? '核对人员核对申请记录' : '经办人员填写申请记录',
    behavior_description: index ? '核对人员读取申请记录并核对字段。' : '经办人员填写申请记录并提交记录。',
    current_actor_role: index ? '合成乙部核对人员' : '合成甲部经办人员',
    trigger: '收到申请记录时', completion_standard: '申请记录已经核对'
  }));
  if (withData) {
    doc.data_objects = [doc.data_objects[0]];
    const data = doc.data_objects[0];
    Object.assign(data, { data_name: '合成申请记录', description: '用于合成回归测试的独立记录。' });
    data.behavior_links = [
      { link_ref: 'create_a', behavior_ref: 'behavior_a', operation: 'create', updated_field_refs: [] },
      { link_ref: 'use_b', behavior_ref: 'behavior_b', operation: 'use', updated_field_refs: [] }
    ];
    data.source_relations = [{ source_ref: 'source_prior', source_department: '合成甲部',
      source_process_name: '合成历史流程', source_behavior_name: '登记人员登记历史记录', source_data_name: '合成既有记录',
      availability_mode: 'process_start', available_from_behavior_ref: null }];
    if (format === 'process-governance-v9') {
      Object.assign(data, { record_model: 'record_collection', collection_field_refs: ['field_a'] });
      Object.assign(data.behavior_links[0], { record_scope: 'new_instance', presence: 'required' });
      Object.assign(data.behavior_links[1], { record_scope: 'prior_records', presence: 'if_exists' });
      data.source_relations[0].presence = 'if_exists';
    }
  }
  if (format === 'process-governance-v9') doc.process.entry_behavior_refs = ['behavior_a'];
  return doc;
}
function project(doc) { return projection.validateAndProjectProcess(doc, departments); }
function analyze(doc, version = rules.VERSION) {
  return rules.analyze({ parser_version: version, step: { check_ids: rules.checksForVersion(version) },
    inputs: [{ input_key: 'source', snapshot: { schema_version: doc.schema_version, validation_status: 'valid' }, document: doc }] });
}

test('native V9 and historical V8/V7 projections preserve original bodies and digests', () => {
  for (const format of SUPPORTED_SCHEMAS) {
    const doc = complete(format), before = JSON.stringify(doc), hash = projection.contentHash(doc);
    const result = project(doc);
    assert.deepEqual(result.errors, []);
    assert.equal(result.document.schema_version, format);
    assert.equal(result.contentHash, hash);
    assert.equal(JSON.stringify(doc), before);
    if (format !== 'process-governance-v9') {
      assert(!Object.hasOwn(doc.process, 'entry_behavior_refs'));
      assert(!Object.hasOwn(doc.data_objects[0], 'record_model'));
    }
    const row = { schema_version: format, process_content_json: before, content_hash: hash, status: 'published', department_id: '1' };
    assert.deepEqual(versionDocument(row), doc);
    const readback = fixed.projectReference('published_version', row, versionDocument);
    assert.deepEqual(readback.document, doc);
    assert.equal(readback.content_digest, hash);
    assert.throws(() => versionDocument({ ...row, content_hash: '0'.repeat(64) }), error => error.code === 'PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED');
    assert.equal(JSON.stringify(doc), before);
  }
});

test('V9 review digest binds entry, collection, record and source existence semantics', () => {
  const doc = complete(), before = JSON.stringify(doc), initial = project(doc);
  assert.equal(initial.items.length, 1);
  const item = initial.items[0];
  assert.equal(item.item_snapshot.digest_version, projection.V9_REVIEW_ITEM_DIGEST_VERSION);
  assert.deepEqual(item.item_snapshot.process_context.entry_behavior_refs, doc.process.entry_behavior_refs);
  const data = item.item_snapshot.data_objects[0];
  assert.equal(data.record_model, 'record_collection');
  assert.deepEqual(data.collection_field_refs, ['field_a']);
  assert(data.behavior_links.some(link => link.record_scope === 'prior_records' && link.presence === 'if_exists'));
  assert.equal(data.source_relations[0].presence, 'if_exists');
  const mutations = {
    entry: value => value.process.entry_behavior_refs.push('behavior_b'),
    record_model: value => { value.data_objects[0].record_model = 'pending_confirmation'; },
    collection_fields: value => { value.data_objects[0].collection_field_refs = []; },
    record_scope: value => { value.data_objects[0].behavior_links[1].record_scope = 'current_instance'; },
    presence: value => { value.data_objects[0].behavior_links[1].presence = 'required'; },
    source_presence: value => { value.data_objects[0].source_relations[0].presence = 'required'; }
  };
  const confirmed = [{ ...item, id: 9, origin_status: 'confirmed', counterparty_status: 'confirmed', status: 'confirmed' }];
  const confirmedBefore = JSON.stringify(confirmed);
  for (const [name, mutate] of Object.entries(mutations)) {
    const changed = structuredClone(doc); mutate(changed);
    const next = project(changed); assert.deepEqual(next.errors, [], name);
    assert.notEqual(next.items[0].item_digest, item.item_digest, name);
    const merged = projection.mergeReviewItems(confirmed, next.items)[0];
    assert.equal(merged.carry_state, 'reopened', name);
    assert.equal(merged.origin_status, 'pending', name);
    assert.equal(merged.counterparty_status, 'pending', name);
    assert.equal(JSON.stringify(confirmed), confirmedBefore);
  }
  assert.equal(JSON.stringify(doc), before);
});

test('historical v2 opinions remain reusable only for unchanged V8/V7; V9 reopens them', () => {
  for (const format of ['process-governance-v8', 'process-governance-v7']) {
    const old = project(complete(format)).items[0];
    assert.equal(old.item_snapshot.digest_version, 'process-v7-review-item-v2');
    const opinion = { ...old, id: 9, origin_status: 'confirmed', counterparty_status: 'confirmed' };
    assert.equal(projection.mergeReviewItems([opinion], project(complete(format)).items)[0].carry_state, 'carried_forward');
    assert.equal(projection.mergeReviewItems([opinion], project(complete()).items)[0].carry_state, 'reopened');
  }
});

test('v5 admits V9 while v1-v4 never reinterpret a V9 source', () => {
  const doc = complete(), before = JSON.stringify(doc), result = analyze(doc);
  assert.equal(rules.inputFormat({ document: doc }).format_state, 'native_v9');
  assert.equal(result.status, 'succeeded'); assert.equal(result.checked_ids.length, 11);
  for (const version of [rules.LEGACY_VERSION, rules.V2_VERSION, rules.PREVIOUS_VERSION, rules.CONTENT_V4_VERSION]) {
    const old = analyze(doc, version);
    assert.equal(old.status, 'failed'); assert.equal(old.error_code, 'SOURCE_FORMAT_UNSUPPORTED');
    assert.deepEqual(old.checked_ids, []); assert.deepEqual(old.findings, []);
  }
  assert.equal(JSON.stringify(doc), before);
});

test('V9 comparisons retain format metadata and fence changed formats and rule semantics', () => {
  function run(doc, id, version = rules.VERSION) {
    const output = analyze(doc, version), checkIds = rules.checksForVersion(version);
    const snapshot = { kind: 'v7_source', ref_id: '10', identity: { kind: 'preview_revision', id: '20' },
      schema_version: doc.schema_version, content_digest: projection.contentHash(doc), validation_status: 'valid' };
    return { run_id: id, scope_department_id: '1', status: output.status, manifest_digest: 'synthetic-manifest-' + id,
      manifest: { inputs: [{ input_key: 'source', snapshot }], check_scope: { check_ids: checkIds },
        rule_version: version, parser_versions: { [rules.PARSER]: version }, ai_metadata: null,
        steps: [{ step_key: 'check', input_keys: ['source'], check_ids: checkIds, parser_key: rules.PARSER }] },
      documents: { source: doc }, attempts: [{ attempt_id: id + '1', step_key: 'check', attempt_no: 1, status: output.status,
        coverage: { checked: output.checked_ids, missing: checkIds.filter(value => !output.checked_ids.includes(value)) },
        findings: output.findings.map((finding, index) => ({ ...finding, finding_id: id + String(index), rule_version: version, comparison_algorithm: 'analysis-subject-v1' })),
        evidence: output.evidence.map(evidence => ({ ...evidence, fixed_reference: snapshot })) }] };
  }
  const compare = require('../server/analysisComparison').compareAnalysisSnapshots;
  const before = run(complete(), '11'), after = run(complete(), '22');
  const same = compare(before, after);
  assert.equal(same.input_formats.before[0].format_state, 'native_v9');
  assert(!same.comparability_reasons.includes('SOURCE_FORMAT_UNRESOLVED'));
  assert.equal(same.implies_remediation, false);
  const changed = compare(run(complete('process-governance-v8'), '33', rules.CONTENT_V4_VERSION), after);
  assert(changed.comparability_reasons.includes('SOURCE_FORMAT_CHANGED'));
  assert(changed.comparability_reasons.includes('RULE_SEMANTICS_UNMAPPED'));
  assert.equal(changed.implies_remediation, false);
  assert.equal(changed.comparison_complete, false);
});

test('V9 unknown existence semantics are visible confirmations and trusted formal blockers', () => {
  const cases = {
    entry_without_objects: () => { const value = complete('process-governance-v9', false); value.process.entry_behavior_refs = []; return value; },
    record_model: () => { const value = complete(); value.data_objects[0].record_model = 'pending_confirmation'; return value; },
    source_presence: () => { const value = complete(); value.data_objects[0].source_relations[0].presence = 'pending_confirmation'; return value; },
    link_presence: () => { const value = complete(); value.data_objects[0].behavior_links[1].presence = 'pending_confirmation'; return value; }
  };
  for (const [name, make] of Object.entries(cases)) {
    const doc = make(), before = JSON.stringify(doc), result = project(doc);
    assert.deepEqual(result.errors, [], name);
    const blockers = result.contentChecks.issues.filter(issue => issue.blocking === true && /^V9_DATA_/.test(issue.rule_code));
    assert(blockers.length, name); assert(blockers.some(issue => issue.group === 'confirmation'), name);
    assert(contentBlockingIssues(result.contentChecks).some(issue => issue.blocking === true), name);
    assert(result.blockingIssues.some(issue => issue.blocking === true), name);
    assert.equal(projection.caseStatusFromItems([], true, result.blockingIssues, 'confirmed_no_cross_department'), 'under_review', name);
    assert.equal(JSON.stringify(doc), before);
  }
  const historical = collectContentChecks(complete('process-governance-v8', false));
  assert(historical.issues.some(issue => issue.group === 'confirmation'));
  assert(!historical.issues.some(issue => issue.blocking));
  assert.equal(contentBlockingIssues(historical).length, 0);
});

test('formal locked-source advancement rejects a V9 entry confirmation without relying on other missing content', () => {
  const doc = complete('process-governance-v9', false); doc.process.entry_behavior_refs = [];
  const projected = project(doc); assert.equal(projected.contentChecks.counts.incomplete, 0);
  const hash = projection.contentHash(doc), draft = { id: 4, document_id: 3, department_id: 1, revision_no: 1, content_hash: hash, process_content_json: JSON.stringify(doc) };
  const context = { previewCase: { id: 1, owning_department_id: 1, status: 'review_complete', current_revision_id: 2,
    current_revision_no: 1, current_content_hash: hash, process_ref: doc.process.process_ref, scope_decision: 'confirmed_no_cross_department' },
  revision: { id: 2, revision_no: 1, content_hash: hash }, promotion: { preview_case_id: 1, preview_revision_id: 2,
    preview_revision_no: 1, document_id: 3, draft_id: 4, content_hash: hash }, document: { id: 3, owning_department_id: 1, process_ref: doc.process.process_ref } };
  const adapters = { project: projection.validateAndProjectProcess, hash: projection.contentHash, unresolved: projection.unresolvedBlockingIssues };
  assert.throws(() => require('../server/processDesignValidation').validateLockedDraft(draft, context, departments, adapters),
    error => error.payload?.code === 'V7_FORMAL_BLOCKING_ISSUES');
});

test('formal lists, work-package sources and read-only rollback guards include all native formats', async () => {
  const reads = [], pool = { execute: async (sql, params = []) => { reads.push({ sql, params });
    assert(!/^(?:\s*)(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(sql));
    if (sql.includes('AS draft_count')) return [[{ document_count: 0, draft_count: 1, version_count: 1, review_binding_count: 0 }]];
    return [[]]; } };
  const formal = require('../server/processDesignMysqlRepository').makeProcessDesignMysqlRepository(pool);
  await formal.searchVersions({ query: '', beforeId: null, globalRead: true, departmentId: 1 });
  await formal.listDocumentDrafts('3', { beforeId: null, globalRead: true, departmentId: 1 });
  await require('../server/processDataGovernanceRepository').makeProcessDataGovernanceRepository(pool).listPublishedVersions();
  const usage = await require('../server/processV7FormalMigration').inspectNativeFormalUsage(pool, {
    columns: { document_process_ref: { exists: true }, review_draft_revision_no: { exists: false }, review_content_hash: { exists: false } },
    promotion_table: { rows: 0 }
  });
  assert.equal(reads.length, 4); assert.equal(usage.draft_count, 1); assert.equal(usage.version_count, 1);
  assert.deepEqual(reads[0].params.slice(0, SUPPORTED_SCHEMAS.length), SUPPORTED_SCHEMAS);
  assert.deepEqual(reads[1].params.slice(1, SUPPORTED_SCHEMAS.length + 1), SUPPORTED_SCHEMAS);
  assert.deepEqual(reads[2].params, SUPPORTED_SCHEMAS);
  assert.deepEqual(reads[3].params, [...SUPPORTED_SCHEMAS, ...SUPPORTED_SCHEMAS]);
});

test('read-only procedure projection retains V9 record semantics without inventing them on V8/V7', () => {
  for (const format of SUPPORTED_SCHEMAS) {
    const doc = complete(format), before = JSON.stringify(doc);
    const text = processV7ProcedureMarkdown({ schema_version: format, document: doc, status: 'published', content_hash: projection.contentHash(doc) });
    if (format === 'process-governance-v9') {
      for (const label of ['声明的流程入口', '记录模型', '独立记录集合', '集合元数据字段', '记录引用范围', '此前记录', '已有时办理', '来源存在要求']) assert(text.includes(label), label);
    } else {
      assert(!text.includes('声明的流程入口')); assert(!text.includes('记录引用范围'));
    }
    assert.equal(JSON.stringify(doc), before);
  }
});
