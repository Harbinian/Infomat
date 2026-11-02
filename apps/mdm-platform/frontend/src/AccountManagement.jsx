import React, { useEffect, useRef, useState } from 'react';
import {businessText} from './businessPresentation.js';
import {directoryIdentityValue} from './directoryIdentityPresentation.js';
import {accountAuditLink,authorizationContext,authorizationDescription} from './accountReviewPresentation.js';
import { StatusPanel } from './components.jsx';
import { IdentityField as Field, IdentityTable as Table, dateValue, identityFailure, labelStatus } from './IdentityShared.jsx';

const endpoint = '/api/org/accounts';
const fingerprint = account => JSON.stringify(Object.fromEntries(Object.entries(account).filter(([key])=>key!=='department_status').sort(([a],[b])=>a.localeCompare(b))));
const actionNames = { 'assign-account':'赋予账号', grant:'授予角色', revoke:'撤销角色授权', activate:'启用账号', enable:'重新启用或解锁', disable:'停用账号', 'reset-password':'重置密码' };
const headRole = 'department_mdm_reviewer';
const effective = (assignment, account) => {
  const today=account?.server_current_date;
  return Boolean(today && assignment.status==='active' && assignment.roleStatus==='active' && assignment.effectiveFrom && dateValue(assignment.effectiveFrom)<=today && (!assignment.effectiveTo || dateValue(assignment.effectiveTo)>=today));
};
const headErrors = {
  DEPARTMENT_FINAL_RESPONSIBLE_CHANGED: '部门现任负责人已变化，原输入已保留。请刷新资料，取消旧草稿后按最新负责人重新办理。',
  DEPARTMENT_HEAD_REPLACEMENT_CONFIRMATION_REQUIRED: '本部门已有其他负责人，请核对旧负责人和新负责人的交接，再明确确认本次变更。',
  DEPARTMENT_HEAD_CURRENT_APPOINTMENT_REQUIRED: '本入口只办理当前生效的部门负责人授权与登记，不能安排未来任命或使用已失效的授权期。',
  DEPARTMENT_ACCOUNTABILITY_POLICY_REQUIRED: '部门负责人登记规则尚未准备，当前输入已保留。请联系维护人员核对。'
};
function headContext(account) {
  if (!account || !Object.prototype.hasOwnProperty.call(account, 'department_final_responsible_person_id') || !/^\d{4}-\d{2}-\d{2}$/.test(account.server_current_date || '')) return null;
  return { departmentId: String(account.current_department_id || ''), departmentName: account.department_name || '待明确', personId: account.department_final_responsible_person_id == null ? null : String(account.department_final_responsible_person_id), personName: account.department_final_responsible_person_name || '', today: account.server_current_date };
}
function currentHeadGrant(account) {
  const today = account?.server_current_date;
  return today ? (account.roleAssignments || []).find(a => a.roleCode === headRole && a.status === 'active' && a.roleStatus === 'active' && a.scopeType === 'department' && String(a.scopeDepartmentId) === String(account.current_department_id) && a.effectiveFrom && dateValue(a.effectiveFrom) <= today && (!a.effectiveTo || dateValue(a.effectiveTo) >= today)) || null : null;
}
function roleLabel(role, account) {
  if (role.roleCode !== headRole) return businessText(role.roleName || '角色名称未记录','角色名称暂无法展示');
  return account.department_final_responsible_person_id != null && String(account.department_final_responsible_person_id) === String(account.person_id) ? '部门负责人（已登记）' : '部门负责人（未登记为现任）';
}

export function AccountManagement({ api, user, draft, setDraft, onNavigate }) {
  const [data,setData]=useState(null), [error,setError]=useState(null), [revision,setRevision]=useState(0), [busy,setBusy]=useState(false), [message,setMessage]=useState(''), [password,setPassword]=useState('');
  const [search,setSearch]=useState(()=>new URLSearchParams(location.search).get('search')||''), [department,setDepartment]=useState(()=>new URLSearchParams(location.search).get('department')||'');
  const alive=useRef(true), lock=useRef(false), editor=useRef(null);
  const permissions=user.permissions||[], manage=permissions.includes('identity:manage-account'), assign=permissions.includes('identity:assign-role'),readAudit=permissions.includes('identity:read-audit');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{ const controller=new AbortController();setData(null);setError(null);
    Promise.all([api.request(endpoint,{signal:controller.signal}),api.request('/api/rbac/model',{signal:controller.signal}),api.request('/api/org/departments',{signal:controller.signal})]).then(([accounts,model,departments])=>{if(!controller.signal.aborted)setData({accounts,model,departments});}).catch(e=>{if(!controller.signal.aborted)setError(e);});return()=>controller.abort();
  },[api,revision]);
  useEffect(()=>{editor.current?.querySelector('input,select,button')?.focus();},[draft?.mode,draft?.personId,draft?.assignmentId]);
  useEffect(()=>{const pop=()=>{const q=new URLSearchParams(location.search);setSearch(q.get('search')||'');setDepartment(q.get('department')||'');};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  function filter(key,value) { const url=new URL(location.href);value?url.searchParams.set(key,value):url.searchParams.delete(key);history.replaceState(history.state,'',url.pathname+url.search);(key==='search'?setSearch:setDepartment)(value); }
  function discard() { if(busy)return false;if(draft && !window.confirm('放弃当前尚未提交的账号办理输入？'))return false;setDraft(null);setError(null);return true; }
  function open(mode,account=null,assignment=null) {
    if(!discard())return;setPassword('');setMessage('');setDraft({mode,personId:account?.person_id||null,assignmentId:assignment?.assignmentId||null,revokedRoleCode:assignment?.roleCode||null,revokeContext:authorizationContext(assignment),baseline:account?fingerprint(account):null,dirty:true,name:account?.person_name||'',loginName:'',employeeNo:account?.employee_no||'',departmentId:String(account?.current_department_id||''),roles:[],roleCode:'',authorizationBasis:'',effectiveFrom:account?.server_current_date||new Date().toISOString().slice(0,10),effectiveTo:'',reason:'',disableAccount:false,headContext:headContext(account),headExistingGrant:currentHeadGrant(account),confirmHeadReplacement:false});
  }
  function change(key,value) {setDraft({...draft,[key]:value,dirty:true});setError(null);}
  const current=data?.accounts.find(a=>String(a.person_id)===String(draft?.personId));
  const changed=Boolean(draft?.personId && data && (!current || fingerprint(current)!==draft.baseline));
  const revokedContext=draft?.mode==='revoke'?(draft.revokeContext||authorizationContext(current?.roleAssignments?.find(row=>String(row.assignmentId)===String(draft.assignmentId)))):null;
  const revokeBlocked=draft?.mode==='revoke'&&!revokedContext;
  const auditReturn=location.pathname+location.search;
  const directoryDraft=Boolean(draft&&!Object.prototype.hasOwnProperty.call(actionNames,draft.mode));
  const appointHead=draft?.mode==='grant'&&draft.roleCode===headRole, appointment=draft?.headContext, existingHeadGrant=appointHead?draft.headExistingGrant:null;
  const replaceHead=Boolean(appointHead&&appointment?.personId&&appointment.personId!==String(draft.personId));
  const grantValues=existingHeadGrant?{authorizationBasis:existingHeadGrant.authorizationBasis||'',effectiveFrom:dateValue(existingHeadGrant.effectiveFrom),effectiveTo:dateValue(existingHeadGrant.effectiveTo)}:draft;
  const headDatesCurrent=Boolean(appointment&&grantValues?.effectiveFrom&&grantValues.effectiveFrom<=appointment.today&&(!grantValues.effectiveTo||grantValues.effectiveTo>=appointment.today));
  const headBlocked=appointHead&&(!appointment||!appointment.departmentId||!headDatesCurrent||(replaceHead&&!draft.confirmHeadReplacement)||draft.headStale);
  const actionName=appointHead?'授权并登记部门负责人':actionNames[draft?.mode];
  const previousHead=appointment?.personId?businessText(appointment.personName||'现任负责人姓名未记录'):'未登记';
  async function submit(event) {
    event.preventDefault();if(lock.current||!draft||!data||changed||draft.uncertain||directoryDraft||headBlocked||revokeBlocked)return;
    lock.current=true;setBusy(true);setError(null);setMessage('');let sent=false;
    try {
      if(draft.personId) {const latest=await api.request(endpoint+'/'+draft.personId);if(fingerprint(latest)!==draft.baseline) {if(alive.current){setRevision(n=>n+1);setError({message:'账号或授权记录已变化，输入已保留。请取消本次草稿，核对最新记录后重新办理。'});}return;}}
      const assignment=code=>({roleCode:code,scopeDepartmentId:draft.departmentId,authorizationBasis:grantValues.authorizationBasis.trim(),effectiveFrom:grantValues.effectiveFrom,effectiveTo:grantValues.effectiveTo||null,...(appointHead?{expectedFinalResponsiblePersonId:appointment.personId,confirmReplaceFinalResponsiblePerson:replaceHead&&draft.confirmHeadReplacement}:{})});
      let url=endpoint+'/'+draft.personId,method='POST',body;
        if(draft.mode==='assign-account'){url+='/assign-account';body={expectedPerson:{employeeNo:draft.employeeNo,name:draft.name,departmentId:draft.departmentId},reason:draft.reason.trim()};}
        else if(draft.mode==='grant'){url+='/role-assignments';body=assignment(draft.roleCode);}
        else if(draft.mode==='revoke'){url+='/role-assignments/'+draft.assignmentId+'/revoke';body={reason:draft.reason.trim(),disableAccount:draft.disableAccount};}
        else {url+='/'+draft.mode;body={reason:draft.reason.trim()};}
      const confirmation=appointHead?`确认授权并登记部门负责人？部门：${appointment.departmentName}。现任负责人：${previousHead}；登记为：${draft.name}（${draft.employeeNo}）。${existingHeadGrant?'保留现有有效授权的依据和日期。':''}${replaceHead?'原负责人的角色授权不自动撤销，但不再满足本部门最终确认资格。':''}`:draft.mode==='revoke'?`确认撤销以下授权？员工：${businessText(draft.name,'员工姓名未记录')}（工号：${directoryIdentityValue(draft.employeeNo)}）。${authorizationDescription(revokedContext)}。${draft.disableAccount?'同时停用此员工的账号。':'本次不办理账号停用。'}`:`确认${actionNames[draft.mode]}？对象：${draft.name||draft.employeeNo}。`;
      if(!alive.current || !window.confirm(confirmation))return;
      sent=true;const result=await api.request(url,{method,body});
      if(!alive.current)return;
      setDraft(null);setPassword(result.initialPassword||'');setMessage((draft.mode==='revoke'?`${businessText(draft.name,'员工姓名未记录')}（工号：${directoryIdentityValue(draft.employeeNo)}）的授权已撤销。${authorizationDescription(revokedContext)}。请在该员工行展开“授权记录”核对撤销状态。`:actionName+'已完成。')+(result.departmentAppointment?.existingGrantPreserved?'现有角色授权、依据和有效期已保留。':''));setRevision(n=>n+1);
    } catch(e) {if(alive.current){setError(e);if(sent&&(!e.status||e.status>=500))setDraft({...draft,uncertain:true,dirty:true});else if(appointHead&&e.code==='DEPARTMENT_FINAL_RESPONSIBLE_CHANGED'){setDraft({...draft,headStale:true,dirty:true});setRevision(n=>n+1);}}}
    finally {lock.current=false;if(alive.current)setBusy(false);}
  }
  const roles=data?.model.roles||[], selectedRoles=draft?.mode==='grant'?[...(current?.roleAssignments||[]).filter(assignment=>effective(assignment,current)).map(a=>a.roleCode),draft.roleCode]:draft?.roles||[];
  const visible=[...new Set(roles.filter(r=>selectedRoles.includes(r.code)).flatMap(r=>(r.visibleTabs||[]).map(t=>t.name)))];
  const roleForm=draft?.mode==='grant';
  const shown=(data?.accounts||[]).filter(a=>(!department||String(a.current_department_id)===department)&&(!search||[a.login_name,a.employee_no,a.person_name,a.department_name].join(' ').toLowerCase().includes(search.toLowerCase())));
  return <div className="identity-module">
    <section className="card"><h2>账号与授权办理</h2><p>员工及组织信息由行政人事在组织与员工目录维护。管理员为列表中的已有员工赋予账号，并办理启停、密码及角色授权。登录名与工号一致；账号启用后，首次登录必须修改密码。</p><div className="identity-actions"><button disabled={busy} onClick={()=>setRevision(n=>n+1)}>刷新账号资料</button></div></section>
    {message&&<StatusPanel title={message}/>}
    {password&&<section className="card"><h2>一次性临时密码</h2><p>仅在本次响应中显示，请通过安全渠道交给账号本人。关闭或刷新后不能再次查看。</p><span className="identity-secret">{password}</span><button onClick={()=>setPassword('')}>我已安全记录</button></section>}
    {error&&<StatusPanel kind="error" title="账号办理未完成" onRetry={()=>setRevision(n=>n+1)}>{headErrors[error.code]||identityFailure(error,draft?.mode)}</StatusPanel>}
    {!data&&!error&&<StatusPanel kind="loading" title="正在读取账号资料…"/>}
    {draft&&<section className="card" ref={editor} data-account-editor><h2>{actionName||'原人员维护草稿'} · {draft.name||'待办理人员'}</h2><p>当前输入只保留在页面内存中，点击提交并确认后才写入。</p>
      {directoryDraft&&<StatusPanel kind="error" title="人员维护已迁移至组织与员工目录">原草稿仍保留在当前页面，不能从账号办理提交。请先核对并保留原输入，再由行政人事在目录中办理。</StatusPanel>}
      {changed&&<StatusPanel kind="error" title="账号记录已变化">原输入已保留，禁止提交旧草稿。请取消后按最新记录重新办理。</StatusPanel>}
      {draft.headStale&&<StatusPanel kind="error" title="部门负责人已变化">本次交接依据已过期。输入仍保留，请取消本次办理后重新核对。</StatusPanel>}
      {draft.uncertain&&<StatusPanel kind="error" title="操作结果尚未确定">请求可能已经执行，不能直接重复提交。请刷新账号资料，并查看该员工的账号与授权操作记录核对结果，再取消草稿并决定后续动作。{readAudit&&<a href={accountAuditLink({person_id:draft.personId,person_name:draft.name,employee_no:draft.employeeNo},auditReturn)} onClick={onNavigate}>查看该员工操作记录</a>}</StatusPanel>}
      {draft.mode==='revoke'&&<section data-revoke-authorization><h3>本次撤销的授权</h3><p>员工：{businessText(draft.name,'员工姓名未记录')}；工号：{directoryIdentityValue(draft.employeeNo)}。</p>{revokedContext?<p>{authorizationDescription(revokedContext)}</p>:<StatusPanel kind="error" title="尚未取得所选授权的完整资料">原输入保留，当前不能撤销。请刷新账号资料，取消本次草稿后从准确授权记录重新办理。</StatusPanel>}</section>}
      <form onSubmit={submit}><fieldset disabled={busy}><legend>办理内容</legend>
        {directoryDraft&&<><div className="identity-fields"><Field label="原草稿工号" readOnly value={directoryIdentityValue(draft.employeeNo)}/><Field label="原草稿姓名" readOnly value={businessText(draft.name,'员工姓名未记录')}/><Field label="原草稿部门" readOnly value={data?.departments.find(d=>String(d.id)===draft.departmentId)?.name||'部门名称未记录'}/><Field label="原草稿依据或原因" readOnly value={businessText(draft.authorizationBasis||draft.reason,'原依据或原因包含无法直接展示的内容，原输入仍保留。')}/></div><p>原草稿角色：{(draft.roles||[]).map(code=>data?.roles?.find(role=>role.code===code)?.name||'角色名称未记录').join('、')||'未选择'}；生效日期：{draft.effectiveFrom||'未填写'}；失效日期：{draft.effectiveTo||'未填写'}。</p></>}
        {draft.mode==='assign-account'&&<><div className="identity-fields"><Field label="工号" readOnly value={directoryIdentityValue(draft.employeeNo)}/><Field label="登录名" readOnly value={directoryIdentityValue(draft.employeeNo,'登录名')}/><Field label="姓名" readOnly value={businessText(draft.name,'员工姓名未记录')}/><Field label="部门" readOnly value={current?.department_name||'待明确'}/></div><p>已有角色：{(current?.roleAssignments||[]).filter(assignment=>effective(assignment,current)).map(role=>roleLabel(role,current)).join('、')||'暂无有效角色'}。本次只创建原人员的待启用账号，不修改人员及角色记录。{!(current?.roleAssignments||[]).some(assignment=>effective(assignment,current))&&'没有有效角色时，请另行授权后再启用账号。'}</p></>}
        {draft.mode==='grant'&&<Field label="选择角色"><select required value={draft.roleCode} onChange={e=>{setDraft({...draft,roleCode:e.target.value,confirmHeadReplacement:false,dirty:true});setError(null);}}><option value="">请选择角色</option>{roles.map(r=><option key={r.code} value={r.code}>{r.code===headRole?'部门负责人':r.name}</option>)}</select></Field>}
        {appointHead&&<section data-department-head-appointment><h3>本次部门负责人登记</h3>{!appointment?<StatusPanel kind="error" title="尚未取得部门负责人登记资料">当前输入保留，不能据角色名称推断现任负责人。请刷新账号资料，取消旧草稿后重新办理。</StatusPanel>:<><div className="identity-fields"><Field label="所选人员所属部门" readOnly value={appointment.departmentName}/><Field label="现任部门负责人" readOnly value={previousHead}/><Field label="本次登记负责人" readOnly value={`${draft.name}（${draft.employeeNo}）`}/></div><p>本次一并办理当前角色授权与部门最终负责人登记。部门负责人须同时具备组织登记与有效授权，才能本人核对并最终确认。</p>{replaceHead&&<label><input type="checkbox" checked={Boolean(draft.confirmHeadReplacement)} onChange={e=>change('confirmHeadReplacement',e.target.checked)}/>我已核对交接：将{appointment.departmentName}的负责人由{previousHead}变更为{draft.name}（{draft.employeeNo}）。</label>}{replaceHead&&<p>原负责人的角色授权保留；变更后，其本部门最终确认资格立即失效，原登录状态将失效，请重新登录核对。</p>}{appointment.personId===String(draft.personId)&&<p>组织登记已是本人，本次核对并补齐当前角色授权，不另行换人。</p>}</>}{existingHeadGrant&&<p>已有本部门当前有效授权，本次保留原授权行、依据和有效期并办理登记。下面显示原值，不能在本次改写；此前输入仍保留，切换角色可继续编辑。</p>}</section>}
        {roleForm&&<><div className="identity-fields"><Field label="授权依据（可选）" readOnly={Boolean(existingHeadGrant)} value={existingHeadGrant?businessText(grantValues.authorizationBasis||'授权依据未提供','授权依据包含无法直接展示的内容，请核对原始授权材料。'):grantValues.authorizationBasis} onChange={e=>change('authorizationBasis',e.target.value)}/><Field label="生效日期" type="date" required readOnly={Boolean(existingHeadGrant)} max={appointHead?appointment?.today:undefined} value={grantValues.effectiveFrom} onChange={e=>change('effectiveFrom',e.target.value)}/><Field label="失效日期（可选）" type="date" readOnly={Boolean(existingHeadGrant)} min={appointHead?appointment?.today:draft.effectiveFrom} value={grantValues.effectiveTo} onChange={e=>change('effectiveTo',e.target.value)}/></div>{appointHead&&<p role={headDatesCurrent?undefined:'status'}>本入口只办理当前生效的任命，不支持未来计划任命。{appointment&&`授权核对日期：${appointment.today}。`}{!headDatesCurrent&&'请核对生效日期及失效日期，当前日期必须处于授权期内。'}</p>}{draft.roleCode&&<p>本次角色说明：{businessText(roles.find(role=>role.code===draft.roleCode)?.description||'角色说明未记录')}。</p>}<p>所选角色可查看的页面：{visible.join('、')||'尚未选择角色'}。能否办理具体事项，还取决于该角色的授权范围和事项当前状态。</p></>}
        {!roleForm&&!directoryDraft&&<Field label={draft.mode==='assign-account'?'开户说明（可选）':'办理原因'} required={draft.mode!=='assign-account'} value={draft.reason} onChange={e=>change('reason',e.target.value)}/>}
        {draft.mode==='revoke'&&<label><input type="checkbox" checked={draft.disableAccount} onChange={e=>change('disableAccount',e.target.checked)}/>同时停用账号（撤销最后一个有效角色时需要）</label>}
        {draft.mode==='revoke'&&draft.revokedRoleCode===headRole&&<p>撤销角色授权后，当前人员不再具备部门最终确认资格；组织中的部门负责人登记仍保留，不表示已经免职。另任负责人时，请对新负责人办理“授权并登记部门负责人”。</p>}
        <div className="identity-actions"><button type="button" onClick={discard}>取消本次办理</button><button type="submit" disabled={!data||changed||draft.uncertain||directoryDraft||headBlocked||revokeBlocked}>{busy?'正在提交…':actionName||'请由行政人事办理'}</button></div>
      </fieldset></form></section>}
    {data&&<section className="card" data-accounts-ready="true"><div className="identity-fields"><Field label="搜索账号" value={search} onChange={e=>filter('search',e.target.value)}/><Field label="筛选部门"><select value={department} onChange={e=>filter('department',e.target.value)}><option value="">全部部门</option>{data.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field></div>
      <Table headers={['人员 / 工号','登录名 / 部门','有效角色','账号状态','办理及授权历史']} empty="暂无匹配账号" rows={shown.map(a=>[<>{businessText(a.person_name,'姓名未记录')} / {directoryIdentityValue(a.employee_no)}</>,<>{a.login_name?businessText(a.login_name,'登录名暂无法展示'):'无账号'} / {businessText(a.department_name||'所属部门待明确')}</>,(a.roleAssignments||[]).filter(assignment=>effective(assignment,a)).map(r=>roleLabel(r,a)).join('、')||'无有效角色',a.account_id?labelStatus(a.account_status):'未开户',<div key={a.person_id} data-account-id={a.person_id}>
        {manage&&<>{!a.account_id&&<button disabled={busy||Boolean(password)} onClick={()=>open('assign-account',a)}>赋予账号</button>}{a.account_id&&<><button disabled={busy||Boolean(password)} onClick={()=>open(a.account_status==='pending_activation'?'activate':a.account_status==='active'?'disable':'enable',a)}>{a.account_status==='pending_activation'?'启用':a.account_status==='active'?'停用':'重新启用或解锁'}</button><button disabled={busy||Boolean(password)} onClick={()=>open('reset-password',a)}>重置密码</button></>}</>}{assign&&<button disabled={busy||Boolean(password)} onClick={()=>open('grant',a)}>新增角色授权</button>}
        {readAudit&&<a href={accountAuditLink(a,auditReturn)} onClick={onNavigate}>查看此员工账号与授权操作记录</a>}
        <details><summary>授权记录（{a.roleAssignments?.length||0}）</summary>{(a.roleAssignments||[]).map(r=><p key={r.assignmentId}>{businessText(r.roleName||'角色名称未记录')} · {r.scopeType==='global'?'全公司范围':businessText(r.scopeDepartmentName||'授权部门名称未记录')} · {labelStatus(r.status)} · {businessText(r.authorizationBasis||'授权依据未提供','授权依据包含无法直接展示的内容，请核对原始授权材料。')} · {dateValue(r.effectiveFrom)||'生效日期未记录'} 至 {dateValue(r.effectiveTo)||'长期'} {assign&&r.status==='active'&&<button disabled={busy||Boolean(password)} onClick={()=>open('revoke',a,r)}>撤销该授权</button>}</p>)}</details>
      </div>])}/></section>}
  </div>;
}
