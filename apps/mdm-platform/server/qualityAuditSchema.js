// Explicit preparation for human audit records. Imported checker findings and
// their snapshots remain in their existing tables and are never reclassified.
const { splitSqlStatements } = require('./mysqlSchema');
const { compareCreateStatements } = require('./processV7M0Baseline');
const authorization = require('./governanceMigrationAuthorization');
const { digest } = require('./dataMapDefinitionValues');
const MIGRATION_KEY = '2026-11-05-quality-audit-v1';
const TABLES = ['data_quality_audit_findings', 'data_quality_audit_events', 'data_quality_audit_requests'];
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS data_quality_audit_findings (
  finding_id CHAR(36) PRIMARY KEY,
  revision_no INT NOT NULL,
  state VARCHAR(32) NOT NULL,
  responsible_department_id BIGINT NOT NULL,
  created_by_person_id BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  last_event_digest CHAR(64) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_quality_audit_department (responsible_department_id,state,updated_at),
  KEY idx_quality_audit_state (state,updated_at),
  CHECK (revision_no > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS data_quality_audit_events (
  event_id CHAR(36) PRIMARY KEY,
  finding_id CHAR(36) NOT NULL,
  revision_no INT NOT NULL,
  action VARCHAR(32) NOT NULL,
  actor_person_id BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  previous_event_digest CHAR(64) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_quality_audit_revision (finding_id,revision_no),
  CHECK (revision_no > 0),
  CONSTRAINT fk_quality_audit_event_finding FOREIGN KEY (finding_id)
    REFERENCES data_quality_audit_findings(finding_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS data_quality_audit_requests (
  request_id CHAR(36) PRIMARY KEY,
  actor_person_id BIGINT NOT NULL,
  finding_id CHAR(36) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  response_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_quality_audit_request_actor (actor_person_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;
const fail = code => Object.assign(new Error(code), { code, statusCode: 503 });
function enabled(env = process.env) {
  const value = String(env.QUALITY_AUDIT_ENABLED || '0');
  if (!['0', '1'].includes(value)) throw fail('QUALITY_AUDIT_CONFIGURATION_INVALID');
  return value === '1';
}
async function inspectSchema(db) {
  const missing = [], drift = [], tables = [];
  for (const expected of splitSqlStatements(SCHEMA_SQL)) {
    const table = expected.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const [present] = await db.execute('SELECT TABLE_NAME,TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!present.length) { missing.push(table); tables.push({ table, exists: false }); continue; }
    const [[ddl]] = await db.query('SHOW CREATE TABLE `' + table + '`');
    const actual = ddl['Create Table'], compared = compareCreateStatements(expected, actual);
    const [collations] = await db.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME<>?', [table, 'utf8mb4_unicode_ci']);
    const matching = compared.matching && /ENGINE=InnoDB\b/i.test(actual) && !/NOT ENFORCED/i.test(actual)
      && present[0].TABLE_COLLATION === 'utf8mb4_unicode_ci' && !collations.length;
    const [[count]] = await db.execute('SELECT COUNT(*) AS total FROM `' + table + '`');
    tables.push({ table, exists: true, matching, rows: String(count.total) });
    if (!matching) drift.push({ table, differences: compared.differences });
  }
  let markers = [];
  try { [markers] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]); }
  catch (error) { if (error.code !== 'ER_NO_SUCH_TABLE') throw error; missing.push('schema_migrations'); }
  return { ready: !missing.length && !drift.length && !!markers.length, migration_key: MIGRATION_KEY,
    missing, drift, tables, marker_present: !!markers.length, historical_backfill: 'none' };
}
async function assertReady(db) {
  if (!(await inspectSchema(db)).ready) throw fail('QUALITY_AUDIT_SCHEMA_UNAVAILABLE');
}
async function preparation(db, options) {
  const identity = await authorization.verifyTargetIdentity(db, options), schema = await inspectSchema(db);
  // Existing rows are bound by their stored revision/digests, never replaced.
  const inventory = [];
  for (const table of schema.tables.filter(value => value.exists)) {
    const keys = table.table === TABLES[0] ? 'finding_id,revision_no,snapshot_digest,last_event_digest'
      : table.table === TABLES[1] ? 'event_id,finding_id,revision_no,snapshot_digest,previous_event_digest'
        : 'request_id,actor_person_id,finding_id,request_digest';
    const [rows] = await db.execute('SELECT ' + keys + ' FROM `' + table.table + '` ORDER BY 1');
    inventory.push({ table: table.table, rows });
  }
  const manifest = { component: 'quality-audit', target: identity, migration_key: MIGRATION_KEY,
    ddl_sha256: digest(SCHEMA_SQL), schema, inventory_sha256: digest(inventory) };
  return { schema_version: 'quality-audit-preparation-v1', manifest, manifest_digest: digest(manifest),
    applicable: !schema.drift.length && !schema.missing.includes('schema_migrations'), schema,
    changes: schema.tables.filter(value => !value.exists).map(value => ({ table: value.table, operation: 'create_empty_table' })),
    historical_backfill: 'none', runtime_enabled: false, side_effects: 'none' };
}
async function inspectPreparation(pool, options) {
  const db = await pool.getConnection();
  try { await authorization.createMigrationPermit(db, options); return await preparation(db, options); }
  finally { db.release(); }
}
async function applyMigration(db, { permit } = {}) {
  await authorization.verifyMigrationPermit(db, permit, { write: true });
  const before = await inspectSchema(db);
  if (before.drift.length || before.missing.includes('schema_migrations')) throw fail('QUALITY_AUDIT_SCHEMA_DRIFT');
  for (const statement of splitSqlStatements(SCHEMA_SQL))
    if (before.missing.includes(statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1])) await db.query(statement);
  const after = await inspectSchema(db);
  if (after.missing.length || after.drift.length) throw fail('QUALITY_AUDIT_SCHEMA_DRIFT');
  await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)', [MIGRATION_KEY]);
  return inspectSchema(db);
}
async function applyPreparation(pool, options) {
  const db = await pool.getConnection(); let locked = false;
  try {
    const permit = await authorization.createMigrationPermit(db, options, { write: true });
    const [[lock]] = await db.execute("SELECT GET_LOCK('mdm_quality_audit_preparation_v1',10) acquired");
    if (Number(lock.acquired) !== 1) throw fail('QUALITY_AUDIT_MIGRATION_BUSY');
    locked = true;
    const before = await preparation(db, options);
    if (!before.applicable || before.manifest_digest !== options.expectedManifestDigest)
      throw fail('QUALITY_AUDIT_PRECHECK_CHANGED');
    const schema = await applyMigration(db, { permit });
    return { schema_version: 'quality-audit-preparation-v1', component: 'quality-audit', prepared: schema.ready,
      schema, runtime_enabled: false, historical_backfill: 'none', original_manifest_digest: before.manifest_digest };
  } finally { if (locked) await db.execute("SELECT RELEASE_LOCK('mdm_quality_audit_preparation_v1')"); db.release(); }
}
module.exports = { MIGRATION_KEY, TABLES, SCHEMA_SQL, enabled, inspectSchema, assertReady,
  applyMigration, inspectPreparation, applyPreparation };
