const assert = require('node:assert/strict');
const {
  createEmptyProcessGovernanceV6Document,
  processGovernanceValidationResult
} = require('../server');
const Migration = require('../public/process-governance-migration.js');
const LifecycleAnalyzer = require('../public/lifecycle-analyzer.js');
const { createProcessVersionFixture } = require('./process-version-fixtures');

function behavior(ref, name, description = '') {
  return {
    behavior_ref: ref,
    node_type: 'action',
    behavior_name: name,
    behavior_description: description,
    current_actor_role: '财务部会计员',
    actor_assignment_mode: 'fixed_department',
    actor_department_data_ref: null,
    actor_position_rule: '',
    trigger: '',
    precondition: '',
    input_description: '',
    timing: null,
    completion_standard: '',
    output_description: '',
    countersign_all_required: false,
    countersign_target_departments: []
  };
}

function v6Sample() {
  const documentValue = createEmptyProcessGovernanceV6Document();
  documentValue.export_meta.package_ref = 'package_v7_test';
  documentValue.export_meta.exported_at = '2026-08-21T00:00:00.000Z';
  documentValue.process.process_ref = 'process_supplier';
  documentValue.process.process_name = '供应商状态维护流程';
  documentValue.process.owning_department = '财务部';
  documentValue.behaviors = [
    behavior('behavior_create', '建立供应商'),
    behavior('behavior_deactivate', '停用'),
    behavior('behavior_destroy', '资料处置', '保管期限届满后销毁纸质材料。')
  ];
  documentValue.flow_relations = [
    {
      relation_ref: 'relation_create_deactivate',
      relation_type: 'sequence',
      from_behavior_ref: 'behavior_create',
      to_behavior_ref: 'behavior_deactivate',
      condition: ''
    },
    {
      relation_ref: 'relation_deactivate_destroy',
      relation_type: 'condition',
      from_behavior_ref: 'behavior_deactivate',
      to_behavior_ref: 'behavior_destroy',
      condition: '保管期限届满'
    }
  ];
  documentValue.data_objects = [{
    data_ref: 'data_supplier',
    data_name: '供应商',
    description: '具有唯一编码并在多个办理环节复用的供应商记录',
    information_type: 'identifier',
    behavior_links: [
      { link_ref: 'data_link_supplier_create', behavior_ref: 'behavior_create', operation: 'create' },
      { link_ref: 'data_link_supplier_deactivate', behavior_ref: 'behavior_deactivate', operation: 'update' },
      { link_ref: 'data_link_supplier_destroy', behavior_ref: 'behavior_destroy', operation: 'update' }
    ],
    source_relations: []
  }];
  return documentValue;
}

function validate(documentValue) {
  const result = processGovernanceValidationResult(documentValue);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
}

function testMigration() {
  for (const version of [
    'process-governance-v1',
    'process-governance-v2',
    'process-governance-v3',
    'process-governance-v4',
    'process-governance-v5',
    'process-governance-v6'
  ]) {
    const source = createProcessVersionFixture(version);
    validate(source);
    const snapshot = JSON.parse(JSON.stringify(source));
    const first = Migration.migrateDocument(source)[0];
    const second = Migration.migrateDocument(source)[0];
    assert.deepEqual(source, snapshot, `${version} migration must not modify the source object`);
    assert.deepEqual(first, second, `${version} migration must be deterministic`);
    assert.equal(first.schema_version, 'process-governance-v7');
    assert.equal(first.data_objects[0].lifecycle.applicability, 'pending_confirmation');
    assert.equal(first.data_objects[0].lifecycle.routes.length, 0);
    assert.equal(first.data_objects[0].lifecycle.analysis.status, 'not_analyzed');
    validate(first);
  }

  const source = v6Sample();
  const snapshot = JSON.parse(JSON.stringify(source));
  assert.throws(
    () => Migration.migrateDocument(source, { validateTarget: () => ({ valid: false, errors: [{ message: '模拟失败' }] }) }),
    /迁移后未通过v7检查/
  );
  assert.deepEqual(source, snapshot, 'failed migration must leave the source object unchanged');
}

function testAnalyzerAndRoundTrip() {
  const v7 = Migration.migrateDocument(v6Sample())[0];
  const first = LifecycleAnalyzer.analyzeDataObject(v7, 'data_supplier');
  const second = LifecycleAnalyzer.analyzeDataObject(v7, 'data_supplier');
  assert.deepEqual(first, second, 'same source and analyzer version must produce the same result');
  assert.equal(first.master_data_hint.type, 'later_recognition');
  const events = first.lifecycle.routes.flatMap(route => route.events);
  assert.ok(events.some(event => event.action === 'deactivate'));
  assert.equal(events.filter(event => event.action === 'deactivate').length, 1, 'one behavior action must not create one candidate per text field');
  assert.equal(events.filter(event => event.action === 'destroy').length, 1, 'high-risk action must be consolidated before user review');
  const destroy = events.find(event => event.action === 'destroy');
  assert.ok(destroy, 'destroy suggestion must be detected');
  assert.equal(destroy.high_risk, true);
  assert.equal(destroy.review_status, 'pending_confirmation');
  assert.ok(first.lifecycle.routes.some(route => route.flow_relation_refs.includes('relation_deactivate_destroy')));

  v7.data_objects[0].lifecycle = first.lifecycle;
  const deactivate = v7.data_objects[0].lifecycle.routes.flatMap(route => route.events).find(event => event.action === 'deactivate');
  deactivate.review_status = 'confirmed';
  deactivate.decision_notes = '业务部门已核对停用事实';
  destroy.review_status = 'rejected';
  destroy.decision_reason = 'semantic_mismatch';
  destroy.decision_notes = '材料销毁不是供应商对象销毁';
  const unchanged = LifecycleAnalyzer.analyzeDataObject(v7, 'data_supplier');
  assert.equal(unchanged.lifecycle.routes.flatMap(route => route.events).find(event => event.event_ref === deactivate.event_ref).review_status, 'confirmed');
  assert.equal(unchanged.lifecycle.routes.flatMap(route => route.events).find(event => event.event_ref === destroy.event_ref).review_status, 'rejected');

  v7.data_objects[0].lifecycle = unchanged.lifecycle;
  v7.behaviors.find(item => item.behavior_ref === 'behavior_deactivate').behavior_description = '来源内容发生变化';
  const changed = LifecycleAnalyzer.analyzeDataObject(v7, 'data_supplier');
  const changedConfirmed = changed.lifecycle.routes.flatMap(route => route.events).find(event => event.event_ref === deactivate.event_ref);
  const retainedRejected = changed.lifecycle.routes.flatMap(route => route.events).find(event => event.event_ref === destroy.event_ref);
  assert.equal(changedConfirmed.review_status, 'needs_recheck');
  assert.equal(changedConfirmed.decision_notes, '业务部门已核对停用事实');
  assert.equal(retainedRejected.review_status, 'rejected');
  assert.equal(retainedRejected.decision_reason, 'semantic_mismatch');

  v7.data_objects[0].lifecycle = changed.lifecycle;
  validate(v7);
  const roundTrip = JSON.parse(`${JSON.stringify(v7, null, 2)}\n`);
  assert.deepEqual(roundTrip, v7, 'v7 lifecycle facts and decisions must survive JSON round trip');
}

function testActionMatrix() {
  const actionCases = [
    ['activate', '生效', 'business_validity', 'effective'],
    ['deactivate', '停用', 'business_validity', 'deactivated'],
    ['reactivate', '重新启用', 'business_validity', 'effective'],
    ['void', '作废', 'business_validity', 'voided'],
    ['expire', '失效', 'business_validity', 'expired'],
    ['archive', '归档', 'custody', 'archived'],
    ['restore_active_custody', '恢复在用保管', 'custody', 'active_custody'],
    ['destroy', '销毁', 'custody', 'destroyed'],
    ['irreversible_anonymize', '不可逆匿名化', 'identifiability', 'irreversibly_anonymized']
  ];
  const v7 = Migration.migrateDocument(v6Sample())[0];
  v7.behaviors = actionCases.map(([action, name]) => behavior(`behavior_${action}`, name));
  v7.flow_relations = [];
  v7.data_objects[0].behavior_links = actionCases.map(([action]) => ({
    link_ref: `data_link_${action}`,
    behavior_ref: `behavior_${action}`,
    operation: 'update'
  }));

  const analyzed = LifecycleAnalyzer.analyzeDataObject(v7, 'data_supplier');
  const events = analyzed.lifecycle.routes.flatMap(route => route.events);
  assert.equal(events.length, actionCases.length, 'each distinct lifecycle action must produce one consolidated event');
  actionCases.forEach(([action, , dimension, expected]) => {
    const event = events.find(item => item.action === action);
    assert.ok(event, `${action} must be detected`);
    assert.equal(event.result_state[dimension], expected, `${action} must update ${dimension}`);
    if (action !== 'irreversible_anonymize') {
      assert.equal(event.result_state.identifiability_applicability, 'not_applicable', `${action} must not ask ordinary users about identifiability`);
      assert.equal(event.result_state.identifiability, 'not_applicable', `${action} must keep identifiability outside the current process scope`);
      const route = analyzed.lifecycle.routes.find(item => item.events.some(candidate => candidate.event_ref === event.event_ref));
      assert.equal(route.exit_state.identifiability_applicability, 'not_applicable', `${action} route exit must not ask ordinary users about identifiability`);
    }
    if (['destroy', 'irreversible_anonymize'].includes(action)) {
      assert.equal(event.high_risk, true);
      assert.equal(event.review_status, 'pending_confirmation');
    }
  });
  v7.data_objects[0].lifecycle = analyzed.lifecycle;
  validate(v7);

  const contradictory = JSON.parse(JSON.stringify(v7));
  const deactivate = contradictory.data_objects[0].lifecycle.routes.flatMap(route => route.events).find(event => event.action === 'deactivate');
  deactivate.result_state.business_validity = 'effective';
  const contradictionResult = processGovernanceValidationResult(contradictory);
  assert.equal(contradictionResult.valid, false);
  assert.ok(contradictionResult.errors.some(error => error.path.includes('/result_state/business_validity')));
}

function testValidationGuards() {
  const v7 = Migration.migrateDocument(v6Sample())[0];
  v7.data_objects[0].lifecycle = LifecycleAnalyzer.analyzeDataObject(v7, 'data_supplier').lifecycle;
  validate(v7);

  const brokenRoute = JSON.parse(JSON.stringify(v7));
  brokenRoute.data_objects[0].lifecycle.routes[0].flow_relation_refs = ['relation_missing'];
  const brokenRouteResult = processGovernanceValidationResult(brokenRoute);
  assert.equal(brokenRouteResult.valid, false);
  assert.ok(brokenRouteResult.errors.some(error => /生命周期路径对应流程关系/.test(error.message)));

  const invalidHighRisk = JSON.parse(JSON.stringify(v7));
  const destroy = invalidHighRisk.data_objects[0].lifecycle.routes.flatMap(route => route.events).find(event => event.action === 'destroy');
  destroy.review_status = 'auto_generated';
  const invalidHighRiskResult = processGovernanceValidationResult(invalidHighRisk);
  assert.equal(invalidHighRiskResult.valid, false);
  assert.ok(invalidHighRiskResult.errors.some(error => error.path.includes('/review_status')));

  const formHint = LifecycleAnalyzer.classifyMasterDataHint(v7, {
    data_name: '供应商新增申请表',
    description: '用于一次供应商新增申请',
    information_type: 'business_information',
    behavior_links: [],
    source_relations: []
  });
  assert.equal(formHint.type, 'form_relationship');
}

testMigration();
testAnalyzerAndRoundTrip();
testActionMatrix();
testValidationGuards();
console.log('process-governance-v7 lifecycle tests passed');
