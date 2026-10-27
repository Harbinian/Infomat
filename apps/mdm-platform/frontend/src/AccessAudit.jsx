import {businessText,userMessage} from './businessPresentation.js';
import {auditActorName} from './governancePresentation.js';
import {businessDateTime} from './businessGuidance.js';
import {accountAuditQuery,auditAccountReturn} from './accountReviewPresentation.js';
import {directoryIdentityValue} from './directoryIdentityPresentation.js';
import React, { useEffect, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { IdentityTable as Table, IdentityField as Field } from './IdentityShared.jsx';
const events={account_created:'创建账号',account_activated:'首次启用',account_enabled:'重新启用',account_disabled:'停用账号',account_unlocked:'解锁账号',password_reset:'重置密码',password_changed:'修改密码',department_changed:'变更部门',role_assigned:'授予角色',role_revoked:'撤销角色',login_succeeded:'登录成功'};
export function AccessAudit({api,onNavigate}) {
  const initial=()=>{const query=new URLSearchParams(location.search);return {event:query.get('event')||'',personId:query.get('personId')||'',returnTo:auditAccountReturn(query.get('return_to'))};};
  const [filters,setFilters]=useState(initial),[rows,setRows]=useState(null),[error,setError]=useState(null),[revision,setRevision]=useState(0),[person,setPerson]=useState(null);
  useEffect(()=>{const pop=()=>setFilters(initial());window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  useEffect(()=>{
    const controller=new AbortController();setRows(null);setPerson(null);setError(null);const signal=controller.signal;
    api.request(accountAuditQuery(filters.event,filters.personId),{signal}).then(result=>{if(!signal.aborted)setRows(result);}).catch(e=>{if(!signal.aborted)setError(e);});
    // Names in a navigation URL are not identity evidence; resolve the exact selected account.
    if(filters.personId)api.request('/api/org/accounts/'+encodeURIComponent(filters.personId),{signal}).then(result=>{if(!signal.aborted)setPerson(result);}).catch(()=>{});
    return()=>controller.abort();
  },[api,filters.event,filters.personId,revision]);
  function changeEvent(value){const url=new URL(location.href);value?url.searchParams.set('event',value):url.searchParams.delete('event');history.replaceState(history.state,'',url.pathname+url.search);setFilters({...filters,event:value});}
  function showAll(){const url=new URL(location.href);url.searchParams.delete('personId');url.searchParams.delete('personName');url.searchParams.delete('employeeNo');history.replaceState(history.state,'',url.pathname+url.search);setFilters({...filters,personId:''});}
  return <div className="identity-module"><section className="card"><h2>查看账号与授权操作记录</h2><p>显示当前条件下最近200条账号、密码、部门和角色授权事件。记录数量不代表全部历史；不展示密码或凭据。</p>
    {filters.personId?<p>当前查看员工：{person?`${businessText(person.person_name,'当前姓名未记录')}（工号：${directoryIdentityValue(person.employee_no)}）`:'当前姓名尚未取得，请结合原账号行核对'}。包含该员工作为操作人或办理对象的记录；没有记录不表示此前未办理。</p>:<p>当前查看范围：全部有权查阅的人员。要核对某位员工的办理结果，请从“账号与授权办理”的员工行进入。</p>}
    <p>操作人和对象按当前姓名显示；操作发生时的旧姓名未在这些记录中留存，历史缺名不会补写为系统操作。</p>
    <div className="identity-actions"><button onClick={()=>setRevision(n=>n+1)}>刷新操作记录</button><a href={filters.returnTo} onClick={onNavigate}>返回账号与授权办理</a>{filters.personId&&<button type="button" onClick={showAll}>查看全部人员操作记录</button>}</div>
    <Field label="事件类型"><select value={filters.event} onChange={e=>changeEvent(e.target.value)}><option value="">全部事件</option>{Object.entries(events).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></Field>
  </section>{error?<StatusPanel kind="error" title="操作记录暂不可用" onRetry={()=>setRevision(n=>n+1)}>{userMessage(error)}</StatusPanel>:rows?<section className="card" data-audit-ready="true"><Table headers={['时间','事件','操作人（当前姓名）','对象（当前姓名）','原因或依据']} rows={rows.map(r=>[businessDateTime(r.created_at),events[r.event_type]||'历史账号操作',auditActorName(r),businessText(r.target_name||'对象姓名未记录'),businessText(r.reason||'原因或依据未提供','原因或依据包含无法直接展示的内容，请核对原始材料。')])}/></section>:<StatusPanel kind="loading" title="正在读取操作记录…"/>}</div>;
}
