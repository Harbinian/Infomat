// Explicit inspect/dry-run/apply with exact target and injected MySQL environment.
// Never reads env files; apply requires quiesced writers and an authorized backup.
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const { argumentsFor } = require('./manage-data-map-definitions');
const { inspectLegacyCompatibility, applyLegacyCompatibility } = require('../server/dataMapLegacyCompatibility');
async function main(args = process.argv.slice(2), env = process.env) {
  const mode = argumentsFor(args, env), pool = lazyMysqlPool(env, 1, 5000);
  try {
    const result = await withMysqlDeadline(pool, db => mode === '--apply' ? applyLegacyCompatibility(db) : inspectLegacyCompatibility(db), 120000);
    console.log(JSON.stringify(result));
    if (result.drift.length) process.exitCode = 1;
    return result;
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => {
  console.error(/^DEFINITION_/.test(error.code || error.message) ? error.code || error.message : 'DEFINITION_COMPATIBILITY_FAILED');
  process.exitCode = 1;
});
module.exports = { main };
