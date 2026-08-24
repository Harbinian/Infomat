(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NativeWebGrid = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COMPOSITION_END_GRACE_MS = 80;

  function isCompositionKey(event, compositionActive, compositionEndedAt = 0, currentTime = Date.now()) {
    const elapsed = Number(currentTime) - Number(compositionEndedAt);
    const justEnded = event?.key === 'Enter'
      && Number(compositionEndedAt) > 0
      && elapsed >= 0
      && elapsed <= COMPOSITION_END_GRACE_MS;
    return Boolean(compositionActive || event?.isComposing || event?.keyCode === 229 || justEnded);
  }

  function parseClipboardGrid(text) {
    const rows = [[]];
    let value = '';
    let quoted = false;
    const source = String(text == null ? '' : text);
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') {
          value += '"';
          index += 1;
        } else quoted = !quoted;
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
    if (rows.length > 1 && rows.at(-1).length === 1 && rows.at(-1)[0] === '') rows.pop();
    return rows;
  }

  function normalizePastedValue(column, rawValue, options = []) {
    const raw = String(rawValue == null ? '' : rawValue);
    const trimmed = raw.trim();
    if (column?.editor === 'boolean') {
      if (!trimmed) return { value: false };
      const normalized = trimmed.toLowerCase();
      if (['是', 'true', '1', 'yes'].includes(normalized)) return { value: true };
      if (['否', 'false', '0', 'no'].includes(normalized)) return { value: false };
      return { error: '只能填写“是”或“否”' };
    }
    if (column?.editor === 'select' || column?.editor === 'lookup') {
      if (!trimmed) return { value: column.nullable ? null : '' };
      const matches = options.filter(option => String(option.value) === trimmed || String(option.label) === trimmed);
      if (matches.length === 1) return { value: matches[0].value };
      if (matches.length > 1) return { error: `“${trimmed}”对应多个选项，请使用技术标识` };
      return { error: `没有选项“${trimmed}”` };
    }
    if (column?.editor === 'update-fields') {
      return { error: '更新字段必须使用弹窗多选，不能直接粘贴' };
    }
    return { value: raw };
  }

  function planPaste({ matrix, columns, startColumn, optionResolver = () => [] }) {
    const rows = Array.isArray(matrix) ? matrix : [];
    const width = Math.max(0, ...rows.map(row => row.length));
    if (!rows.length || !width) return { errors: [{ message: '剪贴板中没有可粘贴的数据' }] };
    if (Number(startColumn) + width > columns.length) {
      return { errors: [{ message: `粘贴区域有${width}列，但起始单元格右侧只剩${columns.length - Number(startColumn)}列` }] };
    }
    const errors = [];
    const values = rows.map((sourceRow, rowOffset) => Array.from({ length: width }, (_, columnOffset) => {
      const column = columns[Number(startColumn) + columnOffset];
      const result = normalizePastedValue(column, sourceRow[columnOffset] ?? '', optionResolver(column, rowOffset));
      if (result.error) errors.push({
        row: rowOffset + 1,
        column: columnOffset + 1,
        fieldLabel: column.label,
        message: result.error
      });
      return result.value;
    }));
    return errors.length ? { errors } : { values, width, height: rows.length };
  }

  function rangeBounds(anchor, current) {
    const rowStart = Math.min(Number(anchor?.rowIndex) || 0, Number(current?.rowIndex) || 0);
    const rowEnd = Math.max(Number(anchor?.rowIndex) || 0, Number(current?.rowIndex) || 0);
    const columnStart = Math.min(Number(anchor?.columnIndex) || 0, Number(current?.columnIndex) || 0);
    const columnEnd = Math.max(Number(anchor?.columnIndex) || 0, Number(current?.columnIndex) || 0);
    return { rowStart, rowEnd, columnStart, columnEnd };
  }

  function clipboardCell(value) {
    const raw = value == null ? '' : String(value);
    if (!/[\t\r\n"]/.test(raw)) return raw;
    return `"${raw.replace(/"/g, '""')}"`;
  }

  function toClipboardText(matrix) {
    return (matrix || []).map(row => (row || []).map(clipboardCell).join('\t')).join('\r\n');
  }

  return Object.freeze({
    isCompositionKey,
    parseClipboardGrid,
    normalizePastedValue,
    planPaste,
    rangeBounds,
    toClipboardText
  });
}));
