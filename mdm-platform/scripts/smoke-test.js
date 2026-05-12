const db = require('../server/db');

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

const admin = db.prepare("SELECT id, role FROM users WHERE employee_no='ADMIN001'").get();
assert(admin && admin.role === 'admin', 'ADMIN001 admin account missing; run npm run init-db first');

const fk = db.prepare('PRAGMA foreign_keys').get();
assert(fk.foreign_keys === 1, 'SQLite foreign_keys pragma must be enabled');

console.log('Smoke test passed');
