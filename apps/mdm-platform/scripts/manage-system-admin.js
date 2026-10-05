// Injected env only, accurate --target; inspect/dry-run/apply, no account creation.
const {lazyMysqlPool,withMysqlDeadline}=require('../server/boundedMysql');
const {argumentsFor}=require('./manage-data-map-definitions');
const {inspectSystemAdmin,applySystemAdmin}=require('../server/systemAdminMigration');
async function main(args=process.argv.slice(2),env=process.env) {
  const mode=argumentsFor(args,env),pool=lazyMysqlPool(env,1,5000);
  try {const result=await withMysqlDeadline(pool,db=>mode==='--apply'?applySystemAdmin(db):inspectSystemAdmin(db),120000);
    console.log(JSON.stringify(result));if(result.drift.length)process.exitCode=1;return result;
  } finally {await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error(/^SYSTEM_ADMIN_/.test(e.code||'')?e.code:'SYSTEM_ADMIN_MAINTENANCE_FAILED');process.exitCode=1;});
module.exports={main};
