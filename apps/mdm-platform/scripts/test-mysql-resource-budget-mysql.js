// R04/R11 bounded database behaviour against a real, owned, isolated MySQL.
// Pool exhaustion, lock waiting, a database that stops answering, and a commit whose result
// cannot be confirmed. Every case must be bounded, must leave no late write, and must drain.
// Usage: node scripts/test-mysql-resource-budget-mysql.js --output <new directory under artifacts/>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const registry = require('../server/mysqlPoolRegistry');
const { withMysqlDeadline, withMysqlTransactionDeadline } = require('../server/boundedMysql');

const at = process.argv.indexOf('--output');
assert(at > 0 && process.argv[at + 1], '--output is required');
const output = path.resolve(process.argv[at + 1]);
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep), 'evidence must be inside repository artifacts');
assert(!fs.existsSync(output), 'use a new evidence directory');
fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const elapsed = async fn => { const started = Date.now(); const value = await fn(); return { value, ms: Date.now() - started }; };

async function main() {
  const checks = [];
  let target;
  const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };
  try {
    await withFreshMysql(async ctx => {
      const { pool: raw, owner, database, containerId, port } = ctx;
      target = { owner, database, containerId, port, image: 'mysql:8.4', pull: 'never', tmpfs: true };
      save('owned-target.json', target);
      await raw.execute('CREATE TABLE budget_probe (id BIGINT PRIMARY KEY, note VARCHAR(64))');

      // The registry pool is the unit under test: it is the one the application would use.
      const env = { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: String(port), MYSQL_USER: 'root', MYSQL_PASSWORD: ctx.password, MYSQL_DATABASE: database, MYSQL_CONNECTION_LIMIT: '2' };
      const pool = registry.createRegisteredPool(env, 'audit');
      const budget = registry.totalPoolBudget();
      assert.equal(budget.pools, 1);
      assert.equal(budget.domains[0].connectionLimit, 2, 'the pool is capped at two connections');
      save('pool-budget.json', budget);

      const countRows = async () => Number((await raw.query('SELECT COUNT(*) AS n FROM budget_probe'))[0][0].n);

      await check('a saturated pool fails within its bound instead of queueing without end', async () => {
        const held = [await pool.getConnection(), await pool.getConnection()];
        let failure = null;
        const { ms } = await elapsed(async () => {
          try { await withMysqlTransactionDeadline(pool, connection => connection.execute('SELECT 1'), 700); }
          catch (error) { failure = error; }
        });
        assert.ok(failure, 'the third request cannot be admitted');
        assert.equal(failure.code, 'MYSQL_DEADLINE');
        assert.ok(ms < 5000, `bounded: ${ms} ms`);
        for (const connection of held) connection.release();
        assert.equal(registry.totalPoolBudget().pools, 1, 'the registry still accounts for the pool, not the waiters');
      });

      await check('a row lock that never releases fails within its bound and writes nothing', async () => {
        await raw.execute("INSERT INTO budget_probe (id, note) VALUES (1, '初始')");
        const before = await countRows();
        const blocker = await raw.getConnection();
        let failure = null;
        const { ms } = await elapsed(async () => {
          try {
            await blocker.beginTransaction();
            await blocker.execute('SELECT id FROM budget_probe WHERE id=1 FOR UPDATE');
            await withMysqlTransactionDeadline(pool, async connection => {
              await connection.execute('UPDATE budget_probe SET note=? WHERE id=1', ['迟到写入']);
            }, 700);
          } catch (error) { failure = error; } finally { await blocker.rollback().catch(() => {}); blocker.release(); }
        });
        assert.ok(failure, 'the lock wait is bounded');
        assert.ok(['MYSQL_DEADLINE', 'ER_LOCK_WAIT_TIMEOUT'].includes(failure.code), failure.code);
        assert.ok(ms < 5000, `bounded: ${ms} ms`);
        assert.equal(await countRows(), before, 'no late write appeared');
        assert.equal((await raw.query('SELECT note FROM budget_probe WHERE id=1'))[0][0].note, '初始');
      });

      await check('a database that stops answering fails within its bound and recovers', async () => {
        const docker = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
        assert.match(containerId, /^[a-f0-9]{64}$/);
        assert.equal(JSON.parse(docker(['inspect', containerId]))[0].Config.Labels['infomat.stage02'], owner, 'ownership before pause');
        docker(['pause', containerId]);
        let failure = null;
        const { ms } = await elapsed(async () => {
          try { await withMysqlDeadline(pool, connection => connection.execute('SELECT 1'), 900); }
          catch (error) { failure = error; }
        });
        assert.ok(failure, 'a paused database cannot hold the request open');
        assert.ok(ms < 8000, `bounded while paused: ${ms} ms`);
        docker(['unpause', containerId]);
        const recovered = await withMysqlDeadline(pool, connection => connection.execute('SELECT 1'), 5000);
        assert.ok(Array.isArray(recovered), 'the same pool works again after the database recovers');
        save('blackhole.json', { pausedFailure: failure.code, pausedMs: ms, recovered: true });
      });

      await check('a commit that cannot be confirmed is reported unresolved and never retried', async () => {
        const before = await countRows();
        let failure = null;
        let attempts = 0;
        try {
          await withMysqlTransactionDeadline(pool, async connection => {
            attempts += 1;
            await connection.execute("INSERT INTO budget_probe (id, note) VALUES (2, '待确认')");
            // The connection dies between the work and the commit: the outcome is genuinely unknown.
            connection.destroy();
          }, 3000);
        } catch (error) { failure = error; }
        assert.ok(failure, 'the lost receipt is surfaced');
        assert.equal(failure.code, 'MYSQL_COMMIT_UNKNOWN', failure.code);
        assert.equal(attempts, 1, 'the transaction body is never replayed automatically');
        assert.equal(await countRows(), before, 'no late write appeared');
      });

      await check('the pool drains on shutdown and reports what it closed', async () => {
        const drained = await registry.closeAllPools({ timeoutMs: 5000 });
        assert.deepEqual(drained.notDrained, []);
        assert.ok(drained.closed >= 1);
        assert.equal(registry.registeredPoolCount(), 0);
        const again = await registry.closeAllPools({ timeoutMs: 5000 });
        assert.deepEqual(again, drained, 'a second close is a no-op');
        save('drain.json', drained);
      });

      save('checks.json', { checks, database: owner });
    }, { stage: '02', randomDatabase: true });

    save('validation.json', {
      passed: true, checks, ownedIsolatedMysql: true, httpStarted: false, realWorkerStarted: false,
      deploymentVerified: false, businesoRgaeptance: false,
      budgetsAreLocalDefaultsNotConfirmedProductionCapacity: true
    });
    console.log('R04_R11_MYSQL_RESOURCE_BUDGET_PASSED');
  } catch (error) {
    save('failure.json', { message: error.message, stack: error.stack, checks, target });
    throw error;
  } finally {
    registry.resetPoolRegistry();
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
