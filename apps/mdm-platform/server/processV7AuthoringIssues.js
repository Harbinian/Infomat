// Exact fixed-source replies only. Existing issues/todos remain the sole entities.
// Callers own the transaction; lock order is issue -> case -> current identity.
const authoring = require('./processV7Authoring');
const { id, parse, digest, json, rows } = require('./dataMapDefinitionValues');
const { failure } = require('./processV7AuthoringMigration');
const fail = (name, status = 409) => failure('V7_AUTHORING_ISSUE_' + name, status);
async function ready(db) {
  if (!authoring.enabled()) throw failure('V7_AUTHORING_DISABLED', 503);
  for (const key of [require('./processV7AuthoringMigration').MIGRATION_KEY, require('./v7MappingSchema').MIGRATION_KEY, require('./analysisIssueSchema').MIGRATION_KEY, require('./analysisTaskSchema').MIGRATION_KEY]) {
    if (!(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [key]))[0].length) throw fail('MIGRATION_REQUIRED', 503);
  }
}
async function fixedSources(db, issueId, caseRow) {
  const [reviews] = await db.execute(`SELECT r.snapshot_json,r.snapshot_digest,CAST(r.finding_id AS CHAR) finding_id,
    r.revision_no,CAST(r.issue_id AS CHAR) issue_id,CAST(r.actor_person_id AS CHAR) actor_person_id,
    CAST(f.run_id AS CHAR) run_id,run.manifest_json,run.manifest_digest
    FROM data_map_analysis_finding_reviews r JOIN data_map_analysis_findings f ON f.finding_id=r.finding_id
    JOIN data_map_analysis_runs run ON run.run_id=f.run_id WHERE r.issue_id=? ORDER BY r.review_id LIMIT 101 FOR SHARE`, [issueId]);
  if (!reviews.length || reviews.length > 100) throw fail('SOURCE_UNRESOLVED');
  const references = new Map(); let current = true;
  for (const review of reviews) {
    const value = parse(review.snapshot_json);
    if (digest(value) !== review.snapshot_digest || value.issue_id !== issueId || value.finding_id !== review.finding_id || value.actor_person_id !== review.actor_person_id || value.revision_no !== review.revision_no || value.decision !== 'linked') throw fail('INTEGRITY_CONFLICT');
    const manifest = parse(review.manifest_json);
    if (digest(manifest) !== review.manifest_digest || value.manifest_digest !== review.manifest_digest || value.run_id !== review.run_id || json(value.fixed_inputs) !== json(manifest.inputs)) throw fail('INTEGRITY_CONFLICT');
    // A whole-issue projection needs every fixed input to belong to this case.
    // Independent uploads, ledger-only inputs and cross-case runs stay on the original scoped path.
    if (!Array.isArray(value.fixed_inputs) || !value.fixed_inputs.length || value.fixed_inputs.length > 256) throw fail('SOURCE_UNRESOLVED');
    for (const input of value.fixed_inputs) {
      const ref = input.snapshot;
      if (ref?.kind !== 'v7_source' || !['preview_revision', 'published_version'].includes(ref.source_kind)) throw fail('SOURCE_UNRESOLVED');
      const [[source]] = await db.execute(`SELECT *,CAST(case_id AS CHAR) case_id,CAST(revision_id AS CHAR) revision_id,
        CAST(process_version_id AS CHAR) process_version_id,CAST(scope_department_id AS CHAR) scope_department_id FROM data_map_v7_sources WHERE source_id=? FOR SHARE`, [id(ref.ref_id)]);
      if (!source || source.source_kind !== ref.source_kind || source.validation_status !== 'valid' || source.content_digest !== ref.content_digest || source.digest_algorithm !== ref.digest_algorithm || source.scope_department_id !== String(caseRow.owning_department_id)) throw fail('INTEGRITY_CONFLICT');
      const sourceRef = source.source_kind === 'preview_revision' ? { case_id: source.case_id, revision_id: source.revision_id } : { process_version_id: source.process_version_id };
      if (json(sourceRef) !== json(ref.source_ref)) throw fail('INTEGRITY_CONFLICT');
      if (source.source_kind === 'preview_revision') {
        if (source.case_id !== String(caseRow.id)) throw fail('SOURCE_UNRESOLVED');
        current &&= String(caseRow.current_revision_id) === source.revision_id;
      } else {
        const [matches] = await db.execute(`SELECT pr.preview_case_id FROM process_v7_promotions pr JOIN process_design_versions v ON v.draft_id=pr.draft_id
          WHERE v.id=? AND pr.preview_case_id=? AND pr.content_hash=v.content_hash FOR SHARE`, [source.process_version_id, caseRow.id]);
        if (matches.length !== 1) throw fail('SOURCE_UNRESOLVED');
      }
      const live = await require('./v7FixedSource').readReference(db, source.source_kind, source, {}, (_who, department) => {
        if (String(department) !== String(caseRow.owning_department_id)) throw fail('SOURCE_UNRESOLVED');
      });
      const stored = parse(source.content_json);
      if (require('./processV7PreviewReview').contentHash(stored) !== source.content_digest || live.content_digest !== source.content_digest) throw fail('INTEGRITY_CONFLICT');
      references.set(id(ref.ref_id), { source_id: id(ref.ref_id), source_kind: source.source_kind, source_ref: sourceRef, content_digest: source.content_digest });
    }
  }
  return { current, references: [...references.values()] };
}
async function context(db, caseId, issueId, actor, writing = false) {
  const value = (await rows(db, 'process_governance_issues', 'issue_id=?', [id(issueId)], true))[0];
  const [[binding]] = await db.execute('SELECT revision_no,issue_digest,CAST(owner_department_id AS CHAR) owner_department_id FROM data_map_analysis_issue_bindings WHERE issue_id=? FOR UPDATE', [issueId]);
  const [[caseRow]] = await db.execute('SELECT *,CAST(id AS CHAR) id,CAST(current_revision_id AS CHAR) current_revision_id FROM process_v7_preview_cases WHERE id=? FOR UPDATE', [id(caseId)]);
  if (!caseRow) throw fail('NOT_FOUND', 404);
  const current = await authoring.activeActor(db, actor), assignment = await authoring.state(db, caseId, true);
  const compiler = authoring.isCompiler(current, caseRow, assignment);
  if (!assignment || (writing ? !compiler : !(compiler || authoring.isContact(current, caseRow) || current.effects.get('governance:read-global') === 'allow'))) throw failure('V7_AUTHORING_COMPILER_REQUIRED', 403);
  if (!value || !binding || binding.owner_department_id !== String(caseRow.owning_department_id)) throw fail('NOT_FOUND', 404);
  if (binding.issue_digest !== digest(value)) throw fail('INTEGRITY_CONFLICT');
  const sources = await fixedSources(db, id(issueId), caseRow);
  return { value, binding, caseRow, compiler, sources };
}
async function tasks(db, issueId) {
  const [items] = await db.execute(`SELECT CAST(l.todo_id AS CHAR) todo_id,l.snapshot_json,l.snapshot_digest,t.status,
    CAST(a.office_id AS CHAR) office_id,CAST(a.assignee_person_id AS CHAR) assignee_person_id,a.revision_no
    FROM data_map_analysis_issue_tasks l JOIN mdm_todos t ON t.id=l.todo_id JOIN mdm_todo_office_assignments a ON a.todo_id=l.todo_id WHERE l.issue_id=? ORDER BY l.todo_id LIMIT 201 FOR SHARE`, [issueId]);
  if (items.length > 200) throw fail('TASK_LIMIT', 503);
  return items.map(({ snapshot_json, snapshot_digest, ...item }) => {
    const snapshot = parse(snapshot_json);
    if (digest(snapshot) !== snapshot_digest || snapshot.issue_id !== issueId || snapshot.office_id !== item.office_id) throw fail('INTEGRITY_CONFLICT');
    return { ...item, purpose: snapshot.purpose, round_no: snapshot.round_no, instruction: snapshot.instruction };
  });
}
async function list(db, caseId, actor, after) {
  await ready(db);
  // Authorize even an empty page before discovering issue ids.
  const [[caseRow]] = await db.execute('SELECT *,CAST(id AS CHAR) id,CAST(current_revision_id AS CHAR) current_revision_id FROM process_v7_preview_cases WHERE id=?', [id(caseId)]);
  if (!caseRow) throw fail('NOT_FOUND', 404);
  const current = await authoring.activeActor(db, actor, false), assignment = await authoring.state(db, caseId);
  if (!assignment || !(authoring.isCompiler(current, caseRow, assignment) || authoring.isContact(current, caseRow) || current.effects.get('governance:read-global') === 'allow')) throw failure('V7_AUTHORING_COMPILER_REQUIRED', 403);
  const cursor = after == null || after === '' ? '0' : id(after);
  const [candidates] = await db.execute(`SELECT CAST(b.issue_id AS CHAR) issue_id FROM data_map_analysis_issue_bindings b
    WHERE b.owner_department_id=? AND b.issue_id>? AND EXISTS (
      SELECT 1 FROM data_map_analysis_finding_reviews r JOIN data_map_analysis_findings f ON f.finding_id=r.finding_id
      JOIN data_map_analysis_inputs i ON i.run_id=f.run_id JOIN data_map_v7_sources s ON s.source_id=i.source_id
      WHERE r.issue_id=b.issue_id AND (s.case_id=? OR EXISTS (
        SELECT 1 FROM process_v7_promotions pr JOIN process_design_versions v ON v.draft_id=pr.draft_id WHERE v.id=s.process_version_id AND pr.preview_case_id=?)))
    ORDER BY b.issue_id LIMIT 21`, [caseRow.owning_department_id, cursor, caseId, caseId]);
  const items = []; let excluded = 0;
  for (const candidate of candidates.slice(0, 20)) {
    try {
      const c = await context(db, caseId, candidate.issue_id, actor);
      const [events] = await db.execute(`SELECT CAST(event_id AS CHAR) event_id,CAST(actor_person_id AS CHAR) actor_person_id,note,payload_json,UNIX_TIMESTAMP(created_at) created_epoch
        FROM process_governance_issue_events WHERE issue_id=? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.source_type'))='v7_authoring_reply' ORDER BY event_id DESC LIMIT 50 FOR SHARE`, [candidate.issue_id]);
      items.push({ issue_id: candidate.issue_id, title: c.value.title, status: c.value.display_status,
        revision_no: c.binding.revision_no, issue_digest: c.binding.issue_digest, source_current: c.sources.current,
        can_reply: c.compiler && c.sources.current && c.caseRow.status !== 'closed' && !['closed', 'completed', 'not_in_scope'].includes(c.value.display_status),
        tasks: await tasks(db, candidate.issue_id), replies: events.map(e => ({ ...e, created_at: new Date(Number(e.created_epoch) * 1000).toISOString(), created_epoch: undefined, reference: parse(e.payload_json), payload_json: undefined })) });
    } catch (error) { if (error.code === 'V7_AUTHORING_ISSUE_SOURCE_UNRESOLVED') { excluded++; continue; } throw error; }
  }
  return { items, excluded, next_cursor: candidates.length > 20 ? candidates[19].issue_id : null,
    coverage: 'exact_case_fixed_v7_sources', close_enabled: false, auto_dispatch_enabled: false };
}
async function reply(db, caseId, issueId, body, actor) {
  await ready(db);
  const allowed = ['request_key', 'content', 'expected_revision_no', 'expected_content_hash', 'expected_assignment_version', 'expected_issue_revision', 'expected_issue_digest', 'todo_id', 'expected_task_revision'];
  if (!body || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k))) throw fail('INPUT_INVALID', 422);
  const c = await context(db, caseId, issueId, actor, true);
  const reference = { issue_id: id(issueId), expected_issue_revision: body.expected_issue_revision, expected_issue_digest: body.expected_issue_digest,
    todo_id: body.todo_id == null ? null : id(body.todo_id), expected_task_revision: body.expected_task_revision ?? null };
  const result = await authoring.record(db, c.caseRow, { ...body, record_kind: 'problem_reply' }, actor, reference);
  if (result.idempotent) {
    const [events] = await db.execute(`SELECT event_id FROM process_governance_issue_events WHERE issue_id=? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.record_id'))=?
      AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.source_type'))='v7_authoring_reply' FOR SHARE`, [issueId, result.record_id]);
    if (events.length !== 1) throw fail('INTEGRITY_CONFLICT');
    return { ...result, issue_id: id(issueId), todo_id: reference.todo_id, close_enabled: false };
  }
  if (c.caseRow.status === 'closed' || ['closed', 'completed', 'not_in_scope'].includes(c.value.display_status)) throw fail('CLOSED');
  if (!c.sources.current || body.expected_revision_no !== c.caseRow.current_revision_no || body.expected_content_hash !== c.caseRow.current_content_hash) throw fail('SOURCE_CHANGED');
  if (body.expected_issue_revision !== c.binding.revision_no || body.expected_issue_digest !== c.binding.issue_digest) throw fail('REVISION_CONFLICT');
  if (reference.todo_id) {
    const task = (await tasks(db, id(issueId))).find(t => t.todo_id === reference.todo_id);
    if (!task || task.status !== 'pending' || task.revision_no !== body.expected_task_revision) throw fail('TASK_CHANGED');
  } else if (body.expected_task_revision != null) throw fail('INPUT_INVALID', 422);
  const payload = { source_type: 'v7_authoring_reply', record_id: result.record_id, case_id: id(caseId), request_key: body.request_key,
    ...reference, revision_no: c.caseRow.current_revision_no, content_hash: c.caseRow.current_content_hash,
    actor_person_id: String(actor.personId), fixed_sources: c.sources.references };
  await db.execute("INSERT INTO process_governance_issue_events(issue_id,event_type,actor_person_id,note,payload_json) VALUES (?,'commented',?,?,?)", [issueId, actor.personId, body.content.trim(), json(payload)]);
  if (reference.todo_id) await db.execute("INSERT INTO mdm_todo_events(todo_id,event_type,actor_person_id,note) VALUES (?,'compiler_replied',?,?)", [reference.todo_id, actor.personId, json({ ...payload, content: body.content.trim() })]);
  await db.execute('UPDATE data_map_analysis_issue_bindings SET revision_no=revision_no+1 WHERE issue_id=?', [issueId]);
  return { ...result, issue_id: id(issueId), todo_id: reference.todo_id, revision_no: c.binding.revision_no + 1, close_enabled: false };
}
module.exports = { list, reply, fixedSources };
