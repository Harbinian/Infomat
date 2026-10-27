// Fixed sources and explicit object/field bindings. Candidate and confirmed are
// mapping states only; no formal master-data decision or process write occurs.
const {failure,id,parse,json,digest,lastId}=require('./dataMapDefinitionValues');
const {MIGRATION_KEY}=require('./v7MappingSchema');
const {createFixedSource}=require('./v7FixedSource');
const {sourceRefs,sourceNodes}=require('./fixedSourceValues');
const keys=(v,allowed)=>{if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).some(k=>!allowed.includes(k)))throw failure('DEFINITION_PROPERTY_NOT_ALLOWED');};
const text=(v,max=255)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw failure('DEFINITION_V7_TEXT_REQUIRED');return v.trim();};
// Name required columns: SELECT * could silently accept a missing validation column
// and expose drift columns while current validation made the source look usable.
const sourceSelect=`SELECT source_key,source_kind,raw_sha256,byte_length,original_name,content_digest,digest_algorithm,
  validation_status,validation_json,content_json,CAST(source_id AS CHAR) source_id,CAST(scope_department_id AS CHAR) scope_department_id,
  CAST(case_id AS CHAR) case_id,CAST(revision_id AS CHAR) revision_id,CAST(process_version_id AS CHAR) process_version_id,
  CAST(created_by_person_id AS CHAR) created_by_person_id,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at FROM data_map_v7_sources`;
const mappingSelect=`SELECT CAST(m.mapping_id AS CHAR) mapping_id,CAST(m.source_id AS CHAR) source_id,m.local_object_ref,m.local_field_ref,
  CAST(v.mapping_version_id AS CHAR) mapping_version_id,v.revision_no,v.status,CAST(v.object_version_id AS CHAR) object_version_id,
  CAST(v.field_version_id AS CHAR) field_version_id,CAST(v.parent_mapping_version_id AS CHAR) parent_mapping_version_id,
  v.snapshot_json,v.snapshot_digest,CAST(v.actor_person_id AS CHAR) actor_person_id,p.person_name actor_name,
  DATE_FORMAT(v.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at
  FROM data_map_v7_mappings m JOIN data_map_v7_mapping_versions v ON v.mapping_id=m.mapping_id
  LEFT JOIN person p ON p.person_id=v.actor_person_id`;
function createFixedMappingContext({transaction,actor,scope,entityScope,version,request,fixedSource,fixedSourceDependencies}) {
  const fixed=fixedSource || createFixedSource(fixedSourceDependencies);
  const tx=fn=>transaction(async db=>{if(!(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]))[0].length)throw failure('DEFINITION_V7_MIGRATION_REQUIRED',503);return fn(db);});
  const writable=w=>!w.readOnly&&w.permissions.has('governance:structure-gate');
  const refs=sourceRefs,nodes=sourceNodes;
  async function loadSource(db,who,sourceId){
    const [[r]]=await db.execute(sourceSelect+' WHERE source_id=? FOR UPDATE',[id(sourceId)]);
    if(!r)throw failure('DEFINITION_V7_SOURCE_NOT_FOUND',404);scope(who,r.scope_department_id);
    r.document=r.content_json===null?null:parse(r.content_json);r.validation=parse(r.validation_json);delete r.content_json;delete r.validation_json;
    if(r.digest_algorithm!==fixed.ALGORITHM||r.content_digest!==null&&fixed.contentHash(r.document)!==r.content_digest)throw failure('DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT',409);
    r.schema_version=typeof r.document?.schema_version==='string'?r.document.schema_version:null;
    r.source_ref=refs(r);r.raw_digest_algorithm=r.raw_sha256?'sha256-raw-bytes':null;r.raw_digest_status=r.raw_sha256?'available':'unavailable';r.stale=false;
    r.current_source_status='fixed_available';r.current_source_issue=null;
    let options={};
    if(r.source_kind!=='uploaded_material'){
      try{const live=await fixed.readReference(db,r.source_kind,r,who,scope);if(live.scope_department_id!==r.scope_department_id||live.content_digest!==r.content_digest)r.stale=true;options=live.options;}
      catch(e){if(['DEFINITION_V7_SOURCE_CHANGED','DEFINITION_V7_NOT_PUBLISHED','DEFINITION_V7_PREVIEW_DISABLED','DEFINITION_V7_FORMAL_DISABLED','DEFINITION_V7_SOURCE_NOT_FOUND'].includes(e.code)||e.statusCode===503){r.stale=true;r.current_source_status='unavailable';r.current_source_issue=e.code;}else throw e;}
    }
    r.current_validation=r.validation_status==='valid'?await fixed.validation(db,r.document,options):r.validation;
    if(!r.stale&&r.source_kind==='published_version'){
      try{await assertSourceCurrent(db,r);}catch(error){if(error.code!=='HANDOFF_SCOPE_STALE')throw error;r.current_source_status='superseded';r.current_source_issue=error.code;}
    }
    r.new_reference_allowed=!r.stale&&r.current_source_status!=='superseded'&&r.validation_status==='valid'&&!r.current_validation.errors.length&&!r.current_validation.blocking_issues.length;
    r.can_confirm=writable(who)&&r.new_reference_allowed;
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
      const states=await targetReferenceStates(db,m.object_version_id,m.field_version_id);
      mappings.push({...m,target_referenceable:states.every(state=>state.new_reference_allowed),target_reference_states:states});
    }
    return mappings.map(m=>{const parent=m.local_field_ref?mappings.find(o=>!o.local_field_ref&&o.local_object_ref===m.local_object_ref):null;
      const needs_recheck=!m.target_referenceable||!r.new_reference_allowed||Boolean(m.local_field_ref&&(!parent||parent.mapping_version_id!==m.parent_mapping_version_id||parent.status!=='confirmed'));
      return {...m,schema_version:r.schema_version,current_source_status:r.current_source_status,current_source_issue:r.current_source_issue,needs_recheck,effective_confirmed:m.status==='confirmed'&&!needs_recheck,governance_status:'mapping_evidence_only',new_reference_allowed:!needs_recheck};});
  }
  async function target(db,who,objectId,fieldId){
    const o=await version(db,id(objectId),true);if(o.entity_type!=='object')throw failure('DEFINITION_FIELD_OBJECT_MISMATCH',409);
    scope(who,(await entityScope(db,'object',o.entity_id,true)).departmentId);
    const f=fieldId===null?null:await version(db,id(fieldId),true);
    if(f){scope(who,(await entityScope(db,'field',f.entity_id,true)).departmentId);if(f.entity_type!=='field'||f.object_version_id!==o.version_id||f.base_snapshot.row.object_id!==o.entity_id)throw failure('DEFINITION_FIELD_OBJECT_MISMATCH',409);}
    return {o,f};
  }
  async function assertTargetReferenceable(db,objectId,fieldId){
    const reader=require('./dataMapEffectiveReader');await reader.isVersionReferenceable(db,objectId);if(fieldId)await reader.isVersionReferenceable(db,fieldId);
  }
  async function targetReferenceStates(db,objectId,fieldId){
    const result=[];
    for(const versionId of [objectId,fieldId].filter(Boolean)){
      const fixedVersion=await version(db,id(versionId),true);
      const state=await require('./dataMapEffectiveReader').readDefinition(db,{entityType:fixedVersion.entity_type,entityId:fixedVersion.entity_id,view:'history',versionId:fixedVersion.version_id});
      result.push({entity_type:fixedVersion.entity_type,entity_id:fixedVersion.entity_id,version_id:fixedVersion.version_id,content_digest:fixedVersion.content_digest,governance_status:state.governance_status,publication_id:state.publication_id||null,eligibility_status:state.eligibility_status,new_reference_allowed:state.new_reference_allowed,requires_attention:state.requires_attention,reference_issues:state.reference_issues||[]});
    }
    return result;
  }
  async function assertSourceCurrent(db,source){
    if(source.source_kind!=='published_version')return;
    const [[row]]=await db.execute('SELECT CAST(d.current_version_id AS CHAR) current_version_id,v.status FROM process_design_versions v JOIN process_design_documents d ON d.id=v.document_id WHERE v.id=? FOR SHARE',[source.process_version_id]);
    if(!row||row.status!=='published'||row.current_version_id!==source.process_version_id)throw failure('HANDOFF_SCOPE_STALE',409);
  }
  return Object.freeze({tx,writable,refs,nodes,loadSource,unpack,bindings,target,mappingSelect,assertTargetReferenceable,assertSourceCurrent,targetReferenceStates});
}
module.exports = {createFixedMappingContext};
