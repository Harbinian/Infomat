// Synthetic published-version selection in an owned tmpfs MySQL only.
// No private configuration, business ports, existing database or service writes.
const assert = require('node:assert/strict');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { readPublishedOfficeVersions } = require('../server/officeRepository');

withFreshMysql(async ({ pool }) => {
  await pool.execute(`CREATE TABLE process_design_versions (
    id BIGINT PRIMARY KEY, document_no VARCHAR(80), document_title VARCHAR(80),
    edition VARCHAR(10), department_id BIGINT, process_content_json JSON,
    schema_version VARCHAR(80), status VARCHAR(30))`);
  const samples = [
    ['9007199254740993', 'process-governance-v8', 'published'],
    ['9007199254740992', 'process-governance-v7', 'published'],
    ['3', 'process-governance-v6', 'published'],
    ['4', 'process-governance-v8', 'superseded'],
    ['5', 'process-governance-v8', 'draft']
  ];
  for (const [id, schema, status] of samples) {
    const document = { schema_version: schema, behaviors: [{ behavior_ref: 'behavior_' + id, behavior_name: 'Synthetic behavior' }] };
    await pool.execute('INSERT INTO process_design_versions VALUES (?,?,?,?,?,?,?,?)',
      [id, 'SYNTHETIC_' + id, 'Synthetic process', 'A', '9007199254740994', JSON.stringify(document), schema, status]);
  }
  const versions = await readPublishedOfficeVersions(pool);
  assert.deepEqual(versions.map(v => v.id), ['9007199254740993', '9007199254740992']);
  assert(versions.every(v => v.department_id === '9007199254740994'));
  assert.equal(versions[0].behaviors[0].ref, 'behavior_9007199254740993');
  assert.deepEqual(Object.keys(versions[0]).sort(), ['behaviors', 'department_id', 'document_no', 'edition', 'id', 'title']);
  const [rows] = await pool.query('SELECT CAST(id AS CHAR) AS id, schema_version, status FROM process_design_versions ORDER BY id');
  assert.equal(rows.length, samples.length);
  assert.equal(rows.find(r => r.id === samples[0][0]).schema_version, 'process-governance-v8');
  // The formal rollback guard must also see V8 records without other usage traces.
  await pool.execute('CREATE TABLE process_design_drafts (schema_version VARCHAR(80))');
  await pool.execute("INSERT INTO process_design_drafts VALUES ('process-governance-v8'),('process-governance-v7'),('process-governance-v3')");
  const usage = await require('../server/processV7FormalMigration').inspectNativeFormalUsage(pool,
    { columns: { document_process_ref: { exists: false }, review_draft_revision_no: { exists: false }, review_content_hash: { exists: false } }, promotion_table: { rows: 0 } });
  assert.deepEqual(usage, { promotion_count: 0, document_count: 0, draft_count: 2, version_count: 4, review_binding_count: 0 });
  await pool.execute("DELETE FROM process_design_drafts WHERE schema_version <> 'process-governance-v8'");
  assert.equal((await require('../server/processV7FormalMigration').inspectNativeFormalUsage(pool,
    { columns: { document_process_ref: { exists: false }, review_draft_revision_no: { exists: false }, review_content_hash: { exists: false } }, promotion_table: { rows: 0 } })).draft_count, 1);
  console.log('NATIVE_OFFICE_VERSIONS_PASSED: V8/V7 published only; exact IDs and existing response shape preserved');
  console.log('NATIVE_FORMAL_USAGE_PASSED: V8-only usage remains visible to the rollback guard; no DDL rollback executed');
}, { stage: '04', randomDatabase: true }).catch(error => { console.error(error); process.exitCode = 1; });
