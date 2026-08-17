'use strict';

const { AppError } = require('./errors');

function assertSession(payload) {
  if (!payload?.sub || !payload?.nonce || !Number.isFinite(Number(payload?.exp))) {
    throw new AppError(401, 'AUTH_REQUIRED', '请先登录。');
  }
}

function createDshRuntimeManager(options = {}) {
  const version = String(options.version || '0.1.0-rc.6');
  const maxInstances = Number(options.maxInstances || 10);
  const now = options.now || Date.now;
  const launcher = options.launcher;
  const runtimes = new Map();
  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;

  function isExpired(payload) {
    return Number(payload.exp) * 1000 <= now();
  }

  function statusFor(payload, runtime = runtimes.get(payload.nonce)) {
    const running = runtime && runtime.status === 'running' && !isExpired(payload);
    return {
      status: running ? 'running' : runtime?.status === 'starting' ? 'starting' : 'stopped',
      dsh_version: version,
      workspace_count: running ? Number(runtime.workspaceCount || 0) : 0,
      expires_at: new Date(Number(payload.exp) * 1000).toISOString()
    };
  }

  async function stopRuntime(runtime) {
    if (!runtime) return;
    runtime.status = 'stopping';
    try {
      await runtime.instance?.stop?.();
    } catch (_) {
      // The runtime is already detached from the session. Shutdown errors are not exposed.
    }
  }

  async function stop(payload) {
    assertSession(payload);
    const runtime = runtimes.get(payload.nonce);
    if (!runtime) return statusFor(payload);
    runtimes.delete(payload.nonce);
    await stopRuntime(runtime);
    return statusFor(payload);
  }

  async function start(payload) {
    assertSession(payload);
    if (isExpired(payload)) throw new AppError(401, 'AUTH_REQUIRED', '当前登录会话已到期。');
    const existing = runtimes.get(payload.nonce);
    if (existing?.status === 'running') return statusFor(payload, existing);
    if (existing?.startPromise) {
      await existing.startPromise;
      return statusFor(payload, runtimes.get(payload.nonce));
    }
    if (runtimes.size >= maxInstances) {
      throw new AppError(429, 'DSH_RUNTIME_LIMIT', '当前DSH运行实例已达到上限，请稍后再试。');
    }
    if (typeof launcher !== 'function') {
      throw new AppError(503, 'DSH_START_FAILED', 'DSH运行组件尚未配置。');
    }

    const runtime = {
      accountId: payload.sub,
      nonce: payload.nonce,
      expiresAtMs: Number(payload.exp) * 1000,
      startedAt: new Date(now()).toISOString(),
      status: 'starting',
      workspaceCount: 0,
      instance: null,
      startPromise: null
    };
    runtimes.set(payload.nonce, runtime);
    runtime.startPromise = Promise.resolve(launcher({
      accountId: payload.sub,
      nonce: payload.nonce,
      expiresAtMs: runtime.expiresAtMs
    })).then(instance => {
      runtime.instance = instance;
      runtime.status = 'running';
      runtime.startPromise = null;
      instance?.onExit?.(() => {
        if (runtimes.get(payload.nonce) === runtime) runtimes.delete(payload.nonce);
      });
    }).catch(error => {
      if (runtimes.get(payload.nonce) === runtime) runtimes.delete(payload.nonce);
      throw error instanceof AppError
        ? error
        : new AppError(503, 'DSH_START_FAILED', 'DSH工作区启动失败，请稍后重试。');
    });
    await runtime.startPromise;
    return statusFor(payload, runtime);
  }

  async function cleanupExpired() {
    const expired = [...runtimes.values()].filter(runtime => runtime.expiresAtMs <= now());
    for (const runtime of expired) {
      if (runtimes.get(runtime.nonce) === runtime) runtimes.delete(runtime.nonce);
      await stopRuntime(runtime);
    }
  }

  async function close() {
    clearIntervalFn(cleanupTimer);
    const active = [...runtimes.values()];
    runtimes.clear();
    await Promise.all(active.map(stopRuntime));
  }

  function publicStatus(payload) {
    assertSession(payload);
    const runtime = runtimes.get(payload.nonce);
    if (runtime && runtime.expiresAtMs <= now()) {
      runtimes.delete(payload.nonce);
      void stopRuntime(runtime);
      return statusFor(payload);
    }
    return statusFor(payload, runtime);
  }

  function getRuntimeTarget(payload) {
    assertSession(payload);
    const runtime = runtimes.get(payload.nonce);
    if (!runtime || runtime.status !== 'running' || runtime.expiresAtMs <= now()) return null;
    return runtime.instance;
  }

  function updateWorkspaceCount(payload, count) {
    assertSession(payload);
    const runtime = runtimes.get(payload.nonce);
    if (!runtime || runtime.status !== 'running') return;
    runtime.workspaceCount = Math.max(0, Number(count) || 0);
  }

  async function refreshPublicStatus(payload) {
    const runtime = runtimes.get(payload?.nonce);
    if (runtime?.status === 'running' && runtime.instance?.internalFetch) {
      try {
        const response = await runtime.instance.internalFetch('/infomat-health', {
          signal: AbortSignal.timeout(3_000)
        });
        if (response.ok) {
          const health = await response.json();
          runtime.workspaceCount = Math.max(0, Number(health.workspace_count) || 0);
        }
      } catch (_) {
        // A transient status refresh must not terminate a still-running child.
      }
    }
    return publicStatus(payload);
  }

  function accountStatuses(accounts) {
    const counts = new Map();
    for (const runtime of runtimes.values()) {
      if (runtime.status !== 'running' || runtime.expiresAtMs <= now()) continue;
      counts.set(runtime.accountId, (counts.get(runtime.accountId) || 0) + 1);
    }
    return accounts.map(account => ({
      account_id: account.id,
      display_name: account.displayName,
      active_dsh_runtimes: counts.get(account.id) || 0
    }));
  }

  const cleanupTimer = setIntervalFn(() => {
    void cleanupExpired();
  }, 60_000);
  cleanupTimer?.unref?.();

  return {
    publicStatus,
    start,
    stop,
    cleanupExpired,
    close,
    accountStatuses,
    getRuntimeTarget,
    updateWorkspaceCount,
    refreshPublicStatus
  };
}

module.exports = {
  createDshRuntimeManager
};
