// Explicit, additive migration for an owned isolated or authorized formal target. No environment
// loading or startup DDL. Original tables, references and audit rows are untouched.
// Turning the feature off is not a downgrade: new versions/usages must be retained
// and inspected before any later recovery; they cannot be copied into old rows.
const crypto = require('node:crypto');
const coreSchema = require('./terminologyGovernanceSchema');
const usageSchema = require('./terminologyUsageSchema');
const schema = { MIGRATION_KEY:coreSchema.MIGRATION_KEY, TABLES:[...coreSchema.TABLES,...usageSchema.TABLES], statements:()=>[...coreSchema.statements(),...usageSchema.statements()] };
const { hash } = require('./terminologyGovernancePolicy');
const { compareCreateStatements } = require('./processV7M0Baseline');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const {sourceValue}=require('./migrationSourceValues');
const SOURCES = Object.freeze({ terminology_terms: ['pending','approved','rejected'], data_map_terms: ['draft','active','inactive','archived'] });
const LOCK = 'mdm_terminology_governance_v1';
const fail = (code, details) => Object.assign(new Error(code), { code, statusCode:409, details });
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
function isolatedTarget(database) {
  if (!/^stage\d{2}_isolated_[0-9a-f]{32}$/.test(database || '')) throw fail('TERM_MIGRATION_ISOLATED_TARGET_REQUIRED');
  return database;
}
async function target(db, options) {
  if (options?.formalTargetPermit) {
    const verified = await require('./governanceMigrationAuthorization').verifyMigrationPermit(db, options.formalTargetPermit);
    if (verified.database !== options.database) throw fail('TERM_MIGRATION_TARGET_MISMATCH');
    return verified.database;
  }
  const expected = isolatedTarget(options?.database);
  const [[actual]] = await db.execute('SELECT DATABASE() AS name');
  if (actual?.name !== expected) throw fail('TERM_MIGRATION_TARGET_MISMATCH');
  return expected;
}
function exactId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
}
async function sourceRows(db, table, lock = false, id = null) {
  if (!Object.hasOwn(SOURCES, table)) throw fail('TERM_MIGRATION_SOURCE_INVALID');
  const [columns] = await db.execute('SELECT COLUMN_NAME AS name,DATA_TYPE AS data_type FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [table]);
  if (!columns.length) return null;
  if (columns.some(c=>/password|secret|credential|private_key|api_key|token/i.test(c.name))) throw fail('TERM_MIGRATION_SENSITIVE_SCHEMA',{table});
  if (!['id','term','definition','status'].every(name => columns.some(c => c.name === name)) || columns.some(c => !/^[a-z][a-z0-9_]*$/.test(c.name))) throw fail('TERM_MIGRATION_SOURCE_SCHEMA_INVALID', { table });
  const projection = columns.map(c => /^(bigint|timestamp|datetime|date|time|decimal|json)$/.test(c.data_type) ? `CAST(\`${c.name}\` AS CHAR) AS \`${c.name}\`` : `\`${c.name}\``).join(',');
  const [rows] = await db.execute(`SELECT ${projection} FROM \`${table}\`${id == null ? '' : ' WHERE id=?'} ORDER BY id${lock ? ' FOR SHARE' : ''}`,id == null ? [] : [String(id)]);
  return rows.map(row => Object.fromEntries(columns.map(c => [c.name, Buffer.isBuffer(row[c.name]) ? { encoding:'hex', value:row[c.name].toString('hex') } : sourceValue(row[c.name],c)])));
}
async function inspectStructure(db) {
  const drift = [], missing = [], present = new Set();
  const legacy = splitSqlStatements(mdmMysqlSchemaSql()).filter(sql => ['schema_migrations', ...Object.keys(SOURCES)].some(t => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${t} (`)));
  for (const sql of [...legacy, ...schema.statements()]) {
    const table = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const [found] = await db.execute('SELECT TABLE_NAME,TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!found.length) { missing.push(table); continue; }
    present.add(table);
    const [[ddl]] = await db.query(`SHOW CREATE TABLE \`${table}\``);
    const compared = compareCreateStatements(sql, ddl['Create Table']);
    const [collations] = await db.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME<>?',[table,'utf8mb4_unicode_ci']);
    if (!compared.matching || !/ENGINE=InnoDB/i.test(ddl['Create Table']) || /NOT ENFORCED/i.test(ddl['Create Table']) || found[0].TABLE_COLLATION !== 'utf8mb4_unicode_ci' || collations.length) drift.push({table,code:'SCHEMA_DRIFT',differences:compared.differences,incompatible_collations:collations.map(c=>c.COLUMN_NAME)});
  }
  return {drift,missing,present};
}
async function inventory(db, structure, lock = false) {
  const records = [], issues = [], seen = new Map(), counts = {};
  for (const [table, statuses] of Object.entries(SOURCES)) {
    const rows = structure.present.has(table) ? await sourceRows(db,table,lock) : null;
    if (!rows) { issues.push({table,code:'LEGACY_TABLE_MISSING',blocking:true}); continue; }
    counts[table] = rows.length;
    for (const snapshot of rows) {
      const id = String(snapshot.id), usable = table === 'terminology_terms' ? snapshot.status === 'approved' : snapshot.status === 'active';
      if (!exactId(snapshot.id)) issues.push({table,id,code:'LEGACY_ID_OUTSIDE_COMPATIBLE_RANGE',blocking:true});
      if (!statuses.includes(snapshot.status)) issues.push({table,id,status:snapshot.status,code:'UNKNOWN_LEGACY_STATUS',blocking:true});
      if (!snapshot.term) issues.push({table,id,code:'LEGACY_NAME_MISSING_PRESERVED',blocking:false});
      const sameName = seen.get(snapshot.term);
      if (sameName) issues.push({table,id,code:'SAME_NAME_CONTEXT_UNCONFIRMED',other:sameName,blocking:false});
      else seen.set(snapshot.term,{table,id});
      let link = null;
      if (structure.present.has('tg_legacy_links')) {
        const [[stored]] = await db.execute('SELECT legacy_table,legacy_id,term_id,version_id,snapshot_json FROM tg_legacy_links WHERE legacy_table=? AND legacy_id=?', [table,id]);
        link = stored || null;
        if (link && hash(parse(link.snapshot_json)) !== hash(snapshot)) issues.push({table,id,code:'LEGACY_SNAPSHOT_CHANGED',blocking:true});
        if (link && structure.present.has('tg_term_versions')) {
          const [[version]] = await db.execute('SELECT term_id,content_json,content_hash FROM tg_term_versions WHERE version_id=?', [link.version_id]);
          if (!version || version.term_id !== link.term_id || hash(parse(version.content_json)) !== version.content_hash || hash(parse(version.content_json)?.legacy?.snapshot) !== hash(snapshot)) issues.push({table,id,code:'LEGACY_MAPPING_INTEGRITY_FAILED',blocking:true});
        }
      }
      records.push({table,id,snapshot,usable,link});
    }
  }
  if (structure.present.has('tg_legacy_links')) {
    const [links] = await db.execute('SELECT legacy_table,legacy_id FROM tg_legacy_links');
    const keys = new Set(records.map(r => r.table+':'+r.id));
    for (const link of links) if (!Object.hasOwn(SOURCES,link.legacy_table) || !keys.has(link.legacy_table+':'+link.legacy_id)) issues.push({table:link.legacy_table,id:link.legacy_id,code:'LEGACY_SOURCE_MISSING_OR_UNRECOGNIZED',blocking:true});
  }
  return {records,issues,counts};
}
async function inspectTerminologyGovernance(db, options = {}) {
  const database = await target(db,options);
  const structure = await inspectStructure(db), data = await inventory(db,structure,options.lock === true);
  const [markers] = structure.present.has('schema_migrations') ? await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [schema.MIGRATION_KEY]) : [[]];
  const backfill = data.records.filter(r => !r.link).map(({table,id}) => ({table,id}));
  const blocking = data.issues.filter(i => i.blocking);
  return { database, migration_key:schema.MIGRATION_KEY, ready:!structure.missing.length && !structure.drift.length && !blocking.length && !backfill.length && markers.length === 1,
    manifest_digest:hash(data.records.map(({table,id,snapshot})=>({table,id,snapshot}))),
    missing:structure.missing, drift:structure.drift, issues:data.issues, counts:data.counts, backfill, marker_applied:markers.length===1,
    source_rows_rewritten:false, sources_auto_adopted:false, contexts_inferred:false, references_rewritten:false, side_effects:'none' };
}
async function applyTerminologyGovernance(db, options = {}) {
  const database = await target(db,options);
  if (options.formalTargetPermit) {
    const verified = await require('./governanceMigrationAuthorization').verifyMigrationPermit(db, options.formalTargetPermit, {write:true});
    if (verified.backupSha256 !== options.backupSha256 || options.confirmDatabase !== database) throw fail('TERM_MIGRATION_EXPLICIT_AUTHORIZATION_REQUIRED');
  } else if (options.authorizeIsolatedMigration !== true || options.confirmDatabase !== database || !/^[a-f0-9]{64}$/.test(options.backupSha256 || '')) throw fail('TERM_MIGRATION_EXPLICIT_AUTHORIZATION_REQUIRED');
  const [[lock]] = await db.execute('SELECT GET_LOCK(?,10) AS acquired',[LOCK]);
  if (Number(lock?.acquired) !== 1) throw fail('TERM_MIGRATION_BUSY');
  let inTransaction = false, committing = false;
  try {
    const before = await inspectTerminologyGovernance(db,options);
    if (!options.expectedManifestDigest || options.expectedManifestDigest !== before.manifest_digest) throw fail('TERM_MIGRATION_DRY_RUN_REQUIRED');
    if (before.drift.length || before.issues.some(i=>i.blocking) || before.missing.some(t=>!schema.TABLES.includes(t))) throw fail('TERM_MIGRATION_PRECHECK_FAILED',before);
    // DDL commits independently in MySQL. A partial DDL failure remains visible
    // to inspect; never report it as a rolled-back schema or silently alter it.
    for (const sql of schema.statements()) if (before.missing.includes(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1])) await db.execute(sql);
    const structure = await inspectStructure(db);
    if (structure.drift.length || structure.missing.length) throw fail('TERM_MIGRATION_SCHEMA_NOT_READY',{drift:structure.drift,missing:structure.missing});
    await db.beginTransaction(); inTransaction = true;
    const data = await inventory(db,structure,true);
    if (hash(data.records.map(({table,id,snapshot})=>({table,id,snapshot}))) !== options.expectedManifestDigest) throw fail('TERM_MIGRATION_SOURCE_CHANGED_SINCE_DRY_RUN');
    if (data.issues.some(i=>i.blocking)) throw fail('TERM_MIGRATION_SOURCE_CONFLICT',data.issues);
    for (const record of data.records) {
      if (record.link) continue;
      const termId = crypto.randomUUID(), versionId = crypto.randomUUID();
      const content = { term:record.snapshot.term, definition:record.snapshot.definition, context:null, source_kind:'legacy',
        legacy:{source_table:record.table,source_id:record.id,original_status:record.snapshot.status,original_usable:record.usable,snapshot:record.snapshot,basis_status:'unverified'} };
      await db.execute(`INSERT INTO tg_terms(term_id,current_version_id,pending_version_id,draft_status,adoption_status,source_status,legacy_unverified,legacy_status,legacy_usable)
        VALUES (?,?,?,'legacy_preserved','legacy_preserved','unverified',1,?,?)`,[termId,record.usable?versionId:null,record.usable?null:versionId,record.snapshot.status,record.usable?1:0]);
      await db.execute('INSERT INTO tg_term_versions(version_id,term_id,version_no,content_json,content_hash) VALUES (?,?,1,?,?)',[versionId,termId,JSON.stringify(content),hash(content)]);
      await db.execute('INSERT INTO tg_legacy_links(legacy_table,legacy_id,term_id,version_id,snapshot_json) VALUES (?,?,?,?,?)',[record.table,record.id,termId,versionId,JSON.stringify(record.snapshot)]);
      await db.execute(`INSERT INTO tg_term_events(event_id,term_id,event_type,version_id,revision_no,reason,payload_json) VALUES (?,?,'legacy_preserved',?,1,?,?)`,
        [crypto.randomUUID(),termId,versionId,'保留历史记录及原状态，来源、语境和沿用依据待核；本次迁移不代表采纳。',JSON.stringify({migration_key:schema.MIGRATION_KEY,source_table:record.table,source_id:record.id,snapshot_hash:hash(record.snapshot),backup_sha256:options.backupSha256})]);
    }
    await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)',[schema.MIGRATION_KEY]);
    committing = true; await db.commit(); inTransaction = false; committing = false;
    return {...await inspectTerminologyGovernance(db,options),side_effects:options.formalTargetPermit?'additive_authorized_migration':'additive_isolated_migration'};
  } catch (error) {
    if (committing) throw Object.assign(fail('TERM_MIGRATION_COMMIT_UNKNOWN'),{statusCode:503});
    if (inTransaction) await db.rollback();
    throw error;
  } finally { await db.execute('SELECT RELEASE_LOCK(?)',[LOCK]).catch(()=>{}); }
}
module.exports = { MIGRATION_KEY:schema.MIGRATION_KEY, SOURCES, isolatedTarget, sourceRows, inspectTerminologyGovernance, applyTerminologyGovernance };
