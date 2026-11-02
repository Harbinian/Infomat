// Read-only fixed-reference closure. Caller owns the control graph lock and its
// transaction; every installed reference table is read completely with FOR SHARE.
const crypto = require('node:crypto');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fixedId = value => {
  if (value == null) return null;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw failure('HANDOFF_IMPACT_ID_INEXACT');
  return String(value);
};
const failure = code => Object.assign(new Error(code), { code, statusCode: 409 });
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, stable(value[key])])) : value;
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function parse(value) {
  if (value == null) return null;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw failure('HANDOFF_IMPACT_SNAPSHOT_INVALID');
  return parsed;
}
const cast = name => `CAST(${name} AS CHAR) AS ${name}`;
const TABLES = Object.freeze({
  data_map_definition_versions: ['version_id', 'entity_id', 'object_version_id'].map(cast).concat(['entity_type', 'definition_json', 'base_snapshot_json', 'content_digest']),
  data_map_source_mappings: ['mapping_id', 'batch_id', 'platform_version_id'].map(cast).concat(['sheet_name', 'record_type', 'local_id', 'source_row', 'unresolved_reason']),
  data_map_source_files: ['batch_id', 'scope_department_id'].map(cast),
  data_map_v7_mapping_versions: ['mapping_version_id', 'mapping_id', 'object_version_id', 'field_version_id', 'parent_mapping_version_id'].map(cast).concat(['status', 'snapshot_digest']),
  data_map_v7_mappings: ['mapping_id', 'source_id'].map(cast),
  data_map_v7_sources: ['source_id', 'scope_department_id', 'process_version_id'].map(cast).concat(['source_kind']),
  data_map_design_handoff_refs: ['handoff_version_id', 'mapping_version_id'].map(cast).concat(['side']),
  data_map_design_handoff_versions: ['handoff_version_id', 'handoff_id'].map(cast).concat(['claim_status', 'snapshot_digest']),
  data_map_analysis_inputs: ['run_id', 'source_id', 'definition_version_id', 'mapping_version_id', 'handoff_version_id', 'batch_id'].map(cast).concat(['input_key', 'snapshot_digest']),
  data_map_analysis_runs: ['run_id', 'scope_department_id'].map(cast).concat(['status', 'manifest_digest']),
  data_map_publications: ['publication_id', 'scope_mode', 'manifest_json', 'manifest_digest'],
  data_map_publication_items: ['publication_id', 'item_ref', 'target_kind', 'target_id', 'target_version_ref', 'operation', 'produces_version', 'payload_json'],
  data_map_field_element_bindings: ['binding_id', cast('field_version_id'), 'element_version_id', 'context_version_ref', 'publication_id'],
  data_map_data_element_versions: ['element_version_id', 'element_id', 'publication_id'],
  process_data_governance_work_packages: ['id', 'owning_department_id', 'process_version_id'].map(cast)
});

async function readInstalledGraph(db) {
  const names = Object.keys(TABLES);
  const data = {}, missing = [];
  // Deterministic table order also keeps qualification reads reproducible.
  // MySQL rejects locking clauses on information_schema views. Reading each
  // fixed allowlisted table directly holds its actual rows/metadata; only a
  // genuine absent table is classified as not installed. Drift/denial propagate.
  for (const table of names.sort(compare)) {
    try {
      const [rows] = await db.execute(`SELECT ${TABLES[table].join(',')} FROM ${table} FOR SHARE`);
      data[table] = rows;
    } catch (error) {
      if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
      data[table] = []; missing.push(table);
    }
  }
  return { data, missing };
}

function referenceClosure(data, targets, { excludePublicationId = null, missing = [] } = {}) {
  const definitionByVersion = new Map((data.data_map_definition_versions || []).map(row => [fixedId(row.version_id), row]));
  const elementByVersion = new Map((data.data_map_data_element_versions || []).map(row => [row.element_version_id, row]));
  const publicationById = new Map((data.data_map_publications || []).map(row => [row.publication_id, { ...row, manifest: parse(row.manifest_json) }]));
  const packages = new Map((data.process_data_governance_work_packages || []).map(row => [fixedId(row.id), row]));
  const fileByBatch = new Map((data.data_map_source_files || []).map(row => [fixedId(row.batch_id), row]));
  const sourceById = new Map((data.data_map_v7_sources || []).map(row => [fixedId(row.source_id), row]));
  const mappingById = new Map((data.data_map_v7_mappings || []).map(row => [fixedId(row.mapping_id), row]));
  const handoffByVersion = new Map((data.data_map_design_handoff_versions || []).map(row => [fixedId(row.handoff_version_id), row]));
  const runById = new Map((data.data_map_analysis_runs || []).map(row => [fixedId(row.run_id), row]));
  const references = new Map(), affected = new Map();
  const producers = new Map();
  for (const item of data.data_map_publication_items || []) if (Number(item.produces_version) === 1) {
    const key = item.target_kind + ':' + fixedId(item.target_version_ref);
    if (!producers.has(key)) producers.set(key, new Set());
    producers.get(key).add(item.publication_id);
  }
  const versionNode = (kind, version) => version == null ? null : ['object', 'field'].includes(kind)
    ? 'definition:' + fixedId(version) : kind + ':' + fixedId(version);
  const targetKey = target => JSON.stringify([target.target_kind, target.target_id, target.target_version_ref]);
  const knownTargets = new Map();
  for (const item of data.data_map_publication_items || []) {
    const key = item.target_kind + ':' + fixedId(item.target_version_ref), entity = fixedId(item.target_id);
    if (knownTargets.has(key) && knownTargets.get(key) !== entity) throw failure('HANDOFF_IMPACT_AMBIGUOUS_VERSION');
    knownTargets.set(key, entity);
  }
  const normalizedTargets = [...new Map(targets.map(target => {
    if (!target || !['object', 'field', 'data_element', 'context', 'rule', 'authority'].includes(target.target_kind) || !fixedId(target.target_id) || !fixedId(target.target_version_ref)) throw failure('HANDOFF_IMPACT_TARGET_INVALID');
    const value = { target_kind: target.target_kind, target_id: fixedId(target.target_id), target_version_ref: fixedId(target.target_version_ref) };
    const definition = ['object', 'field'].includes(value.target_kind) && definitionByVersion.get(value.target_version_ref);
    if (definition && (definition.entity_type !== value.target_kind || fixedId(definition.entity_id) !== value.target_id)) throw failure('HANDOFF_IMPACT_TARGET_MISMATCH');
    const element = value.target_kind === 'data_element' && elementByVersion.get(value.target_version_ref);
    if (element && element.element_id !== value.target_id) throw failure('HANDOFF_IMPACT_TARGET_MISMATCH');
    const knownEntity = knownTargets.get(value.target_kind + ':' + value.target_version_ref);
    if (knownEntity && knownEntity !== value.target_id) throw failure('HANDOFF_IMPACT_TARGET_MISMATCH');
    return [targetKey(value), value];
  })).values()].sort((a, b) => compare(targetKey(a), targetKey(b)));
  for (const target of normalizedTargets) {
    const node = versionNode(target.target_kind, target.target_version_ref);
    if (!affected.has(node)) affected.set(node, new Set());
    affected.get(node).add(targetKey(target));
  }
  function add(referenceKind, key, dependencies, produces, details, visible = true) {
    const upstream = [...new Set(dependencies.filter(Boolean))].sort(compare);
    const existing = references.get(key);
    if (existing) {
      if (digest(existing.record) !== digest({ reference_key: key, reference_kind: referenceKind, ...details })) throw failure('HANDOFF_IMPACT_DUPLICATE_REFERENCE');
      existing.upstream = [...new Set(existing.upstream.concat(upstream))].sort(compare);
      return;
    }
    references.set(key, { node: produces || key, upstream, visible,
      record: { reference_key: key, reference_kind: referenceKind, ...details } });
  }
  function publicationDetails(publicationId) {
    const publication = publicationById.get(publicationId);
    if (!publication) return {};
    const manifest = publication.manifest || {};
    const pkg = packages.get(fixedId(manifest.package_id));
    return { scope_mode: publication.scope_mode, manifest_digest: publication.manifest_digest,
      ...(manifest.package_id == null ? {} : { package_id: fixedId(manifest.package_id) }),
      ...(manifest.process_version_id == null ? {} : { process_version_id: fixedId(manifest.process_version_id) }),
      ...(pkg?.owning_department_id == null ? {} : { scope_department_id: fixedId(pkg.owning_department_id) }) };
  }
  for (const row of data.data_map_definition_versions || []) {
    const own = versionNode(row.entity_type, row.version_id), definition = parse(row.definition_json), base = parse(row.base_snapshot_json);
    const ownership = producers.get(row.entity_type + ':' + fixedId(row.version_id));
    const visible = !(excludePublicationId && ownership?.size === 1 && ownership.has(excludePublicationId));
    const ids = { definition_version_id: fixedId(row.version_id), entity_type: row.entity_type, entity_id: fixedId(row.entity_id), content_digest: row.content_digest,
      ...(base?.row?.owner_dept_id == null ? {} : { scope_department_id: fixedId(base.row.owner_dept_id) }) };
    if (row.object_version_id != null) add('definition_parent', 'definition_parent:' + row.version_id,
      [versionNode('object', row.object_version_id)], own, { ...ids, object_version_id: fixedId(row.object_version_id) }, visible);
    for (const [index, group] of (definition?.unique_identifiers || []).entries()) for (const version of group.field_version_ids || []) {
      add('definition_identifier', 'definition_identifier:' + row.version_id + ':' + index + ':' + fixedId(version),
        [versionNode('field', version)], own, { ...ids, identifier_index: index, field_version_id: fixedId(version) }, visible);
    }
  }
  for (const row of data.data_map_publication_items || []) {
    const payload = parse(row.payload_json), own = versionNode(row.target_kind, row.target_version_ref);
    const dependencies = [own, versionNode('object', payload?.object_version_id), versionNode('context', payload?.context_version_ref), versionNode('data_element', payload?.data_element_version_ref)];
    for (const group of payload?.definition?.unique_identifiers || []) for (const version of group.field_version_ids || []) dependencies.push(versionNode('field', version));
    add('publication_item', 'publication_item:' + row.publication_id + ':' + row.item_ref, dependencies, own,
      { publication_id: row.publication_id, item_ref: row.item_ref, target_kind: row.target_kind,
        target_id: fixedId(row.target_id), target_version_ref: fixedId(row.target_version_ref), operation: row.operation,
        produces_version: Number(row.produces_version), payload_digest: digest(payload), ...publicationDetails(row.publication_id),
        ...(payload?.object_version_id == null ? {} : { object_version_id: fixedId(payload.object_version_id) }),
        ...(payload?.context_version_ref == null ? {} : { context_version_ref: fixedId(payload.context_version_ref) }),
        ...(payload?.data_element_version_ref == null ? {} : { element_version_id: fixedId(payload.data_element_version_ref) }) }, row.publication_id !== excludePublicationId);
  }
  for (const row of data.data_map_field_element_bindings || []) {
    add('field_element_binding', 'field_element_binding:' + row.binding_id,
      [versionNode('field', row.field_version_id), versionNode('data_element', row.element_version_id), versionNode('context', row.context_version_ref)],
      versionNode('field', row.field_version_id), { binding_id: row.binding_id, field_version_id: fixedId(row.field_version_id),
        element_version_id: row.element_version_id, context_version_ref: row.context_version_ref, publication_id: row.publication_id, ...publicationDetails(row.publication_id) }, row.publication_id !== excludePublicationId);
  }
  for (const row of data.data_map_source_mappings || []) if (row.platform_version_id != null) {
    const file = fileByBatch.get(fixedId(row.batch_id));
    add('source_mapping', 'source_mapping:' + row.mapping_id, ['definition:' + fixedId(row.platform_version_id)], 'batch:' + fixedId(row.batch_id),
      { ...row, mapping_id: fixedId(row.mapping_id), batch_id: fixedId(row.batch_id), platform_version_id: fixedId(row.platform_version_id),
        ...(file?.scope_department_id == null ? {} : { scope_department_id: fixedId(file.scope_department_id) }) });
  }
  for (const row of data.data_map_v7_mapping_versions || []) {
    const mapping = mappingById.get(fixedId(row.mapping_id)), source = sourceById.get(fixedId(mapping?.source_id));
    add('mapping_version', 'mapping_version:' + row.mapping_version_id,
      [versionNode('object', row.object_version_id), versionNode('field', row.field_version_id), row.parent_mapping_version_id == null ? null : 'mapping:' + fixedId(row.parent_mapping_version_id)],
      'mapping:' + fixedId(row.mapping_version_id), { ...row,
        ...(source?.scope_department_id == null ? {} : { scope_department_id: fixedId(source.scope_department_id) }),
        ...(source?.source_id == null ? {} : { source_id: fixedId(source.source_id) }),
        ...(source?.process_version_id == null ? {} : { process_version_id: fixedId(source.process_version_id) }) });
  }
  for (const row of data.data_map_design_handoff_refs || []) {
    const handoff = handoffByVersion.get(fixedId(row.handoff_version_id));
    add('design_handoff', 'design_handoff:' + row.handoff_version_id + ':' + row.mapping_version_id + ':' + row.side,
      ['mapping:' + fixedId(row.mapping_version_id)], 'handoff:' + fixedId(row.handoff_version_id), { ...row,
        ...(handoff?.handoff_id == null ? {} : { handoff_id: fixedId(handoff.handoff_id) }),
        ...(handoff?.claim_status == null ? {} : { claim_status: handoff.claim_status, snapshot_digest: handoff.snapshot_digest }) });
  }
  for (const row of data.data_map_analysis_inputs || []) {
    const run = runById.get(fixedId(row.run_id));
    add('analysis_input', 'analysis_input:' + row.run_id + ':' + row.input_key,
      [row.definition_version_id == null ? null : 'definition:' + fixedId(row.definition_version_id),
        row.mapping_version_id == null ? null : 'mapping:' + fixedId(row.mapping_version_id),
        row.handoff_version_id == null ? null : 'handoff:' + fixedId(row.handoff_version_id),
        row.batch_id == null ? null : 'batch:' + fixedId(row.batch_id)], null, { ...row,
        ...(run?.scope_department_id == null ? {} : { scope_department_id: fixedId(run.scope_department_id) }),
        ...(run?.status == null ? {} : { run_status: run.status, run_manifest_digest: run.manifest_digest }) });
  }
  // Fixed-point propagation handles parent/identifier cycles without recursion,
  // and retains every original requested version that reaches each reference.
  let changed = true;
  while (changed) {
    changed = false;
    for (const ref of references.values()) {
      const causes = new Set(ref.upstream.flatMap(node => [...(affected.get(node) || [])]));
      if (!causes.size) continue;
      if (!affected.has(ref.node)) affected.set(ref.node, new Set());
      for (const cause of causes) if (!affected.get(ref.node).has(cause)) { affected.get(ref.node).add(cause); changed = true; }
    }
  }
  const targetByKey = new Map(normalizedTargets.map(target => [targetKey(target), target]));
  const result = [...references.values()].filter(ref => ref.visible && ref.upstream.some(node => affected.get(node)?.size)).map(ref => ({ ...ref.record,
    upstream_reference_keys: ref.upstream, affected_targets: [...new Set(ref.upstream.flatMap(node => [...(affected.get(node) || [])]))].sort(compare).map(key => targetByKey.get(key)) }));
  for (const table of missing) result.push({ reference_key: 'schema_not_installed:' + table, reference_kind: 'schema_not_installed', status: 'not_installed', table_name: table });
  return result.map(stable).sort((a, b) => compare(a.reference_key, b.reference_key));
}

async function referencesToVersions(db, targets, options = {}) {
  if (!Array.isArray(targets)) throw failure('HANDOFF_IMPACT_TARGET_INVALID');
  const { data, missing } = await readInstalledGraph(db);
  return referenceClosure(data, targets, { ...options, missing });
}
module.exports = { referencesToVersions, referenceClosure, TABLES };
