// Office layer reuses org_unit. No historical office/person assignment is inferred.
const MIGRATION_KEY = '2026-09-15-office-management-v1';
const OFFICE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS org_unit (
  org_unit_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_unit_code VARCHAR(128) NOT NULL,
  org_unit_name VARCHAR(255) NOT NULL,
  org_type VARCHAR(64) NULL,
  org_mnemonic VARCHAR(64) NULL,
  parent_org_unit_id BIGINT NULL,
  manager_person_id BIGINT NULL,
  department_id BIGINT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_unit_code (org_unit_code),
  INDEX idx_org_unit_parent (parent_org_unit_id),
  INDEX idx_org_unit_status (status),
  INDEX idx_org_unit_department (department_id),
  CHECK (status IN ('active','inactive','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS office_membership (
  office_id BIGINT NOT NULL,
  person_id BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_by_person_id BIGINT NULL,
  updated_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id, person_id),
  INDEX idx_office_membership_person (person_id, status),
  CONSTRAINT fk_office_membership_office FOREIGN KEY (office_id) REFERENCES org_unit(org_unit_id),
  CONSTRAINT fk_office_membership_person FOREIGN KEY (person_id) REFERENCES person(person_id),
  CHECK (status IN ('active','inactive'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_todo_office_assignments (
  todo_id BIGINT NOT NULL PRIMARY KEY,
  office_id BIGINT NOT NULL,
  assignee_person_id BIGINT NULL,
  process_version_id BIGINT NULL,
  behavior_ref VARCHAR(128) NULL,
  request_id CHAR(36) NULL,
  revision_no INT NOT NULL DEFAULT 1,
  assigned_by_person_id BIGINT NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_office_assignment_queue (office_id, assignee_person_id),
  INDEX fk_office_assignment_person (assignee_person_id),
  INDEX fk_office_assignment_version (process_version_id),
  UNIQUE KEY uq_office_task_request (request_id),
  CONSTRAINT fk_office_assignment_todo FOREIGN KEY (todo_id) REFERENCES mdm_todos(id),
  CONSTRAINT fk_office_assignment_office FOREIGN KEY (office_id) REFERENCES org_unit(org_unit_id),
  CONSTRAINT fk_office_assignment_person FOREIGN KEY (assignee_person_id) REFERENCES person(person_id),
  CONSTRAINT fk_office_assignment_version FOREIGN KEY (process_version_id) REFERENCES process_design_versions(id),
  CHECK (revision_no > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

function officeSchemaStatements() { return OFFICE_SCHEMA_SQL.split(';').map(sql => sql.trim()).filter(Boolean); }

async function inspectOfficeSchema(db) {
  const [columns] = await db.query("SELECT table_name,column_name,column_type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name IN ('org_unit','office_membership','mdm_todo_office_assignments')");
  const present = new Map();
  for (const column of columns) {
    const table = column.TABLE_NAME || column.table_name;
    if (!present.has(table)) present.set(table, new Map());
    present.get(table).set(column.COLUMN_NAME || column.column_name, column.COLUMN_TYPE || column.column_type);
  }
  const plans = [];
  const drift = [];
  const { compareCreateStatements } = require('./processV7M0Baseline');
  for (const sql of officeSchemaStatements()) {
    const table = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    if (!present.has(table)) { plans.push({ table, action: 'create', sql }); continue; }
    const [ddl] = await db.query('SHOW CREATE TABLE `' + table + '`');
    const actual = ddl[0]['Create Table'];
    if (table === 'org_unit') {
      const required = ['org_unit_id','org_unit_code','org_unit_name','org_type','parent_org_unit_id','manager_person_id','status','created_by','updated_by','created_at','updated_at'];
      if (required.some(name => !present.get(table).has(name)) || !/ENGINE=InnoDB/i.test(actual)) drift.push(table);
      else if (!present.get(table).has('department_id')) plans.push({ table, action: 'add_department', sql: 'ALTER TABLE org_unit ADD COLUMN department_id BIGINT NULL, ADD INDEX idx_org_unit_department (department_id)' });
      else if (present.get(table).get('department_id') !== 'bigint') drift.push(table + '.department_id');
    } else if (!compareCreateStatements(sql, actual).matching || !/ENGINE=InnoDB/i.test(actual)) drift.push(table);
  }
  return { ready: plans.length === 0 && drift.length === 0, changes: plans.map(({sql, ...item}) => item), drift, statements: plans.map(item => item.sql) };
}

async function manageOfficeSchema(db, action) {
  const before = await inspectOfficeSchema(db);
  if (action === 'inspect') { const {statements, ...result} = before; return result; }
  if (action !== 'apply') throw new Error('OFFICE_MIGRATION_ACTION_INVALID');
  if (before.drift.length) throw new Error('OFFICE_SCHEMA_DRIFT');
  for (const sql of before.statements) await db.execute(sql);
  const after = await inspectOfficeSchema(db);
  if (!after.ready) throw new Error('OFFICE_SCHEMA_VERIFICATION_FAILED');
  await db.execute('INSERT IGNORE INTO schema_migrations (migration_key) VALUES (?)', [MIGRATION_KEY]);
  const {statements, ...result} = after;
  return result;
}

module.exports = { MIGRATION_KEY, OFFICE_SCHEMA_SQL, officeSchemaStatements, inspectOfficeSchema, manageOfficeSchema };
