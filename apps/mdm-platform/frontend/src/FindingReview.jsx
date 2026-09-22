import { IssueClosure } from './IssueClosure.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { IssueTasks } from './IssueTasks.jsx';
const labels = { pending_verification: '待核实', confirmed: '已确认发现，尚未关联问题', not_an_issue: '已说明不是问题', linked: '已关联治理问题' };
const issueStatuses = { waiting_my_action: '待办理', waiting_others: '等待其他人员办理', waiting_department_review: '待部门复核', waiting_studio_review: '待工作组复核', waiting_mdm_decision: '待有权主体决定', completed: '已完成', closed: '已关闭', data_preparing: '资料准备中', data_failed: '资料处理失败', not_in_scope: '不在当前范围', no_permission: '无办理权限' };
export function FindingReview({ api, run, finding, draft, setDraft, onNavigate }) {
  const url = `/api/analysis/runs/${run}/findings/${finding.finding_id}/review`;
  const [review, setReview] = useState(null), [targets, setTargets] = useState([]), [issue, setIssue] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false), [tick, setTick] = useState(0);
  const active = useRef(null), operation = useRef(false);
  const latestDraft = useRef(draft); latestDraft.current = draft;
  const d = draft?.review?.finding === finding.finding_id ? draft.review : { finding: finding.finding_id, action: 'confirm', reason: '', owner: '', ownerBasis: '', issueId: '', title: '', evidence: [], requestId: crypto.randomUUID(), baseDirty: !!draft?.dirty };
  useEffect(() => {
    const c = new AbortController(); active.current?.abort(); active.current = c; setReview(null); setIssue(null); setError(null); setBusy(true);
    (async () => {
      const r = await api.request(url, { signal: c.signal }), options = []; let after = null;
      if (r.can_confirm) do { const page = await api.request('/api/analysis/issue-targets' + (after ? '?after=' + after : ''), { signal: c.signal }); options.push(...page.items); after = page.next; } while (after);
      const linked = r.state.issue_id ? await api.request('/api/analysis/issues/' + r.state.issue_id, { signal: c.signal }) : null;
      if (!c.signal.aborted) { setReview(r); setTargets(options); setIssue(linked); }
    })().catch(e => { if (!c.signal.aborted) setError(e); }).finally(() => { if (!c.signal.aborted) setBusy(false); });
    return () => c.abort();
  }, [api, url, tick]);
  function edit(key, value) {
    if (key === 'issueId') setIssue(null);
    setDraft({ ...draft, dirty: true, review: { ...d, [key]: value, requestId: crypto.randomUUID() } });
  }
  async function action(fn) {
    if (busy || operation.current) return; operation.current = true; setBusy(true); setError(null);
    const c = new AbortController(); active.current?.abort(); active.current = c;
    try { await fn(c.signal); } catch (e) { if (!c.signal.aborted) setError(e); }
    finally { operation.current = false; if (!c.signal.aborted) setBusy(false); }
  }
  async function submit(e) {
    e.preventDefault();
    if (d.action === 'link' && (!issue || issue.issue.issue_id !== d.issueId)) { setError(new Error('请先读取并核对要关联的已有问题。')); return; }
    const body = { request_id: d.requestId, expected_revision: review.state.revision_no, action: d.action, reason: d.reason,
      owner_department_id: d.owner || null, owner_basis: d.ownerBasis, evidence_ids: d.evidence,
      ...(d.action === 'create' ? { title: d.title } : d.action === 'link' ? { issue_id: d.issueId, expected_issue_revision: issue.revision_no, expected_issue_digest: issue.issue_digest } : {}) };
    await action(async signal => {
      await api.request(url, { method: 'POST', body, signal });
      if (!signal.aborted) {
        const latest = latestDraft.current;
        if (latest?.review?.requestId === d.requestId) setDraft({ ...latest, review: null, dirty: d.baseDirty });
        setTick(t => t + 1);
      }
    });
  }
  const final = review?.state.issue_id || review?.state.decision === 'not_an_issue';
  return <section className="card" aria-label="发现人工确认"><h3>人工确认与问题关联</h3>
    <p>确认仅针对当前发现。说明不是问题不影响其他发现，也不会关闭已有问题；未知归口继续待核实。</p>
    {error && <StatusPanel kind="error" title="确认未完成，输入已保留">{error.message} {error.code}<button type="button" className="secondary" disabled={busy||!!draft?.pdf} onClick={() => setTick(t => t + 1)}>重新读取确认状态</button></StatusPanel>}
    {!review && !error && <p>正在读取确认记录…</p>}
    {review && <><p data-testid="finding-review-state">{labels[review.state.decision]} · 确认修订 {review.state.revision_no}</p>
      {review.events.map(e => <p key={e.review_id}>{labels[e.decision]}：{e.reason} · 确认人 {e.actor_person_id} · {e.created_at}</p>)}
      {issue && <section aria-label="关联问题"><h4>问题 {issue.issue.issue_id}：{issue.issue.title}</h4><p>{issue.issue.what_text}</p><p>归口：{issue.issue.primary_dept_name}；办理状态：{issueStatuses[issue.issue.display_status] || '待核对'}</p>
        <p>待办办结不能代替问题复核；指定、复核和重开由各自有权人员提交。</p>{issue.links.map(l => <p key={l.finding_id}><button type="button" className="secondary" onClick={() => onNavigate(l.run_id, l.finding_id)}>追溯运行 {l.run_id} / 发现 {l.finding_id}</button></p>)}<IssueTasks api={api} issueId={issue.issue.issue_id} draft={draft} setDraft={setDraft}/><IssueClosure onStatus={status=>setIssue(current=>({...current,issue:{...current.issue,display_status:status}}))} api={api} issueId={issue.issue.issue_id} draft={draft} setDraft={setDraft}/></section>}
      {review.can_confirm && !final ? <form onSubmit={submit}><fieldset disabled={busy||!!draft?.pdf}><legend>核对证据后明确提交</legend>
        <label className="management-input">确认动作<select aria-label="确认动作" value={d.action} onChange={e => edit('action', e.target.value)}><option value="confirm">确认发现，暂不关联问题</option><option value="not_an_issue">说明不是问题</option><option value="create">确认并创建治理问题</option><option value="link">确认并关联已有问题</option></select></label>
        <label className="management-input">明确归口部门<select aria-label="明确归口部门" value={d.owner} onChange={e => edit('owner', e.target.value)} required><option value="">尚未明确，请先核实</option>{targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="management-input">归口依据<textarea aria-label="归口依据" value={d.ownerBasis} maxLength={4096} required onChange={e => edit('ownerBasis', e.target.value)} /></label>
        <label className="management-input">确认理由<textarea aria-label="确认理由" value={d.reason} maxLength={4096} required onChange={e => edit('reason', e.target.value)} /></label>
        <p>明确选择本次核对依据，声明位置但未解析的证据不能用于确认。</p>{finding.evidence_ids.map((eid, i) => <label key={eid} className="finding-review-evidence"><input type="checkbox" aria-label={`确认依据 ${i + 1}`} checked={d.evidence.includes(eid)} onChange={e => edit('evidence', e.target.checked ? [...d.evidence, eid] : d.evidence.filter(v => v !== eid))} />证据 {i + 1}</label>)}
        {d.action === 'create' && <label className="management-input">问题标题<input aria-label="问题标题" required maxLength={255} value={d.title} onChange={e => edit('title', e.target.value)} /></label>}
        {d.action === 'link' && <><label className="management-input">已有问题编号<input aria-label="已有问题编号" required pattern="[1-9][0-9]*" value={d.issueId} onChange={e => edit('issueId', e.target.value)} /></label><button type="button" className="secondary" onClick={() => action(async signal => { const value = await api.request('/api/analysis/issues/' + encodeURIComponent(d.issueId), { signal }); if (!signal.aborted) setIssue(value); })}>读取已有问题</button></>}
        <button type="submit">提交人工确认</button>
      </fieldset></form> : !review.can_confirm && <p>当前身份仅可查阅，不能提交人工确认。</p>}
    </>}
  </section>;
}
