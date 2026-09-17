// Persistence boundary. Enrolled P10 runs require the internal fenced transaction.
const { failure, id, parse, json, digest, lastId } = require('./dataMapDefinitionValues');
const { MIGRATION_KEY } = require('./analysisRunSchema');
const { columns } = require('./analysisInputReferences');
const code = (name, status = 400) => failure('DEFINITION_ANALYSIS_' + name, status);
const keys = (v, allowed) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !allowed.includes(k))) throw code('PROPERTY_INVALID'); };
const text = (v, max = 255) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw code('TEXT_INVALID'); return v.trim(); };
const key = v => { if (typeof v !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(v)) throw code('KEY_INVALID'); return v; };
const list = (v, max, min = 0) => { if (!Array.isArray(v) || v.length < min || v.length > max) throw code('LIST_INVALID'); return v; };
const unique = v => { if (new Set(v).size !== v.length) throw code('DUPLICATE_KEY'); return v; };
const sorted = rows => rows.slice().sort((a, b) => json(a).localeCompare(json(b)));
const terminal = s => ['succeeded', 'partial', 'failed', 'cancelled'].includes(s);
const times = names => names.map(n => `DATE_FORMAT(${n},'%Y-%m-%dT%H:%i:%s.%fZ') ${n}`).join(',');
const cast = names => names.map(n => `CAST(${n} AS CHAR) ${n}`).join(',');
const checkedSnapshot = row => { const s = parse(row.snapshot_json); if (digest(s) !== row.snapshot_digest) throw code('INTEGRITY_CONFLICT', 409); return s; };
function pointer(document, locator) {
  if (typeof locator !== 'string' || locator.length > 2048 || (locator !== '' && !locator.startsWith('/')) || /~(?![01])/u.test(locator)) throw code('POINTER_INVALID');
  let current = document;
  for (const segment of locator === '' ? [] : locator.slice(1).split('/')) {
    const part = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part) || (Array.isArray(current) && !/^(0|[1-9]\d*)$/.test(part))) throw code('POINTER_NOT_FOUND');
    current = current[part];
  }
  if (document === null) throw code('POINTER_NOT_FOUND');
}
module.exports = function (helpers) {
  const { transaction, actor, scope, request } = helpers;
  const resolve = require('./analysisInputReferences')(helpers);
  const tx = fn => transaction(async db => {
    if (!(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]))[0].length) throw code('MIGRATION_REQUIRED', 503);
    return fn(db);
  });
  async function input(db, who, item) {
    keys(item, ['input_key', 'kind', 'ref_id']);
    return { input_key: key(item.input_key), ...await resolve(db, who, item.kind, item.ref_id) };
  }
  async function load(db, who, runId) {
    const [[run]] = await db.execute(`SELECT *,${cast(['run_id', 'rerun_of_run_id', 'created_by_person_id', 'scope_department_id'])},${times(['created_at', 'started_at', 'finished_at'])} FROM data_map_analysis_runs WHERE run_id=? FOR UPDATE`, [id(runId)]);
    if (!run) throw code('RUN_NOT_FOUND', 404);
    scope(who, run.scope_department_id);
    const manifest = parse(run.manifest_json);
    if (digest(manifest) !== run.manifest_digest) throw code('INTEGRITY_CONFLICT', 409);
    const [rows] = await db.execute(`SELECT *,${cast(Object.values(columns))} FROM data_map_analysis_inputs WHERE run_id=? ORDER BY input_key FOR SHARE`, [run.run_id]);
    if (rows.length !== manifest.inputs.length) throw code('INTEGRITY_CONFLICT', 409);
    const inputs = new Map();
    for (const row of rows) {
      const snapshot = checkedSnapshot(row), expected = manifest.inputs.find(i => i.input_key === row.input_key);
      if (!expected || json(expected.snapshot) !== json(snapshot) || Object.entries(columns).some(([kind, column]) => row[column] !== (kind === snapshot.kind ? snapshot.ref_id : null))) throw code('INTEGRITY_CONFLICT', 409);
      const resolved = await resolve(db, who, snapshot.kind, snapshot.ref_id);
      if (json(resolved.snapshot) !== json(snapshot)) throw code('REFERENCE_CHANGED', 409);
      inputs.set(row.input_key, resolved);
    }
    const [steps] = await db.execute('SELECT step_key,status,attempt_no FROM data_map_analysis_steps WHERE run_id=? ORDER BY step_key FOR SHARE', [run.run_id]);
    if (json(steps.map(s => s.step_key).sort()) !== json(manifest.steps.map(s => s.step_key).sort())) throw code('INTEGRITY_CONFLICT', 409);
    delete run.manifest_json;
    return { run: { ...run, manifest, steps }, inputs };
  }
  function writableRevision(run, payload) {
    if (!Number.isSafeInteger(payload.expected_revision) || payload.expected_revision !== run.revision_no) throw code('REVISION_CONFLICT', 409);
    if (terminal(run.status)) throw code('RUN_TERMINAL', 409);
  }
  const advance = async (db, run) => {
    await db.execute('UPDATE data_map_analysis_runs SET revision_no=revision_no+1 WHERE run_id=?', [run.run_id]);
    return run.revision_no + 1;
  };
  async function queueGuard(db, runId, cancelling = false) {
    if (helpers.workerTransaction || cancelling) return;
    const [marker] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [require('./analysisQueueSchema').MIGRATION_KEY]);
    if (marker.length && (await db.execute('SELECT run_id FROM data_map_analysis_queue WHERE run_id=? FOR UPDATE', [runId]))[0].length) throw code('WORKER_TOKEN_REQUIRED', 409);
  }
  async function results(db, run) {
    const [attempts] = await db.execute(`SELECT *,${cast(['attempt_id', 'run_id', 'actor_person_id', 'completed_by_person_id'])},${times(['started_at', 'finished_at'])} FROM data_map_analysis_attempts WHERE run_id=? ORDER BY data_map_analysis_attempts.attempt_id FOR SHARE`, [run.run_id]);
    for (const a of attempts) {
      const [evidenceRows] = await db.execute(`SELECT *,${cast(['evidence_id', 'run_id', 'attempt_id'])} FROM data_map_analysis_evidence WHERE run_id=? AND attempt_id=? ORDER BY evidence_id FOR SHARE`, [run.run_id, a.attempt_id]);
      const [findingRows] = await db.execute(`SELECT *,${cast(['finding_id', 'run_id', 'attempt_id', 'issue_id'])} FROM data_map_analysis_findings WHERE run_id=? AND attempt_id=? ORDER BY finding_id FOR SHARE`, [run.run_id, a.attempt_id]);
      a.evidence = evidenceRows.map(r => {
        const s = checkedSnapshot(r);
        if (s.evidence_key !== r.evidence_key || s.input_key !== r.input_key) throw code('INTEGRITY_CONFLICT', 409);
        return { evidence_id: r.evidence_id, ...s };
      });
      a.findings = [];
      for (const r of findingRows) {
        const s = checkedSnapshot(r);
        if (s.comparison_key !== r.comparison_key || r.verification_status !== 'pending_verification' || r.issue_id !== null) throw code('INTEGRITY_CONFLICT', 409);
        const [subjects] = await db.execute('SELECT input_key FROM data_map_analysis_finding_inputs WHERE run_id=? AND attempt_id=? AND finding_id=? ORDER BY input_key FOR SHARE', [run.run_id, a.attempt_id, r.finding_id]);
        const [refs] = await db.execute('SELECT evidence_key FROM data_map_analysis_finding_evidence WHERE run_id=? AND attempt_id=? AND finding_id=? ORDER BY evidence_key FOR SHARE', [run.run_id, a.attempt_id, r.finding_id]);
        if (json(subjects.map(x => x.input_key)) !== json(s.subject_input_keys) || json(refs.map(x => x.evidence_key)) !== json(s.evidence_keys)) throw code('INTEGRITY_CONFLICT', 409);
        a.findings.push({ finding_id: r.finding_id, verification_status: r.verification_status, issue_id: null, ...s });
      }
      a.coverage = a.coverage_json === null ? null : parse(a.coverage_json);
      const outcome = { status: a.status, coverage: a.coverage, error_code: a.error_code, evidence: sorted(evidenceRows.map(checkedSnapshot)), findings: sorted(findingRows.map(checkedSnapshot)) };
      if (a.status === 'running' ? (a.result_digest !== null || evidenceRows.length || findingRows.length) : digest(outcome) !== a.result_digest) throw code('INTEGRITY_CONFLICT', 409);
      delete a.coverage_json;
    }
    for (const step of run.steps) {
      const history = attempts.filter(a => a.step_key === step.step_key), latest = history.at(-1);
      if (history.length !== step.attempt_no || (latest ? latest.attempt_no !== step.attempt_no || latest.status !== step.status : !['queued', 'cancelled'].includes(step.status))) throw code('INTEGRITY_CONFLICT', 409);
    }
    return attempts;
  }
  return {
    compareAnalysisRuns(session, beforeRunId, afterRunId) { return tx(async db => {
      const who = await actor(db, session), loaded = new Map();
      // Stable lock order prevents reverse comparisons from deadlocking.
      for (const runId of [...new Set([id(beforeRunId), id(afterRunId)])].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)) {
        const { run, inputs } = await load(db, who, runId);
        loaded.set(runId, { ...run, attempts: await results(db, run), documents: Object.fromEntries([...inputs].map(([key, value]) => [key, value.document])) });
      }
      return require('./analysisComparison').compareAnalysisSnapshots(loaded.get(id(beforeRunId)), loaded.get(id(afterRunId)));
    }); },
    createAnalysisRun(session, payload) { return tx(async db => {
      keys(payload, ['request_id', 'inputs', 'check_scope', 'parser_versions', 'rule_version', 'steps', 'ai_metadata', 'rerun_of_run_id']);
      if (Buffer.byteLength(json(payload)) > 262144) throw code('PAYLOAD_TOO_LARGE', 413);
      const who = await actor(db, session, 'governance:structure-gate');
      scope(who, who.departmentId);
      const inputs = [];
      for (const item of list(payload.inputs, 128, 1)) inputs.push(await input(db, who, item));
      unique(inputs.map(i => i.input_key));
      unique(inputs.map(i => i.snapshot.kind + ':' + i.snapshot.ref_id));
      keys(payload.check_scope, ['description', 'check_ids']);
      const checkScope = { description: text(payload.check_scope.description, 4096), check_ids: unique(list(payload.check_scope.check_ids, 128, 1).map(key)).sort() };
      if (!payload.parser_versions || Array.isArray(payload.parser_versions) || typeof payload.parser_versions !== 'object' || !Object.keys(payload.parser_versions).length || Object.keys(payload.parser_versions).length > 32) throw code('PARSER_VERSIONS_REQUIRED');
      const parsers = Object.fromEntries(Object.entries(payload.parser_versions).map(([k, v]) => [key(k), text(v, 128)]));
      const steps = list(payload.steps, 64, 1).map(s => {
        keys(s, ['step_key', 'input_keys', 'check_ids', 'parser_key']);
        const result = { step_key: key(s.step_key), input_keys: unique(list(s.input_keys, 128, 1).map(key)).sort(), check_ids: unique(list(s.check_ids, 128, 1).map(key)).sort(), parser_key: key(s.parser_key) };
        if (!Object.hasOwn(parsers, result.parser_key) || result.input_keys.some(k => !inputs.some(i => i.input_key === k)) || result.check_ids.some(k => !checkScope.check_ids.includes(k))) throw code('STEP_SCOPE_INVALID');
        return result;
      });
      unique(steps.map(s => s.step_key));
      if (json([...new Set(steps.flatMap(s => s.check_ids))].sort()) !== json(checkScope.check_ids) || inputs.some(i => !steps.some(s => s.input_keys.includes(i.input_key)))) throw code('STEP_SCOPE_INVALID');
      let ai = null;
      if (payload.ai_metadata != null) {
        keys(payload.ai_metadata, ['provider', 'model', 'model_version', 'prompt_version', 'prompt_sha256', 'adapter_version']);
        ai = Object.fromEntries(['provider', 'model', 'model_version', 'prompt_version', 'adapter_version'].map(k => [k, text(payload.ai_metadata[k], 128)]));
        if (!/^[a-f0-9]{64}$/.test(payload.ai_metadata.prompt_sha256)) throw code('AI_METADATA_INVALID');
        ai.prompt_sha256 = payload.ai_metadata.prompt_sha256;
      }
      const parentId = payload.rerun_of_run_id == null ? null : id(payload.rerun_of_run_id);
      if (parentId) { const parent = (await load(db, who, parentId)).run; if (!terminal(parent.status)) throw code('RERUN_REQUIRES_FINISHED_RUN', 409); }
      const manifest = { schema_version: 'analysis-input-v1', inputs: sorted(inputs.map(({ input_key, snapshot }) => ({ input_key, snapshot }))), check_scope: checkScope,
        parser_versions: parsers, rule_version: text(payload.rule_version, 128), steps: sorted(steps), ai_metadata: ai };
      return request(db, who, 'analysis_create', payload, async () => {
        await db.execute("INSERT INTO data_map_analysis_runs(rerun_of_run_id,manifest_json,manifest_digest,status,revision_no,created_by_person_id,scope_department_id,created_at) VALUES (?,?,?,'queued',1,?,?,UTC_TIMESTAMP(3))", [parentId, json(manifest), digest(manifest), who.personId, who.departmentId]);
        const runId = await lastId(db);
        for (const i of inputs) await db.execute(`INSERT INTO data_map_analysis_inputs(run_id,input_key,${Object.values(columns).join(',')},snapshot_json,snapshot_digest) VALUES (?,?,?,?,?,?,?,?,?)`, [runId, i.input_key, ...Object.keys(columns).map(k => k === i.snapshot.kind ? i.snapshot.ref_id : null), json(i.snapshot), digest(i.snapshot)]);
        for (const s of steps) await db.execute("INSERT INTO data_map_analysis_steps(run_id,step_key,status,attempt_no) VALUES (?,?,'queued',0)", [runId, s.step_key]);
        return { run_id: runId, revision_no: 1, status: 'queued', manifest_digest: digest(manifest) };
      });
    }); },
    getAnalysisRun(session, runId) { return tx(async db => {
      const { run } = await load(db, await actor(db, session), runId);
      const attempts = await results(db, run);
      const coverage = run.manifest.steps.map(s => {
        const latest = attempts.filter(a => a.step_key === s.step_key).at(-1);
        return { step_key: s.step_key, ...(latest?.coverage || { expected: s.check_ids, checked: [], missing: s.check_ids }) };
      });
      return { ...run, coverage, attempts };
    }); },
    beginAnalysisAttempt(session, payload) { return tx(async db => {
      keys(payload, ['request_id', 'run_id', 'expected_revision', 'step_key']);
      const who = await actor(db, session, 'governance:structure-gate'), { run } = await load(db, who, payload.run_id);
      await queueGuard(db, run.run_id);
      return request(db, who, 'analysis_begin', payload, async () => {
        writableRevision(run, payload);
        const s = run.steps.find(s => s.step_key === key(payload.step_key));
        if (!s || !['queued', 'failed', 'partial'].includes(s.status)) throw code('STEP_STATE_CONFLICT', 409);
        await db.execute("INSERT INTO data_map_analysis_attempts(run_id,step_key,attempt_no,status,actor_person_id,started_at) VALUES (?,?,?,'running',?,UTC_TIMESTAMP(3))", [run.run_id, s.step_key, s.attempt_no + 1, who.personId]);
        const attemptId = await lastId(db);
        await db.execute("UPDATE data_map_analysis_steps SET status='running',attempt_no=attempt_no+1 WHERE run_id=? AND step_key=?", [run.run_id, s.step_key]);
        await db.execute("UPDATE data_map_analysis_runs SET status='running',started_at=COALESCE(started_at,UTC_TIMESTAMP(3)) WHERE run_id=?", [run.run_id]);
        return { run_id: run.run_id, attempt_id: attemptId, attempt_no: s.attempt_no + 1, revision_no: await advance(db, run) };
      });
    }); },
    completeAnalysisAttempt(session, payload) { return tx(async db => {
      keys(payload, ['request_id', 'run_id', 'expected_revision', 'attempt_id', 'status', 'checked_ids', 'error_code', 'evidence', 'findings']);
      if (Buffer.byteLength(json(payload)) > 1048576) throw code('PAYLOAD_TOO_LARGE', 413);
      const who = await actor(db, session, 'governance:structure-gate'), { run, inputs } = await load(db, who, payload.run_id);
      await queueGuard(db, run.run_id);
      return request(db, who, 'analysis_complete', payload, async () => {
        writableRevision(run, payload);
        const [[attempt]] = await db.execute('SELECT step_key,attempt_no,status FROM data_map_analysis_attempts WHERE run_id=? AND attempt_id=? FOR UPDATE', [run.run_id, id(payload.attempt_id)]);
        if (!attempt || attempt.status !== 'running') throw code('ATTEMPT_STATE_CONFLICT', 409);
        const step = run.manifest.steps.find(s => s.step_key === attempt.step_key);
        const head = run.steps.find(s => s.step_key === attempt.step_key);
        if (head.attempt_no !== attempt.attempt_no || head.status !== 'running') throw code('ATTEMPT_STATE_CONFLICT', 409);
        if (!['succeeded', 'partial', 'failed', 'cancelled'].includes(payload.status)) throw code('STATUS_INVALID');
        const checked = unique(list(payload.checked_ids, 128).map(key)).sort();
        if (checked.some(k => !step.check_ids.includes(k))) throw code('COVERAGE_INVALID');
        const coverage = { expected: step.check_ids, checked, missing: step.check_ids.filter(k => !checked.includes(k)) };
        if ((payload.status === 'succeeded' && coverage.missing.length) || (payload.status === 'partial' && (!checked.length || !coverage.missing.length)) || (['failed', 'cancelled'].includes(payload.status) && checked.length)) throw code('COVERAGE_INVALID');
        const errorCode = payload.error_code == null ? null : text(payload.error_code, 64);
        if (errorCode !== null && !/^[A-Z][A-Z0-9_]*$/.test(errorCode) || (payload.status === 'succeeded' ? errorCode !== null : errorCode === null)) throw code('ERROR_CODE_INVALID');
        const evidence = list(payload.evidence, 256).map(e => {
          keys(e, ['evidence_key', 'input_key', 'locator_kind', 'locator', 'note']);
          const inputKey = key(e.input_key), source = inputs.get(inputKey);
          if (!source || !step.input_keys.includes(inputKey)) throw code('EVIDENCE_INPUT_INVALID');
          if (e.locator_kind === 'json_pointer') pointer(source.document, e.locator);
          else if (e.locator_kind !== 'document_anchor') throw code('LOCATOR_KIND_INVALID');
          return { evidence_key: key(e.evidence_key), input_key: inputKey, fixed_reference: source.snapshot, locator_kind: e.locator_kind,
            locator: e.locator_kind === 'json_pointer' ? e.locator : text(e.locator, 2048), locator_validation: e.locator_kind === 'json_pointer' ? 'resolved' : 'declared_anchor', note: text(e.note, 4096) };
        });
        unique(evidence.map(e => e.evidence_key));
        const findings = list(payload.findings, 256).map(f => {
          keys(f, ['rule_id', 'finding_type', 'message', 'subject_input_keys', 'semantic_locator', 'evidence_keys']);
          const subjects = unique(list(f.subject_input_keys, 32, 1).map(key)).sort(), evidenceKeys = unique(list(f.evidence_keys, 64).map(key)).sort();
          if (subjects.some(k => !inputs.has(k) || !step.input_keys.includes(k)) || evidenceKeys.some(k => !evidence.some(e => e.evidence_key === k))) throw code('FINDING_REFERENCE_INVALID');
          const ruleId = key(f.rule_id);
          if (!checked.includes(ruleId)) throw code('FINDING_RULE_NOT_COVERED');
          const semantic = text(f.semantic_locator, 512);
          if (/^\d+$/.test(semantic) || /\/(0|[1-9]\d*)(\/|$)/.test(semantic)) throw code('SEMANTIC_ID_REQUIRED');
          const identities = sorted(subjects.map(k => inputs.get(k).snapshot.identity));
          const comparisonAlgorithm = 'analysis-subject-v1';
          return { rule_id: ruleId, rule_version: run.manifest.rule_version, finding_type: key(f.finding_type), message: text(f.message, 8192),
            subject_input_keys: subjects, semantic_locator: semantic, evidence_keys: evidenceKeys, comparison_algorithm: comparisonAlgorithm,
            comparison_key: digest({ algorithm: comparisonAlgorithm, rule_id: ruleId, identities, semantic_locator: semantic }) };
        });
        unique(findings.map(f => f.comparison_key));
        if (['failed', 'cancelled'].includes(payload.status) && (evidence.length || findings.length)) throw code('FAILED_OUTPUT_INVALID');
        for (const e of evidence) await db.execute('INSERT INTO data_map_analysis_evidence(run_id,attempt_id,evidence_key,input_key,snapshot_json,snapshot_digest) VALUES (?,?,?,?,?,?)', [run.run_id, payload.attempt_id, e.evidence_key, e.input_key, json(e), digest(e)]);
        for (const f of findings) {
          await db.execute("INSERT INTO data_map_analysis_findings(run_id,attempt_id,comparison_key,verification_status,snapshot_json,snapshot_digest) VALUES (?,?,?,'pending_verification',?,?)", [run.run_id, payload.attempt_id, f.comparison_key, json(f), digest(f)]);
          const findingId = await lastId(db);
          for (const k of f.subject_input_keys) await db.execute('INSERT INTO data_map_analysis_finding_inputs(run_id,attempt_id,finding_id,input_key) VALUES (?,?,?,?)', [run.run_id, payload.attempt_id, findingId, k]);
          for (const k of f.evidence_keys) await db.execute('INSERT INTO data_map_analysis_finding_evidence(run_id,attempt_id,finding_id,evidence_key) VALUES (?,?,?,?)', [run.run_id, payload.attempt_id, findingId, k]);
        }
        const outcome = { status: payload.status, coverage, error_code: errorCode, evidence: sorted(evidence), findings: sorted(findings) };
        await db.execute('UPDATE data_map_analysis_attempts SET status=?,coverage_json=?,error_code=?,result_digest=?,completed_by_person_id=?,finished_at=UTC_TIMESTAMP(3) WHERE attempt_id=? AND run_id=?', [payload.status, json(coverage), errorCode, digest(outcome), who.personId, payload.attempt_id, run.run_id]);
        await db.execute('UPDATE data_map_analysis_steps SET status=? WHERE run_id=? AND step_key=?', [payload.status, run.run_id, step.step_key]);
        return { run_id: run.run_id, attempt_id: id(payload.attempt_id), status: payload.status, revision_no: await advance(db, run) };
      });
    }); },
    finishAnalysisRun(session, payload) { return tx(async db => {
      keys(payload, ['request_id', 'run_id', 'expected_revision', 'status']);
      const who = await actor(db, session, 'governance:structure-gate'), { run } = await load(db, who, payload.run_id);
      await queueGuard(db, run.run_id, payload.status === 'cancelled');
      return request(db, who, 'analysis_finish', payload, async () => {
        writableRevision(run, payload);
        await results(db, run);
        if (!terminal(payload.status)) throw code('STATUS_INVALID');
        if (payload.status === 'cancelled') {
          for (const s of run.steps.filter(s => s.status === 'running')) {
            const step = run.manifest.steps.find(x => x.step_key === s.step_key), coverage = { expected: step.check_ids, checked: [], missing: step.check_ids };
            const outcome = { status: 'cancelled', coverage, error_code: 'RUN_CANCELLED', evidence: [], findings: [] };
            await db.execute("UPDATE data_map_analysis_attempts SET status='cancelled',coverage_json=?,error_code='RUN_CANCELLED',result_digest=?,completed_by_person_id=?,finished_at=UTC_TIMESTAMP(3) WHERE run_id=? AND step_key=? AND attempt_no=? AND status='running'", [json(coverage), digest(outcome), who.personId, run.run_id, s.step_key, s.attempt_no]);
          }
          await db.execute("UPDATE data_map_analysis_steps SET status='cancelled' WHERE run_id=? AND status IN ('queued','running')", [run.run_id]);
        } else {
          if (run.steps.some(s => s.status === 'running')) throw code('ATTEMPT_STILL_RUNNING', 409);
          const expected = run.steps.every(s => s.status === 'succeeded') ? 'succeeded' : run.steps.some(s => ['succeeded', 'partial'].includes(s.status)) ? 'partial' : 'failed';
          if (payload.status !== expected) throw code('RUN_COVERAGE_CONFLICT', 409);
        }
        await db.execute('UPDATE data_map_analysis_runs SET status=?,finished_at=UTC_TIMESTAMP(3) WHERE run_id=?', [payload.status, run.run_id]);
        return { run_id: run.run_id, status: payload.status, revision_no: await advance(db, run) };
      });
    }); }
  };
};
