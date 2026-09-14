const net = require('node:net');

function integer(env, key, fallback, min, max) {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`MDM_CONFIG_INVALID: ${key}`);
  return value;
}

function sessionConfig(env = process.env) {
  const testing = env.NODE_ENV !== 'production' && (env.NODE_ENV === 'test' || env.MDM_ALLOW_LEGACY_TEST_MODE === '1');
  const store = env.MDM_SESSION_STORE || (testing && env.MDM_ALLOW_LEGACY_TEST_MODE === '1' ? 'memory' : 'mysql');
  if (store !== 'mysql' && !(testing && store === 'memory')) throw new Error('MDM_CONFIG_INVALID: MDM_SESSION_STORE');
  const mode = env.MDM_ACCESS_MODE || (env.NODE_ENV === 'production' ? '' : 'http-local');
  if (!['https-proxy', 'http-local'].includes(mode) || (env.NODE_ENV === 'production' && mode !== 'https-proxy')) {
    throw new Error('MDM_CONFIG_INVALID: MDM_ACCESS_MODE=https-proxy is required in production');
  }
  const secure = mode === 'https-proxy';
  const host = env.HOST || '127.0.0.1';
  if (!net.isIP(host)) throw new Error('MDM_CONFIG_INVALID: HOST must be a bind IP');
  if (!secure && !['127.0.0.1', '::1'].includes(host)) throw new Error('MDM_CONFIG_INVALID: http-local must bind loopback');
  let origin = null;
  const proxies = String(env.MDM_TRUST_PROXY || '').split(',').map(x => x.trim()).filter(Boolean);
  if (secure) {
    try { origin = new URL(env.MDM_PUBLIC_ORIGIN); } catch (_) { throw new Error('MDM_CONFIG_INVALID: MDM_PUBLIC_ORIGIN'); }
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
      throw new Error('MDM_CONFIG_INVALID: MDM_PUBLIC_ORIGIN must be an HTTPS origin');
    }
    if (!proxies.length) throw new Error('MDM_CONFIG_INVALID: MDM_TRUST_PROXY is required');
  } else if (proxies.length) throw new Error('MDM_CONFIG_INVALID: http-local cannot trust proxy headers');
  for (const proxy of proxies) {
    const parts = proxy.split('/');
    const family = net.isIP(parts[0]);
    if (!family || parts.length > 2 || (parts.length === 2 && (!/^\d+$/.test(parts[1]) || Number(parts[1]) < 1 || Number(parts[1]) > (family === 4 ? 32 : 128)))) {
      throw new Error('MDM_CONFIG_INVALID: MDM_TRUST_PROXY must contain bounded IP addresses or CIDRs');
    }
    if (parts[0] === '0.0.0.0' || parts[0] === '::') throw new Error('MDM_CONFIG_INVALID: unspecified proxy address');
  }
  let secret = env.SESSION_SECRET;
  if (env.NODE_ENV === 'production' && env.ALLOW_INSECURE_SESSION_SECRET === '1') throw new Error('MDM_CONFIG_INVALID: insecure session secret forbidden');
  if (!secret && !secure && env.ALLOW_INSECURE_SESSION_SECRET === '1') secret = 'mdm-platform-dev-secret-change-me';
  if (!secret || (secure && Buffer.byteLength(secret) < 32)) throw new Error('MDM_CONFIG_INVALID: SESSION_SECRET must have at least 32 bytes for HTTPS');
  return {
    store, host, secure, origin: origin && origin.origin, proxies, secret,
    name: secure ? '__Host-infomat.mdm.sid' : 'infomat.mdm.sid',
    ttlMs: integer(env, 'MDM_SESSION_TTL_SECONDS', 86400, 60, 604800) * 1000,
    timeoutMs: integer(env, 'MDM_SESSION_TIMEOUT_MS', 2000, 100, 10000),
    connectionLimit: integer(env, 'MDM_SESSION_CONNECTION_LIMIT', 2, 1, 10)
  };
}

module.exports = { sessionConfig, integer };
