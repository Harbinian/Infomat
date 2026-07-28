const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Ajv2020 = require('ajv/dist/2020');
const {
  app,
  extractFromText,
  decodeTextBuffer,
  createEmptyProcessGovernanceDocument,
  PROCESS_GOVERNANCE_SCHEMA_DIGEST
} = require('../server');

const appRoot = path.join(__dirname, '..');
const repoRoot = path.join(appRoot, '..', '..');
const frontendPath = path.join(appRoot, 'public', 'index.html');
const processDiagramPath = path.join(appRoot, 'public', 'process-diagram.js');
const serverPath = path.join(appRoot, 'server.js');
const processSchemaPath = path.join(repoRoot, 'docs', 'contracts', 'process-governance-v1.schema.json');
const legacySchemaPath = path.join(repoRoot, 'docs', 'contracts', 'document-structured-output.schema.json');
const { buildGraphModel } = require(processDiagramPath);

function createDraft(overrides = {}) {
  const behavior = {
    behavior_ref: 'behavior_apply',
    node_type: 'action',
    behavior_name: '费用申请',
    current_actor_role: '财务部会计员',
    trigger: '发生报销事项时',
    precondition: '',
    input_description: '报销材料',
    timing: null,
    completion_standard: '申请内容和附件齐全',
    output_description: '费用报销申请',
    input_data_refs: [],
    output_data_refs: ['data_application'],
    work_role: {
      behavior_ref: 'behavior_apply',
      work_role_code: null,
      role_duty: '发起',
      work_role_name: '费用申请行为的发起角色',
      assignment_status: 'pending_assignment'
    },
    countersign_all_required: false,
    countersign_target_departments: []
  };
  const result = {
    schema_version: 'process-governance-v1',
    export_meta: {
      package_ref: 'package_test_001',
      exported_at: '2026-07-27T08:00:00.000Z',
      initiating_department: '财务部',
      compiler: '测试编制人'
    },
    process: {
      process_ref: 'process_expense',
      process_name: '费用报销流程',
      owning_department: '财务部',
      purpose: '规范费用报销办理',
      scope: '公司费用报销事项',
      capability_domain: null,
      business_capability: null,
      classification_status: 'unclassified'
    },
    reference_materials: [{
      material_ref: 'material_operation',
      material_type: '现行业务操作说明',
      material_name: '费用报销现行业务操作说明',
      document_no: null,
      version: null,
      file_sha256: null,
      readable_text: '申请人提交报销材料，财务部按现行业务要求办理。',
      provider_department: '财务部',
      provider_name: '测试提供人',
      as_of_date: '2026-07-27'
    }],
    behaviors: [behavior],
    flow_relations: [],
    data_objects: [{
      data_ref: 'data_application',
      data_name: '费用报销申请',
      description: '申请人提交的费用报销申请及附件',
      governance_status: 'candidate',
      produced_by_behavior_ref: 'behavior_apply',
      consumed_by_behavior_refs: []
    }],
    cross_department_handoffs: [],
    internal_process_calls: [],
    forms: [{
      form_ref: 'form_expense',
      behavior_ref: 'behavior_apply',
      form_name: '费用报销申请单',
      form_no: null,
      areas: [{
        area_ref: 'area_basic',
        area_type: '基本信息',
        area_title: '报销基本信息',
        items: [{
          item_ref: 'item_amount',
          item_name: '报销金额',
          item_type: '金额',
          required: true,
          instructions: '填写本次申请报销的金额'
        }]
      }, {
        area_ref: 'area_invoice_detail',
        area_type: '明细清单',
        area_title: '票据明细',
        items: [{
          item_ref: 'item_invoice_no',
          item_name: '票据号码',
          item_type: '文本',
          required: true,
          instructions: '填写票据号码'
        }]
      }, {
        area_ref: 'area_cost_detail',
        area_type: '明细清单',
        area_title: '费用明细',
        items: [{
          item_ref: 'item_cost_type',
          item_name: '费用类型',
          item_type: '文本',
          required: true,
          instructions: '填写费用所属类型'
        }]
      }]
    }],
    terms: []
  };
  return Object.assign(result, overrides);
}

async function withServer(run) {
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function getJson(baseUrl, route) {
  const response = await fetch(`${baseUrl}${route}`);
  const body = await response.json();
  return { response, body };
}

async function postJson(baseUrl, route, payload) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  return { response, body };
}

async function testSchemas() {
  const processSchema = JSON.parse(fs.readFileSync(processSchemaPath, 'utf8'));
  const legacySchema = JSON.parse(fs.readFileSync(legacySchemaPath, 'utf8'));
  const processValidator = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(processSchema);
  const legacyValidator = new Ajv2020({ allErrors: true, strict: false }).compile(legacySchema);
  assert.equal(processSchema.properties.process.$ref, '#/$defs/process');
  assert.equal(processSchema.$defs.process.type, 'object');
  assert.equal(Object.prototype.hasOwnProperty.call(processSchema.properties, 'processes'), false);
  assert.equal(processSchema.properties.schema_version.const, 'process-governance-v1');
  assert.equal(processValidator(createDraft()), true, JSON.stringify(processValidator.errors));
  assert.equal(typeof legacyValidator, 'function');
  assert.equal(
    processValidator(createEmptyProcessGovernanceDocument()),
    true,
    JSON.stringify(processValidator.errors)
  );

  const incomplete = createDraft();
  incomplete.export_meta.initiating_department = '';
  incomplete.export_meta.compiler = '';
  incomplete.process.process_name = '';
  incomplete.process.purpose = '';
  incomplete.process.scope = '';
  incomplete.reference_materials = [];
  incomplete.behaviors = [];
  incomplete.data_objects = [];
  incomplete.forms = [];
  assert.equal(processValidator(incomplete), true, 'business-incomplete drafts must remain schema-exportable');
}

async function testDeterministicParser() {
  const sample = [
    '1 目的',
    '规范公司费用报销办理。',
    '2 适用范围',
    '适用于公司各部门费用报销事项。',
    '3 工作流程',
    '3.1 申请人填写《费用报销申请单》，并提交票据。',
    '3.2 财务部审核申请材料，形成审核意见。',
    '4 表单与记录',
    '费用报销申请单'
  ].join('\n');
  const result = await extractFromText(sample, { sourceName: '费用报销管理要求.md' });
  assert.equal(result.data.schema_version, 'document-structured-output-v2');
  assert.match(result.data.document_profile.purpose, /规范公司费用报销办理/);
  assert.match(result.data.document_profile.scope, /适用于公司各部门费用报销事项/);
  assert.ok(result.stats.steps >= 1, 'deterministic parser should still identify explicit workflow actions');
  assert.equal(Object.keys(result.fieldSuggestions || {}).length, 0);

  const utf8 = Buffer.from('中文流程说明', 'utf8');
  assert.equal(decodeTextBuffer(utf8), '中文流程说明');
}

async function testApi() {
  await withServer(async baseUrl => {
    const health = await getJson(baseUrl, '/api/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(Object.prototype.hasOwnProperty.call(health.body, 'deepseek'), false);

    const schema = await getJson(baseUrl, '/api/schema');
    assert.equal(schema.body.properties.schema_version.const, 'process-governance-v1');
    assert.equal(schema.response.headers.get('cache-control'), 'no-store');
    assert.equal(schema.response.headers.get('x-infomat-schema-digest'), PROCESS_GOVERNANCE_SCHEMA_DIGEST);
    const legacySchema = await getJson(baseUrl, '/api/schema?version=document-structured-output-v2');
    assert.equal(legacySchema.body.properties.schema_version.const, 'document-structured-output-v2');

    const template = await getJson(baseUrl, '/api/template?version=process-governance-v1');
    assert.equal(template.response.status, 200);
    assert.equal(template.response.headers.get('cache-control'), 'no-store');
    assert.equal(template.body.schema_version, 'process-governance-v1');
    assert.equal(template.body.schema_digest, PROCESS_GOVERNANCE_SCHEMA_DIGEST);
    assert.equal(template.body.data.schema_version, 'process-governance-v1');
    assert.equal(typeof template.body.data.export_meta.package_ref, 'string');
    assert.equal(typeof template.body.data.process.process_ref, 'string');
    assert.deepEqual(template.body.data.reference_materials, []);
    assert.deepEqual(template.body.data.internal_process_calls, []);
    assert.equal(
      template.body.data.export_meta.package_ref === createEmptyProcessGovernanceDocument().export_meta.package_ref,
      false,
      'each blank template must receive fresh technical references'
    );

    const enums = await getJson(baseUrl, '/api/enums');
    assert.equal(enums.response.status, 200);
    assert.ok(Array.isArray(enums.body.rosterRolesByDepartment?.财务部));
    assert.ok(enums.body.rosterRolesByDepartment.财务部.includes('会计员'));
    assert.ok(
      enums.body.rosterRolesByDepartment?.工程技术部?.includes('车间主任助理'),
      '3001 must preserve the current roster source assignment for engineering department positions'
    );

    const sourceText = '# 操作说明\n\n## 工作流程\n申请人提交申请，财务部审核。';
    const body = new FormData();
    body.append('requestId', 'request_upload_001');
    body.append('file', new Blob([sourceText], { type: 'text/markdown' }), '现行业务操作说明.md');
    const uploadResponse = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body });
    const upload = await uploadResponse.json();
    assert.equal(uploadResponse.status, 200, upload.error || upload.detail);
    assert.equal(upload.data.schema_version, 'document-structured-output-v2');
    assert.equal(upload.documentName, '现行业务操作说明.md');
    assert.equal(upload.referenceMaterial.material_type, '现行业务操作说明');
    assert.equal(upload.referenceMaterial.material_name, '现行业务操作说明.md');
    assert.equal(upload.referenceMaterial.readable_text, sourceText);
    assert.equal(
      upload.referenceMaterial.file_sha256,
      crypto.createHash('sha256').update(Buffer.from(sourceText)).digest('hex')
    );

    const valid = await postJson(baseUrl, '/api/validate', { data: createDraft() });
    assert.equal(valid.response.status, 200);
    assert.equal(valid.body.valid, true, JSON.stringify(valid.body.errors));

    const exported = createDraft();
    exported.behaviors[0].work_role = null;
    exported.reference_materials = [];
    const roundTrip = JSON.parse(`${JSON.stringify(exported, null, 2)}\n`);
    assert.deepEqual(roundTrip, exported, 'exported single-process JSON must survive a JSON round trip');
    const roundTripValidation = await postJson(baseUrl, '/api/validate', { data: roundTrip });
    assert.equal(roundTripValidation.response.status, 200);
    assert.equal(roundTripValidation.body.valid, true, JSON.stringify(roundTripValidation.body.errors));
    assert.equal(roundTrip.forms[0].areas.filter(area => area.area_type === '基本信息').length, 1);
    assert.equal(roundTrip.forms[0].areas.filter(area => area.area_type === '明细清单').length, 2);

    const historicalInternalCall = createDraft();
    historicalInternalCall.internal_process_calls = [{
      call_ref: 'call_historical_preview',
      caller_behavior_ref: 'behavior_apply',
      target_process_ref: null,
      target_process_name: '历史部门内部核验流程',
      input_data_refs: ['data_application'],
      output_data_refs: ['data_application'],
      return_behavior_ref: 'behavior_apply'
    }];
    const historicalInternalCallRoundTrip = JSON.parse(JSON.stringify(historicalInternalCall));
    assert.deepEqual(
      historicalInternalCallRoundTrip.internal_process_calls,
      historicalInternalCall.internal_process_calls,
      'historical internal calls must survive the current-format JSON round trip'
    );
    const historicalInternalCallValidation = await postJson(baseUrl, '/api/validate', {
      data: historicalInternalCallRoundTrip
    });
    assert.equal(
      historicalInternalCallValidation.body.valid,
      true,
      JSON.stringify(historicalInternalCallValidation.body.errors)
    );

    const missingProcess = createDraft();
    delete missingProcess.process;
    const missingProcessValidation = await postJson(baseUrl, '/api/validate', { data: missingProcess });
    assert.equal(missingProcessValidation.body.valid, false);
    assert.ok(missingProcessValidation.body.errors.some(error =>
      error.keyword === 'required' && error.params?.missingProperty === 'process'
    ));

    const incomplete = createDraft();
    incomplete.behaviors = [];
    incomplete.data_objects = [];
    incomplete.forms = [];
    incomplete.reference_materials = [];
    incomplete.process.process_name = '';
    const incompleteValidation = await postJson(baseUrl, '/api/validate', { data: incomplete });
    assert.equal(incompleteValidation.body.valid, true, 'business completeness must not be a hard 3001 validation');

    const duplicate = createDraft();
    duplicate.behaviors.push({ ...duplicate.behaviors[0] });
    const duplicateValidation = await postJson(baseUrl, '/api/validate', { data: duplicate });
    assert.equal(duplicateValidation.body.valid, false);
    assert.ok(duplicateValidation.body.errors.some(error => /重复/.test(error.message)));

    const brokenReference = createDraft();
    brokenReference.behaviors[0].output_data_refs = ['data_missing'];
    const brokenValidation = await postJson(baseUrl, '/api/validate', { data: brokenReference });
    assert.equal(brokenValidation.body.valid, false);
    assert.ok(brokenValidation.body.errors.some(error => /不在当前文件中/.test(error.message)));

    const externalTarget = createDraft();
    externalTarget.cross_department_handoffs.push({
      handoff_ref: 'handoff_external',
      source_department: '财务部',
      target_department: '项目管理部',
      send_behavior_ref: 'behavior_apply',
      receive_behavior_ref: 'external_receive_behavior',
      input_data_ref: 'data_application',
      returned_data_ref: 'data_application',
      requested_matter: '确认项目费用归属',
      trigger_condition: '财务部收到申请后',
      completion_standard: '返回项目归属确认结果',
      target_process_ref: 'external_process',
      target_process_name: '项目费用确认流程',
      target_behavior_ref: 'external_target_behavior',
      target_behavior_name: '接收费用确认申请',
      return_behavior_ref: null
    });
    const externalValidation = await postJson(baseUrl, '/api/validate', { data: externalTarget });
    assert.equal(externalValidation.body.valid, true, 'external target refs are recorded but not resolved by 3001');

    const mismatchedRole = createDraft();
    mismatchedRole.behaviors[0].work_role.behavior_ref = 'another_behavior';
    const roleValidation = await postJson(baseUrl, '/api/validate', { data: mismatchedRole });
    assert.equal(roleValidation.body.valid, false);
    assert.ok(roleValidation.body.errors.some(error => /必须绑定当前业务行为/.test(error.message)));

    const unsupported = await postJson(baseUrl, '/api/validate', { data: { schema_version: 'unknown-v1' } });
    assert.equal(unsupported.response.status, 400);

    const suggestionRoute = await fetch(`${baseUrl}/api/suggestions`, { method: 'POST' });
    assert.equal(suggestionRoute.status, 404);
    const sessionRoute = await fetch(`${baseUrl}/api/session`, { method: 'POST' });
    assert.equal(sessionRoute.status, 404);
    const dataRoute = await fetch(`${baseUrl}/api/data`);
    assert.equal(dataRoute.status, 404);
    const exportRoute = await fetch(`${baseUrl}/api/export`);
    assert.equal(exportRoute.status, 404);

    const cytoscapeAsset = await fetch(`${baseUrl}/vendor/cytoscape.min.js`);
    assert.equal(cytoscapeAsset.status, 200);
    assert.match(cytoscapeAsset.headers.get('content-type') || '', /javascript/);
    assert.ok((await cytoscapeAsset.text()).length > 400000, 'local Cytoscape browser asset must be served');

    const diagramAsset = await fetch(`${baseUrl}/process-diagram.js`);
    assert.equal(diagramAsset.status, 200);
    assert.match(diagramAsset.headers.get('content-type') || '', /javascript/);
  });
}

function testProcessDiagramModel() {
  const draft = createDraft();
  const departmentOrder = ['公司领导', '行政人事部', '经营发展部', '财务部'];
  const makeBehavior = (ref, name, nodeType, actorRole = '财务部会计员') => {
    const behavior = JSON.parse(JSON.stringify(draft.behaviors[0]));
    behavior.behavior_ref = ref;
    behavior.behavior_name = name;
    behavior.node_type = nodeType;
    behavior.current_actor_role = actorRole;
    behavior.work_role.behavior_ref = ref;
    behavior.work_role.work_role_name = `${name}行为的办理角色`;
    behavior.work_role.role_duty = '办理';
    return behavior;
  };
  draft.behaviors = [
    makeBehavior('behavior_action', '提交申请', 'action'),
    makeBehavior('behavior_decision', '判断材料', 'decision', '经营发展部法务'),
    makeBehavior('behavior_split', '并行办理', 'parallel_split', '全公司'),
    makeBehavior('behavior_join', '汇总结果', 'parallel_join', '历史未收录岗位')
  ];
  draft.behaviors[0].countersign_all_required = true;
  draft.behaviors[0].countersign_target_departments = ['工程技术部', '质量管理部'];
  draft.flow_relations = [
    {
      relation_ref: 'relation_sequence',
      relation_type: 'sequence',
      from_behavior_ref: 'behavior_action',
      to_behavior_ref: 'behavior_decision',
      condition: '',
      join_mode: ''
    },
    {
      relation_ref: 'relation_condition',
      relation_type: 'condition',
      from_behavior_ref: 'behavior_decision',
      to_behavior_ref: 'behavior_split',
      condition: '材料齐全',
      join_mode: ''
    },
    {
      relation_ref: 'relation_loop',
      relation_type: 'loop',
      from_behavior_ref: 'behavior_decision',
      to_behavior_ref: 'behavior_action',
      condition: '材料不齐全时退回',
      join_mode: ''
    },
    {
      relation_ref: 'relation_parallel',
      relation_type: 'parallel',
      from_behavior_ref: 'behavior_split',
      to_behavior_ref: 'behavior_join',
      condition: '',
      join_mode: 'all'
    },
    {
      relation_ref: 'relation_incomplete',
      relation_type: '',
      from_behavior_ref: 'behavior_join',
      to_behavior_ref: null,
      condition: '',
      join_mode: ''
    }
  ];
  draft.cross_department_handoffs = [{
    handoff_ref: 'handoff_external',
    source_department: '财务部',
    target_department: '经营发展部',
    send_behavior_ref: 'behavior_join',
    receive_behavior_ref: null,
    input_data_ref: null,
    returned_data_ref: null,
    requested_matter: '确认合同信息',
    trigger_condition: '',
    completion_standard: '',
    target_process_ref: null,
    target_process_name: '',
    target_behavior_ref: null,
    target_behavior_name: '',
    return_behavior_ref: 'behavior_action'
  }];
  draft.internal_process_calls = [{
    call_ref: 'call_internal',
    caller_behavior_ref: 'behavior_decision',
    target_process_ref: null,
    target_process_name: '部门内部核验流程',
    input_data_refs: [],
    output_data_refs: [],
    return_behavior_ref: 'behavior_join'
  }];

  const before = JSON.stringify(draft);
  const model = buildGraphModel(draft, { departmentOrder });
  assert.equal(JSON.stringify(draft), before, 'diagram generation must not mutate the process document');
  assert.equal(model.namedBehaviorCount, 4);
  assert.equal(model.localEdgeCount, 4);
  assert.equal(model.unresolvedCount, 1);
  assert.match(model.unresolvedItems[0].message, /关系类型、终点/);
  assert.deepEqual(
    model.lanes.map(lane => lane.label),
    ['财务部', '经营发展部', '全公司通用', '执行部门待明确'],
    'the owning department must be first and unrecognized actor values must keep a separate lane'
  );
  assert.equal(model.backgrounds.filter(node => node.classes.includes('lane-header-node')).length, 4);
  const actionNode = model.nodes.find(node => node.classes.includes('node-action'));
  const decisionNode = model.nodes.find(node => node.classes.includes('node-decision'));
  const splitNode = model.nodes.find(node => node.classes.includes('node-parallel-split'));
  const joinNode = model.nodes.find(node => node.classes.includes('node-parallel-join'));
  assert.match(actionNode.data.label, /岗位：会计员/);
  assert.match(decisionNode.data.label, /×.*判断材料/);
  assert.match(decisionNode.data.label, /岗位：法务/);
  assert.match(splitNode.data.label, /＋.*并行办理/);
  assert.match(joinNode.data.label, /执行信息：历史未收录岗位/);
  assert.ok(model.nodes.some(node =>
    node.classes.includes('countersign-badge') && node.data.label === '会签×2'
  ));
  assert.ok(actionNode.position.x < decisionNode.position.x, 'explicit local relations must determine left-to-right rank');
  assert.ok(model.pool.width > 0 && model.pool.height > 0);
  const handoffNode = model.nodes.find(node => node.classes.includes('handoff-node'));
  assert.ok(handoffNode && /待明确/.test(handoffNode.data.label));
  assert.ok(handoffNode.position.y > model.pool.height, 'cross-department handoffs must stay outside the swimlane area');
  const internalCallNode = model.nodes.find(node => node.classes.includes('internal-call-node'));
  assert.ok(internalCallNode);
  assert.equal(internalCallNode.data.laneKey, decisionNode.data.laneKey, 'an internal call stays in the caller department lane');
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-sequence')));
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-condition') && /材料齐全/.test(edge.data.label)));
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-loop') && /材料不齐全/.test(edge.data.label)));
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-parallel') && /全部分支完成后汇合/.test(edge.data.label)));
  assert.ok(model.edges.some(edge => edge.classes.includes('message-flow') && edge.data.focusKind === 'handoff'));
  assert.ok(model.edges.some(edge => edge.classes.includes('return-message-flow') && edge.data.focusKind === 'handoff'));
  assert.ok(model.edges.some(edge => edge.classes.includes('internal-return-edge') && edge.data.focusKind === 'call'));
  const repeatModel = buildGraphModel(draft, { departmentOrder });
  assert.deepEqual(
    model.nodes.filter(node => node.position).map(node => ({ id: node.data.id, position: node.position })),
    repeatModel.nodes.filter(node => node.position).map(node => ({ id: node.data.id, position: node.position })),
    'the preset swimlane layout must be deterministic'
  );

  const noRelations = createDraft({
    behaviors: [
      makeBehavior('behavior_first', '第一项行为', 'action'),
      makeBehavior('behavior_second', '第二项行为', '')
    ],
    flow_relations: [],
    cross_department_handoffs: [],
    internal_process_calls: []
  });
  const noRelationModel = buildGraphModel(noRelations, { departmentOrder });
  const noRelationBehaviorNodes = noRelationModel.nodes.filter(node => node.classes.includes('behavior-node'));
  assert.equal(noRelationBehaviorNodes.length, 2);
  assert.equal(noRelationModel.edges.length, 0, 'behavior input order must never create inferred arrows');
  assert.equal(
    noRelationBehaviorNodes[0].position.x,
    noRelationBehaviorNodes[1].position.x,
    'unrelated behavior nodes must share a rank instead of implying sequence by horizontal position'
  );
  assert.ok(noRelationBehaviorNodes.some(node =>
    node.classes.includes('node-pending') && /节点类型待判断/.test(node.data.label)
  ));
  assert.ok(noRelationModel.backgrounds.some(node => node.classes.includes('lane-body-node')));

  const invalidHandoff = createDraft({
    cross_department_handoffs: [{
      handoff_ref: 'handoff_invalid_sender',
      source_department: '财务部',
      target_department: '经营发展部',
      send_behavior_ref: 'behavior_missing',
      receive_behavior_ref: null,
      input_data_ref: null,
      returned_data_ref: null,
      requested_matter: '确认合同信息',
      trigger_condition: '',
      completion_standard: '',
      target_process_ref: null,
      target_process_name: '',
      target_behavior_ref: null,
      target_behavior_name: '',
      return_behavior_ref: null
    }]
  });
  const invalidHandoffModel = buildGraphModel(invalidHandoff, { departmentOrder });
  assert.equal(invalidHandoffModel.edges.some(edge => edge.classes.includes('message-flow')), false);
  assert.ok(invalidHandoffModel.unresolvedItems.some(item => /有效的发送行为/.test(item.message)));

  const complexDepartments = [
    ['财务部', '会计员'],
    ['经营发展部', '法务'],
    ['工程技术部', '技术员'],
    ['质量管理部', '检验员'],
    ['物资保障部', '计划员'],
    ['项目管理部', '项目管理员']
  ];
  const complexBehaviors = Array.from({ length: 40 }, (_, index) => {
    const sequence = index + 1;
    const nodeType = sequence === 8
      ? 'decision'
      : sequence === 14
        ? 'parallel_split'
        : sequence === 19
          ? 'parallel_join'
          : 'action';
    const [department, position] = complexDepartments[index % complexDepartments.length];
    const behavior = makeBehavior(
      `behavior_complex_${sequence}`,
      `代表性复杂流程行为${sequence}`,
      nodeType,
      `${department}${position}`
    );
    behavior.countersign_all_required = sequence === 30;
    behavior.countersign_target_departments = sequence === 30 ? ['工程技术部', '质量管理部', '财务部'] : [];
    return behavior;
  });
  const complexRelations = complexBehaviors.slice(0, -1).map((behavior, index) => {
    const relationType = behavior.node_type === 'decision'
      ? 'condition'
      : behavior.node_type === 'parallel_split'
        ? 'parallel'
        : 'sequence';
    return {
      relation_ref: `relation_complex_${index + 1}`,
      relation_type: relationType,
      from_behavior_ref: behavior.behavior_ref,
      to_behavior_ref: complexBehaviors[index + 1].behavior_ref,
      condition: relationType === 'condition' ? '资料完整' : '',
      join_mode: relationType === 'parallel' ? 'all' : ''
    };
  });
  complexRelations.push({
    relation_ref: 'relation_complex_loop',
    relation_type: 'loop',
    from_behavior_ref: 'behavior_complex_28',
    to_behavior_ref: 'behavior_complex_8',
    condition: '复核不通过',
    join_mode: ''
  });
  const complexDraft = createDraft({
    behaviors: complexBehaviors,
    flow_relations: complexRelations,
    cross_department_handoffs: [{
      handoff_ref: 'handoff_complex',
      source_department: '项目管理部',
      target_department: '行政人事部',
      send_behavior_ref: 'behavior_complex_18',
      receive_behavior_ref: null,
      input_data_ref: null,
      returned_data_ref: null,
      requested_matter: '确认人员安排',
      trigger_condition: '进入跨部门确认环节',
      completion_standard: '返回确认结果',
      target_process_ref: null,
      target_process_name: '人员安排确认流程',
      target_behavior_ref: null,
      target_behavior_name: '确认人员安排',
      return_behavior_ref: 'behavior_complex_19'
    }],
    internal_process_calls: [{
      call_ref: 'call_complex',
      caller_behavior_ref: 'behavior_complex_25',
      target_process_ref: null,
      target_process_name: '部门内部复核流程',
      input_data_refs: [],
      output_data_refs: [],
      return_behavior_ref: 'behavior_complex_26'
    }]
  });
  const complexModel = buildGraphModel(complexDraft, {
    departmentOrder: complexDepartments.map(([department]) => department)
  });
  const complexBehaviorNodes = complexModel.nodes.filter(node => node.classes.includes('behavior-node'));
  assert.equal(complexBehaviorNodes.length, 40);
  assert.equal(complexModel.lanes.length, 6);
  assert.equal(complexModel.unresolvedCount, 0);
  assert.ok(complexModel.edges.some(edge => edge.classes.includes('relation-loop')));
  assert.ok(complexModel.edges.some(edge => edge.classes.includes('message-flow')));
  assert.ok(complexModel.nodes.some(node => node.data.label === '会签×3'));
  assert.equal(
    new Set(complexBehaviorNodes.map(node => `${node.position.x}:${node.position.y}`)).size,
    complexBehaviorNodes.length,
    'the representative 40-behavior flow must not overlap behavior nodes'
  );
}

async function testFrontendContract() {
  const html = fs.readFileSync(frontendPath, 'utf8');
  const diagramSource = fs.readFileSync(processDiagramPath, 'utf8');
  const serverSource = fs.readFileSync(serverPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  scripts.forEach((match, index) => new vm.Script(match[1], { filename: `index-inline-${index}.js` }));

  assert.ok(html.includes('id="newProcessButton"'));
  assert.ok(html.includes('async function fetchEmptyProcessDocument()'));
  assert.ok(html.includes("fetch('/api/template?version=process-governance-v1', { cache: 'no-store' })"));
  assert.ok(html.includes('async function readJsonResponse(response, nonJsonMessage)'));
  assert.ok(html.includes('3001空白模板接口未返回结构化数据'));
  assert.equal(html.includes('function emptyProcessDocument()'), false);
  assert.ok(html.includes("node_type: ''"), 'new behavior node type must default blank');
  assert.ok(html.includes('function splitLegacyDocument'));
  assert.ok(html.includes("parsed.schema_version === 'document-structured-output-v2'"));
  assert.ok(html.includes('当前还有未导出的修改'));
  assert.ok(html.includes('取消'));
  assert.ok(html.includes('先导出当前流程'));
  assert.ok(html.includes('放弃当前内容'));
  assert.ok(html.includes('未审核-${department}-${processName}-${exportTimestamp(now)}.json'));
  assert.ok(html.includes('基本信息'));
  assert.ok(html.includes('目的与范围'));
  assert.ok(html.includes('术语定义'));
  assert.ok(html.includes('流程步骤'));
  assert.ok(html.includes('导出检查'));
  assert.ok(html.includes('表单或记录名称'));
  assert.ok(html.includes('表单或记录编号（如有）'));
  assert.ok(html.includes('主表结构'));
  assert.ok(html.includes('明细表结构'));
  assert.ok(html.includes('填写项'));
  assert.ok(html.includes('add-detail-area'));
  assert.ok(html.includes("area_type: '基本信息'"));
  assert.ok(html.includes("area_type: table.table_kind === 'detail' ? '明细清单' : '基本信息'"));
  assert.ok(html.includes(".filter(field => field.table_ref === table.table_ref)"));
  assert.equal(html.includes('导入参考材料'), false);
  assert.equal(html.includes('id="sourceInput"'), false);
  assert.equal(html.includes('id="dropZone"'), false);
  assert.equal(html.includes("fetch('/api/upload'"), false);
  assert.equal(html.includes('function renderMaterials()'), false);
  assert.equal(html.includes('没有编制参考材料'), false);
  assert.equal(html.includes('正式工作角色编码（可选）'), false);
  assert.equal(html.includes('为当前行为添加工作角色'), false);
  assert.ok(html.includes("fetch('/api/enums', { cache: 'no-store' })"));
  assert.ok(html.includes('rosterRolesByDepartment'));
  assert.ok(html.includes('执行部门和执行岗位'));
  assert.ok(html.includes('全公司通用'));
  assert.ok(html.includes('function actorDepartments()'));
  assert.ok(html.includes('selectableDepartments.forEach(department => departmentOptions.push'));
  assert.ok(html.includes('当前为跨部门执行'));
  assert.ok(html.includes('执行岗位未被所选执行部门的花名册收录'));
  assert.equal(html.includes("parsed.department === ownDepartment || parsed.department === '全公司'"), false);
  assert.ok(html.includes('当前花名册未收录'));
  assert.ok(html.includes('data-actor-department'));
  assert.ok(html.includes('data-actor-position'));
  assert.ok(html.includes('原文件包含与当前业务行为绑定的正式工作角色'));
  assert.ok(html.includes('reference_materials: (Array.isArray(source.reference_materials) ? source.reference_materials : [])'));
  const addBehaviorFunction = html.slice(
    html.indexOf('function addBehavior()'),
    html.indexOf('function addRelation()')
  );
  assert.ok(addBehaviorFunction.includes("current_actor_role: ''"));
  assert.ok(addBehaviorFunction.includes('work_role: null'));
  const addFormFunction = html.slice(
    html.indexOf('function addForm()'),
    html.indexOf('function addTerm()')
  );
  assert.ok(addFormFunction.includes("area_type: '基本信息'"));
  assert.ok(addFormFunction.includes("area_title: ''"));
  assert.ok(addFormFunction.includes('items: []'));
  assert.ok(addFormFunction.includes("form_name: ''"));
  assert.ok(addFormFunction.includes('form_no: null'));
  const workspaceChangeHandler = html.slice(
    html.indexOf("workspace.addEventListener('change'"),
    html.indexOf("workspace.addEventListener('click'")
  );
  assert.equal(workspaceChangeHandler.includes('.form_name'), false);
  assert.equal(workspaceChangeHandler.includes('.behavior_name'), false);
  assert.ok(html.includes('[data-action="select-form"][data-ref="${CSS.escape(form.form_ref)}"]'));
  assert.ok(html.includes('[data-action="select-behavior"][data-ref="${CSS.escape(behavior.behavior_ref)}"]'));
  assert.ok(html.includes('cross_department_handoffs'));
  assert.ok(html.includes('internal_process_calls'));
  assert.ok(html.includes('countersign_all_required'));
  assert.ok(html.includes('countersign_target_departments'));
  assert.ok(html.includes('returned_data_ref'));
  assert.ok(html.includes("fetch('/api/schema', { cache: 'no-store' })"));
  const newProcessFunction = html.slice(
    html.indexOf('async function startNewProcess()'),
    html.indexOf('function clearPage()')
  );
  assert.ok(
    newProcessFunction.indexOf("await ensureCompatibleValidationService('再次新建流程');") <
      newProcessFunction.indexOf('await fetchEmptyProcessDocument();'),
    'new process must verify the active backend structure before fetching its blank template'
  );
  assert.ok(html.includes('3001前端与服务端版本不一致'));
  assert.ok(html.includes('当前流程文件中的技术引用已断开或重复'));
  assert.ok(html.includes('当前流程文件不符合3001单流程导出格式'));
  const exportFunction = html.slice(
    html.indexOf('async function exportCurrent()'),
    html.indexOf('function protect(action)')
  );
  assert.ok(
    exportFunction.indexOf('await ensureCompatibleValidationService();') <
      exportFunction.indexOf("fetch('/api/validate'"),
    'export must verify the server structure before validating the document'
  );
  assert.equal(
    html.includes('因培训成果显著，目前该工具不再使用DeepSeek辅助填报。'),
    false,
    'the retired model notice must not occupy the business page'
  );
  assert.equal(
    html.includes('3001不保存草稿，不与3000通信，也不代表审核通过。'),
    false,
    'the general system-boundary notice must not occupy the business page'
  );
  assert.equal((html.match(/DeepSeek/g) || []).length, 0, 'the business page must not mention the retired model');
  assert.ok(html.includes('为当前行为添加跨部门承接'));
  assert.ok(html.includes('完善承接信息'));
  assert.ok(html.includes('由哪个本流程行为发起'));
  assert.ok(html.includes("addHandoff(text(element.dataset.ref))"));
  assert.ok(html.includes('删除当前业务行为将同时删除'));
  assert.ok(html.includes('部门内调用仅用于预览，请在MDM平台正式功能中维护。'));
  assert.ok(html.includes('当前业务行为被${internalCallCount}条部门内调用预览信息引用'));
  assert.ok(html.includes('当前数据被${internalCallCount}条部门内调用预览信息引用'));
  assert.equal(
    html.includes('currentDocument().internal_process_calls ='),
    false,
    'the text editor must not clear or rewrite hidden historical internal calls'
  );
  assert.equal(html.includes("{ value: 'calls', label: '部门内调用' }"), false);
  assert.equal(html.includes('function renderInternalCalls()'), false);
  assert.equal(html.includes('function addInternalCall()'), false);
  assert.equal(html.includes('data-action="add-call"'), false);
  assert.equal(html.includes('data-action="remove-call"'), false);
  assert.ok(html.includes('文字编制'));
  assert.ok(html.includes('跨职能流程图预览'));
  assert.ok(html.includes('什么时候可以查看跨职能流程图'));
  assert.ok(html.includes('系统不会按录入顺序自动连线'));
  assert.ok(html.includes('该图根据导入内容生成，仅用于核对，不代表已经审核'));
  assert.ok(html.includes('有 ${model.unresolvedCount} 项内容无法绘制'));
  ['业务行为', '判断', '并行', '流程关系', '跨部门承接', '内部流程调用', '类型待判断']
    .forEach(label => assert.ok(html.includes(`<strong>${label}</strong>`), `diagram legend must include ${label}`));
  assert.ok(html.includes('先看泳道确认责任部门，再沿实线箭头从左向右阅读；虚线箭头表示跨部门承接。'));
  assert.ok(html.includes('查看图例示例'));
  assert.ok(html.includes('BPMN 2.0.2图形子集'));
  assert.ok(html.includes('data-action="toggle-diagram-example"'));
  assert.ok(html.includes('data-action="toggle-diagram-expanded"'));
  assert.ok(html.includes('展开查看'));
  assert.ok(html.includes('适应画布'));
  assert.ok(html.includes('重置视图'));
  assert.ok(html.includes('let diagramExampleExpanded = false'));
  assert.ok(html.includes('let diagramExpanded = false'));
  assert.equal(html.includes('显示数据对象'), false);
  assert.ok(html.includes('selectInitialTabAfterImport();'));
  assert.ok(html.includes("activeEditorSection = 'process'"));
  assert.ok(html.includes('<script src="/vendor/cytoscape.min.js"></script>'));
  assert.ok(html.includes('<script src="process-diagram.js"></script>'));
  assert.match(diagramSource, /autoungrabify:\s*true/);
  assert.match(diagramSource, /buildGraphModel/);
  assert.match(diagramSource, /name:\s*'preset'/);
  assert.ok(diagramSource.includes('lane-header-node'));
  assert.ok(diagramSource.includes('countersign-badge'));
  assert.ok(diagramSource.includes("'curve-style': 'taxi'"));
  assert.ok(diagramSource.includes("'source-arrow-fill': 'hollow'"));
  assert.ok(diagramSource.includes("'target-arrow-fill': 'hollow'"));
  assert.ok(diagramSource.includes("'line-style': 'solid'"));
  assert.equal(diagramSource.includes('data_objects'), false, 'the main diagram must not render data objects');
  assert.equal(/bpmn(?:-js)?|BPMN XML/i.test(diagramSource), false, 'the preview must not add a BPMN engine or XML');
  assert.equal(/https?:\/\//.test(diagramSource), false, 'diagram runtime must not depend on a CDN');
  assert.ok(serverSource.includes("app.get('/vendor/cytoscape.min.js'"));
  assert.equal(/\/api\/suggestions/.test(html), false);
  assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie|sessionId|\/api\/session/.test(html), false);
  assert.equal(/fetch\([^)]*3000|localhost:3000|127\.0\.0\.1:3000/.test(html), false);
  assert.equal(/DeepSeek|deepSeek|DEEPSEEK|CC Switch|Anthropic/.test(serverSource), false);
  assert.equal(/api\/suggestions/.test(serverSource), false);
  assert.match(
    serverSource,
    /const HOST = process\.env\.STRUCTURED_OUTPUT_HOST \|\| '0\.0\.0\.0';/,
    '3001 must listen on all interfaces by default so LAN users can connect directly'
  );
}

async function main() {
  await testSchemas();
  await testDeterministicParser();
  await testApi();
  testProcessDiagramModel();
  await testFrontendContract();
  console.log('structured-output-service structure rules tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
