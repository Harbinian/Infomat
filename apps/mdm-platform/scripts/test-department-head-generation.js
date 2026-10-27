// Reproduces and checks A -> B -> A responsibility changes using the real grant
// transaction, current authority checks and generic governance decision API.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {makeIdentityMysqlRepository}=require('../server/identityMysqlRepository');
const {makeGovernanceAccessMysqlRepository}=require('../server/governanceAccessMysqlRepository');
const {applyDepartmentAccountabilityPolicy}=require('../server/departmentAccountabilityMigration');
const authority=require('../server/departmentAccountability');
const {ACCESS_MODEL_VERSION}=require('../server/roleDefinitions');
const outputAt=process.argv.indexOf('--output');assert(outputAt>=0);const output=path.resolve(process.argv[outputAt+1]);assert(!fs.existsSync(output));
assert([path.resolve(__dirname,'../../../artifacts'),path.resolve(process.cwd(),'artifacts')].some(root=>output.startsWith(root+path.sep)));fs.mkdirSync(output,{recursive:true});
const reproduce=process.argv.includes('--reproduce'),checks=[];
const save=(file,data)=>fs.writeFileSync(path.join(output,file),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const one=async(db,sql,params=[])=>{const [rows]=await db.execute(sql,params);return rows[0];};
async function main(){await withFreshMysql(async({pool,owner,database,containerId,port})=>{
  save('owned-target.json',{owner,database,containerId,port});await makeIdentityMysqlRepository(pool).initSchema();
  await pool.execute("INSERT INTO departments(id,code,name) VALUES(91,'GEN_A','Synthetic A'),(92,'GEN_B','Synthetic B')");
  for(const [id,department]of [[101,91],[102,91],[103,92]]){
    await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(?,?,?,?)',[id,'GEN_'+id,'Synthetic '+id,department]);
    await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES(?,?,?,'synthetic-unusable','active',0)",[id+1000,id,'GEN_'+id]);
  }
  await pool.execute('UPDATE departments SET final_responsible_person_id=103 WHERE id=92');
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,effective_from) SELECT 103,role_id,'department',92,'2000-01-01' FROM roles WHERE role_code='department_mdm_reviewer'");
  for(const [mapping,department]of [[901,91],[902,92]]){
    await pool.execute("INSERT INTO process_governance_snapshots(id,source_json_path,source_hash,stats_json) VALUES(?,'synthetic','synthetic','{}')",[mapping]);
    await pool.execute("INSERT INTO process_mapping_records(id,mapping_key,record_type,first_snapshot_id,latest_snapshot_id,l3_name) VALUES(?,?,'l3',?,?,'Synthetic process')",[mapping,'generation_'+mapping,mapping,mapping]);
    await pool.execute('INSERT INTO mdm_mapping_records(id,process_mapping_record_id,owner_dept_id) VALUES(?,?,?)',[mapping,mapping,department]);
  }
  const setup=await pool.getConnection();try{await applyDepartmentAccountabilityPolicy(setup);}finally{setup.release();}
  const access=makeGovernanceAccessMysqlRepository(pool),today=(await one(pool,"SELECT DATE_FORMAT(CURRENT_DATE,'%Y-%m-%d') value")).value;
  const actor=async personId=>{const row=await one(pool,'SELECT CAST(account_id AS CHAR) account_id,CAST(auth_version AS CHAR) auth_version FROM user_accounts WHERE person_id=?',[personId]);return{personId,accountId:row.account_id,authVersion:row.auth_version};};
  const appoint=(personId,expected)=>access.grantRole(personId,{roleCode:'department_mdm_reviewer',scopeDepartmentId:91,effectiveFrom:today,expectedFinalResponsiblePersonId:expected,confirmReplaceFinalResponsiblePerson:true,authorizationBasis:'synthetic explicit handover'});
  const base=departmentId=>({subjectDomain:'data',subjectType:'mapping',subjectId:departmentId===91?'901':'902',subjectVersion:'current',departmentId,decision:'approved',decisionBasis:'synthetic personal confirmation'});
  const record=async(personId,departmentId=91)=>access.recordGovernanceDecision({...base(departmentId),recorderPersonId:personId,actor:await actor(personId)});
  const ready=departmentId=>access.getPublicationResponsibilityReadiness({...base(departmentId),departmentIds:[departmentId]});
  const source=schema=>({sourceRevision:1,sourceHash:crypto.createHash('sha256').update(schema+' synthetic source').digest('hex')});
  const legacyAuthority=await authority.inspectDepartmentAccountability(pool,await actor(103),92);const legacyEvidence=authority.decisionEvidence(legacyAuthority,source('legacy'));delete legacyEvidence.appointment_event_id;
  await record(103,92);assert((await ready(92)).ready);assert((await authority.inspectCurrentDepartmentDecision(pool,92,legacyEvidence,source('legacy'))).valid);
  await appoint(101,null);const firstAuthority=await authority.inspectDepartmentAccountability(pool,await actor(101),91);
  const firstEvidence=Object.fromEntries(['process-governance-v7','process-governance-v8'].map(schema=>[schema,authority.decisionEvidence(firstAuthority,source(schema))]));
  const firstDecision=await record(101);assert((await ready(91)).ready);
  const originalGrant=(await pool.execute('SELECT * FROM person_roles WHERE person_id=101'))[0],oldDecisions=(await pool.execute('SELECT * FROM governance_decision_records ORDER BY decision_record_id'))[0];
  await appoint(102,101);await appoint(101,102);
  assert.deepEqual((await pool.execute('SELECT * FROM person_roles WHERE person_id=101'))[0],originalGrant);
  const states={};for(const [schema,evidence]of Object.entries(firstEvidence))states[schema]=(await authority.inspectCurrentDepartmentDecision(pool,91,evidence,source(schema))).valid;
  const oldGenericReady=(await ready(91)).ready;assert.deepEqual((await pool.execute('SELECT * FROM governance_decision_records ORDER BY decision_record_id'))[0],oldDecisions);
  if(reproduce){assert(Object.values(states).every(Boolean));assert(oldGenericReady);save('results.json',{reproduced:true,modelVersion:ACCESS_MODEL_VERSION,unchangedGrantId:true,oldPreviewFormalEvidenceAccepted:states,oldGenericApprovalAccepted:oldGenericReady,oldRowsPreserved:true,formalDatabaseTouched:false});console.log('REPRODUCED ABA reactivated old item and generic decisions');return;}
  assert(Object.values(states).every(value=>!value));assert.equal(oldGenericReady,false);checks.push('A to B to A preserves old rows and grant id but invalidates both native-source bindings and generic approval');
  const currentAuthority=await authority.inspectDepartmentAccountability(pool,await actor(101),91);assert(currentAuthority.appointment_event_id);assert.notEqual(currentAuthority.appointment_event_id,firstAuthority.appointment_event_id);
  const latest=await one(pool,"SELECT CAST(event_id AS CHAR) event_id,payload_json FROM identity_access_events WHERE event_type='role_assigned' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.departmentAppointment.changed'))='true' ORDER BY event_id DESC LIMIT 1");
  assert.equal(latest.event_id,currentAuthority.appointment_event_id);assert.equal(latest.payload_json.departmentAppointment.decisionRecordCutoff,String(firstDecision.decisionRecordId));
  await record(101);assert((await ready(91)).ready);const freshEvidence=authority.decisionEvidence(currentAuthority,source('process-governance-v8'));assert((await authority.inspectCurrentDepartmentDecision(pool,91,freshEvidence,source('process-governance-v8'))).valid);
  checks.push('new confirmation binds the latest audited appointment and must exceed its generic-decision cutoff');
  await appoint(101,101);const sameAuthority=await authority.inspectDepartmentAccountability(pool,await actor(101),91);assert.equal(sameAuthority.appointment_event_id,currentAuthority.appointment_event_id);assert((await ready(91)).ready);
  await pool.execute("UPDATE user_accounts SET auth_version=auth_version+1,password_hash='synthetic-reset' WHERE person_id=101");assert((await ready(91)).ready);assert((await authority.inspectCurrentDepartmentDecision(pool,91,freshEvidence,source('process-governance-v8'))).valid);
  assert((await ready(92)).ready);assert((await authority.inspectCurrentDepartmentDecision(pool,92,legacyEvidence,source('legacy'))).valid);
  checks.push('same-person registration and account credential changes do not reset confirmations; departments without appointment events remain compatible');
  let committedDecision;
  const staleSnapshotPool={async getConnection(){const connection=await pool.getConnection();return new Proxy(connection,{get(db,key){
    if(key==='beginTransaction')return async()=>{
      await db.beginTransaction();const before=await one(db,'SELECT CAST(MAX(decision_record_id) AS CHAR) maximum_id FROM governance_decision_records WHERE department_id=91');
      committedDecision=await record(101);
      const stale=await one(db,'SELECT CAST(MAX(decision_record_id) AS CHAR) maximum_id FROM governance_decision_records WHERE department_id=91');assert.equal(stale.maximum_id,before.maximum_id);assert(BigInt(committedDecision.decisionRecordId)>BigInt(stale.maximum_id));
    };
    return typeof db[key]==='function'?db[key].bind(db):db[key];
  }});}};
  await makeGovernanceAccessMysqlRepository(staleSnapshotPool).grantRole(102,{roleCode:'department_mdm_reviewer',scopeDepartmentId:91,effectiveFrom:today,expectedFinalResponsiblePersonId:101,confirmReplaceFinalResponsiblePerson:true});
  const currentEvent=await one(pool,"SELECT payload_json FROM identity_access_events WHERE event_type='role_assigned' ORDER BY event_id DESC LIMIT 1");assert.equal(currentEvent.payload_json.departmentAppointment.decisionRecordCutoff,String(committedDecision.decisionRecordId));
  checks.push('appointment cutoff uses a locking current read and includes a decision committed after an earlier repeatable-read snapshot');
  save('results.json',{passed:true,modelVersion:ACCESS_MODEL_VERSION,checks,formalDatabaseTouched:false});checks.forEach(name=>console.log('PASS '+name));
},{stage:'28',randomDatabase:true});}
main().catch(error=>{console.error(JSON.stringify({passed:false,code:error.code||'APPOINTMENT_GENERATION_TEST_FAILED',detail:error.message.split('\n')[0]}));process.exitCode=1;});
