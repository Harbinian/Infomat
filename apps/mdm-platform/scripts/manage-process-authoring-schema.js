// Explicit three-table maintenance only. Inputs: exact MYSQL_* environment and
// reviewed CLI evidence; output: credential-free schema inventory or receipt.
// Never loads private files/config, runs generic governance preparation, grants
// permissions, changes controlled state/epoch, enables flags or starts services.
const crypto = require('node:crypto');
const { lazyMysqlPool } = require('../server/boundedMysql');
const authorization = require('../server/governanceMigrationAuthorization');
const schema = require('../server/processAuthoringWorkspaceSchema');
const { splitSqlStatements } = require('../server/mysqlSchema');
const { CONTRACT_VERSION } = require('../server/dataMapHandoffSchema');
const CONTRACT = 'process-authoring-schema-maintenance-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const TABLES = splitSqlStatements(schema.SCHEMA_SQL).map(sql => sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1]);
const fail = code => Object.assign(new Error(code), { code, statusCode: 409 });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function argumentsFor(args, env) {
  const switches = new Set(['--inspect', '--apply', '--authorize-formal-migration']);
  const fields = new Set(['--target', '--server-uuid', '--deployment-id', '--expected-cutover-epoch', '--confirm-target',
    '--backup-file', '--backup-sha256', '--restore-receipt-file', '--restore-receipt-sha256', '--authorization-reference',
    '--write-fence-reference', '--expected-inventory-sha256']);
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (Object.hasOwn(values, key) || !switches.has(key) && !fields.has(key)) throw fail('PROCESS_AUTHORING_MIGRATION_ARGUMENT_INVALID');
    if (switches.has(key)) values[key] = true;
    else {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw fail('PROCESS_AUTHORING_MIGRATION_ARGUMENT_INVALID');
      values[key] = args[++index];
    }
  }
  if (Boolean(values['--inspect']) === Boolean(values['--apply'])) throw fail('PROCESS_AUTHORING_MIGRATION_ARGUMENT_INVALID');
  if (!['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'].every(key => String(env[key] || '').trim())
    || !/^\d{1,5}$/.test(env.MYSQL_PORT) || Number(env.MYSQL_PORT) < 1 || Number(env.MYSQL_PORT) > 65535) throw fail('PROCESS_AUTHORING_MIGRATION_EXPLICIT_TARGET_REQUIRED');
  const target = `${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE}`;
  if (values['--target'] !== target) throw fail('PROCESS_AUTHORING_MIGRATION_TARGET_MISMATCH');
  if (!/^[A-Za-z0-9_]{1,64}$/.test(env.MYSQL_DATABASE) || !UUID.test(values['--server-uuid'] || '') || !UUID.test(values['--deployment-id'] || '')
    || !/^[1-9]\d{0,18}$/.test(values['--expected-cutover-epoch'] || '') || BigInt(values['--expected-cutover-epoch']) > 9223372036854775807n) throw fail('PROCESS_AUTHORING_MIGRATION_TARGET_REQUIRED');
  const options = { mode: values['--apply'] ? 'apply' : 'inspect', target, database: env.MYSQL_DATABASE, serverUuid: values['--server-uuid'],
    deploymentId: values['--deployment-id'], expectedCutoverEpoch: values['--expected-cutover-epoch'] };
  if (options.mode === 'apply') {
    if (!values['--authorize-formal-migration'] || values['--confirm-target'] !== target || !SHA.test(values['--expected-inventory-sha256'] || '')
      || !values['--authorization-reference']?.trim() || !values['--write-fence-reference']?.trim()) throw fail('PROCESS_AUTHORING_MIGRATION_AUTHORIZATION_REQUIRED');
    Object.assign(options, { authorizeFormalMigration: true, authorizationReference: values['--authorization-reference'], writeFenceReference: values['--write-fence-reference'],
      backupFile: values['--backup-file'], backupSha256: values['--backup-sha256'], restoreReceiptFile: values['--restore-receipt-file'],
      restoreReceiptSha256: values['--restore-receipt-sha256'], expectedInventoryDigest: values['--expected-inventory-sha256'] });
    authorization.verifyRecoveryEvidence(options);
  } else if (Object.keys(values).some(key => !['--inspect', '--target', '--server-uuid', '--deployment-id', '--expected-cutover-epoch'].includes(key))) {
    throw fail('PROCESS_AUTHORING_MIGRATION_ARGUMENT_INVALID');
  }
  return options;
}

async function tableInventory(db, table, { count = false } = {}) {
  const [[present]] = await db.execute('SELECT ENGINE,TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
  if (!present) return { table, exists: false };
  const [[ddl]] = await db.query('SHOW CREATE TABLE `' + table + '`');
  const [columns] = await db.execute('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [table]);
  const [[rows]] = count ? await db.query('SELECT CAST(COUNT(*) AS CHAR) n FROM `' + table + '`') : [[null]];
  return { table, exists: true, engine: present.ENGINE, collation: present.TABLE_COLLATION,
    ddl_sha256: digest(ddl['Create Table']), columns_sha256: digest(columns),
    column_collation_matching: columns.every(column => !column.COLLATION_NAME || column.COLLATION_NAME === 'utf8mb4_unicode_ci'),
    ...(count ? { row_count: String(rows.n) } : {}) };
}
async function controlledState(db, options) {
  const [[table]] = await db.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_governance_control'");
  if (!table) throw fail('PROCESS_AUTHORING_MIGRATION_CONTROL_REQUIRED');
  const [[control]] = await db.execute('SELECT cutover_state,CAST(cutover_epoch AS CHAR) cutover_epoch,contract_version FROM data_map_governance_control WHERE control_id=1');
  if (!control || control.cutover_state !== 'controlled' || String(control.cutover_epoch) !== options.expectedCutoverEpoch || control.contract_version !== CONTRACT_VERSION) throw fail('PROCESS_AUTHORING_MIGRATION_CONTROL_CHANGED');
  return control;
}
function validateOptions(options) {
  if (!UUID.test(options.deploymentId || '') || !/^[1-9]\d{0,18}$/.test(options.expectedCutoverEpoch || '') || BigInt(options.expectedCutoverEpoch) > 9223372036854775807n) throw fail('PROCESS_AUTHORING_MIGRATION_TARGET_REQUIRED');
}
async function inspectOn(db, options, permit) {
  validateOptions(options); await authorization.verifyMigrationPermit(db, permit);
  const control = await controlledState(db, options);
  const base = await tableInventory(db, 'schema_migrations');
  if (!base.exists) throw fail('PROCESS_AUTHORING_MIGRATION_BASE_REQUIRED');
  const state = await schema.inspectSchema(db);
  const tables = [];
  for (const table of TABLES) tables.push(await tableInventory(db, table, { count: true }));
  const [markers] = await db.execute('SELECT migration_key,CAST(applied_at AS CHAR) applied_at FROM schema_migrations WHERE migration_key<>? ORDER BY migration_key', [schema.MIGRATION_KEY]);
  const [triggers] = await db.execute(`SELECT EVENT_OBJECT_TABLE table_name,TRIGGER_NAME trigger_name FROM information_schema.triggers
    WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN (?,?,?,?) ORDER BY EVENT_OBJECT_TABLE,TRIGGER_NAME`, [...TABLES, 'schema_migrations']);
  const issues = [];
  if (state.drift.length || tables.some(table => table.exists && !table.column_collation_matching)) issues.push('schema_drift');
  if (state.migration_applied && state.missing.length) issues.push('marker_without_complete_schema');
  if (!state.migration_applied && tables.some(table => table.exists && table.row_count !== '0')) issues.push('unrecorded_nonempty_tables');
  if (triggers.length) issues.push('unexpected_triggers');
  const inventory = { schema_version: CONTRACT, deployment_id: options.deploymentId, target: { database: options.database, server_uuid: options.serverUuid },
    expected_ddl_sha256: digest(schema.SCHEMA_SQL), control, base, previous_migrations_sha256: digest(markers),
    migration_applied: state.migration_applied, tables, triggers };
  return { schema_version: CONTRACT, inventory, inventory_digest: digest(inventory), applicable: !issues.length, ready: state.ready && !issues.length,
    issues, missing_tables: state.missing.filter(table => TABLES.includes(table)), side_effects: 'none' };
}
async function inspect(pool, options) {
  const db = await pool.getConnection();
  try { const permit = await authorization.createMigrationPermit(db, options); return await inspectOn(db, options, permit); }
  finally { db.release(); }
}
async function apply(pool, options) {
  const db = await pool.getConnection(); let locked = false;
  try {
    validateOptions(options);
    const permit = await authorization.createMigrationPermit(db, options, { write: true });
    const [[lock]] = await db.execute("SELECT GET_LOCK('mdm_governance_deployment_v1',10) acquired");
    if (Number(lock.acquired) !== 1) throw fail('PROCESS_AUTHORING_MIGRATION_BUSY');
    locked = true;
    const before = await inspectOn(db, options, permit);
    if (!before.applicable) throw Object.assign(fail('PROCESS_AUTHORING_MIGRATION_PRECHECK_FAILED'), { report: before });
    if (!SHA.test(options.expectedInventoryDigest || '') || before.inventory_digest !== options.expectedInventoryDigest) throw fail('PROCESS_AUTHORING_MIGRATION_INVENTORY_CHANGED');
    await schema.applyMigration(db, permit);
    const after = await inspectOn(db, options, permit);
    if (!after.ready || before.inventory.previous_migrations_sha256 !== after.inventory.previous_migrations_sha256
      || digest(before.inventory.base) !== digest(after.inventory.base) || digest(before.inventory.control) !== digest(after.inventory.control)) throw fail('PROCESS_AUTHORING_MIGRATION_POSTCHECK_FAILED');
    for (const previous of before.inventory.tables.filter(table => table.exists)) {
      if (digest(previous) !== digest(after.inventory.tables.find(table => table.table === previous.table))) throw fail('PROCESS_AUTHORING_MIGRATION_EXISTING_TABLE_CHANGED');
    }
    return { schema_version: CONTRACT, deployment_id: options.deploymentId, target: before.inventory.target,
      before_inventory_digest: before.inventory_digest, after_inventory_digest: after.inventory_digest,
      expected_ddl_sha256: after.inventory.expected_ddl_sha256, tables_created: before.missing_tables, ready: true,
      idempotent: before.ready, cutover_state: after.inventory.control.cutover_state, cutover_epoch: after.inventory.control.cutover_epoch,
      backup_sha256: options.backupSha256, restore_receipt_sha256: options.restoreReceiptSha256,
      authorization_reference: options.authorizationReference, write_fence_reference: options.writeFenceReference,
      runtime_enabled: false, runtime_grants_changed: false, original_data_rewritten: false,
      side_effects: before.ready ? 'none' : 'create_missing_authoring_tables_and_record_marker' };
  } finally {
    if (locked) await db.execute("SELECT RELEASE_LOCK('mdm_governance_deployment_v1')").catch(() => {});
    db.release();
  }
}
async function main(args = process.argv.slice(2), env = process.env) {
  const options = argumentsFor(args, env);
  const pool = lazyMysqlPool({ ...env, MYSQL_CONNECTION_LIMIT: '1' }, 1, 5000, { operationTimeoutMs: 120000 });
  try { const result = options.mode === 'apply' ? await apply(pool, options) : await inspect(pool, options); console.log(JSON.stringify(result)); if (result.applicable === false) process.exitCode = 1; return result; }
  finally { await pool.end(); }
}
if (require.main === module) main().catch(error => {
  if (error.report) console.error(JSON.stringify(error.report));
  console.error(/^PROCESS_AUTHORING_MIGRATION_|^GOVERNANCE_MIGRATION_|^PROCESS_AUTHORING_SCHEMA_/.test(error.code || '') ? error.code : 'PROCESS_AUTHORING_MIGRATION_FAILED');
  process.exitCode = 1;
});
module.exports = { CONTRACT, TABLES, argumentsFor, inspect, apply, main };
