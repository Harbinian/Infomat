import React, {useEffect,useRef,useState} from 'react';
import {StatusPanel,useInputProtection} from './components.jsx';
const root='/api/data-map-definitions';
const valueAt=(obj,path)=>path.split('.').reduce((v,k)=>v?.[k],obj);
const labelStatus=s=>({draft:'待核实',active:'有效（沿用原状态）',inactive:'已停用',archived:'已停用／归档',submitted:'已提交',confirmed:'已确认',conflicted:'冲突待处理'}[s]||s);
const shortName=name=>name.length>28?name.slice(0,28)+'…':name;
const display=v=>v===null||v===undefined||v===''?'待确认':typeof v==='object'?JSON.stringify(v):String(v);
const renderInput=(v,spec)=>spec.type==='nullable_boolean'?v===null||v===undefined?'unknown':String(v):spec.type==='nullable_array'?v===null||v===undefined?'':JSON.stringify(v):v??'';
const editable=v=>v && (v.entity_type==='object'?['draft','active']:['draft']).includes(v.base_snapshot.row.status);
const impactLabels={fields:'所属字段',live_fields:'尚未停用的字段',fixed_field_versions:'绑定对象历史版本的字段版本',system_links:'系统关系',identity_records:'标识记录',conflicts:'冲突记录',quality_issues:'质量问题',identifier_versions:'引用此字段的唯一标识版本',source_mappings:'模板来源映射',review_events:'事实核对记录',fact_requests:'定向事实请求',v7_mapping_versions:'V7 固定映射版本'};
function payload(draft,schema) {
  const patch={};
  for(const spec of schema) {
    const input=draft.values[spec.path];
    if(draft.original && input===renderInput(valueAt(draft.original.definition,spec.path),spec))continue;
    let value=input===''?null:input;
    if(spec.type==='nullable_boolean')value=input==='unknown'?null:input==='true';
    if(spec.type==='nullable_array') {try{value=input===''?null:JSON.parse(input);}catch{throw new Error('枚举允许值请填写 JSON 数组，例如 ["是","否"]；留空表示待确认。');}}
    const [first,second]=spec.path.split('.');
    if(second){patch[first]||={};patch[first][second]=value;}else patch[first]=value;
  }
  if(draft.type==='object'&&JSON.stringify(draft.identifiers)!==JSON.stringify(draft.original?.definition.unique_identifiers??null))patch.unique_identifiers=draft.identifiers;
  return {entity_type:draft.type,request_id:draft.requestId,definition:patch,
    ...(draft.original?{entity_id:draft.original.entity_id,expected_revision:draft.original.revision_no}:{}),
    ...(draft.type==='field'?{object_id:draft.parent.entity_id,object_version_id:draft.parent.version_id}:{})};
}
export function ObjectManagement({api,draft,setDraft}) {
  const guard=useInputProtection(),generation=useRef(0),active=useRef(null),firstInput=useRef(null);
  const [cap,setCap]=useState(null),[items,setItems]=useState([]),[next,setNext]=useState(null),[search,setSearch]=useState('');
  const [object,setObject]=useState(null),[fields,setFields]=useState([]),[fieldsNext,setFieldsNext]=useState(null),[selected,setSelected]=useState(null),[panel,setPanel]=useState('object');
  const [history,setHistory]=useState(null),[historical,setHistorical]=useState(null),[source,setSource]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState(null);
  function cancelRequest(){generation.current++;active.current?.abort();setBusy(false);}
  useEffect(()=>()=>{generation.current++;active.current?.abort();},[]);
  async function run(action) {
    cancelRequest();const number=generation.current,controller=new AbortController();active.current=controller;
    setBusy(true);setError(null);const valid=()=>generation.current===number&&!controller.signal.aborted;
    try{await action(controller.signal,valid);}catch(e){if(valid()&&e.name!=='AbortError')setError(e);}finally{if(valid())setBusy(false);}
  }
  async function loadList(signal,valid,after=null) {
    const result=await api.request(root+'/objects?search='+encodeURIComponent(search)+(after?'&after='+after:''),{signal});
    if(valid()){setItems(old=>after?[...old,...result.items]:result.items);setNext(result.next);}
  }
  function initialize(){run(async(signal,valid)=>{
    const c=await api.request(root+'/capabilities',{signal});if(valid())setCap(c);await loadList(signal,valid);
    const objectId=draft?.owner===c.person_id&&draft?.department===c.department_id?(draft.parent?.entity_id||(draft.original?.entity_type==='object'?draft.original.entity_id:null)):new URLSearchParams(window.location.search).get('object');
    if(objectId)await loadObject(objectId,signal,valid);
    const fieldId=new URLSearchParams(window.location.search).get('field');
    if(objectId&&fieldId&&!draft){const f=await api.request(root+'/detail/field/'+fieldId,{signal});if(valid()&&f.current.base_snapshot.row.object_id===objectId){setSelected(f.current);setPanel('fields');}}
  });}
  useEffect(initialize,[]);
  useEffect(()=>{if(draft&&cap&&draft.owner===cap.person_id)firstInput.current?.focus();},[Boolean(draft),cap]);
  function leave(){if(!guard.confirmLeave())return false;cancelRequest();setDraft(null);setHistory(null);setHistorical(null);setSource(null);setError(null);return true;}
  async function loadObject(id,signal,valid){
    const result=await api.request(root+'/detail/object/'+id,{signal});
    if(valid()){setObject(result.current);setSelected(result.current);setFields(result.fields);setFieldsNext(result.next);setPanel('object');setHistory(null);setHistorical(null);setSource(null);}
  }
  function chooseObject(id){if(!leave())return;setObject(null);setSelected(null);run((signal,valid)=>loadObject(id,signal,valid));}
  function chooseField(id){if(!leave())return;setSelected(null);run(async(signal,valid)=>{const result=await api.request(root+'/detail/field/'+id,{signal});if(valid())setSelected(result.current);});}
  function start(type,original=null){
    if(!leave())return;
    const values=Object.fromEntries(cap.schema[type].map(s=>[s.path,renderInput(valueAt(original?.definition,s.path),s)]));
    setDraft({type,owner:cap.person_id,department:cap.department_id,original,parent:type==='field'?object:null,values,identifiers:original?.definition.unique_identifiers??null,requestId:crypto.randomUUID(),dirty:false});
    setNotice(null);
  }
  function update(patch){setDraft(d=>({...d,...patch,dirty:true,requestId:crypto.randomUUID()}));}
  function save(event){
    event.preventDefault();if(busy)return;
    if(!draft.values.name?.trim()){setError(new Error('请填写名称。'));firstInput.current?.focus();return;}
    let body;try{body=payload(draft,cap.schema[draft.type]);}catch(e){setError(e);return;}
    const parentId=draft.parent?.entity_id;
    const changed=cap.schema[draft.type].filter(s=>!draft.original||renderInput(valueAt(draft.original.definition,s.path),s)!==draft.values[s.path]).map(s=>s.label);
    run(async(signal,valid)=>{
      const saved=await api.request(root+'/save',{method:'POST',body,signal});
      if(!valid())return;
      setDraft(null);setNotice(`保存成功：${saved.entity_type==='object'?'对象':'字段'} ${saved.entity_id}，修订 ${saved.revision_no}。${changed.length?'变更：'+changed.join('、'):'已保存标识设置'}。状态仍待核实。`);
      await loadList(signal,valid);await loadObject(saved.entity_type==='object'?saved.entity_id:parentId,signal,valid);
      if(saved.entity_type==='field') {const detail=await api.request(root+'/detail/field/'+saved.entity_id,{signal});if(valid()){setSelected(detail.current);setPanel('fields');}}
    });
  }
  function retire(){if(!leave())return;const target=selected;run(async(signal,valid)=>{
    const result=await api.request(root+'/impact/'+target.entity_type+'/'+target.entity_id,{signal});
    if(valid()){setDraft({mode:'retire',owner:cap.person_id,department:cap.department_id,target,impact:result,reason:'',dirty:false,requestId:crypto.randomUUID()});}
  });}
  function confirmRetire(event){event.preventDefault();if(!draft.reason.trim()){setError(new Error('请填写停用原因。'));firstInput.current?.focus();return;}
    const d=draft;if(!window.confirm('确认按所示影响停用？历史版本和引用会保留。'))return;
    run(async(signal,valid)=>{
      const result=await api.request(root+'/retire/'+d.target.entity_type+'/'+d.target.entity_id,{method:'POST',body:{request_id:d.requestId,expected_revision:d.target.revision_no,impact_digest:d.impact.impact_digest,confirm:true,reason:d.reason},signal});
      if(!valid())return;setDraft(null);setNotice('停用已保存，原编号、历史版本和引用已保留。');await loadList(signal,valid);
      await loadObject(d.target.entity_type==='object'?result.entity_id:d.target.base_snapshot.row.object_id,signal,valid);
      if(d.target.entity_type==='field'){const detail=await api.request(root+'/detail/field/'+result.entity_id,{signal});if(valid()){setSelected(detail.current);setPanel('fields');}}
    });
  }
  const current=historical||selected;
  const foreignDraft=draft&&cap&&(draft.owner!==cap.person_id||draft.department!==cap.department_id);
  const matchingDraft=draft&&!foreignDraft&&cap;
  const currentSchema=current?cap?.schema[current.entity_type]:[];
  return <>
    <section className="card"><h2>管理对象与字段事实</h2><p>先选择对象，再补充字段。保存会保留修订历史；主数据和权威来源认定仍待有权主体核实。</p>
      {!cap&&<StatusPanel kind={error?'error':'loading'} title={error?'暂时无法读取台账':'正在核对范围…'} onRetry={error?initialize:undefined}>{error?.message}</StatusPanel>}
      {cap&&!cap.can_write&&<StatusPanel title="当前身份只读">可查阅授权范围内的对象、字段和历史。</StatusPanel>}
      {cap&&<form className="management-search" onSubmit={e=>{e.preventDefault();if(leave())run((s,v)=>loadList(s,v));}}><label>按对象名称查找<input value={search} maxLength={255} onChange={e=>setSearch(e.target.value)}/></label><button className="secondary" disabled={busy}>查找</button></form>}
      {notice&&<StatusPanel title="保存结果">{notice}</StatusPanel>}
      {cap&&error&&<StatusPanel kind="error" title="操作未完成">{error.message}{error.code?`（${error.code}）`:''} {error.status===409?'请保留或复制当前输入，再取消编辑并重新读取版本核对；系统不会覆盖新版。':''}</StatusPanel>}
      {busy&&<p role="status">正在处理，请稍候…</p>}
    </section>
    {foreignDraft&&<StatusPanel kind="error" title="原身份的输入已保留并隐藏">请使用原身份重新登录后继续，或明确放弃。<button type="button" className="secondary" onClick={()=>{if(window.confirm('确认放弃原身份的未保存输入？'))setDraft(null);}}>放弃原身份输入</button></StatusPanel>}
    {cap&&!foreignDraft&&<div className="management-layout">
      <section className="card object-list"><h2>对象清单</h2>
        {!object&&!matchingDraft&&cap.can_write&&<button className="primary" disabled={busy} onClick={()=>start('object')}>新增对象</button>}
        {!items.length&&!busy&&<p>当前范围没有对象。可新增对象，或从模板导入。</p>}
        <ul>{items.map(item=><li key={item.entity_id}><button className="object-choice" aria-current={object?.entity_id===item.entity_id?'true':undefined} onClick={()=>chooseObject(item.entity_id)}><strong>{item.name}</strong><span>对象 {item.entity_id} · {labelStatus(item.status)} · 修订 {item.revision_no??'待迁移'}</span></button></li>)}</ul>
        {next&&<button className="secondary" disabled={busy} onClick={()=>run((s,v)=>loadList(s,v,next))}>载入更多对象</button>}
        {object&&!matchingDraft&&<button className="secondary" onClick={()=>{if(leave()){setObject(null);setSelected(null);}}}>返回对象清单</button>}
      </section>
      <section className="management-main">
        {matchingDraft&&draft.mode==='retire'?<form className="card" onSubmit={confirmRetire}><h2>停用影响确认</h2><p>{draft.target.definition.name} · 修订 {draft.target.revision_no}</p><p>停用后保留全部历史和固定引用。对象停用后，其字段不能继续新增或修订；现有字段不会被批量改写。</p><dl className="source-values">{Object.entries(draft.impact.counts).map(([k,v])=><div key={k}><dt>{impactLabels[k]}</dt><dd>{v}</dd></div>)}</dl><label className="management-input">停用原因<textarea aria-label="停用原因" ref={firstInput} value={draft.reason} maxLength={4096} disabled={busy} onChange={e=>update({reason:e.target.value})}/></label><div className="import-actions"><button className="primary" disabled={busy}>确认停用并保留历史</button><button type="button" className="secondary" disabled={busy} onClick={()=>leave()}>取消停用</button></div></form>
        :matchingDraft?<form className="card definition-editor" onSubmit={save} noValidate>
          <h2>{draft.original?'修订':'新增'}{draft.type==='object'?'对象':'字段'}</h2>
          {draft.parent&&<p>所属对象：{draft.parent.definition.name}（对象 {draft.parent.entity_id} · 固定版本 {draft.parent.version_id}）。维护归属引用此对象；字段值来源单独填写。</p>}
          <p>空白表示待确认。维护说明不授予人员权限；保存与正式提交分开。</p>
          {cap.groups.map((group,index)=>{const specs=cap.schema[draft.type].filter(s=>s.group===group);return specs.length>0&&<details key={group} open={index===0||draft.type==='field'&&index===4} className="definition-group"><summary>{draft.type==='field'&&index===0?'字段是什么':group}</summary><div className="definition-inputs">{specs.map(spec=><label className="management-input" key={spec.path}>{spec.label}{spec.path==='name'?' *':''}
            {spec.type==='nullable_boolean'?<select aria-label={spec.label} value={draft.values[spec.path]} disabled={busy} onChange={e=>update({values:{...draft.values,[spec.path]:e.target.value}})}><option value="unknown">待确认</option><option value="true">必填</option><option value="false">非必填</option></select>
            :<textarea aria-label={spec.label+(spec.path==='name'?' *':'')} ref={spec.path==='name'?firstInput:undefined} rows={spec.path==='name'?1:2} maxLength={spec.max||8192} disabled={busy} value={draft.values[spec.path]} onChange={e=>update({values:{...draft.values,[spec.path]:e.target.value}})}/>}
            {spec.type==='nullable_array'&&<small>留空为待确认；[] 为明确无允许项；例如 ["是","否"]。</small>}
          </label>)}</div></details>;})}
          {draft.type==='object'&&<IdentifierEditor value={draft.identifiers} fields={fields} enabled={Boolean(draft.original)} disabled={busy} onChange={value=>update({identifiers:value})}/>}
          <details className="definition-group"><summary>本次变更内容</summary><ul>{cap.schema[draft.type].filter(spec=>draft.values[spec.path]!==renderInput(valueAt(draft.original?.definition,spec.path),spec)).map(spec=><li key={spec.path}>{spec.label}：{display(valueAt(draft.original?.definition,spec.path))} → {display(draft.values[spec.path])}</li>)}{JSON.stringify(draft.identifiers)!==JSON.stringify(draft.original?.definition.unique_identifiers??null)&&<li>唯一标识设置已修改，将绑定所选字段的固定版本。</li>}</ul></details>
          {draft.dirty&&<p className="input-notice">有未提交修改，仅保留在当前页面。离开前请保存或明确放弃。</p>}
          <div className="import-actions"><button className="primary" disabled={busy}>保存{draft.type==='object'?'对象':'字段'}</button><button type="button" className="secondary" disabled={busy} onClick={()=>leave()}>取消编辑</button></div>
        </form>:object?<>
          <section className="card"><h2>{object.definition.name}</h2><p>对象 {object.entity_id} · 修订 {object.revision_no} · {labelStatus(object.base_snapshot.row.status)}</p><div className="import-actions"><button className="secondary" aria-pressed={panel==='object'} onClick={()=>{if(leave()){setPanel('object');setSelected(object);}}}>对象详情</button><button className="secondary" aria-pressed={panel==='fields'} onClick={()=>{if(leave()){setPanel('fields');setSelected(null);}}}>字段明细</button></div></section>
          {panel==='fields'&&<section className="card"><h2>所属字段</h2>{cap.can_write&&editable(object)&&<button className="primary" disabled={busy} onClick={()=>start('field')}>新增「{shortName(object.definition.name)}」字段</button>}<ul className="field-list">{fields.map(f=><li key={f.entity_id}><button className="text-button" onClick={()=>chooseField(f.entity_id)}>{f.name} · 字段 {f.entity_id} · {labelStatus(f.status)} · 修订 {f.revision_no??'待迁移'}</button></li>)}</ul>{!fields.length&&<p>尚未登记字段。新增时将直接引用当前对象。</p>}{fieldsNext&&<button className="secondary" disabled={busy} onClick={()=>run(async(signal,valid)=>{const result=await api.request(root+'/detail/object/'+object.entity_id+'?after='+fieldsNext,{signal});if(valid()){setFields(f=>[...f,...result.fields]);setFieldsNext(result.next);}})}>载入更多字段</button>}</section>}
          {current&&<section className="card definition-detail"><h2>{historical?'历史版本：':''}{current.definition.name}</h2><p>{current.entity_type==='object'?'对象':'字段'} {current.entity_id} · 修订 {current.revision_no} · {labelStatus(current.base_snapshot.row.status)} · 固定版本 {current.version_id}</p>
            <div className="import-actions"><a className="secondary button-link" href={'/app/design-handoffs?entity_type='+current.entity_type+'&entity_id='+current.entity_id} onClick={e=>{if(!guard.confirmLeave())e.preventDefault();}}>查看设计交接及修订影响</a>{!historical&&cap.can_check&&<a className="secondary button-link" href={'/app/fact-checks?version='+current.version_id} onClick={e=>{if(!guard.confirmLeave())e.preventDefault();}}>发起定向事实核对</a>}{/^[1-9]\d*$/.test(new URLSearchParams(location.search).get('returnFact')||'')&&<a className="secondary button-link" href={'/app/fact-checks?fact='+new URLSearchParams(location.search).get('returnFact')} onClick={e=>{if(!guard.confirmLeave())e.preventDefault();}}>返回事实核对办理位置</a>}</div>
            <div className="import-actions">{!historical&&cap.can_write&&editable(current)&&editable(object)&&<><button className="primary" disabled={busy} onClick={()=>start(current.entity_type,current)}>修订{current.entity_type==='object'?'对象':'字段'}</button><button className="secondary" disabled={busy} onClick={retire}>查看停用影响</button></>}
            <button className="secondary" disabled={busy} onClick={()=>run(async(signal,valid)=>{const h=await api.request(root+'/history/'+selected.entity_type+'/'+selected.entity_id,{signal});if(valid())setHistory(h);})}>查看版本历史</button>{historical&&<button className="secondary" onClick={()=>{setHistorical(null);setSource(null);}}>返回当前版本</button>}</div>
            {history&&<div className="history-list"><h3>不可变版本</h3>{history.items.map(h=><button className="text-button" key={h.version_id} onClick={()=>run(async(signal,valid)=>{const v=await api.request(root+'/version/'+h.version_id,{signal});if(valid()){setHistorical(v);setSource(null);}})}>修订 {h.revision_no} · {h.created_at} · {h.actor_person_id?'人员 '+h.actor_person_id:'历史迁移'}</button>)}{history.next&&<button className="secondary" disabled={busy} onClick={()=>run(async(signal,valid)=>{const h=await api.request(root+'/history/'+selected.entity_type+'/'+selected.entity_id+'?before='+history.next,{signal});if(valid())setHistory(old=>({items:[...old.items,...h.items],next:h.next}));})}>更早版本</button>}</div>}
            {cap.groups.map((group,i)=>{const specs=currentSchema.filter(s=>s.group===group);return specs.length>0&&<details className="definition-group" key={group} open={i===0}><summary>{current.entity_type==='field'&&i===0?'字段是什么':group}</summary><dl className="source-values">{specs.map(s=><div key={s.path}><dt>{s.label}</dt><dd>{s.type==='nullable_boolean'?valueAt(current.definition,s.path)===true?'必填':valueAt(current.definition,s.path)===false?'非必填':'待确认':display(valueAt(current.definition,s.path))}</dd></div>)}</dl></details>;})}
            {current.entity_type==='object'&&<details className="definition-group"><summary>唯一标识</summary>{current.definition.unique_identifiers===null?<p>待确认；不会根据名称或模板行序认定。</p>:<ul>{(current.definition.unique_identifiers||[]).map(g=><li key={g.group_id}>{g.kind==='single'?'单字段标识':'组合唯一标识'}：{g.field_version_ids.map(vid=><button className="text-button" key={vid} onClick={()=>run(async(signal,valid)=>{const v=await api.request(root+'/version/'+vid,{signal});const detail=await api.request(root+'/detail/field/'+v.entity_id,{signal});if(valid()){setSelected(detail.current);setHistorical(v);setHistory(null);setSource(null);}})}>字段固定版本 {vid}</button>)}</li>)}</ul>}</details>}
            {current.definition.source?.batch_id&&<div className="definition-group"><p>来源批次 {current.definition.source.batch_id} · {current.definition.source.sheet_name} 第 {current.definition.source.source_row} 行</p><button className="secondary" disabled={busy} onClick={()=>run(async(signal,valid)=>{const result=await api.request(root+'/source/'+current.definition.source.batch_id,{signal});if(valid())setSource(result);})}>查看源单元格原值</button></div>}
            {source&&<details open className="definition-group"><summary>原模板信息（原值保留，修订不改原件）</summary><p>{source.original_name}</p><dl className="source-values">{source.cells.filter(c=>current.definition.source?.cells?.some(ref=>ref.address===c.cell_address)&&c.sheet_name===current.definition.source.sheet_name).map(c=><div key={c.cell_id}><dt>{c.sheet_name} · {c.cell_address} · {cap.source_labels[current.entity_type]?.[current.definition.source.cells.find(ref=>ref.address===c.cell_address)?.key]}</dt><dd>{display(c.raw_value)}</dd></div>)}</dl></details>}
          </section>}
        </>:!matchingDraft&&<StatusPanel title="选择对象开始维护">从左侧清单进入详情，再按当前任务补充来源、维护说明、使用规则和字段。</StatusPanel>}
      </section>
    </div>}
  </>;
}
function IdentifierEditor({value,fields,enabled,disabled,onChange}) {
  return <details className="definition-group"><summary>单字段与组合唯一标识</summary><p>显式选择字段固定版本，组合顺序按加入顺序保存。同组字段必须绑定同一对象版本。</p>
    {!enabled?<p>请先保存对象并补充字段，再修订对象登记标识。</p>:<>
      <label className="management-input">标识确认范围<select aria-label="标识确认范围" disabled={disabled} value={value===null?'unknown':'defined'} onChange={e=>onChange(e.target.value==='unknown'?null:[])}><option value="unknown">待确认</option><option value="defined">明确登记（允许空组）</option></select></label>
      {value?.map((group,index)=><div className="identifier-group" key={group.group_id}><label className="management-input">标识类型<select aria-label="标识类型" disabled={disabled} value={group.kind} onChange={e=>onChange(value.map((g,i)=>i===index?{...g,kind:e.target.value}:g))}><option value="single">单字段唯一标识</option><option value="composite">组合唯一标识</option></select></label><ol>{group.field_version_ids.map(vid=><li key={vid}>{fields.find(f=>f.version_id===vid)?.name||'历史字段'} · 固定版本 {vid}<button type="button" className="text-button" disabled={disabled} onClick={()=>onChange(value.map((g,i)=>i===index?{...g,field_version_ids:g.field_version_ids.filter(v=>v!==vid)}:g))}>移除此标识引用</button></li>)}</ol><label className="management-input">加入标识字段<select aria-label="加入标识字段" value="" disabled={disabled} onChange={e=>{if(e.target.value)onChange(value.map((g,i)=>i===index?{...g,field_version_ids:[...g.field_version_ids,e.target.value]}:g));}}><option value="">请选择已保存字段</option>{fields.filter(f=>f.version_id&&f.status!=='archived'&&!group.field_version_ids.includes(f.version_id)).map(f=><option key={f.entity_id} value={f.version_id}>{f.name} · 固定版本 {f.version_id}</option>)}</select></label><button type="button" className="secondary" disabled={disabled} onClick={()=>onChange(value.filter((_,i)=>i!==index))}>移除标识组</button></div>)}
      {value!==null&&<button type="button" className="secondary" disabled={disabled} onClick={()=>onChange([...value,{group_id:crypto.randomUUID(),kind:'single',field_version_ids:[]}])}>登记标识组</button>}
    </>}
  </details>;
}
