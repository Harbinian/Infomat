import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
const endpoint='/api/analysis/materials/word';
const kinds={paragraph:'段落',table:'表格',row:'表格行',cell:'单元格'};
export function WordEvidence({ api, draft, setDraft, batchId, anchorId, canWrite, onRegistered }) {
  const [meta,setMeta]=useState(null),[selected,setSelected]=useState(null),[offset,setOffset]=useState(0),[error,setError]=useState(null),[busy,setBusy]=useState(false);
  const serial=useRef(0),pending=useRef(null),fileInput=useRef(null);
  const d=draft?.word||{file:null,kind:'definition',ref:'',anchor:'',basis:'',requestId:crypto.randomUUID()};
  useEffect(()=>()=>{pending.current?.abort();serial.current++;},[]);
  useEffect(()=>{setOffset(0);setMeta(null);setSelected(null);},[batchId,api]);
  useEffect(()=>{
    const c=new AbortController(),s=++serial.current;pending.current?.abort();pending.current=c;
    setMeta(null);setSelected(null);setError(null);
    if(!batchId){setBusy(false);return()=>c.abort();}
    setBusy(true);
    (async()=>{const m=await api.request(endpoint+'/'+batchId+'?'+new URLSearchParams({offset}),{signal:c.signal});
      const found=anchorId?await api.request(endpoint+'/'+batchId+'?'+new URLSearchParams({anchor:anchorId}),{signal:c.signal}):null;
      if(c.signal.aborted||s!==serial.current)return;setMeta(m);setSelected(found?.anchor||null);
    })().catch(e=>{if(!c.signal.aborted&&s===serial.current)setError(e);}).finally(()=>{if(!c.signal.aborted&&s===serial.current)setBusy(false);});
    return()=>c.abort();
  },[api,batchId,anchorId,offset]);
  function edit(k,v){setDraft({...draft,dirty:true,word:{...d,[k]:v,requestId:crypto.randomUUID()}});}
  async function upload(e){e.preventDefault();if(busy)return;setBusy(true);setError(null);const c=new AbortController();pending.current?.abort();pending.current=c;serial.current++;
    try{if(!d.file||!/.+\.docx$/i.test(d.file.name))throw new Error('只允许上传 .docx，不接受 .doc。请另选有效的 DOCX 文件。');
      const body=new FormData();body.append('file',d.file);body.append('request_id',d.requestId);
      body.append('links',JSON.stringify(d.ref||d.anchor||d.basis?[{kind:d.kind,ref_id:d.ref,anchor_id:d.anchor,basis:d.basis}]:[]));
      const result=await api.request(endpoint,{method:'POST',body,signal:c.signal});if(c.signal.aborted)return;
      if(fileInput.current)fileInput.current.value='';onRegistered(result.batch_id);
    }catch(e){if(!c.signal.aborted)setError(e);}finally{if(!c.signal.aborted)setBusy(false);}
  }
  async function locate(anchor){if(busy)return;setBusy(true);setError(null);setSelected(null);const c=new AbortController();pending.current?.abort();pending.current=c;
    try{const r=await api.request(endpoint+'/'+batchId+'?'+new URLSearchParams({anchor}),{signal:c.signal});if(!c.signal.aborted)setSelected(r.anchor);}
    catch(e){if(!c.signal.aborted)setError(e);}finally{if(!c.signal.aborted)setBusy(false);}}
  return <section className="card" aria-label="DOCX证据"><h2>DOCX 证据读取</h2><p>只接受 .docx，不接受 .doc，也不自动转换。保留正文与表格顺序；未经渲染，不提供页码。登记保存固定读取快照，不修改原件。</p>
    {error&&<StatusPanel kind="error" title="DOCX 操作未完成，输入保留">{error.message} {error.code}</StatusPanel>}
    <form onSubmit={upload}><fieldset disabled={busy||!canWrite||!!draft?.review||!!draft?.task||!!draft?.closure||!!draft?.pdf||!!draft?.excel}>
      <label className="management-input">DOCX 文件<input ref={fileInput} aria-label="DOCX 文件" type="file" accept=".docx" onChange={e=>edit('file',e.target.files[0]||null)}/></label>{d.file&&<p style={{overflowWrap:'anywhere'}}>待登记：{d.file.name}</p>}
      <details><summary>显式关联固定对象、字段或 V7 来源（可留空）</summary><p>可先不关联登记，再浏览结构位置。需要关联时，选择原文件，填写已核对的结构标识和固定版本后重新登记；历史保留，不按标题自动匹配。</p>
        <label className="management-input">DOCX 关联类型<select aria-label="DOCX 关联类型" value={d.kind} onChange={e=>edit('kind',e.target.value)}><option value="definition">对象或字段固定版本</option><option value="mapping">V7 映射固定版本</option><option value="v7_source">V7 固定来源</option></select></label>
        {[['ref','固定版本或来源 ID'],['anchor','结构标识'],['basis','关联依据']].map(([k,title])=><label className="management-input" key={k}>{title}<input aria-label={'DOCX '+title} value={d[k]} maxLength={k==='basis'?1000:128} onChange={e=>edit(k,e.target.value)}/></label>)}
      </details><button type="submit" className="primary">登记 DOCX 证据</button>
    </fieldset></form>
    {busy&&<p role="status">正在读取或登记 DOCX，输入保留。</p>}
    {meta&&!error&&!busy&&<><p style={{overflowWrap:'anywhere'}}>文件：{meta.source.original_name}；原始字节 SHA-256：{meta.source.raw_sha256}</p>
      <p>已读取正文 {meta.coverage.paragraph_count} 段、表格 {meta.coverage.table_count} 个、单元格 {meta.coverage.cell_count} 个。{meta.coverage.extraction_status==='empty'?'未提取到正文文字。':''}</p><ul>{meta.coverage.not_covered.map(t=><li key={t}>{t}</li>)}</ul>
      <p>显式关联 {meta.links.length} 项；不表示业务事实或主数据已认定。</p>
      <div className="import-actions"><button className="secondary" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-100))}>上一页结构</button><button className="secondary" disabled={meta.next_offset===null} onClick={()=>setOffset(meta.next_offset)}>下一页结构</button></div>
      <div style={{maxHeight:360,overflow:'auto'}}>{meta.anchors.map(a=><p key={a.anchor_id}><button className="secondary" onClick={()=>locate(a.anchor_id)} aria-label={'查看结构 '+a.anchor_id}>{kinds[a.kind]} {a.anchor_id}</button> · <span style={{overflowWrap:'anywhere'}}>{a.text.slice(0,150)||'结构容器或空段落'}</span></p>)}</div>
      {selected&&<details open><summary>原文结构 {selected.anchor_id}</summary><p style={{overflowWrap:'anywhere'}}>原位置：{selected.part} · {selected.xml_path}；页码未提取。</p><pre className="analysis-json">{selected.text||'结构容器或空段落'}</pre><p>父结构：{selected.parent_anchor||'正文根'}</p></details>}
    </>}
  </section>;
}
