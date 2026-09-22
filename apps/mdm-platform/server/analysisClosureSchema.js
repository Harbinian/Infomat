// Append-only decisions; existing issues/todos remain the only business entities.
const MIGRATION_KEY = '2026-09-17-analysis-closure-v1';
const tables = ['data_map_analysis_issue_closure_events','data_map_analysis_issue_closure_heads'];
const statements = () => [`CREATE TABLE IF NOT EXISTS data_map_analysis_issue_closure_events (
  event_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  issue_id BIGINT NOT NULL,
  revision_no INT NOT NULL,
  action VARCHAR(24) NOT NULL,
  actor_person_id BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_analysis_closure_revision (issue_id,revision_no),
  INDEX fk_analysis_closure_actor (actor_person_id),
  CONSTRAINT fk_analysis_closure_issue FOREIGN KEY (issue_id) REFERENCES data_map_analysis_issue_bindings(issue_id),
  CONSTRAINT fk_analysis_closure_actor FOREIGN KEY (actor_person_id) REFERENCES person(person_id),
  CHECK (revision_no > 0),
  CHECK (action IN ('designate','reject','close','reopen','suspend'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, `CREATE TABLE IF NOT EXISTS data_map_analysis_issue_closure_heads (
  issue_id BIGINT NOT NULL PRIMARY KEY,
  event_id BIGINT NOT NULL,
  event_digest CHAR(64) NOT NULL,
  INDEX fk_analysis_closure_head_event (event_id),
  CONSTRAINT fk_analysis_closure_head_issue FOREIGN KEY (issue_id) REFERENCES data_map_analysis_issue_bindings(issue_id),
  CONSTRAINT fk_analysis_closure_head_event FOREIGN KEY (event_id) REFERENCES data_map_analysis_issue_closure_events(event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`];
module.exports = { MIGRATION_KEY, tables, statements };
