import React, { useState, useRef, useSyncExternalStore, useEffect, useMemo } from 'react';
import { Button, Dropdown, Segmented, Space, Tag, Input, Select, Table, Empty, Form, Collapse, Drawer, Modal, Switch, Alert, Checkbox, Typography } from 'antd';
import { catalog, resolve, fields, readPath, tableForTarget, businessLabel, businessContext, referenceName, messageForUser } from './model.mjs';
import GraphWorkspace from './GraphWorkspace.jsx';
import GridWorkspace, { GRID_NAMES, gridOptions } from './GridWorkspace.jsx';
import FieldInput, { displayValue } from './FieldInput.jsx';

const KINDS = { process:'流程',behavior:'环节',relation:'环节流转',data:'数据对象','data-field':'数据字段',form:'表单／记录','form-area':'表单区域','form-item':'表单字段',term:'术语','data-link':'数据与环节关系','data-source':'数据来源','form-link':'表单与环节关系','field-source':'字段取值来源','lifecycle-route':'生命周期路径','lifecycle-event':'生命周期事件' };
const PRIMARY=['process','behavior','data','form','term'];
const PREVIEWS = [
  ['术语使用关系','已有术语定义和标识，尚无结构化使用关系。'],['企业目录','部门、岗位、人员和系统仍可能是名称或来源线索，尚无企业身份模型。'],['跨流程解析','保留来源线索，尚不能解析其他流程或自动匹配对象。'],['企业对象映射','尚无企业对象匹配、认定和提升能力。'],['正式核对发布','由3000在其受控范围内完成；本工作台只下载未审核文件。'],['表单执行','可编制表单与字段事实，尚不能执行或填报业务表单。'],['生命周期执行','可查看和维护已记录路径及事件，尚无执行引擎。'],
];
const entityOf=(doc,target)=>resolve(doc,target)?.entity;
const selectKey=t=>t?JSON.stringify([t.kind,t.parentRef||'',t.ref]):'';
const targetOf=entry=>({kind:entry.kind,ref:entry.ref,parentRef:entry.parentRef||'',formRef:entry.formRef,areaRef:entry.areaRef,dataRef:entry.dataRef,routeRef:entry.routeRef});
const parentLabel=(entries,ref)=>referenceName(entries,ref);
const SUMMARY_KEYS={behavior:['behavior_name','node_type','behavior_description','current_actor_role','completion_standard'],process:['process_name','owning_department','purpose','scope'],data:['data_name','information_type','description','lifecycle.applicability'],form:['form_name','form_no','form_design_state'],'form-item':['item_name','required','instructions','data_field_ref','value_usage_mode','value_origin_mode']};

function ReferenceSummary({ document, target, dispatch }) {
  const projection=useMemo(()=>globalThis.ElementReferences?.buildCatalog(document),[document]);
  const references=projection ? globalThis.ElementReferences.forTarget(projection,target,{includeDescendants:true}) : {outgoing:[],incoming:[]};
  const all=[...references.outgoing,...references.incoming];
  const anomaly=all.filter(x=>!['valid','external'].includes(x.status));
  return <section className="relation-summary"><div className="section-label">直接关系 <Tag>{references.outgoing.length} 项引用 · {references.incoming.length} 项被引用</Tag>{anomaly.length>0&&<Tag color="error">⚠ {anomaly.length} 项异常</Tag>}</div>
    <Button onClick={()=>dispatch({type:'relations',target})}>查看关系图</Button>
    {target.kind==='term'&&<p className="helper">术语已有定义，尚无结构化使用关系。</p>}
    {!!all.length&&<Collapse ghost items={[{key:'references',label:'展开引用明细',children:<div className="reference-list">{all.map((entry,index)=>{
      const outgoing=references.outgoing.includes(entry); const destination=outgoing?entry.elementTarget||entry.target:entry.sourceTarget;
      const sourceRecord=(projection.nodes||[]).filter(node=>entry.path?.startsWith(`${node.path}/`)).sort((a,b)=>b.path.length-a.path.length)[0];
      return <div key={`${entry.id}-${index}`}><span>{outgoing?'→':'←'} {entry.relationLabel}</span><Button type="link" size="small" disabled={!destination||entry.status!=='valid'} onClick={()=>dispatch({type:'select-reference',reference:entry,direction:outgoing?'outgoing':'incoming',target:destination})}>{destination?businessLabel(catalog(document),destination):entry.status==='external'?'外部来源线索':'关联对象待核对'}</Button>
        {sourceRecord&&selectKey(sourceRecord)!==selectKey(target)&&<small>子项来源：{KINDS[sourceRecord.kind]||'记录'} · {businessLabel(catalog(document),sourceRecord)}</small>}{entry.status!=='valid'&&<Tag color={entry.status==='external'?'default':'error'}>{entry.status==='external'?'来源线索':'⚠ 关联内容待核对'}</Tag>}</div>;
    })}</div>}]} />}
  </section>;
}

function ObjectList({ state, dispatch }) {
  const [category,setCategory]=useState(state.viewport?.list?.category||'primary'); const [search,setSearch]=useState(state.viewport?.list?.search||'');
  const wrapper=useRef(null);
  const updateContext=values=>dispatch({type:'viewport',view:'list',viewport:{...(state.viewport?.list||{}),category,search,...values}});
  useEffect(()=>{const body=wrapper.current?.querySelector('.ant-table-body');if(body){body.scrollTop=state.viewport?.list?.scrollTop||0;body.scrollLeft=state.viewport?.list?.scrollLeft||0;}},[]);
  const allEntries=catalog(state.document);
  const entries=allEntries.filter(x=>(category==='all'||category==='primary'&&PRIMARY.includes(x.kind)||category==='children'&&['data-field','form-area','form-item'].includes(x.kind)||category==='relations'&&!PRIMARY.includes(x.kind)&&!['data-field','form-area','form-item'].includes(x.kind))&&`${businessLabel(allEntries,x)} ${KINDS[x.kind]}`.includes(search));
  return <div className="object-workspace" ref={wrapper} onScrollCapture={event=>{if(event.target.classList.contains('ant-table-body'))updateContext({scrollTop:event.target.scrollTop,scrollLeft:event.target.scrollLeft});}}><div className="object-toolbar"><Segmented aria-label="对象范围" value={category} onChange={value=>{setCategory(value);updateContext({category:value});}} options={[{value:'primary',label:'主要对象'},{value:'children',label:'字段与区域'},{value:'relations',label:'关系与生命周期'},{value:'all',label:'全部'}]} /><Input.Search aria-label="查找对象" placeholder="按名称或所属范围查找" value={search} onChange={e=>{setSearch(e.target.value);updateContext({search:e.target.value});}} style={{width:280}} />
    <Dropdown menu={{items:['behavior','data','form','term','relation'].map(kind=>({key:kind,label:`新增${KINDS[kind]}`})),onClick:({key})=>dispatch({type:'add',kind:key})}}><Button>＋ 新增对象 ▾</Button></Dropdown></div>
    <Table rowKey={entry=>selectKey(entry)} dataSource={entries} pagination={false} scroll={{y:550}} rowClassName={entry=>selectKey(entry)===selectKey(state.selection)?'selected-row':''} onRow={entry=>({onClick:()=>dispatch({type:'select',target:targetOf(entry)})})} columns={[
      {title:'对象',dataIndex:'label',render:(label,entry)=><Button type="link" className="object-name" onClick={event=>{event.stopPropagation();dispatch({type:'select',target:targetOf(entry)});}}>{businessLabel(allEntries,entry)}</Button>},
      {title:'类型',dataIndex:'kind',width:150,render:kind=>KINDS[kind]||kind},{title:'所属对象',dataIndex:'parentRef',width:250,render:ref=>ref?parentLabel(catalog(state.document),ref):'—'},
      ]} /></div>;
}

function Detail({state,dispatch,onReuse,reading}) {
  const target=state.selection;
  const isGrid=state.session?.kind==='grid';
  const detailTableId=isGrid?tableForTarget(target):null;
  const row=isGrid&&detailTableId?(state.session.tables?.[detailTableId]||[]).find(x=>x._row_id===target?.ref&&!x._deleted):null;
  const definition=isGrid?state.session.definitions?.find(x=>x.id===detailTableId):null;
  const detailDocument=isGrid?state.gridDraftDocument||state.document:state.document;
  const resolved=target?resolve(detailDocument,target):null;
  const entity=state.session?.kind==='object'&&state.session.added?state.session.values:resolved?.entity;
  const values=isGrid&&row?row:state.session?.kind==='object'?state.session.values:entity;
  const editing=isGrid&&Boolean(row)||state.editing&&state.session?.kind==='object';
  const descriptions=isGrid&&row&&definition?definition.columns.filter(column=>column.key!==definition.refField).map(column=>({...column,reference:column.technicalRef || /_refs?$/.test(column.key),options:gridOptions(column,state,row)})):state.session?.kind==='object'?state.session.fields:entity?fields(detailDocument,target,state.enums,globalThis):[];
  const entries=catalog(detailDocument);
  const label=values?.behavior_name||values?.data_name||values?.form_name||values?.area_title||values?.item_name||values?.field_name||values?.term_name || businessLabel(entries,target);
  const children=entries.filter(x=>target?.kind==='form-area'?x.kind==='form-item'&&x.areaRef===target.ref&&x.formRef===target.parentRef:x.parentRef===target?.ref&&['data-field','form-area','data-link','data-source','form-link','field-source','lifecycle-route','lifecycle-event'].includes(x.kind));
  const childKinds={data:['data-field','data-link','data-source','lifecycle-route'],form:['form-area','form-link'],'form-area':['form-item'],'form-item':['field-source'],'lifecycle-route':['lifecycle-event']}[target?.kind] || [];
  const summaryKeys=SUMMARY_KEYS[target?.kind];
  const summaryFields=descriptions.filter(field=>!summaryKeys||summaryKeys.includes(field.key));
  const auxiliaryFields=descriptions.filter(field=>summaryKeys&&!summaryKeys.includes(field.key));
  const summaryList=items=><dl className="object-summary">{items.map(field=><div key={field.key}><dt>{field.label}</dt><dd>{displayValue(readPath(values,field.key),field)}</dd></div>)}</dl>;
  useEffect(()=>{if(state.focus?.target?.ref===target?.ref&&state.focus.field){const input=document.getElementById(`detail-${state.focus.field}`);input?.focus();input?.scrollIntoView({block:'center'});}},[state.focus?.sequence,target?.ref]);
  const addChild=kind=>dispatch({type:'add',kind,parentRef:target.ref,formRef:target.kind==='form'?target.ref:target.formRef||target.parentRef,areaRef:target.kind==='form-area'?target.ref:undefined});
  return <aside className={`detail-panel ${state.detailExpanded?'expanded':''}`} aria-label="对象详情" inert={reading}>
    <header className="detail-heading"><div><small>{isGrid&&row?'批量工作副本':KINDS[target?.kind]||'对象'}{isGrid&&!row?' · 关联详情只读':''}</small><h2>{label||'对象详情'}</h2></div><Space size={4}><Button size="small" aria-label={state.detailExpanded?'缩小详情':'放大详情'} onClick={()=>dispatch({type:'expand-detail',value:!state.detailExpanded})}>{state.detailExpanded?'↙':'↗'}</Button><Button size="small" aria-label="收起详情" onClick={()=>dispatch({type:'close-detail'})}>✕</Button></Space></header>
    <div className="detail-body">
      {(!entity&&!row)?<Empty description="此对象缺失、关联无法唯一确定或所属范围不一致。原引用保持不变，请核对来源。" />:<>
        {target.parentRef&&<div className="identity-line">所属：{businessContext(entries,entries.find(entry=>selectKey(entry)===selectKey(target)) || target)}</div>}
        {!isGrid&&<div className="detail-actions"><Button type={editing?'default':'primary'} onClick={()=>dispatch({type:editing?'exit-edit':'edit'})}>{editing?'退出编辑':'编辑本对象'}</Button><Dropdown menu={{items:[{key:'delete',label:`删除${KINDS[target.kind]||'对象'}`,danger:true,disabled:target.kind==='process'}],onClick:()=>dispatch({type:'delete',target})}}><Button>更多 ▾</Button></Dropdown></div>}
        {isGrid&&row&&<div className="detail-actions"><Tag>与表格即时同步</Tag><Button danger size="small" onClick={()=>dispatch({type:'grid-delete',tableId:detailTableId,rowId:row._row_id})}>删除本记录</Button></div>}
        {editing?<Form layout="vertical" className="object-form" onFinish={()=>{}}>{descriptions.map(field=><Form.Item key={field.key} label={field.editor==='boolean'?null:field.label}><FieldInput id={`detail-${field.key}`} field={{...field,readOnly:field.readOnly||isGrid&&(detailTableId==='form_items'&&field.key==='item_type'&&Boolean(row?.data_field_ref)||row?._existing&&[definition?.parentKey,'form_ref'].includes(field.key))}} value={readPath(values,field.key)} onChange={value=>dispatch(isGrid?{type:'grid-update',tableId:detailTableId,rowId:row._row_id,column:field.key,value}:{type:'update',field:field.key,value})} /></Form.Item>)}</Form>:<>{summaryList(summaryFields)}{auxiliaryFields.length>0&&<Collapse ghost items={[{key:'attributes',label:'更多属性与说明',children:summaryList(auxiliaryFields)}]}/>}</>}
        {!isGrid&&editing&&<div className="apply-row"><Button aria-label="应用本对象修改" type="primary" loading={state.busy} disabled={!state.pending} onClick={()=>dispatch({type:'apply'})}>应用本对象修改</Button><Button disabled={!state.pending||state.busy} onClick={()=>dispatch({type:'cancel'})}>取消修改</Button></div>}
        {isGrid&&<p className="helper">请通过主表格的“应用全部表格修改”一次提交；切表、切记录及收起详情会保留整份副本。</p>}
        {!isGrid&&children.length>0&&<Collapse ghost items={[{key:'children',label:`所属子项与记录 · ${children.length}`,children:<div className="child-list">{children.map(entry=><Button type="text" key={selectKey(entry)} onClick={()=>dispatch({type:'select',target:targetOf(entry)})}><span>{KINDS[entry.kind]}</span>{businessLabel(entries,entry)}</Button>)}</div>}]} />}
        {!isGrid&&childKinds.length>0&&!state.session?.added&&<div className="child-additions">{childKinds.map(kind=><Button key={kind} onClick={()=>addChild(kind)}>＋ 新增{KINDS[kind]}</Button>)}{target.kind==='form-area'&&<Button onClick={()=>onReuse(target)}>引用已有对象字段</Button>}</div>}
        {!isGrid&&!state.session?.added&&<ReferenceSummary document={state.document} target={target} dispatch={dispatch} />}
      </>}
    </div>
  </aside>;
}

export default function Workbench({controller}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  const dispatch=action=>controller.dispatch(action);
  const fileInput=useRef(null); const [drawer,setDrawer]=useState(''); const [reading,setReading]=useState(false);
  const [preview,setPreview]=useState(null); const [fileError,setFileError]=useState(''); const fileReadSequence=useRef(0);
  const reuse=state.reusePicker?.target,fieldRefs=state.reusePicker?.fieldRefs||[],requiredByFieldRef=state.reusePicker?.requiredByFieldRef||{};
  const [systemReduced,setSystemReduced]=useState(false); const [pageReduced,setPageReduced]=useState(false);
  useEffect(()=>{const mq=matchMedia('(prefers-reduced-motion: reduce)');const handler=()=>setSystemReduced(mq.matches);handler();mq.addEventListener('change',handler);return()=>mq.removeEventListener('change',handler);},[]);
  useEffect(()=>{const warn=event=>{const current=controller.getSnapshot();if(current.pending||current.dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[controller]);
  useEffect(()=>{if(state.download)setDrawer('download');},[state.download?.exportedAt]);
  const reducedMotion=systemReduced||pageReduced;
  const selected=state.selection;
  const status=state.pending?'● 未应用修改':state.dirty?'● 已应用，尚未下载':state.download?'✓ 实际当前内容已下载':state.importInfo?'当前内容与导入文件一致':'草稿尚未下载';
  const fileItems=[{key:'new',label:'新建流程'},{key:'import',label:'导入 JSON 文件'},{type:'divider'},{key:'info',label:'来源与历史留存'},{key:'history',label:'撤销与重做'}];
  const openCheck=async()=>{const result=await dispatch({type:'check'});if(result?.ok&&!controller.getSnapshot().guard)setDrawer('check');};
  const listChanged=view=>dispatch({type:view==='grid'?'grid-start':'view',view});
  const referenceFields=state.document?catalog(state.document).filter(x=>x.kind==='data-field'):[];
  const actorClues=state.document?(state.document.flow_relations||[]).map(relation=>({relation,from:entityOf(state.document,{kind:'behavior',ref:relation.from_behavior_ref}),to:entityOf(state.document,{kind:'behavior',ref:relation.to_behavior_ref})})).filter(x=>x.from?.current_actor_role&&x.to?.current_actor_role&&x.from.current_actor_role!==x.to.current_actor_role):[];
  return <div className="workbench-shell">
    <header className="topbar"><div className="brand">流程编制<span>单流程草稿工作台</span></div><button disabled={reading} className="process-title" onClick={()=>state.document&&dispatch({type:'select',target:{kind:'process',ref:state.document.process.process_ref}})}>{state.document?.process?.process_name || '未命名流程'}</button><Tag className="document-status" color={state.pending?'warning':state.dirty?'processing':'success'}>{status}</Tag><div className="top-actions"><Dropdown disabled={reading} menu={{items:fileItems,onClick:({key})=>{if(key==='import')fileInput.current.click();else if(key==='new')dispatch({type:'new'});else setDrawer(key);}}}><Button>文件 ▾</Button></Dropdown><Button aria-label="检查" disabled={!state.document||reading} loading={state.busy} onClick={openCheck}>检查</Button><Button type="primary" disabled={!state.document||reading} onClick={async()=>{const result=await dispatch({type:'download'});if(result?.ok)setDrawer('download');}}>↓ 下载草稿</Button><Button onClick={()=>setDrawer('help')}>帮助与预览</Button></div></header>
    <input ref={fileInput} aria-label="导入文件" className="hidden-file" type="file" accept=".json,application/json" onChange={async event=>{
      const file=event.target.files[0];event.target.value='';if(!file)return;
      const sequence=++fileReadSequence.current,source=controller.getSnapshot();
      const sourceKey=s=>JSON.stringify([s.candidateKey,s.revision,s.session?.kind==='grid'?s.session.revision:s.session?.values,s.reusePicker]);
      const before=sourceKey(source);setFileError('');
      try{const text=await file.text();if(sequence!==fileReadSequence.current)return;if(sourceKey(controller.getSnapshot())!==before){setFileError('读取文件期间当前内容发生变化，已取消本次导入。请重新选择文件。');return;}dispatch({type:'import',text,fileName:file.name});}catch{if(sequence===fileReadSequence.current)setFileError('文件未能读取，当前内容保持不变。请确认文件可用后重新选择。');}
    }} />
    <nav className="workspace-nav"><Segmented disabled={reading} aria-label="主工作区" options={[{label:'流程图',value:'flow'},{label:'对象清单',value:'list'},{label:'批量表格',value:'grid'}]} value={state.view==='relations'?'flow':state.view||'flow'} onChange={listChanged} /><div className="context-trail">{selected?`${KINDS[selected.kind]||'对象'} · ${businessLabel(catalog(state.document),selected)}`:'选择图中的环节，按需查看详情'}</div>{state.view==='flow'&&<Space><Button disabled={reading||!state.document} onClick={()=>dispatch({type:'add',kind:'behavior'})}>＋ 新增环节</Button><Dropdown disabled={reading||!state.document} menu={{items:[{key:'relation',label:'新增环节流转'},{key:'data',label:'新增数据对象'},{key:'form',label:'新增表单／记录'},{key:'term',label:'新增术语'}],onClick:({key})=>dispatch({type:'add',kind:key})}}><Button>更多新增 ▾</Button></Dropdown></Space>}</nav>
    {state.error&&<Alert className="error-strip" title={messageForUser(state.document,state.error.message||state.error)} type="error" showIcon closable onClose={()=>dispatch({type:'clear-error'})} />}
    {fileError&&<Alert className="error-strip" title={fileError} type="error" showIcon closable onClose={()=>setFileError('')} />}
    {state.busy&&<div className="busy-strip">正在复核当前内容… <Button type="link" size="small" onClick={()=>dispatch({type:'cancel-async'})}>取消处理，保留输入</Button></div>}
    <main className={`main-workspace ${state.detailOpen&&selected?'has-detail':''} ${state.detailExpanded?'detail-expanded':''}`}>
      <section className="primary-workspace" aria-label="主画布">
        {!state.document?<div className="empty-zone"><Empty description="新建或导入一条流程，开始编制。内容仅存在当前页面，请主动下载保留。"><Space><Button type="primary" onClick={()=>dispatch({type:'new'})}>新建流程</Button><Button onClick={()=>fileInput.current.click()}>导入 JSON</Button></Space></Empty></div>:state.view==='list'?<ObjectList state={state} dispatch={dispatch}/>:state.view==='grid'?<GridWorkspace state={state} dispatch={dispatch}/>:<GraphWorkspace candidateKey={state.candidateKey} document={state.document} selection={selected} revision={state.revision} relationTarget={state.view==='relations'?state.relationTarget:null} onSelect={target=>dispatch({type:'select',target})} onDrill={target=>dispatch({type:'relations',target})} onReturn={()=>dispatch({type:'return-flow'})} viewport={state.viewport?.flow} onViewportChange={viewport=>dispatch({type:'viewport',view:'flow',viewport})} reducedMotion={reducedMotion} onReadingChange={setReading} appliedTarget={state.appliedTarget} appliedRevision={state.appliedRevision} />}
      </section>
      {state.detailOpen&&selected&&<Detail state={state} dispatch={dispatch} reading={reading} onReuse={target=>dispatch({type:'reuse-picker-open',target})} />}
    </main>
    <footer className="workspace-footer"><span>未审核草稿 · 请下载保留后交接核对</span><span>{state.pending?'未应用输入需要显式处理':state.checks?.stale?'检查结果已过期，请重新检查':state.checks?.issues?`当前检查：${state.checks.issues.length} 项提示`:'尚未检查'}</span></footer>
    <Modal open={Boolean(state.guard)} title={state.guard?.reason==='delete'?'核对删除影响':state.guard?.reason==='dirty'?'先保留尚未下载的内容':'先处理当前修改'} closable={false} maskClosable={false} keyboard={false} footer={<Space><Button disabled={state.busy} onClick={()=>dispatch({type:'resolve-guard',choice:'continue'})}>{state.guard?.reason==='delete'?'取消删除':'继续编辑'}</Button><Button disabled={state.busy} danger={state.guard?.reason==='delete'} onClick={()=>dispatch({type:'resolve-guard',choice:'discard'})}>{state.guard?.reason==='delete'?'确认删除':state.guard?.reason==='dirty'?'放弃未下载内容并继续':'放弃并继续'}</Button>{state.guard?.reason!=='delete'&&<Button aria-label={state.guard?.reason==='dirty'?'下载并继续':'应用并继续'} type="primary" loading={state.busy} onClick={()=>dispatch({type:'resolve-guard',choice:'apply'})}>{state.guard?.reason==='dirty'?'下载并继续':'应用并继续'}</Button>}</Space>}><p>{messageForUser(state.document,state.guard?.message||'此操作会离开当前编辑会话。请选择处理方式，失败或取消会保持当前位置与输入。')}</p>{state.session?.kind==='grid'&&<p>本次涉及全部表格的工作副本。</p>}</Modal>
    <Modal open={Boolean(state.importCandidates?.length)} title="选择要编制的一个流程" closable={false} maskClosable={false} keyboard={false} footer={<Button onClick={()=>dispatch({type:'cancel-import'})}>取消导入，保留当前内容</Button>}><p>此文件包含多个候选；请选择一个流程，系统不会自动选用第一个。</p><div className="child-list">{(state.importCandidates||[]).map((entry,index)=><Button key={index} onClick={()=>dispatch({type:'choose-import',index})}>{entry.process?.process_name||entry.document?.process?.process_name||`候选 ${index+1}`}</Button>)}</div></Modal>
    <Drawer title={drawer==='check'?'检查当前编制内容':drawer==='download'?'本次草稿下载':drawer==='info'?'来源与历史留存':drawer==='history'?'撤销与重做':'帮助与功能预览'} open={Boolean(drawer)} onClose={()=>setDrawer('')} size={drawer==='help'?600:520}>
      {drawer==='check'&&<><Alert title={state.checks?.stale?'检查结果已过期':'结构检查不表示业务审核'} description="结构问题不阻止下载草稿。请结合实际业务核对内容，下载后交由核对与审核人员处理。" type="info" showIcon /><div className="issue-list">{(state.checks?.issues||[]).map((issue,index)=><div className="issue-item" key={issue.queueKey||issue.id||index}><Tag color={issue.severity==='error'?'error':'warning'}>{issue.severity==='error'?'结构问题':'提示'}</Tag><p>{messageForUser(state.document,issue.message||issue.error)}</p><Button disabled={state.checks?.stale} onClick={async()=>{const result=await dispatch({type:'focus-issue',issue});if(result?.ok&&!controller.getSnapshot().guard)setDrawer('');}}>定位此问题</Button></div>)}{!state.checks?.issues?.length&&<Empty description="当前检查尚无提示；这不表示业务已验收。" />}</div><Collapse items={[{key:'cross',label:`执行主体差异线索 · ${actorClues.length}`,children:<><p className="helper">名称差异仅为核对线索，不能据此认定部门身份或跨部门交接。</p>{actorClues.length?actorClues.map(({relation,from,to})=><p key={relation.relation_ref}><Button type="link" onClick={()=>dispatch({type:'select',target:{kind:'relation',ref:relation.relation_ref}})}>{from.behavior_name} → {to.behavior_name}</Button><br/>{from.current_actor_role} → {to.current_actor_role}</p>):<p>当前记录未识别到不同执行主体线索；请依据实际业务继续核对。</p>}</>}]} /></>}
      {drawer==='download'&&<><Alert title="已发起本地草稿下载" description="请在浏览器下载记录中确认文件已经取得。文件未经审核，下载不代表检查通过。" type="success" showIcon/><dl className="object-summary"><div><dt>文件名</dt><dd>{state.download?.fileName}</dd></div><div><dt>导出时间</dt><dd>{state.download?.exportedAt?new Date(state.download.exportedAt).toLocaleString('zh-CN'):''}</dd></div><div><dt>文件大小</dt><dd>{state.download?.byteLength} 字节</dd></div></dl></>}
      {drawer==='info'&&<><p>来源与历史留存用于核对，不表示文件已经审核。</p><dl className="object-summary"><div><dt>来源文件</dt><dd>{state.importInfo?.fileName||'本页新建'}</dd></div><div><dt>文件格式处理</dt><dd>{state.importInfo?state.importInfo.sourceVersion!==state.importInfo.targetVersion?'历史文件已转换为当前支持的格式，原文件未修改':'导入文件格式已核对':'按当前支持格式编制'}</dd></div><div><dt>文件内记录的导出时间</dt><dd>{state.document?.export_meta?.exported_at?new Date(state.document.export_meta.exported_at).toLocaleString('zh-CN'):'尚未记录'}</dd></div></dl><Collapse items={[{key:'migration',label:'历史留存概况',children:<><p>留存内容继续随下载文件保留；具体事实请结合原始资料核对。</p><dl className="object-summary">{Object.entries({reference_materials:'参考资料',internal_process_calls:'内部流程调用线索',work_roles:'历史责任记录',unresolved_actor_roles:'待明确责任线索',unresolved_join_modes:'待明确汇合线索',legacy_cross_department_records:'历史跨部门记录'}).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{state.document?.migration?.[key]?.length||0} 项</dd></div>)}</dl></>}]} /></>}
      {drawer==='history'&&<Space direction="vertical"><p>撤销与重做只处理已应用的事务；当前可见未应用输入会先要求明确处理。</p><Space><Button onClick={()=>dispatch({type:'undo'})}>撤销上次应用</Button><Button onClick={()=>dispatch({type:'redo'})}>重做</Button></Space></Space>}
      {drawer==='help'&&<><Typography.Title level={4}>从流程图开始</Typography.Title><ol className="help-steps"><li>点击环节查看摘要；需要修改时进入“编辑本对象”。</li><li>逐项输入须显式应用；表格与旁边详情共用完整工作副本，一次应用全部修改。</li><li>沿引用查看关系；同名对象通过所属范围和业务说明区分。</li><li>检查与下载相互独立。下载未审核草稿后，再交接核对。</li></ol><div className="motion-setting"><Switch checked={pageReduced||systemReduced} disabled={systemReduced} onChange={setPageReduced}/><span>减少动态效果{systemReduced?'（跟随系统）':''}</span></div><Typography.Title level={4}>按需了解预览能力</Typography.Title><div className="preview-list">{PREVIEWS.map(([name,description])=><Button key={name} block onClick={()=>setPreview({name,description})}><span>{name}</span><Tag>预览</Tag></Button>)}</div></>}
    </Drawer>
    <Modal open={Boolean(preview)} title={`${preview?.name||''} · 预览`} onCancel={()=>setPreview(null)} footer={<Button onClick={()=>setPreview(null)}>了解</Button>}><p>{preview?.description}</p><p>此入口仅说明能力边界，不生成结果或业务状态。</p></Modal>
    <Modal open={Boolean(reuse)} title="引用已有对象字段" closable={false} maskClosable={false} keyboard={false} footer={<Space><Button onClick={()=>dispatch({type:'reuse-picker-cancel'})}>取消选择</Button><Button aria-label="建立所选引用" type="primary" disabled={!fieldRefs.length||fieldRefs.some(ref=>typeof requiredByFieldRef[ref]!=='boolean')} loading={state.busy} onClick={()=>dispatch({type:'reuse-picker-apply'})}>建立所选引用</Button></Space>}><p>字段定义来自数据对象；表单字段保留自身显示名称、必填性、填写说明及取值事实。</p><Select aria-label="引用对象字段" mode="multiple" value={fieldRefs} options={referenceFields.map(x=>({value:x.ref,label:businessLabel(catalog(state.document),x),disabled:x.ambiguous}))} onChange={values=>dispatch({type:'reuse-picker-update',fieldRefs:values,requiredByFieldRef:Object.fromEntries(values.filter(ref=>typeof requiredByFieldRef[ref]==='boolean').map(ref=>[ref,requiredByFieldRef[ref]]))})} style={{width:'100%'}}/><div className="reuse-required-list">{fieldRefs.map(ref=><div key={ref}><span>{businessLabel(catalog(state.document),{kind:'data-field',ref})}</span><Select aria-label={`必填性 ${businessLabel(catalog(state.document),{kind:'data-field',ref})}`} placeholder="请选择必填性" value={requiredByFieldRef[ref]} options={[{value:true,label:'必填'},{value:false,label:'非必填'}]} onChange={value=>dispatch({type:'reuse-picker-update',requiredByFieldRef:{...requiredByFieldRef,[ref]:value}})} style={{width:150}}/></div>)}</div></Modal>
  </div>;
}
