const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  MIGRATION_KEY,
  PROCESS_DATA_GOVERNANCE_SCHEMA_SQL,
  TABLES,
  migrationConsistencyStatus
} = require('../server/processDataGovernanceMigration');

assert.strictEqual(MIGRATION_KEY, '2026-08-27-process-data-governance-v1');
[
  'process_data_governance_creation_tasks',
  'process_data_governance_work_packages',
  'process_data_governance_details',
  'process_data_governance_fact_requests',
  'process_data_governance_reviews',
  'process_data_governance_events'
].forEach(table => assert.match(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`)));
assert.match(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL, /UNIQUE KEY uq_process_data_governance_package_version \(process_version_id\)/);
assert.match(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL, /REFERENCES process_design_versions\(id\) ON DELETE RESTRICT/);
assert.match(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL, /REFERENCES process_design_documents\(id\) ON DELETE RESTRICT/);
assert.match(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL, /waiting_business_fact/);
assert.match(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL, /candidate_json JSON NOT NULL/);
assert.match(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL, /governance_json JSON NULL/);
assert.match(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL, /question_text TEXT NOT NULL/);
assert.strictEqual(TABLES[0], 'process_data_governance_events', 'rollback order must start with child tables');
assert.strictEqual(TABLES[TABLES.length - 1], 'process_data_governance_creation_tasks');
assert.strictEqual(migrationConsistencyStatus(TABLES.map(table => ({ table, exists: false, schema_status: 'missing' })), false), 'not_applied');
assert.strictEqual(migrationConsistencyStatus(TABLES.map(table => ({ table, exists: true, schema_status: 'matching' })), true), 'applied');
assert.strictEqual(migrationConsistencyStatus([{ table: TABLES[0], exists: true, schema_status: 'matching' }], false), 'partial_structure');
assert.strictEqual(migrationConsistencyStatus(TABLES.map(table => ({ table, exists: true, schema_status: table === TABLES[0] ? 'drifted' : 'matching' })), true), 'schema_drift');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.ok(packageJson.scripts['migrate:process-data-governance:dry-run']);
assert.ok(packageJson.scripts['migrate:process-data-governance:apply']);
assert.ok(packageJson.scripts['migrate:process-data-governance:rollback']);
assert.ok(packageJson.scripts['test:process-data-governance']);
const cli = fs.readFileSync(path.join(__dirname, 'migrate-process-data-governance.js'), 'utf8');
assert.match(cli, /必须明确指定 --dry-run、--apply 或 --rollback/);
const dryRunBranch = cli.slice(
  cli.indexOf("if (args.has('--dry-run'))"),
  cli.indexOf("if (args.has('--apply'))")
);
assert.match(dryRunBranch, /inspectProcessDataGovernance\(pool\)/);
assert.doesNotMatch(dryRunBranch, /applyProcessDataGovernance\(pool\)/);
const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
assert.match(serverIndex, /registerRouteIfExists\('\/api\/process-data-governance', 'processDataGovernance'\)/);
const publishSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'processDesignMysql.js'), 'utf8');
assert.match(publishSource, /isProcessDataGovernanceEnabled\(\)/);
assert.match(publishSource, /isProcessVersionAllowed\(Number\(result\.insertId\)\)/);
assert.match(publishSource, /queueProcessDataGovernanceCreationTask\(pool, Number\(result\.insertId\)/);
const repositorySource = fs.readFileSync(path.join(__dirname, '..', 'server', 'processDataGovernanceRepository.js'), 'utf8');
assert.match(repositorySource, /package:\s*\{[\s\S]*owning_department_id: packageView\.owning_department_id[\s\S]*risk_level: packageView\.risk_level[\s\S]*due_at: packageView\.due_at/);
assert.match(repositorySource, /source_version:\s*\{[\s\S]*content_hash: version\.content_hash \|\| digest\(document\)/);

console.log('Process data governance migration contract tests passed');
