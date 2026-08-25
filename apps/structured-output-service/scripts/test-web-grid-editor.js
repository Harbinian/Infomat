const assert = require('node:assert/strict');

const WebGridCore = require('../public/web-grid-core');
const ProcessV7GridAdapter = require('../public/process-v7-grid-adapter');
const NativeWebGrid = require('../public/native-web-grid');
const GraphEditorState = require('../public/graph-editor-state');
const GraphEditCommands = require('../public/graph-edit-commands');

let sequence = 0;
const refFactory = prefix => `${prefix}_test_${++sequence}`;
const pendingLifecycle = () => ({
  applicability: 'pending_confirmation',
  entry_state: {
    business_validity: 'pending_confirmation', custody: 'pending_confirmation',
    identifiability_applicability: 'pending_confirmation', identifiability: 'pending_confirmation'
  },
  routes: [],
  analysis: { analyzer_version: '', source_fingerprint: '', status: 'not_analyzed' },
  decision_reason: '', decision_notes: ''
});

function documentFixture() {
  return {
    schema_version: 'process-governance-v7',
    behaviors: [
      { behavior_ref: 'behavior_create', behavior_name: '登记申请', node_type: 'action' },
      { behavior_ref: 'behavior_review', behavior_name: '复核申请', node_type: 'action' }
    ],
    migration: { reference_materials: [{ material_name: '原始依据.pdf' }], archive: [{ source_version: 'process-governance-v6' }] },
    data_objects: [{
      data_ref: 'data_request', data_name: '申请信息', description: '申请业务信息', information_type: 'business_information',
      fields: [{ field_ref: 'data_field_amount', field_name: '申请金额', field_type: '金额', definition: '本次申请的金额' }],
      behavior_links: [{ link_ref: 'data_link_create', behavior_ref: 'behavior_create', operation: 'create' }],
      source_relations: [{
        source_ref: 'data_source_request', source_department: '业务部门', source_process_name: '前置流程',
        source_behavior_name: '提交信息', source_data_name: '申请信息', availability_mode: 'process_start',
        available_from_behavior_ref: null
      }], lifecycle: pendingLifecycle()
    }],
    forms: [{
      form_ref: 'form_request', form_name: '申请单', form_no: null, form_design_state: 'current_state',
      behavior_links: [{ link_ref: 'form_link_fill', behavior_ref: 'behavior_create', operations: ['fill'], notes: '' }],
      areas: [{
        area_ref: 'area_request_main', area_type: '基本信息', area_title: '',
        items: [{
          item_ref: 'item_amount', item_name: '申请金额', item_type: '金额', required: true, instructions: '',
          business_data_ref: 'data_request', data_field_ref: 'data_field_amount',
          value_usage_mode: 'authoritative_input', value_origin_mode: 'direct_current_process', source_links: [{
            source_link_ref: 'field_source_amount', source_type: 'process_data', source_data_ref: 'data_request',
            source_system_name: '', source_data_name: '', source_role: 'validation_basis'
          }]
        }]
      }]
    }]
  };
}

const adapterOptions = {
  refFactory,
  pendingLifecycle,
  allowedFieldTypes: ['文本', '金额', '日期'],
  technicalIntegrity: GraphEditCommands.technicalIntegrity,
  dataObjectFactory(ref) {
    return {
      data_ref: ref, data_name: '', description: '', information_type: 'pending_confirmation', fields: [],
      behavior_links: [], source_relations: [], lifecycle: pendingLifecycle()
    };
  }
};

{
  const source = documentFixture();
  source.behaviors.push({ behavior_ref: 'behavior_decision', behavior_name: '申请是否通过？', node_type: 'decision' });
  const sourceSnapshot = JSON.stringify(source);
  const session = WebGridCore.createSession({
    adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'control-node-data-link', adapterOptions
  });
  const rows = session.rows('data_behavior_links');
  rows[0].behavior_ref = 'behavior_decision';
  session.replaceRows('data_behavior_links', rows);
  const prepared = session.prepare(source, 'control-node-data-link');
  assert.equal(prepared.ok, false, 'data relationships must reject control nodes');
  assert.ok(prepared.errors.some(item => item.code === 'ACTION_BEHAVIOR_REQUIRED'));
  assert.equal(JSON.stringify(source), sourceSnapshot, 'failed control-node relation must leave the source unchanged');
}

{
  const source = documentFixture();
  source.behaviors.push({ behavior_ref: 'behavior_parallel', behavior_name: '并行办理', node_type: 'parallel_split' });
  const session = WebGridCore.createSession({
    adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'control-node-form-link', adapterOptions
  });
  const rows = session.rows('form_behavior_links');
  rows[0].behavior_ref = 'behavior_parallel';
  session.replaceRows('form_behavior_links', rows);
  const prepared = session.prepare(source, 'control-node-form-link');
  assert.equal(prepared.ok, false, 'form relationships must reject control nodes');
  assert.ok(prepared.errors.some(item => item.code === 'ACTION_BEHAVIOR_REQUIRED'));
}

{
  assert.equal(NativeWebGrid.isCompositionKey({ key: 'Enter', isComposing: true }, false), true);
  assert.equal(NativeWebGrid.isCompositionKey({ key: 'Enter', keyCode: 229 }, false), true);
  assert.equal(NativeWebGrid.isCompositionKey({ key: 'Enter' }, true), true);
  assert.equal(NativeWebGrid.isCompositionKey({ key: 'Enter' }, false), false);
  assert.equal(
    NativeWebGrid.isCompositionKey({ key: 'Enter' }, false, 1000, 1040),
    true,
    'the Enter event immediately following compositionend must stay inside the current native control'
  );
  assert.equal(
    NativeWebGrid.isCompositionKey({ key: 'Enter' }, false, 1000, 1120),
    false,
    'a later explicit Enter may continue navigation'
  );
  assert.equal(
    NativeWebGrid.isCompositionKey({ key: 'ArrowDown' }, false, 1000, 1040),
    false,
    'composition grace must not swallow normal navigation keys'
  );
  assert.deepEqual(NativeWebGrid.parseClipboardGrid('甲\t乙\r\n丙\t丁'), [['甲', '乙'], ['丙', '丁']]);
  assert.deepEqual(NativeWebGrid.parseClipboardGrid('"甲\n乙"\t"含""引号"'), [['甲\n乙', '含"引号']]);
  const paste = NativeWebGrid.planPaste({
    matrix: [['业务信息', '是'], ['基础信息', '否']],
    columns: [
      { key: 'information_type', label: '信息类型', editor: 'select' },
      { key: 'required', label: '是否必填', editor: 'boolean' }
    ],
    startColumn: 0,
    optionResolver(column) {
      return column.key === 'information_type' ? [
        { value: 'business_information', label: '业务信息' },
        { value: 'basic_information', label: '基础信息' }
      ] : [];
    }
  });
  assert.deepEqual(paste.values, [
    ['business_information', true],
    ['basic_information', false]
  ]);
  assert.equal(NativeWebGrid.planPaste({
    matrix: [['未知类型']],
    columns: [{ key: 'information_type', label: '信息类型', editor: 'select' }],
    startColumn: 0,
    optionResolver() { return [{ value: 'business_information', label: '业务信息' }]; }
  }).errors[0].message, '没有选项“未知类型”');
  assert.equal(NativeWebGrid.toClipboardText([['普通', '含\t制表符'], ['换\n行', '含"引号']]), '普通\t"含\t制表符"\r\n"换\n行"\t"含""引号"');
}

{
  const source = documentFixture();
  const rows = ProcessV7GridAdapter.read(source);
  assert.deepEqual(Object.keys(rows), ProcessV7GridAdapter.TABLE_IDS);
  assert.equal(rows.data_objects.length, 1);
  assert.equal(rows.data_fields.length, 1);
  assert.equal(rows.data_behavior_links.length, 1);
  assert.deepEqual(rows.data_behavior_links[0].updated_field_refs, []);
  assert.equal(rows.data_source_relations.length, 1);
  assert.equal(rows.forms.length, 1);
  assert.equal(rows.form_behavior_links.length, 1);
  assert.equal(rows.form_areas.length, 1);
  assert.equal(rows.form_items.length, 1);
  assert.equal(rows.field_source_links.length, 1);
}

{
  const source = documentFixture();
  const session = WebGridCore.createSession({ adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'update-fields', adapterOptions });
  const rows = session.rows('data_behavior_links');
  Object.assign(rows[0], { operation: 'update', updated_field_refs: ['data_field_amount'] });
  session.replaceRows('data_behavior_links', rows);
  const prepared = session.prepare(source, 'update-fields');
  assert.equal(prepared.ok, true, prepared.errors.map(item => item.message).join('; '));
  assert.deepEqual(prepared.document.data_objects[0].behavior_links[0].updated_field_refs, ['data_field_amount']);

  const invalidRows = session.rows('data_behavior_links');
  invalidRows[0].updated_field_refs = ['data_field_missing'];
  session.replaceRows('data_behavior_links', invalidRows);
  const invalid = session.prepare(source, 'update-fields');
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(item => item.code === 'REFERENCE_MISSING' && item.column === 'updated_field_refs'));
}

{
  const source = documentFixture();
  const session = WebGridCore.createSession({
    adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'all-tables', adapterOptions
  });
  ProcessV7GridAdapter.TABLE_IDS.forEach(tableId => {
    const original = session.rows(tableId)[0];
    const definition = session.definition(tableId);
    assert.ok(original, `${tableId} must have a fixture row`);
    const duplicate = session.duplicateRow(tableId, original._row_id, {
      parentRef: definition.parentKey ? original[definition.parentKey] : '',
      formRef: original.form_ref
    });
    assert.notEqual(duplicate._row_id, original._row_id, `${tableId} duplicate must receive a stable identifier`);
    session.setDeleted(tableId, duplicate._row_id, true);
    assert.equal(session.rows(tableId).some(row => row._row_id === duplicate._row_id), false, `${tableId} new deleted row must be removed explicitly`);
    session.setDeleted(tableId, original._row_id, true);
    assert.equal(session.rows(tableId).find(row => row._row_id === original._row_id)._deleted, true);
    session.setDeleted(tableId, original._row_id, false);
  });
  const pastedRows = session.rows('data_objects');
  pastedRows[0].data_name = '区域粘贴后的申请信息';
  pastedRows[0].description = '一次替换多个单元格';
  session.replaceRows('data_objects', pastedRows);
  const prepared = session.prepare(source, 'all-tables');
  assert.equal(prepared.ok, true, prepared.errors.map(item => item.message).join('; '));
  assert.equal(prepared.document.data_objects[0].data_name, '区域粘贴后的申请信息');
  assert.equal(prepared.document.data_objects[0].description, '一次替换多个单元格');
  assert.deepEqual(prepared.document.migration, source.migration, 'grid editing must preserve migration archive');
  assert.deepEqual(prepared.document.data_objects[0].lifecycle, source.data_objects[0].lifecycle, 'grid editing must preserve lifecycle');
}

{
  const source = documentFixture();
  const session = WebGridCore.createSession({
    adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'add-nine', adapterOptions
  });
  const dataObject = session.addRow('data_objects');
  const dataObjectRows = session.rows('data_objects');
  Object.assign(dataObjectRows.find(row => row._row_id === dataObject._row_id), {
    data_name: '付款信息', information_type: 'business_information', description: '付款所需信息'
  });
  session.replaceRows('data_objects', dataObjectRows);

  const dataField = session.addRow('data_fields', { parentRef: dataObject.data_ref });
  const dataFieldRows = session.rows('data_fields');
  Object.assign(dataFieldRows.find(row => row._row_id === dataField._row_id), { field_name: '付款日期', field_type: '日期', definition: '实际付款日期' });
  session.replaceRows('data_fields', dataFieldRows);

  const dataLink = session.addRow('data_behavior_links', { parentRef: dataObject.data_ref });
  const dataLinkRows = session.rows('data_behavior_links');
  Object.assign(dataLinkRows.find(row => row._row_id === dataLink._row_id), { behavior_ref: 'behavior_review', operation: 'create' });
  session.replaceRows('data_behavior_links', dataLinkRows);

  const dataSource = session.addRow('data_source_relations', { parentRef: dataObject.data_ref });
  const dataSourceRows = session.rows('data_source_relations');
  Object.assign(dataSourceRows.find(row => row._row_id === dataSource._row_id), { source_department: '财务部', source_process_name: '付款流程', source_data_name: '付款指令', availability_mode: 'process_start' });
  session.replaceRows('data_source_relations', dataSourceRows);

  const form = session.addRow('forms');
  const formRows = session.rows('forms');
  Object.assign(formRows.find(row => row._row_id === form._row_id), { form_name: '付款单', form_design_state: 'current_state' });
  session.replaceRows('forms', formRows);

  const formLink = session.addRow('form_behavior_links', { parentRef: form.form_ref });
  const formLinkRows = session.rows('form_behavior_links');
  Object.assign(formLinkRows.find(row => row._row_id === formLink._row_id), { behavior_ref: 'behavior_review', operations: 'fill、review' });
  session.replaceRows('form_behavior_links', formLinkRows);

  const area = session.addRow('form_areas', { parentRef: form.form_ref });
  const areaRows = session.rows('form_areas');
  Object.assign(areaRows.find(row => row._row_id === area._row_id), { area_type: '基本信息', area_title: '付款信息' });
  session.replaceRows('form_areas', areaRows);

  const item = session.addRow('form_items', { parentRef: area.area_ref, formRef: form.form_ref });
  const itemRows = session.rows('form_items');
  Object.assign(itemRows.find(row => row._row_id === item._row_id), {
    item_name: '付款日期', item_type: '', business_data_ref: dataObject.data_ref, data_field_ref: dataField.field_ref,
    value_usage_mode: 'reuse_existing', value_origin_mode: 'depends_on_data'
  });
  session.replaceRows('form_items', itemRows);

  const sourceLink = session.addRow('field_source_links', { parentRef: item.item_ref });
  const sourceLinkRows = session.rows('field_source_links');
  Object.assign(sourceLinkRows.find(row => row._row_id === sourceLink._row_id), { source_type: 'process_data', source_data_ref: dataObject.data_ref, source_role: 'provides_value' });
  session.replaceRows('field_source_links', sourceLinkRows);

  const prepared = session.prepare(source, 'add-nine');
  assert.equal(prepared.ok, true, prepared.errors.map(problem => problem.message).join('; '));
  assert.equal(prepared.summary.added, 9, 'all nine business tables must commit together');
  const committedItem = prepared.document.forms.find(entry => entry.form_ref === form.form_ref).areas[0].items[0];
  assert.equal(committedItem.item_type, '日期', 'referenced object field must supply the form field type');
  assert.equal(source.forms.length, 1, 'candidate preparation must remain atomic');

  const manager = GraphEditorState.createManager();
  manager.register('grid-case', source);
  const applied = manager.execute('grid-case', source, () => ({ ok: true, document: prepared.document, details: { source: 'web-grid' } }));
  assert.equal(applied.state.undoCount, 1, 'one grid apply must create one undo operation');
  const undone = manager.undo('grid-case', applied.document);
  assert.deepEqual(undone.document, source, 'one undo must restore the complete source document');
}

{
  const source = documentFixture();
  const sourceSnapshot = JSON.stringify(source);
  const session = WebGridCore.createSession({
    adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'v1', adapterOptions
  });
  const added = session.addRow('data_objects');
  const objectRows = session.rows('data_objects');
  objectRows.find(row => row._row_id === added._row_id).data_name = '付款信息';
  objectRows.find(row => row._row_id === added._row_id).information_type = 'business_information';
  session.replaceRows('data_objects', objectRows);
  assert.equal(JSON.stringify(source), sourceSnapshot, 'grid work copy must not mutate source JSON');
  assert.equal(session.isDirty(), true);
  const prepared = session.prepare(source, 'v1');
  assert.equal(prepared.ok, true, prepared.errors.map(item => item.message).join('; '));
  assert.equal(prepared.document.data_objects.length, 2);
  assert.equal(prepared.summary.added, 1);
  assert.equal(source.data_objects.length, 1);
}

{
  const source = documentFixture();
  const session = WebGridCore.createSession({
    adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'v1', adapterOptions
  });
  session.setDeleted('data_fields', 'data_field_amount', true);
  const prepared = session.prepare(source, 'v1');
  assert.equal(prepared.ok, false);
  assert.ok(prepared.errors.some(item => item.code === 'REFERENCE_MISSING'));
  assert.equal(source.data_objects[0].fields.length, 1, 'failed prepare must leave source intact');
}

{
  const source = documentFixture();
  source.data_objects.push({
    data_ref: 'data_other', data_name: '其他信息', description: '', information_type: 'business_information',
    fields: [], behavior_links: [], source_relations: [], lifecycle: pendingLifecycle()
  });
  const session = WebGridCore.createSession({
    adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'v1', adapterOptions
  });
  const rows = session.rows('data_fields');
  rows[0].data_ref = 'data_other';
  session.replaceRows('data_fields', rows);
  const prepared = session.prepare(source, 'v1');
  assert.equal(prepared.ok, false);
  assert.ok(prepared.errors.some(item => item.code === 'OWNER_CHANGE_BLOCKED'));
}

{
  const source = documentFixture();
  const session = WebGridCore.createSession({
    adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'v1', adapterOptions
  });
  const rows = session.rows('data_objects');
  rows[0].information_type = 'invalid-type';
  session.replaceRows('data_objects', rows);
  const prepared = session.prepare(source, 'v1');
  assert.equal(prepared.ok, false);
  assert.ok(prepared.errors.some(item => item.code === 'ENUM_INVALID'));
}

{
  const source = documentFixture();
  const session = WebGridCore.createSession({
    adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'v1', adapterOptions
  });
  const prepared = session.prepare(source, 'v2');
  assert.equal(prepared.ok, false);
  assert.equal(prepared.errors[0].code, 'SOURCE_CHANGED');
}

{
  const source = documentFixture();
  source.data_objects.push({
    data_ref: 'data_second', data_name: '第二项', description: '', information_type: 'business_information',
    fields: [], behavior_links: [], source_relations: [], lifecycle: pendingLifecycle()
  });
  const session = WebGridCore.createSession({
    adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'v1', adapterOptions
  });
  session.replaceRows('data_objects', session.rows('data_objects').reverse());
  const prepared = session.prepare(source, 'v1');
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.document.data_objects.map(item => item.data_ref), ['data_request', 'data_second'], 'display sorting must not rewrite JSON order');
  session.moveRow('data_objects', 'data_second', -1);
  const reordered = session.prepare(source, 'v1');
  assert.deepEqual(reordered.document.data_objects.map(item => item.data_ref), ['data_second', 'data_request'], 'explicit move must rewrite JSON order');
}

{
  const source = documentFixture();
  source.data_objects.push({
    data_ref: 'data_duplicate_ref', data_name: '第二项', description: '', information_type: 'business_information',
    fields: [], behavior_links: [], source_relations: [], lifecycle: pendingLifecycle()
  });
  const session = WebGridCore.createSession({ adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'duplicate-ref', adapterOptions });
  const rows = session.rows('data_objects');
  rows[1].data_ref = 'data_request';
  session.replaceRows('data_objects', rows);
  const prepared = session.prepare(source, 'duplicate-ref');
  assert.equal(prepared.ok, false);
  assert.ok(prepared.errors.some(item => item.code === 'REF_DUPLICATE'));
}

{
  const source = documentFixture();
  source.behaviors[1].behavior_name = source.behaviors[0].behavior_name;
  source.data_objects.push({
    data_ref: 'data_same_name', data_name: source.data_objects[0].data_name, description: '', information_type: 'business_information',
    fields: [], behavior_links: [], source_relations: [], lifecycle: pendingLifecycle()
  });
  const session = WebGridCore.createSession({ adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'duplicate-names', adapterOptions });
  const rows = session.rows('data_objects');
  rows[0].description = '触发候选文档生成';
  session.replaceRows('data_objects', rows);
  const prepared = session.prepare(source, 'duplicate-names');
  assert.equal(prepared.ok, true, prepared.errors.map(item => item.message).join('; '));
  assert.ok(prepared.warnings.some(item => item.code === 'DUPLICATE_NAME'));
  assert.ok(prepared.warnings.some(item => item.code === 'DUPLICATE_BEHAVIOR_NAME'));
}

{
  const source = documentFixture();
  const session = WebGridCore.createSession({ adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'creator-conflict', adapterOptions });
  const added = session.addRow('data_behavior_links', { parentRef: 'data_request' });
  const rows = session.rows('data_behavior_links');
  Object.assign(rows.find(row => row._row_id === added._row_id), { behavior_ref: 'behavior_review', operation: 'create' });
  session.replaceRows('data_behavior_links', rows);
  const prepared = session.prepare(source, 'creator-conflict');
  assert.equal(prepared.ok, false);
  const conflict = prepared.errors.find(item => item.code === 'CREATOR_CONFLICT');
  assert.equal(conflict?.rowId, added._row_id, 'creator conflict must locate the conflicting relation row');
}

{
  const source = documentFixture();
  const session = WebGridCore.createSession({ adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'delete-object', adapterOptions });
  session.setDeleted('data_objects', 'data_request', true);
  const prepared = session.prepare(source, 'delete-object');
  assert.equal(prepared.ok, false);
  assert.ok(prepared.errors.some(item => ['REFERENCE_MISSING', 'PARENT_MISSING'].includes(item.code)));
}

{
  const source = documentFixture();
  const session = WebGridCore.createSession({ adapter: ProcessV7GridAdapter, documentValue: source, sourceKey: 'form-order', adapterOptions });
  const added = session.addRow('form_items', { parentRef: 'area_request_main', formRef: 'form_request' });
  const rows = session.rows('form_items');
  Object.assign(rows.find(row => row._row_id === added._row_id), {
    item_name: '备注', item_type: '文本', value_usage_mode: 'authoritative_input', value_origin_mode: 'direct_current_process'
  });
  session.replaceRows('form_items', rows);
  assert.equal(session.moveRow('form_items', added._row_id, -1), true);
  const prepared = session.prepare(source, 'form-order');
  assert.equal(prepared.ok, true, prepared.errors.map(item => item.message).join('; '));
  assert.deepEqual(prepared.document.forms[0].areas[0].items.map(item => item.item_ref), [added.item_ref, 'item_amount']);
  const roundTrip = ProcessV7GridAdapter.read(prepared.document);
  assert.deepEqual(roundTrip.form_items.map(item => item.item_ref), [added.item_ref, 'item_amount'], 'explicit form field order must survive round trip');
}

{
  const performance = documentFixture();
  performance.behaviors = Array.from({ length: 120 }, (_, index) => ({
    behavior_ref: `behavior_perf_${index + 1}`, behavior_name: `性能行为${index + 1}`, node_type: 'action'
  }));
  performance.data_objects = Array.from({ length: 30 }, (_, dataIndex) => ({
    data_ref: `data_perf_${dataIndex + 1}`, data_name: `性能数据对象${dataIndex + 1}`, description: '', information_type: 'business_information',
    fields: Array.from({ length: dataIndex < 20 ? 7 : 6 }, (_, fieldIndex) => ({
      field_ref: `data_field_perf_${dataIndex + 1}_${fieldIndex + 1}`, field_name: `字段${fieldIndex + 1}`, field_type: '文本', definition: ''
    })),
    behavior_links: Array.from({ length: 4 }, (_, relationIndex) => ({
      link_ref: `data_link_perf_${dataIndex + 1}_${relationIndex + 1}`,
      behavior_ref: `behavior_perf_${dataIndex * 4 + relationIndex + 1}`,
      operation: relationIndex === 0 ? 'create' : (relationIndex % 2 ? 'update' : 'use')
    })),
    source_relations: [], lifecycle: pendingLifecycle()
  }));
  performance.forms = Array.from({ length: 10 }, (_, formIndex) => ({
    form_ref: `form_perf_${formIndex + 1}`, form_name: `性能表单${formIndex + 1}`, form_no: null, form_design_state: 'current_state',
    behavior_links: [], areas: [{
      area_ref: `area_perf_${formIndex + 1}`, area_type: '基本信息', area_title: '', items: [{
        item_ref: `item_perf_${formIndex + 1}`, item_name: '字段1', item_type: '文本', required: false, instructions: '',
        business_data_ref: `data_perf_${formIndex + 1}`, data_field_ref: `data_field_perf_${formIndex + 1}_1`,
        value_usage_mode: 'reuse_existing', value_origin_mode: 'depends_on_data', source_links: []
      }]
    }]
  }));
  const started = performanceNow();
  const session = WebGridCore.createSession({ adapter: ProcessV7GridAdapter, documentValue: performance, sourceKey: 'performance', adapterOptions });
  const rows = session.rows('data_objects');
  rows[0].description = '性能检查修改';
  session.replaceRows('data_objects', rows);
  const prepared = session.prepare(performance, 'performance');
  const elapsed = performanceNow() - started;
  assert.equal(prepared.ok, true, prepared.errors.map(item => item.message).join('; '));
  assert.equal(performance.data_objects.reduce((count, item) => count + item.fields.length, 0), 200);
  assert.equal(performance.data_objects.reduce((count, item) => count + item.behavior_links.length, 0), 120);
  assert.ok(elapsed < 1000, `30/200/120/10 sample took ${elapsed.toFixed(1)}ms`);
  console.log(`web grid performance sample: ${elapsed.toFixed(1)}ms`);
}

console.log('web grid editor tests passed');

function performanceNow() {
  return Number(process.hrtime.bigint()) / 1e6;
}
