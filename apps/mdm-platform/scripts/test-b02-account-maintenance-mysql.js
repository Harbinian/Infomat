// B02 eight existing maintenance consumers. --output is a new artifacts folder;
// --baseline contains this dispatch's before snapshots. Only owned freshMysql
// tmpfs/UUID fixtures and loopback HTTP are used; no config files or formal IO.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),cp=require('node:child_process'),net=require('node:net');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const {identityInteger}=require('../server/sessionSubject');
const argument=name=>process.argv[process.argv.indexOf(name)+1];
const output=path.resolve(argument('--output')||''),baseline=path.resolve(argument('--baseline')||'');
assert(process.argv.includes('--output')&&output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output));
assert(process.argv.includes('--baseline')&&fs.existsSync(path.join(baseline,'apps__mdm-platform__server__governanceAccessMysqlRepository.js')));
fs.mkdirSync(output,{recursive:true});const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
function load(relative,before=false,helpers=true){const filename=path.resolve(__dirname,'../'+relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  const file=before?path.join(baseline,('apps/mdm-platform/'+relative).replaceAll('/','__')):filename;
  mod._compile(fs.readFileSync(file,'utf8')+(helpers?'\nmodule.exports.testHelpers={getActiveDepartment,getAccountRecord,listRoleAssignments,countActiveAdmins,grantRoleAssignment,writeAccessEvent};':''),filename);return mod.exports;}
const current=load('server/governanceAccessMysqlRepository.js'),prior=load('server/governanceAccessMysqlRepository.js',true);
const identity=require('../server/identityMysqlRepository'),system=require('../server/systemAdminIdentity');
const checks=[],comparisons=[],traces=[],httpStops=[],lockEvidence=[],preciseInsertEvidence=[];
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare=(name,now,old)=>{assert.deepEqual(now,old,name);comparisons.push({name,equal:true,sha256:hash(now),beforeSha256:hash(old)});};
const check=async(name,action)=>{await action();checks.push(name);console.log('PASS '+name);save('progress.json',{checks});};
const D0='9007199254741000',D1='9007199254741001',P0='9007199254741200',P1='9007199254741201',A0='9007199254741300',A1='9007199254741301',V0='9007199254741400',V1='9007199254741401';
const R0='9007199254741500',R1='9007199254741501',G0='9007199254741600',G1='9007199254741601',E0='9007199254741700';
const today='2026-01-01',assignment=(code='mdm_lead',dept)=>({roleCode:code,scopeDepartmentId:dept,authorizationBasis:'B02 synthetic evidence',effectiveFrom:today});
const people=[{id:81,account:181,dept:91,roles:['mdm_lead','data_conflict_handler']},{id:82,account:182,dept:91,roles:['admin']},
  {id:83,account:183,dept:91,roles:['admin','department_contact']},{id:84,account:184,dept:91,roles:[]},{id:85,account:185,dept:92,roles:['department_contact']},
  {id:86,dept:null,roles:[]},{id:87,dept:91,roles:[]},{id:88,account:188,dept:91,roles:['mdm_lead'],status:'pending_activation'},
  {id:89,account:189,dept:91,roles:['mdm_lead'],status:'disabled'},{id:90,account:190,dept:91,roles:['department_contact']}];
const session=p=>({personId:p.id,accountId:p.account,authVersion:p.version||1});
let target,server,auth,accounts,passed=false,failure;
const previousEnv={MDM_IDENTITY_READ_MODEL:process.env.MDM_IDENTITY_READ_MODEL,MDM_SYSTEM_ADMIN_ENABLED:process.env.MDM_SYSTEM_ADMIN_ENABLED};
const portClosed=port=>new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.on('connect',()=>{socket.destroy();resolve(false);});socket.on('error',error=>resolve(error.code==='ECONNREFUSED'));});
async function stopHttp(){if(!server)return;const port=server.address().port;await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));server=null;assert(await portClosed(port));httpStops.push({owner:target.owner,port,stopped:true,connectionRefused:true});}
const scalar=async(db,sql,params=[])=>{const [rows]=await db.execute(sql,params);return rows[0];};
async function physical(db){const result={};for(const [table,ids]of Object.entries({person:['person_id','current_department_id'],user_accounts:['account_id','person_id','auth_version'],person_roles:['person_role_id','person_id','role_id','scope_department_id','assigned_by_person_id','revoked_by_person_id'],identity_access_events:['event_id','actor_person_id','target_person_id','account_id','person_role_id'],system_admin_events:['event_id','actor_account_id','identity_event_id','target_person_id']})){
  const [rows]=await db.execute('SELECT *,'+ids.map(id=>'CAST('+id+' AS CHAR) AS '+id).join(',')+' FROM '+table+' ORDER BY 1');
  result[table]=rows.map(row=>{const copy={...row};delete copy.password_hash;return copy;});}return result;}
async function attempt(connection,factory,name,args,{systemActor,failAt,roundInsertMetadata=false}={}){
  const trace=[],insertIds=[];let state;
  const db=new Proxy(connection,{get(target,key){
    if(key==='execute')return async(sql,params=[])=>{const entry={connectionId:target.connection.threadId,sql,params:params.map((v,i)=>/password_hash/.test(sql)&&typeof v==='string'&&v.startsWith('synthetic-')?'<synthetic-credential>':v)};trace.push(entry);
      if(failAt&&sql.includes(failAt))throw Object.assign(Error('B02 injected audit failure'),{code:'B02_AUDIT_FAILURE'});
      const result=await target.execute(sql,params);if(/INSERT INTO (person|user_accounts|identity_access_events)\s*\(/.test(sql)){
        const driverInsertId=result[0].insertId,suppliedInsertId=roundInsertMetadata?Number(driverInsertId):driverInsertId;
        insertIds.push({connectionId:target.connection.threadId,table:sql.match(/INSERT INTO (\w+)/)[1],driverInsertId,type:typeof driverInsertId,suppliedInsertId,explicitRoundedMetadataInjection:roundInsertMetadata});
        if(roundInsertMetadata)result[0].insertId=suppliedInsertId;
      }return result;};
    if(key==='beginTransaction')return async()=>{trace.push({transaction:'begin'});await target.beginTransaction();};
    if(key==='commit')return async()=>{state=await physical(target);trace.push({transaction:'commit-request-rolled-back'});await target.rollback();};
    if(key==='rollback')return async()=>{trace.push({transaction:'rollback'});await target.rollback();};
    if(key==='release')return()=>{};return typeof target[key]==='function'?target[key].bind(target):target[key];}});
  let repo=factory({getConnection:async()=>db});if(systemActor)repo=repo.forSystemAdmin(systemActor);
  let result,error;try{result=await repo[name](...args);}catch(e){error={statusCode:e.statusCode,code:e.code,message:e.message};}
  return{result,error,state,trace,insertIds};
}
function generatedNormalized(run,before){
  const mappings={};for(const [table,key]of Object.entries({person:'person_id',user_accounts:'account_id',person_roles:'person_role_id',identity_access_events:'event_id',system_admin_events:'event_id'})){
    const existing=new Set(before[table].map(row=>row[key]));mappings[table]=new Map((run.state?.[table]||[]).filter(row=>!existing.has(row[key])).map((row,index)=>[String(row[key]),'generated-'+table+'-'+index]));
  }
  const tables={person_id:'person',actor_person_id:'person',target_person_id:'person',assignedByPersonId:'person',assigned_by_person_id:'person',revoked_by_person_id:'person',account_id:'user_accounts',assignmentId:'person_roles',person_role_id:'person_roles',identity_event_id:'identity_access_events'};
  const visit=(value,context)=>{
    if(value instanceof Date)return value;
    if(Array.isArray(value))return value.map(item=>visit(item,context));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>{
      const table=key==='event_id'?(context==='system_admin_events'?context:'identity_access_events'):tables[key];
      const generated=table&&mappings[table].get(String(v));
      return[key,generated?{generated,type:typeof v}:visit(v,Object.hasOwn(mappings,key)?key:context)];
    }));return value;
  };return visit(run);
}
async function main(){process.env.MDM_IDENTITY_READ_MODEL='mysql';process.env.MDM_SYSTEM_ADMIN_ENABLED='1';
  try{await withFreshMysql(async({pool,owner,database,containerId,port})=>{
    target={owner,database,containerId,port};save('owned-target.json',target);const ident=identity.makeIdentityMysqlRepository(pool);await ident.initSchema();const policyConnection=await pool.getConnection();try{await require('../server/departmentAccountabilityMigration').applyDepartmentAccountabilityPolicy(policyConnection);}finally{policyConnection.release();}
    const setup=await pool.getConnection();try{await require('../server/systemAdminMigration').applySystemAdmin(setup);}finally{setup.release();}
    for(const id of [91,92])await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)',[String(id),'D'+id,'Dept'+id]);
    const seed=async p=>{await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id,status) VALUES (?,?,?,?,'active')",[String(p.id),'P'+p.id,'Person'+p.id,p.dept==null?null:String(p.dept)]);
      if(p.account)await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (?,?,?,'synthetic-unused',?,0,?)",[String(p.account),String(p.id),'P'+p.id,p.status||'active',String(p.version||1)]);
      for(const code of p.roles)await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,'B02 synthetic evidence',? FROM roles WHERE role_code=?",[String(p.id),['department_contact','department_mdm_reviewer'].includes(code)?'department':'global',['department_contact','department_mdm_reviewer'].includes(code)?String(p.dept):null,today,code]);};
    for(const p of people)await seed(p);
    await pool.execute("INSERT INTO system_admin_accounts(account_id,login_name,password_hash,account_status,must_change_password,auth_version,authorization_basis) VALUES ('1','admin','synthetic-unused','active',0,1,'B02 synthetic')");
    const ordinarySystem={identityKind:'system_admin',identityRef:'system-admin:1',accountId:1,authVersion:1,personId:null};
    const connection=await pool.getConnection();try{
      const clock=await scalar(connection,'SELECT UNIX_TIMESTAMP() AS now');await connection.execute('SET timestamp=?',[clock.now]);
      await check('unchanged maintenance retains baseline behavior; account creation and legacy PATCH enforce the directory boundary',async()=>{
        const role=(await current.testHelpers.listRoleAssignments(connection,81,true)).find(r=>r.roleCode==='data_conflict_handler');
        const cases=[['createAccount',[{loginName:'P87new',employeeNo:'P87',name:'Person87',departmentId:91,pendingPasswordHash:'synthetic-pending',roleAssignments:[assignment()],actorPersonId:82}]],
          ['createAccount',[{loginName:'New',employeeNo:'New',name:'New Person',departmentId:91,pendingPasswordHash:'synthetic-pending',roleAssignments:[assignment()],actorPersonId:82}]],
          ['updateAccount',[81,{name:'Changed',actorPersonId:82}]],['updateAccount',[86,{name:'No Department',departmentId:null,actorPersonId:82}]],['updateAccount',[90,{departmentId:92,changeReason:'Move',roleAssignments:[assignment('department_contact',92)],actorPersonId:82}]],
          ['grantRole',[81,{...assignment('mdm_lead'),actorPersonId:82}]],['revokeRole',[81,role.assignmentId,{reason:'B02 synthetic',actorPersonId:82}]],
          ['activateAccount',[88,{passwordHash:'synthetic-activate',actorPersonId:82}]],['enableAccount',[89,{actorPersonId:82}]],['enableAccount',[81,{actorPersonId:82}]],
          ['disableAccount',[81,{reason:'B02 synthetic',actorPersonId:82}]],['resetPassword',[81,{passwordHash:'synthetic-reset',actorPersonId:82}]],
          ['createAccount',[{}]],['createAccount',[{loginName:'P81',employeeNo:'P81',name:'Wrong',departmentId:91,pendingPasswordHash:'synthetic-pending',roleAssignments:[assignment()]}]],
          ['updateAccount',[991,{name:'Missing'}]],['updateAccount',[81,{departmentId:92}]],['updateAccount',[81,{departmentId:92,changeReason:'Move'}]],
          ['grantRole',[81,{...assignment(),authorizationBasis:''}]],['grantRole',[81,assignment('department_contact',92)]],['grantRole',[81,assignment('invented')]],
          ['grantRole',[81,{...assignment(),effectiveTo:'2000-01-01'}]],['revokeRole',[81,991,{reason:'missing'}]],['revokeRole',[81,role.assignmentId,{}]],
          ['activateAccount',[81,{passwordHash:'synthetic'}]],['activateAccount',[88,{}]],['enableAccount',[88,{}]],['disableAccount',[81,{}]],['resetPassword',[81,{}]]];
        for(const systemActor of [undefined,ordinarySystem])for(const [name,args]of cases){const beforeState=await physical(connection),now=await attempt(connection,current.makeGovernanceAccessMysqlRepository,name,args,{systemActor});
          if(name==='createAccount'||name==='updateAccount'){
            if(name==='createAccount'){
              const input=args[0],person=beforeState.person.find(row=>row.employee_no===input.employeeNo);
              const expected=!input.employeeNo?'ACCOUNT_REQUIRED_FIELDS_MISSING':!person?'PERSON_DIRECTORY_RECORD_REQUIRED':input.name!==person.person_name?'PERSON_IDENTITY_MISMATCH':null;
              if(expected)assert.equal(now.error?.code,expected);else{assert.equal(now.error,undefined);assert.equal(String(now.result.person_id),person.person_id);assert.equal(now.result.account_status,'pending_activation');assert.deepEqual(now.state.person,beforeState.person);}
            }else{assert.equal(now.error?.code,args[0]===991?'ACCOUNT_NOT_FOUND':'PERSON_DIRECTORY_MAINTENANCE_REQUIRED');}
            compare('directory-boundary-rolled-back-'+traces.length,await physical(connection),beforeState);assert(!now.trace.some(entry=>/^\s*(?:INSERT INTO|UPDATE|DELETE FROM) person\b/.test(entry.sql||'')));
            traces.push({name,args,system:Boolean(systemActor),current:now.trace,behavior:'directory-boundary'});continue;
          }
          const old=await attempt(connection,prior.makeGovernanceAccessMysqlRepository,name,args,{systemActor});
          const summary=run=>generatedNormalized({result:run.result,error:run.error,state:run.state},beforeState);compare((systemActor?'system-':'person-')+name+'-'+comparisons.length,summary(now),summary(old));
          compare('rolled-back-'+comparisons.length,await physical(connection),beforeState);
          assert.deepEqual(now.trace.filter(e=>e.transaction).map(e=>e.transaction),old.trace.filter(e=>e.transaction).map(e=>e.transaction));traces.push({name,args:args.map(arg=>arg&&typeof arg==='object'?{...arg,pendingPasswordHash:arg.pendingPasswordHash?'<synthetic>':undefined,passwordHash:arg.passwordHash?'<synthetic>':undefined}:arg),system:Boolean(systemActor),current:now.trace,before:old.trace});
        }save('ordinary-equivalence.json',{comparisons,traces});
      });
      await check('default shared helpers and original account/role/audit GET projections remain before-equivalent',async()=>{
        const repo=current.makeGovernanceAccessMysqlRepository(connection),before=prior.makeGovernanceAccessMysqlRepository(connection);
        for(const method of ['listAccounts','listAccessEvents'])compare(method,await repo[method](),await before[method]());for(const p of people)compare('getAccount-'+p.id,await repo.getAccount(p.id),await before.getAccount(p.id));
        for(const method of ['getActiveDepartment','getAccountRecord','listRoleAssignments','countActiveAdmins'])for(const args of method==='getActiveDepartment'?[[91],[92]]:method==='listRoleAssignments'?[[81,true],[81,false]]:[[81]]){
          const trace=[],capture={async execute(sql,params){trace.push({sql,params});return connection.execute(sql,params);}};const old=await prior.testHelpers[method](capture,...args),oldTrace=trace.splice(0),now=await current.testHelpers[method](capture,...args);compare('default-'+method,now,old);compare('default-sql-'+method,trace,oldTrace);
        }
        const helpersFactory=implementation=>ownedPool=>({async exercise(){const db=await ownedPool.getConnection();try{await db.beginTransaction();const granted=await implementation.testHelpers.grantRoleAssignment(db,81,implementation.validateRoleAssignmentInput(assignment(),91),82);await implementation.testHelpers.writeAccessEvent(db,{eventType:'role_assigned',actorPersonId:82,targetPersonId:81,accountId:181,personRoleId:granted.personRoleId,reason:'default helper'});await db.commit();return granted;}catch(error){await db.rollback();throw error;}finally{db.release();}}});
        const old=await attempt(connection,helpersFactory(prior),'exercise',[]),now=await attempt(connection,helpersFactory(current),'exercise',[]);compare('default-grant-role-return',now.result,old.result);
        const oldSql=old.trace.filter(t=>t.sql),nowSql=now.trace.filter(t=>t.sql);compare('default-grant-and-event-sql',nowSql,oldSql);
      });
      await connection.execute('SET timestamp=0');
    }finally{connection.release();}
    for(const id of [D0,D1])await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)',[id,'D'+id,'Dept'+id]);
    // Move two existing fixed roles and their original permissions, only in the
    // synthetic fixture. No role, permission or product schema is introduced.
    for(const [code,id]of [['department_contact',R0],['department_mdm_reviewer',R1]]){const row=await scalar(pool,'SELECT CAST(role_id AS CHAR) AS id FROM roles WHERE role_code=?',[code]);await pool.execute('UPDATE role_permissions SET role_id=? WHERE role_id=?',[id,row.id]);await pool.execute('UPDATE person_roles SET role_id=? WHERE role_id=?',[id,row.id]);await pool.execute('UPDATE roles SET role_id=? WHERE role_id=?',[id,row.id]);}
    const big=[{id:P0,account:A0,dept:D0,version:V0,roles:['mdm_lead']},{id:P1,account:A1,dept:D1,version:V1,roles:['mdm_lead']}];for(const p of big)await seed(p);
    for(const [id,p,r,d]of [[G0,P0,R0,D0],[G1,P1,R1,D1]])await pool.execute("INSERT INTO person_roles(person_role_id,person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) VALUES (?,?,?,'department',?,'B02 synthetic evidence',?)",[id,p,r,d,today]);
    await pool.execute('UPDATE system_admin_accounts SET account_id=?,auth_version=? WHERE account_id=1',[A1,V1]);
    await pool.execute("INSERT INTO identity_access_events(event_id,event_type,reason,payload_json) VALUES (?,'account_created','keep',?)",[E0,JSON.stringify({historical_id:P1,unknown:[null,'kept'],number:9007199254740992})]);
    const systemActor={identityKind:'system_admin',identityRef:'system-admin:'+A1,accountId:A1,authVersion:V1,personId:null};
    const bindingTrace=[];
    const observedPool=new Proxy(pool,{get(target,key){if(key==='getConnection')return async()=>{const connection=await target.getConnection();return new Proxy(connection,{get(db,property){if(property==='execute')return async(sql,params=[])=>{const result=await db.execute(sql,params);bindingTrace.push({sql,params,connectionId:db.connection.threadId,rows:Array.isArray(result[0])?result[0].map(row=>({person_id:row.person_id,account_id:row.account_id,auth_version:row.auth_version})):undefined});save('binding-diagnostic.json',bindingTrace);return result;};return typeof db[property]==='function'?db[property].bind(db):db[property];}});};return typeof target[key]==='function'?target[key].bind(target):target[key];}});
    const repo=current.makeGovernanceAccessMysqlRepository(observedPool);
    save('fixture-precise-state.json',await physical(pool));
    await check('adjacent BIGINT targets and actors/roles/departments/auth generations survive real prepared reuse and invalid identities never alias',async()=>{
      for(const p of [big[0],big[1],people[0],big[1],people[0],big[0]]){const other=p.id===P1?P0:P1,beforeOther=await repo.getAccount(other),version=BigInt((await repo.getAccount(p.id)).auth_version);await assert.rejects(repo.updateAccount(p.id,{name:'Edited'+p.id,actorPersonId:P1}),{code:'PERSON_DIRECTORY_MAINTENANCE_REQUIRED'});const unchanged=await repo.updateAccount(p.id,{name:'Person'+p.id,actorPersonId:P1});assert.equal(String(unchanged.auth_version),version.toString());const now=await repo.resetPassword(p.id,{passwordHash:'synthetic-precise-reset',actorPersonId:P1});assert.equal(now.person_id,p.id);assert.equal(now.account_id,p.account);assert.equal(String(now.auth_version),(version+1n).toString());compare('neighbour-unmodified-'+p.id,await repo.getAccount(other),beforeOther);}
      for(const [p,dept,code,role]of [[P0,D0,'department_contact',R0],[P1,D1,'department_mdm_reviewer',R1],[P0,D0,'department_contact',R0]]){const granted=await repo.grantRole(p,{...assignment(code,dept),...(code==='department_mdm_reviewer'?{expectedFinalResponsiblePersonId:(await scalar(pool,'SELECT CAST(final_responsible_person_id AS CHAR) person_id FROM departments WHERE id=?',[dept])).person_id}:{}),actorPersonId:P1});assert.equal(granted.assignmentId,p===P0?G0:G1);assert.equal(granted.scopeDepartmentId,dept);assert.equal(granted.assignedByPersonId,code==='department_mdm_reviewer'?null:P1);const row=await scalar(pool,'SELECT CAST(role_id AS CHAR) AS id FROM person_roles WHERE person_role_id=CAST(? AS SIGNED)',[String(granted.assignmentId)]);assert.equal(row.id,role);}
      const snapshot=await physical(pool);for(const invalid of [Number(P1),'81oops','system-admin:81',{},'9223372036854775808',0,-1,null])for(const method of ['updateAccount','grantRole','revokeRole','activateAccount','enableAccount','disableAccount','resetPassword']){
        const args=method==='revokeRole'?[invalid,G0,{reason:'invalid'}]:[invalid,{reason:'invalid',passwordHash:'synthetic-reset',...assignment()}];await assert.rejects(repo[method](...args),{code:'ACCOUNT_NOT_FOUND'});
      }await assert.rejects(repo.revokeRole(P0,Number(G1),{reason:'rounded'}),{code:'ROLE_ASSIGNMENT_NOT_FOUND'});
      await assert.rejects(repo.grantRole(P0,assignment('department_contact',D1)),{code:'ROLE_SCOPE_DEPARTMENT_MISMATCH'});await assert.rejects(repo.grantRole(P0,assignment('department_contact',Number(D1))),{code:'ROLE_SCOPE_DEPARTMENT_MISMATCH'});
      await assert.rejects(repo.updateAccount(P0,{actorPersonId:Number(P1)}),{code:'INVALID_ACTOR_PERSON_ID'});
      await assert.rejects(repo.createAccount({loginName:'invalid',employeeNo:'invalid',name:'invalid',departmentId:Number(D1),pendingPasswordHash:'synthetic-pending',roleAssignments:[assignment()]}),{code:'ACCOUNT_REQUIRED_FIELDS_MISSING'});
      compare('invalid-writes-no-changes',await physical(pool),snapshot);
      await repo.revokeRole(P1,G1,{reason:'revoke exact',actorPersonId:P0});assert.deepEqual(await repo.revokeRole(P1,G1,{reason:'idempotent'}),{revoked:true,idempotent:true});
      const beforeMove=await repo.getAccount(P0);await assert.rejects(repo.updateAccount(P0,{departmentId:D1,changeReason:'exact department move',roleAssignments:[assignment('department_contact',D1)],actorPersonId:P1}),{statusCode:409,code:'PERSON_DIRECTORY_MAINTENANCE_REQUIRED'});compare('directory-move-rejected-with-original-roles',await repo.getAccount(P0),beforeMove);
      const events=await repo.listAccessEvents({personId:P0});assert(events.some(e=>e.actor_person_id===P1&&e.target_person_id===P0&&e.account_id===A0&&e.person_role_id===G0));
      save('bigint-maintenance.json',{accounts:await repo.listAccounts(),events:await repo.listAccessEvents()});
    });
    await check('existing precise person identity is retained; account/assignment/event inserts reject rounded driver metadata',async()=>{
      const connection=await pool.getConnection();try{
        for(const existing of [false,true]){if(existing)await seed({id:'9007199254741251',dept:D1,roles:[]});
          const payload={loginName:'Created'+existing,employeeNo:existing?'P9007199254741251':'CreatedNew',name:existing?'Person9007199254741251':'Created Person',departmentId:D1,roleAssignments:[assignment('department_contact',D1)],pendingPasswordHash:'synthetic-pending',actorPersonId:null};
          const before=await physical(connection),run=await attempt(connection,current.makeGovernanceAccessMysqlRepository,'createAccount',[payload],{systemActor,roundInsertMetadata:true});
          if(!existing){assert.equal(run.error?.code,'PERSON_DIRECTORY_RECORD_REQUIRED');assert.deepEqual(await physical(connection),before);assert.equal(run.insertIds.length,0);preciseInsertEvidence.push({existing:false,error:run.error,directoryUnchanged:true});continue;}
          assert.equal(run.error,undefined);const created=run.result;assert.equal(typeof created.person_id,'string');assert.equal(typeof created.account_id,'string');assert.equal(created.current_department_id,D1);assert.equal(created.roleAssignments[0].scopeDepartmentId,D1);assert.deepEqual(run.state.person,before.person);
          const person=run.state.person.find(p=>p.employee_no===payload.employeeNo),account=run.state.user_accounts.find(a=>a.login_name===payload.loginName),roles=run.state.person_roles.filter(r=>r.person_id===person.person_id),events=run.state.identity_access_events.filter(e=>e.target_person_id===person.person_id),systemEvents=run.state.system_admin_events.filter(e=>e.target_person_id===person.person_id);
          assert.equal(created.person_id,person.person_id);assert.equal(created.account_id,account.account_id);assert.equal(created.roleAssignments[0].assignmentId,roles[0].person_role_id);assert.equal(roles[0].role_id,R0);
          assert.deepEqual(events.map(e=>e.event_type),['account_created','role_assigned']);assert(events.every(e=>e.actor_person_id===null&&e.account_id===account.account_id));assert.equal(events[1].person_role_id,roles[0].person_role_id);assert.equal(systemEvents.length,2);
          assert(systemEvents.every(e=>e.actor_account_id===A1&&events.some(event=>event.event_id===e.identity_event_id)));assert(run.insertIds.some(e=>typeof e.suppliedInsertId==='number'&&!Number.isSafeInteger(e.suppliedInsertId)));
          const localReads=run.trace.filter(t=>/LAST_INSERT_ID/.test(t.sql));assert.equal(localReads.length,3);assert(run.trace.filter(t=>t.sql).every(t=>t.connectionId===connection.connection.threadId));
          assert.equal((await repo.listAccounts()).find(p=>p.login_name===payload.loginName),undefined);preciseInsertEvidence.push({existing,created,person,account,roles,events,systemEvents,localReads,driverMetadata:run.insertIds});
        }save('precise-insert-associations.json',preciseInsertEvidence);
      }finally{connection.release();}
    });
    await check('adjacent BIGINT activation/disable/enable/password success paths touch only exact accounts and preserve event/generation types',async()=>{
      for(const personId of [P0,P1,P0,P1]){const other=personId===P0?P1:P0,beforeOther=await repo.getAccount(other);
        await pool.execute("UPDATE user_accounts SET account_status='pending_activation' WHERE person_id=CAST(? AS SIGNED)",[personId]);
        for(const [method,payload]of [['activateAccount',{passwordHash:'synthetic-big-activate'}],['disableAccount',{reason:'synthetic big disable'}],['enableAccount',{}],['resetPassword',{passwordHash:'synthetic-big-reset'}]]){
          const before=await repo.getAccount(personId),result=await repo[method](personId,{...payload,actorPersonId:other});assert.equal(result.person_id,personId);assert.equal(result.account_id,personId===P0?A0:A1);assert.equal(typeof result.auth_version,'string');assert.equal(BigInt(result.auth_version),BigInt(before.auth_version)+1n);compare('exact-neighbour-'+method+personId,await repo.getAccount(other),beforeOther);
        }
      }
    });
    await check('seven writing operations roll back audit failures; legacy PATCH remains read-only',async()=>{
      await pool.execute("INSERT INTO person(employee_no,person_name,current_department_id) VALUES ('Rollback','Rollback',?)",[D1]);
      const connection=await pool.getConnection();try{
        const inputs=[['createAccount',[{loginName:'Rollback',employeeNo:'Rollback',name:'Rollback',departmentId:D1,pendingPasswordHash:'synthetic-pending',roleAssignments:[assignment()]}]],
          ['grantRole',[P1,assignment('department_contact',D1)]],['revokeRole',[P0,G0,{reason:'rollback'}]],['activateAccount',[88,{passwordHash:'synthetic'}]],['enableAccount',[89,{}]],['disableAccount',[P1,{reason:'rollback'}]],['resetPassword',[P1,{passwordHash:'synthetic'}]]];
        for(const [name,args]of inputs)for(const failAt of ['INSERT INTO identity_access_events','INSERT INTO system_admin_events']){const before=await physical(connection),run=await attempt(connection,current.makeGovernanceAccessMysqlRepository,name,args,{systemActor,failAt});assert.equal(run.error?.code,'B02_AUDIT_FAILURE',name+failAt);compare('audit-rollback-'+name+failAt,await physical(connection),before);assert(run.trace.some(t=>t.transaction==='rollback'));}
        const before=await physical(connection),unchanged=await attempt(connection,current.makeGovernanceAccessMysqlRepository,'updateAccount',[P1,{name:'Person'+P1}],{systemActor,failAt:'INSERT INTO identity_access_events'});assert.equal(unchanged.error,undefined);assert.deepEqual(unchanged.state,before);assert(!unchanged.trace.some(entry=>/^\s*(INSERT|UPDATE|DELETE)/.test(entry.sql||'')));
      }finally{connection.release();}
    });
    await check('last effective administrator and last effective role protection, status gates and idempotence retain original errors',async()=>{
      const db=await pool.getConnection();try{await db.beginTransaction();await db.execute("UPDATE user_accounts SET account_status='disabled' WHERE person_id=83");const isolated=current.makeGovernanceAccessMysqlRepository({execute:db.execute.bind(db),async getConnection(){return new Proxy(db,{get(target,key){if(key==='release')return()=>{};if(key==='beginTransaction'||key==='rollback'||key==='commit')return async()=>{};return typeof target[key]==='function'?target[key].bind(target):target[key];}});}});
        const admin=(await repo.getAccount(82)).roleAssignments.find(r=>r.roleCode==='admin');await assert.rejects(isolated.disableAccount(82,{reason:'last'}),{code:'LAST_ACTIVE_ADMIN'});await assert.rejects(isolated.revokeRole(82,admin.assignmentId,{reason:'last'}),{code:'LAST_ACTIVE_ADMIN'});
        const last=(await repo.getAccount(90)).roleAssignments.find(r=>r.roleCode==='department_contact');await assert.rejects(isolated.revokeRole(90,last.assignmentId,{reason:'last'}),{code:'LAST_ACTIVE_ROLE_REQUIRES_DISABLE'});assert.deepEqual(await isolated.revokeRole(90,last.assignmentId,{reason:'last',disableAccount:true}),{revoked:true,idempotent:false});assert.equal((await isolated.getAccount(90)).account_status,'disabled');assert.deepEqual(await isolated.revokeRole(90,last.assignmentId,{reason:'again',disableAccount:true}),{revoked:true,idempotent:true});
        await isolated.disableAccount(P1,{reason:'disabled'});assert.equal((await isolated.disableAccount(P1,{reason:'again'})).idempotent,true);assert.equal((await isolated.enableAccount(P1)).account_status,'active');assert.equal((await isolated.enableAccount(P1)).idempotent,true);
        await assert.rejects(isolated.enableAccount(88),{code:'ACCOUNT_REQUIRES_ACTIVATION'});assert.equal((await isolated.activateAccount(88,{passwordHash:'synthetic'})).must_change_password,1);await assert.rejects(isolated.activateAccount(88,{passwordHash:'synthetic'}),{code:'ACCOUNT_NOT_PENDING_ACTIVATION'});
      }finally{await db.rollback();db.release();}
    });
    await check('original eight HTTP writes preserve person/admin/overlay/unauthorized/cross-department/CSRF/password gates and exact system audit',async()=>{
      await pool.execute('UPDATE user_accounts SET must_change_password=0 WHERE person_id=CAST(? AS SIGNED)',[P1]);
      for(const p of [...people,...big].filter(p=>p.account))p.version=(await repo.getAccount(p.id)).auth_version;
      auth=require('../server/auth');accounts=require('../server/routes/accounts');auth.setIdentityRepositoryFactory(()=>ident);accounts.setRepositoryFactory(()=>repo);
      const express=require('express'),security=require('../server/security'),app=express();app.use(express.json());
      app.use(async(req,res,next)=>{try{const id=req.headers['x-b02-person'];if(id==='system')req.session={identityKind:'system_admin',accountId:A1,authVersion:V1};else{const p=[...people,...big].find(p=>String(p.id)===id);req.session=p?session(p):{};}req.session.csrfSecret='synthetic-csrf';req.session.destroy=done=>done();next();}catch(error){next(error);}});
      const beforeAccounts=load('server/routes/accounts.js',true,false);beforeAccounts.setRepositoryFactory(()=>prior.makeGovernanceAccessMysqlRepository(pool));
      app.use(security.csrfProtection);app.use('/api/org/accounts',accounts);app.use('/before/accounts',beforeAccounts);server=await new Promise(resolve=>{const owned=app.listen(0,'127.0.0.1',()=>resolve(owned));});save('owned-http.json',{owner,port:server.address().port,address:'127.0.0.1'});
      const call=async(actor,url,method,body,csrf=true)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/org/accounts'+url,{method,headers:{'content-type':'application/json','x-b02-person':String(actor),...(csrf?{'X-CSRF-Token':'synthetic-csrf'}:{})},body:JSON.stringify(body)});const result={status:response.status,body:await response.json()};if(result.body.initialPassword)result.body.initialPassword='<generated>';return result;};
      const role=(await repo.getAccount(81)).roleAssignments.find(r=>r.roleCode==='data_conflict_handler');
      await pool.execute("INSERT INTO person(employee_no,person_name,current_department_id) VALUES ('Http','Http',91)");
      const routes=[['','POST',{loginName:'Http',employeeNo:'Http',name:'Http',departmentId:91,roleAssignments:[assignment()]}],['/81','PATCH',{name:'Person81'}],['/81/role-assignments','POST',assignment()],['/81/role-assignments/'+role.assignmentId+'/revoke','POST',{reason:'HTTP revoke'}],['/88/activate','POST',{}],['/89/enable','POST',{}],['/81/disable','POST',{reason:'HTTP disable'}],['/81/reset-password','POST',{}]];
      const responses=[],httpAuditStates=[];
      for(const actor of [82,83,'system',84,85,'unknown'])for(const url of ['', '/81','/'+P0,'/'+P1,'/audit-events?personId='+P1]){
        const get=async prefix=>{const response=await fetch('http://127.0.0.1:'+server.address().port+prefix+url,{headers:{'x-b02-person':String(actor)}});return{status:response.status,body:await response.json()};};
        compare('original-GET-'+actor+url,await get('/api/org/accounts'),await get('/before/accounts'));
      }
      // Roll back allowed writes, keeping actor sessions and target states fixed.
      const connection=await pool.getConnection();try{const rolledPool={async getConnection(){return new Proxy(connection,{get(target,key){if(key==='commit')return async()=>{httpAuditStates.push(await physical(target));await target.rollback();};if(key==='release')return()=>{};return typeof target[key]==='function'?target[key].bind(target):target[key];}});}};accounts.setRepositoryFactory(()=>current.makeGovernanceAccessMysqlRepository(rolledPool));
        for(const actor of [81,82,83,84,85,'system','unknown'])for(const [url,method,body]of routes){const result=await call(actor,url,method,body);const expected=actor===82||actor===83||actor==='system'?(url===''||url.endsWith('role-assignments')?201:200):actor==='unknown'?401:403;assert.equal(result.status,expected,actor+url);responses.push({actor,url,method,status:result.status,code:result.body.code});}
        for(const [url,method,body]of routes){assert.equal((await call(82,url,method,body,false)).status,403);}
        for(const actor of [82,83,'system']){await pool.execute('UPDATE '+(actor==='system'?'system_admin_accounts':'user_accounts')+' SET must_change_password=1 WHERE account_id=?',[String(actor==='system'?A1:100+actor)]);for(const [url,method,body]of routes){const result=await call(actor,url,method,body);assert.equal(result.status,403);assert.equal(result.body.code,'PASSWORD_CHANGE_REQUIRED');}await pool.execute('UPDATE '+(actor==='system'?'system_admin_accounts':'user_accounts')+' SET must_change_password=0 WHERE account_id=?',[String(actor==='system'?A1:100+actor)]);}
        for(const actor of [82,'system']){const rejected=await call(actor,'/'+P1,'PATCH',{name:'HTTP exact'});assert.equal(rejected.status,409);assert.equal(rejected.body.code,'PERSON_DIRECTORY_MAINTENANCE_REQUIRED');const exact=await call(actor,'/'+P1,'PATCH',{name:'Person'+P1});assert.equal(exact.status,200);assert.equal(exact.body.person_id,P1);assert.equal(exact.body.account_id,A1);const grant=await call(actor,'/'+P1+'/role-assignments','POST',{...assignment('department_mdm_reviewer',D1),expectedFinalResponsiblePersonId:(await scalar(pool,'SELECT CAST(final_responsible_person_id AS CHAR) person_id FROM departments WHERE id=?',[D1])).person_id});assert.equal(grant.status,201);assert.equal(grant.body.assignmentId,G1);assert.equal(grant.body.scopeDepartmentId,D1);}
        const bigActor=await scalar(pool,'SELECT CAST(role_id AS CHAR) AS id FROM roles WHERE role_code=\'admin\'');await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) VALUES (?,?,'global','synthetic',?)",[P1,bigActor.id,today]);
        // BIGINT actor session uses the current generation, supplied separately.
        big[1].version=(await repo.getAccount(P1)).auth_version;const actorResult=await call(P1,'/'+P0+'/reset-password','POST',{});assert.equal(actorResult.status,200);
        assert(httpAuditStates.at(-1).identity_access_events.some(e=>e.event_type==='password_reset'&&e.actor_person_id===P1&&e.target_person_id===P0&&e.account_id===A0));
        assert(httpAuditStates.some(state=>state.system_admin_events.some(event=>event.actor_account_id===A1&&state.identity_access_events.some(e=>e.event_id===event.identity_event_id&&e.actor_person_id===null))));
        for(const id of ['81oops','system-admin:81','9223372036854775808'])assert.equal((await call(82,'/'+id,'PATCH',{})).body.code,'ACCOUNT_NOT_FOUND');
        save('http-results.json',responses);save('http-audit-states.json',httpAuditStates);
      }finally{accounts.setRepositoryFactory(()=>repo);beforeAccounts.resetRepositoryFactory();connection.release();}await stopHttp();
    });
    await check('actual system-admin lock waits then disabled status or changed password generation reject maintenance with complete rollback',async()=>{
      for(const change of ['disabled','generation']){await pool.execute("UPDATE system_admin_accounts SET account_status='active',must_change_password=0,auth_version=? WHERE account_id=?",[V1,A1]);
        const before=await physical(pool),blocker=await pool.getConnection(),trace=[];let pending;
        const observed=new Proxy(pool,{get(target,key){if(key==='getConnection')return async()=>{const connection=await target.getConnection();return new Proxy(connection,{get(db,property){if(property==='execute')return async(sql,params=[])=>{const entry={connectionId:db.connection.threadId,protectedLock:/FROM system_admin_accounts.*FOR SHARE/s.test(sql),finished:false};trace.push(entry);try{return await db.execute(sql,params);}finally{entry.finished=true;}};return typeof db[property]==='function'?db[property].bind(db):db[property];}});};return typeof target[key]==='function'?target[key].bind(target):target[key];}});
        try{await blocker.beginTransaction();await blocker.execute('SELECT CAST(account_id AS CHAR) AS id FROM system_admin_accounts WHERE account_id=CAST(? AS SIGNED) FOR UPDATE',[A1]);
          pending=current.makeGovernanceAccessMysqlRepository(observed).forSystemAdmin(systemActor).resetPassword(P0,{passwordHash:'synthetic-lock'}).then(result=>({allowed:true,result}),error=>({error}));
          let waits=[];const deadline=Date.now()+12000;while(Date.now()<deadline){const [rows]=await pool.query(`SELECT r.ENGINE_TRANSACTION_ID requesting_transaction,b.ENGINE_TRANSACTION_ID blocking_transaction,r.OBJECT_SCHEMA,r.OBJECT_NAME,r.LOCK_TYPE,r.LOCK_MODE,r.LOCK_STATUS FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID WHERE r.OBJECT_SCHEMA=? AND r.OBJECT_NAME='system_admin_accounts'`,[database]);if(rows.length){waits=rows;break;}await new Promise(resolve=>setTimeout(resolve,40));}
          assert(waits.length,'real MySQL system-account lock wait');assert(trace.some(t=>t.protectedLock&&!t.finished));
          if(change==='disabled')await blocker.execute("UPDATE system_admin_accounts SET account_status='disabled' WHERE account_id=CAST(? AS SIGNED)",[A1]);else await blocker.execute("UPDATE system_admin_accounts SET password_hash='synthetic-changed',auth_version=auth_version+1 WHERE account_id=CAST(? AS SIGNED)",[A1]);
          await blocker.commit();const result=await pending;assert.equal(result.error?.code,'SYSTEM_ADMIN_ACTOR_CHANGED');assert.equal(result.error.statusCode,401);compare('lock-wait-maintenance-rollback-'+change,await physical(pool),before);lockEvidence.push({change,waits,trace,error:{code:result.error.code,statusCode:result.error.statusCode},target:target});
        }finally{await blocker.rollback();blocker.release();if(pending)await pending;}
      }save('system-lock-waits.json',lockEvidence);
    });
    save('comparisons.json',comparisons);
  },{stage:'02',randomDatabase:true});passed=true;
  }catch(error){failure={code:error.code,message:error.message,stack:error.stack};throw error;
  }finally{await stopHttp();auth?.resetIdentityRepositoryFactory();accounts?.resetRepositoryFactory();
    let cleanup;if(target){const remaining=cp.execFileSync('docker',['ps','-aq','--filter','label=infomat.stage02='+target.owner],{env:isolatedEnvironment(),encoding:'utf8',windowsHide:true}).trim();assert.equal(remaining,'');cleanup={...target,cleaned:true,remaining:0,httpStops};save('resource-cleanup.json',cleanup);}
    for(const[key,value]of Object.entries(previousEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
    save('results.json',{passed,checks,failure,target,cleanup,lockEvidence,comparisons,formalDatabaseAccess:false,workerStarted:false,businesoRgaepted:false});
  }
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
