const path = require('path');
const { spawnSync } = require('child_process');
const { syncOrganizationStructure } = require('./sync-organization-structure');

const APP_ROOT = path.join(__dirname, '..');

function assertAdminEnv(env = process.env) {
  const missing = [];
  if (!env.MDM_ADMIN_EMPLOYEE_NO) missing.push('MDM_ADMIN_EMPLOYEE_NO');
  if (!env.MDM_ADMIN_PASSWORD) missing.push('MDM_ADMIN_PASSWORD');
  if (missing.length > 0) {
    throw new Error(`缺少管理员环境变量：${missing.join(', ')}`);
  }
  if (env.MDM_ADMIN_PASSWORD.length < 12) {
    throw new Error('MDM_ADMIN_PASSWORD must be at least 12 characters.');
  }
}

function runExistingScript(scriptName, env = process.env) {
  const result = spawnSync(process.execPath, [path.join('scripts', scriptName)], {
    cwd: APP_ROOT,
    env,
    stdio: 'inherit'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${scriptName} failed with exit code ${result.status}`);
  }
}

function ensureAdminRbac(database, employeeNo) {
  const adminUser = database.prepare('SELECT id, role FROM users WHERE employee_no=?').get(employeeNo);
  if (!adminUser) {
    throw new Error(`管理员账号未创建：${employeeNo}`);
  }
  if (adminUser.role !== 'admin') {
    throw new Error(`工号 ${employeeNo} 已存在但不是管理员账号`);
  }

  const adminRole = database.prepare("SELECT role_id FROM roles WHERE role_code='admin'").get();
  if (!adminRole) throw new Error('缺少 admin / 管理员角色');

  database.prepare(`
    INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by)
    VALUES (?, ?, ?)
  `).run(adminUser.id, adminRole.role_id, adminUser.id);

  return { userId: adminUser.id, roleCode: 'admin' };
}

function tableCount(database, tableName, where = '1=1') {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE ${where}`).get().count;
}

function setupLocalBaseline(env = process.env) {
  if (env.MDM_ALLOW_LEGACY_TEST_MODE !== '1') {
    throw new Error('LEGACY_ACCOUNT_SCRIPT_RETIRED：SQLite账号基线仅允许在隔离测试模式使用。');
  }
  assertAdminEnv(env);

  runExistingScript('init-db.js', env);

  const db = require('../server/db');
  const organization = syncOrganizationStructure({ db });
  const adminRbac = ensureAdminRbac(db, env.MDM_ADMIN_EMPLOYEE_NO);
  const counts = {
    org_unit: tableCount(db, 'org_unit'),
    active_org_unit: tableCount(db, 'org_unit', "status='active'"),
    position: tableCount(db, 'position'),
    active_position: tableCount(db, 'position', "status='active'"),
    person: tableCount(db, 'person'),
    active_person: tableCount(db, 'person', "status='active'"),
    users: tableCount(db, 'users'),
    roles: tableCount(db, 'roles'),
    user_roles: tableCount(db, 'user_roles')
  };

  return {
    dbPath: db.__dbPath,
    organization,
    adminRbac,
    counts
  };
}

function main() {
  try {
    const summary = setupLocalBaseline();
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  assertAdminEnv,
  ensureAdminRbac,
  setupLocalBaseline
};

if (require.main === module) {
  main();
}
