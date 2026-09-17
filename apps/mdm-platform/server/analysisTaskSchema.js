// Additive association only: governance issues and office todos remain the sole entities.
const MIGRATION_KEY = '2026-09-17-analysis-office-tasks-v1';
const tables = ['data_map_analysis_issue_tasks'];
const SQL = `CREATE TABLE IF NOT EXISTS data_map_analysis_issue_tasks (
  todo_id BIGINT NOT NULL PRIMARY KEY,
  issue_id BIGINT NOT NULL,
  purpose VARCHAR(16) NOT NULL,
  round_no INT NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  created_by_person_id BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_analysis_issue_action (issue_id,purpose,round_no),
  INDEX fk_analysis_task_actor (created_by_person_id),
  CONSTRAINT fk_analysis_task_todo FOREIGN KEY (todo_id) REFERENCES mdm_todo_office_assignments(todo_id),
  CONSTRAINT fk_analysis_task_issue FOREIGN KEY (issue_id) REFERENCES data_map_analysis_issue_bindings(issue_id),
  CONSTRAINT fk_analysis_task_actor FOREIGN KEY (created_by_person_id) REFERENCES person(person_id),
  CHECK (round_no > 0),
  CHECK (purpose IN ('verify','correct','coordinate','review'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
module.exports = { MIGRATION_KEY, tables, statements: () => [SQL] };
