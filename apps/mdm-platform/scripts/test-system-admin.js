// Real owned tmpfs MySQL/HTTP and Edge, synthetic credentials held in memory only.
// --output must name a new ignored evidence directory; no formal environment/files.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const migration=require('../server/systemAdminMigration');
const identity=require('../server/systemAdminIdentity');
const {hashPassword}=require('../server/auth');
const output=path.resolve(process.argv[process.argv.indexOf('--output')+1]||'');
assert(process.argv.includes('--output')&&output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));
assert(!fs.existsSync(output),'preserve prior evidence');fs.mkdirSync(output,{recursive:true});
async function main(){const checks=[];
  await withStage05Fixture(async({pool,fixture,expect,request,backup,restore})=>{
    const db=await pool.getConnection();
    try{
      assert((await migration.inspectSystemAdmin(db)).ready);
      assert((await migration.applySystemAdmin(db)).ready);
      await db.execute('ALTER TABLE system_admin_accounts ADD COLUMN synthetic_drift INT NULL');
      assert((await migration.inspectSystemAdmin(db)).drift.length);
      await assert.rejects(migration.applySystemAdmin(db),e=>e.code==='SYSTEM_ADMIN_SCHEMA_DRIFT');
      await db.execute('ALTER TABLE system_admin_accounts DROP COLUMN synthetic_drift');
    }finally{db.release();}
    checks.push('additive repeat maintenance and unknown drift refusal');
    const [[before]]=await pool.execute('SELECT (SELECT COUNT(*) FROM person) persons,(SELECT COUNT(*) FROM user_accounts) accounts,(SELECT COUNT(*) FROM person_roles) roles');
    const snapshot=async tables=>crypto.createHash('sha256').update(JSON.stringify(await Promise.all(tables.map(async table=>(await pool.query('SELECT * FROM '+table+' ORDER BY 1'))[0])))).digest('hex');
    const password=crypto.randomBytes(24).toString('base64url')+'9a';
    await pool.execute("UPDATE user_accounts SET login_name='admin' WHERE account_id=181");
    await assert.rejects(identity.bootstrapSystemAdmin(pool,{passwordHash:hashPassword(password),authorizationBasis:'synthetic collision'}),e=>e.code==='SYSTEM_ADMIN_BOOTSTRAP_ALREADY_COMPLETED');
    await pool.execute("UPDATE user_accounts SET login_name='SYNTHETIC_admin' WHERE account_id=181");
    const originalIdentity=await snapshot(['person','user_accounts','person_roles']);
    const boot=await identity.bootstrapSystemAdmin(pool,{passwordHash:hashPassword(password),authorizationBasis:'Synthetic P25 standalone administrator authorization'});
    assert.equal(boot.personId,null);await assert.rejects(identity.bootstrapSystemAdmin(pool,{passwordHash:hashPassword(password),authorizationBasis:'repeat'}),e=>e.code==='SYSTEM_ADMIN_BOOTSTRAP_ALREADY_COMPLETED');
    const [[after]]=await pool.execute('SELECT (SELECT COUNT(*) FROM person) persons,(SELECT COUNT(*) FROM user_accounts) accounts,(SELECT COUNT(*) FROM person_roles) roles');assert.deepEqual(before,after);
    assert.equal(await snapshot(['person','user_accounts','person_roles']),originalIdentity);
    checks.push('standalone admin bootstrap without person/department; repeat refuses; old identities unchanged');
    checks.push('existing personnel admin login collision refuses bootstrap without copying credentials');
    const clients={};
    async function call(who,url,method='GET',body,csrf=true){const c=clients[who]||(clients[who]={});
      const r=await fetch(fixture.baseURL+url,{method,headers:{'Content-Type':'application/json',Cookie:c.cookie||'',...(csrf&&c.csrf?{'X-CSRF-Token':c.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(r.headers.get('set-cookie'))c.cookie=r.headers.get('set-cookie').split(';')[0];
      const raw=await r.text();if(!String(r.headers.get('content-type')).includes('json'))throw new Error(`NON_JSON_RESPONSE ${method} ${url} ${r.status}`);
      return {status:r.status,body:JSON.parse(raw)};}
    async function ex(who,url,method='GET',body,status=200,csrf=true){const r=await call(who,url,method,body,csrf);assert.equal(r.status,status,`${who} ${url}: ${JSON.stringify(r.body)}`);return r.body;}
    await ex('sys','/api/org/login','POST',{loginName:'admin',password});
    const me=await ex('sys','/api/org/me');assert.equal(me.personId,null);assert.equal(me.identityKind,'system_admin');assert.deepEqual(me.roleCodes,['admin']);
    assert(me.permissions.includes('identity:manage-account'));assert(!me.permissions.includes('governance:publish'));
    await ex('sys','/api/org/accounts','GET',undefined,403);
    clients.sys.csrf=(await ex('sys','/api/csrf-token')).csrfToken;
    const updated=crypto.randomBytes(24).toString('base64url')+'7a';
    await ex('sys','/api/org/me/password','POST',{current_password:password,new_password:updated},403,false);
    await ex('sys','/api/org/me/password','POST',{current_password:password,new_password:updated});
    await ex('sys','/api/org/me','GET',undefined,401);
    await ex('sys','/api/org/login','POST',{loginName:'admin',password:updated});clients.sys.csrf=(await ex('sys','/api/csrf-token')).csrfToken;
    assert((await ex('sys','/api/org/session')).authenticated);assert.equal((await ex('sys','/api/org/me/password-status')).is_default_password,false);
    checks.push('typed login/me/session; forced password change, CSRF and old-session invalidation');
    await ex('sys','/api/org/accounts');await ex('sys','/api/org/departments');await ex('sys','/api/rbac/model');
    const basis={roleCode:'mdm_lead',authorizationBasis:'Synthetic explicit governance role',effectiveFrom:'2026-01-01'};
    await pool.execute("INSERT INTO person(employee_no,person_name,current_department_id) VALUES ('SYSTEM_ADMIN_TEST_LEAD','合成独立治理人员',91)");
    const person=await ex('sys','/api/org/accounts','POST',{loginName:'SYSTEM_ADMIN_TEST_LEAD',employeeNo:'SYSTEM_ADMIN_TEST_LEAD',name:'合成独立治理人员',departmentId:91,roleAssignments:[basis],reason:'Synthetic admin account test'},201);
    const directoryDenied=await ex('sys','/api/org/accounts/'+person.person_id,'PATCH',{name:'合成禁止改名'},409);assert.equal(directoryDenied.code,'PERSON_DIRECTORY_MAINTENANCE_REQUIRED');
    const missingDirectory=await ex('sys','/api/org/accounts','POST',{employeeNo:'SYNTHETIC_MISSING_DIRECTORY',name:'合成不存在',departmentId:91,roleAssignments:[basis]},409);assert.equal(missingDirectory.code,'PERSON_DIRECTORY_RECORD_REQUIRED');
    const activated=await ex('sys',`/api/org/accounts/${person.person_id}/activate`,'POST',{reason:'Synthetic activation'});
    await ex('business','/api/org/login','POST',{loginName:'SYSTEM_ADMIN_TEST_LEAD',password:activated.initialPassword});clients.business.csrf=(await ex('business','/api/csrf-token')).csrfToken;
    await ex('business','/api/org/me/password','POST',{current_password:activated.initialPassword,new_password:crypto.randomBytes(24).toString('base64url')+'4a'});
    const audit=await ex('sys','/api/org/accounts/audit-events');assert(audit.some(e=>e.actor_system_account_id&&e.actor_name==='admin'&&e.target_person_id===person.person_id));
    const [[events]]=await pool.execute('SELECT COUNT(*) count FROM system_admin_events WHERE identity_event_id IS NOT NULL');assert(Number(events.count)>=3);
    await ex('sys','/api/org/accounts','POST',{loginName:'admin',employeeNo:'admin',name:'合成错误',departmentId:91,roleAssignments:[basis]},409);
    checks.push('original account APIs and explicit role/activation; true system-account actor audit; reserved login collision refused');
    await require('../server/publicationSchema').managePublicationSchema(pool,'apply');
    const publicationStatus=await ex('sys','/api/publications/status');
    assert.equal(publicationStatus.ready,true);assert.equal(publicationStatus.canPublish,false);
    assert.deepEqual((await ex('sys','/api/publications?kind=master_data')).rows,[]);
    await ex('sys','/api/publications/publish','POST',{},403);
    const governanceStatus=await ex('sys','/api/process-data-governance/status');
    assert.equal(governanceStatus.enabled,true);
    await ex('sys','/api/process-data-governance/creation-tasks/reconcile','POST',{process_version_id:77},403);
    await expect('admin','/api/publications/status','GET');
    await expect('admin','/api/process-data-governance/status','GET');
    await expect('contact','/api/publications/status','GET',undefined,403);
    await ex('anonymous','/api/publications/status','GET',undefined,401);
    await ex('anonymous','/api/process-data-governance/status','GET',undefined,401);
    checks.push('typed system-admin read access to publications and data-governance status; governance writes, unauthorized personnel and anonymous access remain denied');
    for(const [url,body] of [['/api/process-v7-preview/cases',{document:fixture.document}],['/api/process-design/drafts/1/publish',{}],['/api/data-map/contexts',{}],['/api/data-map-definitions/save',{}],['/api/analysis/runs',{}]]){
      const r=await call('sys',url,'POST',body);assert.equal(r.status,403,`${url} must refuse system administrator governance writes`);
    }
    await expect('contact','/api/process-v7-preview/cases','POST',{document:fixture.document,source_file_name:'system-admin-legacy.json'},201);
    const visible=await ex('sys','/api/process-v7-preview/cases');assert(visible.items.length);
    await expect('lead','/api/org/me','GET');await expect('admin','/api/org/accounts','GET');
    await expect('adminMulti','/api/process-v7-preview/cases','POST',{document:fixture.document},403);
    checks.push('system admin governance writes refused; original personnel admin/contact/lead paths preserved');
    const oldEnv=process.env.MDM_SYSTEM_ADMIN_ENABLED;process.env.MDM_SYSTEM_ADMIN_ENABLED='1';
    try{
      const repo=require('../server/governanceAccessMysqlRepository').makeGovernanceAccessMysqlRepository(pool);
      const identityRepo=require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool);
      const systemUser=await identity.getSystemAdmin(pool,identity.principal(boot.accountId));
      const decorated=repo.forSystemAdmin(systemUser);
      assert.equal((await identityRepo.validateSession({identityKind:'system_admin',accountId:boot.accountId,authVersion:systemUser.authVersion,personId:81})).valid,false);
      process.env.MDM_SYSTEM_ADMIN_ENABLED='0';
      assert.equal((await identityRepo.validateSession({identityKind:'system_admin',accountId:boot.accountId,authVersion:systemUser.authVersion})).valid,false);
      await assert.rejects(decorated.createAccount({loginName:'SYNTHETIC_OFF',employeeNo:'SYNTHETIC_OFF',name:'合成关闭',departmentId:91,roleAssignments:[basis],pendingPasswordHash:hashPassword(password)}),e=>e.code==='SYSTEM_ADMIN_ACTOR_CHANGED');
      process.env.MDM_SYSTEM_ADMIN_ENABLED='1';
      const markerDb=await pool.getConnection();
      try{await markerDb.beginTransaction();await markerDb.execute('DELETE FROM schema_migrations WHERE migration_key=?',[migration.MIGRATION_KEY]);await assert.rejects(identity.getSystemAdmin(markerDb,systemUser.identityRef),e=>e.code==='SYSTEM_ADMIN_SCHEMA_UNAVAILABLE'&&e.statusCode===503);}finally{await markerDb.rollback();markerDb.release();}
      checks.push('mixed person/system identity refused; disabled switch revokes system session/maintenance; missing marker returns 503');
      await pool.execute("INSERT INTO person(employee_no,person_name,current_department_id) VALUES ('SYNTHETIC_AUDIT_FAIL','合成审计失败',91)");
      const auditBefore=await snapshot(['person','user_accounts','person_roles','identity_access_events','system_admin_events']);
      await pool.query("CREATE TRIGGER synthetic_fail_system_audit BEFORE INSERT ON system_admin_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'");
      try{await assert.rejects(decorated.createAccount({loginName:'SYNTHETIC_AUDIT_FAIL',employeeNo:'SYNTHETIC_AUDIT_FAIL',name:'合成审计失败',departmentId:91,roleAssignments:[basis],pendingPasswordHash:hashPassword(password)}),e=>e.sqlState==='45000');}finally{await pool.query('DROP TRIGGER synthetic_fail_system_audit');}
      assert.equal(await snapshot(['person','user_accounts','person_roles','identity_access_events','system_admin_events']),auditBefore);
      checks.push('real system audit failure preserves the directory person and rolls back account/roles and both audit histories');
      const blocker=await pool.getConnection();let pending,settled=false;
      try{
        await blocker.beginTransaction();await blocker.execute('UPDATE system_admin_accounts SET auth_version=auth_version+1 WHERE account_id=?',[boot.accountId]);
        pending=decorated.createAccount({loginName:'SYNTHETIC_CONCURRENT',employeeNo:'SYNTHETIC_CONCURRENT',name:'合成并发撤销',departmentId:91,roleAssignments:[basis],pendingPasswordHash:hashPassword(password)});
        pending.then(()=>{settled=true;},()=>{settled=true;});
        await new Promise(resolve=>setTimeout(resolve,100));assert.equal(settled,false,'maintenance waits for concurrent actor revocation lock');
        await blocker.commit();await assert.rejects(pending,e=>e.code==='SYSTEM_ADMIN_ACTOR_CHANGED');
      }finally{await blocker.rollback();blocker.release();if(pending)await pending.catch(()=>{});}
      const [[absent]]=await pool.execute("SELECT COUNT(*) count FROM person WHERE employee_no IN ('SYNTHETIC_OFF','SYNTHETIC_CONCURRENT')");assert.equal(Number(absent.count),0);
      const [[auditPerson]]=await pool.execute("SELECT p.person_id,ua.account_id FROM person p LEFT JOIN user_accounts ua ON ua.person_id=p.person_id WHERE p.employee_no='SYNTHETIC_AUDIT_FAIL'");assert(auditPerson.person_id);assert.equal(auditPerson.account_id,null);
      checks.push('concurrent revocation holds actor lock; queued account maintenance rechecks new version and leaves no partial write');
      await pool.execute('UPDATE system_admin_accounts SET auth_version=auth_version+1 WHERE account_id=?',[boot.accountId]);
      await assert.rejects(decorated.createAccount({loginName:'SYNTHETIC_STALE',employeeNo:'SYNTHETIC_STALE',name:'合成过期',departmentId:91,roleAssignments:[basis],pendingPasswordHash:hashPassword(password)}),e=>e.code==='SYSTEM_ADMIN_ACTOR_CHANGED');
      const [[missing]]=await pool.execute("SELECT COUNT(*) count FROM person WHERE employee_no='SYNTHETIC_STALE'");assert.equal(Number(missing.count),0);
    }finally{if(oldEnv===undefined)delete process.env.MDM_SYSTEM_ADMIN_ENABLED;else process.env.MDM_SYSTEM_ADMIN_ENABLED=oldEnv;}
    await ex('sys','/api/org/accounts','GET',undefined,401);
    await pool.execute("UPDATE system_admin_accounts SET account_status='disabled' WHERE account_id=?",[boot.accountId]);
    await ex('sys','/api/org/login','POST',{loginName:'admin',password:updated},401);
    await pool.execute("UPDATE system_admin_accounts SET account_status='active' WHERE account_id=?",[boot.accountId]);
    checks.push('current account version rechecked inside maintenance transaction; stale writes rollback; disabled login refused');
    const originalRestored=await snapshot(['person','user_accounts','person_roles','system_admin_accounts','system_admin_events']);
    const dump=backup();await restore(dump);
    assert.equal(await snapshot(['person','user_accounts','person_roles','system_admin_accounts','system_admin_events']),originalRestored);
    const [[restored]]=await pool.execute('SELECT COUNT(*) count FROM system_admin_accounts');assert.equal(Number(restored.count),1);
    const [[auditRestored]]=await pool.execute('SELECT COUNT(*) count FROM system_admin_events');assert(Number(auditRestored.count)>=4);
    checks.push('owned full-database backup/restore keeps separate administrator and actor audit');
    fs.writeFileSync(path.join(output,'backend-results.json'),JSON.stringify({passed:true,checks:[...checks],scope:'owned-mysql-http',formal_operation:false,credentials_stored:false},null,2));
    await require('./testHelpers/systemAdminBrowser')({pool,fixture,boot,updated,checks,output});
  },{evidenceDir:output,systemAdmin:true,beforeStart:async({pool})=>require('./testHelpers/prepareReviewFoundation')(pool),departmentAccountability:true,completeSource:true,processDataGovernanceVersionId:77,randomDatabase:true,createDocument:()=>({
    schema_version:'process-governance-v7',
    export_meta:{package_ref:'package_synthetic_admin',exported_at:new Date().toISOString(),initiating_department:'',compiler:''},
    process:{process_ref:'process_synthetic_admin',process_name:'',owning_department:'',purpose:'',scope:'',capability_domain:null,business_capability:null,classification_status:'unclassified'},
    behaviors:[],flow_relations:[],data_objects:[],forms:[],terms:[],
    migration:{source_schema_version:'process-governance-v7',source_process_ref:null,source_process_count:1,legacy_cross_department_records:[],reference_materials:[],internal_process_calls:[],work_roles:[],unresolved_actor_roles:[],unresolved_join_modes:[]}
  })});
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,formal_operation:false,credentials_stored:false},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}
main().catch(e=>{fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({passed:false,code:e.code||'ASSERTION_FAILED',message:String(e.message).slice(0,1500),inspection:e.inspection||null},null,2));console.error(e);process.exitCode=1;});
