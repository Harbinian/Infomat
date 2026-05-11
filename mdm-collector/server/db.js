const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'collector.db'));

db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES departments(id),
  manager_user_id INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  capability_id INTEGER REFERENCES capabilities(id),
  owner_dept_id INTEGER REFERENCES departments(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  type TEXT NOT NULL CHECK(type IN ('field_confirm','gold_source','terminology','general')),
  related_mapping_id INTEGER REFERENCES mappings(id) ON DELETE SET NULL,
  related_field_id INTEGER REFERENCES field_entries(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
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
`);

module.exports = db;
