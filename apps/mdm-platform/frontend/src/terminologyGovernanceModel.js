import {businessLocation,businessStatus,businessText,userMessage} from "./businessPresentation.js";
export const terminologyRoot = '/api/terminology-governance';

export const termActionLabels = Object.freeze({
  create_term:'提报新术语', edit:'修订提报', update:'修订提报', submit:'提交部门确认',
  department_confirm:'确认业务适用范围', department_return:'退回补充', source_check:'核对来源',
  adopt:'确认采纳', not_adopt:'不予采纳并结束', suspend:'暂停使用', restore:'恢复使用',
  stop_adoption:'停止采用', continue_adoption:'确认继续采用并留理由', source_withdrawn:'记录来源废止', source_superseded:'记录GB/T来源被替代', merge:'合并同义条目', assign:'分派来源核对',
  challenge:'提出质疑', create_challenge:'提出质疑', coordinate:'组织协调',
  department_opinion:'确认本部门意见', escalate:'提交项目决策组', decide:'记录决定',
  feedback:'记录反馈', close:'结案', reopen:'申请复核',usage_impact:'记录引用影响处置'
});
export const impactDecisionLabels=Object.freeze({no_change:'无需修改原材料',later_revision:'安排后续修订',address_now:'本次处理受影响内容'});
export const sourceKindLabels = Object.freeze({gb:'GB 强制性国家标准',gbt:'GB/T 推荐性国家标准',custom:'自定义术语',gbz:'GB/Z 指导性资料（不可直接采纳）'});
export const decisionLabels = Object.freeze({match:'含义一致',synonym:'已确认同义，需统一用词',conflict:'已确认实质冲突',unlisted:'无适用词条，业务含义已确认',not_applicable:'此位置不适用术语引用'});
export const stateLabels = Object.freeze({draft:'提报草稿',returned:'已退回补充',none:'当前无待确认提报',submitted:'待部门确认',department_confirmed:'部门已确认',source_checked:'来源已核对',pending:'待办理',active:'有效',effective:'已生效',adopted:'已采纳',never_adopted:'尚未采纳',legacy_preserved:'历史沿用，依据待核',not_adopted:'不予采纳',rejected:'未采纳',withdrawn:'来源已废止',superseded:'来源已被替代',stopped:'已停止采用',merged:'已合并',open:'待协调',coordinating:'协调中',escalated:'已提交项目决策组',decided:'已有决定',feedback:'已反馈',feedback_sent:'已反馈，可结案或申请复核',closed:'已结案',reopened:'复核中',draft_created:'建立提报草稿',draft_revised:'修订提报内容',challenge_raised:'提出质疑',challenge_coordinate:'组织质疑协调',challenge_department_opinion:'记录部门负责人意见',challenge_escalate:'提交项目决策组',challenge_decide:'记录争议决定',challenge_feedback:'向提出人反馈',challenge_close:'质疑办理结案',challenge_reopen:'提出人申请复核'});
export const displayState = value => stateLabels[value] || businessStatus(value,'待核实');
export function termStateLabel(row={}) {
  if(row.merged_into_id)return '已合并，不供新材料引用';
  if(row.suspended)return '暂停使用，暂不可引用';
  if(row.source_kind==='gb'&&row.source_status==='withdrawn')return 'GB来源已废止，不供新材料引用';
  if(row.adoption_status==='stopped')return '已停止采用，不供新材料引用';
  if(row.usable)return '当前可引用';
  if(row.adoption_status==='not_adopted')return '不予采纳，未生效';
  return row.draft_status&&row.draft_status!=='none'?displayState(row.draft_status)+'，未生效':'当前不可引用';
}
export function termDefinitionHeading(row={}) {
  if(row.merged_into_id||row.adoption_status==='stopped')return '历史采用定义';
  if(row.legacy_unverified)return '历史沿用定义（依据待核）';
  return ['never_adopted','not_adopted'].includes(row.adoption_status)?'未生效提报定义':'当前采用的固定定义';
}

export function actionsOf(value) {
  return (value?.allowed_actions || []).map(item => typeof item === 'string' ? item : item?.action || item?.code).filter(Boolean);
}
export function termId(row) { return String(row?.term_id ?? row?.id ?? ''); }
export function termValues(detail = {}) {
  const pending = detail.pending_version || {};
  const row = {...detail,...detail.source,...(pending.content || pending.definition_json || pending)};
  return Object.fromEntries(['term','definition','context','concept_key','source_kind','standard_number','standard_version','standard_clause','original_definition','company_application'].map(key => [key,row[key] || (key === 'source_kind' ? 'custom' : '')]));
}
export function publicTerm(row = {}) {
  return {...row,term_id:termId(row),version_id:String(row.version_id ?? ''),term:row.term || '',definition:typeof row.definition === 'string' ? row.definition : '',context:row.context || ''};
}
export function exactFailure(error) {
  const message = error?.serverMessage || error?.body?.error || error?.body?.message || error?.directoryMessage || error?.message || '操作未完成，请核对当前内容。';
  return userMessage(message,'本次操作未完成，请核对当前材料和本人办理资格。填写的内容仍保留。');
}
export function referenceFailure(error,{reading=false}={}) {
  if(error?.status===403)return {title:reading?'当前身份不能查阅这份材料的术语核对':'当前身份不能办理本次术语核对',message:reading?'本次读取未获许可，不能据此判断这份材料是否已完成术语核对。请由有权查阅本份材料的人员核对；这不会改变已有核对记录。':'本次操作未获许可。填写的内容仍保留，请核对本人对这份材料的当前办理资格；不能代替其他部门或负责人办理。'};
  if(error?.status===401)return {title:'请重新登录后查阅或办理',message:'登录状态已失效，填写的内容仍保留。请以原办理身份重新登录，再核对本份材料的最新记录。'};
  return {title:reading?'暂未读到这份材料的术语核对':'本次术语核对操作未完成',message:reading?'本次读取未成功，不能据此判断核对是否完成。请稍后重新读取；已有记录和当前输入不会因此改变。':exactFailure(error)};
}
export function terminologyGate(error) {
  if(error?.code!=='TERM_GOVERNANCE_USAGE_REVIEW_REQUIRED')return null;
  const instructions={REVIEW_REQUIRED:'由本份正式草稿的主对接人记录关键用词的人工判断；没有适用词条时，填写已核对的业务含义和依据。',SOURCE_CHANGED:'草稿正文已变化。请主对接人逐条核对受影响的原文位置，重新保存人工判断。',TERM_CHANGED:'引用词条的定义或可用状态已变化。请主对接人核对相关用词，选择当前适用的定义并重新保存判断。',SUBSTANTIVE_CONFLICT:'已有人工判断确认用词含义存在实质冲突。请先按业务依据处理冲突，再重新核对；重复提交不会解除限制。',CANONICAL_NAME_REQUIRED:'已有人工判断确认存在同义用词。请回到同一流程的编制入口统一相关用词，提交新修订并重新核对。',DEPARTMENT_CONFIRMATION_REQUIRED:'人工核对结果还需要本部门当前负责人本人确认。请负责人在本草稿的术语核对中点击“本人确认本部门引用核对”。',DEPARTMENT_CONFIRMATION_STALE:'原负责人确认已不满足当前资格。请由本部门当前负责人本人重新核对并确认本次术语引用。'};
  const findings=Array.isArray(error.findings)?error.findings:Array.isArray(error.body?.findings)?error.body.findings:[];
  return {title:'请先完成本份正式草稿的术语核对',steps:[...new Set(findings.map(item=>instructions[item.code]||userMessage(item.message,'请在本草稿的术语核对中查看待处理事项。')))],message:'本次提交尚未完成，填写的内容仍保留。请先在下方“正式草稿的术语核对”处理待办及所需的负责人确认，再回到本次办理。刷新只读取状态，不会代为保存、确认或重新提交。'};
}
export function unknownWrite(error) {
  return !Number.isInteger(error?.status) || error.status >= 500;
}
export function retainWriteFailure(draft, error, submitted) {
  return {...draft,uncertain:unknownWrite(error),conflict:error?.status === 409,submitted:unknownWrite(error) ? submitted : null,dirty:true};
}
export function updateEditableDraft(draft, patch, requestId) {
  if (!draft || draft.uncertain) return draft;
  return {...draft,...patch,request_id:requestId,submitted:null,dirty:true};
}
export function ownerKey(user = {}) { return `${user.personId || ''}:${user.departmentId || ''}`; }

export function referenceSubjectKey(subject) {
  return `${subject?.target_type || ''}:${subject?.target_id || ''}`;
}
export function referencePositions(data = {}) {
  return (data?.source_positions || []).map(position => ({...position,location:String(position.location || position.path || ''),source_text:String(position.source_text ?? position.text ?? ''),label:referenceLocation(null,position)})).filter(position => position.location&&!technicalReferencePosition(position.location));
}
const technicalReferencePosition=location=>/(?:^|[/.])(?:export_meta|type|kind|status|state|stage|operation|operations|field_type|data_type|node_type|area_type|item_type|source_kind|relation_type|record_scope|record_model|presence|mode|scope_mode|actor_assignment_mode|join_mode|availability_mode|information_type|value_usage_mode|value_origin_mode|schema_version|system_field|physical_table)(?:[/.\[]|$)|(?:^|[/.])\w*(?:_id|_ids|_ref|_refs|_hash|_digest|_token|_code)(?:[/.\[]|$)/i.test(String(location||''));
export function referenceLocation(data,item={}) {
  const position=(data?.source_positions||[]).find(value=>String(value.location||value.path||'')===String(item.location||item.path||''));
  const label=position?.label||item.label;
  if(typeof label==='string'&&/[\p{Script=Han}]/u.test(label)&&!/[\/\[\]]|\b[a-z]+_[a-z_]+\b|(?:^|\s)\d+(?:\s|$)/i.test(label))return businessText(label,'相关业务内容（请在正文中核对）');
  return businessLocation(item.location||item.path)+(technicalReferencePosition(item.location||item.path)?'（历史位置，请对照原材料）':'');
}
export function referenceSourceText(item={}) {
  if(technicalReferencePosition(item.location))return '该历史位置保存了系统取值，原记录保持原样；请对照来源材料核对相关业务内容。';
  if(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$|(?:^|\s)(?:\/[a-z_][a-z0-9_.~-]*){2,}|(?:^|\s)[a-z_]+\[\d+\](?:\.[a-z_]+)+|\b[a-z0-9_-]+\.(?:jsx?|tsx?|cjs|mjs|json|sql)\b/i.test(String(item.source_text||'').trim()))return '该处原文包含无法直接展示的技术内容，原记录保持原样；请对照来源材料核对。';
  return businessText(item.source_text,'该处原文包含无法直接展示的技术内容，请对照来源材料核对。');
}
export function referenceSubjectPresentation(subject={},name='') {
  const type={process_draft:'正式草稿',process_version:'已发布流程',work_package:'数据治理工作包',handoff_revision:'数据地图草稿',data_definition:'固定数据定义'}[subject.target_type]||'本份材料';
  return {title:type+'的术语核对'+(name?' · '+businessText(name,'流程名称待核对'):''),refresh:'刷新'+type+'的术语核对',description:subject.target_type==='process_version'?'这里只查阅这份已发布流程当时固定的引用与判断；上方正式草稿的核对记录属于另一份材料。':'这里核对本份材料的业务用词、引用定义及已保存判断。记录判断、负责人确认和流程提交分别办理，请按本页可用按钮操作。'};
}
// These names must come from a stored snapshot, never a current directory join.
export function formalHistoricalName(row={}) {
  const snapshot=row.actor_snapshot||row.payload?.actor_snapshot||row.decision_snapshot?.actor_snapshot;
  const name=snapshot?.person_name||snapshot?.name;
  return name?businessText(name,'历史姓名未记录'):'历史姓名未记录';
}
export function formalReviewName(review={},events=[]) {
  if(review.actor_snapshot)return formalHistoricalName(review);
  const exactIdentity=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null;
  const task=exactIdentity(review.id),draft=exactIdentity(review.draft_id),revision=exactIdentity(review.draft_revision_no);
  if(!task||!draft||!revision||!review.content_hash)return '历史姓名未记录';
  const decision={approved:'approve',needs_changes:'needs_changes',rejected:'reject'}[review.status];
  const matches=events.filter(event=>decision&&event.event_type==='review_'+decision&&exactIdentity(event.draft_id)===draft&&exactIdentity(event.payload?.review_task_id)===task&&exactIdentity(event.payload?.draft_revision_no)===revision&&event.payload?.content_hash===review.content_hash);
  return matches.length===1?formalHistoricalName(matches[0]):'历史姓名未记录';
}
export function referenceItems(data = {}) {
  return (data?.items || []).map(item => ({location:item.location || '',source_text:item.source_text ?? '',term_id:item.term_id == null ? '' : String(item.term_id),version_id:item.version_id == null ? '' : String(item.version_id),decision:item.decision || '',reason:item.reason || '',...(item.term_snapshot ? {term_snapshot:item.term_snapshot} : {}),...(item.usage_token ? {usage_token:item.usage_token} : {})}));
}
export function referencePayload(subject, draft) {
  if (!subject?.target_type || !subject?.target_id || !draft?.source_digest) throw new Error('缺少可核对的来源对象或摘要，请先读取当前来源。');
  const locations = new Set();
  const items = (draft.items || []).map(item => {
    if (!item.location || locations.has(item.location)) throw new Error('请选择具体来源位置，同一位置只保留一条当前判断。');
    locations.add(item.location);
    if (!Object.hasOwn(decisionLabels,item.decision)) throw new Error('请逐条选择人工核对结果。');
    if (!item.reason?.trim()) throw new Error('请逐条填写判断依据或差异原因。');
    const linked = ['match','synonym','conflict'].includes(item.decision);
    if (linked && (!item.term_id || !item.version_id)) throw new Error('一致、同义或冲突判断必须选择词条及固定定义版本。');
    return {location:item.location,source_text:item.source_text,term_id:linked ? item.term_id : null,version_id:linked ? item.version_id : null,decision:item.decision,reason:item.reason.trim(),...(linked && item.usage_token ? {usage_token:item.usage_token} : {})};
  });
  if (!items.length && !draft.reason?.trim()) throw new Error('没有需要逐条引用的关键概念时，请填写整体核对说明。');
  return {target_type:subject.target_type,target_id:String(subject.target_id),source_digest:draft.source_digest,expected_revision:draft.expected_revision,request_id:draft.request_id,reason:draft.reason?.trim()||'',items};
}
export function canEditReferences(data) {
  return !data?.fixed && actionsOf(data).some(action => ['save','save_usages','edit','record_usages','update','review'].includes(action));
}
