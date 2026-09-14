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

module.exports = { withMysqlDeadline, lazyMysqlPool };
