const db = require('../server/db');
const { verifyPassword } = require('../server/auth');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

const tables = [
  'departments',
  'users',
  'user_dept_roles',
  'systems',
  'capabilities',
  'processes',
  'mappings',
  'mapping_related_departments',
  'mapping_systems',
  'approval_tasks',
  'approval_history',
  'field_entries',
  'field_identities',
  'terms',
  'term_conflicts',
  'field_conflicts',
  'todos',
  'change_set',
  'version_log',
  'field_rejection_reasons',
  'conflict_assignments',
  'conflict_coordination_history'
];

tables.forEach(table => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  assert(row, `missing table ${table}`);
});

const defaultAdmin = db.prepare("SELECT password_hash FROM users WHERE employee_no='ADMIN001'").get();
if (defaultAdmin) {
  assert(!verifyPassword('admin123', defaultAdmin.password_hash), 'ADMIN001 must not use the historical default password');
}

const fk = db.prepare('PRAGMA foreign_keys').get();
assert(fk.foreign_keys === 1, 'SQLite foreign_keys pragma must be enabled');

console.log('Smoke test passed');
