import React from 'react';
import { Input, Select, Checkbox, InputNumber } from 'antd';

export function displayValue(value, field = {}) {
  if (value == null || value === '') return '尚未填写';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length ? value.map(v => displayValue(v, { ...field, options: field.options })).join('、') : '尚未记录';
  if (typeof value === 'object') return JSON.stringify(value);
  return field.options?.find(o => o.value === value)?.label || String(value);
}

export default function FieldInput({ field, value, onChange, onPaste, compact = false, id, autoFocus }) {
  const options = field.options || field.values || [];
  const known = new Set(options.map(o => o.value));
  const current = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  const safeOptions = [...options, ...current.filter(v => !known.has(v)).map(v => ({ value: v, label: `${v}（原值，请核对）`, disabled:true }))].filter(o=>o.value!==null);
  const common = { id, 'aria-label': field.label, disabled: field.readOnly, autoFocus, onPaste, size: compact ? 'small' : 'middle' };
  if (field.editor === 'boolean' || (typeof value === 'boolean' && !options.length)) return <Checkbox id={id} aria-label={field.label} checked={Boolean(value)} disabled={field.readOnly} onChange={e => onChange(e.target.checked)}>{field.label}</Checkbox>;
  if (['select', 'lookup', 'multi-select', 'update-fields', 'tags'].includes(field.editor) || options.length) return <Select {...common} style={{ width: '100%' }} placeholder={field.nullable?'未指定':'请选择'} popupMatchSelectWidth={false} showSearch optionFilterProp="label" mode={field.editor==='tags'?'tags':['multi-select','update-fields'].includes(field.editor) ? 'multiple' : undefined} allowClear={field.nullable} value={value == null ? undefined : value} options={safeOptions} onChange={v => onChange(v === undefined ? null : v)} />;
  if (field.editor === 'number') return <InputNumber {...common} value={value} style={{ width: '100%' }} onChange={onChange} />;
  if (field.editor === 'textarea' && !compact) return <Input.TextArea {...common} rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  return <Input {...common} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
}
