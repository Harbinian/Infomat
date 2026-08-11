'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOGIN_LIMIT = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map();

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function cookieName(surface) {
  return surface === 'admin' ? 'infomat_collection_admin_sid' : 'infomat_collection_respondent_sid';
}

function setSessionCookie(res, surface, token, config) {
  const parts = [
    `${cookieName(surface)}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(config.sessionHours * 60 * 60)}`
  ];
  if (config.secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res, surface, config) {
  const parts = [`${cookieName(surface)}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (config.secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function loginRateKey(req, loginName) {
  return `${req.ip}:${String(loginName || '').toLowerCase()}`;
}

function assertLoginAllowed(req, loginName) {
  const key = loginRateKey(req, loginName);
  const now = Date.now();
  let entry = failedLogins.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    failedLogins.set(key, entry);
  }
  if (entry.count >= LOGIN_LIMIT) {
    const error = new Error('登录失败次数过多，请稍后再试');
    error.status = 429;
    error.code = 'LOGIN_RATE_LIMITED';
    throw error;
  }
}

function recordLoginFailure(req, loginName) {
  const key = loginRateKey(req, loginName);
  const now = Date.now();
  const entry = failedLogins.get(key) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  entry.count += 1;
  failedLogins.set(key, entry);
}

function clearLoginFailures(req, loginName) {
  failedLogins.delete(loginRateKey(req, loginName));
}

function createAuth({ pool, config, surface, audit }) {
  async function loadIdentity(loginName) {
    const [rows] = await pool.execute(
      `SELECT p.person_id, p.employee_no, p.person_name, p.current_department_id,
              p.status AS person_status, p.employment_status,
              d.name AS department_name, d.code AS department_code,
              a.account_id, a.login_name, a.password_hash, a.account_status,
              a.auth_version, a.must_change_password
         FROM person p
         JOIN user_accounts a ON a.person_id=p.person_id
         LEFT JOIN departments d ON d.id=p.current_department_id
        WHERE a.login_name=? OR p.employee_no=?
        LIMIT 1`,
      [loginName, loginName]
    );
    return rows[0] || null;
  }

  async function loadGrants(personId) {
    const [rows] = await pool.execute(
      `SELECT grant_id, role_code, scope_type, scope_department_id, scope_key
         FROM collection_app_grants
        WHERE person_id=? AND status='active'
        ORDER BY role_code, scope_key`,
      [personId]
    );
    return rows.map(row => ({
      grantId: Number(row.grant_id),
      roleCode: row.role_code,
      scopeType: row.scope_type,
      scopeDepartmentId: row.scope_department_id == null ? null : Number(row.scope_department_id),
      scopeKey: row.scope_key
    }));
  }

  async function login(req, res) {
    const loginName = String(req.body?.loginName || req.body?.employeeNo || '').trim();
    const password = String(req.body?.password || '');
    if (!loginName || !password) {
      const error = new Error('请输入工号和密码');
      error.status = 400;
      error.code = 'LOGIN_INPUT_REQUIRED';
      throw error;
    }
    assertLoginAllowed(req, loginName);
    const identity = await loadIdentity(loginName);
    const valid = identity && await bcrypt.compare(password, identity.password_hash);
    if (!valid) {
      recordLoginFailure(req, loginName);
      const error = new Error('工号或密码不正确');
      error.status = 401;
      error.code = 'LOGIN_FAILED';
      throw error;
    }
    if (identity.person_status !== 'active' || identity.employment_status !== 'active' || identity.account_status !== 'active') {
      const error = new Error('人员或账号当前不可用，请联系管理员');
      error.status = 403;
      error.code = 'ACCOUNT_UNAVAILABLE';
      throw error;
    }
    if (identity.must_change_password) {
      const error = new Error('首次登录必须先在 3000 修改密码');
      error.status = 403;
      error.code = 'PASSWORD_CHANGE_REQUIRED';
      throw error;
    }
    const grants = await loadGrants(identity.person_id);
    if (surface === 'admin' && grants.length === 0) {
      const error = new Error('当前账号没有信息收集后台权限');
      error.status = 403;
      error.code = 'COLLECTION_ADMIN_ACCESS_DENIED';
      throw error;
    }
    clearLoginFailures(req, loginName);
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hash(token);
    const expiresAt = new Date(Date.now() + config.sessionHours * 60 * 60 * 1000);
    await pool.execute(
      `INSERT INTO collection_sessions
        (token_hash, surface, person_id, account_id, auth_version, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tokenHash, surface, identity.person_id, identity.account_id, identity.auth_version, expiresAt]
    );
    await pool.execute('UPDATE user_accounts SET last_login_at=CURRENT_TIMESTAMP WHERE account_id=?', [identity.account_id]);
    setSessionCookie(res, surface, token, config);
    await audit(req, {
      actorPersonId: identity.person_id,
      actionCode: 'auth.login',
      entityType: 'session',
      entityId: surface,
      ownerDepartmentId: identity.current_department_id,
      detail: { surface }
    });
    return publicIdentity(identity, grants);
  }

  async function loadSession(req) {
    const token = parseCookies(req.headers.cookie)[cookieName(surface)];
    if (!token) return null;
    const [rows] = await pool.execute(
      `SELECT s.token_hash, s.surface, s.person_id, s.account_id, s.auth_version AS session_auth_version,
              s.expires_at, s.revoked_at,
              p.employee_no, p.person_name, p.current_department_id,
              p.status AS person_status, p.employment_status,
              d.name AS department_name, d.code AS department_code,
              a.login_name, a.account_status, a.auth_version, a.must_change_password
         FROM collection_sessions s
         JOIN person p ON p.person_id=s.person_id
         JOIN user_accounts a ON a.account_id=s.account_id AND a.person_id=s.person_id
         LEFT JOIN departments d ON d.id=p.current_department_id
        WHERE s.token_hash=? AND s.surface=?
        LIMIT 1`,
      [hash(token), surface]
    );
    const row = rows[0];
    if (!row) return null;
    const invalid = row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()
      || row.person_status !== 'active' || row.employment_status !== 'active'
      || row.account_status !== 'active' || row.must_change_password
      || Number(row.session_auth_version) !== Number(row.auth_version);
    if (invalid) {
      await pool.execute('UPDATE collection_sessions SET revoked_at=COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE token_hash=?', [row.token_hash]);
      return null;
    }
    const grants = await loadGrants(row.person_id);
    if (surface === 'admin' && grants.length === 0) return null;
    await pool.execute('UPDATE collection_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=?', [row.token_hash]);
    return { tokenHash: row.token_hash, ...publicIdentity(row, grants) };
  }

  async function requireAuth(req, res, next) {
    try {
      const identity = await loadSession(req);
      if (!identity) {
        clearSessionCookie(res, surface, config);
        return res.status(401).json({ error: '请先登录', code: 'AUTH_REQUIRED' });
      }
      req.identity = identity;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function logout(req, res) {
    const token = parseCookies(req.headers.cookie)[cookieName(surface)];
    if (token) await pool.execute('UPDATE collection_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?', [hash(token)]);
    clearSessionCookie(res, surface, config);
  }

  async function issueCsrf(req) {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.execute('UPDATE collection_sessions SET csrf_token_hash=? WHERE token_hash=?', [hash(token), req.identity.tokenHash]);
    return token;
  }

  async function requireCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.path === '/api/v1/auth/login') return next();
    try {
      const supplied = String(req.get('X-CSRF-Token') || '');
      const [rows] = await pool.execute('SELECT csrf_token_hash FROM collection_sessions WHERE token_hash=?', [req.identity.tokenHash]);
      if (!supplied || !rows[0]?.csrf_token_hash || hash(supplied) !== rows[0].csrf_token_hash) {
        return res.status(403).json({ error: '页面安全令牌已失效，请刷新后重试', code: 'CSRF_INVALID' });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  }

  return { issueCsrf, loadGrants, loadSession, login, logout, requireAuth, requireCsrf };
}

function publicIdentity(row, grants) {
  return {
    personId: Number(row.person_id),
    accountId: Number(row.account_id),
    employeeNo: row.employee_no,
    personName: row.person_name,
    loginName: row.login_name,
    departmentId: row.current_department_id == null ? null : Number(row.current_department_id),
    departmentName: row.department_name || null,
    departmentCode: row.department_code || null,
    authVersion: Number(row.auth_version),
    mustChangePassword: Boolean(row.must_change_password),
    grants
  };
}

function isCollectionAdmin(identity) {
  return identity.grants.some(grant => grant.roleCode === 'collection_admin' && grant.scopeType === 'global');
}

function departmentScopes(identity) {
  return new Set(identity.grants
    .filter(grant => grant.roleCode === 'collection_designer' && grant.scopeType === 'department')
    .map(grant => Number(grant.scopeDepartmentId)));
}

function canManageDepartment(identity, departmentId) {
  return isCollectionAdmin(identity) || departmentScopes(identity).has(Number(departmentId));
}

module.exports = {
  canManageDepartment,
  createAuth,
  departmentScopes,
  hash,
  isCollectionAdmin
};
