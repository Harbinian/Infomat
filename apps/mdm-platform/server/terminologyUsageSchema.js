// Additive explicit migration input. Never executed by application startup.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tg_usage_heads (
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(80) NOT NULL,
  revision_no INT NOT NULL,
  source_digest CHAR(64) NOT NULL,
  snapshot_json JSON NOT NULL,
  confirmation_json JSON NULL,
  fixed TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY(target_type,target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tg_usage_events (
  event_id CHAR(36) PRIMARY KEY,
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(80) NOT NULL,
  revision_no INT NOT NULL,
  actor_person_id BIGINT NULL,
  event_type VARCHAR(32) NOT NULL,
  snapshot_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tg_usage_subject(target_type,target_id,revision_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;
const statements=()=>SCHEMA_SQL.split(';').map(s=>s.trim()).filter(Boolean);
module.exports={SCHEMA_SQL,statements,TABLES:['tg_usage_heads','tg_usage_events']};
