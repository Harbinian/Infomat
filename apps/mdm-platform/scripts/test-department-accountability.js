// Synthetic data in one owned disposable MySQL; no private configuration or existing instance.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {mdmMysqlSchemaSql,splitSqlStatements}=require('../server/mysqlSchema');
const {ensureMysqlBuiltInRolesAndPermissions}=require('../server/identityMysqlRepository');
const {PROCESS_V7_PREVIEW_SCHEMA_SQL}=require('../server/processV7PreviewReviewMigration');
const responsibilities=require('../server/governanceResponsibilitiesMigration');
const directory=require('../server/hrDirectoryRoleMigration');
const migration=require('../server/departmentAccountabilityMigration');
const authority=require('../server/departmentAccountability');
const checks=[];
async function check(name,work){await work();checks.push(name);console.log('PASS '+name);}
async function main(){
  await withFreshMysql(async({pool})=>{
    for(const sql of splitSqlStatements(mdmMysqlSchemaSql()))await pool.execute(sql);
    for(const sql of splitSqlStatements(PROCESS_V7_PREVIEW_SCHEMA_SQL))await pool.execute(sql);
    await ensureMysqlBuiltInRolesAndPermissions(pool);
    await pool.execute("DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id=rp.role_id WHERE r.role_code IN ('mdm_steward','hr_directory_manager')");
    await pool.execute("DELETE FROM roles WHERE role_code IN ('mdm_steward','hr_directory_manager')");
    await pool.execute("DELETE FROM permissions WHERE perm_code IN ('governance:handle-assigned-work','directory:read','directory:maintain')");
    await pool.execute("UPDATE roles SET model_version=? WHERE status='active'",[responsibilities.PREVIOUS_MODEL_VERSION]);
    await pool.execute("UPDATE roles SET role_name='部门MDM审核员',description='historical recorder' WHERE role_code='department_mdm_reviewer'");
    await pool.execute("UPDATE permissions SET description='historical delegated decision' WHERE perm_code='governance:record-department-decision'");
    await pool.execute("INSERT INTO departments(id,name,code,status) VALUES(91,'Synthetic A','SYN_A','active'),(92,'Synthetic B','SYN_B','active')");
    for(const [person,dept]of [[101,91],[102,91],[103,91],[104,92]]){
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(?,?,?,?)',[person,'SYN_'+person,'Synthetic '+person,dept]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status) VALUES(?,?,?,?,'active')",[person+1000,person,'SYN_'+person,'synthetic-unusable-password-hash']);
    }
    const grant=(person,role,dept=91)=>pool.execute(`INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,effective_from,authorization_basis)
      SELECT ?,role_id,?,?,'2000-01-01','synthetic explicit appointment' FROM roles WHERE role_code=?`,[person,role.startsWith('department_')?'department':'global',role.startsWith('department_')?dept:null,role]);
    await grant(102,'department_mdm_reviewer');
    const legacyDecision=async()=>{
      const [row]=await pool.execute("INSERT INTO governance_decision_records(subject_domain,subject_type,subject_id,subject_version,department_id,accountable_person_id,recorded_by_person_id,decision,decision_basis,decided_at) VALUES('process','synthetic','1','1',91,101,102,'approved','synthetic historical record',CURRENT_TIMESTAMP)");return String(row.insertId);
    };
    const historicalId=await legacyDecision();
    const originalGrants=JSON.stringify((await pool.execute('SELECT * FROM person_roles ORDER BY person_role_id'))[0]);
    const oldIds=(await pool.execute('SELECT CAST(role_id AS CHAR) role_id,role_code FROM roles ORDER BY role_code'))[0];
    const db=await pool.getConnection();
    try{
      await check('v3 requires explicit frozen predecessor migration and is not silently upgraded by this policy',async()=>{
        const inspection=await migration.inspectDepartmentAccountabilityPolicy(db);assert.equal(inspection.ready,false);assert.ok(inspection.drift.length);
        await assert.rejects(migration.applyDepartmentAccountabilityPolicy(db),{code:'DEPARTMENT_ACCOUNTABILITY_SCHEMA_DRIFT'});
        assert.equal((await pool.execute("SELECT model_version FROM roles WHERE role_code='admin'"))[0][0].model_version,responsibilities.PREVIOUS_MODEL_VERSION);
      });
      await responsibilities.applyResponsibilities(db);
      await check('v4 preparation preserves role ids grants model and historical decisions while reporting missing people separately',async()=>{
        const result=await migration.applyDepartmentAccountabilityPolicy(db);assert.equal(result.ready,true);assert.equal(result.responsibility_ready,false);
        assert.equal(result.responsibilities.gaps.length,2);assert.equal(result.responsibilities.unmatched_authorizations.length,1);
        assert.equal(result.model_version,directory.PREVIOUS_MODEL_VERSION);
        assert.equal((await pool.execute("SELECT COUNT(*) n FROM roles WHERE role_code='hr_directory_manager'"))[0][0].n,0);
        assert.equal(JSON.stringify((await pool.execute('SELECT * FROM person_roles ORDER BY person_role_id'))[0]),originalGrants);
        assert.deepEqual((await pool.execute("SELECT CAST(role_id AS CHAR) role_id,role_code FROM roles WHERE role_code<>'mdm_steward' ORDER BY role_code"))[0],oldIds);
        assert.equal(await authority.isPostPolicyDecision(pool,historicalId),false);
        assert.equal((await migration.applyDepartmentAccountabilityPolicy(db)).idempotent,true);
      });
      await check('unused compensation restores only role wording and preserves tables ids and authorizations',async()=>{
        assert.equal((await migration.compensateDepartmentAccountabilityPolicy(db)).compensated,true);
        assert.equal((await pool.execute("SELECT role_name FROM roles WHERE role_code='department_mdm_reviewer'"))[0][0].role_name,'部门MDM审核员');
        assert.equal((await pool.execute("SELECT description FROM permissions WHERE perm_code='governance:record-department-decision'"))[0][0].description,'historical delegated decision');
        assert.equal((await migration.compensateDepartmentAccountabilityPolicy(db)).idempotent,true);
        assert.equal(await authority.isPostPolicyDecision(pool,historicalId),false);
      });
      const whileDisabled=await legacyDecision();
      await directory.applyHrDirectoryRole(db);
      await check('v5 reactivation preserves separate HR model and refreshes historical cutoff without discarding prior snapshot',async()=>{
        const rolesBefore=JSON.stringify((await pool.execute('SELECT role_id,role_code,model_version FROM roles ORDER BY role_id'))[0]);
        assert.equal((await migration.applyDepartmentAccountabilityPolicy(db)).ready,true);
        assert.equal(JSON.stringify((await pool.execute('SELECT role_id,role_code,model_version FROM roles ORDER BY role_id'))[0]),rolesBefore);
        assert.equal(await authority.isPostPolicyDecision(pool,whileDisabled),false);
        assert.equal((await authority.policyState(pool)).snapshot.previous_snapshots.length,1);
      });
      await check('unexpected old permission effect is rejected without repairing or deleting the grant',async()=>{
        await pool.execute("UPDATE role_permissions rp JOIN roles r ON r.role_id=rp.role_id JOIN permissions p ON p.perm_id=rp.perm_id SET rp.effect='deny' WHERE r.role_code='department_mdm_reviewer' AND p.perm_code='governance:review-department'");
        await assert.rejects(migration.applyDepartmentAccountabilityPolicy(db),{code:'DEPARTMENT_ACCOUNTABILITY_SCHEMA_DRIFT'});
        assert.ok((await migration.inspectDepartmentAccountabilityPolicy(db)).drift.some(d=>d.reason==='permission_baseline_changed'));
        await pool.execute("UPDATE role_permissions rp JOIN roles r ON r.role_id=rp.role_id SET rp.effect='allow' WHERE r.role_code='department_mdm_reviewer'");
      });
      const actor=person=>({personId:person,accountId:person+1000,authVersion:1});
      await check('missing department responsibility denies all delegated confirmation despite an old reviewer grant',async()=>{
        assert.equal((await authority.inspectDepartmentAccountability(pool,actor(102),91)).reason,'DEPARTMENT_FINAL_RESPONSIBLE_UNSET');
        await assert.rejects(authority.assertDepartmentAccountability(db,actor(102),91),{code:'DEPARTMENT_FINAL_RESPONSIBLE_UNSET'});
      });
      await pool.execute('UPDATE departments SET final_responsible_person_id=101 WHERE id=91');
      await check('organization pointer alone and reviewer grant alone both fail closed',async()=>{
        assert.equal((await authority.inspectDepartmentAccountability(pool,actor(101),91)).reason,'DEPARTMENT_ACCOUNTABILITY_ROLE_REQUIRED');
        assert.equal((await authority.inspectDepartmentAccountability(pool,actor(102),91)).reason,'DEPARTMENT_FINAL_RESPONSIBLE_MISMATCH');
        assert.equal((await authority.inspectDepartmentAccountability(pool,actor(104),91)).reason,'DEPARTMENT_PERSON_SCOPE_MISMATCH');
      });
      await grant(101,'department_mdm_reviewer');
      let evidence;
      await check('explicit same-department grant plus current final responsibility produces source-bound direct decision evidence',async()=>{
        await db.beginTransaction();
        try {const qualified=await authority.assertDepartmentAccountability(db,actor(101),91,{lock:true});evidence=authority.decisionEvidence(qualified,{sourceRevision:2,sourceHash:'a'.repeat(64)});await db.commit();}catch(error){await db.rollback();throw error;}
        assert.equal(evidence.confirmed_by_person_id,'101');assert.equal(evidence.accountable_person_id,'101');
        assert.equal((await authority.inspectCurrentDepartmentDecision(pool,91,evidence,{sourceRevision:2,sourceHash:'a'.repeat(64)})).valid,true);
        assert.equal((await authority.inspectCurrentDepartmentDecision(pool,91,evidence,{sourceRevision:3,sourceHash:'b'.repeat(64)})).valid,false);
        assert.equal(authority.isCurrentDepartmentDecision({...evidence,policy_version:undefined},{departmentId:91,personId:101,sourceRevision:2,sourceHash:'a'.repeat(64)}),false);
      });
      await check('transactional confirmation holds the current department responsibility binding until commit',async()=>{
        const contender=await pool.getConnection();
        await db.beginTransaction();
        try{
          await authority.assertDepartmentAccountability(db,actor(101),91,{lock:true});
          await contender.execute('SET SESSION innodb_lock_wait_timeout=1');
          await assert.rejects(contender.execute('UPDATE departments SET final_responsible_person_id=102 WHERE id=91'),{code:'ER_LOCK_WAIT_TIMEOUT'});
          await db.commit();
        }catch(error){await db.rollback();throw error;}finally{contender.release();}
        assert.equal((await pool.execute('SELECT final_responsible_person_id FROM departments WHERE id=91'))[0][0].final_responsible_person_id,101);
      });
      await check('responsible-person changes revocations inactive accounts and admin overlap invalidate direct evidence',async()=>{
        await pool.execute('UPDATE departments SET final_responsible_person_id=102 WHERE id=91');
        assert.equal((await authority.inspectCurrentDepartmentDecision(pool,91,evidence,{sourceRevision:2,sourceHash:'a'.repeat(64)})).valid,false);
        await pool.execute('UPDATE departments SET final_responsible_person_id=101 WHERE id=91');
        await pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=101");
        assert.equal(await authority.canConfirmDepartment(pool,actor(101),91),false);
        await pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=101");
        await pool.execute("UPDATE user_accounts SET account_status='disabled' WHERE person_id=101");
        assert.equal((await authority.inspectDepartmentAccountability(pool,actor(101),91)).reason,'DEPARTMENT_ACCOUNTABILITY_ACTOR_INACTIVE');
        await pool.execute("UPDATE user_accounts SET account_status='active' WHERE person_id=101");
        await grant(101,'admin');
        assert.equal((await authority.inspectDepartmentAccountability(pool,actor(101),91)).reason,'DEPARTMENT_ACCOUNTABILITY_ADMIN_READ_ONLY');
      });
      await check('post-policy decision IDs are distinguishable and used policies cannot be automatically compensated',async()=>{
        const next=await legacyDecision();assert.equal(await authority.isPostPolicyDecision(pool,next),true);
        await assert.rejects(migration.compensateDepartmentAccountabilityPolicy(db),{code:'DEPARTMENT_ACCOUNTABILITY_COMPENSATION_BLOCKED'});
        assert.equal((await migration.inspectDepartmentAccountabilityPolicy(db)).ready,true);
      });
    }finally{db.release();}
  },{stage:'21',randomDatabase:true});
  const argument=process.argv.indexOf('--output');
  if(argument>=0){const output=path.resolve(process.argv[argument+1]);assert.ok(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'department-accountability-results.json'),JSON.stringify({passed:checks.length,checks},null,2)+'\n');}
  console.log('DEPARTMENT_ACCOUNTABILITY_PASS '+checks.length);
}
if(require.main===module)main().catch(error=>{console.error(error.stack);if(error.inspection)console.error(JSON.stringify(error.inspection));process.exitCode=1;});
module.exports={main};
