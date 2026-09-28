import React, { useEffect, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { IdentityTable as Table, IdentityField as Field, labelStatus } from './IdentityShared.jsx';
import { DirectoryPublication } from './DirectoryPublication.jsx';

function Outline({rows}) {
  const byId=new Map(rows.map(r=>[r.key,r])), seen=new Set();
  function branch(row,depth=0) { if(seen.has(row.key))return null;seen.add(row.key);const children=rows.filter(r=>r.parent===row.key);return <li key={row.key}><span>{row.name} · {row.code} · {row.kind==='office'?'办公室':'部门'}</span>{children.length>0&&depth<30&&<ul>{children.map(r=>branch(r,depth+1))}</ul>}</li>; }
  const tree=rows.filter(r=>!r.parent||!byId.has(r.parent)).map(r=>branch(r));const unresolved=rows.filter(r=>!seen.has(r.key));
  return <><ul className="identity-outline">{tree}</ul>{unresolved.length>0&&<p role="status">有 {unresolved.length} 条记录存在循环或层级过深，请在导入核对时处理；全部原记录仍显示在下方列表。</p>}</>;
}
export function Directory({api,kind,draft,setDraft,onLegacy}) {
  const [data,setData]=useState(null),[error,setError]=useState(null),[revision,setRevision]=useState(0);
  const initial=()=>Object.fromEntries(new URLSearchParams(location.search));
  const [filters,setFilters]=useState(initial);
  useEffect(()=>{const pop=()=>setFilters(initial());window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  useEffect(()=>{const controller=new AbortController();setData(null);setError(null);const signal=controller.signal;
    (kind==='organization'?Promise.all([api.request('/api/org/departments',{signal}),api.request('/api/offices/workbench',{signal})]).then(([deps,offices])=>deps.map(d=>({...d,key:'department-'+d.id,parent:d.parent_id?'department-'+d.parent_id:null,kind:'department'})).concat(offices.offices.map(o=>({...o,key:'office-'+o.id,parent:o.department_id?'department-'+o.department_id:null,kind:'office'})))):api.request('/api/org/roster',{signal}).then(r=>r.rows)).then(rows=>{if(!signal.aborted)setData(rows);}).catch(e=>{if(!signal.aborted)setError(e);});return()=>controller.abort();
  },[api,kind,revision]);
  function filter(key,value) {const next={...filters,[key]:value};const url=new URL(location.href);value?url.searchParams.set(key,value):url.searchParams.delete(key);history.replaceState(history.state,'',url.pathname+url.search);setFilters(next);}
  const rows=(data||[]).filter(r=> (!filters.search||[r.code,r.name,r.employee_no,r.person_name,r.department_name,...(r.offices||[]).map(o=>o.code+' '+o.name)].join(' ').toLowerCase().includes(filters.search.toLowerCase()))&&(!filters.type||r.kind===filters.type)&&(!filters.status||r.employment_status===filters.status)&&(!filters.department||String(r.current_department_id)===filters.department));
  const departments=[...new Map((data||[]).filter(r=>r.current_department_id).map(r=>[String(r.current_department_id),r.department_name||'部门名称未提供'])).entries()];
  const name=kind==='organization'?'组织架构':'花名册';
  return <div className="identity-module"><section className="card"><h2>查阅{name}</h2><p>{kind==='organization'?'依据当前保存的明确组织归属展示部门、办公室与负责人，不从名称或岗位推断。':'人员目录与账号开通分别办理；花名册记录不代表已拥有登录账号，办公室归属仅显示明确导入关系。'}</p><div className="identity-actions"><button onClick={()=>setRevision(n=>n+1)}>刷新{name}</button><a href={kind==='organization'?'/#/orgUnits':'/#/persons'} onClick={onLegacy}>原{name}入口</a></div></section>
    {error?<StatusPanel kind="error" title={`${name}暂不可用`} onRetry={()=>setRevision(n=>n+1)}>{error.message}</StatusPanel>:!data?<StatusPanel kind="loading" title={`正在读取${name}…`}/>:<section className="card" data-directory-ready={kind}>
      {kind==='organization'?<><h3>当前组织层级</h3><Outline rows={data}/></>:<p>在职 {data.filter(r=>r.employment_status==='active').length} 人 · 部门待明确 {data.filter(r=>!r.department_name).length} 人 · 当前显示 {rows.length} / {data.length} 人</p>}
      <div className="identity-fields"><Field label={`搜索${name}`} value={filters.search||''} onChange={e=>filter('search',e.target.value)}/>{kind==='organization'?<Field label="组织类型"><select value={filters.type||''} onChange={e=>filter('type',e.target.value)}><option value="">全部类型</option><option value="department">部门</option><option value="office">办公室</option></select></Field>:<><Field label="在职状态"><select value={filters.status||''} onChange={e=>filter('status',e.target.value)}><option value="">全部状态</option><option value="active">在职</option><option value="leave">离职</option><option value="suspended">停职</option></select></Field><Field label="人员部门"><select value={filters.department||''} onChange={e=>filter('department',e.target.value)}><option value="">全部部门</option>{departments.map(([id,n])=><option key={id} value={id}>{n}</option>)}</select></Field></>}</div>
      {kind==='organization'?<Table headers={['编码','名称','类型','上级 / 归口部门','办公室负责人','状态']} rows={rows.map(r=>[r.code,r.name,r.kind==='office'?'办公室':'部门',data.find(p=>p.key===r.parent)?.name||(r.parent?'上级记录不存在':r.kind==='office'?'归口待明确':'未设置上级'),r.kind==='office'?r.manager_name||'尚未指定':'不适用',labelStatus(r.status)])}/>:<Table headers={['工号','姓名','部门','办公室','手机','邮箱','在职状态','记录状态']} rows={rows.map(r=>[r.employee_no,r.person_name,r.department_name||'未关联部门',(r.offices||[]).map(o=>`${o.name}（${o.code}）`).join('、')||'未关联办公室',r.mobile||'未提供',r.email||'未提供',r.employment_status==='active'?'在职':labelStatus(r.employment_status),labelStatus(r.status)])}/>}
    </section>}
    <DirectoryPublication api={api} kind={kind} draft={draft} setDraft={setDraft} onPublished={()=>setRevision(n=>n+1)}/>
  </div>;
}
