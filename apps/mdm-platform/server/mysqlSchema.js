function mdmMysqlSchemaSql() {
  return `
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_key VARCHAR(160) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS departments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(128) NOT NULL,
  parent_id BIGINT NULL,
  path VARCHAR(1024) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  department_type VARCHAR(64) NULL,
  manager_user_id BIGINT NULL,
  data_owner_user_id BIGINT NULL,
  source_system VARCHAR(128) NOT NULL DEFAULT 'MDM_SYS',
  external_id VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_departments_code (code),
  INDEX idx_departments_parent (parent_id),
  INDEX idx_departments_status (status),
  CHECK (status IN ('active','inactive','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  employee_no VARCHAR(128) NOT NULL,
  department_id BIGINT NULL,
  post VARCHAR(255) NULL,
  role VARCHAR(64) NOT NULL DEFAULT 'submitter',
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_employee_no (employee_no),
  INDEX idx_users_department (department_id),
  INDEX idx_users_role (role),
  CHECK (role IN ('submitter','owner','reviewer','admin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  role_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  role_code VARCHAR(128) NOT NULL,
  role_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  parent_role_id BIGINT NULL,
  is_system TINYINT NOT NULL DEFAULT 0,
  permissions_json MEDIUMTEXT NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_roles_code (role_code),
  INDEX idx_roles_parent (parent_role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  perm_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  perm_code VARCHAR(160) NOT NULL,
  resource VARCHAR(128) NOT NULL,
  action VARCHAR(128) NOT NULL,
  field_constraints MEDIUMTEXT NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_permissions_code (perm_code),
  INDEX idx_permissions_resource_action (resource, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_perm_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  role_id BIGINT NOT NULL,
  perm_id BIGINT NOT NULL,
  effect VARCHAR(16) NOT NULL DEFAULT 'allow',
  UNIQUE KEY uq_role_permissions_role_perm (role_id, perm_id),
  INDEX idx_role_permissions_role (role_id),
  INDEX idx_role_permissions_perm (perm_id),
  CHECK (effect IN ('allow','deny'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  user_role_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  assigned_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_roles_user_role (user_id, role_id),
  INDEX idx_user_roles_user (user_id),
  INDEX idx_user_roles_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_candidate_review_runs (
  run_id VARCHAR(128) PRIMARY KEY,
  candidate_run_path VARCHAR(512) NOT NULL,
  candidate_count INT NOT NULL DEFAULT 0,
  embedding_status VARCHAR(64) NOT NULL DEFAULT 'missing',
  embedding_model VARCHAR(128) NOT NULL DEFAULT '',
  mapping_diff_report MEDIUMTEXT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_candidate_review_items (
  run_id VARCHAR(128) NOT NULL,
  stable_key VARCHAR(128) NOT NULL,
  candidate_id VARCHAR(128) NOT NULL DEFAULT '',
  department VARCHAR(128) NOT NULL DEFAULT '',
  document_name VARCHAR(255) NOT NULL DEFAULT '',
  source_file VARCHAR(512) NOT NULL DEFAULT '',
  source_anchor VARCHAR(255) NOT NULL DEFAULT '',
  candidate_type VARCHAR(64) NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  mapping_location TEXT NULL,
  suggested_action TEXT NULL,
  definition_status VARCHAR(64) NOT NULL DEFAULT '',
  owner VARCHAR(255) NOT NULL DEFAULT '',
  display_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, stable_key),
  CONSTRAINT fk_process_candidate_review_items_run FOREIGN KEY (run_id)
    REFERENCES process_candidate_review_runs(run_id) ON DELETE CASCADE,
  INDEX idx_process_candidate_review_items_group (department, document_name, candidate_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_candidate_review_excerpts (
  run_id VARCHAR(128) NOT NULL,
  stable_key VARCHAR(128) NOT NULL,
  chunk_id VARCHAR(128) NOT NULL,
  source_anchor VARCHAR(255) NOT NULL DEFAULT '',
  source_label VARCHAR(512) NOT NULL DEFAULT '',
  raw_text MEDIUMTEXT NOT NULL,
  evidence_status VARCHAR(64) NOT NULL DEFAULT 'candidate',
  verification_status VARCHAR(64) NOT NULL DEFAULT 'unverified',
  allowed_downstream_use VARCHAR(64) NOT NULL DEFAULT 'review_only',
  display_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, stable_key, chunk_id),
  CONSTRAINT fk_process_candidate_review_excerpts_item FOREIGN KEY (run_id, stable_key)
    REFERENCES process_candidate_review_items(run_id, stable_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_candidate_review_decisions (
  run_id VARCHAR(128) NOT NULL,
  stable_key VARCHAR(128) NOT NULL,
  decision VARCHAR(64) NOT NULL DEFAULT '',
  evidence_status VARCHAR(64) NOT NULL DEFAULT 'not_reviewed',
  issue_type VARCHAR(64) NOT NULL DEFAULT '',
  definition_status VARCHAR(64) NOT NULL DEFAULT '',
  normalized_note TEXT NULL,
  reviewer VARCHAR(128) NOT NULL DEFAULT '',
  reviewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, stable_key),
  CONSTRAINT fk_process_candidate_review_decisions_item FOREIGN KEY (run_id, stable_key)
    REFERENCES process_candidate_review_items(run_id, stable_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_json_path VARCHAR(512) NOT NULL,
  source_hash VARCHAR(128) NOT NULL,
  generated_at VARCHAR(64) NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_by BIGINT NULL,
  stats_json MEDIUMTEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  note TEXT NULL,
  CHECK (status IN ('active','archived')),
  INDEX idx_process_governance_snapshots_status (status),
  INDEX idx_process_governance_snapshots_imported_at (imported_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_nodes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  node_key VARCHAR(255) NOT NULL,
  node_type VARCHAR(32) NOT NULL,
  name VARCHAR(512) NOT NULL,
  domain_name VARCHAR(128) NULL,
  dept_name VARCHAR(128) NULL,
  parent_key VARCHAR(255) NULL,
  source_file VARCHAR(512) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_process_governance_nodes_key (snapshot_id, node_key),
  INDEX idx_process_governance_nodes_snapshot_type (snapshot_id, node_type),
  INDEX idx_process_governance_nodes_dept (dept_name),
  CHECK (node_type IN ('root','domain','department','l2','l3','a1','system')),
  CONSTRAINT fk_process_governance_nodes_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_edges (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  source_key VARCHAR(255) NOT NULL,
  target_key VARCHAR(255) NOT NULL,
  edge_type VARCHAR(32) NOT NULL,
  value DECIMAL(12,4) NOT NULL DEFAULT 1,
  source_file VARCHAR(512) NULL,
  UNIQUE KEY uq_process_governance_edges_key (snapshot_id, source_key, target_key, edge_type),
  INDEX idx_process_governance_edges_snapshot_type (snapshot_id, edge_type),
  CHECK (edge_type IN ('root_domain','domain_dept','dept_l2','l2_l3','l3_a1','l3_system','a1_system')),
  CONSTRAINT fk_process_governance_edges_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_a1_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  a1_code VARCHAR(128) NULL,
  dept_name VARCHAR(128) NULL,
  l3_name VARCHAR(512) NULL,
  behavior TEXT NOT NULL,
  execution_role VARCHAR(255) NULL,
  approval_type VARCHAR(128) NULL,
  input_source_dept VARCHAR(255) NULL,
  output_target_dept VARCHAR(255) NULL,
  suggested_systems TEXT NULL,
  verification_note TEXT NULL,
  source_file VARCHAR(512) NULL,
  INDEX idx_process_a1_items_snapshot (snapshot_id),
  INDEX idx_process_a1_items_dept (dept_name),
  INDEX idx_process_a1_items_code (a1_code),
  CONSTRAINT fk_process_a1_items_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_cross_dept_interactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  source_dept VARCHAR(128) NULL,
  target_dept VARCHAR(128) NULL,
  a1_code VARCHAR(128) NULL,
  refs INT NOT NULL DEFAULT 0,
  risk_level VARCHAR(16) NOT NULL,
  confirm_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  description TEXT NULL,
  source_report VARCHAR(512) NULL,
  INDEX idx_process_cross_dept_snapshot (snapshot_id),
  INDEX idx_process_cross_dept_risk (risk_level),
  INDEX idx_process_cross_dept_source_target (source_dept, target_dept),
  CHECK (risk_level IN ('high','medium','low')),
  CHECK (confirm_status IN ('confirmed','pending','needs_review','not_mapped')),
  CONSTRAINT fk_process_cross_dept_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_interaction_chains (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  breaks_json MEDIUMTEXT NULL,
  source_report VARCHAR(512) NULL,
  INDEX idx_process_interaction_chains_snapshot (snapshot_id),
  INDEX idx_process_interaction_chains_status (status),
  CHECK (status IN ('complete','partial','broken')),
  CONSTRAINT fk_process_interaction_chains_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_source_files (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  file_key VARCHAR(255) NOT NULL,
  file_path VARCHAR(1024) NOT NULL,
  dept_name VARCHAR(128) NULL,
  asset_type VARCHAR(128) NULL,
  file_no VARCHAR(128) NULL,
  revision VARCHAR(64) NULL,
  size_bytes BIGINT NULL,
  mtime VARCHAR(64) NULL,
  sha256 VARCHAR(128) NULL,
  process_status VARCHAR(32) NOT NULL DEFAULT '待复核',
  process_reason TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_source_files_key (snapshot_id, file_key),
  INDEX idx_process_source_files_snapshot (snapshot_id),
  INDEX idx_process_source_files_dept (dept_name),
  INDEX idx_process_source_files_status (process_status),
  CHECK (process_status IN ('纳入','排除','待复核')),
  CONSTRAINT fk_process_source_files_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_mdm_requirement_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  requirement_key VARCHAR(255) NOT NULL,
  dept_name VARCHAR(128) NULL,
  master_data_object VARCHAR(255) NOT NULL,
  source_l2 VARCHAR(255) NULL,
  key_fields TEXT NULL,
  responsible_dept VARCHAR(255) NULL,
  system_boundary TEXT NULL,
  governance_requirement TEXT NULL,
  source_file VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_mdm_requirement_key (snapshot_id, requirement_key),
  INDEX idx_process_mdm_requirement_snapshot (snapshot_id),
  INDEX idx_process_mdm_requirement_dept (dept_name),
  CONSTRAINT fk_process_mdm_requirement_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_evidence_refs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  ref_key VARCHAR(255) NOT NULL,
  ref_type VARCHAR(32) NOT NULL,
  dept_name VARCHAR(128) NULL,
  l3_name VARCHAR(512) NULL,
  a1_code VARCHAR(128) NULL,
  master_data_object VARCHAR(255) NULL,
  evidence_type VARCHAR(128) NULL,
  source_file VARCHAR(512) NOT NULL,
  citation TEXT NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_evidence_refs_key (snapshot_id, ref_key),
  INDEX idx_process_evidence_refs_snapshot (snapshot_id),
  INDEX idx_process_evidence_refs_dept (dept_name),
  INDEX idx_process_evidence_refs_l3_a1 (l3_name, a1_code),
  INDEX idx_process_evidence_refs_object (master_data_object),
  CHECK (ref_type IN ('L3','A1','MDM')),
  CONSTRAINT fk_process_evidence_refs_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_quality_cases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  finding_key VARCHAR(160) NOT NULL,
  first_snapshot_id BIGINT NOT NULL,
  latest_snapshot_id BIGINT NOT NULL,
  latest_finding_id BIGINT NULL,
  severity VARCHAR(16) NOT NULL,
  area VARCHAR(64) NOT NULL,
  source_file VARCHAR(512) NOT NULL,
  source_line INT NULL,
  message TEXT NOT NULL,
  suggestion TEXT NULL,
  dept_name VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  priority VARCHAR(16) NOT NULL DEFAULT 'medium',
  owner_user_id BIGINT NULL,
  owner_dept_id BIGINT NULL,
  due_date VARCHAR(64) NULL,
  closed_by BIGINT NULL,
  closed_at VARCHAR(64) NULL,
  closure_note TEXT NULL,
  reopened_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_quality_cases_finding_key (finding_key),
  INDEX idx_process_quality_cases_status (status),
  INDEX idx_process_quality_cases_dept (dept_name),
  INDEX idx_process_quality_cases_latest_snapshot (latest_snapshot_id),
  CHECK (severity IN ('BLOCK','WARN')),
  CHECK (priority IN ('high','medium','low')),
  CHECK (status IN ('open','assigned','rectifying','submitted','source_resolved','closed','reopened')),
  CONSTRAINT fk_process_quality_cases_first_snapshot FOREIGN KEY (first_snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_quality_cases_latest_snapshot FOREIGN KEY (latest_snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_quality_findings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  case_id BIGINT NULL,
  severity VARCHAR(16) NOT NULL,
  area VARCHAR(64) NOT NULL,
  source_file VARCHAR(512) NOT NULL,
  source_line INT NULL,
  message TEXT NOT NULL,
  suggestion TEXT NULL,
  dept_name VARCHAR(128) NULL,
  finding_key VARCHAR(160) NOT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_quality_findings_key (snapshot_id, finding_key),
  INDEX idx_process_quality_findings_snapshot (snapshot_id),
  INDEX idx_process_quality_findings_case (case_id),
  INDEX idx_process_quality_findings_dept (dept_name),
  CHECK (severity IN ('BLOCK','WARN','INFO')),
  CONSTRAINT fk_process_quality_findings_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_quality_case_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  actor_user_id BIGINT NULL,
  note TEXT NULL,
  payload_json MEDIUMTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_process_quality_case_events_case (case_id, id),
  CHECK (event_type IN ('import_created','import_seen','source_resolved','assigned','status_changed','commented','submitted','closed','reopened')),
  CONSTRAINT fk_process_quality_case_events_case FOREIGN KEY (case_id)
    REFERENCES process_governance_quality_cases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_mapping_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mapping_key VARCHAR(180) NOT NULL,
  record_type VARCHAR(16) NOT NULL,
  first_snapshot_id BIGINT NOT NULL,
  latest_snapshot_id BIGINT NOT NULL,
  parent_record_id BIGINT NULL,
  latest_a1_item_id BIGINT NULL,
  dept_name VARCHAR(128) NULL,
  domain_name VARCHAR(128) NULL,
  l2_name VARCHAR(255) NULL,
  l3_name VARCHAR(512) NOT NULL,
  a1_code VARCHAR(128) NULL,
  behavior TEXT NULL,
  execution_role VARCHAR(255) NULL,
  approval_type VARCHAR(128) NULL,
  input_source_dept VARCHAR(255) NULL,
  output_target_dept VARCHAR(255) NULL,
  suggested_systems TEXT NULL,
  verification_note TEXT NULL,
  source_file VARCHAR(512) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_mapping_records_key (mapping_key),
  INDEX idx_process_mapping_records_type (record_type),
  INDEX idx_process_mapping_records_dept (dept_name),
  INDEX idx_process_mapping_records_latest_snapshot (latest_snapshot_id),
  CHECK (record_type IN ('l3','a1')),
  CHECK (status IN ('active','source_missing','published','archived')),
  CONSTRAINT fk_process_mapping_records_first_snapshot FOREIGN KEY (first_snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_mapping_records_latest_snapshot FOREIGN KEY (latest_snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_mapping_records_parent FOREIGN KEY (parent_record_id)
    REFERENCES process_mapping_records(id) ON DELETE SET NULL,
  CONSTRAINT fk_process_mapping_records_a1 FOREIGN KEY (latest_a1_item_id)
    REFERENCES process_a1_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_mapping_todos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  todo_key VARCHAR(180) NOT NULL,
  mapping_record_id BIGINT NULL,
  todo_type VARCHAR(32) NOT NULL,
  first_snapshot_id BIGINT NOT NULL,
  latest_snapshot_id BIGINT NOT NULL,
  dept_name VARCHAR(128) NULL,
  target_dept_name VARCHAR(128) NULL,
  l3_name VARCHAR(512) NULL,
  a1_code VARCHAR(128) NULL,
  source_file VARCHAR(512) NULL,
  source_line INT NULL,
  message TEXT NOT NULL,
  suggestion TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  priority VARCHAR(16) NOT NULL DEFAULT 'medium',
  owner_user_id BIGINT NULL,
  owner_dept_id BIGINT NULL,
  due_date VARCHAR(64) NULL,
  closed_by BIGINT NULL,
  closed_at VARCHAR(64) NULL,
  closure_note TEXT NULL,
  reopened_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_mapping_todos_key (todo_key),
  INDEX idx_process_mapping_todos_status (status),
  INDEX idx_process_mapping_todos_type (todo_type),
  INDEX idx_process_mapping_todos_dept (dept_name),
  CHECK (todo_type IN ('dept_confirm','verification','adjustment','cross_dept','evidence')),
  CHECK (priority IN ('high','medium','low')),
  CHECK (status IN ('open','assigned','rectifying','submitted','source_resolved','closed','reopened','accepted')),
  CONSTRAINT fk_process_mapping_todos_record FOREIGN KEY (mapping_record_id)
    REFERENCES process_mapping_records(id) ON DELETE SET NULL,
  CONSTRAINT fk_process_mapping_todos_first_snapshot FOREIGN KEY (first_snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_mapping_todos_latest_snapshot FOREIGN KEY (latest_snapshot_id)
    REFERENCES process_governance_snapshots(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_mapping_todo_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  todo_id BIGINT NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  actor_user_id BIGINT NULL,
  note TEXT NULL,
  payload_json MEDIUMTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_process_mapping_todo_events_todo (todo_id, id),
  CHECK (event_type IN ('import_created','import_seen','source_resolved','assigned','status_changed','commented','submitted','closed','reopened')),
  CONSTRAINT fk_process_mapping_todo_events_todo FOREIGN KEY (todo_id)
    REFERENCES process_mapping_todos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS terminology_term_types (
  code VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_terminology_term_types_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS terminology_terms (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  term VARCHAR(255) NOT NULL,
  term_type_code VARCHAR(64) NOT NULL DEFAULT 'noun',
  definition TEXT NULL,
  scope VARCHAR(255) NULL,
  forbidden VARCHAR(255) NULL,
  process_mapping_record_id BIGINT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by BIGINT NULL,
  approved_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_terminology_terms_term (term),
  INDEX idx_terminology_terms_type (term_type_code),
  INDEX idx_terminology_terms_status (status),
  INDEX idx_terminology_terms_process (process_mapping_record_id),
  CHECK (status IN ('pending','approved','rejected')),
  CONSTRAINT fk_terminology_terms_type FOREIGN KEY (term_type_code)
    REFERENCES terminology_term_types(code) ON UPDATE CASCADE,
  CONSTRAINT fk_terminology_terms_process FOREIGN KEY (process_mapping_record_id)
    REFERENCES process_mapping_records(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_objects (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  object_key VARCHAR(180) NOT NULL,
  object_name_cn VARCHAR(255) NOT NULL,
  object_name_en VARCHAR(255) NULL,
  object_type VARCHAR(64) NOT NULL DEFAULT 'master_data_candidate',
  owner_dept_id BIGINT NULL,
  steward_user_id BIGINT NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  source_type VARCHAR(64) NOT NULL DEFAULT 'manual',
  source_ref VARCHAR(512) NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_data_map_objects_key (object_key),
  INDEX idx_data_map_objects_name (object_name_cn),
  INDEX idx_data_map_objects_owner_dept (owner_dept_id),
  CHECK (status IN ('draft','active','inactive','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_contexts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  context_key VARCHAR(180) NOT NULL,
  context_type VARCHAR(64) NOT NULL DEFAULT 'process',
  title VARCHAR(512) NOT NULL,
  dept_id BIGINT NULL,
  dept_name VARCHAR(128) NULL,
  owner_user_id BIGINT NULL,
  process_snapshot_id BIGINT NULL,
  process_mapping_record_id BIGINT NULL,
  process_node_key VARCHAR(255) NULL,
  a1_code VARCHAR(128) NULL,
  l3_name VARCHAR(512) NULL,
  source_file VARCHAR(512) NULL,
  source_anchor VARCHAR(255) NULL,
  source_excerpt MEDIUMTEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_data_map_contexts_key (context_key),
  INDEX idx_data_map_contexts_dept (dept_id),
  INDEX idx_data_map_contexts_status (status),
  INDEX idx_data_map_contexts_process_record (process_mapping_record_id),
  CHECK (context_type IN ('process','manual','import','baseline')),
  CHECK (status IN ('draft','active','inactive','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_fields (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  context_id BIGINT NOT NULL,
  object_id BIGINT NULL,
  field_key VARCHAR(220) NOT NULL,
  field_name_cn VARCHAR(255) NULL,
  field_name_en VARCHAR(255) NULL,
  business_definition TEXT NULL,
  data_type VARCHAR(64) NULL,
  data_format VARCHAR(128) NULL,
  length_precision VARCHAR(64) NULL,
  nullable TINYINT NOT NULL DEFAULT 1,
  enum_values_json MEDIUMTEXT NULL,
  sensitivity_level VARCHAR(32) NOT NULL DEFAULT 'internal',
  master_data_level VARCHAR(32) NOT NULL DEFAULT 'candidate',
  process_governance_node_key VARCHAR(255) NULL,
  process_governance_a1_code VARCHAR(128) NULL,
  source_file VARCHAR(512) NULL,
  source_anchor VARCHAR(255) NULL,
  source_excerpt MEDIUMTEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  quality_status VARCHAR(32) NOT NULL DEFAULT 'unchecked',
  submitted_by BIGINT NULL,
  submitted_at TIMESTAMP NULL,
  reviewed_by BIGINT NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_data_map_fields_key (field_key),
  INDEX idx_data_map_fields_context (context_id),
  INDEX idx_data_map_fields_object (object_id),
  INDEX idx_data_map_fields_name_cn (field_name_cn),
  INDEX idx_data_map_fields_status (status),
  CHECK (status IN ('draft','submitted','confirmed','conflicted','archived')),
  CHECK (quality_status IN ('unchecked','pass','warn','block')),
  CONSTRAINT fk_data_map_fields_context FOREIGN KEY (context_id)
    REFERENCES data_map_contexts(id) ON DELETE CASCADE,
  CONSTRAINT fk_data_map_fields_object FOREIGN KEY (object_id)
    REFERENCES data_map_objects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_field_system_links (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  field_id BIGINT NOT NULL,
  system_name VARCHAR(255) NOT NULL,
  system_code VARCHAR(128) NULL,
  relation_type VARCHAR(32) NOT NULL,
  sync_mode VARCHAR(64) NULL,
  interface_note TEXT NULL,
  is_primary TINYINT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_data_map_field_system_links_field (field_id),
  INDEX idx_data_map_field_system_links_system (system_name),
  CHECK (relation_type IN ('producer','consumer','candidate_authority','authority')),
  CHECK (status IN ('active','inactive','archived')),
  CONSTRAINT fk_data_map_field_system_links_field FOREIGN KEY (field_id)
    REFERENCES data_map_fields(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_field_identities (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  field_id BIGINT NOT NULL,
  authoritative_system_name VARCHAR(255) NULL,
  authoritative_system_code VARCHAR(128) NULL,
  maintain_dept_id BIGINT NULL,
  owner_user_id BIGINT NULL,
  confidence_level VARCHAR(32) NOT NULL DEFAULT 'medium',
  confirmed TINYINT NOT NULL DEFAULT 0,
  confirmed_by BIGINT NULL,
  confirmed_at TIMESTAMP NULL,
  note TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'candidate',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_data_map_field_identities_field (field_id),
  INDEX idx_data_map_field_identities_dept (maintain_dept_id),
  INDEX idx_data_map_field_identities_owner (owner_user_id),
  CHECK (confidence_level IN ('low','medium','high')),
  CHECK (status IN ('candidate','confirmed','rejected','archived')),
  CONSTRAINT fk_data_map_field_identities_field FOREIGN KEY (field_id)
    REFERENCES data_map_fields(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_term_types (
  code VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_terms (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  term VARCHAR(255) NOT NULL,
  term_type_code VARCHAR(64) NOT NULL DEFAULT 'noun',
  preferred_term VARCHAR(255) NULL,
  forbidden_term VARCHAR(255) NULL,
  definition TEXT NULL,
  scope_type VARCHAR(64) NOT NULL DEFAULT 'field',
  severity VARCHAR(16) NOT NULL DEFAULT 'warn',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_data_map_terms_term_scope (term, scope_type),
  INDEX idx_data_map_terms_forbidden (forbidden_term),
  INDEX idx_data_map_terms_status (status),
  CHECK (severity IN ('warn','block')),
  CHECK (status IN ('draft','active','inactive','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_naming_rules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  rule_type VARCHAR(64) NOT NULL,
  match_value VARCHAR(255) NOT NULL,
  replacement_value VARCHAR(255) NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'warn',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_data_map_naming_rules_type_status (rule_type, status),
  CHECK (severity IN ('warn','block')),
  CHECK (status IN ('draft','active','inactive','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_quality_issues (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  field_id BIGINT NULL,
  context_id BIGINT NULL,
  issue_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  message TEXT NOT NULL,
  suggestion TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by BIGINT NULL,
  resolved_at TIMESTAMP NULL,
  INDEX idx_data_map_quality_issues_field (field_id),
  INDEX idx_data_map_quality_issues_context (context_id),
  INDEX idx_data_map_quality_issues_status (status),
  CHECK (severity IN ('info','warn','block')),
  CHECK (status IN ('open','resolved','dismissed')),
  CONSTRAINT fk_data_map_quality_issues_field FOREIGN KEY (field_id)
    REFERENCES data_map_fields(id) ON DELETE CASCADE,
  CONSTRAINT fk_data_map_quality_issues_context FOREIGN KEY (context_id)
    REFERENCES data_map_contexts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_import_batches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_type VARCHAR(64) NOT NULL,
  file_name VARCHAR(512) NULL,
  context_id BIGINT NULL,
  imported_by BIGINT NULL,
  row_count INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'imported',
  note TEXT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_data_map_import_batches_context (context_id),
  CHECK (status IN ('imported','failed','partial')),
  CONSTRAINT fk_data_map_import_batches_context FOREIGN KEY (context_id)
    REFERENCES data_map_contexts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_change_sets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BIGINT NOT NULL,
  operated_by BIGINT NULL,
  operated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description TEXT NULL,
  INDEX idx_data_map_change_sets_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_version_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BIGINT NOT NULL,
  field_name VARCHAR(128) NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  operation VARCHAR(32) NOT NULL,
  operated_by BIGINT NULL,
  operated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  change_set_id BIGINT NULL,
  INDEX idx_data_map_version_log_entity (entity_type, entity_id),
  CHECK (operation IN ('create','update','delete')),
  CONSTRAINT fk_data_map_version_log_change_set FOREIGN KEY (change_set_id)
    REFERENCES data_map_change_sets(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;
}

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(statement => statement.trim())
    .filter(Boolean);
}

module.exports = {
  mdmMysqlSchemaSql,
  splitSqlStatements
};
