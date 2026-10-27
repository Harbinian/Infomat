// Read projection contract only. All rows and connections are synthetic;
// real authorization and MySQL routes are covered by the isolated UI suite.
const test=require('node:test'),assert=require('node:assert/strict');
const {digest}=require('../server/dataMapHandoffPolicy');
const {buildGovernanceCandidates}=require('../server/processDataGovernance');
const {conflictFactSource,legacyFactSource}=require('../server/dataMapFactSourcePresentation');

function fixture(){
  const document={schema_version:'process-governance-v8',process:{process_ref:'synthetic',process_name:'合成采购流程'},behaviors:[],data_objects:[{data_ref:'record',data_name:'合成采购记录',information_type:'record',fields:[],behavior_links:[],source_relations:[],lifecycle:{routes:[]}}]};
  const candidate=buildGovernanceCandidates(document).find(row=>row.detail_ref==='object:record');
  const core={detail_id:'10',detail_ref:candidate.detail_ref,detail_type:candidate.detail_type,source_ref:candidate.source_ref,parent_source_ref:null,responsible_department_id:'91',source_digest:candidate.source_digest,status:'confirmed',candidate:{...candidate.candidate,data_name:'原审核采购记录'},governance:{conclusion:'not part of the name response'}};
  const detail={...core,detail_version_id:'version-1',revision_no:1};
  const snapshot={package_id:'501',process_version_id:'901',source_hash:digest(document),detail_versions:[detail]};
  const firstFact={fact_id:'fact-1',detail_id:'10',detail_ref:'object:record',target_department_id:'91',status:'open'};
  const f={document,core,detail,snapshot,firstFact,queries:[]};
  f.bindingRow={package_id:'501',binding_id:'binding-1',snapshot_json:snapshot,binding_digest:digest(snapshot)};
  f.versionRow={detail_id:'10',snapshot_json:structuredClone(core),snapshot_digest:digest(core)};
  f.packageRow={id:'501',process_version_id:'901',source_content_hash:digest(document)};
  f.sourceRow={id:'901',status:'superseded',schema_version:document.schema_version,process_content_json:document,content_hash:digest(document)};
  f.firstRow={fact_id:'fact-1',fact_version_id:'fact-version-1',package_id:'501',correction_id:null,intake_id:'intake-1',request_id:'request-1',snapshot_json:firstFact,snapshot_digest:digest(firstFact)};
  f.parent={intake_id:'intake-1',package_id:'501',snapshot_json:snapshot,snapshot_digest:digest(snapshot)};
  f.refresh=()=>{f.detail={...structuredClone(f.core),detail_version_id:'version-1',revision_no:1};f.snapshot.detail_versions[0]=f.detail;f.bindingRow.snapshot_json=f.snapshot;f.bindingRow.binding_digest=digest(f.snapshot);f.versionRow.snapshot_json=structuredClone(f.core);f.versionRow.snapshot_digest=digest(f.core);f.parent.snapshot_json=f.snapshot;f.parent.snapshot_digest=digest(f.snapshot);};
  f.db={execute:async(sql,args)=>{f.queries.push({sql,args});assert.match(sql,/^SELECT /);let found;if(sql.includes('process_data_governance_review_bindings'))found=[f.bindingRow];else if(sql.includes('process_data_governance_detail_versions'))found=f.versionRow?[f.versionRow]:[];else if(sql.includes('process_data_governance_work_packages'))found=[f.packageRow];else if(sql.includes('process_design_versions'))found=[f.sourceRow];else if(sql.includes('process_data_governance_fact_versions'))found=f.firstRow?[f.firstRow]:[];else if(sql.includes('process_data_governance_correction_revisions'))found=f.correctionRows||[];else throw Error('Unexpected read: '+sql);return [structuredClone(found)];}};
  f.factRow={package_id:'501',intake_id:'intake-1',correction_id:null};
  f.fact={...firstFact,binding_id:'binding-1'};
  return f;
}

test('the exact verified fixed source outranks a different captured alias and exposes only a name and provenance',async()=>{
  const f=fixture(),before=structuredClone(f.snapshot),value=await conflictFactSource(f.db,{package_id:'501'},f.fact);
  assert.deepEqual(value,{detail_name:'合成采购记录',detail_name_source:'fixed_source'});assert.deepEqual(Object.keys(value).sort(),['detail_name','detail_name_source']);assert.deepEqual(f.snapshot,before);
  assert.deepEqual(f.queries.find(row=>row.sql.includes('review_bindings')).args,['binding-1']);
});
test('a legacy rule digest uses the original reviewed name without pretending it is the fixed source name',async()=>{
  const f=fixture();f.core.source_digest=digest({legacy_rule:'preserved'});f.refresh();
  assert.deepEqual(await conflictFactSource(f.db,{package_id:'501'},f.fact),{detail_name:'原审核采购记录',detail_name_source:'review_snapshot'});
});
test('duplicate detail matches do not borrow the first or currently named row',async()=>{
  const f=fixture();f.snapshot.detail_versions.push({...f.detail,detail_version_id:'later-version',candidate:{data_name:'不应读取的另一份名称'}});f.refresh();
  assert.deepEqual(await conflictFactSource(f.db,{package_id:'501'},f.fact),{detail_name:null,detail_name_source:null});assert.equal(f.queries.length,1);
});
test('a foreign package binding or self-inconsistent package snapshot fails closed',async()=>{
  const f=fixture();f.bindingRow.package_id='502';await assert.rejects(()=>conflictFactSource(f.db,{package_id:'501'},f.fact),error=>error.code==='HANDOFF_REVIEW_BINDING_INVALID');
  f.bindingRow.package_id='501';f.snapshot.package_id='502';f.refresh();await assert.rejects(()=>conflictFactSource(f.db,{package_id:'501'},f.fact),error=>error.code==='HANDOFF_REVIEW_BINDING_INVALID');
});
test('missing original detail version is a display gap; corrupted version or source is never used as a name',async()=>{
  const f=fixture();f.versionRow=null;assert.deepEqual(await conflictFactSource(f.db,{package_id:'501'},f.fact),{detail_name:null,detail_name_source:null});
  const broken=fixture();broken.versionRow.snapshot_json.candidate.data_name='漂移名称';await assert.rejects(()=>conflictFactSource(broken.db,{package_id:'501'},broken.fact),error=>error.code==='HANDOFF_LEGACY_SNAPSHOT_DRIFT');
  const source=fixture();source.sourceRow.content_hash='changed';assert.deepEqual(await conflictFactSource(source.db,{package_id:'501'},source.fact),{detail_name:'原审核采购记录',detail_name_source:'review_snapshot'});
});
test('intake fact reads preserve explicit original parent association and a minimal source projection',async()=>{
  const f=fixture();assert.deepEqual(await legacyFactSource(f.db,f.factRow,f.firstFact,f.parent),{detail_name:'合成采购记录',detail_name_source:'fixed_source'});
  f.firstRow=null;assert.deepEqual(await legacyFactSource(f.db,f.factRow,f.firstFact,f.parent),{detail_name:null,detail_name_source:null});
});
test('correction facts read their immutable creation revision instead of the latest correction',async()=>{
  const f=fixture();f.core.source_digest=digest({historical:true});f.refresh();f.firstRow.correction_id='correction-1';f.firstRow.intake_id=null;f.factRow={package_id:'501',correction_id:'correction-1',intake_id:null};
  const captured={...f.snapshot,fact_change:{fact_id:'fact-1',fact_version_id:'fact-version-1',revision_no:1}};
  f.correctionRows=[{snapshot_json:captured,snapshot_digest:digest(captured)}];
  const current={correction_id:'correction-1',snapshot_json:{candidate:{data_name:'不应借用的当前更正名称'}}};
  assert.deepEqual(await legacyFactSource(f.db,f.factRow,f.firstFact,current),{detail_name:'原审核采购记录',detail_name_source:'parent_snapshot'});
  assert.deepEqual(f.queries.find(row=>row.sql.includes('correction_revisions')).args,['correction-1','request-1']);
  f.correctionRows.push(f.correctionRows[0]);assert.deepEqual(await legacyFactSource(f.db,f.factRow,f.firstFact,current),{detail_name:null,detail_name_source:null});
});
test('changed fact detail or cross-parent history is not repaired by borrowing a current name',async()=>{
  const f=fixture();await assert.rejects(()=>legacyFactSource(f.db,f.factRow,{...f.firstFact,detail_id:'11'},f.parent),error=>error.code==='HANDOFF_FACT_SNAPSHOT_DRIFT');
  f.firstRow.package_id='502';await assert.rejects(()=>legacyFactSource(f.db,f.factRow,f.firstFact,f.parent),error=>error.code==='HANDOFF_SCOPE_STALE');
});
test('unavailable fixed sources retain verified historical names while unexpected read failures remain failures',async()=>{
  const f=fixture();f.sourceRow.status='unknown';assert.deepEqual(await conflictFactSource(f.db,{package_id:'501'},f.fact),{detail_name:'原审核采购记录',detail_name_source:'review_snapshot'});
  const broken=fixture(),execute=broken.db.execute;broken.db.execute=async(sql,args)=>{if(sql.includes('process_design_versions'))throw Object.assign(new Error('synthetic database unavailable'),{code:'SYNTHETIC_READ_FAILURE'});return execute(sql,args);};
  await assert.rejects(()=>conflictFactSource(broken.db,{package_id:'501'},broken.fact),error=>error.code==='SYNTHETIC_READ_FAILURE');
});
