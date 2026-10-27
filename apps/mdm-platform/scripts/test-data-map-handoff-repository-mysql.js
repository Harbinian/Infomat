// Real authority -> global request -> immutable draft -> gates -> publication.
// Only a newly owned labelled tmpfs MySQL and synthetic identities are used.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed,draftBody}=require('./testHelpers/dataMapHandoffFixture');
const {createDataMapHandoffRepository,writeFields}=require('../server/dataMapHandoffRepository');
const output=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-01/repository');
if(process.argv[2]){assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output),'preserve previous evidence');}
const checks=[];let targetRecord;
const request=values=>({request_id:crypto.randomUUID(),...values});
const rejected=(action,code)=>assert.rejects(action,error=>code?error.code===code:Number(error.statusCode)===403,code);
async function check(name,action){await action();checks.push({name,passed:true});console.log('PASS '+name);}
async function main(){await withFreshMysql(async target=>{
  const {pool,owner,database,containerId}=target;targetRecord={owner,database,container_id:containerId,mysql_version:(await pool.execute('SELECT VERSION() v'))[0][0].v};
  const fixture=await seed(target),lead=fixture.session(11),steward=fixture.session(12),admin=fixture.session(13),department=fixture.session(14);
  const repo=createDataMapHandoffRepository(pool,{env:{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}});
  await fixture.packageSeed(501);
  let intake,reviewed,draft,approval,published,creationBody,savedBody,oldApprovalBody;
  async function count(table){return Number((await pool.execute('SELECT COUNT(*) n FROM '+table))[0][0].n);}
  async function approvalBody(basis) {
    const report=await repo.checks(draft.handoff_id,request({expected_revision:draft.revision}),lead);
    return request({expected_revision:draft.revision,decision:'approved',basis,binding_digest:report.report.binding_digest});
  }
  await check('write-field scope contains actual leaf names and complete nonempty parent paths',async()=>{
    const actual=writeFields({draft:{items:[{definition:{name:'synthetic'}}]}});
    for(const key of ['name','definition','draft.items[0].definition','draft.items[0].definition.name'])assert(actual.has(key));
  });
  await check('default disabled rejects before request registration',async()=>{
    const off=createDataMapHandoffRepository(pool,{env:{}}),before=await count('data_map_handoff_requests');
    await rejected(()=>off.fromWorkPackage('501',request({expected_revision:0}),lead),'HANDOFF_DISABLED');assert.equal(await count('data_map_handoff_requests'),before);
  });
  await check('admin overlap and department cannot prepare a whole governance package',async()=>{
    await rejected(()=>repo.prepareIntake('501',request({expected_revision:0}),admin));
    await rejected(()=>repo.prepareIntake('501',request({expected_revision:0}),department));
  });
  await check('current intake and independent review bind old completed work without rewriting it',async()=>{
    const before=(await pool.execute('SELECT * FROM process_data_governance_work_packages WHERE id=501'))[0];
    intake=await repo.prepareIntake('501',request({expected_revision:0}),steward);
    const payload=request({expected_revision:1,basis:'synthetic current source verification',detail_evidence:intake.required_detail_evidence.map(item=>({...item,basis:'synthetic exact current evidence',evidence_refs:['synthetic:review-evidence']}))});
    await rejected(()=>repo.reviewIntake(intake.intake_id,payload,steward));
    reviewed=await repo.reviewIntake(intake.intake_id,{...payload,request_id:crypto.randomUUID()},lead);
    assert.equal(reviewed.publication_id,null);assert.equal((await pool.execute('SELECT state FROM data_map_handoff_generation_tasks WHERE task_id=?',[reviewed.task_id]))[0][0].state,'pending');
    assert.deepEqual((await pool.execute('SELECT * FROM process_data_governance_work_packages WHERE id=501'))[0],before);
  });
  await check('assigned worker creates an unapproved immutable draft and original UUID replay does not duplicate it',async()=>{
    creationBody=request({expected_revision:0,binding_id:reviewed.binding_id,draft:draftBody()});
    draft=await repo.fromWorkPackage('501',creationBody,steward);assert.equal(draft.revision,1);assert.equal(draft.state,'draft');
    assert.deepEqual(await repo.fromWorkPackage('501',creationBody,steward),draft);assert.equal(await count('data_map_handoff_drafts'),1);
    const read=await repo.get(draft.handoff_id,steward);assert.equal(read.report.ready_for_approval,true,JSON.stringify(read.report.gates));
    await rejected(()=>repo.get(draft.handoff_id,department));
  });
  await check('save appends a revision and stale patch is rejected without changing the submitted input',async()=>{
    const previous=await repo.get(draft.handoff_id,steward),next=structuredClone(previous.revision.snapshot_json);next.basis='synthetic updated preparation basis';
    savedBody=request({expected_revision:draft.revision,draft:next});draft=await repo.saveDraft(draft.handoff_id,savedBody,steward);assert.equal(draft.revision,2);
    await rejected(()=>repo.saveDraft(draft.handoff_id,{...savedBody,request_id:crypto.randomUUID()},steward),'HANDOFF_REVISION_CONFLICT');
    assert.equal(await count('data_map_handoff_revisions'),2);
    assert.equal((await repo.get(draft.handoff_id,steward,{revisionNo:1})).revision.content_digest,previous.revision.content_digest);
  });
  await check('submission freezes another revision and only the still-qualified original submitter may withdraw',async()=>{
    draft=await repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),steward);assert.equal(draft.state,'submitted');
    await rejected(()=>repo.withdraw(draft.handoff_id,request({expected_revision:draft.revision,intent:'withdraw_submission',reason:'synthetic wrong submitter'}),lead),'HANDOFF_SUBMITTER_REQUIRED');
    draft=await repo.withdraw(draft.handoff_id,request({expected_revision:draft.revision,intent:'withdraw_submission',reason:'synthetic submitter correction'}),steward);assert.equal(draft.state,'draft');
    await rejected(()=>repo.saveDraft(draft.handoff_id,{...savedBody,request_id:crypto.randomUUID()},steward),'HANDOFF_REVISION_CONFLICT');
  });
  await check('checks are recorded separately and do not approve or publish',async()=>{
    const before=await count('data_map_handoff_revisions'),result=await repo.checks(draft.handoff_id,request({expected_revision:draft.revision}),steward);
    assert.equal(result.report.ready_for_approval,true);assert.equal(result.report.gates[4].status,'pending');assert.equal(result.publication_id,null);assert.equal(await count('data_map_handoff_revisions'),before);
  });
  await check('needs_changes appends a return revision and does not leave a current approval',async()=>{
    draft=await repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),steward);
    draft=await repo.approve(draft.handoff_id,request({expected_revision:draft.revision,decision:'needs_changes',basis:'synthetic return to preparer'}),lead);assert.equal(draft.state,'draft');
    assert.equal((await repo.get(draft.handoff_id,lead)).header.current_approval_id,null);
  });
  let oldApproval;
  await check('worker cannot approve; leader approval binds the exact immutable submitted revision',async()=>{
    draft=await repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),steward);
    await rejected(()=>repo.approve(draft.handoff_id,request({expected_revision:draft.revision,decision:'approved',basis:'synthetic forbidden worker approval'}),steward));
    await rejected(()=>repo.approve(draft.handoff_id,request({expected_revision:draft.revision,decision:'approved',basis:'synthetic missing displayed digest'}),lead),'HANDOFF_APPROVAL_BINDING_CHANGED');
    await rejected(()=>repo.approve(draft.handoff_id,request({expected_revision:draft.revision,decision:'approved',basis:'synthetic wrong displayed digest',binding_digest:'0'.repeat(64)}),lead),'HANDOFF_APPROVAL_BINDING_CHANGED');
    oldApprovalBody=await approvalBody('synthetic exact leader approval');
    approval=await repo.approve(draft.handoff_id,oldApprovalBody,lead);assert.equal(approval.state,'approved');oldApproval=approval.approval_id;
    const stored=(await pool.execute('SELECT * FROM data_map_handoff_approvals WHERE approval_id=?',[oldApproval]))[0][0];assert.equal(stored.revision_id,draft.revision_id);assert.equal(stored.binding_digest,approval.report.binding_digest);
  });
  await check('approval revocation and resubmission cannot revive the old approval',async()=>{
    const hash=(await pool.execute('SELECT content_hash FROM process_design_versions WHERE id=501'))[0][0].content_hash;
    await pool.execute('UPDATE process_design_versions SET content_hash=? WHERE id=501',['0'.repeat(64)]);
    try {
      const blocked=await repo.get(draft.handoff_id,lead);assert.equal(blocked.report.ready_for_approval,false);assert.equal(blocked.report.gates[0].status,'blocked');
      draft=await repo.withdraw(draft.handoff_id,request({expected_revision:draft.revision,intent:'revoke_approval',reason:'synthetic source integrity anomaly'}),lead);assert.equal(draft.state,'draft');
    }finally {await pool.execute('UPDATE process_design_versions SET content_hash=? WHERE id=501',[hash]);}
    assert.equal((await repo.get(draft.handoff_id,lead)).header.current_approval_id,null);
    const changed=structuredClone((await repo.get(draft.handoff_id,steward)).revision.snapshot_json);changed.items.find(item=>item.target_kind==='field').definition.data_format='synthetic checked format';
    draft=await repo.saveDraft(draft.handoff_id,request({expected_revision:draft.revision,draft:changed}),steward);
    draft=await repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),steward);
    approval=await repo.approve(draft.handoff_id,await approvalBody('synthetic new exact approval'),lead);assert.notEqual(approval.approval_id,oldApproval);
    const replay=await repo.approve(draft.handoff_id,oldApprovalBody,lead);assert.equal(replay.approval_id,oldApproval);
    assert.equal((await repo.get(draft.handoff_id,lead)).header.current_approval_id,approval.approval_id);
    await rejected(()=>repo.publish(draft.handoff_id,request({expected_revision:draft.revision,approval_id:oldApproval}),lead),'HANDOFF_APPROVAL_STALE');assert.equal(await count('data_map_publications'),0);
  });
  await check('publish recomputes source/approval evidence and atomically writes all eight items and receipt',async()=>{
    const body=request({expected_revision:draft.revision,approval_id:approval.approval_id});
    published=await repo.publish(draft.handoff_id,body,lead);assert.equal(published.business_outcome,'published_current');assert.equal(published.items.length,8);
    assert.equal(await count('data_map_publications'),1);assert.equal(await count('data_map_effective_heads'),8);assert.equal(await count('data_map_field_element_bindings'),2);
    assert.deepEqual(await repo.publish(draft.handoff_id,body,lead),published);assert.equal(await count('data_map_publications'),1);
    assert.equal((await repo.receipt(body.request_id,lead)).state,'committed');
  });
  await check('same reviewed binding after publication resolves the original draft/publication rather than creating another',async()=>{
    const repeated=await repo.fromWorkPackage('501',request({expected_revision:0,binding_id:reviewed.binding_id}),steward);
    assert.equal(repeated.handoff_id,draft.handoff_id);assert.equal(repeated.publication_id,published.publication_id);assert.equal(await count('data_map_handoff_drafts'),1);
  });
  await check('published immutable read and six-group trace retain exact source and all return/approval evidence',async()=>{
    const read=await repo.get(draft.handoff_id,steward);assert.equal(read.header.state,'published');assert.deepEqual(read.allowed_actions,['read']);
    const trace=await repo.tracePublication(published.publication_id,lead);assert.equal(trace.selected_publication_id,published.publication_id);assert.equal(trace.source.process_version_id,'501');
    assert.equal(trace.bindings.length,1);assert.equal(trace.publications.length,1);assert.equal(trace.approvals.length,3);assert(trace.events.some(item=>item.event_type==='approval_revoked'));
    assert.equal(typeof trace.bindings[0].package_id,'string');assert.equal(typeof trace.revisions[0].created_by,'string');
    await rejected(()=>repo.tracePackage('501',department));
  });
  await check('actual Express router authenticates scope, serves fixed trace/receipt and returns structured refusals',async()=>{
    const express=require('express'),{once}=require('node:events'),auth=require('../server/auth');
    const previousModel=process.env.MDM_IDENTITY_READ_MODEL;process.env.MDM_IDENTITY_READ_MODEL='mysql';
    const identity=require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool);
    auth.setIdentityRepositoryFactory(()=>identity);
    const correction=await repo.createCorrection('501',request({expected_revision:0,replaces_binding_id:reviewed.binding_id,reason:'synthetic new department question',evidence_refs:['synthetic:question-basis']}),steward);
    const fact=await repo.createFact(correction.correction_id,request({expected_revision:0,expected_parent_revision:1,detail_id:'501',target_department_id:'91',requested_fact_type:'business_fact',question_text:'synthetic minimum scoped question',request_reason:'synthetic current verification'}),steward);
    const app=express();app.use(express.json());app.use((req,res,next)=>{const person=req.get('X-Synthetic-Actor');if(['11','12','13','14'].includes(person))req.session=fixture.session(person);next();});
    const {createRouter}=require('../server/routes/dataMapHandoffs');app.use('/api/data-map-handoffs',createRouter({pool,env:{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}}));app.use('/api/disabled-handoffs',createRouter({pool,env:{}}));
    const server=app.listen(0,'127.0.0.1');await once(server,'listening');
    const base='http://127.0.0.1:'+server.address().port;
    async function http(url,{actor='11',method='GET',body}={}) {
      const response=await fetch(base+url,{method,headers:{...(actor?{'X-Synthetic-Actor':actor}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,body:await response.json()};
    }
    try {
      assert.equal((await http('/api/data-map-handoffs/capabilities',{actor:null})).status,401);
      const capability=await http('/api/data-map-handoffs/capabilities');assert.equal(capability.status,200,JSON.stringify(capability.body));assert.equal(capability.body.schema_ready,true);
      assert.equal((await http('/api/data-map-handoffs/'+draft.handoff_id,{actor:'14'})).status,403);
      const read=await http('/api/data-map-handoffs/'+draft.handoff_id);assert.equal(read.status,200);assert.equal(read.body.header.state,'published');
      const receipt=await http('/api/data-map-handoffs/requests/'+published.request_id);assert.equal(receipt.status,200);assert.equal(receipt.body.state,'committed');
      assert.equal((await http('/api/data-map-handoffs/publications/'+published.publication_id+'/trace')).body.selected_publication_id,published.publication_id);
      const refused=await http('/api/data-map-handoffs/'+draft.handoff_id+'/draft',{actor:'13',method:'PATCH',body:request({expected_revision:draft.revision,draft:draftBody()})});assert.equal(refused.status,403);assert.equal(refused.body.code,'HANDOFF_ADMIN_READ_ONLY');
      const question=await http('/api/data-map-handoffs/facts/'+fact.fact_id+'/current',{actor:'14'});assert.equal(question.status,200,JSON.stringify(question.body));assert.equal(question.body.question_text,'synthetic minimum scoped question');assert.equal(question.body.expected_parent_revision,2);assert.equal(question.body.draft,undefined);assert.equal(question.body.detail_versions,undefined);assert.deepEqual(question.body.allowed_actions,['read','answer']);
      const answer=await http('/api/data-map-handoffs/facts/'+fact.fact_id+'/answers',{actor:'14',method:'POST',body:request({expected_revision:question.body.revision,expected_parent_revision:question.body.expected_parent_revision,answer_text:'synthetic department current answer',evidence_refs:['synthetic:department-evidence']})});assert.equal(answer.status,200,JSON.stringify(answer.body));assert.equal(answer.body.status,'answered');
      const answered=await http('/api/data-map-handoffs/facts/'+fact.fact_id+'/current',{actor:'14'});assert.equal(answered.body.status,'answered');assert.deepEqual(answered.body.allowed_actions,['read']);
      const selfClose=await http('/api/data-map-handoffs/facts/'+fact.fact_id+'/closures',{actor:'14',method:'POST',body:request({expected_revision:answered.body.revision,expected_parent_revision:answered.body.expected_parent_revision,basis:'synthetic denied department self close',evidence_refs:['synthetic:close']})});assert.equal(selfClose.status,403);
      const closed=await repo.closeFact(fact.fact_id,request({expected_revision:answered.body.revision,expected_parent_revision:answered.body.expected_parent_revision,basis:'synthetic MDM verified adoption',evidence_refs:['synthetic:close']}),steward);assert.equal(closed.status,'closed');
      const foreign=await repo.createFact(correction.correction_id,request({expected_revision:0,expected_parent_revision:closed.parent_revision,detail_id:'501',target_department_id:'92',requested_fact_type:'business_fact',question_text:'synthetic other department private question',request_reason:'synthetic explicit department scope'}),steward);
      assert.equal((await http('/api/data-map-handoffs/facts/'+foreign.fact_id+'/current',{actor:'14'})).status,403);
      const before=await count('data_map_handoff_requests');const disabled=await http('/api/disabled-handoffs/from-work-packages/501',{method:'POST',body:request({expected_revision:0})});assert.equal(disabled.status,503);assert.equal(disabled.body.code,'HANDOFF_DISABLED');assert.equal(await count('data_map_handoff_requests'),before);
    }finally {
      await new Promise(resolve=>server.close(resolve));auth.resetIdentityRepositoryFactory();
      if(previousModel===undefined)delete process.env.MDM_IDENTITY_READ_MODEL;else process.env.MDM_IDENTITY_READ_MODEL=previousModel;
    }
  });
  await check('missing current assignment rejects subsequent worker writes even with an old valid session',async()=>{
    await pool.execute("UPDATE process_governance_responsibilities SET person_id=15,revision_no=revision_no+1 WHERE target_type='work_package' AND target_id=501");
    await rejected(()=>repo.createCorrection('501',request({expected_revision:0,replaces_binding_id:reviewed.binding_id,reason:'synthetic now unassigned',evidence_refs:['synthetic:reason']}),steward));
  });
},{stage:'63',randomDatabase:true});}
main().then(()=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:'passed',checks,target:targetRecord,formal_database_connected:false,owned_container_removed:true},null,2));console.log('HANDOFF_REPOSITORY_MYSQL_PASS '+checks.length);}).catch(error=>{
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({status:'failed',checks,code:error.code,message:error.message,stack:error.stack,payload:error.payload,details:error.details},null,2));
  console.error(error.code || error.name,error.message);if(error.details)console.error(JSON.stringify(error.details.tables?.filter(item=>item.status!=='matching')||error.details));process.exitCode=1;
});
