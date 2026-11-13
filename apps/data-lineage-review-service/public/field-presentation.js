const chinese = /[\u3400-\u9fff]/u;

export function fieldLabel(field) {
  const label = field.displayName || field.businessLabel;
  if (field.system === '用友U8' || field.system === 'KFU8QZ') return label && chinese.test(label) ? label : '字段含义待核实';
  return label || field.name;
}

export function tableLabel(field) {
  return field.tableLabel || (field.system === '用友U8' ? '来源表待核对' : field.table);
}

export function fieldLocation(field) {
  return field.system + ' / ' + tableLabel(field) + ' · ' + fieldLabel(field);
}

export function describeLocation(system, table, name, fields) {
  const field = fields.find(item => item.system === system && item.table.toLowerCase() === table.toLowerCase() && item.name.toLowerCase() === name.toLowerCase());
  if (field) return fieldLocation(field);
  return system === '用友U8' ? '用友U8 / 来源字段待核对' : system + ' ' + table + '.' + name;
}

export function referenceLabel(text, fields) {
  if (!text) return text;
  const aliases = new Map(fields.filter(field => field.system === '用友U8')
    .map(field => [(field.table + '.' + field.name).toLowerCase(), tableLabel(field) + ' · ' + fieldLabel(field)]));
  return text.replace(/dbo\.[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/g,
    location => aliases.get(location.toLowerCase()) || location);
}

export function groupLabel(name, fields) {
  if (!fields.some(field => field.displayName)) return name;
  const labels = [...new Set(fields.map(fieldLabel))];
  const primary = fieldLabel(fields.find(field => field.system === '用友U8') ?? fields[0]);
  return labels.length === 1 ? primary : primary + '等（' + labels.length + '种中文名）';
}
