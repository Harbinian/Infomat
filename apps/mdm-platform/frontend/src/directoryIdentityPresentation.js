import {businessText} from './businessPresentation.js';
import {directoryValue} from './directoryPresentation.js';

export function directoryIdentityValue(value, label='工号') {
  return value == null || value === '' ? `${label}未记录` : businessText(value, `${label}暂无法展示，请核对原资料`);
}

export function directoryDisplayValue(field,value,snapshot,historical=false) {
  if (['employee_no','工号','员工工号'].includes(field)) return directoryIdentityValue(value);
  if (['code','组织编码'].includes(field)) {
    if(value==null||value==='')return '未设置';
    if(historical)return '历史组织名称未记录';
    const row=[...(snapshot?.departments||[]),...(snapshot?.offices||[])].find(row=>String(row.code)===String(value));
    return row?directoryRecordLabel(row,false,snapshot):'组织名称未记录，请核对原资料';
  }
  if(!historical&&['office_ids','office_codes','办公室编码'].includes(field)&&value!=null&&value!=='') {
    const values=Array.isArray(value)?value:String(value).split(';').map(item=>item.trim()).filter(Boolean);
    return values.map(item=>{const row=(snapshot?.offices||[]).find(row=>String(field==='office_ids'?row.id:row.code)===String(item));return row?directoryRecordLabel(row,false,snapshot):'办公室名称未记录';}).join('、')||'未设置';
  }
  return directoryValue(field,value,snapshot,historical);
}

export function directoryRecordLabel(row, person=false, snapshot={}) {
  const fallback=person ? '员工姓名未记录' : '组织名称未记录';
  const name=businessText((person ? row.person_name : row.name)||fallback, fallback);
  if(person)return `${name} · ${directoryIdentityValue(row.employee_no)}`;
  let parentId=row.department_id||row.parent_id;const path=[],seen=new Set();
  while(parentId&&!seen.has(String(parentId))&&path.length<30){seen.add(String(parentId));const parent=(snapshot.departments||[]).find(item=>String(item.id)===String(parentId));if(!parent)break;path.unshift(businessText(parent.name||'归属部门名称未记录'));parentId=parent.parent_id;}
  if(!path.length&&row.department_name)path.push(businessText(row.department_name,'归属部门名称未记录'));
  return [...path,name].join(' / ');
}

export function directoryHistoryTitle(row) {
  if (row.source_file_name !== 'directory-change.json') return businessText(row.title, '发布名称未记录');
  const summary=row.history_summary;
  if (!summary) return `${businessText(row.title,'目录维护')}（维护对象未记录）`;
  const person=summary.entity==='person', label={person:'员工',department:'部门',office:'办公室'}[summary.entity] || '目录记录';
  const field=person ? 'person_name' : 'name', code=person ? 'employee_no' : 'code';
  const before=summary.before?.[field], after=summary.after?.[field];
  const name=before && after && before!==after
    ? `${businessText(before,'原名称暂无法展示')} → ${businessText(after,'新名称暂无法展示')}`
    : after ? businessText(after,`${label}名称未记录`) : before ? `变更前：${businessText(before,`${label}名称未记录`)}` : `${label}名称未记录`;
  const businessCode=summary.after?.[code] || summary.before?.[code];
  return `${{create:'新增',update:'修改'}[summary.operation] || '维护'}${label} · ${name}${person?' · '+directoryIdentityValue(businessCode):''}`;
}

export function directoryResponsibleName(row,snapshot={}) {
  const personId=row.kind==='office'?row.manager_person_id:row.final_responsible_person_id;
  if(personId==null||personId==='')return row.kind==='office'?'尚未指定':'尚未登记';
  const person=(snapshot.persons||[]).find(person=>String(person.person_id)===String(personId));
  return person?.person_name?businessText(person.person_name,'负责人姓名暂无法展示'):'负责人姓名未记录';
}
