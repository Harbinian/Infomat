// Explicit additive migration. It preserves every old role ID and person grant;
// neither assignment creation nor role grants are inferred from historical data.
const { compareCreateStatements } = require('./processV7M0Baseline');
const { ACCESS_MODEL_VERSION, ROLE_GUIDES } = require('./accessModelV4Baseline');
const { fail, RESPONSIBILITIES_MIGRATION_KEY } = require('./governanceResponsibilities');
const MIGRATION_KEY = RESPONSIBILITIES_MIGRATION_KEY;
const PREVIOUS_MODEL_VERSION = 'rbac-raci-v3-2026-07-31';
// The v5 step only adds a directory role. Old governance permissions stay frozen;
// preparing these tables on a fresh v5 database must never downgrade its model.
const SUCCESSOR_MODEL_VERSION = 'rbac-raci-v5-2026-10-19';
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS process_governance_responsibilities (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  target_type VARCHAR(32) NOT NULL,
  target_id BIGINT NOT NULL,
  assignment_kind VARCHAR(32) NOT NULL,
  process_ref VARCHAR(160) NOT NULL,
  person_id BIGINT NULL,
  department_id BIGINT NULL,
  revision_no INT NOT NULL,
  basis_text TEXT NOT NULL,
  actor_person_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_governance_responsibility_target (target_type,target_id,assignment_kind),
  INDEX idx_governance_responsibility_person (person_id,target_type,target_id),
  INDEX fk_governance_responsibility_actor (actor_person_id),
  CONSTRAINT chk_governance_responsibility_kind CHECK ((target_type = 'case' AND assignment_kind IN ('steward','owner')) OR (target_type = 'work_package' AND assignment_kind = 'steward')),
  CONSTRAINT chk_governance_responsibility_revision CHECK (revision_no > 0),
  CONSTRAINT fk_governance_responsibility_person FOREIGN KEY (person_id) REFERENCES person(person_id) ON DELETE RESTRICT,
  CONSTRAINT fk_governance_responsibility_actor FOREIGN KEY (actor_person_id) REFERENCES person(person_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_governance_responsibility_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  target_type VARCHAR(32) NOT NULL,
  target_id BIGINT NOT NULL,
  assignment_kind VARCHAR(32) NOT NULL,
  process_ref VARCHAR(160) NOT NULL,
  person_id BIGINT NULL,
  previous_person_id BIGINT NULL,
  department_id BIGINT NULL,
  revision_no INT NOT NULL,
  basis_text TEXT NOT NULL,
  actor_person_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_governance_responsibility_event (target_type,target_id,assignment_kind,revision_no),
  INDEX fk_governance_responsibility_event_actor (actor_person_id),
  CONSTRAINT chk_governance_responsibility_event_kind CHECK ((target_type = 'case' AND assignment_kind IN ('steward','owner')) OR (target_type = 'work_package' AND assignment_kind = 'steward')),
  CONSTRAINT chk_governance_responsibility_event_revision CHECK (revision_no > 0),
  CONSTRAINT fk_governance_responsibility_event_actor FOREIGN KEY (actor_person_id) REFERENCES person(person_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS process_governance_work_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT NOT NULL,
  process_ref VARCHAR(160) NOT NULL,
  request_key VARCHAR(80) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  content_text TEXT NOT NULL,
  basis_text TEXT NOT NULL,
  actor_person_id BIGINT NOT NULL,
  assignment_revision_no INT NOT NULL,
  source_revision_no INT NOT NULL,
  source_content_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_governance_work_request (case_id,request_key),
  INDEX idx_governance_work_case (case_id,id),
  INDEX fk_governance_work_actor (actor_person_id),
  CONSTRAINT chk_governance_work_revision CHECK ((assignment_revision_no > 0) AND (source_revision_no > 0)),
  CONSTRAINT fk_governance_work_case FOREIGN KEY (case_id) REFERENCES process_v7_preview_cases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_governance_work_actor FOREIGN KEY (actor_person_id) REFERENCES person(person_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS governance_responsibility_model_backups (
  migration_key VARCHAR(128) PRIMARY KEY,
  snapshot_json MEDIUMTEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_governance_model_backup_status CHECK (status IN ('prepared','applied','compensated'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;
const statements = () => SCHEMA_SQL.split(/;\s*(?:\r?\n|$)/).map(sql => sql.trim()).filter(Boolean);
const oldRoles = () => ROLE_GUIDES.filter(role => role.code !== 'mdm_steward');
async function rows(db, sql, params = []) { const [result] = await db.execute(sql, params); return result; }
async function inspectResponsibilities(db) {
  const missing = [], drift = [];
  for (const table of ['person', 'user_accounts', 'person_roles', 'roles', 'permissions', 'role_permissions', 'process_v7_preview_cases', 'schema_migrations']) {
    if (!(await rows(db, 'SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table])).length) drift.push({ dependency: table, reason: 'missing' });
  }
  for (const sql of statements()) {
    const table = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const found = await rows(db, 'SELECT TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    if (!found.length) { missing.push(table); continue; }
    const [[ddl]] = await db.query('SHOW CREATE TABLE ' + table);
    const comparison = compareCreateStatements(sql, ddl['Create Table']);
    if (!comparison.matching || !/ENGINE=InnoDB/i.test(ddl['Create Table']) || /NOT ENFORCED/i.test(ddl['Create Table']) || found[0].TABLE_COLLATION !== 'utf8mb4_unicode_ci') drift.push({ table, differences: comparison.differences });
  }
  let modelReady = false, actualModelVersion = ACCESS_MODEL_VERSION;
  if (!drift.some(item => item.dependency)) {
    const roleRows = await rows(db, 'SELECT CAST(role_id AS CHAR) AS role_id,role_code,model_version,status,parent_role_id FROM roles WHERE role_code IN (' + ROLE_GUIDES.map(() => '?').join(',') + ')', ROLE_GUIDES.map(role => role.code));
    for (const expected of oldRoles()) {
      const actual = roleRows.find(role => role.role_code === expected.code);
      if (!actual || actual.status !== 'active' || actual.parent_role_id || ![PREVIOUS_MODEL_VERSION, ACCESS_MODEL_VERSION, SUCCESSOR_MODEL_VERSION].includes(actual.model_version)) drift.push({ role: expected.code, reason: 'unsupported_baseline' });
    }
    for (const expected of ROLE_GUIDES) {
      const actual = roleRows.find(role => role.role_code === expected.code);
      if (!actual) continue;
      const grants = await rows(db, 'SELECT p.perm_code,rp.effect FROM role_permissions rp JOIN permissions p ON p.perm_id=rp.perm_id WHERE rp.role_id=CAST(? AS SIGNED) ORDER BY p.perm_code', [actual.role_id]);
      const expectedCodes = expected.permissions.map(permission => permission.code).sort();
      if (JSON.stringify(grants.map(item => item.perm_code).sort()) !== JSON.stringify(expectedCodes) || grants.some(item => item.effect !== 'allow')) drift.push({ role: expected.code, reason: 'permission_baseline_changed' });
    }
    const successor = roleRows.length === ROLE_GUIDES.length && roleRows.every(role => role.status === 'active' && role.model_version === SUCCESSOR_MODEL_VERSION && !role.parent_role_id);
    if (roleRows.some(role => role.model_version === SUCCESSOR_MODEL_VERSION) && !successor) drift.push({ reason: 'mixed_successor_model' });
    if (successor) actualModelVersion = SUCCESSOR_MODEL_VERSION;
    modelReady = successor || (roleRows.length === ROLE_GUIDES.length && roleRows.every(role => role.status === 'active' && role.model_version === ACCESS_MODEL_VERSION && !role.parent_role_id));
  }
  const markers = drift.some(item => item.dependency === 'schema_migrations') ? [] : await rows(db, 'SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  if (markers.length && missing.length) drift.push({ reason: 'record_without_structure' });
  return { ready: !missing.length && !drift.length && modelReady && !!markers.length, missing, drift, model_ready: modelReady,
    model_version: actualModelVersion, role_count: ROLE_GUIDES.length, person_grants_changed: false, backfill: [] };
}
async function locked(db, action) {
  const [[lock]] = await db.execute("SELECT GET_LOCK('mdm_governance_responsibilities_v1',10) acquired");
  if (Number(lock.acquired) !== 1) throw fail('RESPONSIBILITY_MIGRATION_BUSY', '治理职责迁移正在执行');
  try { return await action(); } finally { await db.execute("SELECT RELEASE_LOCK('mdm_governance_responsibilities_v1')"); }
}
async function applyResponsibilities(db) {
  return locked(db, async () => {
    const before = await inspectResponsibilities(db);
    if (before.drift.length) throw Object.assign(fail('RESPONSIBILITY_SCHEMA_DRIFT', '职责结构或原角色权限与受支持基线不一致'), { inspection: before });
    if (before.ready) return { ...before, idempotent: true };
    for (const sql of statements()) if (before.missing.includes(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1])) await db.execute(sql);
    const prepared = await inspectResponsibilities(db);
    if (prepared.missing.length || prepared.drift.length) throw Object.assign(fail('RESPONSIBILITY_SCHEMA_DRIFT', '职责表准备核对未通过，原角色模型保持不变'), { inspection: prepared });
    await db.beginTransaction();
    try {
      const roleRows = await rows(db, 'SELECT CAST(role_id AS CHAR) AS role_id,role_code,model_version,status FROM roles WHERE role_code IN (' + ROLE_GUIDES.map(() => '?').join(',') + ') FOR UPDATE', ROLE_GUIDES.map(role => role.code));
      await db.execute("INSERT IGNORE INTO governance_responsibility_model_backups(migration_key,snapshot_json,status) VALUES (?,?,'prepared')", [MIGRATION_KEY, JSON.stringify(roleRows)]);
      const definition = ROLE_GUIDES.find(role => role.code === 'mdm_steward');
      const targetModelVersion = before.model_version;
      for (const permission of definition.permissions) {
        await db.execute(`INSERT INTO permissions(perm_code,resource,action,description,is_dangerous,default_scope,protected_core)
          VALUES (?,?,?,?,0,?,1) ON DUPLICATE KEY UPDATE perm_code=VALUES(perm_code)`, [permission.code, permission.resource, permission.action, permission.description, permission.defaultScope]);
      }
      await db.execute(`INSERT INTO roles(role_code,role_name,description,parent_role_id,is_system,role_group,status,model_version,is_core,protected_core)
        VALUES (?,?,?,NULL,1,'mdm','active',?,1,1) ON DUPLICATE KEY UPDATE status='active',model_version=VALUES(model_version)`, [definition.code, definition.name, definition.description, targetModelVersion]);
      const [[newRole]] = await db.execute("SELECT CAST(role_id AS CHAR) AS role_id FROM roles WHERE role_code='mdm_steward' FOR UPDATE");
      for (const permission of definition.permissions) await db.execute(`INSERT IGNORE INTO role_permissions(role_id,perm_id,effect)
        SELECT CAST(? AS SIGNED),perm_id,'allow' FROM permissions WHERE perm_code=?`, [newRole.role_id, permission.code]);
      for (const definition of oldRoles()) await db.execute('UPDATE roles SET model_version=? WHERE role_code=?', [targetModelVersion, definition.code]);
      await db.execute("UPDATE governance_responsibility_model_backups SET status='applied' WHERE migration_key=?", [MIGRATION_KEY]);
      await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)', [MIGRATION_KEY]);
      const verified = await inspectResponsibilities(db);
      if (!verified.ready) throw Object.assign(fail('RESPONSIBILITY_SCHEMA_DRIFT', '治理职责迁移核对未通过'), { inspection: verified });
      await db.commit();
    } catch (error) { await db.rollback(); throw error; }
    const after = await inspectResponsibilities(db);
    if (!after.ready) throw Object.assign(fail('RESPONSIBILITY_SCHEMA_DRIFT', '治理职责迁移核对未通过'), { inspection: after });
    return after;
  });
}
async function compensateResponsibilities(db) {
  return locked(db, async () => {
    const inspection = await inspectResponsibilities(db);
    if (inspection.missing.length || inspection.drift.length) throw fail('RESPONSIBILITY_SCHEMA_DRIFT', '职责结构异常，不能自动补偿');
    if (inspection.model_version === SUCCESSOR_MODEL_VERSION) throw fail('RESPONSIBILITY_COMPENSATION_BLOCKED', '后续目录角色模型已准备，须先按后续版本方案恢复');
    await db.beginTransaction();
    try {
      await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=? FOR UPDATE', [MIGRATION_KEY]);
      const [[backup]] = await db.execute('SELECT snapshot_json,status FROM governance_responsibility_model_backups WHERE migration_key=? FOR UPDATE', [MIGRATION_KEY]);
      if (!backup) throw fail('RESPONSIBILITY_BACKUP_REQUIRED', '缺少原角色模型快照，不能补偿');
      if (backup.status === 'compensated') { await db.commit(); return { compensated: true, idempotent: true, retained_history: true }; }
      const [[newRole]] = await db.execute("SELECT CAST(role_id AS CHAR) AS role_id FROM roles WHERE role_code='mdm_steward' FOR UPDATE");
      const grants = newRole ? await rows(db, 'SELECT person_role_id FROM person_roles WHERE role_id=CAST(? AS SIGNED) FOR UPDATE', [newRole.role_id]) : [];
      let used = grants.length > 0;
      for (const table of ['process_governance_responsibilities', 'process_governance_responsibility_events', 'process_governance_work_records']) used = (await rows(db, `SELECT id FROM ${table} LIMIT 1 FOR UPDATE`)).length > 0 || used;
      if (used) throw fail('RESPONSIBILITY_COMPENSATION_BLOCKED', '新职责已有授权或办理记录，必须保留并制定单独恢复方案');
      const snapshot = JSON.parse(backup.snapshot_json);
      for (const row of snapshot) await db.execute('UPDATE roles SET model_version=?,status=? WHERE role_id=CAST(? AS SIGNED) AND role_code=?', [row.model_version, row.status, row.role_id, row.role_code]);
      if (newRole && !snapshot.some(row => row.role_code === 'mdm_steward')) await db.execute("UPDATE roles SET status='retired' WHERE role_id=CAST(? AS SIGNED)", [newRole.role_id]);
      await db.execute("UPDATE governance_responsibility_model_backups SET status='compensated' WHERE migration_key=?", [MIGRATION_KEY]);
      await db.execute('DELETE FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
      await db.commit();
      return { compensated: true, retained_history: true, person_grants_changed: false, retained_tables: true };
    } catch (error) { await db.rollback(); throw error; }
  });
}
module.exports = { MIGRATION_KEY, PREVIOUS_MODEL_VERSION, SCHEMA_SQL, inspectResponsibilities, applyResponsibilities, compensateResponsibilities };
