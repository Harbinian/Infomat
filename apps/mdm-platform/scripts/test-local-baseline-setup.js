const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  ORGANIZATION_STRUCTURE_UNITS,
  LEADERSHIP_OFFICE_ASSIGNMENTS
} = require('./sync-organization-structure');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-local-baseline-'));
const dbPath = path.join(tempDir, 'baseline.db');
const adminEmployeeNo = `BASELINE-${process.pid}`;
const adminPassword = ['local', 'baseline', 'admin', String(Date.now())].join('-');

try {
  const rejected = spawnSync(process.execPath, ['scripts/init-legacy-sqlite-db.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      MDM_DB_PATH: dbPath,
      MDM_DB_QUIET: '1',
      MDM_ADMIN_EMPLOYEE_NO: adminEmployeeNo,
      MDM_ADMIN_PASSWORD: adminPassword
    },
    encoding: 'utf8'
  });
  assert.notStrictEqual(rejected.status, 0, 'legacy SQLite initializer must require explicit test mode');
  assert.match(rejected.stderr, /LEGACY_ACCOUNT_SCRIPT_RETIRED/);
  assert.ok(!fs.existsSync(dbPath), 'rejected legacy initialization must not create a database');

  const result = spawnSync(process.execPath, ['scripts/setup-local-baseline.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      MDM_DB_PATH: dbPath,
      MDM_DB_QUIET: '1',
      MDM_ALLOW_LEGACY_TEST_MODE: '1',
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
      MDM_ALLOW_LEGACY_TEST_MODE: '1',
      MDM_ADMIN_EMPLOYEE_NO: adminEmployeeNo,
      MDM_ADMIN_PASSWORD: adminPassword,
      MDM_ADMIN_NAME: '本地基线管理员'
    },
    encoding: 'utf8'
  });

  assert.strictEqual(secondRun.status, 0, `setup-local-baseline is not idempotent:\nSTDOUT:\n${secondRun.stdout}\nSTDERR:\n${secondRun.stderr}`);

  const inspection = spawnSync(process.execPath, ['-e', `
    const Database = require('better-sqlite3');
    const db = new Database(process.argv[1], { readonly: true });
    const count = (table, where = '1=1') => db.prepare(
      'SELECT COUNT(*) AS count FROM ' + table + ' WHERE ' + where
    ).get().count;
    const roleCodes = db.prepare('SELECT role_code FROM roles ORDER BY role_code').all().map(row => row.role_code);
    const admin = db.prepare('SELECT id, role FROM users WHERE employee_no=?').get(process.argv[2]);
    const adminRbac = db.prepare(\`
      SELECT r.role_code
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.role_id
      WHERE ur.user_id=?
    \`).all(admin.id).map(row => row.role_code);
    console.log(JSON.stringify({
      activeOrgUnits: count('org_unit', "status='active'"),
      activePositions: count('position', "status='active'"),
      activePeople: count('person', "status='active'"),
      roleCodes,
      adminRole: admin.role,
      adminRbac
    }));
    db.close();
  `, dbPath, adminEmployeeNo], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });
  assert.strictEqual(inspection.status, 0, inspection.stderr || inspection.stdout);
  const summary = JSON.parse(inspection.stdout);

  assert.strictEqual(summary.activeOrgUnits, ORGANIZATION_STRUCTURE_UNITS.length);
  assert.strictEqual(summary.activePositions, LEADERSHIP_OFFICE_ASSIGNMENTS.length);
  assert.strictEqual(summary.activePeople, LEADERSHIP_OFFICE_ASSIGNMENTS.length);
  assert.ok(summary.roleCodes.includes('admin'), 'admin role should exist');
  assert.ok(summary.roleCodes.includes('submitter'), 'submitter role should exist');
  assert.ok(summary.roleCodes.includes('mdm_lead'), 'current MDM roles should be seeded');
  assert.ok(!summary.roleCodes.includes('it_lead'), 'fresh baseline must not recreate the retired it_lead role');
  assert.strictEqual(summary.adminRole, 'admin');
  assert.deepStrictEqual(summary.adminRbac, ['admin']);

  console.log('Local baseline setup test passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
