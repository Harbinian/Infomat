// --output must be a new artifacts directory, --baseline this dispatch's before
// snapshots. Only labelled freshMysql tmpfs/UUID resources and loopback HTTP.
// Qualification races observe performance_schema locks, never fabricated SQL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),net=require('node:net');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const {makeIdentityMysqlRepository,readPersonAuthority}=require('../server/identityMysqlRepository');
const {makeGovernanceAccessMysqlRepository}=require('../server/governanceAccessMysqlRepository');
const {maintenanceRequestContext}=require('../server/accountMaintenanceAuthority');
const output=path.resolve(process.argv[process.argv.indexOf('--output')+1]||'');
assert(process.argv.includes('--output')&&output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output));
fs.mkdirSync(output,{recursive:true});const save=(name,data)=>fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2)+'\n');
const P='9007199254741201',A='9007199254741301',V='9007199254741401',N='9007199254741200',NA='9007199254741300',NV='9007199254741400';
const D='9007199254741001',D2='9007199254741000';
const assignment=(code='mdm_lead',dept)=>({roleCode:code,scopeDepartmentId:dept,authorizationBasis:'B02 synthetic evidence',effectiveFrom:'2026-01-01'});
const checks=[],races=[],httpResults=[],httpStops=[],locksHeld=[];let target,server,auth,accounts,passed=false,failure;
const previousEnv={MDM_IDENTITY_READ_MODEL:process.env.MDM_IDENTITY_READ_MODEL,MDM_SYSTEM_ADMIN_ENABLED:process.env.MDM_SYSTEM_ADMIN_ENABLED};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{resolve,promise};};
const timeout=(promise,label)=>Promise.race([promise,new Promise((_,reject)=>{const id=setTimeout(()=>reject(Error('Timeout '+label)),12000);id.unref();})]);
const scalar=async(db,sql,params=[])=>{const [rows]=await db.execute(sql,params);return rows[0];};
async function physical(db){const state={};for(const [table,ids]of Object.entries({person:['person_id','current_department_id'],user_accounts:['account_id','person_id','auth_version'],person_roles:['person_role_id','person_id','role_id','scope_department_id','assigned_by_person_id','revoked_by_person_id'],identity_access_events:['event_id','actor_person_id','target_person_id','account_id','person_role_id']})){
  const [rows]=await db.execute('SELECT *,'+ids.map(id=>'CAST('+id+' AS CHAR) AS '+id).join(',')+' FROM '+table+' ORDER BY 1');
  state[table]=rows.map(row=>{const copy={...row};if(copy.password_hash){copy.credentialDigest=crypto.createHash('sha256').update(copy.password_hash).digest('hex');delete copy.password_hash;}return copy;});}return state;}
const targetState=state=>Object.fromEntries(Object.entries(state).map(([table,rows])=>[table,table==='identity_access_events'?rows:rows.filter(row=>String(row.person_id)!==P&&String(row.person_id)!==N)]));
async function closeHttp(){if(!server)return;const port=server.address().port;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));server=null;
  const refused=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.on('connect',()=>{socket.destroy();resolve(false);});socket.on('error',error=>resolve(error.code==='ECONNREFUSED'));});assert(refused);httpStops.push({owner:target.owner,port,closed:true,connectionRefused:true});}
async function observeWait(pool,database,object,connectionId){const deadline=Date.now()+12000;while(Date.now()<deadline){const [rows]=await pool.query(`
  SELECT r.OBJECT_SCHEMA,r.OBJECT_NAME,r.INDEX_NAME,r.LOCK_TYPE,r.LOCK_MODE,r.LOCK_STATUS,r.LOCK_DATA,
         r.ENGINE_TRANSACTION_ID requesting_transaction,b.ENGINE_TRANSACTION_ID blocking_transaction,
         t.PROCESSLIST_ID requesting_connection,bt.PROCESSLIST_ID blocking_connection,b.LOCK_MODE blocking_mode
  FROM performance_schema.data_lock_waits w
  JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
  JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID
  JOIN performance_schema.threads t ON t.THREAD_ID=r.THREAD_ID
  JOIN performance_schema.threads bt ON bt.THREAD_ID=b.THREAD_ID
  WHERE r.OBJECT_SCHEMA=? AND r.OBJECT_NAME=? AND t.PROCESSLIST_ID=?`,[database,object,connectionId]);if(rows.length)return rows;
  await new Promise(resolve=>setTimeout(resolve,20));}throw Error('No real lock wait on '+object);}
async function main(){process.env.MDM_IDENTITY_READ_MODEL='mysql';process.env.MDM_SYSTEM_ADMIN_ENABLED='1';
  try{await withFreshMysql(async({pool,owner,database,containerId,port})=>{
    target={owner,database,containerId,port};save('owned-target.json',target);const identity=makeIdentityMysqlRepository(pool);await identity.initSchema();
    const setup=await pool.getConnection();try{await require('../server/systemAdminMigration').applySystemAdmin(setup);}finally{setup.release();}
    await pool.execute("INSERT INTO departments(id,code,name) VALUES (?,'B02A','Synthetic A'),(?,'B02B','Synthetic B')",[D,D2]);
    const seed=async(id,account,department,roleCodes,status='active',version='1')=>{
      await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)",[String(id),'P'+id,'Person'+id,department]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (?,?,?,'synthetic-unused',?,0,?)",[String(account),String(id),'P'+id,status,String(version)]);
      for(const code of roleCodes)await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,'synthetic','2026-01-01' FROM roles WHERE role_code=?",[String(id),['department_contact','department_mdm_reviewer'].includes(code)?'department':'global',['department_contact','department_mdm_reviewer'].includes(code)?department:null,code]);
    };
    await seed(P,A,D,['admin','mdm_lead'],'active',V);await seed(N,NA,D2,['admin'],'active',NV);
    await seed(81,181,D2,['mdm_lead','data_conflict_handler']);await seed(82,182,D,['admin']);await seed(83,183,D,['admin','department_contact']);await seed(84,184,D,[]);await seed(85,185,D2,['department_contact']);await seed(88,188,D2,['mdm_lead'],'pending_activation');await seed(89,189,D2,['mdm_lead'],'disabled');
    await pool.execute("INSERT INTO person(employee_no,person_name,current_department_id) VALUES ('HttpAuthority','HttpAuthority',?)",[D2]);
    const repo=makeGovernanceAccessMysqlRepository(pool);auth=require('../server/auth');accounts=require('../server/routes/accounts');auth.setIdentityRepositoryFactory(()=>identity);accounts.setRepositoryFactory(()=>repo);
    const fixedSessions=new Map([[P,{personId:P,accountId:A,authVersion:V}],[N,{personId:N,accountId:NA,authVersion:NV}]]);
    for(const id of [81,82,83,84,85])fixedSessions.set(String(id),{personId:id,accountId:id+100,authVersion:1});
    const express=require('express'),security=require('../server/security'),app=express();app.use(express.json());
    app.use((req,res,next)=>{req.session={...(fixedSessions.get(req.headers['x-b02-person'])||{}),csrfSecret:'synthetic-csrf'};req.session.destroy=done=>done();next();});app.use(security.csrfProtection);app.use('/api/org/accounts',accounts);
    server=await new Promise(resolve=>{const owned=app.listen(0,'127.0.0.1',()=>resolve(owned));});save('owned-http.json',{owner,port:server.address().port,host:'127.0.0.1'});
    const call=async(actor,url,method,body)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/org/accounts'+url,{method,headers:{'content-type':'application/json','x-b02-person':String(actor),'X-CSRF-Token':'synthetic-csrf'},body:JSON.stringify(body)});const payload=await response.json();if(payload.initialPassword)payload.initialPassword='<generated>';return{status:response.status,body:payload};};
    const revokeId=(await repo.getAccount(81)).roleAssignments.find(role=>role.roleCode==='data_conflict_handler').assignmentId;
    const routes=[['createAccount','','POST',{loginName:'HttpAuthority',employeeNo:'HttpAuthority',name:'HttpAuthority',departmentId:D2,roleAssignments:[assignment()],actorPersonId:N}],
      ['updateAccount','/81','PATCH',{name:'Person81'}],['grantRole','/81/role-assignments','POST',assignment()],['revokeRole','/81/role-assignments/'+revokeId+'/revoke','POST',{reason:'synthetic revoke'}],
      ['activateAccount','/88/activate','POST',{}],['enableAccount','/89/enable','POST',{}],['disableAccount','/81/disable','POST',{reason:'synthetic disable'}],['resetPassword','/81/reset-password','POST',{}]];
    const rolledPool=(states,trace=[])=>({async getConnection(){const connection=await pool.getConnection();return new Proxy(connection,{get(db,key){
      if(key==='execute')return async(sql,params=[])=>{trace.push({sql,connectionId:db.connection.threadId});return db.execute(sql,params);};
      if(key==='commit')return async()=>{states.push(await physical(db));await db.rollback();};return typeof db[key]==='function'?db[key].bind(db):db[key];}});}});
    // Real qualified success on every HTTP production binding; rollback preserves fixtures.
    const states=[],trace=[];accounts.setRepositoryFactory(()=>makeGovernanceAccessMysqlRepository(rolledPool(states,trace)));
    for(const [operation,url,method,body]of routes){const result=await call(P,url,method,body);assert.equal(result.status,operation==='createAccount'||operation==='grantRole'?201:200,operation);httpResults.push({operation,actor:P,result});}
    assert(states.filter(s=>s.identity_access_events.length).every(s=>s.identity_access_events.every(e=>e.actor_person_id===P)));
    assert(trace.filter(t=>/FROM user_accounts WHERE account_id=.*FOR UPDATE/.test(t.sql)).length===8);
    const unchangedDirectory=await physical(pool),blockedDirectory=await call(P,'/81','PATCH',{name:'HTTP synthetic'});
    assert.equal(blockedDirectory.status,409);assert.equal(blockedDirectory.body.code,'PERSON_DIRECTORY_MAINTENANCE_REQUIRED');assert.deepEqual(await physical(pool),unchangedDirectory);
    const adjacent=await call(P,'/'+N+'/reset-password','POST',{});assert.equal(adjacent.status,200);assert.equal(adjacent.body.account.account_id,NA);assert.equal(adjacent.body.account.auth_version,(BigInt(NV)+1n).toString());
    assert.equal(states.at(-1).user_accounts.find(row=>row.person_id===P).auth_version,V);
    assert(states.at(-1).identity_access_events.some(e=>e.actor_person_id===P&&e.target_person_id===N&&e.account_id===NA));
    checks.push('eight HTTP operations use current locked authority; legacy PATCH is a no-op and directory changes return 409 without writes');
    for(const actor of [82,83])assert.equal((await call(actor,'/81/reset-password','POST',{})).status,200);
    for(const actor of [81,84,85,'absent'])assert.equal((await call(actor,'/81/reset-password','POST',{})).status,actor==='absent'?401:403);
    assert.equal((await call(P,'/81oops','PATCH',{})).body.code,'ACCOUNT_NOT_FOUND');
    checks.push('admin/person overlay, ordinary no-permission, cross-department department contact, unauthenticated and invalid target gates remain');
    accounts.setRepositoryFactory(()=>repo);
    const restoreActor=async()=>{await pool.execute("UPDATE person SET status='active',employment_status='active',current_department_id=? WHERE person_id=?",[D,P]);await pool.execute("UPDATE user_accounts SET account_status='active',must_change_password=0,auth_version=? WHERE account_id=?",[V,A]);
      await pool.execute("UPDATE person_roles SET assignment_status='active',effective_from='2026-01-01',effective_to=NULL,authorization_basis='synthetic' WHERE person_id=?",[P]);};
    // Every race starts AFTER HTTP authentication/prechecks, establishes an actual
    // consistent RR snapshot, then blocks a current SELECT on an independent X lock.
    async function race(name,route,record,change,expected,{failAudit=false}={}){
      await restoreActor();const [operation,url,method,body]=route;const snap=deferred(),proceed=deferred(),entries=[];let maintenanceId,snapshot,stateAtCommit;const before=await physical(pool),blocker=await pool.getConnection();let pending;
      const observed={async getConnection(){const connection=await pool.getConnection();maintenanceId=connection.connection.threadId;return new Proxy(connection,{get(db,key){
        if(key==='beginTransaction')return async()=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await db.beginTransaction();snapshot=await readPersonAuthority(db,fixedSessions.get(P),P,{includeFieldConstraints:true});assert(snapshot.valid);snapshot={valid:snapshot.valid,accountId:snapshot.user.accountId,authVersion:snapshot.user.authVersion,employment:snapshot.user.employment_status,permissions:[...snapshot.permissions],fieldConstraints:snapshot.fieldConstraints};snap.resolve();await proceed.promise;};
        if(key==='execute')return async(sql,params=[])=>{const entry={sql,connectionId:maintenanceId,finished:false};entries.push(entry);try{if(failAudit&&sql.includes('INSERT INTO identity_access_events'))throw Object.assign(Error('B02 injected audit failure'),{code:'B02_AUDIT_FAILURE'});return await db.execute(sql,params);}finally{entry.finished=true;}};
        if(key==='commit')return async()=>{stateAtCommit=await physical(db);await db.rollback();};
        if(key==='rollback')return async()=>{entries.push({transaction:'rollback',connectionId:maintenanceId});await db.rollback();};
        return typeof db[key]==='function'?db[key].bind(db):db[key];}});}};
      accounts.setRepositoryFactory(()=>makeGovernanceAccessMysqlRepository(observed));
      try{pending=call(P,url,method,body);await timeout(snap.promise,'RR snapshot');await blocker.beginTransaction();await blocker.execute(record.sql,record.params);
        proceed.resolve();const waits=await observeWait(pool,database,record.table,maintenanceId);assert(entries.some(entry=>!entry.finished&&/FOR (SHARE|UPDATE)/.test(entry.sql)));
        await change(blocker);await blocker.commit();const result=await pending;assert.equal(result.status,expected.status,name);if(expected.code)assert.equal(result.body.code,expected.code,name);if(expected.body)assert.deepEqual(result.body,expected.body,name);
        const after=await physical(pool);assert.deepEqual(targetState(after),targetState(before),name+' protected target and audit rollback');for(const table of ['person','user_accounts','person_roles'])assert.deepEqual(after[table].filter(row=>row.person_id===N),before[table].filter(row=>row.person_id===N),name+' adjacent actor neighbour');if(result.status>=400)assert(entries.some(entry=>entry.transaction==='rollback'));
        races.push({name,operation,RR:true,snapshot,record,waits,entries,result,stateAtCommit,protectedTargetAndAuditUnchanged:true});save('qualification-races.json',races);console.log('PASS '+name);
      }catch(error){const [diagnostic]=await pool.query('SHOW ENGINE INNODB STATUS');save(name+'-failure.json',{error:{code:error.code,message:error.message},entries,diagnostic:diagnostic.map(r=>r.Status)});throw error;
      }finally{proceed.resolve();await blocker.rollback();blocker.release();if(pending)await pending;accounts.setRepositoryFactory(()=>repo);}
    }
    const accountRecord={table:'user_accounts',sql:'SELECT account_id FROM user_accounts WHERE account_id=CAST(? AS SIGNED) FOR UPDATE',params:[A]};
    const personRecord={table:'person',sql:'SELECT person_id FROM person WHERE person_id=CAST(? AS SIGNED) FOR UPDATE',params:[P]};
    // Lock the same person/role index used by the authority reader and mutation.
    // A covering alternate-index SELECT followed by a different-index UPDATE
    // would itself invert the fixture writer's locks after observed contention.
    const roleRecord={table:'person_roles',sql:'SELECT person_role_id FROM person_roles FORCE INDEX(uq_person_roles_person_role) WHERE person_id=CAST(? AS SIGNED) FOR UPDATE',params:[P]};
    const manage=await scalar(pool,"SELECT perm_id,field_constraints FROM permissions WHERE perm_code='identity:manage-account'");
    const assign=await scalar(pool,"SELECT perm_id FROM permissions WHERE perm_code='identity:assign-role'");
    const admin=await scalar(pool,"SELECT role_id FROM roles WHERE role_code='admin'");
    const permissionRecord={table:'permissions',sql:'SELECT perm_id FROM permissions WHERE perm_id=? FOR UPDATE',params:[manage.perm_id]};
    for(const route of routes)await race('eight-http-account-disabled-'+route[0],route,accountRecord,db=>db.execute("UPDATE user_accounts SET account_status='disabled' WHERE account_id=?",[A]),{status:401,code:'SESSION_AUTHORIZATION_CHANGED'});
    await race('person-inactive',routes[1],personRecord,db=>db.execute("UPDATE person SET status='inactive' WHERE person_id=?",[P]),{status:401,code:'SESSION_AUTHORIZATION_CHANGED'});
    await race('employment-leave',routes[7],personRecord,db=>db.execute("UPDATE person SET employment_status='leave' WHERE person_id=?",[P]),{status:401,code:'SESSION_AUTHORIZATION_CHANGED'});
    await race('forced-password-change',routes[7],accountRecord,db=>db.execute('UPDATE user_accounts SET must_change_password=1 WHERE account_id=?',[A]),{status:403,code:'PASSWORD_CHANGE_REQUIRED'});
    await race('password-generation',routes[7],accountRecord,db=>db.execute("UPDATE user_accounts SET password_hash='synthetic-changed',auth_version=auth_version+1 WHERE account_id=?",[A]),{status:401,code:'SESSION_AUTHORIZATION_CHANGED'});
    await race('department-change-with-generation',routes[1],accountRecord,async db=>{await db.execute('UPDATE person SET current_department_id=? WHERE person_id=?',[D2,P]);await db.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=?',[A]);},{status:401,code:'SESSION_AUTHORIZATION_CHANGED'});
    for(const [name,sql]of [['role-revoked',"UPDATE person_roles SET assignment_status='revoked' WHERE person_id=?"],['role-expired',"UPDATE person_roles SET effective_to=DATE_SUB(CURRENT_DATE,INTERVAL 1 DAY) WHERE person_id=?"],['role-not-yet-effective',"UPDATE person_roles SET effective_from=DATE_ADD(CURRENT_DATE,INTERVAL 1 DAY) WHERE person_id=?"]])await race(name,routes[2],roleRecord,db=>db.execute(sql,[P]),{status:403,body:{error:'权限不足'}});
    await race('optional-role-evidence-removed',routes[2],roleRecord,db=>db.execute('UPDATE person_roles SET authorization_basis=NULL WHERE person_id=?',[P]),{status:201});
    await race('field-readonly-current',routes[1],permissionRecord,db=>db.execute('UPDATE permissions SET field_constraints=? WHERE perm_id=?',[JSON.stringify({readonly:['name']}),manage.perm_id]),{status:403,body:{error:'字段只读，不允许写入',readonly_fields:['name']}});
    await pool.execute('UPDATE permissions SET field_constraints=? WHERE perm_id=?',[manage.field_constraints,manage.perm_id]);
    const permissionAssignment=perm=>({table:'role_permissions',sql:'SELECT role_id,perm_id FROM role_permissions WHERE role_id=? AND perm_id=? FOR UPDATE',params:[admin.role_id,perm]});
    const changeEffect=perm=>db=>db.execute("UPDATE role_permissions SET effect='deny' WHERE role_id=? AND perm_id=?",[admin.role_id,perm]);
    for(const [name,route,permission,expected]of [
      ['manage-permission-denied',routes[7],manage.perm_id,{status:403,body:{error:'权限不足'}}],
      ['assign-permission-denied',routes[2],assign.perm_id,{status:403,body:{error:'权限不足'}}],
      ['create-second-permission-denied',routes[0],assign.perm_id,{status:403,body:{error:'权限不足'}}],
      ['grant-does-not-require-manage',routes[2],manage.perm_id,{status:201}],
      ['update-does-not-require-assign',routes[1],assign.perm_id,{status:200}]
    ]){await race(name,route,permissionAssignment(permission),changeEffect(permission),expected);await pool.execute("UPDATE role_permissions SET effect='allow' WHERE role_id=? AND perm_id=?",[admin.role_id,permission]);}
    const lead=await scalar(pool,"SELECT role_id,parent_role_id FROM roles WHERE role_code='mdm_lead'");
    await race('active-role-model-changed',routes[7],{table:'roles',sql:'SELECT role_id FROM roles WHERE role_id=? FOR UPDATE',params:[admin.role_id]},db=>db.execute("UPDATE roles SET model_version='synthetic-retired-model' WHERE role_id=?",[admin.role_id]),{status:403,body:{error:'权限不足'}});
    await pool.execute('UPDATE roles SET model_version=? WHERE role_id=?',[require('../server/roleDefinitions').ACCESS_MODEL_VERSION,admin.role_id]);
    // Real general role merge includes ancestors and deny precedence. These
    // fixture-only rows are restored; product roles/permission definitions stay.
    const originalLeadPermissions=(await pool.execute('SELECT perm_id,effect FROM role_permissions WHERE role_id=?',[lead.role_id]))[0];
    await pool.execute('DELETE FROM role_permissions WHERE role_id=? AND perm_id IN (?,?)',[admin.role_id,manage.perm_id,assign.perm_id]);
    await pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=? AND role_id=?",[P,lead.role_id]);
    await pool.execute("INSERT INTO role_permissions(role_id,perm_id,effect) VALUES (?,?,'allow'),(?,?,'allow') ON DUPLICATE KEY UPDATE effect='allow'",[lead.role_id,manage.perm_id,lead.role_id,assign.perm_id]);
    await pool.execute('UPDATE roles SET parent_role_id=? WHERE role_id=?',[lead.role_id,admin.role_id]);
    const mergedStates=[];accounts.setRepositoryFactory(()=>makeGovernanceAccessMysqlRepository(rolledPool(mergedStates)));
    assert.equal((await call(P,'/81/reset-password','POST',{})).status,200);assert.equal((await call(P,'/81/role-assignments','POST',assignment())).status,201);
    await pool.execute("INSERT INTO role_permissions(role_id,perm_id,effect) VALUES (?,?,'deny')",[admin.role_id,manage.perm_id]);
    const denied=await call(P,'/81/reset-password','POST',{});assert.deepEqual(denied,{status:403,body:{error:'权限不足'}});accounts.setRepositoryFactory(()=>repo);
    await pool.execute('UPDATE roles SET parent_role_id=NULL WHERE role_id=?',[admin.role_id]);await pool.execute('UPDATE roles SET parent_role_id=? WHERE role_id=?',[lead.parent_role_id,lead.role_id]);
    await pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=? AND role_id=?",[P,lead.role_id]);
    await pool.execute('DELETE FROM role_permissions WHERE role_id=?',[lead.role_id]);for(const permission of originalLeadPermissions)await pool.execute('INSERT INTO role_permissions(role_id,perm_id,effect) VALUES (?,?,?)',[lead.role_id,permission.perm_id,permission.effect]);
    for(const permission of [manage.perm_id,assign.perm_id])await pool.execute("INSERT INTO role_permissions(role_id,perm_id,effect) VALUES (?,?,'allow') ON DUPLICATE KEY UPDATE effect='allow'",[admin.role_id,permission]);
    checks.push('real general role/ancestor permission merge and deny precedence retain ordinary maintenance semantics');
    // Global account maintenance has no actor-department gate in the original
    // auth/access policy. Read and lock current departments, without inventing a
    // cross-department prohibition or a new department-status permission rule.
    await pool.execute("UPDATE departments SET status='inactive' WHERE id=?",[D]);
    const departmentStates=[];accounts.setRepositoryFactory(()=>makeGovernanceAccessMysqlRepository(rolledPool(departmentStates)));
    assert.equal((await call(P,'/81/reset-password','POST',{})).status,200);
    await pool.execute("UPDATE departments SET status='active' WHERE id=?",[D]);accounts.setRepositoryFactory(()=>repo);
    checks.push('global maintenance retains original cross-department/actor department policy while current department rows are locked');
    await race('audit-error-after-valid-lock-wait-propagates',routes[7],accountRecord,async()=>{}, {status:503,code:'IDENTITY_ACCESS_SERVICE_UNAVAILABLE'},{failAudit:true});
    checks.push('RR stale snapshot + actual independent lock waits cover all eight HTTP routes, revoke/date/evidence, inactive/employment/department generation, forced password, generation and fresh readonly; rejected targets and audit unchanged');
    await restoreActor();
    // Qualification locks remain owned through the protected write and commit.
    const held=deferred(),releaseHeld=deferred(),heldTrace=[];let heldConnectionId;const heldStates=[];
    const heldPool={async getConnection(){const db=await pool.getConnection();heldConnectionId=db.connection.threadId;return new Proxy(db,{get(db,key){
      if(key==='execute')return async(sql,params=[])=>{heldTrace.push({sql,connectionId:heldConnectionId});if(/^\s*UPDATE user_accounts/.test(sql)){held.resolve();await releaseHeld.promise;}return db.execute(sql,params);};
      if(key==='commit')return async()=>{heldStates.push(await physical(db));await db.rollback();};return typeof db[key]==='function'?db[key].bind(db):db[key];}});}};
    const writer=await pool.getConnection();let holderPending,writerPending;
    try{accounts.setRepositoryFactory(()=>makeGovernanceAccessMysqlRepository(heldPool));holderPending=call(P,'/81/reset-password','POST',{});await timeout(held.promise,'qualified write held');
      const [heldLocks]=await pool.query('SELECT l.OBJECT_NAME,l.INDEX_NAME,l.LOCK_TYPE,l.LOCK_MODE,l.LOCK_STATUS,l.LOCK_DATA FROM performance_schema.data_locks l JOIN performance_schema.threads t ON t.THREAD_ID=l.THREAD_ID WHERE l.OBJECT_SCHEMA=? AND t.PROCESSLIST_ID=?',[database,heldConnectionId]);
      for(const object of ['user_accounts','person','departments','person_roles','roles','role_permissions','permissions'])assert(heldLocks.some(lock=>lock.OBJECT_NAME===object&&lock.LOCK_TYPE==='RECORD'&&lock.LOCK_STATUS==='GRANTED'),object+' qualifications held');
      await writer.beginTransaction();writerPending=writer.execute('UPDATE permissions SET field_constraints=? WHERE perm_id=?',[JSON.stringify({readonly:['reason']}),manage.perm_id]);
      const waits=await observeWait(pool,database,'permissions',writer.connection.threadId);releaseHeld.resolve();assert.equal((await holderPending).status,200);await writerPending;await writer.commit();
      assert(heldStates[0].identity_access_events.some(e=>e.actor_person_id===P&&e.target_person_id==='81'));
      locksHeld.push({heldConnectionId,heldLocks,waits,trace:heldTrace,writerBlockedUntilMaintenanceTransactionEnded:true});save('qualification-lock-retention.json',locksHeld);
    }finally{releaseHeld.resolve();await writer.rollback();writer.release();if(holderPending)await holderPending;if(writerPending)await writerPending;accounts.setRepositoryFactory(()=>repo);await pool.execute('UPDATE permissions SET field_constraints=? WHERE perm_id=?',[manage.field_constraints,manage.perm_id]);}
    checks.push('account, person, department, assignments, roles and permission locks retained until maintenance transaction ends');
    // The seven writing consumers roll back target/role/audit state on audit
    // failure. Legacy PATCH is read-only and has no audit insert to fail.
    const auditFailures=[];
    for(const route of routes){const [operation,url,method,originalBody]=route;
      const body=originalBody;
      const before=await physical(pool),auditTrace=[];
      const failingPool={async getConnection(){const db=await pool.getConnection();return new Proxy(db,{get(db,key){
        if(key==='execute')return async(sql,params)=>{auditTrace.push(sql);if(sql.includes('INSERT INTO identity_access_events'))throw Object.assign(Error('B02_AUDIT_FAILURE'),{code:'B02_AUDIT_FAILURE'});return db.execute(sql,params);};
        if(key==='rollback')return async()=>{auditTrace.push('ROLLBACK');await db.rollback();};return typeof db[key]==='function'?db[key].bind(db):db[key];}});}};
      accounts.setRepositoryFactory(()=>makeGovernanceAccessMysqlRepository(failingPool));const result=await call(P,url,method,body);assert.equal(result.status,operation==='updateAccount'?200:503,operation);assert.deepEqual(await physical(pool),before,operation);if(operation==='updateAccount')assert(!auditTrace.some(sql=>/^\s*(INSERT|UPDATE|DELETE)/.test(sql)));else assert(auditTrace.includes('ROLLBACK'));auditFailures.push({operation,result,rolledBack:operation!=='updateAccount',readOnly:operation==='updateAccount',trace:auditTrace});
    }
    accounts.setRepositoryFactory(()=>repo);save('ordinary-http-audit-failures.json',auditFailures);checks.push('seven qualified HTTP audit failures roll back; legacy PATCH has no directory, account or audit write');
    // Two operators hold their own account/person locks. Release the first,
    // observe its real target wait, then release the reciprocal operation.
    const gates=new Map([[P,{ready:deferred(),release:deferred()}],[N,{ready:deferred(),release:deferred()}]]),peerTraces=new Map();
    const peerPool={async getConnection(){const db=await pool.getConnection(),entries=[];return new Proxy(db,{get(db,key){
      if(key==='beginTransaction')return async()=>{entries.push({transaction:'begin'});await db.beginTransaction();};
      if(key==='execute')return async(sql,params=[])=>{const entry={sql,connectionId:db.connection.threadId};entries.push(entry);let result;try{result=await db.execute(sql,params);}catch(error){entry.error={code:error.code,message:error.message};throw error;}if(/FROM person WHERE person_id=.*FOR UPDATE/.test(sql)){const gate=gates.get(String(params[0]));peerTraces.set(String(params[0]),{connectionId:db.connection.threadId,entries});gate.ready.resolve();await gate.release.promise;}return result;};
      if(key==='rollback')return async()=>{entries.push({transaction:'rollback'});await db.rollback();};return typeof db[key]==='function'?db[key].bind(db):db[key];}});}};
    let peerP,peerN;const beforePeers=await physical(pool);
    try{accounts.setRepositoryFactory(()=>makeGovernanceAccessMysqlRepository(peerPool));peerP=call(P,'/'+N+'/reset-password','POST',{});await timeout(gates.get(P).ready.promise,'first actor');peerN=call(N,'/'+P+'/reset-password','POST',{});await timeout(gates.get(N).ready.promise,'second actor');
      gates.get(P).release.resolve();const waits=await observeWait(pool,database,'user_accounts',peerTraces.get(P).connectionId);gates.get(N).release.resolve();const outcomes=await Promise.all([peerP,peerN]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,503]);
      const after=await physical(pool),newEvents=after.identity_access_events.filter(event=>!beforePeers.identity_access_events.some(old=>old.event_id===event.event_id));assert.equal(newEvents.length,1);assert.equal(newEvents[0].event_type,'password_reset');
      assert(newEvents[0].actor_person_id===P||newEvents[0].actor_person_id===N);for(const peer of peerTraces.values())assert.equal(peer.entries.filter(e=>e.transaction==='begin').length,1);
      assert([...peerTraces.values()].some(peer=>peer.entries.some(e=>e.transaction==='rollback')));
      assert([...peerTraces.values()].some(peer=>peer.entries.some(e=>e.error?.code==='ER_LOCK_DEADLOCK')));
      const [diagnostic]=await pool.query('SHOW ENGINE INNODB STATUS');assert(diagnostic[0].Status.includes('LATEST DETECTED DEADLOCK'));save('reciprocal-deadlock.json',{waits,outcomes,peerTraces:Object.fromEntries(peerTraces),newEvents,diagnostic:diagnostic[0].Status,oneCommitOneRollback:true,noAutomaticReplay:true});
    }finally{for(const gate of gates.values())gate.release.resolve();if(peerP)await peerP;if(peerN)await peerN;accounts.setRepositoryFactory(()=>repo);await restoreActor();await pool.execute('UPDATE user_accounts SET must_change_password=0,auth_version=? WHERE account_id=?',[NV,NA]);}
    checks.push('reciprocal maintenance real lock wait/deadlock yields one commit and one complete rollback, original service failure and no replay');
    // Self maintenance holds X locks and does not lose its own audited identity.
    const selfStates=[];accounts.setRepositoryFactory(()=>makeGovernanceAccessMysqlRepository(rolledPool(selfStates)));
    for(const operation of ['updateAccount','resetPassword']){const route=operation==='updateAccount'?['/'+P,'PATCH',{name:'Person'+P}]:['/'+P+'/reset-password','POST',{}];assert.equal((await call(P,...route)).status,200);}
    assert(selfStates.at(-1).identity_access_events.some(event=>event.actor_person_id===P&&event.target_person_id===P));checks.push('self maintenance succeeds without shared-to-exclusive upgrade and exact actor-target identity');
    accounts.setRepositoryFactory(()=>repo);
    // HTTP cannot fall back when the factory omits binding or identity reading fails.
    accounts.setRepositoryFactory(()=>({async resetPassword(){throw Error('UNQUALIFIED_HTTP_PATH');}}));assert.equal((await call(P,'/81/reset-password','POST',{})).status,503);accounts.setRepositoryFactory(()=>repo);
    const brokenPool={async getConnection(){const db=await pool.getConnection();return new Proxy(db,{get(db,key){if(key==='execute')return async(sql,params)=>{if(/FROM person p/.test(sql))throw Error('B02_CURRENT_READ_FAILED');return db.execute(sql,params);};return typeof db[key]==='function'?db[key].bind(db):db[key];}});}};
    accounts.setRepositoryFactory(()=>makeGovernanceAccessMysqlRepository(brokenPool));const beforeFailure=await physical(pool);assert.equal((await call(P,'/81/reset-password','POST',{})).status,503);assert.deepEqual(await physical(pool),beforeFailure);accounts.setRepositoryFactory(()=>repo);
    checks.push('missing binding and failing current read produce service failure with no HTTP fallback or protected changes');
    save('http-results.json',httpResults);save('valid-lock-trace.json',trace);save('checks.json',checks);
    await closeHttp();
  },{stage:'02',randomDatabase:true});passed=true;
  }catch(error){failure={message:error.message,code:error.code,stack:error.stack};throw error;
  }finally{await closeHttp();auth?.resetIdentityRepositoryFactory();accounts?.resetRepositoryFactory();let cleanup;
    if(target){const remaining=cp.execFileSync('docker',['ps','-aq','--filter','label=infomat.stage02='+target.owner],{env:isolatedEnvironment(),encoding:'utf8',windowsHide:true}).trim();assert.equal(remaining,'');cleanup={...target,cleaned:true,remaining:0,httpStops};save('resource-cleanup.json',cleanup);}
    for(const[key,value]of Object.entries(previousEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
    save('results.json',{passed,failure,checks,races:races.map(r=>({name:r.name,operation:r.operation,table:r.record.table,result:r.result,waits:r.waits})),locksHeld,cleanup,formalDatabaseAccess:false,businessAccepted:false});
  }
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
