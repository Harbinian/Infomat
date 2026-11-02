import { businessName, businessText } from './businessPresentation.js';

// A timestamp without an offset is not evidence of the historical time zone.
export function businessDateTime(value) {
  if (!value) return '时间未记录';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) return text.replace('T', ' ') + '（时区未记录）';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) return '时间暂无法确认，请核对原记录';
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return '时间暂无法确认，请核对原记录';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}（北京时间）`;
}

// Guidance follows explicit workbench facts; it never grants an action or infers
// a person's appointment from their name, position, or the record's identifier.
export function responsibilityGuidance(row, dispute = false) {
  const name = businessName(row, row?.target_type === 'work_package' ? '名称未记录的工作包' : '名称未记录的流程');
  if (dispute) return { name, role: '按本次争议的当前资格查阅或办理', action: '查看争议内容及本人可办操作', instruction: '先核对争议事项、各方意见和已有依据，再查看页面提供的当前操作；没有办理按钮时，仅可查阅，不能代替协调人或决策人员提交。' };
  if (row?.appointment_action === 'assign_owner') return { name, role: '本部门负责人', action: '核对并指定流程业务负责人', instruction: '进入流程后，先点击“责任与历史”，在“流程责任与争议办理”中点击“指定流程业务负责人”，核对人选并填写“本次办理依据”，再点击“保存本次治理办理”。任命不代替本部门流程事实确认。' };
  if (row?.assignment_kind === 'steward' && row?.target_type === 'case') return { name, role: '本流程已分派的治理经办人', action: '填写本流程治理经办情况', instruction: '进入流程后，先点击“责任与历史”，在“流程责任与争议办理”中点击“记录治理经办情况”，填写经办内容及依据，再点击“保存本次治理办理”。保存后可在“治理经办记录”核对结果，不会自动确认或发布流程。' };
  if (row?.assignment_kind === 'steward' && row?.target_type === 'work_package') return { name, role: '本工作包已分派的治理经办人', action: '查看工作包及本次治理事项', instruction: '进入工作包，先核对固定流程来源和本次分派范围，再按页面允许的操作补充治理内容；保存后查看当前结果及尚待办理的事项。' };
  if (row?.assignment_kind === 'owner') return { name, role: '本流程已指定的业务负责人', action: '查看本流程内容及责任记录', instruction: '先查阅当前流程内容和本人的责任记录；需要补充或修改事实时，按页面指引交由有权人员续修。流程业务负责人任命本身不增加部门最终确认权。' };
  return { name, role: '当前职责待核对', action: '查看当前责任及允许的操作', instruction: '进入详情核对有效职责和本次事项。职责未明确时，不推定本人需要提交、确认或发布。' };
}

export const historicalPersonName = row => row?.assignee_name ? businessText(row.assignee_name, '历史姓名未记录') : '历史姓名未记录';

export const governanceActionInstruction = action => ({
  assign_steward: '请选择本次治理经办人并填写分派依据；保存后，在“责任任命记录”核对结果。',
  assign_owner: '请选择本部门的流程业务负责人并填写任命依据；保存后，在“责任任命记录”核对结果。',
  record_work: '请填写本次实际经办内容及依据；保存后，在“治理经办记录”核对结果。',
  assign: '请选择争议协调人并填写分派依据；保存后，在“争议协调与决定历史”核对结果。',
  coordinate: '请填写本次协调依据；保存后查看协调历史，参与部门仍需按当前要求核对事实。',
  escalate: '请填写争议事项、影响范围、已协调情况及各方观点和依据，再提交项目决策组。',
  decide: '请选择项目决策结果，核对争议材料并填写决定依据；保存后，相关部门仍需分别重新核对。',
  request_recheck: '请填写交回参与部门重新核对的依据；保存后查看新的核对状态及待办。',
  rebase: '请核对本次修订的影响并填写恢复依据；保存后查看当前争议及核对状态。'
})[action] || '请核对本次事项，按页面要求填写内容和依据；保存后查看办理结果。';
