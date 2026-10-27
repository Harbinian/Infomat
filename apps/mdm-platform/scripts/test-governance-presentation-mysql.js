// Exact-source labels and event-time names on a caller-owned tmpfs MySQL only.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed,draftBody}=require('./testHelpers/dataMapHandoffFixture');
const {digest,json,parse}=require('../server/dataMapHandoffPolicy');
const {buildGovernanceCandidates}=require('../server/processDataGovernance');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {makeProcessDataGovernanceRepository}=require('../server/processDataGovernanceRepository');
const output=path.resolve(process.argv[2]||'');
assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output),'new evidence directory required');fs.mkdirSync(output,{recursive:true});
const checks=[];let owned,passed=false,failure;
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const request=value=>({request_id:crypto.randomUUID(),...value});
async function check(name,work){await work();checks.push({name,passed:true});save('progress.json',{checks});console.log('PASS '+name);}
async function main(){try{await withFreshMysql(async target=>{
  const {pool,owner,database,containerId,port}=target;owned={owner,database,containerId,port,storage:'fresh owner-labelled tmpfs'};
  const fixture=await seed(target),lead=fixture.session(11),steward=fixture.session(12),department=fixture.session(14);
  const repo=createDataMapHandoffRepository(pool,{env:{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}});
  const query=async(sql,args=[])=>(await pool.execute(sql,args))[0];
  const original=await fixture.packageSeed(701),source=original.source;
  source.process.process_name='合成申请办理流程';source.behaviors=[{behavior_ref:'prepare',behavior_name:'填写申请'},{behavior_ref:'check',behavior_name:'核对申请'}];
  source.data_objects=[{data_ref:'source_1',data_name:'合成申请记录',fields:[],behavior_links:[{link_ref:'prepare_link',behavior_ref:'prepare',operations:['create']},{link_ref:'check_link',behavior_ref:'check',operations:['use']}]}];
  const candidates=buildGovernanceCandidates(source),object=candidates.find(row=>row.detail_type==='data_object_identity'),flows=candidates.filter(row=>row.detail_type==='data_flow');
  const hash=digest(source);await query("UPDATE process_design_versions SET process_content_json=?,content_hash=?,document_title='合成申请制度',edition='A' WHERE id=701",[json(source),hash]);
  await query('UPDATE process_data_governance_work_packages SET source_content_hash=? WHERE id=701',[hash]);
  await query('UPDATE process_data_governance_details SET source_snapshot_digest=? WHERE id=701',[object.source_digest]);
  for(const [i,item] of flows.entries())await query("INSERT INTO process_data_governance_details(id,work_package_id,detail_ref,detail_type,source_ref,parent_source_ref,responsible_department_id,source_snapshot_digest,candidate_rule_code,candidate_json,governance_json,status) VALUES(?,701,?,'data_flow',?,?,91,?,?,?,?,'confirmed')",[7011+i,item.detail_ref,item.source_ref,item.parent_source_ref,item.source_digest,item.rule_code,json(item.candidate),json({basis:'明确合成前提：使用环节已核对'})]);
  const oldReviews=await query('SELECT * FROM process_data_governance_reviews WHERE work_package_id=701');
  const intake=await repo.prepareIntake('701',request({expected_revision:0}),steward);
  const reviewed=await repo.reviewIntake(intake.intake_id,request({expected_revision:1,basis:'明确合成前提：固定材料已核验',detail_evidence:intake.required_detail_evidence.map(row=>({...row,basis:'合成来源核对',evidence_refs:['synthetic:source']}))}),lead);
  const body=draftBody();body.items.forEach(item=>item.source_detail_refs=[object.detail_ref,...flows.map(row=>row.detail_ref)]);
  const draft=await repo.fromWorkPackage('701',request({expected_revision:0,binding_id:reviewed.binding_id,draft:body}),steward);
  await check('fixed source and all exact binding details have readable names without changing signed evidence',async()=>{
    const before=await query('SELECT snapshot_json,binding_digest FROM process_data_governance_review_bindings WHERE package_id=701'),trace=await repo.tracePackage('701',lead);
    assert.equal(trace.source.process_name,'合成申请办理流程');assert.equal(trace.work_package.document_title,'合成申请制度');assert.equal(trace.source.edition,'A');
    const binding=trace.bindings[0];assert.equal(trace.detail_sources.length,3);
    for(const item of binding.snapshot_json.detail_versions){const display=trace.detail_sources.find(row=>row.detail_version_id===item.detail_version_id);assert.equal(display.source.data_name,'合成申请记录');assert.equal(digest(binding.snapshot_json),binding.binding_digest);}
    assert.deepEqual(trace.detail_sources.filter(row=>row.source.behavior_name).map(row=>row.source.behavior_name).sort(),['填写申请','核对申请']);
    assert.deepEqual(await query('SELECT snapshot_json,binding_digest FROM process_data_governance_review_bindings WHERE package_id=701'),before);assert.deepEqual(await query('SELECT * FROM process_data_governance_reviews WHERE work_package_id=701'),oldReviews);
    save('fixed-source-projection.json',{source:trace.source,detail_sources:trace.detail_sources});
  });
  let approval,published;
  await check('new approval and publication retain verified event-time names after a person rename; qualification hashes remain valid',async()=>{
    await query("UPDATE person SET person_name='合成组长办理时姓名' WHERE person_id=11");
    await repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),steward);
    const current=await repo.get(draft.handoff_id,lead),report=await repo.checks(draft.handoff_id,request({expected_revision:current.header.current_revision}),lead);
    approval=await repo.approve(draft.handoff_id,request({expected_revision:current.header.current_revision,decision:'approved',basis:'合成批准依据',binding_digest:report.report.binding_digest}),lead);
    published=await repo.publish(draft.handoff_id,request({expected_revision:current.header.current_revision,approval_id:approval.approval_id}),lead);
    const before=await query('SELECT manifest_json,manifest_digest FROM data_map_publications');
    await query("UPDATE person SET person_name='合成组长后来姓名' WHERE person_id=11");
    const trace=await repo.tracePackage('701',lead),approvalRow=trace.approvals.find(row=>row.approval_id===approval.approval_id);
    assert.equal(approvalRow.actor_snapshot.person_name,'合成组长办理时姓名');
    const qual=approvalRow.actor_json;assert.equal(digest(Object.fromEntries(Object.entries(qual).filter(([key])=>key!=='qualification_digest'))),qual.qualification_digest);assert(!Object.hasOwn(qual,'person_name'));
    const publication=await repo.getPublication(published.publication_id,lead);assert.equal(publication.events[0].payload.actor_snapshot.person_name,'合成组长办理时姓名');
    assert.deepEqual(await query('SELECT manifest_json,manifest_digest FROM data_map_publications'),before);
  });
  await check('package-assigned reader retains exact publication access while unrelated department and lost assignment are denied',async()=>{
    assert.equal((await repo.getPublication(published.publication_id,steward)).publication_id,published.publication_id);
    await assert.rejects(()=>repo.tracePackage('701',department),error=>error.statusCode===403);
    await query('UPDATE process_governance_responsibilities SET person_id=15 WHERE target_id=701');
    await assert.rejects(()=>repo.tracePackage('701',steward),error=>error.statusCode===403);
    await query('UPDATE process_governance_responsibilities SET person_id=12 WHERE target_id=701');
  });
  await check('new native governance event and review display snapshots use exact original event, preserving old rows',async()=>{
    await fixture.packageSeed(703,{status:'mdm_review'});const native=makeProcessDataGovernanceRepository(pool);
    const old=await query('SELECT * FROM process_data_governance_reviews WHERE work_package_id=701');
    await query("UPDATE person SET person_name='合成原生审核时姓名' WHERE person_id=11");
    await native.completeWorkPackage('703',1,'合成原生审核依据',lead,{request_id:crypto.randomUUID()});
    await query("UPDATE person SET person_name='合成原生后来姓名' WHERE person_id=11");
    const detail=await native.getWorkPackageDetail('703');assert.equal(detail.reviews[0].actor_snapshot.person_name,'合成原生审核时姓名');
    assert.equal(detail.events.find(row=>row.event_type==='mdm_workgroup_review_approved').payload.actor_snapshot.person_name,'合成原生审核时姓名');
    assert.deepEqual(await query('SELECT * FROM process_data_governance_reviews WHERE work_package_id=701'),old);
    assert.equal((await native.getWorkPackageDetail('701')).reviews[0].actor_snapshot,null);
  });
  await check('current source prompts and historical package names stay tied to their respective fixed source',async()=>{
    await query("UPDATE process_design_versions SET status='superseded' WHERE id=701");await fixture.packageSeed(702,{documentId:701});
    const next=await query('SELECT process_content_json FROM process_design_versions WHERE id=702'),document=parse(next[0].process_content_json);document.process.process_name='合成新版申请流程';
    const nextHash=digest(document);await query("UPDATE process_design_versions SET document_title='合成新版制度',edition='B',process_content_json=?,content_hash=? WHERE id=702",[json(document),nextHash]);await query('UPDATE process_data_governance_work_packages SET source_content_hash=? WHERE id=702',[nextHash]);
    const prompts=await repo.sourceUpgradeStatus(lead),process=prompts.processes.find(row=>row.document_id==='701');
    assert.equal(process.process_name,'合成新版申请流程');assert.equal(process.edition,'B');assert.equal(process.historical_packages[0].process_name,'合成申请办理流程');
    const trace=await repo.tracePackage('701',lead);assert.equal(trace.source.process_name,'合成申请办理流程');assert.equal(trace.source.edition,'A');
  });
  await check('real TIMESTAMP and explicit UTC DATETIME projections are identical under UTC and Asia/Shanghai Node hosts, without rewriting stored history',async()=>{
    const cp=require('node:child_process'),reader=path.join(__dirname,'test-governance-time-reader.js');
    const before=await query('SELECT snapshot_json,binding_digest FROM process_data_governance_review_bindings WHERE package_id=701'),publicationsBefore=await query('SELECT manifest_json,manifest_digest FROM data_map_publications');
    const read=TZ=>JSON.parse(cp.execFileSync(process.execPath,[reader],{input:JSON.stringify({port,password:target.password,database,lead,publicationId:published.publication_id}),env:{...process.env,TZ},encoding:'utf8',windowsHide:true,timeout:30000,stdio:['pipe','pipe','pipe']}));
    const utc=read('UTC'),shanghai=read('Asia/Shanghai');assert.notEqual(utc.rawDriverReview,shanghai.rawDriverReview,'test must exercise the original driver timezone difference');assert.deepEqual(utc.result,shanghai.result);
    assert.equal(utc.result.nativeReview,utc.expectedNativeReview);assert.equal(utc.result.published[0],utc.expectedPublication);
    assert.deepEqual(await query('SELECT snapshot_json,binding_digest FROM process_data_governance_review_bindings WHERE package_id=701'),before);assert.deepEqual(await query('SELECT manifest_json,manifest_digest FROM data_map_publications'),publicationsBefore);
    save('cross-node-timezones.json',{utc,shanghai});
  });
}, {stage:'88',randomDatabase:true});passed=true;}catch(error){failure={name:error.name,message:error.message,code:error.code,stack:error.stack};console.error(error.stack);}finally{save('results.json',{passed,checks,owned,cleanup:'withFreshMysql finally owns and removes its tmpfs target',failure});}if(!passed)process.exitCode=1;}
main();
