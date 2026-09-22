const { MIGRATION_KEY, tables, statements } = require('./wordEvidenceSchema');
const { failure } = require('./dataMapDefinitionValues');
const { compareCreateStatements } = require('./processV7M0Baseline');
async function inspectWordEvidence(db) {
  const dependency = await require('./analysisRunMigration').inspectAnalysisRuns(db);
  const missing = [], drift = [];
  if (!dependency.ready) drift.push({ dependency: 'analysis_runs', detail: dependency });
  for (const sql of statements()) {
    const table = tables[0];
    const [present] = await db.execute('SELECT TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!present.length) { missing.push(table); continue; }
    const [[ddl]] = await db.query('SHOW CREATE TABLE ' + table);
    const compared = compareCreateStatements(sql, ddl['Create Table']);
    if (!compared.matching || !/ENGINE=InnoDB/i.test(ddl['Create Table']) || /NOT ENFORCED/i.test(ddl['Create Table']) || present[0].TABLE_COLLATION !== 'utf8mb4_unicode_ci') drift.push({ table, differences: compared.differences });
  }
  const [markers] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  return { ready: !missing.length && !drift.length && !!markers.length, missing, drift, backfill: [] };
}
async function applyWordEvidence(db) {
  const [[lock]] = await db.execute("SELECT GET_LOCK('mdm_word_evidence_migration_v1',10) acquired");
  if (Number(lock.acquired) !== 1) throw failure('DEFINITION_ANALYSIS_MIGRATION_BUSY', 409);
  try {
    const before = await inspectWordEvidence(db);
    if (before.drift.length) throw Object.assign(failure('DEFINITION_ANALYSIS_SCHEMA_DRIFT',409), { inspection: before });
    if (before.missing.length) await db.execute(statements()[0]);
    const after = await inspectWordEvidence(db);
    if (after.missing.length || after.drift.length) throw Object.assign(failure('DEFINITION_ANALYSIS_SCHEMA_DRIFT',409), { inspection: after });
    await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)', [MIGRATION_KEY]);
    return inspectWordEvidence(db);
  } finally { await db.execute("SELECT RELEASE_LOCK('mdm_word_evidence_migration_v1')"); }
}
module.exports = { inspectWordEvidence, applyWordEvidence, MIGRATION_KEY, tables };
