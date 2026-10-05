const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const References = require('../public/element-references');
const { validateProcessGovernanceV8 } = require('../../../scripts/process-governance/v7-validator');

const clone = value => JSON.parse(JSON.stringify(value));
const target = (kind, ref, parentRef = '') => ({ kind, ref, parentRef });
const byPath = (catalog, path) => catalog.references.find(entry => entry.path === path);
const itemPath = '/forms/0/areas/0/items/0';

function fixture() {
  return {
    schema_version: 'process-governance-v8',
    export_meta: { package_ref: 'package_test' }, process: { process_ref: 'process_test', process_name: '申请流程' },
    terms: [{ term_ref: 'term_test', term_name: '申请' }],
    behaviors: [
      { behavior_ref: 'behavior_prepare', behavior_name: '核对申请', node_type: 'action', actor_department_data_ref: 'data_request' },
      { behavior_ref: 'behavior_check', behavior_name: '核对申请', node_type: 'action', actor_department_data_ref: null }
    ],
    flow_relations: [{ relation_ref: 'relation_check', relation_type: 'sequence', from_behavior_ref: 'behavior_prepare', to_behavior_ref: 'behavior_check' }],
    data_objects: [{
      data_ref: 'data_request', data_name: '申请信息',
      fields: [{ field_ref: 'field_amount', field_name: '金额', field_type: '金额' }, { field_ref: 'field_state', field_name: '状态', field_type: '文本' }],
      behavior_links: [
        { link_ref: 'data_link_use', behavior_ref: 'behavior_check', operation: 'use', updated_field_refs: [] },
        { link_ref: 'data_link_update', behavior_ref: 'behavior_prepare', operation: 'update', updated_field_refs: ['field_amount'] }
      ],
      source_relations: [{ source_ref: 'source_request', available_from_behavior_ref: 'behavior_prepare' }],
      lifecycle: { routes: [{ route_ref: 'route_request', flow_relation_refs: ['relation_check'], events: [{ event_ref: 'event_request', trigger: { behavior_ref: 'behavior_check' } }] }] }
    }, {
      data_ref: 'data_other', data_name: '申请信息', fields: [{ field_ref: 'field_other_amount', field_name: '金额', field_type: '金额' }],
      behavior_links: [], source_relations: [], lifecycle: { routes: [] }
    }],
    forms: [{
      form_ref: 'form_request', form_name: '申请单', behavior_links: [{ link_ref: 'form_link_check', behavior_ref: 'behavior_check' }],
      areas: [{ area_ref: 'area_main', area_title: '基本信息', items: [{
        item_ref: 'item_amount', item_name: '金额', item_type: '金额', business_data_ref: 'data_request', data_field_ref: 'field_amount',
        source_links: [{ source_link_ref: 'source_link_amount', source_type: 'process_data', source_data_ref: 'data_other' }]
      }, { item_ref: 'item_empty', item_name: '说明', business_data_ref: null, data_field_ref: '', source_links: [] }] }]
    }, {
      form_ref: 'form_other', form_name: '申请单', behavior_links: [], areas: [{ area_ref: 'area_other', area_title: '基本信息', items: [{
        item_ref: 'item_other_amount', item_name: '金额', item_type: '金额', business_data_ref: 'data_other', data_field_ref: 'field_other_amount', source_links: []
      }] }]
    }],
    migration: {
      source_process_ref: 'process_test', reference_materials: [{ material_ref: 'material_test' }], work_roles: [{ archive_ref: 'archive_test', behavior_ref: 'behavior_prepare' }],
      internal_process_calls: [{ call_ref: 'call_test', caller_behavior_ref: 'behavior_prepare', target_process_ref: 'process_test', return_behavior_ref: 'behavior_check', input_data_refs: ['data_request'], output_data_refs: ['data_other'] }],
      unresolved_actor_roles: [{ record_ref: 'record_actor', behavior_ref: 'behavior_check' }],
      unresolved_join_modes: [{ record_ref: 'record_join', relation_ref: 'relation_check' }],
      legacy_cross_department_records: [{ record_ref: 'record_handoff', source_handoff: { anchor_behavior_ref: 'behavior_prepare', resume_behavior_ref: 'behavior_check', transfer_data_ref: 'data_request', returned_data_ref: 'data_other' }, created_behavior_ref: 'behavior_check', created_relation_refs: ['relation_check'], created_data_link_refs: ['data_link_use'] }]
    }
  };
}

// Check the shared 3000 reference rules without Ajv, a server, database, or file writes.
function localValidation(document) {
  return validateProcessGovernanceV8(document, { schemaValidator: () => true });
}

function freeze(value) {
  if (!value || typeof value !== 'object') return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

{
  const source = fixture();
  assert.equal(localValidation(source).valid, true);
  const snapshot = clone(source);
  const catalog = References.buildCatalog(freeze(source));
  assert.deepEqual(source, snapshot, 'catalog creation must not mutate the source document');
  assert.equal(catalog.nodes.length, 24);
  assert.equal(catalog.references.filter(entry => entry.status !== 'valid').length, 2);
  assert.equal(byPath(catalog, '/migration/source_process_ref').status, 'external', 'a migration source is not a local process link, even with identical text');
  assert.equal(byPath(catalog, '/migration/source_process_ref').target, null);
  assert.equal(byPath(catalog, '/migration/internal_process_calls/0/target_process_ref').status, 'external');
  assert.equal(byPath(catalog, '/migration/internal_process_calls/0/target_process_ref').target, null, 'a retained call target must not resolve to this process merely because the IDs coincide');
  assert.ok(!catalog.references.some(entry => entry.path.startsWith('/forms/0/areas/0/items/1/')), 'nullable references must retain their unreferenced meaning');
  assert.equal(References.lookup(catalog, target('behavior', 'behavior_prepare')).status, 'valid');
  assert.equal(References.lookup(catalog, target('process', 'process_test')).node.label, '申请流程');
  assert.equal(References.lookup(catalog, target('term', 'term_test')).node.label, '申请');
  assert.equal(References.lookup(catalog, target('form-area', 'area_main', 'form_request')).node.label, '申请单 / 基本信息');
  assert.equal(References.lookup(catalog, target('form-area', 'area_main', 'form_other')).status, 'wrong-owner');
  assert.equal(References.lookup(catalog, target('form-area', 'area_main')).status, 'missing', 'form-area navigation requires its explicit form owner');
  for (const [kind, ref, parentRef] of [
    ['data-link', 'data_link_update', 'data_request'], ['data-source', 'source_request', 'data_request'],
    ['form-link', 'form_link_check', 'form_request'], ['field-source', 'source_link_amount', 'item_amount'],
    ['lifecycle-route', 'route_request', 'data_request'], ['lifecycle-event', 'event_request', 'route_request']
  ]) {
    assert.equal(References.lookup(catalog, target(kind, ref, parentRef)).status, 'valid', `${kind} must be individually inspectable`);
    assert.equal(References.lookup(catalog, target(kind, ref)).status, 'missing', `${kind} requires an explicit owner`);
    assert.equal(References.lookup(catalog, target(kind, ref, 'other_owner')).status, 'wrong-owner');
  }
  assert.equal(References.lookup(catalog, target('behavior', 'behavior_check')).status, 'valid', 'same display names do not make stable identities ambiguous');
  assert.equal(References.lookup(catalog, target('data-field', 'field_amount', 'data_request')).node.label, '申请信息 / 金额');
  assert.equal(References.lookup(catalog, target('form-item', 'item_amount', 'form_request')).node.label, '申请单 / 基本信息 / 金额');
  assert.equal(References.lookup(catalog, target('data-field', 'field_amount', 'data_other')).status, 'wrong-owner');
  assert.equal(References.lookup(catalog, target('data-field', 'field_amount')).status, 'missing', 'nested field navigation needs an explicit owner');
  assert.equal(References.lookup(catalog, { kind: 'form-item', ref: 'item_amount' }).status, 'missing', 'nested form-item navigation cannot infer an omitted owner');
  assert.equal(References.lookup(catalog, target('form-item', 'item_amount')).node, null);
  assert.equal(References.lookup(catalog, target('relation', 'relation_check')).node.label, '核对申请 → 核对申请');
  catalog.nodes[0].label = 'view only';
  catalog.nodes[0].target.ref = 'view_only';
  catalog.references[0].relationLabel = 'view only';
  assert.deepEqual(source, snapshot, 'catalog output must not contain mutable source objects');
}

{
  const catalog = References.buildCatalog(fixture());
  const behavior = References.forTarget(catalog, target('behavior', 'behavior_check'));
  const expectedPaths = [
    '/flow_relations/0/to_behavior_ref', '/data_objects/0/behavior_links/0/behavior_ref', '/forms/0/behavior_links/0/behavior_ref',
    '/data_objects/0/lifecycle/routes/0/events/0/trigger/behavior_ref', '/migration/internal_process_calls/0/return_behavior_ref',
    '/migration/unresolved_actor_roles/0/behavior_ref', '/migration/legacy_cross_department_records/0/created_behavior_ref'
  ];
  expectedPaths.forEach(path => assert.ok(behavior.incoming.some(entry => entry.path === path), path));
  const field = References.forTarget(catalog, target('data-field', 'field_amount', 'data_request'));
  assert.deepEqual(field.incoming.map(entry => entry.path).sort(), ['/data_objects/0/behavior_links/1/updated_field_refs/0', `${itemPath}/data_field_ref`].sort());
  const item = References.forTarget(catalog, target('form-item', 'item_amount', 'form_request'));
  assert.equal(item.outgoing.length, 3);
  assert.ok(item.outgoing.every(entry => entry.sourceTarget.parentRef === 'form_request'));
  const form = References.forTarget(catalog, target('form', 'form_request'));
  const expandedForm = References.forTarget(catalog, target('form', 'form_request'), { includeDescendants: true });
  assert.equal(form.outgoing.length, 1);
  assert.equal(expandedForm.outgoing.length, 4);
  const expandedArea = References.forTarget(catalog, target('form-area', 'area_main', 'form_request'), { includeDescendants: true });
  assert.equal(expandedArea.outgoing.length, 3);
  assert.ok(expandedArea.outgoing.every(entry => entry.sourceTarget.ref === 'item_amount'), 'area aggregation identifies the actual form-item source');
  assert.deepEqual(References.forTarget(catalog, target('term', 'term_test')), { outgoing: [], incoming: [] }, 'terms have definitions, but no structured usage contract');
  const data = References.forTarget(catalog, target('data', 'data_request'));
  const expandedData = References.forTarget(catalog, target('data', 'data_request'), { includeDescendants: true });
  assert.ok(expandedData.incoming.some(entry => entry.path === `${itemPath}/data_field_ref`));
  assert.ok(!data.incoming.some(entry => entry.path === `${itemPath}/data_field_ref`));
  const legacyLink = byPath(catalog, '/migration/legacy_cross_department_records/0/created_data_link_refs/0');
  assert.equal(legacyLink.status, 'valid');
  assert.deepEqual(legacyLink.target, target('data', 'data_request'), 'a nested legacy data link navigates to its existing owner, without creating a new business ID');
  assert.deepEqual(legacyLink.elementTarget, target('data-link', 'data_link_use', 'data_request'), 'the workbench can inspect the exact referenced record while retained-homepage navigation stays compatible');
  assert.ok(References.forTarget(catalog, target('behavior', 'behavior_prepare')).incoming.some(entry => entry.path === '/migration/work_roles/0/behavior_ref'));
  const record = References.forTarget(catalog, target('data-link', 'data_link_update', 'data_request'));
  assert.deepEqual(record.outgoing.map(entry => entry.path).sort(), ['/data_objects/0/behavior_links/1/behavior_ref', '/data_objects/0/behavior_links/1/updated_field_refs/0'].sort());
  assert.ok(record.outgoing.every(entry => entry.sourceTarget.kind === 'data' && entry.sourceTarget.ref === 'data_request'), 'a structured record preserves its explicit upper-level attribution');
  assert.ok(References.forTarget(catalog, target('data-link', 'data_link_use', 'data_request')).incoming.some(entry => entry.path === legacyLink.path));
  assert.deepEqual(References.forTarget(catalog, target('data-link', 'data_link_update', 'wrong_parent')), { outgoing: [], incoming: [] }, 'path-based projection must first prove a unique owned target');
  assert.equal(References.forTarget(catalog, target('data-source', 'source_request', 'data_request')).outgoing.length, 1);
  assert.equal(References.forTarget(catalog, target('form-link', 'form_link_check', 'form_request')).outgoing.length, 1);
  assert.equal(References.forTarget(catalog, target('field-source', 'source_link_amount', 'item_amount')).outgoing.length, 1);
  assert.equal(References.forTarget(catalog, target('lifecycle-event', 'event_request', 'route_request')).outgoing.length, 1);
  assert.equal(References.forTarget(catalog, target('lifecycle-route', 'route_request', 'data_request')).outgoing.length, 2, 'route scope includes its explicitly contained event source');
}

{
  const source = fixture();
  source.flow_relations[0].to_behavior_ref = 'behavior_missing';
  source.forms[0].behavior_links[0].behavior_ref = 'behavior_missing';
  source.forms[0].areas[0].items[0].source_links[0].source_data_ref = 'data_missing';
  source.behaviors[0].actor_department_data_ref = ' data_request ';
  const catalog = References.buildCatalog(source);
  ['/flow_relations/0/to_behavior_ref', '/forms/0/behavior_links/0/behavior_ref', `${itemPath}/source_links/0/source_data_ref`, '/behaviors/0/actor_department_data_ref'].forEach(path => {
    assert.equal(byPath(catalog, path).status, 'missing');
    assert.equal(byPath(catalog, path).target, null);
    assert.ok(localValidation(source).errors.some(error => error.path === path), 'catalog failure must agree with the shared local-reference validator');
  });
  assert.match(References.lookup(catalog, target('relation', 'relation_check')).node.label, /当前文件中未找到：behavior_missing/);
}

for (const [path, mutate] of [
  ['/data_objects/0/source_relations/0/available_from_behavior_ref', source => { source.data_objects[0].source_relations[0].available_from_behavior_ref = 'missing_ref'; }],
  ['/data_objects/0/lifecycle/routes/0/flow_relation_refs/0', source => { source.data_objects[0].lifecycle.routes[0].flow_relation_refs[0] = 'missing_ref'; }],
  ['/data_objects/0/lifecycle/routes/0/events/0/trigger/behavior_ref', source => { source.data_objects[0].lifecycle.routes[0].events[0].trigger.behavior_ref = 'missing_ref'; }],
  ['/migration/internal_process_calls/0/caller_behavior_ref', source => { source.migration.internal_process_calls[0].caller_behavior_ref = 'missing_ref'; }],
  ['/migration/internal_process_calls/0/input_data_refs/0', source => { source.migration.internal_process_calls[0].input_data_refs[0] = 'missing_ref'; }],
  ['/migration/internal_process_calls/0/output_data_refs/0', source => { source.migration.internal_process_calls[0].output_data_refs[0] = 'missing_ref'; }],
  ['/migration/unresolved_actor_roles/0/behavior_ref', source => { source.migration.unresolved_actor_roles[0].behavior_ref = 'missing_ref'; }],
  ['/migration/unresolved_join_modes/0/relation_ref', source => { source.migration.unresolved_join_modes[0].relation_ref = 'missing_ref'; }],
  ['/migration/legacy_cross_department_records/0/source_handoff/transfer_data_ref', source => { source.migration.legacy_cross_department_records[0].source_handoff.transfer_data_ref = 'missing_ref'; }],
  ['/migration/legacy_cross_department_records/0/created_relation_refs/0', source => { source.migration.legacy_cross_department_records[0].created_relation_refs[0] = 'missing_ref'; }],
  ['/migration/legacy_cross_department_records/0/created_data_link_refs/0', source => { source.migration.legacy_cross_department_records[0].created_data_link_refs[0] = 'missing_ref'; }]
]) {
  const source = fixture();
  mutate(source);
  const catalog = References.buildCatalog(source);
  assert.equal(byPath(catalog, path).status, 'missing', `all supported relation categories must expose broken paths: ${path}`);
  assert.ok(localValidation(source).errors.some(error => error.path === path), 'relation coverage must agree with the backend shared validator');
}

{
  const source = fixture();
  source.data_objects[0].behavior_links[1].updated_field_refs = ['field_other_amount'];
  source.forms[0].areas[0].items[0].business_data_ref = 'data_other';
  const catalog = References.buildCatalog(source);
  const updated = byPath(catalog, '/data_objects/0/behavior_links/1/updated_field_refs/0');
  assert.equal(updated.status, 'wrong-owner');
  assert.equal(updated.expectedOwnerRef, 'data_request');
  assert.deepEqual(updated.target, target('data-field', 'field_other_amount', 'data_other'), 'wrong-owner references retain the real unique field for inspection');
  const itemField = byPath(catalog, `${itemPath}/data_field_ref`);
  assert.equal(itemField.status, 'wrong-owner');
  assert.deepEqual(itemField.target, target('data-field', 'field_amount', 'data_request'));
  assert.ok(localValidation(source).errors.some(error => error.path === `${itemPath}/data_field_ref`));
  assert.ok(localValidation(source).errors.some(error => error.path === updated.path));
  source.forms[0].areas[0].items[0].business_data_ref = null;
  assert.equal(byPath(References.buildCatalog(source), `${itemPath}/data_field_ref`).status, 'wrong-owner', 'a referenced field still needs its explicit data owner');
}

for (const mutation of [
  source => { source.data_objects[1].fields[0].field_ref = 'field_amount'; },
  source => { source.data_objects[0].fields.push(clone(source.data_objects[0].fields[0])); },
  source => { source.data_objects[0].lifecycle.routes[0].route_ref = 'field_amount'; },
  source => { source.migration.reference_materials[0].material_ref = 'field_amount'; }
]) {
  const source = fixture();
  mutation(source);
  const catalog = References.buildCatalog(source);
  assert.equal(References.lookup(catalog, target('data-field', 'field_amount', 'data_request')).status, 'ambiguous');
  assert.equal(References.lookup(catalog, target('data-field', 'field_amount', 'data_request')).node, null);
  assert.equal(byPath(catalog, `${itemPath}/data_field_ref`).status, 'ambiguous');
  assert.equal(byPath(catalog, `${itemPath}/data_field_ref`).target, null);
  assert.equal(localValidation(source).valid, false);
}

{
  // Every registered technical ID, including nested/migration IDs, participates in global uniqueness.
  const identityPaths = [
    '/export_meta/package_ref', '/process/process_ref', '/terms/0/term_ref', '/behaviors/0/behavior_ref', '/flow_relations/0/relation_ref', '/data_objects/0/data_ref',
    '/data_objects/0/behavior_links/0/link_ref', '/data_objects/0/source_relations/0/source_ref', '/data_objects/0/lifecycle/routes/0/route_ref', '/data_objects/0/lifecycle/routes/0/events/0/event_ref',
    '/forms/0/form_ref', '/forms/0/behavior_links/0/link_ref', '/forms/0/areas/0/area_ref', '/forms/0/areas/0/items/0/item_ref', '/forms/0/areas/0/items/0/source_links/0/source_link_ref',
    '/migration/reference_materials/0/material_ref', '/migration/internal_process_calls/0/call_ref', '/migration/work_roles/0/archive_ref',
    '/migration/unresolved_actor_roles/0/record_ref', '/migration/unresolved_join_modes/0/record_ref', '/migration/legacy_cross_department_records/0/record_ref'
  ];
  for (const path of identityPaths) {
    const source = fixture();
    const segments = path.slice(1).split('/');
    const key = segments.pop();
    const owner = segments.reduce((value, segment) => value[segment], source);
    owner[key] = 'field_amount';
    const catalog = References.buildCatalog(source);
    assert.equal(References.lookup(catalog, target('data-field', 'field_amount', 'data_request')).status, 'ambiguous', path);
    assert.ok(localValidation(source).errors.some(error => error.params && error.params.ref === 'field_amount'), `the shared validator must also reject identity collision at ${path}`);
  }
}

{
  const source = fixture();
  source.behaviors[0].behavior_ref = 'data_request';
  const catalog = References.buildCatalog(source);
  assert.equal(References.lookup(catalog, target('data', 'data_request')).status, 'ambiguous', 'cross-type identity collisions must not select the apparently matching kind');
  assert.equal(References.lookup(catalog, target('behavior', 'data_request')).status, 'ambiguous');
  assert.equal(byPath(catalog, `${itemPath}/business_data_ref`).status, 'ambiguous');
}

{
  const source = fixture();
  source.data_objects[1].data_ref = 'data_request';
  const catalog = References.buildCatalog(source);
  assert.equal(References.lookup(catalog, target('data-field', 'field_amount', 'data_request')).status, 'ambiguous', 'a unique child must not navigate through an ambiguous parent');
  assert.equal(byPath(catalog, `${itemPath}/data_field_ref`).status, 'ambiguous');
  source.forms[1].areas[0].area_ref = 'area_main';
  assert.equal(References.lookup(References.buildCatalog(source), target('form-item', 'item_amount', 'form_request')).status, 'ambiguous');
}

{
  const source = fixture();
  source.forms[0].areas[0].items[0].source_links[0] = { source_link_ref: 'source_link_amount', source_type: 'external_system', source_data_ref: 'data_request' };
  const catalog = References.buildCatalog(source);
  const external = byPath(catalog, `${itemPath}/source_links/0/source_data_ref`);
  assert.equal(external.status, 'external');
  assert.equal(external.target, null, 'external-system values cannot be inferred to reference a local object');
  assert.ok(!References.forTarget(catalog, target('data', 'data_request')).incoming.some(entry => entry.path === external.path));
  source.forms[0].areas[0].items[0].source_links[0].source_data_ref = null;
  assert.ok(!byPath(References.buildCatalog(source), external.path), 'an external-system description with no stable local reference must not create a fake link');
}

{
  const source = fixture();
  source.migration.work_roles[0].behavior_ref = 'behavior_archived_missing';
  assert.equal(byPath(References.buildCatalog(source), '/migration/work_roles/0/behavior_ref').status, 'missing');
  assert.equal(localValidation(source).valid, true, 'archive anchor visibility must not be misrepresented as an existing backend blocking rule');
}

{
  const document = fixture();
  document.behaviors[0].node_type = 'decision';
  const catalog = References.buildCatalog(document);
  assert.equal(byPath(catalog, '/data_objects/0/behavior_links/1/behavior_ref').status, 'valid', 'technical existence must not claim an update on a decision node is business-valid');
  assert.ok(localValidation(document).errors.some(error => error.rule_code === 'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED'));
}

{
  for (const [kind, ref, parentRef, mutate] of [
    ['process', 'process_test', '', source => { source.terms[0].term_ref = 'process_test'; }],
    ['term', 'term_test', '', source => { source.terms.push(clone(source.terms[0])); }],
    ['form-area', 'area_main', 'form_request', source => { source.forms[1].areas[0].area_ref = 'area_main'; }]
  ]) {
    const source = fixture();
    mutate(source);
    assert.equal(References.lookup(References.buildCatalog(source), target(kind, ref, parentRef)).status, 'ambiguous', `${kind} cannot resolve a globally duplicate identity`);
  }
}

{
  // Rendering a department selector must preserve invalid original bytes and disabled choices.
  const document = fixture();
  const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
  const context = {
    ElementReferences: References, currentDocument: () => document,
    text: value => value == null ? '' : String(value), currentDataFlowDetails: () => ({ isAvailableBeforeBehavior: () => true })
  };
  vm.createContext(context);
  const offset = html.indexOf('    function dynamicDepartmentDataOptions(');
  vm.runInContext(html.slice(offset, html.indexOf('\n    function ', offset + 1)), context);
  const rawRef = ' data_request ';
  const choices = context.dynamicDepartmentDataOptions({ behavior_ref: 'behavior_check', actor_department_data_ref: rawRef });
  const retained = choices.find(option => option.value === rawRef);
  assert.equal(retained.disabled, true);
  assert.match(retained.label, /原值保留/);
  assert.ok(choices.some(option => option.value === 'data_request' && !option.disabled), 'a separate explicit valid choice may coexist without correcting the original');
  document.data_objects.push(clone(document.data_objects[0]));
  const duplicates = context.dynamicDepartmentDataOptions({ behavior_ref: 'behavior_check', actor_department_data_ref: 'data_request' });
  assert.equal(duplicates.filter(option => option.value === 'data_request').length, 1);
  assert.equal(duplicates.find(option => option.value === 'data_request').disabled, true);
}

{
  const browserContext = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/element-references'), 'utf8'), browserContext);
  assert.equal(typeof browserContext.ElementReferences.buildCatalog, 'function');
  const source = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(browserContext.ElementReferences.buildCatalog(source))), References.buildCatalog(source), 'browser and Node projections must agree');
  for (const document of [null, undefined, {}, { behaviors: [null], forms: [null], data_objects: [null], flow_relations: [null] }]) {
    assert.doesNotThrow(() => References.buildCatalog(document), 'partial documents must remain inspectable without guessing defaults');
  }
  assert.deepEqual(References.forTarget(References.buildCatalog(null), null), { outgoing: [], incoming: [] });
}

console.log('Element reference catalog, shared validation boundary, ownership, ambiguity, bidirectional navigation, and source immutability tests passed');
