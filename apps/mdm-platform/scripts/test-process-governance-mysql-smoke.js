const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  mysqlSmokeReadiness,
  runProcessGovernanceMysqlSmoke
} = require('./lib/processGovernanceMysqlSmoke');

async function main() {
  const skipped = mysqlSmokeReadiness({});
  assert.strictEqual(skipped.ready, false);
  assert.deepStrictEqual(skipped.missing, ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE']);

  const disabled = mysqlSmokeReadiness({
    MDM_MYSQL_SMOKE: '0',
    MYSQL_HOST: 'mysql.internal',
    MYSQL_USER: 'mdm_user',
    MYSQL_DATABASE: 'mdm_test'
  });
  assert.strictEqual(disabled.ready, false);
  assert.strictEqual(disabled.reason, 'disabled');

  const ready = mysqlSmokeReadiness({
    MYSQL_HOST: 'mysql.internal',
    MYSQL_USER: 'mdm_user',
    MYSQL_DATABASE: 'mdm_test'
  });
  assert.strictEqual(ready.ready, true);

  const skipResult = await runProcessGovernanceMysqlSmoke({ env: {}, log: () => {} });
  assert.strictEqual(skipResult.skipped, true);
  assert.ok(skipResult.reason.includes('MYSQL_HOST'));

  let ended = false;
  const fakePool = {
    async end() {
      ended = true;
    }
  };
  const fakeRepository = {
    importedBundle: null,
    async initSchema() {},
    async replaceActiveReadModel(bundle) {
      this.importedBundle = bundle;
      return { snapshot_id: 77 };
    },
    async getActiveSankey() {
      return {
        nodes: [{ name: '经营发展部', node_type: 'department' }],
        links: [{ source: '经营发展部', target: 'ERP', value: 1 }],
        systems: ['ERP'],
        stats: { mappings: 1, a1: 0 },
        crossDept: { stats: {}, risks: [], interactionChains: [], source: null }
      };
    }
  };

  const runResult = await runProcessGovernanceMysqlSmoke({
    env: {
      MYSQL_HOST: 'mysql.internal',
      MYSQL_PORT: '3307',
      MYSQL_USER: 'mdm_user',
      MYSQL_PASSWORD: 'secret',
      MYSQL_DATABASE: 'mdm_test'
    },
    createPool(config) {
      assert.strictEqual(config.host, 'mysql.internal');
      assert.strictEqual(config.port, 3307);
      assert.strictEqual(config.user, 'mdm_user');
      assert.strictEqual(config.password, 'secret');
      assert.strictEqual(config.database, 'mdm_test');
      return fakePool;
    },
    createRepository(pool) {
      assert.strictEqual(pool, fakePool);
      return fakeRepository;
    },
    sourceJsonPath: path.join(__dirname, 'fixtures', 'process-governance-snapshot.json'),
    log: () => {}
  });

  assert.strictEqual(runResult.skipped, false);
  assert.strictEqual(runResult.snapshot_id, 77);
  assert.strictEqual(runResult.nodes, 1);
  assert.strictEqual(runResult.links, 1);
  assert.strictEqual(runResult.systems, 1);
  assert.strictEqual(fakeRepository.importedBundle.stats.mappings, 1);
  assert.strictEqual(ended, true);

  const cliSource = fs.readFileSync(path.join(__dirname, 'smoke-process-governance-mysql.js'), 'utf8');
  assert.ok(cliSource.includes('runProcessGovernanceMysqlSmoke'), 'smoke CLI should use shared smoke runner');
  assert.ok(!cliSource.includes("require('../server/db')"), 'smoke CLI must not load SQLite db');
  assert.ok(!cliSource.includes('MDM_DB_PATH'), 'smoke CLI must not use MDM_DB_PATH');

  console.log('Process governance MySQL smoke test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
