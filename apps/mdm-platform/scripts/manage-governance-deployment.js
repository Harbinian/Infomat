// Explicit target-only CLI. Never loads private configuration, enables a runtime
// flag, activates controlled mode, starts a service or sends a notification.
const {lazyMysqlPool}=require('../server/boundedMysql');
const authorization=require('../server/governanceMigrationAuthorization');
const migration=require('../server/governanceDeploymentMigration');
function argumentsFor(args,env){
  const switches=new Set(['--inspect','--apply','--authorize-formal-migration']);
  const fields=new Set(['--target','--server-uuid','--deployment-id','--confirm-target','--backup-file','--backup-sha256','--restore-receipt-file','--restore-receipt-sha256','--authorization-reference','--write-fence-reference','--expected-manifest-sha256']);
  const values={};
  for(let index=0;index<args.length;index++){
    const key=args[index];
    if(Object.hasOwn(values,key)||(!switches.has(key)&&!fields.has(key)))throw Error('GOVERNANCE_MIGRATION_ARGUMENT_INVALID');
    if(switches.has(key))values[key]=true;
    else{if(!args[index+1]||args[index+1].startsWith('--'))throw Error('GOVERNANCE_MIGRATION_ARGUMENT_INVALID');values[key]=args[++index];}
  }
  if(Boolean(values['--inspect'])===Boolean(values['--apply']))throw Error('GOVERNANCE_MIGRATION_ARGUMENT_INVALID');
  if(!['MYSQL_HOST','MYSQL_PORT','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE'].every(key=>String(env[key]||'').trim())
    ||!/^\d{1,5}$/.test(env.MYSQL_PORT)||Number(env.MYSQL_PORT)<1||Number(env.MYSQL_PORT)>65535)throw Error('GOVERNANCE_MIGRATION_EXPLICIT_TARGET_REQUIRED');
  const target=`${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE}`;
  if(values['--target']!==target)throw Error('GOVERNANCE_MIGRATION_TARGET_MISMATCH');
  if(!/^[A-Za-z0-9_]{1,64}$/.test(env.MYSQL_DATABASE)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(values['--server-uuid']||'')
    ||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(values['--deployment-id']||''))throw Error('GOVERNANCE_MIGRATION_TARGET_REQUIRED');
  const options={database:env.MYSQL_DATABASE,serverUuid:values['--server-uuid'],deploymentId:values['--deployment-id'],mode:values['--apply']?'apply':'inspect'};
  if(options.mode==='apply'){
    if(values['--authorize-formal-migration']!==true||values['--confirm-target']!==target||!/^[a-f0-9]{64}$/.test(values['--expected-manifest-sha256']||'')
      ||!values['--authorization-reference']?.trim()||!values['--write-fence-reference']?.trim())throw Error('GOVERNANCE_MIGRATION_AUTHORIZATION_REQUIRED');
    Object.assign(options,{authorizeFormalMigration:true,authorizationReference:values['--authorization-reference'],writeFenceReference:values['--write-fence-reference'],
      backupFile:values['--backup-file'],backupSha256:values['--backup-sha256'],restoreReceiptFile:values['--restore-receipt-file'],restoreReceiptSha256:values['--restore-receipt-sha256'],expectedManifestDigest:values['--expected-manifest-sha256']});
    authorization.verifyRecoveryEvidence(options);
  }else if([...Object.keys(values)].some(key=>!['--inspect','--target','--server-uuid','--deployment-id'].includes(key)))throw Error('GOVERNANCE_MIGRATION_ARGUMENT_INVALID');
  return options;
}
async function main(args=process.argv.slice(2),env=process.env){
  const options=argumentsFor(args,env),pool=lazyMysqlPool({...env,MYSQL_CONNECTION_LIMIT:'2'},2,5000,{operationTimeoutMs:120000});
  try{
    const result=options.mode==='apply'?await migration.applyGovernanceDeployment(pool,options):await migration.inspectGovernanceDeployment(pool,options);
    console.log(JSON.stringify(result));
    if(result.applicable===false)process.exitCode=1;
    return result;
  }finally{await pool.end();}
}
if(require.main===module)main().catch(error=>{
  if(error.report)console.error(JSON.stringify(error.report));
  console.error(/^GOVERNANCE_MIGRATION_|^TERM_MIGRATION_|^HANDOFF_|^MIGRATION_SOURCE_|^PROCESS_DATA_GOVERNANCE_/.test(error.code||error.message)?error.code||error.message:'GOVERNANCE_MIGRATION_FAILED');
  process.exitCode=1;
});
module.exports={argumentsFor,main};
