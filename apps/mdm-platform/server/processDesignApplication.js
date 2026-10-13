const { supports: supportsNativeProcess } = require('./processNativeFormats');
// Application operations consume named storage capabilities; no SQL, HTTP or pool ownership.
const {httpError,text,optionalText,v7FormalExpectedBinding,v7ActualState,v7ReviewContentStale,v7DraftStateConflict,v7BaseVersionConflict,assertV7ExpectedContent,nextEdition,documentVersionNo,isEditableDraftStatus,FORMAL_V7_TRANSACTION_CONTEXT} = require('./processDesignPolicy');
function createProcessDesignApplication(store) {
  return Object.freeze({
async submitDraft(draft, note, actorUserId, options = {}) {
      const transactionContext = options && options[FORMAL_V7_TRANSACTION_CONTEXT];
      let storedDraft = null;
      let isNativeProcess = Boolean(transactionContext);
      if (!transactionContext) {
        storedDraft = await store.readDraft(Number(draft && draft.id));
        if (!storedDraft) throw httpError(404, '制度结构草稿不存在');
        isNativeProcess = supportsNativeProcess(text(storedDraft.schema_version));
      }
      if (isNativeProcess && !transactionContext) {
        store.assertEnabled(storedDraft);
        v7FormalExpectedBinding(options);
        return await store.withTransaction(storedDraft.id, null, async ({ locator, application: transactionApplication }) => {
          if (!transactionApplication) {
            throw httpError(503, '正式流程状态变更必须在MySQL事务中执行', {
              error: '正式流程状态变更必须在MySQL事务中执行',
              code: 'V7_FORMAL_TRANSACTION_REQUIRED'
            });
          }
          return await transactionApplication.submitDraft(
            { id: locator.draftId, schema_version: storedDraft.schema_version },
            note,
            actorUserId,
            {
              ...options,
              [FORMAL_V7_TRANSACTION_CONTEXT]: Object.freeze({ operation: 'submit', locator })
            }
          );
        });
      }
      if (isNativeProcess) {
        if (transactionContext.operation !== 'submit' || !transactionContext.locator) {
          throw httpError(503, '正式流程提交缺少受控的事务能力', {
            error: '正式流程提交缺少受控的事务能力',
            code: 'V7_FORMAL_TRANSACTION_REQUIRED'
          });
        }
        const binding = v7FormalExpectedBinding(options);
        const context = await store.lockContext(transactionContext.locator);
        const lockedDraft = context.draft;
        const authorizedActor = await store.authorizeActor(options, 'submit', context, actorUserId);
        assertV7ExpectedContent(lockedDraft, binding);
        if (!isEditableDraftStatus(lockedDraft.status)) {
          throw v7DraftStateConflict(lockedDraft, '当前流程正式草稿状态不能提交审核');
        }
        await store.validateDraft(lockedDraft, context);
        const updateResult = await store.markSubmitted({authorizedActor,lockedDraft,binding});
        if (Number(updateResult.affectedRows) !== 1) throw v7ReviewContentStale(lockedDraft);
        const taskResult = await store.createDepartmentReview({authorizedActor,lockedDraft,binding});
        await store.recordEvent(lockedDraft.id, 'submitted', authorizedActor.personId, optionalText(note) || '已提交审核', {
          draft_revision_no: binding.expectedRevisionNo,
          content_hash: binding.expectedContentHash
        });
        const updated = await store.readDraft(lockedDraft.id);
        return {
          draft: updated,
          reviewTask: await store.readReviewTask( taskResult.insertId),
          outcome: {
            formed: '已形成原生流程正式草稿',
            current: '当前流程正文已提交部门审核',
            missing: [],
            next: '部门审核员核对当前修订号和内容摘要后记录审核结论'
          }
        };
      }
      throw httpError(410, '旧版流程办理已停用', { code: 'LEGACY_PROCESS_RETIRED' });
    },
async decideReviewTask(task, decision, note, actorUserId, options = {}) {
      const statusByDecision = { approve: 'approved', reject: 'rejected', needs_changes: 'needs_changes' };
      const nextStatus = statusByDecision[decision];
      let draft = null;
      let storedTask = null;
      const transactionContext = options && options[FORMAL_V7_TRANSACTION_CONTEXT];
      let isNativeProcess = Boolean(transactionContext);
      if (!transactionContext) {
        storedTask = await store.readReviewTask( Number(task && task.id));
        if (!storedTask) throw httpError(404, '审核任务不存在');
        draft = await store.readDraft(storedTask.draft_id);
        if (!draft) throw httpError(404, '制度结构草稿不存在');
        isNativeProcess = supportsNativeProcess(text(draft.schema_version));
      }
      if (isNativeProcess && !transactionContext) {
        store.assertEnabled(draft);
        v7FormalExpectedBinding(options);
        return await store.withTransaction(draft.id, storedTask.id, async ({ locator, application: transactionApplication }) => {
          if (!transactionApplication) {
            throw httpError(503, '正式流程状态变更必须在MySQL事务中执行', {
              error: '正式流程状态变更必须在MySQL事务中执行',
              code: 'V7_FORMAL_TRANSACTION_REQUIRED'
            });
          }
          return await transactionApplication.decideReviewTask(
            { id: locator.taskId, draft_id: locator.draftId },
            decision,
            note,
            actorUserId,
            {
              ...options,
              [FORMAL_V7_TRANSACTION_CONTEXT]: Object.freeze({ operation: 'review', locator })
            }
          );
        });
      }
      if (isNativeProcess) {
        if (!transactionContext || transactionContext.operation !== 'review' || !transactionContext.locator) {
          throw httpError(503, '正式流程审核缺少受控的事务能力', {
            error: '正式流程审核缺少受控的事务能力',
            code: 'V7_FORMAL_TRANSACTION_REQUIRED'
          });
        }
        const binding = v7FormalExpectedBinding(options);
        const context = await store.lockContext(transactionContext.locator);
        const lockedDraft = context.draft;
        const authorizedActor = await store.authorizeActor(options, 'review', context, actorUserId);
        const lockedTask = context.reviewTasks.find(item => Number(item.id) === Number(transactionContext.locator.taskId));
        assertV7ExpectedContent(lockedDraft, binding);
        if (!lockedTask) throw v7ReviewContentStale(lockedDraft, '当前流程审核任务与正式草稿不一致');
        if (text(lockedTask.status) !== 'pending') {
          throw httpError(409, '该审核任务已经处理，不能重复记录结论', {
            error: '该审核任务已经处理，不能重复记录结论',
            code: 'REVIEW_TASK_ALREADY_DECIDED',
            ...v7ActualState(lockedDraft)
          });
        }
        if (
          Number(lockedTask.draft_revision_no) !== binding.expectedRevisionNo ||
          text(lockedTask.content_hash) !== binding.expectedContentHash
        ) {
          throw v7ReviewContentStale(lockedDraft, '审核任务绑定的流程正文已经过期，请重新提交当前修订');
        }
        if (!['submitted', 'under_review'].includes(text(lockedDraft.status))) {
          throw v7DraftStateConflict(lockedDraft, '当前流程正式草稿状态不能记录审核结论');
        }
        await store.validateDraft(lockedDraft, context, {
          allowBlockingIssues: decision === 'needs_changes' || decision === 'reject'
        });
        const taskUpdate = await store.recordReviewDecision({nextStatus,note,authorizedActor,lockedTask,binding});
        if (Number(taskUpdate.affectedRows) !== 1) throw v7ReviewContentStale(lockedDraft);
        const draftUpdate = await store.setReviewedDraftStatus({nextStatus,lockedDraft,binding});
        if (Number(draftUpdate.affectedRows) !== 1) throw v7ReviewContentStale(lockedDraft);
        await store.recordEvent(lockedDraft.id, `review_${decision}`, authorizedActor.personId, optionalText(note) || '已处理审核任务', {
          review_task_id: Number(lockedTask.id),
          draft_revision_no: binding.expectedRevisionNo,
          content_hash: binding.expectedContentHash,
          decision
        });
        return {
          draft: await store.readDraft(lockedDraft.id),
          reviewTask: await store.readReviewTask( lockedTask.id)
        };
      }
      throw httpError(410, '旧版流程办理已停用', { code: 'LEGACY_PROCESS_RETIRED' });
    },
async publishDraft(draft, note, actorUserId, options = {}) {
      const formalTransactionContext = options && options[FORMAL_V7_TRANSACTION_CONTEXT];
      let storedDraft = null;
      let isNativeProcess = Boolean(formalTransactionContext);
      if (!formalTransactionContext) {
        storedDraft = await store.readDraft(Number(draft && draft.id));
        if (!storedDraft) throw httpError(404, '制度结构草稿不存在');
        isNativeProcess = supportsNativeProcess(text(storedDraft.schema_version));
      }
      if (isNativeProcess && !formalTransactionContext) {
        store.assertEnabled(storedDraft);
        v7FormalExpectedBinding(options);
        return await store.withTransaction(storedDraft.id, null, async ({ locator, application: transactionApplication }) => {
          if (!transactionApplication) {
            throw httpError(503, '正式流程状态变更必须在MySQL事务中执行', {
              error: '正式流程状态变更必须在MySQL事务中执行',
              code: 'V7_FORMAL_TRANSACTION_REQUIRED'
            });
          }
          return await transactionApplication.publishDraft(
            { id: locator.draftId, schema_version: storedDraft.schema_version },
            note,
            actorUserId,
            {
              ...options,
              [FORMAL_V7_TRANSACTION_CONTEXT]: Object.freeze({ operation: 'publish', locator })
            }
          );
        });
      }
      if (isNativeProcess) {
        if (formalTransactionContext.operation !== 'publish' || !formalTransactionContext.locator) {
          throw httpError(503, '正式流程发布缺少受控的事务能力', {
            error: '正式流程发布缺少受控的事务能力',
            code: 'V7_FORMAL_TRANSACTION_REQUIRED'
          });
        }
        const binding = v7FormalExpectedBinding(options);
        const context = await store.lockContext(formalTransactionContext.locator);
        const lockedDraft = context.draft;
        const document = context.document;
        const currentVersion = context.currentVersion;
        const authorizedActor = await store.authorizeActor(options, 'publish', context, actorUserId);
        assertV7ExpectedContent(lockedDraft, binding);
        if (text(lockedDraft.status) !== 'approved') {
          throw v7DraftStateConflict(lockedDraft, '当前流程正式草稿尚未通过部门审核，不能发布');
        }
        await store.validateDraft(lockedDraft, context);
        const approvedReview = context.reviewTasks.find(task =>
          text(task.status) === 'approved' &&
          Number(task.draft_revision_no) === binding.expectedRevisionNo &&
          text(task.content_hash) === binding.expectedContentHash
        );
        if (!approvedReview) {
          throw v7ReviewContentStale(lockedDraft, '没有找到绑定当前修订号和内容摘要的审核通过记录');
        }
        const baseVersionId = lockedDraft.base_version_id == null ? null : Number(lockedDraft.base_version_id);
        if (
          (currentVersion && baseVersionId !== Number(currentVersion.id)) ||
          (!currentVersion && baseVersionId != null)
        ) {
          throw v7BaseVersionConflict(lockedDraft);
        }
        const expectedEdition = currentVersion ? nextEdition(currentVersion.edition) : 'A';
        const plannedEdition = text(lockedDraft.planned_edition) || expectedEdition;
        if (plannedEdition !== expectedEdition) {
          throw v7BaseVersionConflict(lockedDraft, '当前有效版次与正式流程草稿计划版次不一致，请重新提升最新修订');
        }
        const versionNo = documentVersionNo(document.document_no, plannedEdition);
        const result = await store.createPublishedVersion({lockedDraft,document,plannedEdition,versionNo,authorizedActor,currentVersion});
        // Users explicitly select a published version in the data governance workspace.
        if (currentVersion) {
          const supersedeResult = await store.supersedePublishedVersion({currentVersion,document});
        if (Number(supersedeResult.affectedRows) !== 1) throw v7BaseVersionConflict(lockedDraft);
        }
        const draftUpdate = await store.markPublished({authorizedActor,lockedDraft,binding});
        if (Number(draftUpdate.affectedRows) !== 1) throw v7ReviewContentStale(lockedDraft);
        const documentUpdate = await store.advanceDocumentVersion({document,plannedEdition,result,authorizedActor,currentVersion});
        if (Number(documentUpdate.affectedRows) !== 1) throw v7BaseVersionConflict(lockedDraft);
        const version = await store.readVersion( result.insertId);
        await store.recordEvent(lockedDraft.id, 'publish', authorizedActor.personId, optionalText(note) || '已发布原生流程版本', {
          process_version_id: Number(version.id),
          schema_version: lockedDraft.schema_version,
          content_hash: binding.expectedContentHash,
          source_revision_no: binding.expectedRevisionNo,
          review_task_id: Number(approvedReview.id),
          document_no: document.document_no,
          edition: plannedEdition,
          supersedes_version_id: currentVersion && currentVersion.id || null
        });
        const publishedDraft = await store.readDraft(lockedDraft.id);
        return {
          draft: publishedDraft,
          version,
          process_version_id: Number(version.id),
          outcome: {
            formed: '已形成不可变的原生流程正式版本',
            current: `当前正式版本为${versionNo}`,
            missing: [],
            next: '后续治理对象应绑定process_version_id，不读取原始3001文件或预览案例'
          }
        };
      }
      throw httpError(410, '旧版流程办理已停用', { code: 'LEGACY_PROCESS_RETIRED' });
    }
  });
}
module.exports={createProcessDesignApplication};
