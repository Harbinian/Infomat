// Focused identity/authority behavior. Run with blockRealMysql preload and --test.
// Synthetic in-memory executors only; no env file, DB, HTTP listener or persistent data.
const test = require('node:test');
const assert = require('node:assert/strict');
const {sessionSubject,identityInteger,sameIdentityInteger} = require('../server/sessionSubject');
const {makeIdentityMysqlRepository,readPersonAuthority,assignmentAuthority} = require('../server/identityMysqlRepository');
const P='9007199254740993', A='9007199254740995', V='9007199254740997';
function fixture() {
  const state={authVersion:V,status:'active',password:0,roles:['department_contact'],permission:true,queries:[]};
  const db={async execute(sql,params=[]) {
    state.queries.push({sql,params});
    if (/FROM person p\s+LEFT JOIN user_accounts/.test(sql)) {
      assert.equal(String(params[0]),P);
      return [[{person_id:P,account_id:A,auth_version:state.authVersion,current_department_id:'91',
        account_status:state.status,status:'active',must_change_password:state.password}]];
    }
    if (/SELECT pr.role_id/.test(sql)) return [state.roles.map((_,i)=>({role_id:i+1}))];
    if (/SELECT parent_role_id/.test(sql)) return [[{parent_role_id:null}]];
    if (/FROM role_permissions rp/.test(sql)) return [state.permission?[{perm_code:'governance:draft-department',effect:'allow'}]:[]];
    if (/FROM person_roles pr/.test(sql)) return [state.roles.map(code=>({code}))];
    throw Error('UNEXPECTED_SYNTHETIC_QUERY');
  }};
  return {db,state,session:{personId:P,accountId:A,authVersion:V}};
}
test('typed and modern independent admin identities retain null person and exact account principal',()=>{
  for(const s of [{identityKind:'system_admin',accountId:A,authVersion:V},{userId:'system-admin:'+A,accountId:A,authVersion:V}]) {
    const subject=sessionSubject(s);assert.equal(subject.kind,'system_admin');assert.equal(subject.personId,null);
    assert.equal(subject.principal,'system-admin:'+A);assert.equal(subject.accountId,A);assert(Object.isFrozen(subject));
  }
  assert.deepEqual(sessionSubject({personId:P,accountId:A,authVersion:V}),{kind:'person',principal:P,personId:P,accountId:A,authVersion:V});
  assert.equal(sessionSubject({userId:42}).personId,42);
});
test('adjacent BIGINT identities stay distinct and rounded numbers are refused',()=>{
  assert.equal(identityInteger('42'),42);assert.equal(identityInteger(P),P);
  assert.equal(sameIdentityInteger(42,'42'),true);assert.equal(sameIdentityInteger(P,'9007199254740992'),false);
  for(const value of [Number(P),'system-admin:1',0,-1,'0','9223372036854775808',null,{},1.5]) assert.equal(identityInteger(value),null);
});
test('current session validates exact person/account/version without rounding',async()=>{
  const {db,session}=fixture(),repo=makeIdentityMysqlRepository(db);
  assert.equal((await repo.validateSession(session)).valid,true);
  assert.equal((await repo.validateSession({...session,accountId:'9007199254740994'})).reason,'account_changed');
  assert.equal((await repo.validateSession({...session,authVersion:'9007199254740996'})).reason,'authorization_changed');
  assert.equal((await repo.validateSession({...session,personId:'system-admin:1'})).valid,false);
});
test('authority reads current qualifications each time on caller connection and denies admin overlay',async()=>{
  const {db,state,session}=fixture();
  let authority=await readPersonAuthority(db,session,P);assert(authority.valid);assert(authority.permissions.has('governance:draft-department'));assert(!authority.readOnly);
  state.roles.push('admin');authority=await readPersonAuthority(db,session,P);assert(authority.readOnly);
  state.roles=[];state.permission=false;authority=await readPersonAuthority(db,session,P);assert(authority.valid);assert.equal(authority.permissions.size,0);
  state.authVersion='9007199254740998';assert.equal((await readPersonAuthority(db,session,P)).valid,false);
  assert(state.queries.every(q=>!q.sql.includes('FOR UPDATE')),'reader leaves lock ownership and order with caller');
});
test('authority refuses cross-principal and system identities before reading personnel',async()=>{
  const {db,state,session}=fixture();
  for(const [s,p] of [[session,'9007199254740994'],[{...session,identityKind:'system_admin'},P],[session,'system-admin:1']]) assert.equal((await readPersonAuthority(db,s,p)).valid,false);
  assert.equal(state.queries.length,0);
});
test('disabled account and required password change cannot supply business authority',async()=>{
  const {db,state,session}=fixture();state.status='disabled';assert.equal((await readPersonAuthority(db,session,P)).valid,false);
  state.status='active';state.password=1;assert.equal((await readPersonAuthority(db,session,P)).valid,false);
});
test('formal direct assignments retain deny precedence regardless of row order and no role grants',()=>{
  const grants=[{role_code:'mdm_lead',perm_code:'governance:publish',effect:'allow'},{role_code:'department_contact',perm_code:'governance:publish',effect:'deny'}];
  for(const rows of [grants,[...grants].reverse()]) assert.equal(assignmentAuthority(rows).effects.get('governance:publish'),'deny');
  assert.equal(assignmentAuthority([{role_code:'mdm_lead'}]).effects.size,0);
  assert(assignmentAuthority([...grants,{code:'admin'}]).readOnly);
});
test('auth and access consume exact typed principal; permissions stay fresh and role labels do not grant',async()=>{
  const auth=require('../server/auth'),access=require('../server/access');
  const previous=process.env.MDM_IDENTITY_READ_MODEL;process.env.MDM_IDENTITY_READ_MODEL='mysql';
  const seen=[];let allowed=true;
  auth.setIdentityRepositoryFactory(async()=>({
    validateSession:async()=>({valid:true,user:{identityKind:'system_admin',identityRef:'system-admin:'+A,personId:null,accountId:A,authVersion:V}}),
    getUserEffectivePermissions:async principal=>{seen.push(principal);return {permSet:new Set(allowed?['governance:read-global']:[]),fieldConstraints:{}};},
    getUserRoleCodes:async principal=>{seen.push(principal);return [{code:'admin'}];}
  }));
  try {
    const req={identity:{identityKind:'system_admin'},session:{identityKind:'system_admin',accountId:A,authVersion:V},method:'GET'};
    assert(await access.hasGlobalViewAsync(req));assert.deepEqual([...await access.getEffectiveRoleCodesAsync(req)],['admin']);
    const invoke=async()=>{let next=false,body,status;const res={status(value){status=value;return this;},json(value){body=value;return this;}};
      await auth.requirePermission('governance:read-global')(req,res,()=>{next=true;});return {next,body,status};};
    assert((await invoke()).next);allowed=false;assert.equal((await invoke()).status,403);assert(!(await access.hasGlobalViewAsync(req)));
    assert(seen.every(principal=>principal==='system-admin:'+A));
  } finally {auth.resetIdentityRepositoryFactory();if(previous===undefined)delete process.env.MDM_IDENTITY_READ_MODEL;else process.env.MDM_IDENTITY_READ_MODEL=previous;}
});
