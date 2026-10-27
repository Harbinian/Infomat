// Pure fixed-reference graph checks. No database, application server or config.
const assert = require('node:assert/strict');
const { referenceClosure, TABLES } = require('../server/dataMapHandoffImpact');
const { digest } = require('../server/dataMapDefinitionValues');
function fixture() {
  const data = Object.fromEntries(Object.keys(TABLES).map(table => [table, []]));
  const version = (version_id, entity_type, entity_id, object_version_id = null) => ({ version_id, entity_type, entity_id, object_version_id, definition_json: { name: 'Synthetic', unique_identifiers: [] }, base_snapshot_json: { row: { owner_dept_id: '91' } }, content_digest: 'd'.repeat(64) });
  data.data_map_definition_versions.push(version('100', 'object', '9007199254740993'), version('200', 'field', '20', '100'), version('201', 'field', '21', '100'));
  data.data_map_definition_versions[0].definition_json.unique_identifiers = [{ kind: 'single', field_version_ids: ['200'] }];
  data.process_data_governance_work_packages.push({ id: '501', owning_department_id: '91', process_version_id: '1101' });
  data.data_map_source_files.push({ batch_id: '800', scope_department_id: '91' });
  data.data_map_source_mappings.push({ mapping_id: '700', batch_id: '800', platform_version_id: '100', record_type: 'object', sheet_name: 'Synthetic', local_id: 'obj', source_row: 1, unresolved_reason: null });
  data.data_map_v7_sources.push({ source_id: '900', scope_department_id: '92', process_version_id: '1101', source_kind: 'published_version' });
  data.data_map_v7_mappings.push({ mapping_id: '300', source_id: '900' }, { mapping_id: '301', source_id: '900' });
  data.data_map_v7_mapping_versions.push({ mapping_version_id: '310', mapping_id: '300', object_version_id: '100', field_version_id: null, parent_mapping_version_id: null, status: 'confirmed', snapshot_digest: 'e'.repeat(64) },
    { mapping_version_id: '311', mapping_id: '301', object_version_id: '100', field_version_id: '201', parent_mapping_version_id: '310', status: 'confirmed', snapshot_digest: 'f'.repeat(64) });
  data.data_map_design_handoff_versions.push({ handoff_version_id: '410', handoff_id: '400', claim_status: 'human_confirmed', snapshot_digest: 'a'.repeat(64) });
  data.data_map_design_handoff_refs.push({ handoff_version_id: '410', mapping_version_id: '310', side: 'source' }, { handoff_version_id: '410', mapping_version_id: '311', side: 'target' });
  data.data_map_analysis_runs.push({ run_id: '500', scope_department_id: '93', status: 'succeeded', manifest_digest: 'b'.repeat(64) });
  for (const [input_key, reference] of [['definition', { definition_version_id: '100' }], ['mapping', { mapping_version_id: '311' }], ['handoff', { handoff_version_id: '410' }], ['batch', { batch_id: '800' }]]) {
    data.data_map_analysis_inputs.push({ run_id: '500', input_key, source_id: null, definition_version_id: null, mapping_version_id: null, handoff_version_id: null, batch_id: null, snapshot_digest: 'c'.repeat(64), ...reference });
  }
  for (const publication_id of ['p1', 'p2', 'p3']) data.data_map_publications.push({ publication_id, scope_mode: publication_id === 'p2' ? 'historical' : 'current', manifest_json: { package_id: '501', process_version_id: '1101' }, manifest_digest: 'd'.repeat(64) });
  data.data_map_publication_items.push(
    { publication_id: 'p1', item_ref: 'object', target_kind: 'object', target_id: '9007199254740993', target_version_ref: '100', operation: 'create', produces_version: 1, payload_json: { definition: {} } },
    { publication_id: 'p2', item_ref: 'reuse', target_kind: 'object', target_id: '9007199254740993', target_version_ref: '100', operation: 'reuse', produces_version: 0, payload_json: { definition: {} } },
    { publication_id: 'p3', item_ref: 'field', target_kind: 'field', target_id: '21', target_version_ref: '201', operation: 'create', produces_version: 1, payload_json: { definition: {}, object_version_id: '100', context_version_ref: 'cv1', context_id: '31', data_element_version_ref: 'ev1' } });
  data.data_map_data_element_versions.push({ element_version_id: 'ev1', element_id: 'e1', publication_id: 'p3' });
  data.data_map_field_element_bindings.push({ binding_id: 'b1', field_version_id: '201', element_version_id: 'ev1', context_version_ref: 'cv1', publication_id: 'p3' });
  return data;
}
const objectTarget = { target_kind: 'object', target_id: '9007199254740993', target_version_ref: '100' };
function main() {
  const data = fixture(), result = referenceClosure(data, [objectTarget, objectTarget]);
  for (const kind of ['definition_parent', 'definition_identifier', 'source_mapping', 'mapping_version', 'design_handoff', 'analysis_input', 'publication_item', 'field_element_binding']) assert(result.some(row => row.reference_kind === kind), kind);
  for (const key of ['definition', 'mapping', 'handoff', 'batch']) assert(result.some(row => row.reference_key === 'analysis_input:500:' + key));
  assert.equal(result.find(row => row.reference_kind === 'mapping_version').scope_department_id, '92');
  assert.equal(result.find(row => row.reference_kind === 'analysis_input').scope_department_id, '93');
  assert(result.some(row => row.operation === 'reuse' && row.scope_mode === 'historical'));
  assert.equal(new Set(result.map(row => row.reference_key)).size, result.length);
  const reordered = Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.slice().reverse()]));
  assert.deepEqual(referenceClosure(reordered, [objectTarget]), result);
  const excluded = referenceClosure(data, [objectTarget], { excludePublicationId: 'p1' });
  assert(!excluded.some(row => row.publication_id === 'p1')); assert(excluded.some(row => row.publication_id === 'p2'));
  assert(!excluded.some(row => row.reference_key === 'definition_identifier:100:0:200'));
  const element = referenceClosure(data, [{ target_kind: 'data_element', target_id: 'e1', target_version_ref: 'ev1' }]);
  assert(element.some(row => row.reference_key === 'analysis_input:500:handoff'));
  const externalOnly = referenceClosure(data, [{ target_kind: 'data_element', target_id: 'e1', target_version_ref: 'ev1' }], { excludePublicationId: 'p3' });
  assert(!externalOnly.some(row => row.publication_id === 'p3'));
  assert(!externalOnly.some(row => row.reference_key === 'definition_parent:201'));
  assert(externalOnly.some(row => row.reference_key === 'analysis_input:500:handoff'));
  const before = digest(result);
  data.data_map_analysis_inputs.push({ ...data.data_map_analysis_inputs[2], input_key: 'new-handoff' });
  assert.notEqual(digest(referenceClosure(data, [objectTarget])), before);
  const absent = referenceClosure({}, [objectTarget], { missing: ['data_map_analysis_inputs'] });
  assert.deepEqual(absent, [{ reference_key: 'schema_not_installed:data_map_analysis_inputs', reference_kind: 'schema_not_installed', status: 'not_installed', table_name: 'data_map_analysis_inputs' }]);
  assert.throws(() => referenceClosure(data, [{ ...objectTarget, target_id: '9007199254740992' }]), { code: 'HANDOFF_IMPACT_TARGET_MISMATCH' });
  assert.throws(() => referenceClosure(data, [{ ...objectTarget, target_id: 9007199254740993 }]), { code: 'HANDOFF_IMPACT_ID_INEXACT' });
  console.log('PASS HANDOFF_IMPACT_PURE: direct and transitive fixed references, cycles, reuse, exact IDs, deterministic closure, exclusion and changed-edge digest');
}
if (require.main === module) main();
module.exports = { fixture, objectTarget, main };
