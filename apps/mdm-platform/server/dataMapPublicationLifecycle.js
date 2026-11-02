const {utcDateTimeColumns}=require('./governanceTimeProjection');
// Publication lifecycle uses only the caller's graph-locked transaction. Fixed
// bodies and existing reference facts survive withdrawal without reinterpretation.
const {failure, uuid, newId, json, parse, digest}=require('./dataMapHandoffPolicy');
const {referencesToVersions}=require('./dataMapHandoffImpact');
const {assertApprover}=require('./dataMapHandoffAuthority');
const one=async(db,sql,args=[])=>(await db.execute(sql,args))[0][0]||null;
const conflict=()=>failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT');
const shape=(value)=>value&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const kinds=['object','field','data_element','context','rule','authority'];
const operations={object:['create','modify','reuse'],field:['create','modify','reuse'],data_element:['create','modify','reuse'],context:['context_link'],rule:['rule'],authority:['authority']};
function decode(value){try{return parse(value);}catch{throw conflict();}}
function qualification(value){
  if(!shape(value)||!hash(value.qualification_digest)||digest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='qualification_digest')))!==value.qualification_digest)throw conflict();
  return value;
}
function canonicalItem(row){
  const item={item_ref:row.item_ref,target_kind:row.target_kind,target_id:String(row.target_id),target_version_ref:row.target_version_ref,
    operation:row.operation,produces_version:Number(row.produces_version),payload:decode(row.payload_json),source_detail_versions:decode(row.source_detail_versions_json)};
  if(!kinds.includes(item.target_kind)||!operations[item.target_kind].includes(item.operation)||![0,1].includes(item.produces_version)
    ||item.produces_version!==(item.operation==='reuse'?0:1)||!shape(item.payload)||!shape(item.payload.definition)
    ||!Array.isArray(item.source_detail_versions)||item.source_detail_versions.some(x=>typeof x!=='string'||!x)
    ||new Set(item.source_detail_versions).size!==item.source_detail_versions.length)throw conflict();
  return item;
}
function sameItem(manifest,row){
  if(!shape(manifest)||typeof manifest.target_id!=='string'||![0,1].includes(manifest.produces_version)
    ||digest(manifest)!==digest(row))throw conflict();
}
async function verifiedProducer(db,item){
  const [rows]=await db.execute(`SELECT i.*,p.manifest_json,p.manifest_digest FROM data_map_publication_items i
    JOIN data_map_publications p ON p.publication_id=i.publication_id
    WHERE i.target_kind=? AND i.target_id=? AND i.target_version_ref=? AND i.produces_version=1 FOR SHARE`,[item.target_kind,item.target_id,item.target_version_ref]);
  if(rows.length!==1)throw conflict();
  const origin=canonicalItem(rows[0]),manifest=decode(rows[0].manifest_json);
  if(!shape(manifest)||!Array.isArray(manifest.items)||digest(manifest)!==rows[0].manifest_digest)throw conflict();
  const matches=manifest.items.filter(x=>x.item_ref===origin.item_ref);if(matches.length!==1)throw conflict();sameItem(matches[0],origin);
  if(digest(origin.payload.definition)!==digest(item.payload.definition))throw conflict();
  return {...origin,publication_id:rows[0].publication_id};
}
async function fixedContent(db,item,publicationId){
  const origin=await verifiedProducer(db,item);
  if(item.produces_version&&origin.publication_id!==publicationId)throw conflict();
  let fixed={target_kind:item.target_kind,target_id:item.target_id,target_version_ref:item.target_version_ref,producer_publication_id:origin.publication_id,payload_digest:digest(origin.payload)};
  if(['object','field'].includes(item.target_kind)){
    const version=await require('./dataMapEffectiveReader').fixedVersion(db,item.target_version_ref);
    if(version.source_kind!=='governance'||version.entity_type!==item.target_kind||version.entity_id!==item.target_id
      ||String(version.base_snapshot?.row?.id)!==item.target_id||digest(item.payload.definition)!==version.content_digest)throw conflict();
    fixed={...fixed,content_digest:version.content_digest,base_digest:version.base_digest,object_version_id:version.object_version_id,
      supersedes_version_id:version.supersedes_version_id,version_no:version.version_no,schema_version:version.schema_version};
    if(item.target_kind==='field'){
      if(version.object_version_id!==item.payload.object_version_id||String(version.base_snapshot.row.context_id)!==item.payload.context_id)throw conflict();
      const [bindings]=await db.execute(`SELECT binding_id,CAST(field_version_id AS CHAR) field_version_id,element_version_id,context_version_ref,basis,publication_id
        FROM data_map_field_element_bindings WHERE field_version_id=? FOR SHARE`,[item.target_version_ref]);
      if(bindings.length!==1||bindings[0].publication_id!==origin.publication_id||bindings[0].element_version_id!==origin.payload.data_element_version_ref
        ||bindings[0].context_version_ref!==origin.payload.context_version_ref||bindings[0].basis!==origin.payload.basis)throw conflict();
      fixed.field_element_binding=bindings[0];
    }
  }else if(item.target_kind==='data_element'){
    const version=await one(db,'SELECT element_id,definition_json,content_digest,publication_id FROM data_map_data_element_versions WHERE element_version_id=? FOR SHARE',[item.target_version_ref]);
    if(!version||version.element_id!==item.target_id||version.publication_id!==origin.publication_id||digest(decode(version.definition_json))!==version.content_digest
      ||digest(item.payload.definition)!==version.content_digest)throw conflict();
    fixed.content_digest=version.content_digest;
  }
  return fixed;
}
async function inspectPublication(db,publicationId,{lock=true}={}){
  if(!db||typeof db.execute!=='function'||typeof db.getConnection==='function')throw failure('HANDOFF_TRANSACTION_REQUIRED',503);
  publicationId=uuid(publicationId);
  const suffix=lock?' FOR SHARE':'';
  const publication=await one(db,'SELECT publication_id,handoff_revision_id,approval_id,scope_mode,manifest_json,manifest_digest,request_id FROM data_map_publications WHERE publication_id=?'+suffix,[publicationId]);
  if(!publication)throw failure('HANDOFF_PUBLICATION_NOT_FOUND',404);
  const manifest=decode(publication.manifest_json);
  if(!shape(manifest)||manifest.schema_version!=='data-map-publication-v1'||!Array.isArray(manifest.items)||!manifest.items.length
    ||digest(manifest)!==publication.manifest_digest||manifest.handoff_revision_id!==publication.handoff_revision_id||manifest.approval_id!==publication.approval_id
    ||manifest.scope_mode!==publication.scope_mode||!['current','historical'].includes(publication.scope_mode)||typeof manifest.package_id!=='string'
    ||typeof manifest.process_version_id!=='string'||!hash(manifest.source_hash)||!shape(manifest.dependency_manifest)||!Array.isArray(manifest.impact_manifest))throw conflict();
  qualification(manifest.actor);
  const revision=await one(db,`SELECT r.revision_id,r.handoff_id,r.scope_mode,r.binding_id,r.snapshot_json,r.content_digest,r.dependency_manifest_json,
    CAST(d.package_id AS CHAR) package_id FROM data_map_handoff_revisions r JOIN data_map_handoff_drafts d ON d.handoff_id=r.handoff_id WHERE r.revision_id=?${suffix}`,[publication.handoff_revision_id]);
  if(!revision||revision.package_id!==manifest.package_id||revision.scope_mode!==manifest.scope_mode||revision.binding_id!==manifest.binding_id
    ||digest(decode(revision.snapshot_json))!==revision.content_digest||digest(decode(revision.dependency_manifest_json))!==digest(manifest.dependency_manifest))throw conflict();
  const approval=await one(db,'SELECT action,revision_id,publication_id,decision,binding_digest,actor_json FROM data_map_handoff_approvals WHERE approval_id=?'+suffix,[publication.approval_id]);
  if(!approval||approval.action!=='publish'||approval.revision_id!==publication.handoff_revision_id||approval.publication_id!==null||approval.decision!=='approved'||!hash(approval.binding_digest))throw conflict();
  qualification(decode(approval.actor_json));
  const binding=await one(db,'SELECT CAST(package_id AS CHAR) package_id,source_hash,snapshot_json,binding_digest FROM process_data_governance_review_bindings WHERE binding_id=?'+suffix,[revision.binding_id]);
  const review=binding&&decode(binding.snapshot_json);
  if(!binding||!shape(review)||binding.package_id!==manifest.package_id||review.package_id!==manifest.package_id||review.process_version_id!==manifest.process_version_id
    ||binding.source_hash!==manifest.source_hash||review.source_hash!==manifest.source_hash||digest(review)!==binding.binding_digest||!Array.isArray(review.detail_versions))throw conflict();
  const [rows]=await db.execute('SELECT * FROM data_map_publication_items WHERE publication_id=? ORDER BY item_ref'+suffix,[publicationId]);
  if(rows.length!==manifest.items.length)throw conflict();
  const unique=new Set(),targets=new Set(),items=[];
  for(const row of rows){
    const item=canonicalItem(row),matches=manifest.items.filter(x=>x.item_ref===item.item_ref),target=item.target_kind+':'+item.target_id;
    if(matches.length!==1||unique.has(item.item_ref)||targets.has(target))throw conflict();sameItem(matches[0],item);unique.add(item.item_ref);targets.add(target);items.push(item);
  }
  const body=decode(revision.snapshot_json);
  if(!shape(body)||body.schema_version!=='handoff-draft-v1'||body.scope_mode!==manifest.scope_mode
    ||(body.restores_publication_id||null)!==(manifest.restores_publication_id||null)
    ||digest(body.restoration||null)!==digest(manifest.restoration||null)
    ||digest(body.restoration_adjustments||[])!==digest(manifest.restoration_adjustments||[])
    ||!Array.isArray(body.items)||body.items.length!==items.length)throw conflict();
  for(const item of items){
    const candidates=body.items.filter(x=>x.item_ref===item.item_ref),original=candidates[0];
    if(candidates.length!==1||original.target_kind!==item.target_kind||original.operation!==item.operation
      ||(original.target_id&&original.target_id!==item.target_id)||(original.operation==='reuse'&&original.target_version_ref!==item.target_version_ref))throw conflict();
    const definition=structuredClone(original.definition);
    for(const group of item.target_kind==='object'?definition.unique_identifiers||[]:[]){
      if(group.field_item_refs){group.field_version_ids=group.field_item_refs.map(ref=>{const field=items.find(x=>x.item_ref===ref&&x.target_kind==='field');if(!field)throw conflict();return field.target_version_ref;});delete group.field_item_refs;}
    }
    const related=ref=>{if(!ref)return null;const found=items.find(x=>x.item_ref===ref);if(!found)throw conflict();return found;};
    const object=related(original.object_ref),context=related(original.context_ref),element=related(original.data_element_ref);
    const expected={definition,basis:original.basis,evidence_refs:original.evidence_refs,authority:original.authority||[],
      ...(original.base_version_ref?{base_version_ref:original.base_version_ref}:{}),...(object?{object_id:object.target_id,object_version_id:object.target_version_ref}:{}),
      ...(context?{context_id:context.target_id,context_version_ref:context.target_version_ref}:{}),...(element?{data_element_version_ref:element.target_version_ref}:{}),process_version_id:manifest.process_version_id};
    const expectedDetails=[...new Set(original.source_detail_refs.map(ref=>review.detail_versions.find(x=>x.detail_ref===ref||x.detail_version_id===ref)?.detail_version_id))].sort();
    if(expectedDetails.some(x=>!x)||digest(item.payload)!==digest(expected)||digest(item.source_detail_versions)!==digest(expectedDetails))throw conflict();
  }
  for(const versionId of new Set(items.flatMap(item=>item.source_detail_versions))){
    const details=review.detail_versions.filter(x=>x.detail_version_id===versionId);
    const detail=await one(db,'SELECT CAST(detail_id AS CHAR) detail_id,revision_no,snapshot_json,snapshot_digest,source_digest FROM process_data_governance_detail_versions WHERE detail_version_id=?'+suffix,[versionId]);
    if(details.length!==1||!detail)throw conflict();const {detail_version_id,revision_no,...snapshot}=details[0];
    if(detail.detail_id!==snapshot.detail_id||detail.revision_no!==revision_no||digest(snapshot)!==detail.snapshot_digest
      ||digest(decode(detail.snapshot_json))!==detail.snapshot_digest||detail.source_digest!==snapshot.source_digest)throw conflict();
  }
  const fixed=[];for(const item of items)fixed.push(await fixedContent(db,item,publicationId));
  const [eventRows]=await db.execute(`SELECT event_no,event_type,payload_json,request_id,${utcDateTimeColumns('',['created_at'])} FROM data_map_publication_events WHERE publication_id=? ORDER BY event_no`+suffix,[publicationId]);
  if(!eventRows.length)throw conflict();
  let state='published';const events=[];
  for(let i=0;i<eventRows.length;i++){
    const row=eventRows[i],payload=decode(row.payload_json);
    if(row.event_no!==i+1||!shape(payload))throw conflict();
    if(i===0){
      if(row.event_type!=='published'||row.request_id!==publication.request_id||payload.manifest_digest!==publication.manifest_digest||payload.scope_mode!==publication.scope_mode
        ||digest(payload.actor)!==digest(manifest.actor))throw conflict();
    }else if(row.event_type==='withdrawn'&&state==='published'){
      if(payload.manifest_digest!==publication.manifest_digest||!hash(payload.binding_digest)||!hash(payload.impact_digest)||!Array.isArray(payload.impact_manifest)
        ||digest(payload.impact_manifest)!==payload.impact_digest||!Array.isArray(payload.head_results)||!payload.approval_id||typeof payload.reason!=='string'||!payload.reason.trim())throw conflict();
      qualification(payload.actor);qualification(payload.approval_actor);
      const frozen=payload.withdrawal_report;
      if(!shape(frozen))throw conflict();
      try{validReport(frozen);}catch{throw conflict();}
      if(frozen.publication_id!==publicationId||frozen.package_id!==manifest.package_id||frozen.handoff_id!==revision.handoff_id||frozen.event_revision!==row.event_no-1
        ||frozen.manifest_digest!==publication.manifest_digest||frozen.fixed_content_digest!==digest(fixed)||frozen.binding_digest!==payload.binding_digest
        ||frozen.reason!==payload.reason
        ||digest(frozen.impact_manifest)!==payload.impact_digest||digest(frozen.produced_items)!==digest(items.filter(x=>x.produces_version===1))
        ||digest(frozen.reused_items)!==digest(items.filter(x=>x.produces_version===0))||payload.request_id!==row.request_id)throw conflict();
      const withdrawalApproval=await one(db,'SELECT action,revision_id,publication_id,decision,binding_digest,actor_json FROM data_map_handoff_approvals WHERE approval_id=?'+suffix,[payload.approval_id]);
      if(!withdrawalApproval||withdrawalApproval.action!=='withdraw_publication'||withdrawalApproval.revision_id!==null||withdrawalApproval.publication_id!==publicationId
        ||withdrawalApproval.decision!=='approved'||withdrawalApproval.binding_digest!==payload.binding_digest||digest(decode(withdrawalApproval.actor_json))!==digest(payload.approval_actor))throw conflict();
      const produced=items.filter(x=>x.produces_version===1);
      if(payload.head_results.length!==produced.length||frozen.heads.length!==produced.length)throw conflict();
      const seen=new Set();
      for(const result of payload.head_results){
        const target=produced.find(x=>x.target_kind===result.subject_kind&&x.target_id===result.subject_id),key=result.subject_kind+':'+result.subject_id;
        const head=frozen.heads.find(x=>x.subject_kind===result.subject_kind&&x.subject_id===result.subject_id);
        if(!target||seen.has(key)||!head||digest(head.head)!==digest(result.before))throw conflict();seen.add(key);
        const clear=Boolean(result.before&&result.before.publication_id===publicationId&&result.before.effective_version_ref===target.target_version_ref);
        if(clear!==head.will_clear)throw conflict();
        if(clear){
          const expected={...result.before,effective_version_ref:null,publication_id:null,head_revision:String(BigInt(result.before.head_revision)+1n),availability:'withdrawn'};
          if(result.action!=='cleared'||digest(expected)!==digest(result.after))throw conflict();
        }else if(result.action!==(result.before?'preserved':'absent')||digest(result.before)!==digest(result.after))throw conflict();
      }
      state='withdrawn';
    }else throw conflict();
    events.push({event_no:row.event_no,event_type:row.event_type,payload,request_id:row.request_id,created_at:row.created_at});
  }
  return {publication_id:publicationId,publication,manifest,items,events,fixed_content:fixed,fixed_content_digest:digest(fixed),
    package_id:manifest.package_id,handoff_id:revision.handoff_id,event_revision:eventRows.length,state};
}
async function withdrawalReport(db,publicationId,{reason}={}){
  if(typeof reason!=='string'||!reason.trim())throw failure('HANDOFF_REASON_REQUIRED',422);
  const publication=await inspectPublication(db,publicationId),produced=publication.items.filter(x=>x.produces_version===1),reused=publication.items.filter(x=>x.produces_version===0),heads=[];
  for(const item of produced){
    const head=await one(db,`SELECT subject_kind,subject_id,effective_version_ref,publication_id,CAST(head_revision AS CHAR) head_revision,availability
      FROM data_map_effective_heads WHERE subject_kind=? AND subject_id=? FOR SHARE`,[item.target_kind,item.target_id]);
    heads.push({subject_kind:item.target_kind,subject_id:item.target_id,head,will_clear:Boolean(head&&head.publication_id===publication.publication_id&&head.effective_version_ref===item.target_version_ref)});
  }
  const impacts=await referencesToVersions(db,produced,{excludePublicationId:publication.publication_id});
  // Related units can stop new references while retaining all old reference
  // rows. Freeze their lifecycle state separately from the fixed edge closure.
  const related=[];
  for(const id of [...new Set(impacts.map(x=>x.publication_id).filter(x=>x&&x!==publication.publication_id))].sort()){
    const fixed=await inspectPublication(db,id);
    related.push({publication_id:fixed.publication_id,manifest_digest:fixed.publication.manifest_digest,
      event_revision:fixed.event_revision,state:fixed.state,event_digest:digest(fixed.events)});
  }
  const report={schema_version:'data-map-publication-withdrawal-v1',publication_id:publication.publication_id,package_id:publication.package_id,handoff_id:publication.handoff_id,
    event_revision:publication.event_revision,state:publication.state,scope_mode:publication.manifest.scope_mode,reason:reason.trim(),manifest_digest:publication.publication.manifest_digest,
    fixed_content_digest:publication.fixed_content_digest,produced_items:produced,reused_items:reused,heads,
    impact_manifest:impacts,impact_digest:digest(impacts),related_publications:related};
  return {...report,binding_digest:digest(report)};
}
function validReport(report){
  if(!shape(report)||report.schema_version!=='data-map-publication-withdrawal-v1'||!hash(report.binding_digest)
    ||typeof report.reason!=='string'||!report.reason.trim()||report.reason!==report.reason.trim()
    ||digest(Object.fromEntries(Object.entries(report).filter(([key])=>key!=='binding_digest')))!==report.binding_digest)throw failure('HANDOFF_WITHDRAWAL_REPORT_INVALID');
  if(report.state!=='published')throw failure('HANDOFF_PUBLICATION_ALREADY_WITHDRAWN');
}
async function currentReport(db,report){
  validReport(report);const current=await withdrawalReport(db,report.publication_id,{reason:report.reason});
  if(current.event_revision!==report.event_revision||current.binding_digest!==report.binding_digest)throw failure('HANDOFF_WITHDRAWAL_APPROVAL_CHANGED');
  return current;
}
async function approveWithdrawal(db,{report,actor,requestId,basis}){
  requestId=uuid(requestId);if(typeof basis!=='string'||!basis.trim())throw failure('HANDOFF_BASIS_REQUIRED',422);
  const current=await currentReport(db,report),snapshot=qualification(actor.qualificationSnapshot),approvalId=newId();
  await assertApprover(db,snapshot,{packageId:current.package_id});
  await db.execute(`INSERT INTO data_map_handoff_approvals(approval_id,action,revision_id,publication_id,binding_digest,decision,basis,actor_json,request_id,created_at)
    VALUES(?,'withdraw_publication',NULL,?,?,'approved',?,?,?,UTC_TIMESTAMP(3))`,[approvalId,current.publication_id,current.binding_digest,basis.trim(),json(snapshot),requestId]);
  return {approval_id:approvalId,action:'withdraw_publication',publication_id:current.publication_id,binding_digest:current.binding_digest,decision:'approved',actor_snapshot:snapshot};
}
async function withdrawPublication(db,{report,approval,actor,requestId,reason}){
  requestId=uuid(requestId);if(typeof reason!=='string'||!reason.trim())throw failure('HANDOFF_REASON_REQUIRED',422);
  if(reason.trim()!==report?.reason)throw failure('HANDOFF_WITHDRAWAL_REASON_CHANGED');
  const current=await currentReport(db,report),approvalId=uuid(typeof approval==='string'?approval:approval?.approval_id);
  const row=await one(db,'SELECT * FROM data_map_handoff_approvals WHERE approval_id=? FOR SHARE',[approvalId]);
  if(!row||row.action!=='withdraw_publication'||row.revision_id!==null||row.publication_id!==current.publication_id||row.decision!=='approved'
    ||row.binding_digest!==current.binding_digest)throw failure('HANDOFF_WITHDRAWAL_APPROVAL_CHANGED');
  const approver=qualification(decode(row.actor_json)),executor=qualification(actor.qualificationSnapshot);
  await assertApprover(db,approver,{packageId:current.package_id});await assertApprover(db,executor,{packageId:current.package_id});
  const headResults=[];
  for(const entry of current.heads){
    let after=entry.head;
    if(entry.will_clear){
      const [changed]=await db.execute(`UPDATE data_map_effective_heads SET effective_version_ref=NULL,publication_id=NULL,head_revision=head_revision+1,availability='withdrawn'
        WHERE subject_kind=? AND subject_id=? AND publication_id=? AND effective_version_ref=? AND head_revision=?`,
      [entry.subject_kind,entry.subject_id,current.publication_id,entry.head.effective_version_ref,entry.head.head_revision]);
      if(changed.affectedRows!==1)throw failure('HANDOFF_WITHDRAWAL_APPROVAL_CHANGED');
      after={...entry.head,effective_version_ref:null,publication_id:null,head_revision:String(BigInt(entry.head.head_revision)+1n),availability:'withdrawn'};
    }
    headResults.push({subject_kind:entry.subject_kind,subject_id:entry.subject_id,before:entry.head,after,action:entry.will_clear?'cleared':entry.head?'preserved':'absent'});
  }
  const payload={schema_version:'data-map-publication-withdrawn-v1',manifest_digest:current.manifest_digest,fixed_content_digest:current.fixed_content_digest,
    binding_digest:current.binding_digest,withdrawal_report:current,impact_manifest:current.impact_manifest,impact_digest:current.impact_digest,head_results:headResults,
    reason:reason.trim(),approval_id:approvalId,approval_actor:approver,actor:executor,request_id:requestId,
    actor_snapshot:{person_id:actor.personId,person_name:actor.personName||null,role_code:actor.roleCode}};
  await db.execute(`INSERT INTO data_map_publication_events(publication_id,event_no,event_type,payload_json,request_id,created_at)
    VALUES(?,?,'withdrawn',?,?,UTC_TIMESTAMP(3))`,[current.publication_id,current.event_revision+1,json(payload),requestId]);
  return {business_outcome:'publication_withdrawn',publication_id:current.publication_id,event_revision:current.event_revision+1,
    manifest_digest:current.manifest_digest,impact_digest:current.impact_digest,withdrawal_approval_id:approvalId,heads:headResults,impact_manifest:current.impact_manifest};
}
module.exports={inspectPublication,withdrawalReport,approveWithdrawal,withdrawPublication};
