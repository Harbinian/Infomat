const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');
const { testDbPath, cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { verifyPassword } = require('../server/auth');

const root = path.join(__dirname, '..');
const tempDir = path.dirname(testDbPath);

function runScript(script, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    env: {
      ...process.env,
      MDM_DB_PATH: testDbPath,
      MDM_DB_QUIET: '1',
      ...env
    },
    encoding: 'utf8'
  });
}

function extractInitialPassword(stdout) {
  const match = String(stdout || '').match(/初始密码[:：]\s*(\S+)/);
  return match ? match[1] : '';
}

function assertRandomInitialPassword(password, label) {
  assert.ok(password, `${label} should report the generated initial password`);
  assert.notStrictEqual(password, '000000', `${label} must not use 000000`);
  assert.notStrictEqual(password, 'init1234', `${label} must not use init1234`);
  assert.ok(password.length >= 12, `${label} should be long enough to avoid trivial defaults`);
}

async function writeRosterWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('users');
  sheet.addRow(['姓名', '工号', 'OA账号', '部门', '班组', '岗位']);
  sheet.addRow(['批量导入用户', 'BATCH001', 'batch001', '财务部', '财务组', '专员']);
  await workbook.xlsx.writeFile(filePath);
}

async function main() {
  const setupSource = fs.readFileSync(path.join(root, 'scripts', 'setup-mdm-project-users.js'), 'utf8');
  const importSource = fs.readFileSync(path.join(root, 'scripts', 'import-mdm-users.js'), 'utf8');
  assert.ok(!setupSource.includes('init1234'), 'project user setup must not use the historical fixed initial password');
  assert.ok(!importSource.includes('init1234'), 'MDM user import must not use the historical fixed initial password');

  const setup = runScript('scripts/setup-mdm-project-users.js', {
    ALLOW_PROJECT_USER_SETUP: 'true'
  });
  assert.strictEqual(setup.status, 0, setup.stderr || setup.stdout);
  const setupInitialPassword = extractInitialPassword(setup.stdout);
  assertRandomInitialPassword(setupInitialPassword, 'project user setup');

  const projectUsers = db.prepare("SELECT employee_no, password_hash, must_change_password FROM users WHERE employee_no <> 'ADMIN001'").all();
  assert.ok(projectUsers.length > 0, 'project user setup should create users in the isolated database');
  assert.ok(projectUsers.every(row => row.must_change_password === 1), 'project setup users should be required to change password');
  assert.ok(projectUsers.every(row => verifyPassword(setupInitialPassword, row.password_hash)), 'project setup users should use the generated initial password from this run');
  assert.ok(projectUsers.every(row => !verifyPassword('000000', row.password_hash)), 'project setup users must not use 000000');
  assert.ok(projectUsers.every(row => !verifyPassword('init1234', row.password_hash)), 'project setup users must not use init1234');

  const workbookPath = path.join(tempDir, 'mdm-users.xlsx');
  await writeRosterWorkbook(workbookPath);

  const imported = runScript('scripts/import-mdm-users.js', {
    MDM_USERS_EXCEL_PATH: workbookPath
  });
  assert.strictEqual(imported.status, 0, imported.stderr || imported.stdout);
  const importInitialPassword = extractInitialPassword(imported.stdout);
  assertRandomInitialPassword(importInitialPassword, 'Excel user import');

  const batchUser = db.prepare("SELECT password_hash, must_change_password FROM users WHERE employee_no='BATCH001'").get();
  assert.ok(batchUser, 'Excel import should create the test user');
  assert.strictEqual(batchUser.must_change_password, 1, 'Excel import users should be required to change password');
  assert.ok(verifyPassword(importInitialPassword, batchUser.password_hash), 'Excel import users should use the generated initial password from this run');
  assert.ok(!verifyPassword('000000', batchUser.password_hash), 'Excel import users must not use 000000');
  assert.ok(!verifyPassword('init1234', batchUser.password_hash), 'Excel import users must not use init1234');

  console.log('User password script test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
}).finally(() => {
  try {
    db.close();
  } finally {
    cleanupDb();
  }
});
