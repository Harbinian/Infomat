const crypto = require('node:crypto');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

function failure(code, statusCode = 400) { return Object.assign(new Error(code), { code, statusCode }); }
function id(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw failure('DEFINITION_ID_INVALID');
  const text = String(value ?? '');
  if (!/^[1-9]\d{0,18}$/.test(text) || BigInt(text) > 9223372036854775807n) throw failure('DEFINITION_ID_INVALID');
  return text;
}
function kind(value) { if (!['object','field'].includes(value)) throw failure('DEFINITION_KIND_INVALID'); return value; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const json = value => JSON.stringify(stable(value));
const digest = value => crypto.createHash('sha256').update(json(value)).digest('hex');
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const entityTable = type => kind(type) === 'object' ? 'data_map_objects' : 'data_map_fields';
// Cast BIGINT and timestamps from the fixed schema before mysql2 can round or
// apply a local timezone. Preserve all existing columns and values in snapshots.
function selectColumns(table) {
  const sql = splitSqlStatements(mdmMysqlSchemaSql()).find(s => s.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`));
  if (!sql) throw failure('DEFINITION_TABLE_INVALID');
  return sql.split('\n').map(line => line.match(/^  (\w+) (BIGINT|TIMESTAMP|DATETIME)\b/)).filter(Boolean)
    .map(([, name]) => `CAST(\`${name}\` AS CHAR) AS \`${name}\``).join(', ');
}
async function rows(db, table, where, params, lock = false) {
  const casts = selectColumns(table);
  const [result] = await db.execute(`SELECT *${casts ? ', '+casts : ''} FROM ${table} WHERE ${where}${lock ? ' FOR UPDATE' : ''}`, params);
  return result;
}
async function snapshot(db, type, entityId, lock = false) {
  const row = (await rows(db, entityTable(type), 'id=?', [id(entityId)], lock))[0];
  if (!row) throw failure('DEFINITION_ENTITY_NOT_FOUND', 404);
  if (type === 'object') return { row };
  const identities = await rows(db, 'data_map_field_identities', 'field_id=? ORDER BY id', [entityId], lock);
  const links = await rows(db, 'data_map_field_system_links', 'field_id=? ORDER BY id', [entityId], lock);
  return { row, identities, links };
}
async function lastId(db) { return (await db.execute('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id'))[0][0].id; }
function legacyDefinition(type, source) {
  const row = source.row;
  return {
    name: type === 'object' ? row.object_name_cn : row.field_name_cn,
    business_meaning: type === 'object' ? row.description : row.business_definition,
    source: null, authority_suggestion: null, governance: null,
    ...(type === 'object' ? { unique_identifiers: null } : { required: null, enum_values: null, data_type: row.data_type, data_format: row.data_format }),
    provenance: 'legacy_snapshot', unknown_semantics: true
  };
}
async function insertVersion(db, { type, entityId, revision, parent = null, previous = null, definition, source, sourceKind, actor = null }) {
  await db.execute(`INSERT INTO data_map_definition_versions
    (entity_type,entity_id,version_no,object_version_id,supersedes_version_id,schema_version,definition_json,base_snapshot_json,content_digest,base_digest,digest_algorithm,source_kind,created_by_person_id,created_at)
    VALUES (?,?,?,?,?,'data-map-definition-v1',?,?,?,?,'sha256-canonical-json-v1',?,?,UTC_TIMESTAMP(3))`,
    [type,entityId,revision,parent,previous,json(definition),json(source),digest(definition),digest(source),sourceKind,actor]);
  const versionId = await lastId(db);
  await db.execute(`INSERT INTO data_map_definition_heads(entity_type,entity_id,current_version_id,revision_no) VALUES (?,?,?,?)
    ON DUPLICATE KEY UPDATE current_version_id=VALUES(current_version_id),revision_no=VALUES(revision_no)`,[type,entityId,versionId,revision]);
  return { entity_type:type, entity_id:String(entityId), version_id:versionId, revision_no:revision };
}
module.exports = { failure, id, kind, json, digest, parse, entityTable, rows, snapshot, lastId, legacyDefinition, insertVersion };
