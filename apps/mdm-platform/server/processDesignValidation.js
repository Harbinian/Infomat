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

module.exports={validateLockedDraft};
