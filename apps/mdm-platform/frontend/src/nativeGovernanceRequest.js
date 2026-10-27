// Native work-package writes retain one immutable payload until its receipt is known.
const root = '/api/process-data-governance';
const tracked = new Set(['generate', 'decide', 'ask', 'answer', 'close', 'complete']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const tracksNativeRequest = kind => tracked.has(kind);
export const requestUnresolved = draft => Boolean(draft?.request && draft.request.phase !== 'rejected');
export const canRetryNativeRequest = draft => ['retryable', 'not_observed'].includes(draft?.request?.phase);
export const nativeDraftForOwner = (draft, owner) => draft?.owner === owner || requestUnresolved(draft) ? draft : null;
export const nativeDraftBlocked = (draft, owner) => requestUnresolved(draft) && draft.owner !== owner;

export function nativeWrite(input, requestId) {
  let path, method = 'POST', body = {expected_revision: input.expected_revision};
  const pkg = encodeURIComponent(String(input.packageId)), fact = encodeURIComponent(String(input.factId));
  if (input.kind === 'create') { path = '/creation-tasks/reconcile'; body = {process_version_id: String(input.versionId)}; }
  if (input.kind === 'generate') path = `/work-packages/${pkg}/generate-candidates`;
  if (input.kind === 'decide') {
    path = `/work-packages/${pkg}/details/${encodeURIComponent(String(input.detailId))}`; method = 'PATCH';
    body = {...body, status: input.status, responsible_department_id: input.department ? String(input.department) : null,
      governance: {conclusion: input.conclusion.trim(), unified_object_id: input.unified.trim() || null, basis: input.basis.trim()}};
  }
  if (input.kind === 'ask') {
    path = `/work-packages/${pkg}/fact-requests`;
    body = {...body, detail_id: String(input.detailId), target_department_id: String(input.target), requested_fact_type: input.factType,
      question_text: input.question.trim(), request_reason: input.reason.trim()};
  }
  if (input.kind === 'answer') { path = `/fact-requests/${fact}/respond`; body = {...body, answer_text: input.answer.trim(), evidence_ref: input.evidence.trim()}; }
  if (input.kind === 'close') { path = `/fact-requests/${fact}/close`; body.basis = input.basis.trim(); }
  if (input.kind === 'complete') { path = `/work-packages/${pkg}/complete`; body.basis = input.basis.trim(); }
  if (!path) throw new Error('当前操作没有可提交的办理入口。');
  if (tracksNativeRequest(input.kind)) {
    if (!uuidPattern.test(requestId || '')) throw new Error('无法生成请求标识，请保留输入并重试。');
    body.request_id = requestId;
  }
  return {url: root + path, method, body};
}

export function beginNativeRequest(draft, newId = () => globalThis.crypto.randomUUID()) {
  if (requestUnresolved(draft)) {
    if (!canRetryNativeRequest(draft)) throw new Error('请先查询原请求回执，核对本次操作结果。');
    return {...draft, request: {...draft.request, phase: 'awaiting_receipt'}};
  }
  const requestId = newId(), write = nativeWrite(draft, requestId);
  return {...draft, request: {...write, request_id: requestId, phase: 'awaiting_receipt'}, dirty: true};
}

export function editNativeDraft(draft, key, value) {
  if (requestUnresolved(draft)) return draft;
  return {...draft, [key]: value, request: null, dirty: true};
}

export function observeNativeReceipt(draft, receipt) {
  if (!draft?.request || receipt?.request_id !== draft.request.request_id) throw new Error('回执标识不一致，请保留原请求并联系维护人员核对。');
  let phase = receipt.state;
  if (phase === 'prepared') {
    if (receipt.observation !== 'retryable') throw new Error('原请求尚不能安全重试，请继续核对回执。');
    phase = 'retryable';
  }
  if (!['retryable', 'not_observed', 'in_progress', 'committed', 'rejected'].includes(phase)) throw new Error('无法识别原请求回执，请保留输入并核对。');
  if (phase === 'committed' && receipt.result?.request_id !== draft.request.request_id) throw new Error('成功回执缺少原请求标识，请继续核对。');
  return {...draft, request: {...draft.request, phase, result: receipt.result || null}, dirty: true};
}

export function nativeSuccessText(result) {
  return result?.business_outcome === 'native_review_bound_pending_generation'
    ? '工作包审核已保存，承接草案待生成；数据地图尚未发布。'
    : '本次操作已保存。数据地图的批准和发布须另行办理。';
}
