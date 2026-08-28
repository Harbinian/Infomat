const assert = require('assert');
const {
  COMPLETE_DETAIL_STATUSES,
  RULE_VERSION,
  addBusinessDays,
  buildGovernanceCandidates,
  buildSourceIndex,
  riskFromDocument
} = require('../server/processDataGovernance');
const {
  assertProcessDataGovernanceEnabled,
  assertProcessVersionAllowed,
  configuredProcessVersionId,
  featureStatus,
  isProcessDataGovernanceEnabled,
  isProcessVersionAllowed
} = require('../server/processDataGovernanceScope');

function sampleDocument() {
  return {
    schema_version: 'process-governance-v7',
    process: { process_ref: 'process_test', process_name: '测试流程' },
    behaviors: [
      { behavior_ref: 'behavior_create', behavior_name: '创建记录' },
      { behavior_ref: 'behavior_use', behavior_name: '使用记录' }
    ],
    data_objects: [{
      data_ref: 'data_test',
      data_name: '测试记录',
      description: '用于测试确定性候选。',
      information_type: 'identifier',
      fields: [{ field_ref: 'field_code', field_name: '编号', field_type: '文本', definition: '唯一编号' }],
      behavior_links: [
        { link_ref: 'link_create', behavior_ref: 'behavior_create', operation: 'create' },
        { link_ref: 'link_use', behavior_ref: 'behavior_use', operation: 'use' }
      ],
      source_relations: [],
      lifecycle: {
        routes: [{
          route_ref: 'route_default',
          route_label: '默认路径',
          events: [{
            event_ref: 'event_destroy',
            action: 'destroy',
            target_scope: 'all_records',
            high_risk: true,
            trigger: { mode: 'business_condition' },
            responsibility: { mode: 'explicit', department: '质量管理部' },
            exception_handling: '存在争议时停止。'
          }]
        }]
      }
    }]
  };
}

const first = buildGovernanceCandidates(sampleDocument());
const second = buildGovernanceCandidates(sampleDocument());
assert.deepStrictEqual(first, second, 'candidate generation must be deterministic');
assert.strictEqual(first.filter(item => item.detail_type === 'data_object_identity').length, 1);
assert.strictEqual(first.filter(item => item.detail_type === 'critical_field').length, 1);
assert.strictEqual(first.filter(item => item.detail_type === 'data_flow').length, 2);
assert.strictEqual(first.filter(item => item.detail_type === 'lifecycle_rule').length, 1);
assert.ok(first.every(item => JSON.stringify(item.candidate).includes('pending_confirmation')), 'every candidate must remain pending');
assert.ok(!JSON.stringify(first).includes('automatic_confirm'), 'candidate payload must not imply automatic confirmation');
const destroyCandidate = first.find(item => item.source_ref === 'event_destroy');
assert.strictEqual(destroyCandidate.high_risk, true);
assert.strictEqual(destroyCandidate.rule_code, 'V7_LIFECYCLE_HIGH_RISK_EVENT');
assert.ok(destroyCandidate.candidate.high_risk_reason_codes.includes('irreversible_action'));

const sourceIndex = buildSourceIndex(sampleDocument());
assert.strictEqual(sourceIndex.get('object:data_test').data_name, '测试记录');
assert.strictEqual(sourceIndex.get('field:data_test:field_code').field_name, '编号');
assert.deepStrictEqual(sourceIndex.get('flow:data_test:link_create').operations, ['create']);
assert.deepStrictEqual(sourceIndex.get('flow:data_test:link_use').operations, ['use']);
assert.strictEqual(sourceIndex.get('lifecycle:data_test:event_destroy').action, 'destroy');

const risk = riskFromDocument(sampleDocument());
assert.strictEqual(risk.risk_level, 'high');
assert.strictEqual(risk.high_risk_detail_count, 1);
assert.strictEqual(RULE_VERSION, 'process-data-governance-rules-v1-2026-08-27');
assert.ok(COMPLETE_DETAIL_STATUSES.has('confirmed'));
assert.ok(!COMPLETE_DETAIL_STATUSES.has('pending'));

const ordinaryObject = buildGovernanceCandidates({
  schema_version: 'process-governance-v7',
  process: { process_ref: 'ordinary_process' },
  data_objects: [{
    data_ref: 'ordinary_data',
    data_name: '普通业务信息',
    information_type: 'business_information',
    fields: [{ field_ref: 'ordinary_field', field_name: '说明', field_type: '文本', definition: '业务说明' }],
    behavior_links: [],
    source_relations: [],
    lifecycle: { routes: [] }
  }]
});
assert.ok(ordinaryObject.some(item => item.detail_ref === 'field:ordinary_data:ordinary_field'), 'every declared field needs an MDM critical-field decision');
assert.ok(ordinaryObject.some(item => item.rule_code === 'V7_NO_DATA_BEHAVIOR_LINK'), 'missing data-flow scope must remain an explicit MDM decision');
assert.ok(ordinaryObject.some(item => item.rule_code === 'V7_NO_LIFECYCLE_EVENT'), 'missing lifecycle scope must remain an explicit MDM decision');

const missingFieldScope = buildGovernanceCandidates({
  schema_version: 'process-governance-v7',
  process: { process_ref: 'missing_field_process' },
  data_objects: [{
    data_ref: 'missing_field_data', data_name: '无字段对象', information_type: 'business_information',
    fields: [], behavior_links: [], source_relations: [], lifecycle: { routes: [] }
  }]
});
assert.ok(missingFieldScope.some(item => item.rule_code === 'V7_NO_DECLARED_FIELD'), 'an empty field list must not bypass MDM review');

const empty = buildGovernanceCandidates({ schema_version: 'process-governance-v7', process: { process_ref: 'empty_process' }, data_objects: [] });
assert.strictEqual(empty.length, 1, 'an empty source still needs an explicit MDM scope decision');
assert.strictEqual(empty[0].rule_code, 'V7_NO_DATA_OBJECT_SCOPE');

const friday = new Date('2026-08-28T00:00:00.000Z');
assert.strictEqual(addBusinessDays(friday, 1).toISOString().slice(0, 10), '2026-08-31');
assert.strictEqual(addBusinessDays(friday, 5).toISOString().slice(0, 10), '2026-09-04');

const disabledEnv = {};
assert.strictEqual(isProcessDataGovernanceEnabled(disabledEnv), false);
assert.strictEqual(configuredProcessVersionId(disabledEnv), null);
assert.throws(() => assertProcessDataGovernanceEnabled(disabledEnv), error => error.code === 'PROCESS_DATA_GOVERNANCE_DISABLED');
const enabledEnv = {
  PROCESS_DATA_GOVERNANCE_ENABLED: '1',
  PROCESS_DATA_GOVERNANCE_TRIAL_PROCESS_VERSION_ID: '77'
};
assert.strictEqual(isProcessDataGovernanceEnabled(enabledEnv), true);
assert.strictEqual(configuredProcessVersionId(enabledEnv), 77);
assert.strictEqual(isProcessVersionAllowed(77, enabledEnv), true);
assert.strictEqual(isProcessVersionAllowed(78, enabledEnv), false);
assert.strictEqual(assertProcessVersionAllowed(77, enabledEnv), 77);
assert.throws(() => assertProcessVersionAllowed(78, enabledEnv), error => error.code === 'PROCESS_DATA_GOVERNANCE_SCOPE_DENIED');
assert.strictEqual(featureStatus(enabledEnv).scope_mode, 'exact_process_version_id');

console.log('Process data governance deterministic rule tests passed');
