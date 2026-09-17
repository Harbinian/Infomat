// HTTP projections over the existing fixed-source repositories. No new storage.
const { failure, id, json } = require('./dataMapDefinitionValues');
const pick = (value, fields) => Object.fromEntries(fields.filter(k => Object.hasOwn(value, k)).map(k => [k, value[k]]));
const SUMMARY_FIELDS = ['run_id', 'status', 'revision_no', 'created_at', 'started_at', 'finished_at'];
const SOURCE_FIELDS = ['kind', 'ref_id', 'source_kind', 'source_ref', 'content_digest', 'digest_algorithm', 'raw_sha256', 'raw_digest_algorithm', 'raw_digest_status', 'original_name', 'byte_length', 'entity_type', 'entity_id', 'version_no', 'revision_no', 'object_version_id', 'field_version_id', 'source_id', 'source_digest', 'mapping_id', 'handoff_id', 'batch_id', 'validation_status', 'parser_version', 'template_profile_version'];
const FINDING_FIELDS = ['finding_id', 'verification_status', 'issue_id', 'rule_id', 'rule_version', 'finding_type', 'message', 'subject_input_keys', 'semantic_locator', 'comparison_algorithm', 'comparison_key'];
const fail = (name, status = 400) => failure('DEFINITION_ANALYSIS_' + name, status);
const sourceView = s => pick(s, SOURCE_FIELDS);
function evidenceView(e) {
  return { ...pick(e, ['evidence_id', 'evidence_key', 'input_key', 'locator_kind', 'locator', 'locator_validation', 'note']), fixed_reference: sourceView(e.fixed_reference) };
}
function findingView(f, a) {
  return { ...pick(f, FINDING_FIELDS), attempt_id: a.attempt_id, step_key: a.step_key,
    evidence_ids: a.evidence.filter(e => f.evidence_keys.includes(e.evidence_key)).map(e => e.evidence_id) };
}
function runView(run) {
  return { ...pick(run, SUMMARY_FIELDS), rerun_of_run_id: run.rerun_of_run_id, manifest_digest: run.manifest_digest,
    manifest: { ...pick(run.manifest, ['schema_version', 'check_scope', 'parser_versions', 'rule_version', 'steps', 'ai_metadata']),
      inputs: run.manifest.inputs.map(i => ({ input_key: i.input_key, snapshot: sourceView(i.snapshot) })) },
    coverage: run.coverage, attempts: run.attempts.map(a => pick(a, ['attempt_id', 'step_key', 'attempt_no', 'status', 'coverage', 'error_code', 'started_at', 'finished_at'])) };
}
function page(query = {}) {
  if (Object.keys(query).some(k => !['offset', 'limit', 'kind'].includes(k))) throw fail('QUERY_INVALID');
  const number = (s, fallback, max) => {
    if (s === undefined) return fallback;
    if (!/^(0|[1-9]\d*)$/.test(String(s)) || Number(s) > max) throw fail('QUERY_INVALID');
    return Number(s);
  };
  const offset = number(query.offset, 0, 10000), limit = number(query.limit, 50, 100);
  if (!limit) throw fail('QUERY_INVALID');
  return { offset, limit };
}
const pageResult = (items, offset, limit) => ({ items: items.slice(offset, offset + limit), next_offset: items.length > offset + limit ? offset + limit : null, visibility: 'existing_source_scope' });
module.exports = function (helpers) {
  const { transaction, actor, scope } = helpers;
  const resolve = require('./analysisInputReferences')(helpers);
  const api = db => require('./analysisRuns')({ ...helpers, transaction: fn => fn(db) });
  const queue = db => require('./analysisQueue')({ ...helpers, transaction: fn => fn(db) });
  async function reader(db, session) { const who = await actor(db, session); scope(who, who.departmentId); return who; }
  // Offsets count only visible entries. No cursor, total or skipped count leaks hidden rows.
  async function visiblePage(db, table, column, query, resolveItem) {
    const { offset, limit } = page(query), items = [];
    let after = '0';
    while (items.length <= offset + limit) {
      const [rows] = await db.execute(`SELECT CAST(${column} AS CHAR) id FROM ${table} WHERE ${column}>? ORDER BY ${column} LIMIT 100`, [after]);
      if (!rows.length) break;
      for (const row of rows) {
        after = row.id;
        try { items.push(await resolveItem(row.id)); }
        catch (e) { if (e.statusCode !== 403) throw e; }
        if (items.length > offset + limit) break;
      }
      if (rows.length < 100) break;
    }
    return pageResult(items, offset, limit);
  }
  const sourceTables = { v7_source: ['data_map_v7_sources', 'source_id'], definition: ['data_map_definition_versions', 'version_id'],
    mapping: ['data_map_v7_mapping_versions', 'mapping_version_id'], handoff: ['data_map_design_handoff_versions', 'handoff_version_id'], template: ['data_map_source_files', 'batch_id'] };
  return {
    analysisCapabilities(session) { return transaction(async db => {
      const who = await reader(db, session);
      return { can_create: !who.readOnly && who.permissions.has('governance:structure-gate'), visibility: 'existing_source_scope',
        public_summary_enabled: false, summary_fields: SUMMARY_FIELDS, material_kinds: ['v7_json'], source_kinds: Object.keys(sourceTables), export_formats: ['json'],
        adapters: [['v7_source', require('./v7AnalysisRules')], ['handoff', require('./handoffAnalysisRules')]].map(([kind, rules]) => ({
          kind, parser_key: rules.PARSER, rule_version: rules.VERSION, check_ids: rules.CHECKS,
          catalog: rules.catalog.map(r => pick(r, ['rule_id', 'title', 'enabled', 'prerequisite', 'not_applicable']))
        })) };
    }); },
    listAnalysisSources(session, query = {}) { return transaction(async db => {
      const who = await reader(db, session), kind = query.kind || 'v7_source';
      if (!Object.hasOwn(sourceTables, kind)) throw fail('INPUT_KIND_INVALID');
      return visiblePage(db, ...sourceTables[kind], query, async ref => sourceView((await resolve(db, who, kind, ref)).snapshot));
    }); },
    getAnalysisSource(session, kind, ref) { return transaction(async db => {
      const who = await reader(db, session);
      if (!Object.hasOwn(sourceTables, kind)) throw fail('INPUT_KIND_INVALID');
      return sourceView((await resolve(db, who, kind, ref)).snapshot);
    }); },
    listAnalysisRuns(session, query = {}) { return transaction(async db => {
      await reader(db, session);
      return visiblePage(db, 'data_map_analysis_runs', 'run_id', query, async ref => pick(await api(db).getAnalysisRun(session, ref), SUMMARY_FIELDS));
    }); },
    createQueuedAnalysis(session, payload) { return transaction(async db => {
      // Creation and queue admission share one transaction; invalid adapters leave no orphan run.
      const run = await api(db).createAnalysisRun(session, payload);
      const detail = await api(db).getAnalysisRun(session, run.run_id);
      if (!require('./v7AnalysisRules').enabledManifest(detail.manifest) && !require('./handoffAnalysisRules').enabledManifest(detail.manifest)) throw fail('ADAPTER_NOT_ENABLED');
      await queue(db).enqueueAnalysis(session, { request_id: payload.request_id, run_id: run.run_id });
      return run;
    }); },
    cancelAnalysis(session, payload) { return transaction(async db => {
      if (Object.keys(payload).some(k => !['run_id', 'request_id', 'expected_revision'].includes(k))) throw fail('PROPERTY_INVALID');
      // Preserve cancellation for P09 runs that were never enrolled in the P10 queue.
      await api(db).getAnalysisRun(session, payload.run_id);
      const [marker] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [require('./analysisQueueSchema').MIGRATION_KEY]);
      const enrolled = marker.length && (await db.execute('SELECT run_id FROM data_map_analysis_queue WHERE run_id=?', [id(payload.run_id)]))[0].length;
      return enrolled ? queue(db).cancelQueuedAnalysis(session, payload) : api(db).finishAnalysisRun(session, { ...payload, status: 'cancelled' });
    }); },
    readAnalysis(session, runId, layer = 'detail', options = {}) { return transaction(async db => {
      const run = await api(db).getAnalysisRun(session, runId);
      if (layer === 'summary') return pick(run, SUMMARY_FIELDS);
      if (layer === 'detail') return runView(run);
      const findings = run.attempts.flatMap(a => a.findings.map(f => findingView(f, a)));
      if (layer === 'findings') { const { offset, limit } = page(options); return pageResult(findings, offset, limit); }
      if (layer === 'finding') {
        const found = findings.find(f => f.finding_id === id(options.id));
        if (!found) throw fail('FINDING_NOT_FOUND', 404);
        return found;
      }
      if (layer === 'evidence') {
        const e = run.attempts.flatMap(a => a.evidence).find(e => e.evidence_id === id(options.id));
        if (!e) throw fail('EVIDENCE_NOT_FOUND', 404);
        const fixed = run.manifest.inputs.find(i => i.input_key === e.input_key)?.snapshot;
        if (!fixed || json(fixed) !== json(e.fixed_reference)) throw fail('INTEGRITY_CONFLICT', 409);
        const source = await resolve(db, await reader(db, session), fixed.kind, fixed.ref_id);
        let excerpt = null;
        if (e.locator_kind === 'json_pointer') {
          excerpt = source.document;
          for (const part of e.locator === '' ? [] : e.locator.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))) {
            if (!excerpt || typeof excerpt !== 'object' || !Object.hasOwn(excerpt, part)) throw fail('INTEGRITY_CONFLICT', 409);
            excerpt = excerpt[part];
          }
        }
        return { ...evidenceView(e), excerpt, extraction_status: e.locator_kind === 'json_pointer' ? 'resolved' : 'declared_anchor_only' };
      }
      if (layer === 'export') return { format_version: 'analysis-export-v1', visibility: 'existing_source_scope', ...runView(run), findings,
        evidence: run.attempts.flatMap(a => a.evidence.map(evidenceView)), changes_governance: false };
      throw fail('PROJECTION_INVALID');
    }); }
  };
};
