const {failure,verify,parse,id,json} = require('./dataMapHandoffPolicy');
const {handoffActor}=require('./dataMapHandoffAuthority');
async function loadFixedSource(db,workPackage,{lock=true}={}) {
  const [[row]]=await db.execute(`SELECT v.*,CAST(v.id AS CHAR) id,CAST(v.document_id AS CHAR) document_id
    FROM process_design_versions v WHERE v.id=?${lock?' FOR SHARE':''}`,[id(workPackage.process_version_id)]);
  if(!row || !['published','superseded'].includes(row.status))throw failure('HANDOFF_SOURCE_NOT_FIXED');
  const document=parse(row.process_content_json);
  if(!require('./processNativeFormats').supports(row.schema_version)||document.schema_version!==row.schema_version)throw failure('HANDOFF_SOURCE_UNSUPPORTED');
  verify(document,row.content_hash);
  if(row.content_hash!==workPackage.source_content_hash)throw failure('HANDOFF_SOURCE_DIGEST_MISMATCH');
  return row;
}
function createLegacyAdapter({writeFields}={}){
  const {createDataMapHandoffLegacy}=require('./dataMapHandoffLegacy');
  const authorize=(db,actor,action,pkg,scope={})=>handoffActor(db,actor,action,{packageId:pkg.id,departmentId:scope.target_department_id||null,factRequestId:scope.factRequestId||scope.fact?.fact_id||null,factKind:scope.factKind||'handoff_correction',writeFields});
  const base=createDataMapHandoffLegacy({authorize,loadSource:loadFixedSource});
  return createDataMapHandoffLegacy({authorize,loadSource:loadFixedSource,bindReview:async(db,snapshot,actor,context)=>{
    const [[head]]=await db.execute('SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=? FOR UPDATE',[snapshot.package_id]);
    if((snapshot.binding_kind==='correction_review' && head?.binding_id!==snapshot.replaces_binding_id) || (snapshot.binding_kind!=='correction_review' && head))throw failure('HANDOFF_REVIEW_BINDING_STALE');
    const result=await base.bindReview(db,snapshot,actor,context);
    await db.execute(`INSERT INTO data_map_handoff_binding_heads(package_id,binding_id,head_revision) VALUES(?,?,1)
      ON DUPLICATE KEY UPDATE binding_id=VALUES(binding_id),head_revision=head_revision+1`,[snapshot.package_id,result.binding_id]);
    return result;
  }});
}
async function binding(db,bindingId,packageId){
  const [[row]]=await db.execute('SELECT b.*,CAST(package_id AS CHAR) package_id FROM process_data_governance_review_bindings b WHERE binding_id=? FOR SHARE',[bindingId]);
  if(!row||row.package_id!==String(packageId))throw failure('HANDOFF_REVIEW_BINDING_INVALID');
  const snapshot=verify(parse(row.snapshot_json),row.binding_digest);
  return {...row,snapshot};
}
module.exports={loadFixedSource,createLegacyAdapter,binding};
