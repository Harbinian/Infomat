const assert = require('assert');
const { readFileSync } = require('fs');
const path = require('path');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');

const config = mysqlConfigFromEnv({
  MYSQL_HOST: 'mysql.internal',
  MYSQL_PORT: '3307',
  MYSQL_USER: 'mdm_user',
  MYSQL_PASSWORD: 'secret',
  MYSQL_DATABASE: 'mdm_test',
  MYSQL_CONNECTION_LIMIT: '4'
});

assert.strictEqual(config.host, 'mysql.internal');
assert.strictEqual(config.port, 3307);
assert.strictEqual(config.user, 'mdm_user');
assert.strictEqual(config.password, 'secret');
assert.strictEqual(config.database, 'mdm_test');
assert.strictEqual(config.connectionLimit, 4);
assert.strictEqual(redactMysqlConfig(config).password, '***');

const schema = mdmMysqlSchemaSql();
for (const required of [
  'CREATE TABLE IF NOT EXISTS schema_migrations',
  'CREATE TABLE IF NOT EXISTS process_candidate_review_runs',
  'CREATE TABLE IF NOT EXISTS process_candidate_review_items',
  'CREATE TABLE IF NOT EXISTS process_candidate_review_excerpts',
  'CREATE TABLE IF NOT EXISTS process_candidate_review_decisions',
  'document_name VARCHAR(255)',
  'mapping_diff_report MEDIUMTEXT',
  'source_label VARCHAR(512)',
  'issue_type VARCHAR(64)',
  'definition_status VARCHAR(64)',
  'normalized_note TEXT',
  'ENGINE=InnoDB',
  'utf8mb4'
]) {
  assert.ok(schema.includes(required), `schema should include ${required}`);
}
assert.ok(splitSqlStatements(schema).length >= 5, 'schema should split into executable statements');

const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.strictEqual(packageJson.scripts['init:mysql'], 'node scripts/init-mysql-schema.js');
assert.strictEqual(packageJson.scripts['test:mysql-config'], 'node scripts/test-mysql-config.js');
assert.strictEqual(packageJson.scripts['import:process-candidate-review'], 'node scripts/import-process-candidate-review-mysql.js');
assert.ok(packageJson.dependencies.mysql2, 'MDM app should declare mysql2 dependency');

console.log('MySQL config checks passed');
