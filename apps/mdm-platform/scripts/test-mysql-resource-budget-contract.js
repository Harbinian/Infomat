// R04/R11 resource budget contract. Pure unit test: no connection is opened.
// Also the static guard that no module goes back to creating an unregistered, unbounded pool.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mysqlConfigFromEnv, poolBudget, operationTimeoutMs, POOL_DOMAINS } = require('../server/mysqlConfig');
const registry = require('../server/mysqlPoolRegistry');
const { commitResultUnknown } = require('../server/boundedMysql');

test('every queue, wait and operation bound has a value and can be overridden', () => {
  const defaults = mysqlConfigFromEnv({ MYSQL_DATABASE: 'x' }, 'identity');
  assert.equal(defaults.waitForConnections, true);
  assert.ok(Number.isInteger(defaults.queueLimit) && defaults.queueLimit > 0, 'a queue bound exists');
  assert.ok(Number.isInteger(defaults.connectTimeout) && defaults.connectTimeout > 0, 'a connect bound exists');
  assert.ok(operationTimeoutMs({}, 'identity') > 0, 'an operation bound exists');
  const overridden = mysqlConfigFromEnv({
    MYSQL_DATABASE: 'x', MYSQL_QUEUE_LIMIT: '3', MYSQL_CONNECT_TIMEOUT_MS: '1500', MYSQL_OPERATION_TIMEOUT_MS: '2500'
  }, 'identity');
  assert.equal(overridden.queueLimit, 3);
  assert.equal(overridden.connectTimeout, 1500);
  assert.equal(operationTimeoutMs({ MYSQL_OPERATION_TIMEOUT_MS: '2500' }, 'identity'), 2500);
  // Existing keys keep their meaning and their environment override.
  const explicit = mysqlConfigFromEnv({ MYSQL_DATABASE: 'x', MYSQL_CONNECTION_LIMIT: '4' }, 'identity');
  assert.equal(explicit.connectionLimit, 4);
});

test('an unknown domain cannot silently create an unbudgeted pool', () => {
  const budget = poolBudget('not_a_domain');
  assert.equal(budget.domain, 'shared');
  assert.ok(budget.queueLimit > 0, 'even an unknown label gets the default bound');
  assert.ok(Object.keys(POOL_DOMAINS).length >= 12, 'the known domain list is explicit');
});

test('registration is accounted per domain and close is idempotent', async () => {
  registry.resetPoolRegistry();
  const ended = [];
  const fake = name => ({ end: async () => { ended.push(name); } });
  registry.registerPool('identity', fake('identity-a'), mysqlConfigFromEnv({ MYSQL_DATABASE: 'x' }, 'identity'));
  registry.registerPool('identity', fake('identity-b'), mysqlConfigFromEnv({ MYSQL_DATABASE: 'x' }, 'identity'));
  registry.registerPool('audit', fake('audit-a'), mysqlConfigFromEnv({ MYSQL_DATABASE: 'x' }, 'audit'));
  assert.equal(registry.registeredPoolCount(), 3);
  const totals = registry.totalPoolBudget();
  assert.equal(totals.pools, 3);
  assert.equal(totals.domains.length, 2);
  assert.ok(totals.connections > 0 && totals.queues > 0, 'the process-wide ceiling is visible');

  const first = await registry.closeAllPools({ timeoutMs: 100 });
  const second = await registry.closeAllPools({ timeoutMs: 100 });
  assert.deepEqual(first, { closed: 3, notDrained: [] });
  assert.deepEqual(second, first, 'a second close reuses the first result instead of closing twice');
  assert.equal(ended.length, 3);
  assert.equal(registry.registeredPoolCount(), 0);
  registry.resetPoolRegistry();
});

test('a pool that will not close is reported rather than waited on forever', async () => {
  registry.resetPoolRegistry();
  registry.registerPool('terminology', { end: () => new Promise(() => {}) }, mysqlConfigFromEnv({ MYSQL_DATABASE: 'x' }, 'terminology'));
  const startedAt = Date.now();
  const result = await registry.closeAllPools({ timeoutMs: 120 });
  assert.deepEqual(result.notDrained, ['terminology']);
  assert.ok(Date.now() - startedAt < 2000, 'the drain is bounded');
  registry.resetPoolRegistry();
});

test('an unresolved commit is a distinct, non-retryable outcome', () => {
  const driver = Object.assign(new Error('ER_LOCK_WAIT_TIMEOUT'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
  const unknown = commitResultUnknown(driver);
  assert.equal(unknown.code, 'MYSQL_COMMIT_UNKNOWN');
  assert.equal(unknown.statusCode, 503);
  assert.match(unknown.message, /不能自动重试/);
  assert.equal(unknown.driverCode, 'ER_LOCK_WAIT_TIMEOUT');
  assert.ok(!unknown.message.includes('ER_LOCK_WAIT_TIMEOUT'), 'the driver text is not echoed to the caller');
});

test('no module creates an unbounded pool outside the registry', () => {
  const server = path.resolve(__dirname, '../server');
  const allowed = new Set(['mysqlPoolRegistry.js', 'boundedMysql.js']);
  const offenders = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js') || allowed.has(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf8');
      if (/mysql\.createPool\(/.test(source)) offenders.push(path.relative(server, full));
    }
  })(server);
  assert.deepEqual(offenders, [], 'every pool is created through the registry so it can be bounded and drained');
});
