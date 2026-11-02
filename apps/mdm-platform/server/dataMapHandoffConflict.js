// Conflict projections, immutable events and directed fact versions share the
// caller's transaction. This module neither opens pools nor commits or migrates.
const crypto = require('node:crypto');
const { digest, json, parse, id, uuid } = require('./dataMapHandoffPolicy');
const CONTRACT = 'handoff-conflict-v1';
const KINDS = new Set(['fact', 'definition', 'responsibility', 'sor', 'cross_department', 'version']);
const STATES = new Set(['open', 'resolved', 'verified', 'escalated']);
const text = value => typeof value === 'string' ? value.trim() : '';
const copy = value => JSON.parse(json(value));
const one = async (db, sql, values = []) => (await db.execute(sql, values))[0][0] || null;
function fail(code, message, statusCode = 409, details = {}) {
  return Object.assign(new Error(message), { code, statusCode, payload: { code, error: message, ...details } });
}
function connection(db) {
  if (!db || typeof db.execute !== 'function' || typeof db.getConnection === 'function') throw new TypeError('A caller-owned transaction connection is required');
}
function evidence(value) {
  if (!Array.isArray(value) || !value.length || value.some(ref => !text(ref))) throw fail('HANDOFF_CONFLICT_EVIDENCE_REQUIRED', '须填写可定位的依据材料', 422);
  return [...new Set(value.map(text))];
}
function basis(body) {
  if (!text(body.basis)) throw fail('HANDOFF_CONFLICT_BASIS_REQUIRED', '须填写办理依据', 422);
  return { basis: text(body.basis), evidence_refs: evidence(body.evidence_refs) };
}
function actorSnapshot(actor) {
  if (!actor || !actor.personId || !actor.qualificationSnapshot) throw fail('HANDOFF_CONFLICT_ACTOR_REQUIRED', '须以当前有效身份办理', 403);
  return copy({ person_id: id(actor.personId), account_id: id(actor.accountId), auth_version: id(actor.authVersion),
    department_id: actor.departmentId == null ? null : id(actor.departmentId), role_code: actor.roleCode,
    role_codes: [...(actor.roleCodes || [])].sort(), qualification: actor.qualificationSnapshot });
}
function expected(actual, wanted, resource = 'conflict') {
  if (!Number.isSafeInteger(wanted) || wanted < 0) throw fail('HANDOFF_REVISION_REQUIRED', '须提交明确的当前修订号', 400);
  if (Number(actual) !== wanted) throw fail('HANDOFF_CONFLICT_REVISION_CONFLICT', '当前修订已变化，请刷新核对', 409, { resource, current_revision: Number(actual) });
}
function context(header, revision, body, { verification = false } = {}) {
  if (!header || !(verification ? ['draft'] : ['draft', 'submitted', 'approved']).includes(header.state) || !revision || revision.handoff_id !== header.handoff_id) throw fail('HANDOFF_CONFLICT_DRAFT_REQUIRED', verification ? '须先退回可修订草案再复核冲突结果' : '已发布版本不能办理新冲突，请在受控新草案中处理');
  expected(header.current_revision, body.expected_handoff_revision, 'handoff');
  if (Number(revision.revision_no) !== Number(header.current_revision) || digest(parse(revision.snapshot_json)) !== revision.content_digest) throw fail('HANDOFF_CONTENT_INTEGRITY_CONFLICT', '草案固定正文或修订不一致');
  return parse(revision.snapshot_json);
}
function assertCurrent(conflict, header) {
  if (!conflict || conflict.handoff_id !== header.handoff_id || String(conflict.package_id) !== String(header.package_id)) throw fail('HANDOFF_CONFLICT_SCOPE_DENIED', '冲突不属于当前工作包草案', 403);
  if (!conflict.history_complete) throw fail('HANDOFF_CONFLICT_COMPATIBILITY_REVIEW_REQUIRED', '旧冲突缺少完整办理证明，须保留原记录并另行核验', 409,
    { compatibility: conflict.compatibility });
}
function recordResolution(value) {
  if (text(value)) return text(value);
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) return copy(value);
  throw fail('HANDOFF_CONFLICT_RESOLUTION_REQUIRED', '须记录明确处理结果', 422);
}
function validateSnapshot(snapshot, row) {
  return snapshot && snapshot.contract_version === CONTRACT && snapshot.conflict_id === row.conflict_id &&
    snapshot.handoff_id === row.handoff_id && String(snapshot.package_id) === String(row.package_id) &&
    KINDS.has(snapshot.kind) && STATES.has(snapshot.state) && Number.isSafeInteger(snapshot.revision_no) &&
    snapshot.revision_no > 0 && ['ordinary', 'major'].includes(snapshot.severity) &&
    Array.isArray(snapshot.subject_refs) && Array.isArray(snapshot.affected_department_ids) &&
    Array.isArray(snapshot.facts) && Array.isArray(snapshot.viewpoints) && Number.isSafeInteger(snapshot.round_no);
}
async function load(db, conflictId, { lock = true } = {}) {
  connection(db); uuid(conflictId);
  const row = await one(db, `SELECT *,CAST(package_id AS CHAR) package_id,CAST(assignee_person_id AS CHAR) assignee_person_id,
    CAST(decision_person_id AS CHAR) decision_person_id FROM data_map_handoff_conflicts WHERE conflict_id=? ${lock ? 'FOR UPDATE' : ''}`, [conflictId]);
  if (!row) throw fail('HANDOFF_CONFLICT_NOT_FOUND', '冲突记录不存在或不可见', 404);
  const [events] = await db.execute(`SELECT * FROM data_map_handoff_conflict_events WHERE conflict_id=? ORDER BY revision_no ${lock ? 'FOR SHARE' : ''}`, [conflictId]);
  let snapshot;
  try { snapshot = parse(row.payload_json); } catch { snapshot = null; }
  if (!events.length || !snapshot || snapshot.contract_version !== CONTRACT) return { ...row, payload_json: snapshot,
    snapshot, events, history_complete: false, compatibility: { code: 'HANDOFF_CONFLICT_LEGACY_HISTORY_INCOMPLETE',
      preserved: true, referenceable_as_verified: false, explanation: '保留旧观点、证据和结果；无完整追加事件不能证明已复核。' } };
  let previous = null;
  for (const event of events) {
    let payload, eventActor;
    try { payload = parse(event.payload_json); eventActor = parse(event.actor_json); } catch { throw fail('HANDOFF_CONFLICT_INTEGRITY_CONFLICT', '冲突历史正文损坏'); }
    const current = payload && payload.snapshot;
    if (!payload || !validateSnapshot(current, row) || Number(event.revision_no) !== (previous ? previous.revision_no + 1 : 1) ||
      current.revision_no !== Number(event.revision_no) || payload.contract_version !== CONTRACT || !text(payload.action) ||
      payload.snapshot_digest !== digest(current) || payload.previous_snapshot_digest !== (previous ? digest(previous) : null) ||
      payload.request_id !== event.request_id || !event.request_id || payload.actor_digest !== digest(eventActor) ||
      (previous && (current.kind !== previous.kind || digest(current.subject_refs) !== digest(previous.subject_refs) ||
        digest(current.affected_department_ids) !== digest(previous.affected_department_ids)))) throw fail('HANDOFF_CONFLICT_INTEGRITY_CONFLICT', '冲突事件、修订或摘要不一致');
    previous = current;
  }
  if (!previous || Number(row.revision_no) !== previous.revision_no || row.state !== previous.state || row.kind !== previous.kind ||
    (row.assignee_person_id || null) !== (previous.assignee_person_id || null) ||
    (row.decision_person_id || null) !== (previous.decision_person_id || null) || digest(snapshot) !== digest(previous)) throw fail('HANDOFF_CONFLICT_INTEGRITY_CONFLICT', '冲突投影与固定历史不一致');
  return { ...row, payload_json: snapshot, snapshot, events: events.map(event => ({ ...event, payload_json: parse(event.payload_json), actor_json: parse(event.actor_json) })),
    history_complete: true, compatibility: null };
}
async function append(db, previous, snapshot, action, actor, requestId, extra = {}) {
  uuid(requestId); const actorValue = actorSnapshot(actor);
  const next = copy({ ...snapshot, revision_no: previous ? previous.revision_no + 1 : 1 });
  const payload = { contract_version: CONTRACT, action, snapshot: next, snapshot_digest: digest(next),
    previous_snapshot_digest: previous ? digest(previous) : null, request_id: requestId, actor_digest: digest(actorValue), ...extra };
  if (previous) {
    const [result] = await db.execute(`UPDATE data_map_handoff_conflicts SET revision_no=?,state=?,kind=?,assignee_person_id=?,decision_person_id=?,payload_json=?
      WHERE conflict_id=? AND revision_no=?`, [next.revision_no, next.state, next.kind, next.assignee_person_id, next.decision_person_id, json(next), next.conflict_id, previous.revision_no]);
    if (result.affectedRows !== 1) throw fail('HANDOFF_CONFLICT_REVISION_CONFLICT', '冲突修订已变化');
  } else await db.execute(`INSERT INTO data_map_handoff_conflicts
    (conflict_id,handoff_id,package_id,revision_no,state,kind,assignee_person_id,decision_person_id,payload_json) VALUES(?,?,?,?,?,?,?,?,?)`,
  [next.conflict_id, next.handoff_id, next.package_id, next.revision_no, next.state, next.kind, next.assignee_person_id, next.decision_person_id, json(next)]);
  await db.execute(`INSERT INTO data_map_handoff_conflict_events(event_id,conflict_id,revision_no,payload_json,actor_json,request_id,created_at)
    VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3))`, [crypto.randomUUID(), next.conflict_id, next.revision_no, json(payload), json(actorValue), requestId]);
  return { conflict_id: next.conflict_id, handoff_id: next.handoff_id, package_id: next.package_id, revision: next.revision_no,
    state: next.state, conflict: next, business_outcome: 'conflict_saved', publication_id: null };
}
async function open(db, { header, revision, body, actor, requestId }) {
  connection(db); const draft = context(header, revision, body); expected(0, body.expected_revision);
  if (!KINDS.has(body.kind) || !['ordinary', 'major'].includes(body.severity)) throw fail('HANDOFF_CONFLICT_KIND_INVALID', '须明确冲突类别和严重程度', 422);
  const refs = body.subject_refs;
  if (!Array.isArray(refs) || !refs.length || refs.some(ref => !draft.items.some(item => item.item_ref === ref)) || new Set(refs).size !== refs.length) throw fail('HANDOFF_CONFLICT_SUBJECT_INVALID', '冲突须准确指向当前草案条目', 422);
  const affected = body.affected_department_ids;
  if (!Array.isArray(affected) || (!affected.length && body.kind !== 'version')) throw fail('HANDOFF_CONFLICT_DEPARTMENTS_REQUIRED', '须明确分别重核的相关部门', 422);
  const departments = [...new Set(affected.map(value => id(value)))].sort();
  for (const departmentId of departments) if (!await one(db, `SELECT CAST(id AS CHAR) id FROM departments WHERE id=? AND status='active' FOR SHARE`, [departmentId])) throw fail('HANDOFF_CONFLICT_DEPARTMENT_INVALID', '相关部门不存在或已停用', 422);
  if (!text(body.difference) || !Array.isArray(body.proposals) || !body.proposals.length || body.proposals.some(proposal =>
    !((typeof proposal === 'string' && text(proposal)) || (proposal && typeof proposal === 'object' && !Array.isArray(proposal) && Object.keys(proposal).length))) ||
    !(text(body.impact) || body.impact && typeof body.impact === 'object' && Object.keys(body.impact).length)) throw fail('HANDOFF_CONFLICT_DESCRIPTION_REQUIRED', '须列明差异、方案和影响', 422);
  const proof = basis(body), actorValue = actorSnapshot(actor);
  const snapshot = { contract_version: CONTRACT, conflict_id: crypto.randomUUID(), handoff_id: header.handoff_id,
    package_id: String(header.package_id), revision_no: 1, state: 'open', kind: body.kind, severity: body.severity,
    subject_refs: copy(refs), affected_department_ids: departments, difference: text(body.difference), proposals: copy(body.proposals),
    impact: copy(body.impact), ...proof, assignee_person_id: null, decision_person_id: null, viewpoints: [], assignments: [], escalations: [],
    round_no: 1, round_id: crypto.randomUUID(), resolution: null, resolution_digest: null, verification: null, facts: [],
    opened_handoff_revision_id: revision.revision_id, opened_content_digest: revision.content_digest, opened_by: actorValue };
  return append(db, null, snapshot, 'open', actor, requestId);
}
async function act(db, { header, revision, conflict, body, actor, requestId }) {
  connection(db); context(header, revision, body, { verification: body.action === 'verify' }); assertCurrent(conflict, header); expected(conflict.revision_no, body.expected_revision);
  const before = conflict.snapshot, next = copy(before), proof = basis(body), actorValue = actorSnapshot(actor), action = body.action;
  if (action === 'viewpoint') {
    if (!['open', 'escalated'].includes(next.state) || !text(body.viewpoint)) throw fail('HANDOFF_CONFLICT_VIEWPOINT_INVALID', '当前冲突须先重新打开后补充观点');
    next.viewpoints.push({ viewpoint_id: crypto.randomUUID(), viewpoint: text(body.viewpoint), ...proof, actor: actorValue, request_id: requestId, round_id: next.round_id });
  } else if (action === 'assign') {
    if (!['open', 'escalated'].includes(next.state)) throw fail('HANDOFF_CONFLICT_STATE_CONFLICT', '当前状态不能重新分派');
    const personId = id(body.assignee_person_id);
    next.assignments.push({ previous_person_id: next.assignee_person_id, person_id: personId, ...proof, actor: actorValue, request_id: requestId, round_id: next.round_id });
    next.assignee_person_id = personId;
  } else if (action === 'escalate') {
    if (!['open', 'escalated'].includes(next.state)) throw fail('HANDOFF_CONFLICT_STATE_CONFLICT', '当前状态不能升级');
    const personId = id(body.decision_person_id);
    next.state = 'escalated'; next.decision_person_id = personId;
    if (body.severity !== undefined && !['ordinary', 'major'].includes(body.severity)) throw fail('HANDOFF_CONFLICT_KIND_INVALID', '严重程度无效', 422);
    if (body.severity === 'major') next.severity = 'major';
    next.escalations.push({ decision_person_id: personId, severity: next.severity, ...proof, actor: actorValue, request_id: requestId, round_id: next.round_id });
  } else if (action === 'resolve' || action === 'decide') {
    if (action === 'resolve' && (next.state !== 'open' || next.severity === 'major') || action === 'decide' && (next.state !== 'escalated' || !next.decision_person_id || next.decision_person_id !== actorValue.person_id)) throw fail('HANDOFF_CONFLICT_ESCALATION_REQUIRED', '重大或已升级冲突须由明确分派的项目决策组成员作决定');
    const pendingEvidence = [];
    for (const ref of next.facts.filter(item => item.round_id === next.round_id && item.resolution_digest === null)) {
      const fact = await loadFact(db, ref.fact_id);
      if(fact.snapshot.binding_id!==revision.binding_id)pendingEvidence.push('FACT_EVIDENCE_SOURCE_CHANGED:'+ref.fact_id);
      else if (fact.fact_version_id !== ref.fact_version_id || fact.snapshot_digest !== ref.snapshot_digest || fact.snapshot.status !== 'closed') pendingEvidence.push('FACT_EVIDENCE_NOT_CLOSED:' + ref.fact_id);
      else { const issue = await confirmationIssue(db, fact); if (issue) pendingEvidence.push(issue); }
    }
    if (pendingEvidence.length) throw fail('HANDOFF_CONFLICT_EVIDENCE_PENDING', '已提出的定向补证须经相关部门确认并关闭后再形成处理结果', 409, { issues: pendingEvidence });
    next.state = 'resolved'; next.verification = null;
    next.resolution = { outcome: recordResolution(body.resolution), ...proof, actor: actorValue, request_id: requestId,
      round_id: next.round_id, decision_kind: action, resolution_id: crypto.randomUUID(), decided_binding_id:revision.binding_id,decided_content_digest: revision.content_digest };
    next.resolution_digest = digest(next.resolution);
  } else if (action === 'reopen') {
    next.state = 'open'; next.round_no += 1; next.round_id = crypto.randomUUID(); next.resolution = null; next.resolution_digest = null; next.verification = null;
    next.decision_person_id = null; next.reopen = { ...proof, actor: actorValue, request_id: requestId };
  } else if (action === 'verify') {
    if (next.state !== 'resolved' || !next.resolution || next.resolution_digest !== digest(next.resolution)) throw fail('HANDOFF_CONFLICT_RESOLUTION_REQUIRED', '须先形成明确协调或决定结果');
    if(next.resolution.decided_binding_id!==revision.binding_id)throw fail('HANDOFF_CONFLICT_SOURCE_RECHECK_REQUIRED','审核依据已变化，须重新核对冲突及受影响事实');
    const facts = await verificationFacts(db, conflict, { lock: true, notApplicable: body.fact_recheck });
    if (facts.issues.length) throw fail('HANDOFF_CONFLICT_FACT_RECHECK_REQUIRED', '须先完成当前结果下各相关部门的独立事实重核', 409, { issues: facts.issues });
    next.state = 'verified'; next.verification = { ...proof, actor: actorValue, request_id: requestId, round_id: next.round_id,
      resolution_digest: next.resolution_digest,binding_id:revision.binding_id, handoff_revision_id: revision.revision_id, content_digest: revision.content_digest,
      subject_digest: subjectDigest(parse(revision.snapshot_json), next.subject_refs), fact_versions: facts.fact_versions,
      fact_recheck: facts.not_applicable || null };
  } else throw fail('HANDOFF_CONFLICT_ACTION_INVALID', '冲突办理动作无效', 422);
  return append(db, before, next, action, actor, requestId);
}
function subjectDigest(draft, refs) {
  return digest(refs.map(ref => draft.items.find(item => item.item_ref === ref) || { missing_item_ref: ref }));
}
async function loadFact(db, factId, { lock = true } = {}) {
  connection(db); uuid(factId);
  const [versions] = await db.execute(`SELECT *,CAST(package_id AS CHAR) package_id FROM process_data_governance_fact_versions WHERE fact_id=? ORDER BY revision_no ${lock ? 'FOR SHARE' : ''}`, [factId]);
  if (!versions.length) throw fail('HANDOFF_FACT_NOT_FOUND', '事实问题不存在或不可见', 404);
  let first = null, latest = null;
  for (const row of versions) {
    let snapshot;
    try { snapshot = parse(row.snapshot_json); } catch { throw fail('HANDOFF_FACT_SNAPSHOT_DRIFT', '事实固定正文损坏'); }
    if (!snapshot || !snapshot.requested_by || !['open', 'answered', 'confirmed', 'closed'].includes(snapshot.status) ||
      !['evidence', 'result_recheck'].includes(snapshot.phase) || !text(snapshot.question_text) || !text(snapshot.requested_fact_type) || !text(snapshot.request_reason) ||
      !Array.isArray(snapshot.evidence_refs) || !snapshot.evidence_refs.length || !snapshot.conflict_id || !snapshot.round_id || !snapshot.detail_ref ||
      (snapshot.status !== 'open' && (!text(snapshot.answer_text) || !snapshot.answered_by)) ||
      row.correction_id || row.intake_id || snapshot.parent_kind !== 'handoff_conflict' || snapshot.fact_id !== factId ||
      String(snapshot.package_id) !== String(row.package_id) || digest(snapshot) !== row.snapshot_digest || Number(row.revision_no) !== (latest ? Number(latest.revision_no) + 1 : 1) ||
      first && (snapshot.conflict_id !== first.conflict_id || snapshot.round_id !== first.round_id || snapshot.resolution_digest !== first.resolution_digest ||
        snapshot.target_department_id !== first.target_department_id || snapshot.detail_ref !== first.detail_ref ||
        snapshot.handoff_id !== first.handoff_id || snapshot.phase !== first.phase || snapshot.question_text !== first.question_text || snapshot.requested_fact_type !== first.requested_fact_type ||
        snapshot.request_reason !== first.request_reason || digest(snapshot.requested_by) !== digest(first.requested_by))) throw fail('HANDOFF_FACT_SNAPSHOT_DRIFT', '事实来源、修订或摘要不一致');
    const previous = latest?.snapshot;
    if ((!previous && snapshot.status !== 'open') || previous &&
      ({ open: 'answered', answered: 'confirmed', confirmed: 'closed' }[previous.status] !== snapshot.status ||
        snapshot.status === 'answered' && (!text(snapshot.answer_text) || !snapshot.answered_by || !Array.isArray(snapshot.evidence_refs) || !snapshot.evidence_refs.length) ||
        ['confirmed', 'closed'].includes(snapshot.status) && (snapshot.answer_text !== previous.answer_text || digest(snapshot.answered_by) !== digest(previous.answered_by) || digest(snapshot.evidence_refs) !== digest(previous.evidence_refs)) ||
        snapshot.status === 'confirmed' && (snapshot.confirmed_answer_version_id !== latest.fact_version_id || snapshot.confirmed_answer_digest !== latest.snapshot_digest || !snapshot.confirmed_by || !snapshot.confirmed_department_appointment) ||
        snapshot.status === 'closed' && (digest(snapshot.confirmed_by) !== digest(previous.confirmed_by) || digest(snapshot.confirmed_department_appointment) !== digest(previous.confirmed_department_appointment) ||
          snapshot.confirmed_answer_version_id !== previous.confirmed_answer_version_id || snapshot.confirmed_answer_digest !== previous.confirmed_answer_digest || !snapshot.closed_by))) throw fail('HANDOFF_FACT_SNAPSHOT_DRIFT', '事实状态变更或确认绑定不一致');
    if (!first) first = snapshot;
    latest = { ...row, snapshot, snapshot_json: snapshot, revision_no: Number(row.revision_no) };
  }
  // A correctly hashed inserted row is not sufficient proof of an authorized
  // fact action: each immutable version must also have its conflict event.
  const [events] = await db.execute(`SELECT payload_json,actor_json,request_id FROM data_map_handoff_conflict_events WHERE conflict_id=? ORDER BY revision_no ${lock ? 'FOR SHARE' : ''}`, [first.conflict_id]);
  for (const row of versions) {
    const found = events.some(event => {
      const payload = parse(event.payload_json), reference = payload && payload.fact_version;
      return payload && payload.contract_version === CONTRACT && text(payload.action) === ({ open: 'fact_open', answered: 'fact_answer', confirmed: 'fact_confirm', closed: 'fact_close' }[parse(row.snapshot_json).status]) && event.request_id === row.request_id &&
        payload.request_id === row.request_id && payload.actor_digest === digest(parse(event.actor_json)) && digest(parse(event.actor_json)) === digest(parse(row.actor_json)) &&
        reference && reference.fact_id === factId && reference.fact_version_id === row.fact_version_id && reference.snapshot_digest === row.snapshot_digest &&
        payload.snapshot && Array.isArray(payload.snapshot.facts) && payload.snapshot_digest === digest(payload.snapshot) && payload.snapshot.facts.some(item => item.fact_version_id === row.fact_version_id && item.snapshot_digest === row.snapshot_digest);
    });
    if (!found) throw fail('HANDOFF_FACT_EVENT_MISSING', '事实版本缺少对应的冲突办理事件');
  }
  return latest;
}
function factContext(header, revision, conflict, body, fact = null) {
  const draft = context(header, revision, body); assertCurrent(conflict, header);
  expected(conflict.revision_no, body.expected_conflict_revision);
  const snapshot = conflict.snapshot;
  if(snapshot.resolution&&snapshot.resolution.decided_binding_id!==revision.binding_id||fact&&fact.snapshot.binding_id!==revision.binding_id)throw fail('HANDOFF_CONFLICT_SOURCE_RECHECK_REQUIRED','审核依据已变化，须重新核对冲突及受影响事实');
  const afterResolution = ['resolved', 'verified'].includes(snapshot.state);
  if (!['open', 'escalated', 'resolved', 'verified'].includes(snapshot.state) || afterResolution && (!snapshot.resolution || snapshot.resolution_digest !== digest(snapshot.resolution))) throw fail('HANDOFF_CONFLICT_RESOLUTION_REQUIRED', '当前冲突结果不完整，不能办理事实');
  const resolutionDigest = afterResolution ? snapshot.resolution_digest : null;
  if (fact && (fact.snapshot.conflict_id !== conflict.conflict_id || fact.snapshot.round_id !== snapshot.round_id || fact.snapshot.resolution_digest !== resolutionDigest)) throw fail('HANDOFF_FACT_ROUND_STALE', '旧轮次或旧结果的事实不能用于当前重核');
  return draft;
}
async function writeFact(db, { conflict, snapshot, revisionNo, actor, requestId, action }) {
  const factVersionId = crypto.randomUUID(), snapshotDigest = digest(snapshot), actorValue = actorSnapshot(actor);
  await db.execute(`INSERT INTO process_data_governance_fact_versions(fact_version_id,fact_id,package_id,correction_id,intake_id,revision_no,snapshot_json,snapshot_digest,actor_json,request_id)
    VALUES(?,?,?,NULL,NULL,?,?,?,?,?)`, [factVersionId, snapshot.fact_id, snapshot.package_id, revisionNo, json(snapshot), snapshotDigest, json(actorValue), requestId]);
  const next = copy(conflict.snapshot), reference = { fact_id: snapshot.fact_id, fact_version_id: factVersionId, revision_no: revisionNo,
    snapshot_digest: snapshotDigest, target_department_id: snapshot.target_department_id, detail_ref: snapshot.detail_ref,
    status: snapshot.status, round_id: snapshot.round_id, resolution_digest: snapshot.resolution_digest };
  next.facts = next.facts.filter(fact => fact.fact_id !== snapshot.fact_id).concat(reference);
  if (next.state === 'verified') next.state = 'resolved';
  next.verification = null;
  const result = await append(db, conflict.snapshot, next, action, actor, requestId, { fact_version: reference });
  // Department writes and their durable replay receipts carry only the directed
  // fact result. Full conflict evidence requires the separate conflict reader.
  return { conflict_id:result.conflict_id,handoff_id:result.handoff_id,package_id:result.package_id,state:result.state,publication_id:null,
    fact_id: snapshot.fact_id, fact_version_id: factVersionId, revision: revisionNo,
    conflict_revision: result.revision, status: snapshot.status, business_outcome: 'conflict_fact_saved' };
}
async function openFact(db, { header, revision, conflict, body, actor, requestId }) {
  connection(db); const draft = factContext(header, revision, conflict, body); expected(0, body.expected_revision, 'fact');
  const target = id(body.target_department_id), detailRef = text(body.detail_ref), current = conflict.snapshot;
  if (!current.affected_department_ids.includes(target) || !detailRef || !current.subject_refs.some(ref =>
    draft.items.find(item => item.item_ref === ref)?.source_detail_refs.includes(detailRef))) throw fail('HANDOFF_FACT_SCOPE_DENIED', '事实问题须指向冲突相关部门及其准确来源明细', 422);
  if (!text(body.requested_fact_type) || !text(body.question_text) || !text(body.request_reason)) throw fail('HANDOFF_FACT_INCOMPLETE', '须填写事实类型、明确问题和提出原因', 422);
  const department = await one(db, "SELECT CAST(id AS CHAR) id FROM departments WHERE id=? AND status='active' FOR SHARE", [target]);
  if (!department) throw fail('HANDOFF_FACT_TARGET_INVALID', '事实目标部门已停用或不存在', 422);
  const snapshot = { contract_version: CONTRACT, parent_kind: 'handoff_conflict', fact_id: crypto.randomUUID(),
    conflict_id: conflict.conflict_id, handoff_id: header.handoff_id, package_id: String(header.package_id),
    round_id: current.round_id, resolution_digest: current.resolution ? current.resolution_digest : null,
    binding_id:revision.binding_id,phase: current.resolution ? 'result_recheck' : 'evidence', detail_ref: detailRef, target_department_id: target,
    requested_fact_type: text(body.requested_fact_type), question_text: text(body.question_text), request_reason: text(body.request_reason),
    status: 'open', evidence_refs: evidence(body.evidence_refs), requested_by: actorSnapshot(actor) };
  return writeFact(db, { conflict, snapshot, revisionNo: 1, actor, requestId, action: 'fact_open' });
}
async function answerFact(db, { header, revision, conflict, fact, body, actor, requestId }) {
  connection(db); factContext(header, revision, conflict, body, fact); expected(fact.revision_no, body.expected_revision, 'fact');
  if (fact.snapshot.status !== 'open') throw fail('HANDOFF_FACT_NOT_OPEN', '事实问题当前不能答复');
  if (String(actor.departmentId) !== fact.snapshot.target_department_id || !text(body.answer_text)) throw fail('HANDOFF_FACT_DEPARTMENT_DENIED', '须由目标部门填写明确事实答复', 403);
  const snapshot = { ...fact.snapshot, status: 'answered', answer_text: text(body.answer_text), evidence_refs: evidence(body.evidence_refs), answered_by: actorSnapshot(actor) };
  return writeFact(db, { conflict, snapshot, revisionNo: fact.revision_no + 1, actor, requestId, action: 'fact_answer' });
}
async function departmentConfirmation(db, departmentId, { lock = true } = {}) {
  const department = await one(db, `SELECT status,CAST(final_responsible_person_id AS CHAR) final_responsible_person_id FROM departments WHERE id=? ${lock ? 'FOR SHARE' : ''}`, [departmentId]);
  const appointment = await require('./departmentAccountability').readDepartmentAppointment(db, departmentId, { lock });
  return { active: department?.status === 'active', final_responsible_person_id: department?.final_responsible_person_id || null,
    appointment_event_id: appointment.appointment_event_id };
}
async function confirmFact(db, { header, revision, conflict, fact, body, actor, requestId }) {
  connection(db); factContext(header, revision, conflict, body, fact); expected(fact.revision_no, body.expected_revision, 'fact');
  if (fact.snapshot.status !== 'answered' || body.answered_fact_version_id !== fact.fact_version_id || body.answered_snapshot_digest !== fact.snapshot_digest) throw fail('HANDOFF_FACT_ANSWER_CHANGED', '须核对当前准确答复版本及摘要后确认');
  const current = await departmentConfirmation(db, fact.snapshot.target_department_id);
  if (!current.active || current.final_responsible_person_id !== String(actor.personId) || String(actor.departmentId) !== fact.snapshot.target_department_id) throw fail('HANDOFF_FACT_FINAL_RESPONSIBLE_REQUIRED', '须由当前登记的本部门最终负责人本人确认', 403);
  const proof = basis(body), snapshot = { ...fact.snapshot, status: 'confirmed', confirmed_answer_version_id: fact.fact_version_id,
    confirmed_answer_digest: fact.snapshot_digest, confirmation_basis: proof.basis, confirmation_evidence_refs: proof.evidence_refs,
    confirmed_by: actorSnapshot(actor), confirmed_department_appointment: current };
  return writeFact(db, { conflict, snapshot, revisionNo: fact.revision_no + 1, actor, requestId, action: 'fact_confirm' });
}
async function closeFact(db, { header, revision, conflict, fact, body, actor, requestId }) {
  connection(db); factContext(header, revision, conflict, body, fact); expected(fact.revision_no, body.expected_revision, 'fact');
  if (fact.snapshot.status !== 'confirmed') throw fail('HANDOFF_FACT_NOT_CONFIRMED', '普通答复不能视作最终确认，须负责人确认后关闭');
  const proof = basis(body), issue = await confirmationIssue(db, fact);
  if (issue) throw fail('HANDOFF_FACT_CONFIRMATION_STALE', '当前部门确认资格或负责人登记已变化，须重新核对', 409, { issue });
  const snapshot = { ...fact.snapshot, status: 'closed', close_basis: proof.basis, closure_evidence_refs: proof.evidence_refs, closed_by: actorSnapshot(actor) };
  return writeFact(db, { conflict, snapshot, revisionNo: fact.revision_no + 1, actor, requestId, action: 'fact_close' });
}
async function confirmationIssue(db, fact, { lock = true } = {}) {
  const snapshot = fact.snapshot, confirmed = snapshot.confirmed_by;
  if (!confirmed?.qualification || !snapshot.confirmed_department_appointment || !snapshot.confirmed_answer_version_id || !snapshot.confirmed_answer_digest) return 'FACT_FINAL_CONFIRMATION_MISSING:' + snapshot.fact_id;
  const current = await departmentConfirmation(db, snapshot.target_department_id, { lock });
  if (!current.active || digest(current) !== digest(snapshot.confirmed_department_appointment) || current.final_responsible_person_id !== confirmed.person_id) return 'FACT_DEPARTMENT_CONFIRMATION_CHANGED:' + snapshot.fact_id;
  try {
    const actor = await require('./dataMapHandoffAuthority').handoffActor(db,
      { personId: confirmed.person_id, accountId: confirmed.account_id, authVersion: confirmed.auth_version }, 'fact_confirm',
      { packageId: snapshot.package_id, departmentId: snapshot.target_department_id, factRequestId: snapshot.fact_id, factKind: 'handoff_conflict', lock, writeFields: [] });
    if (actor.qualificationSnapshot.qualification_digest !== confirmed.qualification.qualification_digest) return 'FACT_CONFIRMATION_AUTHORITY_CHANGED:' + snapshot.fact_id;
  } catch (error) {
    if (['HANDOFF_AUTHORITY_SCHEMA_REQUIRED', 'HANDOFF_ACCESS_MODEL_UNSUPPORTED'].includes(error.code)) throw error;
    return 'FACT_CONFIRMATION_AUTHORITY_CHANGED:' + snapshot.fact_id;
  }
  return null;
}
async function verificationFacts(db, conflict, { lock = true, notApplicable = null } = {}) {
  const snapshot = conflict.snapshot, issues = [], selected = [];
  const currentRefs = snapshot.facts.filter(fact => fact.round_id === snapshot.round_id && fact.resolution_digest === snapshot.resolution_digest);
  if (!snapshot.affected_department_ids.length || notApplicable?.not_applicable === true) {
    if (snapshot.kind !== 'version' || !notApplicable || notApplicable.not_applicable !== true || currentRefs.length || !text(notApplicable.basis)) return { issues: ['FACT_RECHECK_NOT_APPLICABLE_INVALID'], fact_versions: [] };
    return { issues: [], fact_versions: [], not_applicable: { not_applicable: true, basis: text(notApplicable.basis), evidence_refs: evidence(notApplicable.evidence_refs) } };
  }
  for (const departmentId of snapshot.affected_department_ids) {
    const refs = currentRefs.filter(fact => fact.target_department_id === departmentId);
    if (!refs.length) { issues.push('FACT_DEPARTMENT_RECHECK_MISSING:' + departmentId); continue; }
    for (const ref of refs) {
      const fact = await loadFact(db, ref.fact_id, { lock });
      if (fact.fact_version_id !== ref.fact_version_id || fact.snapshot_digest !== ref.snapshot_digest || fact.snapshot.status !== 'closed' || fact.snapshot.round_id !== snapshot.round_id || fact.snapshot.resolution_digest !== snapshot.resolution_digest) {
        issues.push('FACT_RECHECK_NOT_CLOSED:' + ref.fact_id); continue;
      }
      const issue = await confirmationIssue(db, fact, { lock });
      if (issue) issues.push(issue);
      selected.push({ fact_id: fact.fact_id, fact_version_id: fact.fact_version_id, revision_no: Number(fact.revision_no), snapshot_digest: fact.snapshot_digest,
        department_id: departmentId, confirmed_answer_version_id: fact.snapshot.confirmed_answer_version_id, confirmed_answer_digest: fact.snapshot.confirmed_answer_digest,
        confirmed_department_appointment: fact.snapshot.confirmed_department_appointment });
    }
  }
  return { issues, fact_versions: selected.sort((a, b) => a.fact_id.localeCompare(b.fact_id)) };
}
async function inspectVerification(db, conflict, revision, { lock = true } = {}) {
  connection(db);
  if (!conflict?.history_complete) return { valid: false, issues: ['CONFLICT_LEGACY_HISTORY_INCOMPLETE'], compatibility: conflict?.compatibility || null };
  const snapshot = conflict.snapshot, verification = snapshot.verification, issues = [];
  if (snapshot.state !== 'verified' || !verification || !snapshot.resolution || snapshot.resolution_digest !== digest(snapshot.resolution)) return { valid: false, issues: ['CONFLICT_NOT_VERIFIED'] };
  if (!revision || verification.binding_id!==revision.binding_id||snapshot.resolution.decided_binding_id!==revision.binding_id||revision.content_digest !== digest(parse(revision.snapshot_json)) || verification.content_digest !== revision.content_digest ||
    verification.subject_digest !== subjectDigest(parse(revision.snapshot_json), snapshot.subject_refs) || verification.round_id !== snapshot.round_id ||
    verification.resolution_digest !== snapshot.resolution_digest) issues.push('CONFLICT_VERIFICATION_STALE');
  const facts = await verificationFacts(db, conflict, { lock, notApplicable: verification.fact_recheck });
  issues.push(...facts.issues);
  if (digest(facts.fact_versions) !== digest(verification.fact_versions)) issues.push('CONFLICT_FACT_VERIFICATION_STALE');
  return { valid: !issues.length, issues, fact_versions: facts.fact_versions, verification };
}
module.exports = { CONTRACT, load, open, act, loadFact, openFact, answerFact, confirmFact, closeFact, inspectVerification };
