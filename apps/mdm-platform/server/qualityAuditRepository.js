const crypto=require('node:crypto');
const schema=require('./qualityAuditSchema');
const p=require('./qualityAuditPolicy');
const {inspectDesign,assertDesign}=require('./qualityAuditDesign');
const {readPersonAuthority}=require('./identityMysqlRepository');
const {sessionSubject}=require('./sessionSubject');
const {json,digest,parse}=require('./dataMapDefinitionValues');
const one=async(db,sql,args=[])=>(await db.execute(sql,args))[0][0]||null;
const person=a=>({person_id:String(a.user.personId),person_name:a.user.personName||a.user.name||null});
const publicReceipt=row=>{const {_action,...result}=parse(row.response_json);return result;};
function makeQualityAuditRepository(pool){
  async function transaction(session,fn,{write=false}={}){
    if(!schema.enabled())throw p.fail('QUALITY_AUDIT_DISABLED',503);
    const db=await pool.getConnection();
    try{
      await schema.assertReady(db);await db.beginTransaction();
      const subject=sessionSubject(session);let a;
      if(subject.kind==='system_admin'){
        const system=require('./systemAdminIdentity'),user=await system.getSystemAdmin(db,subject.principal,{locked:true});
        const {sameIdentityInteger}=require('./sessionSubject');
        if(!user||user.must_change_password||!sameIdentityInteger(user.authVersion,subject.authVersion))throw p.fail('QUALITY_AUDIT_FORBIDDEN',403);
        const {permSet}=await system.permissions(db,subject.principal);
        a={valid:true,user,permissions:permSet,roleCodes:new Set(['admin']),readOnly:true};
      }else a=await readPersonAuthority(db,session,subject.personId,{currentRead:true});
      if(!a.valid)throw p.fail('QUALITY_AUDIT_FORBIDDEN',403);
      const scope=p.scope(a);if(write&&a.readOnly)throw p.fail('QUALITY_AUDIT_FORBIDDEN',403);
      const result=await fn(db,a,scope);await db.commit();return result;
    }catch(error){await db.rollback().catch(()=>{});throw error;}finally{db.release();}
  }
  function visible(scope,row){if(!row||scope.departmentId&&String(row.responsible_department_id)!==scope.departmentId)throw p.fail('QUALITY_AUDIT_NOT_FOUND',404);}
  async function load(db,findingId,scope,lock=false,fullHistory=true){
    const row=await one(db,'SELECT *,CAST(responsible_department_id AS CHAR) responsible_department_id,CAST(created_by_person_id AS CHAR) created_by_person_id FROM data_quality_audit_findings WHERE finding_id=?'+(lock?' FOR UPDATE':''),[p.uuid(findingId)]);
    visible(scope,row);const f=parse(row.snapshot_json);
    if(digest(f)!==row.snapshot_digest||f.finding_id!==row.finding_id||f.revision_no!==row.revision_no||f.state!==row.state||String(f.responsible_department_id)!==row.responsible_department_id||String(f.created_by.person_id)!==row.created_by_person_id)throw p.fail('QUALITY_AUDIT_HISTORY_INVALID',503);
    // Verify the whole immutable chain in bounded reads, including old snapshots.
    let before=row.revision_no+1,expected=row.last_event_digest,revision=row.revision_no;
    while(revision>0){
      const [events]=await db.execute('SELECT *,CAST(actor_person_id AS CHAR) actor_person_id FROM data_quality_audit_events WHERE finding_id=? AND revision_no<? ORDER BY revision_no DESC LIMIT '+(fullHistory?'250':'1'),[row.finding_id,before]);
      if(!events.length)throw p.fail('QUALITY_AUDIT_HISTORY_INVALID',503);
      for(const event of events){
        const value=parse(event.snapshot_json);
        if(event.revision_no!==revision||event.snapshot_digest!==expected||digest(value)!==event.snapshot_digest||value.finding_id!==undefined||value.finding?.finding_id!==row.finding_id||value.revision_no!==revision||value.finding.revision_no!==revision||value.action!==event.action||String(value.actor_snapshot.person_id)!==String(event.actor_person_id)||value.previous_event_digest!==event.previous_event_digest)throw p.fail('QUALITY_AUDIT_HISTORY_INVALID',503);
        if(revision===row.revision_no&&digest(value.finding)!==row.snapshot_digest)throw p.fail('QUALITY_AUDIT_HISTORY_INVALID',503);
        expected=event.previous_event_digest;revision--;before=event.revision_no;
      }
      if(!fullHistory)return f;
    }
    if(expected!==null)throw p.fail('QUALITY_AUDIT_HISTORY_INVALID',503);
    return f;
  }
  function replayAllowed(a,f,action){return action==='submit_rectification'?p.contact(a,f):p.auditor(a);}
  async function previous(db,a,scope,requestId,requestDigest){
    const row=await one(db,'SELECT *,CAST(actor_person_id AS CHAR) actor_person_id FROM data_quality_audit_requests WHERE request_id=? FOR UPDATE',[requestId]);
    if(!row)return null;
    if(row.actor_person_id!==String(a.user.personId)||row.request_digest!==requestDigest||!row.response_json)throw p.fail('QUALITY_AUDIT_REQUEST_CONFLICT');
    const f=await load(db,row.finding_id,scope),saved=parse(row.response_json);
    if(!replayAllowed(a,f,saved._action))throw p.fail('QUALITY_AUDIT_FORBIDDEN',403);
    return publicReceipt(row);
  }
  async function save(db,a,f,action,previousDigest=null){
    const event={event_id:crypto.randomUUID(),revision_no:f.revision_no,action,actor_snapshot:person(a),created_at:f.updated_at,finding:f,previous_event_digest:previousDigest};
    const eventDigest=digest(event),snapshotDigest=digest(f);
    if(f.revision_no===1)await db.execute('INSERT INTO data_quality_audit_findings (finding_id,revision_no,state,responsible_department_id,created_by_person_id,snapshot_json,snapshot_digest,last_event_digest,created_at,updated_at) VALUES (?,?,?,CAST(? AS SIGNED),CAST(? AS SIGNED),?,?,?,FROM_UNIXTIME(?),FROM_UNIXTIME(?))',[f.finding_id,1,f.state,f.responsible_department_id,f.created_by.person_id,json(f),snapshotDigest,eventDigest,Date.parse(f.created_at)/1000,Date.parse(f.updated_at)/1000]);
    else{
      const [result]=await db.execute('UPDATE data_quality_audit_findings SET revision_no=?,state=?,snapshot_json=?,snapshot_digest=?,last_event_digest=?,updated_at=FROM_UNIXTIME(?) WHERE finding_id=? AND revision_no=?',[f.revision_no,f.state,json(f),snapshotDigest,eventDigest,Date.parse(f.updated_at)/1000,f.finding_id,f.revision_no-1]);
      if(result.affectedRows!==1)throw p.fail('QUALITY_AUDIT_REVISION_CONFLICT');
    }
    await db.execute('INSERT INTO data_quality_audit_events(event_id,finding_id,revision_no,action,actor_person_id,snapshot_json,snapshot_digest,previous_event_digest,created_at) VALUES (?,?,?,?,CAST(? AS SIGNED),?,?,?,FROM_UNIXTIME(?))',[event.event_id,f.finding_id,f.revision_no,action,String(a.user.personId),json(event),eventDigest,previousDigest,Date.parse(f.updated_at)/1000]);
    return {ok:true,finding_id:f.finding_id,revision_no:f.revision_no,state:f.state};
  }
  async function write(session,findingId,body,action,execute){
    const requestId=p.uuid(body.request_id),requestDigest=digest({finding_id:findingId,body});
    const run=()=>transaction(session,async(db,a,scope)=>{
      const replay=await previous(db,a,scope,requestId,requestDigest);if(replay)return replay;
      const targetId=findingId||crypto.randomUUID();
      await db.execute('INSERT INTO data_quality_audit_requests(request_id,actor_person_id,finding_id,request_digest) VALUES (?,CAST(? AS SIGNED),?,?)',[requestId,String(a.user.personId),targetId,requestDigest]);
      const result=await execute(db,a,scope,targetId);
      await db.execute('UPDATE data_quality_audit_requests SET response_json=? WHERE request_id=?',[json({...result,_action:action}),requestId]);return result;
    },{write:true});
    try{return await run();}catch(error){
      if(error.code==='ER_LOCK_DEADLOCK')return run();
      // A concurrent identical request commits once; the unique request row is
      // the serialization point. A failed transaction never leaves a receipt.
      if(error.code!=='ER_DUP_ENTRY')throw error;
      return transaction(session,async(db,a,scope)=>{const result=await previous(db,a,scope,requestId,requestDigest);if(!result)throw p.fail('QUALITY_AUDIT_REQUEST_CONFLICT');return result;},{write:true});
    }
  }
  return {
    async status(session){if(!schema.enabled())return {enabled:false,can_read:false,can_register:false,read_only:true};return transaction(session,async(db,a)=>({enabled:true,can_read:true,can_register:p.auditor(a),read_only:a.readOnly}));},
    options(session){return transaction(session,async(db,a)=>{
      if(!p.auditor(a))return {departments:[],designs:[]};
      const [departments]=await db.execute("SELECT CAST(id AS CHAR) id,name FROM departments WHERE status='active' ORDER BY sort_order,name,id");
      const [candidates]=await db.execute("SELECT CAST(id AS CHAR) id FROM process_design_drafts WHERE status IN ('approved','published') ORDER BY id DESC LIMIT 201");
      const designs=[];for(const row of candidates.slice(0,200)){const result=await inspectDesign(db,row.id,{lock:true});if(result.valid)designs.push(result.design);}
      return {departments,designs,truncated:candidates.length>200};
    });},
    list(session,query={}){return transaction(session,async(db,a,scope)=>{
      if(query.view&&!['open','all'].includes(query.view))throw p.fail('QUALITY_AUDIT_INPUT_INVALID',400);
      const where=scope.departmentId?'responsible_department_id=?':'1=1',args=scope.departmentId?[scope.departmentId]:[];
      const [counts]=await db.execute('SELECT state,COUNT(*) total FROM data_quality_audit_findings WHERE '+where+' GROUP BY state',args);
      const [rows]=await db.execute('SELECT finding_id FROM data_quality_audit_findings WHERE '+where+(query.view==='all'?'':" AND state<>'closed'")+' ORDER BY updated_at DESC,finding_id LIMIT 201',args);
      const items=[];for(const row of rows.slice(0,200))items.push(await load(db,row.finding_id,scope,false,false));
      const totals=Object.fromEntries(counts.map(row=>[row.state,Number(row.total)]));
      return {items,truncated:rows.length>200,summary:{open:(totals.awaiting_rectification||0)+(totals.awaiting_review||0),awaiting_review:totals.awaiting_review||0,closed:totals.closed||0}};
    });},
    workbench(session){return transaction(session,async(db,a,scope)=>{
      const where=scope.departmentId?'responsible_department_id=?':'1=1',args=scope.departmentId?[scope.departmentId]:[];
      const [rows]=await db.execute("SELECT finding_id FROM data_quality_audit_findings WHERE "+where+" AND state<>'closed' ORDER BY updated_at DESC,finding_id LIMIT 201",args);
      const items=[],gates=new Map();
      for(const row of rows.slice(0,200)){
        const finding=await load(db,row.finding_id,scope,false,false),key=digest(finding.design);
        if(!gates.has(key))gates.set(key,await inspectDesign(db,finding.design.draft_id,{lock:true,bound:finding.design}));
        const gate=gates.get(key);items.push({finding,allowed_actions:p.actions(a,finding,gate.valid),design_gate:{valid:gate.valid}});
      }
      return {items,truncated:rows.length>200};
    });},
    detail(session,findingId,query={}){return transaction(session,async(db,a,scope)=>{
      const f=await load(db,findingId,scope),gate=await inspectDesign(db,f.design.draft_id,{lock:true,bound:f.design});
      const before=query.history_before===undefined?f.revision_no+1:Number(query.history_before);
      if(!Number.isSafeInteger(before)||before<1||before>f.revision_no+1)throw p.fail('QUALITY_AUDIT_INPUT_INVALID',400);
      const [events]=await db.execute('SELECT snapshot_json FROM data_quality_audit_events WHERE finding_id=? AND revision_no<? ORDER BY revision_no DESC LIMIT 51',[f.finding_id,before]);
      const values=events.slice(0,50).map(row=>parse(row.snapshot_json));
      return {finding:f,events:values,history_truncated:events.length>50,history_next_before:events.length>50?values.at(-1).revision_no:null,allowed_actions:p.actions(a,f,gate.valid),design_gate:{valid:gate.valid,message:gate.valid?'当前流程设计已由部门负责人本人同意':p.fail(gate.code).message}};
    });},
    create(session,body){
      p.exact(body,['request_id','title','subject','finding_text','basis_text','requirement_text','responsible_department_id','design_id']);
      const input={title:p.text(body.title,200),subject:p.text(body.subject,1000),finding_text:p.text(body.finding_text),basis_text:p.text(body.basis_text),requirement_text:p.text(body.requirement_text),responsible_department_id:p.id(body.responsible_department_id)};
      p.id(body.design_id);
      return write(session,null,body,'register',async(db,a,scope,findingId)=>{
        if(!p.auditor(a))throw p.fail('QUALITY_AUDIT_FORBIDDEN',403);
        const design=assertDesign(await inspectDesign(db,body.design_id,{lock:true}));
        const department=await one(db,"SELECT CAST(id AS CHAR) id,name FROM departments WHERE id=? AND status='active' FOR SHARE",[input.responsible_department_id]);if(!department)throw p.fail('QUALITY_AUDIT_INPUT_INVALID',400);
        const now=new Date().toISOString(),f={finding_id:findingId,revision_no:1,state:'awaiting_rectification',...input,department_snapshot:department,design,created_by:person(a),latest_rectification:null,latest_review:null,created_at:now,updated_at:now};
        return save(db,a,f,'register');
      });
    },
    act(session,findingId,body){
      p.uuid(findingId);const fields={submit_rectification:['action_text','evidence_text'],review:['decision','basis_text'],revise_design_basis:['design_id','finding_text','basis_text','requirement_text','reason']}[body?.action];
      if(!fields)throw p.fail('QUALITY_AUDIT_INPUT_INVALID',400);
      p.exact(body,['request_id','expected_revision','action',...fields]);
      if(!Number.isSafeInteger(body.expected_revision)||body.expected_revision<1)throw p.fail('QUALITY_AUDIT_INPUT_INVALID',400);
      for(const key of fields)if(key==='design_id')p.id(body[key]);else p.text(body[key]);
      if(body.action==='review'&&!['accept','return'].includes(body.decision))throw p.fail('QUALITY_AUDIT_INPUT_INVALID',400);
      return write(session,findingId,body,body.action,async(db,a,scope)=>{
        const f=await load(db,findingId,scope,true);
        if(f.revision_no!==body.expected_revision)throw p.fail('QUALITY_AUDIT_REVISION_CONFLICT');
        if(f.state==='closed')throw p.fail('QUALITY_AUDIT_STATE_CONFLICT');
        const gate=await inspectDesign(db,f.design.draft_id,{lock:true,bound:f.design});
        if(!replayAllowed(a,f,body.action))throw p.fail('QUALITY_AUDIT_FORBIDDEN',403);
        const now=new Date().toISOString();
        if(body.action==='revise_design_basis'){
          const design=assertDesign(await inspectDesign(db,body.design_id,{lock:true}));
          if(String(design.document_id)!==String(f.design.document_id))throw p.fail('QUALITY_AUDIT_INPUT_INVALID',400);
          f.design=design;for(const key of ['finding_text','basis_text','requirement_text'])f[key]=p.text(body[key]);
          f.design_revision_reason=p.text(body.reason);f.latest_rectification=null;f.latest_review=null;f.state='awaiting_rectification';
        }else{
          assertDesign(gate);
          if(body.action==='submit_rectification'){
            if(f.state!=='awaiting_rectification')throw p.fail('QUALITY_AUDIT_STATE_CONFLICT');
            f.latest_rectification={action_text:p.text(body.action_text),evidence_text:p.text(body.evidence_text),submitted_by:person(a),submitted_at:now,design_digest:digest(f.design)};f.state='awaiting_review';
          }else{
            if(f.state!=='awaiting_review'||!f.latest_rectification||f.latest_rectification.design_digest!==digest(f.design))throw p.fail('QUALITY_AUDIT_STATE_CONFLICT');
            f.latest_review={decision:body.decision,basis_text:p.text(body.basis_text),reviewed_by:person(a),reviewed_at:now};f.state=body.decision==='accept'?'closed':'awaiting_rectification';
          }
        }
        const header=await one(db,'SELECT last_event_digest FROM data_quality_audit_findings WHERE finding_id=?',[findingId]);
        f.revision_no++;f.updated_at=now;return save(db,a,f,body.action,header.last_event_digest);
      });
    },
    receipt(session,requestId){p.uuid(requestId);return transaction(session,async(db,a,scope)=>{
      const row=await one(db,'SELECT *,CAST(actor_person_id AS CHAR) actor_person_id FROM data_quality_audit_requests WHERE request_id=?',[requestId]);
      if(!row||row.actor_person_id!==String(a.user.personId)||!row.response_json)throw p.fail('QUALITY_AUDIT_NOT_FOUND',404);
      const f=await load(db,row.finding_id,scope);if(!replayAllowed(a,f,parse(row.response_json)._action))throw p.fail('QUALITY_AUDIT_FORBIDDEN',403);
      return {found:true,result:publicReceipt(row)};
    });}
  };
}
module.exports={makeQualityAuditRepository};
