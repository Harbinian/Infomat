// Explicit already-migrated target. No DDL, person creation or private env loading.
const {argumentsFor}=require('./manage-data-map-definitions');
const {lazyMysqlPool}=require('../server/boundedMysql');
const {hashPassword}=require('../server/auth');
const {bootstrapSystemAdmin}=require('../server/systemAdminIdentity');
async function main(args=process.argv.slice(2),env=process.env) {
  if(argumentsFor(args,env)!=='--apply')throw Object.assign(new Error('apply required'),{code:'SYSTEM_ADMIN_BOOTSTRAP_APPLY_REQUIRED'});
  const password=String(env.MDM_SYSTEM_ADMIN_PASSWORD||''),basis=String(env.MDM_SYSTEM_ADMIN_AUTHORIZATION_BASIS||'').trim();
  if(password.length<12||!basis)throw Object.assign(new Error('input required'),{code:'SYSTEM_ADMIN_BOOTSTRAP_INPUT_INVALID'});
  const pool=lazyMysqlPool(env,1,5000);
  try {const result=await bootstrapSystemAdmin(pool,{passwordHash:hashPassword(password),authorizationBasis:basis});console.log(JSON.stringify(result));return result;}
  finally {await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error(/^SYSTEM_ADMIN_/.test(e.code||'')?e.code:'SYSTEM_ADMIN_BOOTSTRAP_FAILED');process.exitCode=1;});
module.exports={main};
