const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_PATHS = new Set(['/api/org/login']);
const LOGIN_FAILURE_LIMIT = 8;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map();

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'"
  );
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
  if (!req.session || (!req.session.personId && !req.session.userId)) return next();

  const expected = ensureCsrfSecret(req);
  const actual = req.get('X-CSRF-Token');
  if (!actual || actual !== expected) {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }
  next();
}

function loginKey(req) {
  const loginName = String(
    req.body && (req.body.loginName || req.body.employee_no) || 'unknown'
  );
  return `${req.ip}:${loginName}`;
}

function loginRateLimit(req, res, next) {
  const key = loginKey(req);
  const now = Date.now();
  let state = failedLogins.get(key);
  if (!state || state.resetAt <= now) {
    state = { count: 0, resetAt: now + LOGIN_FAILURE_WINDOW_MS };
    failedLogins.set(key, state);
  }

  if (state.count >= LOGIN_FAILURE_LIMIT) {
    return res.status(429).json({ error: '登录失败次数过多，请稍后再试' });
  }

  req.loginRateLimitKey = key;
  next();
}

function recordLoginFailure(req) {
  const key = req.loginRateLimitKey || loginKey(req);
  const now = Date.now();
  const state = failedLogins.get(key) || { count: 0, resetAt: now + LOGIN_FAILURE_WINDOW_MS };
  if (state.resetAt <= now) {
    state.count = 0;
    state.resetAt = now + LOGIN_FAILURE_WINDOW_MS;
  }
  state.count += 1;
  failedLogins.set(key, state);
}

function clearLoginFailures(req) {
  const key = req.loginRateLimitKey || loginKey(req);
  failedLogins.delete(key);
}

module.exports = {
  securityHeaders,
  csrfProtection,
  issueCsrfToken,
  loginRateLimit,
  recordLoginFailure,
  clearLoginFailures
};
