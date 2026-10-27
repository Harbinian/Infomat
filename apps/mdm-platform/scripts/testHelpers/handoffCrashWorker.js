// Test-only crash target. It accepts only a parent IPC channel plus the explicit
// worker flag, verifies the newly owned stage22 tmpfs container, and obtains this
// run's random credential through IPC. It never reads application configuration.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const mysql=require('mysql2/promise');
const {createHandoffRequestStore}=require('../../server/dataMapHandoffRequests');
const {failure}=require('../../server/dataMapHandoffPolicy');

async function checkpoint(phase,requestId) {
  await new Promise((resolve,reject)=>process.send({event:'checkpoint',phase,request_id:requestId,pid:process.pid},error=>error?reject(error):resolve()));
  await new Promise(()=>{});
}
async function run(message) {
  assert.equal(message.kind,'owned_stage22_handoff_crash');
  const {target,body,session,scope,phase}=message;
  assert.match(target.owner,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(target.database,'stage22_isolated_'+target.owner.replaceAll('-',''));
  assert.match(target.containerId,/^[0-9a-f]{64}$/);
  assert(Number.isSafeInteger(target.port)&&target.port>1024&&target.port<=65535&&![3000,3001,3306,3307,5173,63805].includes(target.port));
  assert.equal(typeof target.password,'string');assert.match(target.password,/^[0-9a-f]{48}$/);
  assert(['a_after_commit','b_before_commit','b_after_commit'].includes(phase));
  assert.match(body.request_id,/^[0-9a-f-]{36}$/);
  const inspected=JSON.parse(execFileSync('docker',['inspect',target.containerId],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:10000}))[0];
  assert.equal(inspected.Config.Labels['infomat.stage22'],target.owner);
  assert.equal(inspected.HostConfig.Tmpfs['/var/lib/mysql'],'rw,size=1073741824');
  assert.equal(inspected.Mounts.filter(item=>['bind','volume'].includes(item.Type)).length,0);
  assert.equal(inspected.NetworkSettings.Ports['3306/tcp'][0].HostIp,'127.0.0.1');
  assert.equal(Number(inspected.NetworkSettings.Ports['3306/tcp'][0].HostPort),target.port);
  const pool=mysql.createPool({host:'127.0.0.1',port:target.port,user:'root',password:target.password,database:target.database,connectionLimit:2,connectTimeout:3000});
  try {
    assert.equal((await pool.execute('SELECT DATABASE() name'))[0][0].name,target.database);
    let connections=0;
    const wrappedPool={getConnection:async()=>{
      const db=await pool.getConnection(),ordinal=++connections;
      return new Proxy(db,{get(connection,key){
        if(key==='commit')return async()=>{
          const result=await connection.commit();
          if(phase==='a_after_commit'&&ordinal===1)await checkpoint('a_prepared_committed',body.request_id);
          if(phase==='b_after_commit'&&ordinal===2)await checkpoint('b_business_committed',body.request_id);
          return result;
        };
        const value=connection[key];return typeof value==='function'?value.bind(connection):value;
      }});
    }};
    async function authorize(db,actor,action,currentScope,options={}) {
      const read=['read','fact_read'].includes(action);
      if(read)assert.equal(options.lock,false);
      assert.equal(String(currentScope.id),String(scope.id));
      const [[authority]]=await db.execute(`SELECT CAST(person_id AS CHAR) person_id,CAST(account_id AS CHAR) account_id,
        CAST(auth_version AS CHAR) auth_version,active,kind FROM synthetic_qualifications WHERE person_id=?${read?'':' FOR UPDATE'}`,[String(actor.personId)]);
      if(!authority||!authority.active||authority.kind!=='mdm'||authority.account_id!==String(actor.accountId)||authority.auth_version!==String(actor.authVersion))throw failure('SYNTHETIC_AUTHORITY_DENIED',403);
      return actor;
    }
    async function assertNoCommittedEffects(db,requestId) {
      const [[result]]=await db.execute('SELECT (SELECT COUNT(*) FROM synthetic_business WHERE request_id=?)+(SELECT COUNT(*) FROM synthetic_events WHERE request_id=?) n',[requestId,requestId]);
      if(Number(result.n))throw failure('HANDOFF_RECEIPT_INCONSISTENT',503);
    }
    const store=createHandoffRequestStore(wrappedPool,{authorize,assertNoCommittedEffects,env:{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}});
    await store.execute('prepare',scope,body,session,async(db,control,reauthorize,context)=>{
      await db.execute('SELECT scope_id FROM synthetic_scopes WHERE scope_id=? FOR UPDATE',[scope.id]);
      await reauthorize();
      await db.execute('INSERT INTO synthetic_business VALUES(?,?)',[context.request_id,JSON.stringify({value:body.value})]);
      await db.execute('INSERT INTO synthetic_events VALUES(?,?,?)',[crypto.randomUUID(),context.request_id,JSON.stringify({event:'synthetic_changed'})]);
      if(phase==='b_before_commit')await checkpoint('b_business_uncommitted',body.request_id);
      return {business_outcome:'synthetic_saved',scope:scope.id,value:body.value};
    });
    throw new Error('CRASH_CHECKPOINT_NOT_REACHED');
  } finally {await pool.end();}
}

if(!process.send||!process.argv.includes('--owned-handoff-crash-worker'))process.exitCode=2;
else {
  process.once('disconnect',()=>process.exit(3));
  setTimeout(()=>process.exit(4),20000).unref();
  process.once('message',message=>run(message).catch(error=>{
    if(process.connected)process.send({event:'worker_error',code:error.code||'HANDOFF_CRASH_WORKER_FAILED'});
    process.exitCode=1;
  }));
}
