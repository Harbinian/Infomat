(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WebGridCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function issue(code, message, extra = {}) {
    return {
      tableId: extra.tableId || '',
      rowId: extra.rowId || '',
      column: extra.column || '',
      severity: extra.severity || 'error',
      code,
      message,
      focusPath: extra.focusPath || ''
    };
  }

  function assertAdapter(adapter) {
    ['definitions', 'read', 'createRow', 'prepare'].forEach(method => {
      if (typeof adapter?.[method] !== 'function') {
        throw new Error(`表格适配层缺少${method}方法`);
      }
    });
  }

  /**
   * @typedef {Object} GridTableDefinition
   * @property {string} id Stable table identifier.
   * @property {string} label User-facing table label.
   * @property {Array<Object>} columns Column definitions independent from a grid library.
   * @property {string=} parentTableId Optional parent table identifier.
   * @property {string=} parentKey Optional foreign-key column used for filtering.
   */

  /**
   * @typedef {Object} GridIssue
   * @property {string} tableId
   * @property {string} rowId
   * @property {string} column
   * @property {'error'|'warning'} severity
   * @property {string} code
   * @property {string} message
   * @property {string} focusPath
   */

  /**
   * @typedef {Object} GridCommitDriver
   * @property {Function} getSource Returns {document, revisionKey}.
   * @property {Function} validate Validates a complete candidate document.
   * @property {Function} commit Commits one complete candidate document.
   */

  function createSession({ adapter, documentValue, sourceKey, adapterOptions = {} }) {
    assertAdapter(adapter);
    const definitions = clone(adapter.definitions(documentValue, adapterOptions));
    const definitionById = new Map(definitions.map(item => [item.id, item]));
    let tables = clone(adapter.read(documentValue, adapterOptions));
    let baseline = clone(tables);
    let revision = 0;

    definitions.forEach(definition => {
      if (!Array.isArray(tables[definition.id])) tables[definition.id] = [];
    });

    function requireTable(tableId) {
      if (!definitionById.has(tableId)) throw new Error(`未知表格：${tableId}`);
      return tables[tableId];
    }

    function isDirty() {
      return JSON.stringify(tables) !== JSON.stringify(baseline);
    }

    function isTableDirty(tableId) {
      requireTable(tableId);
      return JSON.stringify(tables[tableId]) !== JSON.stringify(baseline[tableId]);
    }

    function replaceRows(tableId, rows) {
      requireTable(tableId);
      tables[tableId] = clone(Array.isArray(rows) ? rows : []);
      revision += 1;
      return rowsFor(tableId);
    }

    function updateCell(tableId, rowId, column, value) {
      const table = requireTable(tableId);
      const row = table.find(item => item._row_id === rowId);
      if (!row) throw new Error('没有找到需要修改的表格行');
      if (!definitionById.get(tableId).columns.some(item => item.key === column && !item.readOnly)) {
        throw new Error('该表格字段不允许修改');
      }
      row[column] = clone(value);
      revision += 1;
      return clone(row);
    }

    function rowsFor(tableId, options = {}) {
      const rows = requireTable(tableId);
      return clone(options.includeDeleted === false ? rows.filter(row => !row._deleted) : rows);
    }

    function addRow(tableId, context = {}) {
      const table = requireTable(tableId);
      const row = adapter.createRow(tableId, {
        ...context,
        rows: clone(table),
        allTables: clone(tables),
        adapterOptions
      });
      if (!row || !row._row_id) throw new Error(`表格${tableId}没有生成稳定行标识`);
      table.push(clone(row));
      revision += 1;
      return clone(row);
    }

    function duplicateRow(tableId, rowId, context = {}) {
      const table = requireTable(tableId);
      const sourceRow = table.find(row => row._row_id === rowId && !row._deleted);
      if (!sourceRow) throw new Error('没有找到需要复制的表格行');
      return addRow(tableId, { ...context, sourceRow: clone(sourceRow), duplicate: true });
    }

    function setDeleted(tableId, rowId, deleted) {
      const table = requireTable(tableId);
      const row = table.find(item => item._row_id === rowId);
      if (!row) throw new Error('没有找到需要处理的表格行');
      if (!row._existing && deleted) {
        tables[tableId] = table.filter(item => item._row_id !== rowId);
        revision += 1;
        return null;
      }
      row._deleted = Boolean(deleted);
      revision += 1;
      return clone(row);
    }

    function moveRow(tableId, rowId, direction) {
      const table = requireTable(tableId);
      const definition = definitionById.get(tableId);
      const selected = table.find(row => row._row_id === rowId && !row._deleted);
      if (!selected) return false;
      const ordered = table
        .filter(row => !row._deleted && (!definition.parentKey || row[definition.parentKey] === selected[definition.parentKey]))
        .sort((left, right) => Number(left._order || 0) - Number(right._order || 0));
      const index = ordered.findIndex(row => row._row_id === rowId);
      const target = index + Number(direction || 0);
      if (index < 0 || target < 0 || target >= ordered.length) return false;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      ordered.forEach((row, rowIndex) => { row._order = rowIndex; });
      revision += 1;
      return true;
    }

    function prepare(currentDocument, currentKey, options = {}) {
      if (currentKey !== sourceKey) {
        return {
          ok: false,
          document: clone(currentDocument),
          errors: [issue('SOURCE_CHANGED', '当前流程在表格打开后发生过修改。请放弃表格工作副本并重新进入表格编辑。')],
          warnings: [],
          diff: [],
          summary: { added: 0, updated: 0, deleted: 0, unchanged: 0 }
        };
      }
      return adapter.prepare(currentDocument, clone(tables), {
        ...adapterOptions,
        ...options
      });
    }

    function accept(documentValue, nextSourceKey) {
      tables = clone(adapter.read(documentValue, adapterOptions));
      baseline = clone(tables);
      sourceKey = nextSourceKey;
      revision += 1;
    }

    return Object.freeze({
      definitions: () => clone(definitions),
      definition: tableId => clone(definitionById.get(tableId) || null),
      rows: rowsFor,
      allRows: () => clone(tables),
      replaceRows,
      updateCell,
      addRow,
      duplicateRow,
      setDeleted,
      moveRow,
      isDirty,
      isTableDirty,
      revision: () => revision,
      sourceKey: () => sourceKey,
      prepare,
      accept
    });
  }

  return Object.freeze({ clone, issue, createSession });
}));
