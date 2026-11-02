// The server save baseline is independent of the editor's downloaded-file baseline.
export const AUTHORING_ROOT = '/api/process-authoring';
const clone = value => structuredClone(value);
// A successful empty read does not establish compilation rights for every case.
export function authoringEntryPresentation({ feature, list, listState = 'loading', workspace = null }) {
  const available = feature?.enabled === true && feature.schema_ready === true;
  const ready = available && listState === 'ready' && Array.isArray(list?.items);
  const createKnown = ready && Array.isArray(list.allowed_actions);
  const canCreate = createKnown && list.allowed_actions.includes('create_draft');
  const currentEditable = Boolean(workspace && (!workspace.record || workspace.allowedActions?.includes('save')));
  const canUpload = available && currentEditable && !workspace.attempt;
  const result = { canCreate, canUpload, showSelector: ready && list.items.length > 0, kind: 'unavailable' };
  if (!available) return result;
  if (listState === 'loading') return { ...result, kind: 'loading', title: '正在读取可见草稿与新建资格…', description: '读取完成后，分别显示可查阅的草稿和当前可用操作。' };
  if (!ready) return { ...result, kind: 'error', title: '草稿列表尚未读取成功', description: '不能据此判断没有草稿或没有编制资格。请点击“刷新草稿列表”重新核对；下方已打开的内容及未保存输入保持。' };
  if (workspace) return { ...result, kind: 'opened' };
  if (list.items.length) return { ...result, kind: 'choose', title: '选择要查阅或继续编制的草稿', description: '打开后在下方查看正文及本次提交材料；是否可修改或提交，以所选草稿实际提供的操作为准。' };
  if (canCreate) return { ...result, kind: 'empty-create', title: '当前没有可见的已保存草稿', description: '你可以点击“新建编制草稿”。编制器打开后才能填写正文或上传已有编制文件；完成后点击“保存草稿”，下次从本页列表重新打开。保存不代表已提交核对。' };
  if (!createKnown) return { ...result, kind: 'empty-unknown', title: '当前没有可见的已保存草稿', description: '本次尚未取得新建资格信息，请刷新核对，不能从空列表判断本人是否有权编制。已有流程可回原案例查看当前编制分工。' };
  return { ...result, kind: 'empty-no-create', title: '当前没有可见的已保存草稿', description: '当前账号没有新建草稿入口。新流程由归口部门当前有效的主对接人新建；已有流程由原案例已明确的编制人员或当前有资格的主对接人续修。空列表不表示所有流程都没有本人编制资格。请到“流程预览与核对”选择原流程，核对编制分工后从该案例继续编制。' };
}
export function createAuthoringViewGuard({ getOwner, getView }) {
  let alive = true, sequence = 0, busySequence = null, lockedSequence = null;
  return {
    begin({ lock = false } = {}) {
      const stamp = { sequence: ++sequence, owner: getOwner(), view: getView() };
      busySequence = stamp.sequence;
      if(lock)lockedSequence = stamp.sequence;
      return stamp;
    },
    current(stamp) { return alive && stamp?.sequence === sequence && stamp.owner === getOwner() && stamp.view === getView(); },
    finish(stamp) {
      if(lockedSequence === stamp?.sequence)lockedSequence = null;
      if(busySequence !== stamp?.sequence)return false;
      busySequence = null; return true;
    },
    invalidate() { alive = false; sequence += 1; },
    get alive() { return alive; },
    get locked() { return lockedSequence !== null; }
  };
}
export function fingerprint(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
  return JSON.stringify(canonical(value));
}
export function authoringDirty(workspace, snapshot = workspace?.controller?.getSnapshot()) {
  return Boolean(workspace && (workspace.attempt || authoringContentDirty(workspace, snapshot) || fingerprint(workspace.submission) !== workspace.savedSubmission));
}
export function authoringContentDirty(workspace, snapshot = workspace?.controller?.getSnapshot()) {
  return Boolean(workspace && (snapshot?.pending || snapshot?.document && (!workspace.record || fingerprint(snapshot.document) !== workspace.savedDocument)));
}
export function authoringMaterialsDirty(workspace) { return Boolean(workspace && fingerprint(workspace.submission) !== workspace.savedSubmission); }
export function authoringOwner(user) { return `${user.personId}:${user.departmentId}`; }
export function editorEndpoint(url) {
  if (typeof url !== 'string' || !/^\/api\/(template|enums|schema|validate)$/.test(url)) throw new Error('编制器只能调用3000的同源编制接口。');
  return `${AUTHORING_ROOT}/editor/${url.slice(5)}`;
}
export function createEditorFetch(api) {
  return async (url, options = {}) => {
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    const value = await api.request(editorEndpoint(url), { method: options.method || 'GET', body, signal: options.signal });
    return { ok: true, status: 200, json: async () => value };
  };
}
export function createAuthoringClient(api) {
  return {
    status: signal => api.request(`${AUTHORING_ROOT}/status`, { signal }),
    list: signal => api.request(`${AUTHORING_ROOT}/drafts`, { signal }),
    read: (id, signal) => api.request(`${AUTHORING_ROOT}/drafts/${encodeURIComponent(id)}`, { signal }),
    fromCase: (id, requestId, source) => api.request(`${AUTHORING_ROOT}/drafts/from-case/${encodeURIComponent(id)}`, { method: 'POST', body: { request_id: requestId, expected_revision_no: source.revision_no, expected_content_hash: source.content_hash } }),
    execute: attempt => api.request(attempt.url, { method: attempt.method, body: clone(attempt.body) })
  };
}
export function prepareAttempt(workspace, kind, requestId = crypto.randomUUID()) {
  if (workspace.attempt) throw new Error('原请求尚待核对，请先使用原请求标识重试。');
  const snapshot = workspace.controller.getSnapshot();
  if (snapshot.pending) throw new Error('当前有未应用输入，请在编辑器显式应用或放弃后，再保存或提交。');
  if (!snapshot.document || snapshot.busy) throw new Error('请等编制器准备完成后重试。');
  const document = clone(snapshot.document), submission = clone(workspace.submission), record = workspace.record;
  if (kind === 'submit' && (!record || authoringContentDirty(workspace, snapshot))) throw new Error('请先保存当前草稿正文，再提交核对。');
  const common = { request_id: requestId, ...(record ? { expected_revision_no: record.revision_no, expected_content_hash: record.content_hash } : {}) };
  return {
    kind, method: kind === 'submit' || !record ? 'POST' : 'PUT',
    url: `${AUTHORING_ROOT}/drafts${record ? '/' + encodeURIComponent(record.id) : ''}${kind === 'submit' ? '/submit' : ''}`,
    body: { ...common, ...(kind === 'submit' ? {} : { document }), submission }, document, submission
  };
}
export function acceptReceipt(workspace, attempt, receipt) {
  const saved = receipt?.draft;
  if (!saved?.id || !Number.isSafeInteger(saved.revision_no) || saved.revision_no < 1 || typeof saved.content_hash !== 'string' || !saved.content_hash || fingerprint(saved.document) !== fingerprint(attempt.document) || workspace.record && saved.id !== workspace.record.id) {
    throw new Error('保存回执与原请求内容不一致，当前输入和请求标识仍保留，请核对后重试。');
  }
  // Receipt acknowledgment must never replace newer visible edits or pending panel input.
  workspace.record = saved;
  workspace.allowedActions = receipt.allowed_actions || [];
  workspace.savedDocument = fingerprint(attempt.document);
  workspace.savedSubmission = fingerprint(attempt.submission);
  workspace.attempt = null;
  workspace.controller.acknowledgeSaved?.(attempt.document);
  return workspace;
}
export function definiteRejection(error) { return error.status >= 400 && error.status < 500; }
export function authoringError(error) {
  const labels = {
    PROCESS_AUTHORING_REVISION_CONFLICT: '草稿已被其他人修改，当前输入仍保留。请下载当前编制文件留存，再打开最新草稿核对差异。',
    PROCESS_AUTHORING_SOURCE_CONFLICT: '原案例已经出现新修订，当前输入仍保留。请核对最新案例后继续。',
    PROCESS_AUTHORING_DISABLED: '流程编制尚未开启，当前输入仍保留。',
    PROCESS_AUTHORING_SCHEMA_REQUIRED: '流程编制的存储结构尚未准备，当前输入仍保留。',
    PROCESS_AUTHORING_ADMIN_READ_ONLY: '系统管理员仅可查阅，不能保存或提交业务正文。',
    PROCESS_AUTHORING_SCOPE_DENIED: '当前身份不具备本草稿的编制或提交资格，当前输入仍保留。'
  };
  return labels[error.code] || error.serverMessage || error.message;
}
