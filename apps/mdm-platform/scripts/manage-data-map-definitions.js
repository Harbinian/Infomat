// Explicit inspect/dry-run/apply, no private configuration loading or startup DDL.
// Requires a matching --target and explicit MySQL environment. Caller owns
// target authorization and backup; never use this against a default database.
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const { inspectDefinitions, applyDefinitions } = require('../server/dataMapDefinitionMigration');
function argumentsFor(args,env) {
  const modes=['--inspect','--dry-run','--apply'].filter(v=>args.includes(v));
  const target=args.indexOf('--target');
  if(modes.length!==1||args.length!==3||target<0||!['MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD'].every(k=>String(env[k]||'').trim()))throw new Error('DEFINITION_MAINTENANCE_ARGUMENT_INVALID');
  if(!/^[1-9]\d{0,4}$/.test(env.MYSQL_PORT)||Number(env.MYSQL_PORT)>65535)throw new Error('DEFINITION_MAINTENANCE_ARGUMENT_INVALID');
  if(args[target+1]!==`${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE}`)throw new Error('DEFINITION_TARGET_MISMATCH');
  return modes[0];
}
async function main(args=process.argv.slice(2),env=process.env) {
  const mode=argumentsFor(args,env),pool=lazyMysqlPool(env,1,5000);
  try {const result=await withMysqlDeadline(pool,db=>mode==='--apply'?applyDefinitions(db):inspectDefinitions(db),120000);console.log(JSON.stringify(result));if(result.drift.length)process.exitCode=1;return result;}
  finally{await pool.end();}
}
if(require.main===module)main().catch(error=>{console.error(/^DEFINITION_/.test(error.code||error.message)?error.code||error.message:'DEFINITION_MAINTENANCE_FAILED');process.exitCode=1;});
module.exports={main,argumentsFor};
