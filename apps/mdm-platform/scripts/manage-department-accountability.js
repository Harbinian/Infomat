// Explicit target only; never load private configuration or appoint people.
const { lazyMysqlPool,withMysqlDeadline }=require('../server/boundedMysql');
const { argumentsFor }=require('./manage-data-map-definitions');
const policy=require('../server/departmentAccountabilityMigration');
async function main(args=process.argv.slice(2),env=process.env){
  const compensate=args.includes('--compensate');
  const mode=argumentsFor(args.map(arg=>arg==='--compensate'?'--apply':arg),env);
  const pool=lazyMysqlPool(env,1,5000);
  try{
    const result=await withMysqlDeadline(pool,db=>compensate?policy.compensateDepartmentAccountabilityPolicy(db):mode==='--apply'?policy.applyDepartmentAccountabilityPolicy(db):policy.inspectDepartmentAccountabilityPolicy(db),120000);
    console.log(JSON.stringify(result));if(result.drift?.length)process.exitCode=1;return result;
  }finally{await pool.end();}
}
if(require.main===module)main().catch(error=>{console.error(/^DEPARTMENT_ACCOUNTABILITY_/.test(error.code||'')?error.code:'DEPARTMENT_ACCOUNTABILITY_MAINTENANCE_FAILED');process.exitCode=1;});
module.exports={main};
