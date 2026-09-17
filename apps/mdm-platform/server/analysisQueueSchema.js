// P10 additive queue. Explicit migration only; existing P09 runs are not enrolled.
const MIGRATION_KEY = '2026-09-17-analysis-queue-v1';
const definitions = {
  data_map_analysis_queue: `
  run_id BIGINT PRIMARY KEY,
  session_json JSON NOT NULL,
  policy_json JSON NOT NULL,
  state VARCHAR(16) NOT NULL,
  generation INT NOT NULL DEFAULT 0,
  token_hash CHAR(64) NULL,
  worker_id CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  available_at DATETIME(3) NOT NULL,
  deadline_at DATETIME(3) NULL,
  error_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX ix_dm_aq_ready (state,available_at),
  CONSTRAINT fk_dm_aq_run FOREIGN KEY (run_id) REFERENCES data_map_analysis_runs(run_id),
  CHECK (state IN ('ready','leased','done','cancelled','failed')),
  CHECK (generation >= 0),
  CHECK ((state = 'leased' AND token_hash IS NOT NULL AND worker_id IS NOT NULL AND lease_until IS NOT NULL AND deadline_at IS NOT NULL) OR
    (state <> 'leased' AND token_hash IS NULL AND lease_until IS NULL AND deadline_at IS NULL))`,
  data_map_analysis_queue_events: `
  event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT NOT NULL,
  generation INT NOT NULL,
  worker_id CHAR(36) NULL,
  event_type VARCHAR(32) NOT NULL,
  error_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX fk_dm_aqe_run (run_id),
  CONSTRAINT fk_dm_aqe_run FOREIGN KEY (run_id) REFERENCES data_map_analysis_queue(run_id)`,
  data_map_analysis_workers: `
  worker_id CHAR(36) PRIMARY KEY,
  runtime_json JSON NOT NULL,
  stop_requested TINYINT(1) NOT NULL DEFAULT 0,
  started_at DATETIME(3) NOT NULL,
  heartbeat_at DATETIME(3) NOT NULL,
  stopped_at DATETIME(3) NULL`
};
const tables = Object.keys(definitions);
const statements = () => Object.entries(definitions).map(([table, body]) => `CREATE TABLE IF NOT EXISTS ${table} (${body}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
module.exports = { MIGRATION_KEY, tables, statements };
