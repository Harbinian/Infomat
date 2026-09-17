// Design evidence only: no process, workflow, approval, notification or system-sync writes.
const {failure,id,parse,json,digest,lastId}=require('./dataMapDefinitionValues');
const {MIGRATION_KEY}=require('./designHandoffSchema');
const dimensions=['field','format','enum','unit','version'];
const operations=['produce','use','modify','deliver','receive'];
const keys=(v,allowed)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw failure('DEFINITION_PROPERTY_NOT_ALLOWED');};
const text=(v,max=4096,nullable=false)=>{if(nullable&&(v===null||v===''))return null;if(typeof v!=='string'||!v.trim()||v.length>max)throw failure('DEFINITION_HANDOFF_TEXT_REQUIRED');return v.trim();};
const list=(v,max)=>{if(!Array.isArray(v)||v.length>max)throw failure('DEFINITION_HANDOFF_LIST_INVALID');return v;};
const select=`SELECT CAST(h.handoff_id AS CHAR) handoff_id,CAST(v.handoff_version_id AS CHAR) handoff_version_id,
  v.revision_no,v.claim_status,v.snapshot_json,v.snapshot_digest,CAST(v.actor_person_id AS CHAR) actor_person_id,
  p.person_name actor_name,DATE_FORMAT(v.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at
  FROM data_map_design_handoffs h JOIN data_map_design_handoff_versions v ON v.handoff_id=h.handoff_id
  LEFT JOIN person p ON p.person_id=v.actor_person_id`;
module.exports=function({transaction,actor,scope,entityScope,version,request,loadSource,target,unpack,mappingSelect,bindings}){
  const tx=fn=>transaction(async db=>{if(!(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]))[0].length)throw failure('DEFINITION_HANDOFF_MIGRATION_REQUIRED',503);return fn(db);});
  const writable=w=>!w.readOnly&&w.permissions.has('governance:structure-gate');
  async function mapping(db,who,vid,cache){
    vid=id(vid);if(cache.has(vid))return cache.get(vid);
    const [[row]]=await db.execute(mappingSelect+' WHERE v.mapping_version_id=?',[vid]);
    if(!row)throw failure('DEFINITION_HANDOFF_MAPPING_NOT_FOUND',404);
    const m=unpack(row),s=await loadSource(db,who,m.source_id),t=await target(db,who,m.object_version_id,m.field_version_id);
    if(m.source_digest!==s.content_digest)throw failure('DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT',409);
    const [[head]]=await db.execute('SELECT revision_no FROM data_map_v7_mappings WHERE mapping_id=? FOR SHARE',[m.mapping_id]);
    const live=await bindings(db,who,s),effective=live.find(x=>x.mapping_version_id===vid)?.effective_confirmed===true;
    const changed=[];for(const v of [t.o,t.f].filter(Boolean)){
      const [[h]]=await db.execute('SELECT CAST(current_version_id AS CHAR) version_id FROM data_map_definition_heads WHERE entity_type=? AND entity_id=? FOR SHARE',[v.entity_type,v.entity_id]);
      if(!h||h.version_id!==v.version_id)changed.push({entity_type:v.entity_type,entity_id:v.entity_id,fixed_version_id:v.version_id,current_version_id:h?.version_id||null});
    }
    const result={m,s,...t,effective,remapped:head.revision_no!==m.revision_no,changed};cache.set(vid,result);return result;
  }
  async function resolve(db,who,body){
    keys(body,['title','claim_status','source','target','identifier_kind','identity_rule','identity_basis','delivery_condition','reception_requirement','evidence','pairs']);
    if(!['material_declared','human_confirmed','analysis_pending'].includes(body.claim_status)||!['unknown','single','composite'].includes(body.identifier_kind))throw failure('DEFINITION_HANDOFF_STATE_INVALID');
    const issues=[],refs=[],cache=new Map(),changed=[];
    const issue=(code,location,message)=>issues.push({code,location,message});
    async function readMapping(vid,side){const r=await mapping(db,who,vid,cache);refs.push({side,mapping_version_id:r.m.mapping_version_id});
      if(!r.effective)issue('MAPPING_UNCONFIRMED',side,'映射未确认或来源、父映射已变化，请重新核对。');
      if(r.remapped)issue('MAPPING_REVISED',side,'此关系保留旧映射修订，当前映射已变化。');
      changed.push(...r.changed);return r;}
    async function endpoint(input,side){
      if(input===null){issue('ENDPOINT_MISSING',side,'交接一端的固定来源与映射缺失。');return null;}
      keys(input,['mapping_version_id','behavior_ref','operations']);
      const r=await readMapping(input.mapping_version_id,side);if(r.f)throw failure('DEFINITION_HANDOFF_OBJECT_MAPPING_REQUIRED');
      const behavior=r.s.document.behaviors.find(b=>b.behavior_ref===input.behavior_ref);if(!behavior)throw failure('DEFINITION_HANDOFF_BEHAVIOR_INVALID');
      const ops=list(input.operations,5);if(!ops.length||new Set(ops).size!==ops.length||ops.some(o=>!operations.includes(o)))throw failure('DEFINITION_HANDOFF_OPERATION_INVALID');
      return {mapping_version_id:r.m.mapping_version_id,source_id:r.s.source_id,source_kind:r.s.source_kind,source_ref:r.s.source_ref,source_digest:r.s.content_digest,
        process_ref:r.s.document.process.process_ref,process_name:r.s.document.process.process_name,behavior_ref:behavior.behavior_ref,behavior_name:behavior.behavior_name,
        actor_description:behavior.current_actor_role,operations:ops,object_id:r.o.entity_id,object_version_id:r.o.version_id,object_name:r.o.definition.name};
    }
    const source=await endpoint(body.source,'source'),targetEnd=await endpoint(body.target,'target');
    if(!source&&!targetEnd)throw failure('DEFINITION_HANDOFF_ENDPOINT_REQUIRED');
    if(source&&targetEnd&&source.source_id===targetEnd.source_id&&source.behavior_ref===targetEnd.behavior_ref)issue('SAME_POSITION','target','两端是同一流程行为，尚未形成相邻交接位置。');
    const identityRule=text(body.identity_rule,4096,true),identityBasis=text(body.identity_basis,4096,true);
    if(!identityRule||!identityBasis)issue('IDENTITY_BASIS_MISSING','identity','如何识别同一业务对象尚缺对应规则或依据。');
    if(source&&targetEnd&&source.object_id!==targetEnd.object_id&&(!identityRule||!identityBasis))issue('OBJECT_IDENTITY_MISMATCH','identity','两端平台对象身份不同；名称相同也不能自动连接。');
    const delivery=text(body.delivery_condition,4096,true),reception=text(body.reception_requirement,4096,true);
    if(!delivery)issue('DELIVERY_MISSING','source','交付条件待补充。');if(!reception)issue('RECEPTION_MISSING','target','接收要求待补充。');
    const evidence=list(body.evidence,32).map(e=>{keys(e,['side','locator','note']);if(!['source','target'].includes(e.side)||!(e.side==='source'?source:targetEnd))throw failure('DEFINITION_HANDOFF_EVIDENCE_INVALID');return {side:e.side,locator:text(e.locator,1024),note:text(e.note)};});
    for(const side of ['source','target'])if(!evidence.some(e=>e.side===side))issue('EVIDENCE_MISSING',side,'此端尚缺来源证据定位和说明。');
    const pairKeys=new Set(),pairs=[];
    for(const [index,p] of list(body.pairs,32).entries()){
      keys(p,['source_mapping_version_id','target_mapping_version_id','identifier','checks']);if(typeof p.identifier!=='boolean')throw failure('DEFINITION_HANDOFF_IDENTIFIER_INVALID');
      if(!source||!targetEnd)throw failure('DEFINITION_HANDOFF_PAIR_ENDPOINT_REQUIRED');
      const a=await readMapping(p.source_mapping_version_id,'source'),b=await readMapping(p.target_mapping_version_id,'target');
      for(const [r,end] of [[a,source],[b,targetEnd]])if(!r.f||r.m.source_id!==end.source_id||r.m.local_object_ref!==cache.get(end.mapping_version_id).m.local_object_ref||r.m.parent_mapping_version_id!==end.mapping_version_id||r.o.version_id!==end.object_version_id)throw failure('DEFINITION_HANDOFF_FIELD_ENDPOINT_MISMATCH',409);
      const key=a.m.mapping_version_id+':'+b.m.mapping_version_id;if(pairKeys.has(key))throw failure('DEFINITION_HANDOFF_PAIR_DUPLICATE');pairKeys.add(key);
      const checks={};keys(p.checks,dimensions);
      for(const dim of dimensions){const c=p.checks[dim];keys(c,['mode','rule','basis']);if(!['same','convert','pending'].includes(c.mode))throw failure('DEFINITION_HANDOFF_CONVERSION_INVALID');
        checks[dim]={mode:c.mode,rule:text(c.rule,4096,true),basis:text(c.basis,4096,true)};
        if(c.mode==='pending'||!checks[dim].basis||c.mode==='convert'&&!checks[dim].rule)issue('CONVERSION_UNVERIFIED',`pairs.${index}.${dim}`,'字段、格式、枚举、单位或版本对应尚缺明确核对依据。');
      }
      const different={format:json([a.f.definition.data_type,a.f.definition.data_format,a.f.definition.length_precision])!==json([b.f.definition.data_type,b.f.definition.data_format,b.f.definition.length_precision]),
        enum:json(a.f.definition.enum_values)!==json(b.f.definition.enum_values),version:a.f.entity_id===b.f.entity_id&&a.f.version_id!==b.f.version_id};
      for(const [dim,diff] of Object.entries(different))if(diff&&checks[dim].mode==='same')issue('CONVERSION_CONFLICT',`pairs.${index}.${dim}`,'两端固定定义存在差异，不能声明无需转换。');
      pairs.push({source_mapping_version_id:a.m.mapping_version_id,target_mapping_version_id:b.m.mapping_version_id,identifier:p.identifier,checks,
        source:{field_id:a.f.entity_id,field_version_id:a.f.version_id,name:a.f.definition.name,definition:a.f.definition},target:{field_id:b.f.entity_id,field_version_id:b.f.version_id,name:b.f.definition.name,definition:b.f.definition}});
    }
    if(!pairs.length)issue('FIELD_MAPPING_MISSING','pairs','两端需要交接的字段尚未明确。');
    if(targetEnd){
      const end=cache.get(targetEnd.mapping_version_id),local=end.s.document.data_objects.find(o=>o.data_ref===end.m.local_object_ref);
      const mapped=await bindings(db,who,end.s);
      for(const f of local.fields){
        const m=mapped.find(m=>m.local_object_ref===local.data_ref&&m.local_field_ref===f.field_ref&&m.parent_mapping_version_id===targetEnd.mapping_version_id);
        if(!m){issue('TARGET_FIELD_UNMAPPED','target:'+f.field_ref,'目标字段尚无对应的固定台账映射，接收字段完整性待核实。');continue;}
        const v=await version(db,m.field_version_id,true);
        if(v.definition.required===true&&!pairs.some(p=>p.target.field_version_id===v.version_id))issue('TARGET_REQUIRED_FIELD_MISSING','target:'+f.field_ref,'目标必填字段未纳入本次交接。');
      }
    }
    const identifiers=pairs.filter(p=>p.identifier);
    if(body.identifier_kind==='unknown'||body.identifier_kind==='single'&&identifiers.length!==1||body.identifier_kind==='composite'&&identifiers.length<2||new Set(identifiers.map(p=>p.source.field_id)).size!==identifiers.length||new Set(identifiers.map(p=>p.target.field_id)).size!==identifiers.length)issue('IDENTIFIER_INCOMPLETE','identity','唯一或组合标识的两端字段未完整对应。');
    for(const c of changed)issue('DEFINITION_VERSION_ADVANCED',`${c.entity_type}:${c.entity_id}`,`台账已修订，关系仍绑定固定版本 ${c.fixed_version_id}。`);
    const snapshot={title:text(body.title,255),claim_status:body.claim_status,source,target:targetEnd,identifier_kind:body.identifier_kind,identity_rule:identityRule,identity_basis:identityBasis,delivery_condition:delivery,reception_requirement:reception,evidence,pairs};
    return {snapshot,issues:issues.filter((x,i,arr)=>arr.findIndex(y=>y.code===x.code&&y.location===x.location)===i),refs:refs.filter((x,i,arr)=>arr.findIndex(y=>x.side===y.side&&x.mapping_version_id===y.mapping_version_id)===i)};
  }
  function input(s){return {...s,source:s.source?{mapping_version_id:s.source.mapping_version_id,behavior_ref:s.source.behavior_ref,operations:s.source.operations}:null,target:s.target?{mapping_version_id:s.target.mapping_version_id,behavior_ref:s.target.behavior_ref,operations:s.target.operations}:null,pairs:s.pairs.map(p=>({source_mapping_version_id:p.source_mapping_version_id,target_mapping_version_id:p.target_mapping_version_id,identifier:p.identifier,checks:p.checks}))};}
  async function detail(db,who,hid,vid=null){
    const [[r]]=await db.execute(select+' WHERE h.handoff_id=? AND '+(vid?'v.handoff_version_id=?':'v.revision_no=h.revision_no'),[id(hid),...(vid?[id(vid)]:[])]);
    if(!r)throw failure('DEFINITION_HANDOFF_NOT_FOUND',404);
    const s=parse(r.snapshot_json);if(digest(s)!==r.snapshot_digest||s.claim_status!==r.claim_status)throw failure('DEFINITION_HANDOFF_INTEGRITY_CONFLICT',409);
    const resolved=await resolve(db,who,input(s));
    if(digest(resolved.snapshot)!==r.snapshot_digest)throw failure('DEFINITION_HANDOFF_INTEGRITY_CONFLICT',409);
    const [savedRefs]=await db.execute('SELECT CAST(mapping_version_id AS CHAR) mapping_version_id,side FROM data_map_design_handoff_refs WHERE handoff_version_id=?',[r.handoff_version_id]);
    const ordered=x=>x.map(y=>y.side+':'+y.mapping_version_id).sort();if(json(ordered(savedRefs))!==json(ordered(resolved.refs)))throw failure('DEFINITION_HANDOFF_INTEGRITY_CONFLICT',409);
    delete r.snapshot_json;return {...r,...s,input:input(s),issues:resolved.issues,effective_confirmed:r.claim_status==='human_confirmed'&&!resolved.issues.length,can_write:writable(who)};
  }
  return {
    handoffCapabilities(session){return tx(async db=>{const w=await actor(db,session);scope(w,w.departmentId);return {person_id:w.personId,department_id:w.departmentId,can_write:writable(w)};});},
    handoffSourceContext(session,sid){return tx(async db=>{const w=await actor(db,session),s=await loadSource(db,w,sid);if(s.validation_status!=='valid')throw failure('DEFINITION_V7_SOURCE_INVALID',409);return {source_id:s.source_id,source_kind:s.source_kind,source_ref:s.source_ref,process:s.document.process,behaviors:s.document.behaviors.map(b=>({behavior_ref:b.behavior_ref,behavior_name:b.behavior_name,actor_description:b.current_actor_role})),mappings:await bindings(db,w,s)};});},
    getDesignHandoff(session,hid,query={}){return tx(async db=>{const r=await detail(db,await actor(db,session),hid,query.version||null);return {...r,relationship_checks:require('./handoffAnalysisRules').inspect(r)};});},
    listDesignHandoffs(session,q={}){return tx(async db=>{
      const w=await actor(db,session);scope(w,w.departmentId);const args=[],where=[];
      if(q.after){where.push('h.handoff_id>?');args.push(id(q.after));}
      if(q.entity_id){if(!['object','field'].includes(q.entity_type))throw failure('DEFINITION_HANDOFF_FILTER_INVALID');scope(w,(await entityScope(db,q.entity_type,id(q.entity_id))).departmentId);
        where.push(`EXISTS (SELECT 1 FROM data_map_design_handoff_versions hv JOIN data_map_design_handoff_refs r ON r.handoff_version_id=hv.handoff_version_id JOIN data_map_v7_mapping_versions m ON m.mapping_version_id=r.mapping_version_id JOIN data_map_definition_versions d ON d.version_id=m.${q.entity_type==='object'?'object':'field'}_version_id WHERE hv.handoff_id=h.handoff_id AND d.entity_id=?)`);args.push(id(q.entity_id));}
      const [rows]=await db.execute('SELECT CAST(h.handoff_id AS CHAR) handoff_id FROM data_map_design_handoffs h'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY h.handoff_id LIMIT 51',args);
      const items=[];let partial=false;for(const r of rows.slice(0,50)){try{items.push(await detail(db,w,r.handoff_id));}catch(e){if(e.statusCode===403)continue;if(e.statusCode===503){partial=true;continue;}throw e;}}
      return {items,partial,next:rows.length>50?rows[49].handoff_id:null};
    });},
    designHandoffHistory(session,hid,q={}){return tx(async db=>{
      const w=await actor(db,session);await detail(db,w,hid);const [rows]=await db.execute('SELECT CAST(handoff_version_id AS CHAR) id FROM data_map_design_handoff_versions WHERE handoff_id=?'+(q.before?' AND handoff_version_id<?':'')+' ORDER BY handoff_version_id DESC LIMIT 51',[id(hid),...(q.before?[id(q.before)]:[])]);
      const items=[];for(const r of rows.slice(0,50))items.push(await detail(db,w,hid,r.id));return {items,next:rows.length>50?rows[49].id:null};
    });},
    saveDesignHandoff(session,payload){return tx(async db=>{
      keys(payload,['request_id','handoff_id','expected_revision','definition']);const w=await actor(db,session,'governance:structure-gate');
      const hid=payload.handoff_id===null?null:id(payload.handoff_id);
      if(hid){await db.execute('SELECT handoff_id FROM data_map_design_handoffs WHERE handoff_id=? FOR UPDATE',[hid]);await detail(db,w,hid);}
      // Authorization and scope are rechecked even for idempotent replays.
      const resolved=await resolve(db,w,payload.definition);
      return request(db,w,'design_handoff',payload,async()=>{
        if(!Number.isSafeInteger(payload.expected_revision)||payload.expected_revision<0)throw failure('DEFINITION_REVISION_REQUIRED');
        const [[head]]=hid?await db.execute('SELECT revision_no FROM data_map_design_handoffs WHERE handoff_id=? FOR UPDATE',[hid]):[[null]];
        if((head?.revision_no||0)!==payload.expected_revision)throw failure('DEFINITION_HANDOFF_REVISION_CONFLICT',409);
        if(resolved.snapshot.claim_status==='human_confirmed'&&resolved.issues.length)throw Object.assign(failure('DEFINITION_HANDOFF_UNVERIFIED',409),{issues:resolved.issues});
        const revision=(head?.revision_no||0)+1;let handoffId=hid;
        if(hid)await db.execute('UPDATE data_map_design_handoffs SET revision_no=? WHERE handoff_id=?',[revision,hid]);
        else{await db.execute('INSERT INTO data_map_design_handoffs(revision_no) VALUES (?)',[revision]);handoffId=await lastId(db);}
        const s=resolved.snapshot;await db.execute('INSERT INTO data_map_design_handoff_versions(handoff_id,revision_no,claim_status,snapshot_json,snapshot_digest,actor_person_id,created_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))',[handoffId,revision,s.claim_status,json(s),digest(s),w.personId]);
        const vid=await lastId(db);for(const ref of resolved.refs)await db.execute('INSERT INTO data_map_design_handoff_refs(handoff_version_id,mapping_version_id,side) VALUES (?,?,?)',[vid,ref.mapping_version_id,ref.side]);
        return {handoff_id:handoffId,handoff_version_id:vid,revision_no:revision,issues:resolved.issues};
      });
    });}
  };
};
