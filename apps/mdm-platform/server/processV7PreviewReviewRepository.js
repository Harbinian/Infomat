const crypto = require('crypto');
const {
  caseStatusFromItems,
  itemStatus,
  mergeReviewItems,
  unresolvedBlockingIssues,
  validateAndProjectV7
} = require('./processV7PreviewReview');
const {
  assertV7FormalEnabled,
  assertV7PreviewEnabled,
  assertV7TrialProcessRef,
  assertV7TrialScopeConfigured
} = require('./processV7TrialScope');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function assertPreviewFeatureEnabled() {
  assertV7PreviewEnabled();
  assertV7TrialScopeConfigured();
}

function assertPreviewWriteScope(processRef) {
  assertPreviewFeatureEnabled();
  assertV7TrialProcessRef(processRef);
}

function assertPromotionFeatureEnabled() {
  assertPreviewFeatureEnabled();
  assertV7FormalEnabled();
}

function assertPromotionWriteScope(processRef) {
  assertPromotionFeatureEnabled();
  assertV7TrialProcessRef(processRef);
}

async function rows(executor, sql, params = []) {
  const [result] = await executor.execute(sql, params);
  return result;
}

async function one(executor, sql, params = []) {
  const result = await rows(executor, sql, params);
  return result[0] || null;
}

async function withTransaction(pool, action) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function publicCase(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    owning_department_id: row.owning_department_id == null ? null : Number(row.owning_department_id),
    current_revision_no: Number(row.current_revision_no || 0),
    current_revision_id: row.current_revision_id == null ? null : Number(row.current_revision_id),
    blocking_issues: parseJson(row.blocking_issues_json, Array.isArray(row.blocking_issues) ? row.blocking_issues : []),
    preview_only: true,
    publishable: false,
    formal_process_version_id: null
  };
}

function publicRevision(row, includeDocument = false) {
  if (!row) return null;
  const result = {
    ...row,
    id: Number(row.id),
    case_id: Number(row.case_id),
    revision_no: Number(row.revision_no)
  };
  if (includeDocument) result.document = parseJson(row.content_json, {});
  delete result.content_json;
  return result;
}

function publicItem(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    case_id: Number(row.case_id),
    revision_id: Number(row.revision_id),
    revision_no: Number(row.revision_no),
    origin_department_id: Number(row.origin_department_id),
    target_department_id: Number(row.target_department_id),
    carried_from_item_id: row.carried_from_item_id == null ? null : Number(row.carried_from_item_id),
    is_current: Boolean(row.is_current),
    item_snapshot: parseJson(row.item_snapshot_json, {})
  };
}

function publicEvent(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    case_id: Number(row.case_id),
    revision_id: row.revision_id == null ? null : Number(row.revision_id),
    item_id: row.item_id == null ? null : Number(row.item_id),
    payload: parseJson(row.payload_json, null)
  };
}

async function insertEvent(executor, event) {
  await executor.execute(`
    INSERT INTO process_v7_preview_events
      (case_id, revision_id, item_id, event_type,
       actor_user_id, actor_person_id, actor_department_id, actor_department_name,
       actor_role_code, decision, basis_text, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    event.caseId,
    event.revisionId || null,
    event.itemId || null,
    event.eventType,
    event.actor && event.actor.userId || null,
    event.actor && event.actor.personId || null,
    event.actor && event.actor.departmentId || null,
    event.actor && event.actor.departmentName || null,
    event.actor && event.actor.roleCode || null,
    event.decision || null,
    event.basis || null,
    event.payload ? JSON.stringify(event.payload) : null
  ]);
}

async function insertReviewItems(executor, caseId, revisionId, revisionNo, items, actor) {
  const inserted = [];
  for (const item of items) {
    const [result] = await executor.execute(`
      INSERT INTO process_v7_preview_review_items
        (case_id, revision_id, revision_no, stable_item_key, behavior_ref, behavior_name,
         origin_department_id, origin_department_name, target_department_id, target_department_name,
         actor_role, actor_position, item_digest, item_snapshot_json,
         origin_status, origin_basis, origin_decided_by_user_id, origin_decided_by_person_id, origin_decided_at,
         counterparty_status, counterparty_basis, counterparty_decided_by_user_id,
         counterparty_decided_by_person_id, counterparty_decided_at,
         status, carry_state, carried_from_item_id, is_current)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      caseId,
      revisionId,
      revisionNo,
      item.stable_item_key,
      item.behavior_ref,
      item.behavior_name,
      item.origin_department_id,
      item.origin_department_name,
      item.target_department_id,
      item.target_department_name,
      item.actor_role || null,
      item.actor_position || null,
      item.item_digest,
      JSON.stringify(item.item_snapshot || {}),
      item.origin_status || 'pending',
      item.origin_basis || null,
      item.origin_decided_by_user_id || null,
      item.origin_decided_by_person_id || null,
      item.origin_decided_at || null,
      item.counterparty_status || 'pending',
      item.counterparty_basis || null,
      item.counterparty_decided_by_user_id || null,
      item.counterparty_decided_by_person_id || null,
      item.counterparty_decided_at || null,
      item.status || itemStatus(item),
      item.carry_state || 'new',
      item.carried_from_item_id || null
    ]);
    const row = await one(executor, 'SELECT * FROM process_v7_preview_review_items WHERE id=?', [result.insertId]);
    inserted.push(publicItem(row));
    if (item.carry_state === 'carried_forward' || item.carry_state === 'reopened') {
      await insertEvent(executor, {
        caseId,
        revisionId,
        itemId: result.insertId,
        eventType: item.carry_state === 'carried_forward' ? 'review_result_carried_forward' : 'review_item_reopened',
        actor,
        payload: { carried_from_item_id: item.carried_from_item_id || null, stable_item_key: item.stable_item_key }
      });
    }
  }
  return inserted;
}

async function getCaseDetailFrom(executor, caseId) {
  const caseRow = await one(executor, 'SELECT * FROM process_v7_preview_cases WHERE id=?', [caseId]);
  if (!caseRow) return null;
  const revision = caseRow.current_revision_id
    ? await one(executor, 'SELECT * FROM process_v7_preview_revisions WHERE id=?', [caseRow.current_revision_id])
    : null;
  const items = await rows(executor, `
    SELECT * FROM process_v7_preview_review_items
    WHERE case_id=? AND is_current=1
    ORDER BY target_department_name, behavior_name, id
  `, [caseId]);
  const events = await rows(executor, `
    SELECT * FROM process_v7_preview_events
    WHERE case_id=?
    ORDER BY id DESC
    LIMIT 200
  `, [caseId]);
  let formalPromotion = null;
  try {
    const promotion = await one(executor, `
      SELECT *
      FROM process_v7_promotions
      WHERE preview_case_id=?
      ORDER BY id DESC
      LIMIT 1
    `, [caseId]);
    if (promotion) {
      formalPromotion = await promotionResult(executor, promotion, true);
      const reviewTask = await one(executor, `
        SELECT *
        FROM process_design_review_tasks
        WHERE draft_id=?
        ORDER BY id DESC
        LIMIT 1
      `, [promotion.draft_id]);
      const currentVersion = formalPromotion.document && formalPromotion.document.current_version_id
        ? await one(executor, 'SELECT * FROM process_design_versions WHERE id=?', [formalPromotion.document.current_version_id])
        : null;
      formalPromotion.review_task = reviewTask ? {
        ...reviewTask,
        id: Number(reviewTask.id),
        draft_id: Number(reviewTask.draft_id),
        draft_revision_no: reviewTask.draft_revision_no == null ? null : Number(reviewTask.draft_revision_no)
      } : null;
      formalPromotion.current_version = publicFormalVersionMetadata(currentVersion);
    }
  } catch (error) {
    if (error && error.code !== 'ER_NO_SUCH_TABLE') throw error;
  }
  return {
    case: publicCase(caseRow),
    revision: publicRevision(revision, true),
    items: items.map(publicItem),
    events: events.map(publicEvent),
    formal_promotion: formalPromotion
  };
}

function repositoryError(statusCode, code, message, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

async function lockCurrentPreviewWriteState(connection, caseId, meta = {}) {
  const lockedCase = await one(connection, 'SELECT * FROM process_v7_preview_cases WHERE id=? FOR UPDATE', [caseId]);
  if (!lockedCase) throw repositoryError(404, 'V7_PREVIEW_CASE_NOT_FOUND', 'V7预览核对案例不存在');
  assertPreviewWriteScope(lockedCase.process_ref);

  const lockedRevision = await one(connection, `
    SELECT * FROM process_v7_preview_revisions
    WHERE id=? AND case_id=?
    FOR UPDATE
  `, [lockedCase.current_revision_id, lockedCase.id]);
  if (!lockedRevision) {
    throw repositoryError(409, 'V7_PREVIEW_REVISION_MISSING', '当前V7修订不存在，请刷新后重试');
  }

  const currentItems = (await rows(connection, `
    SELECT * FROM process_v7_preview_review_items
    WHERE case_id=? AND is_current=1
    ORDER BY id
    FOR UPDATE
  `, [lockedCase.id])).map(publicItem);
  const activeDepartments = await rows(connection, `
    SELECT id, name, code
    FROM departments
    WHERE status='active'
    ORDER BY sort_order, id
    FOR SHARE
  `);

  if (
    Number(meta.expectedRevisionNo) !== Number(lockedCase.current_revision_no) ||
    Number(lockedRevision.revision_no) !== Number(lockedCase.current_revision_no)
  ) {
    throw repositoryError(409, 'V7_PREVIEW_REVISION_CONFLICT', '当前案例已经上传新修订，请刷新后重试', {
      actual_revision_no: Number(lockedCase.current_revision_no)
    });
  }
  if (
    text(meta.expectedContentHash) !== text(lockedCase.current_content_hash) ||
    text(lockedRevision.content_hash) !== text(lockedCase.current_content_hash)
  ) {
    throw repositoryError(409, 'V7_PREVIEW_CONTENT_HASH_CONFLICT', '当前案例内容摘要已经变化，请刷新后重试');
  }
  return { lockedCase, lockedRevision, currentItems, activeDepartments };
}

function projectLockedPreview(state, options = {}) {
  const preview = validateAndProjectV7(
    parseJson(state.lockedRevision.content_json, {}),
    state.activeDepartments,
    options
  );
  if (preview.errors.length) {
    const error = repositoryError(422, 'V7_PREVIEW_CONTENT_INVALID', '当前V7修订不再符合预览核对要求');
    error.payload = { error: error.message, code: error.code, details: preview.errors };
    throw error;
  }
  if (
    text(preview.processRef) !== text(state.lockedCase.process_ref) ||
    text(preview.contentHash) !== text(state.lockedCase.current_content_hash) ||
    text(preview.contentHash) !== text(state.lockedRevision.content_hash)
  ) {
    throw repositoryError(409, 'V7_PREVIEW_CONTENT_HASH_CONFLICT', '当前修订正文与案例绑定不一致，请刷新后重试');
  }
  return preview;
}

function projectCandidatePreview(document, state, options = {}) {
  const preview = validateAndProjectV7(document, state.activeDepartments, options);
  if (preview.errors.length) {
    const error = repositoryError(422, 'V7_PREVIEW_CONTENT_INVALID', '新修订不符合V7预览核对要求');
    error.payload = { error: error.message, code: error.code, details: preview.errors };
    throw error;
  }
  if (text(preview.processRef) !== text(state.lockedCase.process_ref)) {
    throw repositoryError(422, 'V7_PREVIEW_PROCESS_REF_MISMATCH', '新修订的流程稳定引用与当前案例不一致');
  }
  assertV7TrialProcessRef(preview.processRef);
  return preview;
}

function editionToNumber(edition) {
  const value = text(edition).toUpperCase();
  if (!/^[A-Z]+$/.test(value)) return 0;
  return value.split('').reduce((sum, character) => sum * 26 + character.charCodeAt(0) - 64, 0);
}

function numberToEdition(number) {
  let value = Number(number || 0);
  if (!Number.isInteger(value) || value < 1) return 'A';
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function nextEdition(currentEdition) {
  return numberToEdition(editionToNumber(currentEdition) + 1);
}

function publicFormalDocument(row) {
  return row ? {
    ...row,
    id: Number(row.id),
    owning_department_id: Number(row.owning_department_id),
    current_version_id: row.current_version_id == null ? null : Number(row.current_version_id)
  } : null;
}

function publicFormalDraft(row) {
  if (!row) return null;
  const { process_content_json: _processContentJson, ...metadata } = row;
  return {
    ...metadata,
    id: Number(row.id),
    document_id: Number(row.document_id),
    department_id: Number(row.department_id),
    base_version_id: row.base_version_id == null ? null : Number(row.base_version_id),
    revision_no: Number(row.revision_no || 0)
  };
}

function publicFormalVersionMetadata(row) {
  return row ? {
    id: Number(row.id),
    draft_id: Number(row.draft_id),
    document_id: Number(row.document_id),
    document_no: row.document_no,
    document_title: row.document_title,
    edition: row.edition,
    version_no: row.version_no,
    department_id: Number(row.department_id),
    schema_version: row.schema_version,
    content_hash: row.content_hash,
    source_revision_no: Number(row.source_revision_no || 0),
    status: row.status,
    published_at: row.published_at,
    effective_at: row.effective_at,
    supersedes_version_id: row.supersedes_version_id == null ? null : Number(row.supersedes_version_id)
  } : null;
}

async function promotionResult(executor, promotionRow, idempotent) {
  const document = await one(executor, 'SELECT * FROM process_design_documents WHERE id=?', [promotionRow.document_id]);
  const draft = await one(executor, 'SELECT * FROM process_design_drafts WHERE id=?', [promotionRow.draft_id]);
  return {
    idempotent,
    promotion: {
      ...promotionRow,
      id: Number(promotionRow.id),
      preview_case_id: Number(promotionRow.preview_case_id),
      preview_revision_id: Number(promotionRow.preview_revision_id),
      preview_revision_no: Number(promotionRow.preview_revision_no),
      document_id: Number(promotionRow.document_id),
      draft_id: Number(promotionRow.draft_id)
    },
    document: publicFormalDocument(document),
    draft: publicFormalDraft(draft)
  };
}

function makeProcessV7PreviewReviewRepository(pool) {
  return {
    async listDepartments() {
      return await rows(pool, `
        SELECT id, name, code
        FROM departments
        WHERE status='active'
        ORDER BY sort_order, id
      `);
    },

    async getCase(caseId) {
      return publicCase(await one(pool, 'SELECT * FROM process_v7_preview_cases WHERE id=?', [caseId]));
    },

    async getItem(itemId) {
      return publicItem(await one(pool, 'SELECT * FROM process_v7_preview_review_items WHERE id=?', [itemId]));
    },

    async findFormalDocumentByNumber(documentNo) {
      return publicFormalDocument(await one(pool, `
        SELECT *
        FROM process_design_documents
        WHERE document_no=?
        LIMIT 1
      `, [text(documentNo)]));
    },

    async listCases(actor, options = {}) {
      const limit = Math.min(Math.max(Number(options.limit || 100), 1), 200);
      const departmentId = Number(actor.departmentId || 0);
      const canReadGlobal = actor.canReadGlobal ? 1 : 0;
      const result = await rows(pool, `
        SELECT c.*,
          (SELECT COUNT(*) FROM process_v7_preview_review_items i
           WHERE i.case_id=c.id AND i.is_current=1) AS review_item_count,
          (SELECT COUNT(*) FROM process_v7_preview_review_items i
           WHERE i.case_id=c.id AND i.is_current=1 AND i.status='confirmed') AS confirmed_item_count
        FROM process_v7_preview_cases c
        WHERE (?=1
          OR c.owning_department_id=?
          OR EXISTS (
            SELECT 1 FROM process_v7_preview_review_items i
            WHERE i.case_id=c.id AND i.is_current=1
              AND (i.origin_department_id=? OR i.target_department_id=?)
          ))
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT ${limit}
      `, [canReadGlobal, departmentId, departmentId, departmentId]);
      let myActionCount = 0;
      if (actor.canReviewDepartment && departmentId) {
        const action = await one(pool, `
          SELECT COUNT(*) AS count
          FROM process_v7_preview_review_items i
          JOIN process_v7_preview_cases c ON c.id=i.case_id
          WHERE i.is_current=1 AND c.status<>'closed'
            AND ((i.origin_department_id=? AND i.origin_status IN ('pending','pending_evidence'))
              OR (i.target_department_id=? AND i.counterparty_status IN ('pending','pending_evidence')))
        `, [departmentId, departmentId]);
        myActionCount = Number(action && action.count || 0);
      }
      return {
        items: result.map(row => ({
          ...publicCase(row),
          review_item_count: Number(row.review_item_count || 0),
          confirmed_item_count: Number(row.confirmed_item_count || 0)
        })),
        total: result.length,
        my_action_count: myActionCount
      };
    },

    async getCaseDetail(caseId) {
      return await getCaseDetailFrom(pool, caseId);
    },

    async createCase(preview, meta, actor) {
      assertPreviewWriteScope(preview.processRef);
      try {
        return await withTransaction(pool, async connection => {
        assertPreviewWriteScope(preview.processRef);
        const existing = await one(connection, `
          SELECT * FROM process_v7_preview_cases
          WHERE process_ref=? AND status<>'closed'
          ORDER BY id DESC LIMIT 1 FOR UPDATE
        `, [preview.processRef]);
        if (existing) {
          if (text(existing.current_content_hash) === preview.contentHash) {
            const detail = await getCaseDetailFrom(connection, existing.id);
            return { ...detail, idempotent: true };
          }
          const error = new Error('该流程已有V7预览核对案例，请在原案例上传新修订');
          error.statusCode = 409;
          error.code = 'V7_PREVIEW_CASE_EXISTS';
          error.case_id = Number(existing.id);
          throw error;
        }
        const caseRef = `v7_preview_${crypto.randomUUID()}`;
        const owner = preview.owningDepartment;
        const initialStatus = caseStatusFromItems(preview.items, Boolean(owner), preview.blockingIssues);
        const [caseResult] = await connection.execute(`
          INSERT INTO process_v7_preview_cases
            (case_ref, process_ref, process_name, owning_department_id, owning_department_name,
             status, current_revision_no, current_content_hash, blocking_issues_json,
             created_by_user_id, created_by_person_id)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `, [
          caseRef,
          preview.processRef,
          preview.processName,
          owner && owner.id || null,
          owner && owner.name || null,
          initialStatus,
          preview.contentHash,
          JSON.stringify(preview.blockingIssues || []),
          actor.userId || null,
          actor.personId || null
        ]);
        const caseId = caseResult.insertId;
        const [revisionResult] = await connection.execute(`
          INSERT INTO process_v7_preview_revisions
            (case_id, revision_no, source_file_name, source_schema_version, source_exported_at,
             content_hash, content_json, uploaded_by_user_id, uploaded_by_person_id)
          VALUES (?, 1, ?, 'process-governance-v7', ?, ?, ?, ?, ?)
        `, [
          caseId,
          meta.sourceFileName,
          text(preview.document && preview.document.export_meta && preview.document.export_meta.exported_at) || null,
          preview.contentHash,
          JSON.stringify(preview.document),
          actor.userId || null,
          actor.personId || null
        ]);
        await connection.execute('UPDATE process_v7_preview_cases SET current_revision_id=? WHERE id=?', [revisionResult.insertId, caseId]);
        const insertedItems = await insertReviewItems(connection, caseId, revisionResult.insertId, 1, preview.items, actor);
        await insertEvent(connection, {
          caseId,
          revisionId: revisionResult.insertId,
          eventType: 'preview_case_created',
          actor,
          payload: { source_file_name: meta.sourceFileName, content_hash: preview.contentHash, warning_count: preview.warnings.length }
        });
        return {
          case: publicCase(await one(connection, 'SELECT * FROM process_v7_preview_cases WHERE id=?', [caseId])),
          revision: publicRevision(await one(connection, 'SELECT * FROM process_v7_preview_revisions WHERE id=?', [revisionResult.insertId])),
          items: insertedItems,
          idempotent: false
        };
        });
      } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY' && /uq_process_v7_preview_active_process/.test(String(error.message || ''))) {
          const existing = await one(pool, `
            SELECT * FROM process_v7_preview_cases
            WHERE process_ref=? AND status<>'closed'
            ORDER BY id DESC LIMIT 1
          `, [preview.processRef]);
          if (existing && text(existing.current_content_hash) === preview.contentHash) {
            return { ...(await getCaseDetailFrom(pool, existing.id)), idempotent: true };
          }
          const conflict = new Error('该流程已有V7预览核对案例，请在原案例上传新修订');
          conflict.statusCode = 409;
          conflict.code = 'V7_PREVIEW_CASE_EXISTS';
          conflict.case_id = existing ? Number(existing.id) : null;
          throw conflict;
        }
        throw error;
      }
    },

    async assignOwner(caseRow, department, _preview, meta, actor) {
      assertPreviewFeatureEnabled();
      return await withTransaction(pool, async connection => {
        const state = await lockCurrentPreviewWriteState(connection, caseRow.id, meta);
        const { lockedCase: locked } = state;
        if (locked.owning_department_id) {
          throw repositoryError(409, 'V7_PREVIEW_OWNER_ALREADY_ASSIGNED', '归口部门已经明确，本期不允许在预览核对中改派');
        }
        const lockedDepartment = state.activeDepartments.find(item => Number(item.id) === Number(department && department.id));
        if (!lockedDepartment) {
          throw repositoryError(422, 'V7_PREVIEW_OWNER_INVALID', '请选3000当前有效部门');
        }
        const preview = projectLockedPreview(state, { owningDepartmentName: lockedDepartment.name });
        await connection.execute('UPDATE process_v7_preview_review_items SET is_current=0 WHERE case_id=? AND is_current=1', [locked.id]);
        const insertedItems = await insertReviewItems(
          connection,
          locked.id,
          locked.current_revision_id,
          locked.current_revision_no,
          preview.items,
          actor
        );
        const status = caseStatusFromItems(insertedItems, true, preview.blockingIssues);
        await connection.execute(`
          UPDATE process_v7_preview_cases
          SET owning_department_id=?, owning_department_name=?, status=?, blocking_issues_json=?,
              scope_decision=NULL, scope_decision_basis=NULL,
              scope_decided_by_user_id=NULL, scope_decided_by_person_id=NULL, scope_decided_at=NULL,
              updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `, [lockedDepartment.id, lockedDepartment.name, status, JSON.stringify(preview.blockingIssues || []), locked.id]);
        await insertEvent(connection, {
          caseId: locked.id,
          revisionId: locked.current_revision_id,
          eventType: 'owning_department_assigned',
          actor,
          payload: { owning_department_id: lockedDepartment.id, owning_department_name: lockedDepartment.name }
        });
        return publicCase(await one(connection, 'SELECT * FROM process_v7_preview_cases WHERE id=?', [locked.id]));
      });
    },

    async addRevision(caseRow, preview, meta, actor) {
      assertPreviewWriteScope(preview && preview.processRef);
      return await withTransaction(pool, async connection => {
        const state = await lockCurrentPreviewWriteState(connection, caseRow.id, meta);
        const { lockedCase: locked } = state;
        projectLockedPreview(state, { owningDepartmentName: locked.owning_department_name });
        const candidatePreview = projectCandidatePreview(preview && preview.document, state, {
          owningDepartmentName: locked.owning_department_name
        });
        if (text(locked.current_content_hash) === candidatePreview.contentHash) {
          const detail = await getCaseDetailFrom(connection, locked.id);
          return { ...detail, idempotent: true };
        }
        const mergedItems = mergeReviewItems(state.currentItems, candidatePreview.items);
        const revisionNo = Number(locked.current_revision_no) + 1;
        const [revisionResult] = await connection.execute(`
          INSERT INTO process_v7_preview_revisions
            (case_id, revision_no, source_file_name, source_schema_version, source_exported_at,
             content_hash, content_json, uploaded_by_user_id, uploaded_by_person_id)
          VALUES (?, ?, ?, 'process-governance-v7', ?, ?, ?, ?, ?)
        `, [
          locked.id,
          revisionNo,
          meta.sourceFileName,
          text(candidatePreview.document && candidatePreview.document.export_meta && candidatePreview.document.export_meta.exported_at) || null,
          candidatePreview.contentHash,
          JSON.stringify(candidatePreview.document),
          actor.userId || null,
          actor.personId || null
        ]);
        await connection.execute('UPDATE process_v7_preview_review_items SET is_current=0 WHERE case_id=? AND is_current=1', [locked.id]);
        const insertedItems = await insertReviewItems(connection, locked.id, revisionResult.insertId, revisionNo, mergedItems, actor);
        const status = caseStatusFromItems(insertedItems, Boolean(locked.owning_department_id), candidatePreview.blockingIssues);
        await connection.execute(`
          UPDATE process_v7_preview_cases
          SET process_name=?, status=?, current_revision_no=?, current_revision_id=?, current_content_hash=?,
              blocking_issues_json=?, scope_decision=NULL, scope_decision_basis=NULL,
              scope_decided_by_user_id=NULL, scope_decided_by_person_id=NULL, scope_decided_at=NULL,
              updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `, [
          candidatePreview.processName,
          status,
          revisionNo,
          revisionResult.insertId,
          candidatePreview.contentHash,
          JSON.stringify(candidatePreview.blockingIssues || []),
          locked.id
        ]);
        await insertEvent(connection, {
          caseId: locked.id,
          revisionId: revisionResult.insertId,
          eventType: 'preview_revision_uploaded',
          actor,
          payload: {
            source_file_name: meta.sourceFileName,
            content_hash: candidatePreview.contentHash,
            previous_revision_no: Number(locked.current_revision_no),
            carried_forward: mergedItems.filter(item => item.carry_state === 'carried_forward').length,
            reopened: mergedItems.filter(item => item.carry_state === 'reopened').length
          }
        });
        return {
          case: publicCase(await one(connection, 'SELECT * FROM process_v7_preview_cases WHERE id=?', [locked.id])),
          revision: publicRevision(await one(connection, 'SELECT * FROM process_v7_preview_revisions WHERE id=?', [revisionResult.insertId])),
          items: insertedItems,
          idempotent: false
        };
      });
    },

    async decideItem(itemRow, party, decision, basis, expectedRevisionNo, expectedContentHash, actor) {
      assertPreviewFeatureEnabled();
      return await withTransaction(pool, async connection => {
        const state = await lockCurrentPreviewWriteState(connection, itemRow.case_id, {
          expectedRevisionNo,
          expectedContentHash
        });
        const { lockedCase: caseRowLocked, lockedRevision } = state;
        const item = state.currentItems.find(current => Number(current.id) === Number(itemRow.id));
        if (!item) {
          throw repositoryError(409, 'V7_PREVIEW_ITEM_SUPERSEDED', '当前核对项已经被新修订替代');
        }
        const actorDepartmentId = Number(actor && actor.departmentId || 0);
        const lockedParty = actorDepartmentId && Number(item.origin_department_id) === actorDepartmentId
          ? 'origin'
          : actorDepartmentId && Number(item.target_department_id) === actorDepartmentId
            ? 'counterparty'
            : '';
        if (!lockedParty || (party && text(party) !== lockedParty)) {
          throw repositoryError(403, 'V7_PREVIEW_SCOPE_DENIED', '当前审核员所在部门不是锁定核对项的对应参与方');
        }
        const prefix = lockedParty;
        await connection.execute(`
          UPDATE process_v7_preview_review_items
          SET ${prefix}_status=?, ${prefix}_basis=?,
              ${prefix}_decided_by_user_id=?, ${prefix}_decided_by_person_id=?,
              ${prefix}_decided_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `, [decision, basis, actor.userId || null, actor.personId || null, item.id]);
        const updated = publicItem(await one(connection, 'SELECT * FROM process_v7_preview_review_items WHERE id=?', [item.id]));
        updated.status = itemStatus(updated);
        await connection.execute('UPDATE process_v7_preview_review_items SET status=? WHERE id=?', [updated.status, item.id]);
        const replaced = state.currentItems.map(current => Number(current.id) === Number(updated.id) ? updated : current);
        const caseStatus = caseStatusFromItems(
          replaced,
          Boolean(caseRowLocked.owning_department_id),
          parseJson(caseRowLocked.blocking_issues_json, []),
          text(caseRowLocked.scope_decision)
        );
        await connection.execute('UPDATE process_v7_preview_cases SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [caseStatus, item.case_id]);
        await insertEvent(connection, {
          caseId: item.case_id,
          revisionId: lockedRevision.id,
          itemId: item.id,
          eventType: 'department_review_decision_recorded',
          actor,
          decision,
          basis,
          payload: { party: lockedParty, previous_status: item[`${prefix}_status`], case_status: caseStatus }
        });
        return { ...updated, status: updated.status, case_status: caseStatus };
      });
    },

    async recordScopeDecision(caseRow, decision, basis, _preview, expectedRevisionNo, expectedContentHash, actor) {
      assertPreviewFeatureEnabled();
      return await withTransaction(pool, async connection => {
        const state = await lockCurrentPreviewWriteState(connection, caseRow.id, {
          expectedRevisionNo,
          expectedContentHash
        });
        const { lockedCase: locked } = state;
        let preview = projectLockedPreview(state, {
          owningDepartmentName: locked.owning_department_name
        });
        const issueCodes = new Set((preview.blockingIssues || []).map(issue => text(issue && issue.code)));
        if (decision === 'confirmed_no_cross_department') {
          if (!issueCodes.has('ZERO_CROSS_DEPARTMENT_SCOPE_PENDING')) {
            throw repositoryError(409, 'V7_PREVIEW_SCOPE_DECISION_NOT_APPLICABLE', '当前修订不是待确认的零跨部门范围案例');
          }
        } else if (decision === 'keep_current_owner' || decision === 'accept_source_owner') {
          if (!issueCodes.has('OWNING_DEPARTMENT_CHANGE_PENDING')) {
            throw repositoryError(409, 'V7_PREVIEW_SCOPE_DECISION_NOT_APPLICABLE', '当前修订没有待处理的归口部门变化');
          }
        } else {
          throw repositoryError(422, 'V7_PREVIEW_SCOPE_DECISION_INVALID', '范围决定必须从系统选项中选择');
        }

        let currentItems = state.currentItems;
        let ownerId = locked.owning_department_id;
        let ownerName = locked.owning_department_name;
        if (decision === 'accept_source_owner') {
          const acceptedPreview = validateAndProjectV7(
            parseJson(state.lockedRevision.content_json, {}),
            state.activeDepartments
          );
          if (acceptedPreview.errors.length || !acceptedPreview.owningDepartment) {
            throw repositoryError(422, 'V7_PREVIEW_OWNER_INVALID', '当前修订中的归口部门不能作为有效范围决定');
          }
          if (
            text(acceptedPreview.processRef) !== text(locked.process_ref) ||
            text(acceptedPreview.contentHash) !== text(locked.current_content_hash) ||
            text(acceptedPreview.contentHash) !== text(state.lockedRevision.content_hash) ||
            (acceptedPreview.blockingIssues || []).some(issue => text(issue && issue.code) === 'OWNING_DEPARTMENT_CHANGE_PENDING')
          ) {
            throw repositoryError(409, 'V7_PREVIEW_SCOPE_DECISION_NOT_APPLICABLE', '锁定修订重新投影后仍未解除归口部门变化，不能采用修订中的归口部门');
          }
          preview = acceptedPreview;
          await connection.execute(
            'UPDATE process_v7_preview_review_items SET is_current=0 WHERE case_id=? AND is_current=1',
            [locked.id]
          );
          currentItems = await insertReviewItems(
            connection,
            locked.id,
            locked.current_revision_id,
            locked.current_revision_no,
            preview.items,
            actor
          );
          ownerId = preview.owningDepartment && preview.owningDepartment.id || null;
          ownerName = preview.owningDepartment && preview.owningDepartment.name || null;
        }

        const status = caseStatusFromItems(currentItems, Boolean(ownerId), preview.blockingIssues, decision);
        await connection.execute(`
          UPDATE process_v7_preview_cases
          SET owning_department_id=?, owning_department_name=?, status=?, blocking_issues_json=?,
              scope_decision=?, scope_decision_basis=?, scope_decided_by_user_id=?,
              scope_decided_by_person_id=?, scope_decided_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `, [
          ownerId,
          ownerName,
          status,
          JSON.stringify(preview.blockingIssues || []),
          decision,
          basis,
          actor.userId || null,
          actor.personId || null,
          locked.id
        ]);
        await insertEvent(connection, {
          caseId: locked.id,
          revisionId: locked.current_revision_id,
          eventType: 'scope_decision_recorded',
          actor,
          decision,
          basis,
          payload: {
            previous_owner_department_id: locked.owning_department_id,
            owner_department_id: ownerId,
            blocking_issue_count: (preview.blockingIssues || []).length,
            case_status: status
          }
        });
        return publicCase(await one(connection, 'SELECT * FROM process_v7_preview_cases WHERE id=?', [locked.id]));
      });
    },

    async promoteCase(detail, preview, target, meta, actor) {
      assertPromotionFeatureEnabled();
      return await withTransaction(pool, async connection => {
        const lockedCase = await one(connection, 'SELECT * FROM process_v7_preview_cases WHERE id=? FOR UPDATE', [detail.case.id]);
        if (!lockedCase) throw repositoryError(404, 'V7_PREVIEW_CASE_NOT_FOUND', 'V7预览核对案例不存在');
        assertPromotionWriteScope(lockedCase.process_ref);
        if (text(lockedCase.status) !== 'review_complete') {
          throw repositoryError(409, 'V7_PREVIEW_REVIEW_INCOMPLETE', '当前V7预览案例尚未完成核对，不能提升为正式草稿');
        }
        if (Number(meta.expectedRevisionNo) !== Number(lockedCase.current_revision_no)) {
          throw repositoryError(409, 'V7_PREVIEW_REVISION_CONFLICT', '当前案例已经上传新修订，请刷新后重试', {
            actual_revision_no: Number(lockedCase.current_revision_no)
          });
        }
        if (text(meta.expectedContentHash) !== text(lockedCase.current_content_hash)) {
          throw repositoryError(409, 'V7_PREVIEW_CONTENT_HASH_CONFLICT', '当前案例内容摘要已经变化，请刷新后重试');
        }

        const lockedRevision = await one(connection, `
          SELECT * FROM process_v7_preview_revisions
          WHERE id=? AND case_id=?
          FOR UPDATE
        `, [lockedCase.current_revision_id, lockedCase.id]);
        if (!lockedRevision) throw repositoryError(409, 'V7_PREVIEW_REVISION_MISSING', '当前V7修订不存在，不能提升');
        if (
          Number(lockedRevision.revision_no) !== Number(meta.expectedRevisionNo) ||
          text(lockedRevision.content_hash) !== text(meta.expectedContentHash)
        ) {
          throw repositoryError(409, 'V7_PREVIEW_REVISION_CONFLICT', '当前修订号或内容摘要已经变化，请刷新后重试', {
            actual_revision_no: Number(lockedRevision.revision_no)
          });
        }

        const activeDepartments = await rows(connection, `
          SELECT id, name, code
          FROM departments
          WHERE status='active'
          ORDER BY sort_order, id
          FOR SHARE
        `);
        const currentPreview = validateAndProjectV7(parseJson(lockedRevision.content_json, {}), activeDepartments, {
          owningDepartmentName: lockedCase.owning_department_name
        });
        if (currentPreview.errors.length) {
          const error = repositoryError(422, 'V7_PREVIEW_CONTENT_INVALID', '当前V7修订不再符合预览核对要求，不能提升');
          error.payload = { error: error.message, code: error.code, details: currentPreview.errors };
          throw error;
        }
        const blockingIssues = unresolvedBlockingIssues(currentPreview.blockingIssues, text(lockedCase.scope_decision));
        if (blockingIssues.length) {
          const error = repositoryError(
            409,
            'V7_PREVIEW_BLOCKING_ISSUES',
            '当前V7修订仍有未解决的预览核对卡口，不能提升为正式草稿'
          );
          error.payload = {
            error: error.message,
            code: error.code,
            details: blockingIssues.map(issue => ({ code: text(issue && issue.code) })).filter(issue => issue.code)
          };
          throw error;
        }
        if (
          text(currentPreview.contentHash) !== text(lockedCase.current_content_hash) ||
          text(currentPreview.processRef) !== text(lockedCase.process_ref)
        ) {
          throw repositoryError(409, 'V7_PREVIEW_CONTENT_HASH_CONFLICT', '当前修订正文与案例摘要不一致，不能提升');
        }

        const existingPromotion = await one(connection, `
          SELECT * FROM process_v7_promotions
          WHERE preview_case_id=? AND preview_revision_id=? AND preview_revision_no=? AND content_hash=?
          FOR UPDATE
        `, [lockedCase.id, lockedRevision.id, lockedRevision.revision_no, lockedRevision.content_hash]);
        if (existingPromotion) return await promotionResult(connection, existingPromotion, true);

        let formalDocument;
        if (target.mode === 'existing') {
          formalDocument = await one(connection, 'SELECT * FROM process_design_documents WHERE id=? FOR UPDATE', [target.document_id]);
          if (!formalDocument || text(formalDocument.status) !== 'active') {
            throw repositoryError(404, 'V7_FORMAL_DOCUMENT_NOT_FOUND', '选择的正式流程主档不存在或已停用');
          }
          if (Number(formalDocument.owning_department_id) !== Number(lockedCase.owning_department_id)) {
            throw repositoryError(409, 'V7_FORMAL_DOCUMENT_OWNER_MISMATCH', '选择的正式流程主档不属于当前归口部门');
          }
          if (text(formalDocument.process_ref) && text(formalDocument.process_ref) !== text(lockedCase.process_ref)) {
            throw repositoryError(409, 'V7_FORMAL_PROCESS_REF_CONFLICT', '选择的正式流程主档已经绑定其他process_ref');
          }
          if (!text(formalDocument.process_ref)) {
            await connection.execute(
              'UPDATE process_design_documents SET process_ref=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
              [lockedCase.process_ref, actor.userId || null, formalDocument.id]
            );
            formalDocument.process_ref = lockedCase.process_ref;
          }
        } else {
          const documentNumberConflict = await one(connection, 'SELECT id FROM process_design_documents WHERE document_no=? FOR UPDATE', [target.document_no]);
          if (documentNumberConflict) {
            throw repositoryError(409, 'V7_FORMAL_DOCUMENT_NO_EXISTS', '该制度编号已经存在；请选择已有主档，不能按名称或编号自动合并');
          }
          const processRefConflict = await one(connection, 'SELECT id FROM process_design_documents WHERE process_ref=? FOR UPDATE', [lockedCase.process_ref]);
          if (processRefConflict) {
            throw repositoryError(409, 'V7_FORMAL_PROCESS_REF_EXISTS', '该process_ref已经绑定正式流程主档；请选择已有主档');
          }
          const [documentResult] = await connection.execute(`
            INSERT INTO process_design_documents
              (document_no, process_ref, document_title, owning_department_id, status, created_by, updated_by)
            VALUES (?, ?, ?, ?, 'active', ?, ?)
          `, [
            target.document_no,
            lockedCase.process_ref,
            target.document_title,
            lockedCase.owning_department_id,
            actor.userId || null,
            actor.userId || null
          ]);
          formalDocument = await one(connection, 'SELECT * FROM process_design_documents WHERE id=? FOR UPDATE', [documentResult.insertId]);
        }

        let currentVersion = null;
        if (formalDocument.current_version_id) {
          currentVersion = await one(connection, 'SELECT * FROM process_design_versions WHERE id=? FOR UPDATE', [formalDocument.current_version_id]);
          if (!currentVersion || Number(currentVersion.document_id) !== Number(formalDocument.id)) {
            throw repositoryError(409, 'V7_FORMAL_CURRENT_VERSION_INVALID', '正式流程主档的当前版本指针无效，不能创建下一版草稿');
          }
        }
        const plannedEdition = currentVersion
          ? nextEdition(text(formalDocument.current_edition) || currentVersion.edition)
          : 'A';
        const activeDraft = await one(connection, `
          SELECT * FROM process_design_drafts
          WHERE document_id=? AND status IN ('draft','submitted','under_review','needs_changes','approved','rejected')
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE
        `, [formalDocument.id]);
        const relatedDepartmentIds = [...new Set((currentPreview.items || []).map(item => Number(item.target_department_id)).filter(Boolean))];
        const serializedContent = JSON.stringify(currentPreview.document);
        let formalDraft;
        if (activeDraft) {
          if (
            text(activeDraft.schema_version) !== 'process-governance-v7' ||
            !['draft', 'needs_changes'].includes(text(activeDraft.status))
          ) {
            throw repositoryError(409, 'V7_FORMAL_DRAFT_LOCKED', '该正式流程主档已有不能覆盖的进行中草稿');
          }
          const activeContent = parseJson(activeDraft.process_content_json, {});
          if (text(activeContent && activeContent.process && activeContent.process.process_ref) !== text(lockedCase.process_ref)) {
            throw repositoryError(409, 'V7_FORMAL_PROCESS_REF_CONFLICT', '进行中的V7草稿属于其他process_ref');
          }
          await connection.execute(`
            UPDATE process_design_drafts
            SET document_no=?, document_title=?, process_name=?, reason=?, basis_type=?, basis_description=?,
                involves_other_departments=?, related_departments_json=?, department_id=?,
                schema_version='process-governance-v7', process_content_json=?, content_hash=?, revision_no=?,
                content_updated_by=?, content_updated_at=CURRENT_TIMESTAMP,
                status='draft', submitted_by=NULL, submitted_at=NULL, published_by=NULL, published_at=NULL,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=?
          `, [
            formalDocument.document_no,
            formalDocument.document_title,
            currentPreview.processName,
            '3001 V7预览核对完成后受控提升',
            'V7预览核对',
            `preview_case:${lockedCase.case_ref};revision:${lockedRevision.revision_no}`,
            relatedDepartmentIds.length ? 1 : 0,
            JSON.stringify(relatedDepartmentIds),
            lockedCase.owning_department_id,
            serializedContent,
            lockedCase.current_content_hash,
            lockedRevision.revision_no,
            actor.userId || null,
            activeDraft.id
          ]);
          formalDraft = await one(connection, 'SELECT * FROM process_design_drafts WHERE id=?', [activeDraft.id]);
        } else {
          const [draftResult] = await connection.execute(`
            INSERT INTO process_design_drafts
              (document_id, document_no, document_title, planned_edition, base_version_id, active_document_no,
               process_name, reason, basis_type, basis_description, involves_other_departments,
               related_departments_json, department_id, l1_name, l1_status, l2_name, l2_status, l3_name,
               schema_version, process_content_json, content_hash, revision_no,
               content_updated_by, content_updated_at, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'unclassified', NULL, 'unclassified', NULL,
                    'process-governance-v7', ?, ?, ?, ?, CURRENT_TIMESTAMP, 'draft', ?)
          `, [
            formalDocument.id,
            formalDocument.document_no,
            formalDocument.document_title,
            plannedEdition,
            currentVersion && currentVersion.id || null,
            formalDocument.document_no,
            currentPreview.processName,
            '3001 V7预览核对完成后受控提升',
            'V7预览核对',
            `preview_case:${lockedCase.case_ref};revision:${lockedRevision.revision_no}`,
            relatedDepartmentIds.length ? 1 : 0,
            JSON.stringify(relatedDepartmentIds),
            lockedCase.owning_department_id,
            serializedContent,
            lockedCase.current_content_hash,
            lockedRevision.revision_no,
            actor.userId || null,
            actor.userId || null
          ]);
          formalDraft = await one(connection, 'SELECT * FROM process_design_drafts WHERE id=?', [draftResult.insertId]);
        }

        const promotionRef = `v7_promotion_${crypto.randomUUID()}`;
        const [promotionInsert] = await connection.execute(`
          INSERT INTO process_v7_promotions
            (promotion_ref, preview_case_id, preview_revision_id, preview_revision_no, content_hash,
             document_id, draft_id, promoted_by_user_id, promoted_by_person_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          promotionRef,
          lockedCase.id,
          lockedRevision.id,
          lockedRevision.revision_no,
          lockedRevision.content_hash,
          formalDocument.id,
          formalDraft.id,
          actor.userId || null,
          actor.personId || null
        ]);
        await connection.execute(`
          INSERT INTO process_design_events (draft_id, event_type, actor_user_id, note, payload_json)
          VALUES (?, 'v7_formal_promoted', ?, ?, ?)
        `, [
          formalDraft.id,
          actor.userId || null,
          '已将核对完成的V7修订提升为正式草稿',
          JSON.stringify({
            preview_case_id: Number(lockedCase.id),
            preview_revision_id: Number(lockedRevision.id),
            preview_revision_no: Number(lockedRevision.revision_no),
            content_hash: lockedRevision.content_hash
          })
        ]);
        await insertEvent(connection, {
          caseId: lockedCase.id,
          revisionId: lockedRevision.id,
          eventType: 'formal_draft_promoted',
          actor,
          payload: {
            promotion_ref: promotionRef,
            document_id: Number(formalDocument.id),
            draft_id: Number(formalDraft.id)
          }
        });
        const insertedPromotion = await one(connection, 'SELECT * FROM process_v7_promotions WHERE id=?', [promotionInsert.insertId]);
        return await promotionResult(connection, insertedPromotion, false);
      });
    }
  };
}

module.exports = {
  makeProcessV7PreviewReviewRepository
};
