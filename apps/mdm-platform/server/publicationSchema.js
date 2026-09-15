// Additive schema. Existing identity and governance rows are not migrated or rewritten.
const MIGRATION_KEY = '2026-09-14-mdm-publications-v1';
const PUBLICATION_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS mdm_publications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  publication_ref CHAR(36) NOT NULL,
  request_id CHAR(36) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  dataset_key VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  version_no INT NOT NULL,
  previous_publication_id BIGINT NULL,
  source_file_name VARCHAR(255) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  payload_json LONGTEXT NOT NULL,
  row_count INT NOT NULL,
  published_by_person_id BIGINT NOT NULL,
  published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mdm_publication_ref (publication_ref),
  UNIQUE KEY uq_mdm_publication_request (request_id),
  UNIQUE KEY uq_mdm_publication_version (kind, dataset_key, version_no),
  CHECK (kind IN ('organization','roster','master_data')),
  CHECK ((version_no > 0) AND (row_count > 0)),
  CHECK (JSON_VALID(payload_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function managePublicationSchema(connection, action) {
  const inspect = async () => {
    const [tables] = await connection.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mdm_publications'");
    const [records] = await connection.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
    if (!tables.length) return { state: records.length ? 'drift' : 'absent', matching: false, recorded: records.length > 0 };
    const [creates] = await connection.execute('SHOW CREATE TABLE mdm_publications');
    const actual = creates[0]['Create Table'];
    const matching = require('./processV7M0Baseline').compareCreateStatements(PUBLICATION_SCHEMA_SQL, actual).matching && /ENGINE=InnoDB/i.test(actual) && /COLLATE[= ]+utf8mb4_unicode_ci/i.test(actual);
    return { state: matching ? (records.length ? 'applied' : 'unrecorded') : 'drift', matching, recorded: records.length > 0 };
  };
  const before = await inspect();
  if (action === 'inspect') return before;
  if (action !== 'apply') throw new Error('PUBLICATION_MIGRATION_ACTION_INVALID');
  if (before.state === 'drift') throw new Error('PUBLICATION_SCHEMA_DRIFT');
  if (before.state === 'applied') return before;
  if (before.state === 'absent') await connection.execute(PUBLICATION_SCHEMA_SQL);
  // Additive registration is safe for existing matching tables; published rows stay intact.
  await connection.execute('INSERT INTO schema_migrations (migration_key) VALUES (?)', [MIGRATION_KEY]);
  return inspect();
}

module.exports = { MIGRATION_KEY, PUBLICATION_SCHEMA_SQL, managePublicationSchema };
