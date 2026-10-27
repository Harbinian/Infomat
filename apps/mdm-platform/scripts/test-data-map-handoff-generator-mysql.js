// Explicit generator verification in one fresh stage64 MySQL with canonical DDL.
// No real service, private environment, AI, 3001 or formal target is contacted.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { seed } = require('./testHelpers/dataMapHandoffFixture');
const { createGenerator } = require('../server/dataMapHandoffGenerator');
const { createDataMapHandoffRepository } = require('../server/dataMapHandoffRepository');
const { makeProcessDataGovernanceRepository } = require('../server/processDataGovernanceRepository');
const { evaluate } = require('../server/dataMapHandoffGates');
const output = path.resolve(process.argv[2] || path.join(__dirname, '../../../artifacts/mdm-data-governance-handoff-implementation-20261020-01/generator-' + crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep)); assert(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const checks = []; let owned, passed = false, failure;
async function check(name, work) { await work(); checks.push(name); console.log('PASS ' + name); }
async function main() {
  try {
    await check('default off and global readonly perform zero database connections', async () => {
      let calls = 0; const noDatabase = { getConnection() { calls++; throw Error('Database must remain untouched'); } };
      for (const env of [{}, { DATA_MAP_HANDOFF_ENABLED: '0' }, { DATA_MAP_HANDOFF_ENABLED: '1', PROCESS_DATA_GOVERNANCE_READ_ONLY: '1' }]) {
        const generator = createGenerator(noDatabase, { env });
        assert.equal((await generator.runPending()).consumed, 0); assert.equal((await generator.consumeTask(crypto.randomUUID())).consumed, 0);
      }
      assert.equal(calls, 0);
    });
    await withFreshMysql(async target => {
      const { pool, owner, database, port, containerId } = target;
      owned = { owner, database, port, containerId, storage: 'owner-labelled tmpfs' };
      const { session, packageSeed } = await seed(target), env = { DATA_MAP_HANDOFF_ENABLED: '1', PROCESS_DATA_GOVERNANCE_READ_ONLY: '0' };
      const generator = createGenerator(pool, { env }), native = makeProcessDataGovernanceRepository(pool), human = createDataMapHandoffRepository(pool, { env });
      const query = async (sql, args = []) => (await pool.execute(sql, args))[0];
      async function nativeTask(number) {
        await packageSeed(number, { status: 'mdm_review' });
        const completed = await native.completeWorkPackage(String(number), 1, 'synthetic generator source review', session(11), { request_id: crypto.randomUUID() });
        return (await query('SELECT *,CAST(package_id AS CHAR) package_id FROM data_map_handoff_generation_tasks WHERE task_id=?', [completed.handoff.task_id]))[0];
      }
      const task = await nativeTask(601);
      await check('a person or forged HTTP identity cannot reserve or replay the internal system task UUID', async () => {
        await assert.rejects(human.fromWorkPackage('601', { request_id: task.system_request_id, expected_revision: 0 }, { ...session(11), identityKind: 'system', actor_kind: 'system', task_id: task.task_id }), { code: 'HANDOFF_SYSTEM_REQUEST_RESERVED' });
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_requests WHERE request_id=?', [task.system_request_id]))[0].n, 0);
        assert.deepEqual(Object.keys(generator).sort(), ['consumeTask', 'runPending']);
      });
      let generated;
      await check('one native pending task creates only an unapproved system-attributed empty draft and exact request event', async () => {
        generated = await generator.consumeTask(task.task_id); save('generated-receipt.json', generated);
        assert.equal(generated.request_id, task.system_request_id); assert.equal(generated.business_outcome, 'unapproved_draft_generated');
        assert.equal(generated.state, 'draft'); assert.equal(generated.publication_id, null); assert.equal(generated.automatically_approved, false);
        const [header] = await query('SELECT * FROM data_map_handoff_drafts WHERE handoff_id=?', [generated.handoff_id]);
        const [revision] = await query('SELECT * FROM data_map_handoff_revisions WHERE revision_id=?', [generated.revision_id]);
        const [request] = await query('SELECT * FROM data_map_handoff_requests WHERE request_id=?', [task.system_request_id]);
        const events = await query('SELECT * FROM data_map_handoff_events WHERE request_id=?', [task.system_request_id]);
        const [savedTask] = await query('SELECT * FROM data_map_handoff_generation_tasks WHERE task_id=?', [task.task_id]);
        assert.equal(header.created_by, null); assert.equal(revision.created_by, null); assert.equal(header.current_approval_id, null); assert.equal(header.state, 'draft');
        assert.equal(header.created_actor_json.actor_kind, 'system'); assert.equal(header.created_actor_json.actor_ref, task.task_id); assert.equal(header.created_actor_json.authority, 'generate_unapproved_draft_only');
        assert.equal(revision.scope_mode, 'current'); assert.deepEqual(revision.snapshot_json.items, []); assert.deepEqual(revision.snapshot_json.dispositions, []);
        assert.equal(request.actor_kind, 'system'); assert.equal(request.actor_ref, task.task_id); assert.equal(request.state, 'committed');
        assert.equal(events.length, 1); assert.equal(events[0].event_type, 'system_draft_generated'); assert.equal(events[0].actor_json.task_id, task.task_id);
        assert.equal(events[0].payload_json.revision_id, generated.revision_id); assert.equal(savedTask.state, 'generated'); assert.equal(savedTask.system_request_id, task.system_request_id);
        for (const table of ['data_map_handoff_approvals', 'data_map_publications', 'data_map_effective_heads']) assert.equal((await query('SELECT COUNT(*) n FROM ' + table))[0].n, 0);
        const db = await pool.getConnection(); try { await db.beginTransaction(); await require('../server/dataMapHandoffControl').lockGraph(db); const { report } = await evaluate(db, { draft: { ...header, package_id: '601' }, revision, phase: 'check' }); assert.equal(report.ready_for_approval, false); assert.equal(report.publishable, false); save('unapproved-gates.json', report); await db.rollback(); } finally { await db.rollback(); db.release(); }
      });
      await check('same fixed UUID and concurrent consumers return one original draft/revision/event', async () => {
        const [a, b] = await Promise.all([generator.consumeTask(task.task_id), generator.consumeTask(task.task_id)]); assert.deepEqual(a, generated); assert.deepEqual(b, generated);
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_drafts WHERE package_id=601'))[0].n, 1);
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_events WHERE request_id=?', [task.system_request_id]))[0].n, 1);
        await assert.rejects(human.fromWorkPackage('601', { request_id: task.system_request_id, expected_revision: 0 }, session(11)), { code: 'HANDOFF_REQUEST_PAYLOAD_CONFLICT' });
      });
      await check('two consumers of a fresh pending task commit exactly one generation', async () => {
        const concurrent = await nativeTask(602); const [a, b] = await Promise.all([generator.consumeTask(concurrent.task_id), generator.consumeTask(concurrent.task_id)]);
        assert.equal(a.handoff_id, b.handoff_id); assert.equal(a.request_id, concurrent.system_request_id);
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_drafts WHERE package_id=602'))[0].n, 1);
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_events WHERE request_id=?', [concurrent.system_request_id]))[0].n, 1);
      });
      await check('changed binding head commits needs_rebase without generating or overwriting a draft', async () => {
        const stale = await nativeTask(603); await pool.execute('UPDATE data_map_handoff_binding_heads SET binding_id=? WHERE package_id=603', [crypto.randomUUID()]);
        const result = await generator.consumeTask(stale.task_id); assert.equal(result.business_outcome, 'needs_rebase'); assert.equal(result.request_id, stale.system_request_id);
        const [state] = await query('SELECT state,last_error,system_request_id FROM data_map_handoff_generation_tasks WHERE task_id=?', [stale.task_id]);
        assert.equal(state.state, 'needs_rebase'); assert.equal(state.last_error, 'HANDOFF_REVIEW_BINDING_STALE');
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_drafts WHERE package_id=603'))[0].n, 0);
        assert.deepEqual(await generator.consumeTask(stale.task_id), result);
      });
      await check('known rejected source scope is recorded as failed with its original fixed UUID', async () => {
        const bad = await nativeTask(604); await pool.execute('UPDATE process_design_documents SET current_version_id=NULL WHERE id=604');
        const run = await generator.runPending({ limit: 20 }); save('failed-run-summary.json', run);
        assert.equal(run.business_outcome, 'generator_partial_failure'); assert.equal(run.errors.length, 1);
        assert.equal(run.errors[0].code, 'HANDOFF_SOURCE_SCOPE_INCONSISTENT'); assert.equal(run.errors[0].request_id, bad.system_request_id);
        const [state] = await query('SELECT state,last_error,system_request_id FROM data_map_handoff_generation_tasks WHERE task_id=?', [bad.task_id]);
        const [request] = await query('SELECT state FROM data_map_handoff_requests WHERE request_id=?', [bad.system_request_id]);
        assert.equal(state.state, 'failed'); assert.equal(state.last_error, 'HANDOFF_SOURCE_SCOPE_INCONSISTENT'); assert.equal(state.system_request_id, bad.system_request_id); assert.equal(request.state, 'rejected');
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_drafts WHERE package_id=604'))[0].n, 0);
      });
      await check('statement failure keeps prepared request and pending task UUID; explicit retry succeeds once', async () => {
        const retry = await nativeTask(605); let inject = true;
        const failingPool = { async getConnection() { const db = await pool.getConnection(); return new Proxy(db, { get(connection, key) {
          if (key === 'execute') return async (sql, args) => { if (inject && sql.includes("'system_draft_generated'")) { inject = false; throw Object.assign(new Error('synthetic generator statement failure'), { code: 'GENERATOR_STATEMENT_FAILURE' }); } return connection.execute(sql, args); };
          return typeof connection[key] === 'function' ? connection[key].bind(connection) : connection[key];
        } }); } };
        await assert.rejects(createGenerator(failingPool, { env }).consumeTask(retry.task_id), { code: 'GENERATOR_STATEMENT_FAILURE' });
        const [state] = await query('SELECT state,last_error,system_request_id FROM data_map_handoff_generation_tasks WHERE task_id=?', [retry.task_id]);
        assert.equal(state.state, 'pending'); assert.equal(state.last_error, 'GENERATOR_STATEMENT_FAILURE'); assert.equal(state.system_request_id, retry.system_request_id);
        assert.equal((await query('SELECT state FROM data_map_handoff_requests WHERE request_id=?', [retry.system_request_id]))[0].state, 'prepared');
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_drafts WHERE package_id=605'))[0].n, 0);
        const result = await generator.consumeTask(retry.task_id); assert.equal(result.request_id, retry.system_request_id); assert.equal(result.business_outcome, 'unapproved_draft_generated');
      });
      await check('new reviewed binding cannot overwrite an active draft using the preceding binding', async () => {
        const previous = await nativeTask(606);
        const active = await human.fromWorkPackage('606', { request_id: crypto.randomUUID(), expected_revision: 0 }, session(11));
        const correction = await human.createCorrection('606', { request_id: crypto.randomUUID(), expected_revision: 0, replaces_binding_id: previous.binding_id,
          reason: 'synthetic new binding review', basis: 'synthetic correction basis', evidence_refs: ['synthetic:correction'] }, session(11));
        const reviewed = await human.reviewCorrection(correction.correction_id, { request_id: crypto.randomUUID(), expected_revision: 1, basis: 'synthetic exact review', evidence_refs: ['synthetic:review'] }, session(11));
        const result = await generator.consumeTask(reviewed.task_id); assert.equal(result.business_outcome, 'needs_rebase'); assert.equal(result.handoff_id, active.handoff_id);
        const [header] = await query('SELECT handoff_id,current_revision FROM data_map_handoff_drafts WHERE package_id=606');
        assert.equal(header.handoff_id, active.handoff_id); assert.equal(header.current_revision, 1);
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_drafts WHERE package_id=606'))[0].n, 1);
      });
      await check('superseded fixed source produces a historical draft without advancing any effective head', async () => {
        await packageSeed(607, { status: 'mdm_review', sourceStatus: 'superseded' });
        const completed = await native.completeWorkPackage('607', 1, 'synthetic historical review', session(11), { request_id: crypto.randomUUID() });
        const result = await generator.consumeTask(completed.handoff.task_id); assert.equal(result.scope_mode, 'historical');
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_effective_heads'))[0].n, 0);
      });
      await check('a lost reply after the actual business commit leaves the original UUID committed and replays one original draft', async () => {
        const lost = await nativeTask(608); let injected = false, businessRollbacks = 0;
        const losingPool = { async getConnection() { const db = await pool.getConnection(); let business = false; return new Proxy(db, { get(connection, key) {
          if (key === 'execute') return async (sql, args) => { if (sql.includes("SET state='committed',result_json")) business = true; return connection.execute(sql, args); };
          if (key === 'commit') return async () => { await connection.commit(); if (business && !injected) { injected = true; throw Object.assign(new Error('synthetic lost generator commit reply'), { code: 'GENERATOR_COMMIT_REPLY_LOST' }); } };
          if (key === 'rollback') return async () => { if (business) businessRollbacks++; return connection.rollback(); };
          return typeof connection[key] === 'function' ? connection[key].bind(connection) : connection[key];
        } }); } };
        await assert.rejects(createGenerator(losingPool, { env }).consumeTask(lost.task_id), { code: 'HANDOFF_COMMIT_UNKNOWN' });
        assert.equal(businessRollbacks, 0);
        const [state] = await query('SELECT state,last_error,system_request_id FROM data_map_handoff_generation_tasks WHERE task_id=?', [lost.task_id]);
        assert.equal(state.state, 'generated'); assert.equal(state.last_error, null); assert.equal(state.system_request_id, lost.system_request_id);
        const result = await generator.consumeTask(lost.task_id); assert.equal(result.request_id, lost.system_request_id);
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_events WHERE request_id=?', [lost.system_request_id]))[0].n, 1);
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_drafts WHERE package_id=608'))[0].n, 1);
        save('commit-reply-loss.json', { request_id: lost.system_request_id, businessRollbacks, durableTask: state, replay: result });
      });
      await check('prepared receipt plus a persisted draft event fails closed without creating another draft', async () => {
        await pool.execute("UPDATE data_map_handoff_requests SET state='prepared',result_json=NULL,finished_at=NULL WHERE request_id=?", [task.system_request_id]);
        await assert.rejects(generator.consumeTask(task.task_id), { code: 'HANDOFF_RECEIPT_INCONSISTENT' });
        assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_drafts WHERE package_id=601'))[0].n, 1);
        assert.equal((await query('SELECT state FROM data_map_handoff_requests WHERE request_id=?', [task.system_request_id]))[0].state, 'prepared');
        await pool.execute("UPDATE data_map_handoff_requests SET state='committed',result_json=?,finished_at=UTC_TIMESTAMP(3) WHERE request_id=?", [JSON.stringify(generated), task.system_request_id]);
      });
      await check('an actual NOT ENFORCED CHECK blocks generation and restoration requires a separate explicit human action', async () => {
        const guarded = await nativeTask(609);
        await pool.execute('ALTER TABLE data_map_handoff_generation_tasks ALTER CHECK chk_handoff_generation_state NOT ENFORCED');
        try {
          await assert.rejects(generator.consumeTask(guarded.task_id), { code: 'HANDOFF_SCHEMA_UNAVAILABLE' });
          assert.equal((await query('SELECT COUNT(*) n FROM data_map_handoff_drafts WHERE package_id=609'))[0].n, 0);
          assert.equal((await query('SELECT state FROM data_map_handoff_requests WHERE request_id=?', [guarded.system_request_id]))[0].state, 'rejected');
          const [state] = await query('SELECT state,last_error,system_request_id FROM data_map_handoff_generation_tasks WHERE task_id=?', [guarded.task_id]);
          assert.equal(state.state, 'failed'); assert.equal(state.last_error, 'HANDOFF_SCHEMA_UNAVAILABLE'); assert.equal(state.system_request_id, guarded.system_request_id);
        } finally { await pool.execute('ALTER TABLE data_map_handoff_generation_tasks ALTER CHECK chk_handoff_generation_state ENFORCED'); }
        await assert.rejects(generator.consumeTask(guarded.task_id), { code: 'HANDOFF_SCHEMA_UNAVAILABLE' });
        const recovered = await human.fromWorkPackage('609', { request_id: crypto.randomUUID(), expected_revision: 0 }, session(11));
        assert.equal(recovered.state, 'draft'); assert.equal(recovered.publication_id, null);
        assert.equal((await query('SELECT state FROM data_map_handoff_requests WHERE request_id=?', [guarded.system_request_id]))[0].state, 'rejected');
        save('generator-schema-check-gate.json', { rejectedSystemRequestId: guarded.system_request_id, rejectedStateRetained: true, explicitHumanRequestId: recovered.request_id, handoffId: recovered.handoff_id, noDraftWhileConstraintDisabled: true });
      });
      save('final-tasks.json', await query('SELECT task_id,CAST(package_id AS CHAR) package_id,binding_id,system_request_id,state,attempt,last_error FROM data_map_handoff_generation_tasks ORDER BY package_id'));
    }, { stage: '64', randomDatabase: true });
    owned.cleaned = true; passed = true;
  } catch (error) { failure = { code: error.code, message: error.message, stack: error.stack }; throw error; }
  finally { save('results.json', { passed, checks, owned, failure, formalDatabaseAccess: false, businessAccepted: false, defaultFeatureEnabled: false }); }
  console.log('PASS HANDOFF_GENERATOR_MYSQL ' + checks.length + ' checks; evidence ' + output);
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { main };
