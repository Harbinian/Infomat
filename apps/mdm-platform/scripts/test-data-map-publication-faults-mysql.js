// Q10 transaction faults and real InnoDB races on a newly owned stage78 tmpfs
// MySQL only. Inputs are synthetic identities, native V8 packages and canonical
// source mappings. The reference adapter below verifies the shared transaction
// contract (graph lock + fresh eligibility + fixed reference insert); it is not
// a claim that an HTTP import or a formal service was exercised. Evidence omits
// credentials, cookies and private config; no formal DB, migration or activation.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed,draftBody}=require('./testHelpers/dataMapHandoffFixture');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {lockGraph}=require('../server/dataMapHandoffControl');
const {json,digest,parse}=require('../server/dataMapHandoffPolicy');
const reader=require('../server/dataMapEffectiveReader'),lifecycle=require('../server/dataMapPublicationLifecycle');
const output=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-03/publication-faults-'+crypto.randomUUID());
if(process.argv[2]){assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output),'preserve previous evidence');}
assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const env={DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'},request=body=>({request_id:crypto.randomUUID(),...body});
const checks=[],races=[],faults=[],observedDenials=[];let owned,passed=false,failure;
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),15000);})]);}finally{clearTimeout(timer);}}
async function check(name,work){await work();checks.push(name);console.log('PASS '+name);save('progress.json',{checks,races,faults,observedDenials});}
async function code(work,expected){await assert.rejects(work,error=>error.code===expected,expected);}
function faultPool(pool,{lostCommit,failSql,holdSql,onGraphAttempt}={}){
  const stats={connections:[],triggered:false,head_updates:0,held:false};
  const proxy=new Proxy(pool,{get(target,key){
    if(key==='getConnection')return async()=>{
      const db=await target.getConnection(),ordinal=stats.connections.length+1,[[identity]]=await db.execute('SELECT CONNECTION_ID() id');
      const record={ordinal,connection_id:identity.id,commits:0,rollbacks:0,destroys:0,releases:0};stats.connections.push(record);
      return new Proxy(db,{get(connection,method){
        if(method==='execute')return async(sql,args)=>{
          if(onGraphAttempt&&/FROM data_map_governance_control\b[\s\S]*FOR UPDATE/i.test(sql))onGraphAttempt.resolve({ordinal,connection_id:identity.id});
          if(!stats.triggered&&failSql?.(sql,args)){stats.triggered=true;throw Object.assign(Error('synthetic pre-commit SQL failure'),{code:'SYNTHETIC_LIFECYCLE_SQL_FAILURE'});}
          const value=await connection.execute(sql,args);
          if(/^\s*UPDATE data_map_effective_heads\b/i.test(sql))stats.head_updates++;
          if(!stats.held&&holdSql?.match(sql,args)){stats.held=true;holdSql.entered.resolve({ordinal,connection_id:identity.id});await bounded(holdSql.release.promise,'held lifecycle transaction');}
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
  }});
  return {proxy,stats};
}
async function main(){try{await withFreshMysql(async target=>{
  const {pool,owner,database,containerId,port}=target;owned={owner,database,containerId,port,tmpfs:true,loopback:true};
  const fixture=await seed(target),lead=fixture.session(11),otherLead=fixture.session(15),steward=fixture.session(12),contact=fixture.session(14),repo=createDataMapHandoffRepository(pool,{env});
  const rows=async(sql,args=[])=>(await pool.execute(sql,args))[0];
  async function tx(work,{commit=false}={}){const db=await pool.getConnection();try{await db.beginTransaction();await lockGraph(db);const value=await work(db);if(commit)await db.commit();else await db.rollback();return value;}catch(error){await db.rollback();throw error;}finally{db.release();}}
  async function bind(number,options={}){await fixture.packageSeed(number,options);const intake=await repo.prepareIntake(String(number),request({expected_revision:0}),lead);return repo.reviewIntake(intake.intake_id,request({expected_revision:1,basis:'synthetic exact current review',detail_evidence:intake.required_detail_evidence.map(x=>({...x,basis:'synthetic source verified',evidence_refs:['synthetic:source']}))}),lead);}
  async function publish(number){
    const binding=await bind(number);let draft=await repo.fromWorkPackage(String(number),request({expected_revision:0,binding_id:binding.binding_id,draft:draftBody()}),lead);
    draft=await repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),lead);const current=await repo.get(draft.handoff_id,lead);assert(current.report.ready_for_approval,JSON.stringify(current.report.gates));
    const approval=await repo.approve(draft.handoff_id,request({expected_revision:draft.revision,decision:'approved',basis:'synthetic initial approval',binding_digest:current.report.binding_digest}),lead);
    return repo.publish(draft.handoff_id,request({expected_revision:draft.revision,approval_id:approval.approval_id}),lead);
  }
  async function withdrawal(publication){const reason='synthetic controlled stop '+publication.publication_id,report=await repo.withdrawalChecks(publication.publication_id,request({expected_revision:1,reason}),lead);const approval=await repo.approveWithdrawal(publication.publication_id,request({expected_revision:1,reason,basis:'synthetic complete impact approved',binding_digest:report.report.binding_digest}),lead);return request({expected_revision:1,reason,withdrawal_approval_id:approval.withdrawal_approval_id});}
  async function eventCount(id){return Number((await rows('SELECT COUNT(*) n FROM data_map_publication_events WHERE publication_id=?',[id]))[0].n);}
  async function business(){const tables={data_map_handoff_drafts:'handoff_id',data_map_handoff_revisions:'revision_id',data_map_handoff_events:'event_id',data_map_effective_heads:'subject_kind,subject_id',data_map_publications:'publication_id',data_map_publication_events:'publication_id,event_no',data_map_handoff_generation_tasks:'task_id'};const value={};for(const [table,order]of Object.entries(tables))value[table]=await rows('SELECT * FROM '+table+' ORDER BY '+order);return value;}
  async function bindingFor(pkg){return parse((await rows('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=(SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=?)',[String(pkg)]))[0].snapshot_json);}
  function restorationBody(publication,targetId,bound,active=null){
    const draft=draftBody();for(const item of draft.items){const old=publication.items.find(x=>x.item_ref===item.item_ref);item.target_id=old.target_id;if(['object','field','data_element'].includes(item.target_kind)){item.operation='modify';item.base_version_ref=old.target_version_ref;}item.source_detail_refs=[bound.detail_versions[0].detail_version_id];}
    return request({expected_revision:2,target_package_id:String(targetId),expected_target_revision:active?.revision||0,...(active?{target_handoff_id:active.handoff_id}:{}),scope_mode:'current',draft,basis:'synthetic explicit fixed-content adoption',evidence_refs:['synthetic:restoration'],item_mappings:publication.items.map(x=>({source_item_ref:x.item_ref,target_item_ref:x.item_ref,content_decision:'adopt',basis:'synthetic same meaning with rebuilt version references',evidence_refs:['synthetic:adoption']}))});
  }
  let packageNumber=7800;
  for(const lostCommit of [1,2])await check('withdraw request transaction '+(lostCommit===1?'A':'B')+' loses the actual COMMIT acknowledgement, destroys uncertainty and recovers the original UUID once',async()=>{
    const publication=await publish(++packageNumber),body=await withdrawal(publication),fault=faultPool(pool,{lostCommit});
    await code(()=>createDataMapHandoffRepository(fault.proxy,{env}).withdrawPublication(publication.publication_id,body,lead),'HANDOFF_COMMIT_UNKNOWN');
    const uncertain=fault.stats.connections[lostCommit-1];assert.equal(uncertain.commits,1);assert.equal(uncertain.destroys,1);assert.equal(uncertain.rollbacks,0);assert.equal(uncertain.releases,0);
    const receipt=await repo.receipt(body.request_id,lead);assert.equal(receipt.state,lostCommit===1?'prepared':'committed');assert.equal(await eventCount(publication.publication_id),lostCommit===1?1:2);
    const result=await repo.withdrawPublication(publication.publication_id,body,lead);assert.equal(result.event_revision,2);assert.equal(await eventCount(publication.publication_id),2);
    assert.deepEqual(await repo.withdrawPublication(publication.publication_id,body,lead),result);assert.deepEqual((await repo.receipt(body.request_id,lead)).result,result);
    faults.push({scenario:'withdraw_commit_'+(lostCommit===1?'A':'B'),request_id:body.request_id,publication_id:publication.publication_id,stats:fault.stats});
  });
  await check('pre-publication-event failure after actual head updates rolls back all business rows and permits the same prepared UUID retry',async()=>{
    const publication=await publish(++packageNumber),body=await withdrawal(publication),before=await business();
    const fault=faultPool(pool,{failSql:sql=>/INSERT INTO data_map_publication_events\b/.test(sql)});
    await code(()=>createDataMapHandoffRepository(fault.proxy,{env}).withdrawPublication(publication.publication_id,body,lead),'SYNTHETIC_LIFECYCLE_SQL_FAILURE');
    assert(fault.stats.head_updates>0);assert.deepEqual(await business(),before);assert.equal((await repo.receipt(body.request_id,lead)).state,'prepared');
    assert.equal((await repo.withdrawPublication(publication.publication_id,body,lead)).event_revision,2);assert.equal(await eventCount(publication.publication_id),2);
    faults.push({scenario:'withdraw_late_sql',request_id:body.request_id,stats:fault.stats});
  });
  const stopped=await publish(++packageNumber),stoppedBody=await withdrawal(stopped);await repo.withdrawPublication(stopped.publication_id,stoppedBody,lead);
  await check('restoration_created failure rolls back the new draft revision and task effects before an original UUID retry',async()=>{
    const body=restorationBody(stopped,String(packageNumber),await bindingFor(packageNumber)),before=await business();
    const fault=faultPool(pool,{failSql:(sql,args)=>/INSERT INTO data_map_handoff_events\b/.test(sql)&&args[2]==='restoration_created'});
    await code(()=>createDataMapHandoffRepository(fault.proxy,{env}).restorePublication(stopped.publication_id,body,lead),'SYNTHETIC_LIFECYCLE_SQL_FAILURE');
    assert.deepEqual(await business(),before);assert.equal((await repo.receipt(body.request_id,lead)).state,'prepared');
    const draft=await repo.restorePublication(stopped.publication_id,body,lead);assert.equal(draft.state,'draft');assert.equal(draft.revision,1);assert.deepEqual(await repo.restorePublication(stopped.publication_id,body,lead),draft);
    faults.push({scenario:'restoration_new_draft_late_sql',request_id:body.request_id,stats:fault.stats});
  });
  await check('restoration_created failure preserves an existing active target draft body revision and task state exactly',async()=>{
    const publication=await publish(++packageNumber),body=await withdrawal(publication);await repo.withdrawPublication(publication.publication_id,body,lead);
    const sourcePackage=packageNumber;await pool.execute("UPDATE process_design_versions SET status='superseded' WHERE id=?",[String(sourcePackage)]);
    const targetPackage=++packageNumber,binding=await bind(targetPackage,{documentId:sourcePackage}),initial=draftBody();initial.basis='synthetic existing unfinished input';
    const active=await repo.fromWorkPackage(String(targetPackage),request({expected_revision:0,binding_id:binding.binding_id,draft:initial}),steward);
    const input=restorationBody(publication,targetPackage,await bindingFor(targetPackage),active),before=await business(),old=await repo.get(active.handoff_id,steward);
    const fault=faultPool(pool,{failSql:(sql,args)=>/INSERT INTO data_map_handoff_events\b/.test(sql)&&args[2]==='restoration_created'});
    await code(()=>createDataMapHandoffRepository(fault.proxy,{env}).restorePublication(publication.publication_id,input,steward),'SYNTHETIC_LIFECYCLE_SQL_FAILURE');
    assert.deepEqual(await business(),before);const retained=await repo.get(active.handoff_id,steward);assert.equal(retained.revision.content_digest,old.revision.content_digest);assert.equal(retained.header.current_revision,old.header.current_revision);assert.equal((await repo.receipt(input.request_id,steward)).state,'prepared');
    const updated=await repo.restorePublication(publication.publication_id,input,steward);assert.equal(updated.handoff_id,active.handoff_id);assert.equal(updated.revision,2);assert.equal((await repo.get(active.handoff_id,steward,{revisionNo:1})).revision.content_digest,old.revision.content_digest);
    faults.push({scenario:'restoration_active_draft_late_sql',request_id:input.request_id,stats:fault.stats});
  });
  async function waitForControl(connectionId){
    for(let i=0;i<240;i++){
      const [waits]=await pool.execute(`SELECT r.OBJECT_NAME,r.LOCK_MODE,t.PROCESSLIST_ID requesting_connection,bt.PROCESSLIST_ID blocking_connection,b.LOCK_MODE blocking_mode
        FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
        JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=r.THREAD_ID
        JOIN performance_schema.threads bt ON bt.THREAD_ID=b.THREAD_ID WHERE r.OBJECT_SCHEMA=? AND r.OBJECT_NAME='data_map_governance_control' AND t.PROCESSLIST_ID=?`,[database,connectionId]);
      if(waits.length)return waits;await sleep(25);
    }throw Error('Expected an actual InnoDB wait on the shared control row');
  }
  async function referenceAdapter(publication,batchId,{started=null,hold=null}={}){
    const object=publication.items.find(x=>x.target_kind==='object'),db=await pool.getConnection();
    try{
      await db.beginTransaction();const [[connection]]=await db.execute('SELECT CONNECTION_ID() id');if(started)started.resolve(connection.id);
      await lockGraph(db);
      await reader.assertReferenceable(db,{entityType:'object',entityId:object.target_id,versionId:object.target_version_ref});assert.equal(await reader.isVersionReferenceable(db,object.target_version_ref),true);
      await db.execute("INSERT INTO data_map_import_batches(id,source_type) VALUES(?,'synthetic_contract_adapter')",[batchId]);
      await db.execute("INSERT INTO data_map_source_files(batch_id,raw_sha256,raw_digest_status,byte_length,parser_version,template_profile_version,scope_department_id,imported_by_person_id) VALUES(?,?,'available',1,'synthetic-q10','synthetic-q10',91,15)",[batchId,digest({batchId})]);
      await db.execute("INSERT INTO data_map_source_mappings(batch_id,sheet_name,record_type,local_id,source_row,platform_version_id,source_cell_ids_json) VALUES(?,'synthetic','object','synthetic-object',1,?,'[]')",[batchId,object.target_version_ref]);
      await db.execute('UPDATE data_map_governance_control SET graph_revision=graph_revision+1 WHERE control_id=1');
      if(hold){hold.entered.resolve(connection.id);await bounded(hold.release.promise,'held reference transaction');}
      await db.commit();return {batch_id:String(batchId),version_id:object.target_version_ref,connection_id:connection.id};
    }catch(error){await db.rollback();throw error;}finally{db.release();}
  }
  await check('withdrawal holding the real graph lock makes a later reference wait and then reject the withdrawn version without inserting any mapping',async()=>{
    const publication=await publish(++packageNumber),body=await withdrawal(publication),entered=deferred(),release=deferred(),started=deferred();
    const fault=faultPool(pool,{holdSql:{match:sql=>/^\s*UPDATE data_map_effective_heads\b/.test(sql),entered,release}});
    const pending=createDataMapHandoffRepository(fault.proxy,{env}).withdrawPublication(publication.publication_id,body,lead);let incoming;
    try{
      const holder=await bounded(entered.promise,'withdrawal graph lock');incoming=referenceAdapter(publication,78001,{started});const observed=incoming.then(result=>({ok:true,result}),error=>({ok:false,code:error.code}));
      const connectionId=await bounded(started.promise,'reference connection'),waits=await waitForControl(connectionId);races.push({order:'withdraw_first',holder,waits,contract:'lockGraph -> eligibility -> canonical insert'});
      release.resolve();assert.equal((await pending).event_revision,2);const denied=await observed;assert.equal(denied.ok,false);assert.equal(denied.code,'HANDOFF_REFERENCE_UNAVAILABLE');
      assert.equal((await rows('SELECT COUNT(*) n FROM data_map_source_mappings WHERE batch_id=78001'))[0].n,0);
      await code(()=>tx(db=>reader.isVersionReferenceable(db,publication.items.find(x=>x.target_kind==='object').target_version_ref)),'HANDOFF_REFERENCE_UNAVAILABLE');
    }finally{release.resolve();await Promise.allSettled([pending,...(incoming?[incoming]:[])]);}
  });
  await check('a new reference holding the real graph lock commits first and invalidates the earlier exact withdrawal approval',async()=>{
    const publication=await publish(++packageNumber),body=await withdrawal(publication),hold={entered:deferred(),release:deferred()},attempt=deferred();
    const incoming=referenceAdapter(publication,78002,{hold});let pending;
    try{
      const holder=await bounded(hold.entered.promise,'reference graph lock'),fault=faultPool(pool,{onGraphAttempt:attempt});
      pending=createDataMapHandoffRepository(fault.proxy,{env}).withdrawPublication(publication.publication_id,body,lead);const observed=pending.then(result=>({ok:true,result}),error=>({ok:false,code:error.code}));
      const waiting=await bounded(attempt.promise,'withdrawal graph attempt'),waits=await waitForControl(waiting.connection_id);races.push({order:'reference_first',holder,waits,contract:'lockGraph -> eligibility -> canonical insert'});
      hold.release.resolve();await incoming;const rejected=await observed;assert.equal(rejected.ok,false);assert.equal(rejected.code,'HANDOFF_WITHDRAWAL_APPROVAL_CHANGED');assert.equal(await eventCount(publication.publication_id),1);
      assert.equal((await rows('SELECT COUNT(*) n FROM data_map_source_mappings WHERE batch_id=78002'))[0].n,1);assert.equal((await repo.receipt(body.request_id,lead)).state,'rejected');
    }finally{hold.release.resolve();await Promise.allSettled([incoming,...(pending?[pending]:[])]);}
  });
  await check('current executor and original approver auth role or package-assignment changes stop execution and unauthorized receipt reads fail',async()=>{
    const publication=await publish(++packageNumber),body=await withdrawal(publication),before=await eventCount(publication.publication_id);
    async function denied(work,expected){await assert.rejects(work,error=>{observedDenials.push({code:error.code,statusCode:error.statusCode});return expected?error.code===expected:[401,403].includes(error.statusCode);});}
    await pool.execute('UPDATE user_accounts SET auth_version=2 WHERE account_id=115');
    try{await denied(()=>repo.withdrawPublication(publication.publication_id,{...body,request_id:crypto.randomUUID()},otherLead),'HANDOFF_ACCESS_CHANGED');}finally{await pool.execute('UPDATE user_accounts SET auth_version=1 WHERE account_id=115');}
    await pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=15");
    try{await denied(()=>repo.withdrawPublication(publication.publication_id,{...body,request_id:crypto.randomUUID()},otherLead));}finally{await pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=15");}
    await pool.execute('UPDATE user_accounts SET auth_version=2 WHERE account_id=111');
    try{await denied(()=>repo.withdrawPublication(publication.publication_id,{...body,request_id:crypto.randomUUID()},otherLead),'HANDOFF_APPROVER_CHANGED');}finally{await pool.execute('UPDATE user_accounts SET auth_version=1 WHERE account_id=111');}
    await pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=11");
    try{await denied(()=>repo.withdrawPublication(publication.publication_id,{...body,request_id:crypto.randomUUID()},otherLead),'HANDOFF_APPROVER_CHANGED');}finally{await pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=11");}
    await pool.execute("UPDATE process_governance_responsibilities SET person_id=15,revision_no=2 WHERE target_type='work_package' AND target_id=?",[String(packageNumber)]);
    try{await denied(()=>repo.withdrawPublication(publication.publication_id,{...body,request_id:crypto.randomUUID()},otherLead),'HANDOFF_APPROVER_CHANGED');}finally{await pool.execute("UPDATE process_governance_responsibilities SET person_id=12,revision_no=1 WHERE target_type='work_package' AND target_id=?",[String(packageNumber)]);}
    assert.equal(await eventCount(publication.publication_id),before);const done=await repo.withdrawPublication(publication.publication_id,body,otherLead);assert.equal(done.event_revision,2);
    await denied(()=>repo.receipt(body.request_id,contact));
    await pool.execute("UPDATE process_governance_responsibilities SET person_id=15,revision_no=2 WHERE target_type='work_package' AND target_id=?",[String(packageNumber)]);
    try{await denied(()=>repo.get(publication.handoff_id,steward));await denied(()=>repo.receipt(body.request_id,steward));}finally{await pool.execute("UPDATE process_governance_responsibilities SET person_id=12,revision_no=1 WHERE target_type='work_package' AND target_id=?",[String(packageNumber)]);}
  });
  await check('recomputed manifest and first-event digests cannot forge restoration lineage or adjustment history that differs from the immutable revision',async()=>{
    const publication=await publish(++packageNumber);
    for(const mutation of [manifest=>{manifest.restoration={source_publication_id:crypto.randomUUID(),basis:'synthetic false lineage'};},manifest=>{manifest.restoration_adjustments=[{basis:'synthetic false adjustment'}];}])await code(()=>tx(async db=>{
      const [[row]]=await db.execute('SELECT manifest_json FROM data_map_publications WHERE publication_id=?',[publication.publication_id]),manifest=parse(row.manifest_json);mutation(manifest);const hash=digest(manifest);
      await db.execute('UPDATE data_map_publications SET manifest_json=?,manifest_digest=? WHERE publication_id=?',[json(manifest),hash,publication.publication_id]);
      const [[event]]=await db.execute('SELECT payload_json FROM data_map_publication_events WHERE publication_id=? AND event_no=1',[publication.publication_id]),payload=parse(event.payload_json);payload.manifest_digest=hash;await db.execute('UPDATE data_map_publication_events SET payload_json=? WHERE publication_id=? AND event_no=1',[json(payload),publication.publication_id]);
      return lifecycle.inspectPublication(db,publication.publication_id);
    }),'HANDOFF_PUBLICATION_INTEGRITY_CONFLICT');
  });
},{stage:'78',randomDatabase:true});owned.cleaned=true;passed=true;
}catch(error){failure={code:error.code,message:error.message,payload:error.payload,stack:error.stack};throw error;}
finally{save('results.json',{passed,checks,races,faults,observedDenials,owned,failure,reference_scope:'adapter transaction contract; not HTTP importer acceptance',access_model_scope:'actual fixture v5; existing v4 suite is separate evidence',formal_database_connected:false,feature_activation:false,business_accepted:false});}
}
main().then(()=>console.log('PUBLICATION_FAULTS_MYSQL_PASS '+checks.length+' '+output)).catch(error=>{console.error(error.code||error.message);if(error.code==='ERR_ASSERTION')console.error(error.message);process.exitCode=1;});
