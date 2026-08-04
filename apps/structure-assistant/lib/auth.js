'use strict';

const crypto = require('crypto');
const { AppError } = require('./errors');

const COOKIE_NAME = 'infomat_structure_auth';
const SCRYPT_KEY_LENGTH = 64;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64url(value) {
  return Buffer.from(value, 'base64url');
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${base64url(salt)}$${base64url(derived)}`;
}

function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = decodeBase64url(parts[1]);
    const expected = decodeBase64url(parts[2]);
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const item of String(header || '').split(';')) {
    const splitAt = item.indexOf('=');
    if (splitAt <= 0) continue;
    const key = item.slice(0, splitAt).trim();
    const value = item.slice(splitAt + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

function createAuth({ accounts, sessionSecret, sessionHours, secureCookie, loginWindowMinutes, loginMaxAttempts }) {
  const byUsername = new Map(accounts.map(account => [account.username.toLowerCase(), account]));
  const byId = new Map(accounts.map(account => [account.id, account]));
  const attempts = new Map();
  const maxAgeSeconds = Math.max(1, Number(sessionHours || 8)) * 60 * 60;

  function sign(payload) {
    const body = base64url(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  function verify(token) {
    const [body, signature] = String(token || '').split('.');
    if (!body || !signature) return null;
    const expected = crypto.createHmac('sha256', sessionSecret).update(body).digest();
    let actual;
    try {
      actual = decodeBase64url(signature);
    } catch (_) {
      return null;
    }
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    try {
      const payload = JSON.parse(decodeBase64url(body).toString('utf8'));
      if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
      const account = byId.get(payload.sub);
      if (!account) return null;
      return { account, payload };
    } catch (_) {
      return null;
    }
  }

  function cookie(value, maxAge = maxAgeSeconds) {
    const parts = [
      `${COOKIE_NAME}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAge}`
    ];
    if (secureCookie) parts.push('Secure');
    return parts.join('; ');
  }

  function publicUser(account, csrfToken) {
    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      department: account.department,
      role: account.role,
      csrfToken
    };
  }

  function clientKey(req) {
    return String(req.socket?.remoteAddress || req.ip || 'unknown');
  }

  function checkRateLimit(req) {
    const key = clientKey(req);
    const now = Date.now();
    const windowMs = Number(loginWindowMinutes || 15) * 60 * 1000;
    const record = attempts.get(key);
    if (!record || now - record.startedAt > windowMs) {
      attempts.set(key, { startedAt: now, count: 0 });
      return;
    }
    if (record.count >= Number(loginMaxAttempts || 5)) {
      throw new AppError(429, 'LOGIN_RATE_LIMITED', '登录尝试过多，请稍后再试。');
    }
  }

  function recordFailure(req) {
    const key = clientKey(req);
    const record = attempts.get(key) || { startedAt: Date.now(), count: 0 };
    record.count += 1;
    attempts.set(key, record);
  }

  function clearFailures(req) {
    attempts.delete(clientKey(req));
  }

  function login(req, res) {
    checkRateLimit(req);
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const account = byUsername.get(username);
    if (!account || !account.passwordHash || !verifyPassword(password, account.passwordHash)) {
      recordFailure(req);
      throw new AppError(401, 'INVALID_CREDENTIALS', '用户名或密码不正确。');
    }
    clearFailures(req);
    const csrfToken = crypto.randomBytes(24).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const token = sign({
      sub: account.id,
      csrf: csrfToken,
      iat: now,
      exp: now + maxAgeSeconds,
      nonce: crypto.randomBytes(12).toString('base64url')
    });
    res.setHeader('Set-Cookie', cookie(token));
    return publicUser(account, csrfToken);
  }

  function logout(_req, res) {
    res.setHeader('Set-Cookie', cookie('', 0));
  }

  function authenticateRequest(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    return verify(token);
  }

  function requireAuth(req, _res, next) {
    const authenticated = authenticateRequest(req);
    if (!authenticated) return next(new AppError(401, 'AUTH_REQUIRED', '请先登录MDM-AI助手。'));
    req.user = authenticated.account;
    req.authPayload = authenticated.payload;
    return next();
  }

  function requireCsrf(req, _res, next) {
    const supplied = String(req.headers['x-csrf-token'] || '');
    const expected = String(req.authPayload?.csrf || '');
    if (!supplied || !expected || supplied.length !== expected.length) {
      return next(new AppError(403, 'CSRF_FAILED', '页面校验信息已失效，请重新登录。'));
    }
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    if (!crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      return next(new AppError(403, 'CSRF_FAILED', '页面校验信息已失效，请重新登录。'));
    }
    return next();
  }

  function requireAdmin(req, _res, next) {
    if (req.user?.role !== 'admin') {
      return next(new AppError(403, 'ADMIN_REQUIRED', '当前账号没有试点管理权限。'));
    }
    return next();
  }

  return {
    login,
    logout,
    authenticateRequest,
    requireAuth,
    requireCsrf,
    requireAdmin,
    publicUser
  };
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  parseCookies,
  createAuth
};
