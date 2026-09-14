const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  MIGRATION_KEY,
  PROCESS_DATA_GOVERNANCE_SCHEMA_SQL,
  TABLES,
  migrationConsistencyStatus,
  inspectProcessDataGovernance,
  applyProcessDataGovernance
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

async function verifyMysqlSchemaInspection() {
  const fixture = require('./fixtures/process-data-governance-mysql84-schema.json');
  const statements = [];
  function executor(schemas, { recorded = true } = {}) {
    return { async execute(sql, params = []) {
      statements.push(sql);
      if (sql.includes('information_schema.TABLES')) return [[{ table_count: schemas[params[0]] ? 1 : 0 }]];
      if (sql.startsWith('SHOW CREATE TABLE')) {
        const table = sql.match(/`([^`]+)`/)[1];
        return [[{ 'Create Table': schemas[table] }]];
      }
      if (sql.includes('FROM schema_migrations')) return [recorded ? [{ migration_key: MIGRATION_KEY }] : []];
      if (sql.includes('COUNT(*)')) return [[{ row_count: 0, count: 0 }]];
      throw new Error('Unexpected statement in read-only migration regression');
    } };
  }
  const matching = await inspectProcessDataGovernance(executor(fixture.schemas));
  assert.strictEqual(matching.consistency_status, 'applied', 'real MySQL foreign-key support indexes must match the declared schema');
  assert.ok(matching.tables.every(table => table.schema_status === 'matching'));
  assert.strictEqual((await applyProcessDataGovernance(executor(fixture.schemas))).consistency_status, 'applied');
  assert.ok(statements.every(sql => /^\s*(SELECT|SHOW)\b/i.test(sql)), 'registered matching schemas must not be rewritten');

  const unrecorded = executor(fixture.schemas, { recorded: false });
  assert.strictEqual((await inspectProcessDataGovernance(unrecorded)).consistency_status, 'structure_without_record');
  await assert.rejects(() => applyProcessDataGovernance(unrecorded), error => error.code === 'PROCESS_DATA_GOVERNANCE_MIGRATION_INCONSISTENT');

  const changed = { ...fixture.schemas };
  const table = 'process_data_governance_fact_requests';
  const existingIndex = 'KEY `fk_process_data_governance_fact_detail` (`detail_id`)';
  assert.ok(changed[table].includes(existingIndex));
  changed[table] = changed[table].replace(existingIndex, 'KEY `fk_process_data_governance_fact_detail` (`work_package_id`)');
  const drifted = await inspectProcessDataGovernance(executor(changed));
  assert.strictEqual(drifted.consistency_status, 'schema_drift', 'wrong index columns must still block migration');
  await assert.rejects(() => applyProcessDataGovernance(executor(changed)), error => error.code === 'PROCESS_DATA_GOVERNANCE_MIGRATION_INCONSISTENT');
  assert.ok(statements.every(sql => /^\s*(SELECT|SHOW)\b/i.test(sql)), 'drifted schemas must not be repaired automatically');
}

verifyMysqlSchemaInspection().then(() => {
  console.log('Process data governance migration contract tests passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
