function mdmMysqlSchemaSql() {
  return `
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_key VARCHAR(160) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
