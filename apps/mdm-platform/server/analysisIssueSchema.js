// Additive confirmation metadata; the sole issue entity remains process_governance_issues.
const MIGRATION_KEY = '2026-09-17-analysis-issues-v1';
const definitions = {
  data_map_analysis_issue_bindings: `
  issue_id BIGINT PRIMARY KEY,
  owner_department_id BIGINT NOT NULL,
  revision_no INT NOT NULL,
  issue_digest CHAR(64) NOT NULL,
  created_by_person_id BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX fk_dm_aib_dept (owner_department_id),
  INDEX fk_dm_aib_person (created_by_person_id),
  CONSTRAINT fk_dm_aib_issue FOREIGN KEY (issue_id) REFERENCES process_governance_issues(issue_id),
  CONSTRAINT fk_dm_aib_dept FOREIGN KEY (owner_department_id) REFERENCES departments(id),
  CONSTRAINT fk_dm_aib_person FOREIGN KEY (created_by_person_id) REFERENCES person(person_id),
  CHECK (revision_no > 0)`,
  data_map_analysis_finding_reviews: `
  review_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  finding_id BIGINT NOT NULL,
  revision_no INT NOT NULL,
  decision VARCHAR(24) NOT NULL,
  issue_id BIGINT NULL,
  actor_person_id BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_dm_afr_revision (finding_id,revision_no),
  INDEX fk_dm_afr_issue (issue_id),
  INDEX fk_dm_afr_person (actor_person_id),
  CONSTRAINT fk_dm_afr_finding FOREIGN KEY (finding_id) REFERENCES data_map_analysis_findings(finding_id),
  CONSTRAINT fk_dm_afr_issue FOREIGN KEY (issue_id) REFERENCES data_map_analysis_issue_bindings(issue_id),
  CONSTRAINT fk_dm_afr_person FOREIGN KEY (actor_person_id) REFERENCES person(person_id),
  CHECK (revision_no > 1),
  CHECK (decision IN ('confirmed','not_an_issue','linked')),
  CHECK ((decision = 'linked' AND issue_id IS NOT NULL) OR (decision <> 'linked' AND issue_id IS NULL))`
};
const tables = Object.keys(definitions);
const statements = () => tables.map(t => `CREATE TABLE IF NOT EXISTS ${t} (${definitions[t]}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
module.exports = { MIGRATION_KEY, tables, statements };
