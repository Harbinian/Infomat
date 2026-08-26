const crypto = require('node:crypto');
const { compareCreateStatements } = require('./processV7M0Baseline');

const MIGRATION_KEY = '2026-08-24-process-v7-preview-review';

const TABLES = Object.freeze([
  'process_v7_preview_events',
  'process_v7_preview_review_items',
  'process_v7_preview_revisions',
  'process_v7_preview_cases'
]);

const FORMAL_PROCESS_TABLES = Object.freeze([
  'process_design_documents',
  'process_design_drafts',
  'process_design_versions'
]);

const PROCESS_V7_PREVIEW_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS process_v7_preview_cases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  case_ref VARCHAR(80) NOT NULL,
  process_ref VARCHAR(160) NOT NULL,
  process_name VARCHAR(255) NOT NULL,
  owning_department_id BIGINT NULL,
  owning_department_name VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_owner',
  active_process_ref VARCHAR(160) GENERATED ALWAYS AS (CASE WHEN status <> 'closed' THEN process_ref ELSE NULL END) STORED,
  current_revision_no INT NOT NULL DEFAULT 0,
  current_revision_id BIGINT NULL,
  current_content_hash CHAR(64) NULL,
  blocking_issues_json JSON NOT NULL,
  scope_decision VARCHAR(64) NULL,
  scope_decision_basis TEXT NULL,
  scope_decided_by_user_id BIGINT NULL,
  scope_decided_by_person_id BIGINT NULL,
  scope_decided_at TIMESTAMP NULL,
  created_by_user_id BIGINT NULL,
  created_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_v7_preview_case_ref (case_ref),
  UNIQUE KEY uq_process_v7_preview_active_process (active_process_ref),
  INDEX idx_process_v7_preview_case_process (process_ref, status),
  INDEX idx_process_v7_preview_case_owner (owning_department_id, status),
  CONSTRAINT chk_process_v7_preview_case_status CHECK (status IN ('pending_owner','under_review','needs_revision','disputed','review_complete','closed')),
  CONSTRAINT chk_process_v7_preview_scope_decision CHECK (scope_decision IS NULL OR scope_decision IN ('confirmed_no_cross_department','keep_current_owner','accept_source_owner')),
  CONSTRAINT fk_process_v7_preview_case_owner FOREIGN KEY (owning_department_id)
    REFERENCES departments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_v7_preview_revisions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT NOT NULL,
  revision_no INT NOT NULL,
  source_file_name VARCHAR(512) NOT NULL,
  source_schema_version VARCHAR(64) NOT NULL,
  source_exported_at VARCHAR(64) NULL,
  content_hash CHAR(64) NOT NULL,
  content_json MEDIUMTEXT NOT NULL,
  uploaded_by_user_id BIGINT NULL,
  uploaded_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_v7_preview_revision_no (case_id, revision_no),
  UNIQUE KEY uq_process_v7_preview_revision_hash (case_id, content_hash),
  INDEX idx_process_v7_preview_revision_case (case_id, created_at),
  CONSTRAINT fk_process_v7_preview_revision_case FOREIGN KEY (case_id)
    REFERENCES process_v7_preview_cases(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_v7_preview_review_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT NOT NULL,
  revision_id BIGINT NOT NULL,
  revision_no INT NOT NULL,
  stable_item_key CHAR(64) NOT NULL,
  behavior_ref VARCHAR(160) NOT NULL,
  behavior_name VARCHAR(255) NOT NULL,
  origin_department_id BIGINT NOT NULL,
  origin_department_name VARCHAR(255) NOT NULL,
  target_department_id BIGINT NOT NULL,
  target_department_name VARCHAR(255) NOT NULL,
  actor_role VARCHAR(255) NULL,
  actor_position VARCHAR(255) NULL,
  item_digest CHAR(64) NOT NULL,
  item_snapshot_json JSON NOT NULL,
  origin_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  origin_basis TEXT NULL,
  origin_decided_by_user_id BIGINT NULL,
  origin_decided_by_person_id BIGINT NULL,
  origin_decided_at TIMESTAMP NULL,
  counterparty_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  counterparty_basis TEXT NULL,
  counterparty_decided_by_user_id BIGINT NULL,
  counterparty_decided_by_person_id BIGINT NULL,
  counterparty_decided_at TIMESTAMP NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  carry_state VARCHAR(32) NOT NULL DEFAULT 'new',
  carried_from_item_id BIGINT NULL,
  is_current TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_v7_preview_item_revision (revision_id, stable_item_key, origin_department_id),
  INDEX idx_process_v7_preview_item_case (case_id, is_current, status),
  INDEX idx_process_v7_preview_item_origin (origin_department_id, is_current, origin_status),
  INDEX idx_process_v7_preview_item_target (target_department_id, is_current, counterparty_status),
  INDEX idx_process_v7_preview_item_carried (carried_from_item_id),
  CONSTRAINT chk_process_v7_preview_item_origin_status CHECK (origin_status IN ('pending','confirmed','needs_changes','pending_evidence','disputed')),
  CONSTRAINT chk_process_v7_preview_item_counterparty_status CHECK (counterparty_status IN ('pending','confirmed','needs_changes','pending_evidence','disputed')),
  CONSTRAINT chk_process_v7_preview_item_status CHECK (status IN ('pending','confirmed','needs_changes','pending_evidence','disputed')),
  CONSTRAINT chk_process_v7_preview_item_carry_state CHECK (carry_state IN ('new','carried_forward','reopened')),
  CONSTRAINT fk_process_v7_preview_item_case FOREIGN KEY (case_id)
    REFERENCES process_v7_preview_cases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_v7_preview_item_revision FOREIGN KEY (revision_id)
    REFERENCES process_v7_preview_revisions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_v7_preview_item_carried FOREIGN KEY (carried_from_item_id)
    REFERENCES process_v7_preview_review_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_v7_preview_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT NOT NULL,
  revision_id BIGINT NULL,
  item_id BIGINT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_user_id BIGINT NULL,
  actor_person_id BIGINT NULL,
  actor_department_id BIGINT NULL,
  actor_department_name VARCHAR(255) NULL,
  actor_role_code VARCHAR(64) NULL,
  decision VARCHAR(32) NULL,
  basis_text TEXT NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_process_v7_preview_event_case (case_id, id),
  INDEX idx_process_v7_preview_event_revision (revision_id, id),
  INDEX idx_process_v7_preview_event_item (item_id, id),
  CONSTRAINT fk_process_v7_preview_event_case FOREIGN KEY (case_id)
    REFERENCES process_v7_preview_cases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_v7_preview_event_revision FOREIGN KEY (revision_id)
    REFERENCES process_v7_preview_revisions(id) ON DELETE SET NULL,
  CONSTRAINT fk_process_v7_preview_event_item FOREIGN KEY (item_id)
    REFERENCES process_v7_preview_review_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

function splitStatements(sql) {
  return String(sql || '')
    .split(/;\s*(?:\r?\n|$)/)
    .map(statement => statement.trim())
    .filter(Boolean);
}

function canonicalCreateTable(sql) {
  return String(sql || '')
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/create\s+table\s+if\s+not\s+exists/g, 'create table')
    .replace(/\bindex\b/g, 'key')
    .replace(/current_timestamp\(\)/g, 'current_timestamp')
    .replace(/auto_increment=\d+\s*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .trim();
}

function expectedStatement(tableName) {
  return splitStatements(PROCESS_V7_PREVIEW_SCHEMA_SQL)
    .find(statement => new RegExp(`^CREATE TABLE IF NOT EXISTS ${tableName}\\b`, 'i').test(statement)) || '';
}

async function query(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function tableState(pool, tableName, options = {}) {
  const rows = await query(pool, `
    SELECT COUNT(*) AS table_count
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
  `, [tableName]);
  const exists = Number(rows[0] && rows[0].table_count || 0) > 0;
  if (!exists) return { table: tableName, exists: false, rows: 0, schema_status: 'missing' };
  const counts = await query(pool, `SELECT COUNT(*) AS row_count FROM \`${tableName}\``);
  if (options.verifySchema === false) {
    return { table: tableName, exists: true, rows: Number(counts[0] && counts[0].row_count || 0) };
  }
  const createRows = await query(pool, `SHOW CREATE TABLE \`${tableName}\``);
  const actualSql = createRows[0] && createRows[0]['Create Table'] || '';
  const expectedSql = expectedStatement(tableName);
  const comparison = compareCreateStatements(expectedSql, actualSql);
  return {
    table: tableName,
    exists: true,
    rows: Number(counts[0] && counts[0].row_count || 0),
    schema_status: comparison.matching ? 'matching' : 'drifted',
    expected_schema_digest: comparison.expected_component_digest,
    actual_schema_digest: comparison.actual_component_digest,
    schema_differences: comparison.differences
  };
}

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

async function inspectFormalProcessBaseline(pool) {
  const tables = {};
  for (const tableName of FORMAL_PROCESS_TABLES) {
    const createRows = await query(pool, `SHOW CREATE TABLE \`${tableName}\``);
    const dataRows = await query(pool, `SELECT * FROM \`${tableName}\` ORDER BY id`);
    const createSql = createRows[0] && (createRows[0]['Create Table'] || createRows[0]['Create View']) || '';
    tables[tableName] = {
      row_count: dataRows.length,
      schema_digest: digest(createSql),
      row_digest: digest(dataRows)
    };
  }
  return { tables, digest: digest(tables) };
}

function compareFormalProcessBaselines(before, after) {
  return {
    unchanged: Boolean(before && after && before.digest === after.digest),
    before_digest: before && before.digest || null,
    after_digest: after && after.digest || null
  };
}

function migrationConsistencyStatus(tables, migrationRecorded) {
  const states = Array.isArray(tables) ? tables : [];
  const existing = states.filter(item => item && item.exists);
  if (existing.some(item => item.schema_status && item.schema_status !== 'matching')) return 'schema_drift';
  if (existing.length === 0) return migrationRecorded ? 'record_without_structure' : 'not_applied';
  if (existing.length < TABLES.length) return migrationRecorded ? 'record_without_structure' : 'partial_structure';
  return migrationRecorded ? 'applied' : 'structure_without_record';
}

async function inspectProcessV7PreviewReview(pool, options = {}) {
  const tables = [];
  for (const tableName of TABLES) tables.push(await tableState(pool, tableName, options));
  const migrationRows = await query(pool, 'SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  const migrationRecorded = Boolean(migrationRows[0]);
  const consistencyStatus = migrationConsistencyStatus(tables, migrationRecorded);
  const result = {
    migration_key: MIGRATION_KEY,
    migration_recorded: migrationRecorded,
    applied: consistencyStatus === 'applied',
    consistency_status: consistencyStatus,
    tables,
    formal_tables_plan: 'read-only baseline; preview migration does not target formal process tables'
  };
  if (options.includeFormalBaseline !== false) {
    result.formal_process_baseline = await inspectFormalProcessBaseline(pool);
  }
  return result;
}

async function applyProcessV7PreviewReview(pool) {
  const formalBefore = await inspectFormalProcessBaseline(pool);
  const previewBefore = await inspectProcessV7PreviewReview(pool, { includeFormalBaseline: false });
  if (previewBefore.consistency_status === 'applied') {
    return {
      ...(await inspectProcessV7PreviewReview(pool)),
      formal_process_comparison: compareFormalProcessBaselines(formalBefore, formalBefore)
    };
  }
  if (previewBefore.consistency_status !== 'not_applied') {
    const error = new Error('V7预览迁移记录与表结构不一致，拒绝自动修复');
    error.code = 'V7_PREVIEW_MIGRATION_INCONSISTENT';
    error.consistency_status = previewBefore.consistency_status;
    error.manual_objects = previewBefore.tables;
    throw error;
  }
  for (const statement of splitStatements(PROCESS_V7_PREVIEW_SCHEMA_SQL)) {
    await pool.execute(statement);
  }
  const previewAfter = await inspectProcessV7PreviewReview(pool, { includeFormalBaseline: false });
  const invalidSchemas = previewAfter.tables.filter(item => item.schema_status !== 'matching');
  if (invalidSchemas.length) {
    const error = new Error('V7预览表创建后结构核对未通过，迁移记录未写入');
    error.code = 'V7_PREVIEW_SCHEMA_VERIFY_FAILED';
    error.manual_objects = invalidSchemas;
    throw error;
  }
  const formalAfter = await inspectFormalProcessBaseline(pool);
  const formalComparison = compareFormalProcessBaselines(formalBefore, formalAfter);
  if (!formalComparison.unchanged) {
    const error = new Error('V7预览迁移期间正式流程表发生变化，迁移记录未写入');
    error.code = 'V7_PREVIEW_FORMAL_BASELINE_CHANGED';
    error.manual_objects = formalComparison;
    throw error;
  }
  await pool.execute(`
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [MIGRATION_KEY]);
  return { ...(await inspectProcessV7PreviewReview(pool)), formal_process_comparison: formalComparison };
}

async function rollbackProcessV7PreviewReview(pool) {
  const before = await inspectProcessV7PreviewReview(pool, { includeFormalBaseline: false, verifySchema: false });
  const nonEmpty = before.tables.filter(item => item.rows > 0);
  if (nonEmpty.length) {
    const error = new Error('V7预览核对表已有业务记录，拒绝自动删除');
    error.code = 'V7_PREVIEW_ROLLBACK_NONEMPTY';
    error.manual_objects = nonEmpty;
    throw error;
  }
  for (const tableName of TABLES) await pool.execute(`DROP TABLE IF EXISTS \`${tableName}\``);
  await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  return { migration_key: MIGRATION_KEY, rolled_back: true, tables: TABLES };
}

module.exports = {
  MIGRATION_KEY,
  FORMAL_PROCESS_TABLES,
  PROCESS_V7_PREVIEW_SCHEMA_SQL,
  TABLES,
  applyProcessV7PreviewReview,
  canonicalCreateTable,
  compareFormalProcessBaselines,
  inspectFormalProcessBaseline,
  inspectProcessV7PreviewReview,
  migrationConsistencyStatus,
  rollbackProcessV7PreviewReview
};
