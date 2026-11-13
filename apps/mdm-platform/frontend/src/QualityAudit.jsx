import React,{useEffect,useRef,useState} from 'react';
import {StatusPanel,useInputProtection} from './components.jsx';
import {businessText,userMessage} from './businessPresentation.js';
import {businessDateTime} from './businessGuidance.js';
import {beginQualityAuditRequest,editQualityAuditDraft,observeQualityAuditResult,qualityAuditAction,qualityAuditBaselineChanged,qualityAuditCanAct,qualityAuditCanRetry,qualityAuditDesignLabel,qualityAuditDesignOptions,qualityAuditEditable,qualityAuditFailure,qualityAuditHref,qualityAuditOwner,qualityAuditRequestPending,qualityAuditResultVisible,qualityAuditRoot,qualityAuditSameIdentity,qualityAuditSelection,qualityAuditState,rejectQualityAuditRequest} from './qualityAuditModel.js';

const blank=()=>({loading:true,data:null,error:null});
const same=(a,b)=>a==null&&b==null||a!=null&&b!=null&&String(a)===String(b);
const display=(value,fallback='未记录')=>value?businessText(value,fallback):fallback;
const time=value=>value?businessDateTime(value):'时间未记录';
function Design({value}){
  if(!value)return <p>未读取到本次采用的流程设计。</p>;
  return <div className="source-values"><p>流程设计：{qualityAuditDesignLabel(value)}</p><p>部门负责人确认：{display(value.approved_by_name,'原记录未留存确认人姓名')} · {time(value.approved_at)}</p></div>;
}
function FindingContent({finding,historical=false}){
  return <><dl className="source-values"><div><dt>审计对象</dt><dd>{display(finding.subject)}</dd></div><div><dt>质量问题</dt><dd style={{whiteSpace:'pre-wrap'}}>{display(finding.finding_text)}</dd></div><div><dt>审计依据</dt><dd style={{whiteSpace:'pre-wrap'}}>{display(finding.basis_text)}</dd></div><div><dt>整改要求</dt><dd style={{whiteSpace:'pre-wrap'}}>{display(finding.requirement_text)}</dd></div><div><dt>责任部门</dt><dd>{display(finding.department_snapshot?.name,'原记录未留存部门名称')}</dd></div><div><dt>登记人员</dt><dd>{display(finding.created_by?.person_name,'原记录未留存登记人姓名')} · {time(finding.created_at)}</dd></div></dl>
    <details open={!historical}><summary>{historical?'当时采用的已确认流程设计':'本次采用的已确认流程设计'}</summary><Design value={finding.design}/></details>
    {finding.design_revision_reason&&<p style={{whiteSpace:'pre-wrap'}}>更新设计依据的原因：{display(finding.design_revision_reason)}</p>}
    {finding.latest_rectification&&<section><h4>{historical?'当时整改记录':'本轮整改措施与证据'}</h4><p style={{whiteSpace:'pre-wrap'}}>整改措施：{display(finding.latest_rectification.action_text)}</p><p style={{whiteSpace:'pre-wrap'}}>整改证据：{display(finding.latest_rectification.evidence_text)}</p><p>提交人员：{display(finding.latest_rectification.submitted_by?.person_name,'原记录未留存提交人姓名')} · {time(finding.latest_rectification.submitted_at)}</p></section>}
    {finding.latest_review&&<section><h4>{historical?'当时复核记录':'最近一次审计复核'}</h4><p>复核结论：{finding.latest_review.decision==='accept'?'通过并关闭':finding.latest_review.decision==='return'?'退回继续整改':'结论待核对'}</p><p style={{whiteSpace:'pre-wrap'}}>复核依据：{display(finding.latest_review.basis_text)}</p><p>复核人员：{display(finding.latest_review.reviewed_by?.person_name,'原记录未留存复核人姓名')} · {time(finding.latest_review.reviewed_at)}</p></section>}
  </>;
}
function TextField({label,value,onChange,required=true,multiline=true}){
  return <label className="form-field" style={{display:'block',marginBottom:14}}>{label}{multiline?<textarea aria-label={label} rows={3} value={value||''} required={required} onChange={event=>onChange(event.target.value)} style={{width:'100%'}}/>:<input aria-label={label} value={value||''} required={required} onChange={event=>onChange(event.target.value)} style={{width:'100%'}}/>}</label>;
}

export function QualityAudit({api,user,draft,setDraft,onQueryChange}){
  const owner=qualityAuditOwner(user),ownDraft=draft?.owner===owner?draft:null,foreign=Boolean(draft&&!ownDraft);
  const [selected,setSelected]=useState(()=>qualityAuditSelection(location.search)||(draft?.owner===owner?draft.findingId:null)||null);
  const [view,setView]=useState('open'),[refreshToken,setRefreshToken]=useState(0),[listRevision,setListRevision]=useState(0);
  const [status,setStatus]=useState(blank),[options,setOptions]=useState(blank),[list,setList]=useState(blank),[detail,setDetail]=useState(blank);
  const [history,setHistory]=useState({items:[],truncated:false,next:null,busy:false,error:null});
  const [busy,setBusy]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState('');
  const mounted=useRef(false),ownerRef=useRef(owner),selectedRef=useRef(selected),draftRef=useRef(draft),detailGeneration=useRef(0),writeLock=useRef(false),formRef=useRef(null);
  ownerRef.current=owner;selectedRef.current=selected;draftRef.current=draft;
  const guard=useInputProtection(),guardKey=useRef(Symbol('quality-audit'));
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;detailGeneration.current++;};},[]);
  useEffect(()=>{guard?.update(guardKey.current,Boolean(draft?.dirty));return()=>guard?.update(guardKey.current,false);},[guard,draft]);
  useEffect(()=>{
    const controller=new AbortController();setStatus(blank());setOptions(blank());setList(blank());
    api.request(qualityAuditRoot+'/status',{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setStatus({data,loading:false,error:null});}).catch(failure=>{if(!controller.signal.aborted)setStatus({data:null,loading:false,error:failure});});
    return()=>controller.abort();
  },[api,owner,refreshToken]);
  useEffect(()=>{
    if(status.data?.enabled!==true||status.data.can_read!==true)return;
    const controller=new AbortController();setOptions(blank());
    api.request(qualityAuditRoot+'/options',{signal:controller.signal}).then(data=>{if(!Array.isArray(data?.departments)||!Array.isArray(data?.designs))throw new Error('审计办理选项未能完整读取，请重新核对。');if(!controller.signal.aborted)setOptions({data,loading:false,error:null});}).catch(failure=>{if(!controller.signal.aborted)setOptions({data:null,loading:false,error:failure});});
    return()=>controller.abort();
  },[api,owner,status.data]);
  useEffect(()=>{
    if(status.data?.enabled!==true||status.data.can_read!==true)return;
    const controller=new AbortController();setList(blank());
    api.request(qualityAuditRoot+'/findings?'+new URLSearchParams({view}),{signal:controller.signal}).then(data=>{if(!Array.isArray(data?.items))throw new Error('审计事项清单未能完整读取，请重新核对。');if(!controller.signal.aborted)setList({data,loading:false,error:null});}).catch(failure=>{if(!controller.signal.aborted)setList({data:null,loading:false,error:failure});});
    return()=>controller.abort();
  },[api,owner,view,status.data,listRevision]);
  async function readDetail(id,signal){
    const data=await api.request(qualityAuditRoot+'/findings/'+encodeURIComponent(id),{signal});
    if(!same(data?.finding?.finding_id,id)||!Array.isArray(data.events))throw new Error('读取到的审计事项与所选事项不一致，请保留输入并重新核对。');
    return data;
  }
  function applyDetail(data){setDetail({data,loading:false,error:null});setHistory({items:data.events||[],truncated:Boolean(data.history_truncated),next:data.history_next_before,busy:false,error:null});}
  useEffect(()=>{
    const current=++detailGeneration.current,controller=new AbortController();setDetail(blank());setHistory({items:[],truncated:false,next:null,busy:false,error:null});
    if(!selected||status.data?.enabled!==true||status.data.can_read!==true){setDetail({data:null,loading:false,error:null});return()=>controller.abort();}
    readDetail(selected,controller.signal).then(data=>{if(!controller.signal.aborted&&current===detailGeneration.current)applyDetail(data);}).catch(failure=>{if(!controller.signal.aborted&&current===detailGeneration.current)setDetail({data:null,loading:false,error:failure});});
    return()=>controller.abort();
  },[api,owner,selected,status.data,refreshToken]);
  useEffect(()=>{const pop=()=>{setSelected(qualityAuditSelection(location.search));setError(null);setNotice('');};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  const activeDraft=ownDraft&&same(selected,ownDraft.findingId||null)?ownDraft:null;
  useEffect(()=>{if(activeDraft)formRef.current?.focus();},[activeDraft?.action,activeDraft?.findingId]);
  function selection(id,{push=true}={}){setSelected(id||null);onQueryChange?.(id?qualityAuditHref(id):'/app/quality',push);}
  function choose(id){
    if(writeLock.current)return;
    if(draftRef.current?.dirty&&!same(id,draftRef.current.findingId||null)&&!window.confirm('本次审计输入和原请求会保留在当前页面内存中。是否暂时查看另一事项，稍后返回继续？'))return;
    selection(id);setError(null);setNotice('');
  }
  function begin(action){
    if(draftRef.current||writeLock.current||!qualityAuditCanAct(status.data,detail.data,action)||action!=='register'&&(detail.loading||detail.error))return;
    const finding=detail.data?.finding;
    const values=action==='register'?{title:'',subject:'',finding_text:'',basis_text:'',requirement_text:'',responsible_department_id:'',design_id:''}
      :action==='submit_rectification'?{action_text:'',evidence_text:''}:action==='review'?{decision:'',basis_text:''}
        :{design_id:'',finding_text:finding.finding_text,basis_text:finding.basis_text,requirement_text:finding.requirement_text,reason:''};
    const next={owner,action,findingId:action==='register'?null:finding.finding_id,expected_revision:action==='register'?null:finding.revision_no,values,dirty:true,request:null};
    setDraft(previous=>previous||next);if(action==='register')selection(null);setError(null);setNotice('');
  }
  function edit(key,value){setDraft(previous=>previous?.owner===owner?editQualityAuditDraft(previous,key,value):previous);setError(null);}
  function replaceAttempt(next){setDraft(previous=>previous?.owner===next.owner&&previous?.request?.request_id===next.request?.request_id?next:previous);}
  async function verifySaved(next){
    const id=next.request.result.finding_id,data=await readDetail(id);
    if(!qualityAuditResultVisible(data,next.request.result))throw new Error('已收到保存回执，但尚未读到对应保存结果。请保留原请求并查询结果。');
    replaceAttempt({...next,request:{...next.request,phase:'verified'}});
    if(mounted.current&&ownerRef.current===next.owner){selection(id,{push:false});applyDetail(data);setListRevision(value=>value+1);setNotice(qualityAuditAction(next.action)+'已保存，当前审计记录已核对。请查看本页结果及办理历史，再结束本次输入。');}
  }
  async function submit(event,retry=false){
    event?.preventDefault();const current=draftRef.current;
    if(!current||current.owner!==owner||writeLock.current||status.data?.enabled!==true||status.data.can_read!==true||status.data?.read_only===true)return;
    if(!retry&&(!qualityAuditCanAct(status.data,detail.data,current.action)||current.conflict||current.action!=='register'&&(detail.loading||!same(current.expected_revision,detail.data?.finding?.revision_no))))return;
    if(retry&&(!qualityAuditCanRetry(current)||!window.confirm('仅以原请求和原提交内容重试？若原操作已经保存，将核对原结果；不会另建新请求。')))return;
    let next;try{next=beginQualityAuditRequest(current);}catch(failure){setError(failure);return;}
    writeLock.current=true;setBusy(true);setError(null);setNotice('');setDraft(next);
    try{
      const result=await api.request(next.request.url,{method:'POST',body:next.request.body});
      next=observeQualityAuditResult(next,result);replaceAttempt(next);await verifySaved(next);
    }catch(failure){
      if(next.request.phase!=='committed')replaceAttempt({...rejectQualityAuditRequest(next,failure),conflict:failure.code==='QUALITY_AUDIT_REVISION_CONFLICT'});
      if(mounted.current&&ownerRef.current===next.owner)setError(failure);
    }finally{writeLock.current=false;if(mounted.current)setBusy(false);}
  }
  async function queryResult(){
    const current=draftRef.current;if(!current?.request||current.owner!==owner||writeLock.current)return;
    writeLock.current=true;setBusy(true);setError(null);let receiptFound=false;
    try{
      const receipt=await api.request(qualityAuditRoot+'/requests/'+encodeURIComponent(current.request.request_id));
      if(receipt?.found!==true)throw new Error('当前未取得可核对的保存回执，请保留原请求后重新查询。');
      receiptFound=true;const next=observeQualityAuditResult(current,receipt.result);replaceAttempt(next);await verifySaved(next);
    }catch(failure){
      if(failure.status===404&&!receiptFound){replaceAttempt({...current,request:{...current.request,phase:'not_observed'}});if(mounted.current)setNotice('当前尚未查到原请求结果，不代表写入失败。填写内容与原请求保持不变；需要时可明确使用原请求重试。');}
      else if(mounted.current)setError(failure);
    }finally{writeLock.current=false;if(mounted.current)setBusy(false);}
  }
  function reconcileBaseline(){
    const current=draftRef.current,finding=detail.data?.finding;
    if(!current||current.owner!==owner||qualityAuditRequestPending(current)||!same(current.findingId,finding?.finding_id)||!qualityAuditCanAct(status.data,detail.data,current.action))return;
    if(window.confirm('已核对本页最新记录后，保留已填文字并改按该记录继续本次办理？请重新检查全部依据；不会自动提交。')){setDraft({...current,expected_revision:finding.revision_no,request:null,conflict:false});setError(null);setNotice('已按本人确认采用最新办理基线，填写内容保留，请逐项核对后明确提交。');}
  }
  async function recoverIdentity(){
    const current=draftRef.current;if(!current||!qualityAuditSameIdentity(current.owner,user)||writeLock.current)return;
    writeLock.current=true;setBusy(true);setError(null);
    try{
      const fresh=await api.request(qualityAuditRoot+'/status');if(!fresh.enabled||!fresh.can_read)throw new Error('当前本人资格不能恢复该输入，请保留原身份和记录后核对。');
      if(current.findingId)await readDetail(current.findingId);else if(!fresh.can_register||fresh.read_only)throw new Error('当前本人已无登记资格，原输入仍保留。');
      if(!window.confirm('当前本人身份及事项查阅资格已重新核对。是否在当前授权下恢复原输入和原请求？后续写入仍核对最新资格及来源。'))return;
      setDraft(previous=>previous===current?{...previous,owner}:previous);setRefreshToken(value=>value+1);
    }catch(failure){setError(failure);}finally{writeLock.current=false;if(mounted.current)setBusy(false);}
  }
  async function olderHistory(){
    if(history.busy||!selected||!Number.isSafeInteger(history.next)||history.next<1)return;
    const id=selected,generation=detailGeneration.current;setHistory(previous=>({...previous,busy:true,error:null}));
    try{const data=await api.request(qualityAuditRoot+'/findings/'+encodeURIComponent(id)+'?'+new URLSearchParams({history_before:String(history.next)}));
      if(!same(data.finding?.finding_id,id)||!Array.isArray(data.events))throw new Error('读取到的历史与所选审计事项不一致。');
      if(mounted.current&&generation===detailGeneration.current)setHistory(previous=>({...previous,items:[...new Map([...previous.items,...data.events].map(row=>[row.event_id,row])).values()],truncated:Boolean(data.history_truncated),next:data.history_next_before,busy:false,error:null}));
    }catch(failure){if(mounted.current&&generation===detailGeneration.current)setHistory(previous=>({...previous,busy:false,error:failure}));}
  }
  const current=detail.data?.finding,stale=qualityAuditBaselineChanged(activeDraft,detail.data);
  const canSubmit=Boolean(activeDraft&&!activeDraft.conflict&&!stale&&!detail.loading&&qualityAuditCanAct(status.data,detail.data,activeDraft.action));
  const designChoices=qualityAuditDesignOptions(options.data?.designs||[],activeDraft?.action==='revise_design_basis'?current:null);
  const visibleRequest=activeDraft?.request,hasResult=visibleRequest?.phase==='verified'&&qualityAuditResultVisible(detail.data,visibleRequest.result);
  const field=(key,label,multiline=true)=><TextField key={key} label={label} value={activeDraft?.values[key]} multiline={multiline} onChange={value=>edit(key,value)}/>;
  const designSelect=label=><label className="form-field">{label}<select aria-label={label} required value={activeDraft?.values.design_id||''} onChange={event=>edit('design_id',event.target.value)}><option value="">请选择当前已确认的流程设计</option>{activeDraft?.values.design_id&&!designChoices.some(row=>same(row.draft_id,activeDraft.values.design_id))&&<option value={activeDraft.values.design_id}>原选择当前不可用，输入保留，请重新核对</option>}{designChoices.map(row=><option key={row.draft_id} value={String(row.draft_id)}>{qualityAuditDesignLabel(row)} · {display(row.approved_by_name,'确认人姓名未记录')} · {time(row.approved_at)}</option>)}</select></label>;

  return <section className="quality-audit" data-quality-audit>
    <section className="card"><div className="section-heading"><h2>数据质量审计</h2><button type="button" className="secondary" disabled={busy} onClick={()=>setRefreshToken(value=>value+1)}>查看最新审计记录</button></div><p>须先由部门负责人同意当前流程设计，再以该设计开展质量审计。审计人登记问题及整改要求，本部门主对接人提交整改措施和证据，审计人复核通过后关闭，或退回继续整改。</p><p>只采用平台已确认的固定设计；导入文件中的审核信息不能替代负责人确认。字段治理统计与审计结论分别保留。</p>
      {status.loading?<StatusPanel kind="loading" title="正在读取审计办理条件…"/>:status.error?<StatusPanel kind="error" title="审计办理条件暂不可用">{userMessage(status.error)} 当前不能据此判断没有事项或可以办理。</StatusPanel>:!status.data?.enabled?<StatusPanel title="质量审计闭环当前未开启">已有字段统计仍可独立查阅；不能据此认定已完成审计。</StatusPanel>:!status.data.can_read?<StatusPanel title="当前身份无权查看审计事项">请核对本人当前授权及事项范围。</StatusPanel>:<>
        {status.data.read_only&&<p role="note">当前身份只读，可查阅有权范围内的审计记录，不能登记、代整改或代复核。</p>}
        {qualityAuditCanAct(status.data,null,'register')&&!draft&&<button type="button" className="primary" onClick={()=>begin('register')}>登记审计事项</button>}
      </>}
    </section>
    {error&&<StatusPanel kind="error" title={qualityAuditRequestPending(ownDraft)?'本次办理结果待核对':'本次审计办理未完成'}>{qualityAuditFailure(error)}</StatusPanel>}{notice&&<StatusPanel title="审计办理提示">{notice}</StatusPanel>}
    {foreign&&<StatusPanel title="原身份的审计输入和请求仍保留">当前身份不能查看、修改或提交原输入。请使用原办理身份核对；同一人员、账号及部门仅发生授权更新时，可明确重新核对本人资格后恢复。{qualityAuditSameIdentity(draft.owner,user)&&<button type="button" disabled={busy} onClick={recoverIdentity}>核对本人当前资格并恢复输入</button>}</StatusPanel>}
    {ownDraft&&!activeDraft&&<StatusPanel title="另一事项的审计输入仍保留">当前查阅不会覆盖已填内容或原请求。<button type="button" disabled={busy} onClick={()=>selection(ownDraft.findingId||null)}>返回保留的审计输入</button></StatusPanel>}
    {status.data?.enabled&&status.data.can_read&&<>
      <section className="card"><div className="section-heading"><h3>本人有权范围内的审计事项</h3><label>查看范围<select aria-label="审计事项查看范围" value={view} onChange={event=>setView(event.target.value)}><option value="open">未关闭事项</option><option value="all">全部可见事项</option></select></label></div>
        {list.loading?<StatusPanel kind="loading" title="正在读取审计事项…"/>:list.error?<StatusPanel kind="error" title="审计事项暂不可用">{userMessage(list.error)} 读取失败不表示没有记录。</StatusPanel>:<>
          <p>未关闭：{Number.isSafeInteger(list.data?.summary?.open)?list.data.summary.open:'未提供'}；待审计复核：{Number.isSafeInteger(list.data?.summary?.awaiting_review)?list.data.summary.awaiting_review:'未提供'}；已关闭：{Number.isSafeInteger(list.data?.summary?.closed)?list.data.summary.closed:'未提供'}。</p>
          {!list.data?.items.length?<p>当前筛选范围没有可见事项。</p>:<div className="identity-table"><table><thead><tr><th>审计事项</th><th>责任部门</th><th>状态</th><th>最近保存</th><th>查阅</th></tr></thead><tbody>{list.data.items.map(row=><tr key={row.finding_id}><td>{display(row.title,'审计事项名称未记录')}</td><td>{display(row.department_snapshot?.name,'部门名称未记录')}</td><td>{qualityAuditState(row.state)}</td><td>{time(row.updated_at)}</td><td><button type="button" className="secondary" disabled={busy} onClick={()=>choose(row.finding_id)}>查看{display(row.title,'本事项')}</button></td></tr>)}</tbody></table></div>}
          {list.data?.truncated&&<p role="note">当前只显示部分有权读取的事项，不能据此判断清单以外没有记录。</p>}
        </>}
      </section>
      {selected&&(detail.loading?<StatusPanel kind="loading" title="正在读取本审计事项…"/>:detail.error?<StatusPanel kind="error" title="本审计事项暂不可用">{userMessage(detail.error)} 保留的输入不会因此清除。</StatusPanel>:current&&<section className="card" data-quality-audit-detail><h3>{display(current.title,'审计事项名称未记录')}</h3><p>当前状态：{qualityAuditState(current.state)}</p><FindingContent finding={current}/>
        {current.state==='closed'?<p>本事项已复核通过并关闭，办理及当时采用的设计记录继续保留。</p>:detail.data.design_gate?.valid!==true&&<StatusPanel kind="error" title="本次采用的流程设计需重新核对">{userMessage(detail.data.design_gate?.message,'当前设计确认已不满足办理条件。请先完成当前设计确认，再由审计人明确更新本事项的设计依据；部门需重新提交整改。')}</StatusPanel>}
        {!draft&&<div className="button-row">{['submit_rectification','review','revise_design_basis'].filter(action=>qualityAuditCanAct(status.data,detail.data,action)).map(action=><button type="button" key={action} className="primary" onClick={()=>begin(action)}>{qualityAuditAction(action)}</button>)}</div>}
        <details><summary>审计办理历史</summary><p>以下按当时保存的内容及人员姓名查阅；更新设计依据不会覆盖原整改或复核记录。</p>{history.items.map(event=><details key={event.event_id} className="import-record"><summary>{qualityAuditAction(event.action)} · {display(event.actor_snapshot?.person_name,'历史姓名未记录')} · {time(event.created_at)}</summary>{event.finding&&<><p>当时状态：{qualityAuditState(event.finding.state)}</p><FindingContent finding={event.finding} historical/></>}</details>)}{history.error&&<StatusPanel kind="error" title="较早审计历史暂不可用">{userMessage(history.error)}</StatusPanel>}{history.truncated&&<button type="button" className="secondary" disabled={history.busy} onClick={olderHistory}>{history.busy?'正在读取较早记录…':'读取更早审计记录'}</button>}</details>
      </section>)}
      {activeDraft&&<section className="card" ref={formRef} tabIndex={-1} data-quality-audit-form><h3>{qualityAuditAction(activeDraft.action)}</h3><p>当前输入仅保留在页面内存中，保存成功前不会写入审计记录。刷新或关闭整个网页会丢失尚未保存的输入。</p>
        {activeDraft.action==='register'&&<p>请明确问题、依据和整改要求，并选择已经由部门负责人同意的当前流程设计。</p>}
        {activeDraft.action==='submit_rectification'&&<p>请按本事项整改要求提交实际措施与证据，保存后由审计人复核；提交不表示已通过。</p>}
        {activeDraft.action==='review'&&<p>请结合当前设计及本轮整改措施、证据作出本人复核结论；通过关闭，退回后由部门继续整改。</p>}
        {activeDraft.action==='revise_design_basis'&&<p>只可明确采用同一制度档案的已确认设计。更新后等待部门重新提交整改，原审计、整改及复核历史保留。</p>}
        {(stale||activeDraft.conflict)&&<StatusPanel kind="error" title="本次输入的办理基线已变化">已填文字保留，不能自动套用到新记录。请先“查看最新审计记录”，逐项核对变化后再决定是否继续本次输入。<button type="button" disabled={busy||detail.loading||qualityAuditRequestPending(activeDraft)} onClick={reconcileBaseline}>以最新记录重新核对本次输入</button></StatusPanel>}
        {options.error&&<StatusPanel kind="error" title="责任部门或已确认设计未能读取">{userMessage(options.error)} 原选择与输入保留，请查看最新记录后重新核对。</StatusPanel>}
        {['register','revise_design_basis'].includes(activeDraft.action)&&options.loading&&<StatusPanel kind="loading" title="正在读取责任部门及已确认设计…"/>}
        {['register','revise_design_basis'].includes(activeDraft.action)&&options.data&&!designChoices.length&&<StatusPanel title="当前没有可选的已确认流程设计">{activeDraft.action==='revise_design_basis'?'本制度档案尚无符合当前条件的已确认设计。请先由部门负责人确认最新设计，再查看最新审计记录。':'请先完成拟审计流程的部门负责人设计确认，再查看最新审计记录；不能用导入文件中的审核信息替代。'} 已填内容保持不变。</StatusPanel>}
        {qualityAuditRequestPending(activeDraft)&&<StatusPanel title={visibleRequest?.phase==='verified'?'保存回执已核对':'原请求结果尚待核对'}>{visibleRequest?.phase==='not_observed'?'当前尚未查到原请求结果，不能据此认定写入失败。原提交内容保持固定。':visibleRequest?.phase==='committed'?'已取得保存回执，仍须读取对应审计记录后核对结果。':visibleRequest?.phase==='verified'?'本次保存回执与当前事项已核对，原输入仍留在本页供本人确认。':'原提交内容已固定，当前不能修改或另建重复请求。请显式查询原请求结果。'}</StatusPanel>}
        <form onSubmit={submit}><fieldset disabled={busy||!qualityAuditEditable(activeDraft)||status.data.read_only===true}>
          {activeDraft.action==='register'&&<>{field('title','审计事项',false)}{field('subject','审计对象',false)}{field('finding_text','质量问题')}{field('basis_text','审计依据')}{field('requirement_text','整改要求')}<label className="form-field">责任部门<select aria-label="审计责任部门" required value={activeDraft.values.responsible_department_id} onChange={event=>edit('responsible_department_id',event.target.value)}><option value="">请选择责任部门</option>{activeDraft.values.responsible_department_id&&!options.data?.departments.some(row=>same(row.id,activeDraft.values.responsible_department_id))&&<option value={activeDraft.values.responsible_department_id}>原责任部门当前未读取，输入保留</option>}{options.data?.departments.map(row=><option key={row.id} value={String(row.id)}>{display(row.name,'部门名称未记录')}</option>)}</select></label>{designSelect('已确认流程设计')}</>}
          {activeDraft.action==='submit_rectification'&&<>{field('action_text','整改措施')}{field('evidence_text','整改证据')}</>}
          {activeDraft.action==='review'&&<><label className="form-field">审计复核结论<select aria-label="审计复核结论" value={activeDraft.values.decision} required onChange={event=>edit('decision',event.target.value)}><option value="">请选择本人复核结论</option><option value="accept">通过并关闭</option><option value="return">退回继续整改</option></select></label>{field('basis_text','审计复核依据')}</>}
          {activeDraft.action==='revise_design_basis'&&<>{designSelect('同一制度档案的已确认设计')}{field('finding_text','更新后的质量问题')}{field('basis_text','更新后的审计依据')}{field('requirement_text','更新后的整改要求')}{field('reason','更新设计依据的原因')}</>}
          <button type="submit" className="primary" disabled={!canSubmit||(['register','revise_design_basis'].includes(activeDraft.action)&&(options.loading||options.error))}>保存本次审计办理</button>
        </fieldset></form>
        {qualityAuditRequestPending(activeDraft)&&<div className="button-row"><button type="button" className="secondary" disabled={busy} onClick={queryResult}>查询原请求结果</button>{qualityAuditCanRetry(activeDraft)&&<button type="button" className="secondary" disabled={busy||status.data.read_only===true} onClick={event=>submit(event,true)}>使用原请求重试</button>}{hasResult&&<button type="button" className="primary" disabled={busy} onClick={()=>{if(window.confirm('已核对本次保存结果及当前记录，是否结束本次输入？')){setDraft(null);setError(null);setNotice('');}}}>核对后结束本次输入</button>}</div>}
        {qualityAuditEditable(activeDraft)&&<button type="button" className="secondary" disabled={busy} onClick={()=>{if(window.confirm('明确放弃本次尚未保存的审计输入？已保存的业务记录不会撤销。')){setDraft(null);setError(null);setNotice('');}}}>明确放弃本次输入</button>}
      </section>}
    </>}
  </section>;
}
