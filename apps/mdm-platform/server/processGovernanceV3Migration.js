const {
  CURRENT_VERSION,
  contentHash,
  normalizeProcessGovernanceDocument
} = require('./processGovernanceV2');

const MIGRATION_KEY = '2026-08-09-process-governance-v3-form-design-state';

function parseDocument(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function planStoredRows(rows, objectType) {
  const changes = [];
  const manual = [];
  for (const row of rows) {
    const parsed = parseDocument(row.process_content_json);
    if (!parsed) {
      manual.push({ object_type: objectType, object_id: Number(row.id), reason: '内容不是有效JSON对象' });
      continue;
    }
    const normalized = normalizeProcessGovernanceDocument(parsed);
    if (normalized.errors.length) {
      manual.push({
        object_type: objectType,
        object_id: Number(row.id),
        reason: '内容不能无损规范化为process-governance-v3',
        fields: normalized.errors.map(error => error.field).slice(0, 20)
      });
      continue;
    }
    const nextHash = contentHash(normalized.document);
    const changed = row.schema_version !== CURRENT_VERSION || row.content_hash !== nextHash;
    if (changed) {
      changes.push({
        object_type: objectType,
        object_id: Number(row.id),
        source_schema_version: parsed.schema_version,
        document: normalized.document,
        content_hash: nextHash,
        previous: {
          schema_version: row.schema_version,
          process_content_json: row.process_content_json,
          content_hash: row.content_hash
        }
      });
    }
  }
  return { changes, manual };
}

async function selectRows(pool, tableName) {
  const [rows] = await pool.execute(`
    SELECT id, schema_version, process_content_json, content_hash
    FROM ${tableName}
    WHERE process_content_json IS NOT NULL AND process_content_json<>''
    ORDER BY id
  `);
  return rows;
}

async function migrationApplied(pool) {
  const [rows] = await pool.execute(
    'SELECT migration_key FROM schema_migrations WHERE migration_key=?',
    [MIGRATION_KEY]
  );
  return Boolean(rows[0]);
}

async function buildPlan(pool) {
  const [draftRows, versionRows] = await Promise.all([
    selectRows(pool, 'process_design_drafts'),
    selectRows(pool, 'process_design_versions')
  ]);
  const drafts = planStoredRows(draftRows, 'draft');
  const versions = planStoredRows(versionRows, 'version');
  return {
    changes: [...drafts.changes, ...versions.changes],
    manual: [...drafts.manual, ...versions.manual],
    scanned_drafts: draftRows.length,
    scanned_versions: versionRows.length
  };
}

async function inspectProcessGovernanceV3(pool) {
  const plan = await buildPlan(pool);
  return {
    migration_key: MIGRATION_KEY,
    applied: await migrationApplied(pool),
    scanned_drafts: plan.scanned_drafts,
    scanned_versions: plan.scanned_versions,
    pending_changes: plan.changes.length,
    manual_objects: plan.manual
  };
}

async function ensureBackupTable(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_governance_migration_backups (
      backup_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      batch_key VARCHAR(128) NOT NULL,
      object_type VARCHAR(64) NOT NULL,
      object_id BIGINT NOT NULL,
      row_json JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_process_governance_migration_backup (batch_key, object_type, object_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function applyProcessGovernanceV3(pool, options = {}) {
  if (await migrationApplied(pool)) {
    return { ...(await inspectProcessGovernanceV3(pool)), changed: false };
  }
  const plan = await buildPlan(pool);
  if (plan.manual.length) {
    const error = new Error('存在不能无损转换为process-governance-v3的对象，迁移已在写入前停止');
    error.code = 'PROCESS_GOVERNANCE_V3_MANUAL_CONVERSION_REQUIRED';
    error.manual_objects = plan.manual;
    throw error;
  }
  await ensureBackupTable(pool);
  const batchKey = String(options.batchKey || `${MIGRATION_KEY}-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const change of plan.changes) {
      await connection.execute(`
        INSERT INTO process_design_governance_migration_backups
          (batch_key, object_type, object_id, row_json)
        VALUES (?, ?, ?, ?)
      `, [batchKey, `v3_${change.object_type}`, change.object_id, JSON.stringify(change.previous)]);
      const tableName = change.object_type === 'draft' ? 'process_design_drafts' : 'process_design_versions';
      await connection.execute(`
        UPDATE ${tableName}
        SET schema_version=?, process_content_json=?, content_hash=?
        WHERE id=?
      `, [CURRENT_VERSION, JSON.stringify(change.document), change.content_hash, change.object_id]);
    }
    await connection.execute(`
      INSERT INTO schema_migrations (migration_key)
      VALUES (?)
      ON DUPLICATE KEY UPDATE applied_at=applied_at
    `, [MIGRATION_KEY]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return {
    migration_key: MIGRATION_KEY,
    changed: plan.changes.length > 0,
    changed_rows: plan.changes.length,
    backup_batch: batchKey
  };
}

async function rollbackProcessGovernanceV3(pool, batchKey) {
  const [backups] = await pool.execute(`
    SELECT object_type, object_id, row_json
    FROM process_design_governance_migration_backups
    WHERE batch_key=? AND object_type IN ('v3_draft','v3_version')
    ORDER BY backup_id DESC
  `, [batchKey]);
  if (!backups.length) {
    const error = new Error('找不到指定v3迁移批次的备份');
    error.code = 'MIGRATION_BACKUP_NOT_FOUND';
    throw error;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const backup of backups) {
      const previous = typeof backup.row_json === 'string' ? JSON.parse(backup.row_json) : backup.row_json;
      const tableName = backup.object_type === 'v3_draft' ? 'process_design_drafts' : 'process_design_versions';
      await connection.execute(`
        UPDATE ${tableName}
        SET schema_version=?, process_content_json=?, content_hash=?
        WHERE id=?
      `, [previous.schema_version, previous.process_content_json, previous.content_hash, backup.object_id]);
    }
    await connection.execute('DELETE FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return { batch_key: batchKey, restored_rows: backups.length };
}

module.exports = {
  MIGRATION_KEY,
  planStoredRows,
  inspectProcessGovernanceV3,
  applyProcessGovernanceV3,
  rollbackProcessGovernanceV3
};
