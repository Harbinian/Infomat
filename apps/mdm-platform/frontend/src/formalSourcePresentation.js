const choices = {
  value_usage_mode: {
    authoritative_input: '在本流程录入，并以此处的值为准',
    reuse_existing: '沿用已有值',
    calculated: '通过计算取得',
    external_source: '从外部来源取得'
  },
  value_origin_mode: {
    direct_current_process: '在当前流程中直接填写或形成',
    depends_on_data: '从已有数据中取得'
  },
  source_type: {
    process_data: '流程中的业务数据',
    external_system: '外部系统'
  },
  source_role: {
    provides_value: '提供填写值',
    calculation_input: '参与计算',
    validation_basis: '作为核对依据'
  }
};
const labels = {value_usage_mode: '填写值如何使用', value_origin_mode: '填写值从哪里取得', source_type: '来源类别', source_role: '来源用途'};
const subjects = {value_usage_mode: '使用方式', value_origin_mode: '取值来源', source_type: '来源类别', source_role: '来源用途'};
const fieldChoices = ['value_usage_mode', 'value_origin_mode'];

export function formalFieldChoice(field, value) {
  const subject = subjects[field];
  if (!subject) return null;
  if (value == null || value === '') return `原文未填写${subject}，请由本流程编制人员核对后补充。`;
  if (fieldChoices.includes(field) && value === 'pending_confirmation') return `${subject}尚待业务确认，请由本流程编制人员核对后补充。`;
  return typeof value === 'string' && Object.hasOwn(choices[field], value)
    ? choices[field][value]
    : `原记录的${subject}暂无法识别，请由本流程编制人员核对原编制文件。`;
}

// Project native form choices only for read-only source details. Unknown and
// missing choices stay distinct; saved documents and source links are untouched.
export function formalSourcePresentation(value, formSource = false) {
  if (Array.isArray(value)) return value.map(entry => formalSourcePresentation(entry, formSource));
  if (!value || typeof value !== 'object') return value;
  const formItem = Object.hasOwn(value, 'item_name') || Object.hasOwn(value, 'item_type');
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    // Lifecycle provenance has a different source vocabulary. Only the source
    // links of an explicit form item use the field-source choice meanings.
    const choice = formItem && fieldChoices.includes(key) || formSource && ['source_type', 'source_role'].includes(key);
    Object.defineProperty(result, choice ? labels[key] : key, {value: choice ? formalFieldChoice(key, entry) : formalSourcePresentation(entry, formItem && key === 'source_links'), enumerable: true, configurable: true, writable: true});
  }
  if (formItem) {
    for (const key of fieldChoices) {
      if (!Object.hasOwn(value, key)) result[labels[key]] = formalFieldChoice(key, undefined);
    }
  }
  return result;
}
