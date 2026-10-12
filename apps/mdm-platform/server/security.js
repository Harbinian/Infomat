const crypto = require('crypto');
const { securityLog } = require('./securityLog');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_PATHS = new Set(['/api/org/login']);
const LOGIN_FAILURE_LIMIT = 8;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
// The address-level window is deliberately wider than the account window: one office egress
// carries many legitimate users, so it must bound sustained abuse without locking a shared exit
// out after a handful of ordinary mistakes.
const positive = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const LOGIN_IP_FAILURE_LIMIT = positive(process.env.LOGIN_IP_FAILURE_LIMIT, 40);
const LOGIN_CONCURRENCY_LIMIT = positive(process.env.LOGIN_CONCURRENCY_LIMIT, 4);
const LOGIN_RATE_LIMIT_MAX_ENTRIES = Math.max(2, positive(process.env.LOGIN_RATE_LIMIT_MAX_ENTRIES, 5000));
const failedLogins = new Map();
let rejectedByCapacity = 0;

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  // This source's policy is built in one place; running deployments have their own release.
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
// Case variants share a limiter key because the current MySQL login collation folds case.
// This normalization is only for admission; the submitted name still reaches the login lookup.
function normalizeLoginName(raw) {
  return String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
}

function loginKeys(req) {
  const body = req.body || {};
  const rawName = body.loginName !== undefined ? body.loginName : body.employee_no;
  const loginName = normalizeLoginName(typeof rawName === 'string' ? rawName : '') || 'unknown';
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
    if (state.resetAt <= now && state.inFlight === 0) failedLogins.delete(key);
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
  if (existing && (existing.resetAt > now || existing.inFlight > 0)) {
    if (existing.resetAt <= now) { existing.count = existing.inFlight; existing.resetAt = now + LOGIN_FAILURE_WINDOW_MS; }
    return existing;
  }
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
  const needed = [keys.account, keys.address].filter(key => !failedLogins.has(key)).length;
  // Never evict a live failure window or an active admission to make room for random names.
  if (failedLogins.size + needed > LOGIN_RATE_LIMIT_MAX_ENTRIES) {
    rejectedByCapacity += 1;
    res.set('Retry-After', '60');
    securityLog(req).write({ event: 'rate_limited', code: 'LOGIN_BUSY', status: 429 });
    return res.status(429).json({ code: 'LOGIN_BUSY', error: '登录请求过多，请稍后再试' });
  }
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
  if (refused) {
    // A refused request leaves no trace of its own: undo what this request took, including the
    // count it added to the key that refused it.
    for (const [, state] of admitted) {
      state.count = Math.max(0, state.count - 1);
      state.inFlight = Math.max(0, state.inFlight - 1);
    }
    refused.state.count = Math.max(0, refused.state.count - 1);
    for (const key of [keys.account, keys.address]) {
      const state = failedLogins.get(key);
      if (state && state.count === 0 && state.inFlight === 0) failedLogins.delete(key);
    }
    securityLog(req).write({ event: 'rate_limited', code: refused.code, status: 429 });
    res.set('Retry-After', String(retryAfterSeconds(refused.state, now)));
    return res.status(429).json(refused.code === 'LOGIN_BUSY'
      ? { code: 'LOGIN_BUSY', error: '登录请求过多，请稍后再试' }
      : { code: 'LOGIN_RATE_LIMITED', error: '登录失败次数过多，请稍后再试' });
  }

  const admittedKeys = admitted.map(([key]) => key);
  req.loginRateLimitKeys = admittedKeys;
  req.loginRateLimitStates = admitted;
  req.loginRateLimitKey = keys.account;
  // Releasing on every outcome is what makes the in-flight bound a bound instead of a leak,
  // including when the handler throws before it settles the login.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const [key, state] of admitted) {
      state.inFlight = Math.max(0, state.inFlight - 1);
      if (state.inFlight === 0 && state.count === 0 && failedLogins.get(key) === state) failedLogins.delete(key);
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
  for (const [key, state] of req.loginRateLimitStates || []) {
    if (key.startsWith('acct:')) {
      // Clear settled failures while retaining every other password check still in flight.
      state.count = Math.max(0, state.inFlight - 1);
      continue;
    }
    state.count = Math.max(0, state.count - 1);
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
