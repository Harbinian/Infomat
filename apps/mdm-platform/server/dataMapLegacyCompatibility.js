// Explicit maintenance only: preserve every row; widen two known CHECK sets and
// align defaults for future inserts. No startup DDL and no semantic value mapping.
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const { compareCreateStatements } = require('./processV7M0Baseline');
const { failure } = require('./dataMapDefinitionValues');
const { baseTables } = require('./dataMapDefinitionMigration');

const MIGRATION_KEY = '2026-09-28-data-map-legacy-values-v1';
const LOCK = 'mdm_definition_migration_v1';
const changes = {
  data_map_objects: { column: 'object_type', current: 'master_data_reviewItem', legacy: 'master_data_candidate' },
  data_map_fields: { column: 'master_data_level', current: 'needs_review', legacy: 'candidate' },
  data_map_field_system_links: { checkColumn: 'relation_type', values: "'producer','consumer','candidate_authority','reviewItem_authority','authority'", oldToken: "'candidate_authority',", newToken: "'reviewItem_authority'," },
  data_map_field_identities: { column: 'status', current: 'needs_review', legacy: 'candidate', checkColumn: 'status', values: "'candidate','needs_review','confirmed','rejected','archived'", oldToken: "'candidate',", newToken: "'needs_review'," }
};

function definitions() {
  return splitSqlStatements(mdmMysqlSchemaSql()).filter(sql => baseTables.some(table => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`))).map(sql => {
    const table = sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const change = changes[table];
    if (!change) return { table, sql, profiles: [sql] };
    let previous = sql, legacy = sql;
    if (change.checkColumn) {
      const check = `CHECK (${change.checkColumn} IN (${change.values}))`;
      previous = sql.replace(check, check.replace(change.oldToken, ''));
      legacy = sql.replace(check, check.replace(change.newToken, ''));
    }
    if (change.column) legacy = legacy.replace(`DEFAULT '${change.current}'`, `DEFAULT '${change.legacy}'`);
    return { table, sql, profiles: [...new Set([sql, previous, legacy])] };
  });
}

async function inspectLegacyCompatibility(db) {
  const drift = [], pending = [], states = [];
  for (const { table, sql, profiles } of definitions()) {
    const [[present]] = await db.execute('SELECT ENGINE,TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!present) { drift.push({ table, reason: 'BASE_TABLE_REQUIRED' }); continue; }
    const [[created]] = await db.query(`SHOW CREATE TABLE ${table}`);
    const ddl = created['Create Table'];
    const [collations] = await db.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME<>?', [table, 'utf8mb4_unicode_ci']);
    if (present.ENGINE !== 'InnoDB' || present.TABLE_COLLATION !== 'utf8mb4_unicode_ci' || collations.length || /NOT ENFORCED/i.test(ddl) || !profiles.some(profile => compareCreateStatements(profile, ddl).matching)) {
      drift.push({ table, reason: 'UNKNOWN_SCHEMA', differences: compareCreateStatements(sql, ddl).differences }); continue;
    }
    const matching = compareCreateStatements(sql, ddl).matching;
    states.push({ table, state: matching ? 'compatible' : 'known_previous' });
    if (matching) continue;
    const change = changes[table], clauses = [];
    if (change.column) clauses.push(`ALTER COLUMN ${change.column} SET DEFAULT '${change.current}'`);
    if (change.checkColumn) {
      // SHOW CREATE supplies names; only a validated identifier from the single
      // already-compared CHECK for this column may be used in the atomic ALTER.
      const checks = [...ddl.matchAll(/CONSTRAINT `([a-zA-Z0-9_]+)` CHECK \(([^\n]+)\)/g)].filter(match => match[2].includes('`' + change.checkColumn + '`'));
      if (checks.length !== 1) { drift.push({ table, reason: 'CHECK_NAME_UNRESOLVED' }); continue; }
      clauses.push(`DROP CHECK \`${checks[0][1]}\``, `ADD CONSTRAINT \`${checks[0][1]}\` CHECK (${change.checkColumn} IN (${change.values}))`);
    }
    pending.push({ table, sql: `ALTER TABLE ${table} ${clauses.join(', ')}` });
  }
  let recorded = false;
  if (!drift.some(item => item.table === 'schema_migrations')) {
    const [markers] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
    recorded = markers.length === 1;
  }
  if (recorded && pending.length) drift.push({ table: 'schema_migrations', reason: 'RECORDED_STRUCTURE_CHANGED' });
  return { ready: !drift.length && !pending.length && recorded, schema_compatible: !drift.length && !pending.length, recorded, drift, pending, states, rewrites_existing_values: false };
}

async function applyLegacyCompatibility(db) {
  const [[lock]] = await db.execute('SELECT GET_LOCK(?,10) AS acquired', [LOCK]);
  if (Number(lock.acquired) !== 1) throw failure('DEFINITION_COMPATIBILITY_BUSY', 409);
  try {
    const before = await inspectLegacyCompatibility(db);
    if (before.drift.length) throw failure('DEFINITION_COMPATIBILITY_SCHEMA_DRIFT', 409);
    if (before.ready) return before;
    // Per-table ALTER is atomic, but the whole migration is not transactional.
    // A failure leaves known completed tables inspectable and safely resumable.
    for (const item of before.pending) {
      await db.execute(item.sql);
      const after = await inspectLegacyCompatibility(db);
      if (after.drift.length || after.pending.some(change => change.table === item.table)) throw failure('DEFINITION_COMPATIBILITY_SCHEMA_DRIFT', 409);
    }
    const after = await inspectLegacyCompatibility(db);
    if (!after.schema_compatible) throw failure('DEFINITION_COMPATIBILITY_SCHEMA_DRIFT', 409);
    await db.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [MIGRATION_KEY]);
    return await inspectLegacyCompatibility(db);
  } finally { await db.execute('SELECT RELEASE_LOCK(?)', [LOCK]); }
}

module.exports = { MIGRATION_KEY, inspectLegacyCompatibility, applyLegacyCompatibility };
