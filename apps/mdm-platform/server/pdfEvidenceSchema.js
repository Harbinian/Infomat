// Additive snapshot table; existing source batch/input foreign keys are reused.
const MIGRATION_KEY = '2026-09-18-pdf-evidence-v1';
const tables = ['data_map_pdf_evidence'];
const statements = () => [`CREATE TABLE IF NOT EXISTS data_map_pdf_evidence (
  batch_id BIGINT PRIMARY KEY,
  snapshot_json JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  CONSTRAINT fk_dm_pdf_batch FOREIGN KEY (batch_id) REFERENCES data_map_source_files(batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`];
module.exports = { MIGRATION_KEY, tables, statements };
