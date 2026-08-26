const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.join(__dirname, '..');
const repoRoot = path.join(appRoot, '..', '..');
const Migration = require(path.join(appRoot, 'public', 'process-governance-migration.js'));
const ImportCompatibility = require(path.join(appRoot, 'public', 'import-compatibility.js'));
const { app } = require(path.join(appRoot, 'server.js'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

async function run() {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await testOfficialV3SampleEntersOnlyAsRepairableImport(baseUrl);
    testMixedTargetErrorsRemainRejected();
    testStrictlyValidTargetNeedsNoRepair();
    testOneBrokenCandidateRejectsTheWholeBatch();
    await testExplicitTechnicalRepairCanDownloadAndReimport(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  console.log('structured-output-service import compatibility tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
