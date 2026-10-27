import {businessText,userMessage} from "./businessPresentation.js";
import React, { useEffect, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { IdentityTable as Table, IdentityField as Field, labelStatus } from './IdentityShared.jsx';
import { DirectoryPublication } from './DirectoryPublication.jsx';
import { DirectoryMaintenance } from './DirectoryMaintenance.jsx';
import {directoryIdentityValue,directoryRecordLabel,directoryResponsibleName} from './directoryIdentityPresentation.js';

function Outline({rows,snapshot}) {
  const byId=new Map(rows.map(r=>[r.key,r])), seen=new Set();
  function branch(row,depth=0) { if(seen.has(row.key))return null;seen.add(row.key);const children=rows.filter(r=>r.parent===row.key);return <li key={row.key}><span>{directoryRecordLabel(row,false,snapshot)} · {row.kind==='office'?'办公室':'部门'}</span>{children.length>0&&depth<30&&<ul>{children.map(r=>branch(r,depth+1))}</ul>}</li>; }
  const tree=rows.filter(r=>!r.parent||!byId.has(r.parent)).map(r=>branch(r));const unresolved=rows.filter(r=>!seen.has(r.key));
  return <><ul className="identity-outline">{tree}</ul>{unresolved.length>0&&<p role="status">有 {unresolved.length} 条记录存在循环或层级过深，请在导入核对时处理；全部原记录仍显示在下方列表。</p>}</>;
}
export function Directory({api,kind,draft,setDraft,onNavigate}) {
  const [data,setData]=useState(null),[snapshot,setSnapshot]=useState(null),[error,setError]=useState(null),[revision,setRevision]=useState(0);
  const initial=()=>Object.fromEntries(new URLSearchParams(location.search));
  const [filters,setFilters]=useState(initial);
  useEffect(()=>{const pop=()=>setFilters(initial());window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  useEffect(()=>{const controller=new AbortController();setData(null);setSnapshot(null);setError(null);const signal=controller.signal;
    api.request('/api/directory/v1',{signal}).then(result=>result.canMaintain?api.request('/api/directory/v1?include_contacts=true',{signal}):result).then(result=>{if(signal.aborted)return;setSnapshot(result);const deps=result.departments||[],offices=result.offices||[];setData(kind==='organization'?deps.map(d=>({...d,key:'department-'+d.id,parent:d.parent_id?'department-'+d.parent_id:null,kind:'department'})).concat(offices.map(o=>({...o,manager_name:(result.persons||[]).find(p=>String(p.person_id)===String(o.manager_person_id))?.person_name,key:'office-'+o.id,parent:o.department_id?'department-'+o.department_id:null,kind:'office'}))):(result.persons||[]).map(p=>({...p,department_name:deps.find(d=>String(d.id)===String(p.current_department_id))?.name,offices:p.offices||offices.filter(o=>(p.office_ids||[]).map(String).includes(String(o.id)))})));}).catch(e=>{if(!signal.aborted)setError(e);});return()=>controller.abort();
  },[api,kind,revision]);
  function filter(key,value) {const next={...filters,[key]:value};const url=new URL(location.href);value?url.searchParams.set(key,value):url.searchParams.delete(key);history.replaceState(history.state,'',url.pathname+url.search);setFilters(next);}
  const rows=(data||[]).filter(r=> (!filters.search||[r.code,r.name,r.employee_no,r.person_name,r.department_name,...(r.offices||[]).map(o=>o.code+' '+o.name)].join(' ').toLowerCase().includes(filters.search.toLowerCase()))&&(!filters.type||r.kind===filters.type)&&(!filters.status||r.employment_status===filters.status)&&(!filters.department||String(r.current_department_id)===filters.department));
  const departments=[...new Map((data||[]).filter(r=>r.current_department_id).map(r=>[String(r.current_department_id),r.department_name||'部门名称未提供'])).entries()];
  const name=kind==='organization'?'组织架构':'花名册';
  return <div className="identity-module"><section className="card"><h2>查阅{name}</h2><p>{kind==='organization'?'依据3000当前有效目录展示部门、办公室与负责人，行政人事维护后供全域统一引用。':'3000为员工信息唯一维护源。人员资料由行政人事维护，登录账号与系统角色另行办理。'}</p><div className="identity-actions"><button onClick={()=>setRevision(n=>n+1)}>刷新{name}</button></div></section>
    <DirectoryMaintenance api={api} kind={kind} snapshot={snapshot} loadError={error} draft={draft} setDraft={setDraft} onSaved={()=>setRevision(n=>n+1)}/>
    {error?<StatusPanel kind="error" title={`${name}暂不可用`} onRetry={()=>setRevision(n=>n+1)}>{userMessage(error)}</StatusPanel>:!data?<StatusPanel kind="loading" title={`正在读取${name}…`}/>:<section className="card" data-directory-ready={kind}>
      {kind==='organization'?<><h3>当前组织层级</h3><Outline rows={data} snapshot={snapshot}/><p>部门负责人显示当前组织登记，办公室负责人单独列示；这些记录不补写历史任命，也不代替有效角色授权。</p></>:<><p>在职 {data.filter(r=>r.employment_status==='active').length} 人 · 部门待明确 {data.filter(r=>!r.department_name).length} 人 · 当前显示 {rows.length} / {data.length} 人</p>{!snapshot?.canMaintain&&<p>当前查阅范围不包含手机、邮箱等联系方式；这不表示行政人事尚未填写。</p>}</>}
      <div className="identity-fields"><Field label={`搜索${name}`} value={filters.search||''} onChange={e=>filter('search',e.target.value)}/>{kind==='organization'?<Field label="组织类型"><select value={filters.type||''} onChange={e=>filter('type',e.target.value)}><option value="">全部类型</option><option value="department">部门</option><option value="office">办公室</option></select></Field>:<><Field label="在职状态"><select value={filters.status||''} onChange={e=>filter('status',e.target.value)}><option value="">全部状态</option><option value="active">在职</option><option value="leave">离职</option><option value="suspended">停职</option></select></Field><Field label="人员部门"><select value={filters.department||''} onChange={e=>filter('department',e.target.value)}><option value="">全部部门</option>{departments.map(([id,n])=><option key={id} value={id}>{n}</option>)}</select></Field></>}</div>
      {kind==='organization'?<Table headers={['名称','类型','上级 / 归口部门','部门负责人（当前登记）','办公室负责人','状态']} rows={rows.map(r=>[directoryRecordLabel(r,false,snapshot),r.kind==='office'?'办公室':'部门',data.find(p=>p.key===r.parent)?.name||(r.parent?'上级记录不存在':r.kind==='office'?'归口待明确':'未设置上级'),r.kind==='department'?directoryResponsibleName(r,snapshot):'不适用',r.kind==='office'?directoryResponsibleName(r,snapshot):'不适用',labelStatus(r.status)])}/>:<Table headers={['工号','姓名','部门','办公室',...(snapshot?.canMaintain?['手机','邮箱']:[]),'在职状态','记录状态']} rows={rows.map(r=>[directoryIdentityValue(r.employee_no),r.person_name,r.department_name||'未关联部门',(r.offices||[]).map(o=>directoryRecordLabel(o,false,snapshot)).join('、')||'未关联办公室',...(snapshot?.canMaintain?[r.mobile||'未填写',r.email||'未填写']:[]),r.employment_status==='active'?'在职':labelStatus(r.employment_status),labelStatus(r.status)])}/>}
    </section>}
    {draft?.mode!=='directory-maintenance'&&<DirectoryPublication snapshot={snapshot} api={api} kind={kind} draft={draft} setDraft={setDraft} onPublished={()=>setRevision(n=>n+1)}/>}
  </div>;
}
