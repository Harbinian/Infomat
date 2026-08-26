const assert = require('node:assert/strict');
const {
  createEmptyProcessGovernanceV5Document,
  createEmptyProcessGovernanceV6Document,
  createEmptyProcessGovernanceV7Document,
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
  const blankV7 = createEmptyProcessGovernanceV7Document();
  const blankV7Snapshot = JSON.parse(JSON.stringify(blankV7));
  const blankV7RoundTrip = Migration.migrateDocument(blankV7)[0];
  assertValid(blankV7, 'blank v7 template');
  assert.deepEqual(
    blankV7RoundTrip,
    blankV7Snapshot,
    'a valid blank v7 template must survive the download preflight migration without any change'
  );
  assert.equal(
    JSON.stringify(blankV7RoundTrip),
    JSON.stringify(blankV7Snapshot),
    'a valid blank v7 template must pass the exact download round-trip comparison'
  );
  assert.deepEqual(blankV7, blankV7Snapshot, 'blank v7 migration must not modify the source template');

  const legacyWithoutMigration = createEmptyProcessGovernanceV5Document();
  assert.equal(
    Migration.migrateDocument(legacyWithoutMigration)[0].migration.source_process_ref,
    legacyWithoutMigration.process.process_ref,
    'a supported legacy document without migration metadata must retain the source-process fallback'
  );

  const source = v6Fixture();
  const snapshot = JSON.parse(JSON.stringify(source));
  const migrated = Migration.migrateDocument(source)[0];
  assert.deepEqual(source, snapshot, 'v6 source must remain unchanged');
  assert.equal(migrated.migration.source_process_ref, null, 'a native v6 source with no earlier process must preserve null provenance');
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
  const previewV7Snapshot = JSON.parse(JSON.stringify(previewV7));
  assert.equal(Migration.needsDataFieldUpgrade(previewV7), true);
  const upgradedPreview = Migration.migrateDocument(previewV7)[0];
  assert.deepEqual(previewV7, previewV7Snapshot, 'early v7 migration must not modify the selected source file');
  assert.equal(upgradedPreview.data_objects[0].lifecycle.applicability, 'not_applicable');
  assert.equal(upgradedPreview.data_objects[0].lifecycle.decision_reason, 'reference_only');
  assert.equal(upgradedPreview.data_objects[0].fields.length, 1);
  assertValid(upgradedPreview, 'preview v7 migration');
  const upgradedPreviewRoundTrip = JSON.parse(JSON.stringify(upgradedPreview));
  assert.deepEqual(
    Migration.migrateDocument(upgradedPreviewRoundTrip)[0],
    upgradedPreview,
    'early v7 migration must survive export, re-import and repeated migration without further changes'
  );

  const updateFieldPreview = JSON.parse(JSON.stringify(reused));
  updateFieldPreview.behaviors.push({
    behavior_ref: 'behavior_update_supplier',
    node_type: 'action',
    behavior_name: '更新供应商信息',
    behavior_description: '',
    current_actor_role: '财务部会计员',
    actor_assignment_mode: 'legacy_unresolved',
    actor_department_data_ref: null,
    actor_position_rule: '',
    trigger: '',
    precondition: '',
    input_description: '',
    timing: null,
    system_or_tool: '',
    action: '更新供应商信息',
    object: '供应商',
    decision_rule: '',
    exception_flow: '',
    output: '供应商信息',
    system_mapping: '',
    remarks: '',
    evidence_refs: [],
    countersign_all_required: false,
    countersign_target_departments: []
  });
  updateFieldPreview.data_objects[0].behavior_links.push({
    link_ref: 'data_link_update_supplier',
    behavior_ref: 'behavior_update_supplier',
    operation: 'update'
  });
  const updateFieldSnapshot = JSON.parse(JSON.stringify(updateFieldPreview));
  assert.equal(Migration.needsDataFieldUpgrade(updateFieldPreview), true);
  const normalizedUpdateField = Migration.migrateDocument(updateFieldPreview)[0];
  assert.deepEqual(updateFieldPreview, updateFieldSnapshot, 'current v7 source must remain unchanged during update-field normalization');
  assert.deepEqual(normalizedUpdateField.data_objects[0].behavior_links.at(-1).updated_field_refs, []);
  normalizedUpdateField.data_objects[0].behavior_links.at(-1).updated_field_refs = [normalizedUpdateField.data_objects[0].fields[0].field_ref];
  assert.deepEqual(Migration.migrateDocument(normalizedUpdateField)[0], normalizedUpdateField, 'selected update fields must survive idempotent migration');
  assertValid(normalizedUpdateField, 'selected update field validation');

  const duplicateUpdateField = JSON.parse(JSON.stringify(normalizedUpdateField));
  const keptField = duplicateUpdateField.data_objects[0].fields[0];
  duplicateUpdateField.data_objects[0].fields.push({
    ...keptField,
    field_ref: 'data_field_supplier_code_duplicate'
  });
  duplicateUpdateField.data_objects[0].behavior_links.at(-1).updated_field_refs = ['data_field_supplier_code_duplicate'];
  const mergedUpdateField = Migration.migrateDocument(duplicateUpdateField)[0];
  assert.equal(mergedUpdateField.data_objects[0].fields.length, 1, 'same-name and same-type object fields must merge deterministically');
  assert.deepEqual(
    mergedUpdateField.data_objects[0].behavior_links.at(-1).updated_field_refs,
    [keptField.field_ref],
    'field merge must rewrite update-operation field references'
  );
  assertValid(mergedUpdateField, 'merged update field validation');

  const brokenUpdatedFieldRef = JSON.parse(JSON.stringify(normalizedUpdateField));
  brokenUpdatedFieldRef.data_objects[0].behavior_links.at(-1).updated_field_refs = ['data_field_missing'];
  const brokenUpdatedFieldResult = processGovernanceValidationResult(brokenUpdatedFieldRef);
  assert.equal(brokenUpdatedFieldResult.valid, false);
  assert.ok(brokenUpdatedFieldResult.errors.some(error => /更新字段/.test(error.message)));

  const mismatchedUpdateOperation = JSON.parse(JSON.stringify(normalizedUpdateField));
  mismatchedUpdateOperation.data_objects[0].behavior_links.at(-1).operation = 'use';
  const mismatchedUpdateResult = processGovernanceValidationResult(mismatchedUpdateOperation);
  assert.equal(mismatchedUpdateResult.valid, false);
  assert.ok(mismatchedUpdateResult.errors.some(error => /只有更新操作/.test(error.message)));

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
