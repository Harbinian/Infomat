// Fixed sources and explicit object/field bindings. Candidate and confirmed are
// mapping states only; no formal master-data decision or process write occurs.
const {failure,id,parse,json,digest,lastId}=require('./dataMapDefinitionValues');
const {MIGRATION_KEY}=require('./v7MappingSchema');
const fixed=require('./v7FixedSource');
const keys=(v,allowed)=>{if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).some(k=>!allowed.includes(k)))throw failure('DEFINITION_PROPERTY_NOT_ALLOWED');};
const text=(v,max=255)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw failure('DEFINITION_V7_TEXT_REQUIRED');return v.trim();};
const sourceSelect=`SELECT *,CAST(source_id AS CHAR) source_id,CAST(scope_department_id AS CHAR) scope_department_id,
  CAST(case_id AS CHAR) case_id,CAST(revision_id AS CHAR) revision_id,CAST(process_version_id AS CHAR) process_version_id,
  CAST(created_by_person_id AS CHAR) created_by_person_id,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at FROM data_map_v7_sources`;
const mappingSelect=`SELECT CAST(m.mapping_id AS CHAR) mapping_id,CAST(m.source_id AS CHAR) source_id,m.local_object_ref,m.local_field_ref,
  CAST(v.mapping_version_id AS CHAR) mapping_version_id,v.revision_no,v.status,CAST(v.object_version_id AS CHAR) object_version_id,
  CAST(v.field_version_id AS CHAR) field_version_id,CAST(v.parent_mapping_version_id AS CHAR) parent_mapping_version_id,
  v.snapshot_json,v.snapshot_digest,CAST(v.actor_person_id AS CHAR) actor_person_id,p.person_name actor_name,
  DATE_FORMAT(v.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at
  FROM data_map_v7_mappings m JOIN data_map_v7_mapping_versions v ON v.mapping_id=m.mapping_id
  LEFT JOIN person p ON p.person_id=v.actor_person_id`;
module.exports=function({transaction,actor,scope,entityScope,version,request}){
  const tx=fn=>transaction(async db=>{if(!(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]))[0].length)throw failure('DEFINITION_V7_MIGRATION_REQUIRED',503);return fn(db);});
  const writable=w=>!w.readOnly&&w.permissions.has('governance:structure-gate');
  function refs(r){return r.source_kind==='uploaded_material'?{batch_id:r.source_id,material_version:1}:r.source_kind==='preview_revision'?{case_id:r.case_id,revision_id:r.revision_id}:{process_version_id:r.process_version_id};}
  function nodes(document){return (document?.data_objects||[]).map(o=>({local_object_ref:o.data_ref,name:o.data_name,fields:(o.fields||[]).map(f=>({local_field_ref:f.field_ref,name:f.field_name}))}));}
  async function loadSource(db,who,sourceId){
    const [[r]]=await db.execute(sourceSelect+' WHERE source_id=? FOR UPDATE',[id(sourceId)]);
    if(!r)throw failure('DEFINITION_V7_SOURCE_NOT_FOUND',404);scope(who,r.scope_department_id);
    r.document=r.content_json===null?null:parse(r.content_json);r.validation=parse(r.validation_json);delete r.content_json;delete r.validation_json;
    if(r.digest_algorithm!==fixed.ALGORITHM||r.content_digest!==null&&fixed.contentHash(r.document)!==r.content_digest)throw failure('DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT',409);
    r.source_ref=refs(r);r.raw_digest_algorithm=r.raw_sha256?'sha256-raw-bytes':null;r.raw_digest_status=r.raw_sha256?'available':'unavailable';r.stale=false;
    let options={};
    if(r.source_kind!=='uploaded_material'){
      try{const live=await fixed.readReference(db,r.source_kind,r,who,scope);if(live.scope_department_id!==r.scope_department_id||live.content_digest!==r.content_digest)r.stale=true;options=live.options;}
      catch(e){if(['DEFINITION_V7_SOURCE_CHANGED','DEFINITION_V7_NOT_PUBLISHED'].includes(e.code))r.stale=true;else throw e;}
    }
    r.current_validation=r.validation_status==='valid'?await fixed.validation(db,r.document,options):r.validation;
    r.can_confirm=writable(who)&&!r.stale&&r.validation_status==='valid'&&!r.current_validation.errors.length&&!r.current_validation.blocking_issues.length;
    return r;
  }
  function unpack(r){
    const s=parse(r.snapshot_json);
    if(digest(s)!==r.snapshot_digest||s.object_version_id!==r.object_version_id||s.field_version_id!==r.field_version_id||s.parent_mapping_version_id!==r.parent_mapping_version_id||s.status!==r.status||s.local_object_ref!==r.local_object_ref||s.local_field_ref!==r.local_field_ref||s.source_id!==r.source_id||s.revision_no!==r.revision_no)throw failure('DEFINITION_V7_MAPPING_INTEGRITY_CONFLICT',409);
    delete r.snapshot_json;return {...r,...s};
  }
  async function bindings(db,who,r){
    const [rows]=await db.execute(mappingSelect+' WHERE m.source_id=? AND v.revision_no=m.revision_no ORDER BY m.mapping_id',[r.source_id]);
    const mappings=[];
    for(const row of rows){
      const m=unpack(row);
      // A source read does not grant access to a ledger in another scope.
      try{await target(db,who,m.object_version_id,m.field_version_id);}catch(e){if(e.code==='DEFINITION_ACCESS_DENIED')continue;throw e;}
      mappings.push(m);
    }
    return mappings.map(m=>{const parent=m.local_field_ref?mappings.find(o=>!o.local_field_ref&&o.local_object_ref===m.local_object_ref):null;
      const needs_recheck=r.stale||!r.can_confirm&&Boolean(r.current_validation.errors.length||r.current_validation.blocking_issues.length)||Boolean(m.local_field_ref&&(!parent||parent.mapping_version_id!==m.parent_mapping_version_id||parent.status!=='confirmed'));
      return {...m,needs_recheck,effective_confirmed:m.status==='confirmed'&&!needs_recheck};});
  }
  async function target(db,who,objectId,fieldId){
    const o=await version(db,id(objectId),true);if(o.entity_type!=='object')throw failure('DEFINITION_FIELD_OBJECT_MISMATCH',409);
    scope(who,(await entityScope(db,'object',o.entity_id,true)).departmentId);
    const f=fieldId===null?null:await version(db,id(fieldId),true);
    if(f){scope(who,(await entityScope(db,'field',f.entity_id,true)).departmentId);if(f.entity_type!=='field'||f.object_version_id!==o.version_id||f.base_snapshot.row.object_id!==o.entity_id)throw failure('DEFINITION_FIELD_OBJECT_MISMATCH',409);}
    return {o,f};
  }
  return {
    ...require('./analysisIssues')({transaction,actor,scope,entityScope,version,request,loadSource,target,unpack,mappingSelect}),
    ...require('./analysisApi')({transaction,actor,scope,entityScope,version,request,loadSource,target,unpack,mappingSelect}),
    ...require('./analysisRuns')({transaction,actor,scope,entityScope,version,request,loadSource,target,unpack,mappingSelect}),
    ...require('./analysisQueue')({transaction,actor,scope,entityScope,version,request,loadSource,target,unpack,mappingSelect}),
    ...require('./designHandoffs')({transaction,actor,scope,entityScope,version,request,loadSource,target,unpack,mappingSelect,bindings}),
    v7MappingCapabilities(session){return tx(async db=>{const who=await actor(db,session);scope(who,who.departmentId);return {person_id:who.personId,department_id:who.departmentId,can_write:writable(who)};});},
    listV7Sources(session,{after=null}={}){return tx(async db=>{
      const who=await actor(db,session),conditions=[],args=[];scope(who,who.departmentId);
      if(!who.permissions.has('governance:read-global')){conditions.push('scope_department_id=?');args.push(who.departmentId);}
      if(after){conditions.push('source_id>?');args.push(id(after));}
      const [rows]=await db.execute(sourceSelect+(conditions.length?' WHERE '+conditions.join(' AND '):'')+' ORDER BY data_map_v7_sources.source_id LIMIT 101',args);
      // Reference scope is rechecked; moved references are not disclosed in lists.
      const items=[];let unavailable=false;for(const row of rows.slice(0,100)){try{if(row.source_kind!=='uploaded_material')await fixed.readReference(db,row.source_kind,row,who,scope);}catch(e){if(e.code==='DEFINITION_ACCESS_DENIED')continue;if(['DEFINITION_V7_PREVIEW_DISABLED','DEFINITION_V7_FORMAL_DISABLED'].includes(e.code)){unavailable=true;continue;}if(!['DEFINITION_V7_SOURCE_CHANGED','DEFINITION_V7_NOT_PUBLISHED'].includes(e.code))throw e;}
        items.push({source_id:row.source_id,source_kind:row.source_kind,source_ref:refs(row),original_name:row.original_name,validation_status:row.validation_status,content_digest:row.content_digest});}
      return {items,next:rows.length>100?rows[99].source_id:null,partial:unavailable};
    });},
    registerV7Source(session,payload,bytes=null){return tx(async db=>{
      keys(payload,['request_id','source_kind','case_id','revision_id','process_version_id','original_name']);
      const who=await actor(db,session,'governance:structure-gate');
      const kind=payload.source_kind,upload=kind==='uploaded_material';
      if((upload&&(payload.case_id!==undefined||payload.revision_id!==undefined||payload.process_version_id!==undefined))||(!upload&&(bytes||payload.original_name!==undefined))||(kind==='preview_revision'&&payload.process_version_id!==undefined)||(kind==='published_version'&&(payload.case_id!==undefined||payload.revision_id!==undefined)))throw failure('DEFINITION_V7_SOURCE_REFS_INVALID');
      payload={...payload,...(kind==='preview_revision'?{case_id:id(payload.case_id),revision_id:id(payload.revision_id)}:kind==='published_version'?{process_version_id:id(payload.process_version_id)}:{})};
      const value=upload?fixed.parseUpload(bytes):await fixed.readReference(db,kind,payload,who,scope);
      const dept=upload?who.departmentId:value.scope_department_id;if(!dept)throw failure('DEFINITION_DEPARTMENT_REQUIRED',403);
      const name=upload?text(payload.original_name):null;
      const sourceKey=digest(upload?{kind,dept,hash:value.raw_sha256}:{kind,case_id:payload.case_id||null,revision_id:payload.revision_id||null,process_version_id:payload.process_version_id||null});
      return request(db,who,'v7_source',{...payload,raw_sha256:value.raw_sha256||null},async()=>{
        const [[existing]]=await db.execute('SELECT CAST(source_id AS CHAR) source_id FROM data_map_v7_sources WHERE source_key=? FOR UPDATE',[sourceKey]);
        if(existing){await loadSource(db,who,existing.source_id);return {...existing,duplicate:true};}
        const check=value.parse_failed?{errors:[{code:'INVALID_JSON',message:'文件不是有效的 UTF-8 JSON。'}],blocking_issues:[],warnings:[]}:await fixed.validation(db,value.document,value.options);
        if(!check.errors.length&&nodes(value.document).reduce((n,o)=>n+1+o.fields.length,0)>1000)throw failure('DEFINITION_V7_NODE_LIMIT',413);
        const status=value.parse_failed?'parse_failed':check.errors.length?'validation_failed':'valid';
        await db.execute(`INSERT INTO data_map_v7_sources(source_key,source_kind,scope_department_id,case_id,revision_id,process_version_id,raw_sha256,byte_length,original_name,content_digest,digest_algorithm,validation_status,validation_json,content_json,created_by_person_id,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[sourceKey,kind,dept,upload?null:payload.case_id||null,upload?null:payload.revision_id||null,upload?null:payload.process_version_id||null,value.raw_sha256||null,value.byte_length??null,name,value.parse_failed?null:fixed.contentHash(value.document),fixed.ALGORITHM,status,json(check),value.parse_failed?null:json(value.document),who.personId]);
        return {source_id:await lastId(db),validation_status:status,duplicate:false};
      });
    });},
    getV7Source(session,sourceId){return tx(async db=>{const who=await actor(db,session),r=await loadSource(db,who,sourceId),mappings=await bindings(db,who,r);const {document,...meta}=r;return {...meta,nodes:r.validation_status==='valid'?nodes(document):[],mappings,can_write:writable(who)};});},
    getV7Evidence(session,sourceId,query={}){return tx(async db=>{
      const who=await actor(db,session),r=await loadSource(db,who,sourceId);
      if(r.validation_status!=='valid')throw failure('DEFINITION_V7_SOURCE_INVALID',409);
      const o=r.document.data_objects.find(o=>o.data_ref===query.object),f=query.field?o?.fields.find(f=>f.field_ref===query.field):null;
      if(!o||(query.field&&!f))throw failure('DEFINITION_V7_LOCAL_REF_INVALID',404);
      return {source_id:r.source_id,source_kind:r.source_kind,source_ref:r.source_ref,content_digest:r.content_digest,digest_algorithm:r.digest_algorithm,stale:r.stale,local_object_ref:o.data_ref,local_field_ref:f?.field_ref||null,evidence:f||o};
    });},
    getV7MappingHistory(session,sourceId,mappingId,{before=null}={}){return tx(async db=>{
      const who=await actor(db,session);await loadSource(db,who,sourceId);
      const [rows]=await db.execute(mappingSelect+' WHERE m.source_id=? AND m.mapping_id=?'+(before?' AND v.mapping_version_id<?':'')+' ORDER BY v.mapping_version_id DESC LIMIT 51',[id(sourceId),id(mappingId),...(before?[id(before)]:[])]);
      const items=[];for(const row of rows.slice(0,50)){const m=unpack(row);await target(db,who,m.object_version_id,m.field_version_id);items.push(m);}return {items,next:rows.length>50?String(rows[49].mapping_version_id):null};
    });},
    saveV7Mapping(session,sourceId,payload){return tx(async db=>{
      keys(payload,['request_id','expected_revision','source_digest','local_object_ref','local_field_ref','object_version_id','field_version_id','status','basis']);
      const who=await actor(db,session,'governance:structure-gate'),r=await loadSource(db,who,sourceId);
      if(r.validation_status!=='valid'||r.stale||r.content_digest!==payload.source_digest)throw failure('DEFINITION_V7_SOURCE_CHANGED',409);
      if(!['candidate','confirmed'].includes(payload.status))throw failure('DEFINITION_V7_STATE_INVALID');
      if(payload.status==='confirmed'&&!r.can_confirm)throw failure('DEFINITION_V7_SOURCE_BLOCKED',409);
      const objectRef=text(payload.local_object_ref),fieldRef=payload.local_field_ref===null?null:text(payload.local_field_ref);
      const o=r.document.data_objects.find(x=>x.data_ref===objectRef);if(!o||(fieldRef&&!o.fields.some(f=>f.field_ref===fieldRef)))throw failure('DEFINITION_V7_LOCAL_REF_INVALID');
      if((fieldRef===null)!==(payload.field_version_id===null))throw failure('DEFINITION_V7_LOCAL_REF_INVALID');
      const {o:object,f:field}=await target(db,who,payload.object_version_id,payload.field_version_id);
      const basis=text(payload.basis,4096),localKey=digest([objectRef,fieldRef]);
      return request(db,who,'v7_mapping',{...payload,source_id:r.source_id},async()=>{
        if(!Number.isSafeInteger(payload.expected_revision)||payload.expected_revision<0)throw failure('DEFINITION_REVISION_REQUIRED');
        const [[head]]=await db.execute('SELECT CAST(mapping_id AS CHAR) mapping_id,revision_no FROM data_map_v7_mappings WHERE source_id=? AND local_key=? FOR UPDATE',[r.source_id,localKey]);
        if((head?.revision_no||0)!==payload.expected_revision)throw failure('DEFINITION_V7_REVISION_CONFLICT',409);
        let parent=null;
        if(field){const [[row]]=await db.execute(mappingSelect+' WHERE m.source_id=? AND m.local_key=? AND v.revision_no=m.revision_no',[r.source_id,digest([objectRef,null])]);if(row)parent=unpack(row);
          if(!parent||parent.object_version_id!==object.version_id||(payload.status==='confirmed'&&parent.status!=='confirmed'))throw failure('DEFINITION_V7_PARENT_MAPPING_REQUIRED',409);}
        const revision=(head?.revision_no||0)+1;
        let mappingId=head?.mapping_id;
        if(!head){await db.execute('INSERT INTO data_map_v7_mappings(source_id,local_key,local_object_ref,local_field_ref,revision_no) VALUES (?,?,?,?,?)',[r.source_id,localKey,objectRef,fieldRef,revision]);mappingId=await lastId(db);}
        else await db.execute('UPDATE data_map_v7_mappings SET revision_no=? WHERE mapping_id=?',[revision,mappingId]);
        const snapshot={source_id:r.source_id,source_kind:r.source_kind,source_ref:r.source_ref,source_digest:r.content_digest,digest_algorithm:r.digest_algorithm,local_object_ref:objectRef,local_field_ref:fieldRef,
          object_id:object.entity_id,object_version_id:object.version_id,field_id:field?.entity_id||null,field_version_id:field?.version_id||null,object_name:object.definition.name,field_name:field?.definition.name||null,
          parent_mapping_version_id:parent?.mapping_version_id||null,status:payload.status,basis,revision_no:revision};
        await db.execute(`INSERT INTO data_map_v7_mapping_versions(mapping_id,revision_no,object_version_id,field_version_id,parent_mapping_version_id,status,snapshot_json,snapshot_digest,actor_person_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[mappingId,revision,snapshot.object_version_id,snapshot.field_version_id,snapshot.parent_mapping_version_id,snapshot.status,json(snapshot),digest(snapshot),who.personId]);
        return {mapping_id:mappingId,mapping_version_id:await lastId(db),revision_no:revision,status:payload.status};
      });
    });}
  };
};
