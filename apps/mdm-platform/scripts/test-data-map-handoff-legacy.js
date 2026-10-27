// Pure checks by default. --mysql creates only a fresh, ownership-labelled tmpfs
// MySQL 8.4 container and synthetic legacy rows; no .env, service, or formal DB.
// --output <new artifacts directory> isolates evidence for a later regression batch.
// Without that option, the original priority runner retains its historical output contract.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createDataMapHandoffLegacy,LEGACY_SCHEMA_SQL,assertComplete,canonicalDigest } = require('../server/dataMapHandoffLegacy');
const { PROCESS_DATA_GOVERNANCE_SCHEMA_SQL,splitStatements } = require('../server/processDataGovernanceMigration');
const outputAt=process.argv.indexOf('--output');
const evidenceDir=outputAt<0?path.resolve(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-01/legacy'):path.resolve(process.argv[outputAt+1]||'');
if(outputAt>=0){assert(evidenceDir.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(evidenceDir),'preserve previous evidence');}
const lead={personId:'9007199254741003',accountId:'9007199254741004',authVersion:'1',departmentId:'91',roleCode:'mdm_lead',roleCodes:new Set(['mdm_lead'])};
const steward={...lead,personId:'9007199254741013',accountId:'9007199254741014',roleCode:'mdm_steward',roleCodes:new Set(['mdm_steward'])};
const department={...lead,personId:'9007199254741023',accountId:'9007199254741024',roleCode:'department_contact',roleCodes:new Set(['department_contact'])};
const checks=[];
function passed(name) {checks.push({name,result:'passed'});}
async function reject(action,code) {await assert.rejects(action,error=>error.code===code,code);}
async function pureChecks() {
  assert.equal(canonicalDigest({z:null,a:{b:2,a:1}}),canonicalDigest({a:{a:1,b:2},z:null}));
  assert.notEqual(canonicalDigest({a:null}),canonicalDigest({}));
  assert.notEqual(canonicalDigest({a:[1,2]}),canonicalDigest({a:[2,1]}));
  passed('canonical digests preserve unknown/null and ordered arrays');
  const detail={detail_ref:'object:source_1',status:'confirmed',governance:{basis:'synthetic evidence'}};
  assertComplete({detail_versions:[detail],facts:[]});
  assert.throws(()=>assertComplete({detail_versions:[detail],facts:[{fact_id:'1',status:'answered'}]}),{code:'HANDOFF_GATE_BLOCKED'});
  assert.throws(()=>assertComplete({detail_versions:[{...detail,governance:{}}],facts:[]}),{code:'HANDOFF_GATE_BLOCKED'});
  passed('answered and missing current basis cannot complete review');
  const repo=createDataMapHandoffLegacy();
  await reject(()=>repo.prepareIntake({execute(){},getConnection(){}},{expected_revision:0},lead,{request_id:crypto.randomUUID(),package_id:'1'}),'HANDOFF_TRANSACTION_REQUIRED');
  passed('pool/autocommit adapter rejected before writes');
  const fake={execute:async()=>[[{id:'1',process_version_id:'1'}]]};
  await reject(()=>repo.prepareIntake(fake,{expected_revision:0},lead,{request_id:crypto.randomUUID(),package_id:'1'}),'HANDOFF_AUTHORITY_ADAPTER_REQUIRED');
  await reject(()=>repo.prepareIntake(fake,{expected_revision:0},{...lead,roleCodes:new Set(['admin','mdm_lead'])},{request_id:crypto.randomUUID(),package_id:'1'}),'HANDOFF_ADMIN_READ_ONLY');
  passed('missing authority and stacked admin fail closed');
}
async function mysqlChecks() {
  const {withFreshMysql}=require('./testHelpers/freshMysql');
  return withFreshMysql(async({pool,owner,database,containerId})=>{
    const target={owner,database,container_id:containerId,owned_tmpfs:true,mysql_version:(await pool.execute('SELECT VERSION() version'))[0][0].version};
    await pool.execute('CREATE TABLE departments (id BIGINT PRIMARY KEY,status VARCHAR(24) NOT NULL) ENGINE=InnoDB');
    await pool.execute('CREATE TABLE process_design_documents (id BIGINT PRIMARY KEY) ENGINE=InnoDB');
    await pool.execute(`CREATE TABLE process_design_versions (id BIGINT PRIMARY KEY,schema_version VARCHAR(64) NOT NULL,
      status VARCHAR(24) NOT NULL,content_hash CHAR(64) NOT NULL,process_content_json MEDIUMTEXT NOT NULL) ENGINE=InnoDB`);
    for(const statement of splitStatements(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL)) await pool.execute(statement);
    for(const statement of splitStatements(LEGACY_SCHEMA_SQL)) await pool.execute(statement);
    await pool.execute(`CREATE TABLE data_map_legacy_registry (asset_kind VARCHAR(64) NOT NULL,asset_id VARCHAR(128) NOT NULL,
      version_ref VARCHAR(128) NOT NULL,snapshot_json JSON NOT NULL,snapshot_digest CHAR(64) NOT NULL,original_status VARCHAR(48) NULL,
      history_completeness VARCHAR(48) NOT NULL,captured_at TIMESTAMP(6) NOT NULL,PRIMARY KEY(asset_kind,asset_id,version_ref)) ENGINE=InnoDB`);
    await pool.execute("INSERT INTO departments VALUES (91,'active'),(92,'active')");
    const packageIds=['9007199254741101','9007199254741102'];
    for(let i=0;i<2;i++) {
      const schema=i?'process-governance-v7':'process-governance-v8';
      const document={schema_version:schema,process:{process_ref:`synthetic_${i}`},data_objects:[]};
      const sourceId=String(101+i),packageId=packageIds[i];
      await pool.execute('INSERT INTO process_design_versions VALUES (?,?,?,?,?)',[sourceId,schema,i?'superseded':'published',canonicalDigest(document),JSON.stringify(document)]);
      await pool.execute(`INSERT INTO process_data_governance_work_packages
        (id,package_ref,process_version_id,source_content_hash,rule_version,risk_basis_json,status,revision_no,owning_department_id)
        VALUES (?,?,?,?,?,?,'completed',4,91)`,[packageId,`synthetic-${i}`,sourceId,canonicalDigest(document),'legacy-rule-preserved',JSON.stringify({unknown_legacy_key:null})]);
      for(let j=0;j<2;j++) await pool.execute(`INSERT INTO process_data_governance_details
        (id,work_package_id,detail_ref,detail_type,source_ref,source_snapshot_digest,candidate_rule_code,candidate_json,governance_json,status,revision_no,responsible_department_id)
        VALUES (?,?,?,'data_object_identity',?,?,?, ?,?,'confirmed',3,91)`,
        [String(201+i*10+j),packageId,`object:synthetic_${i}_${j}`,`source_${i}_${j}`,'c'.repeat(64),'legacy-candidate-rule',JSON.stringify({unknown:null,proposed_master_data_status:'pending_confirmation'}),JSON.stringify({basis:'synthetic confirmed evidence',legacy_extra:'keep'})]);
    }
    await pool.execute(`INSERT INTO process_data_governance_reviews
      (id,work_package_id,review_type,decision,basis_text,package_revision_no,actor_person_id,actor_role_code)
      VALUES (301,?,'mdm_workgroup','approved','synthetic original audit',4,?,'mdm_lead')`,[packageIds[0],lead.personId]);
    await pool.execute(`INSERT INTO process_data_governance_fact_requests
      (id,request_ref,work_package_id,detail_id,target_department_id,requested_fact_type,question_text,request_reason,status,answer_text)
      VALUES (401,'synthetic-old-fact',?,201,91,'process_fact','synthetic old question','synthetic old reason','answered','synthetic old answer')`,[packageIds[0]]);
    await pool.execute(`INSERT INTO process_data_governance_events
      (id,work_package_id,detail_id,event_type,actor_person_id,actor_role_code,basis_text,payload_json)
      VALUES(501,?,201,'synthetic_original_review',?,'mdm_lead','synthetic original event',?)`,[packageIds[0],lead.personId,JSON.stringify({unresolved_original_value:null})]);
    const snapshotLegacy=async()=>{
      const tables=['process_data_governance_work_packages','process_data_governance_details','process_data_governance_fact_requests','process_data_governance_reviews','process_data_governance_events','process_design_versions'];
      const result={};for(const table of tables) result[table]=await pool.execute(`SELECT * FROM ${table} ORDER BY id`).then(value=>value[0]);
      return canonicalDigest(JSON.parse(JSON.stringify(result)));
    };
    const before=await snapshotLegacy();
    const authorityCalls=[];
    const repo=createDataMapHandoffLegacy({authorize:async(db,actor,action,row,scope)=>{
      authorityCalls.push({action,package_id:row.id,fact_id:scope.factRequestId || null});
      const roles=actor.roleCodes;
      if(action==='review' && !roles.has('mdm_lead')) throw Object.assign(new Error('review denied'),{code:'HANDOFF_ACCESS_DENIED'});
      if(action==='fact_answer') {
        if(!roles.has('department_contact') || actor.departmentId!==scope.target_department_id) throw Object.assign(new Error('fact denied'),{code:'HANDOFF_ACCESS_DENIED'});
      } else if(!roles.has('mdm_lead') && !roles.has('mdm_steward')) throw Object.assign(new Error('prepare denied'),{code:'HANDOFF_ACCESS_DENIED'});
      return actor;
    }});
    async function call(method,input,actor=lead,context={}) {
      const db=await pool.getConnection();await db.beginTransaction();
      try {const result=await repo[method](db,input,actor,{request_id:crypto.randomUUID(),...context});await db.commit();return result;}
      catch(error) {await db.rollback();throw error;} finally {db.release();}
    }
    const intake=await call('prepareIntake',{expected_revision:0},lead,{package_id:packageIds[0]});
    assert.equal(intake.original_review_id,'301');assert.equal(intake.history_completeness,'current_snapshot_only');
    const v7=await call('prepareIntake',{expected_revision:0},lead,{package_id:packageIds[1]});
    assert.equal(v7.original_review_id,null);
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_data_governance_review_bindings'))[0][0].n,0);
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_generation_tasks'))[0][0].n,0);
    const registryRaw=(await pool.execute('SELECT snapshot_json FROM data_map_legacy_registry WHERE asset_id=?',[packageIds[0]]))[0][0].snapshot_json;
    const registry=typeof registryRaw==='string'?JSON.parse(registryRaw):registryRaw;
    assert.equal(registry.original_package.id,packageIds[0]);
    assert.equal(registry.original_reviews[0].actor_person_id,lead.personId);
    assert.equal(registry.original_reviews[0].work_package_id,packageIds[0]);
    assert.equal(registry.original_events[0].work_package_id,packageIds[0]);
    assert.equal(registry.original_details[0].work_package_id,packageIds[0]);
    assert.match(registry.original_reviews[0].created_at,/T/);
    passed('V8/V7 completed intake preserves old audit/missing history without approval or task');
    const again=await call('prepareIntake',{expected_revision:0},lead,{package_id:packageIds[0]});
    assert.notEqual(again.intake_id,intake.intake_id);
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM data_map_legacy_registry'))[0][0].n,2);
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_data_governance_detail_versions'))[0][0].n,4);
    passed('repeat capture is idempotent for original snapshot/detail revisions');
    const evidence={expected_revision:1,basis:'synthetic current intake verification',detail_evidence:intake.required_detail_evidence.map(item=>({...item,basis:'synthetic current exact verification',evidence_refs:['synthetic:evidence-v1']}))};
    await reject(()=>call('reviewIntake',{...evidence,detail_evidence:[]},lead,{intake_id:intake.intake_id}),'HANDOFF_INTAKE_EVIDENCE_INCOMPLETE');
    await reject(()=>call('reviewIntake',evidence,steward,{intake_id:intake.intake_id}),'HANDOFF_ACCESS_DENIED');
    await reject(()=>call('reviewIntake',evidence,lead,{intake_id:intake.intake_id}),'HANDOFF_GATE_BLOCKED');
    const fact=await call('createFact',{expected_revision:0,expected_parent_revision:1,intake_id:intake.intake_id,
      detail_id:'201',target_department_id:'91',question_text:'synthetic current recheck',requested_fact_type:'process_fact',request_reason:'synthetic current need',resolves_legacy_fact_id:'401'});
    await reject(()=>call('closeFact',{expected_revision:1,expected_parent_revision:2,basis:'synthetic close',evidence_refs:['synthetic:close']},lead,{fact_id:fact.fact_id}),'HANDOFF_FACT_NOT_ANSWERED');
    await reject(()=>call('answerFact',{expected_revision:1,expected_parent_revision:2,answer_text:'wrong department',evidence_refs:['synthetic:answer']},{...department,departmentId:'92'},{fact_id:fact.fact_id}),'HANDOFF_ACCESS_DENIED');
    const answered=await call('answerFact',{expected_revision:1,expected_parent_revision:2,answer_text:'synthetic department answer',evidence_refs:['synthetic:answer']},department,{fact_id:fact.fact_id});
    assert.equal(answered.status,'answered');
    await reject(()=>call('reviewIntake',{...evidence,expected_revision:3},lead,{intake_id:intake.intake_id}),'HANDOFF_GATE_BLOCKED');
    await reject(()=>call('closeFact',{expected_revision:2,expected_parent_revision:3,basis:'department cannot close',evidence_refs:['synthetic:close']},department,{fact_id:fact.fact_id}),'HANDOFF_ACCESS_DENIED');
    const closed=await call('closeFact',{expected_revision:2,expected_parent_revision:3,basis:'synthetic MDM adoption',evidence_refs:['synthetic:closure']},lead,{fact_id:fact.fact_id});
    assert.equal(closed.status,'closed');
    await reject(()=>call('reviewIntake',evidence,lead,{intake_id:intake.intake_id}),'HANDOFF_REVISION_CONFLICT');
    const reviewed=await call('reviewIntake',{...evidence,expected_revision:4},lead,{intake_id:intake.intake_id});
    assert.equal(reviewed.publication_id,null);assert.equal(reviewed.state,'reviewed');
    assert.equal((await pool.execute('SELECT state FROM data_map_handoff_generation_tasks WHERE task_id=?',[reviewed.task_id]))[0][0].state,'pending');
    assert.equal((await pool.execute('SELECT status FROM process_data_governance_fact_requests WHERE id=401'))[0][0].status,'answered');
    passed('required current evidence and closed supplemental fact gate intake; old answered fact stays unchanged');
    const reviewedV7=await call('reviewIntake',{...evidence,detail_evidence:v7.required_detail_evidence.map(item=>({...item,basis:'synthetic v7 check',evidence_refs:['synthetic:v7-current']}))},lead,{intake_id:v7.intake_id});
    const v7binding=(await pool.execute('SELECT * FROM process_data_governance_review_bindings WHERE binding_id=?',[reviewedV7.binding_id]))[0][0];
    assert.equal(v7binding.native_review_id,null);
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_data_governance_reviews WHERE work_package_id=?',[packageIds[1]]))[0][0].n,0);
    passed('missing legacy original review is not fabricated by current intake approval');
    const correction=await call('createCorrection',{expected_revision:0,replaces_binding_id:reviewed.binding_id,reason:'synthetic correction',evidence_refs:['synthetic:correction']},steward,{package_id:packageIds[0]});
    const bindingRaw=(await pool.execute('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=?',[reviewed.binding_id]))[0][0].snapshot_json;
    const binding=typeof bindingRaw==='string'?JSON.parse(bindingRaw):bindingRaw;
    const changed=binding.detail_versions[0],unchanged=binding.detail_versions[1];
    await reject(()=>call('saveCorrection',{expected_revision:1,reason:'synthetic wrong fixed source',evidence_refs:['synthetic:x'],details:[{detail_id:changed.detail_id,expected_detail_version_id:changed.detail_version_id,source_ref:'different',status:'confirmed',governance:{basis:'synthetic'},evidence_refs:['synthetic:x']}]},steward,{correction_id:correction.correction_id}),'HANDOFF_CORRECTION_FIELD_DENIED');
    const saved=await call('saveCorrection',{expected_revision:1,reason:'synthetic accurate replacement',evidence_refs:['synthetic:revision'],details:[{detail_id:changed.detail_id,expected_detail_version_id:changed.detail_version_id,status:'confirmed',governance:{basis:'synthetic new verified conclusion',legacy_extra:null},evidence_refs:['synthetic:new-current']}]},steward,{correction_id:correction.correction_id});
    const revisionRaw=(await pool.execute('SELECT snapshot_json FROM process_data_governance_correction_revisions WHERE correction_revision_id=?',[saved.correction_revision_id]))[0][0].snapshot_json;
    const revision=typeof revisionRaw==='string'?JSON.parse(revisionRaw):revisionRaw;
    assert.equal(revision.detail_versions.find(item=>item.detail_id===unchanged.detail_id).detail_version_id,unchanged.detail_version_id);
    assert.notEqual(revision.detail_versions.find(item=>item.detail_id===changed.detail_id).detail_version_id,changed.detail_version_id);
    await reject(()=>call('reviewCorrection',{expected_revision:1,basis:'stale synthetic',evidence_refs:['synthetic:r']},lead,{correction_id:correction.correction_id}),'HANDOFF_REVISION_CONFLICT');
    const reviewCorrection=await call('reviewCorrection',{expected_revision:2,basis:'synthetic correction reviewed',evidence_refs:['synthetic:review']},lead,{correction_id:correction.correction_id});
    assert.equal(reviewCorrection.state,'reviewed');
    await reject(()=>call('saveCorrection',{expected_revision:2,details:[],reason:'overwrite',evidence_refs:['synthetic:x']},lead,{correction_id:correction.correction_id}),'HANDOFF_CORRECTION_REVIEWED');
    assert.equal(await snapshotLegacy(),before);
    passed('correction appends exact versions, reuses unchanged detail, preserves completed package/source/review/facts byte semantics');
    const correction2=await call('createCorrection',{expected_revision:0,replaces_binding_id:reviewCorrection.binding_id,reason:'synthetic new factual correction',evidence_refs:['synthetic:correct-facts']},steward,{package_id:packageIds[0]});
    const newFact=await call('createFact',{expected_revision:0,expected_parent_revision:1,correction_id:correction2.correction_id,detail_id:'201',target_department_id:'91',
      requested_fact_type:'process_fact',question_text:'synthetic correction question',request_reason:'synthetic new need'});
    await reject(()=>call('reviewCorrection',{expected_revision:2,basis:'synthetic pending fact blocked',evidence_refs:['synthetic:review']},lead,{correction_id:correction2.correction_id}),'HANDOFF_GATE_BLOCKED');
    await call('answerFact',{expected_revision:1,expected_parent_revision:2,answer_text:'synthetic correction factual answer',evidence_refs:['synthetic:correct-answer']},department,{fact_id:newFact.fact_id});
    await reject(()=>call('reviewCorrection',{expected_revision:3,basis:'synthetic answered fact blocked',evidence_refs:['synthetic:review']},lead,{correction_id:correction2.correction_id}),'HANDOFF_GATE_BLOCKED');
    await call('closeFact',{expected_revision:2,expected_parent_revision:3,basis:'synthetic MDM adoption',evidence_refs:['synthetic:correct-close']},steward,{fact_id:newFact.fact_id});
    const correction2review=await call('reviewCorrection',{expected_revision:4,basis:'synthetic corrected facts verified',evidence_refs:['synthetic:review']},lead,{correction_id:correction2.correction_id});
    assert.equal(correction2review.state,'reviewed');
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_data_governance_correction_revisions WHERE correction_id=?',[correction2.correction_id]))[0][0].n,4);
    assert.equal(await snapshotLegacy(),before);
    passed('new correction facts append revisions, answered blocks review, MDM closes, reviewed history freezes');
    await reject(()=>call('captureNativeReview',{native_review_id:'301'},lead,{package_id:packageIds[0]}),'HANDOFF_NATIVE_COMPLETION_CONTEXT_REQUIRED');
    const nativePackage='9007199254741103',nativeDocument={schema_version:'process-governance-v8',process:{process_ref:'synthetic_native'}};
    await pool.execute('INSERT INTO process_design_versions VALUES(103,?,?,?,?)',['process-governance-v8','published',canonicalDigest(nativeDocument),JSON.stringify(nativeDocument)]);
    await pool.execute(`INSERT INTO process_data_governance_work_packages
      (id,package_ref,process_version_id,source_content_hash,rule_version,risk_basis_json,status,revision_no)
      VALUES(?,'synthetic-native',103,?,'synthetic-rule','{}','mdm_review',7)`,[nativePackage,canonicalDigest(nativeDocument)]);
    await pool.execute(`INSERT INTO process_data_governance_details
      (id,work_package_id,detail_ref,detail_type,source_ref,source_snapshot_digest,candidate_rule_code,candidate_json,governance_json,status,revision_no)
      VALUES(231,?,'object:synthetic_native','data_object_identity','synthetic_native',?,'synthetic-rule','{}',?,'confirmed',2)`,[nativePackage,'a'.repeat(64),JSON.stringify({basis:'synthetic current native confirmation'})]);
    const nativeDb=await pool.getConnection();await nativeDb.beginTransaction();let nativeBinding;
    try {
      await nativeDb.execute(`INSERT INTO process_data_governance_reviews
        (id,work_package_id,review_type,decision,basis_text,package_revision_no,actor_person_id,actor_role_code)
        VALUES(303,?,'mdm_workgroup','approved','synthetic current transaction',8,?,'mdm_lead')`,[nativePackage,lead.personId]);
      await nativeDb.execute("UPDATE process_data_governance_work_packages SET status='completed',revision_no=8 WHERE id=?",[nativePackage]);
      nativeBinding=await repo.captureNativeReview(nativeDb,{native_review_id:'303'},lead,{request_id:crypto.randomUUID(),package_id:nativePackage,native_completion:true,native_review_id:'303'});
      await nativeDb.commit();
    } catch(error) {await nativeDb.rollback();throw error;} finally {nativeDb.release();}
    const nativeRow=(await pool.execute('SELECT snapshot_json,binding_digest FROM process_data_governance_review_bindings WHERE binding_id=?',[nativeBinding.binding_id]))[0][0];
    const nativeSnapshot=typeof nativeRow.snapshot_json==='string'?JSON.parse(nativeRow.snapshot_json):nativeRow.snapshot_json;
    assert.equal(canonicalDigest(nativeSnapshot),nativeRow.binding_digest);
    assert.match(nativeSnapshot.native_review.created_at,/T/);
    assert.equal(nativeSnapshot.native_review_id,'303');
    passed('native binding requires current completion context and verifies nonempty timestamp after MySQL reread');
    // Commit-caller rollback rolls back snapshot/review/task together.
    const db=await pool.getConnection();await db.beginTransaction();
    const rolled=await repo.createCorrection(db,{expected_revision:0,replaces_binding_id:reviewCorrection.binding_id,reason:'synthetic rollback',evidence_refs:['synthetic:rollback']},lead,{request_id:crypto.randomUUID(),package_id:packageIds[0]});
    await db.rollback();db.release();
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_data_governance_corrections WHERE correction_id=?',[rolled.correction_id]))[0][0].n,0);
    passed('caller transaction exclusively owns rollback; no independent commit');
    const snapshotBefore=(await pool.execute('SELECT snapshot_digest FROM data_map_legacy_registry ORDER BY asset_id'))[0];
    await pool.execute('UPDATE process_design_versions SET content_hash=? WHERE id=101',['d'.repeat(64)]);
    await reject(()=>call('prepareIntake',{expected_revision:0},lead,{package_id:packageIds[0]}),'HANDOFF_SOURCE_DIGEST_MISMATCH');
    assert.deepEqual((await pool.execute('SELECT snapshot_digest FROM data_map_legacy_registry ORDER BY asset_id'))[0],snapshotBefore);
    passed('source digest drift blocks intake without rewriting original hash or snapshot');
    const fk=(await pool.execute("SELECT COUNT(*) n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME LIKE 'fk_handoff_%'"))[0][0].n;
    assert.ok(Number(fk)>=14);
    await assert.rejects(pool.execute(`INSERT INTO process_data_governance_review_bindings
      (binding_id,package_id,binding_kind,source_hash,snapshot_json,binding_digest,request_id) VALUES (?,?,'legacy_intake',?,'{}',?,?)`,
    [crypto.randomUUID(),packageIds[0],'c'.repeat(64),'d'.repeat(64),crypto.randomUUID()]),error=>error.code==='ER_CHECK_CONSTRAINT_VIOLATED');
    passed('real MySQL FK and XOR review-origin CHECK enforce binding structure');
    return {target,legacy_digest_unchanged:true,foreign_keys:Number(fk),authority_calls:authorityCalls.length};
  },{stage:'71',randomDatabase:true});
}
async function main() {
  fs.mkdirSync(evidenceDir,{recursive:true});
  let result;
  try {
    await pureChecks();
    result=process.argv.includes('--mysql') ? await mysqlChecks():{mode:'pure'};
    const report={state:'passed',executed_at:new Date().toISOString(),checks,...result};
    fs.writeFileSync(path.join(evidenceDir,process.argv.includes('--mysql')?'mysql-validation.json':'pure-validation.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({state:'passed',checks:checks.length,mode:process.argv.includes('--mysql')?'isolated_mysql':'pure',evidenceDir}));
  } catch(error) {
    fs.writeFileSync(path.join(evidenceDir,'last-failure.json'),JSON.stringify({state:'failed',executed_at:new Date().toISOString(),checks,error:{code:error.code || null,message:error.message}},null,2));
    throw error;
  }
}
if(require.main===module) main().catch(error=>{console.error(error.code || error.name,error.message);process.exitCode=1;});
module.exports={pureChecks,mysqlChecks};
