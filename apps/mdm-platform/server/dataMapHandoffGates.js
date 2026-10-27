const {failure,verify,digest,parse,id,json}=require('./dataMapHandoffPolicy');
const {binding,loadFixedSource}=require('./dataMapHandoffBindings');
const {fixedVersion,assertReferenceable,readSubject}=require('./dataMapEffectiveReader');
const one=async(db,sql,args=[])=> (await db.execute(sql,args))[0][0]||null;
async function packageSource(db,packageId){
  const pkg=await one(db,`SELECT p.*,CAST(p.id AS CHAR) id,CAST(p.process_version_id AS CHAR) process_version_id,
    CAST(p.owning_department_id AS CHAR) owning_department_id,CAST(p.source_document_id AS CHAR) source_document_id,
    CAST(p.created_by_person_id AS CHAR) created_by_person_id,CAST(p.updated_by_person_id AS CHAR) updated_by_person_id
    FROM process_data_governance_work_packages p WHERE p.id=? FOR UPDATE`,[id(packageId)]);
  if(!pkg)throw failure('HANDOFF_PACKAGE_NOT_FOUND',404);
  return {pkg,source:await loadFixedSource(db,pkg)};
}
async function dependencies(db,body,review,{handoffId=null,bindingId=null}={}){
  // Request registration locks this assignment before directed conflicts/facts.
  // Gate evaluation must hold the same anchor first, including read-side gates.
  await db.execute("SELECT id FROM process_governance_responsibilities WHERE target_type='work_package' AND target_id=CAST(? AS SIGNED) AND assignment_kind='steward' FOR UPDATE",[id(review.package_id)]);
  const targets=[], changedVersions=[];
  const [prior]=await db.execute("SELECT publication_id,manifest_digest FROM data_map_publications WHERE JSON_UNQUOTE(JSON_EXTRACT(manifest_json,'$.package_id'))=? ORDER BY publication_id FOR SHARE",[String(review.package_id)]);
  const impacts=prior.map(row=>({reference_key:'prior_package_publication:'+row.publication_id,reference_kind:'prior_package_publication',...row}));
  for(const item of body.items){
    if(!item.target_id){targets.push({item_ref:item.item_ref,target_kind:item.target_kind,target_id:null,expected_absent:true});continue;}
    const head=await one(db,'SELECT effective_version_ref,publication_id,head_revision,availability FROM data_map_effective_heads WHERE subject_kind=? AND subject_id=? FOR SHARE',[item.target_kind,String(item.target_id)]);
    let base=null,versions=[];
    if(['object','field','context'].includes(item.target_kind)){
      const table={object:'data_map_objects',field:'data_map_fields',context:'data_map_contexts'}[item.target_kind];
      if(!await one(db,'SELECT id FROM '+table+' WHERE id=? FOR SHARE',[id(item.target_id)]))throw failure('HANDOFF_TARGET_NOT_FOUND',404);
    }
    if(['object','field'].includes(item.target_kind)){
      if(item.base_version_ref?.startsWith('capture:')){
        const legacy=await one(db,'SELECT snapshot_json,snapshot_digest FROM data_map_legacy_registry WHERE asset_kind=? AND asset_id=? AND version_ref=? FOR SHARE',[item.target_kind,String(item.target_id),item.base_version_ref]);
        if(!legacy||item.base_version_ref!=='capture:'+legacy.snapshot_digest)throw failure('HANDOFF_REFERENCE_MISMATCH');
        verify(parse(legacy.snapshot_json),legacy.snapshot_digest);base={legacy_version_ref:item.base_version_ref,snapshot_digest:legacy.snapshot_digest};
      }else if(item.base_version_ref){const v=await fixedVersion(db,item.base_version_ref);if(v.entity_id!==String(item.target_id)||v.entity_type!==item.target_kind)throw failure('HANDOFF_REFERENCE_MISMATCH');base={version_id:v.version_id,content_digest:v.content_digest,base_digest:v.base_digest};}
      [versions]=await db.execute('SELECT CAST(version_id AS CHAR) version_id,version_no,content_digest FROM data_map_definition_versions WHERE entity_type=? AND entity_id=? ORDER BY version_id FOR SHARE',[item.target_kind,id(item.target_id)]);
    }else if(item.target_kind==='data_element'){
      [versions]=await db.execute('SELECT element_version_id version_id,content_digest FROM data_map_data_element_versions WHERE element_id=? ORDER BY element_version_id FOR SHARE',[item.target_id]);
      if(item.base_version_ref){const fixed=versions.find(v=>v.version_id===item.base_version_ref);if(!fixed)throw failure('HANDOFF_REFERENCE_MISMATCH');base=fixed;}
    }else{
      [versions]=await db.execute('SELECT target_version_ref version_id,publication_id FROM data_map_publication_items WHERE target_kind=? AND target_id=? AND produces_version=1 ORDER BY target_version_ref FOR SHARE',[item.target_kind,item.target_id]);
      if(['rule','authority'].includes(item.target_kind)&&!versions.length)throw failure('HANDOFF_TARGET_NOT_FOUND',404);
    }
    targets.push({item_ref:item.item_ref,target_kind:item.target_kind,target_id:String(item.target_id),head,base,versions});
    if(item.operation!=='reuse')for(const v of versions)changedVersions.push({target_kind:item.target_kind,target_id:String(item.target_id),target_version_ref:v.version_id});
  }
  impacts.push(...await require('./dataMapHandoffImpact').referencesToVersions(db,changedVersions));
  const [conflictRows]=await db.execute('SELECT conflict_id,revision_no,state,payload_json FROM data_map_handoff_conflicts WHERE package_id=? ORDER BY conflict_id FOR SHARE',[review.package_id]);
  const conflicts=[];
  for(const row of conflictRows){
    const current=await require('./dataMapHandoffConflict').load(db,row.conflict_id);
    conflicts.push({conflict_id:current.conflict_id,revision_no:Number(current.revision_no),state:current.state,payload_json:current.snapshot,
      applicability:handoffId&&current.handoff_id!==handoffId?'historical_handoff':'current',
      history_complete:current.history_complete,compatibility:current.compatibility});
  }
  const [facts]=await db.execute(`SELECT f.fact_id,f.fact_version_id,f.revision_no,f.snapshot_json,f.snapshot_digest
    FROM process_data_governance_fact_versions f JOIN (SELECT fact_id,MAX(revision_no) revision_no FROM process_data_governance_fact_versions WHERE package_id=? GROUP BY fact_id) h
    ON f.fact_id=h.fact_id AND f.revision_no=h.revision_no ORDER BY f.fact_id FOR SHARE`,[review.package_id]);
  const [corrections]=await db.execute('SELECT correction_id,current_revision,state,replaces_binding_id FROM process_data_governance_corrections WHERE package_id=? ORDER BY correction_id FOR SHARE',[review.package_id]);
  const restoration=await require('./dataMapRestoration').validate(db,body,{packageId:review.package_id});
  const sourceUpgrade=await require('./dataMapSourceUpgrade').dependency(db,{handoffId,body,bindingId,packageId:review.package_id});
  return {targets,impacts:[...new Map(impacts.map(x=>[x.reference_key,x])).values()].sort((a,b)=>a.reference_key.localeCompare(b.reference_key)),conflicts,facts:facts.map(({snapshot_json,...x})=>{
    const snapshot=verify(parse(snapshot_json),x.snapshot_digest),current=conflicts.find(c=>c.conflict_id===snapshot.conflict_id);
    return {...x,snapshot,...(snapshot.parent_kind==='handoff_conflict'?{applicability:current?.applicability==='historical_handoff'?'historical_handoff':current?.history_complete&&current.payload_json.round_id!==snapshot.round_id?'superseded_round':'current'}:{})};
  }),corrections,...(restoration?{restoration}:{}),...(sourceUpgrade?{source_upgrade:sourceUpgrade}:{})};
}
function hasText(value){return typeof value==='string'&&value.trim().length>0;}
function evidence(value){return Array.isArray(value)&&value.length>0&&value.every(hasText);}
async function evaluate(db,{draft,revision,phase='check',approvalProvided=false}){
  const body=require('./dataMapHandoffPolicy').snapshot(verify(parse(revision.snapshot_json),revision.content_digest));
  const {pkg,source}=await packageSource(db,draft.package_id);
  const bound=await binding(db,revision.binding_id,pkg.id);const review=bound.snapshot;
  await require('./dataMapRestoration').validate(db,body,{packageId:pkg.id,handoffId:draft.handoff_id,requireEvent:true});
  const head=await one(db,'SELECT binding_id,head_revision FROM data_map_handoff_binding_heads WHERE package_id=? FOR SHARE',[pkg.id]);
  const current=source.status==='published';
  const issues=[[],[],[],[],[]];
  if(pkg.status!=='completed'||head?.binding_id!==bound.binding_id)issues[0].push('REVIEW_BINDING_STALE');
  if(body.scope_mode==='current'){
    const [versions]=await db.execute("SELECT CAST(id AS CHAR) id FROM process_design_versions WHERE document_id=? AND status='published' ORDER BY id FOR SHARE",[source.document_id]);
    const document=await one(db,'SELECT CAST(current_version_id AS CHAR) id FROM process_design_documents WHERE id=? FOR SHARE',[source.document_id]);
    if(!current||versions.length!==1||versions[0].id!==source.id||document?.id!==source.id)issues[0].push('SOURCE_SCOPE_STALE');
  }
  const allDetails=review.detail_versions||[];const details=new Map(allDetails.flatMap(d=>[[d.detail_ref,d],[d.detail_version_id,d]]));
  for(const d of allDetails){
    const mapped=body.items.filter(item=>item.source_detail_refs.some(ref=>details.get(ref)?.detail_id===d.detail_id));
    const disposition=body.dispositions.find(x=>x.detail_ref===d.detail_ref);
    if(d.status==='confirmed'){
      if(!mapped.length||!hasText(d.governance?.basis))issues[1].push('DETAIL_UNMAPPED:'+d.detail_ref);
      const primary={data_object_identity:'object',critical_field:'field',data_flow:'context',lifecycle_rule:'rule'}[d.detail_type];
      if(!primary||!mapped.some(item=>item.target_kind===primary))issues[1].push('DETAIL_TARGET_KIND_INVALID:'+d.detail_ref);
    }else if(['not_applicable','terminated'].includes(d.status)){
      if(!disposition||disposition.operation!==d.status||!hasText(disposition.basis)||mapped.length)issues[1].push('DISPOSITION_INVALID:'+d.detail_ref);
    }else issues[1].push('DETAIL_UNCONFIRMED:'+d.detail_ref);
  }
  if(!allDetails.length)issues[1].push('DETAILS_REQUIRED');
  const checkedDepartments=new Map();
  if((review.facts||[]).some(f=>!['closed','cancelled'].includes(f.status)))issues[1].push('FACT_NOT_CLOSED');
  for(const item of body.items){
    if(!item.source_detail_refs.length||item.source_detail_refs.some(ref=>!details.has(ref)||details.get(ref).status!=='confirmed'))issues[1].push('SOURCE_DETAIL_INVALID:'+item.item_ref);
    if(!hasText(item.basis)||!evidence(item.evidence_refs)||!hasText(item.definition.name))issues[2].push('DEFINITION_INCOMPLETE:'+item.item_ref);
    if(['object','field','data_element'].includes(item.target_kind)){
      if(!hasText(item.definition.business_meaning)||!Array.isArray(item.authority)||!item.authority.length||item.authority.some(a=>!hasText(a.attribute_ref)||!hasText(a.basis)||!evidence(a.evidence_refs)||(a.not_applicable!==undefined&&typeof a.not_applicable!=='boolean')||(a.not_applicable!==true&&(!hasText(a.sor_system_ref)||!a.manager_department_id))))issues[2].push('AUTHORITY_INCOMPLETE:'+item.item_ref);
      if(item.operation!=='create'&&!item.target_id)issues[2].push('TARGET_REQUIRED:'+item.item_ref);
      if(item.operation==='modify'&&!item.base_version_ref)issues[2].push('BASE_REQUIRED:'+item.item_ref);
    }
    if(item.target_kind==='object'&&!item.definition.owner_department_id)issues[2].push('OWNER_REQUIRED:'+item.item_ref);
    if(item.target_kind==='field'&&(!item.object_ref||!item.context_ref||!item.data_element_ref||!hasText(item.definition.data_type)||typeof item.definition.required!=='boolean'))issues[2].push('FIELD_CONTEXT_REQUIRED:'+item.item_ref);
    if(item.target_kind==='context'&&(!item.definition.department_id||!hasText(item.definition.purpose)||!Array.isArray(item.definition.operations)||!item.definition.operations.length))issues[2].push('CONTEXT_INCOMPLETE:'+item.item_ref);
    if(item.target_kind==='rule'&&(!item.context_ref||!hasText(item.definition.stage)||!hasText(item.definition.operation)||!hasText(item.definition.trigger)||!item.definition.responsible_department_id))issues[2].push('LIFECYCLE_INCOMPLETE:'+item.item_ref);
    if(item.operation==='reuse'&&['context','rule','authority'].includes(item.target_kind))issues[2].push('CONTEXT_REQUIRES_NEW_RELATION:'+item.item_ref);
    const departments=[item.definition.owner_department_id,item.definition.department_id,item.definition.responsible_department_id,...(item.authority||[]).map(a=>a.manager_department_id)].filter(Boolean);
    for(const departmentId of departments){const key=id(departmentId);if(!checkedDepartments.has(key))checkedDepartments.set(key,await one(db,"SELECT id FROM departments WHERE id=? AND status='active' FOR SHARE",[key]));if(!checkedDepartments.get(key))issues[2].push('DEPARTMENT_UNAVAILABLE:'+item.item_ref);}
    if(item.operation==='reuse'){
      try{if(['object','field'].includes(item.target_kind))await assertReferenceable(db,{entityType:item.target_kind,entityId:item.target_id,versionId:item.target_version_ref,scopeMode:'current'});
      else {
        const fixed=await readSubject(db,{subjectKind:item.target_kind,subjectId:item.target_id,view:'history',versionRef:item.target_version_ref});
        if(!fixed.referenceable)throw failure('HANDOFF_REFERENCE_UNAVAILABLE');
        if(digest(fixed.payload.definition)!==digest(item.definition))throw failure('HANDOFF_REUSE_CONTENT_CHANGED');
      }}catch(error){if(error.code?.startsWith('HANDOFF_'))issues[2].push(error.code+':'+item.item_ref);else throw error;}
    }
  }
  const deps=await dependencies(db,body,review,{handoffId:draft.handoff_id,bindingId:bound.binding_id});
  if(deps.source_upgrade)issues[3].push(...deps.source_upgrade.issues);
  for(const target of deps.targets){const item=body.items.find(x=>x.item_ref===target.item_ref);if(body.scope_mode==='current'&&item.operation==='modify'&&target.head?.availability==='active'&&target.head.effective_version_ref!==item.base_version_ref)issues[3].push('BASE_HEAD_CHANGED:'+item.item_ref);}
  if(deps.facts.some(f=>!['superseded_round','historical_handoff'].includes(f.applicability)&&!['closed','cancelled'].includes(f.snapshot.status)))issues[1].push('CURRENT_FACT_NOT_CLOSED');
  if(deps.corrections.some(c=>c.state!=='reviewed'))issues[1].push('CURRENT_CORRECTION_NOT_REVIEWED');
  for(const conflict of deps.conflicts){
    if(conflict.applicability==='historical_handoff'){
      if(!conflict.history_complete||conflict.state!=='verified')issues[3].push('HISTORICAL_CONFLICT_RECHECK_REQUIRED:'+conflict.conflict_id);
      continue;
    }
    if(conflict.state!=='verified')issues[3].push('CONFLICT_OPEN:'+conflict.conflict_id);
    else {
      const current=await require('./dataMapHandoffConflict').load(db,conflict.conflict_id);
      const checked=await require('./dataMapHandoffConflict').inspectVerification(db,current,revision);
      issues[3].push(...checked.issues.map(issue=>issue+':'+conflict.conflict_id));
    }
  }
  for(const impact of deps.impacts.filter(x=>x.reference_kind!=='schema_not_installed')){const disposition=(body.impact_dispositions||[]).find(x=>x.reference_key===impact.reference_key);if(!disposition||!hasText(disposition.basis)||!evidence(disposition.evidence_refs)||!['compatible_fixed_reference','addressed'].includes(disposition.decision))issues[3].push('IMPACT_UNRESOLVED:'+impact.reference_key);}
  if(digest(deps)!==digest(parse(revision.dependency_manifest_json)))issues[3].push('DEPENDENCIES_CHANGED');
  if(phase==='publish'&&!approvalProvided)issues[4].push('APPROVAL_REQUIRED');
  let terminology=null;
  if(require('./terminologyGovernancePolicy').enabled()){
    const usages=require('./terminologyUsages');
    const target=await usages.loadTarget(db,{target_type:'handoff_revision',target_id:revision.revision_id},true);
    const checked=await usages.inspect(db,target,{required:true});
    terminology={revision_no:Number(checked.head?.revision_no||0),source_digest:target.source_digest,items:checked.items,findings:checked.findings};
    issues[3].push(...checked.findings.map(f=>'TERMINOLOGY_'+f.code+(f.location?':'+f.location:'')));
  }
  const report={scope_mode:body.scope_mode,process_version_id:source.id,binding_id:bound.binding_id,content_digest:revision.content_digest,
    dependency_manifest:deps,impact_manifest:deps.impacts,
    gates:issues.map((list,i)=>({gate:i+1,status:list.length?'blocked':i===4&&phase==='check'?'pending':'pass',issues:list})),
    ready_for_approval:issues.slice(0,4).every(x=>!x.length),publishable:phase==='publish'&&issues.every(x=>!x.length)};
  if(terminology)report.terminology_review_url='/app/terms?target_type=handoff_revision&target_id='+encodeURIComponent(revision.revision_id);
  report.binding_digest=digest({source_hash:source.content_hash,source_status:source.status,binding_digest:bound.binding_digest,scope_mode:body.scope_mode,content_digest:revision.content_digest,dependencies:deps,...(terminology?{terminology}:{})});
  return {report,body,pkg,source,review};
}
module.exports={packageSource,dependencies,evaluate};
