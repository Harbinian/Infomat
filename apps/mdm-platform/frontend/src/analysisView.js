// View-only filtering: fixed IDs, all pages loaded, latest attempts explicit.
export const statuses = { queued: '排队中', running: '分析中', succeeded: '本轮检查完成', partial: '部分完成', failed: '分析失败', cancelled: '已取消' };
export const types = { definite_defect: '确定的登记矛盾', business_question: '待业务核对', not_covered: '未覆盖', material_constraint: '材料技术约束' };
export const stages = { uploaded_material: '独立上传材料', preview_revision: 'V7 预览修订', published_version: '正式已发布版本', handoff: '固定设计交接', definition: '固定台账版本', template: '模板批次', mapping: '固定来源映射' };
export const labelSource = s => `${stages[s.source_kind || s.kind] || s.kind} · ${s.original_name || '固定引用 ' + s.ref_id}`;
export function filterFindings(items, run, filter) {
  const latest = new Map();
  for (const a of run.attempts) if (!latest.has(a.step_key) || latest.get(a.step_key).attempt_no < a.attempt_no) latest.set(a.step_key, a);
  return items.filter(f => (filter.history === 'all' || latest.get(f.step_key)?.attempt_id === f.attempt_id) &&
    (!filter.type || f.finding_type === filter.type) && (!filter.input || f.subject_input_keys.includes(filter.input)) &&
    (!filter.q || [f.message, f.rule_id, f.semantic_locator].join(' ').toLocaleLowerCase().includes(filter.q.toLocaleLowerCase())));
}
export function createPayload(adapter, ref, description, requestId) {
  return { request_id: requestId, inputs: [{ input_key: 'source', kind: adapter.kind, ref_id: ref }],
    check_scope: { description, check_ids: adapter.check_ids }, rule_version: adapter.rule_version,
    parser_versions: { [adapter.parser_key]: adapter.rule_version }, steps: [{ step_key: 'check', input_keys: ['source'], check_ids: adapter.check_ids, parser_key: adapter.parser_key }], ai_metadata: null, rerun_of_run_id: null };
}
export function filteredExport(result, filter) {
  const findings = filterFindings(result.findings, result, filter), ids = new Set(findings.flatMap(f => f.evidence_ids));
  const { findings: ignored, evidence, ...run } = result;
  return { format_version: 'analysis-view-export-v1', source_format_version: result.format_version, selection: { ...filter },
    run, findings, evidence: evidence.filter(e => ids.has(e.evidence_id)), changes_governance: false };
}
