#!/usr/bin/env node
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { seedDefaultTerminologyTermTypes } = require('../server/terminologyMysqlRepository');
const { migrateLegacyIdentityToPersonIdentity } = require('../server/identityMysqlRepository');
const { ensureProcessGovernanceCloseGateSchema } = require('../server/processGovernanceMysqlRepository');
const { ensureProcessDesignEvidenceStatusSchema } = require('../server/routes/processDesignMysql');

async function columnExists(pool, tableName, columnName) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [tableName, columnName],
  );
  return Number(rows[0] && rows[0].count || 0) > 0;
}

async function indexExists(pool, tableName, indexName) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?`,
    [tableName, indexName],
  );
  return Number(rows[0] && rows[0].count || 0) > 0;
}

async function constraintExists(pool, tableName, constraintName) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS count
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=?`,
    [tableName, constraintName],
  );
  return Number(rows[0] && rows[0].count || 0) > 0;
}

async function dropCheckConstraints(pool, tableName) {
  const [rows] = await pool.execute(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_TYPE='CHECK'`,
    [tableName],
  );
  for (const row of rows) {
    await pool.execute(`ALTER TABLE ${tableName} DROP CHECK ${row.CONSTRAINT_NAME}`);
  }
}

async function ensureDocumentStructuredOutputV2(pool) {
  if (!await columnExists(pool, 'process_design_steps', 'process_id')) {
    await pool.execute('ALTER TABLE process_design_steps ADD COLUMN process_id BIGINT NULL AFTER draft_id');
  }
  if (!await columnExists(pool, 'process_design_cross_dept_handoffs', 'returned_by')) {
    await pool.execute('ALTER TABLE process_design_cross_dept_handoffs ADD COLUMN returned_by BIGINT NULL AFTER status');
  }
  if (!await columnExists(pool, 'process_design_cross_dept_handoffs', 'returned_at')) {
    await pool.execute('ALTER TABLE process_design_cross_dept_handoffs ADD COLUMN returned_at TIMESTAMP NULL AFTER returned_by');
  }
  if (!await columnExists(pool, 'process_design_steps', 'status')) {
    await pool.execute("ALTER TABLE process_design_steps ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active' AFTER a1_code");
  }
  if (!await columnExists(pool, 'process_design_steps', 'void_reason')) {
    await pool.execute('ALTER TABLE process_design_steps ADD COLUMN void_reason TEXT NULL AFTER status');
  }
  if (!await columnExists(pool, 'process_design_steps', 'voided_by')) {
    await pool.execute('ALTER TABLE process_design_steps ADD COLUMN voided_by BIGINT NULL AFTER void_reason');
  }
  if (!await columnExists(pool, 'process_design_steps', 'voided_at')) {
    await pool.execute('ALTER TABLE process_design_steps ADD COLUMN voided_at TIMESTAMP NULL AFTER voided_by');
  }
  await pool.execute("UPDATE process_design_steps SET status='active' WHERE status IS NULL OR status=''");
  if (!await indexExists(pool, 'process_design_steps', 'idx_process_design_steps_status')) {
    await pool.execute('ALTER TABLE process_design_steps ADD INDEX idx_process_design_steps_status (draft_id, status, sort_order)');
  }
  await dropCheckConstraints(pool, 'process_design_steps');
  await pool.execute("ALTER TABLE process_design_steps ADD CONSTRAINT chk_process_design_steps_status CHECK (status IN ('active','voided'))");
  await pool.execute(`
    INSERT INTO process_design_processes
      (draft_id, process_code, process_type, l1_name, l2_name, l3_name, description, sort_order, created_by)
    SELECT d.id, NULL, 'inherit',
           COALESCE(NULLIF(d.l1_name, ''), '待确认L1'),
           COALESCE(NULLIF(d.l2_name, ''), '待确认L2'),
           COALESCE(NULLIF(d.l3_name, ''), d.process_name),
           '由历史草稿迁移生成', 1, d.created_by
    FROM process_design_drafts d
    WHERE NOT EXISTS (
      SELECT 1 FROM process_design_processes p WHERE p.draft_id=d.id
    )
  `);
  await pool.execute(`
    UPDATE process_design_steps s
    JOIN (
      SELECT draft_id, MIN(id) AS process_id
      FROM process_design_processes
      GROUP BY draft_id
    ) p ON p.draft_id=s.draft_id
    SET s.process_id=p.process_id
    WHERE s.process_id IS NULL
  `);
  if (!await indexExists(pool, 'process_design_steps', 'idx_process_design_steps_process')) {
    await pool.execute('ALTER TABLE process_design_steps ADD INDEX idx_process_design_steps_process (process_id, sort_order)');
  }
  if (!await constraintExists(pool, 'process_design_steps', 'fk_process_design_steps_process')) {
    await pool.execute('ALTER TABLE process_design_steps ADD CONSTRAINT fk_process_design_steps_process FOREIGN KEY (process_id) REFERENCES process_design_processes(id) ON DELETE CASCADE');
  }
  await pool.execute('ALTER TABLE process_design_cross_dept_handoffs MODIFY target_process_name VARCHAR(255) NULL');
  await pool.execute('ALTER TABLE process_design_cross_dept_handoffs MODIFY target_behavior_name VARCHAR(255) NULL');
  await pool.execute("ALTER TABLE process_design_cross_dept_handoffs MODIFY status VARCHAR(32) NOT NULL DEFAULT 'pending_return'");
  await pool.execute(`
    UPDATE process_design_cross_dept_handoffs
    SET status=CASE
      WHEN target_process_name IS NOT NULL AND target_behavior_name IS NOT NULL THEN 'returned'
      ELSE 'pending_return'
    END
    WHERE status NOT IN ('pending_return','returned','pending_review','confirmed')
  `);
  await dropCheckConstraints(pool, 'process_design_cross_dept_handoffs');
  await pool.execute("ALTER TABLE process_design_cross_dept_handoffs ADD CONSTRAINT chk_process_design_handoff_status CHECK (status IN ('pending_return','returned','pending_review','confirmed'))");
}

async function main() {
  const config = mysqlConfigFromEnv();
  const pool = mysql.createPool(config);
  try {
    for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
      await pool.execute(statement);
    }
    await ensureProcessGovernanceCloseGateSchema(pool);
    await ensureDocumentStructuredOutputV2(pool);
    await ensureProcessDesignEvidenceStatusSchema(pool);
    await migrateLegacyIdentityToPersonIdentity(pool);
    await seedDefaultTerminologyTermTypes(pool);
    for (const migrationKey of [
      '2026-06-29-person-identity-schema-contract',
      '2026-06-16-process-input-baseline-review',
      '2026-06-16-process-governance-read-model',
      '2026-06-17-identity-rbac-read-model',
      '2026-06-18-data-map-field-domain',
      '2026-06-18-terminology-domain',
      '2026-06-18-mapping-approval-domain',
      '2026-06-18-conflict-todo-domain',
      '2026-06-18-version-activity-domain',
      '2026-07-01-process-governance-close-gate-fingerprints',
      '2026-07-01-document-structured-output',
      '2026-07-01-document-structured-output-v2',
      '2026-07-01-document-structured-output-editing',
      '2026-07-01-process-design-evidence-status'
    ]) {
      await pool.execute(
        `INSERT INTO schema_migrations (migration_key)
         VALUES (?)
         ON DUPLICATE KEY UPDATE applied_at=CURRENT_TIMESTAMP`,
        [migrationKey],
      );
    }
    console.log(`mysql_schema_initialized=${JSON.stringify(redactMysqlConfig(config))}`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
