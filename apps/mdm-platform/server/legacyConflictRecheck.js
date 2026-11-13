// Additive workflow events in the existing conflict audit namespace. Physical
// conflict states and old resolved records are preserved; no runtime DDL/backfill.
const crypto=require('node:crypto');
const {identityInteger,sameIdentityInteger:same,sessionSubject}=require('./sessionSubject');
const {readPersonAuthority}=require('./identityMysqlRepository');
const accountability=require('./departmentAccountability');
const {digest,parse}=require('./dataMapDefinitionValues');
const VERSION='legacy-conflict-recheck-v1',OPERATION='conflict_recheck_event';
const fail=(code,message,statusCode=409)=>Object.assign(new Error(message),{code:'CONFLICT_RECHECK_'+code,statusCode});
const exact=value=>{const id=identityInteger(value);if(id==null)throw fail('ID_INVALID','冲突、人员或部门标识无法准确读取',400);return String(id);};
const one=async(db,sql,args=[])=>(await db.execute(sql,args))[0][0]||null;
const entity=row=>'conflict_'+row.conflict_type;
const inputText=(value,label)=>{if(typeof value!=='string'||!value.trim()||value.length>12000)throw fail('INPUT_INVALID','请完整填写'+label,400);return value.trim();};
function source(row){return Object.fromEntries(['id','conflict_type','term','term_a_id','term_b_id','field_id_a','field_id_b','conflict_field','value_a','value_b','dept_a','dept_b','dept_a_meaning','dept_b_meaning'].map(key=>[key,row[key]??null]));}
async function authority(db,session){
  if(sessionSubject(session).kind==='system_admin')return {admin:true,person_id:null,current_department_id:null,effects:new Map([['governance:read-global','allow']]),grants:[]};
  const subject=sessionSubject(session),current=await readPersonAuthority(db,session,subject.personId);
  if(!current.valid||current.user.employment_status!=='active')throw fail('IDENTITY_CHANGED','账号或授权已变化，请重新登录核对',401);
  return {person_id:identityInteger(current.user.personId),current_department_id:identityInteger(current.user.current_department_id),admin:current.readOnly,
    grants:current.roles.map(role=>({role_code:role.code,scope_type:role.scopeType,scope_department_id:role.scopeDepartmentId})),effects:new Map([...current.permissions].map(code=>[code,'allow']))};
}
const has=(a,code)=>a.effects.get(code)==='allow';
const role=(a,code)=>a.grants.some(g=>g.role_code===code);
function scopeModes(current){return [has(current,'governance:read-global')?'global':null,has(current,'governance:read-department')?'department':null,
  has(current,'governance:read-assigned-context')&&has(current,'governance:handle-assigned-conflict')&&role(current,'data_conflict_handler')?'assigned':null,
  has(current,'governance:read-escalated-context')&&has(current,'governance:decide-escalation')&&role(current,'decision_group')?'escalated':null].filter(Boolean);}
function kind(row){return row.status==='escalated'||row.escalated===1?'major_decision':'coordination';}
function canPropose(a,row){return !a.admin&&(kind(row)==='major_decision'?role(a,'decision_group')&&has(a,'governance:decide-escalation'):
  role(a,'data_conflict_handler')&&has(a,'governance:handle-assigned-conflict')&&same(a.person_id,row.currentAssignee?.assignee_person_id));}
async function records(db,row){
  const [rows]=await db.execute('SELECT metadata_json FROM mdm_version_log WHERE entity_type=? AND entity_id=CAST(? AS SIGNED) AND operation=? ORDER BY id LIMIT 1001',[entity(row),exact(row.id),OPERATION]);
  if(rows.length>1000)throw fail('HISTORY_LIMIT','此项冲突历史超出当前核验范围，请联系维护人员核对',503);
  let previous=null;const values=[];
  for(const raw of rows){let value;try{value=parse(raw.metadata_json);}catch{throw fail('HISTORY_INVALID','冲突重核历史无法核验，已停止办理',503);}
    const {event_digest,...content}=value||{};
    if(value?.schema_version!==VERSION||value.previous_digest!==previous||digest(content)!==event_digest||value.event?.revision_no!==values.length+1||value.event?.conflict_type!==row.conflict_type||!same(value.event.conflict_id,row.id))throw fail('HISTORY_INVALID','冲突重核历史无法核验，已停止办理',503);
    values.push(value);previous=event_digest;
  }
  return values;
}
async function departments(db,row,lock=false){
  const a=identityInteger(row.dept_a),b=identityInteger(row.dept_b);
  if(a==null||b==null)return {valid:false,items:[],message:'原冲突未完整记录甲乙两方部门，不能猜测责任部门或代为确认；请先核对原始记录。'};
  const ids=[...new Set([String(a),String(b)])],items=[];
  for(const id of ids){const d=await one(db,'SELECT CAST(id AS CHAR) id,name,status FROM departments WHERE id=CAST(? AS SIGNED)'+(lock?' FOR SHARE':''),[id]);if(!d||d.status!=='active')return {valid:false,items:[],message:'原冲突所列部门当前不可用，不能代为确认；请先核对组织及原始记录。'};items.push({department_id:id,department_name:d.name});}
  return {valid:true,items,message:null};
}
async function project(db,row,{session=null,who=null,lock=false,loaded=null}={}){
  const history=loaded||await records(db,row),last=history.at(-1),state=last?.event.state||null,scope=await departments(db,row,lock),current=who||(session?await authority(db,session):null);
  let workflow_state=state?.workflow_state||(['resolved','archived'].includes(row.status)?'legacy_resolved':row.status);
  const proposal=state?.proposal||null,changed=proposal&&proposal.source_digest!==digest(source(row));
  if((state&&(['resolved','archived'].includes(row.status)!==(workflow_state==='resolved')))||(changed&&workflow_state==='resolved'))throw fail('HISTORY_INVALID','冲突当前状态与已保存重核历史不一致，已停止办理',503);
  if(changed&&!['resolved','legacy_resolved'].includes(workflow_state))workflow_state='source_changed';
  const rechecks=[];
  if(proposal)for(const department of proposal.departments){
    const saved=(state.rechecks||[]).find(r=>same(r.department_id,department.department_id));
    let valid=Boolean(saved?.decision==='confirmed'&&workflow_state==='resolved'),reason=saved?'原确认尚待核对当前负责人资格':'请本部门现任负责人本人核对';
    if(saved?.decision==='confirmed'&&workflow_state!=='resolved'){
      const check=await accountability.inspectCurrentDepartmentDecision(db,department.department_id,saved.department_accountability,{sourceRevision:proposal.round_no,sourceHash:proposal.proposal_digest,lock});valid=check.valid;reason=valid?'本部门已完成本人重核':'负责人登记、授权或任命已变化，请当前负责人重新核对';
    }
    const eligible=current&&!current.admin&&same(current.current_department_id,department.department_id)?(await accountability.inspectDepartmentAccountability(db,session,department.department_id,{lock})).eligible:false;
    rechecks.push({...department,decision:saved?.decision||null,basis:saved?.basis||null,person_name:saved?.actor_snapshot?.person_name||null,valid,reason,can_act:Boolean(eligible&&workflow_state==='awaiting_department_recheck'&&!valid&&scope.valid&&!changed)});
  }
  const allowed=[];
  if(current&&!current.admin){
    const lead=role(current,'mdm_lead')&&has(current,'governance:assign-work'),handler=role(current,'data_conflict_handler')&&has(current,'governance:handle-assigned-conflict')&&same(current.person_id,row.currentAssignee?.assignee_person_id);
    if(row.status==='pending'&&lead)allowed.push('assign');
    else if(row.status==='coordinating'&&lead)allowed.push(row.currentAssignee?'reassign':'assign');
    if(['coordinating','escalated'].includes(row.status)&&handler&&workflow_state!=='awaiting_department_recheck')allowed.push('coordination');
    if(['coordinating','escalated'].includes(row.status)&&canPropose(current,row)&&scope.valid&&workflow_state!=='awaiting_department_recheck')allowed.push('final-decide');
    if(row.status==='coordinating'&&(lead||handler)&&has(current,'governance:escalate-conflict')&&workflow_state!=='awaiting_department_recheck')allowed.push('escalate');
    if(rechecks.some(r=>r.can_act))allowed.push('department-recheck');
    if(row.status==='resolved'&&lead)allowed.push('reopen');
    if(row.status==='resolved'&&role(current,'mdm_lead')&&has(current,'governance:structure-gate'))allowed.push('archive');
  }
  return {workflow_state,department_rechecks:rechecks,allowed_actions:allowed,read_only:Boolean(current?.admin),recheck_notice:scope.message||
    (workflow_state==='legacy_resolved'?'此项保留原已解决记录，历史未记录各部门本人重核，不据此补造确认。':workflow_state==='recheck_returned'?'本部门已退回重核；普通协调由当前受派处理人修订方案，重大争议由项目决策组修订决定，再交各部门重新核对。':workflow_state==='awaiting_department_recheck'?'方案或重大决定已保存，仍须所列部门负责人分别本人重核；全部有效确认后才关闭。':null),
    workflow_revision:last?.event.revision_no||0,workflow_history:history.map(value=>({...value.event,request_id:value.request_id,state:undefined})),
    _history:history,_state:state,_scope:scope};
}
function publicProjection(value){const {_history,_state,_scope,...visible}=value;return visible;}
async function historicalNames(db,row,assignments,coordination){
  const [logs]=await db.execute("SELECT operation,metadata_json FROM mdm_version_log WHERE entity_type=? AND entity_id=CAST(? AS SIGNED) AND operation IN ('assignConflict','reassignConflict','submitCoordination') ORDER BY id DESC LIMIT 1000",[entity(row),exact(row.id)]);
  const values=logs.map(log=>{try{return {operation:log.operation,...parse(log.metadata_json)};}catch{return {};}}).filter(value=>value.schema_version==='legacy-governance-write-v1'&&value.actor_snapshot);
  return {assignmentHistory:assignments.map(item=>{
    const value=values.find(log=>['assignConflict','reassignConflict'].includes(log.operation)&&same(log.after?.currentAssignee?.id,item.id)&&!same(log.before?.currentAssignee?.id,item.id)&&same(log.actor_snapshot.person_id,item.assigned_by_person_id));
    return {...item,assignee_name:value?.after?.currentAssignee?.assignee_name||null,assigned_by_name:value?.actor_snapshot?.person_name||null};
  }),coordinationHistory:coordination.map(item=>{
    const value=values.find(log=>log.operation==='submitCoordination'&&log.after?.coordinationHistory?.some(r=>same(r.id,item.id))&&!log.before?.coordinationHistory?.some(r=>same(r.id,item.id))&&same(log.actor_snapshot.person_id,item.assignee_person_id));
    return {...item,assignee_name:value?.actor_snapshot?.person_name||null};
  })};
}
async function perform(db,row,session,current,action,body){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id||'')||!/^[a-f0-9]{64}$/.test(body.expected_token||''))throw fail('REQUEST_REQUIRED','请提供本次办理凭据和当前记录核对信息，原输入保持',400);
  const history=await records(db,row),requestDigest=digest({conflict_type:row.conflict_type,conflict_id:exact(row.id),action,body}),prior=history.find(value=>value.request_id===body.request_id);
  // Replays retain their result but never revive revoked identities or assignments.
  if(current.admin)throw fail('FORBIDDEN','管理员对治理材料只读',403);
  if(action==='finalDecideConflict'&&!canPropose(current,row))throw fail('FORBIDDEN','仅当前受派处理人或已升级事项的项目决策组可以记录方案或决定',403);
  if(action==='reopenConflict'&&!(role(current,'mdm_lead')&&has(current,'governance:assign-work')))throw fail('FORBIDDEN','仅MDM组长可以明确重开冲突',403);
  if(action==='departmentRecheck'){
    const department=prior?prior.event.department_id:current.current_department_id;
    if(!same(department,current.current_department_id))throw fail('FORBIDDEN','原请求属于原部门，当前部门授权不能替代原部门重核资格',403);
    await accountability.assertDepartmentAccountability(db,session,department,{lock:true});
  }
  if(prior){if(prior.actor_person_id!==exact(current.person_id)||prior.request_digest!==requestDigest)throw fail('REQUEST_CONFLICT','同一办理凭据不能用于不同内容或人员');return prior.response;}
  require('./legacyGovernanceWrites').compareToken(body.expected_token,row.write_token);
  const projection=await project(db,row,{session,who:current,lock:true,loaded:history}),old=projection._state;
  if(action==='finalDecideConflict'&&!projection._scope.valid)throw fail('DEPARTMENTS_REQUIRED',projection._scope.message);
  const actionName={finalDecideConflict:'final-decide',departmentRecheck:'department-recheck',reopenConflict:'reopen'}[action];
  if(!projection.allowed_actions.includes(actionName))throw fail('ACTION_DENIED',projection.recheck_notice||'当前状态或职责不允许此项办理',403);
  const actor=await one(db,'SELECT person_name FROM person WHERE person_id=CAST(? AS SIGNED) FOR SHARE',[exact(current.person_id)]),actor_snapshot={person_id:exact(current.person_id),person_name:actor?.person_name||null},created_at=new Date().toISOString();
  let state=old?JSON.parse(JSON.stringify(old)):{round_no:0,proposal:null,rechecks:[]},eventAction,basis,decision=null,department_id=null;
  if(action==='finalDecideConflict'){
    if(!projection._scope.valid)throw fail('DEPARTMENTS_REQUIRED',projection._scope.message);
    basis=inputText(body.resolution,'协调方案或重大决定及依据');
    const proposal={round_no:(state.round_no||0)+1,kind:kind(row),resolution:basis,source_digest:digest(source(row)),departments:projection._scope.items,actor_snapshot,created_at};
    proposal.proposal_digest=digest(proposal);state={round_no:proposal.round_no,proposal,rechecks:[],workflow_state:'awaiting_department_recheck'};eventAction='proposal_recorded';
  }else if(action==='departmentRecheck'){
    if(!['confirmed','needs_changes'].includes(body.decision))throw fail('INPUT_INVALID','请选择本人确认或退回修改',400);
    basis=inputText(body.basis,'本部门重核依据');decision=body.decision;department_id=exact(current.current_department_id);
    const eligibility=await accountability.assertDepartmentAccountability(db,session,department_id,{lock:true});
    const record={department_id,decision,basis,actor_snapshot,department_accountability:accountability.decisionEvidence(eligibility,{sourceRevision:state.proposal.round_no,sourceHash:state.proposal.proposal_digest}),created_at};
    state.rechecks=[...state.rechecks.filter(r=>!same(r.department_id,department_id)),record];state.workflow_state=decision==='needs_changes'?'recheck_returned':'awaiting_department_recheck';eventAction='department_rechecked';
    if(decision==='confirmed'){
      let complete=true;for(const dept of state.proposal.departments){const r=state.rechecks.find(value=>same(value.department_id,dept.department_id));if(r?.decision!=='confirmed'||!(await accountability.inspectCurrentDepartmentDecision(db,dept.department_id,r.department_accountability,{sourceRevision:state.proposal.round_no,sourceHash:state.proposal.proposal_digest,lock:true})).valid)complete=false;}
      if(complete)state.workflow_state='resolved';
    }
  }else{
    basis=inputText(body.basis,'重开原因');state={round_no:state.round_no||0,proposal:null,rechecks:[],workflow_state:'pending',previous_resolution:{status:row.status,resolution:row.resolution,resolved_by:row.resolved_by,resolved_at:row.resolved_at_epoch!=null?new Date(Number(row.resolved_at_epoch)*1000).toISOString():row.resolved_at instanceof Date?row.resolved_at.toISOString():row.resolved_at}};eventAction='reopened';
  }
  const table=row.conflict_type==='term'?'mdm_term_conflicts':'mdm_field_conflicts';
  if(state.workflow_state==='resolved')await db.execute(`UPDATE ${table} SET status='resolved',resolution=?,resolved_by=CAST(? AS SIGNED),resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=CAST(? AS SIGNED)`,[state.proposal.resolution,exact(current.person_id),exact(row.id)]);
  if(action==='reopenConflict')await db.execute(`UPDATE ${table} SET status='pending',resolution=NULL,resolved_by=NULL,resolved_at=NULL,escalated=0,updated_at=CURRENT_TIMESTAMP WHERE id=CAST(? AS SIGNED)`,[exact(row.id)]);
  const event={event_id:crypto.randomUUID(),conflict_id:exact(row.id),conflict_type:row.conflict_type,revision_no:history.length+1,action:eventAction,actor_snapshot,created_at,basis,decision,department_id,workflow_state:state.workflow_state,state};
  const response={success:true,request_id:body.request_id,event_id:event.event_id,workflow_revision:event.revision_no,workflow_state:state.workflow_state,status:state.workflow_state==='resolved'?'resolved':action==='reopenConflict'?'pending':row.status};
  const value={schema_version:VERSION,request_id:body.request_id,request_digest:requestDigest,actor_person_id:exact(current.person_id),event,response,previous_digest:history.at(-1)?.event_digest||null};value.event_digest=digest(value);
  await db.execute('INSERT INTO mdm_version_log(entity_type,entity_id,operation,operated_by,operated_by_person_id,metadata_json) VALUES(?,CAST(? AS SIGNED),?,CAST(? AS SIGNED),CAST(? AS SIGNED),?)',[entity(row),exact(row.id),OPERATION,exact(current.person_id),exact(current.person_id),JSON.stringify(value)]);
  return response;
}
module.exports={VERSION,OPERATION,exact,source,records,authority,scopeModes,project,publicProjection,historicalNames,perform,fail};
