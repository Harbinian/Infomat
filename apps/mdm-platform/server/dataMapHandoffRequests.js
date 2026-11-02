// Prepared registration and business+receipt commit use separate, explicit transactions.
const {failure,uuid,writable,digest,json,parse} = require('./dataMapHandoffPolicy');
const {sessionSubject} = require('./sessionSubject');
const {lockGraph} = require('./dataMapHandoffControl');
function unknown(requestId) {return failure('HANDOFF_COMMIT_UNKNOWN',503,{request_id:requestId,receipt_url:'/api/data-map-handoffs/requests/'+requestId,business_outcome:'pending_verification'});}
function createHandoffRequestStore(pool,{authorize,env=process.env,assertReady=async()=>{},assertNoCommittedEffects=async()=>{},assertWritable=()=>writable(env),actorIdentity=session=>({kind:'person',ref:String(sessionSubject(session).personId||'')})}={}) {
  if(typeof authorize!=='function')throw new TypeError('authorize is required');
  const readAction=scope=>scope.factRequestId?'fact_read':scope.conflictId?'conflict_read':'read';
  async function connection(action){
    const db=await pool.getConnection();let uncertain=false;
    try{return await action(db);}
    catch(error){if(error.code==='HANDOFF_COMMIT_UNKNOWN'){uncertain=true;db.destroy();}throw error;}
    finally{if(!uncertain)db.release();}
  }
  async function register(action,scope,body,session) {
    const requestId=uuid(body.request_id),identity=actorIdentity(session),actorRef=identity.ref;
    const hash=digest({action,scope,body});
    return connection(async db=>{
      let committing=false;
      try {
        await db.beginTransaction();
        // Acquire the unique request record before reading it. A SELECT of a
        // missing UUID followed by INSERT makes two RR gap locks deadlock when
        // the very first identical request arrives concurrently. This no-op
        // duplicate update serializes the contenders; authorization failure
        // rolls the entire registration back, including a new prepared row.
        await db.execute(`INSERT INTO data_map_handoff_requests
          (request_id,actor_kind,actor_ref,action,scope_kind,scope_id,scope_json,payload_digest,state,created_at)
          VALUES(?,?,?,?,?,?,?,?,'prepared',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE request_id=request_id`,[requestId,identity.kind,actorRef,action,scope.kind,String(scope.id),json(scope),hash]);
        const [[old]]=await db.execute('SELECT * FROM data_map_handoff_requests WHERE request_id=? FOR UPDATE',[requestId]);
        if(old && (old.actor_kind!==identity.kind || old.actor_ref!==actorRef || old.action!==action || old.scope_id!==String(scope.id) || old.payload_digest!==hash))throw failure('HANDOFF_REQUEST_PAYLOAD_CONFLICT');
        await authorize(db,session,old && old.state!=='prepared'?readAction(scope):action,scope,old && old.state!=='prepared'?{lock:false}:{});
        if(old && old.state!=='prepared'){await db.rollback().catch(()=>{});return {requestId,hash,old};}
        if(identity.kind==='person'){
          const [[reserved]]=await db.execute('SELECT task_id FROM data_map_handoff_generation_tasks WHERE system_request_id=? FOR SHARE',[requestId]);
          if(reserved)throw failure('HANDOFF_SYSTEM_REQUEST_RESERVED',409);
        }
        committing=true;await db.commit();
        return {requestId,hash,old};
      } catch(error){
        if(committing)throw unknown(requestId);
        await db.rollback().catch(()=>{});throw error;
      }
    });
  }
  async function reject(requestId,error) {
    if(!error.statusCode || error.code==='HANDOFF_RECEIPT_INCONSISTENT' || ['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code))return;
    await connection(async db=>{
      try{
        await db.beginTransaction();
        const [[row]]=await db.execute('SELECT state FROM data_map_handoff_requests WHERE request_id=? FOR UPDATE',[requestId]);
        if(row && row.state==='prepared')await db.execute("UPDATE data_map_handoff_requests SET state='rejected',result_json=?,finished_at=UTC_TIMESTAMP(3) WHERE request_id=?",[json({status:error.statusCode,...(error.payload||{code:error.code,error:error.message})}),requestId]);
        await db.commit();
      }catch{await db.rollback().catch(()=>{});}
    });
  }
  async function execute(action,scope,body,session,work) {
    assertWritable();
    scope=JSON.parse(json(scope));
    const scopeHash=digest(scope);
    const {requestId,hash,old}=await register(action,scope,body,session);
    if(old && old.state!=='prepared'){const result=parse(old.result_json);if(old.state==='rejected')throw failure(result.code||'HANDOFF_REQUEST_REJECTED',result.status||409,result);return result;}
    let rolledBack=false;
    try {
      return await connection(async db=>{
        let committing=false;
        try {
          await db.beginTransaction();
          const [[request]]=await db.execute('SELECT * FROM data_map_handoff_requests WHERE request_id=? FOR UPDATE',[requestId]);
          if(!request||request.payload_digest!==hash)throw failure('HANDOFF_REQUEST_PAYLOAD_CONFLICT');
          if(request.state!=='prepared'){
            await authorize(db,session,readAction(scope),scope,{lock:false});
            const saved=parse(request.result_json);
            if(request.state==='rejected')throw failure(saved.code||'HANDOFF_REQUEST_REJECTED',saved.status||409,saved);
            await db.rollback().catch(()=>{});return saved;
          }
          assertWritable();
          // The validator pins table metadata and its migration marker in this
          // transaction. Independent requests can inspect in parallel without
          // holding the graph row, and DDL cannot invalidate a waiting writer.
          await assertReady(db);
          const control=await lockGraph(db);
          await assertNoCommittedEffects(db,requestId);
          let qualified=false;
          const reauthorize=async(actionOverride=action,scopeOverride=scope)=>{
            if(actionOverride!==action||digest(scopeOverride)!==scopeHash)throw failure('HANDOFF_AUTHORITY_CONTEXT_MISMATCH',503);
            const actor=await authorize(db,session,action,scope);qualified=true;return actor;
          };
          const result=await work(db,control,reauthorize,{request_id:requestId});
          if(!qualified||digest(scope)!==scopeHash)throw failure('HANDOFF_AUTHORITY_REQUIRED',503);
          const receipt={...result,request_id:requestId,action,receipt_url:'/api/data-map-handoffs/requests/'+requestId};
          await db.execute('UPDATE data_map_governance_control SET graph_revision=graph_revision+1 WHERE control_id=1');
          await db.execute("UPDATE data_map_handoff_requests SET state='committed',result_json=?,finished_at=UTC_TIMESTAMP(3) WHERE request_id=? AND state='prepared'",[json(receipt),requestId]);
          committing=true;await db.commit();return receipt;
        }catch(error){
          if(committing)throw unknown(requestId);
          try {await db.rollback();rolledBack=true;} catch {throw unknown(requestId);}
          throw error;
        }
      });
    }catch(error){
      if(error.code==='HANDOFF_COMMIT_UNKNOWN')throw error;
      if(rolledBack)await reject(requestId,error);
      if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code))throw failure('HANDOFF_BUSY',409,{request_id:requestId,business_outcome:'pending_verification'});
      throw error;
    }
  }
  async function receipt(requestId,session){
    uuid(requestId);
    return connection(async db=>{
      await db.beginTransaction();
      try{
        const [[initial]]=await db.execute('SELECT * FROM data_map_handoff_requests WHERE request_id=?',[requestId]);
        if(!initial){await db.commit();return {request_id:requestId,state:'not_observed',business_outcome:'pending_verification'};}
        const scope=parse(initial.scope_json);
        await authorize(db,session,readAction(scope),scope,{lock:false});
        let row;
        try {[[row]]=await db.execute('SELECT * FROM data_map_handoff_requests WHERE request_id=? FOR UPDATE NOWAIT',[requestId]);}
        catch(error){if(['ER_LOCK_NOWAIT','ER_LOCK_WAIT_TIMEOUT'].includes(error.code)){await db.rollback();return {request_id:requestId,state:'in_progress',business_outcome:'pending_verification'};}throw error;}
        if(row.state==='prepared')await assertNoCommittedEffects(db,requestId);
        const result=row.state==='prepared'?null:parse(row.result_json);
        await db.commit();
        return {request_id:requestId,state:row.state,observation:row.state==='prepared'?'retryable':row.state,business_outcome:result?.business_outcome||'not_committed',result};
      }catch(error){await db.rollback().catch(()=>{});throw error;}
    });
  }
  return {execute,receipt};
}
module.exports={createHandoffRequestStore};
