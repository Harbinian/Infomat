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

function stopServer(child, timeoutMs = 2000) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    let settled = false;
    let forceTimer;
    let fallbackTimer;

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(fallbackTimer);
      child.off('exit', finish);
      child.off('close', finish);
      resolve();
    }

    child.once('exit', finish);
    child.once('close', finish);
    child.kill();

    forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      fallbackTimer = setTimeout(finish, timeoutMs);
    }, timeoutMs);
  });
}

module.exports = { testDbPath, cleanupDb, stopServer };
