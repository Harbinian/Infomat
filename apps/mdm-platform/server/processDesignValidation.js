// Deterministic locked-source validation. DB reads, feature gates and validator ownership belong to its caller.
const {parseJsonObject,text,httpError,v7PromotionEvidenceMismatch,v7BlockingIssuesError} = require('./processDesignPolicy');
  function validateLockedDraft(draft, context, departments, {project,hash,unresolved}, options = {}) {
    const document = parseJsonObject(draft && draft.process_content_json);
    const owningDepartment = departments.find(item => Number(item.id) === Number(draft.department_id)) || null;
    const preview = project(document, departments, {
      owningDepartmentName: owningDepartment && owningDepartment.name || ''
    });
    if (preview.errors.length) {
      throw httpError(422, '正式流程草稿正文校验失败', {
        error: '正式流程草稿正文校验失败',
        code: 'V7_FORMAL_CONTENT_INVALID',
        details: preview.errors
      });
    }
    if (!context) throw v7PromotionEvidenceMismatch(draft, '正式流程草稿缺少锁定后的提升依据');
    const scopeDecision = text(context.previewCase && context.previewCase.scope_decision);
    if (!options.allowBlockingIssues && unresolved(preview.blockingIssues, scopeDecision).length) {
      throw v7BlockingIssuesError();
    }
    if (hash(document) !== text(draft.content_hash)) {
      throw v7PromotionEvidenceMismatch(draft, '正式流程草稿正文摘要与当前记录不一致');
    }
    const { previewCase, revision, promotion, document: formalDocument } = context;
    if (
      !promotion ||
      !previewCase ||
      !revision ||
      text(promotion.content_hash) !== text(draft.content_hash) ||
      Number(promotion.preview_revision_no) !== Number(draft.revision_no) ||
      Number(promotion.preview_revision_id) !== Number(revision.id) ||
      Number(promotion.preview_case_id) !== Number(previewCase.id) ||
      Number(promotion.document_id) !== Number(formalDocument && formalDocument.id) ||
      Number(promotion.draft_id) !== Number(draft.id) ||
      text(previewCase.status) !== 'review_complete' ||
      Number(previewCase.current_revision_id) !== Number(revision.id) ||
      Number(previewCase.current_revision_no) !== Number(draft.revision_no) ||
      text(previewCase.current_content_hash) !== text(draft.content_hash) ||
      Number(revision.revision_no) !== Number(draft.revision_no) ||
      text(revision.content_hash) !== text(draft.content_hash)
    ) {
      throw v7PromotionEvidenceMismatch(draft, '正式流程草稿没有匹配的当前预览核对和提升依据');
    }
    if (
      Number(draft.document_id) !== Number(formalDocument && formalDocument.id) ||
      Number(draft.department_id) !== Number(previewCase.owning_department_id) ||
      Number(formalDocument && formalDocument.owning_department_id) !== Number(previewCase.owning_department_id) ||
      text(preview.processRef) !== text(previewCase.process_ref) ||
      text(formalDocument && formalDocument.process_ref) !== text(preview.processRef)
    ) {
      throw v7PromotionEvidenceMismatch(draft, '正式流程草稿、归口部门、流程主档或process_ref与当前提升依据不一致');
    }
    return { document, preview, promotion, previewCase, revision, formalDocument };
  }

// Recovery authenticates the original promoted source without requiring the latest preview
// to match. It never approves the content or bypasses validation on the next submission.
function validateLockedRecoveryDraft(draft, context, hash) {
  const { promotion, previewCase, promotedRevision, document: formalDocument } = context || {};
  const document = parseJsonObject(draft && draft.process_content_json);
  const sourceDocument = parseJsonObject(promotedRevision && promotedRevision.content_json);
  const processRef = text(document && document.process && document.process.process_ref);
  if (!document || !sourceDocument || !processRef || !promotion || !previewCase || !promotedRevision || !formalDocument ||
    hash(document) !== text(draft.content_hash) || hash(sourceDocument) !== text(draft.content_hash) ||
    text(document.schema_version) !== text(draft.schema_version) || text(sourceDocument.schema_version) !== text(draft.schema_version) ||
    Number(promotion.draft_id) !== Number(draft.id) || Number(promotion.document_id) !== Number(draft.document_id) ||
    Number(formalDocument.id) !== Number(draft.document_id) || Number(formalDocument.owning_department_id) !== Number(draft.department_id) ||
    Number(promotion.preview_case_id) !== Number(previewCase.id) || Number(promotedRevision.case_id) !== Number(previewCase.id) ||
    Number(promotion.preview_revision_id) !== Number(promotedRevision.id) ||
    Number(promotion.preview_revision_no) !== Number(draft.revision_no) || Number(promotedRevision.revision_no) !== Number(draft.revision_no) ||
    text(promotion.content_hash) !== text(draft.content_hash) || text(promotedRevision.content_hash) !== text(draft.content_hash) ||
    text(formalDocument.process_ref) !== processRef || text(previewCase.process_ref) !== processRef) {
    throw v7PromotionEvidenceMismatch(draft, '原正式草稿、提升记录与原始修订依据不一致，不能撤回或退回');
  }
  return { document, promotion, promotedRevision };
}

module.exports={validateLockedDraft,validateLockedRecoveryDraft};
