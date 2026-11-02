import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {businessDateTime} from './businessGuidance.js';
const businessTimeFields=new Set(['created_at','updated_at','published_at','submitted_at','registered_at','decided_at','reviewed_at','started_at','completed_at','answered_at','closed_at','due_at','content_updated_at']);
import {businessChoice,businessEvidence,businessFieldLabel,businessName,businessStatus,businessText,internalField,userMessage} from './businessPresentation.js';

const Catalog=createContext({});
export const BusinessCatalogProvider=Catalog.Provider;
export function BusinessDetails({value}) {
  if(value==null||value==='')return <span>未记录</span>;
  if(Array.isArray(value))return value.length?<ul>{value.map((item,index)=><li key={index}><BusinessDetails value={item}/></li>)}</ul>:<span>未登记内容</span>;
  if(typeof value==='object'){
    const entries=Object.entries(value).filter(([key,entry])=>!internalField(key)&&businessFieldLabel(key)&&entry!==undefined&&entry!==null&&entry!=='');
    return entries.length?<dl className="source-values business-details">{entries.map(([key,entry])=><div key={key}><dt>{businessFieldLabel(key)}</dt><dd>{businessTimeFields.has(key)?businessDateTime(entry):key==='evidence_refs'?businessEvidence(entry):['status','state','decision','operation','kind','data_type','field_type','scope_mode','node_type','actor_assignment_mode','relation_type','record_scope','presence','availability_mode','record_model','mode','source_type','action','result_state','review_status','exit_state','entry_state','item_type','value_usage_mode','value_origin_mode','area_type','form_design_state','conversion_status','classification_status','stage','operations'].includes(key)?(Array.isArray(entry)?entry.map(item=>businessStatus(item)).join('、'):businessStatus(entry)):<BusinessDetails value={entry}/>}</dd></div>)}</dl>:<p>此记录未提供可展示的业务说明；原记录仍保留。</p>;
  }
  return <span style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{businessText(value)}</span>;
}
export function BusinessSelect({label,value,onChange,items=[],disabled=false,required=false,valueKey,nameKey,empty='请选择',...props}){
  const id=row=>String(valueKey?row[valueKey]:row.value??row.id??row.person_id??row.entity_id??row.package_id??row.binding_id??row.version_id??row.detail_ref??row.item_ref??'');
  const chosen=value==null?'':String(value),known=items.some(row=>id(row)===chosen);
  return <label className="handoff-input">{label}<select {...props} aria-label={label} value={chosen} required={required} disabled={disabled||(!items.length&&!chosen)} onChange={event=>onChange(event.target.value)}><option value="">{items.length?empty:'暂无可选记录，请先核对来源'}</option>{chosen&&!known&&<option value={chosen} disabled>原关联名称未记录，请核对后重新选择</option>}{items.map((row,index)=><option value={id(row)} key={id(row)||index}>{nameKey?businessText(row[nameKey],'名称未记录'):row.label?businessText(row.label,'名称未记录'):businessChoice(row)}</option>)}</select></label>;
}
export function BusinessReference({label,value,onChange,disabled,required,multiline=false,targetKind}){
  const catalog=useContext(Catalog);
  const entries=/部门/.test(label)?catalog.departments:/人员|处理人|决策人/.test(label)?catalog.people:/工作包/.test(label)?catalog.packages:/审核/.test(label)?catalog.bindings:/事实/.test(label)?catalog.facts:/来源|明细/.test(label)?catalog.details:/字段版本/.test(label)?catalog.fieldVersions:/版本/.test(label)?catalog.versions:targetKind==='field'?catalog.fields:catalog.objects;
  const source=targetKind?(entries||[]).filter(row=>row.kind===targetKind):entries;
  const title=label.replace(/标识|编号|稳定引用|引用键|准确/g,'').replace('目标稳定','目标');
  if(multiline){const values=Array.isArray(value)?value:String(value||'').split('\n').filter(Boolean);return <fieldset><legend>{title}</legend>{values.map((entry,index)=><div className="identity-actions" key={index}><BusinessSelect label={title+'所选内容'} value={entry} onChange={next=>onChange(values.map((v,i)=>i===index?next:v).join('\n'))} items={source||[]} disabled={disabled} required={required}/><button type="button" disabled={disabled} onClick={()=>onChange(values.filter((_,i)=>i!==index).join('\n'))}>移除此关联</button></div>)}<BusinessSelect label={'新增'+title} value="" onChange={next=>next&&onChange([...values,next].join('\n'))} items={source||[]} disabled={disabled}/></fieldset>;}
  return <BusinessSelect label={title} value={value} onChange={onChange} items={source||[]} disabled={disabled} required={required}/>;
}
export function AllowedValuesEditor({label,value,onChange,disabled}){
  let values;try{values=value===''?null:JSON.parse(value);}catch{values=undefined;}
  const [buffers,setBuffers]=useState({});
  const replace=(index,next)=>{const list=[...values];list[index]=next;onChange(JSON.stringify(list));};
  return <fieldset><legend>{label}</legend><label>允许值说明<select aria-label={label+'说明'} disabled={disabled} value={values===null?'unknown':Array.isArray(values)&&!values.length?'none':'list'} onChange={event=>{if(!window.confirm('更改允许值的填写方式？请确认不再保留当前列表后继续。'))return;setBuffers({});onChange(event.target.value==='unknown'?'':event.target.value==='none'?'[]':'[""]');}}><option value="unknown">尚未明确允许值</option><option value="none">明确没有允许值</option><option value="list">逐项填写允许值</option></select></label>{Array.isArray(values)&&values.map((item,index)=><div className="identity-actions" key={index}><label>允许值{typeof item==='boolean'?<select aria-label={label+'取值 '+(index+1)} disabled={disabled} value={String(item)} onChange={event=>replace(index,event.target.value==='true')}><option value="true">是</option><option value="false">否</option></select>:<input aria-label={label+'取值 '+(index+1)} disabled={disabled} value={buffers[index]??String(item)} ref={node=>node?.setCustomValidity(typeof item==='number'&&buffers[index]!==undefined&&(buffers[index].trim()===''||!Number.isFinite(Number(buffers[index])))?'请填写有效数字后再保存。':'')} onChange={event=>{const text=event.target.value;setBuffers(current=>({...current,[index]:text}));if(typeof item==='number'){if(text.trim()!==''&&Number.isFinite(Number(text)))replace(index,Number(text));else onChange(value);}else replace(index,text);}}/>}{typeof item==='number'&&buffers[index]!==undefined&&(buffers[index].trim()===''||!Number.isFinite(Number(buffers[index])))&&<span role="alert">请填写有效数字后再保存。</span>}</label><button type="button" disabled={disabled} onClick={()=>{setBuffers({});onChange(JSON.stringify(values.filter((_,i)=>i!==index)));}}>移除此允许值</button></div>)}{Array.isArray(values)&&<button type="button" disabled={disabled} onClick={()=>{onChange(JSON.stringify([...values,'']));}}>新增允许值</button>}{values===undefined&&<p>原允许值暂时无法逐项展示，原内容已保留。需要修改时，请核对后选择填写方式。</p>}</fieldset>;
}
export function BusinessDocumentLink({api,path,children}){
  const [state,setState]=useState(null),active=useRef(null);
  useEffect(()=>()=>active.current?.abort(),[path]);
  async function read(){active.current?.abort();const controller=new AbortController();active.current=controller;setState({busy:true});try{const request=typeof api==='function'?api:api.request;const value=await request(path,{signal:controller.signal});if(!controller.signal.aborted)setState({value});}catch(error){if(!controller.signal.aborted)setState({error:userMessage(error,'所选内容暂时无法读取，请稍后重试。')});}}
  return <span className="business-document-link"><button type="button" className="text-button" onClick={read} disabled={state?.busy}>{children}</button>{state&&<section className="card" aria-label="关联内容详情"><button type="button" className="secondary" onClick={()=>{active.current?.abort();setState(null);}}>关闭关联内容</button>{state.busy?<p>正在读取所选内容…</p>:state.error?<p role="alert">{state.error}</p>:<BusinessDetails value={state.value}/>}</section>}</span>;
}
export function BusinessRecordPicker({api,label,value,onChange,kind='source',parent,disabled=false,required=false}){
  const [query,setQuery]=useState(''),[state,setState]=useState({}),active=useRef(null),generation=useRef(0);
  useEffect(()=>{generation.current++;active.current?.abort();setState({});return()=>active.current?.abort();},[kind,parent]);
  const request=(url,options)=>typeof api==='function'?api(url,options):api.request(url,options);
  async function load(){
    active.current?.abort();const controller=new AbortController(),token=++generation.current;active.current=controller;setState({busy:true});
    try{
      let url=kind==='version'?'/api/process-design/versions?q='+encodeURIComponent(query):kind==='case'?'/api/process-v7-preview/cases':kind==='revision'?'/api/process-v7-preview/cases/'+encodeURIComponent(parent||'')+'/history':['object','field','objectVersion','fieldVersion','definitionVersion'].includes(kind)?'/api/data-map-definitions/objects?view=current':'/api/v7-mappings/sources';
      if(kind==='revision'&&!parent)throw new Error('请先选择对应流程，再读取已保存内容。');
      const data=await request(url,{signal:controller.signal});
      if(token!==generation.current||controller.signal.aborted)return;
      const rows=Array.isArray(data)?data:data.items||data.revisions||[];
      setState({rows:rows.filter(row=>!query||businessName(row,row.original_name||'').includes(query)),level:'list',next:data.next||data.next_before||null,url});
    }catch(error){if(!controller.signal.aborted&&token===generation.current)setState({error:userMessage(error,'可选记录暂时无法读取，请稍后重试。原关联仍保留。')});}
  }
  async function choose(selected){
    if(!selected)return;
    const row=state.rows?.find(item=>String(item.__choice??item.id??item.entity_id??item.source_id??item.mapping_version_id)===selected);if(!row)return;
    active.current?.abort();const controller=new AbortController(),token=++generation.current;active.current=controller;
    const commit=id=>{if(id==null||String(id)==='')throw new Error('所选记录尚未提供可用关联，请核对来源后重试。');if(token===generation.current&&!controller.signal.aborted){onChange(String(id));setState(current=>({...current,choice:selected,selectedName:businessName(row,row.original_name||'名称未记录')}));}};
    try{
      if(state.level==='fields'){const detail=await request('/api/data-map-definitions/detail/field/'+encodeURIComponent(row.entity_id)+'?view=current',{signal:controller.signal});commit(kind==='field'?row.entity_id:detail.current?.version_id??detail.version_id);return;}
      if(state.level==='definitions'){
        if(row.__field){const detail=await request('/api/data-map-definitions/detail/field/'+encodeURIComponent(row.entity_id)+'?view=current',{signal:controller.signal});commit(detail.current?.version_id??detail.version_id);}else commit(row.__choice);return;
      }
      if(['object','field','objectVersion','fieldVersion','definitionVersion'].includes(kind)){
        const detail=await request('/api/data-map-definitions/detail/object/'+encodeURIComponent(row.entity_id)+'?view=current',{signal:controller.signal});if(token!==generation.current||controller.signal.aborted)return;
        if(['field','fieldVersion'].includes(kind)){setState({rows:detail.fields||[],level:'fields',next:detail.next,url:'/api/data-map-definitions/detail/object/'+encodeURIComponent(row.entity_id)+'?view=current'});return;}
        if(kind==='definitionVersion'){setState({rows:[{...row,__choice:detail.current?.version_id??detail.version_id,__version:true},...(detail.fields||[]).map(item=>({...item,__field:true}))],level:'definitions',next:detail.next,url:'/api/data-map-definitions/detail/object/'+encodeURIComponent(row.entity_id)+'?view=current'});return;}
        commit(kind==='object'?row.entity_id:detail.current?.version_id??detail.version_id);return;
      }
      if(kind==='mappingVersion'&&state.level==='list'){const data=await request('/api/v7-mappings/sources/'+encodeURIComponent(row.source_id),{signal:controller.signal});if(token===generation.current&&!controller.signal.aborted)setState({rows:(data.mappings||[]).filter(item=>item.mapping_version_id).map(item=>({...item,__choice:item.mapping_version_id})),level:'mappings'});return;}
      commit(row.__choice??row.id??row.source_id??row.mapping_version_id);
    }catch(error){if(!controller.signal.aborted&&token===generation.current)setState(previous=>({...previous,error:userMessage(error,'所选记录暂时无法读取，请核对后重试。原关联仍保留。')}));}
  }
  async function more(){const token=++generation.current,controller=new AbortController();active.current?.abort();active.current=controller;setState(current=>({...current,busy:true,error:null}));try{const data=await request(state.url+(state.url.includes('?')?'&':'?')+(kind==='version'?'before=':'after=')+encodeURIComponent(state.next),{signal:controller.signal});if(token!==generation.current||controller.signal.aborted)return;const rows=data.items||data.fields||[];setState(current=>({...current,busy:false,rows:[...current.rows,...rows.map(row=>state.level==='definitions'?{...row,__field:true}:row)],next:data.next||null}));}catch(error){if(token===generation.current&&!controller.signal.aborted)setState(current=>({...current,busy:false,error:userMessage(error,'更多记录暂时无法读取，已读取内容及原关联仍保留。')}));}}
  return <fieldset className="business-record-picker"><legend>{label.replace(/\s*ID|标识|编号/g,'')}</legend><label>按名称查找<input aria-label={label+'名称'} value={query} disabled={disabled||state.busy} onChange={event=>setQuery(event.target.value)}/></label><button type="button" disabled={disabled||state.busy} onClick={load}>查找可选记录</button>{value&&<p>{state.selectedName?'当前选择：'+state.selectedName:'原关联仍保留；更改前请先查找并核对目标名称。'}</p>}{state.error&&<p role="alert">{state.error}</p>}{state.rows&&<BusinessSelect label={label.replace(/\s*ID|标识|编号/g,'')} value={state.choice||''} onChange={choose} items={state.rows.map(row=>({...row,value:String(row.__choice??row.id??row.entity_id??row.source_id??row.mapping_version_id),name:businessName(row,row.original_name||row.source_file_name||'名称未记录')}))} disabled={disabled||state.busy} required={required}/>} {state.next&&<button type="button" disabled={disabled||state.busy} onClick={more}>读取更多可选记录</button>}</fieldset>;
}
export function BusinessDirectoryPicker({api,label,value,onChange,people=false,multiple=false,disabled=false,required=false}){
  const [state,setState]=useState({});
  useEffect(()=>{const controller=new AbortController();setState({});const request=typeof api==='function'?api:api.request;request(people?'/api/org/persons/assignable':'/api/org/departments',{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setState({items:Array.isArray(data)?data:data.items||[]});}).catch(error=>{if(!controller.signal.aborted)setState({error:userMessage(error,'可选名称暂时无法读取，请刷新后核对。原关联仍保留。')});});return()=>controller.abort();},[api,people]);
  const items=(state.items||[]).map(row=>({...row,value:String(people?row.person_id??row.personId??row.id:row.id)}));
  return <fieldset><legend>{label}</legend>{state.error&&<p role="alert">{state.error}</p>}{multiple?<>{items.map(row=><label key={row.value}><input type="checkbox" disabled={disabled} checked={(value||[]).map(String).includes(row.value)} onChange={event=>onChange(event.target.checked?[...(value||[]),row.value]:(value||[]).filter(id=>String(id)!==row.value))}/>{businessChoice(row)}</label>)}{(value||[]).some(id=>!items.some(row=>row.value===String(id)))&&<p>原关联中有名称未读取的记录，原关联仍保留，请读取完整名单后核对。</p>}</>:<BusinessSelect label={label} value={value} onChange={onChange} items={items} disabled={disabled} required={required}/>}</fieldset>;
}
export {businessName};
