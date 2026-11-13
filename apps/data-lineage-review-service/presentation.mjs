import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fieldId } from './store.mjs';

export function loadPresentation(file, fields) {
  if (!file) return null;
  const bytes = readFileSync(file);
  const catalog = JSON.parse(bytes.toString('utf8'));
  const comprehensive = catalog.format === 'review-field-presentation-v2';
  if ((!comprehensive && (catalog.format !== 'review-field-presentation-v1' || catalog.system !== '用友U8' ||
      catalog.database !== 'UFDATA_333_2025')) || !Array.isArray(catalog.fields)) throw new Error('Unsupported field presentation');
  const labels = new Map();
  const counts = {};
  const countsBySystem = {};
  for (const item of catalog.fields) {
    const field = fields.get(item.id);
    if (!field || (!comprehensive && item.system !== '用友U8') || field.system !== item.system || field.table !== item.table || field.name !== item.name ||
        item.id !== fieldId(item.system, item.table, item.name) || labels.has(item.id) ||
        ![item.displayName, item.tableLabel, item.labelSource].every(value => typeof value === 'string' && /[\u3400-\u9fff]/u.test(value)) ||
        typeof item.labelStatus !== 'string' || !Array.isArray(item.evidence)) throw new Error('Invalid or unmatched Chinese field label');
    labels.set(item.id, item);
    counts[item.labelStatus] = (counts[item.labelStatus] ?? 0) + 1;
    countsBySystem[item.system] ??= {};
    countsBySystem[item.system][item.labelStatus] = (countsBySystem[item.system][item.labelStatus] ?? 0) + 1;
  }
  if ([...fields.values()].some(field => (comprehensive ? !(field.system === '勤哲' &&
    (/^dbo\.ES/i.test(field.table) || /ExcelServer/i.test(field.name))) : field.system === '用友U8') &&
    !labels.has(field.id))) throw new Error('Field label coverage incomplete');
  return { catalog, labels, counts, countsBySystem, digest: createHash('sha256').update(bytes).digest('hex') };
}

export function presentFields(fields, presentation) {
  return new Map([...fields].map(([id, field]) => {
    const label = presentation?.labels.get(id);
    return [id, label ? { ...field, displayName: label.displayName, tableLabel: label.tableLabel,
      labelStatus: label.labelStatus, labelSource: label.labelSource,
      ...(label.objectKind ? { objectKind: label.objectKind } : {}),
      ...(label.parentReference ? { parentReference: label.parentReference } : {}) } : field];
  }));
}
