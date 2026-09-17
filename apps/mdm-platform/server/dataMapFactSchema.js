// Additive directed fact requests, not a second governance issue pool.
const MIGRATION_KEY='2026-09-16-data-map-facts-v1';
const definitions={
  data_map_fact_requests:`
  fact_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  subject_version_id BIGINT NOT NULL,
  object_version_id BIGINT NOT NULL,
  scope_department_id BIGINT NOT NULL,
  target_department_id BIGINT NULL,
  target_person_id BIGINT NULL,
  status VARCHAR(24) NOT NULL,
  revision_no INT NOT NULL,
  data_json JSON NOT NULL,
  created_by_person_id BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX ix_dm_fact_target (target_department_id,target_person_id,fact_id),
  INDEX fk_dm_fact_subject (subject_version_id),
  INDEX fk_dm_fact_object (object_version_id),
  INDEX fk_dm_fact_scope (scope_department_id),
  INDEX fk_dm_fact_person (target_person_id),
  CONSTRAINT fk_dm_fact_subject FOREIGN KEY (subject_version_id) REFERENCES data_map_definition_versions(version_id),
  CONSTRAINT fk_dm_fact_object FOREIGN KEY (object_version_id) REFERENCES data_map_definition_versions(version_id),
  CONSTRAINT fk_dm_fact_scope FOREIGN KEY (scope_department_id) REFERENCES departments(id),
  CONSTRAINT fk_dm_fact_target FOREIGN KEY (target_department_id) REFERENCES departments(id),
  CONSTRAINT fk_dm_fact_person FOREIGN KEY (target_person_id) REFERENCES person(person_id),
  CHECK (revision_no > 0),
  CHECK (status IN ('draft','requested','answered','needs_more_info','checked')),
  CHECK (status = 'draft' OR target_department_id IS NOT NULL),
  CHECK (target_person_id IS NULL OR target_department_id IS NOT NULL)`,
  data_map_fact_events:`
  fact_event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  fact_id BIGINT NOT NULL,
  revision_no INT NOT NULL,
  action VARCHAR(24) NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  actor_person_id BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_dm_fact_revision (fact_id,revision_no),
  CONSTRAINT fk_dm_fact_event FOREIGN KEY (fact_id) REFERENCES data_map_fact_requests(fact_id),
  CHECK (revision_no > 0),
  CHECK (action IN ('create','edit','send','answer','more_info','rebind','check'))`
};
const tables=Object.keys(definitions);
const statements=()=>Object.entries(definitions).map(([table,body])=>`CREATE TABLE IF NOT EXISTS ${table} (${body}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
module.exports={MIGRATION_KEY,tables,statements};
