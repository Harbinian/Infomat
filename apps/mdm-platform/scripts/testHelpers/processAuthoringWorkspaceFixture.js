// Synthetic, complete V9 source for owned MySQL/HTTP/browser candidate checks.
function document() {
  const d = require('./processCaseGovernanceFixture').document();
  d.schema_version = 'process-governance-v9'; d.migration.source_schema_version = d.schema_version;
  Object.assign(d.export_meta, { package_ref: 'synthetic_authoring_package', initiating_department: '合成甲部', compiler: '合成编制人员' });
  Object.assign(d.process, { process_ref: 'synthetic_authoring_process', process_name: '合成材料核对流程', owning_department: '合成甲部',
    purpose: '填写合成记录后由另一个部门核对结果。', scope: '仅用于隔离技术回归。', entry_behavior_refs: ['behavior_create'] });
  d.behaviors = ['create','review'].map((name, index) => ({
    behavior_ref: 'behavior_' + name, node_type: 'action', behavior_name: index ? '合成核对人员核对合成记录' : '合成经办人员填写合成记录',
    behavior_description: index ? '核对合成记录中的结论并记录核对结果。' : '填写合成记录中的结论并提交记录。', current_actor_role: (index ? '合成乙部' : '合成甲部') + '经办人',
    actor_assignment_mode: 'fixed_department', actor_department_data_ref: null, actor_position_rule: '', trigger: '收到明确的合成材料', precondition: '',
    input_description: '合成材料', timing: null, completion_standard: '合成记录已填写并核对。', output_description: '合成记录',
    countersign_all_required: false, countersign_target_departments: []
  }));
  d.flow_relations = [{ relation_ref: 'relation_create_review', from_behavior_ref: 'behavior_create', to_behavior_ref: 'behavior_review', relation_type: 'sequence', condition: '' }];
  d.data_objects = [{ data_ref: 'data_synthetic', data_name: '合成记录', description: '每次接收一条明确的合成记录，填写后核对。', information_type: 'business_conclusion',
    record_model: 'record_collection', collection_field_refs: ['field_result'], fields: [{ field_ref: 'field_result', field_name: '核对结论', field_type: '文本', definition: '填写并核对的合成结论。' }],
    behavior_links: [
      { link_ref: 'link_create', behavior_ref: 'behavior_create', operation: 'create', updated_field_refs: [], record_scope: 'new_instance', presence: 'required' },
      { link_ref: 'link_review', behavior_ref: 'behavior_review', operation: 'use', updated_field_refs: [], record_scope: 'current_instance', presence: 'required' }
    ], source_relations: [], lifecycle: { applicability: 'not_applicable', entry_state: { business_validity: 'effective', custody: 'active_custody', identifiability_applicability: 'not_applicable', identifiability: 'not_applicable' },
      routes: [], analysis: { analyzer_version: '', source_fingerprint: '', status: 'not_analyzed' }, decision_reason: 'no_lifecycle_in_current_process',
      decision_notes: '合成流程只填写及核对记录，不另行改变其有效性、保管或可识别状态。' } }];
  d.forms = [{ form_ref: 'form_synthetic', form_name: '合成记录表', form_no: 'SYN-FORM', form_design_state: 'current_state',
    behavior_links: [
      { link_ref: 'form_link_create', behavior_ref: 'behavior_create', operations: ['fill'], notes: '填写合成结论' },
      { link_ref: 'form_link_review', behavior_ref: 'behavior_review', operations: ['review'], notes: '核对填写结果' }
    ], areas: [{ area_ref: 'area_synthetic', area_type: '基本信息', area_title: '合成信息', items: [{ item_ref: 'item_result', item_name: '核对结论', item_type: '文本', required: true,
      instructions: '填写真实合成结论', business_data_ref: 'data_synthetic', data_field_ref: 'field_result', value_usage_mode: 'reuse_existing', value_origin_mode: 'depends_on_data',
      source_links: [{ source_link_ref: 'form_source_result', source_type: 'process_data', source_data_ref: 'data_synthetic', source_role: 'provides_value', source_system_name: '', source_data_name: '合成记录' }] }] }] }];
  return d;
}
module.exports = { document };
