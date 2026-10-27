// Read-only graph verification over actual application table DDL in a new owned
// tmpfs MySQL. Synthetic fixture writes happen only inside that isolated target.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { referencesToVersions, TABLES } = require('../server/dataMapHandoffImpact');
const { fixture, objectTarget } = require('./test-data-map-handoff-impact');
const { digest } = require('../server/dataMapDefinitionValues');
const output = path.resolve(process.argv[2] || path.join(__dirname, '../../../artifacts/mdm-data-governance-handoff-implementation-20261020-01/impact-' + crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep)); assert(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const checks = []; let owned, passed = false, failure;
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
async function main() {
  try {
    await withFreshMysql(async target => {
      const { pool, owner, database, port, containerId } = target;
      owned = { owner, database, port, containerId, storage: 'owner-labelled tmpfs', canonicalTableDDL: true }; save('owned-target.json', owned);
      for (const sql of splitSqlStatements(mdmMysqlSchemaSql())) await pool.execute(sql);
      for (const sql of splitSqlStatements(require('../server/processDataGovernanceMigration').PROCESS_DATA_GOVERNANCE_SCHEMA_SQL)) await pool.execute(sql);
      for (const module of ['dataMapDefinitionSchema', 'v7MappingSchema', 'designHandoffSchema', 'analysisRunSchema', 'dataMapHandoffSchema']) for (const sql of require('../server/' + module).statements()) await pool.execute(sql);
      await pool.execute("INSERT INTO departments(id,code,name) VALUES(91,'IMPACT_A','Synthetic A'),(92,'IMPACT_B','Synthetic B'),(93,'IMPACT_C','Synthetic C')");
      await pool.execute("INSERT INTO process_design_documents(id,document_no,document_title,owning_department_id) VALUES(1001,'SYNTH_IMPACT','Synthetic source',91)");
      await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id) VALUES(1002,1001,'SYNTH_IMPACT','Synthetic source','A','Synthetic','Synthetic','Synthetic','Synthetic',91)");
      await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id) VALUES(1101,1002,1001,'SYNTH_IMPACT','Synthetic source','A','SYNTH_IMPACT_A',91)");
      await pool.execute("INSERT INTO process_data_governance_work_packages(id,package_ref,process_version_id,owning_department_id,source_content_hash,rule_version,risk_basis_json) VALUES(501,'SYNTH_IMPACT_PACKAGE',1101,91,?,'synthetic','{}')", ['0'.repeat(64)]);
      await pool.execute("INSERT INTO data_map_import_batches(id,source_type) VALUES(800,'synthetic_excel')");
      await pool.execute("INSERT INTO data_map_design_handoffs(handoff_id,revision_no) VALUES(400,1)");
      const data = fixture();
      const publications = new Map(['p1', 'p2', 'p3'].map(key => [key, crypto.randomUUID()]));
      const dbInsert = async (table, row) => {
        const fields = Object.keys(row), args = fields.map(key => row[key] && typeof row[key] === 'object' ? JSON.stringify(row[key]) : row[key]);
        await pool.execute(`INSERT INTO ${table} (${fields.map(field => '`' + field + '`').join(',')}) VALUES(${fields.map(() => '?').join(',')})`, args);
      };
      for (const row of data.data_map_definition_versions) await dbInsert('data_map_definition_versions', { ...row, version_no: 1, schema_version: 'data-map-definition-v1', base_digest: '0'.repeat(64), digest_algorithm: 'sha256-canonical-json-v1', source_kind: 'legacy', created_at: '2026-10-20 00:00:00.000' });
      for (const row of data.data_map_source_files) await dbInsert('data_map_source_files', { ...row, raw_sha256: '1'.repeat(64), raw_digest_status: 'available', byte_length: 1, parser_version: 'synthetic', template_profile_version: 'synthetic', imported_by_person_id: 1 });
      for (const row of data.data_map_source_mappings) await dbInsert('data_map_source_mappings', { ...row, source_cell_ids_json: [] });
      for (const row of data.data_map_v7_sources) await dbInsert('data_map_v7_sources', { ...row, source_key: '2'.repeat(64), digest_algorithm: 'synthetic', validation_status: 'valid', validation_json: {}, created_by_person_id: 1, created_at: '2026-10-20 00:00:00.000' });
      for (const [index, row] of data.data_map_v7_mappings.entries()) await dbInsert('data_map_v7_mappings', { ...row, local_key: String(index).repeat(64), local_object_ref: 'synthetic-object', local_field_ref: index ? 'synthetic-field' : null, revision_no: 1 });
      for (const row of data.data_map_v7_mapping_versions) await dbInsert('data_map_v7_mapping_versions', { ...row, revision_no: 1, snapshot_json: {}, actor_person_id: 1, created_at: '2026-10-20 00:00:00.000' });
      for (const row of data.data_map_design_handoff_versions) await dbInsert('data_map_design_handoff_versions', { ...row, revision_no: 1, snapshot_json: {}, actor_person_id: 1, created_at: '2026-10-20 00:00:00.000' });
      for (const row of data.data_map_design_handoff_refs) await dbInsert('data_map_design_handoff_refs', row);
      for (const row of data.data_map_analysis_runs) await dbInsert('data_map_analysis_runs', { ...row, revision_no: 1, manifest_json: {}, created_by_person_id: 1, created_at: '2026-10-20 00:00:00.000', finished_at: '2026-10-20 00:00:01.000' });
      for (const row of data.data_map_analysis_inputs) await dbInsert('data_map_analysis_inputs', { ...row, snapshot_json: {} });
      for (const row of data.data_map_publications) {
        const handoffId = crypto.randomUUID(), revisionId = crypto.randomUUID(), approvalId = crypto.randomUUID();
        await pool.execute("INSERT INTO data_map_handoff_drafts(handoff_id,package_id,current_revision,state,active_slot,created_actor_json,created_at) VALUES(?,501,1,'published',NULL,'{}',UTC_TIMESTAMP(3))", [handoffId]);
        await pool.execute("INSERT INTO data_map_handoff_revisions(revision_id,handoff_id,revision_no,scope_mode,binding_id,snapshot_json,content_digest,dependency_manifest_json,impact_manifest_json,created_actor_json,created_at) VALUES(?,?,1,'current',?,'{}',?,'{}','{}','{}',UTC_TIMESTAMP(3))", [revisionId, handoffId, crypto.randomUUID(), '3'.repeat(64)]);
        await pool.execute("INSERT INTO data_map_handoff_approvals(approval_id,action,revision_id,binding_digest,decision,basis,actor_json,request_id,created_at) VALUES(?,'publish',?,?,'approved','synthetic','{}',?,UTC_TIMESTAMP(3))", [approvalId, revisionId, '4'.repeat(64), crypto.randomUUID()]);
        await dbInsert('data_map_publications', { ...row, publication_id: publications.get(row.publication_id), handoff_revision_id: revisionId, approval_id: approvalId, request_id: crypto.randomUUID(), published_at: '2026-10-20 00:00:00.000' });
      }
      for (const row of data.data_map_publication_items) await dbInsert('data_map_publication_items', { ...row, publication_id: publications.get(row.publication_id), source_detail_versions_json: [] });
      await pool.execute("INSERT INTO data_map_data_elements(element_id,created_at) VALUES('e1',UTC_TIMESTAMP(3))");
      for (const row of data.data_map_data_element_versions) await dbInsert('data_map_data_element_versions', { ...row, publication_id: publications.get(row.publication_id), definition_json: {}, content_digest: '5'.repeat(64), created_at: '2026-10-20 00:00:00.000' });
      for (const row of data.data_map_field_element_bindings) await dbInsert('data_map_field_element_bindings', { ...row, publication_id: publications.get(row.publication_id), basis: 'synthetic actual fixed binding' });
      async function read(targets = [objectTarget], options = {}) {
        const db = await pool.getConnection(), sqlTrace = [];
        const reader = { async execute(sql, params) { assert(/^\s*SELECT\b/i.test(sql)); assert(/FOR SHARE\s*$/i.test(sql)); assert(!/\bLIMIT\b/i.test(sql)); sqlTrace.push(sql); return db.execute(sql, params); } };
        try { await db.beginTransaction(); const result = await referencesToVersions(reader, targets, options); await db.rollback(); return { result, sqlTrace }; } finally { await db.rollback(); db.release(); }
      }
      let before;
      await check('canonical schemas return every direct and transitive fixed consumer without LIMIT or mutation', async () => {
        const readResult = await read(); before = readResult.result;
        assert(!before.some(row => row.reference_kind === 'schema_not_installed'));
        for (const kind of ['definition_parent', 'definition_identifier', 'source_mapping', 'mapping_version', 'design_handoff', 'analysis_input', 'publication_item', 'field_element_binding']) assert(before.some(row => row.reference_kind === kind), kind);
        for (const key of ['definition', 'mapping', 'handoff', 'batch']) assert(before.some(row => row.reference_key === 'analysis_input:500:' + key));
        assert.equal(before.find(row => row.reference_kind === 'mapping_version').scope_department_id, '92');
        assert.equal(before.find(row => row.reference_kind === 'analysis_input').scope_department_id, '93');
        assert(before.some(row => row.target_id === objectTarget.target_id)); save('references-before.json', before); save('readonly-sql-trace.json', readResult.sqlTrace);
      });
      await check('new element binding propagates through fixed mapping and design handoff to analysis', async () => {
        const result = (await read([{ target_kind: 'data_element', target_id: 'e1', target_version_ref: 'ev1' }])).result;
        assert(result.some(row => row.reference_key === 'analysis_input:500:handoff')); save('element-transitive-references.json', result);
      });
      await check('exclude producer publication preserves independent reuse and exact dependent references', async () => {
        const result = (await read([objectTarget], { excludePublicationId: publications.get('p1') })).result;
        assert(!result.some(row => row.publication_id === publications.get('p1')));
        assert(result.some(row => row.publication_id === publications.get('p2') && row.operation === 'reuse'));
      });
      await check('a newly persisted transitive handoff-analysis edge changes the stable impact digest', async () => {
        await dbInsert('data_map_analysis_inputs', { ...data.data_map_analysis_inputs[2], input_key: 'new-handoff', snapshot_json: {} });
        const after = (await read()).result; assert.notEqual(digest(after), digest(before)); assert(after.some(row => row.reference_key === 'analysis_input:500:new-handoff'));
        const repeat = (await read([objectTarget, objectTarget])).result; assert.deepEqual(repeat, after); save('references-after.json', after); save('digest-change.json', { before: digest(before), after: digest(after), newReferenceKey: 'analysis_input:500:new-handoff' });
      });
      await check('genuinely uninstalled reference table is reported without invented historical rows', async () => {
        await pool.execute('RENAME TABLE data_map_field_element_bindings TO synthetic_retained_binding_fixture');
        const result = (await read()).result;
        assert(result.some(row => row.table_name === 'data_map_field_element_bindings' && row.status === 'not_installed'));
        assert(!result.some(row => row.reference_kind === 'field_element_binding'));
        await pool.execute('RENAME TABLE synthetic_retained_binding_fixture TO data_map_field_element_bindings');
      });
    }, { stage: '24', randomDatabase: true });
    owned.cleaned = true; passed = true;
  } catch (error) { failure = { code: error.code, message: error.message, stack: error.stack }; throw error; }
  finally { save('results.json', { passed, checks, owned, failure, formalDatabaseAccess: false, businessAccepted: false, applicationMutationFromHelper: false }); }
  console.log('PASS HANDOFF_IMPACT_MYSQL ' + checks.length + ' checks; evidence ' + output);
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { main };
