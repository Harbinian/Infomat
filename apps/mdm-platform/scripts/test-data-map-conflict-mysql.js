// Q6 actual v4/v5 workflow and compatibility on fresh caller-owned tmpfs MySQL.
// Usage: node scripts/test-data-map-conflict-mysql.js [new artifacts directory].
// Synthetic materials only; no config files, formal DB, migration or activation.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {setup,request,proof}=require('./testHelpers/dataMapHandoffConflictFixture');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {json,parse,digest}=require('../server/dataMapHandoffPolicy');
const output=path.resolve(process.argv[2]||path.join(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-04/conflict-mysql-'+crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const checks=[];let owned,passed=false,failure;
const save=(name,data)=>fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2)+'\n');
async function check(name,work){await work();checks.push(name);console.log('PASS '+name);save('progress.json',{checks});}
const denied=(work,code)=>assert.rejects(work,error=>code?error.code===code:error.statusCode===403);
async function main(){try{await withFreshMysql(async target=>{
  const {pool,owner,database,containerId,port}=target;owned={owner,database,containerId,port};
  const f=await setup(target),{repo,actors:a}=f,rows=async(sql,args=[])=>(await pool.execute(sql,args))[0];
  let draft=await f.draft(951),ordinary,viewBody,viewResult,firstFact,confirmedBody,confirmedResult;
  await check('disabled read-only admin overlap and unassigned identities cannot open conflicts or register writes',async()=>{
    const [[before]]=await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_requests');
    for(const who of [a.admin,a.adminHandler,a.adminDecider,a.contactA,a.unassignedSteward])await denied(()=>repo.createConflict(draft.handoff_id,f.conflictBody(draft),who));
    for(const env of [{DATA_MAP_HANDOFF_ENABLED:'0'},{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'1'}])await assert.rejects(()=>createDataMapHandoffRepository(pool,{env}).createConflict(draft.handoff_id,f.conflictBody(draft),a.lead),e=>['HANDOFF_DISABLED','HANDOFF_READ_ONLY'].includes(e.code));
    const [[after]]=await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_requests');assert.equal(after.n,before.n);
  });
  await check('conflicts have accurate subject scope independent revision and complete immutable opening evidence',async()=>{
    ordinary=await repo.createConflict(draft.handoff_id,f.conflictBody(draft),a.steward);assert.equal(ordinary.state,'open');assert.equal(ordinary.revision,1);
    const value=await repo.getConflict(ordinary.conflict_id,a.lead);assert(value.history_complete);assert.equal(value.events.length,1);assert.equal(value.subject_items.length,1);
    assert.equal((await repo.listConflicts(draft.handoff_id,a.steward)).conflicts.length,1);
    const report=await repo.get(draft.handoff_id,a.lead);assert(report.report.gates[3].issues.some(x=>x.startsWith('CONFLICT_OPEN')));
    await denied(()=>repo.getConflict(ordinary.conflict_id,a.handler));await denied(()=>repo.getConflict(ordinary.conflict_id,a.contactA));
  });
  await check('leader assignment qualifies actual targets and failed assignments roll back projection and events',async()=>{
    const before=await f.current(ordinary.conflict_id);
    for(const person of ['13','25','999999'])await assert.rejects(()=>f.act(ordinary.conflict_id,'assign',{assignee_person_id:person}),e=>e.statusCode===403||e.statusCode===422);
    assert.deepEqual(await f.current(ordinary.conflict_id),before);
    await f.act(ordinary.conflict_id,'assign',{assignee_person_id:'16'});
    const value=await repo.getConflict(ordinary.conflict_id,a.handler);assert(value.allowed_actions.includes('resolve'));
    await denied(()=>repo.get(draft.handoff_id,a.handler));await denied(()=>repo.getConflict(ordinary.conflict_id,a.otherHandler));
  });
  await check('assigned handler viewpoint and original receipt are scoped stable and cannot be changed by another identity',async()=>{
    const current=await f.current(ordinary.conflict_id);
    viewBody=request({expected_revision:current.revision,expected_handoff_revision:current.current_handoff_revision,action:'viewpoint',viewpoint:'Synthetic independent proposed meaning',...proof});
    viewResult=await repo.actConflict(ordinary.conflict_id,viewBody,a.handler);
    assert.deepEqual(await repo.actConflict(ordinary.conflict_id,viewBody,a.handler),viewResult);
    assert.equal((await repo.receipt(viewBody.request_id,a.handler)).state,'committed');
    await denied(()=>repo.receipt(viewBody.request_id,a.otherHandler));await denied(()=>repo.receipt(viewBody.request_id,a.contactA));
    await denied(()=>repo.actConflict(ordinary.conflict_id,{...viewBody,viewpoint:'changed'},a.handler),'HANDOFF_REQUEST_PAYLOAD_CONFLICT');
    await denied(()=>repo.actConflict(ordinary.conflict_id,viewBody,a.otherHandler),'HANDOFF_REQUEST_PAYLOAD_CONFLICT');
  });
  await check('ordinary coordination resolves only the dispute and cannot bypass separate departmental rechecks',async()=>{
    await denied(()=>f.act(ordinary.conflict_id,'resolve',{resolution:'invalid steward decision'},a.steward));
    const result=await f.act(ordinary.conflict_id,'resolve',{resolution:{definition:'Synthetic coordinated meaning'}},a.handler);assert.equal(result.state,'resolved');
    await denied(()=>f.act(ordinary.conflict_id,'verify',{},a.steward),'HANDOFF_CONFLICT_FACT_RECHECK_REQUIRED');
    await denied(()=>f.act(ordinary.conflict_id,'verify',{fact_recheck:{not_applicable:true,...proof}},a.steward),'HANDOFF_CONFLICT_FACT_RECHECK_REQUIRED');
    assert.equal((await f.current(ordinary.conflict_id)).state,'resolved');
  });
  await check('each department has a directed fact and ordinary answers cannot impersonate final confirmation',async()=>{
    firstFact=await f.openFact(ordinary.conflict_id,'91');
    const own=await repo.getFact(firstFact.fact_id,a.contactA);assert.equal(own.status,'open');assert(own.allowed_actions.includes('answer'));assert(!('conflict' in own));assert(!('subject_items' in own));
    await denied(()=>repo.getFact(firstFact.fact_id,a.contactB));await denied(()=>repo.getFact(firstFact.fact_id,a.reviewerB));
    const answered=await repo.answerFact(firstFact.fact_id,await f.factBody(firstFact.fact_id,{answer_text:'Synthetic A facts',evidence_refs:proof.evidence_refs}),a.contactA);
    assert(!('conflict' in answered));assert(!('events' in (await repo.receipt(answered.request_id,a.contactA)).result));
    await denied(async()=>repo.closeFact(firstFact.fact_id,await f.factBody(firstFact.fact_id,proof),a.steward),'HANDOFF_FACT_NOT_CONFIRMED');
    const answer=await repo.getFact(firstFact.fact_id,a.reviewerA);
    const input={answered_fact_version_id:answer.fact_version_id,answered_snapshot_digest:answer.snapshot_digest,...proof};
    for(const who of [a.contactA,a.otherReviewerA,a.reviewerB,a.lead])await denied(async()=>repo.confirmFact(firstFact.fact_id,await f.factBody(firstFact.fact_id,input),who));
    await denied(async()=>repo.confirmFact(firstFact.fact_id,await f.factBody(firstFact.fact_id,{...input,answered_snapshot_digest:'0'.repeat(64)}),a.reviewerA),'HANDOFF_FACT_ANSWER_CHANGED');
    confirmedBody=await f.factBody(firstFact.fact_id,input);confirmedResult=await repo.confirmFact(firstFact.fact_id,confirmedBody,a.reviewerA);assert.equal(confirmedResult.status,'confirmed');
    assert(!('conflict' in confirmedResult));assert(!('conflict' in (await repo.receipt(confirmedResult.request_id,a.reviewerA)).result));
    const closed=await repo.closeFact(firstFact.fact_id,await f.factBody(firstFact.fact_id,proof),a.steward);assert.equal(closed.status,'closed');
    assert.deepEqual(await repo.confirmFact(firstFact.fact_id,confirmedBody,a.reviewerA),confirmedResult);assert.equal((await repo.receipt(closed.request_id,a.steward)).state,'committed');
  });
  await check('verification requires every affected department then freezes current facts in a new unapproved draft revision',async()=>{
    await denied(()=>f.act(ordinary.conflict_id,'verify',{},a.steward),'HANDOFF_CONFLICT_FACT_RECHECK_REQUIRED');
    const second=await f.openFact(ordinary.conflict_id,'92');await f.completeFact(second.fact_id,'92');
    const verified=await f.act(ordinary.conflict_id,'verify',{},a.steward);assert.equal(verified.state,'verified');assert.equal(verified.handoff_revision,2);
    draft={...draft,revision:verified.handoff_revision};const value=await repo.get(draft.handoff_id,a.lead);assert(value.report.ready_for_approval,JSON.stringify(value.report.gates));
    assert.equal(value.header.current_approval_id,null);assert.equal((await rows('SELECT publication_id FROM data_map_publications')).length,0);
  });
  await check('changed draft content invalidates verification and reopening requires new independent fact versions',async()=>{
    const value=await repo.get(draft.handoff_id,a.lead),body=value.revision.snapshot_json;body.items[0].definition.business_meaning='Synthetic changed governed meaning';
    draft=await repo.saveDraft(draft.handoff_id,request({expected_revision:draft.revision,draft:body}),a.steward);
    const changed=await repo.get(draft.handoff_id,a.lead);assert(changed.report.gates[3].issues.some(x=>x.startsWith('CONFLICT_VERIFICATION_STALE')));
    await denied(()=>repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),a.steward),'HANDOFF_GATE_BLOCKED');
    await f.act(ordinary.conflict_id,'reopen');await f.act(ordinary.conflict_id,'resolve',{resolution:'Synthetic revised coordinated meaning'});
    assert.equal((await repo.getFact(firstFact.fact_id,a.contactA)).applicability,'superseded_round_or_result');
    await denied(()=>f.act(ordinary.conflict_id,'verify',{},a.steward),'HANDOFF_CONFLICT_FACT_RECHECK_REQUIRED');
    const verified=await f.recheck(ordinary.conflict_id);draft.revision=verified.handoff_revision;
    assert((await repo.get(draft.handoff_id,a.lead)).report.ready_for_approval);
  });
  await check('MDM work reassignment does not fabricate a change to unchanged departmental fact confirmation',async()=>{
    await pool.execute("UPDATE process_governance_responsibilities SET person_id=24,revision_no=revision_no+1 WHERE target_type='work_package' AND target_id=951 AND assignment_kind='steward'");
    assert((await repo.get(draft.handoff_id,a.lead)).report.ready_for_approval);
    await pool.execute("UPDATE process_governance_responsibilities SET person_id=12,revision_no=revision_no+1 WHERE target_type='work_package' AND target_id=951 AND assignment_kind='steward'");
    assert((await repo.get(draft.handoff_id,a.lead)).report.ready_for_approval);
  });
  await check('final responsibility ABA and qualification changes invalidate prior fact confirmation and approval',async()=>{
    const approval=await f.approve(draft.handoff_id);draft.revision=approval.revision;
    await f.appointment('91','23');await f.appointment('91','18');
    const changed=await repo.get(draft.handoff_id,a.lead);assert(changed.report.gates[3].issues.some(x=>x.startsWith('FACT_DEPARTMENT_CONFIRMATION_CHANGED')));
    await denied(()=>repo.publish(draft.handoff_id,request({expected_revision:draft.revision,approval_id:approval.approval_id}),a.lead),'HANDOFF_GATE_BLOCKED');
    const revoked=await repo.withdraw(draft.handoff_id,request({expected_revision:draft.revision,intent:'revoke_approval',reason:'Synthetic current department confirmation changed'}),a.lead);draft.revision=revoked.revision;
    await f.act(ordinary.conflict_id,'reopen');await f.act(ordinary.conflict_id,'resolve',{resolution:'Synthetic current final responsibility rechecked'});
    const verified=await f.recheck(ordinary.conflict_id);draft.revision=verified.handoff_revision;
  });
  await check('an open old-round fact remains original history but cannot permanently block a newly verified round',async()=>{
    const c=await f.act(ordinary.conflict_id,'reopen');const old=await f.openFact(ordinary.conflict_id,'91');
    await f.act(ordinary.conflict_id,'reopen');await f.act(ordinary.conflict_id,'resolve',{resolution:'Synthetic superseded unanswered evidence recorded'});
    const verified=await f.recheck(ordinary.conflict_id);draft.revision=verified.handoff_revision;
    assert.equal((await repo.getFact(old.fact_id,a.contactA)).status,'open');
    const value=await repo.get(draft.handoff_id,a.lead);assert(value.report.ready_for_approval,JSON.stringify(value.report.gates));
    assert.equal(value.report.dependency_manifest.facts.find(x=>x.fact_id===old.fact_id).applicability,'superseded_round');
  });
  let published;
  await check('new exact approval publishes the whole change set with conflict fact evidence and immutable reverse trace',async()=>{
    const approval=await f.approve(draft.handoff_id);published=await repo.publish(draft.handoff_id,request({expected_revision:approval.revision,approval_id:approval.approval_id}),a.lead);
    const publication=await repo.getPublication(published.publication_id,a.lead);assert.equal(publication.state,'published');
    const trace=await repo.tracePublication(published.publication_id,a.lead);assert(trace.conflicts.length===1);assert(trace.conflicts[0].events.length>20);assert(trace.fact_versions.length>20);
    const fixed=await rows('SELECT snapshot_json FROM data_map_handoff_revisions WHERE handoff_id=? AND revision_no=1',[draft.handoff_id]);assert.equal(parse(fixed[0].snapshot_json).items[0].definition.business_meaning,'Synthetic object definition');
    await denied(()=>repo.createConflict(draft.handoff_id,f.conflictBody({revision:approval.revision}),a.steward),'HANDOFF_CONFLICT_DRAFT_REQUIRED');
    save('published-trace.json',trace);
  });
  await check('Q6 publication withdraws and restores through Q10 without treating historical conflict proofs as new confirmations',async()=>{
    const original=await repo.getPublication(published.publication_id,a.lead),reason='Synthetic Q6 Q10 compatibility stop';
    const checked=await repo.withdrawalChecks(published.publication_id,request({expected_revision:1,reason}),a.lead);
    const approval=await repo.approveWithdrawal(published.publication_id,request({expected_revision:1,reason,binding_digest:checked.report.binding_digest,basis:proof.basis}),a.lead);
    await repo.withdrawPublication(published.publication_id,request({expected_revision:1,reason,withdrawal_approval_id:approval.withdrawal_approval_id}),a.lead);
    const [fixed]=await rows('SELECT snapshot_json FROM data_map_handoff_revisions WHERE revision_id=?',[original.manifest.handoff_revision_id]),body=parse(fixed.snapshot_json);
    for(const item of body.items){const old=original.manifest.items.find(x=>x.item_ref===item.item_ref);item.target_id=old.target_id;if(['object','field','data_element'].includes(item.target_kind)){item.operation='modify';delete item.target_version_ref;item.base_version_ref=old.target_version_ref;}}
    let restored=await repo.restorePublication(published.publication_id,request({expected_revision:2,target_package_id:'951',expected_target_revision:0,scope_mode:'current',draft:body,...proof,
      item_mappings:original.manifest.items.map(x=>({source_item_ref:x.item_ref,target_item_ref:x.item_ref,content_decision:'adopt',...proof}))}),a.steward);
    let value=await repo.get(restored.handoff_id,a.lead);assert(value.report.dependency_manifest.conflicts.every(x=>x.applicability==='historical_handoff'));
    const next=value.revision.snapshot_json;next.impact_dispositions=value.report.impact_manifest.filter(x=>x.reference_kind!=='schema_not_installed').map(x=>({reference_key:x.reference_key,decision:'compatible_fixed_reference',...proof}));
    restored=await repo.saveDraft(restored.handoff_id,request({expected_revision:restored.revision,draft:next}),a.steward);
    value=await repo.get(restored.handoff_id,a.lead);assert(value.report.ready_for_approval,JSON.stringify(value.report.gates));
    const freshApproval=await f.approve(restored.handoff_id),result=await repo.publish(restored.handoff_id,request({expected_revision:freshApproval.revision,approval_id:freshApproval.approval_id}),a.lead);
    assert.notEqual(result.publication_id,published.publication_id);assert.equal((await repo.getPublication(published.publication_id,a.lead)).state,'withdrawn');
    save('q6-q10-restored-publication.json',await repo.getPublication(result.publication_id,a.lead));
  });
  let majorDraft,major;
  await check('major disputes require current explicit handler escalation and assigned decision member without auto-confirming facts',async()=>{
    majorDraft=await f.draft(952);major=await repo.createConflict(majorDraft.handoff_id,f.conflictBody(majorDraft,{severity:'major'}),a.steward);
    await denied(()=>f.act(major.conflict_id,'resolve',{resolution:'bypass major'}),'HANDOFF_CONFLICT_ESCALATION_REQUIRED');
    await f.act(major.conflict_id,'assign',{assignee_person_id:'16'});
    await denied(()=>f.act(major.conflict_id,'escalate',{decision_person_id:'17'},a.otherHandler));
    await f.act(major.conflict_id,'escalate',{decision_person_id:'17'},a.handler);
    await denied(()=>f.act(major.conflict_id,'decide',{resolution:'wrong decision'},a.otherDecider));
    assert((await repo.getConflict(major.conflict_id,a.decider)).allowed_actions.includes('decide'));
    await denied(()=>repo.get(majorDraft.handoff_id,a.decider));
    const fact=await f.openFact(major.conflict_id,'91');
    await denied(()=>f.act(major.conflict_id,'decide',{resolution:'evidence still open'},a.decider),'HANDOFF_CONFLICT_EVIDENCE_PENDING');
    await f.completeFact(fact.fact_id,'91');
    const result=await f.act(major.conflict_id,'decide',{resolution:{outcome:'Synthetic major decision'}},a.decider);assert.equal(result.state,'resolved');
    assert.equal((await repo.receipt(result.request_id,a.decider)).state,'committed');
    await denied(()=>f.act(major.conflict_id,'verify',{},a.steward),'HANDOFF_CONFLICT_FACT_RECHECK_REQUIRED');
    await f.recheck(major.conflict_id);assert((await repo.get(majorDraft.handoff_id,a.lead)).report.ready_for_approval);
  });
  await check('new facts after verification reopen only the verification result and preserve earlier signed facts',async()=>{
    const before=await f.current(major.conflict_id),fact=await f.openFact(major.conflict_id,'92'),after=await f.current(major.conflict_id);
    assert.equal(after.state,'resolved');assert.equal(after.conflict.verification,null);assert(after.events.length>before.events.length);
    await f.completeFact(fact.fact_id,'92');await f.act(major.conflict_id,'verify',{},a.steward);
  });
  await check('a new correction review binding invalidates old dispute verification even when draft text is unchanged',async()=>{
    const before=await repo.get(majorDraft.handoff_id,a.lead),correction=await repo.createCorrection('952',request({expected_revision:0,replaces_binding_id:before.revision.binding_id,reason:'Synthetic changed review evidence',evidence_refs:proof.evidence_refs}),a.steward);
    const reviewed=await repo.reviewCorrection(correction.correction_id,request({expected_revision:correction.revision,...proof}),a.lead);
    await repo.rebase(majorDraft.handoff_id,request({expected_revision:Number(before.header.current_revision),binding_id:reviewed.binding_id,draft:before.revision.snapshot_json,basis:proof.basis}),a.steward);
    assert((await repo.get(majorDraft.handoff_id,a.lead)).report.gates[3].issues.some(x=>x.startsWith('CONFLICT_VERIFICATION_STALE')));
    await denied(()=>f.openFact(major.conflict_id,'91'),'HANDOFF_CONFLICT_SOURCE_RECHECK_REQUIRED');
    await f.act(major.conflict_id,'reopen');await f.act(major.conflict_id,'escalate',{decision_person_id:'17'},a.handler);await f.act(major.conflict_id,'decide',{resolution:'Synthetic result under new reviewed evidence'},a.decider);
    await f.recheck(major.conflict_id);assert((await repo.get(majorDraft.handoff_id,a.lead)).report.ready_for_approval);
  });
  await check('submitted and approved drafts accept new blocking disputes without silently changing their old approval',async()=>{
    let d=await f.draft(953);const approval=await f.approve(d.handoff_id);d.revision=approval.revision;
    const conflict=await repo.createConflict(d.handoff_id,f.conflictBody(d,{kind:'version',affected_department_ids:[]}),a.steward);
    const stored=await repo.get(d.handoff_id,a.lead);assert.equal(stored.header.current_approval_id,approval.approval_id);
    await denied(()=>repo.publish(d.handoff_id,request({expected_revision:d.revision,approval_id:approval.approval_id}),a.lead),'HANDOFF_GATE_BLOCKED');
    await f.act(conflict.conflict_id,'resolve',{resolution:'Synthetic current version comparison'});
    await denied(()=>f.act(conflict.conflict_id,'verify',{fact_recheck:{not_applicable:true,...proof}},a.steward),'HANDOFF_CONFLICT_DRAFT_REQUIRED');
    await repo.withdraw(d.handoff_id,request({expected_revision:d.revision,intent:'revoke_approval',reason:'Synthetic stop before fresh revision review'}),a.lead);
    await f.act(conflict.conflict_id,'verify',{fact_recheck:{not_applicable:true,...proof}},a.steward);
    assert((await repo.get(d.handoff_id,a.lead)).report.ready_for_approval);
  });
  await check('legacy conflict projections without immutable history stay readable and cannot masquerade as verified',async()=>{
    const d=await f.draft(954),id=crypto.randomUUID();
    await pool.execute("INSERT INTO data_map_handoff_conflicts(conflict_id,handoff_id,package_id,revision_no,state,kind,payload_json) VALUES(?,?,954,1,'verified','definition',?)",[id,d.handoff_id,json({original_opinion:'Synthetic preserved old content',old_confirmation_unknown:true})]);
    const legacy=await repo.getConflict(id,a.lead);assert.equal(legacy.history_complete,false);assert.equal(legacy.compatibility.referenceable_as_verified,false);assert.equal(legacy.conflict.original_opinion,'Synthetic preserved old content');
    assert((await repo.get(d.handoff_id,a.lead)).report.gates[3].issues.some(x=>x.startsWith('CONFLICT_LEGACY_HISTORY_INCOMPLETE')));
    await denied(()=>f.act(id,'reopen'),'HANDOFF_CONFLICT_COMPATIBILITY_REVIEW_REQUIRED');
    const historicalHandoff=crypto.randomUUID(),historicalConflict=crypto.randomUUID();
    await pool.execute("INSERT INTO data_map_handoff_drafts(handoff_id,package_id,current_revision,state,active_slot,created_actor_json,created_at) VALUES(?,954,1,'published',NULL,'{}',UTC_TIMESTAMP(3))",[historicalHandoff]);
    await pool.execute("INSERT INTO data_map_handoff_conflicts(conflict_id,handoff_id,package_id,revision_no,state,kind,payload_json) VALUES(?,?,954,1,'open','definition',?)",[historicalConflict,historicalHandoff,json({original_dispute:'Synthetic unresolved legacy history'})]);
    assert((await repo.get(d.handoff_id,a.lead)).report.gates[3].issues.some(x=>x==='HISTORICAL_CONFLICT_RECHECK_REQUIRED:'+historicalConflict));
  });
  await check('old ordinary directed facts stay readable with no write actions under prepared or invalid control',async()=>{
    await f.fixture.packageSeed(956);const intake=await repo.prepareIntake('956',request({expected_revision:0}),a.lead);
    const fact=await repo.createFact(intake.intake_id,request({expected_revision:0,expected_parent_revision:1,detail_id:'956',target_department_id:'91',requested_fact_type:'business_fact',question_text:'Synthetic old contract question',request_reason:'Synthetic old compatibility'}),a.steward,{kind:'intake'});
    assert((await repo.getFact(fact.fact_id,a.contactA)).allowed_actions.includes('answer'));
    await pool.execute("UPDATE data_map_governance_control SET cutover_state='prepared'");assert.deepEqual((await repo.getFact(fact.fact_id,a.contactA)).allowed_actions,['read']);
    await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled',contract_version='synthetic-invalid'");assert.deepEqual((await repo.getFact(fact.fact_id,a.contactA)).allowed_actions,['read']);
    await pool.execute("UPDATE data_map_governance_control SET contract_version='data-map-handoff-v1'");
    assert((await repo.getFact(fact.fact_id,a.contactA)).allowed_actions.includes('answer'));
    const answered=await repo.answerFact(fact.fact_id,request({expected_revision:1,expected_parent_revision:2,answer_text:'Synthetic old answer',evidence_refs:proof.evidence_refs}),a.contactA);
    const closed=await repo.closeFact(fact.fact_id,request({expected_revision:answered.revision,expected_parent_revision:answered.parent_revision,...proof}),a.steward);assert.equal(closed.status,'closed');
    const [row]=await rows('SELECT snapshot_json FROM process_data_governance_fact_versions WHERE fact_version_id=?',[closed.fact_version_id]);assert.equal(parse(row.snapshot_json).confirmed_by,undefined);
    await denied(()=>repo.confirmFact(fact.fact_id,request({expected_revision:closed.revision,...proof}),a.reviewerA),'HANDOFF_FACT_CONFIRMATION_ENTRY_REQUIRED');
  });
  await check('conflict and fact projection or event tampering is rejected while fixed original history is retained',async()=>{
    const before=await f.current(major.conflict_id),changed={...before.conflict,difference:'Synthetic unauthorized tamper'};
    await pool.execute('UPDATE data_map_handoff_conflicts SET payload_json=? WHERE conflict_id=?',[json(changed),major.conflict_id]);
    await denied(()=>repo.getConflict(major.conflict_id,a.lead),'HANDOFF_CONFLICT_INTEGRITY_CONFLICT');
    await pool.execute('UPDATE data_map_handoff_conflicts SET payload_json=? WHERE conflict_id=?',[json(before.conflict),major.conflict_id]);
    const [fact]=await rows("SELECT * FROM process_data_governance_fact_versions WHERE fact_id=? ORDER BY revision_no DESC LIMIT 1",[firstFact.fact_id]);
    const snapshot={...parse(fact.snapshot_json),answer_text:'Synthetic tampered answer'};
    await pool.execute('UPDATE process_data_governance_fact_versions SET snapshot_json=?,snapshot_digest=? WHERE fact_version_id=?',[json(snapshot),digest(snapshot),fact.fact_version_id]);
    await assert.rejects(()=>repo.getFact(firstFact.fact_id,a.lead),e=>['HANDOFF_FACT_SNAPSHOT_DRIFT','HANDOFF_FACT_EVENT_MISSING'].includes(e.code));
    await pool.execute('UPDATE process_data_governance_fact_versions SET snapshot_json=?,snapshot_digest=? WHERE fact_version_id=?',[json(parse(fact.snapshot_json)),fact.snapshot_digest,fact.fact_version_id]);
  });
  await check('actual v4 model executes major decision separate final facts verification and new exact publication',async()=>{
    const baseline=require('../server/accessModelV4Baseline');await pool.execute("UPDATE roles SET status='retired' WHERE role_code='hr_directory_manager'");
    for(const role of baseline.ROLE_GUIDES){await pool.execute("UPDATE roles SET model_version=?,status='active',role_name=?,description=? WHERE role_code=?",[baseline.ACCESS_MODEL_VERSION,role.name,role.description||null,role.code]);await pool.execute('DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id=rp.role_id WHERE r.role_code=?',[role.code]);
      for(const permission of role.permissions){await pool.execute('INSERT IGNORE INTO permissions(perm_code,resource,action,default_scope) VALUES(?,?,?,?)',[permission.code,permission.resource,permission.action,permission.defaultScope||'department']);await pool.execute("INSERT INTO role_permissions(role_id,perm_id,effect) SELECT r.role_id,p.perm_id,'allow' FROM roles r JOIN permissions p ON p.perm_code=? WHERE r.role_code=?",[permission.code,role.code]);}}
    const d=await f.draft(955),c=await repo.createConflict(d.handoff_id,f.conflictBody(d,{severity:'major'}),a.steward);
    await f.act(c.conflict_id,'assign',{assignee_person_id:'16'});await f.act(c.conflict_id,'escalate',{decision_person_id:'17'},a.handler);await f.act(c.conflict_id,'decide',{resolution:'Synthetic v4 major result'},a.decider);await f.recheck(c.conflict_id);
    const approval=await f.approve(d.handoff_id),result=await repo.publish(d.handoff_id,request({expected_revision:approval.revision,approval_id:approval.approval_id}),a.lead);
    const publication=await repo.getPublication(result.publication_id,a.lead);assert.equal(publication.manifest.actor.model_version,baseline.ACCESS_MODEL_VERSION);save('v4-publication.json',publication);
  });
},{stage:'79',randomDatabase:true});passed=true;owned.cleaned=true;
}catch(error){failure={code:error.code,message:error.message,stack:error.stack};throw error;}
finally{save('results.json',{passed,checks,owned,failure,formal_database_connected:false,formal_migration:false,deployment:false,feature_activation:false,business_accepted:false});}}
main().then(()=>console.log('Q6_MYSQL_PASS '+checks.length+' '+output)).catch(error=>{console.error(error.code||error.message);if(error.code==='ERR_ASSERTION')console.error(error.message);process.exitCode=1;});
