// P10 receives metadata only; P11 receives fenced fixed documents, with no DB/API handle.
const crypto = require('node:crypto');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stub(task, signal) {
  if (task.step.parser_key === 'stub_hang') {
    await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
    throw Object.assign(new Error('aborted'), { code: 'ABORTED' });
  }
  if (task.step.parser_key === 'stub_invalid') return { status: 'failed', checked_ids: [], error_code: 'INVALID_INPUT' };
  if (task.step.parser_key === 'stub_transient') return { status: 'failed', checked_ids: [], error_code: 'TEMPORARY_UNAVAILABLE' };
  if (task.step.parser_key === 'stub_partial') return { status: 'partial', checked_ids: task.step.check_ids.slice(0, 1), error_code: 'INPUT_INCOMPLETE' };
  if (task.step.parser_key !== 'stub_success') throw Object.assign(new Error('adapter unavailable'), { code: 'INVALID_INPUT' });
  return { status: 'succeeded', checked_ids: task.step.check_ids, error_code: null };
}
async function dispatch(task, signal) {
  if (!['v7_deterministic', 'handoff_deterministic', 'excel_evidence', 'word_evidence', 'pdf_evidence', 'ai_offline'].includes(task.step.parser_key)) return stub(task, signal);
  const { Worker } = require('node:worker_threads');
  const thread = new Worker(require.resolve(task.step.parser_key === 'ai_offline' ? './analysisAiThread' : './v7AnalysisThread'), { workerData: task, ...(task.step.parser_key === 'ai_offline' ? { env: {} } : {}), resourceLimits: { maxOldGenerationSizeMb: 128 } });
  let abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(Object.assign(new Error('aborted'), { code: 'ABORTED' }));
      signal.addEventListener('abort', abort, { once: true });
      thread.once('message', m => resolve(m.result || { status: 'failed', checked_ids: [], error_code: m.error, evidence: [], findings: [] }));
      thread.once('error', () => resolve({ status: 'failed', checked_ids: [], error_code: 'RULE_EXECUTION_FAILED', evidence: [], findings: [] }));
      thread.once('exit', () => resolve({ status: 'failed', checked_ids: [], error_code: 'RULE_EXECUTION_FAILED', evidence: [], findings: [] }));
      if (signal.aborted) abort();
    });
  } finally { signal.removeEventListener('abort', abort); await thread.terminate(); }
}
async function work(repo, worker, { stop, log = () => {}, adapter = dispatch, pollMs = 250 }) {
  let failures = 0;
  while (!await stop()) {
    let claim;
    try {
      claim = await repo.claimAnalysis(worker);
      if (!claim) { await sleep(pollMs); continue; }
      log({ event: 'claimed', run_id: claim.run_id, generation: claim.generation });
      while (!await stop()) {
        const task = await repo.nextAnalysisStep(claim);
        if (!task) break;
        log({ event: 'step_started', run_id: claim.run_id, attempt_no: task.attempt_no });
        const controller = new AbortController();
        let heartbeatError, busy = false;
        const timer = setInterval(async () => {
          if (busy) return;
          busy = true;
          try { if (await stop()) controller.abort(); else await repo.heartbeatAnalysis(claim); }
          catch (e) { heartbeatError = e; controller.abort(); }
          finally { busy = false; }
        }, Math.max(50, Math.floor(claim.policy.lease_ms / 3)));
        let result;
        try {
          // The abort race bounds even a non-cooperative asynchronous adapter.
          result = await Promise.race([adapter(task, controller.signal), new Promise((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ABORTED' })), { once: true });
          })]);
        } finally { clearInterval(timer); controller.abort(); while (busy) await sleep(5); }
        if (heartbeatError) throw heartbeatError;
        if (await stop()) break;
        await repo.completeQueuedAnalysis(claim, { request_id: crypto.randomUUID(), attempt_id: task.attempt_id, expected_revision: task.revision_no, evidence: [], findings: [], ...result });
        log({ event: 'step_completed', run_id: claim.run_id, status: result.status });
        if (result.status === 'failed' && result.error_code === 'TEMPORARY_UNAVAILABLE') { claim = null; break; }
      }
      if (claim && await stop()) await repo.abandonAnalysis(claim);
      failures = 0;
    } catch (e) {
      // Never log SQL, exception text, input, actor session or claim token.
      const expected = ['ABORTED', 'DEFINITION_ANALYSIS_QUEUE_LEASE_LOST', 'DEFINITION_ANALYSIS_QUEUE_RUN_TERMINAL'].includes(e.code);
      const safeCode = /^(DEFINITION_[A-Z_]+|ER_LOCK_DEADLOCK|ER_LOCK_WAIT_TIMEOUT|MYSQL_DEADLINE|ABORTED)$/.test(e.code || '') ? e.code : 'ANALYSIS_OPERATION_FAILED';
      log({ event: expected ? 'claim_ended' : 'worker_error', code: safeCode });
      if (claim && await stop()) { try { await repo.abandonAnalysis(claim); } catch {} }
      else if (claim && !expected && /^DEFINITION_/.test(e.code) && !['DEFINITION_CONFLICT', 'DEFINITION_SCHEMA_UNAVAILABLE'].includes(e.code)) {
        try { await repo.abandonAnalysis(claim, 'INVALID_INPUT'); } catch {}
      }
      if (!expected && ++failures >= 5) throw Object.assign(new Error('worker unavailable'), { code: 'ANALYSIS_WORKER_UNAVAILABLE' });
      await sleep(pollMs);
    }
  }
}
module.exports = { work, stub, dispatch };
