// Pure fixtures and SQL spies. No private configuration, network or database.
const assert = require('node:assert/strict');
const { sessionConfig } = require('../server/sessionConfig');
const { withMysqlDeadline } = require('../server/boundedMysql');
const { createReadiness, requiredProbes } = require('../server/readiness');
const { SESSION_SCHEMA_SQL } = require('../server/sessionMigration');
const { parseArgs } = require('./manage-sessions');
const { verifyOwner } = require('./mdm-service');

const env = { NODE_ENV: 'production', HOST: '127.0.0.1', MDM_ACCESS_MODE: 'https-proxy',
  MDM_PUBLIC_ORIGIN: 'https://isolated.example.invalid', MDM_TRUST_PROXY: '127.0.0.2/32',
  SESSION_SECRET: 'synthetic-test-only-session-secret-32-bytes', MDM_IDENTITY_READ_MODEL: 'mysql',
  PROCESS_GOVERNANCE_READ_MODEL: 'mysql', MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1',
  MYSQL_USER: 'synthetic', MYSQL_PASSWORD: 'synthetic', MYSQL_DATABASE: 'isolated', MDM_READY_TIMEOUT_MS: '100', MDM_READY_CACHE_MS: '1000' };

async function main() {
  assert.equal(sessionConfig(env).name, '__Host-infomat.mdm.sid');
  for (const change of [{ MDM_SESSION_STORE: 'memory' }, { MDM_ACCESS_MODE: 'http-local' }, { SESSION_SECRET: 'short' },
    { ALLOW_INSECURE_SESSION_SECRET: '1' }, { MDM_TRUST_PROXY: 'true' }, { MDM_TRUST_PROXY: '1' },
    { MDM_TRUST_PROXY: '0.0.0.0/0' }, { MDM_TRUST_PROXY: '::/0' }, { MDM_TRUST_PROXY: '127.0.0.1/33' },
    { MDM_TRUST_PROXY: '' }, { MDM_PUBLIC_ORIGIN: 'http://local.test' }, { MDM_PUBLIC_ORIGIN: 'https://local.test/path' }]) {
    assert.throws(() => sessionConfig({ ...env, ...change }));
  }
  assert.throws(() => parseArgs(['--apply'], env));
  assert.throws(() => parseArgs(['--apply', '--target', 'real:3306/shared'], env));
  assert.equal(parseArgs(['--inspect', '--target', '127.0.0.1:1/isolated'], env).action, 'inspect');
  let clock = Date.now(), calls = [], destroyed = 0, failure = false;
  const connection = {
    async execute(sql) {
      calls.push(sql);
      assert.match(sql.trim(), /^(SELECT|SHOW)\b/);
      if (failure) throw new Error('synthetic sensitive details must not escape');
      if (sql.startsWith('SHOW CREATE')) return [[{ 'Create Table': SESSION_SCHEMA_SQL }]];
      return [[{ migration_key: 'present', TABLE_NAME: 'mdm_http_sessions' }]];
    }, release() {}, destroy() { destroyed++; }
  };
  const pool = { async getConnection() { return connection; }, async end() {} };
  const readiness = createReadiness({ env, pool, version: { sourceDigest: 'synthetic' }, now: () => clock });
  const responses = await Promise.all(Array.from({ length: 25 }, () => readiness.check()));
  assert.ok(responses.every(r => r.ready));
  assert.equal(calls.filter(sql => sql === 'SELECT 1').length, 1, 'concurrent checks must share a probe');
  await readiness.check(); assert.equal(calls.filter(sql => sql === 'SELECT 1').length, 1);
  failure = true; clock += 1001;
  const failed = await readiness.check(); assert.equal(failed.ready, false); assert.ok(!JSON.stringify(failed).includes('sensitive'));
  failure = false; clock += 1001; assert.equal((await readiness.check()).ready, true);
  readiness.stop(); assert.equal((await readiness.check()).reason, 'STOPPING');
  const invalid = createReadiness({ env: { ...env, PROCESS_GOVERNANCE_READ_MODEL: 'sqlite' }, pool });
  assert.equal((await invalid.check()).reason, 'CONFIG_INVALID');
  assert.equal((await createReadiness({ env: { ...env, PROCESS_V7_FORMAL_ENABLED: '1' }, pool }).check()).reason, 'CONFIG_INVALID');
  assert.ok(!requiredProbes(env).some(sql => sql.includes('process_data_governance_')));
  assert.ok(requiredProbes({ ...env, PROCESS_DATA_GOVERNANCE_ENABLED: '1' }).some(sql => sql.includes('process_data_governance_')));
  await assert.rejects(withMysqlDeadline(pool, () => new Promise(() => {}), 20), /超时/);
  assert.equal(destroyed, 1);
  const latePool = { getConnection: () => new Promise(resolve => setTimeout(() => resolve(connection), 40)) };
  await assert.rejects(withMysqlDeadline(latePool, () => { throw Error('late query must not execute'); }, 10));
  await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(destroyed, 2);
  const paths = { appRoot: 'isolated-root', entry: 'isolated-entry', supervisorEntry: 'isolated-owner' };
  const state = { ...paths, supervisor: { pid: 10, created: 'one' }, child: { pid: 11, created: 'two' } };
  assert.throws(() => verifyOwner(paths, state, () => ({ matches: false })), /OWNER/);
  assert.throws(() => verifyOwner(paths, state, () => ({ matches: true, created: 'reused-pid' })), /OWNER/);
  console.log('STAGE03_RUNTIME_UNIT_PASS: proxy/config, target guard, readiness coalescing/cache/recovery, timeout cancellation, process ownership');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
