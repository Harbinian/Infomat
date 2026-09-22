// Explicit MySQL target; default dry-run. No env-file loading, notifications or startup DDL.
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const { argumentsFor } = require('./manage-data-map-definitions');
const { inspectWordEvidence, applyWordEvidence } = require('../server/wordEvidenceMigration');
async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length === 2 && args[0] === '--target') args = ['--dry-run', ...args];
  const mode = argumentsFor(args, env), pool = lazyMysqlPool(env, 1, 5000);
  try {
    const result = await withMysqlDeadline(pool, db => mode === '--apply' ? applyWordEvidence(db) : inspectWordEvidence(db), 120000);
    console.log(JSON.stringify(result)); if (result.drift.length) process.exitCode = 1; return result;
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(e => { console.error(/^DEFINITION_/.test(e.code || e.message) ? e.code || e.message : 'DEFINITION_ANALYSIS_MAINTENANCE_FAILED'); process.exitCode = 1; });
module.exports = { main };
