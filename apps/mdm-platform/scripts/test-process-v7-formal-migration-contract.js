const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mdmMysqlSchemaSql } = require('../server/mysqlSchema');
const {
  PROCESS_V7_FORMAL_SCHEMA_SQL,
  PROMOTION_TABLE,
  schemaDrift
} = require('../server/processV7FormalMigration');

function main() {
  assert.strictEqual(PROMOTION_TABLE, 'process_v7_promotions');
  assert.match(PROCESS_V7_FORMAL_SCHEMA_SQL, /UNIQUE KEY uq_process_v7_promotion_source \(preview_case_id, preview_revision_id, preview_revision_no, content_hash\)/);
  assert.match(PROCESS_V7_FORMAL_SCHEMA_SQL, /FOREIGN KEY \(preview_revision_id\)[\s\S]*process_v7_preview_revisions/i);
  assert.match(PROCESS_V7_FORMAL_SCHEMA_SQL, /FOREIGN KEY \(document_id\)[\s\S]*process_design_documents/i);

  const targetSchema = mdmMysqlSchemaSql();
  assert.match(targetSchema, /process_ref VARCHAR\(160\) NULL/);
  assert.match(targetSchema, /UNIQUE KEY uq_process_design_documents_process_ref \(process_ref\)/);
  assert.match(targetSchema, /draft_revision_no INT NULL[\s\S]*content_hash CHAR\(64\) NULL/);
  assert.match(targetSchema, /content_json JSON NULL/);
  assert.doesNotMatch(targetSchema, /CREATE TABLE IF NOT EXISTS process_v7_promotions/i, 'ordinary schema initialization must not create the M2 audit table');
  assert.doesNotMatch(targetSchema, /CREATE TABLE IF NOT EXISTS process_v7_preview_/i, 'ordinary schema initialization must not create M1 preview tables');

  const compatible = {
    columns: {
      document_process_ref: { exists: true, column_type: 'varchar(160)', nullable: true },
      review_draft_revision_no: { exists: true, column_type: 'int', nullable: true },
      review_content_hash: { exists: true, column_type: 'char(64)', nullable: true },
      version_l1_name: { exists: true, column_type: 'varchar(255)', nullable: true },
      version_l2_name: { exists: true, column_type: 'varchar(255)', nullable: true },
      version_l3_name: { exists: true, column_type: 'varchar(255)', nullable: true },
      version_content_json: { exists: true, column_type: 'json', nullable: true }
    },
    indexes: {
      document_process_ref: { exists: true, unique: true, columns: ['process_ref'] },
      review_content_binding: { exists: true, unique: false, columns: ['draft_id', 'draft_revision_no', 'content_hash', 'status'] }
    },
    promotion_table: { exists: true, schema_status: 'matching' }
  };
  assert.deepStrictEqual(schemaDrift(compatible), []);
  assert.ok(schemaDrift({
    ...compatible,
    columns: { ...compatible.columns, document_process_ref: { exists: true, column_type: 'varchar(128)', nullable: true } }
  }).includes('process_design_documents.process_ref'));

  const cliSource = fs.readFileSync(path.join(__dirname, 'migrate-process-v7-formal-foundation.js'), 'utf8');
  assert.ok(cliSource.includes('loadFixedMysqlEnvironment'));
  assert.ok(cliSource.includes('redactMysqlConfig'));
  assert.ok(cliSource.includes("args.has('--dry-run')"));
  assert.ok(cliSource.includes("args.has('--apply')"));
  assert.ok(cliSource.includes("args.has('--rollback')"));
  console.log('Process V7 formal migration contract tests passed');
}

main();
