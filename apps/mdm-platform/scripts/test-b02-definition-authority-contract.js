// Pure definition actor/transaction contracts. Run with blockRealMysql; no SQL IO.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module');
const filename=require.resolve('../server/dataMapDefinitionRepository');
function harness(authority={valid:true,permissions:new Set(['governance:draft-department','governance:read-department']),readOnly:false}) {
  let helpers;const calls=[];
  const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(require('node:path').dirname(filename));
  loaded.require=name=>{
    if(name==='./identityMysqlRepository')return {
      readPersonAuthority:async(db,session,personId,options)=>{calls.push({db,session,personId,options});return authority;},
      // This fixture has no verified independent-admin account.
      makeIdentityMysqlRepository:()=>({validateSession:async()=>({valid:false})})
    };
    if(name==='./definitionConsumers')return {createDefinitionConsumers:args=>{helpers=args;return {};}};
    if(name==='./analysisDependencyReadiness')return {inspectionScope:(db,fn)=>fn()};
    return Module.prototype.require.call(loaded,name);
  };
  loaded._compile(fs.readFileSync(filename,'utf8'),filename);
  const trace=[],session={personId:'9007199254740993',accountId:'9007199254741093',authVersion:'9007199254741193'};
  const db={execute:async(sql,args)=>{trace.push({sql,args});if(sql.includes('FROM user_accounts'))return [[{person_id:String(session.personId),auth_version:String(session.authVersion),account_status:'active',must_change_password:0}]];if(sql.includes('FROM person WHERE'))return [[{department_id:'91',status:'active'}]];return [[{migration_key:'synthetic'}]];},beginTransaction:async()=>trace.push('begin'),commit:async()=>trace.push('commit'),rollback:async()=>trace.push('rollback'),release:()=>trace.push('release')};
  loaded.exports.makeDataMapDefinitionRepository({getConnection:async()=>db});return {helpers,calls,trace,db,session};
}
test('actor selects current authority after original account/person/assignment locks on the caller connection',async()=>{
  const {helpers,calls,trace,db,session}=harness();const who=await helpers.actor(db,session,'governance:draft-department');
  assert.equal(who.personId,session.personId);assert.equal(who.departmentId,'91');assert.equal(calls.length,1);assert.equal(calls[0].db,db);assert.equal(calls[0].session,session);
  assert.deepEqual(calls[0].options,{currentRead:true});assert.equal(calls[0].personId,session.personId);
  assert.match(trace[0].sql,/user_accounts.*FOR UPDATE/);assert.match(trace[1].sql,/FROM person WHERE.*FOR UPDATE/);assert.match(trace[2].sql,/person_roles.*FOR UPDATE/);
  assert.deepEqual(trace.map(t=>t.args),[[session.accountId],[session.personId],[session.personId]]);
});
test('null and unverified independent system admin fail before SQL; exact small/big IDs retain original failures',async()=>{
  for(const session of [null,{}, {identityKind:'system_admin',accountId:1,authVersion:1,personId:null},{userId:'system-admin:1',accountId:1,authVersion:1},{personId:1,accountId:1,authVersion:null}]){
    const h=harness();await assert.rejects(h.helpers.actor(h.db,session),{code:'DEFINITION_AUTH_REQUIRED',statusCode:401});assert.deepEqual(h.trace,[]);assert.deepEqual(h.calls,[]);
  }
  const h=harness();Object.assign(h.session,{personId:7,accountId:17,authVersion:3});assert.equal((await h.helpers.actor(h.db,h.session)).personId,'7');
  for(const key of ['personId','accountId','authVersion']){const session={...h.session,[key]:Number.MAX_SAFE_INTEGER+1};await assert.rejects(h.helpers.actor(h.db,session),{code:'DEFINITION_ID_INVALID'});}
});
test('fresh invalid authority and administrator overlay retain 401/403 and read-only semantics',async()=>{
  let h=harness({valid:false});await assert.rejects(h.helpers.actor(h.db,h.session),{code:'DEFINITION_AUTH_REQUIRED',statusCode:401});
  h=harness({valid:true,permissions:new Set(['governance:draft-department','governance:read-global']),readOnly:true});
  assert.equal((await h.helpers.actor(h.db,h.session)).readOnly,true);await assert.rejects(h.helpers.actor(h.db,h.session,'governance:draft-department'),{code:'DEFINITION_ACCESS_DENIED',statusCode:403});
  h=harness({valid:true,permissions:new Set(),readOnly:false});await assert.rejects(h.helpers.actor(h.db,h.session,'governance:draft-department'),{code:'DEFINITION_ACCESS_DENIED',statusCode:403});
});
test('scope distinguishes adjacent BIGINT departments and preserves global read / own-department write',()=>{
  const {helpers}=harness(),who={departmentId:'9007199254740993',permissions:new Set(['governance:read-department'])};
  helpers.scope(who,who.departmentId,true);assert.throws(()=>helpers.scope(who,'9007199254740992',true),{code:'DEFINITION_ACCESS_DENIED'});
  const global={...who,permissions:new Set(['governance:read-global'])};helpers.scope(global,'9007199254740992');assert.throws(()=>helpers.scope(global,'9007199254740992',true),{code:'DEFINITION_ACCESS_DENIED'});
});
test('transaction commits success and rolls back failed operation before releasing the same connection',async()=>{
  const h=harness();assert.equal(await h.helpers.transaction(async db=>{assert.equal(db,h.db);return 7;}),7);assert.deepEqual(h.trace.filter(x=>typeof x==='string'),['begin','commit','release']);
  h.trace.length=0;await assert.rejects(h.helpers.transaction(async()=>{throw Object.assign(Error('synthetic'),{code:'SYNTHETIC_FAILURE'});}),{code:'SYNTHETIC_FAILURE'});assert.deepEqual(h.trace.filter(x=>typeof x==='string'),['begin','rollback','release']);
});
