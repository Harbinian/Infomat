// Creates explicitly fictional V8 graph data for local browser verification.
// Importing this module is read-only. Running it writes only the supplied output JSON file.
const fs = require('node:fs');
const path = require('node:path');
const Migration = require('../public/process-governance-migration');
const { createProcessVersionFixture } = require('./process-version-fixtures');

function createWorkbenchGraphFixture() {
  const document = Migration.migrateDocument(createProcessVersionFixture('process-governance-v6'))[0];
  const template = document.behaviors[0];
  const node = (ref, name, type = 'action', actor = '财务部测试岗位') => ({ ...structuredClone(template), behavior_ref: ref, behavior_name: name, node_type: type, current_actor_role: type.startsWith('parallel_') ? '' : actor, behavior_description: '虚构界面测试记录；不表示实际业务责任或执行。', trigger: '', precondition: '', timing: null, completion_standard: '仅用于图形与阅读验证', input_description: '', output_description: '' });
  document.export_meta.package_ref = 'package_workbench_graph_fixture';
  document.export_meta.compiler = '候选界面自动化测试';
  document.process.process_ref = 'process_workbench_graph_fixture';
  document.process.process_name = '虚构测试：判断分支与并行阅读';
  document.process.scope = '虚构测试数据；仅用于候选工作台图形、引用和阅读验证。';
  document.behaviors = [
    node('behavior_fixture_submit', '测试起点：提交资料'),
    node('graph_decision', '测试判断：资料是否完整', 'decision'),
    node('graph_split', '测试并行开始', 'parallel_split'),
    node('graph_finance', '测试分支甲：核对金额', 'action', '财务部测试岗位'),
    node('graph_quality', '测试分支乙：核对附件', 'action', '质量管理部测试岗位'),
    node('graph_join', '测试并行汇合', 'parallel_join'),
    node('graph_finish', '测试终点：汇总结果')
  ];
  const route = (ref, from, to, type = 'sequence', condition = '') => ({ relation_ref: ref, from_behavior_ref: from, to_behavior_ref: to, relation_type: type, condition });
  document.flow_relations = [
    route('graph_start_decision', 'behavior_fixture_submit', 'graph_decision'),
    route('graph_decision_split', 'graph_decision', 'graph_split', 'condition', '测试路线：资料完整'),
    route('graph_decision_return', 'graph_decision', 'behavior_fixture_submit', 'loop', '测试路线：资料待补充'),
    route('graph_split_finance', 'graph_split', 'graph_finance', 'parallel'),
    route('graph_split_quality', 'graph_split', 'graph_quality', 'parallel'),
    route('graph_finance_join', 'graph_finance', 'graph_join', 'parallel'),
    route('graph_quality_join', 'graph_quality', 'graph_join', 'parallel'),
    route('graph_join_finish', 'graph_join', 'graph_finish')
  ];
  const data = document.data_objects[0];
  data.data_name = '虚构测试资料';
  data.fields = [{ field_ref: 'graph_field_amount', field_name: '金额', field_type: '金额', definition: '虚构测试字段定义' }];
  data.behavior_links.push({ link_ref: 'graph_data_link_use', behavior_ref: 'graph_finance', operation: 'use', updated_field_refs: [] });
  document.forms = [{ form_ref: 'graph_form', form_name: '虚构测试表单', form_no: 'TEST-GRAPH', form_design_state: 'current_state', behavior_links: [{ link_ref: 'graph_form_link', behavior_ref: 'graph_quality', operations: ['review'], notes: '仅测试引用' }], areas: [{ area_ref: 'graph_area', area_type: '基本信息', area_title: '测试基本区', items: [{ item_ref: 'graph_item_amount', item_name: '显示金额', item_type: '金额', required: true, instructions: '仅测试输入', business_data_ref: data.data_ref, data_field_ref: 'graph_field_amount', value_usage_mode: 'reuse_existing', value_origin_mode: 'direct_current_process', source_links: [] }] }] }];
  document.terms = [{ term_ref: 'graph_term', term_name: '虚构测试术语', definition: '仅测试定义与空使用关系，不是业务术语。' }];
  return document;
}

if (require.main === module) {
  const output = process.argv[2];
  if (!output) throw new Error('Specify a local artifact output JSON path.');
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(createWorkbenchGraphFixture(), null, 2) + '\n', 'utf8');
  console.log(`Fictional graph fixture written: ${path.resolve(output)}`);
}
module.exports = { createWorkbenchGraphFixture };
