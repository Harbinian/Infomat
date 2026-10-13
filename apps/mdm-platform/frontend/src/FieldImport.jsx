import React, { useEffect, useRef, useState } from 'react';

export function FieldImport({ api, user, selected, pending, lastReadAt, draft, setDraft, busy, setBusy, isCurrentAttempt, onImported }) {
  const [feedback, setFeedback] = useState({});
  const active = useRef(false);
  const picker = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; setBusy(false); }; }, [setBusy]);
  const canDraft = Boolean(user.departmentId && user.permissions?.includes('governance:draft-department'));
  const sameOwner = !draft?.owner || draft.owner === `${user.personId}:${user.departmentId}`;
  const canImport = Boolean(selected && String(selected.dept_id) === String(user.departmentId) && canDraft);
  const sameTarget = !draft?.file || String(selected?.id) === draft.contextId;
  const mustCheck = Boolean(draft?.attemptedAt);
  const checkedAfterAttempt = sameTarget && !pending && lastReadAt > draft?.attemptedAt;
  const enabled = canImport && !pending && sameTarget && sameOwner && !busy;

  function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !enabled || draft?.uncertain) return;
    if (!/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024 || !file.size) {
      setFeedback({ error: '请选择非空的 .xlsx 文件，且文件大小不超过 5MB。原有文件选择仍保留。' }); return;
    }
    if (draft?.file && !window.confirm('替换当前字段台账文件？尚未导入的文件选择将被替换。')) return;
    setDraft({ owner:draft?.owner, file, contextId: String(selected.id), contextTitle: selected.title || selected.context_key, requestId:crypto.randomUUID(), checked: false, dirty: true });
    setFeedback({});
  }
  function clear() {
    if (busy || !window.confirm('放弃当前文件选择？已经写入的字段不会撤销，请先核对目标台账。')) return;
    setDraft(null); setFeedback({});
  }
  async function submit(event, reconcile = false) {
    event.preventDefault();
    if (!enabled || !draft?.file || active.current || (reconcile ? !draft.uncertain : draft.uncertain || (mustCheck && !draft.checked))) return;
    active.current = true; setBusy(true); setFeedback({});
    const attempt = { ...draft, requestId:draft.requestId || crypto.randomUUID(), attemptId: crypto.randomUUID(), attemptedAt: Date.now(), checked: false, uncertain:true };
    // Keep uncertainty across 401/unmount: a lost response does not prove that no rows were written.
    setDraft(attempt);
    const body = new FormData(); body.append('context_id', attempt.contextId); body.append('file', attempt.file);
    body.append('request_id', attempt.requestId);
    try {
      const result = await api.request('/api/import/field-entries', { method: 'POST', body });
      if (!mounted.current || !isCurrentAttempt(attempt.attemptId)) return;
      if (!Number.isSafeInteger(result?.imported) || result.imported < 0 || String(result.context_id) !== attempt.contextId || result.receipt?.request_id !== attempt.requestId) throw new Error('导入回执与原请求不一致，请保留文件并核对。');
      setDraft(null); setFeedback({ success: `已导入 ${result.imported} 行，目标为“${attempt.contextTitle}” (#${attempt.contextId})。批次 #${result.receipt.batch_id}，请求 ${attempt.requestId}。${result.receipt.replayed ? '这是原请求回执，未重复写入；历史删除或后续维护不会重建字段。' : ''}请在关联字段台账核对。` });
      onImported(attempt.contextId);
    } catch (error) {
      if (!mounted.current || !isCurrentAttempt(attempt.attemptId)) return;
      const uncertain = reconcile || !error.status || error.status >= 500 || error.status === 401;
      setDraft({ ...attempt, uncertain });
      const detail = error.status === 400 ? 'Excel 未通过解析或字段校验。请检查“数据对象”“字段说明”表头、字段重名和字段名禁用规则。' : error.message;
      setFeedback({ error: `${detail} 文件、原请求和身份仍保留。${uncertain ? '提交结果不明，已冻结文件和普通提交。请先核对批次，需要时明确按原请求核对。' : '本次没有提交字段或批次，原台账保持。请核对错误后修正文件。'}` });
    } finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  if (!sameOwner) return <section className="card" aria-labelledby="field-import-heading">
    <h2 id="field-import-heading">导入字段台账</h2>
    <p role="alert">原导入请求仍绑定身份 {draft.owner}。当前身份无法查看或提交原文件，也不会重绑定原请求。请用原人员和部门登录后核对。</p>
    <button type="button" disabled={busy} onClick={clear}>放弃字段文件选择</button>
  </section>;
  return <section className="card" aria-labelledby="field-import-heading">
    <h2 id="field-import-heading">导入字段台账</h2>
    <p>先选择本部门的来源上下文，再下载模板填写。支持 .xlsx，最大 5MB；首行须包含“数据对象”和“字段说明”。字段名须符合现有禁用词和质量规则。</p>
    <p className="muted">字段、关联记录和批次日志整批提交，校验或写入失败会整批回滚。导入不代表主数据、权威来源或流程审核已经确认。</p>
    <a href="/template.xlsx" download="字段台账模板.xlsx">下载字段台账模板</a>
    <p data-field-import-target style={{ overflowWrap: 'anywhere' }}>导入目标：{draft?.file ? `${draft.contextTitle} (#${draft.contextId})` : selected ? `${selected.title || selected.context_key} (#${selected.id})` : '请先选择上下文'}</p>
    {!pending && !canImport && <p role="status">当前上下文没有本部门编制权限，不能导入字段。</p>}
    {!sameTarget && <p role="status">文件仍绑定原上下文。请切回导入目标后办理，或明确放弃此文件选择。</p>}
    {(canDraft || draft?.file) && <form onSubmit={submit}>
      <div className="identity-field"><span>字段台账 Excel</span>
        <input ref={picker} hidden aria-label="字段台账 Excel" type="file" accept=".xlsx" disabled={!enabled || draft?.uncertain} onChange={chooseFile} />
        <button type="button" className="secondary" disabled={!enabled || draft?.uncertain} onClick={() => picker.current?.click()}>选择字段台账文件</button>
      </div>
      {draft?.file && <p data-field-import-file style={{ overflowWrap: 'anywhere' }}>已选择：{draft.file.name}（{Math.ceil(draft.file.size / 1024)} KB）。文件仅保留在当前页面内存中。</p>}
      {mustCheck && <div className="input-notice">
        <p style={{overflowWrap:'anywhere'}}>原请求：{draft.requestId}。{draft.uncertain ? '结果不明。按原请求核对会调用原上传接口：已提交则返回原批次；未提交则可能导入。不会自动重试或更换编号。' : '请刷新核对目标台账和错误信息后再办理。'}</p>
        {!draft.uncertain && <label><input type="checkbox" checked={Boolean(draft.checked)} disabled={busy || !checkedAfterAttempt || !sameOwner} onChange={event => setDraft({ ...draft, checked: event.target.checked })} />我已核对目标台账和错误信息</label>}
      </div>}
      <div className="actions">
        <button type="submit" disabled={!enabled || !draft?.file || draft?.uncertain || (mustCheck && !draft.checked)}>{busy ? '正在导入…' : '导入字段台账'}</button>
        {draft?.uncertain && <button type="button" disabled={!enabled} onClick={event=>{if(window.confirm('按原请求、原文件和原上下文调用上传接口核对？此前已提交会返回原批次，此前未提交则可能导入；不会重建已删除字段。')) submit(event,true);}}>按原导入请求核对结果</button>}
        {draft?.file && <button type="button" className="secondary" disabled={busy} onClick={clear}>放弃字段文件选择</button>}
      </div>
    </form>}
    {feedback.error && <p role="alert" data-field-import-error>{feedback.error}</p>}
    {feedback.success && <p role="status">{feedback.success}</p>}
  </section>;
}
