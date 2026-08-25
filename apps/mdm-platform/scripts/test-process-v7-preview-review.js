const assert = require('assert');
const express = require('express');
const fs = require('fs');
const path = require('path');

process.env.MDM_DB_QUIET = '1';
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const structuredOutputService = require('../../structured-output-service/server');
const auth = require('../server/auth');
const previewRouter = require('../server/routes/processV7PreviewReview');
const {
  caseStatusFromItems,
  compareReviewItems,
  mergeReviewItems,
  validateAndProjectV7
} = require('../server/processV7PreviewReview');

function sampleDocument() {
  const document = structuredOutputService.createEmptyProcessGovernanceV7Document();
  document.export_meta.package_ref = 'package_v7_preview_test';
  document.process.process_ref = 'process_v7_preview_test';
  document.process.process_name = '产品制造大纲编制与审批';
  document.process.owning_department = '质量管理部';
  document.behaviors = [{
    behavior_ref: 'behavior_compile',
    node_type: 'action',
    behavior_name: '编制人员编制产品制造大纲',
    behavior_description: '编制人员填写制造大纲。',
    current_actor_role: '质量管理部质量工程师',
    actor_assignment_mode: 'fixed_department',
    actor_department_data_ref: null,
    actor_position_rule: '',
    trigger: '',
    precondition: '',
    input_description: '',
    timing: null,
    completion_standard: '制造大纲已经填写。',
    output_description: '',
    countersign_all_required: false,
    countersign_target_departments: []
  }, {
    behavior_ref: 'behavior_process_review',
    node_type: 'action',
    behavior_name: '工艺人员核对产品制造大纲',
    behavior_description: '工艺人员核对工序和工装内容。',
    current_actor_role: '工程技术部工艺员',
    actor_assignment_mode: 'fixed_department',
    actor_department_data_ref: null,
    actor_position_rule: '',
    trigger: '',
    precondition: '',
    input_description: '',
    timing: null,
    completion_standard: '工序和工装内容已经核对。',
    output_description: '',
    countersign_all_required: false,
    countersign_target_departments: []
  }];
  document.flow_relations = [{
    relation_ref: 'relation_compile_review',
    relation_type: 'sequence',
    from_behavior_ref: 'behavior_compile',
    to_behavior_ref: 'behavior_process_review',
    condition: ''
  }];
  return document;
}

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

const identities = {
  contact: { userId: 10, personId: 10, departmentId: 1, roles: ['department_contact'], permissions: ['governance:read-department', 'governance:draft-department'] },
  originReviewer: { userId: 11, personId: 11, departmentId: 1, roles: ['department_mdm_reviewer'], permissions: ['governance:read-department', 'governance:review-department'] },
  targetReviewer: { userId: 12, personId: 12, departmentId: 2, roles: ['department_mdm_reviewer'], permissions: ['governance:read-department', 'governance:review-department'] },
  admin: { userId: 13, personId: 13, departmentId: 1, roles: ['admin'], permissions: ['governance:read-global'] },
  lead: { userId: 14, personId: 14, departmentId: 1, roles: ['mdm_lead'], permissions: ['governance:read-global', 'governance:assign-work'] },
  formerCreator: { userId: 15, personId: 15, departmentId: 3, roles: ['department_contact'], permissions: ['governance:read-department'] }
};

function makeRepository(projected, sourceDocument = sampleDocument()) {
  const calls = [];
  const caseRow = {
    id: 1,
    case_ref: 'case_v7_preview_test',
    process_ref: 'process_v7_preview_test',
    process_name: '产品制造大纲编制与审批',
    owning_department_id: 1,
    owning_department_name: '质量管理部',
    status: 'under_review',
    current_revision_no: 1,
    current_content_hash: projected.contentHash,
    blocking_issues: projected.blockingIssues || [],
    scope_decision: null,
    created_by_person_id: 15
  };
  const item = projected.items[0] ? {
    id: 101,
    case_id: 1,
    revision_no: 1,
    is_current: 1,
    origin_department_id: 1,
    target_department_id: 2,
    origin_status: 'pending',
    counterparty_status: 'pending',
    ...projected.items[0]
  } : null;
  return {
    calls,
    async listDepartments() {
      return [{ id: 1, name: '质量管理部', code: 'QUALITY' }, { id: 2, name: '工程技术部', code: 'ENGINEERING' }];
    },
    async listCases() {
      return { items: [caseRow], total: 1, my_action_count: 1 };
    },
    async createCase(preview, meta, actor) {
      calls.push(['createCase', preview.contentHash, meta.sourceFileName, actor.personId]);
      return { case: caseRow, revision: { revision_no: 1 }, items: item ? [item] : [], idempotent: false };
    },
    async getCase(id) {
      return Number(id) === 1 ? caseRow : null;
    },
    async getCaseDetail() {
      return { case: caseRow, revision: { revision_no: 1, document: sourceDocument }, items: item ? [item] : [], events: [] };
    },
    async getItem(id) {
      return Number(id) === 101 ? item : null;
    },
    async findFormalDocumentByNumber(documentNo) {
      return documentNo === 'V7-EXISTING-001'
        ? { id: 602, document_no: documentNo, process_ref: null, owning_department_id: 1, status: 'active' }
        : null;
    },
    async decideItem(_item, party, decision, basis, expectedRevision, expectedContentHash, actor) {
      if (expectedContentHash !== caseRow.current_content_hash) {
        const error = new Error('当前案例内容摘要已经变化');
        error.statusCode = 409;
        error.code = 'V7_PREVIEW_CONTENT_HASH_CONFLICT';
        throw error;
      }
      calls.push(['decideItem', party, decision, basis, expectedRevision, actor.personId]);
      return { ...item, [`${party}_status`]: decision };
    },
    async assignOwner(_case, department, preview, _meta, actor) {
      calls.push(['assignOwner', department.id, preview.items.length, actor.personId]);
      return { ...caseRow, owning_department_id: department.id, owning_department_name: department.name };
    },
    async addRevision(_case, preview, meta, actor) {
      if (meta.expectedContentHash !== caseRow.current_content_hash) {
        const error = new Error('当前案例内容摘要已经变化');
        error.statusCode = 409;
        error.code = 'V7_PREVIEW_CONTENT_HASH_CONFLICT';
        throw error;
      }
      calls.push(['addRevision', preview.contentHash, meta.expectedRevisionNo, actor.personId]);
      return { case: { ...caseRow, current_revision_no: 2 }, revision: { revision_no: 2 }, items: preview.items };
    },
    async recordScopeDecision(_case, decision, basis, preview, expectedRevision, expectedContentHash, actor) {
      if (expectedContentHash !== caseRow.current_content_hash) {
        const error = new Error('当前案例内容摘要已经变化');
        error.statusCode = 409;
        error.code = 'V7_PREVIEW_CONTENT_HASH_CONFLICT';
        throw error;
      }
      calls.push(['recordScopeDecision', decision, basis, expectedRevision, actor.personId]);
      return {
        ...caseRow,
        status: caseStatusFromItems(preview.items, true, preview.blockingIssues, decision),
        scope_decision: decision,
        scope_decision_basis: basis
      };
    },
    async promoteCase(detail, preview, target, meta, actor) {
      calls.push([
        'promoteCase',
        detail.case.id,
        preview.contentHash,
        target.mode,
        target.document_no || target.document_id,
        meta.expectedRevisionNo,
        actor.personId
      ]);
      return {
        idempotent: false,
        promotion: { id: 501, promotion_ref: 'v7_promotion_test' },
        document: { id: 601, document_no: target.document_no, process_ref: preview.processRef },
        draft: { id: 701, schema_version: 'process-governance-v7', revision_no: meta.expectedRevisionNo, content_hash: preview.contentHash, status: 'draft' }
      };
    }
  };
}

async function request(baseUrl, identityKey, routePath, options = {}) {
  const response = await fetch(`${baseUrl}${routePath}`, {
    ...options,
    headers: {
      'X-Test-User': identityKey,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  return { response, body: await response.json() };
}

async function main() {
  const serverEntrySource = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  assert.ok(serverEntrySource.includes("express.json({ limit: '2mb' })"), 'main server must accept representative V7 files');
  assert.ok(serverEntrySource.includes("registerRouteIfExists('/api/process-v7-preview', 'processV7PreviewReview')"), 'main server must register isolated V7 preview routes');

  const departments = [
    { id: 1, name: '质量管理部', code: 'QUALITY' },
    { id: 2, name: '工程技术部', code: 'ENGINEERING' },
    { id: 3, name: '财务部', code: 'FINANCE' }
  ];
  const document = sampleDocument();
  const projected = validateAndProjectV7(document, departments);
  assert.strictEqual(projected.errors.length, 0);
  assert.strictEqual(projected.items.length, 1);
  assert.strictEqual(projected.items[0].target_department_name, '工程技术部');
  assert.strictEqual(projected.items[0].behavior_ref, 'behavior_process_review');
  assert.strictEqual(projected.previewOnly, true);
  assert.deepStrictEqual(projected.blockingIssues, []);

  const unresolvedDocument = sampleDocument();
  unresolvedDocument.behaviors[1].current_actor_role = '未登记部门工艺员';
  const unresolvedProjection = validateAndProjectV7(unresolvedDocument, departments);
  assert.ok(unresolvedProjection.blockingIssues.some(issue => issue.code === 'ACTOR_DEPARTMENT_UNRESOLVED'));
  assert.notStrictEqual(
    caseStatusFromItems([{ origin_status: 'confirmed', counterparty_status: 'confirmed' }], true, unresolvedProjection.blockingIssues),
    'review_complete',
    'an unresolved fixed execution department must block review completion'
  );

  const zeroCrossDepartmentDocument = sampleDocument();
  zeroCrossDepartmentDocument.process.process_ref = 'process_v7_zero_cross_department';
  zeroCrossDepartmentDocument.behaviors = [zeroCrossDepartmentDocument.behaviors[0]];
  zeroCrossDepartmentDocument.flow_relations = [];
  const zeroCrossDepartmentProjection = validateAndProjectV7(zeroCrossDepartmentDocument, departments);
  assert.strictEqual(zeroCrossDepartmentProjection.items.length, 0);
  assert.ok(zeroCrossDepartmentProjection.blockingIssues.some(issue => issue.code === 'ZERO_CROSS_DEPARTMENT_SCOPE_PENDING'));
  assert.strictEqual(caseStatusFromItems([], true, zeroCrossDepartmentProjection.blockingIssues), 'under_review');
  assert.strictEqual(
    caseStatusFromItems([], true, zeroCrossDepartmentProjection.blockingIssues, 'confirmed_no_cross_department'),
    'review_complete'
  );

  const ownerChangedDocument = sampleDocument();
  ownerChangedDocument.process.owning_department = '工程技术部';
  const ownerChangedProjection = validateAndProjectV7(ownerChangedDocument, departments, {
    owningDepartmentName: '质量管理部'
  });
  assert.ok(ownerChangedProjection.blockingIssues.some(issue => issue.code === 'OWNING_DEPARTMENT_CHANGE_PENDING'));

  const previous = [{
    ...projected.items[0],
    origin_status: 'confirmed',
    counterparty_status: 'confirmed',
    origin_basis: '归口部门已核对',
    counterparty_basis: '承接部门已核对'
  }];
  const unchanged = mergeReviewItems(previous, projected.items);
  assert.strictEqual(unchanged[0].origin_status, 'confirmed');
  assert.strictEqual(unchanged[0].counterparty_status, 'confirmed');
  assert.strictEqual(unchanged[0].carry_state, 'carried_forward');

  const changedDocument = sampleDocument();
  changedDocument.behaviors[1].completion_standard = '工艺人员已经记录核对日期。';
  const changedProjection = validateAndProjectV7(changedDocument, departments);
  const changed = mergeReviewItems(previous, changedProjection.items);
  assert.strictEqual(changed[0].origin_status, 'pending');
  assert.strictEqual(changed[0].counterparty_status, 'pending');
  assert.strictEqual(changed[0].carry_state, 'reopened');
  const comparison = compareReviewItems(previous, changedProjection.items);
  assert.deepStrictEqual(comparison.counts, { added: 0, carried_forward: 0, reopened: 1, removed: 0 });
  assert.deepStrictEqual(comparison.affected_departments, ['工程技术部', '质量管理部']);

  const invalid = validateAndProjectV7({ schema_version: 'process-governance-v3' }, departments);
  assert.ok(invalid.errors.length > 0);

  const semanticInvalidDocument = sampleDocument();
  semanticInvalidDocument.behaviors[1].behavior_ref = semanticInvalidDocument.behaviors[0].behavior_ref;
  const serviceSemanticResult = structuredOutputService.processGovernanceValidationResult(semanticInvalidDocument);
  const previewSemanticResult = validateAndProjectV7(semanticInvalidDocument, departments);
  assert.strictEqual(serviceSemanticResult.valid, false, '3001 must reject the semantic reference conflict');
  assert.ok(previewSemanticResult.errors.length > 0, '3000 must reject the same semantic reference conflict');
  assert.deepStrictEqual(
    previewSemanticResult.errors.map(error => error.error_id).filter(Boolean).sort(),
    serviceSemanticResult.errors.map(error => error.error_id).filter(Boolean).sort(),
    '3001 and 3000 must return the same stable V7 error identities'
  );

  const identityByUserId = new Map(Object.values(identities).map(identity => [identity.userId, identity]));
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      return { permSet: new Set(identityByUserId.get(Number(userId))?.permissions || []), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId) {
      return (identityByUserId.get(Number(userId))?.roles || []).map(code => ({ code }));
    },
    async getDepartmentById(departmentId) {
      return departments.find(item => Number(item.id) === Number(departmentId)) || null;
    }
  }));

  const repository = makeRepository(projected);
  previewRouter.setProcessV7PreviewRepositoryFactory(() => repository);
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, _res, next) => {
    const identity = identities[req.get('X-Test-User')] || identities.contact;
    req.session = {
      userId: identity.userId,
      personId: identity.personId,
      departmentId: identity.departmentId
    };
    next();
  });
  app.use('/api/process-v7-preview', previewRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    process.env.PROCESS_V7_PREVIEW_ENABLED = '0';
    const disabled = await request(baseUrl, 'admin', '/api/process-v7-preview/cases');
    assert.strictEqual(disabled.response.status, 503);
    assert.strictEqual(disabled.body.code, 'V7_PREVIEW_DISABLED');
    process.env.PROCESS_V7_PREVIEW_ENABLED = '1';

    const created = await request(baseUrl, 'contact', '/api/process-v7-preview/cases', {
      method: 'POST',
      body: JSON.stringify({ source_file_name: '制造大纲.json', document })
    });
    assert.strictEqual(created.response.status, 201);
    assert.strictEqual(created.body.preview_only, true);
    assert.strictEqual(created.body.publishable, false);
    assert.strictEqual(created.body.formal_process_version_id, null);
    assert.ok(created.body.allowed_actions.includes('upload_revision'));

    const detail = await request(baseUrl, 'targetReviewer', '/api/process-v7-preview/cases/1');
    assert.strictEqual(detail.response.status, 200);
    assert.strictEqual(detail.body.items[0].my_party, 'counterparty');
    assert.strictEqual(detail.body.items[0].can_act, true);
    assert.deepStrictEqual(detail.body.items[0].allowed_actions, ['record_department_decision']);

    const formerCreatorRead = await request(baseUrl, 'formerCreator', '/api/process-v7-preview/cases/1');
    assert.strictEqual(formerCreatorRead.response.status, 403, 'creator identity must not bypass current department data scope');

    const pendingOwnerDocument = sampleDocument();
    pendingOwnerDocument.process.process_ref = 'process_pending_owner_test';
    pendingOwnerDocument.process.owning_department = '';
    const contactPendingOwner = await request(baseUrl, 'contact', '/api/process-v7-preview/cases', {
      method: 'POST',
      body: JSON.stringify({ source_file_name: '待分派.json', document: pendingOwnerDocument })
    });
    assert.strictEqual(contactPendingOwner.response.status, 422);
    assert.strictEqual(contactPendingOwner.body.code, 'V7_PREVIEW_OWNER_PENDING_REQUIRES_LEAD');

    const targetDecision = await request(baseUrl, 'targetReviewer', '/api/process-v7-preview/items/101/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'confirmed', basis: '承接部门已核对', expected_revision_no: 1, expected_content_hash: projected.contentHash })
    });
    assert.strictEqual(targetDecision.response.status, 200);
    assert.deepStrictEqual(repository.calls.at(-1).slice(0, 3), ['decideItem', 'counterparty', 'confirmed']);

    const originDecision = await request(baseUrl, 'originReviewer', '/api/process-v7-preview/items/101/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'needs_changes', basis: '退回修改交接内容', expected_revision_no: 1, expected_content_hash: projected.contentHash })
    });
    assert.strictEqual(originDecision.response.status, 200);
    assert.deepStrictEqual(repository.calls.at(-1).slice(0, 3), ['decideItem', 'origin', 'needs_changes']);

    const adminWrite = await request(baseUrl, 'admin', '/api/process-v7-preview/items/101/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'confirmed', basis: '管理员不得代办', expected_revision_no: 1, expected_content_hash: projected.contentHash })
    });
    assert.strictEqual(adminWrite.response.status, 403);

    const emptyBasis = await request(baseUrl, 'targetReviewer', '/api/process-v7-preview/items/101/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'confirmed', basis: '', expected_revision_no: 1, expected_content_hash: projected.contentHash })
    });
    assert.strictEqual(emptyBasis.response.status, 422);
    assert.strictEqual(emptyBasis.body.code, 'V7_PREVIEW_BASIS_REQUIRED');

    const longBasis = await request(baseUrl, 'targetReviewer', '/api/process-v7-preview/items/101/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'confirmed', basis: '核'.repeat(4001), expected_revision_no: 1, expected_content_hash: projected.contentHash })
    });
    assert.strictEqual(longBasis.response.status, 422);
    assert.strictEqual(longBasis.body.code, 'V7_PREVIEW_BASIS_TOO_LONG');

    const staleHash = await request(baseUrl, 'targetReviewer', '/api/process-v7-preview/items/101/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'confirmed', basis: '使用旧摘要提交', expected_revision_no: 1, expected_content_hash: '0'.repeat(64) })
    });
    assert.strictEqual(staleHash.response.status, 409);
    assert.strictEqual(staleHash.body.code, 'V7_PREVIEW_CONTENT_HASH_CONFLICT');

    const callsBeforeRevisionPreview = repository.calls.length;
    const revisionPreview = await request(baseUrl, 'contact', '/api/process-v7-preview/cases/1/revisions/preview', {
      method: 'POST',
      body: JSON.stringify({
        document: changedDocument,
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash
      })
    });
    assert.strictEqual(revisionPreview.response.status, 200);
    assert.strictEqual(revisionPreview.body.comparison.counts.reopened, 1);
    assert.strictEqual(revisionPreview.body.candidate_content_hash, changedProjection.contentHash);
    assert.strictEqual(repository.calls.length, callsBeforeRevisionPreview, 'read-only comparison must not call a write repository method');

    const list = await request(baseUrl, 'targetReviewer', '/api/process-v7-preview/cases');
    assert.strictEqual(list.response.status, 200);
    assert.strictEqual(list.body.my_action_count, 1);
    assert.ok(list.body.allowed_actions.includes('view'));

    const zeroRepository = makeRepository(zeroCrossDepartmentProjection, zeroCrossDepartmentDocument);
    previewRouter.setProcessV7PreviewRepositoryFactory(() => zeroRepository);
    const zeroDetail = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1');
    assert.strictEqual(zeroDetail.response.status, 200);
    assert.ok(zeroDetail.body.allowed_actions.includes('record_scope_decision'));

    const contactScopeDecision = await request(baseUrl, 'contact', '/api/process-v7-preview/cases/1/scope-decision', {
      method: 'POST',
      body: JSON.stringify({
        decision: 'confirmed_no_cross_department',
        basis: '归口部门已逐项核对当前V7，确认本修订不涉及其他部门。',
        expected_revision_no: 1,
        expected_content_hash: zeroCrossDepartmentProjection.contentHash
      })
    });
    assert.strictEqual(contactScopeDecision.response.status, 403);

    const scopeDecision = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1/scope-decision', {
      method: 'POST',
      body: JSON.stringify({
        decision: 'confirmed_no_cross_department',
        basis: '归口部门已逐项核对当前V7，确认本修订不涉及其他部门。',
        expected_revision_no: 1,
        expected_content_hash: zeroCrossDepartmentProjection.contentHash
      })
    });
    assert.strictEqual(scopeDecision.response.status, 200);
    assert.strictEqual(scopeDecision.body.case.status, 'review_complete');
    assert.deepStrictEqual(zeroRepository.calls.at(-1).slice(0, 2), ['recordScopeDecision', 'confirmed_no_cross_department']);

    previewRouter.setProcessV7PreviewRepositoryFactory(() => repository);
    process.env.PROCESS_V7_FORMAL_ENABLED = '1';
    const incompletePromote = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1/promote', {
      method: 'POST',
      body: JSON.stringify({
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash,
        target: { mode: 'create', document_no: 'V7-TEST-001', document_title: '产品制造大纲编制与审批' }
      })
    });
    assert.strictEqual(incompletePromote.response.status, 409);
    assert.strictEqual(incompletePromote.body.code, 'V7_PREVIEW_REVIEW_INCOMPLETE');

    const reviewCompleteRepository = makeRepository(projected, document);
    const reviewCompleteDetail = await reviewCompleteRepository.getCaseDetail(1);
    reviewCompleteRepository.getCaseDetail = async () => ({
      ...reviewCompleteDetail,
      case: { ...reviewCompleteDetail.case, status: 'review_complete' },
      items: reviewCompleteDetail.items.map(reviewItem => ({
        ...reviewItem,
        origin_status: 'confirmed',
        counterparty_status: 'confirmed',
        status: 'confirmed'
      }))
    });
    previewRouter.setProcessV7PreviewRepositoryFactory(() => reviewCompleteRepository);

    process.env.PROCESS_V7_FORMAL_ENABLED = '0';
    const formalDisabled = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1/promote', {
      method: 'POST',
      body: JSON.stringify({
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash,
        target: { mode: 'create', document_no: 'V7-TEST-001', document_title: '产品制造大纲编制与审批' }
      })
    });
    assert.strictEqual(formalDisabled.response.status, 503);
    assert.strictEqual(formalDisabled.body.code, 'V7_FORMAL_DISABLED');

    process.env.PROCESS_V7_FORMAL_ENABLED = '1';
    const adminPromote = await request(baseUrl, 'admin', '/api/process-v7-preview/cases/1/promote', {
      method: 'POST',
      body: JSON.stringify({
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash,
        target: { mode: 'create', document_no: 'V7-TEST-001', document_title: '产品制造大纲编制与审批' }
      })
    });
    assert.strictEqual(adminPromote.response.status, 403);
    assert.strictEqual(adminPromote.body.code, 'V7_PREVIEW_ADMIN_READ_ONLY');

    const contactPromote = await request(baseUrl, 'contact', '/api/process-v7-preview/cases/1/promote', {
      method: 'POST',
      body: JSON.stringify({
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash,
        target: { mode: 'create', document_no: 'V7-TEST-001', document_title: '产品制造大纲编制与审批' }
      })
    });
    assert.strictEqual(contactPromote.response.status, 403);

    const existingTarget = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1/formal-targets?document_no=V7-EXISTING-001');
    assert.strictEqual(existingTarget.response.status, 200);
    assert.strictEqual(existingTarget.body.exists, true);
    assert.strictEqual(existingTarget.body.accessible, true);
    assert.strictEqual(existingTarget.body.document.id, 602);

    const missingExistingTarget = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1/formal-targets?document_no=V7-MISSING-001');
    assert.strictEqual(missingExistingTarget.response.status, 200);
    assert.strictEqual(missingExistingTarget.body.exists, false);

    const malformedTarget = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1/promote', {
      method: 'POST',
      body: JSON.stringify({
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash,
        target: { mode: 'existing' }
      })
    });
    assert.strictEqual(malformedTarget.response.status, 422);
    assert.strictEqual(malformedTarget.body.code, 'V7_FORMAL_DOCUMENT_REQUIRED');

    const promoted = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1/promote', {
      method: 'POST',
      body: JSON.stringify({
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash,
        target: { mode: 'create', document_no: 'V7-TEST-001', document_title: '产品制造大纲编制与审批' }
      })
    });
    assert.strictEqual(promoted.response.status, 201);
    assert.strictEqual(promoted.body.preview_only, false);
    assert.strictEqual(promoted.body.formal_draft_id, 701);
    assert.strictEqual(promoted.body.process_version_id, null);
    assert.deepStrictEqual(reviewCompleteRepository.calls.at(-1).slice(0, 5), [
      'promoteCase', 1, projected.contentHash, 'create', 'V7-TEST-001'
    ]);
  } finally {
    delete process.env.PROCESS_V7_PREVIEW_ENABLED;
    delete process.env.PROCESS_V7_FORMAL_ENABLED;
    await closeServer(server);
    previewRouter.resetProcessV7PreviewRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }

  console.log('Process V7 preview review tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
