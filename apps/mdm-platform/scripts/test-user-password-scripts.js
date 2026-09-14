// Retired account entry points must exit before loading data access or reading a roster.
// Only writes an owned temporary fixture; never loads server/db or contacts MySQL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { testDbPath, cleanupDb } = require('./testHelpers/isolatedDb');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');

const root = path.resolve(__dirname, '..');
const temp = path.dirname(testDbPath);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const guard = path.join(temp, 'retired-guard.cjs');
fs.writeFileSync(guard, `const M=require('module'),load=M._load;
M._load=function(name,...args){if(/mysql|sqlite|exceljs|(?:^|\\/)db$/.test(name))throw Error('RETIRED_SCRIPT_LOADED_DATA_ACCESS');return load.call(this,name,...args)};`);

try {
  const Database = require('better-sqlite3');
  const fixture = new Database(testDbPath);
  fixture.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (1, 'synthetic-preserved-account')");
  fixture.close();
  const before = hash(testDbPath);
  for (const script of ['setup-mdm-project-users.js', 'import-mdm-users.js']) {
    for (const target of [testDbPath, path.join(temp, 'must-not-create.db')]) {
      const result = spawnSync(process.execPath, ['--require', guard, path.join(__dirname, script)], {
        cwd: root, env: isolatedEnvironment({ MDM_DB_PATH: target, MDM_ALLOW_LEGACY_TEST_MODE: '1',
          ALLOW_PROJECT_USER_SETUP: 'true', MDM_USERS_EXCEL_PATH: path.join(temp, 'missing-roster.xlsx') }),
        encoding: 'utf8', timeout: 10000, windowsHide: true
      });
      assert.equal(result.status, 1, script);
      assert.match(result.stderr, /LEGACY_ACCOUNT_SCRIPT_RETIRED/);
      assert.doesNotMatch(result.stderr, /RETIRED_SCRIPT_LOADED_DATA_ACCESS/);
      assert.equal(result.stdout, '', 'must not emit credentials or successful account output');
      assert.equal(hash(testDbPath), before, 'existing isolated database must remain byte-identical');
      assert.equal(fs.existsSync(path.join(temp, 'must-not-create.db')), false);
      assert.deepEqual(fs.readdirSync(temp).sort(), ['platform-test.db', 'retired-guard.cjs']);
    }
  }
  console.log('Retired account scripts: 4 refusal/no-write cases passed');
} finally { cleanupDb(); }
