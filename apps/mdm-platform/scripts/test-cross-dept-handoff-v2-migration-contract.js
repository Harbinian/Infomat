const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { mdmMysqlSchemaSql } = require('../server/mysqlSchema');
const {
  MIGRATION_KEY,
  HANDOFF_STATUSES,
  COLUMN_DEFINITIONS
} = require('../server/crossDeptHandoffV2Migration');

function main() {
  const schema = mdmMysqlSchemaSql();
  const migrationSource = fs.readFileSync(path.join(__dirname, '../server/crossDeptHandoffV2Migration.js'), 'utf8');
  const cliSource = fs.readFileSync(path.join(__dirname, 'migrate-cross-dept-handoff-v2.js'), 'utf8');
  assert.strictEqual(MIGRATION_KEY, '2026-07-31-cross-dept-handoff-v2');
  [
    'pending_assignment',
    'pending_origin_review',
    'pending_counterparty_scope',
    'pending_counterparty_detail',
    'pending_counterparty_review',
    'pending_structure_gate',
    'confirmed',
    'closed_not_required',
    'returned',
    'rejected',
    'escalated'
  ].forEach(status => assert.ok(HANDOFF_STATUSES.includes(status), `missing handoff status ${status}`));
  [
    'draft_id',
    'handoff_ref',
    'handoff_direction',
    'anchor_behavior_ref',
    'counterparty_resolution',
    'source_content_hash',
    'candidate_version',
    'revision_no',
    'is_current',
    'issue_id',
    'point_id'
  ].forEach(column => {
    assert.ok(COLUMN_DEFINITIONS.some(([name]) => name === column), `missing migration column ${column}`);
    assert.ok(schema.includes(`${column} `), `fresh schema must include ${column}`);
  });
  assert.ok(schema.includes("'handoff_acceptance'"), 'issue pool must support handoff_acceptance points');
  assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS process_design_structured_imports'), 'fresh schema must persist controlled import audit records');
  assert.ok(schema.includes('UNIQUE KEY uq_process_design_structured_import (source_process_ref, content_hash)'), 'controlled imports must be idempotent by source process and normalized hash');
  assert.ok(migrationSource.includes('process_design_cross_dept_handoff_migration_backups'), 'migration must back up legacy rows before changes');
  assert.ok(migrationSource.includes("WHEN 'pending_return' THEN 'pending_counterparty_detail'"), 'legacy status must have an explicit mapping');
  assert.ok(migrationSource.includes('compensateCrossDeptHandoffV2'), 'migration must provide failure compensation');
  assert.ok(cliSource.includes("'--dry-run'") && cliSource.includes("'--apply'") && cliSource.includes("'--compensate'"), 'migration CLI must require an explicit mode');
  console.log('Cross-department handoff v2 migration contract tests passed');
}

main();
