const { MIGRATION_KEY, tables, statements } = require('./analysisIssueSchema');
const dependencies = [require('./dataMapDefinitionSchema').MIGRATION_KEY, require('./v7MappingSchema').MIGRATION_KEY, require('./analysisRunSchema').MIGRATION_KEY];
const { compareCreateStatements } = require('./processV7M0Baseline');
const { failure } = require('./dataMapDefinitionValues');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
async function inspectAnalysisIssues(db) {
  const missing = [], drift = [];
  const [markers] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key IN (?,?,?,?)', [...dependencies, MIGRATION_KEY]);
  for (const dependency of dependencies) if (!markers.some(m => m.migration_key === dependency)) drift.push({ dependency });
  const coreTables = ['process_governance_issues','process_governance_issue_events'];
  const core = splitSqlStatements(mdmMysqlSchemaSql()).filter(sql => coreTables.includes(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1]))
    // MySQL creates the supporting index omitted by this legacy declaration.
    .map(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS process_governance_issues (') ? sql.replace('  CONSTRAINT fk_issue_batch ', '  INDEX fk_issue_batch (batch_id),\n  CONSTRAINT fk_issue_batch ') : sql);
  for (const sql of [...statements(), ...core]) {
    const table = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const [present] = await db.execute('SELECT TABLE_NAME,TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!present.length) { if (coreTables.includes(table)) drift.push({ table, dependency_missing: true }); else missing.push(table); continue; }
    const [[ddl]] = await db.query(`SHOW CREATE TABLE ${table}`);
    const comparison = compareCreateStatements(sql, ddl['Create Table']);
    const [collations] = await db.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME<>?', [table, 'utf8mb4_unicode_ci']);
    if (!comparison.matching || !/ENGINE=InnoDB/i.test(ddl['Create Table']) || /NOT ENFORCED/i.test(ddl['Create Table']) || present[0].TABLE_COLLATION !== 'utf8mb4_unicode_ci' || collations.length) drift.push({ table, differences: comparison.differences });
  }
  return { ready: !missing.length && !drift.length && markers.some(m => m.migration_key === MIGRATION_KEY), missing, drift, backfill: [] };
}
async function applyAnalysisIssues(db) {
  const [[lock]] = await db.execute("SELECT GET_LOCK('mdm_analysis_issue_migration_v1',10) acquired");
  if (Number(lock.acquired) !== 1) throw failure('DEFINITION_ANALYSIS_MIGRATION_BUSY', 409);
  try {
    const before = await inspectAnalysisIssues(db);
    if (before.drift.length) throw Object.assign(failure('DEFINITION_ANALYSIS_SCHEMA_DRIFT', 409), { inspection: before });
    for (const sql of statements()) if (before.missing.includes(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1])) await db.execute(sql);
    const after = await inspectAnalysisIssues(db);
    if (after.missing.length || after.drift.length) throw Object.assign(failure('DEFINITION_ANALYSIS_SCHEMA_DRIFT', 409), { inspection: after });
    await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)', [MIGRATION_KEY]);
    return inspectAnalysisIssues(db);
  } finally { await db.execute("SELECT RELEASE_LOCK('mdm_analysis_issue_migration_v1')"); }
}
module.exports = { inspectAnalysisIssues, applyAnalysisIssues, MIGRATION_KEY, tables };
