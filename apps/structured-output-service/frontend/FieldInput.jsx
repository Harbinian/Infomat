import React from 'react';
import { Input, Select, Checkbox, InputNumber } from 'antd';
import { splitRole, roleValue } from './organization.mjs';

export function displayValue(value, field = {}) {
  if (value == null || value === '') return '尚未填写';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length ? value.map(v => displayValue(v, { ...field, options: field.options })).join('、') : '尚未记录';
  if (typeof value === 'object') return '原有内容待核对';
  if (field.editor === 'organization-role') {
    const actor=splitRole(value,field.roles);
    return actor.department && field.roles[actor.department]?.includes(actor.position) ? String(value) : `${value}（原值保留，待核对）`;
  }
  const option=field.options?.find(o => o.value === value);
  if(option)return option.label;
  if(field.reference || field.technicalRef || /_refs?$/.test(field.key || ''))return '关联对象缺失或不适用（原引用保留）';
  return field.options?.length ? '原有选项待核对' : String(value);
}

export default function FieldInput({ field, value, onChange, onPaste, compact = false, id, autoFocus }) {
  const options = field.options || field.values || [];
  const known = new Set(options.map(o => o.value));
  const current = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  const isReference=field.reference || field.technicalRef || /_refs?$/.test(field.key || '');
  const safeOptions = [...options, ...current.filter(v => !known.has(v)).map(v => ({ value: v, label: field.organization ? `${v}（原值保留，待核对）` : isReference ? '关联对象缺失或不适用（原引用保留）' : field.editor==='tags' ? String(v) : '原有选项待核对', disabled:true }))].filter(o=>o.value!==null);
  const common = { id, 'aria-label': field.label, disabled: field.readOnly, autoFocus, onPaste, size: compact ? 'small' : 'middle' };
  if (field.editor === 'organization-role') {
    const roles=field.roles || {}, actor=splitRole(value,roles);
    const departmentOptions=[{value:'',label:'未指定执行主体'},...Object.keys(roles).map(value=>({value,label:value}))];
    const positionOptions=(roles[actor.department]||[]).map(value=>({value,label:value}));
    if(actor.position&&!positionOptions.some(option=>option.value===actor.position))positionOptions.push({value:actor.position,label:`${actor.position}（原值保留，待核对）`,disabled:true});
    return <div className="organization-role-picker"><Select {...common} aria-label="执行部门" value={actor.department||undefined} placeholder="请选择执行部门" options={departmentOptions} showSearch optionFilterProp="label" popupMatchSelectWidth={false} onChange={department=>onChange(department?roleValue(department,actor.position||actor.unresolved):'')}/>{field.manualPositions?<><Input {...common} id={id?`${id}-position`:undefined} aria-label="执行岗位" value={actor.position} placeholder="按实际填写岗位，待业务核对" disabled={field.readOnly||!actor.department} onChange={event=>onChange(roleValue(actor.department,event.target.value))}/><div className="helper">当前未提供有效岗位目录；岗位由编制者按实际填写，待业务核对。</div></>:<Select {...common} id={id?`${id}-position`:undefined} aria-label="执行岗位" value={actor.position||undefined} placeholder="请选择执行岗位" options={positionOptions} disabled={field.readOnly||!actor.department} showSearch optionFilterProp="label" popupMatchSelectWidth={false} onChange={position=>onChange(roleValue(actor.department,position))}/>}{actor.unresolved&&<div className="helper">{actor.unresolved}（原值保留，待核对；请选择对应部门和岗位）</div>}</div>;
  }
  if (field.editor === 'boolean' || (typeof value === 'boolean' && !options.length)) return <Checkbox id={id} aria-label={field.label} checked={Boolean(value)} disabled={field.readOnly} onChange={e => onChange(e.target.checked)}>{field.label}</Checkbox>;
  if (['select', 'lookup', 'multi-select', 'update-fields', 'tags'].includes(field.editor) || options.length) return <Select {...common} style={{ width: '100%' }} placeholder={field.nullable?'未指定':'请选择'} popupMatchSelectWidth={false} showSearch optionFilterProp="label" mode={field.editor==='tags'?'tags':['multi-select','update-fields'].includes(field.editor) ? 'multiple' : undefined} allowClear={field.nullable} value={value == null ? undefined : value} options={safeOptions} onChange={v => onChange(v === undefined ? null : v)} />;
  if (field.editor === 'number') return <InputNumber {...common} value={value} style={{ width: '100%' }} onChange={onChange} />;
  if (field.editor === 'textarea' && !compact) return <Input.TextArea {...common} rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  return <Input {...common} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
}
