// Explicit migration input. Runtime requests only inspect/read these tables.
const MIGRATION_KEY = '2026-10-20-process-case-governance-v1';
const TABLES = ['process_case_submissions', 'process_case_changes', 'process_case_change_confirmations','process_case_requests'];
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS process_case_submissions (
  submission_id CHAR(36) PRIMARY KEY, record_no BIGINT NOT NULL AUTO_INCREMENT, case_id BIGINT NOT NULL, revision_id BIGINT NOT NULL,
  revision_no INT NOT NULL, content_hash CHAR(64) NOT NULL, submission_json JSON NOT NULL,
  submitted_by_person_id BIGINT NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_process_case_submission_record (record_no),
  KEY idx_process_case_submission (case_id,revision_id,created_at,submission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_case_changes (
  change_id CHAR(36) PRIMARY KEY, record_no BIGINT NOT NULL AUTO_INCREMENT, case_id BIGINT NOT NULL, revision_id BIGINT NOT NULL,
  revision_no INT NOT NULL, content_hash CHAR(64) NOT NULL, kind VARCHAR(32) NOT NULL,
  change_json JSON NOT NULL, change_digest CHAR(64) NOT NULL, state VARCHAR(32) NOT NULL,
  proposed_by_person_id BIGINT NOT NULL, registered_by_person_id BIGINT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), registered_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_process_case_change_record (record_no),
  KEY idx_process_case_changes (case_id,created_at,change_id), CHECK(state IN ('pending','registered','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_case_change_confirmations (
  confirmation_id CHAR(36) PRIMARY KEY, record_no BIGINT NOT NULL AUTO_INCREMENT, change_id CHAR(36) NOT NULL,
  department_id BIGINT NOT NULL, confirmed_by_person_id BIGINT NOT NULL,
  evidence_json JSON NOT NULL, basis_text TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_process_case_confirmation_record (record_no),
  KEY idx_process_case_confirmation (change_id,department_id,created_at,confirmation_id),
  CONSTRAINT fk_process_case_change_confirmation FOREIGN KEY(change_id) REFERENCES process_case_changes(change_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_case_requests (
  request_id CHAR(36) PRIMARY KEY, case_id BIGINT NOT NULL, actor_person_id BIGINT NOT NULL,
  request_digest CHAR(64) NOT NULL, response_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;
async function inspectSchema(db) {
  const missing=[],drift=[];
  for(const statement of require('./mysqlSchema').splitSqlStatements(SCHEMA_SQL)){
    const table=statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const [present]=await db.execute('SELECT TABLE_NAME,TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
    if(!present.length){missing.push(table);continue;}
    const [[ddl]]=await db.query(`SHOW CREATE TABLE ${table}`),actual=ddl['Create Table'];
    const compared=require('./processV7M0Baseline').compareCreateStatements(statement,actual);
    const [collations]=await db.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME<>?',[table,'utf8mb4_unicode_ci']);
    if(!compared.matching||!/ENGINE=InnoDB/i.test(actual)||/NOT ENFORCED/i.test(actual)||present[0].TABLE_COLLATION!=='utf8mb4_unicode_ci'||collations.length)
      drift.push({table,differences:compared.differences,engine_innodb:/ENGINE=InnoDB/i.test(actual),checks_enforced:!/NOT ENFORCED/i.test(actual),collation:present[0].TABLE_COLLATION,column_collation_drift:collations});
  }
  let markers=[];
  try{[markers]=await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]);}
  catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;missing.push('schema_migrations');}
  return {ready:!missing.length&&!drift.length&&markers.length>0,migration_key:MIGRATION_KEY,missing,drift,marker_present:markers.length>0,backfill:[]};
}
async function applyMigration(db, {permit} = {}) {
  await require('./governanceMigrationAuthorization').verifyMigrationPermit(db,permit,{write:true});
  const [[lock]]=await db.execute("SELECT GET_LOCK('process_case_governance_v1_migration',10) acquired");
  if(Number(lock.acquired)!==1)throw Object.assign(new Error('PROCESS_CASE_MIGRATION_BUSY'),{code:'PROCESS_CASE_MIGRATION_BUSY'});
  try{
    const before=await inspectSchema(db);
    if(before.drift.length||before.missing.includes('schema_migrations'))throw Object.assign(new Error('PROCESS_CASE_SCHEMA_DRIFT'),{code:'PROCESS_CASE_SCHEMA_DRIFT',inspection:before});
    for(const statement of require('./mysqlSchema').splitSqlStatements(SCHEMA_SQL))
      if(before.missing.includes(statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1]))await db.query(statement);
    const after=await inspectSchema(db);
    if(after.missing.length||after.drift.length)throw Object.assign(new Error('PROCESS_CASE_SCHEMA_DRIFT'),{code:'PROCESS_CASE_SCHEMA_DRIFT',inspection:after});
    await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)',[MIGRATION_KEY]);
    return inspectSchema(db);
  }finally{await db.execute("SELECT RELEASE_LOCK('process_case_governance_v1_migration')");}
}
module.exports = {MIGRATION_KEY,TABLES,SCHEMA_SQL,inspectSchema,applyMigration};
