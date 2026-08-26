const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AuthoringSelectionContext = require('../public/authoring-selection-context.js');

const modulePath = path.join(__dirname, '../public/authoring-selection-context.js');
const moduleSource = fs.readFileSync(modulePath, 'utf8');
const browserContext = {};
vm.runInNewContext(moduleSource, browserContext);
assert.equal(
  typeof browserContext.AuthoringSelectionContext?.createManager,
  'function',
  'the UMD module must expose its browser API'
);
assert.doesNotMatch(
  moduleSource,
  /localStorage|sessionStorage|indexedDB|document\.cookie/,
  'selection context must remain page-memory-only'
);

function fixture() {
  return {
    data_objects: [
      {
        data_ref: 'data-a',
        fields: [
          { field_ref: 'field-a1' },
          { field_ref: 'field-a2' }
        ]
      },
      {
        data_ref: 'data-b',
        fields: [{ field_ref: 'field-b1' }]
      }
    ],
    forms: [
      {
        form_ref: 'form-a',
        areas: [
          {
            area_ref: 'area-a1',
            items: [{ item_ref: 'item-a1' }, { item_ref: 'item-a2' }]
          }
        ]
      },
      {
        form_ref: 'form-b',
        areas: [
          {
            area_ref: 'area-b1',
            items: [{ item_ref: 'item-b1' }]
          },
          {
            area_ref: 'area-b2',
            items: [{ item_ref: 'item-b2' }]
          }
        ]
      }
    ]
  };
}

{
  const documentValue = fixture();
  const before = JSON.parse(JSON.stringify(documentValue));
  const state = AuthoringSelectionContext.normalizeSelection({
    mode: 'grid',
    tableId: 'form_items',
    dataFieldRef: 'field-b1',
    formItemRef: 'item-b2'
  }, documentValue);
  assert.equal(state.mode, 'grid');
  assert.equal(state.workspace, 'forms', 'the active table determines its workspace');
  assert.equal(state.dataRef, 'data-b', 'a stable field ref must resolve its real owner');
  assert.equal(state.dataFieldRef, 'field-b1');
  assert.equal(state.formRef, 'form-b', 'a stable item ref must resolve its real form');
  assert.equal(state.areaRef, 'area-b2', 'a stable item ref must resolve its real area');
  assert.equal(state.formItemRef, 'item-b2');
  assert.deepEqual(documentValue, before, 'normalization must not mutate the source document');
}

{
  const documentValue = fixture();
  const manager = AuthoringSelectionContext.createManager();
  manager.update('candidate-a', {
    dataFieldRef: 'field-a2',
    formItemRef: 'item-a2',
    workspace: 'forms',
    tableId: 'form_items'
  }, documentValue);
  manager.update('candidate-b', {
    dataFieldRef: 'field-b1',
    formItemRef: 'item-b1'
  }, documentValue);

  assert.equal(manager.get('candidate-a').dataRef, 'data-a');
  assert.equal(manager.get('candidate-a').formItemRef, 'item-a2');
  assert.equal(manager.get('candidate-b').dataRef, 'data-b');
  assert.equal(manager.get('candidate-b').formItemRef, 'item-b1');

  manager.update('candidate-a', { dataRef: 'data-b' }, documentValue);
  assert.equal(manager.get('candidate-a').dataRef, 'data-b');
  assert.equal(manager.get('candidate-a').dataFieldRef, '', 'choosing another parent must clear the old child');
  assert.equal(manager.get('candidate-b').dataFieldRef, 'field-b1', 'candidate state must be isolated');

  manager.update('candidate-a', { areaRef: 'area-b1' }, documentValue);
  assert.equal(manager.get('candidate-a').formRef, 'form-b');
  assert.equal(manager.get('candidate-a').areaRef, 'area-b1');
  assert.equal(manager.get('candidate-a').formItemRef, '', 'choosing another area must clear the old item');

  manager.update('candidate-a', { formItemRef: 'item-b1' }, documentValue);
  manager.update('candidate-a', { formRef: 'form-b' }, documentValue);
  assert.equal(manager.get('candidate-a').formItemRef, 'item-b1', 'reselecting the same parent must preserve its child');
  manager.update('candidate-a', { areaRef: '' }, documentValue);
  assert.equal(manager.get('candidate-a').formRef, 'form-b', 'clearing an area must retain its valid form');
  assert.equal(manager.get('candidate-a').areaRef, '');
  assert.equal(manager.get('candidate-a').formItemRef, '');
}

{
  const manager = AuthoringSelectionContext.createManager();
  const documentValue = fixture();
  manager.update('candidate-a', {
    dataFieldRef: 'field-b1',
    formItemRef: 'item-b2'
  }, documentValue);

  const withoutItem = fixture();
  withoutItem.forms[1].areas[1].items = [];
  let state = manager.reconcile('candidate-a', withoutItem);
  assert.equal(state.formRef, 'form-b');
  assert.equal(state.areaRef, 'area-b2', 'a deleted item must fall back to its still-valid area');
  assert.equal(state.formItemRef, '');

  const withoutArea = fixture();
  withoutArea.forms[1].areas = [withoutArea.forms[1].areas[0]];
  state = manager.reconcile('candidate-a', withoutArea);
  assert.equal(state.formRef, 'form-b', 'a deleted area must fall back to its still-valid form');
  assert.equal(state.areaRef, '');
  assert.equal(state.formItemRef, '');

  const withoutSelectedParents = fixture();
  withoutSelectedParents.data_objects = [withoutSelectedParents.data_objects[0]];
  withoutSelectedParents.forms = [withoutSelectedParents.forms[0]];
  state = manager.reconcile('candidate-a', withoutSelectedParents);
  assert.equal(state.dataRef, '', 'a deleted data object must not select the first remaining object');
  assert.equal(state.dataFieldRef, '');
  assert.equal(state.formRef, '', 'a deleted form must not select the first remaining form');
  assert.equal(state.areaRef, '');
  assert.equal(state.formItemRef, '');
}

{
  const flatRows = {
    data_objects: [{ data_ref: 'data-a' }, { data_ref: 'data-deleted', _deleted: true }],
    data_fields: [
      { data_ref: 'data-a', field_ref: 'field-a1' },
      { data_ref: 'data-deleted', field_ref: 'field-deleted' }
    ],
    forms: [{ form_ref: 'form-a' }],
    form_areas: [
      { form_ref: 'form-a', area_ref: 'area-a1' },
      { form_ref: 'form-a', area_ref: 'area-deleted', _deleted: true }
    ],
    form_items: [
      { form_ref: 'form-a', area_ref: 'area-a1', item_ref: 'item-a1' },
      { form_ref: 'form-a', area_ref: 'area-deleted', item_ref: 'item-deleted' }
    ]
  };
  const valid = AuthoringSelectionContext.normalizeSelection({
    dataFieldRef: 'field-a1',
    formItemRef: 'item-a1'
  }, flatRows);
  assert.equal(valid.dataRef, 'data-a');
  assert.equal(valid.formRef, 'form-a');
  assert.equal(valid.areaRef, 'area-a1');

  const deleted = AuthoringSelectionContext.normalizeSelection({
    dataFieldRef: 'field-deleted',
    formItemRef: 'item-deleted'
  }, flatRows);
  assert.equal(deleted.dataRef, '');
  assert.equal(deleted.formRef, '');
}

{
  const manager = AuthoringSelectionContext.createManager();
  const patch = { filter: '金额', sort: { column: 'field_name', direction: 'asc' }, scrollTop: 240 };
  const sourcePatch = JSON.parse(JSON.stringify(patch));
  manager.setTableView('candidate-a', 'data_fields', patch);
  patch.sort.direction = 'desc';
  assert.deepEqual(manager.get('candidate-a').tableViews.data_fields, sourcePatch, 'table view state must be cloned');
  assert.deepEqual(manager.get('candidate-b').tableViews, {}, 'table view state must be isolated by candidate');

  const state = manager.update('candidate-a', { workspace: 'forms' }, fixture());
  assert.equal(state.tableId, 'forms', 'switching workspace must select its root table, not retain an incompatible table');
  manager.clear('candidate-a');
  assert.deepEqual(manager.get('candidate-a'), AuthoringSelectionContext.defaultState());
  assert.throws(() => manager.get(''), /candidateKey is required/);
}

console.log('authoring selection context tests passed');
