// Read existing fixed references; never copy a V7 document into analysis tables.
const { failure, id, parse, digest, json } = require('./dataMapDefinitionValues');
const columns = { v7_source: 'source_id', definition: 'definition_version_id', mapping: 'mapping_version_id', handoff: 'handoff_version_id', template: 'batch_id' };
const integrity = () => failure('DEFINITION_ANALYSIS_REFERENCE_CHANGED', 409);
module.exports = function ({ scope, entityScope, version, loadSource, target, unpack, mappingSelect }) {
  async function resolve(db, who, kind, refId) {
    refId = id(refId);
    if (!columns[kind]) throw failure('DEFINITION_ANALYSIS_INPUT_KIND_INVALID');
    let metadata, document;
    if (kind === 'v7_source') {
      const r = await loadSource(db, who, refId);
      if (r.stale) throw integrity();
      metadata = { source_kind: r.source_kind, source_ref: r.source_ref, content_digest: r.content_digest, digest_algorithm: r.digest_algorithm,
        raw_sha256: r.raw_sha256, raw_digest_algorithm: r.raw_digest_algorithm, original_name: r.original_name, byte_length: r.byte_length, validation_status: r.validation_status,
        identity: { kind: r.source_kind, id: r.source_kind === 'preview_revision' ? r.case_id : r.source_kind === 'published_version' ? r.document.process.process_ref : r.source_id } };
      document = r.document;
    } else if (kind === 'definition') {
      const r = await version(db, refId, true);
      scope(who, (await entityScope(db, r.entity_type, r.entity_id, true)).departmentId);
      metadata = { entity_type: r.entity_type, entity_id: r.entity_id, version_no: r.version_no, object_version_id: r.object_version_id,
        content_digest: r.content_digest, digest_algorithm: r.digest_algorithm, source_kind: r.source_kind, identity: { kind: r.entity_type, id: r.entity_id } };
      document = r.definition;
    } else if (kind === 'mapping') {
      const [[row]] = await db.execute(mappingSelect + ' WHERE v.mapping_version_id=? FOR SHARE', [refId]);
      if (!row) throw failure('DEFINITION_ANALYSIS_REFERENCE_NOT_FOUND', 404);
      const m = unpack(row), s = await resolve(db, who, 'v7_source', m.source_id);
      await target(db, who, m.object_version_id, m.field_version_id);
      if (m.source_digest !== s.snapshot.content_digest) throw integrity();
      metadata = { mapping_id: m.mapping_id, revision_no: m.revision_no, source_id: m.source_id, source_kind: s.snapshot.source_kind,
        source_ref: s.snapshot.source_ref, source_digest: m.source_digest, object_version_id: m.object_version_id, field_version_id: m.field_version_id,
        parent_mapping_version_id: m.parent_mapping_version_id, content_digest: m.snapshot_digest, digest_algorithm: 'sha256-canonical-json-v1',
        identity: { kind: 'mapping', id: m.mapping_id } };
      // The exact version snapshot, without read-time display fields.
      const [[raw]] = await db.execute('SELECT snapshot_json FROM data_map_v7_mapping_versions WHERE mapping_version_id=? FOR SHARE', [refId]);
      document = parse(raw.snapshot_json);
    } else if (kind === 'handoff') {
      const [[r]] = await db.execute('SELECT CAST(handoff_id AS CHAR) handoff_id,revision_no,claim_status,snapshot_json,snapshot_digest FROM data_map_design_handoff_versions WHERE handoff_version_id=? FOR SHARE', [refId]);
      if (!r) throw failure('DEFINITION_ANALYSIS_REFERENCE_NOT_FOUND', 404);
      document = parse(r.snapshot_json);
      if (digest(document) !== r.snapshot_digest || document.claim_status !== r.claim_status) throw integrity();
      const expected = [];
      for (const side of ['source', 'target']) {
        if (document[side]) expected.push({ side, mapping_version_id: document[side].mapping_version_id });
        for (const pair of document.pairs) if (pair[side + '_mapping_version_id']) expected.push({ side, mapping_version_id: pair[side + '_mapping_version_id'] });
      }
      const refs = [...new Map(expected.map(r => [json(r), r])).values()].sort((a, b) => json(a).localeCompare(json(b)));
      const [stored] = await db.execute('SELECT side,CAST(mapping_version_id AS CHAR) mapping_version_id FROM data_map_design_handoff_refs WHERE handoff_version_id=? FOR SHARE', [refId]);
      if (json(refs) !== json(stored.sort((a, b) => json(a).localeCompare(json(b))))) throw integrity();
      for (const r of refs) await resolve(db, who, 'mapping', r.mapping_version_id);
      metadata = { handoff_id: r.handoff_id, revision_no: r.revision_no, claim_status: r.claim_status, mapping_refs: refs,
        content_digest: r.snapshot_digest, digest_algorithm: 'sha256-canonical-json-v1', identity: { kind: 'handoff', id: r.handoff_id } };
    } else {
      const [[r]] = await db.execute('SELECT CAST(batch_id AS CHAR) batch_id,CAST(scope_department_id AS CHAR) scope_department_id,raw_sha256,raw_digest_status,parser_version,template_profile_version FROM data_map_source_files WHERE batch_id=? FOR SHARE', [refId]);
      if (!r) throw failure('DEFINITION_ANALYSIS_REFERENCE_NOT_FOUND', 404);
      scope(who, r.scope_department_id);
      const [cells] = await db.execute('SELECT sheet_name,cell_address,raw_type,CAST(raw_value_json AS CHAR) raw_value_json FROM data_map_source_cells WHERE batch_id=? ORDER BY sheet_name,cell_address FOR SHARE', [refId]);
      document = { cells: cells.map(c => ({ ...c, raw_value_json: parse(c.raw_value_json) })) };
      metadata = { source_kind: 'template_batch', batch_id: refId, raw_sha256: r.raw_sha256, raw_digest_status: r.raw_digest_status,
        raw_digest_algorithm: r.raw_sha256 ? 'sha256-raw-bytes' : null, parser_version: r.parser_version, template_profile_version: r.template_profile_version,
        content_digest: digest(document), digest_algorithm: 'sha256-template-cells-v1', identity: { kind: 'template_batch', id: refId } };
    }
    return { snapshot: { kind, ref_id: refId, ...metadata }, document };
  }
  return resolve;
};
module.exports.columns = columns;
