const crypto = require('node:crypto');
const { compareCreateStatements } = require('./processV7M0Baseline');
const { inspectProcessV7PreviewReview } = require('./processV7PreviewReviewMigration');

const MIGRATION_KEY = '2026-08-25-process-v7-formal-foundation';
const PROMOTION_TABLE = 'process_v7_promotions';

const PROCESS_V7_FORMAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS process_v7_promotions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  promotion_ref VARCHAR(80) NOT NULL,
  preview_case_id BIGINT NOT NULL,
  preview_revision_id BIGINT NOT NULL,
  preview_revision_no INT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  document_id BIGINT NOT NULL,
  draft_id BIGINT NOT NULL,
  promoted_by_user_id BIGINT NULL,
  promoted_by_person_id BIGINT NULL,
  promoted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_v7_promotion_ref (promotion_ref),
  UNIQUE KEY uq_process_v7_promotion_source (preview_case_id, preview_revision_id, preview_revision_no, content_hash),
  INDEX idx_process_v7_promotion_revision (preview_revision_id),
  INDEX idx_process_v7_promotion_document (document_id, promoted_at),
  INDEX idx_process_v7_promotion_draft (draft_id, promoted_at),
  CONSTRAINT fk_process_v7_promotion_case FOREIGN KEY (preview_case_id)
    REFERENCES process_v7_preview_cases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_v7_promotion_revision FOREIGN KEY (preview_revision_id)
    REFERENCES process_v7_preview_revisions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_v7_promotion_document FOREIGN KEY (document_id)
    REFERENCES process_design_documents(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_v7_promotion_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const LEGACY_COLUMNS = Object.freeze({
  process_design_documents: [
    'id', 'document_no', 'document_title', 'owning_department_id', 'current_edition',
    'current_version_id', 'status', 'created_by', 'updated_by', 'created_at', 'updated_at'
  ],
  process_design_drafts: [
    'id', 'document_id', 'document_no', 'document_title', 'planned_edition', 'base_version_id',
    'active_document_no', 'process_name', 'reason', 'basis_type', 'basis_description',
    'involves_other_departments', 'related_departments_json', 'department_id', 'proxy_department_id',
    'proxy_reason', 'l1_name', 'l1_status', 'l2_name', 'l2_status', 'l3_name', 'schema_version',
    'process_content_json', 'content_hash', 'revision_no', 'content_updated_by', 'content_updated_at',
    'status', 'created_by', 'submitted_by', 'submitted_at', 'published_by', 'published_at',
    'created_at', 'updated_at'
  ],
  process_design_versions: [
    'id', 'draft_id', 'document_id', 'document_no', 'document_title', 'edition', 'version_no',
    'department_id', 'l1_name', 'l2_name', 'l3_name', 'content_json', 'schema_version',
    'process_content_json', 'content_hash', 'source_revision_no', 'published_by', 'published_at',
    'effective_at', 'supersedes_version_id', 'status'
  ]
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value)), 'utf8').digest('hex');
}

async function query(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function columnState(pool, tableName, columnName) {
  const rows = await query(pool, `
    SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?
  `, [tableName, columnName]);
  if (!rows[0]) return { exists: false };
  return {
    exists: true,
    column_name: rows[0].COLUMN_NAME,
    column_type: String(rows[0].COLUMN_TYPE || '').toLowerCase(),
    nullable: rows[0].IS_NULLABLE === 'YES',
    default: rows[0].COLUMN_DEFAULT == null ? null : String(rows[0].COLUMN_DEFAULT),
    extra: String(rows[0].EXTRA || '').toLowerCase()
  };
}

async function indexState(pool, tableName, indexName) {
  const rows = await query(pool, `
    SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?
    ORDER BY SEQ_IN_INDEX
  `, [tableName, indexName]);
  if (!rows.length) return { exists: false };
  return {
    exists: true,
    unique: Number(rows[0].NON_UNIQUE) === 0,
    columns: rows.map(row => String(row.COLUMN_NAME))
  };
}

async function tableState(pool, tableName) {
  const rows = await query(pool, `
    SELECT COUNT(*) AS count
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
  `, [tableName]);
  if (!Number(rows[0] && rows[0].count || 0)) return { exists: false, rows: 0, schema_status: 'missing' };
  const countRows = await query(pool, `SELECT COUNT(*) AS count FROM \`${tableName}\``);
  const createRows = await query(pool, `SHOW CREATE TABLE \`${tableName}\``);
  const actual = createRows[0] && createRows[0]['Create Table'] || '';
  const expected = PROCESS_V7_FORMAL_SCHEMA_SQL.trim().replace(/;$/, '');
  const comparison = compareCreateStatements(expected, actual);
  return {
    exists: true,
    rows: Number(countRows[0] && countRows[0].count || 0),
    schema_status: comparison.matching ? 'matching' : 'drifted',
    expected_schema_digest: comparison.expected_component_digest,
    actual_schema_digest: comparison.actual_component_digest,
    schema_differences: comparison.differences
  };
}

async function inspectLegacyFormalRows(pool) {
  const tables = {};
  for (const [tableName, columns] of Object.entries(LEGACY_COLUMNS)) {
    const rows = await query(pool, `SELECT ${columns.map(column => `\`${column}\``).join(',')} FROM \`${tableName}\` ORDER BY id`);
    tables[tableName] = { row_count: rows.length, row_digest: digest(rows) };
  }
  return { tables, digest: digest(tables) };
}

function desiredColumn(state, type, nullable = true) {
  return state.exists && state.column_type === type && state.nullable === nullable;
}

function summarizeProcessV7PreviewFoundation(inspection = {}) {
  const consistencyStatus = String(inspection.consistency_status || 'not_applied');
  return {
    migration_key: inspection.migration_key || null,
    migration_recorded: Boolean(inspection.migration_recorded),
    applied: Boolean(inspection.applied) && consistencyStatus === 'applied',
    consistency_status: consistencyStatus,
    ready_for_m2: consistencyStatus === 'applied'
  };
}

async function inspectProcessV7FormalFoundation(pool, options = {}) {
  const previewFoundation = options.includePreviewFoundation === false
    ? null
    : await inspectProcessV7PreviewReview(pool, { includeFormalBaseline: false });
  const columns = {
    document_process_ref: await columnState(pool, 'process_design_documents', 'process_ref'),
    review_draft_revision_no: await columnState(pool, 'process_design_review_tasks', 'draft_revision_no'),
    review_content_hash: await columnState(pool, 'process_design_review_tasks', 'content_hash'),
    version_l1_name: await columnState(pool, 'process_design_versions', 'l1_name'),
    version_l2_name: await columnState(pool, 'process_design_versions', 'l2_name'),
    version_l3_name: await columnState(pool, 'process_design_versions', 'l3_name'),
    version_content_json: await columnState(pool, 'process_design_versions', 'content_json')
  };
  const indexes = {
    document_process_ref: await indexState(pool, 'process_design_documents', 'uq_process_design_documents_process_ref'),
    review_content_binding: await indexState(pool, 'process_design_review_tasks', 'idx_process_design_review_content')
  };
  const table = await tableState(pool, PROMOTION_TABLE);
  const migrationRows = await query(pool, 'SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  const duplicateRows = columns.document_process_ref.exists ? await query(pool, `
    SELECT process_ref, COUNT(*) AS count
    FROM process_design_documents
    WHERE process_ref IS NOT NULL
    GROUP BY process_ref HAVING COUNT(*) > 1
  `) : [];
  const result = {
    migration_key: MIGRATION_KEY,
    applied: Boolean(migrationRows[0]),
    columns,
    indexes,
    promotion_table: table,
    anti_join: {
      duplicate_non_null_process_refs: duplicateRows.map(row => ({ process_ref: row.process_ref, count: Number(row.count) }))
    },
    business_data_plan: 'no V7 business rows are created; feature flag remains disabled'
  };
  if (previewFoundation) {
    result.m1_preview_foundation = summarizeProcessV7PreviewFoundation(previewFoundation);
    result.ready_for_apply = result.m1_preview_foundation.ready_for_m2 &&
      schemaDrift(result).length === 0 &&
      result.anti_join.duplicate_non_null_process_refs.length === 0;
  }
  if (options.includeLegacyBaseline !== false) result.legacy_formal_baseline = await inspectLegacyFormalRows(pool);
  return result;
}

function schemaDrift(inspection) {
  const drift = [];
  const columns = inspection.columns;
  if (columns.document_process_ref.exists && !desiredColumn(columns.document_process_ref, 'varchar(160)', true)) drift.push('process_design_documents.process_ref');
  if (columns.review_draft_revision_no.exists && !desiredColumn(columns.review_draft_revision_no, 'int', true)) drift.push('process_design_review_tasks.draft_revision_no');
  if (columns.review_content_hash.exists && !desiredColumn(columns.review_content_hash, 'char(64)', true)) drift.push('process_design_review_tasks.content_hash');
  for (const key of ['version_l1_name', 'version_l2_name', 'version_l3_name']) {
    if (!columns[key].exists || columns[key].column_type !== 'varchar(255)') drift.push(`process_design_versions.${key.replace('version_', '')}`);
  }
  if (!columns.version_content_json.exists || columns.version_content_json.column_type !== 'json') drift.push('process_design_versions.content_json');
  const documentIndex = inspection.indexes.document_process_ref;
  if (documentIndex.exists && (!documentIndex.unique || documentIndex.columns.join(',') !== 'process_ref')) drift.push('uq_process_design_documents_process_ref');
  const reviewIndex = inspection.indexes.review_content_binding;
  if (reviewIndex.exists && (reviewIndex.unique || reviewIndex.columns.join(',') !== 'draft_id,draft_revision_no,content_hash,status')) drift.push('idx_process_design_review_content');
  if (inspection.promotion_table.exists && inspection.promotion_table.schema_status !== 'matching') drift.push(PROMOTION_TABLE);
  return drift;
}

function assertProcessV7PreviewFoundationApplied(inspection) {
  if (inspection && inspection.consistency_status === 'applied') return inspection;
  const error = new Error('M1预览核对迁移记录与表结构尚未完整一致，拒绝执行M2正式基础迁移');
  error.code = 'V7_FORMAL_M1_NOT_APPLIED';
  error.consistency_status = inspection && inspection.consistency_status || 'not_applied';
  throw error;
}

async function applyProcessV7FormalFoundation(pool) {
  const previewFoundation = await inspectProcessV7PreviewReview(pool, { includeFormalBaseline: false });
  assertProcessV7PreviewFoundationApplied(previewFoundation);
  const legacyBefore = await inspectLegacyFormalRows(pool);
  const before = await inspectProcessV7FormalFoundation(pool, {
    includeLegacyBaseline: false,
    includePreviewFoundation: false
  });
  const drift = schemaDrift(before);
  if (drift.length) {
    const error = new Error('V7正式基础结构存在非兼容漂移，拒绝继续迁移');
    error.code = 'V7_FORMAL_SCHEMA_DRIFT';
    error.manual_objects = drift;
    throw error;
  }
  if (before.anti_join.duplicate_non_null_process_refs.length) {
    const error = new Error('主档中存在重复的非空process_ref，不能增加唯一约束');
    error.code = 'V7_FORMAL_PROCESS_REF_DUPLICATE';
    error.manual_objects = before.anti_join.duplicate_non_null_process_refs;
    throw error;
  }
  if (!before.columns.document_process_ref.exists) {
    await pool.execute('ALTER TABLE process_design_documents ADD COLUMN process_ref VARCHAR(160) NULL AFTER document_no');
  }
  if (!before.indexes.document_process_ref.exists) {
    await pool.execute('ALTER TABLE process_design_documents ADD UNIQUE KEY uq_process_design_documents_process_ref (process_ref)');
  }
  for (const columnName of ['l1_name', 'l2_name', 'l3_name']) {
    const state = before.columns[`version_${columnName}`];
    if (!state.nullable) await pool.execute(`ALTER TABLE process_design_versions MODIFY COLUMN \`${columnName}\` VARCHAR(255) NULL`);
  }
  if (!before.columns.version_content_json.nullable) {
    await pool.execute('ALTER TABLE process_design_versions MODIFY COLUMN content_json JSON NULL');
  }
  if (!before.columns.review_draft_revision_no.exists) {
    await pool.execute('ALTER TABLE process_design_review_tasks ADD COLUMN draft_revision_no INT NULL AFTER draft_id');
  }
  if (!before.columns.review_content_hash.exists) {
    await pool.execute('ALTER TABLE process_design_review_tasks ADD COLUMN content_hash CHAR(64) NULL AFTER draft_revision_no');
  }
  if (!before.indexes.review_content_binding.exists) {
    await pool.execute('ALTER TABLE process_design_review_tasks ADD INDEX idx_process_design_review_content (draft_id, draft_revision_no, content_hash, status)');
  }
  if (!before.promotion_table.exists) await pool.execute(PROCESS_V7_FORMAL_SCHEMA_SQL.trim().replace(/;$/, ''));

  const after = await inspectProcessV7FormalFoundation(pool, {
    includeLegacyBaseline: false,
    includePreviewFoundation: false
  });
  const afterDrift = schemaDrift(after);
  if (
    afterDrift.length ||
    !desiredColumn(after.columns.document_process_ref, 'varchar(160)', true) ||
    !after.indexes.document_process_ref.exists ||
    !after.columns.version_content_json.nullable ||
    !after.columns.version_l1_name.nullable ||
    !after.columns.version_l2_name.nullable ||
    !after.columns.version_l3_name.nullable ||
    !after.columns.review_draft_revision_no.exists ||
    !after.columns.review_content_hash.exists ||
    !after.indexes.review_content_binding.exists ||
    after.promotion_table.schema_status !== 'matching'
  ) {
    const error = new Error('V7正式基础结构迁移后核对未通过，迁移记录未写入');
    error.code = 'V7_FORMAL_SCHEMA_VERIFY_FAILED';
    error.manual_objects = afterDrift;
    throw error;
  }
  const legacyAfter = await inspectLegacyFormalRows(pool);
  if (legacyBefore.digest !== legacyAfter.digest) {
    const error = new Error('V7正式基础迁移改变了历史正式流程字段，迁移记录未写入');
    error.code = 'V7_FORMAL_LEGACY_DATA_CHANGED';
    error.manual_objects = { before: legacyBefore.digest, after: legacyAfter.digest };
    throw error;
  }
  await pool.execute(`
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [MIGRATION_KEY]);
  return {
    ...(await inspectProcessV7FormalFoundation(pool)),
    legacy_formal_comparison: { unchanged: true, before_digest: legacyBefore.digest, after_digest: legacyAfter.digest }
  };
}

async function rollbackProcessV7FormalFoundation(pool) {
  const before = await inspectProcessV7FormalFoundation(pool, {
    includeLegacyBaseline: false,
    includePreviewFoundation: false
  });
  const promotionRows = before.promotion_table.rows;
  const v7Rows = await query(pool, `
    SELECT
      (SELECT COUNT(*) FROM process_design_documents WHERE process_ref IS NOT NULL) AS document_count,
      (SELECT COUNT(*) FROM process_design_drafts WHERE schema_version='process-governance-v7') AS draft_count,
      (SELECT COUNT(*) FROM process_design_versions WHERE schema_version='process-governance-v7') AS version_count,
      (SELECT COUNT(*) FROM process_design_review_tasks WHERE draft_revision_no IS NOT NULL OR content_hash IS NOT NULL) AS review_binding_count
  `);
  const usage = {
    promotion_count: promotionRows,
    document_count: Number(v7Rows[0] && v7Rows[0].document_count || 0),
    draft_count: Number(v7Rows[0] && v7Rows[0].draft_count || 0),
    version_count: Number(v7Rows[0] && v7Rows[0].version_count || 0),
    review_binding_count: Number(v7Rows[0] && v7Rows[0].review_binding_count || 0)
  };
  if (Object.values(usage).some(Number)) {
    const error = new Error('V7正式基础结构已有业务使用记录，拒绝自动回退');
    error.code = 'V7_FORMAL_ROLLBACK_NONEMPTY';
    error.manual_objects = usage;
    throw error;
  }
  if (before.promotion_table.exists) await pool.execute(`DROP TABLE \`${PROMOTION_TABLE}\``);
  if (before.indexes.review_content_binding.exists) await pool.execute('ALTER TABLE process_design_review_tasks DROP INDEX idx_process_design_review_content');
  if (before.columns.review_content_hash.exists) await pool.execute('ALTER TABLE process_design_review_tasks DROP COLUMN content_hash');
  if (before.columns.review_draft_revision_no.exists) await pool.execute('ALTER TABLE process_design_review_tasks DROP COLUMN draft_revision_no');
  if (before.columns.version_content_json.nullable) await pool.execute('ALTER TABLE process_design_versions MODIFY COLUMN content_json JSON NOT NULL');
  for (const columnName of ['l3_name', 'l2_name', 'l1_name']) {
    const state = before.columns[`version_${columnName}`];
    if (state.nullable) await pool.execute(`ALTER TABLE process_design_versions MODIFY COLUMN \`${columnName}\` VARCHAR(255) NOT NULL`);
  }
  if (before.indexes.document_process_ref.exists) await pool.execute('ALTER TABLE process_design_documents DROP INDEX uq_process_design_documents_process_ref');
  if (before.columns.document_process_ref.exists) await pool.execute('ALTER TABLE process_design_documents DROP COLUMN process_ref');
  await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  return { migration_key: MIGRATION_KEY, rolled_back: true, usage };
}

module.exports = {
  LEGACY_COLUMNS,
  MIGRATION_KEY,
  PROCESS_V7_FORMAL_SCHEMA_SQL,
  PROMOTION_TABLE,
  applyProcessV7FormalFoundation,
  assertProcessV7PreviewFoundationApplied,
  inspectLegacyFormalRows,
  inspectProcessV7FormalFoundation,
  rollbackProcessV7FormalFoundation,
  schemaDrift,
  summarizeProcessV7PreviewFoundation
};
