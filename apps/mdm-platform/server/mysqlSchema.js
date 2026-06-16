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
