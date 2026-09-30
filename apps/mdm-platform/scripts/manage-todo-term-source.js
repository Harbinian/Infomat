// Explicit inspect/apply/rollback; injected environment, exact target required.
// Never reads private env files. Writes only on --apply or --rollback.
const { assertRuntimeConfig } = require('../server/runtimeBoundary');
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const { manageTodoTermSource } = require('../server/todoTermSourceMigration');

function parseArgs(args, env) {
  if (args.length !== 3 || !['--inspect', '--apply', '--rollback'].includes(args[0]) || args[1] !== '--target') throw new Error('TODO_TERM_MIGRATION_ARGUMENT_INVALID');
  assertRuntimeConfig(env);
  if (env.MDM_ALLOW_LEGACY_TEST_MODE === '1') throw new Error('TODO_TERM_MIGRATION_REQUIRES_MYSQL');
  if (args[2] !== `${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE}`) throw new Error('TODO_TERM_TARGET_CONFIRMATION_REQUIRED');
  return args[0].slice(2);
}
async function main(args = process.argv.slice(2), env = process.env) {
  const action = parseArgs(args, env);
  const pool = lazyMysqlPool(env, 1, 5000);
  try { console.log(JSON.stringify(await withMysqlDeadline(pool, db => manageTodoTermSource(db, action), 30000))); }
  finally { await pool.end(); }
}
if (require.main === module) main().catch(error => {
  console.error(/^(TODO_TERM_|MDM_|MYSQL_)/.test(error.message) ? error.message.split(':')[0] : 'TODO_TERM_MIGRATION_FAILED');
  process.exitCode = 1;
});
module.exports = { parseArgs, main };
