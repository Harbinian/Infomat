import {businessText,userMessage} from './businessPresentation.js';

export const qualityAuditRoot='/api/quality/audits';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const revision=value=>Number.isSafeInteger(value)&&value>0;
const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b);
const identity=user=>[user?.personId,user?.accountId,user?.authVersion,user?.departmentId].map(value=>value==null?null:String(value));
export const qualityAuditOwner=user=>JSON.stringify(identity(user));
export function qualityAuditSameIdentity(owner,user){try{const before=JSON.parse(owner),next=identity(user);return [0,1,3].every(index=>before[index]===next[index])&&Boolean(next[0]);}catch{return false;}}
const states=Object.freeze({awaiting_rectification:'待部门整改',awaiting_review:'待审计复核',closed:'复核通过，已关闭'});
const actions=Object.freeze({register:'登记审计事项',submit_rectification:'提交整改措施与证据',review:'审计复核',revise_design_basis:'更新已确认设计依据'});
export const qualityAuditState=value=>Object.hasOwn(states,value)?states[value]:'状态待核对';
export const qualityAuditAction=value=>Object.hasOwn(actions,value)?actions[value]:'审计办理记录';
export const qualityAuditRequestPending=draft=>Boolean(draft?.request&&draft.request.phase!=='rejected');
export const qualityAuditCanRetry=draft=>draft?.request?.phase==='not_observed';
export const qualityAuditEditable=draft=>Boolean(draft&&!qualityAuditRequestPending(draft));
export const qualityAuditSelection=search=>{const value=new URLSearchParams(search).get('finding');return uuid.test(value||'')?value:null;};
export const qualityAuditHref=id=>'/app/quality?'+new URLSearchParams({finding:String(id)});
export function qualityAuditCanAct(status,detail,action){
  if(status?.enabled!==true||status.can_read!==true||status.read_only===true)return false;
  if(action==='register')return status.can_register===true;
  if(!detail?.finding||detail.finding.state==='closed'||!detail.allowed_actions?.includes(action))return false;
  return action==='revise_design_basis'||detail.design_gate?.valid===true;
}
export function qualityAuditDesignLabel(row={}){
  return [businessText(row.process_name,'流程名称未提供'),row.document_no?businessText(row.document_no):null,row.department_name?businessText(row.department_name):null].filter(Boolean).join(' · ');
}
export function qualityAuditDesignOptions(designs=[],finding=null){
  if(!finding)return designs;
  return designs.filter(row=>same(row.document_id,finding.design?.document_id));
}
function text(value,label){if(typeof value!=='string'||!value.trim())throw new Error('请填写'+label+'。');return value.trim();}
function chosen(value,label){const result=String(value||'');if(!/^[1-9]\d*$/.test(result))throw new Error('请选择'+label+'。');return result;}
export function qualityAuditWrite(draft,requestId){
  if(!draft||!uuid.test(requestId||''))throw new Error('本次办理尚未形成可核对请求，请保留输入。');
  const values=draft.values||{},body={request_id:requestId};
  if(draft.action==='register')return {url:qualityAuditRoot+'/findings',method:'POST',body:{...body,title:text(values.title,'审计事项'),subject:text(values.subject,'审计对象'),finding_text:text(values.finding_text,'质量问题'),basis_text:text(values.basis_text,'审计依据'),requirement_text:text(values.requirement_text,'整改要求'),responsible_department_id:chosen(values.responsible_department_id,'责任部门'),design_id:chosen(values.design_id,'已确认流程设计')}};
  if(!uuid.test(draft.findingId||'')||!revision(draft.expected_revision))throw new Error('本次办理缺少准确的审计记录，请先查看最新记录。');
  Object.assign(body,{expected_revision:draft.expected_revision,action:draft.action});
  if(draft.action==='submit_rectification')Object.assign(body,{action_text:text(values.action_text,'整改措施'),evidence_text:text(values.evidence_text,'整改证据')});
  else if(draft.action==='review'){
    if(!['accept','return'].includes(values.decision))throw new Error('请选择本次审计复核结论。');
    Object.assign(body,{decision:values.decision,basis_text:text(values.basis_text,'复核依据')});
  }else if(draft.action==='revise_design_basis')Object.assign(body,{design_id:chosen(values.design_id,'同一制度档案的已确认设计'),finding_text:text(values.finding_text,'更新后的质量问题'),basis_text:text(values.basis_text,'更新后的审计依据'),requirement_text:text(values.requirement_text,'更新后的整改要求'),reason:text(values.reason,'更新设计依据的原因')});
  else throw new Error('当前操作没有可提交的办理入口。');
  return {url:qualityAuditRoot+'/findings/'+encodeURIComponent(draft.findingId)+'/actions',method:'POST',body};
}
export function beginQualityAuditRequest(draft,newId=()=>crypto.randomUUID()){
  if(qualityAuditRequestPending(draft)){
    if(!qualityAuditCanRetry(draft))throw new Error('原请求结果尚待核对，请先查询原请求。');
    return {...draft,request:{...draft.request,phase:'awaiting_result'},dirty:true};
  }
  const requestId=newId(),write=qualityAuditWrite(draft,requestId);
  return {...draft,request:{...write,request_id:requestId,phase:'awaiting_result',result:null},dirty:true};
}
export function editQualityAuditDraft(draft,key,value){return qualityAuditEditable(draft)?{...draft,values:{...draft.values,[key]:value},request:null,dirty:true}:draft;}
export function rejectQualityAuditRequest(draft,error){
  const unknown=!Number.isInteger(error?.status)||error.status===0||error.status>=500;
  return {...draft,request:{...draft.request,phase:unknown?'unknown':'rejected'},dirty:true};
}
export function observeQualityAuditResult(draft,result){
  if(!draft?.request||result?.ok!==true||!uuid.test(result.finding_id||'')||!revision(result.revision_no)||!['awaiting_rectification','awaiting_review','closed'].includes(result.state)
    ||draft.findingId&&!same(draft.findingId,result.finding_id))throw new Error('保存回执尚不能与本次审计办理对应，请保留原请求并查询结果。');
  return {...draft,findingId:result.finding_id,request:{...draft.request,phase:'committed',result:structuredClone(result)},dirty:true};
}
export function qualityAuditResultVisible(detail,result){return Boolean(detail?.finding&&result?.ok&&same(detail.finding.finding_id,result.finding_id)&&revision(detail.finding.revision_no)&&detail.finding.revision_no>=result.revision_no&&(detail.finding.revision_no!==result.revision_no||detail.finding.state===result.state));}
export function qualityAuditBaselineChanged(draft,detail){
  const current=detail?.finding;
  if(!draft?.findingId||!current)return false;
  if(!same(draft.findingId,current.finding_id))return true;
  const request=draft.request;
  // A verified write advances its own baseline; later records still require review.
  if(request?.phase==='verified'&&qualityAuditResultVisible(detail,request.result)&&current.revision_no===request.result.revision_no)return false;
  return draft.expected_revision!==current.revision_no;
}
export function qualityAuditFailure(error){
  const messages={
    QUALITY_AUDIT_DESIGN_UNAPPROVED:'所选流程设计尚未取得当前部门负责人的有效确认。请先完成流程设计确认，再选择该设计开展审计。',
    QUALITY_AUDIT_DESIGN_CHANGED:'流程设计已变化，当前审计依据不能继续用于整改或复核。请由审计人明确采用同一制度档案当前已确认的设计，更新审计要求后，由部门重新提交整改。',
    QUALITY_AUDIT_DESIGN_CONFIRMATION_STALE:'流程设计原有的负责人确认已不满足当前条件。请先重新完成设计确认，再由审计人明确更新本事项的设计依据。',
    QUALITY_AUDIT_REVISION_CONFLICT:'本事项已有新的办理记录，当前输入已保留。请先查看最新记录并核对变化，再明确决定是否按最新记录继续本次输入。',
    QUALITY_AUDIT_FORBIDDEN:'当前身份没有本次审计办理资格。输入仍保留，请核对本人当前职责和事项范围。'
  };
  if(Object.hasOwn(messages,error?.code))return messages[error.code];
  if(error?.status===503)return '质量审计服务当前不可用，本次提交结果需核对；填写内容和原请求仍保留。请查询原请求结果，不要另建重复请求。';
  if(error?.status===403)return messages.QUALITY_AUDIT_FORBIDDEN;
  return userMessage(error,'本次审计办理结果尚待核对，请保留输入并查看最新记录。');
}
