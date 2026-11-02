// Fixed immutable bodies, explicit views and publication provenance. No physical fallback.
const { id, kind, parse, digest } = require('./dataMapDefinitionValues');
const { failure, readControl } = require('./dataMapHandoffControl');
function reference(value) {if(typeof value!=='string'||!value||value.length>128||!/^[A-Za-z0-9_.:-]+$/.test(value))throw failure('HANDOFF_REFERENCE_INVALID',400);return value;}
function verifiedItem(row) {
  const manifest=parse(row.manifest_json),payload=parse(row.payload_json),details=parse(row.source_detail_versions_json);
  const matches=Array.isArray(manifest?.items)?manifest.items.filter(item=>item.item_ref===row.item_ref):[],match=matches[0];
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(details)
    ||digest(manifest)!==row.manifest_digest||manifest.schema_version!=='data-map-publication-v1'||matches.length!==1
    ||!['current','historical'].includes(manifest.scope_mode)||(row.scope_mode&&manifest.scope_mode!==row.scope_mode)
    ||match.target_kind!==row.target_kind||String(match.target_id)!==String(row.target_id)||match.target_version_ref!==row.target_version_ref
    ||match.operation!==row.operation||![0,1,false,true].includes(match.produces_version)||Boolean(Number(match.produces_version))!==Boolean(Number(row.produces_version))
    ||digest(match.payload)!==digest(payload)||digest(match.source_detail_versions)!==digest(details))throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
  const operations={object:['create','modify','reuse'],field:['create','modify','reuse'],data_element:['create','modify','reuse'],context:['context_link'],rule:['rule'],authority:['authority']};
  if(!operations[row.target_kind]?.includes(row.operation)||Boolean(Number(row.produces_version))===(row.operation==='reuse'))throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
  return {manifest,payload};
}
async function fixedVersion(db, versionId) {
  const [[row]] = await db.execute(`SELECT *,CAST(version_id AS CHAR) version_id,CAST(entity_id AS CHAR) entity_id,
    CAST(object_version_id AS CHAR) object_version_id,CAST(supersedes_version_id AS CHAR) supersedes_version_id,
    CAST(created_by_person_id AS CHAR) created_by_person_id,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at FROM data_map_definition_versions WHERE version_id=? FOR SHARE`, [id(versionId)]);
  if (!row) throw failure('HANDOFF_VERSION_NOT_FOUND', 404);
  const definition = parse(row.definition_json), base = parse(row.base_snapshot_json);
  if (row.digest_algorithm !== 'sha256-canonical-json-v1' || row.content_digest !== digest(definition) || row.base_digest !== digest(base)) throw failure('HANDOFF_VERSION_INTEGRITY_CONFLICT', 409);
  return { ...row, definition, base_snapshot: base, revision_no: row.version_no };
}
const subjects=['object','field','context','rule','authority','data_element'];
const withdrawnEvents=new Set(['withdrawn','publication_withdrawn','withdraw_publication']);
const itemColumns=`p.manifest_json,p.manifest_digest,p.scope_mode,i.item_ref,i.payload_json,i.produces_version,
  i.target_kind,CAST(i.target_id AS CHAR) target_id,i.target_version_ref,i.operation,i.source_detail_versions_json,
  CAST(i.publication_id AS CHAR) publication_id,p.request_id publication_request_id`;
// A per-operation cache is bounded by the actual fixed closure. It is never
// shared across requests: new references must reread under the caller's lock.
async function referenceStatus(db,{subjectKind,subjectId=null,versionRef,publicationId=null,scopeMode='current'}) {
  if(typeof db.getConnection==='function')return require('./dataMapHandoffControl').readSnapshot(db,c=>referenceStatus(c,{subjectKind,subjectId,versionRef,publicationId,scopeMode}));
  if(!subjects.includes(subjectKind)||!['current','historical'].includes(scopeMode))throw failure('HANDOFF_SUBJECT_INVALID',400);
  const control=await readControl(db);if(control.cutover_state!=='controlled')throw failure('HANDOFF_MAINTENANCE',503);
  const nodes=new Map(),publications=new Map(),issues=new Map(),queue=[];
  const issue=(node,code)=>{const value={subject_kind:node.kind,subject_id:node.id||null,version_ref:node.version,code};issues.set(JSON.stringify(value),value);};
  const add=(kind,version,entity=null)=>{
    if(!subjects.includes(kind)||typeof version!=='string'||!version){issue({kind,id:entity,version:version||null},'HANDOFF_DEPENDENCY_INVALID');return;}
    const key=kind+':'+version;
    if(nodes.has(key)){const old=nodes.get(key);if(entity&&old.id&&old.id!==String(entity))throw failure('HANDOFF_REFERENCE_MISMATCH',409);if(entity&&!old.id)old.id=String(entity);return;}
    const node={kind,version,id:entity==null?null:String(entity)};nodes.set(key,node);queue.push(node);
  };
  async function publication(row){
    if(publications.has(row.publication_id))return publications.get(row.publication_id);
    const [items]=await db.execute(`SELECT ${itemColumns} FROM data_map_publication_items i JOIN data_map_publications p ON p.publication_id=i.publication_id WHERE i.publication_id=? ORDER BY i.item_ref FOR SHARE`,[row.publication_id]);
    const manifest=parse(row.manifest_json);
    if(!Array.isArray(manifest?.items)||manifest.items.length!==items.length||new Set(manifest.items.map(x=>x.item_ref)).size!==items.length)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
    for(const item of items){
      const {payload}=verifiedItem(item);
      if(Number(item.produces_version)===0){
        if(['object','field'].includes(item.target_kind)){
          const fixed=await fixedVersion(db,item.target_version_ref);
          if(fixed.entity_type!==item.target_kind||fixed.entity_id!==item.target_id||digest(payload.definition)!==fixed.content_digest)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
          if(item.target_kind==='field'&&(fixed.object_version_id!==payload.object_version_id||String(fixed.base_snapshot?.row?.context_id)!==String(payload.context_id)||String(fixed.base_snapshot?.row?.object_id)!==String(payload.object_id)))throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
        }else{
          const [[element]]=await db.execute('SELECT element_id,definition_json,content_digest FROM data_map_data_element_versions WHERE element_version_id=? FOR SHARE',[item.target_version_ref]);
          if(!element||element.element_id!==item.target_id||digest(parse(element.definition_json))!==element.content_digest||digest(payload.definition)!==element.content_digest)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
        }
      }
    }
    const [events]=await db.execute('SELECT event_no,event_type,payload_json,request_id FROM data_map_publication_events WHERE publication_id=? ORDER BY event_no FOR SHARE',[row.publication_id]);
    if(!events.length)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
    let withdrawn=false;
    for(let index=0;index<events.length;index++){
      const event=events[index],value=parse(event.payload_json);
      if(String(event.event_no)!==String(index+1)||!value||typeof value!=='object'||Array.isArray(value))throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
      if(index===0){
        if(event.event_type!=='published'||event.request_id!==row.publication_request_id||value.manifest_digest!==row.manifest_digest||value.scope_mode!==row.scope_mode
          ||!value.actor||!manifest.actor||typeof value.actor!=='object'||typeof manifest.actor!=='object'||Array.isArray(value.actor)||Array.isArray(manifest.actor)||digest(value.actor)!==digest(manifest.actor))throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
      }else if(withdrawnEvents.has(event.event_type)&&!withdrawn)withdrawn=true;
      else throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
    }
    const result={items,manifest,withdrawn};publications.set(row.publication_id,result);return result;
  }
  add(subjectKind,versionRef,subjectId);
  for(let cursor=0;cursor<queue.length;cursor++){
    const node=queue[cursor];
    const [rows]=await db.execute(`SELECT ${itemColumns} FROM data_map_publication_items i JOIN data_map_publications p ON p.publication_id=i.publication_id WHERE i.target_kind=? AND i.target_version_ref=? AND i.produces_version=1 FOR SHARE`,[node.kind,node.version]);
    if(rows.length>1)throw failure('HANDOFF_PUBLICATION_PRODUCER_AMBIGUOUS',409);
    const row=rows[0];
    if(!row){issue(node,'HANDOFF_PRODUCER_UNAVAILABLE');continue;}
    if(node.id&&node.id!==row.target_id)throw failure('HANDOFF_REFERENCE_MISMATCH',409);
    node.id=row.target_id;node.row=row;
    const {payload}=verifiedItem(row),pub=await publication(row);node.payload=payload;node.manifest=pub.manifest;node.withdrawn=pub.withdrawn;
    if(node===queue[0]&&publicationId&&row.publication_id!==publicationId)throw failure('HANDOFF_REFERENCE_MISMATCH',409);
    if(pub.withdrawn)issue(node,'HANDOFF_PUBLICATION_WITHDRAWN');
    if(row.scope_mode!=='current')issue(node,'HANDOFF_HISTORICAL_SCOPE');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||!payload.definition||typeof payload.definition!=='object'||Array.isArray(payload.definition)){issue(node,'HANDOFF_DEPENDENCY_STRUCTURE_UNSUPPORTED');continue;}
    const supported=new Set(['definition','basis','evidence_refs','authority','base_version_ref','object_id','object_version_id','context_id','context_version_ref','data_element_version_ref','process_version_id']);
    if(Object.keys(payload).some(key=>!supported.has(key)))issue(node,'HANDOFF_DEPENDENCY_STRUCTURE_UNSUPPORTED');
    // Base/supersedes identify ancestry, not a dependency of the adopted content.
    // Unknown fixed reference structures cannot silently confer new eligibility.
    function inspect(value,path='definition'){
      if(!value||typeof value!=='object')return;
      for(const [key,child]of Object.entries(value)){
        if(/(?:version_ids?|version_refs?)$/.test(key)&&!(node.kind==='object'&&path==='definition.unique_identifiers'&&key==='field_version_ids'))issue(node,'HANDOFF_DEPENDENCY_STRUCTURE_UNSUPPORTED');
        if(key==='unique_identifiers'&&Array.isArray(child)){for(const group of child)inspect(group,'definition.unique_identifiers');}
        else if(child&&typeof child==='object')inspect(child,path+'.'+key);
      }
    }
    inspect(payload.definition);
    if(['object','field'].includes(node.kind)){
      let fixed;try{fixed=await fixedVersion(db,node.version);}catch(error){if(error.code!=='HANDOFF_VERSION_NOT_FOUND')throw error;issue(node,error.code);continue;}
      node.fixed=fixed;
      if(fixed.entity_type!==node.kind||fixed.entity_id!==node.id||digest(payload.definition)!==fixed.content_digest)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
      if(fixed.source_kind!=='governance')issue(node,'HANDOFF_LEGACY_UNAPPROVED');
      if(node.kind==='object'){
        const groups=fixed.definition.unique_identifiers;
        // Null, absent and [] are supported declarations of no identifier
        // dependency. Reading cannot introduce a new identifier business gate.
        if(groups!=null&&!Array.isArray(groups))issue(node,'HANDOFF_DEPENDENCY_STRUCTURE_UNSUPPORTED');
        else for(const group of groups||[]){
          if(!group||!['single','composite'].includes(group.kind)||!Array.isArray(group.field_version_ids)||new Set(group.field_version_ids).size!==group.field_version_ids.length||(group.kind==='single'?group.field_version_ids.length!==1:group.field_version_ids.length<2)){issue(node,'HANDOFF_DEPENDENCY_STRUCTURE_UNSUPPORTED');continue;}
          for(const ref of group.field_version_ids){
            add('field',ref);
            try{const field=await fixedVersion(db,ref);if(field.entity_type!=='field'||field.object_version_id!==node.version||String(field.base_snapshot?.row?.object_id)!==node.id)throw failure('HANDOFF_IDENTIFIER_PARENT_MISMATCH',409);}
            catch(error){if(error.code!=='HANDOFF_VERSION_NOT_FOUND')throw error;issue({kind:'field',id:null,version:ref},error.code);}
          }
        }
      }else{
        const base=fixed.base_snapshot?.row;
        if(!fixed.object_version_id||payload.object_version_id!==fixed.object_version_id||String(payload.object_id)!==String(base?.object_id)||String(payload.context_id)!==String(base?.context_id))throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
        if(!payload.context_version_ref||!payload.data_element_version_ref)issue(node,'HANDOFF_DEPENDENCY_STRUCTURE_UNSUPPORTED');
        const [bindings]=await db.execute('SELECT element_version_id,context_version_ref,CAST(publication_id AS CHAR) publication_id FROM data_map_field_element_bindings WHERE field_version_id=? FOR SHARE',[node.version]);
        if(bindings.length!==1||bindings[0].publication_id!==row.publication_id||bindings[0].element_version_id!==payload.data_element_version_ref||bindings[0].context_version_ref!==payload.context_version_ref)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
      }
    }else if(node.kind==='data_element'){
      const [[element]]=await db.execute('SELECT element_id,definition_json,content_digest,publication_id FROM data_map_data_element_versions WHERE element_version_id=? FOR SHARE',[node.version]);
      if(!element||element.element_id!==node.id||element.publication_id!==row.publication_id||digest(parse(element.definition_json))!==element.content_digest||digest(payload.definition)!==element.content_digest)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
    }
    if(payload.object_version_id)add('object',payload.object_version_id,payload.object_id);
    if(payload.context_version_ref)add('context',payload.context_version_ref,payload.context_id);
    if(payload.data_element_version_ref)add('data_element',payload.data_element_version_ref);
    if(['rule','authority'].includes(node.kind)&&!payload.context_version_ref)issue(node,'HANDOFF_DEPENDENCY_STRUCTURE_UNSUPPORTED');
    if(node.kind==='context')for(const item of pub.items){
      const sibling=verifiedItem(item).payload;
      if(sibling.context_version_ref===node.version){
        if(String(sibling.context_id)!==node.id)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
        add(item.target_kind,item.target_version_ref,item.target_id);
      }
    }
  }
  const root=queue[0],referenceIssues=[...issues.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),referenceable=referenceIssues.length===0&&scopeMode==='current';
  return {referenceable,new_reference_allowed:referenceable,requires_attention:referenceIssues.length>0,
    eligibility_status:referenceable?'referenceable':root?.withdrawn?'withdrawn':root?.row?'dependency_unavailable':'unavailable',
    producer_status:root?.withdrawn?'withdrawn':root?.row?'active':'unavailable',publication_id:root?.row?.publication_id||null,
    scope_mode:root?.row?.scope_mode||scopeMode,reference_issues:referenceIssues};
}
async function publicationEligibility(db, { entityType, entityId, versionId, publicationId = null, scopeMode = 'current' }) {
  return referenceStatus(db,{subjectKind:kind(entityType),subjectId:id(entityId),versionRef:id(versionId),publicationId:publicationId?reference(publicationId):null,scopeMode});
}
async function assertReferenceable(db, input) {
  if(typeof db.getConnection==='function')return require('./dataMapHandoffControl').readSnapshot(db,connection=>assertReferenceable(connection,input));
  const control = await readControl(db);
  if (control.cutover_state !== 'controlled') throw failure('HANDOFF_MAINTENANCE',503);
  const version = await fixedVersion(db,input.versionId);
  if (version.entity_type !== kind(input.entityType) || version.entity_id !== id(input.entityId)) throw failure('HANDOFF_REFERENCE_MISMATCH',409);
  const eligibility = await publicationEligibility(db,input);
  if (!eligibility.referenceable || version.source_kind !== 'governance') throw failure('HANDOFF_REFERENCE_UNAVAILABLE',409);
  return { ...version, ...eligibility };
}
async function readLegacy(db, { entityType, entityId, versionId }) {
  if (typeof versionId !== 'string' || !versionId) throw failure('HANDOFF_FIXED_VERSION_REQUIRED',400);
  const [[row]] = await db.execute(`SELECT asset_kind,CAST(asset_id AS CHAR) asset_id,version_ref,snapshot_json,snapshot_digest,
    original_status,history_completeness,DATE_FORMAT(captured_at,'%Y-%m-%dT%H:%i:%s.%fZ') captured_at FROM data_map_legacy_registry WHERE asset_kind=? AND asset_id=? AND version_ref=? FOR SHARE`, [entityType,id(entityId),versionId]);
  if (!row) throw failure('HANDOFF_LEGACY_SNAPSHOT_NOT_FOUND',404);
  const snapshot = parse(row.snapshot_json);
  if (digest(snapshot) !== row.snapshot_digest) throw failure('HANDOFF_LEGACY_INTEGRITY_CONFLICT',409);
  return { ...row, snapshot, view:'legacy_in_use', governance_status:'legacy_unapproved', referenceable:false,new_reference_allowed:false,requires_attention:false };
}
async function readDefinition(db, { entityType, entityId, view, versionId = null }) {
  if(typeof db.getConnection==='function')return require('./dataMapHandoffControl').readSnapshot(db,connection=>readDefinition(connection,{entityType,entityId,view,versionId}));
  kind(entityType);entityId=id(entityId);
  if (!['current','history','legacy_in_use'].includes(view)) throw failure('HANDOFF_CLIENT_UPGRADE_REQUIRED',409);
  if (view === 'legacy_in_use') { await readControl(db);return readLegacy(db,{entityType,entityId,versionId}); }
  if (view === 'history') {
    let control=null;
    try{control=await readControl(db);}catch(error){if(error.statusCode!==503)throw error;}
    const value = await fixedVersion(db,versionId);
    if (value.entity_type !== entityType || value.entity_id !== entityId) throw failure('HANDOFF_REFERENCE_MISMATCH',409);
    // A fixed version can be independently verified during a partial installation.
    let eligibility = { referenceable:false,new_reference_allowed:false,requires_attention:false,eligibility_status:'unavailable' };
    try { if(control?.cutover_state==='controlled')eligibility=await publicationEligibility(db,{entityType,entityId,versionId});else if(control)eligibility={referenceable:false,new_reference_allowed:false,requires_attention:false,eligibility_status:'maintenance'}; }
    catch (error) { if (error.statusCode !== 503 && !['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error.code)) throw error; }
    return {...value,...eligibility,view:'history',governance_status:value.source_kind==='governance'?'governed_history':'legacy_unapproved'};
  }
  const control = await readControl(db);
  if (control.cutover_state !== 'controlled') throw failure('HANDOFF_MAINTENANCE',503);
  const [[head]] = await db.execute(`SELECT CAST(subject_id AS CHAR) subject_id,effective_version_ref,CAST(publication_id AS CHAR) publication_id,
    CAST(head_revision AS CHAR) head_revision,availability FROM data_map_effective_heads WHERE subject_kind=? AND subject_id=? FOR SHARE`,[entityType,entityId]);
  if (!head || head.availability !== 'active' || !head.effective_version_ref || !head.publication_id) return {entity_type:entityType,entity_id:entityId,view:'current',availability:head?.availability||'unavailable',referenceable:false,new_reference_allowed:false,requires_attention:head?.availability==='withdrawn',current:null};
  const value=await fixedVersion(db,head.effective_version_ref);
  if(value.entity_type!==entityType||value.entity_id!==entityId)throw failure('HANDOFF_REFERENCE_MISMATCH',409);
  const eligibility=await publicationEligibility(db,{entityType,entityId,versionId:head.effective_version_ref,publicationId:head.publication_id});
  if(eligibility.producer_status!=='active')return {entity_type:entityType,entity_id:entityId,view:'current',availability:eligibility.producer_status==='withdrawn'?'withdrawn':'unavailable',...eligibility,current:null};
  return {...value,...eligibility,view:'current',availability:eligibility.referenceable?'active':'requires_attention',head_revision:head.head_revision,governance_status:eligibility.referenceable?'governed':'needs_reference_review'};
}
async function isVersionReferenceable(db, versionId) {
  if(typeof db.getConnection==='function')return require('./dataMapHandoffControl').readSnapshot(db,c=>isVersionReferenceable(c,versionId));
  const control=await readControl(db);if(control.cutover_state!=='controlled')throw failure('HANDOFF_MAINTENANCE',503);
  const value=await fixedVersion(db,versionId);
  await assertReferenceable(db,{entityType:value.entity_type,entityId:value.entity_id,versionId:value.version_id});
  return true;
}
async function readSubject(db,{subjectKind,subjectId,view,versionRef=null}) {
  if(typeof db.getConnection==='function')return require('./dataMapHandoffControl').readSnapshot(db,connection=>readSubject(connection,{subjectKind,subjectId,view,versionRef}));
  if(['object','field'].includes(subjectKind))return readDefinition(db,{entityType:subjectKind,entityId:subjectId,view,versionId:versionRef});
  if(!['context','rule','authority','data_element'].includes(subjectKind))throw failure('HANDOFF_SUBJECT_INVALID',400);
  const control=await readControl(db);subjectId=reference(subjectId);
  if(view==='current'&&control.cutover_state!=='controlled')throw failure('HANDOFF_MAINTENANCE',503);
  if(view==='legacy_in_use')return readLegacy(db,{entityType:subjectKind,entityId:subjectId,versionId:versionRef});
  let publicationId=null;
  if(view==='current'){
    const [[h]]=await db.execute('SELECT effective_version_ref,CAST(publication_id AS CHAR) publication_id,availability FROM data_map_effective_heads WHERE subject_kind=? AND subject_id=? FOR SHARE',[subjectKind,subjectId]);
    if(!h||h.availability!=='active')return {subject_kind:subjectKind,subject_id:subjectId,view,availability:h?.availability||'unavailable',referenceable:false,new_reference_allowed:false,requires_attention:h?.availability==='withdrawn',current:null};
    versionRef=h.effective_version_ref;publicationId=h.publication_id;
  }else if(view!=='history'||!versionRef)throw failure('HANDOFF_CLIENT_UPGRADE_REQUIRED',409);
  const [[r]]=await db.execute(`SELECT i.payload_json,i.target_version_ref,CAST(i.publication_id AS CHAR) publication_id,p.manifest_json,p.manifest_digest,p.scope_mode,
    i.item_ref,i.target_kind,CAST(i.target_id AS CHAR) target_id,i.operation,i.produces_version,i.source_detail_versions_json
    FROM data_map_publication_items i JOIN data_map_publications p ON p.publication_id=i.publication_id
    WHERE i.target_kind=? AND i.target_id=? AND i.target_version_ref=? AND i.produces_version=1${publicationId?' AND i.publication_id=?':''} FOR SHARE`,[subjectKind,subjectId,versionRef,...(publicationId?[publicationId]:[])]);
  if(!r)throw failure('HANDOFF_VERSION_NOT_FOUND',404);
  const {payload,manifest}=verifiedItem(r);
  if(subjectKind==='data_element'){
    const [[element]]=await db.execute('SELECT element_id,definition_json,content_digest FROM data_map_data_element_versions WHERE element_version_id=? FOR SHARE',[versionRef]);
    if(!element||element.element_id!==subjectId||digest(parse(element.definition_json))!==element.content_digest||digest(payload.definition)!==element.content_digest)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
  }
  const eligibility=control.cutover_state==='controlled'?await referenceStatus(db,{subjectKind,subjectId,versionRef:r.target_version_ref,publicationId}):{referenceable:false,new_reference_allowed:false,requires_attention:false,producer_status:'unavailable',eligibility_status:'maintenance',publication_id:r.publication_id,scope_mode:r.scope_mode,reference_issues:[]};
  if(view==='current'&&eligibility.producer_status!=='active')return {subject_kind:subjectKind,subject_id:subjectId,view,...eligibility,availability:eligibility.producer_status==='withdrawn'?'withdrawn':'unavailable',current:null};
  if(view==='current'&&subjectKind==='context'){
    const [[source]]=await db.execute('SELECT CAST(d.current_version_id AS CHAR) current_version_id,v.status FROM process_design_versions v JOIN process_design_documents d ON d.id=v.document_id WHERE v.id=? FOR SHARE',[id(manifest.process_version_id)]);
    if(!source||source.status!=='published'||source.current_version_id!==String(manifest.process_version_id))return {subject_kind:subjectKind,subject_id:subjectId,view,availability:'source_upgrade_pending',referenceable:false,new_reference_allowed:false,requires_attention:true,current:null,version_ref:r.target_version_ref,publication_id:r.publication_id,last_published_definition:payload.definition,process_version_id:String(manifest.process_version_id),current_process_version_id:source?.current_version_id||null,reference_issues:[{code:'HANDOFF_SOURCE_UPGRADE_PENDING',process_version_id:String(manifest.process_version_id),current_process_version_id:source?.current_version_id||null}]};
    const repository=require('./processDataGovernanceRepository'),fixed=await repository.readFixedPublishedVersion(db,id(manifest.process_version_id));
    repository.versionDocument(fixed);
    if(fixed.content_hash!==manifest.source_hash)throw failure('HANDOFF_SOURCE_INTEGRITY_CONFLICT',409);
  }
  return {subject_kind:subjectKind,subject_id:subjectId,view,version_ref:r.target_version_ref,publication_id:r.publication_id,payload,...eligibility,availability:eligibility.referenceable?'active':eligibility.producer_status==='active'?'requires_attention':'unavailable'};
}
async function contextFields(db,{contextId,view,versionRef=null}){
  if(typeof db.getConnection==='function')return require('./dataMapHandoffControl').readSnapshot(db,connection=>contextFields(connection,{contextId,view,versionRef}));
  const context=await readSubject(db,{subjectKind:'context',subjectId:String(contextId),view,versionRef});
  if(context.current===null)return {context,items:[]};
  if(!context.publication_id)return {context,items:[]};
  const [items]=await db.execute(`SELECT p.manifest_json,p.manifest_digest,i.item_ref,i.target_kind,CAST(i.target_id AS CHAR) target_id,
    i.target_version_ref,i.operation,i.produces_version,i.payload_json,i.source_detail_versions_json
    FROM data_map_publication_items i JOIN data_map_publications p ON p.publication_id=i.publication_id
    WHERE i.publication_id=? AND i.target_kind='field' ORDER BY i.item_ref FOR SHARE`,[context.publication_id]);
  const values=[];for(const item of items){const {payload}=verifiedItem(item);const value=await fixedVersion(db,item.target_version_ref);
    if(value.entity_type!=='field'||value.entity_id!==item.target_id||digest(payload.definition)!==value.content_digest)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT',409);
    if(String(payload.context_id||value.base_snapshot.row.context_id)!==String(contextId))continue;
    const eligibility=view==='history'
      ? await readDefinition(db,{entityType:'field',entityId:value.entity_id,versionId:value.version_id,view:'history'})
      : await publicationEligibility(db,{entityType:'field',entityId:value.entity_id,versionId:value.version_id});
    values.push({...value,...eligibility,view,publication_id:context.publication_id,
      governance_status:view==='history'?'governed_history':eligibility.referenceable?'governed':'needs_reference_review',
      ...(view==='history'?{referenceable:false,new_reference_allowed:false}:{})});
  }
  return {context,items:values};
}
const guarded=operation=>async(...args)=>{try{return await operation(...args);}catch(error){if(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR','ER_PARSE_ERROR'].includes(error.code))throw failure('HANDOFF_SCHEMA_UNAVAILABLE',503);throw error;}};
module.exports = {fixedVersion:guarded(fixedVersion),readDefinition:guarded(readDefinition),readLegacy:guarded(readLegacy),readSubject:guarded(readSubject),contextFields:guarded(contextFields),publicationEligibility:guarded(publicationEligibility),assertReferenceable:guarded(assertReferenceable),isVersionReferenceable:guarded(isVersionReferenceable),referenceStatus:guarded(referenceStatus),verifiedItem};
