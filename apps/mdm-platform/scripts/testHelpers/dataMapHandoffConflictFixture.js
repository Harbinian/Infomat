// Synthetic Q6 identities and packages for a caller-owned fresh tmpfs MySQL.
// This helper reads no config, creates no external service and grants no real user.
const crypto=require('node:crypto');
const {seed,draftBody}=require('./dataMapHandoffFixture');
const {createDataMapHandoffRepository}=require('../../server/dataMapHandoffRepository');
const {json}=require('../../server/dataMapHandoffPolicy');
const request=body=>({request_id:crypto.randomUUID(),...body});
const proof={basis:'synthetic Q6 reviewed evidence',evidence_refs:['synthetic:q6-evidence']};
async function setup(target){
  const fixture=await seed(target),pool=target.pool,env={DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'};
  const roles=[['16','data_conflict_handler','91'],['17','decision_group','91'],['18','department_mdm_reviewer','91'],
    ['19','department_contact','92'],['20','department_mdm_reviewer','92'],['21','data_conflict_handler','91'],
    ['22','decision_group','91'],['23','department_mdm_reviewer','91'],['24','mdm_steward','91'],
    ['25','data_conflict_handler','91'],['26','decision_group','91'],['27','department_mdm_reviewer','91']];
  for(const [person,role,dept]of roles){
    const account=String(Number(person)+100);
    await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(?,?,?,?)',[person,'Q6_SYN_'+person,'Synthetic Q6 '+person,dept]);
    await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status) VALUES(?,?,?,'unusable-synthetic-hash','active')",[account,person,'Q6_SYN_'+person]);
    const department=role.startsWith('department_');
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,'synthetic Q6 fixture',CURRENT_DATE FROM roles WHERE role_code=?",[person,department?'department':'global',department?dept:null,role]);
  }
  for(const person of ['25','26'])await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT ?,role_id,'global','synthetic admin overlap',CURRENT_DATE FROM roles WHERE role_code='admin'",[person]);
  await pool.execute('UPDATE departments SET final_responsible_person_id=18 WHERE id=91');
  await pool.execute('UPDATE departments SET final_responsible_person_id=20 WHERE id=92');
  const policy=await pool.getConnection();
  try{await require('../../server/departmentAccountabilityMigration').applyDepartmentAccountabilityPolicy(policy);}finally{policy.release();}
  const session=person=>({personId:String(person),accountId:String(Number(person)+100),authVersion:'1'});
  const actors={lead:session(11),steward:session(12),admin:session(13),contactA:session(14),handler:session(16),decider:session(17),
    reviewerA:session(18),contactB:session(19),reviewerB:session(20),otherHandler:session(21),otherDecider:session(22),replacementA:session(23),unassignedSteward:session(24),adminHandler:session(25),adminDecider:session(26),otherReviewerA:session(27)};
  const repo=createDataMapHandoffRepository(pool,{env});
  async function draft(number,body=draftBody()){
    await fixture.packageSeed(number);
    const intake=await repo.prepareIntake(String(number),request({expected_revision:0}),actors.lead);
    const bound=await repo.reviewIntake(intake.intake_id,request({expected_revision:1,basis:proof.basis,detail_evidence:intake.required_detail_evidence.map(d=>({...d,...proof}))}),actors.lead);
    return repo.fromWorkPackage(String(number),request({expected_revision:0,binding_id:bound.binding_id,draft:body}),actors.steward);
  }
  const conflictBody=(handoff,extra={})=>request({expected_revision:0,expected_handoff_revision:handoff.revision,kind:'cross_department',severity:'ordinary',subject_refs:['object'],
    difference:'Synthetic department meanings differ',proposals:['synthetic option A','synthetic option B'],impact:{scope:'synthetic only'},...proof,affected_department_ids:['91','92'],...extra});
  async function current(conflictId){return repo.getConflict(conflictId,actors.lead);}
  async function act(conflictId,action,extra={},who=actors.lead){const c=await current(conflictId);return repo.actConflict(conflictId,request({expected_revision:c.revision,expected_handoff_revision:c.current_handoff_revision,action,...proof,...extra}),who);}
  async function openFact(conflictId,departmentId='91'){
    const c=await current(conflictId);return repo.createConflictFact(conflictId,request({expected_revision:0,expected_conflict_revision:c.revision,expected_handoff_revision:c.current_handoff_revision,
      detail_ref:'object:source_1',target_department_id:departmentId,requested_fact_type:'business_meaning',question_text:'Synthetic precise business fact?',request_reason:'Synthetic separate recheck',evidence_refs:proof.evidence_refs}),actors.steward);
  }
  async function factBody(factId,extra={}){const f=await repo.getFact(factId,actors.lead);return request({expected_revision:f.revision,expected_conflict_revision:f.expected_conflict_revision,expected_handoff_revision:f.expected_handoff_revision,...extra});}
  async function completeFact(factId,departmentId='91'){
    const contact=departmentId==='91'?actors.contactA:actors.contactB,reviewer=departmentId==='91'?actors.reviewerA:actors.reviewerB;
    await repo.answerFact(factId,await factBody(factId,{answer_text:'Synthetic independently supplied meaning',evidence_refs:proof.evidence_refs}),contact);
    let f=await repo.getFact(factId,reviewer);
    await repo.confirmFact(factId,await factBody(factId,{answered_fact_version_id:f.fact_version_id,answered_snapshot_digest:f.snapshot_digest,...proof}),reviewer);
    return repo.closeFact(factId,await factBody(factId,proof),actors.steward);
  }
  async function recheck(conflictId){for(const dept of (await current(conflictId)).conflict.affected_department_ids){const f=await openFact(conflictId,dept);await completeFact(f.fact_id,dept);}return act(conflictId,'verify',{},actors.steward);}
  async function approve(handoffId){const value=await repo.get(handoffId,actors.lead),submitted=value.header.state==='draft'?await repo.submit(handoffId,request({expected_revision:Number(value.header.current_revision)}),actors.steward):{revision:Number(value.header.current_revision)};
    const checked=await repo.get(handoffId,actors.lead);return repo.approve(handoffId,request({expected_revision:submitted.revision,decision:'approved',binding_digest:checked.report.binding_digest,basis:proof.basis}),actors.lead);}
  async function appointment(departmentId,personId){await pool.execute('UPDATE departments SET final_responsible_person_id=? WHERE id=?',[personId,departmentId]);
    await pool.execute("INSERT INTO identity_access_events(event_type,actor_person_id,target_person_id,payload_json) VALUES('role_assigned',11,?,?)",[personId,json({roleCode:'department_mdm_reviewer',departmentAppointment:{departmentId,changed:true,decisionRecordCutoff:'0'}})]);}
  return {pool,fixture,env,actors,session,repo,draft,current,act,openFact,factBody,completeFact,recheck,approve,appointment,conflictBody};
}
module.exports={setup,request,proof};
