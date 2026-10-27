// Historical evaluator replay and current-rule fences. Synthetic inputs only;
// no database, HTTP, process startup, source-data writes or governance actions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const rules = require('../server/v7AnalysisRules');
const current = require('../server/processContentChecks');
const frozen = require('../server/rules/v7-content-v4');
const samples = require('./testHelpers/v7AnalysisSamples');
const { digest } = require('../server/dataMapDefinitionValues');
const sha = value => createHash('sha256').update(value).digest('hex');
function analyze(document, version = rules.VERSION, checkIds = rules.checksForVersion(version)) {
  return rules.analyze({ parser_version: version, step: { check_ids: checkIds },
    inputs: [{ input_key: 'source', snapshot: { schema_version: document.schema_version,
      validation_status: 'valid' }, document }] });
}
function manifest(version) {
  return { rule_version: version, parser_versions: { [rules.PARSER]: version }, ai_metadata: null,
    inputs: [{ input_key: 'source', snapshot: { kind: 'v7_source' } }],
    steps: [{ parser_key: rules.PARSER, input_keys: ['source'], check_ids: rules.checksForVersion(version) }] };
}

test('frozen v4 scorer and v1 normalizer preserve their original bytes', () => {
  const expected = {
    'structure-score.js': 'c9f17290bc07a2c3b58bc00645571b33549f2b8c38d2ace562c01eab69640b1a',
    'processContentChecks.js': 'e435e89c52dd024c8686914f9fb7002fb4198377ea519c2fdfb8bc98ce0c2b72'
  };
  for (const [name, hash] of Object.entries(expected)) {
    assert.equal(sha(fs.readFileSync(path.join(__dirname, '../server/rules/v7-content-v4', name))), hash);
  }
  assert.equal(frozen.RULE_VERSION, 'process-content-checks-v1');
  assert.equal(current.RULE_VERSION, 'process-content-checks-v2');
  assert.equal(rules.VERSION, 'v7-deterministic-v5');
  assert.equal(rules.CONTENT_V4_VERSION, 'v7-deterministic-v4');
});

test('v4 reproduces complete pre-change output for original V7 and V8 fixtures', () => {
  // Digests were captured from the unmodified v4 implementation, before either
  // current evaluator was edited. They cover status, coverage, evidence and findings.
  const expected = {
    empty: '7d45955a19a890e31581cb2eceba27d22400e47036ddf89f85bf5d8c7e4fd451',
    binding: '9b0a517059e87468c19aeb5a07bbca93eff432c3567f14fe04047f252a7722cf'
  };
  for (const format of ['process-governance-v7', 'process-governance-v8']) {
    for (const [kind, make] of [['empty', samples.document], ['binding', samples.binding]]) {
      const document = make(); document.schema_version = format;
      const before = JSON.stringify(document), hash = digest(document);
      const result = analyze(document, rules.CONTENT_V4_VERSION);
      assert.equal(sha(JSON.stringify(result)), expected[kind], `${format}/${kind}`);
      assert.deepEqual(result, analyze(document, rules.CONTENT_V4_VERSION));
      assert.equal(JSON.stringify(document), before);
      assert.equal(digest(document), hash);
    }
  }
});

test('v4 recovery keeps eleven checks while v1-v3 retain their eight-check contract', () => {
  for (const version of [rules.LEGACY_VERSION, rules.V2_VERSION, rules.PREVIOUS_VERSION,
    rules.CONTENT_V4_VERSION, rules.VERSION]) {
    const extended = [rules.CONTENT_V4_VERSION, rules.VERSION].includes(version);
    assert.equal(rules.checksForVersion(version).length, extended ? 11 : 8);
    assert.equal(rules.knownVersion(version), true);
    assert.equal(rules.enabledManifest(manifest(version)), true);
    const document = samples.document();
    const result = analyze(document, version);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.checked_ids.length, extended ? 11 : 8);
    if (!extended) {
      assert.deepEqual(result.findings, []);
      assert.equal(analyze(document, version, rules.CHECKS).error_code, 'RULE_VERSION_CHECK_SCOPE_MISMATCH');
    }
  }
  assert.equal(rules.PREVIOUS_VERSION, 'v7-deterministic-v3');
  assert.equal(rules.knownVersion('v7-deterministic-v99'), false);
  assert.equal(rules.enabledManifest(manifest('v7-deterministic-v99')), false);
});

test('format fences are explicit per historical version and never follow a new primary format', () => {
  const v7 = { document: { schema_version: 'process-governance-v7' } };
  const v8 = { document: { schema_version: 'process-governance-v8' } };
  const v9 = { document: { schema_version: 'process-governance-v9' } };
  for (const version of [rules.LEGACY_VERSION, rules.V2_VERSION, rules.PREVIOUS_VERSION,
    rules.CONTENT_V4_VERSION, rules.VERSION]) {
    assert.equal(rules.inputFormat(v7, version).supported, true);
    const acceptsV8 = ![rules.LEGACY_VERSION, rules.V2_VERSION].includes(version);
    assert.equal(rules.inputFormat(v8, version).supported, acceptsV8);
    const taskManifest = manifest(version);
    if (acceptsV8) assert.doesNotThrow(() => rules.assertSourceFormats(taskManifest, [{ input_key: 'source', ...v8 }]));
    else assert.throws(() => rules.assertSourceFormats(taskManifest, [{ input_key: 'source', ...v8 }]),
      error => error.code === 'DEFINITION_ANALYSIS_SOURCE_FORMAT_UNSUPPORTED');
    if (version !== rules.VERSION) {
      assert.equal(rules.inputFormat(v9, version).supported, false);
      assert.throws(() => rules.assertSourceFormats(taskManifest, [{ input_key: 'source', ...v9 }]),
        error => error.code === 'DEFINITION_ANALYSIS_SOURCE_FORMAT_UNSUPPORTED');
    }
  }
});

test('v4 replay is isolated when the current evaluator is unavailable', () => {
  const scorerPath = require.resolve('../../structured-output-service/public/structure-score');
  const original = require(scorerPath);
  const document = samples.document(); document.schema_version = 'process-governance-v8';
  const before = JSON.stringify(document), hash = digest(document);
  try {
    require.cache[scorerPath].exports = { ...original,
      evaluateContent() { throw new Error('synthetic current evaluator unavailable'); } };
    const oldResult = analyze(document, rules.CONTENT_V4_VERSION), newResult = analyze(document);
    assert.equal(oldResult.status, 'succeeded');
    assert.equal(oldResult.checked_ids.length, 11);
    assert.equal(newResult.status, 'partial');
    assert(!newResult.checked_ids.includes('v7.content_completeness'));
    assert.equal(JSON.stringify(document), before);
    assert.equal(digest(document), hash);
  } finally { require.cache[scorerPath].exports = original; }
});

test('current name correction differs from v4 without changing source facts', () => {
  const document = samples.document(); document.schema_version = 'process-governance-v8';
  document.behaviors[0].behavior_name = 'MDM组长发布固定流程治理版本';
  const before = JSON.stringify(document), hash = digest(document);
  const oldIssues = frozen.collectContentChecks(document).issues;
  const currentIssues = current.collectContentChecks(document).issues;
  const nameIssue = issue => issue.path === '/behaviors/0/behavior_name' && /主体、动作和对象/.test(issue.message);
  assert(oldIssues.some(nameIssue));
  assert(!currentIssues.some(nameIssue));
  assert.notDeepEqual(analyze(document, rules.CONTENT_V4_VERSION), analyze(document));
  assert.equal(JSON.stringify(document), before);
  assert.equal(digest(document), hash);
});

test('worker diagnostics distinguish frozen and current evaluator dependencies', () => {
  const hashes = require('./analysis-worker').runtimeCodeDigests();
  assert.equal(hashes['rules/v7-content-v4/structure-score.js'], 'c9f17290bc07a2c3b58bc00645571b33549f2b8c38d2ace562c01eab69640b1a');
  assert.equal(hashes['rules/v7-content-v4/processContentChecks.js'], 'e435e89c52dd024c8686914f9fb7002fb4198377ea519c2fdfb8bc98ce0c2b72');
  assert.notEqual(hashes['structure-score.js'], hashes['rules/v7-content-v4/structure-score.js']);
  assert.notEqual(hashes['processContentChecks.js'], hashes['rules/v7-content-v4/processContentChecks.js']);
  assert.match(hashes['rules/v7-content-v4/index.js'], /^[a-f0-9]{64}$/);
  assert.match(hashes['process-data-availability.js'], /^[a-f0-9]{64}$/);
  assert.match(hashes['process-governance-v9.schema.json'], /^[a-f0-9]{64}$/);
});
