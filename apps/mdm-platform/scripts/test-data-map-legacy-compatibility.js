// Synthetic records in an owned tmpfs MySQL only. Optional --metadata compares
// saved SHOW CREATE strings, never executes them. --output is a new artifacts JSON.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { compareCreateStatements } = require('../server/processV7M0Baseline');
const { inspectLegacyCompatibility: inspect, applyLegacyCompatibility: apply, MIGRATION_KEY } = require('../server/dataMapLegacyCompatibility');
const { applyDefinitions } = require('../server/dataMapDefinitionMigration');
const { snapshot, digest } = require('../server/dataMapDefinitionValues');
const { argumentsFor } = require('./manage-data-map-definitions');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const output = arg('--output') && path.resolve(arg('--output'));
if (output) { assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep)); assert(!fs.existsSync(output)); fs.mkdirSync(path.dirname(output), { recursive: true }); }
const captured = arg('--metadata') ? JSON.parse(fs.readFileSync(path.resolve(arg('--metadata')))) : null;
const checks = [];
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
const tables = ['data_map_objects', 'data_map_contexts', 'data_map_fields', 'data_map_field_system_links', 'data_map_field_identities'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function legacy(sql) {
  if (sql.startsWith('CREATE TABLE IF NOT EXISTS data_map_objects (')) return sql.replace("DEFAULT 'master_data_reviewItem'", "DEFAULT 'master_data_candidate'");
  if (sql.startsWith('CREATE TABLE IF NOT EXISTS data_map_fields (')) return sql.replace("DEFAULT 'needs_review'", "DEFAULT 'candidate'");
  if (sql.startsWith('CREATE TABLE IF NOT EXISTS data_map_field_system_links (')) return sql.replace("'candidate_authority','reviewItem_authority'", "'candidate_authority'");
  if (sql.startsWith('CREATE TABLE IF NOT EXISTS data_map_field_identities (')) return sql.replace("DEFAULT 'needs_review'", "DEFAULT 'candidate'").replace("'candidate','needs_review'", "'candidate'");
  return sql;
}
async function main() {
  const evidence = { step: 'P25', synthetic_only: true, checks };
  await withFreshMysql(async fixture => {
    const db = await fixture.pool.getConnection();
    try {
      await db.execute("SET time_zone = '+00:00'");
      const ddl = splitSqlStatements(mdmMysqlSchemaSql()).map(legacy);
      if (captured) await check('synthetic baseline matches four captured target structures', async () => {
        for (const name of tables.filter(t => t !== 'data_map_contexts')) {
          assert(compareCreateStatements(ddl.find(sql => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`)), captured[name]).matching, name);
        }
        evidence.metadata_sha256 = hash(fs.readFileSync(path.resolve(arg('--metadata'))));
      });
      for (const sql of ddl) await db.query(sql);
      await db.execute("INSERT INTO data_map_objects(id,object_key,object_name_cn) VALUES (9007199254740993,'compat_object','合成旧对象')");
      await db.execute("INSERT INTO data_map_contexts(id,context_key,title) VALUES (11,'compat_context','合成场景')");
      await db.execute("INSERT INTO data_map_fields(id,context_id,field_key,field_name_cn) VALUES (9007199254740994,11,'compat_field','合成旧字段')");
      await db.execute("INSERT INTO data_map_field_system_links(field_id,system_name,relation_type) VALUES (9007199254740994,'合成系统','candidate_authority')");
      await db.execute("INSERT INTO data_map_field_identities(field_id) VALUES (9007199254740994)");
      const sources = { object: await snapshot(db, 'object', '9007199254740993'), field: await snapshot(db, 'field', '9007199254740994') };
      const unchanged = async () => {
        assert.deepEqual(await snapshot(db, 'object', '9007199254740993'), sources.object);
        assert.deepEqual(await snapshot(db, 'field', '9007199254740994'), sources.field);
      };
      const structure = async () => Promise.all(tables.map(async table => (await db.query(`SHOW CREATE TABLE ${table}`))[0][0]['Create Table']));
      const maintenance = mode => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'manage-data-map-legacy-compatibility.js'), mode, '--target', `127.0.0.1:${fixture.port}/${fixture.database}`], {
        env: isolatedEnvironment({ MYSQL_HOST: '127.0.0.1', MYSQL_PORT: String(fixture.port), MYSQL_DATABASE: fixture.database, MYSQL_USER: 'root', MYSQL_PASSWORD: fixture.password }),
        encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe']
      }));
      const backup = fixture.backup();
      evidence.legacy_backup_sha256 = hash(backup);
      const originalStructure = await structure();
      const columnMetadata = async () => (await db.execute('SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,CHARACTER_SET_NAME,COLLATION_NAME,EXTRA FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?,?,?) ORDER BY TABLE_NAME,ORDINAL_POSITION', tables))[0];
      const originalColumns = await columnMetadata();
      await check('inspect and dry-run preserve structures and rows; exact target is mandatory', async () => {
        assert.throws(() => argumentsFor(['--apply', '--target', 'wrong'], {}));
        const before = maintenance('--inspect');
        assert.equal(before.pending.length, 4); assert.deepEqual(before.drift, []);
        assert.deepEqual(maintenance('--dry-run'), before);
        assert.deepEqual(await structure(), originalStructure); await unchanged();
      });
      await check('unknown drift anywhere blocks all ALTER statements', async () => {
        await db.execute('ALTER TABLE data_map_fields ADD COLUMN unexpected_test_value INT NULL');
        const altered = await structure();
        await assert.rejects(apply(db), { code: 'DEFINITION_COMPATIBILITY_SCHEMA_DRIFT' });
        assert.deepEqual(await structure(), altered);
        await db.execute('ALTER TABLE data_map_fields DROP COLUMN unexpected_test_value'); await unchanged();
      });
      await check('unenforced CHECK is rejected before changing any structure', async () => {
        const identityDdl = (await db.query('SHOW CREATE TABLE data_map_field_identities'))[0][0]['Create Table'];
        const name = [...identityDdl.matchAll(/CONSTRAINT `([a-zA-Z0-9_]+)` CHECK \(([^\n]+)\)/g)].find(match => match[2].includes('`status`'))[1];
        await db.execute(`ALTER TABLE data_map_field_identities ALTER CHECK \`${name}\` NOT ENFORCED`);
        const before = await structure();
        await assert.rejects(apply(db), { code: 'DEFINITION_COMPATIBILITY_SCHEMA_DRIFT' });
        assert.deepEqual(await structure(), before);
        await db.execute(`ALTER TABLE data_map_field_identities ALTER CHECK \`${name}\` ENFORCED`);
      });
      await check('busy migration lock refuses work on another connection', async () => {
        await db.execute("SELECT GET_LOCK('mdm_definition_migration_v1',0)");
        const other = await fixture.pool.getConnection();
        try { await assert.rejects(apply(other), { code: 'DEFINITION_COMPATIBILITY_BUSY' }); }
        finally { other.release(); await db.execute("SELECT RELEASE_LOCK('mdm_definition_migration_v1')"); }
      });
      await check('DDL interruption preserves old rows and allows inspected resume', async () => {
        let alters = 0;
        const failing = new Proxy(db, { get(target, key) {
          if (key === 'execute') return async (sql, params) => { if (sql.startsWith('ALTER TABLE') && ++alters === 2) throw new Error('SYNTHETIC_DDL_FAILURE'); return target.execute(sql, params); };
          const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
        } });
        await assert.rejects(apply(failing), /SYNTHETIC_DDL_FAILURE/);
        const partial = await inspect(db);
        assert.equal(partial.pending.length, 3); assert.equal(partial.recorded, false); assert.deepEqual(partial.drift, []);
        assert.equal((await db.execute("SELECT IS_USED_LOCK('mdm_definition_migration_v1') AS owner"))[0][0].owner, null);
        await unchanged();
        assert.equal(maintenance('--apply').ready, true); await unchanged();
      });
      await check('repeat apply is idempotent and creates one marker', async () => {
        const before = await structure(); assert.equal(maintenance('--apply').ready, true);
        assert.deepEqual(await structure(), before); await unchanged();
        assert.equal((await db.execute('SELECT COUNT(*) AS n FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]))[0][0].n, 1);
      });
      await check('known CHECK values accepted; unknown values rejected; new defaults active', async () => {
        await db.execute("INSERT INTO data_map_objects(object_key,object_name_cn) VALUES ('new_default','合成新对象')");
        assert.equal((await db.execute("SELECT object_type FROM data_map_objects WHERE object_key='new_default'"))[0][0].object_type, 'master_data_reviewItem');
        await db.execute("INSERT INTO data_map_fields(id,context_id,field_key) VALUES (31,11,'new_default')");
        assert.equal((await db.execute('SELECT master_data_level FROM data_map_fields WHERE id=31'))[0][0].master_data_level, 'needs_review');
        await db.execute('INSERT INTO data_map_field_identities(field_id) VALUES (31)');
        assert.equal((await db.execute('SELECT status FROM data_map_field_identities WHERE field_id=31'))[0][0].status, 'needs_review');
        await db.execute("INSERT INTO data_map_field_system_links(field_id,system_name,relation_type) VALUES (31,'新合成系统','reviewItem_authority')");
        await assert.rejects(db.execute("UPDATE data_map_field_identities SET status='unknown_compat_value' WHERE field_id=31"), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
        await assert.rejects(db.execute("UPDATE data_map_field_system_links SET relation_type='unknown_compat_value' WHERE field_id=31"), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
        await unchanged();
      });
      await check('recorded schema regression is rejected without silent repair', async () => {
        await db.execute("ALTER TABLE data_map_objects ALTER COLUMN object_type SET DEFAULT 'master_data_candidate'");
        await assert.rejects(apply(db), { code: 'DEFINITION_COMPATIBILITY_SCHEMA_DRIFT' });
        await db.execute("ALTER TABLE data_map_objects ALTER COLUMN object_type SET DEFAULT 'master_data_reviewItem'");
      });
      await check('owned consistent backup restores original old schema and rows', async () => {
        fixture.restore(backup);
        // mysqldump may spell out an implicit charset on restore. Preserve all
        // other DDL bytes and compare actual column metadata including collation.
        const normalizeCharset = sql => sql.replaceAll(' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', ' COLLATE utf8mb4_unicode_ci');
        assert.deepEqual((await structure()).map(normalizeCharset), originalStructure.map(normalizeCharset));
        assert.deepEqual(await columnMetadata(), originalColumns); await unchanged();
        assert.equal((await inspect(db)).pending.length, 4);
        assert.equal((await db.execute("SELECT COUNT(*) AS n FROM data_map_objects WHERE object_key='new_default'"))[0][0].n, 0);
      });
      await check('P02 migration preserves legacy snapshots and unresolved ownership after compatibility', async () => {
        const markerFailure = new Proxy(db, { get(target, key) {
          if (key === 'execute') return async (sql, params) => { if (sql.startsWith('INSERT INTO schema_migrations')) throw new Error('SYNTHETIC_MARKER_FAILURE'); return target.execute(sql, params); };
          const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
        } });
        await assert.rejects(apply(markerFailure), /SYNTHETIC_MARKER_FAILURE/);
        const unrecorded = await inspect(db);
        assert.equal(unrecorded.schema_compatible, true); assert.equal(unrecorded.recorded, false); await unchanged();
        assert.equal((await apply(db)).ready, true);
        const result = await applyDefinitions(db); assert.equal(result.ready, true);
        assert.equal(result.unresolved.length, 2); await unchanged();
        const [versions] = await db.execute('SELECT entity_type,CAST(entity_id AS CHAR) AS entity_id,base_snapshot_json,base_digest FROM data_map_definition_versions ORDER BY version_id');
        assert.equal(versions.length, 2);
        for (const version of versions) {
          const stored = typeof version.base_snapshot_json === 'string' ? JSON.parse(version.base_snapshot_json) : version.base_snapshot_json;
          assert.deepEqual(stored, sources[version.entity_type]);
          assert.equal(version.base_digest, digest(sources[version.entity_type]));
        }
        await applyDefinitions(db);
        assert.equal((await db.execute('SELECT COUNT(*) AS n FROM data_map_definition_versions'))[0][0].n, 2);
      });
      evidence.final_inspect = await inspect(db);
      evidence.target = { host: '127.0.0.1', port: fixture.port, database: fixture.database, container_id: fixture.containerId, storage: 'owned tmpfs' };
      await check('previous current defaults with narrow CHECKs upgrade without legacy conversion', async () => {
        await db.query('CREATE DATABASE stage25_previous_current');
        // Reset prepared statements as well as the default database; USE alone
        // can keep previously prepared unqualified queries bound to the old DB.
        await db.changeUser({ database: 'stage25_previous_current' });
        for (const sql of splitSqlStatements(mdmMysqlSchemaSql())) {
          const previous = sql.replace("'candidate_authority','reviewItem_authority'", "'reviewItem_authority'").replace("'candidate','needs_review','confirmed','rejected','archived'", "'needs_review','confirmed','rejected','archived'");
          await db.query(previous);
        }
        assert.equal((await inspect(db)).pending.length, 2);
        assert.equal((await apply(db)).ready, true);
      });
    } finally { db.release(); }
  }, { stage: '25' });
  evidence.passed = true; evidence.owned_container_removed = true;
  if (output) fs.writeFileSync(output, JSON.stringify(evidence, null, 2), { flag: 'wx' });
  console.log('P25_COMPATIBILITY_PASS ' + checks.length);
}
main().catch(error => {
  if (output) fs.writeFileSync(output + '.failure.json', JSON.stringify({ passed: false, checks, code: error.code, message: error.message, stack: error.stack }, null, 2), { flag: 'wx' });
  console.error(error.code || error.message);
  console.error(error.stack?.split('\n').filter(line => line.includes(__filename)).join('\n'));
  process.exitCode = 1;
});
