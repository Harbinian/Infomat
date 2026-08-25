const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
const {
  getDepartmentByIdAsync,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync,
  requireAuth
} = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const {
  PARTY_STATUSES,
  compareReviewItems,
  validateAndProjectV7
} = require('../processV7PreviewReview');
const { makeProcessV7PreviewReviewRepository } = require('../processV7PreviewReviewRepository');

const DECISIONS = new Set([...PARTY_STATUSES].filter(value => value !== 'pending'));
const SCOPE_DECISIONS = new Set(['confirmed_no_cross_department', 'keep_current_owner', 'accept_source_owner']);
let repositoryFactory = null;
let repositoryPromise = null;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function httpError(statusCode, message, code, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.payload = { error: message, ...(code ? { code } : {}), ...extra };
  return error;
}

function runAction(res, action) {
  return action().catch(error => {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json(error.payload || {
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.actual_revision_no == null ? {} : { actual_revision_no: error.actual_revision_no }),
        ...(error.case_id == null ? {} : { case_id: error.case_id })
      });
    }
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  });
}

function previewBoundary(payload = {}) {
  return {
    ...payload,
    preview_only: true,
    publishable: false,
    formal_process_version_id: null
  };
}

async function repository() {
  if (repositoryFactory) return await repositoryFactory();
  if (!repositoryPromise) {
    repositoryPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      return makeProcessV7PreviewReviewRepository(pool);
    })();
  }
  try {
    return await repositoryPromise;
  } catch (error) {
    repositoryPromise = null;
    throw error;
  }
}

function setProcessV7PreviewRepositoryFactory(factory) {
  repositoryFactory = factory;
  repositoryPromise = null;
}

function resetProcessV7PreviewRepositoryFactory() {
  repositoryFactory = null;
  repositoryPromise = null;
}

async function currentActor(req) {
  const personId = Number(req.session.personId || req.session.userId || 0);
  const userId = Number(req.session.userId || personId || 0);
  const roleRows = await getUserRoleCodesAsync(personId, req.session.role);
  const roleCodes = new Set((Array.isArray(roleRows) ? roleRows : []).map(item => text(item && (item.code || item.role_code))).filter(Boolean));
  const permissionResult = await getUserEffectivePermissionsAsync(personId);
  const permissions = permissionResult && permissionResult.permSet || new Set();
  const department = req.session.departmentId ? await getDepartmentByIdAsync(Number(req.session.departmentId)) : null;
  return {
    userId,
    personId,
    departmentId: department ? Number(department.id || department.department_id) : null,
    departmentName: department ? text(department.name || department.department_name) : '',
    roleCodes,
    permissions,
    canReadGlobal: permissions.has('governance:read-global'),
    canReviewDepartment: permissions.has('governance:review-department'),
    roleCode: roleCodes.has('mdm_lead')
      ? 'mdm_lead'
      : roleCodes.has('department_mdm_reviewer')
        ? 'department_mdm_reviewer'
        : roleCodes.has('department_contact')
          ? 'department_contact'
          : roleCodes.has('admin') ? 'admin' : null
  };
}

function assertCanRead(actor) {
  if ([
    'governance:read-global',
    'governance:read-department',
    'governance:read-assigned-context',
    'governance:read-escalated-context'
  ].some(permission => actor.permissions.has(permission))) return;
  throw httpError(403, '无权查看V7预览核对案例', 'V7_PREVIEW_SCOPE_DENIED');
}

function assertAdminCannotWrite(actor) {
  if (actor.roleCodes.has('admin')) {
    throw httpError(403, '管理员对治理材料只读，不能执行V7预览核对写操作', 'V7_PREVIEW_ADMIN_READ_ONLY');
  }
}

function assertCreatePermission(actor) {
  assertAdminCannotWrite(actor);
  if (actor.permissions.has('governance:draft-department') || actor.permissions.has('governance:assign-work')) return;
  throw httpError(403, '无权建立V7预览核对案例', 'V7_PREVIEW_SCOPE_DENIED');
}

function assertUploadPermission(actor, caseRow) {
  assertAdminCannotWrite(actor);
  if (actor.permissions.has('governance:assign-work')) return;
  if (
    actor.permissions.has('governance:draft-department') &&
    actor.departmentId &&
    Number(caseRow.owning_department_id) === Number(actor.departmentId)
  ) return;
  throw httpError(403, '只有归口部门主对接人或MDM工作组组长可以上传新修订', 'V7_PREVIEW_SCOPE_DENIED');
}

function assertVisible(actor, detail) {
  if (!detail || !detail.case) throw httpError(404, 'V7预览核对案例不存在', 'V7_PREVIEW_CASE_NOT_FOUND');
  if (actor.canReadGlobal) return;
  if (Number(detail.case.owning_department_id) === Number(actor.departmentId)) return;
  if ((detail.items || []).some(item => Number(item.origin_department_id) === Number(actor.departmentId) || Number(item.target_department_id) === Number(actor.departmentId))) return;
  throw httpError(403, '当前人员不是该案例的参与部门', 'V7_PREVIEW_SCOPE_DENIED');
}

function listAllowedActions(actor) {
  const actions = ['view'];
  if (
    !actor.roleCodes.has('admin') &&
    (actor.permissions.has('governance:draft-department') || actor.permissions.has('governance:assign-work'))
  ) actions.push('create_case');
  return actions;
}

function caseAllowedActions(actor, caseRow) {
  const actions = ['view'];
  if (actor.roleCodes.has('admin')) return actions;
  if (actor.permissions.has('governance:assign-work')) {
    actions.push('upload_revision');
    if (!caseRow || !caseRow.owning_department_id) actions.push('assign_owner');
    const scopeIssueCodes = new Set((caseRow && caseRow.blocking_issues || []).map(issue => text(issue && issue.code)));
    if (scopeIssueCodes.has('ZERO_CROSS_DEPARTMENT_SCOPE_PENDING') || scopeIssueCodes.has('OWNING_DEPARTMENT_CHANGE_PENDING')) {
      actions.push('record_scope_decision');
    }
    if (process.env.PROCESS_V7_FORMAL_ENABLED === '1' && caseRow && caseRow.status === 'review_complete') {
      actions.push('promote_to_formal_draft');
    }
  } else if (
    actor.permissions.has('governance:draft-department') &&
    actor.departmentId &&
    caseRow &&
    Number(caseRow.owning_department_id) === Number(actor.departmentId)
  ) actions.push('upload_revision');
  return actions;
}

function formalAllowedActions(actor, detail) {
  const formal = detail && detail.formal_promotion;
  const draft = formal && formal.draft;
  const task = formal && formal.review_task;
  const actions = [];
  if (!draft) return actions;
  actions.push('view_formal_draft');
  if (formal.current_version) actions.push('read_formal_version');
  if (actor.roleCodes.has('admin')) return actions;
  const sameDepartment = Number(detail.case && detail.case.owning_department_id) === Number(actor.departmentId);
  if (
    sameDepartment &&
    ['draft', 'needs_changes'].includes(text(draft.status)) &&
    actor.permissions.has('governance:draft-department') &&
    actor.permissions.has('governance:submit-department')
  ) actions.push('submit_formal_draft');
  if (
    sameDepartment &&
    task && text(task.status) === 'pending' &&
    ['submitted', 'under_review'].includes(text(draft.status)) &&
    actor.permissions.has('governance:review-department')
  ) actions.push('review_formal_draft');
  if (text(draft.status) === 'approved' && actor.permissions.has('governance:publish')) {
    actions.push('publish_formal_draft');
  }
  return actions;
}

router.use((req, res, next) => {
  if (process.env.PROCESS_V7_PREVIEW_ENABLED !== '1') {
    return res.status(503).json({
      error: 'V7预览核对功能当前未启用',
      code: 'V7_PREVIEW_DISABLED',
      preview_only: true,
      publishable: false,
      formal_process_version_id: null
    });
  }
  return next();
});

function sourceFileName(body) {
  const value = text(body && body.source_file_name);
  if (!value) throw httpError(422, '源文件名不能为空', 'V7_PREVIEW_SOURCE_FILE_REQUIRED');
  return value.slice(0, 512);
}

function expectedRevisionNo(body) {
  const value = Number(body && body.expected_revision_no);
  if (!Number.isInteger(value) || value < 1) {
    throw httpError(422, '当前修订号必须是正整数', 'V7_PREVIEW_EXPECTED_REVISION_REQUIRED');
  }
  return value;
}

function expectedContentHash(body) {
  const value = text(body && body.expected_content_hash).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw httpError(422, '当前内容摘要必须是64位SHA-256', 'V7_PREVIEW_EXPECTED_CONTENT_HASH_REQUIRED');
  }
  return value;
}

function requiredBasis(body, label = '核对依据') {
  const basis = text(body && body.basis);
  if (!basis) throw httpError(422, `${label}不能为空`, 'V7_PREVIEW_BASIS_REQUIRED');
  if (basis.length > 4000) throw httpError(422, `${label}不能超过4000字`, 'V7_PREVIEW_BASIS_TOO_LONG');
  return basis;
}

function promotionTarget(body) {
  const target = body && body.target || {};
  const mode = text(target.mode);
  if (mode === 'existing') {
    const documentId = Number(target.document_id);
    if (!Number.isInteger(documentId) || documentId < 1) {
      throw httpError(422, '选择已有主档时必须提供有效的主档标识', 'V7_FORMAL_DOCUMENT_REQUIRED');
    }
    return { mode, document_id: documentId };
  }
  if (mode === 'create') {
    const documentNo = text(target.document_no);
    const documentTitle = text(target.document_title);
    if (!documentNo) throw httpError(422, '新建主档时必须填写制度编号', 'V7_FORMAL_DOCUMENT_NO_REQUIRED');
    if (!documentTitle) throw httpError(422, '新建主档时必须填写制度名称', 'V7_FORMAL_DOCUMENT_TITLE_REQUIRED');
    return { mode, document_no: documentNo.slice(0, 128), document_title: documentTitle.slice(0, 255) };
  }
  throw httpError(422, '必须明确选择新建主档或已有主档', 'V7_FORMAL_TARGET_MODE_REQUIRED');
}

function validatedPreview(body, departments, options = {}) {
  const document = body && (body.document || body.data || body.content);
  const preview = validateAndProjectV7(document, departments, options);
  if (preview.errors.length) {
    throw httpError(422, 'V7文件不符合预览核对要求', 'V7_PREVIEW_CONTENT_INVALID', { details: preview.errors });
  }
  return preview;
}

router.get('/cases', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req);
  assertCanRead(actor);
  const repo = await repository();
  res.json(previewBoundary({
    ...(await repo.listCases(actor, { limit: req.query && req.query.limit })),
    allowed_actions: listAllowedActions(actor)
  }));
}));

router.post('/cases', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req);
  assertCreatePermission(actor);
  const repo = await repository();
  const departments = await repo.listDepartments();
  const preview = validatedPreview(req.body || {}, departments);
  if (!preview.owningDepartment && !actor.permissions.has('governance:assign-work')) {
    throw httpError(422, 'V7尚未明确归口部门，请由MDM工作组组长建立案例并分派', 'V7_PREVIEW_OWNER_PENDING_REQUIRES_LEAD');
  }
  if (
    preview.owningDepartment &&
    !actor.permissions.has('governance:assign-work') &&
    Number(preview.owningDepartment.id) !== Number(actor.departmentId)
  ) {
    throw httpError(403, '部门主对接人只能上传本人部门归口的V7文件', 'V7_PREVIEW_SCOPE_DENIED');
  }
  const result = await repo.createCase(preview, { sourceFileName: sourceFileName(req.body || {}) }, actor);
  res.status(result.idempotent ? 200 : 201).json(previewBoundary({
    ...result,
    warnings: preview.warnings,
    allowed_actions: caseAllowedActions(actor, result.case)
  }));
}));

router.get('/cases/:id', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req);
  assertCanRead(actor);
  const repo = await repository();
  const detail = await repo.getCaseDetail(req.params.id);
  assertVisible(actor, detail);
  const departments = await repo.listDepartments();
  const preview = validateAndProjectV7(detail.revision.document, departments, {
    owningDepartmentName: detail.case.owning_department_name
  });
  const items = (detail.items || []).map(item => {
    const isOrigin = Number(item.origin_department_id) === Number(actor.departmentId);
    const isCounterparty = Number(item.target_department_id) === Number(actor.departmentId);
    return {
      ...item,
      my_party: isOrigin ? 'origin' : isCounterparty ? 'counterparty' : null,
      can_act: Boolean(actor.canReviewDepartment && (isOrigin || isCounterparty)),
      allowed_actions: actor.canReviewDepartment && (isOrigin || isCounterparty)
        ? ['record_department_decision']
        : []
    };
  });
  res.json(previewBoundary({
    ...detail,
    items,
    warnings: preview.warnings || [],
    blocking_issues: preview.blockingIssues || [],
    allowed_actions: caseAllowedActions(actor, { ...detail.case, blocking_issues: preview.blockingIssues || [] }),
    formal_allowed_actions: formalAllowedActions(actor, detail)
  }));
}));

router.get('/cases/:id/formal-targets', requireAuth, (req, res) => runAction(res, async () => {
  if (process.env.PROCESS_V7_FORMAL_ENABLED !== '1') {
    throw httpError(503, 'V7正式承接功能当前未启用', 'V7_FORMAL_DISABLED');
  }
  const actor = await currentActor(req);
  assertAdminCannotWrite(actor);
  if (!actor.roleCodes.has('mdm_lead') || !actor.permissions.has('governance:assign-work')) {
    throw httpError(403, '只有MDM工作组组长可以选择V7正式流程主档', 'V7_FORMAL_SCOPE_DENIED');
  }
  const repo = await repository();
  const detail = await repo.getCaseDetail(req.params.id);
  assertVisible(actor, detail);
  const documentNo = text(req.query && req.query.document_no);
  if (!documentNo) throw httpError(422, '请输入已有流程主档的制度编号', 'V7_FORMAL_DOCUMENT_NO_REQUIRED');
  const document = await repo.findFormalDocumentByNumber(documentNo);
  if (!document) return res.json({ exists: false, accessible: false, document_no: documentNo });
  const accessible = (
    text(document.status) === 'active' &&
    Number(document.owning_department_id) === Number(detail.case.owning_department_id) &&
    (!text(document.process_ref) || text(document.process_ref) === text(detail.case.process_ref))
  );
  res.json({
    exists: true,
    accessible,
    document: accessible ? document : null,
    document_no: documentNo,
    message: accessible ? '已精确找到可选择的流程主档' : '该流程主档不属于当前归口部门、已停用或已绑定其他process_ref'
  });
}));

router.post('/cases/:id/assign-owner', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req);
  assertAdminCannotWrite(actor);
  if (!actor.permissions.has('governance:assign-work')) {
    throw httpError(403, '只有MDM工作组组长可以分派归口部门', 'V7_PREVIEW_SCOPE_DENIED');
  }
  const repo = await repository();
  const detail = await repo.getCaseDetail(req.params.id);
  if (!detail) throw httpError(404, 'V7预览核对案例不存在', 'V7_PREVIEW_CASE_NOT_FOUND');
  if (detail.case.owning_department_id) {
    throw httpError(409, '归口部门已经明确，本期不允许在预览核对中改派', 'V7_PREVIEW_OWNER_ALREADY_ASSIGNED');
  }
  const departmentId = Number(req.body && req.body.department_id);
  const departments = await repo.listDepartments();
  const department = departments.find(item => Number(item.id) === departmentId);
  if (!department) throw httpError(422, '请选择3000当前有效部门', 'V7_PREVIEW_OWNER_INVALID');
  const preview = validatedPreview({ document: detail.revision.document }, departments, { owningDepartmentName: department.name });
  const updated = await repo.assignOwner(detail.case, department, preview, {
    expectedRevisionNo: expectedRevisionNo(req.body || {}),
    expectedContentHash: expectedContentHash(req.body || {})
  }, actor);
  res.json(previewBoundary({ case: updated, warnings: preview.warnings, allowed_actions: caseAllowedActions(actor, updated) }));
}));

router.post('/cases/:id/revisions', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req);
  const repo = await repository();
  const detail = await repo.getCaseDetail(req.params.id);
  if (!detail) throw httpError(404, 'V7预览核对案例不存在', 'V7_PREVIEW_CASE_NOT_FOUND');
  assertUploadPermission(actor, detail.case);
  const departments = await repo.listDepartments();
  const preview = validatedPreview(req.body || {}, departments, {
    owningDepartmentName: detail.case.owning_department_name
  });
  const result = await repo.addRevision(detail.case, preview, {
    sourceFileName: sourceFileName(req.body || {}),
    expectedRevisionNo: expectedRevisionNo(req.body || {}),
    expectedContentHash: expectedContentHash(req.body || {})
  }, actor);
  res.status(result.idempotent ? 200 : 201).json(previewBoundary({
    ...result,
    warnings: preview.warnings,
    allowed_actions: caseAllowedActions(actor, result.case)
  }));
}));

router.post('/cases/:id/revisions/preview', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req);
  const repo = await repository();
  const detail = await repo.getCaseDetail(req.params.id);
  if (!detail) throw httpError(404, 'V7预览核对案例不存在', 'V7_PREVIEW_CASE_NOT_FOUND');
  assertUploadPermission(actor, detail.case);
  const expectedRevision = expectedRevisionNo(req.body || {});
  const expectedHash = expectedContentHash(req.body || {});
  if (Number(expectedRevision) !== Number(detail.case.current_revision_no)) {
    throw httpError(409, '当前案例已经上传新修订，请刷新后重试', 'V7_PREVIEW_REVISION_CONFLICT', {
      actual_revision_no: Number(detail.case.current_revision_no)
    });
  }
  if (expectedHash !== text(detail.case.current_content_hash)) {
    throw httpError(409, '当前案例内容摘要已经变化，请刷新后重试', 'V7_PREVIEW_CONTENT_HASH_CONFLICT');
  }
  const departments = await repo.listDepartments();
  const preview = validatedPreview(req.body || {}, departments, {
    owningDepartmentName: detail.case.owning_department_name
  });
  if (text(detail.case.process_ref) !== preview.processRef) {
    throw httpError(422, '新修订的流程稳定引用与当前案例不一致', 'V7_PREVIEW_PROCESS_REF_MISMATCH');
  }
  res.json(previewBoundary({
    case_id: Number(detail.case.id),
    current_revision_no: Number(detail.case.current_revision_no),
    current_content_hash: text(detail.case.current_content_hash),
    candidate_content_hash: preview.contentHash,
    comparison: compareReviewItems(detail.items || [], preview.items),
    warnings: preview.warnings,
    blocking_issues: preview.blockingIssues,
    allowed_actions: caseAllowedActions(actor, { ...detail.case, blocking_issues: preview.blockingIssues })
  }));
}));

router.post('/cases/:id/scope-decision', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req);
  assertAdminCannotWrite(actor);
  if (!actor.roleCodes.has('mdm_lead') || !actor.permissions.has('governance:assign-work')) {
    throw httpError(403, '只有MDM工作组组长可以记录范围决定', 'V7_PREVIEW_SCOPE_DENIED');
  }
  const decision = text(req.body && req.body.decision);
  if (!SCOPE_DECISIONS.has(decision)) {
    throw httpError(422, '范围决定必须从系统选项中选择', 'V7_PREVIEW_SCOPE_DECISION_INVALID');
  }
  const basis = requiredBasis(req.body || {}, '范围决定依据');
  const repo = await repository();
  const detail = await repo.getCaseDetail(req.params.id);
  if (!detail) throw httpError(404, 'V7预览核对案例不存在', 'V7_PREVIEW_CASE_NOT_FOUND');
  const departments = await repo.listDepartments();
  let preview = validatedPreview({ document: detail.revision.document }, departments, {
    owningDepartmentName: detail.case.owning_department_name
  });
  const issueCodes = new Set((preview.blockingIssues || []).map(issue => text(issue && issue.code)));
  if (decision === 'confirmed_no_cross_department') {
    if (!issueCodes.has('ZERO_CROSS_DEPARTMENT_SCOPE_PENDING')) {
      throw httpError(409, '当前修订不是待确认的零跨部门范围案例', 'V7_PREVIEW_SCOPE_DECISION_NOT_APPLICABLE');
    }
  } else {
    if (!issueCodes.has('OWNING_DEPARTMENT_CHANGE_PENDING')) {
      throw httpError(409, '当前修订没有待处理的归口部门变化', 'V7_PREVIEW_SCOPE_DECISION_NOT_APPLICABLE');
    }
    if (decision === 'accept_source_owner') {
      preview = validatedPreview({ document: detail.revision.document }, departments);
      if (!preview.owningDepartment) {
        throw httpError(422, '当前修订中的归口部门不能作为有效范围决定', 'V7_PREVIEW_OWNER_INVALID');
      }
    }
  }
  const updated = await repo.recordScopeDecision(
    detail.case,
    decision,
    basis,
    preview,
    expectedRevisionNo(req.body || {}),
    expectedContentHash(req.body || {}),
    actor
  );
  res.json(previewBoundary({
    case: updated,
    warnings: preview.warnings,
    blocking_issues: preview.blockingIssues,
    allowed_actions: caseAllowedActions(actor, updated)
  }));
}));

router.post('/cases/:id/promote', requireAuth, (req, res) => runAction(res, async () => {
  if (process.env.PROCESS_V7_FORMAL_ENABLED !== '1') {
    throw httpError(503, 'V7正式承接功能当前未启用', 'V7_FORMAL_DISABLED');
  }
  const repo = await repository();
  const actor = await currentActor(req);
  assertAdminCannotWrite(actor);
  if (!actor.roleCodes.has('mdm_lead') || !actor.permissions.has('governance:assign-work')) {
    throw httpError(403, '只有MDM工作组组长可以把核对完成的V7提升为正式草稿', 'V7_FORMAL_SCOPE_DENIED');
  }
  const detail = await repo.getCaseDetail(req.params.id);
  assertVisible(actor, detail);
  if (text(detail.case.status) !== 'review_complete') {
    throw httpError(409, '当前V7预览案例尚未完成核对，不能提升为正式草稿', 'V7_PREVIEW_REVIEW_INCOMPLETE');
  }
  const expectedRevision = expectedRevisionNo(req.body || {});
  const expectedHash = expectedContentHash(req.body || {});
  const target = promotionTarget(req.body || {});
  const departments = await repo.listDepartments();
  const preview = validatedPreview({ document: detail.revision && detail.revision.document }, departments, {
    owningDepartmentName: detail.case.owning_department_name
  });
  const result = await repo.promoteCase(detail, preview, target, {
    expectedRevisionNo: expectedRevision,
    expectedContentHash: expectedHash
  }, actor);
  res.status(result.idempotent ? 200 : 201).json({
    preview_only: false,
    publishable: false,
    process_version_id: null,
    formal_document_id: result.document && result.document.id || null,
    formal_draft_id: result.draft && result.draft.id || null,
    ...result
  });
}));

router.post('/items/:id/decision', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req);
  assertAdminCannotWrite(actor);
  if (!actor.canReviewDepartment) {
    throw httpError(403, '只有部门MDM审核员可以记录本部门核对结果', 'V7_PREVIEW_SCOPE_DENIED');
  }
  const decision = text(req.body && req.body.decision);
  if (!DECISIONS.has(decision)) {
    throw httpError(422, '核对结果必须从系统选项中选择', 'V7_PREVIEW_DECISION_INVALID');
  }
  const basis = requiredBasis(req.body || {});
  const repo = await repository();
  const item = await repo.getItem(req.params.id);
  if (!item) throw httpError(404, 'V7跨部门核对项不存在', 'V7_PREVIEW_ITEM_NOT_FOUND');
  let party = '';
  if (Number(item.origin_department_id) === Number(actor.departmentId)) party = 'origin';
  else if (Number(item.target_department_id) === Number(actor.departmentId)) party = 'counterparty';
  if (!party) throw httpError(403, '当前审核员所在部门不是该核对项的参与部门', 'V7_PREVIEW_SCOPE_DENIED');
  const result = await repo.decideItem(
    item,
    party,
    decision,
    basis,
    expectedRevisionNo(req.body || {}),
    expectedContentHash(req.body || {}),
    actor
  );
  res.json(previewBoundary({ item: { ...result, allowed_actions: ['record_department_decision'] } }));
}));

router.setProcessV7PreviewRepositoryFactory = setProcessV7PreviewRepositoryFactory;
router.resetProcessV7PreviewRepositoryFactory = resetProcessV7PreviewRepositoryFactory;

module.exports = router;
