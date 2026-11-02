// Formal review evidence is stored in the existing immutable audit payload.
// Old task notes remain readable; only new negative decisions use this contract.
const { httpError } = require('./processDesignPolicy');
function reviewEvidence(decision, input = {}) {
  if (!['approve', 'reject', 'needs_changes'].includes(decision)) throw httpError(422, '审核结论无效', { code: 'FORMAL_REVIEW_DECISION_INVALID' });
  if (decision === 'approve') return null;
  const fields = [['problem', '具体问题'], ['basis', '判断依据'], ['revision_request', '修改要求']];
  const details = fields.filter(([key]) => typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 4000)
    .map(([field, label]) => ({ field, message: label + '须明确填写且不超过4000字' }));
  if (details.length) throw httpError(422, '拒绝或需要修改须填写具体问题、判断依据及修改要求', { code: 'FORMAL_REVIEW_EVIDENCE_REQUIRED', details });
  return Object.fromEntries(fields.map(([key]) => [key, input[key].trim()]));
}
function reviewNote(decision, note, evidence) {
  return evidence ? `具体问题：${evidence.problem}\n判断依据：${evidence.basis}\n修改要求：${evidence.revision_request}` : (typeof note === 'string' ? note.trim() : null);
}
function platformVersionNo(draft) {
  if (!Number.isSafeInteger(Number(draft.id)) || Number(draft.id) <= 0 || !Number.isSafeInteger(Number(draft.revision_no)) || Number(draft.revision_no) <= 0) throw httpError(409, '平台流程版本来源无效', { code: 'FORMAL_PLATFORM_VERSION_INVALID' });
  return `PV${draft.id}-R${draft.revision_no}`;
}
function publicationMeaning(version) {
  return { platform_status: version?.status || 'unknown', institution_edition: null, enterprise_approval_status: 'unknown',
    enterprise_effective_status: 'unknown', legacy_edition: version?.edition || null,
    legacy_effective_at: version?.effective_at || null, note: '平台发布仅固定流程治理版本；企业制度版次、批准及生效须按企业权限另行确认。历史字段原值保留，不据此推定企业签批。' };
}
module.exports = { reviewEvidence, reviewNote, platformVersionNo, publicationMeaning };
