const { MIGRATION_KEY, tables, statements } = require('./analysisClosureSchema');
const { failure } = require('./dataMapDefinitionValues');
const { compareCreateStatements } = require('./processV7M0Baseline');
async function inspectAnalysisClosure(db) {
  const dependency = await require('./analysisTaskMigration').inspectAnalysisTasks(db);
  const office = await require('./officeSchema').inspectOfficeSchema(db);
  const missing = [], drift = [];
  if (!dependency.ready) drift.push({ dependency: 'analysis_tasks', detail: dependency });
  if (!office.ready) drift.push({ dependency: 'offices', detail: { ready: office.ready, drift: office.drift, changes: office.changes } });
  for (const sql of statements()) {
    const table = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const [present] = await db.execute('SELECT TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!present.length) { missing.push(table); continue; }
    const [[ddl]] = await db.query('SHOW CREATE TABLE ' + table);
    const compared = compareCreateStatements(sql, ddl['Create Table']);
    if (!compared.matching || !/ENGINE=InnoDB/i.test(ddl['Create Table']) || /NOT ENFORCED/i.test(ddl['Create Table']) || present[0].TABLE_COLLATION !== 'utf8mb4_unicode_ci') drift.push({ table, differences: compared.differences });
  }
  const [markers] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  return { ready: !missing.length && !drift.length && !!markers.length, missing, drift, backfill: [] };
}
async function applyAnalysisClosure(db) {
  const [[lock]] = await db.execute("SELECT GET_LOCK('mdm_analysis_closure_migration_v1',10) acquired");
  if (Number(lock.acquired) !== 1) throw failure('DEFINITION_ANALYSIS_MIGRATION_BUSY', 409);
  try {
    const before = await inspectAnalysisClosure(db);
    if (before.drift.length) throw Object.assign(failure('DEFINITION_ANALYSIS_SCHEMA_DRIFT',409), { inspection: before });
    for(const sql of statements()) if(before.missing.includes(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1])) await db.execute(sql);
    const after = await inspectAnalysisClosure(db);
    if (after.missing.length || after.drift.length) throw Object.assign(failure('DEFINITION_ANALYSIS_SCHEMA_DRIFT',409), { inspection: after });
    await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)', [MIGRATION_KEY]);
    return inspectAnalysisClosure(db);
  } finally { await db.execute("SELECT RELEASE_LOCK('mdm_analysis_closure_migration_v1')"); }
}
module.exports = { inspectAnalysisClosure, applyAnalysisClosure, MIGRATION_KEY, tables };
