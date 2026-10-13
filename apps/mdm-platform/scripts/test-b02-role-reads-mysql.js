// Real owned tmpfs MySQL and loopback HTTP. --baseline is this dispatch's before
// snapshot; never load configuration, connect a default DB, or persist credentials.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),net=require('node:net'),Module=require('node:module');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const {makeIdentityMysqlRepository}=require('../server/identityMysqlRepository');
const {mdmMysqlSchemaSql,splitSqlStatements}=require('../server/mysqlSchema');
const {SCHEMA_SQL,MIGRATION_KEY}=require('../server/systemAdminMigration');
const {ACCESS_MODEL_VERSION}=require('../server/roleDefinitions');
const argument=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:null;
assert(argument('--output')&&argument('--baseline'));
const output=path.resolve(argument('--output')),baseline=path.resolve(argument('--baseline')),artifactRoot=path.resolve(__dirname,'../../../artifacts')+path.sep;
assert(output.startsWith(artifactRoot)&&baseline.startsWith(artifactRoot)&&!fs.existsSync(output));
fs.mkdirSync(output,{recursive:true});
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function original(relative) {
  const filename=path.resolve(__dirname,'..',relative),snapshot=path.join(baseline,('apps/mdm-platform/'+relative).replaceAll('/','__'));
  const source=fs.readFileSync(snapshot,'utf8'),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(source,filename);
  return {exports:mod.exports,sha256:hash(source)};
}
const beforeIdentity=original('server/identityMysqlRepository.js'),beforeRoles=original('server/routes/roles.js');
const R='9007199254741201',RN='9007199254741200',PR='9007199254741301',PRN='9007199254741300',G='9007199254741401',GN='9007199254741400';
const PM='9007199254741501',PMN='9007199254741500',P='9007199254741601',PN='9007199254741600',D='9007199254741701',DN='9007199254741700';
const checks=[],comparisons=[],requests=[],trace=[],stops=[];let target,server,connection,auth,roles,passed=false,failure;
const previousEnv={MDM_IDENTITY_READ_MODEL:process.env.MDM_IDENTITY_READ_MODEL,MDM_SYSTEM_ADMIN_ENABLED:process.env.MDM_SYSTEM_ADMIN_ENABLED};
const json=value=>JSON.parse(JSON.stringify(value));
const compare=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);comparisons.push({name,actual:json(actual),expected:json(expected),equal:true});};
async function refused(port){return await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.on('connect',()=>{socket.destroy();resolve(false);});socket.on('error',error=>resolve(error.code==='ECONNREFUSED'));});}
async function closeHttp(){if(!server)return;const port=server.address().port;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));server=null;assert(await refused(port));stops.push({owner:target.owner,port,closed:true,connectionRefused:true});}
async function physical(db){const state={};for(const table of ['roles','permissions','role_permissions','person_roles','person','departments'])state[table]=(await db.query('SELECT * FROM '+table+' ORDER BY 1'))[0];return hash(JSON.stringify(state));}
async function main(){process.env.MDM_IDENTITY_READ_MODEL='mysql';process.env.MDM_SYSTEM_ADMIN_ENABLED='1';
  try{await withFreshMysql(async({pool,owner,database,containerId,port})=>{
    target={owner,database,containerId,mysqlPort:port};save('owned-target.json',target);
    try {
    // Only the existing schema in a fresh UUID database, plus a local
    // unknown-column compatibility probe. No product DDL/migration is changed.
    const tables=['schema_migrations','departments','person','user_accounts','roles','permissions','role_permissions','person_roles'];
    for(const sql of splitSqlStatements(mdmMysqlSchemaSql()))if(tables.some(table=>sql.startsWith('CREATE TABLE IF NOT EXISTS '+table+' (')))await pool.execute(sql);
    connection=await pool.getConnection();
    const observed={async execute(sql,params=[]){const entry={sql,params,connectionId:connection.connection.threadId};trace.push(entry);try{return await connection.execute(sql,params);}catch(error){entry.error={code:error.code,message:error.message};throw error;}}};
    const current=makeIdentityMysqlRepository(observed),old=beforeIdentity.exports.makeIdentityMysqlRepository(connection);
    compare('empty role list',await current.listRoles(),await old.listRoles());
    for(const method of ['getRoleDetail','getRolePermissionMatrix'])compare('missing role '+method,await current[method](1),await old[method](1));
    for(const sql of splitSqlStatements(mdmMysqlSchemaSql()))await connection.execute(sql);
    await require('../server/identityMysqlRepository').ensureMysqlBuiltInRolesAndPermissions(connection);
    await connection.execute('ALTER TABLE roles ADD COLUMN synthetic_unknown MEDIUMTEXT NULL');await connection.execute('ALTER TABLE permissions ADD COLUMN synthetic_unknown MEDIUMTEXT NULL');
    const addRole=async(id,code,parent,status='active',group='mdm',creator=null)=>connection.execute('INSERT INTO roles(role_id,role_code,role_name,parent_role_id,status,role_group,model_version,created_by,synthetic_unknown,permissions_json) VALUES (CAST(? AS SIGNED),?,?,CAST(? AS SIGNED),?,?,?,CAST(? AS SIGNED),?,?)',[String(id),code,'Role '+code,parent==null?null:String(parent),status,group,ACCESS_MODEL_VERSION,creator==null?null:String(creator),'unknown:'+code,'{"historical":"unchanged"}']);
    const addPerm=async(id,code,fields=null)=>connection.execute('INSERT INTO permissions(perm_id,perm_code,resource,action,field_constraints,description,synthetic_unknown,is_dangerous,protected_core) VALUES (CAST(? AS SIGNED),?,? ,?, ?,?, ?,1,1)',[String(id),code,code.split(':')[0],code.split(':')[1],fields,'Description '+code,'unknown:'+code]);
    const grant=async(role,perm,effect='allow')=>connection.execute('INSERT INTO role_permissions(role_id,perm_id,effect) VALUES (CAST(? AS SIGNED),CAST(? AS SIGNED),?)',[String(role),String(perm),effect]);
    await connection.execute("INSERT INTO departments(id,code,name) VALUES (9,'SYN9','Synthetic nine'),(10,'SYN10','Synthetic ten')");
    for(const [id,code,parent,status,group,creator]of [[100,'syn_child',101,'active','mdm',42],[101,'syn_parent',102,'legacy','legacy',null],[102,'syn_grand',null,'retired','legacy',null],[103,'syn_empty',null,'legacy','legacy',null],[104,'syn_cycle',105,'active','mdm',null],[105,'syn_cycle_parent',104,'retired','legacy',null],[106,'syn_self',106,'active','mdm',null],[107,'syn_absent_parent',999,'retired','legacy',null]])await addRole(id,code,parent,status,group,creator);
    for(const [id,code,fields]of [[200,'syn:own','{"readonly":["person_name"]}'],[201,'syn:inherited','not-json-history'],[202,'syn:grand',null],[203,'syn:unassigned','{}'],[204,'syn:cycle',null]])await addPerm(id,code,fields);
    await grant(100,200,'deny');await grant(101,200,'allow');await grant(101,201,'deny');await grant(102,201,'allow');await grant(102,202);await grant(104,200);await grant(105,204,'deny');await grant(106,200);
    const person=async(id,department,name,employment='active',status='active')=>connection.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id,employment_status,status) VALUES(CAST(? AS SIGNED),?,?,CAST(? AS SIGNED),?,?)',[String(id),'SYN'+id,name,department==null?null:String(department),employment,status]);
    const assignment=async(id,role,scope=null,status='active')=>connection.execute('INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,assignment_status,authorization_basis,effective_from,effective_to) VALUES(CAST(? AS SIGNED),CAST(? AS SIGNED),?,CAST(? AS SIGNED),?,NULL,NULL,?)',[String(id),String(role),scope==null?'global':'department',scope==null?null:String(scope),status,status==='active'?'2000-01-01':null]);
    await person(300,9,'Synthetic active');await person(301,10,'Synthetic inactive','inactive','inactive');await person(302,null,'Synthetic no department');await person(303,999,'Synthetic missing department');
    await assignment(300,100,9);await assignment(301,100,10,'revoked');await assignment(302,100,null,'expired');await assignment(303,100);await assignment(999,100); // Dangling user excluded by the original inner join; counted when active.
    compare('complete small list and types',await current.listRoles(),await old.listRoles());
    for(const id of [100,101,102,103,104,105,106,107])for(const method of ['getRoleDetail','getRolePermissionMatrix'])compare('small '+id+' '+method,await current[method](id),await old[method](id));
    const small=await current.getRoleDetail(100),listing=await current.listRoles();
    assert.deepEqual(small.permissions.map(p=>[p.perm_code,p.effect,p.inherited]),[['syn:own','deny',0],['syn:inherited','deny',1],['syn:grand','allow',1]]);
    assert.equal(small.users.length,4);assert.equal(listing.find(r=>r.role_id===100).user_count,3);assert.equal(listing.find(r=>r.role_id===100).perm_count,1);
    assert.equal(small.users.find(u=>u.id===301).assignment_status,'revoked');assert.equal(small.users.find(u=>u.id===302).department_id,null);assert.equal(small.users.find(u=>u.id===303).dept_name,null);
    const statuses=listing.map(r=>['active','legacy','retired'].indexOf(r.status));assert.deepEqual(statuses,[...statuses].sort((a,b)=>a-b));
    checks.push('complete safe integer equality/types; status/group/code ordering; original counts/users and unknown fields; null/missing parent, self/multi-node cycle; own/inherited/deny/code dedup; raw field constraints; unassigned effect/null');
    // Temporarily remove permissions to exercise an existing role with no matrix.
    await connection.beginTransaction();try{await connection.execute('DELETE FROM role_permissions');await connection.execute('DELETE FROM permissions');compare('role with no permissions detail',await current.getRoleDetail(103),await old.getRoleDetail(103));compare('role with no permissions matrix',await current.getRolePermissionMatrix(103),await old.getRolePermissionMatrix(103));assert.deepEqual((await current.getRolePermissionMatrix(103)).matrix,[]);}finally{await connection.rollback();}
    for(const [id,code]of [[D,'SYN_BIG_ODD'],[DN,'SYN_BIG_EVEN']])await connection.execute('INSERT INTO departments(id,code,name) VALUES(CAST(? AS SIGNED),?,?)',[id,code,'Department '+id]);
    for(const [id,dept]of [[P,D],[PN,DN]])await person(id,dept,'Person '+id);
    for(const [id,code,parent,status,group,creator]of [[R,'syn_big_odd',PR,'active','mdm',P],[RN,'syn_big_even',PRN,'legacy','legacy',PN],[PR,'syn_big_parent_odd',G,'retired','legacy',P],[PRN,'syn_big_parent_even',GN,'active','mdm',PN],[G,'syn_big_grand_odd',null,'retired','legacy',null],[GN,'syn_big_grand_even',null,'legacy','legacy',null]])await addRole(id,code,parent,status,group,creator);
    await addPerm(PM,'big:odd','{"raw":"odd"}');await addPerm(PMN,'big:even','{"raw":"even"}');
    await grant(R,PM,'deny');await grant(RN,PMN);await grant(PR,201,'deny');await grant(PRN,203);await grant(G,202);await grant(GN,204);
    await assignment(P,R,D,'revoked');await assignment(PN,RN,DN);await assignment(PN,R,DN,'expired');
    const odd=await current.getRoleDetail(R),even=await current.getRoleDetail(RN);
    assert.equal(odd.role_id,R);assert.equal(odd.parent_role_id,PR);assert.equal(odd.created_by,P);assert.equal(odd.synthetic_unknown,'unknown:syn_big_odd');
    assert.deepEqual(odd.permissions.map(p=>[p.perm_id,p.perm_code,p.effect,p.inherited]),[[PM,'big:odd','deny',0],[201,'syn:inherited','deny',1],[202,'syn:grand','allow',1]]);
    assert.deepEqual(even.permissions.map(p=>[p.perm_id,p.perm_code,p.effect,p.inherited]),[[PMN,'big:even','allow',0],[203,'syn:unassigned','allow',1],[204,'syn:cycle','allow',1]]);
    for(const detail of [odd,even])for(const user of detail.users){assert.equal(user.id,user.person_id);assert.equal(typeof user.person_id,'string');assert.equal(user.department_id,user.person_id===P?D:DN);assert.equal(user.scope_department_id,user.department_id);assert.equal(user.dept_name,'Department '+user.department_id);}
    const matrix=await current.getRolePermissionMatrix(R);assert.equal(matrix.role.role_id,R);assert.equal(matrix.matrix.find(p=>p.perm_id===PM).effect,'deny');assert.equal(matrix.matrix.find(p=>p.perm_id===PMN).effect,null);assert.equal(matrix.matrix.find(p=>p.perm_id===PM).synthetic_unknown,'unknown:big:odd');
    const bigList=await current.listRoles();assert.equal(bigList.find(r=>r.role_id===R).parent_role_name,'Role syn_big_parent_odd');assert.equal(bigList.find(r=>r.role_id===RN).parent_role_name,'Role syn_big_parent_even');assert.equal(bigList.find(r=>r.role_id===R).user_count,0);assert.equal(bigList.find(r=>r.role_id===RN).user_count,1);
    save('exact-bigint-results.json',{odd,even,matrix,listing:bigList});
    checks.push('adjacent BIGINT role/parent/grandparent/permission/person/department/scope/creator associations remain exact; safe permission IDs stay numbers and unknown columns/raw values remain');
    // Big parent cycle must terminate using exact identities, then retain null.
    await connection.execute('UPDATE roles SET parent_role_id=CAST(? AS SIGNED) WHERE role_id=CAST(? AS SIGNED)',[R,G]);assert.equal((await current.getRoleDetail(R)).permissions.length,3);await connection.execute('UPDATE roles SET parent_role_id=NULL WHERE role_id=CAST(? AS SIGNED)',[G]);
    for(const invalid of [null,0,-1,1.5,NaN,Infinity,Number(R),'1e2','100x','-100','9223372036854775808'])for(const method of ['getRoleDetail','getRolePermissionMatrix'])assert.equal(await current[method](invalid),null,method+' '+String(invalid));
    for(const method of ['getRoleDetail','getRolePermissionMatrix'])await assert.rejects(current[method](undefined),e=>/undefined/.test(e.message));
    checks.push('invalid/unsafe Number cannot select a legal neighbour; undefined retains driver parameter error; exact multi-node BIGINT cycle terminates');
    // Warm all statements on ONE real connection, then alternate number/string
    // shapes. MySQL instrumentation proves prepared statement IDs are reused.
    const sequence=[100,R,101,RN,'000100',PR,102,PRN,R,RN,100,R];
    for(const id of sequence)for(const method of ['getRoleDetail','getRolePermissionMatrix'])await current[method](id);
    const statements=async()=>json((await connection.query('SELECT STATEMENT_ID,SQL_TEXT,COUNT_EXECUTE FROM performance_schema.prepared_statements_instances WHERE OWNER_THREAD_ID=(SELECT THREAD_ID FROM performance_schema.threads WHERE PROCESSLIST_ID=?) ORDER BY STATEMENT_ID',[connection.connection.threadId]))[0]);
    const preparedBefore=await statements(),traceStart=trace.length;
    for(const id of sequence)for(const method of ['getRoleDetail','getRolePermissionMatrix']){const result=await current[method](id);assert.equal(String(method==='getRoleDetail'?result.role_id:result.role.role_id),BigInt(id).toString());}
    const preparedAfter=await statements(),bindings=trace.slice(traceStart).filter(e=>e.params.length);
    assert(bindings.every(e=>e.params[0]===null||typeof e.params[0]==='string'));
    save('prepared-reuse-observed.json',{connectionId:connection.connection.threadId,sequence,preparedBefore,preparedAfter,bindings});
    const matched=preparedBefore.filter(s=>/^SELECT/i.test(s.SQL_TEXT)&&/role_id=CAST\(\? AS SIGNED\)/.test(s.SQL_TEXT));assert(matched.length>=5);
    for(const row of matched){const after=preparedAfter.find(s=>s.STATEMENT_ID===row.STATEMENT_ID);assert(after);assert(Number(after.COUNT_EXECUTE)>Number(row.COUNT_EXECUTE));}
    save('prepared-reuse.json',{connectionId:connection.connection.threadId,sequence,preparedBefore,preparedAfter,bindings,reused:true});checks.push('actual prepared statement IDs and execution counts prove same-connection safe/big decimal parameter reuse without neighbouring association');
    // Propagate the same Error instance from EVERY SQL step; do not skip parent,
    // users, matrix or empty reads. Baseline steps get identical error evidence.
    const errorChecks=[];
    for(const [method,args]of [['listRoles',[]],['getRoleDetail',[100]],['getRolePermissionMatrix',[100]]]){
      const calls=[];await makeIdentityMysqlRepository({async execute(sql,params){calls.push({sql,params});return connection.execute(sql,params);}})[method](...args);
      const oldCalls=[];await beforeIdentity.exports.makeIdentityMysqlRepository({async execute(sql,params){oldCalls.push({sql,params});return connection.execute(sql,params);}})[method](...args);
      assert.equal(calls.length,oldCalls.length);
      for(let failAt=0;failAt<calls.length;failAt++)for(const [version,factory]of [['before',beforeIdentity.exports.makeIdentityMysqlRepository],['after',makeIdentityMysqlRepository]]){
        let index=0;const sentinel=Object.assign(new Error('B02 role read injected failure'),{code:'B02_ROLE_QUERY_FAILURE'});
        await assert.rejects(factory({async execute(sql,params){if(index++===failAt)throw sentinel;return connection.execute(sql,params);}})[method](...args),e=>e===sentinel);
        errorChecks.push({method,version,failAt,errorCode:sentinel.code,sameError:true});
      }
    }
    save('repository-errors.json',errorChecks);checks.push('every query step preserves original rejection, error identity and no fallback');
    // Real auth/permission consumers use the original fixed small role model.
    const fixedRoles=(await connection.query('SELECT role_id,role_code FROM roles WHERE is_core=1'))[0],roleId=code=>fixedRoles.find(r=>r.role_code===code).role_id;
    const sessions=new Map();
    for(const [id,codes,dept]of [[41,['mdm_lead'],9],[42,['admin'],9],[43,['admin','department_contact'],9],[44,[],9],[45,['department_contact'],10]]){
      await person(id,dept,'Identity '+id);await connection.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES(?,? ,?,'unused-synthetic', 'active',0,7)",[id+100,id,'SYN_LOGIN'+id]);
      for(const code of codes)await connection.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) VALUES(?,?,?,?,'synthetic','2026-01-01')",[id,roleId(code),code==='department_contact'?'department':'global',code==='department_contact'?dept:null]);
      sessions.set(String(id),{personId:id,accountId:id+100,authVersion:7});
    }
    for(const sql of SCHEMA_SQL.split(/;\s*(?:\r?\n|$)/).map(s=>s.trim()).filter(Boolean)){if(sql.startsWith('CREATE TABLE IF NOT EXISTS system_admin_accounts'))await connection.execute(sql);}
    await connection.execute('INSERT INTO schema_migrations(migration_key) VALUES(?)',[MIGRATION_KEY]);
    await connection.execute("INSERT INTO system_admin_accounts(account_id,login_name,password_hash,must_change_password,account_status,auth_version,authorization_basis) VALUES(900,'admin','unused-synthetic',0,'active',7,'synthetic')");
    sessions.set('system',{identityKind:'system_admin',accountId:900,authVersion:7});
    sessions.set('stale',{personId:42,accountId:142,authVersion:6});sessions.set('unsafe-account',{personId:42,accountId:Number(R),authVersion:7});
    auth=require('../server/auth');roles=require('../server/routes/roles');let authFailure=null,permissionFailure=null,roleFailure=null;
    const identity=makeIdentityMysqlRepository(pool);
    auth.setIdentityRepositoryFactory(()=>({async validateSession(session){if(authFailure)throw authFailure;return identity.validateSession(session);},async getUserEffectivePermissions(id){if(permissionFailure)throw permissionFailure;return identity.getUserEffectivePermissions(id);}}));
    const routeRepo={};for(const method of ['listRoles','getRoleDetail','getRolePermissionMatrix'])routeRepo[method]=async(...args)=>{if(roleFailure)throw roleFailure;return current[method](...args);};
    roles.setIdentityRepositoryFactory(()=>routeRepo);beforeRoles.exports.setIdentityRepositoryFactory(()=>old);
    const express=require('express'),app=express();app.use(express.json());app.use((req,res,next)=>{req.session={...(sessions.get(req.headers['x-b02-identity'])||{}),destroy:done=>done()};next();});app.use('/api/roles',roles);app.use('/before/roles',beforeRoles.exports);
    server=await new Promise(resolve=>{const owned=app.listen(0,'127.0.0.1',()=>resolve(owned));});save('owned-http.json',{owner,port:server.address().port,host:'127.0.0.1'});
    const call=async(actor,url,method='GET',body)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+url,{method,headers:{'x-b02-identity':actor,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
    // The old complete response is the oracle for every non-identity field.
    // Correct only the explicitly changed large IDs using physical decimal
    // reads keyed by the preserved unique codes, never by rounded numbers.
    const physicalRoles=(await connection.query('SELECT role_code,CAST(role_id AS CHAR) role_id,CAST(parent_role_id AS CHAR) parent_role_id,CAST(created_by AS CHAR) created_by FROM roles'))[0];
    const physicalPermissions=(await connection.query('SELECT perm_code,CAST(perm_id AS CHAR) perm_id FROM permissions'))[0];
    const expectedRole=row=>{const physical=physicalRoles.find(p=>p.role_code===row.role_code),copy={...row};for(const field of ['role_id','parent_role_id','created_by'])if(physical[field]&&BigInt(physical[field])>BigInt(Number.MAX_SAFE_INTEGER))copy[field]=physical[field];return copy;};
    const expectedPayload=result=>{if(result.status!==200)return result;const body=result.body;
      if(Array.isArray(body))return{...result,body:body.map(expectedRole)};
      if(body.matrix)return{...result,body:{...body,role:expectedRole(body.role),matrix:body.matrix.map(row=>{const id=physicalPermissions.find(p=>p.perm_code===row.perm_code).perm_id;return BigInt(id)>BigInt(Number.MAX_SAFE_INTEGER)?{...row,perm_id:id}:row;})}};
      return result;
    };
    for(const actor of ['41','42','43','44','45','system','anonymous','stale','unsafe-account'])for(const suffix of ['', '/100','/100/permissions']){
      const actual=await call(actor,'/api/roles'+suffix),expected=expectedPayload(await call(actor,'/before/roles'+suffix));compare('HTTP '+actor+suffix,actual,expected);
      assert.equal(actual.status,['42','43','system'].includes(actor)?200:['anonymous','stale','unsafe-account'].includes(actor)?401:403);requests.push({actor,suffix,result:actual});
    }
    for(const actor of ['42','43','system'])for(const id of [R,RN,PR,PRN])for(const suffix of ['', '/permissions']){const actual=await call(actor,'/api/roles/'+id+suffix);assert.equal(actual.status,200);assert.equal(suffix?actual.body.role.role_id:actual.body.role_id,id);requests.push({actor,id,suffix,result:actual});}
    for(const id of ['999','0','-1','100oops','1e2','0x64','9223372036854775808'])for(const suffix of ['', '/permissions']){const actual=await call('42','/api/roles/'+id+suffix);assert.equal(actual.status,404);assert.equal(actual.body.code,'ROLE_NOT_FOUND');requests.push({actor:'42',id,suffix,result:actual});}
    const writes=[['POST','',{role_code:'synthetic forbidden'}],['PUT','/100',{role_name:'forbidden'}],['DELETE','/100'],['PUT','/100/permissions',{perm_ids:[200]}]];
    const stateBefore=await physical(connection);
    for(const actor of ['41','42','43','system','44','45','anonymous'])for(const[method,suffix,body]of writes){const actual=await call(actor,'/api/roles'+suffix,method,body),expected=await call(actor,'/before/roles'+suffix,method,body);compare('readonly '+actor+' '+method+suffix,actual,expected);assert.equal(actual.status,['42','43','system'].includes(actor)?405:actor==='anonymous'?401:403);if(actual.status===405)assert.equal(actual.body.code,'CORE_GOVERNANCE_MODEL_READ_ONLY');requests.push({actor,method,suffix,result:actual});}
    assert.equal(await physical(connection),stateBefore);
    checks.push('three real GETs preserve complete small HTTP responses/types, person/admin/overlay/system-admin/no permission/anonymous/invalid session gates; exact adjacent BIGINT and invalid IDs; all four role writes retain 405 and zero physical change');
    // Request-side failed identity/permissions and repository errors retain the
    // prior public responses; table failures are generated by REAL owned MySQL.
    const serviceChecks=[];
    for(const suffix of ['', '/100','/100/permissions']){
      authFailure=new Error('B02 injected identity failure');compare('auth failure'+suffix,await call('42','/api/roles'+suffix),await call('42','/before/roles'+suffix));assert.equal((await call('42','/api/roles'+suffix)).body.code,'IDENTITY_SERVICE_UNAVAILABLE');authFailure=null;
      permissionFailure=new Error('B02 injected permission failure');compare('permission failure'+suffix,await call('42','/api/roles'+suffix),await call('42','/before/roles'+suffix));permissionFailure=null;
      roleFailure=new Error('B02 injected role service failure');beforeRoles.exports.setIdentityRepositoryFactory(()=>({listRoles:()=>{throw roleFailure;},getRoleDetail:()=>{throw roleFailure;},getRolePermissionMatrix:()=>{throw roleFailure;}}));const actual=await call('42','/api/roles'+suffix),expected=await call('42','/before/roles'+suffix);compare('role service failure'+suffix,actual,expected);assert.equal(actual.body.code,'IDENTITY_ACCESS_SERVICE_UNAVAILABLE');serviceChecks.push({suffix,actual,expected});roleFailure=null;beforeRoles.exports.setIdentityRepositoryFactory(()=>old);
    }
    // Authenticate against the untouched pool, then point only the role read
    // factory to the same physical DB through a real failing table read.
    await connection.execute('RENAME TABLE roles TO b02_owned_roles_backup');
    try{for(const method of ['listRoles','getRoleDetail','getRolePermissionMatrix'])await assert.rejects(current[method](100),e=>e.code==='ER_NO_SUCH_TABLE');}finally{await connection.execute('RENAME TABLE b02_owned_roles_backup TO roles');}
    const failingRoleDb={async execute(sql,params){return connection.execute(sql.replace(/FROM roles\b/g,'FROM b02_owned_absent_roles'),params);}};
    roles.setIdentityRepositoryFactory(()=>makeIdentityMysqlRepository(failingRoleDb));beforeRoles.exports.setIdentityRepositoryFactory(()=>beforeIdentity.exports.makeIdentityMysqlRepository(failingRoleDb));
    for(const suffix of ['', '/100','/100/permissions']){const actual=await call('42','/api/roles'+suffix),expected=await call('42','/before/roles'+suffix);compare('real MySQL error HTTP'+suffix,actual,expected);assert.equal(actual.body.code,'MYSQL_RUNTIME_UNAVAILABLE');serviceChecks.push({suffix,actual,expected,realMysqlError:'ER_NO_SUCH_TABLE',generatedDuringRequest:true});}
    roles.setIdentityRepositoryFactory(()=>routeRepo);beforeRoles.exports.setIdentityRepositoryFactory(()=>old);
    save('service-errors.json',serviceChecks);checks.push('identity/permission/generic service/real MySQL errors preserve public status and payload; repository real missing-table errors propagate');
    save('comparisons.json',comparisons);save('http-results.json',requests);save('query-trace.json',trace);save('checks.json',checks);
    } finally {await closeHttp();if(connection){connection.release();connection=null;}}
  },{stage:'02',randomDatabase:true});passed=true;
  }catch(error){failure={message:error.message,code:error.code,stack:error.stack};throw error;
  }finally{await closeHttp();if(connection){connection.release();connection=null;}auth?.resetIdentityRepositoryFactory();roles?.resetIdentityRepositoryFactory();beforeRoles.exports.resetIdentityRepositoryFactory();
    save('comparisons-final.json',comparisons);save('query-trace-final.json',trace);
    let cleanup;if(target){const remaining=cp.execFileSync('docker',['ps','-aq','--filter','label=infomat.stage02='+target.owner],{env:isolatedEnvironment(),encoding:'utf8',windowsHide:true}).trim();assert.equal(remaining,'');assert(await refused(target.mysqlPort));cleanup={...target,poolEnded:true,heldConnectionReleased:true,containerRemoved:true,remaining:0,mysqlConnectionRefused:true,httpStops:stops};save('resource-cleanup.json',cleanup);}
    for(const[key,value]of Object.entries(previousEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
    save('results.json',{passed,failure,checks,baseline:{identitySha256:beforeIdentity.sha256,rolesSha256:beforeRoles.sha256},comparisonCount:comparisons.length,httpCount:requests.length,cleanup,formalDatabaseAccess:false,businessAccepted:false});
  }
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
