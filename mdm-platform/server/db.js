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

// ── Module A: Master Data Registry ──
db.exec(`
CREATE TABLE IF NOT EXISTS master_data_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_data_attributes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES master_data_categories(id) ON DELETE CASCADE,
  attr_name TEXT NOT NULL,
  attr_label TEXT NOT NULL,
  attr_type TEXT NOT NULL CHECK(attr_type IN ('文本','编码','日期','枚举','数字','JSON')),
  required INTEGER NOT NULL DEFAULT 0,
  enum_options TEXT,
  validation_rule TEXT,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(category_id, attr_name)
);

CREATE TABLE IF NOT EXISTS master_data_code_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL UNIQUE REFERENCES master_data_categories(id),
  prefix TEXT NOT NULL DEFAULT '',
  total_length INTEGER NOT NULL DEFAULT 30,
  segment_defs TEXT NOT NULL DEFAULT '[]',
  next_sequence INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_data_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES master_data_categories(id),
  name TEXT NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','active','changing','discontinued','archived','rejected')),
  old_code TEXT,
  source_system TEXT DEFAULT 'MDM_MANUAL',
  maintain_dept_id INTEGER REFERENCES departments(id),
  owner_user_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_data_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  category_id INTEGER REFERENCES master_data_categories(id),
  total_rows INTEGER NOT NULL DEFAULT 0,
  success_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','failed')),
  uploaded_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_data_import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES master_data_import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  code TEXT,
  name TEXT,
  status TEXT NOT NULL CHECK(status IN ('success','error')),
  error_reason TEXT,
  raw_data_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 预置 6 大主数据分类
INSERT OR IGNORE INTO master_data_categories (id, name, code, description, sort_order) VALUES
(1, '零组件', 'PART', '自制件、外协件、组件、部件', 1),
(2, '工艺组件', 'PROC_COMP', '工艺拆分件、虚拟件', 2),
(3, '工装', 'TOOLING', '模具、夹具、型架、样板', 3),
(4, '原材料', 'MATERIAL', '金属/非金属、板材、型材', 4),
(5, '设备', 'EQUIPMENT', '生产设备、检测设备', 5),
(6, '工具', 'TOOL', '刀具、量具、辅具', 6);
`);

console.log('Module A: Master Data Registry tables ready');

// ── Module B: Master Data Lifecycle ──
db.exec(`
CREATE TABLE IF NOT EXISTS master_data_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES master_data_items(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK(request_type IN('create','modify','discontinue','archive')),
  change_summary TEXT NOT NULL,
  old_values_json TEXT,
  new_values_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','approved','rejected','cancelled')),
  requested_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

CREATE TABLE IF NOT EXISTS master_data_change_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_request_id INTEGER NOT NULL REFERENCES master_data_change_requests(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  approver_dept_id INTEGER NOT NULL REFERENCES departments(id),
  approver_user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  opinion TEXT,
  operated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_data_status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES master_data_items(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  change_request_id INTEGER REFERENCES master_data_change_requests(id) ON DELETE SET NULL,
  operated_by INTEGER REFERENCES users(id),
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

console.log('Module B: Master Data Lifecycle tables ready');

// ── Module C: Permissions field on users ──
const userInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
if (userInfo && !userInfo.sql.includes('permissions')) {
  db.exec("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '{}'");
  console.log('Migration: added permissions to users');
}

// ── Module D: Integration API ──
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

CREATE TABLE IF NOT EXISTS old_new_code_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  old_code TEXT NOT NULL,
  new_code TEXT NOT NULL,
  system_source TEXT,
  mapped_by INTEGER REFERENCES users(id),
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(old_code, new_code)
);
`);

console.log('Module D: Integration API tables ready');

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
  console.log('RBAC: System roles and permissions seeded');
}

console.log('RBAC: Tables ready (roles, permissions, role_permissions, user_roles)');

module.exports = db;
