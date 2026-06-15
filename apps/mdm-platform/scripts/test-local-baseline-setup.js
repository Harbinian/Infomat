const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const {
  ORGANIZATION_STRUCTURE_UNITS,
  LEADERSHIP_OFFICE_ASSIGNMENTS
} = require('./sync-organization-structure');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-local-baseline-'));
const dbPath = path.join(tempDir, 'baseline.db');
const adminEmployeeNo = `BASELINE-${process.pid}`;
const adminPassword = ['local', 'baseline', 'admin', String(Date.now())].join('-');

try {
  const result = spawnSync(process.execPath, ['scripts/setup-local-baseline.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      MDM_DB_PATH: dbPath,
      MDM_DB_QUIET: '1',
      MDM_ADMIN_EMPLOYEE_NO: adminEmployeeNo,
      MDM_ADMIN_PASSWORD: adminPassword,
      MDM_ADMIN_NAME: '本地基线管理员'
    },
    encoding: 'utf8'
  });

  assert.strictEqual(result.status, 0, `setup-local-baseline failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);

  const secondRun = spawnSync(process.execPath, ['scripts/setup-local-baseline.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      MDM_DB_PATH: dbPath,
      MDM_DB_QUIET: '1',
      MDM_ADMIN_EMPLOYEE_NO: adminEmployeeNo,
      MDM_ADMIN_PASSWORD: adminPassword,
      MDM_ADMIN_NAME: '本地基线管理员'
    },
    encoding: 'utf8'
  });

  assert.strictEqual(secondRun.status, 0, `setup-local-baseline is not idempotent:\nSTDOUT:\n${secondRun.stdout}\nSTDERR:\n${secondRun.stderr}`);

  const db = new Database(dbPath, { readonly: true });
  const count = (table, where = '1=1') => db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get().count;
  const roleCodes = db.prepare('SELECT role_code FROM roles ORDER BY role_code').all().map(row => row.role_code);
  const admin = db.prepare('SELECT id, role FROM users WHERE employee_no=?').get(adminEmployeeNo);
  const adminRbac = db.prepare(`
    SELECT r.role_code
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.role_id
    WHERE ur.user_id=?
  `).all(admin.id).map(row => row.role_code);

  assert.strictEqual(count('org_unit', "status='active'"), ORGANIZATION_STRUCTURE_UNITS.length);
  assert.strictEqual(count('position', "status='active'"), LEADERSHIP_OFFICE_ASSIGNMENTS.length);
  assert.strictEqual(count('person', "status='active'"), LEADERSHIP_OFFICE_ASSIGNMENTS.length);
  assert.ok(roleCodes.includes('admin'), 'admin role should exist');
  assert.ok(roleCodes.includes('submitter'), 'submitter role should exist');
  assert.ok(roleCodes.includes('it_lead'), 'project roles should be seeded');
  assert.strictEqual(admin.role, 'admin');
  assert.deepStrictEqual(adminRbac, ['admin']);
  db.close();

  console.log('Local baseline setup test passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
