'use strict';

(function exposeDetailGrid(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DetailGrid = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDetailGrid() {
  function parseClipboardGrid(text) {
    const rows = [[]];
    let value = '';
    let quoted = false;
    const source = String(text == null ? '' : text);
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') { value += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === '\t' && !quoted) {
        rows[rows.length - 1].push(value);
        value = '';
      } else if ((char === '\r' || char === '\n') && !quoted) {
        rows[rows.length - 1].push(value);
        value = '';
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        rows.push([]);
      } else value += char;
    }
    rows[rows.length - 1].push(value);
    if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
    return rows;
  }

  function dateParts(raw) {
    const match = String(raw).trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const value = new Date(Date.UTC(year, month - 1, day));
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
    return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function convertPastedValue(field, rawValue, directory = {}) {
    const raw = String(rawValue == null ? '' : rawValue);
    const trimmed = raw.trim();
    if (!trimmed) return { value: field.type === 'multiple_choice' ? [] : '' };
    if (field.type === 'short_text' || field.type === 'long_text') return { value: raw };
    if (field.type === 'integer') {
      if (!/^[+-]?\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) return { error: '需要填写整数' };
      return { value: Number(trimmed) };
    }
    if (field.type === 'decimal') {
      const value = Number(trimmed);
      if (!Number.isFinite(value)) return { error: '需要填写数值' };
      return { value };
    }
    if (field.type === 'date') {
      const value = dateParts(trimmed);
      return value ? { value } : { error: '日期格式应为 YYYY-MM-DD、YYYY/MM/DD 或 YYYY.M.D' };
    }
    if (field.type === 'datetime') {
      const match = trimmed.match(/^(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?)[ T](\d{1,2}):(\d{2})(?::\d{2})?$/);
      const date = match && dateParts(match[1]);
      const hour = match ? Number(match[2]) : -1;
      const minute = match ? Number(match[3]) : -1;
      if (!date || hour > 23 || minute > 59) return { error: '日期时间格式应为 YYYY-MM-DD HH:mm' };
      return { value: `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
    }
    if (field.type === 'boolean') {
      const normalized = trimmed.toLowerCase();
      if (['是', 'true', '1', 'yes'].includes(normalized)) return { value: true };
      if (['否', 'false', '0', 'no'].includes(normalized)) return { value: false };
      return { error: '只能填写“是”或“否”' };
    }
    if (field.type === 'single_choice') {
      const option = (field.options || []).find(item => item.optionKey === trimmed || item.label === trimmed);
      return option ? { value: option.optionKey } : { error: `没有选项“${trimmed}”` };
    }
    if (field.type === 'multiple_choice') {
      const labels = trimmed.split(/[、，,;；\n]/).map(item => item.trim()).filter(Boolean);
      const values = [];
      for (const label of labels) {
        const option = (field.options || []).find(item => item.optionKey === label || item.label === label);
        if (!option) return { error: `没有选项“${label}”` };
        if (!values.includes(option.optionKey)) values.push(option.optionKey);
      }
      return { value: values };
    }
    if (field.type === 'person') {
      const matches = (directory.people || []).filter(item => String(item.employeeNo) === trimmed || item.personName === trimmed);
      if (matches.length !== 1) return { error: matches.length ? `姓名“${trimmed}”对应多个人员，请粘贴工号` : `找不到人员“${trimmed}”` };
      const person = matches[0];
      return { value: { personId: person.personId, employeeNo: person.employeeNo, personName: person.personName } };
    }
    if (field.type === 'department') {
      const matches = (directory.departments || []).filter(item => item.name === trimmed || String(item.departmentId) === trimmed);
      if (matches.length !== 1) return { error: `找不到部门“${trimmed}”` };
      return { value: { departmentId: matches[0].departmentId, departmentName: matches[0].name } };
    }
    return { error: '该字段不支持从 Excel 粘贴' };
  }

  function validatePastedValue(field, value) {
    if (value === '' || value == null || (Array.isArray(value) && value.length === 0)) return null;
    const validation = field.validation || {};
    if (['short_text', 'long_text'].includes(field.type)) {
      if (validation.minLength != null && value.length < validation.minLength) return `内容不能少于 ${validation.minLength} 个字符`;
      if (validation.maxLength != null && value.length > validation.maxLength) return `内容不能超过 ${validation.maxLength} 个字符`;
    }
    if (['integer', 'decimal'].includes(field.type)) {
      if (validation.min != null && value < validation.min) return `数值不能小于 ${validation.min}`;
      if (validation.max != null && value > validation.max) return `数值不能大于 ${validation.max}`;
      if (field.type === 'decimal' && validation.decimalPlaces != null && (String(value).split('.')[1]?.length || 0) > validation.decimalPlaces) return `小数位不能超过 ${validation.decimalPlaces} 位`;
    }
    if (['date', 'datetime'].includes(field.type)) {
      if (validation.minDate && String(value) < validation.minDate) return `日期不能早于 ${validation.minDate}`;
      if (validation.maxDate && String(value) > validation.maxDate) return `日期不能晚于 ${validation.maxDate}`;
    }
    return null;
  }

  function applyPastedGrid({ section, rows, startRow, startColumn, matrix, directory, createRowKey }) {
    const width = Math.max(0, ...matrix.map(row => row.length));
    const errors = [];
    if (!matrix.length || !width) return { errors: [{ message: '剪贴板中没有可粘贴的数据' }] };
    if (startColumn + width > section.fields.length) errors.push({ message: `粘贴区域有 ${width} 列，但起始单元格右侧只剩 ${section.fields.length - startColumn} 列` });
    if (startRow + matrix.length > Number(section.maxRows || 100)) errors.push({ message: `粘贴后将超过明细表最多 ${section.maxRows || 100} 行` });
    if (errors.length) return { errors };

    const converted = matrix.map((sourceRow, rowOffset) => Array.from({ length: width }, (_, columnOffset) => {
      const raw = sourceRow[columnOffset] ?? '';
      const field = section.fields[startColumn + columnOffset];
      const result = convertPastedValue(field, raw, directory);
      const constraintError = !result.error && validatePastedValue(field, result.value);
      if (result.error || constraintError) errors.push({ row: rowOffset + 1, column: columnOffset + 1, fieldLabel: field.label, message: result.error || constraintError });
      return result.value;
    }));
    if (errors.length) return { errors };

    const nextRows = structuredClone(rows);
    while (nextRows.length < startRow + matrix.length) nextRows.push({ rowKey: createRowKey(), values: {} });
    converted.forEach((sourceRow, rowOffset) => {
      sourceRow.forEach((value, columnOffset) => {
        nextRows[startRow + rowOffset].values[section.fields[startColumn + columnOffset].fieldKey] = value;
      });
    });
    return { rows: nextRows, pastedRows: matrix.length, pastedColumns: width };
  }

  return { applyPastedGrid, convertPastedValue, parseClipboardGrid, validatePastedValue };
});
