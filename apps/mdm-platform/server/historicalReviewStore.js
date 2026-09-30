// Append-only historical snapshots, not a second governance issue store.
const { digest, json, parse } = require('./dataMapDefinitionValues');
const { VERSION, fail } = require('./historicalReviewSource');
const { compareCreateStatements } = require('./processV7M0Baseline');
const MIGRATION_KEY = '2026-09-28-historical-review-v1';
const tables = ['data_map_history_batches', 'data_map_history_opinions'];
const statements = () => [
  `CREATE TABLE IF NOT EXISTS data_map_history_batches (
  batch_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  plan_digest CHAR(64) NOT NULL,
  manifest_json JSON NOT NULL,
  item_count INT NOT NULL,
  imported_at DATETIME(3) NOT NULL,
  CHECK (item_count >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS data_map_history_opinions (
  batch_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  ordinal_no INT NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  PRIMARY KEY (batch_key,original_id),
  UNIQUE KEY uq_history_ordinal (batch_key,ordinal_no),
  CONSTRAINT fk_history_batch FOREIGN KEY (batch_key) REFERENCES data_map_history_batches(batch_key),
  CHECK (ordinal_no >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];
async function inspect(db) {
  const missing = [], drift = [];
  for (let i = 0; i < tables.length; i++) {
    const [present] = await db.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [tables[i]]);
    if (!present.length) { missing.push(tables[i]); continue; }
    const [[ddl]] = await db.query('SHOW CREATE TABLE ' + tables[i]);
    const [collations] = await db.execute('SELECT COLUMN_NAME,COLLATION_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLLATION_NAME IS NOT NULL', [tables[i]]);
    const invalidCollation = collations.some(c => c.COLLATION_NAME !== (c.COLUMN_NAME === 'batch_key' ? 'ascii_bin' : c.COLUMN_NAME === 'original_id' ? 'utf8mb4_bin' : 'utf8mb4_unicode_ci'));
    if (!compareCreateStatements(statements()[i], ddl['Create Table']).matching || !/ENGINE=InnoDB/i.test(ddl['Create Table']) || /NOT ENFORCED/i.test(ddl['Create Table']) || invalidCollation) drift.push(tables[i]);
  }
  const [markerTable] = await db.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'");
  const markers = markerTable.length ? (await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]))[0] : [];
  if (!markerTable.length) drift.push('schema_migrations_missing');
  return { ready: !missing.length && !drift.length && !!markers.length, missing, drift };
}
async function migrate(db) {
  const [[lock]] = await db.execute("SELECT GET_LOCK('mdm_history_schema_v1',10) acquired");
  if (Number(lock.acquired) !== 1) throw fail('MIGRATION_BUSY');
  try {
    const before = await inspect(db);
    if (before.drift.length) throw fail('SCHEMA_DRIFT');
    for (let i = 0; i < tables.length; i++) if (before.missing.includes(tables[i])) await db.execute(statements()[i]);
    const after = await inspect(db);
    if (after.missing.length || after.drift.length) throw fail('SCHEMA_DRIFT');
    await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)', [MIGRATION_KEY]);
    return inspect(db);
  } finally { await db.execute("SELECT RELEASE_LOCK('mdm_history_schema_v1')"); }
}
function validate(plan) {
  if (plan.format !== VERSION || !/^[a-f0-9]{64}$/.test(plan.batch_key) || plan.batch_key !== digest({ namespace: VERSION, sources: plan.sources }) || plan.formal_link_enabled !== false || plan.changes_governance !== false) throw fail('PLAN_INVALID');
  const ids = new Set();
  for (const item of plan.items) {
    if (typeof item.original_id !== 'string' || !item.original_id || item.original_id.length > 128 || ids.has(item.original_id) ||
      item.platform_ref !== 'history:' + plan.batch_key + ':' + item.original_id || item.original?.id !== item.original_id || item.provenance !== 'historical_review' ||
      item.issue_id !== null || item.owner_department_id !== null || item.person_id !== null) throw fail('PLAN_INVALID');
    ids.add(item.original_id);
  }
  if (plan.totals.opinions !== ids.size) throw fail('PLAN_INVALID');
}
async function read(db, batchKey) {
  if (!/^[a-f0-9]{64}$/.test(batchKey)) throw fail('BATCH_INVALID');
  const [[row]] = await db.execute('SELECT * FROM data_map_history_batches WHERE batch_key=?', [batchKey]);
  if (!row) throw fail('BATCH_NOT_FOUND');
  const [items] = await db.execute('SELECT * FROM data_map_history_opinions WHERE batch_key=? ORDER BY ordinal_no', [batchKey]);
  if (items.length !== row.item_count) throw fail('INTEGRITY_CONFLICT');
  const plan = { ...parse(row.manifest_json), items: items.map((r, i) => {
    const item = parse(r.snapshot_json);
    if (r.ordinal_no !== i || r.original_id !== item.original_id || digest(item) !== r.snapshot_digest) throw fail('INTEGRITY_CONFLICT');
    return item;
  }) };
  validate(plan);
  if (digest(plan) !== row.plan_digest) throw fail('INTEGRITY_CONFLICT');
  return plan;
}
async function importSnapshot(db, plan) {
  validate(plan);
  if (!(await inspect(db)).ready) throw fail('MIGRATION_REQUIRED');
  const lockName = 'hist:' + plan.batch_key.slice(0, 58);
  const [[lock]] = await db.execute('SELECT GET_LOCK(?,10) acquired', [lockName]);
  if (Number(lock.acquired) !== 1) throw fail('IMPORT_BUSY');
  try {
    await db.beginTransaction();
    const [[existing]] = await db.execute('SELECT plan_digest FROM data_map_history_batches WHERE batch_key=? FOR UPDATE', [plan.batch_key]);
    if (existing) {
      const prior = await read(db, plan.batch_key);
      if (digest(plan) !== digest(prior)) throw fail('BATCH_CONTENT_CONFLICT');
      await db.commit();
      return { batch_key: plan.batch_key, count: plan.items.length, duplicate: true };
    }
    const { items, ...manifest } = plan;
    await db.execute('INSERT INTO data_map_history_batches(batch_key,plan_digest,manifest_json,item_count,imported_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))', [plan.batch_key, digest(plan), json(manifest), items.length]);
    for (const [i, item] of items.entries()) await db.execute('INSERT INTO data_map_history_opinions(batch_key,original_id,ordinal_no,snapshot_json,snapshot_digest) VALUES (?,?,?,?,?)', [plan.batch_key, item.original_id, i, json(item), digest(item)]);
    await read(db, plan.batch_key);
    await db.commit();
    return { batch_key: plan.batch_key, count: items.length, duplicate: false };
  } catch (e) { await db.rollback(); throw e; }
  finally { await db.execute('SELECT RELEASE_LOCK(?)', [lockName]); }
}
module.exports = { MIGRATION_KEY, tables, statements, inspect, migrate, validate, read, importSnapshot };
