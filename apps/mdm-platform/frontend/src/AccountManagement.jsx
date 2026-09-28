import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { IdentityField as Field, IdentityTable as Table, dateValue, effective, identityFailure, labelStatus } from './IdentityShared.jsx';

const endpoint = '/api/org/accounts';
const fingerprint = account => JSON.stringify(Object.fromEntries(Object.entries(account).filter(([key])=>key!=='department_status').sort(([a],[b])=>a.localeCompare(b))));
const actionNames = { create:'创建待启用账号', edit:'保存人员信息', grant:'授予角色', revoke:'撤销角色授权', activate:'启用账号', enable:'重新启用或解锁', disable:'停用账号', 'reset-password':'重置密码' };

export function AccountManagement({ api, user, draft, setDraft, onLegacy }) {
  const [data,setData]=useState(null), [error,setError]=useState(null), [revision,setRevision]=useState(0), [busy,setBusy]=useState(false), [message,setMessage]=useState(''), [password,setPassword]=useState('');
  const [search,setSearch]=useState(()=>new URLSearchParams(location.search).get('search')||''), [department,setDepartment]=useState(()=>new URLSearchParams(location.search).get('department')||'');
  const alive=useRef(true), lock=useRef(false), editor=useRef(null);
  const permissions=user.permissions||[], manage=permissions.includes('identity:manage-account'), assign=permissions.includes('identity:assign-role');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{ const controller=new AbortController();setData(null);setError(null);
    Promise.all([api.request(endpoint,{signal:controller.signal}),api.request('/api/rbac/model',{signal:controller.signal}),api.request('/api/org/departments',{signal:controller.signal})]).then(([accounts,model,departments])=>{if(!controller.signal.aborted)setData({accounts,model,departments});}).catch(e=>{if(!controller.signal.aborted)setError(e);});return()=>controller.abort();
  },[api,revision]);
  useEffect(()=>{editor.current?.querySelector('input,select,button')?.focus();},[draft?.mode,draft?.personId,draft?.assignmentId]);
  useEffect(()=>{const pop=()=>{const q=new URLSearchParams(location.search);setSearch(q.get('search')||'');setDepartment(q.get('department')||'');};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  function filter(key,value) { const url=new URL(location.href);value?url.searchParams.set(key,value):url.searchParams.delete(key);history.replaceState(history.state,'',url.pathname+url.search);(key==='search'?setSearch:setDepartment)(value); }
  function discard() { if(busy)return false;if(draft && !window.confirm('放弃当前尚未提交的账号办理输入？'))return false;setDraft(null);setError(null);return true; }
  function open(mode,account=null,assignment=null) {
    if(!discard())return;setPassword('');setMessage('');setDraft({mode,personId:account?.person_id||null,assignmentId:assignment?.assignmentId||null,baseline:account?fingerprint(account):null,dirty:true,name:account?.person_name||'',loginName:'',employeeNo:account?.employee_no||'',departmentId:String(account?.current_department_id||''),roles:[],roleCode:'',authorizationBasis:'',effectiveFrom:new Date().toISOString().slice(0,10),effectiveTo:'',reason:'',disableAccount:false});
  }
  function change(key,value) {setDraft({...draft,[key]:value,dirty:true});setError(null);}
  const current=data?.accounts.find(a=>String(a.person_id)===String(draft?.personId));
  const changed=Boolean(draft?.personId && data && (!current || fingerprint(current)!==draft.baseline));
  async function submit(event) {
    event.preventDefault();if(lock.current||!draft||!data||changed||draft.uncertain)return;
    lock.current=true;setBusy(true);setError(null);setMessage('');let sent=false;
    try {
      if(draft.personId) {const latest=await api.request(endpoint+'/'+draft.personId);if(fingerprint(latest)!==draft.baseline) {if(alive.current){setRevision(n=>n+1);setError({message:'账号或授权记录已变化，输入已保留。请取消本次草稿，核对最新记录后重新办理。'});}return;}}
      const assignment=code=>({roleCode:code,scopeDepartmentId:Number(draft.departmentId),authorizationBasis:draft.authorizationBasis.trim(),effectiveFrom:draft.effectiveFrom,effectiveTo:draft.effectiveTo||null});
      let url=endpoint,method='POST',body;
      if(draft.mode==='create')body={loginName:draft.loginName.trim(),employeeNo:draft.employeeNo.trim(),name:draft.name.trim(),departmentId:Number(draft.departmentId),roleAssignments:draft.roles.map(assignment),reason:'管理员手工创建待启用账号'};
      else {url+='/'+draft.personId;
        if(draft.mode==='edit'){method='PATCH';const moved=String(current.current_department_id)!==draft.departmentId;body={name:draft.name.trim(),departmentId:Number(draft.departmentId),...(moved?{roleAssignments:draft.roles.map(assignment),changeReason:draft.authorizationBasis.trim()}:{})};}
        else if(draft.mode==='grant'){url+='/role-assignments';body=assignment(draft.roleCode);}
        else if(draft.mode==='revoke'){url+='/role-assignments/'+draft.assignmentId+'/revoke';body={reason:draft.reason.trim(),disableAccount:draft.disableAccount};}
        else {url+='/'+draft.mode;body={reason:draft.reason.trim()};}
      }
      if(!alive.current || !window.confirm(`确认${actionNames[draft.mode]}？对象：${draft.name||draft.employeeNo}。`))return;
      sent=true;const result=await api.request(url,{method,body});
      if(!alive.current)return;
      setDraft(null);setPassword(result.initialPassword||'');setMessage(actionNames[draft.mode]+'已完成。');setRevision(n=>n+1);
    } catch(e) {if(alive.current){setError(e);if(sent&&(!e.status||e.status>=500))setDraft({...draft,uncertain:true,dirty:true});}}
    finally {lock.current=false;if(alive.current)setBusy(false);}
  }
  const roles=data?.model.roles||[], selectedRoles=draft?.mode==='grant'?[...(current?.roleAssignments||[]).filter(effective).map(a=>a.roleCode),draft.roleCode]:draft?.roles||[];
  const visible=[...new Set(roles.filter(r=>selectedRoles.includes(r.code)).flatMap(r=>(r.visibleTabs||[]).map(t=>t.name)))];
  const personForm=['create','edit'].includes(draft?.mode), roleForm=personForm||draft?.mode==='grant';
  const needsRoles=draft?.mode==='create'||draft?.mode==='edit'&&current&&String(current.current_department_id)!==draft.departmentId;
  const shown=(data?.accounts||[]).filter(a=>(!department||String(a.current_department_id)===department)&&(!search||[a.login_name,a.employee_no,a.person_name,a.department_name].join(' ').toLowerCase().includes(search.toLowerCase())));
  return <div className="identity-module">
    <section className="card"><h2>账号与授权办理</h2><p>手工创建待启用账号，分别办理账号启停、人员维护和角色授权。授权只追加或撤销，历史记录保留；部门角色只能属于人员当前部门。</p><div className="identity-actions"><button disabled={busy} onClick={()=>setRevision(n=>n+1)}>刷新账号资料</button>{manage&&assign&&<button disabled={!data||busy||Boolean(password)} onClick={()=>open('create')}>手工创建账号</button>}<a href="/#/rbac" onClick={onLegacy}>原账号管理</a></div></section>
    {message&&<StatusPanel title={message}/>}
    {password&&<section className="card"><h2>一次性临时密码</h2><p>仅在本次响应中显示，请通过安全渠道交给账号本人。关闭或刷新后不能再次查看。</p><code className="identity-secret">{password}</code><button onClick={()=>setPassword('')}>我已安全记录</button></section>}
    {error&&<StatusPanel kind="error" title="账号办理未完成" onRetry={()=>setRevision(n=>n+1)}>{identityFailure(error)}</StatusPanel>}
    {!data&&!error&&<StatusPanel kind="loading" title="正在读取账号资料…"/>}
    {draft&&<section className="card" ref={editor}><h2>{actionNames[draft.mode]} · {draft.name||'新账号'}</h2><p>当前输入只保留在页面内存中，点击提交并确认后才写入。</p>
      {changed&&<StatusPanel kind="error" title="账号记录已变化">原输入已保留，禁止提交旧草稿。请取消后按最新记录重新办理。</StatusPanel>}
      {draft.uncertain&&<StatusPanel kind="error" title="操作结果尚未确定">请求可能已经执行，不能直接重复提交。请刷新账号资料及访问审计核对结果，再取消草稿并决定后续动作。</StatusPanel>}
      <form onSubmit={submit}><fieldset disabled={busy}><legend>办理内容</legend>
        {personForm&&<div className="identity-fields">{draft.mode==='create'&&<><Field label="登录名" required value={draft.loginName} onChange={e=>change('loginName',e.target.value)}/><Field label="工号" required value={draft.employeeNo} onChange={e=>change('employeeNo',e.target.value)}/></>}<Field label="姓名" required value={draft.name} onChange={e=>change('name',e.target.value)}/><Field label="部门"><select required value={draft.departmentId} onChange={e=>change('departmentId',e.target.value)}><option value="">请选择部门</option>{(data?.departments||[]).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field></div>}
        {draft.mode==='edit'&&<p>变更部门时必须填写依据并选择新部门角色，旧部门角色由原接口撤销。</p>}
        {needsRoles&&<div className="identity-checks">{roles.filter(r=>draft.mode==='create'||['department_contact','department_mdm_reviewer'].includes(r.code)).map(r=><label key={r.code}><input type="checkbox" checked={draft.roles.includes(r.code)} onChange={e=>change('roles',e.target.checked?[...draft.roles,r.code]:draft.roles.filter(c=>c!==r.code))}/>{r.name}</label>)}</div>}
        {draft.mode==='grant'&&<Field label="新增角色"><select required value={draft.roleCode} onChange={e=>change('roleCode',e.target.value)}><option value="">请选择角色</option>{roles.map(r=><option key={r.code} value={r.code}>{r.name}</option>)}</select></Field>}
        {roleForm&&<><div className="identity-fields"><Field label="授权或变更依据" required={needsRoles||draft.mode==='grant'} value={draft.authorizationBasis} onChange={e=>change('authorizationBasis',e.target.value)}/><Field label="生效日期" type="date" required value={draft.effectiveFrom} onChange={e=>change('effectiveFrom',e.target.value)}/><Field label="失效日期（可选）" type="date" min={draft.effectiveFrom} value={draft.effectiveTo} onChange={e=>change('effectiveTo',e.target.value)}/></div><p>所选角色可见标签：{visible.join('、')||'尚未选择角色'}。标签不替代服务端授权。</p></>}
        {!roleForm&&<Field label="办理原因" required value={draft.reason} onChange={e=>change('reason',e.target.value)}/>}
        {draft.mode==='revoke'&&<label><input type="checkbox" checked={draft.disableAccount} onChange={e=>change('disableAccount',e.target.checked)}/>同时停用账号（撤销最后一个有效角色时需要）</label>}
        <div className="identity-actions"><button type="button" onClick={discard}>取消本次办理</button><button type="submit" disabled={!data||changed||draft.uncertain||needsRoles&&!draft.roles.length}>{busy?'正在提交…':actionNames[draft.mode]}</button></div>
      </fieldset></form></section>}
    {data&&<section className="card" data-accounts-ready="true"><div className="identity-fields"><Field label="搜索账号" value={search} onChange={e=>filter('search',e.target.value)}/><Field label="筛选部门"><select value={department} onChange={e=>filter('department',e.target.value)}><option value="">全部部门</option>{data.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field></div>
      <Table headers={['人员 / 工号','登录名 / 部门','有效角色','账号状态 / 认证版本','办理及授权历史']} empty="暂无匹配账号" rows={shown.map(a=>[`${a.person_name} / ${a.employee_no}`,`${a.login_name||'无账号'} / ${a.department_name||'待明确'}`,(a.roleAssignments||[]).filter(effective).map(r=>r.roleName||r.roleCode).join('、')||'无有效角色',`${labelStatus(a.account_status)} / ${a.auth_version??'未提供'}`,<div key={a.person_id} data-account-id={a.person_id}>
        {manage&&<><button disabled={busy||Boolean(password)} onClick={()=>open('edit',a)}>维护人员</button>{a.account_id&&<><button disabled={busy||Boolean(password)} onClick={()=>open(a.account_status==='pending_activation'?'activate':a.account_status==='active'?'disable':'enable',a)}>{a.account_status==='pending_activation'?'启用':a.account_status==='active'?'停用':'重新启用或解锁'}</button><button disabled={busy||Boolean(password)} onClick={()=>open('reset-password',a)}>重置密码</button></>}</>}{assign&&<button disabled={busy||Boolean(password)} onClick={()=>open('grant',a)}>新增角色授权</button>}
        <details><summary>授权记录（{a.roleAssignments?.length||0}）</summary>{(a.roleAssignments||[]).map(r=><p key={r.assignmentId}>{r.roleName||r.roleCode} · {r.scopeDepartmentName||r.scopeType} · {labelStatus(r.status)} · {r.authorizationBasis} · {dateValue(r.effectiveFrom)} 至 {dateValue(r.effectiveTo)||'长期'} {assign&&r.status==='active'&&<button disabled={busy||Boolean(password)} onClick={()=>open('revoke',a,r)}>撤销该授权</button>}</p>)}</details>
      </div>])}/></section>}
  </div>;
}
