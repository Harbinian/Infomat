const crypto = require('crypto');
const { securityLog } = require('./securityLog');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_PATHS = new Set(['/api/org/login']);
const LOGIN_FAILURE_LIMIT = 8;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
// The address-level window is deliberately wider than the account window: one office egress
// carries many legitimate users, so it must bound sustained abuse without locking a shared exit
// out after a handful of ordinary mistakes.
const LOGIN_IP_FAILURE_LIMIT = Number(process.env.LOGIN_IP_FAILURE_LIMIT || 40);
const LOGIN_CONCURRENCY_LIMIT = Number(process.env.LOGIN_CONCURRENCY_LIMIT || 4);
const LOGIN_RATE_LIMIT_MAX_ENTRIES = Number(process.env.LOGIN_RATE_LIMIT_MAX_ENTRIES || 5000);
const failedLogins = new Map();
let rejectedByCapacity = 0;

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  // R13: the policy is built in one place. The deployed value is unchanged.
  res.setHeader('Content-Security-Policy', require('./cspPolicy').DEPLOYED_CSP);
  next();
}

function ensureCsrfSecret(req) {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfSecret;
}

function issueCsrfToken(req, res) {
  res.json({ csrfToken: ensureCsrfSecret(req) });
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  if (!req.session || (!req.session.personId && !req.session.userId && req.session.identityKind !== 'system_admin')) return next();

  const expected = ensureCsrfSecret(req);
  const actual = req.get('X-CSRF-Token');
  if (!actual || actual !== expected) {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }
  next();
}

// R03: the login lookup trims the submitted name, so the rate-limit key has to trim it too.
// Whitespace variants of one account previously landed in different windows. Case is left alone:
// the column collation already folds it, and changing it here would alter which names are valid.
function normalizeLoginName(raw) {
  return String(raw === undefined || raw === null ? '' : raw).trim();
}

function loginKeys(req) {
  const loginName = normalizeLoginName(req.body && (req.body.loginName || req.body.employee_no)) || 'unknown';
  const address = String(req.ip || 'unknown');
  return { account: `acct:${address}:${loginName}`, address: `ip:${address}` };
}

function loginLimitFor(key) {
  return key.startsWith('ip:') ? LOGIN_IP_FAILURE_LIMIT : LOGIN_FAILURE_LIMIT;
}

// Bounded storage: entries expire on their own window, and the map additionally never grows past
// LOGIN_RATE_LIMIT_MAX_ENTRIES, so random account names cannot turn the limiter into a leak.
function evictIfNeeded(now) {
  for (const [key, state] of failedLogins) {
    if (state.resetAt > now) break;
    failedLogins.delete(key);
  }
  while (failedLogins.size > LOGIN_RATE_LIMIT_MAX_ENTRIES) {
    const oldest = failedLogins.keys().next();
    if (oldest.done) break;
    failedLogins.delete(oldest.value);
    rejectedByCapacity += 1;
  }
}

function touch(key, state, now) {
  failedLogins.delete(key);
  failedLogins.set(key, state);
  state.resetAt = state.resetAt <= now ? now + LOGIN_FAILURE_WINDOW_MS : state.resetAt;
  return state;
}

function stateFor(key, now) {
  const existing = failedLogins.get(key);
  if (existing && existing.resetAt > now) return existing;
  if (existing) failedLogins.delete(key);
  return { count: 0, inFlight: 0, resetAt: now + LOGIN_FAILURE_WINDOW_MS };
}

function retryAfterSeconds(state, now) {
  return Math.max(1, Math.ceil((state.resetAt - now) / 1000));
}

// A request is counted when it is admitted, not after the asynchronous password check. Counting
// afterwards let a concurrent burst all pass before any of them had been recorded.
function loginRateLimit(req, res, next) {
  const now = Date.now();
  evictIfNeeded(now);
  const keys = loginKeys(req);
  const admitted = [];
  let refused = null;
  for (const key of [keys.account, keys.address]) {
    const state = touch(key, stateFor(key, now), now);
    state.count += 1;
    if (state.count > loginLimitFor(key)) { refused = { state, code: 'LOGIN_RATE_LIMITED' }; break; }
    if (state.inFlight >= LOGIN_CONCURRENCY_LIMIT) { refused = { state, code: 'LOGIN_BUSY' }; break; }
    state.inFlight += 1;
    admitted.push([key, state]);
  }
  // Enforce the capacity bound again now that this request's keys exist; the keys just touched
  // are the newest in the map, so trimming the oldest cannot evict the request being served.
  evictIfNeeded(now);

  if (refused) {
    // A refused request leaves no trace of its own: undo what this request took, including the
    // count it added to the key that refused it.
    for (const [, state] of admitted) {
      state.count = Math.max(0, state.count - 1);
      state.inFlight = Math.max(0, state.inFlight - 1);
    }
    refused.state.count = Math.max(0, refused.state.count - 1);
    securityLog(req).write({ event: 'rate_limited', code: refused.code, status: 429 });
    res.set('Retry-After', String(retryAfterSeconds(refused.state, now)));
    return res.status(429).json(refused.code === 'LOGIN_BUSY'
      ? { code: 'LOGIN_BUSY', error: '登录请求过多，请稍后再试' }
      : { code: 'LOGIN_RATE_LIMITED', error: '登录失败次数过多，请稍后再试' });
  }

  const admittedKeys = admitted.map(([key]) => key);
  req.loginRateLimitKeys = admittedKeys;
  req.loginRateLimitKey = keys.account;
  // Releasing on every outcome is what makes the in-flight bound a bound instead of a leak,
  // including when the handler throws before it settles the login.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const key of admittedKeys) {
      const state = failedLogins.get(key);
      if (state) state.inFlight = Math.max(0, state.inFlight - 1);
    }
  };
  res.on('finish', release);
  res.on('close', release);
  next();
}

// The attempt was already counted when it was admitted; a failure keeps that count in the window.
function recordLoginFailure() {}

// A successful login is removed from the window: the account's failure history is cleared, and
// this successful attempt stops counting against the shared address. Otherwise a busy office
// would lock itself out simply by logging in normally.
function clearLoginFailures(req) {
  for (const key of req.loginRateLimitKeys || []) {
    if (key.startsWith('acct:')) {
      failedLogins.delete(key);
      continue;
    }
    const state = failedLogins.get(key);
    if (state) state.count = Math.max(0, state.count - 1);
  }
}

function loginRateLimitStats() {
  let inFlight = 0;
  for (const state of failedLogins.values()) inFlight += state.inFlight;
  return {
    size: failedLogins.size, inFlight, rejectedByCapacity,
    limit: LOGIN_FAILURE_LIMIT, addressLimit: LOGIN_IP_FAILURE_LIMIT,
    concurrencyLimit: LOGIN_CONCURRENCY_LIMIT, maxEntries: LOGIN_RATE_LIMIT_MAX_ENTRIES
  };
}

// Test and diagnostic helper: never used by the request path.
function resetLoginRateLimit() {
  failedLogins.clear();
  rejectedByCapacity = 0;
}

module.exports = {
  securityHeaders,
  csrfProtection,
  issueCsrfToken,
  loginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  normalizeLoginName,
  loginRateLimitStats,
  resetLoginRateLimit
};
