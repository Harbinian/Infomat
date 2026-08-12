'use strict';

const crypto = require('crypto');

const SCHEMA_VERSION = 'information-collection-form-v1';
const FIELD_TYPES = new Set([
  'short_text', 'long_text', 'integer', 'decimal', 'date', 'datetime',
  'single_choice', 'multiple_choice', 'boolean', 'person', 'department', 'attachment'
]);
const FIELD_LIMIT = 200;
const SECTION_LIMIT = 20;
const OPTION_LIMIT = 100;
const DETAIL_ROW_LIMIT = 100;

function text(value, maxLength = Infinity) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function uuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function stableUuid(value) {
  return uuid(value) ? String(value).toLowerCase() : crypto.randomUUID();
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function normalizeOption(option = {}) {
  return {
    optionKey: stableUuid(option.optionKey),
    label: text(option.label, 200)
  };
}

function normalizeField(field = {}) {
  const type = FIELD_TYPES.has(field.type) ? field.type : 'short_text';
  const options = ['single_choice', 'multiple_choice'].includes(type)
    ? (Array.isArray(field.options) ? field.options : []).slice(0, OPTION_LIMIT).map(normalizeOption)
    : [];
  return {
    fieldKey: stableUuid(field.fieldKey),
    type,
    label: text(field.label, 200),
    helpText: text(field.helpText, 500),
    required: Boolean(field.required),
    options,
    validation: {
      minLength: numberOrNull(field.validation?.minLength),
      maxLength: numberOrNull(field.validation?.maxLength),
      min: numberOrNull(field.validation?.min),
      max: numberOrNull(field.validation?.max),
      decimalPlaces: numberOrNull(field.validation?.decimalPlaces),
      minDate: text(field.validation?.minDate, 32) || null,
      maxDate: text(field.validation?.maxDate, 32) || null,
      maxFiles: Math.min(5, Math.max(1, Number(field.validation?.maxFiles || 5)))
    }
  };
}

function normalizeSection(section = {}) {
  const kind = section.kind === 'detail' ? 'detail' : 'main';
  const requestedMaxRows = numberOrNull(section.maxRows) ?? DETAIL_ROW_LIMIT;
  const maxRows = kind === 'detail' ? Math.min(DETAIL_ROW_LIMIT, Math.max(1, Math.trunc(requestedMaxRows))) : null;
  const requestedMinRows = numberOrNull(section.minRows) ?? 1;
  const minRows = kind === 'detail' ? Math.min(maxRows, Math.max(0, Math.trunc(requestedMinRows))) : null;
  return {
    sectionKey: stableUuid(section.sectionKey),
    title: text(section.title, 100),
    description: text(section.description, 500),
    kind,
    minRows,
    maxRows,
    fields: (Array.isArray(section.fields) ? section.fields : []).map(normalizeField)
  };
}

function normalizeFormSchema(input = {}) {
  const sections = (Array.isArray(input.sections) ? input.sections : []).slice(0, SECTION_LIMIT).map(normalizeSection);
  return {
    schemaVersion: SCHEMA_VERSION,
    title: text(input.title, 100),
    description: text(input.description, 1000),
    sections
  };
}

function validateFormSchema(input, { publish = false } = {}) {
  const schema = normalizeFormSchema(input);
  const errors = [];
  if (!schema.title) errors.push({ path: 'title', message: '请填写表单名称' });
  if (schema.sections.length > SECTION_LIMIT) errors.push({ path: 'sections', message: `分区不能超过 ${SECTION_LIMIT} 个` });
  const keys = new Set();
  const sectionKeys = new Set();
  let fieldCount = 0;
  schema.sections.forEach((section, sectionIndex) => {
    if (!section.title) errors.push({ path: `sections.${sectionIndex}.title`, message: '请填写分区名称' });
    if (sectionKeys.has(section.sectionKey)) errors.push({ path: `sections.${sectionIndex}.sectionKey`, message: '分区标识重复' });
    sectionKeys.add(section.sectionKey);
    if (publish && section.kind === 'detail' && section.fields.length === 0) errors.push({ path: `sections.${sectionIndex}.fields`, message: `明细表“${section.title}”至少需要一个字段` });
    section.fields.forEach((field, fieldIndex) => {
      fieldCount += 1;
      const base = `sections.${sectionIndex}.fields.${fieldIndex}`;
      if (!field.label) errors.push({ path: `${base}.label`, message: '请填写字段名称' });
      if (section.kind === 'detail' && field.type === 'attachment') errors.push({ path: `${base}.type`, message: '附件字段只能放在主表中' });
      if (keys.has(field.fieldKey)) errors.push({ path: `${base}.fieldKey`, message: '字段标识重复' });
      keys.add(field.fieldKey);
      if (['single_choice', 'multiple_choice'].includes(field.type)) {
        if (field.options.length === 0) errors.push({ path: `${base}.options`, message: '选择字段至少需要一个选项' });
        const optionLabels = new Set();
        const optionKeys = new Set();
        field.options.forEach((option, optionIndex) => {
          if (!option.label) errors.push({ path: `${base}.options.${optionIndex}.label`, message: '请填写选项名称' });
          if (optionLabels.has(option.label)) errors.push({ path: `${base}.options.${optionIndex}.label`, message: '选项名称重复' });
          if (optionKeys.has(option.optionKey)) errors.push({ path: `${base}.options.${optionIndex}.optionKey`, message: '选项标识重复' });
          optionLabels.add(option.label);
          optionKeys.add(option.optionKey);
        });
      }
      const validation = field.validation;
      if (validation.minLength != null && validation.maxLength != null && validation.minLength > validation.maxLength) {
        errors.push({ path: `${base}.validation`, message: '最小长度不能大于最大长度' });
      }
      if (validation.min != null && validation.max != null && validation.min > validation.max) {
        errors.push({ path: `${base}.validation`, message: '最小值不能大于最大值' });
      }
    });
  });
  if (fieldCount > FIELD_LIMIT) errors.push({ path: 'sections', message: `字段不能超过 ${FIELD_LIMIT} 个` });
  if (publish && fieldCount === 0) errors.push({ path: 'sections', message: '发布前至少添加一个字段' });
  return { schema, errors };
}

function isEmpty(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function validateFieldValue(field, value, { base, submit, filesByField }, errors) {
  if (submit && field.required && isEmpty(value)) {
    errors.push({ path: base, message: `请填写“${field.label}”` });
    return;
  }
  if (isEmpty(value)) return;
  const validation = field.validation;
  if (['short_text', 'long_text'].includes(field.type)) {
    if (typeof value !== 'string') errors.push({ path: base, message: '内容必须是文本' });
    else {
      if (validation.minLength != null && value.length < validation.minLength) errors.push({ path: base, message: `内容不能少于 ${validation.minLength} 个字符` });
      if (validation.maxLength != null && value.length > validation.maxLength) errors.push({ path: base, message: `内容不能超过 ${validation.maxLength} 个字符` });
    }
  } else if (['integer', 'decimal'].includes(field.type)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) {
      errors.push({ path: base, message: field.type === 'integer' ? '请输入整数' : '请输入数字' });
    } else {
      if (validation.min != null && value < validation.min) errors.push({ path: base, message: `数值不能小于 ${validation.min}` });
      if (validation.max != null && value > validation.max) errors.push({ path: base, message: `数值不能大于 ${validation.max}` });
      if (field.type === 'decimal' && validation.decimalPlaces != null) {
        const decimals = String(value).split('.')[1]?.length || 0;
        if (decimals > validation.decimalPlaces) errors.push({ path: base, message: `小数位不能超过 ${validation.decimalPlaces} 位` });
      }
    }
  } else if (['date', 'datetime'].includes(field.type)) {
    const time = Date.parse(value);
    if (typeof value !== 'string' || Number.isNaN(time)) errors.push({ path: base, message: '日期格式不正确' });
    if (validation.minDate && String(value) < validation.minDate) errors.push({ path: base, message: `日期不能早于 ${validation.minDate}` });
    if (validation.maxDate && String(value) > validation.maxDate) errors.push({ path: base, message: `日期不能晚于 ${validation.maxDate}` });
  } else if (field.type === 'boolean') {
    if (typeof value !== 'boolean') errors.push({ path: base, message: '请选择是或否' });
  } else if (field.type === 'single_choice') {
    const allowed = new Set(field.options.map(option => option.optionKey));
    if (typeof value !== 'string' || !allowed.has(value)) errors.push({ path: base, message: '所选选项不存在' });
  } else if (field.type === 'multiple_choice') {
    const allowed = new Set(field.options.map(option => option.optionKey));
    if (!Array.isArray(value) || value.some(item => !allowed.has(item))) errors.push({ path: base, message: '多选内容包含无效选项' });
  } else if (field.type === 'person') {
    if (!value || !Number.isInteger(Number(value.personId)) || !text(value.personName, 255)) errors.push({ path: base, message: '人员信息不完整' });
  } else if (field.type === 'department') {
    if (!value || !Number.isInteger(Number(value.departmentId)) || !text(value.departmentName, 255)) errors.push({ path: base, message: '部门信息不完整' });
  } else if (field.type === 'attachment') {
    const fileIds = Array.isArray(value) ? value : [];
    const allowedFiles = new Set((filesByField[field.fieldKey] || []).map(file => file.file_id || file.fileId));
    if (!Array.isArray(value) || fileIds.some(fileId => !allowedFiles.has(fileId))) errors.push({ path: base, message: '附件引用无效' });
    if (fileIds.length > validation.maxFiles) errors.push({ path: base, message: `附件不能超过 ${validation.maxFiles} 个` });
  }
}

function validateAnswers(schemaInput, answersInput, options = {}) {
  const schema = normalizeFormSchema(schemaInput);
  const answers = answersInput && typeof answersInput === 'object' && !Array.isArray(answersInput) ? answersInput : {};
  const errors = [];
  const knownKeys = new Set();
  const submit = Boolean(options.submit);
  const filesByField = options.filesByField || {};
  for (const section of schema.sections) {
    if (section.kind === 'detail') {
      knownKeys.add('__detailRows');
      const detailRows = answers.__detailRows && typeof answers.__detailRows === 'object' && !Array.isArray(answers.__detailRows) ? answers.__detailRows : {};
      const rows = Array.isArray(detailRows[section.sectionKey]) ? detailRows[section.sectionKey] : [];
      if (submit && rows.length < section.minRows) errors.push({ path: `answers.__detailRows.${section.sectionKey}`, message: `明细表“${section.title}”至少需要 ${section.minRows} 行` });
      if (rows.length > section.maxRows) errors.push({ path: `answers.__detailRows.${section.sectionKey}`, message: `明细表“${section.title}”不能超过 ${section.maxRows} 行` });
      const rowKeys = new Set();
      rows.forEach((row, rowIndex) => {
        const rowBase = `answers.__detailRows.${section.sectionKey}.${rowIndex}`;
        if (!row || !uuid(row.rowKey)) errors.push({ path: `${rowBase}.rowKey`, message: '明细行标识不正确' });
        else if (rowKeys.has(row.rowKey)) errors.push({ path: `${rowBase}.rowKey`, message: '明细行标识重复' });
        else rowKeys.add(row.rowKey);
        const values = row?.values && typeof row.values === 'object' && !Array.isArray(row.values) ? row.values : {};
        const fieldKeys = new Set(section.fields.map(field => field.fieldKey));
        for (const key of Object.keys(values)) if (!fieldKeys.has(key)) errors.push({ path: `${rowBase}.values.${key}`, message: '明细行包含当前明细表不存在的字段' });
        for (const field of section.fields) validateFieldValue(field, values[field.fieldKey], { base: `${rowBase}.values.${field.fieldKey}`, submit, filesByField: {} }, errors);
      });
      continue;
    }
    for (const field of section.fields) {
      knownKeys.add(field.fieldKey);
      const value = answers[field.fieldKey];
      const base = `answers.${field.fieldKey}`;
      validateFieldValue(field, value, { base, submit, filesByField }, errors);
    }
  }
  const detailSections = new Set(schema.sections.filter(section => section.kind === 'detail').map(section => section.sectionKey));
  const detailRows = answers.__detailRows;
  if (detailRows != null && (!detailRows || typeof detailRows !== 'object' || Array.isArray(detailRows))) errors.push({ path: 'answers.__detailRows', message: '明细表答案结构不正确' });
  else if (detailRows) for (const sectionKey of Object.keys(detailRows)) if (!detailSections.has(sectionKey)) errors.push({ path: `answers.__detailRows.${sectionKey}`, message: '答卷包含当前表单不存在的明细表' });
  for (const key of Object.keys(answers)) {
    if (!knownKeys.has(key)) errors.push({ path: `answers.${key}`, message: '答卷包含当前表单不存在的字段' });
  }
  return { answers, errors };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestSchema(schema) {
  return crypto.createHash('sha256').update(canonicalJson(schema)).digest('hex');
}

module.exports = {
  FIELD_LIMIT,
  FIELD_TYPES,
  DETAIL_ROW_LIMIT,
  OPTION_LIMIT,
  SCHEMA_VERSION,
  SECTION_LIMIT,
  digestSchema,
  normalizeFormSchema,
  validateAnswers,
  validateFormSchema
};
