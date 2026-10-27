// Pure synthetic tests. No MySQL, HTTP, external materials or writes.
const test = require('node:test'), assert = require('node:assert/strict');
const { analyze, LEGACY_CHECKS: CHECKS, PREVIOUS_VERSION, catalog, enabledManifest } = require('../server/v7AnalysisRules');
const { document, node, edge, binding } = require('./testHelpers/v7AnalysisSamples');
const run = (d, status = 'valid', check_ids = CHECKS) => analyze({ parser_version: PREVIOUS_VERSION, step: { check_ids }, inputs: [{ input_key: 'source', snapshot: { validation_status: status }, document: d }] });
const has = (r, id) => r.findings.some(f => f.rule_id === 'v7.' + id);
test('normal action chain, empty fields and text are not business errors', () => {
  const r = run(document()); assert.equal(r.status, 'succeeded'); assert.equal(r.findings.length, 0); assert.equal(r.checked_ids.length, 8);
});
test('format and explicit required: normal, defect and malformed boundary', () => {
  let d = document(); d.behaviors[0].node_type = 'invented'; assert(has(run(d), 'format'));
  d = document(); delete d.behaviors[0].behavior_ref; const r = run(d); assert(has(r, 'required')); assert.equal(r.status, 'partial'); assert(!r.checked_ids.includes('v7.local_integrity'));
  for (const value of [null, [], 42, { behaviors: [null] }]) assert.equal(run(value).status, 'partial');
  assert.equal(run(null, 'parse_failed').checked_ids.join(','), 'v7.format');
});
test('duplicate refs use local identity, not order, title or array index', () => {
  const d = document(); d.behaviors.push({ ...d.behaviors[0], behavior_name: '同一标识的另一记录' });
  const r = run(d); assert(has(r, 'duplicate')); assert.equal(r.status, 'partial');
  d.behaviors.reverse(); const reversed = run(d); assert.deepEqual(r.findings, reversed.findings);
  d.behaviors[0].behavior_ref = 'behavior_c'; assert(!has(run(d), 'duplicate'));
});
test('dangling references, legal return loops and self-edge technical boundary', () => {
  let d = document(); d.flow_relations[0].to_behavior_ref = 'behavior_missing'; assert(has(run(d), 'local_integrity'));
  d = document(); d.flow_relations.push(edge('relation_ba', 'behavior_b', 'behavior_a', 'loop', '核对未通过时返回')); assert.equal(run(d).findings.length, 0);
  d.flow_relations.push(edge('relation_aa', 'behavior_a', 'behavior_a', 'loop', '自身返回')); assert(has(run(d), 'local_integrity'));
});
test('field binding: correct owner, wrong owner/type, missing reference and optional null', () => {
  const d = binding(); assert.equal(run(d).findings.length, 0);
  const item = d.forms[0].areas[0].items[0]; item.data_field_ref = 'field_b'; assert(has(run(d), 'field_binding'));
  item.data_field_ref = 'field_a'; item.item_type = '数值'; assert(has(run(d), 'field_binding'));
  item.item_type = '文本'; item.data_field_ref = 'field_missing'; assert(has(run(d), 'field_binding'));
  item.data_field_ref = null; assert(!has(run(d), 'field_binding'));
});
test('isolation: connected normal, disconnected defect and single-node boundary', () => {
  const d = document(); d.behaviors.push(node('behavior_c')); assert(has(run(d), 'isolated'));
  d.behaviors = [node('behavior_c')]; d.flow_relations = []; assert.equal(run(d).findings.length, 0);
});
test('exits respect decision, split, join, action and unknown types', () => {
  for (const type of ['action', 'decision', 'parallel_split', 'parallel_join', '']) {
    const d = document(); d.behaviors[1].node_type = type;
    assert.equal(has(run(d), 'exit'), ['decision', 'parallel_split'].includes(type));
    d.flow_relations.push(edge('relation_ba', 'behavior_b', 'behavior_a', 'loop', '返回')); assert(!has(run(d), 'exit'));
  }
});
test('branch conditions: explicit conditional and loop only; no inferred enumeration', () => {
  for (const type of ['sequence', 'parallel', 'condition', 'loop', '']) {
    const d = document(); d.flow_relations[0].relation_type = type;
    assert.equal(has(run(d), 'branch_condition'), ['condition', 'loop'].includes(type));
    d.flow_relations[0].condition = '明确合成条件'; assert(!has(run(d), 'branch_condition'));
  }
});
test('unreachable disabled without entry semantics; closed loops remain legal', () => {
  assert.equal(catalog.find(r => r.rule_id === 'v7.unreachable').enabled, false);
  const d = document(); d.flow_relations.push(edge('relation_ba', 'behavior_b', 'behavior_a', 'loop', '继续办理')); assert.equal(run(d).findings.length, 0);
  assert(!enabledManifest({ ai_metadata: null, rule_version: 'v7-deterministic-v1', parser_versions: { v7_deterministic: 'v7-deterministic-v1' }, inputs: [], steps: [{ parser_key: 'v7_deterministic', input_keys: ['a'], check_ids: ['v7.unreachable'] }] }));
});
test('stable findings under array and property permutations; original evidence pointers resolve', () => {
  const d = binding(); d.forms[0].areas[0].items[0].data_field_ref = 'field_missing'; const a = run(d);
  d.data_objects.reverse(); d.behaviors.reverse(); d.forms[0].areas[0].items[0] = Object.fromEntries(Object.entries(d.forms[0].areas[0].items[0]).reverse());
  const b = run(d); assert.deepEqual(a.findings, b.findings); assert.deepEqual(run(d), b);
  d.forms[0].areas[0].area_title = '合成标题修订'; assert.deepEqual(b.findings, run(d).findings);
  for (const e of b.evidence) if (e.locator_kind === 'json_pointer') { let value = d; for (const p of e.locator.split('/').slice(1)) value = value[p.replace(/~1/g, '/').replace(/~0/g, '~')]; assert.notEqual(value, undefined); }
});
test('limits fail explicitly without silently truncating findings', () => {
  const d = document(); d.flow_relations = []; d.behaviors = Array.from({ length: 300 }, (_, i) => node('behavior_' + i));
  const r = run(d); assert.equal(r.status, 'failed'); assert.equal(r.error_code, 'RESULT_LIMIT_EXCEEDED'); assert.equal(r.findings.length, 0);
});
test('CPU thread dispatch returns real findings and supports cancellation', async () => {
  const { dispatch } = require('../server/analysisWorker');
  const d = document(); d.flow_relations[0].relation_type = 'condition';
  const task = { parser_version: PREVIOUS_VERSION, step: { parser_key: 'v7_deterministic', check_ids: CHECKS }, inputs: [{ input_key: 'source', snapshot: { validation_status: 'valid' }, document: d }] };
  assert(has(await dispatch(task, new AbortController().signal), 'branch_condition'));
  const c = new AbortController(); c.abort(); await assert.rejects(dispatch(task, c.signal), e => e.code === 'ABORTED');
});

test('declared other formats are refused, undeclared and invalid V7 retain format diagnosis', () => {
  const d = require('../../structured-output-service/server').createEmptyProcessGovernanceV7Document();
  d.schema_version = 'process-governance-v8'; d.migration.source_schema_version = 'process-governance-v8';
  assert.equal(run(d).status, 'succeeded');
  for (const value of [{ ...document(), schema_version: 'unknown' }, { ...document(), schema_version: null }]) {
    const result = run(value); assert.equal(result.status, 'failed'); assert.equal(result.error_code, 'SOURCE_FORMAT_UNSUPPORTED'); assert.deepEqual(result.findings, []); assert.deepEqual(result.checked_ids, []);
  }
  const missing = document(); delete missing.schema_version; assert(has(run(missing), 'required'));
  assert(has(run({}), 'required')); assert(has(run(null, 'parse_failed'), 'format'));
  const mismatch = analyze({ step: { check_ids: CHECKS }, inputs: [{ input_key: 'source', snapshot: { schema_version: 'process-governance-v8' }, document: document() }] });
  assert.equal(mismatch.error_code, 'SOURCE_FORMAT_METADATA_MISMATCH'); assert.deepEqual(mismatch.findings, []);
});

function comparisonRun(doc, { version = require('../server/v7AnalysisRules').PREVIOUS_VERSION, parserVersion = version, metadata = true, output, status = 'succeeded', documents = true } = {}) {
  const { digest } = require('../server/dataMapDefinitionValues'), rules = require('../server/v7AnalysisRules');
  const snapshot = { kind: 'v7_source', ref_id: '1', source_kind: 'preview_revision', content_digest: digest(doc), digest_algorithm: 'sha256-v7-stable-json-v1', identity: { kind: 'preview_revision', id: '1' }, ...(metadata ? { schema_version: doc.schema_version } : {}) };
  const result = output || run(doc), coverage = { expected: CHECKS, checked: result.checked_ids, missing: CHECKS.filter(id => !result.checked_ids.includes(id)) };
  return { run_id: '1', scope_department_id: '1', status, manifest_digest: digest(snapshot),
    manifest: { inputs: [{ input_key: 'source', snapshot }], rule_version: version, parser_versions: { [rules.PARSER]: parserVersion }, ai_metadata: null, check_scope: { check_ids: CHECKS }, steps: [{ step_key: 'v7', parser_key: rules.PARSER, input_keys: ['source'], check_ids: CHECKS }] },
    ...(documents ? { documents: { source: doc } } : {}), attempts: [{ step_key: 'v7', attempt_no: 1, attempt_id: '1', status: result.status, coverage,
      evidence: result.evidence.map(e => ({ ...e, fixed_reference: snapshot, locator_validation: 'resolved' })), findings: result.findings.map((f, i) => ({ ...f, finding_id: String(i + 1), comparison_algorithm: 'analysis-subject-v1', rule_version: version })) }] };
}
test('comparison maps old/new V7 semantics and optional metadata without erasing evidence changes', () => {
  const compare = require('../server/analysisComparison').compareAnalysisSnapshots, d = document(); d.behaviors.push(node('behavior_c'));
  const before = comparisonRun(d, { version: 'v7-deterministic-v1', metadata: false }), after = comparisonRun(d); const original = structuredClone(before);
  assert.equal(compare(before, after).counts.persistent, 1); assert.equal(compare(before, after).comparison_complete, true); assert.deepEqual(before, original);
  const reordered = structuredClone(d); reordered.behaviors.reverse(); assert.equal(compare(before, comparisonRun(reordered)).counts.evidence_changed, 1);
  const fixed = structuredClone(d); fixed.flow_relations.push(edge('relation_bc', 'behavior_b', 'behavior_c'));
  assert.equal(compare(before, comparisonRun(fixed)).counts.not_detected, 1);
});
test('different native format, unknown format/version and missing coverage never mean no longer detected', () => {
  const compare = require('../server/analysisComparison').compareAnalysisSnapshots, d = document(); d.behaviors.push(node('behavior_c')); const before = comparisonRun(d);
  for (const schema_version of ['process-governance-v8', 'unknown']) {
    const after = comparisonRun({ ...d, schema_version }); const result = compare(before, after); assert(result.comparability_reasons.includes('SOURCE_FORMAT_CHANGED')); assert.equal(result.counts.not_detected, 0); assert.equal(result.comparison_complete, false);
  }
  const noMetadata = comparisonRun(d, { metadata: false, documents: false }); assert(compare(before, noMetadata).comparability_reasons.includes('SOURCE_FORMAT_UNRESOLVED'));
  assert(compare(before, comparisonRun(d, { version: 'different-rules' })).comparability_reasons.includes('RULE_SEMANTICS_UNMAPPED'));
  assert(compare(before, comparisonRun(d, { parserVersion: 'different-parser' })).comparability_reasons.includes('PARSER_VERSION_CHANGED'));
  const output = { status: 'partial', checked_ids: ['v7.format', 'v7.required'], evidence: [], findings: [] };
  const partial = compare(before, comparisonRun(d, { output, status: 'partial' })); assert.equal(partial.counts.incomparable, 1); assert.equal(partial.rows[0].reason, 'RULE_COVERAGE_INCOMPLETE'); assert.equal(partial.counts.not_detected, 0);
  assert(partial.comparability_reasons.includes('CHECK_COVERAGE_INCOMPLETE'));
});
