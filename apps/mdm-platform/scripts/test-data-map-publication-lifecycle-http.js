// Q10 real HTTP/session/CSRF contracts. Input is synthetic native V8 material
// built here; output is a fresh artifacts evidence directory with no cookies,
// passwords or session tokens. A newly owned loopback tmpfs MySQL and API-only
// frontend stub are removed/stopped by the shared fixture. No formal database,
// existing service, deployment, activation, 3001 dependency or UI acceptance.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const {draftBody}=require('./testHelpers/dataMapHandoffFixture');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {json,digest,parse}=require('../server/dataMapHandoffPolicy');
const root=path.resolve(__dirname,'../../..'),output=path.join(root,'artifacts/mdm-data-governance-handoff-implementation-20261020-03/http-lifecycle-'+crypto.randomUUID());
assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const frontend=path.join(output,'api-only-frontend');fs.mkdirSync(frontend);fs.writeFileSync(path.join(frontend,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>API isolation fixture</title><main>仅用于隔离 API 验证</main></html>');
const request=body=>({request_id:crypto.randomUUID(),...body}),checks=[],exchanges=[];let state={},owned,passed=false,failure;
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
async function check(name,work){await work();checks.push(name);console.log('PASS '+name);save('progress.json',{checks,exchanges});}
async function seed({pool,owner,database,document}){
  await require('../server/publicationSchema').managePublicationSchema(pool,'apply');
  await require('../server/officeSchema').manageOfficeSchema(pool,'apply');
  for(const sql of require('../server/dataMapDefinitionSchema').statements())await pool.execute(sql);
  await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)',[require('../server/dataMapDefinitionSchema').MIGRATION_KEY]);
  for(const sql of require('../server/mysqlSchema').splitSqlStatements(require('../server/governanceResponsibilitiesMigration').SCHEMA_SQL))await pool.execute(sql);
  await require('../server/dataMapHandoffSchema').applyHandoffSchema(pool,{owner,database});
  await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled',cutover_epoch=1 WHERE control_id=1");
  const hash=digest(document);
  await pool.execute("INSERT INTO process_design_documents(id,document_no,process_ref,document_title,owning_department_id) VALUES(901,'Q10-HTTP',?,'合成来源',91)",[document.process.process_ref]);
  await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id,schema_version,process_content_json,content_hash,status) VALUES(901,901,'Q10-HTTP','合成来源','A','合成流程','合成','合成','合成',91,?,?,?,'published')",[document.schema_version,json(document),hash]);
  await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,status) VALUES(901,901,901,'Q10-HTTP','合成来源','A','Q10-HTTP-A',91,?,?,?,'published')",[document.schema_version,json(document),hash]);
  await pool.execute('UPDATE process_design_documents SET current_version_id=901 WHERE id=901');
  await pool.execute("INSERT INTO process_data_governance_work_packages(id,package_ref,process_version_id,source_document_id,owning_department_id,source_content_hash,rule_version,risk_basis_json,status,created_by_person_id) VALUES(501,'package-q10-http',901,901,91,?,'synthetic-only','[]','completed',82)",[hash]);
  await pool.execute("INSERT INTO process_data_governance_details(id,work_package_id,detail_ref,detail_type,source_ref,responsible_department_id,source_snapshot_digest,candidate_rule_code,candidate_json,governance_json,status) VALUES(501,501,'object:source_1','data_object_identity','source_1',91,?,'synthetic-only','{}',?,'confirmed')",[digest({source_ref:'source_1'}),json({basis:'synthetic fixed identity verified'})]);
  await pool.execute("INSERT INTO process_data_governance_reviews(work_package_id,review_type,decision,basis_text,package_revision_no,actor_person_id,actor_role_code) VALUES(501,'mdm_workgroup','approved','synthetic original review',1,82,'mdm_lead')");
  const repo=createDataMapHandoffRepository(pool,{env:{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}}),lead={personId:'82',accountId:'182',authVersion:'1'};
  const intake=await repo.prepareIntake('501',request({expected_revision:0}),lead);
  const review=await repo.reviewIntake(intake.intake_id,request({expected_revision:1,basis:'synthetic exact fixed review',detail_evidence:intake.required_detail_evidence.map(x=>({...x,basis:'synthetic source checked',evidence_refs:['synthetic:http-source']}))}),lead);
  let draft=await repo.fromWorkPackage('501',request({expected_revision:0,binding_id:review.binding_id,draft:draftBody()}),lead);
  draft=await repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),lead);
  const checked=await repo.get(draft.handoff_id,lead);assert.equal(checked.report.ready_for_approval,true,JSON.stringify(checked.report.gates));
  const approval=await repo.approve(draft.handoff_id,request({expected_revision:draft.revision,decision:'approved',basis:'synthetic initial publication approval',binding_digest:checked.report.binding_digest}),lead);
  const publication=await repo.publish(draft.handoff_id,request({expected_revision:draft.revision,approval_id:approval.approval_id}),lead);
  const [[binding]]=await pool.execute('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=?',[review.binding_id]);
  state={publication,binding:parse(binding.snapshot_json),original:await repo.getPublication(publication.publication_id,lead)};
}
async function main(){try{
  await withStage05Fixture(async({pool,owner,fixture,request:raw})=>{
    owned={owner,...JSON.parse(fs.readFileSync(path.join(output,'fixture/owned-target.json'),'utf8'))};
    const base='/api/data-map-handoffs',publication=state.publication,pathAt=base+'/publications/'+publication.publication_id,reason='synthetic exact stop reason';
    async function call(who,url,method='GET',body,status=200){
      const response=await raw(who,url,method,body);exchanges.push({who,url,method,status:response.status,code:response.body?.code||null});
      assert.equal(response.status,status,`${who} ${method} ${url}: ${JSON.stringify(response.body)}`);return response.body;
    }
    const count=async table=>Number((await pool.execute('SELECT COUNT(*) n FROM '+table))[0][0].n);
    await check('publication routes require a session and expose immutable publication revision 1 to authorized readers',async()=>{
      const anonymous=await fetch(fixture.baseURL+pathAt);assert.equal(anonymous.status,401);exchanges.push({who:'anonymous',url:pathAt,method:'GET',status:anonymous.status});
      const value=await call('lead',pathAt);assert.equal(value.state,'published');assert.equal(value.event_revision,1);assert.equal(value.manifest.handoff_revision_id,state.original.manifest.handoff_revision_id);
      const admin=await call('admin',pathAt);assert.deepEqual(admin.allowed_actions,['read']);await call('contact',pathAt,'GET',undefined,403);
    });
    await check('missing CSRF never registers a lifecycle request or changes publication events',async()=>{
      const login=await fetch(fixture.baseURL+'/api/org/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginName:'SYNTHETIC_lead',password:fixture.loginPassword})});assert.equal(login.status,200);
      const cookie=login.headers.get('set-cookie').split(';')[0],before=await count('data_map_handoff_requests');
      const response=await fetch(fixture.baseURL+pathAt+'/withdrawal-checks',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(request({expected_revision:1,reason}))});
      const body=await response.json();assert.equal(response.status,403,JSON.stringify(body));assert.match(String(body.code||body.error),/CSRF|csrf/);exchanges.push({who:'lead_no_csrf',url:pathAt+'/withdrawal-checks',method:'POST',status:response.status,code:body.code||null});
      assert.equal(await count('data_map_handoff_requests'),before);assert.equal(await count('data_map_publication_events'),1);
    });
    await check('admin overlap and department roles cannot check approve withdraw or restore a whole publication',async()=>{
      const before=await count('data_map_handoff_requests');
      for(const who of ['admin','adminMulti','contact','reviewA','reviewB'])for(const [suffix,payload]of[
        ['withdrawal-checks',{expected_revision:1,reason}],['withdrawal-approvals',{expected_revision:1,reason,basis:'synthetic denied',binding_digest:'0'.repeat(64)}],
        ['withdraw',{expected_revision:1,reason,withdrawal_approval_id:crypto.randomUUID()}]
      ])await call(who,pathAt+'/'+suffix,'POST',request(payload),403);
      assert.equal(await count('data_map_handoff_requests'),before);assert.equal(await count('data_map_publication_events'),1);
    });
    let checked,approved,checkBody,withdrawBody,withdrawn;
    await check('withdrawal checks freeze reason and full impact while stale publication revisions fail explicitly',async()=>{
      const stale=await call('lead',pathAt+'/withdrawal-checks','POST',request({expected_revision:2,reason}),409);assert.equal(stale.code,'HANDOFF_PUBLICATION_REVISION_CONFLICT');
      checkBody=request({expected_revision:1,reason});checked=await call('lead',pathAt+'/withdrawal-checks','POST',checkBody);assert.equal(checked.report.reason,reason);assert.equal(checked.report.produced_items.length,8);assert.equal(checked.event_revision,1);
      assert.deepEqual(await call('lead',pathAt+'/withdrawal-checks','POST',checkBody),checked);assert.equal((await call('lead',base+'/requests/'+checkBody.request_id)).state,'committed');
    });
    await check('approval freezes the exact report and does not advance the publication event revision',async()=>{
      const altered=await call('lead',pathAt+'/withdrawal-approvals','POST',request({expected_revision:1,reason:reason+' changed',basis:'synthetic exact review',binding_digest:checked.report.binding_digest}),409);assert.equal(altered.code,'HANDOFF_WITHDRAWAL_APPROVAL_CHANGED');
      const body=request({expected_revision:1,reason,basis:'synthetic full impact approved',binding_digest:checked.report.binding_digest});approved=await call('lead',pathAt+'/withdrawal-approvals','POST',body);assert.equal(approved.event_revision,1);assert.equal(approved.business_outcome,'withdrawal_approved');assert(approved.withdrawal_approval_id);
      assert.deepEqual(await call('lead',pathAt+'/withdrawal-approvals','POST',body),approved);assert.equal((await call('lead',pathAt)).event_revision,1);
    });
    await check('whole withdrawal stores the original UUID atomically and terminal replay keeps exactly two publication events',async()=>{
      withdrawBody=request({expected_revision:1,reason,withdrawal_approval_id:approved.withdrawal_approval_id});withdrawn=await call('lead',pathAt+'/withdraw','POST',withdrawBody);assert.equal(withdrawn.business_outcome,'publication_withdrawn');assert.equal(withdrawn.event_revision,2);
      assert.deepEqual(await call('lead',pathAt+'/withdraw','POST',withdrawBody),withdrawn);assert.equal(await count('data_map_publication_events'),2);
      const receipt=await call('lead',base+'/requests/'+withdrawBody.request_id);assert.equal(receipt.state,'committed');await call('contact',base+'/requests/'+withdrawBody.request_id,'GET',undefined,403);
      const conflict=await call('lead',pathAt+'/withdraw','POST',{...withdrawBody,reason:reason+' changed'},409);assert.equal(conflict.code,'HANDOFF_REQUEST_PAYLOAD_CONFLICT');
      const stale=await call('lead',pathAt+'/withdrawal-checks','POST',request({expected_revision:1,reason}),409);assert.equal(stale.code,'HANDOFF_PUBLICATION_REVISION_CONFLICT');
      const value=await call('lead',pathAt);assert.equal(value.state,'withdrawn');assert.equal(value.event_revision,2);assert.equal(value.manifest.handoff_revision_id,state.original.manifest.handoff_revision_id);
    });
    const draft=draftBody();
    for(const item of draft.items){const old=publication.items.find(x=>x.item_ref===item.item_ref);item.target_id=old.target_id;if(['object','field','data_element'].includes(item.target_kind)){item.operation='modify';item.base_version_ref=old.target_version_ref;}item.source_detail_refs=[state.binding.detail_versions[0].detail_version_id];}
    const restoreBody=request({expected_revision:2,target_package_id:'501',expected_target_revision:0,scope_mode:'current',draft,basis:'synthetic explicit fixed-content adoption',evidence_refs:['synthetic:http-restoration'],item_mappings:publication.items.map(x=>({source_item_ref:x.item_ref,target_item_ref:x.item_ref,content_decision:'adopt',basis:'synthetic same meaning and rebuilt version links',evidence_refs:['synthetic:http-adoption']}))});
    let restored;
    await check('restoration writes require governance authority and preserve rejected identities',async()=>{
      for(const who of ['admin','adminMulti','contact','reviewA','reviewB'])await call(who,pathAt+'/restorations','POST',{...restoreBody,request_id:crypto.randomUUID()},403);
      assert.equal(await count('data_map_publications'),1);assert.equal((await call('lead',pathAt)).state,'withdrawn');
    });
    await check('restoration creates a new unapproved draft through HTTP without publishing or reviving any old version',async()=>{
      const before=await count('data_map_handoff_approvals');restored=await call('lead',pathAt+'/restorations','POST',restoreBody);
      assert.equal(restored.state,'draft');assert.equal(restored.business_outcome,'restoration_draft_saved');assert.equal(restored.revision,1);assert.notEqual(restored.handoff_id,publication.handoff_id);assert.equal(restored.restores_publication_id,publication.publication_id);
      assert.deepEqual(await call('lead',pathAt+'/restorations','POST',restoreBody),restored);assert.equal(await count('data_map_publications'),1);assert.equal(await count('data_map_handoff_approvals'),before);
      const value=await call('lead',base+'/'+restored.handoff_id);assert.equal(value.header.state,'draft');assert.equal(value.header.current_approval_id,null);assert.equal(value.revision.snapshot_json.restores_publication_id,publication.publication_id);
      const [[heads]]=await pool.execute("SELECT COUNT(*) n FROM data_map_effective_heads WHERE availability='active'");assert.equal(Number(heads.n),0);
      const original=await call('lead',base+'/'+publication.handoff_id);assert.equal(original.header.state,'published');assert.equal(original.revision.revision_id,state.original.manifest.handoff_revision_id);
      assert.deepEqual((await call('lead',pathAt)).manifest,state.original.manifest);assert.equal((await call('lead',pathAt)).state,'withdrawn');
      save('restoration-draft.json',value);save('withdrawal-result.json',withdrawn);
    });
  },{randomDatabase:true,handoffEnabled:true,processDataGovernanceVersionId:901,completeSource:true,evidenceDir:path.join(output,'fixture'),frontendDist:frontend,
    testNodePath:path.join(root,'artifacts/mdm-data-governance-handoff-implementation-20261020-01/test-dependencies/node_modules'),
    createDocument:()=>({schema_version:'process-governance-v8',export_meta:{},process:{},behaviors:[],flow_relations:[],data_objects:[],data_fields:[],data_relations:[],forms:[]}),beforeStart:seed});
  passed=true;owned.cleaned=true;
}catch(error){failure={code:error.code,message:error.message,stack:error.stack};throw error;}
finally{save('http-results.json',{passed,checks,exchanges,owned,failure,formal_database_connected:false,feature_activation:false,business_accepted:false});}
}
main().then(()=>console.log('PUBLICATION_LIFECYCLE_HTTP_PASS '+checks.length+' '+output)).catch(error=>{console.error(error.code||error.message);if(error.code==='ERR_ASSERTION')console.error(error.message);process.exitCode=1;});
