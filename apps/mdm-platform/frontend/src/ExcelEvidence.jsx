import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';

export function ExcelEvidence({ api, draft, setDraft, batchId, canWrite, onRegistered }) {
  const [meta,setMeta]=useState(null),[page,setPage]=useState(null),[cell,setCell]=useState(null),[sheet,setSheet]=useState(''),[offset,setOffset]=useState(0),[error,setError]=useState(null),[busy,setBusy]=useState(false);
  const serial=useRef(0),pending=useRef(null),fileInput=useRef(null);
  useEffect(()=>()=>{pending.current?.abort();serial.current++;},[]);
  const d=draft?.excel||{file:null,kind:'definition',ref:'',sheet:'',address:'',basis:'',requestId:crypto.randomUUID()};
  const endpoint='/api/analysis/materials/excel';
  useEffect(()=>{setMeta(null);setPage(null);setCell(null);setSheet('');setOffset(0);},[batchId,api]);
  useEffect(()=>{
    const c=new AbortController(),s=++serial.current;pending.current?.abort();pending.current=c;
    if(!batchId)return()=>c.abort();
    setBusy(true);setError(null);setCell(null);setPage(null);
    (async()=>{const m=await api.request(endpoint+'/'+batchId,{signal:c.signal});const p=sheet?await api.request(endpoint+'/'+batchId+'?'+new URLSearchParams({sheet,offset}),{signal:c.signal}):null;if(s!==serial.current||c.signal.aborted)return;setMeta(m);setPage(p);})().catch(e=>{if(!c.signal.aborted)setError(e);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});
    return()=>c.abort();
  },[api,batchId,sheet,offset]);
  function edit(k,v){setDraft({...draft,dirty:true,excel:{...d,[k]:v,requestId:crypto.randomUUID()}});}
  async function upload(e){e.preventDefault();if(busy)return;setBusy(true);setError(null);const c=new AbortController();pending.current?.abort();pending.current=c;
    try{if(!d.file)throw new Error('请选择 .xlsx 文件。');const body=new FormData();body.append('file',d.file);body.append('request_id',d.requestId);
      const links=d.ref||d.sheet||d.address||d.basis?[{kind:d.kind,ref_id:d.ref,sheet_name:d.sheet,cell_address:d.address,basis:d.basis}]:[];
      body.append('links',JSON.stringify(links));const result=await api.request(endpoint,{method:'POST',body,signal:c.signal});if(c.signal.aborted)return;if(fileInput.current)fileInput.current.value='';setDraft({...draft,excel:null,dirty:!!draft?.description});onRegistered(result.batch_id);
    }catch(e){if(!c.signal.aborted)setError(e);}finally{if(!c.signal.aborted)setBusy(false);}
  }
  async function locate(address){if(busy)return;setBusy(true);setError(null);const c=new AbortController();pending.current?.abort();pending.current=c;try{const r=await api.request(endpoint+'/'+batchId+'?'+new URLSearchParams({sheet,address}),{signal:c.signal});if(!c.signal.aborted)setCell(r.cell);}catch(e){if(!c.signal.aborted)setError(e);}finally{if(!c.signal.aborted)setBusy(false);}}
  return <section className="card" aria-label="Excel证据"><h2>Excel 证据读取</h2><p>读取 .xlsx 单元格及公式缓存；不建立业务台账、不计算公式。原文件不修改，登记后保存固定读取快照。</p>
    {error&&<StatusPanel kind="error" title="Excel 操作未完成，输入保留">{error.message} {error.code}</StatusPanel>}
    <form onSubmit={upload}><fieldset disabled={busy||!canWrite||!!draft?.review||!!draft?.task||!!draft?.closure||!!draft?.pdf||!!draft?.word}>
      <label className="management-input">Excel 文件<input ref={fileInput} aria-label="Excel 文件" type="file" accept=".xlsx" onChange={e=>edit('file',e.target.files[0]||null)}/></label>{d.file&&<p>待登记：{d.file.name}</p>}
      <details><summary>显式关联固定对象、字段或 V7 来源（可留空）</summary><p>只登记你明确给出的对应关系，不按名称匹配。修改关联需重新登记为独立证据批次，历史批次保留。</p>
        <label className="management-input">关联类型<select aria-label="Excel 关联类型" value={d.kind} onChange={e=>edit('kind',e.target.value)}><option value="definition">对象或字段固定版本</option><option value="mapping">V7 映射固定版本</option><option value="v7_source">V7 固定来源</option></select></label>
        {[['ref','固定版本或来源 ID'],['sheet','关联工作表名称'],['address','关联单元格地址'],['basis','关联依据']].map(([k,title])=><label className="management-input" key={k}>{title}<input aria-label={'Excel '+title} value={d[k]} maxLength={k==='basis'?1000:128} onChange={e=>edit(k,e.target.value)}/></label>)}
      </details><button type="submit" className="primary">登记 Excel 证据</button>
    </fieldset></form>
    {busy&&<p role="status">正在读取或登记 Excel，输入保留。</p>}
    {meta&&!error&&!busy&&<><p>文件：{meta.source.original_name}；原始字节 SHA-256：<span style={{overflowWrap:'anywhere'}}>{meta.source.raw_sha256}</span></p><p>已读取 {meta.coverage.cell_count} 个单元格；公式 {meta.coverage.formula_count} 个。{meta.coverage.extraction_status==='empty'?'未提取到单元格内容。':''}</p><ul>{meta.coverage.not_covered.map(t=><li key={t}>{t}</li>)}</ul>
      <p>显式关联 {meta.links.length} 项；关联不表示业务事实或主数据已认定。</p>
      <label className="management-input">证据工作表<select aria-label="证据工作表" disabled={busy} value={sheet} onChange={e=>{setSheet(e.target.value);setOffset(0);}}><option value="">请选择工作表</option>{meta.sheets.map(s=><option key={s.name} value={s.name}>{s.name} · {s.cell_count} 个单元格 · {s.state}</option>)}</select></label>
      {page&&<><p>当前展示第 {offset+1} 至 {offset+page.cells.length} 个已提取单元格，坐标保持原工作表位置。</p><div className="import-actions"><button className="secondary" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-100))}>上一页单元格</button><button className="secondary" disabled={busy||page.next_offset===null} onClick={()=>setOffset(page.next_offset)}>下一页单元格</button></div>
        <div style={{maxHeight:360,overflow:'auto'}}>{page.cells.map(c=><p key={c.address}><button className="secondary" disabled={busy} onClick={()=>locate(c.address)}>{c.address}</button> · {c.raw_type} · <span style={{overflowWrap:'anywhere'}}>{String(c.normalized_value??'空值或无有效缓存').slice(0,120)}</span>{c.formula_state?' · 公式缓存待核实':''}</p>)}</div></>}
      {cell&&<details open><summary>原单元格 {cell.sheet_name}!{cell.address}</summary><pre className="analysis-json">{JSON.stringify(cell,null,2)}</pre></details>}
    </>}
  </section>;
}
