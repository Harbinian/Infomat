import {businessName,businessStatus,businessText,userMessage} from "./businessPresentation.js";
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {StatusPanel} from './components.jsx';
import {NativeDiagrams} from './NativeDiagrams.jsx';
import {canReadDataMap} from './handoffGovernancePresentation.js';
import {dataMapSelection,dataMapPageHref,dataMapReadPaths,dataMapStatus,dataMapHandoffLinks,dataMapViewNames} from './dataMapReadModel.js';
import './identity-directory.css';

const display=value=>value===null||value===undefined||value===''?'未记录':businessText(value);
const qualityNames={unchecked:'未检查',ok:'正常',warning:'需关注',warn:'需关注',error:'异常',blocked:'已阻断',pending:'待处理',rejected:'已驳回'};
const controlNames={controlled:'受控承接',prepared:'准备／维护状态',legacy:'旧结构状态（直写仍关闭）'};
const title=row=>businessName(row,'使用范围名称未记录');
const selection=()=>dataMapSelection(location.search);
function systems(value){let parsed=value;if(typeof value==='string'){try{parsed=JSON.parse(value);}catch{return display(value);}}return Array.isArray(parsed)?parsed.map(display).join('、')||'未记录':display(value);}

export function DataMapRead({api,user,draft,setDraft,fieldDraft,setFieldDraft,identityDraft,setIdentityDraft,onNavigate,onQueryChange}){
  const [chosen,setChosen]=useState(selection),[revision,setRevision]=useState(0),[state,setState]=useState({busy:true}),[download,setDownload]=useState({});
  const downloadController=useRef(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;downloadController.current?.abort();};},[]);
  useEffect(()=>{const update=()=>setChosen(selection());window.addEventListener('popstate',update);return()=>window.removeEventListener('popstate',update);},[]);
  useEffect(()=>{downloadController.current?.abort();},[chosen.view]);
  const requestKey=JSON.stringify(chosen);
  useEffect(()=>{
    const controller=new AbortController(),valid=()=>!controller.signal.aborted;
    setState({busy:true,requestKey});
    (async()=>{
      if(chosen.error)throw new Error(chosen.error);
      const paths=dataMapReadPaths(chosen),jobs=[api.request('/api/data-map-handoffs/workbench',{signal:controller.signal}),paths.contexts?api.request(paths.contexts,{signal:controller.signal}):api.request(paths.context,{signal:controller.signal})];
      const [discovery,read]=await Promise.allSettled(jobs);if(!valid())return;
      const base={requestKey,workbench:discovery.status==='fulfilled'?discovery.value:null,discoveryError:discovery.status==='rejected'?discovery.reason:null};
      if(read.status==='rejected'){setState({...base,error:read.reason});return;}
      const contexts=paths.contexts?read.value:[read.value];if(!Array.isArray(contexts))throw new Error('数据使用范围读取合同不完整，未将其解释为无记录。');
      let selected=contexts.find(row=>String(row.id||row.context_id)===chosen.context),missing=false;
      if(chosen.context&&!selected&&paths.contexts){try{selected=await api.request(paths.context,{signal:controller.signal});}catch(error){if(error.status!==404)throw error;missing=true;}}
      if(!valid())return;
      let fields=[],fieldError=null;
      if(selected&&dataMapStatus(selected,chosen.view).definitionAvailable&&paths.fields){try{fields=await api.request(paths.fields,{signal:controller.signal});if(!Array.isArray(fields))throw new Error('字段读取合同不完整，未将其解释为无字段。');}catch(error){fieldError=error;}}
      if(valid())setState({...base,contexts,selected,fields,fieldError,missing,readAt:Date.now()});
    })().catch(error=>{if(valid())setState({requestKey,error});});
    return()=>controller.abort();
  },[api,requestKey,revision]);
  const pending=state.busy||state.requestKey!==requestKey,selected=!pending&&!state.error?state.selected:null,fields=!pending&&!state.error?state.fields||[]:[];
  const capabilities=state.workbench?.capabilities,status=selected?dataMapStatus(selected,chosen.view):null,returnTo=dataMapPageHref(chosen);
  const links=useMemo(()=>dataMapHandoffLinks(selected,state.workbench,returnTo),[selected,state.workbench,returnTo]);
  function choose(next){
    const value={...chosen,...next,error:null};if(value.view==='current')value.version='';
    const checked=dataMapSelection(new URLSearchParams({view:value.view,...(value.context?{context:value.context}:{}),...(value.version?{version:value.version}:{}),...(value.identityField?{identityField:value.identityField}:{})}));
    if(checked.error)return;
    const url=new URL(location.href);for(const key of ['view','context','version','identityField']){if(checked[key])url.searchParams.set(key,checked[key]);else url.searchParams.delete(key);}
    if(onQueryChange)onQueryChange(url.pathname+url.search,false);else history.replaceState(history.state,'',url.pathname+url.search);setChosen(checked);
  }
  function follow(event,href){if(onNavigate)onNavigate(event,href);else{event.preventDefault();history.pushState(history.state,'',href);window.dispatchEvent(new PopStateEvent('popstate'));}}
  const mayExport=canReadDataMap(user);
  async function exportCurrent(){
    if(!mayExport||pending||state.error||chosen.view!=='current'||downloadController.current)return;
    const controller=new AbortController();downloadController.current=controller;setDownload({busy:true});
    try{const blob=await api.request('/api/export/excel?view=current',{signal:controller.signal,responseType:'blob'});if(controller.signal.aborted||downloadController.current!==controller||!mounted.current)return;if(!blob.size||!blob.type.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))throw new Error('未取得有效台账文件。');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='mdm-current-governed-field-ledger.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setDownload({message:'已将现行受控台账交给浏览器下载。未提交输入没有保存或清除。'});}catch(error){if(!controller.signal.aborted&&mounted.current)setDownload({error:error.message});}finally{if(downloadController.current===controller){downloadController.current=null;if(mounted.current)setDownload(value=>({...value,busy:false}));}}
  }
  function discardOld(kind){const label={context:'旧数据使用范围输入',identity:'旧字段身份输入',import:'旧字段文件选择'}[kind];if(window.confirm(`明确放弃${label}？此操作只清除当前浏览器内存中的输入；此前结果不明的提交仍须另行核对，不会撤销任何服务端记录。`)){({context:setDraft,identity:setIdentityDraft,import:setFieldDraft}[kind])?.(null);}}
  const fieldDraftOwned=!fieldDraft?.owner||fieldDraft.owner===`${user?.personId}:${user?.departmentId}`;
  return <div className="identity-module" data-map-state={pending?'loading':state.error?'error':'ready'}>
    <section className="card"><div className="section-heading"><h1>数据地图台账查阅</h1><button className="secondary" disabled={pending} onClick={()=>setRevision(value=>value+1)}>刷新数据地图</button></div>
      <p>本页展示已发布的数据地图内容及当前状态。需要修改数据定义、来源系统、使用范围或字段时，请进入对应的数据地图草稿，修改后重新核对、批准并发布。</p>
      <p className="muted">本页只供查阅和授权导出，不提供创建数据使用范围、Excel 直接导入、黄金源直写或旧身份确认入口。旧质量与确认记录保留，不提升为本次地图批准。</p>
      <p>读取范围：<strong>{dataMapViewNames[chosen.view]||'定位无效'}</strong>；办理控制：{controlNames[capabilities?.cutover_state]||'未取得控制信息'}。{capabilities?.enabled===false?'新承接办理尚未开启；台账读取不代表功能开启。':''}</p>
      {chosen.view!=='current'&&<p>历史内容只供查阅，能否再次使用须按当前条件核对。</p>}
      {chosen.error&&<button type="button" className="secondary" onClick={()=>choose({view:'current',context:'',version:'',identityField:''})}>返回现行台账列表</button>}
    </section>
    {(draft||identityDraft||fieldDraft)&&<section className="card" aria-label="已保留的旧入口输入"><h2>已保留的旧入口输入</h2><p>旧入口输入仍保留在原填写页面中，刷新台账及进入承接工作区不会自动提交、改绑或清除。旧维护入口已关闭；此前提交结果不明时，请使用原账号核对办理结果。</p><div className="actions">{draft&&<button type="button" className="secondary" onClick={()=>discardOld('context')}>明确放弃旧数据使用范围输入</button>}{identityDraft&&<button type="button" className="secondary" onClick={()=>discardOld('identity')}>明确放弃旧字段身份输入</button>}{fieldDraft&&(fieldDraftOwned?<button type="button" className="secondary" onClick={()=>discardOld('import')}>明确放弃旧字段文件选择</button>:<p>其他身份的旧文件或原请求已保留，当前身份不能查看、覆盖或清除。</p>)}</div></section>}
    {pending?<StatusPanel kind="loading" title="正在读取数据地图…"/>:state.error?<StatusPanel kind="error" title={state.error.status===403?'无权查看数据地图':'数据地图暂不可用'}>{userMessage(state.error)} 读取失败不表示没有记录；旧入口不会因此恢复。</StatusPanel>:<>
      <section className="card"><h2>数据使用范围</h2>{chosen.view==='current'?<label className="identity-field">数据使用范围<select aria-label="数据使用范围" value={chosen.context} onChange={event=>choose({context:event.target.value,version:'',identityField:''})}><option value="">请选择数据使用范围</option>{(state.contexts||[]).map(row=><option key={row.id||row.context_id} value={String(row.id||row.context_id)}>{title(row)} · {dataMapStatus(row,'current').label}{row.dept_name?`（${row.dept_name}）`:''}</option>)}</select></label>:<p>正在查阅所选数据使用范围的历史内容。</p>}
        {chosen.view==='current'&&!state.contexts?.length&&<p>当前可见范围未返回现行数据使用范围。旧数据和历史记录不能据此视为不存在。</p>}{state.missing&&<p role="status">指定数据使用范围不存在或不在当前可见范围，未读取其他数据使用范围替代。</p>}
        {selected&&<><h3>{title(selected)}</h3><p role="status" data-map-governance-status={status.code}><strong>{status.label}</strong>。{status.newReferenceAllowed?'本次读取时可供引用；实际使用前仍会核对最新条件。':'本次读取不提供新引用资格。'}</p>
          <dl style={{overflowWrap:'anywhere'}}>{[['归口部门',selected.dept_name||'部门名称未记录'],['来源文件',selected.source_file||'未记录']].map(([name,value])=><React.Fragment key={name}><dt>{name}</dt><dd>{display(value)}</dd></React.Fragment>)}</dl>
          {selected.reference_issues?.length>0&&<details><summary>准确引用状态问题（{selected.reference_issues.length}）</summary><ul>{selected.reference_issues.map((issue,index)=><li key={index}>{userMessage(issue.message,'相关内容的引用条件已变化，请进入对应草稿核对来源及影响。')}</li>)}</ul></details>}
          {status.code==='source_upgrade_pending'&&<p>原固定来源及既有内容保留；新版流程须主动建包并完成本次承接。本页未将原流程关系或旧字段当作新版关系。</p>}{status.code==='withdrawn'&&<p>原发布内容及已有引用保留；撤回后不会自动恢复上一版。</p>}
          <div className="actions">{links.map(link=><a key={link.kind} className="secondary button-link" href={link.href} onClick={event=>follow(event,link.href)}>{link.label}</a>)}{chosen.view==='current'&&selected.version_ref&&<button className="secondary" type="button" onClick={()=>choose({view:'history',version:selected.version_ref})}>查看该使用范围的历史内容</button>}{chosen.view!=='current'&&<button className="secondary" type="button" onClick={()=>choose({view:'current',version:''})}>查看该使用范围的当前状态</button>}</div>
          {!links.length&&<p className="muted">暂未取得对应办理入口，请返回数据地图承接工作区核对。</p>}
        </>}{state.discoveryError&&<p role="status">承接事项定位暂未取得，当前已读取的台账内容仍保留。</p>}
      </section>
      <section className="card"><h2>关联字段台账</h2>{!selected?<p>请先选择数据使用范围。</p>:chosen.view==='legacy_in_use'?<p data-map-legacy-fields-unknown>当前旧快照读取合同未提供可还原的固定字段集合，字段历史未知。本页未读取当前字段来拼装旧记录。</p>:!status.definitionAvailable?<p>当前数据使用范围没有可用的现行字段集合；请按上列准确状态办理。未使用旧发布或物理字段补值。</p>:state.fieldError?<StatusPanel kind="error" title="固定字段台账暂不可用">{userMessage(state.fieldError.message)} 读取失败不表示没有字段，未改用其他版本。</StatusPanel>:!fields.length?<p>当前固定发布清单未列出本数据使用范围的字段。</p>:<>
        <p>准确固定集合共 {fields.length} 个字段。质量状态与地图治理状态分别展示；来源系统和维护依据请查看对应发布内容。</p>
        <div className="identity-table" tabIndex={0} aria-label="关联字段台账"><table style={{tableLayout:'fixed',minWidth:1150}}><thead><tr>{['字段名称','业务含义','数据类型','地图治理状态','新引用资格','原质量状态'].map(name=><th scope="col" key={name}>{name}</th>)}</tr></thead><tbody>{fields.map(row=>{const current=dataMapStatus(row,chosen.view);return <tr key={row.id}>{[row.field_name_cn||row.name,row.business_definition||row.business_meaning,businessStatus(row.data_type||row.field_type),current.label,current.newReferenceAllowed?'可引用（实际操作仍须核验）':'不可新引用',qualityNames[row.quality_status]||'质量状态待核对'].map((value,index)=><td key={index} style={{overflowWrap:'anywhere'}}>{display(value)}</td>)}</tr>;})}</tbody></table></div>
        <details><summary>原台账消费信息</summary>{fields.map(row=><p key={row.id}>字段：{businessName(row)}；消费系统 {systems(row.consume_systems)}；同步方式 {display(row.sync_mode)}。这些固定信息不替代当前系统选型或来源权威决定。</p>)}</details>
      </>}</section>
    </>}
    <section className="card" aria-label="现行受控字段台账导出"><h2>导出现行受控字段台账</h2><p>按当前账号的可见部门范围导出现行固定字段及其版本、发布和追溯信息；不限于当前数据使用范围。历史视图与旧快照不混入现行导出，下载不提交或清除待办输入。</p><button className="secondary" type="button" disabled={!mayExport||pending||Boolean(state.error)||chosen.view!=='current'||download.busy} onClick={exportCurrent}>{download.busy?'正在准备台账…':'下载现行受控字段台账'}</button>{download.busy&&<button className="secondary" type="button" onClick={()=>downloadController.current?.abort()}>取消本次下载</button>}{download.error&&<p role="alert">{userMessage(download.error)}</p>}{download.message&&<p role="status">{userMessage(download.message)}</p>}</section>
    {!pending&&!state.error&&<NativeDiagrams api={api} onQueryChange={onQueryChange}/>}
    {!pending&&state.error&&<section className="card" aria-label="流程图读取受阻"><h2>流程图暂未取得</h2><p>{state.error.status===403?'当前身份不能通过此台账入口读取流程图。请返回本人工作台，打开已分派工作包的发布内容。':'数据地图读取失败，请先恢复上方台账读取后再查看流程图。'}读取受阻不表示没有流程或记录。</p><a href="/app/workbench" onClick={event=>follow(event,'/app/workbench')}>返回本人工作台</a></section>}
  </div>;
}
