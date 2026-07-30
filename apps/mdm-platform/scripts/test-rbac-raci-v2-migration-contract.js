const assert = require('assert');
const fs = require('fs');
const path = require('path');

function main() {
  const migrationPath = path.join(__dirname, '../server/rbacRaciMysqlMigration.js');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const cli = fs.readFileSync(path.join(__dirname, 'migrate-rbac-raci-v2.js'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(__dirname, 'bootstrap-admin.js'), 'utf8');
  const initMysql = fs.readFileSync(path.join(__dirname, 'init-mysql-schema.js'), 'utf8');
  const identityRepository = fs.readFileSync(
    path.join(__dirname, '../server/identityMysqlRepository.js'),
    'utf8'
  );

  for (const requirement of [
    'collectRbacRaciPreflight',
    'applyRbacRaciV2Migration',
    'rollbackRbacRaciV2Migration',
    'identity_migration_batches',
    'identity_migration_account_backup',
    'identity_migration_role_backup',
    'ADMIN001',
    'ADMIN_ACCOUNT_NOT_FOUND',
    'ACTIVE_ADMIN_REQUIRED',
    'allowCompensation',
    'beginTransaction',
    'rollback',
    'pending_activation',
    'is_core',
    'auth_version=auth_version+1',
    'migration_applied'
  ]) {
    assert.ok(migration.includes(requirement), `migration must include ${requirement}`);
  }

  assert.ok(cli.includes("mode === 'apply'"));
  assert.ok(cli.includes("mode === 'rollback'"));
  assert.ok(cli.includes("mode === 'compensate'"));
  assert.ok(
    cli.includes("mode !== 'dry-run'"),
    'dry-run must inventory existing data without preparing or changing schema'
  );
  assert.ok(bootstrap.includes('BOOTSTRAP_REQUIRES_EMPTY_IDENTITY_DATABASE'));
  assert.ok(bootstrap.includes('BOOTSTRAP_ALREADY_COMPLETED'));
  assert.ok(!bootstrap.includes('password_hash:'));
  assert.ok(
    !initMysql.includes('migrateLegacyIdentityToPersonIdentity'),
    'normal schema initialization must not import or reactivate legacy users'
  );
  const initSchemaStart = identityRepository.indexOf('async initSchema()');
  const initSchemaEnd = identityRepository.indexOf(
    'async getUserByEmployeeNo',
    initSchemaStart
  );
  assert.ok(
    initSchemaStart >= 0 && initSchemaEnd > initSchemaStart,
    'identity repository initSchema block must remain detectable'
  );
  const initSchemaBlock = identityRepository.slice(initSchemaStart, initSchemaEnd);
  assert.ok(
    !initSchemaBlock.includes('migrateLegacyIdentityToPersonIdentity'),
    'runtime identity repository must not fall back to legacy users/user_roles'
  );
  assert.ok(
    migration.includes('WHERE r.role_code NOT IN'),
    'migration must retire every non-fixed role, including historical custom roles'
  );

  const roleDefinitions = fs.readFileSync(
    path.join(__dirname, '../server/roleDefinitions.js'),
    'utf8'
  );
  assert.ok(
    !roleDefinitions.includes("permSet.has('*:*')"),
    'fixed model must not accept wildcard permissions'
  );

  const packageJson = require('../package.json');
  assert.ok(packageJson.scripts['migrate:rbac-raci-v2:dry-run']);
  assert.ok(packageJson.scripts['migrate:rbac-raci-v2:apply']);
  assert.ok(packageJson.scripts['migrate:rbac-raci-v2:rollback']);
  assert.ok(packageJson.scripts['migrate:rbac-raci-v2:compensate']);
  assert.ok(packageJson.scripts['bootstrap:admin']);
  assert.ok(!packageJson.scripts['import:roster-users']);

  console.log('RBAC/RACI v2 migration and bootstrap contract test passed');
}

main();
