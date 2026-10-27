// Reads immutable decision events and current department authority. Historical opinions
// remain visible; only a currently qualified personal confirmation clears a live gate.
const { inspectCurrentDepartmentDecision } = require('./departmentAccountability');
const { sameIdentityInteger } = require('./sessionSubject');

function json(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || 'null'); } catch { return null; }
}
async function one(db, sql, params) { const [rows] = await db.execute(sql, params); return rows[0] || null; }
function missing(reason = 'DEPARTMENT_CONFIRMATION_REQUIRED') { return { valid: false, reason }; }

async function inspectFormalDepartmentDecision(db, draft, task, options = {}) {
  if (!draft || !task || task.status !== 'approved' || Number(task.draft_id) !== Number(draft.id) ||
    Number(task.draft_revision_no) !== Number(draft.revision_no) || task.content_hash !== draft.content_hash) return missing();
  const event = await one(db, `SELECT e.*, CAST(e.actor_user_id AS CHAR) AS actor_user_id
    FROM process_design_events e WHERE e.draft_id=? AND e.event_type='review_approve'
    AND JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(e.payload_json),e.payload_json,JSON_OBJECT()),'$.review_task_id'))=?
    ORDER BY e.id DESC LIMIT 1${options.lock ? ' FOR SHARE' : ''}`, [draft.id, String(task.id)]);
  const payload = json(event && event.payload_json);
  const evidence = payload && payload.department_accountability;
  if (!evidence || !sameIdentityInteger(event.actor_user_id, task.decided_by) ||
    !sameIdentityInteger(evidence.confirmed_by_person_id, task.decided_by)) return missing();
  return inspectCurrentDepartmentDecision(db, draft.department_id, evidence, {
    sourceRevision: Number(draft.revision_no), sourceHash: draft.content_hash, lock: Boolean(options.lock)
  });
}

async function inspectItemParty(db, item, party, options = {}) {
  if (item[party + '_status'] !== 'confirmed') return missing('DEPARTMENT_REVIEW_INCOMPLETE');
  const departmentId = party === 'origin' ? item.origin_department_id : item.target_department_id;
  const visited = new Set();
  let source = item;
  // A carried result can retain its confirmation only through the existing exact
  // item-digest chain. It never inherits authority from a changed item or person.
  while (source && !visited.has(String(source.id))) {
    visited.add(String(source.id));
    if (Number(source.case_id) !== Number(item.case_id) || source.stable_item_key !== item.stable_item_key ||
      source.item_digest !== item.item_digest || source[party + '_status'] !== item[party + '_status'] ||
      !sameIdentityInteger(source[party + '_decided_by_person_id'], item[party + '_decided_by_person_id']) ||
      !sameIdentityInteger(party === 'origin' ? source.origin_department_id : source.target_department_id, departmentId)) return missing();
    const event = await one(db, `SELECT e.*, CAST(e.actor_person_id AS CHAR) AS actor_person_id
      FROM process_v7_preview_events e WHERE e.case_id=? AND e.item_id=? AND e.event_type='department_review_decision_recorded'
      AND JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(e.payload_json),e.payload_json,JSON_OBJECT()),'$.party'))=?
      ORDER BY e.id DESC LIMIT 1${options.lock ? ' FOR SHARE' : ''}`, [item.case_id, source.id, party]);
    if (event) {
      const payload = json(event.payload_json);
      const evidence = payload && payload.department_accountability;
      if (event.decision !== 'confirmed' || Number(event.revision_id) !== Number(source.revision_id) || !evidence ||
        !sameIdentityInteger(event.actor_person_id, source[party + '_decided_by_person_id']) ||
        !sameIdentityInteger(evidence.confirmed_by_person_id, event.actor_person_id)) return missing();
      return inspectCurrentDepartmentDecision(db, departmentId, evidence, {
        sourceRevision: Number(source.revision_no), sourceHash: source.item_digest, lock: Boolean(options.lock)
      });
    }
    if (source.carry_state !== 'carried_forward' || !source.carried_from_item_id) return missing();
    source = await one(db, `SELECT i.*, CAST(i.origin_department_id AS CHAR) AS origin_department_id,
      CAST(i.target_department_id AS CHAR) AS target_department_id,
      CAST(i.origin_decided_by_person_id AS CHAR) AS origin_decided_by_person_id,
      CAST(i.counterparty_decided_by_person_id AS CHAR) AS counterparty_decided_by_person_id
      FROM process_v7_preview_review_items i WHERE i.id=?${options.lock ? ' FOR SHARE' : ''}`, [source.carried_from_item_id]);
  }
  return missing();
}

async function inspectPreviewDepartmentDecisions(db, caseRow, options = {}) {
  const [items] = await db.execute(`SELECT i.*, CAST(i.origin_department_id AS CHAR) AS origin_department_id,
    CAST(i.target_department_id AS CHAR) AS target_department_id,
    CAST(i.origin_decided_by_person_id AS CHAR) AS origin_decided_by_person_id,
    CAST(i.counterparty_decided_by_person_id AS CHAR) AS counterparty_decided_by_person_id
    FROM process_v7_preview_review_items i WHERE i.case_id=? AND i.is_current=1 ORDER BY i.id${options.lock ? ' FOR SHARE' : ''}`, [caseRow.id]);
  const confirmations = {}, absent = [];
  for (const item of items) {
    const sides = {};
    for (const party of ['origin', 'counterparty']) {
      const result = Number(item.revision_id) === Number(caseRow.current_revision_id)
        ? await inspectItemParty(db, item, party, options) : missing('DEPARTMENT_CONFIRMATION_SOURCE_CHANGED');
      sides[party] = result;
      if (!result.valid) absent.push({ item_id: Number(item.id), party, reason: result.reason,
        department_id: String(party === 'origin' ? item.origin_department_id : item.target_department_id), status: item[party + '_status'] });
    }
    confirmations[String(item.id)] = sides;
  }
  return { valid: absent.length === 0, missing: absent, items: confirmations };
}

async function assertPreviewDepartmentDecisions(db, caseRow) {
  const result = await inspectPreviewDepartmentDecisions(db, caseRow, { lock: true });
  if (!result.valid) {
    const message = '当前参与部门尚未由具备有效授权的部门负责人本人完成核对，请保留原意见并重新核对';
    throw Object.assign(new Error(message), { statusCode: 409, code: 'DEPARTMENT_CONFIRMATION_REQUIRED',
      payload: { error: message, code: 'DEPARTMENT_CONFIRMATION_REQUIRED', missing: result.missing } });
  }
  return result;
}

module.exports = { inspectFormalDepartmentDecision, inspectItemParty, inspectPreviewDepartmentDecisions, assertPreviewDepartmentDecisions };
