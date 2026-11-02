// Selected fixed-source consumer only. Metadata reads, never DDL, backfill,
// lease recovery or process probing. Detailed output is for explicit-target maintenance.
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const { compareCreateStatements } = require('./processV7M0Baseline');
const { failure, digest } = require('./dataMapDefinitionValues');
const baseSql = splitSqlStatements(mdmMysqlSchemaSql());
const identityTables = require('./mysqlRuntimeSchema').DOMAIN_TABLES.identity;
const statementsFor = tables => baseSql.filter(sql => tables.some(t => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${t} (`)));
const scopes = new WeakMap();
const validated = new Map();
const sourceTables = [...new Set([...require('./dataMapDefinitionMigration').baseTables, ...identityTables,
  ...require('./dataMapDefinitionSchema').tables, ...require('./v7MappingSchema').tables])];
const analysisMarkers = ['dataMapDefinitionSchema', 'v7MappingSchema', 'designHandoffSchema', 'analysisRunSchema'].map(p => require('./' + p).MIGRATION_KEY);
// Runtime guards re-read all required metadata/markers on every transaction.
// A known fingerprint only avoids repeating SHOW CREATE parsing. Never cache by
// elapsed time or connection, and never cache data, authorization or a failed probe.
async function metadataFingerprint(db, tables, markers) {
  markers=[...new Set([...markers,require('./dataMapHandoffSchema').MIGRATION_KEY])];
  const placeholders = tables.map(() => '?').join(',');
  const object = names => `JSON_OBJECT(${names.map(n => `'${n}',${n}`).join(',')}) metadata`;
  // One metadata statement per guard: all columns, indexes, references, checks,
  // engines/collations and relevant markers, without weakening the fingerprint.
  const reads = [
    `SELECT 'table' section,TABLE_NAME table_key,'' name_key,0 position_key,${object(['ENGINE','TABLE_COLLATION'])} FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`,
    `SELECT 'column',TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,${object(['COLUMN_TYPE','IS_NULLABLE','COLUMN_DEFAULT','EXTRA','COLLATION_NAME','GENERATION_EXPRESSION'])} FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`,
    `SELECT 'index',TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX,${object(['NON_UNIQUE','COLUMN_NAME','SUB_PART','INDEX_TYPE','IS_VISIBLE','EXPRESSION'])} FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`,
    `SELECT 'reference',k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION,${object(['k.COLUMN_NAME','k.REFERENCED_TABLE_NAME','k.REFERENCED_COLUMN_NAME','r.UPDATE_RULE','r.DELETE_RULE'])} FROM information_schema.key_column_usage k LEFT JOIN information_schema.referential_constraints r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME IN (${placeholders})`,
    `SELECT 'constraint',t.TABLE_NAME,t.CONSTRAINT_NAME,0,${object(['t.CONSTRAINT_TYPE','t.ENFORCED','c.CHECK_CLAUSE'])} FROM information_schema.table_constraints t LEFT JOIN information_schema.check_constraints c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME IN (${placeholders})`,
    `SELECT 'marker','',migration_key,0,JSON_OBJECT() FROM schema_migrations WHERE migration_key IN (${markers.map(()=>'?').join(',')})`
  ];
  const [rows] = await db.execute(reads.join(' UNION ALL ') + ' ORDER BY section,table_key,name_key,position_key', [...Array.from({length:5},()=>tables).flat(), ...markers]);
  return digest(rows);
}
async function guarded(db, key, tables, markers, inspect) {
  return once(db, 'guard:' + key, async () => {
    const metadata = await metadataFingerprint(db, tables, markers), fingerprint = key + ':' + metadata;
    if (validated.has(fingerprint)) return;
    if (!(await inspect()).ready) throw failure('DEFINITION_ANALYSIS_DEPENDENCY_UNAVAILABLE', 503);
    if (await metadataFingerprint(db, tables, markers) !== metadata) throw failure('DEFINITION_ANALYSIS_DEPENDENCY_UNAVAILABLE', 503);
    if (validated.size >= 32) validated.delete(validated.keys().next().value);
    validated.set(fingerprint, true);
  });
}
async function inspectionScope(db, action) {
  if (scopes.has(db)) return action();
  scopes.set(db, new Map());
  try { return await action(); } finally { scopes.delete(db); }
}
const once = (db, key, inspect) => {
  const cache = scopes.get(db);
  if (!cache) return inspect();
  if (!cache.has(key)) cache.set(key, inspect());
  return cache.get(key);
};
async function inspectStructure(db, statements, markers = []) {
  const missing = [], drift = [], missing_markers = [];
  for (const sql of statements) {
    const table = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const [[present]] = await db.execute('SELECT TABLE_NAME,TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!present) { missing.push(table); continue; }
    const [[row]] = await db.query(`SHOW CREATE TABLE ${table}`);
    let expected=sql;
    if(table==='data_map_definition_versions'){
      const [handoff]=await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?',[require('./dataMapHandoffSchema').MIGRATION_KEY]);
      if(handoff.length)expected=expected.replace("source_kind IN ('legacy','manual')","source_kind IN ('legacy','manual','governance')");
    }
    const ddl = row['Create Table'], comparison = compareCreateStatements(expected, ddl);
    const [collations] = await db.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME<>?', [table, 'utf8mb4_unicode_ci']);
    if (!comparison.matching || !/ENGINE=InnoDB/i.test(ddl) || /NOT ENFORCED/i.test(ddl) || present.TABLE_COLLATION !== 'utf8mb4_unicode_ci' || collations.length) drift.push({ table, differences: comparison.differences });
  }
  if (!missing.includes('schema_migrations')) for (const marker of markers) {
    const [rows] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [marker]);
    if (!rows.length) missing_markers.push(marker);
  }
  else missing_markers.push(...markers);
  return { ready: !missing.length && !drift.length && !missing_markers.length, missing, drift, missing_markers };
}
async function inspectSourceStorage(db) {
  return once(db, 'source', async () => {
    const definition = require('./dataMapDefinitionSchema');
    const base = require('./dataMapDefinitionMigration').baseTables;
    const foundation = await inspectStructure(db, [...statementsFor([...new Set([...base, ...identityTables])]), ...definition.statements()], [definition.MIGRATION_KEY]);
    const mapping = foundation.missing.includes('schema_migrations') ? { ready: false, state: 'not_checked' } : await require('./v7MappingMigration').inspectV7Mappings(db);
    return { ready: foundation.ready && mapping.ready, foundation, mapping };
  });
}
async function inspectAnalysisStorage(db, { queue = true } = {}) {
  return once(db, queue ? 'queue' : 'runs', async () => {
    const source = await inspectSourceStorage(db);
    if (source.foundation.missing.includes('schema_migrations')) return { ready: false, source, handoff: { state: 'not_checked' }, analysis: { state: 'not_checked' } };
    const handoff = await require('./designHandofaNFigration').inspectDesignHandoffs(db);
    const analysis = queue ? await require('./analysisQueueMigration').inspectAnalysisQueue(db) : await require('./analysisRunMigration').inspectAnalysisRuns(db);
    return { ready: source.ready && handoff.ready && analysis.ready, source, handoff, analysis };
  });
}
async function assertSourceStorage(db) {
  const cache = scopes.get(db), parent = cache?.get('guard:queue') || cache?.get('guard:runs');
  if (parent) return parent;
  await guarded(db, 'source', sourceTables, analysisMarkers.slice(0,2), () => inspectSourceStorage(db));
}
async function assertAnalysisStorage(db, options = {}) {
  const queue = options.queue !== false;
  const parent = !queue && scopes.get(db)?.get('guard:queue');
  if (parent) return parent;
  const tables = [...sourceTables, ...require('./designHandoffSchema').tables, ...require('./analysisRunSchema').tables,
    ...(queue ? require('./analysisQueueSchema').tables : [])];
  const markers = [...analysisMarkers, ...(queue ? [require('./analysisQueueSchema').MIGRATION_KEY] : [])];
  await guarded(db, queue ? 'queue' : 'runs', tables, markers, () => inspectAnalysisStorage(db, options));
}
async function inspectFixedReference(db, sourceKind, env = process.env) {
  if (sourceKind === 'uploaded_material') return { ready: true, state: 'stored_material', readability: 'not_checked' };
  const preview = sourceKind === 'preview_revision';
  if (!preview && sourceKind !== 'published_version') throw failure('DEFINITION_V7_SOURCE_KIND_INVALID');
  const flag = preview ? 'PROCESS_V7_PREVIEW_ENABLED' : 'PROCESS_V7_FORMAL_ENABLED';
  if (env[flag] !== '1') return { ready: false, state: 'disabled', readability: 'not_checked' };
  return once(db, 'reference:' + sourceKind, async () => {
    const migration = require(preview ? './processV7PreviewReviewMigration' : './processV7FormalMigration');
    // Only tables read by the immutable reference, not promotion/review/work packages.
    const sql = preview ? splitSqlStatements(migration.PROCESS_V7_PREVIEW_SCHEMA_SQL).filter(s => /^CREATE TABLE IF NOT EXISTS process_v7_preview_(cases|revisions) /.test(s)) : statementsFor(['process_design_documents', 'process_design_versions']).map(s =>
      // MySQL supplies these named indexes for the two existing foreign keys.
      // Spell out exactly this known schema result; unknown indexes still drift.
      s.startsWith('CREATE TABLE IF NOT EXISTS process_design_versions (') ? s.replace('  CONSTRAINT fk_process_design_versions_draft',
        '  INDEX fk_process_design_versions_department (department_id),\n  INDEX fk_process_design_versions_supersedes (supersedes_version_id),\n  CONSTRAINT fk_process_design_versions_draft') : s);
    const inspection = await inspectStructure(db, sql, [migration.MIGRATION_KEY]);
    return { ...inspection, state: inspection.ready ? 'prepared' : 'not_ready', readability: 'not_checked' };
  });
}
async function assertFixedReference(db, sourceKind, env = process.env) {
  const inspection = await inspectFixedReference(db, sourceKind, env);
  if (inspection.state === 'disabled') throw failure(sourceKind === 'preview_revision' ? 'DEFINITION_V7_PREVIEW_DISABLED' : 'DEFINITION_V7_FORMAL_DISABLED', 503);
  if (!inspection.ready) throw failure('DEFINITION_ANALYSIS_DEPENDENCY_UNAVAILABLE', 503);
}
async function inspectWorkerDependencies(db, env = process.env) {
  if (['MDM_IDENTITY_READ_MODEL', 'PROCESS_GOVERNANCE_READ_MODEL'].some(k => env[k] !== undefined && env[k] !== 'mysql') ||
    ['PROCESS_V7_PREVIEW_ENABLED', 'PROCESS_V7_FORMAL_ENABLED'].some(k => env[k] !== undefined && !['0', '1'].includes(env[k]))) {
    return { ready: false, state: 'not_ready', reason: 'CONFIG_UNSUPPORTED', storage: { state: 'not_checked' }, fixed_sources: { state: 'not_checked' }, worker_process: 'not_checked' };
  }
  const storage = await inspectAnalysisStorage(db);
  if (!storage.ready) return { ready: false, state: 'not_ready', storage, fixed_sources: { state: 'not_checked' }, coverage: 'native_v7_fixed_source' };
  const [rows] = await db.execute(`SELECT DISTINCT s.source_kind FROM data_map_analysis_queue q
    JOIN data_map_analysis_inputs i ON i.run_id=q.run_id JOIN data_map_v7_sources s ON s.source_id=i.source_id
    WHERE q.state IN ('ready','leased') ORDER BY s.source_kind`);
  const fixed_sources = {};
  for (const row of rows) fixed_sources[row.source_kind] = await inspectFixedReference(db, row.source_kind, env);
  const ready = Object.values(fixed_sources).every(s => s.ready);
  return { ready, state: ready ? 'prepared' : 'not_ready', storage, fixed_sources, coverage: 'native_v7_fixed_source',
    other_adapters: 'not_checked', source_content_identity_scope: 'not_checked', worker_process: 'not_checked' };
}
async function readWorkerStatus(db) {
  const [workers] = await db.execute(`SELECT worker_id,runtime_json,stop_requested,
    DATE_FORMAT(started_at,'%Y-%m-%dT%H:%i:%s.%fZ') started_at,
    DATE_FORMAT(heartbeat_at,'%Y-%m-%dT%H:%i:%s.%fZ') heartbeat_at,
    DATE_FORMAT(stopped_at,'%Y-%m-%dT%H:%i:%s.%fZ') stopped_at,
    CASE WHEN stopped_at IS NOT NULL THEN 'stopped'
      WHEN heartbeat_at>UTC_TIMESTAMP(3) THEN 'heartbeat_invalid'
      WHEN heartbeat_at>=TIMESTAMPADD(SECOND,-10,UTC_TIMESTAMP(3)) THEN 'heartbeat_recent'
      ELSE 'heartbeat_expired' END diagnostic_state
    FROM data_map_analysis_workers ORDER BY started_at DESC LIMIT 100`);
  return { workers: workers.map(w => ({ ...w, process_state: 'not_checked' })),
    worker_state: workers.length ? 'registered' : 'not_registered', heartbeat_window_seconds: 10,
    worker_process: 'not_checked', queue: (await db.execute('SELECT state,COUNT(*) count FROM data_map_analysis_queue GROUP BY state'))[0] };
}
module.exports = { inspectionScope, inspectStructure, statementsFor, identityTables, inspectSourceStorage, inspectAnalysisStorage, assertSourceStorage, assertAnalysisStorage, inspectFixedReference, assertFixedReference, inspectWorkerDependencies, readWorkerStatus };
