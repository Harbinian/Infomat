const { assertRuntimeConfig, legacyTestMode } = require('./runtimeBoundary');
const { sessionConfig, integer } = require('./sessionConfig');
const { runtimeSchemaProbes } = require('./mysqlRuntimeSchema');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const { withMysqlDeadline, lazyMysqlPool } = require('./boundedMysql');
const { inspectSessionSchema } = require('./sessionMigration');

function probesFromSql(sql) {
  return splitSqlStatements(sql).filter(s => /^CREATE TABLE/i.test(s.trim())).map(statement => {
    const table = statement.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i)[1];
    const columns = [...statement.matchAll(/^\s{2}([a-z_][a-z0-9_]*)\s+(?:BIGINT|INT|VARCHAR|TEXT|LONGTEXT|JSON|TIMESTAMP|DATETIME|DATE|ENUM|BOOLEAN|TINYINT|DECIMAL|CHAR|DOUBLE|FLOAT|MEDIUMTEXT)\b/gim)].map(m => m[1]);
    if (!columns.length) throw new Error('READINESS_SCHEMA_SOURCE_INVALID');
    return { table, sql: `SELECT ${columns.map(c => `\`${c}\``).join(', ')} FROM \`${table}\` LIMIT 0` };
  });
}

function requiredProbes(env) {
  const domains = ['identity', 'processGovernance', 'inputBaseline', 'issuePool', 'guidance', 'dataMap', 'mapping', 'conflict', 'todo', 'terminology', 'audit'];
  const probes = domains.flatMap(runtimeSchemaProbes);
  probes.push(...probesFromSql(mdmMysqlSchemaSql()).filter(p => p.table.startsWith('process_design_') && !p.table.includes('migration_backups')).map(p => p.sql));
  if (env.PROCESS_V7_PREVIEW_ENABLED === '1' || env.PROCESS_V7_FORMAL_ENABLED === '1') {
    probes.push(...probesFromSql(require('./processV7PreviewReviewMigration').PROCESS_V7_PREVIEW_SCHEMA_SQL).map(p => p.sql));
  }
  if (env.PROCESS_V7_FORMAL_ENABLED === '1') {
    probes.push(...probesFromSql(require('./processV7FormalMigration').PROCESS_V7_FORMAL_SCHEMA_SQL).map(p => p.sql));
    probes.push('SELECT process_ref FROM process_design_documents LIMIT 0', 'SELECT draft_revision_no, content_hash FROM process_design_review_tasks LIMIT 0');
  }
  if (env.PROCESS_DATA_GOVERNANCE_ENABLED === '1') {
    probes.push(...probesFromSql(require('./processDataGovernanceMigration').PROCESS_DATA_GOVERNANCE_SCHEMA_SQL).map(p => p.sql));
  }
  return [...new Set(probes)];
}

function createReadiness({ env = process.env, version, pool, now = Date.now } = {}) {
  const timeout = integer(env, 'MDM_READY_TIMEOUT_MS', 2000, 100, 10000);
  const cacheMs = integer(env, 'MDM_READY_CACHE_MS', 3000, 1000, 30000);
  const database = pool || lazyMysqlPool(env, 1, timeout);
  let cached;
  let nextCheck = 0;
  let inFlight;
  let stopping = false;
  const body = (ready, reason) => ({ status: ready ? 'ready' : 'not_ready', ready, reason,
    identityModel: 'person', readModels: { identity: env.MDM_IDENTITY_READ_MODEL === 'mysql' ? 'mysql' : 'invalid', processGovernance: env.PROCESS_GOVERNANCE_READ_MODEL === 'mysql' ? 'mysql' : 'invalid' },
    version, checkedAt: new Date(now()).toISOString() });
  async function check() {
    if (stopping) return body(false, 'STOPPING');
    try {
      assertRuntimeConfig(env);
      sessionConfig(env);
      if (env.PROCESS_V7_PREVIEW_ENABLED === '1' || env.PROCESS_V7_FORMAL_ENABLED === '1') require('./processV7TrialScope').assertV7TrialScopeConfigured({ env });
      if (env.PROCESS_DATA_GOVERNANCE_ENABLED === '1') require('./processDataGovernanceScope').assertProcessVersionScopeConfigured(env);
      if (legacyTestMode(env) || env.MDM_SESSION_STORE === 'memory') return body(false, 'ISOLATED_TEST_MODE');
    } catch (_) { return body(false, 'CONFIG_INVALID'); }
    if (cached && now() < nextCheck) return cached;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await withMysqlDeadline(database, async connection => {
          await connection.execute('SELECT 1');
          for (const sql of requiredProbes(env)) await connection.execute(sql);
          const sessions = await inspectSessionSchema(connection);
          if (sessions.state !== 'applied') throw new Error('SESSION_SCHEMA_UNAVAILABLE');
          for (const [enabled, modulePath] of [
            [env.PROCESS_V7_PREVIEW_ENABLED === '1' || env.PROCESS_V7_FORMAL_ENABLED === '1', './processV7PreviewReviewMigration'],
            [env.PROCESS_V7_FORMAL_ENABLED === '1', './processV7FormalMigration'],
            [env.PROCESS_DATA_GOVERNANCE_ENABLED === '1', './processDataGovernanceMigration']
          ]) if (enabled) {
            const [rows] = await connection.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [require(modulePath).MIGRATION_KEY]);
            if (!rows.length) throw new Error('FEATURE_SCHEMA_UNAVAILABLE');
          }
        }, timeout);
        cached = body(true, null);
      } catch (_) { cached = body(false, 'MYSQL_OR_SCHEMA_UNAVAILABLE'); }
      nextCheck = now() + (cached.ready ? cacheMs : Math.min(cacheMs, 1000));
      return cached;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  return { check, stop() { stopping = true; }, close: () => database.end() };
}

module.exports = { createReadiness, requiredProbes };
