// P08 additive design records. Existing V7 documents and ledger versions stay immutable.
const MIGRATION_KEY='2026-09-17-design-handoffs-v1';
const definitions={
  data_map_design_handoffs:`
  handoff_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  revision_no INT NOT NULL,
  CHECK (revision_no > 0)`,
  data_map_design_handoff_versions:`
  handoff_version_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  handoff_id BIGINT NOT NULL,
  revision_no INT NOT NULL,
  claim_status VARCHAR(24) NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  actor_person_id BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_dm_design_revision (handoff_id,revision_no),
  CONSTRAINT fk_dm_design_head FOREIGN KEY (handoff_id) REFERENCES data_map_design_handoffs(handoff_id),
  CHECK (revision_no > 0),
  CHECK (claim_status IN ('material_declared','human_confirmed','analysis_pending'))`,
  data_map_design_handoff_refs:`
  handoff_version_id BIGINT NOT NULL,
  mapping_version_id BIGINT NOT NULL,
  side VARCHAR(8) NOT NULL,
  PRIMARY KEY (handoff_version_id,mapping_version_id,side),
  INDEX fk_dm_design_mapping (mapping_version_id),
  CONSTRAINT fk_dm_design_version FOREIGN KEY (handoff_version_id) REFERENCES data_map_design_handoff_versions(handoff_version_id),
  CONSTRAINT fk_dm_design_mapping FOREIGN KEY (mapping_version_id) REFERENCES data_map_v7_mapping_versions(mapping_version_id),
  CHECK (side IN ('source','target'))`
};
const tables=Object.keys(definitions);
const statements=()=>Object.entries(definitions).map(([table,body])=>`CREATE TABLE IF NOT EXISTS ${table} (${body}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
module.exports={MIGRATION_KEY,tables,statements};
