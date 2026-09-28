import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';

const selection = () => new URLSearchParams(location.search).get('identityField') || '';
const show = value => value === null || value === undefined || value === '' ? '未记录' : String(value);
const labels = { needs_review: '待核实', confirmed: '已确认', high: '高', medium: '中', low: '低' };
const fingerprint = value => JSON.stringify(Object.keys(value).sort().map(key => [key, value[key]]));

// The legacy identity API has no atomic revision/receipt contract. A preflight read
// detects already changed records, but cannot close the read-to-write race.
export function FieldIdentity({ api, user, context, fields, pending, readAt, draft, setDraft, onQueryChange }) {
  const [selectedId, setSelectedId] = useState(selection), [revision, setRevision] = useState(0);
  const [state, setState] = useState({}), [feedback, setFeedback] = useState({}), [busy, setBusy] = useState(false);
  const alive = useRef(false), lock = useRef(false), firstInput = useRef(null);
  const fieldId = draft && String(context?.id) === draft.contextId ? draft.fieldId : selectedId;
  const field = !pending && fields?.find(row => String(row.id) === fieldId);
  const sameTarget = !draft || (draft.contextId === String(context?.id) && draft.fieldId === fieldId);
  const sameDepartment = context?.dept_id && Number(context.dept_id) === Number(user.departmentId);
  const canMaintain = Boolean(sameDepartment && user.permissions?.includes('governance:draft-department'));
  const canConfirm = Boolean(sameDepartment && user.permissions?.includes('governance:review-department'));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const update = () => setSelectedId(selection()); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (!field) { setState({}); return () => controller.abort(); }
    setState({ busy: true });
    api.request('/api/field-identities/field/' + encodeURIComponent(fieldId), { signal: controller.signal })
      .then(data => {
        if (data.field_id !== undefined && String(data.field_id) !== fieldId) throw new Error('返回的字段身份与当前字段不一致，请重试。');
        if (!controller.signal.aborted) setState({ data, fieldId, contextId: String(context.id) });
      }).catch(error => { if (!controller.signal.aborted) setState({ error }); });
    return () => controller.abort();
  }, [api, fieldId, context?.id, Boolean(field), pending, readAt, revision]);
  useEffect(() => { if (draft && sameTarget) firstInput.current?.focus(); }, [draft?.action, draft?.fieldId, sameTarget]);
  const ready = Boolean(field && state.data && state.fieldId === fieldId && state.contextId === String(context?.id) && !pending && !state.busy && !state.error);
  const identity = ready ? state.data : null;
  // The existing normalizer would infer a person ID from this legacy user ID.
  // Do not expose a save action that silently changes an unresolved identity link.
  const ownershipUnresolved = Boolean(identity?.owner_user_id && !identity?.owner_person_id);
  function choose(value) {
    if (lock.current || (draft && !window.confirm('切换字段会放弃当前字段身份办理输入，是否继续？'))) return;
    setDraft(null); setFeedback({});
    const url = new URL(location.href);
    if (value) url.searchParams.set('identityField', value); else url.searchParams.delete('identityField');
    onQueryChange(url, true); setSelectedId(value);
  }
  function start(action) {
    if (!ready || draft || lock.current || (action === 'maintain' && ownershipUnresolved)) return;
    setFeedback({});
    setDraft({ dirty: true, action, fieldId, contextId: String(context.id), fieldName: field.field_name_cn || field.field_name_en || `字段 #${fieldId}`, base: identity,
      values: { authoritative_system: identity.authoritative_system_name || identity.authoritative_system || '', authoritative_system_code: identity.authoritative_system_code || '', confidence_level: identity.confidence_level || '', note: identity.note || '' } });
  }
  function cancel() {
    if (!lock.current && window.confirm('放弃当前字段身份办理输入？若上次结果不明，请先刷新并核对记录。')) { setDraft(null); setFeedback({}); }
  }
  async function submit(event) {
    event.preventDefault();
    if (lock.current || !draft || draft.uncertain || draft.stale || !ready || !sameTarget || (draft.action === 'maintain' && ownershipUnresolved) || !(draft.action === 'maintain' ? canMaintain : canConfirm)) return;
    if (!draft.values.authoritative_system.trim()) { setFeedback({ error: '请填写权威系统名称，不能只填写空格。' }); firstInput.current?.focus(); return; }
    lock.current = true; setBusy(true); setFeedback({}); let sent = false;
    try {
      const latest = await api.request('/api/field-identities/field/' + encodeURIComponent(draft.fieldId));
      if (!alive.current) return;
      if (fingerprint(latest) !== fingerprint(draft.base)) {
        setDraft({ ...draft, stale: true });
        throw new Error('原记录已变化。输入已保留，请刷新核对，放弃本次输入后重新办理。');
      }
      // Persist uncertainty before awaiting any write, including session expiry/unmount.
      setDraft({ ...draft, uncertain: true }); sent = true;
      const maintain = draft.action === 'maintain';
      const body = maintain ? { ...draft.values,
        maintain_dept_id: draft.base.maintain_dept_id ?? null, owner_user_id: draft.base.owner_user_id ?? null,
        owner_person_id: draft.base.owner_person_id ?? null, confirmed: false, status: 'needs_review'
      } : { authoritative_system: draft.values.authoritative_system, authoritative_system_code: draft.values.authoritative_system_code };
      await api.request('/api/field-identities/' + encodeURIComponent(draft.fieldId) + (maintain ? '' : '/confirm'), { method: maintain ? 'PUT' : 'POST', body });
      if (!alive.current) return;
      setDraft(null); setState({ busy: true }); setRevision(value => value + 1);
      setFeedback({ success: maintain ? '黄金源信息已保存为待核实，请由有权限的部门审核人员确认。' : '已完成原字段身份的部门确认。此状态不代表新模板主数据或权威来源认定。' });
    } catch (error) {
      if (alive.current) setFeedback({ error: `${error.message}${sent ? ' 提交结果需要核对，输入仍保留，请勿直接重试写入。' : ''}` });
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="card" aria-labelledby="field-identity-heading" data-field-identity-state={pending || state.busy ? 'loading' : state.error ? 'error' : ready ? 'ready' : 'empty'}>
    <div className="section-heading"><h2 id="field-identity-heading">字段身份与黄金源</h2><button className="secondary" disabled={busy || !field || pending} onClick={() => { setState({ busy: true }); setRevision(value => value + 1); }}>刷新字段身份</button></div>
    <p>选择当前上下文中的字段，核对原黄金源信息及确认记录。保存信息与部门确认分别办理；原确认状态不代表新模板对象或权威来源已经认定。</p>
    <label className="identity-field">字段身份目标<select aria-label="字段身份目标" disabled={busy || pending} value={field ? fieldId : ''} onChange={event => choose(event.target.value)}>
      <option value="">请选择字段</option>{(pending ? [] : fields || []).map(row => <option key={row.id} value={row.id}>{row.field_name_cn || row.field_name_en || '未命名字段'}（#{row.id}）</option>)}
    </select></label>
    {pending ? <StatusPanel kind="loading" title="请等待上下文读取完成…" /> : !field ? <p role="status">请选择可见字段；指定字段不存在或不属于当前可见上下文时，不读取其身份。</p> : state.busy ? <StatusPanel kind="loading" title="正在读取字段身份…" /> : state.error ? <StatusPanel kind="error" title="字段身份暂不可用">{state.error.message} 请刷新重试；失败不表示没有身份记录。</StatusPanel> : identity && <div data-field-identity-detail>
      <h3>{field.field_name_cn || field.field_name_en || '未命名字段'}（#{fieldId}）</h3>
      {!identity.id ? <p>该字段尚无身份记录。具有本部门编制权限的人员可填写黄金源信息，不按当前人员或部门补造维护责任。</p> : <dl style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
        {[
          ['身份记录编号', identity.id], ['权威系统名称', identity.authoritative_system_name || identity.authoritative_system], ['权威系统代码', identity.authoritative_system_code],
          ['维护部门编号', identity.maintain_dept_id], ['负责人（person）编号', identity.owner_person_id], ['历史负责人（user）编号', identity.owner_user_id],
          ['置信度', labels[identity.confidence_level] || identity.confidence_level], ['确认状态', identity.confirmed ? '已确认' : '未确认'], ['原记录状态', labels[identity.status] || identity.status],
          ['原确认人员编号', identity.confirmed_by_person_id ?? identity.confirmed_by], ['原确认时间', identity.confirmed_at], ['备注', identity.note]
        ].map(([name, value]) => <React.Fragment key={name}><dt>{name}</dt><dd>{show(value)}</dd></React.Fragment>)}
      </dl>}
      <p className="muted">人员、部门编号按原记录展示，不按名称推断。未确认记录中的原确认人和时间可能来自上次确认，不表示本次已通过；本页未提供完整审核历史。</p>
      {ownershipUnresolved && <p role="status">此记录有历史 user 编号但缺少 person 编号。原保存接口会自动沿用该编号，本页暂停维护以避免猜测人员映射；须先明确兼容处理。原记录仍可查阅。</p>}
      {!draft && <div className="actions">
        {canMaintain && !ownershipUnresolved && <button onClick={() => start('maintain')}>维护黄金源信息</button>}
        {canConfirm && identity.id && !identity.confirmed && <button onClick={() => start('confirm')}>办理部门确认</button>}
        {!canMaintain && !canConfirm && <p>当前身份仅可查阅本记录。</p>}
      </div>}
    </div>}
    {draft && <form onSubmit={submit} data-field-identity-form>
      <h3>{draft.action === 'maintain' ? '维护黄金源信息' : '核对并确认黄金源'}：{draft.fieldName}（#{draft.fieldId}）</h3>
      {!sameTarget && <p role="status">输入仍绑定上下文 #{draft.contextId}，请切回原上下文后办理，或明确放弃输入。</p>}
      <fieldset disabled={busy || !sameTarget || !ready} style={{ border: 0, padding: 0, minWidth: 0 }}>
        {[['authoritative_system', '权威系统名称', 255], ['authoritative_system_code', '权威系统代码', 100], ['note', '黄金源备注', 10000]].filter(([name]) => draft.action === 'maintain' || name !== 'note').map(([name, label, maxLength], index) => <label className="identity-field" key={name}>{label}<input ref={index === 0 ? firstInput : undefined} aria-label={label} required={name === 'authoritative_system'} maxLength={maxLength} readOnly={draft.action === 'confirm'} value={draft.values[name]} onChange={event => setDraft({ ...draft, values: { ...draft.values, [name]: event.target.value } })} /></label>)}
        {draft.action === 'maintain' && <label className="identity-field">置信度<select aria-label="置信度" required value={draft.values.confidence_level} onChange={event => setDraft({ ...draft, values: { ...draft.values, confidence_level: event.target.value } })}><option value="">请选择，不代填事实</option>{!['', 'high', 'medium', 'low'].includes(draft.values.confidence_level) && <option value={draft.values.confidence_level}>{draft.values.confidence_level}（原值）</option>}{['high', 'medium', 'low'].map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>}
        <p className="input-notice">输入仅保留在当前页面。{draft.action === 'maintain' ? '保存后按原接口置为待核实、未确认；已有维护责任编号原样保留。' : '确认使用上方已保存的系统名称和代码，不修改维护内容。'}</p>
        {(draft.uncertain || draft.stale) && <p role="alert">{draft.uncertain ? '上次提交结果需要核对。' : '原记录已变化。'} 请刷新身份记录，与保留的输入逐项核对，再放弃本次输入并重新办理。不会自动重放请求。</p>}
        <button type="submit" disabled={draft.uncertain || draft.stale || !(draft.action === 'maintain' ? canMaintain : canConfirm)}>{busy ? '正在提交…' : draft.action === 'maintain' ? '保存黄金源信息（待核实）' : '确认已保存的黄金源'}</button>
      </fieldset>
      <button type="button" className="secondary" disabled={busy} onClick={cancel}>放弃本次字段身份输入</button>
    </form>}
    {feedback.error && <p role="alert" data-field-identity-error>{feedback.error}</p>}
    {feedback.success && <p role="status" data-field-identity-success>{feedback.success}</p>}
  </section>;
}
