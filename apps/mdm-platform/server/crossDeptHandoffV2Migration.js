const MIGRATION_KEY = '2026-07-31-cross-dept-handoff-v2';
const HANDOFF_STATUSES = [
  'pending_assignment',
  'pending_origin_review',
  'pending_counterparty_scope',
  'pending_counterparty_detail',
  'pending_counterparty_review',
  'pending_structure_gate',
  'conflict_open',
  'confirmed',
  'closed_not_required',
  'returned',
  'rejected',
  'escalated'
];

const COLUMN_DEFINITIONS = [
  ['draft_id', 'BIGINT NULL'],
  ['handoff_ref', 'VARCHAR(160) NULL'],
  ['handoff_direction', "VARCHAR(32) NOT NULL DEFAULT 'outbound_followup'"],
  ['anchor_behavior_ref', 'VARCHAR(160) NULL'],
  ['counterparty_resolution', "VARCHAR(32) NOT NULL DEFAULT 'identified'"],
  ['source_department_id', 'BIGINT NULL'],
  ['source_department', 'VARCHAR(255) NULL'],
  ['target_department_id', 'BIGINT NULL'],
  ['transfer_data_ref', 'VARCHAR(160) NULL'],
  ['transfer_data_name', 'VARCHAR(255) NULL'],
  ['requested_matter', 'TEXT NULL'],
  ['trigger_condition', 'TEXT NULL'],
  ['completion_standard', 'TEXT NULL'],
  ['counterparty_process_ref', 'VARCHAR(160) NULL'],
  ['counterparty_process_name', 'VARCHAR(255) NULL'],
  ['counterparty_behavior_ref', 'VARCHAR(160) NULL'],
  ['counterparty_behavior_name', 'VARCHAR(255) NULL'],
  ['requires_return', 'TINYINT NOT NULL DEFAULT 0'],
  ['returned_data_ref', 'VARCHAR(160) NULL'],
  ['returned_data_name', 'VARCHAR(255) NULL'],
  ['resume_behavior_ref', 'VARCHAR(160) NULL'],
  ['resume_step_id', 'BIGINT NULL'],
  ['source_schema_version', 'VARCHAR(64) NULL'],
  ['source_process_ref', 'VARCHAR(160) NULL'],
  ['source_content_hash', 'CHAR(64) NULL'],
  ['candidate_version', 'CHAR(64) NULL'],
  ['revision_no', 'INT NOT NULL DEFAULT 1'],
  ['is_current', 'TINYINT NOT NULL DEFAULT 1'],
  ['supersedes_handoff_id', 'BIGINT NULL'],
  ['issue_id', 'BIGINT NULL'],
  ['point_id', 'BIGINT NULL']
];

async function rows(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function runIgnoring(pool, sql, ignoredCodes) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && ignoredCodes.includes(error.code)) return;
    throw error;
  }
}

async function tableExists(pool, tableName) {
  const result = await rows(pool, `
    SELECT COUNT(*) AS count
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
  `, [tableName]);
  return Number(result[0] && result[0].count || 0) > 0;
}

async function columnNames(pool, tableName) {
  const result = await rows(pool, `
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
  `, [tableName]);
  return new Set(result.map(row => row.COLUMN_NAME));
}

async function migrationApplied(pool) {
  const result = await rows(pool, 'SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  return Boolean(result[0]);
}

async function inspectCrossDeptHandoffV2(pool) {
  const exists = await tableExists(pool, 'process_design_cross_dept_handoffs');
  if (!exists) return { migration_key: MIGRATION_KEY, table_exists: false, row_count: 0, statuses: [] };
  const existingColumns = await columnNames(pool, 'process_design_cross_dept_handoffs');
  const [countRows, statusRows] = await Promise.all([
    rows(pool, 'SELECT COUNT(*) AS count FROM process_design_cross_dept_handoffs'),
    rows(pool, 'SELECT status, COUNT(*) AS count FROM process_design_cross_dept_handoffs GROUP BY status ORDER BY status')
  ]);
  let integrity = null;
  if (['draft_id', 'handoff_ref', 'handoff_direction', 'source_process_ref', 'revision_no', 'is_current']
    .every(column => existingColumns.has(column))) {
    const integrityRows = await rows(pool, `
      SELECT
        SUM(CASE WHEN draft_id IS NULL THEN 1 ELSE 0 END) AS missing_draft,
        SUM(CASE WHEN handoff_ref IS NULL OR handoff_ref='' THEN 1 ELSE 0 END) AS missing_handoff_ref,
        SUM(CASE WHEN handoff_direction NOT IN ('inbound_prerequisite','outbound_followup') THEN 1 ELSE 0 END) AS invalid_direction,
        SUM(CASE WHEN source_process_ref IS NULL OR source_process_ref='' THEN 1 ELSE 0 END) AS missing_source_process_ref,
        SUM(CASE WHEN revision_no < 1 THEN 1 ELSE 0 END) AS invalid_revision,
        SUM(CASE WHEN is_current=1 THEN 1 ELSE 0 END) AS current_rows
      FROM process_design_cross_dept_handoffs
    `);
    integrity = Object.fromEntries(Object.entries(integrityRows[0] || {}).map(([key, value]) => [key, Number(value || 0)]));
  }
  return {
    migration_key: MIGRATION_KEY,
    table_exists: true,
    applied: await migrationApplied(pool),
    row_count: Number(countRows[0] && countRows[0].count || 0),
    statuses: statusRows.map(row => ({ status: row.status, count: Number(row.count || 0) })),
    missing_columns: COLUMN_DEFINITIONS.map(([name]) => name).filter(name => !existingColumns.has(name)),
    integrity
  };
}

async function createBackup(pool, batchKey) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_cross_dept_handoff_migration_backups (
      backup_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      batch_key VARCHAR(128) NOT NULL,
      handoff_id BIGINT NOT NULL,
      row_json JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_handoff_migration_backup (batch_key, handoff_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    INSERT IGNORE INTO process_design_cross_dept_handoff_migration_backups
      (batch_key, handoff_id, row_json)
    SELECT ?, id, JSON_OBJECT(
      'id', id,
      'step_id', step_id,
      'target_department', target_department,
      'target_process_code', target_process_code,
      'target_process_name', target_process_name,
      'target_behavior_code', target_behavior_code,
      'target_behavior_name', target_behavior_name,
      'handoff_standard', handoff_standard,
      'status', status,
      'returned_by', returned_by,
      'returned_at', returned_at,
      'sort_order', sort_order,
      'created_by', created_by,
      'created_at', created_at,
      'updated_at', updated_at
    )
    FROM process_design_cross_dept_handoffs
  `, [batchKey]);
}

async function dropMatchingChecks(pool, tableName, marker) {
  const checks = await rows(pool, `
    SELECT tc.CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.CHECK_CONSTRAINTS cc
      ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA
     AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA=DATABASE()
      AND tc.TABLE_NAME=?
      AND tc.CONSTRAINT_TYPE='CHECK'
      AND LOWER(cc.CHECK_CLAUSE) LIKE ?
  `, [tableName, `%${marker.toLowerCase()}%`]);
  for (const check of checks) {
    await pool.execute(`ALTER TABLE \`${tableName}\` DROP CHECK \`${check.CONSTRAINT_NAME}\``);
  }
}

async function applyCrossDeptHandoffV2(pool, options = {}) {
  if (await migrationApplied(pool)) {
    return { ...(await inspectCrossDeptHandoffV2(pool)), changed: false };
  }
  const batchKey = String(options.batchKey || `${MIGRATION_KEY}-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`);
  await createBackup(pool, batchKey);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_structured_imports (
      import_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      source_process_ref VARCHAR(160) NOT NULL,
      source_schema_version VARCHAR(64) NOT NULL,
      normalized_schema_version VARCHAR(64) NOT NULL,
      content_hash CHAR(64) NOT NULL,
      draft_id BIGINT NOT NULL,
      review_basis TEXT NOT NULL,
      normalized_json MEDIUMTEXT NOT NULL,
      approved_by_user_id BIGINT NULL,
      approved_by_person_id BIGINT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_process_design_structured_import (source_process_ref, content_hash),
      INDEX idx_process_design_structured_import_draft (draft_id, created_at),
      CONSTRAINT fk_process_design_structured_import_draft FOREIGN KEY (draft_id)
        REFERENCES process_design_drafts(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  for (const [columnName, definition] of COLUMN_DEFINITIONS) {
    await runIgnoring(
      pool,
      `ALTER TABLE process_design_cross_dept_handoffs ADD COLUMN \`${columnName}\` ${definition}`,
      ['ER_DUP_FIELDNAME']
    );
  }
  await runIgnoring(
    pool,
    'ALTER TABLE process_design_processes ADD COLUMN source_process_ref VARCHAR(160) NULL',
    ['ER_DUP_FIELDNAME']
  );
  await runIgnoring(
    pool,
    'ALTER TABLE process_design_processes ADD UNIQUE KEY uq_process_design_process_source (draft_id, source_process_ref)',
    ['ER_DUP_KEYNAME', 'ER_DUP_INDEX']
  );
  await runIgnoring(
    pool,
    'ALTER TABLE process_design_steps ADD COLUMN source_behavior_ref VARCHAR(160) NULL',
    ['ER_DUP_FIELDNAME']
  );
  await runIgnoring(
    pool,
    'ALTER TABLE process_design_steps ADD UNIQUE KEY uq_process_design_step_source (draft_id, source_behavior_ref)',
    ['ER_DUP_KEYNAME', 'ER_DUP_INDEX']
  );
  await runIgnoring(
    pool,
    'ALTER TABLE process_design_cross_dept_handoffs ADD UNIQUE KEY uq_process_design_handoff_revision (draft_id, handoff_ref, revision_no)',
    ['ER_DUP_KEYNAME', 'ER_DUP_INDEX']
  );
  await runIgnoring(
    pool,
    'ALTER TABLE process_design_cross_dept_handoffs ADD INDEX idx_process_design_handoff_source (source_process_ref, handoff_ref, candidate_version)',
    ['ER_DUP_KEYNAME', 'ER_DUP_INDEX']
  );
  await runIgnoring(
    pool,
    'ALTER TABLE process_design_cross_dept_handoffs ADD INDEX idx_process_design_handoff_issue (issue_id, point_id, status)',
    ['ER_DUP_KEYNAME', 'ER_DUP_INDEX']
  );

  await dropMatchingChecks(pool, 'process_design_cross_dept_handoffs', 'status');
  await pool.execute(`
    UPDATE process_design_cross_dept_handoffs handoff
    JOIN process_design_steps step ON step.id=handoff.step_id
    JOIN process_design_drafts draft ON draft.id=step.draft_id
    LEFT JOIN departments sourceDept ON sourceDept.id=draft.department_id
    SET handoff.draft_id=COALESCE(handoff.draft_id, step.draft_id),
        handoff.handoff_ref=COALESCE(NULLIF(handoff.handoff_ref, ''), CONCAT('legacy_handoff_', handoff.id)),
        handoff.handoff_direction='outbound_followup',
        handoff.anchor_behavior_ref=COALESCE(NULLIF(handoff.anchor_behavior_ref, ''), CONCAT('legacy_step_', handoff.step_id)),
        handoff.counterparty_resolution=CASE
          WHEN NULLIF(handoff.target_department, '') IS NULL THEN 'needs_identification'
          ELSE 'identified'
        END,
        handoff.source_department_id=COALESCE(handoff.source_department_id, draft.department_id),
        handoff.source_department=COALESCE(NULLIF(handoff.source_department, ''), sourceDept.name, ''),
        handoff.counterparty_process_name=COALESCE(NULLIF(handoff.counterparty_process_name, ''), handoff.target_process_name),
        handoff.counterparty_behavior_name=COALESCE(NULLIF(handoff.counterparty_behavior_name, ''), handoff.target_behavior_name),
        handoff.completion_standard=COALESCE(NULLIF(handoff.completion_standard, ''), handoff.handoff_standard),
        handoff.source_schema_version=COALESCE(NULLIF(handoff.source_schema_version, ''), 'legacy-process-design'),
        handoff.source_process_ref=COALESCE(NULLIF(handoff.source_process_ref, ''), CONCAT('legacy_draft_', step.draft_id)),
        handoff.revision_no=GREATEST(COALESCE(handoff.revision_no, 1), 1),
        handoff.is_current=COALESCE(handoff.is_current, 1),
        handoff.status=CASE handoff.status
          WHEN 'pending_return' THEN 'pending_counterparty_detail'
          WHEN 'returned' THEN 'pending_counterparty_review'
          WHEN 'pending_review' THEN 'pending_structure_gate'
          ELSE handoff.status
        END
  `);

  const allowedStatusesSql = HANDOFF_STATUSES.map(status => `'${status}'`).join(',');
  await pool.execute(`
    ALTER TABLE process_design_cross_dept_handoffs
    ADD CONSTRAINT chk_process_design_handoffs_status_v2
    CHECK (status IN (${allowedStatusesSql}))
  `);

  await dropMatchingChecks(pool, 'process_governance_issue_points', 'point_type');
  await pool.execute(`
    ALTER TABLE process_governance_issue_points
    ADD CONSTRAINT chk_process_governance_issue_point_type_v2
    CHECK (point_type IN (
      'owner_role','completion_standard','controlled_transfer','cross_department',
      'process_structure','system_landing','data_object','evidence_gap','terminology',
      'handoff_acceptance'
    ))
  `);
  await pool.execute(`
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [MIGRATION_KEY]);
  return { ...(await inspectCrossDeptHandoffV2(pool)), changed: true, backup_batch: batchKey };
}

async function compensateCrossDeptHandoffV2(pool, batchKey) {
  const backups = await rows(pool, `
    SELECT handoff_id, row_json
    FROM process_design_cross_dept_handoff_migration_backups
    WHERE batch_key=?
    ORDER BY handoff_id
  `, [batchKey]);
  for (const backup of backups) {
    const row = typeof backup.row_json === 'string' ? JSON.parse(backup.row_json) : backup.row_json;
    await pool.execute(`
      UPDATE process_design_cross_dept_handoffs
      SET target_department=?, target_process_code=?, target_process_name=?,
          target_behavior_code=?, target_behavior_name=?, handoff_standard=?,
          status=CASE ?
            WHEN 'pending_return' THEN 'pending_counterparty_detail'
            WHEN 'returned' THEN 'pending_counterparty_review'
            WHEN 'pending_review' THEN 'pending_structure_gate'
            ELSE ?
          END,
          returned_by=?, returned_at=?, sort_order=?
      WHERE id=?
    `, [
      row.target_department, row.target_process_code, row.target_process_name,
      row.target_behavior_code, row.target_behavior_name, row.handoff_standard,
      row.status, row.status, row.returned_by, row.returned_at, row.sort_order, row.id
    ]);
  }
  return { batch_key: batchKey, restored_rows: backups.length };
}

module.exports = {
  MIGRATION_KEY,
  HANDOFF_STATUSES,
  COLUMN_DEFINITIONS,
  inspectCrossDeptHandoffV2,
  applyCrossDeptHandoffV2,
  compensateCrossDeptHandoffV2
};
