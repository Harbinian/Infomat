// Pure contract and cutover checks. A missed MySQL injection fails before IO.
require('./testHelpers/blockRealMysql');
const assert=require('node:assert/strict');
const {argumentsFor,main}=require('./manage-terminology-governance');
const compatibility=require('../server/terminologyGovernanceCompatibility');
const {makeTerminologyMysqlRepository}=require('../server/terminologyMysqlRepository');
const {makeConflictMysqlRepository}=require('../server/conflictMysqlRepository');
const database='stage72_isolated_'+'a'.repeat(32),env={MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'44071',MYSQL_DATABASE:database,MYSQL_USER:'synthetic',MYSQL_PASSWORD:'synthetic-only'};
const target=`${env.MYSQL_HOST}:${env.MYSQL_PORT}/${database}`;
async function mainTest(){
  assert.equal(argumentsFor(['--inspect','--target',target],env).mode,'--inspect');
  assert.equal(argumentsFor(['--dry-run','--target',target],env).mode,'--dry-run');
  for(const [args,changed]of [[[],{}],[['--apply','--target',target],{}],[['--inspect','--target',target],{NODE_ENV:'production'}],[['--inspect','--target',target],{MYSQL_DATABASE:'infomat_mdm'}],[['--inspect','--target',target],{MYSQL_HOST:'example.invalid'}],[['--inspect','--target',target],{MYSQL_PORT:'3306'}],[['--inspect','--target',target],{MYSQL_PORT:''}],[['--inspect','--target','wrong'],{}]])assert.throws(()=>argumentsFor(args,{...env,...changed}));
  const applying=argumentsFor(['--apply','--target',target,'--authorize-isolated-migration','--confirm-target',target,'--backup-sha256','b'.repeat(64),'--expected-manifest-sha256','c'.repeat(64)],env);
  assert.equal(applying.confirmDatabase,database);assert.equal(applying.authorizeIsolatedMigration,true);
  await assert.rejects(main(['--apply','--target',target],env),/TERM_MIGRATION_EXPLICIT_AUTHORIZATION_REQUIRED/);
  const previous=process.env.TERMINOLOGY_GOVERNANCE_ENABLED;process.env.TERMINOLOGY_GOVERNANCE_ENABLED='1';
  try{
    let reads=0;const repo=makeTerminologyMysqlRepository({execute(){reads++;throw Error('old SQL must not execute');}});
    for(const work of[()=>repo.createTerm({}),()=>repo.updateTerm(1,{}),()=>repo.reviewTerm(1,'approve',2),()=>repo.deleteTerm(1),()=>repo.initSchema()])await assert.rejects(work(),{code:'TERMINOLOGY_LEGACY_WRITE_RETIRED'});
    assert.equal(reads,0);
    const absent=makeTerminologyMysqlRepository({execute:async()=>[[]]});
    await assert.rejects(absent.listTerms(),{code:'TERM_GOVERNANCE_MIGRATION_REQUIRED'});
    const statements=[];
    const conflicts=makeConflictMysqlRepository({execute:async(sql)=>{statements.push(sql);if(sql.includes('FROM data_map_fields a'))return [[]];throw Error('unexpected detection IO');}});
    assert.deepEqual(await conflicts.detectConflicts(),{detected:0,terminology_mode:'suggestions_only',terminology_notice:'术语近似匹配仅供人工核对，不自动建立冲突或待办。'});
    assert(!statements.some(sql=>/terminology_terms|INSERT|UPDATE|mdm_todos/.test(sql)));
    assert.equal(compatibility.mayReadPrivate({created_by_person_id:'9007199254740993'},{personId:'9007199254740993'}),true);
    assert.equal(compatibility.mayReadPrivate({created_by_person_id:'9007199254740993'},{personId:9007199254740992}),false);
    const priorIdentity=process.env.MDM_IDENTITY_READ_MODEL;process.env.MDM_IDENTITY_READ_MODEL='mysql';
    const auth=require('../server/auth'),router=require('../server/routes/terminology'),express=require('express');
    const {syntheticSession,validateSyntheticSession}=require('./testHelpers/syntheticSession');
    auth.setIdentityRepositoryFactory(async()=>({validateSession:validateSyntheticSession,getUserEffectivePermissions:async()=>({permSet:new Set(['governance:read-global']),fieldConstraints:{}}),getDepartmentById:async()=>({id:91,name:'合成部门'})}));
    router.setTerminologyRepositoryFactory(async()=>({getTerm:async(id,scope)=>{assert.equal(scope.personId,81);return id==='101'?{id:'101',governance_term_id:'synthetic-canonical',legacy_unverified:true}:null;}}));
    const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.get('x-synthetic-session'))req.session=syntheticSession({personId:81,userId:81,departmentId:91});next();});app.use('/api/terminology',router);
    const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
    try{
      const base='http://127.0.0.1:'+server.address().port+'/api/terminology',headers={'x-synthetic-session':'yes'};
      assert.equal((await fetch(base+'/101')).status,401);
      const resolved=await fetch(base+'/101',{headers});assert.equal(resolved.status,200);assert.equal((await resolved.json()).governance_term_id,'synthetic-canonical');
      assert.equal((await fetch(base+'/999',{headers})).status,404);
      assert.equal((await fetch(base+'/9007199254740993',{headers})).status,400);
      assert.equal((await fetch(base+'/new-uuid-not-an-old-id',{headers})).status,400);
      const rejected=await fetch(base,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});assert.equal(rejected.status,409);assert.equal((await rejected.json()).code,'TERMINOLOGY_LEGACY_WRITE_RETIRED');
    }finally{await new Promise(resolve=>server.close(resolve));router.resetTerminologyRepositoryFactory();auth.resetIdentityRepositoryFactory();if(priorIdentity===undefined)delete process.env.MDM_IDENTITY_READ_MODEL;else process.env.MDM_IDENTITY_READ_MODEL=priorIdentity;}
  }finally{if(previous===undefined)delete process.env.TERMINOLOGY_GOVERNANCE_ENABLED;else process.env.TERMINOLOGY_GOVERNANCE_ENABLED=previous;}
  console.log('TERMINOLOGY_MIGRATION_CONTRACT_PASSED');
}
if(require.main===module)mainTest().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main:mainTest};
