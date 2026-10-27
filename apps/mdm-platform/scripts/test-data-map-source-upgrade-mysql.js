// Q9 fixed-source comparison, explicit assessment and new approval on owned MySQL.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {setup,request,proof,documents}=require('./testHelpers/dataMapSourceUpgradeFixture');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {semanticIndex}=require('../server/dataMapSourceUpgrade');
const {json,parse,digest}=require('../server/dataMapHandoffPolicy');
const output=path.resolve(process.argv[2]||path.join(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-05/source-upgrade-mysql-'+crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const checks=[];let owned,passed=false,failure;
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
async function check(name,work){await work();checks.push(name);console.log('PASS '+name);save('progress.json',{checks});}
const rejected=(work,code)=>assert.rejects(work,error=>code?error.code===code:error.statusCode===403);
function faultPool(pool,{failAppend=false,onGraph=null}={}){
  let triggered=false,eventWrites=0;
  const proxy=new Proxy(pool,{get(target,key){
    if(key==='getConnection')return async()=>{const db=await target.getConnection();return new Proxy(db,{get(connection,method){
      if(method==='execute')return async(sql,args)=>{
        if(onGraph&&/FROM data_map_governance_control\b[\s\S]*FOR UPDATE/i.test(sql)){const [[value]]=await connection.execute('SELECT CONNECTION_ID() id');onGraph(value.id);}
        if(failAppend&&!triggered&&/INSERT INTO data_map_handoff_revisions\b/.test(sql)){triggered=true;throw Object.assign(Error('Synthetic Q9 later append failure'),{code:'SYNTHETIC_UPGRADE_APPEND_FAILURE'});}
        const result=await connection.execute(sql,args);if(/INSERT INTO data_map_handoff_events\b/.test(sql))eventWrites++;return result;
      };
      const value=connection[method];return typeof value==='function'?value.bind(connection):value;
    }});};
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  return {proxy,stats:()=>({triggered,eventWrites})};
}
async function main(){try{await withFreshMysql(async target=>{
  const {pool,owner,database,containerId,port}=target;owned={owner,database,containerId,port};
  const f=await setup(target),{repo,actor,source}=f;let current,body,assessed,published;
  const row=async(sql,args=[])=>(await pool.execute(sql,args))[0][0];
  async function concurrentReaders(label,expectedAssessments){
    const tables=['data_map_handoff_requests','data_map_handoff_events','data_map_handoff_revisions','data_map_handoff_approvals','data_map_publications'];
    const counts=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await row('SELECT COUNT(*) n FROM '+table)).n])));
    const before=await counts(),rounds=[];
    for(let index=0;index<12;index++){
      const start=Date.now(),[draft,history,comparison,prompts]=await Promise.all([
        repo.get(current.draft.handoff_id,actor),repo.getSourceUpgradeAssessments(current.draft.handoff_id,actor),
        repo.sourceUpgradeStatus(actor,{packageId:source.oldPackageId,targetVersionId:source.newVersionId}),repo.sourceUpgradeStatus(actor)
      ]);
      assert.equal(draft.header.handoff_id,current.draft.handoff_id);assert.equal(draft.revision.binding_id,current.newBindingId);
      assert.equal(history.current_revision,Number(draft.header.current_revision));assert.equal(history.assessments.length,expectedAssessments);
      assert.equal(comparison.target_package_id,current.newPackageId);assert.deepEqual(comparison.counts,{added:4,modified:4,deleted:4,unchanged:4});
      assert.equal(prompts.processes.find(x=>x.document_id===source.documentId).current_process_version_id,source.newVersionId);
      rounds.push({round:index+1,elapsed_ms:Date.now()-start,handoff_revision:Number(draft.header.current_revision),assessments:history.assessments.length,comparison_digest:comparison.comparison_digest});
    }
    assert.deepEqual(await counts(),before,'parallel getters must not register requests or append business records');
    save('concurrent-readers-'+label+'.json',{same_actor:true,rounds,parallel_getters_per_round:4,total_successful_reads:rounds.length*4,deadlock_retries:0,business_counts:before});
  }
  const original=await row('SELECT source_content_hash,rule_version,status,revision_no FROM process_data_governance_work_packages WHERE id=?',[source.oldPackageId]);
  await check('current-version prompts show pending before explicit new package creation without changing old packages',async()=>{
    const result=await repo.sourceUpgradeStatus(actor),prompt=result.processes.find(x=>x.document_id===source.documentId);
    assert.equal(prompt.current_process_version_id,source.newVersionId);assert.equal(prompt.governance_status,'source_upgrade_pending');assert.equal(prompt.work_package_id,null);
    assert.equal(prompt.historical_packages[0].scope_mode,'historical');assert.equal(result.automatic_package_creation,false);
    assert.equal((await row('SELECT COUNT(*) n FROM process_data_governance_work_packages WHERE process_version_id=?',[source.newVersionId])).n,0);
  });
  await check('full semantic dependencies distinguish all four change classes and ignore only exact export file metadata',async()=>{
    const result=await repo.sourceUpgradeStatus(actor,{packageId:source.oldPackageId,targetVersionId:source.newVersionId});
    assert.deepEqual(result.counts,{added:4,modified:4,deleted:4,unchanged:4});
    const {old}=documents('semantic'),base=semanticIndex(old),meta=structuredClone(old);meta.export_meta.exported_at='other';meta.export_meta.package_ref='other';
    assert.deepEqual(semanticIndex(meta),base);
    for(const mutate of [x=>x.data_objects[0].data_name='Renamed',x=>x.data_objects[0].fields[0].field_type='number',x=>x.data_objects[0].fields[0].required=false,
      x=>x.data_objects[0].lifecycle.routes=[{route_ref:'route',events:[{event_ref:'event',trigger:{when:'changed'}}]}]]){
      const changed=structuredClone(old);mutate(changed);assert.notEqual(semanticIndex(changed).get('object:stable').semantic_digest,base.get('object:stable').semantic_digest);
    }
    const linked=structuredClone(old);linked.behaviors=[{behavior_ref:'perform',responsible_department:'A'}];linked.data_objects[0].behavior_links=[{link_ref:'link',behavior_ref:'perform',operation:'read'}];
    const before=semanticIndex(linked);linked.behaviors[0].responsible_department='B';assert.notEqual(semanticIndex(linked).get('object:stable').semantic_digest,before.get('object:stable').semantic_digest);
  });
  await check('explicit native create generate individual new conclusions and native review create a new bound draft without old approval',async()=>{
    current=await f.createNewPackage();assert.equal(String(current.created.package.process_version_id),source.newVersionId);assert.equal(current.generated.automatic_confirmation,false);
    assert.equal(current.reviewed.handoff.automatically_published,false);assert.equal((await repo.get(current.draft.handoff_id,actor)).header.current_approval_id,null);
    assert.deepEqual(await row('SELECT source_content_hash,rule_version,status,revision_no FROM process_data_governance_work_packages WHERE id=?',[source.oldPackageId]),original);
  });
  await check('same-actor draft assessment comparison and global prompt readers complete concurrent rounds before assessment without deadlock or writes',async()=>{
    await concurrentReaders('before-assessment',0);
  });
  await check('new source cannot submit approve or publish by bypassing the required complete difference assessment',async()=>{
    const value=await repo.get(current.draft.handoff_id,actor);assert(value.report.gates[3].issues.includes('SOURCE_UPGRADE_ASSESSMENT_REQUIRED'));
    await rejected(()=>repo.submit(current.draft.handoff_id,request({expected_revision:1}),actor),'HANDOFF_GATE_BLOCKED');
    assert.equal((await repo.get(current.draft.handoff_id,actor)).header.state,'draft');
  });
  await check('assessment rejects disabled read-only administrator department and unassigned actors before any write',async()=>{
    body=await f.assessmentBody(current.draft);const before=await row('SELECT COUNT(*) n FROM data_map_handoff_requests');
    for(const session of [{personId:'13',accountId:'113',authVersion:'1'},{personId:'14',accountId:'114',authVersion:'1'},{personId:'12',accountId:'112',authVersion:'1'}])await rejected(()=>repo.assessSourceUpgrade(current.draft.handoff_id,request({...body,request_id:crypto.randomUUID()}),session));
    for(const env of [{DATA_MAP_HANDOFF_ENABLED:'0'},{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'1'}])await assert.rejects(()=>createDataMapHandoffRepository(pool,{env}).assessSourceUpgrade(current.draft.handoff_id,body,actor),e=>['HANDOFF_DISABLED','HANDOFF_READ_ONLY'].includes(e.code));
    assert.deepEqual(await row('SELECT COUNT(*) n FROM data_map_handoff_requests'),before);
  });
  await check('comparison review version scope and four recheck categories reject incomplete or invented reuse',async()=>{
    for(const mutate of [x=>x.comparison_digest='0'.repeat(64),x=>x.decisions.pop(),x=>x.decisions.find(d=>d.change_kind==='unchanged').reuse_scope=['/invented'],
      x=>delete x.decisions[0].rechecks.impact,x=>x.decisions.find(d=>d.change_kind==='modified').reuse_scope=['/scope'],x=>x.decisions[0].source_detail_version_id=crypto.randomUUID()]){
      const input=structuredClone(body);input.request_id=crypto.randomUUID();mutate(input);await assert.rejects(()=>repo.assessSourceUpgrade(current.draft.handoff_id,input,actor),e=>[409,422].includes(e.statusCode));
    }
    assert.equal((await repo.getSourceUpgradeAssessments(current.draft.handoff_id,actor)).assessments.length,0);
  });
  await check('explicit complete assessment freezes exact reviewed old values and independently rechecked new conclusion versions',async()=>{
    assessed=await repo.assessSourceUpgrade(current.draft.handoff_id,body,actor);assert.equal(assessed.revision,2);
    const value=await repo.getSourceUpgradeAssessments(current.draft.handoff_id,actor),entry=value.assessments[0].snapshot;
    assert.deepEqual(value.current.issues,[]);assert.equal(entry.source_binding_id,f.oldReview.binding_id);assert.equal(entry.target_binding_id,current.newBindingId);
    assert.equal(entry.decisions.find(x=>x.change_kind==='unchanged').reused_values[0].pointer,'/scope');assert.equal(entry.source_review_status,'fixed_review_evidence');
    assert.equal((await repo.get(current.draft.handoff_id,actor)).report.ready_for_approval,true);
  });
  await check('same-actor concurrent readers preserve exact recorded source review and current draft without deadlock retries',async()=>{
    await concurrentReaders('after-assessment',1);
  });
  await check('original UUID replay and committed receipt stay exact while changed payload is rejected',async()=>{
    assert.deepEqual(await repo.assessSourceUpgrade(current.draft.handoff_id,body,actor),assessed);
    assert.equal((await repo.receipt(body.request_id,actor)).state,'committed');
    await rejected(()=>repo.assessSourceUpgrade(current.draft.handoff_id,{...body,basis:'changed'},actor),'HANDOFF_REQUEST_PAYLOAD_CONFLICT');
  });
  await check('new source is submitted checked separately approved and published and becomes currently available',async()=>{
    const submitted=await repo.submit(current.draft.handoff_id,request({expected_revision:assessed.revision}),actor);
    const checked=await repo.checks(current.draft.handoff_id,request({expected_revision:submitted.revision}),actor);assert(checked.report.ready_for_approval);
    const approved=await repo.approve(current.draft.handoff_id,request({expected_revision:submitted.revision,decision:'approved',basis:proof.basis,binding_digest:checked.report.binding_digest}),actor);
    published=await repo.publish(current.draft.handoff_id,request({expected_revision:submitted.revision,approval_id:approved.approval_id}),actor);
    const prompt=(await repo.sourceUpgradeStatus(actor)).processes.find(x=>x.document_id===source.documentId);assert.equal(prompt.governance_status,'governed');assert.equal(prompt.handoff_completed,true);
    save('publication.json',await repo.getPublication(published.publication_id,actor));
  });
  await check('an assigned new-package reader cannot retrieve old-package conclusions through trace or assessment history',async()=>{
    await pool.execute("INSERT INTO process_governance_responsibilities(target_type,target_id,assignment_kind,process_ref,person_id,department_id,revision_no,basis_text,actor_person_id) VALUES('work_package',?,'steward',?,12,91,1,'Synthetic new package only assignment',11)",[current.newPackageId,source.processRef]);
    const steward={personId:'12',accountId:'112',authVersion:'1'},trace=await repo.tracePackage(current.newPackageId,steward),event=trace.events.find(x=>x.event_type==='source_upgrade_assessed');
    assert(event.payload_json.source_context_redacted);assert(!JSON.stringify(event).includes('previous exact'));
    await rejected(()=>repo.getSourceUpgradeAssessments(current.draft.handoff_id,steward));
  });
  await check('same-document changed process identity cannot be mistaken for a source upgrade',async()=>{
    const [[oldRow]]=await pool.execute('SELECT process_content_json,content_hash FROM process_design_versions WHERE id=?',[source.oldVersionId]);
    const changed=structuredClone(parse(oldRow.process_content_json));changed.process.process_ref='renamed-identity';
    await pool.execute('UPDATE process_design_versions SET process_content_json=?,content_hash=? WHERE id=?',[json(changed),digest(changed),source.oldVersionId]);
    await pool.execute('UPDATE process_data_governance_work_packages SET source_content_hash=? WHERE id=?',[digest(changed),source.oldPackageId]);
    await rejected(()=>repo.sourceUpgradeStatus(actor,{packageId:source.oldPackageId,targetVersionId:source.newVersionId}),'HANDOFF_UPGRADE_PROCESS_MISMATCH');
    await pool.execute('UPDATE process_design_versions SET process_content_json=?,content_hash=? WHERE id=?',[oldRow.process_content_json,oldRow.content_hash,source.oldVersionId]);
    await pool.execute('UPDATE process_data_governance_work_packages SET source_content_hash=? WHERE id=?',[oldRow.content_hash,source.oldPackageId]);
  });
  await check('published fixed old evidence and original receipts remain unchanged when a later current source appears',async()=>{
    const later=structuredClone(source.next);later.data_objects[0].description='Synthetic next source change';const n=String(Number(source.newVersionId)+1);
    await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id) VALUES(?,?,?,'Synthetic Q9','later','Synthetic','synthetic','synthetic','synthetic',91)",[n,source.documentId,'SYN_Q9_'+source.documentId]);
    await pool.execute("UPDATE process_design_versions SET status='superseded' WHERE id=?",[source.newVersionId]);
    await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,status) VALUES(?,?,?,?,'Synthetic Q9','later',?,91,?,?,?,'published')",[n,n,source.documentId,'SYN_Q9_'+source.documentId,'SYN_Q9_LATER_'+n,later.schema_version,json(later),digest(later)]);
    await pool.execute('UPDATE process_design_documents SET current_version_id=? WHERE id=?',[n,source.documentId]);
    assert.deepEqual(await repo.assessSourceUpgrade(current.draft.handoff_id,body,actor),assessed);assert.equal((await repo.receipt(body.request_id,actor)).state,'committed');
    const prompt=(await repo.sourceUpgradeStatus(actor)).processes.find(x=>x.document_id===source.documentId);assert.equal(prompt.current_process_version_id,n);assert.equal(prompt.governance_status,'source_upgrade_pending');
    assert.equal((await repo.getPublication(published.publication_id,actor)).manifest.process_version_id,source.newVersionId);
  });
  let second,secondDraft,secondBody,secondAssessment;
  await check('later revision insertion failure rolls back assessment event draft dependency graph and keeps the original UUID retryable',async()=>{
    second=await setup(target,{preseeded:true,lead:actor,base:1200});secondDraft=await second.createNewPackage();secondBody=await second.assessmentBody(secondDraft.draft);
    const before=await row('SELECT current_revision,current_approval_id,state FROM data_map_handoff_drafts WHERE handoff_id=?',[secondDraft.draft.handoff_id]),graph=await row('SELECT graph_revision FROM data_map_governance_control');
    const fault=faultPool(pool,{failAppend:true}),faultRepo=createDataMapHandoffRepository(fault.proxy,{env:{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}});
    await rejected(()=>faultRepo.assessSourceUpgrade(secondDraft.draft.handoff_id,secondBody,actor),'SYNTHETIC_UPGRADE_APPEND_FAILURE');assert.equal(fault.stats().eventWrites,1);
    assert.deepEqual(await row('SELECT current_revision,current_approval_id,state FROM data_map_handoff_drafts WHERE handoff_id=?',[secondDraft.draft.handoff_id]),before);
    assert.deepEqual(await row('SELECT graph_revision FROM data_map_governance_control'),graph);
    assert.equal((await row('SELECT COUNT(*) n FROM data_map_handoff_events WHERE request_id=?',[secondBody.request_id])).n,0);
    assert.equal((await repo.receipt(secondBody.request_id,actor)).state,'prepared');
    secondAssessment=await repo.assessSourceUpgrade(secondDraft.draft.handoff_id,secondBody,actor);assert.equal(secondAssessment.revision,2);
    assert.equal((await row('SELECT COUNT(*) n FROM data_map_handoff_events WHERE request_id=?',[secondBody.request_id])).n,1);
  });
  await check('draft content changes invalidate prior assessment and exact re-assessment restores current readiness',async()=>{
    const value=await repo.get(secondDraft.draft.handoff_id,actor),draft=structuredClone(value.revision.snapshot_json);draft.items[0].definition.business_meaning+=' updated';
    await repo.saveDraft(secondDraft.draft.handoff_id,request({expected_revision:Number(value.header.current_revision),draft}),actor);
    const changed=await repo.get(secondDraft.draft.handoff_id,actor);assert(changed.report.gates[3].issues.includes('SOURCE_UPGRADE_REASSESSMENT_REQUIRED'));
    const fresh=await second.assessmentBody(secondDraft.draft);
    for(const decision of fresh.decisions)if(decision.change_kind==='unchanged'){decision.decision='recheck';decision.reuse_scope=[];}
    secondAssessment=await repo.assessSourceUpgrade(secondDraft.draft.handoff_id,fresh,actor);
    const recorded=(await repo.getSourceUpgradeAssessments(secondDraft.draft.handoff_id,actor)).assessments.at(-1).snapshot;
    assert.equal(recorded.source_binding_id,second.oldReview.binding_id);assert(recorded.decisions.every(x=>x.reused_values.length===0));
    assert.equal((await repo.get(secondDraft.draft.handoff_id,actor)).report.ready_for_approval,true);
  });
  await check('a separately reviewed new binding invalidates prior assessment even when draft content stays identical',async()=>{
    const value=await repo.get(secondDraft.draft.handoff_id,actor),correction=await repo.createCorrection(secondDraft.newPackageId,request({expected_revision:0,replaces_binding_id:value.revision.binding_id,
      reason:'Synthetic current review basis rechecked',...proof}),actor);
    const reviewed=await repo.reviewCorrection(correction.correction_id,request({expected_revision:correction.revision,...proof}),actor);
    await repo.rebase(secondDraft.draft.handoff_id,request({expected_revision:Number(value.header.current_revision),binding_id:reviewed.binding_id,basis:proof.basis}),actor);
    const stale=await repo.get(secondDraft.draft.handoff_id,actor);assert(stale.report.gates[3].issues.includes('SOURCE_UPGRADE_REASSESSMENT_REQUIRED'));
    const input=await second.assessmentBody(secondDraft.draft);await repo.assessSourceUpgrade(secondDraft.draft.handoff_id,input,actor);
    assert.equal((await repo.get(secondDraft.draft.handoff_id,actor)).report.ready_for_approval,true);
  });
  await check('immutable assessment payload or deleted event cannot silently become trusted new history',async()=>{
    const fixed=await row("SELECT event_id,payload_json FROM data_map_handoff_events WHERE handoff_id=? AND event_type='source_upgrade_assessed' ORDER BY created_at DESC LIMIT 1",[secondDraft.draft.handoff_id]);
    const payload=structuredClone(parse(fixed.payload_json));payload.snapshot.basis='tampered';
    await pool.execute('UPDATE data_map_handoff_events SET payload_json=? WHERE event_id=?',[json(payload),fixed.event_id]);
    await rejected(()=>repo.getSourceUpgradeAssessments(secondDraft.draft.handoff_id,actor),'HANDOFF_UPGRADE_HISTORY_INVALID');
    await pool.execute('UPDATE data_map_handoff_events SET payload_json=? WHERE event_id=?',[fixed.payload_json,fixed.event_id]);
    const connection=await pool.getConnection();try{await connection.beginTransaction();await connection.execute('DELETE FROM data_map_handoff_events WHERE event_id=?',[fixed.event_id]);
      await rejected(()=>require('../server/dataMapSourceUpgrade').assessments(connection,secondDraft.draft.handoff_id),'HANDOFF_UPGRADE_HISTORY_INVALID');await connection.rollback();}finally{connection.release();}
  });
  let independent,independentDraft;
  await check('unfinished historical package without a reusable review has explicit no-reuse full recheck without inventing old approval',async()=>{
    independent=await setup(target,{preseeded:true,lead:actor,base:1300,reviewOld:false});
    await pool.execute("UPDATE process_data_governance_work_packages SET status='mdm_governing' WHERE id=?",[independent.source.oldPackageId]);
    const newer=await independent.createNewPackage(),input=await independent.assessmentBody(newer.draft);independentDraft=newer;
    assert.equal(input.source_binding_id,null);assert(input.decisions.every(x=>x.decision!=='reference_and_recheck'&&x.reuse_scope.length===0));
    await repo.assessSourceUpgrade(newer.draft.handoff_id,input,actor);
    const assessment=(await repo.getSourceUpgradeAssessments(newer.draft.handoff_id,actor)).assessments[0].snapshot;assert.equal(assessment.source_review_status,'no_reusable_review');
    assert.equal(assessment.source_package_status,'mdm_governing');assert.equal(assessment.source_binding_id,null);assert.equal((await repo.get(newer.draft.handoff_id,actor)).report.ready_for_approval,true);
    assert.equal((await row('SELECT COUNT(*) n FROM process_data_governance_review_bindings WHERE package_id=?',[independent.source.oldPackageId])).n,0);
    assert.equal((await row('SELECT status FROM process_data_governance_work_packages WHERE id=?',[independent.source.oldPackageId])).status,'mdm_governing');
  });
  await check('source corruption still permits explicit approval revocation while fixed assessment and positive publication gates remain blocked',async()=>{
    const handoffId=independentDraft.draft.handoff_id,value=await repo.get(handoffId,actor),submitted=await repo.submit(handoffId,request({expected_revision:Number(value.header.current_revision)}),actor);
    const checked=await repo.checks(handoffId,request({expected_revision:submitted.revision}),actor),approved=await repo.approve(handoffId,request({expected_revision:submitted.revision,decision:'approved',basis:proof.basis,binding_digest:checked.report.binding_digest}),actor);
    const version=independent.source.newVersionId,fixed=await row('SELECT content_hash FROM process_design_versions WHERE id=?',[version]);
    await pool.execute('UPDATE process_design_versions SET content_hash=? WHERE id=?',['0'.repeat(64),version]);
    try{
      assert.equal((await repo.get(handoffId,actor)).report.ready_for_approval,false);
      const revoked=await repo.withdraw(handoffId,request({expected_revision:approved.revision,intent:'revoke_approval',reason:'Synthetic integrity stop'}),actor);assert.equal(revoked.state,'draft');
      assert.equal((await row('SELECT current_approval_id FROM data_map_handoff_drafts WHERE handoff_id=?',[handoffId])).current_approval_id,null);
      const revision=await row('SELECT dependency_manifest_json FROM data_map_handoff_revisions WHERE revision_id=?',[revoked.revision_id]);assert(parse(revision.dependency_manifest_json).source_upgrade.issues.includes('SOURCE_UPGRADE_SOURCE_INTEGRITY_BLOCKED'));
      await assert.rejects(()=>repo.submit(handoffId,request({expected_revision:revoked.revision}),actor));
    }finally{await pool.execute('UPDATE process_design_versions SET content_hash=? WHERE id=?',[fixed.content_hash,version]);}
    assert.equal((await repo.get(handoffId,actor)).report.ready_for_approval,false);
  });
  await check('an actual graph lock wait rechecks a newly published current target and rejects the stale source assessment',async()=>{
    const input=await second.assessmentBody(secondDraft.draft),blocker=await pool.getConnection();let notify;const attempted=new Promise(resolve=>{notify=resolve;});
    const fault=faultPool(pool,{onGraph:notify}),waitingRepo=createDataMapHandoffRepository(fault.proxy,{env:{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}});let waiting;
    try{await blocker.beginTransaction();await require('../server/dataMapHandoffControl').lockGraph(blocker);
      waiting=waitingRepo.assessSourceUpgrade(secondDraft.draft.handoff_id,input,actor).then(value=>({ok:true,value}),error=>({ok:false,code:error.code}));
      const connectionId=await attempted;let waits=[];
      for(let index=0;index<160&&!waits.length;index++){
        [waits]=await pool.execute(`SELECT r.OBJECT_NAME,r.LOCK_MODE,t.PROCESSLIST_ID requesting_connection,bt.PROCESSLIST_ID blocking_connection
          FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
          JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=r.THREAD_ID
          JOIN performance_schema.threads bt ON bt.THREAD_ID=b.THREAD_ID WHERE r.OBJECT_SCHEMA=? AND r.OBJECT_NAME='data_map_governance_control' AND t.PROCESSLIST_ID=?`,[database,connectionId]);
        if(!waits.length)await new Promise(resolve=>setTimeout(resolve,25));
      }
      assert(waits.length,'actual performance_schema graph-row wait observed');save('graph-wait.json',{waits});
      const s=second.source,n=String(Number(s.newVersionId)+1),later=structuredClone(s.next);later.data_objects[0].description='next current actual wait';
      await blocker.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id) VALUES(?,?,?,'Synthetic Q9','later','Synthetic','synthetic','synthetic','synthetic',91)",[n,s.documentId,'SYN_Q9_'+s.documentId]);
      await blocker.execute("UPDATE process_design_versions SET status='superseded' WHERE id=?",[s.newVersionId]);
      await blocker.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,status) VALUES(?,?,?,?,'Synthetic Q9','later',?,91,?,?,?,'published')",[n,n,s.documentId,'SYN_Q9_'+s.documentId,'SYN_Q9_LATER_'+n,later.schema_version,json(later),digest(later)]);
      await blocker.execute('UPDATE process_design_documents SET current_version_id=? WHERE id=?',[n,s.documentId]);await blocker.commit();
      assert.deepEqual(await waiting,{ok:false,code:'HANDOFF_UPGRADE_TARGET_NOT_CURRENT'});
      assert.equal((await repo.receipt(input.request_id,actor)).state,'rejected');assert.equal((await row('SELECT COUNT(*) n FROM data_map_handoff_events WHERE request_id=?',[input.request_id])).n,0);
    }finally{await blocker.rollback().catch(()=>{});blocker.release();if(waiting)await waiting;}
  });
  await check('a superseded assessed source can explicitly recheck and publish historical scope after a later version is released',async()=>{
    const value=await repo.get(secondDraft.draft.handoff_id,actor),draft=structuredClone(value.revision.snapshot_json);draft.scope_mode='historical';
    await repo.saveDraft(secondDraft.draft.handoff_id,request({expected_revision:Number(value.header.current_revision),draft}),actor);
    const input=await second.assessmentBody(secondDraft.draft);await repo.assessSourceUpgrade(secondDraft.draft.handoff_id,input,actor);
    const ready=await repo.get(secondDraft.draft.handoff_id,actor);assert.equal(ready.report.ready_for_approval,true);
    const submitted=await repo.submit(secondDraft.draft.handoff_id,request({expected_revision:Number(ready.header.current_revision)}),actor),checked=await repo.checks(secondDraft.draft.handoff_id,request({expected_revision:submitted.revision}),actor);
    const approved=await repo.approve(secondDraft.draft.handoff_id,request({expected_revision:submitted.revision,decision:'approved',basis:proof.basis,binding_digest:checked.report.binding_digest}),actor);
    const historical=await repo.publish(secondDraft.draft.handoff_id,request({expected_revision:submitted.revision,approval_id:approved.approval_id}),actor);
    assert.equal((await repo.getPublication(historical.publication_id,actor)).manifest.scope_mode,'historical');
  });
  await check('actual Q10 restoration into a later source package cannot bypass the required Q9 difference assessment',async()=>{
    const laterVersion=String(Number(source.newVersionId)+1),target=await f.createNewPackage({versionId:laterVersion});
    const original=await repo.getPublication(published.publication_id,actor),reason='Synthetic cross-version restoration assessment check';
    const checked=await repo.withdrawalChecks(published.publication_id,request({expected_revision:1,reason}),actor);
    const approval=await repo.approveWithdrawal(published.publication_id,request({expected_revision:1,reason,binding_digest:checked.report.binding_digest,basis:proof.basis}),actor);
    await repo.withdrawPublication(published.publication_id,request({expected_revision:1,reason,withdrawal_approval_id:approval.withdrawal_approval_id}),actor);
    const body=structuredClone(target.body);
    for(const item of body.items){const previous=original.manifest.items.find(x=>x.item_ref===item.item_ref);item.target_id=previous.target_id;
      if(['object','field','data_element'].includes(item.target_kind)){item.operation='modify';delete item.target_version_ref;item.base_version_ref=previous.target_version_ref;}}
    const restored=await repo.restorePublication(published.publication_id,request({expected_revision:2,target_package_id:target.newPackageId,target_handoff_id:target.draft.handoff_id,
      expected_target_revision:target.draft.revision,scope_mode:'current',draft:body,...proof,
      item_mappings:original.manifest.items.map(x=>({source_item_ref:x.item_ref,target_item_ref:x.item_ref,content_decision:'adopt',...proof}))}),actor);
    const value=await repo.get(restored.handoff_id,actor);assert(value.revision.snapshot_json.restores_publication_id);
    assert.equal(value.revision.snapshot_json.restoration.target_package_id,target.newPackageId);assert.notEqual(target.newPackageId,original.package_id);
    assert.equal(value.report.process_version_id,laterVersion);assert.notEqual(value.report.process_version_id,original.manifest.process_version_id);
    assert(value.report.gates[3].issues.includes('SOURCE_UPGRADE_ASSESSMENT_REQUIRED'));assert.equal(value.report.ready_for_approval,false);
    await rejected(()=>repo.submit(restored.handoff_id,request({expected_revision:restored.revision}),actor),'HANDOFF_GATE_BLOCKED');
    assert.equal((await repo.getPublication(published.publication_id,actor)).state,'withdrawn');
    save('cross-source-restoration-blocked.json',{restoration:restored,report:value.report,source_publication_id:original.publication_id,
      source_package_id:original.package_id,source_process_version_id:original.manifest.process_version_id,target_package_id:target.newPackageId,target_process_version_id:laterVersion});
  });
  passed=true;
},{stage:'84',randomDatabase:true});}catch(error){failure={code:error.code||null,message:error.message,stack:error.stack};throw error;}finally{save('results.json',{scope:'synthetic owned loopback tmpfs MySQL only',passed,checks,owned,owned_removed:true,failure,formal_database_connected:false,deployed:false,feature_activated:false});console.log('EVIDENCE '+output);}}
main().catch(error=>{console.error(error);process.exitCode=1;});
