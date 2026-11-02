// A retained test record does not complete the current business confirmation.
import {businessText,userMessage} from './businessPresentation.js';

export const caseChangeTitle = change => ({submission:'提交材料及本部门范围确认',scope:'参与部门范围变化',owner:'流程归口交接',lifecycle:'案例办理状态变化',deadline:'办理截止日期约定'})[change?.kind] || '待核对的变更事项';

// The visible summary reads the selected immutable proposal, never its identifier.
export function caseChangeFields(change, departments = []) {
  const value = change?.change || {};
  const name = id => businessText(departments.find(row => String(row.id) === String(id))?.name || '部门名称未记录');
  const rows = [];
  if (change?.kind === 'deadline') rows.push(['本次约定截止日期', /^\d{4}-\d{2}-\d{2}$/.test(value.due_date || '') ? value.due_date : '原事项未记录具体日期，请先核对，勿据此确认']);
  if (change?.kind === 'owner') rows.push(['移交部门', name(value.source_department_id)], ['接收部门', name(value.target_department_id)], ['职责影响', businessText(value.duty_impact)], ['在办事项交接', businessText(value.pending_work)]);
  if (change?.kind === 'lifecycle') rows.push(['本次操作', ({pause:'暂停办理',terminate:'终止办理',resume:'恢复办理'})[value.operation] || '操作内容未记录，请先核对']);
  if (change?.kind === 'scope') for (const participant of value.participants || []) rows.push(['变更后的参与部门及职责', `${name(participant.department_id)}：${businessText(participant.responsibilities)}`]);
  const required = value.required_department_ids || value.department_ids || [];
  if (required.length) rows.push(['需要分别确认的部门', required.map(name).join('、')]);
  rows.push(['本次原因', businessText(value.reason || change?.reason || value.basis, '原事项未记录原因')]);
  return rows;
}

export function submissionReviewModel(state,departmentId){
  const material=[...(state?.changes||[])].reverse().find(change=>change.kind==='submission'&&change.current===true&&change.state!=='cancelled'&&state.submission_id&&change.change?.submission_id===state.submission_id);
  const states=material?.confirmation_states||[];
  const mine=departmentId==null?undefined:states.find(value=>String(value.department_id)===String(departmentId));
  const functionalTestOnly=mine?.reason==='functional_test_only'||departmentId==null&&states.some(value=>value.reason==='functional_test_only'),confirmed=mine?.valid===true&&!functionalTestOnly;
  const confirmationCompleted=confirmed;
  return {material,confirmed,confirmationCompleted,functionalTestOnly,canConfirm:Boolean(material&&!confirmed&&state.allowed_actions?.includes('confirm_submission')),
    participants:state?.submission?.participants||[],
    otherChanges:(state?.changes||[]).filter(change=>change.kind!=='submission'&&change.current===true&&change.state==='pending'),
    issues:(state?.blocking_issues||[]).map(issue=>functionalTestOnly&&issue.code==='PROCESS_CASE_SUBMISSION_RECONFIRMATION_REQUIRED'?{...issue,message:'原功能测试确认记录已保留，不计作部门业务确认；当前提交材料仍待相关部门负责人本人核对确认。'}:issue.code==='PROCESS_CASE_CHANGE_PENDING'&&!(state?.changes||[]).some(change=>change.state==='pending'&&change.kind!=='submission')?{...issue,message:'当前提交材料仍待相关部门负责人本人确认。'}:issue)};
}

// Legacy validation messages can carry field keys; only the presentation changes.
export function submissionIssueText(issue={}) {
  const value=issue.message||issue.error;
  if(typeof value==='string'&&value.startsWith('最低提交材料待补正：')){
    const labels={purpose:'编制目的',revision_reason:'修订原因',change_summary:'本次变化说明',sources:'来源材料',participants:'参与部门及责任范围',revision_reason_and_change_summary:'修订原因及本次变化说明',purpose_or_revision_reason:'编制目的或修订原因'};
    return '最低提交材料待补正：'+value.slice('最低提交材料待补正：'.length).split('、').map(key=>labels[key]||(/[\p{Script=Han}]/u.test(key)?businessText(key,'其他必要材料'):'其他必要材料')).join('、');
  }
  return userMessage(value,'此项检查尚未完成，请核对提交材料。');
}

export function caseResultLocation(action,kind) {
  const history='展开“优化建议、制度版次与历史记录”，可查看本次材料及办理时限历史。';
  if(action==='acceptance')return '请展开“优化建议、制度版次与历史记录”，查看“已保存的业务验收结果”。';
  if(action==='confirm_submission'||action==='submission')return '请在“当前任务”或“确认结果”查看提交材料状态。'+history;
  if(action==='deadline')return '请在“需要确认或登记的具体事项”查看提出的日期及参与部门，等待相关部门负责人分别确认。'+history;
  if(action==='confirm_change'&&kind==='deadline')return '请在本次时限事项查看本部门确认；全部所需部门确认后，由组长登记。登记结果在“办理截止日期”查看。'+history;
  if(action==='register_change'&&kind==='deadline')return '请在“办理截止日期”核对已登记日期。'+history;
  return '请展开“优化建议、制度版次与历史记录”，核对本次对应的办理记录。';
}
