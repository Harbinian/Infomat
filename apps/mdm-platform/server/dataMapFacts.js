// Version-bound directed facts. Business answers and MDM checks never confer
// formal master-data authority; no office assignment or notification side effect.
const {failure,id,parse,json,digest,lastId}=require('./dataMapDefinitionValues');
const {MIGRATION_KEY}=require('./dataMapFactSchema');
const {schema}=require('./dataMapManagement');
const text=(v,max=4096)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw failure('DEFINITION_FACT_TEXT_REQUIRED');return v.trim();};
const keys=(v,allowed)=>{if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).some(k=>!allowed.includes(k)))throw failure('DEFINITION_PROPERTY_NOT_ALLOWED');};
const refs=v=>{if(!Array.isArray(v)||v.length>16)throw failure('DEFINITION_FACT_EVIDENCE_INVALID');return v.map(x=>text(x));};
const at=(o,p)=>p.split('.').reduce((v,k)=>v?.[k],o)??null;
const formal={status:'pending',decision:null,basis:null,reason:'新对象或字段正式认定的有权主体及审批依据待确认。'};
const select=`SELECT *,CAST(fact_id AS CHAR) fact_id,CAST(subject_version_id AS CHAR) subject_version_id,CAST(object_version_id AS CHAR) object_version_id,
  CAST(scope_department_id AS CHAR) scope_department_id,CAST(target_department_id AS CHAR) target_department_id,CAST(target_person_id AS CHAR) target_person_id,
  CAST(created_by_person_id AS CHAR) created_by_person_id,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at,DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') updated_at FROM data_map_fact_requests`;
module.exports=function({transaction,actor,scope,entityScope,current,unchanged,version,request,event}){
  async function ready(db){if(!(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]))[0].length)throw failure('DEFINITION_FACT_MIGRATION_REQUIRED',503);}
  const tx=fn=>transaction(async db=>{await ready(db);return fn(db);});
  const mdm=who=>!who.readOnly&&who.permissions.has('governance:structure-gate');
  const responder=(who,r)=>!who.readOnly&&who.permissions.has('governance:draft-department')&&who.departmentId===r.target_department_id&&(!r.target_person_id||r.target_person_id===who.personId);
  async function target(db,dept,person,required=false){
    if(dept===null){if(required||person!==null)throw failure('DEFINITION_FACT_TARGET_REQUIRED');return;}
    id(dept);
    if(!(await db.execute("SELECT id FROM departments WHERE id=? AND status='active' FOR SHARE",[dept]))[0].length)throw failure('DEFINITION_FACT_TARGET_INVALID',409);
    if(person!==null&&!((await db.execute("SELECT person_id FROM person WHERE person_id=? AND current_department_id=? AND status='active' FOR SHARE",[id(person),dept]))[0].length))throw failure('DEFINITION_FACT_TARGET_INVALID',409);
  }
  async function source(db,subjectId,objectId,focus){
    const v=await version(db,subjectId,true),o=await version(db,objectId,true);
    if(o.entity_type!=='object'||(v.entity_type==='object'?v.version_id!==o.version_id:v.base_snapshot.row.object_id!==o.entity_id||!v.object_version_id))throw failure('DEFINITION_FIELD_OBJECT_MISMATCH',409);
    const specs=schema[v.entity_type];
    if(!Array.isArray(focus)||!focus.length||focus.length>8||new Set(focus).size!==focus.length||focus.some(p=>!specs.some(s=>s.path===p)))throw failure('DEFINITION_FACT_FOCUS_REQUIRED');
    focus=[...focus].sort();
    const values=Object.fromEntries(focus.map(p=>[p,at(v.definition,p)]));
    // Enumeration order is not factual meaning. Composite identifier order is
    // deliberately not normalized or exposed as a fact-editable projection.
    const semantic={...values};if(Array.isArray(semantic.enum_values))semantic.enum_values=[...semantic.enum_values].sort((a,b)=>json(a).localeCompare(json(b)));
    const context={subject_type:v.entity_type,subject_id:v.entity_id,subject_name:v.definition.name,object_id:o.entity_id,object_name:o.definition.name,values};
    return {context,focus,semantic_digest:digest({...context,values:semantic}),digest_algorithm:'sha256-fact-projection-v1',
      subject_revision:v.revision_no,object_revision:o.revision_no,
      source_refs:[...focus.map(p=>({version_id:v.version_id,content_digest:v.content_digest,digest_algorithm:v.digest_algorithm,pointer:'/'+p.replaceAll('.','/')})),{version_id:o.version_id,content_digest:o.content_digest,digest_algorithm:o.digest_algorithm,pointer:'/name'}]};
  }
  async function latest(db,r){
    const v=await version(db,r.subject_version_id),o=await version(db,r.object_version_id);
    const scoped=await entityScope(db,v.entity_type,v.entity_id,true),parent=await entityScope(db,'object',o.entity_id,true);
    if(scoped.departmentId!==r.scope_department_id||parent.departmentId!==r.scope_department_id)throw failure('DEFINITION_FACT_SCOPE_CHANGED',409);
    const h=await current(db,v.entity_type,v.entity_id,true),p=v.entity_type==='object'?h:await current(db,'object',o.entity_id,true);
    unchanged(h,scoped.source);unchanged(p,parent.source);
    const binding=await source(db,h.version_id,p.version_id,r.data.binding.focus);
    const inactive=['inactive','archived'].includes(scoped.source.row.status)||['inactive','archived'].includes(parent.source.row.status);
    return {binding,subject_version_id:h.version_id,object_version_id:p.version_id,stale:inactive||binding.semantic_digest!==r.data.binding.semantic_digest,inactive};
  }
  function canRead(who,r){
    if(who.permissions.has('governance:read-global'))return true;
    if(mdm(who)&&who.permissions.has('governance:read-department')&&who.departmentId===r.scope_department_id)return true;
    return r.status!=='draft'&&responder(who,r);
  }
  async function load(db,who,factId){
    const [[r]]=await db.execute(select+' WHERE fact_id=? FOR UPDATE',[id(factId)]);
    if(!r||!canRead(who,r))throw failure('DEFINITION_FACT_NOT_FOUND',404);
    r.data=parse(r.data_json);delete r.data_json;
    const [[last]]=await db.execute('SELECT snapshot_digest FROM data_map_fact_events WHERE fact_id=? AND revision_no=?',[r.fact_id,r.revision_no]);
    if(!last||last.snapshot_digest!==digest(snapshot(r)))throw failure('DEFINITION_FACT_INTEGRITY_CONFLICT',409);
    return r;
  }
  function snapshot(r){return {subject_version_id:r.subject_version_id,object_version_id:r.object_version_id,scope_department_id:r.scope_department_id,target_department_id:r.target_department_id,target_person_id:r.target_person_id,status:r.status,revision_no:r.revision_no,data:r.data};}
  async function append(db,who,r,action){await db.execute('INSERT INTO data_map_fact_events(fact_id,revision_no,action,snapshot_json,snapshot_digest,actor_person_id,created_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))',[r.fact_id,r.revision_no,action,json(snapshot(r)),digest(snapshot(r)),who.personId]);}
  async function detail(db,who,r,before=null){
    const now=await latest(db,r);
    const [events]=await db.execute(`SELECT CAST(e.fact_event_id AS CHAR) event_id,e.revision_no,e.action,e.snapshot_json,e.snapshot_digest,CAST(e.actor_person_id AS CHAR) actor_person_id,p.person_name actor_name,DATE_FORMAT(e.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at FROM data_map_fact_events e LEFT JOIN person p ON p.person_id=e.actor_person_id WHERE e.fact_id=? ${before?'AND e.fact_event_id<?':''} ORDER BY e.fact_event_id DESC LIMIT 51`,[r.fact_id,...(before?[id(before)]:[])]);
    const history=events.slice(0,50).map(e=>{const s=parse(e.snapshot_json);if(e.snapshot_digest!==digest(s))throw failure('DEFINITION_FACT_INTEGRITY_CONFLICT',409);return {event_id:e.event_id,revision_no:e.revision_no,action:e.action,actor_person_id:e.actor_person_id,actor_name:e.actor_name,created_at:e.created_at,snapshot:s};});
    const [[department]]=await db.execute('SELECT name FROM departments WHERE id=?',[r.target_department_id]);
    const [[person]]=await db.execute('SELECT person_name name FROM person WHERE person_id=?',[r.target_person_id]);
    const manage=mdm(who);if(manage)scope(who,r.scope_department_id);
    // Recipients see the assigned fixed projection and its history only, never
    // newly edited source values until an explicit MDM rebind issues them.
    const visibleHistory=who.permissions.has('governance:read-global')||manage?history:history.filter(e=>e.snapshot.status!=='draft'&&responder(who,e.snapshot));
    return {...r,target_department_name:department?.name||null,target_person_name:person?.name||null,history:visibleHistory,history_next:events.length>50?events[49].event_id:null,stale:now.stale,inactive:now.inactive,
      latest:manage?now:null,can_manage:manage,can_answer:responder(who,r),can_edit_source:!who.readOnly&&who.permissions.has('governance:draft-department')&&who.departmentId===r.scope_department_id,formal_governance:formal};
  }
  async function write(db,who,r,action){
    r.revision_no++;
    await db.execute('UPDATE data_map_fact_requests SET subject_version_id=?,object_version_id=?,target_department_id=?,target_person_id=?,status=?,revision_no=?,data_json=?,updated_at=UTC_TIMESTAMP(3) WHERE fact_id=?',[r.subject_version_id,r.object_version_id,r.target_department_id,r.target_person_id,r.status,r.revision_no,json(r.data),r.fact_id]);
    await append(db,who,r,action);return {fact_id:r.fact_id,revision_no:r.revision_no,status:r.status};
  }
  return {
    factCapabilities(session){return tx(async db=>{const who=await actor(db,session);return {person_id:who.personId,department_id:who.departmentId,can_manage:mdm(who),can_answer:!who.readOnly&&who.permissions.has('governance:draft-department'),schema,formal_governance:formal};});},
    factTargets(session,{department_id=null,after=null}={}){return tx(async db=>{
      await actor(db,session,'governance:structure-gate');
      const [items]=department_id?await db.execute(`SELECT CAST(person_id AS CHAR) id,person_name name FROM person WHERE status='active' AND current_department_id=? ${after?'AND person_id>?':''} ORDER BY person_id LIMIT 101`,[id(department_id),...(after?[id(after)]:[])]):await db.execute(`SELECT CAST(id AS CHAR) id,name FROM departments WHERE status='active' ${after?'AND id>?':''} ORDER BY id LIMIT 101`,after?[id(after)]:[]);
      return {items:items.slice(0,100),next:items.length>100?items[99].id:null};
    });},
    listFacts(session,{after=null}={}){return tx(async db=>{
      const who=await actor(db,session),args=[],conditions=[];
      if(!who.permissions.has('governance:read-global')){
        const clauses=[];
        if(mdm(who)&&who.permissions.has('governance:read-department')){clauses.push('scope_department_id=?');args.push(who.departmentId);}
        if(!who.readOnly&&who.permissions.has('governance:draft-department')){clauses.push("(status<>'draft' AND target_department_id=? AND (target_person_id IS NULL OR target_person_id=?))");args.push(who.departmentId,who.personId);}
        conditions.push('('+(clauses.join(' OR ')||'1=0')+')');
      }
      if(after){conditions.push('fact_id>?');args.push(id(after));}
      const [rows]=await db.execute(select+(conditions.length?' WHERE '+conditions.join(' AND '):'')+' ORDER BY fact_id LIMIT 101',args);
      return {items:rows.slice(0,100).map(r=>({fact_id:r.fact_id,status:r.status,revision_no:r.revision_no,question:parse(r.data_json).question})),next:rows.length>100?rows[99].fact_id:null};
    });},
    getFact(session,factId,options={}){return tx(async db=>{const who=await actor(db,session);return detail(db,who,await load(db,who,factId),options.before);});},
    createFact(session,payload){return tx(async db=>{
      keys(payload,['request_id','subject_version_id','object_version_id','focus','question','target_department_id','target_person_id']);
      const who=await actor(db,session,'governance:structure-gate');
      return request(db,who,'create_fact',payload,async()=>{
        const v=await version(db,payload.subject_version_id),scoped=await entityScope(db,v.entity_type,v.entity_id,true);scope(who,scoped.departmentId);
        const r={subject_version_id:id(payload.subject_version_id),object_version_id:id(payload.object_version_id),scope_department_id:scoped.departmentId,
          target_department_id:payload.target_department_id===null?null:id(payload.target_department_id),target_person_id:payload.target_person_id===null?null:id(payload.target_person_id),status:'draft',revision_no:1};
        await target(db,r.target_department_id,r.target_person_id);
        r.data={question:text(payload.question),binding:await source(db,r.subject_version_id,r.object_version_id,payload.focus),answer:null,review:null};
        const now=await latest(db,r);if(now.subject_version_id!==r.subject_version_id||now.object_version_id!==r.object_version_id||now.inactive)throw failure('DEFINITION_FACT_SOURCE_CHANGED',409);
        await db.execute("INSERT INTO data_map_fact_requests(subject_version_id,object_version_id,scope_department_id,target_department_id,target_person_id,status,revision_no,data_json,created_by_person_id,created_at,updated_at) VALUES (?,?,?,?,?,'draft',1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[r.subject_version_id,r.object_version_id,r.scope_department_id,r.target_department_id,r.target_person_id,json(r.data),who.personId]);
        r.fact_id=await lastId(db);await append(db,who,r,'create');return {fact_id:r.fact_id,revision_no:1,status:'draft'};
      });
    });},
    actOnFact(session,factId,action,payload){return tx(async db=>{
      const allowed={edit:['question','target_department_id','target_person_id'],send:[],answer:['answer','evidence_refs','needs_more_info','missing_reason'],more_info:['reason'],rebind:['subject_version_id','object_version_id','reason'],check:['reason','evidence_refs']};
      if(!Object.hasOwn(allowed,action))throw failure('DEFINITION_FORMAL_DECISION_NOT_ENABLED',403);
      keys(payload,['request_id','expected_revision',...allowed[action]]);
      const who=await actor(db,session,action==='answer'?'governance:draft-department':'governance:structure-gate');
      // Authorize the current assignment even when returning a prior receipt.
      const r=await load(db,who,factId);
      if(action==='answer'){if(!responder(who,r))throw failure('DEFINITION_ACCESS_DENIED',403);}else scope(who,r.scope_department_id);
      await target(db,r.target_department_id,r.target_person_id,!['edit','rebind'].includes(action));
      return request(db,who,'fact_'+action,{...payload,fact_id:r.fact_id},async()=>{
        if(payload.expected_revision!==r.revision_no)throw failure('DEFINITION_FACT_REVISION_CONFLICT',409);
        const now=await latest(db,r);
        if(action!=='rebind'&&(now.stale||now.inactive))throw failure('DEFINITION_FACT_SOURCE_CHANGED',409);
        const states={edit:['draft'],send:['draft'],answer:['requested','needs_more_info'],more_info:['answered'],rebind:['draft','requested','answered','needs_more_info','checked'],check:['answered']};
        if(!states[action].includes(r.status))throw failure('DEFINITION_FACT_STATE_CONFLICT',409);
        if(action==='edit'){
          r.data.question=text(payload.question);r.target_department_id=payload.target_department_id===null?null:id(payload.target_department_id);r.target_person_id=payload.target_person_id===null?null:id(payload.target_person_id);await target(db,r.target_department_id,r.target_person_id);
        }else if(action==='send'){r.status='requested';
        }else if(action==='answer'){
          if(typeof payload.needs_more_info!=='boolean')throw failure('DEFINITION_FACT_EVIDENCE_INVALID');
          const evidence=refs(payload.evidence_refs);
          if(!evidence.length&&!payload.needs_more_info)throw failure('DEFINITION_FACT_EVIDENCE_REQUIRED');
          r.data.answer={text:text(payload.answer),evidence_refs:evidence,needs_more_info:payload.needs_more_info,missing_reason:payload.needs_more_info?text(payload.missing_reason):null,actor_person_id:who.personId,
            subject_version_id:r.subject_version_id,object_version_id:r.object_version_id,semantic_digest:r.data.binding.semantic_digest};
          r.status='answered';r.data.review=null;
        }else if(action==='more_info'){
          r.data.review={reason:text(payload.reason),actor_person_id:who.personId,decision:'needs_more_info'};r.status='needs_more_info';
        }else if(action==='rebind'){
          if(now.inactive||!now.stale||id(payload.subject_version_id)!==now.subject_version_id||id(payload.object_version_id)!==now.object_version_id)throw failure('DEFINITION_FACT_SOURCE_CHANGED',409);
          r.data.rebind_reason=text(payload.reason);r.subject_version_id=now.subject_version_id;r.object_version_id=now.object_version_id;r.data.binding=now.binding;r.data.answer=null;r.data.review=null;r.status=r.status==='draft'?'draft':'requested';
        }else if(action==='check'){
          if(!r.data.answer||r.data.answer.needs_more_info||!r.data.answer.evidence_refs.length)throw failure('DEFINITION_FACT_EVIDENCE_REQUIRED');
          const evidence=refs(payload.evidence_refs);if(!evidence.length)throw failure('DEFINITION_FACT_EVIDENCE_REQUIRED');
          r.data.review={reason:text(payload.reason),evidence_refs:evidence,decision:'fact_checked',actor_person_id:who.personId,checked_subject_version_id:now.subject_version_id,checked_object_version_id:now.object_version_id,semantic_digest:now.binding.semantic_digest};
          r.status='checked';
          r.data.review.definition_event_id=await event(db,now.subject_version_id,'fact_checked',{fact_id:r.fact_id,request_revision:r.revision_no+1,...r.data.review},who.personId);
        }
        return write(db,who,r,action);
      });
    });}
  };
};
