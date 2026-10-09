// Read-only projection of recorded associations. The controller owns all navigation and edits.
import { catalog, resolve, businessLabel, labelValue } from './model.mjs';

const GROUPS = [
  ['create', '创建的数据'], ['update', '更新的数据'], ['use', '使用的数据'], ['form', '处理的表单'],
];
const array = value => Array.isArray(value) ? value : [];

export function behaviorAssociations(document, target) {
  const entries = catalog(document);
  const groups = new Map(GROUPS.map(([key, title]) => [key, { key, title, items: new Map() }]));
  if (target?.kind !== 'behavior' || resolve(document, target).status !== 'valid') {
    return { groups: [], warning: '当前环节缺失或关联无法唯一确定，原引用保持不变。' };
  }
  for (const link of entries.filter(entry => ['data-link', 'form-link'].includes(entry.kind) && entry.entity.behavior_ref === target.ref)) {
    const kind = link.kind === 'data-link' ? 'data' : 'form';
    const owner = entries.find(entry => entry.kind === kind && entry.entity === link.parent);
    if (!owner) continue;
    const destination = { kind, ref: owner.ref };
    const ownerValid = resolve(document, destination).status === 'valid';
    const linkValid = resolve(document, link).status === 'valid';
    const fieldsValid = kind !== 'data' || array(link.entity.updated_field_refs).every(ref => resolve(document, { kind: 'data-field', ref, parentRef: owner.ref }).status === 'valid');
    const operation = link.entity.operation;
    const key = kind === 'form' ? 'form' : ['create', 'update', 'use'].includes(operation) ? operation : 'pending';
    if (!groups.has(key)) groups.set(key, { key, title: '待确认的数据操作', items: new Map() });
    const items = groups.get(key).items;
    // Valid identity determines grouping; unresolved records remain separate and cannot navigate.
    const identity = ownerValid ? JSON.stringify([kind, owner.ref]) : owner.path;
    if (!items.has(identity)) items.set(identity, { key: identity, label: businessLabel(entries, owner), target: destination, operations: new Set(), warnings: new Set(), disabled: false });
    const item = items.get(identity);
    if (!ownerValid || !linkValid || !fieldsValid) {
      item.disabled = true;
      item.warnings.add(!ownerValid ? '关联对象无法唯一确定' : !linkValid ? '关联记录待核对' : '更新字段缺失或所属对象不一致');
    }
    if (key === 'pending') item.warnings.add(operation === 'pending_confirmation' ? '数据操作待确认' : '原有数据操作待核对');
    if (kind === 'form') {
      for (const value of array(link.entity.operations)) item.operations.add(labelValue(value));
      if (!array(link.entity.operations).length) item.warnings.add('表单处理方式待填写');
    }
  }
  return { warning: '', groups: [...groups.values()].map(group => ({
    key: group.key, title: group.title, count: group.items.size,
    items: [...group.items.values()].map(item => ({ ...item, operations: [...item.operations], warnings: [...item.warnings] })),
  })) };
}
