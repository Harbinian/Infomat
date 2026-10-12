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
  const expiresAt = Date.now() + timeoutMs;
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
        if (expired) throw deadlineError();
        const result = await operation(connection);
        if (expired) throw deadlineError();
        committing = true;
        try {
          await connection.commit();
        } catch (error) {
          if (!expired) { expired = true; connection.destroy(); }
          throw error.code === 'MYSQL_COMMIT_UNKNOWN' ? error : commitResultUnknown(error);
        }
        return result;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          if (connection) connection.destroy();
          reject(committing ? commitResultUnknown(deadlineError()) : deadlineError());
        }, timeoutMs);
      })
    ]);
  } catch (error) {
    // A commit that already reported "unknown" is not rolled back: the outcome is the database's
    // to decide, and a rollback here would only add a second guess.
    if (!committing && connection && !expired) {
      // Cleanup must share the original deadline; a stalled rollback cannot keep the caller open.
      await Promise.race([connection.rollback().catch(() => {}), new Promise(resolve => {
        clearTimeout(timer);
        timer = setTimeout(() => { expired = true; connection.destroy(); resolve(); }, Math.max(0, expiresAt - Date.now()));
      })]);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (connection && !expired) { try { connection.release(); } catch { /* a destroyed connection has nothing to release */ } }
  }
}

function lazyMysqlPool(env, connectionLimit, timeoutMs, { queueLimit = 0, operationTimeoutMs = null } = {}) {
  let pool;
  return {
    getConnection(options) {
      if (!pool) {
        const { mysqlConfigFromEnv } = require('./mysqlConfig');
        pool = require('mysql2/promise').createPool({ ...mysqlConfigFromEnv(env),
          connectionLimit, waitForConnections: queueLimit > 0, queueLimit, connectTimeout: timeoutMs });
        if (operationTimeoutMs !== null) pool = boundMysqlPool(pool, operationTimeoutMs);
      }
      return pool.getConnection(options);
    },
    cancelActive(error) { if (pool && pool.cancelActive) pool.cancelActive(error); },
    async end() { if (pool) await pool.end(); }
  };
}

function deadlineError() {
  return Object.assign(new Error('数据服务响应超时'), { code: 'MYSQL_DEADLINE', statusCode: 503 });
}

// Wrap the actual runtime pool, rather than requiring each repository to opt in. A checkout's
// budget starts before acquisition and covers every statement and transaction on that lease.
// The underlying driver connection is never returned while a timed-out command may still run.
function boundMysqlPool(pool, timeoutMs) {
  const active = new Set();
  async function acquire({ signal = null } = {}) {
    let connection;
    let terminal = null;
    let committing = false;
    let released = false;
    let timer;
    let rejectDeadline;
    let onAbort;
    const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
    // A lease can expire between statements, when no caller is racing the promise.
    deadline.catch(() => {});
    const destroy = error => {
      if (terminal || released) return;
      terminal = error;
      active.delete(cancel);
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
      if (connection) connection.destroy();
      rejectDeadline(error);
    };
    const cancel = error => destroy(committing ? commitResultUnknown(error) : error);
    active.add(cancel);
    timer = setTimeout(() => destroy(committing ? commitResultUnknown(deadlineError()) : deadlineError()), timeoutMs);
    if (signal) {
      onAbort = () => destroy(signal.reason instanceof Error ? signal.reason : deadlineError());
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
    try {
      connection = await Promise.race([Promise.resolve().then(() => pool.getConnection()).then(value => {
        if (terminal) { value.release(); throw terminal; }
        return value;
      }), deadline]);
      if (terminal) { connection.release(); connection = null; throw terminal; }
    } catch (error) {
      active.delete(cancel); clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
      if (error.message === 'Queue limit reached.') throw Object.assign(new Error('数据服务请求过多，请稍后重试'), { code: 'MYSQL_BUSY', statusCode: 503 });
      if (error.message === 'Pool is closed.') throw Object.assign(new Error('数据服务正在关闭'), { code: 'MYSQL_POOL_CLOSING', statusCode: 503 });
      throw error;
    }
    const lease = Object.create(connection);
    const run = async (method, args) => {
      if (terminal) throw terminal;
      if (released) throw Object.assign(new Error('数据连接已释放'), { code: 'MYSQL_CONNECTION_CLOSED' });
      return await Promise.race([Promise.resolve().then(() => { if (terminal) throw terminal; return connection[method](...args); }), deadline]);
    };
    for (const method of ['query', 'execute', 'ping', 'beginTransaction']) {
      if (typeof connection[method] === 'function') lease[method] = (...args) => run(method, args);
    }
    lease.commit = async () => {
      if (terminal) throw terminal;
      committing = true;
      try { return await run('commit', []); }
      catch (error) {
        const unknown = error.code === 'MYSQL_COMMIT_UNKNOWN' ? error : commitResultUnknown(error);
        destroy(unknown);
        throw unknown;
      } finally { committing = false; }
    };
    lease.rollback = () => terminal || released ? Promise.resolve() : run('rollback', []);
    lease.release = () => {
      if (released) return;
      released = true;
      active.delete(cancel);
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
      if (!terminal) connection.release();
    };
    lease.destroy = () => destroy(Object.assign(new Error('数据连接已关闭'), { code: 'MYSQL_CONNECTION_CLOSED' }));
    return lease;
  }
  const bounded = Object.create(pool);
  bounded.cancelActive = error => { for (const cancel of [...active]) cancel(error); };
  bounded.getConnection = acquire;
  for (const method of ['query', 'execute']) {
    bounded[method] = async (...args) => {
      const lease = await acquire();
      try { return await lease[method](...args); }
      finally { lease.release(); }
    };
  }
  bounded.end = () => pool.end();
  return bounded;
}

module.exports = { withMysqlDeadline, withMysqlTransactionDeadline, commitResultUnknown, lazyMysqlPool, boundMysqlPool };
