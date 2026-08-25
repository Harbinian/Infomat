const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const {
  compareCreateStatements,
  referenceEvidence,
  schemaComponents,
  splitTopLevel
} = require('../server/processV7M0Baseline');

function statement(tableName) {
  return splitSqlStatements(mdmMysqlSchemaSql())
    .find(value => new RegExp(`^CREATE TABLE IF NOT EXISTS ${tableName}\\b`, 'i').test(value));
}

function main() {
  assert.deepStrictEqual(splitTopLevel('a VARCHAR(10), b DECIMAL(10,2), CHECK (b IN (1,2))'), [
    'a VARCHAR(10)',
    'b DECIMAL(10,2)',
    'CHECK (b IN (1,2))'
  ]);

  const drafts = statement('process_design_drafts');
  assert.ok(drafts);
  assert.ok(schemaComponents(drafts).has('column:schema_version'));
  assert.strictEqual(compareCreateStatements(drafts, drafts).matching, true);
  const drifted = drafts.replace('schema_version VARCHAR(64) NOT NULL', 'schema_version VARCHAR(32) NULL');
  const comparison = compareCreateStatements(drafts, drifted);
  assert.strictEqual(comparison.matching, false);
  assert.ok(comparison.differences.some(item => item.component === 'column:schema_version'));

  const references = referenceEvidence(
    [{ id: 1, status: 'active', current_version_id: 11 }],
    [{ id: 21, document_id: 1, base_version_id: 11 }],
    [{ id: 11, draft_id: 21, document_id: 1, supersedes_version_id: null }]
  );
  assert.strictEqual(references.non_null_reference_orphan_count, 0);
  assert.strictEqual(references.cross_document_reference_count, 0);
  assert.deepStrictEqual(references.supersedes_cycle_start_ids, []);

  const brokenReferences = referenceEvidence(
    [{ id: 1, status: 'active', current_version_id: 11 }],
    [{ id: 21, document_id: 99, base_version_id: 12 }],
    [
      { id: 11, draft_id: 21, document_id: 2, supersedes_version_id: 12 },
      { id: 12, draft_id: 21, document_id: 2, supersedes_version_id: 11 }
    ]
  );
  assert.ok(brokenReferences.non_null_reference_orphan_count > 0);
  assert.ok(brokenReferences.cross_document_reference_count > 0);
  assert.deepStrictEqual(brokenReferences.supersedes_cycle_start_ids, [11, 12]);

  const cliSource = fs.readFileSync(path.join(__dirname, 'inspect-process-v7-m0-baseline.js'), 'utf8');
  assert.ok(cliSource.includes('inspectProcessV7M0Baseline'));
  assert.ok(!/--apply|DROP\s+TABLE|DELETE\s+FROM|UPDATE\s+/i.test(cliSource), 'M0 CLI must remain read-only');
  console.log('Process V7 M0 baseline tests passed');
}

main();
