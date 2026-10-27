import {businessText} from './businessPresentation.js';

// Stored filenames and event payloads remain untouched; these are display labels.
export function caseRevisionMaterialLabel(revision, caseRow) {
  const name = caseRow?.process_name || revision?.document?.process?.process_name || revision?.document?.process_name || revision?.process_name;
  const readable = name && !/\.(?:json|[cm]?js|jsx|tsx?|py|sql)$/i.test(String(name)) ? businessText(name, '') : '';
  return readable ? `《${readable}》流程编制材料` : '流程编制材料（流程名称未记录）';
}

const events = {
  preview_case_created: '新建流程案例并保存首次材料',
  preview_revision_uploaded: '保存新的流程修订',
  department_review_decision_recorded: '记录部门核对意见',
  review_result_carried_forward: '保留原部门核对意见',
  review_item_reopened: '列入部门核对事项',
  formal_draft_promoted: '生成正式草稿',
  process_case_confirmation_usage_restricted: '限定原确认记录的使用范围'
};
const operations = {
  submission: '补充提交材料',
  submission_confirm: '本人确认提交材料及本部门范围',
  propose: '提出办理事项',
  confirm: '本人确认办理事项',
  register: '登记已确认事项',
  cancel: '撤销未登记事项',
  formal_controls: '办理制度版次或优化建议'
};
const proposalKinds = {submission:'提交材料核对',scope:'参与范围变化',owner:'真实归口交接',lifecycle:'办理状态变化',deadline:'办理时限约定'};
const controlActions = {add_suggestion:'提出独立优化建议',dispose_suggestion:'记录优化建议处置',record_institution_editions:'补充来源及拟议制度版次'};
const disputeActions = {assign:'分派争议协调人',coordinate:'记录争议协调结果',escalate:'升级争议至项目决策组',decide:'记录项目决策组决定',rebase:'核对争议来源变化',request_recheck:'请相关部门重新核对争议事项'};
const known = (labels, key) => typeof key === 'string' && Object.hasOwn(labels, key) ? labels[key] : '';

export function caseHistoryAction(event) {
  const type = event?.event_type;
  if (!type) return '办理记录（原记录未提供操作类型）';
  const payload = event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
  if (type === 'process_case_governance_action') {
    if (payload.schema_version && payload.schema_version !== 'process-case-governance-v1') return '案例办理记录（具体操作说明待核对）';
    const operation = payload.operation;
    const kind = known(proposalKinds, payload.result?.change?.kind || payload.result?.kind);
    if (operation === 'propose' && payload.result?.changed === false) return '记录比较结果（未建立变化事项）';
    if (operation === 'propose' && kind) return `提出${kind}`;
    if (operation === 'register' && kind) return `登记已确认的${kind}`;
    return known(operations, operation) || '案例办理记录（具体操作说明待核对）';
  }
  if (type === 'process_case_business_acceptance') return '记录业务验收结论';
  if (type === 'process_formal_control') return (!payload.schema_version || payload.schema_version === 'process-formal-controls-v1') && known(controlActions, payload.action) || '制度版次或建议办理（具体操作说明待核对）';
  if (type === 'process_dispute_action') return (!payload.schema_version || payload.schema_version === 'process-dispute-v1') && known(disputeActions, payload.action) || '争议办理记录（具体操作说明待核对）';
  return known(events, type) || '其他办理记录（操作说明待核对）';
}
