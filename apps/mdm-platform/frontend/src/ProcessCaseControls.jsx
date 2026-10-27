import {businessFileName,businessText} from './businessPresentation.js';
import {caseRevisionMaterialLabel,caseHistoryAction} from './caseHistoryPresentation.js';
import {businessDateTime} from './businessGuidance.js';
import {userMessage} from './businessPresentation.js';
import {businessStatus} from "./businessPresentation.js";
import {useEffect,useRef,useState} from 'react';
import {StatusPanel} from './components.jsx';
import './process-case-controls.css';
import {SubmissionReview,CaseChangeSummary,CaseGovernanceHistory} from './SubmissionReview.jsx';
import {caseSubmissionCollections} from './caseSubmissionFieldsModel.js';
import {caseResultLocation} from './submissionReviewModel.js';

const base='/api/process-v7-preview/cases/';
export const emptyCaseSubmission=()=>({sources:[{reference:'',title:'',basis:''}],purpose:'',revision_reason:'',change_summary:'',participants:[]});
const field=(label,value,onChange,required=true)=><label>{label}<textarea aria-label={label} rows={2} maxLength={4000} required={required} value={value||''} onChange={e=>onChange(e.target.value)}/></label>;

export function CaseSubmissionFields({value,onChange,departments=[],behaviors=[],participantsOnly=false}){
  const input=value||emptyCaseSubmission(),change=patch=>onChange({...input,...patch});
  const {sources,participants}=caseSubmissionCollections(input);
  const source=(index,patch)=>change({sources:sources.map((row,i)=>i===index?{...row,...patch}:row)});
  const participant=(index,patch)=>change({participants:participants.map((row,i)=>i===index?{...row,...patch}:row)});
  return <div className="case-submission-fields">
    {!participantsOnly&&<><h3>本次提交材料</h3><p>来源和参与范围在3000核对登记；原编制文件的正文保持原样。部门须明确选择，不能从动态角色推断。</p>
    {field('新编目的',input.purpose,v=>change({purpose:v}))}
    {field('修订原因（新编请明确说明新编）',input.revision_reason,v=>change({revision_reason:v}))}
    {field('本次变化说明（无变化请明确说明）',input.change_summary,v=>change({change_summary:v}))}
    <h4>来源与依据</h4>{sources.map((row,i)=><div className="preview-item" key={i}>
      <label>来源名称<input aria-label={`来源名称 ${i+1}`} required maxLength={4000} value={row.title||''} onChange={e=>source(i,{title:e.target.value})}/></label>
      <label>来源定位<input aria-label={`来源定位 ${i+1}`} required maxLength={4000} value={row.reference||''} onChange={e=>source(i,{reference:e.target.value})}/></label>
      {field(`编制依据 ${i+1}`,row.basis,v=>source(i,{basis:v}))}
      <button type="button" disabled={sources.length===1} onClick={()=>change({sources:sources.filter((_,n)=>n!==i)})}>移除此项来源</button>
    </div>)}<button type="button" onClick={()=>change({sources:[...sources,{reference:'',title:'',basis:''}]})}>新增来源材料</button></>}
    <h4>本次实际参与部门</h4>{participants.map((row,i)=><div className="preview-item" key={i}>
      <label>参与部门<select aria-label={`参与部门 ${i+1}`} required value={row.department_id} onChange={e=>participant(i,{department_id:e.target.value})}><option value="">请选择当前有效部门</option>{departments.map(d=><option key={d.id} value={String(d.id)}>{d.name}</option>)}</select></label>
      {field(`本部门责任范围 ${i+1}`,row.responsibilities,v=>participant(i,{responsibilities:v}))}
      {field(`参与依据 ${i+1}`,row.basis,v=>participant(i,{basis:v}))}
      <label>本部门核对的行为<select aria-label={`本部门核对的行为 ${i+1}`} multiple size={5} value={row.behavior_refs||[]} onChange={e=>participant(i,{behavior_refs:[...e.target.selectedOptions].map(o=>o.value)})}>{behaviors.map(b=><option key={b.behavior_ref} value={b.behavior_ref}>{b.behavior_name}</option>)}</select></label><p>未限定具体行为时，表示本部门核对完整当前流程。</p>
      <button type="button" onClick={()=>change({participants:participants.filter((_,n)=>n!==i)})}>移除此参与部门</button>
    </div>)}<button type="button" onClick={()=>change({participants:[...participants,{department_id:'',behavior_refs:[],responsibilities:'',basis:''}]})}>新增参与部门</button>
    {!participants.length&&<p role="status">尚未明确参与部门，不能据此确认无需跨部门核对。</p>}
  </div>;
}

const names={submission:'补充本次提交材料',confirm_submission:'本人确认提交材料及本部门范围',scope:'申请参与范围变化',owner:'申请真实归口交接',lifecycle:'申请暂停、终止或恢复',deadline:'约定本次办理时限',confirm_change:'本人确认变更',register_change:'登记已确认变更',cancel_change:'撤销未登记事项',acceptance:'记录本次业务验收',add_suggestion:'提出独立优化建议',dispose_suggestion:'记录建议处置',record_institution_editions:'补充来源及拟议制度版次'};
export function ProcessCaseHistory({api,caseRow}){
  const [value,setValue]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),active=useRef(null),generation=useRef(0);
  async function load(next=false){active.current?.abort();const controller=new AbortController();active.current=controller;const token=++generation.current;setBusy(true);setError('');try{
    const query=new URLSearchParams();if(next){query.set('after_event_id',value?.next_after_event_id??value?.events?.at(-1)?.id??0);query.set('before_revision_no',value?.next_before_revision_no??-1);}
    const result=await api.request(base+encodeURIComponent(caseRow.id)+'/history?'+query,{signal:controller.signal});if(token===generation.current)setValue(result);
  }catch(e){if(token===generation.current&&e.name!=='AbortError')setError(e.serverMessage||e.message);}finally{if(token===generation.current)setBusy(false);}}
  useEffect(()=>{setValue(null);load();return()=>{++generation.current;active.current?.abort();};},[caseRow.id]);
  async function download(revision){const token=generation.current;try{const result=await api.request(base+encodeURIComponent(caseRow.id)+'/revisions/'+encodeURIComponent(revision.id)+'/document');if(token!==generation.current)return;const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=businessFileName(caseRow.process_name,'历史流程编制文件','json');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){if(token===generation.current)setError(e.serverMessage||e.message);}}
  return <section className="card" data-process-case-history><h2>{caseRow.process_name} · 历史查阅</h2><p>当前账号只可查阅参与办理或交接确认时的流程内容及此前必要历史。后续修订和当前办理材料须按当前职责取得权限。</p><button disabled={busy} onClick={()=>load()}>刷新可查历史</button>{error&&<StatusPanel kind="error" title="历史读取未完成">{userMessage(error)}</StatusPanel>}{value&&<><h3>已保存的历史内容</h3>{value.revisions.map(r=><p key={r.id}>保存时间：{businessDateTime(r.created_at)} · {caseRevisionMaterialLabel(r,caseRow)}<button disabled={busy} onClick={()=>download(r)}>下载该次保存的内容</button></p>)}<h3>关联办理记录</h3>{value.events.map(e=><p key={e.id}>{businessDateTime(e.created_at)} · {caseHistoryAction(e)} · {businessText(e.basis_text,'办理依据含技术内容，请查阅原材料')}</p>)}<button disabled={busy||!value.next_before_revision_no&&!value.next_after_event_id} onClick={()=>load(true)}>读取下一页可查历史</button></>}</section>;
}
export function ProcessCaseControls({api,detail,draft,setDraft,disabled,onBusyChange,onSaved,refreshKey}){
  const row=detail.case,root=base+encodeURIComponent(row.id)+'/governance';
  const [state,setState]=useState(null),[departments,setDepartments]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [formalControls,setFormalControls]=useState(null),[history,setHistory]=useState(null);
  const generation=useRef(0),active=useRef(null),draftRef=useRef(draft),lock=useRef(false),editor=useRef(null);draftRef.current=draft;
  const own=draft?.kind==='case-control'&&String(draft.caseId)===String(row.id)?draft:null;
  async function load(){active.current?.abort();const controller=new AbortController();active.current=controller;const version=++generation.current;setError('');setState(null);setFormalControls(null);try{
    const [result,formal,deps]=await Promise.all([api.request(root,{signal:controller.signal}),api.request(base+encodeURIComponent(row.id)+'/formal-controls',{signal:controller.signal}),api.request('/api/org/departments',{signal:controller.signal})]);
    if(version!==generation.current)return;setDepartments(deps.filter(d=>!d.status||d.status==='active'));setFormalControls(formal);setState(result);
  }catch(e){if(e.name!=='AbortError'&&version===generation.current)setError(e.serverMessage||e.message);} }
  useEffect(()=>{load();return()=>{++generation.current;active.current?.abort();};},[row.id,row.current_revision_no,row.current_content_hash,refreshKey]);
  useEffect(()=>{if(own)editor.current?.focus();},[own?.request_id]);
  const stale=own&&(Number(own.expected_revision_no)!==Number(row.current_revision_no)||own.expected_content_hash!==row.current_content_hash||own.formal_action&&formalControls&&String(own.expected_event_id)!==String(formalControls.event_id)&&!own.receiptConfirmed);
  const actions=state?.allowed_actions||[];
  const allows=action=>actions.includes(action)||actions.includes(({confirm_submission:'confirm_submission',submission:'save_submission',scope:'propose_change',owner:'propose_change',lifecycle:'propose_change',deadline:'propose_change',acceptance:'record_acceptance'})[action]);
  function start(action,change){if(lock.current||disabled)return;if(draftRef.current&&!window.confirm('当前有未提交输入，是否明确放弃后开始本次办理？'))return;
    setError('');setNotice('');setDraft({kind:'case-control',dirty:true,caseId:String(row.id),action,request_id:crypto.randomUUID(),expected_revision_no:row.current_revision_no,expected_content_hash:row.current_content_hash,
      change_id:change?.change_id,change_snapshot:change?structuredClone(change):null,submission:structuredClone(state?.submission||emptyCaseSubmission()),basis:'',reason:'',operation:'',target_department_id:'',duty_impact:'',pending_work:'',due_date:'',department_ids:[],conclusion:'',formal_version_id:String(detail.formal_promotion?.current_version?.id||''),evidence_refs:[],resultUnknown:false,
      formal_action:['add_suggestion','dispose_suggestion','record_institution_editions'].includes(action),expected_event_id:formalControls?.event_id,title:'',affected_scope:'',non_blocking_reason:'',suggestion_id:change?.suggestion_id||'',status:'',disposition:'',materials:(state?.submission?.sources||[]).map(s=>{const saved=formalControls?.institution_editions?.materials?.find(m=>m.reference===s.reference);return {reference:s.reference,source_edition:saved?.source_edition??'',proposed_edition:saved?.proposed_edition??''};})});}
  const update=patch=>setDraft({...draftRef.current,...patch,dirty:true});
  async function reconcile(){const current=draftRef.current;if(!current?.resultUnknown||lock.current)return;lock.current=true;setBusy(true);onBusyChange?.(true);setError('');try{
    const result=await api.request(root+'/requests/'+encodeURIComponent(current.request_id));
    if(draftRef.current?.request_id!==current.request_id)return;
    if(result.state==='committed'||result.status==='committed'||result.committed===true){update({receiptConfirmed:true,canRetryOriginal:false});setNotice('上次办理已保存。请在本页核对结果，再结束本次输入。');await load();}
    else if(['not_recorded','not_observed','retryable'].includes(result.state||result.status)){update({canRetryOriginal:true});setNotice('暂时还不能确定上次操作是否保存。填写内容仍保留；点击“继续办理并核对结果”会再次办理同一次操作，可能完成此前未保存的内容。');}
    else if(result.state==='rejected'){update({resultUnknown:false,request_id:crypto.randomUUID()});setNotice('上次办理未被接受，填写内容仍保留。请根据提示核对后重新提交。');}
    else setNotice('本次办理结果仍未确定，填写内容仍保留。请稍后再核对结果，暂不要重新发起相同办理。');
  }catch(e){setError(e.serverMessage||e.message);}finally{lock.current=false;setBusy(false);onBusyChange?.(false);}}
  async function retryOriginal(){const current=draftRef.current;if(!current?.canRetryOriginal||current.receiptConfirmed||!current.requestBody||lock.current)return;lock.current=true;setBusy(true);onBusyChange?.(true);setError('');try{await api.request(current.requestUrl||root+current.requestPath,{method:'POST',body:current.requestBody});if(draftRef.current?.request_id===current.request_id){update({receiptConfirmed:true,canRetryOriginal:false});setNotice('已确认本次办理保存成功。请核对本页结果，再结束本次输入。');await load();await onSaved?.();}}catch(e){setError(e.serverMessage||e.message);}finally{lock.current=false;setBusy(false);onBusyChange?.(false);}}
  async function submit(event){event.preventDefault();const current=draftRef.current;if(!current||lock.current||disabled||stale||current.resultUnknown)return;
    const version=generation.current;const common={expected_revision_no:current.expected_revision_no,expected_content_hash:current.expected_content_hash,request_id:current.request_id,basis:current.basis};let path,body=common,targetRoot=root;
    if(current.formal_action){targetRoot=base+encodeURIComponent(row.id)+'/formal-controls';path='';body={...common,expected_event_id:current.expected_event_id,action:current.action,...(current.action==='add_suggestion'?{title:current.title,affected_scope:current.affected_scope,non_blocking_reason:current.non_blocking_reason}:current.action==='dispose_suggestion'?{suggestion_id:current.suggestion_id,status:current.status,disposition:current.disposition}:{materials:current.materials})};}
    else if(current.action==='submission'){path='/submission';body={...common,submission:current.submission};}
    else if(current.action==='confirm_submission')path='/submission/confirm';
    else if(['confirm_change','register_change','cancel_change'].includes(current.action))path='/changes/'+encodeURIComponent(current.change_id)+({confirm_change:'/confirm',register_change:'/register',cancel_change:'/cancel'})[current.action];
    else if(current.action==='acceptance'){path='/acceptance';body={...common,formal_version_id:current.formal_version_id,conclusion:current.conclusion,evidence_refs:current.evidence_refs};}
    else{path='/changes';body={...common,kind:current.action,reason:current.reason,...(current.action==='scope'?{participants:current.submission.participants}:current.action==='owner'?{target_department_id:current.target_department_id,duty_impact:current.duty_impact,pending_work:current.pending_work}:current.action==='lifecycle'?{operation:current.operation}:{due_date:current.due_date,department_ids:current.department_ids})};}
    lock.current=true;setBusy(true);onBusyChange?.(true);setError('');setNotice('');update({resultUnknown:true,requestBody:body,requestPath:path,requestUrl:targetRoot+path});
    try{await api.request(targetRoot+path,{method:'POST',body});if(version!==generation.current||draftRef.current?.request_id!==current.request_id)return;update({resultUnknown:true,receiptConfirmed:true});setNotice('本次操作已保存。'+caseResultLocation(current.action,current.change_snapshot?.kind)+'核对后请结束本次输入。材料确认、正式确认和业务验收分别记录。');await load();await onSaved?.();}
    catch(e){if(version===generation.current){if(e.status>=400&&e.status<500)update({resultUnknown:false});setError(e.serverMessage||e.message);}}
    finally{lock.current=false;setBusy(false);onBusyChange?.(false);}
  }
  function finish(){if(own?.resultUnknown&&!own.receiptConfirmed)return;if(window.confirm(own?.receiptConfirmed?'已核对本次已保存操作，是否结束本次输入？':'是否明确放弃本次未提交输入？')){setDraft(null);setNotice('');}}
  async function loadHistory(next=false){const version=generation.current;try{const query=new URLSearchParams();if(next){query.set('after_event_id',history?.next_after_event_id??history?.events?.at(-1)?.id??0);query.set('before_revision_no',history?.next_before_revision_no??-1);}const result=await api.request(base+encodeURIComponent(row.id)+'/history?'+query);if(version===generation.current)setHistory(result);}catch(e){setError(e.serverMessage||e.message);}}
  async function downloadRevision(revision){try{const result=await api.request(base+encodeURIComponent(row.id)+'/revisions/'+encodeURIComponent(revision.id)+'/document'),url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download=businessFileName(row.process_name,'历史流程编制文件','json');anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e.serverMessage||e.message);}}
  return <section className="card review-task" data-process-case-controls><h2>提交材料与本部门核对</h2><p className="review-helper">阅读材料及责任范围后，由本部门负责人本人填写核对依据。</p>
    <button type="button" disabled={busy||disabled} onClick={load}>刷新材料与案例状态</button>
    {error&&<StatusPanel kind="error" title="案例办理尚未完成">{userMessage(error)}</StatusPanel>}{notice&&<StatusPanel title="办理回执">{notice}</StatusPanel>}
    {!state&&!error&&<StatusPanel kind="loading" title="正在读取提交材料…">取得当前材料后显示可办动作。</StatusPanel>}
    {state&&<><SubmissionReview state={state} detail={detail} departments={departments} disabled={busy||disabled} editing={Boolean(own)} onStart={start}/>
      <details className="review-additional"><summary>补充材料或办理其他事项</summary><p>材料确认、范围变化、暂停终止、归口交接和业务验收各自留痕。只对实际发生的变化建立事项；新提交材料确认不表示发生范围变化。</p><div className="import-actions">{['submission','scope','owner','lifecycle','deadline','acceptance'].filter(allows).map(action=><button type="button" key={action} disabled={busy||disabled} onClick={()=>start(action)}>{names[action]}</button>)}</div></details>
    </>}
    <details className="review-additional"><summary>优化建议、制度版次与历史记录</summary>
    {formalControls&&<section><h3>独立优化建议与制度材料版次</h3><p>建议不替代必要事实核对，不解除内容卡口。平台发布不自动证明企业制度已经批准或生效。</p><div className="import-actions">{['add_suggestion','record_institution_editions'].filter(a=>formalControls.allowed_actions?.includes(a)).map(a=><button type="button" key={a} disabled={busy||disabled} onClick={()=>start(a)}>{names[a]}</button>)}</div>{(formalControls.suggestions||[]).map(s=><article key={s.suggestion_id} className="preview-item"><h4>{businessText(s.title,'建议名称暂无法直接展示')}</h4><p>涉及范围：{businessText(s.affected_scope,'涉及范围说明暂无法直接展示')}；不阻断理由：{businessText(s.non_blocking_reason,'理由含技术内容，请查阅原材料')}</p><p>处理状态：{({open:'待处理',planned:'已安排',implemented_in_revision:'已在修订落实',declined:'不采纳',deferred:'后续办理'})[s.status]||businessStatus(s.status)}；{businessText(s.disposition||'尚未记录处置','处置说明暂无法直接展示')}</p>{formalControls.allowed_actions?.includes('dispose_suggestion')&&<button disabled={busy||disabled} onClick={()=>start('dispose_suggestion',s)}>记录此建议处置</button>}<details><summary>建议办理历史</summary>{(s.history||[]).map((h,i)=><p key={i}>{businessDateTime(h.created_at)} · {businessText(h.basis,'办理依据含技术内容，请查阅原材料')} · {businessText(h.disposition||h.title,'历史说明暂无法直接展示')}</p>)}</details></article>)}{formalControls.institution_editions&&<p>制度版次补充已留存；企业签批和生效状态仍须有独立依据。</p>}</section>}
    {state&&<CaseGovernanceHistory state={state} departments={departments}/>}
    <section><h3>历史修订与关联记录</h3><p>历史记录持续保留。保存年限尚未确定，不自动删除；历史读取不代表当前确认有效。</p><button type="button" disabled={busy||disabled} onClick={()=>loadHistory()}>读取历史记录</button>{history&&<><h4>已保存修订</h4>{history.revisions.map(r=><p key={r.id}>保存时间：{businessDateTime(r.created_at)} · {caseRevisionMaterialLabel(r,row)}<button type="button" onClick={()=>downloadRevision(r)}>下载此历史修订</button></p>)}<h4>关联办理记录</h4>{history.events.map(e=><p key={e.id}>{businessDateTime(e.created_at)} · {caseHistoryAction(e)} · {businessText(e.basis_text,'办理依据含技术内容，请查阅原材料')}</p>)}<button type="button" disabled={busy||!history.next_before_revision_no&&!history.next_after_event_id} onClick={()=>loadHistory(true)}>读取下一页历史</button></>}</section>
    </details>
    {own&&<section className="preview-editor" ref={editor} tabIndex={-1}><h3>{names[own.action]}</h3>{stale&&<StatusPanel title="当前来源已变化">原输入仍保留，须核对来源后重新办理。</StatusPanel>}
      <p>办理流程：《{businessText(row.process_name,'流程名称暂无法直接展示')}》。</p>
      {own.action==='deadline'&&<section className="deadline-proposal-guidance" aria-label="办理时限的提出、确认和登记"><p>请填写与相关部门拟定的完成日期、约定原因和办理依据，选择本轮全部参与部门，再点击“保存本次办理”。保存后，这条时限提议先进入待确认状态。</p><ol><li>相关部门的现任负责人在本案例“本次核对”的“需要确认或登记的具体事项”中，分别点击“本人确认此事项”并保存依据。</li><li>全部所需部门确认后，由MDM组长在同一事项点击“登记已确认事项”。登记成功的日期显示在本案例的“办理截止日期”。</li></ol><p>提出、确认及登记记录在“优化建议、制度版次与历史记录”的“提交材料与办理时限历史”查阅。</p></section>}
      {['confirm_change','register_change','cancel_change'].includes(own.action)&&<><CaseChangeSummary change={own.change_snapshot||state?.changes?.find(change=>change.change_id===own.change_id)} departments={departments}/><p>{own.action==='confirm_change'?'请先核对以上具体内容，再填写本部门依据。保存仅记录本部门确认；全部所需部门确认后，由MDM组长登记。':'请核对以上内容及各部门确认记录后办理。'}完成后在本页相应事项及办理截止日期核对结果。</p></>}
      {own.resultUnknown&&<StatusPanel title={own.receiptConfirmed?'操作已保存，待核对结束':'本次办理结果尚未确定'}>{own.receiptConfirmed?'本次办理已保存，无需再次提交。'+caseResultLocation(own.action,own.change_snapshot?.kind)+'核对后请结束本次输入。':'原输入和提交内容已保留。请先核对本次办理结果；此前尚未成功时，继续办理可能完成原操作。'}<button type="button" disabled={busy||own.receiptConfirmed} onClick={reconcile}>核对本次办理结果</button>{own.canRetryOriginal&&!own.receiptConfirmed&&<button type="button" disabled={busy} onClick={retryOriginal}>继续办理并核对结果</button>}</StatusPanel>}
      {own.action==='confirm_submission'&&<p className="review-confirm-context">本次确认的对象是当前所选流程内容、提交材料及本部门责任范围。请写明实际查阅的材料与核对依据；发现问题时可放弃本次输入，交主对接人修订。</p>}
      <form onSubmit={submit}><fieldset disabled={busy||disabled||stale||own.resultUnknown}>
        {own.action==='submission'&&<CaseSubmissionFields value={own.submission} onChange={submission=>update({submission})} departments={departments} behaviors={detail.revision.document.behaviors||[]}/>}
        {own.action==='scope'&&<CaseSubmissionFields participantsOnly value={own.submission} onChange={submission=>update({submission})} departments={departments} behaviors={detail.revision.document.behaviors||[]}/>}
        {own.action==='lifecycle'&&<label>状态动作<select aria-label="状态动作" required value={own.operation} onChange={e=>update({operation:e.target.value})}><option value="">请选择实际动作</option><option value="pause">暂停</option><option value="terminate">终止</option><option value="resume">恢复原案例办理</option></select></label>}
        {own.action==='owner'&&<><label>接收归口部门<select aria-label="接收归口部门" required value={own.target_department_id} onChange={e=>update({target_department_id:e.target.value})}><option value="">请选择</option>{departments.map(d=><option key={d.id} value={String(d.id)}>{d.name}</option>)}</select></label>{field('职责影响',own.duty_impact,v=>update({duty_impact:v}))}{field('在办事项交接',own.pending_work,v=>update({pending_work:v}))}</>}
        {own.action==='deadline'&&<><label>约定完成日期<input aria-label="约定完成日期" type="date" required value={own.due_date} onChange={e=>update({due_date:e.target.value})}/></label><label>参与时限约定的部门<select multiple required aria-label="参与时限约定的部门" aria-describedby="deadline-department-selection-help" value={own.department_ids} onChange={e=>update({department_ids:[...e.target.selectedOptions].map(o=>o.value)})}>{departments.map(d=><option key={d.id} value={String(d.id)}>{d.name}</option>)}</select></label><p id="deadline-department-selection-help" className="review-helper">须选择本轮全部实际参与部门。按住 Ctrl 键逐个选择；连续部门可按住 Shift 键选择。</p></>}
        {own.action==='acceptance'&&<><p>验收对象：本案例所选的已发布流程内容。请先查阅对应材料后填写本人实际结论。</p><label>验收结论<select aria-label="验收结论" required value={own.conclusion} onChange={e=>update({conclusion:e.target.value})}><option value="">请选择本人实际结论</option><option value="accepted">验收通过</option><option value="not_accepted">验收未通过</option></select></label>{field('验收证据引用（每行一项）',own.evidence_refs.join('\n'),v=>update({evidence_refs:v.split('\n').filter(Boolean)}))}</>}
        {own.action==='add_suggestion'&&<>{field('独立优化建议',own.title,v=>update({title:v}))}{field('建议涉及范围',own.affected_scope,v=>update({affected_scope:v}))}{field('不影响本次事实、责任和执行的理由',own.non_blocking_reason,v=>update({non_blocking_reason:v}))}</>}
        {own.action==='dispose_suggestion'&&<><label>建议处置<select aria-label="建议处置" required value={own.status} onChange={e=>update({status:e.target.value})}><option value="">请选择实际处理</option><option value="planned">已安排</option><option value="implemented_in_revision">已在修订落实</option><option value="declined">不采纳</option><option value="deferred">后续办理</option></select></label>{field('具体处置说明',own.disposition,v=>update({disposition:v}))}</>}
        {own.action==='record_institution_editions'&&<>{!own.materials.length&&<p>请先在提交材料清单登记可定位来源。</p>}{own.materials.map((m,i)=><div key={m.reference}><p>来源定位：{businessText(m.reference,'来源定位含技术内容，请查阅原材料')}</p><label>来源制度版次（未确定可留空）<input aria-label={`来源制度版次 ${i+1}`} maxLength={128} value={m.source_edition} onChange={e=>update({materials:own.materials.map((v,n)=>n===i?{...v,source_edition:e.target.value}:v)})}/></label><label>拟议制度版次（未确定可留空）<input aria-label={`拟议制度版次 ${i+1}`} maxLength={128} value={m.proposed_edition} onChange={e=>update({materials:own.materials.map((v,n)=>n===i?{...v,proposed_edition:e.target.value}:v)})}/></label></div>)}</>}
        {['scope','owner','lifecycle','deadline'].includes(own.action)&&field('实际变化或约定原因',own.reason,v=>update({reason:v}))}
        {field('本次办理依据',own.basis,v=>update({basis:v}))}<button className="primary" type="submit">保存本次办理</button>
      </fieldset></form><button type="button" disabled={busy||own.resultUnknown&&!own.receiptConfirmed} onClick={finish}>{own.receiptConfirmed?'核对后结束本次输入':'明确放弃本次输入'}</button>
    </section>}
  </section>;
}
