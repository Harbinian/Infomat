const session = require('express-session');
const crypto = require('node:crypto');
const { withMysqlDeadline, lazyMysqlPool } = require('./boundedMysql');

function unavailable() {
  return Object.assign(new Error('会话服务暂不可用，请稍后重试'), { code: 'SESSION_STORE_UNAVAILABLE', statusCode: 503 });
}

class MysqlSessionStore extends session.Store {
  constructor(config, { pool, env = process.env, now = Date.now } = {}) {
    super();
    // A browser legitimately loads several protected resources together. Bound the
    // acquisition queue and keep the existing end-to-end deadline, instead of
    // failing every request beyond two simultaneous session reads/touches.
    this.pool = pool || lazyMysqlPool(env, config.connectionLimit, config.timeoutMs, { queueLimit: 32 });
    this.config = config;
    this.now = now;
  }

  key(sid) { return crypto.createHash('sha256').update(sid).digest('hex'); }

  run(operation, callback) {
    withMysqlDeadline(this.pool, operation, this.config.timeoutMs)
      .then(value => callback(null, value), () => callback(unavailable()));
  }

  get(sid, callback) {
    this.run(async connection => {
      const [rows] = await connection.execute('SELECT session_json, expires_at FROM mdm_http_sessions WHERE sid_hash=? AND expires_at>?', [this.key(sid), this.now()]);
      if (!rows.length) return null;
      const value = typeof rows[0].session_json === 'string' ? JSON.parse(rows[0].session_json) : rows[0].session_json;
      if (!value || value.formatVersion !== 1 || !value.cookie) return null;
      // The cookie's persisted expiry can lag a touch. The indexed expiry is the
      // authority; use it on reload so a read-only session survives a restart.
      value.cookie.expires = new Date(Number(rows[0].expires_at)).toISOString();
      return value;
    }, callback);
  }

  set(sid, value, callback = () => {}) {
    const expires = Math.min(new Date(value.cookie.expires).getTime(), this.now() + this.config.ttlMs);
    if (!Number.isFinite(expires)) return callback(unavailable());
    // Never persist a full user payload or business data in the session table.
    const stored = { formatVersion: 1, cookie: value.cookie };
    for (const key of ['personId', 'accountId', 'authVersion', 'csrfSecret']) {
      if (value[key] !== undefined) stored[key] = value[key];
    }
    this.run(connection => connection.execute(
      'INSERT INTO mdm_http_sessions (sid_hash, session_json, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE session_json=VALUES(session_json), expires_at=VALUES(expires_at)',
      [this.key(sid), JSON.stringify(stored), expires]), callback);
  }

  touch(sid, value, callback = () => {}) {
    const expires = Math.min(new Date(value.cookie.expires).getTime(), this.now() + this.config.ttlMs);
    if (!Number.isFinite(expires)) return callback(unavailable());
    this.run(connection => connection.execute('UPDATE mdm_http_sessions SET expires_at=? WHERE sid_hash=? AND expires_at>?',
      [expires, this.key(sid), this.now()]), callback);
  }

  destroy(sid, callback = () => {}) {
    this.run(connection => connection.execute('DELETE FROM mdm_http_sessions WHERE sid_hash=?', [this.key(sid)]), callback);
  }

  async close() { await this.pool.end(); }
}

module.exports = { MysqlSessionStore };
