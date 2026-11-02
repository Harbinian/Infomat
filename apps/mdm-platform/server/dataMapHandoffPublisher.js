// Only the caller's locked transaction may construct versions and advance effective heads.
const {failure,newId,json,parse,digest,id}=require('./dataMapHandoffPolicy');
const {snapshot,lastId}=require('./dataMapDefinitionValues');
const {captureLegacy}=require('./dataMapHandoffCompatibility');
const {fixedVersion,readSubject}=require('./dataMapEffectiveReader');
const one=async(db,sql,args=[])=> (await db.execute(sql,args))[0][0]||null;
async function preserveBeforeProjection(db,item){
  if(!item.target_id||!['object','field'].includes(item.target_kind))return;
  const existing=await one(db,"SELECT COUNT(*) n FROM data_map_definition_versions WHERE entity_type=? AND entity_id=? AND source_kind='governance'",[item.target_kind,item.target_id]);
  if(Number(existing.n))return;
  const original=await snapshot(db,item.target_kind,item.target_id,true);
  await captureLegacy(db,{assetKind:item.target_kind,assetId:item.target_id,versionRef:'capture:'+digest(original),snapshot:original,originalStatus:original.row.status});
}
async function publish(db,{draft,revision,approval,evaluation,actor,control,requestId}){
  const {body,pkg,source,review,report}=evaluation;
  const publicationId=newId(),planned=new Map();
  const producing=body.items.filter(x=>x.operation!=='reuse');
  const versionItems=producing.filter(x=>['object','field'].includes(x.target_kind));
  const start=BigInt(control.next_definition_version_id),end=start+BigInt(versionItems.length);
  if(end>9223372036854775807n)throw failure('HANDOFF_VERSION_ID_EXHAUSTED');
  const max=await one(db,'SELECT CAST(COALESCE(MAX(version_id),0) AS CHAR) n FROM data_map_definition_versions');
  if(BigInt(max.n)>=start)throw failure('HANDOFF_VERSION_ALLOCATOR_DRIFT');
  let next=start;
  for(const item of body.items)planned.set(item.item_ref,{...item,target_id:item.target_id?String(item.target_id):null,target_version_ref:item.operation==='reuse'?String(item.target_version_ref):['object','field'].includes(item.target_kind)?String(next++):newId(),produces_version:item.operation==='reuse'?0:1});
  await db.execute('UPDATE data_map_governance_control SET next_definition_version_id=? WHERE control_id=1',[end.toString()]);
  // Stable identities are invisible to governed readers until this transaction publishes heads.
  for(const kind of ['object','context','data_element','field','rule','authority'])for(const item of planned.values())if(item.target_kind===kind){
    if(item.target_id)continue;
    if(kind==='object'){
      await db.execute("INSERT INTO data_map_objects(object_key,object_name_cn,description,owner_dept_id,status,source_type,created_by_person_id) VALUES(?,?,?,?,'draft','governance',?)",['obj_'+newId(),item.definition.name,item.definition.business_meaning,id(item.definition.owner_department_id),actor.personId]);item.target_id=await lastId(db);
    }else if(kind==='context'){
      await db.execute("INSERT INTO data_map_contexts(context_key,context_type,title,dept_id,status,created_by_person_id) VALUES(?,'process',?,?,'draft',?)",['ctx_'+newId(),item.definition.name,id(item.definition.department_id),actor.personId]);item.target_id=await lastId(db);
    }else if(kind==='field'){
      const object=planned.get(item.object_ref),context=planned.get(item.context_ref);
      if(!object?.target_id||!context?.target_id)throw failure('HANDOFF_ITEM_REFERENCE_INVALID');
      await db.execute("INSERT INTO data_map_fields(context_id,object_id,field_key,field_name_cn,business_definition,status,submitted_by_person_id) VALUES(?,?,?,?,?,'draft',?)",[context.target_id,object.target_id,'fld_'+newId(),item.definition.name,item.definition.business_meaning,actor.personId]);item.target_id=await lastId(db);
    }else {
      item.target_id=newId();
      if(kind==='data_element')await db.execute('INSERT INTO data_map_data_elements(element_id,created_at) VALUES(?,UTC_TIMESTAMP(3))',[item.target_id]);
    }
  }
  for(const item of planned.values()){
    const definition=structuredClone(item.definition);
    if(item.target_kind==='object'&&definition.unique_identifiers){
      for(const group of definition.unique_identifiers){
        if(group.field_item_refs){group.field_version_ids=group.field_item_refs.map(ref=>{
          const field=planned.get(ref);if(!field||field.target_kind!=='field'||field.object_ref!==item.item_ref)throw failure('HANDOFF_IDENTIFIER_REFERENCE_INVALID');return field.target_version_ref;
        });delete group.field_item_refs;}
        if(!Array.isArray(group.field_version_ids)||new Set(group.field_version_ids).size!==group.field_version_ids.length||!['single','composite'].includes(group.kind)||(group.kind==='single'?group.field_version_ids.length!==1:group.field_version_ids.length<2))throw failure('HANDOFF_IDENTIFIER_INVALID');
      }
    }
    const object=item.object_ref?planned.get(item.object_ref):null,context=item.context_ref?planned.get(item.context_ref):null,element=item.data_element_ref?planned.get(item.data_element_ref):null;
    item.payload={definition,basis:item.basis,evidence_refs:item.evidence_refs,authority:item.authority||[],
      ...(item.base_version_ref?{base_version_ref:item.base_version_ref}:{}),
      ...(object?{object_id:object.target_id,object_version_id:object.target_version_ref}:{}),
      ...(context?{context_id:context.target_id,context_version_ref:context.target_version_ref}:{}),
      ...(element?{data_element_version_ref:element.target_version_ref}:{}),
      process_version_id:source.id};
    item.source_detail_versions=[...new Set(item.source_detail_refs.map(ref=>review.detail_versions.find(d=>d.detail_ref===ref||d.detail_version_id===ref)?.detail_version_id))].sort();
    if(item.source_detail_versions.some(x=>!x))throw failure('HANDOFF_SOURCE_DETAIL_INVALID');
    if(item.operation==='reuse'&&['object','field'].includes(item.target_kind)){
      const fixed=await fixedVersion(db,item.target_version_ref);
      if(digest(definition)!==fixed.content_digest)throw failure('HANDOFF_REUSE_CONTENT_CHANGED');
      if(item.target_kind==='field' && (fixed.base_snapshot.row.context_id!==context?.target_id||fixed.object_version_id!==object?.target_version_ref))throw failure('HANDOFF_FIELD_PARENT_MISMATCH');
    }
    if(item.operation==='reuse'&&item.target_kind==='data_element'){
      const fixed=await readSubject(db,{subjectKind:'data_element',subjectId:item.target_id,view:'history',versionRef:item.target_version_ref});
      if(!fixed.referenceable||digest(definition)!==digest(fixed.payload.definition))throw failure('HANDOFF_REUSE_CONTENT_CHANGED');
    }
    if(item.target_kind==='field'){
      const identity=await one(db,'SELECT CAST(context_id AS CHAR) context_id,CAST(object_id AS CHAR) object_id FROM data_map_fields WHERE id=? FOR UPDATE',[item.target_id]);
      if(!identity||identity.context_id!==context?.target_id||identity.object_id&&identity.object_id!==object?.target_id)throw failure('HANDOFF_FIELD_CONTEXT_CHANGED');
      if(body.scope_mode==='historical'&&!identity.object_id)throw failure('HANDOFF_FIELD_PARENT_UNRESOLVED');
    }
  }
  for(const item of producing){
    const plannedItem=planned.get(item.item_ref);
    if(body.scope_mode==='current')await preserveBeforeProjection(db,item);
    if(body.scope_mode==='current'&&item.operation!=='reuse'){
      if(item.target_kind==='object')await db.execute("UPDATE data_map_objects SET object_name_cn=?,description=?,owner_dept_id=?,status='active',updated_by_person_id=? WHERE id=?",[item.definition.name,item.definition.business_meaning,id(item.definition.owner_department_id),actor.personId,plannedItem.target_id]);
      if(item.target_kind==='context')await db.execute("UPDATE data_map_contexts SET title=?,dept_id=?,status='active',updated_by_person_id=? WHERE id=?",[item.definition.name,id(item.definition.department_id),actor.personId,plannedItem.target_id]);
      if(item.target_kind==='field'){
        const current=await one(db,'SELECT CAST(context_id AS CHAR) context_id,CAST(object_id AS CHAR) object_id FROM data_map_fields WHERE id=? FOR UPDATE',[plannedItem.target_id]);
        if(current.context_id!==plannedItem.payload.context_id || current.object_id && current.object_id!==plannedItem.payload.object_id)throw failure('HANDOFF_FIELD_CONTEXT_CHANGED');
        await db.execute("UPDATE data_map_fields SET object_id=?,field_name_cn=?,business_definition=?,data_type=?,data_format=?,nullable=?,status='confirmed' WHERE id=?",[plannedItem.payload.object_id,item.definition.name,item.definition.business_meaning,item.definition.data_type,item.definition.data_format||null,item.definition.required?0:1,plannedItem.target_id]);
      }
    }
  }
  // Object JSON may refer forward to preallocated field IDs. Only SQL parent FKs are immediate.
  for(const kind of ['object','field'])for(const item of planned.values())if(item.target_kind===kind&&item.produces_version){
    const previous=item.base_version_ref?.startsWith('capture:')?null:item.base_version_ref||null;
    const row=await one(db,'SELECT COALESCE(MAX(version_no),0)+1 n FROM data_map_definition_versions WHERE entity_type=? AND entity_id=?',[kind,item.target_id]);
    const base=await snapshot(db,kind,item.target_id,true);
    await db.execute(`INSERT INTO data_map_definition_versions(version_id,entity_type,entity_id,version_no,object_version_id,supersedes_version_id,schema_version,definition_json,base_snapshot_json,content_digest,base_digest,digest_algorithm,source_kind,created_by_person_id,created_at)
      VALUES(?,?,?,?,?,?,'data-map-definition-v1',?,?,?,?,'sha256-canonical-json-v1','governance',?,UTC_TIMESTAMP(3))`,
      [item.target_version_ref,kind,item.target_id,Number(row.n),kind==='field'?item.payload.object_version_id:null,previous,json(item.payload.definition),json(base),digest(item.payload.definition),digest(base),actor.personId]);
  }
  for(const item of planned.values())if(item.target_kind==='object'&&item.produces_version){
    for(const group of item.payload.definition.unique_identifiers||[])for(const versionId of group.field_version_ids){
      const field=await fixedVersion(db,versionId);
      if(field.entity_type!=='field'||field.base_snapshot.row.object_id!==item.target_id||field.object_version_id!==item.target_version_ref)throw failure('HANDOFF_IDENTIFIER_PARENT_MISMATCH');
    }
  }
  const items=[...planned.values()].map(x=>({item_ref:x.item_ref,target_kind:x.target_kind,target_id:x.target_id,target_version_ref:x.target_version_ref,operation:x.operation,produces_version:x.produces_version,payload:x.payload,source_detail_versions:x.source_detail_versions}));
  const manifest={schema_version:'data-map-publication-v1',package_id:pkg.id,process_version_id:source.id,source_hash:source.content_hash,binding_id:revision.binding_id,scope_mode:body.scope_mode,handoff_revision_id:revision.revision_id,approval_id:approval.approval_id,
    restores_publication_id:body.restores_publication_id||null,...(body.restoration?{restoration:body.restoration,restoration_adjustments:body.restoration_adjustments||[]}:{}),items,dependency_manifest:report.dependency_manifest,impact_manifest:report.impact_manifest,actor:actor.qualificationSnapshot};
  await db.execute('INSERT INTO data_map_publications(publication_id,handoff_revision_id,approval_id,scope_mode,manifest_json,manifest_digest,request_id,published_at) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',[publicationId,revision.revision_id,approval.approval_id,body.scope_mode,json(manifest),digest(manifest),requestId]);
  for(const item of items){
    await db.execute('INSERT INTO data_map_publication_items(publication_id,item_ref,target_kind,target_id,target_version_ref,operation,produces_version,payload_json,source_detail_versions_json) VALUES(?,?,?,?,?,?,?,?,?)',[publicationId,item.item_ref,item.target_kind,item.target_id,item.target_version_ref,item.operation,item.produces_version,json(item.payload),json(item.source_detail_versions)]);
    if(item.target_kind==='data_element'&&item.produces_version)await db.execute('INSERT INTO data_map_data_element_versions(element_version_id,element_id,definition_json,content_digest,publication_id,created_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3))',[item.target_version_ref,item.target_id,json(item.payload.definition),digest(item.payload.definition),publicationId]);
    if(body.scope_mode==='current'&&item.produces_version)await db.execute(`INSERT INTO data_map_effective_heads(subject_kind,subject_id,effective_version_ref,publication_id,head_revision,availability) VALUES(?,?,?,?,1,'active')
      ON DUPLICATE KEY UPDATE effective_version_ref=VALUES(effective_version_ref),publication_id=VALUES(publication_id),head_revision=head_revision+1,availability='active'`,[item.target_kind,item.target_id,item.target_version_ref,publicationId]);
  }
  for(const item of items)if(item.target_kind==='field'&&item.produces_version)await db.execute('INSERT INTO data_map_field_element_bindings(binding_id,field_version_id,element_version_id,context_version_ref,basis,publication_id) VALUES(?,?,?,?,?,?)',[newId(),item.target_version_ref,item.payload.data_element_version_ref,item.payload.context_version_ref,item.payload.basis,publicationId]);
  await db.execute("INSERT INTO data_map_publication_events(publication_id,event_no,event_type,payload_json,request_id,created_at) VALUES(?,1,'published',?,?,UTC_TIMESTAMP(3))",[publicationId,json({manifest_digest:digest(manifest),actor:actor.qualificationSnapshot,scope_mode:body.scope_mode,actor_snapshot:{person_id:actor.personId,person_name:actor.personName||null,role_code:actor.roleCode}}),requestId]);
  await db.execute("UPDATE data_map_handoff_drafts SET state='published',active_slot=NULL WHERE handoff_id=?",[draft.handoff_id]);
  if(require('./terminologyGovernancePolicy').enabled()){
    const usages=require('./terminologyUsages'),from={target_type:'handoff_revision',target_id:revision.revision_id};
    // New data definitions keep exact version references and the original item
    // pointer; technical identities and the handoff source are never renamed.
    const state=await usages.inspect(db,{...from,source_digest:revision.content_digest},{required:true});
    for(const [index,item]of items.entries())if(item.produces_version&&['object','field'].includes(item.target_kind)){
      const prefix='/items/'+body.items.findIndex(x=>x.item_ref===item.item_ref)+'/definition';
      const refs=state.items.filter(x=>x.location===prefix||x.location.startsWith(prefix+'/'));
      await usages.pin(db,from,{target_type:'data_definition',target_id:item.target_version_ref,source_digest:digest(item.payload.definition)},actor.personId,{items:refs});
    }
    await db.execute('UPDATE tg_usage_heads SET fixed=1 WHERE target_type=? AND target_id=?',['handoff_revision',revision.revision_id]);
  }
  return {business_outcome:body.scope_mode==='current'?'published_current':'published_historical',publication_id:publicationId,manifest_digest:digest(manifest),scope_mode:body.scope_mode,items};
}
module.exports={publish};
