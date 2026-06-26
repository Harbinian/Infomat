const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { resolveDbPath } = require('./dbConfig');
const { ensureProjectRoles } = require('./roleDefinitions');

const dbPath = resolveDbPath();

const dbInitLog = (...args) => {
  if (process.env.MDM_DB_QUIET !== '1') console.log(...args);
};

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
Object.defineProperty(db, '__dbPath', { value: dbPath });

db.pragma('foreign_keys = ON');

const TERM_TYPES = [
  ['noun', '名词', '业务对象、数据对象、单据、资源等名词类术语', 10],
  ['verb', '动词', '接收、审核、发布、归档等动作行为类术语', 20],
  ['position', '岗位词', '岗位、职务、任职名称等后续需要编号的术语', 30],
  ['role', '角色词', '流程角色、项目角色、职责身份等后续需要编号的术语', 40],
  ['input', '输入词', '流程输入、数据输入、触发输入、来源材料等术语', 50],
  ['output', '输出词', '流程输出、数据输出、交付物、结果物等术语', 60],
  ['time_limit', '时效词', '时限、周期、频率、提前量、完成时点等术语', 70],
  ['status', '状态词', '流程状态、单据状态、任务状态、结果状态等术语', 80],
  ['rule', '规则词', '约束、口径、判定规则、审批规则等术语', 90],
  ['metric', '指标词', '统计指标、质量指标、绩效指标、计量口径等术语', 100],
  ['system_data', '系统数据词', '系统、字段、编码、接口、主数据对象等术语', 110]
];

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
  must_change_password INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS term_types (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL UNIQUE,
  term_type_code TEXT NOT NULL DEFAULT 'noun' REFERENCES term_types(code),
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

const upsertTermType = db.prepare(`
  INSERT INTO term_types (code, name, description, sort_order, active)
  VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(code) DO UPDATE SET
    name=excluded.name,
    description=excluded.description,
    sort_order=excluded.sort_order,
    active=1
`);
TERM_TYPES.forEach(type => upsertTermType.run(...type));

const termsInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='terms'").get();
if (termsInfo && !termsInfo.sql.includes('term_type_code')) {
  db.exec("ALTER TABLE terms ADD COLUMN term_type_code TEXT NOT NULL DEFAULT 'noun'");
  dbInitLog('Migration: added term_type_code to terms');
}

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
      INSERT INTO field_conflicts_new (
        id, field_entry_a_id, field_entry_b_id, conflict_field,
        submitter_a, value_a, submitter_b, value_b, dept_a, dept_b,
        severity, status, resolution, resolved_by, resolved_at, created_at
      )
      SELECT
        id, field_entry_a_id, field_entry_b_id, conflict_field,
        submitter_a, value_a, submitter_b, value_b, dept_a, dept_b,
        severity, status, resolution, resolved_by, resolved_at, created_at
      FROM field_conflicts;
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
      INSERT INTO term_conflicts_new (
        id, term, dept_a, dept_a_meaning, dept_b, dept_b_meaning,
        severity, status, resolution, resolved_by, resolved_at, created_at
      )
      SELECT
        id, term, dept_a, dept_a_meaning, dept_b, dept_b_meaning,
        severity, status, resolution, resolved_by, resolved_at, created_at
      FROM term_conflicts;
      DROP TABLE term_conflicts;
      ALTER TABLE term_conflicts_new RENAME TO term_conflicts;
    `);
  })();
}

// Migration: add parent_id to capabilities for L1→L2→L3 hierarchy
const capInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='capabilities'").get();
if (capInfo && !capInfo.sql.includes('parent_id')) {
  db.exec('ALTER TABLE capabilities ADD COLUMN parent_id INTEGER REFERENCES capabilities(id)');
  dbInitLog('Migration: added parent_id to capabilities');
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
  dbInitLog('Migration: added permissions to users');
}

const userColumns = db.prepare("PRAGMA table_info(users)").all().map(row => row.name);
if (!userColumns.includes('must_change_password')) {
  db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  dbInitLog('Migration: added must_change_password to users');
}

dbInitLog('MDM v2: Domain-specific tables ready (12 tables)');

// Migration: conflict management upgrade — add deadline, escalated, resolution_type
const fcCols = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='field_conflicts'").get();
if (fcCols && !fcCols.sql.includes('deadline DATE')) {
  db.exec('ALTER TABLE field_conflicts ADD COLUMN deadline DATE');
  db.exec('ALTER TABLE field_conflicts ADD COLUMN escalated INTEGER DEFAULT 0');
  db.exec('ALTER TABLE field_conflicts ADD COLUMN resolution_type TEXT');
  dbInitLog('Migration: added deadline/escalated/resolution_type to field_conflicts');
}
const tcCols = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='term_conflicts'").get();
if (tcCols && !tcCols.sql.includes('deadline DATE')) {
  db.exec('ALTER TABLE term_conflicts ADD COLUMN deadline DATE');
  db.exec('ALTER TABLE term_conflicts ADD COLUMN escalated INTEGER DEFAULT 0');
  db.exec('ALTER TABLE term_conflicts ADD COLUMN resolution_type TEXT');
  dbInitLog('Migration: added deadline/escalated/resolution_type to term_conflicts');
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
  dbInitLog('Migration: added silenced/escalated to field_conflicts CHECK');
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
  dbInitLog('Migration: added silenced/escalated to term_conflicts CHECK');
}

db.exec(`
CREATE TRIGGER IF NOT EXISTS conflict_assignments_conflict_exists_insert
BEFORE INSERT ON conflict_assignments
WHEN
  (NEW.conflict_type='field' AND NOT EXISTS (SELECT 1 FROM field_conflicts WHERE id=NEW.conflict_id))
  OR
  (NEW.conflict_type='term' AND NOT EXISTS (SELECT 1 FROM term_conflicts WHERE id=NEW.conflict_id))
BEGIN
  SELECT RAISE(ABORT, 'conflict_assignments conflict_id missing');
END;

CREATE TRIGGER IF NOT EXISTS conflict_assignments_conflict_exists_update
BEFORE UPDATE OF conflict_id, conflict_type ON conflict_assignments
WHEN
  (NEW.conflict_type='field' AND NOT EXISTS (SELECT 1 FROM field_conflicts WHERE id=NEW.conflict_id))
  OR
  (NEW.conflict_type='term' AND NOT EXISTS (SELECT 1 FROM term_conflicts WHERE id=NEW.conflict_id))
BEGIN
  SELECT RAISE(ABORT, 'conflict_assignments conflict_id missing');
END;

CREATE TRIGGER IF NOT EXISTS conflict_coordination_history_conflict_exists_insert
BEFORE INSERT ON conflict_coordination_history
WHEN
  (NEW.conflict_type='field' AND NOT EXISTS (SELECT 1 FROM field_conflicts WHERE id=NEW.conflict_id))
  OR
  (NEW.conflict_type='term' AND NOT EXISTS (SELECT 1 FROM term_conflicts WHERE id=NEW.conflict_id))
BEGIN
  SELECT RAISE(ABORT, 'conflict_coordination_history conflict_id missing');
END;

CREATE TRIGGER IF NOT EXISTS conflict_coordination_history_conflict_exists_update
BEFORE UPDATE OF conflict_id, conflict_type ON conflict_coordination_history
WHEN
  (NEW.conflict_type='field' AND NOT EXISTS (SELECT 1 FROM field_conflicts WHERE id=NEW.conflict_id))
  OR
  (NEW.conflict_type='term' AND NOT EXISTS (SELECT 1 FROM term_conflicts WHERE id=NEW.conflict_id))
BEGIN
  SELECT RAISE(ABORT, 'conflict_coordination_history conflict_id missing');
END;
`);

// ── Process Governance Snapshot Schema ──

db.exec(`
CREATE TABLE IF NOT EXISTS process_governance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_json_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  generated_at TEXT,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  imported_by INTEGER REFERENCES users(id),
  stats_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  note TEXT
);

CREATE TABLE IF NOT EXISTS process_governance_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN ('root','domain','department','l2','l3','a1','system')),
  name TEXT NOT NULL,
  domain_name TEXT,
  dept_name TEXT,
  parent_key TEXT,
  source_file TEXT,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(snapshot_id, node_key)
);

CREATE TABLE IF NOT EXISTS process_governance_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  target_key TEXT NOT NULL,
  edge_type TEXT NOT NULL CHECK(edge_type IN ('root_domain','domain_dept','dept_l2','l2_l3','l3_a1','l3_system','a1_system')),
  value REAL NOT NULL DEFAULT 1,
  source_file TEXT,
  UNIQUE(snapshot_id, source_key, target_key, edge_type)
);

CREATE TABLE IF NOT EXISTS process_a1_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  a1_code TEXT,
  dept_name TEXT,
  l3_name TEXT,
  behavior TEXT NOT NULL,
  execution_role TEXT,
  approval_type TEXT,
  input_source_dept TEXT,
  output_target_dept TEXT,
  suggested_systems TEXT,
  verification_note TEXT,
  source_file TEXT
);

CREATE TABLE IF NOT EXISTS process_cross_dept_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  source_dept TEXT,
  target_dept TEXT,
  a1_code TEXT,
  refs INTEGER DEFAULT 0,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('high','medium','low')),
  confirm_status TEXT NOT NULL DEFAULT 'pending' CHECK(confirm_status IN ('confirmed','pending','needs_review','not_mapped')),
  description TEXT,
  source_report TEXT
);

CREATE TABLE IF NOT EXISTS process_interaction_chains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('complete','partial','broken')),
  breaks_json TEXT,
  source_report TEXT
);

CREATE TABLE IF NOT EXISTS process_governance_quality_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  case_id INTEGER REFERENCES process_governance_quality_cases(id) ON DELETE SET NULL,
  severity TEXT NOT NULL CHECK(severity IN ('BLOCK','WARN','INFO')),
  area TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_line INTEGER,
  message TEXT NOT NULL,
  suggestion TEXT,
  dept_name TEXT,
  finding_key TEXT NOT NULL,
  imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(snapshot_id, finding_key)
);

CREATE TABLE IF NOT EXISTS process_governance_quality_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_key TEXT NOT NULL UNIQUE,
  first_snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT,
  latest_snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT,
  latest_finding_id INTEGER REFERENCES process_governance_quality_findings(id) ON DELETE SET NULL,
  severity TEXT NOT NULL CHECK(severity IN ('BLOCK','WARN')),
  area TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_line INTEGER,
  message TEXT NOT NULL,
  suggestion TEXT,
  dept_name TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','rectifying','submitted','source_resolved','closed','reopened')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_dept_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  due_date TEXT,
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at TEXT,
  closure_note TEXT,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_governance_quality_case_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES process_governance_quality_cases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('import_created','import_seen','source_resolved','assigned','status_changed','commented','submitted','closed','reopened')),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  payload_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_process_quality_cases_status ON process_governance_quality_cases(status);
CREATE INDEX IF NOT EXISTS idx_process_quality_cases_dept ON process_governance_quality_cases(dept_name);
CREATE INDEX IF NOT EXISTS idx_process_quality_cases_latest_snapshot ON process_governance_quality_cases(latest_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_process_quality_case_events_case ON process_governance_quality_case_events(case_id, id);

CREATE TABLE IF NOT EXISTS process_source_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,
  file_path TEXT NOT NULL,
  dept_name TEXT,
  asset_type TEXT,
  file_no TEXT,
  revision TEXT,
  size_bytes INTEGER,
  mtime TEXT,
  sha256 TEXT,
  process_status TEXT NOT NULL DEFAULT '待复核' CHECK(process_status IN ('纳入','排除','待复核')),
  process_reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(snapshot_id, file_key)
);

CREATE TABLE IF NOT EXISTS process_mdm_requirement_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  requirement_key TEXT NOT NULL,
  dept_name TEXT,
  master_data_object TEXT NOT NULL,
  source_l2 TEXT,
  key_fields TEXT,
  responsible_dept TEXT,
  system_boundary TEXT,
  governance_requirement TEXT,
  source_file TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(snapshot_id, requirement_key)
);

CREATE TABLE IF NOT EXISTS process_evidence_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  ref_key TEXT NOT NULL,
  ref_type TEXT NOT NULL CHECK(ref_type IN ('L3','A1','MDM')),
  dept_name TEXT,
  l3_name TEXT,
  a1_code TEXT,
  master_data_object TEXT,
  evidence_type TEXT,
  source_file TEXT NOT NULL,
  citation TEXT,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(snapshot_id, ref_key)
);

CREATE INDEX IF NOT EXISTS idx_process_source_files_snapshot ON process_source_files(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_process_source_files_dept ON process_source_files(dept_name);
CREATE INDEX IF NOT EXISTS idx_process_source_files_status ON process_source_files(process_status);
CREATE INDEX IF NOT EXISTS idx_process_mdm_requirement_snapshot ON process_mdm_requirement_items(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_process_mdm_requirement_dept ON process_mdm_requirement_items(dept_name);
CREATE INDEX IF NOT EXISTS idx_process_evidence_refs_snapshot ON process_evidence_refs(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_process_evidence_refs_dept ON process_evidence_refs(dept_name);
CREATE INDEX IF NOT EXISTS idx_process_evidence_refs_l3_a1 ON process_evidence_refs(l3_name, a1_code);
CREATE INDEX IF NOT EXISTS idx_process_evidence_refs_object ON process_evidence_refs(master_data_object);

CREATE TABLE IF NOT EXISTS process_mapping_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_key TEXT NOT NULL UNIQUE,
  record_type TEXT NOT NULL CHECK(record_type IN ('l3','a1')),
  first_snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT,
  latest_snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT,
  parent_record_id INTEGER REFERENCES process_mapping_records(id) ON DELETE SET NULL,
  latest_a1_item_id INTEGER REFERENCES process_a1_items(id) ON DELETE SET NULL,
  dept_name TEXT,
  domain_name TEXT,
  l2_name TEXT,
  l3_name TEXT NOT NULL,
  a1_code TEXT,
  behavior TEXT,
  execution_role TEXT,
  approval_type TEXT,
  input_source_dept TEXT,
  output_target_dept TEXT,
  suggested_systems TEXT,
  verification_note TEXT,
  source_file TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','source_missing','published','archived')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_mapping_todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  todo_key TEXT NOT NULL UNIQUE,
  mapping_record_id INTEGER REFERENCES process_mapping_records(id) ON DELETE SET NULL,
  todo_type TEXT NOT NULL CHECK(todo_type IN ('dept_confirm','verification','adjustment','cross_dept','evidence')),
  first_snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT,
  latest_snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT,
  dept_name TEXT,
  target_dept_name TEXT,
  l3_name TEXT,
  a1_code TEXT,
  source_file TEXT,
  source_line INTEGER,
  message TEXT NOT NULL,
  suggestion TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','rectifying','submitted','source_resolved','closed','reopened','accepted')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_dept_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  due_date TEXT,
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at TEXT,
  closure_note TEXT,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_mapping_todo_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  todo_id INTEGER NOT NULL REFERENCES process_mapping_todos(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('import_created','import_seen','source_resolved','assigned','status_changed','commented','submitted','closed','reopened')),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  payload_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_process_mapping_records_type ON process_mapping_records(record_type);
CREATE INDEX IF NOT EXISTS idx_process_mapping_records_dept ON process_mapping_records(dept_name);
CREATE INDEX IF NOT EXISTS idx_process_mapping_records_latest_snapshot ON process_mapping_records(latest_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_process_mapping_todos_status ON process_mapping_todos(status);
CREATE INDEX IF NOT EXISTS idx_process_mapping_todos_type ON process_mapping_todos(todo_type);
CREATE INDEX IF NOT EXISTS idx_process_mapping_todos_dept ON process_mapping_todos(dept_name);
CREATE INDEX IF NOT EXISTS idx_process_mapping_todo_events_todo ON process_mapping_todo_events(todo_id, id);

CREATE TABLE IF NOT EXISTS process_governance_issue_batches (
  batch_id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_key TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  source_snapshot_id INTEGER REFERENCES process_governance_snapshots(id) ON DELETE SET NULL,
  department_name TEXT,
  status TEXT NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','ready','failed','superseded')),
  summary_json TEXT,
  error_message TEXT,
  generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_governance_issues (
  issue_id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_key TEXT NOT NULL UNIQUE,
  batch_id INTEGER REFERENCES process_governance_issue_batches(batch_id) ON DELETE SET NULL,
  primary_dept_name TEXT NOT NULL,
  owner_dept_name TEXT,
  source_layer TEXT NOT NULL DEFAULT 'procedure' CHECK(source_layer IN ('rule','procedure','standard','form','unknown')),
  source_type TEXT NOT NULL,
  source_ref_table TEXT,
  source_ref_id TEXT,
  l1_name TEXT,
  l2_name TEXT,
  l3_name TEXT,
  a1_code TEXT,
  a1_name TEXT,
  title TEXT NOT NULL,
  what_text TEXT NOT NULL,
  why_text TEXT NOT NULL,
  where_text TEXT NOT NULL,
  who_text TEXT NOT NULL,
  when_text TEXT NOT NULL,
  how_text TEXT NOT NULL,
  how_much_text TEXT NOT NULL,
  display_status TEXT NOT NULL DEFAULT 'waiting_my_action' CHECK(display_status IN ('waiting_my_action','waiting_others','waiting_department_review','waiting_studio_review','waiting_mdm_decision','completed','closed','data_preparing','data_failed','not_in_scope','no_permission')),
  priority_score INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  closed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_governance_issue_points (
  point_id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES process_governance_issues(issue_id) ON DELETE CASCADE,
  point_key TEXT NOT NULL UNIQUE,
  point_type TEXT NOT NULL CHECK(point_type IN ('owner_role','completion_standard','controlled_transfer','cross_department','process_structure','system_landing','data_object','evidence_gap','terminology')),
  title TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  enum_options_json TEXT NOT NULL,
  selected_option TEXT,
  note TEXT,
  evidence_json TEXT,
  current_step TEXT NOT NULL DEFAULT 'business_confirm',
  point_status TEXT NOT NULL DEFAULT 'pending_business_confirm' CHECK(point_status IN ('pending_business_confirm','pending_department_review','pending_collaboration','pending_studio_review','pending_mdm_decision','needs_more_info','accepted','not_accepted','closed')),
  requires_mdm_decision INTEGER NOT NULL DEFAULT 0,
  requires_studio_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_governance_issue_participants (
  participant_id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES process_governance_issues(issue_id) ON DELETE CASCADE,
  point_id INTEGER REFERENCES process_governance_issue_points(point_id) ON DELETE CASCADE,
  participant_type TEXT NOT NULL CHECK(participant_type IN ('business_owner','department_reviewer','collaborator','studio_reviewer','mdm_decider','terminology_reviewer','observer')),
  dept_name TEXT,
  role_code TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  can_view INTEGER NOT NULL DEFAULT 1,
  can_act INTEGER NOT NULL DEFAULT 0,
  action_label TEXT,
  action_status TEXT NOT NULL DEFAULT 'waiting',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_governance_issue_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES process_governance_issues(issue_id) ON DELETE CASCADE,
  point_id INTEGER REFERENCES process_governance_issue_points(point_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('created','business_confirmed','department_reviewed','collaboration_added','collaboration_answered','studio_reviewed','mdm_decided','more_info_requested','revision_suggested','different_opinion_added','terminology_task_created','terminology_answered','terminology_decided','commented','closed','reopened')),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_dept_name TEXT,
  actor_role_code TEXT,
  note TEXT,
  payload_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_governance_term_tasks (
  term_task_id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES process_governance_issues(issue_id) ON DELETE CASCADE,
  point_id INTEGER REFERENCES process_governance_issue_points(point_id) ON DELETE SET NULL,
  term_text TEXT NOT NULL,
  context_text TEXT NOT NULL,
  selected_departments_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_departments' CHECK(status IN ('pending_departments','pending_mdm_decision','decided','closed')),
  decision_json TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_issue_batches_status_dept ON process_governance_issue_batches(status, department_name);
CREATE INDEX IF NOT EXISTS idx_issue_batches_generated_at ON process_governance_issue_batches(generated_at);
CREATE INDEX IF NOT EXISTS idx_issues_dept_status ON process_governance_issues(primary_dept_name, display_status, priority_score);
CREATE INDEX IF NOT EXISTS idx_issues_a1 ON process_governance_issues(a1_code);
CREATE INDEX IF NOT EXISTS idx_issues_updated ON process_governance_issues(updated_at);
CREATE INDEX IF NOT EXISTS idx_issue_points_issue ON process_governance_issue_points(issue_id, point_status);
CREATE INDEX IF NOT EXISTS idx_issue_points_type_status ON process_governance_issue_points(point_type, point_status);
CREATE INDEX IF NOT EXISTS idx_issue_participants_issue ON process_governance_issue_participants(issue_id, can_view, can_act);
CREATE INDEX IF NOT EXISTS idx_issue_participants_user ON process_governance_issue_participants(user_id, action_status);
CREATE INDEX IF NOT EXISTS idx_issue_participants_dept ON process_governance_issue_participants(dept_name, action_status);
CREATE INDEX IF NOT EXISTS idx_issue_events_issue ON process_governance_issue_events(issue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_issue_events_point ON process_governance_issue_events(point_id, created_at);
CREATE INDEX IF NOT EXISTS idx_term_tasks_status ON process_governance_term_tasks(status);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS process_design_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  basis_type TEXT NOT NULL,
  basis_description TEXT NOT NULL,
  involves_other_departments INTEGER NOT NULL DEFAULT 0,
  related_departments_json TEXT,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  proxy_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  proxy_reason TEXT,
  l1_name TEXT,
  l1_status TEXT NOT NULL DEFAULT 'unclassified' CHECK(l1_status IN ('unclassified','candidate','confirmed')),
  l2_name TEXT,
  l2_status TEXT NOT NULL DEFAULT 'unclassified' CHECK(l2_status IN ('unclassified','candidate','confirmed')),
  l3_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','under_review','needs_changes','approved','published','rejected')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_design_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES process_design_drafts(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  actor_role TEXT,
  timing TEXT,
  input_materials TEXT,
  output_result TEXT,
  need_confirmation INTEGER NOT NULL DEFAULT 0,
  related_departments TEXT,
  basis TEXT,
  a1_code TEXT,
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_design_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES process_design_drafts(id) ON DELETE CASCADE,
  step_id INTEGER REFERENCES process_design_steps(id) ON DELETE SET NULL,
  form_name TEXT NOT NULL,
  description TEXT,
  archive_rule TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','published','retired')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_design_form_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES process_design_forms(id) ON DELETE CASCADE,
  field_name_cn TEXT NOT NULL,
  field_name_en TEXT,
  data_object TEXT,
  field_type TEXT,
  enum_options TEXT,
  evidence_note TEXT,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested','business_confirmed','data_governed','published','retired')),
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_design_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES process_design_drafts(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL CHECK(object_type IN ('process','step','form','field')),
  object_id INTEGER,
  evidence_type TEXT NOT NULL,
  description TEXT NOT NULL,
  source_name TEXT,
  source_anchor TEXT,
  confirmer TEXT,
  record_time TEXT,
  missing_reason TEXT,
  expected_provider TEXT,
  expected_at TEXT,
  maturity TEXT NOT NULL DEFAULT '可保存草稿',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_design_risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES process_design_drafts(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_id INTEGER,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','confirmed','needs_fix','accepted','rejected')),
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at TEXT,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_design_review_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES process_design_drafts(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL DEFAULT 'department_review' CHECK(task_type IN ('department_review','capability_review','publish_review')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','needs_changes')),
  assignee_role TEXT,
  decision_note TEXT,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_design_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES process_design_drafts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  payload_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_design_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES process_design_drafts(id) ON DELETE RESTRICT,
  version_no TEXT NOT NULL UNIQUE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  l1_name TEXT NOT NULL,
  l2_name TEXT NOT NULL,
  l3_name TEXT NOT NULL,
  content_json TEXT NOT NULL,
  published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','retired'))
);

CREATE INDEX IF NOT EXISTS idx_process_design_drafts_dept ON process_design_drafts(department_id, status);
CREATE INDEX IF NOT EXISTS idx_process_design_steps_draft ON process_design_steps(draft_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_process_design_forms_draft ON process_design_forms(draft_id);
CREATE INDEX IF NOT EXISTS idx_process_design_fields_form ON process_design_form_fields(form_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_process_design_evidence_draft ON process_design_evidence(draft_id);
CREATE INDEX IF NOT EXISTS idx_process_design_review_tasks_draft ON process_design_review_tasks(draft_id, status);
CREATE INDEX IF NOT EXISTS idx_process_design_versions_draft ON process_design_versions(draft_id);
`);

function tableInfo(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function tableHasColumn(tableName, columnName) {
  return tableInfo(tableName).some(column => column.name === columnName);
}

function columnIsNotNull(tableName, columnName) {
  const column = tableInfo(tableName).find(col => col.name === columnName);
  return Boolean(column && column.notnull === 1);
}

if (!tableHasColumn('field_entries', 'process_governance_node_key')) {
  db.exec('ALTER TABLE field_entries ADD COLUMN process_governance_node_key TEXT');
  dbInitLog('Migration: added process_governance_node_key to field_entries');
}

if (!tableHasColumn('field_entries', 'process_governance_a1_code')) {
  db.exec('ALTER TABLE field_entries ADD COLUMN process_governance_a1_code TEXT');
  dbInitLog('Migration: added process_governance_a1_code to field_entries');
}

if (tableExists('process_governance_quality_findings') && !tableHasColumn('process_governance_quality_findings', 'case_id')) {
  db.exec('ALTER TABLE process_governance_quality_findings ADD COLUMN case_id INTEGER REFERENCES process_governance_quality_cases(id) ON DELETE SET NULL');
  dbInitLog('Migration: added case_id to process_governance_quality_findings');
}

if (tableExists('process_interaction_chains') && (!tableHasColumn('process_interaction_chains', 'name') || !tableHasColumn('process_interaction_chains', 'status'))) {
  const chainColumns = tableInfo('process_interaction_chains').map(column => column.name);
  const hasChainColumn = columnName => chainColumns.includes(columnName);
  const nameExpression = hasChainColumn('name')
    ? "COALESCE(NULLIF(TRIM(name), ''), " + (hasChainColumn('chain_key') ? "NULLIF(TRIM(chain_key), ''), " : '') + "'interaction-chain-' || id)"
    : (hasChainColumn('chain_key') ? "COALESCE(NULLIF(TRIM(chain_key), ''), 'interaction-chain-' || id)" : "'interaction-chain-' || id");
  const statusExpression = hasChainColumn('status')
    ? "CASE WHEN status IN ('complete','partial','broken') THEN status ELSE 'partial' END"
    : "'partial'";
  const breaksExpression = hasChainColumn('breaks_json') ? 'breaks_json' : 'NULL';
  const sourceReportExpression = hasChainColumn('source_report') ? 'source_report' : 'NULL';

  db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS process_interaction_chains_migration;
      CREATE TABLE process_interaction_chains_migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('complete','partial','broken')),
        breaks_json TEXT,
        source_report TEXT
      );
      INSERT INTO process_interaction_chains_migration (id, snapshot_id, name, status, breaks_json, source_report)
      SELECT id, snapshot_id, ${nameExpression}, ${statusExpression}, ${breaksExpression}, ${sourceReportExpression}
      FROM process_interaction_chains;
      DROP TABLE process_interaction_chains;
      ALTER TABLE process_interaction_chains_migration RENAME TO process_interaction_chains;
    `);
  })();
  dbInitLog('Migration: rebuilt process_interaction_chains to plan schema');
}

if (tableExists('process_cross_dept_interactions') && !columnIsNotNull('process_cross_dept_interactions', 'risk_level')) {
  db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS process_cross_dept_interactions_migration;
      CREATE TABLE process_cross_dept_interactions_migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
        source_dept TEXT,
        target_dept TEXT,
        a1_code TEXT,
        refs INTEGER DEFAULT 0,
        risk_level TEXT NOT NULL CHECK(risk_level IN ('high','medium','low')),
        confirm_status TEXT NOT NULL DEFAULT 'pending' CHECK(confirm_status IN ('confirmed','pending','needs_review','not_mapped')),
        description TEXT,
        source_report TEXT
      );
      INSERT INTO process_cross_dept_interactions_migration (
        id, snapshot_id, source_dept, target_dept, a1_code, refs, risk_level, confirm_status, description, source_report
      )
      SELECT
        id,
        snapshot_id,
        source_dept,
        target_dept,
        a1_code,
        refs,
        CASE WHEN risk_level IN ('high','medium','low') THEN risk_level ELSE 'low' END,
        CASE WHEN confirm_status IN ('confirmed','pending','needs_review','not_mapped') THEN confirm_status ELSE 'pending' END,
        description,
        source_report
      FROM process_cross_dept_interactions;
      DROP TABLE process_cross_dept_interactions;
      ALTER TABLE process_cross_dept_interactions_migration RENAME TO process_cross_dept_interactions;
    `);
  })();
  dbInitLog('Migration: rebuilt process_cross_dept_interactions with required risk_level');
}

// ── RBAC: Role-Based Access Control ──

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  role_id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_code TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  description TEXT,
  parent_role_id INTEGER REFERENCES roles(role_id),
  is_system INTEGER NOT NULL DEFAULT 0,
  permissions_json TEXT DEFAULT '{}',
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS permissions (
  perm_id INTEGER PRIMARY KEY AUTOINCREMENT,
  perm_code TEXT NOT NULL UNIQUE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  field_constraints TEXT DEFAULT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS role_permissions (
  role_perm_id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  perm_id INTEGER NOT NULL REFERENCES permissions(perm_id) ON DELETE CASCADE,
  effect TEXT NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
  UNIQUE(role_id, perm_id)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS user_roles (
  user_role_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, role_id)
);
`);

// RBAC: Seed system roles and permissions on fresh DB
const roleCount = db.prepare('SELECT COUNT(*) as cnt FROM roles').get();
if (roleCount.cnt === 0) {
  db.transaction(() => {
    const insertRole = db.prepare('INSERT INTO roles (role_code, role_name, description, is_system) VALUES (?, ?, ?, 1)');
    const insertPerm = db.prepare('INSERT OR IGNORE INTO permissions (perm_code, resource, action, description) VALUES (?, ?, ?, ?)');
    const link = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, perm_id) SELECT r.role_id, p.perm_id FROM roles r, permissions p WHERE r.role_code=? AND p.perm_code=?');

    insertRole.run('admin', '管理员', '系统管理员，拥有全部权限');
    insertRole.run('reviewer', '审核员', '审核业务流程和映射');
    insertRole.run('owner', '业务负责人', '管理所属部门的业务数据');
    insertRole.run('submitter', '报送人', '提交业务数据');

    // admin: wildcard
    insertPerm.run('*:*', '*', '*', '全部权限通配');
    link.run('admin', '*:*');

    // reviewer permissions
    const revPerms = [
      ['review:approve', 'review', 'approve', '审核批准'],
      ['conflict:manage', 'conflict', 'manage', '冲突管理'],
      ['conflict:resolve', 'conflict', 'resolve', '冲突解决'],
      ['dashboard:view', 'dashboard', 'view', '查看统计看板'],
      ['mapping:read', 'mapping', 'read', '查看业务映射'],
      ['todos:manage', 'todos', 'manage', '管理待办'],
    ];
    revPerms.forEach(([code, res, act, desc]) => {
      insertPerm.run(code, res, act, desc);
      link.run('reviewer', code);
    });

    // owner permissions
    const ownPerms = [
      ['mapping:create', 'mapping', 'create', '创建业务映射'],
      ['mapping:update', 'mapping', 'update', '更新业务映射'],
      ['mapping:submit', 'mapping', 'submit', '提交业务映射'],
      ['mapping:read', 'mapping', 'read', '查看业务映射'],
      ['dashboard:view', 'dashboard', 'view', '查看统计看板'],
      ['todos:manage', 'todos', 'manage', '管理待办'],
    ];
    ownPerms.forEach(([code, res, act, desc]) => {
      insertPerm.run(code, res, act, desc);
      link.run('owner', code);
    });

    // submitter permissions
    const subPerms = [
      ['mapping:submit', 'mapping', 'submit', '提交业务映射'],
      ['mapping:read', 'mapping', 'read', '查看业务映射'],
      ['dashboard:view', 'dashboard', 'view', '查看统计看板'],
    ];
    subPerms.forEach(([code, res, act, desc]) => {
      insertPerm.run(code, res, act, desc);
      link.run('submitter', code);
    });
  })();
  dbInitLog('RBAC: System roles and permissions seeded');
}

ensureProjectRoles(db);
dbInitLog('RBAC: Tables ready (roles, permissions, role_permissions, user_roles)');
module.exports = db;
