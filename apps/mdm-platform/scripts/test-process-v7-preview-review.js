const assert = require('assert');
const express = require('express');
const fs = require('fs');
const path = require('path');

process.env.MDM_DB_QUIET = '1';
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const structuredOutputService = require('../../structured-output-service/server');
const auth = require('../server/auth');
const previewRouter = require('../server/routes/processV7PreviewReview');
const { makeProcessV7PreviewReviewRepository } = require('../server/processV7PreviewReviewRepository');
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

function sampleDocumentWithReviewEvidence() {
  const document = sampleDocument();
  document.data_objects = [{
    data_ref: 'data_review_result',
    data_name: '工序和工装核对结果',
    description: '记录工艺人员的核对结果。',
    information_type: 'business_conclusion',
    fields: [{
      field_ref: 'field_review_result',
      field_name: '核对结果',
      field_type: '文本',
      definition: '工序和工装内容的核对结论。'
    }, {
      field_ref: 'field_review_date',
      field_name: '核对日期',
      field_type: '日期',
      definition: '完成核对的日期。'
    }],
    behavior_links: [{
      link_ref: 'data_link_review_update',
      behavior_ref: 'behavior_process_review',
      operation: 'update',
      updated_field_refs: ['field_review_result', 'field_review_date']
    }],
    source_relations: [],
    lifecycle: {
      applicability: 'pending_confirmation',
      entry_state: {
        business_validity: 'pending_confirmation',
        custody: 'pending_confirmation',
        identifiability_applicability: 'pending_confirmation',
        identifiability: 'pending_confirmation'
      },
      routes: [],
      analysis: { analyzer_version: '', source_fingerprint: '', status: 'not_analyzed' },
      decision_reason: '',
      decision_notes: ''
    }
  }];
  document.forms = [{
    form_ref: 'form_review_record',
    form_name: '工序和工装核对记录',
    form_no: null,
    form_design_state: 'current_state',
    behavior_links: [{
      link_ref: 'form_link_review',
      behavior_ref: 'behavior_process_review',
      operations: ['fill', 'review'],
      notes: '核对后填写。'
    }],
    areas: [{
      area_ref: 'area_review_result',
      area_type: '基本信息',
      area_title: '核对结果',
      items: [{
        item_ref: 'item_review_result',
        item_name: '核对结果',
        item_type: '文本',
        required: true,
        instructions: '填写已核对的内容和结论。',
        business_data_ref: 'data_review_result',
        data_field_ref: 'field_review_result',
        value_usage_mode: 'authoritative_input',
        value_origin_mode: 'direct_current_process',
        source_links: []
      }]
    }]
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
  contact: { userId: 10, personId: 10, departmentId: 1, roles: ['department_contact'], permissions: ['governance:read-department', 'governance:draft-department', 'governance:submit-department'] },
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
    process_ref: sourceDocument.process.process_ref,
    process_name: sourceDocument.process.process_name,
    owning_department_id: projected.owningDepartment ? projected.owningDepartment.id : null,
    owning_department_name: projected.owningDepartment ? projected.owningDepartment.name : null,
    status: caseStatusFromItems(projected.items, Boolean(projected.owningDepartment), projected.blockingIssues),
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

  const lockedOwnerDocument = sampleDocument();
  lockedOwnerDocument.process.process_ref = 'process_v7_locked_owner_test';
  lockedOwnerDocument.process.owning_department = '';
  const lockedOwnerProjection = validateAndProjectV7(lockedOwnerDocument, departments);
  const ownerWriteQueries = [];
  let insertedOwnerItem = null;
  let ownerCaseUpdateParams = null;
  const ownerWriteConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) {
      const normalized = String(sql).trim().replace(/\s+/g, ' ');
      ownerWriteQueries.push(normalized);
      if (normalized === 'SELECT * FROM process_v7_preview_cases WHERE id=? FOR UPDATE') {
        return [[{
          id: 21,
          process_ref: lockedOwnerProjection.processRef,
          process_name: lockedOwnerProjection.processName,
          owning_department_id: null,
          owning_department_name: null,
          status: 'pending_owner',
          current_revision_no: 1,
          current_revision_id: 211,
          current_content_hash: lockedOwnerProjection.contentHash,
          blocking_issues_json: JSON.stringify(lockedOwnerProjection.blockingIssues)
        }]];
      }
      if (normalized.startsWith('SELECT * FROM process_v7_preview_revisions')) {
        return [[{
          id: 211,
          case_id: 21,
          revision_no: 1,
          content_hash: lockedOwnerProjection.contentHash,
          content_json: JSON.stringify(lockedOwnerDocument)
        }]];
      }
      if (normalized.startsWith('SELECT * FROM process_v7_preview_review_items WHERE case_id=? AND is_current=1 ORDER BY id FOR UPDATE')) {
        return [[]];
      }
      if (normalized.startsWith('SELECT id, name, code FROM departments WHERE status=\'active\'')) {
        return [[...departments]];
      }
      if (normalized === 'UPDATE process_v7_preview_review_items SET is_current=0 WHERE case_id=? AND is_current=1') {
        return [{ affectedRows: 0 }];
      }
      if (normalized.startsWith('INSERT INTO process_v7_preview_review_items')) {
        insertedOwnerItem = {
          id: 901,
          case_id: params[0],
          revision_id: params[1],
          revision_no: params[2],
          stable_item_key: params[3],
          behavior_ref: params[4],
          behavior_name: params[5],
          origin_department_id: params[6],
          origin_department_name: params[7],
          target_department_id: params[8],
          target_department_name: params[9],
          actor_role: params[10],
          actor_position: params[11],
          item_digest: params[12],
          item_snapshot_json: params[13],
          origin_status: params[14],
          counterparty_status: params[19],
          status: params[24],
          carry_state: params[25],
          carried_from_item_id: params[26],
          is_current: 1
        };
        return [{ insertId: 901 }];
      }
      if (normalized === 'SELECT * FROM process_v7_preview_review_items WHERE id=?') {
        return [[insertedOwnerItem]];
      }
      if (normalized.startsWith('UPDATE process_v7_preview_cases SET owning_department_id=')) {
        ownerCaseUpdateParams = params;
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('INSERT INTO process_v7_preview_events')) return [{ insertId: 902 }];
      if (normalized === 'SELECT * FROM process_v7_preview_cases WHERE id=?') {
        return [[{
          id: 21,
          process_ref: lockedOwnerProjection.processRef,
          owning_department_id: 1,
          owning_department_name: '质量管理部',
          current_revision_no: 1,
          current_revision_id: 211,
          current_content_hash: lockedOwnerProjection.contentHash,
          blocking_issues_json: ownerCaseUpdateParams && ownerCaseUpdateParams[3]
        }]];
      }
      throw new Error(`unexpected owner assignment SQL: ${normalized}`);
    }
  };
  const ownerWriteRepository = makeProcessV7PreviewReviewRepository({
    async getConnection() { return ownerWriteConnection; }
  });
  process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
  process.env.PROCESS_V7_TRIAL_PROCESS_REF = lockedOwnerProjection.processRef;
  await ownerWriteRepository.assignOwner(
    { id: 21 },
    { id: 1, name: '伪造部门名' },
    {
      ...lockedOwnerProjection,
      items: [{ ...projected.items[0], behavior_ref: 'forged_behavior', behavior_name: '伪造核对项' }],
      blockingIssues: [{ code: 'FORGED_BLOCKER' }]
    },
    { expectedRevisionNo: 1, expectedContentHash: lockedOwnerProjection.contentHash },
    { userId: 14, personId: 14 }
  );
  assert.strictEqual(insertedOwnerItem.behavior_ref, 'behavior_process_review', '归口分派必须从锁定修订重新生成核对项');
  assert.deepStrictEqual(JSON.parse(ownerCaseUpdateParams[3]), [], '调用方伪造的阻断项不得写入案例');
  assert.strictEqual(ownerCaseUpdateParams[1], '质量管理部', '归口部门名称必须来自事务内重读的有效部门');
  const ownerCaseLockIndex = ownerWriteQueries.findIndex(sql => sql === 'SELECT * FROM process_v7_preview_cases WHERE id=? FOR UPDATE');
  const ownerRevisionLockIndex = ownerWriteQueries.findIndex(sql => sql.startsWith('SELECT * FROM process_v7_preview_revisions'));
  const ownerItemsLockIndex = ownerWriteQueries.findIndex(sql => sql.startsWith('SELECT * FROM process_v7_preview_review_items WHERE case_id=? AND is_current=1 ORDER BY id FOR UPDATE'));
  const ownerFirstWriteIndex = ownerWriteQueries.findIndex(sql => sql.startsWith('UPDATE ') || sql.startsWith('INSERT '));
  assert.ok(
    ownerCaseLockIndex >= 0 && ownerCaseLockIndex < ownerRevisionLockIndex && ownerRevisionLockIndex < ownerItemsLockIndex && ownerItemsLockIndex < ownerFirstWriteIndex,
    '归口分派必须按案例、当前修订、当前核对项id升序锁定后再写入'
  );
  delete process.env.PROCESS_V7_PREVIEW_ENABLED;
  delete process.env.PROCESS_V7_TRIAL_PROCESS_REF;

  const lockedScopeDocument = sampleDocument();
  lockedScopeDocument.process.process_ref = 'process_v7_locked_scope_test';
  lockedScopeDocument.process.owning_department = '工程技术部';
  const lockedScopeProjection = validateAndProjectV7(lockedScopeDocument, departments, {
    owningDepartmentName: '质量管理部'
  });
  assert.ok(lockedScopeProjection.blockingIssues.some(issue => issue.code === 'OWNING_DEPARTMENT_CHANGE_PENDING'));
  const scopeWriteQueries = [];
  let insertedScopeItem = null;
  let scopeCaseUpdateParams = null;
  const currentScopeItem = {
    id: 921,
    case_id: 22,
    revision_id: 221,
    revision_no: 1,
    ...lockedScopeProjection.items[0],
    item_snapshot_json: JSON.stringify(lockedScopeProjection.items[0].item_snapshot),
    is_current: 1
  };
  const scopeWriteConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) {
      const normalized = String(sql).trim().replace(/\s+/g, ' ');
      scopeWriteQueries.push(normalized);
      if (normalized === 'SELECT * FROM process_v7_preview_cases WHERE id=? FOR UPDATE') {
        return [[{
          id: 22,
          process_ref: lockedScopeProjection.processRef,
          process_name: lockedScopeProjection.processName,
          owning_department_id: 1,
          owning_department_name: '质量管理部',
          status: 'under_review',
          current_revision_no: 1,
          current_revision_id: 221,
          current_content_hash: lockedScopeProjection.contentHash,
          blocking_issues_json: JSON.stringify(lockedScopeProjection.blockingIssues),
          scope_decision: null
        }]];
      }
      if (normalized.startsWith('SELECT * FROM process_v7_preview_revisions')) {
        return [[{
          id: 221,
          case_id: 22,
          revision_no: 1,
          content_hash: lockedScopeProjection.contentHash,
          content_json: JSON.stringify(lockedScopeDocument)
        }]];
      }
      if (normalized.startsWith('SELECT * FROM process_v7_preview_review_items WHERE case_id=? AND is_current=1 ORDER BY id FOR UPDATE')) {
        return [[currentScopeItem]];
      }
      if (normalized.startsWith('SELECT id, name, code FROM departments WHERE status=\'active\'')) return [[...departments]];
      if (normalized === 'UPDATE process_v7_preview_review_items SET is_current=0 WHERE case_id=? AND is_current=1') {
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('INSERT INTO process_v7_preview_review_items')) {
        insertedScopeItem = {
          id: 922,
          case_id: params[0],
          revision_id: params[1],
          revision_no: params[2],
          stable_item_key: params[3],
          behavior_ref: params[4],
          behavior_name: params[5],
          origin_department_id: params[6],
          origin_department_name: params[7],
          target_department_id: params[8],
          target_department_name: params[9],
          actor_role: params[10],
          actor_position: params[11],
          item_digest: params[12],
          item_snapshot_json: params[13],
          origin_status: params[14],
          counterparty_status: params[19],
          status: params[24],
          carry_state: params[25],
          carried_from_item_id: params[26],
          is_current: 1
        };
        return [{ insertId: 922 }];
      }
      if (normalized === 'SELECT * FROM process_v7_preview_review_items WHERE id=?') return [[insertedScopeItem]];
      if (normalized.startsWith('UPDATE process_v7_preview_cases SET owning_department_id=')) {
        scopeCaseUpdateParams = params;
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('INSERT INTO process_v7_preview_events')) return [{ insertId: 923 }];
      if (normalized === 'SELECT * FROM process_v7_preview_cases WHERE id=?') {
        return [[{
          id: 22,
          process_ref: lockedScopeProjection.processRef,
          owning_department_id: scopeCaseUpdateParams && scopeCaseUpdateParams[0],
          owning_department_name: scopeCaseUpdateParams && scopeCaseUpdateParams[1],
          status: scopeCaseUpdateParams && scopeCaseUpdateParams[2],
          current_revision_no: 1,
          current_revision_id: 221,
          current_content_hash: lockedScopeProjection.contentHash,
          blocking_issues_json: scopeCaseUpdateParams && scopeCaseUpdateParams[3],
          scope_decision: scopeCaseUpdateParams && scopeCaseUpdateParams[4]
        }]];
      }
      throw new Error(`unexpected scope decision SQL: ${normalized}`);
    }
  };
  const scopeWriteRepository = makeProcessV7PreviewReviewRepository({
    async getConnection() { return scopeWriteConnection; }
  });
  process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
  process.env.PROCESS_V7_TRIAL_PROCESS_REF = lockedScopeProjection.processRef;
  await scopeWriteRepository.recordScopeDecision(
    { id: 22 },
    'accept_source_owner',
    '已核对锁定修订中的归口部门。',
    {
      ...lockedScopeProjection,
      owningDepartment: departments[2],
      items: [{ ...projected.items[0], behavior_ref: 'forged_scope_behavior', behavior_name: '伪造范围核对项' }],
      blockingIssues: [{ code: 'FORGED_SCOPE_BLOCKER' }]
    },
    1,
    lockedScopeProjection.contentHash,
    { userId: 14, personId: 14 }
  );
  assert.strictEqual(insertedScopeItem.behavior_ref, 'behavior_compile', '采用修订归口部门时必须从锁定正文重新生成核对项');
  assert.strictEqual(scopeCaseUpdateParams[0], 2, '采用的归口部门必须来自锁后重新投影');
  assert.strictEqual(scopeCaseUpdateParams[1], '工程技术部');
  assert.deepStrictEqual(JSON.parse(scopeCaseUpdateParams[3]), [], '调用方伪造的范围阻断项不得写入案例');
  const scopeCaseLockIndex = scopeWriteQueries.findIndex(sql => sql === 'SELECT * FROM process_v7_preview_cases WHERE id=? FOR UPDATE');
  const scopeRevisionLockIndex = scopeWriteQueries.findIndex(sql => sql.startsWith('SELECT * FROM process_v7_preview_revisions'));
  const scopeItemsLockIndex = scopeWriteQueries.findIndex(sql => sql.startsWith('SELECT * FROM process_v7_preview_review_items WHERE case_id=? AND is_current=1 ORDER BY id FOR UPDATE'));
  const scopeFirstWriteIndex = scopeWriteQueries.findIndex(sql => sql.startsWith('UPDATE ') || sql.startsWith('INSERT '));
  assert.ok(
    scopeCaseLockIndex >= 0 && scopeCaseLockIndex < scopeRevisionLockIndex && scopeRevisionLockIndex < scopeItemsLockIndex && scopeItemsLockIndex < scopeFirstWriteIndex,
    '范围决定必须按案例、当前修订、当前核对项id升序锁定后再写入'
  );
  delete process.env.PROCESS_V7_PREVIEW_ENABLED;
  delete process.env.PROCESS_V7_TRIAL_PROCESS_REF;

  const invalidLockedOwnerDocument = sampleDocument();
  invalidLockedOwnerDocument.process.process_ref = 'process_v7_invalid_locked_owner_test';
  invalidLockedOwnerDocument.process.owning_department = '已停用部门';
  const invalidLockedOwnerProjection = validateAndProjectV7(invalidLockedOwnerDocument, departments, {
    owningDepartmentName: '质量管理部'
  });
  let invalidOwnerWriteAttempted = false;
  const invalidOwnerConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      const normalized = String(sql).trim().replace(/\s+/g, ' ');
      if (normalized === 'SELECT * FROM process_v7_preview_cases WHERE id=? FOR UPDATE') {
        return [[{
          id: 23,
          process_ref: invalidLockedOwnerProjection.processRef,
          owning_department_id: 1,
          owning_department_name: '质量管理部',
          current_revision_no: 1,
          current_revision_id: 231,
          current_content_hash: invalidLockedOwnerProjection.contentHash,
          scope_decision: null
        }]];
      }
      if (normalized.startsWith('SELECT * FROM process_v7_preview_revisions')) {
        return [[{
          id: 231,
          case_id: 23,
          revision_no: 1,
          content_hash: invalidLockedOwnerProjection.contentHash,
          content_json: JSON.stringify(invalidLockedOwnerDocument)
        }]];
      }
      if (normalized.startsWith('SELECT * FROM process_v7_preview_review_items WHERE case_id=? AND is_current=1 ORDER BY id FOR UPDATE')) {
        return [[]];
      }
      if (normalized.startsWith('SELECT id, name, code FROM departments WHERE status=\'active\'')) return [[...departments]];
      invalidOwnerWriteAttempted = true;
      throw new Error(`unexpected invalid owner write SQL: ${normalized}`);
    }
  };
  const invalidOwnerRepository = makeProcessV7PreviewReviewRepository({
    async getConnection() { return invalidOwnerConnection; }
  });
  process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
  process.env.PROCESS_V7_TRIAL_PROCESS_REF = invalidLockedOwnerProjection.processRef;
  await assert.rejects(
    invalidOwnerRepository.recordScopeDecision(
      { id: 23 },
      'accept_source_owner',
      '调用方声称修订归口部门有效。',
      { ...projected, owningDepartment: departments[1], blockingIssues: [] },
      1,
      invalidLockedOwnerProjection.contentHash,
      { userId: 14, personId: 14 }
    ),
    error => error && error.statusCode === 422 && error.code === 'V7_PREVIEW_OWNER_INVALID'
  );
  assert.strictEqual(invalidOwnerWriteAttempted, false, '锁后重新投影无法解析修订归口部门时不得写入');
  delete process.env.PROCESS_V7_PREVIEW_ENABLED;
  delete process.env.PROCESS_V7_TRIAL_PROCESS_REF;

  const lockedRevisionDocument = sampleDocument();
  lockedRevisionDocument.process.process_ref = 'process_v7_locked_revision_test';
  const lockedRevisionProjection = validateAndProjectV7(lockedRevisionDocument, departments);
  const candidateRevisionDocument = JSON.parse(JSON.stringify(lockedRevisionDocument));
  candidateRevisionDocument.behaviors[1].behavior_name = '工艺人员复核产品制造大纲';
  const candidateRevisionProjection = validateAndProjectV7(candidateRevisionDocument, departments, {
    owningDepartmentName: '质量管理部'
  });
  const lockedRevisionQueries = [];
  let insertedRevisionParams = null;
  let insertedRevisionItem = null;
  let updatedRevisionCaseParams = null;
  const lockedRevisionItem = {
    id: 931,
    case_id: 24,
    revision_id: 241,
    revision_no: 1,
    ...lockedRevisionProjection.items[0],
    item_snapshot_json: JSON.stringify(lockedRevisionProjection.items[0].item_snapshot),
    is_current: 1
  };
  const lockedRevisionConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) {
      const normalized = String(sql).trim().replace(/\s+/g, ' ');
      lockedRevisionQueries.push(normalized);
      if (normalized === 'SELECT * FROM process_v7_preview_cases WHERE id=? FOR UPDATE') {
        return [[{
          id: 24,
          process_ref: lockedRevisionProjection.processRef,
          process_name: lockedRevisionProjection.processName,
          owning_department_id: 1,
          owning_department_name: '质量管理部',
          status: 'under_review',
          current_revision_no: 1,
          current_revision_id: 241,
          current_content_hash: lockedRevisionProjection.contentHash,
          blocking_issues_json: '[]',
          scope_decision: null
        }]];
      }
      if (normalized.includes('FROM process_v7_preview_revisions') && normalized.endsWith('FOR UPDATE')) {
        return [[{
          id: 241,
          case_id: 24,
          revision_no: 1,
          content_hash: lockedRevisionProjection.contentHash,
          content_json: JSON.stringify(lockedRevisionDocument)
        }]];
      }
      if (normalized.startsWith('SELECT * FROM process_v7_preview_review_items WHERE case_id=? AND is_current=1 ORDER BY id FOR UPDATE')) {
        return [[lockedRevisionItem]];
      }
      if (normalized.startsWith('SELECT id, name, code FROM departments WHERE status=\'active\'')) return [[...departments]];
      if (normalized.startsWith('INSERT INTO process_v7_preview_revisions')) {
        insertedRevisionParams = params;
        return [{ insertId: 242 }];
      }
      if (normalized === 'UPDATE process_v7_preview_review_items SET is_current=0 WHERE case_id=? AND is_current=1') {
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('INSERT INTO process_v7_preview_review_items')) {
        insertedRevisionItem = {
          id: 932,
          case_id: params[0],
          revision_id: params[1],
          revision_no: params[2],
          stable_item_key: params[3],
          behavior_ref: params[4],
          behavior_name: params[5],
          origin_department_id: params[6],
          origin_department_name: params[7],
          target_department_id: params[8],
          target_department_name: params[9],
          actor_role: params[10],
          actor_position: params[11],
          item_digest: params[12],
          item_snapshot_json: params[13],
          origin_status: params[14],
          counterparty_status: params[19],
          status: params[24],
          carry_state: params[25],
          carried_from_item_id: params[26],
          is_current: 1
        };
        return [{ insertId: 932 }];
      }
      if (normalized === 'SELECT * FROM process_v7_preview_review_items WHERE id=?') return [[insertedRevisionItem]];
      if (normalized.startsWith('UPDATE process_v7_preview_cases SET process_name=')) {
        updatedRevisionCaseParams = params;
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith('INSERT INTO process_v7_preview_events')) return [{ insertId: 933 }];
      if (normalized === 'SELECT * FROM process_v7_preview_cases WHERE id=?') {
        return [[{
          id: 24,
          process_ref: lockedRevisionProjection.processRef,
          process_name: updatedRevisionCaseParams && updatedRevisionCaseParams[0],
          owning_department_id: 1,
          owning_department_name: '质量管理部',
          status: updatedRevisionCaseParams && updatedRevisionCaseParams[1],
          current_revision_no: 2,
          current_revision_id: 242,
          current_content_hash: updatedRevisionCaseParams && updatedRevisionCaseParams[4],
          blocking_issues_json: updatedRevisionCaseParams && updatedRevisionCaseParams[5]
        }]];
      }
      if (normalized === 'SELECT * FROM process_v7_preview_revisions WHERE id=?') {
        return [[{
          id: 242,
          case_id: 24,
          revision_no: 2,
          content_hash: candidateRevisionProjection.contentHash,
          content_json: JSON.stringify(candidateRevisionDocument)
        }]];
      }
      throw new Error(`unexpected locked revision SQL: ${normalized}`);
    }
  };
  const lockedRevisionRepository = makeProcessV7PreviewReviewRepository({
    async getConnection() { return lockedRevisionConnection; }
  });
  process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
  process.env.PROCESS_V7_TRIAL_PROCESS_REF = lockedRevisionProjection.processRef;
  await lockedRevisionRepository.addRevision(
    { id: 24 },
    {
      ...candidateRevisionProjection,
      document: candidateRevisionDocument,
      processName: '伪造流程名称',
      contentHash: '0'.repeat(64),
      items: [{ ...candidateRevisionProjection.items[0], behavior_name: '伪造核对项' }],
      blockingIssues: [{ code: 'FORGED_BLOCKER' }]
    },
    {
      sourceFileName: '锁后重投影.json',
      expectedRevisionNo: 1,
      expectedContentHash: lockedRevisionProjection.contentHash
    },
    { userId: 10, personId: 10, departmentId: 1 }
  );
  assert.strictEqual(insertedRevisionParams[4], candidateRevisionProjection.contentHash, '新修订摘要必须从事务内重新投影的正文生成');
  assert.deepStrictEqual(JSON.parse(insertedRevisionParams[5]), candidateRevisionDocument, '新修订正文必须来自事务内重新校验的document');
  assert.strictEqual(insertedRevisionItem.behavior_name, '工艺人员复核产品制造大纲', '调用方伪造的核对项不得写入');
  assert.strictEqual(updatedRevisionCaseParams[0], candidateRevisionProjection.processName, '调用方伪造的流程名称不得写入');
  assert.deepStrictEqual(JSON.parse(updatedRevisionCaseParams[5]), candidateRevisionProjection.blockingIssues, '调用方伪造的阻断项不得写入');
  const revisionCaseLockIndex = lockedRevisionQueries.findIndex(sql => sql === 'SELECT * FROM process_v7_preview_cases WHERE id=? FOR UPDATE');
  const revisionLockIndex = lockedRevisionQueries.findIndex(sql => sql.includes('FROM process_v7_preview_revisions') && sql.endsWith('FOR UPDATE'));
  const revisionItemsLockIndex = lockedRevisionQueries.findIndex(sql => sql.startsWith('SELECT * FROM process_v7_preview_review_items WHERE case_id=? AND is_current=1 ORDER BY id FOR UPDATE'));
  const revisionFirstWriteIndex = lockedRevisionQueries.findIndex(sql => sql.startsWith('UPDATE ') || sql.startsWith('INSERT '));
  assert.ok(
    revisionCaseLockIndex >= 0 && revisionCaseLockIndex < revisionLockIndex && revisionLockIndex < revisionItemsLockIndex && revisionItemsLockIndex < revisionFirstWriteIndex,
    '上传新修订必须按案例、当前修订、当前核对项id升序锁定后再写入'
  );

  const decisionQueries = [];
  let decisionWrite = null;
  let decisionItem = {
    id: 941,
    case_id: 25,
    revision_id: 251,
    revision_no: 1,
    ...lockedRevisionProjection.items[0],
    item_snapshot_json: JSON.stringify(lockedRevisionProjection.items[0].item_snapshot),
    is_current: 1
  };
  const decisionConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) {
      const normalized = String(sql).trim().replace(/\s+/g, ' ');
      decisionQueries.push(normalized);
      if (normalized === 'SELECT * FROM process_v7_preview_cases WHERE id=? FOR UPDATE') {
        return [[{
          id: 25,
          process_ref: lockedRevisionProjection.processRef,
          owning_department_id: 1,
          owning_department_name: '质量管理部',
          status: 'under_review',
          current_revision_no: 1,
          current_revision_id: 251,
          current_content_hash: lockedRevisionProjection.contentHash,
          blocking_issues_json: '[]',
          scope_decision: null
        }]];
      }
      if (normalized.includes('FROM process_v7_preview_revisions') && normalized.endsWith('FOR UPDATE')) {
        return [[{
          id: 251,
          case_id: 25,
          revision_no: 1,
          content_hash: lockedRevisionProjection.contentHash,
          content_json: JSON.stringify(lockedRevisionDocument)
        }]];
      }
      if (normalized.startsWith('SELECT * FROM process_v7_preview_review_items WHERE case_id=? AND is_current=1 ORDER BY id FOR UPDATE')) {
        return [[decisionItem]];
      }
      if (normalized.startsWith('SELECT id, name, code FROM departments WHERE status=\'active\'')) return [[...departments]];
      if (normalized.startsWith('UPDATE process_v7_preview_review_items SET counterparty_status=')) {
        decisionWrite = { sql: normalized, params };
        decisionItem = { ...decisionItem, counterparty_status: params[0], counterparty_basis: params[1] };
        return [{ affectedRows: 1 }];
      }
      if (normalized === 'SELECT * FROM process_v7_preview_review_items WHERE id=?') return [[decisionItem]];
      if (normalized === 'UPDATE process_v7_preview_review_items SET status=? WHERE id=?') return [{ affectedRows: 1 }];
      if (normalized.startsWith('UPDATE process_v7_preview_cases SET status=')) return [{ affectedRows: 1 }];
      if (normalized.startsWith('INSERT INTO process_v7_preview_events')) return [{ insertId: 942 }];
      throw new Error(`unexpected decision SQL: ${normalized}`);
    }
  };
  const decisionRepository = makeProcessV7PreviewReviewRepository({
    async getConnection() { return decisionConnection; }
  });
  await assert.rejects(
    decisionRepository.decideItem(
      { id: 941, case_id: 25 },
      'origin',
      'confirmed',
      '伪造为归口部门决定。',
      1,
      lockedRevisionProjection.contentHash,
      { userId: 12, personId: 12, departmentId: 2 }
    ),
    error => error && error.statusCode === 403 && error.code === 'V7_PREVIEW_SCOPE_DENIED'
  );
  assert.strictEqual(decisionWrite, null, '仓储必须从锁定核对项和当前操作者部门推导参与方，不能信任调用方party');
  decisionQueries.length = 0;
  const decidedItem = await decisionRepository.decideItem(
    { id: 941, case_id: 25 },
    'counterparty',
    'confirmed',
    '工程技术部已经核对。',
    1,
    lockedRevisionProjection.contentHash,
    { userId: 12, personId: 12, departmentId: 2 }
  );
  assert.ok(decisionWrite && decisionWrite.sql.includes('counterparty_status'), '锁后推导为外部门时只能更新外部门决定列');
  assert.strictEqual(decidedItem.counterparty_status, 'confirmed');
  const decisionCaseLockIndex = decisionQueries.findIndex(sql => sql === 'SELECT * FROM process_v7_preview_cases WHERE id=? FOR UPDATE');
  const decisionRevisionLockIndex = decisionQueries.findIndex(sql => sql.includes('FROM process_v7_preview_revisions') && sql.endsWith('FOR UPDATE'));
  const decisionItemsLockIndex = decisionQueries.findIndex(sql => sql.startsWith('SELECT * FROM process_v7_preview_review_items WHERE case_id=? AND is_current=1 ORDER BY id FOR UPDATE'));
  const decisionFirstWriteIndex = decisionQueries.findIndex(sql => sql.startsWith('UPDATE ') || sql.startsWith('INSERT '));
  assert.ok(
    decisionCaseLockIndex >= 0 && decisionCaseLockIndex < decisionRevisionLockIndex && decisionRevisionLockIndex < decisionItemsLockIndex && decisionItemsLockIndex < decisionFirstWriteIndex,
    '记录部门决定必须按案例、当前修订、当前核对项id升序锁定后再写入'
  );
  delete process.env.PROCESS_V7_PREVIEW_ENABLED;
  delete process.env.PROCESS_V7_TRIAL_PROCESS_REF;

  const lockedScopeQueries = [];
  const lockedScopeConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      lockedScopeQueries.push(String(sql).trim());
      if (/^SELECT \* FROM process_v7_preview_cases WHERE id=\? FOR UPDATE$/.test(String(sql).trim())) {
        return [[{
          id: 1,
          process_ref: 'process_other_trial',
          current_revision_no: 1,
          current_content_hash: projected.contentHash
        }]];
      }
      throw new Error(`unexpected SQL after locked scope check: ${String(sql).trim()}`);
    }
  };
  const lockedScopeRepository = makeProcessV7PreviewReviewRepository({
    async getConnection() { return lockedScopeConnection; }
  });
  process.env.PROCESS_V7_PREVIEW_ENABLED = '0';
  process.env.PROCESS_V7_TRIAL_PROCESS_REF = projected.processRef;
  await assert.rejects(
    lockedScopeRepository.createCase(
      projected,
      { sourceFileName: '开关拒绝.json' },
      { userId: 10, personId: 10 }
    ),
    error => error && error.statusCode === 503 && error.code === 'V7_PREVIEW_DISABLED'
  );
  assert.strictEqual(lockedScopeQueries.length, 0, '预览开关关闭时仓储不得执行SQL');

  process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
  await assert.rejects(
    lockedScopeRepository.addRevision(
      { id: 1 },
      { ...projected, processRef: 'process_other_trial' },
      {
        sourceFileName: '请求范围复核.json',
        expectedRevisionNo: 1,
        expectedContentHash: projected.contentHash
      },
      { userId: 10, personId: 10 }
    ),
    error => error && error.statusCode === 403 && error.code === 'V7_TRIAL_PROCESS_SCOPE_DENIED'
  );
  assert.strictEqual(lockedScopeQueries.length, 0, '请求中的process_ref越界时仓储不得开启事务');

  await assert.rejects(
    lockedScopeRepository.addRevision(
      { id: 1 },
      projected,
      {
        sourceFileName: '范围复核.json',
        expectedRevisionNo: 1,
        expectedContentHash: projected.contentHash
      },
      { userId: 10, personId: 10 }
    ),
    error => error && error.statusCode === 403 && error.code === 'V7_TRIAL_PROCESS_SCOPE_DENIED'
  );
  assert.strictEqual(lockedScopeQueries.length, 1, '仓储在锁定案例并发现越界后不得执行写SQL');

  await assert.rejects(
    lockedScopeRepository.decideItem(
      { id: 101, case_id: 1 },
      'counterparty',
      'confirmed',
      '试图直接绕过试点范围。',
      1,
      projected.contentHash,
      { userId: 12, personId: 12, departmentId: 2 }
    ),
    error => error && error.statusCode === 403 && error.code === 'V7_TRIAL_PROCESS_SCOPE_DENIED'
  );
  assert.strictEqual(lockedScopeQueries.length, 2, '部门决定仓储也必须在锁定案例后按process_ref复核试点范围');

  process.env.PROCESS_V7_FORMAL_ENABLED = '0';
  await assert.rejects(
    lockedScopeRepository.promoteCase(
      { case: { id: 1 } },
      projected,
      { mode: 'create', document_no: 'V7-TEST-001', document_title: '产品制造大纲编制与审批' },
      { expectedRevisionNo: 1, expectedContentHash: projected.contentHash },
      { userId: 14, personId: 14 }
    ),
    error => error && error.statusCode === 503 && error.code === 'V7_FORMAL_DISABLED'
  );
  assert.strictEqual(lockedScopeQueries.length, 2, '正式开关关闭时仓储不得执行提升SQL');
  delete process.env.PROCESS_V7_FORMAL_ENABLED;
  delete process.env.PROCESS_V7_PREVIEW_ENABLED;
  delete process.env.PROCESS_V7_TRIAL_PROCESS_REF;

  const unresolvedDocument = sampleDocument();
  unresolvedDocument.behaviors[1].current_actor_role = '未登记部门工艺员';
  const unresolvedProjection = validateAndProjectV7(unresolvedDocument, departments);
  assert.ok(unresolvedProjection.blockingIssues.some(issue => issue.code === 'ACTOR_DEPARTMENT_UNRESOLVED'));
  assert.notStrictEqual(
    caseStatusFromItems([{ origin_status: 'confirmed', counterparty_status: 'confirmed' }], true, unresolvedProjection.blockingIssues),
    'review_complete',
    'an unresolved fixed execution department must block review completion'
  );

  const blockingPromotionQueries = [];
  const blockingPromotionConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      blockingPromotionQueries.push(String(sql).trim());
      if (/^SELECT \* FROM process_v7_preview_cases WHERE id=\? FOR UPDATE$/.test(String(sql).trim())) {
        return [[{
          id: 1,
          process_ref: unresolvedProjection.processRef,
          status: 'review_complete',
          scope_decision: null,
          current_revision_no: 1,
          current_revision_id: 91,
          current_content_hash: unresolvedProjection.contentHash
        }]];
      }
      if (/^SELECT \* FROM process_v7_preview_revisions/.test(String(sql).trim())) {
        return [[{
          id: 91,
          case_id: 1,
          revision_no: 1,
          content_hash: unresolvedProjection.contentHash,
          content_json: JSON.stringify(unresolvedDocument)
        }]];
      }
      if (/^SELECT id, name, code\s+FROM departments/.test(String(sql).trim())) {
        return [[{ id: 1, name: '质量管理部', code: 'QUALITY' }]];
      }
      throw new Error(`unexpected SQL after locked blocker check: ${String(sql).trim()}`);
    }
  };
  const blockingPromotionRepository = makeProcessV7PreviewReviewRepository({
    async getConnection() { return blockingPromotionConnection; }
  });
  process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
  process.env.PROCESS_V7_FORMAL_ENABLED = '1';
  process.env.PROCESS_V7_TRIAL_PROCESS_REF = unresolvedProjection.processRef;
  await assert.rejects(
    blockingPromotionRepository.promoteCase(
      { case: { id: 1 } },
      unresolvedProjection,
      { mode: 'create', document_no: 'V7-TEST-001', document_title: '产品制造大纲编制与审批' },
      { expectedRevisionNo: 1, expectedContentHash: unresolvedProjection.contentHash },
      { userId: 14, personId: 14 }
    ),
    error => error && error.statusCode === 409 && error.code === 'V7_PREVIEW_BLOCKING_ISSUES'
  );
  assert.strictEqual(blockingPromotionQueries.length, 3, '仓储锁定案例和修订并读取当前部门后，发现阻断项时不得执行提升写SQL');
  delete process.env.PROCESS_V7_PREVIEW_ENABLED;
  delete process.env.PROCESS_V7_FORMAL_ENABLED;
  delete process.env.PROCESS_V7_TRIAL_PROCESS_REF;

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

  const outputChangedDocument = sampleDocument();
  outputChangedDocument.behaviors[1].output_description = '已形成工序和工装核对结果。';
  const outputChangedProjection = validateAndProjectV7(outputChangedDocument, departments);
  const outputChanged = mergeReviewItems(previous, outputChangedProjection.items);
  assert.strictEqual(
    outputChanged[0].carry_state,
    'reopened',
    '完整业务行为中的输出说明变化必须重新打开核对项'
  );

  const evidenceDocument = sampleDocumentWithReviewEvidence();
  const evidenceProjection = validateAndProjectV7(evidenceDocument, departments);
  assert.deepStrictEqual(evidenceProjection.errors, []);
  assert.strictEqual(evidenceProjection.items[0].item_snapshot.digest_version, 'process-v7-review-item-v2');
  assert.strictEqual(evidenceProjection.items[0].item_snapshot.data_objects[0].fields.length, 2);
  assert.deepStrictEqual(evidenceProjection.items[0].item_snapshot.forms[0].behavior_links[0].operations, ['fill', 'review']);

  const evidencePrevious = [{
    ...evidenceProjection.items[0],
    origin_status: 'confirmed',
    counterparty_status: 'confirmed'
  }];
  const dataChangedDocument = sampleDocumentWithReviewEvidence();
  dataChangedDocument.data_objects[0].fields[0].definition = '工序、工装和例外事项的核对结论。';
  const dataChangedProjection = validateAndProjectV7(dataChangedDocument, departments);
  assert.strictEqual(mergeReviewItems(evidencePrevious, dataChangedProjection.items)[0].carry_state, 'reopened');

  const formChangedDocument = sampleDocumentWithReviewEvidence();
  formChangedDocument.forms[0].areas[0].items[0].instructions = '填写核对内容、结论和例外说明。';
  const formChangedProjection = validateAndProjectV7(formChangedDocument, departments);
  assert.strictEqual(mergeReviewItems(evidencePrevious, formChangedProjection.items)[0].carry_state, 'reopened');

  const reorderedEvidenceDocument = sampleDocumentWithReviewEvidence();
  reorderedEvidenceDocument.data_objects[0].fields.reverse();
  reorderedEvidenceDocument.data_objects[0].behavior_links[0].updated_field_refs.reverse();
  reorderedEvidenceDocument.forms[0].behavior_links[0].operations.reverse();
  const reorderedEvidenceProjection = validateAndProjectV7(reorderedEvidenceDocument, departments);
  assert.strictEqual(
    reorderedEvidenceProjection.items[0].item_digest,
    evidenceProjection.items[0].item_digest,
    '只调整无序数组的顺序不得重新打开核对项'
  );

  const unrelatedEvidenceDocument = sampleDocumentWithReviewEvidence();
  const unrelatedDataObject = JSON.parse(JSON.stringify(unrelatedEvidenceDocument.data_objects[0]));
  unrelatedDataObject.data_ref = 'data_compile_note';
  unrelatedDataObject.data_name = '编制说明';
  unrelatedDataObject.fields[0].field_ref = 'field_compile_note';
  unrelatedDataObject.fields[1].field_ref = 'field_compile_date';
  unrelatedDataObject.behavior_links[0] = {
    link_ref: 'data_link_compile_update',
    behavior_ref: 'behavior_compile',
    operation: 'update',
    updated_field_refs: ['field_compile_note', 'field_compile_date']
  };
  unrelatedEvidenceDocument.data_objects.push(unrelatedDataObject);
  const unrelatedEvidenceProjection = validateAndProjectV7(unrelatedEvidenceDocument, departments);
  assert.deepStrictEqual(unrelatedEvidenceProjection.errors, []);
  assert.strictEqual(
    unrelatedEvidenceProjection.items[0].item_digest,
    evidenceProjection.items[0].item_digest,
    '与当前业务行为无关的数据对象不得改变该核对项摘要'
  );

  const legacySnapshotPrevious = [{
    ...evidencePrevious[0],
    item_snapshot: { ...evidencePrevious[0].item_snapshot }
  }];
  delete legacySnapshotPrevious[0].item_snapshot.digest_version;
  assert.strictEqual(
    mergeReviewItems(legacySnapshotPrevious, evidenceProjection.items)[0].carry_state,
    'reopened',
    '缺少摘要版本的旧核对项不得沿用原结论'
  );

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

    delete process.env.PROCESS_V7_TRIAL_PROCESS_REF;
    const trialScopeMissing = await request(baseUrl, 'contact', '/api/process-v7-preview/cases', {
      method: 'POST',
      body: JSON.stringify({ source_file_name: '制造大纲.json', document })
    });
    assert.strictEqual(trialScopeMissing.response.status, 503);
    assert.strictEqual(trialScopeMissing.body.code, 'V7_TRIAL_SCOPE_NOT_CONFIGURED');

    process.env.PROCESS_V7_TRIAL_PROCESS_REF = '*';
    const trialScopeInvalid = await request(baseUrl, 'contact', '/api/process-v7-preview/cases', {
      method: 'POST',
      body: JSON.stringify({ source_file_name: '制造大纲.json', document })
    });
    assert.strictEqual(trialScopeInvalid.response.status, 503);
    assert.strictEqual(trialScopeInvalid.body.code, 'V7_TRIAL_SCOPE_NOT_CONFIGURED');

    process.env.PROCESS_V7_TRIAL_PROCESS_REF = `${projected.processRef},process_other_trial`;
    const trialScopeListInvalid = await request(baseUrl, 'contact', '/api/process-v7-preview/cases', {
      method: 'POST',
      body: JSON.stringify({ source_file_name: '制造大纲.json', document })
    });
    assert.strictEqual(trialScopeListInvalid.response.status, 503);
    assert.strictEqual(trialScopeListInvalid.body.code, 'V7_TRIAL_SCOPE_NOT_CONFIGURED');

    process.env.PROCESS_V7_TRIAL_PROCESS_REF = ` ${projected.processRef} `;
    const trialScopeWhitespaceInvalid = await request(baseUrl, 'contact', '/api/process-v7-preview/cases', {
      method: 'POST',
      body: JSON.stringify({ source_file_name: '制造大纲.json', document })
    });
    assert.strictEqual(trialScopeWhitespaceInvalid.response.status, 503);
    assert.strictEqual(trialScopeWhitespaceInvalid.body.code, 'V7_TRIAL_SCOPE_NOT_CONFIGURED');

    process.env.PROCESS_V7_TRIAL_PROCESS_REF = 'process_other_trial';
    const trialScopeDenied = await request(baseUrl, 'contact', '/api/process-v7-preview/cases', {
      method: 'POST',
      body: JSON.stringify({ source_file_name: '制造大纲.json', document })
    });
    assert.strictEqual(trialScopeDenied.response.status, 403);
    assert.strictEqual(trialScopeDenied.body.code, 'V7_TRIAL_PROCESS_SCOPE_DENIED');

    process.env.PROCESS_V7_TRIAL_PROCESS_REF = projected.processRef;

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

    const originalGetCaseDetail = repository.getCaseDetail;
    repository.getCaseDetail = async () => ({
      ...(await originalGetCaseDetail()),
      formal_promotion: {
        promotion: { preview_revision_no: 1, content_hash: projected.contentHash },
        draft: { id: 701, status: 'draft', revision_no: 1, content_hash: projected.contentHash },
        review_task: null,
        current_version: { id: 801, process_version_id: 'process_version_v7_test' }
      }
    });
    process.env.PROCESS_V7_FORMAL_ENABLED = '1';
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = 'process_other_trial';
    const outOfTrialFormalRead = await request(baseUrl, 'contact', '/api/process-v7-preview/cases/1');
    assert.strictEqual(outOfTrialFormalRead.response.status, 200, '单流程范围不得阻止已授权读取');
    assert.deepStrictEqual(
      outOfTrialFormalRead.body.formal_allowed_actions,
      ['view_formal_draft', 'read_formal_version'],
      '流程不在试点范围时不得广告正式写动作'
    );

    process.env.PROCESS_V7_TRIAL_PROCESS_REF = projected.processRef;
    const inTrialFormalRead = await request(baseUrl, 'contact', '/api/process-v7-preview/cases/1');
    assert.deepStrictEqual(
      inTrialFormalRead.body.formal_allowed_actions,
      ['view_formal_draft', 'read_formal_version', 'submit_formal_draft'],
      '开关、试点范围、权限、状态和摘要全部匹配时才提示提交'
    );

    const matchingFormalDetail = repository.getCaseDetail;
    repository.getCaseDetail = async () => ({
      ...(await originalGetCaseDetail()),
      formal_promotion: {
        promotion: { preview_revision_no: 2, content_hash: 'b'.repeat(64) },
        draft: { id: 701, status: 'draft', revision_no: 2, content_hash: 'b'.repeat(64) },
        review_task: null,
        current_version: { id: 801, process_version_id: 'process_version_v7_test' }
      }
    });
    const stalePromotionFormalRead = await request(baseUrl, 'contact', '/api/process-v7-preview/cases/1');
    assert.deepStrictEqual(
      stalePromotionFormalRead.body.formal_allowed_actions,
      ['view_formal_draft', 'read_formal_version'],
      '提升记录与旧草稿彼此匹配，但不再绑定案例当前修订时，不得提示写动作'
    );
    repository.getCaseDetail = matchingFormalDetail;

    process.env.PROCESS_V7_FORMAL_ENABLED = '0';
    const disabledFormalRead = await request(baseUrl, 'contact', '/api/process-v7-preview/cases/1');
    assert.deepStrictEqual(
      disabledFormalRead.body.formal_allowed_actions,
      ['view_formal_draft', 'read_formal_version'],
      '正式开关关闭时只保留已授权读动作'
    );
    repository.getCaseDetail = originalGetCaseDetail;
    delete process.env.PROCESS_V7_FORMAL_ENABLED;

    const originalListDepartments = repository.listDepartments;
    repository.listDepartments = async () => [{ id: 1, name: '质量管理部', code: 'QUALITY' }];
    repository.getCaseDetail = async () => ({
      ...(await originalGetCaseDetail()),
      case: { ...(await originalGetCaseDetail()).case, status: 'review_complete' },
      formal_promotion: {
        promotion: { preview_revision_no: 1, content_hash: projected.contentHash },
        draft: { id: 701, status: 'submitted', revision_no: 1, content_hash: projected.contentHash },
        review_task: { id: 702, status: 'pending', draft_revision_no: 1, content_hash: projected.contentHash },
        current_version: null
      }
    });
    process.env.PROCESS_V7_FORMAL_ENABLED = '1';
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = projected.processRef;
    const blockingReviewRead = await request(baseUrl, 'originReviewer', '/api/process-v7-preview/cases/1');
    assert.strictEqual(blockingReviewRead.response.status, 200);
    assert.ok(blockingReviewRead.body.blocking_issues.some(issue => issue.code === 'ACTOR_DEPARTMENT_UNRESOLVED'));
    assert.deepStrictEqual(
      blockingReviewRead.body.formal_allowed_actions,
      ['view_formal_draft', 'review_formal_draft'],
      '阻断项只禁止审核通过，不得隐藏退回修改或拒绝入口'
    );
    assert.deepStrictEqual(
      blockingReviewRead.body.formal_allowed_decisions,
      ['needs_changes', 'reject'],
      '当前修订有阻断项时，前端只能提交“需要修改”或“拒绝”'
    );
    const blockingLeadRead = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1');
    assert.ok(
      !blockingLeadRead.body.allowed_actions.includes('promote_to_formal_draft'),
      '当前重新投影仍有阻断项时不得提示提升动作'
    );
    repository.listDepartments = originalListDepartments;
    const nonBlockingReviewRead = await request(baseUrl, 'originReviewer', '/api/process-v7-preview/cases/1');
    assert.deepStrictEqual(
      nonBlockingReviewRead.body.formal_allowed_decisions,
      ['approve', 'needs_changes', 'reject'],
      '当前修订没有阻断项时，部门审核员才能选择审核通过'
    );
    repository.getCaseDetail = originalGetCaseDetail;
    repository.listDepartments = originalListDepartments;
    delete process.env.PROCESS_V7_FORMAL_ENABLED;

    process.env.PROCESS_V7_TRIAL_PROCESS_REF = 'process_other_trial';
    const callsBeforeTrialDeniedDecision = repository.calls.length;
    const trialDeniedDecision = await request(baseUrl, 'targetReviewer', '/api/process-v7-preview/items/101/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'confirmed', basis: '不在试点范围', expected_revision_no: 1, expected_content_hash: projected.contentHash })
    });
    assert.strictEqual(trialDeniedDecision.response.status, 403);
    assert.strictEqual(trialDeniedDecision.body.code, 'V7_TRIAL_PROCESS_SCOPE_DENIED');
    assert.strictEqual(repository.calls.length, callsBeforeTrialDeniedDecision, '范围拒绝不得写入核对结果');
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = projected.processRef;

    const pendingOwnerDocument = sampleDocument();
    pendingOwnerDocument.process.process_ref = 'process_pending_owner_test';
    pendingOwnerDocument.process.owning_department = '';
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = pendingOwnerDocument.process.process_ref;
    const contactPendingOwner = await request(baseUrl, 'contact', '/api/process-v7-preview/cases', {
      method: 'POST',
      body: JSON.stringify({ source_file_name: '待分派.json', document: pendingOwnerDocument })
    });
    assert.strictEqual(contactPendingOwner.response.status, 422);
    assert.strictEqual(contactPendingOwner.body.code, 'V7_PREVIEW_OWNER_PENDING_REQUIRES_LEAD');

    const pendingOwnerProjection = validateAndProjectV7(pendingOwnerDocument, departments);
    const pendingOwnerRepository = makeRepository(pendingOwnerProjection, pendingOwnerDocument);
    previewRouter.setProcessV7PreviewRepositoryFactory(() => pendingOwnerRepository);
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = 'process_other_trial';
    const trialDeniedOwnerAssignment = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1/assign-owner', {
      method: 'POST',
      body: JSON.stringify({
        department_id: 1,
        expected_revision_no: 1,
        expected_content_hash: pendingOwnerProjection.contentHash
      })
    });
    assert.strictEqual(trialDeniedOwnerAssignment.response.status, 403);
    assert.strictEqual(trialDeniedOwnerAssignment.body.code, 'V7_TRIAL_PROCESS_SCOPE_DENIED');
    assert.strictEqual(pendingOwnerRepository.calls.length, 0, '范围拒绝不得分派归口部门');

    previewRouter.setProcessV7PreviewRepositoryFactory(() => repository);
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = projected.processRef;

    const targetDecision = await request(baseUrl, 'targetReviewer', '/api/process-v7-preview/items/101/decision', {
      method: 'POST',
      body: JSON.stringify({
        decision: 'confirmed',
        basis: '承接部门已核对',
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash,
        party: 'origin',
        actor: { personId: 11, departmentId: 1 },
        actor_department_id: 1
      })
    });
    assert.strictEqual(targetDecision.response.status, 200);
    assert.deepStrictEqual(repository.calls.at(-1).slice(0, 3), ['decideItem', 'counterparty', 'confirmed']);
    assert.strictEqual(repository.calls.at(-1)[5], identities.targetReviewer.personId, 'HTTP请求体不得伪造部门决定参与方或操作者');

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
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = 'process_other_trial';
    const trialDeniedRevision = await request(baseUrl, 'contact', '/api/process-v7-preview/cases/1/revisions', {
      method: 'POST',
      body: JSON.stringify({
        source_file_name: '更新稿.json',
        document: changedDocument,
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash
      })
    });
    assert.strictEqual(trialDeniedRevision.response.status, 403);
    assert.strictEqual(trialDeniedRevision.body.code, 'V7_TRIAL_PROCESS_SCOPE_DENIED');
    assert.strictEqual(repository.calls.length, callsBeforeRevisionPreview, '范围拒绝不得写入新修订');
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = projected.processRef;

    const changedProcessDocument = JSON.parse(JSON.stringify(changedDocument));
    changedProcessDocument.process.process_ref = 'process_other_trial';
    const requestScopeDeniedRevision = await request(baseUrl, 'contact', '/api/process-v7-preview/cases/1/revisions', {
      method: 'POST',
      body: JSON.stringify({
        source_file_name: '更换流程标识.json',
        document: changedProcessDocument,
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash
      })
    });
    assert.strictEqual(requestScopeDeniedRevision.response.status, 403);
    assert.strictEqual(requestScopeDeniedRevision.body.code, 'V7_TRIAL_PROCESS_SCOPE_DENIED');
    assert.strictEqual(repository.calls.length, callsBeforeRevisionPreview, '请求中的process_ref越界时不得写入新修订');

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
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = zeroCrossDepartmentProjection.processRef;
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

    process.env.PROCESS_V7_TRIAL_PROCESS_REF = 'process_other_trial';
    const callsBeforeTrialDeniedScopeDecision = zeroRepository.calls.length;
    const trialDeniedScopeDecision = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1/scope-decision', {
      method: 'POST',
      body: JSON.stringify({
        decision: 'confirmed_no_cross_department',
        basis: '当前试点范围不包含该流程。',
        expected_revision_no: 1,
        expected_content_hash: zeroCrossDepartmentProjection.contentHash
      })
    });
    assert.strictEqual(trialDeniedScopeDecision.response.status, 403);
    assert.strictEqual(trialDeniedScopeDecision.body.code, 'V7_TRIAL_PROCESS_SCOPE_DENIED');
    assert.strictEqual(zeroRepository.calls.length, callsBeforeTrialDeniedScopeDecision, '范围拒绝不得写入范围决定');
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = zeroCrossDepartmentProjection.processRef;

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
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = projected.processRef;
    process.env.PROCESS_V7_FORMAL_ENABLED = '1';

    process.env.PROCESS_V7_TRIAL_PROCESS_REF = 'process_other_trial';
    const callsBeforeTrialDeniedPromotion = repository.calls.length;
    const trialDeniedPromotion = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1/promote', {
      method: 'POST',
      body: JSON.stringify({
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash,
        target: { mode: 'create', document_no: 'V7-TEST-001', document_title: '产品制造大纲编制与审批' }
      })
    });
    assert.strictEqual(trialDeniedPromotion.response.status, 403);
    assert.strictEqual(trialDeniedPromotion.body.code, 'V7_TRIAL_PROCESS_SCOPE_DENIED');
    assert.strictEqual(repository.calls.length, callsBeforeTrialDeniedPromotion, '范围拒绝不得提升正式草稿');
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = projected.processRef;

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

    const originalReviewCompleteDepartments = reviewCompleteRepository.listDepartments;
    reviewCompleteRepository.listDepartments = async () => [
      { id: 1, name: '质量管理部', code: 'QUALITY' }
    ];
    const callsBeforeBlockingPromotion = reviewCompleteRepository.calls.length;
    const blockingPromotion = await request(baseUrl, 'lead', '/api/process-v7-preview/cases/1/promote', {
      method: 'POST',
      body: JSON.stringify({
        expected_revision_no: 1,
        expected_content_hash: projected.contentHash,
        target: { mode: 'create', document_no: 'V7-TEST-001', document_title: '产品制造大纲编制与审批' }
      })
    });
    assert.strictEqual(blockingPromotion.response.status, 409);
    assert.strictEqual(blockingPromotion.body.code, 'V7_PREVIEW_BLOCKING_ISSUES');
    assert.deepStrictEqual(blockingPromotion.body.details, [{ code: 'ACTOR_DEPARTMENT_UNRESOLVED' }]);
    assert.strictEqual(reviewCompleteRepository.calls.length, callsBeforeBlockingPromotion, '当前部门重新投影发现阻断项时不得提升');
    reviewCompleteRepository.listDepartments = originalReviewCompleteDepartments;

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
    delete process.env.PROCESS_V7_TRIAL_PROCESS_REF;
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
