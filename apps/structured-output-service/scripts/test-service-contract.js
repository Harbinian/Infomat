const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { extractFromText } = require('../server');

const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
let port = process.env.STRUCTURED_OUTPUT_TEST_PORT || '';
let baseUrl = '';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findFreePort() {
  if (port) return port;
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(String(address.port)));
    });
  });
}

async function waitForHealth(child) {
  const deadline = Date.now() + 8000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`service exited before health check, code=${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw lastError || new Error('service did not become healthy');
}

async function postJson(pathname, payload, sessionId) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(sessionId ? { 'x-session-id': sessionId } : {})
    },
    body: JSON.stringify(payload)
  });
  const json = await response.json();
  assert.equal(response.ok, true, json.error || `request failed: ${response.status}`);
  return json;
}

async function postTextUpload(sessionId, text, name = 'sample.txt') {
  const form = new FormData();
  form.append('sessionId', sessionId);
  form.append('requestId', `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  form.append('file', new Blob([text], { type: 'text/plain;charset=utf-8' }), name);
  const response = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'x-session-id': sessionId },
    body: form
  });
  const json = await response.json();
  assert.equal(response.ok, true, json.error || `upload failed: ${response.status}`);
  return json;
}

async function postTextSuggestions(sessionId, text, data, requestId = `req_suggestions_${Date.now()}`) {
  const form = new FormData();
  form.append('sessionId', sessionId);
  form.append('requestId', requestId);
  form.append('data', JSON.stringify(data));
  form.append('file', new Blob([text], { type: 'text/plain;charset=utf-8' }), 'suggestion-source.txt');
  const response = await fetch(`${baseUrl}/api/suggestions`, {
    method: 'POST',
    headers: { 'x-session-id': sessionId },
    body: form
  });
  const json = await response.json();
  assert.equal(response.ok, true, json.error || `suggestions failed: ${response.status}`);
  return json;
}

async function withService(env, fn) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: { ...process.env, STRUCTURED_OUTPUT_PORT: port, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  try {
    await waitForHealth(child);
    await fn();
  } finally {
    child.kill();
    await delay(200);
  }
  assert.equal(stderr, '', `service wrote to stderr:\n${stderr}`);
}

async function withFakeAnthropicDeepSeek(fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk.toString(); });
    req.on('end', () => {
      const body = rawBody ? JSON.parse(rawBody) : {};
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const prompt = body.messages?.[0]?.content || '';
      const payload = prompt.includes('field_values')
        ? { field_values: [] }
        : {
            fieldSuggestions: {
              'behavior_details.0.trigger_scene': {
                advice: '建议补充客户资料变更在什么情况下开始。',
                sourceText: '客户资料变更申请'
              }
            }
          };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await fn(`http://127.0.0.1:${address.port}/anthropic`, requests);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function withSlowAnthropicDeepSeek(delayMs, fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk.toString(); });
    req.on('end', () => {
      const body = rawBody ? JSON.parse(rawBody) : {};
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify({ fieldSuggestions: {} }) }]
        }));
      }, delayMs);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await fn(`http://127.0.0.1:${address.port}/anthropic`, requests);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function assertRequiredFields(schema, data) {
  for (const key of schema.required) {
    assert.ok(Object.prototype.hasOwnProperty.call(data, key), `top-level missing ${key}`);
  }
  for (const item of data.processes) {
    for (const key of schema.$defs.process.required) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `process missing ${key}`);
    }
  }
  for (const item of data.steps) {
    for (const key of schema.$defs.step.required) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `step missing ${key}`);
    }
  }
  for (const item of data.pending_issues) {
    for (const key of schema.$defs.pendingIssue.required) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `pending issue missing ${key}`);
    }
  }
  for (const item of data.behavior_details) {
    for (const key of schema.$defs.behaviorDetail.required) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `behavior detail missing ${key}`);
    }
  }
  for (const item of data.cross_dept_handoffs) {
    for (const key of schema.$defs.crossDeptHandoff.required) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `cross-department handoff missing ${key}`);
    }
  }
  for (const item of data.forms) {
    for (const key of schema.$defs.form.required) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `form missing ${key}`);
    }
  }
  for (const item of data.form_tables) {
    for (const key of schema.$defs.formTable.required) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `form table missing ${key}`);
    }
  }
  for (const item of data.form_table_fields) {
    for (const key of schema.$defs.formTableField.required) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `form table field missing ${key}`);
    }
  }
  for (const item of data.form_fields) {
    for (const key of schema.$defs.formField.required) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `form field missing ${key}`);
    }
  }
  for (const item of data.mdm_requirement_catalog) {
    for (const key of schema.$defs.mdmRequirement.required) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `master data requirement missing ${key}`);
    }
  }
  for (const key of schema.$defs.structureBlockProjection.required) {
    assert.ok(Object.prototype.hasOwnProperty.call(data.structure_block_projection, key), `projection missing ${key}`);
  }
}

function fakeElement() {
  return {
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    addEventListener() {},
    appendChild() {},
    append() {},
    replaceChildren() {},
    remove() {},
    click() {},
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

function runFrontendWorkflowProbe(enums) {
  const html = fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8');
  const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
  assert.ok(match, 'frontend script should be extractable for workflow regression checks');
  const element = fakeElement();
  const context = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    Blob,
    FormData,
    FileReader: function FileReader() {},
    Event: function Event(type) { this.type = type; },
    URL: {
      createObjectURL() { return 'blob:structured-output-test'; },
      revokeObjectURL() {}
    },
    confirm() { return true; },
    fetch: async url => ({
      ok: true,
      json: async () => String(url).includes('/api/enums') ? enums : { sessionId: 'frontend-probe' }
    }),
    document: {
      getElementById() { return element; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement() { return fakeElement(); }
    },
    window: {
      addEventListener() {}
    }
  };
  vm.createContext(context);
  const probeCode = `
${match[1]}
rosterRolesByDepartment = ${JSON.stringify(enums.rosterRolesByDepartment || {})};
workRoles = [
  { work_role_code: 'WR-0001', work_role_name: '付款经办角色', status: 'active', is_effective: true },
  { work_role_code: 'WR-0002', work_role_name: '历史复核角色', status: 'retired', is_effective: false }
];
workRolesByDepartment = {
  '财务部': [{ work_role_code: 'WR-0001', work_role_name: '付款经办角色', status: 'active', is_effective: true, position_names: ['会计员'] }]
};
docData = ensureDocument({
  schema_version: 'document-structured-output-v2',
  draft: {
    document_no: 'TEST-WORKFLOW',
    document_title: '业务流程回归测试',
    department: { department_name: '财务部' }
  },
  processes: [
    { process_ref: 'proc_finance', draft_ref: null, process_code: null, l3_key: null, process_type: 'new', l1_name: '', l2_name: '', l3_name: '财务发起流程', description: null, owner: '', system: '', evidence_refs: [] },
    { process_ref: 'proc_quality', draft_ref: null, process_code: null, l3_key: null, process_type: 'new', l1_name: '', l2_name: '', l3_name: '质量承接流程', description: null, owner: '质量管理部', system: '', evidence_refs: [] },
    { process_ref: 'proc_leader', draft_ref: null, process_code: null, l3_key: null, process_type: 'new', l1_name: '', l2_name: '', l3_name: '领导审批流程', description: null, owner: '公司领导', system: '', evidence_refs: [] },
    { process_ref: 'proc_business', draft_ref: null, process_code: null, l3_key: null, process_type: 'new', l1_name: '', l2_name: '', l3_name: '经营承接流程', description: null, owner: '经营发展部', system: '', evidence_refs: [] }
  ],
  steps: [
    { step_ref: 'step_finance_action', draft_ref: null, process_ref: 'proc_finance', step_type: 'action', a1_code: null, step_name: '财务部提交付款资料', actor_role: '财务部会计员', timing: '2个工作日', input_materials: '付款申请', output_result: '付款资料', entry: null, system: '', status: 'active', evidence_refs: [] },
    { step_ref: 'step_finance_decision', draft_ref: null, process_ref: 'proc_finance', step_type: 'decision', a1_code: null, step_name: '是否需要领导审批', actor_role: '财务部副部长', timing: null, input_materials: '付款资料', output_result: '审批判断', entry: null, system: '', status: 'active', evidence_refs: [] },
    { step_ref: 'step_quality_action', draft_ref: null, process_ref: 'proc_quality', step_type: 'action', a1_code: null, step_name: '质量管理部复核资料', actor_role: '质量管理部主管', timing: null, input_materials: '付款资料', output_result: '复核意见', entry: null, system: '', status: 'active', evidence_refs: [] },
    { step_ref: 'step_leader_action', draft_ref: null, process_ref: 'proc_leader', step_type: 'action', a1_code: null, step_name: '总经理审批重大事项', actor_role: '公司领导总经理', timing: null, input_materials: '审批材料', output_result: '审批意见', entry: null, system: '', status: 'active', evidence_refs: [] },
    { step_ref: 'step_business_action', draft_ref: null, process_ref: 'proc_business', step_type: 'action', a1_code: null, step_name: '经营发展部登记结果', actor_role: '经营发展部计划员', timing: null, input_materials: '审批意见', output_result: '登记记录', entry: null, system: '', status: 'active', evidence_refs: [] }
  ],
  behavior_details: [
    { detail_ref: 'detail_1', step_ref: 'step_finance_action', precondition: '', trigger_scene: '', execution_standard: '按资料清单提交', delivery_object: '', requires_approval: false, approval_note: '', is_cross_department: false },
    { detail_ref: 'detail_2', step_ref: 'step_finance_decision', precondition: '', trigger_scene: '', execution_standard: '判断审批层级', delivery_object: '', requires_approval: true, approval_note: '', is_cross_department: false },
    { detail_ref: 'detail_3', step_ref: 'step_quality_action', precondition: '', trigger_scene: '', execution_standard: '按质量要求复核', delivery_object: '', requires_approval: false, approval_note: '', is_cross_department: true },
    { detail_ref: 'detail_4', step_ref: 'step_leader_action', precondition: '', trigger_scene: '', execution_standard: '按授权审批', delivery_object: '', requires_approval: true, approval_note: '', is_cross_department: false },
    { detail_ref: 'detail_5', step_ref: 'step_business_action', precondition: '', trigger_scene: '', execution_standard: '登记后反馈', delivery_object: '', requires_approval: false, approval_note: '', is_cross_department: true }
  ],
  step_transitions: [
    { transition_ref: 'trans_in_process', process_ref: 'proc_finance', from_step_ref: 'step_finance_decision', condition: '不需要领导审批', to_step_ref: 'step_finance_action', evidence_refs: [] },
    { transition_ref: 'trans_cross_process', process_ref: 'proc_finance', from_step_ref: 'step_finance_decision', condition: '转经营发展部承接', to_step_ref: 'step_business_action', evidence_refs: [] },
    { transition_ref: 'trans_missing_target', process_ref: 'proc_finance', from_step_ref: 'step_finance_decision', condition: '流向待补', to_step_ref: null, evidence_refs: [] }
  ],
  forms: [
    { form_ref: 'form_1', draft_ref: null, step_ref: 'step_business_action', form_code: 'F-WF-001', form_name: '业务流程测试表', main_table_code: null, main_table_name: '业务流程测试表', archive_location: '', retention_period: '', responsible_department_ref: null, responsible_department_name: '经营发展部', responsible_role: '经营发展部计划员', status: 'draft', evidence_refs: [] }
  ],
  form_tables: [
    { table_ref: 'table_1', form_ref: 'form_1', table_code: null, table_name: '业务流程测试表', table_kind: 'main', evidence_refs: [] }
  ],
  form_table_fields: [
    { table_field_ref: 'table_field_1', table_ref: 'table_1', structure_kind: 'main', field_no: null, field_code: null, field_name: '审批结果', field_type: '文本', required: true, description: '记录审批结果' }
  ],
  evidence_catalog: [
    { evidence_ref: 'EV-ROLE-001', object_type: 'step', object_ref: 'step_finance_action', evidence_type: '制度条款', description: '制度原文中的角色或岗位称谓：财务部会计员', source_name: '财务制度.docx', source_anchor: '第 3 页第 2 条', source_file: '财务制度.docx', source_excerpt: '财务部会计员提交付款资料', locator: '第 3 页第 2 条', locate_method: 'template_text', status: 'verified' },
    { evidence_ref: 'EV-ROLE-002', object_type: 'step', object_ref: 'step_quality_action', evidence_type: '制度条款', description: '制度原文中的角色或岗位称谓：质量复核员', source_name: '质量制度.docx', source_anchor: '第 2 页第 1 条', source_file: '质量制度.docx', source_excerpt: '质量复核员复核资料', locator: '第 2 页第 1 条', locate_method: 'template_text', status: 'verified' }
  ],
  work_role_bindings: [
    { binding_ref: 'wrb_confirmed', process_ref: 'proc_finance', step_ref: 'step_finance_action', participant_department: { department_name: '财务部' }, source_role_text: '财务部会计员', work_role_code: 'WR-0001', participation_type: 'executor', status: 'confirmed', evidence_refs: ['EV-ROLE-001'], confirmation_basis: '财务部已确认该业务行为责任' }
  ],
  structure_block_projection: {
    work_role_bindings: [
      { binding_ref: 'stale_proposed', process_ref: 'proc_finance', step_ref: 'step_finance_action', participant_department: { department_name: '财务部' }, source_role_text: '财务部会计员', work_role_code: 'WR-0001', participation_type: 'executor', status: 'proposed', evidence_refs: ['EV-ROLE-001'], confirmation_basis: null }
    ]
  }
});
const financeOptions = actorRoleDepartmentOptions(processDepartmentForStep(0)).map(item => item.value);
const qualityOptions = actorRoleDepartmentOptions(processDepartmentForStep(2)).map(item => item.value);
const leaderOptions = actorRoleDepartmentOptions(processDepartmentForStep(3)).map(item => item.value);
const formOptions = actorRoleDepartmentOptions(formDepartment(0), '先确认形成部门').map(item => item.value);
const exported = normalizeForStructuredExport(docData);
const reimported = ensureDocument(exported);
const validConfirmedProblems = confirmationProblemsForWorkRoleBinding(0);
const positionDraftBinding = normalizeWorkRoleBinding({
  binding_ref: 'wrb_position_draft', process_ref: 'proc_finance', step_ref: 'step_finance_action',
  participant_department: { department_name: '财务部' }, source_role_text: '财务部会计员', source_position_name: '会计员', work_role_code: null,
  participation_type: 'executor', status: 'proposed', evidence_refs: ['EV-ROLE-001'], confirmation_basis: null
}, 1);
docData.work_role_bindings.push(positionDraftBinding);
const positionDraftStructuralProblems = structuralProblemsForWorkRoleBinding(1);
const positionDraftConfirmationProblems = confirmationProblemsForWorkRoleBinding(1);
const positionDraftExport = normalizeForStructuredExport(docData);
const positionDraftReimport = ensureDocument(positionDraftExport);
docData.work_role_bindings.pop();
docData.evidence_catalog.push({ evidence_ref: 'EV-PENDING-001', object_type: 'step', object_ref: 'step_finance_action', evidence_type: '制度条款', description: '待人工核验的角色证据', source_name: '财务制度.docx', source_anchor: '第 4 页第 1 条', source_file: '财务制度.docx', source_excerpt: '财务部会计员复核付款资料', locator: '第 4 页第 1 条', locate_method: 'template_text', status: 'pending_review' });
const pendingEvidenceBinding = normalizeWorkRoleBinding({
  binding_ref: 'wrb_pending_evidence', process_ref: 'proc_finance', step_ref: 'step_finance_action',
  participant_department: { department_name: '财务部' }, source_role_text: '财务部会计员', work_role_code: 'WR-0001',
  participation_type: 'reviewer', status: 'proposed', evidence_refs: ['EV-PENDING-001'], confirmation_basis: '财务部人工确认'
}, 1);
docData.work_role_bindings.push(pendingEvidenceBinding);
const pendingEvidenceProblems = confirmationProblemsForWorkRoleBinding(1);
const pendingEvidenceConfirmProblems = confirmationProblemsForWorkRoleBinding(1, { allowEvidenceVerification: true });
markWorkRoleEvidenceVerified(pendingEvidenceBinding);
const verifiedAfterManualConfirmation = docData.evidence_catalog.find(item => item.evidence_ref === 'EV-PENDING-001')?.status;
docData.work_role_bindings.pop();
const invalidSceneBinding = normalizeWorkRoleBinding({
  binding_ref: 'wrb_invalid_scene', process_ref: 'proc_finance', step_ref: 'step_finance_action',
  participant_department: { department_name: '财务部' }, source_role_text: '申请人', work_role_code: 'WR-0001',
  participation_type: 'initiator', status: 'confirmed', evidence_refs: ['EV-ROLE-001'], confirmation_basis: '测试'
}, 1);
docData.work_role_bindings.push(invalidSceneBinding);
const invalidSceneProblems = confirmationProblemsForWorkRoleBinding(1);
const firstInvalidRef = firstInvalidConfirmedWorkRoleBinding()?.binding.binding_ref || null;
const firstInvalidStructuralRef = firstInvalidWorkRoleBinding()?.binding.binding_ref || null;
docData.work_role_bindings.pop();
docData.evidence_catalog.push({ evidence_ref: 'EV-OCR-001', object_type: 'step', object_ref: 'step_finance_action', evidence_type: '制度条款', description: 'OCR 角色证据', source_name: '扫描件.pdf', source_anchor: '第 1 页', source_file: '扫描件.pdf', source_excerpt: '财务部会计员', locator: '第 1 页', locate_method: 'ocr', status: 'ocr_extracted_not_confirmed' });
const ocrBinding = normalizeWorkRoleBinding({
  binding_ref: 'wrb_ocr', process_ref: 'proc_finance', step_ref: 'step_finance_action',
  participant_department: { department_name: '财务部' }, source_role_text: '财务部会计员', work_role_code: 'WR-0001',
  participation_type: 'executor', status: 'confirmed', evidence_refs: ['EV-OCR-001'], confirmation_basis: '测试'
}, 1);
docData.work_role_bindings.push(ocrBinding);
const ocrProblems = confirmationProblemsForWorkRoleBinding(1);
docData.work_role_bindings.pop();
const retiredHistoryBinding = normalizeWorkRoleBinding({
  binding_ref: 'wrb_retired_history', process_ref: 'proc_quality', step_ref: 'step_quality_action',
  participant_department: { department_name: '质量管理部' }, source_role_text: '质量复核员', work_role_code: 'WR-0002',
  participation_type: 'reviewer', status: 'confirmed', evidence_refs: ['EV-ROLE-002'], confirmation_basis: '历史确认记录'
}, 1);
docData.work_role_bindings.push(retiredHistoryBinding);
importedConfirmedWorkRoleRefs.add('wrb_retired_history');
const retiredHistoryProblems = confirmationProblemsForWorkRoleBinding(1);
docData.work_role_bindings.pop();
importedConfirmedWorkRoleRefs.delete('wrb_retired_history');
globalThis.__workflowProbe = {
  financeOptions,
  qualityOptions,
  leaderOptions,
  formOptions,
  financePositions: rosterPositions('财务部'),
  qualityPositions: rosterPositions('质量管理部'),
  leaderPositions: rosterPositions('公司领导'),
  formPositions: rosterPositions('经营发展部'),
  financeRole: combineActorRole('财务部', '会计员'),
  qualityRole: combineActorRole('质量管理部', '主管'),
  leaderRole: combineActorRole('公司领导', '总经理'),
  formRole: combineActorRole('经营发展部', '计划员'),
  financeStepOptions: stepOptionsForProcess('proc_finance').map(item => item.value),
  exportedTransitions: exported.step_transitions.map(item => ({ ref: item.transition_ref, process: item.process_ref, from: item.from_step_ref, to: item.to_step_ref })),
  exportedSchemaVersion: exported.schema_version,
  exportedWorkRoleBindings: exported.work_role_bindings,
  projectedWorkRoleBindings: exported.structure_block_projection.work_role_bindings,
  reimportedWorkRoleBindings: reimported.work_role_bindings,
  validConfirmedProblems,
  positionDraftStructuralProblems,
  positionDraftConfirmationProblems,
  exportedPositionDraft: positionDraftExport.work_role_bindings.find(item => item.binding_ref === 'wrb_position_draft'),
  projectedPositionDraft: positionDraftExport.structure_block_projection.work_role_bindings.find(item => item.binding_ref === 'wrb_position_draft') || null,
  reimportedPositionDraft: positionDraftReimport.work_role_bindings.find(item => item.binding_ref === 'wrb_position_draft'),
  pendingEvidenceProblems,
  pendingEvidenceConfirmProblems,
  verifiedAfterManualConfirmation,
  invalidSceneProblems,
  ocrProblems,
  firstInvalidRef,
  firstInvalidStructuralRef,
  retiredHistoryProblems,
  reimportedProcessCount: reimported.processes.length,
  reimportedFinanceTiming: reimported.steps.find(step => step.step_ref === 'step_finance_action')?.timing,
  reimportedLeaderRole: reimported.steps.find(step => step.step_ref === 'step_leader_action')?.actor_role,
  reimportedFormRole: reimported.forms[0]?.responsible_role,
  reimportedFieldName: reimported.form_table_fields[0]?.field_name
};
`;
  vm.runInContext(probeCode, context, { filename: 'frontend-workflow-probe.js' });
  return JSON.parse(JSON.stringify(context.__workflowProbe));
}

async function run() {
  port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  const mockDeepSeek = JSON.stringify({
    field_values: [
      {
        path: 'mdm_requirement_catalog.0.object',
        value: '不存在的供应商主数据',
        source_text: '这句话不在原文中'
      }
    ],
    field_suggestions: [
      {
        path: 'behavior_details.0.trigger_scene',
        suggestion: '建议补充客户资料变更在什么情况下开始，例如客户基础信息或开票信息需要变更时。',
        source_text: '客户资料变更的申请、审核和归档'
      },
      {
        path: 'behavior_details.0.precondition',
        suggestion: '建议补充执行前需要具备的申请材料或资料状态。',
        source_text: '这句话不在原文中'
      },
      {
        path: 'steps.0.output_result',
        suggestion: '请填写输出结果。',
        source_text: '客户资料变更的申请'
      },
      {
        path: 'forms.0.archive_location',
        suggestion: '不应给下拉项返回建议。',
        source_text: '经营发展部归档保存3年'
      },
      {
        path: 'document_profile.purpose',
        suggestion: '已填写字段不应返回建议。',
        source_text: '规范客户资料变更的申请、审核和归档'
      }
    ]
  });

  await withService({ STRUCTURED_OUTPUT_MOCK_DEEPSEEK: mockDeepSeek, STRUCTURED_OUTPUT_DEEPSEEK_CIRCUIT_OPEN_MS: '200' }, async () => {
    const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/contracts/document-structured-output.schema.json'), 'utf8'));
    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(Object.prototype.hasOwnProperty.call(health, 'sessions'), false, 'health must not expose saved user sessions');
    assert.ok(health.deepseek, 'health should include DeepSeek availability summary');
    assert.equal(health.deepseek.configured, true, 'mocked DeepSeek should be treated as configured');
    assert.equal(JSON.stringify(health).includes('DEEPSEEK_API_KEY'), false, 'health must not expose API key names or values');
    const serviceEnums = await (await fetch(`${baseUrl}/api/enums`)).json();
    assert.ok(schema.properties.work_role_bindings, 'v2 schema should expose optional work role bindings');
    assert.ok(Array.isArray(serviceEnums.workRoles), 'service enums should expose the formal work role catalog');
    assert.ok(serviceEnums.workRolesByDepartment && typeof serviceEnums.workRolesByDepartment === 'object', 'service enums should expose work roles by department');
    assert.deepEqual(serviceEnums.workRoleParticipationTypes, ['owner', 'initiator', 'executor', 'reviewer', 'approver', 'collaborator', 'provider', 'receiver']);
    assert.ok(serviceEnums.departments?.some(item => item.department_name === '全公司'), 'service enums should include all-company execution scope');
    assert.ok(serviceEnums.departments?.some(item => item.department_name === '公司领导'), 'service enums should expose company leadership as an execution department');
    assert.ok(serviceEnums.rosterRolesByDepartment?.['经营发展部']?.includes('计划员'), 'service enums should expose roster positions by department');
    assert.ok(serviceEnums.rosterRolesByDepartment?.['行政人事部']?.includes('人事管理员'), 'roster position choices should come from the roster');
    for (const role of ['董事长', '总经理', '副总经理']) {
      assert.ok(serviceEnums.rosterRolesByDepartment?.['公司领导']?.includes(role), `company leadership should expose ${role}`);
    }
    const workflowProbe = runFrontendWorkflowProbe(serviceEnums);
    assert.deepEqual(workflowProbe.financeOptions, ['', '财务部', '全公司'], 'blank process owner should fall back to the document department');
    assert.ok(workflowProbe.financePositions.includes('会计员'), 'finance process should expose finance positions');
    assert.deepEqual(workflowProbe.qualityOptions, ['', '质量管理部', '全公司'], 'process owner should override the document department');
    assert.equal(workflowProbe.qualityOptions.includes('财务部'), false, 'quality process should not expose finance as a same-step execution department');
    assert.ok(workflowProbe.qualityPositions.includes('主管'), 'quality process should expose quality positions');
    assert.deepEqual(workflowProbe.leaderOptions, ['', '公司领导', '全公司'], 'company leadership should act as a local execution department');
    for (const role of ['董事长', '总经理', '副总经理']) {
      assert.ok(workflowProbe.leaderPositions.includes(role), `company leadership process should expose ${role}`);
    }
    assert.deepEqual(workflowProbe.formOptions, ['', '经营发展部', '全公司'], 'form responsible role should use the form department context');
    assert.ok(workflowProbe.formPositions.includes('计划员'), 'form role selector should expose positions for the form department');
    assert.equal(workflowProbe.financeRole, '财务部会计员', 'finance role should write back department plus position');
    assert.equal(workflowProbe.qualityRole, '质量管理部主管', 'quality role should write back its own process department');
    assert.equal(workflowProbe.leaderRole, '公司领导总经理', 'leadership role should write back company leadership plus role');
    assert.equal(workflowProbe.formRole, '经营发展部计划员', 'form role should write back form department plus position');
    assert.ok(workflowProbe.financeStepOptions.includes('step_finance_action'), 'decision branch options should include same-process action steps');
    assert.equal(workflowProbe.financeStepOptions.includes('step_business_action'), false, 'decision branch options must not include steps from another process');
    assert.equal(workflowProbe.exportedSchemaVersion, 'document-structured-output-v2', 'workflow export should preserve v2 schema');
    assert.equal(workflowProbe.exportedWorkRoleBindings.length, 1, 'workflow export should preserve work role bindings');
    assert.deepEqual(workflowProbe.projectedWorkRoleBindings, workflowProbe.exportedWorkRoleBindings.filter(item => item.status === 'confirmed'), 'projection must be rebuilt from confirmed top-level bindings only');
    assert.equal(workflowProbe.reimportedWorkRoleBindings[0].binding_ref, 'wrb_confirmed', 'work role binding should survive export and reimport');
    assert.deepEqual(workflowProbe.validConfirmedProblems, [], 'valid confirmed work role binding should pass hard validation');
    assert.deepEqual(workflowProbe.positionDraftStructuralProblems, [], 'a roster position should remain exportable before the process is solidified');
    assert.ok(workflowProbe.positionDraftConfirmationProblems.includes('流程尚未固化为正式工作角色'), 'position draft must not become a confirmed work role binding');
    assert.equal(workflowProbe.exportedPositionDraft.source_position_name, '会计员', 'position draft should preserve the selected roster position');
    assert.equal(workflowProbe.exportedPositionDraft.work_role_code, null, 'position draft must not invent a formal work role code');
    assert.equal(workflowProbe.projectedPositionDraft, null, 'position draft must not enter the confirmed structure projection');
    assert.equal(workflowProbe.reimportedPositionDraft.source_position_name, '会计员', 'position draft should survive export and reimport');
    assert.ok(workflowProbe.pendingEvidenceProblems.includes('原文依据尚未人工核验'), 'unverified evidence should block an already-confirmed binding at export');
    assert.deepEqual(workflowProbe.pendingEvidenceConfirmProblems, [], 'explicit manual confirmation may verify locatable non-OCR evidence');
    assert.equal(workflowProbe.verifiedAfterManualConfirmation, 'verified', 'manual binding confirmation should mark selected non-OCR evidence verified');
    assert.ok(workflowProbe.invalidSceneProblems.includes('场景身份不能建立固定工作角色绑定'), 'scenario identities must not become work role bindings');
    assert.ok(workflowProbe.ocrProblems.includes('OCR 原文依据只能待复核，不能形成正式绑定'), 'OCR evidence must not support a confirmed work role binding');
    assert.equal(workflowProbe.firstInvalidRef, 'wrb_invalid_scene', 'export guard should identify the first invalid confirmed binding');
    assert.equal(workflowProbe.firstInvalidStructuralRef, 'wrb_invalid_scene', 'export guard should reject structurally invalid proposed or confirmed bindings');
    assert.deepEqual(workflowProbe.retiredHistoryProblems, [], 'imported confirmed retired roles should remain displayable as history');
    assert.ok(workflowProbe.exportedTransitions.some(item => item.ref === 'trans_in_process' && item.to === 'step_finance_action'), 'same-process branch should keep its target');
    assert.ok(workflowProbe.exportedTransitions.some(item => item.ref === 'trans_cross_process' && item.to === null), 'cross-process branch target should be cleared before export');
    assert.ok(workflowProbe.exportedTransitions.some(item => item.ref === 'trans_missing_target' && item.to === null), 'blank branch target should remain exportable');
    assert.equal(workflowProbe.reimportedProcessCount, 4, 'reimport should preserve split process cards');
    assert.equal(workflowProbe.reimportedFinanceTiming, '2个工作日', 'step timing should survive export and reimport');
    assert.equal(workflowProbe.reimportedLeaderRole, '公司领导总经理', 'reimport should preserve leadership actor role');
    assert.equal(workflowProbe.reimportedFormRole, '经营发展部计划员', 'reimport should preserve form responsible role');
    assert.equal(workflowProbe.reimportedFieldName, '审批结果', 'reimport should preserve form table fields');

    const session = await postJson('/api/session', {});
    const sample = [
      '制度编号：CX-ZD-001',
      '制度名称：客户资料变更管理制度',
      '归口部门：经营发展部',
      '涉及部门：财务部',
      '目的',
      '规范客户资料变更的申请、审核和归档。',
      '适用范围',
      '经营副总 / 经营发展部 / 客户资料变更管理',
      '术语和定义',
      '1. 客户资料：客户基础信息和开票信息。',
      '职责',
      '销售内勤负责客户资料维护。',
      '工作流程',
      '1. 销售内勤填写客户资料变更申请单并提交部门负责人审核。',
      '2. 经营发展部负责人审核变更原因和资料完整性。',
      '3. 财务部确认开票信息是否同步更新。',
      '4. 财务部会计员复核开票信息。',
      '5. 申请单填写完成后，提交审核并备案。',
      '流程图',
      '[图片流程图]',
      '表单与记录',
      'CX-BD-001《客户资料变更申请单》用于客户资料变更申请，由销售内勤填写，经营发展部归档保存3年。',
      '包含字段：客户名称、统一社会信用代码、开票信息、变更原因'
    ].join('\n');

    const uploadForm = new FormData();
    uploadForm.append('sessionId', session.sessionId);
    uploadForm.append('requestId', 'req_contract_1');
    uploadForm.append('file', new Blob([sample], { type: 'text/plain;charset=utf-8' }), '客户资料变更管理制度.txt');
    const uploadResponse = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'x-session-id': session.sessionId },
      body: uploadForm
    });
    const result = await uploadResponse.json();
    assert.equal(uploadResponse.ok, true, result.error || 'standard upload failed');
    assert.equal(result.sessionId, session.sessionId);
    assert.equal(result.requestId, 'req_contract_1');
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'rawText'), false, 'upload response must not return source text');
    assert.ok(result.fieldSources && result.fieldSources['document_profile.purpose'], 'auto-filled fields need folded source records');
    assert.equal(result.fieldSources['document_profile.purpose'].source_text, '规范客户资料变更的申请、审核和归档。');
    assert.equal(result.fieldOrigins['document_profile.purpose'], 'auto');
    assert.ok(result.enums?.rosterRolesByDepartment?.['经营发展部']?.includes('计划员'), 'upload response should carry roster role choices for the editor');
    assert.ok(result.enums?.rosterRolesByDepartment?.['公司领导']?.includes('董事长'), 'upload response should carry company leadership role choices for the editor');
    assert.ok(result.fieldSuggestions, 'upload response should include page-only field suggestions');
    assert.equal(Object.keys(result.fieldSuggestions).length, 0, 'upload should fill the page before DeepSeek suggestions are generated');
    assert.equal(Object.prototype.hasOwnProperty.call(result.data, 'fieldSuggestions'), false, 'field suggestions must stay out of exported data model');

    const data = result.data;
    assertRequiredFields(schema, data);
    assert.equal(data.schema_version, 'document-structured-output-v2', 'standard upload should produce v2 structured output');
    assert.ok(Array.isArray(data.step_transitions), 'v2 output should include decision branch transitions');
    assert.ok(Array.isArray(data.work_role_bindings), 'v2 output should include the optional work role binding collection');
    assert.ok(data.work_role_bindings.every(item => item.status === 'proposed'), 'automatic role matching must never create confirmed bindings');
    assert.ok(data.steps.every(step => step.step_type === 'action'), 'auto-extracted workflow steps should default to action nodes');
    assert.equal(result.stats && Object.prototype.hasOwnProperty.call(result.stats, 'textLen'), false, 'stats must not expose source text length');
    assert.equal(data.document_profile.purpose, '规范客户资料变更的申请、审核和归档。');
    assert.equal(data.document_profile.scope, '经营副总 / 经营发展部 / 客户资料变更管理');
    assert.equal(data.terms[0].term_name, '客户资料');
    assert.notEqual(data.draft.l1_name, data.document_profile.scope, 'scope text must not be treated as process classification');
    assert.ok(data.steps.some(step => step.step_name === '销售内勤填写客户资料变更申请单'), 'compound sentence should split by clear verbs');
    assert.ok(data.steps.some(step => step.step_name.includes('销售内勤提交') && step.actor_role === '销售内勤'), 'clear same-sentence subject should be inherited');
    const actorless = data.steps.find(step => step.step_name.includes('提交审核') || step.step_name.includes('备案'));
    assert.ok(actorless, 'actorless actions should still be editable steps');
    assert.equal(actorless.actor_role, null, 'actor must stay blank when only inferred by common sense');
    assert.equal(data.steps.some(step => step.step_name.includes('图片流程图')), false, 'flowchart image text should not become a step');
    assert.equal(data.steps.some(step => step.step_name.includes('负责客户资料维护')), false, 'responsibility section must not create abstract duties');
    assert.equal(data.steps.some(step => step.actor_role === '经营发展部负责人'), true, '负责人 should stay with the actor role');
    const externalActorIndex = data.steps.findIndex(step => step.actor_role === '财务部会计员');
    assert.ok(externalActorIndex >= 0, 'valid roster roles from another department should still be visible as imported content');
    const externalActorWarning = result.fieldWarnings?.[`steps.${externalActorIndex}.actor_role`];
    assert.ok(externalActorWarning, 'execution roles outside the document department should be warned even when they exist in the roster');
    assert.match(externalActorWarning.message, /归口部门/);
    assert.equal(data.cross_dept_handoffs.length, 1, 'related department should create pending handoff');
    assert.equal(data.cross_dept_handoffs[0].target_department, '财务部');
    assert.equal(data.behavior_details.length, data.steps.length, 'each step needs behavior detail scaffold');
    assert.ok(data.evidence_catalog.length >= 1, 'source text should create a pending evidence record');
    const roleEvidence = data.evidence_catalog.find(item => item.evidence_ref?.startsWith('EV-ROLE-'));
    assert.ok(roleEvidence, 'source actor text should create a dedicated evidence record');
    assert.ok(roleEvidence.source_excerpt, 'role evidence should retain the exact source excerpt in exported data');
    assert.ok(data.pending_issues.some(item => item.target_block === 'work_role_bindings' && item.issue_type === '角色责任待确认'), 'unconfirmed source roles should create business-facing work role review items');
    assert.ok(data.steps.filter(step => step.actor_role).every(step => step.evidence_refs.some(ref => ref.startsWith('EV-ROLE-'))), 'every source actor should reference its dedicated evidence record');
    const roleEvidenceItems = data.evidence_catalog.filter(item => String(item.evidence_ref || '').startsWith('EV-ROLE-'));
    assert.ok(roleEvidenceItems.length > 0, 'source roles should be exported as dedicated evidence records');
    assert.ok(roleEvidenceItems.every(item => item.source_file && item.locator && item.source_excerpt && item.locate_method), 'role evidence should preserve source file, precise locator, excerpt, and extraction method');
    assert.equal(data.mdm_requirement_catalog.some(item => item.object === '不存在的供应商主数据'), false, 'DeepSeek values without exact source text must be dropped');
    assert.equal(data.structure_block_projection.meta.parser_schema_version, 1);
    assert.equal(data.structure_block_projection.l3_catalog.length, data.processes.length);
    assert.equal(data.structure_block_projection.a1_catalog.length, data.steps.length);
    assert.deepEqual(data.structure_block_projection.work_role_bindings, [], 'proposed work role bindings must not enter the confirmed projection');
    assert.equal(data.forms[0].form_name, '客户资料变更申请单');
    assert.equal(data.forms[0].retention_period, '3年');
    assert.equal(data.forms[0].responsible_department_name, '经营发展部');
    assert.ok(data.form_table_fields.some(field => field.field_name === '统一社会信用代码'), 'form fields should feed table fields');

    const explicitBehaviorSample = [
      '制度编号：CX-ZD-EXPLICIT',
      '制度名称：产品包装、交付管理程序',
      '归口部门：项目管理部',
      '规定',
      '5.1产品包装设计',
      '5.1.1项目管理部按要求传递相关要求，组织启动产品包装设计/更改工作。',
      '行为1：传递产品包装设计要求：',
      '执行角色：项目管理部——项目助理',
      '触发场景：常驻任务，当接收到订单时，由项目部承接客户相关规范。',
      '前置条件：存在客户对产品包装的要求。',
      '输入：《XX规范》、产品图号、主进度计划',
      '输出：OA/PLM生成待办或者下行动项。',
      '执行标准：无。',
      '5.1.2项目管理部将产品包装设计数据集传递给客户完成审批。',
      '行为2：包装设计数据通过客户审批',
      '执行角色：项目管理部—项目助理/工程技术部-技术员',
      '触发场景：特定任务，包装设计需客户审批',
      '前置条件：包装设计数据已确定。',
      '输入材料：客户审批需求',
      '输出结果：包装技术方案。',
      '执行标准：客户需求。',
      '5.2未使用显式字段标记的普通条款不应混入上述业务行为。'
    ].join('\n');
    const explicitBehaviorResult = await postTextUpload(session.sessionId, explicitBehaviorSample, '产品包装交付管理程序.txt');
    const explicitBehaviorData = explicitBehaviorResult.data;
    assert.equal(explicitBehaviorData.steps.length, 2, 'explicit behavior blocks should take precedence over nearby natural-language clauses');
    assert.deepEqual(explicitBehaviorData.steps.map(step => step.step_name), [
      '传递产品包装设计要求',
      '包装设计数据通过客户审批'
    ]);
    assert.equal(explicitBehaviorData.steps[0].actor_role, '项目管理部项目助理');
    assert.equal(explicitBehaviorData.steps[0].input_materials, '《XX规范》、产品图号、主进度计划');
    assert.equal(explicitBehaviorData.steps[0].output_result, 'OA/PLM生成待办或者下行动项');
    assert.equal(explicitBehaviorData.behavior_details[0].trigger_scene, '常驻任务，当接收到订单时，由项目部承接客户相关规范');
    assert.equal(explicitBehaviorData.behavior_details[0].precondition, '存在客户对产品包装的要求');
    assert.equal(explicitBehaviorData.behavior_details[0].execution_standard, '无');
    assert.equal(explicitBehaviorData.behavior_details[0].delivery_object, 'OA/PLM生成待办或者下行动项');
    assert.equal(explicitBehaviorData.steps[1].actor_role, '项目管理部项目助理 / 工程技术部技术员');
    assert.equal(explicitBehaviorData.steps[1].input_materials, '客户审批需求');
    assert.equal(explicitBehaviorData.steps[1].output_result, '包装技术方案');
    assert.equal(explicitBehaviorData.behavior_details[1].requires_approval, true);
    assert.equal(explicitBehaviorData.behavior_details[1].approval_note, '包装设计数据通过客户审批');
    assert.equal(explicitBehaviorResult.fieldSources['steps.0.step_name'].source_text, '行为1：传递产品包装设计要求：');
    assert.equal(explicitBehaviorResult.fieldSources['steps.0.actor_role'].source_text, '执行角色：项目管理部——项目助理');
    assert.equal(explicitBehaviorResult.fieldSources['steps.0.input_materials'].source_text, '输入：《XX规范》、产品图号、主进度计划');
    assert.equal(explicitBehaviorResult.fieldSources['behavior_details.0.trigger_scene'].source_text, '触发场景：常驻任务，当接收到订单时，由项目部承接客户相关规范。');
    assert.equal(explicitBehaviorResult.fieldOrigins['behavior_details.0.execution_standard'], 'auto');
    assert.equal(explicitBehaviorData.steps.some(step => /^(?:执行角色|触发场景|前置条件|输入|输出|执行标准)：/.test(step.step_name)), false, 'explicit field rows must not become standalone steps');

    const fieldLexiconSample = [
      '制度编号：CX-ZD-FIELD',
      '制度名称：质量偏差处理管理程序',
      '归口部门：质量管理部',
      '目的',
      '规范质量偏差通知后的调查、处理和验证。',
      '工作程序',
      '1. 当收到顾客质量偏差通知后，质量安环部提交《质量偏差通知处理单》，随附调查资料和客观证明文件，在15个工作日内反馈处理结论。',
      '2. 经部门负责人审核批准后，责任单位制定纠正措施，形成《纠正措施报告》，并保存整改材料。'
    ].join('\n');
    const fieldLexiconResult = await postTextUpload(session.sessionId, fieldLexiconSample, '质量偏差处理管理程序.txt');
    const fieldLexiconData = fieldLexiconResult.data;
    const notificationStepIndex = fieldLexiconData.steps.findIndex(step => step.step_name.includes('质量安环部提交《质量偏差通知处理单》'));
    assert.ok(notificationStepIndex >= 0, 'field lexicon sample should extract the quality deviation submission step');
    const notificationStep = fieldLexiconData.steps[notificationStepIndex];
    const notificationDetail = fieldLexiconData.behavior_details[notificationStepIndex];
    assert.match(notificationDetail.trigger_scene || '', /收到顾客质量偏差通知/, 'trigger scene should come from event phrases, not DeepSeek suggestions');
    assert.match(notificationStep.input_materials || '', /《质量偏差通知处理单》/, 'input materials should include the submitted form');
    assert.match(notificationStep.input_materials || '', /调查资料/, 'input materials should include attached materials');
    assert.match(notificationStep.input_materials || '', /客观证明文件/, 'input materials should include evidence files');
    assert.match(notificationStep.output_result || '', /处理结论/, 'output result should include the feedback deliverable');
    assert.match(notificationDetail.execution_standard || '', /15个工作日内/, 'execution standard should include the time limit');
    const actionStepIndex = fieldLexiconData.steps.findIndex(step => step.step_name.includes('责任单位制定纠正措施'));
    assert.ok(actionStepIndex >= 0, 'field lexicon sample should extract the corrective action step');
    const actionStep = fieldLexiconData.steps[actionStepIndex];
    const actionDetail = fieldLexiconData.behavior_details[actionStepIndex];
    assert.match(actionDetail.precondition || '', /部门负责人审核批准/, 'precondition should come from approval-before-action phrases');
    assert.match(actionStep.output_result || '', /《纠正措施报告》/, 'output result should include formed report objects');
    assert.match(actionDetail.execution_standard || '', /保存整改材料/, 'execution standard should include preservation requirements');

    const multiProcessSample = [
      '制度编号：CX-ZD-MULTI',
      '制度名称：车辆使用申请管理规定',
      '归口部门：项目管理部',
      '目的',
      '规范车辆使用申请和审批。',
      '申请流程',
      '1. 申请人填写《车辆使用申请单》。',
      '2. 申请人提交业务主管审批。',
      '审批流程',
      '1. 业务主管审核用车必要性。',
      '2. 后勤管理员安排车辆并反馈申请人。'
    ].join('\n');
    const multiProcessResult = await postTextUpload(session.sessionId, multiProcessSample, '车辆使用申请管理规定.txt');
    const multiProcessData = multiProcessResult.data;
    assert.equal(multiProcessData.schema_version, 'document-structured-output-v2');
    assert.ok(multiProcessData.processes.length >= 2, 'same-level workflow sections should create multiple processes');
    assert.ok(multiProcessData.processes.some(process => /申请流程/.test(process.l3_name)), 'first process should keep the application section name');
    assert.ok(multiProcessData.processes.some(process => /审批流程/.test(process.l3_name)), 'second process should keep the approval section name');
    const applicationProcess = multiProcessData.processes.find(process => /申请流程/.test(process.l3_name));
    const approvalProcess = multiProcessData.processes.find(process => /审批流程/.test(process.l3_name));
    assert.ok(multiProcessData.steps.some(step => step.process_ref === applicationProcess.process_ref && step.step_name.includes('填写《车辆使用申请单》')), 'application steps should belong to the application process');
    assert.ok(multiProcessData.steps.some(step => step.process_ref === approvalProcess.process_ref && step.step_name.includes('审核用车必要性')), 'approval steps should belong to the approval process');
    assert.equal(multiProcessData.step_transitions.length, 0, 'document extraction should not infer decision branches automatically');

    const intellectualPropertySample = [
      '制度编号：GLTX-GC-01',
      '制度名称：知识产权申报与维护管理程序',
      '归口部门：工程技术部',
      '适用范围',
      '本程序适用于本单位全体员工知识产权相关全部流程。',
      '术语和定义',
      '序号',
      '术语',
      '定       义',
      '1',
      '知识产权',
      '知识产权是对智力劳动成果所享有的权利。',
      '规定',
      '1.各部门在项目成果确定后，3个工作日内填写附表1《知识产权申报表》，附相关技术文档，提交至直属部门负责人。',
      '2.工程技术部收到材料后进行审核，形成《审核意见表》。',
      '规定表格',
      'GLTX-GC-01-01-A《知识产权申报表》'
    ].join('\n');
    const ipResult = await postTextUpload(session.sessionId, intellectualPropertySample, '知识产权申报与维护管理程序.txt');
    const ipData = ipResult.data;
    assert.equal(ipData.terms.some(term => /定义/.test(term.term_name)), false, 'term table header must not become a term name');
    assert.equal(ipData.terms.some(term => /^\d+$/.test(term.term_name)), false, 'three-column term table sequence numbers must not become term names');
    assert.ok(ipData.terms.some(term => term.term_name === '知识产权'), 'term name should come from the term column');
    assert.ok(ipData.steps.some(step => step.step_name === '填写《知识产权申报表》'), 'fill-form behavior should remove timing and attachment numbering');
    const fillStepIndex = ipData.steps.findIndex(step => step.step_name === '填写《知识产权申报表》');
    const fillStep = ipData.steps[fillStepIndex];
    assert.equal(fillStep?.input_materials, '《知识产权申报表》', 'input materials should keep the complete form name without 表1');
    assert.match(ipData.behavior_details[fillStepIndex]?.execution_standard || '', /填表说明/, 'fill-form behavior should recommend following the form instructions');
    assert.match(ipData.behavior_details[fillStepIndex]?.execution_standard || '', /继续完善/, 'fill-form behavior should remind users to complete the standard');
    assert.equal(ipData.forms.some(form => form.form_name === '审核意见表'), false, 'workflow output mentions must not create a standalone form');
    assert.ok(ipData.forms.some(form => form.form_name === '知识产权申报表'), 'listed regulation form should still be extracted');

    const tableAwareResult = await extractFromText(intellectualPropertySample, {
      sourceName: '知识产权申报与维护管理程序.docx',
      sourceTables: [
        {
          rows: [
            [{ text: '成果名称', colSpan: 2 }, { text: '', colSpan: 5 }],
            [{ text: '完 成 成 果 主 要 人 员 名 单', colSpan: 7 }],
            [
              { text: '姓名', colSpan: 1 },
              { text: '工作部门', colSpan: 2 },
              { text: '年龄', colSpan: 1 },
              { text: '学历', colSpan: 1 },
              { text: '职务与专业', colSpan: 1 },
              { text: '所起作用', colSpan: 1 }
            ]
          ]
        }
      ]
    });
    const detailTable = tableAwareResult.data.form_tables.find(table => table.table_name === '完成成果主要人员名单');
    assert.ok(detailTable, 'embedded personnel list should be recognized as a detail table');
    assert.equal(detailTable.table_kind, 'detail', 'embedded personnel list should not stay in the main table');
    assert.equal(tableAwareResult.data.form_table_fields.some(field => field.table_ref === detailTable.table_ref && field.field_name === '姓名' && field.structure_kind === 'detail'), true, 'detail table fields should be attached to the detail table');
    assert.equal(tableAwareResult.data.form_table_fields.some(field => field.field_name === '完 成 成 果 主 要 人 员 名 单'), false, 'detail table title should not be treated as a field');

    const suggestionResult = await postTextSuggestions(session.sessionId, sample, result.data, 'req_contract_1_suggestions');
    assert.equal(suggestionResult.requestId, 'req_contract_1_suggestions');
    assert.ok(suggestionResult.fieldSuggestions, 'suggestion response should include page-only field suggestions');
    assert.equal(suggestionResult.fieldSuggestions['behavior_details.0.trigger_scene'].suggestion, '建议补充客户资料变更在什么情况下开始，例如客户基础信息或开票信息需要变更时。');
    assert.equal(suggestionResult.fieldSuggestions['behavior_details.0.trigger_scene'].source_text, '客户资料变更的申请、审核和归档');
    assert.equal(suggestionResult.fieldSuggestions['behavior_details.0.precondition'].suggestion, '建议补充执行前需要具备的申请材料或资料状态。');
    assert.equal(Object.prototype.hasOwnProperty.call(suggestionResult.fieldSuggestions['behavior_details.0.precondition'], 'source_text'), false, 'unmatched suggestion source text must be dropped');
    assert.equal(Object.prototype.hasOwnProperty.call(suggestionResult.fieldSuggestions, 'steps.0.output_result'), false, 'low-value DeepSeek suggestions should be dropped');
    assert.equal(Object.prototype.hasOwnProperty.call(suggestionResult.fieldSuggestions, 'document_profile.purpose'), false, 'filled fields should not receive DeepSeek suggestions');
    assert.equal(Object.prototype.hasOwnProperty.call(suggestionResult.fieldSuggestions, 'forms.0.archive_location'), false, 'enum-like select fields should not receive DeepSeek suggestions');

    const realDocPath = path.join(repoRoot, 'docs/norms/经营发展部业务资料/管理体系程序文件/GLTX-JY-22-A管理创新管理程序.docx');
    assert.equal(fs.existsSync(realDocPath), true, 'reported Word fixture must exist');
    const realDocForm = new FormData();
    realDocForm.append('sessionId', session.sessionId);
    realDocForm.append('requestId', 'req_real_doc_1');
    realDocForm.append('file', new Blob([fs.readFileSync(realDocPath)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'GLTX-JY-22-A管理创新管理程序.docx');
    const realDocUpload = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'x-session-id': session.sessionId },
      body: realDocForm
    });
    const realDocResult = await realDocUpload.json();
    assert.equal(realDocUpload.ok, true, realDocResult.error || 'reported Word upload failed');
    const realDoc = realDocResult.data;
    assertRequiredFields(schema, realDoc);
    assert.equal(Object.prototype.hasOwnProperty.call(realDoc, 'fieldWarnings'), false, 'warnings must stay out of exported data model');
    assert.equal(realDoc.draft.document_no, 'GLTX-JY-22');
    assert.equal(realDoc.document_profile.document_no, 'GLTX-JY-22');
    assert.equal(realDoc.draft.document_title, '管理创新管理程序');
    assert.equal(realDoc.document_profile.document_title, '管理创新管理程序');
    assert.equal(realDoc.draft.planned_edition, 'A');
    assert.equal(realDoc.draft.department.department_name, '经营发展部');
    assert.equal(realDoc.draft.basis_type, '制度 / 规程');
    assert.equal(realDocResult.fieldOrigins['draft.basis_type'], 'default');
    assert.match(realDocResult.fieldSources['draft.document_no'].source_text, /GLTX-JY-22/);
    assert.equal(realDocResult.fieldSources['draft.document_no'].source_anchor.includes('609'), false, 'document number must not come from the attachment placeholder');
    assert.equal(realDoc.draft.process_name, '管理创新提案、评审决策、立项实施、验收评估与固化推广');
    assert.equal(realDoc.draft.l1_name, '管理体系、流程与文化创新治理');
    assert.equal(realDoc.draft.l2_name, '管理创新管理');
    assert.equal(realDoc.draft.l3_name, '管理创新提案、评审决策、立项实施、验收评估与固化推广');
    assert.equal(realDoc.processes[0].l1_name, realDoc.draft.l1_name);
    assert.equal(realDoc.processes[0].l2_name, realDoc.draft.l2_name);
    assert.equal(realDoc.processes[0].l3_name, realDoc.draft.l3_name);
    assert.equal(realDoc.processes[0].system, 'OA');
    assert.notEqual(realDoc.draft.l1_name, realDoc.document_profile.scope, 'scope sentence must not be treated as a process classification');
    assert.ok(realDoc.terms.some(term => term.term_name === '管理创新' && term.definition.includes('提升组织运营效率')), 'Word term detail table should be extracted');
    assert.ok(realDoc.terms.some(term => term.term_name === '管理创新项目'), 'second Word term should be extracted');
    assert.ok(realDoc.terms.some(term => term.term_name === '管理创新评审小组'), 'third Word term should be extracted');
    assert.equal(realDoc.steps.some(step => step.step_name.includes('公司鼓励全体员工')), false, 'attitude sentences must not become business behavior');
    assert.equal(realDoc.steps.some(step => step.step_name.includes('各部门应按季度主动组织提案工作')), false, 'broad non-executable requirements must not become business behavior');
    assert.equal(realDoc.steps.some(step => step.step_name.includes('由部门集中提交')), false, 'generic passive handoff must not become business behavior');
    assert.equal(realDoc.steps.some(step => step.step_name === '评审小组对评估成功的项目'), false, 'sentence fragments must not become business behavior');
    assert.ok(realDoc.steps.some(step => step.step_name.includes('规范填写《管理创新提案表》')), 'section 5 workflow text should create action steps');
    assert.ok(realDoc.steps.some(step => step.step_name.includes('组织召集管理创新评审小组召开评审会议')), 'workflow actions should include review meeting');
    const progressStep = realDoc.steps.find(step => step.step_name.includes('报送进度简报'));
    assert.equal(progressStep?.actor_role, '项目实施负责人', 'actor role must not include timing or target object');
    const progressStepIndex = realDoc.steps.findIndex(step => step.step_name.includes('报送进度简报'));
    const progressRoleWarning = realDocResult.fieldWarnings?.[`steps.${progressStepIndex}.actor_role`];
    assert.ok(progressRoleWarning, 'actors not found in roster department-position pairs should be warned');
    assert.match(progressRoleWarning.message, /花名册/);
    assert.equal(progressRoleWarning.value, '项目实施负责人');
    const awardStep = realDoc.steps.find(step => step.step_name.includes('评选出特等奖'));
    assert.notEqual(awardStep?.actor_role, '经营发展部', 'actor role must not be inherited across sentences');
    const reviewStandard = realDoc.behavior_details.find((detail, index) => realDoc.steps[index]?.step_name.includes('决议'));
    assert.ok(reviewStandard?.execution_standard?.includes('创新性、战略契合度、预期效益、可行性及风险'), 'review dimensions should fill execution standard');
    assert.ok(realDoc.forms.some(form => form.form_code === 'GLTX-JY-22-01-A' && form.form_name === '管理创新提案表'), 'forms listed in section 7 should be extracted with codes');
    assert.ok(realDoc.forms.some(form => form.form_name === '管理创新项目成果评估报告'), 'all listed forms should be extracted');
    assert.ok(realDoc.form_table_fields.some(field => field.field_name === '所在部门'), 'attachment table fields should be extracted');
    assert.ok(realDoc.form_table_fields.some(field => field.field_name === '创新提案名称'), 'attachment table fields should include proposal name');
    const tableByFormName = new Map(realDoc.forms.map(form => {
      const table = realDoc.form_tables.find(item => item.form_ref === form.form_ref);
      return [form.form_name, table];
    }));
    const proposalTable = tableByFormName.get('管理创新提案表');
    const evaluationTable = tableByFormName.get('管理创新项目成果评估报告');
    assert.ok(proposalTable?.table_ref, 'each form should have its own editable table');
    assert.ok(evaluationTable?.table_ref, 'later forms should have their own editable table');
    assert.notEqual(proposalTable.table_ref, evaluationTable.table_ref, 'different forms must not share one field table');
    assert.ok(realDoc.form_table_fields.some(field => field.table_ref === proposalTable.table_ref && field.field_name === '创新提案名称'), 'proposal fields should be attached to proposal form table');
    assert.ok(realDoc.form_table_fields.some(field => field.table_ref === evaluationTable.table_ref && field.field_name === '成果固化状态'), 'evaluation fields should be attached to evaluation form table');

    const correctiveActionPath = path.join(repoRoot, 'docs/norms/质量管理部业务资料/昌兴程序/SYCXQMS-M2-05 纠正措施管理程序/纠正措施管理程序 正文.docx');
    assert.equal(fs.existsSync(correctiveActionPath), true, 'corrective action Word fixture must exist');
    const correctiveActionForm = new FormData();
    correctiveActionForm.append('sessionId', session.sessionId);
    correctiveActionForm.append('requestId', 'req_corrective_action_doc_1');
    correctiveActionForm.append('file', new Blob([fs.readFileSync(correctiveActionPath)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), '纠正措施管理程序 正文.docx');
    const correctiveActionUpload = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'x-session-id': session.sessionId },
      body: correctiveActionForm
    });
    const correctiveActionResult = await correctiveActionUpload.json();
    assert.equal(correctiveActionUpload.ok, true, correctiveActionResult.error || 'corrective action Word upload failed');
    const correctiveActionDoc = correctiveActionResult.data;
    assertRequiredFields(schema, correctiveActionDoc);
    assert.ok(correctiveActionDoc.steps.length > 0, 'corrective action work program should create editable workflow steps');
    assert.equal(correctiveActionDoc.steps.some(step => step.step_name.includes('顾客反馈')), false, 'trigger condition bullet items should not become workflow steps');
    assert.equal(correctiveActionDoc.steps.some(step => /^(?:当|对|对于).+时$/.test(step.step_name)), false, 'standalone condition clauses should not become workflow steps');
    assert.ok(correctiveActionDoc.steps.some(step => step.step_name.includes('编写FM-M2-05-01《纠正措施报告》')), 'work program action should extract the corrective action report step');
    assert.ok(correctiveActionDoc.steps.some(step => step.step_name.includes('验证其实施结果')), 'verification clauses should create a workflow step');
    assert.equal(correctiveActionDoc.behavior_details.length, correctiveActionDoc.steps.length, 'corrective action steps need behavior detail scaffold');

    const nonconformingProductPath = path.join(repoRoot, 'docs/norms/质量管理部业务资料/昌兴程序/SYCXQMS-P5-10 不合格品控制管理程序/正文.docx');
    assert.equal(fs.existsSync(nonconformingProductPath), true, 'nonconforming product Word fixture must exist');
    const nonconformingProductForm = new FormData();
    nonconformingProductForm.append('sessionId', session.sessionId);
    nonconformingProductForm.append('requestId', 'req_nonconforming_product_doc_1');
    nonconformingProductForm.append('file', new Blob([fs.readFileSync(nonconformingProductPath)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), '正文.docx');
    const nonconformingProductUpload = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'x-session-id': session.sessionId },
      body: nonconformingProductForm
    });
    const nonconformingProductResult = await nonconformingProductUpload.json();
    assert.equal(nonconformingProductUpload.ok, true, nonconformingProductResult.error || 'nonconforming product Word upload failed');
    const nonconformingProductDoc = nonconformingProductResult.data;
    assertRequiredFields(schema, nonconformingProductDoc);
    assert.equal(nonconformingProductDoc.draft.document_no, 'SYCXQMS-P5-10');
    assert.equal(nonconformingProductDoc.draft.document_title, '不合格品控制管理程序');
    assert.equal(nonconformingProductDoc.draft.l1_name, '不合格品控制');
    assert.equal(nonconformingProductDoc.draft.l2_name, '不合格品审理与处置');
    assert.equal(nonconformingProductDoc.processes[0].l1_name, nonconformingProductDoc.draft.l1_name);
    assert.equal(nonconformingProductDoc.processes[0].l2_name, nonconformingProductDoc.draft.l2_name);
    assert.equal(nonconformingProductResult.fieldOrigins['processes.0.l1_name'], 'external_reference');
    assert.equal(nonconformingProductResult.fieldOrigins['processes.0.l2_name'], 'external_reference');

    const vehicleUsePath = path.join(repoRoot, 'docs/norms/项目管理部业务资料/车辆使用申请管理规定.docx');
    assert.equal(fs.existsSync(vehicleUsePath), true, 'vehicle use Word fixture must exist');
    const vehicleUseForm = new FormData();
    vehicleUseForm.append('sessionId', session.sessionId);
    vehicleUseForm.append('requestId', 'req_vehicle_use_doc_1');
    vehicleUseForm.append('file', new Blob([fs.readFileSync(vehicleUsePath)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), '车辆使用申请管理规定.docx');
    const vehicleUseUpload = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'x-session-id': session.sessionId },
      body: vehicleUseForm
    });
    const vehicleUseResult = await vehicleUseUpload.json();
    assert.equal(vehicleUseUpload.ok, true, vehicleUseResult.error || 'vehicle use Word upload failed');
    assert.ok(vehicleUseResult.data.steps.some(step => step.step_name.includes('填写《车辆使用申请单》')), '申请流程 section should extract vehicle application form filling');
    assert.ok(vehicleUseResult.data.steps.some(step => step.step_name.includes('提交业务主管审批')), '审批流程 section should extract approval submission');
    assert.equal(vehicleUseResult.data.steps.some(step => step.step_name === '表单填写' || step.step_name === '（一）表单填写'), false, 'subsection headings should not become workflow steps');
    assert.equal(vehicleUseResult.data.steps.some(step => step.step_name.startsWith('包括申请单位')), false, 'field list clauses should not become workflow steps');
    assert.equal(vehicleUseResult.data.steps.some(step => step.step_name.startsWith('经审批通过的申请单')), false, 'approved application preconditions should not become workflow steps');
    assert.equal(vehicleUseResult.data.steps.some(step => step.step_name.startsWith('若发现填写虚假信息')), false, 'exception trigger clauses should not become workflow steps');

    const furnaceHandoffPath = path.join(repoRoot, 'docs/norms/项目管理部业务资料/随炉件移交及理化结果反馈管理规定.docx');
    assert.equal(fs.existsSync(furnaceHandoffPath), true, 'furnace handoff Word fixture must exist');
    const furnaceHandoffForm = new FormData();
    furnaceHandoffForm.append('sessionId', session.sessionId);
    furnaceHandoffForm.append('requestId', 'req_furnace_handoff_doc_1');
    furnaceHandoffForm.append('file', new Blob([fs.readFileSync(furnaceHandoffPath)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), '随炉件移交及理化结果反馈管理规定.docx');
    const furnaceHandoffUpload = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'x-session-id': session.sessionId },
      body: furnaceHandoffForm
    });
    const furnaceHandoffResult = await furnaceHandoffUpload.json();
    assert.equal(furnaceHandoffUpload.ok, true, furnaceHandoffResult.error || 'furnace handoff Word upload failed');
    assert.ok(furnaceHandoffResult.data.steps.some(step => step.step_name.includes('转发至“公司-航达随炉件移交群”')), '核心流程及要求 section should extract handoff notification transfer');
    assert.equal(furnaceHandoffResult.data.steps.some(step => ['随炉件出罐通知', '移交群管理'].includes(step.step_name)), false, 'core process subsection headings should not become workflow steps');
    assert.equal(furnaceHandoffResult.data.steps.some(step => step.step_name.startsWith('-')), false, 'bullet markers should not leak into workflow steps');
    assert.equal(furnaceHandoffResult.data.steps.some(step => step.step_name.includes('群内信息仅围绕')), false, 'group scope descriptions should not become workflow steps');
    assert.equal(furnaceHandoffResult.data.steps.some(step => step.step_name.includes('在收到群内通知')), false, 'trigger-only notification clauses should not become workflow steps');
    const furnaceFeedbackIndex = furnaceHandoffResult.data.steps.findIndex(step => step.step_name.includes('反馈领取计划'));
    assert.ok(furnaceFeedbackIndex >= 0, 'core process requirements should extract feedback plan step');
    assert.match(furnaceHandoffResult.data.behavior_details[furnaceFeedbackIndex]?.execution_standard || '', /24小时内/, 'time limit in core process requirements should become execution standard');

    const savedData = await fetch(`${baseUrl}/api/data?sessionId=${encodeURIComponent(session.sessionId)}`, {
      headers: { 'x-session-id': session.sessionId }
    });
    assert.equal(savedData.status, 404, 'server must not keep session data after upload');

    const gbkBytes = Uint8Array.from([
      0xd6,0xc6,0xb6,0xc8,0xb1,0xe0,0xba,0xc5,0xa3,0xba,0x43,0x58,0x2d,0x5a,0x44,0x2d,0x47,0x42,0x4b,0x0a,
      0xd6,0xc6,0xb6,0xc8,0xc3,0xfb,0xb3,0xc6,0xa3,0xba,0xbf,0xcd,0xbb,0xa7,0xd7,0xca,0xc1,0xcf,0xb1,0xe4,0xb8,0xfc,0xb9,0xdc,0xc0,0xed,0xd6,0xc6,0xb6,0xc8,0x0a
    ]);
    const form = new FormData();
    form.append('sessionId', session.sessionId);
    form.append('file', new Blob([gbkBytes], { type: 'text/plain' }), 'gbk.txt');
    const upload = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'x-session-id': session.sessionId },
      body: form
    });
    const uploadJson = await upload.json();
    assert.equal(upload.ok, true, uploadJson.error || 'GBK upload failed');
    assert.equal(uploadJson.data.draft.document_title, '客户资料变更管理制度', 'GBK text should not become mojibake');

    const frontend = fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8');
    const visibleFrontend = frontend
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');
    for (const label of ['导入制度文件', '导入结构化文件', '导出结构化文件', '基本信息', '目的与范围', '术语定义', '流程步骤', '表单与记录']) {
      assert.ok(visibleFrontend.includes(label), `frontend missing business label: ${label}`);
    }
    for (const label of ['主数据对象', '跨部门流转']) {
      assert.equal(visibleFrontend.includes(label), false, `${label} should not be an editable page area in 3001`);
    }
    assert.ok(visibleFrontend.includes('Deepseek-V4-Pro 1M上下文模型辅助生成'), 'frontend should disclose the assisting Deepseek model');
    for (const forbidden of ['JSON', 'schema', 'document-structured-output', '草稿', '待确认', '识别失败', '识别统计', '结构块']) {
      assert.equal(visibleFrontend.includes(forbidden), false, `frontend visible text must not include ${forbidden}`);
    }
    for (const forbidden of ['一级分类', '二级分类', '三级流程', '流程名称', '管理主题', '业务事项', '流程范围', '流程动作', '动作内容']) {
      assert.equal(frontend.includes(forbidden), false, `frontend must not expose internal classification label: ${forbidden}`);
    }
    for (const label of ['业务行为', '触发场景', '前置条件', '执行标准']) {
      assert.ok(frontend.includes(label), `frontend should keep behavior detail field: ${label}`);
    }
    assert.ok(frontend.includes('readonlyMappingField'), 'process mapping classification should render as read-only reference values');
    assert.equal(frontend.includes("field('processes.0.l1_name'"), false, 'ability domain must not be manually editable');
    assert.equal(frontend.includes("field('processes.0.l2_name'"), false, 'business capability must not be manually editable');
    assert.ok(frontend.includes('--mdm-bg'), 'frontend should use the MDM visual palette');
    assert.ok(frontend.includes('fieldWarnings'), 'frontend should render field-level business warnings');
    assert.ok(frontend.includes('fields-table'), 'form table fields should be edited in a table');
    assert.ok(frontend.includes('activeFormRef'), 'frontend should track which form owns the field table being edited');
    assert.ok(frontend.includes('activeTableRef'), 'frontend should track which table owns the field headers being edited');
    assert.ok(frontend.includes('form-selector'), 'frontend should let users choose a specific form before editing its fields');
    assert.ok(frontend.includes('table-selector'), 'frontend should let users choose a specific table before editing its headers');
    assert.ok(frontend.includes('fieldsForActiveForm'), 'frontend should filter field rows to the selected form');
    assert.ok(frontend.includes('addTableForActiveForm'), 'frontend should let users add a new table under the selected form');
    assert.ok(frontend.includes('表头名称'), 'frontend should expose an editable table header name');
    assert.ok(frontend.includes('form_tables.${activeFields.tableIndex}.table_name'), 'table header name should bind to form_tables, not only the form summary');
    assert.ok(frontend.includes("table_name: isFirstTable ? (form.main_table_name || '') : ''"), 'new detail tables should start with an empty editable header instead of copying the main table name');
    assert.ok(frontend.includes('structureKindForTable(tableRef)'), 'new fields should inherit the selected table structure kind');
    assert.ok(frontend.includes('actorRoleField'), 'source role text should have a dedicated field');
    assert.ok(frontend.includes("function actorRoleField(index, label = '制度原文中的角色/岗位称谓')"), 'source role field should keep the business-facing default label');
    assert.ok(frontend.includes("field(`steps.${index}.actor_role`, label, { type: 'textarea' })"), 'source role text must remain free text instead of a roster selector');
    assert.ok(frontend.includes('花名册岗位候选（仅供核对）'), 'roster positions should only be shown as read-only candidate hints');
    assert.ok(frontend.includes('候选不会写回制度原文，也不会自动成为正式工作角色'), 'candidate hints must disclose that they do not confirm work roles');
    assert.ok(frontend.includes('当前参与岗位（流程草拟期）'), 'work role editor should allow a roster position during process drafting');
    assert.ok(frontend.includes('流程固化后再选择正式工作角色'), 'work role editor should explain the later formal role transition');
    assert.ok(frontend.includes('source_position_name'), 'position draft should be stored separately from the original role wording and formal role code');
    assert.ok(frontend.includes('processDepartmentForStep(index)'), 'candidate hints should use the current process department context');
    assert.ok(frontend.includes('formResponsibleRoleField(i)'), 'form and record role choices should read the current form department selected by the user');
    assert.ok(frontend.includes('shouldRerenderAfterValueChange(path)'), 'manual department changes should rebuild dependent role pickers immediately');
    assert.equal(frontend.includes("field(`forms.${i}.responsible_role`, '填写角色'"), false, 'form responsible role must not be a disconnected free-text field');
    assert.ok(frontend.includes("{ value: '全公司', label: '全公司' }"), 'execution role department choices should include all-company scope');
    assert.ok(frontend.includes('rolePickerField(`forms.${index}.responsible_role`'), 'the legacy roster picker should remain limited to form responsible roles');
    assert.ok(frontend.includes('firstInvalidConfirmedWorkRoleBinding'), 'export must hard-block invalid confirmed work role bindings');
    assert.ok(frontend.includes('fillSuggestionForPath'), 'empty cells should show business fill suggestions');
    assert.ok(frontend.includes('fieldSuggestions'), 'frontend should render DeepSeek suggestions before generic suggestions');
    assert.ok(frontend.includes("fetch('/api/suggestions'"), 'frontend should request DeepSeek suggestions after the page is already filled');
    assert.ok(frontend.includes('requestFieldSuggestions(file, requestId)'), 'frontend should start suggestion generation after import renders');
    assert.ok(frontend.includes('页面已可编辑，正在补充填报建议'), 'frontend should tell users the page can be edited while suggestions are prepared');
    assert.ok(frontend.includes('suggestionsForEmptyFields'), 'late suggestions should only attach to fields that are still empty');
    assert.ok(frontend.includes('deepSeekSuggestionForPath'), 'frontend should read DeepSeek suggestions by field path');
    assert.ok(frontend.includes('field-suggestion'), 'frontend should render fill suggestions next to empty fields');
    assert.ok(frontend.includes('suggestion-source'), 'frontend should render matched suggestion source text in a foldable block');
    assert.ok(frontend.includes("options.type !== 'select'"), 'frontend should not render fill suggestions under enum-like select fields');
    assert.ok(frontend.includes('completionPie'), 'frontend needs the red/green completion pie');
    assert.ok(frontend.includes('workStatus'), 'frontend should show a persistent import progress status');
    assert.ok(frontend.includes('beginImportWork'), 'document import should enter visible progress state immediately');
    assert.ok(frontend.includes('正在整理制度文件'), 'document import should tell users work has started');
    assert.ok(frontend.includes('正在生成填报建议'), 'long imports should tell users suggestions are being prepared');
    assert.ok(frontend.includes('setImportControlsDisabled(true)'), 'import controls should be disabled while a file is being processed');
    assert.ok(frontend.includes('busy-placeholder'), 'editor area should show a visible busy panel during import');
    assert.ok(frontend.includes('dropZone'), 'frontend needs drag-and-drop import');
    assert.ok(frontend.includes('dragover'), 'frontend needs dragover handling');
    assert.ok(frontend.includes('drop'), 'frontend needs drop handling');
    assert.ok(frontend.includes('window.addEventListener(eventName, handleFileDrag, true)'), 'file drag/drop should be captured at page level');
    assert.ok(frontend.includes('stopImmediatePropagation'), 'file drag/drop should stop extension/browser handlers when possible');
    assert.ok(frontend.includes('经营发展部'), 'frontend needs selectable departments');
    assert.ok(frontend.includes("{ value: '公司领导', label: '公司领导'"), 'frontend needs company leadership as a selectable execution department');
    assert.ok(frontend.includes('beforeunload'), 'frontend needs refresh/close warning');
    assert.ok(frontend.includes('importStructuredFile'), 'frontend needs structured file import');
    assert.ok(frontend.includes('document-structured-output-v2'), 'frontend should create and validate v2 structured files');
    assert.ok(frontend.includes('step_transitions'), 'frontend should keep decision branch transitions in the export model');
    assert.ok(frontend.includes('step_type'), 'frontend should distinguish action and decision nodes');
    assert.ok(frontend.includes('新增判断节点'), 'each process should let users add decision nodes');
    assert.ok(frontend.includes('新增判断分支'), 'each process should let users add decision branches');
    assert.ok(frontend.includes('toggleProcessCollapse'), 'frontend should support process-level collapse');
    assert.ok(frontend.includes('process-collapsed-summary'), 'collapsed processes should render a readable summary');
    assert.ok(frontend.includes('activeStepRefsByProcess'), 'large processes should keep one active step per process');
    assert.ok(frontend.includes('step-workbench'), 'steps should render in a master-detail workbench instead of one expanded form per row');
    assert.ok(frontend.includes('step-list-panel'), 'the workbench should provide a bounded step navigator');
    assert.ok(frontend.includes('stepRowsForCurrentFilter'), 'users should be able to filter the step navigator');
    assert.ok(frontend.includes('stepMissingFields'), 'the workbench should summarize each step completion state');
    assert.ok(frontend.includes('疑似重复'), 'duplicate step names should be flagged for human review');
    assert.ok(frontend.includes('下一项待补'), 'users should be able to jump to the next incomplete step');
    assert.ok(frontend.includes('⑦办理时限（如有）'), 'the step editor should expose the existing timing field');
    assert.ok(frontend.includes('remapStepIndexedMetadata'), 'moving or deleting a step should keep indexed evidence and suggestions aligned');
    assert.equal(frontend.includes('collapse.disabled = !processCoreComplete(processRef)'), false, 'users should be able to fold an incomplete process');
    assert.equal(frontend.includes('localStorage'), false, 'frontend must not restore from browser storage');
    assert.equal(frontend.includes('sessionStorage'), false, 'frontend must not restore from browser storage');
  });

  await withFakeAnthropicDeepSeek(async (deepSeekBaseUrl, requests) => {
    const claudeConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structured-output-claude-'));
    try {
      fs.writeFileSync(path.join(claudeConfigDir, 'settings.json'), JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'test-token',
          ANTHROPIC_BASE_URL: deepSeekBaseUrl,
          ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]'
        }
      }));
      await withService({
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        STRUCTURED_OUTPUT_DEEPSEEK_ENABLED: '',
        DEEPSEEK_API_KEY: '',
        DEEPSEEK_API_URL: '',
        DEEPSEEK_MODEL: '',
        STRUCTURED_OUTPUT_DEEPSEEK_CIRCUIT_OPEN_MS: '200',
        STRUCTURED_OUTPUT_DEEPSEEK_SUGGESTION_BATCH_SIZE: '1'
      }, async () => {
        const health = await (await fetch(`${baseUrl}/api/health`)).json();
        assert.equal(health.deepseek.configured, true, 'CC Switch Claude settings should configure DeepSeek assistance');
        assert.equal(JSON.stringify(health).includes('test-token'), false, 'health must not expose CC Switch token');

        const session = await postJson('/api/session', {});
        const ccSample = [
          '制度编号：CX-ZD-CC',
          '制度名称：客户资料变更管理制度',
          '目的',
          '规范客户资料变更申请。',
          '工作流程',
          '1. 销售内勤填写客户资料变更申请单。'
        ].join('\n');
        const result = await postTextUpload(session.sessionId, ccSample, 'cc-switch-deepseek.txt');
        assert.equal(Object.keys(result.fieldSuggestions).length, 0, 'CC Switch upload should not wait for DeepSeek suggestions');
        const suggestionResult = await postTextSuggestions(session.sessionId, ccSample, result.data, 'req_cc_suggestions');

        assert.equal(suggestionResult.fieldSuggestions['behavior_details.0.trigger_scene'].suggestion, '建议补充客户资料变更在什么情况下开始。');
        assert.ok(requests.length >= 1, 'DeepSeek field suggestions should use the fake server');
        assert.ok(requests.filter(item => !String(item.body.messages?.[0]?.content || '').includes('field_values')).length > 1, 'empty field suggestions should be requested in batches without dropping targets');
        assert.ok(requests.every(item => item.url === '/anthropic/v1/messages?beta=true'), 'CC Switch base URL should use Anthropic-compatible messages endpoint');
        assert.ok(requests.some(item => item.body.model === 'deepseek-v4-pro[1m]'), 'CC Switch model should be passed to DeepSeek');
        assert.equal(requests.some(item => Object.prototype.hasOwnProperty.call(item.body, 'response_format')), false, 'Anthropic-compatible requests should not use chat response_format');
      });
    } finally {
      fs.rmSync(claudeConfigDir, { recursive: true, force: true });
    }
  });

  await withSlowAnthropicDeepSeek(2500, async (deepSeekBaseUrl, requests) => {
    await withService({
      STRUCTURED_OUTPUT_DEEPSEEK_ENABLED: '1',
      DEEPSEEK_API_KEY: 'test-token',
      DEEPSEEK_API_URL: deepSeekBaseUrl,
      DEEPSEEK_MODEL: 'deepseek-v4-pro[1m]',
      STRUCTURED_OUTPUT_DEEPSEEK_API_STYLE: 'anthropic',
      STRUCTURED_OUTPUT_DEEPSEEK_SUGGESTION_TOTAL_MS: '1000',
      STRUCTURED_OUTPUT_DEEPSEEK_SUGGESTION_TIMEOUT_MS: '5000',
      STRUCTURED_OUTPUT_DEEPSEEK_SUGGESTION_MAX_RETRIES: '0',
      STRUCTURED_OUTPUT_DEEPSEEK_CIRCUIT_OPEN_MS: '200'
    }, async () => {
      const session = await postJson('/api/session', {});
      const slowSample = [
        '制度编号：CX-ZD-SLOW',
        '制度名称：客户资料变更管理制度',
        '目的',
        '规范客户资料变更申请。',
        '工作流程',
        '1. 销售内勤填写客户资料变更申请单。'
      ].join('\n');
      const result = await postTextUpload(session.sessionId, slowSample, 'slow-deepseek.txt');
      const startedAt = Date.now();
      const suggestionResult = await postTextSuggestions(session.sessionId, slowSample, result.data, 'req_slow_suggestions');
      const elapsedMs = Date.now() - startedAt;
      assert.equal(Object.keys(suggestionResult.fieldSuggestions).length, 0, 'slow DeepSeek suggestions should degrade to an empty object');
      assert.ok(elapsedMs < 2200, `slow DeepSeek suggestions should stop near the service budget, elapsed=${elapsedMs}`);
      assert.ok(requests.length >= 1, 'slow DeepSeek endpoint should have been attempted');
      const health = await (await fetch(`${baseUrl}/api/health`)).json();
      assert.equal(health.deepseek.lastFailureCategory, 'timeout');
      const healthText = JSON.stringify(health);
      for (const forbidden of ['客户资料变更', 'slow-deepseek.txt', 'test-token']) {
        assert.equal(healthText.includes(forbidden), false, `health must not expose ${forbidden}`);
      }
    });
  });

  const failureMock = JSON.stringify({
    field_values: [],
    suggestion_sequence: [
      { error: 'http_429' },
      {
        field_suggestions: [
          {
            path: 'behavior_details.0.trigger_scene',
            suggestion: '建议补充客户资料变更申请在什么情况下开始。',
            source_text: '客户资料变更的申请'
          }
        ]
      }
    ]
  });
  await withService({ STRUCTURED_OUTPUT_MOCK_DEEPSEEK: failureMock, STRUCTURED_OUTPUT_DEEPSEEK_CIRCUIT_OPEN_MS: '200' }, async () => {
    const failureSession = await postJson('/api/session', {});
    const failureSample = [
      '制度编号：CX-ZD-FAIL',
      '制度名称：客户资料变更管理制度',
      '归口部门：经营发展部',
      '目的',
      '客户资料变更的申请、审核和归档。',
      '工作流程',
      '1. 销售内勤填写客户资料变更申请单。'
    ].join('\n');
    const uploadedFailure = await postTextUpload(failureSession.sessionId, failureSample, 'deepseek-failure.txt');
    assert.equal(Object.keys(uploadedFailure.fieldSuggestions).length, 0, 'upload should not wait for failing DeepSeek suggestions');
    const firstFailure = await postTextSuggestions(failureSession.sessionId, failureSample, uploadedFailure.data, 'req_failure_1');
    assert.ok(firstFailure.fieldSuggestions, 'DeepSeek failure should still return an empty suggestions object');
    assert.equal(Object.keys(firstFailure.fieldSuggestions).length, 0, 'rate-limited suggestions should degrade to no DeepSeek suggestions');
    let failureHealth = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(failureHealth.deepseek.available, false, 'health should record recent DeepSeek failure');
    assert.equal(failureHealth.deepseek.lastFailureCategory, 'rate_limited');
    const healthText = JSON.stringify(failureHealth);
    for (const forbidden of ['客户资料变更', 'deepseek-failure.txt', '建议补充', 'Bearer']) {
      assert.equal(healthText.includes(forbidden), false, `health must not expose ${forbidden}`);
    }
    await postTextSuggestions(failureSession.sessionId, failureSample, uploadedFailure.data, 'req_failure_2');
    failureHealth = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(failureHealth.deepseek.lastFailureCategory, 'circuit_open', 'immediate retry should be guarded by circuit breaker');
    await delay(240);
    const recovered = await postTextSuggestions(failureSession.sessionId, failureSample, uploadedFailure.data, 'req_failure_3');
    assert.equal(recovered.fieldSuggestions['behavior_details.0.trigger_scene'].suggestion, '建议补充客户资料变更申请在什么情况下开始。');
    failureHealth = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(failureHealth.deepseek.available, true, 'health should recover after later successful suggestion call');
    assert.equal(failureHealth.deepseek.lastFailureCategory, null);
  });

  console.log('structured output service contract checks passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
