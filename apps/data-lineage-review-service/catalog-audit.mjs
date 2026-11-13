import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function loadCatalogAudit(file, fields, presentation) {
  if (!file) return null;
  const bytes = readFileSync(file);
  const catalog = JSON.parse(bytes.toString('utf8'));
  if (catalog.format !== 'review-catalog-audit-v1' || !Array.isArray(catalog.tables) ||
      catalog.expectedSelectableFields !== fields.length || catalog.missingExistingFields ||
      catalog.attributeDrift || catalog.unresolvedReferences) throw new Error('Catalog audit is incomplete');
  const grouped = new Map();
  for (const field of fields) {
    const key = JSON.stringify([field.system, field.table.toLowerCase()]);
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  if (grouped.size !== catalog.tables.length) throw new Error('Audited object coverage changed');
  for (const table of catalog.tables) {
    if (table.missingFields || grouped.get(JSON.stringify([table.system, table.table.toLowerCase()])) !== table.completeFields) {
      throw new Error('Audited table is missing columns');
    }
  }
  const pendingFields = [...presentation.labels.values()].filter(field => field.labelStatus === 'needs_verification');
  return { catalog, pendingFields, digest: createHash('sha256').update(bytes).digest('hex') };
}

function cell(value) {
  const text = String(value ?? '');
  const literal = /^[\s\uFEFF]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(text) ? "'" + text : text;
  return '"' + literal.replaceAll('"', '""') + '"';
}

export function pendingNamesCsv(audit) {
  const rows = [['系统', '表中文名', '字段中文显示', '缺口说明', '字典参考名称', '技术表名', '技术字段名', '字段标识']];
  for (const field of audit.pendingFields) rows.push([field.system, field.tableLabel, field.displayName, field.labelSource,
    [...new Set(field.evidence.map(item => item.caption))].join('；'), field.table, field.name, field.id]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
