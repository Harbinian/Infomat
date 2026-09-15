// Explicit additive maintenance. No private files or default database connections.
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const { managePublicationSchema } = require('../server/publicationSchema');

async function main(args = process.argv.slice(2), env = process.env) {
  const actions = ['--inspect', '--apply'].filter(value => args.includes(value));
  const index = args.indexOf('--target');
  if (actions.length !== 1 || args.length !== 3 || index < 0 || !env.MYSQL_HOST || !env.MYSQL_PORT || !env.MYSQL_DATABASE || !env.MYSQL_USER || !env.MYSQL_PASSWORD) throw new Error('PUBLICATION_MAINTENANCE_ARGUMENT_INVALID');
  if (args[index + 1] !== `${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE}`) throw new Error('PUBLICATION_TARGET_MISMATCH');
  const pool = lazyMysqlPool(env, 1, 5000);
  try { console.log(JSON.stringify(await withMysqlDeadline(pool, connection => managePublicationSchema(connection, actions[0].slice(2)), 30000))); }
  finally { await pool.end(); }
}
if (require.main === module) main().catch(error => { console.error(/^PUBLICATION_/.test(error.message) ? error.message : 'PUBLICATION_MAINTENANCE_FAILED'); process.exitCode = 1; });
module.exports = { main };
