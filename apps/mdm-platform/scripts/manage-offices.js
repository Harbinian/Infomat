// Explicit additive migration; never reads private configuration or infers membership.
const {lazyMysqlPool,withMysqlDeadline}=require('../server/boundedMysql');
const {manageOfficeSchema}=require('../server/officeSchema');
async function main(args=process.argv.slice(2),env=process.env){
  const actions=['--inspect','--apply'].filter(value=>args.includes(value)),index=args.indexOf('--target');
  if(actions.length!==1||args.length!==3||index<0||!env.MYSQL_HOST||!env.MYSQL_PORT||!env.MYSQL_DATABASE||!env.MYSQL_USER||!env.MYSQL_PASSWORD)throw new Error('OFFICE_MAINTENANCE_ARGUMENT_INVALID');
  if(args[index+1]!==`${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE}`)throw new Error('OFFICE_TARGET_MISMATCH');
  const pool=lazyMysqlPool(env,1,5000);
  try{console.log(JSON.stringify(await withMysqlDeadline(pool,db=>manageOfficeSchema(db,actions[0].slice(2)),30000)));}finally{await pool.end();}
}
if(require.main===module)main().catch(error=>{console.error(/^OFFICE_/.test(error.message)?error.message:'OFFICE_MAINTENANCE_FAILED');process.exitCode=1;});
module.exports={main};
