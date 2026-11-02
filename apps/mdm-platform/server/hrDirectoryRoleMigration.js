// Explicit v4 -> v5 model preparation. No user grant, account change, personnel
// import, startup DDL or private configuration read. DDL is additive and retained
// on compensation; a database backup is still required before formal execution.
const { compareCreateStatements } = require('./processV7M0Baseline');
const v4 = require('./accessModelV4Baseline');

const MIGRATION_KEY = '2026-10-19-hr-directory-role-v5';
const PREVIOUS_MODEL_VERSION = v4.ACCESS_MODEL_VERSION;
const MODEL_VERSION = 'rbac-raci-v5-2026-10-19';
const ROLE_CODE = 'hr_directory_manager';
// Frozen v5 delta: a later runtime model must not rewrite this migration.
const DEFINITION = {
  code: ROLE_CODE, name: '行政人事信息维护员', group: 'directory',
  description: '由行政人事部维护全公司组织架构与人员信息，3000作为全域统一读取的人员真源',
  permissions: [
    { code: 'identity:read', resource: 'identity', action: 'read', description: '查看账号、角色和责任配置', isDangerous: false, defaultScope: 'global' },
    { code: 'directory:read', resource: 'directory', action: 'read', description: '读取3000统一组织与人员基础目录', isDangerous: false, defaultScope: 'global' },
    { code: 'directory:maintain', resource: 'directory', action: 'maintain', description: '维护全公司组织架构与人员信息，保存直接生效并记录变更原因及前后内容', isDangerous: true, defaultScope: 'global' }
  ]
};
const ROLE_CODES = [...v4.ROLE_GUIDES.map(role => role.code), ROLE_CODE];
const BACKUP_TABLE = 'hr_directory_role_model_backups';
const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS hr_directory_role_model_backups (
  migration_key VARCHAR(128) PRIMARY KEY,
  snapshot_json MEDIUMTEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_hr_directory_backup_status CHECK (status IN ('prepared','applied','compensated'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

function fail(code, message, inspection) {
  return Object.assign(new Error(message), { code, statusCode: 409, ...(inspection ? { inspection } : {}) });
}
async function rows(db, sql, params = []) { return (await db.execute(sql, params))[0]; }
async function tableExists(db, table) {
  return (await rows(db, 'SELECT TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]))[0] || null;
}
async function groupConstraint(db) {
  const checks = await rows(db, `SELECT tc.CONSTRAINT_NAME,tc.ENFORCED,cc.CHECK_CLAUSE FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='roles' AND tc.CONSTRAINT_TYPE='CHECK'`);
  const groups = checks.filter(check => /\brole_group\b/i.test(check.CHECK_CLAUSE));
  if (groups.length !== 1) return { supported: false };
  const check = groups[0];
  if (!/^[A-Za-z0-9_]+$/.test(check.CONSTRAINT_NAME) || check.ENFORCED !== 'YES') return { supported: false };
  const normalized = check.CHECK_CLAUSE.replace(/\\'/g, "'").replace(/_utf8mb4|[`()\s]/gi, '').toLowerCase();
  const old = "role_groupin'system','mdm','legacy'", current = "role_groupin'system','mdm','directory','legacy'";
  return { supported: normalized === old || normalized === current, current: normalized === current,
    name: check.CONSTRAINT_NAME, clause: check.CHECK_CLAUSE };
}
async function roleRows(db, lock = false) {
  return rows(db, `SELECT CAST(role_id AS CHAR) role_id,role_code,role_name,description,parent_role_id,
    role_group,status,model_version,is_system,is_core,protected_core FROM roles
    WHERE role_code IN (${ROLE_CODES.map(() => '?').join(',')}) ORDER BY role_code ${lock ? 'FOR UPDATE' : ''}`, ROLE_CODES);
}
async function inspectHrDirectoryRole(db) {
  const drift = [], missing = [];
  for (const table of ['roles', 'permissions', 'role_permissions', 'person_roles', 'schema_migrations']) {
    if (!await tableExists(db, table)) drift.push({ dependency: table, reason: 'missing' });
  }
  const backupTable = await tableExists(db, BACKUP_TABLE);
  if (!backupTable) missing.push(BACKUP_TABLE);
  else {
    const [[ddl]] = await db.query('SHOW CREATE TABLE ' + BACKUP_TABLE);
    const comparison = compareCreateStatements(SCHEMA_SQL, ddl['Create Table']);
    if (!comparison.matching || !/ENGINE=InnoDB/i.test(ddl['Create Table']) || /NOT ENFORCED/i.test(ddl['Create Table']) || backupTable.TABLE_COLLATION !== 'utf8mb4_unicode_ci') drift.push({ table: BACKUP_TABLE, reason: 'structure_changed' });
  }
  if (drift.some(item => item.dependency)) return { ready: false, model_ready: false, missing, drift, model_version: MODEL_VERSION, person_grants_changed: false };
  const constraint = await groupConstraint(db);
  if (!constraint.supported) drift.push({ table: 'roles', reason: 'unsupported_group_constraint' });
  const roles = await roleRows(db);
  const unknownActiveRoles = await rows(db, `SELECT role_code FROM roles WHERE status='active' AND role_code NOT IN (${ROLE_CODES.map(() => '?').join(',')})`, ROLE_CODES);
  for (const role of unknownActiveRoles) drift.push({ role: role.role_code, reason: 'unsupported_active_role' });
  const oldVersions = new Set();
  for (const definition of v4.ROLE_GUIDES) {
    const role = roles.find(item => item.role_code === definition.code);
    if (!role || role.status !== 'active' || role.parent_role_id || role.role_group !== (definition.code === 'admin' ? 'system' : 'mdm') || ![PREVIOUS_MODEL_VERSION, MODEL_VERSION].includes(role.model_version)) drift.push({ role: definition.code, reason: 'unsupported_baseline' });
    if (role) oldVersions.add(role.model_version);
  }
  if (oldVersions.size !== 1) drift.push({ reason: 'mixed_model_versions' });
  const newRole = roles.find(role => role.role_code === ROLE_CODE);
  if (newRole && (newRole.parent_role_id || newRole.role_group !== 'directory' || newRole.model_version !== MODEL_VERSION || !['active', 'retired'].includes(newRole.status))) drift.push({ role: ROLE_CODE, reason: 'unsupported_baseline' });
  if (newRole?.status === 'active' && !oldVersions.has(MODEL_VERSION)) drift.push({ role: ROLE_CODE, reason: 'unexpected_active_role' });
  for (const definition of [...v4.ROLE_GUIDES, DEFINITION]) {
    const role = roles.find(item => item.role_code === definition.code);
    if (!role) continue;
    const grants = await rows(db, `SELECT p.perm_code,rp.effect FROM role_permissions rp JOIN permissions p ON p.perm_id=rp.perm_id
      WHERE rp.role_id=CAST(? AS SIGNED) ORDER BY p.perm_code`, [role.role_id]);
    if (JSON.stringify(grants.map(item => item.perm_code).sort()) !== JSON.stringify(definition.permissions.map(item => item.code).sort()) || grants.some(item => item.effect !== 'allow')) drift.push({ role: definition.code, reason: 'permission_baseline_changed' });
  }
  for (const permission of DEFINITION.permissions.filter(item => item.resource === 'directory')) {
    const existing = (await rows(db, `SELECT resource,action,default_scope,is_dangerous,protected_core,field_constraints FROM permissions WHERE perm_code=?`, [permission.code]))[0];
    if (existing && (existing.resource !== permission.resource || existing.action !== permission.action || existing.default_scope !== 'global' || Number(existing.is_dangerous) !== Number(permission.isDangerous) || Number(existing.protected_core) !== 1 || existing.field_constraints != null)) drift.push({ permission: permission.code, reason: 'permission_definition_changed' });
  }
  const markers = await rows(db, 'SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  const modelReady = oldVersions.size === 1 && oldVersions.has(MODEL_VERSION) && newRole?.status === 'active' && constraint.current;
  const backup = backupTable ? (await rows(db, `SELECT status FROM ${BACKUP_TABLE} WHERE migration_key=?`, [MIGRATION_KEY]))[0] : null;
  if (markers.length && (!modelReady || backup?.status !== 'applied')) drift.push({ reason: 'migration_record_inconsistent' });
  return { ready: Boolean(!missing.length && !drift.length && modelReady && markers.length), model_ready: Boolean(modelReady),
    model_version: MODEL_VERSION, previous_model_version: PREVIOUS_MODEL_VERSION, role_count: ROLE_CODES.length,
    missing, drift, directory_group_prepared: Boolean(constraint.current), backup_status: backup?.status || null,
    person_grants_changed: false, automatic_grants: [], backfill: [] };
}
async function locked(db, action) {
  // Share the predecessor's maintenance lock so the two explicit steps cannot race.
  const [[lock]] = await db.execute("SELECT GET_LOCK('mdm_governance_responsibilities_v1',10) acquired");
  if (Number(lock.acquired) !== 1) throw fail('HR_DIRECTORY_ROLE_MIGRATION_BUSY', '固定角色迁移正在执行');
  try { return await action(); } finally { await db.execute("SELECT RELEASE_LOCK('mdm_governance_responsibilities_v1')"); }
}
async function transaction(db, work) {
  await db.beginTransaction();
  let committing = false;
  try { const result = await work(); committing = true; await db.commit(); return result; }
  catch (error) {
    if (!committing) await db.rollback();
    else throw fail('HR_DIRECTORY_ROLE_COMMIT_UNKNOWN', '角色迁移提交回执不明，请先检查迁移记录与备份状态');
    throw error;
  }
}
async function applyHrDirectoryRole(db) {
  return locked(db, async () => {
    const before = await inspectHrDirectoryRole(db);
    if (before.drift.length) throw fail('HR_DIRECTORY_ROLE_SCHEMA_DRIFT', '角色或权限与受支持的v4/v5基线不一致', before);
    if (before.ready) return { ...before, idempotent: true };
    if (before.missing.includes(BACKUP_TABLE)) await db.execute(SCHEMA_SQL);
    // Persist the first role snapshot before MySQL's implicit-commit DDL.
    await transaction(db, async () => {
      const previous = (await rows(db, `SELECT snapshot_json,status FROM ${BACKUP_TABLE} WHERE migration_key=? FOR UPDATE`, [MIGRATION_KEY]))[0];
      const roles = await roleRows(db, true);
      const snapshot = { model_version: roles[0]?.model_version, roles, group_constraint: await groupConstraint(db) };
      if (!previous) await db.execute(`INSERT INTO ${BACKUP_TABLE}(migration_key,snapshot_json,status) VALUES (?,?,'prepared')`, [MIGRATION_KEY, JSON.stringify(snapshot)]);
      else if (previous.status === 'compensated') await db.execute(`UPDATE ${BACKUP_TABLE} SET status='prepared' WHERE migration_key=?`, [MIGRATION_KEY]);
    });
    const constraint = await groupConstraint(db);
    if (!constraint.supported) throw fail('HR_DIRECTORY_ROLE_SCHEMA_DRIFT', '角色分组约束已经变化');
    if (!constraint.current) await db.execute(`ALTER TABLE roles DROP CHECK ${constraint.name}, ADD CONSTRAINT chk_roles_group_v5 CHECK (role_group IN ('system','mdm','directory','legacy'))`);
    return transaction(db, async () => {
      await roleRows(db, true);
      const current = await inspectHrDirectoryRole(db);
      if (current.drift.length) throw fail('HR_DIRECTORY_ROLE_SCHEMA_DRIFT', '迁移前角色基线复核未通过', current);
      for (const permission of DEFINITION.permissions.filter(item => item.resource === 'directory')) {
        await db.execute(`INSERT INTO permissions(perm_code,resource,action,description,is_dangerous,default_scope,protected_core)
          VALUES (?,?,?,?,?,'global',1) ON DUPLICATE KEY UPDATE perm_code=VALUES(perm_code)`, [permission.code, permission.resource, permission.action, permission.description, Number(permission.isDangerous)]);
      }
      await db.execute(`INSERT INTO roles(role_code,role_name,description,parent_role_id,is_system,role_group,status,model_version,is_core,protected_core)
        VALUES (?,?,?,NULL,1,'directory','active',?,1,1) ON DUPLICATE KEY UPDATE status='active',model_version=VALUES(model_version)`, [ROLE_CODE, DEFINITION.name, DEFINITION.description, MODEL_VERSION]);
      for (const permission of DEFINITION.permissions) await db.execute(`INSERT IGNORE INTO role_permissions(role_id,perm_id,effect)
        SELECT r.role_id,p.perm_id,'allow' FROM roles r JOIN permissions p ON p.perm_code=? WHERE r.role_code=?`, [permission.code, ROLE_CODE]);
      for (const definition of v4.ROLE_GUIDES) await db.execute('UPDATE roles SET model_version=? WHERE role_code=?', [MODEL_VERSION, definition.code]);
      await db.execute(`UPDATE ${BACKUP_TABLE} SET status='applied' WHERE migration_key=?`, [MIGRATION_KEY]);
      await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)', [MIGRATION_KEY]);
      const after = await inspectHrDirectoryRole(db);
      if (!after.ready) throw fail('HR_DIRECTORY_ROLE_SCHEMA_DRIFT', '目录角色迁移核对未通过', after);
      return after;
    });
  });
}
async function compensateHrDirectoryRole(db) {
  return locked(db, async () => {
    const before = await inspectHrDirectoryRole(db);
    if (before.missing.length || before.drift.length) throw fail('HR_DIRECTORY_ROLE_SCHEMA_DRIFT', '模型结构异常，不能自动补偿', before);
    return transaction(db, async () => {
      const backup = (await rows(db, `SELECT snapshot_json,status FROM ${BACKUP_TABLE} WHERE migration_key=? FOR UPDATE`, [MIGRATION_KEY]))[0];
      if (!backup) throw fail('HR_DIRECTORY_ROLE_BACKUP_REQUIRED', '缺少原角色快照，不能自动补偿');
      if (backup.status === 'compensated') return { compensated: true, idempotent: true, retained_history: true, retained_group_constraint: true };
      const currentRoles = await roleRows(db, true), newRole = currentRoles.find(role => role.role_code === ROLE_CODE);
      const grants = newRole ? await rows(db, 'SELECT person_role_id FROM person_roles WHERE role_id=CAST(? AS SIGNED) FOR UPDATE', [newRole.role_id]) : [];
      if (grants.length) throw fail('HR_DIRECTORY_ROLE_COMPENSATION_BLOCKED', '新角色已有授权历史，须保留历史并制定单独恢复方案');
      const snapshot = JSON.parse(backup.snapshot_json);
      if (!Array.isArray(snapshot.roles) || JSON.stringify(snapshot.roles.map(role => role.role_code).sort()) !== JSON.stringify(v4.ROLE_GUIDES.map(role => role.code).sort()) ||
          snapshot.roles.some(role => role.model_version !== PREVIOUS_MODEL_VERSION || role.status !== 'active' || !currentRoles.some(current => current.role_code === role.role_code && current.role_id === role.role_id))) {
        throw fail('HR_DIRECTORY_ROLE_COMPENSATION_BLOCKED', '快照不是完整v4基线，不能自动退回旧模型');
      }
      for (const role of snapshot.roles) await db.execute('UPDATE roles SET model_version=?,status=? WHERE role_id=CAST(? AS SIGNED) AND role_code=?', [role.model_version, role.status, role.role_id, role.role_code]);
      if (newRole && !snapshot.roles.some(role => role.role_code === ROLE_CODE)) await db.execute("UPDATE roles SET status='retired' WHERE role_id=CAST(? AS SIGNED)", [newRole.role_id]);
      await db.execute(`UPDATE ${BACKUP_TABLE} SET status='compensated' WHERE migration_key=?`, [MIGRATION_KEY]);
      await db.execute('DELETE FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
      return { compensated: true, person_grants_changed: false, retained_history: true, retained_permissions: true, retained_tables: true, retained_group_constraint: true };
    });
  });
}

module.exports = { MIGRATION_KEY, PREVIOUS_MODEL_VERSION, MODEL_VERSION, ROLE_CODE, DEFINITION, SCHEMA_SQL,
  inspectHrDirectoryRole, applyHrDirectoryRole, compensateHrDirectoryRole };
