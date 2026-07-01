const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const processDesignRouter = require('../server/routes/processDesignMysql');
const { mdmMysqlSchemaSql } = require('../server/mysqlSchema');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function sessionForUser(key) {
  const sessions = {
    submitter: { userId: 10, userRole: 'submitter', userName: '经营填报人', departmentId: 1 },
    targetDept: { userId: 30, userRole: 'submitter', userName: '工程承接人', departmentId: 2 },
    reviewer: { userId: 20, userRole: 'reviewer', userName: '流程审核人', departmentId: 1 },
    admin: { userId: 99, userRole: 'admin', userName: '流程管理员', departmentId: 2 }
  };
  return sessions[key] || sessions.submitter;
}

async function request(baseUrl, userKey, routePath, options = {}) {
  const headers = {
    'X-Test-User': userKey,
    ...(options.body ? { 'Content-Type': 'application/json' } : {})
  };
  const res = await fetch(`${baseUrl}${routePath}`, { ...options, headers });
  const body = await res.json();
  return { res, body };
}

function makeFakeRepository() {
  const state = {
    draft: null,
    documentProfile: null,
    terms: [],
    processes: [],
    steps: [],
    behaviorDetails: new Map(),
    handoffs: [],
    form: null,
    table: null,
    tableField: null,
    field: null,
    evidence: null,
    reviewTask: null,
    version: null
  };
  const calls = [];
  function outcome() {
    return {
      formed: '已形成 1 条流程草稿',
      current: '当前内容可以保存草稿或提交部门内审',
      missing: [],
      next: '提交审核或发布',
      counts: {
        steps: state.steps.length,
        processes: state.processes.length,
        forms: state.form ? 1 : 0,
        fields: (state.field ? 1 : 0) + (state.tableField ? 1 : 0),
        evidence: state.evidence ? 1 : 0,
        publishableEvidence: state.evidence ? 1 : 0,
        risks: 0
      }
    };
  }
  return {
    calls,
    async summary() {
      calls.push('summary');
      return {
        summary: { totalDrafts: state.draft ? 1 : 0, publishedVersions: state.version ? 1 : 0, byStatus: state.draft ? { [state.draft.status]: 1 } : {} },
        drafts: state.draft ? [{ id: state.draft.id, process_name: state.draft.process_name, status: state.draft.status }] : []
      };
    },
    async departmentExists(departmentId) {
      calls.push('departmentExists');
      return [1, 2].includes(Number(departmentId));
    },
    async createDraft(body, actorUserId, targetDeptId) {
      calls.push('createDraft');
      state.draft = {
        id: 101,
        process_name: body.process_name,
        reason: body.reason,
        basis_type: body.basis_type,
        basis_description: body.basis_description,
        involves_other_departments: Boolean(body.involves_other_departments),
        related_departments: body.related_departments || [],
        related_departments_json: JSON.stringify(body.related_departments || []),
        department_id: targetDeptId,
        department_name: '经营发展部',
        l1_status: 'unclassified',
        l2_status: 'unclassified',
        status: 'draft',
        created_by: actorUserId
      };
      return { ...state.draft, outcome: outcome() };
    },
    async getDraft(id) {
      calls.push(`getDraft:${id}`);
      return Number(id) === 101 ? state.draft : null;
    },
    async getDraftByStep() {
      calls.push('getDraftByStep');
      return state.draft;
    },
    async getDraftByHandoff() {
      calls.push('getDraftByHandoff');
      return state.draft;
    },
    async getDraftByForm() {
      calls.push('getDraftByForm');
      return state.draft;
    },
    async getDraftByFormTable() {
      calls.push('getDraftByFormTable');
      return state.draft;
    },
    async getDraftByFormTableField() {
      calls.push('getDraftByFormTableField');
      return state.draft;
    },
    async getDraftByField() {
      calls.push('getDraftByField');
      return state.draft;
    },
    async getDraftByEvidence() {
      calls.push('getDraftByEvidence');
      return state.draft;
    },
    async detail() {
      calls.push('detail');
      return {
        draft: state.draft,
        documentProfile: state.documentProfile,
        terms: state.terms,
        processes: state.processes,
        steps: state.steps.map(step => ({
          ...step,
          behaviorDetail: state.behaviorDetails.get(step.id) || null,
          handoffs: state.handoffs.filter(handoff => handoff.step_id === step.id)
        })),
        forms: state.form ? [{ ...state.form, fields: state.field ? [state.field] : [], tables: state.table ? [{ ...state.table, fields: state.tableField ? [state.tableField] : [] }] : [] }] : [],
        evidence: state.evidence ? [state.evidence] : [],
        risks: [],
        reviewTasks: state.reviewTask ? [state.reviewTask] : [],
        events: [],
        outcome: outcome()
      };
    },
    async updateDraft(draft, body) {
      calls.push('updateDraft');
      state.draft = { ...draft, ...body };
      return { ...state.draft, outcome: outcome() };
    },
    async saveDocumentProfile(draft, body, actorUserId) {
      calls.push('saveDocumentProfile');
      state.documentProfile = {
        id: 151,
        draft_id: draft.id,
        document_title: body.document_title,
        document_no: body.document_no || null,
        purpose: body.purpose,
        scope: body.scope,
        inheritance_relation: body.inheritance_relation,
        created_by: actorUserId
      };
      return state.documentProfile;
    },
    async createTerm(draft, body, actorUserId) {
      calls.push('createTerm');
      const term = {
        id: 161,
        draft_id: draft.id,
        term_name: body.term_name,
        definition: body.definition,
        applies_to: body.applies_to || null,
        created_by: actorUserId
      };
      state.terms.push(term);
      return term;
    },
    async createProcess(draft, body, actorUserId) {
      calls.push('createProcess');
      const process = {
        id: 181 + state.processes.length,
        draft_id: draft.id,
        l1_name: body.l1_name,
        l2_name: body.l2_name,
        l3_name: body.l3_name,
        process_code: body.process_code || null,
        process_type: body.process_type || 'new',
        created_by: actorUserId
      };
      state.processes.push(process);
      return process;
    },
    async createStep(draft, body, actorUserId) {
      calls.push('createStep');
      const step = { id: 201 + state.steps.length, draft_id: draft.id, process_id: Number(body.process_id), step_name: body.step_name, output_result: body.output_result || null, created_by: actorUserId };
      state.steps.push(step);
      return step;
    },
    async updateStep(draft, stepId, body) {
      calls.push('updateStep');
      const index = state.steps.findIndex(step => Number(step.id) === Number(stepId));
      state.steps[index] = { ...state.steps[index], id: stepId, ...body };
      return state.steps[index];
    },
    async saveBehaviorDetail(draft, stepId, body, actorUserId) {
      calls.push('saveBehaviorDetail');
      const detail = {
        id: 251,
        step_id: stepId,
        precondition: body.precondition,
        trigger_scene: body.trigger_scene,
        execution_standard: body.execution_standard,
        delivery_object: body.delivery_object,
        requires_approval: Boolean(body.requires_approval),
        is_cross_department: Boolean(body.is_cross_department),
        created_by: actorUserId
      };
      state.behaviorDetails.set(Number(stepId), detail);
      return detail;
    },
    async createHandoff(draft, stepId, body, actorUserId) {
      calls.push('createHandoff');
      const handoff = {
        id: 261 + state.handoffs.length,
        step_id: stepId,
        target_department: body.target_department,
        target_process_code: null,
        target_process_name: null,
        target_behavior_code: null,
        target_behavior_name: null,
        handoff_standard: body.handoff_standard || null,
        status: 'pending_return',
        created_by: actorUserId
      };
      state.handoffs.push(handoff);
      return handoff;
    },
    async getHandoff(id) {
      calls.push('getHandoff');
      return state.handoffs.find(handoff => Number(handoff.id) === Number(id)) || null;
    },
    async acceptHandoffReturn(draft, handoffId, body, actorUserId) {
      calls.push('acceptHandoffReturn');
      const index = state.handoffs.findIndex(handoff => Number(handoff.id) === Number(handoffId));
      state.handoffs[index] = {
        ...state.handoffs[index],
        target_process_code: body.target_process_code,
        target_process_name: body.target_process_name,
        target_behavior_code: body.target_behavior_code,
        target_behavior_name: body.target_behavior_name,
        status: 'returned',
        returned_by: actorUserId
      };
      return state.handoffs[index];
    },
    async createForm(draft, body, actorUserId) {
      calls.push('createForm');
      state.form = { id: 301, draft_id: draft.id, form_name: body.form_name, archive_rule: body.archive_rule || null, created_by: actorUserId };
      return state.form;
    },
    async updateForm(draft, formId, body) {
      calls.push('updateForm');
      state.form = { ...state.form, id: formId, ...body };
      return state.form;
    },
    async createFormTable(draft, formId, body, actorUserId) {
      calls.push('createFormTable');
      state.table = {
        id: 351,
        form_id: formId,
        table_kind: body.table_kind,
        table_no: body.table_kind === 'detail' ? 'MX-001' : 'ZB-001',
        table_name: body.table_name,
        description: body.description || null,
        created_by: actorUserId
      };
      return state.table;
    },
    async createFormTableField(draft, tableId, body, actorUserId) {
      calls.push('createFormTableField');
      state.tableField = {
        id: 361,
        form_table_id: tableId,
        field_name: body.field_name,
        field_no: 'F-001',
        field_type: body.field_type,
        required: Boolean(body.required),
        created_by: actorUserId
      };
      return state.tableField;
    },
    async createField(draft, formId, body, actorUserId) {
      calls.push('createField');
      state.field = { id: 401, form_id: formId, field_name_cn: body.field_name_cn, data_object: body.data_object || null, status: 'suggested', created_by: actorUserId };
      return state.field;
    },
    async updateField(draft, fieldId, body) {
      calls.push('updateField');
      state.field = { ...state.field, id: fieldId, ...body };
      return state.field;
    },
    async createEvidence(draft, body, actorUserId) {
      calls.push('createEvidence');
      state.evidence = { id: 501, draft_id: draft.id, evidence_type: body.evidence_type, description: body.description, maturity: '可支撑发布', created_by: actorUserId };
      return state.evidence;
    },
    async updateEvidence(draft, evidenceId, body) {
      calls.push('updateEvidence');
      state.evidence = { ...state.evidence, id: evidenceId, ...body };
      return state.evidence;
    },
    async buildRisks() {
      calls.push('buildRisks');
      return [];
    },
    async outcomeForDraft() {
      calls.push('outcomeForDraft');
      return outcome();
    },
    async getCounts() {
      calls.push('getCounts');
      return outcome().counts;
    },
    async submitDraft(draft) {
      calls.push('submitDraft');
      state.draft = { ...draft, status: 'submitted' };
      state.reviewTask = { id: 601, draft_id: draft.id, status: 'pending', task_type: 'department_review' };
      return { draft: state.draft, reviewTask: state.reviewTask, outcome: outcome() };
    },
    async getReviewTask(id) {
      calls.push('getReviewTask');
      return Number(id) === 601 ? state.reviewTask : null;
    },
    async decideReviewTask(task, decision) {
      calls.push('decideReviewTask');
      state.reviewTask = { ...task, status: decision === 'approve' ? 'approved' : decision };
      state.draft = { ...state.draft, status: state.reviewTask.status };
      return { draft: state.draft, reviewTask: state.reviewTask };
    },
    async publishDraft(draft) {
      calls.push('publishDraft');
      state.version = { id: 701, draft_id: draft.id, version_no: 'PD-101-v1' };
      state.draft = { ...draft, status: 'published' };
      return { draft: state.draft, version: state.version, outcome: outcome() };
    },
    async markdownForDraft() {
      calls.push('markdownForDraft');
      return {
        filename: '客户需求变更处理.md',
        markdown: '# 客户需求变更处理\n\n## 目的\n统一客户需求变更入口\n\n## 附表结构\n- 主表：需求变更主表'
      };
    }
  };
}

async function main() {
  const routeSource = fs.readFileSync(path.join(__dirname, '../server/routes/processDesignMysql.js'), 'utf8');
  assert.ok(!routeSource.includes("require('../db')"), 'process design MySQL route must not load server/db.js');
  assert.ok(!routeSource.includes('better-sqlite3'), 'process design MySQL route must not use better-sqlite3');
  const indexSource = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  assert.ok(indexSource.includes("process.env.PROCESS_GOVERNANCE_READ_MODEL === 'mysql' ? 'processDesignMysql' : 'processDesign'"), 'server must select MySQL process design route under MySQL process governance mode');
  assert.ok(mdmMysqlSchemaSql().includes('CREATE TABLE IF NOT EXISTS process_design_drafts'), 'MySQL schema must include process design drafts');
  assert.ok(mdmMysqlSchemaSql().includes('CREATE TABLE IF NOT EXISTS process_design_versions'), 'MySQL schema must include process design versions');
  [
    'process_design_document_profiles',
    'process_design_processes',
    'process_design_terms',
    'process_design_behavior_details',
    'process_design_cross_dept_handoffs',
    'process_design_form_tables',
    'process_design_form_table_fields'
  ].forEach(tableName => {
    assert.ok(mdmMysqlSchemaSql().includes(`CREATE TABLE IF NOT EXISTS ${tableName}`), `MySQL schema must include ${tableName}`);
  });

  const permissionsByUser = new Map([
    [10, ['process_governance:submit']],
    [30, ['process_governance:submit']],
    [20, ['process_governance:review']],
    [99, ['admin:access']]
  ]);
  const rolesByUser = new Map([
    [10, [{ code: 'submitter' }, { code: 'business_contact' }]],
    [30, [{ code: 'submitter' }, { code: 'business_contact' }]],
    [20, [{ code: 'reviewer' }, { code: 'data_quality' }]],
    [99, [{ code: 'admin' }, { code: 'it_lead' }]]
  ]);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      return { permSet: new Set(permissionsByUser.get(userId) || []), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      return rolesByUser.get(userId) || [{ code: legacyRole }];
    },
    async getDepartmentById(departmentId) {
      return { id: departmentId, name: departmentId === 1 ? '经营发展部' : '工程技术部' };
    },
    async getUserById(userId) {
      return { id: userId, name: `用户${userId}` };
    }
  }));

  const fakeRepo = makeFakeRepository();
  processDesignRouter.setProcessDesignRepositoryFactory(() => fakeRepo);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = sessionForUser(req.get('X-Test-User'));
    next();
  });
  app.use('/api/process-design', processDesignRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const summary = await request(baseUrl, 'submitter', '/api/process-design/summary');
    assert.strictEqual(summary.res.status, 200);

    const draft = await request(baseUrl, 'submitter', '/api/process-design/drafts', {
      method: 'POST',
      body: JSON.stringify({
        process_name: '客户需求变更处理',
        reason: '业务需要形成统一入口',
        basis_type: '会议 / 访谈',
        basis_description: '项目例会提出',
        involves_other_departments: true,
        related_departments: ['工程技术部']
      })
    });
    assert.strictEqual(draft.res.status, 201, JSON.stringify(draft.body));
    assert.strictEqual(draft.body.id, 101);

    const detail = await request(baseUrl, 'submitter', '/api/process-design/drafts/101');
    assert.strictEqual(detail.res.status, 200);

    const classification = await request(baseUrl, 'submitter', '/api/process-design/drafts/101', {
      method: 'PUT',
      body: JSON.stringify({ l1_name: '经营管理', l1_status: 'confirmed', l2_name: '客户管理', l2_status: 'confirmed', l3_name: '客户需求变更处理' })
    });
    assert.strictEqual(classification.res.status, 200, JSON.stringify(classification.body));

    const profile = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/document-profile', {
      method: 'PUT',
      body: JSON.stringify({
        document_title: '客户需求变更管理制度',
        document_no: 'CX-ZD-001',
        purpose: '统一客户需求变更入口',
        scope: '适用于经营发展部接收的客户需求变更',
        inheritance_relation: '承接客户资料管理办法'
      })
    });
    assert.strictEqual(profile.res.status, 200, JSON.stringify(profile.body));
    assert.strictEqual(profile.body.purpose, '统一客户需求变更入口');

    const term = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/terms', {
      method: 'POST',
      body: JSON.stringify({ term_name: '需求变更', definition: '客户对已确认需求提出的调整', applies_to: '客户需求变更处理' })
    });
    assert.strictEqual(term.res.status, 201, JSON.stringify(term.body));

    const processA = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/processes', {
      method: 'POST',
      body: JSON.stringify({ l1_name: '经营管理', l2_name: '客户管理', l3_name: '客户需求变更处理', process_type: 'new' })
    });
    assert.strictEqual(processA.res.status, 201, JSON.stringify(processA.body));
    assert.strictEqual(processA.body.id, 181);

    const processB = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/processes', {
      method: 'POST',
      body: JSON.stringify({ l1_name: '工程管理', l2_name: '技术评审', l3_name: '技术影响评估', process_type: 'handoff' })
    });
    assert.strictEqual(processB.res.status, 201, JSON.stringify(processB.body));

    const stepWithoutProcess = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/steps', {
      method: 'POST',
      body: JSON.stringify({ step_name: '未归属流程的行为', output_result: '不应保存' })
    });
    assert.strictEqual(stepWithoutProcess.res.status, 422);
    assert.ok(JSON.stringify(stepWithoutProcess.body).includes('process_id'), 'behavior must belong to one process');

    const step = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/steps', {
      method: 'POST',
      body: JSON.stringify({ process_id: 181, step_name: '登记变更需求', output_result: '形成需求变更记录' })
    });
    assert.strictEqual(step.res.status, 201);
    assert.strictEqual(step.body.process_id, 181);

    const stepUpdate = await request(baseUrl, 'submitter', '/api/process-design/steps/201', {
      method: 'PUT',
      body: JSON.stringify({ actor_role: '业务联系人' })
    });
    assert.strictEqual(stepUpdate.res.status, 200);

    const behaviorDetail = await request(baseUrl, 'submitter', '/api/process-design/steps/201/behavior-detail', {
      method: 'PUT',
      body: JSON.stringify({
        precondition: '客户已提出变更诉求',
        trigger_scene: '客户电话、邮件或会议提出变更',
        execution_standard: '2 个工作日内登记并确认影响范围',
        delivery_object: '需求变更记录',
        requires_approval: true,
        approval_note: '部门负责人确认后流转',
        is_cross_department: true
      })
    });
    assert.strictEqual(behaviorDetail.res.status, 200, JSON.stringify(behaviorDetail.body));
    assert.strictEqual(behaviorDetail.body.delivery_object, '需求变更记录');

    const forbiddenHandoffManualResult = await request(baseUrl, 'submitter', '/api/process-design/steps/201/cross-dept-handoffs', {
      method: 'POST',
      body: JSON.stringify({
        target_department: '工程技术部',
        target_process_code: 'L3-ENG-001',
        target_process_name: '技术方案评审',
        target_behavior_code: 'A1-ENG-001',
        target_behavior_name: '评估技术影响'
      })
    });
    assert.strictEqual(forbiddenHandoffManualResult.res.status, 422, JSON.stringify(forbiddenHandoffManualResult.body));
    assert.ok(JSON.stringify(forbiddenHandoffManualResult.body).includes('回写'), 'source department must not edit returned handoff result');

    const handoff = await request(baseUrl, 'submitter', '/api/process-design/steps/201/cross-dept-handoffs', {
      method: 'POST',
      body: JSON.stringify({
        target_department: '工程技术部',
        handoff_standard: '提供需求变更记录和影响范围说明'
      })
    });
    assert.strictEqual(handoff.res.status, 201, JSON.stringify(handoff.body));
    assert.strictEqual(handoff.body.target_process_code, null);
    assert.strictEqual(handoff.body.status, 'pending_return');

    const sourceCannotReturn = await request(baseUrl, 'submitter', '/api/process-design/cross-dept-handoffs/261/returned-result', {
      method: 'PUT',
      body: JSON.stringify({
        target_process_code: 'L3-ENG-001',
        target_process_name: '技术方案评审',
        target_behavior_code: 'A1-ENG-001',
        target_behavior_name: '评估技术影响'
      })
    });
    assert.strictEqual(sourceCannotReturn.res.status, 403, JSON.stringify(sourceCannotReturn.body));

    const returnedHandoff = await request(baseUrl, 'targetDept', '/api/process-design/cross-dept-handoffs/261/returned-result', {
      method: 'PUT',
      body: JSON.stringify({
        target_process_code: 'L3-ENG-001',
        target_process_name: '技术方案评审',
        target_behavior_code: 'A1-ENG-001',
        target_behavior_name: '评估技术影响'
      })
    });
    assert.strictEqual(returnedHandoff.res.status, 200, JSON.stringify(returnedHandoff.body));
    assert.strictEqual(returnedHandoff.body.target_process_name, '技术方案评审');

    const form = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/forms', {
      method: 'POST',
      body: JSON.stringify({ form_name: '需求变更单', archive_rule: '按项目归档' })
    });
    assert.strictEqual(form.res.status, 201);

    const formUpdate = await request(baseUrl, 'submitter', '/api/process-design/forms/301', {
      method: 'PUT',
      body: JSON.stringify({ status: 'submitted' })
    });
    assert.strictEqual(formUpdate.res.status, 200);

    const manualTableNo = await request(baseUrl, 'submitter', '/api/process-design/forms/301/tables', {
      method: 'POST',
      body: JSON.stringify({ table_kind: 'main', table_no: 'ZB-001', table_name: '需求变更主表', description: '记录变更主信息' })
    });
    assert.strictEqual(manualTableNo.res.status, 422, JSON.stringify(manualTableNo.body));

    const table = await request(baseUrl, 'submitter', '/api/process-design/forms/301/tables', {
      method: 'POST',
      body: JSON.stringify({ table_kind: 'main', table_name: '需求变更主表', description: '记录变更主信息' })
    });
    assert.strictEqual(table.res.status, 201, JSON.stringify(table.body));
    assert.strictEqual(table.body.table_name, '需求变更主表');
    assert.strictEqual(table.body.table_no, 'ZB-001');

    const manualFieldNo = await request(baseUrl, 'submitter', '/api/process-design/form-tables/351/fields', {
      method: 'POST',
      body: JSON.stringify({ field_no: 'F-001', field_name: '客户名称', field_type: '文本', required: true, description: '填写客户名称' })
    });
    assert.strictEqual(manualFieldNo.res.status, 422, JSON.stringify(manualFieldNo.body));

    const invalidFieldType = await request(baseUrl, 'submitter', '/api/process-design/form-tables/351/fields', {
      method: 'POST',
      body: JSON.stringify({ field_name: '客户名称', field_type: '随便写', required: true, description: '填写客户名称' })
    });
    assert.strictEqual(invalidFieldType.res.status, 422, JSON.stringify(invalidFieldType.body));

    const whitespaceField = await request(baseUrl, 'submitter', '/api/process-design/form-tables/351/fields', {
      method: 'POST',
      body: JSON.stringify({ field_name: '客户 名称', field_type: '文本', required: true, description: '填写客户名称' })
    });
    assert.strictEqual(whitespaceField.res.status, 422, JSON.stringify(whitespaceField.body));

    const tableField = await request(baseUrl, 'submitter', '/api/process-design/form-tables/351/fields', {
      method: 'POST',
      body: JSON.stringify({ field_name: '客户名称', field_type: '文本', required: true, description: '填写客户名称' })
    });
    assert.strictEqual(tableField.res.status, 201, JSON.stringify(tableField.body));
    assert.strictEqual(tableField.body.field_no, 'F-001');

    const field = await request(baseUrl, 'submitter', '/api/process-design/forms/301/fields', {
      method: 'POST',
      body: JSON.stringify({ field_name_cn: '变更原因', data_object: '客户需求', field_type: '文本' })
    });
    assert.strictEqual(field.res.status, 201);

    const invalidEvidenceType = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/evidence', {
      method: 'POST',
      body: JSON.stringify({ evidence_type: '自由输入类型', description: '首次周例会确认' })
    });
    assert.strictEqual(invalidEvidenceType.res.status, 422, JSON.stringify(invalidEvidenceType.body));

    const fieldUpdate = await request(baseUrl, 'submitter', '/api/process-design/form-fields/401', {
      method: 'PUT',
      body: JSON.stringify({ status: 'business_confirmed' })
    });
    assert.strictEqual(fieldUpdate.res.status, 200);

    const evidence = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/evidence', {
      method: 'POST',
      body: JSON.stringify({ evidence_type: '会议纪要', description: '首次周例会确认', source_name: '周例会纪要', source_anchor: '第3项', confirmer: '业务联系人' })
    });
    assert.strictEqual(evidence.res.status, 201);

    const evidenceUpdate = await request(baseUrl, 'submitter', '/api/process-design/evidence/501', {
      method: 'PUT',
      body: JSON.stringify({ record_time: '2026-06-30' })
    });
    assert.strictEqual(evidenceUpdate.res.status, 200);

    const risks = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/risks');
    assert.strictEqual(risks.res.status, 200);

    const detailAfterStructure = await request(baseUrl, 'submitter', '/api/process-design/drafts/101');
    assert.strictEqual(detailAfterStructure.res.status, 200);
    assert.strictEqual(detailAfterStructure.body.documentProfile.document_title, '客户需求变更管理制度');
    assert.strictEqual(detailAfterStructure.body.terms[0].term_name, '需求变更');
    assert.strictEqual(detailAfterStructure.body.processes.length, 2);
    assert.strictEqual(detailAfterStructure.body.steps[0].process_id, 181);
    assert.strictEqual(detailAfterStructure.body.steps[0].behaviorDetail.execution_standard, '2 个工作日内登记并确认影响范围');
    assert.strictEqual(detailAfterStructure.body.steps[0].handoffs[0].target_process_code, 'L3-ENG-001');
    assert.strictEqual(detailAfterStructure.body.forms[0].tables[0].fields[0].field_name, '客户名称');

    const markdown = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/markdown');
    assert.strictEqual(markdown.res.status, 200);
    assert.ok(String(markdown.body.markdown || '').includes('## 目的'), 'markdown export should include purpose section');

    const preview = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/outcome-preview');
    assert.strictEqual(preview.res.status, 200);

    const submit = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/submit', {
      method: 'POST',
      body: JSON.stringify({ note: '请审核' })
    });
    assert.strictEqual(submit.res.status, 200);
    assert.strictEqual(submit.body.reviewTask.id, 601);

    const decision = await request(baseUrl, 'reviewer', '/api/process-design/review-tasks/601/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve', note: '同意' })
    });
    assert.strictEqual(decision.res.status, 200);

    const publish = await request(baseUrl, 'reviewer', '/api/process-design/drafts/101/publish', {
      method: 'POST',
      body: JSON.stringify({ note: '发布' })
    });
    assert.strictEqual(publish.res.status, 200);
    assert.strictEqual(publish.body.version.version_no, 'PD-101-v1');

    [
      'createDraft',
      'saveDocumentProfile',
      'createTerm',
      'createProcess',
      'createStep',
      'saveBehaviorDetail',
      'createHandoff',
      'acceptHandoffReturn',
      'createForm',
      'createFormTable',
      'createFormTableField',
      'createField',
      'createEvidence',
      'markdownForDraft',
      'submitDraft',
      'decideReviewTask',
      'publishDraft'
    ].forEach(callName => {
      assert.ok(fakeRepo.calls.includes(callName), `expected ${callName} to be called`);
    });

    console.log('Process design MySQL API test passed');
  } finally {
    await closeServer(server);
    processDesignRouter.resetProcessDesignRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
