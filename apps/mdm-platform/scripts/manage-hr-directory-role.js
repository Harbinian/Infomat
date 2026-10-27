// Input: explicit MySQL environment and exact --target host:port/database.
// Output: non-personal migration status. Inspect/dry-run only read metadata.
// Apply prepares v5 without granting people; compensate requires an unused role.
// Caller must authorize the exact target and retain an independently restorable
// database backup. No .env loading, source import, account or real-service startup.
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const { argumentsFor } = require('./manage-data-map-definitions');
const { inspectHrDirectoryRole, applyHrDirectoryRole, compensateHrDirectoryRole } = require('../server/hrDirectoryRoleMigration');
async function main(args = process.argv.slice(2), env = process.env) {
  const compensate = args.includes('--compensate');
  const mode = argumentsFor(args.map(arg => arg === '--compensate' ? '--apply' : arg), env);
  const pool = lazyMysqlPool(env, 1, 5000);
  try {
    const result = await withMysqlDeadline(pool, db => compensate ? compensateHrDirectoryRole(db)
      : mode === '--apply' ? applyHrDirectoryRole(db) : inspectHrDirectoryRole(db), 120000);
    console.log(JSON.stringify(result));
    if (result.drift?.length) process.exitCode = 1;
    return result;
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => { console.error(/^HR_DIRECTORY_ROLE_/.test(error.code || '') ? error.code : 'HR_DIRECTORY_ROLE_MAINTENANCE_FAILED'); process.exitCode = 1; });
module.exports = { main };
