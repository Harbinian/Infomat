// Operational office assignments do not grant workflow review or publication rights.
const { makeIdentityMysqlRepository } = require('./identityMysqlRepository');
const { failure } = require('./publicationSpreadsheet');
const text = value => String(value == null ? '' : value).trim();
function denied(message) { const error=failure(message,'OFFICE_ACCESS_DENIED');error.statusCode=403;return error; }
function changed() { const error=failure('任务已被其他人更新，请刷新后再办理。','OFFICE_TASK_CHANGED');error.statusCode=409;return error; }
function positiveId(value,label) { const id=Number(value);if(!Number.isSafeInteger(id)||id<1)throw failure(label+'无效');return id; }
const officeSelect=`SELECT o.org_unit_id AS id,o.org_unit_code AS code,o.org_unit_name AS name,
  o.department_id,o.manager_person_id,o.status,d.name AS department_name,d.code AS department_code,
  p.person_name AS manager_name,p.employee_no AS manager_employee_no
  FROM org_unit o LEFT JOIN departments d ON d.id=o.department_id
  LEFT JOIN person p ON p.person_id=o.manager_person_id WHERE o.org_type='office'`;

async function currentActor(db,session,lock=false) {
  if(lock) {
    await db.execute('SELECT account_id FROM user_accounts WHERE account_id=? FOR UPDATE',[Number(session.accountId)]);
    await db.execute('SELECT person_id FROM person WHERE person_id=? FOR UPDATE',[Number(session.personId)]);
    await db.execute('SELECT person_id FROM person_roles WHERE person_id=? FOR UPDATE',[Number(session.personId)]);
  }
  const identity=makeIdentityMysqlRepository(db);
  const validation=await identity.validateSession(session);
  if(!validation.valid || validation.user.must_change_password)throw denied('当前登录状态已变化或需要修改密码，请重新登录处理。');
  const personId=Number(session.personId),[{permSet},roles]=await Promise.all([identity.getUserEffectivePermissions(personId),identity.getUserRoleCodes(personId)]);
  const admin=roles.some(role=>(role.code||role.role_code)==='admin');
  return {personId,admin,canReadAll:permSet.has('governance:read-global')||permSet.has('identity:read'),canRoute:!admin&&permSet.has('governance:assign-work')};
}

function makeOfficeRepository(pool) {
  async function transaction(session,action) {
    const db=await pool.getConnection();
    try{await db.beginTransaction();const actor=await currentActor(db,session,true);const result=await action(db,actor);await db.commit();return result;}
    catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY'){const duplicate=failure('此交办请求已保存，请刷新办公室任务列表。','OFFICE_TASK_ALREADY_CREATED');duplicate.statusCode=409;throw duplicate;}if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code))throw changed();throw error;}
    finally{db.release();}
  }
  async function office(db,id,lock=false) {
    const [rows]=await db.execute(officeSelect+' AND o.org_unit_id=?'+(lock?' FOR UPDATE':''),[positiveId(id,'办公室')]);
    const value=rows[0];if(!value)throw failure('办公室不存在');
    return value;
  }
  async function requireActiveOffice(db,id,lock=false) {
    const value=await office(db,id,lock);
    if(value.status!=='active'||!value.department_id)throw failure('办公室尚未启用或未明确归口部门，请先发布组织架构。');
    const [departments]=await db.execute("SELECT id FROM departments WHERE id=? AND status='active'",[value.department_id]);
    if(!departments.length)throw failure('办公室所属部门未启用');
    return value;
  }
  async function member(db,officeId,personId,lock=false) {
    const [members]=await db.execute(`SELECT m.person_id FROM office_membership m JOIN person p ON p.person_id=m.person_id
      WHERE m.office_id=? AND m.person_id=? AND m.status='active' AND p.status='active' AND p.employment_status='active'${lock?' FOR UPDATE':''}`,[officeId,personId]);
    return members.length>0;
  }
  async function task(db,id,lock=false) {
    const [rows]=await db.execute(`SELECT t.*,a.office_id,a.assignee_person_id,a.process_version_id,a.behavior_ref,a.revision_no
      FROM mdm_todos t JOIN mdm_todo_office_assignments a ON a.todo_id=t.id WHERE t.id=?${lock?' FOR UPDATE':''}`,[positiveId(id,'任务')]);
    if(!rows.length)throw failure('办公室任务不存在');return rows[0];
  }
  async function event(db,todoId,type,actor,note) {
    await db.execute('INSERT INTO mdm_todo_events(todo_id,event_type,actor_user_id,actor_person_id,note) VALUES (?,?,?,?,?)',[todoId,type,actor.personId,actor.personId,JSON.stringify(note)]);
  }
  async function source(db,payload) {
    if(!payload.process_version_id) {
      if(text(payload.behavior_ref))throw failure('请先选择业务行为所属的正式流程版本');
      return {versionId:null,behaviorRef:null};
    }
    const versionId=positiveId(payload.process_version_id,'正式流程版本');
    const [rows]=await db.execute("SELECT process_content_json,schema_version,content_hash FROM process_design_versions WHERE id=? AND status='published'",[versionId]);
    if(!rows.length||rows[0].schema_version!=='process-governance-v7')throw failure('请选择已发布的V7流程版本');
    const document=typeof rows[0].process_content_json==='string'?JSON.parse(rows[0].process_content_json):rows[0].process_content_json;
    const expected=require('./processV7PreviewReview').contentHash(document);
    if(expected!==rows[0].content_hash)throw failure('正式流程内容校验失败，不能分派任务');
    const behaviorRef=text(payload.behavior_ref)||null;
    if(behaviorRef&&!(document.behaviors||[]).some(item=>item.behavior_ref===behaviorRef))throw failure('所选业务行为不属于该正式版本');
    return {versionId,behaviorRef};
  }
  return {
    async workbench(session,officeId) {
      const actor=await currentActor(pool,session);
      const [offices]=await pool.execute(officeSelect+(actor.canReadAll?'':` AND (o.manager_person_id=? OR EXISTS(SELECT 1 FROM office_membership m WHERE m.office_id=o.org_unit_id AND m.person_id=? AND m.status='active'))`)+' ORDER BY d.name,o.org_unit_code',actor.canReadAll?[]:[actor.personId,actor.personId]);
      const selected=officeId?offices.find(row=>Number(row.id)===positiveId(officeId,'办公室')):offices.find(row=>row.status==='active'&&row.department_id)||offices.find(row=>row.status==='active')||offices[0];
      if(officeId&&!selected)throw denied('无权查看该办公室');
      let members=[],tasks=[];
      if(selected) {
        [members]=await pool.execute(`SELECT p.person_id,p.employee_no,p.person_name,p.current_department_id,p.employment_status,p.status,
          d.name AS department_name FROM office_membership m JOIN person p ON p.person_id=m.person_id
          LEFT JOIN departments d ON d.id=p.current_department_id WHERE m.office_id=? AND m.status='active' ORDER BY p.employee_no`,[selected.id]);
        [tasks]=await pool.execute(`SELECT t.id,t.content,t.status,t.urgency,DATE_FORMAT(t.due_date,'%Y-%m-%d') AS due_date,t.to_dept_id,a.office_id,a.assignee_person_id,a.revision_no,
          a.process_version_id,a.behavior_ref,p.person_name AS assignee_name,v.document_title AS process_name,v.edition AS process_edition,v.process_content_json AS source_json,
          d.name AS owning_department_name,UNIX_TIMESTAMP(t.done_at) AS done_epoch,
          (SELECT e.note FROM mdm_todo_events e WHERE e.todo_id=t.id AND e.event_type='office_task_completed' ORDER BY e.id DESC LIMIT 1) AS completion_json
          FROM mdm_todo_office_assignments a JOIN mdm_todos t ON t.id=a.todo_id
          LEFT JOIN person p ON p.person_id=a.assignee_person_id LEFT JOIN process_design_versions v ON v.id=a.process_version_id
          LEFT JOIN departments d ON d.id=v.department_id WHERE a.office_id=? ORDER BY t.status='pending' DESC,t.created_at DESC`,[selected.id]);
        tasks=tasks.map(({source_json,...task})=>{let behaviorName='';if(source_json&&task.behavior_ref){const document=typeof source_json==='string'?JSON.parse(source_json):source_json;behaviorName=(document.behaviors||[]).find(b=>b.behavior_ref===task.behavior_ref)?.behavior_name||'';}return {...task,behavior_name:behaviorName};});
      }
      let versions=[],unallocated=[];
      if(actor.canRoute) {
        const [rows]=await pool.query("SELECT id,document_no,document_title,edition,department_id,process_content_json FROM process_design_versions WHERE status='published' AND schema_version='process-governance-v7' ORDER BY id DESC");
        versions=rows.map(row=>{const document=typeof row.process_content_json==='string'?JSON.parse(row.process_content_json):row.process_content_json;return {id:row.id,document_no:row.document_no,title:row.document_title,edition:row.edition,department_id:row.department_id,behaviors:(document.behaviors||[]).map(item=>({ref:item.behavior_ref,name:item.behavior_name}))};});
        [unallocated]=await pool.query("SELECT t.id,t.content,t.to_dept_id,d.name AS department_name FROM mdm_todos t LEFT JOIN departments d ON d.id=t.to_dept_id LEFT JOIN mdm_todo_office_assignments a ON a.todo_id=t.id WHERE a.todo_id IS NULL AND t.status='pending' ORDER BY t.id DESC");
      }
      return {offices,selected_office_id:selected?.id||null,members,tasks,versions,unallocated,actor_person_id:actor.personId,
        can_route:actor.canRoute,can_assign:Boolean(!actor.admin&&selected&&Number(selected.manager_person_id)===actor.personId),can_complete:!actor.admin};
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
        const [result]=await db.execute("INSERT INTO mdm_todos(to_dept_id,type,content,due_date,urgency,created_by,created_by_person_id) VALUES (?,'office_work',?,?,?,?,?)",[target.department_id,content,due,urgency,actor.personId,actor.personId]);
        await db.execute('INSERT INTO mdm_todo_office_assignments(todo_id,office_id,process_version_id,behavior_ref,assigned_by_person_id,request_id) VALUES (?,?,?,?,?,?)',[result.insertId,target.id,linked.versionId,linked.behaviorRef,actor.personId,payload.request_id]);
        await event(db,result.insertId,'office_received',actor,{office_id:target.id,process_version_id:linked.versionId,behavior_ref:linked.behaviorRef});
        return {id:result.insertId,revision_no:1};
      });
    },
    async routeExistingTask(session,todoId,payload) {
      return transaction(session,async(db,actor)=>{
        if(!actor.canRoute)throw denied('无办公室分派权限');
        const target=await requireActiveOffice(db,payload.office_id,true);
        const [rows]=await db.execute('SELECT id,status,to_dept_id FROM mdm_todos WHERE id=? FOR UPDATE',[positiveId(todoId,'任务')]);
        const [assigned]=await db.execute('SELECT todo_id FROM mdm_todo_office_assignments WHERE todo_id=? FOR UPDATE',[todoId]);
        if(!rows.length||rows[0].status!=='pending'||assigned.length)throw changed();
        if(rows[0].to_dept_id&&Number(rows[0].to_dept_id)!==Number(target.department_id))throw failure('办公室必须属于原待办的接收部门');
        await db.execute('INSERT INTO mdm_todo_office_assignments(todo_id,office_id,assigned_by_person_id) VALUES (?,?,?)',[todoId,target.id,actor.personId]);
        await db.execute('UPDATE mdm_todos SET to_dept_id=? WHERE id=?',[target.department_id,todoId]);
        await event(db,todoId,'office_received',actor,{office_id:target.id});return {id:Number(todoId),revision_no:1};
      });
    },
    async assignPerson(session,todoId,payload) {
      return transaction(session,async(db,actor)=>{
        const current=await task(db,todoId,true),target=await requireActiveOffice(db,current.office_id,true);
        if(actor.admin||Number(target.manager_person_id)!==actor.personId)throw denied('只有该办公室负责人可以分配人员');
        if(current.status!=='pending'||Number(payload.expected_revision)!==Number(current.revision_no))throw changed();
        const personId=positiveId(payload.assignee_person_id,'办理人员');
        if(!await member(db,target.id,personId,true))throw failure('办理人员必须是该办公室当前有效成员');
        await db.execute('UPDATE mdm_todo_office_assignments SET assignee_person_id=?,assigned_by_person_id=?,assigned_at=CURRENT_TIMESTAMP,revision_no=revision_no+1 WHERE todo_id=?',[personId,actor.personId,todoId]);
        await event(db,todoId,'office_person_assigned',actor,{office_id:target.id,from_person_id:current.assignee_person_id,to_person_id:personId});return {id:Number(todoId),revision_no:Number(current.revision_no)+1};
      });
    },
    async completeTask(session,todoId,payload) {
      return transaction(session,async(db,actor)=>{
        const current=await task(db,todoId,true);await requireActiveOffice(db,current.office_id,true);
        if(actor.admin||Number(current.assignee_person_id)!==actor.personId||!await member(db,current.office_id,actor.personId,true))throw denied('只有当前被分配的办公室成员可以办结此任务');
        if(current.status!=='pending'||Number(payload.expected_revision)!==Number(current.revision_no))throw changed();
        const note=text(payload.note);if(!note||note.length>4000)throw failure('请填写不超过4000个字符的办理结果');
        await db.execute("UPDATE mdm_todos SET status='done',done_at=CURRENT_TIMESTAMP,completed_by=?,completed_by_person_id=? WHERE id=?",[actor.personId,actor.personId,todoId]);
        await db.execute('UPDATE mdm_todo_office_assignments SET revision_no=revision_no+1 WHERE todo_id=?',[todoId]);
        await event(db,todoId,'office_task_completed',actor,{office_id:current.office_id,note});return {id:Number(todoId),status:'done',revision_no:Number(current.revision_no)+1};
      });
    }
  };
}
module.exports={makeOfficeRepository,currentActor};
