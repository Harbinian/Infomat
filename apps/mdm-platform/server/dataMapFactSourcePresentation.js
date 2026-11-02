const {digest,parse,failure}=require('./dataMapHandoffPolicy');
const {binding,loadFixedSource}=require('./dataMapHandoffBindings');
const {detailSourcePresentation}=require('./dataMapHandoffPresentation');

const rows=async(db,sql,args)=>(await db.execute(sql,args))[0];
const same=(left,right)=>left!=null&&right!=null&&String(left)===String(right);
const sameOptional=(left,right)=>left==null&&right==null||same(left,right);
const absent=()=>({detail_name:null,detail_name_source:null});
function verified(row,digestField='snapshot_digest'){
  const value=parse(row.snapshot_json);
  if(digest(value)!==row[digestField])throw failure('HANDOFF_LEGACY_SNAPSHOT_DRIFT');
  return value;
}
function named(value){
  return ['data_name','field_name','behavior_name'].map(key=>value?.[key])
    .filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()).join(' / ')||null;
}

// Call only after the exact fact's existing read authorization. This returns
// two optional display fields, never the binding, another detail or its facts.
async function displayDetail(db,packageId,snapshot,detail,provenance){
  if(!same(snapshot.package_id,packageId)||!detail?.detail_version_id)return absent();
  const versions=await rows(db,'SELECT *,CAST(detail_id AS CHAR) detail_id FROM process_data_governance_detail_versions WHERE detail_version_id=?',[detail.detail_version_id]);
  if(versions.length!==1)return absent();
  const original=verified(versions[0]),{detail_version_id,revision_no,...captured}=detail;
  if(!same(versions[0].detail_id,detail.detail_id)||digest(captured)!==versions[0].snapshot_digest||!same(original.detail_ref,detail.detail_ref))throw failure('HANDOFF_LEGACY_SNAPSHOT_DRIFT');
  const packages=await rows(db,'SELECT *,CAST(id AS CHAR) id,CAST(process_version_id AS CHAR) process_version_id FROM process_data_governance_work_packages WHERE id=?',[packageId]);
  if(packages.length!==1)return absent();
  const pkg=packages[0];
  if(!same(snapshot.process_version_id,pkg.process_version_id)||snapshot.source_hash!==pkg.source_content_hash)throw failure('HANDOFF_SOURCE_DIGEST_MISMATCH');
  let projection=[];
  try{
    const source=await loadFixedSource(db,pkg,{lock:false});
    projection=detailSourcePresentation(source,snapshot.source_hash,[{detail_version_id,snapshot_json:captured}]);
  }catch(error){
    // Optional source display must not hide an already authorized historical
    // question. An unavailable fixed source can only use the verified captured
    // name below, explicitly attributed to its historical record.
    if(!['HANDOFF_SOURCE_NOT_FIXED','HANDOFF_SOURCE_UNSUPPORTED','HANDOFF_SOURCE_DIGEST_MISMATCH','HANDOFF_CONTENT_INTEGRITY_CONFLICT'].includes(error.code))throw error;
  }
  const fixed=named(projection[0]?.source);
  if(fixed)return {detail_name:fixed,detail_name_source:'fixed_source'};
  const capturedName=named(detail.candidate);
  return capturedName?{detail_name:capturedName,detail_name_source:provenance}:absent();
}

async function conflictFactSource(db,row,fact){
  if(!fact.binding_id)return absent();
  const fixed=await binding(db,fact.binding_id,row.package_id),snapshot=fixed.snapshot;
  if(!same(snapshot.package_id,row.package_id))throw failure('HANDOFF_REVIEW_BINDING_INVALID');
  const matches=(snapshot.detail_versions||[]).filter(detail=>same(detail.detail_ref,fact.detail_ref));
  if(matches.length!==1)return absent();
  return displayDetail(db,row.package_id,snapshot,matches[0],'review_snapshot');
}

async function legacyFactSource(db,row,fact,parent){
  const firstRows=await rows(db,'SELECT *,CAST(package_id AS CHAR) package_id FROM process_data_governance_fact_versions WHERE fact_id=? AND revision_no=1',[fact.fact_id]);
  if(firstRows.length!==1)return absent();
  const first=firstRows[0],originalFact=verified(first);
  if(!same(first.package_id,row.package_id)||!sameOptional(first.correction_id,row.correction_id)||!sameOptional(first.intake_id,row.intake_id))throw failure('HANDOFF_SCOPE_STALE');
  if(!same(originalFact.fact_id,fact.fact_id)||!same(originalFact.detail_id,fact.detail_id)||!same(originalFact.detail_ref,fact.detail_ref))throw failure('HANDOFF_FACT_SNAPSHOT_DRIFT');
  let captured;
  if(row.correction_id){
    // Every fact write appends a parent revision under the same request. Read
    // its creation revision, not the correction's mutable current revision.
    const revisions=await rows(db,'SELECT * FROM process_data_governance_correction_revisions WHERE correction_id=? AND request_id=?',[row.correction_id,first.request_id]);
    if(revisions.length!==1)return absent();
    captured=verified(revisions[0]);
    if(!same(captured.fact_change?.fact_id,fact.fact_id)||!same(captured.fact_change?.fact_version_id,first.fact_version_id))return absent();
  }else{
    if(!row.intake_id||!same(parent.intake_id,row.intake_id))return absent();
    captured=verified(parent);
  }
  if(!same(captured.package_id,row.package_id))throw failure('HANDOFF_SCOPE_STALE');
  const matches=(captured.detail_versions||[]).filter(detail=>same(detail.detail_id,originalFact.detail_id)&&same(detail.detail_ref,originalFact.detail_ref));
  if(matches.length!==1)return absent();
  return displayDetail(db,row.package_id,captured,matches[0],'parent_snapshot');
}

module.exports={conflictFactSource,legacyFactSource};
