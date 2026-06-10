const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { testDbPath, cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');
const { FIXED_DEFAULT_PASSWORD } = require('../server/passwordPolicy');

const root = path.join(__dirname, '..');

function runAudit() {
  return spawnSync(process.execPath, ['scripts/audit-fixed-default-passwords.js', '--json'], {
    cwd: root,
    env: {
      ...process.env,
      MDM_DB_PATH: testDbPath,
      MDM_DB_QUIET: '1'
    },
    encoding: 'utf8'
  });
}

function seedUsers() {
  db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash, must_change_password)
    VALUES (?, ?, NULL, ?, ?, ?, ?)
  `).run('旧固定口令用户', 'OLD001', '专员', 'submitter', hashPassword(FIXED_DEFAULT_PASSWORD), 0);
  db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash, must_change_password)
    VALUES (?, ?, NULL, ?, ?, ?, ?)
  `).run('安全口令用户', 'SAFE001', '专员', 'submitter', hashPassword('safe-password-12345'), 0);
}

try {
  seedUsers();

  const result = runAudit();
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.dry_run, true);
  assert.strictEqual(report.fixed_default_password_count, 1);
  assert.deepStrictEqual(report.users.map(row => row.employee_no), ['OLD001']);
  assert.ok(report.users.every(row => row.password_hash === undefined), 'audit output must not expose password hashes');

  const unchanged = db.prepare("SELECT must_change_password FROM users WHERE employee_no='OLD001'").get();
  assert.strictEqual(unchanged.must_change_password, 0, 'audit script should not mutate users');

  console.log('Password audit test passed');
} finally {
  try {
    db.close();
  } finally {
    cleanupDb();
  }
}
