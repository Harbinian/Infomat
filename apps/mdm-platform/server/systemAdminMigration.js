// Explicit additive maintenance for a person-independent system administrator.
const { compareCreateStatements } = require('./processV7M0Baseline');
const MIGRATION_KEY = '2026-09-30-system-admin-v1';
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS system_admin_accounts (
  account_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  login_name VARCHAR(128) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT NOT NULL DEFAULT 1,
  account_status VARCHAR(32) NOT NULL DEFAULT 'active',
  auth_version BIGINT NOT NULL DEFAULT 1,
  authorization_basis TEXT NOT NULL,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_system_admin_login (login_name),
  CONSTRAINT chk_system_admin_login CHECK (login_name = 'admin'),
  CONSTRAINT chk_system_admin_status CHECK (account_status IN ('active','disabled','locked')),
  CONSTRAINT chk_system_admin_version CHECK (auth_version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS system_admin_events (
  event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_account_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  identity_event_id BIGINT NULL,
  target_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_system_admin_event_actor (actor_account_id,event_id),
  UNIQUE KEY uq_system_admin_identity_event (identity_event_id),
  INDEX idx_system_admin_event_person (target_person_id),
  CONSTRAINT fk_system_admin_event_actor FOREIGN KEY (actor_account_id) REFERENCES system_admin_accounts(account_id) ON DELETE RESTRICT,
  CONSTRAINT fk_system_admin_event_identity FOREIGN KEY (identity_event_id) REFERENCES identity_access_events(event_id) ON DELETE RESTRICT,
  CONSTRAINT fk_system_admin_event_person FOREIGN KEY (target_person_id) REFERENCES person(person_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;
const statements = () => SCHEMA_SQL.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean);
const failure = code => Object.assign(new Error(code), { code, statusCode: 409 });
async function inspectSystemAdmin(db) {
  const missing = [], drift = [];
  for (const table of ['schema_migrations','person','user_accounts','identity_access_events','roles','role_permissions','permissions']) {
    const [found] = await db.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!found.length) drift.push({dependency:table,reason:'missing'});
  }
  for (const sql of statements()) {
    const table = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const [found] = await db.execute('SELECT TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
    if (!found.length) { missing.push(table); continue; }
    const [[ddl]] = await db.query('SHOW CREATE TABLE '+table);
    const comparison = compareCreateStatements(sql,ddl['Create Table']);
    if (!comparison.matching || !/ENGINE=InnoDB/i.test(ddl['Create Table']) || /NOT ENFORCED/i.test(ddl['Create Table']) || found[0].TABLE_COLLATION!=='utf8mb4_unicode_ci') drift.push({table,differences:comparison.differences});
  }
  const [markers] = drift.some(d=>d.dependency==='schema_migrations') ? [[]] : await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]);
  if (markers.length && missing.length) drift.push({reason:'record_without_structure'});
  return {ready:!missing.length&&!drift.length&&!!markers.length,missing,drift,backfill:[]};
}
async function applySystemAdmin(db) {
  const [[lock]] = await db.execute("SELECT GET_LOCK('mdm_system_admin_migration_v1',10) acquired");
  if (Number(lock.acquired)!==1) throw failure('SYSTEM_ADMIN_MIGRATION_BUSY');
  try {
    const before = await inspectSystemAdmin(db);
    if (before.drift.length) throw failure('SYSTEM_ADMIN_SCHEMA_DRIFT');
    for (const sql of statements()) if (before.missing.includes(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1])) await db.execute(sql);
    const after = await inspectSystemAdmin(db);
    if (after.drift.length||after.missing.length) throw Object.assign(failure('SYSTEM_ADMIN_SCHEMA_DRIFT'), {inspection:after});
    await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)',[MIGRATION_KEY]);
    return inspectSystemAdmin(db);
  } finally { await db.execute("SELECT RELEASE_LOCK('mdm_system_admin_migration_v1')"); }
}
module.exports = {SCHEMA_SQL,MIGRATION_KEY,inspectSystemAdmin,applySystemAdmin};
