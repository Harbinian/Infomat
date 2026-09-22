// Only scheduling and analysis persistence. No formal decisions, issue or task APIs.
const crypto = require('node:crypto');
const { id, json, parse, digest, failure } = require('./dataMapDefinitionValues');
const { MIGRATION_KEY } = require('./analysisQueueSchema');
const code = (s, status = 409) => failure('DEFINITION_ANALYSIS_QUEUE_' + s, status);
const terminal = s => ['succeeded', 'partial', 'failed', 'cancelled'].includes(s);
const uuid = () => crypto.randomUUID();
const workerId = s => { if (!/^[a-f0-9-]{36}$/.test(s || '')) throw code('WORKER_ID_INVALID', 400); return s; };
const tokenHash = token => { if (!/^[a-f0-9]{64}$/.test(token || '')) throw code('TOKEN_INVALID'); return digest(token); };
const defaults = { max_attempts: 3, lease_ms: 15000, timeout_ms: 120000, retry_ms: 1000 };
function policy(value = {}) {
  const p = { ...defaults, ...value };
  if (Object.keys(p).some(k => !Object.hasOwn(defaults, k)) || Object.values(p).some(v => !Number.isSafeInteger(v)) ||
    p.max_attempts < 1 || p.max_attempts > 5 || p.lease_ms < 300 || p.lease_ms > 60000 ||
    p.timeout_ms < p.lease_ms || p.timeout_ms > 600000 || p.retry_ms < 0 || p.retry_ms > 60000) throw code('POLICY_INVALID', 400);
  return p;
}
module.exports = function (helpers) {
  const tx = fn => helpers.transaction(async db => {
    if (!(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]))[0].length) throw code('MIGRATION_REQUIRED', 503);
    return fn(db);
  });
  // This factory is private: transaction and fencing cannot be selected by callers.
  const api = db => require('./analysisRuns')({ ...helpers, transaction: fn => fn(db), workerTransaction: true });
  const event = (db, q, type, error = null) => db.execute('INSERT INTO data_map_analysis_queue_events(run_id,generation,worker_id,event_type,error_code,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))', [q.run_id, q.generation, q.worker_id, type, error]);
  async function row(db, runId) {
    const [[q]] = await db.execute(`SELECT *,CAST(run_id AS CHAR) run_id,
      (lease_until>UTC_TIMESTAMP(3) AND deadline_at>UTC_TIMESTAMP(3)) live,
      available_at<=UTC_TIMESTAMP(3) available,
      deadline_at<=UTC_TIMESTAMP(3) timed_out FROM data_map_analysis_queue WHERE run_id=? FOR UPDATE`, [id(runId)]);
    if (!q) throw code('NOT_FOUND', 404);
    q.session = parse(q.session_json); q.policy = policy(parse(q.policy_json));
    return q;
  }
  async function fenced(db, claim) {
    // Match P09's identity -> run -> queue lock order, including read-only polling.
    const [[identity]] = await db.execute('SELECT session_json FROM data_map_analysis_queue WHERE run_id=?', [id(claim.run_id)]);
    if (!identity) throw code('NOT_FOUND', 404);
    await helpers.actor(db, parse(identity.session_json), 'governance:structure-gate');
    const [[run]] = await db.execute('SELECT status FROM data_map_analysis_runs WHERE run_id=? FOR UPDATE', [id(claim.run_id)]);
    const q = await row(db, claim.run_id);
    if (q.state !== 'leased' || !q.live || q.token_hash !== tokenHash(claim.token) || q.worker_id !== workerId(claim.worker_id)) throw code('LEASE_LOST');
    if (terminal(run.status)) throw code('RUN_TERMINAL');
    return q;
  }
  async function release(db, q, state, error = null, delay = 0) {
    await db.execute('UPDATE data_map_analysis_queue SET state=?,token_hash=NULL,lease_until=NULL,deadline_at=NULL,available_at=TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)),error_code=?,updated_at=UTC_TIMESTAMP(3) WHERE run_id=?', [state, delay * 1000, error, q.run_id]);
    await event(db, q, state, error);
  }
  // Recovery records an automated attempt failure on behalf of the original actor;
  // event metadata distinguishes it from a human decision. Never changes findings.
  async function failRunning(db, q, reason) {
    const [[r]] = await db.execute('SELECT manifest_json,manifest_digest FROM data_map_analysis_runs WHERE run_id=? FOR UPDATE', [q.run_id]);
    const manifest = parse(r.manifest_json);
    if (digest(manifest) !== r.manifest_digest) throw code('MANIFEST_DAMAGED');
    const [active] = await db.execute('SELECT CAST(attempt_id AS CHAR) attempt_id,step_key FROM data_map_analysis_attempts WHERE run_id=? AND status=\'running\' FOR UPDATE', [q.run_id]);
    for (const a of active) {
      const expected = manifest.steps.find(s => s.step_key === a.step_key).check_ids;
      const coverage = { expected, checked: [], missing: expected };
      const outcome = { status: 'failed', coverage, error_code: reason, evidence: [], findings: [] };
      await db.execute("UPDATE data_map_analysis_attempts SET status='failed',coverage_json=?,error_code=?,result_digest=?,completed_by_person_id=?,finished_at=UTC_TIMESTAMP(3) WHERE attempt_id=?", [json(coverage), reason, digest(outcome), q.session.personId, a.attempt_id]);
      await db.execute("UPDATE data_map_analysis_steps SET status='failed' WHERE run_id=? AND step_key=?", [q.run_id, a.step_key]);
    }
    if (active.length) await db.execute('UPDATE data_map_analysis_runs SET revision_no=revision_no+1 WHERE run_id=?', [q.run_id]);
    await event(db, q, 'interrupted', reason);
  }
  async function endFailed(db, q, reason) {
    await failRunning(db, q, reason);
    const [steps] = await db.execute('SELECT status FROM data_map_analysis_steps WHERE run_id=? FOR UPDATE', [q.run_id]);
    const status = steps.some(s => ['succeeded', 'partial'].includes(s.status)) ? 'partial' : 'failed';
    await db.execute('UPDATE data_map_analysis_runs SET status=?,revision_no=revision_no+1,finished_at=UTC_TIMESTAMP(3) WHERE run_id=?', [status, q.run_id]);
    await release(db, q, 'failed', reason);
  }
  async function recover(db, q) {
    const [[r]] = await db.execute('SELECT status FROM data_map_analysis_runs WHERE run_id=? FOR UPDATE', [q.run_id]);
    if (terminal(r.status)) { await release(db, q, r.status === 'cancelled' ? 'cancelled' : 'done'); return; }
    if (q.state !== 'leased' || q.live) return;
    await failRunning(db, q, q.timed_out ? 'STEP_TIMEOUT' : 'LEASE_EXPIRED');
    await release(db, q, 'ready', q.timed_out ? 'STEP_TIMEOUT' : 'LEASE_EXPIRED', q.policy.retry_ms);
  }
  return {
    enqueueAnalysis(session, payload) { return tx(async db => {
      if (Object.keys(payload).some(k => !['request_id', 'run_id', 'policy'].includes(k))) throw code('PROPERTY_INVALID', 400);
      const who = await helpers.actor(db, session, 'governance:structure-gate');
      const run = await api(db).getAnalysisRun(session, payload.run_id), p = policy(payload.policy);
      return helpers.request(db, who, 'analysis_enqueue', payload, async () => {
        const [existing] = await db.execute('SELECT run_id FROM data_map_analysis_queue WHERE run_id=? FOR UPDATE', [run.run_id]);
        if (existing.length) throw code('ALREADY_ENQUEUED');
        if (run.status !== 'queued' || run.attempts.length) throw code('PRISTINE_RUN_REQUIRED');
        if (run.manifest.ai_metadata?.adapter_version === require('./analysisAiOffline').VERSION &&
          !(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [require('./analysisAiSchema').MIGRATION_KEY]))[0].length) throw code('AI_MIGRATION_REQUIRED', 503);
        const stub = run.manifest.rule_version === 'p10-stub-v1' && !run.manifest.ai_metadata && Object.values(run.manifest.parser_versions).every(v => v === 'p10-stub-v1') &&
          run.manifest.steps.every(s => ['stub_success', 'stub_transient', 'stub_invalid', 'stub_hang', 'stub_partial'].includes(s.parser_key));
        if (!stub && !require('./v7AnalysisRules').enabledManifest(run.manifest) && !require('./handoffAnalysisRules').enabledManifest(run.manifest) && !require('./excelEvidenceRules').enabledManifest(run.manifest) && !require('./wordEvidenceRules').enabledManifest(run.manifest) && !require('./pdfEvidenceRules').enabledManifest(run.manifest) && !require('./analysisAiOffline').enabledManifest(run.manifest)) throw code('ADAPTER_NOT_ENABLED', 400);
        const savedSession = { personId: id(session.personId), accountId: id(session.accountId), authVersion: id(session.authVersion) };
        await db.execute("INSERT INTO data_map_analysis_queue(run_id,session_json,policy_json,state,available_at,created_at,updated_at) VALUES (?,?,?,'ready',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [run.run_id, json(savedSession), json(p)]);
        await event(db, { run_id: run.run_id, generation: 0, worker_id: null }, 'enqueued');
        return { run_id: run.run_id, state: 'ready', policy: p };
      });
    }); },
    claimAnalysis(worker) { return tx(async db => {
      workerId(worker);
      const [[next]] = await db.execute(`SELECT CAST(run_id AS CHAR) run_id FROM data_map_analysis_queue
        WHERE (state='ready' AND available_at<=UTC_TIMESTAMP(3)) OR (state='leased' AND (lease_until<=UTC_TIMESTAMP(3) OR deadline_at<=UTC_TIMESTAMP(3)))
        ORDER BY available_at,run_id LIMIT 1`);
      if (!next) return null;
      const [[identity]] = await db.execute('SELECT session_json FROM data_map_analysis_queue WHERE run_id=?', [next.run_id]);
      let authError;
      try { await helpers.actor(db, parse(identity.session_json), 'governance:structure-gate'); }
      catch (e) { if (!/^DEFINITION_/.test(e.code)) throw e; authError = e; }
      const [[r]] = await db.execute('SELECT status FROM data_map_analysis_runs WHERE run_id=? FOR UPDATE SKIP LOCKED', [next.run_id]);
      if (!r) return null;
      const q = await row(db, next.run_id);
      // Another process may have claimed or cancelled between selection and locking.
      if (q.state !== 'ready' && !(q.state === 'leased' && !q.live)) return null;
      if (q.state === 'ready' && !q.available) return null;
      if (q.state === 'leased') { await recover(db, q); return null; }
      if (terminal(r.status)) { await recover(db, q); return null; }
      try { if (authError) throw authError; await api(db).getAnalysisRun(q.session, q.run_id); }
      catch (e) {
        if (/^DEFINITION_/.test(e.code)) { await endFailed(db, q, 'INPUT_OR_AUTH_INVALID'); return null; }
        throw e;
      }
      const token = crypto.randomBytes(32).toString('hex');
      await db.execute("UPDATE data_map_analysis_queue SET state='leased',generation=generation+1,token_hash=?,worker_id=?,lease_until=TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)),deadline_at=TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)),updated_at=UTC_TIMESTAMP(3) WHERE run_id=?", [tokenHash(token), worker, q.policy.lease_ms * 1000, q.policy.timeout_ms * 1000, q.run_id]);
      await event(db, { ...q, worker_id: worker, generation: q.generation + 1 }, 'claimed');
      return { run_id: q.run_id, worker_id: worker, token, policy: q.policy, generation: q.generation + 1 };
    }); },
    heartbeatAnalysis(claim) { return tx(async db => {
      const q = await fenced(db, claim);
      await db.execute('UPDATE data_map_analysis_queue SET lease_until=LEAST(deadline_at,TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3))),updated_at=UTC_TIMESTAMP(3) WHERE run_id=?', [q.policy.lease_ms * 1000, q.run_id]);
      return { live: true };
    }); },
    nextAnalysisStep(claim) { return tx(async db => {
      const q = await fenced(db, claim), a = api(db);
      let run;
      try { await helpers.actor(db, q.session, 'governance:structure-gate'); run = await a.getAnalysisRun(q.session, q.run_id); }
      catch (e) { if (!/^DEFINITION_/.test(e.code)) throw e; await endFailed(db, q, 'INPUT_OR_AUTH_INVALID'); return null; }
      const s = run.manifest.steps.find(step => {
        const state = run.steps.find(x => x.step_key === step.step_key);
        const last = run.attempts.filter(x => x.step_key === step.step_key).at(-1);
        return state.status === 'queued' || (state.status === 'failed' && state.attempt_no < q.policy.max_attempts && ['TEMPORARY_UNAVAILABLE', 'STEP_TIMEOUT', 'LEASE_EXPIRED', 'WORKER_STOPPED'].includes(last?.error_code));
      });
      if (!s) {
        if (run.steps.some(s => s.status === 'running')) throw code('STEP_ALREADY_RUNNING');
        const status = run.steps.every(s => s.status === 'succeeded') ? 'succeeded' : run.steps.some(s => ['succeeded', 'partial'].includes(s.status)) ? 'partial' : 'failed';
        await a.finishAnalysisRun(q.session, { request_id: uuid(), run_id: q.run_id, expected_revision: run.revision_no, status });
        await release(db, q, 'done'); return null;
      }
      if (run.steps.some(s => s.status === 'running')) throw code('STEP_ALREADY_RUNNING');
      const attempt = await a.beginAnalysisAttempt(q.session, { request_id: uuid(), run_id: q.run_id, expected_revision: run.revision_no, step_key: s.step_key });
      await db.execute('UPDATE data_map_analysis_queue SET deadline_at=TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)) WHERE run_id=?', [q.policy.timeout_ms * 1000, q.run_id]);
      let inputs;
      if ([require('./v7AnalysisRules').PARSER, require('./handoffAnalysisRules').PARSER, require('./excelEvidenceRules').PARSER, require('./wordEvidenceRules').PARSER, require('./pdfEvidenceRules').PARSER, require('./analysisAiOffline').PARSER].includes(s.parser_key)) {
        if (!require('./v7AnalysisRules').enabledManifest(run.manifest) && !require('./handoffAnalysisRules').enabledManifest(run.manifest) && !require('./excelEvidenceRules').enabledManifest(run.manifest) && !require('./wordEvidenceRules').enabledManifest(run.manifest) && !require('./pdfEvidenceRules').enabledManifest(run.manifest) && !require('./analysisAiOffline').enabledManifest(run.manifest)) throw code('ADAPTER_NOT_ENABLED', 400);
        const who = await helpers.actor(db, q.session, 'governance:structure-gate');
        const resolve = require('./analysisInputReferences')(helpers);
        inputs = [];
        for (const key of s.input_keys) {
          const ref = run.manifest.inputs.find(i => i.input_key === key).snapshot;
          const resolved = await resolve(db, who, ref.kind, ref.ref_id);
          if (json(resolved.snapshot) !== json(ref)) throw code('INPUT_CHANGED');
          inputs.push({ input_key: key, ...resolved });
        }
      }
      return { ...attempt, step: s, manifest_digest: run.manifest_digest, ai_metadata: run.manifest.ai_metadata, ...(inputs ? { inputs } : {}) };
    }); },
    completeQueuedAnalysis(claim, result) { return tx(async db => {
      const q = await fenced(db, claim), a = api(db);
      const run = await a.getAnalysisRun(q.session, q.run_id);
      const { ai_trace, ...ordinary } = result;
      const ai = require('./analysisAiOffline');
      const attempt = run.attempts.find(a => a.attempt_id === String(result.attempt_id));
      const step = run.manifest.steps.find(s => s.step_key === attempt?.step_key);
      if (step?.parser_key === ai.PARSER) {
        const who = await helpers.actor(db, q.session, 'governance:structure-gate'), resolve = require('./analysisInputReferences')(helpers), inputs = [];
        for (const input_key of step.input_keys) {
          const ref = run.manifest.inputs.find(i => i.input_key === input_key).snapshot;
          inputs.push({ input_key, ...await resolve(db, who, ref.kind, ref.ref_id) });
        }
        try { ai.verifyTrace({ step, inputs, ai_metadata: run.manifest.ai_metadata }, ai_trace, result); }
        catch { throw code('AI_TRACE_INVALID', 400); }
        const trace = { run_id: run.run_id, attempt_id: String(result.attempt_id), manifest_digest: run.manifest_digest, ...ai_trace };
        const [[prior]] = await db.execute('SELECT snapshot_digest FROM data_map_analysis_ai_outputs WHERE attempt_id=? FOR UPDATE', [result.attempt_id]);
        if (prior && prior.snapshot_digest !== digest(trace)) throw code('AI_TRACE_CONFLICT');
        if (!prior) await db.execute('INSERT INTO data_map_analysis_ai_outputs(attempt_id,run_id,snapshot_json,snapshot_digest,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))', [result.attempt_id, run.run_id, json(trace), digest(trace)]);
      } else if (ai_trace) throw code('AI_TRACE_INVALID', 400);
      const completed = await a.completeAnalysisAttempt(q.session, { ...ordinary, run_id: q.run_id });
      if (completed.revision_no <= run.revision_no) return completed;
      await event(db, q, 'step_completed', result.error_code);
      if (result.status === 'failed' && result.error_code === 'TEMPORARY_UNAVAILABLE') await release(db, q, 'ready', result.error_code, q.policy.retry_ms);
      return completed;
    }); },
    abandonAnalysis(claim, reason = 'WORKER_STOPPED') { return tx(async db => {
      if (!['WORKER_STOPPED', 'INVALID_INPUT'].includes(reason)) throw code('ERROR_INVALID', 400);
      const q = await fenced(db, claim);
      if (reason === 'INVALID_INPUT') await endFailed(db, q, reason);
      else { await failRunning(db, q, reason); await release(db, q, 'ready', reason, q.policy.retry_ms); }
      return { released: true };
    }); },
    cancelQueuedAnalysis(session, payload) { return tx(async db => {
      const who = await helpers.actor(db, session, 'governance:structure-gate');
      const run = await api(db).getAnalysisRun(session, payload.run_id);
      return helpers.request(db, who, 'analysis_cancel_queue', payload, async () => {
        const q = await row(db, run.run_id);
        const result = await api(db).finishAnalysisRun(session, { ...payload, status: 'cancelled' });
        await release(db, q, 'cancelled', 'RUN_CANCELLED'); return result;
      });
    }); },
    recoverAnalysisQueue() { return tx(async db => {
      const [rows] = await db.execute("SELECT CAST(run_id AS CHAR) run_id FROM data_map_analysis_queue WHERE state='leased' AND (lease_until<=UTC_TIMESTAMP(3) OR deadline_at<=UTC_TIMESTAMP(3)) ORDER BY run_id LIMIT 100");
      let recovered = 0;
      for (const r of rows) {
        if (!(await db.execute('SELECT run_id FROM data_map_analysis_runs WHERE run_id=? FOR UPDATE SKIP LOCKED', [r.run_id]))[0].length) continue;
        const q = await row(db, r.run_id);
        if (q.state === 'leased' && !q.live) { await recover(db, q); recovered++; }
      }
      return { recovered };
    }); }
  };
};
module.exports.policy = policy;
