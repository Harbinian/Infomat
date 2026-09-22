import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
const actions={designate:'指定复核人员并确认条件',reject:'复核不通过',close:'复核通过并关闭',reopen:'重新打开',suspend:'原指定已暂停'};
export function IssueClosure({api,issueId,draft,setDraft,onStatus}) {
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null);
  const active=useRef(null), latest=useRef(draft);latest.current=draft;
  useEffect(()=>()=>active.current?.abort(),[issueId]);
  const d=draft?.closure?.issueId===issueId?draft.closure:{issueId,reviewer:'',conditions:'',reason:'',evidence:'',checks:{},requestId:crypto.randomUUID(),baseDirty:!!draft?.dirty,
    revision:data?.revision_no,digest:data?.issue_digest,context:data?.context_digest};
  const url='/api/analysis/issues/'+issueId;
  const edit=(key,value)=>setDraft({...draft,dirty:true,closure:{...d,[key]:value,requestId:crypto.randomUUID()}});
  async function execute(fn) {
    if(busy)return;active.current?.abort();const c=new AbortController();active.current=c;setBusy(true);setError(null);
    try {await fn(c.signal);}catch(e){if(!c.signal.aborted)setError(e);}finally{if(!c.signal.aborted)setBusy(false);}
  }
  const load=()=>execute(async signal=>{const next=await api.request(url+'/closure',{signal});if(!signal.aborted){setData(next);onStatus(next.status);}});
  async function submit(action) {await execute(async signal=>{
    const body={request_id:d.requestId,action,expected_revision:d.revision,expected_issue_digest:d.digest,expected_context_digest:d.context,reason:d.reason};
    if(action==='review')body.checks=data.assignment.conditions.map(c=>({condition_id:c.condition_id,...(d.checks[c.condition_id]||{satisfied:false,basis:''})}));
    else {body.reviewer_person_id=d.reviewer;body.conditions=d.conditions.split('\n').map(s=>s.trim()).filter(Boolean);if(action==='reopen')body.reopen_evidence=d.evidence;}
    await api.request(url+'/review',{method:'POST',body,signal});if(signal.aborted)return;
    if(latest.current?.closure?.requestId===d.requestId)setDraft({...latest.current,closure:null,dirty:d.baseDirty});
    const next=await api.request(url+'/closure',{signal});if(!signal.aborted){setData(next);onStatus(next.status);}
  });}
  const stale=data&&(d.revision!==data.revision_no||d.context!==data.context_digest);
  return <section className="card" aria-label="问题复核与关闭"><h4>问题复核与关闭</h4>
    <button type="button" className="secondary" disabled={busy||!!draft?.pdf} onClick={load}>查看复核与关闭</button>
    {error&&<StatusPanel kind="error" title="复核操作未完成，输入已保留">{error.message} {error.code}</StatusPanel>}
    {data&&<><p data-testid="closure-status">{data.status==='closed'?'问题已关闭':'问题未关闭'}；{data.suspended?'原复核指定已暂停，须负责人重新指定':data.assignment?'已指定复核人员 '+data.assignment.reviewer.person_id:'待归口部门最终负责人本人指定复核人员和关闭条件'}。</p>
      <p>待办办结不自动关闭问题。来源、办理结果和关闭条件须重新核对；复核用途的待办不授予关闭权。</p>
      {data.source_heads.filter(s=>s.original_ref!==s.current_ref).map(s=><details key={s.kind+s.original_ref}><summary>来源版本变化：{s.kind} {s.original_ref} → {s.current_ref}，须重新核对</summary><pre className="analysis-json">{JSON.stringify(s.changed_document,null,2)}</pre></details>)}
      {data.assignment&&<ol>{data.assignment.conditions.map(c=><li key={c.condition_id}>{c.text}</li>)}</ol>}
      <details><summary>查看指定、复核和重新打开历史</summary>{data.events.map(e=><p key={e.event_id}>{actions[e.action]} · 人员 {e.actor_person_id} · {e.created_at} · {e.reason}</p>)}</details>
      {(data.can_designate||data.can_reopen||data.can_review)&&<fieldset disabled={busy||!!draft?.pdf||!!draft?.task||!!draft?.review}><legend>核对当前依据后明确提交</legend>
        {(data.can_designate||data.can_reopen)&&<>
          <label className="management-input">复核人员<select aria-label="复核人员" value={d.reviewer} onChange={e=>edit('reviewer',e.target.value)}><option value="">请选择已具备来源权限且未参与办理的人员</option>{data.candidates.map(c=><option key={c.person_id} value={c.person_id}>{c.person_name}（{c.person_id}）</option>)}</select></label>
          {!data.candidates.length&&<p>暂无符合条件的候选人员，保持待指定。</p>}
          <label className="management-input">关闭条件（每行一项）<textarea aria-label="关闭条件" maxLength={16000} value={d.conditions} onChange={e=>edit('conditions',e.target.value)}/></label>
          {data.can_reopen&&<label className="management-input">新增证据或原关闭依据失效的说明<textarea aria-label="重开证据" maxLength={4000} value={d.evidence} onChange={e=>edit('evidence',e.target.value)}/></label>}
        </>}
        <label className="management-input">本次决定依据及补充要求<textarea aria-label="复核决定依据" maxLength={4000} value={d.reason} onChange={e=>edit('reason',e.target.value)}/></label>
        {data.can_review&&data.assignment.conditions.map((c,i)=>{
          const value=d.checks[c.condition_id]||{satisfied:false,basis:''};
          const change=(patch)=>edit('checks',{...d.checks,[c.condition_id]:{...value,...patch}});
          return <fieldset key={c.condition_id}><legend>条件 {i+1}：{c.text}</legend>
            <label className="finding-review-evidence"><input type="checkbox" aria-label={`条件 ${i+1} 已满足`} checked={value.satisfied} onChange={e=>change({satisfied:e.target.checked})}/>已逐项核对并满足</label>
            <label className="management-input">核对依据或未满足说明<textarea aria-label={`条件 ${i+1} 依据`} maxLength={4000} value={value.basis} onChange={e=>change({basis:e.target.value})}/></label>
            {value.satisfied&&<><label className="management-input">办理证据<select aria-label={`条件 ${i+1} 办理证据`} value={value.todo_id||''} onChange={e=>{const t=data.tasks.find(t=>t.todo_id===e.target.value);change({todo_id:t?.todo_id||'',task_revision:t?.revision_no,excerpt:t?.completion?.note?.note||''});}}><option value="">明确选择已办结结果</option>{data.tasks.filter(t=>t.status==='done'&&t.completion).map(t=><option key={t.todo_id} value={t.todo_id}>任务 {t.todo_id} · 修订 {t.revision_no}</option>)}</select></label>
              <p>固定办理结果摘录：{value.excerpt||'尚未选择证据'}</p></>}
          </fieldset>;
        })}
        {stale&&<p role="alert">修订、来源或办理依据已变化，请先核对当前记录。<button type="button" className="secondary" onClick={()=>setDraft({...draft,dirty:true,closure:{...d,revision:data.revision_no,digest:data.issue_digest,context:data.context_digest,requestId:crypto.randomUUID()}})}>核对后采用当前复核修订</button></p>}
        {data.can_designate&&<button type="button" disabled={stale||!d.reviewer||!d.conditions.trim()||!d.reason.trim()} onClick={()=>submit('designate')}>确认指定与关闭条件</button>}
        {data.can_reopen&&<button type="button" disabled={stale||!d.reviewer||!d.conditions.trim()||!d.reason.trim()||!d.evidence.trim()} onClick={()=>submit('reopen')}>确认重新打开</button>}
        {data.can_review&&<button type="button" disabled={stale||!d.reason.trim()} onClick={()=>submit('review')}>提交逐项复核</button>}
      </fieldset>}
    </>}
  </section>;
}
