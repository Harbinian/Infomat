// Explicit isolated-target inspection/dry-run or additive apply. Never loads .env,
// connects to a default/formal database, updates a source row or starts a service.
// Apply requires authorization, an exact target confirmation and backup digest.
// Turning the runtime flag off never downgrades or deletes new versions/usages.
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const migration = require('../server/terminologyGovernanceMigration');
function argumentsFor(args,env) {
  const allowed=new Set(['--inspect','--dry-run','--apply','--target','--confirm-target','--authorize-isolated-migration','--backup-sha256','--expected-manifest-sha256']);
  const modes=args.filter(a=>['--inspect','--dry-run','--apply'].includes(a));
  const values={};
  for(let i=0;i<args.length;i++) {
    const key=args[i];
    if(!allowed.has(key) || Object.hasOwn(values,key)) throw new Error('TERM_MIGRATION_ARGUMENT_INVALID');
    if(['--target','--confirm-target','--backup-sha256','--expected-manifest-sha256'].includes(key)) {if(!args[i+1] || args[i+1].startsWith('--')) throw new Error('TERM_MIGRATION_ARGUMENT_INVALID');values[key]=args[++i];}
    else values[key]=true;
  }
  if(modes.length!==1 || env.NODE_ENV==='production' || !['MYSQL_HOST','MYSQL_PORT','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE'].every(k=>String(env[k]||'').trim())) throw new Error('TERM_MIGRATION_EXPLICIT_ISOLATED_TARGET_REQUIRED');
  migration.isolatedTarget(env.MYSQL_DATABASE);
  if(!['127.0.0.1','localhost','::1'].includes(env.MYSQL_HOST) || !/^[1-9]\d{0,4}$/.test(env.MYSQL_PORT) || Number(env.MYSQL_PORT)>65535 || [3000,3001,3306,3307,5173,63805].includes(Number(env.MYSQL_PORT))) throw new Error('TERM_MIGRATION_FORMAL_TARGET_FORBIDDEN');
  const expected=`${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE}`;
  if(values['--target']!==expected) throw new Error('TERM_MIGRATION_TARGET_MISMATCH');
  if(modes[0]==='--apply') {
    if(!values['--authorize-isolated-migration'] || values['--confirm-target']!==expected || !/^[a-f0-9]{64}$/.test(values['--backup-sha256']||'') || !/^[a-f0-9]{64}$/.test(values['--expected-manifest-sha256']||'')) throw new Error('TERM_MIGRATION_EXPLICIT_AUTHORIZATION_REQUIRED');
  } else if(values['--authorize-isolated-migration'] || values['--confirm-target'] || values['--backup-sha256'] || values['--expected-manifest-sha256']) throw new Error('TERM_MIGRATION_ARGUMENT_INVALID');
  return {mode:modes[0],database:env.MYSQL_DATABASE,confirmDatabase:values['--confirm-target']===expected?env.MYSQL_DATABASE:null,authorizeIsolatedMigration:values['--authorize-isolated-migration']===true,backupSha256:values['--backup-sha256'],expectedManifestDigest:values['--expected-manifest-sha256']};
}
async function main(args=process.argv.slice(2),env=process.env) {
  const options=argumentsFor(args,env),pool=lazyMysqlPool({...env,MYSQL_CONNECTION_LIMIT:'1'},1,5000);
  try {
    const result=await withMysqlDeadline(pool,db=>options.mode==='--apply'?migration.applyTerminologyGovernance(db,options):migration.inspectTerminologyGovernance(db,options),120000);
    console.log(JSON.stringify(result));
    if(result.drift.length || result.issues.some(i=>i.blocking)) process.exitCode=1;
    return result;
  } finally {await pool.end();}
}
if(require.main===module) main().catch(error=>{console.error(/^TERM_MIGRATION_/.test(error.code||error.message)?error.code||error.message:'TERM_MIGRATION_FAILED');process.exitCode=1;});
module.exports={argumentsFor,main};
