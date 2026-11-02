const { supports: supportsNativeProcess } = require('./processNativeFormats');
// Formal transition validation shared by the HTTP adapter and transactional repository.
const {assertV7FormalEnabled,assertV7TrialProcessRef} = require('./processV7TrialScope');
const EDITABLE_DRAFT_STATUSES = new Set(['draft', 'needs_changes']);

function isEditableDraftStatus(status) {
  return EDITABLE_DRAFT_STATUSES.has(text(status));
}

const DEFAULT_PROCESS_DESIGN_FIELD_TYPES = [
  ['text', '文本'],
  ['long_text', '长文本'],
  ['number', '数字'],
  ['amount', '金额'],
  ['date', '日期'],
  ['datetime', '日期时间'],
  ['enum', '枚举'],
  ['boolean', '布尔'],
  ['department', '部门'],
  ['person', '人员'],
  ['file_no', '文件编号'],
  ['signature', '签名'],
  ['image', '图片'],
  ['attachment', '附件'],
  ['qrcode', '二维码']
];

const EVIDENCE_STATUS_MIGRATION_KEY = '2026-07-01-process-design-evidence-status';
const EDITION_SCHEMA_MIGRATION_KEY = '2026-07-02-process-design-document-editions';
const FORM_STRUCTURE_SCHEMA_MIGRATION_KEY = '2026-07-03-process-design-form-structure';
const STEP_TRANSITION_SCHEMA_MIGRATION_KEY = '2026-07-07-process-design-step-transitions';
const STRUCTURED_OUTPUT_SCHEMA_VERSION = 'document-structured-output-v2';

const FORMAL_V7_TRANSACTION_CONTEXT = Symbol('formalV7TransactionContext');
const FORMAL_V7_ACTOR_CONTEXT = Symbol('formalV7ActorContext');


function httpError(statusCode, message, payload) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.payload = payload || { error: message };
  if (error.payload && error.payload.code) error.code = error.payload.code;
  return error;
}


function assertActiveV7Draft(draft) {
  if (!draft) throw httpError(404, '流程草稿不存在');
  if (!supportsNativeProcess(text(draft.schema_version))) throw httpError(410, '旧版流程办理入口已删除，历史记录保留；新流程请通过3001编制当前格式后上传；受支持历史格式按原格式办理。', { code: 'LEGACY_PROCESS_RETIRED', error: '旧版流程办理入口已删除，历史记录保留。' });
}

function text(value) {
  return String(value || '').trim();
}

function optionalText(value) {
  const cleaned = text(value);
  return cleaned || null;
}

function v7FormalExpectedBinding(body = {}) {
  const revisionNo = Number(body.expectedRevisionNo ?? body.expected_revision_no);
  if (!Number.isInteger(revisionNo) || revisionNo < 1) {
    throw httpError(422, '当前修订号必须是正整数', {
      error: '当前修订号必须是正整数',
      code: 'V7_FORMAL_EXPECTED_REVISION_REQUIRED'
    });
  }
  const contentHashValue = text(body.expectedContentHash ?? body.expected_content_hash).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentHashValue)) {
    throw httpError(422, '当前内容摘要必须是64位SHA-256', {
      error: '当前内容摘要必须是64位SHA-256',
      code: 'V7_FORMAL_EXPECTED_CONTENT_HASH_REQUIRED'
    });
  }
  return { expectedRevisionNo: revisionNo, expectedContentHash: contentHashValue };
}

function formalRecoveryInput(operation, note, options = {}) {
  if (!['withdraw', 'return-for-changes'].includes(operation)) {
    throw httpError(422, '正式流程恢复操作无效', { code: 'FORMAL_RECOVERY_OPERATION_INVALID', error: '正式流程恢复操作无效' });
  }
  const reason = text(note);
  if (!reason || reason.length > 1000) {
    throw httpError(422, '请填写1至1000字的撤回或退回原因', { code: 'FORMAL_RECOVERY_REASON_REQUIRED', error: '请填写1至1000字的撤回或退回原因' });
  }
  const expectedReviewTaskId = Number(options.expected_review_task_id ?? options.expectedReviewTaskId);
  if (!Number.isSafeInteger(expectedReviewTaskId) || expectedReviewTaskId < 1) {
    throw httpError(422, '请绑定当前正式审核任务', { code: 'FORMAL_RECOVERY_TASK_REQUIRED', error: '请绑定当前正式审核任务' });
  }
  return { ...v7FormalExpectedBinding(options), expectedReviewTaskId, reason };
}

function assertFormalRecoveryState(draft, operation) {
  const allowed = operation === 'withdraw' ? ['submitted', 'under_review'] : ['rejected', 'approved'];
  if (!allowed.includes(text(draft && draft.status))) {
    throw v7DraftStateConflict(draft, '当前正式草稿已不符合撤回或退回条件，请刷新办理状态');
  }
}

function assertV7FormalTransitionEnabled(draft, options = {}) {
  const document = parseJsonObject(draft && draft.process_content_json);
  const processRef = text(document && document.process && document.process.process_ref);
  try {
    assertV7FormalEnabled(options);
    assertV7TrialProcessRef(processRef);
  } catch (error) {
    throw httpError(error.statusCode || 500, error.message || '流程范围校验失败', {
      error: error.message || '流程范围校验失败',
      code: error.code || 'V7_TRIAL_SCOPE_CHECK_FAILED'
    });
  }
  return processRef;
}

function v7ActualState(draft) {
  return {
    actual_status: draft && draft.status || null,
    actual_revision_no: Number(draft && draft.revision_no || 0) || null,
    actual_content_hash: text(draft && draft.content_hash) || null
  };
}

function v7ReviewContentStale(draft, message = '当前流程正文或审核依据已经变化，请刷新后重试') {
  return httpError(409, message, {
    error: message,
    code: 'V7_REVIEW_CONTENT_STALE',
    ...v7ActualState(draft)
  });
}

function v7PromotionEvidenceMismatch(draft, message = '当前流程提升依据与正式草稿不一致，请重新完成受控提升') {
  return httpError(409, message, {
    error: message,
    code: 'V7_FORMAL_PROMOTION_EVIDENCE_MISMATCH',
    ...v7ActualState(draft)
  });
}

function v7DraftStateConflict(draft, message = '当前流程正式草稿状态不允许执行该操作') {
  return httpError(409, message, {
    error: message,
    code: 'V7_FORMAL_DRAFT_STATE_CONFLICT',
    ...v7ActualState(draft)
  });
}

function v7BaseVersionConflict(draft, message = '正式流程主档的当前版本已经变化，请重新提升最新流程修订') {
  return httpError(409, message, {
    error: message,
    code: 'V7_FORMAL_BASE_VERSION_CONFLICT',
    ...v7ActualState(draft)
  });
}

function v7BlockingIssuesError() {
  return httpError(409, '当前流程正文仍有阻断项，请回到3001修正后上传新修订', {
    error: '当前流程正文仍有阻断项，请回到3001修正后上传新修订',
    code: 'V7_FORMAL_BLOCKING_ISSUES'
  });
}

function assertV7ExpectedContent(draft, binding) {
  if (
    Number(binding.expectedRevisionNo) !== Number(draft && draft.revision_no) ||
    text(binding.expectedContentHash) !== text(draft && draft.content_hash)
  ) {
    throw v7ReviewContentStale(draft);
  }
}

function editionToNumber(edition) {
  const value = text(edition).toUpperCase();
  if (!/^[A-Z]+$/.test(value)) return 0;
  return value.split('').reduce((sum, ch) => sum * 26 + (ch.charCodeAt(0) - 64), 0);
}

function numberToEdition(number) {
  let value = Number(number || 0);
  if (!Number.isInteger(value) || value < 1) return 'A';
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function nextEdition(currentEdition) {
  return numberToEdition(editionToNumber(currentEdition) + 1);
}

function documentVersionNo(documentNo, edition) {
  return `${text(documentNo)}-${text(edition).toUpperCase()}`;
}

function markdownFileSafe(value) {
  return text(value).replace(/[\\/:*?"<>|]/g, '_');
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function arrayItems(value) {
  return Array.isArray(value) ? value : [];
}

function hasNonEmptyWorkRoleBindings(data) {
  const values = [
    data && data.work_role_bindings,
    data && data.structure_block_projection && data.structure_block_projection.work_role_bindings
  ];
  return values.some(value => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return Boolean(text(value));
  });
}

function assertWorkRoleBindingsSupported(data) {
  if (text(data && data.schema_version) !== STRUCTURED_OUTPUT_SCHEMA_VERSION || !hasNonEmptyWorkRoleBindings(data)) return;
  throw httpError(422, '校验失败', {
    code: 'WORK_ROLE_BINDINGS_UNSUPPORTED',
    error: '校验失败',
    details: [{
      field: 'work_role_bindings',
      message: '当前 MDM 尚不承接工作角色绑定。请保留原结构化文件，并在 3001 继续整理；待 MDM 承接能力上线后再导入。'
    }]
  });
}

function publicDraft(row) {
  if (!row) return null;
  return {
    ...row,
    planned_edition: row.planned_edition || 'A',
    related_departments: parseJsonArray(row.related_departments_json),
    involves_other_departments: Boolean(row.involves_other_departments)
  };
}


module.exports = {formalRecoveryInput,assertFormalRecoveryState,httpError,assertActiveV7Draft,text,optionalText,v7FormalExpectedBinding,assertV7FormalTransitionEnabled,v7ActualState,v7ReviewContentStale,v7PromotionEvidenceMismatch,v7DraftStateConflict,v7BaseVersionConflict,v7BlockingIssuesError,assertV7ExpectedContent,editionToNumber,numberToEdition,nextEdition,documentVersionNo,markdownFileSafe,parseJsonArray,parseJsonObject,arrayItems,hasNonEmptyWorkRoleBindings,assertWorkRoleBindingsSupported,publicDraft,isEditableDraftStatus,get EDITABLE_DRAFT_STATUSES(){return new Set(EDITABLE_DRAFT_STATUSES);},get DEFAULT_PROCESS_DESIGN_FIELD_TYPES(){return DEFAULT_PROCESS_DESIGN_FIELD_TYPES.map(pair=>[...pair]);},EVIDENCE_STATUS_MIGRATION_KEY,EDITION_SCHEMA_MIGRATION_KEY,FORM_STRUCTURE_SCHEMA_MIGRATION_KEY,STEP_TRANSITION_SCHEMA_MIGRATION_KEY,STRUCTURED_OUTPUT_SCHEMA_VERSION,FORMAL_V7_TRANSACTION_CONTEXT,FORMAL_V7_ACTOR_CONTEXT};
