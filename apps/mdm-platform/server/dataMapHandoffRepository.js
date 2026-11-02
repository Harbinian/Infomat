const {timestampColumns,utcDateTimeColumns,timeRow}=require('./governanceTimeProjection');
// The request store owns every business transaction. This repository never
// migrates a database, enables a feature, or writes through legacy save helpers.
const {
  failure,uuid,revision:expectedRevision,writable,digest,json,parse,snapshot,newId,id
}=require('./dataMapHandoffPolicy');
const {createHandoffRequestStore}=require('./dataMapHandoffRequests');
const {handoffActor,assertApprover,inspectHandoffAccessModel}=require('./dataMapHandoffAuthority');
const {createLegacyAdapter,binding,loadFixedSource}=require('./dataMapHandoffBindings');
const gates=require('./dataMapHandoffGates');
const publisher=require('./dataMapHandoffPublisher');
const lifecycle=require('./dataMapPublicationLifecycle');
const restoration=require('./dataMapRestoration');
const conflicts=require('./dataMapHandoffConflict');
const sourceUpgrades=require('./dataMapSourceUpgrade');
const {readControl,readSnapshot}=require('./dataMapHandoffControl');
const {readDiscoverySnapshot}=require('./dataMapHandoffReadSnapshot');
const {CONTRACT_VERSION,inspectHandoffSchema}=require('./dataMapHandoffSchema');
const {fixedSourcePresentation,detailSourcePresentation}=require('./dataMapHandoffPresentation');
const {conflictFactSource,legacyFactSource}=require('./dataMapFactSourcePresentation');
const one=async(db,sql,args=[])=>(await rows(db,sql,args))[0]||null;
const rows=async(db,sql,args=[])=>(await db.execute(sql,args))[0].map(timeRow);
const text=value=>typeof value==='string'?value.trim():'';

function fields(value,prefix='',result=new Set()) {
  if(prefix)result.add(prefix);
  if(Array.isArray(value)) {
    if(!value.length&&prefix)result.add(prefix);
    value.forEach((item,index)=>fields(item,`${prefix}[${index}]`,result));
  }else if(value&&typeof value==='object') {
    if(!Object.keys(value).length&&prefix)result.add(prefix);
    for(const [key,item] of Object.entries(value)) {
      result.add(key);fields(item,prefix?prefix+'.'+key:key,result);
    }
  }else if(prefix)result.add(prefix);
  return result;
}
function bodyKeys(body,allowed) {
  if(!body||typeof body!=='object'||Array.isArray(body))throw failure('HANDOFF_PAYLOAD_INVALID',400);
  const keys=new Set(['request_id','expected_revision',...allowed]);
  if(Object.keys(body).some(key=>!keys.has(key)))throw failure('HANDOFF_PAYLOAD_FIELD_DENIED',422);
  uuid(body.request_id);
}
function assertRevision(header,value) {
  expectedRevision(value);
  if(Number(header.current_revision)!==value)throw failure('HANDOFF_REVISION_CONFLICT',409,{current_revision:Number(header.current_revision)});
}
function assertState(header,states) {
  if(!states.includes(header.state))throw failure('HANDOFF_STATE_CONFLICT',409,{state:header.state,current_revision:Number(header.current_revision)});
}
const parsedRow=row=>row&&Object.fromEntries(Object.entries(row).map(([key,value])=>[key,key.endsWith('_json')?parse(value):value]));
const effectTables=[
  'data_map_handoff_events','data_map_handoff_conflict_events','data_map_handoff_approvals','data_map_publications','data_map_publication_events',
  'process_data_governance_detail_versions','process_data_governance_intakes','process_data_governance_corrections',
  'process_data_governance_correction_revisions','process_data_governance_fact_versions','process_data_governance_review_bindings'
];

function createDataMapHandoffRepository(pool,{env=process.env}={}) {
  if(!pool||typeof pool.getConnection!=='function')throw new TypeError('A caller-owned MySQL pool is required');
  const authorize=async(db,session,action,scope,options={})=>{
    if(scope.sourcePackageId&&scope.sourcePackageId!==scope.packageId)await handoffActor(db,session,'read',{packageId:scope.sourcePackageId,lock:options.lock!==false});
    if(action==='fact_read'){
      try{return await handoffActor(db,session,scope.conflictId?'conflict_read':'read',{packageId:scope.packageId,conflictId:scope.conflictId||null,lock:options.lock!==false});}
      catch(error){if(error.statusCode!==403)throw error;}
    }
    return handoffActor(db,session,action,{packageId:scope.packageId,conflictId:scope.conflictId||null,departmentId:scope.departmentId||null,factRequestId:scope.factRequestId||null,
      factKind:scope.factKind||'handoff_correction',writeFields:scope.writeFields,lock:options.lock!==false});
  };
  async function assertNoCommittedEffects(db,requestId) {
    for(const table of effectTables) {
      const found=await one(db,`SELECT request_id FROM ${table} WHERE request_id=? LIMIT 1`,[requestId]);
      if(found)throw failure('HANDOFF_RECEIPT_INCONSISTENT',503,{request_id:requestId});
    }
  }
  const requests=createHandoffRequestStore(pool,{authorize,env,assertNoCommittedEffects,assertReady:async db=>{
    if(!(await inspectHandoffSchema(db,{pinMetadata:true})).ready)throw failure('HANDOFF_SCHEMA_UNAVAILABLE',503);
  }});
  async function resource(db,kind,resourceId,lock=false) {
    const suffix=lock?(['fact','publication'].includes(kind)?' FOR SHARE':' FOR UPDATE'):'';
    let found;
    if(kind==='work_package')found=await one(db,`SELECT CAST(id AS CHAR) id,CAST(id AS CHAR) package_id FROM process_data_governance_work_packages WHERE id=?${suffix}`,[id(resourceId)]);
    else if(kind==='handoff')found=await one(db,`SELECT *,CAST(package_id AS CHAR) package_id,CAST(submitted_by AS CHAR) submitted_by,CAST(created_by AS CHAR) created_by FROM data_map_handoff_drafts WHERE handoff_id=?${suffix}`,[uuid(resourceId)]);
    else if(kind==='intake')found=await one(db,`SELECT *,CAST(package_id AS CHAR) package_id FROM process_data_governance_intakes WHERE intake_id=?${suffix}`,[uuid(resourceId)]);
    else if(kind==='correction')found=await one(db,`SELECT *,CAST(package_id AS CHAR) package_id FROM process_data_governance_corrections WHERE correction_id=?${suffix}`,[uuid(resourceId)]);
    else if(kind==='fact')found=await one(db,`SELECT *,CAST(package_id AS CHAR) package_id FROM process_data_governance_fact_versions WHERE fact_id=? ORDER BY revision_no DESC LIMIT 1${suffix}`,[uuid(resourceId)]);
    else if(kind==='conflict')found=await one(db,`SELECT *,CAST(package_id AS CHAR) package_id,CAST(assignee_person_id AS CHAR) assignee_person_id,CAST(decision_person_id AS CHAR) decision_person_id FROM data_map_handoff_conflicts WHERE conflict_id=?${suffix}`,[uuid(resourceId)]);
    else if(kind==='publication') {
      found=await one(db,`SELECT * FROM data_map_publications WHERE publication_id=?${suffix}`,[uuid(resourceId)]);
      if(found) {
        const manifest=parse(found.manifest_json);
        if(digest(manifest)!==found.manifest_digest)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT');
        found.package_id=id(manifest.package_id);
      }
    }else throw failure('HANDOFF_SCOPE_INVALID',400);
    if(!found)throw failure('HANDOFF_RESOURCE_NOT_FOUND',404);
    return found;
  }
  async function scopeFor(kind,resourceId,body,operation,extra={}) {
    writable(env);
    const row=await resource(pool,kind,resourceId);
    const writeFields=fields(body);
    for(const field of ['request_id','state','current_revision','snapshot_json','snapshot_digest','current_approval_id'])writeFields.add(field);
    if(kind==='handoff'&&['approve','publish'].includes(operation)) {
      const requested=expectedRevision(body.expected_revision);
      const current=await one(pool,'SELECT snapshot_json FROM data_map_handoff_revisions WHERE handoff_id=? AND revision_no=?',[resourceId,requested]);
      if(!current)throw failure('HANDOFF_REVISION_NOT_FOUND',409);
      fields(parse(current.snapshot_json),'draft',writeFields);
    }
    if(kind==='publication'){
      fields(parse(row.manifest_json),'publication',writeFields);
      // Field names derive from immutable input/schema, so terminal replay scope
      // does not drift when the successful transaction changes heads or impact.
      for(const field of ['manifest_json','manifest_digest','items','produces_version','effective_version_ref','publication_id','head_revision','availability',
        'subject_kind','subject_id','event_no','event_type','payload_json','actor_json','binding_digest','impact_manifest','impact_digest','heads','head_results',
        'approval_id','action','decision','basis','reason','restoration','restores_publication_id','active_slot','created_by','created_actor_json','dependency_manifest_json','impact_manifest_json'])writeFields.add(field);
    }
    const result={kind,id:String(resourceId),packageId:row.package_id,operation,writeFields:[...writeFields].sort(),...extra};
    if(kind==='fact') {
      const fact=parse(row.snapshot_json);
      if(digest(fact)!==row.snapshot_digest||fact.fact_id!==String(resourceId))throw failure('HANDOFF_FACT_SNAPSHOT_DRIFT');
      Object.assign(result,{factRequestId:String(resourceId),factKind:'handoff_correction',departmentId:id(fact.target_department_id)});
      if(fact.parent_kind==='handoff_conflict')Object.assign(result,{factKind:'handoff_conflict',conflictId:uuid(fact.conflict_id),handoffId:uuid(fact.handoff_id)});
    }
    if(kind==='conflict')Object.assign(result,{conflictId:uuid(resourceId),handoffId:row.handoff_id});
    return result;
  }
  async function packageLocks(db,scope,{verifySource=true}={}) {
    const loaded=verifySource?await gates.packageSource(db,scope.packageId):{
      pkg:await one(db,'SELECT *,CAST(id AS CHAR) id,CAST(process_version_id AS CHAR) process_version_id FROM process_data_governance_work_packages WHERE id=? FOR UPDATE',[scope.packageId])
    };
    if(!loaded.pkg)throw failure('HANDOFF_RESOURCE_NOT_FOUND',404);
    if(!verifySource)await db.execute('SELECT id FROM process_design_versions WHERE id=? FOR SHARE',[loaded.pkg.process_version_id]);
    if(loaded.pkg.id!==scope.packageId)throw failure('HANDOFF_SCOPE_STALE');
    return loaded;
  }
  async function lockedHandoff(db,handoffId,scope,options={}) {
    await packageLocks(db,scope,options);
    const header=await resource(db,'handoff',handoffId,true);
    if(header.package_id!==scope.packageId)throw failure('HANDOFF_SCOPE_STALE');
    return header;
  }
  async function revisionRow(db,header,number=header.current_revision) {
    const row=await one(db,'SELECT *,CAST(created_by AS CHAR) created_by FROM data_map_handoff_revisions WHERE handoff_id=? AND revision_no=? FOR SHARE',[header.handoff_id,number]);
    if(!row)throw failure('HANDOFF_REVISION_NOT_FOUND',404);
    if(digest(parse(row.snapshot_json))!==row.content_digest)throw failure('HANDOFF_CONTENT_INTEGRITY_CONFLICT');
    return row;
  }
  async function snapshotControl(db) {
    // Readers that later take package, conflict or qualification locks follow
    // the same control-first order as business writes. Missing control never
    // authorizes writes; fixed history remains independently readable.
    try{return await readControl(db);}catch(error){if(error.statusCode!==503)throw error;return null;}
  }
  async function event(db,handoffId,type,payload,actor,context) {
    await db.execute(`INSERT INTO data_map_handoff_events(event_id,handoff_id,event_type,payload_json,actor_json,request_id,created_at)
      VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[newId(),handoffId,type,json({...payload,actor_snapshot:{person_id:actor.personId,person_name:actor.personName||null,role_code:actor.roleCode}}),json(actor.qualificationSnapshot),context.request_id]);
  }
  async function append(db,header,body,bindingId,actor) {
    body=snapshot(body);
    const bound=await binding(db,bindingId,header.package_id);
    const deps=await gates.dependencies(db,body,bound.snapshot,{handoffId:header.handoff_id,bindingId});
    const number=Number(header.current_revision)+1,revisionId=newId();
    await db.execute(`INSERT INTO data_map_handoff_revisions
      (revision_id,handoff_id,revision_no,scope_mode,binding_id,snapshot_json,content_digest,dependency_manifest_json,impact_manifest_json,created_by,created_actor_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[revisionId,header.handoff_id,number,body.scope_mode,bindingId,json(body),digest(body),json(deps),json(deps.impacts),actor.personId,json(actor.qualificationSnapshot)]);
    await db.execute('UPDATE data_map_handoff_drafts SET current_revision=?,current_approval_id=NULL WHERE handoff_id=?',[number,header.handoff_id]);
    return {revision_id:revisionId,handoff_id:header.handoff_id,revision_no:number,scope_mode:body.scope_mode,binding_id:bindingId,
      snapshot_json:body,content_digest:digest(body),dependency_manifest_json:deps,impact_manifest_json:deps.impacts};
  }
  const actionResult=(header,row,state,extra={})=>({handoff_id:header.handoff_id,package_id:header.package_id,revision:Number(row.revision_no),
    revision_id:row.revision_id,content_digest:row.content_digest,binding_id:row.binding_id,scope_mode:row.scope_mode,state,business_outcome:'draft_saved',publication_id:null,...extra});

  async function fromWorkPackage(packageId,body,session) {
    bodyKeys(body,['binding_id','draft','scope_mode']);expectedRevision(body.expected_revision,true);
    if(body.draft?.restores_publication_id||body.draft?.restoration)throw failure('HANDOFF_RESTORATION_ENTRY_REQUIRED',409);
    if(body.expected_revision!==0)throw failure('HANDOFF_REVISION_CONFLICT');
    const scope=await scopeFor('work_package',id(packageId),body,'from_work_package');
    return requests.execute('prepare',scope,body,session,async(db,control,reauthorize,context)=>{
      const {source}=await packageLocks(db,scope);
      const head=await one(db,'SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=? FOR SHARE',[scope.packageId]);
      if(!head)throw failure('HANDOFF_INTAKE_REQUIRED',422,{intake_url:`/api/data-map-handoffs/work-packages/${scope.packageId}/intakes`});
      const bindingId=body.binding_id?uuid(body.binding_id):head.binding_id;
      if(bindingId!==head.binding_id)throw failure('HANDOFF_REVIEW_BINDING_STALE');
      const bound=await binding(db,bindingId,scope.packageId);
      let existing=await one(db,'SELECT *,CAST(package_id AS CHAR) package_id FROM data_map_handoff_drafts WHERE package_id=? AND active_slot=1 FOR UPDATE',[scope.packageId]);
      if(!existing)existing=await one(db,`SELECT d.*,CAST(d.package_id AS CHAR) package_id FROM data_map_handoff_drafts d
        WHERE d.package_id=? AND EXISTS(SELECT 1 FROM data_map_handoff_revisions r WHERE r.handoff_id=d.handoff_id AND r.binding_id=?)
        ORDER BY d.created_at,d.handoff_id LIMIT 1 FOR UPDATE`,[scope.packageId,bindingId]);
      const actor=await reauthorize();
      if(existing) {
        const current=await revisionRow(db,existing);
        if(current.binding_id!==bindingId)throw failure('HANDOFF_REBASE_REQUIRED',409,{handoff_id:existing.handoff_id});
        if(body.scope_mode&&body.scope_mode!==current.scope_mode)throw failure('HANDOFF_SCOPE_CONFLICT');
        if(body.draft&&digest(snapshot(body.draft))!==current.content_digest)throw failure('HANDOFF_ACTIVE_DRAFT_EXISTS',409,{handoff_id:existing.handoff_id});
        const publication=existing.state==='published'?await one(db,'SELECT publication_id FROM data_map_publications WHERE handoff_revision_id=?',[current.revision_id]):null;
        return actionResult(existing,current,existing.state,{idempotent:true,business_outcome:publication?'existing_publication':'existing_draft',publication_id:publication?.publication_id||null});
      }
      const header={handoff_id:newId(),package_id:scope.packageId,current_revision:0};
      const initial=body.draft||{schema_version:'handoff-draft-v1',scope_mode:body.scope_mode||(source.status==='published'?'current':'historical'),
        items:[],dispositions:bound.snapshot.detail_versions.filter(item=>['not_applicable','terminated'].includes(item.status)).map(item=>({detail_ref:item.detail_ref,operation:item.status,basis:item.governance?.basis||''})),impact_dispositions:[],basis:''};
      if(body.scope_mode&&initial.scope_mode!==body.scope_mode)throw failure('HANDOFF_SCOPE_CONFLICT');
      await db.execute("INSERT INTO data_map_handoff_drafts(handoff_id,package_id,current_revision,state,active_slot,created_by,created_actor_json,created_at) VALUES(?,?,1,'draft',1,?,?,UTC_TIMESTAMP(3))",[header.handoff_id,header.package_id,actor.personId,json(actor.qualificationSnapshot)]);
      const saved=await append(db,header,initial,bindingId,actor);
      await db.execute("UPDATE data_map_handoff_generation_tasks SET state='generated',last_error=NULL WHERE package_id=? AND binding_id=?",[scope.packageId,bindingId]);
      await event(db,header.handoff_id,'draft_created',{binding_id:bindingId,revision_id:saved.revision_id},actor,context);
      return actionResult(header,saved,'draft');
    });
  }
  async function saveDraft(handoffId,body,session,{rebase=false}={}) {
    bodyKeys(body,rebase?['draft','binding_id','basis']:['draft']);
    const scope=await scopeFor('handoff',uuid(handoffId),body,rebase?'rebase':'save_draft');
    return requests.execute('prepare',scope,body,session,async(db,control,reauthorize,context)=>{
      const header=await lockedHandoff(db,handoffId,scope);assertRevision(header,body.expected_revision);assertState(header,['draft']);
      const old=await revisionRow(db,header);
      const head=await one(db,'SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=? FOR SHARE',[header.package_id]);
      const bindingId=rebase?uuid(body.binding_id):old.binding_id;
      if(!head||head.binding_id!==bindingId)throw failure('HANDOFF_REVIEW_BINDING_STALE');
      if(rebase&&!text(body.basis))throw failure('HANDOFF_BASIS_REQUIRED',422);
      const nextBody=body.draft||(rebase?parse(old.snapshot_json):null);
      if(!nextBody)throw failure('HANDOFF_DRAFT_REQUIRED',422);
      restoration.preserve(parse(old.snapshot_json),nextBody);
      const actor=await reauthorize(),saved=await append(db,header,nextBody,bindingId,actor);
      await event(db,handoffId,rebase?'draft_rebased':'draft_saved',{previous_revision:header.current_revision,revision_id:saved.revision_id,binding_id:bindingId,basis:body.basis||null},actor,context);
      return actionResult(header,saved,'draft');
    });
  }
  async function submit(handoffId,body,session) {
    bodyKeys(body,[]);const scope=await scopeFor('handoff',uuid(handoffId),body,'submit');
    return requests.execute('prepare',scope,body,session,async(db,control,reauthorize,context)=>{
      const header=await lockedHandoff(db,handoffId,scope);assertRevision(header,body.expected_revision);assertState(header,['draft']);
      const old=await revisionRow(db,header),evaluation=await gates.evaluate(db,{draft:header,revision:old});
      if(!evaluation.report.ready_for_approval)throw failure('HANDOFF_GATE_BLOCKED',422,{report:evaluation.report});
      const actor=await reauthorize(),saved=await append(db,header,parse(old.snapshot_json),old.binding_id,actor);
      await db.execute("UPDATE data_map_handoff_drafts SET state='submitted',submitted_by=?,current_approval_id=NULL WHERE handoff_id=?",[actor.personId,handoffId]);
      await event(db,handoffId,'draft_submitted',{revision_id:saved.revision_id,submitted_by:actor.personId},actor,context);
      return actionResult(header,saved,'submitted',{business_outcome:'draft_submitted'});
    });
  }
  async function checks(handoffId,body,session) {
    bodyKeys(body,[]);const scope=await scopeFor('handoff',uuid(handoffId),body,'checks');
    return requests.execute('prepare',scope,body,session,async(db,control,reauthorize,context)=>{
      const header=await lockedHandoff(db,handoffId,scope);assertRevision(header,body.expected_revision);assertState(header,['draft','submitted','approved']);
      const current=await revisionRow(db,header),evaluation=await gates.evaluate(db,{draft:header,revision:current});
      const actor=await reauthorize();await event(db,handoffId,'gates_checked',{revision_id:current.revision_id,report:evaluation.report},actor,context);
      return actionResult(header,current,header.state,{business_outcome:'gates_checked',report:evaluation.report});
    });
  }
  async function approve(handoffId,body,session) {
    bodyKeys(body,['decision','basis','binding_digest']);
    if(!['approved','needs_changes'].includes(body.decision)||!text(body.basis))throw failure('HANDOFF_APPROVAL_INVALID',422);
    const scope=await scopeFor('handoff',uuid(handoffId),body,'approve'),action=body.decision==='approved'?'approve':'review';
    return requests.execute(action,scope,body,session,async(db,control,reauthorize,context)=>{
      const header=await lockedHandoff(db,handoffId,scope);assertRevision(header,body.expected_revision);assertState(header,['submitted']);
      const current=await revisionRow(db,header),evaluation=await gates.evaluate(db,{draft:header,revision:current});
      if(body.decision==='approved'&&!evaluation.report.ready_for_approval)throw failure('HANDOFF_GATE_BLOCKED',422,{report:evaluation.report});
      if(body.decision==='approved'&&body.binding_digest!==evaluation.report.binding_digest)throw failure('HANDOFF_APPROVAL_BINDING_CHANGED',409,{report:evaluation.report});
      const actor=await reauthorize(),approvalId=newId();
      await db.execute(`INSERT INTO data_map_handoff_approvals(approval_id,action,revision_id,binding_digest,decision,basis,actor_json,request_id,created_at)
        VALUES(?,'publish',?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[approvalId,current.revision_id,evaluation.report.binding_digest,body.decision,text(body.basis),json(actor.qualificationSnapshot),context.request_id]);
      let active=current;
      if(body.decision==='needs_changes')active=await append(db,header,parse(current.snapshot_json),current.binding_id,actor);
      await db.execute('UPDATE data_map_handoff_drafts SET state=?,current_approval_id=? WHERE handoff_id=?',[body.decision==='approved'?'approved':'draft',body.decision==='approved'?approvalId:null,handoffId]);
      await event(db,handoffId,body.decision==='approved'?'draft_approved':'draft_returned',{approval_id:approvalId,revision_id:current.revision_id,binding_digest:evaluation.report.binding_digest,basis:body.basis},actor,context);
      return actionResult(header,active,body.decision==='approved'?'approved':'draft',{business_outcome:body.decision==='approved'?'draft_approved':'draft_returned',approval_id:approvalId,report:evaluation.report});
    });
  }
  async function publish(handoffId,body,session) {
    bodyKeys(body,['approval_id']);const scope=await scopeFor('handoff',uuid(handoffId),body,'publish');
    return requests.execute('publish',scope,body,session,async(db,control,reauthorize,context)=>{
      const header=await lockedHandoff(db,handoffId,scope);assertRevision(header,body.expected_revision);assertState(header,['approved']);
      if(!header.current_approval_id||body.approval_id&&uuid(body.approval_id)!==header.current_approval_id)throw failure('HANDOFF_APPROVAL_STALE');
      const current=await revisionRow(db,header),approval=await one(db,"SELECT * FROM data_map_handoff_approvals WHERE approval_id=? AND action='publish' AND decision='approved' FOR SHARE",[header.current_approval_id]);
      if(!approval||approval.revision_id!==current.revision_id)throw failure('HANDOFF_APPROVAL_STALE');
      const evaluation=await gates.evaluate(db,{draft:header,revision:current,phase:'publish',approvalProvided:true});
      if(!evaluation.report.publishable)throw failure('HANDOFF_GATE_BLOCKED',422,{report:evaluation.report});
      if(evaluation.report.binding_digest!==approval.binding_digest)throw failure('HANDOFF_APPROVAL_STALE');
      const actor=await reauthorize();await assertApprover(db,parse(approval.actor_json),{packageId:header.package_id});
      const result=await publisher.publish(db,{draft:header,revision:current,approval,evaluation,actor,control,requestId:context.request_id});
      await event(db,handoffId,'publication_committed',{publication_id:result.publication_id,revision_id:current.revision_id,approval_id:approval.approval_id},actor,context);
      return {...actionResult(header,current,'published'),...result};
    });
  }
  async function withdraw(handoffId,body,session) {
    bodyKeys(body,['intent','reason']);
    if(!['withdraw_submission','revoke_approval'].includes(body.intent)||!text(body.reason))throw failure('HANDOFF_WITHDRAWAL_INVALID',422);
    const scope=await scopeFor('handoff',uuid(handoffId),body,'withdraw'),action=body.intent==='revoke_approval'?'approve':'prepare';
    return requests.execute(action,scope,body,session,async(db,control,reauthorize,context)=>{
      const header=await lockedHandoff(db,handoffId,scope,{verifySource:false});assertRevision(header,body.expected_revision);
      assertState(header,body.intent==='withdraw_submission'?['submitted']:['approved']);
      const current=await revisionRow(db,header),actor=await reauthorize();
      if(body.intent==='withdraw_submission'&&header.submitted_by!==String(actor.personId))throw failure('HANDOFF_SUBMITTER_REQUIRED',403);
      const saved=await append(db,header,parse(current.snapshot_json),current.binding_id,actor);
      await db.execute("UPDATE data_map_handoff_drafts SET state='draft',current_approval_id=NULL WHERE handoff_id=?",[handoffId]);
      await event(db,handoffId,body.intent==='withdraw_submission'?'submission_withdrawn':'approval_revoked',{reason:body.reason,previous_revision_id:current.revision_id,approval_id:header.current_approval_id||null,revision_id:saved.revision_id},actor,context);
      return actionResult(header,saved,'draft',{business_outcome:body.intent});
    });
  }
  function publicationRevision(value,body){expectedRevision(body.expected_revision);if(value.event_revision!==body.expected_revision)throw failure('HANDOFF_PUBLICATION_REVISION_CONFLICT',409,{event_revision:value.event_revision});}
  async function lockedPublication(db,publicationId,scope){
    for(const packageId of [...new Set([scope.packageId,scope.sourcePackageId].filter(Boolean))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1))await packageLocks(db,{packageId},{verifySource:false});
    const value=await lifecycle.inspectPublication(db,publicationId);
    if(value.package_id!==(scope.sourcePackageId||scope.packageId))throw failure('HANDOFF_SCOPE_STALE');
    return value;
  }
  async function getPublication(publicationId,session){
    return readDiscoverySnapshot(pool,async db=>{
      const control=await snapshotControl(db);
      const row=await resource(db,'publication',uuid(publicationId));
      const actor=await handoffActor(db,session,'read',{packageId:row.package_id,lock:false});
      const value=await lifecycle.inspectPublication(db,publicationId,{lock:false});
      const allowed=['read'];
      if(control?.cutover_state==='controlled'&&String(env.DATA_MAP_HANDOFF_ENABLED||'0')==='1'&&String(env.PROCESS_DATA_GOVERNANCE_READ_ONLY||'0')!=='1'&&!actor.roleCodes.has('admin')){
        const lead=actor.roleCodes.has('mdm_lead')&&['governance:assign-work','governance:structure-gate','governance:publish'].every(p=>actor.permissions.has(p));
        if(lead&&value.state==='published')allowed.push('withdrawal_checks','withdrawal_approval','withdraw_publication');
        if(value.state==='withdrawn'&&(lead||actor.roleCodes.has('mdm_steward')))allowed.push('prepare_restoration');
      }
      return {publication_id:value.publication_id,package_id:value.package_id,event_revision:value.event_revision,state:value.state,
        manifest:value.manifest,events:value.events,allowed_actions:allowed};
    });
  }
  async function publicationAction(publicationId,body,session,operation){
    const allowed={withdrawal_checks:['reason'],withdrawal_approval:['reason','basis','binding_digest'],withdraw_publication:['reason','withdrawal_approval_id']}[operation];
    bodyKeys(body,allowed);expectedRevision(body.expected_revision);
    if(!text(body.reason))throw failure('HANDOFF_REASON_REQUIRED',422);
    if(operation==='withdrawal_approval'&&(!text(body.basis)||!text(body.binding_digest)))throw failure('HANDOFF_APPROVAL_INVALID',422);
    if(operation==='withdraw_publication')uuid(body.withdrawal_approval_id);
    const scope=await scopeFor('publication',uuid(publicationId),body,operation);
    return requests.execute('withdraw',scope,body,session,async(db,control,reauthorize,context)=>{
      const value=await lockedPublication(db,publicationId,scope);publicationRevision(value,body);
      const report=await lifecycle.withdrawalReport(db,publicationId,{reason:body.reason});
      if(value.state!=='published')throw failure('HANDOFF_PUBLICATION_ALREADY_WITHDRAWN');
      const actor=await reauthorize();
      if(operation==='withdrawal_checks'){
        await event(db,value.handoff_id,'withdrawal_checked',{publication_id:publicationId,binding_digest:report.binding_digest,report},actor,context);
        return {publication_id:publicationId,event_revision:value.event_revision,business_outcome:'withdrawal_checked',report};
      }
      if(operation==='withdrawal_approval'){
        if(report.binding_digest!==body.binding_digest)throw failure('HANDOFF_WITHDRAWAL_APPROVAL_CHANGED',409,{report});
        const approval=await lifecycle.approveWithdrawal(db,{report,actor,requestId:context.request_id,basis:body.basis});
        await event(db,value.handoff_id,'withdrawal_approved',{publication_id:publicationId,approval_id:approval.approval_id,report},actor,context);
        return {publication_id:publicationId,event_revision:value.event_revision,withdrawal_approval_id:approval.approval_id,business_outcome:'withdrawal_approved',binding_digest:report.binding_digest};
      }
      return lifecycle.withdrawPublication(db,{report,approval:body.withdrawal_approval_id,actor,requestId:context.request_id,reason:body.reason});
    });
  }
  async function restorePublication(publicationId,body,session){
    bodyKeys(body,['target_package_id','target_handoff_id','expected_target_revision','expected_target_binding_id','scope_mode','draft','basis','evidence_refs','item_mappings']);
    expectedRevision(body.expected_revision);expectedRevision(body.expected_target_revision,true);
    if(body.expected_target_binding_id!==undefined)uuid(body.expected_target_binding_id);
    if(!['current','historical'].includes(body.scope_mode)||body.draft?.scope_mode!==body.scope_mode||!text(body.basis))throw failure('HANDOFF_RESTORATION_INVALID',422);
    const origin=await resource(pool,'publication',uuid(publicationId)),targetId=id(body.target_package_id);
    const scope=await scopeFor('publication',publicationId,body,'prepare_restoration',{packageId:targetId,sourcePackageId:origin.package_id});
    return requests.execute('prepare',scope,body,session,async(db,control,reauthorize,context)=>{
      const original=await lockedPublication(db,publicationId,scope);publicationRevision(original,body);
      if(original.state!=='withdrawn')throw failure('HANDOFF_PUBLICATION_NOT_WITHDRAWN');
      const {pkg,source}=await packageLocks(db,scope);
      if(pkg.status!=='completed')throw failure('HANDOFF_REVIEW_REQUIRED',422);
      if(body.scope_mode==='current'){
        const current=await one(db,'SELECT CAST(current_version_id AS CHAR) id FROM process_design_documents WHERE id=? FOR SHARE',[source.document_id]);
        if(source.status!=='published'||current?.id!==source.id)throw failure('HANDOFF_SCOPE_STALE');
      }
      const head=await one(db,'SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=? FOR SHARE',[targetId]);
      if(!head)throw failure('HANDOFF_INTAKE_REQUIRED',422);
      if(body.expected_target_binding_id!==undefined&&body.expected_target_binding_id!==head.binding_id)throw failure('HANDOFF_REVIEW_BINDING_STALE',409);
      const next=restoration.create(body.draft,original,{targetPackageId:targetId,basis:text(body.basis),evidenceRefs:body.evidence_refs,itemMappings:body.item_mappings});
      let header=await one(db,'SELECT *,CAST(package_id AS CHAR) package_id FROM data_map_handoff_drafts WHERE package_id=? AND active_slot=1 FOR UPDATE',[targetId]);
      if(header){
        if(!body.target_handoff_id||uuid(body.target_handoff_id)!==header.handoff_id)throw failure('HANDOFF_ACTIVE_DRAFT_EXISTS',409,{handoff_id:header.handoff_id});
        assertRevision(header,body.expected_target_revision);assertState(header,['draft']);
        const previous=await revisionRow(db,header);
        if(previous.binding_id!==head.binding_id)throw failure('HANDOFF_REBASE_REQUIRED',409);
        if(parse(previous.snapshot_json).restoration)throw failure('HANDOFF_RESTORATION_ALREADY_PREPARED',409);
      }else{
        if(body.target_handoff_id||body.expected_target_revision!==0)throw failure('HANDOFF_REVISION_CONFLICT',409);
        header={handoff_id:newId(),package_id:targetId,current_revision:0};
      }
      const actor=await reauthorize();
      if(header.current_revision===0)await db.execute("INSERT INTO data_map_handoff_drafts(handoff_id,package_id,current_revision,state,active_slot,created_by,created_actor_json,created_at) VALUES(?,?,1,'draft',1,?,?,UTC_TIMESTAMP(3))",[header.handoff_id,targetId,actor.personId,json(actor.qualificationSnapshot)]);
      const saved=await append(db,header,next,head.binding_id,actor);
      await event(db,header.handoff_id,'restoration_created',{source_publication_id:publicationId,source_event_revision:original.event_revision,previous_revision:header.current_revision,revision_id:saved.revision_id,restoration:next.restoration},actor,context);
      await db.execute("UPDATE data_map_handoff_generation_tasks SET state='generated',last_error=NULL WHERE package_id=? AND binding_id=?",[targetId,head.binding_id]);
      return actionResult(header,saved,'draft',{business_outcome:'restoration_draft_saved',restores_publication_id:publicationId});
    });
  }
  async function legacyAction(method,kind,resourceId,body,session,action) {
    if(!body||typeof body!=='object'||Array.isArray(body))throw failure('HANDOFF_PAYLOAD_INVALID',400);
    uuid(body.request_id);
    const scope=await scopeFor(kind,resourceId,body,method);
    return requests.execute(action,scope,body,session,async(db,control,reauthorize,context)=>{
      await packageLocks(db,scope);
      const actor=await reauthorize();
      if(kind!=='work_package') {
        const parent=await resource(db,kind,resourceId,true);
        if(parent.package_id!==scope.packageId)throw failure('HANDOFF_SCOPE_STALE');
      }
      const legacy=createLegacyAdapter({writeFields:scope.writeFields});
      const key={work_package:'package_id',intake:'intake_id',correction:'correction_id',fact:'fact_id'}[kind];
      return legacy[method](db,body,actor,{...context,package_id:scope.packageId,[key]:String(resourceId)});
    });
  }
  async function get(handoffId,session,{revisionNo=null}={}) {
    return readDiscoverySnapshot(pool,async db=>{
      const control=await snapshotControl(db);
      const header=await resource(db,'handoff',handoffId);
      const actor=await handoffActor(db,session,'read',{packageId:header.package_id,lock:false});
      const current=await revisionRow(db,header,revisionNo==null?header.current_revision:expectedRevision(Number(revisionNo)));
      let report=null;
      if(Number(current.revision_no)===Number(header.current_revision)&&header.state!=='published') {
        try{report=(await gates.evaluate(db,{draft:header,revision:current})).report;}
        catch(error){
          if(!String(error.code||'').startsWith('HANDOFF_SOURCE_')&&!['HANDOFF_CONTENT_INTEGRITY_CONFLICT','HANDOFF_REVIEW_BINDING_INVALID'].includes(error.code))throw error;
          report={ready_for_approval:false,publishable:false,gates:[{gate:1,status:'blocked',issues:[error.code]},...Array.from({length:4},(_,i)=>({gate:i+2,status:'pending',issues:[]}))]};
        }
      }
      const roles=actor.roleCodes;
      const allowed=['read'];
      const controlled=control?.cutover_state==='controlled';
      if(controlled&&Number(current.revision_no)===Number(header.current_revision)&&String(env.DATA_MAP_HANDOFF_ENABLED||'0')==='1'&&String(env.PROCESS_DATA_GOVERNANCE_READ_ONLY||'0')!=='1'&&!roles.has('admin')) {
        const lead=roles.has('mdm_lead')&&actor.permissions.has('governance:assign-work')&&actor.permissions.has('governance:structure-gate');
        const canPublish=lead&&actor.permissions.has('governance:publish');
        const canPrepare=lead||roles.has('mdm_steward')&&actor.permissions.has('governance:handle-assigned-work')&&actor.permissions.has('governance:read-assigned-context');
        if(canPrepare&&header.state!=='published')allowed.push('create_conflict');
        if(canPrepare&&['submitted','approved'].includes(header.state))allowed.push('checks');
        if(canPrepare&&header.state==='draft')allowed.push('source_upgrade_assessment');
        if(canPrepare&&header.state==='draft')allowed.push('save','rebase','submit','checks');
        if(canPrepare&&header.state==='submitted'&&header.submitted_by===String(actor.personId))allowed.push('withdraw_submission');
        if(lead&&header.state==='submitted')allowed.push('needs_changes');
        if(canPublish&&header.state==='submitted')allowed.push('approve');
        if(canPublish&&header.state==='approved')allowed.push('revoke_approval','publish');
      }
      return {header:parsedRow(header),revision:parsedRow(current),report,allowed_actions:allowed,governance_status:header.state==='published'?'published':'not_effective'};
    });
  }
  async function tracePackage(packageId,session) {
    return readDiscoverySnapshot(pool,async db=>{
      const pkg=await one(db,`SELECT p.*,CAST(id AS CHAR) id,CAST(process_version_id AS CHAR) process_version_id
        FROM process_data_governance_work_packages p WHERE p.id=?`,[id(packageId)]);
      if(!pkg)throw failure('HANDOFF_RESOURCE_NOT_FOUND',404);
      await handoffActor(db,session,'read',{packageId:pkg.id,lock:false});
      const source=await one(db,'SELECT CAST(id AS CHAR) id,schema_version,status,content_hash,document_title,edition,process_content_json FROM process_design_versions WHERE id=?',[pkg.process_version_id]);
      const bindings=await rows(db,`SELECT *,${timestampColumns('',['created_at'])},CAST(package_id AS CHAR) package_id,CAST(native_review_id AS CHAR) native_review_id FROM process_data_governance_review_bindings WHERE package_id=? ORDER BY created_at,binding_id`,[pkg.id]);
      for(const row of bindings)if(digest(parse(row.snapshot_json))!==row.binding_digest)throw failure('HANDOFF_CONTENT_INTEGRITY_CONFLICT');
      const drafts=await rows(db,`SELECT *,${utcDateTimeColumns('',['created_at'])},CAST(package_id AS CHAR) package_id,CAST(submitted_by AS CHAR) submitted_by,CAST(created_by AS CHAR) created_by FROM data_map_handoff_drafts WHERE package_id=? ORDER BY created_at,handoff_id`,[pkg.id]);
      const revisions=await rows(db,`SELECT r.*,${utcDateTimeColumns('r',['created_at'])},CAST(r.created_by AS CHAR) created_by FROM data_map_handoff_revisions r JOIN data_map_handoff_drafts d ON d.handoff_id=r.handoff_id WHERE d.package_id=? ORDER BY r.created_at,r.revision_id`,[pkg.id]);
      const approvals=await rows(db,`SELECT a.*,${utcDateTimeColumns('a',['created_at'])} FROM data_map_handoff_approvals a LEFT JOIN data_map_handoff_revisions r ON r.revision_id=a.revision_id LEFT JOIN data_map_handoff_drafts d ON d.handoff_id=r.handoff_id
        WHERE d.package_id=? OR a.publication_id IN (SELECT publication_id FROM data_map_publications WHERE JSON_UNQUOTE(JSON_EXTRACT(manifest_json,'$.package_id'))=?) ORDER BY a.created_at,a.approval_id`,[pkg.id,pkg.id]);
      const publications=await rows(db,`SELECT *,${utcDateTimeColumns('',['published_at'])} FROM data_map_publications WHERE JSON_UNQUOTE(JSON_EXTRACT(manifest_json,'$.package_id'))=? ORDER BY published_at,publication_id`,[pkg.id]);
      for(const row of revisions)if(digest(parse(row.snapshot_json))!==row.content_digest)throw failure('HANDOFF_CONTENT_INTEGRITY_CONFLICT');
      for(const row of publications)if(digest(parse(row.manifest_json))!==row.manifest_digest)throw failure('HANDOFF_PUBLICATION_INTEGRITY_CONFLICT');
      const events=await rows(db,`SELECT e.*,${utcDateTimeColumns('e',['created_at'])} FROM data_map_handoff_events e JOIN data_map_handoff_drafts d ON d.handoff_id=e.handoff_id WHERE d.package_id=? ORDER BY e.created_at,e.event_id`,[pkg.id]);
      const approvalViews=approvals.map(row=>{
        const event=events.find(entry=>entry.request_id===row.request_id&&parse(entry.payload_json)?.approval_id===row.approval_id);
        return {...parsedRow(row),actor_snapshot:event?parse(event.payload_json).actor_snapshot||null:null};
      });
      for(const draft of drafts)await sourceUpgrades.assessments(db,draft.handoff_id);
      for(const row of events)if(row.event_type==='source_upgrade_assessed'){
        const payload=parse(row.payload_json),sourcePackageId=payload.snapshot.comparison.source_package_id;
        try{await handoffActor(db,session,'read',{packageId:sourcePackageId,lock:false});}
        catch(error){if(error.statusCode!==403)throw error;
          row.payload_json=json({contract_version:sourceUpgrades.CONTRACT,source_package_id:sourcePackageId,assessment_digest:payload.snapshot_digest,source_context_redacted:true});}
      }
      const publicationEvents=await rows(db,`SELECT e.*,${utcDateTimeColumns('e',['created_at'])} FROM data_map_publication_events e JOIN data_map_publications p ON p.publication_id=e.publication_id WHERE JSON_UNQUOTE(JSON_EXTRACT(p.manifest_json,'$.package_id'))=? ORDER BY e.publication_id,e.event_no`,[pkg.id]);
      const corrections=await rows(db,`SELECT *,${timestampColumns('',['created_at'])},CAST(package_id AS CHAR) package_id FROM process_data_governance_corrections WHERE package_id=? ORDER BY created_at,correction_id`,[pkg.id]);
      const correctionRevisions=await rows(db,`SELECT r.*,${timestampColumns('r',['created_at'])} FROM process_data_governance_correction_revisions r JOIN process_data_governance_corrections c ON c.correction_id=r.correction_id WHERE c.package_id=? ORDER BY r.created_at,r.correction_revision_id`,[pkg.id]);
      const intakes=await rows(db,`SELECT *,${timestampColumns('',['created_at'])},CAST(package_id AS CHAR) package_id,CAST(original_review_id AS CHAR) original_review_id FROM process_data_governance_intakes WHERE package_id=? ORDER BY created_at,intake_id`,[pkg.id]);
      const facts=await rows(db,`SELECT *,${timestampColumns('',['created_at'])},CAST(package_id AS CHAR) package_id FROM process_data_governance_fact_versions WHERE package_id=? ORDER BY fact_id,revision_no`,[pkg.id]);
      const conflictIds=await rows(db,'SELECT conflict_id FROM data_map_handoff_conflicts WHERE package_id=? ORDER BY conflict_id',[pkg.id]);
      const conflictRecords=[];for(const row of conflictIds)conflictRecords.push(await conflicts.load(db,row.conflict_id,{lock:false}));
      const checkedFacts=new Set();for(const row of facts){const value=parse(row.snapshot_json);if(value.parent_kind==='handoff_conflict'&&!checkedFacts.has(row.fact_id)){await conflicts.loadFact(db,row.fact_id,{lock:false});checkedFacts.add(row.fact_id);}}
      const details=await rows(db,`SELECT v.*,${timestampColumns('v',['created_at'])},CAST(v.detail_id AS CHAR) detail_id FROM process_data_governance_detail_versions v JOIN process_data_governance_details d ON d.id=v.detail_id WHERE d.work_package_id=? ORDER BY v.detail_id,v.revision_no`,[pkg.id]);
      const restorationLinks=[];
      if(publications.length){
        const linked=await rows(db,`SELECT d.handoff_id,CAST(d.package_id AS CHAR) package_id,d.state current_handoff_state,r.revision_id,r.revision_no,${utcDateTimeColumns('r',['created_at'])},p.publication_id,
          JSON_UNQUOTE(JSON_EXTRACT(r.snapshot_json,'$.restores_publication_id')) restores_publication_id FROM data_map_handoff_revisions r JOIN data_map_handoff_drafts d ON d.handoff_id=r.handoff_id
          LEFT JOIN data_map_publications p ON p.handoff_revision_id=r.revision_id WHERE JSON_UNQUOTE(JSON_EXTRACT(r.snapshot_json,'$.restores_publication_id')) IN (${publications.map(()=>'?').join(',')}) ORDER BY d.package_id,r.handoff_id,r.revision_no`,publications.map(p=>p.publication_id));
        for(const link of linked){try{
          await handoffActor(db,session,'read',{packageId:link.package_id,lock:false});
          const target=await one(db,`SELECT v.document_title,v.edition,v.process_content_json,v.content_hash,p.source_content_hash
            FROM process_data_governance_work_packages p JOIN process_design_versions v ON v.id=p.process_version_id WHERE p.id=?`,[link.package_id]);
          const latest=link.publication_id?await one(db,'SELECT event_type FROM data_map_publication_events WHERE publication_id=? ORDER BY event_no DESC LIMIT 1',[link.publication_id]):null;
          restorationLinks.push({...link,...fixedSourcePresentation(target,target?.source_content_hash),publication_state:['published','withdrawn'].includes(latest?.event_type)?latest.event_type:null});
        }catch(error){if(error.statusCode!==403)throw error;}}
      }
      const sourcePresentation=fixedSourcePresentation(source,pkg.source_content_hash);
      return {schema_version:'data-map-trace-v1',package_id:pkg.id,source:{process_version_id:pkg.process_version_id,schema_version:source?.schema_version||null,source_hash:pkg.source_content_hash,current_stored_hash:source?.content_hash||null,status:source?.status||'missing',...sourcePresentation},
        work_package:{id:pkg.id,package_ref:pkg.package_ref,source_content_hash:pkg.source_content_hash,status:pkg.status,rule_version:pkg.rule_version,...sourcePresentation},
        detail_sources:detailSourcePresentation(source,pkg.source_content_hash,details),
        bindings:bindings.map(parsedRow),intakes:intakes.map(parsedRow),corrections:corrections.map(parsedRow),correction_revisions:correctionRevisions.map(parsedRow),fact_versions:facts.map(parsedRow),detail_versions:details.map(parsedRow),drafts:drafts.map(parsedRow),
        revisions:revisions.map(parsedRow),approvals:approvalViews,publications:publications.map(parsedRow),events:events.map(parsedRow),publication_events:publicationEvents.map(parsedRow),restoration_links:restorationLinks,conflicts:conflictRecords};
    });
  }
  async function tracePublication(publicationId,session) {
    const row=await resource(pool,'publication',publicationId);
    const result=await tracePackage(row.package_id,session);
    return {...result,selected_publication_id:uuid(publicationId)};
  }
  async function createConflict(handoffId,body,session) {
    bodyKeys(body,['expected_handoff_revision','kind','severity','subject_refs','difference','proposals','impact','basis','evidence_refs','affected_department_ids']);
    const scope=await scopeFor('handoff',uuid(handoffId),body,'conflict_open');
    return requests.execute('prepare',scope,body,session,async(db,control,reauthorize,context)=>{
      const header=await lockedHandoff(db,handoffId,scope),revision=await revisionRow(db,header),actor=await reauthorize();
      const result=await conflicts.open(db,{header,revision,body,actor,requestId:context.request_id});
      await event(db,handoffId,'conflict_opened',{conflict_id:result.conflict_id,conflict_revision:result.revision},actor,context);
      return {...result,handoff_revision:Number(header.current_revision)};
    });
  }
  async function conflictContext(db,scope) {
    const header=await lockedHandoff(db,scope.handoffId,scope),revision=await revisionRow(db,header),conflict=await conflicts.load(db,scope.conflictId);
    if(conflict.handoff_id!==header.handoff_id||conflict.package_id!==header.package_id)throw failure('HANDOFF_SCOPE_STALE');
    return {header,revision,conflict};
  }
  async function qualifyConflictTarget(db,personId,scope,action) {
    const target=await one(db,"SELECT CAST(person_id AS CHAR) person_id,CAST(account_id AS CHAR) account_id,CAST(auth_version AS CHAR) auth_version FROM user_accounts WHERE person_id=? FOR UPDATE",[id(personId)]);
    if(!target)throw failure('HANDOFF_CONFLICT_ASSIGNEE_UNAVAILABLE',422);
    return handoffActor(db,{personId:target.person_id,accountId:target.account_id,authVersion:target.auth_version},action,{packageId:scope.packageId,conflictId:scope.conflictId,writeFields:[]});
  }
  async function actConflict(conflictId,body,session) {
    const definitions={viewpoint:{policy:'conflict_viewpoint',fields:['viewpoint']},assign:{policy:'review',fields:['assignee_person_id']},
      resolve:{policy:'coordinate',fields:['resolution']},escalate:{policy:'escalate',fields:['decision_person_id','severity']},
      decide:{policy:'decide',fields:['resolution']},verify:{policy:'prepare',fields:['fact_recheck']},reopen:{policy:'review',fields:[]}};
    if(!Object.hasOwn(definitions,body?.action))throw failure('HANDOFF_CONFLICT_ACTION_INVALID',422);
    const definition=definitions[body.action];
    bodyKeys(body,['action','expected_handoff_revision','basis','evidence_refs',...definition.fields]);
    const scope=await scopeFor('conflict',uuid(conflictId),body,'conflict_'+body.action);
    return requests.execute(definition.policy,scope,body,session,async(db,control,reauthorize,context)=>{
      await packageLocks(db,scope);const actor=await reauthorize(),loaded=await conflictContext(db,scope);
      const result=await conflicts.act(db,{...loaded,body,actor,requestId:context.request_id});
      let target;
      if(body.action==='assign')target=await qualifyConflictTarget(db,body.assignee_person_id,scope,'conflict');
      if(body.action==='escalate')target=await qualifyConflictTarget(db,body.decision_person_id,scope,'decide');
      let handoffRevision=Number(loaded.header.current_revision);
      if(body.action==='verify'){
        const refreshed=await append(db,loaded.header,parse(loaded.revision.snapshot_json),loaded.revision.binding_id,actor);
        handoffRevision=Number(refreshed.revision_no);
      }
      await event(db,loaded.header.handoff_id,'conflict_'+body.action,{conflict_id:result.conflict_id,conflict_revision:result.revision,
        handoff_revision:handoffRevision,...(target?{target_qualification:target.qualificationSnapshot}:{})},actor,context);
      return {...result,handoff_revision:handoffRevision};
    });
  }
  async function conflictFactAction(operation,resourceId,body,session) {
    const create=operation==='openFact',allowed={openFact:['detail_ref','target_department_id','requested_fact_type','question_text','request_reason','evidence_refs'],
      answerFact:['answer_text','evidence_refs'],confirmFact:['answered_fact_version_id','answered_snapshot_digest','basis','evidence_refs'],closeFact:['basis','evidence_refs']};
    bodyKeys(body,['expected_handoff_revision','expected_conflict_revision',...allowed[operation]]);
    const scope=await scopeFor(create?'conflict':'fact',uuid(resourceId),body,'conflict_'+operation);
    if(!create&&scope.factKind!=='handoff_conflict')throw failure('HANDOFF_FACT_SCOPE_DENIED',403);
    const policy={openFact:'prepare',answerFact:'fact_answer',confirmFact:'fact_confirm',closeFact:'fact_close'}[operation];
    return requests.execute(policy,scope,body,session,async(db,control,reauthorize,context)=>{
      await packageLocks(db,scope);const actor=await reauthorize(),loaded=await conflictContext(db,scope),fact=create?null:await conflicts.loadFact(db,resourceId);
      const result=await conflicts[operation](db,{...loaded,fact,body,actor,requestId:context.request_id});
      await event(db,loaded.header.handoff_id,'conflict_fact_'+operation,{conflict_id:scope.conflictId,fact_id:result.fact_id,
        fact_version_id:result.fact_version_id,conflict_revision:result.conflict_revision},actor,context);
      return {...result,handoff_revision:Number(loaded.header.current_revision)};
    });
  }
  async function factAction(operation,factId,body,session) {
    const row=await resource(pool,'fact',uuid(factId));
    if(parse(row.snapshot_json).parent_kind==='handoff_conflict')return conflictFactAction(operation,factId,body,session);
    if(operation==='confirmFact')throw failure('HANDOFF_FACT_CONFIRMATION_ENTRY_REQUIRED',409);
    return legacyAction(operation,'fact',uuid(factId),body,session,operation==='answerFact'?'fact_answer':'fact_close');
  }
  function conflictAllowed(actor,conflict,header) {
    const allowed=['read'];
    if(String(env.DATA_MAP_HANDOFF_ENABLED||'0')!=='1'||String(env.PROCESS_DATA_GOVERNANCE_READ_ONLY||'0')==='1'||actor.roleCodes.has('admin')||header.state==='published'||!conflict.history_complete)return allowed;
    const lead=actor.roleCodes.has('mdm_lead')&&actor.permissions.has('governance:assign-work')&&actor.permissions.has('governance:structure-gate');
    const steward=actor.roleCodes.has('mdm_steward')&&actor.permissions.has('governance:handle-assigned-work')&&actor.permissions.has('governance:read-assigned-context')&&actor.qualificationSnapshot?.assignment?.person_id===actor.personId;
    const handler=actor.roleCodes.has('data_conflict_handler')&&actor.permissions.has('governance:handle-assigned-conflict')&&conflict.assignee_person_id===actor.personId;
    const decider=actor.roleCodes.has('decision_group')&&actor.permissions.has('governance:decide-escalation')&&actor.permissions.has('governance:read-escalated-context')&&conflict.decision_person_id===actor.personId;
    if(['open','escalated'].includes(conflict.state)){
      if(lead||steward||handler)allowed.push('viewpoint');
      if(lead)allowed.push('assign');
      if(handler&&actor.permissions.has('governance:escalate-conflict'))allowed.push('escalate');
      if((lead||handler)&&conflict.state==='open'&&conflict.snapshot.severity!=='major')allowed.push('resolve');
      if(decider&&conflict.state==='escalated')allowed.push('decide');
    }
    if(lead)allowed.push('reopen');
    if(lead||steward){allowed.push('open_fact');if(header.state==='draft'&&conflict.state==='resolved')allowed.push('verify');}
    return allowed;
  }
  async function readConflict(db,conflictId,session) {
    const control=await snapshotControl(db),scope=await resource(db,'conflict',uuid(conflictId));
    const actor=await handoffActor(db,session,'conflict_read',{packageId:scope.package_id,conflictId,lock:false});
    const record=await conflicts.load(db,conflictId,{lock:false});
    const header=await resource(db,'handoff',record.handoff_id),revision=await revisionRow(db,header),body=parse(revision.snapshot_json);
    const refs=record.snapshot?.subject_refs||[];
    return {conflict_id:record.conflict_id,handoff_id:record.handoff_id,package_id:record.package_id,revision:Number(record.revision_no),state:record.state,
      conflict:record.snapshot,events:record.events,history_complete:record.history_complete,compatibility:record.compatibility,
      current_handoff_revision:Number(header.current_revision),content_digest:revision.content_digest,
      subject_items:body.items.filter(item=>refs.includes(item.item_ref)),
      allowed_actions:control?.cutover_state==='controlled'?conflictAllowed(actor,record,header):['read']};
  }
  async function getConflict(conflictId,session) {return readDiscoverySnapshot(pool,db=>readConflict(db,uuid(conflictId),session));}
  async function listConflicts(handoffId,session) {
    return readDiscoverySnapshot(pool,async db=>{
      await snapshotControl(db);
      const header=await resource(db,'handoff',uuid(handoffId));
      await handoffActor(db,session,'read',{packageId:header.package_id,lock:false});
      const ids=await rows(db,'SELECT conflict_id FROM data_map_handoff_conflicts WHERE handoff_id=? ORDER BY conflict_id',[handoffId]);
      const result=[];for(const row of ids)result.push(await readConflict(db,row.conflict_id,session));
      return {handoff_id:handoffId,conflicts:result};
    });
  }
  async function getConflictFact(db,row,session,control) {
    const fact=await conflicts.loadFact(db,row.fact_id,{lock:false}),value=fact.snapshot,record=await conflicts.load(db,value.conflict_id,{lock:false});
    const scope={packageId:row.package_id,conflictId:value.conflict_id,departmentId:value.target_department_id,factRequestId:row.fact_id,factKind:'handoff_conflict'};
    const actor=await authorize(db,session,'fact_read',scope,{lock:false}),header=await resource(db,'handoff',value.handoff_id),revision=await revisionRow(db,header);
    const sameRound=value.round_id===record.snapshot?.round_id&&value.resolution_digest===record.snapshot?.resolution_digest&&value.binding_id===revision.binding_id,allowed=['read'];
    const writableNow=control?.cutover_state==='controlled'&&String(env.DATA_MAP_HANDOFF_ENABLED||'0')==='1'&&String(env.PROCESS_DATA_GOVERNANCE_READ_ONLY||'0')!=='1'&&!actor.roleCodes.has('admin')&&header.state!=='published'&&sameRound;
    if(writableNow){
      const mdm=actor.roleCodes.has('mdm_lead')&&actor.permissions.has('governance:structure-gate')||actor.roleCodes.has('mdm_steward')&&actor.qualificationSnapshot?.assignment?.person_id===actor.personId;
      if(mdm&&value.status==='confirmed')allowed.push('close');
      if(actor.departmentId===value.target_department_id&&value.status==='open'&&(actor.permissions.has('governance:draft-department')||actor.permissions.has('governance:review-department')))allowed.push('answer');
      if(actor.departmentId===value.target_department_id&&value.status==='answered'&&actor.roleCodes.has('department_mdm_reviewer')&&actor.permissions.has('governance:record-department-decision')){
        const department=await one(db,'SELECT CAST(final_responsible_person_id AS CHAR) id FROM departments WHERE id=?',[value.target_department_id]);
        if(department?.id===actor.personId)allowed.push('confirm');
      }
    }
    const sourceName=await conflictFactSource(db,row,value);
    return {...sourceName,fact_id:fact.fact_id,fact_version_id:fact.fact_version_id,package_id:row.package_id,conflict_id:value.conflict_id,handoff_id:value.handoff_id,
      revision:Number(fact.revision_no),binding_id:value.binding_id,snapshot_digest:fact.snapshot_digest,expected_conflict_revision:Number(record.revision_no),expected_handoff_revision:Number(header.current_revision),
      parent_kind:'handoff_conflict',status:value.status,phase:value.phase,detail_ref:value.detail_ref,target_department_id:value.target_department_id,
      requested_fact_type:value.requested_fact_type,question_text:value.question_text,request_reason:value.request_reason,answer_text:value.answer_text||null,
      evidence_refs:value.evidence_refs,confirmed_answer_version_id:value.confirmed_answer_version_id||null,confirmed_answer_digest:value.confirmed_answer_digest||null,
      confirmation_basis:value.confirmation_basis||null,confirmation_evidence_refs:value.confirmation_evidence_refs||[],close_basis:value.close_basis||null,
      closure_evidence_refs:value.closure_evidence_refs||[],applicability:value.binding_id!==revision.binding_id?'source_review_changed':sameRound?'current':'superseded_round_or_result',allowed_actions:allowed};
  }
  async function getFact(factId,session) {
    factId=uuid(factId);
    return readDiscoverySnapshot(pool,async db=>{
      const control=await snapshotControl(db);
      const row=await resource(db,'fact',uuid(factId)),fact=parse(row.snapshot_json);
      if(digest(fact)!==row.snapshot_digest||fact.fact_id!==factId)throw failure('HANDOFF_FACT_SNAPSHOT_DRIFT');
      if(fact.parent_kind==='handoff_conflict')return getConflictFact(db,row,session,control);
      let actor,mdmRead=false;
      try{actor=await handoffActor(db,session,'read',{packageId:row.package_id,lock:false});mdmRead=true;}
      catch(error){
        if(Number(error.statusCode)!==403)throw error;
        actor=await handoffActor(db,session,'fact_read',{packageId:row.package_id,factRequestId:factId,factKind:'handoff_correction',departmentId:id(fact.target_department_id),lock:false});
      }
      const parentKind=row.correction_id?'correction':'intake',parentId=row.correction_id||row.intake_id;
      const parent=await resource(db,parentKind,parentId);
      if(parent.package_id!==row.package_id)throw failure('HANDOFF_SCOPE_STALE');
      const allowed=['read'];
      if(control?.cutover_state==='controlled'&&String(env.DATA_MAP_HANDOFF_ENABLED||'0')==='1'&&String(env.PROCESS_DATA_GOVERNANCE_READ_ONLY||'0')!=='1'&&!actor.roleCodes.has('admin')) {
        if(!mdmRead&&fact.status==='open')allowed.push('answer');
        if(mdmRead&&fact.status==='answered'&&(actor.roleCodes.has('mdm_lead')||actor.roleCodes.has('mdm_steward')))allowed.push('close');
      }
      const sourceName=await legacyFactSource(db,row,fact,parent);
      return {...sourceName,fact_id:fact.fact_id,fact_version_id:row.fact_version_id,package_id:row.package_id,detail_id:fact.detail_id,detail_ref:fact.detail_ref,
        target_department_id:fact.target_department_id,revision:Number(row.revision_no),expected_parent_revision:Number(parent.current_revision),
        parent_kind:parentKind,parent_id:parentId,status:fact.status,requested_fact_type:fact.requested_fact_type,question_text:fact.question_text,
        request_reason:fact.request_reason,answer_text:fact.answer_text||null,evidence_refs:fact.evidence_refs||[],close_basis:fact.close_basis||null,
        closure_evidence_refs:fact.closure_evidence_refs||[],allowed_actions:allowed};
    });
  }
  async function capabilities(session,{packageId=null}={}) {
    return readSnapshot(pool,async db=>{
      const actor=await handoffActor(db,session,'read',{packageId,lock:false});
      const control=await readControl(db),schema=await inspectHandoffSchema(db);
      const model=await inspectHandoffAccessModel(db,{lock:false});
      return {contract_version:CONTRACT_VERSION,enabled:String(env.DATA_MAP_HANDOFF_ENABLED||'0')==='1',read_only:String(env.PROCESS_DATA_GOVERNANCE_READ_ONLY||'0')==='1',
        schema_ready:schema.ready,cutover_state:control.cutover_state,access_model:model,role_codes:[...actor.roleCodes],package_id:packageId};
    });
  }
  async function sourceUpgradeStatus(session,{packageId=null,targetVersionId=null}={}) {
    return readDiscoverySnapshot(pool,async db=>{
      await snapshotControl(db);
      // Read discovery must not acquire assignment/identity write locks before
      // its package reads. Mutations recheck current authority under graph locks.
      await handoffActor(db,session,'read',{packageId:packageId?id(packageId):null,lock:false});
      const result=await sourceUpgrades.prompts(db,{packageId:packageId?id(packageId):null,targetVersionId:targetVersionId?id(targetVersionId):null});
      if(result.target_package_id&&result.target_package_id!==String(packageId))await handoffActor(db,session,'read',{packageId:result.target_package_id,lock:false});
      return result;
    });
  }
  async function assessSourceUpgrade(handoffId,body,session) {
    bodyKeys(body,['source_package_id','source_binding_id','comparison_digest','basis','evidence_refs','decisions']);
    const scope=await scopeFor('handoff',uuid(handoffId),body,'source_upgrade_assessment',{sourcePackageId:id(body.source_package_id)});
    return requests.execute('prepare',scope,body,session,async(db,control,reauthorize,context)=>{
      const header=await lockedHandoff(db,handoffId,scope);assertRevision(header,body.expected_revision);assertState(header,['draft']);
      const current=await revisionRow(db,header),actor=await reauthorize();
      const head=await one(db,'SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=? FOR SHARE',[header.package_id]);
      if(head?.binding_id!==current.binding_id)throw failure('HANDOFF_REVIEW_BINDING_STALE');
      const assessment=await sourceUpgrades.record(db,{header,revision:current,input:body,actor,context});
      const saved=await append(db,header,parse(current.snapshot_json),current.binding_id,actor);
      return actionResult(header,saved,'draft',{business_outcome:'source_upgrade_assessed',assessment_event_id:assessment.event_id,assessment_digest:assessment.snapshot_digest});
    });
  }
  async function getSourceUpgradeAssessments(handoffId,session) {
    return readDiscoverySnapshot(pool,async db=>{
      await snapshotControl(db);const header=await resource(db,'handoff',uuid(handoffId));
      await handoffActor(db,session,'read',{packageId:header.package_id,lock:false});
      const history=await sourceUpgrades.assessments(db,handoffId);
      for(const entry of history)await handoffActor(db,session,'read',{packageId:entry.snapshot.comparison.source_package_id,lock:false});
      const revision=await revisionRow(db,header);
      return {handoff_id:handoffId,package_id:header.package_id,current_revision:Number(header.current_revision),assessments:history,
        current:await sourceUpgrades.dependency(db,{handoffId,body:parse(revision.snapshot_json),bindingId:revision.binding_id,packageId:header.package_id})};
    });
  }
  return {fromWorkPackage,get,saveDraft,rebase:(handoffId,body,session)=>saveDraft(handoffId,body,session,{rebase:true}),submit,checks,approve,publish,withdraw,getPublication,restorePublication,
    withdrawalChecks:(publicationId,body,session)=>publicationAction(publicationId,body,session,'withdrawal_checks'),
    approveWithdrawal:(publicationId,body,session)=>publicationAction(publicationId,body,session,'withdrawal_approval'),
    withdrawPublication:(publicationId,body,session)=>publicationAction(publicationId,body,session,'withdraw_publication'),
    receipt:requests.receipt,tracePackage,tracePublication,getFact,capabilities,assertNoCommittedEffects,createConflict,actConflict,getConflict,listConflicts,
    sourceUpgradeStatus,assessSourceUpgrade,getSourceUpgradeAssessments,
    createConflictFact:(conflictId,body,session)=>conflictFactAction('openFact',conflictId,body,session),
    confirmFact:(factId,body,session)=>factAction('confirmFact',factId,body,session),
    prepareIntake:(packageId,body,session)=>legacyAction('prepareIntake','work_package',id(packageId),body,session,'prepare'),
    reviewIntake:(intakeId,body,session)=>legacyAction('reviewIntake','intake',uuid(intakeId),body,session,'review'),
    createCorrection:(packageId,body,session)=>legacyAction('createCorrection','work_package',id(packageId),body,session,'prepare'),
    saveCorrection:(correctionId,body,session)=>legacyAction('saveCorrection','correction',uuid(correctionId),body,session,'prepare'),
    reviewCorrection:(correctionId,body,session)=>legacyAction('reviewCorrection','correction',uuid(correctionId),body,session,'review'),
    createFact:(parentId,body,session,{kind='correction'}={})=>{
      if(!['intake','correction'].includes(kind))throw failure('HANDOFF_SCOPE_INVALID',400);
      const key=kind==='intake'?'intake_id':'correction_id',parent=uuid(parentId);
      if(body&&body[key]&&uuid(body[key])!==parent)throw failure('HANDOFF_SCOPE_CONFLICT');
      return legacyAction('createFact',kind,parent,{...body,[key]:parent},session,'prepare');
    },
    answerFact:(factId,body,session)=>factAction('answerFact',factId,body,session),
    closeFact:(factId,body,session)=>factAction('closeFact',factId,body,session)};
}

module.exports={createDataMapHandoffRepository,writeFields:fields};
