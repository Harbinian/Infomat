import React,{useEffect,useRef,useState} from 'react';
import {StatusPanel,useInputProtection} from './components.jsx';
const root='/api/data-map-facts';
const statusName=s=>({draft:'草稿',requested:'待答复',answered:'已答复',needs_more_info:'待补证据',checked:'已核对'}[s]||s);
const actionName=s=>({create:'保存问题草稿',edit:'修改问题草稿',send:'发出定向问题',answer:'提交事实答复',more_info:'要求补充证据',rebind:'修订后重新发起核对',check:'完成事实核对'}[s]||s);
const display=v=>v===null||v===undefined?'待确认':typeof v==='object'?JSON.stringify(v):String(v);
export function FactChecks({api,draft,setDraft}){
  const guard=useInputProtection(),generation=useRef(0),active=useRef(null),first=useRef(null);
  const [cap,setCap]=useState(null),[items,setItems]=useState([]),[next,setNext]=useState(null),[detail,setDetail]=useState(null),[subject,setSubject]=useState(null),[parent,setParent]=useState(null),[departments,setDepartments]=useState([]),[people,setPeople]=useState([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState('');
  const matching=draft&&cap&&draft.owner===cap.person_id&&draft.department===cap.department_id;
  const allowedDraft=matching&&(draft.action==='create'?cap.can_manage&&subject:detail&&detail.fact_id===draft.factId&&(draft.action==='answer'?detail.can_answer:detail.can_manage));
  function cancel(){generation.current++;active.current?.abort();setBusy(false);}
  useEffect(()=>()=>{generation.current++;active.current?.abort();},[]);
  async function run(fn){cancel();const n=generation.current,c=new AbortController();active.current=c;setBusy(true);setError(null);const valid=()=>n===generation.current&&!c.signal.aborted;try{await fn(c.signal,valid);}catch(e){if(valid()&&e.name!=='AbortError')setError(e);}finally{if(valid())setBusy(false);}}
  async function list(signal,valid,after=null){const r=await api.request(root+(after?'?after='+after:''),{signal});if(valid()){setItems(old=>after?[...old,...r.items]:r.items);setNext(r.next);}}
  async function read(id,signal,valid){const r=await api.request(root+'/'+id,{signal});if(valid())setDetail(r);return r;}
  async function directory(signal,valid,dept=null){let after=null,all=[];do{const r=await api.request(root+'/targets?'+(dept?'department_id='+dept+'&':'')+(after?'after='+after:''),{signal});all.push(...r.items);after=r.next;}while(after&&valid());if(valid())(dept?setPeople:setDepartments)(all);}
  function initialize(){run(async(signal,valid)=>{
    setDetail(null);setSubject(null);setParent(null);
    const c=await api.request(root+'/capabilities',{signal});if(!valid())return;setCap(c);await list(signal,valid);
    const params=new URLSearchParams(location.search),same=draft?.owner===c.person_id&&draft?.department===c.department_id;
    const fid=same?draft.factId:params.get('fact');const vid=same&&draft.action==='create'?draft.subject.version_id:params.get('version');
    if(fid)await read(fid,signal,valid);
    if(c.can_manage){await directory(signal,valid);if(same&&draft.values.target_department_id)await directory(signal,valid,draft.values.target_department_id);}
    if(vid&&c.can_manage){const v=await api.request('/api/data-map-definitions/version/'+vid,{signal});const oid=v.entity_type==='object'?v.entity_id:v.base_snapshot.row.object_id;const p=(await api.request('/api/data-map-definitions/detail/object/'+oid,{signal})).current;if(valid()){setSubject(v);setParent(p);}}
  });}
  useEffect(initialize,[]);
  useEffect(()=>{if(allowedDraft)first.current?.focus();},[Boolean(allowedDraft),draft?.action]);
  function leave(){if(!guard.confirmLeave())return false;cancel();setDraft(null);setNotice('');return true;}
  function choose(id){if(!leave())return;setDetail(null);setSubject(null);run(async(signal,valid)=>{await read(id,signal,valid);if(valid())history.replaceState(history.state,'','/app/fact-checks?fact='+id);});}
  function begin(action){if(!leave())return;
    const values=action==='create'?{question:'',focus:'business_meaning',target_department_id:'',target_person_id:''}:action==='edit'?{question:detail.data.question,target_department_id:detail.target_department_id||'',target_person_id:detail.target_person_id||''}:action==='answer'?{answer:'',evidence:'',needs_more_info:false,missing_reason:''}:{reason:'',evidence:''};
    setDraft({owner:cap.person_id,department:cap.department_id,action,values,dirty:true,requestId:crypto.randomUUID(),factId:action==='create'?null:detail.fact_id,revision:detail?.revision_no,subject,parent,latest:detail?.latest});
    if(action==='edit'&&detail.target_department_id)run((s,v)=>directory(s,v,detail.target_department_id));
  }
  function update(key,value){setDraft(d=>({...d,dirty:true,requestId:crypto.randomUUID(),values:{...d.values,[key]:value,...(key==='target_department_id'?{target_person_id:''}:{})}}));if(key==='target_department_id'){setPeople([]);if(value)run((s,v)=>directory(s,v,value));}}
  async function submit(e){e.preventDefault();if(!allowedDraft||busy)return;
    const d=draft,v=d.values;let payload={request_id:d.requestId,...(d.factId?{expected_revision:d.revision}:{})};
    if(['create','edit'].includes(d.action))payload={...payload,question:v.question,target_department_id:v.target_department_id||null,target_person_id:v.target_person_id||null,...(d.action==='create'?{subject_version_id:d.subject.version_id,object_version_id:d.parent.version_id,focus:[v.focus]}:{})};
    if(d.action==='answer')payload={...payload,answer:v.answer,evidence_refs:v.evidence.split('\n').map(s=>s.trim()).filter(Boolean),needs_more_info:v.needs_more_info,missing_reason:v.missing_reason};
    if(['more_info','check','rebind'].includes(d.action))payload={...payload,reason:v.reason,...(d.action==='check'?{evidence_refs:v.evidence.split('\n').map(s=>s.trim()).filter(Boolean)}:{}),...(d.action==='rebind'?{subject_version_id:d.latest.subject_version_id,object_version_id:d.latest.object_version_id}:{})};
    run(async(signal,valid)=>{
      const r=await api.request(root+(d.factId?'/'+d.factId+'/'+d.action:''),{method:'POST',body:payload,signal});
      if(!valid())return;setDraft(null);setNotice(actionName(d.action)+'已保存。');setSubject(null);history.replaceState(history.state,'','/app/fact-checks?fact='+r.fact_id);
      await read(r.fact_id,signal,valid);await list(signal,valid);
    });
  }
  function refreshDetail(){run(async(s,v)=>{if(detail)await read(detail.fact_id,s,v);await list(s,v);});}
  function link(e){if(!guard.confirmLeave())e.preventDefault();}
  const field=(name,label,multiline=true)=> <label className="management-input">{label}<textarea aria-label={label} ref={['question','answer','reason'].includes(name)?first:undefined} rows={multiline?3:1} maxLength={name==='evidence'?65536:4096} disabled={busy} value={draft.values[name]||''} onChange={e=>update(name,e.target.value)}/></label>;
  return <>
    <section className="card"><h2>定向事实核对</h2><p>只答复问题涉及的事实和证据。MDM 工作组核对答复与当前台账；“已核对”表示此项事实核对完成。</p><p className="muted">正式认定：待确认。新对象、字段的认定主体及审批依据尚未明确。</p></section>
    {busy&&<StatusPanel kind="loading" title="正在处理事实核对…"/>}
    {error&&<StatusPanel kind="error" title="办理未完成" onRetry={initialize}>{error.message} {error.status===409?'请先查看最新记录；现有输入及提交时修订号保持不变。':''}</StatusPanel>}
    {notice&&<StatusPanel kind="success" title={notice}/>}
    {draft&&!allowedDraft&&cap&&<StatusPanel title="先前输入已保留，当前身份或事项范围无法继续展示">请恢复原身份与范围后重试，或明确放弃这些输入。<button className="secondary" onClick={()=>{if(leave())initialize();}}>放弃先前输入</button></StatusPanel>}
    <div className="management-layout">
      <section className="card management-list"><h2>办理清单</h2><button className="secondary" disabled={busy} onClick={refreshDetail}>查看最新记录</button>{items.length?<ul className="field-list">{items.map(r=><li key={r.fact_id}><button className="text-button fact-choice" onClick={()=>choose(r.fact_id)}>核对 {r.fact_id} · {statusName(r.status)} · {r.question}</button></li>)}</ul>:<p>当前没有可查看的定向问题。MDM 可从对象或字段详情发起。</p>}{next&&<button className="secondary" disabled={busy} onClick={()=>run((s,v)=>list(s,v,next))}>载入更多问题</button>}</section>
      <section className="management-main">
        {subject&&cap?.can_manage&&!allowedDraft&&<section className="card"><h2>发起事实问题：{subject.definition.name}</h2><p>对象：{parent?.definition.name}。选择一项需要核对的内容，明确目标部门后再发出。</p><button className="primary" onClick={()=>begin('create')}>起草定向问题</button></section>}
        {detail&&<section className="card fact-detail"><h2>核对 {detail.fact_id}：{detail.data.question}</h2><p>状态：{statusName(detail.status)} · 办理修订 {detail.revision_no} · 目标部门 {detail.target_department_name||'待明确'}{detail.target_person_id?' · 指定人员 '+(detail.target_person_name||detail.target_person_id):''}</p>
          <p>对象：{detail.data.binding.context.object_name} · {detail.data.binding.context.subject_type==='field'?'字段：':''}{detail.data.binding.context.subject_name}</p>
          <dl className="source-values">{Object.entries(detail.data.binding.context.values).map(([p,value])=><div key={p}><dt>{cap?.schema[detail.data.binding.context.subject_type].find(s=>s.path===p)?.label||p}</dt><dd>{display(value)}</dd></div>)}</dl>
          <details><summary>固定版本与来源定位</summary><p>对象版本 {detail.object_version_id} · 主体版本 {detail.subject_version_id}</p><ul>{detail.data.binding.source_refs.map((ref,i)=><li key={i}>版本 {ref.version_id} · {ref.pointer} · 内容摘要 {ref.content_digest}</li>)}</ul></details>
          {detail.stale&&<StatusPanel kind="error" title="相关内容已变化，原意见需重新核对">旧答复和核对历史继续保留。MDM 查看修订后明确重新发起；业务人员须针对新内容再次答复。</StatusPanel>}
          {detail.inactive&&<p>对象或字段已停用，当前问题仅供查阅。</p>}
          {detail.data.answer&&<section><h3>事实答复</h3><p>{detail.data.answer.text}</p><ul>{detail.data.answer.evidence_refs.map((r,i)=><li key={i}>{r}</li>)}</ul>{detail.data.answer.needs_more_info&&<p>证据待补：{detail.data.answer.missing_reason}</p>}</section>}
          {detail.data.review&&<p>核对意见：{detail.data.review.reason}</p>}
          <div className="import-actions">
            {(detail.can_manage||detail.can_edit_source)&&<a className="secondary button-link" href={'/app/objects?object='+detail.data.binding.context.object_id+(detail.data.binding.context.subject_type==='field'?'&field='+detail.data.binding.context.subject_id:'')+'&returnFact='+detail.fact_id} onClick={link}>{detail.can_edit_source?'定位台账并修订':'定位台账'}</a>}
            {!allowedDraft&&!detail.inactive&&<>
              {detail.can_manage&&detail.status==='draft'&&!detail.stale&&<><button className="secondary" onClick={()=>begin('edit')}>修改问题草稿</button><button className="primary" onClick={()=>begin('send')}>发出定向问题</button></>}
              {detail.can_answer&&['requested','needs_more_info'].includes(detail.status)&&!detail.stale&&<button className="primary" onClick={()=>begin('answer')}>答复具体事实</button>}
              {detail.can_manage&&detail.status==='answered'&&!detail.stale&&<><button className="secondary" onClick={()=>begin('more_info')}>要求补充证据</button><button className="primary" onClick={()=>begin('check')}>核对事实答复</button></>}
              {detail.can_manage&&detail.stale&&<button className="primary" onClick={()=>begin('rebind')}>查看修订并重新核对</button>}
            </>}
          </div>
          <details className="definition-group"><summary>全程办理记录</summary>{detail.history.map(e=><section className="fact-history" key={e.event_id}><h3>修订 {e.revision_no} · {actionName(e.action)}</h3><p>人员 {e.actor_name||e.actor_person_id}（ID {e.actor_person_id}） · {e.created_at} · 主体版本 {e.snapshot.subject_version_id}</p><p>{e.snapshot.data.question}</p>{e.snapshot.data.answer&&<p>答复：{e.snapshot.data.answer.text} · 证据：{e.snapshot.data.answer.evidence_refs.join('；')||e.snapshot.data.answer.missing_reason}</p>}{e.snapshot.data.review&&<p>核对理由：{e.snapshot.data.review.reason} · 依据：{e.snapshot.data.review.evidence_refs?.join('；')}</p>}{e.snapshot.data.rebind_reason&&<p>重新核对理由：{e.snapshot.data.rebind_reason}</p>}</section>)}{detail.history_next&&<button className="secondary" disabled={busy} onClick={()=>run(async(s,v)=>{const r=await api.request(root+'/'+detail.fact_id+'?before='+detail.history_next,{signal:s});if(v())setDetail(old=>({...old,history:[...old.history,...r.history],history_next:r.history_next}));})}>载入更早记录</button>}</details>
        </section>}
        {allowedDraft&&<form className="card fact-form" onSubmit={submit}>
          <h2>{actionName(draft.action)}</h2><p className="input-notice">有未提交输入。保存草稿与发出问题是两个独立动作。</p>
          {['create','edit'].includes(draft.action)&&<>{field('question','具体事实问题')}
            {draft.action==='create'&&<label className="management-input">需要核对的内容<select aria-label="需要核对的内容" value={draft.values.focus} disabled={busy} onChange={e=>update('focus',e.target.value)}>{cap.schema[draft.subject.entity_type].map(s=><option key={s.path} value={s.path}>{s.label}</option>)}</select></label>}
            <label className="management-input">目标部门<select aria-label="目标部门" value={draft.values.target_department_id} disabled={busy} onChange={e=>update('target_department_id',e.target.value)}><option value="">待明确（仅可保存草稿）</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label className="management-input">指定答复人员<select aria-label="指定答复人员" value={draft.values.target_person_id} disabled={busy||!draft.values.target_department_id} onChange={e=>update('target_person_id',e.target.value)}><option value="">由目标部门具备权限的人员答复</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </>}
          {draft.action==='send'&&<p>将问题放入明确目标的办理清单，不发送外部通知。发出后须保留原问题，相关内容改变时重新核对。</p>}
          {draft.action==='answer'&&<>{field('answer','事实答复')}{field('evidence','证据定位（每行一条）')}<label><input type="checkbox" checked={draft.values.needs_more_info} disabled={busy} onChange={e=>update('needs_more_info',e.target.checked)}/>证据尚不完整</label>{draft.values.needs_more_info&&field('missing_reason','缺少的证据及原因')}</>}
          {['more_info','check','rebind'].includes(draft.action)&&field('reason',draft.action==='rebind'?'重新核对理由':'核对理由')}
          {draft.action==='check'&&<>{field('evidence','核对依据（每行一条）')}<p>仅完成当前范围的事实核对；正式认定仍待确认。</p></>}
          {draft.action==='rebind'&&<><p>将明确绑定主体版本 {draft.latest.subject_version_id}、对象版本 {draft.latest.object_version_id}。原答复留在历史，新一轮须重新答复。</p><dl className="source-values">{Object.entries(draft.latest.binding.context.values).map(([p,v])=><div key={p}><dt>{cap.schema[detail.data.binding.context.subject_type].find(s=>s.path===p)?.label||p}</dt><dd>{display(detail.data.binding.context.values[p])} → {display(v)}</dd></div>)}</dl></>}
          <div className="import-actions"><button className="primary" disabled={busy} type="submit">{draft.action==='create'?'保存问题草稿':draft.action==='send'?'确认发出问题':draft.action==='rebind'?'确认重新发起':actionName(draft.action)}</button><button className="secondary" type="button" onClick={()=>leave()}>取消本次办理</button></div>
        </form>}
      </section>
    </div>
  </>;
}
