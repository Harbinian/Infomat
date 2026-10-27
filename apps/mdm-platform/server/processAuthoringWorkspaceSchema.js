// Additive schema only. Runtime routes inspect it; they never execute DDL.
const { splitSqlStatements } = require('./mysqlSchema');
const MIGRATION_KEY = '2026-10-21-process-authoring-workspace-v1';
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS process_authoring_drafts (
  draft_id CHAR(36) PRIMARY KEY,
  owning_department_id BIGINT NOT NULL,
  created_by_person_id BIGINT NOT NULL,
  updated_by_person_id BIGINT NOT NULL,
  case_id BIGINT NULL,
  source_case_revision_no INT NULL,
  source_case_content_hash CHAR(64) NULL,
  revision_no INT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  document_json JSON NOT NULL,
  submission_json JSON NULL,
  last_submitted_revision_no INT NULL,
  last_submission_case_id BIGINT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_process_authoring_department (owning_department_id,updated_at,draft_id),
  KEY idx_process_authoring_case (case_id,draft_id),
  CHECK (revision_no > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_authoring_revisions (
  draft_id CHAR(36) NOT NULL,
  revision_no INT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  document_json JSON NOT NULL,
  submission_json JSON NULL,
  actor_person_id BIGINT NOT NULL,
  operation VARCHAR(16) NOT NULL,
  case_id BIGINT NULL,
  case_revision_no INT NULL,
  case_content_hash CHAR(64) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (draft_id,revision_no),
  CONSTRAINT fk_process_authoring_revision FOREIGN KEY (draft_id) REFERENCES process_authoring_drafts(draft_id),
  CHECK (operation IN ('create','save','submit'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_authoring_requests (
  request_id CHAR(36) PRIMARY KEY,
  actor_person_id BIGINT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;

async function inspectSchema(db) {
  const missing = [], drift = [];
  for (const statement of splitSqlStatements(SCHEMA_SQL)) {
    const table = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const [present] = await db.execute('SELECT TABLE_NAME,TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!present.length) { missing.push(table); continue; }
    const [[ddl]] = await db.query(`SHOW CREATE TABLE ${table}`);
    const actual = ddl['Create Table'];
    const comparison = require('./processV7M0Baseline').compareCreateStatements(statement, actual);
    if (!comparison.matching || !/ENGINE=InnoDB/i.test(actual) || /NOT ENFORCED/i.test(actual) || present[0].TABLE_COLLATION !== 'utf8mb4_unicode_ci') {
      drift.push({ table, differences: comparison.differences });
    }
  }
  const [markers] = await db.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'");
  let applied = false;
  if (markers.length) applied = (await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]))[0].length === 1;
  else missing.push('schema_migrations');
  return { ready: missing.length === 0 && drift.length === 0 && applied, missing, drift, migration_applied: applied };
}

async function applyMigration(db, permit) {
  await require('./governanceMigrationAuthorization').verifyMigrationPermit(db, permit, { write: true });
  const before = await inspectSchema(db);
  if (before.drift.length || before.missing.includes('schema_migrations')) throw Object.assign(new Error('PROCESS_AUTHORING_SCHEMA_DRIFT'), { code: 'PROCESS_AUTHORING_SCHEMA_DRIFT' });
  for (const sql of splitSqlStatements(SCHEMA_SQL)) {
    if (before.missing.includes(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1])) await db.query(sql);
  }
  await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)', [MIGRATION_KEY]);
  const after = await inspectSchema(db);
  if (!after.ready) throw Object.assign(new Error('PROCESS_AUTHORING_SCHEMA_DRIFT'), { code: 'PROCESS_AUTHORING_SCHEMA_DRIFT' });
  return after;
}
module.exports = { MIGRATION_KEY, SCHEMA_SQL, inspectSchema, applyMigration };
