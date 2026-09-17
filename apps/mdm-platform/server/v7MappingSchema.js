// P07 additive fixed sources and append-only mapping revisions. No startup DDL.
const MIGRATION_KEY='2026-09-17-v7-mappings-v1';
const definitions={
  data_map_v7_sources:`
  source_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_key CHAR(64) NOT NULL,
  source_kind VARCHAR(24) NOT NULL,
  scope_department_id BIGINT NOT NULL,
  case_id BIGINT NULL,
  revision_id BIGINT NULL,
  process_version_id BIGINT NULL,
  raw_sha256 CHAR(64) NULL,
  byte_length INT NULL,
  original_name VARCHAR(255) NULL,
  content_digest CHAR(64) NULL,
  digest_algorithm VARCHAR(64) NOT NULL,
  validation_status VARCHAR(24) NOT NULL,
  validation_json JSON NOT NULL,
  content_json JSON NULL,
  created_by_person_id BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_dm_v7_source (source_key),
  INDEX fk_dm_v7_source_scope (scope_department_id),
  CONSTRAINT fk_dm_v7_source_scope FOREIGN KEY (scope_department_id) REFERENCES departments(id),
  CHECK (validation_status IN ('valid','parse_failed','validation_failed')),
  CHECK ((source_kind = 'uploaded_material' AND case_id IS NULL AND revision_id IS NULL AND process_version_id IS NULL AND raw_sha256 IS NOT NULL) OR
    (source_kind = 'preview_revision' AND case_id IS NOT NULL AND revision_id IS NOT NULL AND process_version_id IS NULL AND raw_sha256 IS NULL) OR
    (source_kind = 'published_version' AND case_id IS NULL AND revision_id IS NULL AND process_version_id IS NOT NULL AND raw_sha256 IS NULL))`,
  data_map_v7_mappings:`
  mapping_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id BIGINT NOT NULL,
  local_key CHAR(64) NOT NULL,
  local_object_ref VARCHAR(255) NOT NULL,
  local_field_ref VARCHAR(255) NULL,
  revision_no INT NOT NULL,
  UNIQUE KEY uq_dm_v7_local (source_id,local_key),
  CONSTRAINT fk_dm_v7_mapping_source FOREIGN KEY (source_id) REFERENCES data_map_v7_sources(source_id),
  CHECK (revision_no > 0)`,
  data_map_v7_mapping_versions:`
  mapping_version_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mapping_id BIGINT NOT NULL,
  revision_no INT NOT NULL,
  object_version_id BIGINT NOT NULL,
  field_version_id BIGINT NULL,
  parent_mapping_version_id BIGINT NULL,
  status VARCHAR(16) NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  actor_person_id BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_dm_v7_mapping_revision (mapping_id,revision_no),
  INDEX fk_dm_v7_map_object (object_version_id),
  INDEX fk_dm_v7_map_field (field_version_id),
  INDEX fk_dm_v7_map_parent (parent_mapping_version_id),
  CONSTRAINT fk_dm_v7_map_head FOREIGN KEY (mapping_id) REFERENCES data_map_v7_mappings(mapping_id),
  CONSTRAINT fk_dm_v7_map_object FOREIGN KEY (object_version_id) REFERENCES data_map_definition_versions(version_id),
  CONSTRAINT fk_dm_v7_map_field FOREIGN KEY (field_version_id) REFERENCES data_map_definition_versions(version_id),
  CONSTRAINT fk_dm_v7_map_parent FOREIGN KEY (parent_mapping_version_id) REFERENCES data_map_v7_mapping_versions(mapping_version_id),
  CHECK (revision_no > 0),
  CHECK (status IN ('candidate','confirmed')),
  CHECK ((field_version_id IS NULL AND parent_mapping_version_id IS NULL) OR (field_version_id IS NOT NULL AND parent_mapping_version_id IS NOT NULL))`
};
const tables=Object.keys(definitions);
const statements=()=>Object.entries(definitions).map(([table,body])=>`CREATE TABLE IF NOT EXISTS ${table} (${body}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
module.exports={MIGRATION_KEY,tables,statements};
