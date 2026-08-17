'use strict';

const crypto = require('crypto');
const { AppError } = require('./errors');

const MAX_API_KEY_LENGTH = 512;

function normalizeApiKey(value) {
  if (typeof value !== 'string') {
    throw new AppError(400, 'API_KEY_INVALID_INPUT', '请输入有效的DeepSeek API Key。');
  }
  const apiKey = value.trim();
  if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(apiKey)) {
    throw new AppError(400, 'API_KEY_INVALID_INPUT', '请输入有效的DeepSeek API Key。');
  }
  return apiKey;
}

function keyFingerprint(apiKey) {
  return `SHA-256: ${crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12)}`;
}

function createApiKeyStore(options = {}) {
  const now = options.now || (() => Date.now());
  const schedule = options.setTimeout || setTimeout;
  const cancel = options.clearTimeout || clearTimeout;
  const entries = new Map();

  function sessionIdentity(authPayload) {
    const sessionId = String(authPayload?.nonce || '');
    const accountId = String(authPayload?.sub || '');
    const expiresAtMs = Number(authPayload?.exp || 0) * 1000;
    if (!sessionId || !accountId || !Number.isFinite(expiresAtMs) || expiresAtMs <= now()) {
      throw new AppError(401, 'AUTH_REQUIRED', '请先重新登录MDM-AI助手。');
    }
    return { sessionId, accountId, expiresAtMs };
  }

  function removeBySessionId(sessionId) {
    const existing = entries.get(sessionId);
    if (!existing) return false;
    if (existing.timer) cancel(existing.timer);
    entries.delete(sessionId);
    return true;
  }

  function prune() {
    const current = now();
    for (const [sessionId, entry] of entries) {
      if (entry.expiresAtMs <= current) removeBySessionId(sessionId);
    }
  }

  function bind(authPayload, value) {
    const apiKey = normalizeApiKey(value);
    const identity = sessionIdentity(authPayload);
    removeBySessionId(identity.sessionId);
    const configuredAt = new Date(now()).toISOString();
    const entry = {
      accountId: identity.accountId,
      apiKey,
      fingerprint: keyFingerprint(apiKey),
      configuredAt,
      expiresAtMs: identity.expiresAtMs,
      timer: null
    };
    const delay = Math.max(1, identity.expiresAtMs - now());
    entry.timer = schedule(() => {
      entries.delete(identity.sessionId);
    }, delay);
    entry.timer?.unref?.();
    entries.set(identity.sessionId, entry);
    return entry;
  }

  function get(authPayload) {
    prune();
    const sessionId = String(authPayload?.nonce || '');
    const accountId = String(authPayload?.sub || '');
    const entry = entries.get(sessionId);
    if (!entry || entry.accountId !== accountId) return null;
    return entry;
  }

  function remove(authPayload) {
    return removeBySessionId(String(authPayload?.nonce || ''));
  }

  function publicStatus(authPayload) {
    const entry = get(authPayload);
    if (!entry) {
      return {
        configured: false,
        fingerprint: null,
        configured_at: null,
        expires_at: null
      };
    }
    return {
      configured: true,
      fingerprint: entry.fingerprint,
      configured_at: entry.configuredAt,
      expires_at: new Date(entry.expiresAtMs).toISOString()
    };
  }

  function accountStatuses(accounts) {
    prune();
    const counts = new Map();
    for (const entry of entries.values()) {
      counts.set(entry.accountId, (counts.get(entry.accountId) || 0) + 1);
    }
    return accounts.map(account => ({
      account_id: account.id,
      display_name: account.displayName,
      key_configured: (counts.get(account.id) || 0) > 0,
      active_key_sessions: counts.get(account.id) || 0
    }));
  }

  function clear() {
    for (const sessionId of [...entries.keys()]) removeBySessionId(sessionId);
  }

  return {
    bind,
    get,
    remove,
    publicStatus,
    accountStatuses,
    prune,
    clear
  };
}

module.exports = {
  MAX_API_KEY_LENGTH,
  normalizeApiKey,
  keyFingerprint,
  createApiKeyStore
};
