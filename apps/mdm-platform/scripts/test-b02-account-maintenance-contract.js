// Pure/fake executor contracts only. Run with blockRealMysql and --test.
// No private configuration, sockets, real permissions or owned resources.
const test=require('node:test'),assert=require('node:assert/strict');
const {makeGovernanceAccessMysqlRepository,validateRoleAssignmentInput}=require('../server/governanceAccessMysqlRepository');
const system=require('../server/systemAdminIdentity');
const P='9007199254741201',D='9007199254741001',A='9007199254741301',E='9007199254741701';
const assignment={roleCode:'department_contact',scopeDepartmentId:D,authorizationBasis:'synthetic',effectiveFrom:'2026-01-01'};
test('maintenance role scope preserves decimal identity and rejects adjacent/rounded values; default adapter stays legacy',()=>{
  assert.equal(validateRoleAssignmentInput(assignment,D,true).scopeDepartmentId,D);
  assert.equal(validateRoleAssignmentInput(assignment,D).scopeDepartmentId,Number(D));
  for(const value of [Number(D),'9007199254741000','system-admin:1',{},0,'9223372036854775808'])assert.throws(()=>validateRoleAssignmentInput({...assignment,scopeDepartmentId:value},D,true),{code:'ROLE_SCOPE_DEPARTMENT_MISMATCH'});
  assert.equal(validateRoleAssignmentInput({...assignment,scopeDepartmentId:'91'},91,true).scopeDepartmentId,91);
  for(const field of ['authorizationBasis','effectiveFrom'])assert.throws(()=>validateRoleAssignmentInput({...assignment,[field]:''},D,true),{code:'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED'});
});
test('invalid supplied actor cannot turn into null audit identity before any transaction',async()=>{
  const repo=makeGovernanceAccessMysqlRepository({async getConnection(){throw Error('TRANSACTION_MUST_NOT_START');}});
  for(const actorPersonId of [Number(P),'system-admin:1',{},0,'9223372036854775808']){
    for(const method of ['updateAccount','grantRole','enableAccount'])await assert.rejects(repo[method](P,{...assignment,actorPersonId}),{code:'INVALID_ACTOR_PERSON_ID'});
    await assert.rejects(repo.createAccount({loginName:'synthetic',employeeNo:'synthetic',name:'synthetic',departmentId:D,roleAssignments:[assignment],pendingPasswordHash:'synthetic',actorPersonId}),{code:'INVALID_ACTOR_PERSON_ID'});
  }
});
test('system event exact bindings preserve empty people and safe-number compatibility; default callers unchanged',async()=>{
  const calls=[],db={async execute(sql,params){calls.push({sql,params});return[{affectedRows:1}];}};
  await system.event(db,42,'bootstrap');assert.deepEqual(calls[0].params,[42,'bootstrap',null,null]);
  await system.event(db,A,'role_assigned',E,P,true);assert.deepEqual(calls[1].params,[A,'role_assigned',E,P]);
  await system.event(db,42,'account_created',43,null,true);assert.deepEqual(calls[2].params,['42','account_created','43',null]);
  for(const [account,event,target]of [[Number(A),E,P],[A,Number(E),P],[A,E,Number(P)]])await assert.rejects(system.event(db,account,'invalid',event,target,true),{code:'SYSTEM_ADMIN_ID_INVALID'});
  assert.equal(calls.length,3);
});
