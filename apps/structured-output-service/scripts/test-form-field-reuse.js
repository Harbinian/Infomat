const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEmptyProcessGovernanceV7Document, processGovernanceValidationResult } = require('../server');
const FormFieldReuse = require('../public/form-field-reuse.js');

const moduleSource = fs.readFileSync(path.join(__dirname, '../public/form-field-reuse.js'), 'utf8');
const browserContext = {};
vm.runInNewContext(moduleSource, browserContext);
assert.equal(typeof browserContext.FormFieldReuse?.indexDataFields, 'function', 'the UMD module must expose its browser API');

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

function formItem(overrides = {}) {
  return {
    item_ref: 'item_existing_supplier_code',
    item_name: '供应商编码（表单显示名）',
    item_type: '文本',
    required: false,
    instructions: '保留现有填写说明',
    business_data_ref: 'data_supplier',
    data_field_ref: 'field_supplier_code',
    value_usage_mode: 'authoritative_input',
    value_origin_mode: 'direct_current_process',
    source_links: [],
    ...overrides
  };
}

function documentFixture() {
  const documentValue = createEmptyProcessGovernanceV7Document();
  documentValue.data_objects = [{
    data_ref: 'data_supplier',
    data_name: '供应商',
    description: '',
    information_type: 'business_information',
    fields: [
      { field_ref: 'field_supplier_code', field_name: '编码', field_type: '文本', definition: '供应商唯一编码' },
      { field_ref: 'field_supplier_name', field_name: '名称', field_type: '文本', definition: '供应商名称' }
    ],
    behavior_links: [],
    source_relations: [],
    lifecycle: pendingLifecycle()
  }, {
    data_ref: 'data_invoice',
    data_name: '发票',
    description: '',
    information_type: 'business_information',
    fields: [
      { field_ref: 'field_invoice_code', field_name: '编码', field_type: '文本', definition: '发票编码' },
      { field_ref: 'field_invoice_amount', field_name: '金额', field_type: '金额', definition: '发票金额' }
    ],
    behavior_links: [],
    source_relations: [],
    lifecycle: pendingLifecycle()
  }];
  documentValue.forms = [{
    form_ref: 'form_payment',
    form_name: '付款申请单',
    form_no: null,
    form_design_state: 'current_state',
    behavior_links: [],
    areas: [{
      area_ref: 'area_payment_main',
      area_type: '基本信息',
      area_title: '',
      items: [formItem()]
    }]
  }, {
    form_ref: 'form_archive',
    form_name: '归档记录',
    form_no: null,
    form_design_state: 'current_state',
    behavior_links: [],
    areas: [{ area_ref: 'area_archive_main', area_type: '基本信息', area_title: '', items: [] }]
  }];
  return documentValue;
}

function batchInput(overrides = {}) {
  return {
    candidateKey: 'candidate-payment',
    documentFingerprint: 'fingerprint-before-open',
    formRef: 'form_payment',
    fieldRefs: ['field_supplier_code', 'field_supplier_name', 'field_invoice_amount'],
    requiredByFieldRef: {
      field_supplier_code: false,
      field_supplier_name: true,
      field_invoice_amount: true
    },
    areaRef: 'area_payment_main',
    ...overrides
  };
}

function assertValid(documentValue, label) {
  const result = processGovernanceValidationResult(documentValue);
  assert.equal(result.valid, true, `${label}: ${JSON.stringify(result.errors)}`);
}

{
  const source = documentFixture();
  const snapshot = JSON.parse(JSON.stringify(source));
  const index = FormFieldReuse.indexDataFields(source);
  assert.equal(index.errors.length, 0);
  assert.deepEqual(index.groups.map(group => group.dataName), ['供应商', '发票']);
  assert.equal(index.byFieldRef.field_supplier_code.dataRef, 'data_supplier');
  assert.equal(index.byFieldRef.field_invoice_code.dataRef, 'data_invoice', 'same-name fields must remain separated by stable refs');
  assert.equal(index.byFieldRef.field_supplier_code.referenceCount, 1);
  assert.deepEqual(index.byFieldRef.field_supplier_code.references[0], {
    formRef: 'form_payment',
    formName: '付款申请单',
    areaRef: 'area_payment_main',
    areaType: '基本信息',
    areaTitle: '',
    itemRef: 'item_existing_supplier_code',
    itemName: '供应商编码（表单显示名）'
  });
  index.byFieldRef.field_supplier_code.fieldName = '修改索引返回值';
  assert.deepEqual(source, snapshot, 'the index must not share mutable field objects with the source document');
}

{
  const source = documentFixture();
  const index = FormFieldReuse.indexDataFields(source);
  const blankItem = formItem({
    item_name: '   ',
    item_type: '原类型',
    business_data_ref: null,
    data_field_ref: null,
    required: true,
    instructions: '不得覆盖',
    value_usage_mode: 'calculated',
    value_origin_mode: 'depends_on_data'
  });
  const snapshot = JSON.parse(JSON.stringify(blankItem));
  const result = FormFieldReuse.buildReferencePatch(blankItem, 'field_invoice_amount', index);
  assert.equal(result.ok, true);
  assert.deepEqual(result.patch, {
    data_field_ref: 'field_invoice_amount',
    business_data_ref: 'data_invoice',
    item_type: '金额',
    item_name: '金额'
  });
  assert.equal(Object.prototype.hasOwnProperty.call(result.patch, 'required'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.patch, 'instructions'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.patch, 'value_usage_mode'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.patch, 'value_origin_mode'), false);
  assert.deepEqual(blankItem, snapshot, 'building a patch must not modify the item');

  const namedItem = formItem({ item_name: '用户定义的金额名称' });
  const named = FormFieldReuse.buildReferencePatch(namedItem, 'field_invoice_amount', index);
  assert.equal(Object.prototype.hasOwnProperty.call(named.patch, 'item_name'), false, 'an existing display name must not be overwritten');
  assert.equal(namedItem.item_name, '用户定义的金额名称');
}

{
  const source = documentFixture();
  const snapshot = JSON.parse(JSON.stringify(source));
  let sequence = 0;
  const result = FormFieldReuse.planBatchReference(source, batchInput(), prefix => `${prefix}_existing_${++sequence}`);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(source, snapshot, 'planning against an existing area must not mutate the source document');
  assert.equal(result.addedItems.length, 3);
  assert.deepEqual(result.addedItems.map(item => item.fieldRef), batchInput().fieldRefs, 'catalog selection order must be stable');
  assert.equal(result.createdArea, null);
  const items = result.document.forms[0].areas[0].items;
  assert.equal(items.length, 4, 'an already referenced object field may be explicitly referenced again');
  assert.deepEqual(items.slice(1).map(item => item.required), [false, true, true]);
  assert.deepEqual(items.slice(1).map(item => item.value_usage_mode), [
    'pending_confirmation', 'pending_confirmation', 'pending_confirmation'
  ]);
  assert.deepEqual(items.slice(1).map(item => item.value_origin_mode), [
    'pending_confirmation', 'pending_confirmation', 'pending_confirmation'
  ]);
  assert.equal(items[1].item_name, '编码');
  assert.equal(items[1].business_data_ref, 'data_supplier');
  assert.equal(items[3].item_type, '金额');
  assert.equal(result.candidateKey, 'candidate-payment');
  assert.equal(result.documentFingerprint, 'fingerprint-before-open');
  assertValid(result.document, 'batch reference into existing area');
}

{
  const source = documentFixture();
  const snapshot = JSON.parse(JSON.stringify(source));
  let sequence = 0;
  const input = batchInput({
    fieldRefs: ['field_supplier_name', 'field_invoice_amount'],
    requiredByFieldRef: { field_supplier_name: false, field_invoice_amount: true },
    areaRef: undefined,
    newArea: { areaType: '明细清单', areaTitle: '费用明细' }
  });
  const result = FormFieldReuse.planBatchReference(source, input, prefix => `${prefix}_detail_${++sequence}`);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(source, snapshot);
  assert.deepEqual(result.createdArea, {
    areaRef: 'area_detail_1',
    areaType: '明细清单',
    areaTitle: '费用明细'
  });
  const area = result.document.forms[0].areas.at(-1);
  assert.equal(area.items.length, 2);
  assert.deepEqual(area.items.map(item => item.item_ref), ['item_detail_2', 'item_detail_3']);
  assertValid(result.document, 'batch reference into a new detail area');
}

{
  const source = documentFixture();
  let sequence = 0;
  const result = FormFieldReuse.planBatchReference(source, batchInput({
    fieldRefs: ['field_invoice_code'],
    requiredByFieldRef: { field_invoice_code: false },
    areaRef: undefined,
    newArea: { areaType: '', areaTitle: '' }
  }), prefix => `${prefix}_unassigned_${++sequence}`);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const area = result.document.forms[0].areas.at(-1);
  assert.equal(area.area_type, '');
  assert.equal(area.area_title, '');
  assert.equal(area.items[0].required, false);
  assertValid(result.document, 'batch reference into an unassigned area');
}

[
  {
    label: 'duplicate selection',
    input: batchInput({
      fieldRefs: ['field_supplier_name', 'field_supplier_name'],
      requiredByFieldRef: { field_supplier_name: true }
    }),
    code: 'DUPLICATE_FIELD_SELECTION'
  },
  {
    label: 'missing required choice',
    input: batchInput({ requiredByFieldRef: { field_supplier_code: false, field_supplier_name: 'true' } }),
    code: 'REQUIRED_SELECTION_REQUIRED'
  },
  {
    label: 'missing detail title',
    input: batchInput({
      areaRef: undefined,
      newArea: { areaType: '明细清单', areaTitle: '   ' }
    }),
    code: 'DETAIL_AREA_TITLE_REQUIRED'
  },
  {
    label: 'foreign area',
    input: batchInput({ areaRef: 'area_archive_main' }),
    code: 'AREA_FORM_MISMATCH'
  },
  {
    label: 'missing field',
    input: batchInput({
      fieldRefs: ['field_missing'],
      requiredByFieldRef: { field_missing: false }
    }),
    code: 'FIELD_NOT_FOUND'
  }
].forEach(testCase => {
  const source = documentFixture();
  const snapshot = JSON.parse(JSON.stringify(source));
  let refFactoryCalls = 0;
  const result = FormFieldReuse.planBatchReference(source, testCase.input, prefix => {
    refFactoryCalls += 1;
    return `${prefix}_unexpected_${refFactoryCalls}`;
  });
  assert.equal(result.ok, false, testCase.label);
  assert.equal(result.document, null, `${testCase.label} must not expose a partially changed document`);
  assert.ok(result.errors.some(item => item.code === testCase.code), `${testCase.label}: ${JSON.stringify(result.errors)}`);
  assert.deepEqual(source, snapshot, `${testCase.label} must leave the source unchanged`);
  assert.equal(refFactoryCalls, 0, `${testCase.label} must fail before generating refs`);
});

{
  const source = documentFixture();
  const snapshot = JSON.parse(JSON.stringify(source));
  const result = FormFieldReuse.planBatchReference(source, batchInput({
    fieldRefs: ['field_supplier_name'],
    requiredByFieldRef: { field_supplier_name: true }
  }), () => 'item_existing_supplier_code');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.code === 'ITEM_REF_CONFLICT'));
  assert.equal(result.document, null);
  assert.deepEqual(source, snapshot, 'ref conflicts must not partially change the source');
}

{
  const source = documentFixture();
  source.data_objects[1].fields[0].field_ref = 'field_supplier_code';
  const index = FormFieldReuse.indexDataFields(source);
  assert.ok(index.errors.some(item => item.code === 'DUPLICATE_FIELD_REF'));
  const patch = FormFieldReuse.buildReferencePatch({}, 'field_supplier_code', index);
  assert.equal(patch.ok, false);
  assert.ok(patch.errors.some(item => item.code === 'FIELD_REF_AMBIGUOUS'));
  const snapshot = JSON.parse(JSON.stringify(source));
  const result = FormFieldReuse.planBatchReference(source, batchInput({
    fieldRefs: ['field_supplier_code'],
    requiredByFieldRef: { field_supplier_code: true }
  }), prefix => `${prefix}_ambiguous`);
  assert.equal(result.ok, false);
  assert.equal(result.document, null);
  assert.deepEqual(source, snapshot);
}

{
  const source = documentFixture();
  source.data_objects[1].data_ref = 'data_supplier';
  const index = FormFieldReuse.indexDataFields(source);
  assert.ok(index.errors.some(item => item.code === 'DUPLICATE_DATA_REF'));
  const patch = FormFieldReuse.buildReferencePatch({}, 'field_invoice_amount', index);
  assert.equal(patch.ok, false);
  assert.ok(patch.errors.some(item => item.code === 'FIELD_OWNER_AMBIGUOUS'));
}

console.log('form field reuse tests passed');
