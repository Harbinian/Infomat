'use strict';

const assert = require('assert');
const BulkDataEditor = require('../public/bulk-data-editor');
const GraphEditCommands = require('../public/graph-edit-commands');
const GraphEditorState = require('../public/graph-editor-state');

let counter = 0;
function refFactory(prefix) {
  counter += 1;
  return `${prefix}_test_${counter}`;
}

function pendingLifecycle() {
  return {
    applicability: 'pending_confirmation',
    entry_state: {
      business_validity: 'pending_confirmation',
      custody: 'pending_confirmation',
      identifiability_applicability: 'pending_confirmation',
      identifiability: 'pending_confirmation'
    },
    routes: [],
    analysis: { analyzer_version: '', source_fingerprint: '', status: 'not_analyzed' },
    decision_reason: '',
    decision_notes: ''
  };
}

function documentFixture() {
  return {
    schema_version: 'process-governance-v7',
    behaviors: [
      { behavior_ref: 'behavior_apply', behavior_name: '提交申请' },
      { behavior_ref: 'behavior_review', behavior_name: '审核申请' }
    ],
    flow_relations: [],
    data_objects: [{
      data_ref: 'data_application',
      data_name: '申请单',
      description: '申请记录',
      information_type: 'business_information',
      fields: [{ field_ref: 'data_field_amount', field_name: '申请金额', field_type: '金额', definition: '本次申请金额' }],
      behavior_links: [{ link_ref: 'data_link_create', behavior_ref: 'behavior_apply', operation: 'create' }],
      source_relations: [],
      lifecycle: pendingLifecycle()
    }],
    forms: [],
    terms: [],
    migration: {}
  };
}

function prepare(kind, input, documentValue) {
  return BulkDataEditor.prepare(kind, input, documentValue, {
    refFactory,
    allowedFieldTypes: ['文本', '金额', '日期', '附件'],
    technicalIntegrity: GraphEditCommands.technicalIntegrity,
    deleteDataObject(documentDraft, ref) {
      return GraphEditCommands.applyCommand(documentDraft, { type: 'delete_object', kind: 'data', ref });
    }
  });
}

const quoted = BulkDataEditor.parseDelimited('列1\t列2\r\n"第一行\n第二行"\t"含""引号"');
assert.deepStrictEqual(quoted.errors, []);
assert.strictEqual(quoted.rows[1][0], '第一行\n第二行');
assert.strictEqual(quoted.rows[1][1], '含"引号');

const source = documentFixture();
const objectInput = [
  BulkDataEditor.headerText('objects'),
  '\tdata_application\t申请单\t业务信息\t更新后的申请记录',
  '\t\t付款记录\t业务结论\t财务付款结论'
].join('\r\n');
const objectPreview = prepare('objects', objectInput, source);
assert.strictEqual(objectPreview.ok, true, JSON.stringify(objectPreview.errors));
assert.deepStrictEqual(objectPreview.summary, { added: 1, updated: 1, deleted: 0, unchanged: 0 });
assert.strictEqual(source.data_objects.length, 1, 'preview must not mutate source');
assert.strictEqual(objectPreview.document.data_objects.length, 2);

const fieldInput = [
  BulkDataEditor.headerText('fields'),
  '\tdata_field_amount\tdata_application\t申请单\t申请金额\t金额\t含税申请金额',
  '\t\tdata_application\t申请单\t币种\t文本\t申请币种'
].join('\n');
const fieldPreview = prepare('fields', fieldInput, source);
assert.strictEqual(fieldPreview.ok, true, JSON.stringify(fieldPreview.errors));
assert.deepStrictEqual(fieldPreview.summary, { added: 1, updated: 1, deleted: 0, unchanged: 0 });

const invalidFieldTypeInput = [
  BulkDataEditor.headerText('fields'),
  '\t\tdata_application\t申请单\t自定义字段\t任意自定义类型\t不应绕过受控目录'
].join('\n');
const invalidFieldTypePreview = prepare('fields', invalidFieldTypeInput, source);
assert.strictEqual(invalidFieldTypePreview.ok, false);
assert(invalidFieldTypePreview.errors.some(item => item.code === 'FIELD_TYPE_INVALID'));
assert.deepStrictEqual(invalidFieldTypePreview.document, source);

const relationInput = [
  BulkDataEditor.headerText('relations'),
  '\t\tdata_application\t申请单\tbehavior_review\t审核申请\t使用'
].join('\n');
const relationPreview = prepare('relations', relationInput, source);
assert.strictEqual(relationPreview.ok, true, JSON.stringify(relationPreview.errors));
assert.strictEqual(relationPreview.summary.added, 1);

const deleteRelationInput = [
  BulkDataEditor.headerText('relations'),
  '删除\tdata_link_create\tdata_application\t申请单\tbehavior_apply\t提交申请\t创建'
].join('\n');
const deleteRelationPreview = prepare('relations', deleteRelationInput, source);
assert.strictEqual(deleteRelationPreview.ok, true, JSON.stringify(deleteRelationPreview.errors));
assert.strictEqual(deleteRelationPreview.summary.deleted, 1);
assert.strictEqual(deleteRelationPreview.document.data_objects[0].behavior_links.length, 0);

const deletableDocument = documentFixture();
deletableDocument.data_objects[0].behavior_links = [];
const deleteObjectInput = [
  BulkDataEditor.headerText('objects'),
  '删除\tdata_application\t申请单\t业务信息\t申请记录'
].join('\n');
const deleteObjectPreview = prepare('objects', deleteObjectInput, deletableDocument);
assert.strictEqual(deleteObjectPreview.ok, true, JSON.stringify(deleteObjectPreview.errors));
assert.strictEqual(deleteObjectPreview.summary.deleted, 1);
assert.strictEqual(deleteObjectPreview.document.data_objects.length, 0);

const ambiguous = documentFixture();
ambiguous.data_objects.push({ ...ambiguous.data_objects[0], data_ref: 'data_application_copy', fields: [], behavior_links: [] });
const ambiguousInput = [
  BulkDataEditor.headerText('fields'),
  '\t\t\t申请单\t币种\t文本\t申请币种'
].join('\n');
const ambiguousPreview = prepare('fields', ambiguousInput, ambiguous);
assert.strictEqual(ambiguousPreview.ok, false);
assert(ambiguousPreview.errors.some(item => item.code === 'REFERENCE_AMBIGUOUS'));
assert.deepStrictEqual(ambiguousPreview.document, ambiguous, 'failed batch must return unchanged document');

const ambiguousBehavior = documentFixture();
ambiguousBehavior.behaviors.push({ behavior_ref: 'behavior_review_copy', behavior_name: '审核申请' });
const ambiguousRelationInput = [
  BulkDataEditor.headerText('relations'),
  '\t\tdata_application\t申请单\t\t审核申请\t使用'
].join('\n');
const ambiguousRelationPreview = prepare('relations', ambiguousRelationInput, ambiguousBehavior);
assert.strictEqual(ambiguousRelationPreview.ok, false);
assert(ambiguousRelationPreview.errors.some(item => item.code === 'REFERENCE_AMBIGUOUS'));
assert.deepStrictEqual(ambiguousRelationPreview.document, ambiguousBehavior);

const referenced = documentFixture();
referenced.forms = [{
  form_ref: 'form_application',
  areas: [{ items: [{ item_ref: 'item_amount', data_field_ref: 'data_field_amount', business_data_ref: 'data_application', source_links: [] }] }],
  behavior_links: []
}];
const deleteFieldInput = [
  BulkDataEditor.headerText('fields'),
  '删除\tdata_field_amount\tdata_application\t申请单\t申请金额\t金额\t本次申请金额'
].join('\n');
const deleteFieldPreview = prepare('fields', deleteFieldInput, referenced);
assert.strictEqual(deleteFieldPreview.ok, false);
assert(deleteFieldPreview.errors.some(item => item.code === 'DELETE_BLOCKED'));
assert.strictEqual(referenced.data_objects[0].fields.length, 1);

const invalidAtomicInput = [
  BulkDataEditor.headerText('objects'),
  '\tdata_application\t申请单\t业务信息\t不应生效',
  '\t\t错误对象\t不存在的类型\t错误行'
].join('\n');
const invalidAtomic = prepare('objects', invalidAtomicInput, source);
assert.strictEqual(invalidAtomic.ok, false);
assert.deepStrictEqual(invalidAtomic.document, source);

const manager = GraphEditorState.createManager({ limit: 5 });
manager.register('candidate', source);
const applied = manager.execute('candidate', source, () => objectPreview);
assert.strictEqual(applied.ok, true);
assert.strictEqual(applied.state.undoCount, 1, 'one batch must create one undo entry');
const undone = manager.undo('candidate', applied.document);
assert.deepStrictEqual(undone.document, source);

const exported = BulkDataEditor.exportTsv('objects', objectPreview.document);
const roundTrip = prepare('objects', exported, objectPreview.document);
assert.strictEqual(roundTrip.ok, true, JSON.stringify(roundTrip.errors));
assert.strictEqual(roundTrip.summary.unchanged, 2);

console.log('Bulk data editor tests passed.');
