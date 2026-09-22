import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
const purposes = { verify:'核实',correct:'整改',coordinate:'协调',review:'复核' };
export function IssueTasks({ api, issueId, draft, setDraft }) {
  const [data,setData] = useState(null), [error,setError] = useState(null), [busy,setBusy] = useState(false);
  const active = useRef(null), latest = useRef(draft); latest.current = draft;
  useEffect(() => () => active.current?.abort(), [issueId]);
  const d = draft?.task?.issueId === issueId ? draft.task : { issueId, office:'', purpose:'verify', round:1, instruction:'', requestId:crypto.randomUUID(), baseDirty:!!draft?.dirty, revision:data?.revision_no, digest:data?.issue_digest };
  function edit(key,value) { setDraft({ ...draft,dirty:true,task:{ ...d,[key]:value,requestId:crypto.randomUUID() } }); }
  async function execute(fn) {
    if (busy) return; active.current?.abort(); const c = new AbortController(); active.current = c; setBusy(true); setError(null);
    try { await fn(c.signal); } catch(e) { if (!c.signal.aborted) setError(e); } finally { if (!c.signal.aborted) setBusy(false); }
  }
  const url = '/api/analysis/issues/' + issueId + '/tasks';
  const load = () => execute(async signal => { const value = await api.request(url,{signal}); if (!signal.aborted) setData(value); });
  async function submit(e) {
    e.preventDefault(); await execute(async signal => {
      await api.request(url,{method:'POST',signal,body:{request_id:d.requestId,expected_revision:d.revision,expected_issue_digest:d.digest,office_id:d.office,purpose:d.purpose,round_no:Number(d.round),instruction:d.instruction}});
      if (signal.aborted) return;
      if (latest.current?.task?.requestId === d.requestId) setDraft({ ...latest.current,task:null,dirty:d.baseDirty });
      const value = await api.request(url,{signal}); if (!signal.aborted) setData(value);
    });
  }
  return <section aria-label="问题办公室办理"><h4>办公室办理</h4>
    <button type="button" className="secondary" disabled={busy||!!draft?.pdf} onClick={load}>查看办理与交办</button>
    {error && <StatusPanel kind="error" title="办理操作未完成，输入已保留">{error.message} {error.code}</StatusPanel>}
    {data && <><p>自动派单未启用。任务办结后，问题仍等待有权复核；请在问题复核区核对指定人员、条件和最新决定。</p>
      {!data.items.length && <p>未分派。请由有权人员明确选择已登记办公室。</p>}
      {data.items.map(t => <article key={t.todo_id}><p>任务 {t.todo_id} · {purposes[t.purpose]} · 第 {t.round_no} 轮 · {t.office_name} · {t.status === 'done' ? '办理动作已办结（不自动关闭问题）' : t.assignee_person_id ? '待成员办理' : '待负责人分配'}</p>
        {t.completion && <p>{t.completion.note}</p>}<a href={`/#/officeWorkbench?office_id=${t.office_id}`} onClick={e => { if (draft?.dirty && !window.confirm('尚有未提交输入，确定放弃并前往办公室工作台？')) e.preventDefault(); }}>前往办公室任务 {t.todo_id}</a>
      </article>)}
      {data.can_dispatch && <form onSubmit={submit}><fieldset disabled={busy || !!draft?.pdf || !!draft?.closure}><legend>明确交办一个办理动作</legend>
        <label className="management-input">承接办公室<select aria-label="承接办公室" required value={d.office} onChange={e=>edit('office',e.target.value)}><option value="">未分派，请明确选择</option>{data.offices.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="management-input">办理用途<select aria-label="办理用途" value={d.purpose} onChange={e=>edit('purpose',e.target.value)}>{Object.entries(purposes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        <label className="management-input">办理轮次<input aria-label="办理轮次" type="number" min="1" max="10000" required value={d.round} onChange={e=>edit('round',e.target.value)}/></label>
        <p>同一用途同一轮只交办一次；前轮办结后才能开始下一轮，历史结果保留。复核用途的任务不授予问题关闭权。</p>
        <label className="management-input">必要办理说明<textarea aria-label="必要办理说明" required maxLength={4000} value={d.instruction} onChange={e=>edit('instruction',e.target.value)}/></label>
        <p>仅填写本次办公室办理所需内容；此说明会向办公室负责人和被分配成员开放，不自动附带分析原文。</p>
        {d.revision !== data.revision_no && <p role="alert">问题修订已变化。核对办理记录后，<button type="button" className="secondary" onClick={()=>setDraft({...draft,dirty:true,task:{...d,revision:data.revision_no,digest:data.issue_digest,requestId:crypto.randomUUID()}})}>采用当前修订继续编辑</button></p>}
        <button type="submit" disabled={d.revision !== data.revision_no}>确认交办</button>
      </fieldset></form>}
    </>}
  </section>;
}
