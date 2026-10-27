// Native mutable projections and their immutable versions share the caller's
// transaction. This module opens no connection, commits no data and runs no DDL.
const crypto = require('node:crypto');
const { digest, json, parse, id, failure } = require('./dataMapHandoffPolicy');
const one = async (db, sql, args = []) => (await db.execute(sql, args))[0][0] || null;
const normalized = value => JSON.parse(JSON.stringify(value));
function actorSnapshot(actor, completeness) {
  return { person_id: id(actor.personId), account_id: id(actor.accountId), auth_version: id(actor.authVersion),
    role_code: actor.roleCode, role_codes: [...(actor.roleCodes || [])].sort(), qualification: actor.qualificationSnapshot || null,
    recorded_as: ['append_only_since_native_write','native_created_append_only'].includes(completeness)
      ? 'current_write_actor' : 'capturing_actor_not_original_historical_author' };
}
function detailSnapshot(detail) {
  return { detail_id: id(detail.id), detail_ref: detail.detail_ref, detail_type: detail.detail_type,
    source_ref: detail.source_ref, parent_source_ref: detail.parent_source_ref,
    responsible_department_id: detail.responsible_department_id == null ? null : id(detail.responsible_department_id),
    source_digest: detail.source_snapshot_digest, status: detail.status,
    candidate: parse(detail.candidate_json), governance: parse(detail.governance_json) };
}
function projectionMetadata(detail) {
  return normalized({ work_package_id:id(detail.work_package_id),
    created_by_person_id:detail.created_by_person_id==null?null:id(detail.created_by_person_id),
    updated_by_person_id:detail.updated_by_person_id==null?null:id(detail.updated_by_person_id),
    created_at:detail.created_at,updated_at:detail.updated_at,candidate_rule_code:detail.candidate_rule_code,
    high_risk:detail.high_risk,observed_as:'existing_projection_values_not_reconstructed_history' });
}
async function captureDetail(db, detail, actor, requestId, completeness, before = null) {
  const snapshot = detailSnapshot(detail), revision = Number(detail.revision_no);
  const old = await one(db, 'SELECT * FROM process_data_governance_detail_versions WHERE detail_id=CAST(? AS SIGNED) AND revision_no=? FOR SHARE', [snapshot.detail_id, revision]);
  if (old) {
    if (old.snapshot_digest !== digest(snapshot) || digest(parse(old.snapshot_json)) !== old.snapshot_digest) throw failure('HANDOFF_LEGACY_SNAPSHOT_DRIFT');
    return { ...snapshot, detail_version_id: old.detail_version_id, revision_no: revision };
  }
  const versionId = crypto.randomUUID();
  const audit={...actorSnapshot(actor,completeness),original_projection_metadata:projectionMetadata(detail),
    ...(before?{previous_projection_metadata:projectionMetadata(before)}:{})};
  await db.execute(`INSERT INTO process_data_governance_detail_versions
    (detail_version_id,detail_id,revision_no,snapshot_json,snapshot_digest,source_digest,actor_json,history_completeness,request_id)
    VALUES (?,?,?,?,?,?,?,?,?)`, [versionId, snapshot.detail_id, revision, json(snapshot), digest(snapshot), snapshot.source_digest,
    json(audit), completeness, requestId]);
  return { ...snapshot, detail_version_id: versionId, revision_no: revision };
}
async function detail(db, detailId, packageId) {
  return one(db, `SELECT d.*,CAST(d.id AS CHAR) id,CAST(d.work_package_id AS CHAR) work_package_id,
    CAST(d.responsible_department_id AS CHAR) responsible_department_id,CAST(d.created_by_person_id AS CHAR) created_by_person_id,
    CAST(d.updated_by_person_id AS CHAR) updated_by_person_id FROM process_data_governance_details d
    WHERE d.id=CAST(? AS SIGNED) AND d.work_package_id=CAST(? AS SIGNED) FOR UPDATE`, [id(detailId), id(packageId)]);
}
async function fact(db, factId, lock = true) {
  return one(db, `SELECT f.*,CAST(f.id AS CHAR) id,CAST(f.work_package_id AS CHAR) work_package_id,
    CAST(f.detail_id AS CHAR) detail_id,CAST(f.target_department_id AS CHAR) target_department_id,
    CAST(f.requested_by_person_id AS CHAR) requested_by_person_id,CAST(f.answered_by_person_id AS CHAR) answered_by_person_id,
    CAST(f.closed_by_person_id AS CHAR) closed_by_person_id FROM process_data_governance_fact_requests f
    WHERE f.id=CAST(? AS SIGNED) ${lock ? 'FOR UPDATE' : ''}`, [id(factId)]);
}
function factSnapshot(row) {
  return normalized({ fact_id: id(row.id), native_fact_request_id: id(row.id), package_id: id(row.work_package_id),
    detail_id: id(row.detail_id), target_department_id: id(row.target_department_id), request_ref: row.request_ref,
    requested_fact_type: row.requested_fact_type, question_text: row.question_text, request_reason: row.request_reason,
    status: row.status, answer_text: row.answer_text, evidence_ref: row.evidence_ref,
    requested_by_person_id: row.requested_by_person_id == null ? null : id(row.requested_by_person_id),
    answered_by_person_id: row.answered_by_person_id == null ? null : id(row.answered_by_person_id),
    closed_by_person_id: row.closed_by_person_id == null ? null : id(row.closed_by_person_id),
    created_at: row.created_at, answered_at: row.answered_at, closed_at: row.closed_at, updated_at: row.updated_at });
}
async function captureFact(db, row, actor, requestId, completeness, extra = {}) {
  const snapshot = factSnapshot(row);
  const old = await one(db, 'SELECT f.*,CAST(f.package_id AS CHAR) package_id FROM process_data_governance_fact_versions f WHERE fact_id=? ORDER BY revision_no DESC LIMIT 1 FOR SHARE', [snapshot.fact_id]);
  if (old) {
    const original = parse(old.snapshot_json);
    if (digest(original) !== old.snapshot_digest || old.correction_id || old.intake_id || String(old.package_id) !== snapshot.package_id) throw failure('HANDOFF_LEGACY_SNAPSHOT_DRIFT');
    const core = Object.fromEntries(Object.keys(snapshot).map(key => [key, original[key]]));
    if (digest(core) === digest(snapshot)) return { ...original, fact_version_id: old.fact_version_id, revision_no: Number(old.revision_no) };
    // Before snapshots must agree with the last captured projection. Differences
    // here are a bypass, not a new authorized historical correction.
    if (completeness === 'captured_current_only') throw failure('HANDOFF_LEGACY_SNAPSHOT_DRIFT');
  }
  const versionId = crypto.randomUUID(), revision = old ? Number(old.revision_no) + 1 : 1;
  const full = { ...snapshot, history_completeness: completeness, ...extra };
  await db.execute(`INSERT INTO process_data_governance_fact_versions
    (fact_version_id,fact_id,package_id,correction_id,intake_id,revision_no,snapshot_json,snapshot_digest,actor_json,request_id)
    VALUES (?,?,?,NULL,NULL,?,?,?,?,?)`, [versionId, snapshot.fact_id, snapshot.package_id, revision, json(full), digest(full), json(actorSnapshot(actor,completeness)), requestId]);
  return { ...full, fact_version_id: versionId, revision_no: revision };
}
function fields(value, prefix = '', result = new Set()) {
  if (prefix) result.add(prefix);
  if (Array.isArray(value)) value.forEach((item, index) => fields(item, `${prefix}[${index}]`, result));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { result.add(key); fields(item, prefix ? prefix + '.' + key : key, result); }
  return result;
}
module.exports = { captureDetail, captureFact, detail, fact, factSnapshot, fields };
