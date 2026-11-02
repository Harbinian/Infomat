import {userMessage} from './businessPresentation.js';
import {businessFieldLabel,businessName,businessText} from "./businessPresentation.js";
import {directoryColumns,directoryFieldLabel,directoryImportColumns,directoryChangeName} from './directoryPresentation.js';
import {directoryDisplayValue as directoryValue,directoryHistoryTitle} from './directoryIdentityPresentation.js';
import {businessDateTime} from './businessGuidance.js';
import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { IdentityField as Field, IdentityTable as Table, identityFailure } from './IdentityShared.jsx';

const sourceLabel=value=>value==='directory-change.json'?'页面直接维护（没有导入文件）':businessText(value||'来源文件未记录');

export function DirectoryPublication({api,kind,draft,setDraft,onPublished,selectedId,onSelect,snapshot}) {
  const master=kind==='master_data';
  const title=master?'主数据':kind==='organization'?'组织架构':'花名册';
  const [catalog,setCatalog]=useState(null),[error,setError]=useState(null),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[detail,setDetail]=useState(null),[selected,setSelected]=useState(''),[message,setMessage]=useState('');
  const [downloadState,setDownloadState]=useState({});
  const [historySearch,setHistorySearch]=useState('');
  const alive=useRef(true), lock=useRef(false), detailRequest=useRef(null), downloadRequest=useRef(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;detailRequest.current?.abort();downloadRequest.current?.abort();downloadRequest.current=null;};},[]);
  useEffect(()=>{const controller=new AbortController();setCatalog(null);setDetail(null);detailRequest.current?.abort();setError(null);Promise.all([api.request('/api/publications/status?kind='+kind,{signal:controller.signal}),api.request('/api/publications?kind='+kind,{signal:controller.signal})]).then(([status,list])=>{if(!controller.signal.aborted)setCatalog({status,rows:list.rows});}).catch(e=>{if(!controller.signal.aborted)setError(e);});return()=>controller.abort();},[api,kind,revision]);
  function patch(values) {setDraft({...draft,...values,checked:null,confirmed:false,dirty:true,requestId:crypto.randomUUID()});setError(null);}
  function start(previous=null) {detailRequest.current?.abort();setDetail(null);setSelected('');setMessage('');setDraft({kind,title:previous?.title||title,file:null,sheetName:'',mapping:{},keyHeader:previous?.content.keyHeader||'',datasetKey:previous?.dataset_key||'',previousId:previous?.id||null,parsed:null,checked:null,confirmed:false,requestId:crypto.randomUUID(),reason:'',dirty:true});}
  async function newVersion(id) {
    if(lock.current||draft)return;
    lock.current=true;setBusy(true);setError(null);
    try {const previous=await api.request('/api/publications/'+id);if(alive.current){if(previous.kind!=='master_data')throw new Error('请选择主数据发布记录。');start(previous);}}
    catch(e){if(alive.current)setError(e);}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  function cancel() {if(!busy&&window.confirm('放弃当前尚未发布的导入内容？')){setDraft(null);setError(null);}}
  function form(extra={}) {const body=new FormData();body.append('file',draft.file);for(const [key,value] of Object.entries({kind,title:draft.title,reason:draft.reason||'',sheetName:draft.sheetName,datasetKey:master?draft.datasetKey:kind,keyHeader:draft.keyHeader||'',mapping:JSON.stringify(draft.mapping),...extra}))body.append(key,value);return body;}
  async function operation(action) {
    if(lock.current||!draft?.file)return;
    if(draft.file.size>5*1024*1024){setError({message:'文件超过 5MB，请缩减后重新选择。'});return;}
    lock.current=true;setBusy(true);setError(null);
    if(action!=='publish')setDraft({...draft,checked:null,confirmed:false,...(action==='parse'?{parsed:null}:{})});
    try {
      if(action==='parse') {
        const result=await api.request('/api/publications/parse',{method:'POST',body:form()});
        if(alive.current)setDraft({...draft,parsed:result,sheetName:result.sheetName,mapping:result.suggestedMapping,datasetKey:draft.datasetKey||result.datasetKey,keyHeader:result.headers.includes(draft.keyHeader)?draft.keyHeader:'',checked:null,confirmed:false,dirty:true});
      } else if(action==='preview') {
        const result=await api.request('/api/publications/preview',{method:'POST',body:form()});
        if(alive.current)setDraft({...draft,checked:result,confirmed:false});
      } else {
        if(!draft.confirmed||!draft.checked||draft.checked.errors.length||!catalog?.status.canPublish)return;
        const checked=draft.checked;
        const result=await api.request('/api/publications/publish',{method:'POST',body:form({checked:JSON.stringify({expectedLatestId:checked.expectedLatestId,baseHash:checked.baseHash,sourceHashVersion:checked.sourceHashVersion,contentHash:checked.contentHash}),requestId:draft.requestId,confirmed:'true'})});
        if(alive.current){setDraft(null);setMessage(`${result.title} v${result.version_no} 已发布，共 ${result.row_count} 行。`);setRevision(n=>n+1);onPublished();}
      }
    } catch(e) {if(alive.current){setError(e.code==='PUBLICATION_SOURCE_CHECK_EXPIRED'?{...e,directoryMessage:'目录核对方式已更新。当前文件、列对应关系和变更原因已保留，请重新核对后再保存。'}:e);if(action==='publish'&&e.status===409)setDraft({...draft,checked:null,confirmed:false,uncertain:false});else if(action==='publish'&&(!e.status||e.status>=500))setDraft({...draft,uncertain:true});}}
    finally {lock.current=false;if(alive.current)setBusy(false);}
  }
  async function view(id) {
    detailRequest.current?.abort();const controller=new AbortController();detailRequest.current=controller;setSelected(id);setDetail(null);setError(null);
    try {const result=await api.request('/api/publications/'+id,{signal:controller.signal});if(!controller.signal.aborted){if(result.kind!==kind)throw new Error('此版本不属于当前发布类型，请选择正确类型。');setDetail(result);}}catch(e){if(!controller.signal.aborted)setError(e);}
  }
  function cancelDownload() {
    downloadRequest.current?.abort();downloadRequest.current=null;
    setDownloadState({message:'已取消本次下载。当前导入输入保持不变。'});
  }
  async function download(url,filename,asJson=false) {
    if(!catalog||busy||downloadRequest.current)return;
    const controller=new AbortController();downloadRequest.current=controller;
    const pathname=location.pathname;
    const current=()=>alive.current&&!controller.signal.aborted&&downloadRequest.current===controller&&location.pathname===pathname;
    const mime=asJson?'application/json':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    setDownloadState({busy:true});
    try {
      const blob=await api.request(url,{responseType:'blob',signal:controller.signal,headers:{Accept:mime}});
      if(!current())return;
      if(!blob.size||blob.type.split(';')[0]!==mime)throw new Error(asJson?'服务器未返回有效的 JSON 文件。':'服务器未返回有效的 Excel 文件。');
      const objectUrl=URL.createObjectURL(blob),link=document.createElement('a');link.href=objectUrl;link.download=filename;
      link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
      setDownloadState({message:`已将 ${filename} 交给浏览器下载，请查看浏览器下载记录。`});
    } catch(e) {if(current())setDownloadState({error:`${identityFailure(e)} 未生成下载文件，可手动重试。`});}
    finally {if(downloadRequest.current===controller){downloadRequest.current=null;if(alive.current)setDownloadState(previous=>({...previous,busy:false}));}}
  }
  useEffect(()=>{if(selectedId!==undefined&&!draft){if(selectedId&&catalog)view(selectedId);else{detailRequest.current?.abort();setDetail(null);setSelected('');}}},[selectedId,catalog,draft]);
  return <section className="card"><h2>{title}{master?'导入与发布记录':'导入与维护记录'}</h2><p>{master?'导入核对与正式发布分开。管理员可准备并核对，正式发布由具备治理发布权限的业务账号办理。':'组织和花名册导入由行政人事维护角色办理；核对并发布后直接更新3000目录，记录原因与修改前后内容。'}历史版本保留原始列和值。</p>
    {message&&<StatusPanel title={message}/>}{error&&<StatusPanel kind="error" title="目录导入或读取未完成" onRetry={()=>setRevision(n=>n+1)}>{error.code==='PUBLICATION_DUPLICATE_KEY'?'唯一标识重复（忽略首尾空格和大小写后比较），请修正文件再读取。':error.status===422?'文件或列映射未通过校验。请核对发布名称、工作表、唯一标识、重复编码及必填列，再重新读取或核对。':identityFailure(error)}</StatusPanel>}
    {!catalog&&!error&&<StatusPanel kind="loading" title="正在读取发布状态…"/>}
    {catalog&&!catalog.status.ready&&<StatusPanel title="发布记录表尚未准备"/>}
    <div className="identity-actions"><button disabled={busy} onClick={()=>{detailRequest.current?.abort();setDetail(null);setSelected('');setRevision(n=>n+1);}}>刷新发布记录</button>{catalog?.status.canPrepare&&!draft&&<button onClick={()=>start()}>手工导入{title}</button>}{catalog&&<button type="button" disabled={busy||downloadState.busy} onClick={()=>download('/api/publications/template?kind='+kind,kind+'-template.xlsx')}>下载{title}空白模板</button>}{downloadState.busy&&<button type="button" onClick={cancelDownload}>取消下载</button>}</div>
    {downloadState.busy&&<StatusPanel kind="loading" title="正在准备下载…"/>}{downloadState.error&&<StatusPanel kind="error" title="下载未完成">{userMessage(downloadState.error)}</StatusPanel>}{downloadState.message&&<StatusPanel title={downloadState.message}/>}
    {draft&&<div data-directory-import="true"><p>支持 .xlsx 或 UTF-8 CSV，最多 5MB、5000 行、64 列。第一行为列名，工号和编码建议设为文本。</p>{!master&&<p>首次导入顺序：部门 → 花名册 → 办公室及负责人 → 再次导入花名册补充办公室归属。</p>}<p>{master?'每次新建导入形成独立数据集；导入新版沿用所选数据集和唯一标识列。新版移除的行仍保留在历史版本，不删除对象台账记录。':kind==='roster'?'按工号新增或更新人员；办公室编码可用分号分隔。未映射办公室列保留既有归属，映射列的空值表示移除归属。账号另行管理。':'部门与办公室按明确编码建立层级；办公室填写归口部门编码和负责人工号。未出现的组织继续保留。'}</p>
      <fieldset disabled={busy||draft.uncertain}><legend>导入内容</legend><div className="identity-fields"><Field label="发布名称" autoFocus value={draft.title} maxLength={255} onChange={e=>patch({title:e.target.value})}/><Field label="选择目录文件" type="file" accept=".xlsx,.csv" onChange={e=>{const file=e.target.files[0];if(!file)return;if(draft.parsed&&!window.confirm('替换文件会清除当前列对应关系和核对结果，是否继续？')){e.target.value='';return;}patch({file,parsed:null,sheetName:'',mapping:{}});}}/></div>{!master&&<Field label="目录导入原因" value={draft.reason||''} maxLength={2000} onChange={e=>patch({reason:e.target.value})}/>}
      {draft.file&&<p>已选择：{draft.file.name}（{draft.file.size} 字节）。文件仅在当前页面内存中保留。</p>}
      {draft.parsed?.sheets.length>1&&<Field label="工作表"><select value={draft.sheetName} onChange={e=>{if(window.confirm('切换工作表会清除当前列对应关系和核对结果，是否继续？'))patch({sheetName:e.target.value,parsed:null,mapping:{}});}}>{draft.parsed.sheets.map(s=><option key={s}>{s}</option>)}</select></Field>}
      <button disabled={!draft.file} onClick={()=>operation('parse')}>读取文件</button>
      {draft.parsed&&<><h3>确认列对应关系</h3><div className="identity-fields">{master&&<Field label="唯一标识列（必填）"><select value={draft.keyHeader||''} onChange={e=>patch({keyHeader:e.target.value})}><option value="">请选择文件列</option>{directoryImportColumns(draft.parsed.headers,!master).map(column=><option key={column.index} value={column.field}>{column.label}</option>)}</select></Field>}{draft.parsed.fields.map(f=><Field key={f.key} label={(master?businessText(f.label):directoryFieldLabel(f.key))+(f.required?'（必填）':'（可不映射）')}><select value={draft.mapping[f.key]||''} onChange={e=>patch({mapping:{...draft.mapping,[f.key]:e.target.value}})}><option value="">不映射</option>{directoryImportColumns(draft.parsed.headers,!master).map(column=><option key={column.index} value={column.field}>{column.label}</option>)}</select></Field>)}</div><p>未映射原始列仍保留在发布版本中。文件行数：{draft.parsed.rows.length}。</p><PagedContent content={draft.parsed} directory={!master} snapshot={snapshot}/><button onClick={()=>operation('preview')}>核对导入内容</button></>}
      {draft.checked&&<div data-directory-checked="true"><h3>核对变更结果</h3><p>新增 {draft.checked.summary.added} 行 · 更新 {draft.checked.summary.updated} 行 · 无变化 {draft.checked.summary.unchanged} 行{master&&` · 新版移除 ${draft.checked.summary.removed} 行`}</p>{master&&<p>以上数量已与最新版本核对；当前核对结果不含主数据逐行差异。发布前请结合文件内容与历史版本复核。</p>}{draft.checked.errors.length>0?<ul>{draft.checked.errors.map((e,i)=><li key={i}>{e.row?`第 ${e.row} 行：`:''}{userMessage(e.message)}</li>)}</ul>:<label><input type="checkbox" checked={draft.confirmed} onChange={e=>setDraft({...draft,confirmed:e.target.checked})}/>我已核对文件、列对应关系和变更结果，确认发布此版本。</label>}
        <Table headers={['文件行','变更对象','动作','变更前 → 变更后']} rows={(draft.checked.changes||[]).filter(r=>r.action!=='unchanged').map(r=>[r.row,master?businessText(r.key):directoryChangeName(r,snapshot),r.action==='added'?'新增':r.action==='removed'?'移除':'更新',r.fields.filter(f=>master||f.field!=='code').map(f=>master?`${businessFieldLabel(f.field)||'相关资料'}：${f.before??'空'} → ${f.after??'空'}`:`${directoryFieldLabel(f.field)}：${directoryValue(f.field,f.before,snapshot)} → ${directoryValue(f.field,f.after,snapshot)}`).join('；')])}/>
      </div>}
      <div className="identity-actions"><button onClick={cancel}>取消目录导入</button><button disabled={!draft.confirmed||!draft.checked||draft.checked.errors.length>0||!catalog?.status.canPublish||(!master&&!draft.reason?.trim())} onClick={()=>operation('publish')}>{busy?'正在处理…':master?'发布此主数据版本':'发布此目录版本'}</button></div>{!catalog?.status.canPublish&&<p>当前身份无正式发布权限，可以保留并核对本次输入。</p>}
      </fieldset>{draft.uncertain&&<StatusPanel kind="error" title="发布结果暂未确认">文件、列对应关系及原因已保留。继续办理将核对原结果；此前尚未发布时，本次可能完成发布。<button type="button" disabled={busy} onClick={()=>operation('publish')}>继续发布并核对结果</button></StatusPanel>}</div>}
    {catalog&&<div data-publication-catalog="true">{!master&&!catalog.status.canReadDirectoryHistory&&<p>当前身份可查看发布记录摘要，完整目录内容和变更追溯由行政人事维护角色查阅。</p>}<p>当前显示最近 {catalog.rows.length} 份发布记录，最多 200 份；这不是全部历史数量。</p>{!master&&<Field label="搜索维护或导入记录" value={historySearch} placeholder="员工姓名、工号、变更原因或文件名" onChange={event=>setHistorySearch(event.target.value)}/>}<Table headers={[master?'发布名称':'记录名称',...(!master?['变更原因']:[]),'行数','源文件','发布时间','操作']} empty={`还没有${title}发布版本`} rows={catalog.rows.filter(r=>master||!historySearch||[directoryHistoryTitle(r),r.history_summary?.reason,sourceLabel(r.source_file_name)].join(' ').toLowerCase().includes(historySearch.toLowerCase())).map(r=>[directoryHistoryTitle(r),...(!master?[r.history_summary?.reason?businessText(r.history_summary.reason):r.source_file_name==='directory-change.json'?'变更原因未记录':'请在导入版本中查看']:[]),r.row_count,sourceLabel(r.source_file_name),businessDateTime(r.published_at),<div key={r.id} className="identity-actions"><button disabled={Boolean(draft)||busy||(!master&&!catalog.status.canReadDirectoryHistory)} onClick={()=>onSelect?onSelect(r.id):view(r.id)}>{r.source_file_name==='directory-change.json'?'查看这次目录变更':'查看此导入版本'}</button>{master&&catalog.status.canPrepare&&<button disabled={Boolean(draft)||busy} onClick={()=>newVersion(r.id)}>导入新版 {businessName(r)}</button>}</div>])}/></div>}
    {selected&&!detail&&!error&&<StatusPanel kind="loading" title="正在读取历史版本…"/>}
    {detail&&<div data-publication-detail="true"><h3>{directoryHistoryTitle({...detail,history_summary:detail.source_file_name==='directory-change.json'?detail.audit:undefined})}</h3><p>{sourceLabel(detail.source_file_name)}</p>{detail.audit&&<div data-directory-audit><h4>本次变更结果</h4><p>操作人：{detail.audit.actor_name?businessText(detail.audit.actor_name,'当时的操作人姓名未记录'):'当时的操作人姓名未记录'} · 时间：{businessDateTime(detail.audit.operated_at||detail.published_at)}</p><p>原因：{businessText(detail.audit.reason||'历史记录未提供')}</p><Table headers={['记录','字段','修改前','修改后']} rows={(detail.audit.changes||[]).flatMap(change=>(change.fields||[]).filter(field=>field.field!=='code').map(field=>[directoryChangeName(change,{},true),directoryFieldLabel(field.field),directoryValue(field.field,field.before,{},true),directoryValue(field.field,field.after,{},true)]))}/></div>}{!master&&<><h4>保留的原始资料</h4><p>下表按业务名称展示这次维护或导入的资料，用于追溯来源，不代表当前目录。原始列和值仍保留在下载文件中。历史部门、办公室或负责人只有编码而未记录名称时，会明确提示缺少名称，不用当前名称补写。请结合上方“本次变更结果”核对实际变更；没有变更追溯的旧版本，不能据此补推当时的结果。</p></>}<PagedContent content={detail.content} directory={!master} historical/><div className="identity-actions"><button type="button" disabled={busy||downloadState.busy} onClick={()=>download(`/api/publications/${detail.id}/download`,`${detail.title}.xlsx`)}>下载此版本 Excel</button><button type="button" disabled={busy||downloadState.busy} onClick={()=>download(`/api/publications/${detail.id}/download?format=json`,`${detail.title}-v${detail.version_no}.json`,true)}>下载完整记录文件</button></div></div>}
  </section>;
}
function PagedContent({content,directory=false,snapshot,historical=false}) {
 const [page,setPage]=useState(0);useEffect(()=>setPage(0),[content]);const start=page*50;
 const columns=directory?directoryColumns(content.headers):directoryImportColumns(content.headers,false);
 return <><Table headers={['文件行',...columns.map(column=>column.label)]} rows={content.rows.slice(start,start+50).map((row,index)=>[content.sourceRows?.[start+index]||start+index+2,...columns.map(column=>directory?directoryValue(column.field,row[column.index],snapshot,historical):row[column.index])])}/><div className="identity-actions"><button disabled={!page} onClick={()=>setPage(value=>value-1)}>上一页</button><span>{content.rows.length?start+1:0}–{Math.min(start+50,content.rows.length)} / {content.rows.length}</span><button disabled={start+50>=content.rows.length} onClick={()=>setPage(value=>value+1)}>下一页</button></div></>;
}
