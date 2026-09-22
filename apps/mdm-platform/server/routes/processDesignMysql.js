const { checkRuntimeSchema, sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');


const mysql = require('mysql2/promise');
const router = express.Router();
const { requireAuth, requirePermission, getUserEffectivePermissionsAsync, getUserRoleCodesAsync, getDepartmentByIdAsync } = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');


const {
  contentHash: v7ContentHash,
  unresolvedBlockingIssues,
  validateAndProjectV7
} = require('../processV7PreviewReview');
const {
  assertV7FormalEnabled,
  assertV7TrialProcessRef
} = require('../processV7TrialScope');
const { processV7ProcedureMarkdown } = require('../processV7ProcedureMarkdown');
const { ACCESS_MODEL_VERSION } = require('../roleDefinitions');

const EDITABLE_DRAFT_STATUSES = new Set(['draft', 'needs_changes']);

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

let repositoryFactory = null;
let repositoryPromise = null;
const FORMAL_V7_TRANSACTION_CONTEXT = Symbol('formalV7TransactionContext');
const FORMAL_V7_ACTOR_CONTEXT = Symbol('formalV7ActorContext');


function runAction(res, action) {
  return action().catch(error => {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json(error.payload || { error: error.message });
    }
    if (sendMysqlUnavailable(res, error)) return;
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  });
}

function httpError(statusCode, message, payload) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.payload = payload || { error: message };
  if (error.payload && error.payload.code) error.code = error.payload.code;
  return error;
}


function assertActiveV7Draft(draft) {
  if (!draft) throw httpError(404, '流程草稿不存在');
  if (!['process-governance-v7', 'process-governance-v8'].includes(text(draft.schema_version))) throw httpError(410, '旧版流程办理入口已删除，历史记录保留；新流程请通过3001编制V7后上传。', { code: 'LEGACY_PROCESS_RETIRED', error: '旧版流程办理入口已删除，历史记录保留。' });
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

function assertV7FormalTransitionEnabled(draft) {
  const document = parseJsonObject(draft && draft.process_content_json);
  const processRef = text(document && document.process && document.process.process_ref);
  try {
    assertV7FormalEnabled();
    assertV7TrialProcessRef(processRef);
  } catch (error) {
    throw httpError(error.statusCode || 500, error.message || 'V7单流程试点范围校验失败', {
      error: error.message || 'V7单流程试点范围校验失败',
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

function v7ReviewContentStale(draft, message = '当前V7正文或审核依据已经变化，请刷新后重试') {
  return httpError(409, message, {
    error: message,
    code: 'V7_REVIEW_CONTENT_STALE',
    ...v7ActualState(draft)
  });
}

function v7PromotionEvidenceMismatch(draft, message = '当前V7提升依据与正式草稿不一致，请重新完成受控提升') {
  return httpError(409, message, {
    error: message,
    code: 'V7_FORMAL_PROMOTION_EVIDENCE_MISMATCH',
    ...v7ActualState(draft)
  });
}

function v7DraftStateConflict(draft, message = '当前V7正式草稿状态不允许执行该操作') {
  return httpError(409, message, {
    error: message,
    code: 'V7_FORMAL_DRAFT_STATE_CONFLICT',
    ...v7ActualState(draft)
  });
}

function v7BaseVersionConflict(draft, message = '正式流程主档的当前版本已经变化，请重新提升最新V7修订') {
  return httpError(409, message, {
    error: message,
    code: 'V7_FORMAL_BASE_VERSION_CONFLICT',
    ...v7ActualState(draft)
  });
}

function v7BlockingIssuesError() {
  return httpError(409, '当前V7正文仍有阻断项，请回到3001修正后上传新修订', {
    error: '当前V7正文仍有阻断项，请回到3001修正后上传新修订',
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

async function mysqlQuery(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function mysqlRun(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function executeIgnoringDuplicateColumn(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && (error.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(error.message || '')))) return;
    throw error;
  }
}

async function executeIgnoringDuplicateKey(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && (
      error.code === 'ER_DUP_KEYNAME'
      || error.code === 'ER_DUP_INDEX'
      || /Duplicate key name/i.test(String(error.message || ''))
    )) return;
    throw error;
  }
}

async function executeIgnoringDuplicateCheck(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && (
      error.code === 'ER_FK_DUP_NAME'
      || error.code === 'ER_DUP_KEYNAME'
      || /Duplicate check constraint name/i.test(String(error.message || ''))
      || /already exists/i.test(String(error.message || ''))
    )) return;
    throw error;
  }
}

async function dropProcessDesignVersionStatusChecks(pool) {
  const checks = await mysqlQuery(pool, `
    SELECT tc.CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.CHECK_CONSTRAINTS cc
      ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA
     AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA=DATABASE()
      AND tc.TABLE_NAME='process_design_versions'
      AND tc.CONSTRAINT_TYPE='CHECK'
      AND cc.CHECK_CLAUSE LIKE '%retired%'
      AND cc.CHECK_CLAUSE NOT LIKE '%superseded%'
  `);
  for (const row of checks) {
    await pool.execute(`ALTER TABLE process_design_versions DROP CHECK \`${row.CONSTRAINT_NAME}\``);
  }
}

async function ensureProcessDesignEditionSchema(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_documents (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      document_no VARCHAR(128) NOT NULL,
      document_title VARCHAR(255) NOT NULL,
      owning_department_id BIGINT NOT NULL,
      current_edition VARCHAR(16) NULL,
      current_version_id BIGINT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_by BIGINT NULL,
      updated_by BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_process_design_documents_no (document_no),
      INDEX idx_process_design_documents_dept (owning_department_id, status),
      INDEX idx_process_design_documents_current_version (current_version_id),
      CHECK (status IN ('active','retired'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN document_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN planned_edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN base_version_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN active_document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_drafts ADD UNIQUE KEY uq_process_design_drafts_active_document_no (active_document_no)');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_drafts ADD INDEX idx_process_design_drafts_document (document_id, status)');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN document_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN effective_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN supersedes_version_id BIGINT NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_versions ADD UNIQUE KEY uq_process_design_versions_document_edition (document_no, edition)');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_versions ADD INDEX idx_process_design_versions_document (document_id, status)');
  await dropProcessDesignVersionStatusChecks(pool);
  await executeIgnoringDuplicateCheck(pool, "ALTER TABLE process_design_versions ADD CONSTRAINT chk_process_design_versions_status CHECK (status IN ('published','superseded','retired'))");
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_mapping_records ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_mapping_records ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_mapping_records ADD COLUMN document_edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_mapping_records ADD INDEX idx_process_mapping_records_document (document_no, document_edition)');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_a1_items ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_a1_items ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_a1_items ADD COLUMN document_edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_a1_items ADD INDEX idx_process_a1_items_document (document_no, document_edition)');
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [EDITION_SCHEMA_MIGRATION_KEY]);
}

async function ensureProcessDesignEvidenceStatusSchema(pool) {
  await executeIgnoringDuplicateColumn(pool, `ALTER TABLE process_design_evidence ADD COLUMN status ENUM('verified','pending_review','source_missing','ocr_extracted_not_confirmed','review_only') NOT NULL DEFAULT 'pending_review'`);
  const [migration] = await mysqlQuery(pool, 'SELECT migration_key FROM schema_migrations WHERE migration_key=?', [EVIDENCE_STATUS_MIGRATION_KEY]);
  if (migration) return;
  await mysqlRun(pool, "UPDATE process_design_evidence SET status='verified' WHERE status='pending_review' AND maturity='可支撑发布'");
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [EVIDENCE_STATUS_MIGRATION_KEY]);
}

async function ensureProcessDesignFormStructureSchema(pool) {
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN form_code VARCHAR(160) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN main_table_code VARCHAR(180) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN main_table_name VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_forms ADD COLUMN archive_location ENUM('部门自行保存','资料室') NULL");
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_forms ADD COLUMN retention_period ENUM('1年','3年','10年','永久') NULL");
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN responsible_department_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN responsible_department_name VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN responsible_role VARCHAR(255) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_forms ADD INDEX idx_process_design_forms_code (draft_id, form_code)');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_form_tables ADD COLUMN table_code VARCHAR(180) NULL');
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_form_table_fields ADD COLUMN structure_kind ENUM('main','detail') NOT NULL DEFAULT 'detail'");
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_form_table_fields ADD COLUMN field_code VARCHAR(220) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_form_table_fields ADD COLUMN enum_options TEXT NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_form_table_fields ADD INDEX idx_process_design_table_fields_kind (form_table_id, structure_kind, sort_order)');
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_field_types (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(64) NOT NULL,
      name VARCHAR(128) NOT NULL,
      sort_order INT NOT NULL DEFAULT 1,
      is_active TINYINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_process_design_field_types_code (code),
      UNIQUE KEY uq_process_design_field_types_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  for (let index = 0; index < DEFAULT_PROCESS_DESIGN_FIELD_TYPES.length; index += 1) {
    const [code, name] = DEFAULT_PROCESS_DESIGN_FIELD_TYPES[index];
    await mysqlRun(pool, `
      INSERT INTO process_design_field_types (code, name, sort_order)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE name=VALUES(name), sort_order=VALUES(sort_order), is_active=1
    `, [code, name, index + 1]);
  }
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [FORM_STRUCTURE_SCHEMA_MIGRATION_KEY]);
}

async function ensureProcessDesignStepTransitionSchema(pool) {
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_steps ADD COLUMN step_type VARCHAR(32) NOT NULL DEFAULT 'action' AFTER process_id");
  await pool.execute("UPDATE process_design_steps SET step_type='action' WHERE step_type IS NULL OR step_type=''");
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_step_transitions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      draft_id BIGINT NOT NULL,
      process_id BIGINT NOT NULL,
      from_step_id BIGINT NOT NULL,
      condition_text VARCHAR(255) NOT NULL,
      to_step_id BIGINT NULL,
      evidence_refs_json JSON NULL,
      sort_order INT NOT NULL DEFAULT 1,
      created_by BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_process_design_step_transitions_draft (draft_id, sort_order),
      INDEX idx_process_design_step_transitions_process (process_id, from_step_id),
      CONSTRAINT fk_process_design_step_transitions_draft FOREIGN KEY (draft_id)
        REFERENCES process_design_drafts(id) ON DELETE CASCADE,
      CONSTRAINT fk_process_design_step_transitions_process FOREIGN KEY (process_id)
        REFERENCES process_design_processes(id) ON DELETE CASCADE,
      CONSTRAINT fk_process_design_step_transitions_from_step FOREIGN KEY (from_step_id)
        REFERENCES process_design_steps(id) ON DELETE CASCADE,
      CONSTRAINT fk_process_design_step_transitions_to_step FOREIGN KEY (to_step_id)
        REFERENCES process_design_steps(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_step_transitions ADD INDEX idx_process_design_step_transitions_draft (draft_id, sort_order)');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_step_transitions ADD INDEX idx_process_design_step_transitions_process (process_id, from_step_id)');
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [STEP_TRANSITION_SCHEMA_MIGRATION_KEY]);
}

function makeProcessDesignMysqlRepository(pool) {
  async function getById(table, id) {
    const [row] = await mysqlQuery(pool, `SELECT * FROM ${table} WHERE id=?`, [id]);
    return row || null;
  }

  async function getDocumentById(documentId) {
    const [row] = await mysqlQuery(pool, 'SELECT * FROM process_design_documents WHERE id=?', [documentId]);
    return row || null;
  }

  async function addEvent(draftId, eventType, actorUserId, note, payload) {
    await mysqlRun(pool, `
      INSERT INTO process_design_events (draft_id, event_type, actor_user_id, note, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `, [draftId, eventType, actorUserId || null, optionalText(note), payload ? JSON.stringify(payload) : null]);
  }

  async function locateFormalV7Transition(draftId, taskId = null) {
    let locatedDraftId = Number(draftId);
    if (taskId != null) {
      const [task] = await mysqlQuery(pool, `
        SELECT id, draft_id
        FROM process_design_review_tasks
        WHERE id=?
      `, [Number(taskId)]);
      if (!task) throw httpError(404, '审核任务不存在');
      locatedDraftId = Number(task.draft_id);
    }
    const [promotion] = await mysqlQuery(pool, `
      SELECT id, preview_case_id, preview_revision_id, document_id, draft_id
      FROM process_v7_promotions
      WHERE draft_id=?
      ORDER BY id DESC
      LIMIT 1
    `, [locatedDraftId]);
    if (!promotion) {
      throw v7PromotionEvidenceMismatch({ id: locatedDraftId }, '正式V7草稿缺少当前提升依据，请重新完成受控提升');
    }
    return {
      caseId: Number(promotion.preview_case_id),
      draftId: locatedDraftId,
      taskId: taskId == null ? null : Number(taskId)
    };
  }

  async function lockFormalV7Context(locator) {
    const [previewCase] = await mysqlQuery(pool, `
      SELECT *
      FROM process_v7_preview_cases
      WHERE id=?
      FOR UPDATE
    `, [locator.caseId]);
    if (!previewCase) throw v7PromotionEvidenceMismatch(null, '正式V7草稿关联的预览案例不存在');

    const [revision] = await mysqlQuery(pool, `
      SELECT *
      FROM process_v7_preview_revisions
      WHERE id=? AND case_id=?
      FOR SHARE
    `, [previewCase.current_revision_id, previewCase.id]);
    if (!revision) throw v7PromotionEvidenceMismatch(null, '正式V7草稿关联的当前预览修订不存在');

    const [promotion] = await mysqlQuery(pool, `
      SELECT *
      FROM process_v7_promotions
      WHERE preview_case_id=? AND draft_id=?
      ORDER BY id DESC
      LIMIT 1
      FOR SHARE
    `, [previewCase.id, locator.draftId]);
    if (!promotion) throw v7PromotionEvidenceMismatch(null, '正式V7草稿缺少当前提升依据，请重新完成受控提升');

    const [document] = await mysqlQuery(pool, `
      SELECT *
      FROM process_design_documents
      WHERE id=?
      FOR UPDATE
    `, [promotion.document_id]);
    if (!document || text(document.status) !== 'active') {
      throw httpError(409, '正式流程主档不存在或已停用，不能继续处理V7正文', {
        error: '正式流程主档不存在或已停用，不能继续处理V7正文',
        code: 'V7_FORMAL_DOCUMENT_NOT_FOUND'
      });
    }

    let currentVersion = null;
    if (document.current_version_id) {
      [currentVersion] = await mysqlQuery(pool, `
        SELECT *
        FROM process_design_versions
        WHERE id=?
        FOR UPDATE
      `, [document.current_version_id]);
      if (!currentVersion || Number(currentVersion.document_id) !== Number(document.id)) {
        throw v7BaseVersionConflict(null, '正式流程主档的当前版本指针无效，不能继续处理V7正文');
      }
    } else {
      const [unexpectedVersion] = await mysqlQuery(pool, `
        SELECT *
        FROM process_design_versions
        WHERE document_id=? AND status='published'
        ORDER BY effective_at DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `, [document.id]);
      if (unexpectedVersion) {
        throw v7BaseVersionConflict(null, '正式流程主档存在有效版本但缺少当前版本指针，不能继续处理V7正文');
      }
    }

    const [draftRow] = await mysqlQuery(pool, `
      SELECT *
      FROM process_design_drafts
      WHERE id=?
      FOR UPDATE
    `, [promotion.draft_id]);
    const draft = publicDraft(draftRow);
    if (!draft || Number(draft.id) !== Number(locator.draftId)) {
      throw v7PromotionEvidenceMismatch(draft, '正式V7草稿与当前提升依据不一致');
    }
    const reviewTasks = await mysqlQuery(pool, `
      SELECT *
      FROM process_design_review_tasks
      WHERE draft_id=?
      ORDER BY id ASC
      FOR UPDATE
    `, [draft.id]);
    assertV7FormalTransitionEnabled(draft);
    return { previewCase, revision, promotion, document, currentVersion, draft, reviewTasks };
  }

  async function authorizeFormalV7Actor(options, operation, context, actorUserId) {
    const actor = options && options[FORMAL_V7_ACTOR_CONTEXT];
    const personId = Number(actor && actor.personId || 0);
    const accountId = Number(actor && actor.accountId || 0);
    const authVersion = Number(actor && actor.authVersion || 0);
    const expectedActorUserId = Number(actorUserId || 0);
    if (!personId || !accountId || !authVersion || (expectedActorUserId && expectedActorUserId !== personId)) {
      throw httpError(401, '正式V7状态变更缺少受控的当前操作人上下文', {
        error: '正式V7状态变更缺少受控的当前操作人上下文',
        code: 'V7_FORMAL_ACTOR_CONTEXT_REQUIRED'
      });
    }

    const [account] = await mysqlQuery(pool, `
      SELECT ua.account_id, ua.person_id, ua.account_status, ua.auth_version,
             p.current_department_id, p.employment_status, p.status AS person_status
      FROM user_accounts ua
      JOIN person p ON p.person_id=ua.person_id
      WHERE ua.account_id=? AND ua.person_id=?
      FOR SHARE
    `, [accountId, personId]);
    if (
      !account ||
      text(account.account_status) !== 'active' ||
      text(account.person_status) !== 'active' ||
      text(account.employment_status) !== 'active' ||
      Number(account.auth_version) !== authVersion
    ) {
      throw httpError(401, '账号状态或授权已经变化，请重新登录', {
        error: '账号状态或授权已经变化，请重新登录',
        code: 'SESSION_AUTHORIZATION_CHANGED'
      });
    }

    const assignments = await mysqlQuery(pool, `
      SELECT pr.person_role_id, pr.scope_type, pr.scope_department_id,
             r.role_code, permission.perm_code, rp.effect
      FROM person_roles pr
      JOIN roles r ON r.role_id=pr.role_id
      LEFT JOIN role_permissions rp ON rp.role_id=r.role_id
      LEFT JOIN permissions permission ON permission.perm_id=rp.perm_id
      WHERE pr.person_id=?
        AND pr.assignment_status='active'
        AND pr.authorization_basis IS NOT NULL
        AND pr.effective_from IS NOT NULL
        AND pr.effective_from<=CURRENT_DATE
        AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
        AND r.status='active'
        AND r.model_version=?
      ORDER BY pr.person_role_id, permission.perm_code
      FOR SHARE
    `, [personId, ACCESS_MODEL_VERSION]);
    const roleCodes = new Set(assignments.map(item => text(item.role_code)).filter(Boolean));
    if (roleCodes.has('admin')) {
      throw httpError(403, '管理员对治理材料只读，不能执行正式V7业务写入', {
        error: '管理员对治理材料只读，不能执行正式V7业务写入',
        code: 'V7_FORMAL_ADMIN_READ_ONLY'
      });
    }

    const requirements = {
      submit: { role: 'department_contact', permissions: ['governance:draft-department', 'governance:submit-department'], departmentScoped: true },
      review: { role: 'department_mdm_reviewer', permissions: ['governance:review-department'], departmentScoped: true },
      publish: { role: 'mdm_lead', permissions: ['governance:publish'], departmentScoped: false }
    }[operation];
    const permissionEffects = new Map();
    assignments.forEach(item => {
      const permissionCode = text(item.perm_code);
      if (!permissionCode) return;
      if (text(item.effect) === 'deny') permissionEffects.set(permissionCode, 'deny');
      else if (!permissionEffects.has(permissionCode)) permissionEffects.set(permissionCode, 'allow');
    });
    const formalDepartmentId = Number(context && context.draft && context.draft.department_id || 0);
    const currentDepartmentId = Number(account.current_department_id || 0);
    const expectedRoleAssignments = assignments.filter(item => text(item.role_code) === requirements.role);
    const roleScopeAllowed = requirements.departmentScoped
      ? currentDepartmentId === formalDepartmentId && expectedRoleAssignments.some(item =>
          text(item.scope_type) === 'department' &&
          Number(item.scope_department_id || 0) === formalDepartmentId
        )
      : expectedRoleAssignments.some(item => text(item.scope_type) === 'global');
    const permissionsAllowed = requirements.permissions.every(code => permissionEffects.get(code) === 'allow');
    if (!roleScopeAllowed || !permissionsAllowed) {
      throw httpError(403, '当前操作人的有效角色、部门范围或权限不允许执行该正式V7操作', {
        error: '当前操作人的有效角色、部门范围或权限不允许执行该正式V7操作',
        code: 'V7_FORMAL_ACTOR_SCOPE_DENIED'
      });
    }
    return { personId, accountId, authVersion, departmentId: currentDepartmentId };
  }

  async function runFormalV7Transaction(draftId, taskId, operation) {
    const locator = await locateFormalV7Transition(draftId, taskId);
    if (!pool || typeof pool.getConnection !== 'function') {
      return await operation({ locator, repository: null, transaction: false });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const transactionRepository = makeProcessDesignMysqlRepository(connection);
      const result = await operation({ locator, repository: transactionRepository, transaction: true });
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async function loadEvents(draftId) {
    const rows = await mysqlQuery(pool, `
      SELECT e.*, u.name AS actor_user_name
      FROM process_design_events e
      LEFT JOIN users u ON u.id=e.actor_user_id
      WHERE e.draft_id=?
      ORDER BY e.id
    `, [draftId]);
    return rows.map(row => ({
      ...row,
      payload: parseJsonObject(row.payload_json)
    }));
  }

  async function loadReviewTasks(draftId) {
    return await mysqlQuery(pool, 'SELECT * FROM process_design_review_tasks WHERE draft_id=? ORDER BY id', [draftId]);
  }

  async function validateFormalV7Draft(draft, context, options = {}) {
    const document = parseJsonObject(draft && draft.process_content_json);
    const departments = await mysqlQuery(pool, `
      SELECT id, name, code
      FROM departments
      WHERE status='active'
      ORDER BY sort_order, id
    `);
    const owningDepartment = departments.find(item => Number(item.id) === Number(draft.department_id)) || null;
    const preview = validateAndProjectV7(document, departments, {
      owningDepartmentName: owningDepartment && owningDepartment.name || ''
    });
    if (preview.errors.length) {
      throw httpError(422, '正式V7草稿正文校验失败', {
        error: '正式V7草稿正文校验失败',
        code: 'V7_FORMAL_CONTENT_INVALID',
        details: preview.errors
      });
    }
    if (!context) throw v7PromotionEvidenceMismatch(draft, '正式V7草稿缺少锁定后的提升依据');
    const scopeDecision = text(context.previewCase && context.previewCase.scope_decision);
    if (!options.allowBlockingIssues && unresolvedBlockingIssues(preview.blockingIssues, scopeDecision).length) {
      throw v7BlockingIssuesError();
    }
    if (v7ContentHash(document) !== text(draft.content_hash)) {
      throw v7PromotionEvidenceMismatch(draft, '正式V7草稿正文摘要与当前记录不一致');
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
      throw v7PromotionEvidenceMismatch(draft, '正式V7草稿没有匹配的当前预览核对和提升依据');
    }
    if (
      Number(draft.document_id) !== Number(formalDocument && formalDocument.id) ||
      Number(draft.department_id) !== Number(previewCase.owning_department_id) ||
      Number(formalDocument && formalDocument.owning_department_id) !== Number(previewCase.owning_department_id) ||
      text(preview.processRef) !== text(previewCase.process_ref) ||
      text(formalDocument && formalDocument.process_ref) !== text(preview.processRef)
    ) {
      throw v7PromotionEvidenceMismatch(draft, '正式V7草稿、归口部门、流程主档或process_ref与当前提升依据不一致');
    }
    assertV7FormalTransitionEnabled(draft);
    return { document, preview, promotion, previewCase, revision, formalDocument };
  }

  async function getDraft(id) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*, dept.name AS department_name, proxyDept.name AS proxy_department_name, creator.name AS created_by_name
      FROM process_design_drafts d
      LEFT JOIN departments dept ON dept.id=d.department_id
      LEFT JOIN departments proxyDept ON proxyDept.id=d.proxy_department_id
      LEFT JOIN users creator ON creator.id=d.created_by
      WHERE d.id=?
    `, [id]);
    return publicDraft(row);
  }

  async function detailForDraft(draftId) {
    const draft = await getDraft(draftId);
    if (!draft) return null;
    const document = draft.document_id ? await getDocumentById(draft.document_id) : null;
    const versions = document ? await mysqlQuery(pool, `
      SELECT *
      FROM process_design_versions
      WHERE document_id=?
      ORDER BY effective_at DESC, id DESC
    `, [document.id]) : [];
    const reviewTasks = await loadReviewTasks(draftId);
    const events = await loadEvents(draftId);
    if (['process-governance-v7', 'process-governance-v8'].includes(text(draft.schema_version))) {
      const content = parseJsonObject(draft.process_content_json);
      const contentHashVerified = Boolean(
        content &&
        text(draft.content_hash) &&
        v7ContentHash(content) === text(draft.content_hash)
      );
      const approvedCurrentReview = reviewTasks.some(task =>
        text(task.status) === 'approved' &&
        Number(task.draft_revision_no) === Number(draft.revision_no) &&
        text(task.content_hash) === text(draft.content_hash)
      );
      return {
        draft,
        document,
        versions,
        reviewTasks,
        events,
        v7_native: true,
        content,
        content_hash_verified: contentHashVerified,
        outcome: {
          formed: draft.status === 'published' ? '已形成不可变的原生V7正式版本' : '已形成原生V7正式草稿',
          current: `当前状态为${draft.status}`,
          missing: contentHashVerified ? [] : ['V7正文与内容摘要不一致'],
          next: draft.status === 'published' ? '后续治理对象绑定process_version_id' : '按当前状态完成正式审核或发布'
        },
        publishable: draft.status === 'approved' && approvedCurrentReview && contentHashVerified
      };
    }
    throw httpError(410, '旧版流程办理已停用', { code: 'LEGACY_PROCESS_RETIRED' });
  }

  return {
getDraft,
getDocumentById,
async getVersionContent(versionId) {
      const [version] = await mysqlQuery(pool, `
        SELECT id, draft_id, document_id, document_no, document_title, edition, version_no,
               department_id, schema_version, process_content_json, content_json, content_hash,
               source_revision_no, status, UNIX_TIMESTAMP(published_at) AS published_at_epoch,
               effective_at, supersedes_version_id
        FROM process_design_versions
        WHERE id=?
        LIMIT 1
      `, [versionId]);
      if (!version) return null;
      const rawContent = version.process_content_json || version.content_json;
      return {
        process_version_id: Number(version.id),
        draft_id: Number(version.draft_id),
        document_id: Number(version.document_id),
        document_no: version.document_no,
        document_title: version.document_title,
        edition: version.edition,
        version_no: version.version_no,
        department_id: Number(version.department_id),
        schema_version: text(version.schema_version),
        content_hash: text(version.content_hash) || null,
        source_revision_no: version.source_revision_no == null ? null : Number(version.source_revision_no),
        status: version.status,
        // MySQL resolves TIMESTAMP in the session timezone. Reading its epoch
        // avoids interpreting the server wall time in the Node host timezone.
        published_at: version.published_at_epoch == null ? null : new Date(Number(version.published_at_epoch) * 1000).toISOString(),
        effective_at: version.effective_at,
        supersedes_version_id: version.supersedes_version_id == null ? null : Number(version.supersedes_version_id),
        document: rawContent ? parseJsonObject(rawContent) : null
      };
    },
detail: detailForDraft,
async canonicalContent(draft) {
      if (['process-governance-v7', 'process-governance-v8'].includes(text(draft.schema_version))) {
        const document = parseJsonObject(draft.process_content_json);
        const calculatedHash = v7ContentHash(document);
        if (!document || calculatedHash !== text(draft.content_hash)) {
          throw httpError(409, '正式V7草稿正文摘要校验失败', {
            error: '正式V7草稿正文摘要校验失败',
            code: 'V7_FORMAL_CONTENT_HASH_MISMATCH'
          });
        }
        return {
          source: 'draft_canonical_json',
          schema_version: draft.schema_version,
          content_hash: calculatedHash,
          revision: Number(draft.revision_no || 0),
          document
        };
      }
      throw httpError(410, '旧版流程办理已停用', { code: 'LEGACY_PROCESS_RETIRED' });
    },
async submitDraft(draft, note, actorUserId, options = {}) {
      const transactionContext = options && options[FORMAL_V7_TRANSACTION_CONTEXT];
      let storedDraft = null;
      let isV7 = Boolean(transactionContext);
      if (!transactionContext) {
        storedDraft = await getDraft(Number(draft && draft.id));
        if (!storedDraft) throw httpError(404, '制度结构草稿不存在');
        isV7 = ['process-governance-v7', 'process-governance-v8'].includes(text(storedDraft.schema_version));
      }
      if (isV7 && !transactionContext) {
        assertV7FormalTransitionEnabled(storedDraft);
        v7FormalExpectedBinding(options);
        return await runFormalV7Transaction(storedDraft.id, null, async ({ locator, repository: transactionRepository }) => {
          if (!transactionRepository) {
            throw httpError(503, '正式V7状态变更必须在MySQL事务中执行', {
              error: '正式V7状态变更必须在MySQL事务中执行',
              code: 'V7_FORMAL_TRANSACTION_REQUIRED'
            });
          }
          return await transactionRepository.submitDraft(
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
      if (isV7) {
        if (transactionContext.operation !== 'submit' || !transactionContext.locator) {
          throw httpError(503, '正式V7提交缺少受控的事务能力', {
            error: '正式V7提交缺少受控的事务能力',
            code: 'V7_FORMAL_TRANSACTION_REQUIRED'
          });
        }
        const binding = v7FormalExpectedBinding(options);
        const context = await lockFormalV7Context(transactionContext.locator);
        const lockedDraft = context.draft;
        const authorizedActor = await authorizeFormalV7Actor(options, 'submit', context, actorUserId);
        assertV7ExpectedContent(lockedDraft, binding);
        if (!EDITABLE_DRAFT_STATUSES.has(text(lockedDraft.status))) {
          throw v7DraftStateConflict(lockedDraft, '当前V7正式草稿状态不能提交审核');
        }
        await validateFormalV7Draft(lockedDraft, context);
        const updateResult = await mysqlRun(pool, `
          UPDATE process_design_drafts
          SET status='submitted', submitted_by=?, submitted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status IN ('draft','needs_changes') AND revision_no=? AND content_hash=?
        `, [authorizedActor.personId, lockedDraft.id, binding.expectedRevisionNo, binding.expectedContentHash]);
        if (Number(updateResult.affectedRows) !== 1) throw v7ReviewContentStale(lockedDraft);
        const taskResult = await mysqlRun(pool, `
          INSERT INTO process_design_review_tasks
            (draft_id, draft_revision_no, content_hash, task_type, assignee_role, created_by)
          VALUES (?, ?, ?, 'department_review', 'department_mdm_reviewer', ?)
        `, [lockedDraft.id, binding.expectedRevisionNo, binding.expectedContentHash, authorizedActor.personId]);
        await addEvent(lockedDraft.id, 'submitted', authorizedActor.personId, optionalText(note) || '已提交审核', {
          draft_revision_no: binding.expectedRevisionNo,
          content_hash: binding.expectedContentHash
        });
        const updated = await getDraft(lockedDraft.id);
        return {
          draft: updated,
          reviewTask: await getById('process_design_review_tasks', taskResult.insertId),
          outcome: {
            formed: '已形成原生V7正式草稿',
            current: '当前V7正文已提交部门审核',
            missing: [],
            next: '部门审核员核对当前修订号和内容摘要后记录审核结论'
          }
        };
      }
      throw httpError(410, '旧版流程办理已停用', { code: 'LEGACY_PROCESS_RETIRED' });
    },
async getReviewTask(taskId) {
      return await getById('process_design_review_tasks', taskId);
    },
async decideReviewTask(task, decision, note, actorUserId, options = {}) {
      const statusByDecision = { approve: 'approved', reject: 'rejected', needs_changes: 'needs_changes' };
      const nextStatus = statusByDecision[decision];
      let draft = null;
      let storedTask = null;
      const transactionContext = options && options[FORMAL_V7_TRANSACTION_CONTEXT];
      let isV7 = Boolean(transactionContext);
      if (!transactionContext) {
        storedTask = await getById('process_design_review_tasks', Number(task && task.id));
        if (!storedTask) throw httpError(404, '审核任务不存在');
        draft = await getDraft(storedTask.draft_id);
        if (!draft) throw httpError(404, '制度结构草稿不存在');
        isV7 = ['process-governance-v7', 'process-governance-v8'].includes(text(draft.schema_version));
      }
      if (isV7 && !transactionContext) {
        assertV7FormalTransitionEnabled(draft);
        v7FormalExpectedBinding(options);
        return await runFormalV7Transaction(draft.id, storedTask.id, async ({ locator, repository: transactionRepository }) => {
          if (!transactionRepository) {
            throw httpError(503, '正式V7状态变更必须在MySQL事务中执行', {
              error: '正式V7状态变更必须在MySQL事务中执行',
              code: 'V7_FORMAL_TRANSACTION_REQUIRED'
            });
          }
          return await transactionRepository.decideReviewTask(
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
      if (isV7) {
        if (!transactionContext || transactionContext.operation !== 'review' || !transactionContext.locator) {
          throw httpError(503, '正式V7审核缺少受控的事务能力', {
            error: '正式V7审核缺少受控的事务能力',
            code: 'V7_FORMAL_TRANSACTION_REQUIRED'
          });
        }
        const binding = v7FormalExpectedBinding(options);
        const context = await lockFormalV7Context(transactionContext.locator);
        const lockedDraft = context.draft;
        const authorizedActor = await authorizeFormalV7Actor(options, 'review', context, actorUserId);
        const lockedTask = context.reviewTasks.find(item => Number(item.id) === Number(transactionContext.locator.taskId));
        assertV7ExpectedContent(lockedDraft, binding);
        if (!lockedTask) throw v7ReviewContentStale(lockedDraft, '当前V7审核任务与正式草稿不一致');
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
          throw v7ReviewContentStale(lockedDraft, '审核任务绑定的V7正文已经过期，请重新提交当前修订');
        }
        if (!['submitted', 'under_review'].includes(text(lockedDraft.status))) {
          throw v7DraftStateConflict(lockedDraft, '当前V7正式草稿状态不能记录审核结论');
        }
        await validateFormalV7Draft(lockedDraft, context, {
          allowBlockingIssues: decision === 'needs_changes' || decision === 'reject'
        });
        const taskUpdate = await mysqlRun(pool, `
          UPDATE process_design_review_tasks
          SET status=?, decision_note=?, decided_by=?, decided_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='pending' AND draft_revision_no=? AND content_hash=?
        `, [nextStatus, optionalText(note), authorizedActor.personId, lockedTask.id, binding.expectedRevisionNo, binding.expectedContentHash]);
        if (Number(taskUpdate.affectedRows) !== 1) throw v7ReviewContentStale(lockedDraft);
        const draftUpdate = await mysqlRun(pool, `
          UPDATE process_design_drafts
          SET status=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status IN ('submitted','under_review') AND revision_no=? AND content_hash=?
        `, [nextStatus, lockedDraft.id, binding.expectedRevisionNo, binding.expectedContentHash]);
        if (Number(draftUpdate.affectedRows) !== 1) throw v7ReviewContentStale(lockedDraft);
        await addEvent(lockedDraft.id, `review_${decision}`, authorizedActor.personId, optionalText(note) || '已处理审核任务', {
          review_task_id: Number(lockedTask.id),
          draft_revision_no: binding.expectedRevisionNo,
          content_hash: binding.expectedContentHash,
          decision
        });
        return {
          draft: await getDraft(lockedDraft.id),
          reviewTask: await getById('process_design_review_tasks', lockedTask.id)
        };
      }
      throw httpError(410, '旧版流程办理已停用', { code: 'LEGACY_PROCESS_RETIRED' });
    },
async publishDraft(draft, note, actorUserId, options = {}) {
      const formalTransactionContext = options && options[FORMAL_V7_TRANSACTION_CONTEXT];
      let storedDraft = null;
      let isV7 = Boolean(formalTransactionContext);
      if (!formalTransactionContext) {
        storedDraft = await getDraft(Number(draft && draft.id));
        if (!storedDraft) throw httpError(404, '制度结构草稿不存在');
        isV7 = ['process-governance-v7', 'process-governance-v8'].includes(text(storedDraft.schema_version));
      }
      if (isV7 && !formalTransactionContext) {
        assertV7FormalTransitionEnabled(storedDraft);
        v7FormalExpectedBinding(options);
        return await runFormalV7Transaction(storedDraft.id, null, async ({ locator, repository: transactionRepository }) => {
          if (!transactionRepository) {
            throw httpError(503, '正式V7状态变更必须在MySQL事务中执行', {
              error: '正式V7状态变更必须在MySQL事务中执行',
              code: 'V7_FORMAL_TRANSACTION_REQUIRED'
            });
          }
          return await transactionRepository.publishDraft(
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
      if (isV7) {
        if (formalTransactionContext.operation !== 'publish' || !formalTransactionContext.locator) {
          throw httpError(503, '正式V7发布缺少受控的事务能力', {
            error: '正式V7发布缺少受控的事务能力',
            code: 'V7_FORMAL_TRANSACTION_REQUIRED'
          });
        }
        const binding = v7FormalExpectedBinding(options);
        const context = await lockFormalV7Context(formalTransactionContext.locator);
        const lockedDraft = context.draft;
        const document = context.document;
        const currentVersion = context.currentVersion;
        const authorizedActor = await authorizeFormalV7Actor(options, 'publish', context, actorUserId);
        assertV7ExpectedContent(lockedDraft, binding);
        if (text(lockedDraft.status) !== 'approved') {
          throw v7DraftStateConflict(lockedDraft, '当前V7正式草稿尚未通过部门审核，不能发布');
        }
        await validateFormalV7Draft(lockedDraft, context);
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
          throw v7BaseVersionConflict(lockedDraft, '当前有效版次与V7正式草稿计划版次不一致，请重新提升最新修订');
        }
        const versionNo = documentVersionNo(document.document_no, plannedEdition);
        const result = await mysqlRun(pool, `
          INSERT INTO process_design_versions
            (draft_id, document_id, document_no, document_title, edition, version_no,
             department_id, l1_name, l2_name, l3_name, content_json,
             schema_version, process_content_json, content_hash, source_revision_no,
             published_by, effective_at, supersedes_version_id, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL,
                  ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'published')
        `, [
          lockedDraft.id,
          document.id,
          document.document_no,
          document.document_title,
          plannedEdition,
          versionNo,
          lockedDraft.department_id,
          lockedDraft.schema_version,
          lockedDraft.process_content_json,
          lockedDraft.content_hash,
          Number(lockedDraft.revision_no),
          authorizedActor.personId,
          currentVersion && currentVersion.id || null
        ]);
        // Users explicitly select a published version in the data governance workspace.
        if (currentVersion) {
          const supersedeResult = await mysqlRun(pool, `
            UPDATE process_design_versions
            SET status='superseded'
            WHERE id=? AND document_id=? AND status='published'
          `, [currentVersion.id, document.id]);
          if (Number(supersedeResult.affectedRows) !== 1) throw v7BaseVersionConflict(lockedDraft);
        }
        const draftUpdate = await mysqlRun(pool, `
          UPDATE process_design_drafts
          SET status='published', active_document_no=NULL, published_by=?,
              published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='approved' AND revision_no=? AND content_hash=?
        `, [authorizedActor.personId, lockedDraft.id, binding.expectedRevisionNo, binding.expectedContentHash]);
        if (Number(draftUpdate.affectedRows) !== 1) throw v7ReviewContentStale(lockedDraft);
        const documentUpdate = currentVersion
          ? await mysqlRun(pool, `
              UPDATE process_design_documents
              SET document_title=?, current_edition=?, current_version_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
              WHERE id=? AND current_version_id=?
            `, [document.document_title, plannedEdition, result.insertId, authorizedActor.personId, document.id, currentVersion.id])
          : await mysqlRun(pool, `
              UPDATE process_design_documents
              SET document_title=?, current_edition=?, current_version_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
              WHERE id=? AND current_version_id IS NULL
            `, [document.document_title, plannedEdition, result.insertId, authorizedActor.personId, document.id]);
        if (Number(documentUpdate.affectedRows) !== 1) throw v7BaseVersionConflict(lockedDraft);
        const version = await getById('process_design_versions', result.insertId);
        await addEvent(lockedDraft.id, 'publish', authorizedActor.personId, optionalText(note) || '已发布原生V7流程版本', {
          process_version_id: Number(version.id),
          schema_version: lockedDraft.schema_version,
          content_hash: binding.expectedContentHash,
          source_revision_no: binding.expectedRevisionNo,
          review_task_id: Number(approvedReview.id),
          document_no: document.document_no,
          edition: plannedEdition,
          supersedes_version_id: currentVersion && currentVersion.id || null
        });
        const publishedDraft = await getDraft(lockedDraft.id);
        return {
          draft: publishedDraft,
          version,
          process_version_id: Number(version.id),
          outcome: {
            formed: '已形成不可变的原生V7正式版本',
            current: `当前正式版本为${versionNo}`,
            missing: [],
            next: '后续治理对象应绑定process_version_id，不读取原始3001文件或预览案例'
          }
        };
      }
      throw httpError(410, '旧版流程办理已停用', { code: 'LEGACY_PROCESS_RETIRED' });
    }
  };
}

async function repository() {
  if (repositoryFactory) return await repositoryFactory();
  if (!repositoryPromise) {
    repositoryPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      await checkRuntimeSchema(pool, 'processDesign');
      return makeProcessDesignMysqlRepository(pool);
    })();
  }
  try {
    return await repositoryPromise;
  } catch (error) {
    repositoryPromise = null;
    throw error;
  }
}

function setProcessDesignRepositoryFactory(factory) {
  repositoryFactory = factory;
  repositoryPromise = null;
}

function resetProcessDesignRepositoryFactory() {
  repositoryFactory = null;
  repositoryPromise = null;
}

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
  if (await canViewAcrossDepartments(req)) return;
  const deptIds = await authorizedDepartmentIds(req);
  if (deptIds.has(Number(draft.department_id)) && await hasCurrentPermission(req, 'governance:read-department')) return;
  throw httpError(403, '无权查看该制度结构草稿');
}

async function assertCanEditDraft(req, repo, draft) {
  await assertCanViewDraft(req, repo, draft);
  assertAdminCannotWrite(await currentRoleCodes(req));
  if (draft.status === 'published') throw httpError(409, '已发布流程不能直接修改草稿');
  const deptIds = await authorizedDepartmentIds(req);
  if (
    deptIds.has(Number(draft.department_id)) &&
    await hasCurrentPermission(req, 'governance:draft-department')
  ) return;
  throw httpError(403, '无权维护该制度结构草稿');
}

async function assertCanEditDraftContent(req, repo, draft) {
  await assertCanEditDraft(req, repo, draft);
  if (['process-governance-v7', 'process-governance-v8'].includes(text(draft.schema_version))) {
    throw httpError(409, 'V7正式草稿正文不能在3000直接修改；请回到3001修改后上传新修订', {
      error: 'V7正式草稿正文不能在3000直接修改；请回到3001修改后上传新修订',
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

async function currentDepartmentIdentity(req) {
  const department = req.session.departmentId
    ? await getDepartmentByIdAsync(Number(req.session.departmentId))
    : null;
  return department
    ? { id: Number(department.id || department.department_id), name: text(department.name || department.department_name) }
    : null;
}

function assertAdminCannotWrite(roleCodes) {
  if (roleCodes.has('admin')) throw httpError(403, '管理员对治理材料只读，不能执行承接业务写入');
}

function formalV7RepositoryOptions(req, binding) {
  const identity = req.identity || {};
  const actor = Object.freeze({
    personId: Number(req.session && (req.session.personId || req.session.userId) || identity.personId || identity.person_id || 0) || null,
    accountId: Number(req.session && req.session.accountId || identity.accountId || identity.account_id || 0) || null,
    authVersion: Number(req.session && req.session.authVersion || identity.authVersion || identity.auth_version || 0) || null
  });
  return {
    ...binding,
    [FORMAL_V7_ACTOR_CONTEXT]: actor
  };
}

async function readableProcessVersion(req) {
  const repo = await repository();
  const version = await repo.getVersionContent(req.params.processVersionId);
  if (!version) throw httpError(404, '正式流程版本不存在', { error: '正式流程版本不存在', code: 'PROCESS_VERSION_NOT_FOUND' });
  if (!await canViewAcrossDepartments(req)) {
    const departmentIds = await authorizedDepartmentIds(req);
    if (!departmentIds.has(Number(version.department_id)) || !await hasCurrentPermission(req, 'governance:read-department')) {
      throw httpError(403, '无权查看该正式流程版本', { error: '无权查看该正式流程版本', code: 'PROCESS_VERSION_SCOPE_DENIED' });
    }
  }
  if (!version.document) {
    throw httpError(409, '正式流程版本缺少可读正文', { error: '正式流程版本缺少可读正文', code: 'PROCESS_VERSION_CONTENT_MISSING' });
  }
  if (['process-governance-v7', 'process-governance-v8'].includes(text(version.schema_version))) {
    const calculatedHash = v7ContentHash(version.document);
    if (text(version.content_hash) !== calculatedHash) {
      throw httpError(409, '正式V7版本正文摘要校验失败', {
        error: '正式V7版本正文摘要校验失败',
        code: 'V7_VERSION_CONTENT_HASH_MISMATCH'
      });
    }
    version.content_hash_verified = true;
  }
  return version;
}

router.get('/versions/:processVersionId/content', requireAuth, (req, res) => runAction(res, async () => {
  res.json(await readableProcessVersion(req));
}));

router.get('/versions/:processVersionId/procedure-markdown', requireAuth, (req, res) => runAction(res, async () => {
  const version = await readableProcessVersion(req);
  if (!['published', 'superseded'].includes(version.status)) {
    throw httpError(409, '该版本当前不能用于生成程序文件', { error: '该版本当前不能用于生成程序文件', code: 'PROCEDURE_VERSION_NOT_PUBLISHED' });
  }
  if (!['process-governance-v7', 'process-governance-v8'].includes(version.schema_version) || version.document.schema_version !== version.schema_version) {
    throw httpError(409, '程序文件下载需要原生V7正式版本', { error: '程序文件下载需要原生V7正式版本', code: 'PROCEDURE_V7_REQUIRED' });
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

router.get('/drafts/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  assertActiveV7Draft(draft);
  res.json(await repo.detail(draft.id));
}));

router.post('/drafts/:id/submit', requireAuth, requirePermission('governance:submit-department'), (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  assertActiveV7Draft(draft);
  const isV7 = ['process-governance-v7', 'process-governance-v8'].includes(text(draft && draft.schema_version));
  let expectedBinding = {};
  if (isV7) {
    await assertCanEditDraft(req, repo, draft);
    if (!EDITABLE_DRAFT_STATUSES.has(draft.status || 'draft')) {
      throw v7DraftStateConflict(draft, '当前V7正式草稿状态不能提交审核');
    }
    assertV7FormalTransitionEnabled(draft);
    expectedBinding = v7FormalExpectedBinding(req.body || {});
  } else {
    await assertCanEditDraftContent(req, repo, draft);
  }
  const errors = draftRequiredErrors(draft);
  if (errors.length) throw httpError(422, '校验失败', { error: '校验失败', details: errors });
  const repositoryOptions = isV7 ? formalV7RepositoryOptions(req, expectedBinding) : expectedBinding;
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
  const isV7 = ['process-governance-v7', 'process-governance-v8'].includes(text(draft && draft.schema_version));
  let expectedBinding = {};
  if (isV7) {
    assertV7FormalTransitionEnabled(draft);
    expectedBinding = v7FormalExpectedBinding(req.body || {});
  }
  const decision = text(req.body.decision);
  if (!{ approve: true, reject: true, needs_changes: true }[decision]) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'decision', message: '审核结论无效' }] });
  const repositoryOptions = isV7 ? formalV7RepositoryOptions(req, expectedBinding) : expectedBinding;
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
  if (['process-governance-v7', 'process-governance-v8'].includes(text(draft && draft.schema_version))) {
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
