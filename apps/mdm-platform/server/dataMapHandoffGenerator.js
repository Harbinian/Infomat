// Explicit internal task consumer. No timer, feature activation, DDL, human
// impersonation, AI, 3001 access or publication is performed by this module.
const { createHandoffRequestStore } = require('./dataMapHandoffRequests');
const { failure, uuid, id, json, parse, digest, verify, newId, snapshot } = require('./dataMapHandoffPolicy');
const { packageSource, dependencies } = require('./dataMapHandoffGates');
const { binding } = require('./dataMapHandoffBindings');
const one = async (db, sql, args = []) => (await db.execute(sql, args))[0][0] || null;
const rows = async (db, sql, args = []) => (await db.execute(sql, args))[0];

function createGenerator(pool, { env = process.env } = {}) {
  if (!pool || typeof pool.getConnection !== 'function') throw new TypeError('A caller-owned MySQL pool is required');
  const trusted = new WeakSet();
  function enabled() {
    const flag = String(env.DATA_MAP_HANDOFF_ENABLED || '0'), readonly = String(env.PROCESS_DATA_GOVERNANCE_READ_ONLY || '0');
    if (![flag, readonly].every(value => ['0', '1'].includes(value))) throw failure('HANDOFF_CONFIGURATION_INVALID', 503);
    return flag === '1' && readonly === '0';
  }
  const disabled = taskId => ({ business_outcome: 'generator_disabled', consumed: 0, ...(taskId ? { task_id: taskId } : {}) });
  function assertToken(token, action, scope, options = {}) {
    const replay = action === 'read' && options.lock === false;
    if (!token || !trusted.has(token) || (!replay && action !== 'prepare') || scope.operation !== 'generate_draft' ||
        scope.kind !== 'generation_task' || scope.id !== token.task_id || scope.packageId !== token.package_id || scope.bindingId !== token.binding_id) {
      throw failure('HANDOFF_SYSTEM_AUTHORITY_DENIED', 403);
    }
  }
  async function authorize(db, token, action, scope, options = {}) {
    assertToken(token, action, scope, options);
    const task = await one(db, `SELECT task_id,CAST(package_id AS CHAR) package_id,binding_id,system_request_id,state
      FROM data_map_handoff_generation_tasks WHERE task_id=? FOR SHARE`, [token.task_id]);
    if (!task || task.package_id !== token.package_id || task.binding_id !== token.binding_id || task.system_request_id !== token.request_id) throw failure('HANDOFF_GENERATION_TASK_CHANGED', 503);
    if (action === 'read') {
      const receipt = await one(db, 'SELECT state,result_json FROM data_map_handoff_requests WHERE request_id=? FOR SHARE', [token.request_id]);
      if (receipt?.state === 'committed') {
        const result = parse(receipt.result_json);
        if (!result || result.task_id !== token.task_id || result.binding_id !== token.binding_id || result.package_id !== token.package_id ||
            task.state !== (result.business_outcome === 'needs_rebase' ? 'needs_rebase' : 'generated')) throw failure('HANDOFF_RECEIPT_INCONSISTENT', 503);
        if (result.business_outcome === 'unapproved_draft_generated') {
          const revision = await one(db, 'SELECT handoff_id,binding_id,snapshot_json,content_digest FROM data_map_handoff_revisions WHERE revision_id=? FOR SHARE', [result.revision_id]);
          const event = await one(db, "SELECT handoff_id,payload_json,actor_json FROM data_map_handoff_events WHERE request_id=? AND event_type='system_draft_generated' FOR SHARE", [token.request_id]);
          if (!revision || revision.handoff_id !== result.handoff_id || revision.binding_id !== token.binding_id || !event || event.handoff_id !== result.handoff_id ||
              parse(event.payload_json).revision_id !== result.revision_id || parse(event.actor_json).task_id !== token.task_id) throw failure('HANDOFF_RECEIPT_INCONSISTENT', 503);
          verify(parse(revision.snapshot_json), revision.content_digest);
        }
      }
    }
    return { personId: null, qualificationSnapshot: Object.freeze({ actor_kind: 'system', actor_ref: token.task_id,
      system_actor: 'data_map_handoff_generator', task_id: token.task_id, package_id: token.package_id,
      binding_id: token.binding_id, request_id: token.request_id, authority: 'generate_unapproved_draft_only' }) };
  }
  async function assertNoCommittedEffects(db, requestId) {
    for (const [table, condition] of [
      ['data_map_handoff_events', 'request_id=?'], ['data_map_handoff_approvals', 'request_id=?'],
      ['data_map_publications', 'request_id=?'], ['data_map_publication_events', 'request_id=?'],
      ['data_map_handoff_drafts', "JSON_UNQUOTE(JSON_EXTRACT(created_actor_json,'$.request_id'))=?"],
      ['data_map_handoff_revisions', "JSON_UNQUOTE(JSON_EXTRACT(created_actor_json,'$.request_id'))=?"]
    ]) {
      if ((await rows(db, `SELECT 1 found FROM ${table} WHERE ${condition} FOR SHARE`, [requestId])).length) {
        throw failure('HANDOFF_RECEIPT_INCONSISTENT', 503, { request_id: requestId });
      }
    }
  }
  const requests = createHandoffRequestStore(pool, { env, authorize, assertNoCommittedEffects,
    assertReady: async db => {
      if (!(await require('./dataMapHandoffSchema').inspectHandoffSchema(db,{pinMetadata:true})).ready) throw failure('HANDOFF_SCHEMA_UNAVAILABLE', 503);
    },
    actorIdentity: token => {
      if (!token || !trusted.has(token)) throw failure('HANDOFF_SYSTEM_AUTHORITY_DENIED', 403);
      return { kind: 'system', ref: token.task_id };
    } });
  async function initialTask(taskId) {
    const db = await pool.getConnection();
    try {
      const task = await one(db, 'SELECT task_id,CAST(package_id AS CHAR) package_id,binding_id,system_request_id,state FROM data_map_handoff_generation_tasks WHERE task_id=?', [taskId]);
      if (!task) throw failure('HANDOFF_GENERATION_TASK_NOT_FOUND', 404);
      id(task.package_id); uuid(task.binding_id); uuid(task.system_request_id);
      return task;
    } finally { db.release(); }
  }
  async function recordFailure(token, error) {
    // An unresolved commit is never rolled back or labelled as failed. The same
    // fixed UUID remains available for the original receipt/replay check.
    if (error.code === 'HANDOFF_COMMIT_UNKNOWN' || !enabled()) return;
    let db;
    try {
      db = await pool.getConnection(); await db.beginTransaction();
      const request = await one(db, 'SELECT actor_kind,actor_ref,state FROM data_map_handoff_requests WHERE request_id=? FOR UPDATE NOWAIT', [token.request_id]);
      if (!request || request.actor_kind !== 'system' || request.actor_ref !== token.task_id || request.state === 'committed') { await db.rollback(); return; }
      await require('./dataMapHandoffControl').lockGraph(db);
      await one(db, 'SELECT id FROM process_data_governance_work_packages WHERE id=? FOR UPDATE', [token.package_id]);
      const task = await one(db, 'SELECT state,system_request_id FROM data_map_handoff_generation_tasks WHERE task_id=? FOR UPDATE', [token.task_id]);
      if (!task || task.system_request_id !== token.request_id || !['pending', 'failed'].includes(task.state)) { await db.rollback(); return; }
      if (request.state === 'prepared') await assertNoCommittedEffects(db, token.request_id);
      await db.execute('UPDATE data_map_handoff_generation_tasks SET state=?,last_error=?,attempt=attempt+1 WHERE task_id=?',
        [request.state === 'rejected' ? 'failed' : 'pending', String(error.code || 'HANDOFF_GENERATION_FAILED').slice(0, 96), token.task_id]);
      await db.commit();
    } catch (_) {
      // Best-effort diagnostic state cannot turn an uncertain request into a
      // determined failure or replace the original error/UUID.
      if (db) await db.rollback().catch(() => {});
    } finally { if (db) db.release(); }
  }
  async function consumeTask(taskId) {
    taskId = uuid(taskId);
    if (!enabled()) return disabled(taskId);
    const initial = await initialTask(taskId);
    const token = Object.freeze({ task_id: taskId, package_id: initial.package_id, binding_id: initial.binding_id, request_id: initial.system_request_id });
    trusted.add(token);
    const scope = { kind: 'generation_task', id: taskId, packageId: token.package_id, bindingId: token.binding_id, operation: 'generate_draft' };
    const body = { request_id: token.request_id, task_id: taskId, binding_id: token.binding_id };
    try {
      return await requests.execute('prepare', scope, body, token, async (db, control, reauthorize, context) => {
        const { pkg, source } = await packageSource(db, token.package_id);
        const task = await one(db, `SELECT task_id,CAST(package_id AS CHAR) package_id,binding_id,system_request_id,state
          FROM data_map_handoff_generation_tasks WHERE task_id=? FOR UPDATE`, [taskId]);
        const head = await one(db, 'SELECT binding_id,head_revision FROM data_map_handoff_binding_heads WHERE package_id=? FOR UPDATE', [pkg.id]);
        if (!task || task.package_id !== pkg.id || task.binding_id !== token.binding_id || task.system_request_id !== context.request_id) throw failure('HANDOFF_GENERATION_TASK_CHANGED', 503);
        const actor = await reauthorize();
        const needsRebase = async (reason, handoffId = null) => {
          await db.execute("UPDATE data_map_handoff_generation_tasks SET state='needs_rebase',attempt=attempt+1,last_error=? WHERE task_id=?", [reason, taskId]);
          return { task_id: taskId, package_id: pkg.id, binding_id: token.binding_id, state: 'needs_rebase', business_outcome: 'needs_rebase',
            reason, handoff_id: handoffId, publication_id: null, automatically_approved: false, automatically_published: false };
        };
        if (!head || head.binding_id !== token.binding_id) return needsRebase('HANDOFF_REVIEW_BINDING_STALE');
        if (pkg.status !== 'completed') throw failure('HANDOFF_GENERATION_REVIEW_INCOMPLETE');
        const bound = await binding(db, token.binding_id, pkg.id);
        if (bound.snapshot.source_hash !== source.content_hash || bound.snapshot.process_version_id !== source.id) throw failure('HANDOFF_REVIEW_BINDING_STALE');
        const active = await one(db, 'SELECT handoff_id,state,current_revision FROM data_map_handoff_drafts WHERE package_id=? AND active_slot=1 FOR UPDATE', [pkg.id]);
        let existing = null;
        if (active) {
          const revision = await one(db, 'SELECT revision_id,revision_no,binding_id,scope_mode,snapshot_json,content_digest FROM data_map_handoff_revisions WHERE handoff_id=? AND revision_no=? FOR SHARE', [active.handoff_id, active.current_revision]);
          if (!revision) throw failure('HANDOFF_GENERATION_EFFECTS_INCONSISTENT', 503);
          if (revision.binding_id !== token.binding_id) return needsRebase('HANDOFF_ACTIVE_BINDING_CHANGED', active.handoff_id);
          existing = { ...active, ...revision };
        } else {
          existing = await one(db, `SELECT d.handoff_id,d.state,d.current_revision,r.revision_id,r.revision_no,r.binding_id,r.scope_mode,r.snapshot_json,r.content_digest
            FROM data_map_handoff_drafts d JOIN data_map_handoff_revisions r ON r.handoff_id=d.handoff_id AND r.revision_no=d.current_revision
            WHERE d.package_id=? AND r.binding_id=? ORDER BY d.created_at,d.handoff_id LIMIT 1 FOR UPDATE OF d FOR SHARE OF r`, [pkg.id, token.binding_id]);
        }
        if (existing) {
          verify(parse(existing.snapshot_json), existing.content_digest);
          const publication = existing.state === 'published' ? await one(db, 'SELECT publication_id FROM data_map_publications WHERE handoff_revision_id=? FOR SHARE', [existing.revision_id]) : null;
          if (existing.state === 'published' && !publication) throw failure('HANDOFF_GENERATION_EFFECTS_INCONSISTENT', 503);
          await db.execute("UPDATE data_map_handoff_generation_tasks SET state='generated',attempt=attempt+1,last_error=NULL WHERE task_id=?", [taskId]);
          return { task_id: taskId, package_id: pkg.id, binding_id: token.binding_id, handoff_id: existing.handoff_id, revision_id: existing.revision_id,
            revision: Number(existing.revision_no), state: existing.state, business_outcome: publication ? 'existing_publication' : 'existing_draft',
            publication_id: publication?.publication_id || null, idempotent: true, automatically_approved: false, automatically_published: false };
        }
        if (task.state === 'generated') throw failure('HANDOFF_GENERATION_EFFECTS_INCONSISTENT', 503);
        const document = await one(db, 'SELECT CAST(current_version_id AS CHAR) current_version_id FROM process_design_documents WHERE id=? FOR SHARE', [source.document_id]);
        const currentVersions = await rows(db, "SELECT CAST(id AS CHAR) id FROM process_design_versions WHERE document_id=? AND status='published' ORDER BY id FOR SHARE", [source.document_id]);
        let scopeMode;
        if (source.status === 'published' && document?.current_version_id === source.id && currentVersions.length === 1 && currentVersions[0].id === source.id) scopeMode = 'current';
        else if (source.status === 'superseded' && document && document.current_version_id !== source.id) scopeMode = 'historical';
        else throw failure('HANDOFF_SOURCE_SCOPE_INCONSISTENT');
        const initialBody = snapshot({ schema_version: 'handoff-draft-v1', scope_mode: scopeMode, items: [], dispositions: [], impact_dispositions: [], basis: '' });
        const handoffId = newId(), revisionId = newId();
        const deps = await dependencies(db, initialBody, bound.snapshot, { handoffId, bindingId: bound.binding_id });
        await db.execute(`INSERT INTO data_map_handoff_drafts
          (handoff_id,package_id,current_revision,state,active_slot,created_by,created_actor_json,created_at)
          VALUES(?,?,1,'draft',1,NULL,?,UTC_TIMESTAMP(3))`, [handoffId, pkg.id, json(actor.qualificationSnapshot)]);
        await db.execute(`INSERT INTO data_map_handoff_revisions
          (revision_id,handoff_id,revision_no,scope_mode,binding_id,snapshot_json,content_digest,dependency_manifest_json,impact_manifest_json,created_by,created_actor_json,created_at)
          VALUES(?,?,1,?,?,?,?,?,?,NULL,?,UTC_TIMESTAMP(3))`, [revisionId, handoffId, scopeMode, token.binding_id, json(initialBody), digest(initialBody), json(deps), json(deps.impacts), json(actor.qualificationSnapshot)]);
        await db.execute(`INSERT INTO data_map_handoff_events(event_id,handoff_id,event_type,payload_json,actor_json,request_id,created_at)
          VALUES(?,?,'system_draft_generated',?,?,?,UTC_TIMESTAMP(3))`,
        [newId(), handoffId, json({ task_id: taskId, binding_id: token.binding_id, revision_id: revisionId }), json(actor.qualificationSnapshot), context.request_id]);
        await db.execute("UPDATE data_map_handoff_generation_tasks SET state='generated',attempt=attempt+1,last_error=NULL WHERE task_id=?", [taskId]);
        return { task_id: taskId, package_id: pkg.id, binding_id: token.binding_id, handoff_id: handoffId, revision_id: revisionId, revision: 1,
          scope_mode: scopeMode, state: 'draft', business_outcome: 'unapproved_draft_generated', publication_id: null,
          automatically_approved: false, automatically_published: false };
      });
    } catch (error) {
      error.generatorTaskId = token.task_id; error.generatorRequestId = token.request_id;
      await recordFailure(token, error);
      throw error;
    } finally { trusted.delete(token); }
  }
  async function runPending({ limit = 20 } = {}) {
    if (!enabled()) return disabled();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw failure('HANDOFF_GENERATION_LIMIT_INVALID', 422);
    const db = await pool.getConnection(); let pending;
    try { pending = await rows(db, "SELECT task_id FROM data_map_handoff_generation_tasks WHERE state='pending' ORDER BY created_at,task_id LIMIT " + limit); }
    finally { db.release(); }
    const results = [], errors = [];
    for (const task of pending) {
      if (!enabled()) break;
      try { results.push(await consumeTask(task.task_id)); }
      catch (error) { errors.push({ task_id: task.task_id, request_id: error.generatorRequestId || error.payload?.request_id,
        code: error.code || 'HANDOFF_GENERATION_FAILED', business_outcome: error.code === 'HANDOFF_COMMIT_UNKNOWN' ? 'pending_verification' : 'not_completed' }); }
    }
    return { business_outcome: errors.length ? 'generator_partial_failure' : 'generator_run_complete',
      consumed: results.length, results, errors };
  }
  return { runPending, consumeTask };
}
module.exports = { createGenerator };
