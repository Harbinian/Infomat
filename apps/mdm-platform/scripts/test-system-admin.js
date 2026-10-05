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
    const snapshot=async tables=>JSON.stringify(await Promise.all(tables.map(async table=>(await pool.query('SELECT * FROM '+table+' ORDER BY 1'))[0])));
    const originalIdentity=await snapshot(['person','user_accounts','person_roles']);
    const password=crypto.randomBytes(24).toString('base64url')+'9a';
    const boot=await identity.bootstrapSystemAdmin(pool,{passwordHash:hashPassword(password),authorizationBasis:'Synthetic P25 standalone administrator authorization'});
    assert.equal(boot.personId,null);await assert.rejects(identity.bootstrapSystemAdmin(pool,{passwordHash:hashPassword(password),authorizationBasis:'repeat'}),e=>e.code==='SYSTEM_ADMIN_BOOTSTRAP_ALREADY_COMPLETED');
    const [[after]]=await pool.execute('SELECT (SELECT COUNT(*) FROM person) persons,(SELECT COUNT(*) FROM user_accounts) accounts,(SELECT COUNT(*) FROM person_roles) roles');assert.deepEqual(before,after);
    assert.equal(await snapshot(['person','user_accounts','person_roles']),originalIdentity);
    checks.push('standalone admin bootstrap without person/department; repeat refuses; old identities unchanged');
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
    const person=await ex('sys','/api/org/accounts','POST',{loginName:'SYSTEM_ADMIN_TEST_LEAD',employeeNo:'SYSTEM_ADMIN_TEST_LEAD',name:'合成独立治理人员',departmentId:91,roleAssignments:[basis],reason:'Synthetic admin account test'},201);
    const activated=await ex('sys',`/api/org/accounts/${person.person_id}/activate`,'POST',{reason:'Synthetic activation'});
    await ex('business','/api/org/login','POST',{loginName:'SYSTEM_ADMIN_TEST_LEAD',password:activated.initialPassword});clients.business.csrf=(await ex('business','/api/csrf-token')).csrfToken;
    await ex('business','/api/org/me/password','POST',{current_password:activated.initialPassword,new_password:crypto.randomBytes(24).toString('base64url')+'4a'});
    const audit=await ex('sys','/api/org/accounts/audit-events');assert(audit.some(e=>e.actor_system_account_id&&e.actor_name==='admin'&&e.target_person_id===person.person_id));
    const [[events]]=await pool.execute('SELECT COUNT(*) count FROM system_admin_events WHERE identity_event_id IS NOT NULL');assert(Number(events.count)>=3);
    await ex('sys','/api/org/accounts','POST',{loginName:'admin',employeeNo:'SYNTHETIC_BAD',name:'合成错误',departmentId:91,roleAssignments:[basis]},409);
    checks.push('original account APIs and explicit role/activation; true system-account actor audit; reserved login collision refused');
    for(const [url,body] of [['/api/process-v7-preview/cases',{document:fixture.document}],['/api/process-design/drafts/1/publish',{}],['/api/data-map/contexts',{}],['/api/data-map-definitions/save',{}],['/api/analysis/runs',{}]]){
      const r=await call('sys',url,'POST',body);assert.equal(r.status,403,`${url} must refuse system administrator governance writes`);
    }
    await expect('contact','/api/process-v7-preview/cases','POST',{document:fixture.document,source_file_name:'system-admin-legacy.json'},201);
    const visible=await ex('sys','/api/process-v7-preview/cases');assert(visible.items.length);
    await expect('lead','/api/org/me','GET');await expect('admin','/api/org/accounts','GET');
    checks.push('system admin governance writes refused; original personnel admin/contact/lead paths preserved');
    const oldEnv=process.env.MDM_SYSTEM_ADMIN_ENABLED;process.env.MDM_SYSTEM_ADMIN_ENABLED='1';
    try{
      const systemUser=await identity.getSystemAdmin(pool,identity.principal(boot.accountId));
      const decorated=require('../server/governanceAccessMysqlRepository').makeGovernanceAccessMysqlRepository(pool).forSystemAdmin(systemUser);
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
    let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}
    const browser=await playwright.chromium.launch({channel:'msedge',headless:true});
    try{
      const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});const page=await context.newPage();
      await page.goto(fixture.baseURL+'/app/');await page.getByLabel('工号或登录名').fill('admin');await page.getByLabel('密码',{exact:true}).fill(updated);
      await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('link',{name:'账号与授权办理',exact:true}).first().click();
      await page.locator('[data-accounts-ready="true"]').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(output,'system-admin-accounts.png'),fullPage:true});
      await page.getByRole('button',{name:'手工创建账号',exact:true}).click();
      await page.getByLabel('登录名',{exact:true}).fill('SYNTHETIC_UNSAVED_ADMIN_INPUT');
      page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'退出登录',exact:true}).click();
      assert.equal(await page.getByLabel('登录名',{exact:true}).inputValue(),'SYNTHETIC_UNSAVED_ADMIN_INPUT');
      page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'取消本次办理',exact:true}).click();
      await page.getByRole('link',{name:'当前身份',exact:true}).click();
      await page.getByText('系统维护身份，不关联员工',{exact:true}).waitFor();
      await page.screenshot({path:path.join(output,'system-admin-identity.png'),fullPage:true});
      await page.getByRole('button',{name:'退出登录',exact:true}).click();
      await page.getByLabel('工号或登录名').fill('SYNTHETIC_lead');await page.getByLabel('密码',{exact:true}).fill(fixture.loginPassword);
      await page.getByRole('button',{name:'登录',exact:true}).click();
      await page.waitForFunction(()=>!document.body.textContent.includes('系统维护身份，不关联员工')&&document.body.textContent.includes('合成lead'));
      await context.close();
    }finally{await browser.close();}
    checks.push('Edge 100% desktop 1699x828 standalone identity/accounts, no horizontal overflow, cancel-logout input protection and switch to personnel identity');
  },{evidenceDir:output,systemAdmin:true,createDocument:()=>({
    schema_version:'process-governance-v7',
    export_meta:{package_ref:'package_synthetic_admin',exported_at:new Date().toISOString(),initiating_department:'',compiler:''},
    process:{process_ref:'process_synthetic_admin',process_name:'',owning_department:'',purpose:'',scope:'',capability_domain:null,business_capability:null,classification_status:'unclassified'},
    behaviors:[],flow_relations:[],data_objects:[],forms:[],terms:[],
    migration:{source_schema_version:'process-governance-v7',source_process_ref:null,source_process_count:1,legacy_cross_department_records:[],reference_materials:[],internal_process_calls:[],work_roles:[],unresolved_actor_roles:[],unresolved_join_modes:[]}
  })});
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,formal_operation:false,credentials_stored:false},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}
main().catch(e=>{fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({passed:false,code:e.code||'ASSERTION_FAILED',message:String(e.message).slice(0,1500),inspection:e.inspection||null},null,2));console.error(e);process.exitCode=1;});
