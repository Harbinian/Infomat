// Real current authority/resource readers on a new owned tmpfs MySQL. HTTP
// sessions are injected synthetic identities; no existing service or config.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs'),express=require('express');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {setup,request,proof}=require('./testHelpers/dataMapHandoffConflictFixture');
const {createHandoffWorkbench}=require('../server/dataMapHandoffWorkbench');
const {createRouter}=require('../server/routes/dataMapHandoffs');
const {makeIdentityMysqlRepository}=require('../server/identityMysqlRepository');
const {handoffActor,probeHandoffActor}=require('../server/dataMapHandoffAuthority');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const responsibilities=require('../server/routes/governanceResponsibilities');
const auth=require('../server/auth'),roleWorkbench=require('../server/routes/roleWorkbench'),offices=require('../server/routes/offices');
const output=path.resolve(process.argv[2]||path.join(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-07/workbench-'+crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const checks=[];let owned,passed=false,failure,server;
const save=(name,data)=>fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2)+'\n');
async function check(name,work){await work();checks.push(name);console.log('PASS '+name);save('progress.json',{checks});}
const previous=Object.fromEntries(['MDM_IDENTITY_READ_MODEL','PROCESS_GOVERNANCE_READ_MODEL','PROCESS_DATA_GOVERNANCE_ENABLED','DATA_MAP_HANDOFF_ENABLED'].map(key=>[key,process.env[key]]));
async function main(){try{await withFreshMysql(async target=>{
  const {pool,owner,database,containerId,port}=target;owned={owner,database,containerId,port};
  await check('disabled uninstalled module explicitly reports not prepared instead of breaking the original workbench',async()=>{
    const value=await createHandoffWorkbench(pool,{}, {env:{DATA_MAP_HANDOFF_ENABLED:'0'}}).read({});
    assert.deepEqual(value.availability,{state:'not_prepared',code:'HANDOFF_SCHEMA_NOT_PREPARED'});assert.deepEqual(value.work_items,[]);
    await assert.rejects(()=>createHandoffWorkbench(pool,{}, {env:{DATA_MAP_HANDOFF_ENABLED:'1'}}).read({}),e=>e.code==='HANDOFF_SCHEMA_UNAVAILABLE');
  });
  const f=await setup(target),{repo,actors:a}=f,bench=createHandoffWorkbench(pool,repo,{env:f.env});
  await pool.execute(require('../server/mysqlSchema').splitSqlStatements(require('../server/processV7PreviewReviewMigration').PROCESS_V7_PREVIEW_SCHEMA_SQL)[0]);
  const preparation=await pool.getConnection();
  try{await require('../server/governanceResponsibilitiesMigration').applyResponsibilities(preparation);}finally{preparation.release();}
  const draft=await f.draft(701),clean=await f.draft(702);await f.fixture.packageSeed(703);
  await f.fixture.packageSeed(704,{documentId:701,sourceStatus:'superseded'});
  const conflict=await repo.createConflict(draft.handoff_id,f.conflictBody(draft),a.steward);await f.act(conflict.conflict_id,'assign',{assignee_person_id:'16'});
  const identity=makeIdentityMysqlRepository(pool),handoffRouter=createRouter({pool,env:f.env});let activeSession=a.steward;
  process.env.MDM_IDENTITY_READ_MODEL='mysql';process.env.PROCESS_GOVERNANCE_READ_MODEL='';process.env.PROCESS_DATA_GOVERNANCE_ENABLED='1';process.env.DATA_MAP_HANDOFF_ENABLED='1';
  auth.setIdentityRepositoryFactory(()=>identity);roleWorkbench.setIdentityRepositoryFactory(()=>identity);
  roleWorkbench.setHandoffWorkbenchFactory(()=>handoffRouter.workbench);offices.setRepositoryFactory(()=>({async personalWorkItems(){return[];},async closureWorkItems(){return[];}}));
  roleWorkbench.setProcessDataGovernanceRepositoryFactory(()=>require('../server/processDataGovernanceRepository').makeProcessDataGovernanceRepository(pool));
  responsibilities.setRepositoryFactory(()=>require('../server/governanceResponsibilities').makeGovernanceResponsibilitiesRepository(pool));
  const app=express();app.use((req,_res,next)=>{req.session={...activeSession};next();});app.use('/api/data-map-handoffs',handoffRouter);app.use('/api/role-workbench',roleWorkbench);app.use('/api/governance-responsibilities',responsibilities);
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const root=`http://127.0.0.1:${server.address().port}`;
  async function read(who,endpoint='/api/data-map-handoffs/workbench'){activeSession=who;const response=await fetch(root+endpoint),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;}
  const items=value=>value.work_items||value.workItems.filter(x=>x.sourceType==='data_map_handoff');
  await check('unlocked qualification probes preserve actual eligibility and mutation authority still requires current locks',async()=>{
    const connection=await pool.getConnection(),trace=[];
    const observed={execute(sql,params){trace.push(sql);return connection.execute(sql,params);}};
    try{
      await connection.beginTransaction();
      for(const actor of [a.lead,a.steward]){
        const found=await probeHandoffActor(observed,actor,'prepare',{packageId:'701',writeFields:[]});
        assert.equal(found.qualification_only,true);assert.equal(found.readOnly,true);assert.equal(found.qualificationSnapshot,null);
      }
      await assert.rejects(()=>probeHandoffActor(observed,a.unassignedSteward,'prepare',{packageId:'701',writeFields:[]}),e=>e.statusCode===403);
      await assert.rejects(()=>probeHandoffActor(observed,a.admin,'prepare',{packageId:'701',writeFields:[]}),e=>e.code==='HANDOFF_ADMIN_READ_ONLY');
      assert(trace.every(sql=>/^\s*SELECT\b/i.test(sql)&&! /\bFOR\s+(UPDATE|SHARE)\b/i.test(sql)));
      save('qualification-probe-sql.json',trace);trace.length=0;
      await assert.rejects(()=>handoffActor(observed,a.steward,'prepare',{packageId:'701',writeFields:[],lock:false}),e=>e.code==='HANDOFF_READ_ONLY');
      const locked=await handoffActor(observed,a.steward,'prepare',{packageId:'701',writeFields:[]});assert(locked.qualificationSnapshot?.qualification_digest);
      assert(trace.some(sql=>/user_accounts.*FOR UPDATE/is.test(sql)));assert(trace.some(sql=>/FOR SHARE/i.test(sql)));save('mutation-authority-sql.json',trace);
      await connection.rollback();
    }finally{connection.release();}
    const sqlTrace=[];
    const tracedPool={async getConnection(){const actual=await pool.getConnection();return new Proxy(actual,{get(target,key){if(key==='execute')return(sql,params)=>{sqlTrace.push(sql);return target.execute(sql,params);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}};
    const discovered=createDataMapHandoffRepository(tracedPool,{env:f.env});
    const value=await discovered.get(draft.handoff_id,a.lead);assert(value.allowed_actions.includes('save'));assert(value.report);
    assert(sqlTrace.length>30);assert(sqlTrace.every(sql=>/^\s*SELECT\b/i.test(sql)&&! /\bFOR\s+(UPDATE|SHARE)\b/i.test(sql)));save('draft-discovery-sql.json',sqlTrace);
  });
  await check('parallel repeated workbench discovery source upgrade and actual responsibilities endpoints do not upgrade locks or deadlock',async()=>{
    const paths=['/api/role-workbench?mode=todo','/api/role-workbench?mode=todo','/api/data-map-handoffs/workbench','/api/data-map-handoffs/source-upgrades?package_id=704&target_process_version_id=701','/api/governance-responsibilities/workbench'];
    for(const actor of [a.lead,a.steward])for(let round=0;round<3;round++){
      activeSession=actor;
      const outcomes=await Promise.allSettled(paths.map(async endpoint=>{const response=await fetch(root+endpoint),body=await response.json();return{endpoint,status:response.status,body};}));
      const results=outcomes.map(outcome=>{assert.equal(outcome.status,'fulfilled',String(outcome.reason));assert.equal(outcome.value.status,200,JSON.stringify(outcome.value));return outcome.value.body;});
      for(const result of results.slice(0,3)){const work=items(result);assert(work.some(x=>x.type==='data_map_handoff_draft'&&x.handoff_id===draft.handoff_id),'qualified draft actions must remain visible after removing write locks');}
      assert(Array.isArray(results[4].items));
    }
  });
  await check('assigned steward and lead receive exact draft and unbound legacy package selectors',async()=>{
    const value=await read(a.steward);assert.equal(value.availability.state,'available');assert.equal(value.truncated,false);
    const work=items(value);assert(work.some(x=>x.handoff_id===clean.handoff_id&&x.target===`/app/data-map-handoffs?handoff=${clean.handoff_id}`));
    assert(work.some(x=>x.package_id==='703'&&x.allowed_actions.includes('prepare_intake')&&x.target==='/app/data-map-handoffs?package=703'));
    assert.deepEqual(items(await read(a.unassignedSteward)),[]);assert.deepEqual(items(await read(a.admin)),[]);
    assert.deepEqual(items(await read(a.adminHandler)),[]);assert.deepEqual(items(await read(a.adminDecider)),[]);
  });
  await check('conflict discovery is scoped to current assignee and resolved handler work disappears immediately',async()=>{
    let value=await read(a.handler,'/api/role-workbench');assert.equal(value.handoff.availability.state,'available');assert.equal(value.handoff.actionableCount,1);
    assert(items(value).some(x=>x.conflict_id===conflict.conflict_id&&x.allowed_actions.includes('resolve')));
    assert.equal(value.summary.actionableCount,1);assert.equal(value.summary.governance.dataMapHandoffs,1);
    assert.deepEqual(items(await read(a.otherHandler)),[]);
    await f.act(conflict.conflict_id,'resolve',{resolution:'Synthetic workbench coordinated meaning'},a.handler);
    // No cache clear: the second HTTP request must remove the resolved handler
    // action despite the still-live legacy 15 second aggregate cache.
    value=await read(a.handler,'/api/role-workbench');assert.equal(value.handoff.actionableCount,0);assert.equal(value.summary.actionableCount,0);
    assert(!items(value).some(x=>x.conflict_id===conflict.conflict_id));
  });
  let fact;
  await check('directed department answer moves to exact final reviewer confirmation then MDM closure',async()=>{
    fact=await f.openFact(conflict.conflict_id,'91');let value=await read(a.contactA);
    const item=items(value).find(x=>x.fact_id===fact.fact_id);assert(item);assert.equal(item.target,`/app/data-map-handoffs?fact=${fact.fact_id}`);
    assert.deepEqual(value.packages,[]);assert.deepEqual(value.conflicts,[]);assert.equal(item.target_department_id,'91');assert(!('snapshot_json' in item));
    assert(!items(await read(a.contactB)).some(x=>x.fact_id===fact.fact_id));
    await repo.answerFact(fact.fact_id,await f.factBody(fact.fact_id,{answer_text:'Synthetic precise departmental fact',evidence_refs:proof.evidence_refs}),a.contactA);
    assert(!items(await read(a.contactA)).some(x=>x.fact_id===fact.fact_id));
    const confirm=items(await read(a.reviewerA)).find(x=>x.fact_id===fact.fact_id);assert.deepEqual(confirm.allowed_actions,['confirm']);
    assert(!items(await read(a.otherReviewerA)).some(x=>x.fact_id===fact.fact_id));
    const answered=await repo.getFact(fact.fact_id,a.reviewerA);
    await repo.confirmFact(fact.fact_id,await f.factBody(fact.fact_id,{answered_fact_version_id:answered.fact_version_id,answered_snapshot_digest:answered.snapshot_digest,...proof}),a.reviewerA);
    assert(!items(await read(a.reviewerA)).some(x=>x.fact_id===fact.fact_id));
    assert(items(await read(a.steward)).some(x=>x.fact_id===fact.fact_id&&x.allowed_actions.includes('close')));
    await repo.closeFact(fact.fact_id,await f.factBody(fact.fact_id,proof),a.steward);
    assert(!items(await read(a.steward)).some(x=>x.fact_id===fact.fact_id));
    assert((await read(a.contactA)).facts.some(x=>x.fact_id===fact.fact_id&&x.status==='closed'),'read-only original answer remains discoverable without an actionable item');
  });
  await check('only assigned escalated decision member gets a decision item and reassignment takes effect without cache clearing',async()=>{
    await f.act(conflict.conflict_id,'reopen');await f.act(conflict.conflict_id,'escalate',{decision_person_id:'17',severity:'major'},a.handler);
    assert(items(await read(a.decider,'/api/role-workbench')).some(x=>x.conflict_id===conflict.conflict_id&&x.allowed_actions.includes('decide')));
    assert.deepEqual(items(await read(a.otherDecider)),[]);
    await f.act(conflict.conflict_id,'escalate',{decision_person_id:'22'},a.handler);
    assert(!items(await read(a.decider,'/api/role-workbench')).some(x=>x.conflict_id===conflict.conflict_id));
    assert(items(await read(a.otherDecider)).some(x=>x.conflict_id===conflict.conflict_id&&x.roleHint==='decision_group'));
  });
  await check('per-resource submission approval and publication immediately change the lead work item with exact publication reverse link',async()=>{
    let current=await repo.get(clean.handoff_id,a.steward);
    await repo.submit(clean.handoff_id,request({expected_revision:Number(current.header.current_revision)}),a.steward);
    let work=items(await read(a.lead)).find(x=>x.handoff_id===clean.handoff_id&&x.type==='data_map_handoff_draft');assert(work.allowed_actions.includes('approve'));assert.equal(work.currentStatus,'submitted');
    assert(!items(await read(a.steward)).some(x=>x.handoff_id===clean.handoff_id&&x.type==='data_map_handoff_draft'));
    current=await repo.get(clean.handoff_id,a.lead);
    const approval=await repo.approve(clean.handoff_id,request({expected_revision:Number(current.header.current_revision),decision:'approved',binding_digest:current.report.binding_digest,basis:proof.basis}),a.lead);
    work=items(await read(a.lead)).find(x=>x.handoff_id===clean.handoff_id&&x.type==='data_map_handoff_draft');assert(work.allowed_actions.includes('publish'));assert.equal(work.currentStatus,'approved');
    const publication=await repo.publish(clean.handoff_id,request({expected_revision:approval.revision,approval_id:approval.approval_id}),a.lead);
    const value=await read(a.lead);assert(!items(value).some(x=>x.handoff_id===clean.handoff_id&&x.type==='data_map_handoff_draft'));
    assert(!items(value).some(x=>x.package_id==='702'&&x.type==='data_map_handoff_package'));
    const exact=value.packages.find(x=>x.package_id==='702').publications.find(x=>x.publication_id===publication.publication_id);assert.equal(exact.handoff_id,clean.handoff_id);assert.equal(Number(exact.revision),approval.revision);
  });
  await check('assignment removal auth-version change and actual disabled CHECK are not mistaken for zero work',async()=>{
    await pool.execute("DELETE FROM process_governance_responsibilities WHERE target_type='work_package' AND target_id=701");
    assert(!items(await read(a.steward)).some(x=>x.package_id==='701'));
    await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=112');
    activeSession=a.steward;let response=await fetch(root+'/api/data-map-handoffs/workbench');assert.equal(response.status,401);
    await pool.execute('UPDATE user_accounts SET auth_version=1 WHERE account_id=112');
    await pool.execute('ALTER TABLE data_map_handoff_generation_tasks ALTER CHECK chk_handoff_generation_state NOT ENFORCED');
    try{
      for(const env of [f.env,{DATA_MAP_HANDOFF_ENABLED:'0'}])await assert.rejects(()=>createHandoffWorkbench(pool,repo,{env}).read(a.lead),e=>e.code==='HANDOFF_SCHEMA_UNAVAILABLE');
      activeSession=a.lead;response=await fetch(root+'/api/role-workbench');const body=await response.json();assert.equal(response.status,503);assert.equal(body.code,'HANDOFF_SCHEMA_UNAVAILABLE');
    }finally{await pool.execute('ALTER TABLE data_map_handoff_generation_tasks ALTER CHECK chk_handoff_generation_state ENFORCED');}
    assert.equal((await bench.read(a.lead)).availability.state,'available');
  });
  await check('disabled and read-only installed modules are explicit and all discovery remains free of persistent todo or receipt writes',async()=>{
    const counts=async()=>{const [[r]]=await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_requests');const [[e]]=await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_events');return{requests:r.n,events:e.n};};
    const before=await counts();
    for(const [env,state] of [[{DATA_MAP_HANDOFF_ENABLED:'0'},'disabled'],[{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'1'},'read_only']]){
      const value=await createHandoffWorkbench(pool,repo,{env}).read(a.lead);assert.equal(value.availability.state,state);assert.deepEqual(value.work_items,[]);
    }
    await bench.read(a.lead);assert.deepEqual(await counts(),before);
  });
 },{stage:'78',randomDatabase:true});owned.cleaned=true;passed=true;
}catch(error){failure={code:error.code,message:error.message,stack:error.stack};throw error;}
finally{
  if(server)await new Promise(resolve=>server.close(resolve));auth.resetIdentityRepositoryFactory();roleWorkbench.resetIdentityRepositoryFactory();roleWorkbench.resetHandoffWorkbenchFactory();roleWorkbench.resetProcessDataGovernanceRepositoryFactory();roleWorkbench.clearWorkbenchCaches();offices.setRepositoryFactory(null);responsibilities.resetFactories();
  for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
  save('results.json',{passed,checks,groups:checks.length,owned,failure,formal_database_connected:false,formal_feature_enabled:false});console.log(output);
}}
main().catch(error=>{console.error(error);process.exitCode=1;});
