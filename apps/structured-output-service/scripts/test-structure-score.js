const assert = require('node:assert/strict');
const {
  RULE,
  evaluateContent,
  finalize,
  parallelStructureDetails,
  dataFlowConsistencyDetails,
  semanticProjection,
  stableStringify
} = require('../public/structure-score.js');

const departments = [
  '全公司',
  '公司领导',
  '工程技术部',
  '质量管理部',
  '财务部',
  '行政人事部',
  '经营发展部',
  '物资保障部',
  '项目管理部',
  '复材车间',
  '运维安环部'
];

function behavior(index, nodeType = 'action') {
  return {
    behavior_ref: `behavior-${index}`,
    node_type: nodeType,
    behavior_name: `业务行为${index}`,
    behavior_description: `执行第${index}项工作`,
    current_actor_role: '经营发展部部长',
    trigger: `触发条件${index}`,
    precondition: '',
    input_description: '',
    timing: null,
    completion_standard: `完成标准${index}`,
    output_description: `输出结果${index}`,
    input_data_refs: [],
    output_data_refs: [],
    work_role: null,
    countersign_all_required: false,
    countersign_target_departments: []
  };
}

function relation(index, from, to, relationType = 'sequence', condition = '') {
  return {
    relation_ref: `relation-${index}`,
    relation_type: relationType,
    from_behavior_ref: from,
    to_behavior_ref: to,
    condition,
    join_mode: ''
  };
}

function createDocument(behaviorCount = 5) {
  const behaviors = Array.from({ length: behaviorCount }, (_, index) => behavior(index + 1));
  const relations = [];
  for (let index = 1; index < behaviorCount; index += 1) {
    relations.push(relation(index, `behavior-${index}`, `behavior-${index + 1}`));
  }
  return {
    schema_version: 'process-governance-v3',
    export_meta: {
      package_ref: 'package-1',
      exported_at: '2026-07-31T00:00:00.000Z',
      initiating_department: '经营发展部',
      compiler: '测试人员'
    },
    process: {
      process_ref: 'process-1',
      process_name: '评分测试流程',
      owning_department: '经营发展部',
      purpose: '验证评分规则',
      scope: '适用于评分自动测试',
      capability_domain: null,
      business_capability: null,
      classification_status: 'unclassified'
    },
    reference_materials: [],
    behaviors,
    flow_relations: relations,
    data_objects: [{
      data_ref: 'data-1',
      data_name: '测试数据',
      description: '用于验证数据对象评分',
      governance_status: 'candidate',
      produced_by_behavior_ref: behaviorCount ? 'behavior-1' : null,
      consumed_by_behavior_refs: behaviorCount > 1 ? ['behavior-2'] : behaviorCount ? ['behavior-1'] : []
    }],
    cross_department_handoffs: [],
    internal_process_calls: [],
    forms: [{
      form_ref: 'form-1',
      form_name: '评分测试表',
      form_no: null,
      form_design_state: 'current_state',
      related_behavior_refs: behaviorCount ? ['behavior-1'] : [],
      areas: [{
        area_ref: 'area-1',
        area_type: '基本信息',
        area_title: '主表',
        items: [{
          item_ref: 'item-1',
          item_name: '测试字段',
          item_type: '文本',
          required: true,
          instructions: ''
        }]
      }]
    }],
    terms: []
  };
}

function content(documentValue) {
  return evaluateContent(documentValue, { departments });
}

function passingTechnical() {
  return {
    status: 'ready',
    checks: {
      parse: true,
      compatibility: true,
      validation: true,
      roundTrip: true,
      preservation: true
    },
    errors: []
  };
}

assert.equal(RULE.label, '结构化学习评分 v1（试行）');
assert.equal(
  RULE.dimensions.reduce((sum, item) => sum + item.max, 0),
  100,
  'dimension weights must total 100'
);
assert.equal(
  RULE.technicalChecks.reduce((sum, item) => sum + item.points, 0),
  15,
  'technical checks must total 15'
);

const perfectDocument = createDocument(5);
const perfectBeforeScore = JSON.stringify(perfectDocument);
const perfectResult = finalize(content(perfectDocument), passingTechnical());
assert.equal(JSON.stringify(perfectDocument), perfectBeforeScore, 'scoring must not mutate the source document');
assert.deepEqual(perfectResult.dimensions, {
  technical: 15,
  basic: 10,
  behavior: 25,
  relation: 20,
  dataHandoff: 20,
  form: 10
});
assert.equal(perfectResult.completenessScore, 100);
assert.equal(perfectResult.effectiveChainLength, 5);
assert.equal(perfectResult.chainCoefficient, 1);
assert.equal(perfectResult.displayScore, 100);
assert.equal(perfectResult.grade, 'A');
assert.equal(perfectResult.blocker, false);

const formStatePendingDocument = createDocument(5);
formStatePendingDocument.forms[0].form_design_state = 'unspecified';
const formStatePendingResult = content(formStatePendingDocument);
assert.ok(formStatePendingResult.dimensions.form < 10);
assert.equal(
  formStatePendingResult.issues.find(item => item.message.includes('表单状态待确认')).focusPath,
  'forms.0.form_design_state'
);

const multipleDetailDocument = createDocument(5);
multipleDetailDocument.forms[0].areas.push({
  area_ref: 'area-detail-1',
  area_type: '明细清单',
  area_title: '物料明细',
  items: [{ item_ref: 'item-detail-1', item_name: '物料编码', item_type: '文本', required: true, instructions: '' }]
}, {
  area_ref: 'area-detail-2',
  area_type: '明细清单',
  area_title: '费用明细',
  items: [{ item_ref: 'item-detail-2', item_name: '金额', item_type: '金额', required: false, instructions: '' }]
});
assert.equal(content(multipleDetailDocument).dimensions.form, 10, 'multiple named detail tables must not lose points');
multipleDetailDocument.forms[0].areas[2].area_title = '';
assert.ok(content(multipleDetailDocument).dimensions.form < 10, 'unnamed detail tables must lose only distinction points');

const unassignedFieldDocument = createDocument(5);
unassignedFieldDocument.forms[0].areas.push({
  area_ref: 'area-unassigned',
  area_type: '',
  area_title: '',
  items: [{ item_ref: 'item-unassigned', item_name: '归属待确认字段', item_type: '文本', required: false, instructions: '' }]
});
const unassignedFieldResult = content(unassignedFieldDocument);
assert.ok(unassignedFieldResult.dimensions.form < 10);
assert.equal(
  unassignedFieldResult.issues.find(item => item.message.includes('归属待确认')).focusPath,
  'forms.0.areas.1.items.0.assignment'
);

const expectedCoefficients = new Map([[0, 0.8], [1, 0.8], [2, 0.85], [3, 0.9], [4, 0.95], [5, 1]]);
expectedCoefficients.forEach((coefficient, behaviorCount) => {
  const documentValue = createDocument(behaviorCount);
  if (!behaviorCount) {
    documentValue.data_objects = [];
    documentValue.forms = [];
  }
  const result = content(documentValue);
  assert.equal(result.effectiveChainLength, behaviorCount, `chain length for ${behaviorCount} behaviors`);
  assert.equal(result.chainCoefficient, coefficient, `chain coefficient for ${behaviorCount} behaviors`);
});

const loopDocument = createDocument(3);
loopDocument.flow_relations.push(relation(3, 'behavior-3', 'behavior-1', 'loop', '需要重新处理'));
const loopResult = content(loopDocument);
assert.equal(loopResult.effectiveChainLength, 3, 'explicit loop edges must not lengthen the main chain');
assert.equal(loopResult.dimensions.relation, 20);

const cycleDocument = createDocument(3);
cycleDocument.flow_relations = [
  relation(1, 'behavior-1', 'behavior-2'),
  relation(2, 'behavior-2', 'behavior-1'),
  relation(3, 'behavior-2', 'behavior-3')
];
const cycleResult = content(cycleDocument);
assert.equal(cycleResult.effectiveChainLength, 3, 'nodes in a non-loop cycle are counted once');

const isolatedDocument = createDocument(3);
isolatedDocument.flow_relations = [relation(1, 'behavior-1', 'behavior-2')];
const isolatedResult = content(isolatedDocument);
assert.equal(isolatedResult.effectiveChainLength, 2);
assert.equal(
  isolatedResult.issues.some(item => item.message === '业务行为3未进入任何有效流程关系'),
  true
);

const defaultSequenceDocument = createDocument(3);
defaultSequenceDocument.behaviors[1].node_type = 'decision';
defaultSequenceDocument.behaviors[1].behavior_name = '总经理审核';
defaultSequenceDocument.flow_relations = [
  relation(1, 'behavior-1', 'behavior-2'),
  relation(2, 'behavior-2', 'behavior-1', 'loop', '审核不通过'),
  relation(3, 'behavior-2', 'behavior-3', 'sequence', '')
];
const defaultSequenceResult = content(defaultSequenceDocument);
assert.equal(defaultSequenceResult.dimensions.relation, 20);
assert.equal(
  defaultSequenceResult.issues.some(item => item.message.includes('总经理审核当前只有')),
  false,
  'a loop and an unconditional sequence are two valid decision outlets'
);
assert.equal(defaultSequenceDocument.behaviors[2].node_type, 'action');

const handoffDecisionDocument = createDocument(2);
handoffDecisionDocument.behaviors[1].node_type = 'decision';
handoffDecisionDocument.behaviors[1].behavior_name = '部门审核';
handoffDecisionDocument.flow_relations = [
  relation(1, 'behavior-1', 'behavior-2'),
  relation(2, 'behavior-2', 'behavior-1', 'loop', '审核不通过')
];
handoffDecisionDocument.cross_department_handoffs = [{
  handoff_ref: 'handoff-1',
  handoff_direction: 'outbound_followup',
  anchor_behavior_ref: 'behavior-2',
  counterparty_resolution: 'identified',
  source_department: '经营发展部',
  target_department: '公司领导',
  transfer_data_ref: 'data-1',
  returned_data_ref: 'data-1',
  requested_matter: '提交审核结果',
  trigger_condition: '审核通过',
  completion_standard: '公司领导完成承接',
  counterparty_process_ref: null,
  counterparty_process_name: '',
  counterparty_behavior_ref: null,
  counterparty_behavior_name: '',
  requires_return: false,
  resume_behavior_ref: null
}];
const handoffDecisionResult = content(handoffDecisionDocument);
assert.equal(handoffDecisionResult.dimensions.relation, 20);
assert.equal(
  handoffDecisionResult.issues.some(item => item.message.includes('部门审核当前只有')),
  false,
  'a complete handoff may serve as a decision outlet'
);
assert.equal(handoffDecisionResult.dimensions.dataHandoff, 20);
assert.equal(
  handoffDecisionResult.previewIssues.some(item => item.category === 'MDM平台承接待办'),
  true,
  'missing counterparty process details must become a non-scoring MDM platform follow-up'
);

const inboundUnassignedDocument = createDocument(2);
inboundUnassignedDocument.cross_department_handoffs = [{
  handoff_ref: 'handoff-inbound-unassigned',
  handoff_direction: 'inbound_prerequisite',
  anchor_behavior_ref: 'behavior-1',
  counterparty_resolution: 'needs_identification',
  source_department: '',
  target_department: '经营发展部',
  transfer_data_ref: 'data-1',
  requested_matter: '',
  trigger_condition: '每月最后一个工作日前',
  completion_standard: '',
  counterparty_process_ref: null,
  counterparty_process_name: '',
  counterparty_behavior_ref: null,
  counterparty_behavior_name: '',
  requires_return: false,
  returned_data_ref: null,
  resume_behavior_ref: null
}];
const inboundBefore = JSON.stringify(inboundUnassignedDocument);
const inboundUnassignedResult = content(inboundUnassignedDocument);
assert.equal(inboundUnassignedResult.dimensions.dataHandoff, 20);
assert.equal(JSON.stringify(inboundUnassignedDocument), inboundBefore, 'scoring must not modify v2 JSON');
assert.equal(
  inboundUnassignedResult.issues.some(item => item.category === '跨部门承接'),
  false,
  'explicit pending department identification must not deduct structural points'
);

const missingConditionDocument = JSON.parse(JSON.stringify(defaultSequenceDocument));
missingConditionDocument.flow_relations[2].relation_type = 'condition';
const missingConditionResult = content(missingConditionDocument);
assert.equal(
  missingConditionResult.issues.some(item => item.message === '流程关系3为判断分支，但未填写判断条件'),
  true
);
assert.ok(missingConditionResult.dimensions.relation < 20);

const multipleDefaultsDocument = JSON.parse(JSON.stringify(defaultSequenceDocument));
multipleDefaultsDocument.flow_relations.push(
  relation(4, 'behavior-2', 'behavior-1', 'sequence', '')
);
const multipleDefaultsResult = content(multipleDefaultsDocument);
assert.equal(
  multipleDefaultsResult.issues.some(item =>
    item.message === '总经理审核的流程关系4形成第2条默认继续路径，判断节点只能保留1条'
  ),
  true
);

const parallelDocument = createDocument(5);
parallelDocument.behaviors[1].node_type = 'parallel_split';
parallelDocument.behaviors[4].node_type = 'parallel_join';
parallelDocument.flow_relations = [
  relation(1, 'behavior-1', 'behavior-2'),
  relation(2, 'behavior-2', 'behavior-3', 'parallel'),
  relation(3, 'behavior-2', 'behavior-4', 'parallel'),
  relation(4, 'behavior-3', 'behavior-5', 'parallel'),
  relation(5, 'behavior-4', 'behavior-5', 'parallel')
];
const parallelResult = content(parallelDocument);
assert.equal(parallelResult.dimensions.relation, 20);
let parallelDetails = parallelStructureDetails(parallelDocument);
assert.equal(parallelDetails.splits[0].routeCount, 2);
assert.equal(parallelDetails.joins[0].sourceCount, 2);
const duplicateParallelRouteDocument = JSON.parse(JSON.stringify(parallelDocument));
duplicateParallelRouteDocument.flow_relations[2].to_behavior_ref = 'behavior-3';
parallelDetails = parallelStructureDetails(duplicateParallelRouteDocument);
assert.equal(parallelDetails.splits[0].routeCount, 1, 'duplicate targets are one parallel route');
const oneRouteParallelDocument = JSON.parse(JSON.stringify(parallelDocument));
oneRouteParallelDocument.flow_relations = oneRouteParallelDocument.flow_relations.filter(item => item.relation_ref !== 'relation-3');
parallelDetails = parallelStructureDetails(oneRouteParallelDocument);
assert.equal(parallelDetails.splits[0].routeCount, 1);
assert.equal(parallelDetails.splits[0].missingCount, 1);
assert.equal(
  content(oneRouteParallelDocument).issues.some(item => item.message === '业务行为2当前只有1条并行路线；请进入流程关系，再新增1条以本节点为起点、流向不同后续行为的并行路线'),
  true
);
const returningHandoffJoinDocument = JSON.parse(JSON.stringify(parallelDocument));
returningHandoffJoinDocument.flow_relations = returningHandoffJoinDocument.flow_relations.filter(item => item.relation_ref !== 'relation-5');
returningHandoffJoinDocument.cross_department_handoffs = [{
  handoff_ref: 'handoff-return',
  handoff_direction: 'outbound_followup',
  anchor_behavior_ref: 'behavior-4',
  requires_return: true,
  resume_behavior_ref: 'behavior-5'
}];
parallelDetails = parallelStructureDetails(returningHandoffJoinDocument);
assert.equal(parallelDetails.joins[0].relationSourceCount, 1);
assert.equal(parallelDetails.joins[0].handoffSourceCount, 1);
assert.equal(parallelDetails.joins[0].sourceCount, 2);
assert.equal(content(returningHandoffJoinDocument).dimensions.relation, 20);
const incompleteParallelDocument = JSON.parse(JSON.stringify(parallelDocument));
incompleteParallelDocument.behaviors[4].node_type = 'action';
const incompleteParallelResult = content(incompleteParallelDocument);
assert.ok(incompleteParallelResult.dimensions.relation < 20);
assert.equal(
  incompleteParallelResult.issues.some(item => item.category === '并行结构'),
  true
);

const downstreamDataDocument = createDocument(3);
let dataFlowDetails = dataFlowConsistencyDetails(downstreamDataDocument);
assert.equal(dataFlowDetails.issues.length, 0, 'a producer may supply an explicitly reachable downstream behavior');
assert.equal(dataFlowDetails.isConsumerAvailable('data-1', 'behavior-2'), true);
assert.equal(dataFlowDetails.isConsumerAvailable('data-1', 'behavior-1'), false, 'a behavior cannot consume its own output');

const futureDataDocument = createDocument(3);
futureDataDocument.data_objects[0].produced_by_behavior_ref = 'behavior-3';
futureDataDocument.data_objects[0].consumed_by_behavior_refs = ['behavior-1'];
dataFlowDetails = dataFlowConsistencyDetails(futureDataDocument);
assert.equal(dataFlowDetails.issues[0].reason, 'future_data');
assert.ok(dataFlowDetails.issues[0].message.includes('后续行为'));
assert.ok(content(futureDataDocument).issues.some(item => item.category === '数据时序'));

const selfDataDocument = createDocument(2);
selfDataDocument.data_objects[0].consumed_by_behavior_refs = ['behavior-1'];
assert.equal(dataFlowConsistencyDetails(selfDataDocument).issues[0].reason, 'self_consumption');

const siblingDataDocument = JSON.parse(JSON.stringify(parallelDocument));
siblingDataDocument.data_objects[0].produced_by_behavior_ref = 'behavior-3';
siblingDataDocument.data_objects[0].consumed_by_behavior_refs = ['behavior-4'];
assert.equal(
  dataFlowConsistencyDetails(siblingDataDocument).issues[0].reason,
  'unordered_data',
  'parallel siblings cannot consume each other data'
);
siblingDataDocument.data_objects[0].consumed_by_behavior_refs = ['behavior-5'];
assert.equal(
  dataFlowConsistencyDetails(siblingDataDocument).issues.length,
  0,
  'a join reached from the producer may consume branch output'
);

const returnedDataDocument = createDocument(3);
returnedDataDocument.data_objects[0].produced_by_behavior_ref = null;
returnedDataDocument.data_objects[0].consumed_by_behavior_refs = ['behavior-2'];
returnedDataDocument.cross_department_handoffs = [{
  handoff_ref: 'handoff-data-return',
  handoff_direction: 'outbound_followup',
  anchor_behavior_ref: 'behavior-1',
  requires_return: true,
  returned_data_ref: 'data-1',
  resume_behavior_ref: 'behavior-2'
}];
assert.equal(dataFlowConsistencyDetails(returnedDataDocument).issues.length, 0);
returnedDataDocument.data_objects[0].consumed_by_behavior_refs = ['behavior-1'];
assert.equal(dataFlowConsistencyDetails(returnedDataDocument).issues[0].reason, 'before_external_return');

const loopDoesNotRelaxDataDocument = createDocument(2);
loopDoesNotRelaxDataDocument.flow_relations.push(relation(2, 'behavior-2', 'behavior-1', 'loop', '退回重办'));
loopDoesNotRelaxDataDocument.data_objects[0].produced_by_behavior_ref = 'behavior-2';
loopDoesNotRelaxDataDocument.data_objects[0].consumed_by_behavior_refs = ['behavior-1'];
assert.equal(dataFlowConsistencyDetails(loopDoesNotRelaxDataDocument).issues[0].reason, 'future_data');

const legacyBehaviorDataDocument = createDocument(2);
legacyBehaviorDataDocument.data_objects[0].consumed_by_behavior_refs = [];
legacyBehaviorDataDocument.behaviors[1].input_data_refs = ['data-1'];
dataFlowDetails = dataFlowConsistencyDetails(legacyBehaviorDataDocument);
assert.deepEqual(dataFlowDetails.dataDetails[0].consumerRefs, ['behavior-2']);
assert.equal(dataFlowDetails.issues.length, 0, 'legacy behavior-side references remain readable');

const derivedEntryDocument = createDocument(2);
derivedEntryDocument.behaviors[1].trigger = '';
assert.equal(
  content(derivedEntryDocument).issues.some(item => item.message === '业务行为2是流程入口，但未说明流程如何开始'),
  false,
  'a non-entry behavior derives its start from the incoming relation'
);
derivedEntryDocument.behaviors[0].trigger = '';
assert.equal(
  content(derivedEntryDocument).issues.some(item => item.message === '业务行为1是流程入口，但未说明流程如何开始'),
  true
);
const invalidRelationDoesNotOrderDataDocument = createDocument(2);
invalidRelationDoesNotOrderDataDocument.flow_relations[0].relation_type = '';
assert.equal(
  dataFlowConsistencyDetails(invalidRelationDoesNotOrderDataDocument).issues[0].reason,
  'unordered_data',
  'an incomplete relation must not establish data order'
);

const noDataOrFormDocument = createDocument(5);
noDataOrFormDocument.data_objects = [];
noDataOrFormDocument.forms = [];
const noDataOrFormResult = content(noDataOrFormDocument);
assert.equal(noDataOrFormResult.dimensions.dataHandoff, 5);
assert.equal(noDataOrFormResult.dimensions.form, 0);
assert.equal(
  noDataOrFormResult.issues.some(item => item.message === '尚未登记结构化数据对象'),
  true
);
assert.equal(
  noDataOrFormResult.issues.some(item => item.message === '尚未登记结构化表单或记录'),
  true
);

const placeholderDocument = createDocument(5);
placeholderDocument.process.purpose = '待确认';
placeholderDocument.behaviors[0].behavior_description = '待补充';
const placeholderResult = content(placeholderDocument);
assert.equal(placeholderResult.dimensions.basic, 8.3);
assert.equal(placeholderResult.dimensions.behavior, 25);
assert.equal(
  placeholderResult.issues.find(item => item.message === '未填写流程目的').focusPath,
  'process.purpose'
);
assert.equal(
  placeholderResult.previewIssues.some(item => item.category === '后续评审预告'),
  true
);

const blockerTechnical = passingTechnical();
blockerTechnical.checks.validation = false;
blockerTechnical.errors = [{
  message: '技术引用检查未通过：/flow_relations/0/to_behavior_ref 目标引用不存在'
}];
const blockerResult = finalize(content(perfectDocument), blockerTechnical);
assert.equal(blockerResult.blocker, true);
assert.equal(blockerResult.displayScore, 59);
assert.equal(blockerResult.grade, 'D');
assert.equal(blockerResult.issues[0].category, '技术结构');

const unavailableResult = finalize(content(perfectDocument), {
  status: 'unavailable',
  checks: {},
  message: '3001校验服务暂时不可用'
});
assert.equal(unavailableResult.available, false);
assert.equal(unavailableResult.completenessScore, null);
assert.equal(unavailableResult.displayScore, null);
assert.equal(unavailableResult.blocker, false);

const projectionSource = createDocument(2);
const projectionTarget = JSON.parse(JSON.stringify(projectionSource));
projectionTarget.export_meta.exported_at = '2026-08-01T00:00:00.000Z';
assert.equal(
  stableStringify(semanticProjection(projectionSource)),
  stableStringify(semanticProjection(projectionTarget)),
  'export timestamp is excluded from semantic preservation'
);
projectionTarget.behaviors[0].behavior_name = '已改变';
assert.notEqual(
  stableStringify(semanticProjection(projectionSource)),
  stableStringify(semanticProjection(projectionTarget)),
  'business content changes must be detected'
);

console.log('structured-output-service scoring tests passed');
