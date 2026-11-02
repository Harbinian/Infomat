// Explicit MySQL target; inspect/dry-run read only. Apply is additive; compensate
// restores role metadata only before any new-role grant or assignment is used.
// No .env loading, startup migration, inferred appointment or source JSON edit.
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const { argumentsFor } = require('./manage-data-map-definitions');
const { inspectResponsibilities, applyResponsibilities, compensateResponsibilities } = require('../server/governanceResponsibilitiesMigration');
async function main(args = process.argv.slice(2), env = process.env) {
  const compensate = args.includes('--compensate');
  const mode = argumentsFor(args.map(arg => arg === '--compensate' ? '--apply' : arg), env);
  const pool = lazyMysqlPool(env, 1, 5000);
  try {
    const result = await withMysqlDeadline(pool, db => compensate ? compensateResponsibilities(db) : mode === '--apply' ? applyResponsibilities(db) : inspectResponsibilities(db), 120000);
    console.log(JSON.stringify(result));
    if (result.drift && result.drift.length) process.exitCode = 1;
    return result;
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => { console.error(/^RESPONSIBILITY_/.test(error.code || '') ? error.code : 'RESPONSIBILITY_MAINTENANCE_FAILED'); process.exitCode = 1; });
module.exports = { main };
