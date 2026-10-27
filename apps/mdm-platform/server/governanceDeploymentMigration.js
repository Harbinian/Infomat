// Deployment preparation only. Runtime flags, controlled mode, approvals,
// bindings and effective heads are intentionally outside this entry point.
const crypto=require('node:crypto');
const authorization=require('./governanceMigrationAuthorization');
const terminology=require('./terminologyGovernanceMigration');
const handoff=require('./dataMapHandoffSchema');
const compatibility=require('./dataMapHandofaNFigration');
const foundation=require('./processDataGovernanceMigration');
const {digest}=require('./dataMapDefinitionValues');
const {sourceValue}=require('./migrationSourceValues');
const CONTRACT='governance-deployment-preparation-v1';
const fail=code=>Object.assign(new Error(code),{code,statusCode:409});
function optionsFor(options,permit){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(options.deploymentId||''))throw fail('GOVERNANCE_MIGRATION_DEPLOYMENT_ID_REQUIRED');
  return {...options,owner:options.deploymentId,formalTargetPermit:permit};
}
async function prerequisites(db){
  const planned=[...foundation.splitStatements(foundation.PROCESS_DATA_GOVERNANCE_SCHEMA_SQL),...handoff.statements()];
  const creates=new Set(planned.map(sql=>sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1]));
  const references=[...new Set(planned.flatMap(sql=>[...sql.matchAll(/REFERENCES\s+(\w+)/gi)].map(match=>match[1])).filter(name=>!creates.has(name)))];
  const missing=[];
  for(const table of ['schema_migrations',...references]){
    const [[row]]=await db.execute('SELECT COUNT(*) n FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
    if(!Number(row.n))missing.push(table);
  }
  return missing;
}
function ddlDigest(){return crypto.createHash('sha256').update([
  ...foundation.splitStatements(foundation.PROCESS_DATA_GOVERNANCE_SCHEMA_SQL),
  ...require('./terminologyGovernanceSchema').statements(),...require('./terminologyUsageSchema').statements(),...handoff.statements()
].join('\n')).digest('hex');}
async function inspectFoundation(db){
  const report=await foundation.inspectProcessDataGovernance(db,{verifySchema:true});
  const rows=[];
  for(const table of report.tables){
    if(!table.exists){rows.push({table:table.table,rows:[]});continue;}
    const [[ddl]]=await db.query('SHOW CREATE TABLE `'+table.table+'`');
    const [columns]=await db.execute('SELECT COLUMN_NAME name,DATA_TYPE data_type,COLLATION_NAME collation FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[table.table]);
    const storage=/ENGINE=InnoDB\b/i.test(ddl['Create Table'])&&/COLLATE=utf8mb4_unicode_ci\b/i.test(ddl['Create Table'])&&!/NOT ENFORCED/i.test(ddl['Create Table'])&&columns.every(column=>!column.collation||column.collation==='utf8mb4_unicode_ci');
    if(!storage)table.schema_status='drifted';
    // BIGINT, dates and JSON retain their existing cast-to-text contract. The
    // remaining numeric columns preserve the driver's native integer types.
    const projection=columns.map(column=>{
      if(!/^[a-z][a-z0-9_]*$/.test(column.name))throw fail('GOVERNANCE_MIGRATION_FOUNDATION_IDENTIFIER_INVALID');
      return /^(bigint|timestamp|datetime|date|time|decimal|json)$/.test(column.data_type)?'CAST(`'+column.name+'` AS CHAR) `'+column.name+'`':'`'+column.name+'`';
    }).join(',');
    const [values]=await db.execute('SELECT '+projection+' FROM `'+table.table+'` ORDER BY id');
    rows.push({table:table.table,rows:values.map(row=>Object.fromEntries(columns.map(column=>[column.name,sourceValue(row[column.name],column)])))});
  }
  const matching=report.tables.every(table=>!table.exists||table.schema_status==='matching');
  const preparable=matching&&['not_applied','applied'].includes(report.consistency_status);
  return {...report,preparable,preparation_plan:report.consistency_status==='not_applied'?'create_six_empty_tables':report.applied&&matching?'already_applied':'requires_manual_resolution',source_rows_sha256:digest(rows)};
}
function stableDataMapManifest(manifest){
  // Newly installed foundation tables have no source rows. Their exact schema
  // is checked separately, while their prior rows are bound in foundation's
  // digest. Ignore only that planned absent-to-empty structural transition.
  const names=new Set(foundation.TABLES);
  return {...manifest,tables:manifest.tables.filter(table=>!names.has(table.table)),exceptions:manifest.exceptions.filter(issue=>!names.has(issue.table))};
}
async function inspectUsingPermit(pool,db,options,permit){
  const scoped=optionsFor(options,permit),missingPrerequisites=await prerequisites(db);
  if(missingPrerequisites.length)return {schema_version:CONTRACT,target:{database:options.database,server_uuid:options.serverUuid},missing_prerequisites:missingPrerequisites,applicable:false,side_effects:'none'};
  const term=await terminology.inspectTerminologyGovernance(db,scoped);
  const workPackageFoundation=await inspectFoundation(db);
  const schema=await handoff.inspectHandoffSchema(db);
  let cutoverState=null;
  if(schema.tables.some(table=>table.table==='data_map_governance_control'&&table.status==='matching')){
    const [[control]]=await db.execute('SELECT cutover_state,contract_version FROM data_map_governance_control WHERE control_id=1');
    cutoverState=control?(control.contract_version===handoff.CONTRACT_VERSION?control.cutover_state:'invalid_contract'):'missing';
  }
  const capture=await compatibility.inspectCompatibilityInventory(pool,scoped);
  const manifest={schema_version:CONTRACT,deployment_id:options.deploymentId,target:{database:options.database,server_uuid:options.serverUuid},
    ddl_sha256:ddlDigest(),foundation_source_sha256:workPackageFoundation.source_rows_sha256,
    terminology_manifest_sha256:term.manifest_digest,data_map_source_sha256:digest(stableDataMapManifest(capture.manifest))};
  return {schema_version:CONTRACT,manifest,manifest_digest:digest(manifest),missing_prerequisites:[],
    applicable:workPackageFoundation.preparable&&!term.drift.length&&!term.issues.some(issue=>issue.blocking)&&!term.missing.some(table=>!table.startsWith('tg_'))&&!schema.tables.some(table=>table.status==='drifted')&&[null,'missing','prepared'].includes(cutoverState),
    cutover_state:cutoverState,
    work_package_foundation:workPackageFoundation,terminology:term,handoff_schema:schema,data_map:{manifest_digest:capture.manifest_digest,record_count:capture.record_count,
      tables:capture.manifest.tables.map(({columns,...table})=>table),exceptions:capture.manifest.exceptions},side_effects:'none'};
}
async function inspectGovernanceDeployment(pool,options={}){
  const db=await pool.getConnection();
  try{
    const permit=await authorization.createMigrationPermit(db,options);
    return await inspectUsingPermit(pool,db,options,permit);
  }finally{db.release();}
}
async function applyGovernanceDeployment(pool,options={}){
  const db=await pool.getConnection();let locked=false;
  try{
    const permit=await authorization.createMigrationPermit(db,options,{write:true});
    const scoped=optionsFor(options,permit);
    const [[lock]]=await db.execute("SELECT GET_LOCK('mdm_governance_deployment_v1',10) acquired");
    if(Number(lock.acquired)!==1)throw fail('GOVERNANCE_MIGRATION_BUSY');locked=true;
    const before=await inspectUsingPermit(pool,db,options,permit);
    if(!before.applicable)throw Object.assign(fail('GOVERNANCE_MIGRATION_PRECHECK_FAILED'),{report:before});
    if(!/^[a-f0-9]{64}$/.test(options.expectedManifestDigest||'')||before.manifest_digest!==options.expectedManifestDigest)throw fail('GOVERNANCE_MIGRATION_DRY_RUN_REQUIRED');
    const workPackageFoundation=await foundation.applyProcessDataGovernance(db);
    if(!workPackageFoundation.applied)throw fail('GOVERNANCE_MIGRATION_FOUNDATION_NOT_READY');
    const prepared=await inspectUsingPermit(pool,db,options,permit);
    if(!prepared.applicable||prepared.manifest_digest!==before.manifest_digest)throw fail('GOVERNANCE_MIGRATION_SOURCE_CHANGED');
    const term=await terminology.applyTerminologyGovernance(db,{...scoped,confirmDatabase:options.database,expectedManifestDigest:prepared.terminology.manifest_digest});
    const schema=await handoff.applyHandoffSchema(db,scoped);
    if(!schema.ready)throw fail('GOVERNANCE_MIGRATION_SCHEMA_NOT_READY');
    const capture=await compatibility.applyCompatibility(pool,{...scoped,expected_manifest_digest:prepared.data_map.manifest_digest});
    const after=await inspectUsingPermit(pool,db,options,permit);
    if(after.manifest_digest!==before.manifest_digest)throw fail('GOVERNANCE_MIGRATION_SOURCE_CHANGED');
    const [[control]]=await db.execute('SELECT cutover_state FROM data_map_governance_control WHERE control_id=1');
    if(control.cutover_state!=='prepared')throw fail('GOVERNANCE_MIGRATION_PREPARED_REQUIRED');
    return {schema_version:CONTRACT,deployment_id:options.deploymentId,manifest_digest:after.manifest_digest,target:after.manifest.target,
      backup_sha256:options.backupSha256,restore_receipt_sha256:options.restoreReceiptSha256,authorization_reference:options.authorizationReference,
      write_fence_reference:options.writeFenceReference,work_package_foundation_ready:workPackageFoundation.applied,
      work_package_tables_created:before.work_package_foundation.preparation_plan==='create_six_empty_tables'?foundation.TABLES.length:0,
      terminology_ready:term.ready,handoff_schema_ready:schema.ready,compatibility:capture,
      cutover_state:'prepared',runtime_enabled:false,original_data_rewritten:false,approval_generated:false,binding_generated:false,
      effective_head_generated:false,notifications_generated:false,side_effects:'additive_authorized_preparation'};
  }finally{
    if(locked)await db.execute("SELECT RELEASE_LOCK('mdm_governance_deployment_v1')").catch(()=>{});
    db.release();
  }
}
async function inspectGovernanceDeploymentWithPermit(pool,db,options,permit){
  await authorization.verifyMigrationPermit(db,permit);
  return inspectUsingPermit(pool,db,options,permit);
}
module.exports={CONTRACT,inspectGovernanceDeployment,inspectGovernanceDeploymentWithPermit,applyGovernanceDeployment};
