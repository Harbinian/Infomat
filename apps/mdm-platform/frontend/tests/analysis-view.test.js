import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterFindings, filteredExport, createPayload } from '../src/analysisView.js';
const old = { finding_id: '1', attempt_id: '1', step_key: 'check', subject_input_keys: ['a'], message: '旧中文证据', finding_type: 'business_question', evidence_ids: ['1'] };
const current = { ...old, finding_id: '2', attempt_id: '2', message: '对象编号缺少依据', evidence_ids: ['2'] };
const run = { format_version: 'analysis-export-v1', attempts: [{ attempt_id: '1', step_key: 'check', attempt_no: 1 }, { attempt_id: '2', step_key: 'check', attempt_no: 2 }], findings: [old, current], evidence: [{ evidence_id: '1' }, { evidence_id: '2' }] };
test('default hides old attempts without claiming resolution; explicit history keeps both', () => {
  assert.deepEqual(filterFindings(run.findings, run, {}), [current]);
  assert.deepEqual(filterFindings(run.findings, run, { history: 'all' }), [old, current]);
  assert.deepEqual(filterFindings(run.findings, run, { input: 'hidden' }), []);
  assert.deepEqual(filterFindings(run.findings, run, { q: '对象编号', type: 'business_question' }), [current]);
});
test('filtered export prunes unrelated evidence and does not mutate source or claim governance', () => {
  const before = JSON.stringify(run), result = filteredExport(run, { q: '对象编号' });
  assert.deepEqual(result.findings, [current]); assert.deepEqual(result.evidence, [{ evidence_id: '2' }]);
  assert.equal(result.source_format_version, 'analysis-export-v1'); assert.equal(result.changes_governance, false); assert.equal(JSON.stringify(run), before);
  assert.deepEqual(filteredExport(run, { q: '无此结果' }).evidence, []);
});
test('run payload uses server catalog and fixed reference without enabling AI', () => {
  const p = createPayload({ kind: 'handoff', parser_key: 'fixed_parser', rule_version: 'fixed_v1', check_ids: ['explicit_check'] }, '9007199254740999', '范围', 'request');
  assert.equal(p.inputs[0].ref_id, '9007199254740999'); assert.equal(p.ai_metadata, null);
  assert.deepEqual(p.steps[0].check_ids, ['explicit_check']); assert.deepEqual(p.parser_versions, { fixed_parser: 'fixed_v1' });
});
