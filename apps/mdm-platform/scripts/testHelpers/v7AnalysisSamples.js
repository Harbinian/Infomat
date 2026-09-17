// Synthetic documents only; no original business materials.
const { createEmptyProcessGovernanceV7Document } = require('../../../structured-output-service/server');
function node(ref, type = 'action') {
  return { behavior_ref: ref, node_type: type, behavior_name: '合成行为', behavior_description: '', current_actor_role: '合成甲部经办人', actor_assignment_mode: 'fixed_department', actor_department_data_ref: null, actor_position_rule: '', trigger: '', precondition: '', input_description: '', timing: null, completion_standard: '', output_description: '', countersign_all_required: false, countersign_target_departments: [] };
}
function edge(ref, from, to, type = 'sequence', condition = '') { return { relation_ref: ref, relation_type: type, from_behavior_ref: from, to_behavior_ref: to, condition }; }
function document() {
  const d = createEmptyProcessGovernanceV7Document();
  d.export_meta.package_ref = 'package_p11'; d.process.process_ref = 'process_p11'; d.process.process_name = 'P11合成材料'; d.process.owning_department = '合成甲部';
  d.behaviors = [node('behavior_a'), node('behavior_b')];
  d.flow_relations = [edge('relation_ab', 'behavior_a', 'behavior_b')];
  return d;
}
function binding() {
  const d = document();
  d.data_objects = ['a', 'b'].map(k => ({ data_ref: 'data_' + k, data_name: '合成对象', description: '', information_type: 'business_conclusion',
    fields: [{ field_ref: 'field_' + k, field_name: '编号', field_type: '文本', definition: '' }], behavior_links: [], source_relations: [],
    lifecycle: { applicability: 'pending_confirmation', entry_state: { business_validity: 'pending_confirmation', custody: 'pending_confirmation', identifiability_applicability: 'pending_confirmation', identifiability: 'pending_confirmation' }, routes: [], analysis: { analyzer_version: '', source_fingerprint: '', status: 'not_analyzed' }, decision_reason: '', decision_notes: '' } }));
  d.forms = [{ form_ref: 'form_a', form_name: '合成表单', form_no: null, form_design_state: 'unspecified', behavior_links: [],
    areas: [{ area_ref: 'area_a', area_type: '基本信息', area_title: '', items: [{ item_ref: 'item_a', item_name: '编号', item_type: '文本', required: false, instructions: '', business_data_ref: 'data_a', data_field_ref: 'field_a', value_usage_mode: 'pending_confirmation', value_origin_mode: 'pending_confirmation', source_links: [] }] }] }];
  return d;
}
module.exports = { node, edge, document, binding };
