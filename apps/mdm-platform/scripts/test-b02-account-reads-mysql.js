// B02 account/assignment/audit read verification. --output must be a new
// artifacts directory; --baseline is this run's before directory. Uses existing
// freshMysql owned tmpfs/UUID resources, synthetic rows and loopback injected
// original GET APIs. Maintenance comparisons roll back every synthetic write.
// No private config, formal DB, worker, AI, notifications or browser.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),cp=require('node:child_process'),net=require('node:net');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const {identityInteger}=require('../server/sessionSubject');
const argument=name=>process.argv[process.argv.indexOf(name)+1];
const output=path.resolve(argument('--output')||''),baseline=path.resolve(argument('--baseline')||'');
assert(process.argv.includes('--output')&&output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output));
assert(process.argv.includes('--baseline')&&fs.existsSync(path.join(baseline,'apps__mdm-platform__server__governanceAccessMysqlRepository.js')));
fs.mkdirSync(output,{recursive:true});const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
function load(relative,before=false,helpers=false){const filename=path.resolve(__dirname,'../'+relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  const file=before?path.join(baseline,('apps/mdm-platform/'+relative).replaceAll('/','__')):filename;
  mod._compile(fs.readFileSync(file,'utf8')+(helpers?'\nmodule.exports.testReadHelpers={getAccountRecord,listRoleAssignments};':''),filename);return mod.exports;}
const current=load('server/governanceAccessMysqlRepository.js',false,true),prior=load('server/governanceAccessMysqlRepository.js',true,true);
const identity=require('../server/identityMysqlRepository'),beforeIdentity=load('server/identityMysqlRepository.js',true);
const checks=[],comparisons=[],bindings=[],httpStops=[],maintenance=[],systemBindings=[];
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare=(name,now,old)=>{assert.deepEqual(now,old,name);comparisons.push({name,equal:true,sha256:hash(now),beforeSha256:hash(old)});};
const check=async(name,action)=>{await action();checks.push(name);console.log('PASS '+name);};
const D0='9007199254741000',D1='9007199254741001',P0='9007199254741200',P1='9007199254741201',A0='9007199254741300',A1='9007199254741301',V0='9007199254741400',V1='9007199254741401';
const R0='9007199254741500',R1='9007199254741501',G0='9007199254741600',G1='9007199254741601',E0='9007199254741700',E1='9007199254741701';
const people=[{id:81,account:181,dept:91,roles:['mdm_lead']},{id:82,account:182,dept:91,roles:['admin']},{id:83,account:183,dept:91,roles:['admin','department_contact']},
  {id:84,account:184,dept:91,roles:[]},{id:85,account:185,dept:92,roles:['department_contact']},{id:86,dept:null,roles:[]},{id:87,dept:91,roles:[]},
  {id:88,account:188,dept:91,roles:['data_conflict_handler'],status:'pending_activation'},{id:89,account:189,dept:91,roles:['data_conflict_handler'],status:'disabled'},
  {id:P0,account:A0,dept:D0,version:V0,roles:['data_conflict_handler']},{id:P1,account:A1,dept:D1,version:V1,roles:['data_conflict_handler']}];
const session=person=>({personId:person.id,accountId:person.account,authVersion:person.version||1});
let target,server,passed=false,failure,auth,org,accounts;
const previousEnv={MDM_IDENTITY_READ_MODEL:process.env.MDM_IDENTITY_READ_MODEL,MDM_SYSTEM_ADMIN_ENABLED:process.env.MDM_SYSTEM_ADMIN_ENABLED};
const portClosed=port=>new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.on('connect',()=>{socket.destroy();resolve(false);});socket.on('error',error=>resolve(error.code==='ECONNREFUSED'));});
async function stopHttp(){if(!server)return;const port=server.address().port;await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));server=null;
  assert(await portClosed(port));httpStops.push({owner:target.owner,port,stopped:true,connectionRefused:true});console.log('B02_OWNED_HTTP_STOPPED');}
async function main(){process.env.MDM_IDENTITY_READ_MODEL='mysql';process.env.MDM_SYSTEM_ADMIN_ENABLED='1';
  try{await withFreshMysql(async({pool,owner,database,containerId,port})=>{
    target={owner,database,containerId,port};save('owned-target.json',target);
    await identity.makeIdentityMysqlRepository(pool).initSchema();const setup=await pool.getConnection();try{await require('../server/systemAdminMigration').applySystemAdmin(setup);}finally{setup.release();}
    for(const id of [91,92,D0,D1])await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)',[String(id),'D'+id,'Dept'+id]);
    for(const person of people){await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id,status) VALUES (?,?,?,?,\'active\')',[String(person.id),'P'+person.id,'Person'+person.id,person.dept==null?null:String(person.dept)]);
      if(person.account)await pool.execute('INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (?,?,?,\'synthetic-unused\',?,0,?)',[String(person.account),String(person.id),'P'+person.id,person.status||'active',String(person.version||1)]);
      for(const code of person.roles)await pool.execute(`INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from,assigned_by_person_id)
        SELECT ?,role_id,?,?,'B02 synthetic',CURRENT_DATE,NULL FROM roles WHERE role_code=?`,[String(person.id),['admin','mdm_lead','data_conflict_handler'].includes(code)?'global':'department',['admin','mdm_lead','data_conflict_handler'].includes(code)?null:String(person.dept),code]);
    }
    for(const [roleId,code,status] of [[51,'b02-historical-small','legacy'],[R0,'b02-historical-0','legacy'],[R1,'b02-historical-1','retired']])await pool.execute("INSERT INTO roles(role_id,role_code,role_name,role_group,status,is_system) VALUES (?,?,?,'legacy',?,0)",[String(roleId),code,code,status]);
    for(const [assignmentId,personId,roleId,departmentId,status,assigner,revoker] of [[G0,P0,R0,D0,'expired',P1,null],[G1,P1,R1,D1,'revoked',null,P0],[501,81,51,null,'revoked',null,null]])
      await pool.execute(`INSERT INTO person_roles(person_role_id,person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from,effective_to,assignment_status,assigned_by_person_id,revoked_by_person_id,revocation_reason)
        VALUES (?,?,?,'department',?,'historical evidence','2001-01-01','2001-12-31',?,?,?,'historical reason')`,[String(assignmentId),String(personId),String(roleId),departmentId==null?null:String(departmentId),status,assigner,revoker]);
    await pool.execute("INSERT INTO system_admin_accounts(account_id,login_name,password_hash,account_status,must_change_password,auth_version,authorization_basis) VALUES (?,'admin','synthetic-unused','active',0,?,'B02 synthetic')",[A1,V1]);
    const payload={historical_person_id:P1,unchanged_number:9007199254740992,unknown:[null,'kept',{version:'process-governance-v7'}]};
    for(const [id,actor,targetId,account,assignment] of [[1,82,81,181,501],[2,null,null,null,null],[E0,P0,P1,A1,G1],[E1,null,P0,A0,G0]])
      await pool.execute("INSERT INTO identity_access_events(event_id,event_type,actor_person_id,target_person_id,account_id,person_role_id,reason,payload_json,created_at) VALUES (?,'role_assigned',?,?,?,?, 'historical audit',?,'2020-01-02 03:04:05')",[String(id),actor==null?null:String(actor),targetId==null?null:String(targetId),account==null?null:String(account),assignment==null?null:String(assignment),JSON.stringify(payload)]);
    await pool.execute("INSERT INTO system_admin_events(actor_account_id,event_type,identity_event_id,target_person_id) VALUES (?,'role_assigned',?,?)",[A1,E1,P0]);
    const connection=await pool.getConnection();try{
      const observed={async execute(sql,params=[]){if(/WHERE (p|pr)\.person_id=|e\.target_person_id=/.test(sql))bindings.push({sql,params:params.map(value=>({value:value===undefined?'<undefined>':value,type:typeof value}))});return connection.execute(sql,params);}};
      const repo=current.makeGovernanceAccessMysqlRepository(observed),before=prior.makeGovernanceAccessMysqlRepository(connection),ident=identity.makeIdentityMysqlRepository(observed),oldIdent=beforeIdentity.makeIdentityMysqlRepository(connection);
      await check('ordinary complete account and role JSON equals baseline, including null account/department and history',async()=>{
        const safe=rows=>rows.filter(row=>Number.isSafeInteger(row.person_id));compare('listAccounts-safe',safe(await repo.listAccounts()),safe(await before.listAccounts()));
        for(const id of [81,82,86,87]){compare('getAccount-'+id,await repo.getAccount(id),await before.getAccount(id));compare('assignedRoles-'+id,await ident.getAssignedRoles(id),await oldIdent.getAssignedRoles(id));}
        const unlinked=await repo.getAccount(86);assert.equal(unlinked.account_id,null);assert.equal(unlinked.current_department_id,null);assert.equal(unlinked.auth_version,null);
        assert.equal((await ident.getAssignedRoles(81)).find(r=>r.person_role_id===501).assignment_status,'revoked');
        const smallEvents=rows=>rows.filter(row=>Number.isSafeInteger(row.event_id));compare('audit-safe',smallEvents(await repo.listAccessEvents()),smallEvents(await before.listAccessEvents()));
      });
      await check('adjacent BIGINT person/account/department/assignment/role/actor/revoker identities remain distinct',async()=>{
        const accounts=await repo.listAccounts();for(const [p,a,d,v,g,r]of[[P0,A0,D0,V0,G0,R0],[P1,A1,D1,V1,G1,R1]]){
          const row=accounts.find(row=>row.person_id===p);assert(row);assert.equal(row.account_id,a);assert.equal(row.current_department_id,d);assert.equal(row.auth_version,v);
          const assignment=row.roleAssignments.find(row=>row.assignmentId===g);assert(assignment);assert.equal(assignment.scopeDepartmentId,d);
          if(p===P0){assert.equal(assignment.assignedByPersonId,P1);assert.equal(assignment.assignedByPersonName,'Person'+P1);assert.equal(assignment.revokedByPersonId,null);}else{assert.equal(assignment.assignedByPersonId,null);assert.equal(assignment.revokedByPersonId,P0);assert.equal(assignment.revokedByPersonName,'Person'+P0);}
          const role=(await ident.getAssignedRoles(p)).find(role=>role.role_id===r);assert(role);assert.equal(role.person_role_id,g);assert.equal(role.scope_department_id,d);
        }save('accounts-exact.json',accounts);
      });
      await check('real prepared statement reuse binds decimal IDs, rejects rounded/invalid inputs and preserves driver errors',async()=>{
        for(const id of [81,P0,P1,82,P1,P0,'81',P1]){assert.equal((await repo.getAccount(id)).person_id,identityInteger(id));assert((await ident.getAssignedRoles(id)).length);}
        for(const id of [null,Number(P1),'81oops','system-admin:81',{},'9223372036854775808',-1,0]){assert.equal(await repo.getAccount(id),null);assert.deepEqual(await ident.getAssignedRoles(id),[]);}
        await assert.rejects(repo.getAccount(undefined),/undefined/);await assert.rejects(ident.getAssignedRoles(undefined),/undefined/);
        assert.equal(await repo.getAccount(991),null);assert.deepEqual(await ident.getAssignedRoles(991),[]);
        for(const filters of [{personId:P0},{personId:P1,eventType:'role_assigned',limit:1},{eventType:'no-such-event'},{limit:1},{limit:999},{personId:81}]){
          const events=await repo.listAccessEvents(filters);assert(events.length<=Math.min(Number(filters.limit||100),500));
          if(filters.personId)assert(events.every(e=>String(e.target_person_id)===String(filters.personId)||String(e.actor_person_id)===String(filters.personId)));
          if(filters.eventType==='no-such-event')assert.deepEqual(events,[]);
        }
        assert.deepEqual(await repo.listAccessEvents({personId:Number(P1)}),[]);assert.deepEqual(await repo.listAccessEvents({personId:'81oops'}),[]);
      });
      await check('audit exact event and system-account links preserve null people, payload JSON and sorting',async()=>{
        const events=await repo.listAccessEvents();assert.deepEqual(events.map(e=>e.event_id),[E1,E0,2,1]);
        const system=events[0];assert.equal(system.actor_person_id,null);assert.equal(system.actor_system_account_id,A1);assert.equal(system.actor_name,'admin');assert.equal(system.target_person_id,P0);assert.equal(system.account_id,A0);assert.equal(system.person_role_id,G0);
        const person=events[1];assert.equal(person.actor_person_id,P0);assert.equal(person.actor_name,'Person'+P0);assert.equal(person.actor_system_account_id,null);assert.equal(person.target_person_id,P1);assert.equal(person.account_id,A1);assert.equal(person.person_role_id,G1);
        const empty=events[2];for(const key of ['actor_person_id','actor_name','actor_system_account_id','target_person_id','target_name','account_id','person_role_id'])assert.equal(empty[key],null);
        const [physical]=await connection.execute('SELECT CAST(event_id AS CHAR) AS event_id,payload_json FROM identity_access_events ORDER BY event_id');
        for(const event of events)compare('payload-'+event.event_id,event.payload_json,physical.find(row=>row.event_id===String(event.event_id)).payload_json);
        process.env.MDM_SYSTEM_ADMIN_ENABLED='0';compare('audit-system-disabled-safe',(await repo.listAccessEvents()).filter(e=>Number.isSafeInteger(e.event_id)),(await before.listAccessEvents()).filter(e=>Number.isSafeInteger(e.event_id)));
        assert((await repo.listAccessEvents()).every(e=>e.actor_system_account_id===null));process.env.MDM_SYSTEM_ADMIN_ENABLED='1';save('audit-exact.json',events);
      });
      await check('shared maintenance helper default SQL/params and includeHistory remain identical to baseline',async()=>{
        for(const id of [81,P0,P1])for(const history of [true,false]){const traces=[];const capture={async execute(sql,params){traces.push({sql,params});return connection.execute(sql,params);}};
          const oldAccount=await prior.testReadHelpers.getAccountRecord(capture,id),oldRoles=await prior.testReadHelpers.listRoleAssignments(capture,id,history);const oldTrace=traces.splice(0);
          compare('default-account-'+id+'-'+history,await current.testReadHelpers.getAccountRecord(capture,id),oldAccount);compare('default-assignments-'+id+'-'+history,await current.testReadHelpers.listRoleAssignments(capture,id,history),oldRoles);
          compare('default-helper-sql-'+id+'-'+history,traces,oldTrace);assert(!traces.some(t=>/CAST/.test(t.sql)));maintenance.push({id,includeHistory:history,defaultSQLAndParametersUnchanged:true});
        }
      });
      await check('shared authority still handles person/admin/overlay/unauthorized/cross-department and generation boundaries',async()=>{
        for(const p of people.filter(p=>p.account&&!p.status)){const next=await ident.getCurrentUserPayload(session(p)),old=await oldIdent.getCurrentUserPayload(session(p));compare('authority-'+p.id,next,old);}
        const system={identityKind:'system_admin',accountId:A1,authVersion:V1};compare('independent-admin-payload',await ident.getCurrentUserPayload(system),await oldIdent.getCurrentUserPayload(system));assert.equal((await ident.getCurrentUserPayload(system)).personId,null);
        assert.equal((await identity.readPersonAuthority(observed,system,P1)).valid,false);
        assert.equal((await ident.getCurrentUserPayload(session(people[3]))).permissions.length,0);
        const outsider=await ident.getCurrentUserPayload(session(people[4]));assert(outsider.dataScopes.includes('department:92'));assert(!outsider.dataScopes.includes('department:91'));
        assert.equal((await ident.validateSession({...session(people.at(-1)),accountId:A0})).valid,false);assert.equal((await ident.validateSession({...session(people.at(-1)),authVersion:V0})).valid,false);
      });
      // Unchanged writes are compared on the same disposable connection and
      // rolled back. Retired person edits are checked against the current API.
      await check('unchanged maintenance remains baseline-equivalent; legacy person edits return an explicit directory conflict',async()=>{
        const [[clock]]=await connection.execute('SELECT UNIX_TIMESTAMP() AS now');await connection.execute('SET timestamp=?',[clock.now]);
        async function attempt(factory,name,args,system=false){const trace=[];const db=new Proxy(connection,{get(target,key){if(key==='execute')return async(sql,params=[])=>{trace.push({sql,params:/INSERT INTO system_admin_events/.test(sql)?params.map((v,i)=>i===2?'<generated-event-id>':v):params});return target.execute(sql,params);};
          if(key==='beginTransaction')return async()=>{trace.push({transaction:'begin'});await target.beginTransaction();};if(key==='commit')return async()=>{trace.push({transaction:'commit-request-rolled-back'});await target.rollback();};if(key==='rollback')return async()=>{trace.push({transaction:'rollback'});await target.rollback();};if(key==='release')return()=>{};return typeof target[key]==='function'?target[key].bind(target):target[key];}});
          let writeRepo=factory({getConnection:async()=>db});if(system)writeRepo=writeRepo.forSystemAdmin({identityKind:'system_admin',identityRef:'system-admin:'+A1,accountId:A1,authVersion:V1});
          try{return{result:await writeRepo[name](...args),trace};}catch(error){return{error:{statusCode:error.statusCode,code:error.code,message:error.message},trace};}
        }
        const inputs=[['updateAccount',[81,{name:'Changed',actorPersonId:82}]],['grantRole',[81,{roleCode:'mdm_lead',authorizationBasis:'B02 synthetic',effectiveFrom:new Date(clock.now*1000).toISOString().slice(0,10),actorPersonId:82}]],
          ['disableAccount',[81,{reason:'B02 synthetic',actorPersonId:82}]],['resetPassword',[81,{passwordHash:'synthetic-unused-reset',actorPersonId:82}]],['activateAccount',[88,{passwordHash:'synthetic-unused-activate',actorPersonId:82}]],['enableAccount',[89,{actorPersonId:82}]],
          ['enableAccount',[88,{}]],['updateAccount',[991,{name:'Missing'}]]];
        for(const [name,args]of inputs){const next=await attempt(current.makeGovernanceAccessMysqlRepository,name,args);
          if(name==='updateAccount'){
            assert.equal(next.error?.code,args[0]===991?'ACCOUNT_NOT_FOUND':'PERSON_DIRECTORY_MAINTENANCE_REQUIRED');assert(next.trace.some(entry=>entry.transaction==='rollback'));assert(!next.trace.some(entry=>/^\s*(INSERT|UPDATE|DELETE)/.test(entry.sql||'')));
            maintenance.push({method:name,personId:args[0],contract:'directory-boundary',error:next.error,rolledBack:true});continue;
          }
          const old=await attempt(prior.makeGovernanceAccessMysqlRepository,name,args);compare('maintenance-'+name+'-'+args[0],next,old);maintenance.push({method:name,personId:args[0],equivalent:true,rolledBack:true});}
        for(const system of [false,true]){const beforePerson=await repo.getAccount(81),noop=await attempt(current.makeGovernanceAccessMysqlRepository,'updateAccount',[81,{name:beforePerson.person_name,departmentId:beforePerson.current_department_id}],system);assert.equal(noop.error,undefined);assert.equal(noop.result.auth_version,beforePerson.auth_version);assert(!noop.trace.some(entry=>/^\s*(INSERT|UPDATE|DELETE)/.test(entry.sql||'')));assert.deepEqual(await repo.getAccount(81),beforePerson);}
        const role=(await current.testReadHelpers.listRoleAssignments(connection,81,true)).find(r=>r.roleCode==='mdm_lead');
        compare('maintenance-revoke',await attempt(current.makeGovernanceAccessMysqlRepository,'revokeRole',[81,role.assignmentId,{reason:'B02 synthetic',actorPersonId:82}]),await attempt(prior.makeGovernanceAccessMysqlRepository,'revokeRole',[81,role.assignmentId,{reason:'B02 synthetic',actorPersonId:82}]));
        compare('system-maintenance-binding',await attempt(current.makeGovernanceAccessMysqlRepository,'resetPassword',[81,{passwordHash:'synthetic-unused-reset'}],true),await attempt(prior.makeGovernanceAccessMysqlRepository,'resetPassword',[81,{passwordHash:'synthetic-unused-reset'}],true));
        await connection.execute('SET timestamp=0');save('maintenance-equivalence.json',maintenance);
      });
      await check('original account GET and org role GET APIs preserve permission/error contracts and exact association',async()=>{
        const express=require('express');auth=require('../server/auth');org=require('../server/routes/org');accounts=require('../server/routes/accounts');
        const oldAccounts=load('server/routes/accounts.js',true),oldOrg=load('server/routes/org.js',true);
        auth.setIdentityRepositoryFactory(()=>ident);org.setIdentityRepositoryFactory(()=>ident);oldOrg.setIdentityRepositoryFactory(()=>oldIdent);
        const wrapped=new Proxy(repo,{get(target,key){if(key==='forSystemAdmin')return actor=>{systemBindings.push({identityRef:actor.identityRef,accountId:actor.accountId,personId:actor.personId??null});return target.forSystemAdmin(actor);};return typeof target[key]==='function'?target[key].bind(target):target[key];}});
        accounts.setRepositoryFactory(()=>wrapped);oldAccounts.setRepositoryFactory(()=>before);
        const app=express();app.use((req,res,next)=>{const id=req.headers['x-b02-person'];req.session=id==='system'?{identityKind:'system_admin',accountId:A1,authVersion:V1}:session(people.find(p=>String(p.id)===id)||{});req.session.destroy=done=>done();next();});
        app.use('/api/accounts',accounts);app.use('/api/org',org);app.use('/before/accounts',oldAccounts);app.use('/before/org',oldOrg);
        server=await new Promise(resolve=>{const owned=app.listen(0,'127.0.0.1',()=>resolve(owned));});const httpPort=server.address().port,base='http://127.0.0.1:'+httpPort;
        save('owned-http.json',{owner,port:httpPort,address:'127.0.0.1',injectedOwnedRepository:true});
        const get=async(url,actor=82)=>{const response=await fetch(base+url,{headers:{'x-b02-person':String(actor)}});return{status:response.status,body:await response.json()};};const api=[];
        for(const actor of [82,83,'system',84,85,'unknown'])for(const endpoint of ['/accounts','/accounts/81','/accounts/audit-events?personId=81','/org/users/81/roles']){
          const next=await get('/api'+endpoint,actor),old=await get('/before'+endpoint,actor);const status=actor===82||actor===83||actor==='system'?200:actor==='unknown'?401:403;
          assert.equal(next.status,status,actor+endpoint);assert.equal(next.status,old.status);if(status!==200||endpoint!=='/accounts')compare('api-'+actor+endpoint,next,old);
          else compare('api-safe-list-'+actor,next.body.filter(row=>Number.isSafeInteger(row.person_id)),old.body.filter(row=>Number.isSafeInteger(row.person_id)));api.push({actor,endpoint,status:next.status,beforeStatus:old.status});
        }
        for(const actor of [82,'system'])for(const p of [P0,P1]){const response=await get('/api/accounts/'+p,actor);assert.equal(response.status,200);assert.equal(response.body.person_id,p);assert.equal(response.body.account_id,p===P0?A0:A1);
          const roles=await get('/api/org/users/'+p+'/roles',actor);assert.equal(roles.status,200);assert(roles.body.some(r=>r.person_role_id===(p===P0?G0:G1)));
          const events=await get('/api/accounts/audit-events?personId='+p,actor);assert.equal(events.status,200);assert(events.body.every(e=>e.actor_person_id===p||e.target_person_id===p));api.push({actor,personId:p,account:response,roles,events});}
        for(const endpoint of ['/accounts/991','/accounts/81oops']){const response=await get('/api'+endpoint);assert.equal(response.status,404);assert.equal(response.body.code,'ACCOUNT_NOT_FOUND');}
        const roundedClient=await get('/api/accounts/'+Number(P1));assert.equal(roundedClient.status,200);assert.equal(roundedClient.body.person_id,P0);
        save('upstream-number-limitation.json',{originalIntendedId:P1,serializedRequest:String(Number(P1)),actualReadId:roundedClient.body.person_id,
          reason:'HTTP decimal path is a valid neighbouring ID after upstream Number rounding; information is already lost. Remaining page callers must preserve the exact string.'});
        assert.deepEqual((await get('/api/org/users/81oops/roles')).body,[]);assert.deepEqual((await get('/api/accounts/audit-events?personId=81oops')).body,[]);
        assert(systemBindings.length);assert(systemBindings.every(s=>s.personId===null&&s.accountId===A1&&s.identityRef==='system-admin:'+A1));save('system-bindings.json',systemBindings);
        // Original service-error adapters are exercised through the same GETs.
        const error=Object.assign(Error('synthetic repository denied'),{code:'ER_TABLEACCESS_DENIED_ERROR'});accounts.setRepositoryFactory(()=>({async listAccounts(){throw error;},async getAccount(){throw error;},async listAccessEvents(){throw error;}}));
        for(const endpoint of ['/accounts','/accounts/81','/accounts/audit-events']){const response=await get('/api'+endpoint);assert.equal(response.status,503);assert.equal(response.body.code,'IDENTITY_ACCESS_SERVICE_UNAVAILABLE');}
        org.setIdentityRepositoryFactory(()=>new Proxy(ident,{get(target,key){if(key==='getAssignedRoles')return async()=>{throw error;};return typeof target[key]==='function'?target[key].bind(target):target[key];}}));assert.equal((await get('/api/org/users/81/roles')).status,503);
        accounts.setRepositoryFactory(()=>wrapped);org.setIdentityRepositoryFactory(()=>ident);save('api-results.json',api);await stopHttp();oldAccounts.resetRepositoryFactory();oldOrg.resetIdentityRepositoryFactory();
      });
      for(const binding of bindings)for(const parameter of binding.params)if(parameter.value!==null&&parameter.value!=='<undefined>')assert.equal(parameter.type,'string');save('binding-shapes.json',bindings);save('comparisons.json',comparisons);
    }finally{connection.release();}
  },{stage:'02',randomDatabase:true});passed=true;
  }catch(error){failure={code:error.code,message:error.message,stack:error.stack};throw error;
  }finally{await stopHttp();auth?.resetIdentityRepositoryFactory();org?.resetIdentityRepositoryFactory();accounts?.resetRepositoryFactory();
    let cleanup;if(target){const remaining=cp.execFileSync('docker',['ps','-aq','--filter','label=infomat.stage02='+target.owner],{env:isolatedEnvironment(),encoding:'utf8',windowsHide:true}).trim();assert.equal(remaining,'');cleanup={...target,cleaned:true,remaining:0,httpStops};save('resource-cleanup.json',cleanup);}
    for(const[key,value]of Object.entries(previousEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
    save('results.json',{passed,checks,failure,target,cleanup,comparisons,maintenance,formalDatabaseAccess:false,workerStarted:false,businessAccepted:false});
  }
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
