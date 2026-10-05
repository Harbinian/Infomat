// Typed maintenance principal; never substitute an account number for person_id.
const { ROLE_GUIDES, ACCESS_MODEL_VERSION } = require('./roleDefinitions');
const { MIGRATION_KEY } = require('./systemAdminMigration');
const ACTOR = Symbol('systemAdminAuditActor');
const principal = id => `system-admin:${id}`;
const accountId = ref => {
  if (!/^system-admin:([1-9]\d*)$/.test(String(ref))) return null;
  const id=Number(String(ref).split(':')[1]);
  return Number.isSafeInteger(id)?id:null;
};
const enabled = () => process.env.MDM_SYSTEM_ADMIN_ENABLED==='1';
const fail = (code,statusCode=403) => Object.assign(new Error(code),{code,statusCode});
async function first(db,sql,params=[]) { const [rows]=await db.execute(sql,params); return rows[0]||null; }
async function getSystemAdmin(db,ref,{login=false,locked=false}={}) {
  if (!enabled()) return null;
  const marker = await first(db,'SELECT migration_key FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]);
  if (!marker) throw fail('SYSTEM_ADMIN_SCHEMA_UNAVAILABLE',503);
  const row=await first(db,`SELECT * FROM system_admin_accounts WHERE ${login?'login_name':'account_id'}=?${locked?' FOR SHARE':''}`,[login?ref:accountId(ref)]);
  if (!row || row.account_status!=='active') return null;
  const role=await first(db,"SELECT role_id,role_name FROM roles WHERE role_code='admin' AND status='active' AND model_version=?",[ACCESS_MODEL_VERSION]);
  if (!role) return null;
  const id=Number(row.account_id);
  if (!Number.isSafeInteger(id)||id<1) throw fail('SYSTEM_ADMIN_ID_INVALID',409);
  return {...row,id:principal(id),identityKind:'system_admin',identityRef:principal(id),systemAccountId:id,accountId:id,
    personId:null,person_id:null,name:'系统管理员',personName:'系统管理员',employeeNo:null,
    department_id:null,current_department_id:null,departmentName:null,accountStatus:row.account_status,
    authVersion:Number(row.auth_version),adminRoleId:role.role_id,role:'admin'};
}
async function permissions(db,ref) {
  const user=await getSystemAdmin(db,ref);
  if (!user) return {permSet:new Set(),fieldConstraints:{}};
  const [rows]=await db.execute('SELECT p.perm_code,rp.effect FROM role_permissions rp JOIN permissions p ON p.perm_id=rp.perm_id WHERE rp.role_id=?',[user.adminRoleId]);
  const allowed=new Set(ROLE_GUIDES.find(r=>r.code==='admin').permissions.map(p=>p.code));
  const denied=new Set(rows.filter(r=>r.effect==='deny').map(r=>r.perm_code));
  return {permSet:new Set(rows.filter(r=>r.effect==='allow'&&allowed.has(r.perm_code)&&!denied.has(r.perm_code)).map(r=>r.perm_code)),fieldConstraints:{}};
}
async function currentPayload(db,session) {
  const user=await getSystemAdmin(db,principal(session.accountId));
  if (!user) return null;
  const {permSet}=await permissions(db,user.identityRef);
  const role={code:'admin',name:ROLE_GUIDES.find(r=>r.code==='admin').name,scopeType:'global'};
  return {id:user.identityRef,identityKind:'system_admin',personId:null,accountId:user.accountId,employeeNo:null,
    personName:user.name,name:user.name,role:'admin',accountStatus:user.accountStatus,authVersion:user.authVersion,
    departmentId:null,departmentName:null,department:null,positions:[],positionInfo:{status:'not_applicable'},
    rbacRoles:[role],roleAssignments:[role],roleCodes:['admin'],permissions:[...permSet],dataScopes:['global'],governanceModelVersion:ACCESS_MODEL_VERSION};
}
async function event(db,id,type,identityEventId=null,targetPersonId=null) {
  await db.execute('INSERT INTO system_admin_events(actor_account_id,event_type,identity_event_id,target_person_id) VALUES (?,?,?,?)',[id,type,identityEventId,targetPersonId]);
}
async function bootstrapSystemAdmin(pool,{passwordHash,authorizationBasis}) {
  if (!passwordHash||!String(authorizationBasis||'').trim()) throw fail('SYSTEM_ADMIN_BOOTSTRAP_INPUT_INVALID',422);
  const db=await pool.getConnection();
  try {
    const [[lock]]=await db.execute("SELECT GET_LOCK('mdm_system_admin_bootstrap_v1',10) acquired");
    if (Number(lock.acquired)!==1) throw fail('SYSTEM_ADMIN_BOOTSTRAP_BUSY',409);
    await db.beginTransaction();
    const marker=await first(db,'SELECT migration_key FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]);
    if (!marker) throw fail('SYSTEM_ADMIN_SCHEMA_UNAVAILABLE',503);
    const exists=await first(db,"SELECT (SELECT COUNT(*) FROM system_admin_accounts) system_count,(SELECT COUNT(*) FROM user_accounts WHERE login_name='admin') person_login_count");
    if (Number(exists.system_count)||Number(exists.person_login_count)) throw fail('SYSTEM_ADMIN_BOOTSTRAP_ALREADY_COMPLETED',409);
    const role=await first(db,"SELECT role_id FROM roles WHERE role_code='admin' AND status='active' AND model_version=?",[ACCESS_MODEL_VERSION]);
    if (!role) throw fail('SYSTEM_ADMIN_FIXED_ROLE_UNAVAILABLE',409);
    const [result]=await db.execute("INSERT INTO system_admin_accounts(login_name,password_hash,authorization_basis) VALUES ('admin',?,?)",[passwordHash,String(authorizationBasis).trim()]);
    await event(db,result.insertId,'bootstrap');
    await db.commit();
    return {identityKind:'system_admin',accountId:Number(result.insertId),personId:null,loginName:'admin',mustChangePassword:true};
  } catch(e) {await db.rollback();throw e;} finally {await db.execute("SELECT RELEASE_LOCK('mdm_system_admin_bootstrap_v1')");db.release();}
}
// Bind a validated system actor to the existing account transaction and audit.
// A row lock rechecks current status/version, preventing concurrent revocation.
function maintenancePool(pool,actor) {
  return new Proxy(pool,{get(target,key) {
    if (key!=='getConnection') return typeof target[key]==='function'?target[key].bind(target):target[key];
    return async()=>{
      const db=await target.getConnection();
      return new Proxy(db,{get(connection,property) {
        if (property===ACTOR) return actor;
        if (property==='beginTransaction') return async()=>{
          await connection.beginTransaction();
          const current=await getSystemAdmin(connection,actor.identityRef,{locked:true});
          if (!current||current.must_change_password||current.authVersion!==actor.authVersion) throw fail('SYSTEM_ADMIN_ACTOR_CHANGED',401);
        };
        return typeof connection[property]==='function'?connection[property].bind(connection):connection[property];
      }});
    };
  }});
}
module.exports={ACTOR,principal,accountId,enabled,getSystemAdmin,permissions,currentPayload,event,bootstrapSystemAdmin,maintenancePool,fail};
