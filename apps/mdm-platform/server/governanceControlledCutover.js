// Explicit operational transition only. No runtime import, environment loading,
// grants, personnel authorization, feature-flag changes or business acceptance.
const fs=require('node:fs');
const crypto=require('node:crypto');
const auth=require('./governanceMigrationAuthorization');
const {digest,json,parse}=require('./dataMapDefinitionValues');
const {compareCreateStatements}=require('./processV7M0Baseline');
const CONTRACT='governance-controlled-cutover-v1';
const TABLE='governance_cutover_events';
const DDL=`CREATE TABLE IF NOT EXISTS ${TABLE} (
  cutover_id CHAR(36) PRIMARY KEY, request_digest CHAR(64) NOT NULL,
  target_json JSON NOT NULL, evidence_sha256 CHAR(64) NOT NULL,
  artifact_sha256 CHAR(64) NOT NULL, image_id VARCHAR(80) NOT NULL,
  grants_sha256 CHAR(64) NOT NULL, permissions_sha256 CHAR(64) NOT NULL,
  access_model VARCHAR(96) NOT NULL, cutover_epoch BIGINT NOT NULL,
  authorization_reference VARCHAR(255) NOT NULL, receipt_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL, CHECK(cutover_epoch > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const fail=code=>Object.assign(new Error(code),{code,statusCode:409});
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
function fileEvidence(file,expected){
  let bytes;try{bytes=fs.readFileSync(file);}catch{throw fail('GOVERNANCE_CUTOVER_EVIDENCE_REQUIRED');}
  if(!bytes.length||!sha(expected)||auth.sha256(bytes)!==expected)throw fail('GOVERNANCE_CUTOVER_EVIDENCE_REQUIRED');
  return bytes;
}
function inspectEvidence(options){
  let evidence;try{evidence=JSON.parse(fileEvidence(options.evidenceFile,options.evidenceSha256));}catch{throw fail('GOVERNANCE_CUTOVER_EVIDENCE_REQUIRED');}
  if(evidence.schema_version!==CONTRACT||evidence.target?.database!==options.database||evidence.target?.server_uuid!==options.serverUuid
    ||evidence.deployment_id!==options.deploymentId||evidence.prepared_manifest_sha256!==options.expectedPreparedManifestDigest
    ||evidence.artifact?.source_manifest_sha256!==options.expectedArtifactSha256||evidence.artifact?.image_id!==options.expectedImageId
    ||evidence.permissions?.principal!==options.runtimePrincipal||evidence.permissions?.grants_sha256!==options.expectedGrantsSha256
    ||evidence.permissions?.model_sha256!==options.expectedPermissionsSha256||evidence.permissions?.access_model!==options.expectedAccessModel
    ||evidence.maintenance?.drained!==true||evidence.maintenance?.all_nodes_fixed!==true
    ||evidence.maintenance?.write_fence_reference!==options.writeFenceReference
    ||evidence.recovery?.compatible_maintenance_build_verified!==true||evidence.recovery?.retain_post_cutover_data!==true
    ||!evidence.recovery?.plan_reference?.trim()||!evidence.review_reference?.trim())throw fail('GOVERNANCE_CUTOVER_CONDITIONS_REQUIRED');
  for(const gate of ['TECH-01','TECH-02','TECH-03','TECH-04','TECH-05']){
    const record=evidence.technical_gates?.[gate];
    if(record?.status!=='passed'||!Array.isArray(record.evidence)||!record.evidence.length)throw fail('GOVERNANCE_CUTOVER_TECHNICAL_GATE_REQUIRED');
    for(const reference of record.evidence)fileEvidence(reference.path,reference.sha256);
  }
  for(const entry of [...Array.from({length:12},(_,i)=>'W'+String(i+1).padStart(2,'0')),...Array.from({length:8},(_,i)=>'R'+String(i+1).padStart(2,'0'))]){
    const record=evidence.entrypoints?.[entry];
    if(record?.status!=='passed'||!Array.isArray(record.covered_branches)||!record.covered_branches.length||!record.evidence?.length)throw fail('GOVERNANCE_CUTOVER_ENTRYPOINT_REVIEW_REQUIRED');
    for(const reference of record.evidence)fileEvidence(reference.path,reference.sha256);
  }
  const performance=evidence.performance;
  if(performance?.concurrency!==10||performance.history_rows<10000||performance.read_p95_ms>2000||performance.write_p95_ms>5000
    ||performance.impact_p95_ms>10000||performance.restore_elapsed_ms>600000
    ||['history_rows','read_p95_ms','write_p95_ms','impact_p95_ms','restore_elapsed_ms'].some(key=>!Number.isFinite(performance[key])||performance[key]<0)
    ||!performance.threshold_authorization_reference?.trim()||!evidence.business_sample_plan?.reference?.trim()
    ||evidence.business_sample_plan.case_id!=='2'||evidence.business_sample_plan.department!=='经营发展部'
    ||evidence.business_sample_plan.acceptance_owner!=='部门负责人')throw fail('GOVERNANCE_CUTOVER_CAPACITY_OR_SAMPLE_REQUIRED');
  return evidence;
}
async function inspectCutoverSchema(db){
  const [[exists]]=await db.execute('SELECT COUNT(*) n FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[TABLE]);
  if(!Number(exists.n))return {ready:false,status:'missing'};
  const [[row]]=await db.query('SHOW CREATE TABLE '+TABLE);
  const comparison=compareCreateStatements(DDL,row['Create Table']);
  const [collations]=await db.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME<>?',[TABLE,'utf8mb4_unicode_ci']);
  const matching=comparison.matching&&/ENGINE=InnoDB\b/i.test(row['Create Table'])&&/COLLATE=utf8mb4_unicode_ci\b/i.test(row['Create Table'])&&!/NOT ENFORCED/i.test(row['Create Table'])&&!collations.length;
  return {ready:matching,status:matching?'matching':'drifted',differences:comparison.differences};
}
async function prepareCutoverSchema(db,options={}){
  await auth.verifyMigrationPermit(db,options.formalTargetPermit,{write:true});
  const before=await inspectCutoverSchema(db);
  if(before.status==='drifted')throw fail('GOVERNANCE_CUTOVER_SCHEMA_DRIFT');
  if(before.status==='missing')await db.execute(DDL);
  const after=await inspectCutoverSchema(db);if(!after.ready)throw Object.assign(fail('GOVERNANCE_CUTOVER_SCHEMA_DRIFT'),{details:after});return after;
}
async function permissionFingerprint(db,{lock=false}={}){
  const [rows]=await db.execute(`SELECT r.role_code,r.status,r.model_version,p.perm_code,rp.effect
    FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.role_id LEFT JOIN permissions p ON p.perm_id=rp.perm_id
    ORDER BY r.role_code,p.perm_code,rp.effect${lock?' FOR SHARE':''}`);
  return digest(rows);
}
async function grantsFingerprint(db,principal){
  if(!/^'[A-Za-z0-9_.-]+'@'[A-Za-z0-9_.:%-]+'$/.test(principal||''))throw fail('GOVERNANCE_CUTOVER_RUNTIME_PRINCIPAL_REQUIRED');
  const [rows]=await db.query('SHOW GRANTS FOR '+principal);
  return digest(rows.map(row=>String(Object.values(row)[0])).sort());
}
async function applyGovernanceControlledCutover(pool,options={}){
  if(options.authorizeControlledCutover!==true||!uuid(options.cutoverId)||!sha(options.expectedArtifactSha256)
    ||!/^sha256:[a-f0-9]{64}$/.test(options.expectedImageId||'')||!sha(options.expectedGrantsSha256)||!sha(options.expectedPermissionsSha256))throw fail('GOVERNANCE_CUTOVER_AUTHORIZATION_REQUIRED');
  const evidence=inspectEvidence(options),requestDigest=digest({...options,backupFile:undefined,restoreReceiptFile:undefined,evidenceFile:undefined});
  const db=await pool.getConnection();let locked=false,inTransaction=false,committing=false,uncertain=false;
  try{
    if(typeof db.destroy!=='function'&&typeof db.end!=='function')throw fail('GOVERNANCE_CUTOVER_CONNECTION_DISCARD_REQUIRED');
    const permit=await auth.createMigrationPermit(db,options,{write:true});
    const [[lock]]=await db.execute("SELECT GET_LOCK('mdm_governance_deployment_v1',10) acquired");
    if(Number(lock.acquired)!==1)throw fail('GOVERNANCE_CUTOVER_BUSY');locked=true;
    if(!(await inspectCutoverSchema(db)).ready)throw fail('GOVERNANCE_CUTOVER_SCHEMA_REQUIRED');
    const [[prior]]=await db.execute('SELECT request_digest,receipt_json FROM governance_cutover_events WHERE cutover_id=?',[options.cutoverId]);
    if(prior){if(prior.request_digest!==requestDigest)throw fail('GOVERNANCE_CUTOVER_REQUEST_CONFLICT');return {...parse(prior.receipt_json),idempotent:true};}
    const prepared=await require('./governanceDeploymentMigration').inspectGovernanceDeploymentWithPermit(pool,db,options,permit);
    if(!prepared.applicable||prepared.manifest_digest!==options.expectedPreparedManifestDigest||!prepared.terminology.ready
      ||!prepared.handoff_schema.ready||!prepared.work_package_foundation.applied)throw fail('GOVERNANCE_CUTOVER_PREPARATION_REQUIRED');
    const captured=await require('./dataMapHandoffMigration').inspectCompatibility(pool,{database:options.database,owner:options.deploymentId,formalTargetPermit:permit});
    if(!captured.recorded||!captured.source_matches_recorded||captured.cutover_state!=='prepared')throw fail('GOVERNANCE_CUTOVER_COMPATIBILITY_REQUIRED');
    await db.beginTransaction();inTransaction=true;
    const cases=require('./processCaseGovernanceSchema'),formal=require('./processFormalControlMigration');
    const tableNames=[...cases.TABLES,'process_design_drafts','process_design_versions',TABLE].sort();
    try{await db.query('SELECT 1 FROM '+tableNames.map((table,n)=>'`'+table+'` AS cutover_mdl'+n).join(',')+' WHERE 1=0');}
    catch(error){if(error.code==='ER_NO_SUCH_TABLE')throw fail('GOVERNANCE_CUTOVER_OPERATIONAL_SCHEMA_REQUIRED');throw error;}
    const [operationalMarkers]=await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key IN (?,?) FOR SHARE',[cases.MIGRATION_KEY,formal.MIGRATION_KEY]);
    if(!(await require('./dataMapHandoffSchema').inspectHandoffSchema(db,{pinMetadata:true})).ready
      ||!(await cases.inspectSchema(db)).ready||!(await formal.inspectSchema(db)).ready
      ||!(await inspectCutoverSchema(db)).ready||operationalMarkers.length!==2)throw fail('GOVERNANCE_CUTOVER_OPERATIONAL_SCHEMA_REQUIRED');
    const control=await require('./dataMapHandoffControl').readControl(db,{lock:true});
    if(control.cutover_state!=='prepared')throw fail('GOVERNANCE_CUTOVER_PREPARED_REQUIRED');
    const model=await require('./dataMapHandoffAuthority').inspectHandoffAccessModel(db,{lock:true});
    if(model!==options.expectedAccessModel||await permissionFingerprint(db,{lock:true})!==options.expectedPermissionsSha256
      ||await grantsFingerprint(db,options.runtimePrincipal)!==options.expectedGrantsSha256)throw fail('GOVERNANCE_CUTOVER_PERMISSIONS_CHANGED');
    const epoch=(BigInt(control.cutover_epoch)+1n).toString();
    if(BigInt(epoch)>9223372036854775807n)throw fail('GOVERNANCE_CUTOVER_EPOCH_EXHAUSTED');
    const receipt={schema_version:CONTRACT,cutover_id:options.cutoverId,deployment_id:options.deploymentId,target:evidence.target,cutover_state:'controlled',cutover_epoch:epoch,
      artifact_sha256:options.expectedArtifactSha256,image_id:options.expectedImageId,evidence_sha256:options.evidenceSha256,
      grants_sha256:options.expectedGrantsSha256,permissions_sha256:options.expectedPermissionsSha256,access_model:model,
      authorization_reference:options.authorizationReference,runtime_flags_changed:false,business_acceptance:'not_attested',idempotent:false};
    await db.execute("UPDATE data_map_governance_control SET cutover_state='controlled',cutover_epoch=cutover_epoch+1 WHERE control_id=1 AND cutover_state='prepared'");
    await db.execute(`INSERT INTO governance_cutover_events(cutover_id,request_digest,target_json,evidence_sha256,artifact_sha256,image_id,grants_sha256,permissions_sha256,access_model,cutover_epoch,authorization_reference,receipt_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[options.cutoverId,requestDigest,json(evidence.target),options.evidenceSha256,options.expectedArtifactSha256,options.expectedImageId,options.expectedGrantsSha256,options.expectedPermissionsSha256,model,epoch,options.authorizationReference,json(receipt)]);
    committing=true;await db.commit();inTransaction=false;committing=false;return receipt;
  }catch(error){
    if(committing){uncertain=true;throw Object.assign(fail('GOVERNANCE_CUTOVER_COMMIT_UNKNOWN'),{statusCode:503});}
    if(inTransaction)await db.rollback();throw error;
  }finally{
    // An uncertain COMMIT connection is never returned to the pool or reused
    // for advisory-lock SQL. Disconnect releases that lock; the same UUID is
    // observed independently on the next connection.
    if(uncertain){if(typeof db.destroy==='function')db.destroy();else await db.end().catch(()=>{});}
    else{if(locked)await db.execute("SELECT RELEASE_LOCK('mdm_governance_deployment_v1')").catch(()=>{});db.release();}
  }
}
module.exports={CONTRACT,TABLE,DDL,inspectEvidence,inspectCutoverSchema,prepareCutoverSchema,permissionFingerprint,grantsFingerprint,applyGovernanceControlledCutover};
