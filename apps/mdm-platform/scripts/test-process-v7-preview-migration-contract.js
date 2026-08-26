const assert = require('node:assert/strict');
const {
  MIGRATION_KEY,
  PROCESS_V7_PREVIEW_SCHEMA_SQL,
  TABLES,
  canonicalCreateTable,
  compareFormalProcessBaselines,
  inspectFormalProcessBaseline,
  migrationConsistencyStatus,
  rollbackProcessV7PreviewReview
} = require('../server/processV7PreviewReviewMigration');
const { makeProcessV7PreviewReviewRepository } = require('../server/processV7PreviewReviewRepository');
const { mdmMysqlSchemaSql } = require('../server/mysqlSchema');
const fs = require('node:fs');
const path = require('node:path');

assert.equal(MIGRATION_KEY, '2026-08-24-process-v7-preview-review');
assert.deepEqual(TABLES, [
  'process_v7_preview_events',
  'process_v7_preview_review_items',
  'process_v7_preview_revisions',
  'process_v7_preview_cases'
]);
for (const tableName of TABLES) {
  assert.match(PROCESS_V7_PREVIEW_SCHEMA_SQL, new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}`));
  assert.doesNotMatch(mdmMysqlSchemaSql(), new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}`), 'normal MDM schema initialization must not create V7 preview tables');
}
assert.match(PROCESS_V7_PREVIEW_SCHEMA_SQL, /MEDIUMTEXT NOT NULL/);
assert.match(PROCESS_V7_PREVIEW_SCHEMA_SQL, /active_process_ref[\s\S]*GENERATED ALWAYS[\s\S]*UNIQUE KEY uq_process_v7_preview_active_process/i, 'database must enforce one active case per process_ref');
assert.doesNotMatch(PROCESS_V7_PREVIEW_SCHEMA_SQL, /process_design_(drafts|versions)/, 'preview tables must remain isolated from formal process tables');
assert.equal(typeof inspectFormalProcessBaseline, 'function', 'migration must calculate a live formal-table baseline');
assert.equal(typeof compareFormalProcessBaselines, 'function', 'migration must compare formal-table baselines before and after apply');
assert.equal(typeof canonicalCreateTable, 'function', 'migration must compare existing table definitions with the expected schema');
assert.equal(
  makeProcessV7PreviewReviewRepository({}).initSchema,
  undefined,
  'runtime preview repository must not expose an M1 schema-write entry; only the dedicated migration CLI may apply M1'
);
assert.equal(
  canonicalCreateTable('CREATE TABLE IF NOT EXISTS `sample` (id BIGINT PRIMARY KEY) ENGINE=InnoDB'),
  canonicalCreateTable('CREATE TABLE sample (`id` bigint PRIMARY KEY) ENGINE=InnoDB'),
  'schema comparison must ignore harmless quoting and case differences'
);
assert.deepEqual(compareFormalProcessBaselines({ digest: 'same' }, { digest: 'same' }), { unchanged: true, before_digest: 'same', after_digest: 'same' });
assert.deepEqual(compareFormalProcessBaselines({ digest: 'before' }, { digest: 'after' }), { unchanged: false, before_digest: 'before', after_digest: 'after' });
const matchingTables = TABLES.map(table => ({ table, exists: true, schema_status: 'matching' }));
const missingTables = TABLES.map(table => ({ table, exists: false, schema_status: 'missing' }));
assert.equal(migrationConsistencyStatus(missingTables, false), 'not_applied');
assert.equal(migrationConsistencyStatus(matchingTables, true), 'applied');
assert.equal(migrationConsistencyStatus(missingTables, true), 'record_without_structure');
assert.equal(migrationConsistencyStatus(matchingTables, false), 'structure_without_record');
assert.equal(migrationConsistencyStatus([
  { ...matchingTables[0], schema_status: 'drifted' },
  ...matchingTables.slice(1)
], true), 'schema_drift');
assert.equal(migrationConsistencyStatus([
  matchingTables[0],
  ...missingTables.slice(1)
], false), 'partial_structure');
assert.equal(migrationConsistencyStatus([
  matchingTables[0],
  ...missingTables.slice(1)
], true), 'record_without_structure');
assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'server', 'processV7PreviewReviewMigration.js'), 'utf8'), /existing_formal_tables_unchanged:\s*true/, 'formal-table safety must be measured rather than hard-coded');

const initMysqlSchemaSource = fs.readFileSync(path.join(__dirname, 'init-mysql-schema.js'), 'utf8');
assert.doesNotMatch(
  initMysqlSchemaSource,
  /['"]2026-08-24-process-v7-preview-review['"]\s*[,\]]/,
  'ordinary schema initialization must not fabricate the M1 migration record'
);

const migrationScript = fs.readFileSync(path.join(__dirname, 'migrate-process-v7-preview-review.js'), 'utf8');
const fixedEnvironmentHelper = fs.readFileSync(path.join(__dirname, 'lib', 'fixed-mysql-environment.js'), 'utf8');
assert.match(migrationScript, /loadFixedMysqlEnvironment/, 'preview migration must use the fixed MySQL environment loader');
assert.match(fixedEnvironmentHelper, /infomat-services\.config\.json/, 'preview migration must load the fixed non-secret MySQL config');
assert.match(fixedEnvironmentHelper, /infomat-services\.local\.env/, 'preview migration must load the ignored local secret file');
assert.match(migrationScript, /redactMysqlConfig/, 'preview migration output must redact the target config');

const isolatedRehearsalSource = fs.readFileSync(path.join(__dirname, 'rehearse-process-v7-migrations-isolated.js'), 'utf8');
assert.doesNotMatch(
  isolatedRehearsalSource,
  /processDesignRepository\.(?:submitDraft|decideReviewTask|publishDraft)\s*\(/,
  'isolated rehearsal must not bypass the formal V7 HTTP and session gates'
);
assert.doesNotMatch(
  isolatedRehearsalSource,
  /FORMAL_V7_(?:TRANSACTION|ACTOR)_CONTEXT|Symbol\s*\(/,
  'isolated rehearsal must not import, duplicate or expose private formal V7 capabilities'
);
assert.match(isolatedRehearsalSource, /startFormalV7HttpHarness/, 'isolated rehearsal must mount a local-only HTTP harness');
assert.match(isolatedRehearsalSource, /app\.listen\(0, '127\.0\.0\.1'/, 'isolated rehearsal HTTP harness must only listen on loopback');
assert.match(isolatedRehearsalSource, /\/drafts\/\$\{[^}]+\}\/submit/, 'formal submit must use the public HTTP route');
assert.match(isolatedRehearsalSource, /\/review-tasks\/\$\{[^}]+\}\/decision/, 'formal review must use the public HTTP route');
assert.match(isolatedRehearsalSource, /\/drafts\/\$\{[^}]+\}\/publish/, 'formal publish must use the public HTTP route');
assert.match(isolatedRehearsalSource, /expected_revision_no/, 'formal HTTP requests must carry the expected revision number');
assert.match(isolatedRehearsalSource, /expected_content_hash/, 'formal HTTP requests must carry the expected content hash');
assert.match(isolatedRehearsalSource, /V7_ISOLATED_FORMAL_ACTORS_REQUIRED/, 'missing formal actors must stop with a stable error code');
assert.match(isolatedRehearsalSource, /makeIdentityMysqlRepository\(pool\)/, 'HTTP session validation must use the restored isolated identity database');
assert.match(isolatedRehearsalSource, /setIdentityRepositoryFactory/, 'the local HTTP harness must bind auth reads to the isolated database');
assert.match(isolatedRehearsalSource, /accountId:\s*actor\.accountId[\s\S]*authVersion:\s*actor\.authVersion/, 'temporary sessions must carry the selected account and auth version');
assert.doesNotMatch(isolatedRehearsalSource, /person_name|login_name|employee_no/, 'actor selection and evidence must not read identity names or login identifiers');
assert.ok(
  isolatedRehearsalSource.indexOf('const formalTrialContext = await selectFormalV7TrialContext(') < isolatedRehearsalSource.indexOf('previewRepository.createCase('),
  'formal actors must be selected before any preview or formal workflow rows are created'
);

const processDesignMysqlSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'processDesignMysql.js'), 'utf8');
const draftInsertBlocks = [...processDesignMysqlSource.matchAll(/INSERT INTO process_design_drafts([\s\S]*?)`\s*,\s*\[/g)].map(match => match[1]);
assert.ok(draftInsertBlocks.length >= 2, 'test must inspect every MySQL draft creation path');
draftInsertBlocks.forEach(block => {
  assert.match(block, /schema_version/, 'each MySQL draft creation path must write process-governance-v3 explicitly');
});

const nonEmptyPool = {
  async execute(sql) {
    if (/SELECT migration_key/.test(sql)) return [[{ migration_key: MIGRATION_KEY }]];
    if (/information_schema\.TABLES/.test(sql)) return [[{ table_count: 1 }]];
    if (/COUNT\(\*\) AS row_count/.test(sql)) return [[{ row_count: 1 }]];
    throw new Error(`unexpected write: ${sql}`);
  }
};

assert.rejects(
  () => rollbackProcessV7PreviewReview(nonEmptyPool),
  error => error && error.code === 'V7_PREVIEW_ROLLBACK_NONEMPTY'
).then(() => {
  console.log('Process V7 preview migration contract tests passed');
});
