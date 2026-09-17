// Called only inside the P09 owned MySQL fixture with --p13. Synthetic results.
const assert = require('node:assert/strict');
const { digest } = require('../../server/dataMapDefinitionValues');
module.exports = async function ({ repo, lead, pool, run, historical, payload, begin, completion, finish, get, check, save }) {
  const checks = [], evidence = {};
  async function verify(name, fn) { await check('P13 ' + name, fn); checks.push(name); }
  async function execute(change = {}, mode = 'finding') {
    const r = await repo.createAnalysisRun(lead, { ...payload(), ...change });
    if (mode === 'failed') { await finish(r, 'failed'); return r; }
    let a = await begin(r);
    await repo.completeAnalysisAttempt(lead, await completion(r, a, mode === 'empty' ? { findings: [], evidence: [] } : {}));
    a = await begin(r, 'relation');
    await repo.completeAnalysisAttempt(lead, await completion(r, a, { checked_ids: ['conditions', 'identifiers'], evidence: [], findings: [] }));
    await finish(r, 'succeeded'); return r;
  }
  let same, empty;
  await verify('stored runs match with independent IDs and no writes', async () => {
    same = await execute();
    const original = await get(same);
    evidence.same = await repo.compareAnalysisRuns(lead, run.run_id, same.run_id);
    assert.equal(evidence.same.counts.persistent, 1);
    assert.notEqual(evidence.same.rows[0].before[0].finding_id, evidence.same.rows[0].after[0].finding_id);
    assert.deepEqual(await get(run), historical); assert.deepEqual(await get(same), original);
    assert.deepEqual(await repo.compareAnalysisRuns(lead, run.run_id, same.run_id), evidence.same);
  });
  await verify('complete absence and reverse added classification preserve old evidence', async () => {
    empty = await execute({}, 'empty');
    evidence.absence = await repo.compareAnalysisRuns(lead, run.run_id, empty.run_id);
    assert.equal(evidence.absence.counts.not_detected, 1); assert.equal(evidence.absence.implies_remediation, false);
    assert.equal((await repo.compareAnalysisRuns(lead, empty.run_id, run.run_id)).counts.added, 1);
    assert.deepEqual(await get(run), historical);
  });
  await verify('failed run cannot clear findings; unmapped rule change is incomparable', async () => {
    const failed = await execute({}, 'failed');
    evidence.failed = await repo.compareAnalysisRuns(lead, run.run_id, failed.run_id);
    assert.equal(evidence.failed.counts.incomparable, 1); assert.equal(evidence.failed.counts.not_detected, 0);
    const changed = await execute({ rule_version: 'synthetic-rules-v2' }, 'empty');
    assert.equal((await repo.compareAnalysisRuns(lead, run.run_id, changed.run_id)).comparability_reasons[0], 'RULE_SEMANTICS_UNMAPPED');
  });
  await verify('both input orders enforce department and current identity; admin remains read-only', async () => {
    const outsider = { personId: 86, accountId: 186, authVersion: 1 };
    for (const [a,b] of [[run,same],[same,run]]) await assert.rejects(repo.compareAnalysisRuns(outsider,a.run_id,b.run_id), e => e.code === 'DEFINITION_ACCESS_DENIED');
    await assert.rejects(repo.compareAnalysisRuns({ ...lead, authVersion: 999 }, run.run_id, same.run_id), e => e.code === 'DEFINITION_AUTH_REQUIRED');
    assert.deepEqual(await repo.compareAnalysisRuns({ personId: 81, accountId: 181, authVersion: 1 }, run.run_id, same.run_id), evidence.same);
    await assert.rejects(repo.compareAnalysisRuns(lead, run.run_id, '999999999'), e => e.code === 'DEFINITION_ANALYSIS_RUN_NOT_FOUND');
  });
  await verify('reverse concurrent reads use stable locks and return symmetric matching', async () => {
    const [a,b] = await Promise.all([repo.compareAnalysisRuns(lead,run.run_id,same.run_id),repo.compareAnalysisRuns(lead,same.run_id,run.run_id)]);
    assert.equal(a.counts.persistent,b.counts.persistent); assert.equal(a.rows[0].match_key,b.rows[0].match_key);
  });
  await verify('corrupted evidence fails closed and restoring it recovers identical history', async () => {
    const e = historical.attempts[0].evidence[0];
    const [[original]] = await pool.execute('SELECT snapshot_digest FROM data_map_analysis_evidence WHERE evidence_id=?',[e.evidence_id]);
    await pool.execute("UPDATE data_map_analysis_evidence SET snapshot_digest=REPEAT('0',64) WHERE evidence_id=?",[e.evidence_id]);
    try { await assert.rejects(repo.compareAnalysisRuns(lead,run.run_id,same.run_id),e=>e.code==='DEFINITION_ANALYSIS_INTEGRITY_CONFLICT'); }
    finally { await pool.execute('UPDATE data_map_analysis_evidence SET snapshot_digest=? WHERE evidence_id=?',[original.snapshot_digest,e.evidence_id]); }
    assert.deepEqual(await get(run),historical);
  });
  save('p13-comparisons.json',evidence);
  save('p13-results.json',{passed:true,checks,history_digest:digest(historical),formal_environment:false,model_called:false});
};
