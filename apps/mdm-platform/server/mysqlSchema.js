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
  final_responsible_person_id BIGINT NULL,
  data_owner_person_id BIGINT NULL,
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
  INDEX idx_departments_final_responsible_person (final_responsible_person_id),
  INDEX idx_departments_data_owner_person (data_owner_person_id),
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

CREATE TABLE IF NOT EXISTS person (
  person_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  employee_no VARCHAR(128) NOT NULL,
  person_name VARCHAR(255) NOT NULL,
  current_department_id BIGINT NULL,
  mobile VARCHAR(64) NULL,
  email VARCHAR(255) NULL,
  employment_status VARCHAR(32) NOT NULL DEFAULT 'active',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_person_employee_no (employee_no),
  INDEX idx_person_department (current_department_id),
  INDEX idx_person_status (status),
  CHECK (employment_status IN ('active','leave','suspended','inactive')),
  CHECK (status IN ('active','inactive','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_accounts (
  account_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  person_id BIGINT NOT NULL,
  login_name VARCHAR(128) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT NOT NULL DEFAULT 0,
  account_status VARCHAR(32) NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_accounts_person (person_id),
  UNIQUE KEY uq_user_accounts_login (login_name),
  INDEX idx_user_accounts_status (account_status),
  CHECK (account_status IN ('active','locked','disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  role_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  role_code VARCHAR(128) NOT NULL,
  role_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  parent_role_id BIGINT NULL,
  is_system TINYINT NOT NULL DEFAULT 0,
  role_group VARCHAR(32) NOT NULL DEFAULT 'basic',
  protected_core TINYINT NOT NULL DEFAULT 0,
  permissions_json MEDIUMTEXT NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_roles_code (role_code),
  INDEX idx_roles_parent (parent_role_id),
  INDEX idx_roles_group (role_group),
  CHECK (role_group IN ('basic','project','custom'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  perm_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  perm_code VARCHAR(160) NOT NULL,
  resource VARCHAR(128) NOT NULL,
  action VARCHAR(128) NOT NULL,
  field_constraints MEDIUMTEXT NULL,
  is_dangerous TINYINT NOT NULL DEFAULT 0,
  default_scope VARCHAR(64) NOT NULL DEFAULT 'self_task',
  protected_core TINYINT NOT NULL DEFAULT 0,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_permissions_code (perm_code),
  INDEX idx_permissions_resource_action (resource, action),
  INDEX idx_permissions_scope (default_scope),
  CHECK (default_scope IN ('self_task','department','global'))
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

CREATE TABLE IF NOT EXISTS person_roles (
  person_role_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  person_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  assigned_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_person_roles_person_role (person_id, role_id),
  INDEX idx_person_roles_person (person_id),
  INDEX idx_person_roles_role (role_id),
  INDEX idx_person_roles_assigned_by (assigned_by_person_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_guidance (
  guidance_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  guidance_code VARCHAR(128) NOT NULL,
  related_entity_type VARCHAR(128) NOT NULL,
  related_entity_id BIGINT NOT NULL,
  related_department_id BIGINT NULL,
  created_by_person_id BIGINT NOT NULL,
  guidance_type VARCHAR(64) NOT NULL DEFAULT '指导',
  content TEXT NOT NULL,
  final_responsible_person_id BIGINT NULL,
  current_handler_person_id BIGINT NULL,
  executor_person_id BIGINT NULL,
  is_major TINYINT NOT NULL DEFAULT 0,
  visibility_scope VARCHAR(64) NOT NULL DEFAULT 'department',
  status VARCHAR(64) NOT NULL DEFAULT 'pending_response',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_governance_guidance_code (guidance_code),
  INDEX idx_guidance_related (related_entity_type, related_entity_id),
  INDEX idx_guidance_department_status (related_department_id, status),
  INDEX idx_guidance_handler (current_handler_person_id, status),
  INDEX idx_guidance_executor (executor_person_id, status),
  INDEX idx_guidance_final_responsible (final_responsible_person_id, status),
  CHECK (guidance_type IN ('指导','建议','要求补充材料','要求重议')),
  CHECK (visibility_scope IN ('department','global')),
  CHECK (status IN ('submitted','pending_response','in_progress','responded','pending_final_confirm','closed','clarification_requested','objected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_guidance_events (
  event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  guidance_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_person_id BIGINT NULL,
  from_status VARCHAR(64) NULL,
  to_status VARCHAR(64) NULL,
  note TEXT NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_guidance_events_guidance (guidance_id, created_at),
  CHECK (event_type IN ('created','responded','clarification_requested','objected','executor_assigned','delegated','final_confirmed','commented')),
  CONSTRAINT fk_guidance_events_guidance FOREIGN KEY (guidance_id)
    REFERENCES process_governance_guidance(guidance_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS department_responsibility_delegations (
  delegation_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  department_id BIGINT NOT NULL,
  final_responsible_person_id BIGINT NOT NULL,
  delegate_person_id BIGINT NOT NULL,
  delegation_type VARCHAR(64) NOT NULL,
  scope_type VARCHAR(64) NOT NULL DEFAULT '全部',
  scope_ref_type VARCHAR(128) NULL,
  scope_ref_id BIGINT NULL,
  can_final_confirm TINYINT NOT NULL DEFAULT 0,
  reason TEXT NULL,
  start_at TIMESTAMP NULL,
  end_at TIMESTAMP NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_delegations_department (department_id, status),
  INDEX idx_delegations_final_responsible (final_responsible_person_id, status),
  INDEX idx_delegations_delegate (delegate_person_id, status),
  CHECK (delegation_type IN ('指导意见响应','重大变更响应','流程整改确认')),
  CHECK (scope_type IN ('全部','指定业务对象','指定问题类型')),
  CHECK (status IN ('active','inactive','expired','revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_input_baseline_review_runs (
  run_id VARCHAR(128) PRIMARY KEY,
  review_run_path VARCHAR(512) NOT NULL,
  issue_count INT NOT NULL DEFAULT 0,
  embedding_status VARCHAR(64) NOT NULL DEFAULT 'missing',
  embedding_model VARCHAR(128) NOT NULL DEFAULT '',
  mapping_diff_report MEDIUMTEXT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_input_baseline_review_items (
  run_id VARCHAR(128) NOT NULL,
  stable_key VARCHAR(128) NOT NULL,
  review_item_id VARCHAR(128) NOT NULL DEFAULT '',
  department VARCHAR(128) NOT NULL DEFAULT '',
  document_name VARCHAR(255) NOT NULL DEFAULT '',
  source_file VARCHAR(512) NOT NULL DEFAULT '',
  source_anchor VARCHAR(255) NOT NULL DEFAULT '',
  issue_type VARCHAR(64) NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  mapping_location TEXT NULL,
  suggested_action TEXT NULL,
  definition_status VARCHAR(64) NOT NULL DEFAULT '',
  owner VARCHAR(255) NOT NULL DEFAULT '',
  display_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, stable_key),
  CONSTRAINT fk_process_input_baseline_review_items_run FOREIGN KEY (run_id)
    REFERENCES process_input_baseline_review_runs(run_id) ON DELETE CASCADE,
  INDEX idx_process_input_baseline_review_items_group (department, document_name, issue_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_input_baseline_review_excerpts (
  run_id VARCHAR(128) NOT NULL,
  stable_key VARCHAR(128) NOT NULL,
  chunk_id VARCHAR(128) NOT NULL,
  source_anchor VARCHAR(255) NOT NULL DEFAULT '',
  source_label VARCHAR(512) NOT NULL DEFAULT '',
  raw_text MEDIUMTEXT NOT NULL,
  evidence_status VARCHAR(64) NOT NULL DEFAULT 'needs_review',
  verification_status VARCHAR(64) NOT NULL DEFAULT 'unverified',
  allowed_downstream_use VARCHAR(64) NOT NULL DEFAULT 'review_only',
  display_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, stable_key, chunk_id),
  CONSTRAINT fk_process_input_baseline_review_excerpts_item FOREIGN KEY (run_id, stable_key)
    REFERENCES process_input_baseline_review_items(run_id, stable_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_input_baseline_review_decisions (
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
  CONSTRAINT fk_process_input_baseline_review_decisions_item FOREIGN KEY (run_id, stable_key)
    REFERENCES process_input_baseline_review_items(run_id, stable_key) ON DELETE CASCADE
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
  document_no VARCHAR(128) NULL,
  document_title VARCHAR(255) NULL,
  document_edition VARCHAR(16) NULL,
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
  INDEX idx_process_a1_items_document (document_no, document_edition),
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
  owner_person_id BIGINT NULL,
  owner_dept_id BIGINT NULL,
  due_date VARCHAR(64) NULL,
  closed_by BIGINT NULL,
  closed_by_person_id BIGINT NULL,
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
  fingerprint VARCHAR(64) NULL,
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
  actor_person_id BIGINT NULL,
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
  document_no VARCHAR(128) NULL,
  document_title VARCHAR(255) NULL,
  document_edition VARCHAR(16) NULL,
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
  INDEX idx_process_mapping_records_document (document_no, document_edition),
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
  fingerprint VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  priority VARCHAR(16) NOT NULL DEFAULT 'medium',
  owner_user_id BIGINT NULL,
  owner_person_id BIGINT NULL,
  owner_dept_id BIGINT NULL,
  due_date VARCHAR(64) NULL,
  closed_by BIGINT NULL,
  closed_by_person_id BIGINT NULL,
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

CREATE TABLE IF NOT EXISTS process_import_fingerprints (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  import_batch_id VARCHAR(64) NOT NULL,
  scope ENUM('quality','mapping') NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_batch (import_batch_id),
  INDEX idx_fp (scope, fingerprint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_mapping_todo_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  todo_id BIGINT NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  actor_user_id BIGINT NULL,
  actor_person_id BIGINT NULL,
  note TEXT NULL,
  payload_json MEDIUMTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_process_mapping_todo_events_todo (todo_id, id),
  CHECK (event_type IN ('import_created','import_seen','source_resolved','assigned','status_changed','commented','submitted','closed','reopened')),
  CONSTRAINT fk_process_mapping_todo_events_todo FOREIGN KEY (todo_id)
    REFERENCES process_mapping_todos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_issue_batches (
  batch_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_key VARCHAR(128) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_snapshot_id BIGINT NULL,
  department_name VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'preparing',
  summary_json JSON NULL,
  error_message TEXT NULL,
  generated_by BIGINT NULL,
  generated_by_person_id BIGINT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_governance_issue_batches_key (batch_key),
  INDEX idx_issue_batches_status_dept (status, department_name),
  INDEX idx_issue_batches_generated_at (generated_at),
  CHECK (status IN ('preparing','ready','failed','superseded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_issues (
  issue_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  issue_key VARCHAR(160) NOT NULL,
  batch_id BIGINT NULL,
  primary_dept_name VARCHAR(128) NOT NULL,
  owner_dept_name VARCHAR(128) NULL,
  source_layer VARCHAR(64) NOT NULL DEFAULT 'procedure',
  source_type VARCHAR(64) NOT NULL,
  source_ref_table VARCHAR(128) NULL,
  source_ref_id VARCHAR(128) NULL,
  l1_name VARCHAR(255) NULL,
  l2_name VARCHAR(255) NULL,
  l3_name VARCHAR(255) NULL,
  a1_code VARCHAR(128) NULL,
  a1_name VARCHAR(255) NULL,
  title VARCHAR(255) NOT NULL,
  what_text TEXT NOT NULL,
  why_text TEXT NOT NULL,
  where_text TEXT NOT NULL,
  who_text TEXT NOT NULL,
  when_text TEXT NOT NULL,
  how_text TEXT NOT NULL,
  how_much_text TEXT NOT NULL,
  display_status VARCHAR(64) NOT NULL DEFAULT 'waiting_my_action',
  priority_score INT NOT NULL DEFAULT 0,
  due_at DATETIME NULL,
  closed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_governance_issues_key (issue_key),
  INDEX idx_issues_dept_status (primary_dept_name, display_status, priority_score),
  INDEX idx_issues_a1 (a1_code),
  INDEX idx_issues_updated (updated_at),
  CHECK (source_layer IN ('rule','procedure','standard','form','unknown')),
  CHECK (display_status IN ('waiting_my_action','waiting_others','waiting_department_review','waiting_studio_review','waiting_mdm_decision','completed','closed','data_preparing','data_failed','not_in_scope','no_permission')),
  CONSTRAINT fk_issue_batch FOREIGN KEY (batch_id) REFERENCES process_governance_issue_batches(batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_issue_points (
  point_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  issue_id BIGINT NOT NULL,
  point_key VARCHAR(180) NOT NULL,
  point_type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  prompt_text TEXT NOT NULL,
  enum_options_json JSON NOT NULL,
  selected_option VARCHAR(128) NULL,
  note TEXT NULL,
  evidence_json JSON NULL,
  current_step VARCHAR(64) NOT NULL DEFAULT 'business_confirm',
  point_status VARCHAR(64) NOT NULL DEFAULT 'pending_business_confirm',
  requires_mdm_decision TINYINT(1) NOT NULL DEFAULT 0,
  requires_studio_review TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_governance_issue_points_key (point_key),
  INDEX idx_issue_points_issue (issue_id, point_status),
  INDEX idx_issue_points_type_status (point_type, point_status),
  CHECK (point_type IN ('owner_role','completion_standard','controlled_transfer','cross_department','process_structure','system_landing','data_object','evidence_gap','terminology')),
  CHECK (point_status IN ('pending_business_confirm','pending_department_review','pending_collaboration','pending_studio_review','pending_mdm_decision','needs_more_info','accepted','not_accepted','closed')),
  CONSTRAINT fk_issue_points_issue FOREIGN KEY (issue_id) REFERENCES process_governance_issues(issue_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_issue_participants (
  participant_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  issue_id BIGINT NOT NULL,
  point_id BIGINT NULL,
  participant_type VARCHAR(64) NOT NULL,
  dept_name VARCHAR(128) NULL,
  role_code VARCHAR(64) NULL,
  user_id BIGINT NULL,
  person_id BIGINT NULL,
  can_view TINYINT(1) NOT NULL DEFAULT 1,
  can_act TINYINT(1) NOT NULL DEFAULT 0,
  action_label VARCHAR(128) NULL,
  action_status VARCHAR(64) NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_issue_participants_issue (issue_id, can_view, can_act),
  INDEX idx_issue_participants_user (user_id, action_status),
  INDEX idx_issue_participants_dept (dept_name, action_status),
  CHECK (participant_type IN ('business_owner','department_reviewer','collaborator','studio_reviewer','mdm_decider','terminology_reviewer','observer')),
  CONSTRAINT fk_issue_participants_issue FOREIGN KEY (issue_id) REFERENCES process_governance_issues(issue_id),
  CONSTRAINT fk_issue_participants_point FOREIGN KEY (point_id) REFERENCES process_governance_issue_points(point_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_issue_events (
  event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  issue_id BIGINT NOT NULL,
  point_id BIGINT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_user_id BIGINT NULL,
  actor_person_id BIGINT NULL,
  actor_dept_name VARCHAR(128) NULL,
  actor_role_code VARCHAR(64) NULL,
  note TEXT NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_issue_events_issue (issue_id, created_at),
  INDEX idx_issue_events_point (point_id, created_at),
  CHECK (event_type IN ('created','business_confirmed','department_reviewed','collaboration_added','collaboration_answered','studio_reviewed','mdm_decided','more_info_requested','revision_suggested','different_opinion_added','terminology_task_created','terminology_answered','terminology_decided','commented','closed','reopened')),
  CONSTRAINT fk_issue_events_issue FOREIGN KEY (issue_id) REFERENCES process_governance_issues(issue_id),
  CONSTRAINT fk_issue_events_point FOREIGN KEY (point_id) REFERENCES process_governance_issue_points(point_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_governance_term_tasks (
  term_task_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  issue_id BIGINT NOT NULL,
  point_id BIGINT NULL,
  term_text VARCHAR(255) NOT NULL,
  context_text TEXT NOT NULL,
  selected_departments_json JSON NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'pending_departments',
  decision_json JSON NULL,
  created_by BIGINT NULL,
  created_by_person_id BIGINT NULL,
  decided_by BIGINT NULL,
  decided_by_person_id BIGINT NULL,
  decided_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_term_tasks_status (status),
  CHECK (status IN ('pending_departments','pending_mdm_decision','decided','closed')),
  CONSTRAINT fk_term_tasks_issue FOREIGN KEY (issue_id) REFERENCES process_governance_issues(issue_id),
  CONSTRAINT fk_term_tasks_point FOREIGN KEY (point_id) REFERENCES process_governance_issue_points(point_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_documents (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  document_no VARCHAR(128) NOT NULL,
  document_title VARCHAR(255) NOT NULL,
  owning_department_id BIGINT NOT NULL,
  current_edition VARCHAR(16) NULL,
  current_version_id BIGINT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_design_documents_no (document_no),
  INDEX idx_process_design_documents_dept (owning_department_id, status),
  INDEX idx_process_design_documents_current_version (current_version_id),
  CHECK (status IN ('active','retired')),
  CONSTRAINT fk_process_design_documents_dept FOREIGN KEY (owning_department_id)
    REFERENCES departments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_drafts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  document_id BIGINT NOT NULL,
  document_no VARCHAR(128) NOT NULL,
  document_title VARCHAR(255) NOT NULL,
  planned_edition VARCHAR(16) NOT NULL,
  base_version_id BIGINT NULL,
  active_document_no VARCHAR(128) NULL,
  process_name VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  basis_type VARCHAR(128) NOT NULL,
  basis_description TEXT NOT NULL,
  involves_other_departments TINYINT NOT NULL DEFAULT 0,
  related_departments_json JSON NULL,
  department_id BIGINT NOT NULL,
  proxy_department_id BIGINT NULL,
  proxy_reason TEXT NULL,
  l1_name VARCHAR(255) NULL,
  l1_status VARCHAR(32) NOT NULL DEFAULT 'unclassified',
  l2_name VARCHAR(255) NULL,
  l2_status VARCHAR(32) NOT NULL DEFAULT 'unclassified',
  l3_name VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_by BIGINT NULL,
  submitted_by BIGINT NULL,
  submitted_at TIMESTAMP NULL,
  published_by BIGINT NULL,
  published_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_design_drafts_active_document_no (active_document_no),
  INDEX idx_process_design_drafts_document (document_id, status),
  INDEX idx_process_design_drafts_dept (department_id, status),
  INDEX idx_process_design_drafts_creator (created_by, status),
  CHECK (l1_status IN ('unclassified','needs_review','confirmed')),
  CHECK (l2_status IN ('unclassified','needs_review','confirmed')),
  CHECK (status IN ('draft','submitted','under_review','needs_changes','approved','published','rejected')),
  CONSTRAINT fk_process_design_drafts_document FOREIGN KEY (document_id)
    REFERENCES process_design_documents(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_design_drafts_department FOREIGN KEY (department_id)
    REFERENCES departments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_design_drafts_proxy_department FOREIGN KEY (proxy_department_id)
    REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_document_profiles (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  document_title VARCHAR(255) NOT NULL,
  document_no VARCHAR(128) NOT NULL,
  purpose TEXT NOT NULL,
  scope TEXT NOT NULL,
  inheritance_relation TEXT NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_design_document_profiles_draft (draft_id),
  INDEX idx_process_design_document_profiles_no (document_no),
  CONSTRAINT fk_process_design_document_profiles_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_terms (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  term_name VARCHAR(255) NOT NULL,
  definition TEXT NOT NULL,
  applies_to VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 1,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_design_terms_draft (draft_id, sort_order),
  UNIQUE KEY uq_process_design_terms_name (draft_id, term_name),
  CONSTRAINT fk_process_design_terms_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_processes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  process_code VARCHAR(128) NOT NULL,
  process_type VARCHAR(32) NOT NULL DEFAULT 'new',
  l1_name VARCHAR(255) NOT NULL,
  l2_name VARCHAR(255) NOT NULL,
  l3_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_design_processes_draft (draft_id, sort_order),
  UNIQUE KEY uq_process_design_processes_code (process_code),
  CHECK (process_type IN ('new','inherit','handoff','adjustment')),
  CONSTRAINT fk_process_design_processes_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_steps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  process_id BIGINT NOT NULL,
  step_type VARCHAR(32) NOT NULL DEFAULT 'action',
  step_name VARCHAR(255) NOT NULL,
  actor_role VARCHAR(255) NULL,
  timing VARCHAR(255) NULL,
  input_materials TEXT NULL,
  output_result TEXT NULL,
  need_confirmation TINYINT NOT NULL DEFAULT 0,
  related_departments TEXT NULL,
  basis TEXT NULL,
  a1_code VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  void_reason TEXT NULL,
  voided_by BIGINT NULL,
  voided_at TIMESTAMP NULL,
  sort_order INT NOT NULL DEFAULT 1,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_design_steps_draft (draft_id, sort_order),
  INDEX idx_process_design_steps_process (process_id, sort_order),
  INDEX idx_process_design_steps_status (draft_id, status, sort_order),
  CHECK (step_type IN ('action','decision')),
  CHECK (status IN ('active','voided')),
  CONSTRAINT fk_process_design_steps_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE CASCADE,
  CONSTRAINT fk_process_design_steps_process FOREIGN KEY (process_id)
    REFERENCES process_design_processes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_step_transitions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  process_id BIGINT NOT NULL,
  from_step_id BIGINT NOT NULL,
  condition_text VARCHAR(255) NOT NULL,
  to_step_id BIGINT NULL,
  evidence_refs_json JSON NULL,
  sort_order INT NOT NULL DEFAULT 1,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_design_step_transitions_draft (draft_id, sort_order),
  INDEX idx_process_design_step_transitions_process (process_id, from_step_id),
  CONSTRAINT fk_process_design_step_transitions_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE CASCADE,
  CONSTRAINT fk_process_design_step_transitions_process FOREIGN KEY (process_id)
    REFERENCES process_design_processes(id) ON DELETE CASCADE,
  CONSTRAINT fk_process_design_step_transitions_from_step FOREIGN KEY (from_step_id)
    REFERENCES process_design_steps(id) ON DELETE CASCADE,
  CONSTRAINT fk_process_design_step_transitions_to_step FOREIGN KEY (to_step_id)
    REFERENCES process_design_steps(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_behavior_details (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  step_id BIGINT NOT NULL,
  precondition TEXT NULL,
  trigger_scene TEXT NULL,
  execution_standard TEXT NULL,
  delivery_object TEXT NULL,
  requires_approval TINYINT NOT NULL DEFAULT 0,
  approval_note TEXT NULL,
  is_cross_department TINYINT NOT NULL DEFAULT 0,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_design_behavior_details_step (step_id),
  CONSTRAINT fk_process_design_behavior_details_step FOREIGN KEY (step_id)
    REFERENCES process_design_steps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_cross_dept_handoffs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  step_id BIGINT NOT NULL,
  target_department VARCHAR(255) NOT NULL,
  target_process_code VARCHAR(128) NULL,
  target_process_name VARCHAR(255) NULL,
  target_behavior_code VARCHAR(128) NULL,
  target_behavior_name VARCHAR(255) NULL,
  handoff_standard TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_return',
  returned_by BIGINT NULL,
  returned_at TIMESTAMP NULL,
  sort_order INT NOT NULL DEFAULT 1,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_design_handoffs_step (step_id, sort_order),
  CHECK (status IN ('pending_return','returned','pending_review','confirmed')),
  CONSTRAINT fk_process_design_handoffs_step FOREIGN KEY (step_id)
    REFERENCES process_design_steps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_forms (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  step_id BIGINT NULL,
  form_code VARCHAR(160) NULL,
  form_name VARCHAR(255) NOT NULL,
  main_table_code VARCHAR(180) NULL,
  main_table_name VARCHAR(255) NULL,
  archive_location ENUM('部门自行保存','资料室') NULL,
  retention_period ENUM('1年','3年','10年','永久') NULL,
  responsible_department_id BIGINT NULL,
  responsible_department_name VARCHAR(255) NULL,
  responsible_role VARCHAR(255) NULL,
  description TEXT NULL,
  archive_rule TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_design_forms_draft (draft_id),
  INDEX idx_process_design_forms_step (step_id),
  CHECK (status IN ('draft','submitted','published','retired')),
  CONSTRAINT fk_process_design_forms_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE CASCADE,
  CONSTRAINT fk_process_design_forms_step FOREIGN KEY (step_id)
    REFERENCES process_design_steps(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_form_tables (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  form_id BIGINT NOT NULL,
  table_kind VARCHAR(32) NOT NULL DEFAULT 'main',
  table_no VARCHAR(128) NULL,
  table_code VARCHAR(180) NULL,
  table_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_design_form_tables_form (form_id, sort_order),
  CHECK (table_kind IN ('main','detail')),
  CONSTRAINT fk_process_design_form_tables_form FOREIGN KEY (form_id)
    REFERENCES process_design_forms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_form_table_fields (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  form_table_id BIGINT NOT NULL,
  structure_kind ENUM('main','detail') NOT NULL,
  field_no VARCHAR(128) NULL,
  field_code VARCHAR(220) NULL,
  field_name VARCHAR(255) NOT NULL,
  field_type VARCHAR(128) NULL,
  enum_options TEXT NULL,
  is_required TINYINT NOT NULL DEFAULT 0,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_design_table_fields_table (form_table_id, sort_order),
  CONSTRAINT fk_process_design_table_fields_table FOREIGN KEY (form_table_id)
    REFERENCES process_design_form_tables(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_field_types (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL COMMENT '字段类型名称，默认含二维码',
  sort_order INT NOT NULL DEFAULT 1,
  is_active TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_design_field_types_code (code),
  UNIQUE KEY uq_process_design_field_types_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_form_fields (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  form_id BIGINT NOT NULL,
  field_name_cn VARCHAR(255) NOT NULL,
  field_name_en VARCHAR(255) NULL,
  data_object VARCHAR(255) NULL,
  field_type VARCHAR(128) NULL,
  enum_options TEXT NULL,
  evidence_note TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'suggested',
  sort_order INT NOT NULL DEFAULT 1,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_design_fields_form (form_id, sort_order),
  CHECK (status IN ('suggested','business_confirmed','data_governed','published','retired')),
  CONSTRAINT fk_process_design_fields_form FOREIGN KEY (form_id)
    REFERENCES process_design_forms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_evidence (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  object_type VARCHAR(64) NOT NULL,
  object_id BIGINT NULL,
  evidence_type VARCHAR(128) NOT NULL,
  description TEXT NOT NULL,
  source_name VARCHAR(512) NULL,
  source_anchor VARCHAR(512) NULL,
  confirmer VARCHAR(255) NULL,
  record_time VARCHAR(128) NULL,
  missing_reason TEXT NULL,
  expected_provider VARCHAR(255) NULL,
  expected_at VARCHAR(128) NULL,
  maturity VARCHAR(64) NOT NULL DEFAULT '可保存草稿',
  status ENUM('verified','pending_review','source_missing','ocr_extracted_not_confirmed','review_only') NOT NULL DEFAULT 'pending_review',
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_design_evidence_draft (draft_id),
  INDEX idx_process_design_evidence_status (status),
  CHECK (object_type IN ('process','step','form','field')),
  CONSTRAINT fk_process_design_evidence_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_risks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  object_type VARCHAR(64) NOT NULL,
  object_id BIGINT NULL,
  message TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  handled_by BIGINT NULL,
  handled_at TIMESTAMP NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_process_design_risks_draft (draft_id, status),
  CHECK (status IN ('open','confirmed','needs_fix','accepted','rejected')),
  CONSTRAINT fk_process_design_risks_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_review_tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  task_type VARCHAR(64) NOT NULL DEFAULT 'department_review',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  assignee_role VARCHAR(128) NULL,
  decision_note TEXT NULL,
  decided_by BIGINT NULL,
  decided_at TIMESTAMP NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_process_design_review_tasks_draft (draft_id, status),
  CHECK (task_type IN ('department_review','capability_review','publish_review')),
  CHECK (status IN ('pending','approved','rejected','needs_changes')),
  CONSTRAINT fk_process_design_review_tasks_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_user_id BIGINT NULL,
  note TEXT NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_process_design_events_draft (draft_id, created_at),
  CONSTRAINT fk_process_design_events_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_design_versions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL,
  document_no VARCHAR(128) NOT NULL,
  document_title VARCHAR(255) NOT NULL,
  edition VARCHAR(16) NOT NULL,
  version_no VARCHAR(128) NOT NULL,
  department_id BIGINT NOT NULL,
  l1_name VARCHAR(255) NOT NULL,
  l2_name VARCHAR(255) NOT NULL,
  l3_name VARCHAR(255) NOT NULL,
  content_json JSON NOT NULL,
  published_by BIGINT NULL,
  published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  supersedes_version_id BIGINT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'published',
  UNIQUE KEY uq_process_design_versions_no (version_no),
  UNIQUE KEY uq_process_design_versions_document_edition (document_no, edition),
  INDEX idx_process_design_versions_draft (draft_id),
  INDEX idx_process_design_versions_document (document_id, status),
  CHECK (status IN ('published','superseded','retired')),
  CONSTRAINT fk_process_design_versions_draft FOREIGN KEY (draft_id)
    REFERENCES process_design_drafts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_design_versions_document FOREIGN KEY (document_id)
    REFERENCES process_design_documents(id) ON DELETE RESTRICT,
  CONSTRAINT fk_process_design_versions_supersedes FOREIGN KEY (supersedes_version_id)
    REFERENCES process_design_versions(id) ON DELETE SET NULL,
  CONSTRAINT fk_process_design_versions_department FOREIGN KEY (department_id)
    REFERENCES departments(id) ON DELETE RESTRICT
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
  created_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by BIGINT NULL,
  approved_by_person_id BIGINT NULL,
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

CREATE TABLE IF NOT EXISTS mdm_mapping_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  process_mapping_record_id BIGINT NOT NULL,
  description TEXT NULL,
  approval_dept_id BIGINT NULL,
  owner_dept_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  submitted_by BIGINT NULL,
  submitted_by_person_id BIGINT NULL,
  submitted_at TIMESTAMP NULL,
  current_step INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mdm_mapping_records_process (process_mapping_record_id),
  INDEX idx_mdm_mapping_records_owner_dept (owner_dept_id),
  INDEX idx_mdm_mapping_records_status (status),
  CHECK (status IN ('draft','submitted','dept_reviewed','cross_confirmed','fields_confirmed','final_reviewed','published')),
  CONSTRAINT fk_mdm_mapping_records_process FOREIGN KEY (process_mapping_record_id)
    REFERENCES process_mapping_records(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mdm_mapping_records_owner_dept FOREIGN KEY (owner_dept_id)
    REFERENCES departments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mdm_mapping_records_approval_dept FOREIGN KEY (approval_dept_id)
    REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_mapping_system_links (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mapping_id BIGINT NOT NULL,
  system_id BIGINT NULL,
  system_name VARCHAR(255) NULL,
  system_role VARCHAR(64) NOT NULL DEFAULT 'secondary',
  sort_order INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mdm_mapping_system_links_mapping (mapping_id),
  CONSTRAINT fk_mdm_mapping_system_links_mapping FOREIGN KEY (mapping_id)
    REFERENCES mdm_mapping_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_mapping_related_departments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mapping_id BIGINT NOT NULL,
  department_id BIGINT NOT NULL,
  relation VARCHAR(64) NOT NULL DEFAULT 'collaborator',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mdm_mapping_related_departments_mapping (mapping_id),
  INDEX idx_mdm_mapping_related_departments_dept (department_id),
  CONSTRAINT fk_mdm_mapping_related_departments_mapping FOREIGN KEY (mapping_id)
    REFERENCES mdm_mapping_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_mdm_mapping_related_departments_dept FOREIGN KEY (department_id)
    REFERENCES departments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_mapping_approval_tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mapping_id BIGINT NOT NULL,
  step INT NOT NULL,
  step_name VARCHAR(255) NOT NULL,
  assignee_user_id BIGINT NULL,
  assignee_person_id BIGINT NULL,
  assigned_dept_id BIGINT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  opinion TEXT NULL,
  operated_by BIGINT NULL,
  operated_by_person_id BIGINT NULL,
  operated_at TIMESTAMP NULL,
  reject_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mdm_mapping_approval_tasks_mapping_step (mapping_id, step),
  INDEX idx_mdm_mapping_approval_tasks_assignee (assignee_user_id),
  INDEX idx_mdm_mapping_approval_tasks_dept (assigned_dept_id),
  CHECK (status IN ('pending','in_progress','approved','rejected','blocked')),
  CONSTRAINT fk_mdm_mapping_approval_tasks_mapping FOREIGN KEY (mapping_id)
    REFERENCES mdm_mapping_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_mapping_approval_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mapping_id BIGINT NOT NULL,
  step INT NOT NULL,
  operator_user_id BIGINT NULL,
  operator_person_id BIGINT NULL,
  action VARCHAR(64) NOT NULL,
  opinion TEXT NULL,
  operated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mdm_mapping_approval_history_mapping (mapping_id, operated_at),
  CONSTRAINT fk_mdm_mapping_approval_history_mapping FOREIGN KEY (mapping_id)
    REFERENCES mdm_mapping_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_mapping_rejection_reasons (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mapping_id BIGINT NOT NULL,
  field_entry_id BIGINT NULL,
  rejection_reason TEXT NOT NULL,
  rejected_by BIGINT NULL,
  rejected_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mdm_mapping_rejection_reasons_mapping (mapping_id, created_at),
  CONSTRAINT fk_mdm_mapping_rejection_reasons_mapping FOREIGN KEY (mapping_id)
    REFERENCES mdm_mapping_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_map_objects (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  object_key VARCHAR(180) NOT NULL,
  object_name_cn VARCHAR(255) NOT NULL,
  object_name_en VARCHAR(255) NULL,
  object_type VARCHAR(64) NOT NULL DEFAULT 'master_data_reviewItem',
  owner_dept_id BIGINT NULL,
  steward_user_id BIGINT NULL,
  steward_person_id BIGINT NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  source_type VARCHAR(64) NOT NULL DEFAULT 'manual',
  source_ref VARCHAR(512) NULL,
  created_by BIGINT NULL,
  created_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NULL,
  updated_by_person_id BIGINT NULL,
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
  owner_person_id BIGINT NULL,
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
  created_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NULL,
  updated_by_person_id BIGINT NULL,
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
  master_data_level VARCHAR(32) NOT NULL DEFAULT 'needs_review',
  process_governance_node_key VARCHAR(255) NULL,
  process_governance_a1_code VARCHAR(128) NULL,
  source_file VARCHAR(512) NULL,
  source_anchor VARCHAR(255) NULL,
  source_excerpt MEDIUMTEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  quality_status VARCHAR(32) NOT NULL DEFAULT 'unchecked',
  submitted_by BIGINT NULL,
  submitted_by_person_id BIGINT NULL,
  submitted_at TIMESTAMP NULL,
  reviewed_by BIGINT NULL,
  reviewed_by_person_id BIGINT NULL,
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
  CHECK (relation_type IN ('producer','consumer','reviewItem_authority','authority')),
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
  owner_person_id BIGINT NULL,
  confidence_level VARCHAR(32) NOT NULL DEFAULT 'medium',
  confirmed TINYINT NOT NULL DEFAULT 0,
  confirmed_by BIGINT NULL,
  confirmed_by_person_id BIGINT NULL,
  confirmed_at TIMESTAMP NULL,
  note TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'needs_review',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_data_map_field_identities_field (field_id),
  INDEX idx_data_map_field_identities_dept (maintain_dept_id),
  INDEX idx_data_map_field_identities_owner (owner_user_id),
  CHECK (confidence_level IN ('low','medium','high')),
  CHECK (status IN ('needs_review','confirmed','rejected','archived')),
  CONSTRAINT fk_data_map_field_identities_field FOREIGN KEY (field_id)
    REFERENCES data_map_fields(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_field_conflicts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  field_id_a BIGINT NOT NULL,
  field_id_b BIGINT NOT NULL,
  conflict_field VARCHAR(128) NOT NULL,
  submitter_a BIGINT NULL,
  value_a TEXT NULL,
  submitter_b BIGINT NULL,
  value_b TEXT NULL,
  dept_a BIGINT NULL,
  dept_b BIGINT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'warn',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  resolution TEXT NULL,
  resolution_type VARCHAR(64) NULL,
  resolved_by BIGINT NULL,
  resolved_at TIMESTAMP NULL,
  deadline DATE NULL,
  escalated TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mdm_field_conflicts_active (field_id_a, field_id_b, conflict_field, status),
  INDEX idx_mdm_field_conflicts_status (status, severity),
  INDEX idx_mdm_field_conflicts_dept_a (dept_a),
  INDEX idx_mdm_field_conflicts_dept_b (dept_b),
  CHECK (severity IN ('blocking','error','high','medium','low','warn')),
  CHECK (status IN ('pending','coordinating','escalated','resolved','silenced','archived')),
  CONSTRAINT fk_mdm_field_conflicts_a FOREIGN KEY (field_id_a)
    REFERENCES data_map_fields(id) ON DELETE CASCADE,
  CONSTRAINT fk_mdm_field_conflicts_b FOREIGN KEY (field_id_b)
    REFERENCES data_map_fields(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_term_conflicts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  term VARCHAR(255) NOT NULL,
  term_a_id BIGINT NULL,
  term_b_id BIGINT NULL,
  dept_a BIGINT NULL,
  dept_a_meaning TEXT NULL,
  dept_b BIGINT NULL,
  dept_b_meaning TEXT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'warn',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  resolution TEXT NULL,
  resolution_type VARCHAR(64) NULL,
  resolved_by BIGINT NULL,
  resolved_at TIMESTAMP NULL,
  deadline DATE NULL,
  escalated TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mdm_term_conflicts_term (term),
  INDEX idx_mdm_term_conflicts_status (status, severity),
  INDEX idx_mdm_term_conflicts_dept_a (dept_a),
  INDEX idx_mdm_term_conflicts_dept_b (dept_b),
  CHECK (severity IN ('blocking','error','high','medium','low','warn')),
  CHECK (status IN ('pending','coordinating','escalated','resolved','silenced','archived')),
  CONSTRAINT fk_mdm_term_conflicts_a FOREIGN KEY (term_a_id)
    REFERENCES terminology_terms(id) ON DELETE SET NULL,
  CONSTRAINT fk_mdm_term_conflicts_b FOREIGN KEY (term_b_id)
    REFERENCES terminology_terms(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_conflict_assignments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conflict_id BIGINT NOT NULL,
  conflict_type VARCHAR(16) NOT NULL,
  assignee_user_id BIGINT NOT NULL,
  assignee_person_id BIGINT NULL,
  assigned_by BIGINT NULL,
  assigned_by_person_id BIGINT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mdm_conflict_assignments_conflict (conflict_type, conflict_id),
  INDEX idx_mdm_conflict_assignments_assignee (assignee_user_id),
  CHECK (conflict_type IN ('field','term')),
  CHECK (status IN ('active','inactive','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_conflict_coordination_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conflict_id BIGINT NOT NULL,
  conflict_type VARCHAR(16) NOT NULL,
  assignee_user_id BIGINT NULL,
  assignee_person_id BIGINT NULL,
  result VARCHAR(32) NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mdm_conflict_coordination_conflict (conflict_type, conflict_id, created_at),
  CHECK (conflict_type IN ('field','term')),
  CHECK (result IN ('A','B','compromise'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_todos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  from_dept_id BIGINT NULL,
  to_dept_id BIGINT NULL,
  type VARCHAR(64) NOT NULL DEFAULT 'general',
  related_mapping_id BIGINT NULL,
  related_field_id BIGINT NULL,
  content TEXT NOT NULL,
  due_date DATE NULL,
  urgency VARCHAR(16) NOT NULL DEFAULT 'medium',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  done_at TIMESTAMP NULL,
  completed_by BIGINT NULL,
  completed_by_person_id BIGINT NULL,
  created_by BIGINT NULL,
  created_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mdm_todos_to_dept (to_dept_id, status),
  INDEX idx_mdm_todos_type_status (type, status),
  CHECK (urgency IN ('low','medium','high')),
  CHECK (status IN ('pending','done','closed','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_todo_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  todo_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_user_id BIGINT NULL,
  actor_person_id BIGINT NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mdm_todo_events_todo (todo_id, created_at),
  CONSTRAINT fk_mdm_todo_events_todo FOREIGN KEY (todo_id)
    REFERENCES mdm_todos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_change_sets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BIGINT NOT NULL,
  operated_by BIGINT NULL,
  operated_by_person_id BIGINT NULL,
  operated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description TEXT NULL,
  metadata_json MEDIUMTEXT NULL,
  INDEX idx_mdm_change_sets_entity (entity_type, entity_id, operated_at),
  INDEX idx_mdm_change_sets_operator (operated_by, operated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mdm_version_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BIGINT NOT NULL,
  field_name VARCHAR(128) NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  operation VARCHAR(64) NOT NULL,
  operated_by BIGINT NULL,
  operated_by_person_id BIGINT NULL,
  operated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  change_set_id BIGINT NULL,
  metadata_json MEDIUMTEXT NULL,
  INDEX idx_mdm_version_log_entity (entity_type, entity_id, operated_at),
  INDEX idx_mdm_version_log_change_set (change_set_id),
  INDEX idx_mdm_version_log_operator (operated_by, operated_at),
  CONSTRAINT fk_mdm_version_log_change_set FOREIGN KEY (change_set_id)
    REFERENCES mdm_change_sets(id) ON DELETE SET NULL
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
  created_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NULL,
  updated_by_person_id BIGINT NULL,
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
  created_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NULL,
  updated_by_person_id BIGINT NULL,
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
  created_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by BIGINT NULL,
  resolved_by_person_id BIGINT NULL,
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
  operated_by_person_id BIGINT NULL,
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
  operated_by_person_id BIGINT NULL,
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
