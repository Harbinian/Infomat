const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-db-path-'));
const tempDb = path.join(tempDir, 'nested', 'isolated-platform.db');

try {
  const child = spawnSync(process.execPath, ['-e', `
    const path = require('path');
    const db = require('./server/db');
    const actualDbPath = path.resolve(db.__dbPath);
    const expectedDbPath = path.resolve(process.env.EXPECTED_MDM_DB_PATH);
    const descriptor = Object.getOwnPropertyDescriptor(db, '__dbPath');

    if (actualDbPath !== expectedDbPath) {
      console.error(JSON.stringify({ expectedDbPath, actualDbPath }));
      process.exit(1);
    }

    if (!descriptor || descriptor.enumerable || descriptor.writable) {
      console.error(JSON.stringify({ descriptor }));
      process.exit(1);
    }

    db.prepare('CREATE TABLE IF NOT EXISTS isolation_probe (id INTEGER PRIMARY KEY)').run();
    db.prepare('INSERT INTO isolation_probe DEFAULT VALUES').run();
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM isolation_probe').get();
    console.log(JSON.stringify({ dbPath: db.__dbPath, count: row.cnt }));
  `], {
    cwd: root,
    env: {
      ...process.env,
      MDM_DB_PATH: tempDb,
      MDM_DB_QUIET: '1',
      EXPECTED_MDM_DB_PATH: tempDb
    },
    encoding: 'utf8'
  });

  assert.strictEqual(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout.trim());
  assert.strictEqual(path.resolve(payload.dbPath), path.resolve(tempDb));
  assert.strictEqual(payload.count, 1);
  assert.ok(fs.existsSync(tempDb), 'isolated db file should be created');

  console.log('DB path isolation test passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
