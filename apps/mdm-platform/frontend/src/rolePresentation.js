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

export const qualityEntryNotice = '质量审计办理与字段统计分别展示。办理开启后，须先由部门负责人本人同意当前流程设计，审计人才能登记发现和复核整改；字段统计不表示质量合格。';

// Result locations describe existing pages; they never grant access or certify completion.
const roleResults = Object.freeze({
  admin: '在“账号与授权办理”的同一员工账号行查看账号状态、有效角色及账号与授权操作记录；访问情况到“访问审计”查看。人员资料由行政人事另行维护。',
  mdm_lead: '流程确认及发布状态到“流程正式流转”选择同一流程查看。工作包的单项结论在原工作包“已记录的治理结论”查看；数据地图草案的检查、批准及发布结果在“数据地图承接工作区”查看。质量整改到“数据质量”的同一项发现查看责任部门、整改证据、最近复核及办理历史；跟踪进度不代整改或复核。保存治理结论不等于发布。',
  mdm_steward: '流程经办情况在原案例“责任与历史”中的“治理经办记录”查看；工作包内容在原工作包“逐项核对治理明细”的“已记录的治理结论”查看。需要组长审核时，交接同一流程或工作包名称，随后在原事项核对当前状态。',
  department_contact: '提交后在同一案例“流程预览与核对”的“本次核对”查看材料、部门确认及退回意见；正式状态到“流程正式流转”选择同一流程查看。定向问题在“正式数据治理工作包”的原问题中查“已提交答复”；承接工作区的原事实页查“当前事实答复”。质量整改在“数据质量”的同一项发现查看整改要求、最近一次审计复核和办理历史；退回后在原事项重交措施及证据。事实答复后等待MDM核对，质量整改提交后等待审计人复核。',
  department_mdm_reviewer: '材料确认后，在原案例“本次核对”的“确认结果”和材料历史查看；正式确认或退回结果到“流程正式流转”选择同一流程查看。本部门质量整改到“数据质量”的同一项发现查措施、证据、最近复核及办理历史，不代主对接人提交或代审计人复核。时限确认先记在该事项中，由组长登记后才显示为“办理截止日期”。',
  data_conflict_handler: '从待办进入原冲突查看结果：流程争议在原案例“责任与历史”的“争议协调与决定历史”查看；数据地图承接冲突在原冲突的“分歧办理历史”查看；其他冲突在“冲突管理”的同一记录查看协调历史和处理决定。升级后由项目决策组办理，协调不代替部门确认。',
  data_quality_auditor: '在“数据质量”的同一项发现中查看整改证据、复核结论及办理历史。先由部门负责人本人同意当前流程设计；合格关闭，不合格退回。设计变化后先重新确认，再明确更新审计依据。刷新字段统计不表示完成审计。',
  decision_group: '在当前待办所指的原争议查看决定：流程争议在原案例“责任与历史”的“争议协调与决定历史”查看；数据地图承接冲突在原冲突的“分歧办理历史”查看；其他升级冲突在“冲突管理”的同一记录查看处理决定。决定后仍由相关部门分别重新核对。',
  hr_directory_manager: '员工变更在“花名册”下方的“花名册导入与维护记录”查阅，组织变更在“组织架构”下方的“组织架构导入与维护记录”查阅；打开对应记录核对修改前后内容、操作人及原因。保存人员资料后，需要开户时另交管理员办理。'
});

const roleHandoffs = Object.freeze({
  admin: '人员资料需调整时交行政人事维护；账号与授权办理完成后，由账号本人按登录页面要求完成首次启用。治理材料只读，兼任业务角色也不代提交、审核、整改或发布。',
  mdm_lead: '具体治理事项明确分派给经办人，由组长核对其结果；缺业务事实时定向交目标部门答复。质量问题由责任部门主对接人整改、审计人复核，组长跟踪；流程与数据地图分别满足条件后办理发布。',
  mdm_steward: '将同一流程或工作包名称、已保存的治理记录及尚待核对事项交给MDM组长审核。缺少业务事实时，按原事项向目标部门定向提问；经办记录和答复不自动完成审核。',
  department_contact: '流程材料提交后交各参与部门负责人分别本人核对；收到修改意见时从原案例续修。质量整改提交后交数据质量审计人复核，退回后在同一项发现继续整改；设计变化先交负责人重新同意，再由审计人更新依据。',
  department_mdm_reviewer: '需要修改时交归口部门主对接人从原案例续修；同意后由MDM按后续治理及发布条件办理。质量整改由本部门主对接人提交、审计人复核；跨部门事项仍由其他部门负责人分别确认本人一侧。',
  data_conflict_handler: '常规协调形成依据后，仍交受影响部门负责人分别重新核对；重大争议交项目决策组作决定。要求修改材料时交有权编制人员或主对接人续修，协调不代替部门确认。',
  data_quality_auditor: '登记发现及整改要求后交责任部门主对接人整改；不合格退回同一部门继续补齐，重交后再复核。流程设计变化先由部门负责人重新同意，再由审计人明确更新同档设计依据并交回整改。',
  decision_group: '决定后交受影响部门负责人分别重新核对；要求修改材料时，由有权编制人员或主对接人续修后重新提交。项目决定不自动修改材料、确认部门事实或发布版本。',
  hr_directory_manager: '保存后组织及人员资料直接生效；需要开户或调整账号授权时，将已核对的员工姓名、工号交给管理员另行办理。'
});

export function governanceAdministrator(user) {
  const codes=[...(user?.roleCodes||[]),...(user?.rbacRoles||[]).map(role=>role.code||role.role_code)];
  return user?.identityKind==='system_admin'||codes.includes('admin');
}

export function roleCurrentItems(role,user,items=[]) {
  const owned=[...(user?.roleCodes||[]),...(user?.rbacRoles||[]).map(item=>item.code||item.role_code)];
  if(!role||!owned.includes(role.code)||governanceAdministrator(user))return [];
  return items.filter(item=>item.type!=='guidance'&&item.canAct===true&&(item.roleCode===role.code||item.role_code===role.code||(item.sourceRoles||[]).includes(role.code)));
}

export function roleCompletionPresentation(role) {
  if (!role || !Object.hasOwn(roleResults, role.code)) return role;
  const workflow = role.workflow?.map(step => step === '执行MDM结构卡口并发布'
    ? '核对检查结果及发布条件，再按页面允许的步骤审核和发布' : step);
  return { ...role, ...(workflow ? {workflow} : {}), resultGuidance: roleResults[role.code],handoffGuidance:roleHandoffs[role.code] };
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
