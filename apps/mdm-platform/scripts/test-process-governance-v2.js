const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  V2,
  V3,
  contentHash,
  normalizeProcessGovernanceDocument,
  previewProcessGovernanceDocument
} = require('../server/processGovernanceV2');

function createV1() {
  return {
    schema_version: 'process-governance-v1',
    export_meta: {
      package_ref: 'package_1',
      exported_at: '2026-07-31T00:00:00.000Z',
      initiating_department: '经营发展部',
      compiler: '测试编制人'
    },
    process: {
      process_ref: 'process_1',
      process_name: '月度绩效考核',
      owning_department: '经营发展部',
      purpose: '收集并评价月度绩效',
      scope: '公司各部门',
      capability_domain: '战略规划及经营指标治理',
      business_capability: '月度绩效考核管理',
      classification_status: 'confirmed'
    },
    reference_materials: [],
    behaviors: [
      {
        behavior_ref: 'behavior_1',
        node_type: 'action',
        behavior_name: '汇总绩效数据',
        current_actor_role: '经营发展部规划员',
        trigger: '月末',
        precondition: '',
        input_description: '绩效明细',
        timing: '月底',
        completion_standard: '汇总完成',
        output_description: '绩效结果',
        input_data_refs: ['data_1'],
        output_data_refs: ['data_2'],
        work_role: null,
        countersign_all_required: false,
        countersign_target_departments: []
      },
      {
        behavior_ref: 'behavior_2',
        node_type: 'action',
        behavior_name: '形成评价结果',
        current_actor_role: '经营发展部规划员',
        trigger: '汇总完成',
        precondition: '',
        input_description: '绩效结果',
        timing: '次月',
        completion_standard: '评价结果确认',
        output_description: '反馈结果',
        input_data_refs: ['data_2'],
        output_data_refs: [],
        work_role: null,
        countersign_all_required: false,
        countersign_target_departments: []
      }
    ],
    flow_relations: [],
    data_objects: [
      {
        data_ref: 'data_1',
        data_name: '绩效明细',
        description: '各部门提交的绩效明细',
        governance_status: 'candidate',
        produced_by_behavior_ref: null,
        consumed_by_behavior_refs: ['behavior_1']
      },
      {
        data_ref: 'data_2',
        data_name: '反馈结果',
        description: '绩效评价反馈结果',
        governance_status: 'candidate',
        produced_by_behavior_ref: 'behavior_1',
        consumed_by_behavior_refs: ['behavior_2']
      }
    ],
    cross_department_handoffs: [
      {
        handoff_ref: 'handoff_1',
        source_department: '经营发展部',
        target_department: '项目管理部',
        send_behavior_ref: 'behavior_1',
        receive_behavior_ref: null,
        input_data_ref: 'data_1',
        returned_data_ref: 'data_2',
        requested_matter: '核对项目绩效数据',
        trigger_condition: '月末',
        completion_standard: '完成核对',
        target_process_ref: null,
        target_process_name: '',
        target_behavior_ref: null,
        target_behavior_name: '',
        return_behavior_ref: 'behavior_2'
      }
    ],
    internal_process_calls: [],
    forms: [],
    terms: []
  };
}

function main() {
  const source = createV1();
  const sourceBefore = JSON.stringify(source);
  const normalized = normalizeProcessGovernanceDocument(source);
  assert.deepStrictEqual(normalized.errors, []);
  assert.strictEqual(normalized.document.schema_version, V3);
  assert.strictEqual(normalized.document.cross_department_handoffs[0].handoff_direction, 'outbound_followup');
  assert.strictEqual(normalized.document.cross_department_handoffs[0].anchor_behavior_ref, 'behavior_1');
  assert.strictEqual(normalized.document.cross_department_handoffs[0].transfer_data_ref, 'data_1');
  assert.strictEqual(normalized.document.cross_department_handoffs[0].counterparty_process_name, '');
  assert.strictEqual(normalized.document.cross_department_handoffs[0].requires_return, true);
  assert.strictEqual(normalized.document.cross_department_handoffs[0].resume_behavior_ref, 'behavior_2');
  assert.ok(normalized.warnings.some(item => item.code === 'COUNTERPARTY_DETAIL_INCOMPLETE'));
  assert.strictEqual(JSON.stringify(source), sourceBefore, 'normalization must not modify the uploaded JSON');
  assert.strictEqual(normalized.content_hash, contentHash(normalized.document));

  const preview = previewProcessGovernanceDocument(source);
  assert.strictEqual(preview.summary.handoff_count, 1);
  assert.strictEqual(preview.handoff_candidates[0].anchor_behavior_name, '汇总绩效数据');
  assert.strictEqual(preview.handoff_candidates[0].transfer_data_name, '绩效明细');

  const unresolved = createV1();
  unresolved.schema_version = V2;
  unresolved.cross_department_handoffs = [{
    handoff_ref: 'handoff_inbound',
    handoff_direction: 'inbound_prerequisite',
    anchor_behavior_ref: 'behavior_1',
    counterparty_resolution: 'needs_identification',
    source_department: '',
    target_department: '经营发展部',
    transfer_data_ref: 'data_1',
    requested_matter: '',
    trigger_condition: '',
    completion_standard: '月底前提供',
    counterparty_process_ref: null,
    counterparty_process_name: '',
    counterparty_behavior_ref: null,
    counterparty_behavior_name: '',
    requires_return: false,
    returned_data_ref: null,
    resume_behavior_ref: null
  }];
  const unresolvedPreview = previewProcessGovernanceDocument(unresolved);
  assert.deepStrictEqual(unresolvedPreview.errors, []);
  assert.ok(unresolvedPreview.warnings.some(item => item.code === 'COUNTERPARTY_NEEDS_IDENTIFICATION'));

  const invalid = createV1();
  invalid.cross_department_handoffs[0].send_behavior_ref = 'missing_behavior';
  const invalidResult = normalizeProcessGovernanceDocument(invalid);
  assert.ok(invalidResult.errors.some(item => item.field.endsWith('anchor_behavior_ref')));

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/contracts/process-governance-v2.schema.json'), 'utf8'));
  assert.strictEqual(schema.properties.schema_version.const, V2);
  console.log('Process governance v2 normalization tests passed');
}

main();
