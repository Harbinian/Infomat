// Real Windows process tests on random loopback ports and a temporary fixture
// application. No real MySQL, fixed service ports, private config or accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const manager = require('./mdm-service');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  assert.equal(process.platform, 'win32');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-service-test-'));
  const runtime = path.join(root, 'runtime');
  for (const dir of ['server', 'scripts', 'public', 'runtime']) fs.mkdirSync(path.join(root, dir));
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"isolated-test"}');
  fs.writeFileSync(path.join(root, 'public/index.html'), '<html>MDM isolated test</html>');
  const versionModule = require.resolve('../server/runtimeVersion');
  const fixture = `const http=require('http');const version=require(${JSON.stringify(versionModule)}).runtimeVersion(${JSON.stringify(root)});const app=http.createServer((req,res)=>{if(req.url==='/_test/crash'){res.end('crash');setTimeout(()=>process.exit(17),20);return;}if(req.url==='/'){res.end('<html>MDM isolated test</html>');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/ready'?{ready:true,status:'ready',version}:{status:'ok',version}));});app.listen(Number(process.env.PORT),'127.0.0.1');process.on('message',m=>{if(m==='mdm:stop')app.close(()=>process.exit(0));});`;
  fs.writeFileSync(path.join(root, 'server/index.js'), fixture);
  const paths = manager.pathsFor(root, runtime);
  const reserve = http.createServer((req, res) => res.end('other service untouched'));
  reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port;
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(key))),
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), MDM_ACCESS_MODE: 'http-local', SESSION_SECRET: 'synthetic-test-only-service-secret',
    MDM_IDENTITY_READ_MODEL: 'mysql', PROCESS_GOVERNANCE_READ_MODEL: 'mysql', MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', MYSQL_USER: 'synthetic', MYSQL_PASSWORD: 'synthetic', MYSQL_DATABASE: 'unused' };
  fs.writeFileSync(paths.supervisorEntry, `require(${JSON.stringify(require.resolve('./mdm-service'))}).supervise(${JSON.stringify(paths)},process.env).catch(()=>{console.error('ISOLATED_SUPERVISOR_FAILED');process.exitCode=1});`);
  try {
    await assert.rejects(manager.startService(paths, env), /PORT_IN_USE/);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'other service untouched');
    await new Promise(resolve => reserve.close(resolve));
    const started = await manager.startService(paths, env);
    assert.equal(started.status, 'ready');
    const firstPid = started.pid;
    const state = JSON.parse(fs.readFileSync(paths.state));
    const duplicate = spawn(process.execPath, [paths.supervisorEntry, '--supervise'], { env, windowsHide: true, stdio: 'ignore' });
    const [duplicateCode] = await once(duplicate, 'exit');
    assert.equal(duplicateCode, 1, 'duplicate supervisor must refuse without overwriting ownership');
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.state)), state);
    assert.ok(manager.processIdentity(firstPid, paths.entry).matches);
    assert.equal(manager.processIdentity(firstPid, path.join(root, 'wrong.js')).matches, false);
    fs.writeFileSync(paths.state, JSON.stringify({ ...state, supervisor: { ...state.supervisor, created: 'reused-pid' } }));
    await assert.rejects(manager.stopService(paths), /OWNER_MISMATCH/);
    assert.equal(fs.existsSync(paths.stop), false);
    fs.writeFileSync(paths.state, JSON.stringify(state));
    fs.appendFileSync(path.join(root, 'public/index.html'), 'changed');
    await assert.rejects(manager.check(paths, env), /SOURCE_MISMATCH/);
    fs.writeFileSync(path.join(root, 'public/index.html'), '<html>MDM isolated test</html>');
    await fetch(`http://127.0.0.1:${port}/_test/crash`);
    const deadline = Date.now() + 25000;
    let recovered;
    while (Date.now() < deadline) {
      await sleep(750);
      try { recovered = await manager.check(paths, env); if (recovered.pid !== firstPid) break; } catch (_) { /* recovering */ }
    }
    assert.ok(recovered && recovered.pid !== firstPid, 'abnormal exit should recover with a new verified PID');
    assert.equal((await manager.stopService(paths)).status, 'stopped');
    assert.equal(manager.listeners(port).length, 0);
    await sleep(500);
    assert.equal((await manager.startService(paths, env)).status, 'ready');
    assert.equal((await manager.stopService(paths)).status, 'stopped');
    fs.writeFileSync(path.join(runtime, 'service.log'), 'x'.repeat(1024 * 1024));
    manager.eventLog(paths, 'rotation_test');
    assert.ok(fs.existsSync(path.join(runtime, 'service.log.1')));
    assert.ok(fs.statSync(path.join(runtime, 'service.log')).size < 1024);
    console.log('STAGE03_SERVICE_ISOLATED_PASS: random-port ownership/refusal, PID creation check, source mismatch, graceful stop/restart, abnormal-exit recovery, bounded log rotation');
  } finally {
    if (reserve.listening) await new Promise(resolve => reserve.close(resolve));
    const state = fs.existsSync(paths.state) ? JSON.parse(fs.readFileSync(paths.state)) : null;
    if (state && state.status !== 'stopped') await manager.stopService(paths);
    // Retain only disposable test files if cleanup cannot safely confirm stop.
    const rootResolved = path.resolve(root);
    assert.ok(rootResolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('mdm-service-test-'));
    fs.rmSync(root, { recursive: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
