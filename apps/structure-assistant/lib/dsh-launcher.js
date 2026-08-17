'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { AppError } = require('./errors');

function assertInside(basePath, candidatePath) {
  const base = path.resolve(basePath);
  const candidate = path.resolve(candidatePath);
  if (candidate === base || !candidate.startsWith(`${base}${path.sep}`)) {
    throw new AppError(500, 'DSH_START_FAILED', 'DSH临时目录不在允许范围内。');
  }
  return candidate;
}

function nodeMajor(nodeExecutable) {
  if (path.resolve(nodeExecutable) === path.resolve(process.execPath)) {
    return Number(process.versions.node.split('.')[0]);
  }
  const version = execFileSync(nodeExecutable, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000
  }).trim();
  return Number(version.replace(/^v/, '').split('.')[0]);
}

function createDshEnvironment(options) {
  const source = options.parentEnv || process.env;
  const allowedKeys = process.platform === 'win32'
    ? ['SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'COMSPEC', 'PATHEXT', 'Path', 'PATH', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA']
    : ['PATH', 'TMPDIR', 'LANG', 'LC_ALL'];
  const env = {};
  for (const key of allowedKeys) {
    if (source[key]) env[key] = source[key];
  }
  return {
    ...env,
    NODE_ENV: 'production',
    DSH_HOME: options.homeDir,
    DSH_TELEMETRY_MODE: 'DISABLED',
    DSH_PERMISSION_MODE: 'read-only',
    INFOMAT_DSH_PUBLIC_ROOT: options.publicRoot,
    INFOMAT_DSH_STRUCTURED_ROOT: options.structuredRoot,
    INFOMAT_DSH_RUNTIME_TOKEN: options.runtimeToken,
    INFOMAT_DSH_PARENT_PID: String(options.parentPid || process.pid)
  };
}

function resolveDshBin(appRoot) {
  const packagePath = require.resolve('@deepseek-ai/dsh/package.json', { paths: [appRoot] });
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return {
    version: packageJson.version,
    binPath: path.join(path.dirname(packagePath), String(packageJson.bin?.dsh || 'lib/bin.js'))
  };
}

function waitForReady(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffered = '';
    let settled = false;
    const finish = (error, port) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(port);
    };
    const onData = chunk => {
      buffered = `${buffered}${chunk.toString('utf8')}`.slice(-16_384);
      const match = buffered.match(/infomat dsh ready: http:\/\/127\.0\.0\.1:(\d{1,5})/);
      if (match) finish(null, Number(match[1]));
    };
    const onExit = () => finish(new AppError(503, 'DSH_START_FAILED', 'DSH工作区启动失败。'));
    const timer = setTimeout(() => {
      finish(new AppError(504, 'DSH_START_FAILED', 'DSH工作区启动超时。'));
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
}

async function removeRuntimeDirectory(runtimeRoot, runtimeDir) {
  const safePath = assertInside(runtimeRoot, runtimeDir);
  await fs.promises.rm(safePath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode != null) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = exited => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

function createDshLauncher(options) {
  const appRoot = path.resolve(options.appRoot);
  const repoRoot = path.resolve(options.repoRoot);
  const runtimeRoot = path.resolve(options.runtimeRoot || path.join(os.tmpdir(), 'infomat-structure-dsh'));
  const version = String(options.version || '0.1.0-rc.6');
  const expectedNodeMajor = Number(options.nodeMajor || 24);
  const nodeExecutable = path.resolve(options.nodeExecutable || process.execPath);
  const startTimeoutMs = Number(options.startTimeoutMs || 60_000);
  const stopGraceMs = Number(options.stopGraceMs || 5_000);
  const overlayPath = path.join(appRoot, 'config', 'dsh-governance.patch.yml');
  const pluginSource = path.join(appRoot, 'dsh-plugin', 'index.mjs');
  const publicRoot = path.join(appRoot, 'public');
  const structuredRoot = path.join(repoRoot, 'apps', 'structured-output-service');
  const dsh = resolveDshBin(appRoot);

  if (dsh.version !== version) {
    throw new AppError(500, 'DSH_VERSION_MISMATCH', `DSH版本必须固定为${version}。`);
  }
  if (nodeMajor(nodeExecutable) !== expectedNodeMajor) {
    throw new AppError(500, 'DSH_NODE_VERSION_MISMATCH', `DSH必须使用Node.js ${expectedNodeMajor}。`);
  }

  fs.mkdirSync(runtimeRoot, { recursive: true });

  return async function launchDshProcess(context = {}) {
    const runtimeDir = fs.mkdtempSync(path.join(runtimeRoot, 'runtime-'));
    assertInside(runtimeRoot, runtimeDir);
    const homeDir = path.join(runtimeDir, 'home');
    const workDir = path.join(runtimeDir, 'work');
    const pluginDir = path.join(homeDir, 'profiles', 'web', 'plugins', 'infomat-governance');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.copyFileSync(pluginSource, path.join(pluginDir, 'index.mjs'));
    const runtimeToken = crypto.randomBytes(32).toString('base64url');
    const env = createDshEnvironment({
      parentEnv: options.parentEnv,
      homeDir,
      publicRoot,
      structuredRoot,
      runtimeToken,
      parentPid: options.parentPid || process.pid
    });
    const trustedHosts = Array.isArray(options.trustedHosts) && options.trustedHosts.length
      ? options.trustedHosts
      : ['localhost:3004', '127.0.0.1:3004'];
    const args = [
      dsh.binPath,
      'web',
      '--patch', overlayPath,
      '--host', '127.0.0.1',
      '--port', '0'
    ];
    for (const authority of trustedHosts) args.push('--trusted-host', String(authority));

    const child = spawn(nodeExecutable, args, {
      cwd: workDir,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stderr.resume();
    let stopped = false;
    let cleanupPromise = null;
    const exitListeners = new Set();
    const cleanupRuntime = () => {
      if (!cleanupPromise) {
        cleanupPromise = removeRuntimeDirectory(runtimeRoot, runtimeDir).catch(error => {
          cleanupPromise = null;
          throw error;
        });
      }
      return cleanupPromise;
    };
    child.once('exit', () => {
      for (const listener of exitListeners) listener();
      if (!stopped) void cleanupRuntime().catch(() => {});
    });

    let port;
    try {
      port = await waitForReady(child, startTimeoutMs);
      const health = await fetch(`http://127.0.0.1:${port}/infomat-health`, {
        headers: { 'X-Infomat-DSH-Runtime': runtimeToken },
        signal: AbortSignal.timeout(5_000)
      });
      if (!health.ok) throw new Error('health check failed');
    } catch (_) {
      stopped = true;
      if (child.exitCode == null) child.kill('SIGKILL');
      await cleanupRuntime();
      throw new AppError(503, 'DSH_START_FAILED', 'DSH治理工作区启动失败，请继续使用经典入口。');
    }

    async function stop() {
      if (stopped) return;
      stopped = true;
      if (child.exitCode == null) {
        const gracefulExit = waitForExit(child, stopGraceMs);
        child.kill('SIGTERM');
        const exited = await gracefulExit;
        if (!exited && child.exitCode == null) {
          const forcedExit = waitForExit(child, stopGraceMs);
          child.kill('SIGKILL');
          await forcedExit;
        }
      }
      await cleanupRuntime();
    }

    async function internalFetch(routePath, requestOptions = {}) {
      return fetch(`http://127.0.0.1:${port}${routePath}`, {
        ...requestOptions,
        headers: {
          ...(requestOptions.headers || {}),
          'X-Infomat-DSH-Runtime': runtimeToken
        }
      });
    }

    return {
      port,
      runtimeToken,
      homeDir,
      workDir,
      internalFetch,
      stop,
      onExit(listener) {
        exitListeners.add(listener);
      }
    };
  };
}

module.exports = {
  assertInside,
  createDshEnvironment,
  createDshLauncher,
  resolveDshBin
};
