// The deadline includes pool acquisition. Late acquisitions are destroyed, and
// an in-flight query loses its connection on timeout; no abandoned probe queue.
async function withMysqlDeadline(pool, operation, timeoutMs) {
  let connection;
  let expired = false;
  let timer;
  try {
    return await Promise.race([
      (async () => {
        connection = await pool.getConnection();
        if (expired) { connection.destroy(); throw new Error('MYSQL_DEADLINE'); }
        return operation(connection);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          if (connection) connection.destroy();
          reject(Object.assign(new Error('数据服务响应超时'), { code: 'MYSQL_DEADLINE' }));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
    if (connection && !expired) connection.release();
  }
}

// R04: a write transaction has three outcomes, not two. "Committed", "not committed" and
// "commit result unknown" are different answers, and the third must never be silently retried:
// the caller has to look the receipt up by its request identifier. The classification and its
// wording follow the existing legacy write path so the system has one meaning for it, not two.
function commitResultUnknown(error) {
  const unknown = new Error('提交回执不明，请保留原请求并核对记录，不能自动重试');
  unknown.statusCode = 503;
  unknown.code = 'MYSQL_COMMIT_UNKNOWN';
  unknown.driverCode = (error && typeof error.code === 'string') ? error.code : null;
  return unknown;
}

// Bounded transaction: acquisition, body and the commit all sit inside the deadline, and a
// transaction whose commit raised is reported as unresolved rather than rolled back and retried.
async function withMysqlTransactionDeadline(pool, operation, timeoutMs) {
  let connection;
  let expired = false;
  let committing = false;
  let timer;
  try {
    return await Promise.race([
      (async () => {
        connection = await pool.getConnection();
        if (expired) { connection.destroy(); throw new Error('MYSQL_DEADLINE'); }
        await connection.beginTransaction();
        const result = await operation(connection);
        committing = true;
        try {
          await connection.commit();
        } catch (error) {
          throw commitResultUnknown(error);
        }
        return result;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          if (connection) connection.destroy();
          reject(Object.assign(new Error('数据服务响应超时'), { code: 'MYSQL_DEADLINE' }));
        }, timeoutMs);
      })
    ]);
  } catch (error) {
    // A commit that already reported "unknown" is not rolled back: the outcome is the database's
    // to decide, and a rollback here would only add a second guess.
    if (!committing && connection && !expired) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    if (connection && !expired) { try { connection.release(); } catch { /* a destroyed connection has nothing to release */ } }
  }
}

function lazyMysqlPool(env, connectionLimit, timeoutMs, { queueLimit = 0 } = {}) {
  let pool;
  return {
    getConnection() {
      if (!pool) {
        const { mysqlConfigFromEnv } = require('./mysqlConfig');
        pool = require('mysql2/promise').createPool({ ...mysqlConfigFromEnv(env),
          connectionLimit, waitForConnections: queueLimit > 0, queueLimit, connectTimeout: timeoutMs });
      }
      return pool.getConnection();
    },
    async end() { if (pool) await pool.end(); }
  };
}

module.exports = { withMysqlDeadline, withMysqlTransactionDeadline, commitResultUnknown, lazyMysqlPool };
