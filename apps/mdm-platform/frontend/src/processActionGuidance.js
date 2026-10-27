import {businessText} from './businessPresentation.js';

// These labels describe the source of an existing check; they never grant actions.
export function formalAccountabilityContext(detail, user = {}) {
  const administrator = user.identityKind === 'system_admin'
    || (user.roleCodes || []).includes('admin')
    || (user.rbacRoles || []).some(role => role.code === 'admin');
  if (administrator) return {readOnly: true, title: '当前账号只读', message: '管理员可查阅本流程材料及办理记录，不能代替部门负责人确认。请由归口部门当前已登记且具有有效授权的负责人本人办理；这不表示归口部门不可用。'};
  const formal = detail?.formal_promotion?.department_accountability;
  if (formal) return {value: formal, title: '归口部门负责人办理条件'};
  const current = detail?.department_accountability;
  if (!current?.department_id) return {title: '当前账号的负责人资格', message: '当前尚未取得本人所属部门的负责人资格，不能据此判断案例归口部门是否可办理。请先核对“当前身份”；归口部门记录应另行查阅。'};
  return {value: current, title: '当前账号所属部门的负责人资格'};
}

// Only current server-returned material and confirmations select the visible next step.
export function submissionNextStep(state, review) {
  if (state?.schema_ready === false) return {kind: 'unavailable', title: '当前材料办理功能尚未准备完成', message: '请由维护人员先核对材料办理功能。当前只能查阅已有流程内容，不能据此认定提交材料完整或要求部门重复提交。'};
  const issues = new Set((state?.blocking_issues || []).map(issue => issue.code));
  const submission = state?.submission;
  if (!submission || submission.missing?.length || issues.has('PROCESS_CASE_SUBMISSION_INCOMPLETE')) return {
    kind: 'materials', title: '下一步：由归口主对接人补齐提交材料',
    message: '归口主对接人请展开“补充材料或办理其他事项”，选择“补充本次提交材料”，核对编制目的、修订原因、本次变化、来源材料及实际参与部门后保存。保存结果在上方“阅读本次提交材料”和“核对本部门责任范围”查看。',
    action: state?.allowed_actions?.includes('save_submission') ? 'submission' : null,
    actionLabel: '补充本次提交材料'
  };
  if (!review.participants.length || issues.has('PROCESS_CASE_PARTICIPANTS_PENDING')) return {
    kind: 'participants', title: '下一步：由归口主对接人明确参与部门及责任范围',
    message: '请按实际来源补齐参与部门、责任说明及参与依据，不从岗位名称推测部门。首次补齐在“补充本次提交材料”中办理；已提交后的实际范围变化，须在“补充材料或办理其他事项”选择“申请参与范围变化”。完成后在上方“核对本部门责任范围”查看。'
  };
  const material = review.material;
  if (!material || material.state !== 'registered' || !material.confirmation_states?.length
    || material.confirmation_states.some(value => value.valid !== true)
    || issues.has('PROCESS_CASE_SUBMISSION_CONFIRMATION_PENDING') || issues.has('PROCESS_CASE_SUBMISSION_RECONFIRMATION_REQUIRED')) {
    const testContext=material?.confirmation_states?.some(value=>value.reason==='functional_test_only')?'原功能测试确认仅留作测试记录，不计作部门业务确认。':'';
    const resultLocation=(review.canConfirm?'本人保存后在“确认结果”核对本部门状态。':'')+'展开“优化建议、制度版次与历史记录”，在材料历史查看各部门确认时间和依据。';
    return {kind:'confirmation',title:review.canConfirm?'下一步：本人核对并确认提交材料':review.confirmed?'下一步：等待其他参与部门负责人完成核对':'下一步：等待相关部门负责人确认提交材料',
      message:testContext+(review.canConfirm?'请先核对提交材料和本部门责任范围，再点击上方“本人确认提交材料及本部门范围”，填写本人依据并点击“保存本次办理”。':review.confirmed?'本部门确认已保存，其他尚未完成核对的参与部门须由其当前已登记且具有有效授权的负责人本人办理。':'当前账号没有本次本人确认入口。请由相关部门当前已登记且具有有效授权的负责人核对材料和本部门责任范围，亲自填写依据并保存；当前账号不能代其确认。')+resultLocation+(!review.canConfirm?'请在对应人员办理后点击“刷新材料与案例状态”重新核对。':'')};
  }
  if (!state.deadline && !review.otherChanges.some(change => change.kind === 'deadline')) return {
    kind: 'deadline', title: '下一步：约定本次办理截止日期',
    message: '提交材料及部门范围确认后，由MDM组长提出日期；参与部门负责人分别核对并确认，再由组长登记。登记结果在本页“办理截止日期”查看。',
    action: state.allowed_actions?.includes('propose_change') ? 'deadline' : null,
    actionLabel: '提出本次办理截止日期'
  };
  return null;
}

export function processIssuePresentation(issue, document) {
  if (!issue || !document) return issue;
  const message = String(issue.message || '');
  const legacy = /^(.*)的字段\d+(.+)$/u.exec(message);
  if (!legacy) return issue;
  const unresolved = () => ({...issue, message: `原检查中的《${businessText(legacy[1] || '表单名称未记录', '表单名称暂无法直接展示')}》有填写项${legacy[2]}，但当前修订中无法准确定位该项。请核对该修订的表单原文后重新检查。`});
  const parts = String(issue.path || issue.focusPath || '').replaceAll('/', '.').replaceAll('[', '.').replaceAll(']', '').replace(/^\./, '');
  const match = /^forms\.(\d+)\.areas\.(\d+)\.items\.(\d+)(?:\.|$)/.exec(parts);
  if (!match) return unresolved();
  const form = document.forms?.[Number(match[1])];
  const area = form?.areas?.[Number(match[2])];
  const item = area?.items?.[Number(match[3])];
  if (!item) return unresolved();
  const formName = businessText(form.form_name || '表单名称未记录', '表单名称暂无法直接展示');
  const areaName = businessText(area.area_title || '区域名称未记录', '区域名称暂无法直接展示');
  const itemName = businessText(item.item_name || '填写项名称未记录', '填写项名称暂无法直接展示');
  return {...issue, message: `《${formName}》／${areaName}：${itemName}${legacy[2]}`,
    fieldLocation: {formName, areaName, itemName, item}};
}

export function processChecksPresentation(checks, document) {
  return checks ? {...checks, issues: checks.issues?.map(issue => processIssuePresentation(issue, document))} : checks;
}
