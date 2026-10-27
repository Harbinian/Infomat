// Q6 faults and actual InnoDB waits use a newly owned tmpfs MySQL only.
// Fixtures are synthetic. Administrative identity changes below occur solely
// inside the owned transaction to test current qualification after a lock wait.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const {setup,request,proof}=require('./testHelpers/dataMapHandoffConflictFixture');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {lockGraph}=require('../server/dataMapHandoffControl');
const {json}=require('../server/dataMapHandoffPolicy');
const output=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-04/conflict-faults-'+crypto.randomUUID());
assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output),'preserve previous evidence');fs.mkdirSync(output,{recursive:true});
const checks=[],faults=[],races=[],observedDenials=[];let owned,passed=false,failure;
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),15000);})]);}finally{clearTimeout(timer);}}
async function check(name,work){await work();checks.push(name);console.log('PASS '+name);save('progress.json',{checks,faults,races,observedDenials});}
async function code(work,expected){await assert.rejects(work,error=>{observedDenials.push({code:error.code,statusCode:error.statusCode});return Array.isArray(expected)?expected.includes(error.code):error.code===expected;},String(expected));}
function faultPool(pool,{lostCommit,failSql,holdGraph,onGraphAttempt,holdSql,attemptSql}={}){
  const stats={connections:[],triggered:false,held:false,sql_held:false,conflict_updates:0,fact_inserts:0,conflict_event_inserts:0,lock_attempts:[]};
  const proxy=new Proxy(pool,{get(target,key){
    if(key==='getConnection')return async()=>{
      const db=await target.getConnection(),ordinal=stats.connections.length+1,[[identity]]=await db.execute('SELECT CONNECTION_ID() id');
      const record={ordinal,connection_id:identity.id,commits:0,rollbacks:0,destroys:0,releases:0};stats.connections.push(record);
      return new Proxy(db,{get(connection,method){
        if(method==='execute')return async(sql,args)=>{
          const graph=/FROM data_map_governance_control\b[\s\S]*FOR UPDATE/i.test(sql);
          const selectedTable=sql.match(/FROM\s+(data_map_governance_control|process_governance_responsibilities|process_data_governance_work_packages|data_map_handoff_conflicts)\b/i)?.[1];
          if(selectedTable&&/FOR (?:UPDATE|SHARE)/i.test(sql))stats.lock_attempts.push({ordinal,table:selectedTable,mode:/FOR UPDATE/i.test(sql)?'exclusive':'shared'});
          if(graph&&onGraphAttempt)onGraphAttempt.resolve({ordinal,connection_id:identity.id});
          if(attemptSql?.match(sql,args,ordinal))attemptSql.entered.resolve({ordinal,connection_id:identity.id});
          if(!stats.triggered&&failSql?.(sql,args)){stats.triggered=true;throw Object.assign(Error('synthetic Q6 pre-commit SQL failure'),{code:'SYNTHETIC_CONFLICT_SQL_FAILURE'});}
          const value=await connection.execute(sql,args);
          if(/^\s*UPDATE data_map_handoff_conflicts\b/.test(sql))stats.conflict_updates++;
          if(/^\s*INSERT INTO process_data_governance_fact_versions\b/.test(sql))stats.fact_inserts++;
          if(/^\s*INSERT INTO data_map_handoff_conflict_events\b/.test(sql))stats.conflict_event_inserts++;
          if(graph&&holdGraph&&!stats.held){stats.held=true;holdGraph.entered.resolve({ordinal,connection_id:identity.id});await bounded(holdGraph.release.promise,'held Q6 graph transaction');}
          if(holdSql&&!stats.sql_held&&holdSql.match(sql,args,ordinal)){stats.sql_held=true;holdSql.entered.resolve({ordinal,connection_id:identity.id});await bounded(holdSql.release.promise,'held Q6 ordered transaction');}
          return value;
        };
        if(method==='commit')return async()=>{record.commits++;const value=await connection.commit();if(!stats.triggered&&lostCommit===ordinal){stats.triggered=true;throw Object.assign(Error('synthetic lost ACK after actual COMMIT'),{code:'ECONNRESET'});}return value;};
        if(method==='rollback')return async()=>{record.rollbacks++;return connection.rollback();};
        if(method==='destroy')return()=>{record.destroys++;return connection.destroy();};
        if(method==='release')return()=>{record.releases++;return connection.release();};
        const value=connection[method];return typeof value==='function'?value.bind(connection):value;
      }});
    };
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});return {proxy,stats};
}
async function main(){try{await withFreshMysql(async target=>{
  const {pool,owner,database,containerId,port}=target;owned={owner,database,containerId,port,tmpfs:true,loopback:true};
  const f=await setup(target),{repo,actors,env}=f;let packageNo=8000;
  const policy=await pool.getConnection();try{assert.equal((await require('../server/departmentAccountabilityMigration').applyDepartmentAccountabilityPolicy(policy)).ready,true);}finally{policy.release();}
  const rows=async(sql,args=[])=>(await pool.execute(sql,args))[0];
  const proxied=options=>{const fault=faultPool(pool,options);return {...fault,repo:createDataMapHandoffRepository(fault.proxy,{env})};};
  const fresh=()=>f.draft(++packageNo);
  async function conflict(handoff,extra={}){return repo.createConflict(handoff.handoff_id,f.conflictBody(handoff,extra),actors.steward);}
  async function factFixture(){const handoff=await fresh(),c=await conflict(handoff,{affected_department_ids:['91']});await f.act(c.conflict_id,'resolve',{resolution:'Synthetic coordinated interpretation'});return {handoff,c,fact:await f.openFact(c.conflict_id)};}
  async function eventCount(requestId){return Number((await rows('SELECT COUNT(*) n FROM data_map_handoff_conflict_events WHERE request_id=?',[requestId]))[0].n);}
  async function business(){
    const tables={data_map_handoff_conflicts:'conflict_id',data_map_handoff_conflict_events:'conflict_id,revision_no',process_data_governance_fact_versions:'fact_id,revision_no',
      data_map_handoff_drafts:'handoff_id',data_map_handoff_revisions:'handoff_id,revision_no',data_map_handoff_events:'event_id',data_map_governance_control:'control_id',
      data_map_handoff_approvals:'approval_id',data_map_publications:'publication_id',data_map_publication_items:'publication_id,item_ref',data_map_effective_heads:'subject_kind,subject_id'};
    const result={};for(const [table,order]of Object.entries(tables))result[table]=await rows('SELECT * FROM '+table+' ORDER BY '+order);return result;
  }
  async function waitForTable(connectionId,table='data_map_governance_control'){for(let i=0;i<240;i++){
    const waits=await rows(`SELECT r.OBJECT_NAME,r.LOCK_MODE,t.PROCESSLIST_ID requesting_connection,bt.PROCESSLIST_ID blocking_connection,b.LOCK_MODE blocking_mode
      FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
      JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=r.THREAD_ID
      JOIN performance_schema.threads bt ON bt.THREAD_ID=b.THREAD_ID WHERE r.OBJECT_SCHEMA=? AND r.OBJECT_NAME=? AND t.PROCESSLIST_ID=?`,[database,table,connectionId]);
    if(waits.length)return waits;await sleep(25);
  }throw Error('Expected an actual Q6 InnoDB wait on the shared control row');}
  const waitForControl=connectionId=>waitForTable(connectionId);
  for(const lostCommit of [1,2])await check('conflict creation actual COMMIT '+(lostCommit===1?'A':'B')+' loses ACK, destroys the uncertain connection and recovers the original UUID once',async()=>{
    const h=await fresh(),body=f.conflictBody(h),fault=proxied({lostCommit});
    await code(()=>fault.repo.createConflict(h.handoff_id,body,actors.steward),'HANDOFF_COMMIT_UNKNOWN');
    const uncertain=fault.stats.connections[lostCommit-1];assert.equal(uncertain.commits,1);assert.equal(uncertain.destroys,1);assert.equal(uncertain.rollbacks,0);assert.equal(uncertain.releases,0);
    assert.equal((await repo.receipt(body.request_id,actors.steward)).state,lostCommit===1?'prepared':'committed');assert.equal(await eventCount(body.request_id),lostCommit===1?0:1);
    const result=await repo.createConflict(h.handoff_id,body,actors.steward);assert.equal(await eventCount(body.request_id),1);assert.equal(result.revision,1);
    assert.deepEqual(await repo.createConflict(h.handoff_id,body,actors.steward),result);assert.deepEqual((await repo.receipt(body.request_id,actors.steward)).result,result);
    faults.push({scenario:'conflict_open_commit_'+(lostCommit===1?'A':'B'),request_id:body.request_id,stats:fault.stats});
  });
  for(const lostCommit of [1,2])await check('directed fact answer actual COMMIT '+(lostCommit===1?'A':'B')+' loses ACK and original UUID retains one exact fact version',async()=>{
    const {fact}=await factFixture(),body=await f.factBody(fact.fact_id,{answer_text:'Synthetic independently answered fact',evidence_refs:proof.evidence_refs}),fault=proxied({lostCommit});
    await code(()=>fault.repo.answerFact(fact.fact_id,body,actors.contactA),'HANDOFF_COMMIT_UNKNOWN');
    const uncertain=fault.stats.connections[lostCommit-1];assert.equal(uncertain.destroys,1);assert.equal(uncertain.rollbacks,0);assert.equal(uncertain.releases,0);
    assert.equal((await repo.receipt(body.request_id,actors.contactA)).state,lostCommit===1?'prepared':'committed');
    const result=await repo.answerFact(fact.fact_id,body,actors.contactA);assert.equal(result.revision,2);assert.equal(await eventCount(body.request_id),1);
    for(const key of ['conflict','events','subject_items','difference','proposals','impact'])assert(!Object.hasOwn(result,key),'directed fact result must omit '+key);
    assert.equal((await rows('SELECT COUNT(*) n FROM process_data_governance_fact_versions WHERE fact_id=?',[fact.fact_id]))[0].n,2);
    assert.deepEqual(await repo.answerFact(fact.fact_id,body,actors.contactA),result);assert.deepEqual((await repo.receipt(body.request_id,actors.contactA)).result,result);
    faults.push({scenario:'fact_answer_commit_'+(lostCommit===1?'A':'B'),request_id:body.request_id,stats:fault.stats});
  });
  await check('conflict event insertion failure rolls back its updated projection and original prepared UUID retries cleanly',async()=>{
    const h=await fresh(),c=await conflict(h),current=await f.current(c.conflict_id),body=request({expected_revision:current.revision,expected_handoff_revision:current.current_handoff_revision,action:'viewpoint',viewpoint:'Synthetic preserved departmental view',...proof}),before=await business();
    const fault=proxied({failSql:sql=>/INSERT INTO data_map_handoff_conflict_events\b/.test(sql)});
    await code(()=>fault.repo.actConflict(c.conflict_id,body,actors.steward),'SYNTHETIC_CONFLICT_SQL_FAILURE');assert.equal(fault.stats.conflict_updates,1);assert.deepEqual(await business(),before);
    assert.equal((await repo.receipt(body.request_id,actors.steward)).state,'prepared');await repo.actConflict(c.conflict_id,body,actors.steward);assert.equal(await eventCount(body.request_id),1);
    faults.push({scenario:'viewpoint_conflict_event_failure',request_id:body.request_id,stats:fault.stats});
  });
  for(const late of [false,true])await check('fact version and conflict projection '+(late?'plus conflict event roll back when the later handoff event fails':'roll back when its conflict event fails'),async()=>{
    const {fact}=await factFixture(),body=await f.factBody(fact.fact_id,{answer_text:'Synthetic fault-retry answer',evidence_refs:proof.evidence_refs}),before=await business();
    const fault=proxied({failSql:sql=>(late?/INSERT INTO data_map_handoff_events\b/:/INSERT INTO data_map_handoff_conflict_events\b/).test(sql)});
    await code(()=>fault.repo.answerFact(fact.fact_id,body,actors.contactA),'SYNTHETIC_CONFLICT_SQL_FAILURE');assert.equal(fault.stats.fact_inserts,1);assert.equal(fault.stats.conflict_updates,1);if(late)assert.equal(fault.stats.conflict_event_inserts,1);
    assert.deepEqual(await business(),before);assert.equal((await repo.receipt(body.request_id,actors.contactA)).state,'prepared');
    const result=await repo.answerFact(fact.fact_id,body,actors.contactA);assert.equal(result.revision,2);assert.equal(await eventCount(body.request_id),1);
    faults.push({scenario:late?'fact_handoff_event_failure':'fact_conflict_event_failure',request_id:body.request_id,stats:fault.stats});
  });
  for(const order of ['conflict_first','publish_first'])await check('actual graph lock race '+order+' preserves conflict gates and immutable published content',async()=>{
    const h=await fresh(),approval=await f.approve(h.handoff_id),head=await repo.get(h.handoff_id,actors.lead),pubBody=request({expected_revision:Number(head.header.current_revision),approval_id:approval.approval_id});
    const conflictBody=f.conflictBody({revision:Number(head.header.current_revision)}),hold={entered:deferred(),release:deferred()},attempt=deferred(),holder=proxied({holdGraph:hold}),waiter=proxied({onGraphAttempt:attempt});
    let first,second;
    try{
      first=order==='conflict_first'?holder.repo.createConflict(h.handoff_id,conflictBody,actors.steward):holder.repo.publish(h.handoff_id,pubBody,actors.lead);
      const holding=await bounded(hold.entered.promise,'first graph lock');
      second=order==='conflict_first'?waiter.repo.publish(h.handoff_id,pubBody,actors.lead):waiter.repo.createConflict(h.handoff_id,conflictBody,actors.steward);
      const observed=second.then(result=>({ok:true,result}),error=>({ok:false,code:error.code})),waiting=await bounded(attempt.promise,'second graph attempt'),waits=await waitForControl(waiting.connection_id);
      races.push({order,holding,waits});hold.release.resolve();const committed=await first,rejected=await observed;assert.equal(rejected.ok,false);
      assert.equal(rejected.code,order==='conflict_first'?'HANDOFF_GATE_BLOCKED':'HANDOFF_CONFLICT_DRAFT_REQUIRED');
      const current=await repo.get(h.handoff_id,actors.lead);assert.equal(current.header.state,order==='conflict_first'?'approved':'published');
      if(order==='publish_first'){assert(committed.publication_id);assert.equal((await rows('SELECT COUNT(*) n FROM data_map_handoff_conflicts WHERE handoff_id=?',[h.handoff_id]))[0].n,0);}
      else assert.equal((await rows('SELECT COUNT(*) n FROM data_map_publications WHERE handoff_revision_id=?',[head.revision.revision_id]))[0].n,0);
    }finally{hold.release.resolve();await Promise.allSettled([first,second].filter(Boolean));}
  });
  await check('a conflict committing before an earlier exact approval makes the approval wait and then fail its current gates',async()=>{
    const h=await fresh(),submitted=await repo.submit(h.handoff_id,request({expected_revision:h.revision}),actors.steward),checked=await repo.get(h.handoff_id,actors.lead);
    const approveBody=request({expected_revision:submitted.revision,decision:'approved',binding_digest:checked.report.binding_digest,basis:proof.basis}),hold={entered:deferred(),release:deferred()},attempt=deferred(),holder=proxied({holdGraph:hold}),waiter=proxied({onGraphAttempt:attempt});
    let first,second;
    try{first=holder.repo.createConflict(h.handoff_id,f.conflictBody(submitted),actors.steward);const holding=await bounded(hold.entered.promise,'conflict before approval');second=waiter.repo.approve(h.handoff_id,approveBody,actors.lead);
      const observed=second.then(result=>({ok:true,result}),error=>({ok:false,code:error.code})),waiting=await bounded(attempt.promise,'approval graph attempt'),waits=await waitForControl(waiting.connection_id);
      races.push({order:'conflict_before_exact_approval',holding,waits});hold.release.resolve();await first;const rejected=await observed;assert.equal(rejected.code,'HANDOFF_GATE_BLOCKED');assert.equal((await repo.get(h.handoff_id,actors.lead)).header.state,'submitted');
    }finally{hold.release.resolve();await Promise.allSettled([first,second].filter(Boolean));}
  });
  await check('actual reassign graph lock makes the former handler wait and then rejects the previous conflict assignment',async()=>{
    const h=await fresh(),c=await conflict(h);await f.act(c.conflict_id,'assign',{assignee_person_id:'16'});const value=await f.current(c.conflict_id),hold={entered:deferred(),release:deferred()},attempt=deferred(),holder=proxied({holdGraph:hold}),waiter=proxied({onGraphAttempt:attempt});
    const assignBody=request({expected_revision:value.revision,expected_handoff_revision:value.current_handoff_revision,action:'assign',assignee_person_id:'21',...proof}),oldBody=request({expected_revision:value.revision,expected_handoff_revision:value.current_handoff_revision,action:'viewpoint',viewpoint:'Synthetic old handler view',...proof});let first,second;
    try{first=holder.repo.actConflict(c.conflict_id,assignBody,actors.lead);const holding=await bounded(hold.entered.promise,'assignment graph lock');second=waiter.repo.actConflict(c.conflict_id,oldBody,actors.handler);
      const observed=second.then(result=>({ok:true,result}),error=>({ok:false,code:error.code})),waiting=await bounded(attempt.promise,'old handler graph attempt'),waits=await waitForControl(waiting.connection_id);races.push({order:'assignment_before_old_handler',holding,waits});
      hold.release.resolve();await first;const denied=await observed;assert.equal(denied.code,'HANDOFF_ACTION_DENIED');assert.equal((await f.current(c.conflict_id)).conflict.assignee_person_id,'21');assert.equal(await eventCount(oldBody.request_id),0);
    }finally{hold.release.resolve();await Promise.allSettled([first,second].filter(Boolean));}
  });
  async function identityRace(name,body,action,actor,mutate,expected){
    const blocker=await pool.getConnection(),attempt=deferred(),waiter=proxied({onGraphAttempt:attempt});let pending;
    try{await blocker.beginTransaction();await lockGraph(blocker);const [[holding]]=await blocker.execute('SELECT CONNECTION_ID() connection_id');pending=action(waiter.repo,body,actor);
      const observed=pending.then(result=>({ok:true,result}),error=>({ok:false,code:error.code})),waiting=await bounded(attempt.promise,'qualification graph attempt'),waits=await waitForControl(waiting.connection_id);
      await mutate(blocker);races.push({order:name,holding,waits});await blocker.commit();const denied=await observed;assert.equal(denied.ok,false);assert.equal(denied.code,expected);assert.equal(await eventCount(body.request_id),0);
    }catch(error){await blocker.rollback();throw error;}finally{await blocker.rollback().catch(()=>{});blocker.release();await Promise.allSettled(pending?[pending]:[]);}
  }
  await check('auth_version changing during the actual graph wait rejects a previously qualified department answer',async()=>{
    const {fact}=await factFixture(),body=await f.factBody(fact.fact_id,{answer_text:'Synthetic stale login answer',evidence_refs:proof.evidence_refs});
    try{await identityRace('auth_version_before_fact_answer',body,(r,b,a)=>r.answerFact(fact.fact_id,b,a),actors.contactA,db=>db.execute('UPDATE user_accounts SET auth_version=2 WHERE account_id=114'),'HANDOFF_ACCESS_CHANGED');assert.equal((await repo.getFact(fact.fact_id,actors.lead)).status,'open');}
    finally{await pool.execute('UPDATE user_accounts SET auth_version=1 WHERE account_id=114');}
  });
  await check('a final responsible person replacement during the actual graph wait rejects the previous person confirmation',async()=>{
    const {fact}=await factFixture();await repo.answerFact(fact.fact_id,await f.factBody(fact.fact_id,{answer_text:'Synthetic exact answered meaning',evidence_refs:proof.evidence_refs}),actors.contactA);
    const answered=await repo.getFact(fact.fact_id,actors.reviewerA),body=await f.factBody(fact.fact_id,{answered_fact_version_id:answered.fact_version_id,answered_snapshot_digest:answered.snapshot_digest,...proof});
    try{await identityRace('department_head_before_fact_confirmation',body,(r,b,a)=>r.confirmFact(fact.fact_id,b,a),actors.reviewerA,async db=>{
      await db.execute('UPDATE departments SET final_responsible_person_id=23 WHERE id=91');await db.execute("INSERT INTO identity_access_events(event_type,actor_person_id,target_person_id,payload_json) VALUES('role_assigned',11,23,?)",[json({roleCode:'department_mdm_reviewer',departmentAppointment:{departmentId:'91',changed:true,decisionRecordCutoff:'0'}})]);
    },'HANDOFF_ACTION_DENIED');assert.equal((await repo.getFact(fact.fact_id,actors.lead)).status,'answered');}
    finally{await f.appointment('91','18');}
  });
  await check('business conflict lock already owns assignment so a later registration waits assignment and cannot form the previous inverse lock cycle',async()=>{
    const h=await fresh(),c=await conflict(h),value=await f.current(c.conflict_id),hold={entered:deferred(),release:deferred()},attempt=deferred();
    const holder=proxied({holdSql:{...hold,match:(sql,args,ordinal)=>ordinal===2&&/FROM data_map_handoff_conflicts\b[\s\S]*FOR UPDATE/i.test(sql)}});
    const waiter=proxied({attemptSql:{entered:attempt,match:(sql,args,ordinal)=>ordinal===1&&/FROM process_governance_responsibilities\b[\s\S]*FOR UPDATE/i.test(sql)}});
    const firstBody=request({expected_revision:value.revision,expected_handoff_revision:value.current_handoff_revision,action:'viewpoint',viewpoint:'Synthetic first ordered business view',...proof});
    const secondBody=request({expected_revision:value.revision,expected_handoff_revision:value.current_handoff_revision,action:'viewpoint',viewpoint:'Synthetic later registration view',...proof});let first,second;
    try{
      first=holder.repo.actConflict(c.conflict_id,firstBody,actors.steward);first.catch(()=>{});const holding=await bounded(hold.entered.promise,'business conflict lock after assignment');
      const firstLocks=holder.stats.lock_attempts.filter(item=>item.ordinal===2),assignmentIndex=firstLocks.findIndex(item=>item.table==='process_governance_responsibilities'),conflictIndex=firstLocks.findIndex(item=>item.table==='data_map_handoff_conflicts');
      assert(assignmentIndex>=0&&conflictIndex>assignmentIndex,'business must lock assignment before conflict');
      second=waiter.repo.actConflict(c.conflict_id,secondBody,actors.lead);const observed=second.then(result=>({ok:true,result}),error=>({ok:false,code:error.code}));
      const waiting=await bounded(attempt.promise,'later registration assignment attempt'),waits=await waitForTable(waiting.connection_id,'process_governance_responsibilities');
      assert(!waiter.stats.lock_attempts.some(item=>item.table==='data_map_handoff_conflicts'),'registration cannot hold conflict while waiting assignment');
      races.push({order:'business_conflict_before_later_registration',handoff_id:h.handoff_id,conflict_id:c.conflict_id,holding,waits,first_locks:firstLocks,waiting_locks:[...waiter.stats.lock_attempts],request_ids:[firstBody.request_id,secondBody.request_id]});
      hold.release.resolve();const done=await bounded(first,'first ordered conflict commit'),denied=await bounded(observed,'later stale conflict request');
      assert.equal(done.revision,value.revision+1);assert.equal(denied.ok,false);assert.equal(denied.code,'HANDOFF_CONFLICT_REVISION_CONFLICT');races.at(-1).rejection_code=denied.code;
      assert.equal(await eventCount(firstBody.request_id),1);assert.equal(await eventCount(secondBody.request_id),0);
    }finally{hold.release.resolve();await Promise.allSettled([first,second].filter(Boolean));}
  });
  await check('pure gate GET completes against a consistent snapshot while a real writer holds graph control, then observes the committed conflict',async()=>{
    const h=await fresh(),body=f.conflictBody(h),hold={entered:deferred(),release:deferred()},holder=proxied({holdGraph:hold}),reader=proxied({});let writing;
    try{
      writing=holder.repo.createConflict(h.handoff_id,body,actors.steward);writing.catch(()=>{});
      const holding=await bounded(hold.entered.promise,'graph writer holds control');
      const before=await bounded(reader.repo.get(h.handoff_id,actors.lead),'non-locking gate read while graph held');
      assert.equal(before.report.ready_for_approval,true);assert.deepEqual(reader.stats.lock_attempts,[],'discovery GET must not request graph, assignment or conflict row locks');
      races.push({order:'graph_writer_held_pure_gate_reader_completes',handoff_id:h.handoff_id,holding,reader_locks:[],request_id:body.request_id});
      hold.release.resolve();assert.equal((await bounded(writing,'graph writer commit')).state,'open');
      assert.equal((await reader.repo.get(h.handoff_id,actors.lead)).report.ready_for_approval,false);
    }finally{hold.release.resolve();await Promise.allSettled(writing?[writing]:[]);}
  });
  await check('concurrent pure gate readers and conflict mutation finish without persistent reader locks or inverse cycles',async()=>{
    const h=await fresh(),c=await conflict(h),value=await f.current(c.conflict_id),reader=proxied({});
    const body=request({expected_revision:value.revision,expected_handoff_revision:value.current_handoff_revision,action:'viewpoint',viewpoint:'Synthetic mutation concurrent with snapshot readers',...proof});
    const [incoming,reads]=await bounded(Promise.all([repo.actConflict(c.conflict_id,body,actors.steward),Promise.all(Array.from({length:10},()=>reader.repo.get(h.handoff_id,actors.lead)))]),'concurrent pure readers and conflict mutation');
    assert.equal(incoming.revision,value.revision+1);assert(reads.every(result=>result.report.ready_for_approval===false));assert.deepEqual(reader.stats.lock_attempts,[]);
    assert.equal(await eventCount(body.request_id),1);races.push({order:'ten_pure_gate_readers_and_conflict_mutation',handoff_id:h.handoff_id,reader_count:reads.length,reader_locks:[],request_id:body.request_id});
  });
},{stage:'80',randomDatabase:true});owned.cleaned=true;passed=true;
}catch(error){failure={code:error.code,message:error.message,payload:error.payload,stack:error.stack};throw error;}
finally{if(owned)try{owned.cleaned=execFileSync('docker',['ps','-aq','--filter','id='+owned.containerId,'--filter','label=infomat.stage80='+owned.owner],{env:isolatedEnvironment(),encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe']}).trim()==='';}catch{owned.cleanup_verification='unavailable';}
  save('results.json',{passed,checks,faults,races,observedDenials,owned,failure,formal_database_connected:false,formal_migration_executed:false,feature_activation:false,business_accepted:false,
  scope:'actual repository transactions, actual COMMIT acknowledgement loss and actual performance_schema control-row waits; no HTTP or browser acceptance'});}}
main().then(()=>console.log('CONFLICT_FAULTS_MYSQL_PASS '+checks.length+' '+output)).catch(error=>{console.error(error.code||error.message);if(error.code==='ERR_ASSERTION')console.error(error.message);process.exitCode=1;});
