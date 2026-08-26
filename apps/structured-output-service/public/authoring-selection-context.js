(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AuthoringSelectionContext = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createAuthoringSelectionContextApi() {
  'use strict';

  const TABLE_WORKSPACES = Object.freeze({
    data_objects: 'data',
    data_fields: 'data',
    data_behavior_links: 'data',
    data_source_relations: 'data',
    forms: 'forms',
    form_behavior_links: 'forms',
    form_areas: 'forms',
    form_items: 'forms',
    field_source_links: 'forms'
  });

  const DEFAULT_TABLES = Object.freeze({ data: 'data_objects', forms: 'forms' });
  const MODES = new Set(['guided', 'grid']);
  const WORKSPACES = new Set(['data', 'forms']);
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).reduce((result, key) => {
      result[key] = clone(value[key]);
      return result;
    }, {});
  }

  function ref(value) {
    return value == null ? '' : String(value).trim();
  }

  function activeRows(value) {
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !item._deleted) : [];
  }

  function setFirst(map, key, value) {
    const normalizedKey = ref(key);
    if (normalizedKey && !map.has(normalizedKey)) map.set(normalizedKey, value);
  }

  function buildReferenceIndex(source = {}) {
    if (source && source.__authoringSelectionReferenceIndex === true) return source;

    const dataObjects = new Map();
    const dataFields = new Map();
    const forms = new Map();
    const areas = new Map();
    const items = new Map();

    activeRows(source.data_objects).forEach(dataObject => {
      const dataRef = ref(dataObject.data_ref);
      if (!dataRef) return;
      setFirst(dataObjects, dataRef, { dataRef });
      activeRows(dataObject.fields).forEach(field => {
        const fieldRef = ref(field.field_ref);
        if (fieldRef) setFirst(dataFields, fieldRef, { fieldRef, dataRef });
      });
    });

    activeRows(source.data_fields).forEach(field => {
      const fieldRef = ref(field.field_ref);
      const dataRef = ref(field.data_ref);
      if (fieldRef && dataObjects.has(dataRef)) setFirst(dataFields, fieldRef, { fieldRef, dataRef });
    });

    activeRows(source.forms).forEach(form => {
      const formRef = ref(form.form_ref);
      if (!formRef) return;
      setFirst(forms, formRef, { formRef });
      activeRows(form.areas).forEach(area => {
        const areaRef = ref(area.area_ref);
        if (!areaRef) return;
        setFirst(areas, areaRef, { areaRef, formRef });
        activeRows(area.items).forEach(item => {
          const itemRef = ref(item.item_ref);
          if (itemRef) setFirst(items, itemRef, { itemRef, areaRef, formRef });
        });
      });
    });

    activeRows(source.form_areas).forEach(area => {
      const areaRef = ref(area.area_ref);
      const formRef = ref(area.form_ref);
      if (areaRef && forms.has(formRef)) setFirst(areas, areaRef, { areaRef, formRef });
    });

    activeRows(source.form_items).forEach(item => {
      const itemRef = ref(item.item_ref);
      const areaRef = ref(item.area_ref);
      const area = areas.get(areaRef);
      if (itemRef && area) setFirst(items, itemRef, { itemRef, areaRef, formRef: area.formRef });
    });

    return Object.freeze({
      __authoringSelectionReferenceIndex: true,
      dataObjects,
      dataFields,
      forms,
      areas,
      items
    });
  }

  function defaultState() {
    return {
      mode: 'guided',
      workspace: 'data',
      tableId: DEFAULT_TABLES.data,
      dataRef: '',
      dataFieldRef: '',
      formRef: '',
      areaRef: '',
      formItemRef: '',
      tableViews: {}
    };
  }

  function normalizedTableViews(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.keys(value).reduce((result, tableId) => {
      if (!hasOwn(TABLE_WORKSPACES, tableId)) return result;
      const tableView = value[tableId];
      if (tableView && typeof tableView === 'object' && !Array.isArray(tableView)) {
        result[tableId] = clone(tableView);
      }
      return result;
    }, {});
  }

  function normalizeSelection(selection = {}, source = {}) {
    const index = buildReferenceIndex(source);
    const initial = defaultState();
    const mode = MODES.has(selection.mode) ? selection.mode : initial.mode;
    let workspace = WORKSPACES.has(selection.workspace) ? selection.workspace : initial.workspace;
    let tableId = ref(selection.tableId);
    if (hasOwn(TABLE_WORKSPACES, tableId)) workspace = TABLE_WORKSPACES[tableId];
    else tableId = DEFAULT_TABLES[workspace];

    let dataRef = ref(selection.dataRef);
    let dataFieldRef = ref(selection.dataFieldRef);
    const selectedField = index.dataFields.get(dataFieldRef);
    if (selectedField) dataRef = selectedField.dataRef;
    else dataFieldRef = '';
    if (!index.dataObjects.has(dataRef)) {
      dataRef = '';
      dataFieldRef = '';
    }

    let formRef = ref(selection.formRef);
    let areaRef = ref(selection.areaRef);
    let formItemRef = ref(selection.formItemRef);
    const selectedItem = index.items.get(formItemRef);
    if (selectedItem) {
      areaRef = selectedItem.areaRef;
      formRef = selectedItem.formRef;
    } else {
      formItemRef = '';
      const selectedArea = index.areas.get(areaRef);
      if (selectedArea) formRef = selectedArea.formRef;
      else areaRef = '';
    }
    if (!index.forms.has(formRef)) {
      formRef = '';
      areaRef = '';
      formItemRef = '';
    }

    return {
      mode,
      workspace,
      tableId,
      dataRef,
      dataFieldRef,
      formRef,
      areaRef,
      formItemRef,
      tableViews: normalizedTableViews(selection.tableViews)
    };
  }

  function candidateId(candidateKey) {
    const value = ref(candidateKey);
    if (!value) throw new TypeError('AuthoringSelectionContext candidateKey is required');
    return value;
  }

  function preparePatch(current, patch = {}) {
    const next = { ...current, ...clone(patch) };

    if (hasOwn(patch, 'workspace') && !hasOwn(patch, 'tableId') && patch.workspace !== current.workspace) {
      const workspace = WORKSPACES.has(patch.workspace) ? patch.workspace : current.workspace;
      next.tableId = DEFAULT_TABLES[workspace];
    }
    if (hasOwn(patch, 'tableId') && hasOwn(TABLE_WORKSPACES, ref(patch.tableId))) {
      next.workspace = TABLE_WORKSPACES[ref(patch.tableId)];
    }

    if (hasOwn(patch, 'dataRef') && !hasOwn(patch, 'dataFieldRef') && ref(patch.dataRef) !== current.dataRef) {
      next.dataFieldRef = '';
    }
    if (hasOwn(patch, 'dataFieldRef') && ref(patch.dataFieldRef)) next.dataRef = '';

    if (hasOwn(patch, 'formRef')
      && !hasOwn(patch, 'areaRef')
      && !hasOwn(patch, 'formItemRef')
      && ref(patch.formRef) !== current.formRef) {
      next.areaRef = '';
      next.formItemRef = '';
    }
    if (hasOwn(patch, 'areaRef') && !hasOwn(patch, 'formItemRef')) {
      if (ref(patch.areaRef) !== current.areaRef) next.formItemRef = '';
      if (ref(patch.areaRef)) next.formRef = '';
    }
    if (hasOwn(patch, 'formItemRef') && ref(patch.formItemRef)) {
      next.formRef = '';
      next.areaRef = '';
    }

    return next;
  }

  function createManager() {
    const entries = new Map();

    function current(candidateKey) {
      const key = candidateId(candidateKey);
      return entries.has(key) ? entries.get(key) : defaultState();
    }

    function get(candidateKey) {
      return clone(current(candidateKey));
    }

    function update(candidateKey, patch = {}, source = {}) {
      const key = candidateId(candidateKey);
      const next = normalizeSelection(preparePatch(current(key), patch), source);
      entries.set(key, next);
      return clone(next);
    }

    function reconcile(candidateKey, source = {}) {
      const key = candidateId(candidateKey);
      const next = normalizeSelection(current(key), source);
      entries.set(key, next);
      return clone(next);
    }

    function setTableView(candidateKey, tableId, patch = {}) {
      const key = candidateId(candidateKey);
      const normalizedTableId = ref(tableId);
      if (!hasOwn(TABLE_WORKSPACES, normalizedTableId)) {
        throw new TypeError(`Unknown authoring table: ${normalizedTableId || '(empty)'}`);
      }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new TypeError('Authoring table view patch must be an object');
      }
      const state = current(key);
      const next = {
        ...state,
        tableViews: {
          ...state.tableViews,
          [normalizedTableId]: {
            ...(state.tableViews[normalizedTableId] || {}),
            ...clone(patch)
          }
        }
      };
      entries.set(key, next);
      return clone(next.tableViews[normalizedTableId]);
    }

    function clear(candidateKey) {
      if (candidateKey == null) entries.clear();
      else entries.delete(candidateId(candidateKey));
    }

    return Object.freeze({ get, update, reconcile, setTableView, clear });
  }

  return Object.freeze({
    TABLE_WORKSPACES,
    DEFAULT_TABLES,
    clone,
    buildReferenceIndex,
    defaultState,
    normalizeSelection,
    createManager
  });
}));
