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
  'CREATE TABLE IF NOT EXISTS departments',
  'CREATE TABLE IF NOT EXISTS users',
  'CREATE TABLE IF NOT EXISTS roles',
  'CREATE TABLE IF NOT EXISTS permissions',
  'CREATE TABLE IF NOT EXISTS role_permissions',
  'CREATE TABLE IF NOT EXISTS user_roles',
  'CREATE TABLE IF NOT EXISTS process_input_baseline_review_runs',
  'CREATE TABLE IF NOT EXISTS process_input_baseline_review_items',
  'CREATE TABLE IF NOT EXISTS process_input_baseline_review_excerpts',
  'CREATE TABLE IF NOT EXISTS process_input_baseline_review_decisions',
  'CREATE TABLE IF NOT EXISTS process_governance_snapshots',
  'CREATE TABLE IF NOT EXISTS process_governance_nodes',
  'CREATE TABLE IF NOT EXISTS process_governance_edges',
  'CREATE TABLE IF NOT EXISTS process_a1_items',
  'CREATE TABLE IF NOT EXISTS process_cross_dept_interactions',
  'CREATE TABLE IF NOT EXISTS process_interaction_chains',
  'CREATE TABLE IF NOT EXISTS process_source_files',
  'CREATE TABLE IF NOT EXISTS process_mdm_requirement_items',
  'CREATE TABLE IF NOT EXISTS process_evidence_refs',
  'CREATE TABLE IF NOT EXISTS process_governance_quality_findings',
  'CREATE TABLE IF NOT EXISTS process_governance_quality_cases',
  'CREATE TABLE IF NOT EXISTS process_governance_quality_case_events',
  'CREATE TABLE IF NOT EXISTS process_mapping_records',
  'CREATE TABLE IF NOT EXISTS process_mapping_todos',
  'CREATE TABLE IF NOT EXISTS process_import_fingerprints',
  'CREATE TABLE IF NOT EXISTS process_mapping_todo_events',
  "status ENUM('verified','pending_review','source_missing','ocr_extracted_not_confirmed','review_only') NOT NULL DEFAULT 'pending_review'",
  'document_name VARCHAR(255)',
  'mapping_diff_report MEDIUMTEXT',
  'source_label VARCHAR(512)',
  'stats_json MEDIUMTEXT NOT NULL',
  'node_type VARCHAR(32) NOT NULL',
  'edge_type VARCHAR(32) NOT NULL',
  'risk_level VARCHAR(16) NOT NULL',
  'finding_key VARCHAR(160) NOT NULL',
  'todo_key VARCHAR(180) NOT NULL',
  'fingerprint VARCHAR(64) NULL',
  "scope ENUM('quality','mapping') NOT NULL",
  'issue_type VARCHAR(64)',
  'definition_status VARCHAR(64)',
  'normalized_note TEXT',
  'employee_no VARCHAR(128) NOT NULL',
  'password_hash VARCHAR(255) NOT NULL',
  'field_constraints MEDIUMTEXT',
  'effect VARCHAR(16) NOT NULL DEFAULT',
  'AUTO_INCREMENT',
  'ENGINE=InnoDB',
  'utf8mb4'
]) {
  assert.ok(schema.includes(required), `schema should include ${required}`);
}
assert.ok(!schema.includes('sqlite_master'), 'MySQL schema must not use SQLite catalog tables');
assert.ok(!schema.includes('PRAGMA'), 'MySQL schema must not use SQLite PRAGMA');
const processGovernanceStatements = splitSqlStatements(schema).filter(statement => {
  const normalized = statement.replace(/\s+/g, ' ');
  return normalized.includes('CREATE TABLE IF NOT EXISTS process_') &&
    !normalized.includes('CREATE TABLE IF NOT EXISTS process_design_');
});
assert.ok(
  processGovernanceStatements.every(statement => !statement.includes('REFERENCES users(')),
  'process governance MySQL tables should not depend on identity users table'
);
assert.ok(
  processGovernanceStatements.every(statement => !statement.includes('REFERENCES departments(')),
  'process governance MySQL tables should not depend on identity departments table'
);
assert.ok(splitSqlStatements(schema).length >= 20, 'schema should split into executable statements');

const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.strictEqual(packageJson.scripts['init:mysql'], 'node scripts/init-mysql-schema.js');
assert.strictEqual(packageJson.scripts['test:mysql-config'], 'node scripts/test-mysql-config.js');
assert.strictEqual(packageJson.scripts['import:process-governance-mysql'], 'node scripts/import-process-governance-mysql.js');
assert.strictEqual(packageJson.scripts['import:process-input-baseline-review'], 'node scripts/import-process-input-baseline-review-mysql.js');
assert.strictEqual(packageJson.scripts['smoke:process-governance-mysql'], 'node scripts/smoke-process-governance-mysql.js');
assert.strictEqual(packageJson.scripts['test:identity-mysql'], 'node scripts/test-identity-mysql-repository.js && node scripts/test-org-me-mysql-api.js && node scripts/test-roles-mysql-api.js && node scripts/test-auth-mysql-permission.js && npm run test:access-mysql && node scripts/test-import-rbac-mysql-api.js');
assert.ok(packageJson.dependencies.mysql2, 'MDM app should declare mysql2 dependency');

const initScript = readFileSync(path.join(__dirname, 'init-mysql-schema.js'), 'utf8');
assert.ok(initScript.includes('2026-06-16-process-input-baseline-review'), 'init script should record input baseline review schema migration');
assert.ok(initScript.includes('2026-06-16-process-governance-read-model'), 'init script should record process governance read model schema migration');
assert.ok(initScript.includes('2026-06-17-identity-rbac-read-model'), 'init script should record identity/RBAC schema migration');
assert.ok(initScript.includes('2026-07-01-process-governance-close-gate-fingerprints'), 'init script should record process governance close gate fingerprint migration');
assert.ok(initScript.includes('ensureProcessDesignEvidenceStatusSchema'), 'init script should ensure process design evidence status migration');
assert.ok(initScript.includes('2026-07-01-process-design-evidence-status'), 'init script should record process design evidence status migration');

console.log('MySQL config checks passed');
