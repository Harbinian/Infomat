const assert = require('node:assert/strict');
const {
  RULE,
  REVIEW_READINESS,
  behaviorNameCompleteness,
  behaviorExecutabilityDetails,
  lifecycleStateReview,
  advancedLifecycleChecklist,
  evaluateContent,
  evaluateReviewReadiness,
  finalize,
  parallelStructureDetails,
  loopExitDetails,
  parallelRouteSafetyDetails,
  hiddenDecisionDetails,
  declaredRouteDetails,
  dataFlowConsistencyDetails,
  semanticProjection,
  stableStringify
} = require('../public/structure-score.js');
const { migrateProcessDocument } = require('../public/process-governance-migration.js');
const GovernanceWorkflow = require('../public/governance-workflow.js');

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
    behavior_name: `业务人员办理业务行为${index}`,
    behavior_description: `经办人核对第${index}项业务资料，登记处理结果并提交下一岗位。`,
    current_actor_role: '经营发展部部长',
    actor_assignment_mode: 'fixed_department',
    actor_department_data_ref: null,
    actor_position_rule: '',
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

assert.equal(RULE.id, 'structure-learning-score-v5');
assert.equal(RULE.label, '结构化学习评分 v5（process-governance-v7）');
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
assert.equal(REVIEW_READINESS.id, 'process-review-readiness-v7');
assert.deepEqual(
  REVIEW_READINESS.aspects.map(item => item.label),
  [
    '流程目的、范围和结束边界',
    'A1业务行为和责任角色',
    '业务行为逐动作可执行性',
    '条件分支、退回和跨部门流转',
    '表单、业务对象和数据输入输出',
    '数据生命周期与异常处理'
  ]
);
assert.ok(
  REVIEW_READINESS.aspects.find(item => item.key === 'routing').confirmations
    .includes('嵌套循环的每一层都必须有明确退出条件和退出去向；内层退出可以进入外层，最外层必须退出到循环外。')
);
assert.ok(
  REVIEW_READINESS.aspects.find(item => item.key === 'routing').confirmations
    .includes('条件分叉必须由判断节点明确表达，不能用普通业务行为加连线条件代替判断节点。')
);

assert.deepEqual(behaviorNameCompleteness({ node_type: 'action', behavior_name: '编制' }), {
  complete: false,
  missingSubject: true,
  missingAction: false,
  missingObject: true
});
assert.equal(
  behaviorNameCompleteness({ node_type: 'action', behavior_name: '校对人员校对产品制造大纲' }).complete,
  true
);
assert.equal(
  behaviorNameCompleteness({ node_type: 'action', behavior_name: '质量保证人员核查产品制造大纲' }).complete,
  true
);
assert.equal(
  behaviorNameCompleteness({ node_type: 'action', behavior_name: '编制人员编制产品制造大纲' }).complete,
  true
);
assert.equal(
  behaviorNameCompleteness({ node_type: 'decision', behavior_name: '产品制造大纲是否需要无损检测审批' }).complete,
  true,
  'control nodes describe the business question and do not require a fabricated actor'
);

const incompleteBehaviorNameDocument = createDocument(1);
incompleteBehaviorNameDocument.behaviors[0].behavior_name = '编制';
const incompleteBehaviorNameResult = content(incompleteBehaviorNameDocument);
assert.ok(incompleteBehaviorNameResult.dimensions.behavior < 25);
assert.ok(incompleteBehaviorNameResult.issues.some(item => item.message.includes('谁对什么做什么')));
assert.ok(
  REVIEW_READINESS.aspects.find(item => item.key === 'routing').confirmations
    .includes('并行路线必须全部进入同一个并行汇合；任一路线可能在汇合前中止整个流程时，不得使用并行。')
);

const executableBehaviorDocument = createDocument(2);
const executableBehaviorBefore = JSON.stringify(executableBehaviorDocument);
assert.equal(behaviorExecutabilityDetails(executableBehaviorDocument).issues.length, 0);
assert.equal(
  JSON.stringify(executableBehaviorDocument),
  executableBehaviorBefore,
  'behavior executability review must not mutate JSON'
);

const missingBehaviorDescriptionDocument = createDocument(1);
missingBehaviorDescriptionDocument.behaviors[0].behavior_description = '';
assert.equal(
  behaviorExecutabilityDetails(missingBehaviorDescriptionDocument).issues[0].reason,
  'missing_description'
);

const abstractBehaviorDescriptionDocument = createDocument(2);
abstractBehaviorDescriptionDocument.behaviors[0].behavior_description = '确保报销可以完成';
abstractBehaviorDescriptionDocument.behaviors[1].behavior_description = '保证数据真实性、合理性';
assert.deepEqual(
  behaviorExecutabilityDetails(abstractBehaviorDescriptionDocument).issues.map(item => item.reason),
  ['abstract_qualitative_description', 'abstract_qualitative_description']
);

const noConcreteActionDocument = createDocument(1);
noConcreteActionDocument.behaviors[0].behavior_description = '加强报销过程管理';
assert.equal(
  behaviorExecutabilityDetails(noConcreteActionDocument).issues[0].reason,
  'no_concrete_action'
);

const controlNodeDescriptionDocument = createDocument(3);
controlNodeDescriptionDocument.behaviors[0].node_type = 'decision';
controlNodeDescriptionDocument.behaviors[0].behavior_description = '';
controlNodeDescriptionDocument.behaviors[1].node_type = 'parallel_split';
controlNodeDescriptionDocument.behaviors[1].behavior_description = '';
assert.equal(
  behaviorExecutabilityDetails(controlNodeDescriptionDocument).issues.length,
  0,
  'control nodes do not perform business actions and must not require action descriptions'
);

const reviewReadinessDocument = createDocument(3);
const reviewReadinessBefore = JSON.stringify(reviewReadinessDocument);
const reviewReadiness = evaluateReviewReadiness(reviewReadinessDocument, {
  technical: passingTechnical(),
  businessIssues: [{
    message: '未填写流程目的',
    editorSection: 'profile',
    focusPath: 'process.purpose'
  }, {
    message: '业务行为2未选择执行岗位',
    editorSection: 'process',
    processSection: 'behaviors',
    focusPath: 'behaviors.1.current_actor_role'
  }, {
    message: '业务行为3未填写“具体做什么”',
    editorSection: 'process',
    processSection: 'behaviors',
    focusPath: 'behaviors.2.behavior_description',
    reviewAspect: 'behaviorExecutability'
  }, {
    message: '流程关系2已选择流程内部回路但未填写条件',
    editorSection: 'process',
    processSection: 'relations',
    focusPath: 'flow_relations.1.condition'
  }, {
    message: '测试表的字段归属待确认',
    editorSection: 'forms',
    focusPath: 'forms.0.areas.0.items.0.assignment'
  }]
});
assert.equal(JSON.stringify(reviewReadinessDocument), reviewReadinessBefore, 'review readiness must not mutate JSON');
assert.equal(reviewReadiness.operationStatus, 'prompt');
assert.equal(reviewReadiness.operationLabel, '有业务提示，可以下载');
assert.equal(reviewReadiness.businessIssueCount, 5);
assert.deepEqual(reviewReadiness.aspects.map(item => item.issueCount), [1, 1, 1, 1, 1, 0]);

const reviewReady = evaluateReviewReadiness(reviewReadinessDocument, {
  technical: passingTechnical(),
  businessIssues: []
});
assert.equal(reviewReady.operationStatus, 'ready');
assert.equal(reviewReady.operationLabel, '可下载并提交部门核对');
assert.equal(reviewReady.aspects.every(item => item.status === 'confirmation_required'), true);

const reviewBlocked = evaluateReviewReadiness(reviewReadinessDocument, {
  technical: { ...passingTechnical(), blocker: true },
  technicalIssues: [{
    category: '技术结构',
    message: '流程关系引用的目标行为不存在',
    editorSection: 'process',
    processSection: 'relations',
    focusPath: 'flow_relations.0.to_behavior_ref'
  }]
});
assert.equal(reviewBlocked.operationStatus, 'blocker');
assert.equal(reviewBlocked.operationLabel, '存在结构错误');
assert.equal(reviewBlocked.aspects.find(item => item.key === 'routing').status, 'blocker');

const emptyReviewDocument = createDocument(1);
emptyReviewDocument.data_objects = [];
emptyReviewDocument.forms = [];
const dataFormAspect = evaluateReviewReadiness(emptyReviewDocument, {
  technical: passingTechnical(),
  businessIssues: []
}).aspects.find(item => item.key === 'dataForm');
assert.ok(dataFormAspect.applicabilityNote.includes('不要为满足检查补造内容'));

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

const hiddenApprovalDecisionDocument = createDocument(3);
hiddenApprovalDecisionDocument.behaviors[1].behavior_name = '审核人员审核业务资料';
hiddenApprovalDecisionDocument.flow_relations.push(
  relation(3, 'behavior-2', 'behavior-1', 'loop', '审核不同意')
);
const hiddenApprovalDetails = hiddenDecisionDetails(hiddenApprovalDecisionDocument);
assert.equal(hiddenApprovalDetails.issues.length, 1);
assert.equal(hiddenApprovalDetails.issues[0].behaviorRef, 'behavior-2');
assert.equal(hiddenApprovalDetails.issues[0].reason, 'decision_hidden_in_relations');
assert.ok(hiddenApprovalDetails.issues[0].suggestions[0].includes('保留该业务行为'));
const hiddenApprovalDecisionResult = content(hiddenApprovalDecisionDocument);
assert.ok(hiddenApprovalDecisionResult.dimensions.relation < 20);
assert.ok(hiddenApprovalDecisionResult.issues.some(item =>
  item.message === '“审核人员审核业务资料”用普通业务行为承载条件分叉，判断被隐藏在流程关系中。'
  && item.focusPath === 'behaviors.1.node_type'
));
hiddenApprovalDecisionDocument.behaviors.splice(2, 0, behavior(4, 'decision'));
hiddenApprovalDecisionDocument.behaviors[2].behavior_ref = 'decision-review-result';
hiddenApprovalDecisionDocument.behaviors[2].behavior_name = '业务资料审核结果是否同意';
hiddenApprovalDecisionDocument.flow_relations = [
  relation(1, 'behavior-1', 'behavior-2'),
  relation(2, 'behavior-2', 'decision-review-result'),
  relation(3, 'decision-review-result', 'behavior-1', 'loop', '审核不同意'),
  relation(4, 'decision-review-result', 'behavior-3', 'condition', '审核同意')
];
assert.equal(hiddenDecisionDetails(hiddenApprovalDecisionDocument).issues.length, 0);
assert.equal(content(hiddenApprovalDecisionDocument).dimensions.relation, 20);

const declaredRouteDocument = createDocument(3);
declaredRouteDocument.behaviors[0].behavior_name = '审核人员审核业务资料';
declaredRouteDocument.behaviors[1].node_type = 'decision';
declaredRouteDocument.behaviors[1].behavior_name = '业务资料审核结果是什么';
declaredRouteDocument.behaviors[1].behavior_description = '审核同意且需要复核时进入复核；审核同意且不需要复核时直接进入批准；审核不同意时退回编制。';
declaredRouteDocument.behaviors[2].behavior_name = '批准人员批准业务资料';
declaredRouteDocument.flow_relations = [
  relation(1, 'behavior-1', 'behavior-2'),
  relation(2, 'behavior-2', 'behavior-1', 'loop', '审核不同意')
];
const missingDeclaredRoute = declaredRouteDetails(declaredRouteDocument);
assert.ok(missingDeclaredRoute.issues.some(item => item.declaredTargetRef === 'behavior-3'));
assert.equal(
  GovernanceWorkflow.stepForTarget(missingDeclaredRoute.issues.find(item => item.declaredTargetRef === 'behavior-3').target),
  'skeleton',
  'a missing declared route must appear in the flow skeleton review instead of being hidden in action details'
);
declaredRouteDocument.flow_relations.push(
  relation(3, 'behavior-2', 'behavior-3', 'condition', '审核同意且不需要复核')
);
assert.equal(
  declaredRouteDetails(declaredRouteDocument).issues.some(item => item.declaredTargetRef === 'behavior-3'),
  false,
  'a declared direct route is satisfied only when the relation reaches the declared action'
);

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
  isolatedResult.issues.some(item => item.message === '业务人员办理业务行为3未进入任何有效流程关系'),
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

const missingConditionDocument = JSON.parse(JSON.stringify(defaultSequenceDocument));
missingConditionDocument.flow_relations[2].relation_type = 'condition';
const missingConditionResult = content(missingConditionDocument);
assert.equal(
  missingConditionResult.issues.some(item =>
    item.message === '流程关系3已选择“判断分支”，但判断条件为空。'
    && item.suggestions.includes('填写进入目标行为必须满足的具体判断结果。')
  ),
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
  content(oneRouteParallelDocument).issues.some(item =>
    item.message === '业务人员办理业务行为2当前有效并行路线为1条，规则要求至少2条。'
    && item.suggestions.includes('新增1条从本节点流向不同后续行为的并行路线。')
  ),
  true
);
const misclassifiedParallelDocument = JSON.parse(JSON.stringify(parallelDocument));
misclassifiedParallelDocument.flow_relations.slice(1).forEach(item => {
  item.relation_type = 'sequence';
});
parallelDetails = parallelStructureDetails(misclassifiedParallelDocument);
assert.equal(parallelDetails.splits[0].routeCount, 0);
assert.equal(parallelDetails.splits[0].sequenceRelations.length, 2);
assert.equal(parallelDetails.joins[0].sourceCount, 0);
assert.equal(parallelDetails.joins[0].sequenceRelations.length, 2);
const misclassifiedParallelResult = content(misclassifiedParallelDocument);
const splitTypeIssue = misclassifiedParallelResult.issues.find(item =>
  item.message === '业务人员办理业务行为2已有2条通往“业务人员办理业务行为3”、“业务人员办理业务行为4”的顺序关系，顺序关系不计入并行路线；当前有效并行路线为0条，规则要求至少2条。'
);
assert.deepEqual(splitTypeIssue.suggestions, ['将通往“业务人员办理业务行为3”、“业务人员办理业务行为4”的现有顺序关系改为“并行路线”。']);
assert.deepEqual(splitTypeIssue.focusPaths, [
  'flow_relations.1.relation_type',
  'flow_relations.2.relation_type'
]);
assert.equal(splitTypeIssue.focusRef, 'relation-2');
assert.equal(splitTypeIssue.focusPath, 'flow_relations.1.relation_type');
const joinTypeIssue = misclassifiedParallelResult.issues.find(item =>
  item.message === '业务人员办理业务行为5已有2条来自“业务人员办理业务行为3”、“业务人员办理业务行为4”的顺序关系，顺序关系不计入并行汇合来源；当前共有0个有效来源（0条并行路线来源），规则要求至少2个。'
);
assert.deepEqual(joinTypeIssue.suggestions, ['将“业务人员办理业务行为3”、“业务人员办理业务行为4”进入本节点的现有顺序关系改为“并行路线”。']);
assert.deepEqual(joinTypeIssue.focusPaths, [
  'flow_relations.3.relation_type',
  'flow_relations.4.relation_type'
]);
assert.equal(joinTypeIssue.focusRef, 'relation-4');
assert.equal(joinTypeIssue.focusPath, 'flow_relations.3.relation_type');
assert.ok(misclassifiedParallelResult.issues.every(item => Array.isArray(item.suggestions) && item.suggestions.length));
const incompleteParallelDocument = JSON.parse(JSON.stringify(parallelDocument));
incompleteParallelDocument.behaviors[4].node_type = 'action';
const incompleteParallelResult = content(incompleteParallelDocument);
assert.ok(incompleteParallelResult.dimensions.relation < 20);
assert.equal(
  incompleteParallelResult.issues.some(item => item.category === '并行结构'),
  true
);

const validLoopExitDocument = createDocument(5);
validLoopExitDocument.behaviors[2].node_type = 'decision';
validLoopExitDocument.flow_relations = [
  relation(1, 'behavior-1', 'behavior-2'),
  relation(2, 'behavior-2', 'behavior-3'),
  relation(3, 'behavior-3', 'behavior-2', 'loop', '需要重新办理'),
  relation(4, 'behavior-3', 'behavior-4', 'condition', '本层循环完成'),
  relation(5, 'behavior-4', 'behavior-5')
];
let loopDetails = loopExitDetails(validLoopExitDocument);
assert.equal(loopDetails.loops.length, 1);
assert.equal(loopDetails.loops[0].hasForwardPath, true);
assert.equal(loopDetails.loops[0].exitCount, 1);

const noLoopExitDocument = JSON.parse(JSON.stringify(validLoopExitDocument));
noLoopExitDocument.flow_relations = noLoopExitDocument.flow_relations.filter(item => item.relation_ref !== 'relation-4');
loopDetails = loopExitDetails(noLoopExitDocument);
assert.equal(loopDetails.loops[0].exitCount, 0, 'each loop level must have its own exit route');

const nestedLoopDocument = createDocument(6);
nestedLoopDocument.behaviors[3].node_type = 'decision';
nestedLoopDocument.behaviors[4].node_type = 'decision';
nestedLoopDocument.flow_relations = [
  relation(1, 'behavior-1', 'behavior-2'),
  relation(2, 'behavior-2', 'behavior-3'),
  relation(3, 'behavior-3', 'behavior-4'),
  relation(4, 'behavior-4', 'behavior-3', 'loop', '内层继续'),
  relation(5, 'behavior-4', 'behavior-5', 'condition', '退出内层'),
  relation(6, 'behavior-5', 'behavior-2', 'loop', '外层继续'),
  relation(7, 'behavior-5', 'behavior-6', 'condition', '退出外层')
];
const nestedLoopBefore = JSON.stringify(nestedLoopDocument);
loopDetails = loopExitDetails(nestedLoopDocument);
assert.equal(loopDetails.loops.length, 2);
assert.deepEqual(loopDetails.loops.map(item => item.exitCount), [1, 1]);
assert.deepEqual(loopDetails.loops[0].nestedWithinRefs, ['relation-6']);
assert.equal(loopDetails.loops[1].nestedWithinRefs.length, 0);
assert.equal(JSON.stringify(nestedLoopDocument), nestedLoopBefore, 'loop review must not mutate JSON');

let parallelSafety = parallelRouteSafetyDetails(parallelDocument);
assert.equal(parallelSafety.splits[0].commonJoinRef, 'behavior-5');
assert.equal(parallelSafety.splits[0].terminalRefs.length, 0);
assert.equal(parallelSafety.splits[0].safe, true);

const nestedParallelDocument = createDocument(8);
nestedParallelDocument.behaviors[0].node_type = 'parallel_split';
nestedParallelDocument.behaviors[1].node_type = 'parallel_split';
nestedParallelDocument.behaviors[4].node_type = 'parallel_join';
nestedParallelDocument.behaviors[6].node_type = 'parallel_join';
nestedParallelDocument.flow_relations = [
  relation(1, 'behavior-1', 'behavior-2', 'parallel'),
  relation(2, 'behavior-1', 'behavior-6', 'parallel'),
  relation(3, 'behavior-2', 'behavior-3', 'parallel'),
  relation(4, 'behavior-2', 'behavior-4', 'parallel'),
  relation(5, 'behavior-3', 'behavior-5', 'parallel'),
  relation(6, 'behavior-4', 'behavior-5', 'parallel'),
  relation(7, 'behavior-5', 'behavior-7', 'parallel'),
  relation(8, 'behavior-6', 'behavior-7', 'parallel'),
  relation(9, 'behavior-7', 'behavior-8')
];
const nestedParallelBefore = JSON.stringify(nestedParallelDocument);
parallelSafety = parallelRouteSafetyDetails(nestedParallelDocument);
assert.equal(parallelSafety.splits.length, 2);
assert.equal(parallelSafety.splits.find(item => item.splitRef === 'behavior-1').commonJoinRef, 'behavior-7');
assert.equal(parallelSafety.splits.find(item => item.splitRef === 'behavior-2').commonJoinRef, 'behavior-5');
assert.ok(parallelSafety.splits.every(item => item.safe));
assert.equal(JSON.stringify(nestedParallelDocument), nestedParallelBefore, 'parallel review must not mutate JSON');

const terminatingParallelDocument = JSON.parse(JSON.stringify(parallelDocument));
terminatingParallelDocument.flow_relations = terminatingParallelDocument.flow_relations.filter(item => item.relation_ref !== 'relation-4');
parallelSafety = parallelRouteSafetyDetails(terminatingParallelDocument);
assert.equal(parallelSafety.splits[0].hasCommonJoin, false);
assert.deepEqual(parallelSafety.splits[0].terminalRefs, ['behavior-3']);
assert.equal(parallelSafety.splits[0].safe, false);

const decisionInParallelDocument = createDocument(6);
decisionInParallelDocument.behaviors[0].node_type = 'parallel_split';
decisionInParallelDocument.behaviors[1].node_type = 'decision';
decisionInParallelDocument.behaviors[5].node_type = 'parallel_join';
decisionInParallelDocument.flow_relations = [
  relation(1, 'behavior-1', 'behavior-2', 'parallel'),
  relation(2, 'behavior-1', 'behavior-5', 'parallel'),
  relation(3, 'behavior-2', 'behavior-3', 'condition', '继续办理'),
  relation(4, 'behavior-2', 'behavior-4', 'condition', '中止办理'),
  relation(5, 'behavior-3', 'behavior-6', 'parallel'),
  relation(6, 'behavior-5', 'behavior-6', 'parallel')
];
parallelSafety = parallelRouteSafetyDetails(decisionInParallelDocument);
assert.equal(parallelSafety.splits[0].commonJoinRef, 'behavior-6');
assert.deepEqual(parallelSafety.splits[0].terminalRefs, ['behavior-4']);
assert.equal(parallelSafety.splits[0].safe, false, 'a decision outcome that ends before the join invalidates parallel routing');

const downstreamDataDocument = createDocument(3);
let dataFlowDetails = dataFlowConsistencyDetails(downstreamDataDocument);
assert.equal(dataFlowDetails.issues.length, 0, 'a producer may supply an explicitly reachable downstream behavior');
assert.equal(dataFlowDetails.isConsumerAvailable('data-1', 'behavior-2'), true);
assert.equal(dataFlowDetails.isConsumerAvailable('data-1', 'behavior-1'), false, 'a behavior cannot consume its own output');
assert.equal(dataFlowDetails.isAvailableBeforeBehavior('data-1', 'behavior-2'), true);
assert.equal(dataFlowDetails.isAvailableBeforeBehavior('data-1', 'behavior-1'), false);

const dynamicActorDocument = createDocument(3);
dynamicActorDocument.behaviors[2].current_actor_role = '';
dynamicActorDocument.behaviors[2].actor_assignment_mode = 'dynamic_from_data';
dynamicActorDocument.behaviors[2].actor_department_data_ref = 'data-1';
dynamicActorDocument.behaviors[2].actor_position_rule = '由数据中的责任部门确定整改责任人';
let dynamicActorResult = content(dynamicActorDocument);
assert.equal(
  dynamicActorResult.issues.some(item => item.message.includes('执行部门来源数据') || item.message.includes('执行岗位或责任人确定规则')),
  false,
  'a reachable preceding data object and assignment rule complete a dynamic actor assignment'
);
assert.equal(content(dynamicActorDocument).issues.some(item => item.category === '跨部门行为'), false, 'dynamic assignment is not a fixed cross-department behavior');

const futureDynamicActorDocument = createDocument(3);
futureDynamicActorDocument.behaviors[0].current_actor_role = '';
futureDynamicActorDocument.behaviors[0].actor_assignment_mode = 'dynamic_from_data';
futureDynamicActorDocument.behaviors[0].actor_department_data_ref = 'data-1';
futureDynamicActorDocument.behaviors[0].actor_position_rule = '由数据中的责任部门确定整改责任人';
futureDynamicActorDocument.data_objects[0].produced_by_behavior_ref = 'behavior-3';
futureDynamicActorDocument.data_objects[0].consumed_by_behavior_refs = [];
dynamicActorResult = content(futureDynamicActorDocument);
assert.ok(dynamicActorResult.issues.some(item => item.message.includes('尚未在本行为开始前形成')));

const companyWideActorDocument = createDocument(1);
companyWideActorDocument.behaviors[0].current_actor_role = '全公司';
companyWideActorDocument.behaviors[0].actor_assignment_mode = 'company_wide';
assert.equal(
  content(companyWideActorDocument).issues.some(item => item.message.includes('未选择执行部门') || item.message.includes('未选择执行岗位')),
  false,
  'company-wide is a complete assignment mode and is not treated as cross-department'
);

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
returnedDataDocument.schema_version = 'process-governance-v5';
returnedDataDocument.data_objects[0] = {
  data_ref: 'data-1',
  data_name: '测试数据',
  description: '外部来源在恢复行为可用',
  governance_status: 'candidate',
  information_type: 'business_information',
  behavior_links: [{ link_ref: 'data-link-use', behavior_ref: 'behavior-2', operation: 'use' }],
  source_relations: [{
    source_ref: 'source-return',
    source_department: '质量管理部',
    source_process_name: '外部复核流程',
    source_behavior_name: '返回复核结果',
    source_data_name: '外部门返回',
    availability_mode: 'at_behavior',
    available_from_behavior_ref: 'behavior-2'
  }]
};
assert.equal(dataFlowConsistencyDetails(returnedDataDocument).issues.length, 0);
returnedDataDocument.data_objects[0].behavior_links[0].behavior_ref = 'behavior-1';
assert.equal(dataFlowConsistencyDetails(returnedDataDocument).issues[0].reason, 'before_external_return');

const linkedCrossDepartmentDataDocument = createDocument(3);
linkedCrossDepartmentDataDocument.schema_version = 'process-governance-v5';
linkedCrossDepartmentDataDocument.behaviors[1].current_actor_role = '质量管理部质量审核岗';
linkedCrossDepartmentDataDocument.data_objects[0] = {
  data_ref: 'data-1',
  data_name: '测试数据',
  description: '跨部门行为产生并供后续使用',
  governance_status: 'candidate',
  information_type: 'business_information',
  behavior_links: [
    { link_ref: 'data-link-create', behavior_ref: 'behavior-2', operation: 'create' },
    { link_ref: 'data-link-use', behavior_ref: 'behavior-3', operation: 'use' }
  ],
  source_relations: []
};
dataFlowDetails = dataFlowConsistencyDetails(linkedCrossDepartmentDataDocument);
assert.equal(dataFlowDetails.issues.length, 0, 'returned data produced by the linked external behavior is available after the resume point');
assert.equal(content(linkedCrossDepartmentDataDocument).issues.some(item => item.category === '跨部门行为'), false);
linkedCrossDepartmentDataDocument.data_objects[0].behavior_links[1].behavior_ref = 'behavior-1';
assert.equal(
  dataFlowConsistencyDetails(linkedCrossDepartmentDataDocument).issues[0].reason,
  'future_data',
  'data produced by a downstream external behavior must not be selectable by its local predecessor'
);

const linkedInboundDataDocument = createDocument(2);
linkedInboundDataDocument.schema_version = 'process-governance-v5';
linkedInboundDataDocument.behaviors[0].current_actor_role = '质量管理部质量审核岗';
linkedInboundDataDocument.data_objects[0] = {
  data_ref: 'data-1', data_name: '测试数据', description: '前置跨部门行为产生', governance_status: 'candidate',
  information_type: 'business_information',
  behavior_links: [
    { link_ref: 'data-link-create-inbound', behavior_ref: 'behavior-1', operation: 'create' },
    { link_ref: 'data-link-use-inbound', behavior_ref: 'behavior-2', operation: 'use' }
  ],
  source_relations: []
};
assert.equal(dataFlowConsistencyDetails(linkedInboundDataDocument).issues.length, 0);

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
  content(derivedEntryDocument).issues.some(item => item.message === '业务人员办理业务行为2是流程入口，但未说明流程如何开始'),
  false,
  'a non-entry behavior derives its start from the incoming relation'
);
derivedEntryDocument.behaviors[0].trigger = '';
assert.equal(
  content(derivedEntryDocument).issues.some(item => item.message === '业务人员办理业务行为1是流程入口，但未说明流程如何开始'),
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

const externalSystemFieldSourceDocument = createDocument(2);
externalSystemFieldSourceDocument.schema_version = 'process-governance-v5';
externalSystemFieldSourceDocument.data_objects[0] = {
  data_ref: 'data-1', data_name: '测试数据', description: '用于验证字段来源评分', governance_status: 'candidate',
  information_type: 'business_information',
  behavior_links: [{ link_ref: 'data-link-create', behavior_ref: 'behavior-1', operation: 'create' }],
  source_relations: []
};
externalSystemFieldSourceDocument.forms[0].behavior_links = [{
  link_ref: 'form-link-fill', behavior_ref: 'behavior-1', operations: ['fill'], notes: ''
}];
externalSystemFieldSourceDocument.forms[0].areas[0].items[0] = {
  ...externalSystemFieldSourceDocument.forms[0].areas[0].items[0],
  business_data_ref: 'data-1',
  value_origin_mode: 'depends_on_data',
  source_links: [{
    source_link_ref: 'field-source-external',
    source_type: 'external_system',
    source_data_ref: null,
    source_system_name: '外部业务系统',
    source_data_name: '申请单位信息',
    source_role: 'provides_value'
  }]
};
assert.equal(
  content(externalSystemFieldSourceDocument).issues.some(item => item.message.includes('未完整填写外部系统和来源数据名称')),
  false,
  'a complete external-system field source satisfies the form-source check'
);
externalSystemFieldSourceDocument.forms[0].areas[0].items[0].source_links[0].source_data_name = '';
assert.ok(
  content(externalSystemFieldSourceDocument).issues.some(item => item.message.includes('未完整填写外部系统和来源数据名称')),
  'an incomplete external-system field source remains a visible scoring issue'
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

const resolvedLifecycleState = {
  business_validity: 'effective',
  custody: 'active_custody',
  identifiability_applicability: 'not_applicable',
  identifiability: 'not_applicable'
};
const lifecycleScoreDocument = migrateProcessDocument(createDocument(2));
lifecycleScoreDocument.data_objects[0].lifecycle = {
  applicability: 'applicable',
  entry_state: { ...resolvedLifecycleState },
  routes: [{
    route_ref: 'route-score-test',
    route_label: '测试路径',
    flow_relation_refs: ['relation-1'],
    events: [{
      event_ref: 'event-score-test',
      action: 'archive',
      trigger: { mode: 'pending_confirmation', operator: 'pending_confirmation', expression: '' },
      target_scope: 'pending_confirmation',
      carrier_scope: 'pending_confirmation',
      responsibility: { mode: 'pending_confirmation', department: '', position: '' },
      exception_handling: '',
      result_state: { ...resolvedLifecycleState },
      high_risk: false,
      review_status: 'pending_confirmation',
      decision_reason: '',
      decision_notes: '',
      provenance: { source_path: '', basis: '', evidence_snapshot: '' }
    }],
    exit_state: { ...resolvedLifecycleState }
  }],
  analysis: { analyzer_version: '', source_fingerprint: '', status: 'not_analyzed' },
  decision_reason: '',
  decision_notes: ''
};
assert.deepEqual(lifecycleStateReview(lifecycleScoreDocument.data_objects[0].lifecycle), {
  applicabilityResolved: true,
  businessValidityResolved: true,
  custodyAndIdentifiabilityResolved: true
});
const lifecycleScoreResult = content(lifecycleScoreDocument);
assert.equal(
  lifecycleScoreResult.issues.some(item => item.message.includes('确定性分析') || item.message.includes('事件待核对')),
  false,
  'ordinary score must ignore analyzer status, event review status, trigger, scope, responsibility, and exception fields'
);
assert.equal(advancedLifecycleChecklist(lifecycleScoreDocument).length, 4);
const pendingIdentifiabilityLifecycle = JSON.parse(JSON.stringify(lifecycleScoreDocument.data_objects[0].lifecycle));
pendingIdentifiabilityLifecycle.entry_state.identifiability_applicability = 'applicable';
pendingIdentifiabilityLifecycle.entry_state.identifiability = 'pending_confirmation';
assert.equal(lifecycleStateReview(pendingIdentifiabilityLifecycle).custodyAndIdentifiabilityResolved, false);

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
