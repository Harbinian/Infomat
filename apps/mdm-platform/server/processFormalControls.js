// Append-only case materials and independent improvement suggestions. Does not
// rewrite uploaded facts, exempt unresolved checks, or approve enterprise policy.
const crypto = require('node:crypto');
const { httpError } = require('./processDesignPolicy');
const {timestampColumns,timeRow}=require('./governanceTimeProjection');
const EVENT = 'process_formal_control';
const SCHEMA = 'process-formal-controls-v1';
const fail = (message,code='FORMAL_CONTROL_INPUT_INVALID',status=422) => httpError(status,message,{error:message,code});
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
function allowedActions(actor,row) {
  if(!actor?.personId || actor.readOnly || actor.identityKind==='system_admin' || actor.roleCodes?.has('admin'))return [];
  const lead=actor.roleCodes?.has('mdm_lead') && actor.permissions?.has('governance:assign-work');
  const owner=String(actor.departmentId)===String(row.owning_department_id) && actor.roleCodes?.has('department_contact') &&
    actor.permissions?.has('governance:draft-department') && actor.permissions?.has('governance:submit-department');
  const reviewer=actor.permissions?.has('governance:review-department') && actor.canReviewDepartment===true;
  return [...(lead||owner||reviewer?['add_suggestion']:[]),...(lead?['dispose_suggestion']:[]),...(owner?['record_institution_editions']:[])];
}
function required(value,label,max=4000) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(label+'须填写且不超过'+max+'字'); return value.trim(); }
function normalizeInput(input) {
  const action = input?.action;
  if (!['add_suggestion','dispose_suggestion','record_institution_editions'].includes(action)) throw fail('请选择版次补充或建议处置动作');
  if (!/^[0-9a-f-]{36}$/i.test(input.request_id || '')) throw fail('请求标识无效');
  const value = { schema_version:SCHEMA,action,request_id:input.request_id,basis:required(input.basis,'办理依据') };
  if (action === 'add_suggestion') Object.assign(value,{suggestion_id:input.request_id,title:required(input.title,'建议内容'),
    affected_scope:required(input.affected_scope,'涉及范围'),non_blocking_reason:required(input.non_blocking_reason,'不影响现状事实、责任、接口和执行的理由'),status:'open'});
  if (action === 'dispose_suggestion') Object.assign(value,{suggestion_id:required(input.suggestion_id,'建议标识',64),
    status:required(input.status,'处理状态',32),disposition:required(input.disposition,'处置说明')});
  if (action === 'dispose_suggestion' && !['planned','implemented_in_revision','declined','deferred'].includes(value.status)) throw fail('建议处理状态无效');
  if (action === 'record_institution_editions') {
    if (!Array.isArray(input.materials) || !input.materials.length || input.materials.length > 100) throw fail('须引用已登记的来源材料并补充版次');
    value.materials = input.materials.map(m => ({reference:required(m.reference,'已登记材料引用',1000),
      source_edition:m.source_edition == null || m.source_edition === '' ? null : required(m.source_edition,'来源制度版次',128),
      proposed_edition:m.proposed_edition == null || m.proposed_edition === '' ? null : required(m.proposed_edition,'拟议制度版次',128)}));
  }
  return value;
}
async function readControls(db,row) {
  const [events] = await db.execute(`SELECT CAST(id AS CHAR) event_id,CAST(actor_person_id AS CHAR) actor_person_id,payload_json,created_at,${timestampColumns('',['created_at'])}
    FROM process_v7_preview_events WHERE case_id=? AND event_type=? ORDER BY id`, [row.id,EVENT]);
  const suggestions = new Map(); let materials = null;
  for (const stored of events) {
    const event=timeRow(stored);
    const payload = parse(event.payload_json); if (payload?.schema_version !== SCHEMA) continue;
    const item = {...payload,event_id:event.event_id,actor_person_id:event.actor_person_id,created_at:event.created_at};
    if (payload.action === 'record_institution_editions' && Number(payload.source_revision_no) === Number(row.current_revision_no) && payload.source_content_hash === row.current_content_hash) materials=item;
    if (payload.action === 'add_suggestion') suggestions.set(payload.suggestion_id,{...item,history:[item]});
    if (payload.action === 'dispose_suggestion' && suggestions.has(payload.suggestion_id)) {
      const previous=suggestions.get(payload.suggestion_id);
      suggestions.set(payload.suggestion_id,{...previous,status:payload.status,disposition:payload.disposition,history:[...previous.history,item]});
    }
  }
  return {schema_version:SCHEMA,event_id:events.at(-1)?.event_id || '0',institution_editions:materials,
    enterprise_approval_status:'unknown',enterprise_effective_status:'unknown',suggestions:[...suggestions.values()]};
}
async function appendControl(db,row,actor,input) {
  const value=normalizeInput(input);
  const current=await readControls(db,row);
  const requestHash=crypto.createHash('sha256').update(JSON.stringify({input,person_id:String(actor.personId)})).digest('hex');
  const [existing]=await db.execute(`SELECT payload_json FROM process_v7_preview_events WHERE case_id=? AND event_type=? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.request_id'))=? LIMIT 1`,[row.id,EVENT,input.request_id]);
  if(existing.length){if(parse(existing[0].payload_json).request_hash!==requestHash)throw fail('请求标识已用于不同内容','FORMAL_CONTROL_REQUEST_CONFLICT',409);return {...current,idempotent:true};}
  if(String(input.expected_event_id)!==String(current.event_id) || Number(input.expected_revision_no)!==Number(row.current_revision_no) || input.expected_content_hash!==row.current_content_hash) throw fail('来源或处置记录已变化，请保留输入并刷新','FORMAL_CONTROL_SOURCE_CHANGED',409);
  const lead=actor.roleCodes?.has('mdm_lead') && actor.permissions?.has('governance:assign-work');
  if(!allowedActions(actor,row).includes(value.action)) throw fail('当前身份无权登记或处置该材料','FORMAL_CONTROL_ACTION_DENIED',403);
  if(value.action==='dispose_suggestion' && !current.suggestions.some(s=>s.suggestion_id===value.suggestion_id)) throw fail('建议不存在','FORMAL_CONTROL_SUGGESTION_NOT_FOUND',404);
  if(value.action==='record_institution_editions') {
    const governance=await require('./processCaseGovernance').read(db,row);
    const sources=governance.submission?.sources || [];
    if(value.materials.some(m=>!sources.some(s=>s.reference===m.reference))) throw fail('版次补充必须引用当前提交清单中的材料','FORMAL_CONTROL_SOURCE_REFERENCE_INVALID');
  }
  Object.assign(value,{request_hash:requestHash,source_revision_no:Number(row.current_revision_no),source_content_hash:row.current_content_hash});
  await db.execute(`INSERT INTO process_v7_preview_events(case_id,revision_id,event_type,actor_user_id,actor_person_id,actor_department_id,actor_role_code,basis_text,payload_json)
    VALUES (?,?,?,?,?,?,?,?,?)`,[row.id,row.current_revision_id,EVENT,String(actor.personId),String(actor.personId),actor.departmentId==null?null:String(actor.departmentId),lead?'mdm_lead':'department_mdm_contact',value.basis,JSON.stringify(value)]);
  return readControls(db,row);
}
module.exports={EVENT,SCHEMA,readControls,appendControl,normalizeInput,allowedActions};
