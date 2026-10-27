// Synthetic fixtures only, in an owned disposable MySQL and loopback HTTP app.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {makeIdentityMysqlRepository}=require('../server/identityMysqlRepository');
const {makeGovernanceAccessMysqlRepository}=require('../server/governanceAccessMysqlRepository');
const {applyDepartmentAccountabilityPolicy}=require('../server/departmentAccountabilityMigration');
const {inspectDepartmentAccountability}=require('../server/departmentAccountability');
const {ACCESS_MODEL_VERSION}=require('../server/roleDefinitions');
const checks=[];let server,auth,accounts;
const outputArg=process.argv.indexOf('--output'),output=outputArg>=0?path.resolve(process.argv[outputArg+1]):null;
if(output){assert([path.resolve(__dirname,'../../../artifacts'),path.resolve(process.cwd(),'artifacts')].some(root=>output.startsWith(root+path.sep)));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});}
const save=(name,value)=>{if(output)fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});};
const check=async(name,work)=>{await work();checks.push(name);console.log('PASS '+name);};
const scalar=async(db,sql,params=[])=>{const [rows]=await db.execute(sql,params);return rows[0];};
async function waitForDepartmentLock(pool,database){
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){const row=await scalar(pool,`SELECT COUNT(*) n FROM performance_schema.data_lock_waits w
    JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='departments'`,[database]);
    if(Number(row.n)>0)return;await new Promise(resolve=>setTimeout(resolve,20));}
  throw Error('DEPARTMENT_LOCK_WAIT_NOT_OBSERVED');
}
async function main(){
  process.env.MDM_IDENTITY_READ_MODEL='mysql';process.env.MDM_SYSTEM_ADMIN_ENABLED='0';
  await withFreshMysql(async({pool,owner,database,containerId,port,password})=>{
    save('owned-target.json',{owner,database,containerId,port});const identity=makeIdentityMysqlRepository(pool);await identity.initSchema();
    const dates=await scalar(pool,"SELECT DATE_FORMAT(CURRENT_DATE,'%Y-%m-%d') today,DATE_FORMAT(CURRENT_DATE+INTERVAL 1 DAY,'%Y-%m-%d') tomorrow,DATE_FORMAT(CURRENT_DATE-INTERVAL 1 DAY,'%Y-%m-%d') yesterday");
    const BIG='9007199254741201',BIGD='9007199254741301';
    for(const id of [90,91,92,93,94,95,BIGD])await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)',[String(id),'SYN_D'+id,'Synthetic Department '+id]);
    const seed=async(id,department,account=true)=>{
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)',[String(id),'SYN_P'+id,'Synthetic Person '+id,String(department)]);
      if(account)await pool.execute("INSERT INTO user_accounts(person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,?,'synthetic-unusable','active',0)",[String(id),'SYN_P'+id]);
    };
    for(const [id,department,account]of [[80,90,true],[81,90,true],[101,91,true],[102,91,true],[103,91,true],[104,91,true],[201,92,false],[301,93,true],[302,93,true],[401,94,true],[402,94,true],[501,95,true],[502,95,true],[BIG,BIGD,true]])await seed(id,department,account);
    const rawGrant=async(id,code,department=null)=>pool.execute(`INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from)
      SELECT ?,role_id,?,?,?,? FROM roles WHERE role_code=?`,[String(id),department===null?'global':'department',department===null?null:String(department),'original synthetic basis',dates.yesterday,code]);
    await rawGrant(80,'admin');await rawGrant(81,'department_contact',90);
    const repo=makeGovernanceAccessMysqlRepository(pool),input=(department,expected=null,extra={})=>({roleCode:'department_mdm_reviewer',scopeDepartmentId:String(department),authorizationBasis:'synthetic appointment',effectiveFrom:dates.today,expectedFinalResponsiblePersonId:expected,...extra});
    const physical=async()=>{
      const state={};for(const table of ['departments','person_roles','user_accounts','identity_access_events']){
        state[table]=(await pool.execute('SELECT * FROM '+table+' ORDER BY 1'))[0].map(row=>{const value={...row};if(value.password_hash){value.credentialDigest=crypto.createHash('sha256').update(value.password_hash).digest('hex');delete value.password_hash;}return value;});}
      return state;
    };
    const unchangedReject=async(action,code)=>{const before=await physical();await assert.rejects(action,{code});assert.deepEqual(await physical(),before);};
    await check('missing/invalid snapshots and unprepared policy fail without partial writes',async()=>{
      const missing=input(91);delete missing.expectedFinalResponsiblePersonId;
      await unchangedReject(()=>repo.grantRole(101,missing),'DEPARTMENT_HEAD_SNAPSHOT_REQUIRED');
      await unchangedReject(()=>repo.grantRole(101,input(91,'invalid')),'DEPARTMENT_HEAD_SNAPSHOT_INVALID');
      await unchangedReject(()=>repo.grantRole(101,input(91)),'DEPARTMENT_ACCOUNTABILITY_POLICY_REQUIRED');
    });
    const setup=await pool.getConnection();try{await applyDepartmentAccountabilityPolicy(setup);}finally{setup.release();}
    const modelBefore=(await pool.execute('SELECT role_code,model_version FROM roles ORDER BY role_code'))[0];assert(modelBefore.every(role=>role.model_version===ACCESS_MODEL_VERSION));
    const session=async id=>{const row=await scalar(pool,'SELECT CAST(account_id AS CHAR) account_id,CAST(auth_version AS CHAR) auth_version FROM user_accounts WHERE person_id=CAST(? AS SIGNED)',[String(id)]);return{personId:id,accountId:row.account_id,authVersion:row.auth_version};};
    auth=require('../server/auth');accounts=require('../server/routes/accounts');auth.setIdentityRepositoryFactory(()=>identity);accounts.setRepositoryFactory(()=>repo);
    const express=require('express'),security=require('../server/security'),app=express();app.use(express.json());
    app.use(async(req,res,next)=>{try{const id=req.headers['x-synthetic-person'];req.session=id?{...await session(id),csrfSecret:'synthetic-csrf'}:{};req.session.destroy=done=>done();next();}catch(error){next(error);}});
    app.use(security.csrfProtection);app.use('/api/org/accounts',accounts);
    server=await new Promise(resolve=>{const owned=app.listen(0,'127.0.0.1',()=>resolve(owned));});save('owned-http.json',{owner,host:'127.0.0.1',port:server.address().port});
    const call=async(id,url,method='GET',body)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/org/accounts'+url,{method,headers:{'content-type':'application/json','x-synthetic-person':String(id),'X-CSRF-Token':'synthetic-csrf'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};};
    await check('HTTP authority and exact read context remain bounded to account maintenance',async()=>{
      const before=await physical();const denied=await call(81,'/101/role-assignments','POST',input(91));assert.equal(denied.status,403);assert.deepEqual(await physical(),before);
      const one=await call(80,'/'+BIG);assert.equal(one.status,200);assert.equal(one.body.person_id,BIG);assert.equal(one.body.current_department_id,BIGD);assert.equal(one.body.department_final_responsible_person_id,null);assert.equal(one.body.server_current_date,dates.today);
      const all=await call(80,'');assert.equal(all.status,200);assert(all.body.every(row=>Object.hasOwn(row,'department_final_responsible_person_id')&&row.server_current_date===dates.today));
    });
    await check('dedicated HTTP grant registers the same department in the audited transaction',async()=>{
      const result=await call(80,'/101/role-assignments','POST',input(91));assert.equal(result.status,201);assert.equal(result.body.departmentAppointment.finalResponsiblePersonId,'101');assert.equal(result.body.departmentAppointment.changed,true);
      const account=await repo.getAccount(101);assert.equal(account.department_final_responsible_person_id,101);assert.equal(account.department_final_responsible_person_name,'Synthetic Person 101');
      assert.equal((await inspectDepartmentAccountability(pool,await session(101),91)).eligible,true);
      const audit=await scalar(pool,"SELECT payload_json FROM identity_access_events WHERE target_person_id=101 AND event_type='role_assigned' ORDER BY event_id DESC LIMIT 1");
      assert.equal(audit.payload_json.departmentAppointment.previousFinalResponsiblePersonId,null);
    });
    await check('replacement requires current snapshot and explicit boolean confirmation, preserving old grants',async()=>{
      const oldGrant=(await pool.execute('SELECT * FROM person_roles WHERE person_id=101'))[0];const oldSession=await session(101);
      for(const confirmation of [undefined,false,'true'])await unchangedReject(()=>repo.grantRole(102,input(91,'101',{confirmReplaceFinalResponsiblePerson:confirmation})),'DEPARTMENT_HEAD_REPLACEMENT_CONFIRMATION_REQUIRED');
      const result=await call(80,'/102/role-assignments','POST',input(91,'101',{confirmReplaceFinalResponsiblePerson:true}));assert.equal(result.status,201);
      assert.deepEqual((await pool.execute('SELECT * FROM person_roles WHERE person_id=101'))[0],oldGrant);assert.equal(BigInt((await session(101)).authVersion),BigInt(oldSession.authVersion)+1n);
      assert.equal((await identity.validateSession(oldSession)).valid,false);assert.equal((await inspectDepartmentAccountability(pool,await session(101),91)).eligible,false);assert.equal((await inspectDepartmentAccountability(pool,await session(102),91)).eligible,true);
      await unchangedReject(()=>repo.grantRole(103,input(91,'101',{confirmReplaceFinalResponsiblePerson:true})),'DEPARTMENT_FINAL_RESPONSIBLE_CHANGED');
    });
    await check('existing effective grant fills registration without rewriting dates basis or audit history',async()=>{
      await rawGrant(103,'department_mdm_reviewer',91);const before=(await pool.execute('SELECT * FROM person_roles WHERE person_id=103'))[0];
      const result=await repo.grantRole(103,input(91,'102',{confirmReplaceFinalResponsiblePerson:true,authorizationBasis:'new request must not overwrite original',effectiveFrom:dates.today,effectiveTo:dates.tomorrow}));
      assert.equal(result.departmentAppointment.existingGrantPreserved,true);assert.deepEqual((await pool.execute('SELECT * FROM person_roles WHERE person_id=103'))[0],before);
      assert.equal((await scalar(pool,"SELECT COUNT(*) n FROM identity_access_events WHERE event_type='role_assigned' AND target_person_id=101")).n,1);
    });
    await check('future expired cross-department inactive-person and inactive-department appointments reject atomically',async()=>{
      for(const period of [{effectiveFrom:dates.tomorrow},{effectiveFrom:dates.yesterday,effectiveTo:dates.yesterday}])await unchangedReject(()=>repo.grantRole(104,input(91,'103',{...period,confirmReplaceFinalResponsiblePerson:true})),'DEPARTMENT_HEAD_CURRENT_APPOINTMENT_REQUIRED');
      await unchangedReject(()=>repo.grantRole(104,input(92)),'ROLE_SCOPE_DEPARTMENT_MISMATCH');
      await pool.execute("UPDATE person SET employment_status='inactive' WHERE person_id=104");await unchangedReject(()=>repo.grantRole(104,input(91,'103',{confirmReplaceFinalResponsiblePerson:true})),'PERSON_INACTIVE');await pool.execute("UPDATE person SET employment_status='active' WHERE person_id=104");
      await pool.execute("UPDATE departments SET status='inactive' WHERE id=91");await unchangedReject(()=>repo.grantRole(104,input(91,'103',{confirmReplaceFinalResponsiblePerson:true})),'ACTIVE_DEPARTMENT_REQUIRED');await pool.execute("UPDATE departments SET status='active' WHERE id=91");
    });
    await check('legacy batch create/update head assignment requires the dedicated entry and cannot partially create an account',async()=>{
      const creation={loginName:'SYN_P201',employeeNo:'SYN_P201',name:'Synthetic Person 201',departmentId:92,pendingPasswordHash:'synthetic-pending',roleAssignments:[input(92)]};
      await unchangedReject(()=>repo.createAccount(creation),'DEPARTMENT_HEAD_DEDICATED_GRANT_REQUIRED');
      await unchangedReject(()=>repo.updateAccount(104,{roleAssignments:[input(91,'103')]}),'DEPARTMENT_HEAD_DEDICATED_GRANT_REQUIRED');
      const http=await call(80,'','POST',creation);assert.equal(http.status,422);assert.equal(http.body.code,'DEPARTMENT_HEAD_DEDICATED_GRANT_REQUIRED');
    });
    await check('a valid person without an account can be appointed without automatic account creation or confirmation authority',async()=>{
      const result=await call(80,'/201/role-assignments','POST',input(92));assert.equal(result.status,201);assert.equal(result.body.departmentAppointment.finalResponsiblePersonId,'201');
      assert.equal((await scalar(pool,'SELECT COUNT(*) n FROM user_accounts WHERE person_id=201')).n,0);
      assert.equal((await scalar(pool,'SELECT final_responsible_person_id FROM departments WHERE id=92')).final_responsible_person_id,201);
      assert.equal((await inspectDepartmentAccountability(pool,{personId:201,accountId:null,authVersion:null},92)).eligible,false);
    });
    await check('audit failure rolls back grant registration and both account versions together',async()=>{
      const failingPool={async getConnection(){const connection=await pool.getConnection();return new Proxy(connection,{get(db,key){if(key==='execute')return async(sql,params)=>{if(/INSERT INTO identity_access_events/.test(sql))throw Object.assign(Error('Synthetic audit failure'),{code:'SYNTHETIC_AUDIT_FAILURE'});return db.execute(sql,params);};return typeof db[key]==='function'?db[key].bind(db):db[key];}});}};
      const failing=makeGovernanceAccessMysqlRepository(failingPool);
      await unchangedReject(()=>failing.grantRole(104,input(91,'103',{confirmReplaceFinalResponsiblePerson:true})),'SYNTHETIC_AUDIT_FAILURE');
      await unchangedReject(()=>failing.grantRole(102,input(91,'103',{confirmReplaceFinalResponsiblePerson:true})),'SYNTHETIC_AUDIT_FAILURE');
    });
    await check('real concurrent registrations with one snapshot permit only one winner',async()=>{
      const results=await Promise.allSettled([repo.grantRole(301,input(93)),repo.grantRole(302,input(93))]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'DEPARTMENT_FINAL_RESPONSIBLE_CHANGED');
      assert.equal((await scalar(pool,'SELECT COUNT(*) n FROM person_roles WHERE person_id IN (301,302)')).n,1);
    });
    await check('department locking read observes a committed change and rejects the stale snapshot',async()=>{
      const blocker=await pool.getConnection();await blocker.beginTransaction();await blocker.execute('SELECT id FROM departments WHERE id=94 FOR UPDATE');
      const pending=repo.grantRole(401,input(94));pending.catch(()=>{});
      try{await waitForDepartmentLock(pool,database);await blocker.execute('UPDATE departments SET final_responsible_person_id=402 WHERE id=94');await blocker.commit();}
      finally{await blocker.rollback();blocker.release();}
      await assert.rejects(pending,{code:'DEPARTMENT_FINAL_RESPONSIBLE_CHANGED'});assert.equal((await scalar(pool,'SELECT COUNT(*) n FROM person_roles WHERE person_id=401')).n,0);
    });
    await check('exact large identities survive registration and only the selected department changes',async()=>{
      const result=await repo.grantRole(BIG,input(BIGD));assert.equal(String(result.scopeDepartmentId),BIGD);assert.equal(result.departmentAppointment.finalResponsiblePersonId,BIG);
      const account=await repo.getAccount(BIG);assert.equal(account.department_final_responsible_person_id,BIG);assert.equal(account.current_department_id,BIGD);
    });
    await check('revocation removes the role without inventing a personnel dismissal',async()=>{
      const grant=(await repo.getAccount(103)).roleAssignments.find(role=>role.roleCode==='department_mdm_reviewer');
      await repo.revokeRole(103,grant.assignmentId,{reason:'synthetic revocation',disableAccount:true});
      assert.equal((await scalar(pool,'SELECT final_responsible_person_id FROM departments WHERE id=91')).final_responsible_person_id,103);
      assert.equal((await inspectDepartmentAccountability(pool,await session(103),91)).eligible,false);
    });
    await check('admin combination keeps its existing governance read-only gate and role model remains unchanged',async()=>{
      await rawGrant(501,'admin');await repo.grantRole(501,input(95));assert.equal((await inspectDepartmentAccountability(pool,await session(501),95)).reason,'DEPARTMENT_ACCOUNTABILITY_ADMIN_READ_ONLY');
      assert.deepEqual((await pool.execute('SELECT role_code,model_version FROM roles ORDER BY role_code'))[0],modelBefore);
    });
    await check('runtime principal needs only the final-responsible column update and cannot edit other department fields',async()=>{
      await pool.query("CREATE USER 'synthetic_head_app'@'%' IDENTIFIED BY ?",[password]);
      await pool.query('GRANT SELECT ON '+database+".* TO 'synthetic_head_app'@'%'");
      for(const table of ['person','person_roles','user_accounts'])await pool.query('GRANT INSERT,UPDATE ON '+database+'.'+table+" TO 'synthetic_head_app'@'%'");
      await pool.query('GRANT INSERT ON '+database+".identity_access_events TO 'synthetic_head_app'@'%'");
      await pool.query('GRANT UPDATE(final_responsible_person_id) ON '+database+".departments TO 'synthetic_head_app'@'%'");
      const limited=require('mysql2/promise').createPool({host:'127.0.0.1',port,user:'synthetic_head_app',password,database,connectionLimit:2});
      try{
        const current=await session(80),restricted=makeGovernanceAccessMysqlRepository(limited).forPersonMaintenance({kind:'person',...current,method:'POST',body:{roleCode:true,expectedFinalResponsiblePersonId:true,confirmReplaceFinalResponsiblePerson:true}});
        const before=await scalar(pool,'SELECT name,updated_by FROM departments WHERE id=95');
        const result=await restricted.grantRole(502,{...input(95,'501',{confirmReplaceFinalResponsiblePerson:true}),actorPersonId:80});assert.equal(result.departmentAppointment.finalResponsiblePersonId,'502');
        assert.deepEqual(await scalar(pool,'SELECT name,updated_by FROM departments WHERE id=95'),before);
        await assert.rejects(limited.execute("UPDATE departments SET name='forbidden' WHERE id=95"),{code:'ER_COLUMNACCESS_DENIED_ERROR'});
        await assert.rejects(limited.execute('UPDATE departments SET updated_by=80 WHERE id=95'),{code:'ER_COLUMNACCESS_DENIED_ERROR'});
      }finally{await limited.end();}
    });
    if(ACCESS_MODEL_VERSION==='rbac-raci-v4-2026-10-19')await check('live v4 explicit empty transfer plan preserves history and allows later dedicated head registration without inventing another role',async()=>{
      const current=await scalar(pool,'SELECT final_responsible_person_id FROM departments WHERE id=93'),personId=current.final_responsible_person_id;
      await unchangedReject(()=>repo.updateAccount(personId,{departmentId:94,changeReason:'synthetic transfer'}),'DEPARTMENT_ROLE_REPLACEMENT_REQUIRED');
      await unchangedReject(()=>repo.updateAccount(personId,{departmentId:94,changeReason:'synthetic transfer',roleAssignments:[{roleCode:'mdm_lead',effectiveFrom:dates.today}]}),'DEPARTMENT_ROLE_REPLACEMENT_REQUIRED');
      const beforeVersion=(await session(personId)).authVersion;
      await repo.updateAccount(personId,{departmentId:94,changeReason:'synthetic transfer with explicit no new department role',roleAssignments:[]});
      const moved=await repo.getAccount(personId);assert.equal(moved.current_department_id,94);assert.equal(moved.roleAssignments.filter(role=>role.status==='active').length,0);assert.equal(moved.account_status,'active');
      assert.equal((await scalar(pool,'SELECT final_responsible_person_id FROM departments WHERE id=93')).final_responsible_person_id,personId);
      assert.equal(BigInt((await session(personId)).authVersion),BigInt(beforeVersion)+1n);
      assert.equal((await inspectDepartmentAccountability(pool,await session(personId),93)).eligible,false);
      const history=(await pool.execute("SELECT * FROM identity_access_events WHERE target_person_id=? AND event_type='role_revoked'",[personId]))[0];assert.equal(history.length,1);
      const result=await repo.grantRole(personId,input(94,'402',{confirmReplaceFinalResponsiblePerson:true}));assert.equal(result.departmentAppointment.finalResponsiblePersonId,String(personId));
      assert.equal((await inspectDepartmentAccountability(pool,await session(personId),93)).eligible,false);assert.equal((await inspectDepartmentAccountability(pool,await session(personId),94)).eligible,true);
      assert.deepEqual((await pool.execute("SELECT * FROM identity_access_events WHERE target_person_id=? AND event_type='role_revoked'",[personId]))[0],history);
      const audit=await scalar(pool,"SELECT payload_json FROM identity_access_events WHERE target_person_id=? AND event_type='role_assigned' ORDER BY event_id DESC LIMIT 1",[personId]);assert.equal(audit.payload_json.previousRoleAssignment.scope_department_id,'93');assert.equal(audit.payload_json.previousRoleAssignment.assignment_status,'revoked');
    });
    await new Promise(resolve=>server.close(resolve));server=null;auth.resetIdentityRepositoryFactory();accounts.resetRepositoryFactory();
    save('results.json',{passed:true,modelVersion:ACCESS_MODEL_VERSION,checks,ownedTarget:{owner,database,containerId,port},formalDatabaseTouched:false});
  },{stage:'27',randomDatabase:true});
}
main().catch(error=>{console.error(JSON.stringify({passed:false,code:error.code||'DEPARTMENT_HEAD_TEST_FAILED',detail:error.message.split('\n')[0]}));process.exitCode=1;}).finally(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(auth)auth.resetIdentityRepositoryFactory();if(accounts)accounts.resetRepositoryFactory();});
