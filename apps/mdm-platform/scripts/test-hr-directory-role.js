// Verification uses only an owned disposable MySQL 8.4 container and synthetic
// identities. No .env, existing database, real personnel or application port.
const assert = require('node:assert/strict');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { ensureMysqlBuiltInRolesAndPermissions, makeIdentityMysqlRepository, readPersonAuthority } = require('../server/identityMysqlRepository');
const { makeGovernanceAccessMysqlRepository, validateRoleAssignmentInput } = require('../server/governanceAccessMysqlRepository');
const { getAccessModel, ACCESS_MODEL_VERSION, PROJECT_ROLE_DEFINITIONS } = require('../server/roleDefinitions');
const { PROCESS_V7_PREVIEW_SCHEMA_SQL } = require('../server/processV7PreviewReviewMigration');
const responsibilities = require('../server/governanceResponsibilitiesMigration');
const migration = require('../server/hrDirectoryRoleMigration');
const checks = [];
async function check(name, work) { await work(); checks.push(name); console.log('PASS ' + name); }
async function main() {
  const runtime = getAccessModel(), definition = runtime.roles.find(role => role.code === migration.ROLE_CODE);
  assert.equal(ACCESS_MODEL_VERSION, migration.MODEL_VERSION);
  assert.deepEqual(definition.permissions, migration.DEFINITION.permissions.map(permission => permission.code));
  assert.equal(PROJECT_ROLE_DEFINITIONS.some(role => role.roleCode === migration.ROLE_CODE), false);
  assert.equal(validateRoleAssignmentInput({ roleCode: migration.ROLE_CODE, effectiveFrom: '2000-01-01' }, 91, true).scopeType, 'global');
  await withFreshMysql(async ({ pool }) => {
    for (const sql of splitSqlStatements(mdmMysqlSchemaSql())) await pool.execute(sql);
    for (const sql of splitSqlStatements(PROCESS_V7_PREVIEW_SCHEMA_SQL)) await pool.execute(sql);
    await ensureMysqlBuiltInRolesAndPermissions(pool);
    const db = await pool.getConnection();
    const one = async (sql, params = []) => (await pool.execute(sql, params))[0][0];
    try {
      await check('fresh v5 initialization can prepare predecessor tables without downgrading the role model', async () => {
        assert.equal((await responsibilities.applyResponsibilities(db)).model_version, migration.MODEL_VERSION);
        assert.equal(Number((await one('SELECT COUNT(*) n FROM roles WHERE model_version=?', [migration.MODEL_VERSION])).n), 9);
        await assert.rejects(responsibilities.compensateResponsibilities(db), { code: 'RESPONSIBILITY_COMPENSATION_BLOCKED' });
      });
      // Rebuild only the synthetic role fixture as the released v4 input.
      await pool.execute("DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id=rp.role_id WHERE r.role_code='hr_directory_manager'");
      await pool.execute("DELETE FROM roles WHERE role_code='hr_directory_manager'");
      await pool.execute("DELETE FROM permissions WHERE perm_code IN ('directory:read','directory:maintain')");
      await pool.execute('UPDATE roles SET model_version=? WHERE status=?', [migration.PREVIOUS_MODEL_VERSION, 'active']);
      await pool.execute("ALTER TABLE roles DROP CHECK chk_roles_group_v2, ADD CONSTRAINT chk_roles_group_v2 CHECK (role_group IN ('system','mdm','legacy'))");
      await pool.execute("INSERT INTO departments(id,name,code,status) VALUES(91,'Synthetic Department','SYN_DIR','active')");
      for (const id of [101, 102]) {
        await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(?,?,?,91)", [id, 'SYN_DIR_' + id, 'Synthetic ' + id]);
        await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES(?,?,?,'unusable-synthetic','active',0)", [id + 1000, id, 'SYN_DIR_' + id]);
      }
      await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,effective_from,authorization_basis) SELECT 101,role_id,'global','2000-01-01','synthetic existing grant' FROM roles WHERE role_code='mdm_lead'");
      const roleIds = (await pool.execute('SELECT CAST(role_id AS CHAR) role_id,role_code FROM roles ORDER BY role_code'))[0];
      const grantsBefore = JSON.stringify((await pool.execute('SELECT * FROM person_roles ORDER BY person_role_id'))[0]);
      await check('dry-run reads v4 without creating backup tables, modifying roles or granting people', async () => {
        const result = await migration.inspectHrDirectoryRole(db);
        assert.equal(result.ready, false); assert.deepEqual(result.drift, []); assert.deepEqual(result.missing, ['hr_directory_role_model_backups']);
        assert.equal(result.directory_group_prepared, false);
        assert.equal((await one("SELECT COUNT(*) n FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hr_directory_role_model_backups'")).n, 0);
        assert.equal(JSON.stringify((await pool.execute('SELECT * FROM person_roles ORDER BY person_role_id'))[0]), grantsBefore);
      });
      await check('unrecognized old permission changes stop before schema or model mutation', async () => {
        await pool.execute("UPDATE role_permissions rp JOIN roles r ON r.role_id=rp.role_id SET rp.effect='deny' WHERE r.role_code='mdm_lead'");
        await assert.rejects(migration.applyHrDirectoryRole(db), { code: 'HR_DIRECTORY_ROLE_SCHEMA_DRIFT' });
        assert.equal((await one("SELECT COUNT(*) n FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hr_directory_role_model_backups'")).n, 0);
        await pool.execute("UPDATE role_permissions rp JOIN roles r ON r.role_id=rp.role_id SET rp.effect='allow' WHERE r.role_code='mdm_lead'");
        await pool.execute('ALTER TABLE roles ALTER CHECK chk_roles_group_v2 NOT ENFORCED');
        await assert.rejects(migration.applyHrDirectoryRole(db), { code: 'HR_DIRECTORY_ROLE_SCHEMA_DRIFT' });
        await pool.execute('ALTER TABLE roles ALTER CHECK chk_roles_group_v2 ENFORCED');
      });
      await check('failed model transaction preserves v4 data and a retryable backup after additive DDL', async () => {
        let injected = false;
        const failing = new Proxy(db, { get(target, key) {
          if (key === 'execute') return async (sql, params) => {
            if (!injected && sql.startsWith('UPDATE roles SET model_version=')) { injected = true; throw Object.assign(new Error('synthetic write failure'), { code: 'SYNTHETIC_WRITE_FAILURE' }); }
            return target.execute(sql, params);
          };
          return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
        } });
        await assert.rejects(migration.applyHrDirectoryRole(failing), { code: 'SYNTHETIC_WRITE_FAILURE' });
        assert.equal(injected, true);
        assert.equal(Number((await one('SELECT COUNT(*) n FROM roles WHERE model_version=?', [migration.PREVIOUS_MODEL_VERSION])).n), 8);
        assert.equal((await one("SELECT status FROM hr_directory_role_model_backups WHERE migration_key=?", [migration.MIGRATION_KEY])).status, 'prepared');
        assert.equal((await one("SELECT COUNT(*) n FROM roles WHERE role_code='hr_directory_manager'")).n, 0);
        assert.equal(JSON.stringify((await pool.execute('SELECT * FROM person_roles ORDER BY person_role_id'))[0]), grantsBefore);
      });
      await check('v4 to v5 is additive, repeatable and retains every role ID, old permission set and person grant', async () => {
        assert.equal((await migration.applyHrDirectoryRole(db)).ready, true);
        assert.equal((await migration.applyHrDirectoryRole(db)).idempotent, true);
        assert.deepEqual((await pool.execute("SELECT CAST(role_id AS CHAR) role_id,role_code FROM roles WHERE role_code<>'hr_directory_manager' ORDER BY role_code"))[0], roleIds);
        assert.equal(JSON.stringify((await pool.execute('SELECT * FROM person_roles ORDER BY person_role_id'))[0]), grantsBefore);
        const snapshot = JSON.parse((await one('SELECT snapshot_json FROM hr_directory_role_model_backups WHERE migration_key=?', [migration.MIGRATION_KEY])).snapshot_json);
        assert.equal(snapshot.roles.length, 8);
        assert.equal(snapshot.roles.every(role => role.model_version === migration.PREVIOUS_MODEL_VERSION), true);
        assert.equal((await responsibilities.inspectResponsibilities(db)).model_version, migration.MODEL_VERSION);
      });
      await check('unused v5 model compensates idempotently and reuses its original snapshot on reapply', async () => {
        const original = (await one('SELECT snapshot_json FROM hr_directory_role_model_backups WHERE migration_key=?', [migration.MIGRATION_KEY])).snapshot_json;
        const result = await migration.compensateHrDirectoryRole(db);
        assert.equal(result.compensated, true); assert.equal(result.retained_group_constraint, true);
        assert.equal((await migration.compensateHrDirectoryRole(db)).idempotent, true);
        assert.equal((await one("SELECT status FROM roles WHERE role_code='hr_directory_manager'")).status, 'retired');
        assert.equal(Number((await one("SELECT COUNT(*) n FROM roles WHERE status='active' AND model_version=?", [migration.PREVIOUS_MODEL_VERSION])).n), 8);
        assert.equal((await migration.applyHrDirectoryRole(db)).ready, true);
        assert.equal((await one('SELECT snapshot_json FROM hr_directory_role_model_backups WHERE migration_key=?', [migration.MIGRATION_KEY])).snapshot_json, original);
      });
      await check('explicit HR grant reads only its three permissions through current identity authority', async () => {
        const access = makeGovernanceAccessMysqlRepository(pool);
        await access.grantRole(102, { roleCode: migration.ROLE_CODE, effectiveFrom: '2000-01-01', authorizationBasis: 'synthetic explicit HR assignment' });
        const identity = makeIdentityMysqlRepository(pool);
        const permissions = (await identity.getUserEffectivePermissions(102)).permSet;
        assert.deepEqual([...permissions].sort(), ['directory:maintain', 'directory:read', 'identity:read']);
        const account = await one('SELECT account_id,auth_version FROM user_accounts WHERE person_id=102');
        const authority = await readPersonAuthority(pool, { personId: 102, accountId: account.account_id, authVersion: account.auth_version }, 102);
        assert.equal(authority.valid, true); assert.equal(authority.readOnly, false);
        assert.equal(authority.roleCodes.has(migration.ROLE_CODE), true);
        assert.equal(authority.permissions.has('governance:publish'), false);
        assert.equal(authority.permissions.has('identity:manage-account'), false);
        assert.equal(authority.permissions.has('identity:assign-role'), false);
        await assert.rejects(migration.compensateHrDirectoryRole(db), { code: 'HR_DIRECTORY_ROLE_COMPENSATION_BLOCKED' });
        await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='revoked' WHERE r.role_code='hr_directory_manager'");
        await assert.rejects(migration.compensateHrDirectoryRole(db), { code: 'HR_DIRECTORY_ROLE_COMPENSATION_BLOCKED' });
      });
    } finally { db.release(); }
  });
  console.log(JSON.stringify({ ok: true, isolated: true, checks: checks.length }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
