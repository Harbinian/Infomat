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
const { BASE_PERMISSIONS, ROLE_GUIDES } = require('../server/roleDefinitions');

const VERIFIED_EVIDENCE_MESSAGE = '发布需至少 1 条已核验(verified)证据。';

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
    step: null,
    form: null,
    field: null,
    evidence: null,
    reviewTask: null,
    version: null,
    events: []
  };
  const calls = [];
  function outcome() {
    return {
      formed: '已形成 1 条流程草稿',
      current: '当前内容可以保存草稿或提交部门内审',
      missing: [],
      next: '提交审核或发布',
      counts: {
        steps: state.step ? 1 : 0,
        forms: state.form ? 1 : 0,
        fields: state.field ? 1 : 0,
        evidence: state.evidence ? 1 : 0,
        publishableEvidence: state.evidence && state.evidence.status === 'verified' ? 1 : 0,
        verifiedEvidence: state.evidence && state.evidence.status === 'verified' ? 1 : 0,
        risks: 0
      }
    };
  }
  function publishable() {
    return Boolean(
      state.draft &&
      state.draft.l1_status === 'confirmed' &&
      state.draft.l2_status === 'confirmed' &&
      state.draft.l3_name &&
      state.step &&
      state.evidence &&
      state.evidence.status === 'verified'
    );
  }
  return {
    state,
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
    async getDraftByForm() {
      calls.push('getDraftByForm');
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
        steps: state.step ? [state.step] : [],
        forms: state.form ? [{ ...state.form, fields: state.field ? [state.field] : [] }] : [],
        evidence: state.evidence ? [state.evidence] : [],
        risks: [],
        reviewTasks: state.reviewTask ? [state.reviewTask] : [],
        events: state.events,
        outcome: outcome(),
        publishable: publishable()
      };
    },
    async updateDraft(draft, body) {
      calls.push('updateDraft');
      state.draft = { ...draft, ...body };
      return { ...state.draft, outcome: outcome() };
    },
    async createStep(draft, body, actorUserId) {
      calls.push('createStep');
      state.step = { id: 201, draft_id: draft.id, step_name: body.step_name, output_result: body.output_result || null, created_by: actorUserId };
      return state.step;
    },
    async updateStep(draft, stepId, body) {
      calls.push('updateStep');
      state.step = { ...state.step, id: stepId, ...body };
      return state.step;
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
      state.evidence = { id: 501, draft_id: draft.id, evidence_type: body.evidence_type, description: body.description, maturity: '可支撑发布', status: 'pending_review', created_by: actorUserId };
      return state.evidence;
    },
    async updateEvidence(draft, evidenceId, body) {
      calls.push('updateEvidence');
      state.evidence = { ...state.evidence, id: evidenceId, ...body };
      if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        state.events.push({
          event_type: 'evidence_status_change',
          payload: { from_status: 'pending_review', to_status: body.status }
        });
      }
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
      if (!publishable()) {
        const error = new Error(VERIFIED_EVIDENCE_MESSAGE);
        error.statusCode = 409;
        error.payload = { error: '校验失败', details: [VERIFIED_EVIDENCE_MESSAGE] };
        throw error;
      }
      state.version = { id: 701, draft_id: draft.id, version_no: 'PD-101-v1' };
      state.draft = { ...draft, status: 'published' };
      state.events.push({
        event_type: 'publish',
        payload: { verified_evidence_count: 1, l1l2l3_confirmed: true, step_count: 1 }
      });
      return { draft: state.draft, version: state.version, outcome: outcome() };
    }
  };
}

function makeValidationPool({ steps = [], forms = [], fieldsByForm = {}, evidence = [] } = {}) {
  return {
    async execute(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM process_design_steps WHERE draft_id=?')) return [steps, undefined];
      if (normalized.includes('FROM process_design_forms WHERE draft_id=?')) return [forms, undefined];
      if (normalized.includes('FROM process_design_form_fields WHERE form_id=?')) return [fieldsByForm[Number(params[0])] || [], undefined];
      if (normalized.includes('FROM process_design_evidence WHERE draft_id=?')) return [evidence, undefined];
      throw new Error(`Unhandled validation SQL: ${normalized}`);
    }
  };
}

function makePublishValidationFixture(evidence) {
  return makeValidationPool({
    steps: [{ id: 1, output_result: '形成记录' }],
    forms: [{ id: 2, archive_rule: '按项目归档' }],
    fieldsByForm: {
      2: [{ id: 3, field_type: '文本', data_object: '客户需求' }]
    },
    evidence
  });
}

function makeEvidenceStatusMigrationPool() {
  const state = {
    migrations: new Set(),
    rows: [
      { id: 1, maturity: '可支撑发布', status: 'pending_review' },
      { id: 2, maturity: '发布前需补', status: 'pending_review' },
      { id: 3, maturity: '可支撑发布', status: 'source_missing' }
    ],
    backfillRuns: 0
  };
  return {
    state,
    async execute(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('ALTER TABLE process_design_evidence ADD COLUMN status')) return [[], undefined];
      if (normalized.startsWith('SELECT migration_key FROM schema_migrations WHERE migration_key=?')) {
        return [state.migrations.has(params[0]) ? [{ migration_key: params[0] }] : [], undefined];
      }
      if (normalized.startsWith("UPDATE process_design_evidence SET status='verified'")) {
        state.backfillRuns += 1;
        state.rows.forEach(row => {
          if (row.status === 'pending_review' && row.maturity === '可支撑发布') row.status = 'verified';
        });
        return [{ affectedRows: 1 }, undefined];
      }
      if (normalized.startsWith('INSERT INTO schema_migrations')) {
        state.migrations.add(params[0]);
        return [{ affectedRows: 1 }, undefined];
      }
      throw new Error(`Unhandled migration SQL: ${normalized}`);
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
  assert.ok(
    mdmMysqlSchemaSql().includes("status ENUM('verified','pending_review','source_missing','ocr_extracted_not_confirmed','review_only') NOT NULL DEFAULT 'pending_review'"),
    'process_design_evidence must carry evidence status enum'
  );
  assert.ok(routeSource.includes("status='verified'"), 'publish gate must check evidence.status=verified');
  assert.ok(routeSource.includes('verified_evidence_count'), 'publish event payload must include verified_evidence_count');
  assert.ok(routeSource.includes('evidence_status_change'), 'evidence status updates must be recorded as events');
  assert.ok(routeSource.includes('publishable'), 'draft detail must expose publishable');
  assert.ok(BASE_PERMISSIONS.processEvidenceVerify, 'permission matrix must register process_evidence:verify');
  assert.ok(
    ROLE_GUIDES.find(role => role.code === 'data_quality').permissions.some(permission => permission.code === 'process_evidence:verify'),
    'data_quality must be allowed to verify process design evidence'
  );

  const validationDraft = { id: 101, l1_name: '经营管理', l2_name: '客户管理', l3_name: '客户需求变更处理', l1_status: 'confirmed', l2_status: 'confirmed' };
  const pendingEvidenceRepo = processDesignRouter.makeProcessDesignMysqlRepository(makePublishValidationFixture([
    { id: 501, status: 'pending_review', maturity: '可支撑发布', source_anchor: '第3项' }
  ]));
  const pendingEvidenceDetails = await pendingEvidenceRepo.publishValidationDetails(validationDraft);
  assert.ok(pendingEvidenceDetails.includes(VERIFIED_EVIDENCE_MESSAGE), 'maturity must not satisfy publish gate without verified status');

  const verifiedEvidenceRepo = processDesignRouter.makeProcessDesignMysqlRepository(makePublishValidationFixture([
    { id: 501, status: 'verified', maturity: '可提交审核', source_anchor: '第3项' }
  ]));
  const verifiedEvidenceDetails = await verifiedEvidenceRepo.publishValidationDetails(validationDraft);
  assert.ok(!verifiedEvidenceDetails.includes(VERIFIED_EVIDENCE_MESSAGE), 'verified evidence must satisfy publish gate even when maturity is only guidance');
  assert.ok(!verifiedEvidenceDetails.some(message => message.includes('可支撑发布')), 'maturity must not appear in publish blocking messages');

  const unconfirmedDraftDetails = await verifiedEvidenceRepo.publishValidationDetails({ ...validationDraft, l1_status: 'needs_review' });
  assert.ok(unconfirmedDraftDetails.some(message => message.includes('L1')), 'confirmed L1/L2 gate must remain active');

  const migrationPool = makeEvidenceStatusMigrationPool();
  await processDesignRouter.ensureProcessDesignEvidenceStatusSchema(migrationPool);
  assert.strictEqual(migrationPool.state.rows[0].status, 'verified');
  assert.strictEqual(migrationPool.state.rows[1].status, 'pending_review');
  assert.strictEqual(migrationPool.state.rows[2].status, 'source_missing');
  migrationPool.state.rows[0].status = 'pending_review';
  await processDesignRouter.ensureProcessDesignEvidenceStatusSchema(migrationPool);
  assert.strictEqual(migrationPool.state.rows[0].status, 'pending_review', 'repeat migration must not overwrite manual status decisions');
  assert.strictEqual(migrationPool.state.backfillRuns, 1, 'evidence status backfill should run once per migration key');

  const permissionsByUser = new Map([
    [10, ['process_governance:submit']],
    [20, ['process_governance:review', 'process_evidence:verify']],
    [99, ['admin:access']]
  ]);
  const rolesByUser = new Map([
    [10, [{ code: 'submitter' }, { code: 'business_contact' }]],
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
        basis_type: '管理要求',
        basis_description: '项目例会提出',
        involves_other_departments: true,
        related_departments: ['工程技术部']
      })
    });
    assert.strictEqual(draft.res.status, 201, JSON.stringify(draft.body));
    assert.strictEqual(draft.body.id, 101);

    const detail = await request(baseUrl, 'submitter', '/api/process-design/drafts/101');
    assert.strictEqual(detail.res.status, 200);
    assert.strictEqual(detail.body.publishable, false);

    const classification = await request(baseUrl, 'submitter', '/api/process-design/drafts/101', {
      method: 'PUT',
      body: JSON.stringify({ l1_name: '经营管理', l1_status: 'confirmed', l2_name: '客户管理', l2_status: 'confirmed', l3_name: '客户需求变更处理' })
    });
    assert.strictEqual(classification.res.status, 200, JSON.stringify(classification.body));

    const step = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/steps', {
      method: 'POST',
      body: JSON.stringify({ step_name: '登记变更需求', output_result: '形成需求变更记录' })
    });
    assert.strictEqual(step.res.status, 201);

    const stepUpdate = await request(baseUrl, 'submitter', '/api/process-design/steps/201', {
      method: 'PUT',
      body: JSON.stringify({ actor_role: '业务联系人' })
    });
    assert.strictEqual(stepUpdate.res.status, 200);

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

    const field = await request(baseUrl, 'submitter', '/api/process-design/forms/301/fields', {
      method: 'POST',
      body: JSON.stringify({ field_name_cn: '变更原因', data_object: '客户需求' })
    });
    assert.strictEqual(field.res.status, 201);

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
    assert.strictEqual(evidence.body.status, 'pending_review');

    const evidenceUpdate = await request(baseUrl, 'submitter', '/api/process-design/evidence/501', {
      method: 'PUT',
      body: JSON.stringify({ record_time: '2026-06-30' })
    });
    assert.strictEqual(evidenceUpdate.res.status, 200);

    const risks = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/risks');
    assert.strictEqual(risks.res.status, 200);

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

    const publishPendingEvidence = await request(baseUrl, 'reviewer', '/api/process-design/drafts/101/publish', {
      method: 'POST',
      body: JSON.stringify({ note: '发布' })
    });
    assert.strictEqual(publishPendingEvidence.res.status, 409);
    assert.ok((publishPendingEvidence.body.details || []).includes(VERIFIED_EVIDENCE_MESSAGE));

    const unauthorizedVerify = await request(baseUrl, 'submitter', '/api/process-design/evidence/501', {
      method: 'PUT',
      body: JSON.stringify({ status: 'verified' })
    });
    assert.strictEqual(unauthorizedVerify.res.status, 403);

    const authorizedVerify = await request(baseUrl, 'reviewer', '/api/process-design/evidence/501', {
      method: 'PUT',
      body: JSON.stringify({ status: 'verified' })
    });
    assert.strictEqual(authorizedVerify.res.status, 200, JSON.stringify(authorizedVerify.body));
    assert.strictEqual(authorizedVerify.body.status, 'verified');
    assert.ok(fakeRepo.state.events.some(event => event.event_type === 'evidence_status_change' && event.payload.to_status === 'verified'));

    const detailAfterVerify = await request(baseUrl, 'submitter', '/api/process-design/drafts/101');
    assert.strictEqual(detailAfterVerify.res.status, 200);
    assert.strictEqual(detailAfterVerify.body.publishable, true);

    const publish = await request(baseUrl, 'reviewer', '/api/process-design/drafts/101/publish', {
      method: 'POST',
      body: JSON.stringify({ note: '发布' })
    });
    assert.strictEqual(publish.res.status, 200);
    assert.strictEqual(publish.body.version.version_no, 'PD-101-v1');
    assert.ok(fakeRepo.state.events.some(event => event.event_type === 'publish' && event.payload.verified_evidence_count >= 1));

    [
      'createDraft',
      'createStep',
      'createForm',
      'createField',
      'createEvidence',
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
