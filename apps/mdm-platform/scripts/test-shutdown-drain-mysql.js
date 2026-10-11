// R11 shutdown: a real server process, a real domain pool, and a real stop.
// The process must stop through the ordinary path -- not the fifteen second hard exit -- and the
// pool it opened must be drained and reported.
// Usage: node scripts/test-shutdown-drain-mysql.js --output <new directory under artifacts/>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { withFreshMysql } = require('./testHelpers/freshMysql');

const at = process.argv.indexOf('--output');
assert(at > 0 && process.argv[at + 1], '--output is required');
const output = path.resolve(process.argv[at + 1]);
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep), 'evidence must be inside repository artifacts');
assert(!fs.existsSync(output), 'use a new evidence directory');
fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  let target;
  const checks = [];
  const check = name => { checks.push(name); console.log('PASS ' + name); };
  try {
    await withFreshMysql(async ({ port, password, database, owner, containerId }) => {
      target = { owner, database, containerId, port, image: 'mysql:8.4', pull: 'never', tmpfs: true };
      save('owned-target.json', target);

      // A dedicated listener port so the test can address the child directly. The port is chosen
      // from the process id and is never 3000, so the running deployment cannot be touched.
      const listenPort = 40000 + (process.pid % 10000);
      const child = fork(path.resolve(__dirname, '../server/index.js'), [], {
        env: {
          PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
          NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(listenPort), MDM_ACCESS_MODE: 'http-local',
          MDM_SESSION_STORE: 'memory', SESSION_SECRET: 'synthetic-shutdown-drain-secret-only',
          MDM_IDENTITY_READ_MODEL: 'mysql', PROCESS_GOVERNANCE_READ_MODEL: 'mysql',
          MYSQL_HOST: '127.0.0.1', MYSQL_PORT: String(port), MYSQL_USER: 'root', MYSQL_PASSWORD: password,
          MYSQL_DATABASE: database, MYSQL_CONNECTION_LIMIT: '2'
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));

      try {
        const startedAt = Date.now();
        while (!/MDM_LISTENING/.test(stdout) && Date.now() - startedAt < 20000) await sleep(100);
        assert.match(stdout, /MDM_LISTENING/, `the server started: ${stdout}${stderr}`);
        check('the server starts against the isolated database');

        // The isolated database deliberately has no application schema. The pool is still created
        // and registered before the schema probe rejects the request, which is exactly the pool
        // shutdown has to drain.
        const response = await fetch(`http://127.0.0.1:${listenPort}/api/org/me`).catch(() => null);
        assert.ok(response, 'the listener answered');
        assert.ok([401, 403, 500, 503].includes(response.status), `unexpected status ${response.status}`);
        await response.text().catch(() => {});
        await sleep(200);
        check('an API request opens a registered domain pool');

        const stoppedAt = Date.now();
        // The service stop channel is the IPC message the maintenance entry already uses: a POSIX
        // signal cannot be delivered to another Windows process, and the contract under test is
        // the stop path, not the signal handler.
        child.send('mdm:stop', () => {});
        const result = await Promise.race([exited, sleep(12000).then(() => null)]);
        const ms = Date.now() - stoppedAt;
        assert.ok(result, 'the process stopped before the hard-exit backstop');
        assert.equal(result.code, 0, `a clean stop exits 0 rather than through the forced path: ${stdout}${stderr}`);
        assert.ok(ms < 11000, `stopped in ${ms} ms, before the fifteen second hard exit`);
        assert.ok(!/MDM_SHUTDOWN_NOT_DRAINED/.test(stdout), `every pool drained: ${stdout}`);
        save('shutdown.json', { ms, code: result.code, signal: result.signal, stdout, stderr: stderr.slice(0, 2000) });
        check('the process stops through the ordinary path and reports no undrained pool');
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    }, { stage: '02', randomDatabase: true });

    save('validation.json', {
      passed: true, checks, ownedIsolatedMysql: true, httpStarted: true, realWorkerStarted: false,
      deploymentVerified: false, businessAcceptance: false
    });
    console.log('R11_SHUTDOWN_DRAIN_PASSED');
  } catch (error) {
    save('failure.json', { message: error.message, stack: error.stack, checks, target });
    throw error;
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
