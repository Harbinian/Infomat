// B02 owned MySQL validation. --output requires a new repository artifacts directory.
// Uses only freshMysql's labelled tmpfs/UUID container. Synthetic rows, no env file,
// formal DB, HTTP service, worker, AI or notification. Finally removes owned resources.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {makeIdentityMysqlRepository,readPersonAuthority}=require('../server/identityMysqlRepository');
const {makeDataMapDefinitionRepository}=require('../server/dataMapDefinitionRepository');
const {makeOfficeRepository}=require('../server/officeRepository');
const index=process.argv.indexOf('--output'),output=index<0?null:path.resolve(process.argv[index+1]||'');
assert(output&&output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output));
fs.mkdirSync(output,{recursive:true});
const checks=[],save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const P='9007199254740993',A='9007199254740995',V='9007199254740997';
async function waitForLock(pool,pending,trace){
  let settled;pending.then(result=>{settled=result;});
  const deadline=Date.now()+10000;
  do {const lock=trace.findLast(item=>item.accountLock&&!item.finished);
    if(lock){const [[row]]=await pool.query('SELECT COMMAND,STATE FROM information_schema.PROCESSLIST WHERE ID=?',[lock.connectionId]);
      if(row&&row.COMMAND==='Execute'){
        // MySQL may wait while estimating statistics, before creating INNODB_TRX.
        // Prove the actual protected statement remains unresolved behind the
        // caller's asserted row lock; release only after changing qualifications.
        const result=await Promise.race([pending.then(()=> 'finished'),new Promise(resolve=>setTimeout(()=>resolve('pending'),150))]);
        if(result==='pending'){save('observed-lock-'+lock.connectionId+'.json',{connectionId:lock.connectionId,state:row.STATE,command:row.COMMAND,heldAccountRowLock:true,protectedStatementPendingBeforeRelease:true});return;}
      }}
    if(settled)throw Error('OWNED_WRITE_FINISHED_BEFORE_LOCK_WAIT:'+String(settled.error?.code||settled.error?.message||'allowed'));
    await new Promise(resolve=>setTimeout(resolve,30));}while(Date.now()<deadline);
  throw Error('OWNED_LOCK_WAIT_NOT_OBSERVED');
}
async function main(){
  const previous=process.env.MDM_SYSTEM_ADMIN_ENABLED;process.env.MDM_SYSTEM_ADMIN_ENABLED='1';let target,cleaned=false;
  try {await withFreshMysql(async({pool,owner,database,containerId,port})=>{
    target={owner,database,containerId,port};save('owned-target.json',target);
    const identity=makeIdentityMysqlRepository(pool);await identity.initSchema();
    const db=await pool.getConnection();try {
      await require('../server/dataMapDefinitionMigration').applyDefinitions(db);
      await require('../server/officeSchema').manageOfficeSchema(db,'apply');
      await require('../server/systemAdminMigration').applySystemAdmin(db);
    } finally {db.release();}
    for(const id of [91,92])await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)',[id,'B02_'+id,'B02 synthetic '+id]);
    const people=[{personId:P,accountId:A,authVersion:V,departmentId:91,roles:['department_contact']},
      {personId:12,accountId:112,authVersion:1,departmentId:91,roles:['mdm_lead']},
      {personId:13,accountId:113,authVersion:1,departmentId:91,roles:['admin']},
      {personId:14,accountId:114,authVersion:1,departmentId:91,roles:['admin','department_contact','mdm_lead']},
      {personId:15,accountId:115,authVersion:1,departmentId:91,roles:[]},
      {personId:16,accountId:116,authVersion:1,departmentId:92,roles:['department_contact']}];
    for(const person of people){
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)',[person.personId,'B02_'+person.personId,'B02 synthetic',person.departmentId]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (?,?,?,'synthetic-not-used','active',0,?)",[person.accountId,person.personId,'B02_'+person.personId,person.authVersion]);
      for(const role of person.roles)await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?, 'B02 owned synthetic',CURRENT_DATE FROM roles WHERE role_code=?",[person.personId,['admin','mdm_lead'].includes(role)?'global':'department',['admin','mdm_lead'].includes(role)?null:person.departmentId,role]);
    }
    await pool.execute("INSERT INTO org_unit(org_unit_id,org_unit_code,org_unit_name,org_type,department_id,manager_person_id) VALUES (31,'B02_OFFICE','B02 synthetic office','office',91,12)");
    const session=p=>({personId:p.personId,accountId:p.accountId,authVersion:p.authVersion});
    const contact=session(people[0]),lead=session(people[1]),admin=session(people[2]),overlay=session(people[3]),none=session(people[4]),other=session(people[5]);
    const trace=[];
    const observedPool={async getConnection(){const connection=await pool.getConnection();return new Proxy(connection,{get(target,key){
      if(key==='execute')return async(sql,params=[])=>{const entry={connectionId:connection.connection.threadId,accountLock:/user_accounts.*FOR UPDATE/s.test(sql),personLock:/FROM person WHERE.*FOR UPDATE/s.test(sql),finished:false};trace.push(entry);try{return await connection.execute(sql,params);}finally{entry.finished=true;}};
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});}};
    const definitions=makeDataMapDefinitionRepository(observedPool),offices=makeOfficeRepository(observedPool);
    const saveDefinition=(actor,dept=91)=>definitions.saveDefinition(actor,{entity_type:'object',department_id:dept,request_id:crypto.randomUUID(),definition:{name:'B02 synthetic object'}});
    const officeTask=actor=>offices.createTask(actor,{office_id:31,request_id:crypto.randomUUID(),content:'B02 owned task'});
    await check('BIGINT person/account/authVersion validate exactly and reject adjacent identities',async()=>{
      const valid=await identity.validateSession(contact);assert(valid.valid);assert.equal(valid.user.personId,P);assert.equal(valid.user.accountId,A);assert.equal(valid.user.authVersion,V);
      assert.equal((await identity.validateSession({...contact,accountId:'9007199254740994'})).reason,'account_changed');
      assert.equal((await identity.validateSession({...contact,authVersion:'9007199254740996'})).reason,'authorization_changed');
      for(const person of people.slice(1)){assert((await identity.validateSession(session(person))).valid);assert((await identity.validateSession(contact)).valid);}
      const definition=await saveDefinition(contact);assert(definition.version_id);
      const [[row]]=await pool.execute('SELECT CAST(created_by_person_id AS CHAR) AS actor FROM data_map_definition_versions WHERE version_id=?',[definition.version_id]);assert.equal(row.actor,P);
    });
    await check('definition admin and overlay remain read-only; no-role and cross-department writes refused',async()=>{
      for(const actor of [admin,overlay,none])await assert.rejects(saveDefinition(actor),{code:'DEFINITION_ACCESS_DENIED'});
      await assert.rejects(saveDefinition(other,91),{code:'DEFINITION_ACCESS_DENIED'});
      assert((await saveDefinition(other,92)).version_id);
    });
    await check('office current lead can route; admin/overlay/no-role cannot route by role label',async()=>{
      assert((await officeTask(lead)).id);
      for(const actor of [admin,overlay,none])await assert.rejects(officeTask(actor),{code:'OFFICE_ACCESS_DENIED'});
    });
    await check('BIGINT independent admin never gets person authority or business write access',async()=>{
      const id='9007199254741001';
      await pool.execute("INSERT INTO system_admin_accounts(account_id,login_name,password_hash,must_change_password,account_status,auth_version,authorization_basis) VALUES (?,'admin','synthetic-not-used',0,'active',?,'B02 synthetic')",[id,V]);
      const system={identityKind:'system_admin',accountId:id,authVersion:V};
      const valid=await identity.validateSession(system);assert(valid.valid);assert.equal(valid.user.personId,null);assert.equal(valid.user.id,'system-admin:'+id);
      assert.equal(await require('../server/systemAdminIdentity').getSystemAdmin(pool,'system-admin:2'),null);assert((await identity.validateSession(system)).valid);
      assert.equal((await readPersonAuthority(pool,system,P)).valid,false);
      await assert.rejects(saveDefinition(system),{code:'DEFINITION_AUTH_REQUIRED'});await assert.rejects(officeTask(system),{code:'OFFICE_ACCESS_DENIED'});
      assert.equal((await identity.validateSession({...system,authVersion:'9007199254740996'})).valid,false);
    });
    await check('definition lock wait then changed authVersion refuses write and rolls back',async()=>{
      const blocker=await pool.getConnection();let pending;
      try {await blocker.beginTransaction();const [locked]=await blocker.execute('SELECT CAST(account_id AS CHAR) AS id FROM user_accounts WHERE account_id=? FOR UPDATE',[A]);assert.deepEqual(locked.map(row=>row.id),[A]);
        pending=saveDefinition(contact).then(()=>({allowed:true}),error=>({error}));
        try {await waitForLock(pool,pending,trace);}catch(error){const [transactions]=await pool.query('SELECT trx_mysql_thread_id,trx_state FROM information_schema.INNODB_TRX');const [processes]=await pool.query('SELECT ID,COMMAND,STATE FROM information_schema.PROCESSLIST');const [[settings]]=await blocker.execute('SELECT CONNECTION_ID() AS id,@@autocommit AS autocommit');save('lock-diagnostic.json',{transactions,processes,settings,trace:trace.filter(item=>item.accountLock)});throw error;}
        await blocker.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=?',[A]);await blocker.commit();
        const result=await pending;assert.equal(result.error?.code,'DEFINITION_AUTH_REQUIRED');
      } finally {await blocker.rollback();blocker.release();if(pending)await pending;}
      assert.equal((await identity.validateSession(contact)).reason,'authorization_changed');
    });
    await check('office lock wait then role revocation reads latest qualifications before protected write',async()=>{
      const blocker=await pool.getConnection();let pending;
      const [[before]]=await pool.execute('SELECT COUNT(*) AS n FROM mdm_todos');
      try {await blocker.beginTransaction();const [locked]=await blocker.execute('SELECT account_id FROM user_accounts WHERE account_id=? FOR UPDATE',[112]);assert.equal(locked.length,1);
        pending=officeTask(lead).then(()=>({allowed:true}),error=>({error}));await waitForLock(pool,pending,trace);
        await blocker.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=12");await blocker.commit();
        const result=await pending;assert.equal(result.error?.code,'OFFICE_ACCESS_DENIED');
      } finally {await blocker.rollback();blocker.release();if(pending)await pending;}
      const [[after]]=await pool.execute('SELECT COUNT(*) AS n FROM mdm_todos');assert.equal(after.n,before.n);
    });
    await check('department move changes definition scope without cached session department',async()=>{
      await pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=16');
      await assert.rejects(saveDefinition(other,92),{code:'DEFINITION_ACCESS_DENIED'});assert((await saveDefinition(other,91)).version_id);
    });
  },{stage:'02',randomDatabase:true});cleaned=true;
  save('results.json',{passed:true,checks,target,ownedResourcesCleaned:cleaned,formalDatabaseAccess:false});
  }catch(error){save('results.json',{passed:false,checks,error:{code:error.code,message:error.message},target,ownedResourcesCleaned:cleaned});throw error;
  }finally{if(previous===undefined)delete process.env.MDM_SYSTEM_ADMIN_ENABLED;else process.env.MDM_SYSTEM_ADMIN_ENABLED=previous;}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
