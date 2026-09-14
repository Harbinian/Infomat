const { compareCreateStatements } = require('./processV7M0Baseline');
const MIGRATION_KEY = '2026-09-10-mdm-http-sessions-v1';
const SESSION_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS mdm_http_sessions (
  sid_hash CHAR(64) NOT NULL,
  session_json JSON NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (sid_hash),
  INDEX idx_mdm_http_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin`;

async function inspectSessionSchema(connection) {
  const [tables] = await connection.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mdm_http_sessions'");
  const [records] = await connection.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  if (!tables.length) return { state: records.length ? 'drift' : 'absent', matching: false, recorded: records.length > 0 };
  const [creates] = await connection.execute('SHOW CREATE TABLE mdm_http_sessions');
  const actual = creates[0]['Create Table'];
  const matching = compareCreateStatements(SESSION_SCHEMA_SQL, actual).matching && /ENGINE=InnoDB/i.test(actual) && /COLLATE[= ]+ascii_bin/i.test(actual);
  return { state: matching ? (records.length ? 'applied' : 'unrecorded') : 'drift', matching, recorded: records.length > 0 };
}

async function manageSessionSchema(connection, action) {
  const before = await inspectSessionSchema(connection);
  if (action === 'inspect') return before;
  if (before.state === 'drift') throw new Error('SESSION_SCHEMA_DRIFT: stop and compare structure; no automatic repair');
  if (action === 'apply') {
    if (before.state === 'applied') return before;
    if (before.state === 'unrecorded') {
      const [counts] = await connection.execute('SELECT COUNT(*) AS count FROM mdm_http_sessions');
      if (Number(counts[0].count) !== 0) throw new Error('SESSION_SCHEMA_UNRECORDED_NONEMPTY');
    } else await connection.execute(SESSION_SCHEMA_SQL);
    // DDL commits independently in MySQL. On interruption, a matching EMPTY
    // unrecorded table can be resumed explicitly through apply; never rebuilt.
    await connection.execute('INSERT INTO schema_migrations (migration_key) VALUES (?)', [MIGRATION_KEY]);
    return inspectSessionSchema(connection);
  }
  if (action === 'rollback') {
    if (before.state === 'absent') return before;
    const [counts] = await connection.execute('SELECT COUNT(*) AS count FROM mdm_http_sessions');
    if (Number(counts[0].count) !== 0) throw new Error('SESSION_ROLLBACK_NONEMPTY: retain sessions and stop');
    await connection.execute('DROP TABLE mdm_http_sessions');
    await connection.execute('DELETE FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
    return { state: 'absent' };
  }
  throw new Error('SESSION_MIGRATION_ACTION_INVALID');
}

async function cleanupSessions(connection, { apply = false, now = Date.now(), limit = 1000 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('SESSION_CLEANUP_LIMIT_INVALID');
  if (!apply) {
    const [rows] = await connection.execute('SELECT COUNT(*) AS count FROM mdm_http_sessions WHERE expires_at<=?', [now]);
    return { expired: Number(rows[0].count), deleted: 0, limit };
  }
  const [result] = await connection.execute(`DELETE FROM mdm_http_sessions WHERE expires_at<=? ORDER BY expires_at LIMIT ${limit}`, [now]);
  return { deleted: result.affectedRows, limit };
}

module.exports = { MIGRATION_KEY, SESSION_SCHEMA_SQL, inspectSessionSchema, manageSessionSchema, cleanupSessions };
