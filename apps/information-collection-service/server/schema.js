'use strict';

const REQUIRED_IDENTITY_COLUMNS = {
  departments: ['id', 'name', 'code', 'status'],
  person: ['person_id', 'employee_no', 'person_name', 'current_department_id', 'status', 'employment_status'],
  user_accounts: ['account_id', 'person_id', 'login_name', 'password_hash', 'account_status', 'auth_version']
};

const MIGRATION_KEY = 'information-collection-v1-2026-08-10';

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS collection_schema_migrations (
    migration_key VARCHAR(160) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_app_grants (
    grant_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    person_id BIGINT NOT NULL,
    role_code VARCHAR(64) NOT NULL,
    scope_type VARCHAR(32) NOT NULL,
    scope_department_id BIGINT NULL,
    scope_key VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    granted_by_person_id BIGINT NULL,
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_by_person_id BIGINT NULL,
    revoked_at TIMESTAMP NULL,
    UNIQUE KEY uq_collection_grant_scope (person_id, role_code, scope_key),
    INDEX idx_collection_grants_active (person_id, status),
    CONSTRAINT fk_collection_grant_person FOREIGN KEY (person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_grant_department FOREIGN KEY (scope_department_id) REFERENCES departments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_grant_granted_by FOREIGN KEY (granted_by_person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_grant_revoked_by FOREIGN KEY (revoked_by_person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
    CHECK (role_code IN ('collection_admin','collection_designer')),
    CHECK (scope_type IN ('global','department')),
    CHECK (status IN ('active','revoked'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    surface VARCHAR(32) NOT NULL,
    person_id BIGINT NOT NULL,
    account_id BIGINT NOT NULL,
    auth_version BIGINT NOT NULL,
    csrf_token_hash CHAR(64) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NULL,
    INDEX idx_collection_sessions_person (person_id, surface, expires_at),
    CONSTRAINT fk_collection_session_person FOREIGN KEY (person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_session_account FOREIGN KEY (account_id) REFERENCES user_accounts(account_id) ON DELETE RESTRICT,
    CHECK (surface IN ('admin','respondent'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_forms (
    form_id CHAR(36) PRIMARY KEY,
    form_code VARCHAR(64) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NULL,
    owner_department_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    draft_schema JSON NOT NULL,
    draft_revision BIGINT NOT NULL DEFAULT 1,
    created_by_person_id BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by_person_id BIGINT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_collection_form_code (form_code),
    INDEX idx_collection_forms_owner (owner_department_id, status, updated_at),
    CONSTRAINT fk_collection_form_department FOREIGN KEY (owner_department_id) REFERENCES departments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_form_created_by FOREIGN KEY (created_by_person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_form_updated_by FOREIGN KEY (updated_by_person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
    CHECK (status IN ('draft','active','archived'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_form_versions (
    form_version_id CHAR(36) PRIMARY KEY,
    form_id CHAR(36) NOT NULL,
    version_no INT NOT NULL,
    schema_json JSON NOT NULL,
    schema_digest CHAR(64) NOT NULL,
    created_by_person_id BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_collection_form_version (form_id, version_no),
    INDEX idx_collection_version_digest (form_id, schema_digest),
    CONSTRAINT fk_collection_version_form FOREIGN KEY (form_id) REFERENCES collection_forms(form_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_version_created_by FOREIGN KEY (created_by_person_id) REFERENCES person(person_id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_tasks (
    task_id CHAR(36) PRIMARY KEY,
    task_code VARCHAR(64) NOT NULL,
    form_id CHAR(36) NOT NULL,
    form_version_id CHAR(36) NOT NULL,
    name VARCHAR(150) NOT NULL,
    owner_department_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    open_at DATETIME NOT NULL,
    due_at DATETIME NULL,
    audience_definition JSON NOT NULL,
    client_request_id CHAR(36) NOT NULL,
    created_by_person_id BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    closed_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    UNIQUE KEY uq_collection_task_code (task_code),
    UNIQUE KEY uq_collection_task_request (created_by_person_id, client_request_id),
    INDEX idx_collection_tasks_owner (owner_department_id, status, open_at),
    INDEX idx_collection_tasks_due (status, due_at),
    CONSTRAINT fk_collection_task_form FOREIGN KEY (form_id) REFERENCES collection_forms(form_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_task_version FOREIGN KEY (form_version_id) REFERENCES collection_form_versions(form_version_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_task_department FOREIGN KEY (owner_department_id) REFERENCES departments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_task_created_by FOREIGN KEY (created_by_person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
    CHECK (status IN ('scheduled','open','closed','cancelled'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_task_targets (
    target_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id CHAR(36) NOT NULL,
    person_id BIGINT NOT NULL,
    employee_no_snapshot VARCHAR(128) NOT NULL,
    person_name_snapshot VARCHAR(255) NOT NULL,
    department_id_snapshot BIGINT NULL,
    department_name_snapshot VARCHAR(255) NULL,
    target_source VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_collection_task_target (task_id, person_id),
    INDEX idx_collection_target_person (person_id, task_id),
    INDEX idx_collection_target_department (task_id, department_id_snapshot),
    CONSTRAINT fk_collection_target_task FOREIGN KEY (task_id) REFERENCES collection_tasks(task_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_target_person FOREIGN KEY (person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_target_department FOREIGN KEY (department_id_snapshot) REFERENCES departments(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_submissions (
    submission_id CHAR(36) PRIMARY KEY,
    task_id CHAR(36) NOT NULL,
    person_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    answers_json JSON NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_saved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMP NULL,
    submit_count INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_collection_submission_person (task_id, person_id),
    INDEX idx_collection_submission_status (task_id, status, submitted_at),
    CONSTRAINT fk_collection_submission_task FOREIGN KEY (task_id) REFERENCES collection_tasks(task_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_submission_person FOREIGN KEY (person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
    CHECK (status IN ('draft','submitted'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_submission_versions (
    submission_version_id CHAR(36) PRIMARY KEY,
    submission_id CHAR(36) NOT NULL,
    submit_no INT NOT NULL,
    answers_json JSON NOT NULL,
    submitted_by_person_id BIGINT NOT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_collection_submission_version (submission_id, submit_no),
    CONSTRAINT fk_collection_submission_version_submission FOREIGN KEY (submission_id) REFERENCES collection_submissions(submission_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_submission_version_person FOREIGN KEY (submitted_by_person_id) REFERENCES person(person_id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_files (
    file_id CHAR(36) PRIMARY KEY,
    submission_id CHAR(36) NOT NULL,
    field_key CHAR(36) NOT NULL,
    storage_key VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    extension VARCHAR(16) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 CHAR(64) NOT NULL,
    scan_status VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    uploaded_by_person_id BIGINT NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    removed_at TIMESTAMP NULL,
    UNIQUE KEY uq_collection_file_storage (storage_key),
    INDEX idx_collection_files_submission (submission_id, field_key, status),
    CONSTRAINT fk_collection_file_submission FOREIGN KEY (submission_id) REFERENCES collection_submissions(submission_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_file_person FOREIGN KEY (uploaded_by_person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
    CHECK (scan_status IN ('clean','unscanned_dev','failed')),
    CHECK (status IN ('active','removed'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_audit_events (
    event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_person_id BIGINT NULL,
    action_code VARCHAR(96) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(128) NULL,
    owner_department_id BIGINT NULL,
    request_id CHAR(36) NOT NULL,
    ip_address VARCHAR(128) NULL,
    detail_json JSON NULL,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_collection_audit_entity (entity_type, entity_id, occurred_at),
    INDEX idx_collection_audit_actor (actor_person_id, occurred_at),
    CONSTRAINT fk_collection_audit_person FOREIGN KEY (actor_person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
    CONSTRAINT fk_collection_audit_department FOREIGN KEY (owner_department_id) REFERENCES departments(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

async function inspectIdentitySchema(pool) {
  const tables = Object.keys(REQUIRED_IDENTITY_COLUMNS);
  const placeholders = tables.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name IN (${placeholders})`,
    tables
  );
  const found = new Map();
  for (const row of rows) {
    const tableName = row.TABLE_NAME || row.table_name;
    const columnName = row.COLUMN_NAME || row.column_name;
    if (!found.has(tableName)) found.set(tableName, new Set());
    found.get(tableName).add(columnName);
  }
  const missing = [];
  for (const [table, columns] of Object.entries(REQUIRED_IDENTITY_COLUMNS)) {
    for (const column of columns) {
      if (!found.get(table)?.has(column)) missing.push(`${table}.${column}`);
    }
  }
  return { ok: missing.length === 0, missing };
}

async function listCollectionTables(pool) {
  const [rows] = await pool.execute(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema=DATABASE() AND table_name LIKE 'collection\\_%' ESCAPE '\\\\'
      ORDER BY table_name`
  );
  return rows.map(row => row.TABLE_NAME || row.table_name);
}

function expectedCollectionTables() {
  return CREATE_STATEMENTS.map(statement => statement.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i)[1]);
}

async function inspectCollectionBoundary(pool) {
  const tables = await listCollectionTables(pool);
  const expected = expectedCollectionTables();
  const unexpectedTables = tables.filter(table => !expected.includes(table));
  const ownedOrEmpty = tables.length === 0 || tables.includes('collection_schema_migrations');
  return { tables, unexpectedTables, safeToApply: ownedOrEmpty && unexpectedTables.length === 0 };
}

async function applySchema(pool) {
  const identity = await inspectIdentitySchema(pool);
  if (!identity.ok) throw new Error(`Identity schema is incompatible: ${identity.missing.join(', ')}`);
  const boundary = await inspectCollectionBoundary(pool);
  if (!boundary.safeToApply) {
    throw new Error(`Existing collection tables are not owned by this migration: ${boundary.tables.join(', ')}`);
  }
  for (const statement of CREATE_STATEMENTS) await pool.execute(statement);
  await pool.execute(
    `INSERT INTO collection_schema_migrations (migration_key)
     VALUES (?) ON DUPLICATE KEY UPDATE migration_key=VALUES(migration_key)`,
    [MIGRATION_KEY]
  );
}

async function checkSchema(pool) {
  const identity = await inspectIdentitySchema(pool);
  const tables = await listCollectionTables(pool);
  const [migrationRows] = tables.includes('collection_schema_migrations')
    ? await pool.execute('SELECT migration_key, applied_at FROM collection_schema_migrations ORDER BY applied_at')
    : [[]];
  const expected = expectedCollectionTables();
  return {
    identity,
    tables,
    missingTables: expected.filter(table => !tables.includes(table)),
    unexpectedTables: tables.filter(table => !expected.includes(table)),
    migrationApplied: migrationRows.some(row => row.migration_key === MIGRATION_KEY),
    migrationKey: MIGRATION_KEY
  };
}

module.exports = {
  CREATE_STATEMENTS,
  MIGRATION_KEY,
  REQUIRED_IDENTITY_COLUMNS,
  applySchema,
  checkSchema,
  inspectIdentitySchema,
  inspectCollectionBoundary,
  listCollectionTables
};
