// Operational office assignments do not grant workflow review or publication rights.
const {sessionSubject,identityInteger,sameIdentityInteger} = require('./sessionSubject');
const {readPersonAuthority} = require('./identityMysqlRepository');
const { failure } = require('./publicationSpreadsheet');
const { identityParam } = require('./officePublication');
const { SUPPORTED_SCHEMAS } = require('./processNativeFormats');
function exactRows(rows) {
  return rows.map(row => {
    const result = {...row};
    for (const field of ['id','person_id','current_department_id','department_id','manager_person_id','office_id','assignee_person_id','to_dept_id','process_version_id']) {
      if (Object.hasOwn(result, field)) result[field] = identityInteger(result[field]);
    }
    return result;
  });
}
const text = value => String(value == null ? '' : value).trim();
function denied(message) { const error=failure(message,'OFFICE_ACCESS_DENIED');error.statusCode=403;return error; }
function changed() { const error=failure('任务已被其他人更新，请刷新后再办理。','OFFICE_TASK_CHANGED');error.statusCode=409;return error; }
function positiveId(value,label) { const id=identityInteger(value);if(id===null)throw failure(label+'无效');return id; }
const officeSelect=`SELECT CAST(o.org_unit_id AS CHAR) AS id,o.org_unit_code AS code,o.org_unit_name AS name,
  CAST(o.department_id AS CHAR) AS department_id,CAST(o.manager_person_id AS CHAR) AS manager_person_id,o.status,d.name AS department_name,d.code AS department_code,
  p.person_name AS manager_name,p.employee_no AS manager_employee_no
  FROM org_unit o LEFT JOIN departments d ON d.id=o.department_id
  LEFT JOIN person p ON p.person_id=o.manager_person_id WHERE o.org_type='office'`;

async function readPublishedOfficeVersions(db) {
  const placeholders = SUPPORTED_SCHEMAS.map(() => '?').join(',');
  const [rows] = await db.query(`SELECT CAST(id AS CHAR) AS id,document_no,document_title,edition,
    CAST(department_id AS CHAR) AS department_id,process_content_json
    FROM process_design_versions WHERE status='published' AND schema_version IN (${placeholders}) ORDER BY id DESC`, SUPPORTED_SCHEMAS);
  return exactRows(rows).map(row => {
    const document = typeof row.process_content_json === 'string' ? JSON.parse(row.process_content_json) : row.process_content_json;
    return { id: row.id, document_no: row.document_no, title: row.document_title, edition: row.edition,
      department_id: row.department_id, behaviors: (document.behaviors || []).map(item => ({ ref: item.behavior_ref, name: item.behavior_name })) };
  });
}

async function currentActor(db,session,lock=false) {
  const subject=sessionSubject(session);
  if(subject.kind==='system_admin') {
    // Independent administrators have no employee identity. Recheck their
    // current account and fixed read permissions without granting task actions.
    if(lock||session.personId||!identityInteger(subject.accountId)||!identityInteger(subject.authVersion))throw denied('系统管理员只能查阅办公室资料，不能办理办公室任务。');
    const system=require('./systemAdminIdentity'),principal=system.principal(subject.accountId);
    if(subject.principal!==principal)throw denied('当前登录状态已变化，请重新登录处理。');
    const user=await system.getSystemAdmin(db,principal);
    if(!user||user.must_change_password||!sameIdentityInteger(user.authVersion,subject.authVersion))throw denied('当前登录状态已变化或需要修改密码，请重新登录处理。');
    const {permSet}=await system.permissions(db,principal);
    if(!permSet.has('governance:read-global')&&!permSet.has('identity:read'))throw denied('无权查看办公室资料。');
    return {personId:null,admin:true,canReadAll:true,canRoute:false};
  }
  if(subject.kind!=='person'||!identityInteger(subject.personId)||!identityInteger(subject.accountId)||!identityInteger(subject.authVersion))throw denied('当前登录状态已变化或需要修改密码，请重新登录处理。');
  if(lock) {
    await db.execute('SELECT account_id FROM user_accounts WHERE account_id=? FOR UPDATE',[identityParam(subject.accountId)]);
    await db.execute('SELECT person_id FROM person WHERE person_id=? FOR UPDATE',[identityParam(subject.personId)]);
    await db.execute('SELECT person_id FROM person_roles WHERE person_id=? FOR UPDATE',[identityParam(subject.personId)]);
  }
  const personId=identityInteger(subject.personId),authority=await readPersonAuthority(db,session,personId,{currentRead:lock});
  if(!authority.valid)throw denied('当前登录状态已变化或需要修改密码，请重新登录处理。');
  const {permissions:permSet,readOnly:admin}=authority;
  return {personId,admin,canReadAll:permSet.has('governance:read-global')||permSet.has('identity:read'),canRoute:!admin&&permSet.has('governance:assign-work')};
}

function makeOfficeRepository(pool) {
  async function transaction(session,action,analysisTodoId=null) {
    const db=await pool.getConnection();
    try{await db.beginTransaction();if(analysisTodoId!==null)await require('./analysisTaskLock').lockIssueForTask(db,identityParam(positiveId(analysisTodoId,'任务')),false);const actor=await currentActor(db,session,true);const result=await action(db,actor);await db.commit();return result;}
    catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY'){const duplicate=failure('此交办请求已保存，请刷新办公室任务列表。','OFFICE_TASK_ALREADY_CREATED');duplicate.statusCode=409;throw duplicate;}if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code))throw changed();throw error;}
    finally{db.release();}
  }
  async function office(db,id,lock=false) {
    const [rows]=await db.execute(officeSelect+' AND o.org_unit_id=?'+(lock?' FOR UPDATE':''),[identityParam(positiveId(id,'办公室'))]);
    const value=exactRows(rows)[0];if(!value)throw failure('办公室不存在');
    return value;
  }
  async function requireActiveOffice(db,id,lock=false) {
    const value=await office(db,id,lock);
    if(value.status!=='active'||!value.department_id)throw failure('办公室尚未启用或未明确归口部门，请先发布组织架构。');
    // analysisTaskLock may already have established an RR snapshot. Recheck the
    // existing department qualification on this transaction's current state.
    const [departments]=await db.execute("SELECT id FROM departments WHERE id=? AND status='active'"+(lock?' FOR SHARE':''),[identityParam(value.department_id)]);
    if(!departments.length)throw failure('办公室所属部门未启用');
    return value;
  }
  async function member(db,officeId,personId,lock=false) {
    const [members]=await db.execute(`SELECT m.person_id FROM office_membership m JOIN person p ON p.person_id=m.person_id
      WHERE m.office_id=? AND m.person_id=? AND m.status='active' AND p.status='active' AND p.employment_status='active'${lock?' FOR UPDATE':''}`,[identityParam(officeId),identityParam(personId)]);
    return members.length>0;
  }
  async function task(db,id,lock=false) {
    const [rows]=await db.execute(`SELECT t.*,CAST(t.id AS CHAR) AS id,CAST(t.to_dept_id AS CHAR) AS to_dept_id,CAST(a.office_id AS CHAR) AS office_id,CAST(a.assignee_person_id AS CHAR) AS assignee_person_id,CAST(a.process_version_id AS CHAR) AS process_version_id,a.behavior_ref,a.revision_no
      FROM mdm_todos t JOIN mdm_todo_office_assignments a ON a.todo_id=t.id WHERE t.id=?${lock?' FOR UPDATE':''}`,[identityParam(positiveId(id,'任务'))]);
    if(!rows.length)throw failure('办公室任务不存在');return exactRows(rows)[0];
  }
  async function event(db,todoId,type,actor,note) {
    await db.execute('INSERT INTO mdm_todo_events(todo_id,event_type,actor_user_id,actor_person_id,note) VALUES (?,?,?,?,?)',[identityParam(todoId),type,identityParam(actor.personId),identityParam(actor.personId),JSON.stringify(note)]);
  }
  async function source(db,payload) {
    if(!payload.process_version_id) {
      if(text(payload.behavior_ref))throw failure('请先选择业务行为所属的正式流程版本');
      return {versionId:null,behaviorRef:null};
    }
    const versionId=positiveId(payload.process_version_id,'正式流程版本');
    const [rows]=await db.execute("SELECT process_content_json,schema_version,content_hash FROM process_design_versions WHERE id=? AND status='published'",[identityParam(versionId)]);
    if(!rows.length||!require('./processNativeFormats').supports(rows[0].schema_version))throw failure('请选择已发布的当前原生或受支持历史流程版本');
    const document=typeof rows[0].process_content_json==='string'?JSON.parse(rows[0].process_content_json):rows[0].process_content_json;
    const expected=require('./processPreviewReview').contentHash(document);
    if(document?.schema_version!==rows[0].schema_version||expected!==rows[0].content_hash)throw failure('正式流程内容校验失败，不能分派任务');
    const behaviorRef=text(payload.behavior_ref)||null;
    if(behaviorRef&&!(document.behaviors||[]).some(item=>item.behavior_ref===behaviorRef))throw failure('所选业务行为不属于该正式版本');
    return {versionId,behaviorRef};
  }
  return {
    async personalWorkItems(session) {
      const actor = await currentActor(pool, session);
      if (actor.admin) return [];
      const [rows] = await pool.execute(`SELECT CAST(t.id AS CHAR) AS id,t.content,t.urgency,DATE_FORMAT(t.due_date,'%Y-%m-%d') AS due_date,
        CAST(a.office_id AS CHAR) AS office_id,CAST(a.assignee_person_id AS CHAR) AS assignee_person_id,o.org_unit_name AS office_name,d.name AS department_name
        FROM mdm_todo_office_assignments a JOIN mdm_todos t ON t.id=a.todo_id
        JOIN org_unit o ON o.org_unit_id=a.office_id JOIN departments d ON d.id=o.department_id
        WHERE t.status='pending' AND o.status='active' AND (
          (a.assignee_person_id IS NULL AND o.manager_person_id=?) OR
          (a.assignee_person_id=? AND EXISTS(SELECT 1 FROM office_membership m
            WHERE m.office_id=a.office_id AND m.person_id=? AND m.status='active')))
        ORDER BY t.urgency='high' DESC,t.due_date IS NULL,t.due_date,t.id`,
        [identityParam(actor.personId),identityParam(actor.personId),identityParam(actor.personId)]);
      return exactRows(rows).map(row => ({id:'office-task:'+row.id,type:'office_work',title:row.content,
        urgency:row.urgency,dueDate:row.due_date,department:row.department_name,
        source:row.office_name,canAct:true,currentStatus:'pending',
        target:'#/officeWorkbench?office_id='+row.office_id,
        actionLabel:row.assignee_person_id?'办理办公室任务':'分配办公室成员',
        nextStep:row.assignee_person_id?'填写办理结果并办结':'为任务选择本办公室成员'}));
    },
    async closureWorkItems(session) {
      const actor=await currentActor(pool,session);if(actor.admin)return [];
      return require('./analysisClosureWorkbench')(pool,session);
    },
    async workbench(session,officeId) {
      const actor=await currentActor(pool,session);
      const [officeRows]=await pool.execute(officeSelect+(actor.canReadAll?'':` AND (o.manager_person_id=? OR EXISTS(SELECT 1 FROM office_membership m WHERE m.office_id=o.org_unit_id AND m.person_id=? AND m.status='active'))`)+' ORDER BY d.name,o.org_unit_code',actor.canReadAll?[]:[identityParam(actor.personId),identityParam(actor.personId)]);
      const offices=exactRows(officeRows);
      const selected=officeId?offices.find(row=>sameIdentityInteger(row.id,positiveId(officeId,'办公室'))):offices.find(row=>row.status==='active'&&row.department_id)||offices.find(row=>row.status==='active')||offices[0];
      if(officeId&&!selected)throw denied('无权查看该办公室');
      let members=[],tasks=[];
      if(selected) {
        [members]=await pool.execute(`SELECT CAST(p.person_id AS CHAR) AS person_id,p.employee_no,p.person_name,CAST(p.current_department_id AS CHAR) AS current_department_id,p.employment_status,p.status,
          d.name AS department_name FROM office_membership m JOIN person p ON p.person_id=m.person_id
          LEFT JOIN departments d ON d.id=p.current_department_id WHERE m.office_id=? AND m.status='active' ORDER BY p.employee_no`,[identityParam(selected.id)]);
        [tasks]=await pool.execute(`SELECT CAST(t.id AS CHAR) AS id,t.content,t.status,t.urgency,DATE_FORMAT(t.due_date,'%Y-%m-%d') AS due_date,CAST(t.to_dept_id AS CHAR) AS to_dept_id,CAST(a.office_id AS CHAR) AS office_id,CAST(a.assignee_person_id AS CHAR) AS assignee_person_id,a.revision_no,
          CAST(a.process_version_id AS CHAR) AS process_version_id,a.behavior_ref,p.person_name AS assignee_name,v.document_title AS process_name,v.edition AS process_edition,v.process_content_json AS source_json,
          d.name AS owning_department_name,UNIX_TIMESTAMP(t.done_at) AS done_epoch,
          (SELECT e.note FROM mdm_todo_events e WHERE e.todo_id=t.id AND e.event_type='office_task_completed' ORDER BY e.id DESC LIMIT 1) AS completion_json
          FROM mdm_todo_office_assignments a JOIN mdm_todos t ON t.id=a.todo_id
          LEFT JOIN person p ON p.person_id=a.assignee_person_id LEFT JOIN process_design_versions v ON v.id=a.process_version_id
          LEFT JOIN departments d ON d.id=v.department_id WHERE a.office_id=? ORDER BY t.status='pending' DESC,t.created_at DESC`,[identityParam(selected.id)]);
        members=exactRows(members);
        tasks=exactRows(tasks).map(({source_json,...task})=>{let behaviorName='';if(source_json&&task.behavior_ref){const document=typeof source_json==='string'?JSON.parse(source_json):source_json;behaviorName=(document.behaviors||[]).find(b=>b.behavior_ref===task.behavior_ref)?.behavior_name||'';}return {...task,behavior_name:behaviorName};});
        tasks=await require('./officeAnalysisTasks').decorate(pool,actor,tasks,selected.manager_person_id);
      }
      let versions=[],unallocated=[];
      if(actor.canRoute) {
        versions=await readPublishedOfficeVersions(pool);
        [unallocated]=await pool.query("SELECT CAST(t.id AS CHAR) AS id,t.content,CAST(t.to_dept_id AS CHAR) AS to_dept_id,d.name AS department_name FROM mdm_todos t LEFT JOIN departments d ON d.id=t.to_dept_id LEFT JOIN mdm_todo_office_assignments a ON a.todo_id=t.id WHERE a.todo_id IS NULL AND t.status='pending' ORDER BY t.id DESC");
      }
      unallocated=exactRows(unallocated);
      return {offices,selected_office_id:selected?.id||null,members,tasks,versions,unallocated,actor_person_id:actor.personId,
        can_route:actor.canRoute,can_assign:Boolean(!actor.admin&&selected&&sameIdentityInteger(selected.manager_person_id,actor.personId)),can_complete:!actor.admin};
    },
    async createTask(session,payload) {
      return transaction(session,async(db,actor)=>{
        if(!actor.canRoute)throw denied('办公室承接任务由具备治理分派职责的人员办理');
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(payload.request_id)))throw failure('交办请求标识无效，请重新打开交办窗口');
        const target=await requireActiveOffice(db,payload.office_id,true),content=text(payload.content);
        if(!content||content.length>16000)throw failure('请填写不超过16000个字符的工作内容');
        const urgency=text(payload.urgency)||'medium';if(!['low','medium','high'].includes(urgency))throw failure('紧急程度无效');
        const due=text(payload.due_date)||null;if(due&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||Number.isNaN(Date.parse(due))||new Date(due).toISOString().slice(0,10)!==due))throw failure('截止日期无效');
        const linked=await source(db,payload);
        const [result]=await db.execute("INSERT INTO mdm_todos(to_dept_id,type,content,due_date,urgency,created_by,created_by_person_id) VALUES (?,'office_work',?,?,?,?,?)",[identityParam(target.department_id),content,due,urgency,identityParam(actor.personId),identityParam(actor.personId)]);
        // mysql2's insertId may already be rounded; read the server value on the
        // same transaction/connection instead of reconstructing it from Number.
        const [[inserted]]=await db.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
        const createdId=positiveId(inserted.id,'任务');
        await db.execute('INSERT INTO mdm_todo_office_assignments(todo_id,office_id,process_version_id,behavior_ref,assigned_by_person_id,request_id) VALUES (?,?,?,?,?,?)',[identityParam(createdId),identityParam(target.id),identityParam(linked.versionId),linked.behaviorRef,identityParam(actor.personId),payload.request_id]);
        await event(db,createdId,'office_received',actor,{office_id:target.id,process_version_id:linked.versionId,behavior_ref:linked.behaviorRef});
        return {id:createdId,revision_no:1};
      });
    },
    async routeExistingTask(session,todoId,payload) {
      return transaction(session,async(db,actor)=>{
        if(!actor.canRoute)throw denied('无办公室分派权限');
        const target=await requireActiveOffice(db,payload.office_id,true);
        const [rows]=await db.execute('SELECT CAST(id AS CHAR) AS id,status,CAST(to_dept_id AS CHAR) AS to_dept_id FROM mdm_todos WHERE id=? FOR UPDATE',[identityParam(positiveId(todoId,'任务'))]);
        const [assigned]=await db.execute('SELECT todo_id FROM mdm_todo_office_assignments WHERE todo_id=? FOR UPDATE',[identityParam(positiveId(todoId,'任务'))]);
        if(!rows.length||rows[0].status!=='pending'||assigned.length)throw changed();
        if(rows[0].to_dept_id&&!sameIdentityInteger(rows[0].to_dept_id,target.department_id))throw failure('办公室必须属于原待办的接收部门');
        await db.execute('INSERT INTO mdm_todo_office_assignments(todo_id,office_id,assigned_by_person_id) VALUES (?,?,?)',[identityParam(positiveId(todoId,'任务')),identityParam(target.id),identityParam(actor.personId)]);
        await db.execute('UPDATE mdm_todos SET to_dept_id=? WHERE id=?',[identityParam(target.department_id),identityParam(positiveId(todoId,'任务'))]);
        await event(db,todoId,'office_received',actor,{office_id:target.id});return {id:positiveId(todoId,'任务'),revision_no:1};
      });
    },
    async assignPerson(session,todoId,payload) {
      return transaction(session,async(db,actor)=>{
        const current=await task(db,todoId,true),target=await requireActiveOffice(db,current.office_id,true);
        if(actor.admin||!sameIdentityInteger(target.manager_person_id,actor.personId))throw denied('只有该办公室负责人可以分配人员');
        await require('./analysisTaskLock').lockIssueForTask(db,identityParam(positiveId(todoId,'任务')));
        if(current.status!=='pending'||Number(payload.expected_revision)!==Number(current.revision_no))throw changed();
        const personId=positiveId(payload.assignee_person_id,'办理人员');
        if(!await member(db,target.id,personId,true))throw failure('办理人员必须是该办公室当前有效成员');
        await db.execute('UPDATE mdm_todo_office_assignments SET assignee_person_id=?,assigned_by_person_id=?,assigned_at=CURRENT_TIMESTAMP,revision_no=revision_no+1 WHERE todo_id=?',[identityParam(personId),identityParam(actor.personId),identityParam(positiveId(todoId,'任务'))]);
        await event(db,todoId,'office_person_assigned',actor,{office_id:target.id,from_person_id:current.assignee_person_id,to_person_id:personId});return {id:positiveId(todoId,'任务'),revision_no:Number(current.revision_no)+1};
      },todoId);
    },
    async completeTask(session,todoId,payload) {
      return transaction(session,async(db,actor)=>{
        const current=await task(db,todoId,true);await requireActiveOffice(db,current.office_id,true);
        if(actor.admin||!sameIdentityInteger(current.assignee_person_id,actor.personId)||!await member(db,current.office_id,actor.personId,true))throw denied('只有当前被分配的办公室成员可以办结此任务');
        await require('./analysisTaskLock').lockIssueForTask(db,identityParam(positiveId(todoId,'任务')));
        if(current.status!=='pending'||Number(payload.expected_revision)!==Number(current.revision_no))throw changed();
        const note=text(payload.note);if(!note||note.length>4000)throw failure('请填写不超过4000个字符的办理结果');
        await db.execute("UPDATE mdm_todos SET status='done',done_at=CURRENT_TIMESTAMP,completed_by=?,completed_by_person_id=? WHERE id=?",[identityParam(actor.personId),identityParam(actor.personId),identityParam(positiveId(todoId,'任务'))]);
        await db.execute('UPDATE mdm_todo_office_assignments SET revision_no=revision_no+1 WHERE todo_id=?',[identityParam(positiveId(todoId,'任务'))]);
        await event(db,todoId,'office_task_completed',actor,{office_id:current.office_id,note});return {id:positiveId(todoId,'任务'),status:'done',revision_no:Number(current.revision_no)+1};
      },todoId);
    }
  };
}
module.exports={makeOfficeRepository,currentActor,readPublishedOfficeVersions};
