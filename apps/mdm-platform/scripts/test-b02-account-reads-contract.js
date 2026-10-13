// Synthetic read contracts only. Run with blockRealMysql preload and --test.
// No private config, database sockets, worker, notifications or business writes.
const test = require('node:test'), assert = require('node:assert/strict');
const { makeGovernanceAccessMysqlRepository } = require('../server/governanceAccessMysqlRepository');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const P = '9007199254741201', A = '9007199254741301', D = '9007199254741001';
function fixture() {
  const calls = [];
  const db = { async execute(sql, params = []) {
    calls.push({sql,params});
    if(params.includes(undefined)) throw new TypeError('Bind parameters must not contain undefined');
    if(/CAST\(\? AS SIGNED\)/.test(sql) && params[0] === null) return [[]];
    if(/FROM identity_access_events/.test(sql)) return [[{event_id:P,event_type:'role_assigned',actor_person_id:null,actor_name:'admin',actor_system_account_id:A,
      target_person_id:P,target_name:'Display',account_id:A,person_role_id:P,reason:'history',payload_json:{historical_id:P,unknown:[0,null,'kept']},created_at:'unchanged'}]];
    if(/AS assignmentId/.test(sql)) return [[{assignmentId:P,roleCode:'historical',roleStatus:'retired',scopeDepartmentId:D,assignedByPersonId:null,revokedByPersonId:P,status:'revoked',effectiveFrom:'2001-01-01'}]];
    if(/FROM person_roles/.test(sql)) return [[{role_id:P,person_role_id:A,scope_department_id:D,is_system:1,assignment_status:'expired',revocation_reason:'history'}]];
    if(/FROM person p/.test(sql)) return [[{person_id:params[0]||'42',current_department_id:params[0]?D:null,account_id:params[0]?A:null,auth_version:params[0]?'1':null,
      person_name:'Display',must_change_password:0,account_status:'active'}]];
    throw Error('UNEXPECTED_SYNTHETIC_QUERY');
  }};
  return {calls,db,repo:makeGovernanceAccessMysqlRepository(db),identity:makeIdentityMysqlRepository(db)};
}
test('account reads retain safe numbers, exact identities, null associations and original display fields',async()=>{
  const {repo}=fixture(), list=await repo.listAccounts();
  assert.equal(list[0].person_id,42);assert.equal(list[0].account_id,null);assert.equal(list[0].current_department_id,null);assert.equal(list[0].must_change_password,0);
  const account=await repo.getAccount(P);assert.equal(account.person_id,P);assert.equal(account.account_id,A);assert.equal(account.current_department_id,D);assert.equal(account.auth_version,1);
  assert.deepEqual(account.roleAssignments[0],{assignmentId:P,roleCode:'historical',roleStatus:'retired',scopeDepartmentId:D,assignedByPersonId:null,revokedByPersonId:P,status:'revoked',effectiveFrom:'2001-01-01'});
});
test('account and role bindings are decimal; invalid identities do not alias; driver errors propagate',async()=>{
  const {repo,identity,calls}=fixture();
  for(const id of [42,P,'42',P]){await repo.getAccount(id);await identity.getAssignedRoles(id);}
  assert(calls.filter(c=>c.params.length).every(c=>typeof c.params[0]==='string'));
  for(const id of [null,Number(P),'42oops','system-admin:42',{},'9223372036854775808']){assert.equal(await repo.getAccount(id),null);assert.deepEqual(await identity.getAssignedRoles(id),[]);}
  await assert.rejects(repo.getAccount(undefined),TypeError);await assert.rejects(identity.getAssignedRoles(undefined),TypeError);
  const error=Object.assign(Error('unavailable'),{code:'ER_TABLEACCESS_DENIED_ERROR'}),broken=makeGovernanceAccessMysqlRepository({async execute(){throw error;}});
  await assert.rejects(broken.listAccounts(),e=>e===error);await assert.rejects(broken.getAccount(P),e=>e===error);await assert.rejects(broken.listAccessEvents(),e=>e===error);
});
test('role history read preserves status/date fields and cannot become a qualification filter',async()=>{
  const {identity,calls}=fixture(), [role]=await identity.getAssignedRoles(P);
  assert.equal(role.role_id,P);assert.equal(role.person_role_id,A);assert.equal(role.scope_department_id,D);assert.equal(role.is_system,1);assert.equal(role.assignment_status,'expired');
  assert(!/assignment_status=|CURRENT_DATE|authorization_basis IS NOT NULL/.test(calls[0].sql));assert.match(calls[0].sql,/ORDER BY r.status, r.role_group, r.role_code/);
});
test('audit preserves historical JSON, system actor null-person and original limit/event filters',async()=>{
  const previous=process.env.MDM_SYSTEM_ADMIN_ENABLED;process.env.MDM_SYSTEM_ADMIN_ENABLED='1';
  try {const {repo,calls}=fixture(), [event]=await repo.listAccessEvents({personId:P,eventType:'role_assigned',limit:999});
    assert.equal(event.event_id,P);assert.equal(event.actor_person_id,null);assert.equal(event.actor_system_account_id,A);assert.equal(event.target_person_id,P);
    assert.deepEqual(event.payload_json,{historical_id:P,unknown:[0,null,'kept']});assert.deepEqual(calls[0].params,[P,P,'role_assigned']);assert.match(calls[0].sql,/LIMIT 500/);
    assert.match(calls[0].sql,/ORDER BY e.created_at DESC, e.event_id DESC/);assert.match(calls[0].sql,/se.identity_event_id=e.event_id/);
  }finally{if(previous===undefined)delete process.env.MDM_SYSTEM_ADMIN_ENABLED;else process.env.MDM_SYSTEM_ADMIN_ENABLED=previous;}
});
