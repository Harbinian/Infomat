const assert = require('assert');
const path = require('path');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../../server/mysqlConfig');
const { makeProcessGovernanceMysqlRepository } = require('../../server/processGovernanceMysqlRepository');
const { importProcessGovernanceMysqlSnapshot } = require('./processGovernanceMysqlImport');

const REQUIRED_MYSQL_SMOKE_ENV = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE'];
const APP_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');

function mysqlSmokeReadiness(env = process.env) {
  if (String(env.MDM_MYSQL_SMOKE || '').trim() === '0') {
    return { ready: false, reason: 'disabled', missing: [] };
  }
  const missing = REQUIRED_MYSQL_SMOKE_ENV.filter(key => !String(env[key] || '').trim());
  if (missing.length) {
    return {
      ready: false,
      reason: `missing ${missing.join(', ')}`,
      missing
    };
  }
  return { ready: true, reason: '', missing: [] };
}

function assertSankeyPayload(sankey) {
  assert.ok(sankey && Array.isArray(sankey.nodes), 'Sankey payload should include nodes');
  assert.ok(Array.isArray(sankey.links), 'Sankey payload should include links');
  assert.ok(Array.isArray(sankey.systems), 'Sankey payload should include systems');
  assert.ok(sankey.nodes.length > 0, 'Sankey payload should contain nodes');
  assert.ok(sankey.links.length > 0, 'Sankey payload should contain links');
}

async function runProcessGovernanceMysqlSmoke({
  env = process.env,
  createPool = mysql.createPool,
  createRepository = makeProcessGovernanceMysqlRepository,
  sourceJsonPath = path.join(REPO_ROOT, 'docs', 'company-sankey-data.json'),
  log = console.log
} = {}) {
  const readiness = mysqlSmokeReadiness(env);
  if (!readiness.ready) {
    const result = { skipped: true, reason: readiness.reason, missing: readiness.missing };
    log(`process_governance_mysql_smoke_skipped=${readiness.reason}`);
    return result;
  }

  const config = mysqlConfigFromEnv(env);
  const pool = createPool(config);
  try {
    const repository = createRepository(pool);
    const importResult = await importProcessGovernanceMysqlSnapshot({
      repository,
      sourceJsonPath,
      note: 'Process governance MySQL smoke import'
    });
    const sankey = await repository.getActiveSankey();
    assertSankeyPayload(sankey);
    const result = {
      skipped: false,
      snapshot_id: importResult.snapshot_id,
      nodes: sankey.nodes.length,
      links: sankey.links.length,
      systems: sankey.systems.length,
      mysql: redactMysqlConfig(config)
    };
    log(`process_governance_mysql_smoke_passed=${JSON.stringify(result)}`);
    return result;
  } finally {
    if (pool && typeof pool.end === 'function') {
      await pool.end();
    }
  }
}

module.exports = {
  mysqlSmokeReadiness,
  runProcessGovernanceMysqlSmoke
};
