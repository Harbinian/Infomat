const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const vm = require('node:vm');
const Ajv2020 = require('ajv/dist/2020');
const {
  app,
  extractFromText,
  decodeTextBuffer,
  createEmptyProcessGovernanceDocument,
  createEmptyProcessGovernanceV6Document,
  PROCESS_GOVERNANCE_SCHEMA_DIGEST
} = require('../server');

const appRoot = path.join(__dirname, '..');
const repoRoot = path.join(appRoot, '..', '..');
const frontendPath = path.join(appRoot, 'public', 'index.html');
const processDiagramPath = path.join(appRoot, 'public', 'process-diagram.js');
const reviewPatternDiagramsPath = path.join(appRoot, 'public', 'review-pattern-diagrams.js');
const structureScorePath = path.join(appRoot, 'public', 'structure-score.js');
const governanceWorkflowPath = path.join(appRoot, 'public', 'governance-workflow.js');
const webGridCorePath = path.join(appRoot, 'public', 'web-grid-core.js');
const nativeWebGridPath = path.join(appRoot, 'public', 'native-web-grid.js');
const processV7GridAdapterPath = path.join(appRoot, 'public', 'process-v7-grid-adapter.js');
const editSessionManagerPath = path.join(appRoot, 'public', 'edit-session-manager.js');
const packageJsonPath = path.join(appRoot, 'package.json');
const serverPath = path.join(appRoot, 'server.js');
const processV1SchemaPath = path.join(repoRoot, 'docs', 'contracts', 'process-governance-v1.schema.json');
const processV2SchemaPath = path.join(repoRoot, 'docs', 'contracts', 'process-governance-v2.schema.json');
const processV3SchemaPath = path.join(repoRoot, 'docs', 'contracts', 'process-governance-v3.schema.json');
const processV4SchemaPath = path.join(repoRoot, 'docs', 'contracts', 'process-governance-v4.schema.json');
const processSchemaPath = path.join(repoRoot, 'docs', 'contracts', 'process-governance-v5.schema.json');
const processV6SchemaPath = path.join(repoRoot, 'docs', 'contracts', 'process-governance-v6.schema.json');
const processV7SchemaPath = path.join(repoRoot, 'docs', 'contracts', 'process-governance-v7.schema.json');
const legacySchemaPath = path.join(repoRoot, 'docs', 'contracts', 'document-structured-output.schema.json');
const Migration = require(path.join(appRoot, 'public', 'process-governance-migration.js'));
const { buildGraphModel } = require(processDiagramPath);
const ReviewPatternDiagrams = require(reviewPatternDiagramsPath);
const StructureScore = require(structureScorePath);

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

function createV4Draft(overrides = {}) {
  const result = createDraft();
  result.schema_version = 'process-governance-v4';
  result.behaviors.forEach(behavior => {
    delete behavior.input_data_refs;
    delete behavior.output_data_refs;
  });
  result.data_objects = result.data_objects.map(item => ({
    data_ref: item.data_ref,
    data_name: item.data_name,
    description: item.description,
    governance_status: 'candidate',
    information_type: 'business_information',
    behavior_links: [{ link_ref: 'data_link_apply_create', behavior_ref: 'behavior_apply', operation: 'create' }],
    source_relations: []
  }));
  result.forms = result.forms.map(form => ({
    form_ref: form.form_ref,
    form_name: form.form_name,
    form_no: form.form_no,
    form_design_state: form.form_design_state,
    behavior_links: [{
      link_ref: 'form_link_apply',
      behavior_ref: 'behavior_apply',
      operations: ['fill'],
      notes: ''
    }],
    areas: form.areas.map(area => ({
      ...area,
      items: area.items.map(item => ({
        ...item,
        business_data_ref: 'data_application',
        value_origin_mode: 'direct_current_process',
        source_links: []
      }))
    }))
  }));
  return Object.assign(result, overrides);
}

function createV5Draft(overrides = {}) {
  const result = createV4Draft();
  result.schema_version = 'process-governance-v5';
  delete result.cross_department_handoffs;
  return Object.assign(result, overrides);
}

function createRepresentativeV4Draft() {
  const result = createV4Draft();
  result.behaviors = Array.from({ length: 40 }, (_, index) => ({
    ...JSON.parse(JSON.stringify(result.behaviors[0])),
    behavior_ref: `behavior_perf_${index + 1}`,
    behavior_name: `代表性业务行为${index + 1}`,
    work_role: null
  }));
  result.flow_relations = Array.from({ length: 39 }, (_, index) => ({
    relation_ref: `relation_perf_${index + 1}`,
    relation_type: 'sequence',
    from_behavior_ref: `behavior_perf_${index + 1}`,
    to_behavior_ref: `behavior_perf_${index + 2}`,
    condition: '',
    join_mode: ''
  }));
  result.data_objects = Array.from({ length: 30 }, (_, index) => ({
    data_ref: `data_perf_${index + 1}`,
    data_name: `代表性数据${index + 1}`,
    description: `用于代表性规模校验的数据${index + 1}`,
    governance_status: 'candidate',
    information_type: 'business_information',
    behavior_links: [
      { link_ref: `data_link_perf_${index + 1}_create`, behavior_ref: `behavior_perf_${index + 1}`, operation: 'create' },
      { link_ref: `data_link_perf_${index + 1}_use`, behavior_ref: `behavior_perf_${index + 2}`, operation: 'use' }
    ],
    source_relations: []
  }));
  result.forms = Array.from({ length: 10 }, (_, formIndex) => ({
    form_ref: `form_perf_${formIndex + 1}`,
    form_name: `代表性表单${formIndex + 1}`,
    form_no: null,
    form_design_state: 'current_state',
    behavior_links: [{
      link_ref: `form_link_perf_${formIndex + 1}`,
      behavior_ref: `behavior_perf_${formIndex + 1}`,
      operations: ['fill'],
      notes: ''
    }],
    areas: [{
      area_ref: `area_perf_${formIndex + 1}`,
      area_type: '基本信息',
      area_title: '',
      items: Array.from({ length: 20 }, (_, itemIndex) => {
        const sourceIndex = (formIndex * 8 + itemIndex) % 30;
        const hasSource = itemIndex < 8;
        return {
          item_ref: `item_perf_${formIndex + 1}_${itemIndex + 1}`,
          item_name: `字段${itemIndex + 1}`,
          item_type: '文本',
          required: false,
          instructions: '',
          business_data_ref: `data_perf_${(formIndex * 20 + itemIndex) % 30 + 1}`,
          value_origin_mode: hasSource ? 'depends_on_data' : 'direct_current_process',
          source_links: hasSource ? [{
            source_link_ref: `field_source_perf_${formIndex + 1}_${itemIndex + 1}`,
            source_data_ref: `data_perf_${sourceIndex + 1}`,
            source_role: 'provides_value'
          }] : []
        };
      })
    }]
  }));
  return result;
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

async function postChunkedJson(baseUrl, route, chunks) {
  const url = new URL(route, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' }
    }, response => {
      const body = [];
      response.on('data', chunk => body.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(body).toString('utf8')
      }));
    });
    request.on('error', reject);
    chunks.forEach(chunk => request.write(chunk));
    request.end();
  });
}

async function postFixedLengthJson(baseUrl, route, body) {
  const url = new URL(route, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function rawHttpExchange(baseUrl, requestText) {
  const url = new URL(baseUrl);
  return await new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('raw HTTP parser test timed out'));
    }, 3000);
    socket.on('connect', () => socket.end(requestText));
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

function jsonBodyWithExactByteLength(byteLength) {
  const prefix = '{"data":{"schema_version":"process-governance-v7","padding":[';
  const suffix = ']}}';
  const segmentCount = 11;
  const framingBytes = Buffer.byteLength(prefix + suffix, 'utf8') + (segmentCount * 2) + (segmentCount - 1);
  const contentBytes = byteLength - framingBytes;
  assert.ok(contentBytes > 0);
  const baseLength = Math.floor(contentBytes / segmentCount);
  const remainder = contentBytes % segmentCount;
  const segments = Array.from({ length: segmentCount }, (_, index) => (
    'x'.repeat(baseLength + (index < remainder ? 1 : 0))
  ));
  assert.ok(segments.every(segment => Buffer.byteLength(segment, 'utf8') <= 1024 * 1024));
  const body = `${prefix}${segments.map(segment => JSON.stringify(segment)).join(',')}${suffix}`;
  assert.equal(Buffer.byteLength(body, 'utf8'), byteLength);
  return body;
}

function zipWithSingleEntry(entryName, options = {}) {
  const name = Buffer.from(entryName, 'utf8');
  const data = Buffer.from(options.data || 'x');
  const compressedSize = options.compressedSize ?? data.length;
  const uncompressedSize = options.uncompressedSize ?? data.length;
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(compressedSize, 18);
  local.writeUInt32LE(uncompressedSize, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(compressedSize, 20);
  central.writeUInt32LE(uncompressedSize, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + data.length, 16);
  return Buffer.concat([local, data, central, eocd]);
}

async function testSchemas() {
  const processSchema = JSON.parse(fs.readFileSync(processSchemaPath, 'utf8'));
  const processV3Schema = JSON.parse(fs.readFileSync(processV3SchemaPath, 'utf8'));
  const processV2Schema = JSON.parse(fs.readFileSync(processV2SchemaPath, 'utf8'));
  const processV1Schema = JSON.parse(fs.readFileSync(processV1SchemaPath, 'utf8'));
  const processV4Schema = JSON.parse(fs.readFileSync(processV4SchemaPath, 'utf8'));
  const processV6Schema = JSON.parse(fs.readFileSync(processV6SchemaPath, 'utf8'));
  const processV7Schema = JSON.parse(fs.readFileSync(processV7SchemaPath, 'utf8'));
  const legacySchema = JSON.parse(fs.readFileSync(legacySchemaPath, 'utf8'));
  const processAjv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  processAjv.addSchema(processV1Schema);
  processAjv.addSchema(processV2Schema);
  processAjv.addSchema(processV3Schema);
  processAjv.addSchema(processV4Schema);
  const processValidator = processAjv.compile(processSchema);
  const processV6Validator = processAjv.compile(processV6Schema);
  const processV7Validator = processAjv.compile(processV7Schema);
  const processV4Validator = processAjv.getSchema(processV4Schema.$id);
  const processV3Validator = processAjv.getSchema(processV3Schema.$id);
  const processV2Validator = processAjv.getSchema(processV2Schema.$id);
  const processV1Validator = processAjv.getSchema(processV1Schema.$id);
  const legacyValidator = new Ajv2020({ allErrors: true, strict: false }).compile(legacySchema);
  assert.match(processSchema.properties.process.$ref, /process-governance-v1/);
  assert.equal(processV1Schema.$defs.process.type, 'object');
  assert.equal(Object.prototype.hasOwnProperty.call(processSchema.properties, 'processes'), false);
  assert.equal(processSchema.properties.schema_version.const, 'process-governance-v5');
  assert.equal(Object.prototype.hasOwnProperty.call(processSchema.properties, 'cross_department_handoffs'), false);
  assert.ok(processSchema.properties.migration);
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
  assert.equal(processV3Validator(createDraft()), true, JSON.stringify(processV3Validator.errors));
  assert.equal(processV4Validator(createV4Draft()), true, JSON.stringify(processV4Validator.errors));
  assert.equal(processValidator(createV5Draft()), true, JSON.stringify(processValidator.errors));
  const publicV4Sample = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'docs', 'samples', '3001-data-form-relationship-sample-v4.json'),
    'utf8'
  ));
  assert.equal(processV4Validator(publicV4Sample), true, JSON.stringify(processV4Validator.errors));
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
    processV6Validator(createEmptyProcessGovernanceV6Document()),
    true,
    JSON.stringify(processV6Validator.errors)
  );
  assert.equal(
    processV7Validator(createEmptyProcessGovernanceDocument()),
    true,
    JSON.stringify(processV7Validator.errors)
  );
  assert.ok(processV7Schema.$defs.dataBehaviorLink.properties.updated_field_refs);
  const v7UpdateRelation = Migration.migrateDocument(createV5Draft())[0];
  const updateDataObject = v7UpdateRelation.data_objects[0];
  updateDataObject.behavior_links = [{
    link_ref: 'data_link_update_test',
    behavior_ref: v7UpdateRelation.behaviors[0].behavior_ref,
    operation: 'update',
    updated_field_refs: [updateDataObject.fields[0].field_ref]
  }];
  assert.equal(processV7Validator(v7UpdateRelation), true, JSON.stringify(processV7Validator.errors));
  updateDataObject.behavior_links[0].operation = 'use';
  assert.equal(processV7Validator(v7UpdateRelation), false, 'non-update operations must not retain updated fields');

  const incomplete = createV5Draft();
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
    assert.equal(health.body.schema_version, 'process-governance-v7');
    assert.equal(health.body.release_status, 'released');
    assert.equal(Object.prototype.hasOwnProperty.call(health.body, 'deepseek'), false);

    const retiredTabulatorScript = await fetch(`${baseUrl}/vendor/tabulator.min.js`);
    const retiredTabulatorStyle = await fetch(`${baseUrl}/vendor/tabulator.min.css`);
    const retiredGridEditor = await fetch(`${baseUrl}/web-grid-editors.js`);
    assert.doesNotMatch(retiredTabulatorScript.headers.get('content-type') || '', /javascript/);
    assert.doesNotMatch(retiredTabulatorStyle.headers.get('content-type') || '', /css/);
    assert.doesNotMatch(retiredGridEditor.headers.get('content-type') || '', /javascript/);
    const nativeWebGridAsset = await fetch(`${baseUrl}/native-web-grid.js`);
    assert.equal(nativeWebGridAsset.status, 200);
    assert.match(nativeWebGridAsset.headers.get('content-type') || '', /javascript/);
    assert.match(await nativeWebGridAsset.text(), /isCompositionKey/);
    const editSessionManagerAsset = await fetch(`${baseUrl}/edit-session-manager.js`);
    assert.equal(editSessionManagerAsset.status, 200);
    assert.match(editSessionManagerAsset.headers.get('content-type') || '', /javascript/);
    assert.match(await editSessionManagerAsset.text(), /mergeAllowedPatch/);

    const schema = await getJson(baseUrl, '/api/schema');
    assert.equal(schema.body.properties.schema_version.const, 'process-governance-v7');
    assert.equal(Object.prototype.hasOwnProperty.call(schema.body.properties, 'cross_department_handoffs'), false);
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
    const previousV3Schema = await getJson(baseUrl, '/api/schema?version=process-governance-v3');
    assert.equal(previousV3Schema.body.properties.schema_version.const, 'process-governance-v3');
    const previousV4Schema = await getJson(baseUrl, '/api/schema?version=process-governance-v4');
    assert.equal(previousV4Schema.body.properties.schema_version.const, 'process-governance-v4');
    const previousV5Schema = await getJson(baseUrl, '/api/schema?version=process-governance-v5');
    assert.equal(previousV5Schema.body.properties.schema_version.const, 'process-governance-v5');
    assert.ok(previousV5Schema.response.headers.get('x-infomat-schema-digest'));

    const previousV5Health = await getJson(baseUrl, '/api/health?version=process-governance-v5');
    assert.equal(previousV5Health.response.status, 200);
    assert.equal(previousV5Health.body.schema_version, 'process-governance-v5');
    assert.equal(
      previousV5Health.body.schema_digest,
      previousV5Schema.response.headers.get('x-infomat-schema-digest')
    );

    const previousV6Schema = await getJson(baseUrl, '/api/schema?version=process-governance-v6');
    const previousV6Health = await getJson(baseUrl, '/api/health?version=process-governance-v6');
    assert.equal(previousV6Health.response.status, 200);
    assert.equal(previousV6Health.body.schema_version, 'process-governance-v6');
    assert.equal(
      previousV6Health.body.schema_digest,
      previousV6Schema.response.headers.get('x-infomat-schema-digest')
    );

    const versionHistory = await getJson(baseUrl, '/api/version-history');
    assert.equal(versionHistory.response.status, 200);
    assert.equal(versionHistory.response.headers.get('cache-control'), 'no-store');
    assert.equal(versionHistory.body.current_version, 'process-governance-v7');
    assert.equal(versionHistory.body.current_status, 'released');
    assert.equal(versionHistory.body.versions.at(-1).status, 'released');
    assert.equal(versionHistory.body.versions.at(-1).released_on, '2026-08-21');
    assert.deepEqual(versionHistory.body.versions.map(item => item.version), [
      'process-governance-v1', 'process-governance-v2', 'process-governance-v3', 'process-governance-v4', 'process-governance-v5', 'process-governance-v6', 'process-governance-v7'
    ]);
    const v7History = versionHistory.body.versions.find(item => item.version === 'process-governance-v7');
    assert.equal(v7History.schema_revisions.length, 2, 'v7 history must contain the two known schema revisions');
    assert.equal(
      v7History.schema_revisions.every(item => ['current', 'supported_legacy'].includes(item.status)),
      true,
      'v7 schema revision status must be current or supported_legacy'
    );
    const currentV7Revisions = v7History.schema_revisions.filter(item => item.status === 'current');
    const supportedLegacyV7Revisions = v7History.schema_revisions.filter(item => item.status === 'supported_legacy');
    assert.equal(currentV7Revisions.length, 1, 'v7 history must identify exactly one current schema revision');
    assert.equal(supportedLegacyV7Revisions.length, 1, 'v7 history must identify exactly one supported legacy schema revision');
    const currentV7Revision = currentV7Revisions[0];
    const earlyV7Revision = supportedLegacyV7Revisions[0];
    assert.equal(currentV7Revision.schema_digest, PROCESS_GOVERNANCE_SCHEMA_DIGEST);
    assert.equal(currentV7Revision.schema_digest, 'e1d5b33ba80393c0d02c1a48540dca5a67947295c66a7d1f0fbf7e20a25eaacb');
    assert.equal(currentV7Revision.introduced_on, '2026-08-24');
    assert.equal(currentV7Revision.source_commit, '624d469d23630d0e01674ad90de7bb0789a3c51f');
    assert.equal(currentV7Revision.validation_profile, null);
    assert.equal(health.body.schema_digest, currentV7Revision.schema_digest, 'current health digest must match the current v7 schema revision');
    assert.equal(earlyV7Revision.schema_digest, 'eca657ed7a3d46b7b6d362f69e1188281210073144f5f26b74ec59da8b3a6e9c');
    assert.equal(earlyV7Revision.introduced_on, '2026-08-21');
    assert.equal(earlyV7Revision.source_commit, '440c09f265621651eb39c2aeb763d1bb5fa1e287');
    assert.equal(earlyV7Revision.validation_profile, 'early-v7-data-fields');
    for (const revision of v7History.schema_revisions) {
      assert.deepEqual(
        Object.keys(revision),
        ['schema_digest', 'introduced_on', 'source_commit', 'status', 'validation_profile', 'notes'],
        'v7 schema revisions must expose the frozen additive field set in a stable order'
      );
    }
    assert.equal(
      v7History.schema_revisions.filter(item => item.validation_profile === 'early-v7-data-fields').length,
      1,
      'the early v7 compatibility profile must belong to one recorded schema revision'
    );

    const template = await getJson(baseUrl, '/api/template');
    assert.equal(template.response.status, 200);
    assert.equal(template.response.headers.get('cache-control'), 'no-store');
    assert.equal(template.body.schema_version, 'process-governance-v7');
    assert.equal(template.body.schema_digest, PROCESS_GOVERNANCE_SCHEMA_DIGEST);
    assert.equal(template.body.data.schema_version, 'process-governance-v7');
    assert.equal(Object.prototype.hasOwnProperty.call(template.body.data, 'cross_department_handoffs'), false);
    assert.equal(typeof template.body.data.export_meta.package_ref, 'string');
    assert.equal(typeof template.body.data.process.process_ref, 'string');
    assert.deepEqual(template.body.data.migration.reference_materials, []);
    assert.deepEqual(template.body.data.migration.internal_process_calls, []);
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
    const missingFileResponse = await fetch(`${baseUrl}/api/upload`, { method: 'POST' });
    assert.equal(missingFileResponse.status, 400);
    assert.equal((await missingFileResponse.json()).code, 'FILE_REQUIRED');
    const emptyFileBody = new FormData();
    emptyFileBody.append('file', new Blob(['   '], { type: 'text/plain' }), '空白.txt');
    const emptyFileResponse = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: emptyFileBody });
    assert.equal(emptyFileResponse.status, 400);
    assert.equal((await emptyFileResponse.json()).code, 'FILE_CONTENT_EMPTY');
    const unsupportedFileBody = new FormData();
    unsupportedFileBody.append('file', new Blob(['pdf'], { type: 'application/pdf' }), '不支持.pdf');
    const unsupportedFileResponse = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: unsupportedFileBody });
    assert.equal(unsupportedFileResponse.status, 415);
    assert.equal((await unsupportedFileResponse.json()).code, 'UNSUPPORTED_FILE_TYPE');
    const emptyPaste = await postJson(baseUrl, '/api/paste', { text: '  ' });
    assert.equal(emptyPaste.response.status, 400);
    assert.equal(emptyPaste.body.code, 'PASTED_CONTENT_EMPTY');
    const missingPasteBodyResponse = await fetch(`${baseUrl}/api/paste`, { method: 'POST' });
    assert.equal(missingPasteBodyResponse.status, 400);
    assert.equal((await missingPasteBodyResponse.json()).code, 'PASTED_CONTENT_EMPTY');
    const emptyPasteObject = await postJson(baseUrl, '/api/paste', {});
    assert.equal(emptyPasteObject.response.status, 400);
    assert.equal(emptyPasteObject.body.code, 'PASTED_CONTENT_EMPTY');
    const brokenDocxBody = new FormData();
    brokenDocxBody.append('file', new Blob(['not-a-docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), '损坏文件.docx');
    const brokenDocxResponse = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: brokenDocxBody });
    assert.equal(brokenDocxResponse.status, 422);
    const brokenDocxText = await brokenDocxResponse.text();
    const brokenDocx = JSON.parse(brokenDocxText);
    assert.equal(brokenDocx.code, 'FILE_PARSE_FAILED');
    assert.equal(Object.prototype.hasOwnProperty.call(brokenDocx, 'detail'), false);
    assert.doesNotMatch(brokenDocxText, /node_modules|Error:|E:\\\\/i);
    const unsafeDocxBody = new FormData();
    unsafeDocxBody.append('file', new Blob([zipWithSingleEntry('../outside.xml')]), '路径越界.docx');
    const unsafeDocxResponse = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: unsafeDocxBody });
    assert.equal(unsafeDocxResponse.status, 422);
    const unsafeDocx = await unsafeDocxResponse.json();
    assert.equal(unsafeDocx.code, 'DOCX_ARCHIVE_UNSAFE');

    const valid = await postJson(baseUrl, '/api/validate', { data: createDraft() });
    assert.equal(valid.response.status, 200);
    assert.equal(valid.body.valid, true, JSON.stringify(valid.body.errors));

    const validV4 = await postJson(baseUrl, '/api/validate', { data: createV4Draft() });
    assert.equal(validV4.response.status, 200);
    assert.equal(validV4.body.valid, true, JSON.stringify(validV4.body.errors));
    const brokenV4BehaviorLink = createV4Draft();
    brokenV4BehaviorLink.data_objects[0].behavior_links[0].behavior_ref = 'behavior_missing';
    const brokenV4BehaviorValidation = await postJson(baseUrl, '/api/validate', { data: brokenV4BehaviorLink });
    assert.equal(brokenV4BehaviorValidation.body.valid, false);
    assert.ok(brokenV4BehaviorValidation.body.errors.some(error => /数据关系对应行为/.test(error.message)));
    const brokenV4FieldSource = createV4Draft();
    brokenV4FieldSource.forms[0].areas[0].items[0].value_origin_mode = 'depends_on_data';
    brokenV4FieldSource.forms[0].areas[0].items[0].source_links = [{
      source_link_ref: 'field_source_missing',
      source_data_ref: 'data_missing',
      source_role: 'provides_value'
    }];
    const brokenV4FieldValidation = await postJson(baseUrl, '/api/validate', { data: brokenV4FieldSource });
    assert.equal(brokenV4FieldValidation.body.valid, false);
    assert.ok(brokenV4FieldValidation.body.errors.some(error => /字段取值来源数据/.test(error.message)));

    const externalSystemFieldSource = createV5Draft();
    externalSystemFieldSource.forms[0].areas[0].items[0].value_origin_mode = 'depends_on_data';
    externalSystemFieldSource.forms[0].areas[0].items[0].source_links = [{
      source_link_ref: 'field_source_external_system',
      source_type: 'external_system',
      source_data_ref: null,
      source_system_name: '外部业务系统',
      source_data_name: '申请单位信息',
      source_role: 'provides_value'
    }];
    const externalSystemFieldValidation = await postJson(baseUrl, '/api/validate', { data: externalSystemFieldSource });
    assert.equal(externalSystemFieldValidation.body.valid, true, JSON.stringify(externalSystemFieldValidation.body.errors));

    const previousV5FieldSource = createV5Draft();
    previousV5FieldSource.forms[0].areas[0].items[0].value_origin_mode = 'depends_on_data';
    previousV5FieldSource.forms[0].areas[0].items[0].source_links = [{
      source_link_ref: 'field_source_previous_v5',
      source_data_ref: 'data_application',
      source_role: 'provides_value'
    }];
    const previousV5FieldValidation = await postJson(baseUrl, '/api/validate', { data: previousV5FieldSource });
    assert.equal(previousV5FieldValidation.body.valid, true, JSON.stringify(previousV5FieldValidation.body.errors));
    const v6PureInput = Migration.migrateDocument(createV5Draft())[0];
    const v6PureSnapshot = JSON.parse(JSON.stringify(v6PureInput));
    const v6PureValidation = await postJson(baseUrl, '/api/validate', { data: v6PureInput });
    assert.equal(v6PureValidation.body.valid, true, JSON.stringify(v6PureValidation.body.errors));
    assert.deepEqual(v6PureValidation.body.data, v6PureSnapshot, '/api/validate must not migrate or normalize v6 input');
    const v6IllegalEnum = JSON.parse(JSON.stringify(v6PureInput));
    v6IllegalEnum.data_objects[0].information_type = 'not-an-information-type';
    const v6IllegalEnumValidation = await postJson(baseUrl, '/api/validate', { data: v6IllegalEnum });
    assert.equal(v6IllegalEnumValidation.body.valid, false);
    const v6DuplicateId = JSON.parse(JSON.stringify(v6PureInput));
    v6DuplicateId.data_objects[0].data_ref = v6DuplicateId.behaviors[0].behavior_ref;
    const v6DuplicateIdValidation = await postJson(baseUrl, '/api/validate', { data: v6DuplicateId });
    assert.equal(v6DuplicateIdValidation.body.valid, false);
    assert.ok(
      v6DuplicateIdValidation.body.errors.some(error => /技术标识.*重复/.test(error.message)),
      JSON.stringify(v6DuplicateIdValidation.body.errors)
    );
    const representativeV4 = createRepresentativeV4Draft();
    const representativeValidation = await postJson(baseUrl, '/api/validate', { data: representativeV4 });
    assert.equal(representativeValidation.body.valid, true, JSON.stringify(representativeValidation.body.errors));
    assert.equal(representativeV4.behaviors.length, 40);
    assert.equal(representativeV4.data_objects.length, 30);
    assert.equal(representativeV4.forms.length, 10);
    assert.equal(representativeV4.forms.flatMap(form => form.areas.flatMap(area => area.items)).length, 200);
    assert.equal(representativeV4.forms.flatMap(form => form.areas.flatMap(area => area.items.flatMap(item => item.source_links))).length, 80);

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

    const duplicateV7 = Migration.migrateDocument(createV5Draft())[0];
    duplicateV7.behaviors.push(JSON.parse(JSON.stringify(duplicateV7.behaviors[0])));
    const duplicateV7Validation = await postJson(baseUrl, '/api/validate', { data: duplicateV7 });
    const duplicateBehaviorErrors = duplicateV7Validation.body.errors.filter(error =>
      error.path === '/behaviors/1/behavior_ref' && error.params?.ref === duplicateV7.behaviors[0].behavior_ref
    );
    assert.equal(duplicateBehaviorErrors.length, 1, 'one duplicate identifier root cause must appear once');
    assert.match(duplicateBehaviorErrors[0].error_id, /^localReference:/);

    const brokenReference = createDraft();
    brokenReference.behaviors[0].output_data_refs = ['data_missing'];
    const brokenValidation = await postJson(baseUrl, '/api/validate', { data: brokenReference });
    assert.equal(brokenValidation.body.valid, false);
    assert.ok(brokenValidation.body.errors.some(error => /不在当前文件中/.test(error.message)));

    const earlyV7 = Migration.migrateDocument(createV5Draft())[0];
    earlyV7.data_objects.forEach(dataObject => {
      delete dataObject.fields;
      dataObject.behavior_links.forEach(link => { delete link.updated_field_refs; });
    });
    earlyV7.forms.forEach(form => form.areas.forEach(area => area.items.forEach(item => {
      delete item.data_field_ref;
      delete item.value_usage_mode;
    })));
    const earlyV7Validation = await postJson(baseUrl, '/api/validate', {
      data: earlyV7,
      validation_profile: 'early-v7-data-fields'
    });
    assert.equal(
      earlyV7Validation.body.valid,
      true,
      `early v7 missing only later data-field properties must remain importable: ${JSON.stringify(earlyV7Validation.body.errors)}`
    );
    const invalidEarlyV7 = JSON.parse(JSON.stringify(earlyV7));
    invalidEarlyV7.behaviors[0].node_type = 'invalid-node-type';
    const invalidEarlyV7Validation = await postJson(baseUrl, '/api/validate', {
      data: invalidEarlyV7,
      validation_profile: 'early-v7-data-fields'
    });
    assert.equal(invalidEarlyV7Validation.body.valid, false, 'early v7 compatibility must not forgive illegal business values');
    assert.ok(invalidEarlyV7Validation.body.errors.some(error => error.path === '/behaviors/0/node_type'));
    const brokenEarlyV7 = JSON.parse(JSON.stringify(earlyV7));
    brokenEarlyV7.data_objects[0].behavior_links[0].behavior_ref = 'behavior_missing';
    const brokenEarlyV7Validation = await postJson(baseUrl, '/api/validate', {
      data: brokenEarlyV7,
      validation_profile: 'early-v7-data-fields'
    });
    assert.equal(brokenEarlyV7Validation.body.valid, false);
    assert.ok(brokenEarlyV7Validation.body.errors.some(error => /不在当前文件中/.test(error.message)));
    const extraPropertyEarlyV7 = JSON.parse(JSON.stringify(earlyV7));
    extraPropertyEarlyV7.process.unexpected = 'not-allowed';
    const extraPropertyEarlyV7Validation = await postJson(baseUrl, '/api/validate', {
      data: extraPropertyEarlyV7,
      validation_profile: 'early-v7-data-fields'
    });
    assert.equal(extraPropertyEarlyV7Validation.body.valid, false);
    assert.ok(extraPropertyEarlyV7Validation.body.errors.some(error => error.keyword === 'additionalProperties'));

    const controlNodeDataLink = Migration.migrateDocument(createV5Draft())[0];
    controlNodeDataLink.behaviors[0].node_type = 'decision';
    const controlNodeValidation = await postJson(baseUrl, '/api/validate', { data: controlNodeDataLink });
    assert.equal(controlNodeValidation.body.valid, false, 'historical control-node data relationships must remain visible as errors');
    assert.ok(controlNodeValidation.body.errors.some(error =>
      error.path === '/data_objects/0/behavior_links/0/behavior_ref'
      && error.rule_code === 'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED'
      && /控制节点/.test(error.message)
    ));

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

    const missingValidationData = await postJson(baseUrl, '/api/validate', {});
    assert.equal(missingValidationData.response.status, 400);
    assert.equal(missingValidationData.body.code, 'VALIDATION_DATA_REQUIRED');
    const missingSchemaVersion = await postJson(baseUrl, '/api/validate', { data: {} });
    assert.equal(missingSchemaVersion.response.status, 400);
    assert.equal(missingSchemaVersion.body.code, 'SCHEMA_VERSION_REQUIRED');

    const unsupported = await postJson(baseUrl, '/api/validate', { data: { schema_version: 'unknown-v1' } });
    assert.equal(unsupported.response.status, 400);
    assert.equal(unsupported.body.code, 'UNSUPPORTED_SCHEMA_VERSION');

    const unknownSchemaResponse = await fetch(`${baseUrl}/api/schema?version=process-governance-v999`);
    assert.equal(unknownSchemaResponse.status, 400, 'unknown schema queries must not fall back to the current v7 schema');
    assert.match(unknownSchemaResponse.headers.get('content-type') || '', /json/);
    const unknownSchemaBody = await unknownSchemaResponse.json();
    assert.equal(unknownSchemaBody.code, 'UNSUPPORTED_SCHEMA_VERSION');
    const unknownTemplate = await getJson(baseUrl, '/api/template?version=process-governance-v999');
    assert.equal(unknownTemplate.response.status, 400);
    assert.equal(unknownTemplate.body.code, 'UNSUPPORTED_SCHEMA_VERSION');
    const unknownHealth = await getJson(baseUrl, '/api/health?version=process-governance-v999');
    assert.equal(unknownHealth.response.status, 400);
    assert.equal(unknownHealth.body.code, 'UNSUPPORTED_SCHEMA_VERSION');

    const malformedJsonResponse = await fetch(`${baseUrl}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"data":'
    });
    assert.equal(malformedJsonResponse.status, 400);
    assert.match(malformedJsonResponse.headers.get('content-type') || '', /json/);
    const malformedJsonText = await malformedJsonResponse.text();
    const malformedJsonBody = JSON.parse(malformedJsonText);
    assert.equal(malformedJsonBody.code, 'INVALID_JSON');
    assert.doesNotMatch(malformedJsonText, /node_modules|SyntaxError|E:\\\\/i);

    const maxJsonBytes = 10 * 1024 * 1024;
    const exactLimitJson = jsonBodyWithExactByteLength(maxJsonBytes);
    const fixedLengthAtLimit = await postFixedLengthJson(baseUrl, '/api/validate', exactLimitJson);
    assert.equal(fixedLengthAtLimit.status, 200, 'a JSON body at exactly 10MB must reach schema validation');
    const fixedLengthOverLimit = await postFixedLengthJson(
      baseUrl,
      '/api/validate',
      jsonBodyWithExactByteLength(maxJsonBytes + 1)
    );
    assert.equal(fixedLengthOverLimit.status, 413, 'Content-Length must not allow a JSON body over 10MB');
    assert.equal(JSON.parse(fixedLengthOverLimit.body).code, 'REQUEST_TOO_LARGE');
    const chunkedAtLimit = await postChunkedJson(baseUrl, '/api/validate', [exactLimitJson]);
    assert.equal(chunkedAtLimit.status, 200, 'a chunked JSON body at exactly 10MB must reach schema validation');
    const chunkedOverLimit = await postChunkedJson(baseUrl, '/api/validate', [
      jsonBodyWithExactByteLength(maxJsonBytes + 1)
    ]);
    assert.equal(chunkedOverLimit.status, 413, 'chunked transfer must enforce the actual 10MB byte limit');
    assert.equal(JSON.parse(chunkedOverLimit.body).code, 'REQUEST_TOO_LARGE');

    const rawParserCanary = 'CANARY_RAW_HTTP_PARSER_20260826_7B4D';
    const rawParserCases = [
      [
        'POST /api/validate HTTP/1.1',
        `Host: ${new URL(baseUrl).host}`,
        'Content-Type: application/json',
        'Transfer-Encoding: chunked',
        'Content-Length: 4',
        'Connection: close',
        '',
        '4',
        'null',
        '0',
        '',
        `GET /api/${rawParserCanary} HTTP/1.1`,
        `Host: ${new URL(baseUrl).host}`,
        'Connection: close',
        '',
        ''
      ],
      [
        'POST /api/validate HTTP/1.1',
        `Host: ${new URL(baseUrl).host}`,
        'Content-Type: application/json',
        'Content-Length: 4',
        'Content-Length: 4',
        'Connection: close',
        '',
        'null'
      ],
      [
        'POST /api/validate HTTP/1.1',
        `Host: ${new URL(baseUrl).host}`,
        'Content-Type: application/json',
        'Content-Length: 4',
        'Content-Length: 5',
        'Connection: close',
        '',
        'null!'
      ]
    ];
    for (const lines of rawParserCases) {
      const rawResponse = await rawHttpExchange(baseUrl, lines.join('\r\n'));
      assert.match(rawResponse, /^HTTP\/1\.1 400\b/, 'Node HTTP parser must reject ambiguous request framing');
      assert.doesNotMatch(rawResponse, new RegExp(rawParserCanary), 'parser rejection must not consume a pipelined canary request');
      assert.doesNotMatch(rawResponse, /API_NOT_FOUND|INVALID_JSON|REQUEST_TOO_LARGE/, 'ambiguous framing must not reach application handlers');
    }

    const oneMegabyte = 'x'.repeat(1024 * 1024);
    const oversizedChunkedResponse = await postChunkedJson(baseUrl, '/api/validate', [
      '{"data":{"schema_version":"process-governance-v7","oversized":"',
      ...Array.from({ length: 11 }, () => oneMegabyte),
      '"}}'
    ]);
    assert.equal(oversizedChunkedResponse.status, 413, 'actual received bytes must be limited even without Content-Length');
    assert.match(oversizedChunkedResponse.headers['content-type'] || '', /json/);
    const oversizedChunkedBody = JSON.parse(oversizedChunkedResponse.body);
    assert.equal(oversizedChunkedBody.code, 'REQUEST_TOO_LARGE');
    assert.equal(Object.prototype.hasOwnProperty.call(oversizedChunkedBody, 'detail'), false);

    const nestedAtLimit = { schema_version: 'process-governance-v7' };
    let nestedAtLimitCursor = nestedAtLimit;
    for (let depth = 0; depth < 64; depth += 1) {
      nestedAtLimitCursor.unexpected = {};
      nestedAtLimitCursor = nestedAtLimitCursor.unexpected;
    }
    const depthAtLimit = await postJson(baseUrl, '/api/validate', { data: nestedAtLimit });
    assert.equal(depthAtLimit.response.status, 200, 'JSON depth 64 must reach schema validation');
    const nestedOverLimit = JSON.parse(JSON.stringify(nestedAtLimit));
    let nestedOverLimitCursor = nestedOverLimit;
    for (let depth = 0; depth < 64; depth += 1) nestedOverLimitCursor = nestedOverLimitCursor.unexpected;
    nestedOverLimitCursor.unexpected = {};
    const depthOverLimit = await postJson(baseUrl, '/api/validate', { data: nestedOverLimit });
    assert.equal(depthOverLimit.response.status, 400);
    assert.equal(depthOverLimit.body.code, 'JSON_DEPTH_EXCEEDED');
    const nodesAtLimit = await postJson(baseUrl, '/api/validate', {
      data: { schema_version: 'process-governance-v7', unexpected: Array(99995).fill(null) }
    });
    assert.equal(nodesAtLimit.response.status, 200, '100000 JSON object/field nodes must reach schema validation');
    const nodesOverLimit = await postJson(baseUrl, '/api/validate', {
      data: { schema_version: 'process-governance-v7', unexpected: Array(99996).fill(null) }
    });
    assert.equal(nodesOverLimit.response.status, 400);
    assert.equal(nodesOverLimit.body.code, 'JSON_NODE_LIMIT_EXCEEDED');
    const longTextValidation = await postJson(baseUrl, '/api/validate', {
      data: { schema_version: 'process-governance-v7', unexpected: 'x'.repeat(1024 * 1024 + 1) }
    });
    assert.equal(longTextValidation.response.status, 400);
    assert.equal(longTextValidation.body.code, 'JSON_TEXT_TOO_LONG');
    const utf8TextAtLimit = await postJson(baseUrl, '/api/validate', {
      data: { schema_version: 'process-governance-v7', unexpected: '中'.repeat(Math.floor((1024 * 1024) / 3)) }
    });
    assert.equal(utf8TextAtLimit.response.status, 200, 'UTF-8 text at or below one megabyte must reach schema validation');
    const utf8TextOverLimit = await postJson(baseUrl, '/api/validate', {
      data: { schema_version: 'process-governance-v7', unexpected: '中'.repeat(Math.floor((1024 * 1024) / 3) + 1) }
    });
    assert.equal(utf8TextOverLimit.response.status, 400);
    assert.equal(utf8TextOverLimit.body.code, 'JSON_TEXT_TOO_LONG');
    const invalidUnicodeValidation = await postJson(baseUrl, '/api/validate', {
      data: { schema_version: 'process-governance-v7', unexpected: '\uD800' }
    });
    assert.equal(invalidUnicodeValidation.response.status, 400);
    assert.equal(invalidUnicodeValidation.body.code, 'INVALID_UNICODE');

    const suggestionRoute = await fetch(`${baseUrl}/api/suggestions`, { method: 'POST' });
    assert.equal(suggestionRoute.status, 404);
    assert.equal((await suggestionRoute.json()).code, 'API_NOT_FOUND');
    const sessionReadRoute = await fetch(`${baseUrl}/api/session`);
    assert.equal(sessionReadRoute.status, 404);
    assert.equal((await sessionReadRoute.json()).code, 'STATELESS_ENDPOINT_DISABLED');
    const sessionWriteRoute = await fetch(`${baseUrl}/api/session`, { method: 'POST' });
    assert.equal(sessionWriteRoute.status, 404);
    assert.equal((await sessionWriteRoute.json()).code, 'STATELESS_ENDPOINT_DISABLED');
    const dataRoute = await fetch(`${baseUrl}/api/data`);
    assert.equal(dataRoute.status, 404);
    assert.equal((await dataRoute.json()).code, 'STATELESS_ENDPOINT_DISABLED');
    const exportRoute = await fetch(`${baseUrl}/api/export`);
    assert.equal(exportRoute.status, 404);
    assert.equal((await exportRoute.json()).code, 'STATELESS_ENDPOINT_DISABLED');

    const cytoscapeAsset = await fetch(`${baseUrl}/vendor/cytoscape.min.js`);
    assert.equal(cytoscapeAsset.status, 200);
    assert.match(cytoscapeAsset.headers.get('content-type') || '', /javascript/);
    assert.ok((await cytoscapeAsset.text()).length > 400000, 'local Cytoscape browser asset must be served');

    const diagramAsset = await fetch(`${baseUrl}/process-diagram.js`);
    assert.equal(diagramAsset.status, 200);
    assert.match(diagramAsset.headers.get('content-type') || '', /javascript/);

    const reviewPatternAsset = await fetch(`${baseUrl}/review-pattern-diagrams.js`);
    assert.equal(reviewPatternAsset.status, 200);
    assert.match(reviewPatternAsset.headers.get('content-type') || '', /javascript/);
    assert.match(await reviewPatternAsset.text(), /nested-parallel/);

    const scoreAsset = await fetch(`${baseUrl}/structure-score.js`);
    assert.equal(scoreAsset.status, 200);
    assert.match(scoreAsset.headers.get('content-type') || '', /javascript/);
    assert.match(await scoreAsset.text(), /structure-learning-score-v5/);

    const governanceWorkflowAsset = await fetch(`${baseUrl}/governance-workflow.js`);
    assert.equal(governanceWorkflowAsset.status, 200);
    assert.match(governanceWorkflowAsset.headers.get('content-type') || '', /javascript/);
    const governanceWorkflowSource = await governanceWorkflowAsset.text();
    assert.match(governanceWorkflowSource, /JSON基本信息/);

    const lifecycleAnalyzerAsset = await fetch(`${baseUrl}/lifecycle-analyzer.js`);
    assert.equal(lifecycleAnalyzerAsset.status, 200);
    assert.match(lifecycleAnalyzerAsset.headers.get('content-type') || '', /javascript/);
    assert.match(await lifecycleAnalyzerAsset.text(), /lifecycle-analysis-v1/);
    assert.match(governanceWorkflowSource, /sha256Fallback/);

    const legacyDiagnosticsAsset = await fetch(`${baseUrl}/legacy-cross-department-diagnostics.js`);
    assert.equal(legacyDiagnosticsAsset.status, 200);
    assert.match(legacyDiagnosticsAsset.headers.get('content-type') || '', /javascript/);
    assert.match(await legacyDiagnosticsAsset.text(), /flow_position_conflict/);
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
    ['流程控制\n不代表执行部门', '财务部'],
    'control nodes must use the control band and actions must keep their department lane'
  );
  assert.equal(model.backgrounds.filter(node => node.classes.includes('lane-header-node')).length, 2);
  const actionNode = model.nodes.find(node => node.classes.includes('node-action'));
  const decisionNode = model.nodes.find(node => node.classes.includes('node-decision'));
  const splitNode = model.nodes.find(node => node.classes.includes('node-parallel-split'));
  const joinNode = model.nodes.find(node => node.classes.includes('node-parallel-join'));
  assert.equal(actionNode.data.labelLineHeight, 22);
  assert.ok(actionNode.data.nodeWidth >= 268, 'larger preview text must retain horizontal padding');
  assert.match(actionNode.data.rawLabel, /岗位：会计员/);
  assert.doesNotMatch(actionNode.data.rawLabel, /仅用于文字沟通/);
  assert.match(decisionNode.data.rawLabel, /×.*判断材料/);
  assert.doesNotMatch(decisionNode.data.rawLabel, /岗位：法务/);
  assert.match(splitNode.data.rawLabel, /＋.*并行办理/);
  assert.doesNotMatch(joinNode.data.rawLabel, /历史未收录岗位/);
  assert.ok(model.nodes.some(node =>
    node.classes.includes('countersign-badge') && node.data.label === '会签×2'
  ));
  assert.ok(actionNode.position.x < decisionNode.position.x, 'explicit local relations must determine left-to-right rank');
  assert.ok(model.pool.width > 0 && model.pool.height > 0);
  assert.ok(!decisionNode.classes.includes('cross-department-behavior'));
  assert.ok(!decisionNode.classes.includes('external-node'));
  const internalCallNode = model.nodes.find(node => node.classes.includes('internal-call-node'));
  assert.ok(internalCallNode);
  assert.equal(internalCallNode.data.laneKey, decisionNode.data.laneKey, 'an internal call stays in the caller department lane');
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-sequence')));
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-condition') && /材料齐全/.test(edge.data.rawLabel)));
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-loop') && /材料不齐全/.test(edge.data.rawLabel)));
  assert.ok(model.edges.some(edge => edge.classes.includes('relation-parallel') && /全部分支完成后汇合/.test(edge.data.rawLabel)));
  assert.ok(model.edges.some(edge => edge.classes.includes('cross-lane-relation') && edge.data.focusKind === 'relation'));
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

  const linkedCrossDepartmentDraft = createDraft({
    behaviors: [
      makeBehavior('behavior_local_start', '提交工装申请', 'action', '财务部会计员'),
      makeBehavior('behavior_external_issue', '发放工装序列号', 'action', '经营发展部计划员')
    ],
    flow_relations: [{
      relation_ref: 'relation_cross_department',
      relation_type: 'sequence',
      from_behavior_ref: 'behavior_local_start',
      to_behavior_ref: 'behavior_external_issue',
      condition: '',
      join_mode: ''
    }],
    internal_process_calls: [],
  });
  const linkedBefore = JSON.stringify(linkedCrossDepartmentDraft);
  const linkedModel = buildGraphModel(linkedCrossDepartmentDraft, { departmentOrder });
  assert.equal(JSON.stringify(linkedCrossDepartmentDraft), linkedBefore, 'linked diagram generation must not mutate the draft');
  assert.equal(linkedModel.nodes.filter(node => node.classes.includes('behavior-node')).length, 2);
  assert.equal(linkedModel.nodes.filter(node => node.classes.includes('behavior-node')).length, 2);
  const linkedExternalNode = linkedModel.nodes.find(node => node.data.focusRef === 'behavior_external_issue');
  assert.ok(linkedExternalNode.classes.includes('cross-department-behavior'));
  assert.ok(linkedExternalNode.classes.includes('external-node'));
  assert.equal(linkedExternalNode.data.laneKey, '经营发展部');
  assert.ok(linkedModel.edges.some(edge =>
    edge.classes.includes('cross-lane-relation')
    && edge.data.focusKind === 'relation'
    && edge.data.focusRef === 'relation_cross_department'
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
  assert.ok(readabilityLoops.every(edge => edge.data.targetEndpoint === '50% 100%'));
  assert.ok(
    readabilityModel.layout.rankPositions[1] - readabilityModel.layout.rankPositions[0] >= 440,
    'adjacent diagram ranks must leave at least the minimum safe gap'
  );
  assert.equal(
    readabilityModel.layout.collisions.length,
    0,
    'the screenshot regression model must not contain node, label, or route-track collisions'
  );

  const manufacturingDraft = createDraft();
  manufacturingDraft.behaviors = [
      makeBehavior('b_compile', '编制人员编制产品制造大纲', 'action', ''),
      makeBehavior('b_proofread', '校对人员是否同意产品制造大纲', 'decision', ''),
      makeBehavior('b_review', '大纲审核人员是否同意产品制造大纲', 'decision', ''),
      makeBehavior('b_quality', '质量保证人员是否同意产品制造大纲', 'decision', ''),
      makeBehavior('b_decide_ndt', '产品制造大纲是否需要无损检测审批', 'decision', ''),
      makeBehavior('b_ndt', '无损检测审批人员是否同意产品制造大纲', 'decision', ''),
      makeBehavior('b_approve', '大纲批准人员是否批准产品制造大纲', 'decision', ''),
      makeBehavior('b_approval_recorded', '大纲批准人员形成产品制造大纲批准记录', 'action', '')
    ];
  manufacturingDraft.flow_relations = [
      { relation_ref: 'r01', relation_type: 'sequence', from_behavior_ref: 'b_compile', to_behavior_ref: 'b_proofread', condition: '', join_mode: '' },
      { relation_ref: 'r02', relation_type: 'condition', from_behavior_ref: 'b_proofread', to_behavior_ref: 'b_review', condition: '校对同意', join_mode: '' },
      { relation_ref: 'r03', relation_type: 'condition', from_behavior_ref: 'b_review', to_behavior_ref: 'b_quality', condition: '审核同意', join_mode: '' },
      { relation_ref: 'r04', relation_type: 'condition', from_behavior_ref: 'b_quality', to_behavior_ref: 'b_decide_ndt', condition: '质保同意', join_mode: '' },
      { relation_ref: 'r05', relation_type: 'condition', from_behavior_ref: 'b_decide_ndt', to_behavior_ref: 'b_ndt', condition: '需要无损检测', join_mode: '' },
      { relation_ref: 'r06', relation_type: 'condition', from_behavior_ref: 'b_decide_ndt', to_behavior_ref: 'b_approve', condition: '不需要无损检测', join_mode: '' },
      { relation_ref: 'r07', relation_type: 'condition', from_behavior_ref: 'b_ndt', to_behavior_ref: 'b_approve', condition: '无损检测同意', join_mode: '' },
      { relation_ref: 'r08', relation_type: 'loop', from_behavior_ref: 'b_proofread', to_behavior_ref: 'b_compile', condition: '校对不同意', join_mode: '' },
      { relation_ref: 'r09', relation_type: 'loop', from_behavior_ref: 'b_review', to_behavior_ref: 'b_compile', condition: '审核不同意', join_mode: '' },
      { relation_ref: 'r10', relation_type: 'loop', from_behavior_ref: 'b_quality', to_behavior_ref: 'b_compile', condition: '质保不同意', join_mode: '' },
      { relation_ref: 'r11', relation_type: 'loop', from_behavior_ref: 'b_ndt', to_behavior_ref: 'b_compile', condition: '无损检测不同意', join_mode: '' },
      { relation_ref: 'r12', relation_type: 'loop', from_behavior_ref: 'b_approve', to_behavior_ref: 'b_compile', condition: '批准不同意', join_mode: '' },
      { relation_ref: 'r13', relation_type: 'condition', from_behavior_ref: 'b_approve', to_behavior_ref: 'b_approval_recorded', condition: '批准同意', join_mode: '' }
    ];
  manufacturingDraft.internal_process_calls = [];
  const manufacturingModel = buildGraphModel(manufacturingDraft, { departmentOrder });
  const noNdtBranch = manufacturingModel.edges.find(edge => edge.data.focusRef === 'r06');
  const approveNode = manufacturingModel.nodes.find(node => node.data.focusRef === 'b_approve');
  assert.equal(noNdtBranch.data.semanticTarget, approveNode.data.id);
  const approveBundle = manufacturingModel.layout.bundles.find(bundle => bundle.targetRef === 'b_approve');
  assert.ok(approveBundle, 'same-target approval relations must have one visual incoming bundle');
  assert.equal(noNdtBranch.data.target, approveBundle.junctionId);
  assert.ok(noNdtBranch.classes.includes('route-forward-branch'));
  assert.equal(noNdtBranch.data.routePlacement, 'upper');
  const manufacturingLoops = manufacturingModel.edges.filter(edge => edge.classes.includes('relation-loop'));
  assert.equal(manufacturingLoops.length, 5);
  assert.ok(manufacturingLoops.every(edge => edge.data.targetEndpoint === '50% 100%'));
  assert.equal(new Set(manufacturingLoops.map(edge => edge.data.routeTrackKey)).size, 5);
  assert.equal(new Set(manufacturingLoops.map(edge => edge.data.routeOffset)).size, 5);
  const compileBundle = manufacturingModel.layout.bundles.find(bundle => bundle.targetRef === 'b_compile');
  assert.deepEqual(compileBundle.relationRefs, ['r08', 'r09', 'r10', 'r11', 'r12']);
  assert.ok(manufacturingLoops.every(edge => edge.data.target === compileBundle.junctionId));
  assert.equal(
    manufacturingModel.edges.filter(edge => edge.classes.includes('relation-bundle-trunk')).length,
    2,
    'compile returns and approval inputs must each share one final incoming arrow'
  );
  assert.ok(
    manufacturingModel.layout.routeSegments.every(segment => [0, 45, 90].includes(segment.angle)),
    'visible process relation segments must use only 0, 45, or 90 degree angles'
  );
  assert.ok(manufacturingDraft.flow_relations.filter(relation => relation.relation_type === 'condition').every(relation =>
    manufacturingDraft.behaviors.find(behavior => behavior.behavior_ref === relation.from_behavior_ref)?.node_type === 'decision'
  ));

  const cycleDraft = JSON.parse(JSON.stringify(readabilityDraft));
  cycleDraft.flow_relations[2].relation_type = 'condition';
  cycleDraft.flow_relations[3].relation_type = 'condition';
  const cycleBefore = JSON.stringify(cycleDraft);
  const cycleModel = buildGraphModel(cycleDraft, { departmentOrder });
  assert.equal(JSON.stringify(cycleDraft), cycleBefore, 'cycle review must not rewrite relation types or source JSON');
  assert.equal(cycleModel.reviewCount, 4);
  assert.ok(cycleModel.reviewItems.every(item =>
    item.focusKind === 'behavior'
      && cycleDraft.flow_relations.some(relation => relation.relation_ref === item.relationRef && relation.to_behavior_ref === item.focusRef)
      && item.message.includes('该关系与其他非回路关系形成闭环')
      && item.message.includes('点击后定位到终点')
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
  assert.equal(complexModel.lanes.length, 7, 'department swimlanes plus the control band must be retained');
  assert.equal(complexModel.unresolvedCount, 0);
  assert.ok(complexModel.edges.some(edge => edge.classes.includes('relation-loop')));
  assert.ok(complexModel.edges.some(edge => edge.classes.includes('cross-lane-relation')));
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

function testReviewPatternDiagrams() {
  const patterns = ReviewPatternDiagrams.definitions();
  assert.equal(patterns.length, 11);
  assert.equal(new Set(patterns.map(pattern => pattern.id)).size, 11);
  assert.deepEqual(
    patterns.map(pattern => pattern.id),
    [
      'sequence',
      'decision-merge',
      'single-loop',
      'countersign-parallel-end',
      'parallel-decision',
      'parallel-loop',
      'nested-loops',
      'nested-parallel',
      'forbidden-parallel-termination',
      'one-to-many-comparison',
      'many-to-one-comparison'
    ]
  );

  const patternSnapshot = JSON.stringify(patterns);
  const patternModels = new Map();
  let straightParallelEdgeCount = 0;
  let orthogonalParallelEdgeCount = 0;
  patterns.forEach(pattern => {
    const documentData = ReviewPatternDiagrams.buildDocument(pattern);
    const documentSnapshot = JSON.stringify(documentData);
    const model = buildGraphModel(documentData, {
      departmentOrder: [ReviewPatternDiagrams.EXAMPLE_DEPARTMENT]
    });
    patternModels.set(pattern.id, model);
    assert.equal(model.namedBehaviorCount, pattern.nodes.length, `${pattern.id} must draw every example node`);
    assert.equal(model.localEdgeCount, pattern.relations.length, `${pattern.id} must draw every example relation`);
    assert.equal(model.unresolvedItems.length, 0, `${pattern.id} must not contain unresolved drawing inputs`);
    assert.deepEqual(
      model.layout.collisions,
      [],
      `${pattern.id} must keep nodes and route labels on separate visual tracks`
    );
    const parallelEdges = model.edges.filter(edge => edge.classes.includes('relation-parallel'));
    parallelEdges.forEach(edge => {
      assert.match(
        edge.classes,
        /parallel-(?:straight|orthogonal)-edge/,
        `${pattern.id} parallel routes must declare straight or orthogonal rendering`
      );
      if (edge.data.routePlacement === 'direct') {
        assert.ok(edge.classes.includes('parallel-straight-edge'));
        straightParallelEdgeCount += 1;
      } else {
        assert.ok(edge.classes.includes('parallel-orthogonal-edge'));
        orthogonalParallelEdgeCount += 1;
      }
    });
    assert.equal(JSON.stringify(documentData), documentSnapshot, `${pattern.id} drawing must not modify the example document`);
  });
  assert.ok(straightParallelEdgeCount > 0, 'adjacent parallel branches must prefer straight lines');
  assert.ok(orthogonalParallelEdgeCount > 0, 'cross-rank parallel branches must retain orthogonal routing');
  assert.equal(JSON.stringify(patterns), patternSnapshot, 'building review pattern documents must not modify definitions');
  assert.equal(JSON.stringify(ReviewPatternDiagrams.definitions()), patternSnapshot, 'each definition read must remain deterministic');

  const countersign = patterns.find(pattern => pattern.id === 'countersign-parallel-end');
  assert.equal(countersign.nodes.filter(node => node.countersign).length, 1);
  const decisionRoutes = patternModels.get('decision-merge').edges.filter(edge =>
    edge.classes.includes('relation-condition')
  );
  assert.ok(decisionRoutes.length >= 2);
  assert.ok(decisionRoutes.every(edge => edge.classes.includes('route-forward-branch')));
  assert.deepEqual(
    new Set(decisionRoutes.map(edge => edge.data.routePlacement)),
    new Set(['upper', 'lower']),
    'decision outcomes must leave on separate upper and lower tracks'
  );
  assert.deepEqual(
    new Set(decisionRoutes.map(edge => edge.data.taxiDirection)),
    new Set(['upward', 'downward'])
  );
  const parallelDecisionRelations = patternModels.get('parallel-decision').edges.filter(edge =>
    edge.data.focusKind === 'relation'
  );
  const lowerDecisionBranch = parallelDecisionRelations.find(edge =>
    edge.data.focusRef === 'review-parallel-decision-r4'
  );
  const outerParallelBypass = parallelDecisionRelations.find(edge =>
    edge.data.focusRef === 'review-parallel-decision-r7'
  );
  assert.ok(lowerDecisionBranch.classes.includes('route-forward-branch'));
  assert.equal(lowerDecisionBranch.data.taxiDirection, 'downward');
  assert.ok(outerParallelBypass.classes.includes('parallel-orthogonal-edge'));
  assert.ok(outerParallelBypass.classes.includes('route-lower'));
  assert.equal(outerParallelBypass.data.taxiDirection, 'downward');
  assert.ok(
    outerParallelBypass.data.routeOffset > lowerDecisionBranch.data.routeOffset,
    'the outer parallel bypass must use a lower track than the nested decision branch'
  );
  const nestedLoops = patterns.find(pattern => pattern.id === 'nested-loops');
  assert.equal(nestedLoops.relations.filter(item => item.type === 'loop').length, 2);
  const nestedParallel = patterns.find(pattern => pattern.id === 'nested-parallel');
  assert.equal(nestedParallel.nodes.filter(node => node.type === 'parallel_split').length, 2);
  assert.equal(nestedParallel.nodes.filter(node => node.type === 'parallel_join').length, 2);
  const forbidden = patterns.find(pattern => pattern.id === 'forbidden-parallel-termination');
  assert.equal(forbidden.relations.some(item => item.from === 'terminate'), false);
}

async function testFrontendContract() {
  const html = fs.readFileSync(frontendPath, 'utf8');
  const diagramSource = fs.readFileSync(processDiagramPath, 'utf8');
  const structureScoreSource = fs.readFileSync(structureScorePath, 'utf8');
  const governanceWorkflowSource = fs.readFileSync(governanceWorkflowPath, 'utf8');
  const webGridCoreSource = fs.readFileSync(webGridCorePath, 'utf8');
  const nativeWebGridSource = fs.readFileSync(nativeWebGridPath, 'utf8');
  const processV7GridAdapterSource = fs.readFileSync(processV7GridAdapterPath, 'utf8');
  const editSessionManagerSource = fs.readFileSync(editSessionManagerPath, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const serverSource = fs.readFileSync(serverPath, 'utf8');

  assert.ok(html.includes("const EXPECTED_EXPORT_SCHEMA_VERSION = 'process-governance-v7'"));
  assert.ok(html.includes('const MAX_IMPORT_BYTES = 10 * 1024 * 1024;'));
  assert.ok(html.includes('if (file.size > MAX_IMPORT_BYTES)'));
  assert.ok(html.includes("new TextDecoder('utf-8', { fatal: true })"));
  assert.ok(html.includes("fetch('/api/template?version=process-governance-v7', { cache: 'no-store' })"));
  assert.equal(html.includes('needsCandidateFieldUpgrade ? { valid: true, errors: [] }'), false);
  assert.ok(html.includes("validationProfile: 'early-v7-data-fields'"));
  assert.ok(html.includes('<script src="import-compatibility.js"></script>'));
  assert.ok(html.includes('const revisions = Array.isArray(item.schema_revisions) ? item.schema_revisions : [];'));
  assert.ok(html.includes('currentRevision.source_commit'));
  assert.ok(html.includes('当前结构短码：'));
  assert.ok(html.includes('早期v7可兼容导入：'));
  assert.ok(html.includes('结构兼容和软件发布只说明文件可由3001处理，不代表流程事实正确、部门已经确认或业务审核通过。'));
  const importJsonSource = html.slice(
    html.indexOf('async function importJson(file)'),
    html.indexOf("jsonInput.addEventListener('change'")
  );
  const sourceValidationPosition = importJsonSource.indexOf('const sourceValidation = await validateGraphDocument');
  const sourceClassificationPosition = importJsonSource.indexOf('classifyPostMigrationValidation(sourceValidation)');
  const targetValidationPosition = importJsonSource.indexOf('const targetValidations = await Promise.all');
  const targetClassificationPosition = importJsonSource.indexOf('classifyPostMigrationBatch(targetValidations)');
  const candidateReplacementPosition = importJsonSource.indexOf('candidates = nextCandidates');
  assert.ok(sourceValidationPosition >= 0 && targetValidationPosition > sourceValidationPosition);
  assert.ok(sourceClassificationPosition > sourceValidationPosition);
  assert.ok(targetClassificationPosition > targetValidationPosition);
  assert.ok(
    candidateReplacementPosition > targetValidationPosition,
    'source and migrated candidates must both pass validation before the current draft is replaced'
  );
  assert.ok(importJsonSource.includes('当前草稿、图状态和撤销记录保持不变。'));
  const exportCurrentSource = html.slice(
    html.indexOf('async function exportCurrent(options = {})'),
    html.indexOf('function protect(action)')
  );
  assert.equal(
    exportCurrentSource.includes('ImportCompatibility'),
    false,
    'download validation must remain strict and must not use the import-only compatibility classifier'
  );
  assert.ok(html.includes("const behaviors = (currentDocument()?.behaviors || []).filter(item => item.node_type === 'action');"));
  assert.ok(html.includes('<script src="process-governance-migration.js"></script>'));
  assert.ok(html.includes('<script src="governance-workflow.js"></script>'));
  assert.ok(html.includes('<script src="legacy-cross-department-diagnostics.js"></script>'));
  assert.equal(html.includes('/vendor/tabulator'), false);
  assert.ok(html.includes('<script src="web-grid-core.js"></script>'));
  assert.ok(html.includes('<script src="native-web-grid.js"></script>'));
  assert.ok(html.includes('<script src="process-v7-grid-adapter.js"></script>'));
  assert.equal(html.includes('bulk-data-editor.js'), false);
  assert.ok(html.includes('<script src="graph-edit-commands.js"></script>'));
  assert.ok(html.includes('<script src="graph-editor-state.js"></script>'));
  assert.ok(html.includes('<script src="edit-session-manager.js"></script>'));
  assert.ok(html.includes('<script src="form-field-reuse.js"></script>'));
  assert.ok(html.includes('<script src="authoring-selection-context.js"></script>'));
  assert.ok(html.includes('<script src="governance-review-queue.js"></script>'));
  const inlineScriptPosition = html.indexOf('<script>');
  [
    'edit-session-manager.js',
    'form-field-reuse.js',
    'authoring-selection-context.js',
    'governance-review-queue.js'
  ].forEach(scriptName => assert.ok(
    html.indexOf(`<script src="${scriptName}"></script>`) < inlineScriptPosition,
    `${scriptName} must load before the page controller`
  ));
  [
    'gridModeSwitchModal',
    'continueGridEditingButton',
    'discardGridChangesButton',
    'applyGridChangesButton',
    'webGridPendingMode',
    'webGridPendingAction',
    'openGridModeSwitchModal',
    'closeGridModeSwitchModal'
  ].forEach(legacyName => assert.equal(html.includes(legacyName), false, `legacy edit modal residue: ${legacyName}`));
  [
    'scripts/test-edit-session-manager.js',
    'scripts/test-form-field-reuse.js',
    'scripts/test-authoring-selection-context.js',
    'scripts/test-governance-review-queue.js'
  ].forEach(testScript => assert.ok(packageJson.scripts.test.includes(testScript), `${testScript} must be in npm test`));
  assert.ok(html.includes('<script src="data-relation-diagram.js"></script>'));
  assert.ok(html.includes('<script src="lifecycle-analyzer.js"></script>'));
  assert.ok(html.includes('data-action="switch-data-mode"'));
  assert.ok(html.includes('主数据认定提示'));
  assert.ok(html.includes('重新分析当前对象'));
  assert.ok(html.includes('本流程会不会改变这条数据的状态或保管方式？'));
  assert.ok(html.includes('业务上还能用吗？'));
  assert.ok(html.includes('现在怎么保管？'));
  assert.ok(html.includes('本流程会进行匿名处理吗？'));
  assert.ok(html.includes('进行匿名处理后，还能认出原来对应的人或对象吗？'));
  assert.ok(html.includes("const showLifecycleDetails = lifecycle.applicability === 'applicable' || advancedLifecycleMode"));
  assert.ok(html.includes('选择“会改变”后，页面再显示业务使用状态、保管方式和确实适用的匿名处理问题。'));
  assert.ok(html.includes('data-action="toggle-advanced-lifecycle"'));
  assert.ok(html.includes('高级结构核对仅在当前页面临时开启'));
  assert.equal(/localStorage|sessionStorage/.test(html), false, 'the temporary advanced mode must not use browser storage');
  assert.ok(html.includes('数据对象与对象字段引用摘要（只读）'));
  assert.ok(html.includes('把对象字段批量引用到当前表单'));
  assert.ok(html.includes('批量引用对象字段'));
  assert.ok(html.includes('1. 选择对象字段'));
  assert.ok(html.includes('选择目标并确认必填性'));
  assert.ok(html.includes('添加空白字段（待补引用）'));
  assert.ok(!html.includes('点击“添加字段”后'));
  assert.ok(html.includes('表单显示名称'));
  assert.ok(html.includes('function formFieldReferenceDefaults'));
  assert.ok(html.includes("tableId === 'form_items' && column === 'data_field_ref'"));
  assert.equal(html.includes('>新增行</button>'), false, 'grid actions must name the record being added');
  assert.equal(html.includes('function addFormItemFromDataField('), false, 'single-field direct commit must be removed');
  const batchReferenceSource = html.slice(
    html.indexOf('async function applyFormFieldBatch('),
    html.indexOf('function ensureActiveCollectionItem(')
  );
  assert.ok(batchReferenceSource.includes('planBatchReference'));
  assert.ok(batchReferenceSource.includes('validateGraphDocument'));
  assert.ok(batchReferenceSource.includes('sourceFingerprint'));
  assert.ok(batchReferenceSource.includes('graphStateManager.execute'));
  const addGridRowSource = html.slice(
    html.indexOf('function addGridRow('),
    html.indexOf('function openGuidedUpdateFields(')
  );
  assert.ok(addGridRowSource.includes('requestAnimationFrame'));
  assert.ok(addGridRowSource.includes("webGridFilters[tableId] = ''"));
  assert.ok(addGridRowSource.includes("querySelectorAll('[data-grid-cell]:not(:disabled)')"));
  assert.ok(addGridRowSource.includes('controls.find(candidate => !text(candidate.value)) || controls[0]'));
  assert.equal(html.includes('沿用当前对象字段已经建立的值，无需在本表单重复登记取值来源。'), false);
  assert.ok(html.includes('当前字段值使用方式已明确为“沿用已有值”；系统未据此自动生成取值来源。'));
  const formStartSource = html.slice(
    html.indexOf("if (action === 'choose-form-start')"),
    html.indexOf("if (action === 'select-skeleton-item')")
  );
  assert.ok(formStartSource.includes('addDataObject()'));
  assert.equal(formStartSource.includes("addForm('current_state')"), false);
  assert.ok(structureScoreSource.includes('数据生命周期与异常处理'));
  assert.ok(structureScoreSource.includes('structure-learning-score-v5'));
  assert.ok(structureScoreSource.includes('advancedLifecycleChecklist'));
  assert.ok(html.includes('aria-label="数据关系图图例"'));
  assert.ok(html.includes('<small>业务行为 → 数据对象</small>'));
  assert.ok(html.includes('<small>业务行为 ↔ 数据对象</small>'));
  assert.ok(html.includes('<small>数据对象 → 业务行为</small>'));
  assert.ok(html.includes('<small>操作和方向尚未确认</small>'));
  assert.ok(html.includes('${optionHtml(RELATION_TYPES, flowRelationDraft.relation_type)}'));
  assert.equal(html.includes('RELATION_TYPES.filter(item => item.value), flowRelationDraft.relation_type'), false);
  assert.equal(html.includes('function testFrontendContractLegacy'), false);
  assert.equal(html.includes('function refreshRoleName'), false);
  assert.equal(html.includes('data-action="open-legacy-merge"'), false);
  assert.equal(html.includes('data-action="add-handoff"'), false);
  assert.equal(html.includes('data-action="remove-handoff"'), false);
  assert.equal(html.includes('aria-label="跨部门待办只读汇总"'), false);
  assert.equal(html.includes('归并为单一跨部门行为'), false);
  assert.ok(html.includes('当前为跨部门行为'));
  assert.ok(html.includes('流程先后请在“流程关系”中维护'));
  ['JSON基本信息', '流程边界', '流程骨架', '动作与异常', '数据与表单', '跨部门核对', '评审与交接']
    .forEach(label => assert.ok(governanceWorkflowSource.includes(label), `missing governance step: ${label}`));
  assert.ok(html.includes('data-action="switch-governance-step"'));
  assert.ok(html.includes('data-action="open-governance-drawer"'));
  assert.ok(html.includes('data-action="download-current-stage"'));
  assert.ok(html.includes('源文件SHA-256'));
  assert.ok(html.includes('data-action="check-governance-step"'));
  assert.ok(governanceWorkflowSource.includes('本轮自检项'));
  assert.ok(governanceWorkflowSource.includes('业务核对项'));
  assert.ok(governanceWorkflowSource.includes('交接检查事项'));
  assert.ok(html.includes('业务式编辑'));
  assert.ok(html.includes('表格编辑'));
  assert.ok(html.includes('网页表格编辑器'));
  assert.ok(html.includes('data-action="apply-web-grid"'));
  assert.ok(html.includes('data-action="discard-web-grid"'));
  assert.ok(html.includes('应用修改并继续'));
  assert.ok(html.includes('放弃修改并继续'));
  assert.ok(html.includes('继续编辑'));
  assert.ok(html.includes('有未应用修改'));
  assert.ok(html.includes('有未下载修改'));
  assert.ok(html.includes('当前内容与导入文件一致'));
  assert.ok(html.includes('尚未下载'));
  assert.ok(html.includes('function candidateFileState'));
  assert.ok(html.includes('if (entry.lastDownload)'));
  assert.ok(html.includes('返回数据流编辑对象信息'));
  assert.equal(html.includes('列入交接待定事项'), false);
  assert.ok(html.includes('function requestTransition'));
  assert.ok(html.includes('function requestConfirmedDeletion'));
  assert.ok(editSessionManagerSource.includes('FIELD_CONFLICT'));
  assert.equal(html.includes('Excel / WPS批量编辑'), false);
  assert.equal(html.includes('data-action="preview-bulk-data"'), false);
  assert.equal(html.includes('data-action="apply-bulk-data"'), false);
  assert.ok(webGridCoreSource.includes('@typedef {Object} GridTableDefinition'));
  assert.ok(webGridCoreSource.includes('@typedef {Object} GridIssue'));
  assert.ok(webGridCoreSource.includes('@typedef {Object} GridCommitDriver'));
  assert.ok(nativeWebGridSource.includes('event?.isComposing'));
  assert.ok(nativeWebGridSource.includes('event?.keyCode === 229'));
  assert.ok(html.includes('workspace.addEventListener(\'compositionstart\''));
  assert.ok(html.includes('workspace.addEventListener(\'compositionend\''));
  assert.ok(html.includes('data-grid-cell'));
  assert.equal(html.includes('new Tabulator'), false);
  [
    'data_objects', 'data_fields', 'data_behavior_links', 'data_source_relations',
    'forms', 'form_behavior_links', 'form_areas', 'form_items', 'field_source_links'
  ].forEach(tableId => assert.ok(processV7GridAdapterSource.includes(`id: '${tableId}'`), `missing grid table: ${tableId}`));
  assert.ok(html.includes('aria-label="当前数据对象的字段列表"'));
  assert.equal(html.includes('class="form-field-table data-object-field-table"'), false);
  assert.ok(html.includes('function applyNativeGridPaste'));
  assert.ok(html.includes('function selectNativeGridRow'));
  assert.ok(html.includes('id="updateFieldsModal"'));
  assert.ok(html.includes('data-action="open-update-fields"'));
  assert.ok(html.includes('data-action="open-grid-update-fields"'));
  assert.ok(html.includes('data-action="open-graph-update-fields"'));
  assert.ok(html.includes('请至少选择一个本次实际更新的字段'));
  assert.ok(processV7GridAdapterSource.includes("editor: 'update-fields'"));
  assert.ok(nativeWebGridSource.includes('更新字段必须使用弹窗多选'));
  assert.equal(html.includes("table.on('rowClick'"), false);
  assert.ok(html.includes('function governanceIssuesForStep'));
  assert.ok(html.includes('data-action="focus-export-warning"'));
  const diagramLegendSource = html.slice(
    html.indexOf('function renderDiagramLegend()'),
    html.indexOf('function renderDiagramWarnings(')
  );
  const reviewReadinessSource = html.slice(
    html.indexOf('function renderReviewReadinessPanel('),
    html.indexOf('function renderExportCheck(')
  );
  assert.ok(diagramLegendSource.includes('${renderNodeCombinationGuide()}'));
  assert.equal(reviewReadinessSource.includes('${renderNodeCombinationGuide()}'), false);
  assert.ok(html.includes('<summary>节点组合、循环退出与嵌套并行图例</summary>'));
  assert.ok(html.includes(".node-combination-guide[open] > summary::after { content: '收起'; }"));
  assert.ok(html.includes("!document.querySelector('.node-combination-guide[open]')"));
  assert.ok(html.includes("workspace.addEventListener('toggle'"));
  assert.equal(html.includes('当前文件与导入结果'), false);
  assert.equal(html.includes('<strong>迁移结果</strong>'), false);
  assert.equal(html.includes('历史结构化文件已无损迁移到v6'), false);
  assert.ok(html.includes('结构化文件已导入当前页面'));
  assert.ok(html.includes("const TOOL_HELP_STEPS = ["));
  assert.ok(html.includes("const TOOL_TERM_GROUPS = ["));
  [
    '无状态临时工具',
    '单流程结构化文件规则',
    '阶段草稿',
    '文件交接摘要',
    '流程骨架',
    'A1业务行为',
    '流程内部回路',
    '并行汇合',
    '待治理数据对象',
    '数据行为关系',
    '字段业务数据归属',
    '字段取值来源',
    '技术标识与稳定引用',
    '结构错误',
    '业务提示',
    '3000停止边界'
  ].forEach(term => assert.ok(html.includes(`['${term}',`), `missing tool help term: ${term}`));
  assert.ok(html.includes('使用前必读'));
  assert.ok(html.includes('按七步完成编制'));
  assert.ok(html.includes('常用操作与异常处理'));
  assert.ok(html.includes('本工具术语'));
  assert.ok(html.includes('删除不级联'));
  assert.ok(html.includes('未审核-${department}-${processName}-${stageLabel}-${exportTimestamp(now)}.json'));
  assert.equal(html.includes('id="newProcessButton"'), false);
  assert.equal(html.includes('id="exportButton"'), false);
  assert.ok(html.includes('aria-label="术语定义列表"'));
  assert.ok(html.includes('data-drag-handle="${escapeAttribute(kind)}"'));
  assert.ok(html.includes("behavior: { collectionKey: 'behaviors', refKey: 'behavior_ref'"));
  assert.ok(html.includes("relation: { collectionKey: 'flow_relations', refKey: 'relation_ref'"));
  assert.ok(html.includes("data: { collectionKey: 'data_objects', refKey: 'data_ref'"));
  assert.ok(html.includes("term: { collectionKey: 'terms', refKey: 'term_ref'"));
  assert.ok(html.includes("event.pointerType || 'pointer'"));
  assert.ok(html.includes("event.key === 'ArrowDown' || event.key === 'ArrowRight'"));
  assert.ok(html.includes("event.key === 'Escape'"));
  assert.ok(html.includes("selector.scrollBy({ top: -24, behavior: 'auto' })"));
  assert.ok(html.includes("selector.scrollBy({ top: 24, behavior: 'auto' })"));
  assert.ok(diagramSource.includes('cross-lane-relation'));
  assert.equal(diagramSource.includes('handoff-node'), false);
  assert.equal(structureScoreSource.includes('cross_department_handoffs'), false);
  assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie|\/api\/session/.test(html), false);
  assert.match(serverSource, /const HOST = process\.env\.STRUCTURED_OUTPUT_HOST \|\| '0\.0\.0\.0';/);
  assert.equal(
    (html.match(/function ensureActiveDataObject\(\)/g) || []).length,
    1,
    'the text editor data selector must not be shadowed by the graph data selector'
  );
  assert.equal(
    (html.match(/function ensureActiveGraphDataObject\(\)/g) || []).length,
    1,
    'the data graph must use its own active-data selector'
  );

  const behaviorDataSummarySource = html.slice(
    html.indexOf('    function behaviorDataSummary(behaviorRef, flowDetails = currentDataFlowDetails()) {'),
    html.indexOf('    function renderBehaviorDerivedSummary(', html.indexOf('    function behaviorDataSummary(behaviorRef, flowDetails = currentDataFlowDetails()) {'))
  );
  const behaviorDataSummaryDocument = {
    schema_version: 'process-governance-v7',
    behaviors: [
      { behavior_ref: 'behavior-create', actor_assignment_mode: 'fixed_department' },
      { behavior_ref: 'behavior-use', actor_assignment_mode: 'fixed_department' }
    ],
    flow_relations: [{
      relation_ref: 'relation-data-summary',
      relation_type: 'sequence',
      from_behavior_ref: 'behavior-create',
      to_behavior_ref: 'behavior-use',
      condition: ''
    }],
    data_objects: [{
      data_ref: 'data-summary',
      data_name: '测试数据对象',
      behavior_links: [
        { link_ref: 'data-link-create', behavior_ref: 'behavior-create', operation: 'create' },
        { link_ref: 'data-link-use', behavior_ref: 'behavior-use', operation: 'use' }
      ],
      source_relations: []
    }],
    forms: []
  };
  const behaviorDataSummaryContext = {
    currentDocument: () => behaviorDataSummaryDocument,
    currentDataFlowDetails: () => StructureScore.dataFlowConsistencyDetails(behaviorDataSummaryDocument),
    text: value => value == null ? '' : String(value),
    isDynamicActorBehavior: () => false,
    FORM_OPERATIONS: []
  };
  vm.runInNewContext(
    `${behaviorDataSummarySource}\nthis.behaviorDataSummaryForTest = behaviorDataSummary;`,
    behaviorDataSummaryContext
  );
  assert.deepEqual(
    Array.from(behaviorDataSummaryContext.behaviorDataSummaryForTest('behavior-use').inputs),
    ['测试数据对象'],
    'the process-step summary must resolve data objects linked with operation=use'
  );

  const behaviorOptionsSource = html.slice(
    html.indexOf('    function behaviorOptions(includeEmpty = false) {'),
    html.indexOf('    function dataOptions(', html.indexOf('    function behaviorOptions(includeEmpty = false) {'))
  );
  const optionDocument = {
    process: { owning_department: '财务部' },
    behaviors: [
      { behavior_ref: 'behavior-local', behavior_name: '登记申请', actor_assignment_mode: 'fixed_department', current_actor_role: '财务部会计员' },
      { behavior_ref: 'behavior-cross', behavior_name: '复核资料', actor_assignment_mode: 'fixed_department', current_actor_role: '质量管理部审核员' },
      { behavior_ref: 'behavior-company', behavior_name: '全员知悉', actor_assignment_mode: 'company_wide', current_actor_role: '全公司' },
      { behavior_ref: 'behavior-dynamic', behavior_name: '落实整改', actor_assignment_mode: 'dynamic_from_data', current_actor_role: '' }
    ]
  };
  const behaviorOptionsContext = {
    currentDocument: () => optionDocument,
    currentExecutionDepartment: () => optionDocument.process.owning_department,
    actorAssignmentMode: behavior => behavior.actor_assignment_mode,
    parseActorRole: value => ({
      department: ['财务部', '质量管理部'].find(department => String(value || '').startsWith(department)) || ''
    })
  };
  vm.runInNewContext(`${behaviorOptionsSource}\nthis.behaviorOptionsForTest = behaviorOptions;`, behaviorOptionsContext);
  const behaviorOptions = Array.from(behaviorOptionsContext.behaviorOptionsForTest(), item => ({ ...item }));
  assert.deepEqual(behaviorOptions.map(item => item.value), [
    'behavior-local', 'behavior-cross', 'behavior-company', 'behavior-dynamic'
  ]);
  assert.equal(behaviorOptions[1].label, '2. 质量管理部（跨部门） · 复核资料');
  assert.equal(behaviorOptions[2].label, '3. 全公司通用 · 全员知悉');
  assert.equal(behaviorOptions[3].label, '4. 运行时责任部门 · 落实整改');

  const sortSource = html.slice(
    html.indexOf('    function sortableCollection(kind) {'),
    html.indexOf('    function relationTypeLabel(', html.indexOf('    function sortableCollection(kind) {'))
  );
  const sortDocument = {
    behaviors: [{ behavior_ref: 'b1' }, { behavior_ref: 'b2' }, { behavior_ref: 'b3' }],
    flow_relations: [{ relation_ref: 'r1', from_behavior_ref: 'b1', to_behavior_ref: 'b2' }, { relation_ref: 'r2', from_behavior_ref: 'b2', to_behavior_ref: 'b3' }],
    data_objects: [{ data_ref: 'd1', behavior_links: [{ link_ref: 'dl1', behavior_ref: 'b2', operation: 'use' }] }, { data_ref: 'd2', behavior_links: [] }],
    terms: [{ term_ref: 't1', term_name: '甲' }, { term_ref: 't2', term_name: '乙' }]
  };
  const rowByKey = new Map();
  const selector = { getBoundingClientRect: () => ({ top: 0, bottom: 300, height: 300 }), scrollBy: () => {} };
  const classList = { add: () => {}, remove: () => {} };
  const makeHandle = (kind, ref) => {
    const row = { dataset: { sortKind: kind }, classList, closest: () => selector, getBoundingClientRect: () => ({ top: 0, height: 30 }) };
    const handle = { dataset: { dragHandle: kind, ref }, closest: () => row, setAttribute: () => {}, focus: () => {}, setPointerCapture: () => {} };
    rowByKey.set(`${kind}:${ref}`, { row, handle });
    return handle;
  };
  ['b1', 'b2', 'b3'].forEach(ref => makeHandle('behavior', ref));
  ['r1', 'r2'].forEach(ref => makeHandle('relation', ref));
  ['d1', 'd2'].forEach(ref => makeHandle('data', ref));
  ['t1', 't2'].forEach(ref => makeHandle('term', ref));
  let touchCount = 0;
  const sortContext = {
    text: value => value == null ? '' : String(value),
    currentDocument: () => sortDocument,
    activeBehaviorRef: '', activeRelationRef: '', activeDataRef: '', activeTermRef: '',
    workspace: {
      querySelectorAll(query) {
        const match = query.match(/data-sort-kind="([^"]+)"/);
        if (!match) return [];
        return [...rowByKey.entries()].filter(([key]) => key.startsWith(`${match[1]}:`)).map(([, value]) => value.row);
      },
      querySelector: () => null
    },
    CSS: { escape: value => String(value) },
    showStatus: () => {},
    touch: () => { touchCount += 1; },
    render: () => {},
    requestAnimationFrame: callback => callback()
  };
  vm.runInNewContext(`let sortableDragState = null;\n${sortSource}\nthis.beginForTest = beginSortableDrag; this.moveForTest = moveSortableTarget; this.finishForTest = finishSortableDrag;`, sortContext);
  const relationSnapshot = JSON.stringify(sortDocument.flow_relations);
  sortContext.beginForTest(rowByKey.get('behavior:b3').handle, 'touch', 11);
  sortContext.moveForTest(0);
  sortContext.finishForTest(true);
  assert.deepEqual(sortDocument.behaviors.map(item => item.behavior_ref), ['b3', 'b1', 'b2']);
  assert.equal(sortContext.activeBehaviorRef, 'b3');
  assert.equal(JSON.stringify(sortDocument.flow_relations), relationSnapshot, 'behavior reorder must not change explicit relations');
  assert.equal(sortDocument.data_objects[0].behavior_links[0].behavior_ref, 'b2');
  assert.equal(touchCount, 1);

  sortContext.beginForTest(rowByKey.get('relation:r2').handle, 'mouse', 12);
  sortContext.moveForTest(0);
  sortContext.finishForTest(true);
  assert.deepEqual(sortDocument.flow_relations.map(item => item.relation_ref), ['r2', 'r1']);
  assert.equal(sortDocument.flow_relations[0].from_behavior_ref, 'b2');
  assert.equal(sortDocument.flow_relations[0].to_behavior_ref, 'b3');
  assert.equal(sortContext.activeRelationRef, 'r2');

  sortContext.beginForTest(rowByKey.get('data:d2').handle, 'touch', 13);
  sortContext.moveForTest(0);
  sortContext.finishForTest(true);
  assert.deepEqual(sortDocument.data_objects.map(item => item.data_ref), ['d2', 'd1']);
  assert.equal(sortDocument.data_objects[1].behavior_links[0].behavior_ref, 'b2');
  assert.equal(sortContext.activeDataRef, 'd2');

  sortContext.beginForTest(rowByKey.get('term:t2').handle, 'keyboard');
  sortContext.moveForTest(0);
  sortContext.finishForTest(true);
  assert.deepEqual(sortDocument.terms.map(item => item.term_ref), ['t2', 't1']);
  assert.equal(sortContext.activeTermRef, 't2');
  assert.equal(touchCount, 4);

  sortContext.beginForTest(rowByKey.get('term:t1').handle, 'keyboard');
  sortContext.moveForTest(0);
  sortContext.finishForTest(false);
  assert.deepEqual(sortDocument.terms.map(item => item.term_ref), ['t2', 't1']);
  assert.equal(sortContext.activeTermRef, 't1');
  assert.equal(touchCount, 4, 'cancelled reorder must not mark the draft changed');

  sortContext.beginForTest(rowByKey.get('term:t2').handle, 'keyboard');
  sortContext.finishForTest(true);
  assert.equal(touchCount, 4, 'unchanged reorder must not mark the draft changed');
}

async function main() {
  await testSchemas();
  await testDeterministicParser();
  await testApi();
  testProcessDiagramModel();
  testReviewPatternDiagrams();
  await testFrontendContract();
  console.log('structured-output-service structure rules tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
