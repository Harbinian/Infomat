// Responsibility subjects include business participants as well as fixed account roles.
// These labels describe the recorded subject category, never a personal appointment.
const participantNames = Object.freeze({
  process_business_owner: '流程业务负责人',
  account_holder: '账号本人',
  department_final_responsible_person: '本部门最终负责人',
  business_expert: '业务专家',
  related_department_final_responsible_person: '相关部门最终负责人',
  affected_department_final_responsible_person: '受影响部门最终负责人',
  origin_department_final_responsible_person: '归口部门最终负责人',
  counterparty_department_final_responsible_person: '承接部门最终负责人'
});

export function roleSubjectName(code, roles = []) {
  return roles.find(role => role.code === code)?.name
    || (Object.hasOwn(participantNames, code) ? participantNames[code] : '参与主体名称未记录');
}

export const qualityEntryNotice = '当前入口只供查阅字段治理统计，尚未提供审计发现登记、整改要求记录和整改复核办理。刷新统计不表示已完成审计。';

// Result locations describe existing pages; they never grant access or certify completion.
const roleResults = Object.freeze({
  admin: '在“账号与授权办理”的同一员工账号行查看账号状态、有效角色及账号与授权操作记录；访问情况到“访问审计”查看。人员资料由行政人事另行维护。',
  mdm_lead: '流程确认及发布状态到“流程正式流转”选择同一流程查看。工作包的单项结论在原工作包“已记录的治理结论”查看；数据地图草案的检查、批准及发布结果在“数据地图承接工作区”查看。保存治理结论不等于发布。',
  mdm_steward: '流程经办情况在原案例“责任与历史”中的“治理经办记录”查看；工作包内容在原工作包“逐项核对治理明细”的“已记录的治理结论”查看。需要组长审核时，交接同一流程或工作包名称，随后在原事项核对当前状态。',
  department_contact: '提交后在同一案例“流程预览与核对”的“本次核对”查看材料、部门确认及退回意见；正式状态到“流程正式流转”选择同一流程查看。定向问题在“正式数据治理工作包”的原问题中查“已提交答复”；承接工作区的原事实页查“当前事实答复”。答复后等待MDM核对。',
  department_mdm_reviewer: '材料确认后，在原案例“本次核对”的“确认结果”和材料历史查看；正式确认或退回结果到“流程正式流转”选择同一流程查看。时限确认先记在该事项中，由组长登记后才显示为“办理截止日期”。',
  data_conflict_handler: '从待办进入原冲突查看结果：流程争议在原案例“责任与历史”的“争议协调与决定历史”查看；数据地图承接冲突在原冲突的“分歧办理历史”查看；其他冲突在“冲突管理”的同一记录查看协调历史和处理决定。升级后由项目决策组办理，协调不代替部门确认。',
  data_quality_auditor: '在“数据质量”点击“刷新字段统计”后查看下方统计区；需要查阅已发布字段时进入“数据地图台账”。当前没有审计发现、整改要求及整改复核办理入口，不能把刷新统计当作完成审计。',
  decision_group: '在当前待办所指的原争议查看决定：流程争议在原案例“责任与历史”的“争议协调与决定历史”查看；数据地图承接冲突在原冲突的“分歧办理历史”查看；其他升级冲突在“冲突管理”的同一记录查看处理决定。决定后仍由相关部门分别重新核对。',
  hr_directory_manager: '员工变更在“花名册”下方的“花名册导入与维护记录”查阅，组织变更在“组织架构”下方的“组织架构导入与维护记录”查阅；打开对应记录核对修改前后内容、操作人及原因。保存人员资料后，需要开户时另交管理员办理。'
});

export function roleCompletionPresentation(role) {
  if (!role || !Object.hasOwn(roleResults, role.code)) return role;
  const workflow = role.workflow?.map(step => step === '执行MDM结构卡口并发布'
    ? '核对检查结果及发布条件，再按页面允许的步骤审核和发布' : step);
  return { ...role, ...(workflow ? {workflow} : {}), resultGuidance: roleResults[role.code] };
}

function ownedGuidanceRole(item, roles = [], sourceItems = []) {
  // Priority projections can omit the type; match their unique original guide.
  if (!item || typeof item !== 'object') return null;
  if (item?.type != null && item.type !== 'guidance') return null;
  if (item.type !== 'guidance' && (!item.title || !item.target)) return null;
  // A same-named business item makes a metadata-free projection ambiguous.
  const matches = sourceItems.filter(row => row.title === item?.title && row.target === item?.target);
  const guide = item?.type === 'guidance' ? item : matches.length === 1 && matches[0].type === 'guidance' ? matches[0] : null;
  if (!guide) return null;
  const code = guide.roleCode || guide.roleHint || (typeof guide.id === 'string' && guide.id.startsWith('guide:') ? guide.id.slice(6) : null);
  return roles.find(row => row.code === code && row.owned === true) || null;
}

export function isOwnedRoleGuidance(item, roles = [], sourceItems = []) {
  return Boolean(ownedGuidanceRole(item, roles, sourceItems));
}

export function roleGuidanceResult(item, roles = [], sourceItems = []) {
  const role = ownedGuidanceRole(item, roles, sourceItems);
  return role ? roleCompletionPresentation(role).resultGuidance || '' : '';
}
