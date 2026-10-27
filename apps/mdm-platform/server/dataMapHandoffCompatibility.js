// Compatibility reads never claim a legacy approval and never hydrate from current physical values.
const {id,parse,digest,json}=require('./dataMapDefinitionValues');
const {failure,readControl,clientUpgrade}=require('./dataMapHandoffControl');
const reader=require('./dataMapEffectiveReader');
function independentAsset(assetKind,assetId,{versionRef=null,historyCompleteness='current_record_only'}={}){
  const table={legacy_mapping:'mdm_mapping_records',spreadsheet_publication:'mdm_publications'}[assetKind];
  if(!table)throw failure('HANDOFF_LEGACY_IDENTITY_REQUIRED',400);
  return {source_identity:{table,primary_key:{id:String(assetId)}},view:versionRef?'history':'legacy_in_use',fixed_version_ref:versionRef,history_completeness:historyCompleteness,governance_status:'legacy_unapproved',map_approval_generated:false,referenceable:false,new_reference_allowed:false,requires_attention:historyCompleteness==='current_record_only',compatibility_issues:historyCompleteness==='current_record_only'?[{code:'HISTORICAL_CONTEXT_NOT_RECONSTRUCTED'}]:[]};
}
async function captureLegacy(db,{assetKind,assetId,versionRef,snapshot,originalStatus=null,historyCompleteness='captured_current_only'}) {
  if(typeof assetKind!=='string'||!assetKind||typeof versionRef!=='string'||!versionRef)throw failure('HANDOFF_LEGACY_IDENTITY_REQUIRED',400);
  assetId=id(assetId);const hash=digest(snapshot);
  const [[prior]]=await db.execute('SELECT snapshot_digest FROM data_map_legacy_registry WHERE asset_kind=? AND asset_id=? AND version_ref=? FOR SHARE',[assetKind,assetId,versionRef]);
  if(prior){if(prior.snapshot_digest!==hash)throw failure('HANDOFF_LEGACY_SNAPSHOT_CONFLICT',409);return {replayed:true,snapshot_digest:hash};}
  await db.execute('INSERT INTO data_map_legacy_registry(asset_kind,asset_id,version_ref,snapshot_json,snapshot_digest,original_status,history_completeness,captured_at) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',[assetKind,assetId,versionRef,json(snapshot),hash,originalStatus,historyCompleteness]);
  return {replayed:false,snapshot_digest:hash};
}
async function requireExplicitView(db,view){await readControl(db);if(!['current','history','legacy_in_use'].includes(view))clientUpgrade();return view;}
async function relatedHistoryContext(db,assetKind,assetId){
  try{
    const [[row]]=await db.execute("SELECT snapshot_json,snapshot_digest,history_completeness FROM data_map_legacy_registry WHERE asset_kind=? AND asset_id=? AND version_ref='recorded_context'",[assetKind,String(assetId)]);
    if(!row)return {history_context_status:'unknown',field_name_a:null,field_name_b:null,a1_code:null};
    const snapshot=parse(row.snapshot_json);
    if(digest(snapshot)!==row.snapshot_digest)throw failure('HANDOFF_LEGACY_INTEGRITY_CONFLICT',409);
    // A migration-time capture cannot assert what a record displayed at its creation.
    if(row.history_completeness!=='recorded_at_creation')return {history_context_status:'unknown',field_name_a:null,field_name_b:null,a1_code:null};
    return {field_name_a:snapshot.field_name_a??null,field_name_b:snapshot.field_name_b??null,a1_code:snapshot.a1_code??null,history_context_status:'fixed_recorded_snapshot'};
  }catch(error){if(!['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error.code))throw error;return {history_context_status:'unavailable',field_name_a:null,field_name_b:null,a1_code:null};}
}
async function listDefinitions(db,{entityType,departmentId=null,after=null,search='',limit=100,view='current',objectId=null,contextId=null}) {
  if(typeof db.getConnection==='function')return require('./dataMapHandoffControl').readSnapshot(db,connection=>listDefinitions(connection,{entityType,departmentId,after,search,limit,view,objectId,contextId}));
  await requireExplicitView(db,view);
  if(view!=='current')clientUpgrade();
  if(!['object','field'].includes(entityType)||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw failure('HANDOFF_QUERY_INVALID',400);
  // Authorization uses preserved ownership; content and ordering never use the physical projection.
  const [heads]=await db.execute(`SELECT CAST(subject_id AS CHAR) subject_id FROM data_map_effective_heads WHERE subject_kind=? AND availability='active'${after?' AND subject_id>?':''} ORDER BY subject_id`,[entityType,...(after?[id(after)]:[])]);
  const result=[];for(const head of heads){const value=await reader.readDefinition(db,{entityType,entityId:head.subject_id,view});
    const row=value.base_snapshot?.row;
    if(objectId&&String(row?.object_id)!==String(objectId)||contextId&&String(row?.context_id)!==String(contextId))continue;
    let dept=entityType==='object'?row?.owner_dept_id:row?.dept_id||value.base_snapshot?.context?.dept_id;
    if(departmentId&&!dept&&row?.context_id){const [[context]]=await db.execute('SELECT CAST(dept_id AS CHAR) dept_id FROM data_map_contexts WHERE id=? FOR SHARE',[row.context_id]);dept=context?.dept_id;}
    if(departmentId&&String(dept)!==String(departmentId))continue;
    if(search&&!String(value.definition?.name||'').includes(search))continue;
    result.push(value);if(result.length>limit)break;
  }
  return {items:result.slice(0,limit),next:result.length>limit?result[limit-1].entity_id:null,view};
}
module.exports={captureLegacy,requireExplicitView,listDefinitions,relatedHistoryContext,independentAsset,readDefinition:reader.readDefinition};
