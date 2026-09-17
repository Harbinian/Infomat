// Pure comparison of integrity-checked, authorized P09 snapshots. No writes.
const { digest, json } = require('./dataMapDefinitionValues');
const ALGORITHM = 'analysis-diff-v1';
const labels = { added: '新增', persistent: '持续', evidence_changed: '证据变化', not_detected: '本轮未再检出', incomparable: '不可比较', manual_match: '待人工匹配' };
const sort = values => values.slice().sort((a, b) => json(a).localeCompare(json(b)));
const identity = input => input?.snapshot?.identity ? json({ kind: input.snapshot.kind, identity: input.snapshot.identity }) : null;
function index(run) {
  const inputs = new Map(run.manifest.inputs.map(i => [i.input_key, i]));
  const identities = run.manifest.inputs.map(identity);
  const logical = keys => sort(keys.map(k => identity(inputs.get(k))));
  const steps = run.manifest.steps.map(s => ({ definition: s,
    signature: json({ inputs: logical(s.input_keys), checks: [...s.check_ids].sort(), parser: s.parser_key }),
    attempt: run.attempts.filter(a => a.step_key === s.step_key).sort((a, b) => a.attempt_no - b.attempt_no).at(-1) }));
  const findings = steps.flatMap(s => (s.attempt?.findings || []).map(f => ({ finding: f, step: s,
    key: digest({ algorithm: ALGORITHM, scope: run.scope_department_id, rule: f.rule_id, subjects: logical(f.subject_input_keys), semantic: f.semantic_locator }),
    subjects: logical(f.subject_input_keys) })));
  const grouped = new Map();
  for (const row of findings) { if (!grouped.has(row.key)) grouped.set(row.key, []); grouped.get(row.key).push(row); }
  return { run, inputs, identities, logical, steps, findings, grouped };
}
function covered(indexed, row) {
  const applicable = indexed.steps.filter(s => s.definition.check_ids.includes(row.finding.rule_id) && row.subjects.every(i => indexed.logical(s.definition.input_keys).includes(i)));
  return applicable.length > 0 && applicable.every(s => ['succeeded', 'partial'].includes(s.attempt?.status) &&
    s.attempt.coverage?.checked.includes(row.finding.rule_id) && !s.attempt.coverage?.missing.includes(row.finding.rule_id));
}
function evidence(indexed, row) {
  const selected = row.finding.evidence_keys.map(k => row.step.attempt.evidence.find(e => e.evidence_key === k));
  if (!selected.length || selected.some(e => !e)) return null;
  return digest(sort(selected.map(e => ({ subject: identity(indexed.inputs.get(e.input_key)), fixed_reference: e.fixed_reference,
    locator_kind: e.locator_kind, locator: e.locator, locator_validation: e.locator_validation, note: e.note }))));
}
function subjectRemoved(indexed, row) {
  // P11 local references have meaning only inside the fixed material lineage.
  let refs;
  try { refs = [...row.finding.semantic_locator.matchAll(/\[([a-z_]+_ref)=([^\]]+)\]/g)].map(m => [m[1], decodeURIComponent(m[2])]); }
  catch { return true; }
  const documents = [...indexed.inputs.values()].filter(i => row.subjects.includes(identity(i))).map(i => indexed.run.documents?.[i.input_key]);
  const pair = row.finding.semantic_locator.match(/^field=(\d+)->(\d+)/);
  if (pair && !documents.some(d => d?.pairs?.some(p => String(p.source?.field_id) === pair[1] && String(p.target?.field_id) === pair[2]))) return true;
  const has = (value, key, ref) => value && typeof value === 'object' && (value[key] === ref || Object.values(value).some(v => has(v, key, ref)));
  return refs.some(([key, ref]) => !documents.some(d => has(d, key, ref)));
}
function compareAnalysisSnapshots(before, after) {
  const a = index(before), b = index(after);
  const reasons = [];
  if (![before, after].every(r => ['succeeded', 'partial', 'failed', 'cancelled'].includes(r.status))) reasons.push('RUN_NOT_TERMINAL');
  if ([before, after].some(r => ['failed', 'cancelled'].includes(r.status))) reasons.push('RUN_INCOMPLETE');
  if (before.scope_department_id !== after.scope_department_id) reasons.push('DEPARTMENT_SCOPE_CHANGED');
  if (before.manifest.rule_version !== after.manifest.rule_version) reasons.push('RULE_SEMANTICS_UNMAPPED');
  if (json(before.manifest.parser_versions) !== json(after.manifest.parser_versions)) reasons.push('PARSER_VERSION_CHANGED');
  if (json(before.manifest.ai_metadata) !== json(after.manifest.ai_metadata)) reasons.push('AI_CONFIGURATION_CHANGED');
  if (json(sort(before.manifest.check_scope.check_ids)) !== json(sort(after.manifest.check_scope.check_ids)) ||
      json(sort(a.steps.map(s => s.signature))) !== json(sort(b.steps.map(s => s.signature)))) reasons.push('CHECK_SCOPE_CHANGED');
  const rows = [], allKeys = [...new Set([...a.findings, ...b.findings].map(r => r.key))].sort();
  for (const key of allKeys) {
    const old = a.grouped.get(key) || [], current = b.grouped.get(key) || [], row = old[0] || current[0];
    let status, reason;
    const ambiguous = [a, b].some(i => row.subjects.some(s => s === null || i.identities.filter(x => x === s).length > 1));
    const unbound = [a, b].some(i => row.subjects.some(s => !i.identities.includes(s)));
    if (reasons.length) { status = 'incomparable'; reason = reasons[0]; }
    else if (ambiguous || old.length > 1 || current.length > 1 || [...old, ...current].some(r => r.finding.comparison_algorithm !== 'analysis-subject-v1' || r.finding.rule_version !== (old.includes(r) ? before : after).manifest.rule_version) || /value=|location-sha256=|coverage:/.test(row.finding.semantic_locator)) {
      status = 'manual_match'; reason = 'STABLE_SUBJECT_UNRESOLVED';
    } else if (unbound) { status = 'incomparable'; reason = 'SOURCE_LINEAGE_OUT_OF_SCOPE'; }
    else if (!covered(a, row) || !covered(b, row)) { status = 'incomparable'; reason = 'RULE_COVERAGE_INCOMPLETE'; }
    else if (old.some(r => !evidence(a, r)) || current.some(r => !evidence(b, r))) { status = 'manual_match'; reason = 'EVIDENCE_UNAVAILABLE'; }
    else if (old.length && current.length) {
      const left = evidence(a, old[0]), right = evidence(b, current[0]);
      if (!left || !right) { status = 'manual_match'; reason = 'EVIDENCE_UNAVAILABLE'; }
      else { status = left === right && old[0].finding.finding_type === current[0].finding.finding_type ? 'persistent' : 'evidence_changed'; reason = 'STABLE_IDENTITY_MATCH'; }
    } else if (subjectRemoved(old.length ? b : a, row)) { status = 'incomparable'; reason = 'LOCAL_SUBJECT_REMOVED_OR_UNAVAILABLE'; }
    else { status = old.length ? 'not_detected' : 'added'; reason = 'COMPARABLE_RULE_FULLY_CHECKED'; }
    rows.push({ match_key: key, status, label: labels[status], reason,
      before: old.map(r => ({ finding_id: r.finding.finding_id, attempt_id: r.step.attempt.attempt_id, evidence_keys: r.finding.evidence_keys })),
      after: current.map(r => ({ finding_id: r.finding.finding_id, attempt_id: r.step.attempt.attempt_id, evidence_keys: r.finding.evidence_keys })) });
  }
  return { algorithm: ALGORITHM, before_run_id: before.run_id, after_run_id: after.run_id,
    before_manifest_digest: before.manifest_digest, after_manifest_digest: after.manifest_digest,
    comparison_complete: reasons.length === 0 && rows.every(r => !['incomparable', 'manual_match'].includes(r.status)) &&
      [a, b].every(i => i.steps.every(s => s.attempt?.status === 'succeeded' && s.attempt.coverage?.missing.length === 0)),
    coverage: { before: a.steps.map(s => ({ step_key: s.definition.step_key, status: s.attempt?.status || 'queued',
      ...(s.attempt?.coverage || { expected: s.definition.check_ids, checked: [], missing: s.definition.check_ids }) })),
    after: b.steps.map(s => ({ step_key: s.definition.step_key, status: s.attempt?.status || 'queued',
      ...(s.attempt?.coverage || { expected: s.definition.check_ids, checked: [], missing: s.definition.check_ids }) })) },
    comparability_reasons: reasons, rows, counts: Object.fromEntries(Object.keys(labels).map(s => [s, rows.filter(r => r.status === s).length])),
    implies_remediation: false, changes_governance: false };
}
module.exports = { compareAnalysisSnapshots, ALGORITHM, labels };
