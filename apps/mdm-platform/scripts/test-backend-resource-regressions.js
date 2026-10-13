// Runtime pool, transaction and cancellation regressions. Synthetic driver only; no DB socket.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
require('./testHelpers/blockRealMysql');
const { boundMysqlPool, withMysqlTransactionDeadline } = require('../server/boundedMysql');
const registry = require('../server/mysqlPoolRegistry');
const { createAbortScope } = require('../server/exportBudget');
const { loginCredentialProblem } = require('../server/httpErrorContract');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const never = () => new Promise(() => {});
function fixture(overrides = {}) {
  const state = { destroyed: 0, released: 0, committed: 0 };
  const connection = { async execute() { return [[], []]; }, async query() { return [[], []]; }, async beginTransaction() {},
    async commit() { state.committed++; }, async rollback() {}, destroy() { state.destroyed++; }, release() { state.released++; }, ...overrides };
  return { state, connection, pool: { async getConnection() { return connection; }, async end() {} } };
}

test('ordinary registered-pool statements are bounded without opting in to a helper', async () => {
  const mysql = require('mysql2/promise');
  const original = mysql.createPool;
  const fake = fixture({ execute: never });
  registry.resetPoolRegistry();
  mysql.createPool = () => fake.pool;
  try {
    const pool = registry.createRegisteredPool({ MYSQL_OPERATION_TIMEOUT_MS: '40' }, 'audit');
    await assert.rejects(pool.execute('synthetic'), { code: 'MYSQL_DEADLINE', statusCode: 503 });
    assert.equal(fake.state.destroyed, 1);
    assert.equal(fake.state.released, 0);
    await pool.end();
    assert.equal(registry.registeredPoolCount(), 0, 'failed factories cannot accumulate closed registrations');
  } finally { mysql.createPool = original; registry.resetPoolRegistry(); }
});

test('a lease deadline stops later statements and preserves the original failure during rollback', async () => {
  const fake = fixture();
  const db = await boundMysqlPool(fake.pool, 30).getConnection();
  await db.beginTransaction();
  await delay(55);
  await assert.rejects(db.commit(), { code: 'MYSQL_DEADLINE' });
  await db.rollback(); db.release();
  assert.equal(fake.state.committed, 0);
  assert.equal(fake.state.destroyed, 1);
});

test('timing out during COMMIT is unknown, both on runtime leases and transaction helpers', async () => {
  for (const helper of [false, true]) {
    const fake = fixture({ commit: never });
    const action = helper ? withMysqlTransactionDeadline(fake.pool, async () => 1, 30) : (async () => {
      const db = await boundMysqlPool(fake.pool, 30).getConnection();
      try { await db.beginTransaction(); return await db.commit(); } finally { db.release(); }
    })();
    await assert.rejects(action, { code: 'MYSQL_COMMIT_UNKNOWN', statusCode: 503 });
    assert.equal(fake.state.destroyed, 1);
  }
});

test('a late transaction body cannot submit after its deadline', async () => {
  const fake = fixture();
  await assert.rejects(withMysqlTransactionDeadline(fake.pool, () => delay(80), 20), { code: 'MYSQL_DEADLINE' });
  await delay(100);
  assert.equal(fake.state.committed, 0);
});

test('rollback itself shares the transaction deadline and preserves the original error', async () => {
  const fake = fixture({ rollback: never });
  const error = Object.assign(new Error('synthetic'), { code: 'BUSINESS_REJECTED' });
  const result = await Promise.race([
    withMysqlTransactionDeadline(fake.pool, async () => { throw error; }, 35).catch(e => e),
    delay(300).then(() => 'unbounded')
  ]);
  assert.equal(result, error);
  assert.equal(fake.state.destroyed, 1);
});

test('cancelled acquisitions release late connections without running a statement', async () => {
  const fake = fixture();
  fake.pool.getConnection = async () => { await delay(60); return fake.connection; };
  const controller = new AbortController();
  const error = Object.assign(new Error('cancelled'), { code: 'EXPORT_ABORTED' });
  const pending = boundMysqlPool(fake.pool, 100).getConnection({ signal: controller.signal });
  controller.abort(error);
  await assert.rejects(pending, { code: 'EXPORT_ABORTED' });
  await delay(80);
  assert.equal(fake.state.released, 1);
  assert.equal(fake.state.destroyed, 0);
});

test('shutdown reports rejected closers and refuses new pool registration', async () => {
  registry.resetPoolRegistry();
  const pool = registry.registerPool('audit', { end: async () => { throw new Error('synthetic'); } }, {});
  await assert.rejects(pool.end());
  assert.equal(registry.registeredPoolCount(), 1, 'a failed close remains accounted for');
  const result = await registry.closeAllPools({ timeoutMs: 50 });
  assert.deepEqual(result.notDrained, ['audit']);
  assert.equal(result.closed, 0, 'failed closes cannot be counted as drained');
  assert.throws(() => registry.registerPool('late', { end: async () => {} }, {}), { code: 'MYSQL_POOL_CLOSING' });
  registry.resetPoolRegistry();
});

test('runtime dependency close failures are bounded and returned alongside pool failures', () => {
  const { spawnSync } = require('node:child_process');
  const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
  const result = spawnSync(process.execPath, ['-r', require.resolve('./testHelpers/blockRealMysql'), '-e', `
    const assert = require('node:assert/strict');
    const app = require('./server/index');
    const registry = require('./server/mysqlPoolRegistry');
    app.locals.readiness.close = () => new Promise(() => {});
    registry.registerPool('audit', { async end() { throw new Error('synthetic'); } }, {});
    const start = Date.now();
    app.locals.closeRuntime().then(async result => {
      assert.deepEqual(result.notDrained.sort(), ['audit','readiness']);
      assert.equal(result.closed, 0);
      assert.ok(Date.now() - start < 500);
      assert.equal(await app.locals.closeRuntime(), result);
    }).catch(error => { console.error(error.code); process.exitCode = 1; });
  `], { cwd: require('node:path').resolve(__dirname, '..'), env: isolatedEnvironment({
    HOST: '127.0.0.1', MDM_ACCESS_MODE: 'http-local', MDM_SESSION_STORE: 'memory',
    SESSION_SECRET: 'synthetic-runtime-close-only', MDM_IDENTITY_READ_MODEL: 'mysql',
    PROCESS_GOVERNANCE_READ_MODEL: 'mysql', MDM_SHUTDOWN_DRAIN_MS: '35',
    MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', MYSQL_USER: 'synthetic', MYSQL_PASSWORD: 'synthetic-only', MYSQL_DATABASE: 'unreachable_test'
  }), encoding: 'utf8', timeout: 3000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});

test('commit-unknown responses preserve receipt instructions and correlation', () => {
  const res = { req: { requestId: 'synthetic-request' }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  assert.equal(require('../server/mysqlRuntimeSchema').sendMysqlUnavailable(res, { code: 'MYSQL_COMMIT_UNKNOWN' }), true);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'MYSQL_COMMIT_UNKNOWN');
  assert.equal(res.body.request_id, 'synthetic-request');
  assert.match(res.body.error, /不能自动重试/);
});

test('queue overflow is a classified capacity failure', async () => {
  const pool = boundMysqlPool({ async getConnection() { throw new Error('Queue limit reached.'); } }, 30);
  await assert.rejects(pool.execute('synthetic'), { code: 'MYSQL_BUSY', statusCode: 503 });
});

test('change-set actor projections keep safe numbers and exact BIGINT strings', async () => {
  const repo = require('../server/auditMysqlRepository').makeAuditMysqlRepository({ async execute(sql) {
    return [sql.includes('FROM mdm_change_sets') ? [
      { id: '1', entity_id: '2', operated_by_person_id: '42' },
      { id: '2', entity_id: '2', operated_by_person_id: '9007199254740993' }
    ] : []];
  } });
  const result = await repo.listEntityVersions('todo', 2);
  assert.equal(result.changeSets[0].operated_by_person_id, 42);
  assert.equal(result.changeSets[1].operated_by_person_id, '9007199254740993');
});

test('export timer cancels a stalled operation and removes listeners', async () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.writableEnded = false;
  const scope = createAbortScope(req, res, { timeoutMs: 25 });
  await assert.rejects(scope.run(never), { code: 'EXPORT_TIMEOUT', statusCode: 503 });
  scope.dispose();
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});

test('already disconnected exports and malformed credential bodies are rejected', async () => {
  const req = new EventEmitter(); req.aborted = true;
  const res = new EventEmitter(); res.writableEnded = false;
  const scope = createAbortScope(req, res, { timeoutMs: 100 });
  await assert.rejects(scope.run(async () => 1), { code: 'EXPORT_ABORTED' }); scope.dispose();
  for (const body of [null, [], 'text', 42]) assert.ok(loginCredentialProblem(body));
});

test('cancelling active work interrupts current statements while allowing cleanup to acquire', async () => {
  const fake = fixture({ execute: never });
  const pool = boundMysqlPool(fake.pool, 100);
  const db = await pool.getConnection();
  const pending = db.execute('synthetic');
  pool.cancelActive(Object.assign(new Error('stop'), { code: 'ABORTED' }));
  await assert.rejects(pending, { code: 'ABORTED' }); db.release();
  const cleanup = await pool.getConnection(); cleanup.release();
  assert.equal(fake.state.destroyed, 1);
  assert.equal(fake.state.released, 1);
});

test('the analysis loop stops a non-cooperative adapter and abandons its claim', async () => {
  let stopping = false, abandoned = 0, completed = 0;
  const repo = { async claimAnalysis() { return { run_id: '1', policy: { lease_ms: 300 } }; },
    async heartbeatAnalysis() {}, async nextAnalysisStep() { return { attempt_no: 1 }; },
    async abandonAnalysis() { abandoned++; }, async completeQueuedAnalysis() { completed++; } };
  await require('../server/analysisWorker').work(repo, 'synthetic', {
    stop: async () => stopping, pollMs: 1,
    adapter: async () => { stopping = true; return await never(); }
  });
  assert.equal(abandoned, 1);
  assert.equal(completed, 0);
});
