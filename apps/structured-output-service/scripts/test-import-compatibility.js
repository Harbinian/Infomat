const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.join(__dirname, '..');
const repoRoot = path.join(appRoot, '..', '..');
const Migration = require(path.join(appRoot, 'public', 'process-governance-migration.js'));
const ImportCompatibility = require(path.join(appRoot, 'public', 'import-compatibility.js'));
const { createNativeV7NormalizationFixture } = require('./process-version-fixtures');
const { createReviewLayoutFixture } = require('./review-layout-fixture');
const { app } = require(path.join(appRoot, 'server.js'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reverseObjectKeys(value[key])]));
}

async function validate(baseUrl, data) {
  const response = await fetch(`${baseUrl}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function testNativeDraftRecoveryPreservesSemanticErrors(baseUrl) {
  for (const damage of [
    data => data.data_objects[0].fields.push({...clone(data.data_objects[0].fields[0]),field_ref:'field_duplicate_name'}),
    data => { data.forms[0].areas[0].items[0].data_field_ref = 'field_missing'; },
    data => { data.flow_relations[0].to_behavior_ref = data.flow_relations[0].from_behavior_ref; }
  ]) {
    const data = createReviewLayoutFixture();
    damage(data);
    const bytes = JSON.stringify(data);
    const validation = await validate(baseUrl,data);
    assert.equal(validation.valid,false,'Strict validation must still report the original error');
    assert.equal(ImportCompatibility.classifyNativeDraftValidation(data,validation).allowed,true);
    assert.equal(JSON.stringify(data),bytes,'Recovery classification cannot normalize, merge or delete values');
    assert.equal(ImportCompatibility.classifyPostMigrationBatch([validation]).allowed,false,'Historical migration must retain its atomic rejection boundary');
    assert.equal(ImportCompatibility.classifyNativeDraftValidation({...data,schema_version:'process-governance-v6'},validation).allowed,false);
  }
  for (const damage of [
    data => { data.data_objects = null; },
    data => { data.behaviors[0].node_type = 'unknown'; },
    data => { data.process.unexpected = 'preserve the current candidate instead'; },
    data => { data.behaviors[1].behavior_ref = data.behaviors[0].behavior_ref; },
    data => { data.forms[0].form_ref = data.data_objects[0].data_ref; },
    data => { data.data_objects[0].fields.push(clone(data.data_objects[0].fields[0])); },
    data => { data.forms[0].areas[0].items.push(clone(data.forms[0].areas[0].items[0])); }
  ]) {
    const data = createReviewLayoutFixture();
    damage(data);
    const validation = await validate(baseUrl,data);
    assert.equal(ImportCompatibility.classifyNativeDraftValidation(data,validation).allowed,false,'Malformed shapes or ambiguous identities must not enter the editor');
  }
}

async function testOfficialV3SampleEntersOnlyAsRepairableImport(baseUrl) {
  const sourcePath = path.join(repoRoot, 'docs', 'samples', '3001-process-authoring-training-sample-v3.json');
  const sourceBytes = fs.readFileSync(sourcePath);
  const source = JSON.parse(sourceBytes.toString('utf8'));
  const sourceSnapshot = clone(source);

  const sourceValidation = await validate(baseUrl, source);
  assert.equal(sourceValidation.valid, true, JSON.stringify(sourceValidation.errors));

  const migrated = Migration.migrateDocument(source)[0];
  const targetValidation = await validate(baseUrl, migrated);
  assert.equal(targetValidation.valid, false, 'strict validation/download must remain blocked before repair');
  assert.equal(targetValidation.errors.length, 7);
  assert.equal(
    targetValidation.errors.filter(error => error.rule_code === 'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED').length,
    6
  );
  assert.equal(
    targetValidation.errors.filter(error => error.rule_code === 'FORM_RELATION_ACTION_BEHAVIOR_REQUIRED').length,
    1
  );
  assert.deepEqual(
    targetValidation.errors.map(error => [error.path, error.rule_code, error.params?.ref]),
    [
      ['/data_objects/0/behavior_links/1/behavior_ref', 'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED', 'behavior_training_department_confirm'],
      ['/data_objects/0/behavior_links/2/behavior_ref', 'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED', 'behavior_training_change_check'],
      ['/data_objects/1/behavior_links/0/behavior_ref', 'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED', 'behavior_training_department_confirm'],
      ['/data_objects/1/behavior_links/1/behavior_ref', 'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED', 'behavior_training_change_check'],
      ['/data_objects/2/behavior_links/0/behavior_ref', 'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED', 'behavior_training_change_check'],
      ['/data_objects/3/behavior_links/1/behavior_ref', 'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED', 'behavior_training_review_result'],
      ['/forms/1/behavior_links/0/behavior_ref', 'FORM_RELATION_ACTION_BEHAVIOR_REQUIRED', 'behavior_training_change_check']
    ],
    'the public sample must retain every historical control-node reference and stable location'
  );

  const classification = ImportCompatibility.classifyPostMigrationValidation(targetValidation);
  assert.equal(classification.allowed, true);
  assert.equal(classification.repairableErrors.length, 7);
  assert.deepEqual(source, sourceSnapshot, 'import compatibility must not modify the selected source object');
  assert.equal(
    fs.readFileSync(sourcePath).equals(sourceBytes),
    true,
    'import compatibility must not modify the selected source file'
  );
}

function testMixedTargetErrorsRemainRejected() {
  const repairable = {
    path: '/data_objects/0/behavior_links/0/behavior_ref',
    rule_code: 'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED'
  };
  const incompatibleErrors = [
    { keyword: 'localReference', path: '/data_objects/0/behavior_links/1/behavior_ref', message: '断裂引用' },
    { keyword: 'enum', path: '/behaviors/0/node_type', message: '非法枚举' },
    { keyword: 'additionalProperties', path: '/process', message: '额外字段' },
    { keyword: 'uniqueTechnicalRef', path: '/behaviors/1/behavior_ref', message: '重复技术标识' },
    { keyword: 'selfLoop', path: '/flow_relations/0', message: '自环' }
  ];
  incompatibleErrors.forEach(incompatibleError => {
    const mixed = ImportCompatibility.classifyPostMigrationValidation({
      valid: false,
      errors: [repairable, incompatibleError]
    });
    assert.equal(mixed.allowed, false, incompatibleError.message);
    assert.deepEqual(mixed.repairableErrors, [], incompatibleError.message);
  });
}

function testStrictlyValidTargetNeedsNoRepair() {
  assert.deepEqual(
    ImportCompatibility.classifyPostMigrationValidation({ valid: true, errors: [] }),
    { allowed: true, repairableErrors: [] }
  );
}

function testOneBrokenCandidateRejectsTheWholeBatch() {
  const batch = ImportCompatibility.classifyPostMigrationBatch([
    {
      valid: false,
      errors: [{ rule_code: 'FORM_RELATION_ACTION_BEHAVIOR_REQUIRED' }]
    },
    {
      valid: false,
      errors: [{ keyword: 'additionalProperties', path: '/process' }]
    }
  ]);
  assert.equal(batch.allowed, false);
  assert.equal(batch.failedIndex, 1);
  assert.equal(batch.repairableErrorCount, 0, 'a rejected batch must not report any installable repair items');
}

async function testExplicitTechnicalRepairCanDownloadAndReimport(baseUrl) {
  const fixturePath = path.join(repoRoot, 'docs', 'samples', '3001-control-node-relationship-repair-sample-v7.json');
  const repairDraft = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const blocked = await validate(baseUrl, repairDraft);
  assert.equal(blocked.valid, false);
  assert.deepEqual(
    blocked.errors.map(error => error.rule_code),
    ['DATA_RELATION_ACTION_BEHAVIOR_REQUIRED', 'FORM_RELATION_ACTION_BEHAVIOR_REQUIRED']
  );
  assert.equal(ImportCompatibility.classifyPostMigrationValidation(blocked).allowed, true);

  repairDraft.data_objects[0].behavior_links[0].behavior_ref = 'behavior_register_application';
  repairDraft.forms[0].behavior_links[0].behavior_ref = 'behavior_register_application';
  const repaired = await validate(baseUrl, repairDraft);
  assert.equal(repaired.valid, true, JSON.stringify(repaired.errors));
  assert.deepEqual(
    Migration.migrateDocument(JSON.parse(JSON.stringify(repairDraft)))[0],
    repairDraft,
    'a repaired v7 download must re-import without changing content'
  );
}

async function testNativeV7DynamicActorNormalizationIsArchivedAndVisible(baseUrl) {
  const source = createNativeV7NormalizationFixture();
  const sourceSnapshot = clone(source);
  const sourceValidation = await validate(baseUrl, source);
  assert.equal(sourceValidation.valid, true, JSON.stringify(sourceValidation.errors));

  const normalized = Migration.migrateDocument(source)[0];
  assert.deepEqual(source, sourceSnapshot, 'native v7 normalization must not modify its source object');
  assert.deepEqual(
    normalized.behaviors.map(item => item.current_actor_role),
    ['', ''],
    'dynamic actor roles must be cleared from the active structure'
  );
  assert.equal(normalized.migration.unresolved_actor_roles.length, 2);
  normalized.migration.unresolved_actor_roles.forEach((archive, index) => {
    const original = source.behaviors[index];
    assert.equal(archive.behavior_ref, original.behavior_ref);
    assert.equal(archive.raw_actor_role, original.current_actor_role);
    assert.equal(archive.original_actor_assignment_mode, 'dynamic_from_data');
    assert.equal(archive.source_schema_version, 'process-governance-v7');
    assert.match(archive.record_ref, /^unresolved_actor_role_[0-9a-f]{8}$/);
    assert.match(archive.reason, /动态责任.*原值保存在迁移归档/);
  });
  assert.notEqual(
    normalized.migration.unresolved_actor_roles[0].record_ref,
    normalized.migration.unresolved_actor_roles[1].record_ref,
    'each business behavior must receive its own stable archive identifier'
  );

  const targetValidation = await validate(baseUrl, normalized);
  assert.equal(targetValidation.valid, true, JSON.stringify(targetValidation.errors));
  const rerun = Migration.migrateDocument(clone(normalized))[0];
  assert.deepEqual(rerun, normalized, 're-importing normalized v7 must be idempotent');
  assert.equal(rerun.migration.unresolved_actor_roles.length, 2, 're-import must not duplicate archives');
  const alreadyArchivedSource = clone(normalized);
  alreadyArchivedSource.behaviors[0].current_actor_role = source.behaviors[0].current_actor_role;
  assert.deepEqual(
    Migration.migrateDocument(alreadyArchivedSource)[0],
    normalized,
    'an existing semantic archive must be reused when the same native v7 value is normalized again'
  );

  const summary = ImportCompatibility.summarizeNormalization(source, normalized);
  assert.equal(summary.changed, true);
  assert.equal(summary.totalChanges, 2, 'dynamic responsibility changes must be grouped by business behavior');
  assert.equal(summary.shownChanges, 2);
  assert.equal(summary.truncated, false);
  assert.deepEqual(summary.changes.map(change => change.code), [
    'DYNAMIC_ACTOR_ROLE_ARCHIVED',
    'DYNAMIC_ACTOR_ROLE_ARCHIVED'
  ]);
  summary.changes.forEach((change, index) => {
    const original = source.behaviors[index];
    const archive = normalized.migration.unresolved_actor_roles[index];
    assert.equal(change.path, `/behaviors/${index}/current_actor_role`);
    assert.equal(change.stable_object_ref, original.behavior_ref);
    assert.equal(change.object_name, original.behavior_name);
    assert.equal(change.before_present, true);
    assert.equal(change.before_value, original.current_actor_role);
    assert.equal(change.after_present, true);
    assert.equal(change.after_value, '');
    assert.equal(change.migration_archive_ref, archive.record_ref);
  });
}

function testNormalizationComparisonIgnoresObjectKeyOrderButPreservesUnknownDifferences() {
  const normalized = Migration.migrateDocument(createNativeV7NormalizationFixture())[0];
  const reordered = reverseObjectKeys(normalized);
  assert.deepEqual(
    ImportCompatibility.summarizeNormalization(reordered, normalized),
    { changed: false, totalChanges: 0, shownChanges: 0, truncated: false, changes: [] },
    'object key order alone must not create an import normalization difference'
  );
  const arrayReordered = clone(normalized);
  arrayReordered.behaviors.reverse();
  assert.equal(
    ImportCompatibility.summarizeNormalization(normalized, arrayReordered).changed,
    true,
    'array order changes must remain visible'
  );

  const changed = clone(normalized);
  changed.process.purpose = '规范化后的未知差异';
  const unknown = ImportCompatibility.summarizeNormalization(normalized, changed);
  assert.equal(unknown.changed, true);
  assert.equal(unknown.totalChanges, 1);
  assert.equal(unknown.changes[0].code, 'NORMALIZATION_VALUE_CHANGED');
  assert.equal(unknown.changes[0].path, '/process/purpose');
  assert.equal(unknown.changes[0].stable_object_ref, normalized.process.process_ref);
  assert.equal(unknown.changes[0].object_name, normalized.process.process_name);
  assert.equal(unknown.changes[0].before_value, normalized.process.purpose);
  assert.equal(unknown.changes[0].after_value, changed.process.purpose);
}

function testNormalizationSummaryUsesExactTotalAndTwoHundredItemLimit() {
  const before = { values: Array.from({ length: 205 }, (_item, index) => `before-${index}`) };
  const after = { values: Array.from({ length: 205 }, (_item, index) => `after-${index}`) };
  const summary = ImportCompatibility.summarizeNormalization(before, after);
  assert.equal(summary.changed, true);
  assert.equal(summary.totalChanges, 205);
  assert.equal(summary.shownChanges, 200);
  assert.equal(summary.truncated, true);
  assert.equal(summary.changes.length, 200);
  assert.equal(summary.changes[199].path, '/values/199');
}

async function run() {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await testNativeDraftRecoveryPreservesSemanticErrors(baseUrl);
    await testOfficialV3SampleEntersOnlyAsRepairableImport(baseUrl);
    testMixedTargetErrorsRemainRejected();
    testStrictlyValidTargetNeedsNoRepair();
    testOneBrokenCandidateRejectsTheWholeBatch();
    await testExplicitTechnicalRepairCanDownloadAndReimport(baseUrl);
    await testNativeV7DynamicActorNormalizationIsArchivedAndVisible(baseUrl);
    testNormalizationComparisonIgnoresObjectKeyOrderButPreservesUnknownDifferences();
    testNormalizationSummaryUsesExactTotalAndTwoHundredItemLimit();
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  console.log('structured-output-service import compatibility tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
