// Uses only an owned disposable MySQL container and synthetic identities. No
// private config, existing container, formal database or application port is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { ensureMysqlBuiltInRolesAndPermissions, makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const { PROCESS_V7_PREVIEW_SCHEMA_SQL } = require('../server/processV7PreviewReviewMigration');
const { PROCESS_DATA_GOVERNANCE_SCHEMA_SQL } = require('../server/processDataGovernanceMigration');
const migration = require('../server/governanceResponsibilitiesMigration');
const directoryRoleMigration = require('../server/hrDirectoryRoleMigration');
const accountabilityPolicy = require('../server/departmentAccountabilityMigration');
const responsibilities = require('../server/governanceResponsibilities');
const { makeProcessDataGovernanceRepository } = require('../server/processDataGovernanceRepository');
const { digest } = require('../server/processDataGovernance');
const { ACCESS_MODEL_VERSION } = require('../server/roleDefinitions');
const { validateRoleAssignmentInput, makeGovernanceAccessMysqlRepository } = require('../server/governanceAccessMysqlRepository');
const checks = [];
async function check(name, work) { await work(); checks.push(name); console.log('PASS ' + name); }
async function main() {
  process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
  process.env.PROCESS_DATA_GOVERNANCE_ENABLED = '1';
  delete process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY;
  await withFreshMysql(async ({ pool }) => {
    for (const sql of splitSqlStatements(mdmMysqlSchemaSql())) await pool.execute(sql);
    for (const sql of splitSqlStatements(PROCESS_V7_PREVIEW_SCHEMA_SQL)) await pool.execute(sql);
    for (const sql of splitSqlStatements(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL)) await pool.execute(sql);
    await ensureMysqlBuiltInRolesAndPermissions(pool);
    await pool.execute("DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id=rp.role_id WHERE r.role_code IN ('mdm_steward','hr_directory_manager')");
    await pool.execute("DELETE FROM roles WHERE role_code IN ('mdm_steward','hr_directory_manager')");
    await pool.execute("DELETE FROM permissions WHERE perm_code IN ('governance:handle-assigned-work','directory:read','directory:maintain')");
    await pool.execute("UPDATE roles SET model_version=? WHERE status='active'", [migration.PREVIOUS_MODEL_VERSION]);
    await pool.execute("INSERT INTO departments(id,name,code,status) VALUES(91,'Synthetic A','SYN_A','active'),(92,'Synthetic B','SYN_B','active')");
    for (const [id, dept] of [[101,91],[102,91],[103,91],[104,92],[105,91],[106,91],[107,91],[108,91]]) {
      await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(?,?,?,?)", [id,'SYN_'+id,'Synthetic '+id,dept]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status) VALUES(?,?,?,?,'active')", [id+1000,id,'SYN_'+id,'synthetic-unusable-password-hash']);
    }
    await pool.execute('UPDATE departments SET final_responsible_person_id=103 WHERE id=91');
    const grant = (id, code) => pool.execute(`INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,effective_from,authorization_basis)
      SELECT ?,role_id,?,?, '2000-01-01','synthetic confirmed appointment' FROM roles WHERE role_code=?`, [id, code.startsWith('department_') ? 'department' : 'global', code.startsWith('department_') ? 91 : null, code]);
    await grant(101,'mdm_lead'); await grant(105,'admin'); await grant(108,'department_contact');
    const scalar = async (sql, params=[]) => (await pool.execute(sql,params))[0][0];
    const oldRoles = (await pool.execute("SELECT CAST(role_id AS CHAR) AS role_id,role_code FROM roles WHERE status='active' ORDER BY role_code"))[0];
    const oldGrants = JSON.stringify((await pool.execute('SELECT * FROM person_roles ORDER BY person_role_id'))[0]);
    const db = await pool.getConnection();
    try {
      await check('missing schema denies new endpoints without granting legacy case access', async () => {
        assert.equal(await responsibilities.hasAssignedResponsibility(pool,{personId:102},'case',1),false);
        const result = await migration.inspectResponsibilities(db);
        assert.equal(result.ready,false); assert.equal(result.missing.length,4);
      });
      await check('additive migration preserves seven role IDs and all person grants; repeated apply is idempotent', async () => {
        assert.equal((await migration.applyResponsibilities(db)).ready,true);
        assert.equal((await migration.applyResponsibilities(db)).ready,true);
        assert.deepEqual((await pool.execute("SELECT CAST(role_id AS CHAR) AS role_id,role_code FROM roles WHERE status='active' AND role_code<>'mdm_steward' ORDER BY role_code"))[0],oldRoles);
        assert.equal(JSON.stringify((await pool.execute('SELECT * FROM person_roles ORDER BY person_role_id'))[0]),oldGrants);
        assert.equal(Number((await scalar('SELECT COUNT(*) n FROM process_governance_responsibilities')).n),0);
        assert.equal(Number((await scalar("SELECT COUNT(*) n FROM roles WHERE status='active' AND model_version=?",[directoryRoleMigration.PREVIOUS_MODEL_VERSION])).n),8);
      });
      await check('unused model safely compensates, preserves tables, and reapplies', async () => {
        assert.equal((await migration.compensateResponsibilities(db)).compensated,true);
        assert.equal((await migration.compensateResponsibilities(db)).idempotent,true);
        assert.equal((await scalar("SELECT model_version FROM roles WHERE role_code='mdm_lead'")).model_version,migration.PREVIOUS_MODEL_VERSION);
        await assert.rejects(responsibilities.makeGovernanceResponsibilitiesRepository(pool).workbench({personId:101}),{code:'RESPONSIBILITY_MIGRATION_REQUIRED'});
        assert.equal((await migration.applyResponsibilities(db)).ready,true);
      });
      await check('v4 role step stays frozen and explicitly chains to v5 without changing governance grants', async () => {
        assert.equal((await directoryRoleMigration.applyHrDirectoryRole(db)).ready, true);
        const repeated = await migration.applyResponsibilities(db);
        assert.equal(repeated.ready, true);
        assert.equal(repeated.model_version, ACCESS_MODEL_VERSION);
        assert.equal(Number((await scalar("SELECT COUNT(*) n FROM roles WHERE status='active' AND model_version=?",[ACCESS_MODEL_VERSION])).n),9);
        assert.equal(JSON.stringify((await pool.execute('SELECT * FROM person_roles ORDER BY person_role_id'))[0]),oldGrants);
      });
      await accountabilityPolicy.applyDepartmentAccountabilityPolicy(db);
      const access = makeGovernanceAccessMysqlRepository(pool);
      await access.grantRole(102,{roleCode:'mdm_steward',effectiveFrom:'2000-01-01',authorizationBasis:'synthetic explicit grant'});
      await access.grantRole(107,{roleCode:'mdm_steward',effectiveFrom:'2000-01-01',authorizationBasis:'synthetic explicit grant'});
      await check('new role assignment is supported but has neither department/global read nor review/publish permissions', async () => {
        assert.equal(validateRoleAssignmentInput({roleCode:'mdm_steward',effectiveFrom:'2000-01-01'},91,true).scopeType,'global');
        const permissions=(await makeIdentityMysqlRepository(pool).getUserEffectivePermissions(102)).permSet;
        assert.deepEqual([...permissions].sort(),['governance:handle-assigned-work','governance:read-assigned-context']);
        await assert.rejects(migration.compensateResponsibilities(db),{code:'RESPONSIBILITY_COMPENSATION_BLOCKED'});
      });
    } finally { db.release(); }
    const identity=makeIdentityMysqlRepository(pool);
    const actor=async id=>{
      const user=await scalar('SELECT account_id,auth_version FROM user_accounts WHERE person_id=?',[id]);
      const roleRows=await identity.getUserRoleCodes(id), permissions=(await identity.getUserEffectivePermissions(id)).permSet;
      return {personId:id,accountId:user.account_id,authVersion:user.auth_version,departmentId:id===104?92:91,
        roleCodes:new Set(roleRows.map(r=>r.code)),permissions,canReadGlobal:permissions.has('governance:read-global')};
    };
    const lead=await actor(101), steward=await actor(102), final=await actor(103), foreign=await actor(104), admin=await actor(105), owner=await actor(106), otherSteward=await actor(107);
    const sourceHash='a'.repeat(64);
    for(const id of [1,2]) await pool.execute(`INSERT INTO process_v7_preview_cases(id,case_ref,process_ref,process_name,owning_department_id,status,current_revision_no,current_content_hash,blocking_issues_json)
      VALUES(?,?,?,?,91,'under_review',1,?,'[]')`,[id,'synthetic-case-'+id,'synthetic-process-'+id,'Synthetic process '+id,sourceHash]);
    const repo=responsibilities.makeGovernanceResponsibilitiesRepository(pool);
    await check('organization responsibility alone cannot appoint; explicit matching department role enables the owner appointment',async()=>{
      const before=await repo.describe('case',1,final);
      assert.equal(before.assignments.owner,null);
      assert.equal(before.allowed_actions.includes('assign_owner'),false);
      assert.equal(before.department_accountability.reason,'DEPARTMENT_ACCOUNTABILITY_ROLE_REQUIRED');
      await assert.rejects(repo.assign('case',1,'owner',{person_id:106,basis:'organization pointer alone',expected_revision:0},final),{code:'RESPONSIBILITY_ASSIGN_DENIED'});
      await grant(103,'department_mdm_reviewer');
      Object.assign(final,await actor(103));
      const detail=await repo.describe('case',1,final);
      assert.equal(detail.assignments.owner,null); assert.equal(detail.assignments.steward,null);
      assert.deepEqual(detail.allowed_actions,['assign_owner']);
      assert.equal((await repo.workbench(final)).items.length,2);
      assert.equal((await repo.workbench(steward)).items.length,0);
      await assert.rejects(repo.describe('case',1,steward),{code:'RESPONSIBILITY_READ_DENIED'});
    });
    await check('only lead appoints qualified steward; only current department final responsible person appoints own-department owner',async()=>{
      await assert.rejects(repo.assign('case',1,'steward',{person_id:102,basis:'confirmed',expected_revision:0},final),{code:'RESPONSIBILITY_ASSIGN_DENIED'});
      await assert.rejects(repo.assign('case',1,'owner',{person_id:106,basis:'confirmed',expected_revision:0},lead),{code:'RESPONSIBILITY_ASSIGN_DENIED'});
      await assert.rejects(repo.assign('case',1,'owner',{person_id:104,basis:'confirmed',expected_revision:0},final),{code:'RESPONSIBILITY_PERSON_INELIGIBLE'});
      await assert.rejects(repo.assign('case',1,'steward',{person_id:106,basis:'confirmed',expected_revision:0},lead),{code:'RESPONSIBILITY_PERSON_INELIGIBLE'});
      await assert.rejects(repo.assign('case',1,'steward',{person_id:102,basis:' ',expected_revision:0},lead),{code:'RESPONSIBILITY_INPUT_INVALID'});
      assert.equal((await repo.assign('case',1,'steward',{person_id:102,basis:'confirmed',expected_revision:0},lead)).assignments.steward.person_id,'102');
      await repo.assign('case',1,'owner',{person_id:106,basis:'confirmed owner',expected_revision:0},final);
      assert.equal(await responsibilities.hasAssignedResponsibility(pool,owner,'case',1,'owner'),true);
      assert.equal(await responsibilities.hasAssignedResponsibility(pool,steward,'case',2),false);
      await assert.rejects(repo.describe('case',2,steward),{code:'RESPONSIBILITY_READ_DENIED'});
      await assert.rejects(repo.assign('case',1,'steward',{person_id:102,basis:'confirmed',expected_revision:1},admin),{code:'RESPONSIBILITY_ASSIGN_DENIED'});
      await assert.rejects(repo.describe('case',1,foreign),{code:'RESPONSIBILITY_READ_DENIED'});
    });
    const record={request_key:crypto.randomUUID(),content:'Evidence checked; business decision remains with department.',basis:'Synthetic source section 1',expected_revision:1,expected_source_revision:1,expected_source_hash:sourceHash};
    await check('assigned work records are source-bound, idempotent and do not change source JSON or confer approval',async()=>{
      const result=await repo.recordWork(1,record,steward); assert.equal(result.idempotent,false);
      assert.equal((await repo.recordWork(1,record,steward)).idempotent,true);
      await assert.rejects(repo.recordWork(1,{...record,content:'changed'},steward),{code:'RESPONSIBILITY_REQUEST_CONFLICT'});
      await assert.rejects(repo.recordWork(2,{...record,request_key:crypto.randomUUID()},steward),{code:'RESPONSIBILITY_ASSIGNMENT_REQUIRED'});
      await assert.rejects(repo.recordWork(1,{...record,request_key:crypto.randomUUID(),expected_source_hash:'b'.repeat(64)},steward),{code:'RESPONSIBILITY_WORK_SOURCE_CHANGED'});
      assert.equal((await scalar('SELECT current_content_hash FROM process_v7_preview_cases WHERE id=1')).current_content_hash,sourceHash);
      const view=await repo.describe('case',1,steward); assert.deepEqual(view.allowed_actions,['record_work']); assert.equal(view.work_records.length,1);
    });
    await check('stale and competing appointments cannot overwrite; replacement and revocation retain audit history',async()=>{
      const results=await Promise.allSettled([repo.assign('case',2,'steward',{person_id:102,basis:'race A',expected_revision:0},lead),repo.assign('case',2,'steward',{person_id:107,basis:'race B',expected_revision:0},lead)]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(results.find(r=>r.status==='rejected').reason.code,'RESPONSIBILITY_REVISION_CHANGED');
      await repo.assign('case',1,'steward',{person_id:107,basis:'replace',expected_revision:1},lead);
      assert.equal(await responsibilities.hasAssignedResponsibility(pool,steward,'case',1),false);
      await assert.rejects(repo.recordWork(1,{...record,request_key:crypto.randomUUID()},steward),{code:'RESPONSIBILITY_ASSIGNMENT_REQUIRED'});
      await repo.assign('case',1,'steward',{person_id:null,basis:'revoke',expected_revision:2},lead);
      assert.equal((await repo.describe('case',1,lead)).history.filter(r=>r.assignment_kind==='steward').length,3);
      await repo.assign('case',1,'steward',{person_id:102,basis:'reappoint',expected_revision:3},lead);
    });
    await check('revoked role, account auth change, admin overlap and owner department change invalidate access immediately',async()=>{
      await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='revoked' WHERE pr.person_id=102 AND r.role_code='mdm_steward'");
      assert.equal(await responsibilities.hasAssignedResponsibility(pool,steward,'case',1),false);
      await pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=102");
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=102');
      await assert.rejects(responsibilities.hasAssignedResponsibility(pool,steward,'case',1),{code:'SESSION_AUTHORIZATION_CHANGED'});
      Object.assign(steward,await actor(102));
      await grant(102,'admin'); assert.equal(await responsibilities.hasAssignedResponsibility(pool,steward,'case',1),false);
      await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='revoked' WHERE pr.person_id=102 AND r.role_code='admin'");
      await pool.execute('UPDATE person SET current_department_id=92 WHERE person_id=106');
      assert.equal(await responsibilities.hasAssignedResponsibility(pool,owner,'case',1,'owner'),false);
      await pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=106');
    });
    const document={schema_version:'process-governance-v8',process:{process_ref:'synthetic-fixed',process_name:'Synthetic fixed'},behaviors:[],data_objects:[{data_ref:'data_synthetic',data_name:'Synthetic data',fields:[],behavior_links:[],source_relations:[],lifecycle:{routes:[]}}]};
    await pool.execute("INSERT INTO process_design_documents(id,document_no,process_ref,document_title,owning_department_id) VALUES(1,'SYN-1','synthetic-fixed','Synthetic fixed',91)");
    await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id,status) VALUES(1,1,'SYN-1','Synthetic fixed','A','Synthetic fixed','synthetic','synthetic','synthetic',91,'published')");
    await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash) VALUES(1,1,1,'SYN-1','Synthetic fixed','A','SYN-1-A',91,'process-governance-v8',?,?)",[JSON.stringify(document),digest(document)]);
    const dataRepo=makeProcessDataGovernanceRepository(pool);
    const created=await dataRepo.queueAndMaterialize(1,lead), packageId=created.package.id;
    await check('case assignment grants no package access; explicit package steward can govern but cannot create or complete',async()=>{
      assert.equal(await dataRepo.canReadAssignedPackage(packageId,steward),false);
      await assert.rejects(dataRepo.generateCandidates(packageId,1,steward),{code:'RESPONSIBILITY_ASSIGNMENT_REQUIRED'});
      await repo.assign('work_package',packageId,'steward',{person_id:102,basis:'package assignment',expected_revision:0},lead);
      assert.equal(await dataRepo.canReadAssignedPackage(packageId,steward),true);
      assert.equal(await dataRepo.canReadAssignedPackage(packageId,otherSteward),false);
      const generated=await dataRepo.generateCandidates(packageId,1,steward);
      assert(generated.created>0);
      const detail=await dataRepo.getWorkPackageDetail(packageId);
      let revision=detail.package.revision_no;
      for(const item of detail.details) { const result=await dataRepo.updateDetail(packageId,item.id,revision,{status:'not_applicable',governance:{basis:'synthetic evidence'}},steward); revision=result.package.revision_no; }
      await assert.rejects(dataRepo.completeWorkPackage(packageId,revision,'synthetic review',steward),{code:'PROCESS_DATA_GOVERNANCE_MDM_ONLY'});
      await assert.rejects(dataRepo.queueAndMaterialize(1,steward),{code:'PROCESS_DATA_GOVERNANCE_MDM_ONLY'});
      assert.equal((await dataRepo.listWorkPackages(null,steward)).length,1);
      assert.equal((await dataRepo.listWorkPackages(null,otherSteward)).length,0);
      await repo.assign('work_package',packageId,'steward',{person_id:null,basis:'remove package assignment',expected_revision:1},lead);
      await assert.rejects(dataRepo.generateCandidates(packageId,revision,steward),{code:'RESPONSIBILITY_ASSIGNMENT_REQUIRED'});
      await repo.assign('work_package',packageId,'steward',{person_id:102,basis:'retain explicit completed-package reader',expected_revision:2},lead);
      assert.equal((await dataRepo.completeWorkPackage(packageId,revision,'lead review',lead)).package.status,'completed');
    });
    await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash) VALUES(2,1,1,'SYN-1','Synthetic fixed','B','SYN-1-B',91,'process-governance-v8',?,?)",[JSON.stringify(document),digest(document)]);
    const secondPackage=(await dataRepo.queueAndMaterialize(2,lead)).package.id;
    await repo.assign('work_package',secondPackage,'steward',{person_id:102,basis:'separate active package',expected_revision:0},lead);
    await check('disabled modules and read-only mode reject route and repository writes, hide disabled tasks and retain only completed package reads',async()=>{
      const auth=require('../server/auth'), router=require('../server/routes/governanceResponsibilities'), express=require('express');
      auth.setIdentityRepositoryFactory(()=>identity); router.setRepositoryFactory(()=>repo); router.setActorFactory(()=>lead);
      const app=express();app.use(express.json());app.use((req,_res,next)=>{req.session={...lead};next();});app.use('/responsibilities',router);
      const server=await new Promise(resolve=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));});
      const http=async(method,url,body)=>{
        const response=await fetch(`http://127.0.0.1:${server.address().port}/responsibilities${url}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
        return {status:response.status,body:await response.json()};
      };
      const deniedAssignment={person_id:107,basis:'must not be recorded',expected_revision:1};
      const before=await scalar('SELECT (SELECT COUNT(*) FROM process_governance_responsibility_events) appointments,(SELECT COUNT(*) FROM process_governance_work_records) records');
      try {
        process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY='1';
        await assert.rejects(repo.assign('work_package',secondPackage,'steward',deniedAssignment,lead),{code:'PROCESS_DATA_GOVERNANCE_READ_ONLY'});
        await assert.rejects(responsibilities.assertAssignedSteward(pool,steward,'work_package',secondPackage),{code:'PROCESS_DATA_GOVERNANCE_READ_ONLY'});
        let response=await http('PUT',`/work-packages/${secondPackage}/steward`,deniedAssignment);
        assert.equal(response.status,409);assert.equal(response.body.code,'PROCESS_DATA_GOVERNANCE_READ_ONLY');
        await assert.rejects(repo.describe('work_package',secondPackage,lead),{code:'PROCESS_DATA_GOVERNANCE_COMPLETED_ONLY'});
        response=await http('GET',`/work-packages/${secondPackage}`);assert.equal(response.status,403);assert.equal(response.body.code,'PROCESS_DATA_GOVERNANCE_COMPLETED_ONLY');
        assert.deepEqual((await repo.describe('work_package',packageId,steward)).allowed_actions,[]);
        response=await http('GET',`/work-packages/${packageId}`);assert.equal(response.status,200);assert.deepEqual(response.body.allowed_actions,[]);
        assert.deepEqual((await repo.workbench(steward)).items.filter(item=>item.target_type==='work_package').map(item=>item.target_id),[String(packageId)]);
        assert.equal(await responsibilities.hasAssignedResponsibility(pool,steward,'work_package',secondPackage),false);
        delete process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY;
        process.env.PROCESS_DATA_GOVERNANCE_ENABLED='0';
        await assert.rejects(repo.assign('work_package',secondPackage,'steward',deniedAssignment,lead),{code:'PROCESS_DATA_GOVERNANCE_DISABLED'});
        await assert.rejects(repo.describe('work_package',packageId,lead),{code:'PROCESS_DATA_GOVERNANCE_DISABLED'});
        response=await http('PUT',`/work-packages/${secondPackage}/steward`,deniedAssignment);assert.equal(response.status,503);assert.equal(response.body.code,'PROCESS_DATA_GOVERNANCE_DISABLED');
        assert.equal((await repo.workbench(steward)).items.some(item=>item.target_type==='work_package'),false);
        process.env.PROCESS_V7_PREVIEW_ENABLED='0';
        await assert.rejects(repo.assign('case',1,'owner',deniedAssignment,final),{code:'V7_PREVIEW_DISABLED'});
        await assert.rejects(repo.describe('case',1,lead),{code:'V7_PREVIEW_DISABLED'});
        await assert.rejects(repo.recordWork(1,record,steward),{code:'V7_PREVIEW_DISABLED'});
        for(const [method,url,body] of [['GET','/cases/1'],['PUT','/cases/1/steward',deniedAssignment],['POST','/cases/1/work-records',record]]) {
          response=await http(method,url,body);assert.equal(response.status,503);assert.equal(response.body.code,'V7_PREVIEW_DISABLED');
        }
        assert.equal(await responsibilities.hasAssignedResponsibility(pool,steward,'case',1),false);
        assert.deepEqual((await repo.workbench(steward)).items,[]);assert.deepEqual((await repo.workbench(final)).items,[]);
        assert.deepEqual(await scalar('SELECT (SELECT COUNT(*) FROM process_governance_responsibility_events) appointments,(SELECT COUNT(*) FROM process_governance_work_records) records'),before);
      } finally {
        process.env.PROCESS_V7_PREVIEW_ENABLED='1';process.env.PROCESS_DATA_GOVERNANCE_ENABLED='1';delete process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY;
        await new Promise(resolve=>server.close(resolve));router.resetFactories();auth.resetIdentityRepositoryFactory();
      }
    });
  },{stage:'05',randomDatabase:true});
  const index=process.argv.indexOf('--output');
  if(index>=0) {
    const output=path.resolve(process.argv[index+1]);
    assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));
    fs.mkdirSync(output,{recursive:true}); fs.writeFileSync(path.join(output,'responsibilities-results.json'),JSON.stringify({passed:checks.length,checks},null,2)+'\n');
  }
  console.log('GOVERNANCE_RESPONSIBILITIES_PASS '+checks.length);
}
if(require.main===module) main().catch(error=>{console.error(error.stack);if(error.inspection)console.error(JSON.stringify(error.inspection));process.exitCode=1;});
module.exports={main};
