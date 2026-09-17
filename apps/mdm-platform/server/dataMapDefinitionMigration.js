const { statements, tables, MIGRATION_KEY } = require('./dataMapDefinitionSchema');
const { compareCreateStatements } = require('./processV7M0Baseline');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const { failure, snapshot, digest, legacyDefinition, insertVersion } = require('./dataMapDefinitionValues');

const baseTables = ['data_map_objects','data_map_contexts','data_map_fields','data_map_field_identities','data_map_field_system_links','data_map_import_batches','schema_migrations'];
async function inspectDefinitions(db) {
  await db.execute("SET time_zone = '+00:00'");
  const drift = [], missing = [];
  const expected = [...splitSqlStatements(mdmMysqlSchemaSql()).filter(sql => baseTables.some(t => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${t} (`))), ...statements()];
  for (const sql of expected) {
    const table = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const [present] = await db.execute('SELECT TABLE_NAME,TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!present.length) { (baseTables.includes(table) ? drift : missing).push(table); continue; }
    const [[ddl]] = await db.query(`SHOW CREATE TABLE ${table}`);
    const compared = compareCreateStatements(sql, ddl['Create Table']);
    const [collations]=await db.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME<>?', [table,'utf8mb4_unicode_ci']);
    if (!compared.matching || !/ENGINE=InnoDB/i.test(ddl['Create Table']) || /NOT ENFORCED/i.test(ddl['Create Table']) || present[0].TABLE_COLLATION!=='utf8mb4_unicode_ci' || collations.length) {
      drift.push({ table, differences: compared.differences, incompatible_collation:collations.map(c=>c.COLUMN_NAME) });
    }
  }
  if (drift.length) return { ready:false, drift, missing, backfill:[], changed:[], unresolved:[] };
  const versionTablesReady = !missing.includes('data_map_definition_heads') && !missing.includes('data_map_definition_versions');
  const backfill = [], changed = [], unresolved = [];
  for (const type of ['object','field']) {
    const [entities] = await db.execute(`SELECT CAST(id AS CHAR) AS id FROM data_map_${type === 'object' ? 'objects' : 'fields'} ORDER BY id`);
    for (const entity of entities) {
      const source = await snapshot(db, type, entity.id);
      if (type === 'field' && !source.row.object_id) unresolved.push({ entity_type:type, entity_id:entity.id, reason:'OBJECT_REQUIRED' });
      if (type === 'object' && !source.row.owner_dept_id) unresolved.push({ entity_type:type, entity_id:entity.id, reason:'OWNER_DEPARTMENT_REQUIRED' });
      const [heads] = versionTablesReady ? await db.execute(`SELECT v.base_digest FROM data_map_definition_heads h JOIN data_map_definition_versions v ON v.version_id=h.current_version_id WHERE h.entity_type=? AND h.entity_id=?`, [type,entity.id]) : [[]];
      if (!heads.length) backfill.push({ entity_type:type, entity_id:entity.id });
      else if (heads[0].base_digest !== digest(source)) changed.push({ entity_type:type, entity_id:entity.id, reason:'LEGACY_SOURCE_CHANGED' });
    }
  }
  const [markers] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  return { ready:missing.length===0 && backfill.length===0 && markers.length===1, drift, missing, backfill, changed, unresolved };
}

async function applyDefinitions(db) {
  const [[lock]] = await db.execute("SELECT GET_LOCK('mdm_definition_migration_v1',10) AS acquired");
  if (Number(lock.acquired) !== 1) throw failure('DEFINITION_MIGRATION_BUSY',409);
  try {
    const before = await inspectDefinitions(db);
    if (before.drift.length) throw failure('DEFINITION_SCHEMA_DRIFT',409);
    // MySQL DDL commits independently. Every completed table is checked before
    // a retry; a later failure leaves inspectable tables, not a fake rollback.
    for (const sql of statements()) {
      const name = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
      if (before.missing.includes(name)) await db.execute(sql);
    }
    const structure = await inspectDefinitions(db);
    if (structure.drift.length || structure.missing.length) throw failure('DEFINITION_SCHEMA_DRIFT',409);
    await db.beginTransaction();
    try {
      for (const type of ['object','field']) {
        const [entities] = await db.execute(`SELECT CAST(id AS CHAR) AS id FROM data_map_${type === 'object' ? 'objects' : 'fields'} ORDER BY id FOR UPDATE`);
        for (const entity of entities) {
          const [heads] = await db.execute('SELECT current_version_id FROM data_map_definition_heads WHERE entity_type=? AND entity_id=? FOR UPDATE',[type,entity.id]);
          if (heads.length) continue;
          const source = await snapshot(db,type,entity.id,true);
          let parent = null;
          if (type === 'field' && source.row.object_id) {
            const [parents] = await db.execute("SELECT CAST(current_version_id AS CHAR) AS version_id FROM data_map_definition_heads WHERE entity_type='object' AND entity_id=?",[source.row.object_id]);
            parent = parents[0]?.version_id || null;
          }
          await insertVersion(db,{type,entityId:entity.id,revision:1,parent,definition:legacyDefinition(type,source),source,sourceKind:'legacy'});
        }
      }
      await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)',[MIGRATION_KEY]);
      await db.commit();
    } catch (error) { await db.rollback(); throw error; }
    return await inspectDefinitions(db);
  } finally { await db.execute("SELECT RELEASE_LOCK('mdm_definition_migration_v1')"); }
}

module.exports = { inspectDefinitions, applyDefinitions, baseTables, tables, MIGRATION_KEY };
