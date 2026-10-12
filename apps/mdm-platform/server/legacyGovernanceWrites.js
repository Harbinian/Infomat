// Shared only by legacy ledger import, terminology and conflict write boundaries.
// Resource lock -> current identity/grants -> business/event/audit writes. No DDL or retry.
const crypto = require('node:crypto');
const { activeActor } = require('./processV7Authoring');
const fail = (statusCode,code,message) => Object.assign(new Error(message),{statusCode,code});
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pick = (row,keys) => keys.map(key=>[key,row?.[key] ?? null]);
// requireAuth supplies non-enumerable compatibility fields. Read them explicitly;
// spreading req.session loses the admitted person/department and copies cookie data.
function sessionOf(session) {
 return Object.fromEntries(['personId','userId','accountId','authVersion','departmentId','identityKind'].map(key=>[key,session?.[key]]));
}
function termToken(row) {
 return digest(pick(row,['id','term','term_type_code','definition','scope','forbidden','status','process_id','process_owner_dept_id','created_by','created_by_person_id','approved_by','approved_by_person_id','write_revision']));
}
function conflictToken(row) {
 return digest([pick(row,['id','conflict_type','term','term_a_id','term_b_id','field_id_a','field_id_b','conflict_field','value_a','value_b','dept_a','dept_b','dept_a_meaning','dept_b_meaning','severity','status','escalated','deadline','resolution','resolution_type','resolved_by','write_revision']),
  (row.assignmentHistory||[]).map(r=>pick(r,['id','assignee_user_id','assignee_person_id','assigned_by','assigned_by_person_id'])),
  (row.coordinationHistory||[]).map(r=>pick(r,['id','assignee_user_id','assignee_person_id','result','note']))]);
}
function compareToken(expected,current) {
 if(expected===undefined) return;
 if(typeof expected!=='string' || !/^[a-f0-9]{64}$/.test(expected)) throw fail(400,'LEGACY_EXPECTED_INVALID','原内容快照标识无效');
 if(expected!==current) throw fail(409,'LEGACY_WRITE_CONFLICT','原记录已变化，当前输入保留，请刷新核对');
}
async function transaction(pool,action,connection=null) {
 const db=connection||await pool.getConnection();let committing=false;
 try {
  await db.beginTransaction();const result=await action(db);committing=true;await db.commit();return result;
 } catch(error) {
  await db.rollback().catch(()=>{});
  if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) throw fail(409,'LEGACY_WRITE_BUSY','记录正在并发办理，本次未完成，请核对后再操作');
  if(committing) throw fail(503,'LEGACY_WRITE_UNKNOWN','提交回执不明，请保留原请求并核对记录，不能自动重试');
  throw error;
 } finally {if(!connection)db.release();}
}
async function actor(db,session,permission) {
 if(!session?.personId || !session?.accountId || !session?.authVersion || session.identityKind==='system_admin') throw fail(403,'LEGACY_WRITE_FORBIDDEN','缺少有效人员操作身份');
 const current=await activeActor(db,session);
 if(String(current.current_department_id)!==String(session.departmentId)) throw fail(401,'SESSION_AUTHORIZATION_CHANGED','当前部门已经变化，请重新登录');
 const effects=new Map();
 for(const g of current.grants) {
  if(g.scope_type==='department' && Number(g.scope_department_id)!==Number(current.current_department_id)) continue;
  if(g.perm_code && (g.effect==='deny'||!effects.has(g.perm_code))) effects.set(g.perm_code,g.effect);
 }
 if(current.admin || (permission && effects.get(permission)!=='allow')) throw fail(403,'LEGACY_WRITE_FORBIDDEN','当前身份无此治理写入权限');
 return {...current,effects};
}
async function audit(db,type,entityId,action,session,before,after,fieldName=null) {
 await db.execute(`INSERT INTO mdm_version_log(entity_type,entity_id,field_name,operation,operated_by,operated_by_person_id,metadata_json)
  VALUES (?,?,?,?,?,?,?)`,[type,entityId,fieldName,action,session.userId||session.personId,session.personId,
  JSON.stringify({schema_version:'legacy-governance-write-v1',before,after})]);
}
module.exports={fail,digest,sessionOf,termToken,conflictToken,compareToken,transaction,actor,audit};
