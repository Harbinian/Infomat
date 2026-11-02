import {businessStatus} from './businessPresentation.js';
import {BusinessDirectoryPicker} from "./BusinessDetails.jsx";
import {businessName,businessText} from "./businessPresentation.js";
import React, {useEffect,useRef,useState} from 'react';
import {StatusPanel,useInputProtection} from './components.jsx';
import {actionsOf,displayState,exactFailure,impactDecisionLabels,ownerKey,retainWriteFailure,sourceKindLabels,termActionLabels,termDefinitionHeading,termId,termStateLabel,termValues,terminologyRoot,updateEditableDraft} from './terminologyGovernanceModel.js';
import './terminology-governance.css';

const text=value=>businessText(value);
const actor=row=>row.actor_name||'办理人姓名未记录';
const versionContent=version=>({...version,...version?.source,...(version?.content||version?.definition_json||{})});
const editActions=new Set(['edit','update','edit_draft','revise']);
const fieldSpecs=[['term','术语名称',255],['context','业务语境 / 适用条件',4000],['definition','拟采用定义',10000],['company_application','公司适用说明',10000]];

function DefinitionView({value,heading='当前固定定义'}) {
  if(!value)return null;
  const row=versionContent(value);
  return <div className="term-definition-view"><h4>{heading}</h4><dl className="term-definition-grid"><div><dt>术语名称</dt><dd>{text(row.term)}</dd></div><div><dt>业务语境 / 适用条件</dt><dd>{text(row.context)}</dd></div><div className="term-definition-wide"><dt>采用定义</dt><dd className="term-original">{text(row.definition)}</dd></div><div><dt>来源类别</dt><dd>{sourceKindLabels[row.source_kind]||businessStatus(row.source_kind,'来源类别待核对')}</dd></div><div><dt>标准号 / 版本 / 条款</dt><dd>{[row.standard_number,row.standard_version,row.standard_clause].filter(Boolean).join(' / ')||'未记录'}</dd></div><div className="term-definition-wide"><dt>标准原定义</dt><dd className="term-original">{text(row.original_definition)}</dd></div><div className="term-definition-wide"><dt>公司适用说明</dt><dd className="term-original">{text(row.company_application)}</dd></div></dl></div>;
}

export function TerminologyGovernance({api,user,draft,setDraft,onQueryChange,legacyFallback=null}) {
  const [capability,setCapability]=useState(null),[catalog,setCatalog]=useState(null),[detail,setDetail]=useState(null),[challenges,setChallenges]=useState([]),[usageImpact,setUsageImpact]=useState(null),[impactBusy,setImpactBusy]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[selected,setSelected]=useState(()=>new URLSearchParams(location.search).get('id')||new URLSearchParams(location.search).get('term')||''),[search,setSearch]=useState(''),[filter,setFilter]=useState('usable'),[historyId,setHistoryId]=useState('');
  const mounted=useRef(false),generation=useRef(0),listGeneration=useRef(0),writeLock=useRef(false),firstInput=useRef(null),guard=useInputProtection(),guardId=useRef(Symbol('terminology-governance'));
  const owner=ownerKey(user),authorityKey=owner+':'+(user?.permissions||[]).join(','),editing=draft?.mode==='terminology-governance',sameDraft=editing&&(!draft.owner||draft.owner===owner),selectedRef=useRef(selected);
  selectedRef.current=selected;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current+=1;listGeneration.current+=1;};},[]);
  useEffect(()=>{guard?.update(guardId.current,Boolean(editing));return()=>guard?.update(guardId.current,false);},[guard,editing]);
  useEffect(()=>{if(sameDraft)firstInput.current?.focus();},[sameDraft,draft?.action,draft?.challenge_id]);
  useEffect(()=>{
    const controller=new AbortController();setError(null);
    api.request(terminologyRoot+'/capabilities',{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setCapability(result);}).catch(e=>{if(!controller.signal.aborted)setError(e);});
    return()=>controller.abort();
  },[api,revision,authorityKey]);
  useEffect(()=>{
    if(!capability?.enabled||capability.ready===false)return;
    const controller=new AbortController(),current=++listGeneration.current;setCatalog(null);
    api.request(terminologyRoot+'/terms?'+new URLSearchParams({q:search}),{signal:controller.signal}).then(result=>{if(!controller.signal.aborted&&current===listGeneration.current)setCatalog(result);}).catch(e=>{if(!controller.signal.aborted&&current===listGeneration.current)setError(e);});
    return()=>controller.abort();
  },[api,capability,search,revision]);
  useEffect(()=>{
    const controller=new AbortController(),current=++generation.current;setDetail(null);setChallenges([]);setHistoryId('');setUsageImpact(null);setImpactBusy(false);
    if(!capability?.enabled||capability.ready===false||!selected)return()=>controller.abort();
    const resolve=/^\d+$/.test(selected)?api.request('/api/terminology/'+encodeURIComponent(selected),{signal:controller.signal}).then(row=>{if(!row.governance_term_id)throw new Error('此历史词条尚未形成可追溯的新词典映射，请保留原引用并核对迁移记录。');return row.governance_term_id;}):Promise.resolve(selected);
    resolve.then(id=>Promise.all([api.request(terminologyRoot+'/terms/'+encodeURIComponent(id),{signal:controller.signal}),api.request(terminologyRoot+'/terms/'+encodeURIComponent(id)+'/challenges',{signal:controller.signal})])).then(([record,issues])=>{if(!controller.signal.aborted&&current===generation.current){setDetail(record);setChallenges(issues.items||[]);}}).catch(e=>{if(!controller.signal.aborted&&current===generation.current)setError(e);});
    return()=>controller.abort();
  },[api,capability,selected,revision]);
  useEffect(()=>{const onPop=()=>{if(!draft)setSelected(new URLSearchParams(location.search).get('id')||new URLSearchParams(location.search).get('term')||'');};window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop);},[draft]);
  if(capability?.enabled===false)return legacyFallback;
  function choose(id){
    if(busy)return;
    if(draft){if(!window.confirm(draft.uncertain?'前次保存回执尚未确认。切换前应先核对记录；仍要丢弃原输入并切换？':'放弃当前尚未提交内容后切换词条？'))return;setDraft(null);}
    setSelected(id);setNotice('');setError(null);
    const params=new URLSearchParams(location.search);id?params.set('id',id):params.delete('id');onQueryChange?.(location.pathname+(params.size?'?'+params:''),false);
  }
  function start(action,challenge=null){
    if(draft||writeLock.current)return;
    const create=action==='create_term',edit=editActions.has(action);
    setError(null);setNotice('');
    setDraft({mode:'terminology-governance',owner,action,term_id:create?null:termId(detail),challenge_id:challenge?.challenge_id||challenge?.id||null,expected_revision:detail?.revision_no,expected_challenge_revision:challenge?.revision_no,request_id:crypto.randomUUID(),values:create?termValues():edit?{...termValues(detail),reason:''}:{reason:'',effective_from:'',effective_to:'',scope:'',target_term_id:'',assignee_person_id:'',affected_department_ids:'',conclusion_key:'',verified:false,finalize:false,confirm_same_concept:false,confirm_legacy_context:false},dirty:true,uncertain:false});
  }
  function patch(key,value){if(!sameDraft||writeLock.current)return;setDraft(updateEditableDraft(draft,{values:{...draft.values,[key]:value}},crypto.randomUUID()));setError(null);}
  function startImpact(row){
    if(draft||writeLock.current||!row.impact_allowed)return;
    setError(null);setNotice('');setDraft({mode:'terminology-governance',owner,action:'usage_impact',term_id:termId(detail),expected_revision:detail.revision_no,impact_target:{target_type:row.target_type,target_id:String(row.target_id),source_digest:row.source_digest,expected_revision:row.revision_no},request_id:crypto.randomUUID(),values:{reason:'',decision:''},dirty:true,uncertain:false});
  }
  function allowedDraft(){
    if(!sameDraft)return false;
    if(draft.action==='create_term')return actionsOf(capability).includes('create_term');
    if(draft.term_id!==termId(detail))return false;
    if(draft.action==='usage_impact')return Boolean(usageImpact?.items?.find(row=>row.target_type===draft.impact_target.target_type&&String(row.target_id)===draft.impact_target.target_id)?.impact_allowed);
    if(draft.challenge_id){const challenge=challenges.find(row=>String(row.challenge_id||row.id)===String(draft.challenge_id));return actionsOf(challenge).includes(draft.action);}
    return actionsOf(detail).includes(draft.action);
  }
  function requestForDraft(){
    const body={request_id:draft.request_id,...(draft.term_id?{expected_revision:draft.expected_revision}:{})};
    if(draft.action==='usage_impact'){
      if(!Object.hasOwn(impactDecisionLabels,draft.values.decision)||!draft.values.reason.trim())throw new Error('请明确选择影响处置并填写与责任方核对的依据。');
      return {url:terminologyRoot+'/usages/impacts',method:'POST',body:{...draft.impact_target,request_id:draft.request_id,term_id:draft.term_id,decision:draft.values.decision,reason:draft.values.reason.trim()}};
    }
    if(draft.action==='create_term'||editActions.has(draft.action)){const {concept_key:ignoredConcept,...values}=draft.values;return {url:terminologyRoot+'/terms'+(draft.term_id?'/'+draft.term_id:''),method:draft.term_id?'PUT':'POST',body:{...body,...values}};}
    if(['challenge','create_challenge'].includes(draft.action))return {url:terminologyRoot+'/terms/'+draft.term_id+'/challenges',method:'POST',body:{...body,reason:draft.values.reason.trim()}};
    const values=draft.values;
    if(!values.reason?.trim())throw new Error('请填写本次办理的原因或依据。');
    const actionBody={...body,action:draft.action,reason:values.reason.trim()};
    if(draft.action==='source_check'){if(!values.verified)throw new Error('请明确确认已核对来源原文、标准号、版本和条款。');actionBody.verified=true;}
    if(draft.action==='suspend'){if(!values.effective_from||!values.scope.trim())throw new Error('暂停必须填写生效日期和适用范围。');Object.assign(actionBody,{effective_from:values.effective_from,effective_to:values.effective_to||null,scope:values.scope.trim()});}
    if(['restore','stop_adoption','source_withdrawn','source_superseded'].includes(draft.action)&&values.effective_from)actionBody.effective_from=values.effective_from;
    if(draft.action==='merge'){if(!values.target_term_id||!values.confirm_same_concept)throw new Error('请选择保留词条并明确确认同一语境、同义及同一概念。');actionBody.target_term_id=values.target_term_id;actionBody.confirm_same_concept=true;if(detail?.legacy_unverified&&!detail.context){if(values.confirm_legacy_context!==true)throw new Error('历史条目没有已确认语境，请按实际核实依据明确确认与保留词条为同一语境。');actionBody.confirm_legacy_context=true;}}
    if(draft.action==='assign'){if(!values.assignee_person_id)throw new Error('请填写明确分派的核对人员编号。');actionBody.assignee_person_id=values.assignee_person_id;}
    if(draft.action==='coordinate'){
      actionBody.affected_department_ids=values.affected_department_ids.split(/[，,\s]+/).map(value=>value.trim()).filter(Boolean);
      if(values.finalize)actionBody.finalize=true;
    }
    if(['department_opinion','decide'].includes(draft.action)){if(!values.conclusion_key.trim())throw new Error('请填写本次明确确认的结论内容。');actionBody.conclusion_key=values.conclusion_key.trim();}
    if(draft.challenge_id)actionBody.expected_challenge_revision=draft.expected_challenge_revision;
    return {url:terminologyRoot+'/terms/'+draft.term_id+(draft.challenge_id?'/challenges/'+draft.challenge_id:'')+'/actions',method:'POST',body:actionBody};
  }
  async function submit(event,reconcile=false){
    event.preventDefault();if(!sameDraft||writeLock.current||!allowedDraft()||draft.uncertain&&!reconcile)return;
    let submitted=draft.submitted;
    try{if(!reconcile)submitted=requestForDraft();if(!submitted)throw new Error('缺少原请求，请先查阅词条与办理历史。');}catch(e){setError(e);return;}
    if(reconcile&&!window.confirm('使用保留的原请求编号和原内容核对结果？若此前未提交，本次可能完成原操作；不会按新内容重建请求。'))return;
    const current=generation.current,termAtStart=selectedRef.current;writeLock.current=true;setBusy(true);setError(null);setDraft({...draft,submitted,uncertain:true});
    try{
      const result=await api.request(submitted.url,{method:submitted.method,body:submitted.body});
      if(mounted.current&&generation.current===current&&selectedRef.current===termAtStart){setDraft(null);setNotice('本次术语办理已保存，请核对当前状态及留痕。');if(!selected&&termId(result))setSelected(termId(result));setRevision(value=>value+1);}
    }catch(e){if(mounted.current&&generation.current===current){setError(e);setDraft(retainWriteFailure(draft,e,submitted));}}
    finally{writeLock.current=false;if(mounted.current)setBusy(false);}
  }
  async function refreshBasis(){
    if(!sameDraft||draft.uncertain||writeLock.current||!draft.term_id)return;
    const current=generation.current;writeLock.current=true;setBusy(true);setError(null);
    try{
      const [latest,issues,impact]=await Promise.all([api.request(terminologyRoot+'/terms/'+draft.term_id),api.request(terminologyRoot+'/terms/'+draft.term_id+'/challenges'),...(draft.action==='usage_impact'?[api.request(terminologyRoot+'/terms/'+draft.term_id+'/usages')]:[Promise.resolve(null)])]);
      if(mounted.current&&generation.current===current){setDetail(latest);setChallenges(issues.items||[]);const challenge=(issues.items||[]).find(row=>String(row.challenge_id||row.id)===String(draft.challenge_id)),target=impact?.items?.find(row=>row.target_type===draft.impact_target?.target_type&&String(row.target_id)===draft.impact_target?.target_id);if(impact)setUsageImpact(impact);setDraft({...draft,expected_revision:latest.revision_no,expected_challenge_revision:challenge?.revision_no,...(target?{impact_target:{...draft.impact_target,source_digest:target.source_digest,expected_revision:target.revision_no}}:{}),request_id:crypto.randomUUID(),conflict:false});setNotice('最新修订已读取，表单输入保留。请核对定义、来源与本次动作后再次提交。');}
    }catch(e){if(mounted.current&&generation.current===current)setError(e);}finally{writeLock.current=false;if(mounted.current)setBusy(false);}
  }
  async function loadImpact(){
    if(!detail||impactBusy)return;
    const current=generation.current;setImpactBusy(true);setError(null);
    try{const result=await api.request(terminologyRoot+'/terms/'+encodeURIComponent(termId(detail))+'/usages');if(mounted.current&&generation.current===current)setUsageImpact(result);}catch(e){if(mounted.current&&generation.current===current)setError(e);}finally{if(mounted.current&&generation.current===current)setImpactBusy(false);}
  }
  function cancel(){if(!busy&&window.confirm(draft?.uncertain?'保存结果尚未确认。应先核对词条和原请求，仍要丢弃输入？':'放弃当前尚未提交的术语办理内容？')){setDraft(null);setError(null);}}
  const list=(catalog?.items||[]).filter(row=>filter==='all'||filter==='usable'&&row.usable||filter==='participating'&&!row.usable);
  const versions=detail?.versions||[],historical=versions.find(row=>String(row.version_id)===historyId);
  const actionButtons=record=>actionsOf(record).filter(action=>Object.hasOwn(termActionLabels,action)||editActions.has(action)).map(action=><button type="button" key={action} disabled={Boolean(draft)||busy} onClick={()=>start(action)}>{editActions.has(action)?'修订提报':termActionLabels[action]}</button>);
  return <div className="terminology-workspace identity-module" data-terminology-governance>
    <section className="card"><div className="term-section-title"><div><h2>公司术语词典</h2><p>按定义、适用条件与业务语境查阅同一概念。已生效词条及其历史定义供登录人员查阅，提报与内部办理按当前资格开放。</p></div><div className="term-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setRevision(value=>value+1)}>刷新词典</button>{!draft&&actionsOf(capability).includes('create_term')&&<button type="button" onClick={()=>start('create_term')}>提报新术语</button>}</div></div>
      {!capability&&!error&&<StatusPanel kind="loading" title="正在核对术语词典使用资格…"/>}{capability?.ready===false&&<StatusPanel kind="error" title="术语治理暂未就绪">当前不能读取或办理新词典，请联系维护人员核对服务状态。</StatusPanel>}
    </section>
    {error&&<StatusPanel kind="error" title="术语读取或办理未完成">{exactFailure(error)}</StatusPanel>}{notice&&<StatusPanel title={notice}/>}
    <div className="term-workspace-columns">
      <section className="card term-catalog"><h3>可见词条</h3><label className="term-field">查询名称 / 语境<input value={search} onChange={event=>setSearch(event.target.value)} maxLength={255}/></label><label className="term-field">查看范围<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="usable">当前可引用</option><option value="all">全部可见记录及历史</option><option value="participating">待办理 / 已退出引用</option></select></label>
        {!catalog&&capability?.enabled&&capability.ready!==false&&<p>正在读取词条…</p>}<ul className="term-catalog-list">{list.map(row=><li key={termId(row)}><button type="button" aria-current={selected===termId(row)?'true':undefined} disabled={busy} onClick={()=>choose(termId(row))}><strong>{row.term}</strong><span>{row.context||'语境待核'}</span><span>{row.usable?'可引用':displayState(row.draft_status||row.adoption_status)}{row.suspended?' · 已暂停':''}{row.legacy_unverified?' · 历史沿用，依据待核':''}</span></button></li>)}</ul>{catalog&&!list.length&&<p>当前范围没有可见词条。</p>}
      </section>
      <div className="term-detail-column">
        {!selected&&!sameDraft&&<section className="card"><h3>选择一个词条</h3><p>同名词语可有不同业务语境。请结合定义、来源及公司适用说明选择词条。</p></section>}
        {selected&&!detail&&!error&&capability?.ready!==false&&<section className="card"><p>正在读取所选词条及办理记录…</p></section>}
        {detail&&<section className="card" data-term-governance-detail={termId(detail)}><div className="term-section-title"><h3>{detail.term} · {termStateLabel(detail)}</h3></div>
          {detail.legacy_unverified&&<p className="term-callout">历史沿用、依据待核。原定义与原状态保留，不据此补造来源、审批或适用语境。</p>}
          {detail.suspended&&<p className="term-callout">当前暂停使用。暂停范围：{text(detail.suspension?.scope||detail.scope)}；日期：{text(detail.suspension?.effective_from)}；原因：{text(detail.suspension?.reason)}。</p>}
          {detail.source_status==='withdrawn'&&<p className="term-callout">来源已废止。{detail.source_kind==='gb'?'本条已退出新引用范围。':'公司采纳状态与来源状态分别记录，请按当前可用性核对。'}</p>}
          {detail.source_status==='superseded'&&<p className="term-callout">来源已被替代。公司采用状态与来源状态分别记录，请核对当前可用性及组长的采用决定。</p>}
          {detail.merged_into_id&&<p className="term-callout">此同义条目已合并，保留原定义和历史；新引用请核对保留词条 {businessName(detail)}。</p>}
          <DefinitionView value={detail} heading={termDefinitionHeading(detail)}/>
          {detail.pending_version&&<details className="term-history"><summary>查看待确认提报内容</summary><DefinitionView value={detail.pending_version} heading="待确认内容"/></details>}
          <div className="term-actions">{actionButtons(detail)}</div>
          <div className="term-history"><div className="term-section-title"><h4>引用影响清单</h4><button type="button" className="secondary" disabled={impactBusy} onClick={loadImpact}>{impactBusy?'正在读取…':'查看当前有权读取的引用'}</button></div>{usageImpact&&!usageImpact.items?.length&&<p>当前有权读取的材料中没有本词条的固定引用。</p>}{usageImpact?.items?.length>0&&<ul className="term-impact-list">{usageImpact.items.map(row=><li key={row.target_type+':'+row.target_id}>
            <a href={'/app/terms?'+new URLSearchParams({target_type:row.target_type,target_id:String(row.target_id)})}>{({process_draft:'流程草稿',process_version:'流程正式版本',data_definition:'数据定义版本',work_package:'数据治理工作包',handoff_revision:'数据交接修订'})[row.target_type]||'相关材料'} · {businessName(row)}</a><span> · 引用 · {row.fixed?'已固定历史引用':'可修订材料，变化后须重核'}</span>
            {(row.items||[]).map((item,index)=><p key={index}>{item.location} · 定义 {businessName(item)} · {item.reason}</p>)}
            {(row.impact_decisions||[]).map((decision,index)=><p key={decision.event_id||index}>已记录处置：{impactDecisionLabels[decision.decision]||businessStatus(decision.decision,'处置方式待核对')} · {decision.reason} · {decision.created_at||'时间未记录'}</p>)}
            {row.impact_allowed&&<button type="button" className="secondary" disabled={Boolean(draft)||busy} onClick={()=>startImpact(row)}>记录该引用的影响处置</button>}
          </li>)}</ul>}</div>
          <details className="term-history"><summary>历史定义与办理留痕</summary><label className="term-field">查阅固定历史定义<select value={historyId} onChange={event=>setHistoryId(event.target.value)}><option value="">请选择历史定义版本</option>{versions.map(row=><option key={row.version_id} value={row.version_id}>定义 {businessName(row)} · {row.created_at||'时间未记录'}</option>)}</select></label>{historical&&<DefinitionView value={historical} heading="历史原定义"/>}<ol className="term-event-list">{(detail.events||[]).map((row,index)=><li key={row.event_id||row.id||index}><strong>{termActionLabels[row.action||row.event_type]||displayState(row.action||row.event_type)}</strong><span>{row.created_at||'时间未记录'} · {actor(row)}</span><p>{row.reason||row.basis||'未记录原因'}</p>{row.conclusion?.conclusion_key&&<p>最终结论：{text(row.conclusion.conclusion_key)}；{row.conclusion.reason||row.conclusion.closure_reason}</p>}</li>)}</ol>{!detail.events?.length&&<p>当前没有可读取的内部办理记录。</p>}</details>
        </section>}
        {detail&&<section className="card"><h3>质疑与协调</h3><p>质疑会保留原定义和当前采用状态；相关部门分别确认意见，反馈后可结案，不以提出人同意为前提。提出人可指出尚未回应的问题或补充依据申请复核。</p>
          {challenges.length===0&&<p>当前没有可读取的质疑记录。</p>}
          {challenges.map(challenge=><article className="term-challenge" key={'需要核对的词条问题'}>
            <h4>质疑处理 · {displayState(challenge.status)}</h4><p>{challenge.reason}</p>
            {challenge.affected_department_ids?.length>0&&<p>受影响部门：{(challenge.affected_department_names||[]).join('、')||'部门名称未记录'}</p>}
            {challenge.opinions?.length>0&&<div><h4>各部门已确认意见</h4><ul>{challenge.opinions.map((opinion,index)=><li key={opinion.opinion_id||index}>部门 {text(opinion.department_name||'历史部门名称未记录')} · 确认人员 {text(opinion.actor_name||'历史确认人姓名未记录')} · 结论 {text(opinion.conclusion_key)}<p>{opinion.reason}</p></li>)}</ul></div>}
            {challenge.conclusion&&<p>处理结论：{text(typeof challenge.conclusion==='string'?challenge.conclusion:challenge.conclusion.reason||challenge.conclusion.conclusion_key)}</p>}
            {challenge.feedback&&<p>反馈：{typeof challenge.feedback==='string'?challenge.feedback:challenge.feedback.reason}</p>}
            <div className="term-actions">{actionsOf(challenge).filter(action=>termActionLabels[action]).map(action=><button type="button" key={action} disabled={Boolean(draft)||busy} onClick={()=>start(action,challenge)}>{termActionLabels[action]}</button>)}</div>
            {challenge.events?.length>0&&<details><summary>查看本质疑办理记录</summary><ol className="term-event-list">{challenge.events.map((event,index)=><li key={event.id||index}>{termActionLabels[event.action||event.event_type]||displayState(event.action||event.event_type)} · {event.created_at||'时间未记录'}<p>{event.reason||'依据未记录'}</p></li>)}</ol></details>}
          </article>)}
        </section>}
        {editing&&!sameDraft&&<StatusPanel kind="error" title="其他身份的术语输入仍保留">当前身份不能提交或重新绑定原输入。请回到原身份核对，或明确丢弃原输入后办理。</StatusPanel>}
        {sameDraft&&<section className="card term-editor"><h3>{editActions.has(draft.action)?'修订提报':termActionLabels[draft.action]}</h3><p>填写的内容保留在当前页面，保存时会核对办理资格及词条是否发生变化。刷新列表不提交输入。</p>
          {draft.uncertain&&<StatusPanel kind="error" title="办理结果尚未确认">原请求编号和提交内容已保留，当前停止修改及普通重复提交。请先核对词条与历史；需要时明确使用原请求核对结果。</StatusPanel>}
          {draft.conflict&&<StatusPanel kind="error" title="内容或修订冲突，原输入保留">可修正具体输入后再次提交。若词条修订已变化，请先读取最新修订并核对当前定义。{draft.term_id&&<button type="button" disabled={busy} onClick={refreshBasis}>读取最新修订并保留输入</button>}</StatusPanel>}
          {!allowedDraft()&&<StatusPanel kind="error" title="当前动作资格尚未核实">原输入保留，当前不能提交。请刷新词条核对当前允许动作。</StatusPanel>}
          <form onSubmit={submit}><fieldset disabled={busy||draft.uncertain}><legend>本次办理内容</legend>
            {draft.action==='create_term'||editActions.has(draft.action)?<><div className="term-form-grid">{fieldSpecs.map(([key,label,max],index)=><label key={key} className={'term-field'+(['definition','company_application','context'].includes(key)?' term-field-wide':'')}>{label}{['term','context','definition','concept_key'].includes(key)?' *':''}{['definition','company_application','context'].includes(key)?<textarea aria-label={label+(["term","context","definition"].includes(key)?" *":"")} ref={index===0?firstInput:undefined} required={['context','definition'].includes(key)} readOnly={key==='context'&&editActions.has(draft.action)} rows={key==='definition'?4:3} maxLength={max} value={draft.values[key]} onChange={event=>patch(key,event.target.value)}/>:<input aria-label={label+(["term","context","definition"].includes(key)?" *":"")} ref={index===0?firstInput:undefined} required={['term','concept_key'].includes(key)} readOnly={key==='concept_key'&&editActions.has(draft.action)} maxLength={max} value={draft.values[key]} onChange={event=>patch(key,event.target.value)}/>}</label>)}<label className="term-field">来源类别<select aria-label="来源类别" value={draft.values.source_kind} onChange={event=>patch('source_kind',event.target.value)}>{Object.entries(sourceKindLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
              <div className="term-callout">{draft.values.source_kind==='gb'?'GB 经部门确认与来源核对后按规则生效。采用定义须与标准原定义一致，公司差异另填适用说明。':draft.values.source_kind==='gbt'?'GB/T 来源核对后由 MDM 工作组组长确认采纳；不予采纳即结束。采用定义须与标准原定义一致。':draft.values.source_kind==='gbz'?'GB/Z 仅作为来源资料记录，不能通过国标采用；如需采用相同词语，请明确按自定义另行提报。':'自定义术语须明确语境，由部门确认适用范围、MDM 核对后交组长决定。'}{editActions.has(draft.action)&&' 原概念与语境保持不变；需要其他语境时另行提报。'}</div>
              {draft.values.source_kind!=='custom'&&<div className="term-form-grid">{[['standard_number','标准号'],['standard_version','标准版本'],['standard_clause','标准条款']].map(([key,label])=><label className="term-field" key={key}>{label}<input required value={draft.values[key]} maxLength={255} onChange={event=>patch(key,event.target.value)}/></label>)}<label className="term-field term-field-wide">标准原定义<textarea aria-label="标准原定义" required rows={4} maxLength={10000} value={draft.values.original_definition} onChange={event=>patch('original_definition',event.target.value)}/></label></div>}
              {editActions.has(draft.action)&&<label className="term-field">修订原因 *<textarea aria-label="修订原因 *" required rows={3} maxLength={4000} value={draft.values.reason||''} onChange={event=>patch('reason',event.target.value)}/></label>}
            </>:<>
              <label className="term-field">原因 / 判断依据<textarea ref={firstInput} required maxLength={4000} rows={3} value={draft.values.reason} onChange={event=>patch('reason',event.target.value)}/></label>
              {draft.action==='usage_impact'&&<><p className="term-callout">请与责任方核对受影响内容后明确处置。记录仅追加留痕，保留原固定引用及历史版本；需要后续任务时另行明确分派。</p><label className="term-field">引用影响处置<select aria-label="引用影响处置" required value={draft.values.decision} onChange={event=>patch('decision',event.target.value)}><option value="">请选择本次明确决定</option>{Object.entries(impactDecisionLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label></>}
              {draft.action==='source_check'&&<label className="term-checkbox"><input type="checkbox" checked={draft.values.verified} onChange={event=>patch('verified',event.target.checked)}/>已逐项核对来源原文、来源类别、标准号、版本、条款及公司适用说明</label>}
              {draft.action==='suspend'&&<div className="term-form-grid"><label className="term-field">暂停生效日期<input type="date" required value={draft.values.effective_from} onChange={event=>patch('effective_from',event.target.value)}/></label><label className="term-field">预计结束日期（可不填）<input type="date" value={draft.values.effective_to} min={draft.values.effective_from} onChange={event=>patch('effective_to',event.target.value)}/></label><label className="term-field term-field-wide">暂停范围<textarea required rows={2} maxLength={4000} value={draft.values.scope} onChange={event=>patch('scope',event.target.value)}/></label></div>}
              {['restore','stop_adoption','source_withdrawn','source_superseded'].includes(draft.action)&&<label className="term-field">本次生效日期<input type="date" required={['restore','source_withdrawn','source_superseded'].includes(draft.action)} value={draft.values.effective_from} onChange={event=>patch('effective_from',event.target.value)}/></label>}
              {draft.action==='merge'&&<><label className="term-field">合并后保留的词条<select aria-label="合并后保留的词条" required value={draft.values.target_term_id} onChange={event=>patch('target_term_id',event.target.value)}><option value="">请明确选择保留条目</option>{(catalog?.items||[]).filter(row=>row.usable&&termId(row)!==termId(detail)).map(row=><option key={termId(row)} value={termId(row)}>{row.term} · {row.context}</option>)}</select><span>请先核对两个条目的定义与语境，确认属于同一概念。合并保留历史，不自动合并数据对象。</span></label><label className="term-checkbox"><input type="checkbox" required checked={draft.values.confirm_same_concept} onChange={event=>patch('confirm_same_concept',event.target.checked)}/>本人已确认两个条目属于同一语境、同义及同一概念</label>{detail?.legacy_unverified&&!detail.context&&<label className="term-checkbox"><input type="checkbox" required checked={draft.values.confirm_legacy_context||false} onChange={event=>patch("confirm_legacy_context",event.target.checked)}/>已按本次核实依据确认历史条目与保留词条为同一语境，未按同名推断；具体依据记录在办理原因中</label>}</>}
              {draft.action==='assign'&&<BusinessDirectoryPicker api={api} label="来源核对人员" people required value={draft.values.assignee_person_id} onChange={value=>patch('assignee_person_id',value)}/>}
              {draft.action==='coordinate'&&<><BusinessDirectoryPicker api={api} label="受影响部门" multiple value={String(draft.values.affected_department_ids||'').split(',').filter(Boolean)} onChange={values=>patch('affected_department_ids',values.join(','))}/><label className="term-checkbox"><input type="checkbox" disabled={!challenges.some(c=>c.challenge_id===draft.challenge_id&&c.can_finalize_coordination)} checked={draft.values.finalize} onChange={event=>patch('finalize',event.target.checked)}/>由MDM组长按各部门已确认意见，最终确认一致结论</label></>}
              {['department_opinion','decide'].includes(draft.action)&&<label className="term-field">本次确认的结论内容<input aria-label="本次确认的结论内容" required maxLength={255} value={draft.values.conclusion_key} onChange={event=>patch('conclusion_key',event.target.value)}/><span>相关部门分别确认同一明确结论，不能由界面代选意见。</span></label>}
              {draft.action==='restore'&&<p className="term-callout">恢复只解除暂停，不能代替采纳、撤销不予采纳或恢复已经失效的来源。</p>}
              {draft.action==='not_adopt'&&<p className="term-callout">本次不予采纳后结束该次办理，不自动建立待办。</p>}
            </>}
            <div className="term-actions"><button type="submit" disabled={!allowedDraft()}>确认提交</button><button type="button" className="secondary" onClick={cancel}>取消本次办理</button></div>
          </fieldset>{draft.uncertain&&<div className="term-actions"><button type="button" disabled={busy||!allowedDraft()} onClick={event=>submit(event,true)}>按原请求核对结果</button><button type="button" className="secondary" disabled={busy} onClick={cancel}>丢弃本次输入</button></div>}</form>
        </section>}
      </div>
    </div>
  </div>;
}
