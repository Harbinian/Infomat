import {BusinessRecordPicker} from "./BusinessDetails.jsx";
import {businessName,businessText,userMessage} from "./businessPresentation.js";
import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';

const root = '/api/master-data-template';
const rowKey = row => `${row.record_type}:${row.source_row}`;
export function TemplateImport({api,draft,setDraft}) {
  const [capability,setCapability] = useState(null), [error,setError] = useState(null), [busy,setBusy] = useState(false);
  const [source,setSource] = useState(null), [view,setView] = useState(null);
  const active=useRef(null),generation=useRef(0),fileInput=useRef(null),selectButton=useRef(null);
  const data=draft||{},selection=data.selections||{};
  useEffect(()=>{
    const controller=new AbortController();
    api.request(root+'/capabilities',{signal:controller.signal}).then(setCapability).catch(e=>{if(e.name!=='AbortError')setError(e);});
    return ()=>{controller.abort();active.current?.abort();generation.current++;};
  },[api]);
  const update=patch=>setDraft(previous=>({...previous,...patch}));
  function invalidate(patch) { generation.current++;active.current?.abort();setBusy(false);setError(null);setSource(null);setView(null);update({...patch,prepared:null,result:null,requestId:null}); }
  function selectFile(event) {
    const file=event.target.files?.[0];event.target.value='';
    if(!file)return;
    if(data.file&&!window.confirm('更换文件会放弃当前预览和关联选择。是否明确更换？'))return;
    invalidate({file,selections:{},parsed:null,ownerPersonId:capability.personId});
  }
  function links() {
    return Object.entries(selection).filter(([,v])=>v.mode==='revision').map(([key,value])=>{
      if(!value.checked||String(value.checked.entity_id)!==String(value.target))throw new Error('请先核对每项已选择的对象或字段，再检查文件。');
      const [record_type,row]=key.split(':');
      return {record_type,source_row:Number(row),entity_id:value.checked.entity_id,expected_revision:value.checked.revision_no};
    });
  }
  async function run(action) {
    if(busy)return;
    setBusy(true);setError(null);const token=++generation.current;
    const controller=new AbortController();active.current=controller;
    try { await action(controller.signal,()=>token===generation.current); }
    catch(e){if(e.name!=='AbortError'&&token===generation.current)setError(e);}
    finally {if(token===generation.current)setBusy(false);}
  }
  function preview() { run(async(signal,current)=>{
    const body=new FormData();body.append('file',data.file);body.append('options',JSON.stringify({links:links()}));
    const prepared=await api.request(root+'/preview',{method:'POST',body,signal});
    if(current())update({prepared,parsed:prepared.preview,requestId:crypto.randomUUID(),result:null});
  }); }
  function checkTarget(row) {run(async(signal,current)=>{
    const key=rowKey(row),target=selection[key]?.target;
    if(!/^[1-9]\d*$/.test(target||''))throw new Error('请先按名称选择已有对象或字段。');
    const found=await api.request(`${root}/definition/${row.record_type}/${target}?view=current`,{signal});
    if(current())update({prepared:null,selections:{...selection,[key]:{...selection[key],checked:found}}});
  });}
  const parsed=data.parsed;
  function record(row) {
    const key=rowKey(row),choice=selection[key]||{mode:'new'};
    return <article className="import-record" key={key}>
      <div className="section-heading"><h3>{businessText(row.values.name,'对象或字段名称未记录')}</h3><span className="badge">待核实</span></div>
      <p>{row.record_type==='object'?'对象':'字段'} · {businessText(row.sheet_name)} 第 {row.source_row} 行</p>
      <p>来源：{businessText(row.values.source_location||row.values.value_source_description||'待补充')}</p>
      <details><summary>查看填报内容与源单元格</summary><dl className="source-values">{row.cells.map(cell=><div key={cell.address}><dt>{businessText(cell.original_column)} · {businessText(cell.address)}</dt><dd>{cell.normalized_value===null?'未填':businessText(cell.normalized_value,'该单元格含不能直接展示的技术内容，请核对原文件；原值仍保留。')}</dd></div>)}</dl></details>
      <label>核对方式：<select aria-label={row.values.name+'核对方式'} disabled={busy||Boolean(data.result)} value={choice.mode} onChange={e=>invalidate({selections:{...selection,[key]:{mode:e.target.value,target:''}}})}><option value="new">单独核对本次{row.record_type==='object'?'对象':'字段'}</option><option value="revision">关联已有{row.record_type==='object'?'对象':'字段'}进行对照</option></select></label>
      {choice.mode==='revision'&&<div className="target-choice"><BusinessRecordPicker api={api} label={row.record_type==='object'?'选择已有对象':'选择已有字段'} kind={row.record_type==='object'?'object':'field'} value={choice.target} disabled={busy||Boolean(data.result)} onChange={target=>invalidate({selections:{...selection,[key]:{...choice,target,checked:null}}})}/><button className="secondary" disabled={busy||Boolean(data.result)} onClick={()=>checkTarget(row)}>核对 {businessText(row.values.name,'本条记录')} 关联</button>{choice.checked&&<p>已核对：{businessName(choice.checked.definition)}。本次仅核对所选记录的对应关系，不保存修订。</p>}</div>}
    </article>;
  }
  if(!capability)return <StatusPanel kind={error?'error':'loading'} title={error?'当前无法导入':'正在核对导入权限…'}>{userMessage(error?.message||'请稍候。')}</StatusPanel>;
  if(data.file&&data.ownerPersonId!==capability.personId)return <section className="card"><h2>当前身份已变化</h2><p>上一身份的未提交文件仍在内存中，当前身份不能查看或导入。请重新登录原身份继续，或明确放弃后重新选择。</p><button className="secondary" onClick={()=>{if(window.confirm('是否明确放弃上一身份的未提交文件？'))setDraft(null);}}>放弃上一身份的文件</button></section>;
  return <>
    <section className="card"><h2>Excel模板核对预览</h2><p>选择已填报的 Excel 文件，核对对象、字段、来源与关联。检查文件只生成预览，不保存新对象、字段或批准；原文件需要修正时，可返回源文件修改后重新选择。</p><p>当前已采用受控治理，本页不再直接确认导入。文件内的关联用于核对本次填报内容；同名对象不会自动合并。</p>
      {!capability&&!error&&<StatusPanel kind="loading" title="正在核对导入权限…"/>}
      {capability&&<><input ref={fileInput} className="visually-hidden" type="file" accept=".xlsx" onChange={selectFile} tabIndex={-1} aria-label="选择主数据模板文件"/><div className="import-actions"><button ref={selectButton} className="secondary" disabled={busy} onClick={()=>fileInput.current.click()}>{data.file?'更换模板文件':'选择模板文件'}</button><button className="primary" disabled={!data.file||busy||Boolean(data.result)} onClick={preview}>{busy?'正在处理…':'检查文件与关联'}</button>{data.file&&<button className="secondary" disabled={busy} onClick={()=>{if(data.result){setDraft(null);setSource(null);setView(null);setError(null);return;}if(window.confirm('是否放弃当前文件、预览及关联选择？')){invalidate({file:null,parsed:null,selections:{}});setDraft(null);}}}>{data.result?'结束查看':'取消本次预览'}</button>}</div></>}
      {data.file&&<p className="file-name">当前文件：<strong>{businessText(data.file.name,'所选模板文件')}</strong>（{data.file.size} 字节）</p>}
      {error&&<StatusPanel kind="error" title="操作未完成">{userMessage(error)}</StatusPanel>}
      {Array.isArray(error?.fieldErrors)&&<ul>{error.fieldErrors.map((item,i)=><li key={i}>{item.sheet_name} {item.address||item.row}：{userMessage(item.message)}</li>)}</ul>}
      {data.file&&!data.result&&<p className="input-notice">文件和关联选择保留在当前页面内存中。检查文件不会入库；失败后可明确重试。</p>}
    </section>
    {parsed&&<>
      <section className="card"><h2>检查结果</h2><p>业务对象 {parsed.summary.object_count} 个，业务字段 {parsed.summary.field_count} 个；示例 {parsed.summary.example_rows} 行、预留 {parsed.summary.reserved_rows} 行均不计入。</p>
        {parsed.issues.length>0&&<ul className="import-issues">{parsed.issues.map((item,i)=><li key={i}><strong>{item.severity==='error'?'需修正':'核对提示'}</strong> · {item.sheet_name} {item.address||item.row||''}：{userMessage(item.message)}</li>)}</ul>}
        {parsed.status==='empty'&&<StatusPanel title="没有可导入的业务记录">请在源文件填写对象和字段后重新选择。</StatusPanel>}
        <button className="secondary" disabled={busy||Boolean(data.result)} onClick={()=>{update({prepared:null});selectButton.current?.focus();}}>返回修正，保留当前文件</button>
      </section>
      <section className="card"><h2>对象与字段</h2>{parsed.objects.map(object=><div key={object.source_row} className="import-object">{record(object)}<div className="import-fields">{parsed.fields.filter(f=>f.object_source_row===object.source_row).map(record)}</div></div>)}{parsed.fields.filter(f=>f.object_source_row===null).map(record)}</section>
      {!data.result&&<section className="card"><h2>核对后的办理</h2><p>本次文件、原值和关联选择仍保留在页面内存中。请保留原 Excel 文件；如需形成正式成果，后续在“正式数据治理工作包”或“数据地图承接工作区”按具体事项办理。</p><p>本页不保存预览结果，也不会自动建立工作包、承接草案或发布记录。</p></section>}
    </>}
    {data.result&&<section className="card"><h2>{data.result.duplicate?'该批次原已导入，原结果保留':'原导入结果，待核实'}</h2><p>保留原导入结果及来源供查阅，不表示已经完成当前受控治理。正式办理请进入对应工作包或承接事项。</p>{data.result.mappings.filter(m=>m.record_type==='object').map(m=><p key={m.entity_id}><a href={'/app/objects?object='+m.entity_id}>查看原导入对象</a></p>)}<button className="secondary" disabled={busy} onClick={()=>run(async(signal,current)=>{const value=await api.request(root+'/source/'+data.result.batch_id,{signal});if(current())setSource(value);})}>重新查询对象、字段与来源</button>
      {source&&<><p>已从服务器重新读取 {source.mappings.length} 条映射、{source.cells.length} 个源单元格。</p><ul>{source.mappings.map(item=><li key={item.mapping_id}><button className="text-button" onClick={()=>run(async(signal,current)=>{const value=await api.request(root+'/version/'+item.platform_version_id,{signal});if(current())setView(value);})}>{businessName(item)} → 平台{item.record_type==='object'?'对象':'字段'} {businessName(item)}</button><span> · {item.sheet_name} 第 {item.source_row} 行：{source.cells.filter(c=>item.source_cell_ids.includes(c.cell_id)).map(c=>c.cell_address).join('、')}</span></li>)}</ul></>}
      {view&&<div className="import-record"><h3>{view.definition.name}</h3><p>内容待核实</p><p>{view.definition.business_meaning}</p></div>}
    </section>}
  </>;
}
