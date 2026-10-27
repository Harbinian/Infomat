// Explicit migration input only. Runtime code must never execute this DDL.
const MIGRATION_KEY = '2026-10-20-terminology-governance-v1';
const TABLES = Object.freeze(['tg_terms','tg_term_versions','tg_term_events','tg_requests','tg_assignments','tg_challenges','tg_challenge_opinions','tg_legacy_links']);
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tg_terms (
  term_id CHAR(36) PRIMARY KEY,
  concept_key VARCHAR(255) NULL,
  context_hash CHAR(64) NULL,
  concept_hash CHAR(64) NULL,
  department_id BIGINT NULL,
  created_by_person_id BIGINT NULL,
  current_version_id CHAR(36) NULL,
  pending_version_id CHAR(36) NULL,
  draft_status VARCHAR(32) NOT NULL DEFAULT 'draft',
  adoption_status VARCHAR(32) NOT NULL DEFAULT 'never_adopted',
  source_status VARCHAR(32) NOT NULL DEFAULT 'current',
  department_confirmation_json JSON NULL,
  source_check_json JSON NULL,
  suspension_json JSON NULL,
  merged_into_id CHAR(36) NULL,
  legacy_unverified TINYINT NOT NULL DEFAULT 0,
  legacy_status VARCHAR(64) NULL,
  legacy_usable TINYINT NULL,
  revision_no INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tg_context_concept (context_hash,concept_hash),
  INDEX idx_tg_department (department_id),
  CHECK (revision_no > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tg_term_versions (
  version_id CHAR(36) PRIMARY KEY,
  term_id CHAR(36) NOT NULL,
  version_no INT NOT NULL,
  content_json JSON NOT NULL,
  content_hash CHAR(64) NOT NULL,
  created_by_person_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tg_term_version (term_id,version_no),
  CONSTRAINT fk_tg_version_term FOREIGN KEY (term_id) REFERENCES tg_terms(term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tg_term_events (
  event_id CHAR(36) PRIMARY KEY,
  term_id CHAR(36) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  version_id CHAR(36) NULL,
  revision_no INT NOT NULL,
  actor_person_id BIGINT NULL,
  actor_department_id BIGINT NULL,
  reason TEXT NULL,
  payload_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tg_event_term (term_id,created_at,event_id),
  CONSTRAINT fk_tg_event_term FOREIGN KEY (term_id) REFERENCES tg_terms(term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tg_requests (
  actor_person_id BIGINT NOT NULL,
  request_id VARCHAR(80) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_person_id,request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tg_assignments (
  assignment_id CHAR(36) PRIMARY KEY,
  term_id CHAR(36) NOT NULL,
  assignee_person_id BIGINT NOT NULL,
  assigned_by_person_id BIGINT NOT NULL,
  active TINYINT NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tg_assignment (term_id,assignee_person_id,active),
  CONSTRAINT fk_tg_assignment_term FOREIGN KEY (term_id) REFERENCES tg_terms(term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tg_challenges (
  challenge_id CHAR(36) PRIMARY KEY,
  term_id CHAR(36) NOT NULL,
  version_id CHAR(36) NOT NULL,
  raised_by_person_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  reason TEXT NOT NULL,
  affected_departments_json JSON NULL,
  coordination_json JSON NULL,
  conclusion_json JSON NULL,
  feedback_json JSON NULL,
  revision_no INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tg_challenge_term (term_id,created_at),
  CONSTRAINT fk_tg_challenge_term FOREIGN KEY (term_id) REFERENCES tg_terms(term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tg_challenge_opinions (
  opinion_id CHAR(36) PRIMARY KEY,
  challenge_id CHAR(36) NOT NULL,
  department_id BIGINT NOT NULL,
  actor_person_id BIGINT NOT NULL,
  opinion_revision INT NOT NULL,
  conclusion_key VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  authority_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tg_opinion_revision (challenge_id,opinion_revision),
  INDEX idx_tg_opinion_challenge (challenge_id,department_id,opinion_revision),
  CONSTRAINT fk_tg_opinion_challenge FOREIGN KEY (challenge_id) REFERENCES tg_challenges(challenge_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tg_legacy_links (
  legacy_table VARCHAR(64) NOT NULL,
  legacy_id VARCHAR(255) NOT NULL,
  term_id CHAR(36) NOT NULL,
  version_id CHAR(36) NOT NULL,
  snapshot_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (legacy_table,legacy_id),
  INDEX idx_tg_legacy_term (term_id),
  CONSTRAINT fk_tg_legacy_term FOREIGN KEY (term_id) REFERENCES tg_terms(term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;
const statements = () => SCHEMA_SQL.split(';').map(value => value.trim()).filter(Boolean);
module.exports = { MIGRATION_KEY, TABLES, SCHEMA_SQL, statements };
