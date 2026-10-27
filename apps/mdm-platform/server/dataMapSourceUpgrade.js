// Q9 reads fixed sources and records evidence in the caller's transaction.
// It never creates packages, copies conclusions, confirms facts or approves.
const {failure,id,uuid,digest,json,parse,newId,verify}=require('./dataMapHandoffPolicy');
const {loadFixedSource,binding}=require('./dataMapHandoffBindings');
const native=require('./processDataGovernance');
const {fixedSourcePresentation}=require('./dataMapHandoffPresentation');
const CONTRACT='data-map-source-upgrade-v1';
const one=async(db,sql,args=[])=>(await db.execute(sql,args))[0][0]||null;
const rows=async(db,sql,args=[])=>(await db.execute(sql,args))[0];
const text=x=>typeof x==='string'&&x.trim().length>0;
const normalized=x=>JSON.parse(json(x));
function proof(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['basis','evidence_refs'].includes(k))&&text(value.basis)&&Array.isArray(value.evidence_refs)&&value.evidence_refs.length>0&&value.evidence_refs.every(text);}
function keys(value,allowed,code='HANDOFF_UPGRADE_PAYLOAD_INVALID'){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw failure(code,422);
}
function strings(value,result=new Set()){
  if(typeof value==='string')result.add(value);
  else if(Array.isArray(value))value.forEach(x=>strings(x,result));
  else if(value&&typeof value==='object')Object.values(value).forEach(x=>strings(x,result));
  return result;
}
function semanticIndex(document){
  const candidates=native.buildGovernanceCandidates(document),objects=new Map((document.data_objects||[]).map(x=>[x.data_ref,x]));
  if(objects.size!==(document.data_objects||[]).length)throw failure('HANDOFF_UPGRADE_SOURCE_IDENTIFIERS_INVALID');
  const behaviors=document.behaviors||[],relations=document.flow_relations||[];
  const global=Object.fromEntries(Object.entries(document).filter(([key])=>!['data_objects','behaviors','flow_relations'].includes(key)));
  // These two export fields identify the downloaded file, not business facts.
  // All other metadata, including department/compiler, stays conservative.
  if(global.export_meta)global.export_meta=Object.fromEntries(Object.entries(global.export_meta).filter(([key])=>!['package_ref','exported_at'].includes(key)));
  const result=new Map();
  for(const candidate of candidates){
    if(result.has(candidate.detail_ref))throw failure('HANDOFF_UPGRADE_SOURCE_IDENTIFIERS_INVALID');
    const object=objects.get(candidate.parent_source_ref||candidate.source_ref);
    // The complete parent object and its connected behavior/relation closure are
    // deliberate conservative dependencies. Structural candidate hashes omit
    // business definitions, required flags and responsibility/trigger content.
    const refs=strings(object||document),connectedBehaviors=new Map(),connectedRelations=new Map();
    let changed=true;
    while(changed){changed=false;
      for(let index=0;index<behaviors.length;index++){
        const item=behaviors[index];if(connectedBehaviors.has(index)||!refs.has(item.behavior_ref))continue;
        connectedBehaviors.set(index,item);strings(item,refs);changed=true;
      }
      for(let index=0;index<relations.length;index++){
        const item=relations[index];if(connectedRelations.has(index)||![...strings(item)].some(x=>refs.has(x)))continue;
        connectedRelations.set(index,item);strings(item,refs);changed=true;
      }
    }
    const projection={global,object:object||null,missing_scope:object?null:document,
      behaviors:[...connectedBehaviors.values()].sort((a,b)=>digest(a).localeCompare(digest(b))),
      flow_relations:[...connectedRelations.values()].sort((a,b)=>digest(a).localeCompare(digest(b))),candidate_ref:candidate.detail_ref};
    result.set(candidate.detail_ref,{detail_ref:candidate.detail_ref,detail_type:candidate.detail_type,source_ref:candidate.source_ref,
      semantic_digest:digest(projection)});
  }
  return result;
}
async function packageSource(db,packageId){
  const pkg=await one(db,`SELECT *,CAST(id AS CHAR) id,CAST(process_version_id AS CHAR) process_version_id,CAST(source_document_id AS CHAR) source_document_id
    FROM process_data_governance_work_packages WHERE id=? FOR SHARE`,[id(packageId)]);
  if(!pkg)throw failure('HANDOFF_PACKAGE_NOT_FOUND',404);
  const source=await loadFixedSource(db,pkg);return {pkg,source,document:parse(source.process_content_json)};
}
async function versionSource(db,versionId){
  const version=await one(db,'SELECT *,CAST(id AS CHAR) id,CAST(document_id AS CHAR) document_id FROM process_design_versions WHERE id=? FOR SHARE',[id(versionId)]);
  if(!version)throw failure('HANDOFF_SOURCE_NOT_FIXED');
  const source=await loadFixedSource(db,{process_version_id:version.id,source_content_hash:version.content_hash});
  return {source,document:parse(source.process_content_json)};
}
async function currentSource(db,documentId){
  const document=await one(db,'SELECT CAST(id AS CHAR) id,CAST(current_version_id AS CHAR) current_version_id,process_ref FROM process_design_documents WHERE id=? FOR SHARE',[id(documentId)]);
  const published=await rows(db,"SELECT CAST(id AS CHAR) id FROM process_design_versions WHERE document_id=? AND status='published' ORDER BY id FOR SHARE",[id(documentId)]);
  if(!document?.current_version_id||published.length!==1||published[0].id!==document.current_version_id)throw failure('HANDOFF_UPGRADE_CURRENT_SOURCE_AMBIGUOUS');
  return {...await versionSource(db,document.current_version_id),master:document};
}
async function compare(db,{sourcePackageId,targetVersionId,requireCurrent=true}){
  const old=await packageSource(db,sourcePackageId),next=await versionSource(db,targetVersionId);
  const master=await one(db,'SELECT process_ref FROM process_design_documents WHERE id=? FOR SHARE',[next.source.document_id]);
  if(old.source.document_id!==next.source.document_id||old.document.process?.process_ref!==next.document.process?.process_ref||
      old.document.process?.process_ref!==master?.process_ref)throw failure('HANDOFF_UPGRADE_PROCESS_MISMATCH');
  if(old.source.id===next.source.id)throw failure('HANDOFF_UPGRADE_DISTINCT_VERSION_REQUIRED',422);
  if(requireCurrent&&(await currentSource(db,next.source.document_id)).source.id!==next.source.id)throw failure('HANDOFF_UPGRADE_TARGET_NOT_CURRENT');
  const oldIndex=semanticIndex(old.document),nextIndex=semanticIndex(next.document),refs=[...new Set([...oldIndex.keys(),...nextIndex.keys()])].sort();
  const changes=refs.map(ref=>{
    const before=oldIndex.get(ref),after=nextIndex.get(ref);
    return {detail_ref:ref,detail_type:after?.detail_type||before.detail_type,change_kind:!before?'added':!after?'deleted':before.semantic_digest===after.semantic_digest?'unchanged':'modified',
      previous_semantic_digest:before?.semantic_digest||null,target_semantic_digest:after?.semantic_digest||null};
  });
  const targetPackage=await one(db,'SELECT CAST(id AS CHAR) id,status FROM process_data_governance_work_packages WHERE process_version_id=? FOR SHARE',[next.source.id]);
  const comparison={contract_version:CONTRACT,source_package_id:old.pkg.id,source_process_version_id:old.source.id,target_process_version_id:next.source.id,
    source_document_id:old.source.document_id,process_ref:master.process_ref,source_hash:old.source.content_hash,target_hash:next.source.content_hash,
    source_schema_version:old.source.schema_version,target_schema_version:next.source.schema_version,changes};
  return {...comparison,comparison_digest:digest(comparison),target_package_id:targetPackage?.id||null,
    target_package_status:targetPackage?.status||null,counts:Object.fromEntries(['added','modified','deleted','unchanged'].map(k=>[k,changes.filter(x=>x.change_kind===k).length])),
    automatic_package_creation:false,automatic_conclusion_reuse:false};
}
function selectedValue(governance,pointer){
  if(typeof pointer!=='string'||!pointer.startsWith('/')||pointer==='/'||pointer.split('/').some(x=>['__proto__','prototype','constructor'].includes(x)))throw failure('HANDOFF_UPGRADE_REUSE_SCOPE_INVALID',422);
  let value=governance;
  for(const token of pointer.slice(1).split('/')){
    if(/~(?![01])/u.test(token))throw failure('HANDOFF_UPGRADE_REUSE_SCOPE_INVALID',422);
    const key=token.replaceAll('~1','/').replaceAll('~0','~');
    if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))throw failure('HANDOFF_UPGRADE_REUSE_SCOPE_INVALID',422);
    value=value[key];
  }
  return normalized(value);
}
async function verifiedReview(db,bindingId,packageId){
  const value=await binding(db,uuid(bindingId),id(packageId)),s=value.snapshot;
  if(s.package_id!==id(packageId)||!Array.isArray(s.detail_versions)||!s.detail_versions.length||s.original_package_status!=='completed')throw failure('HANDOFF_UPGRADE_REVIEW_INVALID');
  for(const detail of s.detail_versions){
    const fixed=await one(db,'SELECT snapshot_json,snapshot_digest FROM process_data_governance_detail_versions WHERE detail_version_id=? FOR SHARE',[uuid(detail.detail_version_id)]);
    if(!fixed)throw failure('HANDOFF_UPGRADE_REVIEW_INVALID');
    const saved=verify(parse(fixed.snapshot_json),fixed.snapshot_digest),{detail_version_id,revision_no,...content}=detail;
    if(digest(saved)!==digest(content))throw failure('HANDOFF_UPGRADE_REVIEW_INVALID');
  }
  return value;
}
function reviewSource(value,comparison,side){
  if(value&&(value.snapshot.process_version_id!==comparison[side+'_process_version_id']||value.snapshot.source_schema_version!==comparison[side+'_schema_version']||
      value.snapshot.source_hash!==comparison[side+'_hash']||value.source_hash!==comparison[side+'_hash']))throw failure('HANDOFF_UPGRADE_REVIEW_INVALID');
}
async function assessments(db,handoffId){
  const events=await rows(db,"SELECT * FROM data_map_handoff_events WHERE handoff_id=? AND event_type='source_upgrade_assessed' FOR SHARE",[uuid(handoffId)]);
  const values=events.map(row=>{
    const payload=parse(row.payload_json),snapshot=payload.snapshot;
    if(!snapshot||payload.contract_version!==CONTRACT||digest(snapshot)!==payload.snapshot_digest||snapshot.handoff_id!==handoffId||snapshot.request_id!==row.request_id||
        digest(parse(row.actor_json))!==snapshot.actor_digest)throw failure('HANDOFF_UPGRADE_HISTORY_INVALID');
    return {event_id:row.event_id,...payload};
  }).sort((a,b)=>a.snapshot.assessment_no-b.snapshot.assessment_no);
  values.forEach((value,index)=>{
    const previous=values[index-1];
    if(value.snapshot.assessment_no!==index+1||value.snapshot.previous_event_id!==(previous?.event_id||null)||value.snapshot.previous_snapshot_digest!==(previous?.snapshot_digest||null))throw failure('HANDOFF_UPGRADE_HISTORY_INVALID');
  });
  // Validate every frozen upgrade reference without transferring and parsing
  // unrelated dependency manifests for each save/check/GET. The indexed
  // handoff range is still read under the caller's shared lock or MVCC snapshot.
  const frozen=await rows(db,`SELECT JSON_TYPE(dependency_manifest_json) manifest_type,
    JSON_EXTRACT(dependency_manifest_json,'$.source_upgrade') source_upgrade
    FROM data_map_handoff_revisions WHERE handoff_id=? AND
      (JSON_EXTRACT(dependency_manifest_json,'$.source_upgrade.event_id') IS NOT NULL OR JSON_TYPE(dependency_manifest_json)='NULL')
    ORDER BY revision_no FOR SHARE`,[handoffId]);
  for(const revision of frozen){
    if(revision.manifest_type==='NULL')throw failure('HANDOFF_UPGRADE_HISTORY_INVALID');
    const reference=parse(revision.source_upgrade);
    if(reference?.event_id&&!values.some(x=>x.event_id===reference.event_id&&x.snapshot_digest===reference.snapshot_digest))throw failure('HANDOFF_UPGRADE_HISTORY_INVALID');
  }
  return values;
}
async function record(db,{header,revision,input,actor,context}){
  keys(input,['request_id','expected_revision','source_package_id','source_binding_id','comparison_digest','basis','evidence_refs','decisions']);
  if(!proof({basis:input.basis,evidence_refs:input.evidence_refs})||!Array.isArray(input.decisions))throw failure('HANDOFF_UPGRADE_REVIEW_REQUIRED',422);
  const target=await packageSource(db,header.package_id),comparison=await compare(db,{sourcePackageId:input.source_package_id,targetVersionId:target.source.id,requireCurrent:parse(revision.snapshot_json).scope_mode==='current'});
  if(comparison.target_package_id!==header.package_id||comparison.comparison_digest!==input.comparison_digest)throw failure('HANDOFF_UPGRADE_COMPARISON_STALE');
  let old=null;
  if(input.source_binding_id)old=await verifiedReview(db,input.source_binding_id,input.source_package_id);
  else if(await one(db,'SELECT binding_id FROM process_data_governance_review_bindings WHERE package_id=? LIMIT 1 FOR SHARE',[id(input.source_package_id)]))throw failure('HANDOFF_UPGRADE_SOURCE_REVIEW_REQUIRED',422);
  const next=await verifiedReview(db,revision.binding_id,header.package_id),sourcePackage=(await packageSource(db,input.source_package_id)).pkg;
  reviewSource(old,comparison,'source');reviewSource(next,comparison,'target');
  const previous=await assessments(db,header.handoff_id),seen=new Set(),decisions=[];
  for(const item of input.decisions){
    keys(item,['detail_ref','change_kind','decision','source_detail_version_id','target_detail_version_id','reuse_scope','basis','evidence_refs','rechecks']);
    const change=comparison.changes.find(x=>x.detail_ref===item.detail_ref),before=old?.snapshot.detail_versions.find(x=>x.detail_ref===item.detail_ref),after=next.snapshot.detail_versions.find(x=>x.detail_ref===item.detail_ref);
    if(!change||seen.has(item.detail_ref)||change.change_kind!==item.change_kind||!proof({basis:item.basis,evidence_refs:item.evidence_refs}))throw failure('HANDOFF_UPGRADE_DECISION_INVALID',422);
    seen.add(item.detail_ref);
    if((before?before.detail_version_id!==item.source_detail_version_id:!!item.source_detail_version_id)||
        (change.change_kind==='deleted'?!!item.target_detail_version_id:!after||after.detail_version_id!==item.target_detail_version_id))throw failure('HANDOFF_UPGRADE_DETAIL_VERSION_MISMATCH');
    const allowed=change.change_kind==='unchanged'?(old&&before?['reference_and_recheck','recheck']:['recheck']):change.change_kind==='deleted'?['remove']:['recheck'];
    if(!allowed.includes(item.decision))throw failure('HANDOFF_UPGRADE_DECISION_INVALID',422);
    keys(item.rechecks,['facts','conclusions','shared_definitions','impact']);
    if(!['facts','conclusions','shared_definitions','impact'].every(k=>proof(item.rechecks[k])))throw failure('HANDOFF_UPGRADE_RECHECK_INCOMPLETE',422);
    const scope=item.reuse_scope||[];
    if(!Array.isArray(scope)||new Set(scope).size!==scope.length||(item.decision!=='reference_and_recheck'&&scope.length)||item.decision==='reference_and_recheck'&&!scope.length)throw failure('HANDOFF_UPGRADE_REUSE_SCOPE_INVALID',422);
    decisions.push({...normalized(item),reuse_scope:scope,reused_values:scope.map(pointer=>({pointer,value:selectedValue(before.governance,pointer)})),
      source_conclusion_digest:before?digest(before):null,target_conclusion_digest:after?digest(after):null});
  }
  if(seen.size!==comparison.changes.length)throw failure('HANDOFF_UPGRADE_DECISIONS_INCOMPLETE',422);
  const latest=previous.at(-1),snapshot={contract_version:CONTRACT,handoff_id:header.handoff_id,package_id:header.package_id,
    assessment_no:previous.length+1,previous_event_id:latest?.event_id||null,previous_snapshot_digest:latest?.snapshot_digest||null,
    assessed_revision_no:Number(header.current_revision)+1,content_digest:revision.content_digest,comparison,source_binding_id:old?.binding_id||null,source_binding_digest:old?.binding_digest||null,
    source_review_status:old?'fixed_review_evidence':'no_reusable_review',source_package_status:sourcePackage.status,
    target_binding_id:next.binding_id,target_binding_digest:next.binding_digest,source_facts_digest:old?digest(old.snapshot.facts||[]):null,target_facts_digest:digest(next.snapshot.facts||[]),
    decisions,basis:input.basis,evidence_refs:input.evidence_refs,request_id:context.request_id,actor_digest:digest(actor.qualificationSnapshot)};
  const payload={contract_version:CONTRACT,snapshot,snapshot_digest:digest(snapshot)},eventId=newId();
  await db.execute(`INSERT INTO data_map_handoff_events(event_id,handoff_id,event_type,payload_json,actor_json,request_id,created_at)
    VALUES(?,?,'source_upgrade_assessed',?,?,?,UTC_TIMESTAMP(3))`,[eventId,header.handoff_id,json(payload),json(actor.qualificationSnapshot),context.request_id]);
  return {event_id:eventId,...payload};
}
async function dependency(db,{handoffId,body,bindingId,packageId}){
  if(!handoffId)return null;
  const history=await assessments(db,handoffId),current=history.at(-1);
  if(!current){
    // Dedicated Q10 restorations preserve the exact package/source identity.
    // The restoration validator separately verifies their immutable relation.
    // Metadata is sufficient to decide whether an assessment is required.
    // Positive actions already validate the source in their existing gate;
    // source corruption must not prevent the explicit stop/revoke path.
    const target=await one(db,`SELECT CAST(p.id AS CHAR) package_id,CAST(v.id AS CHAR) process_version_id,CAST(v.document_id AS CHAR) document_id,v.status
      FROM process_data_governance_work_packages p JOIN process_design_versions v ON v.id=p.process_version_id WHERE p.id=? FOR SHARE`,[id(packageId)]);
    if(!target)return null;
    if(body.restores_publication_id){
      const original=await require('./dataMapPublicationLifecycle').inspectPublication(db,uuid(body.restores_publication_id));
      if(original.package_id===String(packageId)&&String(original.manifest.process_version_id)===target.process_version_id)return null;
    }
    if(target.status!=='published')return null;
    const predecessors=await rows(db,`SELECT CAST(p.id AS CHAR) package_id,CAST(p.process_version_id AS CHAR) process_version_id
      FROM process_data_governance_work_packages p JOIN process_design_versions v ON v.id=p.process_version_id
      WHERE v.document_id=? AND v.id<>? AND v.status='superseded' ORDER BY p.id FOR SHARE`,[target.document_id,target.process_version_id]);
    return predecessors.length?{required:true,status:'missing',source_package_candidates:predecessors,issues:['SOURCE_UPGRADE_ASSESSMENT_REQUIRED']}:null;
  }
  const saved=current.snapshot,issues=[];
  if(saved.package_id!==String(packageId)||saved.target_binding_id!==bindingId||saved.content_digest!==digest(body))issues.push('SOURCE_UPGRADE_REASSESSMENT_REQUIRED');
  let comparison;
  try{const target=await packageSource(db,packageId);comparison=await compare(db,{sourcePackageId:saved.comparison.source_package_id,targetVersionId:target.source.id,requireCurrent:body.scope_mode==='current'});}
  catch(error){
    const sourceProblems=new Set(['HANDOFF_CONTENT_INTEGRITY_CONFLICT','HANDOFF_SOURCE_DIGEST_MISMATCH','HANDOFF_SOURCE_NOT_FIXED','HANDOFF_SOURCE_UNSUPPORTED',
      'HANDOFF_UPGRADE_PROCESS_MISMATCH','HANDOFF_UPGRADE_CURRENT_SOURCE_AMBIGUOUS']);
    if(error.code!=='HANDOFF_UPGRADE_TARGET_NOT_CURRENT'&&!sourceProblems.has(error.code))throw error;
    return {event_id:current.event_id,snapshot_digest:current.snapshot_digest,source_binding_id:saved.source_binding_id,target_binding_id:saved.target_binding_id,
      comparison_digest:saved.comparison.comparison_digest,content_digest:saved.content_digest,issues:[...issues,error.code==='HANDOFF_UPGRADE_TARGET_NOT_CURRENT'?'SOURCE_UPGRADE_CURRENT_VERSION_CHANGED':'SOURCE_UPGRADE_SOURCE_INTEGRITY_BLOCKED']};}
  if(comparison.comparison_digest!==saved.comparison.comparison_digest)issues.push('SOURCE_UPGRADE_COMPARISON_CHANGED');
  const old=saved.source_binding_id?await verifiedReview(db,saved.source_binding_id,saved.comparison.source_package_id):null,next=await verifiedReview(db,bindingId,packageId);
  reviewSource(old,comparison,'source');reviewSource(next,comparison,'target');
  if((old?.binding_digest||null)!==saved.source_binding_digest||next.binding_digest!==saved.target_binding_digest||(old?digest(old.snapshot.facts||[]):null)!==saved.source_facts_digest||digest(next.snapshot.facts||[])!==saved.target_facts_digest)issues.push('SOURCE_UPGRADE_REVIEW_CHANGED');
  return {event_id:current.event_id,snapshot_digest:current.snapshot_digest,source_binding_id:saved.source_binding_id,target_binding_id:saved.target_binding_id,
    comparison_digest:comparison.comparison_digest,content_digest:saved.content_digest,issues};
}
async function prompts(db,{packageId=null,targetVersionId=null}={}){
  if(packageId){
    const old=await packageSource(db,packageId),next=targetVersionId?await versionSource(db,targetVersionId):await currentSource(db,old.source.document_id);
    return compare(db,{sourcePackageId:packageId,targetVersionId:next.source.id,requireCurrent:next.source.status==='published'});
  }
  if(targetVersionId)throw failure('HANDOFF_UPGRADE_SOURCE_PACKAGE_REQUIRED',422);
  const documents=await rows(db,"SELECT CAST(id AS CHAR) id,process_ref,CAST(current_version_id AS CHAR) current_version_id FROM process_design_documents WHERE current_version_id IS NOT NULL ORDER BY id FOR SHARE"),processes=[];
  for(const document of documents){
    let current;try{current=await currentSource(db,document.id);if(current.document.process?.process_ref!==document.process_ref)throw failure('HANDOFF_UPGRADE_PROCESS_MISMATCH');}catch(error){if(!error.statusCode)throw error;processes.push({document_id:document.id,process_ref:document.process_ref,current_process_version_id:document.current_version_id,source_integrity:'blocked',governance_status:'blocked',issue:error.code});continue;}
    const packages=await rows(db,`SELECT CAST(p.id AS CHAR) package_id,CAST(p.process_version_id AS CHAR) process_version_id,p.source_content_hash,p.status,
      v.document_title,v.edition,v.process_content_json,v.content_hash
      FROM process_data_governance_work_packages p JOIN process_design_versions v ON v.id=p.process_version_id WHERE v.document_id=? ORDER BY p.id FOR SHARE`,[document.id]);
    const pkg=packages.find(x=>x.process_version_id===current.source.id),publications=pkg?await rows(db,"SELECT publication_id FROM data_map_publications WHERE JSON_UNQUOTE(JSON_EXTRACT(manifest_json,'$.package_id'))=? ORDER BY publication_id FOR SHARE",[pkg.package_id]):[];
    let governed=false,handoffCompleted=false;
    for(const publication of publications){
      const value=await require('./dataMapPublicationLifecycle').inspectPublication(db,publication.publication_id);
      if(value.state!=='published'||value.manifest.scope_mode!=='current'||String(value.manifest.process_version_id)!==current.source.id)continue;
      handoffCompleted=true;let available=true;
      for(const item of value.items){
        const status=await require('./dataMapEffectiveReader').referenceStatus(db,{subjectKind:item.target_kind,subjectId:item.target_id,versionRef:item.target_version_ref,scopeMode:'current'});
        const head=await one(db,'SELECT effective_version_ref,availability FROM data_map_effective_heads WHERE subject_kind=? AND subject_id=? FOR SHARE',[item.target_kind,item.target_id]);
        if(!status.referenceable||head?.effective_version_ref!==item.target_version_ref||head.availability!=='active')available=false;
      }
      if(available)governed=true;
    }
    processes.push({document_id:document.id,process_ref:document.process_ref,current_process_version_id:current.source.id,current_source_hash:current.source.content_hash,...fixedSourcePresentation(current.source,current.source.content_hash),
      source_integrity:pkg&&pkg.source_content_hash!==current.source.content_hash?'blocked':'valid',governance_status:pkg&&pkg.source_content_hash!==current.source.content_hash?'blocked':governed?'governed':handoffCompleted?'requires_attention':'source_upgrade_pending',
      handoff_completed:handoffCompleted,availability:governed?'active':handoffCompleted?'requires_attention':'pending',
      work_package_id:pkg?.package_id||null,work_package_status:pkg?.status||null,historical_packages:packages.filter(x=>x.process_version_id!==current.source.id).map(x=>({package_id:x.package_id,process_version_id:x.process_version_id,source_content_hash:x.source_content_hash,status:x.status,scope_mode:'historical',...fixedSourcePresentation(x,x.source_content_hash)})),
      evaluation_required:packages.some(x=>x.process_version_id!==current.source.id)&&!governed,automatic_package_creation:false});
  }
  return {contract_version:CONTRACT,processes,automatic_package_creation:false,automatic_conclusion_reuse:false};
}
module.exports={CONTRACT,semanticIndex,compare,prompts,record,assessments,dependency};
