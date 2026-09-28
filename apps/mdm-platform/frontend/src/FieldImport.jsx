import React, { useEffect, useRef, useState } from 'react';

export function FieldImport({ api, user, selected, pending, lastReadAt, draft, setDraft, busy, setBusy, isCurrentAttempt, onImported }) {
  const [feedback, setFeedback] = useState({});
  const active = useRef(false);
  const picker = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; setBusy(false); }; }, [setBusy]);
  const canDraft = Boolean(user.departmentId && user.permissions?.includes('governance:draft-department'));
  const canImport = Boolean(selected && String(selected.dept_id) === String(user.departmentId) && canDraft);
  const sameTarget = !draft?.file || String(selected?.id) === draft.contextId;
  const mustCheck = Boolean(draft?.attemptedAt);
  const checkedAfterAttempt = sameTarget && !pending && lastReadAt > draft?.attemptedAt;
  const enabled = canImport && !pending && sameTarget && !busy;

  function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !enabled) return;
    if (!/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024 || !file.size) {
      setFeedback({ error: '请选择非空的 .xlsx 文件，且文件大小不超过 5MB。原有文件选择仍保留。' }); return;
    }
    if (draft?.file && !window.confirm('替换当前字段台账文件？尚未导入的文件选择将被替换。')) return;
    setDraft({ ...draft, file, contextId: String(selected.id), contextTitle: selected.title || selected.context_key, checked: false, dirty: true });
    setFeedback({});
  }
  function clear() {
    if (busy || !window.confirm('放弃当前文件选择？已经写入的字段不会撤销，请先核对目标台账。')) return;
    setDraft(null); setFeedback({});
  }
  async function submit(event) {
    event.preventDefault();
    if (!enabled || !draft?.file || active.current || (mustCheck && !draft.checked)) return;
    active.current = true; setBusy(true); setFeedback({});
    const attempt = { ...draft, attemptId: crypto.randomUUID(), attemptedAt: Date.now(), checked: false };
    // Keep uncertainty across 401/unmount: a lost response does not prove that no rows were written.
    setDraft(attempt);
    const body = new FormData(); body.append('context_id', attempt.contextId); body.append('file', attempt.file);
    try {
      const result = await api.request('/api/import/field-entries', { method: 'POST', body });
      if (!mounted.current || !isCurrentAttempt(attempt.attemptId)) return;
      setDraft(null); setFeedback({ success: `已导入 ${result.imported} 行，目标为“${attempt.contextTitle}” (#${attempt.contextId})。请在关联字段台账核对。` });
      onImported(attempt.contextId);
    } catch (error) {
      if (!mounted.current || !isCurrentAttempt(attempt.attemptId)) return;
      const detail = error.status === 400 ? 'Excel 未通过解析或字段校验。请检查“数据对象”“字段说明”表头、字段重名和字段名禁用规则。' : error.message;
      setFeedback({ error: `${detail} 文件仍保留。可能已有部分行写入，请先刷新并核对目标台账，移除已导入的行后再提交。` });
    } finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="card" aria-labelledby="field-import-heading">
    <h2 id="field-import-heading">导入字段台账</h2>
    <p>先选择本部门的来源上下文，再下载模板填写。支持 .xlsx，最大 5MB；首行须包含“数据对象”和“字段说明”。字段名须符合现有禁用词和质量规则。</p>
    <p className="muted">导入会逐行写入字段，失败可能保留部分结果。导入不代表主数据、权威来源或流程审核已经确认。</p>
    <a href="/template.xlsx" download="字段台账模板.xlsx">下载字段台账模板</a>
    <p data-field-import-target style={{ overflowWrap: 'anywhere' }}>导入目标：{draft?.file ? `${draft.contextTitle} (#${draft.contextId})` : selected ? `${selected.title || selected.context_key} (#${selected.id})` : '请先选择上下文'}</p>
    {!pending && !canImport && <p role="status">当前上下文没有本部门编制权限，不能导入字段。</p>}
    {!sameTarget && <p role="status">文件仍绑定原上下文。请切回导入目标后办理，或明确放弃此文件选择。</p>}
    {(canDraft || draft?.file) && <form onSubmit={submit}>
      <div className="identity-field"><span>字段台账 Excel</span>
        <input ref={picker} hidden aria-label="字段台账 Excel" type="file" accept=".xlsx" disabled={!enabled} onChange={chooseFile} />
        <button type="button" className="secondary" disabled={!enabled} onClick={() => picker.current?.click()}>选择字段台账文件</button>
      </div>
      {draft?.file && <p data-field-import-file style={{ overflowWrap: 'anywhere' }}>已选择：{draft.file.name}（{Math.ceil(draft.file.size / 1024)} KB）。文件仅保留在当前页面内存中。</p>}
      {mustCheck && <div className="input-notice">
        <p>上次提交结果需要核对。请刷新数据地图并查看目标台账，再修正文件；不要原样重复提交。</p>
        <label><input type="checkbox" checked={Boolean(draft.checked)} disabled={busy || !checkedAfterAttempt} onChange={event => setDraft({ ...draft, checked: event.target.checked })} />我已核对目标台账，并已从文件中移除已导入的行</label>
      </div>}
      <div className="actions">
        <button type="submit" disabled={!enabled || !draft?.file || (mustCheck && !draft.checked)}>{busy ? '正在导入…' : '导入字段台账'}</button>
        {draft?.file && <button type="button" className="secondary" disabled={busy} onClick={clear}>放弃字段文件选择</button>}
      </div>
    </form>}
    {feedback.error && <p role="alert" data-field-import-error>{feedback.error}</p>}
    {feedback.success && <p role="status">{feedback.success}</p>}
  </section>;
}
