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
const structureScorePath = path.join(appRoot, 'public', 'structure-score.js');
const serverPath = path.join(appRoot, 'server.js');
const processV1SchemaPath = path.join(repoRoot, 'docs', 'contracts', 'process-governance-v1.schema.json');
const processV2SchemaPath = path.join(repoRoot, 'docs', 'contracts', 'process-governance-v2.schema.json');
const processSchemaPath = path.join(repoRoot, 'docs', 'contracts', 'process-governance-v3.schema.json');
const legacySchemaPath = path.join(repoRoot, 'docs', 'contracts', 'document-structured-output.schema.json');
const { buildGraphModel } = require(processDiagramPath);

function createDraft(overrides = {}) {
  const behavior = {
    behavior_ref: 'behavior_apply',
    node_type: 'action',
    behavior_name: '费用申请',
    behavior_description: '申请人核对报销事项并提交报销材料。',
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
    schema_version: 'process-governance-v3',
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
      form_design_state: 'current_state',
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
  const processV2Schema = JSON.parse(fs.readFileSync(processV2SchemaPath, 'utf8'));
  const processV1Schema = JSON.parse(fs.readFileSync(processV1SchemaPath, 'utf8'));
  const legacySchema = JSON.parse(fs.readFileSync(legacySchemaPath, 'utf8'));
  const processAjv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  processAjv.addSchema(processV1Schema);
  processAjv.addSchema(processV2Schema);
  const processValidator = processAjv.compile(processSchema);
  const processV2Validator = processAjv.getSchema(processV2Schema.$id);
  const processV1Validator = processAjv.getSchema(processV1Schema.$id);
  const legacyValidator = new Ajv2020({ allErrors: true, strict: false }).compile(legacySchema);
  assert.match(processSchema.properties.process.$ref, /process-governance-v1/);
  assert.equal(processV1Schema.$defs.process.type, 'object');
  assert.equal(Object.prototype.hasOwnProperty.call(processSchema.properties, 'processes'), false);
  assert.equal(processSchema.properties.schema_version.const, 'process-governance-v3');
  assert.deepEqual(processSchema.$defs.formOrRecord.properties.form_design_state.enum, [
    'unspecified',
    'current_state',
    'proposed_design'
  ]);
  assert.equal(processV1Schema.$defs.behavior.properties.behavior_description.type, 'string');
  assert.equal(
    processV1Schema.$defs.behavior.required.includes('behavior_description'),
    false,
    'the supplemental behavior description must remain optional for legacy JSON compatibility'
  );
  assert.equal(processValidator(createDraft()), true, JSON.stringify(processValidator.errors));
  const legacyDraftWithoutBehaviorDescription = createDraft();
  legacyDraftWithoutBehaviorDescription.schema_version = 'process-governance-v1';
  delete legacyDraftWithoutBehaviorDescription.forms[0].form_design_state;
  delete legacyDraftWithoutBehaviorDescription.behaviors[0].behavior_description;
  assert.equal(
    processV1Validator(legacyDraftWithoutBehaviorDescription),
    true,
    'previous process-governance-v1 JSON without behavior_description must remain valid'
  );
  const previousV2Draft = createDraft();
  previousV2Draft.schema_version = 'process-governance-v2';
  delete previousV2Draft.forms[0].form_design_state;
  assert.equal(processV2Validator(previousV2Draft), true, 'process-governance-v2 must remain valid without v3 fields');
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
    assert.equal(health.body.schema_version, 'process-governance-v3');
    assert.equal(Object.prototype.hasOwnProperty.call(health.body, 'deepseek'), false);

    const schema = await getJson(baseUrl, '/api/schema');
    assert.equal(schema.body.properties.schema_version.const, 'process-governance-v3');
    const behaviorSchema = schema.body.$defs.behavior;
    assert.deepEqual(behaviorSchema.properties.actor_assignment_mode.enum, [
      'fixed_department',
      'company_wide',
      'dynamic_from_data'
    ]);
    assert.ok(behaviorSchema.properties.actor_department_data_ref);
    assert.ok(behaviorSchema.properties.actor_position_rule);
    assert.equal(schema.response.headers.get('cache-control'), 'no-store');
    assert.equal(schema.response.headers.get('x-infomat-schema-digest'), PROCESS_GOVERNANCE_SCHEMA_DIGEST);
    const legacySchema = await getJson(baseUrl, '/api/schema?version=document-structured-output-v2');
    assert.equal(legacySchema.body.properties.schema_version.const, 'document-structured-output-v2');

    const previousSchema = await getJson(baseUrl, '/api/schema?version=process-governance-v2');
    assert.equal(previousSchema.body.properties.schema_version.const, 'process-governance-v2');

    const template = await getJson(baseUrl, '/api/template?version=process-governance-v3');
    assert.equal(template.response.status, 200);
    assert.equal(template.response.headers.get('cache-control'), 'no-store');
    assert.equal(template.body.schema_version, 'process-governance-v3');
    assert.equal(template.body.schema_digest, PROCESS_GOVERNANCE_SCHEMA_DIGEST);
    assert.equal(template.body.data.schema_version, 'process-governance-v3');
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
    assert.deepEqual(
      enums.body.fieldType,
      ['文本', '长文本', '数字', '日期', '日期时间', '金额', '枚举', '布尔', '部门', '人员', '文件编号', '签名', '图片', '附件', '二维码']
    );
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

    const dynamicActor = createDraft();
    dynamicActor.behaviors[0].current_actor_role = '';
    dynamicActor.behaviors[0].actor_assignment_mode = 'dynamic_from_data';
    dynamicActor.behaviors[0].actor_department_data_ref = 'data_application';
    dynamicActor.behaviors[0].actor_position_rule = '由数据中的责任部门确定办理人';
    const dynamicActorValidation = await postJson(baseUrl, '/api/validate', { data: dynamicActor });
    assert.equal(dynamicActorValidation.body.valid, true, JSON.stringify(dynamicActorValidation.body.errors));
    assert.equal(dynamicActorValidation.body.data.behaviors[0].actor_department_data_ref, 'data_application');

    const brokenDynamicActor = JSON.parse(JSON.stringify(dynamicActor));
    brokenDynamicActor.behaviors[0].actor_department_data_ref = 'data_missing';
    const brokenDynamicActorValidation = await postJson(baseUrl, '/api/validate', { data: brokenDynamicActor });
    assert.equal(brokenDynamicActorValidation.body.valid, false);
    assert.ok(brokenDynamicActorValidation.body.errors.some(error => /动态执行部门来源数据/.test(error.message)));

    const exported = createDraft();
    exported.behaviors[0].work_role = null;
    exported.reference_materials = [];
    const roundTrip = JSON.parse(`${JSON.stringify(exported, null, 2)}\n`);
    assert.deepEqual(roundTrip, exported, 'exported single-process JSON must survive a JSON round trip');
    assert.equal(
      roundTrip.behaviors[0].behavior_description,
      '申请人核对报销事项并提交报销材料。',
      'the supplemental behavior description must survive export and re-import'
    );
    const roundTripValidation = await postJson(baseUrl, '/api/validate', { data: roundTrip });
    assert.equal(roundTripValidation.response.status, 200);
    assert.equal(roundTripValidation.body.valid, true, JSON.stringify(roundTripValidation.body.errors));
    assert.equal(roundTrip.forms[0].areas.filter(area => area.area_type === '基本信息').length, 1);
    assert.equal(roundTrip.forms[0].areas.filter(area => area.area_type === '明细清单').length, 2);

    const historicalExternalActor = createDraft();
    historicalExternalActor.behaviors[0].current_actor_role = '物资保障部计划员';
    const historicalExternalActorRoundTrip = JSON.parse(JSON.stringify(historicalExternalActor));
    const historicalExternalActorValidation = await postJson(baseUrl, '/api/validate', {
      data: historicalExternalActorRoundTrip
    });
    assert.equal(historicalExternalActorValidation.body.valid, true, JSON.stringify(historicalExternalActorValidation.body.errors));
    assert.equal(
      historicalExternalActorValidation.body.data.behaviors[0].current_actor_role,
      '物资保障部计划员',
      'a historical external actor must survive validation, export, and re-import unchanged'
    );

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

    const previousV1 = createDraft();
    previousV1.schema_version = 'process-governance-v1';
    delete previousV1.behaviors[0].behavior_description;
    delete previousV1.forms[0].form_design_state;
    const previousV1Validation = await postJson(baseUrl, '/api/validate', { data: previousV1 });
    assert.equal(
      previousV1Validation.body.valid,
      true,
      'the validation API must accept previous v1 files without the optional supplemental description'
    );
    const previousV2 = createDraft();
    previousV2.schema_version = 'process-governance-v2';
    delete previousV2.forms[0].form_design_state;
    const previousV2Validation = await postJson(baseUrl, '/api/validate', { data: previousV2 });
    assert.equal(previousV2Validation.body.valid, true, 'the validation API must continue accepting v2 files');

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
      handoff_direction: 'outbound_followup',
      anchor_behavior_ref: 'behavior_apply',
      counterparty_resolution: 'identified',
      source_department: '财务部',
      target_department: '项目管理部',
      transfer_data_ref: 'data_application',
      returned_data_ref: 'data_application',
      requested_matter: '确认项目费用归属',
      trigger_condition: '财务部收到申请后',
      completion_standard: '返回项目归属确认结果',
      counterparty_process_ref: 'external_process',
      counterparty_process_name: '项目费用确认流程',
      counterparty_behavior_ref: 'external_target_behavior',
      counterparty_behavior_name: '接收费用确认申请',
      requires_return: true,
      resume_behavior_ref: null
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

    const scoreAsset = await fetch(`${baseUrl}/structure-score.js`);
    assert.equal(scoreAsset.status, 200);
    assert.match(scoreAsset.headers.get('content-type') || '', /javascript/);
    assert.match(await scoreAsset.text(), /structure-learning-score-v1/);
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
  draft.behaviors[0].behavior_description = '该说明仅用于文字沟通，不进入流程图节点。';
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
    handoff_direction: 'outbound_followup',
    anchor_behavior_ref: 'behavior_join',
    counterparty_resolution: 'identified',
    source_department: '财务部',
    target_department: '经营发展部',
    transfer_data_ref: null,
    returned_data_ref: null,
    requested_matter: '确认合同信息',
    trigger_condition: '',
    completion_standard: '',
    counterparty_process_ref: null,
    counterparty_process_name: '',
    counterparty_behavior_ref: null,
    counterparty_behavior_name: '',
    requires_return: true,
    resume_behavior_ref: 'behavior_action'
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
  assert.equal(model.localEdgeCount, 5);
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
  assert.match(actionNode.data.rawLabel, /岗位：会计员/);
  assert.doesNotMatch(actionNode.data.rawLabel, /仅用于文字沟通/);
  assert.match(decisionNode.data.rawLabel, /×.*判断材料/);
  assert.match(decisionNode.data.rawLabel, /岗位：法务/);
  assert.match(splitNode.data.rawLabel, /＋.*并行办理/);
  assert.match(joinNode.data.rawLabel, /执行信息：历史未收录岗位/);
  assert.ok(model.nodes.some(node =>
    node.classes.includes('countersign-badge') && node.data.label === '会签×2'
  ));
  assert.ok(actionNode.position.x < decisionNode.position.x, 'explicit local relations must determine left-to-right rank');
  assert.ok(model.pool.width > 0 && model.pool.height > 0);
  const handoffNode = model.nodes.find(node => node.classes.includes('handoff-node'));
  assert.ok(handoffNode && /办理动作：待填写/.test(handoffNode.data.label));
  assert.equal(handoffNode.data.laneKey, '经营发展部', 'a cross-department todo belongs to the receiving department lane');
  assert.ok(handoffNode.position.y < model.pool.height, 'cross-department todos must stay inside the swimlane area');
  const internalCallNode = model.nodes.find(node => node.classes.includes('internal-call-node'));
  assert.ok(internalCallNode);
  assert.equal(internalCallNode.data.laneKey, decisionNode.data.laneKey, 'an internal call stays in the caller department lane');
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-sequence')));
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-condition') && /材料齐全/.test(edge.data.rawLabel)));
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-loop') && /材料不齐全/.test(edge.data.rawLabel)));
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-parallel') && /全部分支完成后汇合/.test(edge.data.rawLabel)));
  assert.ok(model.edges.some(edge => edge.classes.includes('message-flow') && edge.data.focusKind === 'handoff'));
  assert.ok(model.edges.some(edge => edge.classes.includes('return-message-flow') && edge.data.focusKind === 'handoff'));
  assert.ok(model.edges.some(edge => edge.classes.includes('internal-return-edge') && edge.data.focusKind === 'call'));
  const repeatModel = buildGraphModel(draft, { departmentOrder });
  assert.deepEqual(
    model.nodes.filter(node => node.position).map(node => ({ id: node.data.id, position: node.position })),
    repeatModel.nodes.filter(node => node.position).map(node => ({ id: node.data.id, position: node.position })),
    'the preset swimlane layout must be deterministic'
  );

  const dynamicDraft = createDraft();
  dynamicDraft.behaviors[0].current_actor_role = '';
  dynamicDraft.behaviors[0].actor_assignment_mode = 'dynamic_from_data';
  dynamicDraft.behaviors[0].actor_department_data_ref = 'data_application';
  dynamicDraft.behaviors[0].actor_position_rule = '由责任部门确定办理人';
  const dynamicModel = buildGraphModel(dynamicDraft, { departmentOrder });
  assert.deepEqual(dynamicModel.lanes.map(lane => lane.label), ['运行时责任部门']);
  const dynamicNode = dynamicModel.nodes.find(node => node.classes.includes('dynamic-actor-node'));
  assert.ok(dynamicNode);
  assert.match(dynamicNode.data.rawLabel, /按“费用报销申请”动态确定/);
  assert.equal(dynamicModel.edges.some(edge => edge.classes.includes('message-flow')), false);

  const companyWideDraft = createDraft();
  companyWideDraft.behaviors[0].current_actor_role = '全公司';
  companyWideDraft.behaviors[0].actor_assignment_mode = 'company_wide';
  const companyWideModel = buildGraphModel(companyWideDraft, { departmentOrder });
  assert.deepEqual(companyWideModel.lanes.map(lane => lane.label), ['全公司通用']);
  assert.equal(companyWideModel.nodes.some(node => node.classes.includes('external-node')), false);

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
      handoff_direction: 'outbound_followup',
      anchor_behavior_ref: 'behavior_missing',
      counterparty_resolution: 'identified',
      source_department: '财务部',
      target_department: '经营发展部',
      transfer_data_ref: null,
      returned_data_ref: null,
      requested_matter: '确认合同信息',
      trigger_condition: '',
      completion_standard: '',
      counterparty_process_ref: null,
      counterparty_process_name: '',
      counterparty_behavior_ref: null,
      counterparty_behavior_name: '',
      requires_return: false,
      resume_behavior_ref: null
    }]
  });
  const invalidHandoffModel = buildGraphModel(invalidHandoff, { departmentOrder });
  assert.equal(invalidHandoffModel.edges.some(edge => edge.classes.includes('message-flow')), false);
  assert.ok(invalidHandoffModel.unresolvedItems.some(item => /有效的本流程关联行为/.test(item.message)));

  const pendingDepartmentHandoff = createDraft({
    cross_department_handoffs: [{
      handoff_ref: 'handoff_pending_department',
      handoff_direction: 'outbound_followup',
      anchor_behavior_ref: 'behavior_apply',
      counterparty_resolution: 'needs_identification',
      source_department: '财务部',
      target_department: '',
      transfer_data_ref: null,
      returned_data_ref: null,
      requested_matter: '确认外部事项',
      trigger_condition: '本部门行为完成后',
      completion_standard: '返回确认结果',
      counterparty_process_ref: null,
      counterparty_process_name: '',
      counterparty_behavior_ref: null,
      counterparty_behavior_name: '处理外部事项',
      requires_return: false,
      resume_behavior_ref: null
    }]
  });
  const pendingDepartmentModel = buildGraphModel(pendingDepartmentHandoff, { departmentOrder });
  const pendingDepartmentNode = pendingDepartmentModel.nodes.find(node => node.classes.includes('handoff-node'));
  assert.equal(pendingDepartmentNode.data.laneKey, '__pending_handoff_department__');
  assert.ok(pendingDepartmentModel.lanes.some(lane => lane.label === '承接部门待明确'));

  const linkedCrossDepartmentDraft = createDraft({
    behaviors: [
      makeBehavior('behavior_local_start', '提交工装申请', 'action', '财务部会计员'),
      makeBehavior('behavior_external_issue', '发放工装序列号', 'action', '经营发展部计划员')
    ],
    flow_relations: [],
    internal_process_calls: [],
    cross_department_handoffs: [{
      handoff_ref: 'handoff_linked_behavior',
      handoff_direction: 'outbound_followup',
      anchor_behavior_ref: 'behavior_local_start',
      counterparty_resolution: 'identified',
      source_department: '财务部',
      target_department: '经营发展部',
      transfer_data_ref: null,
      returned_data_ref: null,
      requested_matter: '发放工装序列号',
      trigger_condition: '提交工装申请完成后',
      completion_standard: '',
      counterparty_process_ref: null,
      counterparty_process_name: '',
      counterparty_behavior_ref: 'behavior_external_issue',
      counterparty_behavior_name: '',
      requires_return: false,
      resume_behavior_ref: null
    }]
  });
  const linkedBefore = JSON.stringify(linkedCrossDepartmentDraft);
  const linkedModel = buildGraphModel(linkedCrossDepartmentDraft, { departmentOrder });
  assert.equal(JSON.stringify(linkedCrossDepartmentDraft), linkedBefore, 'linked diagram generation must not mutate the draft');
  assert.equal(linkedModel.nodes.filter(node => node.classes.includes('behavior-node')).length, 2);
  assert.equal(linkedModel.nodes.filter(node => node.classes.includes('handoff-node')).length, 0, 'a linked handoff must reuse the external behavior node');
  const linkedExternalNode = linkedModel.nodes.find(node => node.data.focusRef === 'behavior_external_issue');
  assert.ok(linkedExternalNode.classes.includes('linked-external-behavior'));
  assert.ok(linkedExternalNode.classes.includes('external-node'));
  assert.equal(linkedExternalNode.data.laneKey, '经营发展部');
  assert.ok(linkedModel.edges.some(edge =>
    edge.classes.includes('message-flow')
    && edge.data.focusKind === 'behavior'
    && edge.data.focusRef === 'behavior_external_issue'
  ));
  assert.equal(linkedModel.localEdgeCount, 1);

  const readabilityDraft = createDraft({
    behaviors: [
      makeBehavior(
        'behavior_compile_report',
        '编制管理评审报告（含评审结论、改进决定、资源需求）',
        'action',
        '财务部会计员'
      ),
      makeBehavior(
        'behavior_review_report',
        '审核管理评审报告',
        'decision',
        '财务部财务负责人'
      ),
      makeBehavior(
        'behavior_approve_report',
        '批准管理评审报告',
        'decision',
        '财务部财务负责人'
      )
    ],
    flow_relations: [
      {
        relation_ref: 'relation_compile_to_review',
        relation_type: 'sequence',
        from_behavior_ref: 'behavior_compile_report',
        to_behavior_ref: 'behavior_review_report',
        condition: '',
        join_mode: ''
      },
      {
        relation_ref: 'relation_review_to_approve',
        relation_type: 'condition',
        from_behavior_ref: 'behavior_review_report',
        to_behavior_ref: 'behavior_approve_report',
        condition: '报告内容完整，数据准确，意见合理。',
        join_mode: ''
      },
      {
        relation_ref: 'relation_review_to_compile',
        relation_type: 'loop',
        from_behavior_ref: 'behavior_review_report',
        to_behavior_ref: 'behavior_compile_report',
        condition: '报告内容不完整，数据不准确，意见不合理。',
        join_mode: ''
      },
      {
        relation_ref: 'relation_approve_to_compile',
        relation_type: 'loop',
        from_behavior_ref: 'behavior_approve_report',
        to_behavior_ref: 'behavior_compile_report',
        condition: '报告内容不完整，数据不准确，意见不合理。',
        join_mode: ''
      }
    ],
    cross_department_handoffs: [],
    internal_process_calls: []
  });
  const readabilityBefore = JSON.stringify(readabilityDraft);
  const readabilityModel = buildGraphModel(readabilityDraft, { departmentOrder });
  assert.equal(
    JSON.stringify(readabilityDraft),
    readabilityBefore,
    'display wrapping and route allocation must not modify the imported process JSON'
  );
  assert.equal(readabilityModel.reviewCount, 0, 'explicit internal loops must not produce relation type review items');
  const readabilityNodes = readabilityModel.nodes.filter(node => node.classes.includes('behavior-node'));
  readabilityNodes.forEach(node => {
    assert.equal(
      node.data.label.replace(/\n/g, ''),
      node.data.rawLabel.replace(/\n/g, ''),
      'display-only line breaks must preserve every node label character'
    );
    assert.ok(node.data.labelHeight <= node.data.nodeHeight, 'the wrapped node label must fit inside the node height');
    assert.ok(node.data.textMaxWidth < node.data.nodeWidth, 'the wrapped node label must fit inside the node width');
  });
  const longActionNode = readabilityNodes.find(node => node.data.focusRef === 'behavior_compile_report');
  assert.ok(longActionNode.data.labelLineCount >= 3, 'continuous long Chinese names must wrap onto multiple lines');
  const readabilityRelations = readabilityModel.edges.filter(edge => edge.data.focusKind === 'relation');
  readabilityRelations.forEach(edge => {
    assert.equal(
      edge.data.label.replace(/\n/g, ''),
      edge.data.rawLabel.replace(/\n/g, ''),
      'display-only line breaks must preserve every relation label character'
    );
    assert.ok(edge.data.labelWidth <= 220, 'relation labels must use the agreed maximum width');
  });
  const trackedReadabilityRelations = readabilityRelations.filter(edge =>
    ['relation_review_to_approve', 'relation_review_to_compile', 'relation_approve_to_compile']
      .includes(edge.data.focusRef)
  );
  assert.equal(
    new Set(trackedReadabilityRelations.map(edge => edge.data.routeTrackKey)).size,
    trackedReadabilityRelations.length,
    'the decision branch and two return paths must use separately identifiable tracks'
  );
  const readabilityLoops = readabilityRelations.filter(edge => edge.classes.includes('relation-loop'));
  assert.equal(new Set(readabilityLoops.map(edge => edge.data.routeOffset)).size, 2);
  assert.ok(readabilityLoops.every(edge => edge.data.routePlacement === 'lower'));
  assert.ok(
    readabilityModel.layout.rankPositions[1] - readabilityModel.layout.rankPositions[0] >= 440,
    'adjacent diagram ranks must leave at least the minimum safe gap'
  );
  assert.equal(
    readabilityModel.layout.collisions.length,
    0,
    'the screenshot regression model must not contain node, label, or route-track collisions'
  );

  const cycleDraft = JSON.parse(JSON.stringify(readabilityDraft));
  cycleDraft.flow_relations[2].relation_type = 'condition';
  cycleDraft.flow_relations[3].relation_type = 'condition';
  const cycleBefore = JSON.stringify(cycleDraft);
  const cycleModel = buildGraphModel(cycleDraft, { departmentOrder });
  assert.equal(JSON.stringify(cycleDraft), cycleBefore, 'cycle review must not rewrite relation types or source JSON');
  assert.equal(cycleModel.reviewCount, 4);
  assert.ok(cycleModel.reviewItems.every(item =>
    item.focusKind === 'relation'
      && item.message === '该关系与其他非回路关系形成闭环；如果这是退回前序行为，请选择“流程内部回路”。'
  ));
  assert.equal(
    new Set(cycleModel.nodes
      .filter(node => node.classes.includes('behavior-node'))
      .map(node => `${node.position.x}:${node.position.y}`)).size,
    3,
    'nodes in a non-loop cycle group must retain deterministic distinct positions'
  );
  assert.ok(
    cycleModel.nodes.find(node => node.data.focusRef === 'behavior_compile_report').position.x
      < cycleModel.nodes.find(node => node.data.focusRef === 'behavior_review_report').position.x
  );

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
      handoff_direction: 'outbound_followup',
      anchor_behavior_ref: 'behavior_complex_18',
      counterparty_resolution: 'identified',
      source_department: '项目管理部',
      target_department: '行政人事部',
      transfer_data_ref: null,
      returned_data_ref: null,
      requested_matter: '确认人员安排',
      trigger_condition: '进入跨部门确认环节',
      completion_standard: '返回确认结果',
      counterparty_process_ref: null,
      counterparty_process_name: '人员安排确认流程',
      counterparty_behavior_ref: null,
      counterparty_behavior_name: '确认人员安排',
      requires_return: true,
      resume_behavior_ref: 'behavior_complex_19'
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
  assert.equal(complexModel.lanes.length, 7, 'the receiving department adds its own swimlane');
  assert.equal(complexModel.unresolvedCount, 0);
  assert.ok(complexModel.edges.some(edge => edge.classes.includes('relation-loop')));
  assert.ok(complexModel.edges.some(edge => edge.classes.includes('message-flow')));
  assert.ok(complexModel.nodes.some(node => node.data.label === '会签×3'));
  assert.equal(
    new Set(complexBehaviorNodes.map(node => `${node.position.x}:${node.position.y}`)).size,
    complexBehaviorNodes.length,
    'the representative 40-behavior flow must not overlap behavior nodes'
  );
  const behaviorBounds = complexBehaviorNodes.map(node => ({
    id: node.data.id,
    x1: node.position.x - node.data.nodeWidth / 2,
    x2: node.position.x + node.data.nodeWidth / 2,
    y1: node.position.y - node.data.nodeHeight / 2,
    y2: node.position.y + node.data.nodeHeight / 2
  }));
  behaviorBounds.forEach((left, leftIndex) => {
    behaviorBounds.slice(leftIndex + 1).forEach(right => {
      const overlaps = left.x1 < right.x2
        && left.x2 > right.x1
        && left.y1 < right.y2
        && left.y2 > right.y1;
      assert.equal(overlaps, false, `${left.id} and ${right.id} must have separate node boundaries`);
    });
  });
  assert.equal(
    complexModel.layout.collisions.length,
    0,
    'the representative 40-behavior flow must keep nodes, labels, and route tracks separate'
  );
}

async function testFrontendContract() {
  const html = fs.readFileSync(frontendPath, 'utf8');
  const diagramSource = fs.readFileSync(processDiagramPath, 'utf8');
  const structureScoreSource = fs.readFileSync(structureScorePath, 'utf8');
  const serverSource = fs.readFileSync(serverPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  scripts.forEach((match, index) => new vm.Script(match[1], { filename: `index-inline-${index}.js` }));

  assert.ok(html.includes('id="newProcessButton"'));
  assert.ok(html.includes('class="app-shell"'));
  assert.ok(html.includes('class="task-sidebar" id="taskSidebar"'));
  assert.match(html, /\.app-shell\s*\{[\s\S]*?grid-template-columns:\s*300px minmax\(0, 1fr\)/);
  assert.match(html, /body\s*\{[\s\S]*?min-width:\s*1280px/);
  assert.ok(html.includes('id="candidateList" role="listbox"'));
  assert.ok(html.includes('data-candidate-index="${index}"'));
  assert.ok(html.includes('title="${escapeAttribute(fullLabel)}"'));
  assert.ok(html.includes('aria-label="${escapeAttribute(fullLabel)}"'));
  assert.equal(html.includes('id="candidateSelect"'), false);
  assert.ok(html.includes('id="workspaceViewSwitch"'));
  assert.ok(html.includes('renderWorkspaceTabs(null, true)'));
  assert.ok(html.includes('class="sidebar-completion"'));
  assert.ok(html.includes('role="status" aria-live="polite"'));
  assert.ok(html.includes('请使用宽度不低于1280px的桌面窗口'));
  assert.match(html, /@media \(max-width: 1279px\)[\s\S]*?\.desktop-width-notice\s*\{\s*display:\s*block/);
  assert.equal(html.includes('@media (max-width: 900px)'), false);
  assert.ok(html.includes('let protectedActionInvoker = null;'));
  assert.ok(html.includes('protectedActionInvoker = document.activeElement instanceof HTMLElement'));
  assert.ok(html.includes('protectedActionInvoker?.isConnected'));
  const candidateSwitchSource = html.slice(
    html.indexOf("    candidateList.addEventListener('click'"),
    html.indexOf("    workspaceViewSwitch.addEventListener('click'")
  );
  assert.ok(candidateSwitchSource.includes('currentIndex = nextIndex'));
  assert.ok(candidateSwitchSource.includes('selectInitialTabAfterImport()'));
  assert.ok(candidateSwitchSource.includes('render()'));
  assert.equal(candidateSwitchSource.includes('touch()'), false, 'switching the visible candidate must not mark or rewrite it');
  assert.equal(candidateSwitchSource.includes('protect('), false, 'switching candidates keeps other in-memory drafts and needs no discard prompt');
  assert.ok(html.includes('async function fetchEmptyProcessDocument()'));
  assert.ok(html.includes("fetch('/api/template?version=process-governance-v3', { cache: 'no-store' })"));
  assert.ok(html.includes("const EXPECTED_EXPORT_SCHEMA_VERSION = 'process-governance-v3'"));
  assert.ok(html.includes('添加前置跨部门行为'));
  assert.ok(html.includes('添加后续跨部门行为'));
  assert.ok(html.includes('待在MDM平台明确责任部门'));
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
  assert.ok(html.includes('结构完整性'));
  assert.ok(html.includes('展示分'));
  assert.ok(html.includes('结构化学习评分 v1（试行）'));
  assert.ok(html.includes('查看评分标准'));
  assert.ok(html.includes('data-action="refresh-structure-score"'));
  assert.ok(html.includes('只用于结构化学习反馈，不写入导出JSON'));
  assert.ok(html.includes('不代表流程设计正确、部门职责正确或业务事实已经确认'));
  assert.ok(html.includes('校验服务异常时暂停生成最终分数，不把系统故障算作用户扣分'));
  const exportCheckSource = html.slice(
    html.indexOf('    function renderExportCheck() {'),
    html.indexOf('    function renderEditorContent()', html.indexOf('    function renderExportCheck() {'))
  );
  assert.ok(exportCheckSource.includes('class="next-stage-grid"'));
  assert.ok(exportCheckSource.includes('<span class="next-stage-badge">下一步</span>'));
  assert.ok(exportCheckSource.includes('完成业务评审后，进入MDM平台正式编辑'));
  assert.ok(exportCheckSource.includes('归口部门MDM审核员在MDM平台选择“预览并审核导入3001文件”'));
  assert.ok(exportCheckSource.includes('<span class="next-stage-badge">后续规划</span>'));
  assert.ok(exportCheckSource.includes('后续预告：系统动力学评价'));
  assert.ok(exportCheckSource.includes('逻辑关系清楚只表示流程能够被理解，不代表当前做法就应该继续'));
  const nextStageMarkup = exportCheckSource.slice(
    exportCheckSource.indexOf('<div class="next-stage-grid"'),
    exportCheckSource.indexOf('<p class="boundary">', exportCheckSource.indexOf('<div class="next-stage-grid"'))
  );
  assert.equal(/<(?:a|button)\b/.test(nextStageMarkup), false, 'next-stage cards must remain static guidance');
  assert.equal((html.match(/完成业务评审后，进入MDM平台正式编辑/g) || []).length, 1);
  assert.equal((html.match(/后续预告：系统动力学评价/g) || []).length, 1);
  assert.match(html, /\.next-stage-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.ok(html.includes('表单或记录名称'));
  assert.ok(html.includes('表单或记录编号（如有）'));
  assert.ok(html.includes('录入现有表单'));
  assert.ok(html.includes('设计新建／优化表单'));
  assert.ok(html.includes('主表字段'));
  assert.ok(html.includes('明细表标题'));
  assert.ok(html.includes('字段归属'));
  assert.ok(html.includes('新建明细表'));
  assert.ok(html.includes('添加字段'));
  assert.ok(html.includes('class="form-field-table"'));
  assert.ok(html.includes('<th>序号</th>'));
  assert.ok(html.includes('<th>字段名称</th>'));
  assert.ok(html.includes('<th>数据类型</th>'));
  assert.ok(html.includes('<th>必填</th>'));
  assert.ok(html.includes('<th>填写说明</th>'));
  assert.ok(html.includes('<th>排序</th>'));
  assert.ok(html.includes('<th>删除</th>'));
  assert.ok(html.includes('nextFocusPath = `forms.${formIndex}.areas.${nextAreaIndex}.items.${itemIndex}.item_name`'));
  assert.match(html, /\.form-field-table\s*\{[\s\S]*?min-width:\s*940px/);
  assert.equal(/@media \(max-width: 900px\)[\s\S]*?\.form-field-row/.test(html), false);
  assert.ok(html.includes('data-form-item-assignment'));
  assert.ok(html.includes("form_design_state: source.schema_version === 'process-governance-v3'"));
  assert.equal(html.includes('建立主表结构'), false);
  assert.equal(html.includes('添加明细表结构'), false);
  assert.equal(html.includes('结构类型'), false);
  assert.equal(html.includes('主表标题'), false);
  assert.ok(html.includes('function formItemTypeField(pathKey, currentValue)'));
  assert.ok(html.includes('formItemTypes = Array.isArray(result.fieldType)'));
  assert.ok(html.includes('请从标准类型中选择，不允许自由填写。'));
  assert.ok(html.includes("<label>${escapeHtml('数据类型')}</label>"));
  assert.ok(html.includes('当前类型字典未收录'));
  assert.ok(html.includes('保留当前值'));
  assert.ok(html.includes('3001会保留原值；如需修改，只能改选标准类型。'));
  assert.ok(html.includes('formItemTypeField(`forms.${formIndex}.areas.${areaIndex}.items.${itemIndex}.item_type`, item.item_type)'));
  assert.equal(
    html.includes("field(`forms.${formIndex}.areas.${areaIndex}.items.${itemIndex}.item_type`, '数据类型')"),
    false,
    'form item type must not fall back to a free-text input'
  );
  assert.ok(html.includes('/^forms\\.\\d+\\.areas\\.\\d+\\.items\\.\\d+\\.item_type$/.test(target.dataset.bind)'));
  assert.ok(html.includes('move-detail-area-up'));
  assert.ok(html.includes('remove-detail-area'));
  assert.ok(html.includes('当前明细表包含${fieldCount}个字段'));
  const formHelpersStart = html.indexOf('    function ensureFormArea(form, areaType) {');
  const formHelpersEnd = html.indexOf('    function addForm(formDesignState) {', formHelpersStart);
  assert.ok(formHelpersStart >= 0 && formHelpersEnd > formHelpersStart);
  const formDocument = {
    forms: [{
      areas: [{ area_ref: 'area-main', area_type: '基本信息', area_title: '', items: [] },
        { area_ref: 'area-detail-a', area_type: '明细清单', area_title: '物料明细', items: [] },
        { area_ref: 'area-detail-b', area_type: '明细清单', area_title: '费用明细', items: [] },
        {
          area_ref: 'area-unassigned', area_type: '', area_title: '', items: [{
            item_ref: 'item-stable', item_name: '申请金额', item_type: '金额', required: true, instructions: '填写含税金额'
          }]
        }]
    }]
  };
  let nextRef = 0;
  let formConfirmResult = false;
  let formConfirmMessage = '';
  const formHelperContext = {
    activeAreaRef: '',
    currentDocument: () => formDocument,
    newRef: prefix => `${prefix}-new-${++nextRef}`,
    window: {
      confirm(message) {
        formConfirmMessage = message;
        return formConfirmResult;
      }
    }
  };
  vm.runInNewContext(
    `${html.slice(formHelpersStart, formHelpersEnd)}
this.moveAssignmentForTest = moveFormItemToAssignment;
this.moveFieldForTest = moveFormItem;
this.moveDetailForTest = moveDetailArea;
this.removeDetailForTest = removeDetailArea;`,
    formHelperContext
  );
  const fieldBeforeMove = JSON.parse(JSON.stringify(formDocument.forms[0].areas[3].items[0]));
  assert.equal(formHelperContext.moveAssignmentForTest(0, 'item-stable', 'area-detail-b'), true);
  assert.deepEqual(formDocument.forms[0].areas[2].items[0], fieldBeforeMove, 'assignment changes must preserve all field content');
  assert.equal(formDocument.forms[0].areas.some(area => area.area_ref === 'area-unassigned'), false, 'an empty pending group may be removed');
  assert.equal(formHelperContext.moveAssignmentForTest(0, 'item-stable', '__new_detail__'), true);
  const newDetail = formDocument.forms[0].areas.at(-1);
  assert.equal(newDetail.area_type, '明细清单');
  assert.equal(newDetail.area_title, '');
  assert.equal(newDetail.items[0].item_ref, 'item-stable');
  assert.equal(
    formDocument.forms[0].areas.find(area => area.area_ref === 'area-detail-b').items.length,
    0,
    'moving the last field out must retain the empty detail table'
  );
  const detailRefsBeforeMove = formDocument.forms[0].areas.filter(area => area.area_type === '明细清单').map(area => area.area_ref);
  const newDetailIndex = formDocument.forms[0].areas.indexOf(newDetail);
  assert.equal(formHelperContext.moveDetailForTest(0, newDetailIndex, -1), true);
  const detailRefsAfterMove = formDocument.forms[0].areas.filter(area => area.area_type === '明细清单').map(area => area.area_ref);
  assert.deepEqual(detailRefsAfterMove, [detailRefsBeforeMove[0], detailRefsBeforeMove[2], detailRefsBeforeMove[1]]);
  const movedDetailIndex = formDocument.forms[0].areas.findIndex(area => area.area_ref === newDetail.area_ref);
  assert.equal(formHelperContext.removeDetailForTest(0, movedDetailIndex), false);
  assert.match(formConfirmMessage, /包含1个字段/);
  assert.equal(formDocument.forms[0].areas.some(area => area.area_ref === newDetail.area_ref), true, 'cancel must retain the detail table');
  formConfirmResult = true;
  assert.equal(formHelperContext.removeDetailForTest(0, movedDetailIndex), true);
  assert.equal(formDocument.forms[0].areas.some(area => area.area_ref === newDetail.area_ref), false);
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
  assert.ok(html.includes('按前序数据动态确定'));
  assert.ok(html.includes('data-actor-assignment-mode'));
  assert.ok(html.includes('actor_department_data_ref'));
  assert.ok(html.includes('actor_position_rule'));
  assert.ok(html.includes('function actorDepartments()'));
  assert.ok(html.includes('knownDepartments.forEach(department => departmentOptions.push'));
  assert.ok(html.includes('function externalActorDepartment'));
  assert.ok(html.includes('当前为跨部门行为'));
  assert.ok(html.includes('data-action="open-legacy-merge"'));
  assert.ok(html.includes('跨部门待办（候选）'));
  assert.equal(html.includes('当前为跨部门执行'), false);
  assert.ok(html.includes('执行岗位未被所选执行部门的花名册收录'));
  assert.ok(html.includes('当前花名册未收录'));
  assert.ok(html.includes('data-actor-department'));
  assert.ok(html.includes('data-actor-position'));
  assert.ok(html.includes('原文件包含与当前业务行为绑定的正式工作角色'));
  assert.ok(html.includes('具体做什么（补充说明，可选）'));
  assert.ok(html.includes('behaviors.${index}.behavior_description'));
  assert.ok(html.includes('不会替代业务行为名称，也不显示在流程图节点上'));
  const externalActorStart = html.indexOf('    function externalActorDepartment(value, ownDepartment = currentExecutionDepartment()) {');
  const externalActorEnd = html.indexOf('    function normalizeWorkRole', externalActorStart);
  assert.ok(externalActorStart >= 0 && externalActorEnd > externalActorStart);
  const actorPickerDocument = {
    process: { owning_department: '' },
    behaviors: [{ behavior_ref: 'behavior-actor', current_actor_role: '' }],
    flow_relations: [],
    cross_department_handoffs: []
  };
  const actorPickerContext = {
    text: value => value == null ? '' : String(value),
    currentDocument: () => actorPickerDocument,
    currentExecutionDepartment: () => actorPickerDocument.process.owning_department,
    parseActorRole(value) {
      const raw = String(value || '');
      if (raw === '全公司') return { department: '全公司', position: '', known: true };
      const department = ['财务部', '工程技术部', '质量管理部'].find(item => raw.startsWith(item)) || '';
      return { department, position: department ? raw.slice(department.length) : '', known: Boolean(department) };
    },
    actorDepartments: () => ['财务部', '工程技术部', '质量管理部'],
    rosterPositions: department => department === '财务部' ? ['会计员'] : department === '质量管理部' ? ['审核员'] : ['技术员'],
    rosterLoadState: 'ready',
    escapeHtml: value => String(value ?? ''),
    escapeAttribute: value => String(value ?? ''),
    optionHtml: (options, selected) => options.map(option => {
      const normalized = typeof option === 'string' ? { value: option, label: option } : option;
      return `<option value="${normalized.value}"${normalized.value === selected ? ' selected' : ''}>${normalized.label}</option>`;
    }).join('')
  };
  vm.runInNewContext(
    `${html.slice(externalActorStart, externalActorEnd)}
this.actorRolePickerForTest = actorRolePicker;
this.externalActorDepartmentForTest = externalActorDepartment;`,
    actorPickerContext
  );
  let actorPickerMarkup = actorPickerContext.actorRolePickerForTest(0);
  assert.doesNotMatch(actorPickerMarkup, /data-actor-department="0"[^>]*disabled/);
  assert.equal(actorPickerMarkup.includes('全公司通用'), false, 'company-wide is selected as an assignment mode, not a department');
  assert.ok(actorPickerMarkup.includes('质量管理部'));
  actorPickerDocument.process.owning_department = '财务部';
  actorPickerMarkup = actorPickerContext.actorRolePickerForTest(0);
  assert.ok(actorPickerMarkup.includes('财务部（本流程归口部门）'));
  assert.equal(actorPickerMarkup.includes('全公司通用'), false);
  assert.ok(actorPickerMarkup.includes('<option value="质量管理部">质量管理部</option>'));
  actorPickerDocument.behaviors[0].current_actor_role = '质量管理部审核员';
  actorPickerMarkup = actorPickerContext.actorRolePickerForTest(0);
  assert.ok(actorPickerMarkup.includes('当前为跨部门行为'));
  assert.equal(actorPickerMarkup.includes('data-action="open-legacy-merge"'), true);
  assert.equal(actorPickerDocument.behaviors[0].current_actor_role, '质量管理部审核员', 'rendering must preserve a historical external actor');
  actorPickerDocument.process.owning_department = '质量管理部';
  assert.equal(actorPickerContext.externalActorDepartmentForTest('质量管理部审核员'), '');
  actorPickerDocument.process.owning_department = '工程技术部';
  assert.equal(actorPickerContext.externalActorDepartmentForTest('质量管理部审核员'), '质量管理部');

  assert.ok(html.includes('确认变更归口部门'));
  assert.ok(html.includes('确认变更并重置'));
  assert.ok(html.includes('先导出当前草稿'));
  assert.ok(html.includes('归口部门是识别本部门行为和跨部门行为的基准'));
  const owningDepartmentResetStart = html.indexOf('    function addSequenceRelationIfMissing(');
  const owningDepartmentResetEnd = html.indexOf('    function removeCounterpartyLinksForBehavior(', owningDepartmentResetStart);
  assert.ok(owningDepartmentResetStart >= 0 && owningDepartmentResetEnd > owningDepartmentResetStart);
  let ownerResetRelationSequence = 0;
  const ownerResetDocument = {
    process: {
      process_ref: 'process-owner-reset',
      owning_department: '工程技术部',
      capability_domain: '技术域',
      business_capability: '工艺管理',
      classification_status: 'confirmed'
    },
    behaviors: [{
      behavior_ref: 'behavior-local',
      behavior_name: '发起申请',
      actor_assignment_mode: 'fixed_department',
      current_actor_role: '工程技术部技术员',
      actor_department_data_ref: null,
      actor_position_rule: '',
      work_role: { behavior_ref: 'behavior-local', role_duty: '发起' }
    }, {
      behavior_ref: 'behavior-external',
      behavior_name: '外部门办理',
      actor_assignment_mode: 'fixed_department',
      current_actor_role: '物资保障部计划员',
      actor_department_data_ref: null,
      actor_position_rule: '',
      work_role: null
    }, {
      behavior_ref: 'behavior-dynamic',
      behavior_name: '动态整改',
      actor_assignment_mode: 'dynamic_from_data',
      current_actor_role: '',
      actor_department_data_ref: 'data-owner',
      actor_position_rule: '由责任部门确定整改人',
      work_role: null
    }, {
      behavior_ref: 'behavior-company',
      behavior_name: '查阅通报',
      actor_assignment_mode: 'company_wide',
      current_actor_role: '全公司',
      actor_department_data_ref: null,
      actor_position_rule: '',
      work_role: null
    }],
    flow_relations: [{
      relation_ref: 'relation-existing',
      relation_type: 'sequence',
      from_behavior_ref: 'behavior-dynamic',
      to_behavior_ref: 'behavior-company',
      condition: '',
      join_mode: ''
    }],
    cross_department_handoffs: [{
      handoff_ref: 'handoff-owner-reset',
      handoff_direction: 'outbound_followup',
      anchor_behavior_ref: 'behavior-local',
      counterparty_behavior_ref: 'behavior-external',
      requires_return: true,
      resume_behavior_ref: 'behavior-dynamic',
      requested_matter: '办理并返回'
    }],
    data_objects: [{ data_ref: 'data-owner', data_name: '责任部门' }],
    internal_process_calls: [{ call_ref: 'call-preserved', caller_behavior_ref: 'behavior-local' }],
    forms: [{ form_ref: 'form-preserved', form_name: '申请单' }]
  };
  const ownerResetContext = {
    text: value => value == null ? '' : String(value),
    clone: value => JSON.parse(JSON.stringify(value)),
    newRef: prefix => `${prefix}-owner-reset-${++ownerResetRelationSequence}`,
    actorAssignmentMode(behavior) {
      const explicit = String(behavior?.actor_assignment_mode || '');
      if (['fixed_department', 'company_wide', 'dynamic_from_data'].includes(explicit)) return explicit;
      return behavior?.current_actor_role === '全公司' ? 'company_wide' : 'fixed_department';
    }
  };
  vm.runInNewContext(
    `${html.slice(owningDepartmentResetStart, owningDepartmentResetEnd)}
this.ownerChangeImpactForTest = owningDepartmentChangeImpact;
this.buildOwnerResetForTest = buildOwningDepartmentResetDocument;`,
    ownerResetContext
  );
  const ownerResetBefore = JSON.stringify(ownerResetDocument);
  const ownerImpact = ownerResetContext.ownerChangeImpactForTest(ownerResetDocument, '质量管理部');
  assert.equal(ownerImpact.fixedAssignments, 2);
  assert.equal(ownerImpact.dynamicAssignments, 1);
  assert.equal(ownerImpact.companyWideAssignments, 1);
  assert.equal(ownerImpact.handoffCount, 1);
  assert.equal(ownerImpact.restoredSequenceCount, 2);
  assert.equal(ownerImpact.classificationFields, 3);
  assert.equal(ownerImpact.formalWorkRoles, 1);
  assert.equal(ownerImpact.internalCallCount, 1);
  const ownerResetResult = ownerResetContext.buildOwnerResetForTest(ownerResetDocument, '质量管理部');
  assert.equal(JSON.stringify(ownerResetDocument), ownerResetBefore, 'owner reset must be built on an in-memory copy');
  assert.equal(ownerResetResult.process.owning_department, '质量管理部');
  assert.equal(ownerResetResult.process.capability_domain, null);
  assert.equal(ownerResetResult.process.business_capability, null);
  assert.equal(ownerResetResult.process.classification_status, 'unclassified');
  assert.deepEqual(
    Array.from(ownerResetResult.behaviors.slice(0, 3), item => [
      item.actor_assignment_mode,
      item.current_actor_role,
      item.actor_department_data_ref,
      item.actor_position_rule
    ]),
    [
      ['fixed_department', '', null, ''],
      ['fixed_department', '', null, ''],
      ['fixed_department', '', null, '']
    ]
  );
  assert.equal(ownerResetResult.behaviors[3].actor_assignment_mode, 'company_wide');
  assert.equal(ownerResetResult.behaviors[3].current_actor_role, '全公司');
  assert.equal(ownerResetResult.cross_department_handoffs.length, 0);
  assert.equal(ownerResetResult.flow_relations.some(item => item.from_behavior_ref === 'behavior-local' && item.to_behavior_ref === 'behavior-external'), true);
  assert.equal(ownerResetResult.flow_relations.some(item => item.from_behavior_ref === 'behavior-external' && item.to_behavior_ref === 'behavior-dynamic'), true);
  assert.deepEqual(ownerResetResult.behaviors[0].work_role, ownerResetDocument.behaviors[0].work_role);
  assert.deepEqual(ownerResetResult.internal_process_calls, ownerResetDocument.internal_process_calls);
  assert.deepEqual(ownerResetResult.data_objects, ownerResetDocument.data_objects);
  assert.deepEqual(ownerResetResult.forms, ownerResetDocument.forms);
  const ownerInputHandlerStart = html.indexOf("    workspace.addEventListener('input'");
  const ownerInputHandlerEnd = html.indexOf("    workspace.addEventListener('change'", ownerInputHandlerStart);
  const ownerInputHandlerSource = html.slice(ownerInputHandlerStart, ownerInputHandlerEnd);
  assert.ok(
    ownerInputHandlerSource.indexOf("target.dataset.bind === 'process.owning_department'")
      < ownerInputHandlerSource.indexOf('setByPath(target.dataset.bind, value)'),
    'the owning department must not be written before the user confirms the impact'
  );
  const ownerChangeHandlerStart = ownerInputHandlerEnd;
  const ownerChangeHandlerEnd = html.indexOf("    workspace.addEventListener('click'", ownerChangeHandlerStart);
  const ownerChangeHandlerSource = html.slice(ownerChangeHandlerStart, ownerChangeHandlerEnd);
  assert.ok(ownerChangeHandlerSource.includes('openOwningDepartmentChange(target.value)'));
  assert.equal(
    ownerChangeHandlerSource.includes('currentDocument().cross_department_handoffs.forEach(handoff => syncHandoffDerivedFields(handoff))'),
    false,
    'changing the owner must not silently reclassify the current draft'
  );
  const ownerConfirmStart = html.indexOf('    async function confirmOwningDepartmentChange() {');
  const ownerConfirmEnd = html.indexOf('    function handleAction(action, element) {', ownerConfirmStart);
  const ownerConfirmSource = html.slice(ownerConfirmStart, ownerConfirmEnd);
  assert.ok(ownerConfirmStart >= 0 && ownerConfirmEnd > ownerConfirmStart);
  assert.ok(ownerConfirmSource.indexOf("fetch('/api/validate'") < ownerConfirmSource.indexOf('entry.data = next'));
  assert.ok(ownerConfirmSource.indexOf('if (!result.valid)') < ownerConfirmSource.indexOf('entry.data = next'));
  assert.ok(ownerConfirmSource.indexOf('catch (error)') > ownerConfirmSource.indexOf('entry.data = next'));
  const ownerCloseStart = html.indexOf('    function closeOwningDepartmentChange() {');
  const ownerCloseEnd = html.indexOf('    function showOwningDepartmentChangeError(', ownerCloseStart);
  const ownerCloseSource = html.slice(ownerCloseStart, ownerCloseEnd);
  assert.equal(ownerCloseSource.includes('entry.data ='), false, 'canceling an owner change must not replace the current draft');
  assert.equal(ownerCloseSource.includes('touch()'), false, 'canceling an owner change must not mark the draft as changed');

  const removeCounterpartyStart = html.indexOf('    function addSequenceRelationIfMissing(');
  const removeCounterpartyEnd = html.indexOf('    function syncHandoffDerivedFields(', removeCounterpartyStart);
  assert.ok(removeCounterpartyStart >= 0 && removeCounterpartyEnd > removeCounterpartyStart);
  let relationSequence = 0;
  let removalConfirmed = true;
  const counterpartyRemovalDocument = {
    flow_relations: [],
    cross_department_handoffs: [{
      handoff_ref: 'handoff-remove',
      handoff_direction: 'outbound_followup',
      anchor_behavior_ref: 'behavior-anchor',
      counterparty_behavior_ref: 'behavior-external',
      requested_matter: '办理事项',
      transfer_data_ref: 'data-transfer',
      returned_data_ref: 'data-return',
      requires_return: true,
      resume_behavior_ref: 'behavior-resume',
      counterparty_process_name: ''
    }]
  };
  const counterpartyRemovalContext = {
    text: value => value == null ? '' : String(value),
    currentDocument: () => counterpartyRemovalDocument,
    linkedHandoffsForCounterpartyBehavior: behaviorRef => counterpartyRemovalDocument.cross_department_handoffs
      .map((handoff, handoffIndex) => ({ handoff, handoffIndex }))
      .filter(({ handoff }) => handoff.counterparty_behavior_ref === behaviorRef),
    newRef: prefix => `${prefix}-converted-${++relationSequence}`,
    activeHandoffRef: 'handoff-remove',
    window: { confirm: () => removalConfirmed }
  };
  vm.runInNewContext(
    `${html.slice(removeCounterpartyStart, removeCounterpartyEnd)}
this.removeCounterpartyLinksForBehaviorForTest = removeCounterpartyLinksForBehavior;`,
    counterpartyRemovalContext
  );
  assert.equal(counterpartyRemovalContext.removeCounterpartyLinksForBehaviorForTest('behavior-external', '按前序数据动态确定'), true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(counterpartyRemovalDocument.flow_relations.map(item => [item.from_behavior_ref, item.to_behavior_ref]))),
    [['behavior-anchor', 'behavior-external'], ['behavior-external', 'behavior-resume']],
    'switching away from a fixed external department must preserve the ordinary flow position'
  );
  assert.equal(counterpartyRemovalDocument.cross_department_handoffs.length, 0);
  counterpartyRemovalDocument.cross_department_handoffs.push({
    handoff_ref: 'handoff-cancel',
    handoff_direction: 'inbound_prerequisite',
    anchor_behavior_ref: 'behavior-anchor',
    counterparty_behavior_ref: 'behavior-external',
    requested_matter: '前置输入'
  });
  removalConfirmed = false;
  assert.equal(counterpartyRemovalContext.removeCounterpartyLinksForBehaviorForTest('behavior-external', '全公司通用'), false);
  assert.equal(counterpartyRemovalDocument.cross_department_handoffs.length, 1, 'canceling the mode switch must keep the handoff');

  const behaviorSelectStart = html.indexOf('    function behaviorSelect(pathKey, label, options = {}) {');
  const behaviorSelectEnd = html.indexOf('    function dataSelect', behaviorSelectStart);
  assert.ok(behaviorSelectStart >= 0 && behaviorSelectEnd > behaviorSelectStart);
  const behaviorSelectDocument = {
    behaviors: [
      { behavior_ref: 'behavior-local', behavior_name: '本流程行为', current_actor_role: '工程技术部技术员' },
      { behavior_ref: 'behavior-external-current', behavior_name: '当前跨部门行为', current_actor_role: '物资保障部计划员' },
      { behavior_ref: 'behavior-external-other', behavior_name: '其他跨部门行为', current_actor_role: '质量管理部审核员' }
    ],
    cross_department_handoffs: [{ anchor_behavior_ref: '' }]
  };
  const behaviorSelectContext = {
    text: value => value == null ? '' : String(value),
    currentDocument: () => behaviorSelectDocument,
    getByPath: pathKey => pathKey.split('.').reduce((target, part) => target == null ? undefined : target[part], behaviorSelectDocument),
    externalActorDepartment: actorRole => actorRole.startsWith('工程技术部') ? '' : actorRole.slice(0, 5),
    field: (_pathKey, _label, options) => options.options
  };
  vm.runInNewContext(
    `${html.slice(behaviorSelectStart, behaviorSelectEnd)}\nthis.behaviorSelectForTest = behaviorSelect;`,
    behaviorSelectContext
  );
  let localPositionOptions = behaviorSelectContext.behaviorSelectForTest(
    'cross_department_handoffs.0.anchor_behavior_ref',
    '本流程接收位置',
    { localOnly: true, excludeRef: 'behavior-external-current' }
  );
  assert.deepEqual(Array.from(localPositionOptions, item => item.value), ['', 'behavior-local']);
  behaviorSelectDocument.cross_department_handoffs[0].anchor_behavior_ref = 'behavior-external-other';
  localPositionOptions = behaviorSelectContext.behaviorSelectForTest(
    'cross_department_handoffs.0.anchor_behavior_ref',
    '本流程接收位置',
    { localOnly: true, excludeRef: 'behavior-external-current' }
  );
  assert.equal(localPositionOptions.some(item => item.value === 'behavior-external-other'), true, 'historical external anchors remain visible until the user corrects them');
  assert.equal(localPositionOptions.find(item => item.value === 'behavior-external-other').label.includes('历史跨部门关联，请调整'), true);
  const normalizeV1Function = html.slice(
    html.indexOf('function normalizeV1(input)'),
    html.indexOf('function splitLegacyDocument')
  );
  assert.ok(normalizeV1Function.includes('behavior_description: text(item?.behavior_description)'));
  assert.ok(
    normalizeV1Function.includes('item_type: text(item?.item_type)'),
    'unlisted historical item types must stay intact until the user selects a standard type'
  );
  const splitLegacyFunction = html.slice(
    html.indexOf('function splitLegacyDocument'),
    html.indexOf('function currentEntry()')
  );
  assert.ok(
    splitLegacyFunction.includes("behavior_description: ''"),
    'legacy v2 behavior names must not be copied into the supplemental description'
  );
  assert.ok(html.includes('reference_materials: (Array.isArray(source.reference_materials) ? source.reference_materials : [])'));
  const addBehaviorFunction = html.slice(
    html.indexOf('function addBehavior()'),
    html.indexOf('function addRelation()')
  );
  assert.ok(addBehaviorFunction.includes("current_actor_role: ''"));
  assert.ok(addBehaviorFunction.includes("behavior_description: ''"));
  assert.ok(addBehaviorFunction.includes('work_role: null'));
  const flowDefaultsStart = html.indexOf('    function successorBehaviorRefs(behaviorRef, data = currentDocument()) {');
  const flowDefaultsEnd = html.indexOf('    function externalDepartmentForHandoff(handoff) {', flowDefaultsStart);
  const addHandoffStart = html.indexOf('    function addHandoff(direction = \'outbound_followup\', anchorBehaviorRef = null, counterpartyBehaviorRef = null) {');
  const addHandoffEnd = html.indexOf('    function removeRelation(index) {', addHandoffStart);
  assert.ok(flowDefaultsStart >= 0 && flowDefaultsEnd > flowDefaultsStart);
  assert.ok(addHandoffStart >= 0 && addHandoffEnd > addHandoffStart);
  const handoffDefaultsDocument = {
    export_meta: { initiating_department: '财务部' },
    process: { owning_department: '财务部' },
    behaviors: [
      { behavior_ref: 'behavior-start', behavior_name: '提交申请' },
      { behavior_ref: 'behavior-resume', behavior_name: '继续办理' }
    ],
    flow_relations: [{
      relation_ref: 'relation-next',
      relation_type: 'sequence',
      from_behavior_ref: 'behavior-start',
      to_behavior_ref: 'behavior-resume'
    }],
    cross_department_handoffs: []
  };
  const handoffDefaultsContext = {
    text: value => value == null ? '' : String(value),
    currentDocument: () => handoffDefaultsDocument,
    newRef: () => 'handoff-new',
    activeFlowItemKind: 'behavior',
    activeHandoffRef: '',
    activeBehaviorRef: '',
    addBehavior() {
      const behavior = {
        behavior_ref: 'behavior-external-new',
        node_type: '',
        behavior_name: '',
        current_actor_role: ''
      };
      handoffDefaultsDocument.behaviors.push(behavior);
      return behavior;
    },
    linkedHandoffsForCounterpartyBehavior(behaviorRef) {
      return handoffDefaultsDocument.cross_department_handoffs
        .map((handoff, handoffIndex) => ({ handoff, handoffIndex }))
        .filter(({ handoff }) => handoff.counterparty_behavior_ref === behaviorRef);
    },
    counterpartyBehaviorForHandoff(handoff) {
      return handoffDefaultsDocument.behaviors.find(item => item.behavior_ref === handoff.counterparty_behavior_ref) || null;
    },
    externalActorDepartment(value, owner) {
      const raw = String(value || '');
      const department = ['财务部', '物资保障部'].find(item => raw.startsWith(item)) || '';
      return department && owner && department !== owner ? department : '';
    },
    externalDepartmentForHandoff(handoff) {
      return handoff.handoff_direction === 'inbound_prerequisite'
        ? handoff.source_department || ''
        : handoff.target_department || '';
    }
  };
  vm.runInNewContext(
    `${html.slice(flowDefaultsStart, flowDefaultsEnd)}\n${html.slice(addHandoffStart, addHandoffEnd)}
this.addHandoffForTest = addHandoff;
this.addCrossDepartmentBehaviorForTest = addCrossDepartmentBehavior;
this.ensureLinkedHandoffForExternalBehaviorForTest = ensureLinkedHandoffForExternalBehavior;
this.syncHandoffDerivedFieldsForTest = syncHandoffDerivedFields;`,
    handoffDefaultsContext
  );
  const newHandoff = handoffDefaultsContext.addHandoffForTest('outbound_followup', 'behavior-start');
  assert.equal(newHandoff.source_department, '财务部');
  assert.equal(newHandoff.anchor_behavior_ref, 'behavior-start');
  assert.equal(newHandoff.trigger_condition, '“提交申请”完成后，系统生成跨部门待办');
  assert.equal(handoffDefaultsContext.activeFlowItemKind, 'handoff');
  newHandoff.target_department = '物资保障部';
  newHandoff.requires_return = true;
  handoffDefaultsContext.syncHandoffDerivedFieldsForTest(newHandoff, 'requires_return');
  assert.equal(newHandoff.counterparty_resolution, 'identified');
  assert.equal(newHandoff.resume_behavior_ref, 'behavior-resume');
  handoffDefaultsDocument.process.owning_department = '工程技术部';
  handoffDefaultsContext.syncHandoffDerivedFieldsForTest(newHandoff);
  assert.equal(newHandoff.source_department, '工程技术部', 'the local side follows the owning department');
  handoffDefaultsDocument.process.owning_department = '财务部';
  const linkedCreation = handoffDefaultsContext.addCrossDepartmentBehaviorForTest?.('outbound_followup', 'behavior-start');
  assert.ok(linkedCreation, 'the cross-department creation helper must be exposed to the runtime test');
  assert.equal(linkedCreation.handoff.counterparty_behavior_ref, linkedCreation.behavior.behavior_ref);
  assert.equal(linkedCreation.behavior.node_type, 'action');
  assert.equal(handoffDefaultsContext.activeFlowItemKind, 'behavior');
  linkedCreation.behavior.current_actor_role = '物资保障部库管员';
  const ensuredLinkedHandoff = handoffDefaultsContext.ensureLinkedHandoffForExternalBehaviorForTest(linkedCreation.behavior.behavior_ref);
  assert.ok(ensuredLinkedHandoff, 'an external behavior must retain its linked handoff');
  assert.equal(
    handoffDefaultsDocument.cross_department_handoffs.filter(item => item.counterparty_behavior_ref === linkedCreation.behavior.behavior_ref).length,
    1,
    'selecting an external department must reuse the linked handoff instead of creating a duplicate'
  );
  assert.equal(linkedCreation.handoff.target_department, '物资保障部');
  handoffDefaultsDocument.behaviors.find(item => item.behavior_ref === 'behavior-resume').current_actor_role = '物资保障部库管员';
  const convertedExistingBehavior = handoffDefaultsContext.ensureLinkedHandoffForExternalBehaviorForTest(
    'behavior-resume',
    handoffDefaultsDocument,
    { convertUniqueRelations: true }
  );
  assert.equal(convertedExistingBehavior.anchor_behavior_ref, 'behavior-start');
  assert.equal(handoffDefaultsDocument.flow_relations.length, 0, 'a unique ordinary boundary relation is replaced when the user explicitly changes the behavior to an external department');
  assert.ok(html.includes('data-action="move-behavior-up"'));
  assert.ok(html.includes('data-action="move-behavior-down"'));
  assert.ok(html.includes('aria-label="上移第${behaviorIndex + 1}项业务行为"'));
  assert.ok(html.includes('aria-label="下移第${behaviorIndex + 1}项业务行为"'));
  assert.ok(html.includes('data-action="move-${escapeAttribute(kind)}-up"'));
  assert.ok(html.includes('data-action="move-${escapeAttribute(kind)}-down"'));
  assert.ok(html.includes('data-action="select-${escapeAttribute(kind)}"'));
  ['relation', 'data', 'handoff'].forEach(kind => {
    assert.ok(html.includes(`action === 'select-${kind}'`));
    assert.ok(html.includes(`action === 'move-${kind}-up'`));
    assert.ok(html.includes(`action === 'move-${kind}-down'`));
  });
  assert.ok(html.includes('aria-label="流程关系列表"'));
  assert.ok(html.includes('aria-label="输出物与数据列表"'));
  assert.ok(html.includes('aria-label="跨部门待办只读汇总"'));
  assert.ok(html.includes('let activeRelationRef = \'\''));
  assert.ok(html.includes('let activeDataRef = \'\''));
  assert.ok(html.includes('let activeHandoffRef = \'\''));
  assert.ok(html.includes('const active = ensureActiveRelation()'));
  assert.ok(html.includes('const active = ensureActiveDataObject()'));
  assert.ok(html.includes('const active = ensureActiveFlowItem()'));
  assert.ok(html.includes('activeRelationRef = focusRef'));
  assert.ok(html.includes('activeDataRef = focusRef'));
  assert.ok(html.includes('activeHandoffRef = focusRef'));
  assert.ok(html.includes('一次只编辑一条流程关系。左侧顺序只用于整理条目，不代表流程先后关系。'));
  assert.ok(html.includes('这里是业务行为输入和输出的唯一编辑入口。'));
  assert.ok(html.includes('这里只集中查看，不新增、不修改。'));
  const renderBehaviorsStart = html.indexOf('    function renderBehaviors() {');
  const renderBehaviorsEnd = html.indexOf('    function renderRelations() {', renderBehaviorsStart);
  const renderBehaviorsSource = html.slice(renderBehaviorsStart, renderBehaviorsEnd);
  assert.ok(renderBehaviorsSource.includes('流程如何开始'));
  assert.ok(html.includes('由流程关系和输出物与数据自动带出'));
  assert.ok(renderBehaviorsSource.includes('其他开始条件（可选）'));
  assert.ok(renderBehaviorsSource.includes('怎样算完成'));
  assert.equal(renderBehaviorsSource.includes("field(`behaviors.${index}.input_description`"), false);
  assert.equal(renderBehaviorsSource.includes("field(`behaviors.${index}.output_description`"), false);
  assert.equal(renderBehaviorsSource.includes('multiData('), false, 'behavior editor must not duplicate data relationship editing');
  assert.ok(html.includes('历史文字补充（只读）'));
  assert.ok(html.includes('data-action="open-behavior-data"'));
  assert.ok(html.includes('只显示产生后可到达的行为'));
  assert.ok(html.includes("action === 'open-behavior-data'"));
  const flowProjectionStart = html.indexOf('    function linkedHandoffs(behaviorRef) {');
  const flowProjectionEnd = html.indexOf('    function ensureActiveFlowItem() {', flowProjectionStart);
  const flowProjectionDocument = {
    behaviors: [
      { behavior_ref: 'behavior-local', behavior_name: '提交申请' },
      { behavior_ref: 'behavior-external', behavior_name: '外部门办理' }
    ],
    cross_department_handoffs: [{
      handoff_ref: 'handoff-linked',
      handoff_direction: 'outbound_followup',
      anchor_behavior_ref: 'behavior-local',
      counterparty_behavior_ref: 'behavior-external'
    }]
  };
  const flowProjectionContext = {
    currentDocument: () => flowProjectionDocument,
    text: value => value == null ? '' : String(value),
    counterpartyBehaviorForHandoff(handoff, data = flowProjectionDocument) {
      return data.behaviors.find(item => item.behavior_ref === handoff.counterparty_behavior_ref) || null;
    },
    linkedHandoffForCounterpartyBehavior(behaviorRef, data = flowProjectionDocument) {
      const handoffIndex = data.cross_department_handoffs.findIndex(item => item.counterparty_behavior_ref === behaviorRef);
      return handoffIndex >= 0 ? { handoff: data.cross_department_handoffs[handoffIndex], handoffIndex } : null;
    }
  };
  vm.runInNewContext(
    `${html.slice(flowProjectionStart, flowProjectionEnd)}\nthis.flowItemsForTest = flowItems;`,
    flowProjectionContext
  );
  const projectedFlowItems = Array.from(flowProjectionContext.flowItemsForTest());
  assert.equal(projectedFlowItems.length, 2, 'a linked cross-department behavior must appear only once in the flow list');
  assert.deepEqual(projectedFlowItems.map(item => item.kind), ['behavior', 'behavior']);
  assert.equal(projectedFlowItems[1].counterpartyLink.handoff.handoff_ref, 'handoff-linked');
  assert.ok(html.includes('function orderedSelectorRow(kind, itemRef, index, total, label, buttonLabel, activeRef)'));
  assert.ok(html.includes('${itemOrderButtons(kind, itemRef, index, total, label)}'));
  assert.ok(html.includes("moveCollectionItem('flow_relations', 'relation_ref'"));
  assert.ok(html.includes("moveCollectionItem('data_objects', 'data_ref'"));
  assert.ok(html.includes("moveCollectionItem('cross_department_handoffs', 'handoff_ref'"));
  const syncDataLinksStart = html.indexOf('    function syncBehaviorLinksForData(item, options = {}) {');
  const syncDataLinksEnd = html.indexOf('    function multiDepartments', syncDataLinksStart);
  assert.ok(syncDataLinksStart >= 0 && syncDataLinksEnd > syncDataLinksStart);
  const dataLinkDocument = {
    behaviors: [{
      behavior_ref: 'behavior-1', input_data_refs: ['data-1'], output_data_refs: ['data-1']
    }, {
      behavior_ref: 'behavior-2', input_data_refs: [], output_data_refs: []
    }, {
      behavior_ref: 'behavior-3', input_data_refs: [], output_data_refs: []
    }]
  };
  const syncDataLinksContext = { currentDocument: () => dataLinkDocument };
  vm.runInNewContext(
    `${html.slice(syncDataLinksStart, syncDataLinksEnd)}\nthis.syncBehaviorLinksForDataForTest = syncBehaviorLinksForData;`,
    syncDataLinksContext
  );
  const canonicalDataObject = {
    data_ref: 'data-1',
    produced_by_behavior_ref: 'behavior-2',
    consumed_by_behavior_refs: ['behavior-3']
  };
  syncDataLinksContext.syncBehaviorLinksForDataForTest(canonicalDataObject, { producer: true });
  assert.deepEqual(Array.from(dataLinkDocument.behaviors[1].output_data_refs), ['data-1']);
  assert.deepEqual(Array.from(dataLinkDocument.behaviors[0].input_data_refs), ['data-1'], 'editing the producer must preserve historical consumers');
  syncDataLinksContext.syncBehaviorLinksForDataForTest(canonicalDataObject, { consumers: true });
  assert.deepEqual(Array.from(dataLinkDocument.behaviors[0].input_data_refs), []);
  assert.deepEqual(Array.from(dataLinkDocument.behaviors[2].input_data_refs), ['data-1']);
  const moveBehaviorStart = html.indexOf('    function moveBehavior(behaviorRef, direction) {');
  const moveBehaviorEnd = html.indexOf('    function addRelation()', moveBehaviorStart);
  assert.ok(moveBehaviorStart >= 0 && moveBehaviorEnd > moveBehaviorStart);
  const reorderDocument = {
    behaviors: [
      { behavior_ref: 'behavior-1', behavior_name: '第一项' },
      { behavior_ref: 'behavior-2', behavior_name: '第二项' },
      { behavior_ref: 'behavior-3', behavior_name: '第三项' }
    ],
    flow_relations: [{
      relation_ref: 'relation-1',
      from_behavior_ref: 'behavior-1',
      to_behavior_ref: 'behavior-2'
    }, {
      relation_ref: 'relation-2',
      from_behavior_ref: 'behavior-2',
      to_behavior_ref: 'behavior-3'
    }, {
      relation_ref: 'relation-3',
      from_behavior_ref: 'behavior-3',
      to_behavior_ref: 'behavior-1'
    }],
    data_objects: [{
      data_ref: 'data-1',
      data_name: '第一项数据'
    }, {
      data_ref: 'data-2',
      data_name: '第二项数据'
    }, {
      data_ref: 'data-3',
      data_name: '第三项数据'
    }],
    cross_department_handoffs: [{
      handoff_ref: 'handoff-1',
      anchor_behavior_ref: 'behavior-2'
    }, {
      handoff_ref: 'handoff-2',
      anchor_behavior_ref: 'behavior-3'
    }, {
      handoff_ref: 'handoff-3',
      anchor_behavior_ref: 'behavior-1'
    }]
  };
  const referencesBeforeMove = JSON.stringify({
    flow_relations: reorderDocument.flow_relations,
    cross_department_handoffs: reorderDocument.cross_department_handoffs
  });
  const moveBehaviorContext = {
    activeBehaviorRef: '',
    activeRelationRef: '',
    activeDataRef: '',
    activeHandoffRef: '',
    currentDocument: () => reorderDocument,
    text: value => value == null ? '' : String(value)
  };
  vm.runInNewContext(
    `${html.slice(moveBehaviorStart, moveBehaviorEnd)}
this.moveBehaviorForTest = moveBehavior;
this.moveCollectionItemForTest = moveCollectionItem;`,
    moveBehaviorContext
  );
  assert.equal(moveBehaviorContext.moveBehaviorForTest('behavior-2', -1), true);
  assert.deepEqual(reorderDocument.behaviors.map(item => item.behavior_ref), [
    'behavior-2',
    'behavior-1',
    'behavior-3'
  ]);
  assert.equal(moveBehaviorContext.activeBehaviorRef, 'behavior-2');
  assert.equal(
    JSON.stringify({
      flow_relations: reorderDocument.flow_relations,
      cross_department_handoffs: reorderDocument.cross_department_handoffs
    }),
    referencesBeforeMove,
    'reordering behaviors must not rewrite stable references'
  );
  assert.equal(moveBehaviorContext.moveBehaviorForTest('behavior-2', -1), false);
  assert.deepEqual(reorderDocument.behaviors.map(item => item.behavior_ref), [
    'behavior-2',
    'behavior-1',
    'behavior-3'
  ]);
  const collectionContentBeforeMove = JSON.stringify({
    relations: [...reorderDocument.flow_relations].sort((left, right) => left.relation_ref.localeCompare(right.relation_ref)),
    data: [...reorderDocument.data_objects].sort((left, right) => left.data_ref.localeCompare(right.data_ref)),
    handoffs: [...reorderDocument.cross_department_handoffs].sort((left, right) => left.handoff_ref.localeCompare(right.handoff_ref))
  });
  assert.equal(
    moveBehaviorContext.moveCollectionItemForTest('flow_relations', 'relation_ref', 'relation-2', -1),
    true
  );
  assert.deepEqual(
    reorderDocument.flow_relations.map(item => item.relation_ref),
    ['relation-2', 'relation-1', 'relation-3']
  );
  assert.equal(moveBehaviorContext.activeRelationRef, 'relation-2');
  assert.equal(
    moveBehaviorContext.moveCollectionItemForTest('data_objects', 'data_ref', 'data-2', 1),
    true
  );
  assert.deepEqual(
    reorderDocument.data_objects.map(item => item.data_ref),
    ['data-1', 'data-3', 'data-2']
  );
  assert.equal(moveBehaviorContext.activeDataRef, 'data-2');
  assert.equal(
    moveBehaviorContext.moveCollectionItemForTest('cross_department_handoffs', 'handoff_ref', 'handoff-2', -1),
    true
  );
  assert.deepEqual(
    reorderDocument.cross_department_handoffs.map(item => item.handoff_ref),
    ['handoff-2', 'handoff-1', 'handoff-3']
  );
  assert.equal(moveBehaviorContext.activeHandoffRef, 'handoff-2');
  assert.equal(
    moveBehaviorContext.moveCollectionItemForTest('flow_relations', 'relation_ref', 'relation-2', -1),
    false
  );
  assert.equal(
    JSON.stringify({
      relations: [...reorderDocument.flow_relations].sort((left, right) => left.relation_ref.localeCompare(right.relation_ref)),
      data: [...reorderDocument.data_objects].sort((left, right) => left.data_ref.localeCompare(right.data_ref)),
      handoffs: [...reorderDocument.cross_department_handoffs].sort((left, right) => left.handoff_ref.localeCompare(right.handoff_ref))
    }),
    collectionContentBeforeMove,
    'reordering collections must only change array order and preserve every referenced object'
  );
  const addFormFunction = html.slice(
    html.indexOf('function addForm(formDesignState)'),
    html.indexOf('function addTerm()')
  );
  assert.ok(addFormFunction.includes("area_type: '基本信息'"));
  assert.ok(addFormFunction.includes("area_title: ''"));
  assert.ok(addFormFunction.includes('items: []'));
  assert.ok(addFormFunction.includes("form_name: ''"));
  assert.ok(addFormFunction.includes('form_no: null'));
  assert.ok(addFormFunction.includes('form_design_state: formDesignState'));
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
    html.includes('3001不保存草稿，不与MDM平台通信，也不代表审核通过。'),
    false,
    'the general system-boundary notice must not occupy the business page'
  );
  assert.equal((html.match(/DeepSeek/g) || []).length, 0, 'the business page must not mention the retired model');
  assert.ok(html.includes('添加前置跨部门行为'));
  assert.ok(html.includes('添加后续跨部门行为'));
  assert.ok(html.includes('data-action="select-flow-handoff"'));
  assert.ok(html.includes('data-action="open-flow-handoff"'));
  assert.ok(html.includes('删除当前待办'));
  assert.ok(html.includes('关联哪个本流程行为'));
  const handoffSummaryStart = html.indexOf('    function renderHandoffs() {');
  const handoffSummaryEnd = html.indexOf('    function renderForms()', handoffSummaryStart);
  const handoffSummarySource = html.slice(handoffSummaryStart, handoffSummaryEnd);
  assert.ok(handoffSummaryStart >= 0 && handoffSummaryEnd > handoffSummaryStart);
  assert.equal(handoffSummarySource.includes('field(`cross_department_handoffs.'), false, 'the handoff summary must be read-only');
  assert.equal(handoffSummarySource.includes('data-action="add-'), false, 'the handoff summary must not create a second editing entry');
  assert.ok(html.includes("addCrossDepartmentBehavior('inbound_prerequisite'"));
  assert.ok(html.includes("addCrossDepartmentBehavior('outbound_followup'"));
  assert.ok(
    html.includes('只有归口部门MDM审核员登录MDM平台并完成审核，且服务端复核通过后，内容才会写入治理数据'),
    'the export notice must distinguish preview from approved governance writes'
  );
  assert.ok(html.includes("removeHandoffByRef(text(element.dataset.ref))"));
  assert.ok(html.includes('当前业务行为和其他跨部门待办不受影响'));
  assert.ok(html.includes("if (action === 'remove-handoff' && !removeHandoff(index)) return;"));
  assert.ok(html.includes('data-action="focus-export-warning"'));
  assert.ok(html.includes("if (action === 'focus-export-warning') return focusExportWarning(element);"));
  assert.ok(html.includes('function renderWarningCopy(item)'));
  assert.ok(html.includes('class="warning-fact"'));
  assert.ok(html.includes('class="warning-suggestion"'));
  assert.ok(html.includes('const suggestionItems = warningSuggestions(item);'));
  assert.ok(html.includes('data-focus-paths'));
  assert.ok(html.includes('focused-control'));
  assert.ok(html.includes('@keyframes focus-control-breathe'));
  assert.ok(html.includes("querySelectorAll('[data-bind], [data-focus-key], [data-list-bind]')"));
  assert.ok(html.includes("control.classList.add('focused-control')"));
  assert.ok(html.includes('点击问题项可返回对应位置补充'));
  assert.ok(html.includes('提示项（不阻止导出）'));
  assert.ok(html.includes('<strong>阻断项：</strong>'));
  assert.ok(html.includes("focusKind: 'behavior'"));
  assert.ok(html.includes("focusKind: 'relation'"));
  assert.ok(html.includes("focusKind: 'handoff'"));
  assert.ok(html.includes("focusKind: 'form'"));
  assert.ok(html.includes("focusKind: 'area'"));
  assert.equal(
    html.includes("if (action === 'remove-handoff') currentDocument().cross_department_handoffs.splice(index, 1);"),
    false,
    'every cross-department handoff deletion entry must use the guarded removal flow'
  );
  const removeHandoffStart = html.indexOf('    function removeHandoff(index) {');
  const removeHandoffEnd = html.indexOf('    function ensureFormArea(form, areaType) {', removeHandoffStart);
  assert.ok(removeHandoffStart >= 0 && removeHandoffEnd > removeHandoffStart);
  const handoffDocument = {
    behaviors: [{ behavior_ref: 'behavior-1' }],
    cross_department_handoffs: [
      {
        handoff_ref: 'handoff-1',
        target_department: '质量管理部',
        requested_matter: '复核技术资料'
      },
      {
        handoff_ref: 'handoff-2',
        target_department: '财务部',
        requested_matter: '确认预算额度'
      }
    ]
  };
  let confirmResult = false;
  let confirmMessage = '';
  const handoffRemovalContext = {
    activeHandoffRef: 'handoff-1',
    currentDocument: () => handoffDocument,
    text: value => value == null ? '' : String(value),
    window: {
      confirm(message) {
        confirmMessage = message;
        return confirmResult;
      }
    }
  };
  vm.runInNewContext(
    `${html.slice(removeHandoffStart, removeHandoffEnd)}
this.removeHandoffByRefForTest = removeHandoffByRef;`,
    handoffRemovalContext
  );
  assert.equal(handoffRemovalContext.removeHandoffByRefForTest('handoff-1'), false);
  assert.equal(handoffDocument.cross_department_handoffs.length, 2);
  assert.match(confirmMessage, /承接部门：质量管理部/);
  assert.match(confirmMessage, /当前业务行为和其他跨部门待办不受影响/);
  confirmResult = true;
  assert.equal(handoffRemovalContext.removeHandoffByRefForTest('handoff-1'), true);
  assert.deepEqual(
    handoffDocument.cross_department_handoffs.map(item => item.handoff_ref),
    ['handoff-2']
  );
  assert.equal(handoffRemovalContext.activeHandoffRef, 'handoff-2');
  assert.equal(handoffDocument.behaviors.length, 1);

  const mergeHelpersStart = html.indexOf('    function mergeChoiceOptions(field, candidates) {');
  const mergeHelpersEnd = html.indexOf('    function renderLegacyMergeModal() {', mergeHelpersStart);
  assert.ok(mergeHelpersStart >= 0 && mergeHelpersEnd > mergeHelpersStart);
  const mergeContext = {
    text: value => value == null ? '' : String(value),
    clone: value => JSON.parse(JSON.stringify(value)),
    newRef: () => 'handoff-generated',
    externalActorDepartment(value, owner) {
      const raw = String(value || '');
      const department = ['工程技术部', '物资保障部', '复材车间'].find(item => raw.startsWith(item)) || '';
      return department && owner && department !== owner ? department : '';
    },
    defaultHandoffTrigger(direction, behaviorRef, data) {
      const behavior = data.behaviors.find(item => item.behavior_ref === behaviorRef);
      return direction === 'inbound_prerequisite'
        ? `“${behavior?.behavior_name || '当前本流程行为'}”开始前`
        : `“${behavior?.behavior_name || '当前本流程行为'}”完成后，系统生成跨部门待办`;
    }
  };
  vm.runInNewContext(
    `${html.slice(mergeHelpersStart, mergeHelpersEnd)}
this.analyzeLegacyExternalBehaviorForTest = analyzeLegacyExternalBehavior;
this.applyLegacyExternalBehaviorMergeForTest = applyLegacyExternalBehaviorMerge;`,
    mergeContext
  );
  const legacyMergeDocument = {
    process: { owning_department: '工程技术部' },
    behaviors: [
      { behavior_ref: 'behavior-request', behavior_name: '工程技术部技术员向物资保障部索取工艺装备序列号', current_actor_role: '工程技术部技术员', work_role: null, countersign_all_required: false, countersign_target_departments: [] },
      { behavior_ref: 'behavior-external', behavior_name: '物资保障部向工程技术部发放工装序列号', current_actor_role: '物资保障部计划员', completion_standard: '识别工装序列号', work_role: null, countersign_all_required: false, countersign_target_departments: [] },
      { behavior_ref: 'behavior-resume', behavior_name: '工程技术部技术员编制工艺装备申请单', current_actor_role: '工程技术部技术员', work_role: null, countersign_all_required: false, countersign_target_departments: [] }
    ],
    flow_relations: [
      { relation_ref: 'relation-request', relation_type: 'sequence', from_behavior_ref: 'behavior-request', to_behavior_ref: 'behavior-external' },
      { relation_ref: 'relation-return', relation_type: 'sequence', from_behavior_ref: 'behavior-external', to_behavior_ref: 'behavior-resume' }
    ],
    data_objects: [{
      data_ref: 'data-serial',
      data_name: '工装序列号',
      produced_by_behavior_ref: 'behavior-external',
      consumed_by_behavior_refs: ['behavior-external', 'behavior-resume']
    }],
    cross_department_handoffs: [{
      handoff_ref: 'handoff-outbound',
      handoff_direction: 'outbound_followup',
      anchor_behavior_ref: 'behavior-request',
      counterparty_resolution: 'needs_identification',
      source_department: '工程技术部',
      target_department: '物资保障部',
      transfer_data_ref: null,
      requested_matter: '工装序列号',
      trigger_condition: '完成待办时',
      completion_standard: '',
      counterparty_process_ref: null,
      counterparty_process_name: '',
      counterparty_behavior_ref: null,
      counterparty_behavior_name: '',
      requires_return: false,
      returned_data_ref: null,
      resume_behavior_ref: null
    }, {
      handoff_ref: 'handoff-inbound',
      handoff_direction: 'inbound_prerequisite',
      anchor_behavior_ref: 'behavior-resume',
      counterparty_resolution: 'needs_identification',
      source_department: '物资保障部',
      target_department: '工程技术部',
      transfer_data_ref: 'data-serial',
      requested_matter: '工装序列号',
      trigger_condition: '编制申请单前',
      completion_standard: '提供完整且唯一的工装序列号',
      counterparty_process_ref: null,
      counterparty_process_name: '',
      counterparty_behavior_ref: null,
      counterparty_behavior_name: '',
      requires_return: false,
      returned_data_ref: null,
      resume_behavior_ref: null
    }],
    internal_process_calls: [],
    forms: [{ form_ref: 'form-external', behavior_ref: 'behavior-external', areas: [] }]
  };
  const legacyMergeBefore = JSON.stringify(legacyMergeDocument);
  const mergeAnalysis = mergeContext.analyzeLegacyExternalBehaviorForTest(legacyMergeDocument, 'behavior-external');
  assert.deepEqual(Array.from(mergeAnalysis.blockers), []);
  assert.equal(mergeAnalysis.senderRef, 'behavior-request');
  assert.equal(mergeAnalysis.inboundHandoff.handoff_ref, 'handoff-inbound');
  assert.ok(mergeAnalysis.conflicts.some(item => item.field === 'completion_standard'));
  assert.throws(
    () => mergeContext.applyLegacyExternalBehaviorMergeForTest(legacyMergeDocument, mergeAnalysis, {}),
    /请先确认/
  );
  const mergeSelections = {
    ...mergeAnalysis.defaults,
    counterparty_behavior_name: '物资保障部向工程技术部发放工装序列号',
    completion_standard: '提供完整且唯一的工装序列号'
  };
  const mergedLegacy = mergeContext.applyLegacyExternalBehaviorMergeForTest(
    legacyMergeDocument,
    mergeAnalysis,
    mergeSelections
  ).data;
  assert.equal(JSON.stringify(legacyMergeDocument), legacyMergeBefore, 'legacy merge must not mutate the imported source object');
  assert.deepEqual(mergedLegacy.behaviors.map(item => item.behavior_ref), ['behavior-request', 'behavior-external', 'behavior-resume']);
  assert.equal(mergedLegacy.flow_relations.length, 0);
  assert.equal(mergedLegacy.cross_department_handoffs.length, 1);
  assert.equal(mergedLegacy.cross_department_handoffs[0].handoff_ref, 'handoff-outbound');
  assert.equal(mergedLegacy.cross_department_handoffs[0].counterparty_resolution, 'identified');
  assert.equal(mergedLegacy.cross_department_handoffs[0].target_department, '物资保障部');
  assert.equal(mergedLegacy.cross_department_handoffs[0].counterparty_behavior_ref, 'behavior-external');
  assert.equal(mergedLegacy.cross_department_handoffs[0].counterparty_behavior_name, '');
  assert.equal(mergedLegacy.cross_department_handoffs[0].returned_data_ref, 'data-serial');
  assert.equal(mergedLegacy.cross_department_handoffs[0].resume_behavior_ref, 'behavior-resume');
  assert.equal(mergedLegacy.data_objects[0].produced_by_behavior_ref, 'behavior-external');
  assert.deepEqual(mergedLegacy.data_objects[0].consumed_by_behavior_refs, ['behavior-external', 'behavior-resume']);
  assert.equal(mergedLegacy.forms[0].behavior_ref, 'behavior-external');

  const noExistingHandoffDocument = JSON.parse(legacyMergeBefore);
  noExistingHandoffDocument.cross_department_handoffs = [];
  const noExistingAnalysis = mergeContext.analyzeLegacyExternalBehaviorForTest(noExistingHandoffDocument, 'behavior-external');
  const generatedMerge = mergeContext.applyLegacyExternalBehaviorMergeForTest(
    noExistingHandoffDocument,
    noExistingAnalysis,
    { ...noExistingAnalysis.defaults }
  ).data;
  assert.equal(generatedMerge.cross_department_handoffs.length, 1);
  assert.equal(generatedMerge.cross_department_handoffs[0].handoff_ref, 'handoff-generated');
  assert.equal(generatedMerge.cross_department_handoffs[0].counterparty_behavior_ref, 'behavior-external');

  const selfAnchoredLegacyDocument = {
    process: { owning_department: '物资保障部' },
    behaviors: [
      { behavior_ref: 'behavior-use-request', behavior_name: '工装领用申请', current_actor_role: '复材车间班长', completion_standard: '工装领用申请提出到物资保障部', work_role: null, countersign_all_required: false, countersign_target_departments: [] },
      { behavior_ref: 'behavior-transfer', behavior_name: '工装转移', current_actor_role: '物资保障部保管工', completion_standard: '工装转移完成', work_role: null, countersign_all_required: false, countersign_target_departments: [] },
      { behavior_ref: 'behavior-return-request', behavior_name: '工装还库申请', current_actor_role: '复材车间班长', completion_standard: '工装还库申请提出到物资保障部', work_role: null, countersign_all_required: false, countersign_target_departments: [] }
    ],
    flow_relations: [
      { relation_ref: 'relation-use', relation_type: 'sequence', from_behavior_ref: 'behavior-use-request', to_behavior_ref: 'behavior-transfer' },
      { relation_ref: 'relation-return', relation_type: 'sequence', from_behavior_ref: 'behavior-transfer', to_behavior_ref: 'behavior-return-request' }
    ],
    data_objects: [
      { data_ref: 'data-use-request', data_name: '工装领用申请单', produced_by_behavior_ref: 'behavior-use-request', consumed_by_behavior_refs: ['behavior-transfer'] },
      { data_ref: 'data-return-request', data_name: '工装还库申请单', produced_by_behavior_ref: 'behavior-return-request', consumed_by_behavior_refs: [] }
    ],
    cross_department_handoffs: [
      {
        handoff_ref: 'handoff-use-self',
        handoff_direction: 'outbound_followup',
        anchor_behavior_ref: 'behavior-use-request',
        counterparty_resolution: 'identified',
        source_department: '物资保障部',
        target_department: '物资保障部',
        transfer_data_ref: 'data-use-request',
        requested_matter: '接收工装领用申请',
        trigger_condition: '接收工装领用申请',
        completion_standard: '接收工装领用申请',
        counterparty_process_ref: null,
        counterparty_process_name: '',
        counterparty_behavior_ref: null,
        counterparty_behavior_name: '',
        requires_return: true,
        returned_data_ref: 'data-use-request',
        resume_behavior_ref: 'behavior-transfer'
      },
      {
        handoff_ref: 'handoff-return-self',
        handoff_direction: 'outbound_followup',
        anchor_behavior_ref: 'behavior-return-request',
        counterparty_resolution: 'identified',
        source_department: '物资保障部',
        target_department: '物资保障部',
        transfer_data_ref: 'data-return-request',
        requested_matter: '接收工装还库申请',
        trigger_condition: '接收工装还库申请',
        completion_standard: '接收工装还库申请',
        counterparty_process_ref: null,
        counterparty_process_name: '',
        counterparty_behavior_ref: null,
        counterparty_behavior_name: '',
        requires_return: true,
        returned_data_ref: 'data-return-request',
        resume_behavior_ref: null
      }
    ],
    internal_process_calls: [],
    forms: [
      { form_ref: 'form-use-request', behavior_ref: 'behavior-use-request', areas: [] },
      { form_ref: 'form-return-request', behavior_ref: 'behavior-return-request', areas: [] }
    ]
  };
  const selfAnchoredLegacyBefore = JSON.stringify(selfAnchoredLegacyDocument);
  const inboundStartAnalysis = mergeContext.analyzeLegacyExternalBehaviorForTest(
    selfAnchoredLegacyDocument,
    'behavior-use-request'
  );
  assert.deepEqual(Array.from(inboundStartAnalysis.blockers), []);
  assert.equal(inboundStartAnalysis.mergeDirection, 'inbound_prerequisite');
  assert.equal(inboundStartAnalysis.anchorBehaviorRef, 'behavior-transfer');
  assert.equal(inboundStartAnalysis.keptHandoff.handoff_ref, 'handoff-use-self');
  const afterInboundStart = mergeContext.applyLegacyExternalBehaviorMergeForTest(
    selfAnchoredLegacyDocument,
    inboundStartAnalysis,
    { ...inboundStartAnalysis.defaults, completion_standard: '工装领用申请提出到物资保障部' }
  ).data;
  assert.equal(JSON.stringify(selfAnchoredLegacyDocument), selfAnchoredLegacyBefore, 'inbound merge must not mutate the imported source object');
  assert.deepEqual(afterInboundStart.behaviors.map(item => item.behavior_ref), ['behavior-use-request', 'behavior-transfer', 'behavior-return-request']);
  assert.deepEqual(afterInboundStart.flow_relations.map(item => item.relation_ref), ['relation-return']);
  const mergedInboundStart = afterInboundStart.cross_department_handoffs.find(item => item.handoff_ref === 'handoff-use-self');
  assert.equal(mergedInboundStart.handoff_direction, 'inbound_prerequisite');
  assert.equal(mergedInboundStart.anchor_behavior_ref, 'behavior-transfer');
  assert.equal(mergedInboundStart.source_department, '复材车间');
  assert.equal(mergedInboundStart.target_department, '物资保障部');
  assert.equal(mergedInboundStart.transfer_data_ref, 'data-use-request');
  assert.equal(mergedInboundStart.counterparty_behavior_ref, 'behavior-use-request');
  assert.equal(mergedInboundStart.counterparty_behavior_name, '');
  assert.equal(mergedInboundStart.requires_return, false);
  assert.equal(mergedInboundStart.returned_data_ref, null);
  assert.equal(mergedInboundStart.resume_behavior_ref, null);
  assert.equal(afterInboundStart.data_objects[0].produced_by_behavior_ref, 'behavior-use-request');
  assert.deepEqual(afterInboundStart.data_objects[0].consumed_by_behavior_refs, ['behavior-transfer']);
  assert.equal(afterInboundStart.forms[0].behavior_ref, 'behavior-use-request');

  const outboundEndAnalysis = mergeContext.analyzeLegacyExternalBehaviorForTest(
    afterInboundStart,
    'behavior-return-request'
  );
  assert.deepEqual(Array.from(outboundEndAnalysis.blockers), []);
  assert.equal(outboundEndAnalysis.mergeDirection, 'outbound_followup');
  assert.equal(outboundEndAnalysis.anchorBehaviorRef, 'behavior-transfer');
  assert.equal(outboundEndAnalysis.keptHandoff.handoff_ref, 'handoff-return-self');
  const afterOutboundEnd = mergeContext.applyLegacyExternalBehaviorMergeForTest(
    afterInboundStart,
    outboundEndAnalysis,
    { ...outboundEndAnalysis.defaults, completion_standard: '工装还库申请提出到物资保障部' }
  ).data;
  assert.deepEqual(afterOutboundEnd.behaviors.map(item => item.behavior_ref), ['behavior-use-request', 'behavior-transfer', 'behavior-return-request']);
  assert.equal(afterOutboundEnd.flow_relations.length, 0);
  assert.equal(afterOutboundEnd.cross_department_handoffs.length, 2);
  const mergedOutboundEnd = afterOutboundEnd.cross_department_handoffs.find(item => item.handoff_ref === 'handoff-return-self');
  assert.equal(mergedOutboundEnd.handoff_direction, 'outbound_followup');
  assert.equal(mergedOutboundEnd.anchor_behavior_ref, 'behavior-transfer');
  assert.equal(mergedOutboundEnd.source_department, '物资保障部');
  assert.equal(mergedOutboundEnd.target_department, '复材车间');
  assert.equal(mergedOutboundEnd.counterparty_behavior_ref, 'behavior-return-request');
  assert.equal(mergedOutboundEnd.counterparty_behavior_name, '');
  assert.equal(mergedOutboundEnd.transfer_data_ref, null);
  assert.equal(mergedOutboundEnd.returned_data_ref, 'data-return-request');
  assert.equal(mergedOutboundEnd.resume_behavior_ref, null);
  assert.equal(afterOutboundEnd.data_objects[1].produced_by_behavior_ref, 'behavior-return-request');
  assert.equal(afterOutboundEnd.forms[1].behavior_ref, 'behavior-return-request');

  const orphanExternalStart = JSON.parse(selfAnchoredLegacyBefore);
  orphanExternalStart.flow_relations = orphanExternalStart.flow_relations.filter(item => item.relation_ref !== 'relation-use');
  assert.ok(
    mergeContext.analyzeLegacyExternalBehaviorForTest(orphanExternalStart, 'behavior-use-request').blockers
      .some(item => item.includes('无法唯一确定本流程接收行为'))
  );
  const duplicateSelfAnchors = JSON.parse(selfAnchoredLegacyBefore);
  duplicateSelfAnchors.cross_department_handoffs.push({
    ...duplicateSelfAnchors.cross_department_handoffs[0],
    handoff_ref: 'handoff-use-self-duplicate'
  });
  assert.ok(
    mergeContext.analyzeLegacyExternalBehaviorForTest(duplicateSelfAnchors, 'behavior-use-request').blockers
      .some(item => item.includes('2条锚定在旧版外部门行为上的待办'))
  );

  const blockedRoleDocument = JSON.parse(legacyMergeBefore);
  blockedRoleDocument.behaviors[1].work_role = { behavior_ref: 'behavior-external' };
  assert.equal(mergeContext.analyzeLegacyExternalBehaviorForTest(blockedRoleDocument, 'behavior-external').blockers.length, 0);
  const blockedCountersignDocument = JSON.parse(legacyMergeBefore);
  blockedCountersignDocument.behaviors[1].countersign_target_departments = ['质量管理部'];
  assert.equal(mergeContext.analyzeLegacyExternalBehaviorForTest(blockedCountersignDocument, 'behavior-external').blockers.length, 0);
  const blockedInternalCallDocument = JSON.parse(legacyMergeBefore);
  blockedInternalCallDocument.internal_process_calls = [{
    call_ref: 'call-external',
    caller_behavior_ref: 'behavior-external',
    return_behavior_ref: null
  }];
  assert.equal(mergeContext.analyzeLegacyExternalBehaviorForTest(blockedInternalCallDocument, 'behavior-external').blockers.length, 0);
  const blockedBranchDocument = JSON.parse(legacyMergeBefore);
  blockedBranchDocument.flow_relations.push({
    relation_ref: 'relation-extra-incoming',
    relation_type: 'sequence',
    from_behavior_ref: 'behavior-resume',
    to_behavior_ref: 'behavior-external'
  });
  assert.ok(
    mergeContext.analyzeLegacyExternalBehaviorForTest(blockedBranchDocument, 'behavior-external').blockers
      .some(item => item.includes('2条前序关系'))
  );
  const blockedOutgoingBranchDocument = JSON.parse(legacyMergeBefore);
  blockedOutgoingBranchDocument.flow_relations.push({
    relation_ref: 'relation-extra-outgoing',
    relation_type: 'sequence',
    from_behavior_ref: 'behavior-external',
    to_behavior_ref: 'behavior-request'
  });
  assert.ok(
    mergeContext.analyzeLegacyExternalBehaviorForTest(blockedOutgoingBranchDocument, 'behavior-external').blockers
      .some(item => item.includes('2条后续关系'))
  );
  const mergeCloseStart = html.indexOf('    function closeLegacyMerge() {');
  const mergeCloseEnd = html.indexOf('    async function confirmLegacyMerge() {', mergeCloseStart);
  const mergeCloseSource = html.slice(mergeCloseStart, mergeCloseEnd);
  assert.ok(mergeCloseSource.includes('legacyMergeState = null'));
  assert.ok(mergeCloseSource.includes("legacyMergeModal.classList.remove('show')"));
  assert.equal(mergeCloseSource.includes('currentEntry().data ='), false, 'canceling the merge must not replace the current draft');
  assert.equal(mergeCloseSource.includes('touch()'), false, 'canceling the merge must not mark the draft as changed');
  const mergeConfirmStart = html.indexOf('    async function confirmLegacyMerge() {');
  const mergeConfirmEnd = html.indexOf('    function handleAction(action, element) {', mergeConfirmStart);
  const mergeConfirmSource = html.slice(mergeConfirmStart, mergeConfirmEnd);
  assert.ok(mergeConfirmSource.indexOf('if (!result.valid)') < mergeConfirmSource.indexOf('currentEntry().data = merged.data'));
  assert.ok(mergeConfirmSource.indexOf('const response = await fetch') < mergeConfirmSource.indexOf('currentEntry().data = merged.data'));
  assert.ok(mergeConfirmSource.indexOf('catch (error)') > mergeConfirmSource.indexOf('currentEntry().data = merged.data'));

  const businessWarningsStart = html.indexOf('    function businessWarnings(data) {');
  const businessWarningsEnd = html.indexOf('    function sanitizeFilenamePart', businessWarningsStart);
  assert.ok(businessWarningsStart >= 0 && businessWarningsEnd > businessWarningsStart);
  const businessWarningsSource = html.slice(businessWarningsStart, businessWarningsEnd);
  assert.equal(
    businessWarningsSource.includes('或'),
    false,
    'export warning definitions must describe one exact defect without ambiguous “or” wording'
  );
  const businessWarningContext = {
    rosterLoadState: 'unavailable',
    text: value => value == null ? '' : String(value),
    parseActorRole: () => ({ department: '', position: '' }),
    externalActorDepartment(value, ownDepartment) {
      const raw = String(value || '');
      const department = ['财务部', '工程技术部', '质量管理部', '物资保障部'].find(item => raw.startsWith(item)) || '';
      return ownDepartment && department && department !== ownDepartment ? department : '';
    },
    linkedHandoffsForCounterpartyBehavior(behaviorRef, data) {
      return (data.cross_department_handoffs || [])
        .map((handoff, handoffIndex) => ({ handoff, handoffIndex }))
        .filter(({ handoff }) => handoff.counterparty_behavior_ref === behaviorRef);
    },
    needsLegacyExternalBehaviorMerge(behavior, data) {
      const raw = String(behavior.current_actor_role || '');
      const department = ['财务部', '工程技术部', '质量管理部', '物资保障部'].find(item => raw.startsWith(item)) || '';
      const external = department && department !== data.process.owning_department;
      const linked = (data.cross_department_handoffs || []).filter(item => item.counterparty_behavior_ref === behavior.behavior_ref);
      const relations = (data.flow_relations || []).filter(item =>
        item.from_behavior_ref === behavior.behavior_ref || item.to_behavior_ref === behavior.behavior_ref
      );
      return Boolean(external && (linked.length !== 1 || relations.length));
    },
    counterpartyBehaviorForHandoff(handoff, data) {
      return (data.behaviors || []).find(item => item.behavior_ref === handoff.counterparty_behavior_ref) || null;
    },
    actorDepartments: () => [],
    rosterPositions: () => [],
    actorAssignmentMode(behavior) {
      const explicit = String(behavior?.actor_assignment_mode || '');
      if (['fixed_department', 'company_wide', 'dynamic_from_data'].includes(explicit)) return explicit;
      return behavior?.current_actor_role === '全公司' ? 'company_wide' : 'fixed_department';
    },
    StructureLearningScore: require(structureScorePath)
  };
  vm.runInNewContext(
    `${html.slice(businessWarningsStart, businessWarningsEnd)}
this.businessWarningsForTest = businessWarnings;`,
    businessWarningContext
  );
  const completeBehavior = (source, behaviorRef, nodeType, behaviorName) => ({
    ...JSON.parse(JSON.stringify(source)),
    behavior_ref: behaviorRef,
    node_type: nodeType,
    behavior_name: behaviorName,
    work_role: null
  });
  const localDecisionDocument = createDraft();
  const baseBehavior = localDecisionDocument.behaviors[0];
  localDecisionDocument.behaviors = [
    baseBehavior,
    completeBehavior(baseBehavior, 'behavior_review', 'decision', '审核申请'),
    completeBehavior(baseBehavior, 'behavior_archive', 'action', '归档申请')
  ];
  localDecisionDocument.flow_relations = [{
    relation_ref: 'relation-submit',
    relation_type: 'sequence',
    from_behavior_ref: 'behavior_apply',
    to_behavior_ref: 'behavior_review',
    condition: '申请已提交',
    join_mode: ''
  }, {
    relation_ref: 'relation-reject',
    relation_type: 'loop',
    from_behavior_ref: 'behavior_review',
    to_behavior_ref: 'behavior_apply',
    condition: '审核不通过',
    join_mode: ''
  }, {
    relation_ref: 'relation-approve',
    relation_type: 'sequence',
    from_behavior_ref: 'behavior_review',
    to_behavior_ref: 'behavior_archive',
    condition: '审核通过',
    join_mode: ''
  }];
  let warningMessages = Array.from(
    businessWarningContext.businessWarningsForTest(localDecisionDocument),
    item => item.message
  );
  assert.equal(
    warningMessages.some(message => message.includes('审核申请少于两条明确出口')),
    false,
    'a loop and a forward sequence are two explicit decision outlets'
  );

  const externalBehaviorDocument = createDraft();
  externalBehaviorDocument.behaviors[0].current_actor_role = '物资保障部库管员';
  const externalBehaviorBefore = JSON.stringify(externalBehaviorDocument);
  const externalBehaviorWarning = Array.from(
    businessWarningContext.businessWarningsForTest(externalBehaviorDocument)
  ).find(item => item.message === '费用申请仍使用普通流程关系表达跨部门交接，可能与跨部门关系重复。');
  assert.equal(externalBehaviorWarning.focusPath, 'legacy_merge');
  assert.equal(externalBehaviorWarning.focusKind, 'behavior');
  assert.deepEqual(
    Array.from(externalBehaviorWarning.suggestions),
    ['打开“归并为单一跨部门行为”，确认交接方向和数据去向。']
  );
  assert.equal(JSON.stringify(externalBehaviorDocument), externalBehaviorBefore, 'warning checks must not rewrite historical external actors');

  const dynamicWarningDocument = createDraft();
  dynamicWarningDocument.behaviors.push(completeBehavior(
    dynamicWarningDocument.behaviors[0],
    'behavior_dynamic',
    'action',
    '制定整改措施'
  ));
  dynamicWarningDocument.behaviors[1].current_actor_role = '';
  dynamicWarningDocument.behaviors[1].actor_assignment_mode = 'dynamic_from_data';
  dynamicWarningDocument.behaviors[1].actor_department_data_ref = 'data_application';
  dynamicWarningDocument.behaviors[1].actor_position_rule = '由问题责任部门确定整改责任人';
  dynamicWarningDocument.flow_relations = [{
    relation_ref: 'relation-dynamic',
    relation_type: 'sequence',
    from_behavior_ref: 'behavior_apply',
    to_behavior_ref: 'behavior_dynamic',
    condition: '',
    join_mode: ''
  }];
  let dynamicWarnings = Array.from(businessWarningContext.businessWarningsForTest(dynamicWarningDocument));
  assert.equal(dynamicWarnings.some(item => item.message === '制定整改措施未选择执行部门'), false);
  assert.equal(dynamicWarnings.some(item => item.message.includes('来源数据尚未在本行为开始前形成')), false);
  dynamicWarningDocument.flow_relations[0].from_behavior_ref = 'behavior_dynamic';
  dynamicWarningDocument.flow_relations[0].to_behavior_ref = 'behavior_apply';
  dynamicWarnings = Array.from(businessWarningContext.businessWarningsForTest(dynamicWarningDocument));
  assert.ok(dynamicWarnings.some(item => item.message.includes('来源数据尚未在本行为开始前形成')));

  const companyWarningDocument = createDraft();
  companyWarningDocument.behaviors[0].current_actor_role = '全公司';
  companyWarningDocument.behaviors[0].actor_assignment_mode = 'company_wide';
  const companyWarnings = Array.from(businessWarningContext.businessWarningsForTest(companyWarningDocument));
  assert.equal(companyWarnings.some(item => item.message === '费用申请未选择执行部门'), false);
  assert.equal(companyWarningDocument.cross_department_handoffs.length, 0);

  const parallelWarningDocument = createDraft();
  parallelWarningDocument.behaviors = [
    completeBehavior(baseBehavior, 'behavior_split', 'parallel_split', '并行发起'),
    completeBehavior(baseBehavior, 'behavior_route_a', 'action', '路线甲'),
    completeBehavior(baseBehavior, 'behavior_route_b', 'action', '路线乙'),
    completeBehavior(baseBehavior, 'behavior_join', 'parallel_join', '并行归集')
  ];
  parallelWarningDocument.flow_relations = [];
  let parallelWarnings = Array.from(businessWarningContext.businessWarningsForTest(parallelWarningDocument));
  assert.ok(parallelWarnings.some(item =>
    item.message === '并行发起当前有效并行路线为0条，规则要求至少2条。'
    && Array.from(item.suggestions).includes('新增2条从本节点流向不同后续行为的并行路线。')
  ));
  parallelWarningDocument.flow_relations.push({
    relation_ref: 'relation-parallel-a', relation_type: 'parallel', from_behavior_ref: 'behavior_split', to_behavior_ref: 'behavior_route_a', condition: '', join_mode: ''
  });
  parallelWarnings = Array.from(businessWarningContext.businessWarningsForTest(parallelWarningDocument));
  assert.ok(parallelWarnings.some(item =>
    item.message === '并行发起当前有效并行路线为1条，规则要求至少2条。'
    && Array.from(item.suggestions).includes('新增1条从本节点流向不同后续行为的并行路线。')
  ));
  parallelWarningDocument.flow_relations.push({
    relation_ref: 'relation-parallel-b', relation_type: 'parallel', from_behavior_ref: 'behavior_split', to_behavior_ref: 'behavior_route_b', condition: '', join_mode: ''
  }, {
    relation_ref: 'relation-join-a', relation_type: 'parallel', from_behavior_ref: 'behavior_route_a', to_behavior_ref: 'behavior_join', condition: '', join_mode: ''
  });
  parallelWarnings = Array.from(businessWarningContext.businessWarningsForTest(parallelWarningDocument));
  assert.equal(parallelWarnings.some(item => item.message.startsWith('并行发起当前有效')), false);
  assert.ok(parallelWarnings.some(item =>
    item.message === '并行归集当前共有1个有效来源（1条并行路线来源、0个跨部门返回来源），规则要求至少2个。'
    && Array.from(item.suggestions).includes('补充1条以本节点为目标的并行路线。')
  ));
  parallelWarningDocument.cross_department_handoffs = [{
    handoff_ref: 'handoff-return-to-join',
    handoff_direction: 'outbound_followup',
    anchor_behavior_ref: 'behavior_route_b',
    requires_return: true,
    resume_behavior_ref: 'behavior_join'
  }];
  parallelWarnings = Array.from(businessWarningContext.businessWarningsForTest(parallelWarningDocument));
  assert.equal(parallelWarnings.some(item => item.message.startsWith('并行归集当前共有')), false, 'one local route plus one returning handoff is a complete join');

  const misclassifiedParallelWarningDocument = JSON.parse(JSON.stringify(parallelWarningDocument));
  misclassifiedParallelWarningDocument.cross_department_handoffs = [];
  misclassifiedParallelWarningDocument.flow_relations = [{
    relation_ref: 'relation-sequence-a', relation_type: 'sequence', from_behavior_ref: 'behavior_split', to_behavior_ref: 'behavior_route_a', condition: '', join_mode: ''
  }, {
    relation_ref: 'relation-sequence-b', relation_type: 'sequence', from_behavior_ref: 'behavior_split', to_behavior_ref: 'behavior_route_b', condition: '', join_mode: ''
  }, {
    relation_ref: 'relation-sequence-join-a', relation_type: 'sequence', from_behavior_ref: 'behavior_route_a', to_behavior_ref: 'behavior_join', condition: '', join_mode: ''
  }, {
    relation_ref: 'relation-sequence-join-b', relation_type: 'sequence', from_behavior_ref: 'behavior_route_b', to_behavior_ref: 'behavior_join', condition: '', join_mode: ''
  }];
  const misclassifiedParallelWarnings = Array.from(
    businessWarningContext.businessWarningsForTest(misclassifiedParallelWarningDocument)
  );
  const splitTypeWarning = misclassifiedParallelWarnings.find(item =>
    item.message === '并行发起已有2条通往“路线甲”、“路线乙”的顺序关系，顺序关系不计入并行路线；当前有效并行路线为0条，规则要求至少2条。'
  );
  assert.deepEqual(Array.from(splitTypeWarning.suggestions), ['将通往“路线甲”、“路线乙”的现有顺序关系改为“并行路线”。']);
  assert.deepEqual(Array.from(splitTypeWarning.focusPaths), [
    'flow_relations.0.relation_type',
    'flow_relations.1.relation_type'
  ]);
  assert.equal(splitTypeWarning.focusRef, 'relation-sequence-a');
  assert.equal(splitTypeWarning.focusPath, 'flow_relations.0.relation_type');
  const joinTypeWarning = misclassifiedParallelWarnings.find(item =>
    item.message === '并行归集已有2条来自“路线甲”、“路线乙”的顺序关系，顺序关系不计入并行汇合来源；当前共有0个有效来源（0条并行路线来源、0个跨部门返回来源），规则要求至少2个。'
  );
  assert.deepEqual(Array.from(joinTypeWarning.suggestions), ['将“路线甲”、“路线乙”进入本节点的现有顺序关系改为“并行路线”。']);
  assert.deepEqual(Array.from(joinTypeWarning.focusPaths), [
    'flow_relations.2.relation_type',
    'flow_relations.3.relation_type'
  ]);
  assert.equal(joinTypeWarning.focusRef, 'relation-sequence-join-a');
  assert.equal(joinTypeWarning.focusPath, 'flow_relations.2.relation_type');
  assert.ok(misclassifiedParallelWarnings.every(item => Array.isArray(item.suggestions) && item.suggestions.length));
  assert.equal(
    warningMessages.some(message => message.includes('流程关系3已选择“判断分支”，但判断条件为空')),
    false
  );
  localDecisionDocument.flow_relations[2].condition = '';
  warningMessages = Array.from(
    businessWarningContext.businessWarningsForTest(localDecisionDocument),
    item => item.message
  );
  assert.equal(
    warningMessages.some(message => message.includes('流程关系3已选择“判断分支”，但判断条件为空')),
    false,
    'one forward sequence may serve as the default continuation from a decision without a condition'
  );
  const incompleteConditionalDocument = JSON.parse(JSON.stringify(localDecisionDocument));
  incompleteConditionalDocument.flow_relations[2].relation_type = 'condition';
  const incompleteConditionalWarning = Array.from(
    businessWarningContext.businessWarningsForTest(incompleteConditionalDocument)
  ).find(item => item.message === '流程关系3已选择“判断分支”，但判断条件为空。');
  assert.equal(incompleteConditionalWarning.focusKind, 'relation');
  assert.equal(incompleteConditionalWarning.focusRef, 'relation-approve');
  assert.equal(incompleteConditionalWarning.focusPath, 'flow_relations.2.condition');
  const missingSequenceTargetDocument = JSON.parse(JSON.stringify(localDecisionDocument));
  missingSequenceTargetDocument.flow_relations[2].to_behavior_ref = '';
  const missingSequenceTargetWarning = Array.from(
    businessWarningContext.businessWarningsForTest(missingSequenceTargetDocument)
  ).find(item => item.message === '流程关系3未选择目标行为');
  assert.equal(missingSequenceTargetWarning.focusKind, 'relation');
  assert.equal(missingSequenceTargetWarning.focusRef, 'relation-approve');
  assert.equal(missingSequenceTargetWarning.focusPath, 'flow_relations.2.to_behavior_ref');
  const multipleDefaultSequencesDocument = JSON.parse(JSON.stringify(localDecisionDocument));
  multipleDefaultSequencesDocument.flow_relations.push({
    relation_ref: 'relation-second-default',
    relation_type: 'sequence',
    from_behavior_ref: 'behavior_review',
    to_behavior_ref: 'behavior_apply',
    condition: '',
    join_mode: ''
  });
  assert.equal(
    Array.from(
      businessWarningContext.businessWarningsForTest(multipleDefaultSequencesDocument),
      item => item.message
    ).some(message => message.includes('审核申请的流程关系4形成第2条默认继续路径')),
    true,
    'a decision may have only one unconditional default sequence'
  );

  const missingStartConditionDocument = createDraft();
  missingStartConditionDocument.behaviors[0].trigger = '';
  missingStartConditionDocument.behaviors[0].precondition = '';
  const missingStartConditionWarning = Array.from(
    businessWarningContext.businessWarningsForTest(missingStartConditionDocument)
  ).find(item => item.message === '费用申请是流程入口，但未说明流程如何开始');
  assert.equal(missingStartConditionWarning.focusPath, 'behaviors.0.trigger');

  const futureDataWarningDocument = createDraft();
  futureDataWarningDocument.behaviors.push(
    completeBehavior(futureDataWarningDocument.behaviors[0], 'behavior-later', 'action', '后续生成结果')
  );
  futureDataWarningDocument.flow_relations = [{
    relation_ref: 'relation-later',
    relation_type: 'sequence',
    from_behavior_ref: 'behavior_apply',
    to_behavior_ref: 'behavior-later',
    condition: '',
    join_mode: ''
  }];
  futureDataWarningDocument.data_objects[0].produced_by_behavior_ref = 'behavior-later';
  futureDataWarningDocument.data_objects[0].consumed_by_behavior_refs = ['behavior_apply'];
  const futureDataWarning = Array.from(
    businessWarningContext.businessWarningsForTest(futureDataWarningDocument)
  ).find(item => item.message.includes('前序行为“费用申请”不能引用'));
  assert.equal(futureDataWarning.processSection, 'data');
  assert.equal(futureDataWarning.focusPath, 'data_objects.0.consumed_by_behavior_refs');

  const handoffDecisionDocument = JSON.parse(JSON.stringify(localDecisionDocument));
  handoffDecisionDocument.behaviors = handoffDecisionDocument.behaviors.slice(0, 2);
  handoffDecisionDocument.flow_relations = handoffDecisionDocument.flow_relations.slice(0, 2);
  handoffDecisionDocument.cross_department_handoffs = [{
    handoff_ref: 'handoff-approved',
    handoff_direction: 'outbound_followup',
    anchor_behavior_ref: 'behavior_review',
    counterparty_resolution: 'identified',
    source_department: '财务部',
    target_department: '公司领导',
    transfer_data_ref: 'data_application',
    returned_data_ref: 'data_application',
    requested_matter: '审批申请',
    trigger_condition: '审核通过',
    completion_standard: '审批完成',
    counterparty_process_ref: null,
    counterparty_process_name: '',
    counterparty_behavior_ref: null,
    counterparty_behavior_name: '',
    requires_return: false,
    resume_behavior_ref: null
  }];
  warningMessages = Array.from(
    businessWarningContext.businessWarningsForTest(handoffDecisionDocument),
    item => item.message
  );
  assert.equal(
    warningMessages.some(message => message.includes('审核申请少于两条明确出口')),
    false,
    'a loop and a cross-department handoff are two explicit decision outlets'
  );
  assert.equal(
    warningMessages.some(message => message.includes('当前识别到0个流程入口')),
    false,
    'explicit loops must not erase the mainline entry during topology checks'
  );

  handoffDecisionDocument.export_meta.compiler = '';
  const compilerWarning = Array.from(
    businessWarningContext.businessWarningsForTest(handoffDecisionDocument)
  ).find(item => item.message === '未填写编制人');
  assert.equal(compilerWarning.editorSection, 'basic');
  assert.equal(compilerWarning.focusPath, 'export_meta.compiler');
  handoffDecisionDocument.export_meta.compiler = '测试编制人';
  handoffDecisionDocument.cross_department_handoffs[0].trigger_condition = '';
  handoffDecisionDocument.cross_department_handoffs[0].completion_standard = '';
  const incompleteDecisionWarning = Array.from(
    businessWarningContext.businessWarningsForTest(handoffDecisionDocument)
  ).find(item => item.message === '跨部门待办（候选）1没有可识别的触发条件和完成标准。');
  assert.equal(incompleteDecisionWarning.focusKind, 'handoff');
  assert.equal(incompleteDecisionWarning.focusRef, 'handoff-approved');
  assert.equal(incompleteDecisionWarning.focusPath, 'cross_department_handoffs.0.trigger_condition');

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
  assert.ok(html.includes('<strong>流程图预览：</strong>'));
  assert.ok(html.includes('系统不会按录入顺序自动连线'));
  assert.ok(html.includes('该图根据导入内容生成，仅用于核对，不代表已经审核'));
  assert.ok(html.includes('有 ${model.unresolvedCount} 项内容无法绘制'));
    ['业务行为', '判断', '并行', '流程关系', '跨部门待办（候选）', '内部流程调用', '类型待判断']
    .forEach(label => assert.ok(html.includes(`<strong>${label}</strong>`), `diagram legend must include ${label}`));
  assert.ok(html.includes('先看泳道确认责任部门，再沿实线箭头从左向右阅读；虚线箭头表示跨部门待办（候选）。带条件的前进箭头表示判断分支；标有“回路”的返回箭头表示退回前序步骤。'));
  assert.ok(html.includes('顺序、判断分支、流程内部回路和并行路线怎么选？'));
  assert.ok(html.includes('当前节点完成后，默认进入下一业务行为。判断节点可以用一条顺序关系表示默认继续路径，不需要填写条件。'));
  assert.ok(html.includes('需要按某个明确判断结果进入后续步骤时使用。需要填写判断条件和要去的步骤。'));
  assert.ok(html.includes('因为审核不通过、材料有误等原因，退回本流程前面已经存在的步骤重新处理。需要填写退回条件和退回位置。'));
  assert.ok(html.includes('从并行开始节点同时启动多条办理路线时使用。并行开始至少需要2条并行路线；并行汇合至少需要2个有效来源。'));
  assert.ok(html.includes('承接顺序或判断分支的后续节点仍可以是普通业务行为。是否选择判断节点，只取决于该节点本身是否还要继续判断。'));
  assert.ok(html.includes('例：部门负责人审核报销单。审核通过 → 使用顺序关系进入财务复核；审核不通过 → 使用流程内部回路退回申请人补充材料。财务复核仍是普通业务行为。'));
  assert.ok(html.includes('默认继续下一步选择“顺序”；按判断结果进入后续步骤选择“判断分支”；退回前序步骤选择“流程内部回路”；同时启动或汇合多条路线选择“并行路线”。'));
  assert.ok(html.includes('判断分支条件或回路触发条件（顺序关系可不填）'));
  assert.ok(html.includes('${guidance}${workbench}'));
  assert.match(html, /\.relation-guidance-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.ok(html.includes('查看图例示例'));
  assert.ok(html.includes('BPMN 2.0.2图形子集'));
  assert.ok(html.includes('data-action="toggle-diagram-example"'));
  assert.ok(html.includes('data-action="toggle-diagram-expanded"'));
  assert.ok(html.includes('展开查看'));
  assert.ok(html.includes('适应画布'));
  assert.ok(html.includes('重置视图'));
  assert.ok(html.includes('当前已聚焦流程开头，点击“适应画布”查看完整流程'));
  assert.ok(html.includes('该关系与其他非回路关系形成闭环；如果这是退回前序行为，请选择“流程内部回路”。'));
  assert.ok(html.includes('let diagramExampleExpanded = false'));
  assert.ok(html.includes('let diagramExpanded = false'));
  assert.equal(html.includes('显示数据对象'), false);
  assert.ok(html.includes('selectInitialTabAfterImport();'));
  assert.ok(html.includes("activeEditorSection = 'process'"));
  assert.ok(html.includes('<script src="/vendor/cytoscape.min.js"></script>'));
  assert.ok(html.includes('<script src="process-diagram.js"></script>'));
  assert.ok(html.includes('<script src="structure-score.js"></script>'));
  assert.ok(html.includes('async function runStructureScore(context)'));
  assert.ok(html.includes("await ensureCompatibleValidationService('重新评分')"));
  assert.ok(html.includes("fetch('/api/validate'"));
  assert.ok(html.includes('context.documentKey !== currentStructureScoreKey()'));
  assert.equal(
    html.slice(
      html.indexOf('    async function runStructureScore(context) {'),
      html.indexOf('    async function exportCurrent()', html.indexOf('    async function runStructureScore(context) {'))
    ).includes('touch()'),
    false,
    'scoring must not mark or modify the current candidate'
  );
  assert.match(diagramSource, /autoungrabify:\s*true/);
  assert.match(diagramSource, /buildGraphModel/);
  assert.match(diagramSource, /name:\s*'preset'/);
  assert.ok(diagramSource.includes('lane-header-node'));
  assert.ok(diagramSource.includes('countersign-badge'));
  assert.ok(diagramSource.includes('const EDGE_LABEL_MAX_WIDTH = 220'));
  assert.ok(diagramSource.includes('const MIN_COLUMN_GAP = 440'));
  assert.ok(diagramSource.includes('const FULL_VIEW_MIN_ZOOM = 0.6'));
  assert.ok(diagramSource.includes("'text-overflow-wrap': 'anywhere'"));
  assert.ok(diagramSource.includes("'control-point-distances': 'data(controlPointDistance)'"));
  assert.match(diagramSource, /minZoom:\s*0\.03/);
  assert.ok(diagramSource.includes("'curve-style': 'taxi'"));
  assert.ok(diagramSource.includes("'source-arrow-fill': 'hollow'"));
  assert.ok(diagramSource.includes("'target-arrow-fill': 'hollow'"));
  assert.ok(diagramSource.includes("'line-style': 'solid'"));
  assert.equal(diagramSource.includes("graphRef('data'"), false, 'the main diagram may read a data name but must not render data objects as nodes');
  assert.equal(diagramSource.includes('data-object-node'), false, 'the main diagram must not add data-object node styles');
  assert.equal(/bpmn(?:-js)?|BPMN XML/i.test(diagramSource), false, 'the preview must not add a BPMN engine or XML');
  assert.equal(/https?:\/\//.test(diagramSource), false, 'diagram runtime must not depend on a CDN');
  assert.ok(serverSource.includes("app.get('/vendor/cytoscape.min.js'"));
  assert.equal(/\/api\/suggestions/.test(html), false);
  assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie|sessionId|\/api\/session/.test(html), false);
  assert.ok(html.includes('归口部门审核导入3000后，系统才生成正式待办'));
  assert.equal(diagramSource.includes('3000'), false, 'diagram guidance must use MDM平台 instead of the port number');
  assert.equal(structureScoreSource.includes('3000'), false, 'score guidance must use MDM平台 instead of the port number');
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
