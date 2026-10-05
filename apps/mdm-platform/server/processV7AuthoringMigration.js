// Explicit additive maintenance only. Existing cases, roles and source JSON are never backfilled.
const { compareCreateStatements } = require('./processV7M0Baseline');
const MIGRATION_KEY = '2026-09-30-process-v7-authoring-v1';
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS process_v7_authoring (
  case_id BIGINT PRIMARY KEY,
  compiler_person_id BIGINT NULL,
  assignment_version INT NOT NULL DEFAULT 1,
  started_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_v7_authoring_compiler (compiler_person_id, case_id),
  CONSTRAINT chk_v7_authoring_version CHECK (assignment_version > 0),
  CONSTRAINT fk_v7_authoring_case FOREIGN KEY (case_id) REFERENCES process_v7_preview_cases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_v7_authoring_person FOREIGN KEY (compiler_person_id) REFERENCES person(person_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_v7_authoring_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT NOT NULL,
  request_key VARCHAR(80) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  record_kind VARCHAR(32) NOT NULL,
  content_text TEXT NOT NULL,
  actor_person_id BIGINT NOT NULL,
  recipient_person_id BIGINT NULL,
  revision_no INT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  assignment_version INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_v7_authoring_request (case_id, request_key),
  INDEX idx_v7_authoring_record_case (case_id, id),
  INDEX fk_v7_authoring_record_actor (actor_person_id),
  INDEX fk_v7_authoring_record_recipient (recipient_person_id),
  CONSTRAINT chk_v7_authoring_kind CHECK (record_kind IN ('transfer','message','supplement_request','reminder','fact_note','problem_reply','governance_suggestion')),
  CONSTRAINT fk_v7_authoring_record_case FOREIGN KEY (case_id) REFERENCES process_v7_preview_cases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_v7_authoring_record_actor FOREIGN KEY (actor_person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
  CONSTRAINT fk_v7_authoring_record_recipient FOREIGN KEY (recipient_person_id) REFERENCES person(person_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;
const statements = () => SCHEMA_SQL.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean);
function failure(code, statusCode = 409) { return Object.assign(new Error(code), { code, statusCode }); }
async function inspectAuthoring(db) {
  const missing = [], drift = [];
  for (const table of ['process_v7_preview_cases', 'person', 'user_accounts', 'person_roles', 'schema_migrations']) {
    const [found] = await db.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!found.length) drift.push({ dependency: table, reason: 'missing' });
  }
  for (const sql of statements()) {
    const table = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const [found] = await db.execute('SELECT TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!found.length) { missing.push(table); continue; }
    const [[ddl]] = await db.query('SHOW CREATE TABLE ' + table);
    const comparison = compareCreateStatements(sql, ddl['Create Table']);
    if (!comparison.matching || !/ENGINE=InnoDB/i.test(ddl['Create Table']) || /NOT ENFORCED/i.test(ddl['Create Table']) || found[0].TABLE_COLLATION !== 'utf8mb4_unicode_ci') drift.push({ table, differences: comparison.differences });
  }
  const [markers] = drift.some(d => d.dependency === 'schema_migrations') ? [[]] : await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  if (markers.length && missing.length) drift.push({ reason: 'record_without_structure' });
  return { ready: !missing.length && !drift.length && !!markers.length, missing, drift, backfill: [] };
}
async function applyAuthoring(db) {
  const [[lock]] = await db.execute("SELECT GET_LOCK('mdm_v7_authoring_migration_v1',10) acquired");
  if (Number(lock.acquired) !== 1) throw failure('V7_AUTHORING_MIGRATION_BUSY');
  try {
    const before = await inspectAuthoring(db);
    if (before.drift.length) throw Object.assign(failure('V7_AUTHORING_SCHEMA_DRIFT'), { inspection: before });
    for (const sql of statements()) if (before.missing.includes(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1])) await db.execute(sql);
    const after = await inspectAuthoring(db);
    if (after.missing.length || after.drift.length) throw Object.assign(failure('V7_AUTHORING_SCHEMA_DRIFT'), { inspection: after });
    await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)', [MIGRATION_KEY]);
    return inspectAuthoring(db);
  } finally { await db.execute("SELECT RELEASE_LOCK('mdm_v7_authoring_migration_v1')"); }
}
module.exports = { SCHEMA_SQL, MIGRATION_KEY, inspectAuthoring, applyAuthoring, failure };
