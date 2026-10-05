// Explicit target + inspect/dry-run/apply. Additive DDL only, no startup DDL, env files or backfill.
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const { argumentsFor } = require('./manage-data-map-definitions');
const { inspectAuthoring, applyAuthoring } = require('../server/processV7AuthoringMigration');
async function main(args = process.argv.slice(2), env = process.env) {
  const mode = argumentsFor(args, env), pool = lazyMysqlPool(env, 1, 5000);
  try {
    const result = await withMysqlDeadline(pool, db => mode === '--apply' ? applyAuthoring(db) : inspectAuthoring(db), 120000);
    console.log(JSON.stringify(result)); if (result.drift.length) process.exitCode = 1; return result;
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(e => { console.error(/^V7_AUTHORING_/.test(e.code || '') ? e.code : 'V7_AUTHORING_MAINTENANCE_FAILED'); process.exitCode = 1; });
module.exports = { main };
