// Sidecar records never rewrite source JSON, old reviews, or published versions.
// The caller owns case -> review-item locks, the current actor and transaction.
const crypto = require('node:crypto');
const {identityInteger,sameIdentityInteger:same} = require('./sessionSubject');
const accountability = require('./departmentAccountability');
const schema = require('./processCaseGovernanceSchema');
const {timestampColumns,timeRow}=require('./governanceTimeProjection');
const text = value => String(value == null ? '' : value).trim();
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const canonical = value => Array.isArray(value) ? '['+value.map(canonical).join(',')+']' : value && typeof value === 'object'
  ? '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}' : JSON.stringify(value);
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const id = value => {const n=identityInteger(value);if(n==null)throw fail('INPUT_INVALID','标识无效',422);return String(n);};
function fail(code,message,statusCode=409,extra={}) {return Object.assign(new Error(message),{code:'PROCESS_CASE_'+code,statusCode,payload:{code:'PROCESS_CASE_'+code,error:message,...extra}});}
async function one(db,sql,params=[]) {return (await db.execute(sql,params))[0][0]||null;}
function changeTimeRow(row) {
  const result=timeRow(row),instant=result.__registered_at_instant;
  result.registered_at=instant==null?null:new Date(Math.round(Number(instant)*1000)).toISOString();
  delete result.__registered_at_instant;
  return result;
}
const missingMaterialNames={purpose:'编制目的',revision_reason:'修订原因',change_summary:'本次变化说明',sources:'来源材料',participants:'参与部门及责任范围',
  revision_reason_and_change_summary:'修订原因及本次变化说明',purpose_or_revision_reason:'编制目的或修订原因'};
function lead(actor) {return !actor.roleCodes.has('admin')&&actor.roleCodes.has('mdm_lead')&&actor.permissions.has('governance:assign-work');}
function assertSubmitter(actor,ownerId) {
  if(actor.roleCodes.has('admin')||!actor.personId||!actor.roleCodes.has('department_contact')||
    !actor.permissions.has('governance:draft-department')||!actor.permissions.has('governance:submit-department')||!same(actor.departmentId,ownerId))
    throw fail('SUBMITTER_REQUIRED','须由实际归口部门当前有效主对接人本人提交，组长不能代编代交',403);
}
function validDate(value) {if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const date=new Date(value+'T00:00:00Z');return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value;}
function bounded(value,label,required=false) {const v=text(value);if((required&&!v)||v.length>4000)throw fail('INPUT_INVALID',label+'须填写且不超过4000字',422);return v;}
function normalizeParticipants(value,departments,document,ownerId) {
  if(value==null)return null;
  if(!Array.isArray(value)||value.length>500)throw fail('SCOPE_INVALID','参与部门范围必须是明确的部门清单',422);
  const seen=new Set(),refs=new Set((document.behaviors||[]).map(b=>b.behavior_ref));
  const result=value.map(p=>{
    const departmentId=id(p.department_id),department=departments.find(d=>same(d.id,departmentId));
    if(!department||seen.has(departmentId))throw fail('SCOPE_INVALID','参与部门重复或不是当前有效部门',422);
    seen.add(departmentId);
    if(!Array.isArray(p.behavior_refs)||p.behavior_refs.some(ref=>!refs.has(ref))||new Set(p.behavior_refs).size!==p.behavior_refs.length)
      throw fail('SCOPE_INVALID','请明确本部门行为引用；空清单表示核对完整当前流程，不猜动态角色',422);
    return {department_id:departmentId,department_name:department.name,behavior_refs:[...p.behavior_refs].sort(),
      responsibilities:bounded(p.responsibilities,'本部门责任范围',true),basis:bounded(p.basis,'参与依据',true)};
  }).sort((a,b)=>a.department_id.localeCompare(b.department_id));
  if(!result.some(p=>same(p.department_id,ownerId)))throw fail('SCOPE_INVALID','明确范围须包含归口部门',422);
  return result;
}
function normalizeSubmission(input={},document,departments,ownerId,{revision=false}={}) {
  const sources=input.sources==null?[]:input.sources;
  if(!Array.isArray(sources)||sources.length>500)throw fail('SUBMISSION_INVALID','来源材料清单无效',422);
  const result={sources:sources.map(s=>({reference:bounded(s.reference,'来源定位',true),title:bounded(s.title,'来源名称',true),basis:bounded(s.basis,'编制依据',true)})),
    purpose:bounded(input.purpose||document.process?.purpose,'新编目的'),revision_reason:bounded(input.revision_reason,'修订原因'),
    change_summary:bounded(input.change_summary,'变化说明'),participants:normalizeParticipants(input.participants,departments,document,ownerId)};
  result.missing=[];
  if(!result.sources.length)result.missing.push('sources');
  if(!result.participants)result.missing.push('participants');
  if(revision&&(!result.revision_reason||!result.change_summary))result.missing.push('revision_reason_and_change_summary');
  if(!revision&&!result.purpose)result.missing.push('purpose');
  return result;
}
async function assertSchema(db) {if(!(await schema.inspectSchema(db)).ready)throw fail('GOVERNANCE_SCHEMA_REQUIRED','案例治理结构尚未准备，不能办理或放行正式流转',503);}
async function read(db,c) {
  if(!(await schema.inspectSchema(db)).ready)return {schema_ready:false,submission:null,changes:[],lifecycle:'unknown',deadline:null,
    blocking_issues:[{code:'PROCESS_CASE_GOVERNANCE_SCHEMA_REQUIRED',message:'案例治理结构尚未准备，正式办理保持关闭。'}]};
  const submission=timeRow(await one(db,`SELECT *,${timestampColumns('',['created_at'])} FROM process_case_submissions WHERE case_id=? AND revision_id=? ORDER BY record_no DESC LIMIT 1`,[c.id,c.current_revision_id]));
  const [rows]=await db.execute(`SELECT *,${timestampColumns('',['created_at'])},UNIX_TIMESTAMP(registered_at) AS __registered_at_instant FROM process_case_changes WHERE case_id=? ORDER BY record_no`,[c.id]);
  const [usageEvents]=await db.execute("SELECT id,case_id,revision_id,basis_text,payload_json FROM process_v7_preview_events WHERE case_id=? AND event_type='process_case_confirmation_usage_restricted' ORDER BY id",[c.id]);
  const changes=[];let lifecycle='active',deadline=null;
  for(const stored of rows){const row=changeTimeRow(stored),value=parse(row.change_json);if(digest(value)!==row.change_digest)throw fail('HISTORY_INVALID','治理记录摘要不一致');
    const [confirmations]=await db.execute(`SELECT *,${timestampColumns('',['created_at'])},CAST(department_id AS CHAR) department_id,CAST(confirmed_by_person_id AS CHAR) confirmed_by_person_id FROM process_case_change_confirmations WHERE change_id=? ORDER BY record_no`,[row.change_id]);
    const current=Number(row.revision_no)===Number(c.current_revision_no)&&row.content_hash===c.current_content_hash;
    const projected={...row,change:value,current,confirmations:confirmations.map(x=>({...timeRow(x),evidence:parse(x.evidence_json)}))};
    changes.push(projected);
    if(row.state==='registered'&&row.kind==='lifecycle')lifecycle=value.operation==='resume'?'active':value.operation==='pause'?'paused':'terminated';
    if(row.state==='registered'&&row.kind==='deadline'&&current)deadline=value;
  }
  require('./processCaseConfirmationUsage').applyConfirmationUsage(changes,usageEvents);
  for(const change of changes)change.confirmation_states=change.current&&change.state!=='cancelled'?await confirmationsCurrent(db,change,c):[];
  const value=submission?parse(submission.submission_json):null;
  if(deadline&&deadline.scope_digest!==digest(value?.participants||null))deadline=null;
  const blocking=[];
  if(!value||value.missing?.length)blocking.push({code:'PROCESS_CASE_SUBMISSION_INCOMPLETE',message:'最低提交材料待补正：'+(value?.missing||['sources','participants','purpose_or_revision_reason']).map(key=>missingMaterialNames[key]||'其他必要材料').join('、')});
  if(!value?.participants)blocking.push({code:'PROCESS_CASE_PARTICIPANTS_PENDING',message:'实际参与部门范围未明确，不能从动态角色推测。'});
  if(lifecycle!=='active')blocking.push({code:'PROCESS_CASE_INACTIVE',message:'本轮编制已暂停或终止，须在原案例登记恢复。'});
  if(changes.some(x=>x.state==='pending'&&(x.kind!=='submission'||x.current&&x.change.submission_id===submission?.submission_id&&x.change.submission_digest===digest(value))))blocking.push({code:'PROCESS_CASE_CHANGE_PENDING',message:'范围、归口、状态或时限变更尚有未分别确认并登记的事项。'});
  if(!deadline)blocking.push({code:'PROCESS_CASE_DEADLINE_PENDING',message:'组长与相关部门负责人尚未约定本轮办理截止日期。'});
  const material=[...changes].reverse().find(x=>x.kind==='submission'&&x.state==='registered'&&x.current&&x.change.submission_id===submission?.submission_id&&x.change.submission_digest===digest(value));
  if(!material)blocking.push({code:'PROCESS_CASE_SUBMISSION_CONFIRMATION_PENDING',message:'归口部门负责人尚未本人确认当前完整提交材料。'});
  else if(material.confirmation_states.some(x=>!x.valid))blocking.push({code:'PROCESS_CASE_SUBMISSION_RECONFIRMATION_REQUIRED',message:material.confirmation_states.some(x=>x.reason==='functional_test_only')?'本次操作仅用于功能测试，不计作部门确认；当前提交材料仍待部门负责人正式核对确认。':'当前提交材料的部门负责人确认资格已变化，须重新本人确认。'});
  const agreed=[...changes].reverse().find(x=>x.kind==='deadline'&&x.state==='registered'&&x.current&&x.change.scope_digest===digest(value?.participants||null));
  if(agreed?.confirmation_states.some(x=>!x.valid))blocking.push({code:'PROCESS_CASE_DEADLINE_RECONFIRMATION_REQUIRED',message:'约定时限的负责人确认已失效，须重新约定。'});
  const [acceptances]=await db.execute("SELECT CAST(id AS CHAR) event_id,payload_json FROM process_v7_preview_events WHERE case_id=? AND event_type='process_case_business_acceptance' ORDER BY id DESC LIMIT 50",[c.id]);
  return {schema_ready:true,submission:value,submission_id:submission?.submission_id||null,changes,lifecycle,deadline,blocking_issues:blocking,
    acceptance_history:acceptances.map(a=>({event_id:a.event_id,...parse(a.payload_json),current:Number(parse(a.payload_json).source_revision_no)===Number(c.current_revision_no)&&parse(a.payload_json).source_content_hash===c.current_content_hash})),retention_years:null,automatic_deletion:false};
}
async function assertActive(db,c) {const g=await read(db,c);if(!g.schema_ready)throw fail('GOVERNANCE_SCHEMA_REQUIRED','案例治理结构尚未准备',503);if(g.lifecycle!=='active'||c.status==='closed')throw fail('INACTIVE','本轮编制已暂停、终止或属于历史关闭案例，请先核对原案例恢复条件');return g;}
async function saveSubmission(db,c,document,departments,input,actor,{revision=false,allowScopeChange=false}={}) {
  await assertSchema(db);assertSubmitter(actor,c.owning_department_id);
  const prior=await read(db,c);
  const value=normalizeSubmission(input,document,departments,c.owning_department_id,{revision});
  if(prior.submission?.participants&&!allowScopeChange&&digest(prior.submission.participants)!==digest(value.participants))throw fail('SCOPE_CHANGE_REQUIRED','实际范围变化须建立变更，由受影响及退出部门分别确认');
  if(prior.submission&&digest(prior.submission)===digest(value))return {...prior.submission,submission_id:prior.submission_id};
  const submissionId=crypto.randomUUID();
  await db.execute('INSERT INTO process_case_submissions(submission_id,case_id,revision_id,revision_no,content_hash,submission_json,submitted_by_person_id) VALUES (?,?,?,?,?,?,?)',
    [submissionId,c.id,c.current_revision_id,c.current_revision_no,c.current_content_hash,JSON.stringify(value),id(actor.personId)]);
  await createSubmissionTask(db,c,value,actor,submissionId);
  return {...value,submission_id:submissionId};
}
async function createSubmissionTask(db,c,value,actor,submissionId){
  if(value.missing.length||!value.participants)return;
  const change={kind:'submission',reason:'提交材料及本部门责任范围核对',basis:'当前提交材料',submission_id:submissionId,submission_digest:digest(value),required_department_ids:value.participants.map(p=>p.department_id)};
  const changeId=crypto.randomUUID();
  await db.execute('INSERT INTO process_case_changes(change_id,case_id,revision_id,revision_no,content_hash,kind,change_json,change_digest,state,proposed_by_person_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [changeId,c.id,c.current_revision_id,c.current_revision_no,c.current_content_hash,'submission',JSON.stringify(change),digest(change),'pending',id(actor.personId)]);
}
function scopeAffected(before,after,ownerId) {const a=new Map((before||[]).map(p=>[p.department_id,p])),b=new Map((after||[]).map(p=>[p.department_id,p]));
  return [...new Set([String(ownerId),...[...new Set([...a.keys(),...b.keys()])].filter(k=>canonical(a.get(k)||null)!==canonical(b.get(k)||null))])].sort();}
async function propose(db,c,document,departments,body,actor) {
  await assertSchema(db);const g=await read(db,c),kind=text(body.kind),reason=bounded(body.reason,'原因',true),basis=bounded(body.basis,'依据',true);
  if(!['scope','owner','lifecycle','deadline','submission'].includes(kind))throw fail('CHANGE_INVALID','治理变更类别无效',422);
  if(!(lead(actor)||same(actor.departmentId,c.owning_department_id)&&actor.permissions.has('governance:draft-department')))throw fail('CHANGE_DENIED','只有归口主对接人或组长可以发起治理变更',403);
  if(g.changes.some(x=>x.state==='pending'&&(x.kind!=='submission'||x.current&&x.change.submission_id===g.submission_id&&x.change.submission_digest===digest(g.submission))))throw fail('CHANGE_PENDING','请先完成当前治理变更，或由原发起方在原绑定核对');
  const value={kind,reason,basis};
  if(kind==='submission'){
    if(!g.submission||g.submission.missing.length)throw fail('SUBMISSION_INCOMPLETE','请先补齐最低提交材料');
    value.submission_id=g.submission_id;value.submission_digest=digest(g.submission);value.required_department_ids=g.submission.participants.map(p=>p.department_id);
  }else if(kind==='scope'){
    if(!g.submission?.participants)throw fail('SCOPE_INITIAL_REQUIRED','尚无已明确范围，请先补齐初始提交范围');
    if(!Array.isArray(body.participants))throw fail('SCOPE_INVALID','范围变化须明确列出变更后的参与部门，不能把未知当作退出',422);
    value.participants=normalizeParticipants(body.participants,departments,document,c.owning_department_id);
    value.required_department_ids=scopeAffected(g.submission.participants,value.participants,c.owning_department_id);
    if(canonical(g.submission.participants)===canonical(value.participants))return {changed:false,message:'无范围变化，仅记录比较结论，不创建变化记录'};
  }else if(kind==='owner'){
    value.target_department_id=id(body.target_department_id);
    if(!departments.some(d=>same(d.id,value.target_department_id))||same(value.target_department_id,c.owning_department_id))throw fail('OWNER_INVALID','请选择不同的有效接收部门',422);
    value.duty_impact=bounded(body.duty_impact,'职责影响',true);value.pending_work=bounded(body.pending_work,'在办事项及处理安排',true);
    value.source_department_id=id(c.owning_department_id);value.required_department_ids=[value.source_department_id,value.target_department_id];
  }else if(kind==='lifecycle'){
    value.operation=text(body.operation);if(!['pause','terminate','resume'].includes(value.operation))throw fail('LIFECYCLE_INVALID','状态操作无效',422);
    if((value.operation==='resume')===(g.lifecycle==='active'))throw fail('LIFECYCLE_INVALID','当前状态不适用该操作');
    value.required_department_ids=[id(c.owning_department_id)];
  }else{
    value.due_date=text(body.due_date);if(!validDate(value.due_date))throw fail('DEADLINE_INVALID','请提供合法的约定截止日期',422);
    value.department_ids=(body.department_ids||[]).map(id);
    const expected=(g.submission?.participants||[]).map(p=>p.department_id).sort();
    if(!expected.length||canonical([...new Set(value.department_ids)].sort())!==canonical(expected))throw fail('DEADLINE_SCOPE_INVALID','须由本轮全部相关部门负责人分别确认约定日期',422);
    value.required_department_ids=expected;
    value.scope_digest=digest(g.submission.participants);
  }
  const changeId=crypto.randomUUID(),hash=digest(value);
  await db.execute('INSERT INTO process_case_changes(change_id,case_id,revision_id,revision_no,content_hash,kind,change_json,change_digest,state,proposed_by_person_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [changeId,c.id,c.current_revision_id,c.current_revision_no,c.current_content_hash,kind,JSON.stringify(value),hash,'pending',id(actor.personId)]);
  return {changed:true,change_id:changeId,change:value,state:'pending'};
}
function currentChange(g,changeId,c) {const change=g.changes.find(x=>x.change_id===changeId);if(!change)throw fail('CHANGE_NOT_FOUND','治理变更不存在',404);
  if(!change.current||(change.state!=='pending'&&!(change.kind==='submission'&&change.state==='registered')))throw fail('CHANGE_SOURCE_CHANGED','变更绑定已过期或已经登记，旧确认不能用于新修订');return change;}
async function confirm(db,c,changeId,body,actor) {
  const g=await read(db,c),change=currentChange(g,changeId,c),departmentId=id(actor.departmentId);
  if(change.kind==='submission'&&(change.change.submission_id!==g.submission_id||change.change.submission_digest!==digest(g.submission)))throw fail('SUBMISSION_CHANGED','原提交材料已经变化，不能把旧轮确认用于当前材料');
  if(!change.change.required_department_ids.includes(departmentId))throw fail('CONFIRM_SCOPE_DENIED','当前部门不是本次需要分别确认的部门',403);
  const authority=await accountability.assertDepartmentAccountability(db,actor,departmentId,{lock:true});
  const evidence=accountability.decisionEvidence(authority,{sourceRevision:c.current_revision_no,sourceHash:change.change_digest});
  const basis=bounded(body.basis,'本人确认依据',true),confirmationId=crypto.randomUUID();
  await db.execute('INSERT INTO process_case_change_confirmations(confirmation_id,change_id,department_id,confirmed_by_person_id,evidence_json,basis_text) VALUES (?,?,?,?,?,?)',
    [confirmationId,changeId,departmentId,id(actor.personId),JSON.stringify(evidence),basis]);
  if(change.kind==='submission'){
    const refreshed=(await read(db,c)).changes.find(x=>x.change_id===changeId);
    if((await confirmationsCurrent(db,refreshed,c,{lock:true})).every(x=>x.valid))
      await db.execute("UPDATE process_case_changes SET state='registered',registered_by_person_id=?,registered_at=CURRENT_TIMESTAMP(3) WHERE change_id=? AND state='pending'",[id(actor.personId),changeId]);
  }
  return {change_id:changeId,department_id:departmentId,confirmation_id:confirmationId};
}
async function confirmSubmission(db,c,body,actor){const g=await read(db,c);
  const change=[...g.changes].reverse().find(x=>x.kind==='submission'&&x.current&&x.state!=='cancelled'&&x.change.submission_id===g.submission_id&&x.change.submission_digest===digest(g.submission));
  if(!change)throw fail('SUBMISSION_INCOMPLETE','当前提交材料尚未完整，不能确认');return confirm(db,c,change.change_id,body,actor);
}
async function confirmationsCurrent(db,change,c,{lock=false}={}) {
  const result=[];for(const departmentId of change.change.required_department_ids){const confirmation=[...change.confirmations].reverse().find(x=>same(x.department_id,departmentId)),evidence=confirmation?.evidence;
    const decision=await accountability.inspectCurrentDepartmentDecision(db,departmentId,evidence,{sourceRevision:c.current_revision_no,sourceHash:change.change_digest,lock});
    result.push({department_id:departmentId,...decision,...(confirmation?.usage?{valid:false,reason:'functional_test_only',usage:confirmation.usage}:{})});}
  return result;
}
async function register(db,c,document,departments,changeId,actor) {
  if(!lead(actor))throw fail('LEAD_REQUIRED','须由组长登记已分别确认的治理变更',403);
  const g=await read(db,c),change=currentChange(g,changeId,c);
  if(change.kind==='submission'&&(change.change.submission_id!==g.submission_id||change.change.submission_digest!==digest(g.submission)))throw fail('SUBMISSION_CHANGED','提交材料变化，须重新发起并本人确认');
  if(change.kind==='deadline'&&change.change.scope_digest!==digest(g.submission?.participants||null))throw fail('DEADLINE_SCOPE_CHANGED','相关部门范围已经变化，须重新约定时限');
  const confirmations=await confirmationsCurrent(db,change,c,{lock:true});if(confirmations.some(x=>!x.valid))throw fail('DEPARTMENT_CONFIRMATIONS_REQUIRED','各受影响部门现任负责人须分别确认；失效意见不能沿用',409,{confirmations});
  if(change.kind==='lifecycle'||change.kind==='owner'){
    let formal;
    try{formal=await one(db,"SELECT d.id FROM process_design_drafts d JOIN process_v7_promotions p ON p.draft_id=d.id WHERE p.preview_case_id=? AND d.status IN ('submitted','under_review','approved','rejected') ORDER BY p.id DESC LIMIT 1 FOR UPDATE OF d FOR SHARE OF p",[c.id]);}
    catch(error){if(error.code!=='ER_NO_SUCH_TABLE'||process.env.PROCESS_V7_FORMAL_ENABLED==='1')throw error;}
    if(formal)throw fail('FORMAL_RECOVERY_REQUIRED','须先撤回或由负责人退回正式任务，再登记暂停、终止、恢复或归口交接');
  }
  if(change.kind==='scope'){
    const input={...g.submission,participants:change.change.participants};
    // The lead registers a department-confirmed scope; it gains no submission right.
    const value=normalizeSubmission(input,document,departments,c.owning_department_id,{revision:Number(c.current_revision_no)>1});
    const submissionId=crypto.randomUUID();
    await db.execute('INSERT INTO process_case_submissions(submission_id,case_id,revision_id,revision_no,content_hash,submission_json,submitted_by_person_id) VALUES (?,?,?,?,?,?,?)',
      [submissionId,c.id,c.current_revision_id,c.current_revision_no,c.current_content_hash,JSON.stringify(value),id(actor.personId)]);
    await createSubmissionTask(db,c,value,actor,submissionId);
  }
  if(change.kind==='owner'){
    const target=departments.find(d=>same(d.id,change.change.target_department_id));if(!target)throw fail('OWNER_INVALID','接收部门已经失效');
    await db.execute('UPDATE process_v7_preview_cases SET owning_department_id=?,owning_department_name=?,scope_decision=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?',[target.id,target.name,c.id]);
    // Source JSON is deliberately unchanged. The receiver must submit a new revision.
  }
  if(change.kind==='lifecycle'&&change.change.operation==='resume')await db.execute("UPDATE process_v7_preview_review_items SET origin_status='pending',counterparty_status='pending',status='pending',carry_state='reopened' WHERE case_id=? AND is_current=1",[c.id]);
  await db.execute("UPDATE process_case_changes SET state='registered',registered_by_person_id=?,registered_at=CURRENT_TIMESTAMP(3) WHERE change_id=? AND state='pending'",[id(actor.personId),changeId]);
  return {change_id:changeId,state:'registered',kind:change.kind};
}
async function assertFormalReady(db,c) {
  const g=await read(db,c);if(!g.schema_ready)throw fail('GOVERNANCE_SCHEMA_REQUIRED','案例治理结构尚未准备',503);
  if(g.blocking_issues.length)throw fail('GOVERNANCE_BLOCKED','最低材料、参与范围、变更与约定时限未闭合',409,{blocking_issues:g.blocking_issues});
  const deadline=[...g.changes].reverse().find(x=>x.kind==='deadline'&&x.state==='registered'&&x.current);
  if(!deadline||(await confirmationsCurrent(db,deadline,c,{lock:true})).some(x=>!x.valid))throw fail('DEADLINE_RECONFIRMATION_REQUIRED','约定日期的负责人资格已经变化，须重新约定');
  const material=[...g.changes].reverse().find(x=>x.kind==='submission'&&x.state==='registered'&&x.current&&x.change.submission_id===g.submission_id&&x.change.submission_digest===digest(g.submission));
  if(!material||(await confirmationsCurrent(db,material,c,{lock:true})).some(x=>!x.valid))throw fail('SUBMISSION_RECONFIRMATION_REQUIRED','提交材料的负责人确认已经失效，须重新本人确认');
  return g;
}
async function cancel(db,c,changeId,body,actor){const g=await read(db,c),change=g.changes.find(x=>x.change_id===changeId);
  if(!change||change.state!=='pending')throw fail('CHANGE_NOT_FOUND','待办治理变更不存在',404);
  if(!lead(actor)&&!same(change.proposed_by_person_id,actor.personId))throw fail('CHANGE_DENIED','仅原发起人或组长可以撤销未登记变更',403);
  bounded(body.basis,'撤销依据',true);
  await db.execute("UPDATE process_case_changes SET state='cancelled' WHERE change_id=? AND state='pending'",[changeId]);
  return {change_id:changeId,state:'cancelled',basis:text(body.basis)};
}
function requestId(value){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||''))throw fail('REQUEST_ID_REQUIRED','请保留本次操作的有效原请求UUID',422);return value.toLowerCase();}
async function receipt(db,c,actor,request){await assertSchema(db);const row=await one(db,'SELECT *,CAST(actor_person_id AS CHAR) actor_person_id FROM process_case_requests WHERE request_id=?',[requestId(request)]);
  if(!row)return {request_id:requestId(request),state:'not_recorded'};
  if(!same(row.actor_person_id,actor.personId)||String(row.case_id)!==String(c.id))throw fail('REQUEST_SCOPE_DENIED','该请求不属于当前本人及案例',403);
  return {request_id:requestId(request),state:'committed',request_digest:row.request_digest,response:parse(row.response_json)};
}
async function recordReceipt(db,c,actor,request,input,response){try{await db.execute('INSERT INTO process_case_requests(request_id,case_id,actor_person_id,request_digest,response_json) VALUES (?,?,?,?,?)',
  [requestId(request),c.id,id(actor.personId),digest(input),JSON.stringify(response)]);}catch(error){if(error.code==='ER_DUP_ENTRY')throw fail('REQUEST_CONFLICT','该请求UUID已经用于另一项操作，请先核对原回执');throw error;}}
// Participation grants current context only while it is current. An exit or
// ownership handover preserves its fixed revision, never unlimited future reads.
async function readAccess(db,c,actor) {
  const currentRevision=Number(c.current_revision_no);
  if(actor.permissions.has('governance:read-global'))return {current:true,max_revision_no:currentRevision};
  if(!actor.departmentId||!actor.permissions.has('governance:read-department'))return {current:false,max_revision_no:0};
  let current=same(c.owning_department_id,actor.departmentId),maximum=current?currentRevision:0;
  const [items]=await db.execute('SELECT revision_no,is_current,CAST(origin_department_id AS CHAR) origin_department_id,CAST(target_department_id AS CHAR) target_department_id FROM process_v7_preview_review_items WHERE case_id=?',[c.id]);
  for(const item of items)if(same(item.origin_department_id,actor.departmentId)||same(item.target_department_id,actor.departmentId)){
    maximum=Math.max(maximum,Number(item.revision_no));
    if(Number(item.is_current)===1&&Number(item.revision_no)===currentRevision)current=true;
  }
  if((await schema.inspectSchema(db)).ready){
    const [submissions]=await db.execute('SELECT submission_id,revision_no,revision_id,submission_json FROM process_case_submissions WHERE case_id=? ORDER BY record_no',[c.id]);
    const latestCurrent=[...submissions].reverse().find(s=>String(s.revision_id)===String(c.current_revision_id));
    for(const row of submissions)if((parse(row.submission_json).participants||[]).some(p=>same(p.department_id,actor.departmentId)))maximum=Math.max(maximum,Number(row.revision_no));
    if((parse(latestCurrent?.submission_json||'{}').participants||[]).some(p=>same(p.department_id,actor.departmentId)))current=true;
    const [changes]=await db.execute('SELECT revision_no,content_hash,state,change_json FROM process_case_changes WHERE case_id=?',[c.id]);
    for(const row of changes)if((parse(row.change_json).required_department_ids||[]).some(dept=>same(dept,actor.departmentId))){
      maximum=Math.max(maximum,Number(row.revision_no));
      const value=parse(row.change_json),applicable=value.kind!=='submission'||value.submission_id===latestCurrent?.submission_id;
      if(applicable&&row.state==='pending'&&Number(row.revision_no)===currentRevision&&row.content_hash===c.current_content_hash)current=true;
    }
  }
  return {current,max_revision_no:Math.min(maximum,currentRevision)};
}
async function canReadHistory(db,c,actor){return (await readAccess(db,c,actor)).max_revision_no>0;}
async function canReadCurrent(db,c,actor){return (await readAccess(db,c,actor)).current;}
module.exports={...schema,read,assertSchema,assertActive,assertFormalReady,assertSubmitter,normalizeParticipants,normalizeSubmission,
  scopeAffected,saveSubmission,propose,confirm,confirmSubmission,register,cancel,readAccess,canReadHistory,canReadCurrent,fail,digest,validDate,receipt,recordReceipt,requestId};
