import {businessText,userMessage} from './businessPresentation.js';
import {directoryFieldLabel} from './directoryPresentation.js';
import {directoryDisplayValue as directoryValue,directoryIdentityValue,directoryRecordLabel} from './directoryIdentityPresentation.js';
import {organizationInitialValues} from './directoryMaintenancePresentation.js';
import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { IdentityField as Field, IdentityTable as Table, identityFailure } from './IdentityShared.jsx';

const entityName = { person: '员工', department: '部门', office: '办公室' };
const fieldName = { employee_no:'员工工号', code:'组织编码', person_name:'姓名', current_department_id:'所属部门', department_name:'所属部门', employment_status:'在职状态', mobile:'手机', email:'邮箱', office_ids:'办公室归属', office_codes:'办公室归属', name:'名称', parent_id:'上级部门', parent_code:'上级部门', department_type:'部门类型', status:'状态', manager_person_id:'办公室负责人', manager_employee_no:'办公室负责人', department_id:'归口部门', owning_department_code:'归口部门' };
const idOf = row => String(row?.person_id ?? row?.id ?? '');
function initialValues(entity, row) {
  if (entity === 'person') return {employee_no:row?.employee_no||'',person_name:row?.person_name||'',current_department_id:row?.current_department_id?String(row.current_department_id):'',employment_status:row?.employment_status||'active',mobile:row?.mobile||'',email:row?.email||'',office_ids:(row?.office_ids||row?.offices?.map(o=>o.id)||[]).map(String)};
  return organizationInitialValues(entity,row);
}

export function DirectoryMaintenance({ api, kind, snapshot, loadError, draft, setDraft, onSaved }) {
  const [selection,setSelection]=useState(''),[error,setError]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [savedEmployee,setSavedEmployee]=useState(null);
  const alive=useRef(true),lock=useRef(false),focus=useRef(null);
  const editing=draft?.mode==='directory-maintenance';
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(editing)focus.current?.focus();},[editing,draft?.request_id]);
  if (!snapshot?.canMaintain) return editing ? <section className="card"><StatusPanel kind="error" title={loadError?'当前无法核对目录权限':snapshot?'目录维护权限已变化':'正在重新核对目录权限'}>原输入保留如下，当前不能提交。</StatusPanel><Table headers={['原输入字段','内容']} rows={[...Object.entries(draft.values||{}).filter(([key])=>key!=='code').map(([key,val])=>[fieldName[key]||'相关内容',directoryValue(key,val,snapshot||{})]),['变更原因',draft.reason]]}/></section> : null;
  const departments=snapshot.departments||[],persons=snapshot.persons||[],offices=snapshot.offices||[];
  const choices=kind==='roster'?persons.map(row=>({entity:'person',row,label:directoryRecordLabel(row,true,snapshot)})):[...departments.map(row=>({entity:'department',row,label:'部门 · '+directoryRecordLabel(row,false,snapshot)})),...offices.map(row=>({entity:'office',row,label:'办公室 · '+directoryRecordLabel(row,false,snapshot)}))];
  function start(entity,row) {
    if(draft||lock.current)return;
    setError(null);setMessage('');setSavedEmployee(null);
    setDraft({mode:'directory-maintenance',kind,entity,operation:row?'update':'create',id:row?idOf(row):null,values:initialValues(entity,row),reason:'',expected_snapshot_hash:snapshot.snapshot_hash,request_id:crypto.randomUUID(),checked:null,dirty:true});
  }
  function patch(values) {setDraft({...draft,...values,checked:null,dirty:true});setError(null);}
  function value(key,next) {patch({values:{...draft.values,[key]:next}});}
  function requestBody() {return {entity:draft.entity,operation:draft.operation,...(draft.id?{id:draft.id}:{}),values:draft.values,reason:draft.reason,expected_snapshot_hash:draft.expected_snapshot_hash};}
  async function operation(action) {
    if(lock.current)return;
    if(!draft.reason.trim()){setError({message:'请填写本次变更原因。'});return;}
    lock.current=true;setBusy(true);setError(null);
    try {
      if(action==='preview') {
        const result=await api.request('/api/directory/preview',{method:'POST',body:requestBody()});
        if(alive.current)setDraft({...draft,checked:result});
      } else {
        if(!draft.checked||draft.checked.errors?.length)return;
        await api.request('/api/directory/changes',{method:'POST',body:{...requestBody(),request_hash:draft.checked.request_hash,request_id:draft.request_id}});
        if(alive.current){setDraft(null);setMessage(draft.entity==='person'&&draft.operation==='create'
          ? '员工'+businessText(draft.values.person_name,'姓名未记录')+'（工号：'+directoryIdentityValue(draft.values.employee_no)+'）已新增并生效。本次保存人员资料，不办理登录账号。'
          : '目录变更已保存并生效，修改前后内容、操作人和原因已记录。');
          setSavedEmployee(draft.entity==='person'&&draft.operation==='create'?{name:draft.values.person_name,employeeNo:draft.values.employee_no}:null);onSaved();}
      }
    } catch(e) {
      if(alive.current){setError(e);if(e.status===409)setDraft({...draft,checked:null,sourceChanged:true,uncertain:false});else if(action==='save'&&(!e.status||e.status>=500))setDraft({...draft,uncertain:true});}
    } finally {lock.current=false;if(alive.current)setBusy(false);}
  }
  async function refreshBasis() {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError(null);
    try {
      const latest=await api.request('/api/directory/v1?include_contacts=true');
      if(alive.current)setDraft({...draft,expected_snapshot_hash:latest.snapshot_hash,checked:null,sourceChanged:false,request_id:crypto.randomUUID()});
    } catch(e){if(alive.current)setError(e);}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  const select=(key,label,rows,optional=true)=> <Field label={label}><select value={draft.values[key]} onChange={e=>value(key,e.target.value)} required={!optional}><option value="">{optional?'未设置':'请选择'}</option>{rows.map(row=><option key={idOf(row)} value={idOf(row)}>{directoryRecordLabel(row,Object.hasOwn(row,'employee_no'),snapshot)}</option>)}</select></Field>;
  return <section className="card" data-directory-maintenance={kind}><h2>行政人事维护</h2><p>3000 保存的组织与员工资料供全域引用。核对后保存即生效，员工账号及系统角色由管理员另行办理。</p>
    {message&&<StatusPanel title={message}/>}{savedEmployee&&<section data-employee-account-handoff><h3>如需开通登录账号，请交给账号管理员</h3><p>员工：{businessText(savedEmployee.name,'姓名未记录')}；工号：{directoryIdentityValue(savedEmployee.employeeNo)}。账号管理员在“账号与授权”中点击“刷新账号资料”，按此工号搜索并核对员工，再办理“赋予账号”、角色授权和账号启用。</p><p>完成启用后，由管理员将一次性临时密码通过安全渠道交给员工本人；员工首次登录后修改密码。人员保存不会自动生成开户待办，请另行交接以上姓名与工号。</p><p>本次人员变更可在下方“花名册导入与维护记录”中按姓名与工号查阅。</p></section>}{error&&<StatusPanel kind="error" title="目录变更未完成">{error.status===409?'目录或关联授权已变化，输入已保留。请读取最新目录并重新核对差异。':identityFailure(error)}</StatusPanel>}
    {!editing&&<div className="identity-actions">{kind==='roster'?<button disabled={Boolean(draft)} onClick={()=>start('person')}>新增员工</button>:<><button disabled={Boolean(draft)} onClick={()=>start('department')}>新增部门</button><button disabled={Boolean(draft)} onClick={()=>start('office')}>新增办公室</button></>}<Field label="选择维护记录"><select disabled={Boolean(draft)} value={selection} onChange={e=>setSelection(e.target.value)}><option value="">请选择已有记录</option>{choices.map(choice=><option key={choice.entity+idOf(choice.row)} value={choice.entity+':'+idOf(choice.row)}>{choice.label}</option>)}</select></Field><button disabled={Boolean(draft)||!selection} onClick={()=>{const chosen=choices.find(c=>c.entity+':'+idOf(c.row)===selection);if(chosen)start(chosen.entity,chosen.row);}}>修改所选记录</button></div>}
    {editing&&<form onSubmit={e=>{e.preventDefault();operation('preview');}}><fieldset disabled={busy||draft.uncertain}><legend>{draft.operation==='create'?'新增':'修改'}{entityName[draft.entity]}</legend><div className="identity-fields">
      {draft.entity==='person'?<><Field label="员工工号" required maxLength={128} readOnly={draft.operation==='update'} value={draft.operation==='update'?directoryIdentityValue(draft.values.employee_no):draft.values.employee_no} onChange={e=>value('employee_no',e.target.value)}/><Field label="员工姓名" required maxLength={255} value={draft.values.person_name} onChange={e=>value('person_name',e.target.value)}/>{select('current_department_id','员工所属部门',departments,false)}<Field label="员工在职状态"><select value={draft.values.employment_status} onChange={e=>value('employment_status',e.target.value)}><option value="active">在职</option><option value="leave">离职</option><option value="suspended">停职</option><option value="inactive">停用</option></select></Field><Field label="员工手机" maxLength={64} value={draft.values.mobile} onChange={e=>value('mobile',e.target.value)}/><Field label="员工邮箱" maxLength={255} value={draft.values.email} onChange={e=>value('email',e.target.value)}/></>:<><Field label="组织名称" required maxLength={255} value={draft.values.name} onChange={e=>value('name',e.target.value)}/>{draft.entity==='department'?<>{select('parent_id','上级部门',departments.filter(row=>idOf(row)!==draft.id))}<Field label="部门类型" maxLength={64} value={draft.values.department_type} onChange={e=>value('department_type',e.target.value)}/></>:<>{select('department_id','办公室归口部门',departments,false)}{select('manager_person_id','办公室负责人',persons)}</>}<Field label="组织状态"><select value={draft.values.status} onChange={e=>value('status',e.target.value)}><option value="active">有效</option><option value="inactive">停用</option><option value="archived">归档</option></select></Field></>}
    </div>{draft.entity==='person'&&<fieldset><legend>员工办公室归属</legend><div className="identity-checks">{offices.map(office=><label key={idOf(office)}><input type="checkbox" checked={draft.values.office_ids.includes(idOf(office))} onChange={e=>value('office_ids',e.target.checked?[...draft.values.office_ids,idOf(office)]:draft.values.office_ids.filter(id=>id!==idOf(office)))}/>{directoryRecordLabel(office,false,snapshot)}</label>)}</div>{!offices.length&&<p>当前没有办公室记录。</p>}</fieldset>}
    <Field label="变更原因"><textarea ref={focus} required maxLength={2000} rows={3} value={draft.reason} onChange={e=>patch({reason:e.target.value})}/></Field>
    {draft.sourceChanged&&<button type="button" onClick={refreshBasis}>读取最新目录并保留输入</button>}
    <div className="identity-actions"><button type="submit" disabled={draft.sourceChanged}>核对本次变更</button><button type="button" onClick={()=>{if(window.confirm('放弃当前尚未保存的目录变更？')){setDraft(null);setError(null);}}}>取消目录变更</button></div>
    {draft.checked&&<div data-directory-maintenance-preview><h3>本次变更核对</h3>{draft.entity==='person'&&<p data-directory-employee-review>员工姓名：{businessText(draft.values.person_name,'姓名未记录')}；员工工号：{directoryIdentityValue(draft.values.employee_no)}。{draft.operation==='create'?'本次将新增此员工，开户时登录名使用此工号。':'本次修改此员工资料，工号保持不变。'}</p>}{draft.checked.errors?.length>0?<ul>{draft.checked.errors.map((item,i)=><li key={i}>{userMessage(item.message||String(item))}</li>)}</ul>:<p>请确认以下差异。保存成功后立即生效。</p>}<Table headers={['记录','字段','修改前','修改后']} rows={[...(draft.entity==='person'&&!(draft.checked.changes||[]).some(change=>(change.fields||[]).some(field=>field.field==='employee_no'))?[[businessText(draft.values.person_name,'姓名未记录'),'员工工号',draft.operation==='create'?'未设置':directoryIdentityValue(draft.values.employee_no),directoryIdentityValue(draft.values.employee_no)]]:[]),...(draft.checked.changes||[]).flatMap(change=>(change.fields||[]).filter(field=>field.field!=='code').map(field=>[draft.values.person_name||draft.values.name||'所选记录',directoryFieldLabel(field.field),directoryValue(field.field,field.before,snapshot),directoryValue(field.field,field.after,snapshot)]))]}/><button type="button" disabled={Boolean(draft.checked.errors?.length)} onClick={()=>operation('save')}>保存并生效</button></div>}
    </fieldset>{draft.uncertain&&<StatusPanel kind="error" title="保存结果暂未确认">输入已锁定保留。请用原请求核实保存结果，避免重复办理。<button type="button" disabled={busy} onClick={()=>operation('save')}>用原请求核实保存结果</button></StatusPanel>}</form>}
  </section>;
}
