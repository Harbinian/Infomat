export function walkCoverageReadiness(batch, materialId) {
  const coverage = batch.coverage?.[materialId] || {};
  const required = batch.requiredDepartments || [];
  const missing = required.filter(department => !coverage.feedbackByDepartment?.[department]);
  const completionBlocker = batch.status !== 'frozen' ? '请先冻结批次。'
    : missing.length ? `等待 ${missing.length} 个指定部门反馈。` : '';
  return { coverage, required, missing, completionBlocker };
}

export function batchFreezeBlockers(batch, state) {
  const blockers = [];
  if (!batch.materialIds.length) blockers.push('选入评审材料');
  if (!batch.memberIds.length) blockers.push('选择参会人员');
  if (!batch.leadId) blockers.push('指定主持人');
  if (!batch.recorderId) blockers.push('指定记录员');
  if (!batch.requiredDepartments.length) blockers.push('明确必需反馈部门');
  for (const id of batch.materialIds) {
    const material = state.materials.find(item => item.id === id);
    if (!material) {
      blockers.push('批次中的材料快照无法读取');
      continue;
    }
    const label = `${material.name}（${material.sourcePath}）`;
    if (material.status !== 'confirmed') blockers.push(`请${material.sourceDepartment || '来源部门'}代表确认 ${label}`);
    if (material.themeId !== batch.themeId) blockers.push(`${label}的主题与本批次不一致`);
  }
  for (const department of batch.requiredDepartments) {
    const represented = state.users.some(user => batch.memberIds.includes(user.id) &&
      user.department === department && user.roles.includes('representative'));
    if (!represented) blockers.push(`参会名单缺少${department}代表`);
  }
  return blockers;
}
