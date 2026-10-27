import {BusinessSelect,BusinessRecordPicker} from "./BusinessDetails.jsx";
import {businessText,userMessage} from "./businessPresentation.js";
import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
const endpoint='/api/analysis/materials/pdf';
const kinds={text:'文本'};
export function PdfEvidence({ api, draft, setDraft, batchId, anchorId, canWrite, onRegistered }) {
  const [meta,setMeta]=useState(null),[selected,setSelected]=useState(null),[offset,setOffset]=useState(0),[error,setError]=useState(null),[busy,setBusy]=useState(false);
  const serial=useRef(0),pending=useRef(null),fileInput=useRef(null);
  const [physicalPage,setPhysicalPage]=useState('');
  const d=draft?.pdf||{file:null,kind:'definition',ref:'',anchor:'',basis:'',requestId:crypto.randomUUID()};
  useEffect(()=>()=>{pending.current?.abort();serial.current++;},[]);
  useEffect(()=>{setOffset(0);setPhysicalPage('');setMeta(null);setSelected(null);},[batchId,api]);
  useEffect(()=>{
    const c=new AbortController(),s=++serial.current;pending.current?.abort();pending.current=c;
    setMeta(null);setSelected(null);setError(null);
    if(!batchId){setBusy(false);return()=>c.abort();}
    setBusy(true);
    (async()=>{const m=await api.request(endpoint+'/'+batchId+'?'+new URLSearchParams({offset,...(physicalPage?{page:physicalPage}:{})}),{signal:c.signal});
      const found=anchorId?await api.request(endpoint+'/'+batchId+'?'+new URLSearchParams({anchor:anchorId}),{signal:c.signal}):null;
      if(c.signal.aborted||s!==serial.current)return;setMeta(m);setSelected(found?.anchor||null);
    })().catch(e=>{if(!c.signal.aborted&&s===serial.current)setError(e);}).finally(()=>{if(!c.signal.aborted&&s===serial.current)setBusy(false);});
    return()=>c.abort();
  },[api,batchId,anchorId,offset,physicalPage]);
  function edit(k,v){setDraft({...draft,dirty:true,pdf:{...d,[k]:v,requestId:crypto.randomUUID()}});}
  async function upload(e){e.preventDefault();if(busy)return;setBusy(true);setError(null);const c=new AbortController();pending.current?.abort();pending.current=c;serial.current++;
    try{if(!d.file||!/.+\.pdf$/i.test(d.file.name))throw new Error('只允许上传 .pdf 文件。');
      const body=new FormData();body.append('file',d.file);body.append('request_id',d.requestId);
      body.append('links',JSON.stringify(d.ref||d.anchor||d.basis?[{kind:d.kind,ref_id:d.ref,anchor_id:d.anchor,basis:d.basis}]:[]));
      const result=await api.request(endpoint,{method:'POST',body,signal:c.signal});if(c.signal.aborted)return;
      if(fileInput.current)fileInput.current.value='';onRegistered(result.batch_id);
    }catch(e){if(!c.signal.aborted)setError(e);}finally{if(!c.signal.aborted)setBusy(false);}
  }
  async function locate(anchor){if(busy)return;setBusy(true);setError(null);setSelected(null);const c=new AbortController();pending.current?.abort();pending.current=c;
    try{const r=await api.request(endpoint+'/'+batchId+'?'+new URLSearchParams({anchor}),{signal:c.signal});if(!c.signal.aborted)setSelected(r.anchor);}
    catch(e){if(!c.signal.aborted)setError(e);}finally{if(!c.signal.aborted)setBusy(false);}}
  return <section className="card" aria-label="PDF证据"><h2>PDF 证据读取</h2><p>读取 PDF 文本层，保留物理页码和文本位置。未提取文字的页面标为提取不足，不自动执行 OCR。登记保存固定快照，不修改原件。</p>
    {error&&<StatusPanel kind="error" title="PDF 操作未完成，输入保留">{userMessage(error)} </StatusPanel>}
    <form onSubmit={upload}><fieldset disabled={busy||!canWrite||!!draft?.review||!!draft?.task||!!draft?.closure||!!draft?.excel||!!draft?.word}>
      <label className="management-input">PDF 文件<input ref={fileInput} aria-label="PDF 文件" type="file" accept=".pdf" onChange={e=>edit('file',e.target.files[0]||null)}/></label>{d.file&&<p style={{overflowWrap:'anywhere'}}>待登记：{d.file.name}</p>}
      <details><summary>显式关联固定对象、字段或 流程固定来源（可留空）</summary><p>可先不关联登记，再浏览结构位置。需要关联时，选择原文件，选择已核对的内容与对应版本后重新登记；历史保留，不按标题自动匹配。</p>
        <label className="management-input">PDF 关联类型<select aria-label="PDF 关联类型" value={d.kind} onChange={e=>edit('kind',e.target.value)}><option value="definition">对象或字段固定版本</option><option value="mapping">来源映射固定版本</option><option value="v7_source">流程固定来源</option></select></label>
        <BusinessRecordPicker api={api} label="关联的流程、对象或字段" kind={d.kind==='definition'?'definitionVersion':d.kind==='mapping'?'mappingVersion':'source'} value={d.ref} onChange={v=>edit('ref',v)}/><BusinessSelect label="关联文件片段（留空表示整个文件）" value={d.anchor} onChange={v=>edit('anchor',v)} items={(meta?.anchors||[]).map(a=>({value:a.anchor_id,name:a.text?.slice(0,80)||'此片段没有可展示的文字'}))}/><label>关联依据<input aria-label="关联依据" value={d.basis} maxLength={1000} onChange={e=>edit('basis',e.target.value)}/></label>
      </details><button type="submit" className="primary">登记 PDF 证据</button>
    </fieldset></form>
    {busy&&<p role="status">正在读取或登记 PDF，输入保留。</p>}
    {meta&&!error&&!busy&&<><p style={{overflowWrap:'anywhere'}}>文件：{meta.source.original_name}</p>
      <p>共 {meta.coverage.page_count} 页，{meta.coverage.text_page_count} 页提取到文字，{meta.coverage.text_item_count} 个文字片段。{meta.coverage.extraction_status==='insufficient'?'未提取到正文文字。':''}</p><ul>{meta.coverage.not_covered.map(t=><li key={t}>{t}</li>)}</ul>
      <p>提取不足页：{meta.coverage.insufficient_pages.join('、')||'无'}；疑似乱码页：{meta.coverage.suspect_pages.join('、')||'无'}。页码为物理页序号。</p><p>显式关联 {meta.links.length} 项；不表示业务事实或主数据已认定。</p>
      <label className="management-input">浏览物理页<select aria-label="PDF物理页" value={physicalPage} onChange={e=>{setPhysicalPage(e.target.value);setOffset(0);}}><option value="">全部页</option>{meta.pages.map(p=><option key={p.page} value={p.page}>第 {p.page} 页 · {p.extraction_status==='insufficient'?'提取不足':p.extraction_status==='suspect'?'疑似乱码':'已提取文字'}</option>)}</select></label>
      {!meta.anchors.length&&<p>当前页没有提取到文字片段；请核对原件，不能据此认定没有内容。</p>}
      <div className="import-actions"><button className="secondary" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-100))}>上一页结构</button><button className="secondary" disabled={meta.next_offset===null} onClick={()=>setOffset(meta.next_offset)}>下一页结构</button></div>
      <div style={{maxHeight:360,overflow:'auto'}}>{meta.anchors.map(a=><p key={a.anchor_id}><button className="secondary" onClick={()=>locate(a.anchor_id)} aria-label={'查看原文片段 '+(a.text?.slice(0,40)||'未提取到文字')}>第 {a.page} 页 · {kinds[a.kind]}</button> · <span style={{overflowWrap:'anywhere'}}>{a.text.slice(0,150)||'结构容器或空段落'}</span></p>)}</div>
      {selected&&<details open><summary>原文摘录</summary><p>以下为来源文件的原文摘录，页码按原文件物理页序标注。</p><pre className="analysis-json">{businessText(selected.text||'此片段未提取到文字')}</pre><p>原文摘录用于核对文字内容；查看原版式请打开原文件。</p></details>}
    </>}
  </section>;
}
