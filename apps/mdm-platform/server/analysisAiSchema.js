// Additive attempt audit; no changes or backfill to existing analysis/governance rows.
const MIGRATION_KEY = '2026-09-18-analysis-ai-offline-v1';
const tables = ['data_map_analysis_ai_outputs'];
const statements = () => [`CREATE TABLE IF NOT EXISTS data_map_analysis_ai_outputs (
  attempt_id BIGINT PRIMARY KEY,
  run_id BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX fk_dm_aio_run (run_id),
  CONSTRAINT fk_dm_aio_attempt FOREIGN KEY (attempt_id) REFERENCES data_map_analysis_attempts(attempt_id),
  CONSTRAINT fk_dm_aio_run FOREIGN KEY (run_id) REFERENCES data_map_analysis_runs(run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`];
module.exports = { MIGRATION_KEY, tables, statements };
