const { createProcessVersionFixture } = require('./process-version-fixtures');
const Migration = require('../public/process-governance-migration');

function createReviewLayoutFixture() {
  const data = Migration.migrateDocument(createProcessVersionFixture('process-governance-v6'))[0];
  data.process.process_name = '界面测试：费用申请与核对';
  data.process.scope = '虚构测试数据，仅用于候选界面验证';
  const submit = data.behaviors[0];
  const review = { ...structuredClone(submit), behavior_ref: 'behavior_review', behavior_name: '核对费用申请', behavior_description: '核对申请金额与附件，说明缺项并退回补充。', trigger: '', completion_standard: '核对结果已记录' };
  data.behaviors.push(review);
  data.flow_relations = [
    { relation_ref: 'flow_submit_review', relation_type: 'sequence', from_behavior_ref: submit.behavior_ref, to_behavior_ref: review.behavior_ref, condition: '' },
    { relation_ref: 'flow_return', relation_type: 'loop', from_behavior_ref: review.behavior_ref, to_behavior_ref: submit.behavior_ref, condition: '附件不完整时退回补充' }
  ];
  const object = data.data_objects[0];
  object.fields = [{ field_ref: 'field_amount', field_name: '申请金额', field_type: '金额', definition: '本次申请支付的金额' }];
  object.behavior_links.push({ link_ref: 'data_link_review', behavior_ref: review.behavior_ref, operation: 'use', updated_field_refs: [] });
  data.data_objects.push({ ...structuredClone(object), data_ref: 'data_unlinked', data_name: '待梳理报销类别', behavior_links: [], fields: [] });
  data.forms = [{
    form_ref: 'form_application', form_name: '费用申请单', form_no: 'TEST-001', form_design_state: 'current_state',
    behavior_links: [{ link_ref: 'form_link_review', behavior_ref: review.behavior_ref, operations: ['review'], notes: '核对申请' }],
    areas: [{ area_ref: 'area_main', area_type: '基本信息', area_title: '', items: [{
      item_ref: 'item_amount', item_name: '申请金额', item_type: '金额', required: true, instructions: '按实际申请金额填写',
      business_data_ref: object.data_ref, data_field_ref: 'field_amount', value_usage_mode: 'reuse_existing', value_origin_mode: 'direct_current_process', source_links: []
    }] }]
  }, { form_ref: 'form_unlinked', form_name: '待核对附件清单', form_no: null, form_design_state: 'current_state', behavior_links: [], areas: [] }];
  return data;
}

module.exports = { createReviewLayoutFixture };
