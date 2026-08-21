const assert = require('node:assert/strict');
const {
  createEmptyProcessGovernanceV6Document,
  processGovernanceValidationResult
} = require('../server');
const Migration = require('../public/process-governance-migration.js');

function formItem(ref, name, type, dataRef, origin = 'direct_current_process') {
  return {
    item_ref: ref,
    item_name: name,
    item_type: type,
    required: false,
    instructions: '',
    business_data_ref: dataRef,
    value_origin_mode: origin,
    source_links: []
  };
}

function form(ref, name, items) {
  return {
    form_ref: ref,
    form_name: name,
    form_no: null,
    form_design_state: 'current_state',
    behavior_links: [],
    areas: [{ area_ref: `area_${ref}`, area_type: '基本信息', area_title: '', items }]
  };
}

function v6Fixture() {
  const documentValue = createEmptyProcessGovernanceV6Document();
  documentValue.export_meta.package_ref = 'package_field_reuse';
  documentValue.export_meta.exported_at = '2026-08-21T00:00:00.000Z';
  documentValue.process.process_ref = 'process_supplier_payment';
  documentValue.process.process_name = '供应商付款流程';
  documentValue.process.owning_department = '财务部';
  documentValue.data_objects = [{
    data_ref: 'data_supplier',
    data_name: '供应商',
    description: '付款流程中引用的供应商信息',
    information_type: 'business_information',
    behavior_links: [],
    source_relations: []
  }];
  documentValue.forms = [
    form('form_invoice', '发票登记单', [formItem('item_invoice_supplier_code', '供应商编码', '文本', 'data_supplier')]),
    form('form_payment', '付款申请单', [formItem('item_payment_supplier_code', '供应商编码', '文本', 'data_supplier')])
  ];
  return documentValue;
}

function assertValid(documentValue, label) {
  const result = processGovernanceValidationResult(documentValue);
  assert.equal(result.valid, true, `${label}: ${JSON.stringify(result.errors)}`);
}

function run() {
  const source = v6Fixture();
  const snapshot = JSON.parse(JSON.stringify(source));
  const migrated = Migration.migrateDocument(source)[0];
  assert.deepEqual(source, snapshot, 'v6 source must remain unchanged');
  assert.equal(migrated.data_objects[0].fields.length, 1, 'same object/name/type must produce one reusable field');
  const first = migrated.forms[0].areas[0].items[0];
  const second = migrated.forms[1].areas[0].items[0];
  assert.equal(first.data_field_ref, migrated.data_objects[0].fields[0].field_ref);
  assert.equal(second.data_field_ref, first.data_field_ref);
  assert.equal(first.value_usage_mode, 'authoritative_input');
  assert.equal(second.value_usage_mode, 'authoritative_input', 'multiple direct inputs must remain visible for business review');
  assertValid(migrated, 'v6 migration');
  assert.deepEqual(Migration.migrateDocument(migrated)[0], migrated, 'current v7 migration must be idempotent');

  const singleAuthority = JSON.parse(JSON.stringify(source));
  singleAuthority.forms[1].areas[0].items[0].value_origin_mode = 'depends_on_data';
  const reused = Migration.migrateDocument(singleAuthority)[0];
  assert.equal(reused.forms[0].areas[0].items[0].value_usage_mode, 'authoritative_input');
  assert.equal(reused.forms[1].areas[0].items[0].value_usage_mode, 'reuse_existing');
  assert.equal(reused.forms[0].areas[0].items[0].data_field_ref, reused.forms[1].areas[0].items[0].data_field_ref);
  assertValid(reused, 'single authority migration');

  const typeConflict = JSON.parse(JSON.stringify(source));
  typeConflict.forms[1].areas[0].items[0].item_type = '整数';
  const separated = Migration.migrateDocument(typeConflict)[0];
  assert.equal(separated.data_objects[0].fields.length, 2, 'same name with conflicting types must not be merged');
  assert.notEqual(separated.forms[0].areas[0].items[0].data_field_ref, separated.forms[1].areas[0].items[0].data_field_ref);
  assertValid(separated, 'type conflict migration');

  const previewV7 = JSON.parse(JSON.stringify(reused));
  previewV7.data_objects[0].lifecycle.applicability = 'not_applicable';
  previewV7.data_objects[0].lifecycle.decision_reason = 'reference_only';
  delete previewV7.data_objects[0].fields;
  previewV7.forms.forEach(currentForm => currentForm.areas.forEach(area => area.items.forEach(item => {
    delete item.data_field_ref;
    delete item.value_usage_mode;
  })));
  assert.equal(Migration.needsDataFieldUpgrade(previewV7), true);
  const upgradedPreview = Migration.migrateDocument(previewV7)[0];
  assert.equal(upgradedPreview.data_objects[0].lifecycle.applicability, 'not_applicable');
  assert.equal(upgradedPreview.data_objects[0].lifecycle.decision_reason, 'reference_only');
  assert.equal(upgradedPreview.data_objects[0].fields.length, 1);
  assertValid(upgradedPreview, 'preview v7 migration');

  const brokenRef = JSON.parse(JSON.stringify(reused));
  brokenRef.forms[0].areas[0].items[0].data_field_ref = 'data_field_missing';
  const brokenRefResult = processGovernanceValidationResult(brokenRef);
  assert.equal(brokenRefResult.valid, false);
  assert.ok(brokenRefResult.errors.some(error => error.path.endsWith('/data_field_ref')));

  const typeMismatch = JSON.parse(JSON.stringify(reused));
  typeMismatch.forms[0].areas[0].items[0].item_type = '日期';
  const typeMismatchResult = processGovernanceValidationResult(typeMismatch);
  assert.equal(typeMismatchResult.valid, false);
  assert.ok(typeMismatchResult.errors.some(error => error.path.endsWith('/item_type')));
}

run();
console.log('process-governance-v7 data field reuse tests passed');
