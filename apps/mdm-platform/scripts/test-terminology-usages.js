require('./testHelpers/blockRealMysql');
const assert=require('node:assert/strict'),express=require('express');
const {syntheticSession,validateSyntheticSession}=require('./testHelpers/syntheticSession');
const auth=require('../server/auth'),router=require('../server/routes/terminologyUsages');
async function main(){
  const saved={flag:process.env.TERMINOLOGY_GOVERNANCE_ENABLED,identity:process.env.MDM_IDENTITY_READ_MODEL};process.env.MDM_IDENTITY_READ_MODEL='mysql';
  auth.setIdentityRepositoryFactory(async()=>({validateSession:validateSyntheticSession}));
  let calls=0,which='';
  const result=async(session,input)=>{calls++;assert.equal(String(session.personId),'81');assert(!Object.hasOwn(session,'cookie'));if(input.fail)throw Object.assign(Error('synthetic current input needs review'),{code:'TERM_GOVERNANCE_USAGE_STALE',statusCode:409});return {ok:true,items:[],revision_no:2};};
  router.setRepositoryFactory(async()=>({read:result,save:result,action:result,impact:result,reverse:async(session,id)=>{which=id;return result(session,{});}}));
  const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.get('x-synthetic-session'))req.session=syntheticSession({personId:81,userId:81,departmentId:91});next();});app.use('/api/terminology-governance',router);
  const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  try{
    const base='http://127.0.0.1:'+server.address().port+'/api/terminology-governance',headers={'x-synthetic-session':'yes','Content-Type':'application/json'};
    assert.equal((await fetch(base+'/usages')).status,401);
    process.env.TERMINOLOGY_GOVERNANCE_ENABLED='0';assert.equal((await fetch(base+'/usages',{headers}).then(r=>r.json())).enabled,false);
    assert.equal((await fetch(base+'/usages',{method:'POST',headers,body:'{}'})).status,503);assert.equal(calls,0,'off does not acquire a repository');
    process.env.TERMINOLOGY_GOVERNANCE_ENABLED='1';
    for(const path of ['/usages','/usages/actions','/usages/impacts'])assert.equal((await fetch(base+path,{method:'POST',headers,body:'{}'})).status,200);
    const failed=await fetch(base+'/usages',{method:'POST',headers,body:JSON.stringify({fail:true})});assert.equal(failed.status,409);assert.equal((await failed.json()).code,'TERM_GOVERNANCE_USAGE_STALE');
    const history=await fetch(base+'/terms/canonical-uuid/usages',{headers});assert.equal(history.status,200);assert.equal(which,'canonical-uuid');assert.equal(history.headers.get('cache-control'),'no-store');
    const probes=require('../server/readiness').requiredProbes({...process.env,TERMINOLOGY_GOVERNANCE_ENABLED:'1'});assert(probes.some(s=>s.includes('tg_usage_heads')));assert(probes.some(s=>s.includes('tg_term_versions')));
    assert(!require('../server/readiness').requiredProbes({...process.env,TERMINOLOGY_GOVERNANCE_ENABLED:'0'}).some(s=>s.includes('tg_')));
    const naming=require('../server/dataMapMysqlRepository').makeDataMapMysqlRepository({execute:async sql=>{
      assert(!sql.includes('FROM data_map_terms'),'old semantic dictionary is no longer an authority');
      assert(sql.includes('FROM data_map_naming_rules'));return [[{rule_type:'contains',match_value:'BAD_FORMAT',replacement_value:null,severity:'block'},{rule_type:'forbidden',match_value:'旧词',replacement_value:'规范词',severity:'block'}]];
    }});
    const suggestion=await naming.validateFieldName('旧词');assert.equal(suggestion.allowed,true);assert.equal(suggestion.issues[0].issue_type,'terminology_suggestion');
    assert.equal((await naming.validateFieldName('旧词BAD_FORMAT')).allowed,false,'technical naming constraints remain independent');
    console.log('TERMINOLOGY_USAGE_HTTP_PASSED: auth, disabled no DB, exact session, read/write/impact routes, 409, no-store and conditional readiness');
  }finally{await new Promise(resolve=>server.close(resolve));router.setRepositoryFactory(null);auth.resetIdentityRepositoryFactory();if(saved.flag===undefined)delete process.env.TERMINOLOGY_GOVERNANCE_ENABLED;else process.env.TERMINOLOGY_GOVERNANCE_ENABLED=saved.flag;if(saved.identity===undefined)delete process.env.MDM_IDENTITY_READ_MODEL;else process.env.MDM_IDENTITY_READ_MODEL=saved.identity;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
