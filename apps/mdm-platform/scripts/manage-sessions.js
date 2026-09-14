// Explicit maintenance only. Reads injected environment; never reads a private
// env file. --target must exactly match host:port/database before any connection.
const { assertRuntimeConfig } = require('../server/runtimeBoundary');
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const { manageSessionSchema, cleanupSessions } = require('../server/sessionMigration');

function parseArgs(args, env) {
  const allowed = new Set(['--inspect', '--apply', '--rollback', '--cleanup', '--target', '--limit']);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error('SESSION_MAINTENANCE_ARGUMENT_INVALID');
    if (['--target', '--limit'].includes(args[i])) i += 1;
  }
  assertRuntimeConfig(env);
  if (env.MDM_ALLOW_LEGACY_TEST_MODE === '1') throw new Error('SESSION_MAINTENANCE_REQUIRES_MYSQL');
  const target = `${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE}`;
  if (args[args.indexOf('--target') + 1] !== target || !args.includes('--target')) throw new Error('SESSION_TARGET_CONFIRMATION_REQUIRED: pass --target host:port/database');
  const modes = ['--inspect', '--apply', '--rollback'].filter(x => args.includes(x));
  if (modes.length !== 1 || (args.includes('--cleanup') && modes[0] === '--rollback')) throw new Error('SESSION_MAINTENANCE_ACTION_INVALID');
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 1000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('SESSION_CLEANUP_LIMIT_INVALID');
  return { action: modes[0].slice(2), cleanup: args.includes('--cleanup'), limit };
}

async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseArgs(args, env);
  const pool = lazyMysqlPool(env, 1, 5000);
  try {
    const result = await withMysqlDeadline(pool, async connection => {
      if (options.cleanup) return cleanupSessions(connection, { apply: options.action === 'apply', limit: options.limit });
      return manageSessionSchema(connection, options.action);
    }, 30000);
    console.log(JSON.stringify(result));
  } finally { await pool.end(); }
}

if (require.main === module) main().catch(error => {
  // Do not print driver messages, SQL, connection properties or session records.
  console.error(/^(SESSION_|MDM_|MYSQL_)/.test(error.message) ? error.message.split(':')[0] : 'SESSION_MAINTENANCE_FAILED');
  process.exitCode = 1;
});
module.exports = { parseArgs, main };
