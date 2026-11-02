const express = require('express');
const mysql = require('mysql2/promise');
const { logRequestFailure } = require('../securityLog');
const { createRegisteredPool } = require('../mysqlPoolRegistry');
const router = express.Router();
const authoring = require('../processV7Authoring');
const { sessionSubject, identityInteger, sameIdentityInteger } = require('../sessionSubject');
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
  unresolvedBlockingIssues,
  validateAndProjectProcess
} = require('../processPreviewReview');
const { makeProcessPreviewReviewRepository } = require('../processPreviewReviewRepository');
const {
  assertV7TrialProcessRef,
  assertV7TrialScopeConfigured,
  isV7TrialProcessRefAllowed
} = require('../processV7TrialScope');

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
    logRequestFailure(res, error);
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
      const pool = createRegisteredPool(process.env, 'processPreviewReview');
      return makeProcessPreviewReviewRepository(pool);
    })();
  }
  try {
    return await repositoryPromise;
  } catch (error) {
    repositoryPromise = null;
    throw error;
  }
}

function setProcessPreviewRepositoryFactory(factory) {
  repositoryFactory = factory;
  repositoryPromise = null;
}

function resetProcessPreviewRepositoryFactory() {
  repositoryFactory = null;
  repositoryPromise = null;
}

async function currentActor(req) {
  const subject = sessionSubject(req.session, req.identity);
  const systemIdentity = subject.kind === 'system_admin';
  const personId = systemIdentity ? null : identityInteger(subject.personId);
  const userId = personId;
  const principal = subject.principal;
  const roleRows = await getUserRoleCodesAsync(principal, req.session.role);
  const roleCodes = new Set((Array.isArray(roleRows) ? roleRows : []).map(item => text(item && (item.code || item.role_code))).filter(Boolean));
  const permissionResult = await getUserEffectivePermissionsAsync(principal);
  const permissions = permissionResult && permissionResult.permSet || new Set();
  const department = req.session.departmentId ? await getDepartmentByIdAsync(identityInteger(req.session.departmentId)) : null;
  const actor = {
    userId,
    personId,
    identityKind: subject.kind,
    accountId: identityInteger(subject.accountId),
    authVersion: identityInteger(subject.authVersion),
    departmentId: department ? identityInteger(req.session.departmentId) : null,
    departmentName: department ? text(department.name || department.department_name) : '',
    roleCodes,
    permissions,
    canReadGlobal: permissions.has('governance:read-global'),
    isDepartmentFinalResponsible: Boolean(department && sameIdentityInteger(department.final_responsible_person_id,personId)),
    canReviewDepartment: false,
    roleCode: roleCodes.has('mdm_lead')
      ? 'mdm_lead'
      : roleCodes.has('department_mdm_reviewer')
        ? 'department_mdm_reviewer'
        : roleCodes.has('department_contact')
          ? 'department_contact'
          : roleCodes.has('admin') ? 'admin' : null
  };
  const repo = await repository();
  actor.departmentAccountability = await repo.departmentAccountability(actor, actor.departmentId);
  actor.canReviewDepartment = Boolean(actor.departmentAccountability.eligible);
  return actor;
}

function assertCanRead(actor) {
  if(actor.personId)return; // Each row/detail still requires its current department or explicit assignment.
  if ([
    'governance:read-global',
    'governance:read-department',
    'governance:read-assigned-context',
    'governance:read-escalated-context'
  ].some(permission => actor.permissions.has(permission))) return;
  throw httpError(403, '无权查看流程预览核对案例', 'V7_PREVIEW_SCOPE_DENIED');
}

function assertAdminCannotWrite(actor) {
  if (sessionSubject(actor).kind === 'system_admin' || actor.roleCodes.has('admin')) {
    throw httpError(403, '管理员对治理材料只读，不能执行流程预览核对写操作', 'V7_PREVIEW_ADMIN_READ_ONLY');
  }
}

function assertCreatePermission(actor) {
  assertAdminCannotWrite(actor);
  if (actor.roleCodes.has('department_contact')&&actor.permissions.has('governance:draft-department')&&actor.permissions.has('governance:submit-department')) return;
  throw httpError(403, '无权建立流程预览核对案例', 'V7_PREVIEW_SCOPE_DENIED');
}

async function assertUploadPermission(actor, caseRow, repo) {
  assertAdminCannotWrite(actor);
  require('../processCaseGovernance').assertSubmitter(actor,caseRow.owning_department_id);
  if (
    actor.permissions.has('governance:draft-department') &&
    actor.departmentId &&
    sameIdentityInteger(caseRow.owning_department_id, actor.departmentId)
  ) return;
  throw httpError(403, '只有实际归口部门当前有效主对接人本人可以上传新修订', 'V7_PREVIEW_SCOPE_DENIED');
}

async function assertVisible(actor, detail, repo) {
  if (!detail || !detail.case) throw httpError(404, '流程预览核对案例不存在', 'V7_PREVIEW_CASE_NOT_FOUND');
  if (actor.canReadGlobal) return;
  if (actor.isDepartmentFinalResponsible && sameIdentityInteger(detail.case.owning_department_id,actor.departmentId)) return;
  if (repo?.canReadAssigned && await repo.canReadAssigned(detail.case.id, actor)) return;
  const departmentReader = actor.permissions.has('governance:read-department');
  if (departmentReader && sameIdentityInteger(detail.case.owning_department_id, actor.departmentId)) return;
  if (departmentReader && (detail.items || []).some(item => sameIdentityInteger(item.origin_department_id, actor.departmentId) || sameIdentityInteger(item.target_department_id, actor.departmentId))) return;
  throw httpError(403, '当前人员不是该案例的参与部门', 'V7_PREVIEW_SCOPE_DENIED');
}

function listAllowedActions(actor) {
  const actions = ['view'];
  if (
    !actor.roleCodes.has('admin') &&
    actor.roleCodes.has('department_contact')&&actor.permissions.has('governance:draft-department')&&actor.permissions.has('governance:submit-department')
  ) actions.push('create_case');
  if (authoring.enabled() && !actor.roleCodes.has('admin') && actor.roleCodes.has('department_contact') && actor.permissions.has('governance:read-department')) actions.push('department_overview');
  return actions;
}

function caseAllowedActions(actor, caseRow) {
  const actions = ['view'];
  if (actor.roleCodes.has('admin')) return actions;
  if (!caseRow || !isV7TrialProcessRefAllowed(caseRow.process_ref)) return actions;
  if (actor.permissions.has('governance:assign-work')) {
    // The repository rejects the retired owner/scope shortcuts. Retained
    // historical cases stay readable without advertising those write actions.
    if (
      process.env.PROCESS_V7_FORMAL_ENABLED === '1' &&
      caseRow &&
      caseRow.status === 'review_complete' &&
      unresolvedBlockingIssues(caseRow.blocking_issues, text(caseRow.scope_decision)).length === 0
    ) {
      actions.push('promote_to_formal_draft');
    }
  }
  if (
    actor.roleCodes.has('department_contact')&&actor.permissions.has('governance:submit-department')&&actor.permissions.has('governance:draft-department') &&
    actor.departmentId &&
    caseRow &&
    sameIdentityInteger(caseRow.owning_department_id, actor.departmentId)
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
  if (process.env.PROCESS_V7_FORMAL_ENABLED !== '1') return actions;
  if (['submitted','under_review'].includes(text(draft.status)) && sameIdentityInteger(draft.submitted_by,actor.personId) &&
    actor.roleCodes.has('department_contact')&&sameIdentityInteger(actor.departmentId,draft.department_id)&&actor.permissions.has('governance:draft-department')&&actor.permissions.has('governance:submit-department')) actions.push('withdraw_formal_draft');
  if (['approved','rejected'].includes(text(draft.status)) && sameIdentityInteger(draft.department_id,actor.departmentId) && actor.canReviewDepartment) actions.push('return_formal_draft');
  if (!isV7TrialProcessRefAllowed(detail.case && detail.case.process_ref)) return actions;
  const hasBlockingIssues = detail.preview_confirmation?.valid !== true || unresolvedBlockingIssues(
    detail.case && detail.case.blocking_issues,
    text(detail.case && detail.case.scope_decision)
  ).length > 0;
  const promotion = formal.promotion;
  const promotionEvidenceMatches = Boolean(
    promotion &&
    Number(promotion.preview_revision_no) === Number(detail.case && detail.case.current_revision_no) &&
    text(promotion.content_hash) === text(detail.case && detail.case.current_content_hash) &&
    Number(promotion.preview_revision_no) === Number(draft.revision_no) &&
    text(promotion.content_hash) &&
    text(promotion.content_hash) === text(draft.content_hash)
  );
  const taskEvidenceMatches = Boolean(
    task &&
    Number(task.draft_revision_no) === Number(draft.revision_no) &&
    text(task.content_hash) &&
    text(task.content_hash) === text(draft.content_hash)
  );
  const sameDepartment = sameIdentityInteger(detail.case && detail.case.owning_department_id, actor.departmentId);
  if (
    promotionEvidenceMatches &&
    !hasBlockingIssues && detail.preview_confirmation?.valid === true &&
    sameDepartment &&
    ['draft', 'needs_changes'].includes(text(draft.status)) &&
    actor.roleCodes.has('department_contact')&&actor.permissions.has('governance:draft-department')&&actor.permissions.has('governance:submit-department')
  ) actions.push('submit_formal_draft');
  if (
    taskEvidenceMatches &&
    sameDepartment &&
    task && text(task.status) === 'pending' &&
    ['submitted', 'under_review'].includes(text(draft.status)) &&
    actor.canReviewDepartment
  ) actions.push('review_formal_draft');
  if (
    promotionEvidenceMatches &&
    taskEvidenceMatches &&
    !hasBlockingIssues &&
    text(task && task.status) === 'approved' &&
    text(draft.status) === 'approved' &&
    actor.permissions.has('governance:publish') && formal.department_confirmation?.valid === true && detail.preview_confirmation?.valid === true
  ) {
    actions.push('publish_formal_draft');
  }
  return actions;
}

function formalAllowedDecisions(actions, detail) {
  if (!Array.isArray(actions) || !actions.includes('review_formal_draft')) return [];
  const draft = detail.formal_promotion && detail.formal_promotion.draft;
  const sourceMatches = draft && Number(draft.revision_no) === Number(detail.case.current_revision_no) && draft.content_hash === detail.case.current_content_hash;
  const hasBlockingIssues = !sourceMatches || detail.preview_confirmation?.valid !== true || unresolvedBlockingIssues(
    detail && detail.case && detail.case.blocking_issues,
    text(detail && detail.case && detail.case.scope_decision)
  ).length > 0;
  return hasBlockingIssues
    ? ['needs_changes', 'reject']
    : ['approve', 'needs_changes', 'reject'];
}

// Read availability before the disabled-feature gate; this does not grant case access.
router.get('/status', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store').json(previewBoundary({
    enabled: process.env.PROCESS_V7_PREVIEW_ENABLED === '1',
    formal_enabled: process.env.PROCESS_V7_PREVIEW_ENABLED === '1' && process.env.PROCESS_V7_FORMAL_ENABLED === '1'
  }));
});

router.use((req, res, next) => {
  if (process.env.PROCESS_V7_PREVIEW_ENABLED !== '1') {
    return res.status(503).json({
      error: '流程预览核对功能当前未启用',
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
  const preview = validateAndProjectProcess(document, departments, options);
  if (preview.errors.length) {
    throw httpError(422, '流程JSON文件不符合预览核对要求', 'V7_PREVIEW_CONTENT_INVALID', { details: preview.errors, content_checks: preview.contentChecks });
  }
  return preview;
}

// Read-only diagnosis before upload. Uses current authorized departments; no case writes.
router.post('/checks', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req);
  if (![...actor.permissions].some(permission => ['governance:assign-work', 'governance:draft-department', 'governance:read-global', 'governance:read-department'].includes(permission)) && !actor.roleCodes.has('admin')) {
    throw httpError(403, '当前身份无权检查流程材料', 'V7_PREVIEW_SCOPE_DENIED');
  }
  const repo = await repository();
  const preview = validateAndProjectProcess(req.body?.document, await repo.listDepartments());
  res.json(previewBoundary({ content_checks: preview.contentChecks, warnings: preview.warnings,
    blocking_issues: preview.blockingIssues, valid: preview.errors.length === 0 }));
}));

router.get('/department-overview', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req), repo = await repository();
  res.json(previewBoundary(await repo.departmentOverview(actor, req.query.before)));
}));

router.get('/cases/:id/authoring-issues', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req), repo = await repository();
  res.json(await repo.authoringIssues(req.params.id, actor, req.query.after));
}));

router.post('/cases/:id/authoring-issues/:issueId/reply', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req), repo = await repository();
  res.json({ ...(await repo.replyAuthoringIssue(req.params.id, req.params.issueId, req.body || {}, actor)), authoring_reply_only: true });
}));

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
  assertV7TrialScopeConfigured();
  const repo = await repository();
  const departments = await repo.listDepartments();
  const preview = validatedPreview(req.body || {}, departments);
  assertV7TrialProcessRef(preview.processRef);
  if(!preview.owningDepartment)throw httpError(422,'流程归口必须明确','V7_PREVIEW_OWNER_REQUIRED');
  require('../processCaseGovernance').assertSubmitter(actor,preview.owningDepartment.id);
  const result = await repo.createCase(preview, { sourceFileName: sourceFileName(req.body || {}),submission:req.body.submission }, actor);
  res.status(result.idempotent ? 200 : 201).json(previewBoundary({
    ...result,
    warnings: preview.warnings,
    allowed_actions: caseAllowedActions(actor, result.case)
  }));
}));

async function describeCaseForActor(repo, actor, detail) {
  await assertVisible(actor, detail, repo);
  const departmentAccountability = await repo.departmentAccountability(actor, actor.departmentId);
  actor = { ...actor, departmentAccountability, canReviewDepartment: departmentAccountability.eligible };
  const binding = repo.describeAuthoring ? await repo.describeAuthoring(detail.case, actor) : null;
  const departments = await repo.listDepartments();
  const preview = validateAndProjectProcess(detail.revision.document, departments, {
    owningDepartmentName: detail.case.owning_department_name,manualParticipants:detail.governance?.submission?.participants
  });
  const blockingIssues=[...(preview.blockingIssues||[]),...(detail.governance?.blocking_issues||[])];
  const items = (detail.items || []).map(item => {
    const isOrigin = sameIdentityInteger(item.origin_department_id, actor.departmentId);
    const isCounterparty = sameIdentityInteger(item.target_department_id, actor.departmentId);
    const canAct = Boolean(actor.canReviewDepartment && !actor.roleCodes.has('admin') &&
      detail.case.status !== 'closed' && detail.governance?.lifecycle!=='paused'&&detail.governance?.lifecycle!=='terminated'&&isV7TrialProcessRefAllowed(detail.case.process_ref) && (isOrigin || isCounterparty));
    return {
      ...item,
      my_party: isOrigin ? 'origin' : isCounterparty ? 'counterparty' : null,
      can_act: canAct,
      allowed_actions: canAct
        ? ['record_department_decision']
        : []
    };
  });
  const formalDetail = {
    ...detail,
    authoring: binding,
    case: { ...detail.case, blocking_issues: blockingIssues }
  };
  const formalActions = formalAllowedActions(actor, formalDetail);
  const result = {
    ...detail,
    department_accountability: actor.departmentAccountability,
    formal_promotion: detail.formal_promotion ? { ...detail.formal_promotion,
      department_accountability: await repo.departmentAccountability(actor, detail.formal_promotion.draft.department_id) } : null,
    items,
    warnings: preview.warnings || [],
    content_checks: preview.contentChecks,
    blocking_issues: blockingIssues,
    allowed_actions: caseAllowedActions(actor, { ...detail.case, blocking_issues: blockingIssues }),
    formal_allowed_actions: formalActions,
    formal_allowed_decisions: formalAllowedDecisions(formalActions, formalDetail)
  };
  if (binding) result.authoring = binding;
  if (binding?.managed) {
    result.allowed_actions = result.allowed_actions.filter(a => a !== 'upload_revision');
    if (actor.roleCodes.has('department_contact')&&actor.permissions.has('governance:draft-department')&&actor.permissions.has('governance:submit-department')&&sameIdentityInteger(actor.departmentId,detail.case.owning_department_id)) result.allowed_actions.push('upload_revision');
    if (binding.transfer_available) result.allowed_actions.push('transfer_authoring');
    if (binding.can_coordinate) result.allowed_actions.push('coordinate_authoring');
    if (binding.can_record) result.allowed_actions.push('record_authoring');
  }
  result.handling_summary = caseHandlingSummary(result);
  if (result.handling_summary.current_promotion) result.allowed_actions = result.allowed_actions.filter(action => action !== 'promote_to_formal_draft');
  if (detail.preview_confirmation?.valid !== true) result.allowed_actions = result.allowed_actions.filter(action => action !== 'promote_to_formal_draft');
  if(detail.governance){
    const g=detail.governance,lead=actor.roleCodes.has('mdm_lead')&&actor.permissions.has('governance:assign-work')&&!actor.roleCodes.has('admin');
    const contact=actor.roleCodes.has('department_contact')&&actor.permissions.has('governance:draft-department')&&actor.permissions.has('governance:submit-department')&&sameIdentityInteger(actor.departmentId,detail.case.owning_department_id)&&!actor.roleCodes.has('admin');
    const participant=(g.submission?.participants||[]).some(p=>sameIdentityInteger(p.department_id,actor.departmentId));
    const actions=[];
    if(contact&&g.lifecycle==='active')actions.push('save_submission');
    if(participant&&actor.canReviewDepartment)actions.push('confirm_submission');
    if(lead||contact)actions.push('propose_change');
    if(actor.canReviewDepartment&&g.changes.some(x=>x.current&&x.state==='pending'&&x.change.required_department_ids.some(d=>sameIdentityInteger(d,actor.departmentId))))actions.push('confirm_change');
    if(lead&&g.changes.some(x=>x.current&&x.state==='pending'&&x.kind!=='submission'))actions.push('register_change');
    if(g.changes.some(x=>x.state==='pending'&&(lead||sameIdentityInteger(x.proposed_by_person_id,actor.personId))))actions.push('cancel_change');
    if(actor.canReviewDepartment&&sameIdentityInteger(actor.departmentId,detail.case.owning_department_id)&&detail.formal_promotion?.current_version)actions.push('record_acceptance');
    const changes=g.changes.map(change=>{
      const allowed=[];
      if(g.schema_ready&&!actor.roleCodes.has('admin')){
        if(change.current&&change.state==='pending'&&actor.canReviewDepartment&&change.change.required_department_ids.some(d=>sameIdentityInteger(d,actor.departmentId)))allowed.push('confirm');
        if(change.current&&change.state==='pending'&&change.kind!=='submission'&&lead&&(change.confirmation_states||[]).length===change.change.required_department_ids.length&&(change.confirmation_states||[]).every(x=>x.valid))allowed.push('register');
        if(change.state==='pending'&&(lead||sameIdentityInteger(change.proposed_by_person_id,actor.personId)))allowed.push('cancel');
      }
      return {...change,allowed_actions:allowed};
    });
    result.governance={...g,changes,allowed_actions:g.schema_ready?actions:[]};
    if(g.lifecycle!=='active')result.allowed_actions=result.allowed_actions.filter(a=>!['upload_revision','promote_to_formal_draft'].includes(a));
  }
  return result;
}

function caseHandlingSummary(detail) {
  const formal = detail.formal_promotion || {};
  const draft = formal.draft || {};
  const task = formal.review_task || {};
  const returns = [];
  for (const item of detail.items || []) {
    for (const party of ['origin', 'counterparty']) {
      if (item[party + '_status'] === 'needs_changes') returns.push({
        item_id: item.id,
        department: party === 'origin' ? item.origin_department_name : item.target_department_name,
        reason: item[party + '_basis'] || '尚未提供退回依据，请联系该部门核对',
        behavior: item.behavior_name
      });
    }
  }
  if (['needs_changes', 'rejected'].includes(draft.status) && task.decision_note) {
    returns.push({ review_task_id: task.id, department: detail.case.owning_department_name, reason: task.decision_note });
  }
  const prerequisites = (detail.blocking_issues || []).filter(issue =>
    unresolvedBlockingIssues([issue], detail.case.scope_decision).length).map(issue => issue.message);
  for (const item of detail.items || []) {
    if (item.origin_status !== 'confirmed' || item.department_confirmations?.origin?.valid !== true) prerequisites.push(item.origin_department_name + '负责人本人需完成“' + item.behavior_name + '”核对');
    if (item.counterparty_status !== 'confirmed' || item.department_confirmations?.counterparty?.valid !== true) prerequisites.push(item.target_department_name + '负责人本人需完成“' + item.behavior_name + '”核对');
  }
  const promotion = formal.promotion;
  const currentPromotion = Boolean(promotion && Number(promotion.preview_revision_no) === Number(detail.case.current_revision_no) &&
    promotion.content_hash === detail.case.current_content_hash);
  if (draft.id && (Number(promotion && promotion.preview_revision_no) !== Number(draft.revision_no) ||
    text(promotion && promotion.content_hash) !== text(draft.content_hash))) prerequisites.push('正式草稿与提升依据不一致，请由MDM工作组核对当前修订后再办理');
  if (['submitted', 'under_review', 'approved'].includes(draft.status) && (!task.id ||
    Number(task.draft_revision_no) !== Number(draft.revision_no) || text(task.content_hash) !== text(draft.content_hash))) {
    prerequisites.push('审核记录缺失或与当前草稿不一致，请由归口部门负责人与MDM工作组核对');
  }
  if (draft.status === 'approved' && task.status !== 'approved') prerequisites.push('当前审核任务尚未通过，不能发布');
  if (draft.status === 'approved' && formal.department_confirmation?.valid !== true) prerequisites.push('原批准缺少现任部门负责人本人的有效确认；由当前负责人退回修改，主对接人可按同一正文重新提交确认');
  if (draft.id && process.env.PROCESS_V7_FORMAL_ENABLED !== '1') prerequisites.push('正式办理入口暂不可用，请联系维护人员核对开放条件');
  if (!currentPromotion) prerequisites.push('部门核对完成后，由MDM工作组组长将当前修订提升为正式草稿');
  else if (['draft', 'needs_changes'].includes(draft.status)) prerequisites.push('归口部门主对接人提交当前正式草稿供部门负责人确认');
  else if (['submitted', 'under_review'].includes(draft.status)) prerequisites.push('归口部门负责人本人完成当前修订的最终确认');
  else if (draft.status === 'approved') prerequisites.push('MDM工作组组长核对负责人确认依据后发布正式版本');
  else if (draft.status === 'rejected') prerequisites.push('正式审核已拒绝，请与归口部门负责人和MDM工作组核对后续处理方式');
  return { return_reasons: returns, prerequisites: [...new Set(prerequisites)], current_promotion: currentPromotion };
}

// Read projection of existing cases/items/promotions/tasks; no new task records or engine.
async function listProcessWorkbenchItems(actor) {
  if (process.env.PROCESS_V7_PREVIEW_ENABLED !== '1' || actor.roleCodes.has('admin')) return [];
  assertCanRead(actor);
  const repo = await repository();
  const accountability = await repo.departmentAccountability(actor, actor.departmentId);
  actor = { ...actor, departmentAccountability: accountability, canReviewDepartment: accountability.eligible };
  const listing = await repo.listCases(actor, { limit: 200 });
  const result = [];
  const { ROLE_GUIDES } = require('../roleDefinitions');
  for (const row of listing.items || []) {
    if (row.status === 'closed') continue;
    const detail = await describeCaseForActor(repo, actor, await repo.getCaseDetail(row.id));
    const c = detail.case;
    const formal = detail.formal_promotion || {};
    const draft = formal.draft || {};
    const task = formal.review_task || {};
    const allowed = detail.allowed_actions || [];
    const formalAllowed = detail.formal_allowed_actions || [];
    function add(type, id, label, permissions, extra = {}) {
      if (!permissions.every(permission => actor.permissions.has(permission))) return;
      const sourceRoles = ROLE_GUIDES.filter(role => actor.roleCodes.has(role.code) &&
        permissions.every(permission => (role.permissions || []).some(p => p.code === permission))).map(role => role.code);
      result.push({ id: type + ':' + id, type, governanceType: type, title: label + '：' + c.process_name,
        source: c.case_ref, department: c.owning_department_name, currentStatus: draft.status || c.status,
        caseId: c.id, revisionNo: c.current_revision_no, contentHash: c.current_content_hash,
        target: '#/processGovernance?workspace=v7Preview&v7Case=' + c.id,
        actionLabel: label, nextStep: label, canAct: true, sourceRoles, roleHint: sourceRoles[0],
        requiredPermissions: permissions, urgency: type === 'v7_returned' ? 'high' : 'medium',
        sample: '案例 ' + c.case_ref + '，当前修订 ' + c.current_revision_no + '。' + detail.handling_summary.prerequisites.join('；'), ...extra });
    }
    for (const item of detail.items || []) {
      const status = item.my_party === 'origin' ? item.origin_status : item.counterparty_status;
      if (item.can_act && (['pending', 'pending_evidence'].includes(status) || (status === 'confirmed' && item.department_confirmations?.[item.my_party]?.valid !== true))) add('v7_preview_review', item.id, '核对本部门事实', ['governance:review-department'], {
        target: detail.authoring?.can_record ? '/app/process-preview?case=' + c.id : '#/processGovernance?workspace=v7Preview&v7Case=' + c.id + '&v7Item=' + item.id,
        reviewItemId: item.id, currentStatus: status, sample: item.behavior_name + '：查看当前修订和原文依据，填写本部门结论；保存后交另一参与部门核对。'
      });
    }
    if (allowed.includes('upload_revision') && detail.handling_summary.return_reasons.length &&
      ((detail.items || []).some(item => item.origin_status === 'needs_changes' || item.counterparty_status === 'needs_changes') ||
       (draft.status === 'needs_changes' && detail.handling_summary.current_promotion))) {
      const permissions = detail.authoring?.can_record ? [] : [actor.permissions.has('governance:assign-work') ? 'governance:assign-work' : 'governance:draft-department'];
      add('v7_returned', c.id, '按退回原因上传新修订', permissions, {
        ...(detail.authoring?.can_record ? { target: '/app/process-preview?case=' + c.id } : {}),
        sample: detail.handling_summary.return_reasons.map(r => r.department + '：' + r.reason).join('；') +
          '。回3001修改并下载后，上传至案例 ' + c.case_ref + '；受影响部门重新核对。'
      });
    }
    const g=detail.governance;
    if(g?.schema_ready){
      const governanceAllowed=g.allowed_actions||[],participants=g.submission?.participants||[];
      const incomplete=!g.submission||g.submission.missing?.length||!participants.length;
      const target='/app/process-preview?case='+encodeURIComponent(c.id);
      function addGovernance(type,id,label,permissions,guide,extra={}){
        add(type,id,label,permissions,{target,handlingGuide:guide,sample:guide.operation+guide.result,...extra});
      }
      if(incomplete){
        if(governanceAllowed.includes('save_submission'))addGovernance('v7_submission_materials',c.id,'补齐本流程提交材料与参与范围',['governance:draft-department','governance:submit-department'],{
          actor:'归口部门主对接人',operation:'打开本流程的“本次核对”，点击“补充本次提交材料”；也可展开“补充材料或办理其他事项”后选择同名按钮。按实际来源补齐材料、参与部门和责任范围，填写“本次办理依据”，点击“保存本次办理”。',
          result:'保存后在“阅读本次提交材料”和“核对本部门责任范围”查看；由相关部门现任负责人分别确认，主对接人不代确认。'});
      }else{
        const digest=require('../processCaseGovernance').digest;
        const material=[...(g.changes||[])].reverse().find(change=>change.kind==='submission'&&change.current&&change.state!=='cancelled'
          &&change.change?.submission_id===g.submission_id&&change.change?.submission_digest===digest(g.submission));
        const mine=material?.confirmation_states?.find(state=>sameIdentityInteger(state.department_id,actor.departmentId));
        const ownRequired=material?.change?.required_department_ids?.some(id=>sameIdentityInteger(id,actor.departmentId));
        if(material&&ownRequired&&(mine?.valid!==true||mine?.reason==='functional_test_only')&&governanceAllowed.includes('confirm_submission'))addGovernance('v7_submission_confirmation',material.change_id,'本人确认提交材料及本部门范围',['governance:review-department'],{
          actor:'本部门当前已登记且具有有效授权的负责人',operation:'打开本流程的“本次核对”，先阅读提交材料及本部门责任范围，点击“本人确认提交材料及本部门范围”，填写“本次办理依据”，再点击“保存本次办理”。功能测试记录不能代替本次业务确认。',
          result:'保存后在“确认结果”核对本部门状态，展开“优化建议、制度版次与历史记录”查看确认时间和依据；其他部门仍须分别确认。'},{governanceChangeId:material.change_id,submissionId:g.submission_id});
        const materialConfirmed=material?.state==='registered'&&Array.isArray(material.confirmation_states)
          &&material.change.required_department_ids.length>0
          &&material.confirmation_states.length===material.change.required_department_ids.length
          &&material.change.required_department_ids.every(id=>material.confirmation_states.some(state=>sameIdentityInteger(state.department_id,id)&&state.valid===true&&state.reason!=='functional_test_only'));
        const pending=(g.changes||[]).filter(change=>change.current&&change.state==='pending');
        const hasBlockingPending=(g.changes||[]).some(change=>change.state==='pending'&&(change.kind!=='submission'||change.current&&change.change?.submission_id===g.submission_id&&change.change?.submission_digest===digest(g.submission)));
        const deadlineInvalid=(g.blocking_issues||[]).some(issue=>issue.code==='PROCESS_CASE_DEADLINE_RECONFIRMATION_REQUIRED');
        if(materialConfirmed&&(!g.deadline||deadlineInvalid)&&!hasBlockingPending&&governanceAllowed.includes('propose_change'))addGovernance('v7_deadline_proposal',c.id,deadlineInvalid?'重新约定本流程办理截止日期':'提出本流程办理截止日期',['governance:assign-work'],{
          actor:'MDM工作组组长',operation:'打开本流程的“本次核对”，展开“补充材料或办理其他事项”，点击“约定本次办理时限”；选择约定完成日期及本轮全部参与部门，填写实际约定原因和本次办理依据，点击“保存本次办理”。',
          result:'保存后在“需要确认或登记的具体事项”查看提出的日期和参与部门；相关部门负责人分别确认后，由组长登记。'});
        for(const change of pending.filter(value=>value.kind==='deadline'&&value.change?.scope_digest===digest(participants))){
          const required=change.change.required_department_ids||[],states=change.confirmation_states||[];
          const myState=states.find(state=>sameIdentityInteger(state.department_id,actor.departmentId));
          const date=/^\d{4}-\d{2}-\d{2}$/.test(change.change.due_date||'')?change.change.due_date:'本事项所列日期';
          if(change.allowed_actions?.includes('confirm')&&required.some(id=>sameIdentityInteger(id,actor.departmentId))&&(myState?.valid!==true||myState?.reason==='functional_test_only'))addGovernance('v7_deadline_confirmation',change.change_id,'本人确认本流程办理截止日期',['governance:review-department'],{
            actor:'本部门当前已登记且具有有效授权的负责人',operation:'打开本流程的“本次核对”，在“需要确认或登记的具体事项”找到截止日期为'+date+'的时限事项，核对日期、参与部门及原因，点击“本人确认此事项”，填写“本次办理依据”，再点击“保存本次办理”。',
            result:'保存后在该时限事项核对本部门确认；全部所需部门有效确认后，由MDM组长登记，日期才显示为“办理截止日期”。'},{governanceChangeId:change.change_id});
          const allConfirmed=states.length===required.length&&required.length>0&&required.every(id=>states.some(state=>sameIdentityInteger(state.department_id,id)&&state.valid===true&&state.reason!=='functional_test_only'));
          if(allConfirmed&&governanceAllowed.includes('register_change')&&change.allowed_actions?.includes('register'))addGovernance('v7_deadline_registration',change.change_id,'登记已确认的本流程办理截止日期',['governance:assign-work'],{
            actor:'MDM工作组组长',operation:'打开本流程的“本次核对”，在“需要确认或登记的具体事项”核对截止日期'+date+'及全部部门确认，点击“登记已确认事项”，填写“本次办理依据”，再点击“保存本次办理”。',
            result:'保存后在本页“办理截止日期”核对已登记日期，展开“优化建议、制度版次与历史记录”查看提出、各部门确认及登记记录。'},{governanceChangeId:change.change_id});
        }
      }
    }
    if (allowed.includes('promote_to_formal_draft') && !detail.handling_summary.current_promotion) add('v7_promote', c.id, '将核对完成修订提升为正式草稿', ['governance:assign-work']);
    if (formalAllowed.includes('submit_formal_draft') && ['draft', 'needs_changes'].includes(draft.status)) add('v7_submit', draft.id, '提交当前修订供负责人确认', detail.authoring?.can_record ? [] : ['governance:draft-department', 'governance:submit-department'], detail.authoring?.can_record ? { target: '/app/process-formal?case=' + c.id } : {});
    if (formalAllowed.includes('return_formal_draft') && draft.status === 'approved' && formal.department_confirmation?.valid !== true) add('v7_formal_reconfirmation', task.id, '退回后重新提交负责人确认', ['governance:review-department'], { reviewTaskId: task.id });
    if (formalAllowed.includes('review_formal_draft')) add('v7_formal_review', task.id, '本人确认当前正式修订', ['governance:review-department'], { reviewTaskId: task.id });
    if (formalAllowed.includes('publish_formal_draft')) add('v7_publish', draft.id, '核对依据并发布正式版本', ['governance:publish'], { draftId: draft.id });
    else if (draft.status === 'approved' && actor.permissions.has('governance:publish')) add('v7_publish', draft.id, '查看发布缺少的前置条件', ['governance:publish'], { draftId: draft.id });
  }
  return result;
}

router.get('/cases/:id', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req);
  assertCanRead(actor);
  const repo = await repository();
  res.json(previewBoundary(await describeCaseForActor(repo, actor, await repo.getCaseDetail(req.params.id))));
}));

router.get('/cases/:id/governance',requireAuth,(req,res)=>runAction(res,async()=>{
  const actor=await currentActor(req),repo=await repository();
  const detail=await describeCaseForActor(repo,actor,await repo.getCaseDetail(req.params.id));
  res.json(detail.governance);
}));
router.get('/cases/:id/governance/requests/:requestId',requireAuth,(req,res)=>runAction(res,async()=>{
  const actor=await currentActor(req),repo=await repository();
  res.json(await repo.governanceReceipt(req.params.id,req.params.requestId,actor));
}));
for(const [suffix,operation] of [['submission','submission'],['submission/confirm','submission_confirm'],['changes','propose'],['changes/:changeId/confirm','confirm'],['changes/:changeId/register','register'],['changes/:changeId/cancel','cancel'],['acceptance','acceptance']]){
  router.post('/cases/:id/governance/'+suffix,requireAuth,(req,res)=>runAction(res,async()=>{
    const actor=await currentActor(req),repo=await repository();
    const result=await repo.governanceAction(req.params.id,operation,req.params.changeId,req.body||{},actor);
    res.json(previewBoundary(await describeCaseForActor(repo,actor,result)));
  }));
}
router.get('/cases/:id/formal-controls',requireAuth,(req,res)=>runAction(res,async()=>{
  const actor=await currentActor(req),repo=await repository();await assertVisible(actor,await repo.getCaseDetail(req.params.id),repo);
  res.json(await repo.formalControls(req.params.id,actor));
}));
router.post('/cases/:id/formal-controls',requireAuth,(req,res)=>runAction(res,async()=>{
  const actor=await currentActor(req),repo=await repository();
  const result=await repo.governanceAction(req.params.id,'formal_controls',null,req.body||{},actor);
  res.json(result.result);
}));
router.get('/cases/:id/history',requireAuth,(req,res)=>runAction(res,async()=>{
  const actor=await currentActor(req),repo=await repository();
  res.json(await repo.history(req.params.id,actor,{afterEventId:req.query.after_event_id,beforeRevisionNo:req.query.before_revision_no,limit:req.query.limit}));
}));
router.get('/cases/:id/revisions/:revisionId/document',requireAuth,(req,res)=>runAction(res,async()=>{
  const actor=await currentActor(req),repo=await repository();
  const result=await repo.historicalRevision(req.params.id,req.params.revisionId,actor);
  res.json(result.revision.document);
}));

router.get('/cases/:id/formal-targets', requireAuth, (req, res) => runAction(res, async () => {
  if (process.env.PROCESS_V7_FORMAL_ENABLED !== '1') {
    throw httpError(503, '流程正式承接功能当前未启用', 'V7_FORMAL_DISABLED');
  }
  const actor = await currentActor(req);
  assertAdminCannotWrite(actor);
  if (!actor.roleCodes.has('mdm_lead') || !actor.permissions.has('governance:assign-work')) {
    throw httpError(403, '只有MDM工作组组长可以选择正式流程主档', 'V7_FORMAL_SCOPE_DENIED');
  }
  const repo = await repository();
  const detail = await repo.getCaseDetail(req.params.id);
  await assertVisible(actor, detail, repo);
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
  if (!detail) throw httpError(404, '流程预览核对案例不存在', 'V7_PREVIEW_CASE_NOT_FOUND');
  assertV7TrialProcessRef(detail.case.process_ref);
  if (detail.case.owning_department_id) {
    throw httpError(409, '归口部门已经明确，本期不允许在预览核对中改派', 'V7_PREVIEW_OWNER_ALREADY_ASSIGNED');
  }
  const departmentId = identityInteger(req.body && req.body.department_id);
  const departments = await repo.listDepartments();
  const department = departments.find(item => sameIdentityInteger(item.id, departmentId));
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
  if (!detail) throw httpError(404, '流程预览核对案例不存在', 'V7_PREVIEW_CASE_NOT_FOUND');
  await assertUploadPermission(actor, detail.case, repo);
  assertV7TrialProcessRef(detail.case.process_ref);
  const departments = await repo.listDepartments();
  const preview = validatedPreview(req.body || {}, departments, {
    owningDepartmentName: detail.case.owning_department_name
  });
  assertV7TrialProcessRef(preview.processRef);
  if (text(preview.processRef) !== text(detail.case.process_ref)) {
    throw httpError(422, '新修订的流程稳定引用与当前案例不一致，请作为另一流程上传', 'V7_PREVIEW_PROCESS_REF_MISMATCH');
  }
  const result = await repo.addRevision(detail.case, preview, {
    sourceFileName: sourceFileName(req.body || {}),
    submission:req.body.submission,
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
  if (!detail) throw httpError(404, '流程预览核对案例不存在', 'V7_PREVIEW_CASE_NOT_FOUND');
  await assertUploadPermission(actor, detail.case, repo);
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
  if (!detail) throw httpError(404, '流程预览核对案例不存在', 'V7_PREVIEW_CASE_NOT_FOUND');
  assertV7TrialProcessRef(detail.case.process_ref);
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
    throw httpError(503, '流程正式承接功能当前未启用', 'V7_FORMAL_DISABLED');
  }
  const repo = await repository();
  const actor = await currentActor(req);
  assertAdminCannotWrite(actor);
  if (!actor.roleCodes.has('mdm_lead') || !actor.permissions.has('governance:assign-work')) {
    throw httpError(403, '只有MDM工作组组长可以把核对完成的流程提升为正式草稿', 'V7_FORMAL_SCOPE_DENIED');
  }
  const detail = await repo.getCaseDetail(req.params.id);
  await assertVisible(actor, detail, repo);
  assertV7TrialProcessRef(detail.case.process_ref);
  const expectedRevision = expectedRevisionNo(req.body || {});
  const expectedHash = expectedContentHash(req.body || {});
  const target = promotionTarget(req.body || {});
  const departments = await repo.listDepartments();
  const preview = validatedPreview({ document: detail.revision && detail.revision.document }, departments, {
    owningDepartmentName: detail.case.owning_department_name
  });
  const blockingIssues = unresolvedBlockingIssues(preview.blockingIssues, text(detail.case.scope_decision));
  if (blockingIssues.length) {
    throw httpError(409, '当前流程修订仍有未解决的预览核对卡口，不能提升为正式草稿', 'V7_PREVIEW_BLOCKING_ISSUES', {
      details: blockingIssues.map(issue => ({ code: text(issue && issue.code) })).filter(issue => issue.code)
    });
  }
  if (text(detail.case.status) !== 'review_complete') {
    throw httpError(409, '当前流程预览案例尚未完成核对，不能提升为正式草稿', 'V7_PREVIEW_REVIEW_INCOMPLETE');
  }
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
  const decision = text(req.body && req.body.decision);
  if (!DECISIONS.has(decision)) {
    throw httpError(422, '核对结果必须从系统选项中选择', 'V7_PREVIEW_DECISION_INVALID');
  }
  const basis = requiredBasis(req.body || {});
  const repo = await repository();
  const item = await repo.getItem(req.params.id);
  if (!item) throw httpError(404, '流程跨部门核对项不存在', 'V7_PREVIEW_ITEM_NOT_FOUND');
  const caseRow = await repo.getCase(item.case_id);
  if (!caseRow) throw httpError(404, '流程预览核对案例不存在', 'V7_PREVIEW_CASE_NOT_FOUND');
  assertV7TrialProcessRef(caseRow.process_ref);
  let party = '';
  if (sameIdentityInteger(item.origin_department_id, actor.departmentId)) party = 'origin';
  else if (sameIdentityInteger(item.target_department_id, actor.departmentId)) party = 'counterparty';
  if (!party) throw httpError(403, '当前人员所在部门不是该核对项的参与部门', 'V7_PREVIEW_SCOPE_DENIED');
  if (!actor.canReviewDepartment) {
    throw httpError(actor.departmentAccountability.reason === 'DEPARTMENT_ACCOUNTABILITY_POLICY_REQUIRED' ? 503 : 403,
      '须由该参与部门已指定且具备有效授权的部门负责人本人核对', actor.departmentAccountability.reason,
      { department_accountability: actor.departmentAccountability });
  }
  const result = await repo.decideItem(
    item,
    party,
    decision,
    basis,
    expectedRevisionNo(req.body || {}),
    expectedContentHash(req.body || {}),
    actor,
    req.body && req.body.expected_dispute_event_id
  );
  res.json(previewBoundary({ item: { ...result, allowed_actions: ['record_department_decision'] } }));
}));

router.get('/cases/:id/authoring-candidates', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req), repo = await repository();
  const detail = await repo.getCaseDetail(req.params.id);
  await assertVisible(actor, detail, repo);
  res.json(await repo.authoringCandidates(detail.case, actor));
}));
router.post('/cases/:id/authoring-records', requireAuth, (req, res) => runAction(res, async () => {
  const actor = await currentActor(req); assertAdminCannotWrite(actor);
  const repo = await repository(), detail = await repo.getCaseDetail(req.params.id);
  await assertVisible(actor, detail, repo);
  res.json(previewBoundary(await repo.recordAuthoring(detail.case.id, req.body || {}, actor)));
}));

router.setProcessPreviewRepositoryFactory = setProcessPreviewRepositoryFactory;
router.resetProcessPreviewRepositoryFactory = resetProcessPreviewRepositoryFactory;
router.listProcessWorkbenchItems = listProcessWorkbenchItems;
router.describeCaseForActor = describeCaseForActor;

router.setProcessV7PreviewRepositoryFactory = setProcessPreviewRepositoryFactory;
router.resetProcessV7PreviewRepositoryFactory = resetProcessPreviewRepositoryFactory;
router.listV7WorkbenchItems = listProcessWorkbenchItems;
module.exports = router;
