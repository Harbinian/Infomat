const assert = require('node:assert/strict');
const {
  MIGRATION_KEY,
  PROCESS_V7_PREVIEW_SCHEMA_SQL,
  TABLES,
  canonicalCreateTable,
  compareFormalProcessBaselines,
  inspectFormalProcessBaseline,
  rollbackProcessV7PreviewReview
} = require('../server/processV7PreviewReviewMigration');
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
  canonicalCreateTable('CREATE TABLE IF NOT EXISTS `sample` (id BIGINT PRIMARY KEY) ENGINE=InnoDB'),
  canonicalCreateTable('CREATE TABLE sample (`id` bigint PRIMARY KEY) ENGINE=InnoDB'),
  'schema comparison must ignore harmless quoting and case differences'
);
assert.deepEqual(compareFormalProcessBaselines({ digest: 'same' }, { digest: 'same' }), { unchanged: true, before_digest: 'same', after_digest: 'same' });
assert.deepEqual(compareFormalProcessBaselines({ digest: 'before' }, { digest: 'after' }), { unchanged: false, before_digest: 'before', after_digest: 'after' });
assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'server', 'processV7PreviewReviewMigration.js'), 'utf8'), /existing_formal_tables_unchanged:\s*true/, 'formal-table safety must be measured rather than hard-coded');

const migrationScript = fs.readFileSync(path.join(__dirname, 'migrate-process-v7-preview-review.js'), 'utf8');
const fixedEnvironmentHelper = fs.readFileSync(path.join(__dirname, 'lib', 'fixed-mysql-environment.js'), 'utf8');
assert.match(migrationScript, /loadFixedMysqlEnvironment/, 'preview migration must use the fixed MySQL environment loader');
assert.match(fixedEnvironmentHelper, /infomat-services\.config\.json/, 'preview migration must load the fixed non-secret MySQL config');
assert.match(fixedEnvironmentHelper, /infomat-services\.local\.env/, 'preview migration must load the ignored local secret file');
assert.match(migrationScript, /redactMysqlConfig/, 'preview migration output must redact the target config');

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
