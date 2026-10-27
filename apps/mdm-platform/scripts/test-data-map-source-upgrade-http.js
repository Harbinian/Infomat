// Q9 real session/CSRF API tests, fresh owned loopback tmpfs MySQL only.
// Synthetic fixed sources and explicit native new-package review; no activation.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const {setup,request:bodyRequest}=require('./testHelpers/dataMapSourceUpgradeFixture');
const root=path.resolve(__dirname,'../../..'),output=path.resolve(process.argv[2]||path.join(root,'artifacts/mdm-data-governance-handoff-implementation-20261020-05/upgrade-http-'+crypto.randomUUID()));
assert(output.startsWith(path.join(root,'artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const save=(n,x)=>fs.writeFileSync(path.join(output,n),JSON.stringify(x,null,2)+'\n');
const frontend=path.join(output,'api-only-frontend');fs.mkdirSync(frontend);fs.writeFileSync(path.join(frontend,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>API isolation fixture</title><main>隔离 API 验证</main></html>');
const checks=[],exchanges=[];let state,owned,passed=false,failure;
async function seed(target){
 const {pool,owner,database}=target;
 for(const sql of require('../server/dataMapDefinitionSchema').statements())await pool.execute(sql);
 await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)',[require('../server/dataMapDefinitionSchema').MIGRATION_KEY]);
 for(const sql of require('../server/mysqlSchema').splitSqlStatements(require('../server/governanceResponsibilitiesMigration').SCHEMA_SQL))await pool.execute(sql);
 await require('../server/dataMapHandoffSchema').applyHandoffSchema(pool,{owner,database});
 await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled',cutover_epoch=1 WHERE control_id=1");
 state=await setup(target,{preseeded:true,lead:{personId:'82',accountId:'182',authVersion:'1'},base:2900});
}
async function main(){
 try{
  await withStage05Fixture(async({pool,owner,request})=>{
   owned={owner,...JSON.parse(fs.readFileSync(path.join(output,'fixture/owned-target.json'),'utf8'))};
   async function call(who,url,method='GET',body,status=200){const r=await request(who,url,method,body);exchanges.push({who,url,method,status:r.status,code:r.body?.code||null});assert.equal(r.status,status,`${who} ${method} ${url}: ${JSON.stringify(r.body)}`);return r.body;}
   async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);save('progress.json',{checks,exchanges});}
   const base='/api/data-map-handoffs',query=base+'/source-upgrades?package_id='+state.source.oldPackageId+'&target_process_version_id='+state.source.newVersionId;
   const count=async table=>Number((await pool.execute('SELECT COUNT(*) n FROM '+table))[0][0].n);let created,comparison,body,result,url;
   const beforePackages=await count('process_data_governance_work_packages');
   await check('new formal source HTTP prompts exact current version without creating any work package',async()=>{
    const prompts=await call('lead',base+'/source-upgrades');const current=prompts.processes.find(x=>x.document_id===state.source.documentId);
    assert.equal(current.current_process_version_id,state.source.newVersionId);assert.equal(current.governance_status,'source_upgrade_pending');assert.equal(current.work_package_id,null);assert.equal(current.automatic_package_creation,false);
    assert.equal(await count('process_data_governance_work_packages'),beforePackages);save('prompts-before-selection.json',current);
   });
   await check('comparison HTTP reports all four changes from complete semantic dependencies and enforces read scope',async()=>{
    comparison=await call('lead',query);for(const kind of ['added','modified','deleted','unchanged'])assert(comparison.changes.some(x=>x.change_kind===kind),kind);
    assert.equal(comparison.source_process_version_id,state.source.oldVersionId);assert.equal(comparison.target_process_version_id,state.source.newVersionId);assert.equal(comparison.automatic_conclusion_reuse,false);
    await call('contact',query,'GET',undefined,403);await call('outsider',query,'GET',undefined,403);
    await call('admin',query);save('comparison.json',comparison);
   });
   await check('explicit native new-package review keeps old source and blocks omission of Q9 assessment',async()=>{
    created=await state.createNewPackage();assert.equal(await count('process_data_governance_work_packages'),beforePackages+1);
    const [[old]]=await pool.execute('SELECT CAST(process_version_id AS CHAR) process_version_id,source_content_hash,status FROM process_data_governance_work_packages WHERE id=?',[state.source.oldPackageId]);
    assert.equal(old.process_version_id,state.source.oldVersionId);assert.equal(old.status,'completed');
    const value=await call('lead',base+'/'+created.draft.handoff_id);assert.equal(value.header.state,'draft');assert(value.report.gates.some(g=>g.issues.includes('SOURCE_UPGRADE_ASSESSMENT_REQUIRED')));
    body=await state.assessmentBody(created.draft);url=base+'/'+created.draft.handoff_id+'/source-upgrade-assessments';save('new-draft-before-assessment.json',value);
   });
   await check('same-session concurrent draft assessment and source readers complete repeated HTTP rounds without deadlock or writes',async()=>{
    const before={requests:await count('data_map_handoff_requests'),events:await count('data_map_handoff_events'),revisions:await count('data_map_handoff_revisions')},rounds=[];
    for(let index=0;index<8;index++){
     const started=Date.now(),[draft,history,fixed,prompts]=await Promise.all([call('lead',base+'/'+created.draft.handoff_id),call('lead',url),call('lead',query),call('lead',base+'/source-upgrades')]);
     assert.equal(draft.header.handoff_id,created.draft.handoff_id);assert.equal(history.current_revision,Number(draft.header.current_revision));assert.equal(history.assessments.length,0);
     assert.equal(fixed.comparison_digest,comparison.comparison_digest);assert.equal(prompts.processes.find(x=>x.document_id===state.source.documentId).current_process_version_id,state.source.newVersionId);
     rounds.push({round:index+1,elapsed_ms:Date.now()-started,handoff_revision:Number(draft.header.current_revision),comparison_digest:fixed.comparison_digest});
    }
    assert.deepEqual({requests:await count('data_map_handoff_requests'),events:await count('data_map_handoff_events'),revisions:await count('data_map_handoff_revisions')},before);
    save('same-session-concurrent-readers.json',{rounds,parallel_getters_per_round:4,total_successful_http_reads:rounds.length*4,deadlock_retries:0,business_counts:before});
   });
   await check('assessment HTTP rejects department/admin overlap, missing rechecks, invalid reuse and forged differences',async()=>{
    for(const who of ['admin','adminMulti','contact','outsider'])await call(who,url,'POST',{...body,request_id:crypto.randomUUID()},403);
    const missing=structuredClone(body);missing.request_id=crypto.randomUUID();delete missing.decisions[0].rechecks.facts;
    assert.equal((await call('lead',url,'POST',missing,422)).code,'HANDOFF_UPGRADE_RECHECK_INCOMPLETE');
    const forged=structuredClone(body);forged.request_id=crypto.randomUUID();forged.decisions.find(x=>x.change_kind==='modified').decision='reference_and_recheck';
    assert.equal((await call('lead',url,'POST',forged,422)).code,'HANDOFF_UPGRADE_DECISION_INVALID');
    const scope=structuredClone(body);scope.request_id=crypto.randomUUID();scope.decisions.find(x=>x.change_kind==='unchanged').reuse_scope=['/missing_synthetic_value'];
    assert.equal((await call('lead',url,'POST',scope,422)).code,'HANDOFF_UPGRADE_REUSE_SCOPE_INVALID');
   });
   await check('assessment saves immutable exact references and same-content new revision without publishing',async()=>{
    const before=await count('data_map_handoff_approvals');result=await call('lead',url,'POST',body);assert.equal(result.business_outcome,'source_upgrade_assessed');assert.equal(result.state,'draft');assert.equal(result.revision,body.expected_revision+1);
    const recorded=await call('lead',url);assert.equal(recorded.assessments.length,1);assert.equal(recorded.assessments[0].snapshot.target_binding_id,created.newBindingId);assert.equal(recorded.assessments[0].snapshot.source_binding_id,state.oldReview.binding_id);
    assert.deepEqual(recorded.current.issues,[]);assert.equal(await count('data_map_handoff_approvals'),before);assert.equal(await count('data_map_publications'),0);save('assessment.json',recorded);
   });
   await check('original UUID replay and receipt preserve result and altered payload is refused',async()=>{
    assert.deepEqual(await call('lead',url,'POST',body),result);
    const receipt=await call('lead',base+'/requests/'+body.request_id);assert.equal(receipt.state,'committed');assert.deepEqual(receipt.result,result);
    const changed={...body,basis:'Synthetic changed request body'};await call('lead',url,'POST',changed,409);
    await call('contact',base+'/requests/'+body.request_id,'GET',undefined,403);
   });
   await check('source body integrity anomaly blocks live comparison and preserves fixed original assessment',async()=>{
    const [[original]]=await pool.execute('SELECT process_content_json FROM process_design_versions WHERE id=?',[state.source.newVersionId]);
    const altered=JSON.parse(original.process_content_json);altered.data_objects[0].description='Synthetic integrity damage';
    await pool.execute('UPDATE process_design_versions SET process_content_json=? WHERE id=?',[JSON.stringify(altered),state.source.newVersionId]);
    await call('lead',query,'GET',undefined,409);
    await pool.execute('UPDATE process_design_versions SET process_content_json=? WHERE id=?',[original.process_content_json,state.source.newVersionId]);
    assert.equal((await call('lead',url)).assessments[0].snapshot.comparison.comparison_digest,comparison.comparison_digest);
    assert.deepEqual(await call('lead',base+'/requests/'+body.request_id).then(x=>x.result),result);
   });
   await check('read-only assessment API retains history and refuses new writes without reopening legacy paths',async()=>{
    await pool.execute("UPDATE data_map_governance_control SET cutover_state='prepared' WHERE control_id=1");
    const stored=await call('lead',url);assert.equal(stored.assessments.length,1);
    await call('lead',url,'POST',{...body,expected_revision:result.revision,request_id:crypto.randomUUID()},503);
    assert.equal(await count('data_map_publications'),0);assert.equal((await call('lead',url)).assessments.length,1);
   });
  },{randomDatabase:true,handoffEnabled:true,processDataGovernanceVersionId:901,completeSource:true,departmentAccountability:true,evidenceDir:path.join(output,'fixture'),frontendDist:frontend,testNodePath:path.join(root,'artifacts/mdm-data-governance-handoff-implementation-20261020-01/test-dependencies/node_modules'),createDocument:()=>({schema_version:'process-governance-v8',export_meta:{},process:{},behaviors:[],flow_relations:[],data_objects:[],data_fields:[],data_relations:[],forms:[]}),beforeStart:seed});
  owned.cleaned=true;passed=true;
 }catch(error){failure={code:error.code,message:error.message,stack:error.stack};throw error;}
 finally{save('http-results.json',{passed,checks,exchanges,owned,failure,formal_database_connected:false,formal_migration:false,deployed:false,feature_activation:false,business_accepted:false});}
}
main().then(()=>console.log('SOURCE_UPGRADE_HTTP_PASS '+checks.length+' '+output)).catch(e=>{console.error(e.code||e.message);if(e.code==='ERR_ASSERTION')console.error(e.message);process.exitCode=1;});
