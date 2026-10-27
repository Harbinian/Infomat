// Input: --output <new artifacts directory>. Owns two labelled tmpfs MySQLs.
// Creates a real synthetic dump and restores it; no private config, formal DB,
// existing service, role grant or feature flag is used or changed.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const cli = require('./manage-process-authoring-schema');
const authorization = require('../server/governanceMigrationAuthorization');
const schema = require('../server/processAuthoringWorkspaceSchema');
const handoff = require('../server/dataMapHandoffSchema');
const { splitSqlStatements } = require('../server/mysqlSchema');
const at = process.argv.indexOf('--output'); assert(at > 0 && process.argv[at + 1], '--output required');
const output = path.resolve(process.argv[at + 1]);
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output), 'new artifacts output required');
fs.mkdirSync(output, { recursive: true });
const checks = [];
const check = name => { checks.push(name); fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ checks }, null, 2)); console.log('PASS ' + name); };
const hash = value => authorization.sha256(Buffer.from(JSON.stringify(value)));
async function backupInventory(pool, debugFile = null) {
  const [tables] = await pool.execute('SELECT TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME');
  const result = [];
  for (const table of tables) {
    assert(/^[a-z0-9_]+$/.test(table.TABLE_NAME));
    const [[ddl]] = await pool.query('SHOW CREATE TABLE `' + table.TABLE_NAME + '`');
    const [columns] = await pool.execute('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME,GENERATION_EXPRESSION FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [table.TABLE_NAME]);
    for (const column of columns) assert(/^[a-z0-9_]+$/.test(column.COLUMN_NAME));
    const [rows] = await pool.query('SELECT ' + columns.map(column => 'CAST(`' + column.COLUMN_NAME + '` AS CHAR) `' + column.COLUMN_NAME + '`').join(',') + ' FROM `' + table.TABLE_NAME + '`');
    rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    // MySQL adds redundant CHARACTER SET text to SHOW CREATE after restore.
    // Compare actual column metadata plus parsed keys/checks/FKs, and all rows.
    const components = Object.fromEntries([...require('../server/processV7M0Baseline').schemaComponents(ddl['Create Table'])].sort(([left], [right]) => left.localeCompare(right)));
    result.push({ ...table, schema_components: components, columns, row_count: String(rows.length), rows_sha256: hash(rows) });
  }
  const [guard] = await pool.execute('SELECT id,original_value FROM synthetic_authoring_source_guard ORDER BY id');
  const [control] = await pool.execute('SELECT control_id,cutover_state,CAST(cutover_epoch AS CHAR) cutover_epoch,CAST(graph_revision AS CHAR) graph_revision,CAST(next_definition_version_id AS CHAR) next_definition_version_id,contract_version FROM data_map_governance_control');
  const [markers] = await pool.execute('SELECT migration_key,CAST(applied_at AS CHAR) applied_at FROM schema_migrations ORDER BY migration_key');
  const value = { tables: result, guard, control, markers };
  if (debugFile) fs.writeFileSync(debugFile, JSON.stringify(value, null, 2));
  return hash(value);
}
function adaptedPool(pool, { failSecondDdl = false, textRows = false } = {}) {
  return { async getConnection() {
    const db = await pool.getConnection();
    return new Proxy(db, { get(target, key) {
      if (key === 'execute' || key === 'query') return async (...args) => {
        if (failSecondDdl && /^CREATE TABLE IF NOT EXISTS process_authoring_revisions\b/.test(args[0])) return db.query('SELECT * FROM synthetic_missing_authoring_migration_table');
        const response = await db[key](...args);
        if (textRows && Array.isArray(response[0])) return [response[0].map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, typeof value === 'number' ? String(value) : value]))), response[1]];
        return response;
      };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
  } };
}
async function main() {
  const syntheticEnv = { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', MYSQL_USER: 'synthetic', MYSQL_PASSWORD: 'synthetic-unused-argument-test', MYSQL_DATABASE: 'synthetic' };
  const baseArgs = ['--inspect', '--target', '127.0.0.1:1/synthetic', '--server-uuid', crypto.randomUUID(), '--deployment-id', crypto.randomUUID(), '--expected-cutover-epoch', '1'];
  assert.equal(cli.argumentsFor(baseArgs, syntheticEnv).mode, 'inspect');
  for (const [args, env] of [[['--inspect'], {}], [baseArgs, { ...syntheticEnv, MYSQL_PORT: '' }], [[...baseArgs, '--apply'], syntheticEnv],
    [[...baseArgs, '--target', 'other'], syntheticEnv], [[...baseArgs, '--expected-inventory-sha256', '0'.repeat(64)], syntheticEnv]]) assert.throws(() => cli.argumentsFor(args, env));
  assert.throws(() => cli.argumentsFor(baseArgs.map(value => value === '127.0.0.1:1/synthetic' ? 'other:1/synthetic' : value), syntheticEnv), { code: 'PROCESS_AUTHORING_MIGRATION_TARGET_MISMATCH' });
  check('CLI rejects implicit/duplicate/mismatched targets and execution fields in inspection before connection');
  await withFreshMysql(async source => {
    await require('../server/identityMysqlRepository').makeIdentityMysqlRepository(source.pool).initSchema();
    await source.pool.execute(handoff.statements().find(sql => /^CREATE TABLE IF NOT EXISTS data_map_governance_control\b/.test(sql)));
    await source.pool.execute("INSERT INTO data_map_governance_control(control_id,cutover_state,cutover_epoch,graph_revision,next_definition_version_id,contract_version) VALUES(1,'controlled',1,7,9007199254741001,?)", [handoff.CONTRACT_VERSION]);
    await source.pool.execute('CREATE TABLE synthetic_authoring_source_guard(id INT PRIMARY KEY,original_value TEXT NOT NULL) ENGINE=InnoDB');
    await source.pool.execute("INSERT INTO synthetic_authoring_source_guard VALUES(1,'Synthetic preserved original\nwith spacing  ')");
    await source.pool.execute("INSERT INTO schema_migrations(migration_key) VALUES('synthetic-preserved-before-authoring')");
    const [[identity]] = await source.pool.execute('SELECT @@server_uuid server_uuid');
    const options = { database: source.database, serverUuid: identity.server_uuid, deploymentId: crypto.randomUUID(), expectedCutoverEpoch: '1' };
    const before = await cli.inspect(source.pool, options);
    assert.equal(before.applicable, true); assert.deepEqual(before.missing_tables, cli.TABLES); assert.equal(before.ready, false);
    assert.equal((await source.pool.execute("SELECT COUNT(*) n FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'process_authoring_%'"))[0][0].n, 0);
    check('inspection is read only on an already controlled epoch-one target and names exactly three additive tables');
    const originalInventory = await backupInventory(source.pool, path.join(output, 'synthetic-source-inventory.json')), backup = source.backup();
    const backupFile = path.join(output, 'synthetic-backup.sql'); fs.writeFileSync(backupFile, backup);
    await withFreshMysql(async restored => {
      restored.restore(backup);
      const restoredInventory = await backupInventory(restored.pool, path.join(output, 'synthetic-restored-inventory.json')); assert.equal(restoredInventory, originalInventory);
      const [[restoredIdentity]] = await restored.pool.execute('SELECT @@server_uuid server_uuid');
      const receipt = { contract: 'governance-backup-restore-v1', status: 'passed', source: { database: source.database, server_uuid: identity.server_uuid, container_id: source.containerId },
        backup_sha256: authorization.sha256(backup), restore_target: { database: restored.database, server_uuid: restoredIdentity.server_uuid, container_id: restored.containerId },
        schema_verified: true, data_verified: true, source_inventory_sha256: originalInventory, restored_inventory_sha256: restoredInventory };
      const receiptFile = path.join(output, 'synthetic-restore-receipt.json'); fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
      Object.assign(options, { authorizeFormalMigration: true, authorizationReference: 'synthetic-explicit-authoring-schema-only', writeFenceReference: 'owned-synthetic-target-no-runtime',
        backupFile, backupSha256: receipt.backup_sha256, restoreReceiptFile: receiptFile, restoreReceiptSha256: authorization.sha256(fs.readFileSync(receiptFile)), expectedInventoryDigest: before.inventory_digest });
      check('real dump restores into another owned MySQL with equal full schema/count and synthetic source fingerprints');
      const applyArgs = ['--apply', '--target', `127.0.0.1:${source.port}/${source.database}`, '--server-uuid', identity.server_uuid, '--deployment-id', options.deploymentId,
        '--expected-cutover-epoch', '1', '--authorize-formal-migration', '--confirm-target', `127.0.0.1:${source.port}/${source.database}`, '--backup-file', backupFile,
        '--backup-sha256', options.backupSha256, '--restore-receipt-file', receiptFile, '--restore-receipt-sha256', options.restoreReceiptSha256,
        '--authorization-reference', options.authorizationReference, '--write-fence-reference', options.writeFenceReference, '--expected-inventory-sha256', before.inventory_digest];
      const env = { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: String(source.port), MYSQL_USER: 'root', MYSQL_PASSWORD: source.password, MYSQL_DATABASE: source.database };
      assert.equal(cli.argumentsFor(applyArgs, env).expectedInventoryDigest, before.inventory_digest);
      const inspectArgs = ['--inspect', '--target', `127.0.0.1:${source.port}/${source.database}`, '--server-uuid', identity.server_uuid,
        '--deployment-id', options.deploymentId, '--expected-cutover-epoch', '1'];
      const commandOutput = execFileSync(process.execPath, [path.join(__dirname, 'manage-process-authoring-schema.js'), ...inspectArgs], {
        env: require('./testHelpers/isolatedProcess').isolatedEnvironment(env), encoding: 'utf8', windowsHide: true, timeout: 15000
      });
      assert.equal(JSON.parse(commandOutput).inventory_digest, before.inventory_digest); assert(!commandOutput.includes(source.password));
      check('actual CLI inspection uses the explicit owned target and emits the same inventory without credentials');
      for (const [patch, code] of [
        [{ serverUuid: crypto.randomUUID() }, 'GOVERNANCE_MIGRATION_TARGET_MISMATCH'], [{ database: 'other_database' }, 'GOVERNANCE_MIGRATION_TARGET_MISMATCH'],
        [{ authorizeFormalMigration: false }, 'GOVERNANCE_MIGRATION_AUTHORIZATION_REQUIRED'], [{ writeFenceReference: '' }, 'GOVERNANCE_MIGRATION_AUTHORIZATION_REQUIRED'],
        [{ backupSha256: '0'.repeat(64) }, 'GOVERNANCE_MIGRATION_BACKUP_REQUIRED'], [{ restoreReceiptSha256: '0'.repeat(64) }, 'GOVERNANCE_MIGRATION_RESTORE_REQUIRED'],
        [{ expectedInventoryDigest: '0'.repeat(64) }, 'PROCESS_AUTHORING_MIGRATION_INVENTORY_CHANGED'], [{ expectedCutoverEpoch: '2' }, 'PROCESS_AUTHORING_MIGRATION_CONTROL_CHANGED']
      ]) await assert.rejects(cli.apply(source.pool, { ...options, ...patch }), { code });
      assert.equal((await cli.inspect(source.pool, options)).inventory_digest, before.inventory_digest);
      check('wrong UUID/database/epoch, missing authorization/fence, altered evidence and stale inventory refuse without DDL');
      const oldControl = (await source.pool.execute('SELECT * FROM data_map_governance_control'))[0];
      await source.pool.execute("UPDATE data_map_governance_control SET cutover_state='prepared' WHERE control_id=1");
      await assert.rejects(cli.inspect(source.pool, options), { code: 'PROCESS_AUTHORING_MIGRATION_CONTROL_CHANGED' });
      await source.pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled' WHERE control_id=1");
      await source.pool.execute(splitSqlStatements(schema.SCHEMA_SQL)[0]);
      await source.pool.execute('ALTER TABLE process_authoring_drafts ADD COLUMN synthetic_drift INT NULL');
      assert.equal((await cli.inspect(source.pool, options)).applicable, false);
      await assert.rejects(cli.apply(source.pool, options), { code: 'PROCESS_AUTHORING_MIGRATION_PRECHECK_FAILED' });
      await source.pool.execute('DROP TABLE process_authoring_drafts');
      await source.pool.execute(splitSqlStatements(schema.SCHEMA_SQL)[0]);
      await source.pool.execute("ALTER TABLE process_authoring_drafts MODIFY content_hash CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL");
      assert.equal((await cli.inspect(source.pool, options)).applicable, false);
      await source.pool.execute('DROP TABLE process_authoring_drafts');
      check('prepared control state, schema drift and per-column collation drift fail closed');
      await source.pool.execute(splitSqlStatements(schema.SCHEMA_SQL)[0]);
      await source.pool.execute('INSERT INTO process_authoring_drafts(draft_id,owning_department_id,created_by_person_id,updated_by_person_id,revision_no,content_hash,document_json) VALUES(?,91,81,81,1,?,?)', [crypto.randomUUID(), 'a'.repeat(64), JSON.stringify({ synthetic: true })]);
      assert((await cli.inspect(source.pool, options)).issues.includes('unrecorded_nonempty_tables'));
      await assert.rejects(cli.apply(source.pool, options), { code: 'PROCESS_AUTHORING_MIGRATION_PRECHECK_FAILED' });
      await source.pool.execute('DROP TABLE process_authoring_drafts');
      await source.pool.query("CREATE TRIGGER synthetic_authoring_marker_trigger BEFORE INSERT ON schema_migrations FOR EACH ROW SET @synthetic_authoring_marker_seen=1");
      assert((await cli.inspect(source.pool, options)).issues.includes('unexpected_triggers'));
      await assert.rejects(cli.apply(source.pool, options), { code: 'PROCESS_AUTHORING_MIGRATION_PRECHECK_FAILED' });
      await source.pool.query('DROP TRIGGER synthetic_authoring_marker_trigger');
      check('unrecorded nonempty drafts and unexpected migration triggers cannot be silently adopted');
      const initial = await cli.apply(source.pool, options);
      assert.equal(initial.ready, true); assert.equal(initial.idempotent, false); assert.deepEqual(initial.tables_created, cli.TABLES);
      assert.deepEqual((await source.pool.execute('SELECT * FROM data_map_governance_control'))[0], oldControl);
      // Reset only this owned test's newly created tables/marker to rehearse an
      // interrupted first apply against the exact same preserved base target.
      for (const table of [...cli.TABLES].reverse()) await source.pool.execute('DROP TABLE `' + table + '`');
      await source.pool.execute('DELETE FROM schema_migrations WHERE migration_key=?', [schema.MIGRATION_KEY]);
      assert.equal((await cli.inspect(source.pool, options)).inventory_digest, before.inventory_digest);
      check('first successful apply creates exactly the three tables and marker without changing controlled epoch or old data');
      await assert.rejects(cli.apply(adaptedPool(source.pool, { failSecondDdl: true }), options), { code: 'ER_NO_SUCH_TABLE' });
      const partial = await cli.inspect(source.pool, options);
      assert.equal(partial.applicable, true); assert.equal(partial.inventory.migration_applied, false);
      assert.deepEqual(partial.missing_tables, ['process_authoring_revisions', 'process_authoring_requests']);
      await assert.rejects(cli.apply(source.pool, options), { code: 'PROCESS_AUTHORING_MIGRATION_INVENTORY_CHANGED' });
      options.expectedInventoryDigest = partial.inventory_digest;
      const first = await cli.apply(source.pool, options);
      assert.equal(first.ready, true); assert.deepEqual(first.tables_created, partial.missing_tables);
      assert.deepEqual((await source.pool.execute('SELECT * FROM data_map_governance_control'))[0], oldControl);
      assert.deepEqual((await source.pool.execute('SELECT original_value FROM synthetic_authoring_source_guard'))[0], [{ original_value: 'Synthetic preserved original\nwith spacing  ' }]);
      check('real second-DDL failure preserves partial first table; fresh reviewed inventory safely resumes only missing tables');
      const ready = await cli.inspect(source.pool, options); options.expectedInventoryDigest = ready.inventory_digest;
      const second = await cli.apply(source.pool, options);
      assert.equal(second.idempotent, true); assert.deepEqual(second.tables_created, []);
      assert.equal((await source.pool.execute('SELECT COUNT(*) n FROM schema_migrations WHERE migration_key=?', [schema.MIGRATION_KEY]))[0][0].n, 1);
      assert.equal((await cli.inspect(adaptedPool(source.pool, { textRows: true }), options)).inventory_digest, ready.inventory_digest);
      check('completed migration is idempotent with one marker and native/text maintenance transports share exact inventory digests');
      await source.pool.execute('DROP TABLE process_authoring_requests');
      assert((await cli.inspect(source.pool, options)).issues.includes('marker_without_complete_schema'));
      await assert.rejects(cli.apply(source.pool, options), { code: 'PROCESS_AUTHORING_MIGRATION_PRECHECK_FAILED' });
      await source.pool.execute(splitSqlStatements(schema.SCHEMA_SQL)[2]);
      check('an existing migration marker with a missing table refuses automatic reconstruction');
      const draftId = crypto.randomUUID(), requestId = crypto.randomUUID();
      await source.pool.execute('INSERT INTO process_authoring_drafts(draft_id,owning_department_id,created_by_person_id,updated_by_person_id,revision_no,content_hash,document_json) VALUES(?,91,81,81,1,?,?)', [draftId, 'b'.repeat(64), JSON.stringify({ synthetic: 'preserved native body' })]);
      await source.pool.execute("INSERT INTO process_authoring_revisions(draft_id,revision_no,content_hash,document_json,actor_person_id,operation) VALUES(?,1,?,?,81,'create')", [draftId, 'b'.repeat(64), JSON.stringify({ synthetic: 'preserved native body' })]);
      await source.pool.execute('INSERT INTO process_authoring_requests(request_id,actor_person_id,request_hash,response_json) VALUES(?,81,?,?)', [requestId, 'c'.repeat(64), JSON.stringify({ synthetic: 'preserved receipt' })]);
      const retained = await backupInventory(source.pool), populated = await cli.inspect(source.pool, options);
      const last = await cli.apply(source.pool, { ...options, expectedInventoryDigest: populated.inventory_digest });
      assert.equal(last.idempotent, true); assert.equal(await backupInventory(source.pool), retained);
      assert.equal((await source.pool.execute('SELECT original_value FROM synthetic_authoring_source_guard'))[0][0].original_value, 'Synthetic preserved original\nwith spacing  ');
      check('matching registered nonempty drafts, snapshots, requests, all old markers and controlled epoch remain unchanged');
      fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', checks, before, initial, first, second, final: last, real_backup_restore: true,
        formal_database_connected: false, runtime_flags_changed: false, controlled_epoch_changed: false }, null, 2));
    }, { stage: '88', randomDatabase: true });
  }, { stage: '87', randomDatabase: true });
  console.log('PROCESS_AUTHORING_SCHEMA_MYSQL_PASS ' + checks.length + ' groups');
}
main().catch(error => { console.error(error.stack || error.code || error.message); process.exitCode = 1; });
