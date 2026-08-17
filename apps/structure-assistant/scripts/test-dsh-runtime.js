'use strict';

const assert = require('node:assert/strict');
const { createDshRuntimeManager } = require('../lib/dsh-runtime-manager');

async function main() {
  let current = Date.parse('2026-08-17T00:00:00.000Z');
  const launches = [];
  const stops = [];
  const manager = createDshRuntimeManager({
    version: '0.1.0-rc.6',
    maxInstances: 2,
    now: () => current,
    setInterval: () => ({ unref() {} }),
    clearInterval() {},
    launcher: async context => {
      launches.push(context);
      return {
        port: 41000 + launches.length,
        async stop() {
          stops.push(context.nonce);
        }
      };
    }
  });
  const first = {
    sub: 'dingshuo',
    nonce: 'first-session',
    exp: Math.floor((current + 60_000) / 1000)
  };
  const second = {
    sub: 'engineering_rd',
    nonce: 'second-session',
    exp: Math.floor((current + 120_000) / 1000)
  };
  const third = {
    sub: 'hr',
    nonce: 'third-session',
    exp: Math.floor((current + 120_000) / 1000)
  };

  assert.equal(manager.publicStatus(first).status, 'stopped');
  const started = await manager.start(first);
  assert.equal(started.status, 'running');
  assert.equal(started.dsh_version, '0.1.0-rc.6');
  assert.equal(Object.prototype.hasOwnProperty.call(started, 'port'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(started, 'nonce'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(started, 'path'), false);
  assert.equal((await manager.start(first)).status, 'running');
  assert.equal(launches.length, 1, 'same login session must reuse one runtime');

  await manager.start(second);
  await assert.rejects(
    manager.start(third),
    error => error.code === 'DSH_RUNTIME_LIMIT' && error.status === 429
  );
  assert.deepEqual(manager.accountStatuses([
    { id: 'dingshuo', displayName: '丁硕' },
    { id: 'engineering_rd', displayName: '工程技术部研发' },
    { id: 'hr', displayName: '行政人事部' }
  ]).map(item => [item.account_id, item.active_dsh_runtimes]), [
    ['dingshuo', 1],
    ['engineering_rd', 1],
    ['hr', 0]
  ]);

  await manager.stop(first);
  assert.equal(manager.publicStatus(first).status, 'stopped');
  assert.deepEqual(stops, ['first-session']);

  current += 121_000;
  await manager.cleanupExpired();
  assert.equal(manager.publicStatus(second).status, 'stopped');
  assert.deepEqual(stops, ['first-session', 'second-session']);
  await manager.close();
}

main().then(() => {
  console.log('structure-assistant DSH runtime tests passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
