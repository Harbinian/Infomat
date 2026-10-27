export const upgradeChangeLabels = { added: '新增', modified: '修改', deleted: '删除', unchanged: '未变化' };
export const upgradeRecheckLabels = { facts: '事实', conclusions: '结论', shared_definitions: '共用定义', impact: '影响' };
export const evidenceLines = value => String(value || '').split(/\r?\n/u).map(x => x.trim()).filter(Boolean);
export const readSnapshot = value => typeof value === 'string' ? JSON.parse(value) : value;
const copy = value => structuredClone(value);
const emptyProof = () => ({ basis: '', evidence_refs: '' });
const fixedDetails = binding => readSnapshot(binding?.snapshot_json || binding?.snapshot || {})?.detail_versions || [];
export function bindingDetails(binding) { return fixedDetails(binding); }

export function withdrawalState(publicationId, values, latestCommittedResult) {
  const latest = latestCommittedResult?.publication_id === publicationId ? latestCommittedResult : null;
  const report = latest?.business_outcome === 'withdrawal_checked' && latest.report ? latest.report : values.withdrawalReport || null;
  const approval = latest?.business_outcome === 'withdrawal_approved' ? latest : values.withdrawalApproval || null;
  const checkMatches = Boolean(report && report.reason === values.reason?.trim() && Number(report.event_revision) === Number(values.expectedRevision));
  return { report, approval, checkMatches, approvalMatches: Boolean(checkMatches && approval?.binding_digest === report.binding_digest) };
}

export function governancePointers(governance, prefix = '') {
  if (!governance || typeof governance !== 'object') return [];
  return Object.entries(governance).flatMap(([key, value]) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) return [];
    const pointer = prefix + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
    return [{ pointer, value }, ...governancePointers(value, pointer)];
  });
}

export function createUpgradeDecisions(comparison, sourceBinding, targetBinding) {
  const before = fixedDetails(sourceBinding), after = fixedDetails(targetBinding);
  return comparison.changes.map(change => ({
    detail_ref: change.detail_ref, change_kind: change.change_kind,
    decision: change.change_kind === 'unchanged' ? '' : change.change_kind === 'deleted' ? 'remove' : 'recheck',
    source_detail_version_id: before.find(x => x.detail_ref === change.detail_ref)?.detail_version_id || null,
    target_detail_version_id: after.find(x => x.detail_ref === change.detail_ref)?.detail_version_id || null,
    reuse_scope: [], ...emptyProof(),
    rechecks: Object.fromEntries(Object.keys(upgradeRecheckLabels).map(key => [key, emptyProof()]))
  }));
}

function proof(value, label) {
  value = value || {};
  const refs = Array.isArray(value.evidence_refs) ? value.evidence_refs : evidenceLines(value.evidence_refs);
  if (!value.basis?.trim() || !refs.length) throw new Error(`${label}须填写依据和至少一条证据。`);
  return { basis: value.basis.trim(), evidence_refs: refs };
}

export function upgradeAssessmentBody(values, describeDetail = () => '所选治理明细') {
  if (!values.comparison || values.comparison.source_package_id !== values.sourcePackageId) throw new Error('请读取当前所选原包的固定版本比较。');
  if (values.sourceBindingsExist && !values.sourceBindingId) throw new Error('请选择准确的旧审核依据。');
  if (!Array.isArray(values.decisions) || values.decisions.length !== values.comparison.changes.length) throw new Error('请展开并完成全部逐项重核。');
  return {
    expected_revision: values.expectedRevision, source_package_id: values.sourcePackageId,
    source_binding_id: values.sourceBindingId || null, comparison_digest: values.comparison.comparison_digest,
    ...proof(values, '升级评估'), decisions: values.decisions.map(item => {
      const name = describeDetail(item.detail_ref) || '所选治理明细';
      if (!item.decision) throw new Error(`请明确“${name}”的沿用决定。`);
      if (item.decision === 'reference_and_recheck' && (!item.source_detail_version_id || !item.reuse_scope.length)) throw new Error(`请明确“${name}”的旧审核字段沿用范围。`);
      return { detail_ref: item.detail_ref, change_kind: item.change_kind, decision: item.decision,
        ...(item.source_detail_version_id ? { source_detail_version_id: item.source_detail_version_id } : {}),
        ...(item.target_detail_version_id ? { target_detail_version_id: item.target_detail_version_id } : {}),
        reuse_scope: item.decision === 'reference_and_recheck' ? [...item.reuse_scope] : [],
        ...proof(item, name), rechecks: Object.fromEntries(Object.entries(upgradeRecheckLabels).map(([key, label]) => [key, proof(item.rechecks?.[key], `“${name}”的${label}重核`)])) };
    })
  };
}

export function restorationCandidate(publication, trace, scopeMode) {
  const fixed = trace.revisions?.find(x => x.revision_id === publication.manifest.handoff_revision_id);
  if (!fixed) throw new Error('原发布的准确草案修订不可读，不能按现值重建。');
  const body = copy(readSnapshot(fixed.snapshot_json));
  delete body.restores_publication_id; delete body.restoration; delete body.restoration_adjustments;
  body.scope_mode = scopeMode;
  for (const item of body.items) {
    const origin = publication.manifest.items.find(x => x.item_ref === item.item_ref);
    if (!origin) throw new Error('原发布清单与准确草案不一致。');
    item.target_id = origin.target_id;
    if (origin.produces_version && ['object', 'field', 'data_element'].includes(item.target_kind)) {
      item.operation = 'modify'; item.base_version_ref = origin.target_version_ref; delete item.target_version_ref;
    }
  }
  return body;
}

export function restorationRequestBody(values, describeItem = () => '所选原发布条目') {
  if (!values.targetPackageId || values.targetTrace?.package_id !== values.targetPackageId) throw new Error('请读取并核对准确恢复目标包。');
  if (!values.targetBindingId) throw new Error('请明确目标准确审核依据。');
  if (!values.restorationDraft) throw new Error('请显式准备候选草案并逐项核对。');
  const target = values.targetMode === 'append' ? values.targetTrace.drafts?.find(x => x.handoff_id === values.targetHandoffId && x.state === 'draft' && Number(x.active_slot) === 1) : null;
  if (values.targetMode === 'append' && !target) throw new Error('请选择目标包当前未提交草案。');
  if (target && (!Number.isSafeInteger(values.expectedTargetRevision) || values.expectedTargetRevision < 1)) throw new Error('请明确采用目标准确草案修订。');
  if (!Array.isArray(values.itemMappings)) throw new Error('请逐项填写原发布内容的目标和采用方式。');
  return { expected_revision: values.expectedRevision, target_package_id: values.targetPackageId, expected_target_binding_id: values.targetBindingId,
    ...(target ? { target_handoff_id: target.handoff_id } : {}), expected_target_revision: target ? values.expectedTargetRevision : 0,
    scope_mode: values.scopeMode, draft: copy(values.restorationDraft), ...proof(values, '恢复'),
    item_mappings: values.itemMappings.map(item => {
      const name = describeItem(item.source_item_ref) || '所选原发布条目';
      if (!['adopt', 'adapt'].includes(item.content_decision) || !item.target_item_ref) throw new Error(`请明确“${name}”的目标和采用方式。`);
      return { source_item_ref: item.source_item_ref, target_item_ref: item.target_item_ref, content_decision: item.content_decision, ...proof(item, name) };
    }) };
}
