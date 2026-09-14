// Windows-only 3000 lifecycle manager. No migration, secret-file loading,
// Docker, account or other service operations. Private values are inherited.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, fork, execFileSync } = require('node:child_process');
const { sessionConfig } = require('../server/sessionConfig');
const { assertRuntimeConfig } = require('../server/runtimeBoundary');
const { runtimeVersion } = require('../server/runtimeVersion');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '../..');

function pathsFor(root = appRoot, runtimeDir = path.join(repoRoot, 'artifacts/mdm-3000-runtime')) {
  return { appRoot: root, runtimeDir, entry: path.join(root, 'server/index.js'),
    supervisorEntry: path.join(root, 'scripts/mdm-service.js'), state: path.join(runtimeDir, 'state.json'),
    stop: path.join(runtimeDir, 'stop.request'), lock: path.join(runtimeDir, 'operation.lock') };
}

function fixedEnvironment(env = process.env) {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/infomat-services.config.json'), 'utf8'));
  if (config.mdm.port !== 3000) throw new Error('MDM_FIXED_PORT_MISMATCH');
  return { ...env, NODE_ENV: env.NODE_ENV || 'production', HOST: config.mdm.host, PORT: String(config.mdm.port),
    MYSQL_HOST: config.mysql.host, MYSQL_PORT: String(config.mysql.port), MYSQL_USER: config.mysql.user,
    MYSQL_DATABASE: config.mysql.database, MYSQL_CONNECTION_LIMIT: String(config.mysql.connectionLimit),
    MDM_IDENTITY_READ_MODEL: config.readModels.identity, PROCESS_GOVERNANCE_READ_MODEL: config.readModels.processGovernance };
}

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000
  }).trim();
}
function quote(value) { return `'${String(value).replace(/'/g, "''")}'`; }

// Return only identity facts, never raw command lines (which can contain secrets).
function processIdentity(pid, entry, supervisor = false) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  const commands = [process.execPath, `"${process.execPath}"`].flatMap(exe => [entry, `"${entry}"`].map(file => `${exe} ${file}${supervisor ? ' --supervise' : ''}`));
  const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { [pscustomobject]@{ pid=[int]$p.ProcessId; created=$p.CreationDate.ToUniversalTime().ToString('o'); matches=($p.ExecutablePath -eq ${quote(process.execPath)} -and @(${commands.map(quote).join(',')}) -contains $p.CommandLine) } | ConvertTo-Json -Compress }`;
  const result = ps(script);
  return result ? JSON.parse(result) : null;
}

function listeners(port) {
  const result = ps(`$items=@(Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); ConvertTo-Json -InputObject $items -Compress`);
  return result ? JSON.parse(result) : [];
}

function readState(paths) { return fs.existsSync(paths.state) ? JSON.parse(fs.readFileSync(paths.state, 'utf8')) : null; }
function writeState(paths, value) {
  const temp = `${paths.state}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, paths.state);
}
function verifyOwner(paths, state, inspect = processIdentity) {
  if (!state || state.appRoot !== paths.appRoot || state.entry !== paths.entry) throw new Error('MDM_OWNER_UNKNOWN');
  const owner = inspect(state.supervisor.pid, paths.supervisorEntry, true);
  if (!owner || !owner.matches || owner.created !== state.supervisor.created) throw new Error('MDM_OWNER_MISMATCH');
  if (state.child) {
    const child = inspect(state.child.pid, paths.entry, false);
    if (child && (!child.matches || child.created !== state.child.created)) throw new Error('MDM_CHILD_OWNER_MISMATCH');
  }
  return owner;
}

function eventLog(paths, event, fields = {}) {
  const log = path.join(paths.runtimeDir, 'service.log');
  if (fs.existsSync(log) && fs.statSync(log).size >= 1024 * 1024) {
    for (let i = 3; i >= 1; i--) {
      const source = i === 1 ? log : `${log}.${i - 1}`;
      const target = `${log}.${i}`;
      if (fs.existsSync(target)) fs.unlinkSync(target);
      if (fs.existsSync(source)) fs.renameSync(source, target);
    }
  }
  fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), event, ...fields }) + '\n');
}

async function supervise(paths = pathsFor(), env = fixedEnvironment(), adapters = {}) {
  const inspect = adapters.inspect || processIdentity;
  const getListeners = adapters.listeners || listeners;
  assertRuntimeConfig(env);
  sessionConfig(env);
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  const supervisor = inspect(process.pid, paths.supervisorEntry, true);
  if (!supervisor || !supervisor.matches) throw new Error('MDM_SUPERVISOR_IDENTITY_INVALID');
  const previous = readState(paths);
  if (previous && inspect(previous.supervisor.pid, paths.supervisorEntry, true)) throw new Error('MDM_SUPERVISOR_ALREADY_RUNNING');
  if (previous && previous.child && inspect(previous.child.pid, paths.entry, false)) throw new Error('MDM_ORPHAN_CHILD');
  const ownerLock = path.join(paths.runtimeDir, 'supervisor.lock');
  if (fs.existsSync(ownerLock)) {
    const oldOwner = JSON.parse(fs.readFileSync(ownerLock, 'utf8'));
    if (oldOwner.entry !== paths.supervisorEntry || inspect(oldOwner.pid, paths.supervisorEntry, true)) throw new Error('MDM_SUPERVISOR_LOCKED');
    fs.unlinkSync(ownerLock);
  }
  const ownerFd = fs.openSync(ownerLock, 'wx');
  fs.writeFileSync(ownerFd, JSON.stringify({ ...supervisor, entry: paths.supervisorEntry }));
  let ownerReleased = false;
  function releaseOwner() {
    if (ownerReleased) return;
    ownerReleased = true;
    fs.closeSync(ownerFd); fs.unlinkSync(ownerLock);
  }
  const state = { appRoot: paths.appRoot, entry: paths.entry, supervisor, child: null, status: 'starting', restarts: 0 };
  let child;
  let stopping = false;
  let stopTimer;
  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(poll);
    clearTimeout(stopTimer);
    state.status = 'stopped'; state.child = null;
    writeState(paths, state);
    eventLog(paths, 'stopped');
    releaseOwner();
    if (fs.existsSync(paths.stop)) fs.unlinkSync(paths.stop);
  };
  function stop() {
    if (stopping) return;
    stopping = true;
    state.status = 'stopping'; writeState(paths, state);
    if (!child || child.exitCode !== null || !child.connected) return finish();
    child.send('mdm:stop', () => {});
    stopTimer = setTimeout(() => { eventLog(paths, 'drain_timeout'); child.kill(); }, 17000);
  }
  const poll = setInterval(() => { if (fs.existsSync(paths.stop)) stop(); }, 300);
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  async function launch() {
    if (stopping || stopped) return finish();
    if (getListeners(env.PORT).length) { state.status = 'port_conflict'; writeState(paths, state); eventLog(paths, 'port_conflict'); process.exitCode = 1; return finish(); }
    child = fork(paths.entry, [], { cwd: paths.appRoot, env, execArgv: [], windowsHide: true, silent: true });
    // Deliberately discard arbitrary application output. The managed log records
    // lifecycle events only; SQL, request content and credentials cannot enter it.
    child.stdout.resume(); child.stderr.resume();
    child.on('error', () => eventLog(paths, 'child_start_error'));
    child.on('exit', async (code, signal) => {
      eventLog(paths, 'child_exit', { code, signal }); state.child = null;
      if (stopping) return finish();
      state.restarts += 1;
      if (state.restarts > 3) { state.status = 'failed'; writeState(paths, state); clearInterval(poll); releaseOwner(); process.exitCode = 1; return; }
      state.status = 'recovering'; writeState(paths, state);
      await sleep(Math.min(5000, 1000 * state.restarts));
      await launch();
    });
    const childIdentity = inspect(child.pid, paths.entry, false);
    if (!childIdentity || !childIdentity.matches) { stop(); throw new Error('MDM_CHILD_IDENTITY_INVALID'); }
    state.child = childIdentity; state.status = 'running'; writeState(paths, state);
    eventLog(paths, 'child_started', { pid: child.pid });
  }
  writeState(paths, state);
  await launch();
}

async function check(paths = pathsFor(), env = fixedEnvironment(), adapters = {}) {
  const state = readState(paths);
  verifyOwner(paths, state, adapters.inspect || processIdentity);
  const owners = (adapters.listeners || listeners)(env.PORT);
  if (!state.child || owners.length !== 1 || owners[0] !== state.child.pid) throw new Error('MDM_LISTENER_OWNER_MISMATCH');
  const base = `http://${env.HOST.includes(':') ? `[${env.HOST}]` : env.HOST}:${env.PORT}`;
  const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
  const live = await health.json();
  const ready = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(12000) });
  const body = await ready.json();
  const current = runtimeVersion(paths.appRoot);
  if (!health.ok || live.status !== 'ok' || !ready.ok || !body.ready) throw new Error('MDM_NOT_READY');
  if (live.version.sourceDigest !== current.sourceDigest || body.version.sourceDigest !== current.sourceDigest) throw new Error('MDM_RUNNING_SOURCE_MISMATCH');
  const origin = env.MDM_ACCESS_MODE === 'https-proxy' ? env.MDM_PUBLIC_ORIGIN : base;
  const page = await fetch(origin, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!page.ok || !(await page.text()).includes('MDM')) throw new Error('MDM_CONTENT_UNAVAILABLE');
  return { status: 'ready', pid: state.child.pid, version: body.version };
}

async function stopService(paths, adapters = {}) {
  const inspect = adapters.inspect || processIdentity;
  const state = readState(paths);
  if (state && state.appRoot === paths.appRoot && state.status === 'stopped' && !inspect(state.supervisor.pid, paths.supervisorEntry, true) && !state.child) return { status: 'stopped' };
  verifyOwner(paths, state, inspect);
  fs.writeFileSync(paths.stop, 'stop\n');
  const deadline = Date.now() + 22000;
  while (Date.now() < deadline) {
    const current = readState(paths);
    if (current.status === 'stopped' && !inspect(state.child && state.child.pid, paths.entry, false)) return { status: 'stopped' };
    await sleep(250);
  }
  throw new Error('MDM_STOP_TIMEOUT: inspect ownership; no port-based kill');
}

async function startService(paths, env, adapters = {}) {
  assertRuntimeConfig(env); sessionConfig(env);
  const inspect = adapters.inspect || processIdentity;
  const state = readState(paths);
  if (state && inspect(state.supervisor.pid, paths.supervisorEntry, true)) { verifyOwner(paths, state, inspect); return check(paths, env, adapters); }
  if (state && state.child && inspect(state.child.pid, paths.entry, false)) throw new Error('MDM_ORPHAN_CHILD: manual ownership review required');
  if ((adapters.listeners || listeners)(env.PORT).length) throw new Error('MDM_PORT_IN_USE: no process was stopped');
  if (fs.existsSync(paths.stop)) fs.unlinkSync(paths.stop);
  const owner = spawn(process.execPath, [paths.supervisorEntry, '--supervise'], { cwd: paths.appRoot, env, detached: true, windowsHide: true, stdio: 'ignore' });
  owner.unref();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await sleep(500);
    try { return await check(paths, env, adapters); } catch (_) { /* Keep bounded startup wait; never report listener-only success. */ }
  }
  throw new Error('MDM_START_NOT_READY: inspect state and check; do not run migrations automatically');
}

async function main(action = process.argv[2]) {
  if (process.platform !== 'win32') throw new Error('MDM_SERVICE_REQUIRES_WINDOWS');
  if (!['start', 'stop', 'restart', 'check', '--supervise'].includes(action) || process.argv.length > 3) throw new Error('MDM_SERVICE_ACTION_INVALID');
  const paths = pathsFor();
  const env = fixedEnvironment();
  if (action === 'start' || action === 'restart') { assertRuntimeConfig(env); sessionConfig(env); }
  if (action === '--supervise') return supervise(paths, env);
  if (action === 'check') return console.log(JSON.stringify(await check(paths, env)));
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  let lock;
  try {
    lock = fs.openSync(paths.lock, 'wx');
    if (action === 'stop' || action === 'restart') await stopService(paths);
    const result = action === 'stop' ? { status: 'stopped' } : await startService(paths, env);
    console.log(JSON.stringify(result));
  } finally { if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(paths.lock); } }
}

if (require.main === module) main().catch(error => {
  const code = String(error.message || '').split(':')[0];
  console.error(/^[A-Z_]+$/.test(code) ? code : 'MDM_SERVICE_FAILED');
  process.exitCode = 1;
});
module.exports = { pathsFor, fixedEnvironment, processIdentity, listeners, verifyOwner, eventLog, supervise, check, stopService, startService };
