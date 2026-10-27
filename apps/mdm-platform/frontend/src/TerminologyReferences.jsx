import {businessName,businessText,userMessage} from "./businessPresentation.js";
import React, {useEffect,useRef,useState} from 'react';
import {StatusPanel,useInputProtection} from './components.jsx';
import {actionsOf,canEditReferences,decisionLabels,displayState,ownerKey,publicTerm,referenceFailure,referenceItems,referenceLocation,referencePayload,referencePositions,referenceSourceText,referenceSubjectKey,referenceSubjectPresentation,retainWriteFailure,terminologyRoot,updateEditableDraft} from './terminologyGovernanceModel.js';
import './terminology-governance.css';

const findings = data => Array.isArray(data?.findings) ? data.findings : [];
const versionsOf = row => {
  return row?.usable&&row?.version_id?[row]:[];
};

export function TerminologyReferences({api,subject,subjectName='',refreshKey,user,draft:externalDraft,setDraft:externalSetDraft}) {
  const [localDraft,setLocalDraft]=useState(null),draft=externalSetDraft?externalDraft:localDraft,setDraft=externalSetDraft||setLocalDraft;
  const [data,setData]=useState(null),[terms,setTerms]=useState([]),[termDetails,setTermDetails]=useState({}),[error,setError]=useState(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[search,setSearch]=useState('');
  const mounted=useRef(false),generation=useRef(0),writeLock=useRef(false),lookupGeneration=useRef(0),writeScope=useRef(''),guard=useInputProtection(),guardId=useRef(Symbol('terminology-references'));
  const key=referenceSubjectKey(subject),owner=ownerKey(user),editing=draft?.mode==='terminology-references';
  writeScope.current=key+'|'+owner;
  const sameDraft=editing&&draft.subject_key===key&&(!draft.owner||draft.owner===owner);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current+=1;lookupGeneration.current+=1;};},[]);
  useEffect(()=>{guard?.update(guardId.current,Boolean(editing));return()=>guard?.update(guardId.current,false);},[guard,editing]);
  useEffect(()=>{
    const controller=new AbortController(),current=++generation.current;setData(null);setError(null);
    if(!subject?.target_type||!subject?.target_id)return()=>controller.abort();
    const params=new URLSearchParams({target_type:subject.target_type,target_id:String(subject.target_id)});
    api.request(terminologyRoot+'/usages?'+params,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted&&generation.current===current)setData(value);}).catch(e=>{if(!controller.signal.aborted&&generation.current===current)setError(e);});
    return()=>controller.abort();
  },[api,key,subject?.source_digest,revision,refreshKey]);
  useEffect(()=>{
    if(!data?.enabled||!sameDraft)return;
    const controller=new AbortController(),current=++lookupGeneration.current;
    api.request(terminologyRoot+'/terms?'+new URLSearchParams({q:search,usable:'true'}),{signal:controller.signal}).then(result=>{if(!controller.signal.aborted&&current===lookupGeneration.current)setTerms((result.items||result||[]).map(publicTerm).filter(row=>row.usable));}).catch(e=>{if(!controller.signal.aborted&&current===lookupGeneration.current)setError(e);});
    return()=>controller.abort();
  },[api,data?.enabled,sameDraft,search]);
  if(!subject?.target_type||!subject?.target_id)return null;
  if(data?.enabled===false)return null;
  function begin(){
    if(draft||writeLock.current||!canEditReferences(data))return;
    setNotice('');setError(null);
    setDraft({mode:'terminology-references',subject_key:key,owner,source_digest:data.source_digest||subject.source_digest,expected_revision:data.revision_no??0,request_id:crypto.randomUUID(),items:referenceItems(data),reason:data.reason||'',dirty:true,uncertain:false});
  }
  function patch(values){if(!sameDraft||writeLock.current)return;setDraft(updateEditableDraft(draft,values,crypto.randomUUID()));setError(null);}
  function patchItem(index,values){patch({items:draft.items.map((item,i)=>i===index?{...item,...values}:item)});}
  function addPosition(location){
    const position=referencePositions(data).find(item=>item.location===location);
    if(position)patch({items:[...draft.items,{location:position.location,source_text:position.source_text,decision:'',term_id:'',version_id:'',reason:''}]});
  }
  async function selectTerm(index,id){
    patchItem(index,{term_id:id,version_id:'',usage_token:undefined});
    if(!id)return;
    const current=generation.current,subjectAtStart=key;
    try{const result=await api.request(terminologyRoot+'/terms/'+encodeURIComponent(id));if(mounted.current&&generation.current===current&&subjectAtStart===key)setTermDetails(values=>({...values,[id]:result}));}catch(e){if(mounted.current&&generation.current===current)setError(e);}
  }
  async function save(event,reconcile=false){
    event.preventDefault();if(!sameDraft||writeLock.current||(draft.action==='department_confirm'?!actionsOf(data).includes('department_confirm'):!canEditReferences(data))||draft.uncertain&&!reconcile)return;
    let submitted=draft.submitted;
    try{if(!reconcile)submitted=draft.action==='department_confirm'?{url:terminologyRoot+'/usages/actions',method:'POST',body:{target_type:subject.target_type,target_id:String(subject.target_id),source_digest:draft.source_digest,request_id:draft.request_id,expected_revision:draft.expected_revision,action:'department_confirm'}}:{url:terminologyRoot+'/usages',method:'POST',body:referencePayload(subject,draft)};if(!submitted)throw new Error('原请求不存在，请先核对已保存记录。');}catch(e){setError(e);return;}
    if(reconcile&&!window.confirm('使用保留的原请求编号和原内容核对？若此前未提交成功，本次可能完成保存；不会生成新请求或改写历史固定引用。'))return;
    // A read-only refresh must not discard a write receipt for the same source
    // and owner. A change of source or owner still keeps that receipt isolated.
    const currentScope=writeScope.current;writeLock.current=true;setBusy(true);setError(null);setDraft({...draft,submitted,uncertain:true});
    try{
      await api.request(submitted.url,{method:submitted.method,body:submitted.body});
      if(mounted.current&&writeScope.current===currentScope){setDraft(null);setNotice(draft.action==='department_confirm'?'本部门负责人对本份材料的术语核对已确认。请查看当前核对结果，再回到原办理步骤继续；本次确认不会自动提交或发布流程。':'本份材料的人工术语判断已保存。请查看当前核对结果；需要负责人确认时，交由本部门当前负责人本人办理。');setRevision(value=>value+1);}
    }catch(e){if(mounted.current&&writeScope.current===currentScope){setError(e);setDraft(retainWriteFailure(draft,e,submitted));}}
    finally{writeLock.current=false;if(mounted.current)setBusy(false);}
  }
  async function refreshBasis(){
    if(!sameDraft||draft.uncertain||writeLock.current)return;
    const current=generation.current;setBusy(true);setError(null);writeLock.current=true;
    try{
      const latest=await api.request(terminologyRoot+'/usages?'+new URLSearchParams({target_type:subject.target_type,target_id:String(subject.target_id)}));
      if(mounted.current&&generation.current===current){setData(latest);setDraft({...draft,expected_revision:latest.revision_no??0,source_digest:latest.source_digest||subject.source_digest,request_id:crypto.randomUUID(),conflict:false});setNotice('最新核对基线已读取，当前逐条输入保留。来源变化时须逐条核对原文和位置后保存。');}
    }catch(e){if(mounted.current&&generation.current===current)setError(e);}finally{writeLock.current=false;if(mounted.current)setBusy(false);}
  }
  function cancel(){if(!busy&&window.confirm(draft?.uncertain?'保存回执尚未确认。放弃输入前应先核对原请求和记录，仍要丢弃此输入？':'放弃尚未保存的术语引用判断？')){setDraft(null);setError(null);}}
  const positions=referencePositions(data),savedItems=referenceItems(data),presentation=referenceSubjectPresentation(subject,subjectName),failure=error?referenceFailure(error,{reading:!data}):null;
  return <section className="card terminology-references" data-terminology-references={key}>
    <div className="term-section-title"><div><h3 tabIndex={-1}>{presentation.title}</h3><p>{presentation.description}</p><p>本处刷新只重新读取这份材料的已保存记录，不会保存当前输入，也不会代为提交或确认。原文需要修改时，请回到该材料的编制入口。</p></div><button type="button" className="secondary" disabled={busy} onClick={()=>setRevision(value=>value+1)}>{presentation.refresh}</button></div>
    {failure&&<StatusPanel kind="error" title={failure.title}>{failure.message}</StatusPanel>}
    {notice&&<StatusPanel title={notice}/>}
    {!data&&!error&&<StatusPanel kind="loading" title="正在读取术语引用及来源位置…"/>}
    {data&&<>
      {data.fixed&&<p className="term-callout">{subject.target_type==='data_definition'?'当前为固定数据定义版本，术语引用只读。是否经过审核发布以该定义版本的治理状态为准；历史引用保持原样。':'当前为正式版本固定引用，只读查阅原定义与原判断。后续词典变化由影响检查提示，历史引用保持原样。'}</p>}
      {findings(data).length>0&&<ul className="term-findings">{findings(data).map((finding,index)=><li key={(finding.code||'finding')+index}><strong>{finding.blocking||finding.severity==='block'||['SUBSTANTIVE_CONFLICT','CANONICAL_NAME_REQUIRED'].includes(finding.code)?'须先处理：':finding.stale||finding.code==='TERM_CHANGED'||finding.code==='SOURCE_CHANGED'?'需重新核对：':''}</strong>{userMessage(finding.message||finding.reason,'此项引用需要重新核对，请查看相关词条及适用条件。')}{finding.location&&<span>（{referenceLocation(data,finding)}）</span>}</li>)}</ul>}
      {!savedItems.length&&!sameDraft&&<p>{data.fixed?'该固定版本未记录逐条术语引用判断，历史记录保持原样。':data.reason?'已保存整体核对说明，当前未登记逐条术语引用。':'尚未保存人工术语引用判断。无适用词条时，可以记录已确认的业务含义及依据。'}</p>}
      {!sameDraft&&savedItems.length>0&&<div className="term-reference-list">{savedItems.map((item,index)=><article key={item.location||index}><h4>{referenceLocation(data,item)}</h4><p className="term-original">{referenceSourceText(item)}</p><p>{decisionLabels[item.decision]||'原判断方式待核对'} · {item.term_id?'已明确引用词条及当时定义':'未选择适用词条'}</p><p>判断依据：{businessText(item.reason||'未记录')}</p>{item.term_snapshot&&<details><summary>查看引用时的固定定义与来源</summary><p>{businessText(item.term_snapshot.term)} · {businessText(item.term_snapshot.context||'原语境未记录')}</p><p className="term-original">采用定义：{businessText(item.term_snapshot.definition)}</p><p>标准号 / 版本 / 条款：{businessText([item.term_snapshot.source?.standard_number,item.term_snapshot.source?.standard_version,item.term_snapshot.source?.standard_clause].filter(Boolean).join(' / ')||'原记录未登记')}</p><p className="term-original">标准原定义：{businessText(item.term_snapshot.source?.original_definition||'原记录未登记')}</p><p className="term-original">公司适用说明：{businessText(item.term_snapshot.source?.company_application||'原记录未登记')}</p></details>}</article>)}</div>}
      {data.reason&&<p>整体核对说明：{businessText(data.reason)}</p>}
      {data.department_confirmed&&<p className="term-callout">已保留负责人对本次核对的确认记录。{findings(data).length>0&&'当前仍有待重新核对项，该记录不能代替重新核对或确认。'}</p>}
      {!draft&&<div className="term-actions">{canEditReferences(data)&&<button type="button" onClick={begin}>记录术语引用判断</button>}{!data.fixed&&actionsOf(data).includes('department_confirm')&&<button type="button" onClick={()=>setDraft({mode:'terminology-references',action:'department_confirm',subject_key:key,owner,source_digest:data.source_digest||subject.source_digest,expected_revision:data.revision_no??0,request_id:crypto.randomUUID(),items:referenceItems(data),reason:data.reason||'',dirty:true,uncertain:false})}>本人确认本部门引用核对</button>}</div>}
      {editing&&!sameDraft&&<StatusPanel kind="error" title="其他来源的引用输入仍保留">当前不能将原输入套用到本来源。请回原来源处理输入，或明确丢弃后重新核对。</StatusPanel>}
      {sameDraft&&<form onSubmit={save}>
        {draft.uncertain&&<StatusPanel kind="error" title="保存结果尚未确认">原请求及输入已保留，当前停止修改和普通重复提交。请先查阅记录；需要时明确使用原请求核对结果。</StatusPanel>}
        {draft.conflict&&<StatusPanel kind="error" title="本次保存被阻止，输入仍保留">请先按上方具体原因处理。需要核对最新已保存内容时，可点击下方按钮；读取不会保存当前判断。逐条核对原文和位置后，再决定是否保存。<button type="button" disabled={busy} onClick={refreshBasis}>读取最新修订并保留输入</button></StatusPanel>}
        <fieldset disabled={busy||draft.uncertain||draft.action==='department_confirm'}><legend>逐条核对来源用词</legend>
          <label className="term-field">查询生效词典<input value={search} onChange={event=>setSearch(event.target.value)} maxLength={255} placeholder="按名称查询可引用的词条"/></label>
          <label className="term-field">加入具体来源位置<select aria-label="加入具体来源位置" value="" onChange={event=>addPosition(event.target.value)}><option value="">请选择本来源中的用词位置</option>{positions.filter(position=>!draft.items.some(item=>item.location===position.location)).map(position=><option key={position.location} value={position.location}>{position.label} · {referenceSourceText(position).slice(0,70)}</option>)}</select></label>
          {draft.items.map((item,index)=>{
            const detail=termDetails[item.term_id],versionOptions=versionsOf(detail),selected=terms.find(row=>row.term_id===item.term_id);
            return <article className="term-reference-editor" key={item.location||index}><div className="term-section-title"><h4>{referenceLocation(data,item)}</h4><button type="button" className="text-button" onClick={()=>patch({items:draft.items.filter((_,i)=>i!==index)})}>移除此位置判断</button></div><p className="term-original">{referenceSourceText(item)}</p>
              <div className="term-form-grid"><label className="term-field">人工核对结果<select aria-label="人工核对结果" required value={item.decision} onChange={event=>patchItem(index,{decision:event.target.value})}><option value="">请选择</option>{Object.entries(decisionLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
              {['match','synonym','conflict'].includes(item.decision)&&<><label className="term-field">生效词条<select aria-label="生效词条" required value={item.term_id} onChange={event=>selectTerm(index,event.target.value)}><option value="">请选择适用语境下的词条</option>{item.term_id&&!selected&&<option value={item.term_id}>已绑定词条 {businessName(item)}（需核对当前可用性）</option>}{terms.map(row=><option key={row.term_id} value={row.term_id}>{businessText(row.term)} · {businessText(row.context||'语境待核')}</option>)}</select></label><label className="term-field">固定定义版本<select aria-label="固定定义版本" required value={item.version_id} onChange={event=>patchItem(index,{version_id:event.target.value,usage_token:detail?.usage_token})}><option value="">请明确选择定义版本</option>{item.version_id&&!versionOptions.some(row=>String(row.version_id)===item.version_id)&&<option value={item.version_id}>原固定版本 {businessName(item)}</option>}{versionOptions.map(row=><option key={row.version_id} value={row.version_id}>定义 {businessName(row)} · {businessText(row.term||detail?.term)} · {displayState(row.adoption_status||detail?.adoption_status)}</option>)}</select></label></>}
              <label className="term-field term-field-wide">判断依据 / 含义说明 / 差异原因<textarea required rows={3} maxLength={4000} value={item.reason} onChange={event=>patchItem(index,{reason:event.target.value})}/></label></div>
              {detail&&<div className="term-definition-preview"><strong>{businessText(detail.term)} · {businessText(detail.context)}</strong><p>{businessText(detail.definition)}</p>{(detail.company_application||detail.source?.company_application)&&<p>公司适用说明：{businessText(detail.company_application||detail.source.company_application)}</p>}</div>}
            </article>;
          })}
          {!positions.length&&<p>当前没有可选择的原文位置，请先核对来源内容及读取资格。</p>}
          <label className="term-field">整体核对说明<textarea rows={2} maxLength={4000} required={!draft.items.length} value={draft.reason||''} onChange={event=>patch({reason:event.target.value})} placeholder="没有需要逐条引用的关键概念时，说明已核对的范围和依据。"/></label>
          {draft.action!=='department_confirm'&&<div className="term-actions"><button type="submit" disabled={!canEditReferences(data)}>保存人工核对结果</button><button type="button" className="secondary" onClick={cancel}>取消本次核对</button></div>}
        </fieldset>
        {draft.action==='department_confirm'&&!draft.uncertain&&<div className="term-actions"><p>请核对以上原文、定义版本与判断依据，本次本人确认当前修订。</p><button type="submit" disabled={busy||!actionsOf(data).includes('department_confirm')}>确认本部门当前引用核对</button><button type="button" className="secondary" disabled={busy} onClick={cancel}>取消确认</button></div>}
        {draft.uncertain&&<div className="term-actions"><button type="button" disabled={busy} onClick={event=>save(event,true)}>按原请求核对结果</button><button type="button" className="secondary" disabled={busy} onClick={cancel}>丢弃本次输入</button></div>}
      </form>}
    </>}
  </section>;
}
