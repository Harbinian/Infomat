const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'platform.db'));

db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES departments(id),
  
  -- MDM: Hierarchy Optimization
  path TEXT,
  sort_order INTEGER DEFAULT 0,
  
  -- MDM: Stewardship & Type
  department_type TEXT CHECK(department_type IN ('职能','业务','生产','其他')),
  manager_user_id INTEGER REFERENCES users(id),
  data_owner_user_id INTEGER REFERENCES users(id),
  
  -- MDM: Lineage & Cross-Reference
  source_system TEXT DEFAULT 'MDM_SYS',
  external_id TEXT,
  
  -- MDM: Lifecycle & Time-Variant (SCD Type 2)
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','archived')),
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  
  -- MDM: Audit Trail
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  employee_no TEXT NOT NULL UNIQUE,
  department_id INTEGER REFERENCES departments(id),
  post TEXT,
  role TEXT NOT NULL DEFAULT 'submitter' CHECK(role IN ('submitter','owner','reviewer','admin')),
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_dept_roles (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, department_id)
);

CREATE TABLE IF NOT EXISTS systems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dept_id INTEGER REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS capabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('L1','L2','L3')),
  owner_dept_id INTEGER REFERENCES departments(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  approval_opinion TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_by INTEGER REFERENCES users(id),
  approved_at DATETIME
);

CREATE TABLE IF NOT EXISTS processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  capability_id INTEGER REFERENCES capabilities(id),
  owner_dept_id INTEGER REFERENCES departments(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  approval_opinion TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_by INTEGER REFERENCES users(id),
  approved_at DATETIME
);

CREATE TABLE IF NOT EXISTS mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_id INTEGER NOT NULL REFERENCES processes(id) ON DELETE RESTRICT,
  description TEXT,
  approval_dept_id INTEGER REFERENCES departments(id),
  owner_dept_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','dept_reviewed','cross_confirmed','fields_confirmed','final_reviewed','published')),
  submitted_by INTEGER REFERENCES users(id),
  submitted_at DATETIME,
  current_step INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mapping_related_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL REFERENCES mappings(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK(relation IN ('owner','consumer','collaborator')),
  UNIQUE(mapping_id, department_id, relation)
);

CREATE TABLE IF NOT EXISTS mapping_systems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL REFERENCES mappings(id) ON DELETE CASCADE,
  system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE RESTRICT,
  system_role TEXT NOT NULL CHECK(system_role IN ('primary','secondary')),
  sort_order INTEGER NOT NULL DEFAULT 1,
  UNIQUE(mapping_id, system_id, system_role)
);

CREATE TABLE IF NOT EXISTS approval_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL REFERENCES mappings(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  assignee_user_id INTEGER REFERENCES users(id),
  assigned_dept_id INTEGER REFERENCES departments(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','approved','rejected','blocked')),
  opinion TEXT,
  reject_count INTEGER NOT NULL DEFAULT 0,
  operated_by INTEGER REFERENCES users(id),
  operated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL REFERENCES mappings(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  operator_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('submit','approve','reject','auto_conflict')),
  opinion TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS field_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL REFERENCES mappings(id) ON DELETE CASCADE,
  field_name_cn TEXT,
  field_name_en TEXT,
  data_object TEXT,
  field_type TEXT CHECK(field_type IN ('文本','编码','日期','枚举','附件','JSON')),
  consume_systems TEXT,
  sync_mode TEXT CHECK(sync_mode IN ('实时','批量','人工导入','事件触发')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','confirmed','conflicted')),
  submitted_by INTEGER REFERENCES users(id),
  submitted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS field_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_entry_id INTEGER NOT NULL UNIQUE REFERENCES field_entries(id) ON DELETE CASCADE,
  candidate_systems TEXT,
  authoritative_system TEXT,
  maintain_dept_id INTEGER REFERENCES departments(id),
  owner_user_id INTEGER REFERENCES users(id),
  confirmed INTEGER NOT NULL DEFAULT 0,
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_at DATETIME,
  note TEXT
);

CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL UNIQUE,
  definition TEXT,
  scope TEXT,
  forbidden TEXT,
  process_id INTEGER REFERENCES processes(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_by INTEGER REFERENCES users(id),
  approved_at DATETIME
);

CREATE TABLE IF NOT EXISTS term_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  dept_a INTEGER REFERENCES departments(id),
  dept_a_meaning TEXT,
  dept_b INTEGER REFERENCES departments(id),
  dept_b_meaning TEXT,
  severity TEXT NOT NULL CHECK(severity IN ('warn','error')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','rejected')),
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS field_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_entry_a_id INTEGER NOT NULL REFERENCES field_entries(id) ON DELETE CASCADE,
  field_entry_b_id INTEGER NOT NULL REFERENCES field_entries(id) ON DELETE CASCADE,
  conflict_field TEXT NOT NULL CHECK(conflict_field IN ('authoritative_system','note','field_type','sync_mode','consume_systems','other')),
  submitter_a INTEGER REFERENCES users(id),
  value_a TEXT,
  submitter_b INTEGER REFERENCES users(id),
  value_b TEXT,
  dept_a INTEGER REFERENCES departments(id),
  dept_b INTEGER REFERENCES departments(id),
  severity TEXT NOT NULL CHECK(severity IN ('warn','error')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','rejected')),
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_dept_id INTEGER REFERENCES departments(id),
  to_dept_id INTEGER REFERENCES departments(id),
  type TEXT NOT NULL CHECK(type IN ('field_confirm','gold_source','terminology','general','conflict_resolution')),
  related_mapping_id INTEGER REFERENCES mappings(id) ON DELETE SET NULL,
  related_field_id INTEGER REFERENCES field_entries(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'medium' CHECK(urgency IN ('high','medium','low')),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','overdue')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  done_at DATETIME
);

CREATE TABLE IF NOT EXISTS change_set (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  operated_by INTEGER REFERENCES users(id),
  operated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  description TEXT
);

CREATE TABLE IF NOT EXISTS version_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')),
  operated_by INTEGER REFERENCES users(id),
  operated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  change_set_id INTEGER REFERENCES change_set(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS field_rejection_reasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER NOT NULL REFERENCES mappings(id) ON DELETE CASCADE,
  field_entry_id INTEGER NOT NULL REFERENCES field_entries(id) ON DELETE CASCADE,
  rejection_reason TEXT NOT NULL,
  rejected_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conflict_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conflict_id INTEGER NOT NULL,
  conflict_type TEXT NOT NULL CHECK(conflict_type IN ('field','term')),
  assignee_user_id INTEGER REFERENCES users(id),
  assigned_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conflict_coordination_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conflict_id INTEGER NOT NULL,
  conflict_type TEXT NOT NULL CHECK(conflict_type IN ('field','term')),
  assignee_user_id INTEGER REFERENCES users(id),
  result TEXT NOT NULL CHECK(result IN ('A','B','compromise')),
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Migration: update field_conflicts status to support new states
const fcInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='field_conflicts'").get();
if (fcInfo && !fcInfo.sql.includes("'archived'")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE field_conflicts_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field_entry_a_id INTEGER NOT NULL REFERENCES field_entries(id) ON DELETE CASCADE,
        field_entry_b_id INTEGER NOT NULL REFERENCES field_entries(id) ON DELETE CASCADE,
        conflict_field TEXT NOT NULL CHECK(conflict_field IN ('authoritative_system','note','field_type','sync_mode','consume_systems','other')),
        submitter_a INTEGER REFERENCES users(id),
        value_a TEXT,
        submitter_b INTEGER REFERENCES users(id),
        value_b TEXT,
        dept_a INTEGER REFERENCES departments(id),
        dept_b INTEGER REFERENCES departments(id),
        severity TEXT NOT NULL CHECK(severity IN ('blocking','high','medium','low','warn','error')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','coordinating','resolved','rejected','archived')),
        resolution TEXT,
        resolved_by INTEGER REFERENCES users(id),
        resolved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO field_conflicts_new SELECT * FROM field_conflicts;
      DROP TABLE field_conflicts;
      ALTER TABLE field_conflicts_new RENAME TO field_conflicts;
    `);
  })();
}

// Same for term_conflicts
const tcInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='term_conflicts'").get();
if (tcInfo && !tcInfo.sql.includes("'archived'")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE term_conflicts_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term TEXT NOT NULL,
        dept_a INTEGER REFERENCES departments(id),
        dept_a_meaning TEXT,
        dept_b INTEGER REFERENCES departments(id),
        dept_b_meaning TEXT,
        severity TEXT NOT NULL CHECK(severity IN ('blocking','high','medium','low','warn','error')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','coordinating','resolved','rejected','archived')),
        resolution TEXT,
        resolved_by INTEGER REFERENCES users(id),
        resolved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO term_conflicts_new SELECT * FROM term_conflicts;
      DROP TABLE term_conflicts;
      ALTER TABLE term_conflicts_new RENAME TO term_conflicts;
    `);
  })();
}

// Migration: add parent_id to capabilities for L1→L2→L3 hierarchy
const capInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='capabilities'").get();
if (capInfo && !capInfo.sql.includes('parent_id')) {
  db.exec('ALTER TABLE capabilities ADD COLUMN parent_id INTEGER REFERENCES capabilities(id)');
  console.log('Migration: added parent_id to capabilities');
}

// ── MDM v2: Domain-Specific Data Model (per spec 2026-05-18) ──

// Encoding sequence table
db.exec(`
CREATE TABLE IF NOT EXISTS code_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  scope_key TEXT NOT NULL DEFAULT '',
  next_seq INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, scope_key)
);
`);

// 4.1 org_unit
db.exec(`
CREATE TABLE IF NOT EXISTS org_unit (
  org_unit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_unit_code TEXT NOT NULL UNIQUE,
  org_unit_name TEXT NOT NULL,
  org_type TEXT NOT NULL CHECK(org_type IN ('company','department','office','team')),
  org_mnemonic TEXT NOT NULL UNIQUE,
  parent_org_unit_id INTEGER REFERENCES org_unit(org_unit_id),
  manager_person_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','inactive')),
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.2 position
db.exec(`
CREATE TABLE IF NOT EXISTS position (
  position_id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_code TEXT NOT NULL UNIQUE,
  position_name TEXT NOT NULL,
  pos_mnemonic TEXT NOT NULL,
  org_unit_id INTEGER NOT NULL REFERENCES org_unit(org_unit_id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','inactive')),
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(org_unit_id, pos_mnemonic)
);
`);

// 4.3 person
db.exec(`
CREATE TABLE IF NOT EXISTS person (
  person_id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_no TEXT NOT NULL UNIQUE,
  person_name TEXT NOT NULL,
  mobile TEXT,
  email TEXT,
  employment_status TEXT NOT NULL DEFAULT 'active' CHECK(employment_status IN ('active','leave','suspended')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','inactive')),
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.4 person_position_assignment
db.exec(`
CREATE TABLE IF NOT EXISTS person_position_assignment (
  assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES person(person_id),
  position_id INTEGER NOT NULL REFERENCES position(position_id),
  is_primary INTEGER NOT NULL DEFAULT 0,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.5 product_family
db.exec(`
CREATE TABLE IF NOT EXISTS product_family (
  product_family_id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_family_code TEXT NOT NULL UNIQUE,
  model_name TEXT NOT NULL,
  model_code TEXT NOT NULL,
  class_major TEXT NOT NULL,
  product_type TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','inactive')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(model_code, class_major)
);
`);

// 4.6 product (versioned)
db.exec(`
CREATE TABLE IF NOT EXISTS product (
  product_id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL UNIQUE,
  product_family_id INTEGER NOT NULL REFERENCES product_family(product_family_id),
  revision TEXT,
  class_mid TEXT,
  class_minor TEXT,
  lifecycle_state TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle_state IN ('draft','released','obsolete')),
  superseded_by_product_id INTEGER REFERENCES product(product_id),
  effective_from DATE,
  effective_to DATE,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.7 class_node
db.exec(`
CREATE TABLE IF NOT EXISTS class_node (
  class_node_id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_code TEXT NOT NULL UNIQUE,
  class_name TEXT NOT NULL,
  class_type TEXT NOT NULL CHECK(class_type IN ('product','material','common')),
  parent_class_node_id INTEGER REFERENCES class_node(class_node_id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.8 entity_class_membership
db.exec(`
CREATE TABLE IF NOT EXISTS entity_class_membership (
  membership_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('product','product_family')),
  entity_id INTEGER NOT NULL,
  class_node_id INTEGER NOT NULL REFERENCES class_node(class_node_id),
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, class_node_id)
);
`);

// 4.9 attribute_def
db.exec(`
CREATE TABLE IF NOT EXISTS attribute_def (
  attribute_def_id INTEGER PRIMARY KEY AUTOINCREMENT,
  attribute_code TEXT NOT NULL UNIQUE,
  attribute_name TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK(data_type IN ('string','number','date','boolean','enum','json')),
  enum_ref TEXT,
  applies_to TEXT NOT NULL CHECK(applies_to IN ('product','product_family','common')),
  is_required INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.10 attribute_value
db.exec(`
CREATE TABLE IF NOT EXISTS attribute_value (
  attribute_value_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('product','product_family')),
  entity_id INTEGER NOT NULL,
  attribute_def_id INTEGER NOT NULL REFERENCES attribute_def(attribute_def_id),
  value_string TEXT,
  value_number REAL,
  value_date TEXT,
  value_bool INTEGER,
  value_json TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, attribute_def_id)
);
`);

// 4.11 external_system
db.exec(`
CREATE TABLE IF NOT EXISTS external_system (
  system_id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_code TEXT NOT NULL UNIQUE,
  system_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// 4.12 external_identity
db.exec(`
CREATE TABLE IF NOT EXISTS external_identity (
  external_identity_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  system_code TEXT NOT NULL,
  external_key TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  last_sync_at DATETIME,
  last_sync_status TEXT CHECK(last_sync_status IN ('ok','failed','pending')),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, system_code),
  UNIQUE(system_code, external_key)
);
`);

// Integration: API credentials (simplified, kept for integration API)
db.exec(`
CREATE TABLE IF NOT EXISTS integration_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_name TEXT NOT NULL UNIQUE,
  api_key_hash TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '["read"]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME
);
`);

// Integration: sync log
db.exec(`
CREATE TABLE IF NOT EXISTS integration_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  params_json TEXT,
  records_returned INTEGER,
  status TEXT NOT NULL CHECK(status IN ('success','error')),
  error_reason TEXT,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Migration: add person_id FK to departments
const depInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='departments'").get();
if (depInfo && !depInfo.sql.includes('person_id')) {
  db.exec("ALTER TABLE departments ADD COLUMN person_id INTEGER");
}

// ── Module C: Permissions field on users ──
const userInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
if (userInfo && !userInfo.sql.includes('permissions')) {
  db.exec("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '{}'");
  console.log('Migration: added permissions to users');
}

console.log('MDM v2: Domain-specific tables ready (12 tables)');

// Migration: conflict management upgrade — add deadline, escalated, resolution_type
const fcCols = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='field_conflicts'").get();
if (fcCols && !fcCols.sql.includes('deadline DATE')) {
  db.exec('ALTER TABLE field_conflicts ADD COLUMN deadline DATE');
  db.exec('ALTER TABLE field_conflicts ADD COLUMN escalated INTEGER DEFAULT 0');
  db.exec('ALTER TABLE field_conflicts ADD COLUMN resolution_type TEXT');
  console.log('Migration: added deadline/escalated/resolution_type to field_conflicts');
}
const tcCols = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='term_conflicts'").get();
if (tcCols && !tcCols.sql.includes('deadline DATE')) {
  db.exec('ALTER TABLE term_conflicts ADD COLUMN deadline DATE');
  db.exec('ALTER TABLE term_conflicts ADD COLUMN escalated INTEGER DEFAULT 0');
  db.exec('ALTER TABLE term_conflicts ADD COLUMN resolution_type TEXT');
  console.log('Migration: added deadline/escalated/resolution_type to term_conflicts');
}

// Migration: update field_conflicts CHECK to include silenced/escalated
const fcSql2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='field_conflicts'").get();
if (fcSql2 && !fcSql2.sql.includes("'silenced'")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE field_conflicts_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field_entry_a_id INTEGER NOT NULL REFERENCES field_entries(id) ON DELETE CASCADE,
        field_entry_b_id INTEGER NOT NULL REFERENCES field_entries(id) ON DELETE CASCADE,
        conflict_field TEXT NOT NULL CHECK(conflict_field IN ('authoritative_system','note','field_type','sync_mode','consume_systems','other')),
        submitter_a INTEGER REFERENCES users(id),
        value_a TEXT,
        submitter_b INTEGER REFERENCES users(id),
        value_b TEXT,
        dept_a INTEGER REFERENCES departments(id),
        dept_b INTEGER REFERENCES departments(id),
        severity TEXT NOT NULL CHECK(severity IN ('blocking','high','medium','low','warn','error')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','silenced','coordinating','escalated','resolved','rejected','archived')),
        resolution TEXT,
        resolved_by INTEGER REFERENCES users(id),
        resolved_at DATETIME,
        deadline DATE,
        escalated INTEGER DEFAULT 0,
        resolution_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO field_conflicts_v2 SELECT id, field_entry_a_id, field_entry_b_id, conflict_field,
        submitter_a, value_a, submitter_b, value_b, dept_a, dept_b, severity, status,
        resolution, resolved_by, resolved_at, deadline, escalated, resolution_type, created_at
        FROM field_conflicts;
      DROP TABLE field_conflicts;
      ALTER TABLE field_conflicts_v2 RENAME TO field_conflicts;
    `);
  })();
  console.log('Migration: added silenced/escalated to field_conflicts CHECK');
}

// Migration: update term_conflicts CHECK to include silenced/escalated
const tcSql2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='term_conflicts'").get();
if (tcSql2 && !tcSql2.sql.includes("'silenced'")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE term_conflicts_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term TEXT NOT NULL,
        dept_a INTEGER REFERENCES departments(id),
        dept_a_meaning TEXT,
        dept_b INTEGER REFERENCES departments(id),
        dept_b_meaning TEXT,
        severity TEXT NOT NULL CHECK(severity IN ('blocking','high','medium','low','warn','error')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','silenced','coordinating','escalated','resolved','rejected','archived')),
        resolution TEXT,
        resolved_by INTEGER REFERENCES users(id),
        resolved_at DATETIME,
        deadline DATE,
        escalated INTEGER DEFAULT 0,
        resolution_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO term_conflicts_v2 SELECT id, term, dept_a, dept_a_meaning, dept_b, dept_b_meaning,
        severity, status, resolution, resolved_by, resolved_at,
        deadline, escalated, resolution_type, created_at
        FROM term_conflicts;
      DROP TABLE term_conflicts;
      ALTER TABLE term_conflicts_v2 RENAME TO term_conflicts;
    `);
  })();
  console.log('Migration: added silenced/escalated to term_conflicts CHECK');
}

module.exports = db;
