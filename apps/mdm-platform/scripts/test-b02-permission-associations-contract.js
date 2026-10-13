// Synthetic permission association behavior only; real equivalence and prepared
// statement reuse are covered by test-b02-permission-associations-mysql.js.
const test=require('node:test'),assert=require('node:assert/strict');
const {makeIdentityMysqlRepository}=require('../server/identityMysqlRepository');
const P='9007199254741601',R='9007199254741201',A='9007199254741301',G='9007199254741401';
function fixture({direct=[R],parents=new Map([[R,A],[A,G],[G,null]]),permissions=[]}={}){
  const calls=[];return {calls,db:{async execute(sql,params=[]){calls.push({sql,params});
    if(params.includes(undefined))throw new TypeError('Bind parameters must not contain undefined');
    if(/FROM person_roles pr/.test(sql))return [params[0]===P?direct.map(role_id=>({role_id})):[]];
    if(/FROM roles WHERE/.test(sql))return [parents.has(params[0])?[{parent_role_id:parents.get(params[0])}]:[]];
    if(/FROM role_permissions rp/.test(sql))return [permissions];
    throw Error('Unexpected permission association query');
  }}};
}
test('exact decimal direct/ancestor/IN parameters keep original traversal order and merge/deny',async()=>{
  const f=fixture({permissions:[{perm_code:'syn:shared',effect:'allow',field_constraints:'{"readonly":["name"]}'},{perm_code:'syn:shared',effect:'allow',field_constraints:'{"exclude":["secret"]}'},{perm_code:'syn:unknown',effect:'allow',field_constraints:'historical-invalid'},{perm_code:'syn:shared',effect:'deny'}]});
  const result=await makeIdentityMysqlRepository(f.db).getUserEffectivePermissions(P);
  assert.deepEqual(result,{permSet:new Set(['syn:unknown']),fieldConstraints:{'syn:shared':{exclude:['secret']}}});
  assert.deepEqual(f.calls.slice(1,4).map(c=>c.params),[[R],[A],[G]]);
  assert.deepEqual(f.calls.at(-1).params,[R,A,G]);assert(/IN \(CAST\(\? AS SIGNED\),CAST\(\? AS SIGNED\),CAST\(\? AS SIGNED\)\)/.test(f.calls.at(-1).sql));
});
test('self and multi-node cycles, missing/null ancestors, repeated direct roles retain finite original traversal',async()=>{
  for(const parents of [new Map([[R,R]]),new Map([[R,A],[A,R]]),new Map([[R,A]]),new Map([[R,null]])]){
    const f=fixture({direct:[R,R],parents});await makeIdentityMysqlRepository(f.db).getUserEffectivePermissions(P);
    assert.equal(f.calls.filter(c=>/FROM roles WHERE/.test(c.sql)).length,parents.get(R)===R||parents.get(R)===null?1:2);
  }
});
test('invalid and unsafe Number principals cannot select valid neighbouring personnel; undefined driver failure remains',async()=>{
  for(const value of [null,0,-1,1.5,NaN,Infinity,Number(P),'1e2','42x','-42','9223372036854775808']){
    const f=fixture();assert.deepEqual(await makeIdentityMysqlRepository(f.db).getUserEffectivePermissions(value),{permSet:new Set(),fieldConstraints:{}});assert.equal(f.calls[0].params[0],null);assert.equal(f.calls.length,1);
  }
  const f=fixture();await assert.rejects(makeIdentityMysqlRepository(f.db).getUserEffectivePermissions(undefined),/undefined/);
});
test('every SQL step propagates original Error identity with no permission fallback',async()=>{
  const reference=fixture();await makeIdentityMysqlRepository(reference.db).getUserEffectivePermissions(P);
  for(let failAt=0;failAt<reference.calls.length;failAt++){
    const f=fixture();let index=0;const sentinel=Object.assign(Error('permission association failure'),{code:'SYNTHETIC_SQL_FAILURE'});
    const db={execute(sql,params){if(index++===failAt)throw sentinel;return f.db.execute(sql,params);}};
    await assert.rejects(makeIdentityMysqlRepository(db).getUserEffectivePermissions(P),e=>e===sentinel);assert.equal(index,failAt+1);
  }
});
