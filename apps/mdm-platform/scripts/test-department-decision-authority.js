// Isolated MySQL integration: current department authority, direct decisions,
// historical preservation and effective-permission filtering. No formal target.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {mdmMysqlSchemaSql,splitSqlStatements}=require('../server/mysqlSchema');
const {ensureMysqlBuiltInRolesAndPermissions}=require('../server/identityMysqlRepository');
const {makeIdentityMysqlRepository}=require('../server/identityMysqlRepository');
const {makeGovernanceAccessMysqlRepository}=require('../server/governanceAccessMysqlRepository');
const {applyDepartmentAccountabilityPolicy}=require('../server/departmentAccountabilityMigration');
const checks=[];
async function check(name,work){await work();checks.push({name,passed:true});console.log('PASS '+name);}
async function main(){await withFreshMysql(async({pool})=>{
  for(const sql of splitSqlStatements(mdmMysqlSchemaSql()))await pool.execute(sql);
  await ensureMysqlBuiltInRolesAndPermissions(pool);
  await pool.execute("INSERT INTO departments(id,name,code,status) VALUES(91,'Synthetic A','ACCOUNTABLE_A','active'),(92,'Synthetic B','ACCOUNTABLE_B','active')");
  for(const personId of [101,102,103,104]){
    await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id,status,employment_status) VALUES(?,?,?,91,'active','active')",[personId,'ACCOUNTABLE_'+personId,'Synthetic '+personId]);
    await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES(?,?,?,?,'active',0)",[personId+1000,personId,'ACCOUNTABLE_'+personId,'unusable-test-hash']);
  }
  await pool.execute('UPDATE departments SET final_responsible_person_id=101 WHERE id=91');
  for(const personId of [101,102,103])await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,effective_from,authorization_basis) SELECT ?,role_id,'department',91,'2000-01-01','synthetic role grant' FROM roles WHERE role_code='department_mdm_reviewer'",[personId]);
  await pool.execute("INSERT INTO process_governance_snapshots(id,source_json_path,source_hash,stats_json) VALUES(901,'synthetic','synthetic','{}')");
  await pool.execute("INSERT INTO process_mapping_records(id,mapping_key,record_type,first_snapshot_id,latest_snapshot_id,l3_name) VALUES(901,'synthetic','l3',901,901,'Synthetic process')");
  await pool.execute('INSERT INTO mdm_mapping_records(id,process_mapping_record_id,owner_dept_id) VALUES(901,901,91)');
  await pool.execute("INSERT INTO governance_decision_records(subject_domain,subject_type,subject_id,subject_version,department_id,accountable_person_id,recorded_by_person_id,decision,decision_basis,decided_at) VALUES('data','mapping','901','current',91,101,101,'approved','historical preserved opinion',CURRENT_TIMESTAMP)");
  const [oldRows]=await pool.execute('SELECT * FROM governance_decision_records ORDER BY decision_record_id');
  const policyDb=await pool.getConnection();try{assert((await applyDepartmentAccountabilityPolicy(policyDb)).ready);}finally{policyDb.release();}
  const identity=makeIdentityMysqlRepository(pool),access=makeGovernanceAccessMysqlRepository(pool);
  const actor=personId=>({personId,accountId:personId+1000,authVersion:1});
  const base={subjectDomain:'data',subjectType:'mapping',subjectId:'901',subjectVersion:'current',departmentId:91,decision:'approved',decisionBasis:'current direct final confirmation'};
  const readiness=()=>access.getPublicationResponsibilityReadiness({...base,departmentIds:[91]});
  await check('retained role grants do not confer final confirmation on a different person',async()=>{
    assert(!(await identity.getUserEffectivePermissions(102)).permSet.has('governance:review-department'));
    await assert.rejects(access.recordGovernanceDecision({...base,recorderPersonId:102,actor:actor(102)}),{code:'DEPARTMENT_FINAL_RESPONSIBLE_MISMATCH'});
    assert.equal((await readiness()).ready,false);
  });
  await check('registered final person and effective role are both required',async()=>{
    assert((await identity.getUserEffectivePermissions(101)).permSet.has('governance:review-department'));
    await pool.execute('UPDATE departments SET final_responsible_person_id=104 WHERE id=91');
    assert(!(await identity.getUserEffectivePermissions(101)).permSet.has('governance:review-department'));
    await assert.rejects(access.recordGovernanceDecision({...base,recorderPersonId:104,actor:actor(104)}),{code:'DEPARTMENT_ACCOUNTABILITY_ROLE_REQUIRED'});
    await pool.execute('UPDATE departments SET final_responsible_person_id=101 WHERE id=91');
  });
  await check('recording another person and a stale authentication version are rejected',async()=>{
    await assert.rejects(access.recordGovernanceDecision({...base,recorderPersonId:101,actor:actor(102)}),{code:'DEPARTMENT_ACCOUNTABILITY_ACTOR_REQUIRED'});
    await assert.rejects(access.recordGovernanceDecision({...base,recorderPersonId:101,actor:{...actor(101),authVersion:999}}),{code:'DEPARTMENT_ACCOUNTABILITY_ACTOR_INACTIVE'});
    await assert.rejects(access.recordGovernanceDecision({...base,recorderPersonId:101,actor:actor(101),decidedAt:'2020-01-01T00:00:00Z'}),{code:'DECIDED_AT_SERVER_CONTROLLED'});
    const [[unchanged]]=await pool.execute('SELECT COUNT(*) count FROM governance_decision_records');assert.equal(Number(unchanged.count),1);
  });
  await check('new direct confirmation binds accountable and recorder while retaining historical rows',async()=>{
    const recorded=await access.recordGovernanceDecision({...base,recorderPersonId:101,actor:actor(101)});
    assert.equal(String(recorded.accountablePersonId),'101');assert.equal(recorded.policyVersion,'department-accountability-v1');
    assert((await readiness()).ready);
    const [rows]=await pool.execute('SELECT * FROM governance_decision_records WHERE decision_record_id=?',[oldRows[0].decision_record_id]);assert.deepEqual(rows,oldRows);
    const [[latest]]=await pool.execute('SELECT accountable_person_id,recorded_by_person_id FROM governance_decision_records ORDER BY decision_record_id DESC LIMIT 1');assert.equal(String(latest.accountable_person_id),String(latest.recorded_by_person_id));
  });
  await check('responsible person change requires a new confirmation and revocation closes access',async()=>{
    await pool.execute('UPDATE departments SET final_responsible_person_id=103 WHERE id=91');assert.equal((await readiness()).ready,false);
    await access.recordGovernanceDecision({...base,recorderPersonId:103,actor:actor(103)});assert((await readiness()).ready);
    await pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=103");
    assert.equal((await readiness()).ready,false);assert(!(await identity.getUserEffectivePermissions(103)).permSet.has('governance:record-department-decision'));
  });
});
const out=process.argv[2]||path.resolve(__dirname,'../../../artifacts/department-accountabilitAX4261019-01/generic-decisions');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,productionAccess:false},null,2)+'\n');}
main().catch(error=>{console.error(JSON.stringify({passed:false,code:error.code||'DEPARTMENT_DECISION_TEST_FAILED',message:String(error.message).split('\n')[0]}));process.exitCode=1;});
