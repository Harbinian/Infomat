import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisRulePresentation } from '../src/analysisPresentation.js';

test('rule presentation keeps historical identity and enabled state while hiding format internals', () => {
  const rule = {rule_id: 'v7.unreachable', rule_version: 'retained-old-version', enabled: false,
    title: '不可达检查', prerequisite: 'V9 Schema required', not_applicable: 'V8/V7 action parallel_join'};
  const original = structuredClone(rule), shown = analysisRulePresentation(rule);
  assert.equal(shown.rule_id, original.rule_id);
  assert.equal(shown.rule_version, original.rule_version);
  assert.equal(shown.enabled, false);
  assert.match(shown.not_applicable, /尚未开启/);
  assert.doesNotMatch([shown.title, shown.prerequisite, shown.not_applicable].join(' '), /V[789]|Schema|parallel_join/);
  assert.deepEqual(rule, original);
});

test('unknown technical catalog text becomes a readable gap without erasing the source rule', () => {
  const rule = {rule_id: 'future.check', title: '检查 /api/synthetic', prerequisite: 'field_internal_id', not_applicable: '未知检查限制'};
  const shown = analysisRulePresentation(rule);
  assert.doesNotMatch([shown.title, shown.prerequisite].join(' '), /\/api\/|field_internal_id/);
  assert.equal(shown.not_applicable, '未知检查限制');
  assert.equal(rule.title, '检查 /api/synthetic');
});
