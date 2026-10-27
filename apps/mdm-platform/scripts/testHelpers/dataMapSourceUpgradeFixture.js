// Synthetic Q9 sources; callers must supply a fresh owned isolated MySQL.
const crypto=require('node:crypto');
const {digest,json,parse}=require('../../server/dataMapHandoffPolicy');
const native=require('../../server/processDataGovernance');
const {createDataMapHandoffRepository}=require('../../server/dataMapHandoffRepository');
const {makeProcessDataGovernanceRepository}=require('../../server/processDataGovernanceRepository');
const request=value=>({request_id:crypto.randomUUID(),...value});
const proof={basis:'Synthetic current source and evidence explicitly rechecked',evidence_refs:['synthetic:q9:current-evidence']};
function documents(processRef){
  const object=(ref,name)=>({data_ref:ref,data_name:name,description:'Synthetic '+name,information_type:'record',
    fields:[{field_ref:ref+'_id',field_name:'Synthetic identifier',field_type:'string',required:true,definition:'Stable synthetic identifier'}],
    behavior_links:[],source_relations:[],lifecycle:{routes:[]}});
  const old={schema_version:'process-governance-v8',export_meta:{package_ref:'synthetic_old',exported_at:'2026-10-01T00:00:00.000Z',initiating_department:'Synthetic A',compiler:'Synthetic author'},
    process:{process_ref:processRef,process_name:'Synthetic Q9',owning_department:'Synthetic A',purpose:'Synthetic upgrade validation'},behaviors:[],flow_relations:[],
    data_objects:[object('stable','Stable'),object('modified','Modified'),object('deleted','Deleted')]};
  const next=structuredClone(old);next.export_meta.package_ref='synthetic_new';next.export_meta.exported_at='2026-10-20T00:00:00.000Z';
  next.data_objects=next.data_objects.filter(x=>x.data_ref!=='deleted');next.data_objects.find(x=>x.data_ref==='modified').fields[0].required=false;
  next.data_objects.push(object('added','Added'));return {old,next};
}
async function seedSources(pool,{leadId='11',base=1100}={}){
  const documentId=String(base),oldVersionId=String(base+1),newVersionId=String(base+2),processRef='synthetic_q9_'+base,{old,next}=documents(processRef);
  await pool.execute("INSERT INTO process_design_documents(id,document_no,document_title,owning_department_id,process_ref) VALUES(?,?,'Synthetic Q9',91,?)",[documentId,'SYN_Q9_'+base,processRef]);
  for(const [versionId,document,status] of [[oldVersionId,old,'superseded'],[newVersionId,next,'published']]){
    await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id) VALUES(?,?,?,'Synthetic Q9',?,'Synthetic Q9','synthetic','synthetic','synthetic',91)",[versionId,documentId,'SYN_Q9_'+base,versionId]);
    await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,status) VALUES(?,?,?,?,'Synthetic Q9',?,?,91,?,?,?,?)",
      [versionId,versionId,documentId,'SYN_Q9_'+base,versionId,'SYN_Q9_VER_'+versionId,document.schema_version,json(document),digest(document),status]);
  }
  await pool.execute('UPDATE process_design_documents SET current_version_id=? WHERE id=?',[newVersionId,documentId]);
  await pool.execute("INSERT INTO process_data_governance_work_packages(id,package_ref,process_version_id,source_document_id,owning_department_id,source_content_hash,rule_version,risk_basis_json,status,created_by_person_id) VALUES(?,?,?,?,91,?,?,'{}','completed',?)",
    [oldVersionId,'SYN_Q9_PKG_'+oldVersionId,oldVersionId,documentId,digest(old),native.RULE_VERSION,leadId]);
  for(const item of native.buildGovernanceCandidates(old))await pool.execute(`INSERT INTO process_data_governance_details
    (work_package_id,detail_ref,detail_type,source_ref,parent_source_ref,responsible_department_id,source_snapshot_digest,candidate_rule_code,candidate_json,governance_json,status)
    VALUES(?,?,?,?,?,91,?,?,?,?,?)`,[oldVersionId,item.detail_ref,item.detail_type,item.source_ref,item.parent_source_ref,item.source_digest,item.rule_code,json(item.candidate),
    json({basis:'Synthetic reviewed old conclusion',scope:'previous exact '+item.detail_ref}),item.detail_type==='data_object_identity'?'confirmed':'not_applicable']);
  await pool.execute("INSERT INTO process_data_governance_reviews(work_package_id,review_type,decision,basis_text,package_revision_no,actor_person_id,actor_role_code) VALUES(?,'mdm_workgroup','approved','Synthetic original reviewed source',1,?,'mdm_lead')",[oldVersionId,leadId]);
  return {documentId,oldVersionId,newVersionId,oldPackageId:oldVersionId,processRef,old,next};
}
async function setup(target,{preseeded=false,lead=null,base=1100,reviewOld=true}={}){
  const {pool}=target;let seed;
  if(!preseeded)seed=await require('./dataMapHandoffFixture').seed(target);
  const actor=lead||seed.session('11'),repo=createDataMapHandoffRepository(pool,{env:{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}}),nativeRepo=makeProcessDataGovernanceRepository(pool);
  const source=await seedSources(pool,{leadId:actor.personId,base});
  let oldReview=null;
  if(reviewOld){const intake=await repo.prepareIntake(source.oldPackageId,request({expected_revision:0}),actor);
    oldReview=await repo.reviewIntake(intake.intake_id,request({expected_revision:1,basis:proof.basis,
      detail_evidence:intake.required_detail_evidence.map(x=>({...x,...proof}))}),actor);}
  async function createNewPackage({versionId=source.newVersionId}={}){
    const created=await nativeRepo.queueAndMaterialize(versionId,actor),newPackageId=String(created.package.id);
    const generated=await nativeRepo.generateCandidates(newPackageId,Number(created.package.revision_no),actor,{request_id:crypto.randomUUID()});
    let version=Number(generated.package.revision_no);
    const [details]=await pool.execute('SELECT CAST(id AS CHAR) id,detail_type,detail_ref FROM process_data_governance_details WHERE work_package_id=? ORDER BY id',[newPackageId]);
    for(const item of details){
      const result=await nativeRepo.updateDetail(newPackageId,item.id,version,{status:item.detail_type==='data_object_identity'?'confirmed':'not_applicable',responsible_department_id:'91',
        governance:{basis:'Synthetic separately rechecked new source '+item.detail_ref,scope:'current exact '+item.detail_ref}},actor,{request_id:crypto.randomUUID()});
      version=Number(result.package.revision_no);
    }
    const reviewed=await nativeRepo.completeWorkPackage(newPackageId,version,proof.basis,actor,{request_id:crypto.randomUUID()});
    const bound=(await pool.execute('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=?',[reviewed.handoff.binding_id]))[0][0];
    const binding=parse(bound.snapshot_json),body=require('./dataMapHandoffFixture').draftBody();
    const confirmed=binding.detail_versions.filter(x=>x.status==='confirmed').map(x=>x.detail_ref);
    for(const item of body.items)item.source_detail_refs=confirmed;
    body.dispositions=binding.detail_versions.filter(x=>x.status!=='confirmed').map(x=>({detail_ref:x.detail_ref,operation:x.status,basis:x.governance.basis}));
    const draft=await repo.fromWorkPackage(newPackageId,request({expected_revision:0,binding_id:reviewed.handoff.binding_id,draft:body}),actor);
    return {newPackageId,newBindingId:reviewed.handoff.binding_id,draft,body,created,generated,reviewed};
  }
  async function assessmentBody(draft){
    const current=await repo.get(draft.handoff_id,actor),comparison=await repo.sourceUpgradeStatus(actor,{packageId:source.oldPackageId,targetVersionId:source.newVersionId});
    const oldBinding=oldReview?parse((await pool.execute('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=?',[oldReview.binding_id]))[0][0].snapshot_json):null;
    const newBinding=parse((await pool.execute('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=?',[current.revision.binding_id]))[0][0].snapshot_json);
    return request({expected_revision:Number(current.header.current_revision),source_package_id:source.oldPackageId,source_binding_id:oldReview?.binding_id||null,comparison_digest:comparison.comparison_digest,...proof,
      decisions:comparison.changes.map(change=>({detail_ref:change.detail_ref,change_kind:change.change_kind,decision:change.change_kind==='unchanged'&&oldReview?'reference_and_recheck':change.change_kind==='deleted'?'remove':'recheck',
        ...(oldBinding?.detail_versions.find(x=>x.detail_ref===change.detail_ref)?{source_detail_version_id:oldBinding.detail_versions.find(x=>x.detail_ref===change.detail_ref).detail_version_id}:{}),
        ...(newBinding.detail_versions.find(x=>x.detail_ref===change.detail_ref)?{target_detail_version_id:newBinding.detail_versions.find(x=>x.detail_ref===change.detail_ref).detail_version_id}:{}),
        reuse_scope:change.change_kind==='unchanged'&&oldReview?['/scope']:[],...proof,rechecks:Object.fromEntries(['facts','conclusions','shared_definitions','impact'].map(key=>[key,proof]))}))});
  }
  return {pool,repo,nativeRepo,actor,source,oldReview,createNewPackage,assessmentBody};
}
module.exports={setup,seedSources,documents,request,proof};
