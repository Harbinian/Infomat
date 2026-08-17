'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { assertInside, createDshEnvironment, createDshLauncher, resolveDshBin } = require('../lib/dsh-launcher');

const appRoot = path.join(__dirname, '..');
const repoRoot = path.join(appRoot, '..', '..');
const overlayPath = path.join(appRoot, 'config', 'dsh-governance.patch.yml');
const dsh = resolveDshBin(appRoot);

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

function assertDisabled(configText, id) {
  const pattern = new RegExp(`- id: ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n(?:  [^\\r\\n]+\\r?\\n){0,8}  disabled: true`);
  assert.match(configText, pattern, `${id} must be disabled by the governance overlay`);
}

async function main() {
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'verify:dsh-entry must run with Node.js 24');
  assert.equal(dsh.version, '0.1.0-rc.6');

  const environment = createDshEnvironment({
    parentEnv: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      DEEPSEEK_API_KEY: 'secret-canary',
      STRUCTURE_ASSISTANT_PASSWORD_ZGY_HASH: 'password-canary'
    },
    homeDir: 'C:\\runtime\\home',
    publicRoot: 'C:\\runtime\\public',
    structuredRoot: 'C:\\runtime\\structured',
    runtimeToken: 'runtime-token'
  });
  assert.equal(Object.keys(environment).some(key => /API_KEY|PASSWORD|SECRET/i.test(key)), false);
  assert.equal(Object.values(environment).includes('secret-canary'), false);
  assert.equal(Object.values(environment).includes('password-canary'), false);

  const dump = execFileSync(process.execPath, [
    dsh.binPath,
    'web',
    '--patch', overlayPath,
    '--dump-config'
  ], {
    cwd: appRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...environment,
      DSH_HOME: path.join(os.tmpdir(), 'infomat-dsh-dump-profile'),
      INFOMAT_DSH_PUBLIC_ROOT: path.join(appRoot, 'public'),
      INFOMAT_DSH_STRUCTURED_ROOT: path.join(repoRoot, 'apps', 'structured-output-service')
    }
  });
  for (const id of [
    'credentials',
    'session-persistence-jsonl',
    'tool-bash',
    'tool-pwsh',
    'tool-fs',
    'tool-subagent',
    'tool-web',
    'directory-picker',
    'ui-settings-models',
    'ui-settings-plugins',
    'agent-presets',
    'web-runtime'
  ]) assertDisabled(dump, id);
  assert.match(dump, /- id: infomat-governance\r?\n  name: \.\/plugins\/infomat-governance\/index\.mjs/);

  const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'infomat-dsh-gate-'));
  const runtimeRoot = path.join(taskRoot, 'runtimes');
  let instance = null;
  let parentGuard = null;
  let parentBoundInstance = null;
  try {
    const launcher = createDshLauncher({
      appRoot,
      repoRoot,
      runtimeRoot,
      version: '0.1.0-rc.6',
      nodeMajor: 24,
      nodeExecutable: process.execPath,
      startTimeoutMs: 60_000,
      stopGraceMs: 5_000,
      trustedHosts: ['localhost:3004', '127.0.0.1:3004'],
      parentEnv: {
        ...process.env,
        DEEPSEEK_API_KEY: 'dsh-process-secret-canary'
      }
    });
    instance = await launcher({ accountId: 'gate', nonce: 'must-not-enter-child-env' });
    const root = await fetch(`http://127.0.0.1:${instance.port}/`);
    assert.equal(root.status, 200);
    const html = await root.text();
    assert.match(html, /DSH流程与数据治理工作区/);
    assert.match(html, /id="dshWorkspaceCard"/);
    assert.doesNotMatch(html, /Models|Shell|PowerShell|子Agent|插件管理/);

    const unauthenticatedState = await fetch(`http://127.0.0.1:${instance.port}/infomat-state`);
    assert.equal(unauthenticatedState.status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${instance.port}/api`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${instance.port}/plugins`)).status, 404);

    const created = await instance.internalFetch('/infomat-state/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '兼容门禁案例' })
    });
    assert.equal(created.status, 200);
    const createdState = await created.json();
    assert.equal(createdState.workspaces.length, 1);
    const workspace = createdState.workspace;
    const contentCanary = 'business-content-must-remain-in-memory';
    const saved = await instance.internalFetch(`/infomat-state/workspaces/${workspace.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_revision: workspace.revision,
        content: { fillDocument: { process: { process_name: contentCanary } } }
      })
    });
    assert.equal(saved.status, 200);
    const conflict = await instance.internalFetch(`/infomat-state/workspaces/${workspace.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_revision: workspace.revision, content: null })
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, 'STATE_CONFLICT');

    const files = [...listFiles(instance.homeDir), ...listFiles(instance.workDir)];
    assert.equal(files.some(file => /\.credentials\.yaml$|settings\.yaml$|\.jsonl$|\.sqlite\d*$/i.test(file)), false);
    for (const file of files) {
      const stat = fs.statSync(file);
      if (stat.size > 2 * 1024 * 1024) continue;
      assert.equal(fs.readFileSync(file).includes(Buffer.from(contentCanary)), false, `${file} contains business content`);
      assert.equal(fs.readFileSync(file).includes(Buffer.from('dsh-process-secret-canary')), false, `${file} contains a secret`);
    }

    const runtimeDir = path.dirname(instance.homeDir);
    await instance.stop();
    instance = null;
    assert.equal(fs.existsSync(runtimeDir), false);

    parentGuard = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    assert.ok(parentGuard.pid > 0);
    const parentBoundLauncher = createDshLauncher({
      appRoot,
      repoRoot,
      runtimeRoot,
      version: '0.1.0-rc.6',
      nodeMajor: 24,
      nodeExecutable: process.execPath,
      startTimeoutMs: 60_000,
      stopGraceMs: 5_000,
      trustedHosts: ['localhost:3004'],
      parentPid: parentGuard.pid
    });
    parentBoundInstance = await parentBoundLauncher({ accountId: 'parent-exit-gate' });
    const childExited = new Promise(resolve => parentBoundInstance.onExit(() => resolve(true)));
    const parentExited = new Promise(resolve => parentGuard.once('exit', resolve));
    parentGuard.kill('SIGTERM');
    await parentExited;
    parentGuard = null;
    assert.equal(await Promise.race([
      childExited,
      new Promise(resolve => setTimeout(() => resolve(false), 10_000))
    ]), true, 'DSH child must exit after its parent service disappears');
    await parentBoundInstance.stop();
    parentBoundInstance = null;
  } finally {
    parentGuard?.kill('SIGKILL');
    await parentBoundInstance?.stop();
    await instance?.stop();
    const safeTaskRoot = assertInside(os.tmpdir(), taskRoot);
    fs.rmSync(safeTaskRoot, { recursive: true, force: true });
  }

  console.log('structure-assistant DSH compatibility gate passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
