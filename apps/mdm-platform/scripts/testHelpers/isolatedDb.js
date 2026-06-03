const fs = require('fs');
const os = require('os');
const path = require('path');

const testName = path.basename(process.argv[1] || 'mdm-test', '.js').replace(/[^a-zA-Z0-9_-]/g, '-');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${testName}-`));
const testDbPath = path.join(tempDir, 'platform-test.db');

process.env.MDM_DB_PATH = testDbPath;

function cleanupDb() {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

module.exports = { testDbPath, cleanupDb };
