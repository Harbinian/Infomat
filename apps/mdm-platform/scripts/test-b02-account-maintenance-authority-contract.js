// Pure identity/field-policy contracts; blockRealMysql forbids real connections.
const test=require('node:test'),assert=require('node:assert/strict');
const {maintenanceRequestContext,assertCurrentMaintenanceAuthority}=require('../server/accountMaintenanceAuthority');
const {readonlyWriteViolation}=require('../server/permissionFieldConstraints');
const P='9007199254741201',A='9007199254741301',V='9007199254741401';
const session={personId:P,accountId:A,authVersion:V},user={...session,employment_status:'active'};
const context=()=>maintenanceRequestContext({session,identity:user,method:'PATCH',body:{name:'synthetic',actorPersonId:'spoof'}});
test('verified user and matching precise session only; body and old permission cache supply no authority',()=>{
  const c=context();assert.equal(c.personId,P);assert.equal(c.accountId,A);assert.equal(c.authVersion,V);assert(Object.isFrozen(c));
  for(const field of ['personId','accountId','authVersion'])for(const value of [Number(session[field]),String(BigInt(session[field])-1n),'bad',null]){
    assert.throws(()=>maintenanceRequestContext({session:{...session,[field]:value},identity:user,body:session}),{code:'SESSION_IDENTITY_INVALID'});
  }
  for(const identity of [null,{...user,identityKind:'system_admin'}])assert.throws(()=>maintenanceRequestContext({session,identity,effectivePermissions:new Set(['identity:manage-account'])}),{code:'SESSION_IDENTITY_INVALID'});
});
test('eight operations retain their distinct permissions including create dual gate and admin overlay',()=>{
  const c=context(),authority={valid:true,user,permissions:new Set(['identity:manage-account','identity:assign-role']),fieldConstraints:{},readOnly:true};
  const all=['createAccount','updateAccount','grantRole','revokeRole','activateAccount','enableAccount','disableAccount','resetPassword'];
  for(const operation of all){assert.doesNotThrow(()=>assertCurrentMaintenanceAuthority(authority,c,operation,P));
    assert.throws(()=>assertCurrentMaintenanceAuthority({...authority,permissions:new Set()},c,operation,P),e=>e.statusCode===403&&e.accountMaintenanceResponse.error==='权限不足');}
  for(const permission of ['identity:manage-account','identity:assign-role'])assert.throws(()=>assertCurrentMaintenanceAuthority({...authority,permissions:new Set([permission])},c,'createAccount',P),e=>e.statusCode===403);
  assert.doesNotThrow(()=>assertCurrentMaintenanceAuthority({...authority,permissions:new Set(['identity:assign-role'])},c,'grantRole',P));
});
test('fresh fields retain original readonly response and GET/array exclusions; invalid session and forced password fail',()=>{
  const c=context(),base={valid:true,user,permissions:new Set(['identity:manage-account']),fieldConstraints:{'identity:manage-account':{readonly:['name','unknown','name']}}};
  assert.throws(()=>assertCurrentMaintenanceAuthority(base,c,'updateAccount',P),e=>e.statusCode===403&&JSON.stringify(e.accountMaintenanceResponse)===JSON.stringify({error:'字段只读，不允许写入',readonly_fields:['name']}));
  for(const method of ['GET','HEAD','OPTIONS'])assert.deepEqual(readonlyWriteViolation({...c,method},'identity:manage-account',base.fieldConstraints),[]);
  assert.deepEqual(readonlyWriteViolation({method:'POST',body:[]},'identity:manage-account',base.fieldConstraints),[]);
  for(const change of [{valid:false},{user:{...user,employment_status:'leave'}}])assert.throws(()=>assertCurrentMaintenanceAuthority({...base,...change},c,'updateAccount',P),{code:'SESSION_AUTHORIZATION_CHANGED'});
  assert.throws(()=>assertCurrentMaintenanceAuthority({valid:false,passwordChangeRequired:true},c,'updateAccount',P),{code:'PASSWORD_CHANGE_REQUIRED'});
  assert.throws(()=>assertCurrentMaintenanceAuthority(base,c,'updateAccount',String(BigInt(P)-1n)),{code:'SESSION_AUTHORIZATION_CHANGED'});
});
