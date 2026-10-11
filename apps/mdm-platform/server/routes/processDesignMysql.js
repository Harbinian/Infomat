const { supports: supportsNativeProcess } = require('../processNativeFormats');
const {checkRuntimeSchema,sendMysqlUnavailable} = require('../mysqlRuntimeSchema');
const express = require('express');
const mysql = require('mysql2/promise');
const { logRequestFailure } = require('../securityLog');
const { createRegisteredPool } = require('../mysqlPoolRegistry');
const router = express.Router();
const authoring = require('../processV7Authoring');
const {requireAuth,requirePermission,getUserEffectivePermissionsAsync,getUserRoleCodesAsync,getDepartmentByIdAsync} = require('../auth');
const {mysqlConfigFromEnv} = require('../mysqlConfig');
const {contentHash:v7ContentHash} = require('../processPreviewReview');
const {processV7ProcedureMarkdown} = require('../processV7ProcedureMarkdown');
const {httpError,assertActiveV7Draft,text,optionalText,v7FormalExpectedBinding,assertV7FormalTransitionEnabled,v7ActualState,v7ReviewContentStale,v7PromotionEvidenceMismatch,v7DraftStateConflict,v7BaseVersionConflict,v7BlockingIssuesError,assertV7ExpectedContent,editionToNumber,numberToEdition,nextEdition,documentVersionNo,markdownFileSafe,parseJsonArray,parseJsonObject,arrayItems,hasNonEmptyWorkRoleBindings,assertWorkRoleBindingsSupported,publicDraft,EDITABLE_DRAFT_STATUSES,FORMAL_V7_ACTOR_CONTEXT} = require('../processDesignPolicy');
const {makeProcessDesignMysqlRepository,ensureProcessDesignEditionSchema,ensureProcessDesignEvidenceStatusSchema,ensureProcessDesignFormStructureSchema,ensureProcessDesignStepTransitionSchema} = require('../processDesignMysqlRepository');
const {sessionSubject,identityInteger} = require('../sessionSubject');
const {createRepositoryResource} = require('../repositoryResource');
const resource = createRepositoryResource({create:()=>createRegisteredPool(process.env, 'processDesign'),verify:pool=>checkRuntimeSchema(pool,'processDesign'),build:makeProcessDesignMysqlRepository});
let repositoryFactory = null;
function runAction(res, action) {
  return action().catch(error => {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json(error.payload || { error: error.message });
    }
    if (sendMysqlUnavailable(res, error)) return;
    logRequestFailure(res, error);
    return res.status(500).json({ error: '服务器错误' });
  });
}

async function repository() { return repositoryFactory ? await repositoryFactory() : resource.get(); }
function setProcessDesignRepositoryFactory(factory) { repositoryFactory = factory; resource.reset().catch(()=>{}); }
function resetProcessDesignRepositoryFactory() { repositoryFactory = null; resource.reset(); }
async function currentPermSet(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet || new Set();
}

async function hasCurrentPermission(req, permissionCode) {
  return (await currentPermSet(req)).has(permissionCode);
}

async function canViewAcrossDepartments(req) {
  return await hasCurrentPermission(req, 'governance:read-global');
}

async function authorizedDepartmentIds(req) {
  const ids = new Set();
  if (req.session.departmentId) ids.add(Number(req.session.departmentId));
  return ids;
}

function draftRequiredErrors(body) {
  const required = [
    ['document_no', '制度编号不能为空'],
    ['process_name', '制度名称不能为空'],
    ['basis_type', '依据类型不能为空']
  ];
  const errors = required.filter(([field]) => !text(body[field])).map(([field, message]) => ({ field, message }));
  if (!Object.prototype.hasOwnProperty.call(body, 'involves_other_departments')) {
    errors.push({ field: 'involves_other_departments', message: '请说明是否涉及其他部门' });
  }
  return errors;
}

async function assertCanViewDraft(req, repo, draft) {
  if (!draft) throw httpError(404, '制度结构草稿不存在');
  if (repo.authoringAccess && (await repo.authoringAccess(draft.id, authoringActor(req)))?.compiler) return;
  if (await canViewAcrossDepartments(req)) return;
  const deptIds = await authorizedDepartmentIds(req);
  if (deptIds.has(Number(draft.department_id)) && await hasCurrentPermission(req, 'governance:read-department')) return;
  throw httpError(403, '无权查看该制度结构草稿');
}

async function assertCanEditDraft(req, repo, draft) {
  await assertCanViewDraft(req, repo, draft);
  assertAdminCannotWrite(await currentRoleCodes(req));
  if (draft.status === 'published') throw httpError(409, '已发布流程不能直接修改草稿');
  if (repo.authoringAccess) {
    const access = await repo.authoringAccess(draft.id, authoringActor(req));
    if (access?.managed) {
      if (authoring.enabled() && access.compiler) return;
      throw httpError(403, '该流程只能由当前编制者提交', { code: 'V7_AUTHORING_COMPILER_REQUIRED', error: '该流程只能由当前编制者提交' });
    }
  }
  const deptIds = await authorizedDepartmentIds(req);
  if (
    deptIds.has(Number(draft.department_id)) &&
    await hasCurrentPermission(req, 'governance:draft-department')
  ) return;
  throw httpError(403, '无权维护该制度结构草稿');
}

async function assertCanEditDraftContent(req, repo, draft) {
  await assertCanEditDraft(req, repo, draft);
  if (supportsNativeProcess(text(draft.schema_version))) {
    throw httpError(409, '正式流程草稿正文不能在3000直接修改；请回到3001修改后上传新修订', {
      error: '正式流程草稿正文不能在3000直接修改；请回到3001修改后上传新修订',
      code: 'V7_CONTENT_READ_ONLY'
    });
  }
  if (!EDITABLE_DRAFT_STATUSES.has(draft.status || 'draft')) {
    throw httpError(409, '当前状态只读，需要退回修改或新建变更版本');
  }
}

async function assertCanReview(req, repo, draft) {
  await assertCanViewDraft(req, repo, draft);
  assertAdminCannotWrite(await currentRoleCodes(req));
  const deptIds = await authorizedDepartmentIds(req);
  if (
    deptIds.has(Number(draft.department_id)) &&
    await hasCurrentPermission(req, 'governance:review-department')
  ) return;
  throw httpError(403, '无权审核该制度结构草稿');
}

async function currentRoleCodes(req) {
  const rows = await getUserRoleCodesAsync(req.session.personId || req.session.userId, req.session.role);
  return new Set(arrayItems(rows).map(item => text(item && (item.code || item.role_code))).filter(Boolean));
}

function authoringActor(req) {
  const subject = sessionSubject(req.session,req.identity);
  return { personId: subject.personId, accountId: subject.accountId, authVersion: subject.authVersion };
}

async function currentDepartmentIdentity(req) {
  const department = req.session.departmentId
    ? await getDepartmentByIdAsync(identityInteger(req.session.departmentId))
    : null;
  return department
    ? { id: identityInteger(department.id || department.department_id), name: text(department.name || department.department_name) }
    : null;
}

function assertAdminCannotWrite(roleCodes) {
  if (roleCodes.has('admin')) throw httpError(403, '管理员对治理材料只读，不能执行承接业务写入');
}

function formalV7RepositoryOptions(req, binding) {
  const subject=sessionSubject(req.session,req.identity);
  const actor = Object.freeze({personId:subject.personId,accountId:subject.accountId,authVersion:subject.authVersion});
  return {
    ...binding,
    [FORMAL_V7_ACTOR_CONTEXT]: actor
  };
}

async function readableProcessVersion(req) {
  const repo = await repository();
  const version = await repo.getVersionContent(req.params.processVersionId);
  if (!version) throw httpError(404, '正式流程版本不存在', { error: '正式流程版本不存在', code: 'PROCESS_VERSION_NOT_FOUND' });
  const assignedCompiler = repo.authoringAccess && (await repo.authoringAccess(version.draft_id, authoringActor(req)))?.compiler;
  if (!assignedCompiler && !await canViewAcrossDepartments(req)) {
    const departmentIds = await authorizedDepartmentIds(req);
    if (!departmentIds.has(Number(version.department_id)) || !await hasCurrentPermission(req, 'governance:read-department')) {
      throw httpError(403, '无权查看该正式流程版本', { error: '无权查看该正式流程版本', code: 'PROCESS_VERSION_SCOPE_DENIED' });
    }
  }
  if (!version.document) {
    throw httpError(409, '正式流程版本缺少可读正文', { error: '正式流程版本缺少可读正文', code: 'PROCESS_VERSION_CONTENT_MISSING' });
  }
  if (supportsNativeProcess(text(version.schema_version))) {
    const calculatedHash = v7ContentHash(version.document);
    if (text(version.content_hash) !== calculatedHash) {
      throw httpError(409, '正式流程版本正文摘要校验失败', {
        error: '正式流程版本正文摘要校验失败',
        code: 'V7_VERSION_CONTENT_HASH_MISMATCH'
      });
    }
    version.content_hash_verified = true;
  }
  return version;
}

router.get('/versions', requireAuth, (req, res) => runAction(res, async () => {
  const query = req.query.q === undefined ? '' : req.query.q;
  const beforeId = req.query.before_id === undefined ? null : req.query.before_id;
  if (typeof query !== 'string' || query.length > 200 || (beforeId !== null &&
    (typeof beforeId !== 'string' || !/^[1-9]\d{0,18}$/.test(beforeId) || BigInt(beforeId) > 9223372036854775807n))) {
    throw httpError(400, '检索文字最多200字，分页游标须为有效版本编号', { code: 'VERSION_SEARCH_INVALID_QUERY' });
  }
  const globalRead = await canViewAcrossDepartments(req);
  const departmentId = Number(req.session.departmentId || 0);
  if (!globalRead && (!departmentId || !await hasCurrentPermission(req, 'governance:read-department'))) {
    throw httpError(403, '无权检索正式流程版本', { code: 'PROCESS_VERSION_SCOPE_DENIED' });
  }
  const repo = await repository();
  const rows = await repo.searchVersions({ query: query.trim(), beforeId, globalRead, departmentId });
  const items = rows.slice(0, 20);
  res.json({ items, next_cursor: rows.length > 20 ? items[items.length - 1].id : null,
    page_size: 20, coverage: 'visible_native_versions' });
}));

router.get('/versions/:processVersionId/content', requireAuth, (req, res) => runAction(res, async () => {
  res.json(await readableProcessVersion(req));
}));

router.get('/versions/:processVersionId/procedure-markdown', requireAuth, (req, res) => runAction(res, async () => {
  const version = await readableProcessVersion(req);
  if (!['published', 'superseded'].includes(version.status)) {
    throw httpError(409, '该版本当前不能用于生成程序文件', { error: '该版本当前不能用于生成程序文件', code: 'PROCEDURE_VERSION_NOT_PUBLISHED' });
  }
  if (!supportsNativeProcess(version.schema_version) || version.document.schema_version !== version.schema_version) {
    throw httpError(409, '程序文件下载需要原生流程正式版本', { error: '程序文件下载需要原生流程正式版本', code: 'PROCEDURE_V7_REQUIRED' });
  }
  const filename = `${markdownFileSafe(version.document_no || version.document.process?.process_name || 'process')}-version-${version.process_version_id}.md`;
  res.json({ filename, process_version_id: version.process_version_id, content_hash: version.content_hash, markdown: processV7ProcedureMarkdown(version) });
}));

router.get('/drafts/:id/content', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  assertActiveV7Draft(draft);
  const content = await repo.canonicalContent(draft);
  if (!content.document) {
    throw httpError(409, '该草稿不能无损转换为单流程治理JSON', {
      error: '该草稿不能无损转换为单流程治理JSON',
      code: 'PROCESS_GOVERNANCE_MANUAL_CONVERSION_REQUIRED',
      object_id: Number(draft.id),
      details: content.errors || []
    });
  }
  res.json(content);
}));

router.get('/drafts/:id/export', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  assertActiveV7Draft(draft);
  const content = await repo.canonicalContent(draft);
  if (!content.document) throw httpError(409, '该草稿不能无损导出为单流程治理JSON');
  const filename = `${markdownFileSafe(text(draft.document_no) || `draft-${draft.id}`)}-${draft.schema_version}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(content.document);
}));

router.get('/drafts/:id/document-drafts', requireAuth, (req, res) => runAction(res, async () => {
  const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
  const beforeId = req.query.before_id === undefined ? null : req.query.before_id;
  if (!validId(req.params.id) || (beforeId !== null && !validId(beforeId))) {
    throw httpError(400, '草稿标识或分页游标无效', { code: 'DOCUMENT_HISTORY_INVALID_CURSOR' });
  }
  const repo = await repository();
  const draft = await repo.getHistoryAnchor(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  assertActiveV7Draft(draft);
  if (!draft.document_id) throw httpError(409, '该草稿缺少主档关联，不能推断历史归属', { code: 'DOCUMENT_HISTORY_UNRESOLVED' });
  const globalRead = await canViewAcrossDepartments(req);
  const rows = await repo.listDocumentDrafts(draft.document_id, {
    beforeId, globalRead, departmentId: Number(req.session.departmentId || 0)
  });
  // Keep the same authorization check as direct draft reads, in addition to SQL filtering.
  for (const row of rows) await assertCanViewDraft(req, repo, row);
  const items = rows.slice(0, 20);
  res.json({ anchor_draft_id: req.params.id, document_id: String(draft.document_id), items,
    next_cursor: rows.length > 20 ? items[items.length - 1].id : null,
    page_size: 20, coverage: 'visible_native_drafts' });
}));

router.get('/drafts/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  assertActiveV7Draft(draft);
  res.json(await repo.detail(draft.id));
}));

router.post('/drafts/:id/submit', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  assertActiveV7Draft(draft);
  const isNativeProcess = supportsNativeProcess(text(draft && draft.schema_version));
  let expectedBinding = {};
  if (isNativeProcess) {
    await assertCanEditDraft(req, repo, draft);
    if (!EDITABLE_DRAFT_STATUSES.has(draft.status || 'draft')) {
      throw v7DraftStateConflict(draft, '当前流程正式草稿状态不能提交审核');
    }
    assertV7FormalTransitionEnabled(draft);
    expectedBinding = v7FormalExpectedBinding(req.body || {});
  } else {
    await assertCanEditDraftContent(req, repo, draft);
  }
  const errors = draftRequiredErrors(draft);
  if (errors.length) throw httpError(422, '校验失败', { error: '校验失败', details: errors });
  const repositoryOptions = isNativeProcess ? formalV7RepositoryOptions(req, expectedBinding) : expectedBinding;
  res.json(await repo.submitDraft(draft, req.body && req.body.note, req.session.userId, repositoryOptions));
}));

router.post('/review-tasks/:id/decision', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const task = await repo.getReviewTask(req.params.id);
  if (!task) throw httpError(404, '审核任务不存在');
  const draft = await repo.getDraft(task.draft_id);
  await assertCanViewDraft(req, repo, draft);
  assertActiveV7Draft(draft);
  await assertCanReview(req, repo, draft);
  const isNativeProcess = supportsNativeProcess(text(draft && draft.schema_version));
  let expectedBinding = {};
  if (isNativeProcess) {
    assertV7FormalTransitionEnabled(draft);
    expectedBinding = v7FormalExpectedBinding(req.body || {});
  }
  const decision = text(req.body.decision);
  if (!{ approve: true, reject: true, needs_changes: true }[decision]) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'decision', message: '审核结论无效' }] });
  const repositoryOptions = isNativeProcess ? formalV7RepositoryOptions(req, expectedBinding) : expectedBinding;
  res.json(await repo.decideReviewTask(task, decision, req.body.note, req.session.userId, repositoryOptions));
}));

router.post('/drafts/:id/publish', requireAuth, requirePermission('governance:publish'), (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  assertActiveV7Draft(draft);
  assertAdminCannotWrite(await currentRoleCodes(req));
  let options = {
    confirm_complete_rewrite: Boolean(req.body && req.body.confirm_complete_rewrite)
  };
  if (supportsNativeProcess(text(draft && draft.schema_version))) {
    assertV7FormalTransitionEnabled(draft);
    const expectedBinding = v7FormalExpectedBinding(req.body || {});
    options = formalV7RepositoryOptions(req, expectedBinding);
  }
  res.json(await repo.publishDraft(draft, req.body && req.body.note, req.session.userId, options));
}));

router.setProcessDesignRepositoryFactory = setProcessDesignRepositoryFactory;
router.resetProcessDesignRepositoryFactory = resetProcessDesignRepositoryFactory;
router.makeProcessDesignMysqlRepository = makeProcessDesignMysqlRepository;
router.ensureProcessDesignEditionSchema = ensureProcessDesignEditionSchema;
router.ensureProcessDesignEvidenceStatusSchema = ensureProcessDesignEvidenceStatusSchema;
router.ensureProcessDesignFormStructureSchema = ensureProcessDesignFormStructureSchema;
router.ensureProcessDesignStepTransitionSchema = ensureProcessDesignStepTransitionSchema;
router.assertWorkRoleBindingsSupported = assertWorkRoleBindingsSupported;
router.getProcessDesignRepository = repository;
router.currentProcessDesignRoleCodes = currentRoleCodes;
router.currentProcessDesignDepartment = currentDepartmentIdentity;

module.exports = router;
