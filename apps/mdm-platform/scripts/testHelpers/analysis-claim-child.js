// Test-only owned-MySQL claimant. IPC carries the ephemeral token; never stdout/logs.
const { lazyMysqlPool } = require('../../server/boundedMysql');
const { makeDataMapDefinitionRepository } = require('../../server/dataMapDefinitionRepository');
const crypto = require('node:crypto');
if (process.env.NODE_ENV !== 'test' || !process.send) throw Error('TEST_IPC_REQUIRED');
const pool = lazyMysqlPool(process.env, 1, 5000);
process.once('message', async () => {
  try { process.send({ claim: await makeDataMapDefinitionRepository(pool).claimAnalysis(crypto.randomUUID()) }); }
  catch (e) { process.send({ error: e.code || 'FAILED' }); }
  finally { await pool.end(); process.disconnect(); }
});
process.send({ ready: true });
