const { compareCreateStatements } = require('./processV7M0Baseline');

const MIGRATION_KEY = '2026-08-27-process-data-governance-v1';
const TABLES = Object.freeze([
  'process_data_governance_events',
  'process_data_governance_reviews',
  'process_data_governance_fact_requests',
  'process_data_governance_details',
  'process_data_governance_work_packages',
  'process_data_governance_creation_tasks'
]);

const PROCESS_DATA_GOVERNANCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS process_data_governance_creation_tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_ref VARCHAR(96) NOT NULL,
  process_version_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  attempt_count INT NOT NULL DEFAULT 0,
  last_error_code VARCHAR(96) NULL,
  last_error_message TEXT NULL,
  requested_by_person_id BIGINT NULL,
  completed_work_package_id BIGINT NULL,
  next_retry_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  UNIQUE KEY uq_process_data_governance_task_ref (task_ref),
  UNIQUE KEY uq_process_data_governance_task_version (process_version_id),
  INDEX idx_process_data_governance_task_status (status, next_retry_at),
  CONSTRAINT chk_process_data_governance_task_status CHECK (status IN ('queued','creating','failed','completed','cancelled')),
  CONSTRAINT fk_process_data_governance_task_version FOREIGN KEY (process_version_id)
    REFERENCES process_design_versions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_data_governance_work_packages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  package_ref VARCHAR(96) NOT NULL,
  process_version_id BIGINT NOT NULL,
  source_document_id BIGINT NULL,
  owning_department_id BIGINT NULL,
  source_content_hash CHAR(64) NOT NULL,
  rule_version VARCHAR(96) NOT NULL,
  risk_level VARCHAR(16) NOT NULL DEFAULT 'normal',
  risk_basis_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'mdm_preparing',
  revision_no INT NOT NULL DEFAULT 1,
  due_at TIMESTAMP NULL,
  created_by_person_id BIGINT NULL,
  updated_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  UNIQUE KEY uq_process_data_governance_package_ref (package_ref),
  UNIQUE KEY uq_process_data_governance_package_version (process_version_id),
  INDEX idx_process_data_governance_package_status (status, due_at),
  INDEX idx_process_data_governance_package_department (owning_department_id, status),
  CONSTRAINT chk_process_data_governance_package_risk CHECK (risk_level IN ('normal','high')),
  CONSTRAINT chk_process_data_governance_package_status CHECK (status IN ('mdm_preparing','mdm_governing','waiting_business_fact','mdm_review','completed','source_withdrawn')),
  CONSTRAINT fk_process_data_governance_package_version FOREIGN KEY (process_version_id)
    REFERENCES process_design_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_data_governance_package_document FOREIGN KEY (source_document_id)
    REFERENCES process_design_documents(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_data_governance_package_department FOREIGN KEY (owning_department_id)
    REFERENCES departments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_data_governance_details (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  work_package_id BIGINT NOT NULL,
  detail_ref VARCHAR(320) NOT NULL,
  detail_type VARCHAR(48) NOT NULL,
  source_ref VARCHAR(160) NOT NULL,
  parent_source_ref VARCHAR(160) NULL,
  responsible_department_id BIGINT NULL,
  source_snapshot_digest CHAR(64) NOT NULL,
  candidate_rule_code VARCHAR(96) NOT NULL,
  candidate_json JSON NOT NULL,
  governance_json JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  high_risk TINYINT NOT NULL DEFAULT 0,
  revision_no INT NOT NULL DEFAULT 1,
  created_by_person_id BIGINT NULL,
  updated_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_data_governance_detail_ref (work_package_id, detail_ref),
  INDEX idx_process_data_governance_detail_status (work_package_id, status, detail_type),
  INDEX idx_process_data_governance_detail_department (responsible_department_id, status),
  CONSTRAINT chk_process_data_governance_detail_type CHECK (detail_type IN ('data_object_identity','critical_field','data_flow','lifecycle_rule')),
  CONSTRAINT chk_process_data_governance_detail_status CHECK (status IN ('pending','needs_business_fact','confirmed','not_applicable','terminated')),
  CONSTRAINT fk_process_data_governance_detail_package FOREIGN KEY (work_package_id)
    REFERENCES process_data_governance_work_packages(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_data_governance_detail_department FOREIGN KEY (responsible_department_id)
    REFERENCES departments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_data_governance_fact_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_ref VARCHAR(96) NOT NULL,
  work_package_id BIGINT NOT NULL,
  detail_id BIGINT NOT NULL,
  target_department_id BIGINT NOT NULL,
  requested_fact_type VARCHAR(64) NOT NULL,
  question_text TEXT NOT NULL,
  request_reason TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  answer_text TEXT NULL,
  evidence_ref TEXT NULL,
  requested_by_person_id BIGINT NULL,
  answered_by_person_id BIGINT NULL,
  closed_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at TIMESTAMP NULL,
  closed_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_data_governance_fact_ref (request_ref),
  INDEX idx_process_data_governance_fact_package (work_package_id, status),
  INDEX idx_process_data_governance_fact_department (target_department_id, status),
  CONSTRAINT chk_process_data_governance_fact_status CHECK (status IN ('open','answered','closed','cancelled')),
  CONSTRAINT fk_process_data_governance_fact_package FOREIGN KEY (work_package_id)
    REFERENCES process_data_governance_work_packages(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_data_governance_fact_detail FOREIGN KEY (detail_id)
    REFERENCES process_data_governance_details(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_data_governance_fact_department FOREIGN KEY (target_department_id)
    REFERENCES departments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_data_governance_reviews (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  work_package_id BIGINT NOT NULL,
  review_type VARCHAR(32) NOT NULL,
  scope_department_id BIGINT NULL,
  decision VARCHAR(24) NOT NULL,
  basis_text TEXT NOT NULL,
  package_revision_no INT NOT NULL,
  actor_person_id BIGINT NULL,
  actor_role_code VARCHAR(64) NOT NULL,
  replaces_review_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_process_data_governance_review_package (work_package_id, id),
  INDEX idx_process_data_governance_review_scope (scope_department_id, review_type),
  CONSTRAINT chk_process_data_governance_review_type CHECK (review_type IN ('mdm_workgroup','data_quality','decision_group')),
  CONSTRAINT chk_process_data_governance_review_decision CHECK (decision IN ('approved','needs_changes','rejected','noted')),
  CONSTRAINT fk_process_data_governance_review_package FOREIGN KEY (work_package_id)
    REFERENCES process_data_governance_work_packages(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_data_governance_review_department FOREIGN KEY (scope_department_id)
    REFERENCES departments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_data_governance_review_replaces FOREIGN KEY (replaces_review_id)
    REFERENCES process_data_governance_reviews(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_data_governance_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  work_package_id BIGINT NOT NULL,
  detail_id BIGINT NULL,
  fact_request_id BIGINT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_person_id BIGINT NULL,
  actor_department_id BIGINT NULL,
  actor_role_code VARCHAR(64) NULL,
  basis_text TEXT NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_process_data_governance_event_package (work_package_id, id),
  INDEX idx_process_data_governance_event_detail (detail_id, id),
  INDEX idx_process_data_governance_event_fact (fact_request_id, id),
  CONSTRAINT fk_process_data_governance_event_package FOREIGN KEY (work_package_id)
    REFERENCES process_data_governance_work_packages(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_data_governance_event_detail FOREIGN KEY (detail_id)
    REFERENCES process_data_governance_details(id) ON DELETE SET NULL,
  CONSTRAINT fk_process_data_governance_event_fact FOREIGN KEY (fact_request_id)
    REFERENCES process_data_governance_fact_requests(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

function splitStatements(sql) {
  return String(sql || '').split(/;\s*(?:\r?\n|$)/).map(item => item.trim()).filter(Boolean);
}

function expectedStatement(tableName) {
  return splitStatements(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL)
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
  if (options.verifySchema === false) return { table: tableName, exists: true, rows: Number(counts[0] && counts[0].row_count || 0) };
  const createRows = await query(pool, `SHOW CREATE TABLE \`${tableName}\``);
  const actualSql = createRows[0] && createRows[0]['Create Table'] || '';
  const comparison = compareCreateStatements(expectedStatement(tableName), actualSql);
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

function migrationConsistencyStatus(tables, migrationRecorded) {
  const existing = (tables || []).filter(item => item && item.exists);
  if (existing.some(item => item.schema_status && item.schema_status !== 'matching')) return 'schema_drift';
  if (!existing.length) return migrationRecorded ? 'record_without_structure' : 'not_applied';
  if (existing.length < TABLES.length) return migrationRecorded ? 'record_without_structure' : 'partial_structure';
  return migrationRecorded ? 'applied' : 'structure_without_record';
}

async function inspectProcessDataGovernance(pool, options = {}) {
  const tables = [];
  for (const tableName of TABLES) tables.push(await tableState(pool, tableName, options));
  const migrationRows = await query(pool, 'SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  const migrationRecorded = Boolean(migrationRows[0]);
  const consistencyStatus = migrationConsistencyStatus(tables, migrationRecorded);
  const [versionRows, packageRows] = await Promise.all([
    query(pool, "SELECT COUNT(*) AS count FROM process_design_versions WHERE status='published'"),
    tables.find(item => item.table === 'process_data_governance_work_packages' && item.exists)
      ? query(pool, 'SELECT COUNT(*) AS count FROM process_data_governance_work_packages')
      : Promise.resolve([{ count: 0 }])
  ]);
  return {
    migration_key: MIGRATION_KEY,
    migration_recorded: migrationRecorded,
    applied: consistencyStatus === 'applied',
    consistency_status: consistencyStatus,
    tables,
    current_published_process_versions: Number(versionRows[0] && versionRows[0].count || 0),
    current_work_packages: Number(packageRows[0] && packageRows[0].count || 0),
    backfill_plan: 'none during schema migration; exact process_version_id requires a separate mdm_lead reconcile action',
    source_file_plan: 'never read or modify original 3001 files'
  };
}

async function applyProcessDataGovernance(pool) {
  const before = await inspectProcessDataGovernance(pool, { verifySchema: true });
  if (before.consistency_status === 'applied') return before;
  if (before.consistency_status !== 'not_applied') {
    const error = new Error('数据生命周期治理迁移记录与表结构不一致，拒绝自动修复');
    error.code = 'PROCESS_DATA_GOVERNANCE_MIGRATION_INCONSISTENT';
    error.consistency_status = before.consistency_status;
    error.manual_objects = before.tables;
    throw error;
  }
  for (const statement of splitStatements(PROCESS_DATA_GOVERNANCE_SCHEMA_SQL)) await pool.execute(statement);
  const afterTables = [];
  for (const tableName of TABLES) afterTables.push(await tableState(pool, tableName));
  const invalid = afterTables.filter(item => item.schema_status !== 'matching');
  if (invalid.length) {
    const error = new Error('数据生命周期治理表创建后结构核对未通过，迁移记录未写入');
    error.code = 'PROCESS_DATA_GOVERNANCE_SCHEMA_VERIFY_FAILED';
    error.manual_objects = invalid;
    throw error;
  }
  await pool.execute(`
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [MIGRATION_KEY]);
  return await inspectProcessDataGovernance(pool);
}

async function rollbackProcessDataGovernance(pool) {
  const before = await inspectProcessDataGovernance(pool, { verifySchema: false });
  const nonEmpty = before.tables.filter(item => item.rows > 0);
  if (nonEmpty.length) {
    const error = new Error('数据生命周期治理表已有治理记录，拒绝自动删除');
    error.code = 'PROCESS_DATA_GOVERNANCE_ROLLBACK_NONEMPTY';
    error.manual_objects = nonEmpty;
    throw error;
  }
  for (const tableName of TABLES) await pool.execute(`DROP TABLE IF EXISTS \`${tableName}\``);
  await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  return { migration_key: MIGRATION_KEY, rolled_back: true, tables: TABLES };
}

module.exports = {
  MIGRATION_KEY,
  PROCESS_DATA_GOVERNANCE_SCHEMA_SQL,
  TABLES,
  applyProcessDataGovernance,
  inspectProcessDataGovernance,
  migrationConsistencyStatus,
  rollbackProcessDataGovernance,
  splitStatements
};
