// Explicit additive compatibility preparation. Never called by application startup.
// Input: an authorized MySQL connection. Output: schema inspection/receipt.
// Side effect of applyMigration only: relax three legacy NOT NULL columns; no row rewrite.
const MIGRATION_KEY = 'process-platform-publication-separation-v1-20261020';
const COLUMNS = [
  ['process_design_drafts', 'planned_edition', 'VARCHAR(16) NULL'],
  ['process_design_versions', 'edition', 'VARCHAR(16) NULL'],
  ['process_design_versions', 'effective_at', 'TIMESTAMP NULL DEFAULT NULL']
];
async function inspectSchema(db) {
  const [rows] = await db.execute(`SELECT TABLE_NAME,COLUMN_NAME,IS_NULLABLE,COLUMN_TYPE,COLUMN_DEFAULT,EXTRA
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND
    ((TABLE_NAME='process_design_drafts' AND COLUMN_NAME='planned_edition') OR
     (TABLE_NAME='process_design_versions' AND COLUMN_NAME IN ('edition','effective_at')))`);
  const missing = COLUMNS.filter(([table,column]) => !rows.some(r => r.TABLE_NAME === table && r.COLUMN_NAME === column));
  const drift=rows.filter(row=>{
    const timestamp=row.COLUMN_NAME==='effective_at',currentDefault=/^current_timestamp(?:\(\))?$/i.test(row.COLUMN_DEFAULT || '');
    return (timestamp?!/^timestamp$/i.test(row.COLUMN_TYPE || ''):!/^varchar\(16\)$/i.test(row.COLUMN_TYPE || '')) ||
      (row.COLUMN_DEFAULT != null && !(timestamp && currentDefault)) ||
      Boolean(row.EXTRA && !(timestamp && currentDefault && /^DEFAULT_GENERATED$/i.test(row.EXTRA)));
  })
    .map(row=>`${row.TABLE_NAME}.${row.COLUMN_NAME}`);
  const pending = COLUMNS.filter(([table,column]) => rows.some(r => r.TABLE_NAME === table && r.COLUMN_NAME === column &&
    (r.IS_NULLABLE !== 'YES' || column === 'effective_at' && r.COLUMN_DEFAULT != null)));
  return { migration_key: MIGRATION_KEY, ready: !missing.length && !pending.length && !drift.length, missing: missing.map(([t,c]) => `${t}.${c}`),drift,
    statements: drift.length || missing.length ? [] : pending.map(([table,column,definition]) => `ALTER TABLE ${table} MODIFY COLUMN ${column} ${definition}`), legacy_rows_rewritten: false };
}
async function assertReady(db) {
  const state = await inspectSchema(db);
  if (!state.ready) throw Object.assign(new Error('平台版本与企业制度版次分离结构尚未显式准备'), { statusCode:503,
    payload:{error:'平台版本与企业制度版次分离结构尚未显式准备',code:'FORMAL_PUBLICATION_SCHEMA_REQUIRED',missing:state.missing} });
}
async function applyMigration(db, { authorized = false } = {}) {
  if (!authorized) throw new Error('FORMAL_PUBLICATION_MIGRATION_AUTHORIZATION_REQUIRED');
  const before = await inspectSchema(db);
  if (before.missing.length) throw new Error('FORMAL_PUBLICATION_BASE_SCHEMA_MISSING');
  if (before.drift.length) throw new Error('FORMAL_PUBLICATION_SCHEMA_DRIFT');
  for (const statement of before.statements) await db.execute(statement);
  await db.execute('INSERT INTO schema_migrations(migration_key) VALUES (?) ON DUPLICATE KEY UPDATE applied_at=applied_at', [MIGRATION_KEY]);
  const after = await inspectSchema(db);
  if (!after.ready) throw new Error('FORMAL_PUBLICATION_MIGRATION_INCOMPLETE');
  return { ...after, changed: before.statements.length, preserved_legacy_values:true };
}
module.exports = { MIGRATION_KEY, inspectSchema, assertReady, applyMigration };
