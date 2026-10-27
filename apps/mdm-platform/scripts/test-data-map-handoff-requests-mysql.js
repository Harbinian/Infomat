// Executes only against a newly owned, labelled tmpfs MySQL. Uses synthetic
// business rows and a scoped authority seam, with connection-level fault proxies.
// No application HTTP fault controls, private configuration or formal DB access.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {fork}=require('node:child_process');
const {once}=require('node:events');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const {createHandoffRequestStore}=require('../server/dataMapHandoffRequests');
const {statements}=require('../server/dataMapHandoffSchema');
const {failure}=require('../server/dataMapHandoffPolicy');
const evidenceDir=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-01/requests');
if(process.argv[2]){assert(evidenceDir.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(evidenceDir),'preserve previous evidence');}
const env={DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'};
const session={personId:'9007199254741201',accountId:'9007199254741202',authVersion:'1'};
const second={personId:'9007199254741203',accountId:'9007199254741204',authVersion:'1'};
const outsider={personId:'9007199254741205',accountId:'9007199254741206',authVersion:'1'};
const department={personId:'9007199254741207',accountId:'9007199254741208',authVersion:'1'};
const scope={kind:'package',id:'9007199254741211',packageId:'9007199254741211'};
const otherScope={kind:'package',id:'9007199254741212',packageId:'9007199254741212'};
const cases=[];
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
async function rejectsCode(action,code){await assert.rejects(action,error=>error.code===code,code);}
function faultPool(pool,fault={}) {
  let connections=0,commits=0,triggered=false;
  const proxy={getConnection:async()=>{
    const db=await pool.getConnection(),ordinal=++connections;
    return new Proxy(db,{get(target,key){
      if(key==='commit')return async()=>{
        commits++;
        if(!triggered && ordinal===fault.connection && fault.phase==='before') {
          triggered=true;target.destroy();throw Object.assign(new Error('synthetic connection lost before COMMIT'),{code:'ECONNRESET'});
        }
        const result=await target.commit();
        if(!triggered && ordinal===fault.connection && fault.phase==='after') {
          triggered=true;throw Object.assign(new Error('synthetic reply lost after COMMIT'),{code:'ECONNRESET'});
        }
        return result;
      };
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
  }};
  return {proxy,stats:()=>({connections,commits,triggered})};
}
async function main() {
  fs.mkdirSync(evidenceDir,{recursive:true});
  let target;
  await withFreshMysql(async({pool,owner,database,containerId,port,password})=>{
    target={owner,database,container_id:containerId,owned_tmpfs:true,mysql_version:(await pool.execute('SELECT VERSION() version'))[0][0].version};
    for(const table of ['data_map_governance_control','data_map_handoff_requests']) {
      const sql=statements().find(value=>value.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`));
      assert.ok(sql,table);await pool.execute(sql);
    }
    await pool.execute("INSERT INTO data_map_governance_control VALUES(1,'controlled',1,0,1,'data-map-handoff-v1')");
    await pool.execute('CREATE TABLE synthetic_business(request_id CHAR(36) PRIMARY KEY,value_json JSON NOT NULL) ENGINE=InnoDB');
    await pool.execute('CREATE TABLE synthetic_events(event_id CHAR(36) PRIMARY KEY,request_id CHAR(36) NOT NULL,value_json JSON NOT NULL) ENGINE=InnoDB');
    // Isolated request mechanics use the real system UUID reservation columns;
    // complete task/binding semantics are covered by the generator suite.
    await pool.execute('CREATE TABLE data_map_handoff_generation_tasks(task_id CHAR(36) PRIMARY KEY,system_request_id CHAR(36) NOT NULL UNIQUE) ENGINE=InnoDB');
    await pool.execute('CREATE TABLE synthetic_qualifications(person_id BIGINT PRIMARY KEY,account_id BIGINT NOT NULL,auth_version BIGINT NOT NULL,active TINYINT NOT NULL,kind VARCHAR(24) NOT NULL) ENGINE=InnoDB');
    await pool.execute('CREATE TABLE synthetic_scopes(scope_id BIGINT PRIMARY KEY,revision_no INT NOT NULL) ENGINE=InnoDB');
    for(const [who,kind] of [[session,'mdm'],[second,'mdm'],[outsider,'outsider'],[department,'department']]) await pool.execute('INSERT INTO synthetic_qualifications VALUES(?,?,1,1,?)',[who.personId,who.accountId,kind]);
    for(const current of [scope,otherScope]) await pool.execute('INSERT INTO synthetic_scopes VALUES(?,1)',[current.id]);
    const authorityLog=[];
    async function authorize(db,actor,action,currentScope,options={}) {
      const read=['read','fact_read'].includes(action);
      if(read)assert.equal(options.lock,false,'receipt/terminal replay uses read qualification without write-anchor locks');
      const [[qualified]]=await db.execute(`SELECT CAST(person_id AS CHAR) person_id,CAST(account_id AS CHAR) account_id,
        CAST(auth_version AS CHAR) auth_version,active,kind FROM synthetic_qualifications WHERE person_id=?${read?'':' FOR UPDATE'}`,[String(actor.personId)]);
      authorityLog.push({action,person_id:String(actor.personId),scope_id:String(currentScope.id),read});
      if(!qualified || !qualified.active || qualified.account_id!==String(actor.accountId) || qualified.auth_version!==String(actor.authVersion) || qualified.kind==='outsider') throw failure('SYNTHETIC_AUTHORITY_DENIED',403);
      if(qualified.kind==='department' && (!currentScope.factRequestId || !['fact_read','fact_answer'].includes(action))) throw failure('SYNTHETIC_FACT_SCOPE_DENIED',403);
      return {...actor,qualification:qualified};
    }
    async function assertNoCommittedEffects(db,requestId) {
      const [[effect]]=await db.execute(`SELECT
        (SELECT COUNT(*) FROM synthetic_business WHERE request_id=?)+
        (SELECT COUNT(*) FROM synthetic_events WHERE request_id=?) n`,[requestId,requestId]);
      if(Number(effect.n))throw failure('HANDOFF_RECEIPT_INCONSISTENT',503,{request_id:requestId});
    }
    const store=()=>createHandoffRequestStore(pool,{authorize,env,assertNoCommittedEffects});
    const count=async(table,requestId)=>Number((await pool.execute(`SELECT COUNT(*) n FROM ${table} WHERE request_id=?`,[requestId]))[0][0].n);
    const row=async requestId=>(await pool.execute('SELECT * FROM data_map_handoff_requests WHERE request_id=?',[requestId]))[0][0] || null;
    const revision=async()=>String((await pool.execute('SELECT CAST(graph_revision AS CHAR) graph_revision FROM data_map_governance_control'))[0][0].graph_revision);
    let workCalls=0;
    const work=(body,onWork=null)=>async(db,control,reauthorize,context)=>{
      workCalls++;
      await db.execute('SELECT scope_id FROM synthetic_scopes WHERE scope_id=? FOR UPDATE',[scope.id]);
      if(onWork)await onWork(db,control,reauthorize,context);
      else await reauthorize();
      await db.execute('INSERT INTO synthetic_business VALUES(?,?)',[context.request_id,JSON.stringify({value:body.value})]);
      await db.execute('INSERT INTO synthetic_events VALUES(?,?,?)',[crypto.randomUUID(),context.request_id,JSON.stringify({event:'synthetic_changed'})]);
      return {business_outcome:'synthetic_saved',scope:scope.id,value:body.value};
    };
    async function scenario(name,action) {
      try{await action();cases.push({name,result:'passed'});}
      catch(error){cases.push({name,result:'failed',error:{code:error.code || error.name,message:error.message}});}
    }
    let savedBody,savedReceipt;
    await scenario('prepared registration and business/receipt/events commit atomically',async()=>{
      savedBody={request_id:crypto.randomUUID(),expected_revision:0,value:'first'};
      const before=BigInt(await revision());
      savedReceipt=await store().execute('prepare',scope,savedBody,session,work(savedBody,async(db,control,reauth,context)=>{
        assert.equal((await db.execute('SELECT state FROM data_map_handoff_requests WHERE request_id=?',[context.request_id]))[0][0].state,'prepared');
        await reauth();
      }));
      assert.equal(savedReceipt.business_outcome,'synthetic_saved');
      assert.equal((await row(savedBody.request_id)).state,'committed');
      assert.equal(await count('synthetic_business',savedBody.request_id),1);
      assert.equal(await count('synthetic_events',savedBody.request_id),1);
      assert.equal(BigInt(await revision()),before+1n);
    });
    await scenario('exact original UUID replay and GET return saved result without work',async()=>{
      const before=workCalls;
      assert.deepEqual(await store().execute('prepare',scope,savedBody,session,work(savedBody)),savedReceipt);
      const receipt=await store().receipt(savedBody.request_id,session);
      assert.equal(receipt.state,'committed');assert.deepEqual(receipt.result,savedReceipt);
      assert.equal(workCalls,before);assert.equal(await count('synthetic_events',savedBody.request_id),1);
    });
    await scenario('same global UUID rejects another payload/person/scope',async()=>{
      const before=workCalls;
      await rejectsCode(()=>store().execute('prepare',scope,{...savedBody,value:'changed'},session,work(savedBody)),'HANDOFF_REQUEST_PAYLOAD_CONFLICT');
      await rejectsCode(()=>store().execute('prepare',scope,savedBody,second,work(savedBody)),'HANDOFF_REQUEST_PAYLOAD_CONFLICT');
      await rejectsCode(()=>store().execute('prepare',otherScope,savedBody,session,work(savedBody)),'HANDOFF_REQUEST_PAYLOAD_CONFLICT');
      assert.equal(workCalls,before);
      await rejectsCode(()=>store().receipt(savedBody.request_id,outsider),'SYNTHETIC_AUTHORITY_DENIED');
    });
    await scenario('known terminal replay requires no COMMIT and does not invent unknown outcome',async()=>{
      const fault=faultPool(pool,{connection:1,phase:'after'});
      const result=await createHandoffRequestStore(fault.proxy,{authorize,env}).execute('prepare',scope,savedBody,session,work(savedBody));
      assert.deepEqual(result,savedReceipt);assert.equal(fault.stats().commits,0);
    });
    await scenario('department fact replay uses fact_read rather than global read',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'fact-answer'};
      const factScope={...scope,factRequestId:crypto.randomUUID(),factKind:'handoff_correction'};
      const result=await store().execute('fact_answer',factScope,body,department,work(body));
      const before=workCalls;
      assert.deepEqual(await store().execute('fact_answer',factScope,body,department,work(body)),result);
      assert.equal((await store().receipt(body.request_id,department)).state,'committed');assert.equal(workCalls,before);
    });
    await scenario('definite business failure rolls back all writes and rejected is terminal',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'rolled-back'};
      const before=await revision();let ran=0;
      const failWork=async(db,control,reauthorize,context)=>{
        ran++;await reauthorize();await db.execute('INSERT INTO synthetic_business VALUES(?,?)',[context.request_id,'{}']);
        await db.execute('INSERT INTO synthetic_events VALUES(?,?,?)',[crypto.randomUUID(),context.request_id,'{}']);
        throw failure('SYNTHETIC_VALIDATION_FAILURE',422,{location:'synthetic'});
      };
      await rejectsCode(()=>store().execute('prepare',scope,body,session,failWork),'SYNTHETIC_VALIDATION_FAILURE');
      assert.equal((await row(body.request_id)).state,'rejected');assert.equal(await count('synthetic_business',body.request_id),0);assert.equal(await count('synthetic_events',body.request_id),0);
      assert.equal(await revision(),before);
      await rejectsCode(()=>store().execute('prepare',scope,body,session,failWork),'SYNTHETIC_VALIDATION_FAILURE');assert.equal(ran,1);
      assert.equal((await store().receipt(body.request_id,session)).state,'rejected');
    });
    await scenario('lost A COMMIT reply preserves prepared and exact UUID remains retryable',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'lost-A'};
      const fault=faultPool(pool,{connection:1,phase:'after'}),before=workCalls;
      await rejectsCode(()=>createHandoffRequestStore(fault.proxy,{authorize,env}).execute('prepare',scope,body,session,work(body)),'HANDOFF_COMMIT_UNKNOWN');
      assert.equal(workCalls,before);assert.equal((await row(body.request_id)).state,'prepared');
      const receipt=await store().receipt(body.request_id,session);assert.equal(receipt.state,'prepared');assert.equal(receipt.observation,'retryable');
      await store().execute('prepare',scope,body,session,work(body));assert.equal(await count('synthetic_business',body.request_id),1);
    });
    await scenario('connection exit before A COMMIT leaves no observed registration and exact UUID can be registered',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'lost-A-before'};
      const fault=faultPool(pool,{connection:1,phase:'before'}),before=workCalls;
      await rejectsCode(()=>createHandoffRequestStore(fault.proxy,{authorize,env,assertNoCommittedEffects}).execute('prepare',scope,body,session,work(body)),'HANDOFF_COMMIT_UNKNOWN');
      assert.equal(workCalls,before);assert.equal(await row(body.request_id),null);
      assert.equal((await store().receipt(body.request_id,session)).state,'not_observed');
      await store().execute('prepare',scope,body,session,work(body));assert.equal(await count('synthetic_business',body.request_id),1);
    });
    await scenario('lost B COMMIT reply after actual success is recovered through original receipt',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'lost-B-after'};
      const fault=faultPool(pool,{connection:2,phase:'after'});
      await rejectsCode(()=>createHandoffRequestStore(fault.proxy,{authorize,env}).execute('prepare',scope,body,session,work(body)),'HANDOFF_COMMIT_UNKNOWN');
      assert.equal((await row(body.request_id)).state,'committed');assert.equal(await count('synthetic_business',body.request_id),1);assert.equal(await count('synthetic_events',body.request_id),1);
      const before=workCalls,result=(await store().receipt(body.request_id,session)).result;
      assert.deepEqual(await store().execute('prepare',scope,body,session,work(body)),result);assert.equal(workCalls,before);
    });
    await scenario('connection exit before B COMMIT leaves prepared and rolls back business before same-ID retry',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'lost-B-before'};
      const fault=faultPool(pool,{connection:2,phase:'before'});
      await rejectsCode(()=>createHandoffRequestStore(fault.proxy,{authorize,env}).execute('prepare',scope,body,session,work(body)),'HANDOFF_COMMIT_UNKNOWN');
      assert.equal((await row(body.request_id)).state,'prepared');assert.equal(await count('synthetic_business',body.request_id),0);
      await store().execute('prepare',scope,body,session,work(body));assert.equal(await count('synthetic_business',body.request_id),1);assert.equal(await count('synthetic_events',body.request_id),1);
    });
    await scenario('receipt returns in_progress while original request row is locked, and never executes work',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'held'};
      const entered=deferred(),release=deferred();
      const pending=store().execute('prepare',scope,body,session,work(body,async(db,control,reauth)=>{await reauth();entered.resolve();await release.promise;}));
      await entered.promise;const before=workCalls;
      try {const receipt=await store().receipt(body.request_id,session);assert.equal(receipt.state,'in_progress');assert.equal(receipt.business_outcome,'pending_verification');assert.equal(workCalls,before);}
      finally {release.resolve();await pending;}
      assert.equal((await store().receipt(body.request_id,session)).state,'committed');
    });
    await scenario('qualification is recomputed after scope lock and revocation rejects the queued business',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'revoked'};
      const entered=deferred(),release=deferred();let calls=0;
      const pending=store().execute('prepare',scope,body,session,async(db,control,reauth,context)=>{
        calls++;await db.execute('SELECT scope_id FROM synthetic_scopes WHERE scope_id=? FOR UPDATE',[scope.id]);
        entered.resolve();await release.promise;await reauth();
        await db.execute('INSERT INTO synthetic_business VALUES(?,?)',[context.request_id,'{}']);return {business_outcome:'should-not-save'};
      });
      await entered.promise;
      await pool.execute('UPDATE synthetic_qualifications SET active=0,auth_version=2 WHERE person_id=?',[session.personId]);release.resolve();
      await rejectsCode(()=>pending,'SYNTHETIC_AUTHORITY_DENIED');
      assert.equal(calls,1);assert.equal(await count('synthetic_business',body.request_id),0);assert.equal((await row(body.request_id)).state,'rejected');
      await pool.execute('UPDATE synthetic_qualifications SET active=1,auth_version=1 WHERE person_id=?',[session.personId]);
    });
    await scenario('missing lock-time qualification callback fails closed and rolls back',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'no-auth'};
      await rejectsCode(()=>store().execute('prepare',scope,body,session,async(db,control,reauth,context)=>{
        await db.execute('INSERT INTO synthetic_business VALUES(?,?)',[context.request_id,'{}']);return {business_outcome:'unauthorized'};
      }),'HANDOFF_AUTHORITY_REQUIRED');
      assert.equal(await count('synthetic_business',body.request_id),0);
    });
    await scenario('read downgrade and changed scope cannot substitute for exact write requalification',async()=>{
      for(const variant of ['read','scope']) {
        const body={request_id:crypto.randomUUID(),expected_revision:0,value:'incorrect-authority-'+variant};
        await assert.rejects(()=>store().execute('prepare',scope,body,session,async(db,control,reauth,context)=>{
          await reauth(variant==='read'?'read':'prepare',variant==='scope'?otherScope:scope);
          await db.execute('INSERT INTO synthetic_business VALUES(?,?)',[context.request_id,'{}']);return {business_outcome:'should-not-save'};
        }),error=>String(error.code || '').startsWith('HANDOFF_'));
        assert.equal(await count('synthetic_business',body.request_id),0);
      }
    });
    await scenario('transient deadlock stays prepared and only the same UUID is retried',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'deadlock'};
      await rejectsCode(()=>store().execute('prepare',scope,body,session,async(db,control,reauth)=>{await reauth();throw Object.assign(new Error('synthetic transient deadlock'),{code:'ER_LOCK_DEADLOCK'});}),'HANDOFF_BUSY');
      assert.equal((await row(body.request_id)).state,'prepared');await store().execute('prepare',scope,body,session,work(body));assert.equal(await count('synthetic_business',body.request_id),1);
    });
    await scenario('unknown UUID GET is a read-only pending observation, not an implicit execution',async()=>{
      const requestId=crypto.randomUUID(),before=workCalls;
      assert.equal((await store().receipt(requestId,session)).state,'not_observed');assert.equal(await row(requestId),null);assert.equal(workCalls,before);
    });
    await scenario('prepared receipt with a committed domain effect is inconsistent and both GET/replay refuse it',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'inconsistent'};
      const fault=faultPool(pool,{connection:1,phase:'after'});
      await rejectsCode(()=>createHandoffRequestStore(fault.proxy,{authorize,env,assertNoCommittedEffects}).execute('prepare',scope,body,session,work(body)),'HANDOFF_COMMIT_UNKNOWN');
      await pool.execute('INSERT INTO synthetic_events VALUES(?,?,?)',[crypto.randomUUID(),body.request_id,'{}']);
      const before=workCalls;
      await rejectsCode(()=>store().receipt(body.request_id,session),'HANDOFF_RECEIPT_INCONSISTENT');
      await rejectsCode(()=>store().execute('prepare',scope,body,session,work(body)),'HANDOFF_RECEIPT_INCONSISTENT');
      assert.equal(workCalls,before);assert.equal((await row(body.request_id)).state,'prepared');assert.equal(await count('synthetic_business',body.request_id),0);
    });
    const processExits=[];
    async function crashWorker(phase,body) {
      const child=fork(path.join(__dirname,'testHelpers/handoffCrashWorker.js'),['--owned-handoff-crash-worker'],{
        cwd:path.resolve(__dirname,'..'),env:isolatedEnvironment(),execArgv:[],windowsHide:true,silent:true
      });
      const exit=once(child,'exit');
      let timer,killed=false;
      // No child stream or IPC message contains or is allowed to log the random credential.
      child.stdout.resume();child.stderr.resume();
      try {
        const reached=new Promise((resolve,reject)=>{
          timer=setTimeout(()=>reject(new Error('HANDOFF_CRASH_CHECKPOINT_TIMEOUT')),15000);
          child.on('message',message=>{
            if(message.event==='worker_error')reject(Object.assign(new Error('HANDOFF_CRASH_WORKER_FAILED'),{code:message.code}));
            if(message.event==='checkpoint')resolve(message);
          });
          child.once('error',reject);child.once('exit',()=>reject(new Error('HANDOFF_CRASH_WORKER_EXITED_BEFORE_CHECKPOINT')));
        });
        child.send({kind:'owned_stage22_handoff_crash',target:{owner,database,containerId,port,password},body,session,scope,phase});
        const checkpoint=await reached;clearTimeout(timer);
        assert.equal(checkpoint.request_id,body.request_id);assert.equal(checkpoint.pid,child.pid);
        if(phase==='b_before_commit')assert.equal((await store().receipt(body.request_id,session)).state,'in_progress');
        killed=child.kill('SIGKILL');assert.equal(killed,true,'only this owned child is terminated');
        const [code,signal]=await exit;
        const record={phase,pid:child.pid,checkpoint:checkpoint.phase,exit_code:code,signal:signal||null,killed_by_parent:true};
        processExits.push(record);return record;
      } finally {
        clearTimeout(timer);
        if(child.exitCode===null&&child.signalCode===null) {
          child.kill('SIGKILL');await exit;
        }
      }
    }
    async function settledReceipt(requestId) {
      for(let attempt=0;attempt<60;attempt++) {
        const observed=await store().receipt(requestId,session);
        if(observed.state!=='in_progress')return observed;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw new Error('HANDOFF_CRASH_DATABASE_RELEASE_TIMEOUT');
    }
    await scenario('real child process exit after A commits leaves prepared and original UUID retry produces exactly one effect',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'process-exit-A'};
      await crashWorker('a_after_commit',body);
      const observed=await settledReceipt(body.request_id);assert.equal(observed.state,'prepared');assert.equal(await count('synthetic_business',body.request_id),0);assert.equal(await count('synthetic_events',body.request_id),0);
      await store().execute('prepare',scope,body,session,work(body));assert.equal(await count('synthetic_business',body.request_id),1);assert.equal(await count('synthetic_events',body.request_id),1);
    });
    await scenario('real child process exit with B uncommitted releases locks and rolls back both business effects',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'process-exit-B-uncommitted'};
      await crashWorker('b_before_commit',body);
      const observed=await settledReceipt(body.request_id);assert.equal(observed.state,'prepared');assert.equal(await count('synthetic_business',body.request_id),0);assert.equal(await count('synthetic_events',body.request_id),0);
      await store().execute('prepare',scope,body,session,work(body));assert.equal(await count('synthetic_business',body.request_id),1);assert.equal(await count('synthetic_events',body.request_id),1);
    });
    await scenario('real child process exit after B commits preserves committed receipt and original UUID does not rerun work',async()=>{
      const body={request_id:crypto.randomUUID(),expected_revision:0,value:'process-exit-B-committed'};
      await crashWorker('b_after_commit',body);
      const observed=await settledReceipt(body.request_id);assert.equal(observed.state,'committed');assert.equal(await count('synthetic_business',body.request_id),1);assert.equal(await count('synthetic_events',body.request_id),1);
      const before=workCalls;assert.deepEqual(await store().execute('prepare',scope,body,session,work(body)),observed.result);assert.equal(workCalls,before);assert.equal(await count('synthetic_events',body.request_id),1);
    });
    const report={state:cases.some(item=>item.result==='failed')?'failed':'passed',executed_at:new Date().toISOString(),target,
      checks:cases,process_exits:processExits,authority_calls:authorityLog.length,work_calls:workCalls,limitations:['synthetic authority seam; full v4/v5 role matrix is a separate test','COMMIT response loss uses a test proxy; process-exit cases use real fork/IPC/SIGKILL']};
    fs.writeFileSync(path.join(evidenceDir,'results.json'),JSON.stringify(report,null,2));
  },{stage:'22',randomDatabase:true});
  const failures=cases.filter(item=>item.result==='failed');
  console.log(JSON.stringify({state:failures.length?'failed':'passed',checks:cases.length,failures,evidenceDir}));
  if(failures.length)process.exitCode=1;
}
if(require.main===module)main().catch(error=>{console.error(error.code || error.name,error.message);process.exitCode=1;});
module.exports={faultPool};
