// Explicit compatibility preparation. No environment lookup, pool creation,
// startup DDL, approval, binding or effective-head write. Original rows stay intact.
const {json,digest,parse}=require('./dataMapDefinitionValues');
const {readControl,failure}=require('./dataMapHandoffControl');
const {sourceValue}=require('./migrationSourceValues');
const CONTRACT='data-map-compatibility-v1';
const REQUIRED_HISTORY=Object.freeze({
  data_map_definition_versions:['definition_json','base_snapshot_json','content_digest','base_digest','digest_algorithm'],
  data_map_definition_heads:['current_version_id','revision_no'],
  data_map_source_files:['raw_sha256','raw_digest_status'],
  process_data_governance_details:['candidate_json','governance_json','revision_no'],
  process_data_governance_reviews:['basis_text','package_revision_no'],
  data_map_v7_mapping_versions:['snapshot_json','snapshot_digest'],
  data_map_design_handoff_versions:['snapshot_json','snapshot_digest'],
  data_map_analysis_runs:['manifest_json','manifest_digest']
});
const TABLES=Object.freeze([
  ['entities','data_map_objects','object'],['entities','data_map_contexts','context'],['entities','data_map_fields','field'],
  ['entities','data_map_field_identities','field_identity'],['entities','data_map_field_system_links','field_system_link'],
  ['entities','data_map_definition_versions','definition_version'],['entities','data_map_definition_heads','definition_head'],
  ['excel','data_map_import_batches','import_batch'],['excel','data_map_source_files','excel_source_file'],
  ['excel','data_map_source_cells','excel_source_cell'],['excel','data_map_source_mappings','excel_source_mapping'],
  ['excel','data_map_excel_evidence','excel_evidence'],['excel','data_map_word_evidence','word_evidence'],['excel','data_map_pdf_evidence','pdf_evidence'],
  ['independent_history','mdm_mapping_records','legacy_mapping'],['independent_history','mdm_mapping_system_links','legacy_mapping_system_link'],
  ['independent_history','mdm_mapping_related_departments','legacy_mapping_department'],['independent_history','mdm_mapping_approval_tasks','legacy_mapping_approval_task'],
  ['independent_history','mdm_mapping_approval_history','legacy_mapping_approval_history'],['independent_history','mdm_mapping_rejection_reasons','legacy_mapping_rejection'],
  ['independent_history','mdm_publications','spreadsheet_publication'],
  ['work_packages','process_design_versions','process_source_version'],
  ['work_packages','process_data_governance_work_packages','work_package'],['work_packages','process_data_governance_details','work_package_detail'],
  ['work_packages','process_data_governance_reviews','work_package_review'],['work_packages','process_data_governance_fact_requests','work_package_fact'],
  ['work_packages','process_data_governance_events','work_package_event'],
  ['fixed_mappings','data_map_v7_sources','fixed_source'],['fixed_mappings','data_map_v7_mappings','fixed_mapping'],['fixed_mappings','data_map_v7_mapping_versions','fixed_mapping_version'],
  ['fixed_consumers','data_map_design_handoffs','design_handoff'],['fixed_consumers','data_map_design_handoff_versions','design_handoff_version'],['fixed_consumers','data_map_design_handoff_refs','design_handoff_ref'],
  ['fixed_consumers','data_map_analysis_runs','analysis_run'],['fixed_consumers','data_map_analysis_inputs','analysis_input'],
  ['fixed_consumers','data_map_analysis_steps','analysis_step'],['fixed_consumers','data_map_analysis_attempts','analysis_attempt'],
  ['fixed_consumers','data_map_analysis_evidence','analysis_evidence'],['fixed_consumers','data_map_analysis_findings','analysis_finding'],
  ['fixed_consumers','data_map_analysis_finding_inputs','analysis_finding_input'],['fixed_consumers','data_map_analysis_finding_evidence','analysis_finding_evidence'],
  ['fixed_consumers','data_map_analysis_ai_outputs','analysis_ai_output']
].map(entry=>Object.freeze(entry)));
const safe=name=>{if(!/^[A-Za-z0-9_]+$/.test(name))throw failure('HANDOFF_COMPAT_IDENTIFIER_INVALID',409);return '`'+name+'`';};
async function target(db,options={},write=false){
  const {owner,database}=options;
  if(options.formalTargetPermit){
    const verified=await require('./governanceMigrationAuthorization').verifyMigrationPermit(db,options.formalTargetPermit,{write});
    if(verified.database!==database||!/^[0-9a-f-]{36}$/.test(owner||''))throw failure('HANDOFF_FORMAL_TARGET_MISMATCH',409);
    return {owner,database};
  }
  if(!/^[0-9a-f-]{36}$/.test(owner||'')||!/^stage\d{2}_isolated_[0-9a-f]{32}$/.test(database||'')||!database.endsWith(owner.replaceAll('-','')))throw failure('HANDOFF_ISOLATED_TARGET_REQUIRED',409);
  return {owner,database};
}
async function transact(pool,options,work,write=false){
  if(options.formalTargetPermit)require('./governanceMigrationAuthorization').validateMigrationPermit(options.formalTargetPermit,{write});
  else await target(null,options,write);
  if(typeof pool?.getConnection!=='function')throw failure('HANDOFF_COMPAT_POOL_REQUIRED',503);
  const db=await pool.getConnection();let committing=false,destroyed=false,expected;
  const discard=()=>{destroyed=true;db.destroy();};
  try{
    expected=await target(db,options,write);
    const [[actual]]=await db.execute('SELECT DATABASE() name');
    if(actual.name!==expected.database)throw failure('HANDOFF_ISOLATED_TARGET_REQUIRED',409);
    await db.execute("SET time_zone='+00:00'");await db.beginTransaction();
    const result=await work(db,expected);committing=true;await db.commit();return result;
  }catch(error){
    if(committing){discard();throw failure('HANDOFF_COMPAT_COMMIT_UNKNOWN',503,{manifest_ref:CONTRACT,owner:expected.owner});}
    try{await db.rollback();}catch{discard();throw failure('HANDOFF_COMPAT_ROLLBACK_UNKNOWN',503,{manifest_ref:CONTRACT,owner:expected.owner});}
    throw error;
  }finally{if(!destroyed)db.release();}
}
const binary=value=>Buffer.isBuffer(value)?{encoding:'hex',value:value.toString('hex')}:value;
const identity=(row,keys)=>Object.fromEntries(keys.map(key=>[key,row[key]]));
function recordId(row,keys){const values=identity(row,keys);return keys.length===1?String(row[keys[0]]):'key:'+digest(values);}
async function inventory(db,expected){
  const tables=[],records=[],exceptions=[],raw=new Map();
  for(const [group,table,assetKind]of TABLES){
    const [columns]=await db.execute(`SELECT COLUMN_NAME name,DATA_TYPE data_type,COLUMN_TYPE column_type,IS_NULLABLE nullable,COLUMN_DEFAULT original_default
      FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,[table]);
    if(!columns.length){tables.push({group,table,installed:false,count:0});exceptions.push({table,code:'TABLE_NOT_INSTALLED',history_recoverable:false});continue;}
    if(columns.some(column=>/password|secret|credential|private_key|api_key|token/i.test(column.name)))throw failure('HANDOFF_COMPAT_SENSITIVE_SCHEMA',409,{table});
    for(const field of REQUIRED_HISTORY[table]||[])if(!columns.some(column=>column.name===field))exceptions.push({table,field,code:'HISTORY_COLUMN_UNAVAILABLE',history_recoverable:false});
    const [primary]=await db.execute("SELECT COLUMN_NAME name FROM information_schema.key_column_usage WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION",[table]);
    if(!primary.length)throw failure('HANDOFF_COMPAT_STABLE_ID_REQUIRED',409,{table});
    const keys=primary.map(column=>column.name);
    const projection=columns.map(column=>/^(bigint|timestamp|datetime|date|time|decimal|json)$/.test(column.data_type)?`CAST(${safe(column.name)} AS CHAR) ${safe(column.name)}`:safe(column.name)).join(',');
    const [rows]=await db.execute('SELECT '+projection+' FROM '+safe(table)+' ORDER BY '+keys.map(safe).join(',')+' FOR SHARE');
    const values=rows.map(row=>Object.fromEntries(columns.map(column=>[column.name,binary(sourceValue(row[column.name],column))])));
    raw.set(table,values);tables.push({group,table,installed:true,count:values.length,primary_keys:keys,schema_digest:digest(columns),columns});
    for(const row of values){
      const assetId=recordId(row,keys),sourceIdentity={table,primary_key:identity(row,keys)};
      for(const column of columns){
        const value=row[column.name];
        if(value===null)exceptions.push({table,asset_id:assetId,field:column.name,code:'NULL_PRESERVED'});
        if(column.data_type==='datetime'&&value!==null)exceptions.push({table,asset_id:assetId,field:column.name,code:'ORIGINAL_DATETIME_ZONE_UNRECORDED'});
        if(column.name.endsWith('_json')&&typeof value==='string'){try{JSON.parse(value);}catch{exceptions.push({table,asset_id:assetId,field:column.name,code:'UNREADABLE_JSON_TEXT_PRESERVED'});}}
      }
      if(table==='data_map_source_files'&&row.raw_digest_status==='unavailable')exceptions.push({table,asset_id:assetId,field:'raw_sha256',code:'ORIGINAL_BYTES_UNAVAILABLE',bytes_generated:false});
      if(table==='data_map_definition_versions'&&row.source_kind==='governance'){exceptions.push({table,asset_id:assetId,code:'GOVERNED_VERSION_EXCLUDED_FROM_LEGACY_REGISTRY'});continue;}
      const sourceRefs=Object.fromEntries(['process_version_id','source_content_hash','source_hash','content_hash','source_snapshot_digest','content_digest','base_digest','digest_algorithm','platform_version_id','object_version_id','field_version_id','source_id'].filter(name=>Object.hasOwn(row,name)).map(name=>[name,row[name]]));
      records.push({group,asset_kind:assetKind,asset_id:assetId,snapshot:{row},source_identity:sourceIdentity,source_refs:sourceRefs,original_status:row.status==null?null:String(row.status),history_completeness:'captured_current_only'});
    }
    if(values.length)exceptions.push({table,code:'PRIOR_HISTORY_NOT_RECONSTRUCTED',history_recoverable:false});
  }
  // Preserve field rows and every identity/link as one authoritative capture,
  // matching the existing fixed legacy reader without choosing an old winner.
  for(const record of records){
    if(record.asset_kind==='field')record.snapshot={row:record.snapshot.row,identities:(raw.get('data_map_field_identities')||[]).filter(row=>String(row.field_id)===record.asset_id),links:(raw.get('data_map_field_system_links')||[]).filter(row=>String(row.field_id)===record.asset_id)};
    record.snapshot_digest=digest(record.snapshot);record.version_ref='capture:'+record.snapshot_digest;
  }
  records.sort((a,b)=>(a.asset_kind+':'+a.asset_id).localeCompare(b.asset_kind+':'+b.asset_id));
  const manifest={schema_version:CONTRACT,target:expected,tables,assets:records.map(({snapshot,...record})=>record),exceptions,
    original_data_rewritten:false,approval_generated:false,binding_generated:false,effective_head_generated:false,original_bytes_generated:false,history_reconstructed:false,stored_source_digests_semantically_reapproved:false};
  return {manifest,manifest_digest:digest(manifest),records};
}
async function priorManifest(db,owner){
  const [[prior]]=await db.execute('SELECT snapshot_json,snapshot_digest,CAST(captured_at AS CHAR) captured_at FROM data_map_legacy_registry WHERE asset_kind=? AND asset_id=? AND version_ref=? FOR SHARE',['compatibility_manifest',owner,CONTRACT]);
  if(!prior)return null;const value=parse(prior.snapshot_json);
  if(digest(value)!==prior.snapshot_digest)throw failure('HANDOFF_COMPAT_REGISTRY_DRIFT',409);
  return {...value,captured_at:prior.captured_at};
}
async function verifyRegistered(db,records){
  for(const record of records){
    const [[stored]]=await db.execute('SELECT snapshot_json,snapshot_digest FROM data_map_legacy_registry WHERE asset_kind=? AND asset_id=? AND version_ref=? FOR SHARE',[record.asset_kind,record.asset_id,record.version_ref]);
    if(!stored||stored.snapshot_digest!==record.snapshot_digest||digest(parse(stored.snapshot_json))!==record.snapshot_digest)throw failure('HANDOFF_COMPAT_REGISTRY_DRIFT',409,{asset_kind:record.asset_kind,asset_id:record.asset_id});
  }
}
async function inspectCompatibility(pool,options={}){
  return transact(pool,options,async(db,expected)=>{
    const control=await readControl(db),current=await inventory(db,expected),prior=await priorManifest(db,expected.owner);
    return {manifest:current.manifest,manifest_digest:current.manifest_digest,record_count:current.records.length,cutover_state:control.cutover_state,
      recorded:Boolean(prior),source_matches_recorded:prior?prior.manifest_digest===current.manifest_digest:null,side_effects:'none'};
  });
}
// Pre-DDL inventory is needed to bind the explicit formal dry run. It does not
// require or create the cutover control row, registry, approval or effective head.
async function inspectCompatibilityInventory(pool,options={}){
  return transact(pool,options,async(db,expected)=>{
    const current=await inventory(db,expected);
    return {manifest:current.manifest,manifest_digest:current.manifest_digest,record_count:current.records.length,side_effects:'none'};
  });
}
async function applyCompatibility(pool,options={}){
  return transact(pool,options,async(db,expected)=>{
    const control=await readControl(db,{lock:true});
    if(control.cutover_state!=='prepared')throw failure('HANDOFF_COMPAT_PREPARED_REQUIRED',409);
    const current=await inventory(db,expected),prior=await priorManifest(db,expected.owner);
    if(prior){
      if(prior.manifest_digest!==current.manifest_digest)throw failure('HANDOFF_COMPAT_SOURCE_DRIFT',409);
      await verifyRegistered(db,current.records);return {...prior.receipt,idempotent:true,captured_at:prior.captured_at};
    }
    if(options.expected_manifest_digest!==current.manifest_digest)throw failure('HANDOFF_COMPAT_DRY_RUN_REQUIRED',409);
    let written=0;
    for(const record of current.records){
      const [[old]]=await db.execute('SELECT snapshot_json,snapshot_digest FROM data_map_legacy_registry WHERE asset_kind=? AND asset_id=? AND version_ref=? FOR UPDATE',[record.asset_kind,record.asset_id,record.version_ref]);
      if(old){if(old.snapshot_digest!==record.snapshot_digest||digest(parse(old.snapshot_json))!==record.snapshot_digest)throw failure('HANDOFF_COMPAT_REGISTRY_DRIFT',409);}
      else await db.execute('INSERT INTO data_map_legacy_registry(asset_kind,asset_id,version_ref,snapshot_json,snapshot_digest,original_status,history_completeness,captured_at) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',[record.asset_kind,record.asset_id,record.version_ref,json(record.snapshot),record.snapshot_digest,record.original_status,record.history_completeness]);
      written++;if(typeof options.afterRecord==='function')await options.afterRecord({written,asset_kind:record.asset_kind,asset_id:record.asset_id});
    }
    await verifyRegistered(db,current.records);
    const receipt={schema_version:CONTRACT,manifest_digest:current.manifest_digest,record_count:current.records.length,installed_tables:current.manifest.tables.filter(table=>table.installed).length,exception_count:current.manifest.exceptions.length,original_data_rewritten:false,approval_generated:false,binding_generated:false,effective_head_generated:false,history_reconstructed:false};
    const saved={manifest:current.manifest,manifest_digest:current.manifest_digest,receipt};
    await db.execute('INSERT INTO data_map_legacy_registry(asset_kind,asset_id,version_ref,snapshot_json,snapshot_digest,original_status,history_completeness,captured_at) VALUES(?,?,?,?,?,NULL,?,UTC_TIMESTAMP(3))',['compatibility_manifest',expected.owner,CONTRACT,json(saved),digest(saved),'captured_current_only']);
    return {...receipt,idempotent:false};
  },true);
}
module.exports={CONTRACT,TABLES,inspectCompatibilityInventory,inspectCompatibility,dryRunCompatibility:inspectCompatibility,applyCompatibility};
