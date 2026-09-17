// Synthetic workbook builder for API/browser tests; no external materials.
const ExcelJS = require('exceljs');
const profile = require('../../server/masterDataTemplateProfile.json');
function fixture({ objectRow = 17, fieldHeader = 51, fieldRow = 53, enumRow = 257, reverse = false, filled = true } = {}) {
  const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet('主数据清单');
  const columns = {};
  for (const [kind, headerRow] of [['object', 15], ['field', fieldHeader]]) {
    const definitions = reverse ? [...profile.sections[kind]].reverse() : profile.sections[kind];
    columns[kind] = Object.fromEntries(definitions.map((d, i) => [d.key, i + 1]));
    sheet.getRow(headerRow).values = definitions.map(d => d.label);
  }
  profile.rule_texts.forEach((rule, i) => { sheet.getCell(`A${6 + i}`).value = rule; });
  sheet.getRow(11).values = ['填报部门*', '合成部门', '填报人*', '合成人员', '部门事实确认人*', '合成确认人', '填报日期*', '2026-09-16', 'MDM 工作组复核人', null, '模板版本', profile.template_version];
  sheet.getRow(enumRow).values = ['类别', '术语或枚举项', '定义与填写边界'];
  const set = (kind, row, key, value, numFmt) => {
    const cell = sheet.getRow(row).getCell(columns[kind][key]); cell.value = value; if (numFmt) cell.numFmt = numFmt; return cell;
  };
  function object(row = objectRow, id = 'OBJ-001', name = '合成对象') {
    for (const d of profile.sections.object) if (d.required) set('object', row, d.key, d.enum_values?.[0] || '合成事实');
    for (const [key, value] of Object.entries({ local_id: id, name, maintaining_department: '待确认', fact_status: '已由部门确认', missing_evidence: '待核对组织', confirmation_actor: '合成主体', expected_date: '2026-10-01', closure_condition: '取得核对依据' })) set('object', row, key, value);
  }
  function field(row = fieldRow, id = 'FLD-001', parent = 'OBJ-001') {
    for (const d of profile.sections.field) if (d.required) set('field', row, d.key, d.enum_values?.[0] || '合成事实');
    for (const [key, value] of Object.entries({ local_id: id, object_local_id: parent, name: '合成编号', role: '唯一标识字段', required: '是', format: '代码', sample_value: '00107', sensitivity: '无敏感信息', masking: '无需脱敏' })) set('field', row, key, value);
  }
  if (filled) { object(); field(); }
  return { wb, sheet, set, object, field, columns, bytes: async () => Buffer.from(await wb.xlsx.writeBuffer()) };
}

module.exports = { fixture };

