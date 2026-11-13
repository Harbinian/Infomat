import {businessStatus,businessText} from './businessPresentation.js';

export const conflictRequestActions=new Set(['final-decide','department-recheck','reopen']);
const stateNames={awaiting_department_recheck:'待受影响部门负责人重新核对',recheck_returned:'部门要求修改处理方案',source_changed:'冲突内容或参与部门已变化，待重新记录方案',resolved:'受影响部门已完成重新核对',legacy_resolved:'历史已解决，未留存本轮部门重新核对'};
const originalStateNames={pending:'待处理',coordinating:'协调中',escalated:'已升级'};
export const conflictRecheckUnavailable='当前服务尚未提供部门本人重新核对的完整办理条件，暂不能提交处理方案、部门重核或重新打开。原记录和原输入保留供查阅，请联系维护人员核对发布状态。';
export function conflictRecheckReady(detail){
 const fields=['write_token','workflow_state','workflow_revision','workflow_history','department_rechecks','allowed_actions'];
 return Boolean(detail&&fields.every(key=>Object.hasOwn(detail,key))&&typeof detail.write_token==='string'&&detail.write_token.trim()
  &&typeof detail.workflow_state==='string'&&detail.workflow_state.trim()&&Number.isSafeInteger(detail.workflow_revision)&&detail.workflow_revision>=0
  &&Array.isArray(detail.workflow_history)&&Array.isArray(detail.department_rechecks)&&Array.isArray(detail.allowed_actions));
}
export function conflictWorkflowState(row={}){
 return Object.hasOwn(stateNames,row.workflow_state)?stateNames[row.workflow_state]:Object.hasOwn(originalStateNames,row.status)?originalStateNames[row.status]:businessStatus(row.status,'状态待核对');
}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function conflictWorkflowWrite(draft){
 if(!conflictRequestActions.has(draft?.action)||!uuid.test(draft.requestId||'')||!/^\d+$/.test(String(draft.id||''))||!['term','field'].includes(draft.type)||typeof draft.expectedToken!=='string'||!draft.expectedToken)throw new Error('原输入缺少准确的冲突或请求依据。请保留需要的文字，核对原记录后明确重新开始办理。');
 const body={request_id:draft.requestId,expected_token:draft.expectedToken},values=draft.values||{};
 if(draft.action==='final-decide'){
  if(!values.resolution?.trim())throw new Error('请填写处理方案或项目决定及依据。');body.resolution=values.resolution.trim();
 }
 if(draft.action==='department-recheck'){
  if(!['confirmed','needs_changes'].includes(values.decision))throw new Error('请选择本人重新核对的结论。');
  if(!values.basis?.trim())throw new Error('请填写本人重新核对的依据。');Object.assign(body,{decision:values.decision,basis:values.basis.trim()});
 }
 if(draft.action==='reopen'){
  if(!values.basis?.trim())throw new Error('请填写重新打开的原因。');body.basis=values.basis.trim();
 }
 return {url:`/api/conflicts/${encodeURIComponent(draft.id)}/${draft.action}?type=${draft.type}`,method:'POST',body};
}
export const conflictDepartmentDecision=value=>value==='confirmed'?'已记录确认':value==='needs_changes'?'已要求修改':'待本人核对';
export const conflictRecheckReason=value=>value?businessText(value,'当前负责人资格或办理条件需重新核对'):'当前负责人资格或办理条件需重新核对';

export function conflictWorkflowCounts(rows=[]){
 const pending=state=>rows.filter(row=>row.workflow_state===state).length;
 return {coordinating:rows.filter(row=>['pending','coordinating'].includes(row.status)&&!['awaiting_department_recheck','recheck_returned','source_changed'].includes(row.workflow_state)).length,
  recheck_pending:pending('awaiting_department_recheck'),recheck_returned:pending('recheck_returned')+pending('source_changed')};
}
export function currentConflictProposal(events=[]){
 let proposal=null;for(const event of events){if(event.action==='reopened')proposal=null;else if(event.action==='proposal_recorded')proposal=event;}return proposal;
}
