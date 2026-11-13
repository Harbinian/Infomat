// Human audit events are a typed person source, separate from legacy users.
// Each committed event counts once; names and responsible departments remain
// those captured for that operation. Disabled mode never creates a pool.
const schema=require('./qualityAuditSchema');
const {readPersonAuthority}=require('./identityMysqlRepository');
const {sessionSubject,identityInteger,sameIdentityInteger:same}=require('./sessionSubject');
const {parse,digest}=require('./dataMapDefinitionValues');
const {createRegisteredPool}=require('./mysqlPoolRegistry');
const fail=(code,statusCode=503)=>Object.assign(new Error(code),{code,statusCode});
function makeQualityAuditActivity(pool){return {async listActivityRows(session,{scope,startDate,endDate}){
  if(!schema.enabled())return [];
  const db=await pool.getConnection();try{
    await schema.assertReady(db);await db.beginTransaction();
    const subject=sessionSubject(session);let permissions,departmentId,personId=null;
    if(subject.kind==='system_admin'){
      const system=require('./systemAdminIdentity'),user=await system.getSystemAdmin(db,subject.principal,{locked:true});
      if(!user||user.must_change_password||!same(user.authVersion,subject.authVersion))throw fail('QUALITY_AUDIT_ACTIVITY_FORBIDDEN',403);
      permissions=(await system.permissions(db,subject.principal)).permSet;departmentId=null;
    }else{
      const authority=await readPersonAuthority(db,session,subject.personId,{currentRead:true});
      if(!authority.valid)throw fail('QUALITY_AUDIT_ACTIVITY_FORBIDDEN',403);
      personId=identityInteger(authority.user.personId);departmentId=identityInteger(authority.user.current_department_id);permissions=authority.permissions;
    }
    if(scope!=='me'&&!permissions.has('governance:read-global')&&!permissions.has('identity:read-audit'))throw fail('QUALITY_AUDIT_ACTIVITY_FORBIDDEN',403);
    if(scope==='me'&&personId==null||scope==='team'&&departmentId==null){await db.commit();return [];}
    const start=Date.parse(startDate+'T00:00:00+08:00')/1000,end=Date.parse(endDate+'T00:00:00+08:00')/1000+86400;
    const where=['created_at>=FROM_UNIXTIME(?)','created_at<FROM_UNIXTIME(?)'],args=[start,end];
    if(scope==='me'){where.push('actor_person_id=CAST(? AS SIGNED)');args.push(String(personId));}
    if(scope==='team'){where.push("JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.finding.department_snapshot.id'))=?");args.push(String(departmentId));}
    const [events]=await db.execute(`SELECT CAST(actor_person_id AS CHAR) actor_person_id,snapshot_json,snapshot_digest,
      DATE_FORMAT(TIMESTAMPADD(SECOND,UNIX_TIMESTAMP(created_at)+28800,'1970-01-01 00:00:00'),'%Y-%m-%d') activity_date
      FROM data_quality_audit_events WHERE ${where.join(' AND ')} ORDER BY created_at,event_id`,args);
    const rows=events.map(row=>{
      const event=parse(row.snapshot_json),actor=event?.actor_snapshot,department=event?.finding?.department_snapshot;
      if(digest(event)!==row.snapshot_digest||!same(actor?.person_id,row.actor_person_id)||!identityInteger(department?.id))throw fail('QUALITY_AUDIT_ACTIVITY_HISTORY_INVALID');
      return {date:row.activity_date,sourceType:'quality_audit',sourceLabel:'人工质量审计办理',actorIdentityKind:'person',actorPersonId:identityInteger(row.actor_person_id),actorUserId:null,
        actorName:actor.person_name||'当时姓名未记录',employeeNo:null,departmentId:identityInteger(department.id),departmentName:department.name||'当时部门名称未记录'};
    });
    await db.commit();return rows;
  }catch(error){await db.rollback().catch(()=>{});throw error;}finally{db.release();}
}};}
let factory=null,instance=null;
function qualityAuditActivity(){if(!schema.enabled())return null;return factory?factory():instance||(instance=makeQualityAuditActivity(createRegisteredPool(process.env,'audit')));}
module.exports={makeQualityAuditActivity,qualityAuditActivity,setQualityAuditActivityFactory:value=>{factory=value;},resetQualityAuditActivityFactory:()=>{factory=null;}};
