(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GraphEditorState = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createGraphEditorStateApi() {
  'use strict';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
      if (key === 'exported_at') return result;
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }

  function fingerprint(documentValue) {
    return JSON.stringify(canonicalize(documentValue));
  }

  function defaultViewState() {
    return {
      mode: 'flow',
      selection: null,
      flow: { zoom: null, pan: null },
      data: { zoom: null, pan: null, dataRef: '' }
    };
  }

  function createManager(options = {}) {
    const limit = Math.max(1, Number(options.limit) || 20);
    const entries = new Map();

    function ensure(key) {
      if (!entries.has(key)) {
        entries.set(key, {
          undo: [],
          redo: [],
          baseline: '',
          view: defaultViewState()
        });
      }
      return entries.get(key);
    }

    function register(key, documentValue, registerOptions = {}) {
      const entry = ensure(key);
      if (registerOptions.resetHistory !== false) {
        entry.undo = [];
        entry.redo = [];
      }
      entry.baseline = fingerprint(documentValue);
      entry.view = registerOptions.keepView ? entry.view : defaultViewState();
      return snapshot(key, documentValue);
    }

    function execute(key, documentValue, command) {
      const entry = ensure(key);
      const result = command(clone(documentValue));
      if (!result?.ok || !result.document) return result;
      entry.undo.push({ before: clone(documentValue), after: clone(result.document), details: clone(result.details || {}) });
      if (entry.undo.length > limit) entry.undo.splice(0, entry.undo.length - limit);
      entry.redo = [];
      return { ...result, state: snapshot(key, result.document) };
    }

    function undo(key, currentDocument) {
      const entry = ensure(key);
      const operation = entry.undo[entry.undo.length - 1];
      if (!operation) return { ok: false, code: 'UNDO_EMPTY', message: '没有可撤销的图操作' };
      if (fingerprint(currentDocument) !== fingerprint(operation.after)) {
        return {
          ok: false,
          code: 'UNDO_SOURCE_CHANGED',
          message: '该操作之后当前JSON还有其他修改。为避免覆盖这些内容，系统没有执行撤销'
        };
      }
      entry.undo.pop();
      entry.redo.push(operation);
      return { ok: true, document: clone(operation.before), details: clone(operation.details), state: snapshot(key, operation.before) };
    }

    function redo(key, currentDocument) {
      const entry = ensure(key);
      const operation = entry.redo[entry.redo.length - 1];
      if (!operation) return { ok: false, code: 'REDO_EMPTY', message: '没有可重做的图操作' };
      if (fingerprint(currentDocument) !== fingerprint(operation.before)) {
        return {
          ok: false,
          code: 'REDO_SOURCE_CHANGED',
          message: '撤销后当前JSON已有其他修改。为避免覆盖这些内容，系统没有执行重做'
        };
      }
      entry.redo.pop();
      entry.undo.push(operation);
      return { ok: true, document: clone(operation.after), details: clone(operation.details), state: snapshot(key, operation.after) };
    }

    function markBaseline(key, documentValue) {
      ensure(key).baseline = fingerprint(documentValue);
      return snapshot(key, documentValue);
    }

    function isDirty(key, documentValue) {
      const entry = ensure(key);
      return entry.baseline !== fingerprint(documentValue);
    }

    function updateView(key, patch) {
      const entry = ensure(key);
      entry.view = {
        ...entry.view,
        ...clone(patch || {}),
        flow: { ...entry.view.flow, ...(patch?.flow || {}) },
        data: { ...entry.view.data, ...(patch?.data || {}) }
      };
      return clone(entry.view);
    }

    function view(key) {
      return clone(ensure(key).view);
    }

    function resetView(key, mode) {
      const entry = ensure(key);
      if (mode === 'data') entry.view.data = defaultViewState().data;
      else entry.view.flow = defaultViewState().flow;
      return clone(entry.view);
    }

    function snapshot(key, documentValue) {
      const entry = ensure(key);
      return {
        canUndo: entry.undo.length > 0,
        canRedo: entry.redo.length > 0,
        undoCount: entry.undo.length,
        redoCount: entry.redo.length,
        dirty: documentValue ? isDirty(key, documentValue) : false,
        view: clone(entry.view)
      };
    }

    function clear(key) {
      if (key == null) entries.clear();
      else entries.delete(key);
    }

    return { register, execute, undo, redo, markBaseline, isDirty, updateView, view, resetView, snapshot, clear };
  }

  return { clone, fingerprint, defaultViewState, createManager };
}));
